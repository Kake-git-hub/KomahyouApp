import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers, type StudentRow } from '../basic-data/basicDataModel'
import { createInitialRegularLessons, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { buildLinkedLessonDestinationMap } from './lessonLinks'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { appendDeletedStudentScheduleCountAdjustment, appendHistoryEntry, applyClassroomAvailability, buildBoardStudentSelectionOptions, buildMakeupAutoAssignPendingItems, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, buildStudentOccurrencesByDateIndex, buildTeacherSelectionOptions, buildTemplateStudentSelectionOptions, clampPopoverPosition, clearStudentStatusFromDesk, cloneWeek, cloneWeeks, cloneWeeksForActiveWeek, cloneWeeksForPublish, collectStudentRegularTeacherIds, collectStudentRegularTeacherIdsFromWeeks, ensureWeeksCoverDateRange, filterTemplateOverwriteHolidayDates, findDuplicateStudentInCellByKey, MAX_HISTORY_DEPTH, normalizeLessonPlacement, overlayBoardWeeksOnScheduleCells, packSortCellDesks, prepareStudentForMove, removeLecturePendingItemFromStockState, removeStudentFromDeskLesson, resolveSelectedMakeupOrigin, shouldWarnForbiddenPeriod, shouldWarnRegularTeachersOnly } from './ScheduleBoardScreen'
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

describe('appendHistoryEntry', () => {
  const makeEntry = (id: number) => ({ weeks: [], weekIndex: id }) as unknown as Parameters<typeof appendHistoryEntry>[1]

  it('appends entries until the depth cap is reached', () => {
    let stack: ReturnType<typeof appendHistoryEntry> = []
    for (let i = 0; i < MAX_HISTORY_DEPTH; i += 1) {
      stack = appendHistoryEntry(stack, makeEntry(i))
    }
    expect(stack).toHaveLength(MAX_HISTORY_DEPTH)
    expect(stack[stack.length - 1].weekIndex).toBe(MAX_HISTORY_DEPTH - 1)
  })

  it('drops the oldest entry once over the cap so memory stays bounded', () => {
    let stack: ReturnType<typeof appendHistoryEntry> = []
    for (let i = 0; i < MAX_HISTORY_DEPTH + 25; i += 1) {
      stack = appendHistoryEntry(stack, makeEntry(i))
    }
    expect(stack).toHaveLength(MAX_HISTORY_DEPTH)
    // 古い側が捨てられ、最新 MAX_HISTORY_DEPTH 件だけが残る
    expect(stack[0].weekIndex).toBe(25)
    expect(stack[stack.length - 1].weekIndex).toBe(MAX_HISTORY_DEPTH + 24)
  })
})

function makeBoardCell(dateKey: string, slotNumber: number, deskCount = 2): SlotCell {
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '',
    dateLabel: '',
    slotLabel: `${slotNumber}限`,
    slotNumber,
    isOpenDay: true,
    desks: Array.from({ length: deskCount }, (_, index) => ({
      id: `${dateKey}_${slotNumber}_desk_${index + 1}`,
      teacher: '',
    })),
  } as SlotCell
}

describe('cloneWeeksForActiveWeek', () => {
  it('deep-clones only the active week and keeps other week references (structural sharing)', () => {
    const week0 = [makeBoardCell('2026-06-01', 1)]
    const week1 = [makeBoardCell('2026-06-08', 1)]
    const weeks = [week0, week1]

    const next = cloneWeeksForActiveWeek(weeks, 1)
    expect(next).not.toBe(weeks)
    expect(next[0]).toBe(week0) // 未変更週は参照維持
    expect(next[1]).not.toBe(week1) // 編集対象週はクローン
    expect(next[1][0]).not.toBe(week1[0]) // セルまでディープクローン
    expect(next[1][0].desks[0]).not.toBe(week1[0].desks[0])
    expect(next[1]).toEqual(week1) // 内容は同一
  })

  it('falls back to full clone when the active index is out of range', () => {
    const week0 = [makeBoardCell('2026-06-01', 1)]
    const week1 = [makeBoardCell('2026-06-08', 1)]
    const weeks = [week0, week1]

    const next = cloneWeeksForActiveWeek(weeks, 5)
    expect(next[0]).not.toBe(week0)
    expect(next[1]).not.toBe(week1)
    expect(next).toEqual(weeks)
    // cloneWeeks と等価
    expect(next).toEqual(cloneWeeks(weeks))
    expect(cloneWeek(week0)).toEqual(week0)
  })
})

