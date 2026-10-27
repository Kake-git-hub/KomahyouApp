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
  const again = save(state.weeks, rows, state.suppressed, { manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, scheduleCountAdjustments: state.scheduleCountAdjustments })
  expect({ placed: again.summary.wholeDayTransferPlacedStudents, stocked: again.summary.wholeDayTransferStockedStudents, pending: again.summary.wholeDayTransferPendingStudents, orphans: again.summary.orphanedMakeupsRemoved, minus: again.wholeDayTransferCountAdjustments.length, ledgerAdd: again.manualMakeupOriginAdditions.length, ledgerRemove: again.manualMakeupOriginRemovals.length }, label)
    .toEqual({ placed: 0, stocked: 0, pending: 0, orphans: 0, minus: 0, ledgerAdd: 0, ledgerRemove: 0 })
  expect(again.nextPendingDesks, label).toEqual(state.pendingDesks)
  expect(projectDesks(again.nextWeeks), label).toEqual(projectDesks(state.weeks))
}
function initialState(rows: RegularLessonRow[]): SavedState {
  const board = transferredBoard(rows)
  return { weeks: board.weeks, suppressed: board.suppressed, ledgers: board.ledgers, scheduleCountAdjustments: board.scheduleCountAdjustments, pendingDesks: {} }
}
function step(state: SavedState, previousRows: RegularLessonRow[], nextRows: RegularLessonRow[]) {
  const saved = save(state.weeks, nextRows, state.suppressed, { manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, scheduleCountAdjustments: state.scheduleCountAdjustments, slotFilter: slotFilterBetween(previousRows, nextRows), previousRegularLessons: previousRows })
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

  it('2 回目（変えたコマ＝水 3限だけ）でも、旧科目の振替は根拠を失って消え、新科目は振替先へ置かれる。確認文の両方の行が出る', () => {
    const state0 = initialState(BASE)
    const first = step(state0, BASE, MOVED)
    expect(first.saved.summary.orphanedMakeupsRemoved).toBe(0)
    expect(first.saved.summary.wholeDayTransferPlacedStudents).toBe(0)
    // 決定記録 46（2026-10-26・Q40-9）: 時限を変えたら、丸ごと振替で移送済みの振替も新しい時限（木 3限 机 0）へ動く。移動元記録も 水 5限 → 水 3限。
    expect(first.saved.studentNotes.map((note) => note.kind)).toEqual(['slot-followed'])
    expect(first.saved.summary.slotFollowMovedMakeups).toBe(1)
    expect(liveIds(first.state.weeks, THU_CELL)).toEqual(['sB'])
    expect(cellOf(first.state.weeks, `${THU}_3`).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '数', lessonType: 'makeup', makeupSourceDate: WED, makeupSourceLabel: '2026/10/7(水) 3限' })
    expect(cellOf(first.state.weeks, WED_CELL).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA') ?? false).toBe(false)
    expect(cellOf(first.state.weeks, `${WED}_3`).desks[0].statusSlots?.some((entry) => entry?.managedStudentId === 'sA' && entry.status === 'moved' && entry.moveDestinationDateKey === THU && entry.moveDestinationSlotNumber === 3)).toBe(true)
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
    const staleMakeup = cellOf(first.state.weeks, `${THU}_3`).desks[0].lesson!.studentSlots[0]!
    const ghost: SavedState = { ...second.state, weeks: second.state.weeks.map((week) => week.map((cell) => (cell.id !== THU_CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index !== 0 ? desk : { ...desk, lesson: { id: 'ghost', studentSlots: [staleMakeup, null] } })) }))) }
    const violations = audit(ghost, RESUBJECT)
    expect(violations.map((item) => ({ kind: item.kind, studentId: item.studentId, subject: item.subject }))).toEqual([{ kind: 'surplus-makeup', studentId: 'sA', subject: '数' }])
  })
})

