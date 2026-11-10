// 確認リストの「準備する」第 3 段（docs/plan-2026-11-07-checklist-auto-prep-stage3.md・spec-developer-report §E-2-4-3）の受け入れテスト。
// 準備（checklistPrep.ts の planChecklistPrep → applyChecklistPrepOps）→ テンプレへの登録（prepareChecklistPrepTemplateSave・講師の登録は新規）→
// 実際のテンプレ保存の差分反映（computeTemplateDiffApplyForBoard）を通し、保存後の形が確認リストの項目の「OK の目安」と合うことを固定する。
//   tp-69: 手置き講師だけの机 → テンプレに別の講師＋確認用の生徒 → 保留（緑）: 上＝テンプレの講師＋確認用の生徒・講師欄の下＝手置き講師。
//   tp-70: 手置き講師＋体験の机 → テンプレに別の講師だけ → 体験は席に 1 行のまま・講師欄だけ上＝テンプレ・下＝手置き。
//   tp-59: 机 A に手置き講師 X＋体験 → テンプレの別の机 B に X＋確認用の生徒 → （2026-11-10 オーナー決定・§9-1 改定）A は B へ合流＝B は X の 1 行で確認用の生徒、
//          体験は同じ席がぶつかるので B の下の行（保留・緑）。A は空き机。「詳細」に「講師が別の机にいる」の行は出ない。
//          （改定前: A は X＋体験の 1 行・B は確認用の生徒だけで講師欄は空＝B の生徒が講師なしになっていた。）
// 第119版（2026-11-07）: 準備の結果の文は「準備しました（日付 時限）。」＋保存の一言の 2 行だけ。保存の中身（確認画面の「詳細」と同じ文）は
// 結果の文に載せなくなったので、保存が返した summary・studentNotes から確認画面と同じ文（buildTemplateDiffConfirmDetail）を作って見る。
// 項目の文に差し込む facts（いつ・どの机・誰）が、その項目の文の {{prep:キー}} を全部埋めることも固定する。
//   mn-1・tp-66: tp-64 と同じ置き方（(1) の机が講師欄も席も緑 2 行）。
// あわせて、ほかの生徒の授業・未消化が動かない（INV-06）、後片づけで準備の印の付いたテンプレの講師だけが外れる（INV-02）、
// 2 回押すと別の机・別の確認用の生徒を使う（INV-12）を固定する。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { applyChecklistPrepOps, planChecklistPrep, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT } from './checklistPrep'
import {
  buildChecklistPrepCleanupMessage,
  buildChecklistPrepDoneMessage,
  completeChecklistPrepFacts,
  describeChecklistPrepTemplateRegistered,
  ensureChecklistPrepStudents,
  planChecklistPrepCleanup,
  prepareChecklistPrepTemplateSave,
  removeChecklistPrepTemplateTeachers,
  resolveChecklistPrepCleanupEffectiveStartDate,
  resolveChecklistPrepStudentCount,
} from './checklistPrepTemplate'
import { buildRegularLessonsFromTemplate, buildTemplateBoardCells, convertTemplateCellsToTemplate, resolveTemplateDiffBaseline, setTemplateEditorDeskTeacher, type RegularLessonTemplate, type RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { buildMakeupStockEntries } from './makeupStock'
import { collectExpectedTemplateLessons } from './templateLessonAccountingOracle'
import { buildManagedScheduleCellsForRange, computeTemplateDiffApplyForBoard, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { buildTeacherAliasResolver, buildTemplateDiffConfirmDetail } from './templateDiffApply'
import { VERIFICATION_CHECKLIST, listChecklistPrepFactTokenKeys } from '../../utils/verificationChecklist'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'

// 木曜 2026-10-08 の 5 限（反映開始日 10/7 の翌日）。机 6 つ。テンプレは 机 1=田中＋青木・机 2=鈴木＋馬場・机 3=佐藤だけ・机 4〜6 は空。
const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-08'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-09-29'
const SAVED_AT = '2026-09-29T10:00:00.000Z'

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const baseStudents = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤'), teacherRow('t4', '高木'), teacherRow('t5', '伊藤'), teacherRow('t6', '上田'), teacherRow('t7', '江藤')]
const aliases = buildTeacherAliasResolver(teachers)
let serial = 0
const roster = ensureChecklistPrepStudents(baseStudents, 4, { todayKey: TODAY_KEY, createId: (taken) => { do { serial += 1 } while (taken.has(`p${serial}`)); return `p${serial}` } }).students

function settings(): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 6, templateFreezeBeforeDate: EFFECTIVE } as ClassroomSettings
}

const BASE_TEMPLATE: RegularLessonTemplate = {
  version: 1,
  effectiveStartDate: EFFECTIVE,
  savedAt: '2026-09-28T00:00:00.000Z',
  cells: [{ dayOfWeek: 4, slotNumber: SLOT, desks: [
    { deskIndex: 1, teacherId: 't1', students: [{ studentId: 'sA', subject: '数' }, null] },
    { deskIndex: 2, teacherId: 't2', students: [{ studentId: 'sB', subject: '数' }, null] },
    { deskIndex: 3, teacherId: 't3', students: [null, null] },
  ] }],
}

const rowsOf = (template: RegularLessonTemplate) => buildRegularLessonsFromTemplate({ template, teachers, students: roster })
const baselineOf = (template: RegularLessonTemplate) => resolveTemplateDiffBaseline({ template, deskCount: 6, teachers, students: roster, todayKey: TODAY_KEY })!

/** 別の日（金曜 5 限）に生徒 千葉 の欠席の記録（振替の未消化 1）。準備・テンプレ保存の前後で未消化が変わらないことを見る（INV-06）。 */
function absentRecord(): StudentStatusEntry {
  return {
    id: 'st-absent', studentId: 'sC', managedStudentId: 'sC', sourceManagedLesson: false, name: '千葉', grade: '中1', subject: '数', lessonType: 'makeup', teacherType: 'normal',
    teacherName: '田中', dateKey: '2026-10-09', slotNumber: SLOT, recordedAt: '2026-10-01T10:00:00Z', status: 'absent', sourceLessonId: 'l-absent', makeupSourceDate: '2026-10-02',
  }
}

