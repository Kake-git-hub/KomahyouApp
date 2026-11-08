// 全教室へ出した機能フラグを 1 本ずつ「全教室より前の範囲」へ戻すスクリプト(手元のファイルを書き換えるだけ)。
//
// ★なぜ作ったか(2026-11-08・全教室展開週の戻し準備)
//   v1.5.711 で 4 つのフラグ(parentPortalQr・lectureSchedulePublishToggle・teacherOnlySpecialSession・templateDiffApply)を
//   all-classrooms へ昇格した。本番で困りごとが出たとき、戻すには
//     1) src/utils/featureRollout.ts の scope
//     2) 保護者QRだけは functions/src/parentPortal.ts の PARENT_PORTAL_BASE_SCOPE(featureRollout.test.ts が字面で突合)
//     3) 進行中テーマ台帳 src/utils/developmentStatusLedger.ts の行(全教室でないフラグは台帳に載っていないとテストが落ちる)
//     4) CHANGELOG.md の「## 未リリース」の 1 行
//   を同じ変更でそろえる必要がある。慌てているときに 1 つ忘れると CI が赤になって止血が遅れるので、まとめて書き換える。
//   手順の全体は docs/runbooks/feature-flag-rollback.md。
//
// ★本番データには触らない(本番データ保護ルール準拠)
//   - ネットワークへは一切アクセスしない。Firestore / Storage を読まない・書かない。
//   - 書くのは上の 4 ファイル(リポジトリ直下からの相対パス)だけ。--dry-run なら何も書かない。
//   - 反映は通常どおり commit → main マージ(CI が Hosting を出す)。保護者QRは Functions のデプロイも要る。
//
// 使い方:
//   node tools/feature-flag-rollback.mjs <flagKey> --reason "<理由>" [--to development-only|staging-environment] [--dry-run]
//   npm run flag:rollback -- templateDiffApply --reason "講師の机が消える" --dry-run
//   - --to の既定は、そのフラグが v1.5.711 直前に持っていた scope(PREVIOUS_SCOPES)。
//   - 同じ指定で 2 回実行しても 2 回目は何も変えない(冪等)。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInvokedDirectly } from './invoked-directly.mjs'

export const USAGE = '使い方: node tools/feature-flag-rollback.mjs <flagKey> --reason "<理由>" [--to development-only|staging-environment] [--dry-run]'

export const FEATURE_ROLLOUT_PATH = 'src/utils/featureRollout.ts'
export const PARENT_PORTAL_PATH = 'functions/src/parentPortal.ts'
export const LEDGER_PATH = 'src/utils/developmentStatusLedger.ts'
export const CHANGELOG_PATH = 'CHANGELOG.md'
/** 読み書きするファイル(リポジトリ直下からの相対パス)。この 4 つ以外には触らない。 */
export const ROLLBACK_FILE_PATHS = Object.freeze([FEATURE_ROLLOUT_PATH, PARENT_PORTAL_PATH, LEDGER_PATH, CHANGELOG_PATH])

/** 戻せるフラグと、v1.5.711(2026-11-08 の全教室昇格)直前に持っていた scope。--to の既定。 */
export const PREVIOUS_SCOPES = Object.freeze({
  parentPortalQr: 'staging-environment',
  lectureSchedulePublishToggle: 'staging-environment',
  teacherOnlySpecialSession: 'staging-environment',
  templateDiffApply: 'development-only',
})

/** 画面での呼び名(台帳の題名に使う)。 */
export const FLAG_DISPLAY_NAMES = Object.freeze({
  parentPortalQr: '保護者向けQR',
  lectureSchedulePublishToggle: '講習の公開',
  teacherOnlySpecialSession: '講師専用の特別講習',
  templateDiffApply: 'テンプレ保存の差分反映',
})

const ROLLBACK_TARGET_SCOPES = Object.freeze(['development-only', 'staging-environment'])

/** scope の日本語(台帳の題名・要約に使う)。 */
const SCOPE_LABELS = Object.freeze({
  'development-only': '開発・テスト教室',
  'staging-environment': '開発・テスト教室と検証環境',
})

