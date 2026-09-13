// 講習履歴（生徒1人の出席・休み・振替・配置の詳細一覧）を返す callable の中身。
//
// 履歴の正本は生徒授業台帳 classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}
// （生成 src/utils/studentLessonLedger.ts、格納 functions/src/lessonLedger.ts）。この台帳は
// **クライアントから直接読めない**（firestore.rules に match が無い）ため、教室メンバー権限を
// 確認したうえでサーバーが読み出して展開する（docs/plan-2026-09-11-five-requests.md §6 / H-2）。
//
// ⚠️ トークン展開の規則は src/utils/lessonHistory.ts と**同じ内容の複製**。
//   functions は rootDir=src の別 TS プロジェクトでアプリ側 src/ を import できないため二重に持つ。
//   どちらかを変えたら必ず両方直すこと。一致は functions/src/lessonLedgerHistory.test.ts が
//   共有 fixture（src/utils/lessonHistory.fixture.ts）で検査する（薄めない・消さない）。
//
// ⚠️ この関数は読み取り専用。Firestore へ一切書き込まない（本番データ保護ルール）。
import { decodeLessonLedgerBody, LESSON_LEDGER_ENCODING } from './lessonLedger'

/** 期間指定の上限（オーナー要望「最大1年」＝ 366 日）。src/utils/lessonHistory.ts と同値。 */
export const LESSON_HISTORY_MAX_DAYS = 366

export type LessonHistoryStatus = 'attended' | 'absent' | 'absentNoMakeup' | 'placed' | 'makeupRemaining'

export const LESSON_HISTORY_STATUS_ORDER: LessonHistoryStatus[] = ['attended', 'absent', 'absentNoMakeup', 'placed', 'makeupRemaining']

export const LESSON_HISTORY_STATUS_LABELS: Record<LessonHistoryStatus, string> = {
  attended: '出席',
  absent: '休み(振替あり)',
  absentNoMakeup: '振無休',
  placed: '予定',
  makeupRemaining: '未消化',
}

/**
 * 授業種別ラベル。正本は src/utils/scheduleViewData.ts の scheduleLessonTypeLabels（キー・値ともに同値）。
 * ⚠️ functions は rootDir=src の別 TS プロジェクトでアプリ側 src/ を import できないため複製。
 *   一致は functions/src/lessonLedgerHistory.test.ts のパリティテストが守る（片方だけ変えない）。
 */
export const LESSON_TYPE_LABELS: Record<string, string> = { extra: '増コマ', regular: '通常', makeup: '振替', special: '講習', trial: '体験' }

export type LessonLedgerHistoryRow = {
  studentId?: string | null
  studentKey?: string | null
  name?: string | null
  subject?: string | null
  makeupBalance?: number | null
  attended?: readonly string[] | null
  absent?: readonly string[] | null
  absentNoMakeup?: readonly string[] | null
  placed?: readonly string[] | null
  makeupRemaining?: readonly string[] | null
}

export type LessonHistoryEvent = {
  date: string
  slot: number | null
  status: LessonHistoryStatus
  statusLabel: string
  lessonType: string
  lessonTypeLabel: string
  subject: string
  studentId: string | null
  studentKey: string
  name: string
  makeupSourceDate: string | null
  reasonLabel: string | null
  token: string
}

export type LessonHistorySummary = {
  attended: number
  absent: number
  absentNoMakeup: number
  placed: number
  makeupRemaining: number
  total: number
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isLessonHistoryDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
}

function resolveLessonTypeLabel(lessonType: string): string {
  if (!lessonType) return ''
  return LESSON_TYPE_LABELS[lessonType] ?? lessonType
}

