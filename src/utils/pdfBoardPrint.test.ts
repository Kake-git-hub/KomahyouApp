// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotCell } from '../components/schedule-board/types'

// html2canvas / jsPDF は実際のキャンバス描画・PDF生成を行うため、DOMを見るだけのテストでは
// スタブに差し替える(item 2/3 用)。トップレベルで mock を宣言し、対象モジュールは動的 import で
// mock 適用後に読み込む(vi.mock は hoisted されるが、captured* の参照を後から差し替えるため関数経由にする)。
const html2canvasMock = vi.fn(async (element: HTMLElement, _options?: { scale: number }) => {
  return {
    width: 100,
    height: 100,
    toDataURL: () => 'data:image/png;base64,',
    __capturedElement: element,
  } as unknown as HTMLCanvasElement
})

vi.mock('html2canvas', () => ({
  default: function html2canvasStub(...args: Parameters<typeof html2canvasMock>) {
    return html2canvasMock(...args)
  },
}))

class JsPdfStub {
  internal = { pageSize: { getWidth: () => 297, getHeight: () => 420 } }
  addImage = vi.fn()
  addPage = vi.fn()
  save = vi.fn()
}

vi.mock('jspdf', () => ({
  default: JsPdfStub,
}))

const {
  pruneBoardTableForSelection,
  exportBoardPdfSelection,
} = await import('./pdf')
const {
  boardPrintCellKey,
  buildBoardPrintGrid,
  createInitialBoardPrintChecked,
  resolveBoardPrintSelection,
} = await import('./boardPrintSelection')

// BoardGrid.tsx と同じクラス構造・data 属性の合成テーブルを作る。
// (thead: 特別講習帯行 / 曜日ヘッダー colSpan=4 / 席・講師・生徒・生徒 の小見出し,
//  tbody: 集団行 + 時限 × 机行。時限ラベルは rowSpan=机数)
const DAYS = [
  { dateKey: '2026-09-14', isOpenDay: true },
  { dateKey: '2026-09-15', isOpenDay: false },
  { dateKey: '2026-09-16', isOpenDay: true },
  { dateKey: '2026-09-17', isOpenDay: true },
]
const SLOTS = [1, 2, 3]
const DESK_COUNT = 2

function buildCells(): SlotCell[] {
  const cells: SlotCell[] = []
  for (const day of DAYS) {
    for (const slotNumber of SLOTS) {
      cells.push({
        id: `${day.dateKey}_${slotNumber}`,
        dateKey: day.dateKey,
        dayLabel: '月',
        dateLabel: day.dateKey.slice(5),
        slotLabel: `${slotNumber}限`,
        slotNumber,
        timeLabel: '16:20-17:50',
        isOpenDay: day.isOpenDay,
        desks: [],
      })
    }
  }
  return cells
}

