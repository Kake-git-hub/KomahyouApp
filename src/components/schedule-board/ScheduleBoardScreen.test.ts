import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers } from '../basic-data/basicDataModel'
import { createInitialRegularLessons } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, buildScheduleCellsForRange, cloneWeeks, normalizeLessonPlacement, packSortCellDesks, removeStudentFromDeskLesson } from './ScheduleBoardScreen'

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 14,
}

function createStudentEntry(id: string, name: string, subject: StudentEntry['subject']): StudentEntry {
  return {
    id,
    name,
    managedStudentId: id,
    grade: '中3',
    subject,
    lessonType: 'regular',
    teacherType: 'normal',
  }
}

function createPackTestCell(): SlotCell {
  return {
    id: '2026-04-07_3',
    dateKey: '2026-04-07',
    dayLabel: '火',
    dateLabel: '4/7',
    slotLabel: '3限',
    slotNumber: 3,
    timeLabel: '16:20-17:50',
    isOpenDay: true,
    desks: [
      {
        id: '2026-04-07_3_desk_1',
        teacher: '',
      },
      {
        id: '2026-04-07_3_desk_2',
        teacher: '右だけ生徒',
        lesson: {
          id: 'right-only',
          studentSlots: [null, createStudentEntry('s-right', '右生徒', '数')],
        },
      },
      {
        id: '2026-04-07_3_desk_3',
        teacher: '講師だけ',
      },
      {
        id: '2026-04-07_3_desk_4',
        teacher: '二人生徒',
        lesson: {
          id: 'pair',
          studentSlots: [createStudentEntry('s-a', 'A', '英'), createStudentEntry('s-b', 'B', '数')],
        },
      },
      {
        id: '2026-04-07_3_desk_5',
        teacher: '一人生徒',
        lesson: {
          id: 'single-left',
          studentSlots: [createStudentEntry('s-c', 'C', '国'), null],
        },
      },
      {
        id: '2026-04-07_3_desk_6',
        teacher: '',
      },
    ],
  }
}

