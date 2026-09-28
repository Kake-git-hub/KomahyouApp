// 開発ダッシュボードの【詳細】(5 欄の全量表示・2026-09-25 初版の画面をそのまま移した)。
//
// 2026-09-28 オーナー指示「情報量が多い。重要なのは何が未対応なのか」で既定画面を未対応一覧(DeveloperDashboardScreen.tsx)に
// 替え、この 5 欄は「詳細を見る」で開く裏面にした。欄の内容・集計は変えていない(docs/spec-developer-report.md §E-3)。
//
// ★読み取り専用。取得は親(DeveloperDashboardScreen)が行い、ここは受け取った配列を集計して描くだけ。

import { useMemo, useState } from 'react'

import { isDevelopmentClassroom } from '../../utils/developmentClassroom'
import {
  DEVELOPER_DASHBOARD_REPORT_LIMIT,
  DEVELOPER_REPORT_CATEGORY_LABELS,
  DEVELOPER_REPORT_STATUS_LABELS,
  GITHUB_REPOSITORY,
  GITHUB_REPOSITORY_URL,
  buildFeatureRolloutOverview,
  buildGitHubIssueUrl,
  formatDashboardDateTime,
  resolveDeveloperReportStatus,
  sortDeveloperReportsNewestFirst,
  summarizeDeveloperReportNote,
  summarizeDeveloperReportsByClassroom,
  type DeveloperReportRecord,
  type DeveloperReportStatus,
  type GitHubIssueRecord,
  type IssueStateMap,
  type VerificationChecklistStatusSummary,
} from '../../utils/developerDashboard'
import {
  DEVELOPMENT_STATUS_LEDGER,
  DEVELOPMENT_STATUS_STAGES,
  DEVELOPMENT_STATUS_STAGE_LABELS,
  type DevelopmentStatusEntry,
} from '../../utils/developmentStatusLedger'

export type DeveloperDashboardDetailProps = {
  authMode: 'local' | 'firebase'
  workspaceKey: string
  classrooms: ReadonlyArray<{ id: string; name: string }>
  reports: readonly DeveloperReportRecord[]
  reportsLoading: boolean
  reportsReady: boolean
  reportsError: string
  issues: readonly GitHubIssueRecord[]
  issuesLoading: boolean
  issuesReady: boolean
  issuesError: string
  issueStates: IssueStateMap
  checklist: VerificationChecklistStatusSummary
}

const RECENT_REPORT_LIMIT = 40
const CLOSED_ISSUE_DISPLAY_LIMIT = 8

const REPORT_STATUS_CHIP_CLASS: Readonly<Record<DeveloperReportStatus, string>> = {
  test: 'secondary',
  checklist: 'secondary',
  'awaiting-issue': 'warning',
  'notified-no-issue': 'warning',
  'issue-open': '',
  'issue-closed': 'secondary',
  'issue-unknown': '',
}

const STAGE_CHIP_CLASS: Readonly<Record<DevelopmentStatusEntry['stage'], string>> = {
  'development-only': 'warning',
  'awaiting-checklist': 'warning',
  'awaiting-owner': 'danger',
  'in-progress': '',
  planned: 'secondary',
  'on-hold': 'secondary',
}

