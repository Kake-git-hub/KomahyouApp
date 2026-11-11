// 画面の自動巡回(tools/ui-patrol.mjs)の引数。tools/inv-audit.mjs の parseArgs/validateArgs と同じ作法。
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_CLASSROOMS } from './fetchData.mjs'

export const USAGE = [
  '使い方: node tools/ui-patrol.mjs --out <出力先(リポジトリの外)> [--classroom <id>]... [--key <YYYY-MM-DDTHH-mm>] [--seed-file <path>]...',
  '          [--scenario boot,c,b,e,f,a,d(,g,h)] [--moves <n>] [--seed <n>] [--random <n>] [--known <json>] [--port <n>] [--headed] [--prepare-only] [--json]',
  '          [--baseline <前に流した report.json> | --baseline-ref <git の ref>] [--incidents [<名前,名前>]] [--incidents-file <json>]',
  '  --scenario: 既定は boot,c,b,e,f,a,d。g(休日設定と解除・丸ごと振替)は既定では流れない。休日設定・丸ごと振替・在庫の会計を触った変更のときに足す(例 c,b,e,f,a,d,g)。',
  '             h(講習の自動割振)も既定では流れない。講習の自動割振や在庫の会計を触った変更のときに足す(例 c,b,e,f,a,d,h)。割り振れる未消化講習(期間の終わりが今日以降)が無い時期は h を飛ばす(h だけなら終了コード 2)。',
  '  --prepare-only: 取得・伏せ字・自己点検・種データの書き出しまで(ブラウザは動かさない)。',
  '  --baseline <report.json>: 前に流した報告と突き合わせ、「変」を 新しい／前から／消えた に分ける。同じ種データ(指紋が同じ)でないと比べない(2)。',
  '                 新しい変が 1 件でもあれば 1・新しい変が 0 なら前からの変が残っていても 0。',
  '  --baseline-ref <ref>: その ref のアプリ(git archive を <out>/baseline-app へ展開)で同じ台本を先に流して <out>/baseline/ に残し、今の作業ツリーと比べる',
  '                 (作業ツリー・index・ブランチには触らない。所要時間は約 2 倍。依存〔package-lock.json〕が違う・読み口が無い版の ref は断る)。',
  '                 --baseline と同時には指定できず、--prepare-only とも併用できない。',
  '  --incidents [<名前,名前>]: 過去の事故の日の形(tools/ui-patrol-incidents.json の一覧・名前を省くと全部)を順に流す。既定では流さない。',
  '                 テンプレ・再反映・保存/読み込みを触った変更のときに足す。件ごとにその時点のデータ・教室・台本で流し、出力は <out>/<名前>/。',
  '                 --baseline-ref と一緒に使える(件ごとに比べる)。--key・--seed-file・--classroom・--scenario・--baseline・--json とは一緒に指定できない。',
  '                 全体の終了コード: どれかに変があれば 1(流せなかった件があっても)・変が無くどれかが流せなければ 2・全部変なしで 0。',
  '  終了コード: 0=変なし／1=変あり／2=流せなかった・途中で止まった・何も操作できなかった。',
].join('\n')

