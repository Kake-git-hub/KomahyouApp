// 確認リストの「準備する」（checklistPrep.ts）が作った形を、実際のテンプレ保存（第 2 版の差分反映 computeTemplateDiffApplyForBoard）に通す結合テスト
// （regression-reviewer 要修正 1・テスト不足 6・2026-11-06）。
//   (a) v2-1: 準備を当てた週をテンプレを変えずに保存しても講師欄の 2 行（保留の lower.teacher）が出ない（並び替えた週でも同じ）＝確認リスト v2-1 の目安
//       「緑の 2 行は出ず、講師が入れ替わらず、同じ講師が 2 机に出ない」と食い違わない（INV-02）。
//   (b) tp-64: 準備を当てた週を保存すると (1) の机が講師欄 2 行（teacher-pending）になる。(1)・(2) の席 2 をテンプレに登録した保存では
//       (1) の机は講師欄 2 行＋席 2 も 2 行、(2) の机は席 2 だけ 2 行で講師欄は 1 行（＝確認リスト tp-64 の目安）。
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { applyChecklistPrepOps, planChecklistPrep } from './checklistPrep'
import { cleanupChecklistPrepBoard } from './checklistPrepTemplate'
import { packSortCellDesks } from './deskSort'
import { buildManagedScheduleCellsForRange, computeTemplateDiffApplyForBoard, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { applyTemplatePendingLowerTeacherToDesk, buildTeacherAliasResolver } from './templateDiffApply'
import { computePendingTeacherChoice } from './templatePendingResolution'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { DeskCell, SlotCell } from './types'

// 木曜 2026-10-08 の 5 限（反映開始日 10/7 の翌日）。机 6 つ（テンプレは 机 1=田中＋A・机 2=鈴木＋B・机 3=佐藤だけ・机 4〜6 は空）。
const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-08'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-09-29'

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const students = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉'), studentRow('sD', '土屋')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤'), teacherRow('t4', '高木')]
const aliases = buildTeacherAliasResolver(teachers)

function row(id: string, teacherId: string, student1Id = '', subject1 = '', student2Id = '', subject2 = ''): RegularLessonRow {
  return {
    id, schoolYear: 2026, teacherId, student1Id, subject1, startDate: '', endDate: '', student2Id, subject2, student2StartDate: '', student2EndDate: '',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: SLOT,
  }
}

const ROWS = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]

function settings(): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 6, templateFreezeBeforeDate: EFFECTIVE } as ClassroomSettings
}

function buildWeek(): SlotCell[] {
  return buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
    fallbackStartDate: WEEK_START,
    fallbackEndDate: WEEK_END,
    classroomSettings: settings(),
    teachers,
    students,
    regularLessons: ROWS,
    boardWeeks: [],
  })
}

function cellOf(weeks: SlotCell[][]) {
  const cell = weeks.flat().find((entry) => entry.id === CELL_ID)
  if (!cell) throw new Error(`cell ${CELL_ID} not found`)
  return cell
}

/** 準備を当てた週（置き場は 10/8 5 限に絞って選ぶ）。 */
function preparedWeek(itemId: 'v2-1' | 'tp-64') {
  const week = buildWeek()
  const plan = planChecklistPrep({
    itemId, weeks: [[cellOf([week])]], todayKey: TODAY_KEY, effectiveStartDate: EFFECTIVE, templatePendingDesks: {}, teachers, teacherAliases: aliases,
  })
  if (!plan.ok) throw new Error(`plan failed: ${plan.reason}`)
  expect(plan.cellId).toBe(CELL_ID)
  const applied = applyChecklistPrepOps([week], plan.ops, aliases, { now: 1 })
  expect(applied.skipped).toBe(0)
  return { week: applied.weeks[0], plan }
}

/** テンプレ保存（盤面の保存と同じく保存前のテンプレの行を渡す）＋結果が再マージの不動点であること。 */
function save(week: SlotCell[], newRows: RegularLessonRow[], options: { pendingDesks?: TemplatePendingDeskMap; previousRows?: RegularLessonRow[] } = {}) {
  const saved = computeTemplateDiffApplyForBoard({
    weeks: [week], classroomSettings: settings(), teachers, students, regularLessons: newRows, effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: [], templatePendingDesks: options.pendingDesks ?? {}, createdAt: '2026-09-29T10:00:00.000Z', manualMakeupAdjustments: {},
    scheduleCountAdjustments: [], previousRegularLessons: options.previousRows ?? ROWS,
  })
  const remerged = remergeBoardWeeksWithManagedData(saved.nextWeeks, {
    classroomSettings: settings(), teachers, students, regularLessons: newRows, suppressedRegularLessonOccurrences: saved.addedSuppressedRegularLessonOccurrences,
    todayKey: TODAY_KEY, templateOriginRules: { pendingDesks: saved.nextPendingDesks },
  })
  expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  return saved
}

function lowerOf(pending: TemplatePendingDeskMap, desk: DeskCell) {
  return pending[buildTemplatePendingDeskKey(CELL_ID, desk.id)]?.lower
}

