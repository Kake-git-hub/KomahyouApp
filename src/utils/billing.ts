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

// 既定の集計日。サーバーの恒久記録(studentCountLedger)もこの日に記録するので、
// 変えるときは functions/src/monthlyStudentCount.ts の
// MONTHLY_STUDENT_COUNT_SNAPSHOT_DAY と schedule も揃えること(片方だけ変えない)。
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

// 生徒数の出どころ。
//  - 'ledger': 毎月15日 0:00(JST)にサーバーが記録した恒久記録。過去を遡っても動かない確定値。
//  - 'live':   記録が無い日付なので、現在の名簿からその集計日で再計算した暫定値。
//              名簿から生徒を消したり入退塾日を直すと結果が変わるため、過去日では当時と食い違い得る。
export type BillingStudentCountSource = 'ledger' | 'live'

export type ResolvedBillingStudentCount = {
  studentCount: number
  source: BillingStudentCountSource
  ledgerStudentCount: number | null
  liveStudentCount: number
  // 記録値と現在の再計算値が食い違っているか(記録後に名簿を直した痕跡)。請求額は記録値で出す。
  hasDrift: boolean
}

// 恒久記録があればそれを請求の根拠にし、無ければライブ計算へフォールバックする。
// ⚠️ 記録があるときにライブ値を採用しない。名簿を後から直しても過去の請求根拠が動かないことが
//    この台帳の目的そのもの(オーナー指示 2026-08-08)。
export function resolveBillingStudentCount(params: {
  ledgerStudentCount?: number | null
  liveStudentCount: number
}): ResolvedBillingStudentCount {
  const normalizedLiveCount = Math.max(0, Math.trunc(Number.isFinite(params.liveStudentCount) ? params.liveStudentCount : 0))
  const rawLedgerCount = params.ledgerStudentCount
  const hasLedgerCount = typeof rawLedgerCount === 'number' && Number.isFinite(rawLedgerCount)
  if (!hasLedgerCount) {
    return {
      studentCount: normalizedLiveCount,
      source: 'live',
      ledgerStudentCount: null,
      liveStudentCount: normalizedLiveCount,
      hasDrift: false,
    }
  }

  const normalizedLedgerCount = Math.max(0, Math.trunc(rawLedgerCount))
  return {
    studentCount: normalizedLedgerCount,
    source: 'ledger',
    ledgerStudentCount: normalizedLedgerCount,
    liveStudentCount: normalizedLiveCount,
    hasDrift: normalizedLedgerCount !== normalizedLiveCount,
  }
}

// 今日(JST)の日付キー。閲覧端末の TZ に依らず日本時間で判定する。
export function getJstTodayDateKey(now: Date = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = jst.getUTCFullYear()
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${jst.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 未来日は恒久記録の対象外。台帳は write-once なので、当月15日などを先回りして記録すると
// その日の定期実行が「既に記録あり」でスキップし、本当の当日時点の在籍数が永久に残らなくなる。
// 請求画面の既定の集計日は当月15日＝月の前半は未来日になるため、実際に踏み得る。
// サーバー側 functions/src/monthlyStudentCount.ts の isFutureSnapshotDate と同じ規則(片方だけ変えない)。
export function isFutureBillingSnapshotDate(snapshotDate: string, todayJstDateKey: string) {
  return snapshotDate > todayJstDateKey
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