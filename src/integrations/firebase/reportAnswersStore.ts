// 「質問・要望」への回答(docs/spec-developer-report.md §G-3 / §G-5・2026-09-28)のクライアント側 Firebase 経路。
// - 室長側: 自教室の `classroomSnapshots/{classroomId}/reportAnswers` を購読し(read のみ)、既読は callable
//   `markReportAnswersRead` で付ける(write は Cloud Function のみ・localStorage に既読を持たない)。
// - 開発者側: 回答は callable `answerDeveloperReport`、解決済みの印は callable `resolveDeveloperReport`(どちらも requireDeveloperMember)だけが書く。
// ここに Firestore 直書き(set / update 系の関数)を足さない(parentPortal.ts と同じ作法・INV-08)。
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'

import { parseReportAnswerEntry, REPORT_ANSWER_HISTORY_LIMIT, type ReportAnswerEntry } from '../../utils/reportAnswers'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'

function requireFunctions() {
  const functions = getFirebaseFunctionsInstance()
  if (!functions) {
    throw new Error('Firebase Functions を利用できません。接続設定を確認してください。')
  }
  return functions
}

const REPORT_ANSWERS_CALLABLE_TIMEOUT_MS = 60_000

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * 自教室の質問・要望(回答待ち＋回答済み)を新しい順に購読する。1 本の購読で「未読件数(バッジ)」と「履歴」の両方を導く
 * (未読は countUnreadReportAnswers でクライアント側に数える。where と orderBy を組み合わせると複合インデックスが要るため、
 *  orderBy は単一フィールド(reportedAt)だけ = 自動索引で足りる・CLAUDE.md 2026-09-12 の教訓)。
 * - パスで教室分離。doc.classroomId が違う doc は捨てる(二重の防波堤・INV-08)。
 * - 毎回、全件(snapshot.docs)を渡す。0 件でも渡す(教室切替で前の教室の履歴を残さない)。
 */
export function subscribeReportAnswers(
  classroomId: string,
  onChange: (entries: ReportAnswerEntry[]) => void,
): () => void {
  const db = getFirebaseFirestoreInstance()
  const config = getFirebaseBackendConfig()
  if (!db || !classroomId || !config.workspaceKey) return () => {}

  const q = query(
    collection(db, 'workspaces', config.workspaceKey, 'classroomSnapshots', classroomId, 'reportAnswers'),
    orderBy('reportedAt', 'desc'),
    limit(REPORT_ANSWER_HISTORY_LIMIT),
  )

  return onSnapshot(q, (snapshot) => {
    const entries: ReportAnswerEntry[] = []
    for (const doc of snapshot.docs) {
      const entry = parseReportAnswerEntry(doc.id, doc.data())
      if (!entry) continue
      if (entry.classroomId !== classroomId) continue
      entries.push(entry)
    }
    onChange(entries)
  }, (error) => {
    // ★エラーコールバックを省くと、ルール未反映(permission-denied)が「履歴 0 件」と見分けられず無音で機能しない。
    //   Firestore ルールは main マージでは反映されない(firebase deploy --only firestore:rules)。本文は出さず code だけ残す。
    console.error('[reportAnswers] subscribe failed', error.code)
  })
}

/** 室長が「確認しました」(既読)。サーバーが readAt を部分更新する。0 件なら呼ばない。 */
export async function markReportAnswersReadViaFunction(input: { classroomId: string; reportIds: string[] }): Promise<{ updated: number }> {
  const reportIds = Array.from(new Set(input.reportIds.map((id) => id.trim()).filter(Boolean)))
  if (reportIds.length === 0) return { updated: 0 }
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; reportIds: string[] }, unknown>(functions, 'markReportAnswersRead', { timeout: REPORT_ANSWERS_CALLABLE_TIMEOUT_MS })
  const result = await callable({ workspaceKey: config.workspaceKey, classroomId: input.classroomId, reportIds })
  const updated = readRecord(result.data).updated
  return { updated: typeof updated === 'number' && Number.isFinite(updated) ? updated : 0 }
}

export type AnswerDeveloperReportResult = {
  reportId: string
  classroomId: string
  answeredAt: string
  answerRevision: number
  isRevision: boolean
}

/** 開発者が回答を送る(callable `answerDeveloperReport`・requireDeveloperMember)。 */
export async function answerDeveloperReportViaFunction(input: { reportId: string; answer: string }): Promise<AnswerDeveloperReportResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; reportId: string; answer: string }, unknown>(functions, 'answerDeveloperReport', { timeout: REPORT_ANSWERS_CALLABLE_TIMEOUT_MS })
  const result = await callable({ workspaceKey: config.workspaceKey, reportId: input.reportId, answer: input.answer })
  const data = readRecord(result.data)
  return {
    reportId: typeof data.reportId === 'string' ? data.reportId : input.reportId,
    classroomId: typeof data.classroomId === 'string' ? data.classroomId : '',
    answeredAt: typeof data.answeredAt === 'string' ? data.answeredAt : '',
    answerRevision: typeof data.answerRevision === 'number' ? data.answerRevision : 0,
    isRevision: data.isRevision === true,
  }
}

export type ResolveDeveloperReportResult = { reportId: string; resolved: boolean; resolvedAt: string | null }

/**
 * 開発者が報告を「解決済み」にする／未解決に戻す(callable `resolveDeveloperReport`・requireDeveloperMember・2026-09-28)。
 * developerReports だけに書き、室長側の reportAnswers には写さない(室長には見せない)。
 */
export async function resolveDeveloperReportViaFunction(input: { reportId: string; resolved: boolean }): Promise<ResolveDeveloperReportResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; reportId: string; resolved: boolean }, unknown>(functions, 'resolveDeveloperReport', { timeout: REPORT_ANSWERS_CALLABLE_TIMEOUT_MS })
  const result = await callable({ workspaceKey: config.workspaceKey, reportId: input.reportId, resolved: input.resolved })
  const data = readRecord(result.data)
  return {
    reportId: typeof data.reportId === 'string' ? data.reportId : input.reportId,
    resolved: data.resolved === true,
    resolvedAt: typeof data.resolvedAt === 'string' && data.resolvedAt ? data.resolvedAt : null,
  }
}
