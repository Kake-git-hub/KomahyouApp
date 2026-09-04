// 「開発者へ報告」のサーバー側正規化（Cloud Function `submitDeveloperReport` から使う純粋ロジック）。
//
// クライアント（src/utils/developerReport.ts）が送ってくる報告を、Firestore/Storage へ書く前に検証・整形する。
// **クライアントの自己申告を信用しない**（操作ログ functions/src/operationEvents.ts と同じ方針）:
//  - 実行者(reportedBy)と受領時刻(recordedAt)は呼び出し側（Cloud Function）が付ける。ここでは受け取らない。
//  - 文字列は長さを切る。入れ子や想定外の型は捨てる（Firestore 文書 1MiB を超えないため）。
//  - 教室データ本体(snapshotPayload)は Firestore 文書には入れず Storage へ置く（1MiB を超えうるため）。
//
// 保存先:
//  - Firestore: workspaces/{workspaceKey}/developerReports/{reportId}（一覧・通知用のメタ＋操作痕跡）
//  - Storage:   developer-reports/{workspaceKey}/{classroomId}/{reportId}.json.gz（報告時点の教室データ）
//
// 通知: GitHub Actions（.github/workflows/developer-reports.yml）が定期的に notifiedAt==null を拾い、
// Issue を起票して notifiedAt を埋める。関数側は通知しない（GitHub トークンを関数に持たせない）。

export const DEVELOPER_REPORT_NOTE_LIMIT = 2000
export const DEVELOPER_REPORT_TRACE_LIMIT = 300
export const DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT = 400
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT = 12
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT = 200
export const DEVELOPER_REPORT_SOURCES = ['board', 'schedule'] as const
export type DeveloperReportSource = (typeof DEVELOPER_REPORT_SOURCES)[number]
/** 種類: 不具合・おかしい(bug) / 追加要望(request)。クライアント src/utils/developerReport.ts と二重管理。 */
export const DEVELOPER_REPORT_CATEGORIES = ['bug', 'request'] as const
export type DeveloperReportCategory = (typeof DEVELOPER_REPORT_CATEGORIES)[number]
/** テスト扱いの目印。内容に含まれていれば Issue 起票をしない(メールは【テスト】付きで送る)。 */
export const DEVELOPER_REPORT_TEST_MARKER = '#テスト'

export const DEVELOPER_REPORT_TRACE_KINDS = [
  'board-commit',
  'board-rebuild',
  'undo',
  'redo',
  'save',
  'operation-event',
  'schedule-message',
  'navigation',
  'auto',
] as const
export type DeveloperReportTraceKind = (typeof DEVELOPER_REPORT_TRACE_KINDS)[number]

export type NormalizedDeveloperReportTraceEntry = {
  at: string
  kind: DeveloperReportTraceKind
  summary: string
}

export type NormalizedDeveloperReport = {
  classroomId: string
  source: DeveloperReportSource
  category: DeveloperReportCategory
  /** 内容に #テスト を含む(オーナーの動作確認用)。Issue 起票をスキップし notifiedAt を即時に埋める。 */
  isTest: boolean
  note: string
  reportedAt: string
  appVersion: string
  userAgent: string
  pageUrl: string
  screen: string
  boardDirty: boolean
  lastSavedAt: string
  recentOperations: NormalizedDeveloperReportTraceEntry[]
  scheduleContext: Record<string, string>
  hasSnapshotPayload: boolean
}

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const CONTEXT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

function readTrimmedString(raw: unknown, limit: number): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.replace(/\r\n?/gu, '\n').trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed
}

function normalizeIsoTimestamp(raw: unknown, fallbackIso: string): string {
  if (typeof raw !== 'string') return fallbackIso
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso
}

export function normalizeDeveloperReportSource(raw: unknown): DeveloperReportSource {
  return typeof raw === 'string' && (DEVELOPER_REPORT_SOURCES as readonly string[]).includes(raw) ? raw as DeveloperReportSource : 'board'
}

export function normalizeDeveloperReportCategory(raw: unknown): DeveloperReportCategory {
  return typeof raw === 'string' && (DEVELOPER_REPORT_CATEGORIES as readonly string[]).includes(raw) ? raw as DeveloperReportCategory : 'bug'
}

/** 内容に「#テスト」(または #test) が含まれればテスト扱い。クライアント側 isDeveloperReportTestNote と同じ判定。 */
export function isDeveloperReportTestNote(note: string): boolean {
  return note.includes(DEVELOPER_REPORT_TEST_MARKER) || /#test\b/iu.test(note)
}

/**
 * 操作痕跡を正規化する。壊れた要素は**その要素だけ捨てて残りは通す**（1件の不正で報告全体を失敗させない）。
 * 上限を超えたら**新しい方**を残す（直近の操作が原因追跡に効く）。
 */
