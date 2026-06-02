import { describe, expect, it } from 'vitest'
import { runDataIntegrityChecks } from './dataIntegrity'
import type { ClassroomSettings, PersistedBoardState } from '../types/appState'
import type { SlotCell, StudentEntry } from '../components/schedule-board/types'

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 2,
}

function student(id: string, name: string): StudentEntry {
  return {
    id,
    managedStudentId: id,
    name,
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
  }
}

function buildBoardState(cell: SlotCell): PersistedBoardState {
  return {
    weeks: [[cell]],
    weekIndex: 0,
    selectedCellId: cell.id,
    selectedDeskIndex: 0,
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
    manualMakeupAdjustments: {},
    suppressedMakeupOrigins: {},
    fallbackMakeupStudents: {},
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    fallbackLectureStockStudents: {},
    isLectureStockOpen: false,
    isMakeupStockOpen: false,
    studentScheduleRange: null,
    teacherScheduleRange: null,
  }
}

describe('runDataIntegrityChecks', () => {
  it('detects duplicate students in the same date and slot', () => {
    const duplicate = student('student_1', '重複生徒')
    const report = runDataIntegrityChecks({
      classroomSettings,
      boardState: buildBoardState({
        id: '2026-04-01_3',
        dateKey: '2026-04-01',
        dayLabel: '水',
        dateLabel: '4/1',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [
          { id: 'desk_1', teacher: 'A', lesson: { id: 'lesson_1', studentSlots: [duplicate, null] } },
          { id: 'desk_2', teacher: 'B', lesson: { id: 'lesson_2', studentSlots: [null, duplicate] } },
        ],
      }),
      specialSessions: [],
      studentIds: ['student_1'],
      teacherIds: [],
    })

    expect(report.counts.errors).toBe(1)
    expect(report.issues[0]?.title).toBe('同一コマ内の生徒重複')
  })

  it('detects duplicated QR submission tokens', () => {
    const report = runDataIntegrityChecks({
      classroomSettings,
      boardState: null,
      specialSessions: [{
        id: 'session_1',
        label: '夏期',
        startDate: '2026-07-20',
        endDate: '2026-08-31',
        studentInputs: {
          student_1: { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, submissionToken: 'same-token', updatedAt: '' },
        },
        teacherInputs: {
          teacher_1: { unavailableSlots: [], countSubmitted: false, submissionToken: 'same-token', updatedAt: '' },
        },
        createdAt: '',
        updatedAt: '',
      }],
      studentIds: ['student_1'],
      teacherIds: ['teacher_1'],
    })

    expect(report.issues.some((issue) => issue.title === 'QR提出トークンの重複')).toBe(true)
  })
})
