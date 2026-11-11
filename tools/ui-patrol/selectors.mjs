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
  // 台本 e(出欠): 盤面の生徒メニューの出欠ボタン(ScheduleBoardScreen.tsx)と、未消化振替の一覧(ツールバーのボタン・一覧・振替元を選ぶ画面)。
  menuAttendance: 'menu-attendance-button', menuAbsence: 'menu-absence-button', menuAbsenceNoMakeup: 'menu-absence-no-makeup-button',
  makeupStockChip: 'makeup-stock-chip', makeupStockPanel: 'makeup-stock-panel', makeupStockClose: 'makeup-stock-close-button',
  stockActionModal: 'stock-action-modal', stockActionModalCancel: 'stock-action-modal-cancel',
  // 台本 f(講師の移動・入れ替え・休み): 盤面の講師メニューの「休み」／「休みを解除する(講師名)」と、講師を生徒のいる机へ落としたときに選ぶ画面(ScheduleBoardScreen.tsx)。
  teacherRestButton: 'teacher-rest-button', teacherSeatMoveModal: 'teacher-seat-move-modal',
  teacherSeatMoveTeacher: 'teacher-seat-move-teacher-button', teacherSeatMoveSeat: 'teacher-seat-move-seat-button', teacherSeatMoveCancel: 'teacher-seat-move-cancel-button',
  // 台本 g(休日設定と解除・丸ごと振替): 日付の見出しを押して出るメニューのボタンと、丸ごと振替の振替先を選ぶ状態の帯(取り消し)・断りの画面(ScheduleBoardScreen.tsx)。
  dayHeaderMenuHoliday: 'day-header-menu-holiday', dayHeaderMenuTransfer: 'day-header-menu-transfer', dayHeaderMenuTransferRelease: 'day-header-menu-transfer-release',
  wholeDayTransferBanner: 'whole-day-transfer-banner', wholeDayTransferCancel: 'whole-day-transfer-cancel',
  wholeDayTransferBlockedModal: 'whole-day-transfer-blocked-modal', wholeDayTransferBlockedClose: 'whole-day-transfer-blocked-close-button',
}

/** testid の無い要素(class で待つ)。日付のメニュー(div.day-header-menu)とその外側(押すと閉じる)。selectors.test.mjs が className の字面を見張る。 */
export const CLASS_SELECTORS = { dayHeaderMenu: '.day-header-menu', dayHeaderMenuBackdrop: '.day-header-menu-backdrop' }

/** prop で渡して付く testid(ソースには data-testid="…" の字面で残らない・selectors.test.mjs が別に見張る)。選択の取り消し(AppMenu の actionButtonTestId)。 */
export const PROP_TESTIDS = { cancelSelection: 'cancel-selection-button' }

/** 虫眼鏡つきのプルダウン(SearchableSelect の testId の prop → <select> の data-testid)。台本 d が生徒・講師を選ぶ。 */
export const SEARCHABLE_SELECT_TESTIDS = { templateAddStudent: 'template-add-student-select', teacherSelect: 'teacher-select-input' }

// student-cell-{cellId}-{deskIndex}-{studentIndex}(BoardGrid.tsx)・week-jump-day-{dateKey}(BoardToolbar.tsx)
// makeup-stock-entry-{生徒キー__- の記号を - に}・stock-origin-item-{振替元の並び}(ScheduleBoardScreen.tsx の未消化振替の一覧)
// teacher-rest-{cellId}-{deskIndex}(BoardGrid.tsx の講師欄のグレーの「休」)・day-header-{dateKey}(BoardGrid.tsx の日付の見出し)
export const TESTID_PREFIXES = { studentCell: 'student-cell-', weekJumpDay: 'week-jump-day-', teacherCell: 'teacher-cell-', studentName: 'student-name-', makeupStockEntry: 'makeup-stock-entry-', stockOriginItem: 'stock-origin-item-', teacherRest: 'teacher-rest-', dayHeader: 'day-header-' }

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
export const dayHeaderTestId = (dateKey) => `${TESTID_PREFIXES.dayHeader}${dateKey}`
// 未消化振替の一覧の生徒の行: 行の鍵は `${生徒キー}__-`(生徒ごとにまとめた行・makeupStockEntries)、testid は英数字・_・- 以外を - に直す(アプリと同じ)。
export const makeupStockEntryTestId = (stockStudentKey) => `${TESTID_PREFIXES.makeupStockEntry}${`${stockStudentKey}__-`.replace(/[^a-zA-Z0-9_-]/g, '-')}`
export const byTestId = (testId) => `[data-testid="${testId}"]`
