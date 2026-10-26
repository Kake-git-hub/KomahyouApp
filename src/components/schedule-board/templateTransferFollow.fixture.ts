// テンプレ差分反映 × 丸ごと振替のテスト用の盤面（inv06-template-transfer-follow.matrix.test.ts と同じ形・2026-10-21 に共有化）。
// 水 10/7 5限（机 0=田中+A・机 1=鈴木+B）を木 10/8 5限へ移送 → 水は空＋移動元記録、木に振替。行は差し替え可能（同じ曜日の別の時限の行も足せる）。
// テスト専用（本番コードから import しない）。
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings, ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, computeTemplateDiffApplyForBoard, computeWholeDayTransfer, remergeBoardWeeksWithManagedData, resolveDeletedStudentCountAccounting } from './ScheduleBoardScreen'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from './makeupStock'
import { buildTemplateSlotKey, type TemplateDiffSlotFilter } from './templateDefinitionDiff'
import type { TemplatePendingDeskMap } from './templatePendingDesks'
import { appendTemplateTransferMakeupOrigin, removeTemplateTransferMakeupOrigin } from './templateTransferFollow'

export const WEEK_START = '2026-10-05'
export const WEEK_END = '2026-10-11'
export const WED = '2026-10-07'
export const THU = '2026-10-08'
export const EFFECTIVE = WED
export const SLOT = 5
export const WED_CELL = `${WED}_${SLOT}`
export const THU_CELL = `${THU}_${SLOT}`
export const TODAY = new Date('2026-10-01T00:00:00')

export const students: StudentRow[] = [
  { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sD', name: '土屋', displayName: '土屋', email: 'd@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
]
export const teachers: TeacherRow[] = ['田中', '鈴木', '佐藤', '高橋'].map((name, index) => ({
  id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高3' }],
}))
export const row = (id: string, teacherId: string, student1Id = '', student2Id = '', dayOfWeek = 3, extra: Partial<RegularLessonRow> = {}): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id, subject2: student2Id ? '数' : '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek, slotNumber: SLOT, ...extra,
})
export const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: EFFECTIVE, ...extra }) as ClassroomSettings
/** 水 5限: 机 0=田中+A・机 1=鈴木+B。木 5限: 佐藤（講師だけの足場）。 */
export const OLD_ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
export const resolveStudentKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => student.managedStudentId ?? student.name

export function buildWeek(rows: RegularLessonRow[], classroomSettings = settings(), range: { startDate: string; endDate: string } = { startDate: WEEK_START, endDate: WEEK_END }) {
  return buildManagedScheduleCellsForRange({
    range: { ...range, periodValue: '', personId: '' }, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate,
    classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [],
  })
}
export function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], classroomSettings = settings()) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29' })
}
export function balances(weeks: SlotCell[][], rows: RegularLessonRow[], manualAdjustments: Record<string, ManualMakeupOrigin[]>, classroomSettings = settings(), suppressedOrigins: Record<string, ManualMakeupOrigin[]> = {}, templatePendingDesks: TemplatePendingDeskMap | null = null) {
  const entries = buildMakeupStockEntries({ students, teachers, regularLessons: rows, classroomSettings, weeks, manualAdjustments, suppressedOrigins, resolveStudentKey, today: TODAY, templatePendingDesks })
  return Object.fromEntries(entries.map((item) => [item.key, item.balance])) as Record<string, number>
}
export const cellOf = (weeks: SlotCell[][], id: string) => weeks.flat().find((cell) => cell.id === id)!
export const liveIds = (weeks: SlotCell[][], id: string) => cellOf(weeks, id).desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId))

/** 丸ごと振替の実データ形（移動元記録あり）。読み込み時の再マージを通した正規形で返す。 */
export function transferredBoard(rows = OLD_ROWS, classroomSettings = settings(), transfer: { sourceDateKey: string; targetDateKey: string } = { sourceDateKey: WED, targetDateKey: THU }) {
  const week = buildWeek(rows, classroomSettings)
  const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: rows, classroomSettings, weeks: [week], manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
  const result = computeWholeDayTransfer({
    weeks: [week], sourceDateKey: transfer.sourceDateKey, targetDateKey: transfer.targetDateKey, manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {},
    fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, scheduleCountAdjustments: [], students, teachers, regularLessons: rows,
    managedStudentByAnyName: new Map(students.map((student) => [student.name, student])), resolveDisplayName: (name: string) => name, resolveStockId: resolveStudentKey,
    ledgerOriginDatesByKey, leaveSourceRestMarkers: true,
  })
  if (result.status !== 'transferred') throw new Error(result.message)
  const weeks = remerge(result.nextWeeks, rows, result.nextSuppressedRegularLessonOccurrences, classroomSettings)
  return { weeks, suppressed: result.nextSuppressedRegularLessonOccurrences, ledgers: result.nextManualMakeupAdjustments, scheduleCountAdjustments: result.nextScheduleCountAdjustments }
}

