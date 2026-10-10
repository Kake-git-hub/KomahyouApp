import { describe, expect, it } from 'vitest'
import { buildCompanyInvoice, parseCompanyBillingProfile } from './companyBilling'
import { buildCompanyInvoiceHtml, buildCompanyInvoiceMailBody, buildCompanyInvoiceMailSubject, buildCompanyInvoicePdfFileName } from './companyInvoiceHtml'
import type { BillingInvoiceRow } from './billing'

const row = (classroomId: string, classroomName: string, studentCount: number, billedAmount: number): BillingInvoiceRow => ({
  classroomId, classroomName, managerEmail: '', monthKey: '2026-10', snapshotDate: '2026-10-15', studentCount, unitPrice: 300,
  calculatedAmount: studentCount * 300, billedAmount, taxAmount: 0, billedAmountWithTax: 0, invoiceNumber: '', memo: '',
})
const profile = parseCompanyBillingProfile('demo', { companyName: '株式会社<デモ>', billing: { recipientName: '株式会社<デモ> 経理部', recipientEmail: 'k@demo.example.com' } })
const invoice = buildCompanyInvoice({ profile, rows: [row('a', 'あおぞら校', 10, 3000), row('b', 'みどり校', 7, 2100)], monthKey: '2026-10', snapshotDate: '2026-10-15' })

describe('会社宛合算請求書の HTML(P-11 ②)', () => {
  it('宛名は請求先名 御中・教室ごとの明細行と合算・税は合算に 1 回・発行日は JST', () => {
    const html = buildCompanyInvoiceHtml(invoice, { name: '運営', bankAccount: '○○銀行' }, new Date('2026-10-10T16:00:00.000Z'))
    expect(html).toContain('株式会社&lt;デモ&gt; 経理部 御中')
    expect(html).toContain('INV-202610-DEMO-ALL')
    expect(html).toContain('2026年10月分(2教室 合算)')
    expect(html).toContain('<td>あおぞら校</td><td>10人</td>')
    expect(html).toContain('<td>みどり校</td><td>7人</td>')
    expect(html).toContain('<td>17人</td>')
    expect(html).toContain('5,100円')
    expect(html).toContain('510円')
    expect(html).toContain('5,610円')
    // UTC 16:00 = JST 翌日 1:00 → 発行日は 10/11。
    expect(html).toContain('発行日: 2026年10月11日')
    expect(html).toContain('支払期限: 2026年11月30日')
    expect(html).not.toContain('<デモ>')
  })

  it('0 教室でも落ちず「対象の教室がありません」', () => {
    const empty = buildCompanyInvoice({ profile, rows: [], monthKey: '2026-10', snapshotDate: '2026-10-15' })
    expect(buildCompanyInvoiceHtml(empty)).toContain('対象の教室がありません')
  })

  it('ファイル名・件名・本文(教室内訳つき・請求日は請求金額の直前)', () => {
    expect(buildCompanyInvoicePdfFileName(invoice)).toBe('コマ表アプリ請求書_2026-10_株式会社_デモ__合算.pdf')
    expect(buildCompanyInvoiceMailSubject(invoice)).toBe('コマ表アプリ 2026年10月分 請求書（2教室 合算）')
    const body = buildCompanyInvoiceMailBody(invoice, { name: '運営', phone: '000', bankAccount: '○○銀行' }, '2026-10-20')
    const lines = body.split('\n')
    expect(lines[0]).toBe('株式会社<デモ> 経理部 様')
    expect(body).toContain('・あおぞら校: 10人 / 3,000円（税抜）')
    expect(lines.findIndex((line) => line.startsWith('請求金額（税込）'))).toBe(lines.findIndex((line) => line.startsWith('請求日：')) + 1)
    expect(body).toContain('請求金額（税込）: 5,610円')
  })
})