describe('ScheduleBoardScreen buildManagedScheduleCellsForRange', () => {
  it('treats a same-day return as regular even when the destination slot changes', () => {
    const normalized = normalizeLessonPlacement({
      id: 'same-day-return',
      name: '青木太郎',
      managedStudentId: 's001',
      grade: '中3',
      subject: '数',
      lessonType: 'makeup',
      teacherType: 'normal',
      makeupSourceDate: '2026-04-07',
      makeupSourceLabel: '2026/4/7(火) 1限',
    }, '2026-04-07')

    expect(normalized.lessonType).toBe('regular')
    expect(normalized.makeupSourceDate).toBe('2026-04-07')
    expect(normalized.makeupSourceLabel).toBe('2026/4/7(火) 1限')
  })

  it('packs desk rows within the same slot as two students, one student, teacher only, then empty', () => {
    const packedDesks = packSortCellDesks(createPackTestCell())

    expect(packedDesks.map((desk) => desk.teacher)).toEqual(['二人生徒', '一人生徒', '右だけ生徒', '講師だけ', '', ''])
    expect(packedDesks[2]?.lesson?.studentSlots[0]?.name).toBe('右生徒')
    expect(packedDesks[2]?.lesson?.studentSlots[1]).toBeNull()
  })

  it('keeps all remaining weekly student placements when a regular lesson starts mid-month with fewer than four active weeks left', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'partial-start',
        schoolYear: 2025,
        teacherId: 't001',
        student1Id: 's001',
        subject1: '数',
        startDate: '2026-03-16',
        endDate: '2026-03-31',
        student2Id: '',
        subject2: '',
        student2StartDate: '2026-03-16',
        student2EndDate: '2026-03-31',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 1,
        slotNumber: 1,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const placedDateKeys = cells
      .filter((cell) => cell.slotNumber === 1)
      .filter((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001')))
      .map((cell) => cell.dateKey)

    expect(placedDateKeys).toEqual(['2026-03-16', '2026-03-23', '2026-03-30'])
  })

  it('keeps all remaining weekly student placements when a regular lesson ends mid-month with fewer than four active weeks left', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'partial-end',
        schoolYear: 2025,
        teacherId: 't001',
        student1Id: 's001',
        subject1: '数',
        startDate: '2026-03-01',
        endDate: '2026-03-16',
        student2Id: '',
        subject2: '',
        student2StartDate: '2026-03-01',
        student2EndDate: '2026-03-16',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 1,
        slotNumber: 1,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const placedDateKeys = cells
      .filter((cell) => cell.slotNumber === 1)
      .filter((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001')))
      .map((cell) => cell.dateKey)

    expect(placedDateKeys).toEqual(['2026-03-02', '2026-03-09', '2026-03-16'])
  })

  it('keeps the regular teacher assigned on a fifth weekly slot after regular students are capped at four lessons per month', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: createInitialRegularLessons(new Date('2025-04-01T00:00:00')),
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const fifthMondayCell = cells.find((cell) => cell.dateKey === '2026-03-30' && cell.slotNumber === 1)
    expect(fifthMondayCell).toBeDefined()

    const teacherDesk = fifthMondayCell?.desks.find((desk) => desk.teacher === '田中講師')
    expect(teacherDesk).toBeDefined()
    expect(teacherDesk?.lesson).toBeUndefined()

    const firstMondayCell = cells.find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 1)
    const firstMondayDesk = firstMondayCell?.desks.find((desk) => desk.teacher === '田中講師')
    expect(firstMondayDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s001')
  })

  it('adds teacher-only desks from regular template derived rows even without student assignments', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'template_teacher_only',
        schoolYear: 2025,
        teacherId: 't001',
        student1Id: '',
        subject1: '',
        student1Note: '',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        student2Id: '',
        subject2: '',
        student2Note: '',
        student2StartDate: '2026-03-01',
        student2EndDate: '2026-03-31',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 1,
        slotNumber: 4,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 4)
    const teacherDesk = targetCell?.desks.find((desk) => desk.teacher === '田中講師')

    expect(targetCell).toBeDefined()
    expect(teacherDesk).toBeDefined()
    expect(teacherDesk?.lesson).toBeUndefined()
  })

  it('propagates regular lesson notes into managed board student entries', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        periodValue: '',
      },
      fallbackStartDate: '2026-04-01',
      fallbackEndDate: '2026-04-30',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'noted-regular',
        schoolYear: 2026,
        teacherId: 't001',
        student1Id: 's001',
        subject1: '数',
        student1Note: '宿題',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        student2Id: '',
        subject2: '',
        student2Note: '',
        student2StartDate: '2026-04-01',
        student2EndDate: '2027-03-31',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 1,
        slotNumber: 1,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-04-06' && cell.slotNumber === 1)
    const student = targetCell?.desks.find((desk) => desk.teacher === '田中講師')?.lesson?.studentSlots[0]

    expect(student?.noteSuffix).toBe('宿題')
  })

  it('stores a holiday-shortened regular lesson as stock instead of moving the student to the fifth week', () => {
    const holidayAwareSettings: ClassroomSettings = {
      ...classroomSettings,
      holidayDates: ['2026-03-10'],
    }

    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings: holidayAwareSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'holiday-regular',
        schoolYear: 2025,
        teacherId: 't001',
        student1Id: 's001',
        subject1: '数',
        startDate: '',
        endDate: '',
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 2,
        slotNumber: 1,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const placedDateKeys = cells
      .filter((cell) => cell.slotNumber === 1)
      .filter((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001')))
      .map((cell) => cell.dateKey)

    const fifthTuesdayCell = cells.find((cell) => cell.dateKey === '2026-03-31' && cell.slotNumber === 1)
    const fifthTuesdayTeacherDesk = fifthTuesdayCell?.desks.find((desk) => desk.teacher === '田中講師')

    expect(placedDateKeys).toEqual(['2026-03-03', '2026-03-17', '2026-03-24'])
    expect(fifthTuesdayTeacherDesk).toBeDefined()
    expect(fifthTuesdayTeacherDesk?.lesson).toBeUndefined()
  })

  it('keeps the regular teacher assigned on a fifth weekly slot after board-week overlay merges managed cells', () => {
    const weeklyRange = {
      startDate: '2026-03-29',
      endDate: '2026-04-04',
      periodValue: '',
    }
    const regularLessons = createInitialRegularLessons(new Date('2025-04-01T00:00:00'))
    const boardWeek = buildManagedScheduleCellsForRange({
      range: weeklyRange,
      fallbackStartDate: '2026-03-29',
      fallbackEndDate: '2026-04-04',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const cells = buildScheduleCellsForRange({
      range: weeklyRange,
      fallbackStartDate: '2026-03-29',
      fallbackEndDate: '2026-04-04',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const fifthMondayCell = cells.find((cell) => cell.dateKey === '2026-03-30' && cell.slotNumber === 1)
    const teacherDesk = fifthMondayCell?.desks.find((desk) => desk.teacher === '田中講師')

    expect(teacherDesk).toBeDefined()
    expect(teacherDesk?.lesson).toBeUndefined()
  })

  it('keeps planned regular lessons visible even when actual occurrences are suppressed on the board', () => {
    const cells = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-01',
      fallbackEndDate: '2026-03-31',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: createInitialRegularLessons(new Date('2025-04-01T00:00:00')),
      boardWeeks: [],
      suppressedRegularLessonOccurrences: ['s001__数__2026-03-02__1'],
    })

    const firstMondayDesk = cells
      .find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 1)
      ?.desks.find((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001'))

    expect(firstMondayDesk?.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001')).toBe(true)
  })

  it('drops a removed second student when a regular lesson edit creates a new managed lesson revision', () => {
    const beforeEdit = {
      id: 'revision-base',
      schoolYear: 2025,
      teacherId: 't002',
      student1Id: 's002',
      subject1: '英',
      startDate: '',
      endDate: '',
      student2Id: 's003',
      subject2: '英',
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '',
      nextStudent2Id: '',
      nextSubject2: '',
      dayOfWeek: 3,
      slotNumber: 2,
    }
    const boardWeek = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [beforeEdit],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const afterEdit = {
      ...beforeEdit,
      id: 'revision-base_migrated',
      student2Id: '',
      subject2: '',
      student2StartDate: '',
      student2EndDate: '',
    }
    const cells = buildScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [afterEdit],
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-03-25' && cell.slotNumber === 2)
    const managedDesk = targetCell?.desks.find((desk) => desk.teacher === '佐藤講師')

    expect(managedDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s002')
    expect(managedDesk?.lesson?.studentSlots[1]).toBeNull()
  })

  it('drops a removed regular student during board merge even if the managed lesson id stays the same', () => {
    const boardWeek = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'same-id-lesson',
        schoolYear: 2025,
        teacherId: 't002',
        student1Id: 's002',
        subject1: '英',
        startDate: '',
        endDate: '',
        student2Id: 's003',
        subject2: '英',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 3,
        slotNumber: 2,
      }],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const cells = buildScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [{
        id: 'same-id-lesson',
        schoolYear: 2025,
        teacherId: 't002',
        student1Id: 's002',
        subject1: '英',
        startDate: '',
        endDate: '',
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 3,
        slotNumber: 2,
      }],
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-03-25' && cell.slotNumber === 2)
    const managedDesk = targetCell?.desks.find((desk) => desk.teacher === '佐藤講師')

    expect(managedDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s002')
    expect(managedDesk?.lesson?.studentSlots[1]).toBeNull()
  })

  it('drops the previous student when a regular lesson is reassigned to a different student revision', () => {
    const beforeEdit = {
      id: 'revision-change',
      schoolYear: 2025,
      teacherId: 't001',
      student1Id: 's001',
      subject1: '数',
      startDate: '',
      endDate: '',
      student2Id: '',
      subject2: '',
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '',
      nextStudent2Id: '',
      nextSubject2: '',
      dayOfWeek: 1,
      slotNumber: 1,
    }
    const boardWeek = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [beforeEdit],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const afterEdit = {
      ...beforeEdit,
      id: 'revision-change_updated',
      student1Id: 's002',
      subject1: '英',
    }
    const cells = buildScheduleCellsForRange({
      range: {
        startDate: '2026-03-23',
        endDate: '2026-03-29',
        periodValue: '',
      },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [afterEdit],
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-03-23' && cell.slotNumber === 1)
    const managedDesk = targetCell?.desks.find((desk) => desk.teacher === '田中講師')

    expect(managedDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s002')
    expect(managedDesk?.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001')).toBe(false)
  })

  it('replaces a managed teacher-only desk without leaving the previous teacher in a lower row', () => {
    const range = {
      startDate: '2026-03-01',
      endDate: '2026-03-07',
      periodValue: '',
    }
    const regularLessons = [{
      id: 'teacher-only-replace',
      schoolYear: 2025,
      teacherId: 't001',
      student1Id: '',
      subject1: '',
      student1Note: '',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      student2Id: '',
      subject2: '',
      student2Note: '',
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '',
      nextStudent2Id: '',
      nextSubject2: '',
      dayOfWeek: 1,
      slotNumber: 4,
    }]

    const boardWeek = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = boardWeek.find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 4)
    const targetDeskIndex = targetCell?.desks.findIndex((desk) => desk.teacher === '田中講師') ?? -1

    expect(targetDeskIndex).toBeGreaterThanOrEqual(0)

    const targetDesk = targetCell?.desks[targetDeskIndex]
    expect(targetDesk).toBeDefined()

    if (!targetDesk) throw new Error('targetDesk is required for test')

    targetDesk.teacher = '佐藤講師'
    targetDesk.manualTeacher = true
    targetDesk.teacherAssignmentSource = 'manual-replaced'
    targetDesk.teacherAssignmentTeacherId = 't002'

    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const mergedCell = cells.find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 4)
    const teacherNames = mergedCell?.desks.filter((desk) => desk.teacher.trim()).map((desk) => desk.teacher) ?? []

    expect(teacherNames).toEqual(['佐藤講師'])
  })
})

describe('データ堅牢性 cloneWeeks', () => {
  function createTestWeeks(): SlotCell[][] {
    return [[
      {
        id: '2026-04-07_1',
        dateKey: '2026-04-07',
        dayLabel: '月',
        dateLabel: '4/7',
        slotLabel: '1限',
        slotNumber: 1,
        timeLabel: '13:00-14:30',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-07_1_desk_1',
            teacher: '田中講師',
            memoSlots: ['メモA', null],
            lesson: {
              id: 'lesson_1',
              note: '通常授業',
              studentSlots: [
                createStudentEntry('s001', '生徒A', '数'),
                createStudentEntry('s002', '生徒B', '英'),
              ],
            },
          },
          {
            id: '2026-04-07_1_desk_2',
            teacher: '佐藤講師',
            lesson: {
              id: 'lesson_2',
              studentSlots: [createStudentEntry('s003', '生徒C', '国'), null],
            },
          },
          {
            id: '2026-04-07_1_desk_3',
            teacher: '',
          },
        ],
      },
      {
        id: '2026-04-07_2',
        dateKey: '2026-04-07',
        dayLabel: '月',
        dateLabel: '4/7',
        slotLabel: '2限',
        slotNumber: 2,
        timeLabel: '14:40-16:10',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-07_2_desk_1',
            teacher: '田中講師',
            lesson: {
              id: 'lesson_3',
              studentSlots: [createStudentEntry('s004', '生徒D', '英'), null],
            },
          },
        ],
      },
    ]]
  }

  it('cloneWeeks はすべてのネストレベルで独立したオブジェクトを返す', () => {
    const original = createTestWeeks()
    const cloned = cloneWeeks(original)

    // トップレベル
    expect(cloned).not.toBe(original)
    expect(cloned[0]).not.toBe(original[0])

    // セルレベル
    expect(cloned[0][0]).not.toBe(original[0][0])
    expect(cloned[0][1]).not.toBe(original[0][1])

    // デスクレベル
    expect(cloned[0][0].desks).not.toBe(original[0][0].desks)
    expect(cloned[0][0].desks[0]).not.toBe(original[0][0].desks[0])

    // レッスンレベル
    expect(cloned[0][0].desks[0].lesson).not.toBe(original[0][0].desks[0].lesson)

    // 生徒スロットレベル
    expect(cloned[0][0].desks[0].lesson!.studentSlots).not.toBe(original[0][0].desks[0].lesson!.studentSlots)
    expect(cloned[0][0].desks[0].lesson!.studentSlots[0]).not.toBe(original[0][0].desks[0].lesson!.studentSlots[0])

    // メモスロットレベル
    expect(cloned[0][0].desks[0].memoSlots).not.toBe(original[0][0].desks[0].memoSlots)
  })

  it('cloneWeeks で生成したコピーを変更しても元データに影響しない', () => {
    const original = createTestWeeks()
    const originalStudent0Name = original[0][0].desks[0].lesson!.studentSlots[0]!.name
    const originalTeacher = original[0][0].desks[0].teacher
    const originalMemo = original[0][0].desks[0].memoSlots![0]
    const originalNote = original[0][0].desks[0].lesson!.note

    const cloned = cloneWeeks(original)

    // クローン側を書き換え
    cloned[0][0].desks[0].lesson!.studentSlots[0]!.name = '変更済み生徒'
    cloned[0][0].desks[0].teacher = '変更済み講師'
    cloned[0][0].desks[0].memoSlots![0] = '変更済みメモ'
    cloned[0][0].desks[0].lesson!.note = '変更済みノート'
    cloned[0][0].desks[0].lesson!.studentSlots[1] = null

    // 元データは変更されていないこと
    expect(original[0][0].desks[0].lesson!.studentSlots[0]!.name).toBe(originalStudent0Name)
    expect(original[0][0].desks[0].teacher).toBe(originalTeacher)
    expect(original[0][0].desks[0].memoSlots![0]).toBe(originalMemo)
    expect(original[0][0].desks[0].lesson!.note).toBe(originalNote)
    expect(original[0][0].desks[0].lesson!.studentSlots[1]).not.toBeNull()
  })

  it('cloneWeeks でセル削除・追加しても元データに影響しない', () => {
    const original = createTestWeeks()
    const originalCellCount = original[0].length

    const cloned = cloneWeeks(original)
    cloned[0].push({
      id: '2026-04-07_3',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '3限',
      slotNumber: 3,
      timeLabel: '16:20-17:50',
      isOpenDay: true,
      desks: [],
    })

    expect(original[0].length).toBe(originalCellCount)
    expect(cloned[0].length).toBe(originalCellCount + 1)
  })

  it('cloneWeeks で別セルの desk を変更しても他セルに影響しない', () => {
    const original = createTestWeeks()
    const cloned = cloneWeeks(original)

    // 1限のdesk 0に変更
    cloned[0][0].desks[0].lesson!.studentSlots[0]!.subject = '国'
    cloned[0][0].desks[0].teacher = '変更講師'

    // 2限のdesk 0は影響なし
    expect(cloned[0][1].desks[0].lesson!.studentSlots[0]!.subject).toBe('英')
    expect(cloned[0][1].desks[0].teacher).toBe('田中講師')

    // 1限のdesk 1も影響なし
    expect(cloned[0][0].desks[1].lesson!.studentSlots[0]!.subject).toBe('国')
    expect(cloned[0][0].desks[1].teacher).toBe('佐藤講師')
  })

  it('cloneWeeks は lesson が undefined のデスクも正しくコピーする', () => {
    const original = createTestWeeks()
    const cloned = cloneWeeks(original)

    expect(cloned[0][0].desks[2].lesson).toBeUndefined()
    expect(cloned[0][0].desks[2].teacher).toBe('')

    // undefined のデスクに lesson を追加しても元は影響なし
    cloned[0][0].desks[2].lesson = {
      id: 'new_lesson',
      studentSlots: [createStudentEntry('new', '新生徒', '算'), null],
    }

    expect(original[0][0].desks[2].lesson).toBeUndefined()
  })
})

describe('データ堅牢性 removeStudentFromDeskLesson', () => {
  it('指定スロットの生徒だけを削除し、他スロットの生徒は残す', () => {
    const desk = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [
          createStudentEntry('s001', 'A', '数'),
          createStudentEntry('s002', 'B', '英'),
        ] as [StudentEntry | null, StudentEntry | null],
      },
    }

    removeStudentFromDeskLesson(desk, 0)

    expect(desk.lesson).toBeDefined()
    expect(desk.lesson!.studentSlots[0]).toBeNull()
    expect(desk.lesson!.studentSlots[1]!.name).toBe('B')
  })

  it('両方のスロットが空になると lesson を undefined にする', () => {
    const desk = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [
          createStudentEntry('s001', 'A', '数'),
          null,
        ] as [StudentEntry | null, StudentEntry | null],
      },
    }

    removeStudentFromDeskLesson(desk, 0)

    expect(desk.lesson).toBeUndefined()
  })

  it('lesson が undefined の場合は何もしない', () => {
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師',
    }

    removeStudentFromDeskLesson(desk, 0)

    expect(desk.lesson).toBeUndefined()
  })
})

