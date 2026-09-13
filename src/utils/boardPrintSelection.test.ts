import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../components/schedule-board/types'
import {
  BOARD_PRINT_FULL_CANVAS_SCALE,
  BOARD_PRINT_MAX_FONT_RELIEF,
  BOARD_PRINT_MAX_ROW_SCALE,
  BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE,
  applyBoardPrintPattern,
  boardPrintCellKey,
  boardPrintPatternStorageKey,
  boardPrintWeekdayOf,
  buildBoardPrintTitle,
  resolveBoardPrintLayoutRelief,
  resolveBoardPrintStudentMaxFontSizeByRelief,
  serializeBoardPrintPattern,
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
  it('曜日と時限を盤面の並び順で組み立て、定休日も選択対象に含める(p-1・2026-09-12 オーナー指示「日曜も候補に」)', () => {
    const grid = buildBoardPrintGrid(makeCells())

    expect(grid.days.map((day) => day.dateKey)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(grid.days.map((day) => day.isOpenDay)).toEqual([true, false, true])
    expect(grid.slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 3])
    // ⚠️ 定休日(09-15)を選択不可へ戻すと赤くなる(回帰防止)。盤面には定休日の列も出ているので選べる必要がある。
    expect(grid.selectableCellKeys).toHaveLength(9)
    expect(grid.selectableCellKeys.filter((key) => key.startsWith('2026-09-15'))).toHaveLength(3)
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
    expect(selection.selectableCellCount).toBe(9)
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

  it('盤面に無いセルのキーが混ざっても無視する(列は復活しない)', () => {
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-20', 1),
      boardPrintCellKey('2026-09-14', 9),
      boardPrintCellKey('2026-09-14', 1),
    ])

    expect(selection.selectedCellCount).toBe(1)
    expect(selection.dateKeys).toEqual(['2026-09-14'])
  })

  it('定休日だけを選ぶと定休日の列だけが残る(日曜だけ出す)', () => {
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-15', 1),
      boardPrintCellKey('2026-09-15', 2),
      boardPrintCellKey('2026-09-15', 3),
    ])

    expect(selection.isFullSelection).toBe(false)
    expect(selection.dateKeys).toEqual(['2026-09-15'])
    expect(selection.slotNumbers).toEqual([1, 2, 3])
  })

  it('セルが無い盤面では全選択にならない', () => {
    const emptyGrid = buildBoardPrintGrid([])
    const selection = resolveBoardPrintSelection(emptyGrid, [])

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

  it('引数は選択コマ数ではなく「残る矩形サイズ」で渡す想定: 対角5コマ(5曜日×5時限が残る)は 1.1 になる(2.5 に跳ねない)', () => {
    // 5 開校日 × 5 時限の盤面で、対角線上の 5 コマだけを選ぶ(各曜日・各時限に 1 つずつ)。
    // 選択コマ数は 5 だが、間引き後に残る矩形は 5 曜日 × 5 時限 = 25 コマ分。
    const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
    const cells: SlotCell[] = []
    for (const dateKey of days) {
      for (let slotNumber = 1; slotNumber <= 5; slotNumber += 1) {
        cells.push(makeCell(dateKey, slotNumber, true))
      }
    }
    const diagonalGrid = buildBoardPrintGrid(cells)
    const diagonalChecked = days.map((dateKey, index) => boardPrintCellKey(dateKey, index + 1))
    const selection = resolveBoardPrintSelection(diagonalGrid, diagonalChecked)

    expect(selection.selectedCellCount).toBe(5)
    expect(selection.dateKeys).toHaveLength(5)
    expect(selection.slotNumbers).toHaveLength(5)

    const remainingRectCellCount = selection.dateKeys.length * selection.slotNumbers.length
    expect(remainingRectCellCount).toBe(25)
    // 選択コマ数(5)を渡すと誤って 2.5 になってしまうところ、矩形サイズ(25)を渡すと従来値 1.1 になる。
    expect(resolveBoardPrintCanvasScale(remainingRectCellCount)).toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
    expect(resolveBoardPrintCanvasScale(selection.selectedCellCount)).not.toBe(BOARD_PRINT_FULL_CANVAS_SCALE)
  })
})

