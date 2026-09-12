import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import type { SlotCell } from '../components/schedule-board/types'
import {
  BOARD_PRINT_FULL_CANVAS_SCALE,
  BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE,
  parseBoardPrintCellKey,
  resolveBoardPrintCanvasScale,
  resolveBoardPrintLayoutRelief,
  resolveBoardPrintStudentMaxFontSizeByRelief,
  type BoardPrintSelection,
} from './boardPrintSelection'

type ExportBoardPdfParams = {
  element: HTMLElement
  fileName: string
  title: string
}

const PDF_SEAT_COLUMN_WIDTH = 30
const PDF_SEAT_FONT_SIZE = 22
const PDF_SEAT_MAX_FONT_SIZE = 48
const PDF_TEACHER_COLUMN_WIDTH = 54
const PDF_STUDENT_COLUMN_WIDTH = 115.5
// ⚠️ 正本は boardPrintSelection.ts の BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE(定数二重定義の解消)。
const PDF_STUDENT_MAX_FONT_SIZE = BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE
const PDF_STUDENT_MIN_FONT_SIZE = 4.8
// 講師名・席番号の基準文字サイズ(従来値)。コマ選択で拡大したときは relief 倍を上限にし、
// セルに収まるまで縮める(fitSingleLineTextForPdf)。従来出力(relief=1)は上限がこの値のまま。
const PDF_TEACHER_NAME_FONT_SIZE = 24
const PDF_TEACHER_NAME_MIN_FONT_SIZE = 8
const PDF_DESK_ROW_HEIGHT = 62
const PDF_GROUP_ROW_HEIGHT = 40
// セル padding '2px 3px' の上下ぶん。机行の高さを固定するとき、生徒欄の内側ボックスはこの分だけ低くする。
const PDF_CELL_VERTICAL_PADDING = 4

// コマ選択で拡大したとき、生徒欄の内側(.sa-student-inner)を机行の高さに固定する(確認リスト第2版 p-2/p-3・2026-09-12)。
// 従来は内側の高さが内容任せだったため、緩めた文字上限(最大 72px)まで大きくなった生徒名 2 行が行を押し広げ、
// 「生徒のいる行だけ高く・空席の行は低い」と行高さが揃わなかった。全選択(従来出力)と同じく行の高さは
// 一定にし、生徒文字は fitStudentTextForPdf のはみ出し判定で その高さに収まる範囲まで縮める。
// ⚠️ 全選択では呼ばない(従来出力と 1 ドットも変えないため)。
//
// 確認リスト第3版 p-2/p-3(v1.5.506 の結果・2026-09-13)「文字が大きすぎてセルからはみ出ている」の真因:
// `.sa-student-inner` は flex(column) なので、高さを固定すると子(名前行・学年科目)が flex-shrink で
// 押し潰され、内側の scrollHeight が clientHeight を超えない(= はみ出し判定 `inner.scrollHeight > clientHeight`
// が一度も真にならない)。結果、緩めた上限(最大 72px)のまま文字だけ描かれ、名前と学年科目が重なって見切れた。
// 対策は 2 段: (1) 子の flex-shrink を 0 にして内容どおりの高さを保つ。(2) 判定側は子の高さの合計と
// 固定した高さを直接比べる(`studentInnerContentOverflows`・justify-content:center で上側にはみ出た分が
// scrollHeight に載らない問題も避ける)。data 属性 `data-pdf-locked-height` で「固定した内側」を目印にする。
export const PDF_LOCKED_INNER_HEIGHT_ATTRIBUTE = 'data-pdf-locked-height'

export function lockStudentInnerHeightForPdf(root: HTMLElement, deskRowHeight: number) {
  const innerHeight = Math.max(0, Math.round(deskRowHeight) - PDF_CELL_VERTICAL_PADDING)
  root.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((node) => {
    if (node.closest('tr.sa-group-row')) return
    node.style.height = `${innerHeight}px`
    node.style.maxHeight = `${innerHeight}px`
    node.style.boxSizing = 'border-box'
    node.style.overflow = 'hidden'
    node.setAttribute(PDF_LOCKED_INNER_HEIGHT_ATTRIBUTE, '1')
    Array.from(node.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        child.style.flexShrink = '0'
        child.style.minHeight = '0'
      }
    })
  })
}

/**
 * 固定した生徒欄の内側で、子(名前行・メモ・学年科目)の高さの合計が内側の高さを超えているか。
 * flex の子が押し潰されても、justify-content:center で上下両側にはみ出しても正しく検出する。
 * 固定していない内側(全選択の従来出力)では常に false(= 従来のはみ出し判定だけを使う)。
 */
export function studentInnerContentOverflows(inner: HTMLElement): boolean {
  if (inner.getAttribute(PDF_LOCKED_INNER_HEIGHT_ATTRIBUTE) !== '1') return false
  const available = inner.clientHeight
  if (!(available > 0)) return false
  let total = 0
  Array.from(inner.children).forEach((child) => {
    total += child.getBoundingClientRect().height
  })
  return total > available + 1
}