describe('データ堅牢性 packSortCellDesks', () => {
  it('元のセルの desks 配列を変更しない', () => {
    const cell = createPackTestCell()
    const originalTeachers = cell.desks.map((d) => d.teacher)
    const originalStudentNames = cell.desks
      .flatMap((d) => d.lesson?.studentSlots ?? [])
      .filter(Boolean)
      .map((s) => s!.name)

    const sorted = packSortCellDesks(cell)

    // ソート後の講師順は並び替えられているが、元データは変更されていない
    expect(cell.desks.map((d) => d.teacher)).toEqual(originalTeachers)
    expect(cell.desks.flatMap((d) => d.lesson?.studentSlots ?? []).filter(Boolean).map((s) => s!.name)).toEqual(originalStudentNames)

    // ソート結果が元とは異なる講師順序であること（テストが意味を持つことの確認）
    expect(sorted.map((d) => d.teacher)).not.toEqual(originalTeachers)
  })
})

describe('データ堅牢性 buildScheduleCellsForRange マージ', () => {
  it('ボード週の生徒を変更してもマージ結果が元ボード週に遡及しない', () => {
    const range = {
      startDate: '2026-04-06',
      endDate: '2026-04-12',
      periodValue: '',
    }
    const regularLessons = createInitialRegularLessons(new Date('2026-04-01T00:00:00'))

    const boardWeek = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    // ボード週の最初の生徒名を記録
    const firstStudentDesk = boardWeek.find((c) => c.desks.some((d) => d.lesson?.studentSlots[0]))
    const firstDeskIndex = firstStudentDesk?.desks.findIndex((d) => d.lesson?.studentSlots[0]) ?? -1
    const originalName = firstStudentDesk?.desks[firstDeskIndex]?.lesson?.studentSlots[0]?.name

    // マージ実行
    const merged = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    // マージ結果を変更
    const mergedStudentCell = merged.find((c) => c.id === firstStudentDesk?.id)
    const mergedDesk = mergedStudentCell?.desks.find((d) => d.lesson?.studentSlots[0]?.name === originalName)
    if (mergedDesk?.lesson?.studentSlots[0]) {
      mergedDesk.lesson.studentSlots[0].name = '書き換え済み'
    }

    // 元のボード週は変更されていないこと
    expect(firstStudentDesk?.desks[firstDeskIndex]?.lesson?.studentSlots[0]?.name).toBe(originalName)
  })
})

