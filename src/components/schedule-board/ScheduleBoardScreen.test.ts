import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers, type StudentRow } from '../basic-data/basicDataModel'
import { createInitialRegularLessons } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { buildLinkedLessonDestinationMap } from './lessonLinks'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { appendDeletedStudentScheduleCountAdjustment, buildBoardStudentSelectionOptions, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, buildTeacherSelectionOptions, buildTemplateStudentSelectionOptions, clampPopoverPosition, clearStudentStatusFromDesk, cloneWeeks, ensureWeeksCoverDateRange, findDuplicateStudentInCellByKey, normalizeLessonPlacement, packSortCellDesks, prepareStudentForMove, removeLecturePendingItemFromStockState, removeStudentFromDeskLesson } from './ScheduleBoardScreen'
import { buildRegularLessonsFromTemplate, type RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import { buildMakeupStockEntries } from './makeupStock'

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 14,
}

describe('clampPopoverPosition', () => {
  it('clamps popovers above the viewport bottom when the clicked cell is near the footer', () => {
    expect(clampPopoverPosition({
      anchorX: 160,
      anchorY: 730,
      viewportWidth: 1280,
      viewportHeight: 800,
      popoverWidth: 320,
      popoverHeight: 220,
    })).toEqual({
      left: 170,
      top: 568,
    })
  })

  it('keeps popovers near the click point when there is enough room below', () => {
    expect(clampPopoverPosition({
      anchorX: 160,
      anchorY: 120,
      viewportWidth: 1280,
      viewportHeight: 800,
      popoverWidth: 320,
      popoverHeight: 220,
    })).toEqual({
      left: 170,
      top: 130,
    })
  })
})

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

describe('appendDeletedStudentScheduleCountAdjustment', () => {
  it('uses the managed student id override instead of a board-local student id', () => {
    const adjustments = appendDeletedStudentScheduleCountAdjustment([], {
      studentId: 'board-local-s1',
      name: '青木太郎',
      subject: '数',
      lessonType: 'regular',
    }, '2026-03-23', 's001')

    expect(adjustments).toEqual([{
      studentKey: 's001',
      subject: '数',
      countKind: 'regular',
      dateKey: '2026-03-23',
      delta: -1,
    }])
  })
})

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

function createUndefinedRightOnlyCell(): SlotCell {
  return {
    id: '2026-04-08_3',
    dateKey: '2026-04-08',
    dayLabel: '水',
    dateLabel: '4/8',
    slotLabel: '3限',
    slotNumber: 3,
    timeLabel: '16:20-17:50',
    isOpenDay: true,
    desks: [
      {
        id: '2026-04-08_3_desk_1',
        teacher: '右寄せ生徒',
        lesson: {
          id: 'undefined-right',
          studentSlots: [undefined as unknown as StudentEntry | null, createStudentEntry('s-packed', '詰め対象', '数')],
        },
      },
    ],
  }
}