// 1 行テキスト(講師名・席番号)をセルに収まる最大の文字サイズにする。
// 確認リスト p-3(2026-09-12): 従来は講師名を 24px 固定で overflow:hidden していたため、
// 3 文字の講師名(72px)が講師列(54px)で見切れていた。画面側 fitTeacherTextForBoard と同じ発想で、
// はみ出す間だけ縮める(収まっていれば初期値のまま＝従来出力は不変)。
function fitSingleLineTextForPdf(node: HTMLElement, initialFontSize: number, minimumFontSize: number) {
  if (!node.textContent?.trim()) return
  const box = node.parentElement ?? node
  node.style.whiteSpace = 'nowrap'
  node.style.overflow = 'hidden'
  node.style.textOverflow = 'clip'
  const overflows = () => node.scrollWidth > box.clientWidth + 1 || node.scrollHeight > box.clientHeight + 1
  const apply = (fontSize: number) => {
    node.style.fontSize = `${fontSize}px`
  }
  apply(initialFontSize)
  if (!overflows()) return
  let low = minimumFontSize
  let high = initialFontSize
  for (let index = 0; index < 8; index += 1) {
    const candidate = (low + high) / 2
    apply(candidate)
    if (overflows()) high = candidate
    else low = candidate
  }
  apply(low)
}

function fitTeacherTextForPdf(root: HTMLElement, maxFontSize: number) {
  root.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    fitSingleLineTextForPdf(node, maxFontSize, PDF_TEACHER_NAME_MIN_FONT_SIZE)
  })
}

function resolveTargetExportWidth(currentWidth: number, currentHeight: number, targetAspectRatio: number) {
  if (currentWidth <= 0 || currentHeight <= 0 || targetAspectRatio <= 0) {
    return currentWidth
  }

  return Math.max(currentWidth, Math.ceil(currentHeight * targetAspectRatio))
}

function getPdfMemoLineHeight(fontSize: number) {
  if (fontSize <= 8) return 1.02
  if (fontSize <= 14) return 1
  return 0.98
}

type PreparedStudentTextEntry = {
  cell: HTMLElement | null
  inner: HTMLElement
  nameRow: HTMLElement | null
  nameNode: HTMLElement | null
  originDateNode: HTMLElement | null
  memoNode: HTMLElement | null
  detail: HTMLElement | null
  detailSegments: Array<{ element: HTMLSpanElement; isStar: boolean }> | null
}

function applyStudentTextEntryFontSize(entry: PreparedStudentTextEntry, fontSize: number) {
  const { nameRow, nameNode, originDateNode, memoNode, detail, detailSegments } = entry

  if (nameRow) {
    nameRow.style.gap = '1px'
    nameRow.style.overflow = 'hidden'
  }
  if (memoNode) {
    memoNode.style.fontSize = `${fontSize}px`
    memoNode.style.lineHeight = String(getPdfMemoLineHeight(fontSize))
  }
  if (nameNode) {
    nameNode.style.fontSize = `${fontSize}px`
    nameNode.style.lineHeight = '1'
    nameNode.style.minHeight = '0'
    nameNode.style.whiteSpace = 'nowrap'
    nameNode.style.display = 'inline-block'
    nameNode.style.maxWidth = 'none'
    nameNode.style.overflow = 'visible'
    nameNode.style.textOverflow = 'clip'
  }
  if (originDateNode) {
    originDateNode.style.fontSize = `${fontSize}px`
    originDateNode.style.lineHeight = '1'
    originDateNode.style.minHeight = '0'
    originDateNode.style.whiteSpace = 'nowrap'
    originDateNode.style.display = 'inline-block'
    originDateNode.style.maxWidth = 'none'
    originDateNode.style.overflow = 'visible'
    originDateNode.style.textOverflow = 'clip'
  }
  if (detail && detailSegments) {
    detail.style.fontSize = `${fontSize}px`
    detail.style.lineHeight = '1'
    detail.style.minHeight = '0'
    detailSegments.forEach(({ element, isStar }) => {
      const segmentSize = isStar ? Math.max(fontSize - 1.2, 5.5) : fontSize
      element.style.fontSize = `${segmentSize}px`
      element.style.lineHeight = '1'
      if (isStar) {
        element.style.minWidth = '0'
        element.style.height = `${Math.max(segmentSize + 1, 7)}px`
      }
    })
  }
}

function doesStudentTextEntryOverflow(entry: PreparedStudentTextEntry) {
  const { inner, nameRow, memoNode, detail } = entry
  const nameOverflow = nameRow ? nameRow.scrollWidth > nameRow.clientWidth + 1 : false
  const memoOverflow = memoNode ? memoNode.scrollHeight > memoNode.clientHeight + 1 : false
  const detailOverflow = detail ? detail.scrollWidth > detail.clientWidth + 1 : false
  const heightOverflow = inner.scrollHeight > inner.clientHeight + 1
  // 部分選択で内側の高さを固定したときは、子の高さの合計でも判定する(第3版 p-2/p-3・上記コメント参照)。
  const lockedContentOverflow = studentInnerContentOverflows(inner)

  return nameOverflow || memoOverflow || detailOverflow || heightOverflow || lockedContentOverflow
}

function measureStudentTextEntryFontSize(entry: PreparedStudentTextEntry, initialFontSize: number, minimumFontSize: number) {
  applyStudentTextEntryFontSize(entry, initialFontSize)
  if (!doesStudentTextEntryOverflow(entry)) return initialFontSize

  let low = minimumFontSize
  let high = initialFontSize
  for (let index = 0; index < 8; index += 1) {
    const candidate = (low + high) / 2
    applyStudentTextEntryFontSize(entry, candidate)
    if (doesStudentTextEntryOverflow(entry)) {
      high = candidate
    } else {
      low = candidate
    }
  }

  applyStudentTextEntryFontSize(entry, low)
  return low
}