// ──────────────────────────────────────────────────────
// 意図しない操作に対するデータ堅牢性テスト
// ──────────────────────────────────────────────────────

describe('データ堅牢性 意図しない操作 removeStudentFromDeskLesson', () => {
  it('既に null のスロットを削除しても lesson や他スロットが壊れない', () => {
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [null, createStudentEntry('s001', 'A', '数')],
      },
    }

    removeStudentFromDeskLesson(desk, 0)

    // lesson は残っている（slot[1] がまだある）
    expect(desk.lesson).toBeDefined()
    expect(desk.lesson!.studentSlots[0]).toBeNull()
    expect(desk.lesson!.studentSlots[1]!.name).toBe('A')
  })

  it('同じスロットを連続で2回削除しても安全', () => {
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [
          createStudentEntry('s001', 'A', '数'),
          createStudentEntry('s002', 'B', '英'),
        ],
      },
    }

    removeStudentFromDeskLesson(desk, 0)
    expect(desk.lesson).toBeDefined()
    expect(desk.lesson!.studentSlots[0]).toBeNull()

    // 2回目: 既に null のスロットを再度削除
    removeStudentFromDeskLesson(desk, 0)
    expect(desk.lesson).toBeDefined()
    expect(desk.lesson!.studentSlots[1]!.name).toBe('B')
  })

  it('両スロット削除後に lesson undefined 状態で再度呼んでも安全', () => {
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [createStudentEntry('s001', 'A', '数'), null],
      },
    }

    removeStudentFromDeskLesson(desk, 0) // lesson → undefined
    expect(desk.lesson).toBeUndefined()

    removeStudentFromDeskLesson(desk, 0) // lesson なしで再呼び出し
    expect(desk.lesson).toBeUndefined()
    expect(desk.teacher).toBe('講師') // 他のプロパティは壊れていない
  })

  it('生徒を削除しても teacher, memoSlots, statusSlots は変わらない', () => {
    const statusEntry = {
      id: 'status_1',
      studentId: 's099',
      sourceManagedLesson: true,
      name: '過去生徒',
      grade: '中1' as const,
      subject: '英' as const,
      lessonType: 'regular' as const,
      teacherType: 'normal' as const,
      teacherName: '講師',
      dateKey: '2026-04-07',
      slotNumber: 1,
      recordedAt: '2026-04-07T10:00:00',
      status: 'absent' as const,
      sourceLessonId: 'old_lesson',
    }
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師名',
      manualTeacher: true,
      memoSlots: ['メモ1', 'メモ2'],
      statusSlots: [statusEntry, null],
      lesson: {
        id: 'test_lesson',
        note: 'ノート',
        studentSlots: [createStudentEntry('s001', 'A', '数'), null],
      },
    }

    removeStudentFromDeskLesson(desk, 0)

    // lesson は消えるが他のプロパティは残る
    expect(desk.lesson).toBeUndefined()
    expect(desk.teacher).toBe('講師名')
    expect(desk.manualTeacher).toBe(true)
    expect(desk.memoSlots).toEqual(['メモ1', 'メモ2'])
    expect(desk.statusSlots![0]).toBe(statusEntry) // 参照も変わらない
    expect(desk.statusSlots![1]).toBeNull()
  })

  it('範囲外インデックス (2) で呼んでも既存スロットを壊さない', () => {
    const desk: DeskCell = {
      id: 'test_desk',
      teacher: '講師',
      lesson: {
        id: 'test_lesson',
        studentSlots: [
          createStudentEntry('s001', 'A', '数'),
          createStudentEntry('s002', 'B', '英'),
        ],
      },
    }

    removeStudentFromDeskLesson(desk, 2)

    // 既存スロットは壊れていない
    expect(desk.lesson!.studentSlots[0]!.name).toBe('A')
    expect(desk.lesson!.studentSlots[1]!.name).toBe('B')
  })
})

