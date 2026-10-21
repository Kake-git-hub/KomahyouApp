// ============================================================================
// INV-05 / INV-06 / INV-12 / INV-03 シーケンス監査: テンプレ保存を 1 手ずつ重ねても授業が痕跡なく消えない（2026-10-21）
//
// 出典: テスト教室の確認リスト v1.5.604（受付 20261020-092527755-56bbf675）で見つかった 2 件。
//   tp-48: 同じ科目を同じ曜日の別の時限にも持つ生徒を、丸ごと振替した日のコマに足すと、置かず・未消化にせず・−1 もせずに消えた（Q40-3 M-1 の誤認）。
//   tp-51: 「時限を変える → 科目を変える」の順で保存すると、旧時限を振替元に持つ旧科目の振替が範囲の外になり、根拠が無いのに消えなかった（Q40-1 の範囲が時限単位）。
// どちらも単体テストは仕様の形（1 手・別の曜日への丸ごと振替）しか見ていなかった。ここでは仕様の形に依らない **保存則**
// （templateLessonAccountingOracle: 新テンプレの各授業は 置く／振替／在庫／−1／同じコマの別種の授業／出欠記録 のどれかで説明できる）を、
// 操作の **全ペア（順序つき）** に対して保存ごとに検査し、あわせて「同じテンプレの再保存は何も変えない」（冪等）と再マージの不動点を見る。
// 新しい置かない判定を足すときは、この監査が通る形で足す（通らなければ、その判定は授業を消している）。
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SlotCell } from './types'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { auditTemplateLessonAccounting, describeLessonAccountingViolations } from './templateLessonAccountingOracle'
import {
  applySaveToState, balances, cellOf, liveIds, OLD_ROWS, remerge, row, save, settings, slotFilterBetween, students, transferredBoard,
  THU, THU_CELL, WED, WED_CELL, WEEK_END, type SavedState,
} from './templateTransferFollow.fixture'

const RANGE = { fromDate: WED, toDate: WEEK_END }
function audit(state: SavedState, rows: RegularLessonRow[]) {
  return auditTemplateLessonAccounting({
    weeks: state.weeks, regularLessons: rows, students, classroomSettings: settings(), scheduleCountAdjustments: state.scheduleCountAdjustments,
    manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, ...RANGE,
  })
}
function expectNoViolation(state: SavedState, rows: RegularLessonRow[], label: string) {
  const violations = audit(state, rows)
  expect(violations, `${label}\n${describeLessonAccountingViolations(violations)}`).toEqual([])
}
function expectFixpoint(state: SavedState, rows: RegularLessonRow[]) {
  const once = remerge(state.weeks, rows, state.suppressed)
  expect(once.flat().map((cell) => cell.desks)).toEqual(state.weeks.flat().map((cell) => cell.desks))
}
/** 冪等性の比較に使う机の射影（講師名・生徒・記録）。講師の削除記録だけの空き机を全コマ保存が片づける（-3 の表）のは会計に無関係なので印は比べない。 */
function projectDesks(weeks: SlotCell[][]) {
  return weeks.flat().map((cell) => ({
    id: cell.id,
    desks: cell.desks.map((desk) => ({
      teacher: desk.teacher,
      students: (desk.lesson?.studentSlots ?? []).map((student) => (student ? { id: student.managedStudentId ?? student.name, subject: student.subject, type: student.lessonType, from: student.makeupSourceDate ?? null } : null)),
      statuses: (desk.statusSlots ?? []).map((entry) => (entry ? { id: entry.managedStudentId ?? entry.name, subject: entry.subject, status: entry.status } : null)),
    })),
  }))
}
/** 同じテンプレをもう一度保存（変えたコマ 0＝全コマ）しても、置く・未消化・消す・−1 が出ず盤面も変わらない（冪等）。 */
function expectIdempotentResave(state: SavedState, rows: RegularLessonRow[], label: string) {
  const again = save(state.weeks, rows, state.suppressed, { manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks })
  expect({ placed: again.summary.wholeDayTransferPlacedStudents, stocked: again.summary.wholeDayTransferStockedStudents, orphans: again.summary.orphanedMakeupsRemoved, minus: again.wholeDayTransferCountAdjustments.length, ledgerAdd: again.manualMakeupOriginAdditions.length, ledgerRemove: again.manualMakeupOriginRemovals.length }, label)
    .toEqual({ placed: 0, stocked: 0, orphans: 0, minus: 0, ledgerAdd: 0, ledgerRemove: 0 })
  expect(projectDesks(again.nextWeeks), label).toEqual(projectDesks(state.weeks))
}
function initialState(rows: RegularLessonRow[]): SavedState {
  const board = transferredBoard(rows)
  return { weeks: board.weeks, suppressed: board.suppressed, ledgers: board.ledgers, scheduleCountAdjustments: board.scheduleCountAdjustments, pendingDesks: {} }
}
function step(state: SavedState, previousRows: RegularLessonRow[], nextRows: RegularLessonRow[]) {
  const saved = save(state.weeks, nextRows, state.suppressed, { manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, slotFilter: slotFilterBetween(previousRows, nextRows) })
  return { saved, state: applySaveToState(state, saved) }
}