function compactStudentDetailSegmentsForPdf(node: HTMLElement) {
  const segments = Array.from(node.querySelectorAll<HTMLElement>('.sa-student-detail-prefix, .sa-student-star, .sa-student-detail-grade, .sa-student-detail-subject'))
    .map((entry) => {
      const text = (entry.textContent ?? '').replace(/\s+/gu, '')
      if (!text) return null

      const compactSegment = document.createElement('span')
      compactSegment.className = entry.className
      compactSegment.textContent = text
      compactSegment.style.display = 'inline'
      compactSegment.style.margin = '0'
      compactSegment.style.padding = '0'
      compactSegment.style.minWidth = '0'
      compactSegment.style.whiteSpace = 'nowrap'
      compactSegment.style.flex = '0 0 auto'

      return {
        element: compactSegment,
        isStar: entry.classList.contains('sa-student-star'),
      }
    })
    .filter((entry): entry is { element: HTMLSpanElement; isStar: boolean } => entry !== null)

  if (segments.length === 0) return null

  node.innerHTML = ''
  node.style.display = 'flex'
  node.style.width = '100%'
  node.style.maxWidth = '100%'
  node.style.justifyContent = 'center'
  node.style.alignItems = 'center'
  node.style.whiteSpace = 'nowrap'
  node.style.gap = '0'
  node.style.overflow = 'hidden'
  node.style.textOverflow = 'clip'
  node.style.letterSpacing = '-0.02em'

  segments.forEach(({ element }) => node.appendChild(element))

  return segments
}

function prepareStudentTextEntriesForPdf(root: HTMLElement): PreparedStudentTextEntry[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.sa-student-inner'))
    .map((inner) => {
      const cell = inner.closest<HTMLElement>('.sa-student')
      const nameRow = inner.querySelector<HTMLElement>('.sa-student-name-row')
      const nameNode = nameRow
        ? Array.from(nameRow.querySelectorAll<HTMLElement>('.sa-student-name')).find((entry) => !entry.classList.contains('sa-student-name-note')) ?? null
        : null
      const originDateNode = nameRow?.querySelector<HTMLElement>('.sa-student-origin-date') ?? null
      const memoNode = inner.querySelector<HTMLElement>('.sa-student-name-note')
      const detail = inner.querySelector<HTMLElement>('.sa-student-detail')
      const detailSegments = detail ? compactStudentDetailSegmentsForPdf(detail) : null
      if (!nameNode && !originDateNode && !memoNode && !detailSegments) return null

      if (memoNode) {
        memoNode.style.whiteSpace = 'pre-line'
        memoNode.style.overflow = 'hidden'
        memoNode.style.textOverflow = 'clip'
        memoNode.style.display = '-webkit-box'
        memoNode.style.boxSizing = 'border-box'
        memoNode.style.paddingBottom = '0'
        memoNode.style.letterSpacing = '-0.04em'
        memoNode.style.setProperty('-webkit-box-orient', 'vertical')
        memoNode.style.setProperty('-webkit-line-clamp', '2')
      }

      return {
        cell,
        inner,
        nameRow,
        nameNode,
        originDateNode,
        memoNode,
        detail,
        detailSegments,
      }
    })
    .filter((entry): entry is PreparedStudentTextEntry => entry !== null)
}

function fitStudentTextForPdf(root: HTMLElement, maxFontSize: number = PDF_STUDENT_MAX_FONT_SIZE) {
  const preparedEntries = prepareStudentTextEntriesForPdf(root)
  if (preparedEntries.length === 0) return

  // 全選択(＝従来出力)では必ず PDF_STUDENT_MAX_FONT_SIZE を使う。コマ選択で列を間引いたときだけ
  // 上限を緩める(セルが横に伸びるため)。溢れ判定は従来どおり効くので拡大しすぎることはない。
  const initialFontSize = maxFontSize
  const minimumFontSize = PDF_STUDENT_MIN_FONT_SIZE

  preparedEntries.forEach((entry) => {
    const fontSize = measureStudentTextEntryFontSize(entry, initialFontSize, minimumFontSize)
    applyStudentTextEntryFontSize(entry, fontSize)
  })
}

