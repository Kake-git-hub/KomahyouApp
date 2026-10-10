// 会社宛合算請求書(P-11 ②)の HTML(純関数・DOM 非依存)。PDF 化は invoicePdf.ts の createCompanyInvoicePdfBlob が
// 教室宛と同じ html2canvas → jsPDF 経路で行う。見た目は教室宛(invoicePdf.ts buildInvoiceHtml)と同じ骨格で、
// 明細が「教室ごとの行 + 合計」になる。
import { formatBillingMonthLabel, formatJapaneseDate, formatYen, getBillingDueDate } from './billing'
import type { CompanyInvoice } from './companyBilling'
import { getJstTodayDateKey } from './jstDate'

export type CompanyInvoiceIssuerInfo = {
  name: string
  address: string
  phone: string
  registrationNumber: string
  bankAccount: string
  notes: string
}

const defaultIssuerInfo: CompanyInvoiceIssuerInfo = {
  name: 'コマ表アプリ運営事務局',
  address: '',
  phone: '',
  registrationNumber: '',
  bankAccount: '',
  notes: '',
}

export function escapeHtmlText(value: string) {
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

export function buildCompanyInvoiceHtml(invoice: CompanyInvoice, issuerInfo: Partial<CompanyInvoiceIssuerInfo> = {}, now: Date = new Date()) {
  const issuer = { ...defaultIssuerInfo, ...issuerInfo }
  // 発行日は日本時間(教室宛と同じ・2026-09-16 の JST 修正を踏襲)。
  const issuedAt = formatJapaneseDate(getJstTodayDateKey(now))
  const dueDate = formatJapaneseDate(getBillingDueDate(invoice.monthKey))
  const monthLabel = formatBillingMonthLabel(invoice.monthKey)
  const lineRows = invoice.lines.map((line) => `<tr><td>${escapeHtmlText(line.classroomName)}</td><td>${line.studentCount.toLocaleString('ja-JP')}人</td><td>${escapeHtmlText(formatYen(line.unitPrice))}</td><td>${escapeHtmlText(formatYen(line.calculatedAmount))}</td><td>${escapeHtmlText(formatYen(line.billedAmount))}</td></tr>`).join('')
  const emptyRow = invoice.lines.length === 0 ? '<tr><td colspan="5">対象の教室がありません</td></tr>' : ''

  return `<div class="billing-invoice-pdf billing-invoice-pdf--company">
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
    .billing-invoice-table { width: 100%; margin-top: 32px; border-collapse: collapse; font-size: 13px; }
    .billing-invoice-table th, .billing-invoice-table td { border: 1px solid #c8d0dc; padding: 10px 12px; }
    .billing-invoice-table th { background: #edf2f7; text-align: left; }
    .billing-invoice-table td:nth-child(n+2), .billing-invoice-table th:nth-child(n+2) { text-align: right; }
    .billing-invoice-table tfoot td { font-weight: 800; background: #f8fafc; }
    .billing-invoice-details { display: grid; gap: 6px; margin-top: 24px; color: #3c4b60; font-size: 13px; line-height: 1.7; }
    .billing-invoice-note { min-height: 72px; margin-top: 24px; padding: 14px; border: 1px solid #c8d0dc; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
  </style>
  <h1>請求書</h1>
  <div class="billing-invoice-meta">
    <div>
      <div class="billing-invoice-recipient">${escapeHtmlText(invoice.recipientName)} 御中</div>
      <div class="billing-invoice-details">
        <div>請求書番号: ${escapeHtmlText(invoice.invoiceNumber)}</div>
        <div>請求対象: ${escapeHtmlText(monthLabel)}(${invoice.lines.length}教室 合算)</div>
        <div>集計基準日: ${escapeHtmlText(formatJapaneseDate(invoice.snapshotDate))} 0:00時点</div>
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
  <div class="billing-invoice-summary"><span>ご請求金額（税込）</span><strong>${escapeHtmlText(formatYen(invoice.billedAmountWithTax))}</strong></div>
  <table class="billing-invoice-table">
    <thead><tr><th>教室（${escapeHtmlText(monthLabel)} 生徒数利用料）</th><th>生徒数</th><th>単価</th><th>合計金額</th><th>請求金額（税抜）</th></tr></thead>
    <tbody>${lineRows}${emptyRow}</tbody>
    <tfoot>
      <tr><td>小計（税抜）</td><td>${invoice.studentCount.toLocaleString('ja-JP')}人</td><td></td><td>${escapeHtmlText(formatYen(invoice.calculatedAmount))}</td><td>${escapeHtmlText(formatYen(invoice.billedAmount))}</td></tr>
      <tr><td colspan="4">消費税（10%）</td><td>${escapeHtmlText(formatYen(invoice.taxAmount))}</td></tr>
      <tr><td colspan="4">合計（税込）</td><td>${escapeHtmlText(formatYen(invoice.billedAmountWithTax))}</td></tr>
    </tfoot>
  </table>
  <div class="billing-invoice-note">${escapeHtmlText(issuer.notes.trim())}</div>
</div>`
}

export function buildCompanyInvoicePdfFileName(invoice: CompanyInvoice) {
  return `コマ表アプリ請求書_${invoice.monthKey}_${invoice.companyName || invoice.workspaceKey}_合算.pdf`.replace(/[\\/:*?"<>|]/g, '_')
}

export function buildCompanyInvoiceMailSubject(invoice: CompanyInvoice) {
  return `コマ表アプリ ${formatBillingMonthLabel(invoice.monthKey)} 請求書（${invoice.lines.length}教室 合算）`
}

export function buildCompanyInvoiceMailBody(invoice: CompanyInvoice, issuer: Pick<CompanyInvoiceIssuerInfo, 'name' | 'phone' | 'bankAccount'>, invoiceDateKey: string) {
  const signatureSeparator = '------------------------------------------'
  return [
    `${invoice.recipientName} 様`,
    'いつも大変お世話になっております。',
    '',
    `コマ表アプリ ${formatBillingMonthLabel(invoice.monthKey)}の請求書（${invoice.lines.length}教室分の合算）を添付いたします。`,
    ...invoice.lines.map((line) => `・${line.classroomName}: ${line.studentCount}人 / ${formatYen(line.billedAmount)}（税抜）`),
    '',
    `請求日：${formatJapaneseDate(invoiceDateKey)}`,
    `請求金額（税込）: ${formatYen(invoice.billedAmountWithTax)}`,
    `支払期限: ${formatJapaneseDate(getBillingDueDate(invoice.monthKey))}`,
    `振込先: ${issuer.bankAccount}`,
    '',
    'ご確認のほど、よろしくお願いいたします。',
    signatureSeparator,
    issuer.name,
    issuer.phone,
    signatureSeparator,
  ].join('\n')
}
