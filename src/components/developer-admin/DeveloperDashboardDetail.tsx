// 開発ダッシュボードの【報告と Issue の一覧】(2026-09-25 初版の画面を移した裏面)。
//
// 2026-09-28 オーナー指示「情報量が多い。重要なのは何が未対応なのか」で既定画面を別にし、この面は切り替えで開く裏面にした。
// 2026-10-30 オーナー指示「確認リストと重複しており、終わったものも残っている。まずシンプルに」で、確認リストの欄と
// 進行中テーマ台帳の欄を外した(確認リストは確認リストパネル、台帳は既定画面【いまの状況】が正本・docs/spec-developer-report.md §E-3)。
// 残るのは 3 欄: 質問・要望の状況(教室別)／GitHub Issue／機能の公開範囲(機能フラグ)。
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
} from '../../utils/developerDashboard'

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


export function DeveloperDashboardDetail({ authMode, workspaceKey, classrooms, reports, reportsLoading, reportsReady, reportsError, issues, issuesLoading, issuesReady, issuesError, issueStates }: DeveloperDashboardDetailProps) {
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
  const recentlyClosedIssues = useMemo(() => issues.filter((issue) => issue.state === 'closed').slice(0, CLOSED_ISSUE_DISPLAY_LIMIT), [issues])

  return (
    <>
      {/* ── 質問・要望の状況(教室別) ─────────────────────────────────── */}
      <section className="basic-data-section-card developer-backup-panel" id="dashboard-reports">
        <div className="basic-data-card-head">
          <h3>質問・要望の状況(教室別)</h3>
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
                  {entry.attachments.length > 0 ? <span className="status-chip secondary" data-testid={`developer-dashboard-report-attachments-${entry.reportId}`}>画像 {entry.attachments.length}</span> : null}
                </div>
                <button type="button" className="developer-dashboard-report-note" onClick={() => setExpandedReportId(expanded ? null : entry.reportId)} aria-expanded={expanded}>
                  {expanded ? entry.note : summarizeDeveloperReportNote(entry.note)}
                </button>
                {expanded ? (
                  <div className="detail-note">
                    受付 {entry.reportId} / 報告元 {entry.source || '—'} / 版 {entry.appVersion || '—'} / 権限 {entry.reporterRole || '—'}
                    {entry.notifySkipped ? ` / 通知省略: ${entry.notifySkipped}` : ''}
                    {entry.mailSentAt ? ` / メール送信 ${formatDashboardDateTime(entry.mailSentAt)}` : ''}
                    {entry.aiAnswer ? <div className="developer-dashboard-ai-answer" data-testid={`developer-dashboard-ai-answer-${entry.reportId}`}>AI の回答(室長に表示):{'\n'}{entry.aiAnswer}</div> : null}
                    {entry.aiAnswerError ? <div className="developer-dashboard-ai-answer" data-testid={`developer-dashboard-ai-error-${entry.reportId}`}>AI 失敗の理由: {entry.aiAnswerError}</div> : null}
                    {entry.aiAnswerBlocked ? <div className="developer-dashboard-ai-answer" data-testid={`developer-dashboard-ai-blocked-${entry.reportId}`}>止めた回答(室長には未表示):{'\n'}{entry.aiAnswerBlocked}</div> : null}
                    {entry.aiAnswerModel || entry.aiAnswerDigestStudents.length > 0 ? (
                      <div className="detail-note" data-testid={`developer-dashboard-ai-meta-${entry.reportId}`}>
                        {entry.aiAnswerModel ? `主モデル ${entry.aiAnswerModel}${entry.aiAnswerCostYen !== null ? `(約 ${entry.aiAnswerCostYen} 円)` : ''}` : ''}
                        {entry.aiAnswerDigestStudents.length > 0 ? ` / 数字を渡した生徒: ${entry.aiAnswerDigestStudents.join('・')}` : ''}
                      </div>
                    ) : null}
                    {entry.aiAnswerShadowModel ? (
                      <div className="developer-dashboard-ai-answer" data-testid={`developer-dashboard-ai-shadow-${entry.reportId}`}>
                        比較用 {entry.aiAnswerShadowModel}{entry.aiAnswerShadowCostYen !== null ? `(約 ${entry.aiAnswerShadowCostYen} 円)` : ''}の回答(室長には未表示):{'\n'}
                        {entry.aiAnswerShadow || (entry.aiAnswerShadowBlocked ? `[止めた: ${entry.aiAnswerShadowError}]\n${entry.aiAnswerShadowBlocked}` : `[失敗: ${entry.aiAnswerShadowError}]`)}
                      </div>
                    ) : null}
                    {entry.attachments.length > 0 ? (
                      // 添付画像(2026-10-14)は Storage の保存先だけ出す(画像本体はクライアントから読めない・読み取り専用トークンで取る)。
                      <ul className="developer-dashboard-report-attachments">
                        {entry.attachments.map((attachment) => (
                          <li key={attachment.storagePath}>画像 {attachment.label ? `${attachment.label}: ` : ''}{attachment.name}({Math.max(1, Math.round(attachment.byteLength / 1024))}KB) → {attachment.storagePath}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {/* ── 機能の公開範囲 ─────────────────────────────────────────────── */}
      <section className="basic-data-section-card developer-backup-panel" id="dashboard-features">
        <div className="basic-data-card-head">
          <h3>機能の公開範囲(機能フラグ)</h3>
          <p>featureRollout.ts の登録順ではなく、まだ全教室に出ていないものを先に並べます。全教室に出すときはフラグの scope を変え、進行中テーマ台帳(src/utils/developmentStatusLedger.ts)の行も更新します。</p>
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

      <section className="basic-data-section-card developer-backup-panel" id="dashboard-issues">
        <div className="basic-data-card-head">
          <h3>GitHub Issue</h3>
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
