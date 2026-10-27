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
// 2026-10-27 に 400 → 2000(クライアント src/utils/operationTrace.ts OPERATION_TRACE_SUMMARY_LIMIT と同じ値・テストで突合)。
// 日大前校の保存失敗で、保存に相乗りした痕跡から消えた作業を読み戻したとき、机を何台も動かした操作が 400 字で切れていた。
// 文書 1 件の合計は DEVELOPER_REPORT_TRACE_TOTAL_CHAR_LIMIT(200,000 字)のままなので 1MiB の予算は変わらない。
export const DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT = 2000
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_KEY_LIMIT = 12
export const DEVELOPER_REPORT_SCHEDULE_CONTEXT_VALUE_LIMIT = 200
export const DEVELOPER_REPORT_SOURCES = ['board', 'schedule'] as const
export type DeveloperReportSource = (typeof DEVELOPER_REPORT_SOURCES)[number]
/** 種類: 不具合・おかしい(bug) / 追加要望(request) / 使い方の質問(question・2026-09-13)。クライアント src/utils/developerReport.ts と二重管理。 */
export const DEVELOPER_REPORT_CATEGORIES = ['bug', 'request', 'question'] as const
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
  // 画面で捕まえた例外(2026-10-22 案 3・src/utils/clientErrorCapture.ts)。
  'error',
] as const
export type DeveloperReportTraceKind = (typeof DEVELOPER_REPORT_TRACE_KINDS)[number]

/**
 * 画面エラーの自動報告(2026-10-22 案 3)の目印。クライアント src/utils/clientErrorCapture.ts CLIENT_ERROR_AUTO_REPORT_MARKER と二重管理
 * (テストで一致を固定)。本文の先頭行がこれで始まる報告は isAutoErrorReport=true: メールは送るが GitHub Issue は作らない
 * (同じエラーが複数端末から届いて Issue が増えるのを防ぐ。開発ダッシュボードの「通知済みだが Issue なし」に出る)。
 */
export const DEVELOPER_REPORT_AUTO_ERROR_MARKER = '[自動エラー報告]'

export function isAutoErrorReportNote(note: string): boolean {
  return note.split('\n')[0]?.trimStart().startsWith(DEVELOPER_REPORT_AUTO_ERROR_MARKER) === true
}

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
  /**
   * 生徒×科目の台帳(クライアントが保存時と同じ権威関数で計算・src/utils/studentLessonLedger.ts)。質問への AI 即時回答で
   * 「質問に名前が出た生徒の数字」(妥協案 B・2026-10-16)を作るためだけに使い、Firestore 文書には入れない(1MiB 対策)。無ければ null。
   */
  studentLedger: NormalizedDeveloperReportStudentLedger | null
}

/** 台帳 1 行(生徒×科目)。トークンは `YYYY-MM-DD#限|種別|元日|元限`(src/utils/studentLessonLedger.ts と同じ形)。 */
export type NormalizedDeveloperReportStudentLedgerRow = {
  studentId: string | null
  name: string
  subject: string
  makeupBalance: number
  makeupRemaining: string[]
  attended: string[]
  absent: string[]
  absentNoMakeup: string[]
  placed: string[]
}

export type NormalizedDeveloperReportStudentLedgerLectureRow = {
  studentId: string
  name: string
  sessionLabel: string
  subject: string
  pending: number
  origins: string[]
}

export type NormalizedDeveloperReportStudentLedger = {
  computedAt: string
  rows: NormalizedDeveloperReportStudentLedgerRow[]
  lectureRows: NormalizedDeveloperReportStudentLedgerLectureRow[]
}

/** 台帳の行数・トークン数の上限(異常な入力でメモリを食わないため。超えた分は捨てる)。 */
export const DEVELOPER_REPORT_LEDGER_ROW_LIMIT = 3000
export const DEVELOPER_REPORT_LEDGER_TOKEN_LIMIT = 500
const LEDGER_TOKEN_PATTERN = /^\d{4}-\d{2}-\d{2}#\d*(?:\|[^|]{0,60}){0,3}$/u

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

/**
 * 開発用教室の「確認リスト」パネルの送信本文か(先頭行が `[確認リスト vX.Y.Z]` または `... (1/2)`)。
 * クライアント src/utils/verificationChecklist.ts の buildVerificationChecklistMarker と
 * tools/verification-checklist-report.lib.mjs の MARKER_PATTERN と同じ書式。
 */
