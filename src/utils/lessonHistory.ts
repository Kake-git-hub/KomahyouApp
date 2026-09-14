// 講習履歴（生徒の出席・休み・振替・配置の詳細一覧）の表示用パーサ。
//
// 正本データは生徒授業台帳 `classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}`
// （生成は src/utils/studentLessonLedger.ts、格納は functions/src/lessonLedger.ts）。
// 台帳は「生徒×科目の1行 × 状態ごとのトークン配列」という保存効率優先の形なので、
// 画面・ツールで扱うには **日付順のイベント列** へ展開する必要がある。その展開をここに一本化する
// （docs/plan-2026-09-11-five-requests.md §6 テーマ5 / H-1）。
//
// ⚠️ トークン書式は studentLessonLedger.ts の buildToken が正本。片方だけ変えないこと。
//   attended / absent / absentNoMakeup / placed … `YYYY-MM-DD#限|授業種別|振替元日|振替元限`
//     （2026-09-14 から。旧トークンは attended / absentNoMakeup に振替元日が無く、どれも振替元限が無い＝どちらも読める）
//   makeupRemaining           … `YYYY-MM-DD#限|理由ラベル`（3番目は授業種別ではなく理由）
//   末尾の空欄は buildToken が落とすため、`|` 以降が無いこともある（限も空になり得る）。
//
// ⚠️ 同じ展開規則が functions/src/lessonLedgerHistory.ts にも複製されている
//   （functions は rootDir=src の別 TS プロジェクトで src/ を import できないため）。
//   どちらかを変えたら必ず両方直す。両者の一致は lessonHistory.fixture.ts を使った
//   functions/src/lessonLedgerHistory.test.ts のパリティテストが守る。
import { scheduleLessonTypeLabels } from './scheduleViewData'

/** 期間指定の上限（オーナー要望「最大1年」＝ 366 日。うるう年でも1年が入る）。 */
export const LESSON_HISTORY_MAX_DAYS = 366

export type LessonHistoryStatus = 'attended' | 'absent' | 'absentNoMakeup' | 'placed' | 'makeupRemaining'

/** 表示順（同じ日・同じ限の中での並び）。 */
export const LESSON_HISTORY_STATUS_ORDER: LessonHistoryStatus[] = ['attended', 'absent', 'absentNoMakeup', 'placed', 'makeupRemaining']

export const LESSON_HISTORY_STATUS_LABELS: Record<LessonHistoryStatus, string> = {
  attended: '出席',
  absent: '休み(振替あり)',
  absentNoMakeup: '振無休',
  placed: '予定',
  makeupRemaining: '未消化',
}

/** 台帳 1 行のうち、履歴展開に必要な部分だけ（サーバー JSON をそのまま渡せるよう全て省略可）。 */
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
  /** `YYYY-MM-DD`（不正なトークンは空文字） */
  date: string
  /** 限（台帳に限が無いトークンは null） */
  slot: number | null
  status: LessonHistoryStatus
  statusLabel: string
  /** 授業種別の生値（regular / makeup / special / extra / trial・不明は空文字） */
  lessonType: string
  /** 授業種別の日本語（通常 / 振替 / 講習 …・不明は生値） */
  lessonTypeLabel: string
  subject: string
  studentId: string | null
  studentKey: string
  name: string
  /** 振替元日（振替元を持つコマのみ・無ければ null）。★2026-09-14 から出席・振無休にも付く */
  makeupSourceDate: string | null
  /** 未消化の理由ラベル（makeupRemaining のみ・無ければ null） */
  reasonLabel: string | null
  /** 元トークン（デバッグ・重複判定用） */
  token: string
  /** 振替元（日付・限）。振替元日が自分の日と違うコマだけ。限は台帳に無ければ突き合わせた休みの限・それも無ければ null */
  makeupOrigin: { date: string; slot: number | null } | null
  /** 休み → 振替先（日付・限）。振替をさらに休んだら、その休みには次の振替先が付く */
  makeupDestination: { date: string; slot: number | null } | null
  /** 休みの振替がまだ置かれず、未消化に残っている */
  makeupPending: boolean
  /** 状態欄の表示（例: 「休み（振替先 9/30 5限）」）。振替元・振替先・未消化を 1 つにまとめた文字列 */
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