describe('旧・既知の限界 L-5（2026-10-21）→ 決定記録 48（2026-10-25）で閉じた: 振替先のコマが満席なら同じ机番号の下段（保留）へ振替として置く', () => {
  // 旧挙動: 置けないと台帳に origin（水 4限）を積むが、在庫の消化（consumeMatchingOriginTokens）の同じ日付へのフォールバックで移送済みの振替に食われ、
  // 台帳には積まれるが残数は増えず、4限の分の授業は盤面にも在庫にも無い（監査が「無言の消失」として検出していた形）。
  // 新挙動: 下段に振替として置く。下段の振替は監査の説明（collectLessonExplanationFacts）にも在庫の消化にも数えるので、違反 0・台帳 0・残数 0。
  it('監査に違反が無く、台帳には積まれず、下段に A の振替（振替元 水 4限）が居る。再保存は冪等', () => {
    const BASE = [...OLD_ROWS.slice(0, 2), row('r2', 't3', '', '', 4)]
    const NEXT = [...BASE, row('r5', 't3', 'sA', '', 3, { slotNumber: 4 })]
    // 木 4限 を満席にする（オーナー指示 2026-10-21: 講師が居なくても空席なら置くので、残る形は満席だけ）
    const fill = (student: string, index: number) => ({ id: `${student}_${index}`, name: student, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: true } as const)
    const state0 = initialState(BASE)
    state0.weeks = state0.weeks.map((week) => week.map((cell) => (cell.id !== `${THU}_4` ? cell : { ...cell, desks: cell.desks.map((desk, index) => ({ ...desk, lesson: { id: `full_${index}`, studentSlots: [fill('X', index * 2), fill('Y', index * 2 + 1)] } })) })))
    const { saved, state } = step(state0, BASE, NEXT)
    expect(saved.summary.wholeDayTransferStockedStudents).toBe(0)
    expect(saved.summary.wholeDayTransferPendingStudents).toBe(1)
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['transfer-pending'])
    expect(state.ledgers['sA__数'] ?? []).toHaveLength(0)
    const pendingEntries = Object.values(state.pendingDesks)
    expect(pendingEntries).toHaveLength(1)
    expect(pendingEntries[0].lower.lesson?.studentSlots.some((student) => student?.managedStudentId === 'sA' && student.lessonType === 'makeup' && student.makeupSourceDate === WED)).toBe(true)
    expect(pendingEntries[0].origin?.kind).toBe('transfer-follow-full')
    expectNoViolation(state, NEXT, 'L-5 の形（満席 → 下段）')
    expect(balances(state.weeks, NEXT, state.ledgers)['sA__数'] ?? 0).toBe(0)
    expectFixpoint(state, NEXT)
    expectIdempotentResave(state, NEXT, 'L-5 の形の再保存')
  })
})