describe('データ堅牢性 意図しない操作 cloneWeeks', () => {
  it('空の weeks 配列を cloneWeeks しても安全', () => {
    const empty: SlotCell[][] = []
    const cloned = cloneWeeks(empty)

    expect(cloned).toEqual([])
    expect(cloned).not.toBe(empty)
  })

  it('セルのない週を cloneWeeks しても安全', () => {
    const emptyWeek: SlotCell[][] = [[]]
    const cloned = cloneWeeks(emptyWeek)

    expect(cloned).toEqual([[]])
    expect(cloned[0]).not.toBe(emptyWeek[0])
  })

  it('desks が空のセルを cloneWeeks しても安全', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [],
    }]]
    const cloned = cloneWeeks(weeks)

    expect(cloned[0][0].desks).toEqual([])
    expect(cloned[0][0].desks).not.toBe(weeks[0][0].desks)
    cloned[0][0].desks.push({ id: 'new', teacher: 'x' })
    expect(weeks[0][0].desks.length).toBe(0)
  })

  it('statusSlots を cloneWeeks で独立コピーする', () => {
    const statusEntry = {
      id: 'status_1',
      studentId: 's001',
      sourceManagedLesson: true,
      name: '生徒A',
      grade: '中3' as const,
      subject: '数' as const,
      lessonType: 'regular' as const,
      teacherType: 'normal' as const,
      teacherName: '田中',
      dateKey: '2026-04-07',
      slotNumber: 1,
      recordedAt: '2026-04-07T10:00:00',
      status: 'attended' as const,
      sourceLessonId: 'lesson_1',
    }
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '田中',
        statusSlots: [statusEntry, null],
        lesson: {
          id: 'lesson_1',
          studentSlots: [createStudentEntry('s001', '生徒A', '数'), null],
        },
      }],
    }]]

    const cloned = cloneWeeks(weeks)

    // 参照が異なる
    expect(cloned[0][0].desks[0].statusSlots).not.toBe(weeks[0][0].desks[0].statusSlots)
    expect(cloned[0][0].desks[0].statusSlots![0]).not.toBe(statusEntry)

    // 内容は同一
    expect(cloned[0][0].desks[0].statusSlots![0]!.name).toBe('生徒A')
    expect(cloned[0][0].desks[0].statusSlots![0]!.status).toBe('attended')

    // クローン側を変更しても元は影響なし
    cloned[0][0].desks[0].statusSlots![0]!.name = '変更済み'
    expect(weeks[0][0].desks[0].statusSlots![0]!.name).toBe('生徒A')
  })

  it('クローン後に元データのデスクを追加してもクローン側に影響しない', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{ id: 'desk_1', teacher: '講師A' }],
    }]]

    const cloned = cloneWeeks(weeks)

    // 元データにデスクを追加
    weeks[0][0].desks.push({ id: 'desk_2', teacher: '講師B' })

    // クローン側は影響なし
    expect(cloned[0][0].desks.length).toBe(1)
    expect(cloned[0][0].desks[0].teacher).toBe('講師A')
  })

  it('teacherAssignmentSource 等のオプショナルフィールドもクローンされる', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '田中',
        manualTeacher: true,
        teacherAssignmentSource: 'deleted',
        teacherAssignmentTeacherId: 't001',
      }],
    }]]

    const cloned = cloneWeeks(weeks)

    expect(cloned[0][0].desks[0].manualTeacher).toBe(true)
    expect(cloned[0][0].desks[0].teacherAssignmentSource).toBe('deleted')
    expect(cloned[0][0].desks[0].teacherAssignmentTeacherId).toBe('t001')

    // クローン側を変更しても元は影響なし
    cloned[0][0].desks[0].teacherAssignmentSource = 'manual'
    expect(weeks[0][0].desks[0].teacherAssignmentSource).toBe('deleted')
  })
})

