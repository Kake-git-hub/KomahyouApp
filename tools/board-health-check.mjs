// 2 つの時点の教室データと保存記録から、異変を日本語で列挙する読み取り専用の健診ツール。
//
// ★なぜ作ったか(2026-11-08)
//   全教室展開の週(2026-11-09〜11-15)は、毎朝、前日 3:00 JST の日次バックアップと最新の 15 分バックアップを比べ、
//   同じコマに同じ生徒が 2 か所(INV-12)・保留/組/出自の印の件数・名簿と講師の減少・振替の急減・保存失敗・利用者報告を
//   点検する。手で JSON を読むと取りこぼすので、同じ物差しで毎朝同じ点検をするための道具。
//
// ★読み取り専用(本番データ保護ルール準拠)
//   - ネットワークへは一切アクセスしない。入力は手元のファイルだけ(取得は prod-readonly-token と gsutil cp で別に行う)。
//   - ファイルを書かない(結果は標準出力だけ)。
//   - ★出力に生徒名・講師名を出さない(生徒・講師は ID だけ)。毎朝の報告にそのまま貼れるようにするため。
//     managedStudentId が無い生徒は名前で同一判定するが、出力には「生徒ID なし」とだけ書く。
//     保存記録の errorMessage・利用者報告の本文は読まない(名前が入りうる)。
//
// 使い方:
//   node tools/board-health-check.mjs <前のファイル|-> <後のファイル> --classroom <id>
//     [--save-attempts <json>] [--reports <json>] [--known <json>] [--now <ISO>] [--json]
//   - 前のファイルが `-` なら前日との差の検査(保留の増減・名簿/講師の減少・振替の急減・机の変更数)を省く。
//   - ファイルの形・gzip の判定・教室の取り出しは tools/snapshot-diff.mjs と同じ(そちらを import して使う)。
//   - --save-attempts / --reports: Firestore の saveAttempts / developerReports を JSON 配列で(runQuery の返り値もそのまま可)。
//   - --known: 既知の 2 か所の除外 [{ classroomId, dateKey, slotNumber, studentId }]。
//   - --now: 「直近 24 時間」の基準時刻(既定は実行時刻)。
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { isInvokedDirectly } from './invoked-directly.mjs'
import { decodeJsonBuffer, diffBoardWeeks, extractClassroomSnapshot } from './snapshot-diff.mjs'

export const USAGE = '使い方: node tools/board-health-check.mjs <前のファイル|-> <後のファイル> --classroom <id> [--save-attempts <json>] [--reports <json>] [--known <json>] [--now <ISO>] [--json]'

export const HEALTH_CODES = [
  'duplicate-placement',
  'pending-count',
  'pending-delta',
  'whole-day-pair-count',
  'origin-mark-count',
  'roster-shrink',
  'teacher-shrink',
  'makeup-drop',
  'desk-change-burst',
  'save-failed',
  'save-none',
  'user-report',
]

/** 振替の急減: 前より この件数以上 減ったら警告。 */
export const MAKEUP_DROP_MIN = 10
/** 振替の急減: 前より この割合以上 減ったら警告。 */
export const MAKEUP_DROP_RATIO = 0.1
/**
 * 机単位の変更がこの数を超えたら知らせる(一括の組み直し・復元・テンプレ反映の印)。
 * 2026-11-08 の実データ(平日の 1 日で 250〜930 件・155 名規模)から決めた。週の範囲のずれは別に数える(cellsOnlyInOne)。
 */
export const DESK_CHANGE_BURST = 2000
/** 保存記録・利用者報告を見る範囲(時間)。 */
export const RECENT_WINDOW_HOURS = 24
/** 1 つの所見に並べる ID の上限(多すぎると読めない)。 */
const ID_LIST_LIMIT = 20

// src/components/schedule-board/wholeDayTransferPair.ts の WHOLE_DAY_PAIR_PREFIX と同じ。組は suppressedRegularLessonOccurrences に入る。
const WHOLE_DAY_PAIR_PREFIX = 'WHOLE_DAY_PAIR__'
// saveAttempts の status のうち、保存が失敗/拒否されたもの(started は進行中・verified は成功)。
const SAVE_FAILED_STATUSES = ['too-large', 'write-failed', 'verification-failed', 'stale', 'empty-management-data']

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function listIds(ids) {
  const shown = ids.slice(0, ID_LIST_LIMIT).join(', ')
  return ids.length > ID_LIST_LIMIT ? `${shown} … 他 ${ids.length - ID_LIST_LIMIT} 件` : shown
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value)
}