describe('操作の全ペア（順序つき）で保存則・冪等・不動点を検査する', () => {
  // 丸ごと振替した水 5限（A・B）に対するテンプレ操作。木 3限には講師だけの足場（置ける形）、水 3限には C の数（同じ科目を別の時限に持つ形）。
  // 水 4限にも講師だけの足場（高橋）: 丸ごと振替で木 4限へ移るので、4限に足した生徒を置ける形になる（置けない形は下の「既知の限界 L-5」で別に見る）。
  const SCAFFOLD = [row('r2', 't3', '', '', 4), row('r4', 't4', '', '', 4, { slotNumber: 3 }), row('r3', 't4', 'sC', '', 3, { slotNumber: 3 }), row('r6', 't4', '', '', 3, { slotNumber: 4 })]
  type Op = { name: string; apply: (rows: RegularLessonRow[]) => RegularLessonRow[] }
  const replaceRow = (rows: RegularLessonRow[], id: string, next: RegularLessonRow | null) => rows.flatMap((item) => (item.id === id ? (next ? [next] : []) : [item]))
  /** A（student1 に sA を持つ行）を探して書き換える。A が 2 行に居ることは無い（3限の行 r7 へ移すときは元の行から外す）。 */
  const rowOfA = (rows: RegularLessonRow[]) => rows.find((item) => item.student1Id === 'sA')
  const withoutA = (rows: RegularLessonRow[]) => rows.map((item) => (item.student1Id === 'sA' ? { ...item, student1Id: '', subject1: '' } : item))
  const insertBefore = (rows: RegularLessonRow[], id: string, next: RegularLessonRow) => {
    const index = rows.findIndex((item) => item.id === id)
    return index < 0 ? [...rows, next] : [...rows.slice(0, index), next, ...rows.slice(index)]
  }
  const OPS: Op[] = [
    { name: 'A を外す', apply: (rows) => withoutA(rows) },
    { name: 'C を 5限 机 0 の生徒 2 に足す（同じ科目を 3限にも持つ）', apply: (rows) => replaceRow(rows, 'r0', { ...rows.find((item) => item.id === 'r0')!, student2Id: 'sC', subject2: '数' }) },
    // A だけを 3限へ（行 r7・水 3限 の机 1＝C の机 r3 の次）。r0 に C が居ても C は 5限に残る（行ごと動かすと C が 3限に 2 回＝衝突 origin になる）。
    { name: 'A を 5限 → 3限 へ', apply: (rows) => { const current = rowOfA(rows); if (!current || current.slotNumber === 3) return rows; return insertBefore(withoutA(rows).filter((item) => item.id !== 'r7'), 'r6', row('r7', 't1', 'sA', '', 3, { slotNumber: 3, subject1: current.subject1 })) } },
    { name: 'A の科目を英へ', apply: (rows) => { const current = rowOfA(rows); return current ? replaceRow(rows, current.id, { ...current, subject1: '英' }) : rows } },
    { name: 'B の机の講師を替える', apply: (rows) => replaceRow(rows, 'r1', { ...rows.find((item) => item.id === 'r1')!, teacherId: 't4' }) },
    { name: 'D を 5限 机 1 の生徒 2 に足す', apply: (rows) => replaceRow(rows, 'r1', { ...rows.find((item) => item.id === 'r1')!, student2Id: 'sD', subject2: '数' }) },
    // regression-reviewer H-A（2026-10-21）: 時限を変えた生徒に、同じ科目を同じ曜日の別の時限で足す。4限の行は足場 r6 より前＝水 4限 机 0（振替先 木 4限 机 0 の講師は移送された高橋）。
    { name: 'A の数を 4限にも足す（行を足す）', apply: (rows) => (rows.some((item) => item.id === 'r5') ? rows : insertBefore(rows, 'r6', row('r5', 't3', 'sA', '', 3, { slotNumber: 4 }))) },
    { name: 'A を 5限 → 3限 へ ＋ 4限にも足す（1 回の保存で 2 つ）', apply: (rows) => { const current = rowOfA(rows); const moved = !current || current.slotNumber === 3 ? rows : insertBefore(withoutA(rows).filter((item) => item.id !== 'r7'), 'r6', row('r7', 't1', 'sA', '', 3, { slotNumber: 3, subject1: current.subject1 })); return moved.some((item) => item.id === 'r5') ? moved : insertBefore(moved, 'r6', row('r5', 't3', 'sA', '', 3, { slotNumber: 4 })) } },
    // 決定記録 46（オーナー決定 2026-10-26「往復でも戻す」・Q40-9 M-2）: 3限へ移した A を 5限 机 0 へ戻す（r7 を外し r0 の生徒 1 に戻す）。往復の 2 回目でも振替が 5限へ戻ることを全順序で見る。
    { name: 'A を 3限 → 5限 へ戻す', apply: (rows) => { const current = rowOfA(rows); if (!current || current.slotNumber !== 3 || current.id !== 'r7') return rows; return replaceRow(rows.filter((item) => item.id !== 'r7'), 'r0', { ...rows.find((item) => item.id === 'r0')!, student1Id: 'sA', subject1: current.subject1 }) } },
    { name: '何も変えない', apply: (rows) => rows },
    // 2026-10-27（確認リスト tp-51 の兄弟監査）: 科目の往復（数 → 英 → 数）と、外した A を同じ机へ戻す。Q40-1 が振替を消しても振替元の日の抑止キーが残り、
    // 戻した保存で授業が置かれず・未消化にもならず消えていた（保存則の「無言の消失」）。Q40-1 が外した振替の抑止キーも取り除く。
    { name: 'A の科目を数へ戻す', apply: (rows) => { const current = rowOfA(rows); return current && current.subject1 !== '数' ? replaceRow(rows, current.id, { ...current, subject1: '数' }) : rows } },
    { name: 'A を外した後で 5限 机 0 へ戻す', apply: (rows) => (rowOfA(rows) ? rows : replaceRow(rows, 'r0', { ...rows.find((item) => item.id === 'r0')!, student1Id: 'sA', subject1: '数' })) },
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
        // INV-06: 未消化振替の残数の増減は、保存が台帳へ積んだ／取り下げた分だけ（置く・消す・精算済みは在庫中立）。生徒×科目ごとに前後の差で見る。
        const before = balances(state.weeks, rows, state.ledgers, settings(), {}, state.pendingDesks)
        const after = balances(nextState.weeks, nextRows, nextState.ledgers, settings(), {}, nextState.pendingDesks)
        const ledgerDelta = new Map<string, number>()
        for (const addition of saved.manualMakeupOriginAdditions) { const key = `${addition.student.managedStudentId}__${addition.student.subject}`; ledgerDelta.set(key, (ledgerDelta.get(key) ?? 0) + 1) }
        for (const removal of saved.manualMakeupOriginRemovals) ledgerDelta.set(removal.stockKey, (ledgerDelta.get(removal.stockKey) ?? 0) - 1)
        for (const key of new Set([...Object.keys(before), ...Object.keys(after), ...ledgerDelta.keys()])) {
          expect((after[key] ?? 0) - (before[key] ?? 0), `${label} ${key} の残数の差`).toBe(ledgerDelta.get(key) ?? 0)
        }
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
