// 「質問・要望」（旧「要望・報告」）の送信内容（クライアント側の純粋ロジック）。
//
// 背景（2026-09-04 オーナー指示）: 室長が「バグがあったが忙しくて自分で対処した」と後から言い、何が起きたか追えなかった。
// 忙しくても**ボタン1つ**で開発者へ知らせられるようにする。同日の改定で:
//  - 一言は**必須**（空欄では送れない）。
//  - ボタン名は「要望・報告」。不具合だけでなく**追加要望**も同じ導線で送れる（category = bug / request）。
//  - 2026-09-13: **使い方の質問**（category = question）も同じ導線・同じ流れ（ストック → メール通知 → 後で開発者が対応）で
//    送れる。利用者への自動回答はしない（開発者が承認した回答だけを返す。docs/spec-developer-report.md §G）。
//  - 内容に `#テスト` を含めるとテスト扱い（サーバーが Issue 起票をしない。メールは【テスト】付きで届く）。
//    2026-09-14: モーダルの案内文(testHint)は削除（オーナー指示）。判定そのものは残す。
//  - 2026-09-14: ボタン名を「質問・要望」へ、種類の並びを 質問 → 要望 → 不具合 へ、モーダルの既定を質問へ（オーナー指示）。
//    `normalizeDeveloperReportCategory` の既定(不正値の丸め先)は bug のまま＝サーバーと同じ。
//  - 2026-09-14: **開発用教室だけ**、質問に AI がその場で回答する試験実装（spec §G-7・featureRollout `questionAiAnswer`）。
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
/** 種類: 不具合・おかしい(bug) / 追加要望(request) / 使い方の質問(question・2026-09-13)。サーバー functions/src/developerReport.ts と二重管理。 */
export const DEVELOPER_REPORT_CATEGORIES = ['bug', 'request', 'question'] as const
export type DeveloperReportCategory = (typeof DEVELOPER_REPORT_CATEGORIES)[number]

/** 日程表タブから postMessage で届く、表示していた条件。文字列だけ（入れ子は受け付けない）。 */
export type DeveloperReportScheduleContext = Record<string, string>

// ───────────────────────────────────────────────────────────────────────────
// 添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)。
// 開発用教室の確認リストから、項目ごとのスクリーンショットを報告に同梱する。画像は data URL(base64)で送り、
// サーバーが Storage(developer-reports/… の報告と同じ場所)へ保存して文書に保存先を残す。Firestore 文書には画像本体を入れない。
// 一般の「質問・要望」モーダルには(まだ)付けない＝送信経路だけ共通。サーバー functions/src/developerReport.ts と二重管理(値を揃える)。
// ───────────────────────────────────────────────────────────────────────────
export const DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type DeveloperReportAttachmentMimeType = (typeof DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES)[number]
/** 1 通に付けられる枚数。 */
export const DEVELOPER_REPORT_ATTACHMENT_LIMIT = 8
/** 1 枚のデコード後バイト数の上限(クライアントは 1600px・JPEG に縮めてから送る)。 */
export const DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES = 1_500_000
/** 1 通ぶんの合計(デコード後)。callable のリクエスト上限(10MB)に base64 の 4/3 を掛けても収まる量。 */
export const DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES = 6_000_000
export const DEVELOPER_REPORT_ATTACHMENT_LABEL_LIMIT = 40
export const DEVELOPER_REPORT_ATTACHMENT_NAME_LIMIT = 120

export type DeveloperReportAttachment = {
  /** 何の画像か(確認リストでは項目 id。例 tp-38)。 */
  label: string
  /** 元のファイル名(表示用)。 */
  name: string
  mimeType: DeveloperReportAttachmentMimeType
  /** `data:image/jpeg;base64,…` の形。 */
  dataUrl: string
}

const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u

/** 画像の data URL を検証して MIME とデコード後のバイト数を返す。形が違えば null。 */
export function parseImageDataUrl(dataUrl: unknown): { mimeType: DeveloperReportAttachmentMimeType; byteLength: number } | null {
  if (typeof dataUrl !== 'string') return null
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl)
  if (!match) return null
  const base64 = match[2]
  if (base64.length % 4 !== 0) return null
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const byteLength = (base64.length / 4) * 3 - padding
  if (byteLength <= 0) return null
  return { mimeType: match[1] as DeveloperReportAttachmentMimeType, byteLength }
}

/**
 * 添付画像を正規化する(純関数)。壊れた要素はその要素だけ捨て、1 枚の上限・枚数・合計の上限を超えた分も捨てる
 * (1 枚の不正で報告全体を失敗させない)。サーバーも同じ規則で検証する。
 */
