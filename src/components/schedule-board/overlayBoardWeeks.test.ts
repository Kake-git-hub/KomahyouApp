import { describe, expect, it } from 'vitest'
import type { SlotCell, StudentEntry, DeskCell } from './types'
import { overlayBoardWeeksOnScheduleCells } from './ScheduleBoardScreen'

function createStudentEntry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '山野櫂',
    managedStudentId: 's022',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function createDesk(overrides: Partial<DeskCell> = {}): DeskCell {
  return {
    id: 'desk-1',
    teacher: '',
    ...overrides,
  }
}

function createCell(overrides: Partial<SlotCell> = {}): SlotCell {
  return {
    id: '2026-07-14_4',
    dateKey: '2026-07-14',
    dayLabel: '火',
    dateLabel: '7/14',
    slotLabel: '4限',
    slotNumber: 4,
    timeLabel: '19:30-20:50',
    isOpenDay: true,
    desks: [],
    ...overrides,
  }
}

describe('overlayBoardWeeksOnScheduleCells', () => {
  it('preserves board-side managed regular students when managed cell has only teacher-only desks (template silent for this cell)', () => {
    const boardStudent = createStudentEntry()
    const boardCell = createCell({
      desks: [
        createDesk({
          id: 'board-desk-1',
          teacher: '福田',
          lesson: {
            id: 'managed_oldRowId_2026-07-14',
            note: '管理データ反映',
            studentSlots: [boardStudent, null],
          },
        }),
        createDesk({ id: 'board-desk-2', teacher: '宮原' }),
      ],
    })
    // 管理セルはteacher-only（テンプレが当該コマの生徒行を持たない）
    const managedCell = createCell({
      desks: [
        createDesk({ id: 'm-desk-1', teacher: '宮原' }),
        createDesk({ id: 'm-desk-2', teacher: '弘谷' }),
      ],
    })

    const merged = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]])

    expect(merged).toHaveLength(1)
    const mergedCell = merged[0]
    const lessons = mergedCell.desks.map((d) => d.lesson).filter(Boolean)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]!.studentSlots[0]?.managedStudentId).toBe('s022')
    expect(lessons[0]!.studentSlots[0]?.lessonType).toBe('regular')
  })

  it('preserves a board-visible managed regular lesson even when the current managed cell has unrelated lessons', () => {
    const legacyStudent = createStudentEntry({ managedStudentId: 's999', name: '旧テンプレ生徒' })
    const keptStudent = createStudentEntry({ managedStudentId: 's100', name: '残る生徒' })
    const boardCell = createCell({
      desks: [
        createDesk({
          id: 'board-desk-1',
          teacher: '福田',
          lesson: {
            id: 'managed_removedRow_2026-07-14',
            note: '管理データ反映',
            studentSlots: [legacyStudent, null],
          },
        }),
        createDesk({ id: 'board-desk-2' }),
      ],
    })
    // 管理セルに別の managed lesson が存在しても、コマ表に見えている実績授業は日程表へ反映する
    const managedCell = createCell({
      desks: [
        createDesk({ id: 'm-desk-1', teacher: '福田' }),
        createDesk({
          id: 'm-desk-2',
          teacher: '別講師',
          lesson: {
            id: 'managed_otherRow_2026-07-14',
            note: '管理データ反映',
            studentSlots: [keptStudent, null],
          },
        }),
      ],
    })

    const merged = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]])
    const studentIds = merged[0].desks
      .flatMap((d) => d.lesson?.studentSlots ?? [])
      .filter(Boolean)
      .map((s) => s!.managedStudentId)
    expect(studentIds).toContain('s999')
    expect(studentIds).toContain('s100')
  })
})