describe('データ堅牢性 意図しない操作 packSortCellDesks', () => {
  it('デスクが1つだけのセルでも安全にソートできる', () => {
    const cell: SlotCell = {
      id: 'single_desk_cell',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '講師',
        lesson: {
          id: 'lesson_1',
          studentSlots: [createStudentEntry('s001', 'A', '数'), null],
        },
      }],
    }

    const sorted = packSortCellDesks(cell)

    expect(sorted.length).toBe(1)
    expect(sorted[0].lesson!.studentSlots[0]!.name).toBe('A')
    // 元データは変更されていない
    expect(cell.desks[0].lesson!.studentSlots[0]!.name).toBe('A')
  })

  it('全デスクが空でもクラッシュしない', () => {
    const cell: SlotCell = {
      id: 'all_empty',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [
        { id: 'desk_1', teacher: '' },
        { id: 'desk_2', teacher: '' },
        { id: 'desk_3', teacher: '' },
      ],
    }

    const sorted = packSortCellDesks(cell)

    expect(sorted.length).toBe(3)
    expect(sorted.every((d) => d.teacher === '')).toBe(true)
  })

  it('全デスクに生徒がいてもソート時に生徒が失われない', () => {
    const cell: SlotCell = {
      id: 'all_full',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [
        {
          id: 'desk_1',
          teacher: '講師A',
          lesson: { id: 'l1', studentSlots: [createStudentEntry('s1', 'A', '数'), createStudentEntry('s2', 'B', '英')] },
        },
        {
          id: 'desk_2',
          teacher: '講師B',
          lesson: { id: 'l2', studentSlots: [createStudentEntry('s3', 'C', '国'), createStudentEntry('s4', 'D', '理')] },
        },
        {
          id: 'desk_3',
          teacher: '講師C',
          lesson: { id: 'l3', studentSlots: [createStudentEntry('s5', 'E', '社'), null] },
        },
      ],
    }

    const sorted = packSortCellDesks(cell)

    // すべての生徒名を集約
    const allStudentNames = sorted
      .flatMap((d) => d.lesson?.studentSlots ?? [])
      .filter(Boolean)
      .map((s) => s!.name)
      .sort()

    expect(allStudentNames).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('desks が空配列のセルでもクラッシュしない', () => {
    const cell: SlotCell = {
      id: 'no_desks',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [],
    }

    const sorted = packSortCellDesks(cell)

    expect(sorted.length).toBe(0)
  })
})

