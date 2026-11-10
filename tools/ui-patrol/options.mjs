// 画面の自動巡回(tools/ui-patrol.mjs)の引数。tools/inv-audit.mjs の parseArgs/validateArgs と同じ作法。
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_CLASSROOMS } from './fetchData.mjs'

export const USAGE = [
  '使い方: node tools/ui-patrol.mjs --out <出力先(リポジトリの外)> [--classroom <id>]... [--key <YYYY-MM-DDTHH-mm>] [--seed-file <path>]...',
  '          [--scenario boot,c,b,a] [--moves <n>] [--seed <n>] [--random <n>] [--known <json>] [--port <n>] [--headed] [--prepare-only] [--json]',
  '  --prepare-only: 取得・伏せ字・自己点検・種データの書き出しまで(ブラウザは動かさない)。',
  '  終了コード: 0=変なし／1=変あり／2=流せなかった・途中で止まった・何も操作できなかった。',
].join('\n')

export const SCENARIO_NAMES = ['boot', 'c', 'b', 'a']
const VALUE_FLAGS = {
  '--out': 'out', '--classroom': 'classroom', '--key': 'key', '--seed-file': 'seedFile', '--scenario': 'scenario',
  '--moves': 'moves', '--seed': 'seed', '--random': 'random', '--known': 'known', '--port': 'port',
}
const NUMBER_FLAGS = ['moves', 'seed', 'random', 'port']

export function parseArgs(argv) {
  const options = {
    out: '', classrooms: [], key: '', seedFiles: [], scenarios: [], moves: 6, seed: 1, random: 0, known: 'tools/ui-patrol-known.json', port: 5199,
    headed: false, prepareOnly: false, json: false, help: false, unknown: [], missingValue: [], invalidNumber: [], stray: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
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
  if (options.classrooms.length === 0) options.classrooms = DEFAULT_CLASSROOMS.map((room) => room.id)
  // boot(起動の確認)は必ず流す。台本の指定が無ければ全部。
  options.scenarios = options.scenarios.length === 0 ? [...SCENARIO_NAMES] : ['boot', ...options.scenarios.filter((name) => name !== 'boot')]
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
    if (!SCENARIO_NAMES.includes(name)) errors.push(`--scenario に知らない台本があります: ${name}(boot,c,b,a から選びます)。`)
  }
  if ((options.seedFiles ?? []).length > 0 && options.seedFiles.length !== options.classrooms.length) {
    errors.push(`--seed-file(${options.seedFiles.length} 個)と --classroom(${options.classrooms.length} 個)は同じ数・同じ順で指定してください。`)
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
