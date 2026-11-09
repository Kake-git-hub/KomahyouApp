#!/usr/bin/env node
// 生徒ごとの経緯ツール(読み取り専用)。1 人の生徒について、期間内の 4 つの記録を時刻順に 1 本へ並べる。
//
// ★なぜ作ったか(2026-11-09・オーナー確定)
//   室長からの曖昧な連絡(「未消化が多分消えてる」「組んだ通りになってない」)に 1 週間以上遡って答え、
//   その生徒を正しく処理するため。手順は docs/runbooks/student-inquiry.md。
//
// ★取得の手順(読み取りだけ)
//   1. 生徒授業台帳 classroomSnapshots/{id}/lessonLedgerDays を dateKey の範囲で :runQuery(期間の前の最後の 1 日も基準に取る)。
//      その生徒の科目ごとの未消化・実績を日ごとに並べ、前の台帳の日から変わった日を「変化日」とする。
//   2. 操作ログ operationEvents と操作痕跡 operationTraces を recordedAt(ISO 文字列)の範囲で :runQuery。
//      その生徒(ID・痕跡の要約は「名前#ID」)の行だけ残す。
//   3. 保存ごとの版 classroom-save-history/{ws}/{id}/ を Storage の一覧(GET)で引き、変化日とその前日の
//      最初と最後の版だけを落として比べ(tools/snapshot-diff.mjs の diffBoardWeeks)、その生徒の机だけ残す。
//      名簿(名前を ID に置き換える用)は一覧の最新の版から読む。
//   4. 4 つを時刻順に 1 本へ(tools/studentTimeline.lib.mjs)。既定は名前を ID に置き換える。
//   どれかの元が取れなくても止めずに「取得できず: 理由」と出して残りを出す。
//
// ★本番データ保護ルール: 許す呼び方は下の表(createReadOnlyHttp)で固定する。GET と :runQuery の POST だけ。
//   それ以外(PATCH・DELETE・:commit・:batchWrite・Storage へのアップロード)は送る前に例外にする。
//   --show-names の出力には生徒名が入る。スクラッチ領域にだけ置き、リポジトリ・Issue・公開ログへ出さない。
//
// 使い方:
//   export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)
//   node tools/student-timeline.mjs --workspace main --classroom <id> --student <sNNN> --from YYYY-MM-DD [--to YYYY-MM-DD] [--json] [--show-names]
import { isInvokedDirectly } from './invoked-directly.mjs'
import { decodeDoc, fieldValue } from './lesson-ledger-report.mjs'
import { decodeJsonBuffer, diffBoardWeeks, extractClassroomSnapshot } from './snapshot-diff.mjs'
import {
  addDays,
  buildStudentTimeline,
  findLedgerChangeDays,
  formatTimelineText,
  jstDayStartIso,
  jstToday,
  parseSaveHistoryObjectName,
  planVersionDownloads,
  SAVE_HISTORY_RETENTION_DAYS,
  SOURCE_EARLIEST_DATE,
  toJstDateKey,
} from './studentTimeline.lib.mjs'

export const USAGE = '使い方: node tools/student-timeline.mjs --workspace main --classroom <id> --student <sNNN> --from YYYY-MM-DD [--to YYYY-MM-DD] [--project komahyouapp-prod] [--json] [--show-names]'

const DEFAULT_PROJECT = 'komahyouapp-prod'
const VALUE_FLAGS = { '--workspace': 'workspaceKey', '--classroom': 'classroomId', '--student': 'studentId', '--from': 'from', '--to': 'to', '--project': 'project' }
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseArgs(argv) {
  const options = { workspaceKey: '', classroomId: '', studentId: '', from: '', to: '', project: DEFAULT_PROJECT, json: false, showNames: false, help: false, unknown: [], missingValue: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--show-names') { options.showNames = true; continue }
    if (VALUE_FLAGS[arg]) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) { options.missingValue.push(arg); continue }
      options[VALUE_FLAGS[arg]] = value
      index += 1
      continue
    }
    options.unknown.push(arg)
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  for (const flag of options.unknown ?? []) errors.push(`知らない引数です: ${flag}`)
  for (const flag of options.missingValue ?? []) errors.push(`${flag} の値がありません。`)
  if (!options.workspaceKey) errors.push('--workspace <key> は必須です(本番は main)。')
  if (!options.classroomId) errors.push('--classroom <教室ID> は必須です。')
  if (!options.studentId) errors.push('--student <生徒ID(sNNN)> は必須です。')
  if (!options.from) errors.push('--from YYYY-MM-DD は必須です。')
  for (const key of ['from', 'to']) {
    if (options[key] && !DATE_PATTERN.test(options[key])) errors.push(`--${key} は YYYY-MM-DD で指定してください(${options[key]})。`)
  }
  if (options.from && options.to && DATE_PATTERN.test(options.from) && DATE_PATTERN.test(options.to) && options.from > options.to) {
    errors.push('--from が --to より後です。')
  }
  return errors
}

