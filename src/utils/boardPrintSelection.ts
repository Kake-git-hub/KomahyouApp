import type { SlotCell } from '../components/schedule-board/types'

// 盤面PDFの「コマ選択」(docs/spec-schedule-pdf.md §I・plan-2026-09-11-five-requests §5)の純関数群。
// UI(モーダル)と DOM 間引き(pdf.ts)はここで決めた選択結果だけを見る。表示ルールの二重管理を避けるため
// 曜日/時限の行列は盤面セル(SlotCell)から組み立てる。
// 定休日(isOpenDay=false)も選択対象に含める(確認リスト p-1・オーナー指示 2026-09-12「日曜も候補に」)。
// 盤面には定休日の列も出ている(全選択の出力にも含まれる)ので、選べないと「日曜だけ出す」ができなかった。
//
// ⚠️ 回帰防止(仕様の要): **全選択(=初期状態)は「間引きなし」** で、従来の exportBoardPdf と
// 同一の出力にすること。isFullSelection を薄めない。

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
  /** 選択できるセル(全曜日 × 時限)のキー。定休日も含む(p-1・2026-09-12)。 */
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
    // 定休日も選択可(p-1)。isOpenDay は UI の見た目(薄く表示)にだけ使う。
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

// 残る矩形(間引き後に紙面へ出る曜日数 × 時限数)が小さいほど 1 コマが紙面で大きく引き伸ばされるため、
// 解像度(html2canvas scale)を上げる。⚠️ 引数は「選択コマ数」ではなく「残る矩形サイズ」で渡すこと
// (対角選択のように選択コマ数は少なくても矩形が大きいケースで過剰に解像度を上げないため。
// 呼び出し側は pdf.ts の `selection.dateKeys.length * selection.slotNumbers.length`)。
// 全選択は従来どおり 1.1 固定(出力同一の保証)。
export function resolveBoardPrintCanvasScale(remainingRectCellCount: number, isFullSelection = false): number {
  if (isFullSelection) return BOARD_PRINT_FULL_CANVAS_SCALE
  if (!Number.isFinite(remainingRectCellCount) || remainingRectCellCount <= 0) return BOARD_PRINT_FULL_CANVAS_SCALE
  if (remainingRectCellCount <= 2) return BOARD_PRINT_MAX_CANVAS_SCALE
  if (remainingRectCellCount <= 6) return 2.5
  if (remainingRectCellCount <= 12) return 2
  if (remainingRectCellCount <= 24) return 1.5
  return BOARD_PRINT_FULL_CANVAS_SCALE
}

/** 従来の生徒文字の上限(px)。全選択では必ずこの値を使う。 */
export const BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE = 34
export const BOARD_PRINT_STUDENT_ABSOLUTE_MAX_FONT_SIZE = 72

// 列を間引くとセルが横に引き伸ばされるので、上限 34px のままだと文字だけ小さく残る。
// 拡大率(relief)の分だけ上限を緩める(実際の大きさは pdf.ts 側のはみ出し判定で決まるので、
// 緩めても溢れることはない)。relief<=1 は従来値のまま。
export function resolveBoardPrintStudentMaxFontSizeByRelief(relief: number): number {
  if (!Number.isFinite(relief) || relief <= 1) return BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
  const relaxed = BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE * relief
  return Math.min(BOARD_PRINT_STUDENT_ABSOLUTE_MAX_FONT_SIZE, Math.max(BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE, relaxed))
}

// 残した曜日数の比で上限を緩める(列の間引きだけを見る旧式。pdf.ts は resolveBoardPrintLayoutRelief の
// fontRelief を使うので、こちらは互換用に残す)。全選択・空選択は従来値のまま。
export function resolveBoardPrintStudentMaxFontSize(selection: BoardPrintSelection): number {
  if (selection.isFullSelection || selection.isEmpty) return BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
  const dayCount = selection.dateKeys.length
  if (dayCount <= 0 || selection.totalDayCount <= 0) return BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
  return resolveBoardPrintStudentMaxFontSizeByRelief(selection.totalDayCount / dayCount)
}