export function normalizeDeveloperReportTrace(raw: unknown, options: { fallbackIso: string }): NormalizedDeveloperReportTraceEntry[] {
  if (!Array.isArray(raw)) return []
  const result: NormalizedDeveloperReportTraceEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    const kind = candidate.kind
    if (typeof kind !== 'string' || !(DEVELOPER_REPORT_TRACE_KINDS as readonly string[]).includes(kind)) continue
    const summary = readTrimmedString(candidate.summary, DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT)
    if (!summary) continue
    result.push({
      at: normalizeIsoTimestamp(candidate.at, options.fallbackIso),
      kind: kind as DeveloperReportTraceKind,
      summary,
    })
  }
  return result.length > DEVELOPER_REPORT_TRACE_LIMIT ? result.slice(result.length - DEVELOPER_REPORT_TRACE_LIMIT) : result
}

export function normalizeDeveloperReportScheduleContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT) break
    if (!CONTEXT_KEY_PATTERN.test(key)) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) result[key] = trimmed.slice(0, DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT)
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = String(value)
    if (typeof value === 'boolean') result[key] = value ? 'true' : 'false'
  }
  return result
}

/** 受信した報告を正規化する。classroomId は呼び出し側が権限確認済みの値を渡す。 */
export function normalizeDeveloperReport(raw: Record<string, unknown>, options: { classroomId: string; fallbackIso: string }): NormalizedDeveloperReport {
  const snapshotPayload = raw.snapshotPayload
  const note = readTrimmedString(raw.note, DEVELOPER_REPORT_NOTE_LIMIT)
  return {
    classroomId: options.classroomId,
    source: normalizeDeveloperReportSource(raw.source),
    category: normalizeDeveloperReportCategory(raw.category),
    isTest: isDeveloperReportTestNote(note),
    note,
    reportedAt: normalizeIsoTimestamp(raw.reportedAt, options.fallbackIso),
    appVersion: readTrimmedString(raw.appVersion, 40),
    userAgent: readTrimmedString(raw.userAgent, 300),
    pageUrl: readTrimmedString(raw.pageUrl, 300),
    screen: readTrimmedString(raw.screen, 40),
    boardDirty: raw.boardDirty === true,
    lastSavedAt: typeof raw.lastSavedAt === 'string' ? normalizeIsoTimestamp(raw.lastSavedAt, '') : '',
    recentOperations: normalizeDeveloperReportTrace(raw.recentOperations, { fallbackIso: options.fallbackIso }),
    scheduleContext: normalizeDeveloperReportScheduleContext(raw.scheduleContext),
    hasSnapshotPayload: Boolean(snapshotPayload) && typeof snapshotPayload === 'object' && !Array.isArray(snapshotPayload),
  }
}

/**
 * 報告 id。時刻(降順に並べやすい ISO 由来)＋乱数。Storage パスと Firestore 文書 id を兼ねるので安全な文字だけ。
 */
export function buildDeveloperReportId(recordedAtIso: string, randomSuffix: string): string {
  const stamp = recordedAtIso.replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '')
  const suffix = randomSuffix.replace(/[^A-Za-z0-9]/gu, '').slice(0, 8) || '0'
  return `${stamp}-${suffix}`
}

export function buildDeveloperReportStoragePath(workspaceKey: string, classroomId: string, reportId: string): string {
  for (const [label, value] of [['workspaceKey', workspaceKey], ['classroomId', classroomId], ['reportId', reportId]] as const) {
    if (!SAFE_SEGMENT_PATTERN.test(value)) throw new Error(`${label} に使えない文字が含まれています。`)
  }
  return `developer-reports/${workspaceKey}/${classroomId}/${reportId}.json.gz`
}

/** Firestore 文書 1MiB の余裕を見た、操作痕跡の合計文字数上限。超えたら古い方から落とす。 */
export const DEVELOPER_REPORT_TRACE_TOTAL_CHAR_LIMIT = 200_000

export function trimDeveloperReportTraceToBudget(entries: NormalizedDeveloperReportTraceEntry[], limit: number = DEVELOPER_REPORT_TRACE_TOTAL_CHAR_LIMIT): NormalizedDeveloperReportTraceEntry[] {
  let total = 0
  const kept: NormalizedDeveloperReportTraceEntry[] = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const cost = entry.summary.length + entry.kind.length + entry.at.length
    if (total + cost > limit) break
    total += cost
    kept.push(entry)
  }
  return kept.reverse()
}

// ---------------------------------------------------------------------------
// メール通知(オーナー要望 2026-09-04: LINE ではなくメールへ直接・即時)。
// Firestore の developerReports 作成トリガ(index.ts notifyDeveloperReportByMail)から使う純粋な整形。
// メールは開発者だけに届く私的経路なので、公開 Issue と違い操作痕跡(生徒名を含む)も載せる。
// ---------------------------------------------------------------------------

export type DeveloperReportMailSource = {
  reportId: string
  classroomId: string
  classroomName?: string
  source?: string
  category?: string
  isTest?: boolean
  note?: string
  reportedAt?: string
  recordedAt?: string
  appVersion?: string
  reporterRole?: string
  reporterEmail?: string
  boardDirty?: boolean
  lastSavedAt?: string
  scheduleContext?: Record<string, string>
  recentOperations?: Array<{ at: string; kind: string; summary: string }>
  recentOperationCount?: number
  snapshotStoragePath?: string
}

