// 「質問・要望」モーダル(2026-09-04 オーナー指示・旧「要望・報告」→ 2026-09-14 改名)。
// 内容は**必須**(空欄送信は不可)。種類(使い方の質問／要望／不具合。この順・既定は質問)を選べる。質問を選んだときだけ
// 「すぐには返らない」注意文を出す(spec-developer-report §G-2・2026-09-13)。AI 即時回答が有効な教室(開発用教室のみ・§G-7)では
// 注意文を「その場で AI が回答」に差し替える。送信内容の組み立てと送信は App 側。
// 文言は日程表タブ側の同一モーダル(src/utils/scheduleHtml.ts)と共通化するため developerReport.ts の定数を使う。
//
// 2026-09-28(オーナー確定): 同じモーダルに「これまでの質問と回答」タブを足した(§G-5)。開発者が回答を書くとここに出る。
// **自動で開くモーダルは出さない**(バッジだけ)。未読の回答があるときだけ、開いた直後に履歴タブを見せる。
// 既読(「確認しました」)はサーバー記録(App 側の callable)。履歴の並び・状態・件数は utils/reportAnswers.ts の純関数。
// 日程表タブ側の埋め込みモーダルには履歴は無い(盤面の「質問・要望」から読む)。

import { useEffect, useRef, useState } from 'react'

import { DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY, DEVELOPER_REPORT_UI_TEXT, resolveDeveloperReportQuestionNotice, resolveDeveloperReportSendingLabel, validateDeveloperReportNote, type DeveloperReportCategory } from '../../utils/developerReport'
import {
  REPORT_ANSWER_CATEGORY_LABELS,
  REPORT_ANSWER_STATUS_LABELS,
  REPORT_ANSWER_UI_TEXT,
  countUnreadReportAnswers,
  formatReportAnswerDateLabel,
  resolveDeveloperReportModalInitialTab,
  resolveReportAnswerStatus,
  selectUnreadReportAnswerIds,
  sortReportAnswerEntries,
  type DeveloperReportModalTab,
  type ReportAnswerEntry,
} from '../../utils/reportAnswers'

export type DeveloperReportModalProps = {
  classroomName: string
  /** 質問への AI 即時回答が有効か(featureRollout `questionAiAnswer`・開発用教室のみ)。表示の切り替えだけに使う。 */
  aiAnswerEnabled?: boolean
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォームを表示する。 */
  resultMessage: string | null
  onSubmit: (note: string, category: DeveloperReportCategory) => void
  onClose: () => void
  /**
   * これまでの質問と回答(自教室・新しい順は内部で並べ替える)。undefined = 履歴機能なし(ローカルモード等・タブを出さない)。
   */
  answers?: ReportAnswerEntry[]
  /** 「確認しました」を出してよいか(開発者が本番教室を開いているときは false: 室長の未読を消さない)。 */
  canMarkAnswersRead?: boolean
  onMarkAnswersRead?: (reportIds: string[]) => void
}

