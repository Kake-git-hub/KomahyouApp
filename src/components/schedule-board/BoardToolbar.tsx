import { memo, useEffect, useRef, useState } from 'react'
import { AppMenu } from '../navigation/AppMenu'
import {
  buildMonthMatrix,
  formatMonthLabel,
  isWithinWeek,
  monthOfDateKey,
  shiftMonth,
  todayDateKey,
} from './weekJumpCalendar'

type BoardToolbarProps = {
  weekLabel: string
  weekStartDate: string
  statusMessage: string
  lectureStockEntryCount: number
  isLectureStockOpen: boolean
  makeupStockTotalCount: number
  isMakeupStockOpen: boolean
  isMakeupMoveActive: boolean
  isPrintingPdf: boolean
  isStudentScheduleOpen: boolean
  isTeacherScheduleOpen: boolean
  // React 日程表ビュー(staging 先行)では「別タブ」ではなくドック/別ウィンドウ表示のため文言を差し替える。
  studentScheduleOpenLabel?: string
  teacherScheduleOpenLabel?: string
  hasSelectedStudent: boolean
  canUndo: boolean
  canRedo: boolean
  canGoPrevWeek: boolean
  canGoNextWeek: boolean
  isTemplateMode: boolean
  onUndo: () => void
  onRedo: () => void
  onPackSort: () => void
  onCopyDistributionUrl?: () => void
  onGoPrevWeek: () => void
  onGoNextWeek: () => void
  onJumpToDate: (dateKey: string) => void
  onToggleLectureStock: () => void
  onToggleMakeupStock: () => void
  onOpenStudentSchedule: () => void
  onOpenTeacherSchedule: () => void
  onOpenRegularTemplate: () => void
  onPrintPdf: () => void
  onCancelSelection: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  onOpenBackupRestore: () => void
  onLogout: () => void
  undoSnapshotLabel: string | null
  onRestoreUndoSnapshot?: () => void
  onDismissUndoSnapshot?: () => void
  onTemplateExport?: () => void
  onTemplateImport?: () => void
  onTemplateSaveOverwrite?: () => void
  onTemplateClear?: () => void
  onTemplateClose?: () => void
  onSaveBoard?: () => void
  isBoardDirty?: boolean
  isBoardSaving?: boolean
  isBoardSaveDisabled?: boolean
  hasPendingSave?: boolean
  syncStatusMessage?: string
  syncProgressPercent?: number | null
  syncElapsedSeconds?: number | null
}

