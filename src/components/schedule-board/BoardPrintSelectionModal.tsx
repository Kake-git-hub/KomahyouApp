import { useMemo, useState } from 'react'
import {
  applyBoardPrintPattern,
  boardPrintCellKey,
  boardPrintPatternStorageKey,
  clearBoardPrintCells,
  resolveBoardPrintSelection,
  selectAllBoardPrintCells,
  serializeBoardPrintPattern,
  toggleBoardPrintCell,
  toggleBoardPrintDayColumn,
  toggleBoardPrintSlotRow,
  type BoardPrintGrid,
  type BoardPrintSelection,
} from '../../utils/boardPrintSelection'

type BoardPrintSelectionModalProps = {
  grid: BoardPrintGrid
  weekLabel?: string
  isPrinting?: boolean
  /** 選択パターンを教室ごとに記憶するキー(classroomStorageKey)。無ければ 'default'。 */
  storageKey?: string | null
  onCancel: () => void
  onSubmit: (selection: BoardPrintSelection) => void
}

// 選択パターンの読み書きは localStorage(端末内)だけ。壊れていても空でも全選択に戻るので落ちない。
function readStoredPattern(storageKey: string | null | undefined): string | null {
  try {
    return window.localStorage.getItem(boardPrintPatternStorageKey(storageKey))
  } catch {
    return null
  }
}

function writeStoredPattern(storageKey: string | null | undefined, value: string) {
  try {
    window.localStorage.setItem(boardPrintPatternStorageKey(storageKey), value)
  } catch {
    // 保存できない環境(プライベートモード等)でも出力自体は進める。
  }
}

// 盤面PDFの「どのコマを出すか」を選ぶモーダル(docs/spec-schedule-pdf.md §I)。
// 行=時限・列=曜日(表示週の全曜日。定休日も選べる: 確認リスト p-1・2026-09-12)。
// 初期状態は「前回この教室で出力したときの選択(曜日×時限のパターン)」。記憶が無ければ全選択＝従来と同じ
// 「1週間まるごと」出力。空選択では出力できない(ボタン無効)。用紙は A3 縦固定のまま(オーナー確定 2026-09-11)。
export function BoardPrintSelectionModal({ grid, weekLabel, isPrinting, storageKey, onCancel, onSubmit }: BoardPrintSelectionModalProps) {
  const [checked, setChecked] = useState<string[]>(() => applyBoardPrintPattern(grid, readStoredPattern(storageKey)))
  const checkedSet = useMemo(() => new Set(checked), [checked])
  const selection = useMemo(() => resolveBoardPrintSelection(grid, checked), [grid, checked])

  const isDayColumnChecked = (dateKey: string) =>
    grid.slots.length > 0 && grid.slots.every((slot) => checkedSet.has(boardPrintCellKey(dateKey, slot.slotNumber)))
  const isSlotRowChecked = (slotNumber: number) =>
    grid.days.length > 0 && grid.days.every((day) => checkedSet.has(boardPrintCellKey(day.dateKey, slotNumber)))

  const handleSubmit = () => {
    // 出力した選択を「次回のデフォルト」として教室ごとに記憶する(p-1)。
    writeStoredPattern(storageKey, serializeBoardPrintPattern(grid, checked))
    onSubmit(selection)
  }

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="auto-assign-modal board-print-selection-modal" role="dialog" aria-modal="true" aria-label="PDF出力するコマの選択" data-testid="board-print-selection-modal" style={{ minWidth: 360, maxWidth: 720 }}>
        <div className="auto-assign-modal-title">PDF出力するコマを選ぶ</div>
        {weekLabel ? <div className="student-menu-meta">{weekLabel}</div> : null}
        <div className="student-menu-help-text">
          全選択なら、これまでどおり 1 週間まるごと出力します。チェックを外したコマは空白になり、
          曜日・時限をまるごと外すとその列・行ごと詰めて A3 縦いっぱいに拡大されます。
          出力した選択は、この教室の次回のデフォルトとして端末に記憶されます。
        </div>

        <div className="board-print-selection-actions">
          <button className="secondary-button slim" type="button" onClick={() => setChecked(selectAllBoardPrintCells(grid))} data-testid="board-print-select-all">全選択</button>
          <button className="secondary-button slim" type="button" onClick={() => setChecked(clearBoardPrintCells())} data-testid="board-print-clear-all">全解除</button>
          <span className="selection-pill" data-testid="board-print-selected-count">選択 {selection.selectedCellCount} / {selection.selectableCellCount} コマ</span>
        </div>

        <div className="board-print-selection-table-wrap">
          <table className="board-print-selection-table" data-testid="board-print-selection-table">
            <thead>
              <tr>
                <th scope="col">時限＼日</th>
                {grid.days.map((day) => (
                  <th key={day.dateKey} scope="col">
                    <button
                      className={`board-print-selection-head${day.isOpenDay ? '' : ' is-closed-day'}`}
                      type="button"
                      onClick={() => setChecked(toggleBoardPrintDayColumn(grid, checked, day.dateKey))}
                      data-testid={`board-print-day-toggle-${day.dateKey}`}
                      aria-pressed={isDayColumnChecked(day.dateKey)}
                      title={day.isOpenDay ? undefined : '定休日(盤面には空の列として出ます)'}
                    >
                      {day.dayLabel ? `${day.dateLabel}(${day.dayLabel})` : day.dateLabel}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.slots.map((slot) => (
                <tr key={slot.slotNumber}>
                  <th scope="row">
                    <button
                      className="board-print-selection-head"
                      type="button"
                      onClick={() => setChecked(toggleBoardPrintSlotRow(grid, checked, slot.slotNumber))}
                      data-testid={`board-print-slot-toggle-${slot.slotNumber}`}
                      aria-pressed={isSlotRowChecked(slot.slotNumber)}
                    >
                      {slot.slotLabel}
                    </button>
                  </th>
                  {grid.days.map((day) => {
                    const key = boardPrintCellKey(day.dateKey, slot.slotNumber)
                    return (
                      <td key={key} className={day.isOpenDay ? undefined : 'is-closed-day'}>
                        <label className="board-print-selection-cell">
                          <input
                            type="checkbox"
                            checked={checkedSet.has(key)}
                            onChange={() => setChecked(toggleBoardPrintCell(grid, checked, key))}
                            data-testid={`board-print-cell-${key}`}
                            aria-label={`${day.dateLabel} ${slot.slotLabel}`}
                          />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="auto-assign-modal-actions">
          <button className="secondary-button slim" type="button" onClick={onCancel} data-testid="board-print-cancel-button">キャンセル</button>
          <button
            className="primary-button slim"
            type="button"
            onClick={handleSubmit}
            disabled={selection.isEmpty || Boolean(isPrinting)}
            data-testid="board-print-submit-button"
          >
            {isPrinting ? 'PDF出力中...' : '出力'}
          </button>
        </div>
      </div>
    </div>
  )
}