const VERIFICATION_CHECKLIST_MARKER_PATTERN = /^\[確認リスト\s+v[0-9]+\.[0-9]+\.[0-9]+\](?:\s*\(\d+\/\d+\))?\s*$/u

export function isVerificationChecklistNote(note: string): boolean {
  const firstLine = String(note ?? '').split(/\r?\n/u)[0]?.trim() ?? ''
  return VERIFICATION_CHECKLIST_MARKER_PATTERN.test(firstLine)
}

/**
 * 確認リストの送信は**メールも Issue 起票もしない**(オーナー指示 2026-09-13: 要望・報告・質問と違い、
 * 開発者が tools/verification-checklist-report.mjs で読んで必ず修正するので通知は不要)。
 * 本番教室の利用者が偶然マーカーを書いても通知が止まらないよう、開発用教室(サンドボックス含む)に限る。
 */
export function isVerificationChecklistReport(note: string, isDevelopmentClassroom: boolean): boolean {
  return isDevelopmentClassroom && isVerificationChecklistNote(note)
}

/** メール即時通知を送らない理由(送るなら null)。記録時に保存した isVerificationChecklist を見る。 */
export function resolveDeveloperReportMailSkipReason(report: { isVerificationChecklist?: boolean }): string | null {
  return report.isVerificationChecklist === true ? 'verification-checklist' : null
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

function readTokenList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const token = item.trim()
    if (!LEDGER_TOKEN_PATTERN.test(token)) continue
    result.push(token)
    if (result.length >= DEVELOPER_REPORT_LEDGER_TOKEN_LIMIT) break
  }
  return result
}

function readCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 0
}

/** クライアントが同梱した生徒×科目の台帳を検証する(形が違う行は捨てる)。無ければ null。 */
export function normalizeDeveloperReportStudentLedger(raw: unknown, options: { fallbackIso: string }): NormalizedDeveloperReportStudentLedger | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const rows: NormalizedDeveloperReportStudentLedgerRow[] = []
  for (const item of Array.isArray(candidate.rows) ? candidate.rows : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const name = readTrimmedString(row.name, 80)
    if (!name) continue
    rows.push({
      studentId: typeof row.studentId === 'string' && row.studentId.trim() ? row.studentId.trim().slice(0, 40) : null,
      name,
      subject: readTrimmedString(row.subject, 40),
      makeupBalance: readCount(row.makeupBalance),
      makeupRemaining: readTokenList(row.makeupRemaining),
      attended: readTokenList(row.attended),
      absent: readTokenList(row.absent),
      absentNoMakeup: readTokenList(row.absentNoMakeup),
      placed: readTokenList(row.placed),
    })
    if (rows.length >= DEVELOPER_REPORT_LEDGER_ROW_LIMIT) break
  }
  const lectureRows: NormalizedDeveloperReportStudentLedgerLectureRow[] = []
  for (const item of Array.isArray(candidate.lectureRows) ? candidate.lectureRows : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const name = readTrimmedString(row.name, 80)
    if (!name) continue
    lectureRows.push({
      studentId: readTrimmedString(row.studentId, 40),
      name,
      sessionLabel: readTrimmedString(row.sessionLabel, 60),
      subject: readTrimmedString(row.subject, 40),
      pending: readCount(row.pending),
      origins: readTokenList(row.origins),
    })
    if (lectureRows.length >= DEVELOPER_REPORT_LEDGER_ROW_LIMIT) break
  }
  if (rows.length === 0 && lectureRows.length === 0) return null
  return { computedAt: normalizeIsoTimestamp(candidate.computedAt, options.fallbackIso), rows, lectureRows }
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
    studentLedger: normalizeDeveloperReportStudentLedger(raw.studentLedger, { fallbackIso: options.fallbackIso }),
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

// ───────────────────────────────────────────────────────────────────────────
// 添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)。
// クライアント src/utils/developerReport.ts と二重管理(値・規則を揃える)。画像本体は Firestore に入れず、報告の教室データと
// 同じ Storage フォルダ developer-reports/{workspaceKey}/{classroomId}/ に {reportId}-img{n}.{jpg|png|webp} で置く。
// ───────────────────────────────────────────────────────────────────────────
export const DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type DeveloperReportAttachmentMimeType = (typeof DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES)[number]
export const DEVELOPER_REPORT_ATTACHMENT_LIMIT = 8
export const DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES = 1_500_000
export const DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES = 6_000_000
export const DEVELOPER_REPORT_ATTACHMENT_LABEL_LIMIT = 40
export const DEVELOPER_REPORT_ATTACHMENT_NAME_LIMIT = 120
/**
 * 一般の「質問・要望」モーダル(盤面・日程表)の枚数(オーナー決定 2026-10-22「3 枚に絞る」)。確認リスト(開発用教室)は 8 枚のまま。
 * クライアント src/utils/developerReport.ts と二重管理(テストで一致を固定)。
 */