export function resolveLessonTypeLabel(lessonType: string): string {
  if (!lessonType) return ''
  return scheduleLessonTypeLabels[lessonType] ?? lessonType
}

function toSlotNumber(raw: string): number | null {
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** 1 トークンを展開する。状態によって 3 番目の意味が違う点に注意（上部コメント参照）。 */
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
    // 未消化の元コマは `日付#限|理由ラベル`。授業種別は台帳に無い。
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

/** 生徒×科目の台帳 1 行 → 日付順のイベント配列。 */
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

/** 複数行（同じ生徒の全科目など）をまとめて展開する。 */
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
    // 限が無いトークン（未消化の元コマなど）は同じ日の末尾へ。
    || (left.slot ?? Number.MAX_SAFE_INTEGER) - (right.slot ?? Number.MAX_SAFE_INTEGER)
    || LESSON_HISTORY_STATUS_ORDER.indexOf(left.status) - LESSON_HISTORY_STATUS_ORDER.indexOf(right.status)
    || left.subject.localeCompare(right.subject, 'ja')
    || left.token.localeCompare(right.token)
  ))
}

export type LessonHistoryFilter = {
  /** 開始日（含む）。空なら下限なし。 */
  from?: string
  /** 終了日（含む）。空なら上限なし。 */
  to?: string
  statuses?: readonly LessonHistoryStatus[]
  /** 授業種別の生値（regular / makeup / special …）。 */
  lessonTypes?: readonly string[]
  subjects?: readonly string[]
}

/** 期間・種別で絞り込む（並びは日付順を維持）。 */
export function filterLessonHistory(events: readonly LessonHistoryEvent[], filter: LessonHistoryFilter = {}): LessonHistoryEvent[] {
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

/**
 * callable `getStudentLessonHistory` の応答（H-2）。
 * ⚠️ 正本は functions/src/lessonLedgerHistory.ts の同名型。**サーバーが増やしたらここも増やす**
 *   （functions はアプリ側 src/ を import できないため型も二重に持つ）。
 */
export type StudentLessonHistoryResponse = {
  classroomId: string
  studentId: string
  studentName: string
  from: string
  to: string
  /** 366 日超で from を丸めたか。 */
  clamped: boolean
  /** 実際に読んだ台帳の日付（= その日の最終保存時点。当日の未保存編集は含まれない）。 */
  ledgerDateKey: string | null
  savedAt: string | null
  computedAt: string | null
  events: LessonHistoryEvent[]
  summary: LessonHistorySummary
  subjects: string[]
  makeupBalanceBySubject: Array<{ subject: string; balance: number }>
}

// ---------------------------------------------------------------------------
// 期間の丸め（最大 366 日）
// ---------------------------------------------------------------------------

function addDaysToDateKey(dateKey: string, days: number): string {
  const base = Date.parse(`${dateKey}T00:00:00Z`)
  const moved = new Date(base + days * 24 * 60 * 60 * 1000)
  return `${moved.getUTCFullYear()}-${`${moved.getUTCMonth() + 1}`.padStart(2, '0')}-${`${moved.getUTCDate()}`.padStart(2, '0')}`
}

/** 2 つの日付キーの間の日数（両端を含む本数）。 */
export function countLessonHistoryDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1
}

/**
 * 入力された期間を正規化する。
 * - `to` が不正なら `today`、`from` が不正なら「to から 1 年前」。
 * - **逆転していたら入れ替える**（別タブ埋め込みJSの clampLessonHistoryRange と同じ規則。
 *   片方だけ変えないこと）。
 * - **366 日を超えたら from を切り上げる**（終了日を基準に直近 366 日へ丸める・上限超過でエラーにしない）。
 */
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
  const span = countLessonHistoryDays(from, to)
  if (span > maxDays) {
    return { from: addDaysToDateKey(to, -(maxDays - 1)), to, clamped: true }
  }
  return { from, to, clamped: false }
}