function buildWeek(rows: RegularLessonRow[]): SlotCell[] {
  const week = buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
    fallbackStartDate: WEEK_START,
    fallbackEndDate: WEEK_END,
    classroomSettings: settings(),
    teachers,
    students: roster,
    regularLessons: rows,
    boardWeeks: [],
  })
  return week.map((cell) => {
    if (cell.id === `2026-10-09_${SLOT}`) return { ...cell, desks: cell.desks.map((desk, index) => (index === 5 ? { ...desk, statusSlots: [absentRecord(), null] as DeskCell['statusSlots'] } : desk)) }
    // 水曜 4 限に生徒 千葉 の講習 1 コマ（講習の残りが準備の前後で変わらないことを見る・INV-06）。
    if (cell.id === '2026-10-07_4') return { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' as const, lesson: { id: 'special-1', studentSlots: [{ id: 'sp1', name: '千葉', managedStudentId: 'sC', grade: '中1' as const, subject: '数' as const, lessonType: 'special' as const, teacherType: 'normal' as const, manualAdded: true }, null] as [StudentEntry | null, StudentEntry | null] } } : desk)) }
    return cell
  })
}

function cellOf(weeks: SlotCell[][]) {
  const cell = weeks.flat().find((entry) => entry.id === CELL_ID)
  if (!cell) throw new Error(`cell ${CELL_ID} not found`)
  return cell
}

const names = (desk: DeskCell) => (desk.lesson?.studentSlots ?? [null, null]).map((student) => student?.name ?? null)
const lowerOf = (pending: TemplatePendingDeskMap, desk: DeskCell) => pending[buildTemplatePendingDeskKey(CELL_ID, desk.id)]?.lower

type Stage = { week: SlotCell[]; template: RegularLessonTemplate; pendingDesks: TemplatePendingDeskMap }

/** 準備 → テンプレへ登録 → テンプレ保存（コマ表の effect と同じ順）。保存の結果が再マージの不動点であることも見る。 */
function prepareAndSave(itemId: string, stage: Stage, options: { cellIds?: readonly string[] } = {}) {
  const baseline = baselineOf(stage.template)
  const cellIds = options.cellIds ?? [CELL_ID]
  const plan = planChecklistPrep({
    itemId, weeks: [stage.week.filter((cell) => cellIds.includes(cell.id))], todayKey: TODAY_KEY, effectiveStartDate: EFFECTIVE, templatePendingDesks: stage.pendingDesks, teachers, teacherAliases: aliases,
    template: baseline, prepStudents: roster,
  })
  if (!plan.ok) throw new Error(`plan failed: ${plan.reason}`)
  if (!options.cellIds) expect(plan.cellId).toBe(CELL_ID)
  const applied = applyChecklistPrepOps([stage.week], plan.ops, aliases, { now: 1 })
  expect(applied.skipped).toBe(0)
  const prepared = prepareChecklistPrepTemplateSave({
    registrations: plan.templateRegistrations, teacherRegistrations: plan.templateTeacherRegistrations, baseTemplate: baseline, effectiveStartDate: EFFECTIVE, students: roster, savedAt: SAVED_AT,
  })
  if (!prepared.ok) throw new Error(`template failed: ${prepared.reason}`)
  const newRows = rowsOf(prepared.template)
  const saved = computeTemplateDiffApplyForBoard({
    weeks: applied.weeks, classroomSettings: settings(), teachers, students: roster, regularLessons: newRows, effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: [], templatePendingDesks: stage.pendingDesks, createdAt: SAVED_AT, manualMakeupAdjustments: {},
    scheduleCountAdjustments: [], previousRegularLessons: rowsOf(stage.template),
  })
  const remerged = remergeBoardWeeksWithManagedData(saved.nextWeeks, {
    classroomSettings: settings(), teachers, students: roster, regularLessons: newRows, suppressedRegularLessonOccurrences: saved.addedSuppressedRegularLessonOccurrences,
    todayKey: TODAY_KEY, templateOriginRules: { pendingDesks: saved.nextPendingDesks },
  })
  expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  // コマ表の effect と同じ: 結果の文は短く、facts はテンプレへの登録で決まった確認用の生徒の名前を足して返す。
  const message = buildChecklistPrepDoneMessage({ slot: plan.facts.slot, templateSaved: true })
  const facts = completeChecklistPrepFacts(plan.facts, prepared.assigned)
  // 保存の中身（確認画面の「詳細」と同じ文）。結果の文には載せない。
  const detail = buildTemplateDiffConfirmDetail(EFFECTIVE, saved.summary, { todayKey: TODAY_KEY, studentNotes: saved.studentNotes })
  return { plan, prepared, saved, message, facts, detail, next: { week: saved.nextWeeks[0], template: prepared.template, pendingDesks: saved.nextPendingDesks } as Stage }
}

function initialStage(): Stage {
  return { week: buildWeek(rowsOf(BASE_TEMPLATE)), template: BASE_TEMPLATE, pendingDesks: {} }
}

/** テンプレの机（曜日・時限・机番号）。 */
function templateDeskOf(template: RegularLessonTemplate, deskIndex: number) {
  return template.cells.find((cell) => cell.dayOfWeek === 4 && cell.slotNumber === SLOT)!.desks.find((desk) => desk.deskIndex === deskIndex)!
}

function rosterName(id: string) {
  return roster.find((student) => student.id === id)!.name
}

/** 確認用でない生徒の授業（盤面の週の机・席ごと）と、振替の未消化（INV-06）。 */
/** 講習の申し込み数（千葉・数 3 コマ）。残り＝申し込み − 盤面に置いた講習。 */
const LECTURE_REQUESTED = 3
const prepStudentIds = new Set(roster.filter((student) => student.name.startsWith('確認用')).map((student) => student.id))

