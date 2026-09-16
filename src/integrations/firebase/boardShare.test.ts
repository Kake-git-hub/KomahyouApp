import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../../components/schedule-board/types'
import { buildBoardShareDocBase, compactBoardSharePayload, type BoardSharePayload } from './boardShare'

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
describe('buildBoardShareDocBase(配布用盤面ドキュメントの土台)', () => {
  const compacted: BoardSharePayload = {
    schemaVersion: 1,
    token: 'share-token',
    classroomId: 'classroom-1',
    classroomName: 'スクールIE 緑が丘校',
    sharedAt: '2026-09-16T00:00:00.000Z',
    cells: [],
    externalStudentIds: ['s2', 's1', 's1', ''],
  }

  // boardShares はワークスペース外のトップレベルコレクション。会社を跨いで教室 ID が衝突しうるため
  // 「どの会社の共有か」を書き残す(複数会社展開 Phase 0 / T0-3)。読みは無改変。
  it('workspaceKey を書き足す', () => {
    expect(buildBoardShareDocBase(compacted, 'main')).toMatchObject({ workspaceKey: 'main', classroomId: 'classroom-1' })
  })

  it('workspaceKey が空(env 未設定)なら書かない(空文字を保存しない)', () => {
    expect('workspaceKey' in buildBoardShareDocBase(compacted, '')).toBe(false)
    expect('workspaceKey' in buildBoardShareDocBase(compacted, '   ')).toBe(false)
  })

  it('既存フィールド(識別子と正規化)を落とさない', () => {
    const base = buildBoardShareDocBase(compacted, ' other ')
    expect(base).toMatchObject({
      schemaVersion: 1,
      token: 'share-token',
      classroomId: 'classroom-1',
      classroomName: 'スクールIE 緑が丘校',
      sharedAt: '2026-09-16T00:00:00.000Z',
      workspaceKey: 'other',
      externalStudentIds: ['s1', 's2'],
    })
    expect(base.groupClassEntries).toEqual({})
  })
})