describe('cloneWeeksForPublish', () => {
  it('deep-clones weeks and reuses the same clone for the same week reference', () => {
    const week = [makeBoardCell('2026-06-01', 1)]
    const out1 = cloneWeeksForPublish([week])
    const out2 = cloneWeeksForPublish([week])
    expect(out1[0]).not.toBe(week) // ディープクローン
    expect(out1[0][0]).not.toBe(week[0])
    expect(out1[0]).toEqual(week) // 内容一致
    expect(out2[0]).toBe(out1[0]) // 同一週参照 → クローン再利用(未変更週の再クローンを回避)
  })

  it('produces a distinct clone for a different (changed) week reference', () => {
    const weekA = [makeBoardCell('2026-06-01', 1)]
    const weekB = [makeBoardCell('2026-06-01', 1)] // 内容同じでも別参照(=変更後の週)
    const outA = cloneWeeksForPublish([weekA])
    const outB = cloneWeeksForPublish([weekB])
    expect(outB[0]).not.toBe(outA[0]) // 別参照は別クローン → 変更が必ず反映される
  })
})

describe('applyClassroomAvailability memoization', () => {
  it('returns the cached result for an unchanged week reference and same settings', () => {
    const week = [makeBoardCell('2026-06-01', 1)]
    const first = applyClassroomAvailability([week], classroomSettings)
    const second = applyClassroomAvailability([week], classroomSettings)
    expect(second[0]).toBe(first[0]) // 同一週参照＋同一設定 → キャッシュ再利用
    expect(first[0][0].desks).toHaveLength(classroomSettings.deskCount) // デスク数正規化
  })

  it('recomputes when availability settings change', () => {
    const week = [makeBoardCell('2026-06-01', 1)]
    const base = applyClassroomAvailability([week], classroomSettings)
    const holiday = applyClassroomAvailability([week], { ...classroomSettings, holidayDates: ['2026-06-01'] })
    expect(holiday[0]).not.toBe(base[0])
    expect(base[0][0].isOpenDay).toBe(true)
    expect(holiday[0][0].isOpenDay).toBe(false) // 休日指定で休校
  })

  it('marks closed weekdays as not open', () => {
    const sunday = [makeBoardCell('2026-06-07', 1)] // 2026-06-07 は日曜(closedWeekdays:[0])
    const result = applyClassroomAvailability([sunday], classroomSettings)
    expect(result[0][0].isOpenDay).toBe(false)
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

describe('filterTemplateOverwriteHolidayDates', () => {
  it('drops manual holiday dates on or after the template overwrite start date', () => {
    expect(filterTemplateOverwriteHolidayDates([
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ], '2026-04-01')).toEqual(['2026-03-31'])
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
      },
      {
        ...studentBase,
        id: 'student-mid',
        name: '青木 太郎',
        displayName: '青木',
        birthDate: '2012-04-02',
        withdrawDate: '',
      },
      {
        ...studentBase,
        id: 'student-elm',
        name: '伊藤 次郎',
        displayName: '伊藤',
        birthDate: '2015-04-02',
        withdrawDate: '',
      },
      {
        ...studentBase,
        id: 'student-withdrawn',
        name: '退塾 生徒',
        displayName: '退塾',
        birthDate: '2013-04-02',
        withdrawDate: '2026-03-31',
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
      },
      {
        ...studentBase,
        id: 'student-withdrawn',
        name: '退塾 生徒',
        displayName: '退塾',
        birthDate: '2013-04-02',
        withdrawDate: '2026-03-31',
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

  it('keeps managed regular teacher ids through schedule overlay for teacher schedules', () => {
    const teachers = [{
      ...initialTeachers[0]!,
      id: 'teacher-ochiai',
      name: 'Ochiai Taro',
      displayName: 'Ochiai',
      entryDate: '2026-04-01',
      withdrawDate: '未定',
    }]
    const students = [{
      ...initialStudents[0]!,
      id: 'student-inoue',
      name: 'Inoue Hana',
      displayName: 'Inoue',
      entryDate: '2026-04-01',
      withdrawDate: '未定',
    }]
    const regularLessons = [{
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

    const planned = buildManagedScheduleCellsForRange({
      range: { startDate: '2026-07-01', endDate: '2026-07-31', periodValue: '' },
      fallbackStartDate: '2026-07-01',
      fallbackEndDate: '2026-07-31',
      classroomSettings,
      teachers,
      students,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const plannedTarget = planned.find((cell) => cell.dateKey === '2026-07-03' && cell.slotNumber === 5)
    const plannedDesk = plannedTarget?.desks.find((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue'))

    expect(plannedDesk?.teacher).toBe('Ochiai')
    expect(plannedDesk?.teacherAssignmentTeacherId).toBe('teacher-ochiai')

    const legacyBoardWeek = planned.map((cell) => cell.id === plannedTarget?.id
      ? {
          ...cell,
          desks: cell.desks.map((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue')
            ? { ...desk, teacher: 'Ochiai ', teacherAssignmentTeacherId: undefined }
            : desk),
        }
      : cell)

    const actual = buildScheduleCellsForRange({
      range: { startDate: '2026-07-01', endDate: '2026-07-31', periodValue: '' },
      fallbackStartDate: '2026-07-01',
      fallbackEndDate: '2026-07-31',
      classroomSettings,
      teachers,
      students,
      regularLessons,
      boardWeeks: [legacyBoardWeek],
      suppressedRegularLessonOccurrences: [],
    })
    const actualTarget = actual.find((cell) => cell.dateKey === '2026-07-03' && cell.slotNumber === 5)
    const actualDesk = actualTarget?.desks.find((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue'))

    expect(actualDesk?.teacher).toBe('Ochiai')
    expect(actualDesk?.teacherAssignmentTeacherId).toBe('teacher-ochiai')
  })

  // 回帰防止(6793374 / commit 2dce7b4 で巻き戻り再発): 盤面の通常生徒スロットが managedStudentId を
  // 欠いても、マージで管理データ(テンプレ)側の生徒IDを保持する。これを欠くと生徒日程表で本人に紐づかず
  // 通常授業がカウントされない(同一生徒が複数の通常授業を持つと顕在化。実例: 井上陽斗の金曜英語)。
  it('盤面の通常生徒が managedStudentId を欠いても管理データの生徒IDを保持する', () => {
    const teachers = [{
      ...initialTeachers[0]!,
      id: 'teacher-ochiai',
      name: 'Ochiai Taro',
      displayName: 'Ochiai',
      entryDate: '2026-04-01',
      withdrawDate: '未定',
    }]
    const students = [{
      ...initialStudents[0]!,
      id: 'student-inoue',
      name: 'Inoue Hana',
      displayName: 'Inoue',
      entryDate: '2026-04-01',
      withdrawDate: '未定',
    }]
    const regularLessons = [{
      id: 'regular-ochiai-inoue',
      schoolYear: 2026,
      teacherId: 'teacher-ochiai',
      student1Id: 'student-inoue',
      subject1: '英',
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
    const rangeParams = {
      range: { startDate: '2026-07-01', endDate: '2026-07-31', periodValue: '' },
      fallbackStartDate: '2026-07-01',
      fallbackEndDate: '2026-07-31',
      classroomSettings,
      teachers,
      students,
      regularLessons,
      suppressedRegularLessonOccurrences: [],
    }

    const planned = buildManagedScheduleCellsForRange({ ...rangeParams, boardWeeks: [] })
    const plannedTarget = planned.find((cell) => cell.dateKey === '2026-07-03' && cell.slotNumber === 5)
    expect(plannedTarget?.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue'))).toBe(true)

    // 盤面側は managedStudentId を失い、名前のみで残っている状態を再現する。
    const legacyBoardWeek = planned.map((cell) => cell.id === plannedTarget?.id
      ? {
          ...cell,
          desks: cell.desks.map((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 'student-inoue')
            ? {
                ...desk,
                lesson: {
                  ...desk.lesson!,
                  studentSlots: desk.lesson!.studentSlots.map((student) => student?.managedStudentId === 'student-inoue'
                    ? { ...student, managedStudentId: undefined }
                    : student) as [StudentEntry | null, StudentEntry | null],
                },
              }
            : desk),
        }
      : cell)

    const actual = buildScheduleCellsForRange({ ...rangeParams, boardWeeks: [legacyBoardWeek] })
    const actualTarget = actual.find((cell) => cell.dateKey === '2026-07-03' && cell.slotNumber === 5)
    const actualStudent = actualTarget?.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).find((student) => student?.subject === '英')

    expect(actualStudent?.managedStudentId).toBe('student-inoue')
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

  // 回帰防止: テンプレ(管理セル)に無い盤面の通常授業が、同deskIndexの別テンプレ授業(他の盤面デスクでID一致消費される)と
  // 衝突して脱落し、生徒日程表に出ない／カウントされない不具合。実例: 夏期講習期間の井上陽斗の金曜英語。
  // 「日程表=盤面の個人別ビュー」のため、テンプレ未反映の盤面通常授業は保持する。
  it('盤面の通常授業がテンプレに無く同indexで別テンプレ授業と衝突しても保持する', () => {
    const mkLesson = (id: string, students: Array<StudentEntry | null>) => ({ id, note: '管理データ反映', studentSlots: students as [StudentEntry | null, StudentEntry | null] })
    const mkCell = (cellId: string, desks: any[]) => ({ id: cellId, dateKey: '2026-08-07', dayLabel: '', dateLabel: '', slotLabel: '5限', slotNumber: 5, isOpenDay: true, desks }) as unknown as SlotCell
    const s001 = createStudentEntry('s001', '生徒一', '数')
    const s002 = createStudentEntry('s002', '生徒二', '英') // テンプレに無い盤面通常授業
    const s003 = createStudentEntry('s003', '生徒三', '国')

    // テンプレ(管理セル): desk0=managed_a(s001), desk1=managed_c(s003)
    const managedCell = mkCell('C1', [
      { id: 'd0', teacher: 'TA', lesson: mkLesson('managed_a', [s001, null]) },
      { id: 'd1', teacher: 'TC', lesson: mkLesson('managed_c', [s003, null]) },
    ])
    // 盤面: desk0=managed_a(s001), desk1=managed_b(s002・テンプレ未反映), desk2=managed_c(s003)
    // 盤面desk1(s002)の index1 はテンプレの managed_c と衝突するが、managed_c は盤面desk2でID一致消費される。
    const boardCell = mkCell('C1', [
      { id: 'd0', teacher: 'TA', lesson: mkLesson('managed_a', [s001, null]) },
      { id: 'd1b', teacher: 'TB', lesson: mkLesson('managed_b', [s002, null]) },
      { id: 'd2', teacher: 'TC', lesson: mkLesson('managed_c', [s003, null]) },
    ])

    const [merged] = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]], [])
    const placedIds = (merged.desks || []).flatMap((d) => (d.lesson?.studentSlots || []).filter(Boolean).map((s) => s!.managedStudentId))
    expect(placedIds).toContain('s002') // テンプレ未反映の盤面通常授業が保持される
    expect(placedIds).toContain('s001')
    expect(placedIds).toContain('s003')
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
    // 退塾日を過ぎた講師(吉田=休職を退塾日で代用)は候補から除外される
    expect(options.map((option) => option.name)).not.toContain('吉田講師')
    expect(options.map((option) => option.name)).toContain('鈴木講師')
  })
})

// 性能最適化の回帰防止: 盤面警告の「同日コマ」収集は、旧実装(生徒スロット毎に全盤面走査する
// collectStudentOccurrencesOnDate)から buildStudentOccurrencesByDateIndex(全盤面1パス)へ置き換えた。
// インデックスの内容・並び順が旧実装の都度走査と完全一致することを担保する（一致しなければ警告表示が変わる）。
describe('buildStudentOccurrencesByDateIndex', () => {
  const createOccurrenceCell = (id: string, dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell => ({
    id,
    dateKey,
    dayLabel: '火',
    dateLabel: dateKey.slice(5).replace('-', '/'),
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '16:20-17:50',
    isOpenDay: true,
    desks,
  })

  const createOccurrenceStudent = (id: string, name: string, managedStudentId: string | undefined, lessonType: StudentEntry['lessonType']): StudentEntry => ({
    id,
    name,
    managedStudentId,
    grade: '中3',
    subject: '数',
    lessonType,
    teacherType: 'normal',
  })

  // 旧 collectStudentOccurrencesOnDate と同じ走査(週→セル→デスク→スロット)・同じ生徒キー解決のリファレンス実装。
  const collectOccurrencesLegacy = (
    sourceWeeks: SlotCell[][],
    studentKey: string,
    dateKey: string,
    managedStudentByAnyName: Map<string, StudentRow>,
    resolveDisplayName: (name: string) => string,
  ) => {
    const lessons: Array<{ occurrenceKey: string; slotNumber: number; lessonType: StudentEntry['lessonType'] }> = []
    for (const week of sourceWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== dateKey) continue
        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          for (let studentIndex = 0; studentIndex < (desk.lesson?.studentSlots.length ?? 0); studentIndex += 1) {
            const student = desk.lesson?.studentSlots[studentIndex]
            if (!student) continue
            const managedId = student.managedStudentId ?? managedStudentByAnyName.get(student.name)?.id
            const currentKey = managedId ?? `name:${resolveDisplayName(student.name)}`
            if (currentKey !== studentKey) continue
            lessons.push({
              occurrenceKey: `${cell.id}__${deskIndex}__${studentIndex}`,
              slotNumber: cell.slotNumber,
              lessonType: student.lessonType,
            })
          }
        }
      }
    }
    return lessons
  }

  const buildOccurrenceWeeks = (): SlotCell[][] => {
    const studentA1 = createOccurrenceStudent('board-a1', 'A生徒', 'stu-a', 'regular')
    const studentA2 = createOccurrenceStudent('board-a2', 'A生徒', 'stu-a', 'special')
    const studentA3 = createOccurrenceStudent('board-a3', 'A生徒', 'stu-a', 'makeup')
    const studentB = createOccurrenceStudent('board-b1', 'B生徒', undefined, 'regular')
    const studentC = createOccurrenceStudent('board-c1', 'C生徒', undefined, 'extra')

    return [
      [
        // 同日で後のセルの方が時限が小さい並びにして、「時限順ではなく走査順」を検証する
        createOccurrenceCell('2026-04-07_3', '2026-04-07', 3, [
          { id: 'd1', teacher: 'T1', lesson: { id: 'l1', studentSlots: [studentA1, studentB] } },
        ]),
        createOccurrenceCell('2026-04-07_2', '2026-04-07', 2, [
          { id: 'd2', teacher: '' },
          { id: 'd3', teacher: 'T2', lesson: { id: 'l2', studentSlots: [null, studentA2] } },
        ]),
        createOccurrenceCell('2026-04-08_1', '2026-04-08', 1, [
          { id: 'd4', teacher: 'T3', lesson: { id: 'l3', studentSlots: [studentC, null] } },
        ]),
      ],
      [
        createOccurrenceCell('2026-04-14_2', '2026-04-14', 2, [
          { id: 'd5', teacher: 'T1', lesson: { id: 'l4', studentSlots: [studentA3, null] } },
        ]),
      ],
    ]
  }

  const managedStudentByAnyName = new Map<string, StudentRow>([
    ['B生徒', { id: 'stu-b', name: 'B生徒' } as StudentRow],
  ])
  const resolveDisplayName = (name: string) => (name === 'C生徒' ? 'C表示名' : name)

  it('インデックスの (生徒キー, 日付) ごとの内容・並び順が旧実装の都度走査と完全一致する', () => {
    const weeks = buildOccurrenceWeeks()
    const index = buildStudentOccurrencesByDateIndex(weeks, managedStudentByAnyName, resolveDisplayName)

    const allDateKeys = ['2026-04-07', '2026-04-08', '2026-04-14']
    const allStudentKeys = ['stu-a', 'stu-b', 'name:C表示名', 'stu-unknown']
    for (const studentKey of allStudentKeys) {
      for (const dateKey of allDateKeys) {
        const fromIndex = index.get(studentKey)?.get(dateKey) ?? []
        const fromLegacy = collectOccurrencesLegacy(weeks, studentKey, dateKey, managedStudentByAnyName, resolveDisplayName)
        expect(fromIndex).toEqual(fromLegacy)
      }
    }
  })

  it('同日の出現はセルの走査順で並び、managedStudentId 欠落時は登録名経由で同一生徒に束ねる', () => {
    const weeks = buildOccurrenceWeeks()
    const index = buildStudentOccurrencesByDateIndex(weeks, managedStudentByAnyName, resolveDisplayName)

    // A生徒: 同日2コマ(3限セル→2限セルの走査順)＋別日・別週
    expect(index.get('stu-a')?.get('2026-04-07')).toEqual([
      { occurrenceKey: '2026-04-07_3__0__0', slotNumber: 3, lessonType: 'regular' },
      { occurrenceKey: '2026-04-07_2__1__1', slotNumber: 2, lessonType: 'special' },
    ])
    expect(index.get('stu-a')?.get('2026-04-14')).toEqual([
      { occurrenceKey: '2026-04-14_2__0__0', slotNumber: 2, lessonType: 'makeup' },
    ])

    // B生徒: managedStudentId なしでも登録名から stu-b に解決される
    expect(index.get('stu-b')?.get('2026-04-07')).toEqual([
      { occurrenceKey: '2026-04-07_3__0__1', slotNumber: 3, lessonType: 'regular' },
    ])

    // C生徒: 未連携生徒は表示名キーで束ねる
    expect(index.get('name:C表示名')?.get('2026-04-08')).toEqual([
      { occurrenceKey: '2026-04-08_1__0__0', slotNumber: 1, lessonType: 'extra' },
    ])

    // 配置総数 = インデックス内の出現総数（取りこぼし・重複がない）
    const totalIndexed = Array.from(index.values()).flatMap((byDate) => Array.from(byDate.values())).reduce((total, occurrences) => total + occurrences.length, 0)
    expect(totalIndexed).toBe(5)
  })
})

// 回帰防止(2026-06-15): 「通常講師のみ」制約違反が、通常授業通りの配置(lessonType==='regular')でも誤検知される不具合。
// 原因: 盤面に孤立保持された旧通常授業スロットの講師が、ライブ regularLessons から算出する許可講師集合と食い違う。
// 修正なし(regular を除外しない)だと「通常授業スロットは違反にしない」テストが落ち、修正ありで通る。
describe('shouldWarnRegularTeachersOnly', () => {
  it('通常授業スロットは許可講師集合に無い講師でも違反にしない(回帰防止: 孤立保持された旧通常授業の誤検知)', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: true,
      lessonType: 'regular',
      teacherId: 'teacher-old',
      regularTeacherIds: new Set(['teacher-new']),
    })).toBe(false)
  })

  it('通常授業スロットは許可講師集合が空でも違反にしない(基本データ削除/変更で孤立した通常授業)', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: true,
      lessonType: 'regular',
      teacherId: 'teacher-old',
      regularTeacherIds: new Set<string>(),
    })).toBe(false)
  })

  it('在庫(振替)配置は通常講師でない講師なら従来どおり違反にする', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: true,
      lessonType: 'makeup',
      teacherId: 'teacher-x',
      regularTeacherIds: new Set(['teacher-a', 'teacher-b']),
    })).toBe(true)
  })

  it('在庫配置でも通常講師なら違反にしない', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: true,
      lessonType: 'makeup',
      teacherId: 'teacher-a',
      regularTeacherIds: new Set(['teacher-a', 'teacher-b']),
    })).toBe(false)
  })

  it('在庫配置で講師未割当(teacherId=null)なら違反にする', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: true,
      lessonType: 'makeup',
      teacherId: null,
      regularTeacherIds: new Set(['teacher-a']),
    })).toBe(true)
  })

  it('ルール非適用なら常に違反にしない', () => {
    expect(shouldWarnRegularTeachersOnly({
      ruleApplicable: false,
      lessonType: 'makeup',
      teacherId: null,
      regularTeacherIds: new Set<string>(),
    })).toBe(false)
  })
})

