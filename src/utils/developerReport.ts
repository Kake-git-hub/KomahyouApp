// 「要望・報告」の送信内容（クライアント側の純粋ロジック）。
//
// 背景（2026-09-04 オーナー指示）: 室長が「バグがあったが忙しくて自分で対処した」と後から言い、何が起きたか追えなかった。
// 忙しくても**ボタン1つ**で開発者へ知らせられるようにする。同日の改定で:
//  - 一言は**必須**（空欄では送れない）。
//  - ボタン名は「要望・報告」。不具合だけでなく**追加要望**も同じ導線で送れる（category = bug / request）。
//  - 内容に `#テスト` を含めるとテスト扱い（サーバーが Issue 起票をしない。メールは【テスト】付きで届く）。
//
// 送るもの（サーバーの Cloud Function `submitDeveloperReport` が受ける）:
//  - 教室・報告元(盤面/日程表)・種類(不具合/要望)・内容・アプリ版数・UA・報告時刻
//  - 直近の操作痕跡（operationTrace.ts の端末内リングバッファ。ここで初めて端末外へ出る）
//  - 報告時点の**メモリ上の教室データ**（未保存の変更も含む。サーバー側で Storage へ保存し、開発者が再現に使う）
//  - 日程表からの報告なら、その日程表で表示していた条件（種別・期間・選択人物）
//
// 送らないもの: 認証情報・他教室のデータ。実行者と受領時刻はサーバーが付ける（自己申告にしない＝操作ログと同じ）。

import type { AppSnapshotPayload } from '../types/appState'
import type { OperationTraceEntry } from './operationTrace'

export type DeveloperReportSource = 'board' | 'schedule'
/** 種類: 不具合・おかしい(bug) / 追加要望(request)。サーバー functions/src/developerReport.ts と二重管理。 */
export const DEVELOPER_REPORT_CATEGORIES = ['bug', 'request'] as const
export type DeveloperReportCategory = (typeof DEVELOPER_REPORT_CATEGORIES)[number]

/** 日程表タブから postMessage で届く、表示していた条件。文字列だけ（入れ子は受け付けない）。 */
export type DeveloperReportScheduleContext = Record<string, string>

