import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { getMemoLineHeight } from '../components/schedule-board/memoText'

type ExportBoardPdfParams = {
  element: HTMLElement
  fileName: string
  title: string
}

function resolveTargetExportWidth(currentWidth: number, currentHeight: number, targetAspectRatio: number) {
  if (currentWidth <= 0 || currentHeight <= 0 || targetAspectRatio <= 0) {
    return currentWidth
  }

  return Math.max(currentWidth, Math.ceil(currentHeight * targetAspectRatio))
}

function fitMemoTextForPdf(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-student-name-note').forEach((node) => {
    const initialFontSize = 24

    node.style.whiteSpace = 'pre-line'
    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
    node.style.display = '-webkit-box'
    node.style.boxSizing = 'border-box'
    node.style.paddingBottom = '1px'
    node.style.fontSize = `${initialFontSize}px`
    node.style.lineHeight = '1.2'
    node.style.setProperty('-webkit-box-orient', 'vertical')
    node.style.setProperty('-webkit-line-clamp', '2')

    let fontSize = initialFontSize
    while (node.scrollHeight > node.clientHeight + 1 && fontSize > 4.5) {
      fontSize -= 0.4
      node.style.fontSize = `${fontSize}px`
      node.style.lineHeight = String(getMemoLineHeight(fontSize))
    }
  })
}

function fitStudentDetailTextForPdf(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-student-detail').forEach((node) => {
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

    if (segments.length === 0) return

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

    let fontSize = 14
    const applyFontSizes = () => {
      node.style.fontSize = `${fontSize}px`
      node.style.lineHeight = '1'
      segments.forEach(({ element, isStar }) => {
        const segmentFontSize = isStar ? Math.max(fontSize - 1.2, 5.2) : fontSize
        element.style.fontSize = `${segmentFontSize}px`
        element.style.lineHeight = '1'
        if (isStar) {
          element.style.minWidth = '0'
          element.style.height = `${Math.max(segmentFontSize + 1, 7)}px`
        }
      })
    }

    applyFontSizes()
    while (node.scrollWidth > node.clientWidth + 1 && fontSize > 5.8) {
      fontSize -= 0.25
      applyFontSizes()
    }
  })
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
    grid.style.width = `${Math.ceil(sourceTable.scrollWidth)}px`
    grid.style.maxWidth = 'none'
    grid.style.display = 'block'
    grid.scrollLeft = 0
    grid.scrollTop = 0
  }

  if (cloneTable && sourceTable) {
    cloneTable.style.width = `${Math.ceil(sourceTable.scrollWidth)}px`
    cloneTable.style.minWidth = `${Math.ceil(sourceTable.scrollWidth)}px`
    cloneTable.style.fontSize = '13px'
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
    node.style.padding = '6px 7px'
    node.style.borderColor = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-period-row th').forEach((node) => {
    node.style.height = '22px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-header-row1 th').forEach((node) => {
    node.style.height = '38px'
    node.style.fontSize = '14px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
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
    rotatedLabel.style.fontSize = '20px'
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
    node.style.minHeight = '62px'
    node.style.width = '50px'
    node.style.maxWidth = '50px'
    node.style.minWidth = '50px'
    node.style.overflow = 'hidden'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    node.style.fontSize = '20px'
    node.style.lineHeight = '1.25'
    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student').forEach((node) => {
    node.style.minHeight = '62px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((node) => {
    node.style.gap = '1px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-name').forEach((node) => {
    if (node.classList.contains('sa-student-name-note')) {
      node.style.fontSize = '20px'
      node.style.lineHeight = '1.2'
      return
    }

    node.style.fontSize = '20px'
    node.style.lineHeight = '1.2'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-origin-date').forEach((node) => {
    node.style.fontSize = '18px'
    node.style.lineHeight = '1.1'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-detail').forEach((node) => {
    node.style.fontSize = '14px'
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
  fitMemoTextForPdf(exportRoot)
  fitStudentDetailTextForPdf(exportRoot)

  const orientation = 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 3
  const marginY = 4
  const contentWidth = pageWidth - marginX * 2
  const contentHeight = pageHeight - marginY * 2
  const targetExportWidth = resolveTargetExportWidth(
    Math.ceil(exportRoot.scrollWidth),
    Math.ceil(exportRoot.scrollHeight),
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

  const canvas = await html2canvas(exportRoot, {
    backgroundColor: '#ffffff',
    scale: 2,
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