describe('定数の二重定義解消ロック', () => {
  it('BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE が pdf.ts の正本(34px)のまま(pdf.ts はここから import する)', () => {
    expect(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE).toBe(34)
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

  it('盤面に無いセルはトグルできない(定休日のセルはトグルできる・p-1)', () => {
    expect(toggleBoardPrintCell(grid, [], boardPrintCellKey('2026-09-20', 1))).toEqual([])
    expect(toggleBoardPrintCell(grid, [], boardPrintCellKey('2026-09-15', 1))).toEqual([boardPrintCellKey('2026-09-15', 1)])
  })

  it('行頭(時限)の一括トグルは全部入っていれば全解除・そうでなければ全選択', () => {
    const cleared = toggleBoardPrintSlotRow(grid, createInitialBoardPrintChecked(grid), 2)
    expect(cleared.some((key) => key.endsWith('__2'))).toBe(false)
    expect(cleared).toHaveLength(6)

    const filled = toggleBoardPrintSlotRow(grid, cleared, 2)
    expect(filled).toEqual(grid.selectableCellKeys)
  })

  it('列頭(曜日)の一括トグルも同様で、定休日列も同じように効く(p-1)', () => {
    const cleared = toggleBoardPrintDayColumn(grid, createInitialBoardPrintChecked(grid), '2026-09-14')
    expect(cleared.some((key) => key.startsWith('2026-09-14'))).toBe(false)
    expect(cleared).toHaveLength(6)

    const closedCleared = toggleBoardPrintDayColumn(grid, cleared, '2026-09-15')
    expect(closedCleared.some((key) => key.startsWith('2026-09-15'))).toBe(false)
    expect(closedCleared).toHaveLength(3)
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

// ---- 確認リスト(2026-09-12)で追加した純関数 ----------------------------------------------

describe('resolveBoardPrintLayoutRelief(A3 縦いっぱいに使う倍率・p-2/p-3)', () => {
  const A3_PORTRAIT = 291 / 412

  it('全選択は {1,1,1}(従来出力と同一)', () => {
    expect(resolveBoardPrintLayoutRelief({ naturalWidth: 2000, naturalHeight: 500, pageAspectRatio: A3_PORTRAIT, isFullSelection: true }))
      .toEqual({ rowScale: 1, columnScale: 1, fontRelief: 1 })
  })

  it('不正な寸法は {1,1,1} にフォールバックする', () => {
    expect(resolveBoardPrintLayoutRelief({ naturalWidth: 0, naturalHeight: 500, pageAspectRatio: A3_PORTRAIT })).toEqual({ rowScale: 1, columnScale: 1, fontRelief: 1 })
    expect(resolveBoardPrintLayoutRelief({ naturalWidth: Number.NaN, naturalHeight: 500, pageAspectRatio: A3_PORTRAIT })).toEqual({ rowScale: 1, columnScale: 1, fontRelief: 1 })
  })

  it('表が紙より横長(時限を絞った)なら行を縦に伸ばし、上限は BOARD_PRINT_MAX_ROW_SCALE', () => {
    const relief = resolveBoardPrintLayoutRelief({ naturalWidth: 2000, naturalHeight: 1000, pageAspectRatio: A3_PORTRAIT })
    expect(relief.columnScale).toBe(1)
    expect(relief.rowScale).toBeCloseTo((2000 / 1000) / A3_PORTRAIT, 5)
    expect(relief.fontRelief).toBeCloseTo(Math.min(BOARD_PRINT_MAX_FONT_RELIEF, relief.rowScale), 5)

    const extreme = resolveBoardPrintLayoutRelief({ naturalWidth: 2000, naturalHeight: 100, pageAspectRatio: A3_PORTRAIT })
    expect(extreme.rowScale).toBe(BOARD_PRINT_MAX_ROW_SCALE)
    expect(extreme.fontRelief).toBe(BOARD_PRINT_MAX_FONT_RELIEF)
  })

  it('表が紙より縦長(曜日を絞った)なら列を横に伸ばす(従来の幅合わせ)。文字の緩和は上限 3', () => {
    const relief = resolveBoardPrintLayoutRelief({ naturalWidth: 400, naturalHeight: 3000, pageAspectRatio: A3_PORTRAIT })
    expect(relief.rowScale).toBe(1)
    expect(relief.columnScale).toBeCloseTo(A3_PORTRAIT / (400 / 3000), 5)
    expect(relief.fontRelief).toBe(BOARD_PRINT_MAX_FONT_RELIEF)
  })

  it('文字上限は relief 倍(下限 34px・上限 72px)', () => {
    expect(resolveBoardPrintStudentMaxFontSizeByRelief(1)).toBe(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE)
    expect(resolveBoardPrintStudentMaxFontSizeByRelief(0.5)).toBe(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE)
    expect(resolveBoardPrintStudentMaxFontSizeByRelief(1.5)).toBe(51)
    expect(resolveBoardPrintStudentMaxFontSizeByRelief(10)).toBe(72)
  })
})

describe('buildBoardPrintTitle(選択に応じた PDF タイトル・p-2)', () => {
  const grid = buildBoardPrintGrid(makeCells())
  const weekTitle = '週間予定表9月14日-9月20日'

  it('全選択・空選択は週タイトルのまま', () => {
    expect(buildBoardPrintTitle(weekTitle, grid, resolveBoardPrintSelection(grid, createInitialBoardPrintChecked(grid)))).toBe(weekTitle)
    expect(buildBoardPrintTitle(weekTitle, grid, resolveBoardPrintSelection(grid, []))).toBe(weekTitle)
  })

  it('曜日を絞ると残した曜日で組む(連続は「-」・とびとびは「・」)、時限が全部なら時限は付けない', () => {
    const contiguous = resolveBoardPrintSelection(grid, [1, 2, 3].flatMap((slot) => [boardPrintCellKey('2026-09-14', slot), boardPrintCellKey('2026-09-15', slot)]))
    expect(buildBoardPrintTitle(weekTitle, grid, contiguous)).toBe('予定表9月14日(月)-9月15日(月)')

    const sparse = resolveBoardPrintSelection(grid, [1, 2, 3].flatMap((slot) => [boardPrintCellKey('2026-09-14', slot), boardPrintCellKey('2026-09-16', slot)]))
    expect(buildBoardPrintTitle(weekTitle, grid, sparse)).toBe('予定表9月14日(月)・9月16日(月)')
  })

  it('時限を絞ると週タイトルに時限を添える(連続は「1限-2限」・とびとびは「1限・3限」)', () => {
    const days = ['2026-09-14', '2026-09-15', '2026-09-16']
    const contiguous = resolveBoardPrintSelection(grid, days.flatMap((day) => [boardPrintCellKey(day, 1), boardPrintCellKey(day, 2)]))
    expect(buildBoardPrintTitle(weekTitle, grid, contiguous)).toBe(`${weekTitle} 1限-2限`)

    const sparse = resolveBoardPrintSelection(grid, days.flatMap((day) => [boardPrintCellKey(day, 1), boardPrintCellKey(day, 3)]))
    expect(buildBoardPrintTitle(weekTitle, grid, sparse)).toBe(`${weekTitle} 1限・3限`)
  })

  it('1 コマだけなら曜日と時限の両方が付き、ファイル名に使えない文字を含まない', () => {
    const one = buildBoardPrintTitle(weekTitle, grid, resolveBoardPrintSelection(grid, [boardPrintCellKey('2026-09-16', 2)]))
    expect(one).toBe('予定表9月16日(月) 2限')
    expect(one).not.toMatch(/[\\/:*?"<>|]/u)
  })
})

describe('選択パターンの記憶(教室ごと・曜日×時限・p-1)', () => {
  const grid = buildBoardPrintGrid(makeCells())

  it('保存キーは教室ごとに分かれる', () => {
    expect(boardPrintPatternStorageKey('room-a')).toBe('board-print-selection:room-a')
    expect(boardPrintPatternStorageKey(undefined)).toBe('board-print-selection:default')
  })

  it('dateKey から曜日を引く(不正は null)', () => {
    expect(boardPrintWeekdayOf('2026-09-13')).toBe(0)
    expect(boardPrintWeekdayOf('2026-09-14')).toBe(1)
    expect(boardPrintWeekdayOf('2026/09/14')).toBeNull()
  })

  it('曜日×時限のパターンで保存し、翌週の盤面(別の dateKey)にも同じ形で当たる', () => {
    const checked = [boardPrintCellKey('2026-09-14', 1), boardPrintCellKey('2026-09-16', 3)]
    const raw = serializeBoardPrintPattern(grid, checked)
    expect(JSON.parse(raw)).toEqual({ version: 1, cells: ['1__1', '3__3'] })

    // 翌週(9/21 月・9/22 火・9/23 水)の盤面に当てると、同じ曜日×時限が選ばれる。
    const nextWeek = buildBoardPrintGrid([21, 22, 23].flatMap((date) => [1, 2, 3].map((slot) => makeCell(`2026-09-${date}`, slot))))
    expect(applyBoardPrintPattern(nextWeek, raw)).toEqual([boardPrintCellKey('2026-09-21', 1), boardPrintCellKey('2026-09-23', 3)])
  })

  it('記憶が無い・壊れている・当たるセルが無いときは全選択に戻る(空選択で開かない)', () => {
    const all = createInitialBoardPrintChecked(grid)
    expect(applyBoardPrintPattern(grid, null)).toEqual(all)
    expect(applyBoardPrintPattern(grid, '')).toEqual(all)
    expect(applyBoardPrintPattern(grid, '{broken')).toEqual(all)
    expect(applyBoardPrintPattern(grid, JSON.stringify({ version: 1, cells: ['6__9'] }))).toEqual(all)
    expect(applyBoardPrintPattern(grid, JSON.stringify({ version: 1, cells: 'nope' }))).toEqual(all)
  })

  it('全選択を保存すると次回も全選択になる', () => {
    const raw = serializeBoardPrintPattern(grid, createInitialBoardPrintChecked(grid))
    expect(applyBoardPrintPattern(grid, raw)).toEqual(createInitialBoardPrintChecked(grid))
  })
})
