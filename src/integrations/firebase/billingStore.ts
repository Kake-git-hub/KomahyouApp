import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { type BillingInvoiceRow } from '../../utils/billing'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance } from './client'
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
  if (!firestore) throw new Error('Firebase 設定が不足しています。 .env に接続情報を設定してください。')
  return firestore
}

function getBillingMonthRef(monthKey: string) {
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  return doc(firestore, 'workspaces', config.workspaceKey, 'billingMonths', monthKey)
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

export async function loadFirebaseBillingMonth(monthKey: string) {
  await ensureFirebaseAuthenticatedUser()
  const classroomCollection = collection(getBillingMonthRef(monthKey), 'classrooms')
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