function othersSnapshot(week: SlotCell[], pendingDesks: TemplatePendingDeskMap, rows: RegularLessonRow[]) {
  // 予定数: テンプレの通常授業の「生徒×科目×日付」の数（確認用でない生徒だけ）。
  const { expected } = collectExpectedTemplateLessons({ weeks: [week], regularLessons: rows, classroomSettings: settings(), fromDate: EFFECTIVE, toDate: WEEK_END })
  const planned = [...expected].filter(([key]) => ![...prepStudentIds].some((id) => key.includes(id))).sort(([left], [right]) => left.localeCompare(right))
  // 講習の残り（確認用でない生徒）。
  const placedSpecial = week.flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.lessonType === 'special' && student.managedStudentId === 'sC').length
  const lectureRemaining = LECTURE_REQUESTED - placedSpecial
  const lessons = week.flatMap((cell) => cell.desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).map((student, seat) => (
    student && !student.name.startsWith('確認用') ? `${cell.id}:${deskIndex}:${seat}:${student.name}:${student.subject}:${student.lessonType}` : null
  )).filter(Boolean)))
  const stock = buildMakeupStockEntries({
    students: roster, teachers, regularLessons: rows, classroomSettings: settings(), weeks: [week], manualAdjustments: {},
    resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id, today: new Date('2026-09-29T00:00:00'), templatePendingDesks: pendingDesks,
  }).map((entry) => ({ key: entry.key, balance: entry.balance }))
  return { lessons, stock, planned, lectureRemaining }
}

describe('tp-69: 手置き講師だけの机にテンプレで別の講師と生徒を登録すると、講師ごと保留（緑）', () => {
  it('準備 → テンプレ保存: 上の行＝テンプレの講師と確認用の生徒、講師欄の下の行＝手置き講師。「詳細」に講師欄を 2 行にする理由が出る', () => {
    const { plan, prepared, saved, message, facts, detail } = prepareAndSave('tp-69', initialStage())
    // 盤面: テンプレの机（机 1〜3）の次の空き机（盤面の机 4）に手置き講師（このコマに居ない最初の在籍講師＝高木）だけ。
    expect(plan.ops).toEqual([{ kind: 'manual-teacher', cellId: CELL_ID, deskIndex: 3, teacherName: '高木', teacherId: 't4' }])
    // テンプレ: 空いている机 4 に別の講師（伊藤）と確認用の生徒。講師の机には準備の印。
    expect(plan.templateTeacherRegistrations.map((entry) => [entry.templateDeskIndex, entry.teacherId])).toEqual([[4, 't5']])
    expect(plan.templateRegistrations.map((entry) => [entry.templateDeskIndex, entry.studentIndex])).toEqual([[4, 0]])
    const registered = templateDeskOf(prepared.template, 4)
    expect(registered).toMatchObject({ teacherId: 't5', checklistPrepTeacherId: 't5' })
    expect(registered.students[0]?.studentId).toBe(prepared.assigned[0].studentId)
    const desk = cellOf(saved.nextWeeks).desks[3]
    expect(desk.teacher).toBe('伊藤')
    expect(names(desk)).toEqual([prepared.assigned[0].studentName, null])
    expect(lowerOf(saved.nextPendingDesks, desk)?.teacher).toMatchObject({ teacher: '高木', manualTeacher: true, checklistPrepTeacher: true })
    expect(lowerOf(saved.nextPendingDesks, desk)?.lesson).toBeUndefined()
    expect(Object.keys(saved.nextPendingDesks)).toHaveLength(1)
    // テンプレのほかの机は動かない。
    expect(cellOf(saved.nextWeeks).desks.slice(0, 3).map((entry) => entry.teacher)).toEqual(['田中', '鈴木', '佐藤'])
    // 保存の中身（確認画面の「詳細」と同じ文）: 講師欄を 2 行にする理由。
    expect(detail).toContain('手で置いた講師の机にテンプレの講師（伊藤）が入るため、講師欄を 2 行（上＝テンプレ／下＝手入力）にします。')
    expect(detail).toContain('手で置いた講師の机をテンプレの講師と重ねて保留（緑）にする机: 1机。')
    expect(detail).not.toContain('手で置いた講師を机に戻さずテンプレに合わせる机')
    // テンプレへの登録の文（途中で止まったときの「ここまでに行ったこと」に使う）。
    expect(describeChecklistPrepTemplateRegistered(prepared.assigned, prepared.assignedTeachers)).toContain('木曜 5限 机 4 に講師「伊藤」')
    // 第119版: 結果の文は 2 行だけ。いつ・どの机・誰は facts（項目の文へ差し込む）。
    expect(message.split('\n')).toHaveLength(2)
    expect(message.split('\n')[0]).toBe('準備しました（10/8(木) 5限）。')
    expect(message).not.toContain('伊藤')
    expect(message).not.toContain('詳細')
    expect(facts).toEqual({ slot: '10/8(木) 5限', deskA: '机 4', X: '高木', Y: '伊藤', A: prepared.assigned[0].studentName })
    // plan.message（盤面で行ったことの詳しい文）は、テンプレ保存の段で止まったときの文に使うので残す。
    expect(plan.message).toContain('10/8(木) 5限 机 4 に講師 高木 を手で置きました')
  })
})

describe('tp-70: 講師だけのテンプレ机と同じ番号に手置き講師と手で置いた生徒（体験）', () => {
  it('準備 → テンプレ保存: 体験は席に 1 行のまま（生徒の席は緑にならない）。講師欄だけ上＝テンプレの講師・下＝手置き講師', () => {
    const { plan, prepared, saved, message, facts, detail } = prepareAndSave('tp-70', initialStage())
    expect(plan.ops.map((op) => [op.kind, op.deskIndex])).toEqual([['manual-teacher', 3], ['trial', 3]])
    // テンプレには講師だけ（確認用の生徒は登録しない）。
    expect(plan.templateRegistrations).toEqual([])
    expect(prepared.assigned).toEqual([])
    expect(templateDeskOf(prepared.template, 4)).toMatchObject({ teacherId: 't5', checklistPrepTeacherId: 't5', students: [null, null] })
    const desk = cellOf(saved.nextWeeks).desks[3]
    expect(desk.teacher).toBe('伊藤')
    expect(names(desk)).toEqual(['確認用 体験1', null])
    const lower = lowerOf(saved.nextPendingDesks, desk)
    expect(lower?.teacher).toMatchObject({ teacher: '高木', manualTeacher: true, checklistPrepTeacher: true })
    expect(lower?.lesson).toBeUndefined()
    expect(describeChecklistPrepTemplateRegistered(prepared.assigned, prepared.assignedTeachers)).toContain('木曜 5限 机 4 に講師「伊藤」')
    expect(detail).toContain('テンプレのこの机は講師だけなので、手で置いた 確認用 体験1 は席に残ります。')
    expect(message.split('\n')).toHaveLength(2)
    expect(facts).toEqual({ slot: '10/8(木) 5限', deskA: '机 4', X: '高木', Y: '伊藤', trial: '確認用 体験1' })
  })
})

