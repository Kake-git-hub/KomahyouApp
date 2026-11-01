// @vitest-environment jsdom
// 同日移動の写しの注意表示（A-12・オーナー決定 2026-11-01・spec-template-behavior §H Q36）の純関数と盤面の配線。
//  - 純関数: 印（templateCopyNotice）＋写しの判定＋同じ日の別のコマの通常授業の有無 → 注意（superseded は今も生きているときだけ・stale は印のまま）。
//  - 盤面（BoardGrid・react-dom/server の静的レンダリング）: 席に緑のクラスと注意の帯・ツールチップが付く。保留の下段とは別の印。
//  - 盤面 PDF（stripTemplatePendingLowerForPdf・jsdom）: 緑のクラスと帯を外す（INV-13・画面専用）。
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

describe('純関数: 写しの注意', () => {
  it('superseded の印: 同じ日の別のコマに同じ生徒×科目の通常授業が生きているときだけ注意を出し、時限を並べる', () => {
    const copy = copyOfA({ templateCopyNotice: 'superseded' })
    const cells = [cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copy, null])]), cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-tpl'), null])])]
    const index = buildSameDayRegularSlotIndex(cells)
    const notice = resolveSameDayMoveCopyNotice(copy, cells[0], index)
    expect(notice?.kind).toBe('superseded')
    expect(notice?.otherSlotNumbers).toEqual([5])
    expect(notice?.badge).toBe('※5限にも')
    expect(notice?.title).toBe('同じ日の別のコマ（5限）にもこの生徒の同じ授業がテンプレで組まれています。どちらかを片づけてください。')
    // 室長が 5 限の方を片づけた（居なくなった）→ 印が残っていても注意は出さない
    const cleaned = [cells[0], cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', null)])]
    expect(resolveSameDayMoveCopyNotice(copy, cells[0], buildSameDayRegularSlotIndex(cleaned))).toBeNull()
    // 5 限に居るのが同じ生徒の振替（通常授業でない）なら数えない
    const withMakeup = [cells[0], cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-mk', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null])])]
    expect(resolveSameDayMoveCopyNotice(copy, cells[0], buildSameDayRegularSlotIndex(withMakeup))).toBeNull()
    // 科目が違えば別の授業
    const otherSubject = [cells[0], cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-eng', { subject: '英' }), null])])]
    expect(resolveSameDayMoveCopyNotice(copy, cells[0], buildSameDayRegularSlotIndex(otherSubject))).toBeNull()
  })

  it('stale の印: 印のまま注意を出す。印が無い／写しでない（別の日へ動かした振替・手動追加）は null', () => {
    const index = buildSameDayRegularSlotIndex([])
    const stale = resolveSameDayMoveCopyNotice(copyOfA({ templateCopyNotice: 'stale' }), { id: SLOT3, dateKey: DATE }, index)
    expect(stale?.kind).toBe('stale')
    expect(stale?.badge).toBe('※テンプレに無し')
    expect(stale?.title).toBe(describeSameDayMoveCopyNotice('stale', []))
    expect(resolveSameDayMoveCopyNotice(copyOfA(), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
    expect(resolveSameDayMoveCopyNotice(student('mk', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', templateCopyNotice: 'stale' }), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
    expect(resolveSameDayMoveCopyNotice(copyOfA({ manualAdded: true, templateCopyNotice: 'stale' }), { id: SLOT3, dateKey: DATE }, index)).toBeNull()
    // 別の日の写し（印が残っていても、その日の写しでなければ出さない）
    expect(resolveSameDayMoveCopyNotice(copyOfA({ templateCopyNotice: 'stale' }), { id: '2026-10-08_3', dateKey: '2026-10-08' }, index)).toBeNull()
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
  const boardWithSuperseded = () => [
    cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copyOfA({ templateCopyNotice: 'superseded' }), null])]),
    cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', [student('a-tpl'), null])]),
  ]

  it('superseded の写しの席は緑（sa-student-copy-notice）になり、名前の行に帯「※5限にも」とツールチップの注意文が出る。テンプレ側（5 限）には付かない', () => {
    const html = renderGrid(boardWithSuperseded())
    expect(html).toMatch(new RegExp(`data-testid="student-cell-${SLOT3}-0-0"[^>]*`))
    const slot3Cell = html.slice(html.indexOf(`data-testid="student-cell-${SLOT3}-0-0"`) - 400, html.indexOf(`data-testid="student-cell-${SLOT3}-0-0"`))
    expect(slot3Cell).toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(html).toContain(`data-testid="student-copy-note-${SLOT3}-0-0"`)
    expect(html).toContain('※5限にも')
    expect(html).toContain('同じ日の別のコマ（5限）にもこの生徒の同じ授業がテンプレで組まれています。どちらかを片づけてください。')
    const slot5Start = html.indexOf(`data-testid="student-cell-${SLOT5}-0-0"`)
    expect(html.slice(slot5Start - 400, slot5Start)).not.toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(html).not.toContain(`data-testid="student-copy-note-${SLOT5}-0-0"`)
    // 保留ではない（下段・保留の緑は付かない）
    expect(html).not.toContain('sa-pending-lower')
  })

  it('5 限の方が片づけば緑も帯も消える（印は残っていても描画時に盤面から確かめる）。stale は印のまま帯「※テンプレに無し」', () => {
    const cleaned = renderGrid([cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copyOfA({ templateCopyNotice: 'superseded' }), null])]), cell(SLOT5, 5, [desk(SLOT5, 1, '鈴木', null)])])
    expect(cleaned).not.toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(cleaned).not.toContain(SAME_DAY_MOVE_COPY_NOTE_CLASS)
    const stale = renderGrid([cell(SLOT3, 3, [desk(SLOT3, 1, '田中', [copyOfA({ templateCopyNotice: 'stale' }), null])])])
    expect(stale).toContain(SAME_DAY_MOVE_COPY_NOTICE_CLASS)
    expect(stale).toContain('※テンプレに無し')
    expect(stale).toContain('テンプレではこの日のこの授業は無くなりました。残すか消すかを決めてください。')
  })

  it('盤面 PDF の複製からは緑のクラスと帯を外す（INV-13・画面専用）。生徒名は残る', () => {
    const container = document.createElement('div')
    container.innerHTML = renderGrid(boardWithSuperseded())
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTICE_CLASS}`)).not.toBeNull()
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTE_CLASS}`)).not.toBeNull()
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTICE_CLASS}`)).toBeNull()
    expect(container.querySelector(`.${SAME_DAY_MOVE_COPY_NOTE_CLASS}`)).toBeNull()
    expect(container.textContent).toContain('生徒A')
    expect(container.textContent).not.toContain('※5限にも')
  })
})