function BoardToolbarComponent({
  weekLabel,
  weekStartDate,
  statusMessage,
  lectureStockEntryCount,
  isLectureStockOpen,
  makeupStockTotalCount,
  isMakeupStockOpen,
  isMakeupMoveActive,
  isPrintingPdf,
  isStudentScheduleOpen,
  isTeacherScheduleOpen,
  studentScheduleOpenLabel,
  teacherScheduleOpenLabel,
  hasSelectedStudent,
  canUndo,
  canRedo,
  canGoPrevWeek,
  canGoNextWeek,
  isTemplateMode,
  onUndo,
  onRedo,
  onPackSort,
  onCopyDistributionUrl,
  onGoPrevWeek,
  onGoNextWeek,
  onJumpToDate,
  onToggleLectureStock,
  onToggleMakeupStock,
  onOpenStudentSchedule,
  onOpenTeacherSchedule,
  onOpenRegularTemplate,
  onPrintPdf,
  onCancelSelection,
  onOpenBasicData,
  onOpenSpecialData,
  onOpenAutoAssignRules,
  onOpenBackupRestore,
  onLogout,
  undoSnapshotLabel,
  onRestoreUndoSnapshot,
  onDismissUndoSnapshot,
  onTemplateExport,
  onTemplateImport,
  onTemplateSaveOverwrite,
  onTemplateClear,
  onTemplateClose,
  onSaveBoard,
  isBoardSaving,
  isBoardSaveDisabled,
  hasPendingSave,
  syncStatusMessage,
  syncProgressPercent,
  syncElapsedSeconds,
}: BoardToolbarProps) {
  // 表示週を選択する自作カレンダー。
  //   ネイティブ日付ピッカーは「月送り」と「日選択」を区別できず(端末により blur も
  //   来ない)、月を送っただけで表示週が変わる問題があった。自作カレンダーにして
  //   「月送りは表示だけ変える(週は変えない)／日付タップで初めて確定」を全端末で
  //   決定的に再現する。表示計算は純関数 weekJumpCalendar.ts に切り出してテスト。
  const weekJumpWrapperRef = useRef<HTMLSpanElement | null>(null)
  const [weekJumpOpen, setWeekJumpOpen] = useState(false)
  // カレンダーが表示している月(週ではない)。月送りはこの state だけを変える。
  const [weekJumpViewMonth, setWeekJumpViewMonth] = useState(() => monthOfDateKey(weekStartDate))
  const openWeekJumpPicker = () => {
    // 開くたびに現在の表示週の月へ合わせる。
    setWeekJumpViewMonth(monthOfDateKey(weekStartDate))
    setWeekJumpOpen(true)
  }
  const selectWeekJumpDate = (dateKey: string) => {
    setWeekJumpOpen(false)
    onJumpToDate(dateKey)
  }
  // 外側クリック / Escape で閉じる（週は変えない）。
  useEffect(() => {
    if (!weekJumpOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const wrapper = weekJumpWrapperRef.current
      if (wrapper && !wrapper.contains(event.target as Node)) setWeekJumpOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWeekJumpOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [weekJumpOpen])

  // 保存ボタンを押した瞬間に「保存中…」へ切り替えるためのローカル状態。
  // 親の保存状態(isBoardSaving)の伝播タイミングに依存せず、クリック即フィードバックを保証する。
  // 保存待ち(hasPendingSave)が解消した時点でリセットする（描画中の状態調整パターン）。
  const [savePressed, setSavePressed] = useState(false)
  if (savePressed && !hasPendingSave && !isBoardSaving && !isBoardSaveDisabled) {
    setSavePressed(false)
  }
  const isSavingInProgress = savePressed || Boolean(isBoardSaving) || Boolean(isBoardSaveDisabled)
  // 常時クリック可能(グレーアウトしない／常に緑)。保存中だけ無効化して二重実行を防ぐ。
  // 未保存が無いとき(=「最新データ」表示)は押しても no-op。spec-save-restore.md §1。
  const isSaveButtonDisabled = isSavingInProgress
  const handleSaveBoardClick = () => {
    if (!hasPendingSave) return
    setSavePressed(true)
    // スピナーの描画を先に確定させてから保存処理を走らせる（同期的な重い処理で
    // 「保存中…」表示が遅れる/飛ぶのを防ぐ）。
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => onSaveBoard?.())
    } else {
      setTimeout(() => onSaveBoard?.(), 0)
    }
  }

  return (
    <section className="toolbar-panel" aria-label={isTemplateMode ? '通常授業テンプレート操作バー' : 'コマ調整の操作バー'}>
      <div className="toolbar-row toolbar-row-primary">
        <div className="toolbar-group toolbar-group-compact">
          {isTemplateMode ? (
            <button className="secondary-button slim" type="button" onClick={onTemplateClose} data-testid="template-close-button">コマ表に戻る</button>
          ) : (
            <AppMenu
              currentScreen="board"
              onNavigate={(screen) => {
                if (screen === 'basic-data') onOpenBasicData()
                if (screen === 'special-data') onOpenSpecialData()
                if (screen === 'auto-assign-rules') onOpenAutoAssignRules()
                if (screen === 'backup-restore') onOpenBackupRestore()
              }}
              actionButtonLabel={hasSelectedStudent ? 'キャンセル' : undefined}
              onActionButtonClick={hasSelectedStudent ? onCancelSelection : undefined}
              actionButtonTestId={hasSelectedStudent ? 'cancel-selection-button' : undefined}
              buttonTestId="menu-button"
              basicDataItemTestId="menu-open-basic-data-button"
              specialDataItemTestId="menu-open-special-data-button"
              autoAssignRulesItemTestId="menu-open-auto-assign-rules-button"
              backupRestoreItemTestId="menu-open-backup-restore-button"
              footerActionLabel="ログアウト"
              onFooterActionClick={onLogout}
              footerActionTestId="menu-logout-button"
            />
          )}
          <button className="icon-action-button" type="button" onClick={onUndo} disabled={!canUndo} data-testid="undo-button" aria-label="元に戻す" title="元に戻す">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8 5 3.5 9.5 8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 9.5h7.25c3.18 0 5.75 2.57 5.75 5.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="icon-action-button" type="button" onClick={onRedo} disabled={!canRedo} data-testid="redo-button" aria-label="やり直し" title="やり直し">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m12 5 4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 9.5H8.75C5.57 9.5 3 12.07 3 15.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="secondary-button slim" type="button" onClick={onPackSort} data-testid="pack-sort-button">詰めて並び替え</button>
          {!isTemplateMode && onCopyDistributionUrl ? (
            <button className="secondary-button slim" type="button" onClick={onCopyDistributionUrl} data-testid="board-distribution-url-button">講師日程共有</button>
          ) : null}
        </div>
        <div className={`toolbar-status toolbar-status-centered${isMakeupMoveActive ? ' is-emphasis' : ''}${syncProgressPercent !== null && syncProgressPercent !== undefined ? ' is-syncing' : ''}`} data-testid="toolbar-status">
          {syncProgressPercent !== null && syncProgressPercent !== undefined ? (
            <div className="toolbar-sync-progress" aria-label={`Firebase 同期 ${syncProgressPercent}%`} role="status" aria-live="polite">
              <div className="toolbar-sync-progress-text">
                <span className="button-spinner" aria-hidden="true" />
                {syncStatusMessage || `データベースへ保存中(${syncProgressPercent}%完了)`}
                {syncElapsedSeconds !== null && syncElapsedSeconds !== undefined ? ` / ${syncElapsedSeconds}秒経過` : ''}
              </div>
              <div className="toolbar-sync-progress-track is-indeterminate" aria-hidden="true">
                <div className="toolbar-sync-progress-bar" style={{ width: `${Math.max(4, Math.min(100, syncProgressPercent))}%` }} />
              </div>
            </div>
          ) : (syncStatusMessage || statusMessage)}
        </div>
        <div className="toolbar-group toolbar-group-end">
          {isTemplateMode ? (
            <>
              <button className="secondary-button slim" type="button" onClick={onTemplateClear} data-testid="template-clear-button">テンプレを空にする</button>
              <button className="secondary-button slim" type="button" onClick={onTemplateExport} data-testid="template-export-button">エクセル現状出力</button>
              <button className="secondary-button slim" type="button" onClick={onTemplateImport} data-testid="template-import-button">エクセル取込</button>
              <button className="primary-button danger" type="button" onClick={onTemplateSaveOverwrite} data-testid="template-save-overwrite-button">反映開始日以降をこのテンプレで上書き保存</button>
            </>
          ) : (
            <>
              <button className={`secondary-button slim${isLectureStockOpen ? ' active' : ''}`} type="button" onClick={onToggleLectureStock} data-testid="lecture-stock-chip">
                未消化講習
                {lectureStockEntryCount > 0 ? <span className="toolbar-inline-count">{lectureStockEntryCount}</span> : null}
              </button>
              <button className={`secondary-button slim${isMakeupStockOpen || isMakeupMoveActive ? ' active' : ''}${isMakeupMoveActive ? ' is-emphasis' : ''}`} type="button" onClick={onToggleMakeupStock} data-testid="makeup-stock-chip">
                {isMakeupMoveActive ? '振替移動中' : '未消化振替'}
                {makeupStockTotalCount > 0 ? <span className="toolbar-inline-count">{makeupStockTotalCount}</span> : null}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenStudentSchedule} disabled={isStudentScheduleOpen} data-testid="board-student-schedule-button">
                {isStudentScheduleOpen ? (studentScheduleOpenLabel ?? '生徒日程は別タブで表示中') : '生徒日程'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenTeacherSchedule} disabled={isTeacherScheduleOpen} data-testid="board-teacher-schedule-button">
                {isTeacherScheduleOpen ? (teacherScheduleOpenLabel ?? '講師日程は別タブで表示中') : '講師日程'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onPrintPdf} disabled={isPrintingPdf} data-testid="board-print-pdf-button">
                {isPrintingPdf ? 'PDF出力中...' : 'PDF出力'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenRegularTemplate} data-testid="board-regular-template-button">
                通常授業テンプレ作成
              </button>
              <div className="toolbar-segmented">
                <button className="segment-button" type="button" onClick={onGoPrevWeek} disabled={!canGoPrevWeek} data-testid="prev-week-button">◀ 前週</button>
                <span className="week-jump-control" ref={weekJumpWrapperRef}>
                  <button className="week-label week-jump-button" type="button" onClick={openWeekJumpPicker} data-testid="week-label" aria-haspopup="dialog" aria-expanded={weekJumpOpen} aria-label="表示週を選択" title="表示したい日付を選択">
                    {weekLabel}
                  </button>
                  {weekJumpOpen && (
                    <div className="week-jump-popover" role="dialog" aria-label="表示週を選択" data-testid="week-jump-popover">
                      <div className="week-jump-popover-header">
                        <button className="week-jump-nav" type="button" onClick={() => setWeekJumpViewMonth((month) => shiftMonth(month, -1))} aria-label="前の月" data-testid="week-jump-prev-month">‹</button>
                        <span className="week-jump-month-label" data-testid="week-jump-month-label">{formatMonthLabel(weekJumpViewMonth)}</span>
                        <button className="week-jump-nav" type="button" onClick={() => setWeekJumpViewMonth((month) => shiftMonth(month, 1))} aria-label="次の月" data-testid="week-jump-next-month">›</button>
                      </div>
                      <div className="week-jump-weekdays" aria-hidden="true">
                        {['月', '火', '水', '木', '金', '土', '日'].map((label) => (
                          <span key={label} className="week-jump-weekday">{label}</span>
                        ))}
                      </div>
                      <div className="week-jump-grid">
                        {buildMonthMatrix(weekJumpViewMonth).flat().map((cell) => {
                          const classNames = [
                            'week-jump-day',
                            cell.inMonth ? '' : 'is-outside',
                            isWithinWeek(cell.dateKey, weekStartDate) ? 'is-selected-week' : '',
                            cell.dateKey === todayDateKey() ? 'is-today' : '',
                          ].filter(Boolean).join(' ')
                          return (
                            <button
                              key={cell.dateKey}
                              type="button"
                              className={classNames}
                              onClick={() => selectWeekJumpDate(cell.dateKey)}
                              data-testid={`week-jump-day-${cell.dateKey}`}
                            >
                              {cell.day}
                            </button>
                          )
                        })}
                      </div>
                      <div className="week-jump-popover-footer">
                        <button className="week-jump-today" type="button" onClick={() => selectWeekJumpDate(todayDateKey())} data-testid="week-jump-today-button">今日</button>
                        <button className="week-jump-close" type="button" onClick={() => setWeekJumpOpen(false)} data-testid="week-jump-close-button">閉じる</button>
                      </div>
                    </div>
                  )}
                </span>
                <button className="segment-button" type="button" onClick={onGoNextWeek} disabled={!canGoNextWeek} data-testid="next-week-button">次週 ▶</button>
              </div>
              <button
                className="primary-button slim"
                type="button"
                onClick={handleSaveBoardClick}
                disabled={isSaveButtonDisabled}
                data-testid="save-board-button"
                data-state={isSavingInProgress ? 'saving' : (hasPendingSave ? 'dirty' : 'clean')}
                title={hasPendingSave ? '保存してデータベースへ同期します。' : 'データベースと同期済みです。'}
              >
                {isSavingInProgress ? (
                  <span className="button-saving-content">
                    <span className="button-spinner" aria-hidden="true" />
                    保存中…
                  </span>
                ) : (hasPendingSave ? '保存' : '最新データ')}
              </button>
            </>
          )}
        </div>
      </div>
      {undoSnapshotLabel && (
        <div className="toolbar-row toolbar-undo-banner">
          <span>「{undoSnapshotLabel}」を実行しました。</span>
          <button className="secondary-button slim" type="button" onClick={onRestoreUndoSnapshot} data-testid="restore-undo-snapshot-button">直前の状態に戻す</button>
          <button className="icon-action-button toolbar-undo-dismiss" type="button" onClick={onDismissUndoSnapshot} data-testid="dismiss-undo-snapshot-button" aria-label="閉じる" title="閉じる">✕</button>
        </div>
      )}
    </section>
  )
}

// ツールバーは盤面データと無関係な親再描画（メニュー/モーダル開閉など）でも作り直されるため
// memo 化する。関数 props は呼び出し側で useStableCallback により参照安定化している。
export const BoardToolbar = memo(BoardToolbarComponent)
