// 通常授業履歴(callable getStudentLessonHistory)のサーバー経路を読み取り専用で再現する診断ツール。
//
// 画面に「通常授業履歴を取得できませんでした: INTERNAL」しか出ないとき(確認リスト v1.5.504 h-2)、
// 関数ログが読めない環境でも「Firestore クエリが失敗しているのか / 台帳の中身で純関数が落ちているのか /
// 応答の JSON 化で落ちているのか」を切り分ける。
//
// やること(すべて GET / runQuery のみ。Firestore への書き込みは一切しない・本番データ保護ルール準拠):
//  1. index.ts の loadLatestLedgerDoc と同じ構造化クエリ(__name__ <= to を desc で 5 件)を REST runQuery で投げ、
//     バックエンドの応答(エラーならその本文)をそのまま表示する。
//  2. 取れた台帳文書を functions/lib(tsc 済み)の純関数へ渡し、対象生徒(未指定なら全生徒)ごとに
//     buildStudentLessonHistoryResponse を実行して例外を捕まえる。
//  3. 応答を firebase-functions の encode と同じ規則(NaN/Infinity/undefined/Date 以外の非プリミティブは不可)で検査する。
// 出力には生徒名・科目などのデータを載せない(件数・例外・型だけ)。
//
// 使い方:
//   FIRESTORE_ACCESS_TOKEN=... node tools/lesson-history-diagnose.mjs --workspace main --classroom v8OZ7zH8vONNHjjYVcR1 [--student <id>] [--to YYYY-MM-DD] [--legacy-name-order]
//   (トークンが無ければ gcloud auth print-access-token を使う)
//   --workspace は必須（会社＝workspace のキー。既定値は廃止済み・2026-09-16 複数会社展開 Phase 0 T0-4）。
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

const DEFAULT_PROJECT_ID = 'komahyouapp-prod'
const DEFAULT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'

export const USAGE = '使い方: node tools/lesson-history-diagnose.mjs --workspace <key> [--classroom v8OZ7zH8vONNHjjYVcR1] [--student <id>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--legacy-name-order]'

