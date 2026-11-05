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
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildManagedOccurrenceKey, buildStudentStatusEntry, computePendingDeskResolution, computeStudentMove } from './ScheduleBoardScreen'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { auditTemplateLessonAccounting, describeLessonAccountingViolations } from './templateLessonAccountingOracle'
import {
  applySaveToState, balances, buildWeek, cellOf, liveIds, OLD_ROWS, remerge, row, save, settings, slotFilterBetween, students, transferredBoard,
  THU, THU_CELL, WED, WED_CELL, WEEK_END, type SavedState,
} from './templateTransferFollow.fixture'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'
import { computeToggleDeskTeacherRest, hasDeskTeacherRest } from './teacherRest'
import * as pairFx from './wholeDayTransferPair.fixture'

const RANGE = { fromDate: WED, toDate: WEEK_END }
function audit(state: SavedState, rows: RegularLessonRow[]) {
  return auditTemplateLessonAccounting({
    weeks: state.weeks, regularLessons: rows, students, classroomSettings: settings(), scheduleCountAdjustments: state.scheduleCountAdjustments,
    manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, suppressedRegularLessonOccurrences: state.suppressed, ...RANGE,
  })
}
function expectNoViolation(state: SavedState, rows: RegularLessonRow[], label: string) {
  const violations = audit(state, rows)
  expect(violations, `${label}\n${describeLessonAccountingViolations(violations)}`).toEqual([])
}
function expectFixpoint(state: SavedState, rows: RegularLessonRow[]) {
  // 機能フラグ ON の再マージは保留の下段も規則の材料にする（regression-reviewer 要修正-4(a): 保留マップを渡す）。
  const once = remerge(state.weeks, rows, state.suppressed, settings(), state.pendingDesks)
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
  it('監査に違反が無く、台帳には積まれず、上段に A の振替（振替元 水 4限）・下段に押し出した手入力の生徒が居る。再保存は冪等', () => {
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
    // 2026-11-01（オーナー決定「上段＝テンプレ／下段＝手入力」）: 振替は上段（テンプレの席＝席 0）へ、席に居た手入力の X は下段へ。
    expect(pendingEntries[0].lower.lesson?.studentSlots.some((student) => student?.name === 'X' && student.manualAdded)).toBe(true)
    expect(pendingEntries[0].lower.lesson?.studentSlots.some((student) => student?.managedStudentId === 'sA')).toBe(false)
    const thu4 = state.weeks.flat().find((cell) => cell.id === `${THU}_4`)!
    expect(thu4.desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: WED })
    expect(pendingEntries[0].origin?.kind).toBe('transfer-follow-displaced')
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

describe('Q36 同日移動の写し × 在庫（オーナー決定 2026-11-05・決定記録 63）', () => {
  // A は水 5限 机 0 の通常授業。日の中で 4限 机 1 へ動かした（写し・抑止キー A × 水 5限）。新テンプレは A を水 3限へ移す。
  // 写しはテンプレの位置へ戻す（外して抑止キーも外す）。希望回数・在庫は動かさない（Q36-5）。
  it('写しを外してテンプレの 3限に戻しても、残数・希望回数・在庫台帳は動かず、保存則・再マージの不動点・再保存の冪等が成り立つ', () => {
    const week = buildWeek(OLD_ROWS)
    const copy = { ...cellOf([week], WED_CELL).desks[0].lesson!.studentSlots[0]!, id: 'sA_copy', sameDayMoveSourceDate: WED, sameDayMoveSourceLabel: '2026/10/7(水) 5限' }
    const moved = week.map((cell) => {
      if (cell.id === WED_CELL) return { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : desk)) }
      if (cell.id === `${WED}_4`) return { ...cell, desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, teacher: '佐藤', lesson: { id: 'moved_sA', studentSlots: [copy, null] as [typeof copy | null, typeof copy | null] } } : desk)) }
      return cell
    })
    const suppressed = [`sA__数__${WED}__5`]
    const state0: SavedState = { weeks: [moved], suppressed, ledgers: {}, scheduleCountAdjustments: [], pendingDesks: {} }
    const nextRows = [row('r0', 't1', 'sA', '', 3, { slotNumber: 3 }), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
    const before = balances(state0.weeks, OLD_ROWS, {})
    const saved = save(state0.weeks, nextRows, state0.suppressed, { manualMakeupAdjustments: {}, templatePendingDesks: {}, scheduleCountAdjustments: [] })
    expect(saved.summary.sameDayMoveCopiesReverted).toBe(1)
    expect(saved.removedSuppressedRegularLessonOccurrences).toEqual([`sA__数__${WED}__5`])
    expect(liveIds(saved.nextWeeks, `${WED}_4`)).toEqual([])
    expect(liveIds(saved.nextWeeks, `${WED}_3`)).toEqual(['sA'])
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(saved.manualMakeupOriginAdditions).toEqual([])
    expect(saved.manualMakeupOriginRemovals).toEqual([])
    const state = applySaveToState(state0, saved)
    expect(balances(state.weeks, nextRows, state.ledgers)).toEqual(before)
    expectNoViolation(state, nextRows, 'Q36 保存後')
    expectFixpoint(state, nextRows)
    expectIdempotentResave(state, nextRows, 'Q36 再保存')
  })
})

