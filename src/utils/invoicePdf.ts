import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { formatBillingMonthLabel, formatJapaneseDate, formatYen, getBillingDueDate, type BillingInvoiceRow } from './billing'

export type InvoiceIssuerInfo = {
  name: string
  address: string
  phone: string
  registrationNumber: string
  bankAccount: string
  notes: string
}

const defaultIssuerInfo: InvoiceIssuerInfo = {
  name: 'コマ表アプリ運営事務局',
  address: '',
  phone: '',
  registrationNumber: '',
  bankAccount: '',
  notes: '',
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function optionalLine(label: string, value: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue) return ''
  return `<div><span>${escapeHtmlText(label)}</span>${escapeHtmlText(normalizedValue)}</div>`
}

export function buildInvoiceHtml(row: BillingInvoiceRow, issuerInfo: Partial<InvoiceIssuerInfo> = {}) {
  const issuer = { ...defaultIssuerInfo, ...issuerInfo }
  const issuedAt = formatJapaneseDate(new Date().toISOString().slice(0, 10))
  const dueDate = formatJapaneseDate(getBillingDueDate(row.monthKey))

  return `<div class="billing-invoice-pdf">
  <style>
    .billing-invoice-pdf { width: 794px; min-height: 1123px; box-sizing: border-box; padding: 58px 62px; background: #fff; color: #162033; font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; }
    .billing-invoice-pdf h1 { margin: 0; font-size: 32px; letter-spacing: 0; text-align: center; }
    .billing-invoice-meta { display: grid; grid-template-columns: 1fr auto; gap: 26px; margin-top: 34px; align-items: start; }
    .billing-invoice-recipient { font-size: 20px; font-weight: 700; border-bottom: 2px solid #162033; padding-bottom: 8px; }
    .billing-invoice-issuer { display: grid; gap: 5px; min-width: 270px; font-size: 12px; line-height: 1.55; }
    .billing-invoice-issuer strong { font-size: 16px; }
    .billing-invoice-issuer div { display: grid; grid-template-columns: 76px 1fr; gap: 8px; }
    .billing-invoice-summary { margin-top: 32px; padding: 18px 20px; border: 2px solid #162033; display: grid; grid-template-columns: 1fr auto; align-items: center; }
    .billing-invoice-summary span { color: #4c5b70; font-size: 14px; font-weight: 700; }
    .billing-invoice-summary strong { font-size: 28px; }
    .billing-invoice-table { width: 100%; margin-top: 32px; border-collapse: collapse; font-size: 14px; }
    .billing-invoice-table th, .billing-invoice-table td { border: 1px solid #c8d0dc; padding: 12px 14px; }
    .billing-invoice-table th { background: #edf2f7; text-align: left; }
    .billing-invoice-table td:nth-child(n+2), .billing-invoice-table th:nth-child(n+2) { text-align: right; }
    .billing-invoice-table tfoot td { font-weight: 800; background: #f8fafc; }
    .billing-invoice-details { display: grid; gap: 6px; margin-top: 24px; color: #3c4b60; font-size: 13px; line-height: 1.7; }
    .billing-invoice-note { min-height: 72px; margin-top: 24px; padding: 14px; border: 1px solid #c8d0dc; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
  </style>
  <h1>請求書</h1>
  <div class="billing-invoice-meta">
    <div>
      <div class="billing-invoice-recipient">${escapeHtmlText(row.classroomName || '名称未設定の教室')} 御中</div>
      <div class="billing-invoice-details">
        <div>請求書番号: ${escapeHtmlText(row.invoiceNumber)}</div>
        <div>請求対象: ${escapeHtmlText(formatBillingMonthLabel(row.monthKey))}</div>
        <div>集計基準日: ${escapeHtmlText(formatJapaneseDate(row.snapshotDate))} 0:00時点</div>
        <div>発行日: ${escapeHtmlText(issuedAt)}</div>
        <div>支払期限: ${escapeHtmlText(dueDate)}</div>
      </div>
    </div>
    <div class="billing-invoice-issuer">
      <strong>${escapeHtmlText(issuer.name)}</strong>
      ${optionalLine('住所', issuer.address)}
      ${optionalLine('電話', issuer.phone)}
      ${optionalLine('登録番号', issuer.registrationNumber)}
      ${optionalLine('振込先', issuer.bankAccount)}
    </div>
  </div>
  <div class="billing-invoice-summary"><span>ご請求金額</span><strong>${escapeHtmlText(formatYen(row.billedAmount))}</strong></div>
  <table class="billing-invoice-table">
    <thead><tr><th>項目</th><th>生徒数</th><th>単価</th><th>合計金額</th><th>請求金額</th></tr></thead>
    <tbody><tr><td>${escapeHtmlText(formatBillingMonthLabel(row.monthKey))} 生徒数利用料</td><td>${row.studentCount.toLocaleString('ja-JP')}人</td><td>${escapeHtmlText(formatYen(row.unitPrice))}</td><td>${escapeHtmlText(formatYen(row.calculatedAmount))}</td><td>${escapeHtmlText(formatYen(row.billedAmount))}</td></tr></tbody>
    <tfoot><tr><td colspan="4">合計</td><td>${escapeHtmlText(formatYen(row.billedAmount))}</td></tr></tfoot>
  </table>
  <div class="billing-invoice-note">${escapeHtmlText([issuer.notes, row.memo].filter((entry) => entry.trim()).join('\n'))}</div>
</div>`
}

export async function createInvoicePdfBlob(row: BillingInvoiceRow, issuerInfo?: Partial<InvoiceIssuerInfo>) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-100000px'
  container.style.top = '0'
  container.style.background = '#ffffff'
  container.style.zIndex = '-1'
  container.innerHTML = buildInvoiceHtml(row, issuerInfo)
  document.body.appendChild(container)

  try {
    const invoiceNode = container.firstElementChild as HTMLElement | null
    if (!invoiceNode) throw new Error('請求書PDFの生成対象が見つかりません。')

    const canvas = await html2canvas(invoiceNode, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: Math.ceil(invoiceNode.scrollWidth),
      height: Math.ceil(invoiceNode.scrollHeight),
      windowWidth: Math.ceil(invoiceNode.scrollWidth),
      windowHeight: Math.ceil(invoiceNode.scrollHeight),
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imageData = canvas.toDataURL('image/png')
    pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
    return pdf.output('blob')
  } finally {
    document.body.removeChild(container)
  }
}

export function buildInvoicePdfFileName(row: BillingInvoiceRow) {
  return `請求書_${row.monthKey}_${row.classroomName || row.classroomId}.pdf`.replace(/[\\/:*?"<>|]/g, '_')
}