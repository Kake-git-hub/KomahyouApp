#!/usr/bin/env node
// 画面の自動巡回(docs/test-strategy.md 層 5)。本番の形のデータ(名前は伏せる)を手元のアプリに入れ、室長と同じ画面操作を
// 自動で行い、操作のたびに点検する。流れ: 引数 → 取得 → 伏せ字 → 自己点検 3 つ → 種データの書き出し(--prepare-only はここまで)
// → 開発用サーバー(ローカルモード) → 教室ごとにブラウザ → 台本(起動・c・b・a・tools/ui-patrol/scenarios.mjs) → 報告(<out>/report.json)。
// --seed-file を渡すと取得・伏せ字を飛ばし、伏せ字済みの種データで流す。
//
// ★読み取り専用・実名を残さない(本番データ保護ルール)
//   - 本番へは Storage の GET と Firestore の :runQuery(読み取り)だけ。通信は tools/ui-patrol/fetchData.mjs の 1 か所から出る。
//   - 取得した元データ(実名入り)はメモリの中だけ。ファイルに書くのは伏せ字のあとの種データ(<out>/<classroomId>.seed.json)だけで、
//     出力先はリポジトリの外(スクラッチ領域)に限る。出力・報告に出すのは仮名と ID・件数・経路だけ。
// ★自己点検(伏せ字で挙動が変わったまま点検しても意味がないので、1 つでも引っかかれば種データを書かず終了コード 2)
//   (a) 伏せ字のあとに実名が残っていない(findNameLeaks) (b) 名前引きと鍵の対応が前後で同じ(compareNameResolutionForParity)
//   (c) 保証台帳の結果が前後で同じ(compareAuditForParity)
// 終了コード: 0=変なし／1=変あり／2=流せなかった・途中で止まった・何も操作できなかった。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isInvokedDirectly } from './invoked-directly.mjs'
import { fetchReadonlyAccessToken } from './prod-readonly-token.mjs'
import { decodeJsonBuffer, extractClassroomSnapshot } from './snapshot-diff.mjs'
import { DEFAULT_CLASSROOMS, fetchClassroomBackup, fetchLatestBackupKey } from './ui-patrol/fetchData.mjs'
import { loadPatrolApp } from './ui-patrol/loadApp.mjs'
import { prepareBaselineApp } from './ui-patrol/baselineApp.mjs'
import { checkBaselineUsable, compareWithBaseline, seedFingerprint } from './ui-patrol/baseline.mjs'
import { USAGE, assertOutDirOutsideRepo, jstToday, parseArgs, validateArgs } from './ui-patrol/options.mjs'
import { buildPatrolWorkspaceSnapshot } from './ui-patrol/seed.mjs'
import { startDevServer } from './ui-patrol/devServer.mjs'
import { closePatrolBrowser, launchPatrolBrowser, loadPlaywright } from './ui-patrol/driver.mjs'
import { createClassroomReport, createPatrolReport, formatPatrolReportText, resolveExitCode } from './ui-patrol/report.mjs'
import { runClassroomPatrol } from './ui-patrol/scenarios.mjs'

const REPO_ROOT = path.join(import.meta.dirname, '..')
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** トークンを作る通信は prod-readonly-token が出す。ここでは「Google の認証サーバーへの POST だけ」に絞った fetch を渡す。 */
function guardTokenFetch(fetchImpl) {
  return (url, init = {}) => {
    if (String(url) !== TOKEN_URL || String(init.method ?? 'GET').toUpperCase() !== 'POST') {
      throw new Error('読み取り専用ガード: トークン作成以外の通信は許可していません。')
    }
    return fetchImpl(url, init)
  }
}

/** トークン作成の失敗を理由の分類だけにする(例外の文にはサービスアカウントや認証サーバーの応答が混ざりうるので出さない)。 */
function describeTokenFailure(error) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('KOMAHYOU_READONLY_SA_JSON_B64') || message.includes('サービスアカウント鍵')) {
    return '環境変数 FIRESTORE_ACCESS_TOKEN か KOMAHYOU_READONLY_SA_JSON_B64 が無いか、読めません'
  }
  const status = /アクセストークンを取得できません\((\d{3})/.exec(message)?.[1]
  if (status) return `認証サーバーが状態コード ${status} を返しました`
  return '認証サーバーと通信できませんでした'
}

