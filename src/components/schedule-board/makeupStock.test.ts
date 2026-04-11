import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildMakeupStockEntries, computeAutomaticShortageOrigins, countPlannedMakeupsByKey } from './makeupStock'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
    isHidden: false,
    ...overrides,
  }
}

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中講師',
    email: 'teacher@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    isHidden: false,
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    memo: '',
    ...overrides,
  }
}

function createRegularLesson(overrides: Partial<RegularLessonRow> = {}): RegularLessonRow {
  return {
    id: 'regular-1',
    schoolYear: 2025,
    teacherId: 'teacher-1',
    student1Id: 'student-1',
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
    ...overrides,
  }
}

function createSettings(overrides: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return {
    closedWeekdays: [],
    holidayDates: [],
    forceOpenDates: [],
    deskCount: 1,
    ...overrides,
  }
}

function createStudentEntry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '山田',
    managedStudentId: 'student-1',
    grade: '中1',
    subject: '数',
    lessonType: 'makeup',
    teacherType: 'normal',
    ...overrides,
  }
}

function createCell(overrides: Partial<SlotCell> = {}): SlotCell {
  return {
    id: 'cell-1',
    dateKey: '2025-04-07',
    dayLabel: '月',
    dateLabel: '4/7',
    slotLabel: '1限',
    slotNumber: 1,
    timeLabel: '17:00-18:20',
    isOpenDay: true,
    desks: [
      {
        id: 'desk-1',
        teacher: '別講師',
        lesson: {
          id: 'occupied-lesson',
          studentSlots: [createStudentEntry({ id: 'other-entry', managedStudentId: 'other-student' }), null],
        },
      },
    ],
    ...overrides,
  }
}

