// 開発ダッシュボード(開発者画面のサブページ・2026-09-25 オーナー指示)。
//
// 会社(workspace)・教室ごとの「質問・要望」の状況、開発の段階(機能フラグ・進行中テーマ・GitHub Issue)、
// 確認リストの確認済み/未確認を 1 画面に集約する。開発者だけが見る画面(App.tsx で role === 'developer' に限定)。
//
// ★読み取り専用。Firestore(developerReports)は developerReportsStore.ts の getDocs、GitHub は公開 API の GET だけ。
//   この画面から何かを書き込む導線は作らない(本番データ保護ルール)。
// ★集計はすべて src/utils/developerDashboard.ts の純関数に委譲する(このコンポーネントは取得と見た目だけ)。

import { useCallback, useEffect, useMemo, useState } from 'react'

import { listRecentDeveloperReports } from '../../integrations/firebase/developerReportsStore'
import { fetchGitHubIssues } from '../../integrations/github/issues'
import { isDevelopmentClassroom } from '../../utils/developmentClassroom'
import {
  CHECKLIST_ITEM_STATUS_LABELS,
  DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS,
  DEVELOPER_DASHBOARD_REPORT_LIMIT,
  DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS,
  DEVELOPER_REPORT_CATEGORY_LABELS,
  DEVELOPER_REPORT_STATUS_LABELS,
  GITHUB_REPOSITORY,
  GITHUB_REPOSITORY_URL,
  buildFeatureRolloutOverview,
  buildGitHubIssueUrl,
  buildIssueStateMap,
  formatDashboardDateTime,
  resolveDeveloperDashboardSinceIso,
  resolveDeveloperReportStatus,
  sortDeveloperReportsNewestFirst,
  summarizeDeveloperReportNote,
  summarizeDeveloperReportsByClassroom,
  summarizeVerificationChecklistStatus,
  type DeveloperReportRecord,
  type DeveloperReportStatus,
  type GitHubIssueRecord,
} from '../../utils/developerDashboard'
import {
  DEVELOPMENT_STATUS_LEDGER,
  DEVELOPMENT_STATUS_STAGES,
  DEVELOPMENT_STATUS_STAGE_LABELS,
  type DevelopmentStatusEntry,
} from '../../utils/developmentStatusLedger'

export type DeveloperDashboardScreenProps = {
  authMode: 'local' | 'firebase'
  workspaceKey: string
  appVersion: string
  classrooms: ReadonlyArray<{ id: string; name: string; contractStatus: 'active' | 'suspended' }>
  onBack: () => void
  /** テスト・差し替え用。既定は developerReportsStore.listRecentDeveloperReports(読み取りのみ)。 */
  loadReports?: (options: { sinceIso: string; limit: number }) => Promise<DeveloperReportRecord[]>
  /** テスト・差し替え用。既定は github/issues.fetchGitHubIssues(公開 API の GET のみ)。 */
  loadIssues?: () => Promise<GitHubIssueRecord[]>
}

const RECENT_REPORT_LIMIT = 40
const CLOSED_ISSUE_DISPLAY_LIMIT = 8