// ---------------------------------------------------------------------------
// 読み取り専用の通信(許す呼び方を表で固定する・copy-prod-classroom-to-staging.mjs の READ_ONLY_POST_SUFFIXES と同じ作法)
// ---------------------------------------------------------------------------

/** 許す呼び方。host ごとに、GET できるパスの頭と、POST してよいパスの末尾。 */
const READ_ONLY_RULES = {
  'firestore.googleapis.com': { getPathPrefixes: ['/v1/projects/'], postPathSuffixes: [':runQuery'] },
  'storage.googleapis.com': { getPathPrefixes: ['/storage/v1/b/'], postPathSuffixes: [] },
}

/** 送ってよい呼び方か。だめなら理由の文、よければ空文字。 */
export function rejectReasonForRequest(method, url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return `URL を読めません: ${url}`
  }
  const rule = parsed.protocol === 'https:' ? READ_ONLY_RULES[parsed.hostname] : undefined
  if (!rule) return `許していない宛先です: ${parsed.protocol}//${parsed.hostname}`
  const path = decodeURIComponent(parsed.pathname)
  if (method === 'GET') {
    return rule.getPathPrefixes.some((prefix) => path.startsWith(prefix)) ? '' : `許していない GET です: ${path}`
  }
  if (method === 'POST') {
    return rule.postPathSuffixes.some((suffix) => path.endsWith(suffix)) ? '' : `読み取り以外の POST は送りません: ${path}`
  }
  return `読み取り以外の呼び方は送りません: ${method}`
}

/**
 * 読み取り専用の通信関数を作る。許していない呼び方は fetch を呼ぶ前に例外にする(本番への書き込みを構造的に起こさない)。
 * @param {{ token: string, fetchImpl?: typeof fetch }} params
 * @returns {(method: string, url: string, body?: unknown) => Promise<Response>}
 */
