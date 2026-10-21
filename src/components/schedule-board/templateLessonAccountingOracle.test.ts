// 監査関数（保存則）の単体テスト（2026-10-21・regression-reviewer O-1/O-2/O-3）。
import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { auditTemplateLessonAccounting } from './templateLessonAccountingOracle'

const WED = '2026-10-07'
const THU = '2026-10-08'
const NEXT_WED = '2026-10-14'
const students: StudentRow[] = [{ id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
const settings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2 } as unknown as ClassroomSettings
const row = (id: string, slotNumber: number, subject = '数'): RegularLessonRow => ({ id, schoolYear: 2026, teacherId: 't1', student1Id: 'sC', subject1: subject, startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber })
const C: StudentEntry = { id: 'sC_x', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }
const makeup = (sourceDateKey: string, label?: string): StudentEntry => ({ ...C, id: `sC_mk_${label ?? 'x'}`, lessonType: 'makeup', makeupSourceDate: sourceDateKey, makeupSourceLabel: label })
const status = (slotNumber: number, kind: StudentStatusEntry['status'], extra: Partial<StudentStatusEntry> = {}): StudentStatusEntry => ({ id: `st_${slotNumber}_${kind}`, studentId: 'sC_x', sourceManagedLesson: true, name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: WED, slotNumber, recordedAt: '2026-10-01T00:00:00.000Z', status: kind, sourceLessonId: 'lesson', ...extra })
const desk = (id: string, teacher: string, slots?: [StudentEntry | null, StudentEntry | null], statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]): DeskCell => ({ id, teacher, ...(slots ? { lesson: { id: `lesson_${id}`, studentSlots: slots } } : {}), ...(statusSlots ? { statusSlots } : {}) })
const cell = (dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell => ({ id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: dateKey, slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks })
const audit = (weeks: SlotCell[][], rows: RegularLessonRow[], extra: Partial<Parameters<typeof auditTemplateLessonAccounting>[0]> = {}) =>
  auditTemplateLessonAccounting({ weeks, regularLessons: rows, students, classroomSettings: settings, scheduleCountAdjustments: [], manualMakeupAdjustments: {}, fromDate: WED, toDate: THU, today: new Date('2026-10-01T00:00:00'), ...extra })

describe('auditTemplateLessonAccounting（保存則の監査）', () => {
  it('説明が揃っていれば違反なし: 置いた通常授業／移動元の記録＋その振替／−1', () => {
    const weeks = [[
      cell(WED, 3, [desk('w3', '田中', [C, null])]),
      cell(WED, 5, [desk('w5', '', undefined, [status(5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 }), null])]),
      cell(THU, 5, [desk('t5', '田中', [makeup(WED, '2026/10/7(水) 5限'), null])]),
    ]]
    expect(audit(weeks, [row('r3', 3), row('r5', 5)])).toEqual([])
    const adjusted = [[cell(WED, 5, [desk('w5', '')])]]
    expect(audit(adjusted, [row('r5', 5)], { scheduleCountAdjustments: [{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: WED, delta: -1 }] })).toEqual([])
  })
  it('O-1: 3限を休み（台帳の origin ＋ absent の記録）にした上で 4限が黙って消えた形は、休みの記録と origin を二重に数えずに「無言の消失」とする', () => {
    const weeks = [[
      cell(WED, 3, [desk('w3', '田中', undefined, [status(3, 'absent'), null])]),
      cell(WED, 4, [desk('w4', '田中')]),
    ]]
    const violations = audit(weeks, [row('r3', 3), row('r4', 4)])
    expect(violations.map((item) => ({ kind: item.kind, expected: item.expected, explained: item.explained }))).toEqual([{ kind: 'missing', expected: 2, explained: 1 }])
  })
  it('O-1: 移動元の記録と、その記録と対になる振替（同じ時限）は 1 授業として数える。時限不明の振替は対が取れないので別に数える', () => {
    const moved = [[
      cell(WED, 5, [desk('w5', '', undefined, [status(5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 }), null])]),
      cell(WED, 4, [desk('w4', '田中')]),
      cell(THU, 5, [desk('t5', '田中', [makeup(WED, '2026/10/7(水) 5限'), null])]),
    ]]
    expect(audit(moved, [row('r4', 4), row('r5', 5)]).map((item) => item.kind)).toEqual(['missing'])
    const unknownLabel = [[
      cell(WED, 5, [desk('w5', '', undefined, [status(5, 'moved', { moveDestinationDateKey: THU }), null])]),
      cell(WED, 4, [desk('w4', '田中')]),
      cell(THU, 5, [desk('t5', '田中', [makeup(WED), null])]),
    ]]
    expect(audit(unknownLabel, [row('r4', 4), row('r5', 5)])).toEqual([])
  })
  it('O-2: 振替先が監査の範囲の外（翌週）でも振替元の説明になる＝誤検出しない', () => {
    const weeks = [[
      cell(WED, 5, [desk('w5', '', undefined, [status(5, 'moved', { moveDestinationDateKey: NEXT_WED, moveDestinationSlotNumber: 5 }), null])]),
    ], [
      cell(NEXT_WED, 5, [desk('n5', '田中', [makeup(WED, '2026/10/7(水) 5限'), null])]),
    ]]
    expect(audit(weeks, [row('r5', 5)])).toEqual([])
  })
  it('O-3: 希望回数の +1 の戻しは −1 を打ち消す', () => {
    const weeks = [[cell(WED, 5, [desk('w5', '')])]]
    const entries = [{ studentKey: 'sC', subject: '数', countKind: 'regular' as const, dateKey: WED, delta: -1 }, { studentKey: 'sC', subject: '数', countKind: 'regular' as const, dateKey: WED, delta: 1 }]
    expect(audit(weeks, [row('r5', 5)], { scheduleCountAdjustments: entries }).map((item) => item.kind)).toEqual(['missing'])
  })
  it('根拠の無い振替: 振替元の日にテンプレの授業も origin も休みの記録も無い振替（保留の下段も見る）', () => {
    const weeks = [[cell(WED, 5, [desk('w5', '田中')]), cell(THU, 5, [desk('t5', '田中', [makeup(WED, '2026/10/7(水) 5限'), null])])]]
    expect(audit(weeks, [row('r5', 5, '英')]).map((item) => ({ kind: item.kind, subject: item.subject }))).toEqual([{ kind: 'missing', subject: '英' }, { kind: 'surplus-makeup', subject: '数' }])
    const lower = [[cell(THU, 5, [desk('t5', '田中')])]]
    const pending = { [`${THU}_5::t5`]: { lower: { lesson: { id: 'ghost', studentSlots: [makeup(WED, '2026/10/7(水) 5限'), null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: WED, createdAt: 'x' } }
    expect(audit(lower, [], { templatePendingDesks: pending }).map((item) => item.kind)).toEqual(['surplus-makeup'])
  })
})