describe('データ堅牢性 意図しない操作 cloneWeeks → removeStudentFromDeskLesson 連携', () => {
  it('クローンしたデスクから生徒を削除しても元のデスクは影響なし', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '講師',
        lesson: {
          id: 'lesson_1',
          studentSlots: [
            createStudentEntry('s001', 'A', '数'),
            createStudentEntry('s002', 'B', '英'),
          ],
        },
      }],
    }]]

    const cloned = cloneWeeks(weeks)
    removeStudentFromDeskLesson(cloned[0][0].desks[0], 0)

    // クローン側は変更されている
    expect(cloned[0][0].desks[0].lesson!.studentSlots[0]).toBeNull()

    // 元データは影響なし
    expect(weeks[0][0].desks[0].lesson!.studentSlots[0]!.name).toBe('A')
    expect(weeks[0][0].desks[0].lesson!.studentSlots[1]!.name).toBe('B')
  })

  it('クローンしたデスクの全生徒を削除しても元の lesson は残る', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '講師',
        lesson: {
          id: 'lesson_1',
          studentSlots: [createStudentEntry('s001', 'A', '数'), null],
        },
      }],
    }]]

    const cloned = cloneWeeks(weeks)
    removeStudentFromDeskLesson(cloned[0][0].desks[0], 0)

    // クローン側の lesson は消えている
    expect(cloned[0][0].desks[0].lesson).toBeUndefined()

    // 元データの lesson は残っている
    expect(weeks[0][0].desks[0].lesson).toBeDefined()
    expect(weeks[0][0].desks[0].lesson!.studentSlots[0]!.name).toBe('A')
  })

  it('同一 weeks から2回 cloneWeeks しても互いに独立', () => {
    const weeks: SlotCell[][] = [[{
      id: 'cell_1',
      dateKey: '2026-04-07',
      dayLabel: '月',
      dateLabel: '4/7',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{
        id: 'desk_1',
        teacher: '講師',
        lesson: {
          id: 'lesson_1',
          studentSlots: [createStudentEntry('s001', 'A', '数'), null],
        },
      }],
    }]]

    const clone1 = cloneWeeks(weeks)
    const clone2 = cloneWeeks(weeks)

    // clone1 を変更
    clone1[0][0].desks[0].teacher = '変更講師1'
    removeStudentFromDeskLesson(clone1[0][0].desks[0], 0)

    // clone2 は影響なし
    expect(clone2[0][0].desks[0].teacher).toBe('講師')
    expect(clone2[0][0].desks[0].lesson!.studentSlots[0]!.name).toBe('A')

    // 元データも影響なし
    expect(weeks[0][0].desks[0].teacher).toBe('講師')
    expect(weeks[0][0].desks[0].lesson!.studentSlots[0]!.name).toBe('A')
  })
})