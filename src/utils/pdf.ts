import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

type ExportBoardPdfParams = {
  element: HTMLElement
  fileName: string
  title: string
}

export async function exportBoardPdf({ element, fileName, title }: ExportBoardPdfParams) {
  const exportRoot = document.createElement('div')
  exportRoot.style.position = 'fixed'
  exportRoot.style.left = '-100000px'
  exportRoot.style.top = '0'
  exportRoot.style.background = '#ffffff'
  exportRoot.style.padding = '12px'
  exportRoot.style.zIndex = '-1'
  exportRoot.style.width = 'max-content'

  const heading = document.createElement('div')
  heading.textContent = title
  heading.style.fontSize = '28px'
  heading.style.fontWeight = '700'
  heading.style.color = '#16314f'
  heading.style.marginBottom = '12px'
  exportRoot.appendChild(heading)

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
    cloneTable.style.fontSize = '11px'
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
    node.style.padding = '4px 5px'
    node.style.borderColor = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-period-row th').forEach((node) => {
    node.style.height = '24px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-header-row1 th').forEach((node) => {
    node.style.height = '36px'
    node.style.fontSize = '12px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-header-row2 th').forEach((node) => {
    node.style.height = '30px'
    node.style.fontSize = '11px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-col, .sa-year-col, .sa-time-sub-header, .sa-time-cell').forEach((node) => {
    node.style.width = '72px'
    node.style.minWidth = '72px'
    node.style.background = '#f4f4f4'
    node.style.color = '#111111'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-slot').forEach((node) => {
    node.style.fontSize = '11px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-time-range').forEach((node) => {
    node.style.fontSize = '10px'
    node.style.lineHeight = '1.3'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher').forEach((node) => {
    node.style.minHeight = '52px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    node.style.fontSize = '11px'
    node.style.lineHeight = '1.3'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student').forEach((node) => {
    node.style.minHeight = '52px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((node) => {
    node.style.gap = '3px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-name').forEach((node) => {
    node.style.fontSize = '11px'
    node.style.lineHeight = '1.25'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-detail').forEach((node) => {
    node.style.fontSize = '10px'
    node.style.lineHeight = '1.25'
    node.style.gap = '3px'
  })
  clone.querySelectorAll<HTMLElement>('.sa-student-star').forEach((node) => {
    node.style.fontSize = '10px'
    node.style.minWidth = '10px'
    node.style.height = '13px'
  })

  exportRoot.appendChild(clone)
  document.body.appendChild(exportRoot)

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
  const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 6
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