export const DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT = 3
/** メールに添付する画像は 1 枚目だけ・1MB まで(オーナー決定 2026-10-22)。残りは Storage の置き場所を本文に書く。 */
export const DEVELOPER_REPORT_MAIL_ATTACHMENT_MAX_BYTES = 1_000_000

/** 受け付ける枚数。開発用教室(確認リストの送信元)は 8 枚、それ以外の教室(一般モーダル)は 3 枚。 */
export function resolveDeveloperReportAttachmentLimit(isDevelopmentClassroom: boolean): number {
  return isDevelopmentClassroom ? DEVELOPER_REPORT_ATTACHMENT_LIMIT : DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT
}
const DEVELOPER_REPORT_ATTACHMENT_EXTENSIONS: Record<DeveloperReportAttachmentMimeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export type NormalizedDeveloperReportAttachment = {
  label: string
  name: string
  mimeType: DeveloperReportAttachmentMimeType
  /** data URL から切り出した base64 本体(Buffer.from(base64, 'base64') で保存する)。 */
  base64: string
  byteLength: number
}

const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u

/**
 * 画像の先頭バイト(マジックバイト)。MIME の自己申告(data URL の接頭辞)だけでは任意のバイト列を画像として置けるので、
 * サーバーは中身の先頭も確かめる(regression-reviewer M-4・2026-10-22)。WEBP は RIFF????WEBP。
 */
export const IMAGE_MAGIC_BYTES: Readonly<Record<DeveloperReportAttachmentMimeType, ReadonlyArray<{ offset: number; bytes: readonly number[] }>>> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/webp': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
}

/** 先頭バイトが MIME に合うか。head は base64 の先頭 24 文字(18 バイト)を復号したもので足りる。 */
export function matchesImageMagicBytes(mimeType: DeveloperReportAttachmentMimeType, head: Uint8Array): boolean {
  return IMAGE_MAGIC_BYTES[mimeType].every((rule) => rule.bytes.every((byte, index) => head[rule.offset + index] === byte))
}

export function parseImageDataUrl(dataUrl: unknown): { mimeType: DeveloperReportAttachmentMimeType; base64: string; byteLength: number } | null {
  if (typeof dataUrl !== 'string') return null
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl)
  if (!match) return null
  const base64 = match[2]
  if (base64.length % 4 !== 0) return null
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const byteLength = (base64.length / 4) * 3 - padding
  if (byteLength <= 0) return null
  const mimeType = match[1] as DeveloperReportAttachmentMimeType
  // 中身の先頭が MIME に合わないもの(HTML・実行ファイルを画像と称したもの)は捨てる(M-4)。
  if (!matchesImageMagicBytes(mimeType, Buffer.from(base64.slice(0, 24), 'base64'))) return null
  return { mimeType, base64, byteLength }
}

/** 添付画像を正規化する。壊れた要素・上限超えはその要素だけ捨てる(クライアントと同じ規則)。 */
export function normalizeDeveloperReportAttachments(raw: unknown, options: { limit?: number } = {}): NormalizedDeveloperReportAttachment[] {
  if (!Array.isArray(raw)) return []
  // 枚数の上限は呼び出し側で絞れる(一般モーダルは 3 枚)。ただし全体の上限 8 枚は超えない。
  const limit = Math.max(0, Math.min(DEVELOPER_REPORT_ATTACHMENT_LIMIT, Math.trunc(options.limit ?? DEVELOPER_REPORT_ATTACHMENT_LIMIT)))
  const result: NormalizedDeveloperReportAttachment[] = []
  let total = 0
  for (const item of raw) {
    if (result.length >= limit) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as { label?: unknown; name?: unknown; dataUrl?: unknown }
    const parsed = parseImageDataUrl(candidate.dataUrl)
    if (!parsed || parsed.byteLength > DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES) continue
    if (total + parsed.byteLength > DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES) continue
    total += parsed.byteLength
    result.push({
      label: readTrimmedString(candidate.label, DEVELOPER_REPORT_ATTACHMENT_LABEL_LIMIT),
      name: readTrimmedString(candidate.name, DEVELOPER_REPORT_ATTACHMENT_NAME_LIMIT) || 'image',
      mimeType: parsed.mimeType,
      base64: parsed.base64,
      byteLength: parsed.byteLength,
    })
  }
  return result
}

