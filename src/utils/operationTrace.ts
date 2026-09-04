// 操作痕跡（「開発者へ報告」ボタンに同梱する、端末内だけの全操作リングバッファ）。
//
// 背景（2026-09-04 オーナー指示）: 室長から「この一ヶ月でバグがあったが忙しくて自分で対処した」と連絡があり、
// 何が起きたか追えなかった。全操作をサーバーへ常時送るのはコスト・ノイズともに見合わないので、
// **全操作は端末内(メモリ＋localStorage)にだけ残し、利用者が「開発者へ報告」を押した時だけ**直近分を
// 報告に同梱してサーバーへ送る。
//
// 設計の要点:
//  - 操作ログ `operationLog.ts`（在庫が減る・記録が消える操作だけをサーバーへ書く監査記録）とは別物。
//    こちらは**盤面が変わる全ての確定(commitWeeks)・undo/redo・保存・別タブからのメッセージ**を、
//    生徒名など人が読める要約で残す。操作ログのイベントもこちらへ写す（1本で時系列を読めるように）。
//  - サーバーへは書かない。報告に同梱されるまでは端末外に出ない。
//  - localStorage にも書いて再読み込みを跨いで残す（「昨日おかしかった」報告にも間に合わせる）。
//    容量は件数上限で抑える。読めなくても動作に影響しない（try/catch で握る）。
//  - モジュールスコープの単純なバッファ。巨大な ScheduleBoardScreen へ props を通さず記録できる
//    (operationLog.ts と同じ方式)。

import type { DeskCell, SlotCell } from '../components/schedule-board/types'

export type OperationTraceKind =
  /** 盤面の確定（commitWeeks）。summary に変わった机の差分を入れる */
  | 'board-commit'
  /** テンプレ/基本データ反映などの盤面再構築 */
  | 'board-rebuild'
  | 'undo'
  | 'redo'
  /** 手動保存の開始・成功・失敗 */
  | 'save'
  /** 操作ログ(operationLog)に記録された監査イベントの写し */
  | 'operation-event'
  /** 日程表など別タブから届いた postMessage */
  | 'schedule-message'
  /** 画面遷移・教室切替など */
  | 'navigation'
  /** 自動処理（起動時自己修復・QR提出反映など） */
  | 'auto'

export type OperationTraceEntry = {
  /** ISO 時刻（クライアント時計） */
  at: string
  kind: OperationTraceKind
  /** 人が読める1行要約（生徒名など可。端末外へ出るのは報告時のみ） */
  summary: string
}

/** 保持する件数の上限。報告1件に同梱しても Firestore 文書(1MiB)に収まる量にする。 */
export const OPERATION_TRACE_LIMIT = 300
/** 1件の要約の最大長。差分が巨大でも1行に抑える。 */
export const OPERATION_TRACE_SUMMARY_LIMIT = 400
/** 盤面差分で列挙する机の上限。超えた分は「他N件」にまとめる。 */
export const OPERATION_TRACE_DIFF_ITEM_LIMIT = 6
const STORAGE_KEY_PREFIX = 'operation-trace:'

