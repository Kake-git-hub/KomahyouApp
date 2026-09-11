// 講習履歴（H-3）: 日程表タブ（別タブの生成HTML）と本体（盤面画面）の postMessage 往復を純関数化する。
//
// 経路は「要望・報告」と同じ形（docs/spec-developer-report.md §B）:
//   別タブ → opener へ `schedule-lesson-history-request`
//   本体   → callable getStudentLessonHistory → 送り主(event.source)へ `schedule-lesson-history-result`
// 台帳 lessonLedgerDays は firestore.rules に match が無く**クライアントから直接読めない**ので、
// 本体が中継するのが唯一の経路（docs/plan-2026-09-11-five-requests.md §6）。
//
// ⚠️ ここの文字列（type・フィールド名）は src/utils/scheduleHtml.ts の埋め込みスクリプトと**対で**直すこと。
//   片方だけ変えると別タブが 20 秒タイムアウトして「本体から応答がありません」になる。
import {
  LESSON_HISTORY_STATUS_LABELS,
  isLessonHistoryDateKey,
  resolveLessonTypeLabel,
  type LessonHistoryEvent,
  type LessonHistoryStatus,
  type LessonHistorySummary,
  type StudentLessonHistoryResponse,
} from './lessonHistory'

export const SCHEDULE_LESSON_HISTORY_REQUEST_MESSAGE_TYPE = 'schedule-lesson-history-request'
export const SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE = 'schedule-lesson-history-result'

export type ScheduleLessonHistoryRequest = {
  /** 別タブ側が採番する識別子。古い応答で新しい表示を上書きしないために往復させる。 */
  requestId: string
  /** callable へ渡す生徒キー（`#schedule-person-select` の personId を正規化したもの）。 */
  studentId: string
  /** 期間（`YYYY-MM-DD` 以外は空文字＝未指定。既定期間はサーバーが決める）。 */
  from: string
  to: string
}

/**
 * `#schedule-person-select` の personId を callable の studentId に直す。
 *
 * ★ 確認済み（2026-09-12）: 生徒日程表の person select の option value は
 *   `SerializedStudent.id` ＝ **名簿(基本データ)の生徒 id**（scheduleHtml.ts の syncPersonSelectOptions →
 *   buildStudentPayload の `id: student.id`）。在庫キー（`name:表示名`）が入ることはない。
 *   一方 callable 側 selectLessonLedgerRowsForStudent は studentId / studentKey の両方を見て
 *   `manual:` 前置も外すので、将来 `name:` 形が来ても素通しで正しく引ける。ここでは前後空白だけ落とす。
 */
export function resolveLessonHistoryStudentId(personId: unknown): string {
  return typeof personId === 'string' ? personId.trim() : ''
}

function readDateKey(value: unknown): string {
  return isLessonHistoryDateKey(value) ? String(value) : ''
}

/** 別タブからの要求メッセージを検証する。type が違えば null（他のメッセージを食わない）。 */
export function parseScheduleLessonHistoryRequestMessage(message: unknown): ScheduleLessonHistoryRequest | null {
  if (!message || typeof message !== 'object') return null
  const candidate = message as { type?: unknown; requestId?: unknown; personId?: unknown; from?: unknown; to?: unknown }
  if (candidate.type !== SCHEDULE_LESSON_HISTORY_REQUEST_MESSAGE_TYPE) return null
  return {
    requestId: typeof candidate.requestId === 'string' ? candidate.requestId.slice(0, 80) : '',
    studentId: resolveLessonHistoryStudentId(candidate.personId),
    from: readDateKey(candidate.from),
    to: readDateKey(candidate.to),
  }
}

export type ScheduleLessonHistoryResultMessage =
  | { type: typeof SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE; requestId: string; ok: true; history: StudentLessonHistoryResponse }
  | { type: typeof SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE; requestId: string; ok: false; message: string }

export function buildScheduleLessonHistoryResultMessage(params: {
  requestId: string
  result: { ok: true; history: StudentLessonHistoryResponse } | { ok: false; error: string }
}): ScheduleLessonHistoryResultMessage {
  if (params.result.ok) {
    return { type: SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE, requestId: params.requestId, ok: true, history: params.result.history }
  }
  return { type: SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE, requestId: params.requestId, ok: false, message: params.result.error }
}

