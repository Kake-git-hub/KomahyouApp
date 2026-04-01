import { AppMenu } from '../navigation/AppMenu'

type BoardToolbarProps = {
  weekLabel: string
  statusMessage: string
  lectureStockEntryCount: number
  isLectureStockOpen: boolean
  makeupStockEntryCount: number
  isMakeupStockOpen: boolean
  isMakeupMoveActive: boolean
  isPrintingPdf: boolean
  isStudentScheduleOpen: boolean
  isTeacherScheduleOpen: boolean
  hasSelectedStudent: boolean
  canUndo: boolean
  canRedo: boolean
  canGoPrevWeek: boolean
  canGoNextWeek: boolean
  isTemplateMode: boolean
  onUndo: () => void
  onRedo: () => void
  onPackSort: () => void
  onGoPrevWeek: () => void
  onGoNextWeek: () => void
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
  onTemplateExport?: () => void
  onTemplateImport?: () => void
  onTemplateSave?: () => void
  onTemplateClose?: () => void
}

export function BoardToolbar({
  weekLabel,
  statusMessage,
  lectureStockEntryCount,
  isLectureStockOpen,
  makeupStockEntryCount,
  isMakeupStockOpen,
  isMakeupMoveActive,
  isPrintingPdf,
  isStudentScheduleOpen,
  isTeacherScheduleOpen,
  hasSelectedStudent,
  canUndo,
  canRedo,
  canGoPrevWeek,
  canGoNextWeek,
  isTemplateMode,
  onUndo,
  onRedo,
  onPackSort,
  onGoPrevWeek,
  onGoNextWeek,
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
  onTemplateExport,
  onTemplateImport,
  onTemplateSave,
  onTemplateClose,
}: BoardToolbarProps) {
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
        </div>
        <div className={`toolbar-status toolbar-status-centered${isMakeupMoveActive ? ' is-emphasis' : ''}`} data-testid="toolbar-status">{statusMessage}</div>
        <div className="toolbar-group toolbar-group-end">
          {isTemplateMode ? (
            <>
              <button className="secondary-button slim" type="button" onClick={onTemplateExport} data-testid="template-export-button">エクセル現状出力</button>
              <button className="secondary-button slim" type="button" onClick={onTemplateImport} data-testid="template-import-button">エクセル取込</button>
              <button className="primary-button" type="button" onClick={onTemplateSave} data-testid="template-save-button">保存</button>
            </>
          ) : (
            <>
              <button className={`secondary-button slim${isLectureStockOpen ? ' active' : ''}`} type="button" onClick={onToggleLectureStock} data-testid="lecture-stock-chip">
                未消化講習
                {lectureStockEntryCount > 0 ? <span className="toolbar-inline-count">{lectureStockEntryCount}</span> : null}
              </button>
              <button className={`secondary-button slim${isMakeupStockOpen || isMakeupMoveActive ? ' active' : ''}${isMakeupMoveActive ? ' is-emphasis' : ''}`} type="button" onClick={onToggleMakeupStock} data-testid="makeup-stock-chip">
                {isMakeupMoveActive ? '振替移動中' : '未消化振替'}
                {makeupStockEntryCount > 0 ? <span className="toolbar-inline-count">{makeupStockEntryCount}</span> : null}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenStudentSchedule} disabled={isStudentScheduleOpen} data-testid="board-student-schedule-button">
                {isStudentScheduleOpen ? '生徒日程は別タブで表示中' : '生徒日程'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenTeacherSchedule} disabled={isTeacherScheduleOpen} data-testid="board-teacher-schedule-button">
                {isTeacherScheduleOpen ? '講師日程は別タブで表示中' : '講師日程'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onPrintPdf} disabled={isPrintingPdf} data-testid="board-print-pdf-button">
                {isPrintingPdf ? 'PDF出力中...' : 'PDF出力'}
              </button>
              <button className="secondary-button slim" type="button" onClick={onOpenRegularTemplate} data-testid="board-regular-template-button">
                通常授業テンプレ作成
              </button>
              <div className="toolbar-segmented">
                <button className="segment-button" type="button" onClick={onGoPrevWeek} disabled={!canGoPrevWeek} data-testid="prev-week-button">◀ 前週</button>
                <span className="week-label" data-testid="week-label">{weekLabel}</span>
                <button className="segment-button" type="button" onClick={onGoNextWeek} disabled={!canGoNextWeek} data-testid="next-week-button">次週 ▶</button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}