// 回帰防止(2026-06-28): 「指定時限禁止」制約違反が、通常授業(lessonType==='regular')でも赤文字になっていた不具合。
// 「通常講師のみ」と同じく、固定の通常授業は割振り対象でないため違反扱いしない。
// 修正なし(regular を除外しない)だと「通常授業は違反にしない」テストが落ち、修正ありで通る。
describe('shouldWarnForbiddenPeriod', () => {
  it('通常授業は指定時限と重なっても違反にしない(赤文字にしない)', () => {
    expect(shouldWarnForbiddenPeriod({
      ruleApplicable: true,
      lessonType: 'regular',
      slotNumber: 1,
      forbiddenPeriods: [1],
    })).toBe(false)
  })

  it('在庫(講習)が指定時限に重なれば従来どおり違反にする', () => {
    expect(shouldWarnForbiddenPeriod({
      ruleApplicable: true,
      lessonType: 'special',
      slotNumber: 1,
      forbiddenPeriods: [1],
    })).toBe(true)
  })

  it('在庫(振替)でも指定時限でなければ違反にしない', () => {
    expect(shouldWarnForbiddenPeriod({
      ruleApplicable: true,
      lessonType: 'makeup',
      slotNumber: 2,
      forbiddenPeriods: [1],
    })).toBe(false)
  })

  it('ルール非適用なら常に違反にしない', () => {
    expect(shouldWarnForbiddenPeriod({
      ruleApplicable: false,
      lessonType: 'special',
      slotNumber: 1,
      forbiddenPeriods: [1],
    })).toBe(false)
  })
})

