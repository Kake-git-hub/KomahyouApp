import { isActiveOnDate, type StudentRow } from '../components/basic-data/basicDataModel'

export const BILLING_ALLOWED_EMAILS = ['dai.in.the.mood@gmail.com', 'bkkdmzn@gmail.com', 'd.ishikawa@agc-akasaka.com'] as const

export type BillingAllowedEmail = typeof BILLING_ALLOWED_EMAILS[number]

export type BillingMonthKey = `${number}-${string}`

export type BillingInvoiceRow = {
  classroomId: string
  classroomName: string
  managerEmail: string
  monthKey: BillingMonthKey
  snapshotDate: string
  studentCount: number
  unitPrice: number
  calculatedAmount: number
  billedAmount: number
  taxAmount: number
  billedAmountWithTax: number
  invoiceNumber: string
  memo: string
}

export function isBillingAllowedEmail(email: string | null | undefined): email is BillingAllowedEmail {
  const normalizedEmail = email?.trim().toLowerCase() ?? ''
  return BILLING_ALLOWED_EMAILS.includes(normalizedEmail as BillingAllowedEmail)
}

export function getCurrentBillingMonthKey(now = new Date()): BillingMonthKey {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}` as BillingMonthKey
}

export function normalizeBillingMonthKey(value: string, fallback: BillingMonthKey = getCurrentBillingMonthKey()): BillingMonthKey {
  if (/^\d{4}-\d{2}$/.test(value)) return value as BillingMonthKey
  return fallback
}

export const DEFAULT_BILLING_SNAPSHOT_DAY = 15

// 集計基準日。既定は毎月15日だが、任意の日を指定できる（月末を超える指定はその月の末日にクランプ）。
export function getBillingSnapshotDate(monthKey: string, day: number = DEFAULT_BILLING_SNAPSHOT_DAY) {
  const normalizedMonthKey = normalizeBillingMonthKey(monthKey)
  const [yearText, monthText] = normalizedMonthKey.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate()
  const requestedDay = Number.isFinite(day) ? Math.trunc(day) : DEFAULT_BILLING_SNAPSHOT_DAY
  const clampedDay = Math.min(Math.max(1, requestedDay), lastDayOfMonth)
  return `${normalizedMonthKey}-${String(clampedDay).padStart(2, '0')}`
}

// 集計日に選べる日付の範囲（対象月の初日〜末日）。<input type="date"> の min/max 用。
export function getBillingMonthDateRange(monthKey: string) {
  return {
    min: getBillingSnapshotDate(monthKey, 1),
    max: getBillingSnapshotDate(monthKey, 31),
  }
}

export function getBillingDueDate(monthKey: string) {
  const normalizedMonthKey = normalizeBillingMonthKey(monthKey)
  const [yearText, monthText] = normalizedMonthKey.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const dueDate = new Date(year, monthIndex + 2, 0)
  const dueYear = dueDate.getFullYear()
  const dueMonth = String(dueDate.getMonth() + 1).padStart(2, '0')
  const dueDay = String(dueDate.getDate()).padStart(2, '0')
  return `${dueYear}-${dueMonth}-${dueDay}`
}

export function formatJapaneseDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-')
  if (!year || !month || !day) return dateKey
  return `${Number(year)}年${Number(month)}月${Number(day)}日`
}

export function formatBillingMonthLabel(monthKey: string) {
  const normalizedMonthKey = normalizeBillingMonthKey(monthKey)
  const [year, month] = normalizedMonthKey.split('-')
  return `${Number(year)}年${Number(month)}月分`
}

export const TAX_RATE = 0.1

export function formatYen(value: number) {
  const normalizedValue = Number.isFinite(value) ? Math.round(value) : 0
  return `${normalizedValue.toLocaleString('ja-JP')}円`
}

export function countActiveStudentsForBilling(students: StudentRow[], monthKey: string, snapshotDateOverride?: string) {
  const snapshotDate = snapshotDateOverride ?? getBillingSnapshotDate(monthKey)
  return students.filter((student) => isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, snapshotDate)).length
}

export function buildInvoiceNumber(classroomId: string, monthKey: string) {
  const normalizedClassroomId = classroomId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'CLASS'
  return `INV-${normalizeBillingMonthKey(monthKey).replace('-', '')}-${normalizedClassroomId}`
}

export function calculateBillingAmounts(studentCount: number, unitPrice: number, billedAmount?: number | null) {
  const normalizedStudentCount = Math.max(0, Math.trunc(Number.isFinite(studentCount) ? studentCount : 0))
  const normalizedUnitPrice = Math.max(0, Math.trunc(Number.isFinite(unitPrice) ? unitPrice : 0))
  const calculatedAmount = normalizedStudentCount * normalizedUnitPrice
  const normalizedBilledAmount = Math.max(0, Math.trunc(Number.isFinite(billedAmount ?? NaN) ? Number(billedAmount) : calculatedAmount))
  const taxAmount = Math.round(normalizedBilledAmount * TAX_RATE)
  const billedAmountWithTax = normalizedBilledAmount + taxAmount

  return {
    studentCount: normalizedStudentCount,
    unitPrice: normalizedUnitPrice,
    calculatedAmount,
    billedAmount: normalizedBilledAmount,
    taxAmount,
    billedAmountWithTax,
  }
}