// ---- 間引き後の紙面レイアウト(A3 縦いっぱいに拡大するための倍率) ----------------------
// 確認リスト p-2/p-3(2026-09-12): 「曜日を絞ると A3 縦いっぱいに拡大」「講師名のサイズも追従」「見切れない」。
// 間引き後の表(自然寸法 naturalWidth × naturalHeight)を A3 縦(pageAspectRatio = 幅/高さ)に収めるとき、
//  - 表が紙より縦長(曜日を絞った)なら、列を横に伸ばして幅を合わせる(columnScale > 1・従来どおり)。
//  - 表が紙より横長(時限を絞った)なら、行を縦に伸ばして高さを合わせる(rowScale > 1・新規)。
//    従来は横長のとき幅基準で縮小されるだけで、下半分が白紙・文字も従来サイズのままだった。
//  - fontRelief = 伸ばした倍率(上限 BOARD_PRINT_MAX_FONT_RELIEF)。生徒・講師・席番号の文字上限をこの倍率で
//    緩める。実際の大きさはセルに収まるかのはみ出し判定で決まるので、緩めても見切れない。
// 全選択は {1,1,1}(＝従来出力と同一)。
export type BoardPrintLayoutRelief = {
  rowScale: number
  columnScale: number
  fontRelief: number
}

export const BOARD_PRINT_MAX_ROW_SCALE = 4
export const BOARD_PRINT_MAX_FONT_RELIEF = 3

const NO_RELIEF: BoardPrintLayoutRelief = { rowScale: 1, columnScale: 1, fontRelief: 1 }

export function resolveBoardPrintLayoutRelief(params: {
  naturalWidth: number
  naturalHeight: number
  pageAspectRatio: number
  isFullSelection?: boolean
}): BoardPrintLayoutRelief {
  const { naturalWidth, naturalHeight, pageAspectRatio } = params
  if (params.isFullSelection) return NO_RELIEF
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || !Number.isFinite(pageAspectRatio)) return NO_RELIEF
  if (naturalWidth <= 0 || naturalHeight <= 0 || pageAspectRatio <= 0) return NO_RELIEF
  const aspect = naturalWidth / naturalHeight
  if (aspect > pageAspectRatio) {
    const rowScale = Math.min(BOARD_PRINT_MAX_ROW_SCALE, aspect / pageAspectRatio)
    return { rowScale, columnScale: 1, fontRelief: Math.min(BOARD_PRINT_MAX_FONT_RELIEF, rowScale) }
  }
  const columnScale = pageAspectRatio / aspect
  return { rowScale: 1, columnScale, fontRelief: Math.min(BOARD_PRINT_MAX_FONT_RELIEF, Math.max(1, columnScale)) }
}

// ---- 選択に応じた PDF タイトル(ファイル名) -------------------------------------------
// 確認リスト p-2(2026-09-12): 「PDF タイトルは選択した日時コマに適したものに」。
// 全選択は従来の週タイトル(例: 週間予定表9月14日-9月20日)のまま。部分選択は残した曜日と時限で組む。
//  - 曜日: 連続なら「9月14日(月)-9月16日(水)」、とびとびなら「9月14日(月)・9月16日(水)」。全曜日なら週タイトルの日付部を流用。
//  - 時限: 全時限なら付けない。連続なら「1限-3限」、とびとびなら「1限・3限」。
// ファイル名にも使うので「/」「\」などは入れない(「・」「-」「()」のみ)。

function formatBoardPrintDayLabel(day: BoardPrintDay): string {
  const parts = day.dateKey.split('-')
  const month = Number(parts[1])
  const date = Number(parts[2])
  const base = Number.isFinite(month) && Number.isFinite(date) && parts.length === 3 ? `${month}月${date}日` : day.dateLabel
  return day.dayLabel ? `${base}(${day.dayLabel})` : base
}

function isContiguousInOrder<T>(all: readonly T[], picked: readonly T[]): boolean {
  if (picked.length <= 1) return true
  const first = all.indexOf(picked[0])
  if (first < 0) return false
  for (let index = 1; index < picked.length; index += 1) {
    if (all[first + index] !== picked[index]) return false
  }
  return true
}