// 回帰防止(2026-06-21): 「通常講師のみ」がその曜日の担当だけを見ていたため、講習が通常授業と別曜日だと空集合になり機能しない不具合。
// 修正で曜日を問わず その生徒の通常授業担当講師を集めるようにした(spec-auto-assign-rules ⑧/オーナー確認: 曜日問わず)。
describe('collectStudentRegularTeacherIds (通常講師のみ: 曜日問わず)', () => {
  const makeLesson = (overrides: Partial<RegularLessonRow>): RegularLessonRow => ({
    id: 'r', schoolYear: 2026, teacherId: 't', student1Id: '', subject1: '', startDate: '', endDate: '',
    student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1,
    ...overrides,
  })

  it('別曜日の通常授業担当講師も対象になる(本不具合の修正点)', () => {
    // 月曜の通常授業(teacher-mon)を持つ生徒について、土曜の講習日キーで問い合わせても担当講師が返る。
    const lessons = [makeLesson({ id: 'r1', teacherId: 'teacher-mon', student1Id: 'stu-1', dayOfWeek: 1 })]
    expect(collectStudentRegularTeacherIds(lessons, 'stu-1', '2026-08-15')).toEqual(new Set(['teacher-mon']))
  })

  it('複数曜日・student2側も含めて担当講師を集約する', () => {
    const lessons = [
      makeLesson({ id: 'r1', teacherId: 'teacher-mon', student1Id: 'stu-1', dayOfWeek: 1 }),
      makeLesson({ id: 'r2', teacherId: 'teacher-wed', student1Id: 'other', student2Id: 'stu-1', dayOfWeek: 3 }),
      makeLesson({ id: 'r3', teacherId: 'teacher-fri', student1Id: 'unrelated', dayOfWeek: 5 }),
    ]
    expect(collectStudentRegularTeacherIds(lessons, 'stu-1', '2026-08-15')).toEqual(new Set(['teacher-mon', 'teacher-wed']))
  })

  it('在籍期間外の通常授業は担当講師に含めない', () => {
    const lessons = [makeLesson({ id: 'r1', teacherId: 'teacher-late', student1Id: 'stu-1', dayOfWeek: 1, startDate: '2026-09-01' })]
    // 開始前の日付では対象外。
    expect(collectStudentRegularTeacherIds(lessons, 'stu-1', '2026-08-15')).toEqual(new Set<string>())
    // 開始後の日付では対象。
    expect(collectStudentRegularTeacherIds(lessons, 'stu-1', '2026-09-10')).toEqual(new Set(['teacher-late']))
  })
})

