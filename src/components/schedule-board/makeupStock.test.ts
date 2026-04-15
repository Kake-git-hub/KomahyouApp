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

    const result = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2025-04-10T00:00:00'),
    )

    expect(result.origins).toEqual({
      'student-1__数': ['2025-04-07'],
    })

    const reopenedResult = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      createSettings({ holidayDates: ['2025-04-07'], forceOpenDates: ['2025-04-07'] }),
      new Date('2025-04-10T00:00:00'),
    )

    expect(reopenedResult.origins).toEqual({})
  })

  it('counts holiday shortages only from the app-added lesson date onward', () => {
    const student = createStudent()
    const regularLesson = createRegularLesson({
      id: `regular_${new Date('2025-04-15T12:00:00').getTime().toString(36)}_test`,
    })
    const settings = createSettings({ holidayDates: ['2025-04-07', '2025-04-21'] })

    const result = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2025-04-30T00:00:00'),
    )

    expect(result.origins).toEqual({
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

    const result = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2026-03-31T00:00:00'),
    )

    expect(result.origins).toEqual({})
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

  it('preserves manual origin slot labels and reason labels on remaining stock entries', () => {
    const student = createStudent()
    const teacher = createTeacher()

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [],
      classroomSettings: createSettings(),
      weeks: [],
      manualAdjustments: {
        'student-1__数': [
          { dateKey: '2025-04-07', slotNumber: 2, reasonLabel: '通常振替' },
          { dateKey: '2025-04-14', slotNumber: 3, reasonLabel: '通常振替' },
        ],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'student-1__数',
      balance: 2,
      remainingOriginDates: ['2025-04-07', '2025-04-14'],
      remainingOriginLabels: ['2025/4/7(月) 2限', '2025/4/14(月) 3限'],
      remainingOriginReasonLabels: ['通常振替', '通常振替'],
      nextOriginDate: '2025-04-07',
      nextOriginLabel: '2025/4/7(月) 2限',
      nextOriginReasonLabel: '通常振替',
    })
  })

  it('consumes only the matched manual origin date and keeps the remaining label metadata', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const weeks = [[createCell({
      id: 'placement-cell',
      dateKey: '2025-04-21',
      dayLabel: '月',
      dateLabel: '4/21',
      slotNumber: 1,
      slotLabel: '1限',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'placed-makeup',
          studentSlots: [createStudentEntry({
            id: 'placed-entry',
            lessonType: 'makeup',
            makeupSourceDate: '2025-04-07',
            makeupSourceLabel: '4/7(月) 2限',
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
        'student-1__数': [
          { dateKey: '2025-04-07', slotNumber: 2, reasonLabel: '通常振替' },
          { dateKey: '2025-04-14', slotNumber: 3, reasonLabel: '通常振替' },
        ],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-30T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'student-1__数',
      balance: 1,
      remainingOriginDates: ['2025-04-14'],
      remainingOriginLabels: ['2025/4/14(月) 3限'],
      remainingOriginReasonLabels: ['通常振替'],
      nextOriginDate: '2025-04-14',
      nextOriginLabel: '2025/4/14(月) 3限',
      nextOriginReasonLabel: '通常振替',
    })
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

  it('does not generate spurious occupied-slot origins when template row ID changes but managed lesson still contains the student', () => {
    // Scenario: template overwrite changes the regularLessons row ID (e.g. desk move).
    // The frozen board still has the OLD managed lesson with the old row ID.
    // computeOccupiedSlotOrigins should not treat the old managed lesson as an "occupied" slot
    // when the student is already placed by a managed lesson from the previous template.
    const student = createStudent({ id: 'nagashima', name: '長嶋', displayName: '長嶋' })
    const teacher = createTeacher()

    // Old managed lesson on the board (from previous template, row ID 'old-row')
    const boardCell = createCell({
      id: 'cell-apr6',
      dateKey: '2026-04-06',
      dayLabel: '月',
      dateLabel: '4/6',
      slotNumber: 4,
      slotLabel: '4限',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'managed_old-row_2026-04-06', // OLD template row ID
          note: '管理データ反映',
          studentSlots: [
            createStudentEntry({
              id: 'managed-nagashima',
              name: '長嶋',
              managedStudentId: 'nagashima',
              subject: '英',
              lessonType: 'regular',
            }),
            null,
          ],
        },
      }],
    })

    // NEW regular lesson row with different ID but same student/slot
    const newRegularLesson = createRegularLesson({
      id: 'new-row', // Different from 'old-row'
      schoolYear: 2026,
      teacherId: 'teacher-1',
      student1Id: 'nagashima',
      subject1: '英',
      dayOfWeek: 1, // Monday
      slotNumber: 4,
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [newRegularLesson],
      classroomSettings: createSettings(),
      weeks: [[boardCell]],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-04-10T00:00:00'),
    })

    // No spurious stock entry should appear
    expect(entries).toEqual([])
  })

  it('still generates occupied-slot origin when cell is fully occupied by non-managed lessons after template change', () => {
    // If the cell is fully occupied by NON-managed lessons (user-placed),
    // the managed regular lesson can't be placed → occupied origin generated.
    const student = createStudent({ id: 'nagashima', name: '長嶋', displayName: '長嶋' })
    const teacher = createTeacher()

    const boardCell = createCell({
      id: 'cell-apr6',
      dateKey: '2026-04-06',
      dayLabel: '月',
      dateLabel: '4/6',
      slotNumber: 4,
      slotLabel: '4限',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'user-placed-lesson', // NOT a managed lesson
          studentSlots: [
            createStudentEntry({
              id: 'other-entry',
              name: '別の生徒',
              managedStudentId: 'other-student',
              subject: '数',
              lessonType: 'regular',
            }),
            null,
          ],
        },
      }],
    })

    const regularLesson = createRegularLesson({
      id: 'new-row',
      schoolYear: 2026,
      teacherId: 'teacher-1',
      student1Id: 'nagashima',
      subject1: '英',
      dayOfWeek: 1,
      slotNumber: 4,
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks: [[boardCell]],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-04-10T00:00:00'),
    })

    // Cell occupied by non-managed lesson → occupied origin generated
    const entry = entries.find((e) => e.key === 'nagashima__英')
    expect(entry).toBeTruthy()
    expect(entry!.balance).toBeGreaterThan(0)
  })

  it('does not double-count stock when template overwrites and makeup is already consumed', () => {
    // Full end-to-end scenario:
    // 1. Regular lesson stocked on 4/6 (manual adjustment)
    // 2. Placed as 振替 on 4/15
    // 3. Template changed → regularLessons has new row ID
    // 4. Frozen board at 4/13 has old managed lesson with old row ID
    // The stock balance should remain 0 (consumed by the 振替).
    const student = createStudent({ id: 'nagashima', name: '長嶋', displayName: '長嶋' })
    const teacher = createTeacher()

    // April 6: suppressed (desk empty)
    const cellApr6 = createCell({
      id: 'cell-apr6',
      dateKey: '2026-04-06',
      dayLabel: '月',
      dateLabel: '4/6',
      slotNumber: 4,
      slotLabel: '4限',
      desks: [{ id: 'desk-1', teacher: '', lesson: undefined }],
    })

    // April 13: old managed lesson still present (not suppressed)
    const cellApr13 = createCell({
      id: 'cell-apr13',
      dateKey: '2026-04-13',
      dayLabel: '月',
      dateLabel: '4/13',
      slotNumber: 4,
      slotLabel: '4限',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'managed_old-row_2026-04-13',
          note: '管理データ反映',
          studentSlots: [
            createStudentEntry({
              id: 'managed-nagashima-13',
              name: '長嶋',
              managedStudentId: 'nagashima',
              subject: '英',
              lessonType: 'regular',
            }),
            null,
          ],
        },
      }],
    })

    // April 15: 振替 placed (consuming the 4/6 stock)
    const cellApr15 = createCell({
      id: 'cell-apr15',
      dateKey: '2026-04-15',
      dayLabel: '水',
      dateLabel: '4/15',
      slotNumber: 4,
      slotLabel: '4限',
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'makeup-lesson',
          studentSlots: [
            createStudentEntry({
              id: 'makeup-nagashima',
              name: '長嶋',
              managedStudentId: 'nagashima',
              subject: '英',
              lessonType: 'makeup',
              makeupSourceDate: '2026-04-06',
              makeupSourceLabel: '4/6 4限',
            }),
            null,
          ],
        },
      }],
    })

    // New regular lesson row (different ID from old template)
    const newRegularLesson = createRegularLesson({
      id: 'new-row',
      schoolYear: 2026,
      teacherId: 'teacher-1',
      student1Id: 'nagashima',
      subject1: '英',
      dayOfWeek: 1,
      slotNumber: 4,
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [newRegularLesson],
      classroomSettings: createSettings(),
      weeks: [[cellApr6, cellApr13, cellApr15]],
      manualAdjustments: {
        'nagashima__英': [{ dateKey: '2026-04-06' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-04-16T00:00:00'),
    })

    // Balance should be 0: the manual origin for 4/6 is consumed by the 振替 on 4/15.
    // No spurious occupied-slot origin from the old managed lesson at 4/13.
    const entry = entries.find((e) => e.key === 'nagashima__英')
    expect(entry).toBeUndefined()
  })

  it('stores slot numbers alongside automatic shortage origins and includes them in labels', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({ slotNumber: 3 })
    const settings = createSettings({ holidayDates: ['2025-04-07'] })

    const result = computeAutomaticShortageOrigins(
      [regularLesson],
      [student],
      settings,
      new Date('2025-04-10T00:00:00'),
    )

    expect(result.slotNumbers).toEqual({
      'student-1__数': { '2025-04-07': 3 },
    })

    // End-to-end: the slot number should appear in origin labels
    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: settings,
      weeks: [],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-10T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      remainingOriginLabels: ['2025/4/7(月) 3限'],
      nextOriginLabel: '2025/4/7(月) 3限',
    })
  })

  it('includes slot number in occupied-slot origin labels', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({ slotNumber: 2 })
    const weeks = [[createCell({
      slotNumber: 2,
      slotLabel: '2限',
    })]]

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
      remainingOriginLabels: ['2025/4/7(月) 2限'],
      nextOriginLabel: '2025/4/7(月) 2限',
    })
  })
})