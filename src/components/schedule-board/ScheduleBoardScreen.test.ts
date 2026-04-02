import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers } from '../basic-data/basicDataModel'
import { createInitialRegularLessons } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, buildScheduleCellsForRange, normalizeLessonPlacement, packSortCellDesks } from './ScheduleBoardScreen'

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