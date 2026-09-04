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
  return {
    classroomId: options.classroomId,
    source: normalizeDeveloperReportSource(raw.source),
    note: readTrimmedString(raw.note, DEVELOPER_REPORT_NOTE_LIMIT),
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