function parseTime(iso) {
  const time = Date.parse(String(iso ?? ''))
  return Number.isFinite(time) ? time : null
}

/** 直近 windowHours 時間に入るか。時刻が読めない記録は「入る」とみなす(取りこぼさない側)。 */
function isWithinWindow(iso, nowMs, windowHours) {
  const time = parseTime(iso)
  if (time === null) return true
  return time <= nowMs && nowMs - time <= windowHours * 3_600_000
}

// ---------------------------------------------------------------------------
// Firestore の返り値の読み下し
// ---------------------------------------------------------------------------

function unwrapFirestoreValue(value) {
  if (!isPlainObject(value)) return value
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('mapValue' in value) return unwrapFirestoreFields(value.mapValue?.fields)
  if ('arrayValue' in value) return asArray(value.arrayValue?.values).map(unwrapFirestoreValue)
  if ('referenceValue' in value) return value.referenceValue
  return value
}

/** Firestore REST の `fields`({ status: { stringValue: '…' } } の形)を素の値のオブジェクトへ戻す。 */
export function unwrapFirestoreFields(fields) {
  if (!isPlainObject(fields)) return {}
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, unwrapFirestoreValue(value)]))
}

function unwrapFirestoreDocument(document) {
  const id = trimmedString(document.name).split('/').pop() ?? ''
  return { ...(id ? { id } : {}), ...unwrapFirestoreFields(document.fields) }
}

/**
 * 記録の一覧を素のオブジェクトの配列にそろえる。受ける形:
 * 素の配列 / runQuery の返り値([{ document: { name, fields } }, { readTime }]) / 一覧取得の返り値({ documents: [...] })。
 */
export function normalizeRecordList(json) {
  const items = Array.isArray(json) ? json : (isPlainObject(json) && Array.isArray(json.documents) ? json.documents : [])
  const records = []
  for (const item of items) {
    if (!isPlainObject(item)) continue
    if (isPlainObject(item.document)) { records.push(unwrapFirestoreDocument(item.document)); continue }
    if ('readTime' in item && Object.keys(item).every((key) => key === 'readTime' || key === 'skippedResults')) continue
    if (typeof item.name === 'string' && isPlainObject(item.fields)) { records.push(unwrapFirestoreDocument(item)); continue }
    records.push(item)
  }
  return records
}

// ---------------------------------------------------------------------------
// 盤面の読み取り
// ---------------------------------------------------------------------------

function iterateCells(payload) {
  const cells = []
  for (const week of asArray(payload?.boardState?.weeks)) {
    const list = Array.isArray(week) ? week : asArray(week?.cells)
    for (const cell of list) if (isPlainObject(cell)) cells.push(cell)
  }
  return cells
}

/** 机に置かれた生徒(lesson.studentSlots。旧形の desk.students も念のため読む)。 */
// snapshot-diff の indexBoardCells と同じキー(diffBoardWeeks の entry も dateKey / slotNumber を持つ)。
function cellKeyOf(cellOrEntry) {
  return `${cellOrEntry.dateKey ?? ''}#${cellOrEntry.slotNumber ?? ''}`
}

function deskStudents(desk) {
  if (!isPlainObject(desk)) return []
  const slots = asArray(desk.lesson?.studentSlots)
  const legacy = asArray(desk.students)
  return [...slots, ...legacy].filter(isPlainObject)
}

function studentKeyOf(entry) {
  const id = trimmedString(entry.managedStudentId)
  if (id) return { key: `id:${id}`, studentId: id }
  const name = trimmedString(entry.name)
  return name ? { key: `name:${name}`, studentId: '' } : null
}

function rosterIds(rows, idOf) {
  return [...new Set(asArray(rows).filter(isPlainObject).map(idOf).filter(Boolean))]
}

function studentRowId(row) {
  return trimmedString(row.managedStudentId) || trimmedString(row.id)
}

function teacherRowId(row) {
  return trimmedString(row.id)
}

/**
 * 盤面から件数を集める(振替・出自の印・保留・組・同じコマの 2 か所)。
 * ★同じコマの 2 か所の判定は、アプリ側の権威関数 `findDuplicateStudentInCellByKey`
 *   (src/components/schedule-board/ScheduleBoardScreen.tsx・INV-12)の簡略な写し。権威側の判定が変わったら追随する。
 * ★保留(templatePendingDesks)の下段と別の机の上段の重複(docs/spec-template-conflict-v2.md §2-2)は数えない(対象外)。
 *   ここで見るのは盤面の机に置かれた生徒(lesson.studentSlots)同士だけ。
 */