// 回帰防止(2026-06-22): 基本データ編集で regularLessons 配列が盤面と食い違うと、ライブ配列由来の通常講師判定が
// 空になり、別曜日の講習がその生徒の通常講師に割り振られない不具合。盤面(persisted/テンプレ)の通常授業から
// 担当講師を集めることで、ユーザーが見ている『テンプレでの組み合わせ』に一致させる。
describe('collectStudentRegularTeacherIdsFromWeeks (盤面から通常講師を特定)', () => {
  const resolveStudentKey = (student: StudentEntry) => student.managedStudentId ?? student.id
  const resolveDeskTeacherId = (desk: { teacher: string }) => (desk.teacher.trim() ? `id:${desk.teacher.trim()}` : null)
  const makeWeeks = (desks: SlotCell['desks']): SlotCell[][] => [[
    { id: '2026-08-15_2', dateKey: '2026-08-15', dayLabel: '土', dateLabel: '8/15', slotLabel: '2限', slotNumber: 2, timeLabel: '', isOpenDay: true, desks },
  ]]

  it('盤面の通常授業スロットからその生徒のデスク担当講師を集める', () => {
    const weeks = makeWeeks([
      { id: 'd1', teacher: 'X先生', lesson: { id: 'l1', studentSlots: [createStudentEntry('stu-1', '対象生徒', '数'), null] } },
      { id: 'd2', teacher: 'Z先生', lesson: { id: 'l2', studentSlots: [createStudentEntry('other', '別生徒', '数'), null] } },
    ])
    expect(collectStudentRegularTeacherIdsFromWeeks(weeks, 'stu-1', resolveStudentKey, resolveDeskTeacherId)).toEqual(new Set(['id:X先生']))
  })

  it('通常授業以外(講習など lessonType!==regular)のスロットは担当講師に含めない', () => {
    const specialEntry = { ...createStudentEntry('stu-1', '対象生徒', '数'), lessonType: 'special' as const }
    const weeks = makeWeeks([
      { id: 'd1', teacher: 'Y先生', lesson: { id: 'l1', studentSlots: [specialEntry, null] } },
    ])
    expect(collectStudentRegularTeacherIdsFromWeeks(weeks, 'stu-1', resolveStudentKey, resolveDeskTeacherId)).toEqual(new Set<string>())
  })
})