/** 教室ごとの出力: 前回の種データを消す(自己点検や取得に落ちたとき、古い種データを次の作業が読まないように)。 */
function removeStaleSeed(out, classroomId) {
  rmSync(path.join(out, `${classroomId}.seed.json`), { force: true })
}

function readAppVersion(root = REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? ''
  } catch {
    return ''
  }
}

function labelOf(classroomId) {
  return DEFAULT_CLASSROOMS.find((room) => room.id === classroomId)?.label ?? classroomId
}

/**
 * 1 教室ぶんの取得 → 伏せ字 → 自己点検。通れば伏せ字のあとの種データの中身を、引っかかれば problems を返す。
 * 元の payload はここから外へ出さない。
 */
/** 取得のあとの段の例外は、元データの断片が文に混ざりうる(JSON.parse など)ので「段の名前＋例外の種類」だけにする。 */
function inStage(stage, fn) {
  try {
    return fn()
  } catch (error) {
    const kind = error instanceof Error && error.name ? error.name : 'Error'
    throw new Error(`教室データを処理できませんでした(${stage}・${kind})`)
  }
}

function prepareClassroom({ app, classroomId, buffer, today }) {
  const doc = inStage('復号', () => decodeJsonBuffer(buffer))
  const snapshot = inStage('取り出し', () => extractClassroomSnapshot(doc, { file: `${classroomId}.json.gz`, classroomId }))
  const original = snapshot.payload
  const anonymized = inStage('伏せ字', () => app.anonymizeClassroomPayload(original))
  const problems = []
  // (a) 漏れ検査。返るのは経路だけ(値は出さない)。
  const leaks = inStage('自己点検(漏れ)', () => app.findNameLeaks(anonymized.payload, anonymized.nameMap.keys()))
  if (leaks.length > 0) problems.push({ kind: '漏れ', lines: leaks.slice(0, 20).map((route) => `実名が残っている項目: ${route}`), total: leaks.length })
  // (b) 名前引きと鍵の対応が前後で同じ。
  const resolution = inStage('自己点検(名前引き)', () => app.compareNameResolutionForParity(original, anonymized.payload))
  if (resolution.length > 0) problems.push({ kind: '名前引きの食い違い', lines: resolution.slice(0, 20), total: resolution.length })
  // (c) 保証台帳の結果が前後で同じ(今日は JST の今日)。
  // known は渡さない: 前後の比較なので既知の除外を引くと、片側だけ除外されて食い違いに見えたり、食い違いを隠したりする。
  const audit = (payload) => app.auditClassroomSnapshot({ classroomId, payload, today, known: [] })
  const parity = inStage('自己点検(保証台帳)', () => app.compareAuditForParity(audit(original), audit(anonymized.payload)))
  if (parity.length > 0) problems.push({ kind: '保証台帳の結果の食い違い', lines: parity.slice(0, 20), total: parity.length })
  const savedAt = snapshot.times?.find((time) => time.key === 'savedAt')?.iso
  return {
    problems,
    leakCount: leaks.length,
    stats: anonymized.stats,
    seed: problems.length === 0 ? buildPatrolWorkspaceSnapshot({ classroomId, payload: anonymized.payload, savedAt }) : null,
  }
}

/** --seed-file の種データを読む。教室 ID が --classroom と同じ順で合っているかも見る(取り違えた教室で点検しない)。 */
function readSeedFiles(options) {
  return options.seedFiles.map((file, index) => {
    const seed = JSON.parse(readFileSync(file, 'utf8'))
    const classroomId = options.classrooms[index]
    if (seed?.actingClassroomId !== classroomId || !Array.isArray(seed?.classrooms) || !seed.classrooms.some((room) => room.id === classroomId)) {
      throw new Error(`${path.basename(file)} は教室 ${classroomId} の種データではありません。`)
    }
    return { classroomId, label: labelOf(classroomId), key: 'seed-file', seed }
  })
}

