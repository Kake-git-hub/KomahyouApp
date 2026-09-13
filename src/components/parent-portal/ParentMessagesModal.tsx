import {
  PARENT_MESSAGE_SENDER_FALLBACK,
  PARENT_MESSAGE_SENDER_UNVERIFIED_NOTE,
  PARENT_MESSAGE_URL_WARNING,
  type ParentMessageNotification,
} from '../../utils/parentMessages'
import { formatJstDateTimeLabel } from './parentPortalPageModel'

// 保護者からの連絡を室長に知らせるモーダル(spec-parent-portal.md §E-2 三点セットの 3)。
// QR 提出通知(.submission-acknowledgement-*)と同じ見た目・同じ overlay 構造を流用し、
// 連絡固有の要素(送信者名の未確認注記・URL 警告・本文)は App.css 末尾の .parent-message-* で足す。
// 「確認」= 既読のサーバー記録(markParentMessagesNotified)は呼び出し側(App)が行い、ここは表示だけ。
// 表示するのは生徒の表示名・送信者名・本文・日時のみ(内部 ID は DOM に出さない)。

type ParentMessagesModalProps = {
  notifications: ParentMessageNotification[]
  // 「確認」のサーバー記録中(二重送信防止でボタンを無効化)。
  confirming: boolean
  onDismiss: (id: string) => void
  onConfirmAll: () => void
}

export function ParentMessagesModal({ notifications, confirming, onDismiss, onConfirmAll }: ParentMessagesModalProps) {
  if (notifications.length === 0) return null
  return (
    <div className="submission-acknowledgement-overlay" role="presentation">
      <div className="submission-acknowledgement-modal" role="dialog" aria-modal="true" aria-label="保護者からの連絡" data-testid="parent-messages-modal">
        <div className="submission-acknowledgement-kicker">
          保護者からの連絡{notifications.length > 1 ? `（${notifications.length}件）` : ''}
        </div>
        <ul className="submission-acknowledgement-list">
          {notifications.map((entry) => (
            <li key={entry.id} className="submission-acknowledgement-item parent-message-item" data-testid="parent-message-item">
              <button
                type="button"
                className="submission-acknowledgement-dismiss"
                onClick={() => onDismiss(entry.id)}
                disabled={confirming}
                aria-label={`${entry.studentName} の連絡をあとで見る`}
                data-testid="parent-message-dismiss"
              >×</button>
              <div className="submission-acknowledgement-item-classroom">{entry.classroomName}</div>
              <div className="parent-message-meta">
                <span className="parent-message-student">生徒 <strong>{entry.studentName}</strong></span>
                <span className="parent-message-received-at">{formatJstDateTimeLabel(entry.createdAt) ?? ''}</span>
              </div>
              <div className="parent-message-sender">
                送信者: <strong>{entry.senderName.trim() || PARENT_MESSAGE_SENDER_FALLBACK}</strong>
                {/* なりすまし対策: 送信者名は自己申告なので常に注記する(§E-2)。 */}
                <span className="parent-message-unverified">{PARENT_MESSAGE_SENDER_UNVERIFIED_NOTE}</span>
              </div>
              {entry.containsUrl ? (
                <p className="parent-message-url-warning" role="note">{PARENT_MESSAGE_URL_WARNING}</p>
              ) : null}
              <p className="parent-message-body">{entry.body}</p>
            </li>
          ))}
        </ul>
        <div className="submission-acknowledgement-actions parent-message-actions">
          <span className="parent-message-actions-hint">「確認」を押すと他の端末でもこの通知は表示されなくなります。</span>
          <button type="button" className="primary-button" onClick={onConfirmAll} disabled={confirming} data-testid="parent-messages-confirm">
            {confirming ? '確認中…' : 'すべて確認'}
          </button>
        </div>
      </div>
    </div>
  )
}