export function DeveloperDashboardDetail({ authMode, workspaceKey, classrooms, reports, reportsLoading, reportsReady, reportsError, issues, issuesLoading, issuesReady, issuesError, issueStates, checklist }: DeveloperDashboardDetailProps) {
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)
  const classroomRows = useMemo(
    () => summarizeDeveloperReportsByClassroom(reports, classrooms, { issueStates, isDevelopmentClassroom: (id) => isDevelopmentClassroom({ id }, workspaceKey) }),
    [reports, classrooms, issueStates, workspaceKey],
  )
  const recentReports = useMemo(() => sortDeveloperReportsNewestFirst(reports).slice(0, RECENT_REPORT_LIMIT), [reports])
  const featureRows = useMemo(() => buildFeatureRolloutOverview(), [])
  const openIssues = useMemo(() => issues.filter((issue) => issue.state === 'open'), [issues])
  const openUserReportIssues = useMemo(() => openIssues.filter((issue) => issue.isUserReport), [openIssues])
  const openOtherIssues = useMemo(() => openIssues.filter((issue) => !issue.isUserReport), [openIssues])
  const needsImprovementRows = useMemo(() => checklist.rows.filter((row) => row.status === 'needs-improvement'), [checklist])
  const recentlyClosedIssues = useMemo(() => issues.filter((issue) => issue.state === 'closed').slice(0, CLOSED_ISSUE_DISPLAY_LIMIT), [issues])
  const ledgerByStage = useMemo(
    () => DEVELOPMENT_STATUS_STAGES.map((stage) => ({ stage, entries: DEVELOPMENT_STATUS_LEDGER.filter((entry) => entry.stage === stage) })).filter((group) => group.entries.length > 0),
    [],
  )

  return (
    <>
      {/* ── 1. 報告・要望の状況(教室別) ─────────────────────────────────── */}
      <section className="basic-data-section-card developer-backup-panel" id="dashboard-reports">
        <div className="basic-data-card-head">
          <h3>1. 質問・要望の状況(教室別)</h3>
          <p>「質問・要望」ボタンから届いた報告を教室ごとに数えます。テスト送信(#テスト)と確認リストは種別に数えず別列に出します。「Issue 起票待ち」は 15 分ごとの起票ワークフローがまだ拾っていない報告です。</p>
        </div>
        {authMode !== 'firebase' ? <div className="toolbar-status">ローカルモードでは報告を読み込めません(Firebase 接続時のみ)。</div> : null}
        {reportsLoading ? <div className="toolbar-status">報告を読み込んでいます…</div> : null}
        {reportsError ? <div className="developer-report-error">{reportsError}</div> : null}
        {reportsReady && reports.length >= DEVELOPER_DASHBOARD_REPORT_LIMIT ? (
          <div className="developer-report-error">読み込み上限 {DEVELOPER_DASHBOARD_REPORT_LIMIT} 件に達したため、それより古い報告は数えていません。期間を短くしてください。</div>
        ) : null}
        <div className="developer-dashboard-table-wrap">
          <table className="developer-billing-table developer-dashboard-table">
            <thead>
              <tr>
                <th>教室</th>
                <th className="num">質問</th>
                <th className="num">要望</th>
                <th className="num">不具合</th>
                <th className="num">Issue 起票待ち</th>
                <th>Issue 対応中</th>
                <th className="num">確認リスト</th>
                <th className="num">テスト</th>
                <th>最終報告</th>
              </tr>
            </thead>
            <tbody>
              {classroomRows.map((row) => (
                <tr key={row.classroomId} className={row.isDevelopmentClassroom ? 'is-development' : ''}>
                  <td>
                    <strong>{row.classroomName || row.classroomId}</strong>
                    {row.isDevelopmentClassroom ? <span className="status-chip secondary">検証用</span> : null}
                    {!row.isKnownClassroom ? <span className="status-chip secondary">一覧に無い(削除済み)</span> : null}
                  </td>
                  <td className="num">{row.counts.question}</td>
                  <td className="num">{row.counts.request}</td>
                  <td className="num">{row.counts.bug}</td>
                  <td className="num">{row.awaitingIssue > 0 ? <span className="status-chip warning">{row.awaitingIssue}</span> : 0}</td>
                  <td>{row.openIssueNumbers.length === 0 ? '—' : row.openIssueNumbers.map((issueNumber) => <a key={issueNumber} className="developer-dashboard-issue-link" href={buildGitHubIssueUrl(issueNumber)} target="_blank" rel="noreferrer">#{issueNumber}</a>)}</td>
                  <td className="num">{row.counts.checklist}</td>
                  <td className="num">{row.counts.test}</td>
                  <td>{formatDashboardDateTime(row.latestReportedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="developer-dashboard-subheading">直近の報告(新しい順・最大 {RECENT_REPORT_LIMIT} 件)</h4>
        {reportsReady && recentReports.length === 0 ? <div className="toolbar-status">この期間の報告はありません。</div> : null}
        <div className="developer-dashboard-report-list">
          {recentReports.map((entry) => {
            const status = resolveDeveloperReportStatus(entry, issueStates)
            const expanded = expandedReportId === entry.reportId
            return (
              <article key={entry.reportId} className="developer-dashboard-report">
                <div className="developer-dashboard-report-head">
                  <span className="developer-dashboard-report-time">{formatDashboardDateTime(entry.reportedAt || entry.recordedAt)}</span>
                  <strong>{entry.classroomName || entry.classroomId}</strong>
                  <span className="status-chip">{entry.isVerificationChecklist ? '確認リスト' : DEVELOPER_REPORT_CATEGORY_LABELS[entry.category]}</span>
                  <span className={`status-chip ${REPORT_STATUS_CHIP_CLASS[status]}`}>{DEVELOPER_REPORT_STATUS_LABELS[status]}</span>
                  {entry.issueNumber !== null ? <a className="developer-dashboard-issue-link" href={entry.issueUrl || buildGitHubIssueUrl(entry.issueNumber)} target="_blank" rel="noreferrer">#{entry.issueNumber}</a> : null}
                  {entry.hasAiAnswer ? <span className="status-chip secondary">AI 回答あり</span> : null}
                  {entry.aiAnswerError ? <span className="status-chip danger">AI 失敗</span> : null}
                  {entry.mailError ? <span className="status-chip danger">メール失敗</span> : null}
                </div>
                <button type="button" className="developer-dashboard-report-note" onClick={() => setExpandedReportId(expanded ? null : entry.reportId)} aria-expanded={expanded}>
                  {expanded ? entry.note : summarizeDeveloperReportNote(entry.note)}
                </button>
                {expanded ? (
                  <div className="detail-note">
                    受付 {entry.reportId} / 報告元 {entry.source || '—'} / 版 {entry.appVersion || '—'} / 権限 {entry.reporterRole || '—'}
                    {entry.notifySkipped ? ` / 通知省略: ${entry.notifySkipped}` : ''}
                    {entry.mailSentAt ? ` / メール送信 ${formatDashboardDateTime(entry.mailSentAt)}` : ''}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {/* ── 2. 開発状況 ───────────────────────────────────────────────── */}
      <section className="basic-data-section-card developer-backup-panel" id="dashboard-features">
        <div className="basic-data-card-head">
          <h3>2. 開発状況 — 機能の段階(機能フラグ)</h3>
          <p>featureRollout.ts の登録順ではなく、まだ全教室に出ていないものを先に並べます。昇格するときはフラグの scope を変え、進行中テーマ台帳の行も更新します。</p>
        </div>
        <div className="developer-dashboard-table-wrap">
          <table className="developer-billing-table developer-dashboard-table">
            <thead>
              <tr>
                <th>機能</th>
                <th>段階</th>
                <th>フラグ</th>
                <th>説明</th>
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.title}</strong></td>
                  <td><span className={`status-chip ${row.scope === 'all-classrooms' ? 'secondary' : 'warning'}`}>{row.scopeLabel}</span></td>
                  <td><code>{row.key}</code></td>
                  <td className="developer-dashboard-description">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="basic-data-section-card developer-backup-panel" id="dashboard-ledger">
        <div className="basic-data-card-head">
          <h3>3. 開発状況 — 進行中テーマ台帳</h3>
          <p>開発用教室で止まっているもの・作りかけ・オーナー判断待ち・未着手・保留を 1 テーマ 1 行で持ちます(正本 src/utils/developmentStatusLedger.ts)。終わったテーマは載せません。</p>
        </div>
        {ledgerByStage.map((group) => (
          <div key={group.stage} className="developer-dashboard-ledger-group">
            <h4 className="developer-dashboard-subheading">
              <span className={`status-chip ${STAGE_CHIP_CLASS[group.stage]}`}>{DEVELOPMENT_STATUS_STAGE_LABELS[group.stage]}</span>
              <span className="developer-dashboard-count">{group.entries.length} 件</span>
            </h4>
            {group.entries.map((entry) => (
              <article key={entry.id} className="developer-dashboard-ledger-entry">
                <div className="developer-dashboard-ledger-title">
                  <strong>{entry.title}</strong>
                  <span className="basic-data-subcopy">見直し {entry.updatedOn}</span>
                </div>
                <p className="developer-dashboard-ledger-summary">{entry.summary}</p>
                <p className="developer-dashboard-ledger-next"><span className="developer-dashboard-label">次の一手</span>{entry.nextAction}</p>
                <div className="developer-dashboard-ledger-meta">
                  {(entry.featureKeys ?? []).map((key) => <code key={key}>{key}</code>)}
                  {(entry.checklistItemIds ?? []).map((id) => <span key={id} className="selection-pill">確認 {id}</span>)}
                  {entry.references.map((reference) => <span key={reference} className="basic-data-subcopy">{reference}</span>)}
                </div>
              </article>
            ))}
          </div>
        ))}
      </section>

      <section className="basic-data-section-card developer-backup-panel" id="dashboard-issues">
        <div className="basic-data-card-head">
          <h3>4. 開発状況 — GitHub Issue</h3>
          <p>公開リポジトリ <a href={`${GITHUB_REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer">{GITHUB_REPOSITORY}</a> の Issue を読みます(直近更新 100 件)。利用者報告(source:user-report)は勝手に修正を始めず、オーナーの確認後に着手します。</p>
        </div>
        {issuesLoading ? <div className="toolbar-status">GitHub Issue を読み込んでいます…</div> : null}
        {issuesError ? <div className="developer-report-error">{issuesError}</div> : null}
        {issuesReady ? (
          <>
            <h4 className="developer-dashboard-subheading">利用者からの報告・要望・質問(open {openUserReportIssues.length} 件)</h4>
            <IssueList issues={openUserReportIssues} emptyLabel="open の利用者報告 Issue はありません。" />
            <h4 className="developer-dashboard-subheading">開発側の課題(open {openOtherIssues.length} 件)</h4>
            <IssueList issues={openOtherIssues} emptyLabel="open の課題 Issue はありません。" />
            <h4 className="developer-dashboard-subheading">最近クローズした Issue(最大 {CLOSED_ISSUE_DISPLAY_LIMIT} 件)</h4>
            <IssueList issues={recentlyClosedIssues} emptyLabel="直近にクローズした Issue はありません。" />
          </>
        ) : null}
      </section>

      {/* ── 5. 確認リスト ─────────────────────────────────────────────── */}
      <section className="basic-data-section-card developer-backup-panel" id="dashboard-checklist">
        <div className="basic-data-card-head">
          <h3>5. 確認リスト({checklist.version})の要改善</h3>
          <p>確認リストパネル(開発用教室)から送られた結果のうち、直す必要がある「要改善」だけを出します。項目ごとの確認・未確認は確認リストパネルが正本です(役割の重複を避ける・2026-09-28 オーナー指示)。</p>
        </div>
        <div className="developer-dashboard-checklist-counts">
          <span className="status-chip secondary">OK {checklist.counts.ok}</span>
          <span className="status-chip warning">要改善 {checklist.counts.needsImprovement}</span>
          <span className="status-chip">未確認 {checklist.counts.unanswered}</span>
          <span className="basic-data-subcopy">最終受付 {formatDashboardDateTime(checklist.latestSubmissionAt)}</span>
        </div>
        {needsImprovementRows.length === 0 ? <div className="toolbar-status">要改善の項目はありません。</div> : null}
        {needsImprovementRows.length > 0 ? (
        <div className="developer-dashboard-table-wrap">
          <table className="developer-billing-table developer-dashboard-table">
            <thead>
              <tr>
                <th>id</th>
                <th>分類</th>
                <th>項目</th>
                <th>メモ</th>
                <th>受付</th>
              </tr>
            </thead>
            <tbody>
              {needsImprovementRows.map((row) => (
                <tr key={row.id} className={`is-${row.status}`}>
                  <td><code>{row.id}</code></td>
                  <td>{row.area}</td>
                  <td>{row.title}<span className="basic-data-subcopy">追加 {row.introducedIn}</span></td>
                  <td className="developer-dashboard-description">
                    {row.memo}
                    {row.previousVersionResult ? <span className="basic-data-subcopy">前の版(v{row.previousVersionResult.version})では {row.previousVersionResult.result === 'ok' ? 'OK' : '要改善'}{row.previousVersionResult.memo ? `: ${row.previousVersionResult.memo}` : ''}</span> : null}
                  </td>
                  <td>{formatDashboardDateTime(row.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : null}
        <h4 className="developer-dashboard-subheading">その他の気づき(新しい順)</h4>
        {checklist.otherNotes.length === 0 ? <div className="toolbar-status">この期間に「その他」の記入はありません。</div> : null}
        {checklist.otherNotes.map((note) => (
          <div key={`${note.version}-${note.recordedAt}`} className="developer-dashboard-other-note">
            <span className="basic-data-subcopy">v{note.version} / {formatDashboardDateTime(note.recordedAt)}</span>
            <p>{note.note}</p>
          </div>
        ))}
      </section>
    </>
  )
}

function IssueList({ issues, emptyLabel }: { issues: readonly GitHubIssueRecord[]; emptyLabel: string }) {
  if (issues.length === 0) return <div className="toolbar-status">{emptyLabel}</div>
  return (
    <div className="developer-dashboard-issue-list">
      {issues.map((issue) => (
        <a key={issue.number} className="developer-dashboard-issue" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          <span className="developer-dashboard-issue-number">#{issue.number}</span>
          <span className="developer-dashboard-issue-title">{issue.title}</span>
          <span className="developer-dashboard-issue-meta">
            {issue.userReport ? <span className="status-chip">{issue.userReport.classroomName}</span> : null}
            {issue.labels.map((label) => <span key={label} className="selection-pill">{label}</span>)}
            <span className="basic-data-subcopy">{issue.state === 'closed' ? `クローズ ${formatDashboardDateTime(issue.closedAt ?? issue.updatedAt)}` : `作成 ${formatDashboardDateTime(issue.createdAt)}`}{issue.commentCount > 0 ? ` / コメント ${issue.commentCount}` : ''}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
