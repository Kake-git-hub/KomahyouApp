// @vitest-environment jsdom
// テンプレ差分反映の保留（2 行）の盤面表示・解決操作の配線テスト（Issue #72・第 1 段 (B)・
// docs/spec-template-behavior.md §H Q26〜Q28・Q30・Q31）。
//
// 描画テスト環境の無い経路（ScheduleBoardScreen の中のハンドラ・ガード）は字面で固定し、
// 盤面の描画（BoardGrid）は react-dom/server の静的レンダリング、盤面 PDF の下段外しは jsdom で確かめる。
// ★機能フラグ templateDiffApply が OFF の教室では描画・メニュー・ハンドラが従来どおり（条件 26）であることも固定する。

import { readFileSync } from 'node:fs'
// jsdom 環境では global の URL が jsdom 版になり fileURLToPath が受け付けないため、node の URL を明示して使う。
import { fileURLToPath, URL as NodeURL } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SlotCell } from './types'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))

const { BoardGrid, fitStudentNameAndDetailTextForBoard } = await import('./BoardGrid')
const { stripTemplatePendingLowerForPdf } = await import('../../utils/pdf')

const BOARD_TSX = readFileSync(fileURLToPath(new NodeURL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
const TOOLBAR_TSX = readFileSync(fileURLToPath(new NodeURL('./BoardToolbar.tsx', import.meta.url)), 'utf8')
const PDF_TS = readFileSync(fileURLToPath(new NodeURL('../../utils/pdf.ts', import.meta.url)), 'utf8')

function sliceBody(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  expect(startIndex, start).toBeGreaterThanOrEqual(0)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(endIndex, end).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

const CELL_ID = '2026-10-07_5'

function boardCell(): SlotCell {
  return {
    id: CELL_ID,
    dateKey: '2026-10-07',
    dayLabel: '水',
    dateLabel: '10/7',
    slotLabel: '5限',
    slotNumber: 5,
    timeLabel: '',
    isOpenDay: true,
    desks: [
      { id: `${CELL_ID}_desk_1`, teacher: '鈴木', lesson: { id: 'managed_r0', studentSlots: [{ id: 'c1', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }, null] } },
      { id: `${CELL_ID}_desk_2`, teacher: '田中', lesson: { id: 'managed_r1', studentSlots: [{ id: 'b1', name: '馬場', managedStudentId: 'sB', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }, null] } },
    ],
  }
}

const PENDING: TemplatePendingDeskMap = {
  [buildTemplatePendingDeskKey(CELL_ID, `${CELL_ID}_desk_1`)]: {
    lower: {
      lesson: { id: 'l1', studentSlots: [{ id: 'm1', name: '三浦', managedStudentId: 'sM', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30' }, null] },
      memoSlots: [null, '持ち物'],
    },
    effectiveStartDate: '2026-10-07',
    createdAt: '2026-09-29T10:00:00.000Z',
  },
}

function renderGrid(templatePendingDesks?: TemplatePendingDeskMap) {
  return renderToStaticMarkup(createElement(BoardGrid, {
    cells: [boardCell()],
    selectedStudentId: null,
    highlightedCell: null,
    highlightedHolidayDate: null,
    yearLabel: '2026',
    specialPeriods: [],
    resolveStudentDisplayName: (name: string) => name,
    resolveStudentGradeLabel: (_name: string, grade: string) => grade,
    resolveDisplayedLessonType: (_name: string, _subject: string, lessonType) => lessonType,
    onDayHeaderClick: () => {},
    onTeacherClick: () => {},
    onStudentClick: () => {},
    templatePendingDesks,
    onTemplatePendingLowerClick: () => {},
  }))
}

describe('盤面の 2 行表示（Q24・Q30 第 1 段・条件 5 の「背景が緑」）', () => {
  it('保留の机は緑（sa-pending）になり、各席の下に下段（既存）を描き、帯「保留 n」を持つ', () => {
    const html = renderGrid(PENDING)
    expect(html).toContain(`data-testid="pending-lower-${CELL_ID}-0-0"`)
    expect(html).toContain(`data-testid="pending-lower-${CELL_ID}-0-1"`)
    expect(html).toContain('三浦')
    expect(html).toContain('振)')
    expect(html).toContain('持ち物')
    expect(html).toContain('保留 2')
    expect(html).toMatch(/class="sa-seat-number[^"]*sa-pending/)
    expect(html).toMatch(/class="sa-teacher[^"]*sa-pending/)
    // 保留でない机（机 2）には下段も緑も付かない
    expect(html).not.toContain(`pending-lower-${CELL_ID}-1-0`)
    // 下段は .sa-student-inner の外（盤面・PDF の文字サイズ合わせに混ざらない）
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelector('.sa-student-inner .sa-pending-lower')).toBeNull()
    expect(container.querySelectorAll('.sa-pending-lower')).toHaveLength(2)
  })

  it('保留マップを渡さない（フラグ OFF・テンプレ編集中）なら従来の 1 行表示のまま（緑も下段も無い）', () => {
    const html = renderGrid(undefined)
    expect(html).not.toContain('sa-pending')
    expect(html).not.toContain('三浦')
    expect(html).toBe(renderGrid({}))
  })

  // オーナー指示 2026-10-02（確認リスト v1.5.573 tp-19 要改善「生徒 1 のほうも 2 行の保留表示になっている。独立しているので…
  // 生徒 1 と生徒 2 の保留状態がリンクしてしまっている」・その他欄「通常同士なのに 2 行で保留となっているのがまだある」）:
  // 下段に中身の無い席は 2 行にせず、緑にもしない（テンプレがそのまま入った 1 行の席）。帯「保留 n」は下段のある席に付ける。
  describe('席ごとの保留表示（2026-10-02）', () => {
    const PENDING_SEAT2_ONLY: TemplatePendingDeskMap = {
      [buildTemplatePendingDeskKey(CELL_ID, `${CELL_ID}_desk_1`)]: {
        lower: { lesson: { id: 'l1', studentSlots: [null, { id: 'm1', name: '三浦', managedStudentId: 'sM', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30' }] } },
        effectiveStartDate: '2026-10-07',
        createdAt: '2026-09-29T10:00:00.000Z',
      },
    }

    it('下段が生徒 2 の席だけなら、生徒 1 の席は緑にならず下段も描かない（1 行のまま）。帯「保留 1」は生徒 2 の席に付く', () => {
      const html = renderGrid(PENDING_SEAT2_ONLY)
      const container = document.createElement('div')
      container.innerHTML = html
      const seat1 = container.querySelector(`[data-testid="student-cell-${CELL_ID}-0-0"]`)!
      const seat2 = container.querySelector(`[data-testid="student-cell-${CELL_ID}-0-1"]`)!
      expect(seat1.classList.contains('sa-pending')).toBe(false)
      expect(seat1.querySelector('.sa-pending-lower')).toBeNull()
      expect(seat2.classList.contains('sa-pending')).toBe(true)
      expect(seat2.querySelector('.sa-pending-lower')).not.toBeNull()
      expect(seat2.querySelector('.sa-pending-lower-band')?.textContent).toBe('保留 1')
      expect(container.querySelectorAll('.sa-pending-lower-band')).toHaveLength(1)
      // 机の番号・講師欄は机単位の印（講師は保留中は変更不可）のまま緑
      expect(html).toMatch(/class="sa-seat-number[^"]*sa-pending/)
      expect(html).toMatch(/class="sa-teacher[^"]*sa-pending/)
      // 保留の机の席には（下段の無い席も）上詰めの印 sa-pending-desk が付き、上段の高さが揃う
      expect(seat1.classList.contains('sa-pending-desk')).toBe(true)
      expect(seat2.classList.contains('sa-pending-desk')).toBe(true)
      // 保留でない机の席には付かない
      expect(container.querySelector(`[data-testid="student-cell-${CELL_ID}-1-0"]`)!.classList.contains('sa-pending-desk')).toBe(false)
    })

    it('下段は上段と同じ構造・同じクラス（名前行＋学年科目行・振)・学年・科目・振替元の日付）で描く', () => {
      const html = renderGrid(PENDING)
      const container = document.createElement('div')
      container.innerHTML = html
      const lower = container.querySelector(`[data-testid="pending-lower-${CELL_ID}-0-0"]`)!
      const inner = lower.querySelector('.sa-pending-lower-inner')!
      expect(inner.querySelector('.sa-student-name-row > .sa-student-name')?.textContent).toBe('三浦')
      expect(inner.querySelector('.sa-student-name-row > .sa-student-origin-date')?.textContent).toBe('9/30')
      expect(inner.querySelector('.sa-student-detail .sa-student-detail-prefix')?.textContent).toBe('振)')
      expect(inner.querySelector('.sa-student-detail .sa-student-detail-grade')?.textContent).toBe('中2')
      expect(inner.querySelector('.sa-student-detail .sa-student-detail-subject')?.textContent).toBe('数')
      // メモの下段は上段のメモと同じクラス
      const memoLower = container.querySelector(`[data-testid="pending-lower-${CELL_ID}-0-1"] .sa-pending-lower-inner .sa-student-name-note`)
      expect(memoLower?.textContent).toBe('持ち物')
      // 旧表示（10px の 1 行ラベル）は使わない
      expect(html).not.toContain('sa-pending-lower-detail')
    })

    it('盤面の文字サイズ合わせは、上段（.sa-student-inner）と同じ席の下段（.sa-pending-lower-inner）を揃える', () => {
      const GRID_TSX = readFileSync(fileURLToPath(new NodeURL('./BoardGrid.tsx', import.meta.url)), 'utf8')
      const fit = sliceBody(GRID_TSX, 'export function fitStudentNameAndDetailTextForBoard(root: HTMLElement) {', 'function fitMemoTextForBoard(')
      expect(fit).toContain("':scope > .sa-pending-lower .sa-pending-lower-inner'")
      expect(fit).toContain('Math.min(upperSize, lowerSize)')
    })

    // regression-reviewer 低-9（2026-10-02）: 振る舞いで固定する。jsdom は幅を測れないので、名前行の scrollWidth を「文字数 × 文字サイズ」、
    // clientWidth を固定 60px にして、はみ出しが文字サイズに依存するようにする（上段 1 席分の合わせ方は従来どおり・下段は上段と小さい方へ揃う）。
    it('文字サイズ合わせの振る舞い: 保留でない席は従来どおり、保留の席は上段と下段が小さい方に揃う', () => {
      const html = renderGrid({
        [buildTemplatePendingDeskKey(CELL_ID, `${CELL_ID}_desk_1`)]: {
          lower: { lesson: { id: 'l1', studentSlots: [{ id: 'm1', name: '三浦三浦三浦', managedStudentId: 'sM', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal' }, null] } },
          effectiveStartDate: '2026-10-07',
          createdAt: '2026-09-29T10:00:00.000Z',
        },
      })
      const root = document.createElement('div')
      root.innerHTML = html
      for (const row of Array.from(root.querySelectorAll<HTMLElement>('.sa-student-name-row'))) {
        const name = row.querySelector<HTMLElement>('.sa-student-name')!
        Object.defineProperty(row, 'clientWidth', { get: () => 60 })
        Object.defineProperty(row, 'scrollWidth', { get: () => (name.textContent?.length ?? 0) * parseFloat(name.style.fontSize || '13') })
      }
      fitStudentNameAndDetailTextForBoard(root)
      const nameOf = (testId: string) => root.querySelector<HTMLElement>(`[data-testid="${testId}"] .sa-student-inner .sa-student-name`)!
      const lowerName = root.querySelector<HTMLElement>(`[data-testid="pending-lower-${CELL_ID}-0-0"] .sa-student-name`)!
      // 保留でない机（机 2 の「馬場」）: 2 文字 × 19px = 38 ≤ 60 → 従来どおり最大の 19px
      expect(nameOf(`student-cell-${CELL_ID}-1-0`).style.fontSize).toBe('19px')
      // 保留の席: 上段「千葉」は 19px で収まるが、下段「三浦三浦三浦」は縮む → 上段も下段と同じ小さい方に揃う
      const lowerSize = parseFloat(lowerName.style.fontSize)
      expect(lowerSize).toBeLessThan(19)
      expect(lowerSize).toBeGreaterThanOrEqual(7)
      expect(nameOf(`student-cell-${CELL_ID}-0-0`).style.fontSize).toBe(lowerName.style.fontSize)
    })

    // regression-reviewer 低-6 → オーナー決定 2026-10-02「席単位にする」（Q34-12）。配線は「2 行の机の制限」の describe で固定。
  })
})

describe('盤面 PDF は上段だけを出す（INV-13・条件 23 の PDF 分）', () => {
  it('複製から下段（.sa-pending-lower）と保留の緑を外す。上段の生徒は残る', () => {
    const container = document.createElement('div')
    container.innerHTML = renderGrid(PENDING)
    expect(container.querySelector('.sa-pending-lower')).not.toBeNull()
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelector('.sa-pending-lower')).toBeNull()
    expect(container.querySelector('.sa-pending')).toBeNull()
    expect(container.querySelector('.sa-pending-desk')).toBeNull()
    expect(container.textContent).not.toContain('三浦')
    expect(container.textContent).not.toContain('持ち物')
    expect(container.textContent).toContain('千葉')
  })

  it('盤面 PDF の本体は複製の直後に下段を外す', () => {
    const body = sliceBody(PDF_TS, 'async function runBoardPdfExport(', 'if (grid && sourceGrid && sourceTable) {')
    expect(body).toContain('stripTemplatePendingLowerForPdf(clone)')
  })
})

describe('フラグ OFF では従来どおり（条件 26）', () => {
  it('盤面の 2 行表示・解決 UI の入口は activeTemplatePendingDesks（フラグ ON かつ保留あり）だけから出る', () => {
    expect(BOARD_TSX).toContain('const activeTemplatePendingDesks = templateDiffApplyEnabled && hasTemplatePendingDesks(templatePendingDesks) ? templatePendingDesks : null')
    expect(BOARD_TSX).toContain('templatePendingDesks={isTemplateMode ? undefined : (activeTemplatePendingDesks ?? undefined)}')
    const resolveAt = sliceBody(BOARD_TSX, 'const resolveTemplatePendingDeskAt = (', 'const templatePendingDeskMenuContext')
    expect(resolveAt).toContain('if (!activeTemplatePendingDesks) return null')
  })

  it('commitWeeks の 1 行戻し（Q28）はフラグ ON かつ保留ありのときだけ走る', () => {
    const commit = sliceBody(BOARD_TSX, 'const commitWeeks = (', 'const handleSelectDesk = (')
    expect(commit).toContain('if (templateDiffApplyEnabled && hasTemplatePendingDesks(nextTemplatePendingDesks)) {')
    expect(commit).toContain('settleTemplatePendingDesksAfterCommit({')
    // 履歴は操作前の盤面・保留マップ（createHistoryEntry の既定＝現在の state）を積む
    expect(commit).toContain('createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex')
    expect(commit).toContain('...buildTemplatePendingDesksPayload(nextTemplatePendingDesks),')
    expect(commit).toContain('}, { userInitiated: true })')
    expect(commit).toContain('committedBoardChangeVersionRef.current += 1')
  })
})

describe('解決操作は 1 操作 1 適用で commitWeeks を通る（Q26-6・INV-03・条件 20）', () => {
  it('採用ボタン・下段の削除は computePendingDeskResolution の結果を commitWeeks へ 1 回だけ渡す（保留マップも）', () => {
    const body = sliceBody(BOARD_TSX, 'const handleResolveTemplatePendingDesk = (', 'const handleStartTemplatePendingLowerMove = (')
    expect(body).toContain('computePendingDeskResolution({')
    expect(body.match(/commitWeeks\(/g)).toHaveLength(1)
    expect(body).toContain('result.nextTemplatePendingDesks,')
    expect(body).toContain('result.ledgers.scheduleCountAdjustments,')
    expect(body).toContain("if (result.status === 'blocked') {")
  })

  it('下段の移動は computePendingLowerStudentMove の結果を commitWeeks へ 1 回だけ渡す', () => {
    const body = sliceBody(BOARD_TSX, 'const executeTemplatePendingLowerMove = (', 'const handleStudentClick = (')
    expect(body).toContain('computePendingLowerStudentMove({')
    expect(body.match(/commitWeeks\(/g)).toHaveLength(1)
    expect(body).toContain('result.nextTemplatePendingDesks,')
  })
})

describe('2 行の机の制限（Q26-2・Q26-5・Q27・Q31・条件 18・28）', () => {
  it('上段のメニューは休み・振無休・移動・削除だけ（出席・編集・ストックへ戻すは出さない）', () => {
    const menu = sliceBody(BOARD_TSX, 'data-testid="template-pending-upper-menu"', ") : studentMenu?.mode === 'root' ? (")
    expect(menu).toContain('menu-absence-button')
    expect(menu).toContain('menu-absence-no-makeup-button')
    expect(menu).toContain('menu-move-button')
    expect(menu).toContain('menu-delete-button')
    expect(menu).not.toContain('menu-attendance-button')
    expect(menu).not.toContain('menu-edit-button')
    expect(menu).not.toContain('menu-stock-button')
  })

  it('出席の付与は 2 行の机で止まる（メニュー以外の経路からも）', () => {
    const body = sliceBody(BOARD_TSX, 'const handleMarkStudentAttended = () => {', 'const attendedStatusEntry')
    expect(body).toContain('TEMPLATE_PENDING_MESSAGES.attendBlocked')
  })

  it('講師メニュー・講師 D&D（掴む・離す）は 2 行の机で効かない', () => {
    const select = sliceBody(BOARD_TSX, 'const handleSelectDesk = (', 'const handleConfirmTeacher = () => {')
    expect(select).toContain('TEMPLATE_PENDING_MESSAGES.teacherLocked')
    const teacherDrag = sliceBody(BOARD_TSX, 'const handleTeacherMouseDown = (', 'const executePendingTeacherMove = (')
    expect(teacherDrag.match(/resolveTemplatePendingDeskAt\(/g)).toHaveLength(2)
  })

  it('他の机からの生徒の移動・D&D・日程表 D&D・在庫からの配置は 2 行の机に着地しない', () => {
    const move = sliceBody(BOARD_TSX, 'const executeMoveStudent = (', 'const stableExecuteMoveStudent')
    expect(move).toContain('resolveTemplatePendingLandingBlock(')
    const scheduleMove = sliceBody(BOARD_TSX, 'const executeScheduleViewMove = (', 'const sourceHit = findScheduleViewMoveSource(')
    expect(scheduleMove).toContain('resolveTemplatePendingLandingBlock(activeTemplatePendingDesks, availabilityCell, resolvedSeat.deskIndex, null, resolvedSeat.studentIndex)')
    const click = sliceBody(BOARD_TSX, 'const handleStudentClick = (', 'if (hasStudent) {')
    expect(click).toContain('TEMPLATE_PENDING_MESSAGES.landingBlocked')
    expect(click).toContain('openTemplatePendingDeskMenu(cellId, deskIndex, x, y, studentIndex)')
  })

  // オーナー決定 2026-10-02「席単位にする」（Q34-12）: 保留の制限（出席・空席クリック→保留メニュー・着地不可・上段メニューの制限）は
  // 保留に関わる席（下段がある席・上段の生徒が下段と同じ生徒の席）だけ。講師ロックは机単位のまま。
  it('出席・空席クリック・移動/D&D/日程表 D&D/在庫からの配置・上段メニューの制限は席ごと（resolveTemplatePendingSeatAt / isTemplatePendingSeatLinked）', () => {
    const seatAt = sliceBody(BOARD_TSX, 'const resolveTemplatePendingSeatAt = (', 'const templatePendingDeskMenuContext')
    expect(seatAt).toContain('isTemplatePendingSeatLinked(desk, found.entry.lower, seatIndex)')
    const attend = sliceBody(BOARD_TSX, 'const handleMarkStudentAttended = () => {', 'const attendedStatusEntry')
    expect(attend).toContain('resolveTemplatePendingSeatAt(studentMenu.cellId, studentMenu.deskIndex, studentMenu.studentIndex)')
    const click = sliceBody(BOARD_TSX, 'const handleStudentClick = (', 'if (hasStudent) {')
    expect(click).toContain('resolveTemplatePendingSeatAt(cellId, deskIndex, studentIndex)')
    expect(click).not.toContain('resolveTemplatePendingDeskAt(cellId, deskIndex))')
    const move = sliceBody(BOARD_TSX, 'const executeMoveStudent = (', 'const stableExecuteMoveStudent')
    expect(move).toContain('sourceCell && sourceDesk ? buildTemplatePendingDeskKey(sourceCell.id, sourceDesk.id) : null,\n        studentIndex,')
    const lowerMove = sliceBody(BOARD_TSX, 'export function computePendingLowerStudentMove(', 'const result = computeStudentMove({')
    expect(lowerMove).toContain('resolveTemplatePendingLandingBlock(params.templatePendingDesks, targetViewCell, params.deskIndex, null, params.studentIndex)')
    const menuFlag = sliceBody(BOARD_TSX, 'const menuStudentOnTemplatePendingDesk = ', 'const emptyMenuVariant = ')
    expect(menuFlag).toContain('isTemplatePendingSeatLinked(menuStudent.desk, found.entry.lower, studentMenu.studentIndex)')
    // 講師ロックは机単位のまま
    const select = sliceBody(BOARD_TSX, 'const handleSelectDesk = (', 'const handleConfirmTeacher = () => {')
    expect(select).toContain('resolveTemplatePendingDeskAt(cellId, deskIndex)')
  })

  // 確認リスト v1.5.576 その他欄「このメニューがわかりにくい。まず選択肢として テンプレ授業を採用／手入力データを採用／手入力データを削除／手入力データを移動 だけを表示して」
  it('保留の席のメニューは 4 択だけ（上段・下段の一覧と説明文は出さない）。押した席の下段（lowerIndex）が対象', () => {
    const menu = sliceBody(BOARD_TSX, 'data-testid="template-pending-desk-menu"', '{wholeDayTransferSourceDate && !isTemplateMode ? (')
    for (const label of ['テンプレ授業を採用', '手入力データを採用', '手入力データを削除', '手入力データを移動']) expect(menu).toContain(label)
    expect(menu).not.toContain('template-pending-lower-items')
    expect(menu).not.toContain('上段（実配置')
    expect(menu).not.toContain('元に戻す」で戻せます')
    expect(menu).toContain('const index = templatePendingDeskMenu.lowerIndex')
    expect(menu).toContain("handleResolveTemplatePendingDesk('delete-lower-student', index)")
    expect(menu).toContain('handleStartTemplatePendingLowerMove(index)')
    // 下段を押した席がメニューの対象（帯・下段のクリックは lowerIndex を渡す）
    const lowerClick = sliceBody(BOARD_TSX, 'const handleTemplatePendingLowerClick = (', 'const buildTemplatePendingLedgers = ')
    expect(lowerClick).toContain('openTemplatePendingDeskMenu(cellId, deskIndex, x, y, lowerIndex)')
  })

  // オーナー指示 2026-10-02: テンプレ編集画面の見出し行（題名・反映開始日・机数）とボタン行を 1 行に。反映開始日はエクセル取込の右・机数は出さない。
  it('テンプレ編集の反映開始日はツールバーのボタン行（エクセル取込の右）にあり、見出し行と机数は出ない', () => {
    expect(BOARD_TSX).not.toContain('template-mode-header-bar')
    expect(BOARD_TSX).not.toContain('机数 {classroomSettings.deskCount}')
    expect(BOARD_TSX).toContain('templateEffectiveStartDate={isTemplateMode ? templateEffectiveStartDate : undefined}')
    expect(BOARD_TSX).toContain('onTemplateEffectiveStartDateChange={setTemplateEffectiveStartDate}')
    const importIndex = TOOLBAR_TSX.indexOf('data-testid="template-import-button"')
    const dateIndex = TOOLBAR_TSX.indexOf('data-testid="template-effective-start-date"')
    const saveIndex = TOOLBAR_TSX.indexOf('data-testid="template-save-overwrite-button"')
    expect(importIndex).toBeGreaterThan(0)
    expect(dateIndex).toBeGreaterThan(importIndex)
    expect(saveIndex).toBeGreaterThan(dateIndex)
    expect(TOOLBAR_TSX).not.toContain('selection-pill">机数')
  })

  it('テンプレ差分反映の保存は Q35 で置かなかった生徒の希望回数 −1 を単発削除と同じ関数で積み、publish にも載せる（Q35-8）', () => {
    const save = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(save).toContain('for (const target of plan.diff.wholeDayTransferCountAdjustments) {')
    expect(save).toContain('resolveDeletedStudentCountAccounting(nextScheduleCountAdjustments, target.student, target.dateKey).nextAdjustments')
    expect(save).toContain('setScheduleCountAdjustments(cloneScheduleCountAdjustments(nextScheduleCountAdjustments))')
    expect(save).toContain('scheduleCountAdjustments: cloneScheduleCountAdjustments(nextScheduleCountAdjustments),')
  })

  it('保留がある日の休日設定・生徒を空にする・丸ごと振替（振替元・振替先）は止まる', () => {
    expect(sliceBody(BOARD_TSX, 'const handleToggleHolidayDate = (', 'if (isForceOpen) {')).toContain("resolveTemplatePendingDateBlockReason(activeTemplatePendingDesks, weeks, dateKey, '休日設定')")
    expect(sliceBody(BOARD_TSX, 'const handleClearStudentsOnDate = (', 'const confirmed = window.confirm(')).toContain("resolveTemplatePendingDateBlockReason(activeTemplatePendingDesks, weeks, dateKey, '生徒を空にする')")
    const transfer = sliceBody(BOARD_TSX, 'const handleWholeDayTransferTargetClick = (', 'const result = computeWholeDayTransfer({')
    expect(transfer).toContain("resolveTemplatePendingDateBlockReason(activeTemplatePendingDesks, weeks, sourceDateKey, '丸ごと振替')")
    expect(transfer).toContain("resolveTemplatePendingDateBlockReason(activeTemplatePendingDesks, weeks, targetDateKey, '丸ごと振替')")
    expect(sliceBody(BOARD_TSX, 'data-testid="day-header-menu-transfer"', '>丸ごと振替</button>')).toContain("resolveTemplatePendingDateBlockReason(activeTemplatePendingDesks, weeks, dk, '丸ごと振替')")
  })
})

describe('ツールバーのバッジ（条件 27）', () => {
  it('件数は countTemplatePendingDesksOnBoard（フラグ ON の保留マップ）から渡し、0 なら出さない', () => {
    expect(BOARD_TSX).toContain('const templatePendingDeskCount = useMemo(() => countTemplatePendingDesksOnBoard(activeTemplatePendingDesks, weeks), [activeTemplatePendingDesks, weeks])')
    expect(BOARD_TSX).toContain('templatePendingDeskCount={templatePendingDeskCount}')
    expect(TOOLBAR_TSX).toContain('{templatePendingDeskCount && templatePendingDeskCount > 0 ? (')
    expect(TOOLBAR_TSX).toContain('data-testid="board-template-pending-badge"')
  })
})
