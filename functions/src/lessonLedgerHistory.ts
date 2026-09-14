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
  makeupOrigin: { date: string; slot: number | null } | null
  makeupDestination: { date: string; slot: number | null } | null
  makeupPending: boolean
  statusText: string
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
  makeupSourceSlot: number | null
  reasonLabel: string | null
} {
  const [head = '', second = '', third = '', fourth = ''] = String(token ?? '').split('|')
  const hashIndex = head.indexOf('#')
  const date = hashIndex >= 0 ? head.slice(0, hashIndex) : head
  const slot = toSlotNumber(hashIndex >= 0 ? head.slice(hashIndex + 1) : '')
  if (status === 'makeupRemaining') {
    return { date, slot, lessonType: '', makeupSourceDate: null, makeupSourceSlot: null, reasonLabel: second || null }
  }
  return {
    date,
    slot,
    lessonType: second,
    // 振替元日・振替元限は 4 状態とも（旧トークンは出席・振無休に振替元日が無く、どれも限が無い）。
    makeupSourceDate: third || null,
    makeupSourceSlot: third ? toSlotNumber(fourth) : null,
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
        makeupOrigin: parsed.makeupSourceDate && parsed.makeupSourceDate !== parsed.date
          ? { date: parsed.makeupSourceDate, slot: parsed.makeupSourceSlot }
          : null,
        makeupDestination: null,
        makeupPending: false,
        statusText: '',
      })
    }
  }
  linkLessonHistoryMakeups(events)
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

// ---------------------------------------------------------------------------
// 休み ⇄ 振替先・振替元・未消化の突き合わせ（確認リスト その他 2026-09-14「状態に振替元日付コマ、振替先日付コマ、
// 未消化をくっつけて表示」）。台帳 1 行＝生徒×科目なので、行の中だけで引く（期間で絞る前に行う＝振替先が期間外でも出る）。
// ★ src/utils/lessonHistory.ts と functions/src/lessonLedgerHistory.ts で同じ実装（パリティテストが守る）。
// ---------------------------------------------------------------------------

function formatLessonHistorySlotLink(link: { date: string; slot: number | null }): string {
  const matched = /^\d{4}-(\d{2})-(\d{2})$/.exec(link.date)
  const date = matched ? `${Number(matched[1])}/${Number(matched[2])}` : link.date
  return link.slot === null ? date : `${date} ${link.slot}限`
}

const LESSON_HISTORY_STATUS_TEXT_BASES: Record<LessonHistoryStatus, string> = {
  attended: '出席',
  absent: '休み',
  absentNoMakeup: '振無休',
  placed: '予定',
  makeupRemaining: '未消化',
}

/** 状態欄の表示文字列（例: 「休み（振替先 9/30 5限）」「出席（振替元 9/23 5限）」「休み（未消化）」）。 */
export function formatLessonHistoryStatusText(event: Pick<LessonHistoryEvent, 'status' | 'makeupOrigin' | 'makeupDestination' | 'makeupPending' | 'reasonLabel'>): string {
  const parts: string[] = []
  if (event.makeupOrigin) parts.push(`振替元 ${formatLessonHistorySlotLink(event.makeupOrigin)}`)
  if (event.makeupDestination) parts.push(`振替先 ${formatLessonHistorySlotLink(event.makeupDestination)}`)
  if (event.makeupPending) parts.push('未消化')
  if (event.status === 'makeupRemaining' && event.reasonLabel) parts.push(event.reasonLabel)
  const base = LESSON_HISTORY_STATUS_TEXT_BASES[event.status]
  return parts.length > 0 ? `${base}（${parts.join('・')}）` : base
}

/**
 * 同じ生徒×科目のイベント列に、休み→振替先（連鎖: 振替をさらに休んだら次の振替先）・振替→振替元の限・休み→未消化を付ける。
 * - 起点は「振替元を持たない休み」。振替元日（と限）が一致する振替を日付順に 1 対 1 で割り当てる（限が不明なら日付だけで照合）。
 * - 割り当てた振替の振替元の限が台帳に無ければ（旧トークン）、起点の休みの限で補う。
 * - 連鎖の最後が休みで終わり、未消化の元コマ（makeupRemaining）に同じ日付（と限）があれば「未消化」。
 * 渡した配列の要素をその場で書き換える。
 */