function joinRange(labels: string[], contiguous: boolean): string {
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  return contiguous ? `${labels[0]}-${labels[labels.length - 1]}` : labels.join('・')
}

export function buildBoardPrintTitle(weekTitle: string, grid: BoardPrintGrid, selection: BoardPrintSelection): string {
  if (selection.isFullSelection || selection.isEmpty) return weekTitle

  const allDayKeys = grid.days.map((day) => day.dateKey)
  const pickedDays = grid.days.filter((day) => selection.dateKeys.includes(day.dateKey))
  const allSlotNumbers = grid.slots.map((slot) => slot.slotNumber)
  const pickedSlots = grid.slots.filter((slot) => selection.slotNumbers.includes(slot.slotNumber))

  const dayPart = pickedDays.length === grid.days.length
    ? weekTitle
    : `予定表${joinRange(pickedDays.map(formatBoardPrintDayLabel), isContiguousInOrder(allDayKeys, pickedDays.map((day) => day.dateKey)))}`
  const slotPart = pickedSlots.length === grid.slots.length
    ? ''
    : ` ${joinRange(pickedSlots.map((slot) => slot.slotLabel), isContiguousInOrder(allSlotNumbers, pickedSlots.map((slot) => slot.slotNumber)))}`
  return `${dayPart}${slotPart}`
}

// ---- 選択の記憶(教室ごと・曜日×時限のパターン) -------------------------------------------
// 確認リスト p-1(2026-09-12): 「一度選択したグリッド状態は次回以降もデフォルトとして教室ごとに保持」。
// 週が変わると dateKey も変わるので、記憶は「曜日(0=日〜6=土) × 時限番号」のパターンで持つ。
// 保存先は localStorage(端末内・教室別キー)。本番データ(Firestore)には一切書かない。
// 読み出し結果が空(記憶した時限が今の盤面に無い等)なら全選択に戻す(空選択で開かない)。
export const BOARD_PRINT_PATTERN_STORAGE_PREFIX = 'board-print-selection'

export function boardPrintPatternStorageKey(classroomStorageKey: string | null | undefined): string {
  return `${BOARD_PRINT_PATTERN_STORAGE_PREFIX}:${classroomStorageKey || 'default'}`
}

export function boardPrintWeekdayOf(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return null
  return date.getDay()
}

function boardPrintPatternKey(weekday: number, slotNumber: number): string {
  return `${weekday}__${slotNumber}`
}

export function serializeBoardPrintPattern(grid: BoardPrintGrid, checked: Iterable<string>): string {
  const checkedSet = new Set(checked)
  const weekdayByDate = new Map(grid.days.map((day) => [day.dateKey, boardPrintWeekdayOf(day.dateKey)] as const))
  const cells: string[] = []
  for (const key of grid.selectableCellKeys) {
    if (!checkedSet.has(key)) continue
    const parsed = parseBoardPrintCellKey(key)
    if (!parsed) continue
    const weekday = weekdayByDate.get(parsed.dateKey)
    if (weekday === null || weekday === undefined) continue
    cells.push(boardPrintPatternKey(weekday, parsed.slotNumber))
  }
  return JSON.stringify({ version: 1, cells: Array.from(new Set(cells)) })
}

export function applyBoardPrintPattern(grid: BoardPrintGrid, raw: unknown): string[] {
  const all = createInitialBoardPrintChecked(grid)
  if (typeof raw !== 'string' || !raw.trim()) return all
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return all
  }
  const cells = parsed && typeof parsed === 'object' && Array.isArray((parsed as { cells?: unknown }).cells)
    ? ((parsed as { cells: unknown[] }).cells.filter((entry): entry is string => typeof entry === 'string'))
    : null
  if (!cells) return all
  const pattern = new Set(cells)
  const checked = grid.selectableCellKeys.filter((key) => {
    const cell = parseBoardPrintCellKey(key)
    if (!cell) return false
    const weekday = boardPrintWeekdayOf(cell.dateKey)
    return weekday !== null && pattern.has(boardPrintPatternKey(weekday, cell.slotNumber))
  })
  return checked.length > 0 ? checked : all
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
