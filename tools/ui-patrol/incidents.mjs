// 画面の自動巡回: 過去の事故の日の形を、決まった一覧で流す(第 2 段の順 2・--incidents)。純関数(ファイルにもネットワークにも触れない)。
// 一覧は tools/ui-patrol-incidents.json(tools/ui-patrol-known.json と同じ置き場)。1 件 = 短い名前・バックアップの時点・教室・何の事故の形か・流す台本・備考。
// ★既定では流さない(2026-11-11 オーナー決定: 既定は最新のデータだけ・約 10 分のまま)。テンプレ・再反映・保存/読み込みを触った変更のときに足す。
// ★公開リポジトリなので一覧に実名を書かない。教室は ID(校名は説明に書いてよい)。生徒・講師の ID(s091・t025 の形)も書かない(検査で断る)。
import path from 'node:path'
import { DEFAULT_CLASSROOMS } from './fetchData.mjs'
import { DEFAULT_SCENARIO_NAMES, SCENARIO_NAMES } from './options.mjs'
import { buildPatrolClockTime } from './driver.mjs'

/** 一覧の置き場(リポジトリの根からの相対)。 */
export const INCIDENTS_FILE = 'tools/ui-patrol-incidents.json'

const FIELDS = ['name', 'key', 'today', 'classrooms', 'incident', 'scenarios', 'note']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/
const CLASSROOM_PATTERN = /^[A-Za-z0-9_-]+$/
// 生徒 ID(s091)・講師 ID(t025)の形。説明・備考に書かない(公開リポジトリ)。
const PERSON_ID_PATTERN = /(^|[^A-Za-z0-9])[st]\d{3,}(?![A-Za-z0-9])/

/**
 * 一覧(JSON を読んだ値)を検査して、流せる形にそろえる。戻り値 { incidents, errors }(errors が空でなければ流さない)。
 * そろえる形: classrooms は ID の配列("all" は本番 2 校)・scenarios は boot を先頭に足した配列(省略は既定の並び)・note は空でも文字列。
 */
