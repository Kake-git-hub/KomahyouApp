// ============================================================================
// 第 2 版の規則の権威関数（templateConflictRules.ts・docs/spec-template-conflict-v2.md §2-2〜§2-4・§4-2 規則 1）
//   - applyTemplateOriginRulesToManagedCell: 再マージ（フラグ ON）が差分反映と同じ生徒・講師をテンプレから外す（不動点の要）
//   - フラグ OFF の再マージ（templateOriginRules を渡さない）は従来どおり（本番 3 校の挙動は変えない）
//   - resolveManualFirstCountAdjustments: §2-2 の −1 は 2 回目の保存で二重に積まない（INV-03）
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { applyTemplateOriginRulesToManagedCell, collectTemplateBlockersInCell, findManualTeacherDeskElsewhere, isTemplateBlockingRecordStatus, resolveManualFirstCountAdjustments, resolveTemplateStudentBlock } from './templateConflictRules'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'

const DATE = '2026-10-07'
const CELL_ID = `${DATE}_5`
const student = (overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id: 's', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides })
const cellWith = (desks: SlotCell['desks']): SlotCell => ({ id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true, desks })

describe('判定の材料（§2-2〜§2-4）', () => {
  it('§2-4 の記録は休み・振無休・出席・移)。休日の表示専用の記録は入れない', () => {
    expect(['absent', 'absent-no-makeup', 'attended', 'moved'].every((status) => isTemplateBlockingRecordStatus(status as never))).toBe(true)
    expect(isTemplateBlockingRecordStatus('holiday')).toBe(false)
  })

  it('手入力の生徒（上段・保留の下段）と記録は生徒の根拠、手置き講師（上段・下段）は講師の根拠。テンプレ由来の生徒は根拠にならない', () => {
    const cell = cellWith([
      { id: 'd1', teacher: '田中', lesson: { id: 'managed_x', studentSlots: [student({ id: 't', managedStudentId: 'sT' }), null] } },
      { id: 'd2', teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand', studentSlots: [student({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } },
    ])
    const pending = { [buildTemplatePendingDeskKey(CELL_ID, 'd1')]: { lower: { lesson: { id: 'l', studentSlots: [student({ id: 'b', managedStudentId: 'sB', manualAdded: true }), null] as [StudentEntry | null, StudentEntry | null] }, teacher: { teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual' as const } }, effectiveStartDate: DATE, createdAt: 'x' } }
    const blockers = collectTemplateBlockersInCell(cell, pending)
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sA', name: '青木' }, blockers.students)).toBe('manual')
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sB', name: '馬場' }, blockers.students)).toBe('manual')
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sT', name: 'テ' }, blockers.students)).toBeNull()
    expect(findManualTeacherDeskElsewhere(0, { teacher: '佐藤' }, blockers.teachers)).toBe(1)
    expect(findManualTeacherDeskElsewhere(1, { teacher: '佐藤' }, blockers.teachers)).toBe(-1)
    expect(findManualTeacherDeskElsewhere(1, { teacher: '鈴木' }, blockers.teachers)).toBe(0)
  })

  it('applyTemplateOriginRulesToManagedCell: 手入力の同じ生徒・別の机の手置き講師と同じ講師を管理セルから外す。根拠が無ければ参照ごと返す', () => {
    const managed = cellWith([
      { id: 'm1', teacher: '佐藤', lesson: { id: 'managed_r0', note: '管理データ反映', studentSlots: [student(), null] } },
      { id: 'm2', teacher: '田中', lesson: { id: 'managed_r1', note: '管理データ反映', studentSlots: [student({ id: 'c', managedStudentId: 'sC', name: '千葉' }), null] } },
    ])
    const board = cellWith([
      { id: 'd1', teacher: '' },
      { id: 'd2', teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand', studentSlots: [student({ lessonType: 'special' }), null] } },
    ])
    const ruled = applyTemplateOriginRulesToManagedCell(managed, board, {})
    expect(ruled.desks[0].lesson).toBeUndefined()
    expect(ruled.desks[0].teacher).toBe('')
    expect(ruled.desks[1]).toBe(managed.desks[1])
    expect(applyTemplateOriginRulesToManagedCell(managed, cellWith([{ id: 'd1', teacher: '' }]), {})).toBe(managed)
  })
})

describe('再マージ: フラグ ON だけ規則を当てる（OFF＝本番 3 校は従来どおり）', () => {
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }]
  const rows: RegularLessonRow[] = [{ id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 }]
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const week = buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [] })
    .map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : { ...desk, lesson: { id: 'hand', studentSlots: [student({ id: 'a_lecture', lessonType: 'special' }), null] as [StudentEntry | null, StudentEntry | null] } })) }))
  const run = (on: boolean) => remergeBoardWeeksWithManagedData([week], { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: [], todayKey: '2026-09-29', templateOriginRules: on ? { pendingDesks: {} } : null })
  const aliveA = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL_ID)!.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((item) => item?.managedStudentId === 'sA').length

  it('OFF: 手で置いた講習の A がいても、テンプレの A を空いた机に置く（従来の挙動・INV-12 の警告で知らせる）', () => {
    expect(aliveA(run(false))).toBe(2)
  })
  it('ON（§2-2）: 手入力の A が勝つ＝テンプレの A を置かない。抑止キーは要らない', () => {
    expect(aliveA(run(true))).toBe(1)
  })
})

describe('§4-2 規則 1 の −1（resolveManualFirstCountAdjustments）', () => {
  const skipped = [{ student: student(), dateKey: DATE, slotNumber: 5, deskIndex: 0 }]
  it('置かなかったテンプレの授業は予定数に数えない＝−1（手入力が同じ科目でも）', () => {
    expect(resolveManualFirstCountAdjustments({ skipped, scheduleCountAdjustments: [], suppressedRegularLessonOccurrences: [] }).map((item) => item.dateKey)).toEqual([DATE])
  })
  it('前の保存で −1 済み（削除の記録で説明できない純減）なら積まない＝2 回目の保存で二重にしない', () => {
    const previous = [{ studentKey: 'sA', subject: '数', countKind: 'regular' as const, dateKey: DATE, delta: -1 }]
    expect(resolveManualFirstCountAdjustments({ skipped, scheduleCountAdjustments: previous, suppressedRegularLessonOccurrences: [] })).toEqual([])
  })
  it('その日の −1 が削除の記録（抑止キー）の分なら、§2-2 の −1 は別に積む', () => {
    const previous = [{ studentKey: 'sA', subject: '数', countKind: 'regular' as const, dateKey: DATE, delta: -1 }]
    expect(resolveManualFirstCountAdjustments({ skipped, scheduleCountAdjustments: previous, suppressedRegularLessonOccurrences: [`sA__数__${DATE}__3`] })).toHaveLength(1)
  })
})
