// 「開発者へ報告」モーダル(2026-09-04 オーナー指示)。
// 任意の一言は空欄でも送れる。送信内容の組み立てと送信は App 側(submitDeveloperReport)。
// このコンポーネントは入力と結果表示だけを担う(テストしやすいよう純粋な表示部品にする)。

import { useEffect, useRef, useState } from 'react'

export type DeveloperReportModalProps = {
  classroomName: string
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォームを表示する。 */
  resultMessage: string | null
  onSubmit: (note: string) => void
  onClose: () => void
}

export const DEVELOPER_REPORT_NOTE_PLACEHOLDER = '例: 9/3 の 3限で振替が消えた気がする(空欄のままでも送れます)'

export function DeveloperReportModal({ classroomName, sending, resultMessage, onSubmit, onClose }: DeveloperReportModalProps) {
  const [note, setNote] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!resultMessage) textareaRef.current?.focus()
  }, [resultMessage])

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div className="auto-assign-modal developer-report-modal" role="dialog" aria-modal="true" aria-labelledby="developer-report-title" data-testid="developer-report-modal">
        <div className="auto-assign-modal-title" id="developer-report-title">開発者へ報告</div>
        {resultMessage ? (
          <>
            <p className="developer-report-result" data-testid="developer-report-result">{resultMessage}</p>
            <div className="auto-assign-modal-actions">
              <button type="button" className="primary-button" onClick={onClose} data-testid="developer-report-close">閉じる</button>
            </div>
          </>
        ) : (
          <>
            <p className="developer-report-description">
              「おかしいな」と思ったら、そのまま送ってください。教室「{classroomName}」の直近の操作履歴と、いまの画面のデータが開発者に届きます。
              一言は空欄のままでも送れます。
            </p>
            <textarea
              ref={textareaRef}
              className="developer-report-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={DEVELOPER_REPORT_NOTE_PLACEHOLDER}
              rows={4}
              maxLength={2000}
              disabled={sending}
              data-testid="developer-report-note"
            />
            <div className="auto-assign-modal-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={sending} data-testid="developer-report-cancel">キャンセル</button>
              <button type="button" className="primary-button" onClick={() => onSubmit(note)} disabled={sending} data-testid="developer-report-submit">
                {sending ? '送信中…' : '送信する'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
