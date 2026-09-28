// 「質問・要望」への回答(docs/spec-developer-report.md §G-3 / §G-5・オーナー確定 2026-09-28)。
//
// 室長へ返す回答と、室長側の「これまでの質問と回答」履歴のための**純粋ロジック**。Firestore・HttpsError には触れない
// (index.ts の callable `answerDeveloperReport` / `markReportAnswersRead` と `submitDeveloperReport` が入出力を担う)。
//
// データの置き場所:
//  - 回答の権威は developerReports/{reportId}(answerFinal / answeredAt / answeredBy / answerRevision)。開発者のみ read。
//  - 室長の端末が読むのは軽量文書 `classroomSnapshots/{classroomId}/reportAnswers/{reportId}`(教室ごとのパス =
//    parentMessages と同じ作法・INV-08)。**教室データ・操作痕跡・送信者情報は載せない**(§G-5)。
//    送信時に「回答待ち」の文書を作り、回答が付くと同じ文書に回答を追記する(室長は自分が送った質問も履歴で読み返せる)。
//  - 既読(readAt)はサーバーが持つ(localStorage は使わない・端末をまたいで同じ状態)。回答本文の更新(revision +1)は
//    既読を未読に戻さない(§G-3「利用者を驚かせない」)。

export const REPORT_ANSWER_LIMIT = 4000
export const REPORT_QUESTION_SUMMARY_LIMIT = 120
export const REPORT_ANSWERS_COLLECTION = 'reportAnswers'

export type ReportAnswerCategory = 'bug' | 'request' | 'question'

/** 室長側の軽量文書。送信時(回答待ち)と回答時(回答済み)の両方でこの形。 */
export type ReportAnswerDoc = {
  reportId: string
  classroomId: string
  category: ReportAnswerCategory
  /** 送信元(board / schedule)。表示用。 */
  source: string
  /** 利用者が書いた本文(自教室の室長が書いたものなので自教室へ返してよい)。 */
  questionNote: string
  questionSummary: string
  reportedAt: string
  /** 開発者の回答。null = 回答待ち。 */
  answer: string | null
  answeredAt: string | null
  answerRevision: number
  /** 室長が「確認しました」を押した時刻。null = 未読(回答があるときだけ意味を持つ)。 */
  readAt: string | null
  /** 未読の回答があるか(= answeredAt あり && readAt null)。将来の等値クエリ用の写しで、権威は readAt(クライアントも readAt で判定)。 */
  unreadAnswer: boolean
  updatedAt: string
}

export type ReportAnswerSourceReport = {
  reportId: string
  classroomId: string
  category: string
  source?: string
  note: string
  reportedAt?: string
  recordedAt: string
  isTest?: boolean
  isVerificationChecklist?: boolean
}

function normalizeCategory(value: unknown): ReportAnswerCategory {
  return value === 'request' || value === 'question' ? value : 'bug'
}

