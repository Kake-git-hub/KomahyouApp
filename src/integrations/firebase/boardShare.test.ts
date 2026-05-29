import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../../components/schedule-board/types'
import { compactBoardSharePayload } from './boardShare'

describe('compactBoardSharePayload', () => {
  it('keeps board-share display fields and removes bulky board-only data', () => {
    const largeText = 'x'.repeat(1000)
    const sourceCell: SlotCell = {
      id: 'cell-1',
      dateKey: '2026-05-23',
      dayLabel: '土',
      dateLabel: '5/23',
      slotLabel: '1限',
      slotNumber: 1,
      timeLabel: '16:00-17:30',
      isOpenDay: true,
      desks: [{
        id: 'desk-1',
        teacher: '佐藤先生',
        manualTeacher: true,
        teacherAssignmentSource: 'manual',
        teacherUnavailableWarning: true,
        memoSlots: [largeText, largeText],
        lesson: {
          id: 'lesson-1',
          note: largeText,
          warning: largeText,
          studentSlots: [{
            id: 'student-slot-1',
            name: '山田太郎',
            managedStudentId: 'student-1',
            grade: '中2',
            birthDate: '2012-01-01',
            warning: largeText,
            warningHighlight: true,
            manualAdded: true,
            makeupSourceDate: '2026-05-16',
            makeupSourceLabel: '5/16(土) 1限',
            noteSuffix: '60',
            subject: '英',
            lessonType: 'makeup',
            teacherType: 'normal',
          }, null],
        },
        statusSlots: [{
          id: 'status-1',
          studentId: 'student-1',
          sourceManagedLesson: true,
          name: '山田太郎',
          managedStudentId: 'student-1',
          grade: '中2',
          subject: '英',
          lessonType: 'regular',
          teacherType: 'normal',
          teacherName: '佐藤先生',
          dateKey: '2026-05-23',
          slotNumber: 1,
          recordedAt: '2026-05-23T00:00:00.000Z',
          status: 'absent',
          sourceLessonId: 'lesson-1',
          sourceLessonNote: largeText,
          sourceLessonWarning: largeText,
        }, null],
      }],
    }

    const compactPayload = compactBoardSharePayload({
      schemaVersion: 1,
      token: 'share-token',
      classroomId: 'classroom-1',
      classroomName: 'スクールIE 緑が丘校',
      sharedAt: '2026-05-23T00:00:00.000Z',
      cells: [sourceCell],
    })

    expect(compactPayload.cells[0]?.desks[0]?.lesson?.studentSlots[0]).toEqual({
      id: 'student-slot-1',
      name: '山田太郎',
      managedStudentId: 'student-1',
      grade: '中2',
      noteSuffix: '60',
      makeupSourceDate: '2026-05-16',
      makeupSourceLabel: '5/16(土) 1限',
      subject: '英',
      lessonType: 'makeup',
      teacherType: 'normal',
    })
    expect(compactPayload.cells[0]?.desks[0]?.statusSlots?.[0]).toEqual({
      id: 'status-1',
      name: '山田太郎',
      managedStudentId: 'student-1',
      grade: '中2',
      noteSuffix: undefined,
      makeupSourceDate: undefined,
      makeupSourceLabel: undefined,
      subject: '英',
      lessonType: 'regular',
      teacherType: 'normal',
      moveDestinationDateKey: undefined,
      status: 'absent',
    })

    const compactJson = JSON.stringify(compactPayload)
    expect(compactJson).not.toContain(largeText)
    expect(compactJson.length).toBeLessThan(JSON.stringify({ cells: [sourceCell] }).length / 4)
  })
})