// テンプレの授業 1 件を「何が説明しているか」を数える共通の純関数（2026-10-21・regression-reviewer H-A/O-1/O-2 対応）。
//
// 使う側は 2 つ:
//   1. 保存本体の Q40-3「精算済み」判定（templateDiffApply.ts `resolveWholeDayTransferSettlement`）＝丸ごと振替した日に置かなかったテンプレの生徒のうち、
//      その日の授業がもう盤面・台帳・補正で説明されている分は、置かず・未消化にせず・−1 もしない。
//   2. 監査（templateLessonAccountingOracle.ts）＝保存後に「説明 < 期待」の授業（無言の消失）が無いか。
// 同じ数え方を 1 か所に置く（判定と監査を別々に書くと、片方だけ正しい形ができる）。
//
// 数え方（生徒×科目×日付 ごと）:
//   regular     … その日に生きている同じ生徒×科目の通常授業（上段＋保留の下段）
//   statusAll   … その日のその生徒×科目の出欠・移動元・休日の記録（1 記録＝1 授業の行方）
//   unmatched   … その日を振替元とする振替（盤面のどこにあっても）のうち、振替元の時限に記録が無いもの（記録と対になる振替は statusAll が既に数えている。
//                 時限不明の振替は対が取れないので unmatched に数える＝説明を多めに見る側）
//   origins     … 在庫の正本がその日に持つ有効な origin。休みの記録と重なる分と、その日を振替元とする振替の数を引く（max(0, origins − absent − その日の振替すべて)）。
//                 在庫の消化（consumeMatchingOriginTokens）は時限が合わなくても同じ日付の origin へフォールバックするので、その日を振替元とする振替があれば
//                 origin は 1 件ずつ食われる＝説明にならない（regression-reviewer O-1・既知の限界 L-5 の検出に必要）
//   countAdjusted … その日の希望回数の補正の純減（−1 の合計から +1 の戻しを引いた分）
//   otherLesson … 同じコマに生きている同じ生徒の別種の授業（振替・講習・手動追加＝Q21-11 が通常授業を置かない正当な理由）
import type { ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { originTokenDateKey, parseOriginSlotNumberFromLabel } from './makeupStock'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

export function buildLessonFactKey(studentId: string, subject: string, dateKey: string) {
  return `${studentId}__${subject}__${dateKey}`
}

export function lessonFactIdentity(student: Pick<StudentEntry, 'managedStudentId' | 'name'> | Pick<StudentStatusEntry, 'managedStudentId' | 'name'>) {
  return student.managedStudentId ?? student.name
}

export type LessonExplanationFacts = {
  regular: ReadonlyMap<string, number>
  statusAll: ReadonlyMap<string, number>
  absent: ReadonlyMap<string, number>
  statusSlots: ReadonlyMap<string, ReadonlySet<number>>
  /** 振替元の鍵 → その日を振替元とする振替の、振替元の時限（不明は null）。 */
  makeupSourceSlots: ReadonlyMap<string, ReadonlyArray<number | null>>
  /** `${生徒}__${日付}__${時限}` → その生徒の通常授業以外の生きている授業数。 */
  otherLessonBySlot: ReadonlyMap<string, number>
}

/** 盤面（上段＋保留の下段）から説明の材料を集める。日付で絞らない（振替先が範囲の外でも振替元の説明になる・O-2）。 */
export function collectLessonExplanationFacts(params: { weeks: SlotCell[][]; pendingDesks?: TemplatePendingDeskMap | null }): LessonExplanationFacts {
  const regular = new Map<string, number>()
  const statusAll = new Map<string, number>()
  const absent = new Map<string, number>()
  const statusSlots = new Map<string, Set<number>>()
  const makeupSourceSlots = new Map<string, Array<number | null>>()
  const otherLessonBySlot = new Map<string, number>()
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  const scanStudent = (student: StudentEntry, cell: SlotCell) => {
    const id = lessonFactIdentity(student)
    if (student.lessonType === 'regular') bump(regular, buildLessonFactKey(id, student.subject, cell.dateKey))
    else bump(otherLessonBySlot, `${id}__${cell.dateKey}__${cell.slotNumber}`)
    if (student.lessonType === 'makeup' && student.makeupSourceDate) {
      const key = buildLessonFactKey(id, student.subject, student.makeupSourceDate)
      makeupSourceSlots.set(key, [...(makeupSourceSlots.get(key) ?? []), parseOriginSlotNumberFromLabel(student.makeupSourceLabel)])
    }
  }
  for (const week of params.weeks) for (const cell of week) {
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) if (student) scanStudent(student, cell)
      for (const entry of desk.statusSlots ?? []) {
        if (!entry) continue
        const key = buildLessonFactKey(lessonFactIdentity(entry), entry.subject, cell.dateKey)
        bump(statusAll, key)
        if (entry.status === 'absent' || entry.status === 'absent-no-makeup') bump(absent, key)
        statusSlots.set(key, (statusSlots.get(key) ?? new Set<number>()).add(cell.slotNumber))
      }
      const pending = params.pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]
      for (const student of pending?.lower.lesson?.studentSlots ?? []) if (student) scanStudent(student, cell)
    }
  }
  return { regular, statusAll, absent, statusSlots, makeupSourceSlots, otherLessonBySlot }
}

