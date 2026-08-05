import { describe, expect, it, vi } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildMakeupStockEntries, computeAutomaticShortageOrigins, computeOutstandingAbsenceOrigins, countPlannedMakeupsByKey } from './makeupStock'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
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
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
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

    // 2026-07-31 時限単位化: origin は `日付#限` のトークンで持つ。
    expect(result.origins).toEqual({
      'student-1__数': ['2025-04-07#1'],
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
      'student-1__数': ['2025-04-21#1'],
    })
  })

  it('treats a holiday in a five-week month as shortage stock when all weekly occurrences are expected', () => {
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

    expect(result.origins).toEqual({
      'student-1__数': ['2026-03-10#4'],
    })
  })

  it('does not treat the fifth weekly regular lesson in a month as over-assigned stock', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({
      dayOfWeek: 2,
      slotNumber: 4,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    })
    const weeks = [['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31'].map((dateKey) => createCell({
      dateKey,
      slotNumber: 4,
      desks: [{
        id: `desk-${dateKey}`,
        teacher: '田中講師',
        lesson: {
          id: `managed_${regularLesson.id}_${dateKey}`,
          studentSlots: [createStudentEntry({
            id: `regular-${dateKey}`,
            lessonType: 'regular',
            managedStudentId: 'student-1',
          }), null],
        },
      }],
    }))]

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

    expect(entries.find((entry) => entry.key === 'student-1__数')).toBeUndefined()
  })

  it('does not count frozen regular placements before the current template period as over-assigned stock', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({
      dayOfWeek: 2,
      slotNumber: 4,
      startDate: '2026-03-10',
      endDate: '2026-03-31',
    })
    const weeks = [['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31'].map((dateKey) => createCell({
      dateKey,
      slotNumber: 4,
      desks: [{
        id: `desk-${dateKey}`,
        teacher: '田中講師',
        lesson: {
          id: dateKey < regularLesson.startDate ? `managed_old_${dateKey}` : `managed_${regularLesson.id}_${dateKey}`,
          studentSlots: [createStudentEntry({
            id: `regular-${dateKey}`,
            lessonType: 'regular',
            managedStudentId: 'student-1',
          }), null],
        },
      }],
    }))]

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

    expect(entries.find((entry) => entry.key === 'student-1__数')).toBeUndefined()
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

  // 空きコマ不足(occupiedSlotOrigins)経路は廃止(オーナー指示 2026-07-03)。
  // テンプレ毎週強制適用が前提で、開講日にコマが埋まっていても振替(未消化)を自動生成しない。
  // 過去にこの偽originが大量発生→一括削除される際に本物の休講日振替(例: 白川 数 7/20)まで
  // 巻き込まれて消える事故が起きたため、経路ごと廃止した。休講日(自動)/同時間帯重複/手動 のみが未消化源。
  it('does not generate makeup stock from an occupied open-day slot (空きコマ不足 origin 廃止)', () => {
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

    expect(entries).toHaveLength(0)
  })

  it('does not generate stock for an occupied fifth weekly occurrence (空きコマ不足 origin 廃止)', () => {
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

    expect(entries).toHaveLength(0)
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

  it('マイナス残廃止: 希望回数を超えて配置してもマイナスにならず残0で一覧から除外される', () => {
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

    // マイナス残廃止: 残数は0下限。残0は一覧から除外されるため空になる(spec-makeup-stock.md §4)。
    expect(entries).toHaveLength(0)
  })

  it('回帰防止: 全通常授業を配置済みでも振替1コマ置いて残が2件減らない(3→2)', () => {
    // バグ: 通常授業を全て配置済み(assignedRegular == totalLessonCount)の生徒が
    // 繰越/手動の未消化振替を3件持つとき、1コマ置くと overAssignedRegularLessons の
    // 減算が remainingOriginDates の消化と二重にかかり、残が 3→1 になっていた。
    // 正しくは消化1件のみで 3→2(spec-makeup-stock.md §4 / §★3-C)。
    const student = createStudent()
    const teacher = createTeacher()
    // 期間を1コマ(2026-03-02 の月曜)だけに絞り totalLessonCount=1 にする
    const regularLesson = createRegularLesson({
      dayOfWeek: 1,
      slotNumber: 1,
      startDate: '2026-03-02',
      endDate: '2026-03-02',
    })
    const weeks = [[
      // 通常授業を1コマ配置(assignedRegularCount=1=totalLessonCount)
      createCell({
        id: 'regular-cell',
        dateKey: '2026-03-02',
        dayLabel: '月',
        dateLabel: '3/2',
        slotNumber: 1,
        slotLabel: '1限',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'managed_regular-1_2026-03-02',
            studentSlots: [createStudentEntry({ id: 'regular-entry', lessonType: 'regular' }), null],
          },
        }],
      }),
      // 振替を1コマ配置(繰越3件のうち 03-05 を消化)
      createCell({
        id: 'makeup-cell',
        dateKey: '2026-03-05',
        dayLabel: '木',
        dateLabel: '3/5',
        slotNumber: 2,
        slotLabel: '2限',
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'makeup-lesson',
            studentSlots: [createStudentEntry({
              id: 'makeup-entry',
              lessonType: 'makeup',
              makeupSourceDate: '2026-03-05',
              makeupSourceLabel: '3/5(木)',
            }), null],
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
      // 繰越(手動)の未消化振替3件
      manualAdjustments: {
        'student-1__数': [
          { dateKey: '2026-03-05' },
          { dateKey: '2026-03-06' },
          { dateKey: '2026-03-09' },
        ],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2026-03-31T00:00:00'),
    })

    const match = entries.find((e) => e.key === 'student-1__数')
    expect(match).toBeDefined()
    // 消化1件のみ→残2件。overAssigned 減算が残っていると 1 になり失敗する。
    expect(match!.balance).toBe(2)
    expect(match!.remainingOriginDates).toEqual(['2026-03-06', '2026-03-09'])
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

  it('hides individually suppressed pending makeup origins while keeping other origins visible', () => {
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
          { dateKey: '2025-04-07', reasonLabel: '手動調整' },
          { dateKey: '2025-04-14', reasonLabel: '手動調整' },
        ],
      },
      suppressedOrigins: {
        'student-1__数': [{ dateKey: '2025-04-07' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.remainingOriginDates).toEqual(['2025-04-14'])
    expect(entries[0]?.balance).toBe(1)
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

  it('does not generate occupied-slot origin even when cell is fully occupied by non-managed lessons (空きコマ不足 origin 廃止)', () => {
    // 空きコマ不足経路廃止後: 生徒の通常コマが非managedの授業で完全に埋まっていても、
    // 未消化振替を自動生成しない(手動配置で対応する運用に統一)。
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

    // Cell occupied by non-managed lesson → 空きコマ不足origin は生成されない(廃止)
    const entry = entries.find((e) => e.key === 'nagashima__英')
    expect(entry).toBeUndefined()
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

    // 2026-07-31 時限単位化: origin は `日付#限` のトークンで持つ（旧: 日付配列＋別の時限マップ）。
    expect(result.origins).toEqual({
      'student-1__数': ['2025-04-07#3'],
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

  it('ignores stale makeupSourceDate on regular-type students', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson({ dayOfWeek: 1, slotNumber: 1 })
    // 4/7 is Monday; student has manual absence origin on 4/7
    // 4/14 cell contains regular lesson with stale makeupSourceDate (data corruption)
    const cellWith4_14 = createCell({
      id: 'cell-4-14',
      dateKey: '2025-04-14',
      dayLabel: '月',
      dateLabel: '4/14',
      slotNumber: 1,
      desks: [
        {
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'managed_regular-1_2025-04-14',
            studentSlots: [
              createStudentEntry({
                id: 'student-1_2025-04-14_数',
                managedStudentId: 'student-1',
                lessonType: 'regular',
                makeupSourceDate: '2025-04-14', // stale data from previous operation
              }),
              null,
            ],
          },
        },
      ],
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings(),
      weeks: [[cellWith4_14]],
      manualAdjustments: {
        'student-1__数': [{ dateKey: '2025-04-07' }],
      },
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    // Manual origin on 4/7 should remain visible (balance +1)
    // The stale makeupSourceDate on the regular entry must not consume it
    const match = entries.find((e) => e.key === 'student-1__数')
    expect(match).toBeDefined()
    expect(match!.balance).toBe(1)
  })

  it('counts attended makeup in statusSlots as consumed (not unconsumed)', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson()

    const cellWithAttendedMakeup = createCell({
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [{
          id: 'status-attended-1',
          studentId: 'student-1',
          sourceManagedLesson: true,
          name: '山田 太郎',
          managedStudentId: 'student-1',
          grade: '中1' as const,
          subject: '数' as const,
          lessonType: 'makeup' as const,
          teacherType: 'normal' as const,
          teacherName: '田中講師',
          dateKey: '2025-04-14',
          slotNumber: 1,
          recordedAt: new Date().toISOString(),
          status: 'attended' as const,
          sourceLessonId: 'lesson-1',
          makeupSourceDate: '2025-04-07',
        }, null],
        lesson: {
          id: 'lesson-1',
          studentSlots: [null, null],
        },
      }],
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings({ holidayDates: ['2025-04-07'] }),
      weeks: [[cellWithAttendedMakeup]],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    // The holiday shortage on 4/7 is consumed by the attended makeup → balance 0
    const match = entries.find((e) => e.key === 'student-1__数')
    expect(match).toBeUndefined()
  })

  it('does not count absent makeup in statusSlots as consumed (remains unconsumed)', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson()

    const cellWithAbsentMakeup = createCell({
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [{
          id: 'status-absent-1',
          studentId: 'student-1',
          sourceManagedLesson: true,
          name: '山田 太郎',
          managedStudentId: 'student-1',
          grade: '中1' as const,
          subject: '数' as const,
          lessonType: 'makeup' as const,
          teacherType: 'normal' as const,
          teacherName: '田中講師',
          dateKey: '2025-04-14',
          slotNumber: 1,
          recordedAt: new Date().toISOString(),
          status: 'absent' as const,
          sourceLessonId: 'lesson-1',
          makeupSourceDate: '2025-04-07',
        }, null],
        lesson: {
          id: 'lesson-1',
          studentSlots: [null, null],
        },
      }],
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings({ holidayDates: ['2025-04-07'] }),
      weeks: [[cellWithAbsentMakeup]],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    // The holiday shortage on 4/7 is NOT consumed by the absent makeup → balance 1
    const match = entries.find((e) => e.key === 'student-1__数')
    expect(match).toBeDefined()
    expect(match!.balance).toBe(1)
  })

  it('counts absent-no-makeup in statusSlots as consumed (not unconsumed)', () => {
    const student = createStudent()
    const teacher = createTeacher()
    const regularLesson = createRegularLesson()

    const cellWithAbsentNoMakeup = createCell({
      desks: [{
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [{
          id: 'status-anm-1',
          studentId: 'student-1',
          sourceManagedLesson: true,
          name: '山田 太郎',
          managedStudentId: 'student-1',
          grade: '中1' as const,
          subject: '数' as const,
          lessonType: 'makeup' as const,
          teacherType: 'normal' as const,
          teacherName: '田中講師',
          dateKey: '2025-04-14',
          slotNumber: 1,
          recordedAt: new Date().toISOString(),
          status: 'absent-no-makeup' as const,
          sourceLessonId: 'lesson-1',
          makeupSourceDate: '2025-04-07',
        }, null],
        lesson: {
          id: 'lesson-1',
          studentSlots: [null, null],
        },
      }],
    })

    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: createSettings({ holidayDates: ['2025-04-07'] }),
      weeks: [[cellWithAbsentNoMakeup]],
      manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: new Date('2025-04-20T00:00:00'),
    })

    // The holiday shortage on 4/7 is consumed by absent-no-makeup → balance 0
    const match = entries.find((e) => e.key === 'student-1__数')
    expect(match).toBeUndefined()
  })
})
// ============================================================================
// computeOutstandingAbsenceOrigins（オーナー確定 2026-08-05・生徒日程表の括弧内を盤面ベースへ）
//
// 「まだ振替コマが組まれていない休み」を盤面だけから算出する。生徒日程表の通常回数の括弧内
// （要実施数）＝ その期間の実績 ＋ その期間の未振替の休み、に使う土台。
// ★在庫台帳・「今日」・学年度に依存しないことがこの関数の存在意義（在庫を根拠にすると
//   操作していないのに過去月が動き、出欠を付けていない生徒に警告が出る）。
// ============================================================================
describe('computeOutstandingAbsenceOrigins', () => {
  const resolveStudentKey = (entry: { managedStudentId?: string; name: string }) => entry.managedStudentId ?? entry.name

  function absentStatus(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
    return {
      id: 'status-1',
      studentId: 'student-1',
      sourceManagedLesson: true,
      name: '山田',
      managedStudentId: 'student-1',
      grade: '中1',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
      teacherName: '田中講師',
      dateKey: '2026-07-01',
      slotNumber: 1,
      recordedAt: '2026-07-01T00:00:00.000Z',
      status: 'absent',
      sourceLessonId: 'lesson-1',
      ...overrides,
    }
  }

  function cellWith(dateKey: string, slotNumber: number, desk: Partial<SlotCell['desks'][number]>): SlotCell {
    return {
      id: `${dateKey}_${slotNumber}`,
      dateKey,
      dayLabel: '火',
      dateLabel: dateKey.slice(5),
      slotLabel: `${slotNumber}限`,
      slotNumber,
      timeLabel: '17:00-18:20',
      isOpenDay: true,
      desks: [{ id: `${dateKey}_${slotNumber}_desk_1`, teacher: '田中講師', ...desk }],
    }
  }

  const run = (weeks: SlotCell[][]) => computeOutstandingAbsenceOrigins({ weeks, resolveStudentKey })

  it('出欠記録がなければ未振替は0件（＝左と括弧が必ず一致する土台）', () => {
    const weeks = [[cellWith('2026-07-01', 1, {
      lesson: { id: 'l1', studentSlots: [createStudentEntry({ lessonType: 'regular' }), null] },
    })]]
    expect(run(weeks)).toEqual({})
  })

  it('休んで振替がまだなら1件残る', () => {
    const weeks = [[cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] })]]
    expect(run(weeks)).toEqual({ 'student-1__数': ['2026-07-01#1'] })
  })

  it('振替コマを置くと消化されて0件になる（表示期間の内外を問わず盤面全体で相殺する）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      // 表示期間の外（8月）に置いた振替でも消化する＝元の月の括弧からも減る（オーナー確定）
      cellWith('2026-08-05', 3, {
        lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限' }), null] },
      }),
    ]]
    expect(run(weeks)).toEqual({})
  })

  // ★両走査規則。studentSlots だけ走査すると出席を付けた瞬間に消化が消え、振替済みの休みが復活する。
  it('振替コマに出席を付けても消化のまま（statusSlots も走査する）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 2, {
        statusSlots: [absentStatus({
          id: 'status-2', dateKey: '2026-07-08', slotNumber: 2, status: 'attended',
          lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限',
        }), null],
      }),
    ]]
    expect(run(weeks)).toEqual({})
  })

  it('振替コマをまた休むと1件だけ残る（元の休みと二重に数えない）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 2, {
        statusSlots: [absentStatus({
          id: 'status-2', dateKey: '2026-07-08', slotNumber: 2,
          lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限',
        }), null],
      }),
    ]]
    expect(run(weeks)['student-1__数']).toHaveLength(1)
  })

  it('振無休(absent-no-makeup)は実績に数えるので義務にしない', () => {
    const weeks = [[cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ status: 'absent-no-makeup' }), null] })]]
    expect(run(weeks)).toEqual({})
  })

  it('移動元マーカー(moved)は義務にも消化にも数えない（移動先のコマが会計を持つ）', () => {
    const weeks = [[cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ status: 'moved' }), null] })]]
    expect(run(weeks)).toEqual({})
  })

  // ★多重集合。同日を1件に潰すと、2コマ休んで1コマ振替した状態が「振替済み」に化ける。
  it('同じ日に同じ科目を2コマ休むと2件残る（1件の振替では1件しか消えない）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-01', 2, { statusSlots: [absentStatus({ id: 'status-2', slotNumber: 2 }), null] }),
    ]]
    expect(run(weeks)['student-1__数']).toHaveLength(2)

    const withOneMakeup = [[
      ...weeks[0],
      cellWith('2026-07-08', 5, {
        lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限' }), null] },
      }),
    ]]
    expect(run(withOneMakeup)['student-1__数']).toHaveLength(1)
  })

  // 2段消化の受け皿。時限が取れない旧データでも同じ日付で1件消化する（消えないと未振替が過剰に残る）。
  it('振替元ラベルから時限が取れない旧データは同じ日付で消化する', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 5, {
        lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'makeup', makeupSourceDate: '2026-07-01' }), null] },
      }),
    ]]
    expect(run(weeks)).toEqual({})
  })

  it('講習と体験の休みは通常側の未振替に流れ込まない', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ lessonType: 'special', specialSessionId: 'sess-1' }), null] }),
      cellWith('2026-07-02', 1, { statusSlots: [absentStatus({ id: 'status-3', lessonType: 'trial' }), null] }),
    ]]
    expect(run(weeks)).toEqual({})
  })

  // ★回帰防止(INV-06 マトリクス :201 と同型・2026-08-05 の INV 監査で実測):
  // 別日へ移動した通常授業を休むと、移動元は moved(義務にならない)なので、移動先の休みが唯一の記録になる。
  // 休みの振替コマを「消化」に数えると、同じ記録が義務と消化の両方へ積まれて相殺し、休んだ1コマが静かに消える。
  it('別日へ移動した授業を休むと1件残る（移動元は moved なので移動先の休みが唯一の記録）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ status: 'moved' }), null] }),
      cellWith('2026-07-05', 3, {
        statusSlots: [absentStatus({
          id: 'status-2', dateKey: '2026-07-05', slotNumber: 3,
          lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限',
        }), null],
      }),
    ]]
    expect(run(weeks)).toEqual({ 'student-1__数': ['2026-07-01#1'] })
  })

  // ★実績側(scheduleHtml の回数集計)は営業日かどうかを見ない。消化側だけ isOpenDay で絞ると、
  // 休日化された日に置いた振替が消化されなくなり括弧が過大になる。在庫側の関数に「揃える」誘惑への釘。
  it('非営業日に置かれた振替コマも消化に数える（実績側が isOpenDay を見ないので対称にする）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      {
        ...cellWith('2026-07-08', 2, {
          lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'makeup', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限' }), null] },
        }),
        isOpenDay: false,
      },
    ]]
    expect(run(weeks)).toEqual({})
  })

  // ★在庫側は manualAdded を除外する箇所があるが、この関数は除外しない。実績側が手動追加コマも
  // 回数に数えるため。片方だけ除外すると括弧と実績がずれる。義務・消化の両方向で固定する。
  it('手動追加コマも義務・消化の両方に数える（在庫側の manualAdded 除外に揃えない）', () => {
    const settledByManual = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 2, {
        lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'makeup', manualAdded: true, makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限' }), null] },
      }),
    ]]
    expect(run(settledByManual)).toEqual({})

    const owedByManual = [[cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ manualAdded: true }), null] })]]
    expect(run(owedByManual)['student-1__数']).toHaveLength(1)
  })

  it('増コマの休みも義務に数える（実績側が増コマを通常回数に数えるので対称）', () => {
    const weeks = [[cellWith('2026-07-01', 1, { statusSlots: [absentStatus({ lessonType: 'extra' }), null] })]]
    expect(run(weeks)['student-1__数']).toHaveLength(1)
  })

  // 元の授業日へ戻した振替は normalizeLessonPlacement で lessonType が 'regular' に戻るが
  // makeupSourceDate は残る。消化の判定を lessonType で絞ると、この戻し方をしたときに消化が消える。
  it('元日へ戻して通常に復帰したコマも、振替元日を持つ限り消化に数える', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 2, {
        lesson: { id: 'l2', studentSlots: [createStudentEntry({ lessonType: 'regular', makeupSourceDate: '2026-07-01', makeupSourceLabel: '2026/7/1(水) 1限' }), null] },
      }),
    ]]
    expect(run(weeks)).toEqual({})
  })

  // ★この関数の存在意義そのもの。在庫台帳は today と学年度に依存して増減するため、
  // 括弧内の根拠にすると「操作していないのに日付が変わるだけで過去月が動く」が起きる。
  // 将来「精度を上げよう」と today や在庫台帳を引数に足す改変を、ここで落とす。
  it('システム日付が変わっても結果が変わらない（today・学年度に依存しない）', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-08', 2, { statusSlots: [absentStatus({ id: 'status-2', slotNumber: 2 }), null] }),
    ]]

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const early = run(weeks)
      vi.setSystemTime(new Date('2030-12-31T00:00:00.000Z'))
      const late = run(weeks)
      expect(early).toEqual(late)
      expect(early['student-1__数']).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
    // 引数は weeks と キー解決関数だけ（在庫台帳を受け取れる形にしない）
    expect(computeOutstandingAbsenceOrigins.length).toBe(1)
  })

  // 同日2コマで「片方休み・片方を別日へ移動」は、2段消化の同日フォールバックが
  // 移動先の消化(7/1#2)で休み(7/1#1)を食う。裁定が未確定なので現状の挙動を可視化だけしておく。
  it.todo('同日2コマで片方休み・片方移動したときの扱い（要仕様確定・現状は0件になる）')

  it('生徒と科目ごとに分けて数える', () => {
    const weeks = [[
      cellWith('2026-07-01', 1, { statusSlots: [absentStatus(), null] }),
      cellWith('2026-07-02', 1, { statusSlots: [absentStatus({ id: 'status-2', subject: '英' }), null] }),
      cellWith('2026-07-03', 1, { statusSlots: [absentStatus({ id: 'status-3', managedStudentId: 'student-2', studentId: 'student-2' }), null] }),
    ]]
    expect(Object.keys(run(weeks)).sort()).toEqual(['student-1__数', 'student-1__英', 'student-2__数'])
  })
})
