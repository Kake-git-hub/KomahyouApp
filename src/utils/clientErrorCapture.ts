// 画面エラーの自動捕捉(2026-10-22 オーナー採用「即時対応のための案 3」・docs/spec-developer-report.md §D-2)。
//
// これまで window の未捕捉例外・未処理の Promise 拒否・React の描画例外は端末の中で消えていた(白画面になっても
// 室長が「質問・要望」を押さない限り開発者は知らない)。ここで捕まえて
//  (1) 操作痕跡(operationTrace・kind 'error')に残し、
//  (2) 教室を開いている間は、既存の「質問・要望」の送信経路(submitDeveloperReport・種類 bug)で **自動報告** を 1 通送る。
// 自動報告は本文の先頭行に目印 CLIENT_ERROR_AUTO_REPORT_MARKER を置き、サーバーが isAutoErrorReport=true・Issue 起票なし
// (メールは送る)として記録する(functions/src/developerReport.ts isAutoErrorReportNote と二重管理・テストで一致を固定)。
//
// 歯止め: 同じエラー(重複キー)は 1 回だけ、1 セッション(タブ)で最大 CLIENT_ERROR_AUTO_REPORT_SESSION_LIMIT 通。
// 旧チャンク掴みなど既に別の仕組みで扱う失敗(main.tsx recoverFromChunkLoadError)や、情報の無い "Script error." は送らない。
// DOM(window)に触るのは installClientErrorCapture だけ。判定・整形は純関数にしてテストで固定する。

import { DEVELOPER_REPORT_NOTE_LIMIT } from './developerReport'
import { recordOperationTrace } from './operationTrace'

export const CLIENT_ERROR_AUTO_REPORT_MARKER = '[自動エラー報告]'
export const CLIENT_ERROR_AUTO_REPORT_SESSION_LIMIT = 3
/** 同じエラーを痕跡に残す回数の上限(L-2)。interval の中で繰り返す例外が 1000 件の痕跡を押し流さないようにする。 */
export const CLIENT_ERROR_TRACE_LIMIT_PER_KEY = 5
/** 歯止め(重複キー・送った数)の置き場所。再読み込みを跨いで同じタブで効く(M-2: 案内画面の「再読み込み」で歯止めが消えない)。 */
export const CLIENT_ERROR_GATE_STORAGE_KEY = 'client-error-auto-report:v1'
export const CLIENT_ERROR_MESSAGE_LIMIT = 300
export const CLIENT_ERROR_STACK_LIMIT = 1200

export type ClientErrorSource = 'window-error' | 'unhandled-rejection' | 'react-render'

export const CLIENT_ERROR_SOURCE_LABELS: Readonly<Record<ClientErrorSource, string>> = {
  'window-error': '画面の例外(window.onerror)',
  'unhandled-rejection': '未処理の非同期エラー(unhandledrejection)',
  'react-render': '画面の描画エラー(React ErrorBoundary)',
}

export type ClientErrorInfo = {
  source: ClientErrorSource
  name: string
  message: string
  stack: string
  /** `ファイル:行:桁`。分からなければ空。 */
  location: string
}

function clip(text: string, limit: number): string {
  const normalized = text.replace(/\r\n?/gu, '\n').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function readErrorMessage(error: unknown, fallback: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (typeof fallback === 'string' && fallback.trim()) return fallback
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === 'string' && candidate.trim()) return candidate
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  if (error === undefined || error === null) return ''
  return String(error)
}

/** 捕まえた例外(何が来るか分からない)を、記録と報告に使える形へ正規化する。例外は投げない。 */
export function describeClientError(input: {
  source: ClientErrorSource
  error?: unknown
  message?: unknown
  filename?: unknown
  lineno?: unknown
  colno?: unknown
  componentStack?: unknown
}): ClientErrorInfo {
  const error = input.error
  const name = error instanceof Error && error.name ? error.name : 'Error'
  const message = clip(readErrorMessage(error, input.message) || '(詳細なし)', CLIENT_ERROR_MESSAGE_LIMIT)
  const stackParts = [
    error instanceof Error && typeof error.stack === 'string' ? error.stack : '',
    typeof input.componentStack === 'string' && input.componentStack.trim() ? `component stack:${input.componentStack}` : '',
  ].filter(Boolean)
  const filename = typeof input.filename === 'string' ? input.filename.trim() : ''
  const lineno = typeof input.lineno === 'number' && Number.isFinite(input.lineno) ? input.lineno : null
  const colno = typeof input.colno === 'number' && Number.isFinite(input.colno) ? input.colno : null
  const location = filename ? `${filename}${lineno !== null ? `:${lineno}` : ''}${lineno !== null && colno !== null ? `:${colno}` : ''}` : ''
  return {
    source: input.source,
    name,
    message,
    stack: clip(stackParts.join('\n'), CLIENT_ERROR_STACK_LIMIT),
    location,
  }
}