export function DeveloperReportModal({ classroomName, aiAnswerEnabled = false, sending, resultMessage, onSubmit, onClose, answers, canMarkAnswersRead = false, onMarkAnswersRead }: DeveloperReportModalProps) {
  const [note, setNote] = useState('')
  const [category, setCategory] = useState<DeveloperReportCategory>(DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY)
  const [validationError, setValidationError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const historyEnabled = answers !== undefined
  const sortedAnswers = historyEnabled ? sortReportAnswerEntries(answers) : []
  const unreadCount = countUnreadReportAnswers(sortedAnswers)
  // 開いた瞬間の未読で最初のタブを決める(以後は利用者の操作だけで切り替える)。
  const [tab, setTab] = useState<DeveloperReportModalTab>(() => (historyEnabled ? resolveDeveloperReportModalInitialTab(unreadCount) : 'send'))

  useEffect(() => {
    if (!resultMessage && tab === 'send') textareaRef.current?.focus()
  }, [resultMessage, tab])

  const handleSubmit = () => {
    const error = validateDeveloperReportNote(note)
    if (error) {
      setValidationError(error)
      textareaRef.current?.focus()
      return
    }
    setValidationError(null)
    onSubmit(note, category)
  }

  const markRead = (reportIds: string[]) => {
    if (!canMarkAnswersRead || !onMarkAnswersRead || reportIds.length === 0) return
    onMarkAnswersRead(reportIds)
  }

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div className="auto-assign-modal developer-report-modal" role="dialog" aria-modal="true" aria-labelledby="developer-report-title" data-testid="developer-report-modal">
        <div className="auto-assign-modal-title developer-report-title" id="developer-report-title">{DEVELOPER_REPORT_UI_TEXT.title}</div>
        {historyEnabled ? (
          <div className="developer-report-tabs" role="tablist" data-testid="developer-report-tabs">
            <button type="button" role="tab" aria-selected={tab === 'send'} className={`developer-report-tab${tab === 'send' ? ' is-active' : ''}`} onClick={() => setTab('send')} disabled={sending} data-testid="developer-report-tab-send">
              {REPORT_ANSWER_UI_TEXT.sendTab}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'history'} className={`developer-report-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')} disabled={sending} data-testid="developer-report-tab-history">
              {REPORT_ANSWER_UI_TEXT.historyTab}
              {unreadCount > 0 ? <span className="developer-report-tab-badge" data-testid="developer-report-tab-badge">{unreadCount}</span> : null}
            </button>
          </div>
        ) : null}
        {tab === 'history' && historyEnabled ? (
          <>
            <p className="developer-report-description">{REPORT_ANSWER_UI_TEXT.historyLead}</p>
            {sortedAnswers.length === 0 ? (
              <p className="developer-report-history-empty" data-testid="developer-report-history-empty">
                {REPORT_ANSWER_UI_TEXT.historyEmpty}<br />
                <span>{REPORT_ANSWER_UI_TEXT.historyEmptyNote}</span>
              </p>
            ) : (
              <ul className="developer-report-history-list" data-testid="developer-report-history-list">
                {sortedAnswers.map((entry) => {
                  const status = resolveReportAnswerStatus(entry)
                  return (
                    <li key={entry.id} className={`developer-report-history-item is-${status}`} data-testid="developer-report-history-item" data-status={status}>
                      <div className="developer-report-history-meta">
                        <span className={`developer-report-history-chip is-category-${entry.category}`}>{REPORT_ANSWER_CATEGORY_LABELS[entry.category]}</span>
                        <span className="developer-report-history-date">送信 {formatReportAnswerDateLabel(entry.reportedAt)}</span>
                        <span className={`developer-report-history-status is-${status}`} data-testid="developer-report-history-status">{REPORT_ANSWER_STATUS_LABELS[status]}</span>
                      </div>
                      <p className="developer-report-history-question">{entry.questionNote}</p>
                      {entry.answer ? (
                        <div className="developer-report-history-answer" data-testid="developer-report-history-answer">
                          <div className="developer-report-history-answer-head">
                            <span>開発者からの回答 {formatReportAnswerDateLabel(entry.answeredAt)}</span>
                            {entry.answerRevision > 1 ? <span className="developer-report-history-revised">{REPORT_ANSWER_UI_TEXT.revisedNote}</span> : null}
                          </div>
                          <p className="developer-report-history-answer-body">{entry.answer}</p>
                          {status === 'unread' && canMarkAnswersRead ? (
                            <div className="developer-report-history-answer-actions">
                              <button type="button" className="primary-button slim" onClick={() => markRead([entry.id])} data-testid="developer-report-mark-read">{REPORT_ANSWER_UI_TEXT.markRead}</button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="developer-report-history-pending">{REPORT_ANSWER_UI_TEXT.pendingNote}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="auto-assign-modal-actions developer-report-actions">
              {unreadCount > 1 && canMarkAnswersRead ? (
                <button type="button" className="secondary-button" onClick={() => markRead(selectUnreadReportAnswerIds(sortedAnswers))} data-testid="developer-report-mark-all-read">{REPORT_ANSWER_UI_TEXT.markAllRead}</button>
              ) : null}
              <button type="button" className="primary-button" onClick={onClose} data-testid="developer-report-history-close">{DEVELOPER_REPORT_UI_TEXT.close}</button>
            </div>
          </>
        ) : resultMessage ? (
          <>
            <p className="developer-report-result" data-testid="developer-report-result">{resultMessage}</p>
            <div className="auto-assign-modal-actions developer-report-actions">
              <button type="button" className="primary-button" onClick={onClose} data-testid="developer-report-close">{DEVELOPER_REPORT_UI_TEXT.close}</button>
            </div>
          </>
        ) : (
          <>
            <p className="developer-report-description">{DEVELOPER_REPORT_UI_TEXT.description(classroomName)}</p>
            <fieldset className="developer-report-category" data-testid="developer-report-category">
              <legend className="developer-report-note-label">{DEVELOPER_REPORT_UI_TEXT.categoryLabel}</legend>
              <div className="developer-report-category-options">
                {DEVELOPER_REPORT_UI_TEXT.categoryOptions.map((option) => (
                  <label key={option.value} className={`developer-report-category-option${category === option.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="developer-report-category"
                      value={option.value}
                      checked={category === option.value}
                      onChange={() => setCategory(option.value)}
                      disabled={sending}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {category === 'question' ? (
              <p className="developer-report-hint developer-report-question-notice" role="note" data-testid="developer-report-question-notice">{resolveDeveloperReportQuestionNotice(aiAnswerEnabled)}</p>
            ) : null}
            <label className="developer-report-note-label" htmlFor="developer-report-note">{DEVELOPER_REPORT_UI_TEXT.noteLabel}</label>
            <textarea
              id="developer-report-note"
              ref={textareaRef}
              className={`developer-report-note${validationError ? ' has-error' : ''}`}
              value={note}
              onChange={(event) => { setNote(event.target.value); if (validationError && event.target.value.trim()) setValidationError(null) }}
              placeholder={DEVELOPER_REPORT_UI_TEXT.placeholder}
              rows={7}
              maxLength={2000}
              disabled={sending}
              aria-invalid={validationError ? true : undefined}
              data-testid="developer-report-note"
            />
            {validationError ? <p className="developer-report-error" role="alert" data-testid="developer-report-error">{validationError}</p> : null}
            <p className="developer-report-hint developer-report-hint-primary" data-testid="developer-report-input-hint">{DEVELOPER_REPORT_UI_TEXT.inputHint}</p>
            <div className="auto-assign-modal-actions developer-report-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={sending} data-testid="developer-report-cancel">{DEVELOPER_REPORT_UI_TEXT.cancel}</button>
              <button type="button" className="primary-button" onClick={handleSubmit} disabled={sending} data-testid="developer-report-submit">
                {sending ? resolveDeveloperReportSendingLabel(category, aiAnswerEnabled) : DEVELOPER_REPORT_UI_TEXT.submit}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