function applyBoardPdfColumnWidths(table: HTMLElement) {
  const dayCount = table.querySelectorAll('.sa-day-header').length
  if (dayCount <= 0) return

  table.querySelector('colgroup')?.remove()
  const columnGroup = document.createElement('colgroup')
  const widths = [72]
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    widths.push(PDF_SEAT_COLUMN_WIDTH, PDF_TEACHER_COLUMN_WIDTH, PDF_STUDENT_COLUMN_WIDTH, PDF_STUDENT_COLUMN_WIDTH)
  }

  widths.forEach((width) => {
    const column = document.createElement('col')
    column.style.width = `${width}px`
    columnGroup.appendChild(column)
  })
  table.insertBefore(columnGroup, table.firstChild)
  table.style.tableLayout = 'fixed'
  table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`
  table.style.minWidth = table.style.width
}

// 盤面テーブル(クローン)を選択された曜日×時限だけに間引く純関数(DOM 操作のみ・副作用は引数の table に閉じる)。
// (1) 未選択曜日の列(colgroup の 4 本 + すべての data-date-key セル + 帯セルの colSpan) を除去
// (2) 未選択時限の行(tr[data-slot-number]) を除去
// (3) 残った矩形の中で未選択のコマは「構造を残したまま中身を空白化」する
// ⚠️ 全選択・空選択では絶対に呼ばない(従来出力と 1 ドットも変えないため)。
export function pruneBoardTableForSelection(table: HTMLElement, selection: BoardPrintSelection) {
  if (selection.isFullSelection || selection.isEmpty) return

  const includedDays = new Set(selection.dateKeys)
  const includedSlots = new Set(selection.slotNumbers.map((slotNumber) => String(slotNumber)))
  const orderedDayKeys = Array.from(table.querySelectorAll<HTMLElement>('.sa-day-header'))
    .map((header) => header.getAttribute('data-date-key') ?? '')

  // (1-a) colgroup: 先頭 1 本が時間列、以降は曜日ごとに 4 本(席/講師/生徒/生徒)。
  // ⚠️ 実経路では BoardGrid.tsx は colgroup を出力しない(列幅は runBoardPdfExport 内の
  // applyBoardPdfColumnWidths がクローン後に組み直す)ため、この分岐は現状到達しない保険。
  // (合成テーブルを使う pdfBoardPrint.test.ts の「既に colgroup がある場合」テストのために残す。)
  const columnGroup = table.querySelector('colgroup')
  if (columnGroup) {
    const columns = Array.from(columnGroup.children)
    if (columns.length === orderedDayKeys.length * 4 + 1) {
      orderedDayKeys.forEach((dateKey, dayIndex) => {
        if (includedDays.has(dateKey)) return
        for (let offset = 0; offset < 4; offset += 1) {
          columns[1 + dayIndex * 4 + offset].remove()
        }
      })
    }
  }

  // (2) 未選択時限の行ごと除去(時限ラベルの rowSpan セルも同じ行にあるので一緒に消える)。
  table.querySelectorAll<HTMLElement>('tr[data-slot-number]').forEach((row) => {
    if (!includedSlots.has(row.getAttribute('data-slot-number') ?? '')) row.remove()
  })

  // (1-b) 複数曜日にまたがる帯セル(特別講習期間)は残った曜日数で colSpan を組み直す。
  table.querySelectorAll<HTMLElement>('[data-date-keys]').forEach((cell) => {
    const dateKeys = (cell.getAttribute('data-date-keys') ?? '').split(',').filter(Boolean)
    const remaining = dateKeys.filter((dateKey) => includedDays.has(dateKey))
    if (remaining.length === 0) {
      cell.remove()
      return
    }
    cell.setAttribute('data-date-keys', remaining.join(','))
    cell.setAttribute('colspan', String(remaining.length * 4))
  })

  // (1-c) 単一曜日のセル(ヘッダー・集団行・本体)を除去。
  table.querySelectorAll<HTMLElement>('[data-date-key]').forEach((cell) => {
    if (!includedDays.has(cell.getAttribute('data-date-key') ?? '')) cell.remove()
  })

  // (3) 矩形内の未選択コマを空白化(列・行の構造は保つ)。席番号は目印として残し、講師・生徒だけ空にする。
  for (const cellKey of selection.blankCellKeys) {
    const parsed = parseBoardPrintCellKey(cellKey)
    if (!parsed) continue
    const selector = `[data-date-key="${parsed.dateKey}"][data-slot-number="${parsed.slotNumber}"]`
    table.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
      if (!cell.classList.contains('sa-teacher') && !cell.classList.contains('sa-student')) return
      cell.innerHTML = ''
      cell.classList.remove('sa-warning')
      cell.classList.remove('sa-student-picked')
      // sa-print-blank: 空白化したセルを示す目印クラス。専用 CSS は無く(App.css に定義なし)、
      // 見た目は上の innerHTML='' + 警告/選択クラス除去だけで成立している。将来デバッグ用の
      // スタイルフックとして残す(現状は「印だけ付けて何もしない」で意図どおり)。
      cell.classList.add('sa-print-blank')
    })
  }
}

// 盤面PDFの本体。selection が null のときは従来の「表示週まるごと」出力(exportBoardPdf)と完全に同じ。
// selection を渡した場合だけ、クローン側の列/行を間引き・未選択セルを空白化し、解像度と生徒文字の
// 上限を選択数に応じて上げる。⚠️ 全選択は selection を渡さない経路(exportBoardPdf)へ委譲すること。
async function runBoardPdfExport({ element, fileName, title }: ExportBoardPdfParams, selection: BoardPrintSelection | null) {
  void title
  const activeSelection = selection && !selection.isFullSelection && !selection.isEmpty ? selection : null
  const exportRoot = document.createElement('div')
  exportRoot.style.position = 'fixed'
  exportRoot.style.left = '-100000px'
  exportRoot.style.top = '0'
  exportRoot.style.background = '#ffffff'
  exportRoot.style.padding = '0'
  exportRoot.style.zIndex = '-1'
  exportRoot.style.width = 'max-content'

  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelector<HTMLElement>('.lecture-stock-panel')?.remove()
  clone.querySelector<HTMLElement>('.makeup-stock-panel')?.remove()
  const grid = clone.querySelector<HTMLElement>('.slot-adjust-grid')
  const sourceGrid = element.querySelector<HTMLElement>('.slot-adjust-grid')
  const sourceTable = sourceGrid?.querySelector<HTMLElement>('table')
  const cloneTable = grid?.querySelector<HTMLElement>('table')

  if (grid && sourceGrid && sourceTable) {
    grid.style.overflow = 'visible'
    grid.style.maxHeight = 'none'
    grid.style.height = 'auto'
    grid.style.width = 'max-content'
    grid.style.maxWidth = 'none'
    grid.style.display = 'block'
    grid.scrollLeft = 0
    grid.scrollTop = 0
  }

  if (cloneTable && sourceTable) {
    cloneTable.style.width = 'max-content'
    cloneTable.style.minWidth = '0'
    cloneTable.style.fontSize = '13px'
  }

  if (cloneTable) {
    // 列幅(colgroup)は残った曜日数で組み直す必要があるため、必ず間引いてから applyBoardPdfColumnWidths する。
    if (activeSelection) {
      pruneBoardTableForSelection(cloneTable, activeSelection)
    }
    applyBoardPdfColumnWidths(cloneTable)
  }

  clone.querySelectorAll<HTMLElement>('thead th, .sa-time-cell').forEach((cell) => {
    cell.style.position = 'static'
    cell.style.top = 'auto'
    cell.style.left = 'auto'
  })

  clone.querySelectorAll<HTMLElement>('.slot-adjust-grid').forEach((node) => {
    node.style.borderRadius = '0'
    node.style.borderColor = '#111111'
    node.style.background = '#ffffff'
  })
  clone.querySelectorAll<HTMLElement>('.slot-adjust-grid th, .slot-adjust-grid td').forEach((node) => {
    node.style.padding = '2px 3px'
    node.style.borderColor = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('tr.sa-slot-first td, tr.sa-slot-first th').forEach((node) => {
    node.style.borderTopWidth = '3px'
  })
  clone.querySelectorAll<HTMLElement>('tr.sa-slot-last td, tr.sa-slot-last th').forEach((node) => {
    node.style.borderBottomWidth = '3px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-day-group-start, .sa-day-group-header').forEach((node) => {
    node.style.borderLeftWidth = '3px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-day-group-end, .sa-day-group-header').forEach((node) => {
    node.style.borderRightWidth = '3px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-period-row th').forEach((node) => {
    node.style.height = '22px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-header-row1 th').forEach((node) => {
    node.style.height = '54px'
    node.style.fontSize = '26px'
    node.style.fontWeight = '800'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-day-header').forEach((node) => {
    node.style.fontSize = '26px'
    node.style.fontWeight = '800'
    node.style.lineHeight = '1'
  })
  clone.querySelectorAll<HTMLElement>('.sa-header-row2 th').forEach((node) => {
    node.style.height = '34px'
    node.style.fontSize = '12px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-col, .sa-year-col, .sa-time-sub-header, .sa-time-cell').forEach((node) => {
    node.style.width = '78px'
    node.style.minWidth = '78px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-cell').forEach((node) => {
    const slotLabel = node.querySelector<HTMLElement>('.sa-time-slot')?.textContent?.trim() ?? ''
    const rangeLabel = node.querySelector<HTMLElement>('.sa-time-range')?.textContent?.trim() ?? ''
    const rotatedText = [slotLabel, rangeLabel].filter(Boolean).join(' ')

    if (node.classList.contains('sa-group-time-cell')) {
      // 集団行(高さ 40px)の時限ラベル「集団」は横書きにする(確認リスト p-6・2026-09-12)。
      // 通常の時限ラベルと同じ -90° 回転＋36px だと 2 文字で 72px になり、40px の行では見切れる。
      node.innerHTML = ''
      const label = document.createElement('div')
      label.className = 'sa-group-time-label'
      label.textContent = slotLabel || '集団'
      label.style.display = 'block'
      label.style.whiteSpace = 'nowrap'
      label.style.fontSize = '20px'
      label.style.fontWeight = '800'
      label.style.lineHeight = '1'
      label.style.textAlign = 'center'
      node.style.padding = '0'
      node.style.display = 'table-cell'
      node.style.textAlign = 'center'
      node.style.verticalAlign = 'middle'
      node.appendChild(label)
      return
    }

    node.innerHTML = ''
    const rotatedLabel = document.createElement('div')
    rotatedLabel.textContent = rotatedText
    rotatedLabel.style.display = 'inline-block'
    rotatedLabel.style.whiteSpace = 'nowrap'
      rotatedLabel.style.fontSize = '36px'
    rotatedLabel.style.fontWeight = '800'
    rotatedLabel.style.lineHeight = '1'
    rotatedLabel.style.transform = 'rotate(-90deg)'
    rotatedLabel.style.transformOrigin = 'center center'
    node.style.padding = '0'
    node.style.display = 'table-cell'
    node.style.textAlign = 'center'
    node.style.verticalAlign = 'middle'
    rotatedLabel.style.maxWidth = '100%'
    node.appendChild(rotatedLabel)
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-slot').forEach((node) => {
    node.style.fontSize = '20px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-range').forEach((node) => {
    node.style.fontSize = '16px'
    node.style.lineHeight = '1.3'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher').forEach((node) => {
    node.style.height = '62px'
    node.style.minHeight = '62px'
    node.style.width = '50px'
    node.style.maxWidth = '50px'
    node.style.minWidth = '50px'
    node.style.overflow = 'hidden'
  })
  clone.querySelectorAll<HTMLElement>('.sa-seat-header, .sa-seat-number').forEach((node) => {
    node.style.width = `${PDF_SEAT_COLUMN_WIDTH}px`
    node.style.minWidth = `${PDF_SEAT_COLUMN_WIDTH}px`
    node.style.maxWidth = `${PDF_SEAT_COLUMN_WIDTH}px`
    node.style.paddingLeft = '0'
    node.style.paddingRight = '0'
    node.style.fontSize = `${PDF_SEAT_FONT_SIZE}px`
    node.style.fontWeight = '800'
    node.style.lineHeight = '1'
    node.style.letterSpacing = '0'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    node.style.fontSize = '24px'
    node.style.lineHeight = '1.02'
    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student').forEach((node) => {
    node.style.height = '62px'
    node.style.minHeight = '62px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((node) => {
    node.style.gap = '0'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-name').forEach((node) => {
    if (node.classList.contains('sa-student-name-note')) {
      node.style.fontSize = '24px'
      node.style.lineHeight = '1.05'
      return
    }

    node.style.fontSize = '24px'
    node.style.lineHeight = '1.05'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-origin-date').forEach((node) => {
    node.style.fontSize = '24px'
    node.style.lineHeight = '1.05'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-detail').forEach((node) => {
    node.style.fontSize = '24px'
    node.style.lineHeight = '1'
    node.style.gap = '0'
    node.style.whiteSpace = 'nowrap'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-star').forEach((node) => {
    node.style.fontSize = '13px'
    node.style.minWidth = '8px'
    node.style.height = '14px'
  })

  exportRoot.appendChild(clone)
  document.body.appendChild(exportRoot)

  const orientation = 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 3
  const marginY = 4
  const contentWidth = pageWidth - marginX * 2
  const contentHeight = pageHeight - marginY * 2
  const pageAspectRatio = contentWidth / contentHeight

  // コマ選択で間引いた表を A3 縦いっぱいに使う倍率(確認リスト p-2/p-3・2026-09-12)。
  // 表が紙より横長(時限を絞った)なら行を縦に伸ばす。縦長(曜日を絞った)なら従来どおり下の幅合わせで列が伸びる。
  // 文字上限(生徒・講師・席番号)は fontRelief で緩める。全選択は {1,1,1} で従来と同じ。
  const relief = resolveBoardPrintLayoutRelief({
    naturalWidth: exportRoot.scrollWidth,
    naturalHeight: exportRoot.scrollHeight,
    pageAspectRatio,
    isFullSelection: !activeSelection,
  })
  if (relief.rowScale > 1) {
    const deskRowHeight = `${Math.round(PDF_DESK_ROW_HEIGHT * relief.rowScale)}px`
    clone.querySelectorAll<HTMLElement>('.sa-teacher, .sa-student').forEach((node) => {
      if (node.closest('tr.sa-group-row')) return
      node.style.height = deskRowHeight
      node.style.minHeight = deskRowHeight
    })
    const groupRowHeight = `${Math.round(PDF_GROUP_ROW_HEIGHT * relief.rowScale)}px`
    clone.querySelectorAll<HTMLElement>('tr.sa-group-row td').forEach((node) => {
      node.style.height = groupRowHeight
    })
  }
  if (activeSelection) {
    // 生徒欄の内側を机行の高さに固定し、行高さを空席の行と揃える(第2版 p-2/p-3)。
    lockStudentInnerHeightForPdf(clone, PDF_DESK_ROW_HEIGHT * relief.rowScale)
  }
  if (relief.columnScale > 1) {
    // 列が横に伸びるときだけ席番号(本体セル)も拡大する(行だけ伸びるときは席列の幅が変わらないので据え置き)。
    // 上限は机行の高さ(62px)に収まる 48px。ヘッダーの「席」(高さ 34px)は据え置き。
    const seatFontSize = Math.min(PDF_SEAT_MAX_FONT_SIZE, PDF_SEAT_FONT_SIZE * Math.min(relief.columnScale, relief.fontRelief))
    clone.querySelectorAll<HTMLElement>('.sa-seat-number').forEach((node) => {
      if (node.closest('tr.sa-group-row')) return
      node.style.fontSize = `${seatFontSize}px`
    })
  }

  const exportWidth = Math.ceil(exportRoot.scrollWidth)
  const exportHeight = Math.ceil(exportRoot.scrollHeight)
  const targetExportWidth = resolveTargetExportWidth(
    exportWidth,
    exportHeight,
    pageAspectRatio,
  )

  if (targetExportWidth > exportRoot.scrollWidth + 1) {
    clone.style.width = `${targetExportWidth}px`
    clone.style.maxWidth = 'none'

    if (grid) {
      grid.style.width = `${targetExportWidth}px`
    }

    if (cloneTable) {
      cloneTable.style.width = `${targetExportWidth}px`
      cloneTable.style.minWidth = `${targetExportWidth}px`
    }
  }

  // Fit after final PDF table width is known; otherwise student text is measured
  // against the pre-expanded table and stays unnecessarily small.
  void exportRoot.offsetWidth
  fitStudentTextForPdf(exportRoot, activeSelection ? resolveBoardPrintStudentMaxFontSizeByRelief(relief.fontRelief) : PDF_STUDENT_MAX_FONT_SIZE)
  // 講師名は従来の 24px を上限(拡大時は relief 倍)にし、列幅に収まらない名前だけ縮める(p-2/p-3)。
  fitTeacherTextForPdf(exportRoot, PDF_TEACHER_NAME_FONT_SIZE * relief.fontRelief)

  const canvas = await html2canvas(exportRoot, {
    backgroundColor: '#ffffff',
    scale: activeSelection
      // 解像度の基準は「選択したコマ数」ではなく「間引き後に残る矩形の面積(曜日数 × 時限数)」。
      // 対角選択(例: 5曜日×5時限を選ぶがコマ自体は5つ)でも出力される矩形は 25 コマ分あるため、
      // selectedCellCount だと過剰に解像度を上げてしまう(参照: boardPrintSelection.test.ts)。
      ? resolveBoardPrintCanvasScale(activeSelection.dateKeys.length * activeSelection.slotNumbers.length, false)
      : BOARD_PRINT_FULL_CANVAS_SCALE,
    useCORS: true,
    logging: false,
    width: Math.ceil(exportRoot.scrollWidth),
    height: Math.ceil(exportRoot.scrollHeight),
    windowWidth: Math.ceil(exportRoot.scrollWidth),
    windowHeight: Math.ceil(exportRoot.scrollHeight),
  })

  document.body.removeChild(exportRoot)

  const imageData = canvas.toDataURL('image/png')
  const renderScale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height)
  const renderWidth = canvas.width * renderScale
  const renderHeight = canvas.height * renderScale
  const offsetX = (pageWidth - renderWidth) / 2
  const offsetY = (pageHeight - renderHeight) / 2

  pdf.addImage(imageData, 'PNG', offsetX, offsetY, renderWidth, renderHeight, undefined, 'FAST')

  pdf.save(fileName)
}

// 従来どおりの盤面PDF出力(表示週まるごと)。★無改変の入口として残す(全選択はここへ委譲する)。
export async function exportBoardPdf(params: ExportBoardPdfParams) {
  await runBoardPdfExport(params, null)
}

// コマ選択つきの盤面PDF出力。全選択は従来出力へ委譲するので「初期状態＝現状と同一」が保たれる。
// 空選択は docs/spec-schedule-pdf.md §I-0 のとおり「出力不可」なので何もしない(no-op)。
// ⚠️ 呼び出し側(UI)は空選択で「出力」ボタンを無効化する想定だが、防御的にここでも何も出力しない。
export async function exportBoardPdfSelection(params: ExportBoardPdfParams, selection: BoardPrintSelection) {
  if (selection.isEmpty) return
  if (selection.isFullSelection) {
    await exportBoardPdf(params)
    return
  }
  await runBoardPdfExport(params, selection)
}

const dayLabels = ['日', '月', '火', '水', '木', '金', '土'] as const

type OverwriteReportRow = {
  dateLabel: string
  slotLabel: string
  deskIndex: number
  category: string
  studentName: string
  subject: string
  detail: string
}

function collectOverwriteReportRows(
  weeks: SlotCell[][],
  effectiveStartDate: string,
  resolveDisplayName: (name: string) => string,
): OverwriteReportRow[] {
  const rows: OverwriteReportRow[] = []

  const statusLabel = (status: string) => {
    if (status === 'attended') return '出席'
    if (status === 'absent') return '欠席(振替あり)'
    if (status === 'absent-no-makeup') return '振無休'
    if (status === 'moved') return '移動元'
    return status
  }
  const lessonTypeLabel = (type: string) => {
    if (type === 'makeup') return '振替'
    if (type === 'special') return '講習'
    if (type === 'regular') return '通常'
    if (type === 'extra') return '増コマ'
    return type
  }

  for (const week of weeks) {
    for (const cell of week) {
      if (cell.dateKey < effectiveStartDate) continue
      const date = new Date(cell.dateKey + 'T00:00:00')
      const dateLabel = `${cell.dateKey} (${dayLabels[date.getDay()]})`

      for (let deskIdx = 0; deskIdx < cell.desks.length; deskIdx++) {
        const desk = cell.desks[deskIdx]

        // Collect status entries (attended/absent/absent-no-makeup)
        if (desk.statusSlots) {
          for (const entry of desk.statusSlots) {
            if (!entry) continue
            rows.push({
              dateLabel,
              slotLabel: cell.slotLabel,
              deskIndex: deskIdx + 1,
              category: '出欠実績',
              studentName: resolveDisplayName(entry.name),
              subject: entry.subject,
              detail: `${statusLabel(entry.status)} / ${lessonTypeLabel(entry.lessonType)}`,
            })
          }
        }

        // Collect non-regular students (makeup / special / manualAdded)
        if (desk.lesson) {
          for (const student of desk.lesson.studentSlots) {
            if (!student) continue
            if (student.lessonType === 'regular' && !student.manualAdded) continue
            const parts: string[] = [lessonTypeLabel(student.lessonType)]
            if (student.manualAdded) parts.push('手入力')
            if (student.makeupSourceLabel) parts.push(`元: ${student.makeupSourceLabel}`)
            rows.push({
              dateLabel,
              slotLabel: cell.slotLabel,
              deskIndex: deskIdx + 1,
              category: student.manualAdded ? '手入力生徒' : lessonTypeLabel(student.lessonType),
              studentName: resolveDisplayName(student.name),
              subject: student.subject,
              detail: parts.join(' / '),
            })
          }

          // Collect lesson note/memo
          if (desk.lesson.note && desk.lesson.note !== '管理データ反映') {
            rows.push({
              dateLabel,
              slotLabel: cell.slotLabel,
              deskIndex: deskIdx + 1,
              category: '授業メモ',
              studentName: '',
              subject: '',
              detail: desk.lesson.note,
            })
          }
        }

        // Collect desk memoSlots
        if (desk.memoSlots) {
          for (let slotIdx = 0; slotIdx < desk.memoSlots.length; slotIdx++) {
            const memo = desk.memoSlots[slotIdx]
            if (!memo) continue
            rows.push({
              dateLabel,
              slotLabel: cell.slotLabel,
              deskIndex: deskIdx + 1,
              category: 'メモ',
              studentName: `スロット${slotIdx + 1}`,
              subject: '',
              detail: memo,
            })
          }
        }

        // Collect manual teacher assignments
        if (desk.manualTeacher && desk.teacher) {
          rows.push({
            dateLabel,
            slotLabel: cell.slotLabel,
            deskIndex: deskIdx + 1,
            category: '手入力講師',
            studentName: '',
            subject: '',
            detail: desk.teacher,
          })
        }
      }
    }
  }

  return rows
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildOverwriteReportHtml(rows: OverwriteReportRow[], effectiveStartDate: string): string {
  const headerRow = '<tr><th>日付</th><th>コマ</th><th>机</th><th>種別</th><th>生徒名</th><th>科目</th><th>詳細</th></tr>'
  const bodyRows = rows.map((row) =>
    `<tr><td>${escapeHtmlText(row.dateLabel)}</td><td>${escapeHtmlText(row.slotLabel)}</td><td>${row.deskIndex}</td><td>${escapeHtmlText(row.category)}</td><td>${escapeHtmlText(row.studentName)}</td><td>${escapeHtmlText(row.subject)}</td><td>${escapeHtmlText(row.detail)}</td></tr>`
  ).join('')

  return `<div style="font-family:'Hiragino Sans','Meiryo','sans-serif';padding:16px;background:#fff;">
