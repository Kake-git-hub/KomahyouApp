import { describe, expect, it } from 'vitest'
import { packSortCellDesks, seatSortCells } from './deskSort'
import type { DeskCell, SlotCell, StudentEntry } from './types'

function createStudent(id: string, name: string): StudentEntry {
  return {
    id,
    name,
    managedStudentId: id,
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
  } as StudentEntry
}

function createDesk(cellId: string, index: number, teacher: string, options?: { studentName?: string; teacherId?: string }): DeskCell {
  return {
    id: `${cellId}_desk_${index + 1}`,
    teacher,
    teacherAssignmentTeacherId: options?.teacherId,
    lesson: options?.studentName
      ? { id: `${cellId}_lesson_${index + 1}`, studentSlots: [createStudent(`${options.studentName}_id`, options.studentName), null] }
      : undefined,
  }
}

function createCell(dateKey: string, slotNumber: number, deskSpecs: Array<{ teacher: string; studentName?: string; teacherId?: string }>): SlotCell {
  const cellId = `${dateKey}_${slotNumber}`
  return {
    id: cellId,
    dateKey,
    dayLabel: '月',
    dateLabel: '8/17',
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '',
    isOpenDay: true,
    desks: deskSpecs.map((spec, index) => createDesk(cellId, index, spec.teacher, spec)),
  }
}

function seatOf(cell: SlotCell, teacher: string) {
  return cell.desks.findIndex((desk) => desk.teacher === teacher)
}

