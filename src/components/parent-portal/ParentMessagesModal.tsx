import {
  PARENT_ABSENCE_CHOICES,
  buildParentAbsenceUnsavedNote,
  formatParentAbsenceLessonLabel,
  type ParentAbsenceResolution,
  type ParentMessageNotification,
} from '../../utils/parentMessages'
import { formatJstDateTimeLabel } from './parentPortalPageModel'

// 保護者からの休み連絡を室長に知らせるモーダル(spec-parent-portal.md §0-5・§E-2)。
// QR 提出通知(.submission-acknowledgement-*)と同じ見た目・同じ overlay 構造を流用し、
// 休み連絡固有の要素(対象コマ・四択)は App.css 末尾の .parent-message-* で足す。
// 四択の実処理(盤面の出欠処理・状態のサーバー記録)は呼び出し側(App → 盤面)が行い、ここは表示だけ。
// 表示するのは生徒の表示名・対象コマ・受信日時のみ(内部 ID は DOM に出さない)。

type ParentMessagesModalProps = {
  notifications: ParentMessageNotification[]
  // 畳んでいる間はモーダルの代わりに件数の入口(ピル)だけを出す。盤面を見てから決めたいとき・振替先を選んでいる間に使う。
  collapsed: boolean
  // 四択を処理中の連絡 ID(二重実行防止でその連絡のボタンを無効化)。null=処理中なし。
  busyId: string | null
  // 連絡ごとのエラー(盤面にコマが見つからない等)。
  errors: Readonly<Record<string, string>>
  onChoose: (notification: ParentMessageNotification, resolution: ParentAbsenceResolution) => void
  onCollapse: () => void
  onExpand: () => void
}

export function ParentMessagesModal({ notifications, collapsed, busyId, errors, onChoose, onCollapse, onExpand }: ParentMessagesModalProps) {
  if (notifications.length === 0) return null
  if (collapsed) {
    return (
      <button type="button" className="parent-message-pill" onClick={onExpand} data-testid="parent-messages-pill">
        保護者の休み連絡 {notifications.length}件
      </button>
    )
  }
  return (
    <div className="submission-acknowledgement-overlay" role="presentation">
      <div className="submission-acknowledgement-modal parent-message-modal" role="dialog" aria-modal="true" aria-label="保護者からの休み連絡" data-testid="parent-messages-modal">
        <div className="submission-acknowledgement-kicker">
          保護者からの休み連絡{notifications.length > 1 ? `（${notifications.length}件）` : ''}
        </div>
        <p className="parent-message-lead">コマごとに処理を選んでください。選ぶと保護者のページに「教室確認済」と表示されます。</p>
        <ul className="submission-acknowledgement-list">
          {notifications.map((entry) => {
            const isBusy = busyId === entry.id
            const unsavedNote = buildParentAbsenceUnsavedNote(entry.previousResolution)
            const error = errors[entry.id] ?? ''
            return (
              <li key={entry.id} className="submission-acknowledgement-item parent-message-item" data-testid="parent-message-item">
                <div className="submission-acknowledgement-item-classroom">{entry.classroomName}</div>
                <div className="parent-message-meta">
                  <span className="parent-message-student">生徒 <strong>{entry.studentName}</strong></span>
                  <span className="parent-message-received-at">受信 {formatJstDateTimeLabel(entry.createdAt) ?? ''}</span>
                </div>
                <p className="parent-message-lesson" data-testid="parent-message-lesson">
                  <strong>{formatParentAbsenceLessonLabel(entry.absence)}</strong> を休みます
                  {entry.absence.isTentative ? <span className="parent-message-tentative">まだ盤面に無い週の予定</span> : null}
                </p>
                {unsavedNote ? <p className="parent-message-unsaved-note" role="note">{unsavedNote}</p> : null}
                {error ? <p className="parent-message-error" role="alert">{error}</p> : null}
                <div className="parent-message-choices">
                  {PARENT_ABSENCE_CHOICES.map((choice) => (
                    <button
                      key={choice.resolution}
                      type="button"
                      className={`parent-message-choice${choice.resolution === 'manual' ? ' is-manual' : ''}`}
                      onClick={() => onChoose(entry, choice.resolution)}
                      // 1 件を処理している間は他の連絡も押せなくする(盤面への一過性コマンドは 1 件ずつ)。
                      disabled={busyId !== null}
                      title={choice.description}
                      data-testid={`parent-message-choice-${choice.resolution}`}
                    >
                      <span className="parent-message-choice-label">{isBusy ? '処理中…' : choice.label}</span>
                      <span className="parent-message-choice-description">{choice.description}</span>
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="submission-acknowledgement-actions parent-message-actions">
          <span className="parent-message-actions-hint">休み・振無休・振替先は盤面を保存した時点で処理済みになります(保存前に閉じると次回もう一度表示されます)。</span>
          <button type="button" className="secondary-button" onClick={onCollapse} disabled={busyId !== null} data-testid="parent-messages-collapse">
            あとで(盤面を見る)
          </button>
        </div>
      </div>
    </div>
  )
}