export function createReadOnlyHttp({ token, fetchImpl = globalThis.fetch }) {
  return async function http(method, url, body) {
    const upper = String(method).toUpperCase()
    const reason = rejectReasonForRequest(upper, url)
    if (reason) throw new Error(`本番への書き込み系リクエストを拒否: ${reason}`)
    const response = await fetchImpl(url, {
      method: upper,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${upper} ${new URL(url).pathname.split('/').slice(-2).join('/')}: ${text.slice(0, 200)}`)
    }
    return response
  }
}

// ---------------------------------------------------------------------------
// Firestore / Storage の読み方
// ---------------------------------------------------------------------------

/**
 * 1 つの項目の範囲で絞り、同じ項目で並べる問い合わせ(複合索引が要らない形・__name__ では並べない)。
 * 値は文字列(dateKey・recordedAt は ISO 文字列。timestampValue で比べると 0 件になる)。
 * @param {{ collectionId: string, field: string, filters: Array<[string, string]>, direction?: 'ASCENDING'|'DESCENDING', limit?: number }} params
 */
export function buildRangeQuery({ collectionId, field, filters, direction = 'ASCENDING', limit }) {
  const fieldFilters = filters.map(([op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } } }))
  const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: 'AND', filters: fieldFilters } }
  return {
    structuredQuery: {
      from: [{ collectionId }],
      where,
      orderBy: [{ field: { fieldPath: field }, direction }],
      ...(limit ? { limit } : {}),
    },
  }
}

function decodeFields(doc) {
  return Object.fromEntries(Object.entries(doc?.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
}

async function runQuery(http, parentUrl, query) {
  const response = await http('POST', `${parentUrl}:runQuery`, query)
  const rows = await response.json()
  return (Array.isArray(rows) ? rows : []).map((row) => row.document).filter(Boolean)
}

async function listStorageObjects(http, bucket, prefix) {
  const items = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ prefix, fields: 'items(name,size,timeCreated),nextPageToken', maxResults: '1000' })
    if (pageToken) query.set('pageToken', pageToken)
    const response = await http('GET', `https://storage.googleapis.com/storage/v1/b/${bucket}/o?${query}`)
    const body = await response.json()
    items.push(...(body.items ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return items
}

async function downloadStorageObject(http, bucket, name) {
  const response = await http('GET', `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`)
  return Buffer.from(await response.arrayBuffer())
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function rosterFromPayload(payload) {
  return [...(Array.isArray(payload?.students) ? payload.students : []), ...(Array.isArray(payload?.teachers) ? payload.teachers : [])]
    .filter((person) => person && typeof person.id === 'string')
    .map((person) => ({ id: person.id, name: String(person.name ?? ''), displayName: String(person.displayName ?? '') }))
}

/** 名簿を ID でまとめる(同じ人の名前の違う形をどれも残す)。 */
function mergeRoster(target, people) {
  for (const person of people) {
    if (!person.name && !person.displayName) continue
    target.push(person)
  }
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

/** 取得して 1 本にする(ネットワークは http だけを通す)。 */
export async function collectStudentTimeline(options, http) {
  const to = options.to || jstToday()
  const { classroomId, studentId, from, workspaceKey } = options
  const project = options.project || DEFAULT_PROJECT
  const bucket = `${project}.firebasestorage.app`
  const parentUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/workspaces/${workspaceKey}/classroomSnapshots/${classroomId}`
  const sourceErrors = []
  const notes = []
  const stats = {}
  const roster = []
  let rosterFromSnapshot = false

  if (from < SOURCE_EARLIEST_DATE.ledger) notes.push(`台帳と操作ログは ${SOURCE_EARLIEST_DATE.ledger} より前の記録が無い`)
  if (from < SOURCE_EARLIEST_DATE.trace) notes.push(`操作痕跡は ${SOURCE_EARLIEST_DATE.trace} より前の記録が無い`)
  if (from < addDays(jstToday(), -SAVE_HISTORY_RETENTION_DAYS)) notes.push(`保存ごとの版は ${SAVE_HISTORY_RETENTION_DAYS} 日より前は消えている`)

  // 1. 生徒授業台帳(期間の前の最後の 1 日も基準として取る)
  let ledgerDays = []
  try {
    const before = await runQuery(http, parentUrl, buildRangeQuery({ collectionId: 'lessonLedgerDays', field: 'dateKey', filters: [['LESS_THAN', from]], direction: 'DESCENDING', limit: 1 }))
    const inRange = await runQuery(http, parentUrl, buildRangeQuery({ collectionId: 'lessonLedgerDays', field: 'dateKey', filters: [['GREATER_THAN_OR_EQUAL', from], ['LESS_THAN_OR_EQUAL', to]] }))
    ledgerDays = [...before, ...inRange].map(decodeDoc)
    stats['台帳'] = `${inRange.length} 日${before.length > 0 ? '(+期間前 1 日)' : ''}`
    for (const day of ledgerDays) {
      mergeRoster(roster, [...(day.rows ?? []), ...(day.lectureRows ?? [])]
        .filter((row) => typeof row?.studentId === 'string' && row.studentId)
        .map((row) => ({ id: row.studentId, name: String(row.name ?? '') })))
    }
  } catch (error) {
    sourceErrors.push({ source: 'ledger', reason: errorText(error) })
  }
  const changeDays = findLedgerChangeDays(ledgerDays, studentId).filter((day) => day >= from && day <= to)
  stats['変化日'] = changeDays.length > 0 ? changeDays.join(' ') : 'なし'

  // 2. 操作ログ・操作痕跡(recordedAt は ISO 文字列で比べる)
  const fromIso = jstDayStartIso(from)
  const toIso = jstDayStartIso(addDays(to, 1))
  const recordedRange = [['GREATER_THAN_OR_EQUAL', fromIso], ['LESS_THAN', toIso]]
  let events = []
  try {
    events = (await runQuery(http, parentUrl, buildRangeQuery({ collectionId: 'operationEvents', field: 'recordedAt', filters: recordedRange }))).map(decodeFields)
    stats['操作ログ'] = `${events.length} 件(教室全体)`
  } catch (error) {
    sourceErrors.push({ source: 'event', reason: errorText(error) })
  }
  let traces = []
  try {
    traces = (await runQuery(http, parentUrl, buildRangeQuery({ collectionId: 'operationTraces', field: 'recordedAt', filters: recordedRange }))).map(decodeFields)
    stats['痕跡'] = `${traces.length} 保存分(教室全体)`
  } catch (error) {
    sourceErrors.push({ source: 'trace', reason: errorText(error) })
  }

  // 3. 保存ごとの版(変化日とその前日の最初と最後だけ落とす)
  const versionDiffs = []
  const downloaded = []
  try {
    const objects = await listStorageObjects(http, bucket, `classroom-save-history/${workspaceKey}/${classroomId}/`)
    const parsed = objects.map((object) => parseSaveHistoryObjectName(object.name)).filter(Boolean)
    const plan = planVersionDownloads(objects, changeDays)
    const latest = [...parsed].sort((left, right) => left.version - right.version || left.savedAt.localeCompare(right.savedAt)).pop() ?? null
    const readPayload = async (name) => {
      const doc = decodeJsonBuffer(await downloadStorageObject(http, bucket, name))
      downloaded.push(name)
      const snapshot = extractClassroomSnapshot(doc, { classroomId, file: name.split('/').pop() })
      mergeRoster(roster, rosterFromPayload(snapshot.payload))
      rosterFromSnapshot = true
      return snapshot.payload
    }

    for (const note of plan.dayNotes) versionDiffs.push({ dateKey: note.dateKey, note: note.note })
    for (const group of plan.groups) {
      let previous = null
      for (const version of group.versions) {
        let weeks
        try {
          weeks = (await readPayload(version.name))?.boardState?.weeks ?? []
        } catch (error) {
          versionDiffs.push({ dateKey: version.dateKey, toSavedAt: version.savedAt, error: `v${version.version} を読めない: ${errorText(error)}` })
          previous = null
          continue
        }
        if (previous) {
          versionDiffs.push({
            dateKey: toJstDateKey(version.savedAt),
            fromSavedAt: previous.version.savedAt,
            toSavedAt: version.savedAt,
            fromVersion: previous.version.version,
            toVersion: version.version,
            desks: diffBoardWeeks(previous.weeks, weeks),
          })
        }
        previous = { version, weeks }
      }
    }
    if (latest && !downloaded.includes(latest.name)) {
      try {
        await readPayload(latest.name)
      } catch (error) {
        sourceErrors.push({ source: 'version', reason: `名簿(最新の版 v${latest.version})を読めない: ${errorText(error)}` })
      }
    }
    if (parsed.length === 0) sourceErrors.push({ source: 'version', reason: 'この教室の保存の版が 1 本も無い(保存していない・保持期間切れ)' })
    else if (changeDays.length === 0) notes.push('台帳の変化日が無いので、版は比べていない(名簿用に最新の版だけ読んだ)')
    stats['版'] = `${downloaded.length} 本を落とした(一覧 ${parsed.length} 本中)`
  } catch (error) {
    sourceErrors.push({ source: 'version', reason: errorText(error) })
  }

  if (!rosterFromSnapshot && !options.showNames) notes.push('名簿(最新の版)が取れなかったので、痕跡の要約は伏せた(講師の名前を ID にできないため)')

  const timeline = buildStudentTimeline({
    studentId,
    roster,
    ledgerDays,
    events,
    traces,
    versionDiffs,
    sourceErrors,
    showNames: options.showNames,
    hideTraceSummaries: !rosterFromSnapshot,
  })
  return { classroomId, studentId, from, to, stats, notes, downloads: downloaded, timeline }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const errors = validateArgs(options)
  const token = String(process.env.FIRESTORE_ACCESS_TOKEN ?? '').trim()
  if (!token) errors.push('環境変数 FIRESTORE_ACCESS_TOKEN がありません(export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs))。')
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  if (options.showNames) console.error('注意: --show-names の出力には生徒名が入ります。スクラッチ領域にだけ置き、リポジトリ・Issue・公開ログへ出さないでください。')
  const result = await collectStudentTimeline(options, createReadOnlyHttp({ token }))
  console.log(options.json ? JSON.stringify(result, null, 2) : formatTimelineText(result))
}

// import しただけでは何も実行しない(テストから純関数だけを読むため・tools/invoked-directly.mjs)。
if (isInvokedDirectly(import.meta.url)) {
  await main()
}