describe('tp-59: 手置き講師 X の机があるコマで、テンプレが別の机に X を生徒つきで置く', () => {
  // 2026-11-10 オーナー決定・§9-1 改定（spec §2-3「同じ講師として合流する」・緑が丘の報告「テンプレで入れた先生が消えちゃう」）: 改定前は「机 A は X＋体験の 1 行・
  // 机 B は確認用の生徒だけで講師欄は空・詳細に講師 X の行（teacher-elsewhere）」を固定していた。改定後は、机 A（授業の手がかりの無い手置き講師の机）を B へ合流させる。
  // 準備の手順（ops・テンプレへの登録・facts）は変えていないので、変えたのは保存後の形と「詳細」の期待だけ。
  it('準備 → テンプレ保存: 机 A は机 B へ合流。B は X の 1 行（講師欄は 1 行）で確認用の生徒・体験は同じ席がぶつかるので B の下の行（緑）。A は空き机。「詳細」に講師 X の「別の机」の行は出ない', () => {
    const { plan, prepared, saved, message, facts, detail } = prepareAndSave('tp-59', initialStage())
    // 机 A は盤面の机 5（机 B が入る盤面の机 4 は空けておく）。
    expect(plan.ops.map((op) => [op.kind, op.deskIndex])).toEqual([['manual-teacher', 4], ['trial', 4]])
    expect(plan.ops[0]).toMatchObject({ teacherName: '高木', teacherId: 't4' })
    expect(plan.templateTeacherRegistrations.map((entry) => [entry.templateDeskIndex, entry.teacherId])).toEqual([[4, 't4']])
    expect(plan.templateRegistrations.map((entry) => [entry.templateDeskIndex, entry.studentIndex])).toEqual([[4, 0]])
    const desks = cellOf(saved.nextWeeks).desks
    // B（盤面の机 4）: 手置きの X（高木）の 1 行＋確認用の生徒。体験は同じ席（生徒 1）がぶつかるので B の下の行（保留・緑）。講師欄は 2 行にならない（下の行に講師なし）。
    expect(desks[3]).toMatchObject({ teacher: '高木', manualTeacher: true, teacherAssignmentSource: 'manual' })
    expect(names(desks[3])).toEqual([prepared.assigned[0].studentName, null])
    expect(Object.keys(saved.nextPendingDesks)).toEqual([buildTemplatePendingDeskKey(CELL_ID, desks[3].id)])
    const lowerB = saved.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desks[3].id)].lower
    expect(lowerB.lesson?.studentSlots.map((student) => student?.name ?? null)).toEqual(['確認用 体験1', null])
    expect(lowerB.teacher).toBeUndefined()
    expect(desks[3].templateTeacherDeclined).toBeUndefined()
    // A（盤面の机 5）: 空き机（X も体験も B へ移った）。
    expect(desks[4].teacher).toBe('')
    expect(names(desks[4])).toEqual([null, null])
    // X は 1 つの机だけ・生徒の居る机に講師欄が空の机が無い。
    expect(desks.filter((desk) => desk.teacher === '高木')).toHaveLength(1)
    expect(desks.filter((desk) => !desk.teacher && names(desk).some(Boolean))).toEqual([])
    expect(detail).not.toContain('手で置いた同じ講師が先にあるため')
    expect(saved.studentNotes.filter((note) => note.kind === 'teacher-elsewhere')).toEqual([])
    expect(message.split('\n')).toHaveLength(2)
    expect(facts).toEqual({ slot: '10/8(木) 5限', deskA: '机 5', deskB: '机 4', X: '高木', trial: '確認用 体験1', A: prepared.assigned[0].studentName })
  })

  it('何も変えずにもう一度テンプレを保存しても形は変わらない', () => {
    const first = prepareAndSave('tp-59', initialStage())
    const rows = rowsOf(first.prepared.template)
    const again = computeTemplateDiffApplyForBoard({
      weeks: [first.next.week], classroomSettings: settings(), teachers, students: roster, regularLessons: rows, effectiveStartDate: EFFECTIVE,
      suppressedRegularLessonOccurrences: [], templatePendingDesks: first.next.pendingDesks, createdAt: SAVED_AT, manualMakeupAdjustments: {},
      scheduleCountAdjustments: [], previousRegularLessons: rows,
    })
    expect(cellOf(again.nextWeeks)).toEqual(cellOf([first.next.week]))
    // 2026-11-10 オーナー決定・§9-1 改定: 合流した B の下の行（体験）が 1 机あるので、保存し直しても同じ保留のまま（改定前は保留なし）。
    expect(again.nextPendingDesks).toEqual(first.next.pendingDesks)
    expect(Object.keys(again.nextPendingDesks)).toHaveLength(1)
  })
})

describe('mn-1・tp-66: tp-64 と同じ置き方（(1) の机が講師欄も席も緑 2 行）', () => {
  for (const itemId of ['mn-1', 'tp-66']) {
    it(`${itemId}: 準備 → テンプレ保存で (1) の机は講師欄 2 行（下＝準備の講師）＋席 2 行、(2) の机は席だけ 2 行`, () => {
      const { plan, prepared, saved } = prepareAndSave(itemId, initialStage())
      expect(plan.templateTeacherRegistrations).toEqual([])
      expect(prepared.assigned.map((entry) => entry.label)).toEqual(['(1)', '(2)'])
      const desks = cellOf(saved.nextWeeks).desks
      const first = lowerOf(saved.nextPendingDesks, desks[0])
      expect(desks[0].teacher).toBe('田中')
      expect(first?.teacher).toMatchObject({ manualTeacher: true, checklistPrepTeacher: true })
      expect(first?.lesson?.studentSlots.map((student) => student?.name ?? null)).toEqual([null, '確認用 体験1'])
      expect(names(desks[0])).toEqual(['青木', prepared.assigned[0].studentName])
      const second = lowerOf(saved.nextPendingDesks, desks[1])
      expect(second?.teacher).toBeUndefined()
      expect(second?.lesson?.studentSlots.map((student) => student?.name ?? null)).toEqual([null, '確認用 体験2'])
      expect(Object.keys(saved.nextPendingDesks)).toHaveLength(2)
    })
  }
})