/** その日の希望回数の補正の純減（regular）。生徒×科目×日付 → 件数。 */
export function collectCountAdjustmentsByKey(entries: readonly ScheduleCountAdjustmentEntry[]) {
  const sums = new Map<string, number>()
  for (const entry of entries) {
    if (entry.countKind !== 'regular') continue
    const key = buildLessonFactKey(entry.studentKey, entry.subject, entry.dateKey)
    sums.set(key, (sums.get(key) ?? 0) + entry.delta)
  }
  const result = new Map<string, number>()
  for (const [key, sum] of sums) if (sum < 0) result.set(key, -sum)
  return result
}

/** 在庫の正本の origin トークンから、その日の件数。 */
export function countOriginsOnDate(originDatesByKey: Record<string, string[]>, studentId: string, subject: string, dateKey: string) {
  return (originDatesByKey[`${studentId}__${subject}`] ?? []).filter((token) => originTokenDateKey(token) === dateKey).length
}

export type LessonExplanationBreakdown = {
  regular: number
  statusRecord: number
  makeupUnmatched: number
  origin: number
  countAdjusted: number
  otherLessonSameSlot: number
}

/** 生徒×科目×日付 の授業を説明できる件数（内訳つき）。`slotsForOtherLesson` は同じコマの別種の授業を数える時限。 */
export function countLessonExplanations(facts: LessonExplanationFacts, params: {
  studentId: string
  subject: string
  dateKey: string
  origins: number
  countAdjusted: number
  slotsForOtherLesson: Iterable<number>
}): { explained: number; breakdown: LessonExplanationBreakdown } {
  const key = buildLessonFactKey(params.studentId, params.subject, params.dateKey)
  const statusSlots = facts.statusSlots.get(key) ?? new Set<number>()
  const makeupsFromDate = facts.makeupSourceSlots.get(key) ?? []
  const makeupUnmatched = makeupsFromDate.filter((slot) => slot == null || !statusSlots.has(slot)).length
  const absent = facts.absent.get(key) ?? 0
  let otherLessonSameSlot = 0
  for (const slotNumber of params.slotsForOtherLesson) otherLessonSameSlot += facts.otherLessonBySlot.get(`${params.studentId}__${params.dateKey}__${slotNumber}`) ?? 0
  const breakdown: LessonExplanationBreakdown = {
    regular: facts.regular.get(key) ?? 0,
    statusRecord: facts.statusAll.get(key) ?? 0,
    makeupUnmatched,
    origin: Math.max(0, params.origins - absent - makeupsFromDate.length),
    countAdjusted: params.countAdjusted,
    otherLessonSameSlot,
  }
  const explained = breakdown.regular + breakdown.statusRecord + breakdown.makeupUnmatched + breakdown.origin + breakdown.countAdjusted + breakdown.otherLessonSameSlot
  return { explained, breakdown }
}