// 流れる順は tools/ui-patrol/scenarios.mjs の runClassroomPatrol が決める(boot → c → b → でたらめ → e → f → a → d → g → h)。d はテンプレを変えるので既定の最後。
// e(出欠)は a の前(付けた出欠記録のコマに、a・d のテンプレ保存が生徒を置き直さないかも見える)。
// f(講師の移動・入れ替え・休み)も a の前(手で置いた講師・休みの講師を a・d のテンプレ保存がどう扱うかも見える)。
// g(休日設定と解除・丸ごと振替〔作成と解除〕)は既定では流さない(--scenario で挙げたときだけ・DEFAULT_SCENARIO_NAMES に入れない)。
//   巡回の所要時間は約 10 分のまま(2026-11-11 オーナー決定)なので、これ以上既定を延ばさない。
//   休日設定・丸ごと振替・在庫の会計を触った変更のときに足す(例 --scenario c,b,e,f,a,d,g)。g は作ったものを解除して元の形へ戻すので d のあとに流す。
// h(講習の自動割振)も既定では流さない(2026-11-11 オーナー決定: 既定は約 10 分のまま)。講習の自動割振や在庫の会計を触った変更のときに足す
//   (例 --scenario c,b,e,f,a,d,h)。割り振れる未消化講習が無い時期(講習の提出の前)は中断せず飛ばす(台本 g も同じ・選んだ台本がどの教室でも候補なしのときだけ終了コード 2)。最後に流す。
export const SCENARIO_NAMES = ['boot', 'c', 'b', 'e', 'f', 'a', 'd', 'g', 'h']
/** --scenario を指定しないときに流す台本(g と h は入れない)。 */
export const DEFAULT_SCENARIO_NAMES = ['boot', 'c', 'b', 'e', 'f', 'a', 'd']
const VALUE_FLAGS = {
  '--out': 'out', '--classroom': 'classroom', '--key': 'key', '--seed-file': 'seedFile', '--scenario': 'scenario',
  '--moves': 'moves', '--seed': 'seed', '--random': 'random', '--known': 'known', '--port': 'port',
  '--baseline': 'baseline', '--baseline-ref': 'baselineRef', '--incidents-file': 'incidentsFile',
}
const NUMBER_FLAGS = ['moves', 'seed', 'random', 'port']

export function parseArgs(argv) {
  const options = {
    out: '', classrooms: [], key: '', seedFiles: [], scenarios: [], moves: 6, seed: 1, random: 0, known: 'tools/ui-patrol-known.json', port: 5199, baseline: '', baselineRef: '',
    headed: false, prepareOnly: false, json: false, help: false, unknown: [], missingValue: [], invalidNumber: [], stray: [],
    // --incidents: false=流さない(既定)／true=一覧の全部／名前の配列=選んだものだけ。incidentsFile は一覧の場所。
    incidents: false, incidentsFile: 'tools/ui-patrol-incidents.json',
    // --incidents と一緒に指定できない引数を見分けるため、--classroom・--scenario を書いたかを持つ(既定で埋める前の値)。
    classroomGiven: false, scenarioGiven: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--incidents') {
      // 値は省ける(省くと全部)。次がオプション(-- で始まる)か末尾なら値なし。
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) { options.incidents = true; continue }
      index += 1
      options.incidents = value.split(',').map((item) => item.trim()).filter(Boolean)
      continue
    }
    if (arg === '--headed') { options.headed = true; continue }
    if (arg === '--prepare-only') { options.prepareOnly = true; continue }
    if (arg === '--json') { options.json = true; continue }
    const name = VALUE_FLAGS[arg]
    if (name) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) { options.missingValue.push(arg); continue }
      index += 1
      if (name === 'classroom') options.classrooms.push(value)
      else if (name === 'seedFile') options.seedFiles.push(value)
      else if (name === 'scenario') options.scenarios.push(...value.split(',').map((item) => item.trim()).filter(Boolean))
      else if (NUMBER_FLAGS.includes(name)) {
        if (!/^\d+$/.test(value)) options.invalidNumber.push(arg)
        else options[name] = Number(value)
      } else options[name] = value
      continue
    }
    if (arg.startsWith('--')) { options.unknown.push(arg); continue }
    options.stray.push(arg)
  }
  options.classroomGiven = options.classrooms.length > 0
  options.scenarioGiven = options.scenarios.length > 0
  if (options.classrooms.length === 0) options.classrooms = DEFAULT_CLASSROOMS.map((room) => room.id)
  // boot(起動の確認)は必ず流す。台本の指定が無ければ既定の並び(g は入らない)。
  options.scenarios = options.scenarios.length === 0 ? [...DEFAULT_SCENARIO_NAMES] : ['boot', ...options.scenarios.filter((name) => name !== 'boot')]
  return options
}