describe('ほかの生徒の授業と未消化は動かない（INV-06）', () => {
  for (const itemId of ['tp-69', 'tp-70', 'tp-59', 'mn-1', 'tp-66']) {
    it(`${itemId}: 準備＋テンプレ保存の前後で、確認用でない生徒の授業の位置と振替の未消化が同じ`, () => {
      const stage = initialStage()
      const before = othersSnapshot(stage.week, stage.pendingDesks, rowsOf(stage.template))
      expect(before.stock.length).toBeGreaterThan(0)
      expect(before.planned.length).toBeGreaterThan(0)
      expect(before.lectureRemaining).toBe(LECTURE_REQUESTED - 1)
      const { next, saved } = prepareAndSave(itemId, stage)
      expect(othersSnapshot(next.week, saved.nextPendingDesks, rowsOf(next.template))).toEqual(before)
      // 予定数の補正（希望回数の −1）と未消化の台帳には何も積まない。
      expect(saved.wholeDayTransferCountAdjustments).toEqual([])
      expect(saved.manualMakeupOriginAdditions).toEqual([])
      expect(saved.manualMakeupOriginRemovals).toEqual([])
      // 足した生徒は体験（手入力）か確認用の生徒だけ。
      const added = next.week.flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.name.startsWith('確認用'))
      expect(added.every((student) => student?.lessonType === 'trial' ? student.manualAdded === true : student?.name.startsWith('確認用 生徒'))).toBe(true)
    })
  }
})

describe('後片づけ: 準備の印の付いたテンプレの講師と確認用の生徒の登録だけを外す（INV-02）', () => {
  for (const itemId of ['tp-69', 'tp-70', 'tp-59']) {
    it(`${itemId}: 盤面の準備・保留の下の行の講師が消え、テンプレは準備の前と同じ机に戻る。印の無い講師（田中・鈴木・佐藤）は残る`, () => {
      const { next } = prepareAndSave(itemId, initialStage())
      const cleanup = planChecklistPrepCleanup({ weeks: [next.week], pendingDesks: next.pendingDesks, savedTemplate: next.template, students: roster, toSaveTemplate: (template) => template })
      if (cleanup.nothing) throw new Error('nothing to clean')
      expect(cleanup.templateTeachersRemoved).toBe(1)
      expect(cleanup.template).not.toBeNull()
      const cleaned = cleanup.template!
      expect(templateDeskOf(cleaned, 4)).toEqual({ deskIndex: 4, teacherId: '', students: [null, null] })
      expect([1, 2, 3].map((index) => templateDeskOf(cleaned, index).teacherId)).toEqual(['t1', 't2', 't3'])
      // 盤面の準備（体験・手置き講師）も消える。
      expect(cleanup.removed.teachers).toBe(1)
      // 後片づけのテンプレを保存すると、盤面は準備の前と同じ（保留も確認用も無い）。
      const resaved = computeTemplateDiffApplyForBoard({
        weeks: cleanup.weeks, classroomSettings: settings(), teachers, students: roster, regularLessons: rowsOf(cleaned), effectiveStartDate: EFFECTIVE,
        suppressedRegularLessonOccurrences: [], templatePendingDesks: cleanup.pendingDesks ?? {}, createdAt: SAVED_AT, manualMakeupAdjustments: {},
        scheduleCountAdjustments: [], previousRegularLessons: rowsOf(next.template),
      })
      expect(resaved.nextPendingDesks).toEqual({})
      const desks = cellOf(resaved.nextWeeks).desks
      expect(desks.map((desk) => desk.teacher)).toEqual(['田中', '鈴木', '佐藤', '', '', ''])
      expect(desks.flatMap(names).filter(Boolean)).toEqual(['青木', '馬場'])
      const text = buildChecklistPrepCleanupMessage({ removed: cleanup.removed, templateRemoved: cleanup.templateRemoved, templateTeachersRemoved: cleanup.templateTeachersRemoved, templateSaved: { effectiveStartDate: EFFECTIVE, todayKey: TODAY_KEY, summary: resaved.summary } })
      expect(text).toContain('準備で登録した講師 1 人を外して、テンプレを保存しました。')
    })
  }

  it('印の付いた机でも講師が替わっていれば（印の講師と違う）講師は外さず、古い印だけ外す。印の無い講師は外さない', () => {
    const { next } = prepareAndSave('tp-69', initialStage())
    const swapped: RegularLessonTemplate = {
      ...next.template,
      cells: next.template.cells.map((cell) => ({ ...cell, desks: cell.desks.map((desk) => (desk.deskIndex === 4 ? { ...desk, teacherId: 't6' } : desk)) })),
    }
    const cleanup = planChecklistPrepCleanup({ weeks: [next.week], pendingDesks: next.pendingDesks, savedTemplate: swapped, students: roster, toSaveTemplate: (template) => template })
    if (cleanup.nothing) throw new Error('nothing to clean')
    expect(cleanup.templateTeachersRemoved).toBe(0)
    expect(templateDeskOf(cleanup.template!, 4)).toEqual({ deskIndex: 4, teacherId: 't6', students: [null, null] })
  })
})

describe('2 回押すと別の机・別の確認用の生徒を使い、同じ曜日・時限に同じ確認用の生徒を 2 か所に登録しない（INV-12）', () => {
  for (const itemId of ['tp-69', 'tp-70', 'tp-59']) {
    it(`${itemId}: 1 回目の保存の後にもう一度準備すると、テンプレの次の空き机・盤面の別の机を使う`, () => {
      const first = prepareAndSave(itemId, initialStage())
      // tp-59 は同じコマに机 A と机 B の 2 つの空き机が要るので、このコマで足りなければ次のコマ（金曜 5 限）を使う。
      const second = prepareAndSave(itemId, first.next, { cellIds: [CELL_ID, `2026-10-09_${SLOT}`] })
      const placed = (result: typeof first) => result.plan.ops.map((op) => `${op.cellId}:${op.deskIndex}`)
      for (const key of placed(second)) expect(placed(first), key).not.toContain(key)
      if (second.plan.cellId === CELL_ID) {
        expect(second.plan.templateTeacherRegistrations[0].templateDeskIndex).toBeGreaterThan(first.plan.templateTeacherRegistrations[0].templateDeskIndex)
      }
      const cell = second.prepared.template.cells.find((entry) => entry.dayOfWeek === 4 && entry.slotNumber === SLOT)!
      const ids = cell.desks.flatMap((desk) => desk.students.map((student) => student?.studentId).filter(Boolean))
      expect(new Set(ids).size).toBe(ids.length)
      // 手置き講師・テンプレの講師は、どちらもこのコマに 1 回だけ。
      const teacherIds = cell.desks.map((desk) => desk.teacherId).filter(Boolean)
      expect(new Set(teacherIds).size).toBe(teacherIds.length)
      expect(rosterName(second.prepared.assigned[0]?.studentId ?? 'p1')).toMatch(/^確認用 生徒/u)
    })
  }
})

