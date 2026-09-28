// 開発ダッシュボード(開発者画面のサブページ・2026-09-25 オーナー指示)。
//
// 2026-09-28 オーナー指示「情報量が多い。重要なのは何が未対応なのか。極力一画面に収まる情報量で、未対応をその画面から
// 進められる(Claude Code の新セッションに投げかけられる)インターフェースにして」:
//   - 既定画面は【未対応】= 1 行 1 件の一覧(種別・題名・誰の番か・リンク・Claude Code へ)。済んだものは出さない。
//     待ち(自動処理待ち・確認リスト結果待ち・保留)は畳んで一画面に収める。
//   - 行を選んで「Claude Code で開く」を押すと、公式の URL 形式(https://claude.ai/code?prompt=…&repositories=…)で
//     新セッションが指示入り(入力済み)で開く。URL に載らない長さならクリップボードへ写して素の新セッションを開く。
//   - 2026-09-28 確認リスト d-4 の要改善: (1) 行の「内容」を押すとその件の詳細を行の下に開く、(2) Claude への指示を短く、
//     (3) 投げる前に指示をこの画面で書き足し・書き換えできる(常に出ている編集欄。編集後に選択を変えたら「選択から作り直す」)、
//     (4) 確認リストとの重複をなくす(未確認の項目は出さない = 確認リストパネルが正本)。
//   - 従来の 5 欄(教室別の報告状況／機能の段階／進行中テーマ／GitHub Issue／確認リスト)は「詳細を見る」で開く
//     DeveloperDashboardDetail.tsx に移した(内容は据え置き)。
//
// ★読み取り専用。Firestore(developerReports)は developerReportsStore.ts の getDocs、GitHub は公開 API の GET だけ。
//   この画面から何かを書き込む導線は作らない(本番データ保護ルール)。Claude Code へ渡すのは URL とクリップボードだけ。
// ★集計はすべて src/utils/developerDashboard.ts / developerDashboardActions.ts の純関数に委譲する(ここは取得と見た目だけ)。

import { useCallback, useEffect, useMemo, useState } from 'react'

import { listRecentDeveloperReports } from '../../integrations/firebase/developerReportsStore'
import { fetchGitHubIssues } from '../../integrations/github/issues'
import {
  DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS,
  DEVELOPER_DASHBOARD_REPORT_LIMIT,
  DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS,
  buildIssueStateMap,
  formatDashboardDateTime,
  resolveDeveloperDashboardSinceIso,
  summarizeVerificationChecklistStatus,
  type DeveloperReportRecord,
  type GitHubIssueRecord,
} from '../../utils/developerDashboard'
import {
  CLAUDE_CODE_NEW_SESSION_URL,
  DASHBOARD_ACTION_TURN_LABELS,
  buildClaudeCodePrompt,
  buildDashboardActions,
  resolveClaudeCodeSessionUrl,
  type DashboardActionItem,
  type DashboardActionTurn,
} from '../../utils/developerDashboardActions'
import { DeveloperDashboardDetail } from './DeveloperDashboardDetail'

export type DeveloperDashboardView = 'todo' | 'detail'

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
  /** 最初に開く面。既定は未対応一覧(テストで詳細面を描くために差し替え可)。 */
  initialView?: DeveloperDashboardView
}

const TURN_CHIP_CLASS: Readonly<Record<DashboardActionTurn, string>> = {
  claude: '',
  owner: 'danger',
  waiting: 'secondary',
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 権限なし・非セキュアコンテキストなど。下の textarea から手でコピーしてもらう。
  }
  return false
}

