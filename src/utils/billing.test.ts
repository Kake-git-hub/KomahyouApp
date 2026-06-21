import { describe, expect, it } from 'vitest'
import { buildInvoiceNumber, calculateBillingAmounts, countActiveStudentsForBilling, formatBillingMonthLabel, formatJapaneseDate, getBillingDueDate, getBillingMonthDateRange, getBillingSnapshotDate, isBillingAllowedEmail } from './billing'
import type { StudentRow } from '../components/basic-data/basicDataModel'

function student(overrides: Partial<StudentRow>): StudentRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? '生徒',
    displayName: overrides.displayName ?? '',
    email: overrides.email ?? '',
    entryDate: overrides.entryDate ?? '',
    withdrawDate: overrides.withdrawDate ?? '',
    birthDate: overrides.birthDate ?? '',
  }
}

describe('billing utilities', () => {
  it('limits billing access to the allowed developer emails', () => {
    expect(isBillingAllowedEmail('dai.in.the.mood@gmail.com')).toBe(true)
    expect(isBillingAllowedEmail(' BKKDMZN@gmail.com ')).toBe(true)
    expect(isBillingAllowedEmail('d.ishikawa@agc-akasaka.com')).toBe(true)
    expect(isBillingAllowedEmail('manager@example.com')).toBe(false)
  })

  it('uses the 15th as the monthly student-count snapshot date', () => {
    expect(getBillingSnapshotDate('2026-05')).toBe('2026-05-15')
    expect(countActiveStudentsForBilling([
      student({ entryDate: '2026-05-01' }),
      student({ entryDate: '2026-05-16' }),
      student({ withdrawDate: '2026-05-14' }),
      student({ birthDate: '2005-04-02' }), // 高3卒業済み → 非在籍（旧 isHidden 廃止の代替検証）
      student({ withdrawDate: '2026-05-15' }),
    ], '2026-05')).toBe(2)
  })

  it('allows choosing an arbitrary snapshot day and clamps it to the month bounds', () => {
    // 既定は15日（後方互換）。
    expect(getBillingSnapshotDate('2026-05')).toBe('2026-05-15')
    // 任意の集計日を指定できる。
    expect(getBillingSnapshotDate('2026-05', 1)).toBe('2026-05-01')
    expect(getBillingSnapshotDate('2026-05', 20)).toBe('2026-05-20')
    // 月末を超える指定はその月の末日へクランプ（2026年2月は28日）。
    expect(getBillingSnapshotDate('2026-02', 31)).toBe('2026-02-28')
    // 1未満は1日へクランプ。
    expect(getBillingSnapshotDate('2026-05', 0)).toBe('2026-05-01')
  })

  it('counts active students for an overridden snapshot date', () => {
    const students = [
      student({ entryDate: '2026-05-01' }),
      student({ entryDate: '2026-05-16' }),
    ]
    // 既定(15日)では16日入会の生徒は未在籍。
    expect(countActiveStudentsForBilling(students, '2026-05')).toBe(1)
    // 集計日を20日にすると16日入会も在籍にカウントされる。
    expect(countActiveStudentsForBilling(students, '2026-05', '2026-05-20')).toBe(2)
  })

  it('exposes the selectable snapshot-date range for the month', () => {
    expect(getBillingMonthDateRange('2026-05')).toEqual({ min: '2026-05-01', max: '2026-05-31' })
    expect(getBillingMonthDateRange('2026-02')).toEqual({ min: '2026-02-01', max: '2026-02-28' })
  })

  it('sets the payment due date to the end of the next month', () => {
    expect(getBillingDueDate('2026-05')).toBe('2026-06-30')
    expect(getBillingDueDate('2026-12')).toBe('2027-01-31')
    expect(formatJapaneseDate('2027-01-31')).toBe('2027年1月31日')
    expect(formatBillingMonthLabel('2026-05')).toBe('2026年5月分')
  })

  it('calculates amounts with billed amount defaulting to the calculated total', () => {
    expect(calculateBillingAmounts(12, 300)).toEqual({
      studentCount: 12,
      unitPrice: 300,
      calculatedAmount: 3600,
      billedAmount: 3600,
      taxAmount: 360,
      billedAmountWithTax: 3960,
    })
    expect(calculateBillingAmounts(12.8, 300.9, 1000.4)).toEqual({
      studentCount: 12,
      unitPrice: 300,
      calculatedAmount: 3600,
      billedAmount: 1000,
      taxAmount: 100,
      billedAmountWithTax: 1100,
    })
  })

  it('rounds the 10% consumption tax on the billed (tax-exclusive) amount', () => {
    // 7人 × 333円 = 2331円(税抜)、消費税 233.1 → 四捨五入で 233円、税込 2564円。
    expect(calculateBillingAmounts(7, 333)).toEqual({
      studentCount: 7,
      unitPrice: 333,
      calculatedAmount: 2331,
      billedAmount: 2331,
      taxAmount: 233,
      billedAmountWithTax: 2564,
    })
  })

  it('builds stable invoice numbers per classroom and month', () => {
    expect(buildInvoiceNumber('classroom_abc-123', '2026-05')).toBe('INV-202605-CLASSROO')
  })
})