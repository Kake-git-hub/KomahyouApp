// @vitest-environment jsdom
// 講師の休み（docs/spec-template-conflict-v2.md §2-4・§5・段 3）の盤面表示・PDF・メニューの配線テスト。
// 盤面の描画（BoardGrid）は react-dom/server の静的レンダリング、盤面 PDF の外しは jsdom、ScheduleBoardScreen の中のメニューは字面で固定する。

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { DeskCell, SlotCell } from './types'
import { TEACHER_REST_CELL_CLASS, TEACHER_REST_LABEL_CLASS } from './teacherRest'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))

const { BoardGrid } = await import('./BoardGrid')
const { stripTemplatePendingLowerForPdf } = await import('../../utils/pdf')

const BOARD_TSX = readFileSync(fileURLToPath(new NodeURL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
const DESK_TEACHER_ASSIGNMENT_TS = readFileSync(fileURLToPath(new NodeURL('./deskTeacherAssignment.ts', import.meta.url)), 'utf8')

const CELL_ID = '2026-10-07_5'
function boardCell(desk0: Partial<DeskCell>): SlotCell {
  return {
    id: CELL_ID, dateKey: '2026-10-07', dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [
      { id: `${CELL_ID}_desk_1`, teacher: '', lesson: { id: 'managed_r0', studentSlots: [{ id: 'c1', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }, null] }, ...desk0 },
      { id: `${CELL_ID}_desk_2`, teacher: '鈴木' },
    ],
  }
}
function render(cell: SlotCell, showTeacherRest: boolean) {
  return renderToStaticMarkup(createElement(BoardGrid, {
    cells: [cell], selectedStudentId: null, highlightedCell: null, highlightedHolidayDate: null, yearLabel: '2026', specialPeriods: [],
    resolveStudentDisplayName: (name: string) => name, resolveStudentGradeLabel: (_name: string, grade: string) => grade,
    resolveDisplayedLessonType: (_name: string, _subject: string, lessonType) => lessonType,
    onDayHeaderClick: () => {}, onTeacherClick: () => {}, onStudentClick: () => {}, showTeacherRest,
  }))
}
const REST = { teacher: '田中', teacherId: 't1' }

describe('3-1・§5 休みの机はグレーの「休」＋講師名（コマ表の画面だけ）', () => {
  it('講師なしの休みの机: 講師欄がグレー（sa-teacher-rest）で「休 田中」。生徒は残る', () => {
    const html = render(boardCell({ teacherRest: REST }), true)
    expect(html).toContain(TEACHER_REST_CELL_CLASS)
    expect(html).toContain(`data-testid="teacher-rest-${CELL_ID}-0"`)
    expect(html).toContain('休 田中')
    expect(html).toContain('千葉')
  })
  it('別の講師を手で置いた机は通常の表示（グレーも「休」も出さない・記録は残っている）', () => {
    const html = render(boardCell({ teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: REST }), true)
    expect(html).not.toContain(TEACHER_REST_CELL_CLASS)
    expect(html).not.toContain('休 田中')
    expect(html).toContain('高橋')
  })
  it('フラグ OFF の教室・テンプレ編集（showTeacherRest=false）は出さない', () => {
    const html = render(boardCell({ teacherRest: REST }), false)
    expect(html).not.toContain(TEACHER_REST_CELL_CLASS)
    expect(html).not.toContain('休 田中')
  })
  it('盤面 PDF の複製からはグレーと「休 田中」を外す（講師なしの机として出る）。生徒は残る', () => {
    const container = document.createElement('div')
    container.innerHTML = render(boardCell({ teacherRest: REST }), true)
    expect(container.querySelector(`.${TEACHER_REST_LABEL_CLASS}`)).not.toBeNull()
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelector(`.${TEACHER_REST_LABEL_CLASS}`)).toBeNull()
    expect(container.querySelector(`.${TEACHER_REST_CELL_CLASS}`)).toBeNull()
    expect(container.textContent).not.toContain('田中')
    expect(container.textContent).toContain('千葉')
  })
})

describe('3-1・3-5 講師欄のメニューの「休み」ボタン（ScheduleBoardScreen の字面）', () => {
  const menu = BOARD_TSX.slice(BOARD_TSX.indexOf('data-testid="teacher-action-menu"'), BOARD_TSX.indexOf('{groupClassMenu ? ('))
  it('ボタンはフラグ templateDiffApply の教室のコマ表（テンプレ編集ではない）だけ。講師が居るか休みの机で出し、休みの机は「休みを解除する」', () => {
    expect(menu).toContain('data-testid="teacher-rest-button"')
    expect(menu).toContain('!isTemplateMode && templateDiffApplyEnabled && teacherMenuContext && (teacherMenuContext.desk.teacher.trim() || hasDeskTeacherRest(teacherMenuContext.desk))')
    expect(menu).toContain('休みを解除する')
    expect(menu).toContain("'休み'")
  })
  it('一括（この日全部）のボタンは無い。ハンドラは 1 机だけを切り替え、削除記録（applyUserDeletedTeacherTombstone）を使わない', () => {
    expect(menu).not.toMatch(/この日(全部|すべて)/)
    const handler = BOARD_TSX.slice(BOARD_TSX.indexOf('const handleToggleTeacherRest = () => {'), BOARD_TSX.indexOf('const handleDeleteTeacher = () => {'))
    expect(handler).toContain('computeToggleDeskTeacherRest({')
    expect(handler).toContain('deskIndex: currentTeacherMenu.deskIndex')
    expect(handler).toContain('!templateDiffApplyEnabled')
    expect(handler).not.toContain('applyUserDeletedTeacherTombstone')
    expect(handler).not.toContain('recordOperationEvent')
  })
  it('盤面へ渡す表示の指定はフラグ ON のコマ表だけ', () => {
    expect(BOARD_TSX).toContain('showTeacherRest={!isTemplateMode && templateDiffApplyEnabled}')
  })
})

describe('§9-19 講師メニューの「保存」（手で置く経路）: 休んだ講師本人を置くと休みを解除する', () => {
  it('講師メニューの保存が通る setManualTeacherAssignment が releaseTeacherRestIfSameTeacherPlaced を呼ぶ。D&D（computeTeacherMove）も同じ', () => {
    // 2026-11-06: 書き込みは deskTeacherAssignment.ts へ切り出した（確認リストの「準備する」と共有）。盤面はそれを import して呼ぶ。
    // 出自（manual / manual-replaced）の決め方も同じファイルの resolveManualTeacherAssignmentSource を通す（regression-reviewer 権威関数の一本化）。
    expect(BOARD_TSX).toContain("import { resolveManualTeacherAssignmentSource, setManualTeacherAssignment } from './deskTeacherAssignment'")
    expect(BOARD_TSX).not.toContain('function setManualTeacherAssignment(')
    const setter = DESK_TEACHER_ASSIGNMENT_TS.slice(DESK_TEACHER_ASSIGNMENT_TS.indexOf('export function setManualTeacherAssignment('), DESK_TEACHER_ASSIGNMENT_TS.indexOf('export function resolveManualTeacherAssignmentSource('))
    // 監査 要確認-6: 呼び名の対応表（buildTeacherAliasResolver）を通す（D&D と同じ）。
    expect(setter).toContain('releaseTeacherRestIfSameTeacherPlaced(desk, teacherAliases)')
    expect(BOARD_TSX).toContain('setManualTeacherAssignment(targetDesk, currentTeacherMenu.selectedTeacherName, selectedTeacher?.id, teacherAssignmentSource, buildTeacherAliasResolver(teachers))')
    const confirm = BOARD_TSX.slice(BOARD_TSX.indexOf('const handleConfirmTeacher = () => {'), BOARD_TSX.indexOf('const handleToggleTeacherRest = () => {'))
    expect(confirm).toContain('setManualTeacherAssignment(targetDesk')
    const move = BOARD_TSX.slice(BOARD_TSX.indexOf('export function computeTeacherMove('), BOARD_TSX.indexOf('export type WholeDayTransferSummary'))
    expect(move).toContain('releaseTeacherRestIfSameTeacherPlaced(targetDesk, restAliases)')
    // 自動配置（QR の講師・再マージ）の経路では呼ばない
    const qr = BOARD_TSX.slice(BOARD_TSX.indexOf('function setScheduleRegistrationTeacherAssignment('), BOARD_TSX.indexOf('function setScheduleRegistrationTeacherAssignment(') + 400)
    expect(qr).not.toContain('releaseTeacherRestIfSameTeacherPlaced')
  })
})
