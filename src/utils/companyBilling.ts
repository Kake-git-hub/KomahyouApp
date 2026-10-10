// 会社(workspace)宛の請求(P-11・2026-10-10・計画 docs/plan-2026-09-18-second-company-onboarding.md §3 / spec docs/spec-multi-tenant.md §13)。
// 純関数だけ。Firestore の読み書きは src/integrations/firebase/billingStore.ts。
//
//  ① 棟の文書 `workspaces/{workspaceKey}` に会社名・ブランド名・請求先・標準単価を持つ(tools/provision-workspace.mjs が書く形)。
//     単価の優先順は **保存済みの請求行 > 教室の studentUnitPrice > 会社の標準単価 > 既定 300 円**(§7-13「会社の標準単価 + 教室で上書き」)。
//  ② 会社宛合算請求書 = その月の教室行を 1 通にまとめる(教室宛も残す・§7-10)。消費税は**合算の税抜額に 1 回**かける
//     (教室ごとの税を足し合わせると端数で 1 円ずれ得る。合算請求書の税額はこちらが正)。
//  ④ 請求の許可者 = developer かつ(member の billingAllowed フラグ **または** 従来のメール固定)。第 1 段ではフラグを足すだけで
//     メール固定は残す(§7-11「先にフラグを立ててからハードコードを消す」)。
import { calculateBillingAmounts, isBillingAllowedEmail, normalizeBillingMonthKey, TAX_RATE, type BillingInvoiceRow } from './billing'
import { isRegisteredDevelopmentClassroom } from './developmentClassroomRegistry'

export const DEFAULT_STUDENT_UNIT_PRICE = 300

export type CompanyBillingProfile = {
  workspaceKey: string
  /** 会社名(棟の文書 companyName)。空 = 未設定(既存運営会社 main は P-11 導入時点では未設定 → 画面は workspaceKey を出す)。 */
  companyName: string
  brandName: string
  /** 請求先名(billing.recipientName)。空なら会社名。 */
  recipientName: string
  recipientEmail: string
  /** 会社の標準単価(billing.standardUnitPrice)。null = 未設定(教室単価 → 既定 300 円)。 */
  standardUnitPrice: number | null
  /**
   * 会社宛合算に**含めない**教室 ID(billing.excludedClassroomIds・2026-10-10 オーナー要望「テスト教室・開発用教室は合算に出したくない」)。
   * null = 一度も保存していない → 登録済みの検証用教室(developmentClassroomRegistry)だけを既定で除外する。
   * 配列(空配列を含む)= 保存済み → その一覧どおり(既定は使わない)。
   */
  excludedClassroomIds: string[] | null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || number < 0) return null
  return Math.trunc(number)
}

/** 棟の文書(Firestore の data())から会社の請求プロファイルを読む。無い項目は空/null(fail-soft: 画面を止めない)。 */
export function parseCompanyBillingProfile(workspaceKey: string, data: unknown): CompanyBillingProfile {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const billing = record.billing && typeof record.billing === 'object' ? (record.billing as Record<string, unknown>) : {}
  const companyName = readText(record.companyName)
  return {
    workspaceKey,
    companyName,
    brandName: readText(record.brandName),
    recipientName: readText(billing.recipientName) || companyName,
    recipientEmail: readText(billing.recipientEmail),
    standardUnitPrice: readNonNegativeInteger(billing.standardUnitPrice),
    excludedClassroomIds: readClassroomIdList(billing.excludedClassroomIds),
  }
}

function readClassroomIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
  return [...new Set(ids)].sort()
}

/**
 * 合算から除外する教室 ID の集合。保存済み(配列)ならそれ、未保存(null)なら登録済みの検証用教室(開発用教室・テスト教室)を既定で除外。
 * 既定を使うのは「一度もチェックを触っていない会社」だけ(触ると配列で保存され、以後は保存どおり)。
 */
export function resolveCompanyInvoiceExcludedIds(
  profile: Pick<CompanyBillingProfile, 'workspaceKey' | 'excludedClassroomIds'>,
  classroomIds: readonly string[],
): Set<string> {
  if (profile.excludedClassroomIds !== null) return new Set(profile.excludedClassroomIds)
  return new Set(classroomIds.filter((classroomId) => isRegisteredDevelopmentClassroom(profile.workspaceKey, classroomId)))
}

/** チェックを切り替えたあとの除外一覧(保存する値・ソート済み・重複なし)。現在の除外集合から作る。 */
export function toggleCompanyInvoiceExclusion(currentExcluded: ReadonlySet<string>, classroomId: string, included: boolean): string[] {
  const next = new Set(currentExcluded)
  if (included) next.delete(classroomId)
  else next.add(classroomId)
  return [...next].sort()
}

const RECIPIENT_EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * 合算請求先メールの入力を正規化する(前後の空白を落として小文字化)。空は「未設定」として有効。
 * 形式が不正なら ok:false(保存しない)。宛先は 1 件だけ(カンマ・セミコロン区切りの複数指定は不可)。
 */
export function normalizeRecipientEmail(value: string): { ok: true; value: string } | { ok: false; value: string } {
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: '' }
  const normalized = trimmed.toLowerCase()
  return RECIPIENT_EMAIL_PATTERN.test(normalized) ? { ok: true, value: normalized } : { ok: false, value: trimmed }
}