/** 戻すときの注意(dry-run と実行後に出す・手順書の「事前確認／事後確認」の要約)。 */
export const FLAG_ROLLBACK_NOTICES = Object.freeze({
  parentPortalQr: [
    'サーバー側 functions/src/parentPortal.ts も同時に書き換える(片側だけだと featureRollout.test.ts が落ちる)。main マージ後に Actions「Deploy Cloud Functions」の緑まで確かめる。緑になると本番教室の保護者ページは 403(開けない)になり、それまでは画面の QR が消えてもサーバーは答え続ける。室長へ「保護者QRをいったん止めた」と案内する。',
    '事後確認: OFF の間に削除した生徒の保護者QRはサーバー側で失効しない。ON に戻したら開発者がその生徒の QR を失効させる(削除済みの生徒は在籍確認で落ちるので保護者ページは開けない・実害は小)。',
  ],
  lectureSchedulePublishToggle: [
    '事前確認(必須): 戻すと画面のトグルは消えるが、保護者QR側は schedulePublished:false の講習を隠し続け、室長は公開へ戻せなくなる。先に室長へ「非公開の講習を全部公開へ戻して」と頼み、読み取り専用で非公開の講習が 0 件であることを確かめる(手順書の「講習の公開」)。',
  ],
  teacherOnlySpecialSession: [
    '講師専用かどうかはデータで決まるので、作成済みの講習の見え方は変わらない。作成画面のチェックが出なくなるだけ。',
  ],
  templateDiffApply: [
    '事前確認: 本番 2 校の保留(緑の 2 行)の件数を読み取り専用で数える。保留のある教室はフラグ OFF でも第 2 版の経路を使い続け、保留 0 件になると旧方式へ戻る(そのとき講師の休みの机にテンプレの講師が戻る・印は残る)。',
    'Hosting を v1.5.711 以前へ戻すとこの保護は無い。止めたいだけなら古い版へ戻さず、このスクリプトで OFF にした版を出す。',
  ],
})

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 1 行にそろえる(改行・連続空白を 1 つの空白へ)。 */
function toSingleLine(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/** TS の単一引用符文字列リテラルにする。 */
function toTsString(text) {
  return `'${String(text).replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`
}

function toKebabCase(key) {
  return key.replace(/([A-Z])/gu, '-$1').toLowerCase()
}

/** developmentStatusLedger.test.ts の社内記号の検査と同じ正規表現。 */
const LEDGER_JARGON_PATTERN = /\b[a-z]{1,3}(?:-[a-z]{1,3})?-\d+\b|§|\bQ\d+|\bv\d+\.\d+\.\d+|INV-\d+/u
const LEDGER_LIMITS = Object.freeze({ title: 40, summary: 140, nextAction: 110 })

export function ledgerRowId(flagKey) {
  return `rollback-${toKebabCase(flagKey)}`
}

export function changelogLine(flagKey, toScope, reason) {
  return `- fix: 機能フラグ ${flagKey} を全教室から ${toScope} へ戻す(理由: ${toSingleLine(reason)}・戻し手順書)`
}

/** 台帳に足す行(TS のオブジェクトリテラル・末尾カンマと改行つき・2 字下げ)。 */
export function buildLedgerRow({ flagKey, toScope, reason, today }) {
  const scopeLabel = SCOPE_LABELS[toScope]
  const oneLineReason = toSingleLine(reason)
  const title = `「${FLAG_DISPLAY_NAMES[flagKey]}」を ${scopeLabel} に戻した`
  const summaryHead = `${today} に全教室から戻し、今は${scopeLabel}だけで動いている。`
  const summaryWithReason = `${summaryHead}理由: ${oneLineReason}`
  // 理由が長い・社内記号を含むときは画面の文に出さず notes へ(台帳のテストが長さと記号を検出する)。
  const summary = summaryWithReason.length <= LEDGER_LIMITS.summary && !LEDGER_JARGON_PATTERN.test(oneLineReason)
    ? summaryWithReason
    : `${summaryHead}理由は「くわしく」に書いた。`
  const nextAction = 'Claude が原因を直して確認リストに項目を足し、オーナーが全教室へ戻すかを決める。'
  const notices = (FLAG_ROLLBACK_NOTICES[flagKey] ?? []).join(' ')
  const notes = `${today} に tools/feature-flag-rollback.mjs で ${flagKey} を all-classrooms から ${toScope} へ戻した(v1.5.711 の全教室昇格の戻し)。理由: ${oneLineReason}。手順と事前・事後の確認は docs/runbooks/feature-flag-rollback.md。${notices}`
  const references = ['docs/runbooks/feature-flag-rollback.md', FEATURE_ROLLOUT_PATH]
  if (flagKey === 'parentPortalQr') references.push(PARENT_PORTAL_PATH)
  const lines = [
    '  {',
    `    id: ${toTsString(ledgerRowId(flagKey))},`,
    `    title: ${toTsString(title)},`,
    "    stage: 'development-only',",
    "    who: 'claude',",
    `    summary: ${toTsString(summary)},`,
    `    nextAction: ${toTsString(nextAction)},`,
    `    notes: ${toTsString(notes)},`,
    `    featureKeys: [${toTsString(flagKey)}],`,
    `    references: [${references.map(toTsString).join(', ')}],`,
    `    updatedOn: ${toTsString(today)},`,
    '  },',
  ]
  return `${lines.join('\n')}\n`
}

function replaceFlagScope(source, flagKey, toScope) {
  const pattern = new RegExp(`(\\n  ${escapeRegExp(flagKey)}: \\{\\r?\\n    scope: )'([a-z-]+)'`, 'u')
  const match = pattern.exec(source)
  if (!match) throw new Error(`未知のフラグです: ${flagKey}(${FEATURE_ROLLOUT_PATH} に見つからない)`)
  const current = match[2]
  if (current === toScope) return source
  if (current !== 'all-classrooms') {
    throw new Error(`${flagKey} の scope は '${current}' で all-classrooms ではない(戻すものが無い・行き先 '${toScope}' とも違う)。手で確かめてください。`)
  }
  return source.replace(pattern, `$1'${toScope}'`)
}

function replaceParentPortalBaseScope(source, toScope) {
  const pattern = /(export const PARENT_PORTAL_BASE_SCOPE: [^=\n]*= )'([a-z-]+)'/u
  const match = pattern.exec(source)
  if (!match) throw new Error(`${PARENT_PORTAL_PATH} に PARENT_PORTAL_BASE_SCOPE が見つからない`)
  const current = match[2]
  if (current === toScope) return source
  if (current !== 'all-classrooms') {
    throw new Error(`PARENT_PORTAL_BASE_SCOPE は '${current}' で all-classrooms ではない。手で確かめてください。`)
  }
  return source.replace(pattern, `$1'${toScope}'`)
}

function insertLedgerRow(source, flagKey, row) {
  if (source.includes(`id: ${toTsString(ledgerRowId(flagKey))},`)) return source
  const opening = /export const DEVELOPMENT_STATUS_LEDGER: [^\n]*= \[\r?\n/u.exec(source)
  if (!opening) throw new Error(`${LEDGER_PATH} に DEVELOPMENT_STATUS_LEDGER の配列が見つからない`)
  // 先頭の欄の見出しコメント(「開発・テスト教室だけで動いている機能」)の後ろ、最初の行の前へ入れる。
  let index = opening.index + opening[0].length
  while (/^ {2}\/\/[^\n]*\n/u.test(source.slice(index))) {
    index = source.indexOf('\n', index) + 1
  }
  return `${source.slice(0, index)}${row}${source.slice(index)}`
}

function insertChangelogLine(source, line) {
  if (source.split(/\r?\n/u).includes(line)) return source
  const heading = /^## 未リリース\r?\n(?:\r?\n)?/mu.exec(source)
  if (!heading) throw new Error(`${CHANGELOG_PATH} に「## 未リリース」の見出しが見つからない`)
  const index = heading.index + heading[0].length
  const rest = source.slice(index)
  const separator = rest.startsWith('- ') || rest === '' ? '' : '\n'
  return `${source.slice(0, index)}${line}\n${separator}${rest}`
}

/**
 * 機能フラグを全教室から戻すときに書き換える 4 ファイルの新しい中身を作る(純関数・入力は変えない)。
 *
 * @param {{ files: Record<string, string>; flagKey: string; toScope: 'development-only' | 'staging-environment'; reason: string; today: string }} input
 * @returns {{ files: Record<string, string>; changedPaths: string[]; ledgerRow: string }}
 */
export function applyFeatureFlagRollback({ files, flagKey, toScope, reason, today }) {
  if (!Object.prototype.hasOwnProperty.call(PREVIOUS_SCOPES, flagKey)) {
    throw new Error(`未知のフラグです: ${flagKey}(戻せるのは ${Object.keys(PREVIOUS_SCOPES).join(' / ')})`)
  }
  if (!ROLLBACK_TARGET_SCOPES.includes(toScope)) {
    throw new Error(`戻し先は ${ROLLBACK_TARGET_SCOPES.join(' / ')} のどれか: ${toScope}`)
  }
  if (flagKey === 'parentPortalQr' && toScope === 'development-only') {
    throw new Error('parentPortalQr は development-only へは戻せない(サーバーの PARENT_PORTAL_BASE_SCOPE の型と述語が staging も通すため)。staging-environment を使う。')
  }
  if (toSingleLine(reason) === '') throw new Error('理由(--reason)が空です')
  if (!DATE_PATTERN.test(String(today ?? ''))) throw new Error(`日付は YYYY-MM-DD: ${today}`)
  for (const path of ROLLBACK_FILE_PATHS) {
    if (typeof files?.[path] !== 'string') throw new Error(`ファイルが渡されていない: ${path}`)
  }

  const ledgerRow = buildLedgerRow({ flagKey, toScope, reason, today })
  const next = { ...files }
  next[FEATURE_ROLLOUT_PATH] = replaceFlagScope(files[FEATURE_ROLLOUT_PATH], flagKey, toScope)
  if (flagKey === 'parentPortalQr') {
    next[PARENT_PORTAL_PATH] = replaceParentPortalBaseScope(files[PARENT_PORTAL_PATH], toScope)
  }
  next[LEDGER_PATH] = insertLedgerRow(files[LEDGER_PATH], flagKey, ledgerRow)
  next[CHANGELOG_PATH] = insertChangelogLine(files[CHANGELOG_PATH], changelogLine(flagKey, toScope, reason))
  const changedPaths = ROLLBACK_FILE_PATHS.filter((path) => next[path] !== files[path])
  return { files: next, changedPaths, ledgerRow }
}

/** 引数を読む。戻し先の既定は PREVIOUS_SCOPES。 */
export function parseArgs(argv) {
  let flagKey = ''
  let reason
  let toScope
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--reason') { reason = argv[index + 1]; index += 1 }
    else if (arg.startsWith('--reason=')) reason = arg.slice('--reason='.length)
    else if (arg === '--to') { toScope = argv[index + 1]; index += 1 }
    else if (arg.startsWith('--to=')) toScope = arg.slice('--to='.length)
    else if (arg.startsWith('--')) throw new Error(`知らないオプション: ${arg}\n${USAGE}`)
    else if (!flagKey) flagKey = arg
    else throw new Error(`余分な引数: ${arg}\n${USAGE}`)
  }
  if (!flagKey) throw new Error(USAGE)
  if (reason === undefined) throw new Error(`--reason "<理由>" が要る\n${USAGE}`)
  return { flagKey, reason, toScope: toScope ?? PREVIOUS_SCOPES[flagKey], dryRun }
}

/** 変わった範囲だけを -/+ で並べる(先頭と末尾の共通行を省く)。 */
export function summarizeChange(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1 }
  const shorten = (line) => (line.length > 160 ? `${line.slice(0, 160)}…` : line)
  return [
    `  @@ ${start + 1} 行目から`,
    ...a.slice(start, endA).map((line) => `  - ${shorten(line)}`),
    ...b.slice(start, endB).map((line) => `  + ${shorten(line)}`),
  ].join('\n')
}