describe('tp-48（2026-10-17 テスト教室）: 同じ科目を同じ曜日の別の時限にも持つ生徒を、丸ごと振替した日のコマに足す', () => {
  // C は水 3限に数を持つ（丸ごと振替で木 3限へ移送済み＝水 3限の抑止キーがある）。そこへ水 5限 机 0 の生徒 2 にも C（数）を足す。
  const ROWS_WITH_C3 = [...OLD_ROWS, row('r3', 't4', 'sC', '', 3, { slotNumber: 3 })]
  const NEW_ROWS = [row('r0', 't1', 'sA', 'sC'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4), row('r3', 't4', 'sC', '', 3, { slotNumber: 3 })]

  it('5限の分は 3限のキーで「精算済み」にならず、振替先（木 5限）の同じ机へ振替として置く。−1 も未消化も無し。残数不変・冪等・保存則', () => {
    const state0 = initialState(ROWS_WITH_C3)
    expect(state0.suppressed).toContain(`sC__数__${WED}__3`)
    const before = balances(state0.weeks, ROWS_WITH_C3, state0.ledgers)
    const { saved, state } = step(state0, ROWS_WITH_C3, NEW_ROWS)
    expect(saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['transfer-placed'])
    const thu = cellOf(state.weeks, THU_CELL)
    expect(thu.desks[0].lesson?.studentSlots[1]).toMatchObject({ managedStudentId: 'sC', lessonType: 'makeup', makeupSourceDate: WED })
    expect(cellOf(state.weeks, WED_CELL).desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC', moveDestinationDateKey: THU })
    // 3限の分（移送済み）はそのまま
    expect(liveIds(state.weeks, `${THU}_3`)).toEqual(['sC'])
    const after = balances(state.weeks, NEW_ROWS, state.ledgers)
    expect(after['sC__数'] ?? 0).toBe(before['sC__数'] ?? 0)
    expectNoViolation(state, NEW_ROWS, 'tp-48 保存後')
    expectFixpoint(state, NEW_ROWS)
    expectIdempotentResave(state, NEW_ROWS, 'tp-48 再保存')
  })

  it('保存前の形（改定前の判定）だと保存則に違反する＝監査が無言の消失を検出する', () => {
    // 改定前の挙動を再現: 置かず・未消化にせず・−1 もせず、抑止キーだけ積まれた盤面。
    const state0 = initialState(ROWS_WITH_C3)
    const broken: SavedState = { ...state0, suppressed: [...state0.suppressed, `sC__数__${WED}__5`] }
    const violations = audit(broken, NEW_ROWS)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ studentId: 'sC', subject: '数', dateKey: WED, expected: 2, explained: 1 })
  })
})

describe('tp-51（2026-10-17 テスト教室）: 時限を変える → 科目を変える、の順に保存する', () => {
  // 水 3限に講師だけの足場（高橋）を置く。丸ごと振替が講師ごと木 3限へ移すので、振替先の机 0 に講師が居る形になる（テスト教室の 3/29 5限 と同じ。
  // 講師のいない机には置かない・M-4）。
  const BASE = [...OLD_ROWS, row('r4', 't4', '', '', 3, { slotNumber: 3 })]
  // A の行を先に置く＝水 3限 机 0（振替先も机 0＝高橋の机。机番号は 1 対 1）。
  const MOVED = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r4', 't4', '', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const RESUBJECT = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3, subject1: '英' }), row('r4', 't4', '', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]

  it('2 回目（変えたコマ＝水 3限だけ）でも、水 5限を振替元に持つ旧科目の振替は根拠を失って消え、新科目は振替先へ置かれる。確認文の両方の行が出る', () => {
    const state0 = initialState(BASE)
    const first = step(state0, BASE, MOVED)
    expect(first.saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(first.saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    expect(first.saved.studentNotes.map((note) => note.kind)).toEqual(['transfer-settled'])
    expect(liveIds(first.state.weeks, THU_CELL).sort()).toEqual(['sA', 'sB'])
    expectNoViolation(first.state, MOVED, '時限変更の後')
    expectIdempotentResave(first.state, MOVED, '時限変更の再保存')

    const second = step(first.state, MOVED, RESUBJECT)
    expect(slotFilterBetween(MOVED, RESUBJECT)?.slotKeys).toEqual(new Set([buildTemplateSlotKey(3, 3)]))
    expect(second.saved.summary.orphanedMakeupsRemoved).toBe(1)
    expect(second.saved.orphanedMakeups[0].student).toMatchObject({ managedStudentId: 'sA', subject: '数' })
    expect(second.saved.summary.wholeDayTransferPlacedStudents).toBe(1)
    expect(second.saved.studentNotes.map((note) => note.kind).sort()).toEqual(['orphan-removed', 'transfer-placed'])
    // 旧科目の振替は木 5限から消え、新科目の振替が木 3限 机 0 に入る。水 5限の A の移動元記録は消え、水 3限に新しい記録。
    expect(liveIds(second.state.weeks, THU_CELL)).toEqual(['sB'])
    expect(cellOf(second.state.weeks, `${THU}_3`).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '英', lessonType: 'makeup', makeupSourceDate: WED })
    expect(cellOf(second.state.weeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA') ?? false).toBe(false)
    expect(cellOf(second.state.weeks, `${WED}_3`).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.subject === '英')).toBe(true)
    const after = balances(second.state.weeks, RESUBJECT, second.state.ledgers)
    expect(after['sA__英'] ?? 0).toBe(0)
    expect(after['sA__数'] ?? 0).toBe(0)
    expectNoViolation(second.state, RESUBJECT, '科目変更の後')
    expectFixpoint(second.state, RESUBJECT)
    expectIdempotentResave(second.state, RESUBJECT, '科目変更の再保存')

    // 改定前の結果（旧科目の振替が木 5限に残ったまま）は「根拠の無い振替」として監査が検出する。
    const staleMakeup = cellOf(first.state.weeks, THU_CELL).desks[0].lesson!.studentSlots[0]!
    const ghost: SavedState = { ...second.state, weeks: second.state.weeks.map((week) => week.map((cell) => (cell.id !== THU_CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: { id: 'ghost', studentSlots: [staleMakeup, null] } })) }))) }
    const violations = audit(ghost, RESUBJECT)
    expect(violations.map((item) => ({ kind: item.kind, studentId: item.studentId, subject: item.subject }))).toEqual([{ kind: 'surplus-makeup', studentId: 'sA', subject: '数' }])
  })
})

