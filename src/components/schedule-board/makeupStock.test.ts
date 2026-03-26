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

  it('treats a holiday in a five-week month as shortage stock instead of using the fifth week as the fourth lesson', () => {
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

    expect(shortages).toEqual({
      'student-1__数': ['2026-03-10'],
    })
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
})