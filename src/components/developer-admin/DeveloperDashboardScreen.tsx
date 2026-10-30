// 開発ダッシュボード(開発者画面のサブページ・2026-09-25 オーナー指示)。
//
// 2026-10-30 オーナー指示「開発ダッシュボードが使いづらい。まずシンプルにして。確認リストと重複しており、終わったものも残っている。
// 開発ダッシュボードは機能の実装がまだのものや、開発・テスト教室だけしか実施していない機能、やるべきこと(確認リスト以外で)などを
// わかり易い文章で表示して。デザインもわかりやすいように変えて」:
//   - 既定画面は【いまの状況】= 3 つの欄(やること／開発・テスト教室だけで動いている機能／まだ作っていないもの)のカード。
//     カードは「何のことか(題名)」「今どうなっているか(1〜2 文)」「次に誰が何をするか」だけを平易な文で出す。経緯は「くわしく」で開く。
//   - 確認リストの結果(要改善・未確認)は出さない(確認リストパネルが正本)。終わった台帳の行は消し、取り残しは「済み」として知らせる。
//   - 2026-09-28 の 1 行 1 件の表・複数選択・指示の編集欄はやめ、カードごとの「Claude に頼む」(指示入りの新セッション)だけにした。
//     指示は Claude Code の入力欄に入るだけなので、送る前にそこで書き足せる。
//   - 報告の教室別一覧・GitHub Issue・機能フラグの全量は「報告と Issue の一覧」(DeveloperDashboardDetail.tsx)で見る。
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
  type DeveloperReportRecord,
  type GitHubIssueRecord,
} from '../../utils/developerDashboard'
import {
  CLAUDE_CODE_NEW_SESSION_URL,
  DASHBOARD_SECTION_DESCRIPTIONS,
  DASHBOARD_SECTION_LABELS,
  DASHBOARD_WHO_LABELS,
  buildDashboardOverview,
  resolveClaudeCodeSessionUrl,
  type DashboardCard,
  type DashboardSection,
} from '../../utils/developerDashboardActions'
import { DeveloperDashboardDetail } from './DeveloperDashboardDetail'

export type DeveloperDashboardView = 'overview' | 'detail'

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
  /** 最初に開く面。既定は【いまの状況】(テストで一覧面を描くために差し替え可)。 */
  initialView?: DeveloperDashboardView
}

const SECTION_ANCHORS: Readonly<Record<DashboardSection, string>> = {
  todo: 'dashboard-todo',
  trial: 'dashboard-trial',
  'not-built': 'dashboard-not-built',
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
    // 権限なし・非セキュアコンテキストなど。
  }
  return false
}