export function parseArgs(argv) {
  const options = { classroomId: DEFAULT_CLASSROOM_ID, studentId: '', from: '', to: '', project: DEFAULT_PROJECT_ID, workspaceKey: '', legacyNameOrder: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--classroom') { options.classroomId = argv[++index] ?? options.classroomId; continue }
    if (arg === '--student') { options.studentId = argv[++index] ?? ''; continue }
    if (arg === '--from') { options.from = argv[++index] ?? ''; continue }
    if (arg === '--to') { options.to = argv[++index] ?? ''; continue }
    if (arg === '--project') { options.project = argv[++index] ?? options.project; continue }
    if (arg === '--workspace') { options.workspaceKey = argv[++index] ?? options.workspaceKey; continue }
    if (arg === '--legacy-name-order') { options.legacyNameOrder = true; continue }
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (!options.workspaceKey) errors.push('--workspace <key> は必須です。')
  return errors
}

function accessToken() {
  if (process.env.FIRESTORE_ACCESS_TOKEN) return process.env.FIRESTORE_ACCESS_TOKEN
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
}

function fieldValue(field) {
  if (!field || typeof field !== 'object') return undefined
  if ('stringValue' in field) return field.stringValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return field.doubleValue
  if ('booleanValue' in field) return field.booleanValue
  if ('nullValue' in field) return null
  if ('timestampValue' in field) return field.timestampValue
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
  if ('arrayValue' in field) return (field.arrayValue.values ?? []).map(fieldValue)
  return undefined
}

/** firebase-functions v2 の encode() と同じ判定で、応答に JSON 化できない値が無いか調べる(値そのものは出さない)。 */
export function findUnencodable(value, path = '$') {
  if (value === null || typeof value === 'undefined') return []
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}: 非有限の数値(${String(value)})`]
  if (typeof value === 'boolean' || typeof value === 'string') return []
  if (value instanceof Date) return []
  if (Array.isArray(value)) return value.flatMap((entry, index) => findUnencodable(entry, `${path}[${index}]`))
  if (typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => findUnencodable(entry, `${path}.${key}`))
  return [`${path}: 型 ${typeof value}`]
}

/**
 * index.ts の loadLatestLedgerDoc(= functions/src/lessonLedgerHistory.ts buildLatestLedgerQuery)と同じクエリの REST 表現。
 * ★ 2026-09-12 の診断で、旧実装(文書 ID `__name__` の降順)は「The query requires an index」(FAILED_PRECONDITION)で
 *   拒否されることを確認した(= 画面の INTERNAL の真因)。現行はフィールド dateKey の降順(単一フィールド索引は自動)。
 *   `--legacy-name-order` を付けると旧クエリを投げて再現できる。
 */
export function buildLatestLedgerStructuredQuery({ project, workspaceKey, classroomId, to, legacyNameOrder = false }) {
  const snapshotPath = `projects/${project}/databases/(default)/documents/workspaces/${workspaceKey}/classroomSnapshots/${classroomId}`
  const field = legacyNameOrder ? '__name__' : 'dateKey'
  const value = legacyNameOrder ? { referenceValue: `${snapshotPath}/lessonLedgerDays/${to}` } : { stringValue: to }
  return {
    structuredQuery: {
      from: [{ collectionId: 'lessonLedgerDays' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN_OR_EQUAL', value } },
      orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
      limit: 5,
    },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  const token = accessToken()
  const lib = await import('../functions/lib/lessonLedgerHistory.js')
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const range = lib.resolveLessonHistoryRange({ from: options.from, to: options.to, today })
  console.log(`[range] from=${range.from} to=${range.to} clamped=${range.clamped}`)

  // 1. Firestore クエリの再現
  const parentPath = `workspaces/${options.workspaceKey}/classroomSnapshots/${options.classroomId}`
  const url = `https://firestore.googleapis.com/v1/projects/${options.project}/databases/(default)/documents/${parentPath}:runQuery`
  const body = buildLatestLedgerStructuredQuery({ project: options.project, workspaceKey: options.workspaceKey, classroomId: options.classroomId, to: range.to, legacyNameOrder: options.legacyNameOrder })
  console.log(`[query] ${options.legacyNameOrder ? '旧: __name__ 降順' : '現行: dateKey 降順'}`)
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  if (!response.ok) {
    console.log(`[query] HTTP ${response.status} — Firestore がクエリを拒否しました。本文:`)
    console.log(text)
    process.exitCode = 2
    return
  }
  const results = JSON.parse(text)
  const docs = results.filter((entry) => entry.document).map((entry) => entry.document)
  console.log(`[query] OK: ${docs.length} 件 (ids: ${docs.map((doc) => doc.name.split('/').pop()).join(', ') || 'なし'})`)
  const latest = docs.find((doc) => lib.isLessonHistoryDateKey(doc.name.split('/').pop()))
  if (!latest) {
    console.log('[ledger] 有効な日付キーの台帳文書が無い → 応答は空(events=0)。例外は起きない。')
    return
  }
  const fields = Object.fromEntries(Object.entries(latest.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
  const dateKey = latest.name.split('/').pop()
  console.log(`[ledger] dateKey=${dateKey} dataEncoding=${String(fields.dataEncoding)} data.type=${typeof fields.data} data.length=${typeof fields.data === 'string' ? fields.data.length : '-'} savedAt.type=${typeof fields.savedAt} computedAt.type=${typeof fields.computedAt}`)

  let rows = []
  try {
    rows = lib.readLessonLedgerRows({ ...fields, dateKey })
  } catch (error) {
    console.log(`[ledger] readLessonLedgerRows が例外: ${error instanceof Error ? error.stack : String(error)}`)
    process.exitCode = 3
    return
  }
  console.log(`[ledger] rows=${rows.length}`)
  const typeCounts = {}
  for (const row of rows) {
    for (const key of ['studentId', 'studentKey', 'name', 'subject', 'makeupBalance']) {
      const type = row && typeof row === 'object' ? (row[key] === null ? 'null' : typeof row[key]) : 'row-not-object'
      typeCounts[`${key}:${type}`] = (typeCounts[`${key}:${type}`] ?? 0) + 1
    }
  }
  console.log(`[ledger] 行の型分布: ${JSON.stringify(typeCounts)}`)
  const badTokens = rows.flatMap((row) => ['attended', 'absent', 'absentNoMakeup', 'placed', 'makeupRemaining'].flatMap((key) => {
    const tokens = row?.[key]
    if (tokens == null) return []
    if (!Array.isArray(tokens)) return [`${key}: 配列でない(${typeof tokens})`]
    return tokens.filter((token) => typeof token !== 'string').map(() => `${key}: 文字列でない要素`)
  }))
  if (badTokens.length > 0) console.log(`[ledger] トークンの型異常 ${badTokens.length} 件: ${[...new Set(badTokens)].join(' / ')}`)

  // 2. 純関数の再現(対象生徒 or 全生徒)
  const studentIds = options.studentId
    ? [options.studentId]
    : [...new Set(rows.map((row) => (typeof row?.studentId === 'string' && row.studentId) || (typeof row?.studentKey === 'string' ? row.studentKey : '')).filter(Boolean))]
  console.log(`[build] 対象生徒 ${studentIds.length} 名で buildStudentLessonHistoryResponse を実行`)
  let failures = 0
  for (const studentId of studentIds) {
    try {
      const result = lib.buildStudentLessonHistoryResponse({ classroomId: options.classroomId, studentId, range, doc: { ...fields, dateKey } })
      const problems = findUnencodable(result)
      if (problems.length > 0) {
        failures += 1
        console.log(`[build] 生徒#${studentIds.indexOf(studentId) + 1}: 応答に JSON 化できない値: ${problems.slice(0, 5).join(' / ')}`)
      }
    } catch (error) {
      failures += 1
      console.log(`[build] 生徒#${studentIds.indexOf(studentId) + 1}: 例外 ${error instanceof Error ? error.stack : String(error)}`)
    }
  }
  console.log(failures === 0 ? '[build] 全員 OK(純関数・JSON 化とも例外なし)' : `[build] 失敗 ${failures} 名`)
  if (failures > 0) process.exitCode = 4
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
}