/** 種データの教室ごとの指紋(tools/ui-patrol/baseline.mjs)。報告の教室に入れ、baseline と同じデータかを見る。 */
function fingerprintsOf(seeds) {
  return seeds.map(({ classroomId, seed }) => ({
    classroomId, seedFingerprint: seedFingerprint(seed?.classrooms?.find((room) => room.id === classroomId)?.data),
  }))
}

/** 報告の教室に種データの指紋を足す(巡回の実装には依存しない・ここ 1 か所)。 */
function withFingerprints(report, fingerprints) {
  if (!Array.isArray(report?.classrooms)) return report
  return { ...report, classrooms: report.classrooms.map((room) => ({ ...room, seedFingerprint: fingerprints.find((item) => item.classroomId === room.classroomId)?.seedFingerprint })) }
}

/** --baseline の報告を読む。読めなければ throw(中身の断片は出さない)。 */
function readBaselineReport(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`--baseline を読めません(${path.basename(file)}・${error instanceof Error && error.code ? error.code : '壊れた JSON か読めないファイル'})。`)
  }
}

/** 既知の所見(tools/ui-patrol-known.json・ID だけ・理由つき)。無ければ空。 */
function readKnown(file) {
  const resolved = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file)
  if (!existsSync(resolved)) return []
  const parsed = JSON.parse(readFileSync(resolved, 'utf8'))
  return Array.isArray(parsed) ? parsed : []
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, stdout = process.stdout, stderr = process.stderr } = {}, deps = {}) {
  const say = (text) => stdout.write(`${text}\n`)
  const warn = (text) => stderr.write(`${text}\n`)
  const options = parseArgs(argv)
  if (options.help) {
    say(USAGE)
    return 0
  }
  const errors = validateArgs(options)
  if (errors.length > 0) {
    warn(USAGE)
    for (const error of errors) warn(`  - ${error}`)
    return 2
  }
  try {
    assertOutDirOutsideRepo(options.out, REPO_ROOT)
  } catch (error) {
    warn(`エラー: ${error.message}`)
    return 2
  }
  const usesSeedFiles = options.seedFiles.length > 0
  const prepareApp = deps.prepareBaselineApp ?? prepareBaselineApp
  // 前回の種データは出力先の検査が通った直後に全部消す(取得するときだけ。--seed-file は入力を消さない)。今回通った教室だけが残るので、
  // トークンの失敗・アプリの読み込みの失敗・取得の途中で止まっても、古い種データを次の作業が読まない(作業 4 の再レビューの指摘)。
  if (!usesSeedFiles) for (const classroomId of options.classrooms) removeStaleSeed(options.out, classroomId)

  if (options.prepareOnly && usesSeedFiles) {
    // 伏せ字済みの種データを使う指定。取得も伏せ字もしないので、読めるかだけ確かめる。
    try {
      readSeedFiles(options)
    } catch (error) {
      warn(`エラー: --seed-file を読めません: ${error.message}`)
      return 2
    }
    say(`種データ ${options.seedFiles.length} 件を読めました(取得・伏せ字は行いません)。`)
    return 0
  }
  // ブラウザが無ければ取得もしない(読み取りの通信を無駄に出さない)。
  const loadBrowser = deps.loadPlaywright ?? loadPlaywright
  if (!options.prepareOnly && !loadBrowser()) {
    warn('エラー: Playwright が無い環境では回せません。')
    return 2
  }

  const loadApp = deps.loadApp ?? loadPatrolApp
  let loaded = null
  let seeds = []
  let backupKey = ''
  let baselineApp = null
  const today = jstToday()
  try {
    // --baseline-ref: 断る条件(ref が解決できない・依存が違う・読み口が無い)は、取得より前に見る。
    if (options.baselineRef) {
      try {
        baselineApp = await prepareApp({ repoRoot: REPO_ROOT, ref: options.baselineRef, outDir: options.out })
      } catch (error) {
        warn(`エラー: ${error instanceof Error ? error.message : String(error)}`)
        return 2
      }
    }
    if (usesSeedFiles) {
      try {
        seeds = readSeedFiles(options)
      } catch (error) {
        warn(`エラー: --seed-file を読めません: ${error.message}`)
        return 2
      }
      backupKey = 'seed-file'
      loaded = await loadApp()
    } else {
      // トークン: 環境変数 FIRESTORE_ACCESS_TOKEN、無ければ読み取り専用サービスアカウントから作る。
      let token = env.FIRESTORE_ACCESS_TOKEN || ''
      if (!token) {
        try {
          token = (await fetchReadonlyAccessToken(env, guardTokenFetch(fetchImpl))).accessToken
        } catch (error) {
          warn(`エラー: 読み取り専用トークンを作れません(${describeTokenFailure(error)})。`)
          return 2
        }
      }
      loaded = await loadApp()
      mkdirSync(options.out, { recursive: true })
      const key = options.key || await fetchLatestBackupKey({ token, fetchImpl })
      backupKey = key
      const results = []
      for (const classroomId of options.classrooms) {
        const started = Date.now()
        const label = labelOf(classroomId)
        try {
          const { buffer } = await fetchClassroomBackup({ token, classroomId, key, fetchImpl })
          const prepared = prepareClassroom({ app: loaded.app, classroomId, buffer, today })
          if (prepared.problems.length > 0) {
            warn(`■ ${label}(${classroomId}・データ ${key}): 自己点検に引っかかりました。種データは書きません。`)
            for (const problem of prepared.problems) {
              warn(`  [${problem.kind}] ${problem.total} 件`)
              for (const line of problem.lines) warn(`    ${line}`)
            }
            results.push({ classroomId, label, key, ok: false, seconds: (Date.now() - started) / 1000 })
            continue
          }
          const file = path.join(options.out, `${classroomId}.seed.json`)
          const text = JSON.stringify(prepared.seed)
          writeFileSync(file, text)
          const seconds = (Date.now() - started) / 1000
          results.push({ classroomId, label, key, ok: true, file, bytes: Buffer.byteLength(text), seconds, leaks: prepared.leakCount })
          seeds.push({ classroomId, label, key, seed: prepared.seed })
          if (!options.json) {
            say(`■ ${label}(${classroomId}・データ ${key}): 漏れ ${prepared.leakCount}・名前引きの一致・保証台帳の結果の一致`)
            say(`  種データ ${path.basename(file)}(${Buffer.byteLength(text)} バイト)・${seconds.toFixed(1)} 秒`)
          }
        } catch (error) {
          warn(`■ ${label}(${classroomId}): 準備できませんでした: ${error instanceof Error ? error.message : String(error)}`)
          results.push({ classroomId, label, key, ok: false, seconds: (Date.now() - started) / 1000 })
        }
      }
      const allPrepared = results.length > 0 && results.every((result) => result.ok)
      if (options.prepareOnly) {
        if (options.json) say(JSON.stringify({ appVersion: readAppVersion(), prepared: results.map(({ classroomId, key: resultKey, ok, bytes, seconds, leaks }) => ({ classroomId, key: resultKey, ok, bytes, seconds, leaks })) }, null, 2))
        return allPrepared ? 0 : 2
      }
      // 自己点検に落ちた教室があれば流さない(伏せ字で挙動が変わったまま点検しても意味がない)。
      if (!allPrepared) return 2
    }
    const fingerprints = fingerprintsOf(seeds)
    // --baseline: 流す前に、同じデータか・中断した報告でないかを見る(違うものと比べて時間を使わない)。
    let baselineReport = null
    let baselineSource = ''
    if (options.baseline) {
      baselineReport = readBaselineReport(options.baseline)
      baselineSource = path.resolve(options.baseline)
      const unusable = checkBaselineUsable(baselineReport, fingerprints)
      if (unusable.length > 0) {
        for (const line of unusable) warn(`エラー: ${line}`)
        return 2
      }
    }
    const runPatrol = deps.runPatrol ?? runBrowserPatrol
    mkdirSync(options.out, { recursive: true }) // 画面写真を書けるように(--seed-file では取得の段で作られない)
    // --baseline-ref: その ref のアプリで同じ台本を先に流し、<out>/baseline/ に残す。台本・点検・乱数の種・種データ・options は今回と同じ。
    // (アプリだけが違う。点検と台本は今の作業ツリーの物。)
    if (baselineApp) {
      const baselineOut = path.join(options.out, 'baseline')
      mkdirSync(baselineOut, { recursive: true })
      if (!options.json) say(`変更前(${options.baselineRef})のアプリで先に流します…`)
      let baseRun = await runPatrol({
        app: loaded.app, seeds, options: { ...options, out: baselineOut }, backupKey, today, env, say, warn,
        // シグナルで止めたときも、展開したアプリと束ねたアプリを消す(runBrowserPatrol の片づけが呼ぶ)。
        extraCleanup: async () => { await baselineApp.cleanup(); await loaded.cleanup() }, repoRoot: baselineApp.appDir,
      })
      // 展開したアプリは使い終わったらすぐ消す(今回の巡回の間は要らない)。
      await baselineApp.cleanup()
      if (baseRun?.stopped) {
        warn('止めました(シグナル)。報告は書き出しません。')
        return 130
      }
      baseRun = withFingerprints(baseRun, fingerprints)
      mkdirSync(baselineOut, { recursive: true })
      writeFileSync(path.join(baselineOut, 'report.json'), JSON.stringify(baseRun, null, 2))
      writeFileSync(path.join(baselineOut, 'report.txt'), `${formatPatrolReportText(baseRun)}\n`)
      const unusable = checkBaselineUsable(baseRun, fingerprints)
      if (unusable.length > 0) {
        warn(`エラー: 変更前(${options.baselineRef})のアプリの巡回が最後まで流れなかったので、比べられません。報告: ${path.join(baselineOut, 'report.txt')}`)
        return 2
      }
      baselineReport = baseRun
      baselineSource = path.join(baselineOut, 'report.json')
      if (!options.json) {
        say(`変更前の巡回: ${formatPatrolReportText(baseRun).split('\n')[0]}`)
        say('今の作業ツリーで流します…')
      }
    }
    let report = withFingerprints(await runPatrol({ app: loaded.app, seeds, options, backupKey, today, env, say, warn, extraCleanup: loaded.cleanup }), fingerprints)
    // シグナルで止めた巡回は書き出さない: 途中までの report.json・report.txt は普通の報告と見分けにくく、前回の報告を
    // 上書きして「変なし」に見えることもある(作業 5 の再レビュー)。片づけのあと exit(130) で終わる。
    if (report?.stopped) {
      warn('止めました(シグナル)。報告は書き出しません。')
      return 130
    }
    if (baselineReport) {
      const compared = compareWithBaseline(report, baselineReport, { source: baselineSource })
      if (!compared.ok) {
        for (const line of compared.errors) warn(`エラー: ${line}`)
        return 2
      }
      report = compared.report
    }
    const reportFile = path.join(options.out, 'report.json')
    const reportText = formatPatrolReportText(report)
    mkdirSync(options.out, { recursive: true })
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    // 文の報告も標準出力と同じ文で残す(report.json と並べて、あとから読む人が同じものを見る)。
    writeFileSync(path.join(options.out, 'report.txt'), `${reportText}\n`)
    say(options.json ? JSON.stringify(report, null, 2) : reportText)
    if (!options.json) say(`報告: ${reportFile}`)
    return resolveExitCode(report)
  } catch (error) {
    warn(`エラー: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  } finally {
    if (loaded) await loaded.cleanup()
    if (baselineApp) await baselineApp.cleanup()
  }
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * Ctrl+C(SIGINT)・SIGTERM・SIGHUP を受けたら、片づけ(ブラウザ・開発用サーバー)を済ませてから終了コード 130 で終わる。
 * 開発用サーバーは別のプロセスグループ(devServer.mjs の detached)なので端末の Ctrl+C が届かず、Node は SIGINT で finally を通らずに
 * 終わるため、ここで止めないとサーバーが残る(作業 5 修正 1)。戻り値でハンドラを外す。
 */
function installSignalCleanup(proc, cleanup, onStopping = () => {}) {
  // on で受ける(once だと片づけ中の 2 回目の Ctrl+C が Node の既定の処理で即終了し、vite が残る)。2 回目以降は無視する。
  let handled = false
  const handler = () => {
    if (handled) return
    handled = true
    onStopping()
    void cleanup().catch(() => {}).finally(() => proc.exit(130))
  }
  for (const signal of SIGNALS) proc.on(signal, handler)
  return () => {
    for (const signal of SIGNALS) proc.removeListener(signal, handler)
  }
}

/**
 * 開発用サーバー → 教室ごとにブラウザ → 台本。ブラウザとサーバーは、流し終えたとき・例外・シグナルのどれでも 1 つの片づけで止める。
 * deps はテスト用(偽のサーバー・偽のブラウザ・偽の process)。
 */
export async function runBrowserPatrol({ app, seeds, options, backupKey, today, env, say, extraCleanup, repoRoot = REPO_ROOT }, deps = {}) {
  const proc = deps.process ?? process
  const startServer = deps.startDevServer ?? startDevServer
  const launch = deps.launchPatrolBrowser ?? launchPatrolBrowser
  const close = deps.closePatrolBrowser ?? closePatrolBrowser
  const runClassroom = deps.runClassroomPatrol ?? runClassroomPatrol
  const known = readKnown(options.known)
  let report = createPatrolReport({ appVersion: readAppVersion(repoRoot), backupKey })
  // 開発用サーバーの止め方。子を起こした直後(起動を待つ前)から持つ(起動待ちの最中のシグナルでも子を止める)。
  let stopServer = null
  let session = null
  let stopping = false
  let cleaned = null
  const cleanup = () => {
    // 何度呼ばれても 1 回だけ(シグナルと finally が重なっても二重に止めない)。
    if (!cleaned) {
      cleaned = (async () => {
        const current = session
        session = null
        await close(current).catch(() => {})
        if (stopServer) await stopServer().catch(() => {})
        // esbuild で束ねたアプリの一時フォルダ(シグナルで終わると main の finally を通らないので、ここでも消す)。
        if (extraCleanup) await extraCleanup().catch(() => {})
      })()
    }
    return cleaned
  }
  const removeSignalHandlers = installSignalCleanup(proc, cleanup, () => { stopping = true })
  try {
    const server = await startServer({ port: options.port, repoRoot, env, onSpawn: (stop) => { stopServer = stop } })
    stopServer = server.stop
    for (const { classroomId, label, key, seed } of seeds) {
      // 止めている最中は次の教室のブラウザを起動しない。
      if (stopping) break
      const started = Date.now()
      let classroomReport
      try {
        session = await launch({ baseUrl: server.baseUrl, headed: options.headed })
        classroomReport = await runClassroom({
          session, app, classroom: { classroomId, label, backupKey: key }, seedSnapshot: seed, options, outDir: options.out, known, today,
        })
      } catch (error) {
        // ブラウザを起動できないなど、台本に入る前に止まった。
        classroomReport = { ...createClassroomReport({ classroomId, label, backupKey: key }), aborted: error instanceof Error ? error.message.split('\n')[0] : String(error) }
      } finally {
        const current = session
        session = null
        await close(current)
      }
      report = { ...report, classrooms: [...report.classrooms, classroomReport] }
      if (!options.json) say(`  (${label}: ${((Date.now() - started) / 1000).toFixed(1)} 秒)`)
    }
  } finally {
    await cleanup()
    // シグナルで止めているときはハンドラを残す(片づけが終わると exit(130)。その間の 2 回目のシグナルも無視し続ける)。
    if (!stopping) removeSignalHandlers()
  }
  // 止めた印(main が報告を書き出さない)。
  return stopping ? { ...report, stopped: true } : report
}

// import しただけでは何も実行しない(テストから main を呼ぶため・tools/invoked-directly.mjs)。
if (isInvokedDirectly(import.meta.url)) {
  process.exitCode = await main()
}
