// 在籍生徒数の恒久記録(台帳)へのアクセス。
//
// 台帳は Cloud Function(recordMonthlyStudentCounts)が毎月15日 0:00(JST)時点で書き込む
// write-once の記録。請求画面はここから「その日の確定人数」を読む。
// ⚠️ Firestore への**直書きを足さないこと**。ルールも write:false で閉じてある(恒久記録を
//    画面操作で動かさないため)。記録の追加は Cloud Function の callable 経由だけにする。
//    サーバー側が既存記録を上書きしない(batch.create)ので、何度押しても記録は壊れない。
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'

export type StudentCountLedgerSource = 'scheduled' | 'manual'

export type StudentCountLedgerClassroomRecord = {
  classroomId: string
  classroomName: string
  snapshotDate: string
  monthKey: string
  studentCount: number
  studentIds?: string[]
  recordedAt: string
  recordedBy?: string
  source?: StudentCountLedgerSource
}

export type StudentCountLedgerEntry = {
  snapshotDate: string
  monthKey: string
  classroomCount: number
  studentCountTotal: number
  recordedAt: string
  source: StudentCountLedgerSource
  countByClassroomId: Record<string, StudentCountLedgerClassroomRecord>
}

function getStudentCountLedgerRef(snapshotDate: string) {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) throw new Error('Firebase 設定が不足しています。 .env に接続情報を設定してください。')
  const config = getFirebaseBackendConfig()
  return doc(firestore, 'workspaces', config.workspaceKey, 'studentCountLedger', snapshotDate)
}

// 指定日の恒久記録を読む。記録が無ければ null(呼び出し側はライブ計算へフォールバックする)。
export async function loadStudentCountLedgerEntry(snapshotDate: string): Promise<StudentCountLedgerEntry | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return null

  await ensureFirebaseAuthenticatedUser()
  const ledgerRef = getStudentCountLedgerRef(snapshotDate)
  const summarySnapshot = await getDoc(ledgerRef)
  if (!summarySnapshot.exists()) return null

  const summary = summarySnapshot.data() as Omit<StudentCountLedgerEntry, 'countByClassroomId'>
  const classroomSnapshots = await getDocs(collection(ledgerRef, 'classrooms'))
  const countByClassroomId: Record<string, StudentCountLedgerClassroomRecord> = {}
  classroomSnapshots.docs.forEach((entry) => {
    const record = entry.data() as StudentCountLedgerClassroomRecord
    countByClassroomId[record.classroomId || entry.id] = record
  })

  return {
    snapshotDate: summary.snapshotDate || snapshotDate,
    monthKey: summary.monthKey || snapshotDate.slice(0, 7),
    classroomCount: summary.classroomCount ?? classroomSnapshots.size,
    studentCountTotal: summary.studentCountTotal ?? 0,
    recordedAt: summary.recordedAt || '',
    source: summary.source === 'manual' ? 'manual' : 'scheduled',
    countByClassroomId,
  }
}

export type RecordStudentCountLedgerResult = {
  created: boolean
  snapshotDate: string
  classroomCount: number
  studentCountTotal: number
}

// 指定日の在籍生徒数を手動で恒久記録する(開発者のみ・サーバー側で権限確認)。
// 用途: 定期実行が始まる前の当月分を埋める / 障害で取り逃した日を後から記録する。
// 既に記録がある日付は created:false で返り、記録は書き換わらない(write-once)。
export async function recordStudentCountLedgerEntry(snapshotDate: string): Promise<RecordStudentCountLedgerResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = getFirebaseFunctionsInstance()
  if (!functions) throw new Error('Firebase Functions を利用できません。接続設定を確認してください。')
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; snapshotDate: string }, RecordStudentCountLedgerResult>(
    functions,
    'triggerMonthlyStudentCountRecord',
    { timeout: 120_000 },
  )
  const result = await callable({ workspaceKey: config.workspaceKey, snapshotDate })
  return {
    created: Boolean(result.data?.created),
    snapshotDate: String(result.data?.snapshotDate ?? snapshotDate),
    classroomCount: Number(result.data?.classroomCount ?? 0),
    studentCountTotal: Number(result.data?.studentCountTotal ?? 0),
  }
}
