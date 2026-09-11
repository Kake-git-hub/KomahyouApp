import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../components/schedule-board/types'
import {
  BOARD_PRINT_FULL_CANVAS_SCALE,
  BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE,
  boardPrintCellKey,
  buildBoardPrintGrid,
  clearBoardPrintCells,
  createInitialBoardPrintChecked,
  parseBoardPrintCellKey,
  resolveBoardPrintCanvasScale,
  resolveBoardPrintSelection,
  resolveBoardPrintStudentMaxFontSize,
  selectAllBoardPrintCells,
  toggleBoardPrintCell,
  toggleBoardPrintDayColumn,
  toggleBoardPrintSlotRow,
} from './boardPrintSelection'

function makeCell(dateKey: string, slotNumber: number, isOpenDay = true): SlotCell {
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '月',
    dateLabel: dateKey.slice(5),
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '16:20-17:50',
    isOpenDay,
    desks: [],
  }
}

// 月〜水 × 1〜3限。火曜(2026-09-15)は定休日。
function makeCells(): SlotCell[] {
  const cells: SlotCell[] = []
  for (const [dateKey, isOpenDay] of [['2026-09-14', true], ['2026-09-15', false], ['2026-09-16', true]] as const) {
    for (const slotNumber of [1, 2, 3]) {
      cells.push(makeCell(dateKey, slotNumber, isOpenDay))
    }
  }
  return cells
}

describe('buildBoardPrintGrid', () => {
  it('曜日と時限を盤面の並び順で組み立て、定休日は選択対象に含めない', () => {
    const grid = buildBoardPrintGrid(makeCells())

    expect(grid.days.map((day) => day.dateKey)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(grid.days.map((day) => day.isOpenDay)).toEqual([true, false, true])
    expect(grid.slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 3])
    expect(grid.selectableCellKeys).toHaveLength(6)
    expect(grid.selectableCellKeys.some((key) => key.startsWith('2026-09-15'))).toBe(false)
  })

  it('セルが空でも落ちない', () => {
    const grid = buildBoardPrintGrid([])
    expect(grid.days).toEqual([])
    expect(grid.selectableCellKeys).toEqual([])
  })

  it('セルキーは往復できる', () => {
    const key = boardPrintCellKey('2026-09-14', 3)
    expect(parseBoardPrintCellKey(key)).toEqual({ dateKey: '2026-09-14', slotNumber: 3 })
    expect(parseBoardPrintCellKey('こわれた')).toBeNull()
  })
})

describe('resolveBoardPrintSelection', () => {
  const grid = buildBoardPrintGrid(makeCells())

  it('全選択は間引きなし(定休日の列も残る)で isFullSelection=true', () => {
    const selection = resolveBoardPrintSelection(grid, createInitialBoardPrintChecked(grid))

    expect(selection.isFullSelection).toBe(true)
    expect(selection.isEmpty).toBe(false)
    // 定休日 2026-09-15 も含めた「盤面そのまま」＝従来出力と同一。
    expect(selection.dateKeys).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(selection.slotNumbers).toEqual([1, 2, 3])
    expect(selection.blankCellKeys).toEqual([])
  })

  it('空選択は isEmpty=true で矩形も空', () => {
    const selection = resolveBoardPrintSelection(grid, [])

    expect(selection.isEmpty).toBe(true)
    expect(selection.isFullSelection).toBe(false)
    expect(selection.dateKeys).toEqual([])
    expect(selection.slotNumbers).toEqual([])
  })

  it('1コマだけの選択は 1 曜日 × 1 時限に絞られる', () => {
    const selection = resolveBoardPrintSelection(grid, [boardPrintCellKey('2026-09-16', 2)])

    expect(selection.dateKeys).toEqual(['2026-09-16'])
    expect(selection.slotNumbers).toEqual([2])
    expect(selection.blankCellKeys).toEqual([])
    expect(selection.selectedCellCount).toBe(1)
    expect(selection.selectableCellCount).toBe(6)
    expect(selection.totalDayCount).toBe(3)
    expect(selection.totalSlotCount).toBe(3)
  })

  it('とびとびの選択は矩形を残し、矩形内の未選択セルを空白化対象にする', () => {
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 1),
      boardPrintCellKey('2026-09-16', 3),
    ])

    expect(selection.dateKeys).toEqual(['2026-09-14', '2026-09-16'])
    expect(selection.slotNumbers).toEqual([1, 3])
    expect(selection.blankCellKeys).toEqual([
      boardPrintCellKey('2026-09-14', 3),
      boardPrintCellKey('2026-09-16', 1),
    ])
  })

  it('定休日のキーが混ざっても無視する(定休日の列は復活しない)', () => {
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-15', 1),
      boardPrintCellKey('2026-09-14', 1),
    ])

    expect(selection.selectedCellCount).toBe(1)
    expect(selection.dateKeys).toEqual(['2026-09-14'])
  })

  it('開校日が 1 日も無ければ全選択にならない', () => {
    const closedGrid = buildBoardPrintGrid([makeCell('2026-09-15', 1, false)])
    const selection = resolveBoardPrintSelection(closedGrid, [])

    expect(selection.isFullSelection).toBe(false)
    expect(selection.isEmpty).toBe(true)
  })
})