describe('2 回準備した後の後片づけ: 1 回目の印は 2 回目の準備の土台（在籍の絞り込み）を通っても残り、両方の講師を外す', () => {
  for (const itemId of ['tp-69', 'tp-70', 'tp-59']) {
    it(`${itemId}: テンプレの準備の講師 2 人と確認用の生徒の登録だけを外し、テンプレは準備の前の机に戻る`, () => {
      const first = prepareAndSave(itemId, initialStage())
      const second = prepareAndSave(itemId, first.next, { cellIds: [CELL_ID, `2026-10-09_${SLOT}`] })
      const cleanup = planChecklistPrepCleanup({ weeks: [second.next.week], pendingDesks: second.next.pendingDesks, savedTemplate: second.next.template, students: roster, toSaveTemplate: (template) => template })
      if (cleanup.nothing) throw new Error('nothing to clean')
      expect(cleanup.templateTeachersRemoved).toBe(2)
      const contentDesks = cleanup.template!.cells.flatMap((cell) => cell.desks.filter((desk) => desk.teacherId || desk.students.some(Boolean)).map((desk) => `${cell.dayOfWeek}_${cell.slotNumber}_${desk.deskIndex}_${desk.teacherId}`))
      expect(contentDesks).toEqual(['4_5_1_t1', '4_5_2_t2', '4_5_3_t3'])
    })
  }
})

describe('テンプレの机と盤面の机の対応（盤面は詰めて置く・机番号 + 1 で決めない）', () => {
  it('テンプレに中身の無い机が途中にあっても、新しい机は中身のある机の後ろの空き机に登録し、盤面ではテンプレの机の次の机に入る', () => {
    const gap: RegularLessonTemplate = {
      ...BASE_TEMPLATE,
      cells: [{ dayOfWeek: 4, slotNumber: SLOT, desks: [
        { deskIndex: 1, teacherId: 't1', students: [{ studentId: 'sA', subject: '数' }, null] },
        { deskIndex: 2, teacherId: '', students: [null, null] },
        { deskIndex: 3, teacherId: 't2', students: [{ studentId: 'sB', subject: '数' }, null] },
      ] }],
    }
    const stage: Stage = { week: buildWeek(rowsOf(gap)), template: gap, pendingDesks: {} }
    const { plan, saved } = prepareAndSave('tp-69', stage)
    // テンプレの机 2 は空いているが、そこへ入れると机 3 の盤面の位置がずれるので使わない（机 4 に登録・盤面は机 3）。
    expect(plan.templateTeacherRegistrations[0].templateDeskIndex).toBe(4)
    expect(plan.ops[0].deskIndex).toBe(2)
    const desks = cellOf(saved.nextWeeks).desks
    expect(desks.slice(0, 2).map((desk) => desk.teacher)).toEqual(['田中', '鈴木'])
    // このテンプレの講師は田中・鈴木だけなので、手置き講師は佐藤・テンプレの講師は高木（このコマに居ない在籍の講師を名簿の順で）。
    expect(desks[2].teacher).toBe('高木')
    expect(lowerOf(saved.nextPendingDesks, desks[2])?.teacher).toMatchObject({ teacher: '佐藤', manualTeacher: true })
  })

  it('並び替えてテンプレの机がずれた盤面のコマは使わない（次のコマを探す）', () => {
    const week = buildWeek(rowsOf(BASE_TEMPLATE)).map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: [cell.desks[1], cell.desks[0], ...cell.desks.slice(2)] }))
    const plan = planChecklistPrep({
      itemId: 'tp-69', weeks: [[cellOf([week])]], todayKey: TODAY_KEY, effectiveStartDate: EFFECTIVE, templatePendingDesks: {}, teachers, teacherAliases: aliases,
      template: baselineOf(BASE_TEMPLATE), prepStudents: roster,
    })
    expect(plan.ok).toBe(false)
  })

  it('テンプレの差分反映が無い教室（template を渡さない）では新しい項目は準備しない（理由を出す）', () => {
    for (const itemId of ['tp-69', 'tp-70', 'tp-59']) {
      const plan = planChecklistPrep({ itemId, weeks: [buildWeek(rowsOf(BASE_TEMPLATE))], todayKey: TODAY_KEY, effectiveStartDate: EFFECTIVE, templatePendingDesks: {}, teachers, teacherAliases: aliases })
      expect(plan.ok, itemId).toBe(false)
      if (!plan.ok) expect(plan.reason, itemId).toContain('何も変えていません')
    }
  })
})