export function linkLessonHistoryMakeups(events: readonly LessonHistoryEvent[]): void {
  const sorted = sortLessonHistoryEvents(events)
  const slotMatches = (left: number | null, right: number | null) => left === null || right === null || left === right
  // 講習(special)の在庫と振替の在庫は別物。同じ科目の行に同居するので、種別の系統が同じものだけをつなぐ(レビュー指摘 A-6)。
  const isLecture = (event: LessonHistoryEvent) => event.lessonType === 'special'
  const consumers = sorted.filter((event) => event.makeupOrigin !== null && event.status !== 'makeupRemaining')
  const remaining = sorted.filter((event) => event.status === 'makeupRemaining')
  const usedConsumers = new Set<LessonHistoryEvent>()
  const usedRemaining = new Set<LessonHistoryEvent>()
  const followChain = (start: LessonHistoryEvent, key: { date: string; slot: number | null; lecture: boolean }) => {
    let tail: LessonHistoryEvent | null = start
    while (tail) {
      const next = consumers.find((event) => (
        !usedConsumers.has(event) && isLecture(event) === key.lecture
        && event.makeupOrigin!.date === key.date && slotMatches(event.makeupOrigin!.slot, key.slot)
      ))
      if (!next) break
      usedConsumers.add(next)
      tail.makeupDestination = { date: next.date, slot: next.slot }
      if (next.makeupOrigin!.slot === null && key.slot !== null) next.makeupOrigin = { date: key.date, slot: key.slot }
      tail = next.status === 'absent' ? next : null
    }
    // 未消化の元コマ一覧は振替の在庫だけ(講習の未消化は台帳の別の表)。
    if (!tail || key.lecture) return
    const pending = remaining.find((event) => !usedRemaining.has(event) && event.date === key.date && slotMatches(event.slot, key.slot))
    if (pending) {
      usedRemaining.add(pending)
      tail.makeupPending = true
    }
  }
  for (const origin of sorted) {
    if (origin.status !== 'absent' || origin.makeupOrigin !== null) continue
    followChain(origin, { date: origin.date, slot: origin.slot, lecture: isLecture(origin) })
  }
  // 振替元に休みの記録が無い振替(丸ごと振替・移動)も、振替先を休みにしたら次の振替先・未消化へつなぐ(レビュー指摘 A-3)。
  for (const consumer of consumers) {
    if (usedConsumers.has(consumer)) continue
    usedConsumers.add(consumer)
    if (consumer.status !== 'absent') continue
    followChain(consumer, { date: consumer.makeupOrigin!.date, slot: consumer.makeupOrigin!.slot, lecture: isLecture(consumer) })
  }
  for (const event of events) event.statusText = formatLessonHistoryStatusText(event)
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

/** 「`to` より後で最も古い台帳文書」を読むときの Query 連鎖（フォールバック用・昇順）。 */
export type EarliestLedgerQueryChain<Q> = {
  orderBy(field: string, direction: 'asc'): Q
  limit(count: number): Q
}
export type EarliestLedgerCollectionLike<Q> = {
  where(field: string, op: '>', value: string): Q
}

/**
 * 「`to` より後で最も古い台帳文書」を読むクエリ（`to` 以前の台帳が 1 件も無いときのフォールバック）。
 * ★ 回帰防止(確認リスト その他 2026-09-14「範囲設定してもしなくても無関係」): 台帳は記録開始日より前の文書が無いので、
 *   過去の月（例: 6 月）を指定すると「to 以前で最新」が見つからず、中身があるのに 0 件になっていた。
 *   台帳文書は各日の時点までの記録を丸ごと持つので、直後の文書から期間で絞れば指定期間の記録が出る。
 *   buildLatestLedgerQuery と同じくフィールド dateKey（単一フィールド索引）で並べる。
 */
export function buildEarliestLedgerAfterQuery<Q extends EarliestLedgerQueryChain<Q>>(collection: EarliestLedgerCollectionLike<Q>, to: string): Q {
  return collection.where('dateKey', '>', to).orderBy('dateKey', 'asc').limit(LATEST_LEDGER_CANDIDATE_LIMIT)
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
  /** `to` 以前が無いときに読む「`to` より後で最も古い台帳文書」（無ければ null）。読み取りのみ。 */
  loadEarliestLedgerDocAfter?: (params: { workspaceKey: string; classroomId: string; to: string }) => Promise<LessonLedgerDayDocLike | null>
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
  const ledgerParams = { workspaceKey, classroomId, to: range.to }
  // 過去の期間で「to 以前」の台帳が無ければ、直後の台帳から期間で絞る（記録開始前の月が 0 件にならないように）。
  const doc = (await deps.loadLatestLedgerDoc(ledgerParams))
    ?? (deps.loadEarliestLedgerDocAfter ? await deps.loadEarliestLedgerDocAfter(ledgerParams) : null)
  return buildStudentLessonHistoryResponse({ classroomId, studentId, range, doc })
}