describe('seatSortCells（同席番で並べ替え）', () => {
  it('コマ数の多い講師から順に、1日の全コマで同じ席番へ揃える', () => {
    // A は 1〜3 限すべて、B は 2〜3 限、C は 3 限のみ。
    const cells = [
      createCell('2026-08-17', 1, [{ teacher: '' }, { teacher: '' }, { teacher: 'A', studentName: 'a1' }]),
      createCell('2026-08-17', 2, [{ teacher: 'B', studentName: 'b1' }, { teacher: '' }, { teacher: 'A', studentName: 'a2' }]),
      createCell('2026-08-17', 3, [{ teacher: 'C', studentName: 'c1' }, { teacher: 'A', studentName: 'a3' }, { teacher: 'B', studentName: 'b3' }]),
    ]

    const sorted = seatSortCells(cells)

    // コマ数最多の A が最小席番(0)を確保し、3 コマとも同じ席番になる。
    expect(sorted.map((cell) => seatOf(cell, 'A'))).toEqual([0, 0, 0])
    // 次点の B は 2 コマとも同じ席番。
    const bSeats = [seatOf(sorted[1], 'B'), seatOf(sorted[2], 'B')]
    expect(bSeats[0]).toBe(bSeats[1])
    expect(bSeats[0]).not.toBe(0)
    // C は 1 コマだけなので残りの空き席に入る。
    expect(seatOf(sorted[2], 'C')).toBeGreaterThanOrEqual(0)
  })

  it('席が競合して同席番を確保できない講師は、そのコマの空き席へ入れる（部分最適）', () => {
    // 机は 2 席しかなく、1 限は A/B、2 限は A/C、3 限は B/C。
    // A(2コマ)→席0、B(2コマ)→席1 まで確保でき、C は 2 限で席1・3 限で席0 になる。
    const cells = [
      createCell('2026-08-17', 1, [{ teacher: 'B', studentName: 'b1' }, { teacher: 'A', studentName: 'a1' }]),
      createCell('2026-08-17', 2, [{ teacher: 'C', studentName: 'c2' }, { teacher: 'A', studentName: 'a2' }]),
      createCell('2026-08-17', 3, [{ teacher: 'C', studentName: 'c3' }, { teacher: 'B', studentName: 'b3' }]),
    ]

    const sorted = seatSortCells(cells)

    expect(seatOf(sorted[0], 'A')).toBe(0)
    expect(seatOf(sorted[1], 'A')).toBe(0)
    expect(seatOf(sorted[0], 'B')).toBe(1)
    expect(seatOf(sorted[2], 'B')).toBe(1)
    // C は同席番を確保できず、各コマの空き席に落ちる。
    expect(seatOf(sorted[1], 'C')).toBe(1)
    expect(seatOf(sorted[2], 'C')).toBe(0)
  })

  it('日をまたいでは席番を揃えない（dateKey ごとに独立して最適化する）', () => {
    const cells = [
      // 月曜: B のほうがコマ数が多い → B が席0。
      createCell('2026-08-17', 1, [{ teacher: 'A', studentName: 'a1' }, { teacher: 'B', studentName: 'b1' }]),
      createCell('2026-08-17', 2, [{ teacher: 'B', studentName: 'b2' }, { teacher: '' }]),
      // 火曜: A しかいない → A が席0。
      createCell('2026-08-18', 1, [{ teacher: '' }, { teacher: 'A', studentName: 'a3' }]),
    ]

    const sorted = seatSortCells(cells)

    expect(seatOf(sorted[0], 'B')).toBe(0)
    expect(seatOf(sorted[1], 'B')).toBe(0)
    expect(seatOf(sorted[0], 'A')).toBe(1)
    // 火曜は月曜の割り当てに引きずられない。
    expect(seatOf(sorted[2], 'A')).toBe(0)
  })

  it('机の中身（講師・生徒・出欠記録）は机ごと一緒に動き、講師と生徒の対応が入れ替わらない', () => {
    const cell = createCell('2026-08-17', 1, [{ teacher: 'A', studentName: '生徒A' }, { teacher: 'B', studentName: '生徒B' }])
    cell.desks[1].statusSlots = [{ status: 'attended' } as never, null]
    const cells = [cell, createCell('2026-08-17', 2, [{ teacher: 'B', studentName: '生徒B2' }, { teacher: '' }])]

    const sorted = seatSortCells(cells)

    const deskA = sorted[0].desks.find((desk) => desk.teacher === 'A')
    const deskB = sorted[0].desks.find((desk) => desk.teacher === 'B')
    expect(deskA?.lesson?.studentSlots[0]?.name).toBe('生徒A')
    expect(deskB?.lesson?.studentSlots[0]?.name).toBe('生徒B')
    // 出欠記録は元の机(B)に付いたまま移動する。
    expect(deskB?.statusSlots?.[0]).not.toBeNull()
    expect(deskA?.statusSlots?.[0] ?? null).toBeNull()
  })

  it('机の数は変わらず、席番どおりに id を振り直す', () => {
    const cells = [createCell('2026-08-17', 1, [{ teacher: 'A', studentName: 'a1' }, { teacher: '' }, { teacher: 'B', studentName: 'b1' }])]

    const sorted = seatSortCells(cells)

    expect(sorted[0].desks).toHaveLength(3)
    expect(sorted[0].desks.map((desk) => desk.id)).toEqual([
      '2026-08-17_1_desk_1',
      '2026-08-17_1_desk_2',
      '2026-08-17_1_desk_3',
    ])
  })

  it('表示名しか無い机と講師 id を持つ机が混在しても同一講師として扱う', () => {
    const cells = [
      createCell('2026-08-17', 1, [{ teacher: '' }, { teacher: '山田', studentName: 'y1', teacherId: 't-yamada' }]),
      createCell('2026-08-17', 2, [{ teacher: '' }, { teacher: '山田', studentName: 'y2' }]),
    ]

    const sorted = seatSortCells(cells)

    expect(seatOf(sorted[0], '山田')).toBe(0)
    expect(seatOf(sorted[1], '山田')).toBe(0)
  })

  it('元の配列を書き換えない（非破壊）', () => {
    const cells = [createCell('2026-08-17', 1, [{ teacher: '' }, { teacher: 'A', studentName: 'a1' }])]
    const originalTeachers = cells[0].desks.map((desk) => desk.teacher)

    seatSortCells(cells)

    expect(cells[0].desks.map((desk) => desk.teacher)).toEqual(originalTeachers)
  })
})

describe('packSortCellDesks（上に詰めて並べ替え・移設後の回帰確認）', () => {
  it('埋まっている机を上へ、空の机を下へ詰める', () => {
    const cell = createCell('2026-08-17', 1, [{ teacher: '' }, { teacher: '講師だけ' }, { teacher: 'A', studentName: 'a1' }])

    const packed = packSortCellDesks(cell)

    expect(packed.map((desk) => desk.teacher)).toEqual(['A', '講師だけ', ''])
    expect(packed.map((desk) => desk.id)).toEqual([
      '2026-08-17_1_desk_1',
      '2026-08-17_1_desk_2',
      '2026-08-17_1_desk_3',
    ])
  })
})