export function parseIncidentList(value) {
  if (!Array.isArray(value)) return { incidents: [], errors: ['事故の日の一覧が配列ではありません。'] }
  if (value.length === 0) return { incidents: [], errors: ['事故の日の一覧に 1 件もありません。'] }
  const errors = []
  const incidents = []
  const seen = new Set()
  value.forEach((item, index) => {
    const where = `一覧の ${index + 1} 件目${typeof item?.name === 'string' && item.name ? `(${item.name})` : ''}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push(`${where}: オブジェクトではありません。`); return }
    const before = errors.length
    for (const field of Object.keys(item)) {
      if (!FIELDS.includes(field)) errors.push(`${where}: 知らない項目です: ${field}(${FIELDS.join('・')} から)。`)
    }
    if (typeof item.name !== 'string' || !NAME_PATTERN.test(item.name)) errors.push(`${where}: name は英小文字・数字・- だけで書いてください(出力のフォルダ名にします)。`)
    else if (seen.has(item.name)) errors.push(`${where}: name が重複しています: ${item.name}`)
    else seen.add(item.name)
    if (typeof item.key !== 'string' || !KEY_PATTERN.test(item.key)) errors.push(`${where}: key はバックアップの時点 YYYY-MM-DDTHH-mm(JST)で書いてください。`)
    let classrooms = null
    if (item.classrooms === 'all') classrooms = DEFAULT_CLASSROOMS.map((room) => room.id)
    else if (Array.isArray(item.classrooms) && item.classrooms.length > 0 && item.classrooms.every((id) => typeof id === 'string' && CLASSROOM_PATTERN.test(id))) classrooms = [...new Set(item.classrooms)]
    else errors.push(`${where}: classrooms は教室 ID(英数字・_・-)の配列か "all" で書いてください。`)
    if (typeof item.incident !== 'string' || !item.incident.trim()) errors.push(`${where}: incident(何の事故の形か・版・Issue 番号)を書いてください。`)
    let scenarios = [...DEFAULT_SCENARIO_NAMES]
    if (item.scenarios !== undefined) {
      if (!Array.isArray(item.scenarios) || item.scenarios.length === 0) errors.push(`${where}: scenarios は台本の名前の配列で書いてください(省略すると既定の並び)。`)
      else {
        for (const name of item.scenarios) {
          if (!SCENARIO_NAMES.includes(name)) errors.push(`${where}: scenarios に知らない台本があります: ${name}(${SCENARIO_NAMES.join(',')} から)。`)
        }
        scenarios = ['boot', ...item.scenarios.filter((name) => name !== 'boot')]
      }
    }
    // today: その事故の形を流す日(道具の今日とブラウザの時計をその日に合わせる)。台本の日付(来週の月曜など)は今日から決まるので、
    // 実際の今日で流すと日が進むほど事故の形を通らなくなる(手直し 1・Important-1)。データの時点の日より前にはできない。
    if (item.today !== undefined && (typeof item.today !== 'string' || !DATE_PATTERN.test(item.today) || (typeof item.key === 'string' && item.today < item.key.slice(0, 10)))) {
      errors.push(`${where}: today はその形を流す日 YYYY-MM-DD(データの時点の日〔${typeof item.key === 'string' ? item.key.slice(0, 10) : '?'}〕以降)で書いてください。`)
    }
    if (item.note !== undefined && typeof item.note !== 'string') errors.push(`${where}: note は文字列で書いてください。`)
    for (const field of ['incident', 'note']) {
      if (typeof item[field] === 'string' && PERSON_ID_PATTERN.test(item[field])) errors.push(`${where}: ${field} に生徒・講師の ID のような文字があります(公開リポジトリなので書かない)。`)
    }
    if (errors.length === before) incidents.push({ name: item.name, key: item.key, today: item.today ?? '', classrooms, incident: item.incident.trim(), scenarios, note: item.note ?? '' })
  })
  return { incidents: errors.length === 0 ? incidents : [], errors }
}

/**
 * --incidents の選び方。selector は true(全部)か名前の配列。選んだものは一覧の順で返す(挙げた順ではない・重複は 1 回)。
 * 一覧に無い名前があれば何も選ばず断る(取り違えで別の件だけ流して「変なし」に見せない)。
 */
export function selectIncidents(incidents, selector) {
  if (selector === true) return { selected: [...incidents], errors: [] }
  const names = Array.isArray(selector) ? selector : []
  const known = new Set(incidents.map((item) => item.name))
  const unknown = [...new Set(names.filter((name) => !known.has(name)))]
  if (unknown.length > 0) {
    return { selected: [], errors: [`--incidents に一覧に無い名前があります: ${unknown.join(',')}(選べる名前: ${incidents.map((item) => item.name).join(',')})。`] }
  }
  if (names.length === 0) return { selected: [], errors: ['--incidents に名前がありません。'] }
  const wanted = new Set(names)
  return { selected: incidents.filter((item) => wanted.has(item.name)), errors: [] }
}

/** 件ごとの引数: 時点・教室・台本を件のものに、出力を <out>/<名前> にする(ほかの引数はそのまま・元は書き換えない)。 */
export function buildIncidentRunOptions(options, incident) {
  return {
    ...options,
    key: incident.key,
    classrooms: [...incident.classrooms],
    scenarios: [...incident.scenarios],
    out: path.join(options.out, incident.name),
    // 流す日(省略なら本物の今日・時計も固定しない)。道具の今日(today)とブラウザの時計(clockTime=その日の JST 9:00 から進む)の両方。
    today: incident.today ?? '',
    clockTime: buildPatrolClockTime(incident.today),
    incidents: false,
    incidentName: incident.name,
    // 報告の見出し(件の名前と時点)と、取得の前の形の確かめ(tools/ui-patrol.mjs)に使う。
    incident: { name: incident.name, key: incident.key, incident: incident.incident },
  }
}

/**
 * 全体の終了コード。止めた(130)が最優先。次に、どれかに「変」(1)があれば 1(流せなかった件〔2〕があっても「変」を 2 に隠さない)。
 * 変が無く、どれかが流せなければ 2。全部 0 なら 0。1 件も無ければ 2。
 * (1 回の巡回の中の決まり〔report.mjs の resolveExitCode〕は件ごとにそのまま使う。ここは件どうしのまとめ方だけ。)
 */
export function resolveIncidentsExitCode(results) {
  if (!Array.isArray(results) || results.length === 0) return 2
  const codes = results.map((result) => result.exitCode)
  if (codes.includes(130)) return 130
  // 変を出したあと途中で止まった件(終了コード 2 でも報告に変がある・--baseline-ref のときは新しい変)も 1 に数える。
  if (codes.includes(1) || results.some((result) => result.exitCode !== 0 && (result.stops ?? 0) > 0)) return 1
  if (codes.some((code) => code !== 0)) return 2
  return 0
}

const EXIT_MEANINGS = { 0: '変なし', 1: '変あり', 2: '流せなかった', 130: '止めた' }

/** 件ごとの 1 行と全体の終了コード(標準出力と <out>/incidents.txt)。 */
export function formatIncidentsSummary(results) {
  const total = resolveIncidentsExitCode(results)
  const lines = [`■ 過去の事故の日の形(${results.length} 件): 終了コード ${total}(${EXIT_MEANINGS[total] ?? '不明'})`]
  for (const result of results) {
    const seconds = typeof result.seconds === 'number' ? `・${Math.round(result.seconds)} 秒` : ''
    const stopsText = result.exitCode === 2 && (result.stops ?? 0) > 0 ? `・途中で止まる前に変 ${result.stops} 件` : ''
    lines.push(`  - ${result.name}(時点 ${result.key}${result.today ? `・流す日 ${result.today}` : ''}): 終了コード ${result.exitCode}(${EXIT_MEANINGS[result.exitCode] ?? '不明'})${stopsText}${seconds}`)
    if (result.headline) lines.push(`      ${result.headline}`)
    if (result.reason) lines.push(`      理由: ${result.reason}`)
  }
  if (total === 1 && results.some((result) => result.exitCode === 2)) lines.push('  (流せなかった件もあります。「変」を先に調べ、流せなかった件はその理由を見て流し直す)')
  return lines.join('\n')
}