export function normalizeDeveloperReportAttachments(raw: unknown): DeveloperReportAttachment[] {
  if (!Array.isArray(raw)) return []
  const result: DeveloperReportAttachment[] = []
  let total = 0
  for (const item of raw) {
    if (result.length >= DEVELOPER_REPORT_ATTACHMENT_LIMIT) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as { label?: unknown; name?: unknown; dataUrl?: unknown }
    const parsed = parseImageDataUrl(candidate.dataUrl)
    if (!parsed || parsed.byteLength > DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES) continue
    if (total + parsed.byteLength > DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES) continue
    total += parsed.byteLength
    result.push({
      label: (typeof candidate.label === 'string' ? candidate.label.trim() : '').slice(0, DEVELOPER_REPORT_ATTACHMENT_LABEL_LIMIT),
      name: (typeof candidate.name === 'string' ? candidate.name.trim() : '').slice(0, DEVELOPER_REPORT_ATTACHMENT_NAME_LIMIT) || 'image',
      mimeType: parsed.mimeType,
      dataUrl: candidate.dataUrl as string,
    })
  }
  return result
}

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
  /** 添付画像(確認リストのスクリーンショット・2026-10-14)。無ければ載せない。 */
  attachments?: DeveloperReportAttachment[]
  /**
   * 生徒×科目の台帳(保存時と同じ権威関数 buildStudentLessonLedger の結果・2026-10-16 妥協案 B)。質問のときだけ載せ、
   * サーバーは「質問に名前が出た生徒の数字」を AI へ渡すためだけに使う(文書には保存しない)。
   */
  studentLedger?: DeveloperReportStudentLedger
}

/** 台帳のうち報告に載せる部分(src/utils/studentLessonLedger.ts の StudentLessonLedger から totals・version を除いた形)。 */
export type DeveloperReportStudentLedger = {
  computedAt: string
  rows: Array<{ studentId: string | null; name: string; subject: string; makeupBalance: number; makeupRemaining: string[]; attended: string[]; absent: string[]; absentNoMakeup: string[]; placed: string[] }>
  lectureRows: Array<{ studentId: string; name: string; sessionLabel: string; subject: string; pending: number; origins: string[] }>
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
  /** ボタン名・モーダル題名（オーナー確定 2026-09-04: 「開発者へ報告」→「要望・報告」／2026-09-14: →「質問・要望」） */
  title: '質問・要望',
  /** ボタンのツールチップ（盤面ツールバーと日程表タブで共用） */
  buttonTooltip: '質問も要望も、気になったこともそのまま送れます',
  /** 2026-10-10 文言見直し(オーナー確定 #459): 短縮し教室名の差し込みをやめた。引数は呼び出し側との互換のため残す。 */
  description: (_classroomName: string) =>
    '質問も「こうしてほしい」も「おかしいな」も、そのまま送ってください。直近の操作と画面のデータが一緒に届きます。',
  categoryLabel: '種類',
  /**
   * 並びは 質問 → 要望 → 不具合（オーナー指示 2026-09-14）。モーダルを開いたときは先頭(質問)が選ばれている。
   * label は**表示だけ**(2026-10-10 文言見直し #461/#462 で短縮)。保存・送信・Issue/メールの種別は value(bug/request/question)で、
   * 開発者向けメール件名・Issue 本文の種別名(functions/src/developerReport.ts・tools/developer-report-notify.mjs の CATEGORY_LABELS)は別管理。
   */
  categoryOptions: [
    { value: 'question', label: '使い方の質問' },
    { value: 'request', label: '要望' },
    { value: 'bug', label: '不具合' },
  ] as ReadonlyArray<{ value: DeveloperReportCategory; label: string }>,
  noteLabel: '内容（必須）',
  placeholder: '例: 体験生徒を追加する方法は？',
  /** 入力のヒント(オーナー指示 2026-09-04): 詳細を書いてもらうほど開発者の確認精度が上がることを伝える。 */
  inputHint: '生徒名・日付・何限・どうしたら何が起きたかを書いていただくと、調べやすくなります。',
  /** 質問(question)を選んだときだけ出す注意文（spec §G-2・2026-09-13）: 即答の期待を作らない。自動返信はしない。 */
  questionNotice: '回答は開発者が確認してからお返しします（すぐには返りません・自動返信はしません）。',
  /** AI 即時回答が有効な教室(開発用教室のみ・spec §G-7)で、質問を選んだときに出す注意文。 */
  questionNoticeAi: '【試験中】送信すると、その場で自動の回答が出ます（誤りがあることがあります）。内容は開発者にも届きます。',
  requiredError: '内容を入力してください。何が起きたか・何をしてほしいかを書いてください。',
  cancel: 'キャンセル',
  submit: '送信する',
  sending: '送信中…',
  /** AI 即時回答を待っている間の送信ボタン文言 */
  sendingAi: '送信中…（回答を作成しています）',
  close: '閉じる',
} as const