export type SaveOptions = { scheduleCountAdjustments?: readonly ScheduleCountAdjustmentEntry[]; classroomSettings?: ClassroomSettings; slotFilter?: TemplateDiffSlotFilter | null; manualMakeupAdjustments?: Record<string, ManualMakeupOrigin[]>; suppressedMakeupOrigins?: Record<string, ManualMakeupOrigin[]>; effectiveStartDate?: string; templatePendingDesks?: TemplatePendingDeskMap; previousRegularLessons?: readonly RegularLessonRow[] }
export function save(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], options: SaveOptions = {}) {
  return computeTemplateDiffApplyForBoard({
    weeks, scheduleCountAdjustments: options.scheduleCountAdjustments ?? [], classroomSettings: options.classroomSettings ?? settings(), teachers, students, regularLessons: rows, effectiveStartDate: options.effectiveStartDate ?? EFFECTIVE,
    suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: options.templatePendingDesks ?? {}, createdAt: '2026-10-01T10:00:00.000Z', slotFilter: options.slotFilter, manualMakeupAdjustments: options.manualMakeupAdjustments ?? {},
    suppressedMakeupOrigins: options.suppressedMakeupOrigins,
    previousRegularLessons: options.previousRegularLessons,
  })
}
export function suppressedAfter(suppressed: string[], saved: ReturnType<typeof save>) {
  const removed = new Set(saved.removedSuppressedRegularLessonOccurrences)
  return [...suppressed.filter((key) => !removed.has(key)), ...saved.addedSuppressedRegularLessonOccurrences]
}

/** テンプレ定義の差から「変えたコマ」の絞り込みを作る（曜日×時限ごとに生徒×科目の並びが違えば変えたコマ。差が無ければ全コマ＝undefined）。 */
export function slotFilterBetween(previousRows: readonly RegularLessonRow[], nextRows: readonly RegularLessonRow[]): TemplateDiffSlotFilter | undefined {
  const signature = (rows: readonly RegularLessonRow[]) => {
    const bySlot = new Map<string, string[]>()
    for (const item of rows) {
      const key = buildTemplateSlotKey(item.dayOfWeek, item.slotNumber)
      bySlot.set(key, [...(bySlot.get(key) ?? []), `${item.teacherId}:${item.student1Id}/${item.subject1}:${item.student2Id}/${item.subject2}`].sort())
    }
    return bySlot
  }
  const before = signature(previousRows)
  const after = signature(nextRows)
  const changed = new Set<string>()
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(key) ?? []) !== JSON.stringify(after.get(key) ?? [])) changed.add(key)
  }
  return changed.size > 0 ? { slotKeys: changed } : undefined
}

/** 保存本体が台帳・補正へ行うことの写し（ScheduleBoardScreen の保存経路と同じ関数）。 */
export type SavedState = {
  weeks: SlotCell[][]
  suppressed: string[]
  ledgers: Record<string, ManualMakeupOrigin[]>
  scheduleCountAdjustments: ScheduleCountAdjustmentEntry[]
  pendingDesks: TemplatePendingDeskMap
}
export function applySaveToState(state: SavedState, saved: ReturnType<typeof save>): SavedState {
  let ledgers = state.ledgers
  for (const removal of saved.manualMakeupOriginRemovals) ledgers = removeTemplateTransferMakeupOrigin(ledgers, removal.stockKey, removal.dateKey, removal.slotNumber)
  for (const addition of saved.manualMakeupOriginAdditions) ledgers = appendTemplateTransferMakeupOrigin(ledgers, `${addition.student.managedStudentId ?? addition.student.name}__${addition.student.subject}`, addition.dateKey, addition.slotNumber)
  let adjustments = state.scheduleCountAdjustments
  for (const target of saved.wholeDayTransferCountAdjustments) adjustments = resolveDeletedStudentCountAccounting(adjustments, target.student, target.dateKey).nextAdjustments
  return { weeks: saved.nextWeeks, suppressed: suppressedAfter(state.suppressed, saved), ledgers, scheduleCountAdjustments: adjustments, pendingDesks: saved.nextPendingDesks }
}
