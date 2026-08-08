import { describe, expect, it } from 'vitest'
import { buildBillingRows, buildDraftBody } from './BillingAutomationScreen'
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
