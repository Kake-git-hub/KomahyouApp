// 保護者向け固定QR(docs/spec-parent-portal.md)のクライアント側 Firebase 経路。
// - トークンの発行/失効・連絡の既読化は **Cloud Functions callable のみ**(権威コレクション studentPortalTokens /
//   studentPortalTokenOwners はクライアントから read も write も不可。§B-1)。ここに Firestore 直書きを足さない
//   (lectureSubmissions のような「誰でも書ける」経路を作ると 2026-07-09 型の教室越え混入が再発する)。
// - 連絡 parentMessages は教室メンバーのみ read(write は CF のみ)。購読は自教室のパスに限定する(§E-2 1.・INV-08)。
// ⚠️ トークン全文・本文・生徒名をログに出さない。
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { parseParentMessageEntry, type ParentMessageEntry } from '../../utils/parentMessages'

// adminFunctions.ts の requireFunctions と同じ(そちらは非公開なので同型を置く)。region 束縛済みの instance を要求する。
function requireFunctions() {
  const functions = getFirebaseFunctionsInstance()
  if (!functions) {
    throw new Error('Firebase Functions を利用できません。接続設定を確認してください。')
  }
  return functions
}

// callable は 60 秒(発行は Firestore トランザクション 1 回程度。長い処理ではない)。
const PARENT_PORTAL_CALLABLE_TIMEOUT_MS = 60_000

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export type IssueStudentPortalTokenRequest = {
  classroomId: string
  studentId: string
  /** true なら有効トークンがあっても旧トークンを失効(revokedReason='reissue')して新規発行する(§B-2「再発行」)。 */
  reissue?: boolean
}

export type IssueStudentPortalTokenResponse = {
  token: string
  reissued: boolean
}

/**
 * 保護者用トークンの取得または発行(callable `issueStudentPortalToken`・getOrIssue で冪等)。
 * 生徒 1 名＝有効トークン 1 本はサーバーの索引(studentPortalTokenOwners)が保証する。
 * 戻り値の token は StudentRow.parentPortalToken の「写し」として画面側が保持し、手動保存で永続化する。
 */
export async function issueStudentPortalTokenViaFunction(input: IssueStudentPortalTokenRequest): Promise<IssueStudentPortalTokenResponse> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; studentId: string; reissue: boolean }, unknown>(
    functions,
    'issueStudentPortalToken',
    { timeout: PARENT_PORTAL_CALLABLE_TIMEOUT_MS },
  )
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId: input.classroomId,
    studentId: input.studentId,
    reissue: input.reissue === true,
  })
  const data = readRecord(result.data)
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  if (!token) {
    throw new Error('保護者用QRの発行結果を読み取れませんでした。時間をおいて再度お試しください。')
  }
  return { token, reissued: data.reissued === true }
}

export type RevokeStudentPortalTokenRequest = {
  classroomId: string
  studentId: string
  reason: 'manual' | 'studentDeleted'
}

/**
 * 保護者用トークンの失効(callable `revokeStudentPortalToken`)。生徒削除の確定時は best-effort で呼ぶ
 * (失敗しても削除自体は止めない。サーバー側の在籍検証(§G-2 4 段目)が最終的な防波堤)。
 */
export async function revokeStudentPortalTokenViaFunction(input: RevokeStudentPortalTokenRequest): Promise<{ revoked: boolean }> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; studentId: string; reason: RevokeStudentPortalTokenRequest['reason'] }, unknown>(
    functions,
    'revokeStudentPortalToken',
    { timeout: PARENT_PORTAL_CALLABLE_TIMEOUT_MS },
  )
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId: input.classroomId,
    studentId: input.studentId,
    reason: input.reason,
  })
  return { revoked: readRecord(result.data).revoked === true }
}

export type MarkParentMessagesNotifiedRequest = {
  classroomId: string
  messageIds: string[]
}

/**
 * 保護者からの連絡の既読化(callable `markParentMessagesNotified`)。室長がモーダルの「確認」を押したときに呼ぶ
 * (表示時ではない)。notifiedAt はサーバー時刻で部分更新され、別端末で開いても再通知されない(§E-2 4.)。
 * localStorage に既読を持たない。
 */
export async function markParentMessagesNotifiedViaFunction(input: MarkParentMessagesNotifiedRequest): Promise<{ updated: number }> {
  const messageIds = Array.from(new Set(input.messageIds.map((id) => id.trim()).filter(Boolean)))
  if (messageIds.length === 0) return { updated: 0 }
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; messageIds: string[] }, unknown>(
    functions,
    'markParentMessagesNotified',
    { timeout: PARENT_PORTAL_CALLABLE_TIMEOUT_MS },
  )
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId: input.classroomId,
    messageIds,
  })
  const updated = readRecord(result.data).updated
  return { updated: typeof updated === 'number' && Number.isFinite(updated) ? updated : 0 }
}

/**
 * 自教室の未読連絡を購読する(§E-2 1.〜2.)。
 * - パスは `workspaces/{ws}/classroomSnapshots/{classroomId}/parentMessages`(教室分離はパスで担保。他教室は購読しない)。
 * - 条件は `where('notifiedAt', '==', null)` の等値 1 つだけ。orderBy を足すと複合インデックスが要る
 *   (FAILED_PRECONDITION が画面では空/INTERNAL に見える・CLAUDE.md 2026-09-12 の教訓)。並べ替えは
 *   mergeParentMessageNotifications がクライアント側で行う。
 * - docChanges の added/modified だけ拾う。既読化で notifiedAt が埋まると doc はクエリから外れて 'removed' で届くため無視する。
 * - isInitial=true は購読直後の初回スナップショット(=未読の一括配信)。lectureSubmissions のような lastSavedAt
 *   ウォーターマークは使わない(保存前に届いた連絡を落としてしまう)。
 * - doc.classroomId が購読教室と違う doc は捨てる(パスが正しくても doc 側の教室タグを権威として二重に守る・INV-08)。
 */
export function subscribeParentMessages(
  classroomId: string,
  onChange: (entries: ParentMessageEntry[], isInitial: boolean) => void,
): () => void {
  const db = getFirebaseFirestoreInstance()
  const config = getFirebaseBackendConfig()
  if (!db || !classroomId || !config.workspaceKey) return () => {}

  const q = query(
    collection(db, 'workspaces', config.workspaceKey, 'classroomSnapshots', classroomId, 'parentMessages'),
    where('notifiedAt', '==', null),
  )

  let isInitialSnapshot = true
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const isInitial = isInitialSnapshot
    isInitialSnapshot = false
    const entries: ParentMessageEntry[] = []
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added' && change.type !== 'modified') continue
      const entry = parseParentMessageEntry(change.doc.id, change.doc.data())
      if (!entry) continue
      if (entry.classroomId !== classroomId) continue
      entries.push(entry)
    }
    if (entries.length > 0) onChange(entries, isInitial)
  }, (error) => {
    // ★エラーコールバックを省くと、ルール未反映(permission-denied)や索引不足が「連絡 0 件」と
    //   見分けられず**無音で機能しない**。Firestore ルールは main マージでは反映されないので、
    //   この経路は実際に踏みうる(レビュー指摘 2026-09-13)。本文・生徒名・トークンは出さず code だけ残す。
    console.error('[parentMessages] subscribe failed', error.code)
  })

  return unsubscribe
}