export function summarizeBoard(payload) {
  const duplicates = []
  let makeups = 0
  let originTemplate = 0
  let originManual = 0
  for (const cell of iterateCells(payload)) {
    const seen = new Map()
    asArray(cell.desks).forEach((desk, deskIndex) => {
      const deskStudentKeys = new Set()
      for (const entry of deskStudents(desk)) {
        if (entry.lessonType === 'makeup') makeups += 1
        if (entry.origin === 'template') originTemplate += 1
        else if (entry.origin === 'manual') originManual += 1
        const ref = studentKeyOf(entry)
        if (!ref || deskStudentKeys.has(ref.key)) continue
        deskStudentKeys.add(ref.key)
        const first = seen.get(ref.key)
        if (first === undefined) {
          seen.set(ref.key, deskIndex)
        } else {
          duplicates.push({ dateKey: String(cell.dateKey ?? ''), slotNumber: Number(cell.slotNumber) || 0, deskNumbers: [first + 1, deskIndex + 1], studentId: ref.studentId })
        }
      }
    })
  }
  const board = isPlainObject(payload?.boardState) ? payload.boardState : {}
  const pending = isPlainObject(board.templatePendingDesks) ? Object.keys(board.templatePendingDesks).length : 0
  const wholeDayPairs = asArray(board.suppressedRegularLessonOccurrences).filter((key) => typeof key === 'string' && key.startsWith(WHOLE_DAY_PAIR_PREFIX)).length
  return { duplicates, makeups, originTemplate, originManual, pending, wholeDayPairs }
}

// ---------------------------------------------------------------------------
// 健診
// ---------------------------------------------------------------------------

/**
 * @param {{ classroomId: string, before: object|null, after: object, saveAttempts?: object[], developerReports?: object[],
 *   knownIssues?: object[], now?: string, windowHours?: number }} input
 * @returns {{ findings: Array<{ severity: 'warn'|'info', code: string, message: string }>, counts: Record<string, number> }}
 */
