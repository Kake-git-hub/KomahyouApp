import { lessonTypeLabels, teacherTypeLabels } from './mockData'
import type { DeskLesson, SlotCell, StudentEntry } from './types'

const hasStudent = (student: StudentEntry | null): student is StudentEntry => student !== null

type DetailPanelProps = {
  selectedCell: SlotCell | undefined
  selectedDeskIndex: number
  selectedLesson: DeskLesson | undefined
  selectedDebugCopy: string
  statusMessage: string
  onCopyDebug: () => void
  onCopyIssueTemplate: () => void
}

export function DetailPanel({
  selectedCell,
  selectedDeskIndex,
  selectedLesson,
  selectedDebugCopy,
  statusMessage,
  onCopyDebug,
  onCopyIssueTemplate,
}: DetailPanelProps) {
  return (
    <aside className="detail-panel" aria-label="コマ詳細パネル">
      <div className="detail-panel-head">
        <div>
          <p className="panel-kicker">コマ詳細パネル</p>
          <h2>
            {selectedCell?.dateLabel} {selectedCell?.dayLabel} / {selectedCell?.slotLabel} / {selectedDeskIndex + 1}机目
          </h2>
        </div>
        <span className="detail-time">{selectedCell?.timeLabel}</span>
      </div>

      <div className="detail-section">
        <h3>選択中の机</h3>
        {selectedLesson ? (
          <div className="detail-card detail-card-focus">
            <div className="detail-row">
              <span className="detail-label">授業区分</span>
              <span>{selectedLesson.studentSlots.filter(hasStudent).map((student) => lessonTypeLabels[student.lessonType]).join(' / ')}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">講師区分</span>
              <span>{selectedLesson.studentSlots.filter(hasStudent).map((student) => teacherTypeLabels[student.teacherType]).join(' / ')}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">講師</span>
              <span>{selectedCell?.desks[selectedDeskIndex]?.teacher}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">生徒</span>
              <span>{selectedLesson.studentSlots.filter(hasStudent).map((student) => student.name).join(' / ')}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">科目</span>
              <span>{selectedLesson.studentSlots.filter(hasStudent).map((student) => student.subject).join(' / ')}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">注意理由</span>
              <span>{selectedLesson.warning ?? 'なし'}</span>
            </div>
            <div className="detail-note">{selectedLesson.note ?? '補足なし'}</div>
          </div>
        ) : (
          <div className="detail-empty">この机にはまだ授業が入っていません。ここを移動先の候補として使う想定です。</div>
        )}
      </div>

      <div className="detail-section">
        <h3>同じコマの他の机</h3>
        {selectedCell?.desks.some((desk) => desk.lesson) ? (
          selectedCell.desks.map((desk, index) => {
            const lesson = desk.lesson
            if (!lesson) return null

            return (
            <div key={lesson.id} className={`detail-card${index === selectedDeskIndex ? ' detail-card-selected' : ''}`}>
              <div className="detail-row">
                <span className="detail-label">{index + 1}机目</span>
                <span>
                  {lesson.studentSlots.filter(hasStudent).map((student) => `${lessonTypeLabels[student.lessonType]} / ${teacherTypeLabels[student.teacherType]}`).join(' , ')}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">講師</span>
                <span>{desk.teacher}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">生徒</span>
                <span>{lesson.studentSlots.filter(hasStudent).map((student) => student.name).join(' / ')}</span>
              </div>
            </div>
            )
          })
        ) : (
          <div className="detail-empty">同じコマの割当はまだありません。</div>
        )}
      </div>

      <div className="detail-section">
        <h3>デバッグコピー</h3>
        <p className="detail-copy-guide">
          問題報告を速くするために、選択中コマの内容をそのままコピーできます。
        </p>
        <div className="detail-action-row">
          <button className="primary-button" type="button" onClick={onCopyDebug}>
            デバッグコピー
          </button>
          <button className="secondary-button" type="button" onClick={onCopyIssueTemplate}>
            報告テンプレートをコピー
          </button>
        </div>
        <pre className="debug-preview">{selectedDebugCopy}</pre>
        <div className="status-banner">{statusMessage}</div>
      </div>
    </aside>
  )
}