const names = (desk: DeskCell) => (desk.lesson?.studentSlots ?? [null, null]).map((student) => student?.name ?? null)

function expectV21Shape(saved: ReturnType<typeof save>) {
  const desks = cellOf(saved.nextWeeks).desks
  // 緑の 2 行（保留）は 1 つも出ない（講師の 2 行も・席の 2 行も）。
  expect(saved.nextPendingDesks).toEqual({})
  // テンプレの机はテンプレの机番号のまま（講師が入れ替わらない）。
  expect(desks.slice(0, 3).map((desk) => desk.teacher)).toEqual(['田中', '鈴木', '佐藤'])
  expect(names(desks[0])).toEqual(['青木', null])
  expect(names(desks[1])).toEqual(['馬場', null])
  // 体験 2 人は同じ机のまま（講師なし）。メモと手で置いた講師も残る。
  const trialDesk = desks.find((desk) => names(desk).includes('確認用 体験1'))!
  expect(names(trialDesk)).toEqual(['確認用 体験1', '確認用 体験2'])
  expect(trialDesk.teacher).toBe('')
  expect(desks.filter((desk) => desk.memoSlots?.includes('確認用メモ1'))).toHaveLength(1)
  const manualTeacherDesks = desks.filter((desk) => desk.teacher === '高木')
  expect(manualTeacherDesks).toHaveLength(1)
  expect(manualTeacherDesks[0]).toMatchObject({ manualTeacher: true, teacherAssignmentSource: 'manual' })
  // 同じ講師が 2 机に出ない。
  const teacherNames = desks.map((desk) => desk.teacher).filter(Boolean)
  expect(new Set(teacherNames).size).toBe(teacherNames.length)
}

describe('v2-1 の準備 → テンプレを変えずに保存（要修正 1）', () => {
  it('講師欄の 2 行（保留の lower.teacher）が出ない・テンプレの机も準備も崩れない', () => {
    const { week } = preparedWeek('v2-1')
    expectV21Shape(save(week, ROWS))
  })

  it('「上に詰めて並び替え」をした週でも同じ（案 A: 保存の直前にテンプレの並びへ戻る）', () => {
    const { week } = preparedWeek('v2-1')
    const sorted = week.map((cell) => (cell.id === CELL_ID ? { ...cell, desks: packSortCellDesks(cell, { skipStatusSlotPack: true }) } : cell))
    // 並び替えで机の並びが変わった（＝テンプレの机番号と盤面の机がずれた週を保存に通している）。
    // 体験 2 人の机（2 人の机）が机 1 へ・テンプレの 1 人の机がその後へ詰まる。
    expect(names(cellOf([sorted]).desks[0])).toEqual(['確認用 体験1', '確認用 体験2'])
    expect(cellOf([sorted]).desks.slice(1, 3).map((desk) => desk.teacher)).toEqual(['田中', '鈴木'])
    expectV21Shape(save(sorted, ROWS))
  })
})

describe('tp-64 の準備 → テンプレ保存（テスト不足 6(b)）', () => {
  it('テンプレを変えずに保存すると (1) の机は講師欄 2 行（上=テンプレの講師・下=手で置いた講師）、(2) の机は講師欄 1 行', () => {
    const { week, plan } = preparedWeek('tp-64')
    const firstIndex = plan.ops.find((op) => op.kind === 'manual-teacher')!.deskIndex
    const secondIndex = plan.ops.filter((op) => op.kind === 'trial').map((op) => op.deskIndex).find((index) => index !== firstIndex)!
    const saved = save(week, ROWS)
    const desks = cellOf(saved.nextWeeks).desks
    expect(desks[firstIndex].teacher).toBe('田中')
    expect(lowerOf(saved.nextPendingDesks, desks[firstIndex])?.teacher).toMatchObject({ teacher: '高木', manualTeacher: true })
    expect(lowerOf(saved.nextPendingDesks, desks[secondIndex])?.teacher).toBeUndefined()
  })

  it('(1)・(2) の席 2 をテンプレに登録して保存: (1) は講師欄 2 行＋席 2 も 2 行、(2) は席 2 だけ 2 行で講師欄は 1 行', () => {
    const { week, plan } = preparedWeek('tp-64')
    const firstIndex = plan.ops.find((op) => op.kind === 'manual-teacher')!.deskIndex
    const secondIndex = plan.ops.filter((op) => op.kind === 'trial').map((op) => op.deskIndex).find((index) => index !== firstIndex)!
    expect([firstIndex, secondIndex]).toEqual([0, 1])
    const saved = save(week, [row('r0', 't1', 'sA', '数', 'sC', '数'), row('r1', 't2', 'sB', '数', 'sD', '数'), row('r2', 't3')])
    const desks = cellOf(saved.nextWeeks).desks
    const first = lowerOf(saved.nextPendingDesks, desks[0])
    expect(first?.teacher).toMatchObject({ teacher: '高木' })
    expect(first?.lesson?.studentSlots.map((student) => student?.name ?? null)).toEqual([null, '確認用 体験1'])
    expect(names(desks[0])).toEqual(['青木', '千葉'])
    const second = lowerOf(saved.nextPendingDesks, desks[1])
    expect(second?.teacher).toBeUndefined()
    expect(second?.lesson?.studentSlots.map((student) => student?.name ?? null)).toEqual([null, '確認用 体験2'])
    expect(desks[1].teacher).toBe('鈴木')
    expect(names(desks[1])).toEqual(['馬場', '土屋'])
  })
})