describe('テンプレへの講師の登録と準備の印（checklistPrepTeacherId）', () => {
  const registration = (templateDeskIndex: number, teacherId = 't5') => ({ dayOfWeek: 4, slotNumber: SLOT, deskIndex: templateDeskIndex - 1, templateDeskIndex, teacherId, teacherName: '伊藤', label: '' })

  it('講師も生徒も居ないテンプレの机にだけ登録する。講師か生徒の居る机なら何も登録しない（今ある登録を替えない・INV-02）', () => {
    const baseline = baselineOf(BASE_TEMPLATE)
    const ok = prepareChecklistPrepTemplateSave({ registrations: [], teacherRegistrations: [registration(4)], baseTemplate: baseline, effectiveStartDate: EFFECTIVE, students: roster, savedAt: SAVED_AT })
    if (!ok.ok) throw new Error(ok.reason)
    expect(templateDeskOf(ok.template, 4)).toMatchObject({ teacherId: 't5', checklistPrepTeacherId: 't5' })
    expect(ok.assignedTeachers).toEqual([registration(4)])
    for (const occupied of [1, 3]) {
      const refused = prepareChecklistPrepTemplateSave({ registrations: [], teacherRegistrations: [registration(occupied)], baseTemplate: baseline, effectiveStartDate: EFFECTIVE, students: roster, savedAt: SAVED_AT })
      expect(refused.ok, String(occupied)).toBe(false)
      if (!refused.ok) expect(refused.reason).toContain('何も登録していません')
    }
  })

  it('印はテンプレの在籍の絞り込み（保存の基準・次の準備の土台）を通っても残り、講師が替わった机・講師の居ない机では消える', () => {
    const marked: RegularLessonTemplate = {
      ...BASE_TEMPLATE,
      cells: [{ ...BASE_TEMPLATE.cells[0], desks: [
        ...BASE_TEMPLATE.cells[0].desks,
        { deskIndex: 4, teacherId: 't5', checklistPrepTeacherId: 't5', students: [null, null] },
        { deskIndex: 5, teacherId: 't6', checklistPrepTeacherId: 't5', students: [null, null] },
        { deskIndex: 6, teacherId: '', checklistPrepTeacherId: 't5', students: [null, null] },
      ] }],
    }
    const baseline = baselineOf(marked)
    expect(templateDeskOf(baseline, 4).checklistPrepTeacherId).toBe('t5')
    expect(templateDeskOf(baseline, 5)).not.toHaveProperty('checklistPrepTeacherId')
    expect(templateDeskOf(baseline, 6)).not.toHaveProperty('checklistPrepTeacherId')
    expect(templateDeskOf(baseline, 1)).not.toHaveProperty('checklistPrepTeacherId')
  })

  it('「通常授業テンプレ作成」で開いて何も変えずに保存しても印は残る。テンプレ作成で講師を替えた机の印は消える', () => {
    const marked: RegularLessonTemplate = {
      ...BASE_TEMPLATE,
      cells: [{ ...BASE_TEMPLATE.cells[0], desks: [...BASE_TEMPLATE.cells[0].desks, { deskIndex: 4, teacherId: 't5', checklistPrepTeacherId: 't5', students: [null, null] }] }],
    }
    const cells = buildTemplateBoardCells({ template: baselineOf(marked), teachers, students: roster, deskCount: 6 })
    const roundTrip = convertTemplateCellsToTemplate({ cells, teachers, students: roster, effectiveStartDate: EFFECTIVE, deskCount: 6 })
    expect(templateDeskOf(roundTrip, 4)).toMatchObject({ teacherId: 't5', checklistPrepTeacherId: 't5' })
    expect(templateDeskOf(roundTrip, 1)).not.toHaveProperty('checklistPrepTeacherId')
    // テンプレ作成の講師メニューは机の講師名だけを替える（handleTemplateConfirmTeacher）。
    const edited = cells.map((cell) => (cell.id !== `template_4_${SLOT}` ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 3 ? { ...desk, teacher: '上田' } : desk)) }))
    const editedTemplate = convertTemplateCellsToTemplate({ cells: edited, teachers, students: roster, effectiveStartDate: EFFECTIVE, deskCount: 6 })
    expect(templateDeskOf(editedTemplate, 4)).toEqual({ deskIndex: 4, teacherId: 't6', students: [null, null] })
  })

  it('講師だけを登録する項目（tp-70）は確認用の生徒を名簿へ足さない（足す数は 0）', () => {
    const withPrep: RegularLessonTemplate = {
      ...BASE_TEMPLATE,
      cells: [{ ...BASE_TEMPLATE.cells[0], desks: [...BASE_TEMPLATE.cells[0].desks, { deskIndex: 4, teacherId: '', students: [{ studentId: roster[3].id, subject: '算' }, null] }] }],
    }
    expect(resolveChecklistPrepStudentCount(withPrep, roster, 0)).toBe(0)
    expect(resolveChecklistPrepStudentCount(withPrep, roster, 1)).toBe(2)
    expect(CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT).toEqual({ 'tp-64': 2, 'mn-1': 2, 'tp-66': 2, 'tp-69': 1, 'tp-70': 0, 'tp-59': 1, 'tp-71': 2, 'tp-72': 2, 'tp-75': 2, 'v2-3': 3, 'v2-6': 2 })
  })
})

describe('後片づけ: 室長が手を入れたテンプレの準備の机（regression-reviewer M-1・INV-02）', () => {
  const markedTemplate = (students: RegularLessonTemplateDesk['students']): RegularLessonTemplate => ({
    ...BASE_TEMPLATE,
    cells: [{ ...BASE_TEMPLATE.cells[0], desks: [...BASE_TEMPLATE.cells[0].desks, { deskIndex: 4, teacherId: 't5', checklistPrepTeacherId: 't5', students }] }],
  })

  it('準備の机に室長が確認用でない生徒（千葉）を足していたら、講師は外さず印だけ外す（ほかの週の千葉の通常授業から講師を抜かない）', () => {
    const removed = removeChecklistPrepTemplateTeachers(markedTemplate([{ studentId: 'sC', subject: '数' }, null]), new Set(prepStudentIds))
    expect(removed.removed).toBe(0)
    expect(templateDeskOf(removed.template, 4)).toEqual({ deskIndex: 4, teacherId: 't5', students: [{ studentId: 'sC', subject: '数' }, null] })
  })

  it('確認用の生徒と千葉が居る机: 後片づけは確認用の生徒の登録だけ外し、講師（伊藤）と千葉は残す', () => {
    const prepId = roster.find((student) => student.name === '確認用 生徒A')!.id
    const cleanup = planChecklistPrepCleanup({ weeks: [buildWeek(rowsOf(BASE_TEMPLATE))], pendingDesks: {}, savedTemplate: markedTemplate([{ studentId: 'sC', subject: '数' }, { studentId: prepId, subject: '算' }]), students: roster, toSaveTemplate: (template) => template })
    if (cleanup.nothing) throw new Error('nothing to clean')
    expect(cleanup.templateRemoved).toBe(1)
    expect(cleanup.templateTeachersRemoved).toBe(0)
    expect(templateDeskOf(cleanup.template!, 4)).toEqual({ deskIndex: 4, teacherId: 't5', students: [{ studentId: 'sC', subject: '数' }, null] })
  })

  it('確認用の生徒だけ・生徒なしの準備の机は今までどおり講師を外す', () => {
    const prepId = roster.find((student) => student.name === '確認用 生徒A')!.id
    for (const students of [[null, null], [{ studentId: prepId, subject: '算' }, null]] as RegularLessonTemplateDesk['students'][]) {
      const removed = removeChecklistPrepTemplateTeachers(markedTemplate(students), new Set(prepStudentIds))
      expect(removed.removed).toBe(1)
      expect(templateDeskOf(removed.template, 4).teacherId).toBe('')
    }
  })

  it('テンプレ作成で準備の講師を消して同じ講師を選び直すと、印は戻らない（室長が置いた講師として扱う）', () => {
    const cells = buildTemplateBoardCells({ template: baselineOf(markedTemplate([null, null])), teachers, students: roster, deskCount: 6 })
    const desk = cells.find((cell) => cell.id === `template_4_${SLOT}`)!.desks[3]
    expect(desk.checklistPrepTemplateTeacherId).toBe('t5')
    setTemplateEditorDeskTeacher(desk, '')
    expect(desk).not.toHaveProperty('checklistPrepTemplateTeacherId')
    setTemplateEditorDeskTeacher(desk, '伊藤')
    const saved = convertTemplateCellsToTemplate({ cells, teachers, students: roster, effectiveStartDate: EFFECTIVE, deskCount: 6 })
    expect(templateDeskOf(saved, 4)).toEqual({ deskIndex: 4, teacherId: 't5', students: [null, null] })
  })

  it('テンプレ作成の講師メニュー（変更・削除）は setTemplateEditorDeskTeacher を通す（印を残したまま講師名だけ替えない）', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    for (const name of ['handleTemplateConfirmTeacher', 'handleTemplateDeleteTeacher']) {
      const start = source.indexOf(`const ${name} = () => {`)
      const body = source.slice(start, source.indexOf('\n  }\n', start))
      expect(body, name).toContain('setTemplateEditorDeskTeacher(targetDesk, ')
      expect(body, name).not.toMatch(/targetDesk\.teacher = /u)
    }
  })
})

