// 開発者画面のサブページ「質問への回答」(docs/spec-developer-report.md §G-3・オーナー確定 2026-09-28「LINE ではなく画面で返す」)。
// 「質問・要望」で届いた報告を一覧し、1 件を選んで回答を書き、callable answerDeveloperReport で送る。
// 送った回答は室長の「質問・要望」ボタンに未読件数として出て、同じモーダルの履歴で読める(§G-5)。
// - 読み込みは developerReportsStore.listRecentDeveloperReports(読み取りのみ)。書き込みは callable 1 本だけ(Firestore 直書きなし)。
// - 送信前に「公開してよい回答」の基準(§G-4・7 項目)を確認するチェックを必ず入れる(checkReportAnswerSubmit)。
// - 開発者画面自体が role === 'developer' に限定されているので室長には出ない。

import { useCallback, useEffect, useMemo, useState } from 'react'

import { listRecentDeveloperReports } from '../../integrations/firebase/developerReportsStore'
import { answerDeveloperReportViaFunction, type AnswerDeveloperReportResult } from '../../integrations/firebase/reportAnswersStore'
import { DEVELOPER_DASHBOARD_REPORT_LIMIT, DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS, resolveDeveloperDashboardSinceIso, type DeveloperReportRecord } from '../../utils/developerDashboard'
import {
  DEVELOPER_REPORT_ANSWER_LIMIT,
  REPORT_ANSWER_FILTER_LABELS,
  REPORT_ANSWER_GUIDELINES,
  buildReportAnswerSentMessage,
  checkReportAnswerSubmit,
  filterReportsForAnswering,
  isReportAnswered,
  type ReportAnswerFilter,
} from '../../utils/developerReportAnswers'
import { REPORT_ANSWER_CATEGORY_LABELS, formatReportAnswerDateLabel } from '../../utils/reportAnswers'

export type DeveloperReportAnswerScreenProps = {
  authMode: 'local' | 'firebase'
  classrooms: ReadonlyArray<{ id: string; name: string }>
  onBack: () => void
  /** テスト・差し替え用。既定は developerReportsStore.listRecentDeveloperReports(読み取りのみ)。 */
  loadReports?: (options: { sinceIso: string; limit: number }) => Promise<DeveloperReportRecord[]>
  /** テスト・差し替え用。既定は reportAnswersStore.answerDeveloperReportViaFunction(callable)。 */
  submitAnswer?: (input: { reportId: string; answer: string }) => Promise<AnswerDeveloperReportResult>
}

