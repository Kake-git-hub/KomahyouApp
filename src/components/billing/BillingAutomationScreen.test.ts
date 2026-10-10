import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildBillingRows, buildCompanyInvoiceFromRecords, buildDraftBody } from './BillingAutomationScreen'
import { parseCompanyBillingProfile } from '../../utils/companyBilling'
import type { BillingInvoiceRow } from '../../utils/billing'
import type { InvoiceIssuerInfo } from '../../utils/invoicePdf'
import type { BillingClassroomRecord } from '../../integrations/firebase/billingStore'
import type { StudentCountLedgerEntry } from '../../integrations/firebase/studentCountLedger'

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

// 請求行の生徒数がどこから来るかの回帰防止。
// 台帳(恒久記録)がある日付では記録値、無い日付では現在の名簿からのライブ計算。
// 「保存済みの billingMonths.studentCount を表示に使う」への逆戻り(既存ガードの巻き戻し)も
// ここで検出する。
describe('buildBillingRows の生徒数の出どころ', () => {
  const students = [
    { id: 's001', name: '在籍 太郎', displayName: '在籍', email: '', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20' },
    { id: 's002', name: '退塾 花子', displayName: '退塾', email: '', entryDate: '2024-04-01', withdrawDate: '2026-05-31', birthDate: '2011-05-20' },
  ]

  const classrooms = [{
    id: 'c1',
    name: 'テスト教室',
    contractStatus: 'active',
    contractStartDate: '2024-04-01',
    contractEndDate: '',
    managerUserId: 'u1',
    data: { students },
  }] as unknown as Parameters<typeof buildBillingRows>[0]['classrooms']

  const users = [{ id: 'u1', name: '管理者', email: 'owner@example.com', role: 'manager' }] as unknown as Parameters<typeof buildBillingRows>[0]['users']

  const savedRecord: BillingClassroomRecord = {
    classroomId: 'c1',
    classroomName: 'テスト教室',
    managerEmail: 'owner@example.com',
    monthKey: '2026-06',
    snapshotDate: '2026-06-15',
    studentCount: 999, // 画面操作で上書きされ得る可変値。表示には絶対に使わない。
    unitPrice: 300,
    calculatedAmount: 0,
    billedAmount: 300,
    taxAmount: 30,
    billedAmountWithTax: 330,
    invoiceNumber: 'INV-1',
    memo: '',
    updatedAt: '2026-06-15T00:00:00.000Z',
    updatedBy: 'u1',
  }

  function ledger(studentCount: number): StudentCountLedgerEntry {
    return {
      snapshotDate: '2026-06-15',
      monthKey: '2026-06',
      classroomCount: 1,
      studentCountTotal: studentCount,
      recordedAt: '2026-06-15T00:10:00.000Z',
      source: 'scheduled',
      countByClassroomId: {
        c1: {
          classroomId: 'c1',
          classroomName: 'テスト教室',
          snapshotDate: '2026-06-15',
          monthKey: '2026-06',
          studentCount,
          recordedAt: '2026-06-15T00:10:00.000Z',
        },
      },
    }
  }

  const baseParams = { classrooms, users, monthKey: '2026-06' as const, snapshotDate: '2026-06-15', records: [] }

  it('恒久記録がある日付では記録値を使い、金額も記録値で計算する', () => {
    // 名簿からのライブ計算は1人(s002は退塾済み)。記録は当時の5人。
    const [row] = buildBillingRows({ ...baseParams, ledgerEntry: ledger(5) })
    expect(row.studentCount).toBe(5)
    expect(row.studentCountSource).toBe('ledger')
    expect(row.liveStudentCount).toBe(1)
    expect(row.hasStudentCountDrift).toBe(true)
    expect(row.calculatedAmount).toBe(5 * 300)
  })

  it('恒久記録が無い日付ではライブ計算へフォールバックする', () => {
    const [row] = buildBillingRows({ ...baseParams, ledgerEntry: null })
    expect(row.studentCount).toBe(1)
    expect(row.studentCountSource).toBe('live')
    expect(row.hasStudentCountDrift).toBe(false)
  })

  it('保存済み billingMonths の studentCount は表示にも金額にも使わない(既存ガードの維持)', () => {
    const [row] = buildBillingRows({ ...baseParams, records: [savedRecord], ledgerEntry: null })
    expect(row.studentCount).not.toBe(999)
    expect(row.studentCount).toBe(1)
  })

  it('記録があれば保存済みレコードがあっても記録値が勝つ', () => {
    const [row] = buildBillingRows({ ...baseParams, records: [savedRecord], ledgerEntry: ledger(5) })
    expect(row.studentCount).toBe(5)
    expect(row.studentCountSource).toBe('ledger')
  })

  it('台帳に載っていない教室だけライブ計算になる(教室単位で出どころを判定する)', () => {
    const entry = ledger(5)
    delete entry.countByClassroomId.c1
    const [row] = buildBillingRows({ ...baseParams, ledgerEntry: entry })
    expect(row.studentCountSource).toBe('live')
    expect(row.studentCount).toBe(1)
  })
})

const storedRecordBase: BillingClassroomRecord = {
  classroomId: 'c1', classroomName: 'テスト教室', managerEmail: '', monthKey: '2026-10', snapshotDate: '2026-10-15', studentCount: 1,
  unitPrice: 300, calculatedAmount: 300, billedAmount: 300, taxAmount: 30, billedAmountWithTax: 330, invoiceNumber: 'INV-1', memo: '',
  updatedAt: '2026-10-15T00:00:00.000Z', updatedBy: 'u1',
}

// P-11 ①(2026-10-10): 単価は 保存済み行 > 教室 studentUnitPrice > 会社の標準単価(棟の文書) > 既定 300 円。
describe('buildBillingRows の単価(会社の標準単価・P-11 ①)', () => {
  const students = [{ id: 's001', name: '在籍 太郎', displayName: '在籍', email: '', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20' }]
  const classroom = (studentUnitPrice?: number) => [{
    id: 'c1', name: 'テスト教室', contractStatus: 'active', contractStartDate: '2024-04-01', contractEndDate: '', managerUserId: 'u1', studentUnitPrice, data: { students },
  }] as unknown as Parameters<typeof buildBillingRows>[0]['classrooms']
  const users = [] as unknown as Parameters<typeof buildBillingRows>[0]['users']
  const base = { users, monthKey: '2026-10' as const, snapshotDate: '2026-10-15', records: [], ledgerEntry: null }
  const company = parseCompanyBillingProfile('demo', { companyName: '株式会社デモ', billing: { standardUnitPrice: 350 } })

  it('教室単価が無ければ会社の標準単価、それも無ければ 300 円(既存運営会社 main は棟に標準単価が無い = 従来どおり)', () => {
    expect(buildBillingRows({ ...base, classrooms: classroom(undefined), companyProfile: company })[0].unitPrice).toBe(350)
    expect(buildBillingRows({ ...base, classrooms: classroom(undefined), companyProfile: parseCompanyBillingProfile('main', {}) })[0].unitPrice).toBe(300)
    expect(buildBillingRows({ ...base, classrooms: classroom(undefined) })[0].unitPrice).toBe(300)
  })

  it('教室の studentUnitPrice は会社の標準単価より優先(教室で上書き・§7-13)', () => {
    expect(buildBillingRows({ ...base, classrooms: classroom(320), companyProfile: company })[0].unitPrice).toBe(320)
  })

  it('保存済みの請求行の単価が最優先', () => {
    const record = { ...storedRecordBase, unitPrice: 280 }
    expect(buildBillingRows({ ...base, classrooms: classroom(320), records: [record], companyProfile: company })[0].unitPrice).toBe(280)
  })
})

// P-11 ③: 全社タブは各社の保存済み請求行から合算する(他社の名簿は読まない)。
describe('buildCompanyInvoiceFromRecords(保存済み請求行 → 会社宛合算)', () => {
  it('保存済みの生徒数・単価・請求額をそのまま合算し、月が違う行は混ぜない', () => {
    const profile = parseCompanyBillingProfile('demo', { companyName: '株式会社デモ' })
    const records = [
      { ...storedRecordBase, classroomId: 'a', classroomName: 'A校', studentCount: 4, unitPrice: 300, billedAmount: 1200 },
      { ...storedRecordBase, classroomId: 'b', classroomName: 'B校', studentCount: 6, unitPrice: 350, billedAmount: 2000 },
      { ...storedRecordBase, classroomId: 'c', classroomName: 'C校', monthKey: '2026-09', studentCount: 9, unitPrice: 300, billedAmount: 2700 },
    ]
    const invoice = buildCompanyInvoiceFromRecords({ profile, records, monthKey: '2026-10', snapshotDate: '2026-10-15' })
    expect(invoice.lines.map((line) => [line.classroomName, line.studentCount, line.unitPrice, line.billedAmount])).toEqual([['A校', 4, 300, 1200], ['B校', 6, 350, 2000]])
    expect(invoice.studentCount).toBe(10)
    expect(invoice.billedAmount).toBe(3200)
    expect(invoice.taxAmount).toBe(320)
    expect(invoice.companyName).toBe('株式会社デモ')
  })

  it('恒久記録がある教室はその記録値を生徒数にし、無い教室は保存時の値(記録 > 保存・レビュー所見 2026-10-10)', () => {
    const profile = parseCompanyBillingProfile('demo', { companyName: '株式会社デモ' })
    const records = [
      { ...storedRecordBase, classroomId: 'a', classroomName: 'A校', studentCount: 4, billedAmount: 1200 },
      { ...storedRecordBase, classroomId: 'b', classroomName: 'B校', studentCount: 6, billedAmount: 1800 },
    ]
    const ledgerEntry: StudentCountLedgerEntry = {
      snapshotDate: '2026-10-15', monthKey: '2026-10', classroomCount: 1, studentCountTotal: 9, recordedAt: '2026-10-15T00:10:00.000Z', source: 'scheduled',
      countByClassroomId: { a: { classroomId: 'a', classroomName: 'A校', snapshotDate: '2026-10-15', monthKey: '2026-10', studentCount: 9, recordedAt: '2026-10-15T00:10:00.000Z' } },
    }
    const invoice = buildCompanyInvoiceFromRecords({ profile, records, monthKey: '2026-10', snapshotDate: '2026-10-15', ledgerEntry })
    expect(invoice.lines.map((line) => [line.classroomName, line.studentCount])).toEqual([['A校', 9], ['B校', 6]])
    // 金額は保存値のまま。
    expect(invoice.billedAmount).toBe(3000)
  })
})

// 配線の固定(source-scan): 許可判定はフラグ経路つきの isBillingAllowedUser・タブ 2 つ・会社宛合算ボタン。
describe('BillingAutomationScreen の配線(P-11)', () => {
  const source = readFileSync(fileURLToPath(new URL('./BillingAutomationScreen.tsx', import.meta.url)), 'utf8')

  it('許可判定は isBillingAllowedUser(フラグ または メール固定)で、isBillingAllowedEmail 直書きへ戻さない', () => {
    expect(source).toContain('const canUseBilling = isBillingAllowedUser(currentUser)')
    expect(source).not.toContain("isBillingAllowedEmail(currentUser.email)")
  })

  it('「この会社」「全社」タブと会社宛合算請求書ボタンがある', () => {
    expect(source).toContain('data-billing-tab="company"')
    expect(source).toContain('data-billing-tab="all"')
    expect(source).toContain('data-billing-company-invoice="true"')
    expect(source).toContain('listFirebaseBillingWorkspaces()')
  })
})
