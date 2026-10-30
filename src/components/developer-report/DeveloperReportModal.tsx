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
//
// 2026-10-29(オーナー指示「AI 回答を見ながら画面操作する可能性があるので別タブで」): 盤面の「質問・要望」は別タブで開く
// (presentation="window"・App が createPortal で別タブへ描く・developerReportWindow.ts)。別タブでは覆い(暗い背景)を付けず
// ページとして出す。中身・文言・送信は同じ。ポップアップを止められたときだけ従来どおりモーダル(windowBlocked で一言出す)。

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY,
  DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT,
  DEVELOPER_REPORT_UI_TEXT,
  addDeveloperReportModalAttachment,
  removeDeveloperReportModalAttachment,
  resolveDeveloperReportQuestionNotice,
  resolveDeveloperReportSendingLabel,
  toDeveloperReportAttachments,
  validateDeveloperReportNote,
  type DeveloperReportAttachment,
  type DeveloperReportCategory,
  type DeveloperReportModalAttachment,
} from '../../utils/developerReport'
import { createChecklistAttachmentId, pickChecklistImageFiles, shrinkChecklistImageToDataUrl } from './checklistImage'
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
  /** 質問への AI 即時回答が有効か(featureRollout `questionAiAnswer`・2026-10-30 全教室)。表示の切り替えだけに使う。 */
  aiAnswerEnabled?: boolean
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォームを表示する。 */
  resultMessage: string | null
  /** 送信。attachments は添付画像(2026-10-22・最大 3 枚・無ければ空配列)。 */
  onSubmit: (note: string, category: DeveloperReportCategory, attachments: DeveloperReportAttachment[]) => void
  onClose: () => void
  /**
   * 「画面を撮る」(2026-10-22 オーナー決定 A・盤面だけ)。いま見えている画面を JPEG の data URL にして返す。
   * undefined なら撮るボタンを出さない(撮れない環境・日程表タブ)。失敗は例外で知らせる(「画像を選ぶ」を案内する)。
   */
  onCaptureScreen?: () => Promise<{ name: string; dataUrl: string }>
  /** 選んだ／貼り付けた画像の縮小(既定: 確認リストと同じ長辺 1600px の JPEG)。テストで差し替える。 */
  shrinkImage?: (file: File) => Promise<{ name: string; dataUrl: string }>
  /**
   * これまでの質問と回答(自教室・新しい順は内部で並べ替える)。undefined = 履歴機能なし(ローカルモード等・タブを出さない)。
   */
  answers?: ReportAnswerEntry[]
  /** 「確認しました」を出してよいか(開発者が本番教室を開いているときは false: 室長の未読を消さない)。 */
  canMarkAnswersRead?: boolean
  onMarkAnswersRead?: (reportIds: string[]) => void
  /** 出し方。window = 別タブのページ(覆いなし・2026-10-29)。既定は盤面のモーダル。 */
  presentation?: DeveloperReportModalPresentation
  /** 別タブを開けずモーダルで開いた(ポップアップを止められた)。送信フォームの上に一言出す。 */
  windowBlocked?: boolean
}

export type DeveloperReportModalPresentation = 'modal' | 'window'