function toSlotNumber(raw: string): number | null {
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseLessonLedgerToken(token: string, status: LessonHistoryStatus): {
  date: string
  slot: number | null
  lessonType: string
  makeupSourceDate: string | null
  reasonLabel: string | null
} {
  const [head = '', second = '', third = ''] = String(token ?? '').split('|')
  const hashIndex = head.indexOf('#')
  const date = hashIndex >= 0 ? head.slice(0, hashIndex) : head
  const slot = toSlotNumber(hashIndex >= 0 ? head.slice(hashIndex + 1) : '')
  if (status === 'makeupRemaining') {
    return { date, slot, lessonType: '', makeupSourceDate: null, reasonLabel: second || null }
  }
  return {
    date,
    slot,
    lessonType: second,
    makeupSourceDate: status === 'absent' || status === 'placed' ? (third || null) : null,
    reasonLabel: null,
  }
}

export function parseLessonLedgerTokens(row: LessonLedgerHistoryRow): LessonHistoryEvent[] {
  const subject = row.subject ?? ''
  const studentKey = row.studentKey ?? ''
  const name = row.name ?? ''
  const studentId = row.studentId ?? null
  const events: LessonHistoryEvent[] = []
  const tokensByStatus: Array<[LessonHistoryStatus, readonly string[] | null | undefined]> = [
    ['attended', row.attended],
    ['absent', row.absent],
    ['absentNoMakeup', row.absentNoMakeup],
    ['placed', row.placed],
    ['makeupRemaining', row.makeupRemaining],
  ]
  for (const [status, tokens] of tokensByStatus) {
    if (!Array.isArray(tokens)) continue
    for (const token of tokens) {
      if (typeof token !== 'string' || token.length === 0) continue
      const parsed = parseLessonLedgerToken(token, status)
      events.push({
        date: parsed.date,
        slot: parsed.slot,
        status,
        statusLabel: LESSON_HISTORY_STATUS_LABELS[status],
        lessonType: parsed.lessonType,
        lessonTypeLabel: resolveLessonTypeLabel(parsed.lessonType),
        subject,
        studentId,
        studentKey,
        name,
        makeupSourceDate: parsed.makeupSourceDate,
        reasonLabel: parsed.reasonLabel,
        token,
      })
    }
  }
  return sortLessonHistoryEvents(events)
}

export function parseLessonLedgerRows(rows: readonly LessonLedgerHistoryRow[] | null | undefined): LessonHistoryEvent[] {
  if (!Array.isArray(rows)) return []
  const events: LessonHistoryEvent[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    events.push(...parseLessonLedgerTokens(row))
  }
  return sortLessonHistoryEvents(events)
}

export function sortLessonHistoryEvents(events: readonly LessonHistoryEvent[]): LessonHistoryEvent[] {
  return [...events].sort((left, right) => (
    left.date.localeCompare(right.date)
    || (left.slot ?? Number.MAX_SAFE_INTEGER) - (right.slot ?? Number.MAX_SAFE_INTEGER)
    || LESSON_HISTORY_STATUS_ORDER.indexOf(left.status) - LESSON_HISTORY_STATUS_ORDER.indexOf(right.status)
    || left.subject.localeCompare(right.subject, 'ja')
    || left.token.localeCompare(right.token)
  ))
}

export function filterLessonHistory(events: readonly LessonHistoryEvent[], filter: { from?: string; to?: string; statuses?: readonly LessonHistoryStatus[]; lessonTypes?: readonly string[]; subjects?: readonly string[] } = {}): LessonHistoryEvent[] {
  const from = isLessonHistoryDateKey(filter.from) ? filter.from : ''
  const to = isLessonHistoryDateKey(filter.to) ? filter.to : ''
  const statuses = filter.statuses && filter.statuses.length > 0 ? new Set(filter.statuses) : null
  const lessonTypes = filter.lessonTypes && filter.lessonTypes.length > 0 ? new Set(filter.lessonTypes) : null
  const subjects = filter.subjects && filter.subjects.length > 0 ? new Set(filter.subjects) : null
  const filtered = events.filter((event) => {
    if (from && (!event.date || event.date < from)) return false
    if (to && (!event.date || event.date > to)) return false
    if (statuses && !statuses.has(event.status)) return false
    if (lessonTypes && !lessonTypes.has(event.lessonType)) return false
    if (subjects && !subjects.has(event.subject)) return false
    return true
  })
  return sortLessonHistoryEvents(filtered)
}

export function summarizeLessonHistory(events: readonly LessonHistoryEvent[]): LessonHistorySummary {
  const summary: LessonHistorySummary = { attended: 0, absent: 0, absentNoMakeup: 0, placed: 0, makeupRemaining: 0, total: 0 }
  for (const event of events) {
    summary[event.status] += 1
    summary.total += 1
  }
  return summary
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const base = Date.parse(`${dateKey}T00:00:00Z`)
  const moved = new Date(base + days * 24 * 60 * 60 * 1000)
  return `${moved.getUTCFullYear()}-${`${moved.getUTCMonth() + 1}`.padStart(2, '0')}-${`${moved.getUTCDate()}`.padStart(2, '0')}`
}

export function countLessonHistoryDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1
}

