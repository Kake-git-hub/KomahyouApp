// tools/ui-patrol/selectors.mjs(台本が頼る testid と長押しの長さ)を固定する。
// 画面の巡回はブラウザで流すので毎 push の CI では動かない。testid の名前が変わったら巡回が黙って空振りしないよう、
// ソースに字面で残っていることをここ(毎 push のユニットテスト)で確かめる。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CLASS_SELECTORS, DRIVER_TIMING, SEARCHABLE_SELECT_TESTIDS, SOURCE_FILES_WITH_TESTIDS, TESTIDS, TESTID_PREFIXES, PROP_TESTIDS, dayHeaderTestId, lectureStockEntryTestId, makeupStockEntryTestId, studentCellTestId, studentNameTestId, teacherCellTestId, weekJumpDayTestId } from './selectors.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

function readSources() {
  // App.tsx は CRLF のことがあるので改行を直してから読む。
  return SOURCE_FILES_WITH_TESTIDS.map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n')).join('\n')
}

describe('selectors', () => {
  it('台本が頼る testid は、アプリのソースに字面で存在する(名前が変わったら毎 push のテストで気づく)', () => {
    const source = readSources()
    const missing = Object.entries(TESTIDS).filter(([, value]) => !source.includes(`data-testid="${value}"`)).map(([key, value]) => `${key}=${value}`)
    expect(missing).toEqual([])
    const missingPrefixes = Object.entries(TESTID_PREFIXES).filter(([, value]) => !source.includes(`data-testid={\`${value}`)).map(([key, value]) => `${key}=${value}`)
    expect(missingPrefixes).toEqual([])
    // 虫眼鏡つきのプルダウン(SearchableSelect)は testId の prop で <select> に data-testid を付ける(台本 d が生徒・講師を選ぶ)。
    const missingSelects = Object.entries(SEARCHABLE_SELECT_TESTIDS).filter(([, value]) => !source.includes(`testId="${value}"`)).map(([key, value]) => `${key}=${value}`)
    expect(missingSelects).toEqual([])
    const select = readFileSync(path.join(REPO_ROOT, 'src/components/common/SearchableSelect.tsx'), 'utf8')
    expect(select).toContain('data-testid={testId}')
  })

  it('台本 d(テンプレを変えて保存)が使う講師欄・生徒名の testid の並びがアプリと同じ', () => {
    const grid = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardGrid.tsx'), 'utf8')
    expect(grid).toMatch(/data-testid=\{`teacher-cell-\$\{cell\.id\}-\$\{deskIndex\}`\}/)
    expect(grid).toMatch(/data-testid=\{`student-name-\$\{cell\.id\}-\$\{deskIndex\}-\$\{studentIndex\}`\}/)
    expect(teacherCellTestId({ cellId: 'template_2_1', deskIndex: 3 })).toBe('teacher-cell-template_2_1-3')
    expect(studentNameTestId({ cellId: 'template_2_1', deskIndex: 3, seat: 1 })).toBe('student-name-template_2_1-3-1')
  })

  it('接頭辞の後ろの並び(席は {cellId}-{deskIndex}-{studentIndex}・週の日は {dateKey})がアプリのテンプレート文字列と同じ', () => {
    const grid = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardGrid.tsx'), 'utf8')
    expect(grid).toMatch(/data-testid=\{`student-cell-\$\{cell\.id\}-\$\{deskIndex\}-\$\{studentIndex\}`\}/)
    // 同じ要素に data-cell-id / data-desk-index / data-student-index もある(放した位置の席の引き方・handleStudentMouseDown)
    expect(grid).toMatch(/data-cell-id=\{cell\.id\}/)
    expect(studentCellTestId({ cellId: '2026-11-17_3', deskIndex: 2, seat: 1 })).toBe('student-cell-2026-11-17_3-2-1')
    const toolbar = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardToolbar.tsx'), 'utf8')
    expect(toolbar).toMatch(/data-testid=\{`week-jump-day-\$\{cell\.dateKey\}`\}/)
    expect(weekJumpDayTestId('2026-11-16')).toBe('week-jump-day-2026-11-16')
  })

  it('台本 e(出欠)が使う 生徒メニューの出欠ボタン・未消化振替の一覧の testid がアプリと同じ(一覧の行は 生徒キー__- を記号だけ - に直した名前)', () => {
    for (const name of ['menuAttendance', 'menuAbsence', 'menuAbsenceNoMakeup', 'makeupStockChip', 'makeupStockPanel', 'makeupStockClose', 'stockActionModal', 'stockActionModalCancel']) expect(TESTIDS[name]).toBeTruthy()
    for (const name of ['makeupStockEntry', 'stockOriginItem']) expect(TESTID_PREFIXES[name]).toBeTruthy()
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    expect(screen).toContain("data-testid={`makeup-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}")
    expect(screen).toContain('key: `${stockStudentKey}__-`')
    expect(screen).toContain('data-testid={`stock-origin-item-${index}`}')
    expect(makeupStockEntryTestId('s091')).toBe('makeup-stock-entry-s091__-')
    expect(makeupStockEntryTestId('name:生徒A')).toBe('makeup-stock-entry-name---A__-')
    // 置けなかったときに選択を取り消すボタン(AppMenu の actionButtonTestId の prop で付く)
    const toolbar = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardToolbar.tsx'), 'utf8')
    expect(toolbar).toContain(`actionButtonTestId={hasSelectedStudent ? '${PROP_TESTIDS.cancelSelection}'`)
  })

  it('台本 f(講師の移動・入れ替え・休み)が使う 講師メニューの休みのボタン・講師の入れ替えの選択の testid と、講師欄の着地の目印がアプリと同じ', () => {
    for (const name of ['teacherRestButton', 'teacherSeatMoveModal', 'teacherSeatMoveTeacher', 'teacherSeatMoveSeat', 'teacherSeatMoveCancel']) expect(TESTIDS[name]).toBeTruthy()
    expect(TESTID_PREFIXES.teacherRest).toBe('teacher-rest-')
    const grid = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardGrid.tsx'), 'utf8')
    expect(grid).toContain('data-testid={`teacher-rest-${cell.id}-${deskIndex}`}')
    // 講師を放した位置の机の引き方(handleTeacherMouseDown の closest('.sa-teacher[data-cell-id]'))と、講師欄の td の印
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    expect(screen).toContain(".closest<HTMLElement>('.sa-teacher[data-cell-id]')")
    expect(grid).toMatch(/'sa-teacher',\n/)
    expect(grid).toContain('data-desk-index={deskIndex}')
  })

  it('台本 g(休日設定と解除・丸ごと振替)が使う 日付の見出し・日付のメニューのボタン・丸ごと振替の選ぶ状態と断りの画面の testid がアプリと同じ', () => {
    for (const name of ['dayHeaderMenuHoliday', 'dayHeaderMenuTransfer', 'dayHeaderMenuTransferRelease', 'wholeDayTransferBanner', 'wholeDayTransferCancel', 'wholeDayTransferBlockedModal', 'wholeDayTransferBlockedClose']) expect(TESTIDS[name]).toBeTruthy()
    const grid = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/BoardGrid.tsx'), 'utf8')
    expect(grid).toContain('data-testid={`day-header-${day.dateKey}`}')
    expect(grid).toContain('onClick={(e) => onDayHeaderClick(day.dateKey, e.clientX, e.clientY)}')
    expect(dayHeaderTestId('2026-11-19')).toBe('day-header-2026-11-19')
    // メニューの外を押すと閉じる(押す場所は左上の隅)・休日の見出しはメニューを出さずに解除する(handleDayHeaderClick)
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    expect(screen).toContain('<div className="day-header-menu-backdrop" onClick={() => setDayHeaderMenu(null)}>')
    // メニューそのものに testid は無いので class で待つ(CLASS_SELECTORS)
    expect(screen).toContain('className="day-header-menu"')
    expect(CLASS_SELECTORS.dayHeaderMenu).toBe('.day-header-menu')
    expect(CLASS_SELECTORS.dayHeaderMenuBackdrop).toBe('.day-header-menu-backdrop')
    expect(screen).toContain('if (isHoliday || isForceOpen || isClosedWeekday) {\n      handleToggleHolidayDate(dateKey)')
  })

  it('台本 h(講習の自動割振)が使う 未消化講習の一覧・生徒の行・自動割振の画面(振替も同時に・自動割振のボタン)・結果の画面の testid がアプリと同じ', () => {
    for (const name of ['lectureStockChip', 'lectureStockPanel', 'lectureStockClose', 'stockActionModalIncludeMakeup', 'stockActionModalAuto', 'autoAssignDebugPanel', 'autoAssignDebugClose']) expect(TESTIDS[name]).toBeTruthy()
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    // 一覧の行は 未消化講習の行の鍵(生徒キー__講習 ID)の記号だけ - に直した名前・押すと自動割振の画面(stock-action-modal)が開く
    expect(screen).toContain("data-testid={`lecture-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}")
    expect(screen).toContain("onClick={() => setStockActionModal({ type: 'lecture', entryKey: entry.key })}")
    expect(lectureStockEntryTestId('s091__session_abc')).toBe('lecture-stock-entry-s091__session_abc')
    expect(lectureStockEntryTestId('name:生徒A__-')).toBe('lecture-stock-entry-name---A__-')
    // 「未消化振替も同時に自動割り当てする」は label の中の checkbox(label に testid)
    expect(screen).toContain('<label className="auto-assign-include-makeup" data-testid="stock-action-modal-include-makeup">')
    // 自動割振は、割り振れたときも割り振れなかったときも結果の画面を出す(待ちの目印)
    expect(screen.split('setAutoAssignDebugReport(').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('長押しの長さと取り消しの距離がアプリと合っている', () => {
    // 変わったら driver の待ち(DRIVER_TIMING)を見直す合図。
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    expect(screen).toContain('DRAG_LONG_PRESS_MS = 250')
    expect(screen).toContain('PRE_ARM_CANCEL_PX = 8')
    expect(DRIVER_TIMING.longPressMs).toBeGreaterThan(250)
    expect(DRIVER_TIMING.dragSteps).toBeGreaterThan(1)
  })
})