describe('操作の全ペア（順序つき）で保存則・冪等・不動点を検査する', () => {
  // 丸ごと振替した水 5限（A・B）に対するテンプレ操作。木 3限には講師だけの足場（置ける形）、水 3限には C の数（同じ科目を別の時限に持つ形）。
  const SCAFFOLD = [row('r2', 't3', '', '', 4), row('r4', 't4', '', '', 4, { slotNumber: 3 }), row('r3', 't4', 'sC', '', 3, { slotNumber: 3 })]
  type Op = { name: string; apply: (rows: RegularLessonRow[]) => RegularLessonRow[] }
  const replaceRow = (rows: RegularLessonRow[], id: string, next: RegularLessonRow | null) => rows.flatMap((item) => (item.id === id ? (next ? [next] : []) : [item]))
  const OPS: Op[] = [
    { name: 'A を外す', apply: (rows) => replaceRow(rows, 'r0', row('r0', 't1')) },
    { name: 'C を 5限 机 0 の生徒 2 に足す（同じ科目を 3限にも持つ）', apply: (rows) => replaceRow(rows, 'r0', { ...rows.find((item) => item.id === 'r0')!, student2Id: 'sC', subject2: '数' }) },
    { name: 'A を 5限 → 3限 へ', apply: (rows) => replaceRow(rows, 'r0', { ...rows.find((item) => item.id === 'r0')!, slotNumber: 3 }) },
    { name: 'A の科目を英へ', apply: (rows) => replaceRow(rows, 'r0', { ...rows.find((item) => item.id === 'r0')!, subject1: rows.find((item) => item.id === 'r0')!.student1Id ? '英' : '' }) },
    { name: 'B の机の講師を替える', apply: (rows) => replaceRow(rows, 'r1', { ...rows.find((item) => item.id === 'r1')!, teacherId: 't4' }) },
    { name: 'D を 5限 机 1 の生徒 2 に足す', apply: (rows) => replaceRow(rows, 'r1', { ...rows.find((item) => item.id === 'r1')!, student2Id: 'sD', subject2: '数' }) },
    { name: '何も変えない', apply: (rows) => rows },
  ]
  const BASE = [...OLD_ROWS.slice(0, 2), ...SCAFFOLD]

  for (const first of OPS) for (const second of OPS) {
    it(`${first.name} → ${second.name}`, () => {
      let rows = BASE
      let state = initialState(BASE)
      expectNoViolation(state, rows, '初期')
      for (const [index, op] of [first, second].entries()) {
        const nextRows = op.apply(rows)
        const { saved, state: nextState } = step(state, rows, nextRows)
        const label = `${index + 1} 手目: ${op.name}`
        // INV-06: 台帳へ積むのは「置けなかった」生徒の分だけ（休日でない）。
        expect(saved.manualMakeupOriginAdditions.length, label).toBe(saved.wholeDayTransferStocked.filter((item) => item.ledger).length)
        // INV-12: 同じ日に同じ生徒が 2 か所に生きない（上段）。
        for (const cell of nextState.weeks.flat()) {
          const ids = liveIds(nextState.weeks, cell.id)
          expect(new Set(ids).size, `${label} ${cell.id}`).toBe(ids.length)
        }
        expectNoViolation(nextState, nextRows, label)
        expectFixpoint(nextState, nextRows)
        expectIdempotentResave(nextState, nextRows, `${label} の再保存`)
        rows = nextRows
        state = nextState
      }
    })
  }
})