/** 添付画像の Storage パス。報告の教室データ(…/{reportId}.json.gz)と同じフォルダに {reportId}-img{n}.{ext}(n は 1 から)。 */
export function buildDeveloperReportAttachmentStoragePath(workspaceKey: string, classroomId: string, reportId: string, index: number, mimeType: DeveloperReportAttachmentMimeType): string {
  const base = buildDeveloperReportStoragePath(workspaceKey, classroomId, reportId).replace(/\.json\.gz$/u, '')
  if (!Number.isInteger(index) || index < 0) throw new Error('添付画像の番号が不正です。')
  return `${base}-img${index + 1}.${DEVELOPER_REPORT_ATTACHMENT_EXTENSIONS[mimeType]}`
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
  isVerificationChecklist?: boolean
  /** 画面エラーの自動報告(2026-10-22 案 3)。件名に【自動エラー報告】を付け、本文で Issue を作らない旨を知らせる。 */
  isAutoErrorReport?: boolean
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
  /** 添付画像(文書の attachments[]・画像本体は Storage)。1 枚目(1MB まで)をメールに添付する(2026-10-22)。 */
  attachments?: DeveloperReportMailAttachmentSource[]
  /** AI 即時回答(開発用教室の質問・spec §G-7)。2026-10-16 夜からメールは AI の結果が書かれてから送るので、本文に載せる。 */
  aiAnswerPending?: boolean
  aiAnswer?: string
  aiAnswerError?: string
  aiAnswerBlocked?: string
  aiAnswerModel?: string
  aiAnswerDigestStudents?: string[]
  /** 送信の記録(index.ts notifyDeveloperReportByMail が書く)。どれかがあれば二度送らない。 */
  mailSentAt?: string
  mailSkipped?: string
  mailError?: string
}

/**
 * developerReports 文書の書き込み(作成・更新)でメールを送るか(2026-10-16 夜・オーナー指示「開発者にもメールでやり取りを知らせる」)。
 * - 送信済み・スキップ済み・失敗済み(mailSentAt / mailSkipped / mailError)なら送らない(自分の書き込みで再発火しても止まる)。
 * - AI の回答待ち(aiAnswerPending=true)なら送らない(回答文を載せるため)。
 * - 作成時(before なし)は AI を呼ばない報告(本番教室・要望・不具合)だけ送る。
 * - 更新時は「aiAnswerPending が true → 下りた」1 回だけ送る(開発者の回答など、ほかの更新では送らない。古い文書の更新でも送らない)。
 */
export function shouldSendDeveloperReportMailOnWrite(before: DeveloperReportMailSource | null, after: DeveloperReportMailSource | null): boolean {
  if (!after) return false
  if (after.mailSentAt || after.mailSkipped || after.mailError) return false
  if (after.aiAnswerPending === true) return false
  if (!before) return true
  return before.aiAnswerPending === true
}

export type DeveloperReportMailAttachmentSource = { label?: string; name?: string; mimeType?: string; byteLength?: number; storagePath?: string }

/** メールに添付する画像(1 枚目だけ・1MB まで・保存先が分かるもの)。無ければ null(本文に置き場所だけ書く)。 */
export function selectDeveloperReportMailAttachment(
  attachments: DeveloperReportMailAttachmentSource[] | undefined,
  maxBytes: number = DEVELOPER_REPORT_MAIL_ATTACHMENT_MAX_BYTES,
): { name: string; fileName: string; mimeType: string; storagePath: string; byteLength: number } | null {
  const first = attachments?.[0]
  if (!first || typeof first.storagePath !== 'string' || !first.storagePath) return null
  const byteLength = typeof first.byteLength === 'number' && Number.isFinite(first.byteLength) ? first.byteLength : Number.POSITIVE_INFINITY
  if (byteLength > maxBytes) return null
  // fileName はメールの添付名。利用者入力の name ではなく Storage の保存名(…-img1.jpg・MIME で決めた拡張子)を使う(M-4)。
  const fileName = first.storagePath.split('/').pop() || 'image'
  return { name: first.name?.trim() || 'image', fileName, mimeType: first.mimeType?.trim() || 'application/octet-stream', storagePath: first.storagePath, byteLength }
}

