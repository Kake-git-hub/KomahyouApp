// 丸ごと振替の付け替え（段 4・docs/spec-template-conflict-v2.md §3）のテスト用の盤面。テスト専用（本番コードから import しない）。
// 水 10/7（D）→ 水 10/14（D'）。テンプレ: 水 5限 机 0=田中+A・机 1=鈴木+B／水 4限 机 0=佐藤（講師だけ）。D' の日も同じ曜日なので同じテンプレを持つ。
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, computeTemplateDiffApplyForBoard, computeWholeDayTransferPair, computeWholeDayTransferPairRelease, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { buildMakeupStockEntries, type ManualMakeupOrigin } from './makeupStock'
import type { TemplatePendingDeskMap } from './templatePendingDesks'

export const D = '2026-10-07'
export const D2 = '2026-10-14'
export const SLOT = 5
export const TODAY = new Date('2026-10-01T00:00:00')
export const CREATED_AT = '2026-10-01T10:00:00.000Z'

export const students: StudentRow[] = [
  { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sD', name: '土屋', displayName: '土屋', email: 'd@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
]
export const teachers: TeacherRow[] = ['田中', '鈴木', '佐藤', '高橋'].map((name, index) => ({
  id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高3' }],
}))
export const row = (id: string, teacherId: string, student1Id = '', student2Id = '', extra: Partial<RegularLessonRow> = {}): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id, subject2: student2Id ? '数' : '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT, ...extra,
})
export const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: D, ...extra }) as ClassroomSettings
/** 水 5限: 机 0=田中+A・机 1=鈴木+B。水 4限: 佐藤（講師だけ）。 */
export const ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', { slotNumber: 4 })]
export const resolveStudentKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => student.managedStudentId ?? student.name

export const WEEKS: Array<[string, string]> = [['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18']]
/** 月をまたぐ組（水 10/28 → 水 11/4）の盤面の週。 */
export const MONTH_CROSS_WEEKS: Array<[string, string]> = [['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']]
export function buildBoard(rows: RegularLessonRow[] = ROWS, classroomSettings = settings(), weeks: Array<[string, string]> = WEEKS): SlotCell[][] {
  return weeks.map(([startDate, endDate]) => buildManagedScheduleCellsForRange({
    range: { startDate, endDate, periodValue: '', personId: '' }, fallbackStartDate: startDate, fallbackEndDate: endDate,
    classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [],
  }))
}
export function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], classroomSettings = settings(), pendingDesks: TemplatePendingDeskMap | null = {}) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29', templateOriginRules: { pendingDesks } })
}
export function pairOf(weeks: SlotCell[][], options: { rows?: RegularLessonRow[]; suppressed?: string[]; pendingDesks?: TemplatePendingDeskMap; classroomSettings?: ClassroomSettings; source?: string; target?: string } = {}) {
  return computeWholeDayTransferPair({
    weeks, sourceDateKey: options.source ?? D, targetDateKey: options.target ?? D2, classroomSettings: options.classroomSettings ?? settings(), teachers, students,
    regularLessons: options.rows ?? ROWS, suppressedRegularLessonOccurrences: options.suppressed ?? [], templatePendingDesks: options.pendingDesks ?? {}, createdAt: CREATED_AT,
  })
}
export function releaseOf(weeks: SlotCell[][], suppressed: string[], options: { rows?: RegularLessonRow[]; pendingDesks?: TemplatePendingDeskMap; classroomSettings?: ClassroomSettings; dateKey?: string } = {}) {
  return computeWholeDayTransferPairRelease({
    weeks, dateKey: options.dateKey ?? D2, classroomSettings: options.classroomSettings ?? settings(), teachers, students,
    regularLessons: options.rows ?? ROWS, suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: options.pendingDesks ?? {}, createdAt: CREATED_AT,
  })
}
export function pairedOrThrow(result: ReturnType<typeof pairOf>) {
  if (result.status !== 'transferred') throw new Error(result.message)
  return result
}
export function save(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], options: { classroomSettings?: ClassroomSettings; templatePendingDesks?: TemplatePendingDeskMap; manualMakeupAdjustments?: Record<string, ManualMakeupOrigin[]>; previousRegularLessons?: RegularLessonRow[] } = {}) {
  return computeTemplateDiffApplyForBoard({
    weeks, scheduleCountAdjustments: [], classroomSettings: options.classroomSettings ?? settings(), teachers, students, regularLessons: rows, effectiveStartDate: D,
    suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: options.templatePendingDesks ?? {}, createdAt: CREATED_AT, manualMakeupAdjustments: options.manualMakeupAdjustments ?? {},
    previousRegularLessons: options.previousRegularLessons ?? ROWS,
  })
}
export function balances(weeks: SlotCell[][], rows: RegularLessonRow[], manualAdjustments: Record<string, ManualMakeupOrigin[]> = {}, classroomSettings = settings(), today = TODAY) {
  const entries = buildMakeupStockEntries({ students, teachers, regularLessons: rows, classroomSettings, weeks, manualAdjustments, resolveStudentKey, today })
  return Object.fromEntries(entries.map((item) => [item.key, item.balance])) as Record<string, number>
}
export const cellAt = (weeks: SlotCell[][], dateKey: string, slotNumber = SLOT) => weeks.flat().find((cell) => cell.dateKey === dateKey && cell.slotNumber === slotNumber)!
export const seatIds = (weeks: SlotCell[][], dateKey: string, slotNumber = SLOT) => cellAt(weeks, dateKey, slotNumber).desks.map((desk) => (desk.lesson?.studentSlots ?? []).map((student) => student?.managedStudentId ?? student?.name ?? null))
export const recordIds = (weeks: SlotCell[][], dateKey: string, slotNumber = SLOT) => cellAt(weeks, dateKey, slotNumber).desks.map((desk) => (desk.statusSlots ?? [null, null]).map((entry) => (entry ? `${entry.status}:${entry.managedStudentId}` : null)))
/** 盤面の比較用（記録の recordedAt など時刻の入る項目を含めてそのまま比べる＝不動点）。 */
export const snapshot = (weeks: SlotCell[][]) => JSON.stringify(weeks)