<h2 style="margin:0 0 8px;font-size:16px;">テンプレート上書き削除データ一覧</h2>
<p style="margin:0 0 12px;font-size:12px;color:#555;">反映日: ${escapeHtmlText(effectiveStartDate)} 以降 / 出力日時: ${new Date().toLocaleString('ja-JP')} / ${rows.length}件</p>
${rows.length === 0
    ? '<p style="font-size:13px;color:#888;">削除される通常授業以外のデータはありません。</p>'
    : `<table style="border-collapse:collapse;width:100%;font-size:11px;">
<thead style="background:#f0f0f0;">${headerRow}</thead>
<tbody>${bodyRows}</tbody>
</table>`}
<style>
th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;white-space:nowrap;}
td:last-child{white-space:normal;max-width:300px;word-break:break-all;}
</style>
</div>`
}

export async function exportTemplateOverwriteReport(params: {
  weeks: SlotCell[][]
  effectiveStartDate: string
  resolveDisplayName: (name: string) => string
}): Promise<void> {
  const rows = collectOverwriteReportRows(params.weeks, params.effectiveStartDate, params.resolveDisplayName)
  const html = buildOverwriteReportHtml(rows, params.effectiveStartDate)

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-100000px'
  container.style.top = '0'
  container.style.background = '#ffffff'
  container.style.zIndex = '-1'
  container.style.width = 'max-content'
  container.innerHTML = html
  document.body.appendChild(container)

  const canvas = await html2canvas(container, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    width: Math.ceil(container.scrollWidth),
    height: Math.ceil(container.scrollHeight),
    windowWidth: Math.ceil(container.scrollWidth),
    windowHeight: Math.ceil(container.scrollHeight),
  })

  document.body.removeChild(container)

  const orientation = canvas.width > canvas.height ? 'landscape' as const : 'portrait' as const
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 6
  const marginY = 6
  const contentWidth = pageWidth - marginX * 2
  const contentHeight = pageHeight - marginY * 2

  const totalPages = Math.ceil(canvas.height / (canvas.width * (contentHeight / contentWidth)))

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage()
    const sliceHeight = canvas.width * (contentHeight / contentWidth)
    const sourceY = page * sliceHeight
    const actualSliceHeight = Math.min(sliceHeight, canvas.height - sourceY)
    if (actualSliceHeight <= 0) break

    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = Math.ceil(actualSliceHeight)
    const ctx = sliceCanvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(canvas, 0, sourceY, canvas.width, actualSliceHeight, 0, 0, canvas.width, actualSliceHeight)

    const sliceImage = sliceCanvas.toDataURL('image/png')
    const renderWidth = contentWidth
    const renderHeight = (actualSliceHeight / canvas.width) * contentWidth
    pdf.addImage(sliceImage, 'PNG', marginX, marginY, renderWidth, renderHeight, undefined, 'FAST')
  }

  const dateLabel = params.effectiveStartDate.replace(/-/g, '')
  pdf.save(`テンプレ上書き削除データ_${dateLabel}.pdf`)
}