/** モーダルを開いたときに選ばれている種類（並びの先頭＝質問。オーナー指示 2026-09-14）。盤面・日程表タブ共通。 */
export const DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY: DeveloperReportCategory = DEVELOPER_REPORT_UI_TEXT.categoryOptions[0].value

/** 質問を選んだときの注意文。AI 即時回答が有効な教室(開発用教室のみ)では「その場で AI が回答する」旨に差し替える。 */
export function resolveDeveloperReportQuestionNotice(aiAnswerEnabled: boolean): string {
  return aiAnswerEnabled ? DEVELOPER_REPORT_UI_TEXT.questionNoticeAi : DEVELOPER_REPORT_UI_TEXT.questionNotice
}

/** 送信中の文言。AI 即時回答を待つ(有効な教室で質問を送った)ときだけ長く待つことを伝える。 */
export function resolveDeveloperReportSendingLabel(category: DeveloperReportCategory, aiAnswerEnabled: boolean): string {
  return aiAnswerEnabled && category === 'question' ? DEVELOPER_REPORT_UI_TEXT.sendingAi : DEVELOPER_REPORT_UI_TEXT.sending
}

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
  attachments?: unknown
  studentLedger?: DeveloperReportStudentLedger | null
  now?: Date
}): DeveloperReportRequestBody {
  const recent = input.recentOperations.length > DEVELOPER_REPORT_TRACE_LIMIT
    ? input.recentOperations.slice(input.recentOperations.length - DEVELOPER_REPORT_TRACE_LIMIT)
    : [...input.recentOperations]
  const scheduleContext = normalizeDeveloperReportScheduleContext(input.scheduleContext)
  const attachments = normalizeDeveloperReportAttachments(input.attachments)
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
    ...(attachments.length > 0 ? { attachments } : {}),
    // 台帳は質問のときだけ(要望・不具合では AI を呼ばないので載せない)。
    ...(input.studentLedger && normalizeDeveloperReportCategory(input.category) === 'question' ? { studentLedger: input.studentLedger } : {}),
  }
}

export type DeveloperReportSubmitResult =
  /** aiAnswer / aiAnswerError は AI 即時回答(開発用教室の質問のみ・spec §G-7)の結果。それ以外では付かない。 */
  | { ok: true; reportId: string; isTest?: boolean; aiAnswer?: string; aiAnswerError?: string }
  | { ok: false; error: string }

export const DEVELOPER_REPORT_AI_ANSWER_HEADING = '― 自動回答（試験中・誤りがあることがあります）―'

/** AI 即時回答が作れなかったときに室長へ出す一文。理由は含めない(開発者向けの理由は報告文書 aiAnswerError に残る)。 */
export const DEVELOPER_REPORT_AI_ANSWER_FAILED_NOTE = '（自動回答を作れませんでした。開発者が確認してから回答します）'

/** 送信結果を利用者向けの1文にする（盤面モーダル・日程表タブのモーダルで共用）。 */
export function formatDeveloperReportResultMessage(result: DeveloperReportSubmitResult): string {
  if (result.ok) {
    const head = result.isTest
      ? `テストとして受け付けました（受付番号 ${result.reportId}）。`
      : `開発者へ送りました（受付番号 ${result.reportId}）。ありがとうございます。`
    if (result.aiAnswer) return `${head}\n\n${DEVELOPER_REPORT_AI_ANSWER_HEADING}\n${result.aiAnswer}\n\nこれで解決しない場合は、開発者が確認して改めて回答します。`
    // 失敗理由(aiAnswerError)は室長へ出さない(2026-10-10 文言見直し #473)。理由は開発者向けに報告文書の aiAnswerError・
    // 関数ログ・操作痕跡(App.tsx の recordOperationTrace)へ残り、開発ダッシュボードで読める。
    if (result.aiAnswerError) return `${head}\n\n${DEVELOPER_REPORT_AI_ANSWER_FAILED_NOTE}`
    return head
  }
  return `送れませんでした: ${result.error}\n時間をおいて再度お試しください。`
}