export function DeveloperReportModal({ classroomName, aiAnswerEnabled = false, sending, resultMessage, onSubmit, onClose, answers, canMarkAnswersRead = false, onMarkAnswersRead, onCaptureScreen, shrinkImage = shrinkChecklistImageToDataUrl, presentation = 'modal', windowBlocked = false }: DeveloperReportModalProps) {
  const isWindow = presentation === 'window'
  const [note, setNote] = useState('')
  const [category, setCategory] = useState<DeveloperReportCategory>(DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY)
  const [validationError, setValidationError] = useState<string | null>(null)
  // 添付画像(2026-10-22 オーナー決定: 盤面＝「画面を撮る」＋「画像を選ぶ」＋貼り付け・3 枚まで)。送信時に送信形へ落として渡す。
  const [attachments, setAttachments] = useState<DeveloperReportModalAttachment[]>([])
  // 連続で足すとき(複数ファイル・貼り付け)の現在値。setState の更新関数が同期に走る前提に頼らない(regression-reviewer L-5)。
  const attachmentsRef = useRef<DeveloperReportModalAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
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
    onSubmit(note, category, toDeveloperReportAttachments(attachments))
  }

  // 1 枚足す。上限(枚数・1 枚・合計)は純関数が見る。現在値は ref で持ち回る(連続貼り付けで前の分を失わない・更新関数の同期実行に頼らない)。
  const pushAttachment = useCallback((candidate: { label: string; name: string; dataUrl: string }) => {
    const result = addDeveloperReportModalAttachment(attachmentsRef.current, { id: createChecklistAttachmentId(), ...candidate })
    attachmentsRef.current = result.attachments
    setAttachments(result.attachments)
    setAttachmentError(result.error)
  }, [])

  const addImageFiles = useCallback(async (files: ArrayLike<File> | null | undefined, label: string) => {
    for (const file of pickChecklistImageFiles(files)) {
      try {
        const shrunk = await shrinkImage(file)
        pushAttachment({ label, name: shrunk.name, dataUrl: shrunk.dataUrl })
      } catch (error) {
        setAttachmentError(`${DEVELOPER_REPORT_UI_TEXT.attachReadError}（${file.name || '貼り付け'}: ${error instanceof Error ? error.message : String(error)}）`)
      }
    }
  }, [pushAttachment, shrinkImage])

  const captureScreen = useCallback(async () => {
    if (!onCaptureScreen) return
    setCapturing(true)
    try {
      const shot = await onCaptureScreen()
      pushAttachment({ label: DEVELOPER_REPORT_UI_TEXT.captureButton, name: shot.name, dataUrl: shot.dataUrl })
    } catch {
      setAttachmentError(DEVELOPER_REPORT_UI_TEXT.captureError)
    } finally {
      setCapturing(false)
    }
  }, [onCaptureScreen, pushAttachment])

  const removeAttachment = useCallback((id: string) => {
    const next = removeDeveloperReportModalAttachment(attachmentsRef.current, id)
    attachmentsRef.current = next
    setAttachments(next)
    setAttachmentError(null)
  }, [])

  const markRead = (reportIds: string[]) => {
    if (!canMarkAnswersRead || !onMarkAnswersRead || reportIds.length === 0) return
    onMarkAnswersRead(reportIds)
  }

  const content = (
      <div
        className={`auto-assign-modal developer-report-modal${isWindow ? ' is-window' : ''}`}
        role={isWindow ? 'main' : 'dialog'}
        aria-modal={isWindow ? undefined : true}
        aria-labelledby="developer-report-title"
        data-testid="developer-report-modal"
        data-presentation={presentation}
      >
        <div className="auto-assign-modal-title developer-report-title" id="developer-report-title">{DEVELOPER_REPORT_UI_TEXT.title}</div>
        {isWindow ? <p className="developer-report-hint developer-report-window-hint" data-testid="developer-report-window-hint">{DEVELOPER_REPORT_UI_TEXT.windowHint}</p> : null}
        {!isWindow && windowBlocked ? <p className="developer-report-hint developer-report-window-blocked" role="note" data-testid="developer-report-window-blocked">{DEVELOPER_REPORT_UI_TEXT.windowBlockedNotice}</p> : null}
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
                      {/* AI の自動回答(§G-7)は開発者の回答が来なくても残す(オーナー指示 2026-10-22 qa-ai-1)。開発者の回答はその下に訂正・補足として並ぶ。 */}
                      {entry.aiAnswer ? (
                        <div className="developer-report-history-answer is-ai" data-testid="developer-report-history-ai-answer">
                          <div className="developer-report-history-answer-head">
                            <span>{REPORT_ANSWER_UI_TEXT.aiAnswerHead} {formatReportAnswerDateLabel(entry.aiAnsweredAt)}</span>
                          </div>
                          <p className="developer-report-history-answer-body">{entry.aiAnswer}</p>
                        </div>
                      ) : null}
                      {entry.answer ? (
                        <div className="developer-report-history-answer" data-testid="developer-report-history-answer">
                          <div className="developer-report-history-answer-head">
                            <span>{entry.aiAnswer ? REPORT_ANSWER_UI_TEXT.developerAnswerAfterAiHead : REPORT_ANSWER_UI_TEXT.developerAnswerHead} {formatReportAnswerDateLabel(entry.answeredAt)}</span>
                            {entry.answerRevision > 1 ? <span className="developer-report-history-revised">{REPORT_ANSWER_UI_TEXT.revisedNote}</span> : null}
                          </div>
                          <p className="developer-report-history-answer-body">{entry.answer}</p>
                          {status === 'unread' && canMarkAnswersRead ? (
                            <div className="developer-report-history-answer-actions">
                              <button type="button" className="primary-button slim" onClick={() => markRead([entry.id])} data-testid="developer-report-mark-read">{REPORT_ANSWER_UI_TEXT.markRead}</button>
                            </div>
                          ) : null}
                        </div>
                      ) : status === 'pending' ? (
                        <p className="developer-report-history-pending">{REPORT_ANSWER_UI_TEXT.pendingNote}</p>
                      ) : null}
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
              onPaste={(event) => {
                // スクリーンショットの貼り付け(Ctrl+V)。文字も一緒に載っている貼り付け(Excel/Word からのコピーは画像形式も付く)は
                // 文字として入れる(L-1)。画像だけのときだけ添付へ回す。
                const files = event.clipboardData?.files
                const text = event.clipboardData?.getData('text/plain') ?? ''
                if (files && files.length > 0 && text.trim() === '' && pickChecklistImageFiles(files).length > 0) {
                  event.preventDefault()
                  void addImageFiles(files, '貼り付け')
                }
              }}
            />
            {validationError ? <p className="developer-report-error" role="alert" data-testid="developer-report-error">{validationError}</p> : null}
            <p className="developer-report-hint developer-report-hint-primary" data-testid="developer-report-input-hint">{DEVELOPER_REPORT_UI_TEXT.inputHint}</p>
            {/* 添付画像(2026-10-22 オーナー決定 A): 「画面を撮る」(盤面)＋「画像を選ぶ」。貼り付け(Ctrl+V)でも付く。3 枚まで。 */}
            <div className="developer-report-attachments-section" data-testid="developer-report-attachments">
              <div className="developer-report-note-label">{DEVELOPER_REPORT_UI_TEXT.attachLabel}</div>
              {attachments.length > 0 ? (
                <div className="developer-report-attachments">
                  {attachments.map((attachment) => (
                    <figure key={attachment.id} className="developer-report-attachment" data-testid="developer-report-attachment">
                      <img src={attachment.dataUrl} alt={attachment.name} />
                      <figcaption>
                        <span>{attachment.name}({Math.max(1, Math.round(attachment.byteLength / 1024))}KB)</span>
                        <button type="button" className="link-button" onClick={() => removeAttachment(attachment.id)} disabled={sending} data-testid={`developer-report-attachment-remove-${attachment.id}`}>{DEVELOPER_REPORT_UI_TEXT.removeImage}</button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              {attachments.length < DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT ? (
                <div className="developer-report-attach-actions">
                  {onCaptureScreen ? (
                    <button type="button" className="secondary-button developer-report-capture" onClick={() => { void captureScreen() }} disabled={sending || capturing} data-testid="developer-report-capture">
                      {capturing ? DEVELOPER_REPORT_UI_TEXT.capturing : DEVELOPER_REPORT_UI_TEXT.captureButton}
                    </button>
                  ) : null}
                  <label className="developer-report-attach">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={sending}
                      onChange={(event) => {
                        const files = event.target.files
                        void addImageFiles(files, DEVELOPER_REPORT_UI_TEXT.chooseImage)
                        event.target.value = ''
                      }}
                      data-testid="developer-report-attach-input"
                    />
                    {DEVELOPER_REPORT_UI_TEXT.chooseImage}
                  </label>
                </div>
              ) : null}
              <p className="developer-report-hint" data-testid="developer-report-attach-hint">{onCaptureScreen ? DEVELOPER_REPORT_UI_TEXT.attachHintBoard : DEVELOPER_REPORT_UI_TEXT.attachHintSchedule}</p>
              {attachmentError ? <p className="developer-report-error" role="alert" data-testid="developer-report-attachment-error">{attachmentError}</p> : null}
            </div>
            <div className="auto-assign-modal-actions developer-report-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={sending} data-testid="developer-report-cancel">{DEVELOPER_REPORT_UI_TEXT.cancel}</button>
              <button type="button" className="primary-button" onClick={handleSubmit} disabled={sending} data-testid="developer-report-submit">
                {sending ? resolveDeveloperReportSendingLabel(category, aiAnswerEnabled) : DEVELOPER_REPORT_UI_TEXT.submit}
              </button>
            </div>
          </>
        )}
      </div>
  )

  // 別タブ: 覆い(暗い背景)は付けずページとして出す。覆いの外を押して閉じる動きも無い(閉じるはボタンかタブを閉じる)。
  if (isWindow) return <div className="developer-report-window-page" data-testid="developer-report-window-page">{content}</div>

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      {content}
    </div>
  )
}
