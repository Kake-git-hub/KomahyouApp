// 画面の自動巡回(tools/ui-patrol.mjs)の台本が頼る testid と、操作の待ち。台本・driver はここに書いた名前だけを使う。
// 名前がアプリ側で変わったら、selectors.test.mjs(毎 push のユニットテスト)がソースとの突き合わせで落ちる
// (巡回そのものは CI で動かないので、ここで気づけないと巡回が黙って空振りする)。

export const TESTIDS = {
  saveButton: 'save-board-button', undoButton: 'undo-button', redoButton: 'redo-button', status: 'toolbar-status',
  openTemplate: 'board-regular-template-button', templateDate: 'template-effective-start-date', templateSave: 'template-save-overwrite-button',
  templateConfirmModal: 'template-save-confirm-modal', templateConfirmMessage: 'template-save-confirm-message',
  templateConfirmDetail: 'template-save-confirm-detail-text', templateConfirmExecute: 'template-save-confirm-execute-button',
  weekLabel: 'week-label', weekJumpPopover: 'week-jump-popover', prevWeek: 'prev-week-button', nextWeek: 'next-week-button',
  // 週の選択の月送り(表示中の月に目当ての日が無いとき)。
  weekJumpPrevMonth: 'week-jump-prev-month', weekJumpNextMonth: 'week-jump-next-month',
  duplicateTabBlock: 'duplicate-tab-block',
  // 台本 d(テンプレを実際に変えて保存): テンプレ作成の画面の生徒メニュー・講師メニュー(ScheduleBoardScreen.tsx)と「コマ表に戻る」(BoardToolbar.tsx)。
  templateClose: 'template-close-button', studentMenu: 'student-action-menu', menuOpenAdd: 'menu-open-add-existing-student-button',
  menuAddConfirm: 'menu-add-existing-student-confirm-button', menuDelete: 'menu-delete-button',
  teacherMenu: 'teacher-action-menu', teacherConfirm: 'teacher-select-confirm-button', teacherDelete: 'teacher-delete-button',
}

/** 虫眼鏡つきのプルダウン(SearchableSelect の testId の prop → <select> の data-testid)。台本 d が生徒・講師を選ぶ。 */
export const SEARCHABLE_SELECT_TESTIDS = { templateAddStudent: 'template-add-student-select', teacherSelect: 'teacher-select-input' }

// student-cell-{cellId}-{deskIndex}-{studentIndex}(BoardGrid.tsx)・week-jump-day-{dateKey}(BoardToolbar.tsx)
export const TESTID_PREFIXES = { studentCell: 'student-cell-', weekJumpDay: 'week-jump-day-', teacherCell: 'teacher-cell-', studentName: 'student-name-' }

export const SOURCE_FILES_WITH_TESTIDS = [
  'src/components/schedule-board/BoardToolbar.tsx',
  'src/components/schedule-board/BoardGrid.tsx',
  'src/components/schedule-board/ScheduleBoardScreen.tsx',
  'src/App.tsx',
]

/**
 * 長押しドラッグの待ち。アプリの handleStudentMouseDown(ScheduleBoardScreen.tsx)は 250ms の長押しで掴み、掴む前に 8px 動くと取り消す。
 * 長押しは 250ms より長く待ち(400ms)、掴んでから 10 段階で動かし、放す前に少し待つ(:hover と描画の落ち着き)。
 */
export const DRIVER_TIMING = { longPressMs: 400, dragSteps: 10, beforeReleaseMs: 100 }

export const studentCellTestId = ({ cellId, deskIndex, seat }) => `${TESTID_PREFIXES.studentCell}${cellId}-${deskIndex}-${seat}`
// teacher-cell-{cellId}-{deskIndex}・student-name-{cellId}-{deskIndex}-{studentIndex}(BoardGrid.tsx)
export const teacherCellTestId = ({ cellId, deskIndex }) => `${TESTID_PREFIXES.teacherCell}${cellId}-${deskIndex}`
export const studentNameTestId = ({ cellId, deskIndex, seat }) => `${TESTID_PREFIXES.studentName}${cellId}-${deskIndex}-${seat}`
export const weekJumpDayTestId = (dateKey) => `${TESTID_PREFIXES.weekJumpDay}${dateKey}`
export const byTestId = (testId) => `[data-testid="${testId}"]`
