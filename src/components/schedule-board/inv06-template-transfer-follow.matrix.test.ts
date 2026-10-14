// ============================================================================
// INV-06 / INV-12 / INV-03 マトリクス: テンプレの生徒の増減を丸ごと振替・休日の振替に追従させる保存（Q40・Issue #75 段 2・2026-10-14）
//
// 保証文（docs/spec-invariants.md INV-06）: テンプレ保存そのものでは未消化在庫は増減しない。唯一の例外＝丸ごと振替した日（振替元）に足した生徒を
// 振替先へ置けず、その日が休日でないときの未消化 origin 1 件（保存が台帳へ積む）。外した生徒の根拠を失った振替を机から外す処理は在庫中立。
// INV-12: 置き先で同じ生徒が同じコマに 2 か所にならない。INV-03: 保存結果は再マージの不動点。
//
// 盤面は丸ごと振替の実データ形（computeWholeDayTransfer）から作る: 水 10/7 5限（机 0=田中+A・机 1=鈴木+B）を木 10/8 5限へ移送 → 水は空＋移動元記録、木に振替。
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { appendTemplateTransferMakeupOrigin, buildManagedOccurrenceKey, buildManagedScheduleCellsForRange, computeTemplateDiffApplyForBoard, computeWholeDayTransfer, remergeBoardWeeksWithManagedData, removeMakeupOrigin } from './ScheduleBoardScreen'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from './makeupStock'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { TEMPLATE_TRANSFER_STOCK_REASON } from './templateTransferFollow'

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const WED = '2026-10-07'
const THU = '2026-10-08'
const EFFECTIVE = WED
const SLOT = 5
const WED_CELL = `${WED}_${SLOT}`
const THU_CELL = `${THU}_${SLOT}`
const TODAY = new Date('2026-10-01T00:00:00')

const students: StudentRow[] = [
  { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 'sD', name: '土屋', displayName: '土屋', email: 'd@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
]
const teachers: TeacherRow[] = ['田中', '鈴木', '佐藤'].map((name, index) => ({
  id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
}))
const row = (id: string, teacherId: string, student1Id = '', student2Id = '', dayOfWeek = 3, extra: Partial<RegularLessonRow> = {}): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id, subject2: student2Id ? '数' : '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek, slotNumber: SLOT, ...extra,
})
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: EFFECTIVE, ...extra }) as ClassroomSettings
const OLD_ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
const resolveStudentKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => student.managedStudentId ?? student.name
/** 振替先の机の生徒 2 の席を埋める手動追加の通常授業（根拠を失った振替ではない＝消えない）。 */
const MANUAL_D: StudentEntry = { id: 'sD_manual', name: '土屋', managedStudentId: 'sD', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true }
function fillSeat2WithManual(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => (cell.id !== THU_CELL ? cell : {
    ...cell,
    desks: cell.desks.map((desk, index) => (index !== 0 || !desk.lesson ? desk : { ...desk, lesson: { ...desk.lesson, studentSlots: [desk.lesson.studentSlots[0], MANUAL_D] as [StudentEntry | null, StudentEntry | null] } })),
  })))
}

function buildWeek(rows: RegularLessonRow[], classroomSettings = settings()) {
  return buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' }, fallbackStartDate: WEEK_START, fallbackEndDate: WEEK_END,
    classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [],
  })
}
function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], classroomSettings = settings()) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29' })
}
function balances(weeks: SlotCell[][], rows: RegularLessonRow[], manualAdjustments: Record<string, ManualMakeupOrigin[]>, classroomSettings = settings()) {
  const entries = buildMakeupStockEntries({ students, teachers, regularLessons: rows, classroomSettings, weeks, manualAdjustments, resolveStudentKey, today: TODAY })
  return Object.fromEntries(entries.map((item) => [item.key, item.balance])) as Record<string, number>
}
const cellOf = (weeks: SlotCell[][], id: string) => weeks.flat().find((cell) => cell.id === id)!
const liveIds = (weeks: SlotCell[][], id: string) => cellOf(weeks, id).desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId))