function buildTable(options: { withColGroup?: boolean } = {}): HTMLElement {
  const dayKeys = DAYS.map((day) => day.dateKey)
  const bandDays = dayKeys.slice(0, 2)
  const gapDays = dayKeys.slice(2)

  const colGroup = options.withColGroup
    ? `<colgroup>${['<col class="c-time">', ...dayKeys.flatMap((dateKey) => [
      `<col class="c-seat-${dateKey}">`,
      `<col class="c-teacher-${dateKey}">`,
      `<col class="c-student1-${dateKey}">`,
      `<col class="c-student2-${dateKey}">`,
    ])].join('')}</colgroup>`
    : ''

  const periodRow = `<tr class="sa-period-row"><th class="sa-time-col"></th>`
    + `<th class="sa-period-band" colspan="${bandDays.length * 4}" data-date-keys="${bandDays.join(',')}">夏期講習</th>`
    + `<th class="sa-period-gap" colspan="${gapDays.length * 4}" data-date-keys="${gapDays.join(',')}"></th></tr>`

  const headerRow1 = `<tr class="sa-header-row1"><th class="sa-year-col">2026</th>`
    + dayKeys.map((dateKey) => `<th class="sa-day-header sa-day-group-header" colspan="4" data-date-key="${dateKey}">${dateKey}</th>`).join('')
    + `</tr>`

  const headerRow2 = `<tr class="sa-header-row2"><th class="sa-time-sub-header"></th>`
    + dayKeys.map((dateKey) => [
      `<th class="sa-sub-header sa-seat-header sa-day-group-start" data-date-key="${dateKey}">席</th>`,
      `<th class="sa-sub-header" data-date-key="${dateKey}">講師</th>`,
      `<th class="sa-sub-header" data-date-key="${dateKey}">生徒</th>`,
      `<th class="sa-sub-header sa-day-group-end" data-date-key="${dateKey}">生徒</th>`,
    ].join('')).join('')
    + `</tr>`

  const groupRow = `<tr class="sa-group-row"><td class="sa-time-cell sa-group-time-cell">集団</td>`
    + dayKeys.map((dateKey) => [
      `<td class="sa-seat-number sa-day-group-start sa-group-seat" data-date-key="${dateKey}"></td>`,
      `<td class="sa-teacher sa-group-teacher" data-date-key="${dateKey}">集団講師</td>`,
      `<td class="sa-student sa-group-subject sa-day-group-end" colspan="2" data-date-key="${dateKey}">理科</td>`,
    ].join('')).join('')
    + `</tr>`

  const bodyRows = SLOTS.flatMap((slotNumber) => Array.from({ length: DESK_COUNT }, (_, deskIndex) => {
    const timeCell = deskIndex === 0 ? `<td class="sa-time-cell" rowspan="${DESK_COUNT}">${slotNumber}限</td>` : ''
    const dayCells = dayKeys.map((dateKey) => [
      `<td class="sa-seat-number sa-day-group-start" data-date-key="${dateKey}" data-slot-number="${slotNumber}">${deskIndex + 1}</td>`,
      `<td class="sa-teacher sa-warning" data-date-key="${dateKey}" data-slot-number="${slotNumber}"><div class="sa-teacher-name">講師${deskIndex}</div></td>`,
      `<td class="sa-student" data-date-key="${dateKey}" data-slot-number="${slotNumber}"><div class="sa-student-inner">生徒A</div></td>`,
      `<td class="sa-student sa-day-group-end" data-date-key="${dateKey}" data-slot-number="${slotNumber}"><div class="sa-student-inner">生徒B</div></td>`,
    ].join('')).join('')
    return `<tr data-slot-number="${slotNumber}">${timeCell}${dayCells}</tr>`
  })).join('')

  const host = document.createElement('div')
  host.innerHTML = `<table>${colGroup}<thead>${periodRow}${headerRow1}${headerRow2}</thead><tbody>${groupRow}${bodyRows}</tbody></table>`
  return host.querySelector('table') as HTMLElement
}

const grid = buildBoardPrintGrid(buildCells())