/** 添付画像の節(枚数・1 枚目を添付したか・各画像の置き場所)。添付が無ければ空。 */
export function buildDeveloperReportMailAttachmentLines(report: Pick<DeveloperReportMailSource, 'attachments'>, options: { storageBucket: string }): string[] {
  const attachments = report.attachments ?? []
  if (attachments.length === 0) return []
  const selected = selectDeveloperReportMailAttachment(attachments)
  return [
    `■ 添付画像: ${attachments.length} 枚`,
    selected
      ? `1 枚目(${selected.name}・${Math.max(1, Math.round(selected.byteLength / 1024))}KB)をこのメールに添付しています。`
      : `1 枚目が ${Math.round(DEVELOPER_REPORT_MAIL_ATTACHMENT_MAX_BYTES / 1_000_000)}MB を超える(または保存先が無い)ため、メールには付けていません。`,
    ...attachments.map((attachment, index) => `  ${index + 1}. ${attachment.name?.trim() || 'image'}${attachment.label?.trim() ? ` [${attachment.label.trim()}]` : ''} gs://${options.storageBucket}/${attachment.storagePath ?? '(保存失敗)'}`),
    '',
  ]
}

const SOURCE_LABELS: Record<string, string> = { board: 'コマ表(盤面)', schedule: '日程表(別タブ)' }
const CATEGORY_LABELS: Record<string, string> = { bug: '不具合・おかしい', request: '追加してほしい・要望', question: '使い方の質問' }
/**
 * メールに載せる操作痕跡の件数(新しい方から・**不具合の報告だけ**)。全件は Firestore 文書・開発ダッシュボードで読む。
 * 2026-10-22 オーナー指示(確認リスト v1.5.625 qa-ai-3「メールの内容に多くのことが書かれすぎていてわかりにくい。開発者が見るべきものだけにして」):
 * 60 件 → 20 件に減らし、要望・質問には載せない(質問の原因調査には要らない)。
 */
export const DEVELOPER_REPORT_MAIL_TRACE_LINES = 20

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
  // 質問(2026-09-13)は件名に【質問】を付けて、不具合/要望と受信箱で見分けられるようにする(流れは同じ: ストック→メール→後で対応)。
  // AI がすぐ回答して室長に表示済みの質問は【質問/AI回答済】(2026-10-16 夜)。開発者が回答すべき質問(AI 失敗・対象外)は【質問】のまま。
  const isQuestion = report.category === 'question'
  const isBug = report.category === 'bug'
  const aiAnswered = isQuestion && Boolean(report.aiAnswer?.trim())
  const subject = `${report.isTest ? '【テスト】' : ''}${report.isAutoErrorReport ? '【自動エラー報告】' : ''}${isQuestion ? (aiAnswered ? '【質問/AI回答済】' : '【質問】') : ''}[コマ表アプリ 要望・報告] ${classroom} / ${category}${noteHead ? `: ${noteHead.slice(0, 40)}${noteHead.length > 40 ? '…' : ''}` : ''}`
  const docPath = `workspaces/${options.workspaceKey}/developerReports/${report.reportId}`
  const contextLines = Object.entries(report.scheduleContext ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `  - ${key}: ${value}`)
  const operations = report.recentOperations ?? []
  const operationCount = report.recentOperationCount ?? operations.length
  // 操作痕跡は不具合の報告だけ(新しい方から上限件数)。要望・質問の調査には要らないので載せない(2026-10-22 オーナー指示「開発者が見るべきものだけに」)。
  const shownOperations = isBug ? operations.slice(-DEVELOPER_REPORT_MAIL_TRACE_LINES) : []
  // 本文は「開発者がいま見るべきもの」だけ(2026-10-22)。Firestore コンソールの URL・gsutil コマンド・進め方の長文・
  // 保存状態の行・要望/質問の操作痕跡は外した。全文(操作痕跡 全件・教室データ・AI の記録)は開発ダッシュボード(docs/spec-developer-report.md §E-3)で読む。
  const lines: string[] = [
    report.isTest ? '※ #テスト を含むためテスト扱い(GitHub Issue は作られません)。' : '',
    report.isAutoErrorReport
      ? '※ 画面のエラーをアプリが自動で送った報告です(利用者の操作ではありません。GitHub Issue は作られません。同じエラーは 1 タブ 1 回・3 通まで)。'
      : '',
    `教室: ${classroom}`,
    `種類: ${category} / 報告元: ${SOURCE_LABELS[report.source ?? ''] ?? report.source ?? '(不明)'}`,
    `時刻: ${toJstLabel(report.reportedAt)} / 版 ${report.appVersion || '(不明)'} / 報告者 ${report.reporterRole || '(権限不明)'}`,
    ...(isBug ? [`未保存の変更: ${report.boardDirty ? 'あり(保存前の状態を含む)' : 'なし'} / 最終保存 ${report.lastSavedAt ? toJstLabel(report.lastSavedAt) : '(不明)'}`] : []),
    ...(contextLines.length > 0 ? ['日程表の表示条件:', ...contextLines] : []),
    '',
    '■ 内容',
    report.note?.trim() ? report.note.trim() : '(なし)',
    '',
    ...buildDeveloperReportMailAttachmentLines(report, { storageBucket: options.storageBucket }),
    ...(isQuestion ? buildDeveloperReportMailAiAnswerLines(report) : []),
    '■ 次にすること',
    ...buildDeveloperReportMailNextStepLines(report),
    '',
    ...(isBug
      ? [
          `■ 直近の操作痕跡(新しい方から ${shownOperations.length} 件 / 全 ${operationCount} 件は開発ダッシュボードで)`,
          ...(shownOperations.length > 0
            ? [...shownOperations].reverse().map((entry) => `${toJstLabel(entry.at)} [${entry.kind}] ${entry.summary}`)
            : ['(なし)']),
          '',
        ]
      : []),
    `受付番号: ${report.reportId}(全文・操作痕跡 ${operationCount} 件・教室データは開発者画面の「開発ダッシュボード」で / Firestore ${docPath})`,
    ...(report.snapshotStoragePath ? [] : ['教室データ: (保存されていません。関数ログ [DeveloperReport] を確認)']),
  ]
  return { subject, text: lines.filter((line) => line !== '').join('\n') }
}