const IGNORABLE_PATTERNS = [
  // 旧チャンク掴み(デプロイ直後)。main.tsx recoverFromChunkLoadError が再読み込みで復帰させる。
  /Failed to fetch dynamically imported module/iu,
  /Importing a module script failed/iu,
  /Loading (CSS )?chunk/iu,
  /ChunkLoadError/iu,
  // ブラウザ内部の無害な警告。
  /ResizeObserver loop/iu,
  // クロスオリジンのスクリプトで中身が見えないもの。何も分からないので送らない。
  /^Script error\.?$/iu,
]

/** 送らない(記録もしない)エラーか。別の仕組みで扱う失敗と、情報の無いもの。 */
export function isIgnorableClientError(info: Pick<ClientErrorInfo, 'message'>): boolean {
  const message = info.message.trim()
  if (!message || message === '(詳細なし)') return true
  return IGNORABLE_PATTERNS.some((pattern) => pattern.test(message))
}

/** 操作痕跡に残す 1 行(生徒名は入らない: 例外の文とファイル位置だけ)。 */
export function buildClientErrorTraceSummary(info: ClientErrorInfo): string {
  return `${CLIENT_ERROR_SOURCE_LABELS[info.source]}: ${info.name}: ${info.message}${info.location ? ` (${info.location})` : ''}`
}

function firstStackFrame(stack: string): string {
  const frame = stack.split('\n').map((line) => line.trim()).find((line) => /^at\s|@/u.test(line))
  return frame ? frame.slice(0, 160) : ''
}

/** 同じエラーを何度も送らないための重複キー(出どころ・名前・文の先頭・最初のフレーム)。 */
export function buildClientErrorDedupeKey(info: ClientErrorInfo): string {
  return [info.source, info.name, info.message.slice(0, 120), firstStackFrame(info.stack)].join('|')
}

export type ClientErrorReportContext = {
  appVersion: string
  screen: string
  url: string
}

/** 自動報告の本文。先頭行の目印でサーバーが自動報告と判定する(Issue 起票なし・メールは送る)。上限は報告と同じ 2000 字。 */
export function buildClientErrorAutoReportNote(info: ClientErrorInfo, context: ClientErrorReportContext): string {
  const lines = [
    `${CLIENT_ERROR_AUTO_REPORT_MARKER} 画面で想定外のエラーが起きました(利用者の操作による送信ではなく、アプリが自動で送った報告です)`,
    `出どころ: ${CLIENT_ERROR_SOURCE_LABELS[info.source]}`,
    `エラー: ${info.name}: ${info.message}`,
    info.location ? `場所: ${info.location}` : '',
    `画面: ${context.screen || '(不明)'} / 版: ${context.appVersion || '(不明)'} / URL: ${context.url || '(不明)'}`,
    info.stack ? `スタック:\n${info.stack}` : '',
  ].filter((line) => line !== '')
  return clip(lines.join('\n'), DEVELOPER_REPORT_NOTE_LIMIT)
}

/** 本文が自動報告か(先頭行が目印で始まる)。サーバー isAutoErrorReportNote と同じ判定。 */
export function isClientErrorAutoReportNote(note: string): boolean {
  return note.split('\n')[0]?.trimStart().startsWith(CLIENT_ERROR_AUTO_REPORT_MARKER) === true
}

// ---------------------------------------------------------------------------
// 歯止め(重複と回数)。純関数で状態を受け取る。
// ---------------------------------------------------------------------------

export type ClientErrorAutoReportGateState = {
  seenKeys: Set<string>
  sentCount: number
  /** 痕跡に残した回数(キーごと・メモリだけ)。 */
  traceCounts: Map<string, number>
}

export function createClientErrorAutoReportGateState(): ClientErrorAutoReportGateState {
  return { seenKeys: new Set<string>(), sentCount: 0, traceCounts: new Map<string, number>() }
}

type GateStorage = Pick<Storage, 'getItem' | 'setItem'>

function resolveGateStorage(): GateStorage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    return window.sessionStorage
  } catch {
    return null
  }
}

/** 保存した歯止め(JSON)を読む。壊れていれば空。純関数(storage は引数)。 */
export function loadClientErrorAutoReportGateState(storage: GateStorage | null): ClientErrorAutoReportGateState {
  const state = createClientErrorAutoReportGateState()
  if (!storage) return state
  try {
    const raw = storage.getItem(CLIENT_ERROR_GATE_STORAGE_KEY)
    if (!raw) return state
    const parsed = JSON.parse(raw) as { keys?: unknown; sentCount?: unknown }
    if (Array.isArray(parsed.keys)) for (const key of parsed.keys) if (typeof key === 'string') state.seenKeys.add(key)
    if (typeof parsed.sentCount === 'number' && Number.isFinite(parsed.sentCount)) state.sentCount = Math.max(0, Math.trunc(parsed.sentCount))
  } catch {
    // 壊れた保存は無視(歯止めが無い状態から始める)。
  }
  return state
}

export function saveClientErrorAutoReportGateState(storage: GateStorage | null, state: ClientErrorAutoReportGateState): void {
  if (!storage) return
  try {
    storage.setItem(CLIENT_ERROR_GATE_STORAGE_KEY, JSON.stringify({ keys: [...state.seenKeys].slice(-50), sentCount: state.sentCount }))
  } catch {
    // 容量超過など。残らなければ再読み込み後に 1 通ずつ増えるだけ。
  }
}