export function DeveloperDashboardScreen({ authMode, workspaceKey, appVersion, classrooms, onBack, loadReports = listRecentDeveloperReports, loadIssues = fetchGitHubIssues, initialView = 'overview' }: DeveloperDashboardScreenProps) {
  const [view, setView] = useState<DeveloperDashboardView>(initialView)
  const [sinceDays, setSinceDays] = useState<number>(DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS)
  // 読み込みの世代番号(state)。再読込・期間変更で +1 し、effect はその世代の結果だけを state へ入れる。
  // 「読み込み中」は「結果の世代 ≠ 現在の世代」から導く(effect 本体で setState を同期的に呼ばない
  // = react-hooks/set-state-in-effect。古い世代の結果で新しい表示を上書きしないガードも兼ねる)。
  const [requestSerial, setRequestSerial] = useState(0)
  const [reportsResult, setReportsResult] = useState<{ serial: number; reports: DeveloperReportRecord[]; error: string; loadedAt: string } | null>(null)
  const [issuesResult, setIssuesResult] = useState<{ serial: number; issues: GitHubIssueRecord[]; error: string; loadedAt: string } | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [copiedCardId, setCopiedCardId] = useState('')

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
  const overview = useMemo(() => buildDashboardOverview({ reports, issues, issueStates }), [reports, issues, issueStates])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const copyCardPrompt = useCallback((card: DashboardCard) => {
    if (card.prompt === null) return
    void copyToClipboard(card.prompt).then((ok) => setCopiedCardId(ok ? card.id : ''))
  }, [])

  const loadingNote = [reportsLoading ? '報告を読み込んでいます…' : '', issuesLoading ? 'GitHub Issue を読み込んでいます…' : ''].filter(Boolean).join(' ')

  const tiles: ReadonlyArray<{ section: DashboardSection; count: number; sub: string }> = [
    { section: 'todo', count: overview.counts.todo, sub: `オーナー ${overview.counts.todoOwner} ／ Claude ${overview.counts.todoClaude}` },
    { section: 'trial', count: overview.counts.trial, sub: '本番の教室ではまだ使えない' },
    { section: 'not-built', count: overview.counts.notBuilt, sub: '計画・保留・GitHub の課題' },
  ]

  const renderCards = (cards: readonly DashboardCard[], emptyLabel: string) =>
    cards.length === 0 ? (
      <p className="dev-dash-empty">{emptyLabel}</p>
    ) : (
      <div className="dev-dash-cards">
        {cards.map((card) => (
          <DashboardCardView key={card.id} card={card} expanded={expandedIds.has(card.id)} copied={copiedCardId === card.id} onToggleExpanded={toggleExpanded} onCopyPrompt={copyCardPrompt} />
        ))}
      </div>
    )

  return (
    <main className="developer-main developer-dashboard" aria-label="開発ダッシュボード">
      <section className="board-panel board-panel-unified">
        <div className="basic-data-header developer-header developer-dashboard-head">
          <div>
            <p className="panel-kicker">Developer Dashboard</p>
            <h2>開発ダッシュボード</h2>
            <p className="page-summary">
              {view === 'overview'
                ? `会社「${workspaceKey || '(ローカル)'}」の開発の状況です。やること・開発用とテスト教室だけで動いている機能・まだ作っていないものを分けて出します(確認リストの項目は出しません。この画面は何も書き込みません)。`
                : `会社「${workspaceKey || '(ローカル)'}」に届いた質問・要望と GitHub の課題、機能の公開範囲の一覧です(読み取り専用)。`}
            </p>
          </div>
        </div>
        <div className="developer-header-actions">
          <div className="basic-data-row-actions developer-actions-left">
            <button className="secondary-button slim" type="button" onClick={onBack}>← 管理画面に戻る</button>
            <div className="dev-dash-view-switch" role="tablist" aria-label="表示の切り替え" data-testid="developer-dashboard-view-toggle">
              <button type="button" role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'is-active' : ''} onClick={() => setView('overview')}>いまの状況</button>
              <button type="button" role="tab" aria-selected={view === 'detail'} className={view === 'detail' ? 'is-active' : ''} onClick={() => setView('detail')}>報告と Issue の一覧</button>
            </div>
            {view === 'detail' ? (
              <label className="basic-data-inline-field developer-dashboard-range-field">
                <span>報告の期間</span>
                <select value={sinceDays} onChange={(event) => changeSinceDays(Number(event.target.value))}>
                  {DEVELOPER_DASHBOARD_SINCE_DAY_OPTIONS.map((days) => <option key={days} value={days}>直近 {days} 日</option>)}
                </select>
              </label>
            ) : null}
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
          />
        ) : (
          <div className="dev-dash" id="dashboard-overview">
            <nav className="dev-dash-tiles" aria-label="3 つの欄">
              {tiles.map((tile) => (
                // URL の # は変えない(# で始まる URL は共有盤面・講習提出の入口が読む)。押すとその欄まで動くだけ。
                <button key={tile.section} type="button" className={`dev-dash-tile is-${tile.section}`} onClick={() => document.getElementById(SECTION_ANCHORS[tile.section])?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  <span className="dev-dash-tile-count">{tile.count}</span>
                  <span className="dev-dash-tile-label">{DASHBOARD_SECTION_LABELS[tile.section]}</span>
                  <span className="dev-dash-tile-sub">{tile.sub}</span>
                </button>
              ))}
            </nav>

            {authMode !== 'firebase' || loadingNote || reportsError || issuesError ? (
              <div className="dev-dash-notes">
                {authMode !== 'firebase' ? <span>ローカルモードでは報告を読み込めません(Firebase 接続時のみ)。</span> : null}
                {loadingNote ? <span>{loadingNote}</span> : null}
                {reportsError ? <span className="developer-report-error">{reportsError}</span> : null}
                {issuesError ? <span className="developer-report-error">{issuesError}</span> : null}
              </div>
            ) : null}

            <section className="dev-dash-section is-todo" id={SECTION_ANCHORS.todo}>
              <SectionHead section="todo" count={overview.counts.todo} />
              <h4 className="dev-dash-subhead"><span className="dev-dash-who is-owner">{DASHBOARD_WHO_LABELS.owner}</span>がやること({overview.counts.todoOwner})</h4>
              {renderCards(overview.todo.owner, 'オーナーがやることはありません。')}
              <h4 className="dev-dash-subhead"><span className="dev-dash-who is-claude">{DASHBOARD_WHO_LABELS.claude}</span>がやること({overview.counts.todoClaude})</h4>
              {renderCards(overview.todo.claude, 'Claude がやることはありません。')}
            </section>

            <section className="dev-dash-section is-trial" id={SECTION_ANCHORS.trial}>
              <SectionHead section="trial" count={overview.counts.trial} />
              {renderCards(overview.trial, '開発・テスト教室だけで動いている機能はありません(すべて全教室に出ています)。')}
            </section>

            <section className="dev-dash-section is-not-built" id={SECTION_ANCHORS['not-built']}>
              <SectionHead section="not-built" count={overview.counts.notBuilt} />
              {renderCards(overview.notBuilt, 'まだ作っていないものはありません。')}
            </section>

            <p className="dev-dash-footnote">
              「Claude に頼む」を押すと、指示が入った Claude Code の新しいセッションが開きます(送る前に書き足せます)。
              白紙で始めるなら <a href={CLAUDE_CODE_NEW_SESSION_URL} target="_blank" rel="noreferrer">Claude Code を開く</a>。
              {reportsReady && reports.length >= DEVELOPER_DASHBOARD_REPORT_LIMIT ? ` 報告は新しい ${DEVELOPER_DASHBOARD_REPORT_LIMIT} 件までを見ています。` : ''}
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function SectionHead({ section, count }: { section: DashboardSection; count: number }) {
  return (
    <div className="dev-dash-section-head">
      <h3>{DASHBOARD_SECTION_LABELS[section]}<span className="dev-dash-section-count">{count}</span></h3>
      <p>{DASHBOARD_SECTION_DESCRIPTIONS[section]}</p>
    </div>
  )
}

function DashboardCardView({
  card,
  expanded,
  copied,
  onToggleExpanded,
  onCopyPrompt,
}: {
  card: DashboardCard
  expanded: boolean
  copied: boolean
  onToggleExpanded: (id: string) => void
  onCopyPrompt: (card: DashboardCard) => void
}) {
  const claudeUrl = card.prompt === null ? null : resolveClaudeCodeSessionUrl(card.prompt)
  return (
    <article className={`dev-dash-card is-${card.section}`} data-card-id={card.id}>
      <div className="dev-dash-card-head">
        <span className="dev-dash-badge">{card.badge}</span>
        <h4 className="dev-dash-card-title">{card.title}</h4>
      </div>
      <p className="dev-dash-card-summary">{card.summary}</p>
      <p className="dev-dash-card-next">
        <span className="dev-dash-card-next-label">次に</span>
        <span className={`dev-dash-who is-${card.who}`}>{DASHBOARD_WHO_LABELS[card.who]}</span>
        <span>{card.nextAction}</span>
      </p>
      <div className="dev-dash-card-foot">
        {card.links.map((link) => (
          <a key={link.href} className="dev-dash-link" href={link.href} target="_blank" rel="noreferrer">GitHub {link.label}</a>
        ))}
        {card.prompt !== null ? (
          claudeUrl ? (
            <a className="dev-dash-claude" href={claudeUrl} target="_blank" rel="noreferrer" title="指示が入った Claude Code の新しいセッションを開きます">Claude に頼む</a>
          ) : (
            // 指示が URL に載らない長さ → クリップボードへ写してから白紙の新セッションを開く(貼り付けて続ける)。
            <a className="dev-dash-claude" href={CLAUDE_CODE_NEW_SESSION_URL} target="_blank" rel="noreferrer" onClick={() => onCopyPrompt(card)} title="指示をコピーして Claude Code を開きます(貼り付けてください)">コピーして Claude に頼む</a>
          )
        ) : null}
        {copied ? <span className="dev-dash-copied">指示をコピーしました。貼り付けてください。</span> : null}
        <button type="button" className="dev-dash-more" onClick={() => onToggleExpanded(card.id)} aria-expanded={expanded}>
          {expanded ? 'とじる' : 'くわしく'}
        </button>
      </div>
      {expanded ? (
        <ul className="dev-dash-card-details" data-details-for={card.id}>
          {card.details.map((detail, index) => <li key={index}>{detail}</li>)}
        </ul>
      ) : null}
    </article>
  )
}
