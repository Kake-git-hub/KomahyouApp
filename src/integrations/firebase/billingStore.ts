import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { type BillingInvoiceRow } from '../../utils/billing'
import { parseCompanyBillingProfile, type CompanyBillingProfile } from '../../utils/companyBilling'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'

export type BillingClassroomRecord = {
  classroomId: string
  classroomName: string
  managerEmail: string
  monthKey: string
  snapshotDate: string
  studentCount: number
  unitPrice: number
  calculatedAmount: number
  billedAmount: number
  taxAmount: number
  billedAmountWithTax: number
  invoiceNumber: string
  memo: string
  draftId?: string
  draftCreatedAt?: string
  updatedAt: string
  updatedBy: string
}

function requireFirestore() {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) {
    console.error('[billingStore] Firestore を初期化できません。.env の Firebase 接続情報を確認してください。')
    throw new Error('接続設定がされていません。開発者へご連絡ください。')
  }
  return firestore
}

// 読み書き先の workspace。既定は接続先(env)。「全社」タブ(P-11 ③)だけが別の workspace を指定して**読む**
// (書けるのは rules の isBillingDeveloper = その workspace の developer 会員で請求許可がある人だけ)。
function resolveWorkspaceKey(workspaceKey?: string) {
  const key = workspaceKey?.trim() || getFirebaseBackendConfig().workspaceKey
  if (!key) throw new Error('workspace が未設定です。')
  return key
}

function getBillingMonthRef(monthKey: string, workspaceKey?: string) {
  const firestore = requireFirestore()
  return doc(firestore, 'workspaces', resolveWorkspaceKey(workspaceKey), 'billingMonths', monthKey)
}

/** 棟の文書 workspaces/{workspaceKey} から会社の請求プロファイル(会社名・請求先・標準単価・P-11 ①)を読む。 */
export async function loadFirebaseCompanyBillingProfile(workspaceKey?: string): Promise<CompanyBillingProfile> {
  await ensureFirebaseAuthenticatedUser()
  const key = resolveWorkspaceKey(workspaceKey)
  const snapshot = await getDoc(doc(requireFirestore(), 'workspaces', key))
  return parseCompanyBillingProfile(key, snapshot.exists() ? snapshot.data() : undefined)
}

/**
 * 会社宛合算の設定(合算請求先名・合算に含めない教室)を棟の文書 workspaces/{接続先}.billing へ merge 保存する
 * (2026-10-10 オーナー要望)。書けるのは請求許可者だけ(rules の workspaceBillingUnchanged)。指定した項目だけ書き、
 * 会社名・標準単価など他の billing 項目は残す(Firestore の merge は入れ子の map も項目単位で合流する)。
 */
export async function saveFirebaseCompanyBillingSettings(updates: { companyName?: string; recipientName?: string; recipientEmail?: string; excludedClassroomIds?: readonly string[] }) {
  const user = await ensureFirebaseAuthenticatedUser()
  // 会社名は棟の文書の最上位 companyName(tools/provision-workspace.mjs が書く場所・2026-10-10 オーナー要望で画面から編集可に)。
  const topLevel: Record<string, unknown> = {}
  if (typeof updates.companyName === 'string') topLevel.companyName = updates.companyName.trim()
  const billing: Record<string, unknown> = {}
  if (typeof updates.recipientName === 'string') billing.recipientName = updates.recipientName.trim()
  if (typeof updates.recipientEmail === 'string') billing.recipientEmail = updates.recipientEmail.trim().toLowerCase()
  if (updates.excludedClassroomIds) billing.excludedClassroomIds = [...new Set(updates.excludedClassroomIds)].sort()
  if (Object.keys(billing).length === 0 && Object.keys(topLevel).length === 0) return
  await setDoc(doc(requireFirestore(), 'workspaces', resolveWorkspaceKey()), {
    ...topLevel,
    ...(Object.keys(billing).length > 0 ? { billing } : {}),
    billingUpdatedAt: new Date().toISOString(),
    billingUpdatedBy: user.uid,
  }, { merge: true })
}

export type CompanyInvoiceDraftRecord = {
  draftId?: string
  draftCreatedAt: string
  recipientEmail: string
}

/** その月の会社宛合算メールの準備記録(billingMonths/{月}.companyInvoice)。無ければ null。 */
export async function loadFirebaseCompanyInvoiceDraft(monthKey: string): Promise<CompanyInvoiceDraftRecord | null> {
  await ensureFirebaseAuthenticatedUser()
  const snapshot = await getDoc(getBillingMonthRef(monthKey))
  const record = snapshot.exists() ? (snapshot.get('companyInvoice') as Partial<CompanyInvoiceDraftRecord> | undefined) : undefined
  if (!record || typeof record.draftCreatedAt !== 'string' || !record.draftCreatedAt) return null
  return {
    ...(typeof record.draftId === 'string' && record.draftId ? { draftId: record.draftId } : {}),
    draftCreatedAt: record.draftCreatedAt,
    recipientEmail: typeof record.recipientEmail === 'string' ? record.recipientEmail : '',
  }
}

/**
 * 会社宛合算メールを準備した記録を月の文書へ残す(教室行の draftCreatedAt と同じ考え方・二重送信の目安)。
 * 書き先は接続先 workspace の billingMonths/{月}(rules は請求許可者のみ)。教室行(classrooms サブコレクション)には触れない。
 */