describe('pruneBoardTableForSelection', () => {
  it('全選択では一切間引かない(＝従来出力と同一)', () => {
    const table = buildTable()
    const before = table.innerHTML
    pruneBoardTableForSelection(table, resolveBoardPrintSelection(grid, createInitialBoardPrintChecked(grid)))
    expect(table.innerHTML).toBe(before)
  })

  it('空選択でも何もしない(出力自体が無効なので DOM を壊さない)', () => {
    const table = buildTable()
    const before = table.innerHTML
    pruneBoardTableForSelection(table, resolveBoardPrintSelection(grid, []))
    expect(table.innerHTML).toBe(before)
  })

  it('未選択の曜日を列ごと落とす(ヘッダー・小見出し・集団行・本体・定休日列)', () => {
    const table = buildTable()
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-16', 1),
      boardPrintCellKey('2026-09-16', 2),
      boardPrintCellKey('2026-09-16', 3),
    ])
    pruneBoardTableForSelection(table, selection)

    // 残る曜日は 1 日(定休日 2026-09-15 と未選択の 2 日が消える)。
    // applyBoardPdfColumnWidths は .sa-day-header の数で列幅を組み直すため、この数が正であれば列幅も揃う。
    const dayHeaders = Array.from(table.querySelectorAll('.sa-day-header'))
    expect(dayHeaders.map((header) => header.getAttribute('data-date-key'))).toEqual(['2026-09-16'])
    expect(table.querySelectorAll('.sa-header-row2 th')).toHaveLength(1 + 4)
    expect(table.querySelectorAll('.sa-group-row td')).toHaveLength(1 + 3)
    expect(table.querySelectorAll('tbody tr[data-slot-number] .sa-student')).toHaveLength(SLOTS.length * DESK_COUNT * 2)
  })

  it('未選択の時限を行ごと落とす(時限ラベルの rowSpan セルも一緒に消える)', () => {
    const table = buildTable()
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 2),
      boardPrintCellKey('2026-09-16', 2),
      boardPrintCellKey('2026-09-17', 2),
    ])
    pruneBoardTableForSelection(table, selection)

    const rows = Array.from(table.querySelectorAll('tr[data-slot-number]'))
    expect(rows).toHaveLength(DESK_COUNT)
    expect(rows.every((row) => row.getAttribute('data-slot-number') === '2')).toBe(true)
    expect(table.querySelectorAll('.sa-time-cell')).toHaveLength(2) // 集団行 + 2限のラベル
    expect(table.querySelectorAll('.sa-day-header')).toHaveLength(3)
  })

  it('集団行は時限の間引きに追従せず常に残る(曜日の間引きのみ効く・docs §I-0)', () => {
    const table = buildTable()
    // 時限は 2 限だけを選ぶ(1・3限は行ごと消える)が、集団行(tr.sa-group-row)は slot を持たないので残る。
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 2),
      boardPrintCellKey('2026-09-16', 2),
      boardPrintCellKey('2026-09-17', 2),
    ])
    pruneBoardTableForSelection(table, selection)

    const groupRows = table.querySelectorAll('tr.sa-group-row')
    expect(groupRows).toHaveLength(1)
    // 曜日の間引きは集団行にも効く(選択されなかった曜日のセルは消える)。
    expect(groupRows[0].querySelectorAll('[data-date-key]')).toHaveLength(3 * 3)
  })

  it('帯セル(特別講習)の colSpan を残った曜日数で組み直し、全部消えたら帯ごと消す', () => {
    const table = buildTable()
    // 帯にかかるのは 2026-09-14 / 2026-09-15(定休日)。14 日だけ残す。
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 1),
      boardPrintCellKey('2026-09-17', 1),
    ])
    pruneBoardTableForSelection(table, selection)

    const band = table.querySelector('.sa-period-band')
    expect(band?.getAttribute('colspan')).toBe('4')
    const gap = table.querySelector('.sa-period-gap')
    expect(gap?.getAttribute('colspan')).toBe('4')

    const tableWithoutBandDays = buildTable()
    pruneBoardTableForSelection(tableWithoutBandDays, resolveBoardPrintSelection(grid, [boardPrintCellKey('2026-09-17', 1)]))
    expect(tableWithoutBandDays.querySelector('.sa-period-band')).toBeNull()
    expect(tableWithoutBandDays.querySelector('.sa-period-gap')?.getAttribute('colspan')).toBe('4')
  })

  it('矩形内の未選択コマは構造を残したまま空白化する(席番号は残す)', () => {
    const table = buildTable()
    const selection = resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-14', 1),
      boardPrintCellKey('2026-09-17', 3),
    ])
    expect(selection.blankCellKeys).toEqual([
      boardPrintCellKey('2026-09-14', 3),
      boardPrintCellKey('2026-09-17', 1),
    ])

    pruneBoardTableForSelection(table, selection)

    const blankTeachers = Array.from(table.querySelectorAll('[data-date-key="2026-09-14"][data-slot-number="3"].sa-teacher'))
    expect(blankTeachers).toHaveLength(DESK_COUNT)
    expect(blankTeachers.every((cell) => cell.innerHTML === '')).toBe(true)
    // 黄色警告の背景は空白セルに残さない。
    expect(blankTeachers.every((cell) => !cell.classList.contains('sa-warning'))).toBe(true)
    const blankStudents = Array.from(table.querySelectorAll('[data-date-key="2026-09-17"][data-slot-number="1"].sa-student'))
    expect(blankStudents).toHaveLength(DESK_COUNT * 2)
    expect(blankStudents.every((cell) => cell.innerHTML === '')).toBe(true)
    // 席番号は構造の目印として残す。
    const seats = Array.from(table.querySelectorAll('[data-date-key="2026-09-17"][data-slot-number="1"].sa-seat-number'))
    expect(seats.map((seat) => seat.textContent)).toEqual(['1', '2'])
    // 選択したコマの中身は無傷。
    const keptStudents = Array.from(table.querySelectorAll('[data-date-key="2026-09-14"][data-slot-number="1"].sa-student'))
    expect(keptStudents.every((cell) => cell.innerHTML !== '')).toBe(true)
  })

  it('既に colgroup がある場合は未選択曜日の 4 本だけを落とす', () => {
    const table = buildTable({ withColGroup: true })
    pruneBoardTableForSelection(table, resolveBoardPrintSelection(grid, [
      boardPrintCellKey('2026-09-16', 1),
      boardPrintCellKey('2026-09-17', 1),
    ]))

    const cols = Array.from(table.querySelectorAll('col')).map((col) => col.className)
    expect(cols).toEqual([
      'c-time',
      'c-seat-2026-09-16', 'c-teacher-2026-09-16', 'c-student1-2026-09-16', 'c-student2-2026-09-16',
      'c-seat-2026-09-17', 'c-teacher-2026-09-17', 'c-student1-2026-09-17', 'c-student2-2026-09-17',
    ])
  })
})