/** 丸ごと振替の実データ形（移動元記録あり）。読み込み時の再マージを通した正規形で返す。 */
function transferredBoard(rows = OLD_ROWS, classroomSettings = settings(), transfer: { sourceDateKey: string; targetDateKey: string } = { sourceDateKey: WED, targetDateKey: THU }) {
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
  return { weeks, suppressed: result.nextSuppressedRegularLessonOccurrences, ledgers: result.nextManualMakeupAdjustments }
}

function save(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], options: { classroomSettings?: ClassroomSettings; slotFilter?: Parameters<typeof computeTemplateDiffApplyForBoard>[0]['slotFilter']; manualMakeupAdjustments?: Record<string, ManualMakeupOrigin[]>; effectiveStartDate?: string } = {}) {
  return computeTemplateDiffApplyForBoard({
    weeks, classroomSettings: options.classroomSettings ?? settings(), teachers, students, regularLessons: rows, effectiveStartDate: options.effectiveStartDate ?? EFFECTIVE,
    suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: {}, createdAt: '2026-10-14T10:00:00.000Z', slotFilter: options.slotFilter, manualMakeupAdjustments: options.manualMakeupAdjustments ?? {},
  })
}
function suppressedAfter(suppressed: string[], saved: ReturnType<typeof save>) {
  const removed = new Set(saved.removedSuppressedRegularLessonOccurrences)
  return [...suppressed.filter((key) => !removed.has(key)), ...saved.addedSuppressedRegularLessonOccurrences]
}
function expectFixpoint(saved: ReturnType<typeof save>, rows: RegularLessonRow[], suppressed: string[], classroomSettings = settings()) {
  const after = suppressedAfter(suppressed, saved)
  const once = remerge(saved.nextWeeks, rows, after, classroomSettings)
  expect(once.flat().map((cell) => cell.desks)).toEqual(saved.nextWeeks.flat().map((cell) => cell.desks))
  expect(remerge(once, rows, after, classroomSettings).flat().map((cell) => cell.desks)).toEqual(saved.nextWeeks.flat().map((cell) => cell.desks))
}

describe('INV-06 × Q40-2: 丸ごと振替した日（振替元）に足した生徒', () => {
  it('振替先の同じ机の空席へ振替として置く: 在庫中立（残数は保存前と同じ）・INV-12（木に 1 か所・水に 0）・移動元記録・−1 なし・再マージの不動点', () => {
    const board = transferredBoard()
    // 新テンプレ: 水 5限 机 0 に C を足す（A と同じ机の生徒 2）
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = save(board.weeks, newRows, board.suppressed)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    expect(thu.desks[0].lesson?.studentSlots.map((student) => student?.managedStudentId)).toEqual(['sA', 'sC'])
    expect(thu.desks[0].lesson?.studentSlots[1]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: WED })
    expect(liveIds(saved.nextWeeks, THU_CELL).filter((id) => id === 'sC')).toHaveLength(1)
    expect(liveIds(saved.nextWeeks, WED_CELL)).toEqual([])
    const wed = cellOf(saved.nextWeeks, WED_CELL)
    expect(wed.desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC', moveDestinationDateKey: THU, moveDestinationSlotNumber: SLOT })
    // 在庫: 置いた振替は在庫中立（C は発生も消化も自分で持つ）。A・B は保存前と同じ。
    const after = balances(saved.nextWeeks, newRows, board.ledgers)
    expect(after['sC__数'] ?? 0).toBe(0)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expectFixpoint(saved, newRows, board.suppressed)
    // 同じテンプレの再保存で二重に置かない（C は抑止キーで次回は「置かなかった」に入らない）
    const again = save(saved.nextWeeks, newRows, suppressedAfter(board.suppressed, saved))
    expect(again.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(liveIds(again.nextWeeks, THU_CELL).filter((id) => id === 'sC')).toHaveLength(1)
  })

  it('振替先の同じ机が両席とも埋まっている: 未消化へ（休日でないので台帳に origin 1 件＝INV-06 の唯一の例外・残数 +1 ちょうど）・−1 なし', () => {
    const board = transferredBoard()
    // 木 5限 机 0 の生徒 2 の席を手動追加 D で埋める（振替先の机が満席）
    const weeks = fillSeat2WithManual(board.weeks)
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(weeks, newRows, board.suppressed)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(1)
    expect(saved.wholeDayTransferStocked[0]).toMatchObject({ reason: 'no-seat', ledger: true, sourceDateKey: WED, sourceSlotNumber: SLOT })
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([expect.objectContaining({ dateKey: WED, slotNumber: SLOT })])
    expect(saved.manualMakeupOriginAdditions[0].student.managedStudentId).toBe('sC')
    expect(liveIds(saved.nextWeeks, THU_CELL).filter((id) => id === 'sC')).toHaveLength(0)
    // 保存が台帳へ積んだ後の残数: C は +1（それ以外は不変）
    const ledgersAfter = { ...board.ledgers, 'sC__数': [...(board.ledgers['sC__数'] ?? []), { dateKey: WED, slotNumber: SLOT }] }
    const after = balances(saved.nextWeeks, newRows, ledgersAfter)
    expect(after['sC__数']).toBe(1)
    expect(after['sA__数'] ?? 0).toBe(0)
    expect(after['sB__数'] ?? 0).toBe(0)
    // 積まなければ 0（例外が無いと授業が消える＝誤減）
    expect(balances(saved.nextWeeks, newRows, board.ledgers)['sC__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, board.suppressed)
  })

  it('振替元が休日設定の日: 休日のコマはテンプレの机が空（Q21-6）なので置く対象にならず、未消化は自動の不足 origin に任せて台帳へは積まない。既に移送済みの A・B の振替と移動元記録は根拠（テンプレ行）があるので消えない', () => {
    const holidaySettings = settings({ holidayDates: [WED] })
    const board = transferredBoard()
    const weeks = fillSeat2WithManual(board.weeks)
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(weeks, newRows, board.suppressed, { classroomSettings: holidaySettings })
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL).sort()).toEqual(['sA', 'sB', 'sD'])
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[0]).toMatchObject({ status: 'moved', managedStudentId: 'sA' })
    // 休日の自動発生で C の未消化は 1（台帳に積まなくても出る）。A・B は移送された振替が自動発生を消化して 0 のまま
    const after = balances(saved.nextWeeks, newRows, board.ledgers, holidaySettings)
    expect(after['sC__数']).toBe(1)
    expect(after['sA__数'] ?? 0).toBe(0)
    expect(after['sB__数'] ?? 0).toBe(0)
  })
})