export function DeveloperDashboardScreen({ authMode, workspaceKey, appVersion, classrooms, onBack, loadReports = listRecentDeveloperReports, loadIssues = fetchGitHubIssues, initialView = 'todo' }: DeveloperDashboardScreenProps) {
  const [view, setView] = useState<DeveloperDashboardView>(initialView)
  const [sinceDays, setSinceDays] = useState<number>(DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS)
  // 読み込みの世代番号(state)。再読込・期間変更で +1 し、effect はその世代の結果だけを state へ入れる。
  // 「読み込み中」は「結果の世代 ≠ 現在の世代」から導く(effect 本体で setState を同期的に呼ばない
  // = react-hooks/set-state-in-effect。古い世代の結果で新しい表示を上書きしないガードも兼ねる)。
  const [requestSerial, setRequestSerial] = useState(0)
  const [reportsResult, setReportsResult] = useState<{ serial: number; reports: DeveloperReportRecord[]; error: string; loadedAt: string } | null>(null)
  const [issuesResult, setIssuesResult] = useState<{ serial: number; issues: GitHubIssueRecord[]; error: string; loadedAt: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showWaiting, setShowWaiting] = useState(false)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  // 画面で書き換えた指示。null = 選択から作った文をそのまま使う。base = 書き換え始めたときの自動文(選択が変わったかの判定用)。
  const [editedPrompt, setEditedPrompt] = useState<{ text: string; base: string } | null>(null)
  const [copyStatus, setCopyStatus] = useState<'' | 'copied' | 'failed'>('')

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
  const checklist = useMemo(() => summarizeVerificationChecklistStatus(reports), [reports])
  const actions = useMemo(() => buildDashboardActions({ reports, issues, issueStates, checklist, reportsReady }), [reports, issues, issueStates, checklist, reportsReady])

  const selectableIds = useMemo(() => new Set([...actions.active, ...actions.waiting].filter((item) => item.prompt !== null).map((item) => item.id)), [actions])
  const selectedItems = useMemo(
    () => [...actions.active, ...actions.waiting].filter((item) => selectedIds.has(item.id) && item.prompt !== null),
    [actions, selectedIds],
  )
  const selectedPrompt = useMemo(
    () => (selectedItems.length === 0 ? '' : buildClaudeCodePrompt(selectedItems, { appVersion, generatedAt: loadedAt })),
    [selectedItems, appVersion, loadedAt],
  )
  const promptText = editedPrompt?.text ?? selectedPrompt
  const hasPromptText = promptText.trim() !== ''
  const promptStale = editedPrompt !== null && editedPrompt.base !== selectedPrompt
  const selectedUrl = useMemo(() => (hasPromptText ? resolveClaudeCodeSessionUrl(promptText) : null), [hasPromptText, promptText])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setCopyStatus('')
  }, [])
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const editPrompt = useCallback(
    (text: string) => {
      setEditedPrompt((current) => ({ text, base: current?.base ?? selectedPrompt }))
      setCopyStatus('')
    },
    [selectedPrompt],
  )
  const rebuildPrompt = useCallback(() => {
    setEditedPrompt(null)
    setCopyStatus('')
  }, [])
  // 「全選択」は Claude の番の行だけ。オーナーの番(利用者報告 Issue の着手可否・昇格判断など)は 1 件ずつ明示的にチェックする
  // = その 1 クリックが着手許可(CLAUDE.md「オーナーが内容を確認して許可してから」を一括で肩代わりしない・regression-reviewer 指摘 2026-09-28)。
  const selectAllClaude = useCallback(() => {
    setSelectedIds(new Set(actions.active.filter((item) => item.prompt !== null && item.turn === 'claude').map((item) => item.id)))
    setCopyStatus('')
  }, [actions])
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setCopyStatus('')
  }, [])
  const copyPrompt = useCallback(() => {
    void copyToClipboard(promptText).then((ok) => setCopyStatus(ok ? 'copied' : 'failed'))
  }, [promptText])

  const singleItemUrl = useCallback(
    (item: DashboardActionItem) => (item.prompt === null ? null : resolveClaudeCodeSessionUrl(buildClaudeCodePrompt([item], { appVersion, generatedAt: loadedAt }))),
    [appVersion, loadedAt],
  )

  const loadingNote = [reportsLoading ? '報告を読み込んでいます…' : '', issuesLoading ? 'GitHub Issue を読み込んでいます…' : ''].filter(Boolean).join(' ')

  return (
    <main className={`developer-main developer-dashboard ${view === 'todo' ? 'developer-dashboard-compact' : ''}`} aria-label="開発ダッシュボード">
      <section className="board-panel board-panel-unified">
        <div className="basic-data-header developer-header developer-dashboard-head">
          <div>
            <p className="panel-kicker">Developer Dashboard</p>
            <h2>{view === 'todo' ? '未対応' : '開発ダッシュボード(詳細)'}</h2>
            {view === 'todo' ? (
              <p className="page-summary">会社「{workspaceKey || '(ローカル)'}」で今止まっているものだけを 1 行ずつ出します。行を選んで「Claude Code で開く」を押すと、指示が入った新しいセッションが開きます(この画面は何も書き込みません)。</p>
            ) : (
              <p className="page-summary">会社「{workspaceKey || '(ローカル)'}」の質問・要望の状況、開発の段階、確認リストの要改善です(読み取り専用。項目ごとの確認は確認リストパネルで)。</p>
            )}
          </div>
        </div>
        <div className="developer-header-actions">
          <div className="basic-data-row-actions developer-actions-left">
            <button className="secondary-button slim" type="button" onClick={onBack}>← 管理画面に戻る</button>
            <button className="secondary-button slim" type="button" onClick={() => setView(view === 'todo' ? 'detail' : 'todo')} data-testid="developer-dashboard-view-toggle">
              {view === 'todo' ? '詳細を見る' : '未対応に戻る'}
            </button>
            <label className="basic-data-inline-field developer-dashboard-range-field">
              <span>報告の期間</span>
              <select value={sinceDays} onChange={(event) => changeSinceDays(Number(event.target.value))}>
                {DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS.map((days) => <option key={days} value={days}>直近 {days} 日</option>)}
              </select>
            </label>
          </div>
          <div className="basic-data-row-actions developer-actions-right">
            <span className="toolbar-status">v{appVersion} / 読込 {formatDashboardDateTime(loadedAt)}</span>
            <button className="secondary-button slim" type="button" onClick={reload} disabled={reportsLoading || issuesLoading}>再読込</button>
          </div>
        </div>

        {view === 'detail' ? (
          <DeveloperDashboardDetail
            authMode={authMode}
            workspaceKey={workspaceKey}
            classrooms={classrooms}
            reports={reports}
            reportsLoading={reportsLoading}
            reportsReady={reportsReady}
            reportsError={reportsError}
            issues={issues}
            issuesLoading={issuesLoading}
            issuesReady={issuesReady}
            issuesError={issuesError}
            issueStates={issueStates}
            checklist={checklist}
          />
        ) : (
          <section className="developer-dashboard-todo" id="dashboard-todo" aria-label="未対応の一覧">
            <div className="developer-dashboard-todo-counts">
              <span className="status-chip warning">未対応 {actions.counts.total}</span>
              <span className="status-chip">Claude の番 {actions.counts.claude}</span>
              <span className="status-chip danger">オーナーの番 {actions.counts.owner}</span>
              <span className="status-chip secondary">待ち {actions.counts.waiting}</span>
              {authMode !== 'firebase' ? <span className="basic-data-subcopy">ローカルモードでは報告を読み込めません(Firebase 接続時のみ)。</span> : null}
              {loadingNote ? <span className="basic-data-subcopy">{loadingNote}</span> : null}
              {reportsError ? <span className="developer-report-error">{reportsError}</span> : null}
              {issuesError ? <span className="developer-report-error">{issuesError}</span> : null}
              {reportsReady && reports.length >= DEVELOPER_DASHBOARD_REPORT_LIMIT ? <span className="developer-report-error">読み込み上限 {DEVELOPER_DASHBOARD_REPORT_LIMIT} 件。期間を短くしてください。</span> : null}
            </div>

            <table className="developer-billing-table developer-dashboard-todo-table">
              <thead>
                <tr>
                  <th className="sel">
                    <button type="button" className="link-button" onClick={selectedItems.length > 0 ? clearSelection : selectAllClaude} title={selectedItems.length > 0 ? '選択を外す' : 'Claude の番の行を全部選ぶ(オーナーの番は 1 件ずつ選ぶ)'}>
                      {selectedItems.length > 0 ? '解除' : 'Claude を全選択'}
                    </button>
                  </th>
                  <th>種別</th>
                  <th>内容</th>
                  <th>番</th>
                  <th className="act">開く</th>
                </tr>
              </thead>
              <tbody>
                {actions.active.length === 0 && !loadingNote ? (
                  <tr><td colSpan={5} className="developer-dashboard-todo-empty">今すぐ動ける未対応はありません。</td></tr>
                ) : null}
                {actions.active.map((item) => (
                  <TodoRow key={item.id} item={item} selected={selectedIds.has(item.id)} selectable={selectableIds.has(item.id)} expanded={expandedIds.has(item.id)} onToggle={toggleSelected} onToggleExpanded={toggleExpanded} claudeUrl={singleItemUrl(item)} />
                ))}
                {actions.waiting.length > 0 ? (
                  <tr className="developer-dashboard-todo-group">
                    <td colSpan={5}>
                      <button type="button" className="link-button" onClick={() => setShowWaiting(!showWaiting)} aria-expanded={showWaiting}>
                        {showWaiting ? '▾' : '▸'} 待ち {actions.waiting.length} 件(結果待ち・自動処理待ち・保留)
                      </button>
                    </td>
                  </tr>
                ) : null}
                {showWaiting
                  ? actions.waiting.map((item) => (
                      <TodoRow key={item.id} item={item} selected={selectedIds.has(item.id)} selectable={selectableIds.has(item.id)} expanded={expandedIds.has(item.id)} onToggle={toggleSelected} onToggleExpanded={toggleExpanded} claudeUrl={singleItemUrl(item)} />
                    ))
                  : null}
              </tbody>
            </table>

            <div className="developer-dashboard-launch" data-testid="developer-dashboard-launch">
              <span className="developer-dashboard-launch-count">選択 {selectedItems.length} 件</span>
              {selectedUrl ? (
                <a className="primary-button slim" href={selectedUrl} target="_blank" rel="noreferrer">Claude Code で開く</a>
              ) : (
                <a
                  className={`primary-button slim ${hasPromptText ? '' : 'is-disabled'}`}
                  href={CLAUDE_CODE_NEW_SESSION_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!hasPromptText) {
                      event.preventDefault()
                      return
                    }
                    // 指示が URL に載らない長さ → クリップボードへ写してから素の新セッションを開く(貼り付けで続ける)。
                    copyPrompt()
                  }}
                  title={hasPromptText ? '指示が長いのでクリップボードにコピーして新セッションを開きます(貼り付けてください)' : '行を選ぶか、下の欄に指示を書いてください'}
                >
                  {hasPromptText ? 'コピーして Claude Code を開く' : 'Claude Code で開く'}
                </a>
              )}
              <button type="button" className="secondary-button slim" onClick={copyPrompt} disabled={!hasPromptText}>指示をコピー</button>
              {promptStale ? (
                <button type="button" className="secondary-button slim" onClick={rebuildPrompt} data-testid="developer-dashboard-prompt-rebuild">選択から作り直す</button>
              ) : null}
              {copyStatus === 'copied' ? <span className="basic-data-subcopy">コピーしました。新セッションに貼り付けてください。</span> : null}
              {copyStatus === 'failed' ? <span className="developer-report-error">コピーできませんでした。下の文を選んでコピーしてください。</span> : null}
            </div>
            <textarea
              className="developer-dashboard-prompt"
              value={promptText}
              onChange={(event) => editPrompt(event.target.value)}
              rows={6}
              placeholder="行を選ぶとここに指示が入ります。投げる前に自由に書き足し・書き換えできます(行を選ばず直接書いても投げられます)。"
              aria-label="Claude Code への指示(編集できます)"
              data-testid="developer-dashboard-prompt"
            />
            {promptStale ? <span className="basic-data-subcopy">書き換えたあとに選択が変わりました。今の選択を反映するには「選択から作り直す」(書き換えた分は消えます)。</span> : null}
          </section>
        )}
      </section>
    </main>
  )
}

