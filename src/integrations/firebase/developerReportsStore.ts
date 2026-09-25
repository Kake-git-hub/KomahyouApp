// 開発ダッシュボード用: 「質問・要望」の報告(developerReports)を **読むだけ** の経路。
//
// ★書き込みは一切しない(本番データ保護ルール)。developerReports は Firestore ルールで developer のみ read・
//   write 不可(Cloud Function が Admin SDK で書く)。ここで setDoc / updateDoc / deleteDoc / writeBatch を
//   import しないことを developerReportsStore.test.ts が字面で固定する。
// ★読み込む範囲は recordedAt(ISO 文字列)の範囲と件数で絞る。1 件の文書は操作痕跡(最大 300 件)を含み大きいため、
//   全期間を読まない。範囲と並べ替えが同じ単一フィールドなので複合インデックスは要らない
//   (listRecentFirebaseServerAutoBackupSummaries と同じ作法)。

import { collection, doc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'

import { normalizeDeveloperReportRecord, type DeveloperReportRecord } from '../../utils/developerDashboard'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance } from './client'
import { getFirebaseBackendConfig } from './config'

export type ListDeveloperReportsOptions = {
  /** この時刻(ISO)以降に受け付けた報告だけ。 */
  sinceIso: string
  /** 最大件数(新しい順)。 */
  limit: number
}

export async function listRecentDeveloperReports(options: ListDeveloperReportsOptions): Promise<DeveloperReportRecord[]> {
  await ensureFirebaseAuthenticatedUser()
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) throw new Error('Firebase が有効になっていないため、報告を読み込めません。')
  const config = getFirebaseBackendConfig()
  const reportsRef = collection(doc(firestore, 'workspaces', config.workspaceKey), 'developerReports')
  const snapshot = await getDocs(query(reportsRef, where('recordedAt', '>=', options.sinceIso), orderBy('recordedAt', 'desc'), limit(options.limit)))
  return snapshot.docs.map((entry) => normalizeDeveloperReportRecord(entry.data() as Record<string, unknown>, entry.id))
}