export function buildBoardHealthReport(input) {
  const classroomId = trimmedString(input.classroomId)
  const before = isPlainObject(input.before) ? input.before : null
  const after = input.after
  const nowMs = parseTime(input.now) ?? Date.now()
  const windowHours = Number.isFinite(input.windowHours) ? input.windowHours : RECENT_WINDOW_HOURS
  const findings = []
  const warn = (code, message) => findings.push({ severity: 'warn', code, message })
  const info = (code, message) => findings.push({ severity: 'info', code, message })

  const afterBoard = summarizeBoard(after)
  const beforeBoard = before ? summarizeBoard(before) : null
  const counts = {}

  // 同じコマに同じ生徒が 2 か所(INV-12)。既知のものは数えない。
  const known = new Set(asArray(input.knownIssues).filter(isPlainObject)
    .filter((issue) => trimmedString(issue.classroomId) === classroomId)
    .map((issue) => `${trimmedString(issue.dateKey)}#${Number(issue.slotNumber)}#${trimmedString(issue.studentId)}`))
  let knownSkipped = 0
  let duplicateCount = 0
  for (const duplicate of afterBoard.duplicates) {
    if (duplicate.studentId && known.has(`${duplicate.dateKey}#${duplicate.slotNumber}#${duplicate.studentId}`)) { knownSkipped += 1; continue }
    duplicateCount += 1
    warn('duplicate-placement', `同じコマに同じ生徒が 2 か所: ${duplicate.dateKey} ${duplicate.slotNumber}限 机${duplicate.deskNumbers[0]}・机${duplicate.deskNumbers[1]} ${duplicate.studentId || '(生徒ID なし)'}`)
  }
  counts.duplicatePlacements = duplicateCount
  counts.knownDuplicatesSkipped = knownSkipped

  // 保留・組・出自の印の件数
  counts.pending = afterBoard.pending
  if (afterBoard.pending > 0) info('pending-count', `テンプレ差分の保留: ${afterBoard.pending} 件`)
  if (beforeBoard) {
    counts.pendingDelta = afterBoard.pending - beforeBoard.pending
    if (counts.pendingDelta !== 0) info('pending-delta', `保留の増減: ${formatSigned(counts.pendingDelta)}(${beforeBoard.pending} → ${afterBoard.pending})`)
  }
  counts.wholeDayPairs = afterBoard.wholeDayPairs
  if (afterBoard.wholeDayPairs > 0) info('whole-day-pair-count', `丸ごと振替の組: ${afterBoard.wholeDayPairs} 件`)
  counts.originTemplate = afterBoard.originTemplate
  counts.originManual = afterBoard.originManual
  counts.originMarks = afterBoard.originTemplate + afterBoard.originManual
  if (counts.originMarks > 0) info('origin-mark-count', `出自の印つきの授業: ${counts.originMarks} 件(テンプレ ${afterBoard.originTemplate}・手入力 ${afterBoard.originManual})`)

  // 名簿・講師
  const afterStudents = rosterIds(after?.students, studentRowId)
  const afterTeachers = rosterIds(after?.teachers, teacherRowId)
  counts.roster = afterStudents.length
  counts.teachers = afterTeachers.length
  if (before) {
    const afterStudentSet = new Set(afterStudents)
    const missingStudents = rosterIds(before.students, studentRowId).filter((id) => !afterStudentSet.has(id))
    if (missingStudents.length > 0) warn('roster-shrink', `名簿から消えた生徒 ${missingStudents.length} 人: ${listIds(missingStudents)}`)
    const afterTeacherSet = new Set(afterTeachers)
    const missingTeachers = rosterIds(before.teachers, teacherRowId).filter((id) => !afterTeacherSet.has(id))
    if (missingTeachers.length > 0) warn('teacher-shrink', `講師一覧から消えた講師 ${missingTeachers.length} 人: ${listIds(missingTeachers)}`)
  }

  // 振替の急減・机の変更数
  counts.makeups = afterBoard.makeups
  if (beforeBoard) {
    const drop = beforeBoard.makeups - afterBoard.makeups
    if (drop > 0 && (drop >= MAKEUP_DROP_MIN || drop / beforeBoard.makeups >= MAKEUP_DROP_RATIO)) {
      warn('makeup-drop', `盤面の振替が減少: ${beforeBoard.makeups} → ${afterBoard.makeups}(-${drop})`)
    }
    // 前後の両方にあるコマ(dateKey#slotNumber)の机の変更だけを数える。保存された weeks は開いた週の分だけ増え、
    // テンプレだけの週は表示範囲の外で間引かれるので、片方にしか無いコマまで数えると週の範囲のずれだけで反応する
    // (2026-11-08 の実データ予行で平日ペアが 562/931/254 件)。片方だけのコマは cellsOnlyInOne に数え、所見にはしない。
    const beforeCellKeys = new Set(iterateCells(before).map(cellKeyOf))
    const afterCellKeys = new Set(iterateCells(after).map(cellKeyOf))
    const sharedCellKeys = new Set([...afterCellKeys].filter((key) => beforeCellKeys.has(key)))
    counts.cellsOnlyInOne = new Set([...beforeCellKeys, ...afterCellKeys]).size - sharedCellKeys.size
    const deskChanges = diffBoardWeeks(before.boardState?.weeks, after?.boardState?.weeks)
      .filter((entry) => entry.scope === 'desk' && sharedCellKeys.has(cellKeyOf(entry)))
      .length
    counts.deskChanges = deskChanges
    if (deskChanges > DESK_CHANGE_BURST) info('desk-change-burst', `机単位の変更が多い: ${deskChanges} 件(目安 ${DESK_CHANGE_BURST})`)
  }

  // 保存記録(errorMessage は読まない)
  if (Array.isArray(input.saveAttempts)) {
    const recent = input.saveAttempts.filter(isPlainObject).filter((attempt) => isWithinWindow(attempt.savedAt, nowMs, windowHours))
    counts.saves = recent.filter((attempt) => attempt.status === 'verified').length
    counts.savesStarted = recent.filter((attempt) => attempt.status === 'started').length
    const failed = recent.filter((attempt) => SAVE_FAILED_STATUSES.includes(attempt.status))
    counts.saveFailures = failed.length
    for (const attempt of failed) warn('save-failed', `保存の失敗: ${attempt.status}(${trimmedString(attempt.savedAt) || '時刻不明'})`)
    if (counts.saves === 0) info('save-none', `直近 ${windowHours} 時間に成功した保存がない(開始のまま ${counts.savesStarted} 件)`)
  }

  // 利用者報告(本文は読まない。確認リストとテストは除く)
  if (Array.isArray(input.developerReports)) {
    const reports = input.developerReports.filter(isPlainObject)
      .filter((report) => !trimmedString(report.classroomId) || trimmedString(report.classroomId) === classroomId)
      .filter((report) => report.isVerificationChecklist !== true && report.isTest !== true)
      .filter((report) => isWithinWindow(report.reportedAt, nowMs, windowHours))
    counts.userReports = reports.length
    for (const report of reports) {
      const reportId = trimmedString(report.reportId) || trimmedString(report.id) || '(ID なし)'
      const category = trimmedString(report.category) || '種類なし'
      warn('user-report', `利用者報告: ${reportId} ${category}${report.isAutoErrorReport === true ? '(自動エラー報告)' : ''}`)
    }
  }

  return { findings, counts }
}

