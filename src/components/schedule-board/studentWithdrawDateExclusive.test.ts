// 確認リスト v1.5.527 b-2(受付 20260915-131600682-f14273d0・オーナー決定 2026-09-15):
//   生徒の退塾日は「その日から非在籍」(在籍は退塾日の前日まで)。
//   - 盤面: テンプレ由来の通常授業は、max(退塾日, 今日[JST]) 以降だけ外す。テンプレ固定日の前後を問わない。
//     昨日以前の盤面には触れない。固定日前の週は剥がしだけでテンプレ再マージはしない(INV-10)。
//   - 手置きの講習・振替・手動追加・移動・出欠記録・manualTeacher は保護(INV-02)。
//   - 机が空になった非 manual 講師は外れる(INV-01・今日以降のみ許容)。講師日程表と一致すること。
//   - 講師の退職日の扱いは変えない(当日在籍)。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { buildTeacherPayload } from '../../utils/scheduleHtml'
import { buildTeacherAssignments, collectTeacherAssignmentEntries } from '../../utils/scheduleViewData'
import type { SlotCell, StudentEntry } from './types'
import {
  buildBoardStudentSelectionOptions,
  buildManagedScheduleCellsForRange,
  buildScheduleCellsForRange,
  remergeBoardWeekWithManagedData,
  stripWithdrawnStudentsFromBoardWeek,
  stripWithdrawnStudentsFromTemplateRegularLessons,
} from './ScheduleBoardScreen'

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

function regularDatesOf(cells: SlotCell[], studentId = 'student-inoue') {
  return cells
    .filter((cell) => cell.slotNumber === 5)
    .filter((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === studentId && student.lessonType === 'regular')))
    .map((cell) => cell.dateKey)
    .sort()
}

function buildBoardBeforeWithdraw(settings: ClassroomSettings = classroomSettings, lessons = regularLessons, students: StudentRow[] = [makeStudent('未定')]) {
  return buildManagedScheduleCellsForRange({
    range,
    fallbackStartDate: range.startDate,
    fallbackEndDate: range.endDate,
    classroomSettings: settings,
    teachers: [makeTeacher()],
    students,
    regularLessons: lessons,
    boardWeeks: [],
    suppressedRegularLessonOccurrences: [],
  })
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
    const boardBeforeWithdraw = buildBoardBeforeWithdraw()
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
      todayKey: WITHDRAW_DATE,
    })

    // 通常授業: 前日までの週(7/3)だけ残り、退塾日当日(7/10)以降は外れる。
    expect(regularDatesOf(after)).toEqual(['2026-07-03'])

    // 手置きの講習・振替は退塾日当日でも残る(消さない・在庫を動かさない)。
    const manualCell = after.find((cell) => cell.dateKey === WITHDRAW_DATE && cell.slotNumber === 5)
    const manualStudents = manualCell?.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter(Boolean) as StudentEntry[]
    expect(manualStudents.map((student) => student.id).sort()).toEqual(['manual-lecture-1', 'manual-makeup-1'])
  })

  it('退塾日が過去でも、剥がすのは今日以降だけ(昨日以前の盤面には触れない)', () => {
    const boardBeforeWithdraw = buildBoardBeforeWithdraw()
    // 7/3 退塾を 7/17 に入力した: 7/10(昨日以前)は盤面に残り、7/17 以降は外れる。
    const after = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: [makeTeacher()],
      students: [makeStudent('2026-07-03')],
      regularLessons,
      boardWeeks: [boardBeforeWithdraw],
      suppressedRegularLessonOccurrences: [],
      todayKey: '2026-07-17',
    })
    expect(regularDatesOf(after)).toEqual(['2026-07-03', '2026-07-10'])
  })

  it('同じコマに他の在籍生徒の通常授業がある(テンプレ沈黙でない)ときも、退塾生徒だけ外れ他の生徒は残る', () => {
    const otherStudent: StudentRow = { ...makeStudent('未定'), id: 'student-aoki', name: 'Aoki Taro', displayName: 'Aoki' }
    const lessons: RegularLessonRow[] = [
      regularLessons[0]!,
      { ...regularLessons[0]!, id: 'regular-ochiai-aoki', student1Id: 'student-aoki', subject1: '英' },
    ]
    const boardBeforeWithdraw = buildBoardBeforeWithdraw(classroomSettings, lessons, [makeStudent('未定'), otherStudent])
    const after = buildScheduleCellsForRange({
      range, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate, classroomSettings,
      teachers: [makeTeacher()], students: [makeStudent(WITHDRAW_DATE), otherStudent], regularLessons: lessons,
      boardWeeks: [boardBeforeWithdraw], suppressedRegularLessonOccurrences: [], todayKey: WITHDRAW_DATE,
    })
    expect(regularDatesOf(after)).toEqual(['2026-07-03'])
    expect(regularDatesOf(after, 'student-aoki')).toEqual(['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31'])
  })

  it('盤面の生徒追加候補にも退塾日当日から出ない', () => {
    const student = makeStudent(WITHDRAW_DATE)
    expect(buildBoardStudentSelectionOptions([student], '2026-07-09', '2026-07-09').map((entry) => entry.id)).toEqual(['student-inoue'])
    expect(buildBoardStudentSelectionOptions([student], WITHDRAW_DATE, WITHDRAW_DATE)).toEqual([])
    expect(buildBoardStudentSelectionOptions([student], '2026-07-11', '2026-07-11')).toEqual([])
  })
})