describe('準備の印（checklistPrepTeacher）→ テンプレ保存 → 後片づけ（第 2 段・§E-2-4-2）', () => {
  const REGISTERED_ROWS = () => [row('r0', 't1', 'sA', '数', 'sC', '数'), row('r1', 't2', 'sB', '数', 'sD', '数'), row('r2', 't3')]

  it('テンプレ保存で講師欄が 2 行になると、印は下の行の講師へ移り、上の行（テンプレの講師）には残らない', () => {
    const { week } = preparedWeek('tp-64')
    expect(cellOf([week]).desks[0].checklistPrepTeacher).toBe(true)
    const saved = save(week, REGISTERED_ROWS())
    const desks = cellOf(saved.nextWeeks).desks
    expect(desks[0].teacher).toBe('田中')
    expect(desks[0].checklistPrepTeacher).toBeUndefined()
    expect(lowerOf(saved.nextPendingDesks, desks[0])?.teacher).toMatchObject({ teacher: '高木', checklistPrepTeacher: true })
    expect(desks.some((desk) => desk.checklistPrepTeacher)).toBe(false)
  })

  it('後片づけ: 下の行の準備の講師と確認用の体験が消え、保留が無くなって (1) の机はテンプレの講師の 1 行に戻る（もう一度保存しても 2 行に戻らない）', () => {
    const { week } = preparedWeek('tp-64')
    const saved = save(week, REGISTERED_ROWS())
    const cleaned = cleanupChecklistPrepBoard(saved.nextWeeks, saved.nextPendingDesks)
    expect(cleaned.removed).toEqual({ trials: 2, memos: 0, teachers: 1 })
    expect(cleaned.pendingDesks).toEqual({})
    const desks = cellOf(cleaned.weeks).desks
    expect(desks[0].teacher).toBe('田中')
    expect(names(desks[0])).toEqual(['青木', '千葉'])
    expect(desks[1].teacher).toBe('鈴木')
    expect(names(desks[1])).toEqual(['馬場', '土屋'])
    // テンプレを元へ戻して保存（後片づけのテンプレ保存と同じ向き）: 保留は出ず、確認用の体験・準備の講師はどこにも居ない。
    const resaved = save(cleaned.weeks[0], ROWS, { pendingDesks: cleaned.pendingDesks ?? {}, previousRows: REGISTERED_ROWS() })
    expect(resaved.nextPendingDesks).toEqual({})
    const after = cellOf(resaved.nextWeeks).desks
    expect(after.map((desk) => desk.teacher).filter(Boolean)).toEqual(['田中', '鈴木', '佐藤'])
    expect(after.flatMap(names).filter(Boolean)).toEqual(['青木', '馬場'])
  })

  it('「手入力の講師を採用」で下の行の準備の講師を机へ戻すと印も一緒に戻る（後片づけで消える）', () => {
    const { week } = preparedWeek('tp-64')
    const saved = save(week, REGISTERED_ROWS())
    const deskId = cellOf(saved.nextWeeks).desks[0].id
    const chosen = computePendingTeacherChoice({ weeks: saved.nextWeeks, templatePendingDesks: saved.nextPendingDesks, cellId: CELL_ID, deskId, choice: 'manual', teacherAliases: aliases })
    if (chosen.status !== 'applied') throw new Error(`choice failed: ${chosen.status}`)
    expect(cellOf(chosen.nextWeeks).desks[0]).toMatchObject({ teacher: '高木', checklistPrepTeacher: true })
    const cleaned = cleanupChecklistPrepBoard(chosen.nextWeeks, chosen.nextTemplatePendingDesks)
    expect(cleaned.removed.teachers).toBe(1)
    expect(cellOf(cleaned.weeks).desks[0].teacher).toBe('')
  })

  it('机の講師の写し: 印は講師と一緒に動き、テンプレの講師に替わると外れる（applyTemplatePendingLowerTeacherToDesk）', () => {
    const desk: DeskCell = { id: 'd1', teacher: '田中', lesson: { id: 'managed_r0', studentSlots: [null, null] } }
    expect(applyTemplatePendingLowerTeacherToDesk(desk, { teacher: '高木', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true })).toMatchObject({ teacher: '高木', checklistPrepTeacher: true })
    const marked: DeskCell = { id: 'd1', teacher: '高木', manualTeacher: true, teacherAssignmentSource: 'manual', checklistPrepTeacher: true }
    expect('checklistPrepTeacher' in applyTemplatePendingLowerTeacherToDesk(marked, { teacher: '田中', manualTeacher: false })).toBe(false)
  })
})