const FILTERS: readonly ReportAnswerFilter[] = ['unanswered', 'answered', 'all']

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function DeveloperReportAnswerScreen({ authMode, classrooms, onBack, loadReports = listRecentDeveloperReports, submitAnswer = answerDeveloperReportViaFunction }: DeveloperReportAnswerScreenProps) {
  const [requestSerial, setRequestSerial] = useState(0)
  const [reportsResult, setReportsResult] = useState<{ serial: number; reports: DeveloperReportRecord[]; error: string } | null>(null)
  const [filter, setFilter] = useState<ReportAnswerFilter>('unanswered')
  const [classroomFilter, setClassroomFilter] = useState<string>('')
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [guidelinesConfirmed, setGuidelinesConfirmed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentMessage, setSentMessage] = useState('')
  const [submitError, setSubmitError] = useState('')

  const reload = useCallback(() => setRequestSerial((value) => value + 1), [])

  useEffect(() => {
    if (authMode !== 'firebase') return
    let cancelled = false
    const serial = requestSerial
    void loadReports({ sinceIso: resolveDeveloperDashboardSinceIso(DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS), limit: DEVELOPER_DASHBOARD_REPORT_LIMIT })
      .then((loaded) => { if (!cancelled) setReportsResult({ serial, reports: loaded, error: '' }) })
      .catch((error: unknown) => { if (!cancelled) setReportsResult({ serial, reports: [], error: errorMessage(error, '報告を読み込めませんでした。') }) })
    return () => { cancelled = true }
  }, [authMode, loadReports, requestSerial])

  const reportsCurrent = reportsResult?.serial === requestSerial ? reportsResult : null
  const loading = authMode === 'firebase' && reportsCurrent === null
  const reports = useMemo(() => reportsCurrent?.reports ?? [], [reportsCurrent])
  const visibleReports = useMemo(() => filterReportsForAnswering(reports, { filter, classroomId: classroomFilter || null }), [reports, filter, classroomFilter])
  const selected = useMemo(() => reports.find((record) => record.reportId === selectedReportId) ?? null, [reports, selectedReportId])
  const classroomNameOf = useCallback((classroomId: string, fallback: string) => classrooms.find((c) => c.id === classroomId)?.name ?? fallback ?? classroomId, [classrooms])

  const selectReport = (record: DeveloperReportRecord) => {
    setSelectedReportId(record.reportId)
    setDraft(record.answerFinal ?? '')
    setGuidelinesConfirmed(false)
    setSentMessage('')
    setSubmitError('')
  }

  const submitCheck = checkReportAnswerSubmit({ answer: draft, guidelinesConfirmed, currentAnswer: selected?.answerFinal ?? null })

  const handleSubmit = async () => {
    if (!selected || !submitCheck.ok || sending) return
    setSending(true)
    setSubmitError('')
    setSentMessage('')
    try {
      const result = await submitAnswer({ reportId: selected.reportId, answer: submitCheck.answer })
      // 再読込なしで一覧と選択中の報告に反映する(Firestore 側は callable が書いた)。
      setReportsResult((current) => current ? {
        ...current,
        reports: current.reports.map((record) => record.reportId === selected.reportId
          ? { ...record, answerFinal: submitCheck.answer, answeredAt: result.answeredAt || new Date().toISOString(), answerRevision: result.answerRevision || record.answerRevision + 1 }
          : record),
      } : current)
      setSentMessage(buildReportAnswerSentMessage({ classroomName: classroomNameOf(selected.classroomId, selected.classroomName), isRevision: result.isRevision, answerRevision: result.answerRevision }))
      setGuidelinesConfirmed(false)
    } catch (error) {
      setSubmitError(errorMessage(error, '回答を送れませんでした。'))
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="developer-main">
      <section className="board-panel board-panel-unified">
        <div className="basic-data-header developer-header">
          <div>
            <h2>質問への回答</h2>
            <p className="page-summary">「質問・要望」で届いた報告に回答を書きます。送った回答は、その教室の「質問・要望」ボタンに未読件数として表示され、同じ画面の「これまでの質問と回答」で読めます。テスト送信(#テスト)と確認リストは載せません。</p>
          </div>
        </div>
        <div className="developer-header-actions">
          <div className="basic-data-row-actions developer-actions-left">
            <button className="secondary-button slim" type="button" onClick={onBack}>← 管理画面に戻る</button>
            <label className="basic-data-inline-field developer-dashboard-range-field">
              <span>教室</span>
              <select value={classroomFilter} onChange={(event) => setClassroomFilter(event.target.value)} data-testid="report-answer-classroom-filter">
                <option value="">すべての教室</option>
                {classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
              </select>
            </label>
            <div className="report-answer-filters" role="tablist">
              {FILTERS.map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={`secondary-button slim${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)} data-testid={`report-answer-filter-${value}`}>
                  {REPORT_ANSWER_FILTER_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
          <div className="basic-data-row-actions developer-actions-right">
            <button className="secondary-button slim" type="button" onClick={reload} disabled={loading}>再読込</button>
          </div>
        </div>

        {authMode !== 'firebase' ? <div className="toolbar-status">ローカルモードでは報告を読み込めません(Firebase 接続時のみ)。</div> : null}
        {loading ? <div className="toolbar-status">報告を読み込んでいます…</div> : null}
        {reportsCurrent?.error ? <div className="developer-report-error">{reportsCurrent.error}</div> : null}

        <div className="report-answer-layout">
          <section className="basic-data-section-card developer-backup-panel report-answer-list-panel">
            <div className="basic-data-card-head">
              <h3>報告一覧({visibleReports.length} 件・直近 {DEVELOPER_DASHBOARD_DEFAULT_SINCE_DAYS} 日)</h3>
              <p>新しいものが上。押すと右に本文と回答欄が出ます。</p>
            </div>
            {reportsCurrent && !reportsCurrent.error && visibleReports.length === 0 ? <p className="report-answer-empty" data-testid="report-answer-empty">該当する報告はありません。</p> : null}
            <ul className="report-answer-list" data-testid="report-answer-list">
              {visibleReports.map((record) => (
                <li key={record.reportId}>
                  <button type="button" className={`report-answer-row${record.reportId === selectedReportId ? ' is-selected' : ''}`} onClick={() => selectReport(record)} data-testid="report-answer-row" data-answered={isReportAnswered(record) ? 'true' : 'false'}>
                    <span className="report-answer-row-meta">
                      <span className={`developer-report-history-chip is-category-${record.category}`}>{REPORT_ANSWER_CATEGORY_LABELS[record.category]}</span>
                      <span>{classroomNameOf(record.classroomId, record.classroomName)}</span>
                      <span>{formatReportAnswerDateLabel(record.recordedAt || record.reportedAt)}</span>
                      <span className={`developer-report-history-status is-${isReportAnswered(record) ? 'read' : 'pending'}`}>{isReportAnswered(record) ? `回答済み(${record.answerRevision} 版)` : '未回答'}</span>
                    </span>
                    <span className="report-answer-row-note">{record.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="basic-data-section-card developer-backup-panel report-answer-editor-panel">
            {selected ? (
              <>
                <div className="basic-data-card-head">
                  <h3>{REPORT_ANSWER_CATEGORY_LABELS[selected.category]}: {classroomNameOf(selected.classroomId, selected.classroomName)}</h3>
                  <p>送信 {formatReportAnswerDateLabel(selected.reportedAt || selected.recordedAt)} / アプリ版 {selected.appVersion || '不明'} / 送信元 {selected.source || '不明'}{selected.issueNumber ? ` / Issue #${selected.issueNumber}` : ''}</p>
                </div>
                <p className="report-answer-question" data-testid="report-answer-question">{selected.note}</p>
                {isReportAnswered(selected) ? (
                  <p className="toolbar-status" data-testid="report-answer-current">現在の回答({selected.answerRevision} 版・{formatReportAnswerDateLabel(selected.answeredAt)})を下の欄に読み込んでいます。書き換えて送ると更新になります(既読の室長には未読として出ません)。</p>
                ) : null}
                <label className="developer-report-note-label" htmlFor="report-answer-draft">回答(室長にそのまま表示されます・{DEVELOPER_REPORT_ANSWER_LIMIT} 文字まで)</label>
                <textarea
                  id="report-answer-draft"
                  className="developer-report-note report-answer-draft"
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setSentMessage('') }}
                  rows={8}
                  maxLength={DEVELOPER_REPORT_ANSWER_LIMIT}
                  disabled={sending}
                  data-testid="report-answer-draft"
                />
                <fieldset className="report-answer-guidelines" data-testid="report-answer-guidelines">
                  <legend>送る前に確認(公開してよい回答の基準・spec §G-4)</legend>
                  <ul>
                    {REPORT_ANSWER_GUIDELINES.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                  <label className="report-answer-confirm">
                    <input type="checkbox" checked={guidelinesConfirmed} onChange={(event) => setGuidelinesConfirmed(event.target.checked)} disabled={sending} data-testid="report-answer-confirm" />
                    <span>上の基準をすべて満たしていることを確認しました</span>
                  </label>
                </fieldset>
                {!submitCheck.ok && draft.trim() ? <p className="developer-report-hint" data-testid="report-answer-check">{submitCheck.reason}</p> : null}
                {submitError ? <p className="developer-report-error" role="alert" data-testid="report-answer-error">{submitError}</p> : null}
                {sentMessage ? <p className="report-answer-sent" role="status" data-testid="report-answer-sent">{sentMessage}</p> : null}
                <div className="basic-data-row-actions">
                  <button type="button" className="primary-button" onClick={() => { void handleSubmit() }} disabled={!submitCheck.ok || sending} data-testid="report-answer-submit">
                    {sending ? '送信中…' : isReportAnswered(selected) ? '回答を更新して送る' : '回答を送る'}
                  </button>
                </div>
              </>
            ) : (
              <p className="report-answer-empty" data-testid="report-answer-placeholder">左の一覧から報告を選んでください。</p>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}