describe('ScheduleBoardScreen buildManagedScheduleCellsForRange', () => {
  it('shows upcoming teachers in both board and template selection regardless of entry date', () => {
    const upcomingTeacher = {
      ...initialTeachers[0]!,
      id: 't-upcoming',
      name: '未来講師',
      displayName: '未来講師',
      entryDate: '2026-05-01',
    }
    const cell: SlotCell = {
      id: '2026-04-21_1',
      dateKey: '2026-04-21',
      dayLabel: '火',
      dateLabel: '4/21',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '13:00-14:30',
      isOpenDay: true,
      desks: [{ id: '2026-04-21_1_desk_1', teacher: '講師未割当' }],
    }

    const boardOptions = buildTeacherSelectionOptions({
      teachers: [upcomingTeacher],
      cell,
      deskIndex: 0,
      isTemplateMode: false,
    })
    const templateOptions = buildTeacherSelectionOptions({
      teachers: [upcomingTeacher],
      cell,
      deskIndex: 0,
      isTemplateMode: true,
      templateReferenceDate: '2026-04-21',
    })

    expect(boardOptions.map((teacher) => teacher.id)).toContain('t-upcoming')
    expect(templateOptions.map((teacher) => teacher.id)).toContain('t-upcoming')
  })

  it('sorts template addable students by current grade and shows the same labels as the board selector', () => {
    const studentBase = initialStudents[0] as StudentRow
    const students: StudentRow[] = [
      {
        ...studentBase,
        id: 'student-high',
        name: '高橋 花子',
        displayName: '高橋',
        birthDate: '2008-04-02',
        withdrawDate: '',
        isHidden: false,
      },
      {
        ...studentBase,
        id: 'student-mid',
        name: '青木 太郎',
        displayName: '青木',
        birthDate: '2012-04-02',
        withdrawDate: '',
        isHidden: false,
      },
      {
        ...studentBase,
        id: 'student-elm',
        name: '伊藤 次郎',
        displayName: '伊藤',
        birthDate: '2015-04-02',
        withdrawDate: '',
        isHidden: false,
      },
      {
        ...studentBase,
        id: 'student-hidden',
        name: '非表示 生徒',
        displayName: '非表示',
        birthDate: '2014-04-02',
        withdrawDate: '',
        isHidden: true,
      },
      {
        ...studentBase,
        id: 'student-withdrawn',
        name: '退塾 生徒',
        displayName: '退塾',
        birthDate: '2013-04-02',
        withdrawDate: '2026-03-31',
        isHidden: false,
      },
    ]

    const options = buildTemplateStudentSelectionOptions(students, '2026-04-01')

    expect(options.map((entry) => entry.id)).toEqual(['student-elm', 'student-mid', 'student-high'])
    expect(options.map((entry) => entry.displayName)).toEqual(['伊藤 (小5)', '青木 (中2)', '高橋 (高3)'])
  })

  it('excludes students already withdrawn in management from board add options', () => {
    const studentBase = initialStudents[0] as StudentRow
    const students: StudentRow[] = [
      {
        ...studentBase,
        id: 'student-active',
        name: '在籍 生徒',
        displayName: '在籍',
        birthDate: '2012-04-02',
        withdrawDate: '',
        isHidden: false,
      },
      {
        ...studentBase,
        id: 'student-withdrawn',
        name: '退塾 生徒',
        displayName: '退塾',
        birthDate: '2013-04-02',
        withdrawDate: '2026-03-31',
        isHidden: false,
      },
    ]

    const options = buildBoardStudentSelectionOptions(students, '2026-03-01', '2026-04-01')

    expect(options.map((entry) => entry.id)).toEqual(['student-active'])
    expect(options.map((entry) => entry.displayName)).toEqual(['在籍 (中1)'])
  })

  it('removes lecture pending items from the correct stock source', () => {
    const sessionItemResult = removeLecturePendingItemFromStockState({
      manualLectureStockCounts: {},
      manualLectureStockOrigins: {},
      item: {
        stockKey: 'student-1__数__session-1',
        source: 'session',
        sessionId: 'session-1',
      },
    })
    const manualItemResult = removeLecturePendingItemFromStockState({
      manualLectureStockCounts: { 'student-1__数__session-1': 2 },
      manualLectureStockOrigins: {
        'student-1__数__session-1': [
          { displayName: '山田', sessionId: 'session-1' },
          { displayName: '山田', sessionId: 'session-1' },
        ],
      },
      item: {
        stockKey: 'student-1__数__session-1',
        source: 'manual',
        sessionId: 'session-1',
      },
    })

    expect(sessionItemResult.nextManualLectureStockCounts).toEqual({
      'student-1__数__session-1': -1,
    })
    expect(sessionItemResult.nextManualLectureStockOrigins).toEqual({})
    expect(manualItemResult.nextManualLectureStockCounts).toEqual({
      'student-1__数__session-1': 1,
    })
    expect(manualItemResult.nextManualLectureStockOrigins).toEqual({
      'student-1__数__session-1': [{ displayName: '山田', sessionId: 'session-1' }],
    })
  })

  it('links an absent regular status to the placed makeup destination date', () => {
    const cells: SlotCell[] = [
      {
        id: '2026-04-01_1',
        dateKey: '2026-04-01',
        dayLabel: '水',
        dateLabel: '4/1',
        slotLabel: '1限',
        slotNumber: 1,
        timeLabel: '13:00-14:30',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-01_1_desk_1',
            teacher: '講師A',
            statusSlots: [
              {
                id: 'status-absent',
                studentId: 'student-1',
                sourceManagedLesson: true,
                name: '青木 太郎',
                managedStudentId: 'student-1',
                grade: '中3',
                subject: '数',
                lessonType: 'regular',
                teacherType: 'normal',
                teacherName: '講師A',
                dateKey: '2026-04-01',
                slotNumber: 1,
                recordedAt: '2026-04-01T00:00:00Z',
                status: 'absent',
                sourceLessonId: 'managed-1',
              },
              null,
            ],
          },
        ],
      },
      {
        id: '2026-04-08_2',
        dateKey: '2026-04-08',
        dayLabel: '水',
        dateLabel: '4/8',
        slotLabel: '2限',
        slotNumber: 2,
        timeLabel: '14:40-16:10',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-08_2_desk_1',
            teacher: '講師A',
            lesson: {
              id: 'makeup-1',
              studentSlots: [
                {
                  id: 'placed-1',
                  name: '青木 太郎',
                  managedStudentId: 'student-1',
                  grade: '中3',
                  subject: '数',
                  lessonType: 'makeup',
                  teacherType: 'normal',
                  makeupSourceDate: '2026-04-01',
                  makeupSourceLabel: '2026/4/1(水) 1限',
                },
                null,
              ],
            },
          },
        ],
      },
    ]

    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({
      dateKey: '2026-04-08',
      slotNumber: 2,
    })
  })

  it('does not link an absent status when the placed lesson has no source relation', () => {
    const cells: SlotCell[] = [
      {
        id: '2026-04-01_1',
        dateKey: '2026-04-01',
        dayLabel: '水',
        dateLabel: '4/1',
        slotLabel: '1限',
        slotNumber: 1,
        timeLabel: '13:00-14:30',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-01_1_desk_1',
            teacher: '講師A',
            statusSlots: [
              {
                id: 'status-unlinked',
                studentId: 'student-1',
                sourceManagedLesson: true,
                name: '青木 太郎',
                managedStudentId: 'student-1',
                grade: '中3',
                subject: '数',
                lessonType: 'regular',
                teacherType: 'normal',
                teacherName: '講師A',
                dateKey: '2026-04-01',
                slotNumber: 1,
                recordedAt: '2026-04-01T00:00:00Z',
                status: 'absent',
                sourceLessonId: 'managed-1',
              },
              null,
            ],
          },
        ],
      },
      {
        id: '2026-04-08_2',
        dateKey: '2026-04-08',
        dayLabel: '水',
        dateLabel: '4/8',
        slotLabel: '2限',
        slotNumber: 2,
        timeLabel: '14:40-16:10',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-08_2_desk_1',
            teacher: '講師A',
            lesson: {
              id: 'manual-special',
              studentSlots: [
                {
                  id: 'placed-manual',
                  name: '青木 太郎',
                  managedStudentId: 'student-1',
                  grade: '中3',
                  subject: '数',
                  lessonType: 'special',
                  teacherType: 'normal',
                },
                null,
              ],
            },
          },
        ],
      },
    ]

    expect(buildLinkedLessonDestinationMap(cells).has('status-unlinked')).toBe(false)
  })

  it('links an absent special status to the placed lecture destination date', () => {
    const cells: SlotCell[] = [
      {
        id: '2026-04-02_3',
        dateKey: '2026-04-02',
        dayLabel: '木',
        dateLabel: '4/2',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-02_3_desk_1',
            teacher: '講師A',
            statusSlots: [
              {
                id: 'status-special',
                studentId: 'student-1',
                sourceManagedLesson: false,
                name: '青木 太郎',
                managedStudentId: 'student-1',
                grade: '中3',
                subject: '数',
                lessonType: 'special',
                teacherType: 'normal',
                teacherName: '講師A',
                dateKey: '2026-04-02',
                slotNumber: 3,
                recordedAt: '2026-04-02T00:00:00Z',
                status: 'absent',
                sourceLessonId: 'special-1',
                specialSessionId: 'session-1',
                specialStockSource: 'session',
              },
              null,
            ],
          },
        ],
      },
      {
        id: '2026-04-09_4',
        dateKey: '2026-04-09',
        dayLabel: '木',
        dateLabel: '4/9',
        slotLabel: '4限',
        slotNumber: 4,
        timeLabel: '18:00-19:30',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-09_4_desk_1',
            teacher: '講師A',
            lesson: {
              id: 'special-placed',
              studentSlots: [
                {
                  id: 'placed-special',
                  name: '青木 太郎',
                  managedStudentId: 'student-1',
                  grade: '中3',
                  subject: '数',
                  lessonType: 'special',
                  teacherType: 'normal',
                  specialSessionId: 'session-1',
                  specialStockSource: 'session',
                  makeupSourceDate: '2026-04-02',
                  makeupSourceLabel: '2026/4/2(木) 3限',
                },
                null,
              ],
            },
          },
        ],
      },
    ]

    expect(buildLinkedLessonDestinationMap(cells).get('status-special')).toEqual({
      dateKey: '2026-04-09',
      slotNumber: 4,
    })
  })

  it('links absent regular and placed makeup even when only one side carries managedStudentId', () => {
    const cells: SlotCell[] = [
      {
        id: '2026-04-29_3',
        dateKey: '2026-04-29',
        dayLabel: '水',
        dateLabel: '4/29',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-29_3_desk_1',
            teacher: '講師A',
            statusSlots: [
              {
                id: 'status-ishige',
                studentId: 'ishige-1',
                sourceManagedLesson: true,
                name: '石毛',
                managedStudentId: 'ishige-1',
                grade: '小5',
                subject: '算',
                lessonType: 'regular',
                teacherType: 'normal',
                teacherName: '講師A',
                dateKey: '2026-04-29',
                slotNumber: 3,
                recordedAt: '2026-04-29T00:00:00Z',
                status: 'absent',
                sourceLessonId: 'managed-ishige-1',
              },
              null,
            ],
          },
        ],
      },
      {
        id: '2026-05-01_5',
        dateKey: '2026-05-01',
        dayLabel: '金',
        dateLabel: '5/1',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:40-21:10',
        isOpenDay: true,
        desks: [
          {
            id: '2026-05-01_5_desk_1',
            teacher: '講師A',
            lesson: {
              id: 'makeup-ishige',
              studentSlots: [
                {
                  id: 'placed-ishige',
                  name: '石毛',
                  grade: '小5',
                  subject: '算',
                  lessonType: 'makeup',
                  teacherType: 'normal',
                  makeupSourceDate: '2026-04-29',
                  makeupSourceLabel: '2026/4/29(水) 3限',
                },
                null,
              ],
            },
          },
        ],
      },
    ]

    expect(buildLinkedLessonDestinationMap(cells).get('status-ishige')).toEqual({
      dateKey: '2026-05-01',
      slotNumber: 5,
    })
  })

  it('links absent regular and placed makeup even when the placed source label has no slot suffix', () => {
    const cells: SlotCell[] = [
      {
        id: '2026-04-29_3',
        dateKey: '2026-04-29',
        dayLabel: '水',
        dateLabel: '4/29',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [
          {
            id: '2026-04-29_3_desk_1',
            teacher: '講師A',
            statusSlots: [
              {
                id: 'status-ishige-no-slot',
                studentId: 'ishige-1',
                sourceManagedLesson: true,
                name: '石毛',
                managedStudentId: 'ishige-1',
                grade: '小5',
                subject: '算',
                lessonType: 'regular',
                teacherType: 'normal',
                teacherName: '講師A',
                dateKey: '2026-04-29',
                slotNumber: 3,
                recordedAt: '2026-04-29T00:00:00Z',
                status: 'absent',
                sourceLessonId: 'managed-ishige-1',
              },
              null,
            ],
          },
        ],
      },
      {
        id: '2026-05-01_3',
        dateKey: '2026-05-01',
        dayLabel: '金',
        dateLabel: '5/1',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [
          {
            id: '2026-05-01_3_desk_1',
            teacher: '講師A',
            lesson: {
              id: 'makeup-ishige-no-slot',
              studentSlots: [
                {
                  id: 'placed-ishige-no-slot',
                  name: '石毛',
                  managedStudentId: 'ishige-1',
                  grade: '小5',
                  subject: '算',
                  lessonType: 'makeup',
                  teacherType: 'normal',
                  makeupSourceDate: '2026-04-29',
                  makeupSourceLabel: '2026/4/29(水)',
                },
                null,
              ],
            },
          },
        ],
      },
    ]

    expect(buildLinkedLessonDestinationMap(cells).get('status-ishige-no-slot')).toEqual({
      dateKey: '2026-05-01',
      slotNumber: 3,
    })
  })

  it('detects a duplicate student elsewhere in the same target cell', () => {
    const targetCell: SlotCell = {
      id: 'template_2_4',
      dateKey: 'template_2',
      dayLabel: '',
      dateLabel: '火',
      slotLabel: '4限',
      slotNumber: 4,
      timeLabel: '',
      isOpenDay: true,
      desks: [
        {
          id: 'template_2_4_1',
          teacher: '講師A',
          lesson: {
            id: 'desk-1',
            studentSlots: [createStudentEntry('source-entry', '移動元', '数'), null],
          },
        },
        {
          id: 'template_2_4_2',
          teacher: '講師B',
          lesson: {
            id: 'desk-2',
            studentSlots: [{ ...createStudentEntry('duplicate-entry', '移動元', '数'), managedStudentId: 'source-entry' }, null],
          },
        },
      ],
    }

    const duplicate = findDuplicateStudentInCellByKey(
      targetCell,
      'source-entry',
      (student) => student.managedStudentId ?? student.name,
      'source-entry',
    )

    expect(duplicate?.id).toBe('duplicate-entry')
  })

  it('ignores the moving student itself when no other duplicate exists in the target cell', () => {
    const targetCell: SlotCell = {
      id: 'template_2_4',
      dateKey: 'template_2',
      dayLabel: '',
      dateLabel: '火',
      slotLabel: '4限',
      slotNumber: 4,
      timeLabel: '',
      isOpenDay: true,
      desks: [
        {
          id: 'template_2_4_1',
          teacher: '講師A',
          lesson: {
            id: 'desk-1',
            studentSlots: [createStudentEntry('source-entry', '移動元', '数'), null],
          },
        },
        {
          id: 'template_2_4_2',
          teacher: '講師B',
          lesson: {
            id: 'desk-2',
            studentSlots: [createStudentEntry('other-entry', '別生徒', '英'), null],
          },
        },
      ],
    }

    const duplicate = findDuplicateStudentInCellByKey(
      targetCell,
      'source-entry',
      (student) => student.managedStudentId ?? student.name,
      'source-entry',
    )

    expect(duplicate).toBeNull()
  })

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

  it('keeps same-day regular moves regular without visible source labels', () => {
    const moved = prepareStudentForMove({
      id: 'same-day-regular',
      name: '青木太郎',
      managedStudentId: 's001',
      grade: '中3',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
    }, '2026-04-07', 1, '2026-04-07')

    expect(moved.lessonType).toBe('regular')
    expect(moved.makeupSourceDate).toBeUndefined()
    expect(moved.makeupSourceLabel).toBeUndefined()
    expect(moved.sameDayMoveSourceDate).toBe('2026-04-07')
  })

  it('keeps extra lessons as extra when moved on the same day', () => {
    const moved = prepareStudentForMove({
      id: 'same-day-extra',
      name: '青木太郎',
      managedStudentId: 's001',
      grade: '中3',
      subject: '数',
      lessonType: 'extra',
      teacherType: 'normal',
      noteSuffix: '45',
    }, '2026-04-07', 1, '2026-04-07')

    expect(moved.lessonType).toBe('extra')
    expect(moved.noteSuffix).toBe('45')
    expect(moved.makeupSourceDate).toBeUndefined()
  })

  it('clears a moved-origin marker without restoring a duplicate student', () => {
    const statusEntry: StudentStatusEntry = {
      id: 'status_moved_1',
      studentId: 'student-moved',
      sourceManagedLesson: true,
      managedStudentId: 'student-moved',
      name: '移動済み生徒',
      grade: '中3',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
      teacherName: '講師A',
      dateKey: '2026-04-07',
      slotNumber: 2,
      recordedAt: '2026-04-07T10:00:00',
      status: 'moved',
      sourceLessonId: 'lesson-source',
      moveDestinationDateKey: '2026-04-08',
      moveDestinationSlotNumber: 3,
    }
    const desk: DeskCell = {
      id: 'desk-moved',
      teacher: '講師A',
      statusSlots: [statusEntry, null],
    }

    const restoredStudent = clearStudentStatusFromDesk(desk, 0, statusEntry)

    expect(restoredStudent).toBeNull()
    expect(desk.statusSlots).toBeUndefined()
    expect(desk.lesson).toBeUndefined()
  })

  it('packs desk rows within the same slot as two students, one student, teacher only, then empty', () => {
    const packedDesks = packSortCellDesks(createPackTestCell())

    expect(packedDesks.map((desk) => desk.teacher)).toEqual(['二人生徒', '一人生徒', '右だけ生徒', '講師だけ', '', ''])
    expect(packedDesks[2]?.lesson?.studentSlots[0]?.name).toBe('右生徒')
    expect(packedDesks[2]?.lesson?.studentSlots[1]).toBeNull()
  })

  it('packs a right-only student into student1 even when slot1 is undefined', () => {
    const packedDesks = packSortCellDesks(createUndefinedRightOnlyCell())

    expect(packedDesks[0]?.lesson?.studentSlots[0]?.name).toBe('詰め対象')
    expect(packedDesks[0]?.lesson?.studentSlots[1]).toBeNull()
  })

  it('packs student from slot2 to slot1 when slot1 has a ghost empty entry', () => {
    const ghostCell: SlotCell = {
      id: '2026-04-09_2',
      dateKey: '2026-04-09',
      dayLabel: '木',
      dateLabel: '4/9',
      slotLabel: '2限',
      slotNumber: 2,
      timeLabel: '14:40-16:10',
      isOpenDay: true,
      desks: [
        {
          id: '2026-04-09_2_desk_1',
          teacher: 'ゴースト先生',
          lesson: {
            id: 'ghost-slot',
            studentSlots: [
              { id: '', name: '', managedStudentId: '', grade: '', subject: '', lessonType: 'regular', teacherType: 'normal' } as unknown as StudentEntry,
              createStudentEntry('s-real', '実生徒', '英'),
            ],
          },
        },
      ],
    }
    const packedDesks = packSortCellDesks(ghostCell)

    expect(packedDesks[0]?.lesson?.studentSlots[0]?.name).toBe('実生徒')
    expect(packedDesks[0]?.lesson?.studentSlots[1]).toBeNull()
  })

  it('keeps a right-only student in slot2 when slot1 has a recorded status', () => {
    const statusEntry: StudentStatusEntry = {
      id: 'status_attended_1',
      studentId: 's-status',
      sourceManagedLesson: true,
      name: '出席済み生徒',
      managedStudentId: 's-status',
      grade: '中3',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
      teacherName: '講師A',
      dateKey: '2026-04-09',
      slotNumber: 2,
      recordedAt: '2026-04-09T10:00:00',
      status: 'attended',
      sourceLessonId: 'lesson_status_1',
    }
    const cell: SlotCell = {
      id: '2026-04-09_2',
      dateKey: '2026-04-09',
      dayLabel: '木',
      dateLabel: '4/9',
      slotLabel: '2限',
      slotNumber: 2,
      timeLabel: '14:40-16:10',
      isOpenDay: true,
      desks: [
        {
          id: '2026-04-09_2_desk_1',
          teacher: '講師A',
          statusSlots: [statusEntry, null],
          lesson: {
            id: 'right-only-with-status',
            studentSlots: [null, createStudentEntry('s-real', '右側生徒', '英')],
          },
        },
      ],
    }

    const packedDesks = packSortCellDesks(cell, { skipStatusSlotPack: true })

    expect(packedDesks[0]?.lesson?.studentSlots[0]).toBeNull()
    expect(packedDesks[0]?.lesson?.studentSlots[1]?.name).toBe('右側生徒')
    expect(packedDesks[0]?.statusSlots?.[0]?.status).toBe('attended')
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

  it('places the regular student on all five weekly slots when a month has five occurrences', () => {
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
    expect(teacherDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s001')

    const firstMondayCell = cells.find((cell) => cell.dateKey === '2026-03-02' && cell.slotNumber === 1)
    const firstMondayDesk = firstMondayCell?.desks.find((desk) => desk.teacher === '田中講師')
    expect(firstMondayDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s001')
  })

  it('builds schedule cells for a future unopened week by generating covered board weeks', () => {
    const regularLesson = {
      id: 'future-unopened-regular',
      schoolYear: 2026,
      teacherId: 't001',
      student1Id: 's001',
      subject1: '数' as const,
      startDate: '',
      endDate: '',
      student2Id: '',
      subject2: '' as const,
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '' as const,
      nextStudent2Id: '',
      nextSubject2: '' as const,
      dayOfWeek: 1,
      slotNumber: 1,
    }
    const currentOnlyWeek = buildManagedScheduleCellsForRange({
      range: {
        startDate: '2026-05-11',
        endDate: '2026-05-17',
        periodValue: '',
      },
      fallbackStartDate: '2026-05-11',
      fallbackEndDate: '2026-05-17',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [regularLesson],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const coveredWeeks = ensureWeeksCoverDateRange({
      weeks: [currentOnlyWeek],
      startDate: '2026-07-13',
      endDate: '2026-07-19',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [regularLesson],
    }).weeks

    const cells = buildScheduleCellsForRange({
      range: {
        startDate: '2026-07-13',
        endDate: '2026-07-19',
        periodValue: '',
      },
      fallbackStartDate: '2026-07-13',
      fallbackEndDate: '2026-07-19',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [regularLesson],
      boardWeeks: coveredWeeks,
      suppressedRegularLessonOccurrences: [],
    })

    const targetCell = cells.find((cell) => cell.dateKey === '2026-07-13' && cell.slotNumber === 1)
    expect(targetCell?.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001'))).toBe(true)
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

  it('propagates regular lesson lesson-minutes into managed board student entries', () => {
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
        student1Note: '45',
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

    expect(student?.noteSuffix).toBe('45')
  })

  it('places the student on all available Tuesdays including the fifth week when a holiday shortens the month', () => {
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

    // Holiday on 3/10 skipped; student placed on all other Tuesdays including 3/31
    expect(placedDateKeys).toEqual(['2026-03-03', '2026-03-17', '2026-03-24', '2026-03-31'])
  })

  it('drops saved managed regular lessons from actual schedule cells after the date becomes a holiday', () => {
    const range = {
      startDate: '2026-03-09',
      endDate: '2026-03-15',
      periodValue: '',
    }
    const regularLessons = [{
      id: 'holiday-regular',
      schoolYear: 2025,
      teacherId: 't001',
      student1Id: 's001',
      subject1: '数' as const,
      startDate: '',
      endDate: '',
      student2Id: '',
      subject2: '' as const,
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '' as const,
      nextStudent2Id: '',
      nextSubject2: '' as const,
      dayOfWeek: 2,
      slotNumber: 1,
    }]
    const savedBoardWeek = buildManagedScheduleCellsForRange({
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
    const holidaySettings: ClassroomSettings = {
      ...classroomSettings,
      holidayDates: ['2026-03-10'],
    }

    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: holidaySettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [savedBoardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const holidayCell = cells.find((cell) => cell.dateKey === '2026-03-10' && cell.slotNumber === 1)
    const holidayStudents = holidayCell?.desks.flatMap((desk) => desk.lesson?.studentSlots.filter((student) => student !== null) ?? []) ?? []

    expect(holidayCell?.isOpenDay).toBe(false)
    expect(holidayStudents.some((student) => student.managedStudentId === 's001')).toBe(false)
  })

  it('places the regular student on the fifth weekly slot after board-week overlay merges managed cells', () => {
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
    expect(teacherDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('s001')
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

  it('preserves a makeup student in a desk whose managed lesson is fully suppressed', () => {
    // Board has managed lesson with [regular-s001, makeup-s002]
    // Suppress regular-s001 → managed lesson becomes [null, null] → removed from managed
    // The makeup placement of s002 should survive the merge
    const regularLesson = {
      id: 'suppress-test',
      schoolYear: 2025,
      teacherId: 't001',
      student1Id: 's001',
      subject1: '数' as const,
      startDate: '',
      endDate: '',
      student2Id: '',
      subject2: '' as const,
      student2StartDate: '',
      student2EndDate: '',
      nextStudent1Id: '',
      nextSubject1: '' as const,
      nextStudent2Id: '',
      nextSubject2: '' as const,
      dayOfWeek: 1,
      slotNumber: 1,
    }

    // Build board week with managed data (has s001 as regular)
    const boardWeek = buildManagedScheduleCellsForRange({
      range: { startDate: '2026-03-23', endDate: '2026-03-29', periodValue: '' },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [regularLesson],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    // Add a makeup student to the same desk at slot[1]
    const targetCell = boardWeek.find((cell) => cell.dateKey === '2026-03-23' && cell.slotNumber === 1)!
    const targetDesk = targetCell.desks.find((desk) => desk.lesson?.studentSlots[0]?.managedStudentId === 's001')!
    targetDesk.lesson!.studentSlots[1] = {
      id: 's002_makeup',
      name: '中村花子',
      managedStudentId: 's002',
      grade: '中3',
      subject: '英',
      lessonType: 'makeup',
      makeupSourceDate: '2026-03-20',
      makeupSourceLabel: '2026/3/20(金) 1限',
      teacherType: 'normal',
    }

    // Now suppress s001 and overlay
    const suppressKey = `s001__数__2026-03-23__1`
    const cells = buildScheduleCellsForRange({
      range: { startDate: '2026-03-23', endDate: '2026-03-29', periodValue: '' },
      fallbackStartDate: '2026-03-23',
      fallbackEndDate: '2026-03-29',
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [regularLesson],
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [suppressKey],
    })

    const resultCell = cells.find((cell) => cell.dateKey === '2026-03-23' && cell.slotNumber === 1)!
    const resultDesk = resultCell.desks.find((desk) =>
      desk.lesson?.studentSlots.some((s) => s?.managedStudentId === 's002'),
    )

    // The makeup student should survive even though the managed lesson was fully suppressed
    expect(resultDesk).toBeDefined()
    expect(resultDesk?.lesson?.studentSlots.some((s) => s?.lessonType === 'makeup' && s?.managedStudentId === 's002')).toBe(true)
    // The suppressed regular student should NOT be present
    expect(resultDesk?.lesson?.studentSlots.some((s) => s?.managedStudentId === 's001')).toBe(false)
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
  it('ボードセルIDが古い形式でも日付と時限で実績授業を日程表へ反映する', () => {
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

    const targetCell = boardWeek.find((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots[0]))
    const targetDesk = targetCell?.desks.find((desk) => desk.lesson?.studentSlots[0])
    const targetStudent = targetDesk?.lesson?.studentSlots[0]
    expect(targetCell).toBeDefined()
    expect(targetDesk).toBeDefined()
    expect(targetStudent).toBeDefined()

    targetCell!.id = `legacy_${targetCell!.dateKey}_${targetCell!.slotNumber}`
    targetDesk!.lesson = {
      ...targetDesk!.lesson!,
      id: `legacy_${targetDesk!.lesson!.id}`,
      studentSlots: [{ ...targetStudent!, lessonType: 'makeup', makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' }, null],
    }

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

    const mergedCell = merged.find((cell) => cell.dateKey === targetCell!.dateKey && cell.slotNumber === targetCell!.slotNumber)
    const mergedStudents = mergedCell?.desks.flatMap((desk) => desk.lesson?.studentSlots.filter((student) => student !== null) ?? []) ?? []
    expect(merged.filter((cell) => cell.dateKey === targetCell!.dateKey && cell.slotNumber === targetCell!.slotNumber)).toHaveLength(1)
    expect(mergedStudents.some((student) => student.name === targetStudent!.name && student.lessonType === 'makeup')).toBe(true)
  })

  it('ボードセルIDが古い形式でも手動追加した通常授業を予定日程へ反映する', () => {
    const range = {
      startDate: '2026-04-06',
      endDate: '2026-04-12',
      periodValue: '',
    }
    const boardWeek = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [],
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const targetCell = boardWeek[0]
    const targetDesk = targetCell.desks[0]
    targetCell.id = `legacy_${targetCell.dateKey}_${targetCell.slotNumber}`
    targetDesk.teacher = initialTeachers[0].name
    targetDesk.lesson = {
      id: 'manual_regular_legacy_id',
      studentSlots: [{
        id: 'manual_student_entry',
        name: initialStudents[0].name,
        managedStudentId: initialStudents[0].id,
        grade: '中1',
        subject: '英',
        lessonType: 'regular',
        teacherType: 'normal',
        manualAdded: true,
      }, null],
    }

    const planned = buildManagedScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: [],
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [],
    })

    const plannedCell = planned.find((cell) => cell.dateKey === targetCell.dateKey && cell.slotNumber === targetCell.slotNumber)
    const plannedStudents = plannedCell?.desks.flatMap((desk) => desk.lesson?.studentSlots.filter((student) => student !== null) ?? []) ?? []
    expect(plannedStudents.some((student) => student.managedStudentId === initialStudents[0].id && student.manualAdded)).toBe(true)
  })

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

  it('statusSlots[0] がある右側生徒を merge 後も左詰めしない', () => {
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

    const targetCell = boardWeek.find((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots[0]))
    const targetDesk = targetCell?.desks.find((desk) => desk.lesson?.studentSlots[0])
    const originalStudent = targetDesk?.lesson?.studentSlots[0]

    expect(targetCell).toBeDefined()
    expect(targetDesk).toBeDefined()
    expect(originalStudent).toBeDefined()

    const statusEntry: StudentStatusEntry = {
      id: 'status_merge_1',
      studentId: originalStudent!.id,
      sourceManagedLesson: true,
      name: originalStudent!.name,
      managedStudentId: originalStudent!.managedStudentId,
      grade: originalStudent!.grade,
      subject: originalStudent!.subject,
      lessonType: originalStudent!.lessonType,
      teacherType: originalStudent!.teacherType,
      teacherName: targetDesk!.teacher,
      dateKey: targetCell!.dateKey,
      slotNumber: targetCell!.slotNumber,
      recordedAt: '2026-04-07T10:00:00',
      status: 'absent-no-makeup',
      sourceLessonId: targetDesk!.lesson!.id,
    }

    targetDesk!.statusSlots = [statusEntry, null]
    targetDesk!.lesson = {
      ...targetDesk!.lesson!,
      id: `manual_${targetDesk!.lesson!.id}`,
      studentSlots: [
        null,
        {
          ...originalStudent!,
          lessonType: 'makeup',
          makeupSourceDate: '2026-04-01',
          makeupSourceLabel: '2026/4/1(水) 1限',
        },
      ],
    }

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

    const mergedCell = merged.find((cell) => cell.id === targetCell!.id)
    const mergedDesk = mergedCell?.desks.find((desk) => desk.id === targetDesk!.id)

    expect(mergedDesk?.statusSlots?.[0]?.status).toBe('absent-no-makeup')
    expect(mergedDesk?.lesson?.studentSlots[0]).toBeNull()
    expect(mergedDesk?.lesson?.studentSlots[1]?.name).toBe(originalStudent!.name)
    expect(mergedDesk?.lesson?.studentSlots[1]?.lessonType).toBe('makeup')
  })

  it('通常授業を休みにしても schedule cells に status-only desk を保持する', () => {
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

    const targetCell = boardWeek.find((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots[0]))
    const targetDesk = targetCell?.desks.find((desk) => desk.lesson?.studentSlots[0])
    const originalStudent = targetDesk?.lesson?.studentSlots[0]

    expect(targetCell).toBeDefined()
    expect(targetDesk).toBeDefined()
    expect(originalStudent).toBeDefined()

    const absentStatusEntry: StudentStatusEntry = {
      id: 'status_absent_popup_1',
      studentId: originalStudent!.id,
      sourceManagedLesson: true,
      name: originalStudent!.name,
      managedStudentId: originalStudent!.managedStudentId,
      grade: originalStudent!.grade,
      subject: originalStudent!.subject,
      lessonType: originalStudent!.lessonType,
      teacherType: originalStudent!.teacherType,
      teacherName: targetDesk!.teacher,
      dateKey: targetCell!.dateKey,
      slotNumber: targetCell!.slotNumber,
      recordedAt: '2026-04-07T10:00:00',
      status: 'absent',
      sourceLessonId: targetDesk!.lesson!.id,
    }

    removeStudentFromDeskLesson(targetDesk!, 0)
    targetDesk!.statusSlots = [absentStatusEntry, null]

    const suppressedKey = `${originalStudent!.managedStudentId ?? originalStudent!.name}__${originalStudent!.subject}__${targetCell!.dateKey}__${targetCell!.slotNumber}`
    const merged = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [suppressedKey],
    })

    const mergedCell = merged.find((cell) => cell.id === targetCell!.id)
    const mergedDesk = mergedCell?.desks.find((desk) => desk.statusSlots?.[0]?.studentId === originalStudent!.id)

    expect(mergedDesk?.teacher).toBe(targetDesk!.teacher)
    expect(mergedDesk?.lesson).toBeUndefined()
    expect(mergedDesk?.statusSlots?.[0]?.status).toBe('absent')
    expect(mergedDesk?.statusSlots?.[0]?.teacherName).toBe(targetDesk!.teacher)
  })

  it('通常授業をストックへ回した source cell を schedule cells で再表示しない', () => {
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

    const targetCell = boardWeek.find((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots[0]))
    const targetDesk = targetCell?.desks.find((desk) => desk.lesson?.studentSlots[0])
    const originalStudent = targetDesk?.lesson?.studentSlots[0]

    expect(targetCell).toBeDefined()
    expect(targetDesk).toBeDefined()
    expect(originalStudent).toBeDefined()

    removeStudentFromDeskLesson(targetDesk!, 0)

    const suppressedKey = `${originalStudent!.managedStudentId ?? originalStudent!.name}__${originalStudent!.subject}__${targetCell!.dateKey}__${targetCell!.slotNumber}`
    const merged = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [suppressedKey],
    })

    const mergedCell = merged.find((cell) => cell.id === targetCell!.id)
    const mergedStudents = mergedCell?.desks.flatMap((desk) => desk.lesson?.studentSlots.filter(Boolean) ?? []) ?? []

    expect(mergedStudents.some((student) => student!.id === originalStudent!.id || student!.managedStudentId === originalStudent!.managedStudentId)).toBe(false)
  })

  it('1人デスクで出席ステータス設定後も merge で講師名を保持する', () => {
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

    // 生徒が1人だけ入っているデスクを探す
    const targetCell = boardWeek.find((cell) => cell.desks.some((desk) =>
      desk.lesson?.studentSlots[0] && !desk.lesson?.studentSlots[1] && desk.teacher,
    ))
    const targetDesk = targetCell?.desks.find((desk) =>
      desk.lesson?.studentSlots[0] && !desk.lesson?.studentSlots[1] && desk.teacher,
    )
    if (!targetCell || !targetDesk || !targetDesk.lesson) {
      // テストデータに1人デスクがなければスキップ
      return
    }

    const originalStudent = targetDesk.lesson.studentSlots[0]!
    const originalTeacher = targetDesk.teacher

    // 出席ステータスを設定し、lesson をクリア（実際のハンドラと同じ操作）
    const statusEntry: StudentStatusEntry = {
      id: 'status_teacher_preserve_1',
      studentId: originalStudent.id,
      sourceManagedLesson: true,
      name: originalStudent.name,
      managedStudentId: originalStudent.managedStudentId,
      grade: originalStudent.grade,
      subject: originalStudent.subject,
      lessonType: originalStudent.lessonType,
      teacherType: originalStudent.teacherType,
      teacherName: targetDesk.teacher,
      dateKey: targetCell.dateKey,
      slotNumber: targetCell.slotNumber,
      recordedAt: '2026-04-07T10:00:00',
      status: 'attended',
      sourceLessonId: targetDesk.lesson.id,
    }

    removeStudentFromDeskLesson(targetDesk, 0)
    targetDesk.statusSlots = [statusEntry, null]

    // suppressedRegularLessonOccurrences にこの生徒を追加
    const suppressedKey = `${originalStudent.managedStudentId ?? originalStudent.name}__${originalStudent.subject}__${targetCell.dateKey}__${targetCell.slotNumber}`

    const merged = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings,
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons,
      boardWeeks: [boardWeek],
      suppressedRegularLessonOccurrences: [suppressedKey],
    })

    const mergedCell = merged.find((cell) => cell.id === targetCell.id)
    const mergedDesk = mergedCell?.desks.find((desk) => desk.statusSlots?.[0]?.studentId === originalStudent.id)

    expect(mergedDesk).toBeDefined()
    expect(mergedDesk?.teacher).toBe(originalTeacher)
    expect(mergedDesk?.statusSlots?.[0]?.status).toBe('attended')
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

// ──────────────────────────────────────────────────────
// テンプレ移動 → 上書き反映後のコマ表・振替ストック再現テスト
// ──────────────────────────────────────────────────────
describe('テンプレ移動 → 上書き反映 regression', () => {
  // s001: 月曜1限 → 火曜2限へテンプレ移動したシナリオ
  const template: RegularLessonTemplate = {
    version: 1,
    effectiveStartDate: '2026-04-01',
    savedAt: new Date().toISOString(),
    cells: [
      // 月曜1限: 生徒なし（移動済のため空）、講師のみ
      { dayOfWeek: 1, slotNumber: 1, desks: [{ deskIndex: 1, teacherId: 't001', students: [null, null] }] },
      // 火曜2限: 移動先 – t002 + s001
      { dayOfWeek: 2, slotNumber: 2, desks: [{ deskIndex: 1, teacherId: 't002', students: [{ studentId: 's001', subject: '数' }, null] }] },
    ],
  }

  const templateRegularLessons = buildRegularLessonsFromTemplate({
    template,
    teachers: initialTeachers,
    students: initialStudents,
  })

  const range = { startDate: '2026-04-06', endDate: '2026-04-12', periodValue: '' }

  it('テンプレ移動後の生徒がコマ表に表示される', () => {
    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: templateRegularLessons,
      boardWeeks: [], // 上書き反映後は空ボード
      suppressedRegularLessonOccurrences: [],
    })

    // 火曜(2026-04-07)2限に s001 が存在するか
    const tuesdaySlot2 = cells.find((cell) => cell.dateKey === '2026-04-07' && cell.slotNumber === 2)
    expect(tuesdaySlot2).toBeDefined()
    const placed = tuesdaySlot2!.desks.some((desk) =>
      desk.lesson?.studentSlots.some((s) => s?.managedStudentId === 's001'),
    )
    expect(placed).toBe(true)
  })

  it('テンプレ移動後の生徒が空きコマ不足にならない', () => {
    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: templateRegularLessons,
      boardWeeks: [], // 上書き反映後は空ボード
      suppressedRegularLessonOccurrences: [],
    })

    const stockEntries = buildMakeupStockEntries({
      students: initialStudents,
      teachers: initialTeachers,
      regularLessons: templateRegularLessons,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      weeks: [cells],
      manualAdjustments: {},
      resolveStudentKey: (student) => student.managedStudentId ?? student.name,
    })

    const s001Stock = stockEntries.filter((entry) => entry.studentId === 's001')
    const totalBalance = s001Stock.reduce((sum, e) => sum + e.balance, 0)
    expect(totalBalance).toBe(0)
  })

  it('移動先スロットに既存デスクが複数ある場合でも正常に配置される', () => {
    // 火曜2限に3机あり、2机埋まっている状態で3机目に移動した生徒が配置されるか
    const filledTemplate: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2026-04-01',
      savedAt: new Date().toISOString(),
      cells: [
        // 月曜1限: 空き（移動元）
        { dayOfWeek: 1, slotNumber: 1, desks: [{ deskIndex: 1, teacherId: 't001', students: [null, null] }] },
        // 火曜2限: 3机あり、1机目と2机目は既存生徒、3机目に移動生徒
        {
          dayOfWeek: 2, slotNumber: 2, desks: [
            { deskIndex: 1, teacherId: 't002', students: [{ studentId: 's002', subject: '英' }, { studentId: 's003', subject: '英' }] },
            { deskIndex: 2, teacherId: 't003', students: [{ studentId: 's004', subject: '数' }, null] },
            { deskIndex: 3, teacherId: 't004', students: [{ studentId: 's001', subject: '数' }, null] },
          ],
        },
      ],
    }

    const filledLessons = buildRegularLessonsFromTemplate({
      template: filledTemplate,
      teachers: initialTeachers,
      students: initialStudents,
    })

    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: filledLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const tuesdaySlot2 = cells.find((cell) => cell.dateKey === '2026-04-07' && cell.slotNumber === 2)
    expect(tuesdaySlot2).toBeDefined()

    // s001, s002, s003, s004 の4人全員配置されている
    const placedStudentIds = tuesdaySlot2!.desks
      .flatMap((desk) => desk.lesson?.studentSlots ?? [])
      .filter(Boolean)
      .map((s) => s!.managedStudentId)
    expect(placedStudentIds).toContain('s001')
    expect(placedStudentIds).toContain('s002')
    expect(placedStudentIds).toContain('s003')
    expect(placedStudentIds).toContain('s004')
  })

  it('同一講師が同一スロットの複数デスクを担当するテンプレ移動', () => {
    // 同じ講師が2机を担当する場合（小規模教室でよくある）
    const sameTeacherTemplate: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2026-04-01',
      savedAt: new Date().toISOString(),
      cells: [
        { dayOfWeek: 1, slotNumber: 1, desks: [{ deskIndex: 1, teacherId: 't001', students: [null, null] }] },
        {
          dayOfWeek: 2, slotNumber: 2, desks: [
            { deskIndex: 1, teacherId: 't001', students: [{ studentId: 's002', subject: '英' }, null] },
            { deskIndex: 2, teacherId: 't001', students: [{ studentId: 's001', subject: '数' }, null] },
          ],
        },
      ],
    }

    const sameTeacherLessons = buildRegularLessonsFromTemplate({
      template: sameTeacherTemplate,
      teachers: initialTeachers,
      students: initialStudents,
    })

    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: sameTeacherLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const tuesdaySlot2 = cells.find((cell) => cell.dateKey === '2026-04-07' && cell.slotNumber === 2)
    expect(tuesdaySlot2).toBeDefined()

    // 同一講師でも両方の生徒が配置されるべき
    const placedStudentIds = tuesdaySlot2!.desks
      .flatMap((desk) => desk.lesson?.studentSlots ?? [])
      .filter(Boolean)
      .map((s) => s!.managedStudentId)
    expect(placedStudentIds).toContain('s001')
    expect(placedStudentIds).toContain('s002')
  })

  it('同一講師複数デスクで空きコマ不足ストックが発生しない', () => {
    const sameTeacherTemplate: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2026-04-01',
      savedAt: new Date().toISOString(),
      cells: [
        {
          dayOfWeek: 2, slotNumber: 2, desks: [
            { deskIndex: 1, teacherId: 't001', students: [{ studentId: 's002', subject: '英' }, null] },
            { deskIndex: 2, teacherId: 't001', students: [{ studentId: 's001', subject: '数' }, null] },
          ],
        },
      ],
    }

    const sameTeacherLessons = buildRegularLessonsFromTemplate({
      template: sameTeacherTemplate,
      teachers: initialTeachers,
      students: initialStudents,
    })

    const cells = buildScheduleCellsForRange({
      range,
      fallbackStartDate: range.startDate,
      fallbackEndDate: range.endDate,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: sameTeacherLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const stockEntries = buildMakeupStockEntries({
      students: initialStudents,
      teachers: initialTeachers,
      regularLessons: sameTeacherLessons,
      classroomSettings: { ...classroomSettings, deskCount: 3 },
      weeks: [cells],
      manualAdjustments: {},
      resolveStudentKey: (student) => student.managedStudentId ?? student.name,
    })

    const s001Stock = stockEntries.filter((e) => e.studentId === 's001')
    const s002Stock = stockEntries.filter((e) => e.studentId === 's002')
    expect(s001Stock.reduce((sum, e) => sum + e.balance, 0)).toBe(0)
    expect(s002Stock.reduce((sum, e) => sum + e.balance, 0)).toBe(0)
  })

  it('テンプレ移動先セルの別行に同生徒がいる場合は重複として検出される', () => {
    const targetCell: SlotCell = {
      id: 'template_2_4',
      dateKey: 'template_2',
      dayLabel: '',
      dateLabel: '火',
      slotLabel: '4限',
      slotNumber: 4,
      timeLabel: '',
      isOpenDay: true,
      desks: [
        {
          id: 'template_2_4_1',
          teacher: '大澤講師',
          lesson: {
            id: 'desk-oosawa',
            studentSlots: [createStudentEntry('existing-entry', '既存生徒', '英'), null],
          },
        },
        {
          id: 'template_2_4_2',
          teacher: '別講師',
          lesson: {
            id: 'desk-other',
            studentSlots: [{ ...createStudentEntry('duplicate-entry', '既存生徒', '数'), managedStudentId: 'existing-entry' }, null],
          },
        },
      ],
    }

    const duplicate = findDuplicateStudentInCellByKey(
      targetCell,
      'existing-entry',
      (student) => student.managedStudentId ?? student.name,
      'moving-entry',
    )

    expect(duplicate?.managedStudentId).toBe('existing-entry')
  })

  it('テンプレ由来の regularLessons はデスク順序を維持し、講師名ソートで並び替えない', () => {
    // 講師名の辞書順: 佐藤(さ) < 鈴木(す) < 高橋(た) だが、テンプレでは 鈴木→高橋→佐藤 の順
    const orderTemplate: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2026-04-01',
      savedAt: new Date().toISOString(),
      cells: [
        {
          dayOfWeek: 2, slotNumber: 3, desks: [
            { deskIndex: 1, teacherId: 't003', students: [{ studentId: 's001', subject: '数' }, null] },
            { deskIndex: 2, teacherId: 't004', students: [{ studentId: 's002', subject: '英' }, { studentId: 's003', subject: '英' }] },
            { deskIndex: 3, teacherId: 't002', students: [{ studentId: 's004', subject: '数' }, null] },
          ],
        },
      ],
    }

    const lessons = buildRegularLessonsFromTemplate({
      template: orderTemplate,
      teachers: initialTeachers,
      students: initialStudents,
    })

    // 火曜3限の行だけ抽出
    const slot3Lessons = lessons.filter((r) => r.dayOfWeek === 2 && r.slotNumber === 3 && r.schoolYear === 2026)
    expect(slot3Lessons).toHaveLength(3)

    // テンプレの deskIndex 順 (t003→t004→t002) が保持されること
    expect(slot3Lessons[0].teacherId).toBe('t003')
    expect(slot3Lessons[1].teacherId).toBe('t004')
    expect(slot3Lessons[2].teacherId).toBe('t002')

    // buildScheduleCellsForRange でもデスク順が維持されること
    const cells = buildScheduleCellsForRange({
      range: { startDate: '2026-04-06', endDate: '2026-04-12', periodValue: '' },
      fallbackStartDate: '2026-04-06',
      fallbackEndDate: '2026-04-12',
      classroomSettings: { ...classroomSettings, deskCount: 5 },
      teachers: initialTeachers,
      students: initialStudents,
      regularLessons: lessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })

    const tuesdaySlot3 = cells.find((c) => c.dateKey === '2026-04-07' && c.slotNumber === 3)
    expect(tuesdaySlot3).toBeDefined()

    // デスクの講師順がテンプレ通りであること
    const teacherDesks = tuesdaySlot3!.desks.filter((d) => d.teacher.trim())
    expect(teacherDesks).toHaveLength(3)
    expect(teacherDesks[0].teacher).toBe('鈴木講師')   // t003
    expect(teacherDesks[1].teacher).toBe('高橋講師')   // t004
    expect(teacherDesks[2].teacher).toBe('佐藤講師')   // t002
  })
})

describe('buildTeacherSelectionOptions', () => {
  it('通常コマ表では同じコマの他机にいる講師も候補に残す', () => {
    const cell: SlotCell = {
      id: '2026-04-07_2',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '2限',
      slotNumber: 2,
      timeLabel: '14:40-16:10',
      isOpenDay: true,
      desks: [
        { id: 'desk-1', teacher: '' },
        { id: 'desk-2', teacher: '田中講師' },
        { id: 'desk-3', teacher: '佐藤講師' },
      ],
    }

    const options = buildTeacherSelectionOptions({
      teachers: initialTeachers,
      cell,
      deskIndex: 0,
      isTemplateMode: false,
    })

    expect(options.map((option) => option.name)).toContain('田中講師')
    expect(options.map((option) => option.name)).toContain('佐藤講師')
    expect(options.map((option) => option.name)).toContain('鈴木講師')
  })

  it('通常コマ表では現在の机に設定済みの講師も候補に残す', () => {
    const cell: SlotCell = {
      id: '2026-04-07_2',
      dateKey: '2026-04-07',
      dayLabel: '火',
      dateLabel: '4/7',
      slotLabel: '2限',
      slotNumber: 2,
      timeLabel: '14:40-16:10',
      isOpenDay: true,
      desks: [
        { id: 'desk-1', teacher: '田中講師' },
        { id: 'desk-2', teacher: '佐藤講師' },
      ],
    }

    const options = buildTeacherSelectionOptions({
      teachers: initialTeachers,
      cell,
      deskIndex: 0,
      isTemplateMode: false,
    })

    expect(options.map((option) => option.name)).toContain('田中講師')
    expect(options.map((option) => option.name)).toContain('佐藤講師')
  })

  it('テンプレモードでも同じコマの他机にいる講師を候補に残す', () => {
    const cell: SlotCell = {
      id: 'template_1_2',
      dateKey: 'template_1',
      dayLabel: '月',
      dateLabel: '月',
      slotLabel: '2限',
      slotNumber: 2,
      timeLabel: '14:40-16:10',
      isOpenDay: true,
      desks: [
        { id: 'desk-1', teacher: '' },
        { id: 'desk-2', teacher: '田中講師' },
      ],
    }

    const options = buildTeacherSelectionOptions({
      teachers: initialTeachers,
      cell,
      deskIndex: 0,
      isTemplateMode: true,
      templateReferenceDate: '2026-04-17',
    })

    expect(options.map((option) => option.name)).toContain('田中講師')
    // hidden teachers must be excluded in template mode
    expect(options.map((option) => option.name)).not.toContain('吉田講師')
    expect(options.map((option) => option.name)).toContain('鈴木講師')
  })
})