function todayInJst(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = Object.fromEntries(ROLLBACK_FILE_PATHS.map((path) => [path, readFileSync(resolve(repoRoot, path), 'utf8')]))
  const result = applyFeatureFlagRollback({ files, flagKey: options.flagKey, toScope: options.toScope, reason: options.reason, today: todayInJst() })

  console.log(`機能フラグ ${options.flagKey} を all-classrooms → ${options.toScope} へ戻す${options.dryRun ? '(dry-run・何も書かない)' : ''}`)
  if (result.changedPaths.length === 0) {
    console.log('変更なし(すでに戻してある)。')
  }
  for (const path of result.changedPaths) {
    console.log(`\n■ ${path}`)
    console.log(summarizeChange(files[path], result.files[path]))
  }
  console.log('\n注意:')
  for (const notice of FLAG_ROLLBACK_NOTICES[options.flagKey] ?? []) console.log(`  - ${notice}`)

  if (options.dryRun) return
  for (const path of result.changedPaths) writeFileSync(resolve(repoRoot, path), result.files[path], 'utf8')
  console.log(`\n書き換えたファイル: ${result.changedPaths.join(', ') || '(なし)'}`)
  console.log('\n次にやること(docs/runbooks/feature-flag-rollback.md):')
  console.log('  1. npm run lint && npm run test:unit && npm run build')
  console.log('  2. git diff で 4 ファイル以外が変わっていないか読む')
  console.log('  3. commit → main マージ(CI が Hosting を出す)')
  console.log('  4. https://komahyouapp-prod.web.app/version.json の版が上がったか確かめ、室長へハードリロード(Ctrl+Shift+R)を案内')
  if (options.flagKey === 'parentPortalQr') {
    console.log('  5. Actions「Deploy Cloud Functions」の緑も確かめる(サーバー側の PARENT_PORTAL_BASE_SCOPE)')
  }
}

if (isInvokedDirectly(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