function TodoRow({
  item,
  selected,
  selectable,
  expanded,
  onToggle,
  onToggleExpanded,
  claudeUrl,
}: {
  item: DashboardActionItem
  selected: boolean
  selectable: boolean
  expanded: boolean
  onToggle: (id: string) => void
  onToggleExpanded: (id: string) => void
  claudeUrl: string | null
}) {
  return (
    <>
    <tr className={`developer-dashboard-todo-row is-${item.turn} ${selected ? 'is-selected' : ''}`} data-action-id={item.id}>
      <td className="sel">
        {selectable ? <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)} aria-label={`${item.title} を選ぶ`} /> : null}
      </td>
      <td className="kind"><span className={`status-chip ${item.kind === 'checklist-needs-improvement' || item.kind === 'report-delivery-failed' ? 'warning' : 'secondary'}`}>{item.kindLabel}</span></td>
      <td className="body">
        <button type="button" className="developer-dashboard-todo-open" onClick={() => onToggleExpanded(item.id)} aria-expanded={expanded} title={expanded ? '詳細を閉じる' : '押すと詳細を開く'}>
          <span className="developer-dashboard-todo-title">{expanded ? '▾' : '▸'} {item.title}</span>
          {item.detail && !expanded ? <span className="developer-dashboard-todo-detail">{item.detail}</span> : null}
        </button>
      </td>
      <td className="turn"><span className={`status-chip ${TURN_CHIP_CLASS[item.turn]}`}>{DASHBOARD_ACTION_TURN_LABELS[item.turn]}</span></td>
      <td className="act">
        {item.href ? <a className="developer-dashboard-issue-link" href={item.href} target="_blank" rel="noreferrer" title="GitHub で開く">GitHub</a> : null}
        {claudeUrl ? <a className="developer-dashboard-issue-link" href={claudeUrl} target="_blank" rel="noreferrer" title="この 1 件を Claude Code の新セッションに投げる">→Claude</a> : null}
      </td>
    </tr>
    {expanded ? (
      <tr className="developer-dashboard-todo-facts" data-facts-for={item.id}>
        <td />
        <td colSpan={4}>
          <ul>
            {item.facts.map((fact, index) => <li key={index}>{fact}</li>)}
          </ul>
        </td>
      </tr>
    ) : null}
    </>
  )
}
