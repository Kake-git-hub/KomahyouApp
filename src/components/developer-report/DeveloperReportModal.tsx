// 「開発者へ報告」モーダル(2026-09-04 オーナー指示)。
// 一言は**必須**(2026-09-04 改定: 空欄送信は不可)。送信内容の組み立てと送信は App 側(submitDeveloperReport)。
// 文言は日程表タブ側の同一モーダル(src/utils/scheduleHtml.ts)と共通化するため developerReport.ts の定数を使う。
// このコンポーネントは入力と結果表示だけを担う。

import { useEffect, useRef, useState } from 'react'

import { DEVELOPER_REPORT_UI_TEXT, validateDeveloperReportNote } from '../../utils/developerReport'

export type DeveloperReportModalProps = {
  classroomName: string
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォームを表示する。 */
  resultMessage: string | null
  onSubmit: (note: string) => void
  onClose: () => void
}

export function DeveloperReportModal({ classroomName, sending, resultMessage, onSubmit, onClose }: DeveloperReportModalProps) {
  const [note, setNote] = useState('')
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
    onSubmit(note)
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
