// 「質問・要望」への回答を室長側で読むための純粋ロジック(docs/spec-developer-report.md §G-5・オーナー確定 2026-09-28)。
//
// - 室長が読む文書は `classroomSnapshots/{classroomId}/reportAnswers/{reportId}`(サーバー functions/src/reportAnswers.ts が書く)。
//   質問文(自教室の室長が書いたもの)・回答・回答日時・既読だけ。教室データ・操作痕跡・送信者は入っていない。
// - 見せ方(オーナー確定 2026-09-28): **自動で開くモーダルは出さない**。「質問・要望」ボタンに未読件数のバッジを出し、
//   押すと同じモーダルの「これまでの質問と回答」で読める。既読はサーバー(callable markReportAnswersRead)が持つ。
// - このファイルは純データ＋純関数のみ。Firestore / DOM には触らない(購読・callable は integrations/firebase/reportAnswersStore.ts)。

import type { DeveloperReportCategory } from './developerReport'

export type ReportAnswerEntry = {
  id: string
  classroomId: string
  category: DeveloperReportCategory
  source: string
  questionNote: string
  questionSummary: string
  reportedAt: string
  /** 開発者の回答。null = 回答待ち。 */
  answer: string | null
  answeredAt: string | null
  answerRevision: number
  readAt: string | null
}

export type ReportAnswerStatus = 'pending' | 'unread' | 'read'

/** 履歴に出す最大件数(購読の limit)。古いものは開発者側の記録(developerReports)に残る。 */
export const REPORT_ANSWER_HISTORY_LIMIT = 100

export const REPORT_ANSWER_CATEGORY_LABELS: Readonly<Record<DeveloperReportCategory, string>> = {
  question: '質問',
  request: '要望',
  bug: '不具合',
}

export const REPORT_ANSWER_STATUS_LABELS: Readonly<Record<ReportAnswerStatus, string>> = {
  pending: '回答待ち',
  unread: '新しい回答',
  read: '回答済み',
}

export const REPORT_ANSWER_UI_TEXT = {
  sendTab: '送る',
  historyTab: 'これまでの質問と回答',
  historyLead: '新しいものが上です。開発者からの回答が届くと、ここに表示され、ボタンに未読の件数が付きます。',
  historyEmpty: 'まだ送った質問・要望はありません。',
  historyEmptyNote: '(この一覧には、これから送るものが載ります)',
  markRead: '確認しました',
  markAllRead: 'すべて確認しました',
  pendingNote: '開発者が確認してから回答します。',
  revisedNote: '(回答が更新されました)',
} as const

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeCategory(value: unknown): DeveloperReportCategory {
  return value === 'request' || value === 'question' ? value : 'bug'
}

/** Firestore の文書を画面用に読む。壊れた文書(reportId / classroomId / 本文が無い)は null(表示しない)。 */
export function parseReportAnswerEntry(id: string, data: unknown): ReportAnswerEntry | null {
  if (!id || typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const classroomId = readText(record.classroomId)
  const questionNote = readText(record.questionNote)
  if (!classroomId || !questionNote) return null
  const revision = typeof record.answerRevision === 'number' && Number.isFinite(record.answerRevision) ? Math.max(0, Math.trunc(record.answerRevision)) : 0
  return {
    id,
    classroomId,
    category: normalizeCategory(record.category),
    source: readText(record.source),
    questionNote,
    questionSummary: readText(record.questionSummary) || questionNote.replace(/\s+/gu, ' ').trim().slice(0, 120),
    reportedAt: readText(record.reportedAt),
    answer: readNullableText(record.answer),
    answeredAt: readNullableText(record.answeredAt),
    answerRevision: revision,
    readAt: readNullableText(record.readAt),
  }
}

/** 教室分離(INV-08): 購読パスが正しくても doc 側の教室タグを権威として二重に守る。 */
export function selectReportAnswersForClassroom(entries: readonly ReportAnswerEntry[], classroomId: string | null | undefined): ReportAnswerEntry[] {
  if (!classroomId) return []
  return entries.filter((entry) => entry.classroomId === classroomId)
}

/** 状態: 回答が無い=回答待ち／回答があり readAt 無し=未読／回答があり readAt あり=既読。 */
export function resolveReportAnswerStatus(entry: Pick<ReportAnswerEntry, 'answer' | 'answeredAt' | 'readAt'>): ReportAnswerStatus {
  if (!entry.answer || !entry.answeredAt) return 'pending'
  return entry.readAt ? 'read' : 'unread'
}

export function isUnreadReportAnswer(entry: Pick<ReportAnswerEntry, 'answer' | 'answeredAt' | 'readAt'>): boolean {
  return resolveReportAnswerStatus(entry) === 'unread'
}

/** ボタンのバッジに出す未読の回答の件数。 */
export function countUnreadReportAnswers(entries: readonly ReportAnswerEntry[]): number {
  return entries.reduce((count, entry) => count + (isUnreadReportAnswer(entry) ? 1 : 0), 0)
}

export function selectUnreadReportAnswerIds(entries: readonly ReportAnswerEntry[]): string[] {
  return entries.filter(isUnreadReportAnswer).map((entry) => entry.id)
}

/**
 * 履歴の並び: 新しいものが上。時刻は「回答日時があればそれ、なければ送信日時」で比べる
 * (回答が付いた質問は付いた時点で上に来る=気づきやすい)。同時刻は id で安定させる。
 */
export function sortReportAnswerEntries(entries: readonly ReportAnswerEntry[]): ReportAnswerEntry[] {
  const key = (entry: ReportAnswerEntry) => entry.answeredAt ?? entry.reportedAt
  return [...entries].sort((a, b) => {
    const diff = key(b).localeCompare(key(a))
    return diff !== 0 ? diff : b.id.localeCompare(a.id)
  })
}

export type DeveloperReportModalTab = 'send' | 'history'

/** モーダルを開いたときのタブ。未読の回答があるときだけ履歴を先に見せる(それ以外は従来どおり送信フォーム)。 */
export function resolveDeveloperReportModalInitialTab(unreadCount: number): DeveloperReportModalTab {
  return unreadCount > 0 ? 'history' : 'send'
}

/** ボタンの未読バッジ。0 以下は出さない(親は null を受けたら span を描かない)。 */
export function formatReportAnswerBadge(unreadCount: number): string | null {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return null
  return unreadCount > 99 ? '99+' : String(Math.trunc(unreadCount))
}

/** 「◯月◯日 ◯:◯◯」(JST)。不正な時刻は空文字。 */
export function formatReportAnswerDateLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const jst = new Date(ms + 9 * 3_600_000)
  const minutes = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.getUTCHours()}:${minutes}`
}