/** 痕跡に残してよいか(同じキーは CLIENT_ERROR_TRACE_LIMIT_PER_KEY 回まで)。状態を進める。 */
export function decideClientErrorTrace(state: ClientErrorAutoReportGateState, key: string, limit: number = CLIENT_ERROR_TRACE_LIMIT_PER_KEY): boolean {
  const count = state.traceCounts.get(key) ?? 0
  if (count >= limit) return false
  state.traceCounts.set(key, count + 1)
  return true
}

/** 送ってよければ true を返し、状態を進める(重複・上限なら false で状態は変えない)。 */
export function decideClientErrorAutoReport(state: ClientErrorAutoReportGateState, key: string, limit: number = CLIENT_ERROR_AUTO_REPORT_SESSION_LIMIT): boolean {
  if (state.seenKeys.has(key)) return false
  if (state.sentCount >= limit) return false
  state.seenKeys.add(key)
  state.sentCount += 1
  return true
}

// ---------------------------------------------------------------------------
// モジュールスコープの送信口(App が登録する)。operationLog / operationTrace と同じ方式で、巨大な App から props を通さない。
// ---------------------------------------------------------------------------

export type ClientErrorAutoReporter = {
  /** 「質問・要望」と同じ経路で送る。教室を開いていないときは送らずに済ませてよい(戻り値は見ない)。 */
  submit: (note: string) => Promise<unknown> | unknown
  /** 本文に添える文脈(版数・画面・URL)。 */
  context: () => ClientErrorReportContext
}

let autoReporter: ClientErrorAutoReporter | null = null
let gateState: ClientErrorAutoReportGateState | null = null
/** 再入の歯止め: 送信口の中で再び例外が起きても、この入口を重ねて走らせない。 */
let handling = false

function ensureGateState(): ClientErrorAutoReportGateState {
  if (!gateState) gateState = loadClientErrorAutoReportGateState(resolveGateStorage())
  return gateState
}

export function setClientErrorAutoReporter(reporter: ClientErrorAutoReporter | null): void {
  autoReporter = reporter
}

/** テスト用: 歯止めと送信口を初期状態へ(sessionStorage の保存は消さない。テストは stub を差し替える)。 */
export function resetClientErrorCaptureState(): void {
  autoReporter = null
  gateState = null
  handling = false
}

export type ClientErrorHandleOutcome = 'ignored' | 'traced-only' | 'deduped' | 'reported'

/**
 * 捕まえたエラーの入口。痕跡に残し、送信口があれば歯止めの範囲で自動報告する。**ここから例外を外へ出さない**
 * (エラー処理の中でさらに落ちると本体のエラーを隠す)。
 */
export function handleCapturedClientError(info: ClientErrorInfo): ClientErrorHandleOutcome {
  if (handling) return 'ignored'
  handling = true
  try {
    if (isIgnorableClientError(info)) return 'ignored'
    const state = ensureGateState()
    const key = buildClientErrorDedupeKey(info)
    if (decideClientErrorTrace(state, key)) {
      try {
        recordOperationTrace('error', buildClientErrorTraceSummary(info))
      } catch {
        // 痕跡の失敗で報告を止めない。
      }
    }
    const reporter = autoReporter
    if (!reporter) return 'traced-only'
    if (!decideClientErrorAutoReport(state, key)) return 'deduped'
    saveClientErrorAutoReportGateState(resolveGateStorage(), state)
    const note = buildClientErrorAutoReportNote(info, reporter.context())
    try {
      void Promise.resolve(reporter.submit(note)).catch(() => { /* 送れなくても痕跡には残っている */ })
    } catch {
      // noop
    }
    return 'reported'
  } catch {
    return 'ignored'
  } finally {
    handling = false
  }
}

// ---------------------------------------------------------------------------
// window への取り付け(DOM に触るのはここだけ)。
// ---------------------------------------------------------------------------

export type ClientErrorCaptureTarget = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  removeEventListener: (type: string, listener: (event: unknown) => void) => void
}

/** window の error / unhandledrejection を捕まえて onError へ渡す。戻り値で外す。 */
export function installClientErrorCapture(target: ClientErrorCaptureTarget, onError: (info: ClientErrorInfo) => void = handleCapturedClientError): () => void {
  const onWindowError = (event: unknown) => {
    const candidate = (event ?? {}) as { message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown; error?: unknown }
    onError(describeClientError({ source: 'window-error', error: candidate.error, message: candidate.message, filename: candidate.filename, lineno: candidate.lineno, colno: candidate.colno }))
  }
  const onUnhandledRejection = (event: unknown) => {
    const candidate = (event ?? {}) as { reason?: unknown }
    onError(describeClientError({ source: 'unhandled-rejection', error: candidate.reason }))
  }
  target.addEventListener('error', onWindowError)
  target.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    target.removeEventListener('error', onWindowError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
