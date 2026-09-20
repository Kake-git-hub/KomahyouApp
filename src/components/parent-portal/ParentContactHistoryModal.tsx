import {
  PARENT_ABSENCE_RESOLUTION_LABELS,
  PARENT_CONTACT_HISTORY_CONFIRMED_LIMIT,
  formatParentAbsenceLessonLabel,
  type ParentContactHistoryRow,
} from '../../utils/parentMessages'
import { formatJstDateTimeLabel } from './parentPortalPageModel'

// 盤面ツールバー「保護者連絡」ボタンで開く、保護者QRからの休み連絡の履歴(2026-09-19 オーナー指示)。
// 表示だけを担う。行の組み立て(状態・確認済 10 件の切り詰め)は純関数 buildParentContactHistory。
// 未確認の行だけが押せて、押すと休み連絡のモーダル(ParentMessagesModal)が開く = 処理は既存の四択 1 本のまま
// (ここに別の処理経路を作らない・INV-06)。内部 ID は DOM に出さない。

type ParentContactHistoryModalProps = {
  rows: ParentContactHistoryRow[]
  onOpenUnconfirmed: () => void
  onClose: () => void
}

const STATUS_LABELS: Record<ParentContactHistoryRow['status'], string> = {
  confirmed: '確認済',
  unconfirmed: '未確認',
}

function HistoryRowBody({ row }: { row: ParentContactHistoryRow }) {
  return (
    <>
      <span className="parent-contact-history-received-at">{formatJstDateTimeLabel(row.createdAt) ?? ''}</span>
      <span className="parent-contact-history-detail">
        <strong>{row.studentName}</strong> {formatParentAbsenceLessonLabel(row.absence)}
      </span>
      <span className={`parent-contact-history-status is-${row.status}`} data-testid="parent-contact-history-status">
        {STATUS_LABELS[row.status]}
        {row.resolution ? `・${PARENT_ABSENCE_RESOLUTION_LABELS[row.resolution]}` : ''}
      </span>
    </>
  )
}

export function ParentContactHistoryModal({ rows, onOpenUnconfirmed, onClose }: ParentContactHistoryModalProps) {
  return (
    <div className="submission-acknowledgement-overlay" role="presentation" onClick={onClose}>
      <div
        className="submission-acknowledgement-modal parent-message-modal"
        role="dialog"
        aria-modal="true"
        aria-label="保護者連絡の履歴"
        data-testid="parent-contact-history-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-acknowledgement-kicker">保護者連絡(QRからの休み連絡の履歴)</div>
        <p className="parent-message-lead">
          新しい連絡が上です。確認済は直近{PARENT_CONTACT_HISTORY_CONFIRMED_LIMIT}件まで表示します。未確認の行を押すと、休み連絡の処理を選べます。
        </p>
        {rows.length === 0 ? (
          <p className="parent-contact-history-empty" data-testid="parent-contact-history-empty">休み連絡はまだありません。</p>
        ) : (
          <ul className="parent-contact-history-list">
            {rows.map((row) => (
              <li key={row.id} data-testid="parent-contact-history-row" data-status={row.status}>
                {row.status === 'unconfirmed' ? (
                  <button type="button" className="parent-contact-history-row is-clickable" onClick={onOpenUnconfirmed} title="押すと休み連絡の処理を選べます">
                    <HistoryRowBody row={row} />
                  </button>
                ) : (
                  <div className="parent-contact-history-row">
                    <HistoryRowBody row={row} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="submission-acknowledgement-actions">
          <button type="button" className="secondary-button" onClick={onClose} data-testid="parent-contact-history-close">閉じる</button>
        </div>
      </div>
    </div>
  )
}
