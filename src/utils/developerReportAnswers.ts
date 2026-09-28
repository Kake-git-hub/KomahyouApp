// 開発者画面「質問への回答」サブページの純粋ロジック(docs/spec-developer-report.md §G-3・オーナー確定 2026-09-28)。
// 一覧の絞り込み・並び・送信可否の判定だけ。Firestore への書き込みは callable answerDeveloperReport(integrations/firebase/reportAnswersStore.ts)。

import type { DeveloperReportRecord } from './developerDashboard'

export const DEVELOPER_REPORT_ANSWER_LIMIT = 4000

/**
 * 「公開してよい回答」の基準(§G-4・叩き台=仮置き ②)。承認画面のチェック項目。
 * 基準が確定するまでは 1 つのチェックで全項目を確認した扱いにする(オーナーが一人で運用するため手数を減らす)。
 */
export const REPORT_ANSWER_GUIDELINES: readonly string[] = [
  '個別教室の中身(生徒名・講師名・具体的な配置)を書いていない',
  '他教室の名前・事例を出していない',
  '未リリース機能・対応時期を約束していない',
  '料金・契約・請求に触れていない',
  '操作手順は現行の実装で再現できるものだけ(マニュアル・仕様に根拠がある)',
  '復元・削除など不可逆操作の手順を室長に指示していない',
  'メールアドレス・UID・トークン・保存先パス・文書 ID を書いていない',
]

/**
 * 一覧の絞り込み。「解決済み」(2026-09-28・オーナー指示)は回答の有無と独立した開発者の対応完了の印で、
 * 未回答/回答済み には出さず「解決済み」にまとめる(LINE で対応済みの質問を未回答から消すため)。「すべて」は全部。
 */
export type ReportAnswerFilter = 'unanswered' | 'answered' | 'resolved' | 'all'

export const REPORT_ANSWER_FILTERS: readonly ReportAnswerFilter[] = ['unanswered', 'answered', 'resolved', 'all']

export const REPORT_ANSWER_FILTER_LABELS: Readonly<Record<ReportAnswerFilter, string>> = {
  unanswered: '未回答',
  answered: '回答済み',
  resolved: '解決済み',
  all: 'すべて',
}

/** 回答の対象になる報告: テスト送信と確認リストは除く(室長側の履歴にも載らない)。 */
export function selectAnswerableReports(records: readonly DeveloperReportRecord[]): DeveloperReportRecord[] {
  return records.filter((record) => !record.isTest && !record.isVerificationChecklist)
}

export function isReportAnswered(record: Pick<DeveloperReportRecord, 'answerFinal' | 'answeredAt'>): boolean {
  return Boolean(record.answerFinal && record.answeredAt)
}

/** 開発者が「解決済み」にした報告か(室長側には出さない印・developerReports.resolvedAt)。 */
export function isReportResolved(record: Pick<DeveloperReportRecord, 'resolvedAt'>): boolean {
  return Boolean(record.resolvedAt)
}

/** 一覧の状態表示。解決済みを最優先(回答済みでも解決済みなら「解決済み」)。 */
export function formatReportAnswerRowStatus(record: Pick<DeveloperReportRecord, 'answerFinal' | 'answeredAt' | 'answerRevision' | 'resolvedAt'>): { label: string; tone: 'resolved' | 'read' | 'pending' } {
  if (isReportResolved(record)) return { label: isReportAnswered(record) ? '解決済み(回答あり)' : '解決済み', tone: 'resolved' }
  if (isReportAnswered(record)) return { label: `回答済み(${record.answerRevision} 版)`, tone: 'read' }
  return { label: '未回答', tone: 'pending' }
}

/** 絞り込み＋並び(新しい順)。教室 ID を渡すとその教室だけ。 */
export function filterReportsForAnswering(
  records: readonly DeveloperReportRecord[],
  options: { filter: ReportAnswerFilter; classroomId?: string | null },
): DeveloperReportRecord[] {
  return selectAnswerableReports(records)
    .filter((record) => (options.classroomId ? record.classroomId === options.classroomId : true))
    .filter((record) => {
      if (options.filter === 'all') return true
      if (options.filter === 'resolved') return isReportResolved(record)
      if (isReportResolved(record)) return false
      return options.filter === 'answered' ? isReportAnswered(record) : !isReportAnswered(record)
    })
    .sort((a, b) => (b.recordedAt || b.reportedAt).localeCompare(a.recordedAt || a.reportedAt))
}

export type ReportAnswerSubmitCheck = { ok: true; answer: string } | { ok: false; reason: string }

export const REPORT_ANSWER_SUBMIT_ERRORS = {
  empty: '回答を入力してください。',
  tooLong: `回答は ${DEVELOPER_REPORT_ANSWER_LIMIT} 文字以内で入力してください。`,
  unconfirmed: '「公開してよい回答」の基準を確認してチェックを入れてください。',
  unchanged: '回答の内容が今の回答と同じです。',
} as const

/**
 * 「回答を送る」を押せるか(§I-4: 基準のチェックを全部満たさないと押せない)。
 * 既に回答済みの報告に同じ本文を送ろうとしたら止める(無駄な改訂で室長側の updatedAt だけが動くのを防ぐ)。
 */
export function checkReportAnswerSubmit(input: { answer: string; guidelinesConfirmed: boolean; currentAnswer?: string | null }): ReportAnswerSubmitCheck {
  const answer = input.answer.replace(/\r\n?/gu, '\n').trim()
  if (!answer) return { ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.empty }
  if (answer.length > DEVELOPER_REPORT_ANSWER_LIMIT) return { ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.tooLong }
  if (!input.guidelinesConfirmed) return { ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.unconfirmed }
  if (input.currentAnswer && input.currentAnswer.trim() === answer) return { ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.unchanged }
  return { ok: true, answer }
}

/** 送信後のメッセージ。初回と改訂で文言を変える(改訂は既読を戻さない旨を添える)。 */
export function buildReportAnswerSentMessage(result: { classroomName: string; isRevision: boolean; answerRevision: number }): string {
  const target = result.classroomName ? `「${result.classroomName}」` : 'その教室'
  return result.isRevision
    ? `回答を更新しました(${result.answerRevision} 版)。${target}の履歴では新しい本文に置き換わります(既読だった場合は未読に戻りません)。`
    : `回答を送りました。${target}の「質問・要望」ボタンに未読 1 件として表示されます。`
}

/** 「解決済みにする」「未解決に戻す」のあとのメッセージ。室長側には出ないことを必ず添える。 */
export function buildReportResolveMessage(resolved: boolean): string {
  return resolved
    ? '解決済みにしました(室長の画面には表示されません)。一覧の「解決済み」で見られます。'
    : '未解決に戻しました。'
}