// 回帰防止: 未消化振替一覧から特定の振替元日付を選んで配置したとき、最古ではなく
// 「選んだ振替元日付」が割り当てられること。以前は常に nextOriginDate(最古)を使っていた。
describe('resolveSelectedMakeupOrigin (選んだ振替元日付を割り当てる)', () => {
  const placementEntry = {
    remainingOriginDates: ['2026-05-01', '2026-05-15', '2026-06-01'],
    remainingOriginLabels: ['2026/5/1(金) 2限', '2026/5/15(金) 2限', '2026/6/1(月) 2限'],
    remainingOriginReasonLabels: ['休校日', '同時間帯の重複', '空きコマ不足'],
    nextOriginDate: '2026-05-01',
    nextOriginLabel: '2026/5/1(金) 2限',
    nextOriginReasonLabel: '休校日',
  }

  it('選んだ振替元日付(最古ではない)を、その日付のラベル・理由とともに割り当てる', () => {
    expect(resolveSelectedMakeupOrigin(placementEntry, '2026-05-15')).toEqual({
      originDate: '2026-05-15',
      originLabel: '2026/5/15(金) 2限',
      originReasonLabel: '同時間帯の重複',
    })
  })

  it('末尾の振替元日付を選んでも、その日付が割り当てられる', () => {
    expect(resolveSelectedMakeupOrigin(placementEntry, '2026-06-01')).toEqual({
      originDate: '2026-06-01',
      originLabel: '2026/6/1(月) 2限',
      originReasonLabel: '空きコマ不足',
    })
  })

  it('選択日付が無い(null)場合は最古(nextOriginDate)へフォールバックする', () => {
    expect(resolveSelectedMakeupOrigin(placementEntry, null)).toEqual({
      originDate: '2026-05-01',
      originLabel: '2026/5/1(金) 2限',
      originReasonLabel: '休校日',
    })
  })

  it('選択日付が remainingOriginDates に存在しない場合も最古へフォールバックする', () => {
    expect(resolveSelectedMakeupOrigin(placementEntry, '2030-01-01')).toEqual({
      originDate: '2026-05-01',
      originLabel: '2026/5/1(金) 2限',
      originReasonLabel: '休校日',
    })
  })
})

