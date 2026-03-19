import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { getMemoLineHeight, getMemoTextMetrics } from '../components/schedule-board/memoText'

type ExportBoardPdfParams = {
  element: HTMLElement
  fileName: string
  title: string
}

function fitMemoTextForPdf(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-student-name-note').forEach((node) => {
    const label = node.textContent ?? ''
    const { fontSize: initialFontSize, lineHeight } = getMemoTextMetrics(label)

    node.style.whiteSpace = 'pre-line'
    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
    node.style.display = '-webkit-box'
    node.style.boxSizing = 'border-box'
    node.style.paddingBottom = '1px'
    node.style.fontSize = `${initialFontSize}px`
    node.style.lineHeight = String(lineHeight)
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
    node.style.width = '34px'
    node.style.minWidth = '34px'
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
    rotatedLabel.style.fontSize = '11px'
    rotatedLabel.style.fontWeight = '700'
    rotatedLabel.style.lineHeight = '1'
    rotatedLabel.style.transform = 'rotate(-90deg)'
    rotatedLabel.style.transformOrigin = 'center center'
    node.style.padding = '0'
    node.style.textAlign = 'center'
    node.style.verticalAlign = 'middle'
    node.appendChild(rotatedLabel)
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-slot').forEach((node) => {
    node.style.fontSize = '13px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-range').forEach((node) => {
    node.style.fontSize = '11px'
    node.style.lineHeight = '1.3'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher').forEach((node) => {
    node.style.minHeight = '62px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    node.style.fontSize = '13px'
    node.style.lineHeight = '1.25'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student').forEach((node) => {
    node.style.minHeight = '62px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((node) => {
    node.style.gap = '4px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-name').forEach((node) => {
    if (node.classList.contains('sa-student-name-note')) {
      const { fontSize, lineHeight } = getMemoTextMetrics(node.textContent ?? '')
      node.style.fontSize = `${fontSize}px`
      node.style.lineHeight = String(lineHeight)
      return
    }

    node.style.fontSize = '13px'
    node.style.lineHeight = '1.2'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-origin-date').forEach((node) => {
    node.style.fontSize = '10px'
    node.style.lineHeight = '1.1'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-detail').forEach((node) => {
    node.style.fontSize = '11px'
    node.style.lineHeight = '1.2'
    node.style.gap = '4px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-star').forEach((node) => {
    node.style.fontSize = '11px'
    node.style.minWidth = '11px'
    node.style.height = '14px'
  })

  exportRoot.appendChild(clone)
  document.body.appendChild(exportRoot)
  fitMemoTextForPdf(exportRoot)

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
  const orientation = 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 2
  const contentWidth = pageWidth - margin * 2
  const contentHeight = pageHeight - margin * 2
  const fitScale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height)
  const renderWidth = canvas.width * fitScale
  const renderHeight = canvas.height * fitScale
  const offsetX = (pageWidth - renderWidth) / 2
  const offsetY = (pageHeight - renderHeight) / 2

  pdf.addImage(imageData, 'PNG', offsetX, offsetY, renderWidth, renderHeight, undefined, 'FAST')

  pdf.save(fileName)
}