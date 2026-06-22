import { describe, expect, it } from 'vitest'
import { buildDraftBody } from './BillingAutomationScreen'
import type { BillingInvoiceRow } from '../../utils/billing'
import type { InvoiceIssuerInfo } from '../../utils/invoicePdf'

const row: BillingInvoiceRow = {
  classroomId: 'c1',
  classroomName: 'テスト教室',
  managerEmail: 'owner@example.com',
  monthKey: '2026-06',
  snapshotDate: '2026-06-15',
  studentCount: 10,
  unitPrice: 300,
  calculatedAmount: 3000,
  billedAmount: 3000,
  taxAmount: 300,
  billedAmountWithTax: 3300,
  invoiceNumber: 'INV-1',
  memo: '',
}

const issuer: InvoiceIssuerInfo = {
  name: '運営事務局',
  address: '',
  phone: '000-0000-0000',
  registrationNumber: '',
  bankAccount: '○○銀行 1234567',
  notes: '',
}

describe('buildDraftBody', () => {
  it('請求日（メール作成日）を「請求日：YYYY年M月D日」形式で本文に含める', () => {
    const body = buildDraftBody(row, issuer, '2026-06-22')
    expect(body).toContain('請求日：2026年6月22日')
  })

  it('請求日は請求金額の直前に置く', () => {
    const body = buildDraftBody(row, issuer, '2026-06-22')
    const lines = body.split('\n')
    const invoiceDateIndex = lines.findIndex((line) => line.startsWith('請求日：'))
    const amountIndex = lines.findIndex((line) => line.startsWith('請求金額（税込）'))
    expect(invoiceDateIndex).toBeGreaterThanOrEqual(0)
    expect(amountIndex).toBe(invoiceDateIndex + 1)
  })
})
