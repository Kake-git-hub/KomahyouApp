// 「全社」一覧の窓口 callable listBillingWorkspaces の純粋ロジック(P-11 ③・2026-10-10・spec docs/spec-multi-tenant.md §7-12 / §13)。
//
// 返すのは **呼び出した人が developer として所属する workspace だけ**(会社の壁 §1-2。他社の棟は存在すら返さない)。
// 各 workspace について、棟の文書の会社名・請求先・標準単価(P-11 ①の形)と教室数、その人の請求許可フラグ(billingAllowed)を返す。
// Firestore の読み取りだけで、何も書かない(本番データ保護ルール)。
export type BillingWorkspaceSummary = {
  workspaceKey: string
  companyName: string
  brandName: string
  recipientName: string
  recipientEmail: string
  standardUnitPrice: number | null
  classroomCount: number
  /** 呼び出した人の members/{uid}.billingAllowed(P-11 ④ 第 1 段のフラグ)。 */
  billingAllowed: boolean
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || number < 0) return null
  return Math.trunc(number)
}

/** その会員が developer か(所属していない = null/undefined も false)。 */
export function isDeveloperMember(member: unknown): boolean {
  return Boolean(member && typeof member === 'object' && (member as { role?: unknown }).role === 'developer')
}

/** 棟の文書と会員文書から一覧の 1 行を作る(鏡像: src/utils/companyBilling.ts parseCompanyBillingProfile)。 */
export function summarizeBillingWorkspace(params: {
  workspaceKey: string
  workspaceData: unknown
  memberData: unknown
  classroomCount: number
}): BillingWorkspaceSummary {
  const record = params.workspaceData && typeof params.workspaceData === 'object' ? (params.workspaceData as Record<string, unknown>) : {}
  const billing = record.billing && typeof record.billing === 'object' ? (record.billing as Record<string, unknown>) : {}
  const member = params.memberData && typeof params.memberData === 'object' ? (params.memberData as Record<string, unknown>) : {}
  const companyName = readText(record.companyName)
  return {
    workspaceKey: params.workspaceKey,
    companyName,
    brandName: readText(record.brandName),
    recipientName: readText(billing.recipientName) || companyName,
    recipientEmail: readText(billing.recipientEmail),
    standardUnitPrice: readNonNegativeInteger(billing.standardUnitPrice),
    classroomCount: Math.max(0, Math.trunc(Number.isFinite(params.classroomCount) ? params.classroomCount : 0)),
    billingAllowed: member.billingAllowed === true,
  }
}

/** 一覧の並び: 既存運営会社(main)を先頭に、あとは会社キー順。 */
export function sortBillingWorkspaces(entries: BillingWorkspaceSummary[]): BillingWorkspaceSummary[] {
  return [...entries].sort((left, right) => {
    if (left.workspaceKey === 'main') return -1
    if (right.workspaceKey === 'main') return 1
    return left.workspaceKey.localeCompare(right.workspaceKey)
  })
}