describe('resolveBoardPrintCanvasScale', () => {
  it('全選択は従来値 1.1 のまま', () => {
    expect(resolveBoardPrintCanvasScale(36, true)).toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
  })

  it('選択が少ないほど解像度を上げ、上限は 3', () => {
    expect(resolveBoardPrintCanvasScale(1)).toBe(3)
    expect(resolveBoardPrintCanvasScale(2)).toBe(3)
    expect(resolveBoardPrintCanvasScale(3)).toBe(2.5)
    expect(resolveBoardPrintCanvasScale(6)).toBe(2.5)
    expect(resolveBoardPrintCanvasScale(7)).toBe(2)
    expect(resolveBoardPrintCanvasScale(12)).toBe(2)
    expect(resolveBoardPrintCanvasScale(13)).toBe(1.5)
    expect(resolveBoardPrintCanvasScale(24)).toBe(1.5)
    expect(resolveBoardPrintCanvasScale(25)).toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
  })

  it('0 以下や NaN は従来値にフォールバックする', () => {
    expect(resolveBoardPrintCanvasScale(0)).toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
    expect(resolveBoardPrintCanvasScale(Number.NaN)).toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
  })
})

describe('resolveBoardPrintStudentMaxFontSize', () => {
  const grid = buildBoardPrintGrid(makeCells())

  it('全選択では従来の上限 34px を動かさない', () => {
    const selection = resolveBoardPrintSelection(grid, createInitialBoardPrintChecked(grid))
    expect(resolveBoardPrintStudentMaxFontSize(selection)).toBe(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE)
  })

  it('列を絞ると上限を残した曜日数の比で緩める(上限 72px)', () => {
    const selection = resolveBoardPrintSelection(grid, [boardPrintCellKey('2026-09-14', 1)])
    // 3 曜日 → 1 曜日 なので 34 * 3 = 102 → 72 で頭打ち。
    expect(resolveBoardPrintStudentMaxFontSize(selection)).toBe(72)
  })

  it('2 曜日残れば 3/2 倍(51px)', () => {
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 1),
      boardPrintCellKey('2026-09-16', 1),
    ])
    expect(resolveBoardPrintStudentMaxFontSize(selection)).toBe(51)
  })
})

describe('選択状態の遷移', () => {
  const grid = buildBoardPrintGrid(makeCells())

  it('初期状態は全選択(＝現状と同一出力)', () => {
    const checked = createInitialBoardPrintChecked(grid)
    expect(checked).toEqual(grid.selectableCellKeys)
    expect(resolveBoardPrintSelection(grid, checked).isFullSelection).toBe(true)
  })

  it('セルのトグルは追加と解除を往復する', () => {
    const key = boardPrintCellKey('2026-09-14', 2)
    const afterOff = toggleBoardPrintCell(grid, createInitialBoardPrintChecked(grid), key)
    expect(afterOff).not.toContain(key)
    const afterOn = toggleBoardPrintCell(grid, afterOff, key)
    expect(afterOn).toEqual(grid.selectableCellKeys)
  })

  it('定休日のセルはトグルできない', () => {
    const checked = toggleBoardPrintCell(grid, [], boardPrintCellKey('2026-09-15', 1))
    expect(checked).toEqual([])
  })

  it('行頭(時限)の一括トグルは全部入っていれば全解除・そうでなければ全選択', () => {
    const cleared = toggleBoardPrintSlotRow(grid, createInitialBoardPrintChecked(grid), 2)
    expect(cleared.some((key) => key.endsWith('__2'))).toBe(false)
    expect(cleared).toHaveLength(4)

    const filled = toggleBoardPrintSlotRow(grid, cleared, 2)
    expect(filled).toEqual(grid.selectableCellKeys)
  })

  it('列頭(曜日)の一括トグルも同様で、定休日列は何も起きない', () => {
    const cleared = toggleBoardPrintDayColumn(grid, createInitialBoardPrintChecked(grid), '2026-09-14')
    expect(cleared.some((key) => key.startsWith('2026-09-14'))).toBe(false)
    expect(cleared).toHaveLength(3)

    const unchanged = toggleBoardPrintDayColumn(grid, cleared, '2026-09-15')
    expect(unchanged).toEqual(cleared)
  })

  it('全選択/全解除', () => {
    expect(selectAllBoardPrintCells(grid)).toEqual(grid.selectableCellKeys)
    expect(clearBoardPrintCells()).toEqual([])
    expect(resolveBoardPrintSelection(grid, clearBoardPrintCells()).isEmpty).toBe(true)
  })

  it('部分選択から 1 つ足して全選択に戻ると間引きなしへ戻る', () => {
    const key = boardPrintCellKey('2026-09-16', 3)
    const partial = toggleBoardPrintCell(grid, createInitialBoardPrintChecked(grid), key)
    expect(resolveBoardPrintSelection(grid, partial).isFullSelection).toBe(false)
    const restored = toggleBoardPrintCell(grid, partial, key)
    expect(resolveBoardPrintSelection(grid, restored).isFullSelection).toBe(true)
  })
})
