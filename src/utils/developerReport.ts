// 「開発者へ報告」の送信内容（クライアント側の純粋ロジック）。
//
// 背景（2026-09-04 オーナー指示）: 室長が「バグがあったが忙しくて自分で対処した」と後から言い、何が起きたか追えなかった。
// 忙しくても**ボタン1つ・3秒**で開発者へ知らせられるようにする。任意の一言は空でも送れる。
//
// 送るもの（サーバーの Cloud Function `submitDeveloperReport` が受ける）:
//  - 教室・報告元(盤面/日程表)・任意の一言・アプリ版数・UA・報告時刻
//  - 直近の操作痕跡（operationTrace.ts の端末内リングバッファ。ここで初めて端末外へ出る）
//  - 報告時点の**メモリ上の教室データ**（未保存の変更も含む。サーバー側で Storage へ保存し、開発者が再現に使う）
//  - 日程表からの報告なら、その日程表で表示していた条件（種別・期間・選択人物）
//
// 送らないもの: 認証情報・他教室のデータ。実行者と受領時刻はサーバーが付ける（自己申告にしない＝操作ログと同じ）。

import type { AppSnapshotPayload } from '../types/appState'
import type { OperationTraceEntry } from './operationTrace'

export type DeveloperReportSource = 'board' | 'schedule'

/** 日程表タブから postMessage で届く、表示していた条件。文字列だけ（入れ子は受け付けない）。 */
export type DeveloperReportScheduleContext = Record<string, string>

export type DeveloperReportRequestBody = {
  classroomId: string
  source: DeveloperReportSource
  note: string
  reportedAt: string
  appVersion: string
  userAgent: string
  pageUrl: string
  screen: string
  boardDirty: boolean
  lastSavedAt: string
  recentOperations: OperationTraceEntry[]
  scheduleContext?: DeveloperReportScheduleContext
  snapshotPayload: AppSnapshotPayload | null
}

/** 任意の一言の上限。長文はここで切る（サーバーも同じ値で切る）。 */
export const DEVELOPER_REPORT_NOTE_LIMIT = 2000
/** 同梱する操作痕跡の上限（新しい方から）。Firestore 文書 1MiB に収まる量。 */
export const DEVELOPER_REPORT_TRACE_LIMIT = 300
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT = 12
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT = 200

/** 日程表タブからの postMessage の種別（scheduleHtml.ts の埋め込みスクリプトと一致させる）。 */
export const SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE = 'schedule-developer-report'
export const SCHEDULE_DEVELOPER_REPORT_RESULT_MESSAGE_TYPE = 'schedule-developer-report-result'

export function normalizeDeveloperReportNote(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.replace(/\r\n?/gu, '\n').trim()
  return trimmed.length > DEVELOPER_REPORT_NOTE_LIMIT ? trimmed.slice(0, DEVELOPER_REPORT_NOTE_LIMIT) : trimmed
}

export function normalizeDeveloperReportScheduleContext(raw: unknown): DeveloperReportScheduleContext | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: DeveloperReportScheduleContext = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT) break
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(key)) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) result[key] = trimmed.slice(0, DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT)
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = String(value)
    if (typeof value === 'boolean') result[key] = value ? 'true' : 'false'
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 日程表タブからの報告メッセージを検証する。type が違えば null。
 * note は無くてもよい（空欄でも送れる仕様）。
 */
export function parseScheduleDeveloperReportMessage(message: unknown): { note: string; scheduleContext?: DeveloperReportScheduleContext } | null {
  if (!message || typeof message !== 'object') return null
  const candidate = message as { type?: unknown; note?: unknown; context?: unknown }
  if (candidate.type !== SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE) return null
  return {
    note: normalizeDeveloperReportNote(candidate.note),
    scheduleContext: normalizeDeveloperReportScheduleContext(candidate.context),
  }
}

export function buildDeveloperReportRequestBody(input: {
  classroomId: string
  source: DeveloperReportSource
  note: unknown
  appVersion: string
  userAgent: string
  pageUrl: string
  screen: string
  boardDirty: boolean
  lastSavedAt: string
  recentOperations: OperationTraceEntry[]
  scheduleContext?: DeveloperReportScheduleContext
  snapshotPayload: AppSnapshotPayload | null
  now?: Date
}): DeveloperReportRequestBody {
  const recent = input.recentOperations.length > DEVELOPER_REPORT_TRACE_LIMIT
    ? input.recentOperations.slice(input.recentOperations.length - DEVELOPER_REPORT_TRACE_LIMIT)
    : [...input.recentOperations]
  const scheduleContext = normalizeDeveloperReportScheduleContext(input.scheduleContext)
  return {
    classroomId: input.classroomId,
    source: input.source,
    note: normalizeDeveloperReportNote(input.note),
    reportedAt: (input.now ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    userAgent: input.userAgent.slice(0, 300),
    pageUrl: input.pageUrl.slice(0, 300),
    screen: input.screen.slice(0, 40),
    boardDirty: input.boardDirty,
    lastSavedAt: input.lastSavedAt,
    recentOperations: recent,
    ...(scheduleContext ? { scheduleContext } : {}),
    snapshotPayload: input.snapshotPayload,
  }
}

/** 送信結果を利用者向けの1文にする（盤面モーダル・日程表タブの alert で共用）。 */
export function formatDeveloperReportResultMessage(result: { ok: true; reportId: string } | { ok: false; error: string }): string {
  if (result.ok) return `開発者へ報告しました（受付番号 ${result.reportId}）。ありがとうございます。`
  return `報告を送れませんでした: ${result.error}\n時間をおいて再度お試しください。`
}
