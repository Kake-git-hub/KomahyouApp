// 保護者向け固定QR(docs/spec-parent-portal.md)のクライアント側 Firebase 経路。
// - トークンの発行/失効・連絡の既読化は **Cloud Functions callable のみ**(権威コレクション studentPortalTokens /
//   studentPortalTokenOwners はクライアントから read も write も不可。§B-1)。ここに Firestore 直書きを足さない
//   (lectureSubmissions のような「誰でも書ける」経路を作ると 2026-07-09 型の教室越え混入が再発する)。
// - 連絡 parentMessages は教室メンバーのみ read(write は CF のみ)。購読は自教室のパスに限定する(§E-2 1.・INV-08)。
// ⚠️ トークン全文・本文・生徒名をログに出さない。
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { parseParentMessageEntry, type ParentAbsenceResolution, type ParentMessageEntry } from '../../utils/parentMessages'

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
  /**
   * 'acknowledged' = 室長が四択を押した(保護者ページに「教室確認済」を出す。未読購読からは外さない)。
   * 'notified'     = 処理完了(盤面を保存できた or 何もしない)。未読購読から外れ、次回起動で再通知されない。
   */
  stage: 'acknowledged' | 'notified'
  /** 四択のどれを選んだか。'acknowledged' では必須、'notified' では「何もしない」のときだけ渡す。 */
  resolution?: ParentAbsenceResolution
}

/**
 * 休み連絡の状態更新(callable `markParentMessagesNotified`。§0-5)。時刻はサーバーが付け、doc を部分更新する。
 * localStorage に状態を持たない(別端末で開いても同じ状態になる)。
 * ★'notified' を盤面を変える選択(休み/振無休/振替先)の直後に呼ばない。盤面を保存できた時点で呼ぶ
 *   (呼ぶのは App の finalizeParentAbsenceNoticesAfterSave だけ)。
 */
export async function markParentMessagesNotifiedViaFunction(input: MarkParentMessagesNotifiedRequest): Promise<{ updated: number }> {
  const messageIds = Array.from(new Set(input.messageIds.map((id) => id.trim()).filter(Boolean)))
  if (messageIds.length === 0) return { updated: 0 }
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; messageIds: string[]; stage: MarkParentMessagesNotifiedRequest['stage']; resolution?: ParentAbsenceResolution }, unknown>(
    functions,
    'markParentMessagesNotified',
    { timeout: PARENT_PORTAL_CALLABLE_TIMEOUT_MS },
  )
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId: input.classroomId,
    messageIds,
    stage: input.stage,
    ...(input.resolution ? { resolution: input.resolution } : {}),
  })
  const updated = readRecord(result.data).updated
  return { updated: typeof updated === 'number' && Number.isFinite(updated) ? updated : 0 }
}

/**
 * 自教室の未処理の休み連絡を購読する(§E-2 1.〜2.)。
 * - パスは `workspaces/{ws}/classroomSnapshots/{classroomId}/parentMessages`(教室分離はパスで担保。他教室は購読しない)。
 * - 条件は `where('notifiedAt', '==', null)` の等値 1 つだけ。orderBy を足すと複合インデックスが要る
 *   (FAILED_PRECONDITION が画面では空/INTERNAL に見える・CLAUDE.md 2026-09-12 の教訓)。並べ替えは
 *   mergeParentMessageNotifications がクライアント側で行う。
 * - **毎回、未処理の全件(snapshot.docs)を渡す**(2026-09-18)。差分(docChanges)だけを渡していた頃は、保存待ち
 *   (pending)を捨てたとき(教室データの読み直し・復元)にその連絡をモーダルへ戻す手段が無かった。全件を持てば
 *   「全件 − 保存待ち」で導出でき、処理済みになった doc はクエリから外れて自動で消える。0 件でも渡す。
 * - lectureSubmissions のような lastSavedAt ウォーターマークは使わない(保存前に届いた連絡を落としてしまう)。
 * - doc.classroomId が購読教室と違う doc は捨てる(パスが正しくても doc 側の教室タグを権威として二重に守る・INV-08)。
 * - 旧形式(自由記述)の doc は parseParentMessageEntry が null を返すので渡らない。
 */
export function subscribeParentMessages(
  classroomId: string,
  onChange: (entries: ParentMessageEntry[]) => void,
): () => void {
  const db = getFirebaseFirestoreInstance()
  const config = getFirebaseBackendConfig()
  if (!db || !classroomId || !config.workspaceKey) return () => {}

  const q = query(
    collection(db, 'workspaces', config.workspaceKey, 'classroomSnapshots', classroomId, 'parentMessages'),
    where('notifiedAt', '==', null),
  )

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const entries: ParentMessageEntry[] = []
    for (const doc of snapshot.docs) {
      const entry = parseParentMessageEntry(doc.id, doc.data())
      if (!entry) continue
      if (entry.classroomId !== classroomId) continue
      entries.push(entry)
    }
    onChange(entries)
  }, (error) => {
    // ★エラーコールバックを省くと、ルール未反映(permission-denied)や索引不足が「連絡 0 件」と
    //   見分けられず**無音で機能しない**。Firestore ルールは main マージでは反映されないので、
    //   この経路は実際に踏みうる(レビュー指摘 2026-09-13)。本文・生徒名・トークンは出さず code だけ残す。
    console.error('[parentMessages] subscribe failed', error.code)
  })

  return unsubscribe
}

/** 履歴の購読で読む件数。確認済 10 件＋旧形式(自由記述)の doc が混ざる分の余裕。 */
export const PARENT_MESSAGE_HISTORY_FETCH_LIMIT = 50

/**
 * 「保護者連絡」ボタンの履歴用に、自教室の休み連絡を**処理済みも含めて**新しい順に購読する(2026-09-19)。
 * - 未処理の購読(subscribeParentMessages)とは別に持つ。未処理は件数制限なしで全件が要る(モーダルの権威)が、
 *   履歴は直近だけでよい。ここを未処理の権威に使わない(limit で古い未処理が落ちる)。
 * - orderBy は単一フィールド(createdAt)だけ = 自動索引で足りる。where と組み合わせない(複合インデックスが要る)。
 * - 読み取りだけ。教室分離・旧形式の除外は subscribeParentMessages と同じ(INV-08)。
 */
export function subscribeParentMessageHistory(
  classroomId: string,
  onChange: (entries: ParentMessageEntry[]) => void,
): () => void {
  const db = getFirebaseFirestoreInstance()
  const config = getFirebaseBackendConfig()
  if (!db || !classroomId || !config.workspaceKey) return () => {}

  const q = query(
    collection(db, 'workspaces', config.workspaceKey, 'classroomSnapshots', classroomId, 'parentMessages'),
    orderBy('createdAt', 'desc'),
    limit(PARENT_MESSAGE_HISTORY_FETCH_LIMIT),
  )

  return onSnapshot(q, (snapshot) => {
    const entries: ParentMessageEntry[] = []
    for (const doc of snapshot.docs) {
      const entry = parseParentMessageEntry(doc.id, doc.data())
      if (!entry) continue
      if (entry.classroomId !== classroomId) continue
      entries.push(entry)
    }
    onChange(entries)
  }, (error) => {
    console.error('[parentMessages] history subscribe failed', error.code)
  })
}
