// 「要望・報告」モーダル(2026-09-04 オーナー指示)。
// 内容は**必須**(空欄送信は不可)。種類(不具合・おかしい／追加要望)を選べる。送信内容の組み立てと送信は App 側。
// 文言は日程表タブ側の同一モーダル(src/utils/scheduleHtml.ts)と共通化するため developerReport.ts の定数を使う。
// このコンポーネントは入力と結果表示だけを担う。

import { useEffect, useRef, useState } from 'react'

import { DEVELOPER_REPORT_UI_TEXT, validateDeveloperReportNote, type DeveloperReportCategory } from '../../utils/developerReport'

export type DeveloperReportModalProps = {
  classroomName: string
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォームを表示する。 */
  resultMessage: string | null
  onSubmit: (note: string, category: DeveloperReportCategory) => void
  onClose: () => void
}

export function DeveloperReportModal({ classroomName, sending, resultMessage, onSubmit, onClose }: DeveloperReportModalProps) {
  const [note, setNote] = useState('')
  const [category, setCategory] = useState<DeveloperReportCategory>('bug')
  const [validationError, setValidationError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!resultMessage) textareaRef.current?.focus()
  }, [resultMessage])

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

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div className="auto-assign-modal developer-report-modal" role="dialog" aria-modal="true" aria-labelledby="developer-report-title" data-testid="developer-report-modal">
        <div className="auto-assign-modal-title developer-report-title" id="developer-report-title">{DEVELOPER_REPORT_UI_TEXT.title}</div>
        {resultMessage ? (
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
            <p className="developer-report-hint">{DEVELOPER_REPORT_UI_TEXT.testHint}</p>
            <div className="auto-assign-modal-actions developer-report-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={sending} data-testid="developer-report-cancel">{DEVELOPER_REPORT_UI_TEXT.cancel}</button>
              <button type="button" className="primary-button" onClick={handleSubmit} disabled={sending} data-testid="developer-report-submit">
                {sending ? DEVELOPER_REPORT_UI_TEXT.sending : DEVELOPER_REPORT_UI_TEXT.submit}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