describe('テンプレ固定日より前の週でも、今日以降の退塾生徒の通常授業は外れる(再マージはしない=INV-10)', () => {
  // 日大前の実例: 固定日 10/1。9/15 に退塾しても 9/30 までの授業が残っていた。ここでは固定日 2026-10-01 で 7 月を再現する。
  const frozenSettings: ClassroomSettings = { ...classroomSettings, templateFreezeBeforeDate: '2026-10-01' }
  const weekOf = (cells: SlotCell[], mondayKey: string, saturdayKey: string) => cells.filter((cell) => cell.dateKey >= mondayKey && cell.dateKey <= saturdayKey)

  it('今日(=退塾日)以降は外れ、昨日以前と退塾に無関係なセルはそのまま(同じ参照)', () => {
    const board = buildBoardBeforeWithdraw(frozenSettings)
    const week1 = weekOf(board, '2026-06-29', '2026-07-04') // 7/3 を含む(昨日以前)
    const week2 = weekOf(board, '2026-07-06', '2026-07-11') // 7/10 を含む(今日)
    const params = {
      classroomSettings: frozenSettings,
      teachers: [makeTeacher()],
      students: [makeStudent(WITHDRAW_DATE)],
      regularLessons,
      suppressedRegularLessonOccurrences: [],
      todayKey: WITHDRAW_DATE,
    }
    const after1 = remergeBoardWeekWithManagedData(week1, params)
    const after2 = remergeBoardWeekWithManagedData(week2, params)
    expect(after1).toBe(week1)
    expect(regularDatesOf(after2)).toEqual([])
    // 剥がした 7/10 5 限以外のセルはテンプレから作り直していない(同じ参照)。
    week2.forEach((cell, index) => {
      if (cell.dateKey === WITHDRAW_DATE && cell.slotNumber === 5) return
      expect(after2[index], cell.id).toBe(cell)
    })
  })

  it('固定日前の週では、テンプレにあって盤面から消した授業を剥がしのついでに足し戻さない(INV-10)', () => {
    const board = buildBoardBeforeWithdraw(frozenSettings)
    // 7/17 の授業はユーザーが消した状態(盤面に無い)。退塾生徒は別人。
    const other: StudentRow = { ...makeStudent('未定'), id: 'student-aoki' }
    const week3 = weekOf(board, '2026-07-13', '2026-07-18').map((cell) => (cell.dateKey === '2026-07-17' && cell.slotNumber === 5
      ? { ...cell, desks: cell.desks.map((desk) => ({ ...desk, lesson: undefined, teacher: '' })) }
      : cell))
    const after = remergeBoardWeekWithManagedData(week3, {
      classroomSettings: frozenSettings,
      teachers: [makeTeacher()],
      students: [makeStudent('未定'), { ...other, withdrawDate: '2026-07-01' }],
      regularLessons,
      suppressedRegularLessonOccurrences: [],
      todayKey: '2026-07-13',
    })
    expect(after).toBe(week3)
    expect(regularDatesOf(after)).toEqual([])
  })
})