describe('後片づけのテンプレ保存の形（コマ表と同じ toSaveTemplate・regression-reviewer S-4）', () => {
  it('在籍の絞り込みと反映開始日の差し替えを通しても、外した机は空の机になり、印は戻らない', () => {
    const { next } = prepareAndSave('tp-69', initialStage())
    const savedEffectiveStartDate = next.template.effectiveStartDate
    // ScheduleBoardScreen の後片づけの toSaveTemplate と同じ組み立て。
    const toSaveTemplate = (template: RegularLessonTemplate): RegularLessonTemplate => ({
      ...(resolveTemplateDiffBaseline({ template, deskCount: 6, teachers, students: roster, todayKey: TODAY_KEY }) ?? template),
      effectiveStartDate: resolveChecklistPrepCleanupEffectiveStartDate(TODAY_KEY, savedEffectiveStartDate),
      savedAt: SAVED_AT,
    })
    const cleanup = planChecklistPrepCleanup({ weeks: [next.week], pendingDesks: next.pendingDesks, savedTemplate: next.template, students: roster, toSaveTemplate })
    if (cleanup.nothing) throw new Error('nothing to clean')
    expect(templateDeskOf(cleanup.template!, 4)).toEqual({ deskIndex: 4, teacherId: '', students: [null, null] })
    expect(cleanup.template!.cells.some((cell) => cell.desks.some((desk) => 'checklistPrepTeacherId' in desk))).toBe(false)
    expect(cleanup.template!.effectiveStartDate).toBe(EFFECTIVE)
  })
})

describe('tp-59 の盤面の文・登録の文（regression-reviewer S-5）', () => {
  // 第119版: 成功の結果の文には載せないが、テンプレ保存の段で止まったときの文（盤面で行ったこと・登録した席）に使う。
  it('机 A・机 B のあとに括弧でコマ表・テンプレの机を書く（「机 B 木曜 5限 机 4」と続けて書かない）', () => {
    const { plan, prepared } = prepareAndSave('tp-59', initialStage())
    const registered = describeChecklistPrepTemplateRegistered(prepared.assigned, prepared.assignedTeachers)
    expect(plan.message).toContain('机 A（10/8(木) 5限 机 5）に講師 高木 を手で置き')
    expect(plan.message).toContain('机 B（テンプレの 木曜 5限 机 4）に講師 高木 と確認用の生徒を登録して保存します')
    expect(registered).toContain('テンプレの 机 B（木曜 5限 机 4）に講師「高木」、机 B（木曜 5限 机 4 の生徒 1）に「確認用 生徒')
    expect(registered).not.toContain('机 B 木曜')
  })
})

describe('第119版: 項目の文の {{prep:キー}} は、その項目の準備が facts に入れる', () => {
  // 第122版(2026-11-07): tp-69・mn-1・tp-66 は OK で確認リストから外れた(準備の処理は残してある)。外す前の文が使っていたキーで同じ検査を続ける。
  const RETIRED_ITEM_KEYS: Record<string, string[]> = {
    'tp-69': ['A', 'X', 'Y', 'deskA', 'slot'],
    'mn-1': ['A', 'X', 'desk1', 'slot', 'trial'],
    'tp-66': ['A', 'X', 'Y', 'desk1', 'slot', 'trial'],
    // 第126版(2026-11-08): tp-59・tp-70 も OK で外した。
    'tp-59': ['A', 'X', 'deskA', 'deskB', 'slot', 'trial'],
    'tp-70': ['X', 'Y', 'deskA', 'slot', 'trial'],
  }
  for (const itemId of ['tp-59', 'tp-70', 'tp-69', 'mn-1', 'tp-66']) {
    it(`${itemId}: 文に使うキーが全部埋まる`, () => {
      const item = VERIFICATION_CHECKLIST.items.find((entry) => entry.id === itemId)
      if (item) expect(item.autoPrep).toBe(true)
      else expect(RETIRED_ITEM_KEYS[itemId], `${itemId} は外した項目なのでキーの一覧が要る`).toBeDefined()
      const keys = item ? listChecklistPrepFactTokenKeys(item) : RETIRED_ITEM_KEYS[itemId]
      expect(keys.length).toBeGreaterThan(0)
      const { facts } = prepareAndSave(itemId, initialStage())
      for (const key of keys) expect(facts[key], `${itemId}: ${key}`).toBeTruthy()
    })
  }
})