/** callable の失敗を利用者向けの 1 文にする（別タブのオーバーレイにそのまま出す）。 */
export function formatLessonHistoryErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const trimmed = raw.trim()
  if (!trimmed) return '講習履歴を取得できませんでした。時間をおいて、もう一度お試しください。'
  return `講習履歴を取得できませんでした: ${trimmed.slice(0, 300)}`
}

// ---------------------------------------------------------------------------
// 応答の整形（callable の戻りは any 相当なので、表示に出す前にここで型を固める）
// ---------------------------------------------------------------------------

const STATUS_KEYS: LessonHistoryStatus[] = ['attended', 'absent', 'absentNoMakeup', 'placed', 'makeupRemaining']

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeEvent(raw: unknown): LessonHistoryEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const status = STATUS_KEYS.includes(entry.status as LessonHistoryStatus) ? (entry.status as LessonHistoryStatus) : null
  if (!status) return null
  const lessonType = toText(entry.lessonType)
  return {
    date: toText(entry.date),
    slot: typeof entry.slot === 'number' && Number.isFinite(entry.slot) ? entry.slot : null,
    status,
    // ラベルはサーバーが付けるが、欠けていればクライアント側の正本（同じ表）で補う。
    statusLabel: toText(entry.statusLabel) || LESSON_HISTORY_STATUS_LABELS[status],
    lessonType,
    lessonTypeLabel: toText(entry.lessonTypeLabel) || resolveLessonTypeLabel(lessonType),
    subject: toText(entry.subject),
    studentId: toNullableText(entry.studentId),
    studentKey: toText(entry.studentKey),
    name: toText(entry.name),
    makeupSourceDate: toNullableText(entry.makeupSourceDate),
    reasonLabel: toNullableText(entry.reasonLabel),
    token: toText(entry.token),
  }
}

function normalizeSummary(raw: unknown, events: LessonHistoryEvent[]): LessonHistorySummary {
  const summary: LessonHistorySummary = { attended: 0, absent: 0, absentNoMakeup: 0, placed: 0, makeupRemaining: 0, total: 0 }
  if (raw && typeof raw === 'object') {
    const entry = raw as Record<string, unknown>
    let hasNumber = false
    for (const key of STATUS_KEYS) {
      const value = entry[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        summary[key] = value
        hasNumber = true
      }
    }
    if (hasNumber) {
      summary.total = typeof entry.total === 'number' && Number.isFinite(entry.total)
        ? entry.total
        : STATUS_KEYS.reduce((total, key) => total + summary[key], 0)
      return summary
    }
  }
  // サーバーが summary を返さなかった場合の保険（表示が空になるより数え直す）。
  for (const event of events) {
    summary[event.status] += 1
    summary.total += 1
  }
  return summary
}

/** callable の戻り（unknown）を表示に使える形へ整える。壊れた要素は落とす。 */
export function normalizeStudentLessonHistoryResponse(raw: unknown): StudentLessonHistoryResponse {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const events = (Array.isArray(entry.events) ? entry.events : [])
    .map((item) => normalizeEvent(item))
    .filter((item): item is LessonHistoryEvent => item !== null)
  return {
    classroomId: toText(entry.classroomId),
    studentId: toText(entry.studentId),
    studentName: toText(entry.studentName),
    from: toText(entry.from),
    to: toText(entry.to),
    clamped: entry.clamped === true,
    ledgerDateKey: toNullableText(entry.ledgerDateKey),
    savedAt: toNullableText(entry.savedAt),
    computedAt: toNullableText(entry.computedAt),
    events,
    summary: normalizeSummary(entry.summary, events),
    subjects: (Array.isArray(entry.subjects) ? entry.subjects : []).filter((subject): subject is string => typeof subject === 'string' && subject.length > 0),
    makeupBalanceBySubject: (Array.isArray(entry.makeupBalanceBySubject) ? entry.makeupBalanceBySubject : [])
      .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({ subject: toText(item.subject), balance: typeof item.balance === 'number' && Number.isFinite(item.balance) ? item.balance : 0 })),
  }
}
