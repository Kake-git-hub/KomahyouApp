import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import type { SlotCell } from '../components/schedule-board/types'

type ExportBoardPdfParams = {
  element: HTMLElement
  fileName: string
  title: string
}

const PDF_SEAT_COLUMN_WIDTH = 30
const PDF_SEAT_FONT_SIZE = 22
const PDF_TEACHER_COLUMN_WIDTH = 54
const PDF_STUDENT_COLUMN_WIDTH = 115.5
const PDF_STUDENT_MAX_FONT_SIZE = 34
const PDF_STUDENT_MIN_FONT_SIZE = 4.8

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

  return nameOverflow || memoOverflow || detailOverflow || heightOverflow
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

function fitStudentTextForPdf(root: HTMLElement) {
  const preparedEntries = prepareStudentTextEntriesForPdf(root)
  if (preparedEntries.length === 0) return

  const initialFontSize = PDF_STUDENT_MAX_FONT_SIZE
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

export async function exportBoardPdf({ element, fileName, title }: ExportBoardPdfParams) {
  void title
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

  const exportWidth = Math.ceil(exportRoot.scrollWidth)
  const exportHeight = Math.ceil(exportRoot.scrollHeight)
  const orientation = 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 3
  const marginY = 4
  const contentWidth = pageWidth - marginX * 2
  const contentHeight = pageHeight - marginY * 2
  const targetExportWidth = resolveTargetExportWidth(
    exportWidth,
    exportHeight,
    contentWidth / contentHeight,
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
  fitStudentTextForPdf(exportRoot)

  const canvas = await html2canvas(exportRoot, {
    backgroundColor: '#ffffff',
    scale: 1.1,
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