describe('makeupStock', () => {
  it('counts holiday closures as automatic shortage origins unless force-opened', () => {
    const student = createStudent()
    const regularLesson = createRegularLesson()
    const settings = createSettings({ holidayDates: ['2025-04-07'] })

    const shortages = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2025-04-10T00:00:00'),
    )

    expect(shortages).toEqual({
      'student-1__数': ['2025-04-07'],
    })

    const reopenedShortages = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      createSettings({ holidayDates: ['2025-04-07'], forceOpenDates: ['2025-04-07'] }),
      new Date('2025-04-10T00:00:00'),
    )

    expect(reopenedShortages).toEqual({})
  })

  it('counts holiday shortages only from the app-added lesson date onward', () => {
    const student = createStudent()
    const regularLesson = createRegularLesson({
      id: `regular_${new Date('2025-04-15T12:00:00').getTime().toString(36)}_test`,
    })
    const settings = createSettings({ holidayDates: ['2025-04-07', '2025-04-21'] })

    const shortages = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2025-04-30T00:00:00'),
    )

    expect(shortages).toEqual({
      'student-1__数': ['2025-04-21'],
    })
  })

  it('does not treat a holiday in a five-week month as shortage stock when four contractual lessons still fit', () => {
    const student = createStudent()
    const regularLesson = createRegularLesson({
      dayOfWeek: 2,
      slotNumber: 4,
    })
    const settings = createSettings({ holidayDates: ['2026-03-10'] })

    const shortages = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2026-03-31T00:00:00'),
    )

    expect(shortages).toEqual({})
  })

  it('ignores manual-added makeup students in planned makeup counts', () => {
    const weeks = [[createCell({
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'makeup-lesson',
          studentSlots: [
            createStudentEntry({
              id: 'planned-makeup',
              lessonType: 'makeup',
              managedStudentId: 'student-1',
              manualAdded: false,
            }),
            createStudentEntry({
              id: 'manual-makeup',
              lessonType: 'makeup',
              managedStudentId: 'student-1',
              manualAdded: true,
            }),
          ],
        },
      }],
    })]]

    const counts = countPlannedMakeupsByKey(weeks, (student) => student.managedStudentId ?? student.id)

    expect(counts).toEqual({
      'student-1__数': 1,
    })
  })

  it('reports occupied slots as remaining stock with the occupied-slot reason', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson()
    const weeks = [[createCell()]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'student-1__数',
      autoShortage: 1,
      balance: 1,
      nextOriginDate: '2025-04-07',
      nextOriginReasonLabel: '空きコマ不足',
      remainingOriginDates: ['2025-04-07'],
      remainingOriginReasonLabels: ['空きコマ不足'],
    })
  })

  it('does not create stock for an occupied fifth weekly occurrence that is outside the four-lesson contract', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({
      dayOfWeek: 2,
      slotNumber: 1,
    })
    const weeks = [[createCell({
      id: 'cell-5th-week',
      dateKey: '2026-03-31',
      dayLabel: '火',
      dateLabel: '3/31',
      slotNumber: 1,
      slotLabel: '1限',
      desks: [{
        id: 'desk-1',
        teacher: '別講師',
        lesson: {
          id: 'occupied-5th-week',
          studentSlots: [createStudentEntry({ id: 'other-entry', managedStudentId: 'other-student' }), null],
        },
      }],
    })]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-03-31T00:00:00'),
    })

    expect(entries).toEqual([])
  })

  it('consumes the origin when a makeup is returned to the original slot as a regular lesson', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson()
    const weeks = [[createCell({
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'returned-regular',
          studentSlots: [createStudentEntry({
            lessonType: 'regular',
            makeupSourceDate: '2025-04-07',
            makeupSourceLabel: '4/7(月) 1限',
          }), null],
        },
      }],
    })]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {
        'student-1__数': [{ dateKey: '2025-04-07' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    expect(entries).toEqual([])
  })

  it('goes negative when regular and makeup assignments exceed the shortened lesson quota', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({
      dayOfWeek: 2,
      slotNumber: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-17',
      student2StartDate: '2026-03-01',
      student2EndDate: '2026-03-17',
    })
    const weeks = [[
      createCell({
        id: 'regular-1',
        dateKey: '2026-03-03',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'managed_regular-1_2026-03-03',
            studentSlots: [createStudentEntry({ lessonType: 'regular' }), null],
          },
        }],
      }),
      createCell({
        id: 'regular-2',
        dateKey: '2026-03-10',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'managed_regular-1_2026-03-10',
            studentSlots: [createStudentEntry({ lessonType: 'regular', id: 'regular-entry-2' }), null],
          },
        }],
      }),
      createCell({
        id: 'makeup-1',
        dateKey: '2026-03-12',
        slotNumber: 2,
        slotLabel: '2限',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'makeup-lesson-1',
            studentSlots: [createStudentEntry({ lessonType: 'makeup', id: 'makeup-entry-1' }), null],
          },
        }],
      }),
      createCell({
        id: 'makeup-2',
        dateKey: '2026-03-13',
        slotNumber: 3,
        slotLabel: '3限',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'makeup-lesson-2',
            studentSlots: [createStudentEntry({ lessonType: 'makeup', id: 'makeup-entry-2' }), null],
          },
        }],
      }),
    ]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-03-31T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'student-1__数',
      balance: -1,
      assignedRegularLessons: 2,
      assignedMakeupLessons: 2,
      totalLessonCount: 3,
      overAssignedRegularLessons: 1,
      negativeReason: '残数がマイナスです。希望回数を 1 件上回って配置しています。',
    })
  })

  it('consumes manual-adjustment stock when a makeup is placed for a student without regular lessons', () => {
    const student = createStudent({ id: 'orphan-student', name: '古賀 爽太', displayName: '古賀爽太' })
    const teacher = createTeacher()
    const weeks = [[createCell({
      id: 'placement-cell',
      dateKey: '2026-04-06',
      dayLabel: '月',
      dateLabel: '4/6',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'placed-makeup',
          studentSlots: [createStudentEntry({
            id: 'placed-entry',
            name: '古賀爽太',
            managedStudentId: 'orphan-student',
            lessonType: 'makeup',
            makeupSourceDate: '2026-04-02',
            makeupSourceLabel: '4/2(木)',
          }), null],
        },
      }],
    })]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {
        'orphan-student__数': [{ dateKey: '2026-04-02' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-04-10T00:00:00'),
    })

    expect(entries).toEqual([])
  })

  it('consumes legacy manual-prefixed stock for a managed student', () => {
    const student = createStudent({ id: 's024', name: '古賀 爽太', displayName: '古賀爽太' })
    const teacher = createTeacher()
    const weeks = [[createCell({
      id: 'placement-cell',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'placed-makeup',
          studentSlots: [createStudentEntry({
            id: 'placed-entry',
            name: '古賀爽太',
            managedStudentId: 's024',
            lessonType: 'makeup',
            makeupSourceDate: '2026-04-03',
            makeupSourceLabel: '4/3(金)',
          }), null],
        },
      }],
    })]]

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [],
      classroomSettings: createSettings(),
      weeks,
      manualAdjustments: {
        'manual:s024__数': [{ dateKey: '2026-04-03' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-04-10T00:00:00'),
    })

    expect(entries).toEqual([])
  })
})