describe('INV-06 × Q40-1: テンプレから外した生徒の根拠を失った振替', () => {
  it('丸ごと振替で移送された振替を消す: 在庫中立・振替元の移動元記録も消える・机と講師は残る・再マージの不動点', () => {
    const board = transferredBoard()
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = save(board.weeks, newRows, board.suppressed)
    expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(saved.orphanedMakeups[0]).toMatchObject({ cellId: THU_CELL, seatIndex: 0, sourceDateKey: WED, sourceSlotNumber: SLOT })
    expect(liveIds(saved.nextWeeks, THU_CELL)).toEqual(['sB'])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    expect(thu.desks[0].teacher).toBe('田中')
    const wed = cellOf(saved.nextWeeks, WED_CELL)
    expect(wed.desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA')).toBeFalsy()
    expect(wed.desks[1].statusSlots?.[0]).toMatchObject({ status: 'moved', managedStudentId: 'sB' })
    const after = balances(saved.nextWeeks, newRows, board.ledgers)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expectFixpoint(saved, newRows, board.suppressed)
  })

  it('根拠 (b): 振替元に欠席の記録がある振替（欠席由来の在庫）は、テンプレから外しても消えない（残数も不変）', () => {
    // 丸ごと振替ではなく、水 5限の A を欠席にして木 5限 机 0 に振替を置いた形（手で作る）。
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const wedA = cellOf(base, WED_CELL).desks[0].lesson!.studentSlots[0]!
    const absentA: StudentStatusEntry = { id: 'st_a_absent', studentId: wedA.id, sourceManagedLesson: true, name: wedA.name, managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: WED, slotNumber: SLOT, recordedAt: 'x', status: 'absent', sourceLessonId: 'src' }
    const keyA = buildManagedOccurrenceKey(wedA, WED, SLOT)
    const weeks = base.map((week) => week.map((cell) => {
      if (cell.id === WED_CELL) return { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: undefined, statusSlots: [absentA, null] as [StudentStatusEntry | null, StudentStatusEntry | null] })) }
      if (cell.id === THU_CELL) return { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: { id: 'manual_mk', studentSlots: [{ ...wedA, id: 'sA_mk', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' } as StudentEntry, null] as [StudentEntry | null, StudentEntry | null] } })) }
      return cell
    }))
    const normalized = remerge(weeks, OLD_ROWS, [keyA])
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(normalized, OLD_ROWS, {})
    const saved = save(normalized, newRows, [keyA])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
    expect(balances(saved.nextWeeks, newRows, {})['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
  })

  it('範囲（変えたコマ）の外の振替元は触らない: 木 5限だけの絞り込みでは水 5限 由来の振替は消えず、置きもしない', () => {
    const board = transferredBoard()
    const newRows = [row('r0', 't1', '', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(board.weeks, newRows, board.suppressed, { slotFilter: { slotKeys: new Set([buildTemplateSlotKey(4, SLOT)]) } })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(saved.summary.wholeDayTransferPlacedStudents + saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL).sort()).toEqual(['sA', 'sB'])
    expect(cellOf(saved.nextWeeks, WED_CELL)).toBe(cellOf(board.weeks, WED_CELL))
  })
})

describe('INV-06 × Q40 regression-reviewer 監査（2026-10-14・H-1〜H-4・M-2）', () => {
  it('H-1 時限変更: 丸ごと振替した日の生徒を同じ曜日の別の時限へ動かしても、移送済みの振替は根拠あり（日単位）＝消えない・別の時限へ二重に置かない・−1 なし・残数不変', () => {
    const board = transferredBoard()
    // 新テンプレ: A を 水 5限 → 水 3限 へ（B はそのまま）
    const newRows = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = save(board.weeks, newRows, board.suppressed)
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(liveIds(saved.nextWeeks, THU_CELL).sort()).toEqual(['sA', 'sB'])
    expect(liveIds(saved.nextWeeks, `${THU}_3`)).toEqual([])
    expect(liveIds(saved.nextWeeks, `${WED}_3`)).toEqual([])
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[0]).toMatchObject({ status: 'moved', managedStudentId: 'sA' })
    const after = balances(saved.nextWeeks, newRows, board.ledgers)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expectFixpoint(saved, newRows, board.suppressed)
  })

  it('H-3 科目変更: 同じ生徒の科目を変えると「外す＋足す」＝旧科目の振替を外し、新科目を振替先の同じ机へ置く（INV-12・台帳は触らない）', () => {
    const board = transferredBoard()
    const newRows = [row('r0', 't1', 'sA', '', 3, { subject1: '英' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(board.weeks, newRows, board.suppressed)
    expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(saved.orphanedMakeups[0].student).toMatchObject({ managedStudentId: 'sA', subject: '数' })
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    expect(thu.desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '英', lessonType: 'makeup', makeupSourceDate: WED })
    expect(liveIds(saved.nextWeeks, THU_CELL).filter((id) => id === 'sA')).toHaveLength(1)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.subject === '英')).toBe(true)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.subject === '数')).toBe(false)
    const after = balances(saved.nextWeeks, newRows, board.ledgers)
    expect(after['sA__英'] ?? 0).toBe(0)
    expect(after['sA__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, board.suppressed)
  })

  it('H-2 台帳由来の振替: 台帳の origin（手で積んだ未消化）を消化している振替は、テンプレから外しても消えない（消すと origin が再浮上して残数が誤って +1）', () => {
    // 水 5限の A を抑止し（授業なし・記録なし）、台帳に水の origin を手で積み、木 5限 机 0 にその振替を置いた形。
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const wedA = cellOf(base, WED_CELL).desks[0].lesson!.studentSlots[0]!
    const keyA = buildManagedOccurrenceKey(wedA, WED, SLOT)
    const weeks = base.map((week) => week.map((cell) => {
      if (cell.id === WED_CELL) return { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: undefined })) }
      if (cell.id === THU_CELL) return { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: { id: 'manual_mk', studentSlots: [{ ...wedA, id: 'sA_mk', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' } as StudentEntry, null] as [StudentEntry | null, StudentEntry | null] } })) }
      return cell
    }))
    const normalized = remerge(weeks, OLD_ROWS, [keyA])
    const ledger = { 'sA__数': [{ dateKey: WED }] }
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(normalized, OLD_ROWS, ledger)
    const saved = save(normalized, newRows, [keyA], { manualMakeupAdjustments: ledger })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(saved.manualMakeupOriginRemovals).toEqual([])
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
    expect(balances(saved.nextWeeks, newRows, ledger)['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    // 台帳を渡さなければ（根拠 (c) が無ければ）消える＝残数が +1 に動く（監査 H-2 の再現）
    const without = save(normalized, newRows, [keyA])
    expect(without.summary.orphanedMakeupsRemoved).toBe(1)
    expect(balances(without.nextWeeks, newRows, ledger)['sA__数'] ?? 0).toBe((before['sA__数'] ?? 0) + 1)
  })

  it('H-4 後ろ向きの丸ごと振替（木 → 水・反映日は木）: 振替先が反映日より前なので置かず、反映日より前のセルは参照ごと不変（INV-10）。足した生徒は従来どおり Q35-8（置かず −1）', () => {
    const rows = [row('r0', 't1', 'sA', '', 4), row('r1', 't2', 'sB', '', 4), row('r2', 't3', '', '', 3)]
    const board = transferredBoard(rows, settings({ templateFreezeBeforeDate: THU }), { sourceDateKey: THU, targetDateKey: WED })
    expect(liveIds(board.weeks, WED_CELL).sort()).toEqual(['sA', 'sB'])
    const newRows = [row('r0', 't1', 'sA', 'sC', 4), row('r1', 't2', 'sB', '', 4), row('r2', 't3', '', '', 3)]
    const saved = save(board.weeks, newRows, board.suppressed, { classroomSettings: settings({ templateFreezeBeforeDate: THU }), effectiveStartDate: THU })
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(1)
    expect(saved.wholeDayTransferCountAdjustments.map((target) => target.student.managedStudentId)).toEqual(['sC'])
    expect(cellOf(saved.nextWeeks, WED_CELL)).toBe(cellOf(board.weeks, WED_CELL))
    expect(liveIds(saved.nextWeeks, THU_CELL)).toEqual([])
  })

  it('M-2 足す→外す: 置けずに台帳へ積んだ origin（印つき）は、その生徒を次のテンプレ保存で外すと同じ保存が取り下げる＝台帳が元に戻る。手で積んだ origin は残す', () => {
    const board = transferredBoard()
    const weeks = fillSeat2WithManual(board.weeks)
    const rowsWithC = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const first = save(weeks, rowsWithC, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(first.manualMakeupOriginAdditions).toHaveLength(1)
    // 保存本体と同じ形で積む（理由ラベルつき・時限つき）
    const manualOrigin: ManualMakeupOrigin = { dateKey: '2026-10-14' }
    let ledger: Record<string, ManualMakeupOrigin[]> = { ...board.ledgers, 'sC__数': [manualOrigin] }
    for (const addition of first.manualMakeupOriginAdditions) ledger = appendTemplateTransferMakeupOrigin(ledger, `${addition.student.managedStudentId}__${addition.student.subject}`, addition.dateKey, addition.slotNumber)
    expect(ledger['sC__数']).toEqual([{ dateKey: WED, slotNumber: SLOT, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }, manualOrigin])
    expect(balances(first.nextWeeks, rowsWithC, ledger)['sC__数']).toBe(2)
    // 次の保存で C を外す
    const second = save(first.nextWeeks, OLD_ROWS, suppressedAfter(board.suppressed, first), { manualMakeupAdjustments: ledger })
    expect(second.manualMakeupOriginRemovals).toEqual([{ stockKey: 'sC__数', dateKey: WED, slotNumber: SLOT }])
    expect(second.manualMakeupOriginAdditions).toEqual([])
    let ledgerAfter = ledger
    for (const removal of second.manualMakeupOriginRemovals) ledgerAfter = removeMakeupOrigin(ledgerAfter, removal.stockKey, removal.dateKey, removal.slotNumber)
    expect(ledgerAfter['sC__数']).toEqual([manualOrigin])
    expect(balances(second.nextWeeks, OLD_ROWS, ledgerAfter)['sC__数']).toBe(1)
    // C を残したまま別の保存をしても取り下げない
    const keep = save(first.nextWeeks, rowsWithC, suppressedAfter(board.suppressed, first), { manualMakeupAdjustments: ledger })
    expect(keep.manualMakeupOriginRemovals).toEqual([])
  })
})
