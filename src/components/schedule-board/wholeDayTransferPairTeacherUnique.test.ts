// Issue #87（INV-01・2026-11-12 オーナー決定「作る前に止める」・docs/spec-template-conflict-v2.md §3・§9-28）:
// 丸ごと振替（第 2 版の付け替え）で、元の日 D の手置きの講師 X が振替先 D' の同じ時限の別の机にも居ると、作成のあと D' のそのコマで X が 2 机になっていた
// （D の手置き講師は D' の同じ番号の机へ移り、重なりの検査は同じ番号の机どうしだけを見ていた）。作成の結果の盤面で「同じ講師が 1 コマに 2 机」に
// 新しくなるなら作らずに止める。解除（D へ戻す）も同じ考えで止める。結果が 1 机に収まる形（D' 自身のテンプレの X が処分で外れる・
// D のテンプレの X が手置きの X に譲る）・埋め草「講師未割当」・講師の休みの記録だけの机は止めない。
import { describe, expect, it } from 'vitest'
import type { TeacherRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { collectNewDuplicateTeachersInCells, computeWholeDayTransferPair } from './ScheduleBoardScreen'
import { balances, buildBoard, cellAt, CREATED_AT, D, D2, pairedOrThrow, pairOf, releaseOf, remerge, row, ROWS, settings, snapshot, students, teachers } from './wholeDayTransferPair.fixture'

const cs = settings({ deskCount: 3 })
const SLOT4 = 4
const base = (rows = ROWS) => structuredClone(remerge(buildBoard(rows, cs), rows, [], cs))
const putManualTeacher = (weeks: SlotCell[][], dateKey: string, deskIndex: number, teacher = '高橋', teacherId: string | undefined = 't4', slotNumber = SLOT4) => {
  const desk = cellAt(weeks, dateKey, slotNumber).desks[deskIndex]
  Object.assign(desk, { teacher, manualTeacher: true, teacherAssignmentSource: 'manual' } satisfies Partial<DeskCell>)
  if (teacherId) desk.teacherAssignmentTeacherId = teacherId
  else delete desk.teacherAssignmentTeacherId
  return desk
}
const teachersAt = (weeks: SlotCell[][], dateKey: string, slotNumber = SLOT4) => cellAt(weeks, dateKey, slotNumber).desks.map((desk) => desk.teacher)
const countTeacher = (weeks: SlotCell[][], dateKey: string, teacher: string, slotNumber = SLOT4) => teachersAt(weeks, dateKey, slotNumber).filter((name) => name === teacher).length
const pairCs = (weeks: SlotCell[][], rows = ROWS) => pairOf(weeks, { classroomSettings: cs, rows })
const trial = (id: string): StudentEntry => ({ id, name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' })

/** D 4限 机 2 と D' 4限 机 3 に同じ手置きの講師（高橋）。 */
function sameTeacherOtherDesk() {
  const weeks = base()
  putManualTeacher(weeks, D, 1)
  putManualTeacher(weeks, D2, 2)
  return remerge(weeks, ROWS, [], cs)
}

describe('Issue #87（INV-01）: 丸ごと振替の作成で同じ講師が 1 コマに 2 机にならない（作る前に止める）', () => {
  it('D 4限 机 2 と D\' 4限 机 3 に同じ手置きの講師 → 作らずに止まり、文に講師と時限が出る。盤面・在庫は何も変わらない', () => {
    const board = sameTeacherOtherDesk()
    expect(countTeacher(board, D, '高橋')).toBe(1)
    expect(countTeacher(board, D2, '高橋')).toBe(1)
    const before = snapshot(board)
    const stockBefore = balances(board, ROWS, {}, cs)
    const result = pairCs(board)
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('同じ講師が 2 つの机に居る形になるため、丸ごと振替できません')
    expect(result.message).toContain(D2)
    expect(result.message).toContain('4限')
    expect(result.message).toContain('高橋')
    expect(result.message).toContain('片づけてからやり直してください')
    // 止まったときは盤面（入力）を書き換えず、組（抑止キー）・保留・在庫の結果を返さない。
    expect(snapshot(board)).toBe(before)
    expect(Object.keys(result)).toEqual(['status', 'message'])
    expect(balances(board, ROWS, {}, cs)).toEqual(stockBefore)
  })

  it('講師 ID だけ・表示名だけの組でも同じ講師として止まる（呼び名の対応表）', () => {
    // D' 側の机は講師 ID を持たない表示名だけ（テンプレから来た机の形）。
    const nameOnly = base()
    putManualTeacher(nameOnly, D, 1)
    putManualTeacher(nameOnly, D2, 2, '高橋', undefined)
    expect(pairCs(nameOnly).status).toBe('blocked')
    // 表示名（displayName）で置いた机と登録名＋講師 ID の机。
    const roster: TeacherRow[] = teachers.map((teacher) => (teacher.id === 't4' ? { ...teacher, displayName: 'タカハシ' } : teacher))
    const aliased = base()
    putManualTeacher(aliased, D, 1)
    putManualTeacher(aliased, D2, 2, 'タカハシ', undefined)
    const result = computeWholeDayTransferPair({
      weeks: aliased, sourceDateKey: D, targetDateKey: D2, classroomSettings: cs, teachers: roster, students, regularLessons: ROWS,
      suppressedRegularLessonOccurrences: [], templatePendingDesks: {}, createdAt: CREATED_AT,
    })
    expect(result.status).toBe('blocked')
  })

  it('対照（今も修正後も作れる）: D\' に同じ講師が居ない／D\' の別の時限に居る／別の講師が居る', () => {
    const absent = base()
    putManualTeacher(absent, D, 1)
    const pairedAbsent = pairedOrThrow(pairCs(remerge(absent, ROWS, [], cs)))
    expect(countTeacher(pairedAbsent.nextWeeks, D2, '高橋')).toBe(1)

    const otherSlot = base()
    putManualTeacher(otherSlot, D, 1)
    putManualTeacher(otherSlot, D2, 2, '高橋', 't4', 5)
    const pairedOtherSlot = pairedOrThrow(pairCs(remerge(otherSlot, ROWS, [], cs)))
    expect(countTeacher(pairedOtherSlot.nextWeeks, D2, '高橋')).toBe(1)
    expect(countTeacher(pairedOtherSlot.nextWeeks, D2, '高橋', 5)).toBe(1)

    const otherTeacher = base()
    putManualTeacher(otherTeacher, D, 1)
    putManualTeacher(otherTeacher, D2, 2, '鈴木', 't2')
    const pairedOtherTeacher = pairedOrThrow(pairCs(remerge(otherTeacher, ROWS, [], cs)))
    expect(teachersAt(pairedOtherTeacher.nextWeeks, D2)).toEqual(['佐藤', '高橋', '鈴木'])
  })

  it('同じ番号の机どうしの重なりは今の文のまま止める（重なりの検査の順番は変えない）', () => {
    const weeks = base()
    putManualTeacher(weeks, D, 1)
    putManualTeacher(weeks, D2, 1, '鈴木', 't2')
    const result = pairCs(remerge(weeks, ROWS, [], cs))
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.message).toContain('4限 2机目の講師')
  })

  it('考えること 1: D\' 自身のテンプレの講師 X が別の机に居る → 処分で外れるので止めない（作成・再マージとも X は 1 机）', () => {
    // 10/14 からだけ有効な 4限の講師だけの行（D' 自身のテンプレの高橋）。D の手置きの高橋は机 3。
    const rows = [...ROWS, row('r9', 't4', '', '', { slotNumber: SLOT4, startDate: D2 })]
    const weeks = base(rows)
    putManualTeacher(weeks, D, 2)
    const board = remerge(weeks, rows, [], cs)
    expect(countTeacher(board, D2, '高橋')).toBe(1)
    expect(teachersAt(board, D2).indexOf('高橋')).not.toBe(2)
    const paired = pairedOrThrow(pairCs(board, rows))
    expect(countTeacher(paired.nextWeeks, D2, '高橋')).toBe(1)
    expect(teachersAt(paired.nextWeeks, D2)[2]).toBe('高橋')
    const reloaded = remerge(paired.nextWeeks, rows, paired.nextSuppressedRegularLessonOccurrences, cs, paired.nextTemplatePendingDesks)
    expect(countTeacher(reloaded, D2, '高橋')).toBe(1)
  })

  it('考えること 2: D のテンプレの講師 X（手置きでない）と D\' の別の机の手置きの X → D のテンプレの X が手置きに譲るので止めない（X は 1 机）', () => {
    // 水 4限 の佐藤は講師だけのテンプレ（机 1）。D' の机 2 に手置きの佐藤。
    const weeks = base()
    putManualTeacher(weeks, D2, 1, '佐藤', 't3')
    const board = remerge(weeks, ROWS, [], cs)
    const paired = pairedOrThrow(pairCs(board))
    expect(countTeacher(paired.nextWeeks, D2, '佐藤')).toBe(1)
    const reloaded = remerge(paired.nextWeeks, ROWS, paired.nextSuppressedRegularLessonOccurrences, cs, paired.nextTemplatePendingDesks)
    expect(countTeacher(reloaded, D2, '佐藤')).toBe(1)
  })

  it('考えること 3: 埋め草「講師未割当」は講師として数えない（D と D\' の別の机に埋め草があっても止めない）', () => {
    const weeks = base()
    const src = putManualTeacher(weeks, D, 1, '講師未割当', undefined)
    src.lesson = { id: 'hand-d', studentSlots: [trial('trial-d'), null] }
    const dst = putManualTeacher(weeks, D2, 2, '講師未割当', undefined)
    dst.lesson = { id: 'hand-d2', studentSlots: [trial('trial-d2'), null] }
    // 作成の結果では埋め草は差分反映と再マージで外れる（講師なしの机）ので、止めない。
    const result = pairCs(weeks)
    expect(result.status).toBe('transferred')
  })

  it('判定の本体: 埋め草・休みの記録だけの机（講師欄は空）・削除記録（講師欄は空）は講師として数えず、本物の講師が新しく 2 机になったコマだけを挙げる', () => {
    const before = base()
    const after = structuredClone(before)
    const desks = cellAt(after, D2, SLOT4).desks
    Object.assign(desks[1], { teacher: '講師未割当', manualTeacher: true, teacherAssignmentSource: 'manual' } satisfies Partial<DeskCell>)
    Object.assign(desks[2], { teacher: '講師未割当' } satisfies Partial<DeskCell>)
    Object.assign(cellAt(after, D2, 5).desks[2], { teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: 't1' } satisfies Partial<DeskCell>)
    Object.assign(cellAt(after, D2, 5).desks[1], { teacherRest: { teacher: '田中', teacherId: 't1' } } satisfies Partial<DeskCell>)
    expect(collectNewDuplicateTeachersInCells(before, after, [D2, D], teachers)).toEqual([])
    // 本物の講師（ID 無しの表示名と ID つき）が同じコマの 2 机 → 挙げる。
    Object.assign(desks[1], { teacher: '佐藤', teacherAssignmentTeacherId: undefined } satisfies Partial<DeskCell>)
    expect(collectNewDuplicateTeachersInCells(before, after, [D2, D], teachers)).toEqual([{ dateKey: D2, slotNumber: SLOT4, teacher: '佐藤' }])
  })

  it('考えること 3: D\' の別の机に X の休みの記録だけがある（講師欄は空）→ 講師として数えず止めない', () => {
    const weeks = base()
    putManualTeacher(weeks, D, 1)
    const restDesk = cellAt(weeks, D2, SLOT4).desks[2]
    Object.assign(restDesk, { teacher: '', manualTeacher: false, teacherRest: { teacher: '高橋', teacherId: 't4' } } satisfies Partial<DeskCell>)
    const paired = pairedOrThrow(pairCs(weeks))
    expect(countTeacher(paired.nextWeeks, D2, '高橋')).toBe(1)
  })

  it('作る前から D\' で同じ講師が 2 机だった形は、丸ごと振替のせいで増えないので止めない（作成で新しく 2 机になる形だけ止める）', () => {
    const weeks = base()
    putManualTeacher(weeks, D2, 1, '鈴木', 't2')
    putManualTeacher(weeks, D2, 2, '鈴木', 't2')
    expect(countTeacher(weeks, D2, '鈴木')).toBe(2)
    expect(pairCs(weeks).status).toBe('transferred')
  })
})

describe('Issue #87（INV-01）の兄弟: 丸ごと振替の解除で同じ講師が 1 コマに 2 机にならない', () => {
  it('作成で D\' へ移した手置きの高橋を戻す D の同じ時限に、あとから別の机へ高橋を手で置いた → 解除を止める（盤面は変えない）', () => {
    const weeks = base()
    putManualTeacher(weeks, D, 1)
    const paired = pairedOrThrow(pairCs(remerge(weeks, ROWS, [], cs)))
    const later = structuredClone(paired.nextWeeks)
    putManualTeacher(later, D, 2)
    const before = snapshot(later)
    const result = releaseOf(later, paired.nextSuppressedRegularLessonOccurrences, { classroomSettings: cs, pendingDesks: paired.nextTemplatePendingDesks })
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('同じ講師が 2 つの机に居る形になるため、丸ごと振替を解除できません')
    expect(result.message).toContain(D)
    expect(result.message).toContain('4限')
    expect(result.message).toContain('高橋')
    expect(snapshot(later)).toBe(before)
  })

  it('対照: あとから置いた講師が別の講師なら解除できる（高橋は D に 1 机で戻る）', () => {
    const weeks = base()
    putManualTeacher(weeks, D, 1)
    const paired = pairedOrThrow(pairCs(remerge(weeks, ROWS, [], cs)))
    const later = structuredClone(paired.nextWeeks)
    putManualTeacher(later, D, 2, '鈴木', 't2')
    const result = releaseOf(later, paired.nextSuppressedRegularLessonOccurrences, { classroomSettings: cs, pendingDesks: paired.nextTemplatePendingDesks })
    if (result.status !== 'transferred') throw new Error(result.message)
    expect(countTeacher(result.nextWeeks, D, '高橋')).toBe(1)
    expect(countTeacher(result.nextWeeks, D, '鈴木')).toBe(1)
  })
})
