// @vitest-environment jsdom
// 同日移動の写しの注意表示（A-12・オーナー決定 2026-11-01）は、オーナー決定 2026-11-05（決定記録 63・確認リスト tp-71/tp-72）で撤回した。
//  - 純関数: 旧データに印（templateCopyNotice）が残っていても注意は出さない（常に null）。
//  - 盤面（BoardGrid・react-dom/server の静的レンダリング）: 印の残った写しの席にも緑のクラス・帯・注意文は付かない。
//  - 盤面 PDF（stripTemplatePendingLowerForPdf・jsdom）: 旧版の HTML に緑のクラスと帯が残っていても外す（INV-13・画面専用）。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SlotCell, StudentEntry } from './types'
import {
  buildSameDayRegularSlotIndex,
  describeSameDayMoveCopyNotice,
  resolveSameDayMoveCopyNotice,
  SAME_DAY_MOVE_COPY_NOTE_CLASS,
  SAME_DAY_MOVE_COPY_NOTICE_CLASS,
} from './sameDayMoveCopyNotice'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))

const { BoardGrid } = await import('./BoardGrid')
const { stripTemplatePendingLowerForPdf } = await import('../../utils/pdf')

const DATE = '2026-10-07'
const SLOT3 = `${DATE}_3`
const SLOT5 = `${DATE}_5`

function student(id: string, overrides: Partial<StudentEntry> = {}): StudentEntry {
  return { id, name: '生徒A', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

const copyOfA = (overrides: Partial<StudentEntry> = {}) => student('a-copy', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '2026/10/7(水) 5限', ...overrides })

function cell(id: string, slotNumber: number, desks: SlotCell['desks']): SlotCell {
  return { id, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function desk(cellId: string, index: number, teacher: string, slots: [StudentEntry | null, StudentEntry | null] | null) {
  return { id: `${cellId}_desk_${index}`, teacher, ...(slots ? { lesson: { id: `l_${cellId}_${index}`, studentSlots: slots } } : {}) }
}

describe('純関数: 写しの注意（2026-11-05 に撤回）', () => {
  it('superseded の印が残っていても、同じ日の別のコマに同じ授業が生きていても、注意は出さない', () => {
    const copy = copyOfA({ templateCopyNotice: 'superseded' })
    const cells = [cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copy, null])]), cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-tpl'), null])])]
    expect(resolveSameDayMoveCopyNotice(copy, cells[0], buildSameDayRegularSlotIndex(cells))).toBeNull()
  })

  it('stale の印が残っていても注意は出さない。印が無い・写しでないものも null', () => {
    const index = buildSameDayRegularSlotIndex([])
    expect(resolveSameDayMoveCopyNotice(copyOfA({ templateCopyNotice: 'stale' }), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
    expect(resolveSameDayMoveCopyNotice(copyOfA(), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
    expect(resolveSameDayMoveCopyNotice(student('mk', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', templateCopyNotice: 'stale' }), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
  })
})

function renderGrid(cells: SlotCell[]) {
  return renderToStaticMarkup(createElement(BoardGrid, {
    cells,
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
  }))
}

describe('盤面の配線（BoardGrid）', () => {
  it('印の残った写し（superseded／stale）の席にも緑・帯・注意文は出ない', () => {
    const html = renderGrid([
      cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copyOfA({ templateCopyNotice: 'superseded' }), null])]),
      cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-tpl'), null])]),
    ])
    expect(html).toContain(`data-testid="student-cell-${SLOT3}-0-0"`)
    expect(html).not.toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(html).not.toContain(SAME_DAY_MOVE_COPY_NOTE_CLASS)
    expect(html).not.toContain('※5限にも')
    const stale = renderGrid([cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copyOfA({ templateCopyNotice: 'stale' }), null])])])
    expect(stale).not.toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(stale).not.toContain('※テンプレに無し')
    expect(stale).not.toContain(describeSameDayMoveCopyNotice('stale', []))
  })

  it('盤面 PDF の複製からは（旧版の HTML に残った）緑のクラスと帯を外す（INV-13・画面専用）。生徒名は残る', () => {
    const container = document.createElement('div')
    container.innerHTML = `<div class="sa-student ${SAME_DAY_MOVE_COPY_NOTICE_CLASS}"><span>生徒A</span><span class="${SAME_DAY_MOVE_COPY_NOTE_CLASS}">※5限にも</span></div>`
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTICE_CLASS}`)).toBeNull()
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTE_CLASS}`)).toBeNull()
    expect(container.textContent).toContain('生徒A')
    expect(container.textContent).not.toContain('※5限にも')
  })
})
