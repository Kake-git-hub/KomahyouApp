import type { SlotCell } from '../components/schedule-board/types'

// 盤面PDFの「コマ選択」(docs/spec-schedule-pdf.md §I・plan-2026-09-11-five-requests §5)の純関数群。
// UI(モーダル)と DOM 間引き(pdf.ts)はここで決めた選択結果だけを見る。表示ルールの二重管理を避けるため
// 曜日/時限の行列は盤面セル(SlotCell)から組み立て、定休日(isOpenDay=false)は選択対象外とする。
//
// ⚠️ 回帰防止(仕様の要): **全選択(=初期状態)は「間引きなし」** で、従来の exportBoardPdf と
// 1 ドットも変わらない出力にすること。isFullSelection を薄めない・定休日を選択可能に戻さない。

export type BoardPrintDay = {
  dateKey: string
  dateLabel: string
  dayLabel: string
  isOpenDay: boolean
}

export type BoardPrintSlot = {
  slotNumber: number
  slotLabel: string
  timeLabel: string
}

export type BoardPrintGrid = {
  days: BoardPrintDay[]
  slots: BoardPrintSlot[]
  /** 選択できるセル(開校日 × 時限)のキー。定休日は含まない。 */
  selectableCellKeys: string[]
}

export type BoardPrintSelection = {
  /** 出力に残す曜日(盤面の並び順)。 */
  dateKeys: string[]
  /** 出力に残す時限(昇順)。 */
  slotNumbers: number[]
  /** 残した矩形の中で未選択＝空白化するセル。 */
  blankCellKeys: string[]
  /** 選択されたセル数。 */
  selectedCellCount: number
  /** 選択可能セルの総数。 */
  selectableCellCount: number
  /** 盤面の曜日総数(定休日を含む＝間引き前の列数)。 */
  totalDayCount: number
  /** 盤面の時限総数。 */
  totalSlotCount: number
  /** 全選択。true のときは一切間引かない(＝従来出力と同一)。 */
  isFullSelection: boolean
  /** 1 つも選択されていない(出力不可)。 */
  isEmpty: boolean
}

export function boardPrintCellKey(dateKey: string, slotNumber: number): string {
  return `${dateKey}__${slotNumber}`
}

export function parseBoardPrintCellKey(key: string): { dateKey: string; slotNumber: number } | null {
  const separatorIndex = key.lastIndexOf('__')
  if (separatorIndex <= 0) return null
  const dateKey = key.slice(0, separatorIndex)
  const slotNumber = Number(key.slice(separatorIndex + 2))
  if (!dateKey || !Number.isFinite(slotNumber)) return null
  return { dateKey, slotNumber }
}

export function buildBoardPrintGrid(cells: SlotCell[]): BoardPrintGrid {
  const dayMap = new Map<string, BoardPrintDay>()
  const slotMap = new Map<number, BoardPrintSlot>()

  for (const cell of cells) {
    if (!dayMap.has(cell.dateKey)) {
      dayMap.set(cell.dateKey, {
        dateKey: cell.dateKey,
        dateLabel: cell.dateLabel,
        dayLabel: cell.dayLabel,
        isOpenDay: cell.isOpenDay,
      })
    }
    if (!slotMap.has(cell.slotNumber)) {
      slotMap.set(cell.slotNumber, {
        slotNumber: cell.slotNumber,
        slotLabel: cell.slotLabel,
        timeLabel: cell.timeLabel,
      })
    }
  }

  const days = Array.from(dayMap.values())
  const slots = Array.from(slotMap.values()).sort((left, right) => left.slotNumber - right.slotNumber)
  const selectableCellKeys: string[] = []
  for (const day of days) {
    if (!day.isOpenDay) continue
    for (const slot of slots) {
      selectableCellKeys.push(boardPrintCellKey(day.dateKey, slot.slotNumber))
    }
  }

  return { days, slots, selectableCellKeys }
}

function toSelectableSet(grid: BoardPrintGrid): Set<string> {
  return new Set(grid.selectableCellKeys)
}

export function resolveBoardPrintSelection(grid: BoardPrintGrid, checked: Iterable<string>): BoardPrintSelection {
  const selectable = toSelectableSet(grid)
  const checkedSet = new Set<string>()
  for (const key of checked) {
    // 定休日など選択できないセルが混ざっても無視する(UI の取りこぼし対策)。
    if (selectable.has(key)) checkedSet.add(key)
  }

  const totalDayCount = grid.days.length
  const totalSlotCount = grid.slots.length
  const selectableCellCount = selectable.size
  const selectedCellCount = checkedSet.size
  const isEmpty = selectedCellCount === 0
  const isFullSelection = selectableCellCount > 0 && selectedCellCount === selectableCellCount

  if (isFullSelection || isEmpty) {
    // 全選択＝間引きなし(盤面そのまま)。空選択＝出力不可なので矩形も空にする。
    return {
      dateKeys: isFullSelection ? grid.days.map((day) => day.dateKey) : [],
      slotNumbers: isFullSelection ? grid.slots.map((slot) => slot.slotNumber) : [],
      blankCellKeys: [],
      selectedCellCount,
      selectableCellCount,
      totalDayCount,
      totalSlotCount,
      isFullSelection,
      isEmpty,
    }
  }

  const dateKeys = grid.days
    .filter((day) => grid.slots.some((slot) => checkedSet.has(boardPrintCellKey(day.dateKey, slot.slotNumber))))
    .map((day) => day.dateKey)
  const slotNumbers = grid.slots
    .filter((slot) => grid.days.some((day) => checkedSet.has(boardPrintCellKey(day.dateKey, slot.slotNumber))))
    .map((slot) => slot.slotNumber)

  const blankCellKeys: string[] = []
  for (const dateKey of dateKeys) {
    for (const slotNumber of slotNumbers) {
      const key = boardPrintCellKey(dateKey, slotNumber)
      if (!checkedSet.has(key)) blankCellKeys.push(key)
    }
  }

  return {
    dateKeys,
    slotNumbers,
    blankCellKeys,
    selectedCellCount,
    selectableCellCount,
    totalDayCount,
    totalSlotCount,
    isFullSelection,
    isEmpty,
  }
}