const REPORT_STATUS_CHIP_CLASS: Readonly<Record<DeveloperReportStatus, string>> = {
  test: 'secondary',
  checklist: 'secondary',
  'awaiting-issue': 'warning',
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function DeveloperDashboardScreen({ authMode, workspaceKey, appVersion, classrooms, onBack, loadReports = listRecentDeveloperReports, loadIssues = fetchGitHubIssues }: DeveloperDashboardScreenProps) {
  const [sinceDays, setSinceDays] = useState<number>(DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS)
  // 読み込みの世代番号(state)。再読込・期間変更で +1 し、effect はその世代の結果だけを state へ入れる。
  // 「読み込み中」は「結果の世代 ≠ 現在の世代」から導く(effect 本体で setState を同期的に呼ばない
  // = react-hooks/set-state-in-effect。古い世代の結果で新しい表示を上書きしないガードも兼ねる)。
  const [requestSerial, setRequestSerial] = useState(0)
  const [reportsResult, setReportsResult] = useState<{ serial: number; reports: DeveloperReportRecord[]; error: string; loadedAt: string } | null>(null)
  const [issuesResult, setIssuesResult] = useState<{ serial: number; issues: GitHubIssueRecord[]; error: string; loadedAt: string } | null>(null)
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)

  const reload = useCallback(() => setRequestSerial((value) => value + 1), [])
  const changeSinceDays = useCallback((days: number) => {
    setSinceDays(days)
    setRequestSerial((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const serial = requestSerial
    if (authMode === 'firebase') {
      void loadReports({ sinceIso: resolveDeveloperDashboardSinceIso(sinceDays), limit: DEVELOPER_DASHBOARD_REPORT_LIMIT })
        .then((loaded) => {
          if (!cancelled) setReportsResult({ serial, reports: loaded, error: '', loadedAt: new Date().toISOString() })
        })
        .catch((error: unknown) => {
          if (!cancelled) setReportsResult({ serial, reports: [], error: errorMessage(error, '報告を読み込めませんでした。'), loadedAt: new Date().toISOString() })
        })
    }
    void loadIssues()
      .then((loaded) => {
        if (!cancelled) setIssuesResult({ serial, issues: loaded, error: '', loadedAt: new Date().toISOString() })
      })
      .catch((error: unknown) => {
        if (!cancelled) setIssuesResult({ serial, issues: [], error: errorMessage(error, 'GitHub Issue を読み込めませんでした。'), loadedAt: new Date().toISOString() })
      })
    return () => {
      cancelled = true
    }
  }, [authMode, loadReports, loadIssues, sinceDays, requestSerial])

  const reportsCurrent = reportsResult?.serial === requestSerial ? reportsResult : null
  const issuesCurrent = issuesResult?.serial === requestSerial ? issuesResult : null
  const reportsLoading = authMode === 'firebase' && reportsCurrent === null
  const reportsReady = authMode === 'firebase' && reportsCurrent !== null && !reportsCurrent.error
  const reportsError = reportsCurrent?.error ?? ''
  const reports = useMemo(() => reportsCurrent?.reports ?? [], [reportsCurrent])
  const issuesLoading = issuesCurrent === null
  const issuesReady = issuesCurrent !== null && !issuesCurrent.error
  const issuesError = issuesCurrent?.error ?? ''
  const issues = useMemo(() => issuesCurrent?.issues ?? [], [issuesCurrent])
  const loadedAt = [reportsCurrent?.loadedAt ?? '', issuesCurrent?.loadedAt ?? ''].sort().reverse()[0] ?? ''

  const issueStates = useMemo(() => buildIssueStateMap(issues), [issues])
  const classroomRows = useMemo(
    () => summarizeDeveloperReportsByClassroom(reports, classrooms, { issueStates, isDevelopmentClassroom: (id) => isDevelopmentClassroom({ id }, workspaceKey) }),
    [reports, classrooms, issueStates, workspaceKey],
  )
  const recentReports = useMemo(() => sortDeveloperReportsNewestFirst(reports).slice(0, RECENT_REPORT_LIMIT), [reports])
  const featureRows = useMemo(() => buildFeatureRolloutOverview(), [])
  const checklist = useMemo(() => summarizeVerificationChecklistStatus(reports), [reports])
  const openIssues = useMemo(() => issues.filter((issue) => issue.state === 'open'), [issues])
  const openUserReportIssues = useMemo(() => openIssues.filter((issue) => issue.isUserReport), [openIssues])
  const openOtherIssues = useMemo(() => openIssues.filter((issue) => !issue.isUserReport), [openIssues])
  const recentlyClosedIssues = useMemo(() => issues.filter((issue) => issue.state === 'closed').slice(0, CLOSED_ISSUE_DISPLAY_LIMIT), [issues])
  const awaitingIssueTotal = useMemo(() => classroomRows.reduce((sum, row) => sum + row.awaitingIssue, 0), [classroomRows])
  const ledgerByStage = useMemo(
    () => DEVELOPMENT_STATUS_STAGES.map((stage) => ({ stage, entries: DEVELOPMENT_STATUS_LEDGER.filter((entry) => entry.stage === stage) })).filter((group) => group.entries.length > 0),
    [],
  )
  const earlyFeatureCount = useMemo(() => featureRows.filter((row) => row.scope !== 'all-classrooms').length, [featureRows])

  return (
    <main className="developer-main developer-dashboard" aria-label="開発ダッシュボード">
      <section className="board-panel board-panel-unified">
        <div className="basic-data-header developer-header">
          <div>
            <p className="panel-kicker">Developer Dashboard</p>
            <h2>開発ダッシュボード</h2>
            <p className="page-summary">会社「{workspaceKey || '(ローカル)'}」の質問・要望の状況、開発の段階、確認リストの確認済み／未確認をまとめて表示します(読み取り専用・書き込みはしません)。</p>
          </div>
        </div>
        <div className="developer-header-actions">
          <div className="basic-data-row-actions developer-actions-left">
            <button className="secondary-button slim" type="button" onClick={onBack}>← 管理画面に戻る</button>
            <label className="basic-data-inline-field developer-dashboard-range-field">
              <span>報告の期間</span>
              <select value={sinceDays} onChange={(event) => changeSinceDays(Number(event.target.value))}>
                {DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS.map((days) => <option key={days} value={days}>直近 {days} 日</option>)}
              </select>
            </label>
          </div>
          <div className="basic-data-row-actions developer-actions-right">
            <span className="toolbar-status">アプリ版 v{appVersion} / 読込 {formatDashboardDateTime(loadedAt)}</span>
            <button className="secondary-button slim" type="button" onClick={reload} disabled={reportsLoading || issuesLoading}>再読込</button>
          </div>
        </div>

        <div className="developer-dashboard-summary">
          <a className="developer-dashboard-tile" href="#dashboard-reports">
            <span className="developer-dashboard-tile-label">Issue 起票待ちの報告</span>
            <strong>{reportsReady ? awaitingIssueTotal : '—'}</strong>
          </a>
          <a className="developer-dashboard-tile" href="#dashboard-issues">
            <span className="developer-dashboard-tile-label">利用者報告の Issue(対応中)</span>
            <strong>{issuesReady ? openUserReportIssues.length : '—'}</strong>
          </a>
          <a className="developer-dashboard-tile" href="#dashboard-checklist">
            <span className="developer-dashboard-tile-label">確認リスト 未確認 / 要改善</span>
            <strong>{reportsReady ? `${checklist.counts.unanswered} / ${checklist.counts.needsImprovement}` : '—'}</strong>
          </a>
          <a className="developer-dashboard-tile" href="#dashboard-features">
            <span className="developer-dashboard-tile-label">全教室に出ていない機能</span>
            <strong>{earlyFeatureCount}</strong>
          </a>
          <a className="developer-dashboard-tile" href="#dashboard-ledger">
            <span className="developer-dashboard-tile-label">進行中テーマ</span>
            <strong>{DEVELOPMENT_STATUS_LEDGER.length}</strong>
          </a>
        </div>

        {/* ── 1. 報告・要望の状況(教室別) ─────────────────────────────────── */}
        <section className="basic-data-section-card developer-backup-panel" id="dashboard-reports">
          <div className="basic-data-card-head">
            <h3>1. 質問・要望の状況(教室別)</h3>
            <p>「質問・要望」ボタンから届いた報告を教室ごとに数えます。テスト送信(#テスト)と確認リストは種別に数えず別列に出します。「Issue 起票待ち」は 15 分ごとの起票ワークフローがまだ拾っていない報告です。</p>
          </div>
          {authMode !== 'firebase' ? <div className="toolbar-status">ローカルモードでは報告を読み込めません(Firebase 接続時のみ)。</div> : null}
          {reportsLoading ? <div className="toolbar-status">報告を読み込んでいます…</div> : null}
          {reportsError ? <div className="developer-report-error">{reportsError}</div> : null}
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
            <h3>5. 確認リスト({checklist.version})の確認済み／未確認</h3>
            <p>開発用教室の確認リストパネルから送られた結果(developerReports)を項目ごとに重ねます。同じ id でも前の版の結果は別物として参考表示だけにします。</p>
          </div>
          <div className="developer-dashboard-checklist-counts">
            <span className="status-chip secondary">OK {checklist.counts.ok}</span>
            <span className="status-chip warning">要改善 {checklist.counts.needsImprovement}</span>
            <span className="status-chip">未確認 {checklist.counts.unanswered}</span>
            <span className="basic-data-subcopy">最終受付 {formatDashboardDateTime(checklist.latestSubmissionAt)}</span>
            {checklist.resultsOutsideDefinition > 0 ? <span className="basic-data-subcopy">現行版に無い項目の結果 {checklist.resultsOutsideDefinition} 件は表に出しません</span> : null}
          </div>
          <div className="developer-dashboard-table-wrap">
            <table className="developer-billing-table developer-dashboard-table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>分類</th>
                  <th>項目</th>
                  <th>結果</th>
                  <th>メモ</th>
                  <th>受付</th>
                </tr>
              </thead>
              <tbody>
                {checklist.rows.map((row) => (
                  <tr key={row.id} className={`is-${row.status}`}>
                    <td><code>{row.id}</code></td>
                    <td>{row.area}</td>
                    <td>{row.title}<span className="basic-data-subcopy">追加 {row.introducedIn}</span></td>
                    <td><span className={`status-chip ${row.status === 'ok' ? 'secondary' : row.status === 'needs-improvement' ? 'warning' : ''}`}>{CHECKLIST_ITEM_STATUS_LABELS[row.status]}</span></td>
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
          <h4 className="developer-dashboard-subheading">その他の気づき(新しい順)</h4>
          {checklist.otherNotes.length === 0 ? <div className="toolbar-status">この期間に「その他」の記入はありません。</div> : null}
          {checklist.otherNotes.map((note) => (
            <div key={`${note.version}-${note.recordedAt}`} className="developer-dashboard-other-note">
              <span className="basic-data-subcopy">v{note.version} / {formatDashboardDateTime(note.recordedAt)}</span>
              <p>{note.note}</p>
            </div>
          ))}
        </section>
      </section>
    </main>
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