/** 期間の正規化（366 日超は終了日基準で丸める・逆転は入れ替え・不正日付は安全側へ）。 */
export function resolveLessonHistoryRange(params: { from?: string; to?: string; today: string; maxDays?: number }): { from: string; to: string; clamped: boolean } {
  const maxDays = params.maxDays ?? LESSON_HISTORY_MAX_DAYS
  const today = isLessonHistoryDateKey(params.today) ? params.today : ''
  let to = isLessonHistoryDateKey(params.to) ? params.to : today
  let from = isLessonHistoryDateKey(params.from) ? params.from : addDaysToDateKey(to, -(maxDays - 1))
  if (from > to) {
    const swap = from
    from = to
    to = swap
  }
  if (countLessonHistoryDays(from, to) > maxDays) {
    return { from: addDaysToDateKey(to, -(maxDays - 1)), to, clamped: true }
  }
  return { from, to, clamped: false }
}

// ---------------------------------------------------------------------------
// callable 本体（Firestore アクセスは呼び出し側から注入してテスト可能にする）
// ---------------------------------------------------------------------------

export type LessonLedgerDayDocLike = {
  dateKey?: unknown
  savedAt?: unknown
  computedAt?: unknown
  updatedBy?: unknown
  dataEncoding?: unknown
  data?: unknown
  rows?: unknown
}

/**
 * `to` 以前で最新の台帳日付を選ぶ（保存が無い日は文書が無いので「その日以前で最新」を使う）。
 * 本番経路（index.ts）は同じ規則を Firestore クエリ（documentId() <= to を desc で 1 件）で行う。
 * こちらは一覧をすでに持っている呼び出し側（ツール・テスト）のための同一規則の純関数。
 */