describe('buildMakeupAutoAssignPendingItems (未消化振替の自動割振 pending items)', () => {
  const makeRaw = (overrides: Partial<Parameters<typeof buildMakeupAutoAssignPendingItems>[0][number]>) => ({
    subject: '英',
    balance: 0,
    remainingOriginDates: [],
    remainingOriginLabels: [],
    remainingOriginReasonLabels: [],
    nextOriginDate: null,
    nextOriginLabel: null,
    nextOriginReasonLabel: null,
    ...overrides,
  })

  it('balance の数だけ pending item を生成し、各 origin を振るい順(古い順)で割り当てる', () => {
    const items = buildMakeupAutoAssignPendingItems([
      makeRaw({
        subject: '英',
        balance: 2,
        remainingOriginDates: ['2026-05-01', '2026-05-15', '2026-06-01'],
        remainingOriginLabels: ['2026/5/1(金) 2限', '2026/5/15(金) 2限', '2026/6/1(月) 2限'],
        remainingOriginReasonLabels: ['休校日', '同時間帯の重複', '空きコマ不足'],
        nextOriginDate: '2026-05-01',
        nextOriginLabel: '2026/5/1(金) 2限',
        nextOriginReasonLabel: '休校日',
      }),
    ])

    expect(items).toEqual([
      { subject: '英', makeupSourceDate: '2026-05-01', makeupSourceLabel: '2026/5/1(金) 2限', makeupSourceReasonLabel: '休校日' },
      { subject: '英', makeupSourceDate: '2026-05-15', makeupSourceLabel: '2026/5/15(金) 2限', makeupSourceReasonLabel: '同時間帯の重複' },
    ])
  })

  it('balance を超えて pending item を生成しない(残数=balance を厳守)', () => {
    const items = buildMakeupAutoAssignPendingItems([
      makeRaw({
        subject: '数',
        balance: 1,
        remainingOriginDates: ['2026-05-01', '2026-05-15'],
        remainingOriginLabels: ['2026/5/1(金) 3限', '2026/5/15(金) 3限'],
        remainingOriginReasonLabels: ['休校日', '休校日'],
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.makeupSourceDate).toBe('2026-05-01')
  })

  it('balance 0 / 負数のエントリは pending item を生成しない', () => {
    const items = buildMakeupAutoAssignPendingItems([
      makeRaw({ subject: '英', balance: 0, remainingOriginDates: ['2026-05-01'] }),
      makeRaw({ subject: '数', balance: -2, remainingOriginDates: ['2026-05-01'] }),
    ])
    expect(items).toEqual([])
  })

  it('科目別に独立して展開する(複数 raw を結合)', () => {
    const items = buildMakeupAutoAssignPendingItems([
      makeRaw({ subject: '英', balance: 1, remainingOriginDates: ['2026-05-01'], remainingOriginLabels: ['a'], remainingOriginReasonLabels: ['休校日'] }),
      makeRaw({ subject: '数', balance: 1, remainingOriginDates: ['2026-05-02'], remainingOriginLabels: ['b'], remainingOriginReasonLabels: ['空きコマ不足'] }),
    ])
    expect(items.map((item) => item.subject)).toEqual(['英', '数'])
  })

  it('origin 配列が balance に満たない場合は nextOrigin へフォールバックする', () => {
    const items = buildMakeupAutoAssignPendingItems([
      makeRaw({
        subject: '国',
        balance: 2,
        remainingOriginDates: ['2026-05-01'],
        remainingOriginLabels: ['2026/5/1(金) 1限'],
        remainingOriginReasonLabels: ['休校日'],
        nextOriginDate: '2026-05-01',
        nextOriginLabel: '2026/5/1(金) 1限',
        nextOriginReasonLabel: '休校日',
      }),
    ])
    expect(items).toHaveLength(2)
    expect(items[0]?.makeupSourceDate).toBe('2026-05-01')
    // 2件目は remainingOriginDates[1] が無いので nextOriginDate へフォールバック。
    expect(items[1]?.makeupSourceDate).toBe('2026-05-01')
  })
})