export type DeveloperReportRequestBody = {
  classroomId: string
  source: DeveloperReportSource
  category: DeveloperReportCategory
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

/** 内容の上限。長文はここで切る（サーバーも同じ値で切る）。 */
export const DEVELOPER_REPORT_NOTE_LIMIT = 2000
/** 同梱する操作痕跡の上限（新しい方から）。Firestore 文書 1MiB に収まる量。 */
export const DEVELOPER_REPORT_TRACE_LIMIT = 300
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT = 12
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT = 200
/** テスト扱いの目印（内容に含める）。サーバー側 `isDeveloperReportTestNote` と同じ判定。 */
export const DEVELOPER_REPORT_TEST_MARKER = '#テスト'

/**
 * モーダルの文言（盤面 React モーダルと日程表タブの同一モーダルで共用。オーナー指示 2026-09-04: 両方同じ表示・文言にする）。
 * 内容は**必須**（「空欄のままでも送れます」は撤回）。
 */
export const DEVELOPER_REPORT_UI_TEXT = {
  /** ボタン名・モーダル題名（オーナー確定 2026-09-04: 「開発者へ報告」→「要望・報告」） */
  title: '要望・報告',
  description: (classroomName: string) =>
    `「おかしいな」と思ったことも、「こうしてほしい」という要望も、そのまま送ってください。${classroomName ? `教室「${classroomName}」の` : ''}直近の操作履歴と、いまの画面のデータが開発者に届きます。`,
  categoryLabel: '種類',
  categoryOptions: [
    { value: 'bug', label: '不具合・おかしい' },
    { value: 'request', label: '追加してほしい・要望' },
  ] as ReadonlyArray<{ value: DeveloperReportCategory; label: string }>,
  noteLabel: '内容（必須）',
  placeholder: '例: 9/3(水) 3限、田中先生の机で、青木さんの振替(数学)を移動したら未消化に戻らなかった ／ 講師日程表にも電話番号の欄がほしい',
  /** 入力のヒント(オーナー指示 2026-09-04): 詳細を書いてもらうほど開発者の確認精度が上がることを伝える。 */
  inputHint: '生徒名・日付・コマ(何限)・どの操作をしたら何が起きたか(期待した結果との違い)を具体的に書いていただくと、確認の精度が上がります。',
  testHint: `テスト送信のときは内容に「${DEVELOPER_REPORT_TEST_MARKER}」と書いてください（開発者への課題登録は行われません）。`,
  requiredError: '内容を入力してください。何がおかしいか・何をしてほしいかが分からないと、開発者が調べられません。',
  cancel: 'キャンセル',
  submit: '送信する',
  sending: '送信中…',
  close: '閉じる',
} as const

export function normalizeDeveloperReportNote(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.replace(/\r\n?/gu, '\n').trim()
  return trimmed.length > DEVELOPER_REPORT_NOTE_LIMIT ? trimmed.slice(0, DEVELOPER_REPORT_NOTE_LIMIT) : trimmed
}

/** 内容の必須チェック。問題なければ null、あれば利用者向けのエラー文。 */
export function validateDeveloperReportNote(raw: unknown): string | null {
  return normalizeDeveloperReportNote(raw) ? null : DEVELOPER_REPORT_UI_TEXT.requiredError
}

export function normalizeDeveloperReportCategory(raw: unknown): DeveloperReportCategory {
  return typeof raw === 'string' && (DEVELOPER_REPORT_CATEGORIES as readonly string[]).includes(raw) ? raw as DeveloperReportCategory : 'bug'
}

/** 内容に「#テスト」(または #test) が含まれればテスト扱い。サーバーと同じ判定（表示の先読み用）。 */
export function isDeveloperReportTestNote(note: string): boolean {
  return note.includes(DEVELOPER_REPORT_TEST_MARKER) || /#test\b/iu.test(note)
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

/** 日程表タブからの postMessage の種別（scheduleHtml.ts の埋め込みスクリプトと一致させる）。 */
export const SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE = 'schedule-developer-report'
export const SCHEDULE_DEVELOPER_REPORT_RESULT_MESSAGE_TYPE = 'schedule-developer-report-result'

/**
 * 日程表タブからの報告メッセージを検証する。type が違えば null。
 * note の必須判定は呼び出し側（validateDeveloperReportNote）が担う。
 */
export function parseScheduleDeveloperReportMessage(message: unknown): { note: string; category: DeveloperReportCategory; scheduleContext?: DeveloperReportScheduleContext } | null {
  if (!message || typeof message !== 'object') return null
  const candidate = message as { type?: unknown; note?: unknown; category?: unknown; context?: unknown }
  if (candidate.type !== SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE) return null
  return {
    note: normalizeDeveloperReportNote(candidate.note),
    category: normalizeDeveloperReportCategory(candidate.category),
    scheduleContext: normalizeDeveloperReportScheduleContext(candidate.context),
  }
}

export function buildDeveloperReportRequestBody(input: {
  classroomId: string
  source: DeveloperReportSource
  category: DeveloperReportCategory
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
    category: normalizeDeveloperReportCategory(input.category),
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

export type DeveloperReportSubmitResult =
  | { ok: true; reportId: string; isTest?: boolean }
  | { ok: false; error: string }

/** 送信結果を利用者向けの1文にする（盤面モーダル・日程表タブのモーダルで共用）。 */
export function formatDeveloperReportResultMessage(result: DeveloperReportSubmitResult): string {
  if (result.ok) {
    if (result.isTest) return `テストとして受け付けました（受付番号 ${result.reportId}）。開発者への課題登録は行いません。`
    return `開発者へ送りました（受付番号 ${result.reportId}）。ありがとうございます。`
  }
  return `送れませんでした: ${result.error}\n時間をおいて再度お試しください。`
}