const SOURCE_LABELS: Record<string, string> = { board: 'コマ表(盤面)', schedule: '日程表(別タブ)' }
const CATEGORY_LABELS: Record<string, string> = { bug: '不具合・おかしい', request: '追加してほしい・要望' }
/** メールに載せる操作痕跡の件数(新しい方から)。全件は Firestore 文書で読む。 */
export const DEVELOPER_REPORT_MAIL_TRACE_LINES = 60

function toJstLabel(iso: string | undefined): string {
  const ms = Date.parse(iso ?? '')
  if (!Number.isFinite(ms)) return iso || '(不明)'
  const jst = new Date(ms + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())} JST`
}

export function buildDeveloperReportMail(report: DeveloperReportMailSource, options: { workspaceKey: string; projectId: string; storageBucket: string }): { subject: string; text: string } {
  const classroom = report.classroomName || report.classroomId || '教室不明'
  const category = CATEGORY_LABELS[report.category ?? ''] ?? report.category ?? '(不明)'
  const noteHead = (report.note ?? '').split('\n')[0].trim()
  const subject = `${report.isTest ? '【テスト】' : ''}[コマ表アプリ 要望・報告] ${classroom} / ${category}${noteHead ? `: ${noteHead.slice(0, 40)}${noteHead.length > 40 ? '…' : ''}` : ''}`
  const docPath = `workspaces/${options.workspaceKey}/developerReports/${report.reportId}`
  const consoleUrl = `https://console.firebase.google.com/project/${options.projectId}/firestore/databases/-default-/data/~2F${encodeURIComponent(docPath).replace(/%2F/g, '~2F')}`
  const contextLines = Object.entries(report.scheduleContext ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `  - ${key}: ${value}`)
  const operations = report.recentOperations ?? []
  const shownOperations = operations.slice(-DEVELOPER_REPORT_MAIL_TRACE_LINES)
  const lines: string[] = [
    report.isTest ? '※ 内容に #テスト が含まれるためテスト扱いです。GitHub Issue は作られません。' : '',
    '利用者が画面の「要望・報告」ボタンから送った内容です。',
    '',
    `教室: ${classroom} (${report.classroomId})`,
    `種類: ${category}`,
    `報告元: ${SOURCE_LABELS[report.source ?? ''] ?? report.source ?? '(不明)'}`,
    `報告時刻: ${toJstLabel(report.reportedAt)} (サーバー受領 ${toJstLabel(report.recordedAt)})`,
    `アプリ版数: ${report.appVersion || '(不明)'}`,
    `報告者: ${report.reporterRole || '(権限不明)'}${report.reporterEmail ? ` ${report.reporterEmail}` : ''}`,
    `未保存の変更: ${report.boardDirty ? 'あり(保存前の状態を含む)' : 'なし'} / 最終保存 ${report.lastSavedAt ? toJstLabel(report.lastSavedAt) : '(不明)'}`,
    ...(contextLines.length > 0 ? ['日程表の表示条件:', ...contextLines] : []),
    '',
    '■ 内容',
    report.note?.trim() ? report.note.trim() : '(なし)',
    '',
    '■ 進め方(オーナー指示 2026-09-04)',
    '勝手に修正を始めない。切り分け・整理までにとどめ、修正の着手は開発者(オーナー)が確認して許可してから。',
    '',
    `■ 直近の操作痕跡(新しい方から ${shownOperations.length} 件 / 全 ${report.recentOperationCount ?? operations.length} 件は Firestore 文書で)`,
    ...(shownOperations.length > 0
      ? [...shownOperations].reverse().map((entry) => `${toJstLabel(entry.at)} [${entry.kind}] ${entry.summary}`)
      : ['(なし)']),
    '',
    '■ 詳細の置き場所',
    `Firestore: ${docPath}`,
    consoleUrl,
    report.snapshotStoragePath
      ? `教室データ(gzip JSON): gs://${options.storageBucket}/${report.snapshotStoragePath}\n  gsutil cp "gs://${options.storageBucket}/${report.snapshotStoragePath}" ./report.json.gz && gunzip -f ./report.json.gz`
      : '教室データ: (保存されていません。関数ログ [DeveloperReport] を確認)',
  ]
  return { subject, text: lines.filter((line) => line !== '').join('\n') }
}

/** SMTP URL(例: smtps://user%40gmail.com:app-password@smtp.gmail.com:465)が使える形か。空や不正なら送らない。 */
export function isMailTransportConfigured(smtpUrl: string, to: string): boolean {
  if (!smtpUrl.trim() || !to.trim()) return false
  try {
    const url = new URL(smtpUrl.trim())
    return (url.protocol === 'smtp:' || url.protocol === 'smtps:') && Boolean(url.hostname)
  } catch {
    return false
  }
}
