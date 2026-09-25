// 開発ダッシュボード(開発者画面)の純粋ロジック(2026-09-25 オーナー指示「開発者用の開発用ダッシュボード」)。
//
// 目的: 会社(workspace)・教室ごとの「質問・要望」の状況、開発の段階(機能フラグ・進行中テーマ・GitHub Issue)、
// 確認リストの確認済み/未確認を、開発者が 1 画面で読めるようにする。
//
// ★読み取り専用。この画面から Firestore・GitHub へ書き込む経路は作らない(本番データ保護ルール)。
//   データの取得は src/integrations/firebase/developerReportsStore.ts(getDocs のみ)と
//   src/integrations/github/issues.ts(公開 API の GET)が担い、ここは受け取った配列を集計するだけ。
//
// このファイルは純データ＋純関数のみ。DOM / ネットワークには触らない。

import type { DeveloperReportCategory } from './developerReport'
import { DEVELOPMENT_STATUS_LEDGER, type DevelopmentStatusEntry } from './developmentStatusLedger'
import { featureRolloutRegistry, type FeatureRolloutKey, type FeatureRolloutScope } from './featureRollout'
import { VERIFICATION_CHECKLIST, type VerificationChecklistDefinition } from './verificationChecklist'
import { parseChecklistMarker, summarizeChecklistReports, type ChecklistLatestItemResult, type ChecklistOtherNote } from './verificationChecklistResults'

// ───────────────────────────────────────────────────────────────────────────
// 報告(developerReports)の 1 件。Firestore 文書のうちダッシュボードが読む項目だけ(操作痕跡・教室データは持たない)。
// ───────────────────────────────────────────────────────────────────────────

export type DeveloperReportRecord = {
  reportId: string
  classroomId: string
  classroomName: string
  source: string
  category: DeveloperReportCategory
  isTest: boolean
  isVerificationChecklist: boolean
  note: string
  reportedAt: string
  recordedAt: string
  appVersion: string
  reporterRole: string
  notifiedAt: string | null
  notifySkipped: string | null
  issueNumber: number | null
  issueUrl: string
  hasAiAnswer: boolean
  aiAnswerError: string
  mailSentAt: string | null
  mailError: string
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readIssueNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value)
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return Number(value.trim())
  return null
}

export function normalizeDeveloperReportCategoryLoose(value: unknown): DeveloperReportCategory {
  return value === 'request' || value === 'question' ? value : 'bug'
}

/**
 * Firestore 文書(developerReports)からダッシュボード用の 1 件へ。壊れた項目は既定値へ丸める(1 件が壊れても
 * 一覧全体を落とさない)。確認リストかどうかは文書のフラグ **または** 本文の先頭マーカーで判定する
 * (フラグが無い古い文書でも取りこぼさない)。
 */