/** 画面に出す会社の呼び名。会社名が未設定なら workspaceKey(既存運営会社 main は棟の文書に会社名が入るまで "main")。 */
export function companyDisplayLabel(profile: Pick<CompanyBillingProfile, 'workspaceKey' | 'companyName'>): string {
  return profile.companyName || profile.workspaceKey
}

/**
 * 教室 1 行の単価を決める。優先順: 保存済みの請求行 > 教室の studentUnitPrice > 会社の標準単価 > 既定(300 円)。
 * ⚠️ 既存運営会社(main)は棟の文書に標準単価が無い(null)ので、従来どおり「教室単価 → 300 円」になる(出力不変)。
 */
export function resolveBillingUnitPrice(params: {
  recordUnitPrice?: number | null
  classroomUnitPrice?: number | null
  companyStandardUnitPrice?: number | null
  fallback?: number
}): number {
  const candidates = [params.recordUnitPrice, params.classroomUnitPrice, params.companyStandardUnitPrice]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return Math.trunc(candidate)
  }
  return params.fallback ?? DEFAULT_STUDENT_UNIT_PRICE
}

export type CompanyInvoiceLine = {
  classroomId: string
  classroomName: string
  studentCount: number
  unitPrice: number
  calculatedAmount: number
  billedAmount: number
}

export type CompanyInvoice = {
  workspaceKey: string
  companyName: string
  recipientName: string
  recipientEmail: string
  monthKey: string
  snapshotDate: string
  invoiceNumber: string
  lines: CompanyInvoiceLine[]
  studentCount: number
  calculatedAmount: number
  billedAmount: number
  taxAmount: number
  billedAmountWithTax: number
}

export function buildCompanyInvoiceNumber(workspaceKey: string, monthKey: string) {
  const normalizedKey = workspaceKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'COMPANY'
  return `INV-${normalizeBillingMonthKey(monthKey).replace('-', '')}-${normalizedKey}-ALL`
}

/**
 * 会社宛合算請求書。教室行(画面の行 or 保存済み記録から作った行)を教室名順に並べて合算する。
 * 税は合算の税抜額に 1 回(端数処理 1 回)。教室 0 行でも 0 円の請求書を作れる(呼び出し側で出すかを決める)。
 */
export function buildCompanyInvoice(params: {
  profile: CompanyBillingProfile
  rows: readonly BillingInvoiceRow[]
  monthKey: string
  snapshotDate: string
  /** 合算から除外する教室 ID(resolveCompanyInvoiceExcludedIds の結果)。省略 = 全教室を含める。 */
  excludedClassroomIds?: ReadonlySet<string>
}): CompanyInvoice {
  const monthKey = normalizeBillingMonthKey(params.monthKey)
  const excluded = params.excludedClassroomIds ?? new Set<string>()
  const lines: CompanyInvoiceLine[] = [...params.rows]
    .filter((row) => normalizeBillingMonthKey(row.monthKey) === monthKey)
    .filter((row) => !excluded.has(row.classroomId))
    .sort((left, right) => left.classroomName.localeCompare(right.classroomName, 'ja') || left.classroomId.localeCompare(right.classroomId))
    .map((row) => {
      const amounts = calculateBillingAmounts(row.studentCount, row.unitPrice, row.billedAmount)
      return {
        classroomId: row.classroomId,
        classroomName: row.classroomName || '名称未設定の教室',
        studentCount: amounts.studentCount,
        unitPrice: amounts.unitPrice,
        calculatedAmount: amounts.calculatedAmount,
        billedAmount: amounts.billedAmount,
      }
    })
  const studentCount = lines.reduce((sum, line) => sum + line.studentCount, 0)
  const calculatedAmount = lines.reduce((sum, line) => sum + line.calculatedAmount, 0)
  const billedAmount = lines.reduce((sum, line) => sum + line.billedAmount, 0)
  const taxAmount = Math.round(billedAmount * TAX_RATE)
  return {
    workspaceKey: params.profile.workspaceKey,
    companyName: companyDisplayLabel(params.profile),
    recipientName: params.profile.recipientName || companyDisplayLabel(params.profile),
    recipientEmail: params.profile.recipientEmail,
    monthKey,
    snapshotDate: params.snapshotDate,
    invoiceNumber: buildCompanyInvoiceNumber(params.profile.workspaceKey, monthKey),
    lines,
    studentCount,
    calculatedAmount,
    billedAmount,
    taxAmount,
    billedAmountWithTax: billedAmount + taxAmount,
  }
}

export type BillingUserLike = {
  email: string
  role: string
  /** members/{uid}.billingAllowed(P-11 ④ 第 1 段のフラグ)。undefined = 文書に無い(従来の会員)。 */
  billingAllowed?: boolean
}

/**
 * 請求画面を使える人か。developer かつ(フラグ billingAllowed === true **または** 従来のメール固定)。
 * 第 2 段(メール固定の撤去)はオーナーが各 workspace の自分の会員文書にフラグを立ててから(runbook)。
 * rules の isBillingDeveloper と同じ 2 経路(片方だけ変えない・firebase/firestore.rules)。
 */
export function isBillingAllowedUser(user: BillingUserLike | null | undefined): boolean {
  if (!user || user.role !== 'developer') return false
  return user.billingAllowed === true || isBillingAllowedEmail(user.email)
}
