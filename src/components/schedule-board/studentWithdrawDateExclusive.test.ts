// 確認リスト v1.5.527 b-2(受付 20260915-131600682-f14273d0・オーナー決定 2026-09-15):
//   生徒の退塾日は「その日から非在籍」(在籍は退塾日の前日まで)。
//   - 退塾日当日の盤面から、テンプレ由来の通常授業が消える(生成されない／既に盤面にあっても再マージで外れる)。
//   - 退塾日当日以降に手で置いた講習・振替のコマは消さない(在庫も動かさない)＝INV-02(手動編集の永続化)。
//   - 講師の退職日の扱いは変えない(当日在籍)。
import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildBoardStudentSelectionOptions, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, stripWithdrawnStudentsFromTemplateRegularLessons } from './ScheduleBoardScreen'

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 14,
}

const range = { startDate: '2026-07-01', endDate: '2026-07-31', periodValue: '' }

// 2026-07 の金曜 5 限: 7/3, 7/10, 7/17, 7/24, 7/31
const WITHDRAW_DATE = '2026-07-10'

function makeTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    ...initialTeachers[0]!,
    id: 'teacher-ochiai',
    name: 'Ochiai Taro',
    displayName: 'Ochiai',
    entryDate: '2026-04-01',
    withdrawDate: '未定',
    ...overrides,
  }
}

function makeStudent(withdrawDate: string): StudentRow {
  return {
    ...initialStudents[0]!,
    id: 'student-inoue',
    name: 'Inoue Hana',
    displayName: 'Inoue',
    entryDate: '2026-04-01',
    withdrawDate,
    birthDate: '2012-05-01',
  }
}

const regularLessons: RegularLessonRow[] = [{
  id: 'regular-ochiai-inoue',
  schoolYear: 2026,
  teacherId: 'teacher-ochiai',
  student1Id: 'student-inoue',
  subject1: '数',
  startDate: '2026-04-01',
  endDate: '未定',
  student2Id: '',
  subject2: '',
  student2StartDate: '',
  student2EndDate: '',
  nextStudent1Id: '',
  nextSubject1: '',
  nextStudent2Id: '',
  nextSubject2: '',
  dayOfWeek: 5,
  slotNumber: 5,
}]