// ============================================================================
// 第 2 版（regression-reviewer 要修正-4(a)）: 盤面の操作（手入力の振替を置く・同じ日の移動・休みの記録・下段(手入力)を採用）とテンプレの変更を
// 全ペア（順序つき）で重ね、保存ごとに 保存則（無言の消失・説明の重複）・再マージ（フラグ ON・保留マップ込み）の不動点・再保存の冪等 を見る。
// ============================================================================
describe('第 2 版: 盤面の操作 × テンプレ保存の全ペアで、保存則・不動点・冪等', () => {
  const ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', '', '', 4)]
  const byName = new Map(students.map((item) => [item.name, item]))
  const studentOf = (id: string, overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id: `${id}_hand`, name: students.find((item) => item.id === id)!.name, managedStudentId: id, grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 5限', ...overrides })
  type BoardOp = { name: string; rows?: (rows: RegularLessonRow[]) => RegularLessonRow[]; board?: (state: SavedState) => SavedState }
  const withDesk = (state: SavedState, cellId: string, deskIndex: number, update: (desk: DeskCell) => DeskCell): SavedState => ({
    ...state, weeks: state.weeks.map((week) => week.map((cell) => (cell.id !== cellId ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === deskIndex ? update(desk) : desk)) }))),
  })
  const findLive = (state: SavedState, id: string) => {
    for (const cell of state.weeks.flat()) if (cell.dateKey === WED) for (const [deskIndex, desk] of cell.desks.entries()) {
      const seat = (desk.lesson?.studentSlots ?? []).findIndex((item) => item?.managedStudentId === id)
      if (seat >= 0) return { cell, deskIndex, seat, student: desk.lesson!.studentSlots[seat]! }
    }
    return null
  }
  const OPS: BoardOp[] = [
    { name: '手入力の振替（C）を A の机の空いた席に置く', board: (state) => withDesk(state, WED_CELL, 0, (desk) => (desk.lesson && !desk.lesson.studentSlots[1] ? { ...desk, lesson: { ...desk.lesson, studentSlots: [desk.lesson.studentSlots[0], studentOf('sC')] } } : desk)) },
    { name: '手入力の振替（D）を B の席に重ねて置く（保存で 2 行）', board: (state) => withDesk(state, WED_CELL, 1, (desk) => ({ ...desk, lesson: { id: desk.lesson?.id ?? 'hand_d', studentSlots: [studentOf('sD'), desk.lesson?.studentSlots[1] ?? null] } })) },
    {
      name: 'A を同じ日の 4 限へ動かす（同日移動）', board: (state) => {
        const found = findLive(state, 'sA')
        if (!found || found.cell.slotNumber !== 5) return state
        const moved = computeStudentMove({ weeks: state.weeks, weekIndex: 0, cells: state.weeks[0], movingStudentId: found.student.id, cellId: `${WED}_4`, deskIndex: 0, studentIndex: 0, suppressedRegularLessonOccurrences: state.suppressed, managedStudentByAnyName: byName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: true })
        return moved.status === 'moved' ? { ...state, weeks: moved.nextWeeks, suppressed: moved.nextSuppressedRegularLessonOccurrences } : state
      },
    },
    {
      name: 'B を休みにする（記録・台帳に origin）', board: (state) => {
        const found = findLive(state, 'sB')
        if (!found) return state
        const desk = found.cell.desks[found.deskIndex]
        const record = buildStudentStatusEntry(found.student, found.cell, desk, 'absent')
        const next = withDesk(state, found.cell.id, found.deskIndex, (item) => {
          const slots = [...item.lesson!.studentSlots] as [StudentEntry | null, StudentEntry | null]
          slots[found.seat] = null
          const statusSlots = [item.statusSlots?.[0] ?? null, item.statusSlots?.[1] ?? null] as [StudentStatusEntry | null, StudentStatusEntry | null]
          statusSlots[found.seat] = record
          return { ...item, lesson: slots[0] || slots[1] ? { ...item.lesson!, studentSlots: slots } : undefined, statusSlots }
        })
        return { ...next, suppressed: [...next.suppressed, buildManagedOccurrenceKey(found.student, found.cell.dateKey, found.cell.slotNumber)], ledgers: { ...next.ledgers, 'sB__数': [...(next.ledgers['sB__数'] ?? []), { dateKey: WED }] } }
      },
    },
    {
      name: '緑の机で「下段(手入力)を採用する」', board: (state) => {
        const key = Object.keys(state.pendingDesks)[0]
        if (!key) return state
        const [cellId, deskId] = key.split('::')
        const result = computePendingDeskResolution({
          mode: 'adopt-existing', weeks: state.weeks, cellId, deskId, templatePendingDesks: state.pendingDesks,
          ledgers: { manualLectureStockCounts: {}, manualLectureStockOrigins: {}, manualMakeupAdjustments: state.ledgers, fallbackLectureStockStudents: {}, fallbackMakeupStudents: {}, suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: state.suppressed, scheduleCountAdjustments: state.scheduleCountAdjustments },
          managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name, ledgerOriginDatesByKey: {},
        })
        if (result.status !== 'applied') return state
        return { weeks: result.nextWeeks, pendingDesks: result.nextTemplatePendingDesks, suppressed: result.ledgers.suppressedRegularLessonOccurrences, ledgers: result.ledgers.manualMakeupAdjustments, scheduleCountAdjustments: result.ledgers.scheduleCountAdjustments }
      },
    },
    { name: 'テンプレで B の科目を英へ', rows: (rows) => rows.map((item) => (item.id === 'r1' ? { ...item, subject1: '英' } : item)) },
    { name: 'テンプレは何も変えない', rows: (rows) => rows },
  ]
  for (const first of OPS) for (const second of OPS) {
    it(`${first.name} → ${second.name}`, () => {
      let rows = ROWS
      const initial = save([buildWeek(ROWS)], ROWS, [])
      let state = applySaveToState({ weeks: [buildWeek(ROWS)], suppressed: [], ledgers: {}, scheduleCountAdjustments: [], pendingDesks: {} }, initial)
      for (const [index, op] of [first, second].entries()) {
        if (op.board) state = op.board(state)
        const nextRows = op.rows ? op.rows(rows) : rows
        const saved = save(state.weeks, nextRows, state.suppressed, { manualMakeupAdjustments: state.ledgers, templatePendingDesks: state.pendingDesks, scheduleCountAdjustments: state.scheduleCountAdjustments, previousRegularLessons: rows })
        state = applySaveToState(state, saved)
        rows = nextRows
        const label = `${index + 1} 手目: ${op.name}`
        expectNoViolation(state, rows, label)
        expectFixpoint(state, rows)
        expectIdempotentResave(state, rows, `${label} の再保存`)
        for (const cell of state.weeks.flat()) {
          const ids = liveIds(state.weeks, cell.id)
          expect(new Set(ids).size, `${label} ${cell.id}`).toBe(ids.length)
        }
      }
    })
  }
})