export function selectLessonLedgerDateKey(availableDateKeys: readonly string[], to: string): string | null {
  const candidates = availableDateKeys
    .filter((key) => isLessonHistoryDateKey(key) && key <= to)
    .sort()
  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

/** 「to 以前で最新」を探すときに読む候補件数（先頭が不正な ID でも数件見て最初の有効な物を使う）。 */
export const LATEST_LEDGER_CANDIDATE_LIMIT = 5

/** Firestore の Query が持つ連鎖 API のうち、ここで使う 2 つだけを表す（CollectionReference.where は Query を返す）。 */
export type LedgerQueryChain<Q> = {
  orderBy(field: string, direction: 'desc'): Q
  limit(count: number): Q
}
export type LedgerCollectionLike<Q> = {
  where(field: string, op: '<=', value: string): Q
}

/**
 * 「`to` 以前で最新の台帳文書」を読むクエリを組む（index.ts の loadLatestLedgerDoc が使う・テスト可能な純関数）。
 *
 * ★ 並べ替え・絞り込みは**フィールド `dateKey`**で行う（文書 ID = dateKey と同値・buildLessonLedgerDayDoc が必ず書く）。
 *   文書 ID（`FieldPath.documentId()` = `__name__`）の**降順**は Firestore の自動インデックスに無く、
 *   複合インデックス未作成だと FAILED_PRECONDITION「The query requires an index」で失敗し、クライアントには
 *   汎用の INTERNAL しか届かない（確認リスト v1.5.504 h-2「通常授業履歴を取得できませんでした: INTERNAL」の真因。
 *   2026-09-12 に tools/lesson-history-diagnose.mjs で再現）。単一フィールドは昇順・降順とも自動作成されるので
 *   `dateKey` なら索引の追加デプロイ無しに動く。`__name__` へ戻さないこと（テストで固定）。
 */
export function buildLatestLedgerQuery<Q extends LedgerQueryChain<Q>>(collection: LedgerCollectionLike<Q>, to: string): Q {
  return collection.where('dateKey', '<=', to).orderBy('dateKey', 'desc').limit(LATEST_LEDGER_CANDIDATE_LIMIT)
}

/** 台帳文書の本文を取り出す（gzip+base64 は解凍。壊れていれば空配列）。 */
export function readLessonLedgerRows(doc: LessonLedgerDayDocLike | null | undefined): LessonLedgerHistoryRow[] {
  if (!doc) return []
  if (doc.dataEncoding === LESSON_LEDGER_ENCODING && typeof doc.data === 'string') {
    try {
      const body = decodeLessonLedgerBody(doc.data)
      return Array.isArray(body.rows) ? (body.rows as LessonLedgerHistoryRow[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(doc.rows) ? (doc.rows as LessonLedgerHistoryRow[]) : []
}

/**
 * 対象生徒の行だけ抜き出す。名簿 id（studentId）が正・未管理生徒は在庫キー（studentKey）で引く。
 * ★ studentKey は手動追加だと `manual:` が前置されるので、前置を外した比較も許す。
 */
export function selectLessonLedgerRowsForStudent(rows: readonly LessonLedgerHistoryRow[], studentId: string): LessonLedgerHistoryRow[] {
  const normalized = studentId.replace(/^manual:/, '')
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false
    if (typeof row.studentId === 'string' && row.studentId && row.studentId === normalized) return true
    const key = typeof row.studentKey === 'string' ? row.studentKey.replace(/^manual:/, '') : ''
    return Boolean(key) && key === normalized
  })
}

export type StudentLessonHistoryResponse = {
  classroomId: string
  studentId: string
  studentName: string
  from: string
  to: string
  /** 366 日超で from を丸めたか（画面に「1年分に丸めました」と出すため） */
  clamped: boolean
  /** 実際に読んだ台帳の日付（= その日の最終保存時点の状態。当日の未保存編集は含まれない） */
  ledgerDateKey: string | null
  savedAt: string | null
  computedAt: string | null
  events: LessonHistoryEvent[]
  summary: LessonHistorySummary
  subjects: string[]
  /** 台帳時点の未消化振替（科目ごと） */
  makeupBalanceBySubject: Array<{ subject: string; balance: number }>
}

/** 台帳文書＋期間から応答を組み立てる純関数（callable の中核・Firestore 非依存）。 */
export function buildStudentLessonHistoryResponse(params: {
  classroomId: string
  studentId: string
  range: { from: string; to: string; clamped: boolean }
  doc: LessonLedgerDayDocLike | null
}): StudentLessonHistoryResponse {
  const rows = selectLessonLedgerRowsForStudent(readLessonLedgerRows(params.doc), params.studentId)
  const events = filterLessonHistory(parseLessonLedgerRows(rows), { from: params.range.from, to: params.range.to })
  const subjects = Array.from(new Set(rows.map((row) => row.subject ?? '').filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ja'))
  return {
    classroomId: params.classroomId,
    studentId: params.studentId,
    studentName: rows.find((row) => typeof row.name === 'string' && row.name)?.name ?? '',
    from: params.range.from,
    to: params.range.to,
    clamped: params.range.clamped,
    ledgerDateKey: typeof params.doc?.dateKey === 'string' ? params.doc.dateKey : null,
    savedAt: typeof params.doc?.savedAt === 'string' ? params.doc.savedAt : null,
    computedAt: typeof params.doc?.computedAt === 'string' ? params.doc.computedAt : null,
    events,
    summary: summarizeLessonHistory(events),
    subjects,
    makeupBalanceBySubject: rows
      .map((row) => ({ subject: row.subject ?? '', balance: typeof row.makeupBalance === 'number' ? row.makeupBalance : 0 }))
      .filter((entry) => entry.balance !== 0)
      .sort((left, right) => left.subject.localeCompare(right.subject, 'ja')),
  }
}

export type StudentLessonHistoryRequestInput = {
  workspaceKey: string
  classroomId: string
  studentId: string
  from: string
  to: string
}

/**
 * 入力検証。日付は `YYYY-MM-DD` 以外なら**未指定扱い**（既定の期間へ倒す）で、
 * 必須なのは workspaceKey / classroomId / studentId の 3 つ。
 * 例外の投げ方は呼び出し側（index.ts）の HttpsError に合わせるため、ここでは理由文字列を返す。
 */
export function normalizeStudentLessonHistoryRequest(raw: unknown): { ok: true; value: StudentLessonHistoryRequestInput } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'request.data の形式が不正です。' }
  const data = raw as Record<string, unknown>
  const readRequired = (key: keyof StudentLessonHistoryRequestInput) => (typeof data[key] === 'string' ? String(data[key]).trim() : '')
  const workspaceKey = readRequired('workspaceKey')
  const classroomId = readRequired('classroomId')
  const studentId = readRequired('studentId')
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey は文字列で指定してください。' }
  if (!classroomId) return { ok: false, reason: 'classroomId は文字列で指定してください。' }
  if (!studentId) return { ok: false, reason: 'studentId は文字列で指定してください。' }
  return {
    ok: true,
    value: {
      workspaceKey,
      classroomId,
      studentId,
      from: isLessonHistoryDateKey(data.from) ? String(data.from) : '',
      to: isLessonHistoryDateKey(data.to) ? String(data.to) : '',
    },
  }
}

export type StudentLessonHistoryDeps = {
  /** 教室メンバー権限の確認（index.ts の requireClassroomAccessMember を渡す）。失敗時は例外。 */
  requireAccess: (workspaceKey: string, classroomId: string) => Promise<unknown>
  /** `to` 以前で最新の台帳文書を返す（無ければ null）。読み取りのみ。 */
  loadLatestLedgerDoc: (params: { workspaceKey: string; classroomId: string; to: string }) => Promise<LessonLedgerDayDocLike | null>
  /** 入力エラーの投げ方（index.ts で HttpsError に変換）。 */
  invalidArgument: (message: string) => Error
  /** JST の今日（既定期間の基準）。 */
  todayJst: string
}

/** callable の処理本体。Firestore/権限は deps 経由（テストでは偽物を渡す）。 */
export async function handleGetStudentLessonHistory(rawData: unknown, deps: StudentLessonHistoryDeps): Promise<StudentLessonHistoryResponse> {
  const parsed = normalizeStudentLessonHistoryRequest(rawData)
  if (!parsed.ok) throw deps.invalidArgument(parsed.reason)
  const { workspaceKey, classroomId, studentId, from, to } = parsed.value
  await deps.requireAccess(workspaceKey, classroomId)
  const range = resolveLessonHistoryRange({ from, to, today: deps.todayJst })
  const doc = await deps.loadLatestLedgerDoc({ workspaceKey, classroomId, to: range.to })
  return buildStudentLessonHistoryResponse({ classroomId, studentId, range, doc })
}