/** 全選択時の html2canvas 倍率(＝従来値)。ここを動かすと全選択の出力が変わる。 */
export const BOARD_PRINT_FULL_CANVAS_SCALE = 1.1
export const BOARD_PRINT_MAX_CANVAS_SCALE = 3

// 選択コマが少ないほど 1 コマが紙面で大きく引き伸ばされるため、解像度(html2canvas scale)を上げる。
// 全選択は従来どおり 1.1 固定(出力同一の保証)。
export function resolveBoardPrintCanvasScale(cellCount: number, isFullSelection = false): number {
  if (isFullSelection) return BOARD_PRINT_FULL_CANVAS_SCALE
  if (!Number.isFinite(cellCount) || cellCount <= 0) return BOARD_PRINT_FULL_CANVAS_SCALE
  if (cellCount <= 2) return BOARD_PRINT_MAX_CANVAS_SCALE
  if (cellCount <= 6) return 2.5
  if (cellCount <= 12) return 2
  if (cellCount <= 24) return 1.5
  return BOARD_PRINT_FULL_CANVAS_SCALE
}

/** 従来の生徒文字の上限(px)。全選択では必ずこの値を使う。 */
export const BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE = 34
export const BOARD_PRINT_STUDENT_ABSOLUTE_MAX_FONT_SIZE = 72

// 列を間引くとセルが横に引き伸ばされるので、上限 34px のままだと文字だけ小さく残る。
// 残した曜日数の比で上限を緩める(実際の大きさは pdf.ts 側のはみ出し判定で決まるので、
// 緩めても溢れることはない)。全選択・空選択は従来値のまま。
export function resolveBoardPrintStudentMaxFontSize(selection: BoardPrintSelection): number {
  if (selection.isFullSelection || selection.isEmpty) return BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
  const dayCount = selection.dateKeys.length
  if (dayCount <= 0 || selection.totalDayCount <= 0) return BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
  const relief = selection.totalDayCount / dayCount
  const relaxed = BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE * relief
  return Math.min(BOARD_PRINT_STUDENT_ABSOLUTE_MAX_FONT_SIZE, Math.max(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE, relaxed))
}

// ---- 選択状態(チェック済みキー集合)の遷移 ----------------------------------
// React state は string[] で持つ(比較・テストが容易)。順序は grid の並び(曜日→時限)で正規化する。

function normalizeChecked(grid: BoardPrintGrid, checkedSet: Set<string>): string[] {
  return grid.selectableCellKeys.filter((key) => checkedSet.has(key))
}

export function createInitialBoardPrintChecked(grid: BoardPrintGrid): string[] {
  // 初期状態は全選択(＝現状と同一出力)。
  return [...grid.selectableCellKeys]
}

export function selectAllBoardPrintCells(grid: BoardPrintGrid): string[] {
  return [...grid.selectableCellKeys]
}

export function clearBoardPrintCells(): string[] {
  return []
}

export function toggleBoardPrintCell(grid: BoardPrintGrid, checked: Iterable<string>, key: string): string[] {
  const selectable = toSelectableSet(grid)
  const next = new Set(checked)
  if (!selectable.has(key)) return normalizeChecked(grid, next)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return normalizeChecked(grid, next)
}

function toggleGroup(grid: BoardPrintGrid, checked: Iterable<string>, groupKeys: string[]): string[] {
  const selectable = toSelectableSet(grid)
  const next = new Set(checked)
  const targets = groupKeys.filter((key) => selectable.has(key))
  if (targets.length === 0) return normalizeChecked(grid, next)
  const allChecked = targets.every((key) => next.has(key))
  for (const key of targets) {
    if (allChecked) next.delete(key)
    else next.add(key)
  }
  return normalizeChecked(grid, next)
}

/** 行頭(時限)の一括トグル: その時限が全部選択済みなら全解除、そうでなければ全選択。 */
export function toggleBoardPrintSlotRow(grid: BoardPrintGrid, checked: Iterable<string>, slotNumber: number): string[] {
  return toggleGroup(grid, checked, grid.days.map((day) => boardPrintCellKey(day.dateKey, slotNumber)))
}

/** 列頭(曜日)の一括トグル。 */
export function toggleBoardPrintDayColumn(grid: BoardPrintGrid, checked: Iterable<string>, dateKey: string): string[] {
  return toggleGroup(grid, checked, grid.slots.map((slot) => boardPrintCellKey(dateKey, slot.slotNumber)))
}