describe('講師日程表との一致(INV-01・今日以降に限り机が空になるのを許容)', () => {
  it('非 manual 講師の机は空になり、講師日程表にもその日のコマが出ない。前日までは出る', () => {
    const board = buildBoardBeforeWithdraw()
    const after = buildScheduleCellsForRange({
      range, fallbackStartDate: range.startDate, fallbackEndDate: range.endDate, classroomSettings,
      teachers: [makeTeacher()], students: [makeStudent(WITHDRAW_DATE)], regularLessons,
      boardWeeks: [board], suppressedRegularLessonOccurrences: [], todayKey: WITHDRAW_DATE,
    })
    const boardTeacherDates = after
      .filter((cell) => cell.slotNumber === 5 && cell.desks.some((desk) => desk.teacher === 'Ochiai'))
      .map((cell) => cell.dateKey)
      .sort()
    expect(boardTeacherDates).toEqual(['2026-07-03'])

    const payload = buildTeacherPayload({
      cells: after,
      teachers: [makeTeacher()],
      students: [makeStudent(WITHDRAW_DATE)],
      regularLessons,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      titleLabel: 'テスト',
      classroomSettings,
    })
    const entries = collectTeacherAssignmentEntries(buildTeacherAssignments(payload.cells), { id: 'teacher-ochiai', name: 'Ochiai', fullName: 'Ochiai Taro' } as Parameters<typeof collectTeacherAssignmentEntries>[1])
    const scheduleDates = [...new Set(entries.filter((entry) => entry.slotNumber === 5).map((entry) => entry.dateKey))].sort()
    expect(scheduleDates).toEqual(boardTeacherDates)
  })
})

