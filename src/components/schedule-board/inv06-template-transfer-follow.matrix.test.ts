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
import { buildManagedOccurrenceKey, buildManagedScheduleCellsForRange, computeHolidayReleaseRestoration, computeStudentMove, computeTemplateDiffApplyForBoard, computeWholeDayTransfer, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import { auditTemplateLessonAccounting, describeLessonAccountingViolations } from './templateLessonAccountingOracle'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from './makeupStock'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { appendTemplateTransferMakeupOrigin, removeTemplateTransferMakeupOrigin, TEMPLATE_TRANSFER_STOCK_REASON } from './templateTransferFollow'

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
  // 登録名と表示名が違う生徒（表示名は既定＝登録名の最初の語「江藤」）。盤面の記録は表示名を持つ（監査 M-C）。
  { id: 'sE', name: '江藤 花子', displayName: '', email: 'e@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
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
const MANUAL_E: StudentEntry = { id: 'sE_manual', name: '江藤', managedStudentId: 'sE', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true }
/** 木 5限 の机 0 と机 1 の生徒 2 の席を両方埋める（同じ机も、L-5 (a) の別の机も満席＝未消化になる形・2026-10-21）。 */
function fillSeat2WithManual(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => (cell.id !== THU_CELL ? cell : {
    ...cell,
    desks: cell.desks.map((desk, index) => (!desk.lesson ? desk : { ...desk, lesson: { ...desk.lesson, studentSlots: [desk.lesson.studentSlots[0], index === 0 ? MANUAL_D : MANUAL_E] as [StudentEntry | null, StudentEntry | null] } })),
  })))
}

/** 木 5限 机 1 の生徒 2 の席に C の手動追加の通常授業を置く＝Q40-2 の 'duplicate'（同じコマに同じ生徒が生きている）で未消化（台帳に origin 1 件）になる形（2026-10-25 以降、台帳へ積む形はこれと 'no-target-cell' だけ）。 */
const MANUAL_C: StudentEntry = { id: 'sC_manual', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true }
function withLiveCInTarget(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => (cell.id !== THU_CELL ? cell : {
    ...cell,
    desks: cell.desks.map((desk, index) => (index !== 1 || !desk.lesson ? desk : { ...desk, lesson: { ...desk.lesson, studentSlots: [desk.lesson.studentSlots[0], MANUAL_C] as [StudentEntry | null, StudentEntry | null] } })),
  })))
}

function buildWeek(rows: RegularLessonRow[], classroomSettings = settings(), range: { startDate: string; endDate: string } = { startDate: WEEK_START, endDate: WEEK_END }) {
  return buildManagedScheduleCellsForRange({
    range: { ...range, periodValue: '', personId: '' }, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate,
    classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [],
  })
}
const FRI = '2026-10-09'
const FRI_CELL = `${FRI}_${SLOT}`
/** 指定セルの机（index）の上段を差し替える。 */
function withDesk(weeks: SlotCell[][], cellId: string, deskIndex: number, patch: (desk: SlotCell['desks'][number]) => SlotCell['desks'][number]): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => (cell.id !== cellId ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index !== deskIndex ? desk : patch(desk))) })))
}
function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], classroomSettings = settings()) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29' })
}
function balances(weeks: SlotCell[][], rows: RegularLessonRow[], manualAdjustments: Record<string, ManualMakeupOrigin[]>, classroomSettings = settings(), suppressedOrigins: Record<string, ManualMakeupOrigin[]> = {}, templatePendingDesks: TemplatePendingDeskMap | null = null) {
  const entries = buildMakeupStockEntries({ students, teachers, regularLessons: rows, classroomSettings, weeks, manualAdjustments, suppressedOrigins, resolveStudentKey, today: TODAY, templatePendingDesks })
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

function save(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], options: { classroomSettings?: ClassroomSettings; slotFilter?: Parameters<typeof computeTemplateDiffApplyForBoard>[0]['slotFilter']; manualMakeupAdjustments?: Record<string, ManualMakeupOrigin[]>; suppressedMakeupOrigins?: Record<string, ManualMakeupOrigin[]>; effectiveStartDate?: string; templatePendingDesks?: Parameters<typeof computeTemplateDiffApplyForBoard>[0]['templatePendingDesks']; previousRegularLessons?: readonly RegularLessonRow[] } = {}) {
  return computeTemplateDiffApplyForBoard({ scheduleCountAdjustments: [],
    weeks, classroomSettings: options.classroomSettings ?? settings(), teachers, students, regularLessons: rows, effectiveStartDate: options.effectiveStartDate ?? EFFECTIVE,
    suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: options.templatePendingDesks ?? {}, createdAt: '2026-10-01T10:00:00.000Z', slotFilter: options.slotFilter, manualMakeupAdjustments: options.manualMakeupAdjustments ?? {},
    suppressedMakeupOrigins: options.suppressedMakeupOrigins,
    previousRegularLessons: options.previousRegularLessons,
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

  // 決定記録 48（2026-10-25・(b)-1）: 満席なら未消化（台帳に origin 1 件＝旧 INV-06 の唯一の例外）ではなく、同じ机番号の机の下段（保留・緑）へ振替として置く。
  // 下段の振替は在庫の消化に数える（INV-06 の 3 本目の走査）ので台帳に積まなくても在庫中立。既知の限界 L-5 はこれで閉じる。台帳の例外は 'duplicate' / 'no-target-cell' だけに縮む。
  it('振替先の同じ机が両席とも埋まっている（満席）: 同じ机番号の机の下段（保留）へ振替として置く・台帳に積まない・残数は保存前と同じ・−1 なし・移動元記録あり・再マージの不動点・再保存で二重にならない', () => {
    const board = transferredBoard()
    const weeks = fillSeat2WithManual(board.weeks)
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(weeks, OLD_ROWS, board.ledgers)
    const saved = save(weeks, newRows, board.suppressed)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferPendingStudents).toBe(1)
    expect(saved.summary.pending).toBe(1)
    expect(saved.wholeDayTransferStocked).toEqual([])
    expect(saved.wholeDayTransferPending[0]).toMatchObject({ sourceDateKey: WED, sourceSlotNumber: SLOT, targetDateKey: THU, targetCellId: THU_CELL, deskIndex: 0, fallbackDesk: false })
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['transfer-pending'])
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    // 上段は変えない（満席のまま）。C は下段に振替として居る。
    expect(liveIds(saved.nextWeeks, THU_CELL).sort()).toEqual(['sA', 'sB', 'sD', 'sE'])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    const key = buildTemplatePendingDeskKey(THU_CELL, thu.desks[0].id)
    expect(Object.keys(saved.nextPendingDesks)).toEqual([key])
    const lowerC = saved.nextPendingDesks[key].lower.lesson?.studentSlots.find((student) => student?.managedStudentId === 'sC')
    expect(lowerC).toMatchObject({ lessonType: 'makeup', makeupSourceDate: WED })
    expect(saved.nextPendingDesks[key].origin?.kind).toBe('transfer-follow-full')
    expect(saved.nextPendingDesks[key].effectiveStartDate).toBe(THU)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC', moveDestinationDateKey: THU })
    // 在庫: 下段の振替が C の発生を消化する＝台帳に積まなくても残数は保存前と同じ（0）。A・B も不変。
    const after = balances(saved.nextWeeks, newRows, board.ledgers, settings(), {}, saved.nextPendingDesks)
    expect(after['sC__数'] ?? 0).toBe(before['sC__数'] ?? 0)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expectFixpoint(saved, newRows, board.suppressed)
    // 同じテンプレの再保存で二重に置かない（下段の C も抑止キーで次回は「置かなかった」に入らない）
    const again = save(saved.nextWeeks, newRows, suppressedAfter(board.suppressed, saved), { templatePendingDesks: saved.nextPendingDesks })
    expect(again.summary.wholeDayTransferPendingStudents).toBe(0)
    expect(again.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(again.nextPendingDesks).toEqual(saved.nextPendingDesks)
  })

  it('振替元が休日設定の日で振替先が満席: 休日でも足した生徒は拾われ、同じ机番号の下段（保留）へ振替として置く（休日の自動発生を下段の振替が消化＝残数 0）。−1 なし。既に移送済みの A・B の振替と移動元記録は根拠（テンプレ行）があるので消えない', () => {
    const holidaySettings = settings({ holidayDates: [WED] })
    const board = transferredBoard()
    const weeks = fillSeat2WithManual(board.weeks)
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(weeks, newRows, board.suppressed, { classroomSettings: holidaySettings })
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferPendingStudents).toBe(1)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL).sort()).toEqual(['sA', 'sB', 'sD', 'sE'])
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[0]).toMatchObject({ status: 'moved', managedStudentId: 'sA' })
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC' })
    expect(Object.keys(saved.nextPendingDesks)).toHaveLength(1)
    // 休日の自動発生（テンプレ行×休日）は下段の振替が消化して 0。下段を見なければ 1（＝下段を数えないと誤増）。A・B は 0 のまま
    const after = balances(saved.nextWeeks, newRows, board.ledgers, holidaySettings, {}, saved.nextPendingDesks)
    expect(after['sC__数'] ?? 0).toBe(0)
    expect(balances(saved.nextWeeks, newRows, board.ledgers, holidaySettings)['sC__数']).toBe(1)
    expect(after['sA__数'] ?? 0).toBe(0)
    expect(after['sB__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, board.suppressed, holidaySettings)
  })

  // 2026-10-25（オーナー承認・テスト教室 tp-48/tp-49・受付 20261023-142500887-cb435534）: 丸ごと振替した元の日を後から「休日設定」すると、
  // 休日のコマはテンプレ机が空（Q21-6）なので足した生徒が拾われず、Q40-2 が起動せずに未消化へ逃げていた。休日でも拾って振替先へ置く。
  it('振替元が休日設定の日で振替先に空席: 休日でも足した生徒は振替先の同じ机へ振替として置く（在庫中立・移動元記録・−1 なし・再保存で二重にならない・再マージの不動点）', () => {
    const holidaySettings = settings({ holidayDates: [WED] })
    const board = transferredBoard()
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers, holidaySettings)
    const saved = save(board.weeks, newRows, board.suppressed, { classroomSettings: holidaySettings })
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.studentNotes.filter((note) => note.kind === 'transfer-placed').map((note) => note.studentName)).toEqual(['千葉'])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    expect(thu.desks[0].lesson?.studentSlots.map((student) => student?.managedStudentId)).toEqual(['sA', 'sC'])
    expect(thu.desks[0].lesson?.studentSlots[1]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: WED })
    expect(liveIds(saved.nextWeeks, WED_CELL)).toEqual([])
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC', moveDestinationDateKey: THU, moveDestinationSlotNumber: SLOT })
    // 在庫: 置いた振替が休日の自動発生（テンプレ行×休日）を消化するので C は 0。A・B は保存前と同じ
    const after = balances(saved.nextWeeks, newRows, board.ledgers, holidaySettings)
    expect(after['sC__数'] ?? 0).toBe(0)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expectFixpoint(saved, newRows, board.suppressed, holidaySettings)
    const again = save(saved.nextWeeks, newRows, suppressedAfter(board.suppressed, saved), { classroomSettings: holidaySettings })
    expect(again.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(again.wholeDayTransferCountAdjustments).toEqual([])
    expect(liveIds(again.nextWeeks, THU_CELL).filter((id) => id === 'sC')).toHaveLength(1)
  })

  // テスト教室 tp-51（受付 20261022-094354322-14472254・v1.5.624）: 11/22→11/29 に丸ごと振替し 11/22 を休日設定した後、月 4限 の科目を英→社に変えると、
  // 旧科目の振替は根拠を失って消え、新科目は休日の元の日で拾われず（振替先の日では消される旧科目の振替を理由に精算済み）、生徒が 11/29 から消えていた。
  it('振替元が休日設定の日で科目を変える（tp-51）: 旧科目の振替を外し、新科目を振替先の同じ机へ置く＝生徒が振替先から消えない（INV-12・在庫中立）', () => {
    const holidaySettings = settings({ holidayDates: [WED] })
    const board = transferredBoard()
    const newRows = [row('r0', 't1', 'sA', '', 3, { subject1: '英' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(board.weeks, newRows, board.suppressed, { classroomSettings: holidaySettings })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(saved.orphanedMakeups[0].student).toMatchObject({ managedStudentId: 'sA', subject: '数' })
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    const thu = cellOf(saved.nextWeeks, THU_CELL)
    expect(thu.desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '英', lessonType: 'makeup', makeupSourceDate: WED })
    expect(liveIds(saved.nextWeeks, THU_CELL).filter((id) => id === 'sA')).toHaveLength(1)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.subject === '英')).toBe(true)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.subject === '数')).toBe(false)
    const after = balances(saved.nextWeeks, newRows, board.ledgers, holidaySettings)
    expect(after['sA__英'] ?? 0).toBe(0)
    expect(after['sA__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, board.suppressed, holidaySettings)
  })

  it('回帰防止: 丸ごと振替していない普通の休日にテンプレで生徒を足しても、拾わない・置かない・−1 しない（従来どおり休日の自動発生だけ）', () => {
    const holidaySettings = settings({ holidayDates: [WED] })
    const base = remerge([buildWeek(OLD_ROWS, holidaySettings)], OLD_ROWS, [], holidaySettings)
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(base, newRows, [], { classroomSettings: holidaySettings })
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(liveIds(saved.nextWeeks, WED_CELL)).toEqual([])
    expect(balances(saved.nextWeeks, newRows, {}, holidaySettings)['sC__数']).toBe(1)
  })
})