export function validateArgs(options) {
  const errors = []
  for (const flag of options.unknown ?? []) errors.push(`知らないオプションです: ${flag}`)
  for (const flag of options.missingValue ?? []) errors.push(`${flag} の値がありません。`)
  for (const flag of options.invalidNumber ?? []) errors.push(`${flag} は 0 以上の整数で指定してください。`)
  for (const value of options.stray ?? []) errors.push(`余分な引数です: ${value}`)
  if (!options.out) errors.push('--out を指定してください(リポジトリの外のスクラッチ領域)。')
  if (options.key && !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/.test(options.key)) errors.push('--key は YYYY-MM-DDTHH-mm の形で指定してください(例 2026-11-10T23-45)。')
  // 教室 ID はファイル名(<out>/<classroomId>.seed.json・画面写真)にも使う。`../` や区切り文字で --out の外を消したり書いたり
  // させないよう、Firestore の文書 ID として実際に使っている形(英数字・_・-)だけを通す。
  for (const classroomId of options.classrooms ?? []) {
    if (!/^[A-Za-z0-9_-]+$/.test(classroomId)) errors.push(`--classroom は英数字・_・- だけで指定してください: ${classroomId}`)
  }
  for (const name of options.scenarios ?? []) {
    if (!SCENARIO_NAMES.includes(name)) errors.push(`--scenario に知らない台本があります: ${name}(${SCENARIO_NAMES.join(',')} から選びます)。`)
  }
  if (options.baseline && options.baselineRef) errors.push('--baseline と --baseline-ref は同時に指定できません(どちらか一方)。')
  if ((options.baseline || options.baselineRef) && options.prepareOnly) errors.push('--baseline / --baseline-ref は --prepare-only と併用できません(--prepare-only は巡回しないため)。')
  // git の引数として渡すので、先頭が - の値はオプションに読まれる。ref として使わない。
  if (options.baselineRef && options.baselineRef.startsWith('-')) errors.push(`--baseline-ref は git の ref(ブランチ名・タグ・コミット)で指定してください: ${options.baselineRef}`)
  if ((options.seedFiles ?? []).length > 0 && options.seedFiles.length !== options.classrooms.length) {
    errors.push(`--seed-file(${options.seedFiles.length} 個)と --classroom(${options.classrooms.length} 個)は同じ数・同じ順で指定してください。`)
  }
  if (options.incidents) {
    // 時点・教室・台本は一覧の件が決める。比べる報告は件ごとに違うので --baseline は使えない(--baseline-ref は件ごとに流すので使える)。
    const reason = {
      '--key': '時点は一覧の件が決めます',
      '--seed-file': '種データは件ごとにその時点から作ります',
      '--classroom': '教室は一覧の件が決めます',
      '--scenario': '台本は一覧の件が決めます',
      '--baseline': '比べる報告は件ごとに違います。変更前と比べるなら --baseline-ref を使ってください',
      '--json': '件ごとの報告が続けて出て 1 つの JSON になりません。<out>/<名前>/report.json を読んでください',
    }
    const given = {
      '--key': Boolean(options.key), '--seed-file': (options.seedFiles ?? []).length > 0, '--classroom': Boolean(options.classroomGiven),
      '--scenario': Boolean(options.scenarioGiven), '--baseline': Boolean(options.baseline), '--json': Boolean(options.json),
    }
    for (const flag of Object.keys(reason)) {
      if (given[flag]) errors.push(`--incidents と ${flag} は一緒に指定できません(${reason[flag]})。`)
    }
    if (Array.isArray(options.incidents)) {
      for (const name of options.incidents) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errors.push(`--incidents の名前は英小文字・数字・- だけです: ${name}`)
      }
    }
  }
  return errors
}

/** まだ無いパスでも、いちばん近い存在する親の実体パスに残りを足して比べる(シンボリックリンク越しの抜け道を塞ぐ)。 */
function resolveReal(target) {
  let current = path.resolve(target)
  const rest = []
  for (;;) {
    try {
      return path.join(realpathSync(current), ...rest.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      rest.push(path.basename(current))
      current = parent
    }
  }
}

/** 出力先がリポジトリの中(リポジトリそのものを含む)なら throw。伏せ字のデータをリポジトリへ置かないため。 */
export function assertOutDirOutsideRepo(outDir, repoRoot) {
  const relative = path.relative(resolveReal(repoRoot), resolveReal(outDir))
  // 「外」は '..' そのもの・'../' で始まる・別ドライブ等の絶対パスだけ。'..foo' のような名前の場所は中。
  const isOutside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  if (!isOutside) {
    throw new Error('--out がリポジトリの中です。伏せ字のデータもリポジトリへ置かないため、スクラッチ領域(リポジトリの外)を指定してください。')
  }
}

/** JST の今日(YYYY-MM-DD)。 */
export function jstToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