export function appendOperationTrace(
  buffer: OperationTraceEntry[],
  entry: OperationTraceEntry,
  limit: number = OPERATION_TRACE_LIMIT,
): OperationTraceEntry[] {
  const next = [...buffer, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export function buildOperationTraceEntry(kind: OperationTraceKind, summary: string, now: Date = new Date()): OperationTraceEntry {
  const trimmed = summary.replace(/\s+/gu, ' ').trim()
  return {
    at: now.toISOString(),
    kind,
    summary: trimmed.length > OPERATION_TRACE_SUMMARY_LIMIT ? `${trimmed.slice(0, OPERATION_TRACE_SUMMARY_LIMIT - 1)}…` : trimmed,
  }
}

// ---------------------------------------------------------------------------
// 盤面差分の要約（commitWeeks の前後 weeks を比較して「どの机が何から何に変わったか」を1行にする）
// ---------------------------------------------------------------------------

function describeDesk(desk: DeskCell): string {
  const teacher = desk.teacher?.trim() ? desk.teacher.trim() : '講師なし'
  const students = (desk.lesson?.studentSlots ?? [null, null]).map((student, index) => {
    if (!student) {
      const status = desk.statusSlots?.[index]
      if (status) return `[${status.name}${status.subject ? ` ${status.subject}` : ''}${status.moveDestinationDateKey ? ` 移)${status.moveDestinationDateKey}` : ''}]`
      const memo = desk.memoSlots?.[index]
      return memo ? `メモ:${memo}` : '空'
    }
    const marks = [
      student.lessonType,
      student.subject,
      student.makeupSourceLabel ? `振)${student.makeupSourceLabel}` : '',
      student.sameDayMoveSourceLabel ? `移)${student.sameDayMoveSourceLabel}` : '',
      student.noteSuffix ?? '',
    ].filter(Boolean).join(' ')
    return `${student.name}(${marks})`
  })
  return `${teacher}: ${students.join(' / ')}`
}

function indexDesks(weeks: SlotCell[][]): Map<string, { cell: SlotCell; desk: DeskCell; deskIndex: number }> {
  const map = new Map<string, { cell: SlotCell; desk: DeskCell; deskIndex: number }>()
  for (const week of weeks) {
    for (const cell of week) {
      cell.desks.forEach((desk, deskIndex) => {
        map.set(`${cell.dateKey}#${cell.slotNumber}#${deskIndex}`, { cell, desk, deskIndex })
      })
    }
  }
  return map
}

/**
 * 前後の盤面を比較し、変わった机だけを「日付 限 机番: 前 → 後」で列挙した1行要約を返す。
 * 変化が無ければ空文字。比較は表示に効く項目(講師・生徒・出欠・メモ)の文字列化で行う。
 */
export function summarizeWeeksDiff(previousWeeks: SlotCell[][], nextWeeks: SlotCell[][]): string {
  // 痕跡の要約で本体の操作(commitWeeks)を止めない: 想定外の形が来ても例外を外へ出さない。
  try {
    return summarizeWeeksDiffUnsafe(previousWeeks, nextWeeks)
  } catch {
    return '(差分要約に失敗)'
  }
}

function summarizeWeeksDiffUnsafe(previousWeeks: SlotCell[][], nextWeeks: SlotCell[][]): string {
  const before = indexDesks(previousWeeks)
  const after = indexDesks(nextWeeks)
  const keys = new Set<string>([...before.keys(), ...after.keys()])
  const changes: string[] = []
  const sortedKeys = [...keys].sort()
  for (const key of sortedKeys) {
    const prev = before.get(key)
    const next = after.get(key)
    const prevText = prev ? describeDesk(prev.desk) : '(机なし)'
    const nextText = next ? describeDesk(next.desk) : '(机なし)'
    if (prevText === nextText) continue
    const cell = (next ?? prev)!.cell
    const deskIndex = (next ?? prev)!.deskIndex
    changes.push(`${cell.dateKey} ${cell.slotNumber}限 机${deskIndex + 1}: ${prevText} → ${nextText}`)
  }
  if (changes.length === 0) return ''
  const shown = changes.slice(0, OPERATION_TRACE_DIFF_ITEM_LIMIT)
  const rest = changes.length - shown.length
  return `${shown.join(' | ')}${rest > 0 ? ` | 他${rest}件` : ''}`
}

/** commitWeeks 1回分の要約。机の差分に加え、机に現れない付随変更（休日・在庫・補正）も名前で残す。 */
export function summarizeBoardCommitForTrace(input: {
  previousWeeks: SlotCell[][]
  nextWeeks: SlotCell[][]
  holidayChanged?: boolean
  suppressedMakeupChanged?: boolean
  manualMakeupChanged?: boolean
  lectureStockChanged?: boolean
  countAdjustmentsChanged?: boolean
  suppressedRegularChanged?: boolean
}): string {
  const diff = summarizeWeeksDiff(input.previousWeeks, input.nextWeeks)
  const flags = [
    input.holidayChanged ? '休日設定' : '',
    input.suppressedMakeupChanged ? '未消化振替(抑制)' : '',
    input.manualMakeupChanged ? '未消化振替(手動)' : '',
    input.lectureStockChanged ? '未消化講習' : '',
    input.countAdjustmentsChanged ? '回数補正' : '',
    input.suppressedRegularChanged ? '通常授業抑制' : '',
  ].filter(Boolean)
  return [diff || '机の変化なし', flags.length > 0 ? `付随変更: ${flags.join('・')}` : ''].filter(Boolean).join(' / ')
}

// ---------------------------------------------------------------------------
// 教室ごとのバッファ（モジュールスコープ）＋ localStorage への永続化
// ---------------------------------------------------------------------------

const buffersByClassroomId = new Map<string, OperationTraceEntry[]>()
let currentClassroomId = ''

type TraceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function resolveStorage(): TraceStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function storageKey(classroomId: string) {
  return `${STORAGE_KEY_PREFIX}${classroomId}`
}

function loadFromStorage(classroomId: string): OperationTraceEntry[] {
  const storage = resolveStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(storageKey(classroomId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is OperationTraceEntry => Boolean(item) && typeof item === 'object'
        && typeof (item as OperationTraceEntry).at === 'string'
        && typeof (item as OperationTraceEntry).kind === 'string'
        && typeof (item as OperationTraceEntry).summary === 'string')
      .slice(-OPERATION_TRACE_LIMIT)
  } catch {
    return []
  }
}

function persistToStorage(classroomId: string, entries: OperationTraceEntry[]) {
  const storage = resolveStorage()
  if (!storage) return
  try {
    storage.setItem(storageKey(classroomId), JSON.stringify(entries))
  } catch {
    // 容量超過など。痕跡はあくまで補助情報なので握りつぶす。
  }
}

function ensureBuffer(classroomId: string): OperationTraceEntry[] {
  const existing = buffersByClassroomId.get(classroomId)
  if (existing) return existing
  const loaded = loadFromStorage(classroomId)
  buffersByClassroomId.set(classroomId, loaded)
  return loaded
}

/** 現在開いている教室を登録する（App が actingClassroomId の変化で呼ぶ）。 */
export function setOperationTraceClassroomId(classroomId: string | null | undefined): void {
  currentClassroomId = classroomId ?? ''
}

export function getOperationTraceClassroomId(): string {
  return currentClassroomId
}

/**
 * 操作を記録する。教室が未登録なら捨てる（別教室へ混入させない＝操作ログと同じ方針）。
 * 例外は一切外へ出さない（記録の失敗で本体の操作を止めない）。
 */
export function recordOperationTrace(kind: OperationTraceKind, summary: string): OperationTraceEntry | null {
  try {
    if (!currentClassroomId) return null
    const entry = buildOperationTraceEntry(kind, summary)
    const next = appendOperationTrace(ensureBuffer(currentClassroomId), entry)
    buffersByClassroomId.set(currentClassroomId, next)
    persistToStorage(currentClassroomId, next)
    return entry
  } catch {
    return null
  }
}

/** 報告に同梱するために読み出す（バッファは消さない。報告後も痕跡は残す）。 */
export function peekOperationTrace(classroomId: string): OperationTraceEntry[] {
  if (!classroomId) return []
  return [...ensureBuffer(classroomId)]
}

/** アカウント切替時などに呼ぶ（メモリだけ捨てる。localStorage の痕跡は教室キーで分かれているので残してよい）。 */
export function clearOperationTraceMemory(): void {
  buffersByClassroomId.clear()
  currentClassroomId = ''
}

/** テスト用: 指定教室の痕跡をメモリ・localStorage 両方から消す。 */
export function resetOperationTrace(classroomId: string): void {
  buffersByClassroomId.delete(classroomId)
  const storage = resolveStorage()
  if (!storage) return
  try {
    storage.removeItem(storageKey(classroomId))
  } catch {
    // noop
  }
}