describe('INV-06 × Q40-1: テンプレから外した生徒の根拠を失った振替', () => {
  it('丸ごと振替で移送された振替を消す: 在庫中立・振替元の移動元記録も消える・机と講師は残る・再マージの不動点・反映日より前だけの週は配列ごと不変（INV-10）', () => {
    const board = transferredBoard()
    const previousWeek = remerge([buildWeek(OLD_ROWS, settings(), { startDate: '2026-09-28', endDate: '2026-10-04' })], OLD_ROWS, [])[0]
    const weeks = [previousWeek, ...board.weeks]
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = save(weeks, newRows, board.suppressed)
    expect(saved.nextWeeks[0]).toBe(previousWeek)
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

  it('根拠 (b)・形 1: 通常授業を休みにして台帳に origin が積まれ、その在庫から置いた振替は、テンプレから外しても消えない（残数不変）。台帳が無い形は実際には起きない（起きたら消える）', () => {
    // 丸ごと振替ではなく、水 5限の A を休みにして（席を空け・休みの記録・台帳に origin）木 5限 机 0 に振替を置いた形。
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const wedA = cellOf(base, WED_CELL).desks[0].lesson!.studentSlots[0]!
    const absentA: StudentStatusEntry = { id: 'st_a_absent', studentId: wedA.id, sourceManagedLesson: true, name: wedA.name, managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: WED, slotNumber: SLOT, recordedAt: 'x', status: 'absent', sourceLessonId: 'src' }
    const keyA = buildManagedOccurrenceKey(wedA, WED, SLOT)
    const weeks = withDesk(withDesk(base, WED_CELL, 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [absentA, null] as [StudentStatusEntry | null, StudentStatusEntry | null] })), THU_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'manual_mk', studentSlots: [{ ...wedA, id: 'sA_mk', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' } as StudentEntry, null] as [StudentEntry | null, StudentEntry | null] } }))
    const normalized = remerge(weeks, OLD_ROWS, [keyA])
    const ledger = { 'sA__数': [{ dateKey: WED, slotNumber: SLOT }] }
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(normalized, OLD_ROWS, ledger)
    expect(before['sA__数'] ?? 0).toBe(0)
    const saved = save(normalized, newRows, [keyA], { manualMakeupAdjustments: ledger })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
    expect(balances(saved.nextWeeks, newRows, ledger)['sA__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, [keyA])
    // 台帳に origin が無ければ在庫の正本に根拠が無い＝消える（残数は 0 のまま＝在庫中立）
    const without = save(normalized, newRows, [keyA])
    expect(without.summary.orphanedMakeupsRemoved).toBe(1)
    expect(balances(without.nextWeeks, newRows, {})['sA__数'] ?? 0).toBe(0)
  })

  it('根拠 (b)・形 2（監査 H-A）: 移送された振替を休みにして戻った在庫から別の日へ置いた振替は、テンプレから外しても消えない（振替の休みの記録が振替元の日に origin を立てる・残数不変）。保留の下段にある休みの記録も同じ', () => {
    const board = transferredBoard()
    const thuA = cellOf(board.weeks, THU_CELL).desks[0].lesson!.studentSlots[0]!
    expect(thuA).toMatchObject({ managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: WED })
    const absentMakeupA: StudentStatusEntry = { id: 'st_a_mk_absent', studentId: thuA.id, sourceManagedLesson: false, name: thuA.name, managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', teacherName: '田中', dateKey: THU, slotNumber: SLOT, recordedAt: 'x', status: 'absent', sourceLessonId: 'src', makeupSourceDate: WED, makeupSourceLabel: thuA.makeupSourceLabel }
    const placedAgain = { ...thuA, id: 'sA_mk2' }
    const placeOnFriday = (weeks: SlotCell[][]) => withDesk(weeks, FRI_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'from_stock', studentSlots: [placedAgain, null] as [StudentEntry | null, StudentEntry | null] } }))
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    // 上段に休みの記録
    const upper = remerge(placeOnFriday(withDesk(board.weeks, THU_CELL, 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [absentMakeupA, null] as [StudentStatusEntry | null, StudentStatusEntry | null] }))), OLD_ROWS, board.suppressed)
    const before = balances(upper, OLD_ROWS, board.ledgers)
    expect(before['sA__数'] ?? 0).toBe(0)
    const saved = save(upper, newRows, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, FRI_CELL)).toContain('sA')
    expect(balances(saved.nextWeeks, newRows, board.ledgers)['sA__数'] ?? 0).toBe(0)
    expectFixpoint(saved, newRows, board.suppressed)
    // 保留の下段に休みの記録（下段に生きている生徒も居る＝保留が残る形。木 5限 は範囲外にして保留を触らせない・監査 L-1）
    const thuDeskId = cellOf(board.weeks, THU_CELL).desks[0].id
    const pending = { [buildTemplatePendingDeskKey(THU_CELL, thuDeskId)]: { lower: { lesson: { id: 'lower_d', studentSlots: [MANUAL_D, null] as [StudentEntry | null, StudentEntry | null] }, statusSlots: [absentMakeupA, null] as [StudentStatusEntry | null, StudentStatusEntry | null] }, effectiveStartDate: EFFECTIVE, createdAt: 'x' } }
    const lower = remerge(placeOnFriday(withDesk(board.weeks, THU_CELL, 0, (desk) => ({ ...desk, lesson: undefined }))), OLD_ROWS, board.suppressed)
    const wedOnly = { slotKeys: new Set([buildTemplateSlotKey(3, SLOT)]) }
    const savedLower = save(lower, newRows, board.suppressed, { manualMakeupAdjustments: board.ledgers, templatePendingDesks: pending, slotFilter: wedOnly })
    expect(savedLower.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(savedLower.nextWeeks, FRI_CELL)).toContain('sA')
    expect(Object.keys(savedLower.nextPendingDesks)).toEqual(Object.keys(pending))
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
  it('H-1 時限変更（保存前のテンプレを渡さない経路＝v1.5.642 までの挙動）: 丸ごと振替した日の生徒を同じ曜日の別の時限へ動かしても、移送済みの振替は根拠あり（日単位）＝消えない・別の時限へ二重に置かない・−1 なし・残数不変。決定記録 46 の追従は下の describe「Q40-9」', () => {
    const board = transferredBoard()
    // 新テンプレ: A を 水 5限 → 水 3限 へ（B はそのまま）
    const newRows = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = save(board.weeks, newRows, board.suppressed)
    expect(saved.summary.slotFollowMovedMakeups).toBe(0)
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
    expectFixpoint(saved, newRows, [keyA])
    // 台帳を渡さなければ（根拠 (b) が無ければ）消える＝残数が +1 に動く（監査 H-2 の再現）
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
    expectFixpoint(saved, newRows, board.suppressed, settings({ templateFreezeBeforeDate: THU }))
  })

  it('M-2 足す→外す: 置けずに台帳へ積んだ origin（印つき）は、その生徒を次のテンプレ保存で外すと同じ保存が取り下げる＝台帳が元に戻る。手で積んだ origin は残す', () => {
    const board = transferredBoard()
    // 2026-10-25: 満席は下段へ置くようになった（決定記録 48）ので、台帳へ積む形は「同じコマに同じ生徒が生きている（duplicate）」で作る。
    const weeks = withLiveCInTarget(board.weeks)
    const rowsWithC = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const first = save(weeks, rowsWithC, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(first.manualMakeupOriginAdditions).toHaveLength(1)
    // 保存本体と同じ形で積む（理由ラベルつき・時限つき）。手で積んだ origin（同じ日付×時限のものを先頭に・別の日のもの）は混ぜておく
    const manualSameSlot: ManualMakeupOrigin = { dateKey: WED, slotNumber: SLOT }
    const manualOtherDay: ManualMakeupOrigin = { dateKey: '2026-10-14' }
    let ledger: Record<string, ManualMakeupOrigin[]> = { ...board.ledgers, 'sC__数': [manualSameSlot, manualOtherDay] }
    for (const addition of first.manualMakeupOriginAdditions) ledger = appendTemplateTransferMakeupOrigin(ledger, `${addition.student.managedStudentId}__${addition.student.subject}`, addition.dateKey, addition.slotNumber)
    expect(ledger['sC__数']).toEqual([manualSameSlot, { dateKey: WED, slotNumber: SLOT, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }, manualOtherDay])
    // 同じ日付×時限の origin は在庫の計算では 1 つのトークン（resolveEffectiveMakeupOriginDates）なので残数は 2 のまま＝残数では印つきの重なりが見えない。
    // だからこそ取り下げは「印つきの 1 件だけ」を外さなければならない（手積みを外すと、印つきが残って次の保存でもう 1 件外れる＝手積みが黙って減る）。
    expect(balances(first.nextWeeks, rowsWithC, ledger)['sC__数']).toBe(2)
    expectFixpoint(first, rowsWithC, board.suppressed)
    // 次の保存で C を外す
    const second = save(first.nextWeeks, OLD_ROWS, suppressedAfter(board.suppressed, first), { manualMakeupAdjustments: ledger })
    expect(second.manualMakeupOriginRemovals).toEqual([{ stockKey: 'sC__数', dateKey: WED, slotNumber: SLOT }])
    expect(second.manualMakeupOriginAdditions).toEqual([])
    let ledgerAfter = ledger
    for (const removal of second.manualMakeupOriginRemovals) ledgerAfter = removeTemplateTransferMakeupOrigin(ledgerAfter, removal.stockKey, removal.dateKey, removal.slotNumber)
    // 外れるのは印つきの 1 件だけ（同じ日付×時限の手積みが先頭に居ても外さない）
    expect(ledgerAfter['sC__数']).toEqual([manualSameSlot, manualOtherDay])
    expect(balances(second.nextWeeks, OLD_ROWS, ledgerAfter)['sC__数']).toBe(2)
    expectFixpoint(second, OLD_ROWS, suppressedAfter(board.suppressed, first))
    // 取り下げ後に何も変えない保存（全コマ）を重ねても、印つきが無いので取り下げ 0・台帳は参照ごと不変
    const third = save(second.nextWeeks, OLD_ROWS, suppressedAfter(suppressedAfter(board.suppressed, first), second), { manualMakeupAdjustments: ledgerAfter })
    expect(third.manualMakeupOriginRemovals).toEqual([])
    expect(removeTemplateTransferMakeupOrigin(ledgerAfter, 'sC__数', WED, SLOT)).toBe(ledgerAfter)
    // C を残したまま別の保存をしても取り下げない
    const keep = save(first.nextWeeks, rowsWithC, suppressedAfter(board.suppressed, first), { manualMakeupAdjustments: ledger })
    expect(keep.manualMakeupOriginRemovals).toEqual([])
  })
})

describe('INV-06 × Q40 regression-reviewer 再検査（2026-10-15・H-A/M-A/M-B/L-1/M-4）', () => {
  it('M-A 印つき origin の在庫から置いた振替: その生徒を外す保存で取り下げと振替の削除が同時に起きる（残数は保存前と同じ）。続く全コマ保存では何も起きない', () => {
    const board = transferredBoard()
    // 2026-10-25: 台帳へ積む形は duplicate（M-2 と同じ）。
    const weeks = withLiveCInTarget(board.weeks)
    const rowsWithC = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const first = save(weeks, rowsWithC, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(first.manualMakeupOriginAdditions).toHaveLength(1)
    let ledger = board.ledgers
    for (const addition of first.manualMakeupOriginAdditions) ledger = appendTemplateTransferMakeupOrigin(ledger, `${addition.student.managedStudentId}__${addition.student.subject}`, addition.dateKey, addition.slotNumber)
    // その在庫から 金 5限 机 1 に C の振替を置く（振替元＝水 5限）
    const placedC: StudentEntry = { id: 'sC_mk', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' }
    const suppressed1 = suppressedAfter(board.suppressed, first)
    const normalized = remerge(withDesk(first.nextWeeks, FRI_CELL, 1, (desk) => ({ ...desk, lesson: { id: 'from_stock_c', studentSlots: [placedC, null] as [StudentEntry | null, StudentEntry | null] } })), rowsWithC, suppressed1)
    expect(balances(normalized, rowsWithC, ledger)['sC__数'] ?? 0).toBe(0)
    const second = save(normalized, OLD_ROWS, suppressed1, { manualMakeupAdjustments: ledger })
    expect(second.manualMakeupOriginRemovals).toEqual([{ stockKey: 'sC__数', dateKey: WED, slotNumber: SLOT }])
    expect(second.summary.orphanedMakeupsRemoved).toBe(1)
    expect(liveIds(second.nextWeeks, FRI_CELL)).toEqual([])
    let ledgerAfter = ledger
    for (const removal of second.manualMakeupOriginRemovals) ledgerAfter = removeTemplateTransferMakeupOrigin(ledgerAfter, removal.stockKey, removal.dateKey, removal.slotNumber)
    expect(ledgerAfter['sC__数']).toBeUndefined()
    expect(balances(second.nextWeeks, OLD_ROWS, ledgerAfter)['sC__数'] ?? 0).toBe(0)
    expectFixpoint(second, OLD_ROWS, suppressed1)
    const third = save(second.nextWeeks, OLD_ROWS, suppressedAfter(suppressed1, second), { manualMakeupAdjustments: ledgerAfter })
    expect(third.summary.orphanedMakeupsRemoved).toBe(0)
    expect(third.manualMakeupOriginRemovals).toEqual([])
  })

  it('M-B 管理生徒 ID の無い振替（名前だけ・旧データ）: 同じコマの別の机の講師を変えただけの保存で消えない', () => {
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const nameOnly: StudentEntry = { id: 'legacy_mk', name: '青木', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' }
    const normalized = remerge(withDesk(base, THU_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'legacy', studentSlots: [nameOnly, null] as [StudentEntry | null, StudentEntry | null] } })), OLD_ROWS, [])
    expect(cellOf(normalized, THU_CELL).desks[0].lesson?.studentSlots[0]?.name).toBe('青木')
    // 新テンプレ: 水 5限 机 1 の講師を鈴木 → 佐藤に（A・B はそのまま）＝水 5限 が範囲に入る
    const newRows = [row('r0', 't1', 'sA'), row('r1', 't3', 'sB'), row('r2', 't2', '', '', 4)]
    const saved = save(normalized, newRows, [])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(cellOf(saved.nextWeeks, THU_CELL).desks[0].lesson?.studentSlots[0]?.name).toBe('青木')
  })

  it('L-1 同じ生徒を同じ日の 2 コマに足した: 2 件とも置く（木 3限 は講師のいない机だが置く＝オーナー指示 2026-10-21・旧 M-4 を改定）。「置かず振替を優先」は件数で引いて 0・−1 なし・台帳は不変', () => {
    const board = transferredBoard()
    const newRows = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4), row('r3', 't3', 'sC', '', 3, { slotNumber: 3 })]
    const saved = save(board.weeks, newRows, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(2)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.wholeDayTransferPlaced.map((item) => ({ slot: item.sourceSlotNumber, teacherless: item.teacherless }))).toEqual(expect.arrayContaining([{ slot: 5, teacherless: false }, { slot: 3, teacherless: true }]))
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(liveIds(saved.nextWeeks, THU_CELL).filter((id) => id === 'sC')).toHaveLength(1)
    expect(liveIds(saved.nextWeeks, `${THU}_3`)).toEqual(['sC'])
    expect(cellOf(saved.nextWeeks, `${THU}_3`).desks[0].teacher).toBe('')
    expectFixpoint(saved, newRows, board.suppressed)
  })
})

describe('INV-06 × Q40 regression-reviewer 最終確認（2026-10-15・M-C/L-3）', () => {
  it('M-C 鍵解決は表示名も見る: 管理生徒 ID の無い旧データの「振替を休んだ記録」（表示名）が立てる在庫から置いた ID つきの振替は、テンプレから外しても消えない（残数不変）', () => {
    // 水 5限 机 1 の生徒 2 に E（登録名「江藤 花子」・表示名「江藤」）。
    const rows = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB', 'sE'), row('r2', 't3', '', '', 4)]
    const base = remerge([buildWeek(rows)], rows, [])
    const wedE = cellOf(base, WED_CELL).desks[1].lesson!.studentSlots[1]!
    expect(wedE.managedStudentId).toBe('sE')
    const legacyAbsent: StudentStatusEntry = { id: 'st_e_legacy', studentId: 'legacy', sourceManagedLesson: false, name: '江藤', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', teacherName: '佐藤', dateKey: THU, slotNumber: SLOT, recordedAt: 'x', status: 'absent', sourceLessonId: 'src', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' }
    const placedE: StudentEntry = { id: 'sE_mk', name: '江藤', managedStudentId: 'sE', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' }
    const keyE = buildManagedOccurrenceKey(wedE, WED, SLOT)
    const weeks = withDesk(withDesk(withDesk(base, WED_CELL, 1, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], null] } })), THU_CELL, 0, (desk) => ({ ...desk, statusSlots: [legacyAbsent, null] as [StudentStatusEntry | null, StudentStatusEntry | null] })), FRI_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'from_stock_e', studentSlots: [placedE, null] as [StudentEntry | null, StudentEntry | null] } }))
    const normalized = remerge(weeks, rows, [keyE])
    expect(balances(normalized, rows, {})['sE__数'] ?? 0).toBe(0)
    const newRows = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(normalized, newRows, [keyE])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, FRI_CELL)).toContain('sE')
    expect(balances(saved.nextWeeks, newRows, {})['sE__数'] ?? 0).toBe(0)
  })

  it('L-3 抑止した origin は根拠にならない: 台帳の origin がその日ごと抑止されている振替は根拠なしで消え、残数は変わらない', () => {
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const wedA = cellOf(base, WED_CELL).desks[0].lesson!.studentSlots[0]!
    const keyA = buildManagedOccurrenceKey(wedA, WED, SLOT)
    const weeks = withDesk(withDesk(base, WED_CELL, 0, (desk) => ({ ...desk, lesson: undefined })), THU_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'manual_mk', studentSlots: [{ ...wedA, id: 'sA_mk', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' } as StudentEntry, null] as [StudentEntry | null, StudentEntry | null] } }))
    const normalized = remerge(weeks, OLD_ROWS, [keyA])
    const ledger = { 'sA__数': [{ dateKey: WED }] }
    const suppressed = { 'sA__数': [{ dateKey: WED }] }
    const newRows = [row('r0', 't1'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(normalized, OLD_ROWS, ledger, settings(), suppressed)
    const saved = save(normalized, newRows, [keyA], { manualMakeupAdjustments: ledger, suppressedMakeupOrigins: suppressed })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(liveIds(saved.nextWeeks, THU_CELL)).not.toContain('sA')
    expect(balances(saved.nextWeeks, newRows, ledger, settings(), suppressed)['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    // 抑止を渡さなければ根拠あり（H-2 の形）
    expect(save(normalized, newRows, [keyA], { manualMakeupAdjustments: ledger }).summary.orphanedMakeupsRemoved).toBe(0)
  })
})

// ============================================================================
// 決定記録 48（2026-10-25）Q42 の兄弟（regression-reviewer H-1 / M-2・同日）
// ============================================================================
describe('Q42 × テンプレ再保存（regression-reviewer 2026-10-25 H-1 / M-2）', () => {
  const emptyLedgers = { manualLectureStockCounts: {}, manualLectureStockOrigins: {}, manualMakeupAdjustments: {}, fallbackLectureStockStudents: {}, fallbackMakeupStudents: {} }
  const roster = new Map(students.map((student) => [student.name, student]))
  function audit(weeks: SlotCell[][], rows: RegularLessonRow[], pendingDesks: TemplatePendingDeskMap, suppressed: string[]) {
    void suppressed
    return auditTemplateLessonAccounting({ weeks, regularLessons: rows, students, classroomSettings: settings(), scheduleCountAdjustments: [], manualMakeupAdjustments: {}, templatePendingDesks: pendingDesks, fromDate: WED, toDate: WEEK_END })
  }
  /** 休日設定の後に、水 5限 机 0 の A の席へ別の生徒 D を手で置いた形（A は holiday 記録）。 */
  function holidayWithSeatTaken() {
    const base = remerge([buildWeek(OLD_ROWS)], OLD_ROWS, [])
    const desk0 = cellOf(base, WED_CELL).desks[0]
    const a = desk0.lesson!.studentSlots[0]!
    const record: StudentStatusEntry = {
      id: 'sA_holiday', studentId: 'sA', sourceManagedLesson: true, name: a.name, managedStudentId: 'sA', grade: a.grade, subject: a.subject, lessonType: 'regular', teacherType: a.teacherType,
      teacherName: desk0.teacher, dateKey: WED, slotNumber: SLOT, recordedAt: '2026-10-01T00:00:00.000Z', status: 'holiday', holidayStockReturn: { kind: 'none' }, sourceLessonId: desk0.lesson!.id,
    }
    const weeks = withDesk(base, WED_CELL, 0, (desk) => ({ ...desk, lesson: { id: 'other-lesson', studentSlots: [MANUAL_D, null] }, statusSlots: [record, null] }))
    const released = computeHolidayReleaseRestoration({ weeks, dateKey: WED, ledgers: emptyLedgers, managedStudentByAnyName: roster, resolveDisplayName: (name) => name, resolveStockId: resolveStudentKey, templatePendingDesks: {}, createdAt: '2026-10-25T09:00:00.000Z' })
    // 休日解除ハンドラと同じく、その日のテンプレの出現は抑止したまま（下段へ戻した分は外さない）。
    const suppressed = [`sA__数__${WED}__${SLOT}`]
    return { released, suppressed }
  }

  it('H-1: 休日解除で下段へ戻した通常授業（印つき）は、同じテンプレの再保存で消えず下段に残る（保存則の違反なし・不動点）', () => {
    const { released, suppressed } = holidayWithSeatTaken()
    expect(released.pendingRestoredStudentNames).toEqual(['青木'])
    const pending = released.nextTemplatePendingDesks!
    const key = buildTemplatePendingDeskKey(WED_CELL, cellOf(released.nextWeeks, WED_CELL).desks[0].id)
    expect(pending[key].lower.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', lessonType: 'regular', manualAdded: true })
    expect(audit(released.nextWeeks, OLD_ROWS, pending, suppressed), describeLessonAccountingViolations(audit(released.nextWeeks, OLD_ROWS, pending, suppressed))).toEqual([])
    const saved = save(released.nextWeeks, OLD_ROWS, suppressed, { templatePendingDesks: pending })
    expect(saved.nextPendingDesks[key]?.lower.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', manualAdded: true })
    expect(saved.nextPendingDesks[key]?.origin?.kind).toBe('holiday-release-seat-taken')
    expect(liveIds(saved.nextWeeks, WED_CELL)).toEqual(['sD', 'sB'])
    expect(audit(saved.nextWeeks, OLD_ROWS, saved.nextPendingDesks, suppressed)).toEqual([])
    expectFixpoint(saved, OLD_ROWS, suppressed)
  })

  it('H-1 続き: 上段の席が空いて Q28 で 1 行に戻った後の再保存でも消えない（手で足し直した通常授業と同じ形）', () => {
    const { released, suppressed } = holidayWithSeatTaken()
    const pending = released.nextTemplatePendingDesks!
    const emptied = released.nextWeeks.map((week) => week.map((cell) => (cell.id !== WED_CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : desk)) })))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: released.nextWeeks, previousTemplatePendingDesks: pending, weeks: emptied, templatePendingDesks: pending })
    expect(settled.nextTemplatePendingDesks).toEqual({})
    expect(cellOf(settled.nextWeeks, WED_CELL).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', manualAdded: true })
    const saved = save(settled.nextWeeks, OLD_ROWS, suppressed, { templatePendingDesks: {} })
    expect(liveIds(saved.nextWeeks, WED_CELL).sort()).toEqual(['sA', 'sB'])
    expect(liveIds(saved.nextWeeks, WED_CELL).filter((id) => id === 'sA')).toHaveLength(1)
    expect(audit(saved.nextWeeks, OLD_ROWS, {}, suppressed)).toEqual([])
    expectFixpoint(saved, OLD_ROWS, suppressed)
  })

  it("M-2' 満席で下段へ置いた振替は、足す→外すで下段から外れ、振替元の移動元記録も消え、保留は空になって消える（台帳・残数は足す前と同じ）", () => {
    const board = transferredBoard()
    const weeks = fillSeat2WithManual(board.weeks)
    const rowsWithC = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(weeks, OLD_ROWS, board.ledgers)
    const first = save(weeks, rowsWithC, board.suppressed, { manualMakeupAdjustments: board.ledgers })
    expect(first.summary.wholeDayTransferPendingStudents).toBe(1)
    expect(Object.keys(first.nextPendingDesks)).toHaveLength(1)
    const suppressed1 = suppressedAfter(board.suppressed, first)
    const second = save(first.nextWeeks, OLD_ROWS, suppressed1, { manualMakeupAdjustments: board.ledgers, templatePendingDesks: first.nextPendingDesks })
    expect(second.summary.orphanedMakeupsRemoved).toBe(1)
    expect(second.orphanedMakeups[0]).toMatchObject({ inLower: true, sourceDateKey: WED })
    expect(second.orphanedMakeups[0].student.managedStudentId).toBe('sC')
    expect(second.nextPendingDesks).toEqual({})
    expect(second.summary.pending).toBe(0)
    expect(cellOf(second.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sC') ?? false).toBe(false)
    expect(second.manualMakeupOriginAdditions).toEqual([])
    expect(second.manualMakeupOriginRemovals).toEqual([])
    const after = balances(second.nextWeeks, OLD_ROWS, board.ledgers, settings(), {}, second.nextPendingDesks)
    expect(after['sC__数'] ?? 0).toBe(before['sC__数'] ?? 0)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expectFixpoint(second, OLD_ROWS, suppressed1)
  })
})

// ============================================================================
// 決定記録 46（オーナー決定 2026-10-25・実装 2026-10-26・spec-template-behavior §H Q40-9）: テンプレで時限を変えたら、丸ごと振替で移送済みの振替も新しい時限へ動かす。
// 同じ授業（生徒×科目×振替元の日付×時限が一致）だけ。満席は同じ机番号の下段（保留・緑・決定記録 48）。例外（振替先が反映日より前／出欠記録あり／室長が手で動かした後／保留の机）は動かさない。
// ============================================================================
describe('Q40-9 時限変更の追従（決定記録 46）', () => {
  // A を 水 5限 → 水 3限（机 0・講師 田中）。B はそのまま。
  const MOVED_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const THU3 = `${THU}_3`
  const WED3 = `${WED}_3`
  const saveMoved = (weeks: SlotCell[][], suppressed: string[], extra: Parameters<typeof save>[3] = {}) => save(weeks, MOVED_ROWS, suppressed, { previousRegularLessons: OLD_ROWS, ...extra })

  it('移送済みの振替（木 5限）を新しい時限（木 3限・テンプレの机番号）へ動かし、もとのラベルを 3限に、水の移動元記録を 5限 → 3限へ移す。在庫中立・−1 なし・台帳なし・不動点・再保存で何も起きない', () => {
    const board = transferredBoard()
    const before = balances(board.weeks, OLD_ROWS, board.ledgers)
    const saved = saveMoved(board.weeks, board.suppressed)
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
    expect(saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(saved.slotFollowMoves[0]).toMatchObject({ sourceDateKey: WED, oldSlotNumber: 5, newSlotNumber: 3, targetDateKey: THU, targetCellId: THU3, deskIndex: 0, placement: 'upper', fallbackDesk: false })
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['slot-followed'])
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.manualMakeupOriginRemovals).toEqual([])
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL)).toEqual(['sB'])
    expect(cellOf(saved.nextWeeks, THU3).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 3限' })
    expect(liveIds(saved.nextWeeks, THU3).filter((id) => id === 'sA')).toHaveLength(1)
    expect(cellOf(saved.nextWeeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA') ?? false).toBe(false)
    expect(cellOf(saved.nextWeeks, WED3).desks[0].statusSlots?.find((entry) => entry?.managedStudentId === 'sA')).toMatchObject({ status: 'moved', slotNumber: 3, moveDestinationDateKey: THU, moveDestinationSlotNumber: 3 })
    // 水の授業は置かない（丸ごと振替した日・Q35）
    expect(liveIds(saved.nextWeeks, WED3)).toEqual([])
    const after = balances(saved.nextWeeks, MOVED_ROWS, board.ledgers)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
    expectFixpoint(saved, MOVED_ROWS, board.suppressed)
    // 同じテンプレの再保存（保存前＝保存後のテンプレ）では何も動かない
    const suppressed1 = suppressedAfter(board.suppressed, saved)
    const again = save(saved.nextWeeks, MOVED_ROWS, suppressed1, { previousRegularLessons: MOVED_ROWS, templatePendingDesks: saved.nextPendingDesks })
    expect(again.summary.slotFollowMovedMakeups + again.summary.slotFollowPendingMakeups).toBe(0)
    expect(again.summary.orphanedMakeupsRemoved).toBe(0)
    expect(again.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(liveIds(again.nextWeeks, THU3).filter((id) => id === 'sA')).toHaveLength(1)
  })

  it('新しい時限（木 3限）が満席なら、テンプレの机番号の机の下段（保留・緑）へ置く。保留 n机に数える。在庫中立（下段の振替も消化に数える）・不動点', () => {
    const board = transferredBoard()
    const fill = (id: string, name: string, studentId: string): StudentEntry => ({ id, name, managedStudentId: studentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true })
    const weeks = board.weeks.map((week) => week.map((cell) => (cell.id !== THU3 ? cell : { ...cell, desks: cell.desks.map((desk, index) => ({ ...desk, lesson: { id: `full_${index}`, studentSlots: [fill(`x${index}`, '土屋', 'sD'), fill(`y${index}`, '千葉', 'sC')] as [StudentEntry | null, StudentEntry | null] } })) })))
    const before = balances(weeks, OLD_ROWS, board.ledgers)
    const saved = saveMoved(weeks, board.suppressed)
    expect(saved.summary.slotFollowPendingMakeups).toBe(1)
    expect(saved.summary.slotFollowMovedMakeups).toBe(0)
    expect(saved.summary.pending).toBe(1)
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['slot-follow-pending'])
    expect(liveIds(saved.nextWeeks, THU_CELL)).toEqual(['sB'])
    const key = buildTemplatePendingDeskKey(THU3, cellOf(saved.nextWeeks, THU3).desks[0].id)
    expect(saved.nextPendingDesks[key].lower.lesson?.studentSlots.find((student) => student?.managedStudentId === 'sA')).toMatchObject({ lessonType: 'makeup', makeupSourceLabel: '2026/10/7(水) 3限' })
    expect(saved.nextPendingDesks[key].origin?.kind).toBe('slot-follow-full')
    expect(saved.nextPendingDesks[key].effectiveStartDate).toBe(THU)
    const after = balances(saved.nextWeeks, MOVED_ROWS, board.ledgers, settings(), {}, saved.nextPendingDesks)
    expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
    expectFixpoint(saved, MOVED_ROWS, board.suppressed)
  })

  it('例外: 室長が振替を手で動かした後（木 5限に居ない）・振替に出欠記録あり・振替が保留の机の上段に居る・新しい時限に同じ生徒が居る、はいずれも動かさない（＝v1.5.642 までと同じ）', () => {
    const board = transferredBoard()
    const thuDesk0 = cellOf(board.weeks, THU_CELL).desks[0]
    const makeupA = thuDesk0.lesson!.studentSlots[0]!
    // (1) 室長が木 5限の A の振替を金 5限へ動かした
    const movedByHand = withDesk(withDesk(board.weeks, THU_CELL, 0, (desk) => ({ ...desk, lesson: undefined })), FRI_CELL, 1, (desk) => ({ ...desk, lesson: { id: 'by_hand', studentSlots: [makeupA, null] as [StudentEntry | null, StudentEntry | null] } }))
    const r1 = saveMoved(remerge(movedByHand, OLD_ROWS, board.suppressed), board.suppressed)
    expect(r1.summary.slotFollowMovedMakeups + r1.summary.slotFollowPendingMakeups, 'r1').toBe(0)
    expect(liveIds(r1.nextWeeks, FRI_CELL)).toContain('sA')
    // (2) 振替を休みにした（出欠記録あり）
    const absent: StudentStatusEntry = { id: 'sA_abs', studentId: makeupA.id, sourceManagedLesson: false, name: makeupA.name, managedStudentId: 'sA', grade: makeupA.grade, subject: makeupA.subject, lessonType: 'makeup', teacherType: makeupA.teacherType, teacherName: thuDesk0.teacher, dateKey: THU, slotNumber: SLOT, recordedAt: '2026-10-01T00:00:00.000Z', status: 'absent', makeupSourceDate: WED, makeupSourceLabel: makeupA.makeupSourceLabel, sourceLessonId: thuDesk0.lesson!.id }
    const withAbsent = withDesk(board.weeks, THU_CELL, 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [absent, null] }))
    const r2 = saveMoved(withAbsent, board.suppressed)
    expect(r2.summary.slotFollowMovedMakeups + r2.summary.slotFollowPendingMakeups, 'r2').toBe(0)
    expect(cellOf(r2.nextWeeks, THU_CELL).desks[0].statusSlots?.[0]).toMatchObject({ status: 'absent', managedStudentId: 'sA' })
    // (3) 木 5限 机 0 が保留の机（上段 2 席とも埋まり、下段に生徒が居る＝保存で 1 行に戻らない形）
    const pendingThu = { [buildTemplatePendingDeskKey(THU_CELL, thuDesk0.id)]: { lower: { lesson: { id: 'lower', studentSlots: [MANUAL_E, null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: WED, createdAt: 'x' } }
    const fullThu = withDesk(board.weeks, THU_CELL, 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [makeupA, MANUAL_D] as [StudentEntry | null, StudentEntry | null] } }))
    const r3 = saveMoved(fullThu, board.suppressed, { templatePendingDesks: pendingThu })
    expect(Object.keys(r3.nextPendingDesks)).toContain(buildTemplatePendingDeskKey(THU_CELL, thuDesk0.id))
    expect(r3.summary.slotFollowMovedMakeups + r3.summary.slotFollowPendingMakeups, 'r3').toBe(0)
    expect(liveIds(r3.nextWeeks, THU_CELL)).toContain('sA')
    // (4) 木 3限に A が既に居る（手動追加の通常）
    const aManual: StudentEntry = { id: 'sA_manual', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true }
    const dup = withDesk(board.weeks, THU3, 1, (desk) => ({ ...desk, lesson: { id: 'dup', studentSlots: [aManual, null] as [StudentEntry | null, StudentEntry | null] } }))
    const r4 = saveMoved(dup, board.suppressed)
    expect(r4.summary.slotFollowMovedMakeups + r4.summary.slotFollowPendingMakeups, 'r4').toBe(0)
    expect(liveIds(r4.nextWeeks, THU_CELL)).toContain('sA')
    // 追従しなかった形でも −1・台帳は動かない（H-1 が本番の経路を見なくなった分の補完・regression-reviewer 2026-10-26）
    for (const [label, result] of [['r1', r1], ['r2', r2], ['r3', r3], ['r4', r4]] as const) {
      expect(result.wholeDayTransferCountAdjustments, label).toEqual([])
      expect(result.manualMakeupOriginAdditions, label).toEqual([])
    }
    expectFixpoint(r3, MOVED_ROWS, board.suppressed)
    expectFixpoint(r4, MOVED_ROWS, board.suppressed)
  })

  it('例外: 振替先が反映日より前（後ろ向きの丸ごと振替）・時限の増減が 1 対 1 でない（5限 → 3限＋4限）は動かさない', () => {
    // 後ろ向き: 金 → 木 へ丸ごと振替し、反映日を 金 にする（振替先の木は反映日より前）
    const backward = transferredBoard(OLD_ROWS.map((r) => (r.id === 'r2' ? r : { ...r, dayOfWeek: 5 })), settings(), { sourceDateKey: FRI, targetDateKey: THU })
    const backRows = [row('r0', 't1', 'sA', '', 5, { slotNumber: 3 }), row('r1', 't2', 'sB', '', 5), row('r2', 't3', '', '', 4)]
    const rb = save(backward.weeks, backRows, backward.suppressed, { previousRegularLessons: OLD_ROWS.map((r) => (r.id === 'r2' ? r : { ...r, dayOfWeek: 5 })), effectiveStartDate: FRI, classroomSettings: settings({ templateFreezeBeforeDate: FRI }) })
    expect(rb.summary.slotFollowMovedMakeups + rb.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(rb.nextWeeks, THU_CELL)).toContain('sA')
    // 1 対 1 でない: A を 5限 → 3限 と 4限 の 2 つへ
    const board = transferredBoard()
    const twoRows = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r5', 't1', 'sA', '', 3, { slotNumber: 4 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const r2 = save(board.weeks, twoRows, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(r2.summary.slotFollowMovedMakeups + r2.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(r2.nextWeeks, THU_CELL)).toContain('sA')
  })
})

// regression-reviewer（2026-10-26）の監査で足した行: M-1（1 コマ D&D を動かさない）・L-1（下段の同じ生徒）・兄弟（休日の振替元・別の週・同じ曜日・生徒 2 の席・時限＋科目・2 科目の入れ替え・セルが無い）。
describe('Q40-9 時限変更の追従 × 監査の兄弟（regression-reviewer 2026-10-26）', () => {
  const MOVED_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const THU3 = `${THU}_3`
  const roster = new Map(students.map((student) => [student.name, student]))
  const where = (weeks: SlotCell[][], id: string) => weeks.flat().flatMap((cell) => cell.desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).flatMap((student) => (student?.managedStudentId === id ? [`${cell.id}#${deskIndex}:${student.lessonType}:${student.subject}`] : []))))
  /** 追従しなかった・したに関わらず: −1 なし・台帳不変・残数不変・再マージの不動点。 */
  function expectNeutral(saved: ReturnType<typeof save>, weeksBefore: SlotCell[][], rowsBefore: RegularLessonRow[], rowsAfter: RegularLessonRow[], suppressed: string[], ledgers: Record<string, ManualMakeupOrigin[]> = {}, classroomSettings = settings()) {
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    const before = balances(weeksBefore, rowsBefore, ledgers, classroomSettings)
    const after = balances(saved.nextWeeks, rowsAfter, ledgers, classroomSettings, {}, saved.nextPendingDesks)
    for (const key of ['sA__数', 'sB__数']) expect(after[key] ?? 0, key).toBe(before[key] ?? 0)
    expectFixpoint(saved, rowsAfter, suppressed, classroomSettings)
  }

  it('M-1（INV-02）: 振替を元の日へ戻してから別の日（丸ごと振替の日でない金）の同じ時限へ 1 コマ D&D した振替は、時限を変えても動かさない', () => {
    const board = transferredBoard()
    const move = (weeks: SlotCell[][], suppressed: string[], studentId: string, cellId: string) => {
      const result = computeStudentMove({ weeks, weekIndex: 0, cells: weeks[0], movingStudentId: studentId, cellId, deskIndex: 0, studentIndex: 0, suppressedRegularLessonOccurrences: suppressed, managedStudentByAnyName: roster, resolveBoardStudentDisplayName: (name) => name })
      if (result.status !== 'moved') throw new Error(result.message)
      return { weeks: remerge(result.nextWeeks, OLD_ROWS, result.nextSuppressedRegularLessonOccurrences), suppressed: result.nextSuppressedRegularLessonOccurrences }
    }
    const makeupA = cellOf(board.weeks, THU_CELL).desks[0].lesson!.studentSlots[0]!
    let state = move(board.weeks, board.suppressed, makeupA.id, WED_CELL)
    const back = cellOf(state.weeks, WED_CELL).desks[0].lesson!.studentSlots[0]!
    state = move(state.weeks, state.suppressed, back.id, FRI_CELL)
    // 前提: 金 5限に振替（もと 水 5限）、水 5限に移動元記録（行き先 金・5限）＝時限だけでは丸ごと振替と区別できない形
    expect(cellOf(state.weeks, FRI_CELL).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: WED })
    expect(cellOf(state.weeks, WED_CELL).desks.some((desk) => desk.statusSlots?.some((entry) => entry?.status === 'moved' && entry.managedStudentId === 'sA' && entry.moveDestinationDateKey === FRI))).toBe(true)
    const saved = save(state.weeks, MOVED_ROWS, state.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(saved.nextWeeks, FRI_CELL)).toContain('sA')
    expect(liveIds(saved.nextWeeks, `${FRI}_3`)).not.toContain('sA')
    expectNeutral(saved, state.weeks, OLD_ROWS, MOVED_ROWS, state.suppressed)
  })

  it('L-1（INV-12）: 新しい時限の保留の下段に同じ生徒（別の科目）が居れば動かさない', () => {
    const board = transferredBoard()
    const thu3 = cellOf(board.weeks, THU3)
    const mk = (id: string, studentId: string, subject: StudentEntry['subject'] = '数'): StudentEntry => ({ id, name: studentId, managedStudentId: studentId, grade: '中2', subject, lessonType: 'regular', teacherType: 'normal', manualAdded: true })
    const weeks = withDesk(board.weeks, THU3, 1, (desk) => ({ ...desk, teacher: '鈴木', manualTeacher: true, lesson: { id: 'u1', studentSlots: [mk('c1', 'sC'), mk('d1', 'sD')] as [StudentEntry | null, StudentEntry | null] } }))
    const key = buildTemplatePendingDeskKey(thu3.id, thu3.desks[1].id)
    const pending = { [key]: { lower: { lesson: { id: 'lw', studentSlots: [mk('a1', 'sA', '英'), null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: WED, createdAt: 'x' } }
    const saved = saveMovedWithPending(weeks, board.suppressed, pending)
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(saved.nextWeeks, THU3)).not.toContain('sA')
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
  })
  function saveMovedWithPending(weeks: SlotCell[][], suppressed: string[], templatePendingDesks: TemplatePendingDeskMap) {
    return save(weeks, MOVED_ROWS, suppressed, { previousRegularLessons: OLD_ROWS, templatePendingDesks })
  }

  it('振替元が休日設定の日（決定記録 45）でも動く・在庫中立・不動点・再保存で何も起きない', () => {
    const hs = settings({ holidayDates: [WED] })
    const board = transferredBoard()
    const saved = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS, classroomSettings: hs })
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
    expect(where(saved.nextWeeks, 'sA')).toEqual([`${THU3}#0:makeup:数`])
    expectNeutral(saved, board.weeks, OLD_ROWS, MOVED_ROWS, board.suppressed, {}, hs)
    const again = save(saved.nextWeeks, MOVED_ROWS, suppressedAfter(board.suppressed, saved), { previousRegularLessons: MOVED_ROWS, classroomSettings: hs, templatePendingDesks: saved.nextPendingDesks })
    expect(again.summary.slotFollowMovedMakeups + again.summary.wholeDayTransferPlacedStudents + again.summary.wholeDayTransferPendingStudents).toBe(0)
  })

  for (const [label, targetDateKey] of [['別の週（翌週の木）', '2026-10-15'], ['同じ曜日（翌週の水）', '2026-10-14']] as const) {
    it(`振替先が${label}でも動く・二重なし・在庫中立・不動点`, () => {
      const w1 = buildWeek(OLD_ROWS)
      const w2 = buildWeek(OLD_ROWS, settings(), { startDate: '2026-10-12', endDate: '2026-10-18' })
      const weeks0 = [w1, w2]
      const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: OLD_ROWS, classroomSettings: settings(), weeks: weeks0, manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
      const result = computeWholeDayTransfer({ weeks: weeks0, sourceDateKey: WED, targetDateKey, manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {}, fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, scheduleCountAdjustments: [], students, teachers, regularLessons: OLD_ROWS, managedStudentByAnyName: roster, resolveDisplayName: (name: string) => name, resolveStockId: resolveStudentKey, ledgerOriginDatesByKey, leaveSourceRestMarkers: true })
      if (result.status !== 'transferred') throw new Error(result.message)
      const weeks = remerge(result.nextWeeks, OLD_ROWS, result.nextSuppressedRegularLessonOccurrences)
      const saved = save(weeks, MOVED_ROWS, result.nextSuppressedRegularLessonOccurrences, { previousRegularLessons: OLD_ROWS })
      expect(saved.summary.slotFollowMovedMakeups).toBe(1)
      expect(where(saved.nextWeeks, 'sA').filter((entry) => entry.includes(':makeup:'))).toEqual([`${targetDateKey}_3#0:makeup:数`])
      expectNeutral(saved, weeks, OLD_ROWS, MOVED_ROWS, result.nextSuppressedRegularLessonOccurrences)
    })
  }

  it('生徒 2 の席でも動く（置く席は Q35 が報告するテンプレの机・席＝生徒 1 が空なら盤面の席 1。Q40-2 と同じ）', () => {
    const rows0 = [row('r0', 't1', 'sD', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const rows1 = [row('r0', 't1', 'sD'), row('r5', 't1', '', 'sA', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const board = transferredBoard(rows0)
    const saved = save(board.weeks, rows1, board.suppressed, { previousRegularLessons: rows0 })
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
    expect(where(saved.nextWeeks, 'sA')).toEqual([`${THU3}#0:makeup:数`])
    expect(liveIds(saved.nextWeeks, THU_CELL)).not.toContain('sA')
    expectNeutral(saved, board.weeks, rows0, rows1, board.suppressed)
  })

  it('時限＋科目を 1 回で変えると追従ではなく「外す＋足す」（Q40-1 が旧科目を外し Q40-2 が新科目を置く）。二重なし', () => {
    const rows1 = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3, subject1: '英' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const board = transferredBoard()
    const saved = save(board.weeks, rows1, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups).toBe(0)
    expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(where(saved.nextWeeks, 'sA')).toEqual([`${THU3}#0:makeup:英`])
  })

  it('同じ生徒の 2 科目の時限を入れ替える（数 5→4・英 4→5）と、互いの INV-12 検査で動かず精算済みのまま（保守的・仕様に明記）', () => {
    const rows0 = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4), row('r3', 't3', 'sA', '', 3, { slotNumber: 4, subject1: '英' })]
    const rows1 = [row('r0', 't1', 'sA', '', 3, { slotNumber: 4 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4), row('r3', 't3', 'sA', '', 3, { slotNumber: 5, subject1: '英' })]
    const board = transferredBoard(rows0)
    const before = where(board.weeks, 'sA').sort()
    const saved = save(board.weeks, rows1, board.suppressed, { previousRegularLessons: rows0 })
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(where(saved.nextWeeks, 'sA').sort()).toEqual(before)
  })

  it('振替先の新しい時限のセルが無い（週トリム相当）なら動かさない', () => {
    const board = transferredBoard()
    const weeks = board.weeks.map((week) => week.filter((cell) => cell.id !== THU3))
    const saved = save(weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
  })

  it('L-2: 動かした生徒は「置かず振替を優先」の人数に数えない（同じ生徒を 2 行で出さない）', () => {
    const board = transferredBoard()
    const saved = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(0)
  })
})

// 決定記録 46（オーナー決定 2026-10-26「往復でも戻す」・Q40-9 M-2）: 5限 → 3限 → 5限と往復すると、2 回目で振替と移動元記録も 5限へ戻る。
describe('Q40-9 往復（5限 → 3限 → 5限）', () => {
  const MOVED_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  for (const [label, classroomSettings] of [['普通の日', settings()], ['振替元が休日設定の日（決定記録 45・机は振替の今の机番号で戻す）', settings({ holidayDates: [WED] })]] as const) {
    it(`${label}: 2 回目の保存で木 3限の振替が木 5限 机 0 へ戻り、もとの表示も 5限、水の移動元記録も 5限へ。在庫中立・−1 なし・不動点・3 回目の再保存で何も起きない`, () => {
      const board = transferredBoard()
      const before = balances(board.weeks, OLD_ROWS, board.ledgers, classroomSettings)
      const first = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS, classroomSettings })
      expect(first.summary.slotFollowMovedMakeups).toBe(1)
      const suppressed1 = suppressedAfter(board.suppressed, first)
      const second = save(first.nextWeeks, OLD_ROWS, suppressed1, { previousRegularLessons: MOVED_ROWS, classroomSettings, templatePendingDesks: first.nextPendingDesks })
      expect(second.summary.slotFollowMovedMakeups).toBe(1)
      expect(second.slotFollowMoves[0]).toMatchObject({ oldSlotNumber: 3, newSlotNumber: 5, targetDateKey: THU, deskIndex: 0, placement: 'upper' })
      expect(cellOf(second.nextWeeks, THU_CELL).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 5限' })
      expect(liveIds(second.nextWeeks, `${THU}_3`)).not.toContain('sA')
      expect(liveIds(second.nextWeeks, THU_CELL).filter((id) => id === 'sA')).toHaveLength(1)
      expect(cellOf(second.nextWeeks, WED_CELL).desks.some((desk) => desk.statusSlots?.some((entry) => entry?.status === 'moved' && entry.managedStudentId === 'sA' && entry.lessonType === 'regular' && entry.moveDestinationDateKey === THU && entry.moveDestinationSlotNumber === 5))).toBe(true)
      expect(cellOf(second.nextWeeks, `${WED}_3`).desks.some((desk) => desk.statusSlots?.some((entry) => entry?.managedStudentId === 'sA'))).toBe(false)
      expect(liveIds(second.nextWeeks, WED_CELL)).toEqual([])
      expect(second.wholeDayTransferCountAdjustments).toEqual([])
      expect(second.manualMakeupOriginAdditions).toEqual([])
      const after = balances(second.nextWeeks, OLD_ROWS, board.ledgers, classroomSettings, {}, second.nextPendingDesks)
      expect(after['sA__数'] ?? 0).toBe(before['sA__数'] ?? 0)
      expectFixpoint(second, OLD_ROWS, suppressed1, classroomSettings)
      const suppressed2 = suppressedAfter(suppressed1, second)
      const third = save(second.nextWeeks, OLD_ROWS, suppressed2, { previousRegularLessons: OLD_ROWS, classroomSettings, templatePendingDesks: second.nextPendingDesks })
      expect(third.summary.slotFollowMovedMakeups + third.summary.slotFollowPendingMakeups + third.summary.wholeDayTransferPlacedStudents + third.summary.orphanedMakeupsRemoved).toBe(0)
    })
  }
})

// 再監査（regression-reviewer 2026-10-26・きっかけの作り直しの後）で足した行: M-A（別の丸ごと振替の日への 1 コマ D&D）・L-A（人数が負にならない）・L-B（その日のテンプレに無い）・
// L-C（休日の往復の机番号）・L-D（移動元記録が旧時限に残った後の往復）・L-3（年度の絞り込み）・5→3→4。
describe('Q40-9 再監査の兄弟（regression-reviewer 2026-10-26・2 回目）', () => {
  const MOVED_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const roster = new Map(students.map((student) => [student.name, student]))
  const TUE = '2026-10-06'
  const where = (weeks: SlotCell[][], id: string) => weeks.flat().flatMap((cell) => cell.desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).flatMap((student) => (student?.managedStudentId === id ? [`${cell.id}#${deskIndex}:${student.lessonType}`] : []))))
  function transfer(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], sourceDateKey: string, targetDateKey: string) {
    const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: rows, classroomSettings: settings(), weeks, manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
    const result = computeWholeDayTransfer({ weeks, sourceDateKey, targetDateKey, manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {}, fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: suppressed, suppressedMakeupOrigins: {}, scheduleCountAdjustments: [], students, teachers, regularLessons: rows, managedStudentByAnyName: roster, resolveDisplayName: (name: string) => name, resolveStockId: resolveStudentKey, ledgerOriginDatesByKey, leaveSourceRestMarkers: true })
    if (result.status !== 'transferred') throw new Error(result.message)
    return { weeks: remerge(result.nextWeeks, rows, result.nextSuppressedRegularLessonOccurrences), suppressed: result.nextSuppressedRegularLessonOccurrences }
  }
  function move(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], studentId: string, cellId: string, deskIndex: number) {
    const result = computeStudentMove({ weeks, weekIndex: 0, cells: weeks[0], movingStudentId: studentId, cellId, deskIndex, studentIndex: 0, suppressedRegularLessonOccurrences: suppressed, managedStudentByAnyName: roster, resolveBoardStudentDisplayName: (name) => name })
    if (result.status !== 'moved') throw new Error(result.message)
    return { weeks: remerge(result.nextWeeks, rows, result.nextSuppressedRegularLessonOccurrences), suppressed: result.nextSuppressedRegularLessonOccurrences }
  }

  it('M-A（INV-02）: 水→木・火→金 の 2 つの丸ごと振替の後、A を水へ戻して金（別の丸ごと振替の日）の 5限へ 1 コマ D&D した振替は、時限を変えても動かさない', () => {
    const rTu = row('rTu', 't3', 'sC', '', 2)
    const OLD = [...OLD_ROWS, rTu]
    const MOVED = [...MOVED_ROWS, rTu]
    let state = transfer([buildWeek(OLD)], OLD, [], WED, THU)
    state = transfer(state.weeks, OLD, state.suppressed, TUE, FRI)
    const makeupA = cellOf(state.weeks, THU_CELL).desks[0].lesson!.studentSlots[0]!
    state = move(state.weeks, OLD, state.suppressed, makeupA.id, WED_CELL, 0)
    const back = cellOf(state.weeks, WED_CELL).desks[0].lesson!.studentSlots[0]!
    state = move(state.weeks, OLD, state.suppressed, back.id, FRI_CELL, 1)
    // 前提: 1 コマ D&D の記録には丸ごと振替の印が無い
    expect(cellOf(state.weeks, WED_CELL).desks.flatMap((desk) => desk.statusSlots ?? []).find((entry) => entry?.managedStudentId === 'sA' && entry.status === 'moved')).toMatchObject({ moveDestinationDateKey: FRI })
    expect(cellOf(state.weeks, WED_CELL).desks.flatMap((desk) => desk.statusSlots ?? []).find((entry) => entry?.managedStudentId === 'sA' && entry.status === 'moved')?.wholeDayTransfer).toBeUndefined()
    const saved = save(state.weeks, MOVED, state.suppressed, { previousRegularLessons: OLD })
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(where(saved.nextWeeks, 'sA').filter((entry) => entry.includes(':makeup'))).toEqual([`${FRI_CELL}#1:makeup`])
  })

  it('丸ごと振替が作る移動元記録には印（wholeDayTransfer）が付き、時限の追従で移した記録にも付く', () => {
    const board = transferredBoard()
    expect(cellOf(board.weeks, WED_CELL).desks[0].statusSlots?.[0]).toMatchObject({ status: 'moved', managedStudentId: 'sA', wholeDayTransfer: true })
    const saved = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(cellOf(saved.nextWeeks, `${WED}_3`).desks[0].statusSlots?.find((entry) => entry?.managedStudentId === 'sA')).toMatchObject({ status: 'moved', wholeDayTransfer: true, moveDestinationSlotNumber: 3 })
  })

  it('印の無い旧データ（v1.5.642 までの丸ごと振替の記録）でも、振替の授業 ID が daymove_<振替元の日>_ なら丸ごと振替の組として動く', () => {
    const board = transferredBoard()
    const legacy = withDesk(board.weeks, WED_CELL, 0, (desk) => ({ ...desk, statusSlots: desk.statusSlots?.map((entry) => (entry ? { ...entry, wholeDayTransfer: undefined } : entry)) as typeof desk.statusSlots }))
    expect(cellOf(legacy, THU_CELL).desks[0].lesson?.id.startsWith(`daymove_${WED}_`)).toBe(true)
    const saved = save(legacy, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
  })

  it('L-A: 往復の 2 回目で「置かず振替を優先」の人数が負にならない', () => {
    const board = transferredBoard()
    const first = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    const second = save(first.nextWeeks, OLD_ROWS, suppressedAfter(board.suppressed, first), { previousRegularLessons: MOVED_ROWS, templatePendingDesks: first.nextPendingDesks })
    expect(second.summary.slotFollowMovedMakeups).toBe(1)
    expect(second.summary.wholeDayTransferSkippedStudents).toBeGreaterThanOrEqual(0)
  })

  it('L-B: その日のテンプレが新しい時限にその生徒を持たない（行の開始日が振替元より後）なら動かさない', () => {
    const board = transferredBoard()
    const NEXT = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3, startDate: '2026-10-21' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(board.weeks, NEXT, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(saved.summary.slotFollowMovedMakeups + saved.summary.slotFollowPendingMakeups).toBe(0)
    expect(liveIds(saved.nextWeeks, THU_CELL)).toContain('sA')
  })

  for (const [label, classroomSettings] of [['普通の日', settings()], ['振替元が休日設定の日', settings({ holidayDates: [WED] })]] as const) {
    it(`L-C（${label}）: 3限で A のテンプレの机が 1 のとき往復すると、5限のテンプレの机 0 へ戻る（休日でも普通の日と同じ）`, () => {
      const rT = row('rT', 't3', '', '', 3, { slotNumber: 3 })
      const OLD = [rT, ...OLD_ROWS]
      const MOVED = [rT, ...MOVED_ROWS]
      const board = transferredBoard(OLD)
      const first = save(board.weeks, MOVED, board.suppressed, { previousRegularLessons: OLD, classroomSettings })
      expect(first.slotFollowMoves[0]).toMatchObject({ newSlotNumber: 3, deskIndex: 1 })
      const second = save(first.nextWeeks, OLD, suppressedAfter(board.suppressed, first), { previousRegularLessons: MOVED, classroomSettings, templatePendingDesks: first.nextPendingDesks })
      expect(second.slotFollowMoves[0]).toMatchObject({ newSlotNumber: 5, deskIndex: 0, placement: 'upper' })
      expect(cellOf(second.nextWeeks, THU_CELL).desks[0].lesson?.studentSlots.some((student) => student?.managedStudentId === 'sA')).toBe(true)
    })
  }

  it('L-D: 1 回目に移動元記録の移し先が無く旧時限に残っても（行き先の時限は直す）、往復の 2 回目で振替が戻る', () => {
    const board = transferredBoard()
    const fill = (id: string, studentId: string): StudentEntry => ({ id, name: studentId, managedStudentId: studentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true })
    const weeks = board.weeks.map((week) => week.map((cell) => (cell.id !== `${WED}_3` ? cell : { ...cell, desks: cell.desks.map((desk, index) => ({ ...desk, teacher: '佐藤', manualTeacher: true, lesson: { id: `f${index}`, studentSlots: [fill(`x${index}`, 'sD'), fill(`y${index}`, 'sE')] as [StudentEntry | null, StudentEntry | null] } })) })))
    const first = save(weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    expect(first.summary.slotFollowMovedMakeups).toBe(1)
    expect(cellOf(first.nextWeeks, WED_CELL).desks[0].statusSlots?.find((entry) => entry?.managedStudentId === 'sA')).toMatchObject({ status: 'moved', moveDestinationDateKey: THU, moveDestinationSlotNumber: 3, wholeDayTransfer: true })
    const second = save(first.nextWeeks, OLD_ROWS, suppressedAfter(board.suppressed, first), { previousRegularLessons: MOVED_ROWS, templatePendingDesks: first.nextPendingDesks })
    expect(second.summary.slotFollowMovedMakeups).toBe(1)
    expect(liveIds(second.nextWeeks, THU_CELL)).toContain('sA')
    expect(cellOf(second.nextWeeks, WED_CELL).desks.flatMap((desk) => desk.statusSlots ?? []).filter((entry) => entry?.managedStudentId === 'sA')).toEqual([expect.objectContaining({ moveDestinationSlotNumber: 5 })])
  })

  it('L-3: 保存前の行に前年度の行（A の水 3限）が残っていても、今年度の行で時限の入れ替わりを判定して動かす', () => {
    const board = transferredBoard()
    const prevYear = row('old', 't1', 'sA', '', 3, { slotNumber: 3, schoolYear: 2025 })
    const saved = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: [...OLD_ROWS, prevYear] })
    expect(saved.summary.slotFollowMovedMakeups).toBe(1)
  })

  it('5限 → 3限 → 4限: 2 回目も新しい時限（4限）へ動く。3 回目の再保存で何も起きない', () => {
    const ROWS4 = [row('r0', 't1', 'sA', '', 3, { slotNumber: 4 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const board = transferredBoard()
    const first = save(board.weeks, MOVED_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS })
    const suppressed1 = suppressedAfter(board.suppressed, first)
    const second = save(first.nextWeeks, ROWS4, suppressed1, { previousRegularLessons: MOVED_ROWS, templatePendingDesks: first.nextPendingDesks })
    expect(second.summary.slotFollowMovedMakeups).toBe(1)
    expect(where(second.nextWeeks, 'sA').filter((entry) => entry.includes(':makeup'))).toEqual([`${THU}_4#0:makeup`])
    expectFixpoint(second, ROWS4, suppressed1)
    const third = save(second.nextWeeks, ROWS4, suppressedAfter(suppressed1, second), { previousRegularLessons: ROWS4, templatePendingDesks: second.nextPendingDesks })
    expect(third.summary.slotFollowMovedMakeups + third.summary.wholeDayTransferPlacedStudents + third.summary.orphanedMakeupsRemoved).toBe(0)
  })
})

// 確認リスト tp-51（受付 20261027-144006023-5e34fa4b・v1.5.649・オーナー報告「同じコマ内で科目を変えたとき、反映以降の丸ごと振替した日のコマでその生徒がいなくなる」）。
// 真因: Q40-2 は新科目を「テンプレの机番号」の机へ置くが、丸ごと振替の 1 対 1 の写像は盤面の机番号（振替元の机 i → 振替先の机 i）で、盤面の机の並びは
// テンプレの机番号とずれうる（手置き講師・Q41-13 のずらし・同じコマ内の D&D・再マージの講師机の置き直し など）。ずれていると旧科目の振替は外れるのに、新科目は別の講師の机
// （満席なら次の机）へ入り、元の日の「休)」も別の机に付くか付かない＝室長からは「移した先の机から生徒が消えた」と見えた（実データ: 振替先の机 6 の振替が外れ、新科目は机 2 へ、
// 振替元の「休)」は消えた）。修正: 同じ保存で外した旧科目の振替の机・席と旧科目の記録の机・席を、新科目の置き場の第一候補にする（collectReplacedTransferSeats）。
describe('tp-51 科目変更 × 盤面の机の並びがテンプレの机番号とずれた丸ごと振替（INV-06 / INV-12 / INV-02・2026-10-27）', () => {
  const shiftSettings = (extra: Partial<ClassroomSettings> = {}) => settings({ deskCount: 3, ...extra })
  const SUBJECT_ROWS = [row('r0', 't1', 'sA', '', 3, { subject1: '英' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const roster = new Map(students.map((student) => [student.name, student]))
  const seatsOf = (weeks: SlotCell[][], id: string, studentId: string) => cellOf(weeks, id).desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).flatMap((student, seat) => (student?.managedStudentId === studentId ? [`${deskIndex}#${seat}:${student.lessonType}:${student.subject}`] : [])))
  const recordsOf = (weeks: SlotCell[][], id: string, studentId: string) => cellOf(weeks, id).desks.flatMap((desk, deskIndex) => (desk.statusSlots ?? []).flatMap((entry, seat) => (entry?.managedStudentId === studentId ? [`${deskIndex}#${seat}:${entry.status}:${entry.subject}`] : [])))

  /**
   * 振替元の日（水 5限）の盤面で A の授業がテンプレの机 0 ではなく机 2 に居る形で、水 → 木へ丸ごと振替する。
   * swap ＝ 机ごと（講師＋生徒）入れ替わった形（手置き講師・講師机の置き直しなどで並びがずれた実データの形）。dnd ＝ 同じコマ内の D&D で A だけ机 2 へ動かした形。
   */
  function shiftedBoard(mode: 'swap' | 'dnd') {
    const classroomSettings = shiftSettings()
    let weeks = remerge([buildWeek(OLD_ROWS, classroomSettings)], OLD_ROWS, [], classroomSettings)
    let suppressed: string[] = []
    if (mode === 'swap') {
      weeks = weeks.map((week) => week.map((cell) => (cell.id !== WED_CELL ? cell : { ...cell, desks: [{ ...cell.desks[2], id: cell.desks[0].id }, cell.desks[1], { ...cell.desks[0], id: cell.desks[2].id }] })))
    } else {
      const a = cellOf(weeks, WED_CELL).desks[0].lesson!.studentSlots[0]!
      const moved = computeStudentMove({ weeks, weekIndex: 0, cells: weeks[0], movingStudentId: a.id, cellId: WED_CELL, deskIndex: 2, studentIndex: 0, suppressedRegularLessonOccurrences: [], managedStudentByAnyName: roster, resolveBoardStudentDisplayName: (name) => name })
      if (moved.status !== 'moved') throw new Error(moved.message)
      suppressed = moved.nextSuppressedRegularLessonOccurrences
      weeks = remerge(moved.nextWeeks, OLD_ROWS, suppressed, classroomSettings)
    }
    const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: OLD_ROWS, classroomSettings, weeks, manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
    const result = computeWholeDayTransfer({
      weeks, sourceDateKey: WED, targetDateKey: THU, manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {},
      fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: suppressed, suppressedMakeupOrigins: {}, scheduleCountAdjustments: [], students, teachers, regularLessons: OLD_ROWS,
      managedStudentByAnyName: roster, resolveDisplayName: (name: string) => name, resolveStockId: resolveStudentKey, ledgerOriginDatesByKey, leaveSourceRestMarkers: true,
    })
    if (result.status !== 'transferred') throw new Error(result.message)
    const board = { weeks: remerge(result.nextWeeks, OLD_ROWS, result.nextSuppressedRegularLessonOccurrences, classroomSettings), suppressed: result.nextSuppressedRegularLessonOccurrences, ledgers: result.nextManualMakeupAdjustments }
    // 前提: 盤面では A の振替が木 5限 机 2・水 5限 の「休)」も机 2（テンプレの A の机は 0）。
    expect(seatsOf(board.weeks, THU_CELL, 'sA')).toEqual(['2#0:makeup:数'])
    expect(recordsOf(board.weeks, WED_CELL, 'sA')).toEqual(['2#0:moved:数'])
    return board
  }

  for (const mode of ['swap', 'dnd'] as const) {
    for (const [label, holiday] of [['普通の日', false], ['振替元を休日設定した後（決定記録 45）', true]] as const) {
      it(`${mode === 'swap' ? '机ごとずれた形' : '同じコマ内の D&D でずれた形'}・${label}: 科目を変えると、新科目の振替は旧科目が居た木 5限 机 2 の同じ席へ、水の「休)」も机 2 へ（テンプレの机 0 へ行かない）。二重なし・在庫中立・不動点・再保存で何も起きない`, () => {
        const board = shiftedBoard(mode)
        const classroomSettings = shiftSettings(holiday ? { holidayDates: [WED] } : {})
        const before = balances(board.weeks, OLD_ROWS, board.ledgers, classroomSettings)
        const saved = save(board.weeks, SUBJECT_ROWS, board.suppressed, { classroomSettings })
        expect(saved.summary.orphanedMakeupsRemoved).toBe(1)
        expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
        expect(saved.summary.wholeDayTransferPendingStudents + saved.summary.wholeDayTransferStockedStudents).toBe(0)
        expect(saved.wholeDayTransferPlaced[0]).toMatchObject({ fallbackDesk: false, seatIndex: 0 })
        expect(saved.wholeDayTransferCountAdjustments).toEqual([])
        expect(saved.manualMakeupOriginAdditions).toEqual([])
        // 木: 旧科目が居た机 2 の同じ席に新科目（INV-12: 1 か所だけ・旧科目は消える）
        expect(seatsOf(saved.nextWeeks, THU_CELL, 'sA')).toEqual(['2#0:makeup:英'])
        expect(cellOf(saved.nextWeeks, THU_CELL).desks[2].lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: WED })
        // 水: 「休)」も旧科目の記録があった机 2 の同じ席へ（科目だけ差し替わる）
        expect(recordsOf(saved.nextWeeks, WED_CELL, 'sA')).toEqual(['2#0:moved:英'])
        expect(liveIds(saved.nextWeeks, WED_CELL)).toEqual([])
        // 確認の画面: 「別の机」ではない（同じ机へ置いた）
        expect(saved.studentNotes.find((note) => note.kind === 'transfer-placed')?.detail ?? '').not.toContain('別の机')
        // 在庫中立（旧科目・新科目とも 0。B も保存前と同じ）
        const after = balances(saved.nextWeeks, SUBJECT_ROWS, board.ledgers, classroomSettings)
        expect(after['sA__英'] ?? 0).toBe(0)
        expect(after['sA__数'] ?? 0).toBe(0)
        expect(after['sB__数'] ?? 0).toBe(before['sB__数'] ?? 0)
        expectFixpoint(saved, SUBJECT_ROWS, board.suppressed, classroomSettings)
        const again = save(saved.nextWeeks, SUBJECT_ROWS, suppressedAfter(board.suppressed, saved), { classroomSettings, templatePendingDesks: saved.nextPendingDesks })
        expect(again.summary.wholeDayTransferPlacedStudents + again.summary.orphanedMakeupsRemoved + again.summary.wholeDayTransferPendingStudents).toBe(0)
        expect(seatsOf(again.nextWeeks, THU_CELL, 'sA')).toEqual(['2#0:makeup:英'])
      })
    }
  }

  it('兄弟: 科目を戻す（英 → 数）2 回目の保存でも、同じ机 2 の同じ席で科目だけ差し替わる（往復）', () => {
    const board = shiftedBoard('swap')
    const first = save(board.weeks, SUBJECT_ROWS, board.suppressed, { classroomSettings: shiftSettings() })
    const suppressed1 = suppressedAfter(board.suppressed, first)
    const second = save(first.nextWeeks, OLD_ROWS, suppressed1, { classroomSettings: shiftSettings(), templatePendingDesks: first.nextPendingDesks })
    expect(second.summary.orphanedMakeupsRemoved).toBe(1)
    expect(second.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(seatsOf(second.nextWeeks, THU_CELL, 'sA')).toEqual(['2#0:makeup:数'])
    expect(recordsOf(second.nextWeeks, WED_CELL, 'sA')).toEqual(['2#0:moved:数'])
    expectFixpoint(second, OLD_ROWS, suppressed1, shiftSettings())
  })

  it('兄弟: 時限を変えた後に科目を変える順（2026-10-21 修正の形）でも、新科目は時限の追従で動かした振替の机・席へ入り、二重にならない', () => {
    const board = shiftedBoard('swap')
    const SLOT3_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const SLOT3_SUBJECT_ROWS = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3, subject1: '英' }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const first = save(board.weeks, SLOT3_ROWS, board.suppressed, { previousRegularLessons: OLD_ROWS, classroomSettings: shiftSettings() })
    expect(first.summary.slotFollowMovedMakeups).toBe(1)
    const followed = seatsOf(first.nextWeeks, `${THU}_3`, 'sA')
    expect(followed).toHaveLength(1)
    const followedRecord = recordsOf(first.nextWeeks, `${WED}_3`, 'sA')
    const suppressed1 = suppressedAfter(board.suppressed, first)
    const second = save(first.nextWeeks, SLOT3_SUBJECT_ROWS, suppressed1, { previousRegularLessons: SLOT3_ROWS, classroomSettings: shiftSettings(), templatePendingDesks: first.nextPendingDesks, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 3)]) } })
    expect(second.summary.orphanedMakeupsRemoved).toBe(1)
    expect(second.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(seatsOf(second.nextWeeks, `${THU}_3`, 'sA')).toEqual([followed[0].replace(':数', ':英')])
    expect(seatsOf(second.nextWeeks, THU_CELL, 'sA')).toEqual([])
    expect(recordsOf(second.nextWeeks, `${WED}_3`, 'sA')).toEqual(followedRecord.map((entry) => entry.replace(':数', ':英')))
    expectFixpoint(second, SLOT3_SUBJECT_ROWS, suppressed1, shiftSettings())
  })

  it('兄弟: 生徒を足すだけ（旧科目の振替が無い）なら手がかりは無く、従来どおりテンプレの机番号から置く（C は木 5限 机 0＝テンプレの机。A の机 2 には入らない）', () => {
    const board = shiftedBoard('swap')
    const ADD_ROWS = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const saved = save(board.weeks, ADD_ROWS, board.suppressed, { classroomSettings: shiftSettings() })
    expect(saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(seatsOf(saved.nextWeeks, THU_CELL, 'sC')).toEqual(['0#1:makeup:数'])
    expect(seatsOf(saved.nextWeeks, THU_CELL, 'sA')).toEqual(['2#0:makeup:数'])
  })
})