/**
 * 「次にすること」(1〜2 行)。進め方の長文(オーナー指示 2026-09-04「勝手に修正を始めない」)は 1 行に詰めた(中身は同じ)。
 * - 質問で AI が回答済み: 訂正・補足が要るときだけ開発者画面「質問への回答」から送る。
 * - 質問で AI が答えられなかった・呼んでいない: 開発者画面「質問への回答」から回答する。
 * - 不具合・要望: 切り分けまで。修正の着手はオーナーが確認して許可してから(勝手に修正を始めない)。
 */
export function buildDeveloperReportMailNextStepLines(report: Pick<DeveloperReportMailSource, 'category' | 'aiAnswer'>): string[] {
  if (report.category === 'question') {
    return report.aiAnswer?.trim()
      ? ['室長には AI の回答が表示済み。訂正・補足が要るときだけ、開発者画面「質問への回答」から送る(室長の「質問・要望」ボタンに未読が付く)。']
      : ['開発者画面「質問への回答」から回答する(室長には「開発者より別途回答いたします」と表示済み)。']
  }
  return ['切り分け・整理まで。修正の着手は開発者(オーナー)が確認して許可してから(勝手に修正を始めない・2026-09-04)。']
}

/**
 * 質問のメールに載せる AI の自動回答の節(2026-10-16 夜)。室長に何が表示されたかを開発者がそのまま読めるようにする。
 * - 回答あり: 回答文(室長に表示済み)。見出しは短く(2026-10-22「開発者が見るべきものだけに」)。
 * - 失敗・止めた: 理由と、止めた元の文(室長には見せていない)。室長には「自動回答を作れませんでした。開発者より別途回答いたします」が出ている。
 * - どちらも無い(本番教室・確認リストなど AI を呼んでいない): その旨。
 */
export function buildDeveloperReportMailAiAnswerLines(report: DeveloperReportMailSource): string[] {
  const answer = (report.aiAnswer ?? '').trim()
  const model = report.aiAnswerModel ? `・${report.aiAnswerModel}` : ''
  const students = report.aiAnswerDigestStudents && report.aiAnswerDigestStudents.length > 0 ? `・数字を渡した生徒 ${report.aiAnswerDigestStudents.join(' / ')}` : ''
  if (answer) {
    return ['■ AI の自動回答(室長に表示済み' + model + students + ')', answer, '']
  }
  if (report.aiAnswerError) {
    return [
      '■ AI の自動回答: 作れなかった(室長には「自動回答を作れませんでした。開発者より別途回答いたします」と表示済み' + model + ')',
      `理由: ${report.aiAnswerError}`,
      ...(report.aiAnswerBlocked?.trim() ? ['止めた元の文(室長には未表示):', report.aiAnswerBlocked.trim()] : []),
      '',
    ]
  }
  return ['■ AI の自動回答: なし(この教室では AI を呼んでいない)', '']
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