export function normalizeDeveloperReportRecord(raw: Record<string, unknown> | null | undefined, fallbackId: string): DeveloperReportRecord {
  const data = raw ?? {}
  const note = readString(data.note)
  return {
    reportId: readString(data.reportId) || fallbackId,
    classroomId: readString(data.classroomId),
    classroomName: readString(data.classroomName),
    source: readString(data.source),
    category: normalizeDeveloperReportCategoryLoose(data.category),
    isTest: data.isTest === true,
    isVerificationChecklist: data.isVerificationChecklist === true || parseChecklistMarker(note) !== null,
    note,
    reportedAt: readString(data.reportedAt),
    recordedAt: readString(data.recordedAt) || readString(data.reportedAt),
    appVersion: readString(data.appVersion),
    reporterRole: readString(data.reporterRole),
    notifiedAt: readNullableString(data.notifiedAt),
    notifySkipped: readNullableString(data.notifySkipped),
    issueNumber: readIssueNumber(data.issueNumber),
    issueUrl: readString(data.issueUrl),
    hasAiAnswer: typeof data.aiAnswer === 'string' && data.aiAnswer.trim().length > 0,
    aiAnswerError: readString(data.aiAnswerError),
    mailSentAt: readNullableString(data.mailSentAt),
    mailError: readString(data.mailError),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GitHub Issue(公開リポジトリの Issues API)。
// ───────────────────────────────────────────────────────────────────────────

export const GITHUB_REPOSITORY = 'Kake-git-hub/KomahyouApp'
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`
/** 直近更新順 100 件(open/closed 両方)。PR も混ざるので normalizeGitHubIssues で除く。 */
export const GITHUB_ISSUES_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues?state=all&per_page=100&sort=updated&direction=desc`

/** 利用者報告 Issue のタイトル種別(tools/developer-report-notify.mjs buildIssueTitle と同じ語)。 */
export type UserReportIssueKind = '利用者質問' | '利用者要望' | '利用者報告'

export type GitHubIssueRecord = {
  number: number
  title: string
  state: 'open' | 'closed'
  labels: string[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  htmlUrl: string
  commentCount: number
  /** ラベル source:user-report(「質問・要望」ボタン由来)。 */
  isUserReport: boolean
  /** タイトル `📣 [利用者質問] 教室名: 一言` から取った種別と教室名。合わなければ null。 */
  userReport: { kind: UserReportIssueKind; classroomName: string } | null
}

const USER_REPORT_TITLE_PATTERN = /^\s*(?:📣\s*)?\[(利用者質問|利用者要望|利用者報告)\]\s*([^:：]+?)\s*(?:[:：]|$)/u

export function parseUserReportIssueTitle(title: string | null | undefined): { kind: UserReportIssueKind; classroomName: string } | null {
  const match = USER_REPORT_TITLE_PATTERN.exec(String(title ?? ''))
  if (!match) return null
  return { kind: match[1] as UserReportIssueKind, classroomName: match[2].trim() }
}

/** Issues API の JSON 配列を正規化する。PR(pull_request を持つ)と壊れた要素は捨てる。 */
export function normalizeGitHubIssues(json: unknown): GitHubIssueRecord[] {
  if (!Array.isArray(json)) return []
  const issues: GitHubIssueRecord[] = []
  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    if (raw.pull_request) continue
    const number = readIssueNumber(raw.number)
    if (number === null) continue
    const labels = Array.isArray(raw.labels)
      ? raw.labels.map((label) => (label && typeof label === 'object' ? readString((label as Record<string, unknown>).name) : readString(label))).filter(Boolean)
      : []
    const title = readString(raw.title)
    issues.push({
      number,
      title,
      state: raw.state === 'closed' ? 'closed' : 'open',
      labels,
      createdAt: readString(raw.created_at),
      updatedAt: readString(raw.updated_at),
      closedAt: readNullableString(raw.closed_at),
      htmlUrl: readString(raw.html_url) || `${GITHUB_REPOSITORY_URL}/issues/${number}`,
      commentCount: typeof raw.comments === 'number' ? raw.comments : 0,
      isUserReport: labels.includes('source:user-report'),
      userReport: parseUserReportIssueTitle(title),
    })
  }
  return issues
}

export function buildGitHubIssueUrl(issueNumber: number): string {
  return `${GITHUB_REPOSITORY_URL}/issues/${issueNumber}`
}

// ───────────────────────────────────────────────────────────────────────────
// 報告の状態と教室別の集計。
// ───────────────────────────────────────────────────────────────────────────

export type DeveloperReportStatus =
  | 'test'
  | 'checklist'
  | 'awaiting-issue'
  | 'issue-open'
  | 'issue-closed'
  | 'issue-unknown'

export const DEVELOPER_REPORT_STATUS_LABELS: Readonly<Record<DeveloperReportStatus, string>> = {
  test: 'テスト送信',
  checklist: '確認リスト',
  'awaiting-issue': 'Issue 起票待ち',
  'issue-open': 'Issue 対応中',
  'issue-closed': 'Issue 完了',
  'issue-unknown': 'Issue あり',
}

export const DEVELOPER_REPORT_CATEGORY_LABELS: Readonly<Record<DeveloperReportCategory, string>> = {
  question: '質問',
  request: '要望',
  bug: '不具合',
}

/** Issue 番号 → open/closed の対応表(GitHub から取れた分だけ)。 */
export type IssueStateMap = ReadonlyMap<number, 'open' | 'closed'>

export function buildIssueStateMap(issues: readonly GitHubIssueRecord[]): IssueStateMap {
  return new Map(issues.map((issue) => [issue.number, issue.state]))
}

export function resolveDeveloperReportStatus(report: DeveloperReportRecord, issueStates: IssueStateMap): DeveloperReportStatus {
  if (report.isVerificationChecklist) return 'checklist'
  if (report.isTest) return 'test'
  if (report.issueNumber === null) return 'awaiting-issue'
  const state = issueStates.get(report.issueNumber)
  if (state === 'open') return 'issue-open'
  if (state === 'closed') return 'issue-closed'
  return 'issue-unknown'
}

export type ClassroomReportSummary = {
  classroomId: string
  classroomName: string
  /** 開発者画面の教室一覧に今も存在する教室か(削除済み教室の報告は false)。 */
  isKnownClassroom: boolean
  /** 検証用(開発用・テスト)教室か。 */
  isDevelopmentClassroom: boolean
  counts: {
    question: number
    request: number
    bug: number
    checklist: number
    test: number
  }
  /** Issue が未起票(通知ワークフロー待ち)の件数。テスト・確認リストは含まない。 */
  awaitingIssue: number
  /** GitHub で open のままの Issue 番号(重複なし・昇順)。 */
  openIssueNumbers: number[]
  /** 直近の報告時刻(ISO)。無ければ空。 */
  latestReportedAt: string
}

export type ClassroomIdentity = { id: string; name: string }

function bumpCount(summary: ClassroomReportSummary, report: DeveloperReportRecord) {
  if (report.isVerificationChecklist) summary.counts.checklist += 1
  else if (report.isTest) summary.counts.test += 1
  else summary.counts[report.category] += 1
}

/**
 * 教室ごとに報告を数える。教室一覧の順に並べ、一覧に無い教室(削除済み)は末尾に足す。
 * 一覧にある教室は報告が 0 件でも行を出す(「この教室からは何も来ていない」も情報)。
 */
export function summarizeDeveloperReportsByClassroom(
  reports: readonly DeveloperReportRecord[],
  classrooms: readonly ClassroomIdentity[],
  options: { issueStates?: IssueStateMap; isDevelopmentClassroom?: (classroomId: string) => boolean } = {},
): ClassroomReportSummary[] {
  const issueStates = options.issueStates ?? new Map()
  const isDevelopment = options.isDevelopmentClassroom ?? (() => false)
  const rows = new Map<string, ClassroomReportSummary>()
  const openIssues = new Map<string, Set<number>>()
  const ensureRow = (classroomId: string, classroomName: string, isKnownClassroom: boolean) => {
    let row = rows.get(classroomId)
    if (!row) {
      row = {
        classroomId,
        classroomName,
        isKnownClassroom,
        isDevelopmentClassroom: isDevelopment(classroomId),
        counts: { question: 0, request: 0, bug: 0, checklist: 0, test: 0 },
        awaitingIssue: 0,
        openIssueNumbers: [],
        latestReportedAt: '',
      }
      rows.set(classroomId, row)
      openIssues.set(classroomId, new Set())
    } else if (!row.classroomName && classroomName) {
      row.classroomName = classroomName
    }
    return row
  }
  for (const classroom of classrooms) ensureRow(classroom.id, classroom.name, true)
  for (const report of reports) {
    const row = ensureRow(report.classroomId || '(教室不明)', report.classroomName, false)
    bumpCount(row, report)
    const status = resolveDeveloperReportStatus(report, issueStates)
    if (status === 'awaiting-issue') row.awaitingIssue += 1
    if (status === 'issue-open' && report.issueNumber !== null) openIssues.get(row.classroomId)?.add(report.issueNumber)
    const reportedAt = report.reportedAt || report.recordedAt
    if (reportedAt > row.latestReportedAt) row.latestReportedAt = reportedAt
  }
  for (const row of rows.values()) {
    row.openIssueNumbers = [...(openIssues.get(row.classroomId) ?? [])].sort((a, b) => a - b)
  }
  return [...rows.values()]
}

/** 報告一覧を新しい順に並べる(reportedAt が無ければ recordedAt)。 */
export function sortDeveloperReportsNewestFirst(reports: readonly DeveloperReportRecord[]): DeveloperReportRecord[] {
  return [...reports].sort((a, b) => (b.reportedAt || b.recordedAt).localeCompare(a.reportedAt || a.recordedAt))
}

/** 一覧に出す一言(先頭行・上限文字数)。確認リストは本文が長いので先頭のマーカーだけにする。 */
export function summarizeDeveloperReportNote(note: string, limit = 80): string {
  const firstLine = note.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  if (firstLine.length <= limit) return firstLine
  return `${firstLine.slice(0, limit)}…`
}

// ───────────────────────────────────────────────────────────────────────────
// 機能フラグの段階(featureRollout.ts)と進行中テーマ台帳の突き合わせ。
// ───────────────────────────────────────────────────────────────────────────

export const FEATURE_SCOPE_LABELS: Readonly<Record<FeatureRolloutScope, string>> = {
  'development-only': '開発用教室のみ',
  'staging-environment': 'staging＋検証用教室',
  'all-classrooms': '全教室',
}

/** 画面に出す順(まだ全教室に出ていないものを先に)。 */
export const FEATURE_SCOPE_ORDER: readonly FeatureRolloutScope[] = ['development-only', 'staging-environment', 'all-classrooms']

export type FeatureRolloutOverviewRow = {
  key: FeatureRolloutKey
  scope: FeatureRolloutScope
  scopeLabel: string
  /** 台帳に紐づく行があればその題名、無ければレジストリの説明(英語)。 */
  title: string
  description: string
  ledgerEntries: DevelopmentStatusEntry[]
}

export function buildFeatureRolloutOverview(
  registry: Record<string, { scope: FeatureRolloutScope; description: string }> = featureRolloutRegistry,
  ledger: readonly DevelopmentStatusEntry[] = DEVELOPMENT_STATUS_LEDGER,
): FeatureRolloutOverviewRow[] {
  const rows: FeatureRolloutOverviewRow[] = []
  for (const [key, feature] of Object.entries(registry)) {
    const ledgerEntries = ledger.filter((entry) => (entry.featureKeys ?? []).includes(key as FeatureRolloutKey))
    rows.push({
      key: key as FeatureRolloutKey,
      scope: feature.scope,
      scopeLabel: FEATURE_SCOPE_LABELS[feature.scope],
      title: ledgerEntries[0]?.title ?? feature.description,
      description: feature.description,
      ledgerEntries,
    })
  }
  return rows.sort((a, b) => FEATURE_SCOPE_ORDER.indexOf(a.scope) - FEATURE_SCOPE_ORDER.indexOf(b.scope))
}

// ───────────────────────────────────────────────────────────────────────────
// 確認リストの確認済み/未確認(定義 × 送られた結果)。
// ───────────────────────────────────────────────────────────────────────────

export type ChecklistItemStatus = 'ok' | 'needs-improvement' | 'unanswered'

export const CHECKLIST_ITEM_STATUS_LABELS: Readonly<Record<ChecklistItemStatus, string>> = {
  ok: 'OK',
  'needs-improvement': '要改善',
  unanswered: '未確認',
}

export type ChecklistStatusRow = {
  id: string
  area: string
  title: string
  introducedIn: string
  status: ChecklistItemStatus
  memo: string
  /** 結果の受付時刻(ISO)。未確認なら空。 */
  recordedAt: string
  reportIds: string[]
  /** 現行の版より前の版で来た結果(参考表示)。現行版の結果が無いときだけ入る。 */
  previousVersionResult: ChecklistLatestItemResult | null
}

export type VerificationChecklistStatusSummary = {
  /** 定義の版(例 v1.5.557)。 */
  version: string
  rows: ChecklistStatusRow[]
  counts: { ok: number; needsImprovement: number; unanswered: number }
  /** その他の気づき(新しい順)。 */
  otherNotes: ChecklistOtherNote[]
  /** 現行版の結果を最後に受け付けた時刻(ISO)。無ければ空。 */
  latestSubmissionAt: string
  /** 定義に無い id の結果(古い版の項目)。件数だけ出す。 */
  resultsOutsideDefinition: number
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^v/u, '')
}

/**
 * 定義(現行版)の各項目に、送られた結果(developerReports)の最新結果を重ねる。
 * ★版の扱い: 確認リストの版は「項目を差し替えたら上げる」運用(verificationChecklist.ts)。同じ id でも
 *   前の版の結果は**別物**なので、現行版の結果だけを OK/要改善に数え、前の版の結果は参考として添える。
 */
export function summarizeVerificationChecklistStatus(
  reports: readonly DeveloperReportRecord[],
  definition: VerificationChecklistDefinition = VERIFICATION_CHECKLIST,
): VerificationChecklistStatusSummary {
  const currentVersion = stripVersionPrefix(definition.version)
  const checklistReports = reports.filter((report) => report.isVerificationChecklist)
  const summary = summarizeChecklistReports(checklistReports)
  const currentById = new Map<string, ChecklistLatestItemResult>()
  const previousById = new Map<string, ChecklistLatestItemResult>()
  for (const item of summary.items) {
    if (item.version === currentVersion) currentById.set(item.itemId, item)
    else {
      const existing = previousById.get(item.itemId)
      if (!existing || item.recordedAt >= existing.recordedAt) previousById.set(item.itemId, item)
    }
  }
  const definedIds = new Set(definition.items.map((item) => item.id))
  const rows: ChecklistStatusRow[] = definition.items.map((item) => {
    const current = currentById.get(item.id)
    return {
      id: item.id,
      area: item.area,
      title: item.title,
      introducedIn: item.introducedIn,
      status: current ? current.result : 'unanswered',
      memo: current?.memo ?? '',
      recordedAt: current?.recordedAt ?? '',
      reportIds: current?.reportIds ?? [],
      previousVersionResult: current ? null : (previousById.get(item.id) ?? null),
    }
  })
  const counts = { ok: 0, needsImprovement: 0, unanswered: 0 }
  for (const row of rows) {
    if (row.status === 'ok') counts.ok += 1
    else if (row.status === 'needs-improvement') counts.needsImprovement += 1
    else counts.unanswered += 1
  }
  let latestSubmissionAt = ''
  for (const item of currentById.values()) {
    if (item.recordedAt > latestSubmissionAt) latestSubmissionAt = item.recordedAt
  }
  const resultsOutsideDefinition = summary.items.filter((item) => !definedIds.has(item.itemId)).length
  return {
    version: definition.version,
    rows,
    counts,
    otherNotes: [...summary.otherNotes].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    latestSubmissionAt,
    resultsOutsideDefinition,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 期間の既定(直近 90 日)。報告 1 件は操作痕跡込みで大きいので、読み込む範囲を絞る。
// ───────────────────────────────────────────────────────────────────────────

export const DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS = 90
export const DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS = [30, 90, 365] as const
export const DEVELOPER_DASHBOARD_REPORT_LIMIT = 300

export function resolveDeveloperDashboardSinceIso(days: number, now: Date = new Date()): string {
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS
  return new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000).toISOString()
}

export function formatDashboardDateTime(iso: string): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