/** 本文の先頭を 1 行に詰めた要約(一覧の見出し用)。 */
export function summarizeReportQuestion(note: string, limit: number = REPORT_QUESTION_SUMMARY_LIMIT): string {
  const single = note.replace(/\s+/gu, ' ').trim()
  if (single.length <= limit) return single
  return `${single.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * 室長側の文書を作るべき報告か。テスト送信(#テスト)と開発用教室の確認リストは履歴に載せない
 * (確認リストは項目 id の羅列で室長の履歴としては意味が無く、テストは開発者の動作確認)。
 * 開発者が**本番教室を開いて**送った報告も載せない(室長の履歴に開発者の動作確認が混ざる・regression-reviewer 指摘 2026-09-28)。
 * 開発用教室では開発者が室長役なので載せる。開発者が後から回答を書けば、そのとき文書は作られる(planReportAnswerWrite)。
 */
export function shouldCreateReportAnswerDoc(report: Pick<ReportAnswerSourceReport, 'isTest' | 'isVerificationChecklist'> & { reporterRole?: unknown; isDevelopmentClassroom?: boolean }): boolean {
  if (report.isTest === true || report.isVerificationChecklist === true) return false
  if (report.reporterRole === 'developer' && report.isDevelopmentClassroom === false) return false
  return true
}

/** 送信時に作る「回答待ち」の文書。 */
export function buildPendingReportAnswerDoc(report: ReportAnswerSourceReport, nowIso: string): ReportAnswerDoc {
  return {
    reportId: report.reportId,
    classroomId: report.classroomId,
    category: normalizeCategory(report.category),
    source: typeof report.source === 'string' ? report.source : '',
    questionNote: report.note,
    questionSummary: summarizeReportQuestion(report.note),
    reportedAt: report.reportedAt || report.recordedAt,
    answer: null,
    answeredAt: null,
    answerRevision: 0,
    readAt: null,
    unreadAnswer: false,
    updatedAt: nowIso,
  }
}

export type AnswerDeveloperReportRequest = {
  workspaceKey: string
  reportId: string
  answer: string
}

export type NormalizedAnswerRequest = { ok: true; value: AnswerDeveloperReportRequest } | { ok: false; reason: string }

export const REPORT_ANSWER_ERROR_EMPTY = '回答を入力してください。'
export const REPORT_ANSWER_ERROR_TOO_LONG = `回答は ${REPORT_ANSWER_LIMIT} 文字以内で入力してください。`

/** callable `answerDeveloperReport` の入力検証(本文長・必須)。 */
export function normalizeAnswerDeveloperReportRequest(raw: unknown): NormalizedAnswerRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: '入力の形式が正しくありません。' }
  const data = raw as Record<string, unknown>
  const workspaceKey = typeof data.workspaceKey === 'string' ? data.workspaceKey.trim() : ''
  const reportId = typeof data.reportId === 'string' ? data.reportId.trim() : ''
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey を指定してください。' }
  if (!reportId || !/^[A-Za-z0-9_-]{1,80}$/u.test(reportId)) return { ok: false, reason: 'reportId の形式が正しくありません。' }
  const answer = typeof data.answer === 'string' ? data.answer.replace(/\r\n?/gu, '\n').trim() : ''
  if (!answer) return { ok: false, reason: REPORT_ANSWER_ERROR_EMPTY }
  if (answer.length > REPORT_ANSWER_LIMIT) return { ok: false, reason: REPORT_ANSWER_ERROR_TOO_LONG }
  return { ok: true, value: { workspaceKey, reportId, answer } }
}

export type ReportAnswerWritePlan = {
  /** developerReports/{reportId} へ merge する内容(既存フィールドは触らない)。 */
  reportUpdate: { answerFinal: string; answeredAt: string; answeredBy: string; answerRevision: number }
  /** classroomSnapshots/{classroomId}/reportAnswers/{reportId} へ set(merge) する内容。 */
  answerDoc: ReportAnswerDoc
  isRevision: boolean
}

/**
 * 回答の書き込み計画。状態遷移は一方向(未回答 → 回答済み)。回答済みへの再回答は本文更新(revision +1)で、
 * 既読(readAt)は**触らない**(未読へ戻さない・§G-3)。室長側文書が無い(旧報告・テスト扱いだった等)ときはここで作る。
 */
export function planReportAnswerWrite(input: {
  report: ReportAnswerSourceReport & { answerRevision?: unknown }
  existingAnswerDoc: Partial<ReportAnswerDoc> | null
  answer: string
  answeredBy: string
  nowIso: string
}): ReportAnswerWritePlan {
  const previousRevision = typeof input.report.answerRevision === 'number' && Number.isFinite(input.report.answerRevision) && input.report.answerRevision > 0
    ? Math.trunc(input.report.answerRevision)
    : 0
  const isRevision = previousRevision > 0
  const revision = previousRevision + 1
  const base = input.existingAnswerDoc ?? buildPendingReportAnswerDoc(input.report, input.nowIso)
  const previousReadAt = typeof base.readAt === 'string' && base.readAt ? base.readAt : null
  // 初回回答は未読。改訂は既読状態をそのまま保つ(既読なら既読のまま・未読なら未読のまま)。
  // unreadAnswer は常に readAt から導く(権威は readAt。クライアントも readAt で未読を判定する・二重管理にしない)。
  const readAt = isRevision ? previousReadAt : null
  const answerDoc: ReportAnswerDoc = {
    reportId: input.report.reportId,
    classroomId: input.report.classroomId,
    category: normalizeCategory(input.report.category),
    source: typeof base.source === 'string' ? base.source : (typeof input.report.source === 'string' ? input.report.source : ''),
    questionNote: input.report.note,
    questionSummary: summarizeReportQuestion(input.report.note),
    reportedAt: input.report.reportedAt || input.report.recordedAt,
    answer: input.answer,
    answeredAt: input.nowIso,
    answerRevision: revision,
    readAt,
    unreadAnswer: readAt === null,
    updatedAt: input.nowIso,
  }
  return {
    reportUpdate: { answerFinal: input.answer, answeredAt: input.nowIso, answeredBy: input.answeredBy, answerRevision: revision },
    answerDoc,
    isRevision,
  }
}

export type MarkReportAnswersReadRequest = { workspaceKey: string; classroomId: string; reportIds: string[] }
export type NormalizedMarkReadRequest = { ok: true; value: MarkReportAnswersReadRequest } | { ok: false; reason: string }

export const REPORT_ANSWER_MARK_READ_MAX_IDS = 50

/** callable `markReportAnswersRead` の入力検証。 */
export function normalizeMarkReportAnswersReadRequest(raw: unknown): NormalizedMarkReadRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: '入力の形式が正しくありません。' }
  const data = raw as Record<string, unknown>
  const workspaceKey = typeof data.workspaceKey === 'string' ? data.workspaceKey.trim() : ''
  const classroomId = typeof data.classroomId === 'string' ? data.classroomId.trim() : ''
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey を指定してください。' }
  if (!classroomId) return { ok: false, reason: 'classroomId を指定してください。' }
  if (!Array.isArray(data.reportIds)) return { ok: false, reason: 'reportIds は配列で指定してください。' }
  const reportIds = Array.from(new Set(data.reportIds
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,80}$/u.test(id))))
  if (reportIds.length === 0) return { ok: false, reason: 'reportIds を 1 件以上指定してください。' }
  if (reportIds.length > REPORT_ANSWER_MARK_READ_MAX_IDS) return { ok: false, reason: `reportIds は ${REPORT_ANSWER_MARK_READ_MAX_IDS} 件までです。` }
  return { ok: true, value: { workspaceKey, classroomId, reportIds } }
}

export type ReportAnswerReadSnapshot = {
  id: string
  exists: boolean
  classroomId?: unknown
  answeredAt?: unknown
  readAt?: unknown
}

/**
 * 既読にする文書だけを選ぶ(部分更新)。存在しない・回答が無い・既に既読・教室タグが違う文書は触らない。
 * 更新は readAt / unreadAnswer / updatedAt の 3 フィールドだけ(部分更新・他フィールドを消さない)。
 */
export function resolveReportAnswerReadWrites(
  snapshots: ReportAnswerReadSnapshot[],
  options: { classroomId: string; nowIso: string },
): Array<{ id: string; update: { readAt: string; unreadAnswer: false; updatedAt: string } }> {
  const writes: Array<{ id: string; update: { readAt: string; unreadAnswer: false; updatedAt: string } }> = []
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue
    if (snapshot.classroomId !== options.classroomId) continue
    if (typeof snapshot.answeredAt !== 'string' || !snapshot.answeredAt) continue
    if (typeof snapshot.readAt === 'string' && snapshot.readAt) continue
    writes.push({ id: snapshot.id, update: { readAt: options.nowIso, unreadAnswer: false, updatedAt: options.nowIso } })
  }
  return writes
}