// 第 2 版 段 3（spec-template-conflict-v2 §2-4・§9-4・§9-7・§9-8）: 講師の休み × テンプレ保存の全ペア（順序つき）。INV-03（同じ保存 2 回・再マージ 2 回で不変）と
// INV-01（同じ講師はそのコマの 1 机まで）・INV-02（休みの記録は反映で消えない）を、操作の順に依らずに見る。丸ごと振替の無い水 5限（机 0=田中+A・机 1=鈴木+B）。
// 盤面の操作は保留（2 行）の机では行わない（画面も講師メニューを開かない）。各操作の後にテンプレを保存（反映）する。
describe('講師の休み × テンプレ保存の全ペア（INV-03・INV-01・INV-02）', () => {
  type RestOp = { name: string; board?: (state: SavedState) => SavedState; rows?: (rows: RegularLessonRow[]) => RegularLessonRow[] }
  const deskIndexWhere = (state: SavedState, predicate: (desk: SlotCell['desks'][number]) => boolean) => cellOf(state.weeks, WED_CELL).desks.findIndex((desk) => !state.pendingDesks[buildTemplatePendingDeskKey(WED_CELL, desk.id)] && predicate(desk))
  const toggleAt = (state: SavedState, deskIndex: number): SavedState => {
    if (deskIndex < 0) return state
    const result = computeToggleDeskTeacherRest({ weeks: state.weeks, weekIndex: 0, cellId: WED_CELL, deskIndex, resolveTeacherId: (name) => (name === '田中' ? 't1' : undefined) })
    return result.status === 'blocked' ? state : { ...state, weeks: result.nextWeeks }
  }
  const OPS: RestOp[] = [
    { name: '田中を休みにする', board: (state) => toggleAt(state, deskIndexWhere(state, (desk) => desk.teacher === '田中' && !hasDeskTeacherRest(desk))) },
    { name: '休みを解除する', board: (state) => toggleAt(state, deskIndexWhere(state, (desk) => hasDeskTeacherRest(desk))) },
    {
      name: '休みの机に高橋を手で置く',
      board: (state) => {
        const index = deskIndexWhere(state, (desk) => hasDeskTeacherRest(desk) && !desk.teacher.trim())
        if (index < 0) return state
        return { ...state, weeks: state.weeks.map((week) => week.map((cell) => (cell.id !== WED_CELL ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === index ? { ...desk, teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual' as const, teacherAssignmentTeacherId: 't4' } : desk)) }))) }
      },
    },
    { name: 'テンプレで田中と鈴木の机を入れ替える', rows: (rows) => rows.map((item) => (item.id === 'r0' ? { ...item, teacherId: item.teacherId === 't1' ? 't2' : 't1' } : item.id === 'r1' ? { ...item, teacherId: item.teacherId === 't2' ? 't1' : 't2' } : item)) },
    { name: '何も変えない' },
  ]
  const upperTeachers = (state: SavedState) => cellOf(state.weeks, WED_CELL).desks.map((desk) => desk.teacher.trim()).filter(Boolean)
  const restedTanaka = (state: SavedState) => cellOf(state.weeks, WED_CELL).desks.some((desk) => desk.teacherRest?.teacher === '田中')

  for (const first of OPS) for (const second of OPS) {
    it(`${first.name} → ${second.name}`, () => {
      let rows = OLD_ROWS
      let state: SavedState = { weeks: remerge([buildWeek(OLD_ROWS)], OLD_ROWS, []), suppressed: [], ledgers: {}, scheduleCountAdjustments: [], pendingDesks: {} }
      for (const [index, op] of [first, second].entries()) {
        const label = `${index + 1} 手目: ${op.name}`
        const restedBefore = restedTanaka(state)
        if (op.board) state = op.board(state)
        const nextRows = op.rows ? op.rows(rows) : rows
        const { state: nextState } = step(state, rows, nextRows)
        // INV-02: 休みの記録は反映で消えない（解除の操作だけが消す）。
        if (restedBefore && op.name !== '休みを解除する') expect(restedTanaka(nextState), label).toBe(true)
        // §2-4: 休みがあれば田中はこのコマのどの机にも居ない。休みが無ければテンプレどおり 1 机（講師欄 2 行の上段を含む）。
        expect(upperTeachers(nextState).filter((name) => name === '田中').length, label).toBe(restedTanaka(nextState) ? 0 : 1)
        // INV-01: 同じ講師はこのコマの 1 机まで（上段）。
        expect(new Set(upperTeachers(nextState)).size, label).toBe(upperTeachers(nextState).length)
        // 生徒は休みでも残る（A・B の 2 人がこのコマに居る）。
        expect(liveIds(nextState.weeks, WED_CELL).sort(), label).toEqual(['sA', 'sB'])
        expectNoViolation(nextState, nextRows, label)
        expectFixpoint(nextState, nextRows)
        expectIdempotentResave(nextState, nextRows, `${label} の再保存`)
        rows = nextRows
        state = nextState
      }
    })
  }
})

// 第 2 版 段 4（spec-template-conflict-v2 §3・INV-03）: 丸ごと振替の付け替えのある盤面でも、保存は 1 回で決まる（2 回目の保存・再マージで変わらない）。
describe('INV-03 シーケンス: 丸ごと振替の付け替え（第 2 版・段 4）', () => {
  it('付け替え → テンプレ保存 → もう一度保存 → 再マージ で盤面が変わらず、同じ組を 2 回作れない（1 操作 1 適用）', () => {
    const paired = pairFx.pairedOrThrow(pairFx.pairOf(pairFx.remerge(pairFx.buildBoard(), pairFx.ROWS, [])))
    const rows = [pairFx.row('r0', 't1', 'sA', 'sC'), pairFx.ROWS[1], pairFx.ROWS[2]]
    const first = pairFx.save(paired.nextWeeks, rows, paired.nextSuppressedRegularLessonOccurrences)
    const second = pairFx.save(first.nextWeeks, rows, paired.nextSuppressedRegularLessonOccurrences, { templatePendingDesks: first.nextPendingDesks, previousRegularLessons: rows })
    expect(pairFx.snapshot(second.nextWeeks)).toBe(pairFx.snapshot(first.nextWeeks))
    expect(pairFx.snapshot(pairFx.remerge(second.nextWeeks, rows, paired.nextSuppressedRegularLessonOccurrences, pairFx.settings(), second.nextPendingDesks))).toBe(pairFx.snapshot(first.nextWeeks))
    expect(pairFx.pairOf(first.nextWeeks, { rows, suppressed: paired.nextSuppressedRegularLessonOccurrences }).status).toBe('blocked')
    const violations = auditTemplateLessonAccounting({
      weeks: second.nextWeeks, regularLessons: rows, students: pairFx.students, classroomSettings: pairFx.settings(), scheduleCountAdjustments: [], manualMakeupAdjustments: {},
      fromDate: pairFx.D, toDate: '2026-10-18', suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences,
    })
    expect(violations, describeLessonAccountingViolations(violations)).toEqual([])
  })
})