function regularDatesOf(cells: SlotCell[]) {
  return cells
    .filter((cell) => cell.slotNumber === 5)
    .filter((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue' && student.lessonType === 'regular')))
    .map((cell) => cell.dateKey)
    .sort()
}

describe('生徒の退塾日は当日から非在籍: 盤面テンプレ由来の通常授業', () => {
  it('退塾日当日以降は通常授業を生成しない(前日までの週だけ出る)', () => {
    const cells = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: [makeTeacher()],
      students: [makeStudent(WITHDRAW_DATE)],
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    expect(regularDatesOf(cells)).toEqual(['2026-07-03'])
  })

  it('退塾日が翌日なら当日はまだ通常授業が出る(境界の前日=在籍)', () => {
    const cells = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: [makeTeacher()],
      students: [makeStudent('2026-07-11')],
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    expect(regularDatesOf(cells)).toEqual(['2026-07-03', '2026-07-10'])
  })

  it('既に盤面にある今日の通常授業は、退塾日を今日にすると再マージで外れ、手置きの講習・振替は残る', () => {
    // 退塾前の盤面(テンプレから 7 月全週に通常授業が入った状態)を作る。
    const boardBeforeWithdraw = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: [makeTeacher()],
      students: [makeStudent('未定')],
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    expect(regularDatesOf(boardBeforeWithdraw)).toEqual(['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31'])

    // 退塾日当日(7/10)の同じ 5 限の空き机に、手で講習と振替を置いておく(管理外の授業)。
    const manualLecture: StudentEntry = {
      id: 'manual-lecture-1',
      name: 'Inoue',
      managedStudentId: 'student-inoue',
      grade: '中2',
      subject: '英',
      lessonType: 'special',
      teacherType: 'normal',
      manualAdded: true,
      specialStockSource: 'manual',
    }
    const manualMakeup: StudentEntry = {
      id: 'manual-makeup-1',
      name: 'Inoue',
      managedStudentId: 'student-inoue',
      grade: '中2',
      subject: '数',
      lessonType: 'makeup',
      teacherType: 'normal',
      manualAdded: true,
      makeupSourceDate: '2026-07-03',
    }
    const board = boardBeforeWithdraw.map((cell) => {
      if (cell.dateKey !== WITHDRAW_DATE || cell.slotNumber !== 5) return cell
      const emptyDeskIndex = cell.desks.findIndex((desk) => !desk.lesson && !desk.teacher.trim())
      return {
        ...cell,
        desks: cell.desks.map((desk, index) => (index === emptyDeskIndex
          ? { ...desk, teacher: 'Ochiai', manualTeacher: true, lesson: { id: 'manual-desk-lecture', studentSlots: [manualLecture, manualMakeup] as [StudentEntry | null, StudentEntry | null] } }
          : desk)),
      }
    })

    const after = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: [makeTeacher()],
      students: [makeStudent(WITHDRAW_DATE)],
      regularLessons,
      boardWeeks: [board],
      suppressedRegularLessonOccurrences: [],
    })

    // 通常授業: 前日までの週(7/3)だけ残り、退塾日当日(7/10)以降は外れる。
    expect(regularDatesOf(after)).toEqual(['2026-07-03'])

    // 手置きの講習・振替は退塾日当日でも残る(消さない・在庫を動かさない)。
    const manualCell = after.find((cell) => cell.dateKey === WITHDRAW_DATE && cell.slotNumber === 5)
    const manualStudents = manualCell?.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter(Boolean) as StudentEntry[]
    expect(manualStudents.map((student) => student.id).sort()).toEqual(['manual-lecture-1', 'manual-makeup-1'])
  })

  it('同じコマに他の在籍生徒の通常授業がある(テンプレ沈黙でない)ときも、退塾生徒だけ外れ他の生徒は残る', () => {
    const otherStudent: StudentRow = { ...makeStudent('未定'), id: 'student-aoki', name: 'Aoki Taro', displayName: 'Aoki' }
    const lessons: RegularLessonRow[] = [
      regularLessons[0]!,
      { ...regularLessons[0]!, id: 'regular-ochiai-aoki', student1Id: 'student-aoki', subject1: '英' },
    ]
    const boardBeforeWithdraw = buildManagedScheduleCellsForRange({
      range, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate, classroomSettings,
      teachers: [makeTeacher()], students: [makeStudent('未定'), otherStudent], regularLessons: lessons,
      boardWeeks: [], suppressedRegularLessonOccurrences: [],
    })
    const after = buildScheduleCellsForRange({
      range, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate, classroomSettings,
      teachers: [makeTeacher()], students: [makeStudent(WITHDRAW_DATE), otherStudent], regularLessons: lessons,
      boardWeeks: [boardBeforeWithdraw], suppressedRegularLessonOccurrences: [],
    })
    expect(regularDatesOf(after)).toEqual(['2026-07-03'])
    const aokiDates = after
      .filter((cell) => cell.slotNumber === 5 && cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-aoki')))
      .map((cell) => cell.dateKey)
      .sort()
    expect(aokiDates).toEqual(['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31'])
  })

  it('盤面の生徒追加候補にも退塾日当日から出ない', () => {
    const student = makeStudent(WITHDRAW_DATE)
    expect(buildBoardStudentSelectionOptions([student], '2026-07-09', '2026-07-09').map((entry) => entry.id)).toEqual(['student-inoue'])
    expect(buildBoardStudentSelectionOptions([student], WITHDRAW_DATE, WITHDRAW_DATE)).toEqual([])
    expect(buildBoardStudentSelectionOptions([student], '2026-07-11', '2026-07-11')).toEqual([])
  })
})

describe('stripWithdrawnStudentsFromTemplateRegularLessons(退塾日を迎えた生徒のテンプレ由来通常授業だけを外す)', () => {
  const regular = (managedStudentId: string, extra: Partial<StudentEntry> = {}): StudentEntry => ({
    id: `${managedStudentId}_entry`, name: managedStudentId, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...extra,
  })
  const cellWith = (dateKey: string, lessonId: string, slots: [StudentEntry | null, StudentEntry | null]): SlotCell => ({
    id: `${dateKey}_5`, dateKey, dayLabel: '金', dateLabel: '', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [{ id: `${dateKey}_5_desk_1`, teacher: 'Ochiai', lesson: { id: lessonId, note: '管理データ反映', studentSlots: slots } }],
  })
  const roster = [{ id: 'sw', withdrawDate: '2026-07-10' }, { id: 'sa', withdrawDate: '' }]

  it('前日=残す／当日=外す／翌日=外す', () => {
    const slots: [StudentEntry | null, StudentEntry | null] = [regular('sw'), null]
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-09', 'managed_r_2026-07-09', slots), roster).desks[0]?.lesson?.studentSlots[0]?.managedStudentId).toBe('sw')
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-10', 'managed_r_2026-07-10', slots), roster).desks[0]?.lesson).toBeUndefined()
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-11', 'managed_r_2026-07-11', slots), roster).desks[0]?.lesson).toBeUndefined()
  })

  it('2人机は退塾生徒の枠だけ空け、在籍生徒と講師はそのまま', () => {
    const result = stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), regular('sa')]), roster)
    expect(result.desks[0]?.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sa'])
    expect(result.desks[0]?.teacher).toBe('Ochiai')
  })

  it('手置き(講習・振替・手動追加の通常)・移動戻し・名簿に無い生徒・管理授業でない机は外さない', () => {
    const keep: Array<[StudentEntry | null, StudentEntry | null]> = [
      [regular('sw', { lessonType: 'special', manualAdded: true }), null],
      [regular('sw', { lessonType: 'makeup', makeupSourceDate: '2026-07-03' }), null],
      [regular('sw', { manualAdded: true }), null],
      [regular('sw', { sameDayMoveSourceDate: '2026-07-10' }), null],
      [regular('unknown'), null],
    ]
    for (const slots of keep) {
      const cell = cellWith('2026-07-10', 'managed_r_2026-07-10', slots)
      expect(stripWithdrawnStudentsFromTemplateRegularLessons(cell, roster)).toBe(cell)
    }
    const manualDesk: SlotCell = { ...cellWith('2026-07-10', 'manual_desk', [regular('sw'), null]) }
    manualDesk.desks[0]!.lesson!.note = '手動'
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(manualDesk, roster)).toBe(manualDesk)
  })

  it('入力セルを書き換えない', () => {
    const cell = cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), regular('sa')])
    stripWithdrawnStudentsFromTemplateRegularLessons(cell, roster)
    expect(cell.desks[0]?.lesson?.studentSlots.map((student) => student?.managedStudentId)).toEqual(['sw', 'sa'])
  })
})