// BoardGrid.tsx の描画先(`.slot-adjust-grid` > table)を模した要素を作る(exportBoardPdfSelection の入口)。
function buildElement(options: { withColGroup?: boolean } = {}): HTMLElement {
  const wrapper = document.createElement('div')
  const gridEl = document.createElement('div')
  gridEl.className = 'slot-adjust-grid'
  gridEl.appendChild(buildTable(options))
  wrapper.appendChild(gridEl)
  return wrapper
}

describe('exportBoardPdfSelection (html2canvas/jsPDF はモック)', () => {
  beforeEach(() => {
    html2canvasMock.mockClear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('空選択は何も出力しない(html2canvas を呼ばない・no-op)', async () => {
    const element = buildElement()
    const selection = resolveBoardPrintSelection(grid, [])
    expect(selection.isEmpty).toBe(true)

    await exportBoardPdfSelection({ element, fileName: 'blank.pdf', title: '盤面' }, selection)

    expect(html2canvasMock).not.toHaveBeenCalled()
  })

  it('全選択は scale=1.1・間引きなし(DOM 不変)で従来の exportBoardPdf 経路と同一になる', async () => {
    const element = buildElement()
    const selection = resolveBoardPrintSelection(grid, createInitialBoardPrintChecked(grid))
    expect(selection.isFullSelection).toBe(true)

    await exportBoardPdfSelection({ element, fileName: 'full.pdf', title: '盤面' }, selection)

    expect(html2canvasMock).toHaveBeenCalledTimes(1)
    const [capturedElement, options] = html2canvasMock.mock.calls[0]

    // ⚠️ 将来「全選択にも解像度アップ」を入れると赤くなる形(回帰防止)。
    expect(options?.scale).toBe(1.1)
    // pruneBoardTableForSelection が走っていないことを DOM で確認(全曜日のヘッダーが残り、空白化もされていない)。
    expect(capturedElement.querySelectorAll('.sa-day-header')).toHaveLength(DAYS.length)
    expect(capturedElement.querySelectorAll('.sa-print-blank')).toHaveLength(0)
  })
})
