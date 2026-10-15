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
//
// ★生徒ごとの全履歴(オーナー指示 2026-10-15): 一覧は確認済 10 件までのまま、各行の「全履歴」または下の生徒選択から
//   その生徒の全件(件数制限なし)へ進める。行の組み立ては buildParentStudentContactHistory(一覧と同じ 1 本)。

/** 生徒ごとの全履歴の表示状態(読み込みは App が 1 回だけ行う)。 */
export type ParentContactStudentHistoryView = {
  studentName: string
  status: 'loading' | 'ready' | 'error'
  rows: ParentContactHistoryRow[]
}

type ParentContactHistoryModalProps = {
  rows: ParentContactHistoryRow[]
  studentOptions: Array<{ studentId: string; studentName: string }>
  studentHistory: ParentContactStudentHistoryView | null
  onOpenStudentHistory: (studentId: string, studentName: string) => void
  onCloseStudentHistory: () => void
  onOpenUnconfirmed: () => void
  onClose: () => void
}

const STATUS_LABELS: Record<ParentContactHistoryRow['status'], string> = {
  confirmed: '確認済',
  unconfirmed: '未確認',
}

const PARENT_CONTACT_STUDENT_HISTORY_LOADING = '読み込み中…'
const PARENT_CONTACT_STUDENT_HISTORY_ERROR = '履歴を読み込めませんでした。通信状態を確認して、もう一度開いてください。'
const PARENT_CONTACT_HISTORY_EMPTY = '休み連絡はまだありません。'

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

function HistoryRow({ row, onOpenUnconfirmed }: { row: ParentContactHistoryRow; onOpenUnconfirmed: () => void }) {
  return row.status === 'unconfirmed' ? (
    <button type="button" className="parent-contact-history-row is-clickable" onClick={onOpenUnconfirmed} title="押すと休み連絡の処理を選べます">
      <HistoryRowBody row={row} />
    </button>
  ) : (
    <div className="parent-contact-history-row">
      <HistoryRowBody row={row} />
    </div>
  )
}

export function ParentContactHistoryModal({ rows, studentOptions, studentHistory, onOpenStudentHistory, onCloseStudentHistory, onOpenUnconfirmed, onClose }: ParentContactHistoryModalProps) {
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
        {studentHistory ? (
          <>
            <div className="submission-acknowledgement-kicker">保護者連絡 — {studentHistory.studentName} さんの全履歴</div>
            <p className="parent-message-lead">新しい連絡が上です。この生徒の休み連絡をすべて表示します。</p>
            {studentHistory.status === 'loading' ? (
              <p className="parent-contact-history-empty" data-testid="parent-contact-student-history-loading">{PARENT_CONTACT_STUDENT_HISTORY_LOADING}</p>
            ) : studentHistory.status === 'error' ? (
              <p className="parent-contact-history-empty" role="alert">{PARENT_CONTACT_STUDENT_HISTORY_ERROR}</p>
            ) : studentHistory.rows.length === 0 ? (
              <p className="parent-contact-history-empty">{PARENT_CONTACT_HISTORY_EMPTY}</p>
            ) : (
              <ul className="parent-contact-history-list" data-testid="parent-contact-student-history-list">
                {studentHistory.rows.map((row) => (
                  <li key={row.id} data-testid="parent-contact-history-row" data-status={row.status}>
                    <HistoryRow row={row} onOpenUnconfirmed={onOpenUnconfirmed} />
                  </li>
                ))}
              </ul>
            )}
            <div className="submission-acknowledgement-actions">
              <button type="button" className="secondary-button" onClick={onCloseStudentHistory} data-testid="parent-contact-student-history-back">一覧へ戻る</button>
              <button type="button" className="secondary-button" onClick={onClose}>閉じる</button>
            </div>
          </>
        ) : (
          <>
            <div className="submission-acknowledgement-kicker">保護者連絡(QRからの休み連絡の履歴)</div>
            <p className="parent-message-lead">
              新しい連絡が上です。確認済は直近{PARENT_CONTACT_HISTORY_CONFIRMED_LIMIT}件まで表示します(それより前は「全履歴」から生徒ごとに見られます)。未確認の行を押すと、休み連絡の処理を選べます。
            </p>
            {rows.length === 0 ? (
              <p className="parent-contact-history-empty" data-testid="parent-contact-history-empty">{PARENT_CONTACT_HISTORY_EMPTY}</p>
            ) : (
              <ul className="parent-contact-history-list">
                {rows.map((row) => (
                  <li key={row.id} className="parent-contact-history-item" data-testid="parent-contact-history-row" data-status={row.status}>
                    <HistoryRow row={row} onOpenUnconfirmed={onOpenUnconfirmed} />
                    <button
                      type="button"
                      className="parent-contact-history-student-button"
                      onClick={() => onOpenStudentHistory(row.studentId, row.studentName)}
                      title={`${row.studentName} さんの休み連絡をすべて見る`}
                      data-testid="parent-contact-history-student-button"
                    >
                      全履歴
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {studentOptions.length > 0 ? (
              <label className="parent-contact-history-student-select">
                <span>生徒を選んで全履歴を見る</span>
                <select
                  value=""
                  data-testid="parent-contact-history-student-select"
                  onChange={(event) => {
                    // 値は並び順の番号(生徒ID を DOM に出さない)。
                    const option = event.target.value === '' ? undefined : studentOptions[Number(event.target.value)]
                    if (option) onOpenStudentHistory(option.studentId, option.studentName)
                  }}
                >
                  <option value="">生徒を選ぶ…</option>
                  {studentOptions.map((option, index) => (
                    <option key={option.studentId} value={String(index)}>{option.studentName}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="submission-acknowledgement-actions">
              <button type="button" className="secondary-button" onClick={onClose} data-testid="parent-contact-history-close">閉じる</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