export async function markFirebaseCompanyInvoiceDraftCreated(params: { monthKey: string; recipientEmail: string; draftId?: string }): Promise<CompanyInvoiceDraftRecord> {
  const user = await ensureFirebaseAuthenticatedUser()
  const draftCreatedAt = new Date().toISOString()
  const record: CompanyInvoiceDraftRecord = {
    ...(params.draftId ? { draftId: params.draftId } : {}),
    draftCreatedAt,
    recipientEmail: params.recipientEmail,
  }
  await setDoc(getBillingMonthRef(params.monthKey), sanitizeForFirestore({
    monthKey: params.monthKey,
    companyInvoice: { ...record, updatedBy: user.uid },
    updatedAt: draftCreatedAt,
    updatedBy: user.uid,
  }), { merge: true })
  return record
}

export type BillingWorkspaceListEntry = {
  workspaceKey: string
  companyName: string
  brandName: string
  recipientName: string
  recipientEmail: string
  standardUnitPrice: number | null
  excludedClassroomIds: string[] | null
  classroomCount: number
  billingAllowed: boolean
}

/** 「全社」一覧(P-11 ③): 自分が developer として所属する workspace だけをサーバーの窓口 callable 1 本で列挙する。 */
export async function listFirebaseBillingWorkspaces(): Promise<BillingWorkspaceListEntry[]> {
  await ensureFirebaseAuthenticatedUser()
  const functions = getFirebaseFunctionsInstance()
  if (!functions) throw new Error('サーバーに接続できません。通信状態を確認してください。')
  const callable = httpsCallable<Record<string, never>, { workspaces?: BillingWorkspaceListEntry[] }>(functions, 'listBillingWorkspaces', { timeout: 60_000 })
  const result = await callable({})
  return (result.data?.workspaces ?? []).map((entry) => ({
    workspaceKey: String(entry.workspaceKey ?? ''),
    companyName: String(entry.companyName ?? ''),
    brandName: String(entry.brandName ?? ''),
    recipientName: String(entry.recipientName ?? ''),
    recipientEmail: String(entry.recipientEmail ?? ''),
    standardUnitPrice: typeof entry.standardUnitPrice === 'number' ? entry.standardUnitPrice : null,
    // 古い functions(この項目を返さない)では null = 未保存扱い(検証用教室を既定除外)。
    excludedClassroomIds: Array.isArray(entry.excludedClassroomIds) ? entry.excludedClassroomIds.filter((id): id is string => typeof id === 'string') : null,
    classroomCount: Number(entry.classroomCount ?? 0),
    billingAllowed: entry.billingAllowed === true,
  })).filter((entry) => entry.workspaceKey)
}

function toBillingClassroomRecord(row: BillingInvoiceRow, updatedAt: string, updatedBy: string): BillingClassroomRecord {
  return {
    classroomId: row.classroomId,
    classroomName: row.classroomName,
    managerEmail: row.managerEmail,
    monthKey: row.monthKey,
    snapshotDate: row.snapshotDate,
    studentCount: row.studentCount,
    unitPrice: row.unitPrice,
    calculatedAmount: row.calculatedAmount,
    billedAmount: row.billedAmount,
    taxAmount: row.taxAmount,
    billedAmountWithTax: row.billedAmountWithTax,
    invoiceNumber: row.invoiceNumber,
    memo: row.memo,
    updatedAt,
    updatedBy,
  }
}

export async function loadFirebaseBillingMonth(monthKey: string, workspaceKey?: string) {
  await ensureFirebaseAuthenticatedUser()
  const classroomCollection = collection(getBillingMonthRef(monthKey, workspaceKey), 'classrooms')
  const snapshots = await getDocs(classroomCollection)
  return snapshots.docs.map((entry) => entry.data() as BillingClassroomRecord)
}

export async function saveFirebaseBillingRow(row: BillingInvoiceRow) {
  const user = await ensureFirebaseAuthenticatedUser()
  const updatedAt = new Date().toISOString()
  const monthRef = getBillingMonthRef(row.monthKey)
  const classroomRef = doc(collection(monthRef, 'classrooms'), row.classroomId)

  await setDoc(monthRef, {
    monthKey: row.monthKey,
    updatedAt,
    updatedBy: user.uid,
  }, { merge: true })
  await setDoc(classroomRef, sanitizeForFirestore(toBillingClassroomRecord(row, updatedAt, user.uid)), { merge: true })
}

export async function saveFirebaseBillingRows(rows: BillingInvoiceRow[]) {
  if (rows.length === 0) return

  const user = await ensureFirebaseAuthenticatedUser()
  const updatedAt = new Date().toISOString()
  const batch = writeBatch(requireFirestore())
  const monthRef = getBillingMonthRef(rows[0].monthKey)

  batch.set(monthRef, {
    monthKey: rows[0].monthKey,
    updatedAt,
    updatedBy: user.uid,
  }, { merge: true })

  rows.forEach((row) => {
    batch.set(doc(collection(monthRef, 'classrooms'), row.classroomId), sanitizeForFirestore(toBillingClassroomRecord(row, updatedAt, user.uid)), { merge: true })
  })

  await batch.commit()
}

export async function markFirebaseBillingDraftCreated(params: {
  monthKey: string
  classroomId: string
  draftId?: string
}) {
  const user = await ensureFirebaseAuthenticatedUser()
  const updatedAt = new Date().toISOString()
  const monthRef = getBillingMonthRef(params.monthKey)
  const classroomRef = doc(collection(monthRef, 'classrooms'), params.classroomId)
  await setDoc(classroomRef, sanitizeForFirestore({
    // OAuth 廃止後の手動メール作成では Gmail 下書きIDが無いため draftId は任意。
    draftId: params.draftId,
    draftCreatedAt: updatedAt,
    updatedAt,
    updatedBy: user.uid,
  }), { merge: true })
}