const COUNT_SUMMARY_FIELDS = [
  ['saves', '保存'],
  ['pending', '保留'],
  ['wholeDayPairs', '組'],
  ['originMarks', '出自の印'],
  ['roster', '名簿'],
  ['teachers', '講師'],
]

/** 日本語の報告文。1 行目は件数の要約、続いて warn → info の順に 1 所見 1 行。所見が無ければ「異常なし」1 行。 */
export function formatBoardHealthText(report, options = {}) {
  const label = trimmedString(options.classroomLabel) || '教室'
  const summary = COUNT_SUMMARY_FIELDS.map(([key, name]) => `${name} ${typeof report.counts[key] === 'number' ? report.counts[key] : '-'}`).join(' / ')
  const lines = [`■ ${label}: ${summary}`]
  const warns = report.findings.filter((finding) => finding.severity === 'warn')
  const infos = report.findings.filter((finding) => finding.severity !== 'warn')
  if (warns.length === 0 && infos.length === 0) {
    lines.push('異常なし')
    return lines.join('\n')
  }
  for (const finding of warns) lines.push(`[warn] ${finding.code}: ${finding.message}`)
  for (const finding of infos) lines.push(`[info] ${finding.code}: ${finding.message}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 引数と実行
// ---------------------------------------------------------------------------

const VALUE_OPTIONS = {
  '--classroom': 'classroomId',
  '--save-attempts': 'saveAttemptsFile',
  '--reports': 'reportsFile',
  '--known': 'knownFile',
  '--now': 'now',
}

export function parseArgs(argv) {
  const options = { files: [], classroomId: '', saveAttemptsFile: '', reportsFile: '', knownFile: '', now: '', json: false, help: false, unknown: [], missingValue: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg in VALUE_OPTIONS) {
      const value = argv[++index]
      if (typeof value === 'string') options[VALUE_OPTIONS[arg]] = value.trim()
      else options.missingValue.push(arg)
      continue
    }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg.startsWith('--')) { options.unknown.push(arg); continue }
    options.files.push(arg)
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (options.files.length !== 2) errors.push(`前のファイル(無ければ -)と後のファイルを指定してください(指定 ${options.files.length} 個)。`)
  if (options.files[1] === '-') errors.push('後のファイルは省略できません。')
  for (const flag of options.missingValue ?? []) errors.push(`${flag} に値がありません。`)
  if (!options.classroomId && !(options.missingValue ?? []).includes('--classroom')) errors.push('--classroom を指定してください。')
  if (options.now && parseTime(options.now) === null) errors.push('--now は ISO 形式の日時で指定してください。')
  for (const flag of options.unknown ?? []) errors.push(`知らないオプションです: ${flag}`)
  return errors
}

function readRecordFile(file) {
  return file ? normalizeRecordList(decodeJsonBuffer(readFileSync(file))) : undefined
}

function readSnapshotFile(file, classroomId) {
  const doc = decodeJsonBuffer(readFileSync(file))
  return extractClassroomSnapshot(doc, { classroomId, file: basename(file) })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  try {
    const [beforeFile, afterFile] = options.files
    const before = beforeFile === '-' ? null : readSnapshotFile(beforeFile, options.classroomId)
    const after = readSnapshotFile(afterFile, options.classroomId)
    for (const snapshot of [before, after]) {
      if (snapshot && snapshot.classroomId && snapshot.classroomId !== options.classroomId) {
        throw new Error(`${snapshot.file} は教室 ${snapshot.classroomId} のデータです(--classroom ${options.classroomId} と一致しません)。`)
      }
    }
    const report = buildBoardHealthReport({
      classroomId: options.classroomId,
      before: before?.payload ?? null,
      after: after.payload,
      saveAttempts: readRecordFile(options.saveAttemptsFile),
      developerReports: readRecordFile(options.reportsFile),
      knownIssues: readRecordFile(options.knownFile),
      now: options.now || undefined,
    })
    console.log(options.json ? JSON.stringify(report, null, 2) : formatBoardHealthText(report, { classroomLabel: options.classroomId }))
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

// import しただけでは何も実行しない(テストから純関数だけを読むため・tools/invoked-directly.mjs)。
if (isInvokedDirectly(import.meta.url)) {
  main()
}