describe('退塾ボタン/編集の退塾日入力のどちらでも、その場で盤面に反映される配線', () => {
  const boardSource = readFileSync(new URL('./ScheduleBoardScreen.tsx', import.meta.url), 'utf8')
  const basicDataSource = readFileSync(new URL('../basic-data/BasicDataScreen.tsx', import.meta.url), 'utf8')

  it('名簿(students)変更で走る再マージ effect と、盤面を開いたときの読込が同じ関数(剥がし込み)を通る', () => {
    expect(boardSource.match(/remergeBoardWeekWithManagedData\(week, \{/g)).toHaveLength(2)
    expect(boardSource).toContain('}, [classroomSettings, teachers, students, regularLessons, suppressedRegularLessonOccurrences])')
    expect(boardSource).toContain('const week = stripWithdrawnStudentsFromBoardWeek(rawWeek, params.students, params.todayKey)')
  })

  it('退塾ボタンと編集の日付入力は、どちらも onUpdateStudents で名簿を更新する', () => {
    expect(basicDataSource).toContain('onUpdateStudents((current) => applyStudentWithdrawToday(current, withdrawModalState.id, today))')
    expect(basicDataSource).toContain("onChange={(value) => updateStudent(row.id, { withdrawDate: value })}")
    expect(basicDataSource).toContain('onUpdateStudents((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))')
  })
})

describe('stripWithdrawnStudentsFromTemplateRegularLessons(退塾日を迎えた生徒のテンプレ由来通常授業だけを外す)', () => {
  const regular = (managedStudentId: string, extra: Partial<StudentEntry> = {}): StudentEntry => ({
    id: `${managedStudentId}_entry`, name: managedStudentId, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...extra,
  })
  const cellWith = (dateKey: string, lessonId: string, slots: [StudentEntry | null, StudentEntry | null]): SlotCell => ({
    id: `${dateKey}_5`, dateKey, dayLabel: '金', dateLabel: '', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [{ id: `${dateKey}_5_desk_1`, teacher: 'Ochiai', teacherAssignmentTeacherId: 'teacher-ochiai', lesson: { id: lessonId, note: '管理データ反映', studentSlots: slots } }],
  })
  const roster = [{ id: 'sw', withdrawDate: '2026-07-10' }, { id: 'sa', withdrawDate: '' }]
  const TODAY = '2026-07-09'

  it('前日=残す／当日=外す／翌日=外す(今日以降の範囲で)', () => {
    const slots: [StudentEntry | null, StudentEntry | null] = [regular('sw'), null]
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-09', 'managed_r_2026-07-09', slots), roster, TODAY).desks[0]?.lesson?.studentSlots[0]?.managedStudentId).toBe('sw')
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-10', 'managed_r_2026-07-10', slots), roster, TODAY).desks[0]?.lesson).toBeUndefined()
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-11', 'managed_r_2026-07-11', slots), roster, TODAY).desks[0]?.lesson).toBeUndefined()
  })

  it('今日より前の日付は、退塾日以降でも触らない', () => {
    const cell = cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), null])
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(cell, roster, '2026-07-11')).toBe(cell)
    const week = [cell]
    expect(stripWithdrawnStudentsFromBoardWeek(week, roster, '2026-07-11')).toBe(week)
  })

  it('2人机は退塾生徒の枠だけ空け、在籍生徒と講師はそのまま', () => {
    const result = stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), regular('sa')]), roster, TODAY)
    expect(result.desks[0]?.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sa'])
    expect(result.desks[0]?.teacher).toBe('Ochiai')
  })

  it('机が空になったら非 manual 講師は外す／manualTeacher と出欠記録のある机は講師を残す', () => {
    const plain = stripWithdrawnStudentsFromTemplateRegularLessons(cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), null]), roster, TODAY)
    expect(plain.desks[0]?.teacher).toBe('')
    expect(plain.desks[0]?.teacherAssignmentTeacherId).toBeUndefined()

    const manual = cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), null])
    manual.desks[0] = { ...manual.desks[0]!, manualTeacher: true, teacherAssignmentSource: 'manual' }
    const manualResult = stripWithdrawnStudentsFromTemplateRegularLessons(manual, roster, TODAY)
    expect(manualResult.desks[0]?.lesson).toBeUndefined()
    expect(manualResult.desks[0]?.teacher).toBe('Ochiai')
    expect(manualResult.desks[0]?.manualTeacher).toBe(true)
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
      expect(stripWithdrawnStudentsFromTemplateRegularLessons(cell, roster, TODAY)).toBe(cell)
    }
    const manualDesk: SlotCell = cellWith('2026-07-10', 'manual_desk', [regular('sw'), null])
    manualDesk.desks[0]!.lesson!.note = '手動'
    expect(stripWithdrawnStudentsFromTemplateRegularLessons(manualDesk, roster, TODAY)).toBe(manualDesk)
  })

  it('入力セルを書き換えない', () => {
    const cell = cellWith('2026-07-10', 'managed_r_2026-07-10', [regular('sw'), regular('sa')])
    stripWithdrawnStudentsFromTemplateRegularLessons(cell, roster, TODAY)
    expect(cell.desks[0]?.lesson?.studentSlots.map((student) => student?.managedStudentId)).toEqual(['sw', 'sa'])
  })
})
