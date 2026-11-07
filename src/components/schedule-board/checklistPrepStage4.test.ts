// 確認リストの「準備する」第 4 段（docs/plan-2026-11-07-checklist-auto-prep-stage3.md §6・2026-11-07 オーナー回答）の受け入れテスト。
// 準備（checklistPrepSequence.ts の planChecklistPrepSequenceStep）を、コマ表の effect と同じ順で最後まで通す:
//   テンプレへの登録（prepareChecklistPrepTemplateSave）→ 実際のテンプレ保存の差分反映（computeTemplateDiffApplyForBoard・保存の本体と同じ台帳の扱い）→
//   盤面の操作（室長の操作と同じ CHECKLIST_PREP_BOARD_OPERATIONS＝computeStudentMove・computeStudentAbsentMark・computeMakeupStockPlacement）→
//   commitWeeks と同じ確定（出自の印 stampPlacementOrigins）→ 再マージ（remergeBoardWeeksWithManagedData・画面が描く形）。
// そのうえで、確認リストの項目の「OK の目安」が手の操作の前に成り立つ形になっていることと、手の操作（何も変えないテンプレ保存・丸ごと振替と解除）を
// 通したあとに目安が成り立つことを固定する。ほかの生徒の予定数・未消化振替・講習の残り・授業の位置は動かない（INV-06・INV-02）。
//   tp-71: 同じ日の中で動かしたテンプレの授業（A＝別の時限・B＝同じコマの別の机）→ 何も変えずに保存でテンプレの位置へ戻る／外すと消える。
//   tp-72: 動かした A の席に C をテンプレで登録して保存 → C の 1 行・A は元の机。
//   tp-75: A の振替を手で置いたコマに A をテンプレで登録して保存 → 振替の 1 行のまま・テンプレの机に A は入らない・「詳細」に理由。
//   v2-6: 振替先 B に C の振替（手入力）・振替元 A に体験 → 丸ごと振替で A の C は休み（+1）・体験は B へ・解除で元どおり。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { buildRegularLessonsFromTemplate, resolveTemplateDiffBaseline, type RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import { CHECKLIST_PREP_SEQUENCE_ITEM_IDS, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT, resolveChecklistPrepAbortMessage } from './checklistPrep'
import {
  buildChecklistPrepSequenceFailedMessage,
  buildChecklistPrepSequenceMessage,
  isChecklistPrepSequenceComplete,
  planChecklistPrepSequenceStep,
  recordChecklistPrepSequenceTemplateSaved,
  resolveChecklistPrepSequenceStartBlock,
  type ChecklistPrepSequenceEnv,
  type ChecklistPrepSequenceState,
} from './checklistPrepSequence'
import { cleanupChecklistPrepStudentRecords, ensureChecklistPrepStudents, planChecklistPrepCleanup, prepareChecklistPrepTemplateSave } from './checklistPrepTemplate'
import { buildMakeupStockEntries } from './makeupStock'
import { stampPlacementOrigins } from './placementOrigin'
import {
  applyClassroomAvailability,
  buildManagedScheduleCellsForRange,
  buildManagedStudentByAnyNameMap,
  computeTemplateDiffApplyForBoard,
  computeWholeDayTransferPair,
  computeWholeDayTransferPairRelease,
  remergeBoardWeeksWithManagedData,
  CHECKLIST_PREP_BOARD_OPERATIONS,
  type StudentAbsentMarkLedgers,
} from './ScheduleBoardScreen'
import { collectExpectedTemplateLessons } from './templateLessonAccountingOracle'
import { buildTeacherAliasResolver } from './templateDiffApply'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

// 2 週（10/5〜10/11・10/12〜10/18）。反映開始日 10/7（水）＝準備に使える最初の日は 10/8（木）。
const WEEKS: Array<[string, string]> = [['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18']]
const EFFECTIVE = '2026-10-07'
const TODAY_KEY = '2026-09-29'
const SAVED_AT = '2026-09-29T10:00:00.000Z'
const SLOT = 5

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}
function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const baseStudents = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤'), teacherRow('t4', '高木'), teacherRow('t5', '伊藤')]
const aliases = buildTeacherAliasResolver(teachers)
let serial = 0
const roster = ensureChecklistPrepStudents(baseStudents, 4, { todayKey: TODAY_KEY, createId: (taken) => { do { serial += 1 } while (taken.has(`p${serial}`)); return `p${serial}` } }).students
const prepIds = new Set(roster.filter((student) => student.name.startsWith('確認用')).map((student) => student.id))
const byName = buildManagedStudentByAnyNameMap(roster)
const displayNameOf = (name: string) => name
const resolveStockId = (student: { managedStudentId?: string; name: string; manualAdded?: boolean }) => student.managedStudentId ?? byName.get(student.name)?.id ?? `name:${student.name}`

function settings(): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 6, templateFreezeBeforeDate: EFFECTIVE } as ClassroomSettings
}

// 木曜 5 限: 机 1＝田中＋青木・机 2＝鈴木＋馬場・机 3＝佐藤だけ。ほかのコマは空（準備は空いたコマも使う）。
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

const LECTURE_REQUESTED = 3

/** ほかの生徒（千葉）の休みの記録（金 10/9 5限・振替の未消化 1）と講習 1 コマ（水 10/7 4限）。準備の前後で動かないことを見る（INV-06）。 */
function absentRecord(): StudentStatusEntry {
  return {
    id: 'st-absent', studentId: 'sC', managedStudentId: 'sC', sourceManagedLesson: false, name: '千葉', grade: '中1', subject: '数', lessonType: 'makeup', teacherType: 'normal',
    teacherName: '田中', dateKey: '2026-10-09', slotNumber: SLOT, recordedAt: '2026-10-01T10:00:00Z', status: 'absent', sourceLessonId: 'l-absent', makeupSourceDate: '2026-10-02',
  }
}

function buildBoard(rows: RegularLessonRow[]): SlotCell[][] {
  return WEEKS.map(([startDate, endDate]) => buildManagedScheduleCellsForRange({
    range: { startDate, endDate, periodValue: '', personId: '' }, fallbackStartDate: startDate, fallbackEndDate: endDate,
    classroomSettings: settings(), teachers, students: roster, regularLessons: rows, boardWeeks: [],
  }).map((cell) => {
    if (cell.id === `2026-10-09_${SLOT}`) return { ...cell, desks: cell.desks.map((desk, index) => (index === 5 ? { ...desk, statusSlots: [absentRecord(), null] as DeskCell['statusSlots'] } : desk)) }
    if (cell.id === '2026-10-07_4') return { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' as const, lesson: { id: 'special-1', studentSlots: [{ id: 'sp1', name: '千葉', managedStudentId: 'sC', grade: '中1' as const, subject: '数' as const, lessonType: 'special' as const, teacherType: 'normal' as const, manualAdded: true }, null] as [StudentEntry | null, StudentEntry | null] } } : desk)) }
    return cell
  }))
}

type Stage = { weeks: SlotCell[][]; template: RegularLessonTemplate; pendingDesks: TemplatePendingDeskMap; ledgers: StudentAbsentMarkLedgers }

const emptyLedgers = (): StudentAbsentMarkLedgers => ({
  manualMakeupAdjustments: {}, suppressedMakeupOrigins: {}, fallbackMakeupStudents: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackLectureStockStudents: {},
  suppressedRegularLessonOccurrences: [],
})

function initialStage(): Stage {
  const rows = rowsOf(BASE_TEMPLATE)
  return { weeks: remerge(buildBoard(rows), rows, [], {}), template: BASE_TEMPLATE, pendingDesks: {}, ledgers: emptyLedgers() }
}

function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], pendingDesks: TemplatePendingDeskMap) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings(), teachers, students: roster, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY, templateOriginRules: { pendingDesks } })
}

function envOf(stage: Stage): ChecklistPrepSequenceEnv {
  return {
    weeks: stage.weeks, normalizedWeeks: applyClassroomAvailability(stage.weeks, settings()), todayKey: TODAY_KEY, effectiveStartDate: EFFECTIVE, templatePendingDesks: stage.pendingDesks,
    teachers, teacherAliases: aliases, template: baselineOf(stage.template), students: roster, regularLessons: rowsOf(stage.template), classroomSettings: settings(),
    ledgers: stage.ledgers, ledgerMakeupOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: displayNameOf, resolveStockId,
    createStudentId: (cellId, deskIndex, studentIndex) => `${cellId}_${deskIndex}_${studentIndex}_prep`, operations: CHECKLIST_PREP_BOARD_OPERATIONS, now: 1,
  }
}

/**
 * テンプレの保存（handleSaveRegularLessonTemplateByDiff と同じ台帳の扱い: 削除記録の足し引き・在庫の台帳の取り下げ／積み増し）→ 再マージ（保存のあとに画面が描く形）。
 * 再マージが保存の結果を変えない（不動点）ことも見る。
 */
function saveTemplate(stage: Stage, template: RegularLessonTemplate) {
  const rows = rowsOf(template)
  const diff = computeTemplateDiffApplyForBoard({
    weeks: stage.weeks, classroomSettings: settings(), teachers, students: roster, regularLessons: rows, effectiveStartDate: template.effectiveStartDate,
    suppressedRegularLessonOccurrences: stage.ledgers.suppressedRegularLessonOccurrences, templatePendingDesks: stage.pendingDesks, createdAt: SAVED_AT,
    manualMakeupAdjustments: stage.ledgers.manualMakeupAdjustments, suppressedMakeupOrigins: stage.ledgers.suppressedMakeupOrigins, scheduleCountAdjustments: [], previousRegularLessons: rowsOf(stage.template),
  })
  // 準備は確認用の生徒しか動かさないので、保存が在庫の台帳・希望回数を書くことは無い（INV-06）。
  expect(diff.manualMakeupOriginAdditions).toEqual([])
  expect(diff.manualMakeupOriginRemovals).toEqual([])
  expect(diff.wholeDayTransferCountAdjustments).toEqual([])
  const removed = new Set(diff.removedSuppressedRegularLessonOccurrences)
  const suppressed = [...stage.ledgers.suppressedRegularLessonOccurrences.filter((key) => !removed.has(key)), ...diff.addedSuppressedRegularLessonOccurrences]
  const remerged = remerge(diff.nextWeeks, rows, suppressed, diff.nextPendingDesks)
  expect(JSON.stringify(remerged)).toBe(JSON.stringify(diff.nextWeeks))
  return { diff, next: { weeks: diff.nextWeeks, template, pendingDesks: diff.nextPendingDesks, ledgers: { ...stage.ledgers, suppressedRegularLessonOccurrences: suppressed } } as Stage }
}

/** commitWeeks と同じ確定（出自の印・保留の片づけ）→ 再マージ（削除記録が変わると画面が再マージする）。 */
function commitLike(stage: Stage, weeks: SlotCell[][], ledgers: StudentAbsentMarkLedgers): Stage {
  const stamped = stampPlacementOrigins(weeks, stage.pendingDesks)
  let nextWeeks = stamped.weeks
  let pendingDesks = (stamped.pendingDesks ?? stage.pendingDesks) as TemplatePendingDeskMap
  if (Object.keys(pendingDesks).length > 0) {
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: stage.weeks, previousTemplatePendingDesks: stage.pendingDesks, weeks: nextWeeks, templatePendingDesks: pendingDesks })
    nextWeeks = settled.nextWeeks
    pendingDesks = settled.nextTemplatePendingDesks
  }
  const remerged = remerge(nextWeeks, rowsOf(stage.template), ledgers.suppressedRegularLessonOccurrences, pendingDesks)
  return { ...stage, weeks: remerged, pendingDesks, ledgers }
}

type Run = { state: ChecklistPrepSequenceState; stage: Stage; message: string; saves: Array<ReturnType<typeof saveTemplate>['diff']>; history: Stage[] }

/** コマ表の effect と同じ順で最後の段まで通す。 */
function runPrep(itemId: string, start: Stage): Run {
  let state: ChecklistPrepSequenceState | null = null
  let stage = start
  const saves: Run['saves'] = []
  const history: Stage[] = []
  for (let guard = 0; guard < 10; guard += 1) {
    const action = planChecklistPrepSequenceStep(itemId, state, envOf(stage))
    if (action.kind === 'fail') throw new Error(`fail: ${action.reason}`)
    if (action.kind === 'jump') throw new Error(`jump: ${action.dateKey}`)
    if (action.kind === 'done') return { state: action.state, stage, message: buildChecklistPrepSequenceMessage(action.state), saves, history }
    if (action.kind === 'template') {
      const prepared = prepareChecklistPrepTemplateSave({ registrations: action.registrations, teacherRegistrations: action.teacherRegistrations, baseTemplate: baselineOf(stage.template), effectiveStartDate: EFFECTIVE, students: roster, savedAt: SAVED_AT })
      if (!prepared.ok) throw new Error(`template: ${prepared.reason}`)
      const saved = saveTemplate(stage, prepared.template)
      saves.push(saved.diff)
      state = recordChecklistPrepSequenceTemplateSaved(action.state, { assigned: prepared.assigned, assignedTeachers: prepared.assignedTeachers, effectiveStartDate: EFFECTIVE, todayKey: TODAY_KEY, summary: saved.diff.summary, studentNotes: saved.diff.studentNotes })
      stage = saved.next
    } else {
      state = action.state
      stage = commitLike(stage, action.weeks, action.ledgers)
    }
    history.push(stage)
    if (isChecklistPrepSequenceComplete(state)) return { state, stage, message: buildChecklistPrepSequenceMessage(state), saves, history }
  }
  throw new Error('too many steps')
}

const cellOf = (weeks: SlotCell[][], cellId: string) => {
  const cell = weeks.flat().find((entry) => entry.id === cellId)
  if (!cell) throw new Error(`cell ${cellId} not found`)
  return cell
}
const ids = (desk: DeskCell) => (desk.lesson?.studentSlots ?? [null, null]).map((student) => student?.managedStudentId ?? student?.name ?? null)
/** 盤面（上の行）でその生徒が居る席（cellId:机:席）。 */
const placesOf = (weeks: SlotCell[][], studentId: string, dateKey?: string) => weeks.flat().filter((cell) => !dateKey || cell.dateKey === dateKey).flatMap((cell) => cell.desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).map((student, seat) => (student?.managedStudentId === studentId ? `${cell.id}:${deskIndex}:${seat}` : null)).filter(Boolean)))
const recordsOf = (weeks: SlotCell[][], studentId: string) => weeks.flat().flatMap((cell) => cell.desks.flatMap((desk) => (desk.statusSlots ?? []).filter((entry) => entry?.managedStudentId === studentId).map((entry) => `${cell.id}:${entry!.status}`)))

function stockOf(stage: Stage) {
  return buildMakeupStockEntries({
    students: roster, teachers, regularLessons: rowsOf(stage.template), classroomSettings: settings(), weeks: applyClassroomAvailability(stage.weeks, settings()),
    manualAdjustments: stage.ledgers.manualMakeupAdjustments, suppressedOrigins: stage.ledgers.suppressedMakeupOrigins, fallbackStudents: stage.ledgers.fallbackMakeupStudents,
    resolveStudentKey: resolveStockId, today: new Date('2026-09-29T00:00:00'), templatePendingDesks: stage.pendingDesks, wholeDayPairKeys: stage.ledgers.suppressedRegularLessonOccurrences,
  })
}
const balanceOf = (stage: Stage, studentId: string) => stockOf(stage).filter((entry) => entry.key.startsWith(`${studentId}__`)).reduce((sum, entry) => sum + entry.balance, 0)

/** 確認用でない生徒の授業の位置・予定数・振替の未消化・講習の残り（INV-06・INV-02）。 */
function othersSnapshot(stage: Stage) {
  const rows = rowsOf(stage.template)
  const { expected } = collectExpectedTemplateLessons({ weeks: stage.weeks, regularLessons: rows, classroomSettings: settings(), fromDate: EFFECTIVE, toDate: WEEKS[1][1], suppressedRegularLessonOccurrences: stage.ledgers.suppressedRegularLessonOccurrences })
  const planned = [...expected].filter(([key]) => ![...prepIds].some((id) => key.includes(id))).sort(([left], [right]) => left.localeCompare(right))
  const all = stage.weeks.flat()
  const lessons = all.flatMap((cell) => cell.desks.flatMap((desk, deskIndex) => (desk.lesson?.studentSlots ?? []).map((student, seat) => (
    student && !student.name.startsWith('確認用') ? `${cell.id}:${deskIndex}:${seat}:${student.name}:${student.subject}:${student.lessonType}` : null
  )).filter(Boolean)))
  const placedSpecial = all.flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.lessonType === 'special' && student.managedStudentId === 'sC').length
  const stock = stockOf(stage).filter((entry) => !prepIds.has(entry.key.split('__')[0])).map((entry) => ({ key: entry.key, balance: entry.balance }))
  const ledgerKeys = Object.keys(stage.ledgers.manualMakeupAdjustments).filter((key) => !prepIds.has(key.split('__')[0]))
  return { lessons, planned, stock, lectureRemaining: LECTURE_REQUESTED - placedSpecial, ledgerKeys }
}

/** 何も変えずにテンプレを保存する（手の操作）。 */
const saveUnchanged = (stage: Stage) => saveTemplate(stage, { ...baselineOf(stage.template), savedAt: SAVED_AT })

/** テンプレからその生徒の登録を外して保存する（手の操作）。 */
function saveWithout(stage: Stage, studentId: string) {
  const base = baselineOf(stage.template)
  return saveTemplate(stage, { ...base, savedAt: SAVED_AT, cells: base.cells.map((cell) => ({ ...cell, desks: cell.desks.map((desk) => ({ ...desk, students: desk.students.map((student) => (student?.studentId === studentId ? null : student)) as typeof desk.students })) })) })
}

function stepsOf(run: Run) {
  return run.state.steps
}
function moveTargets(run: Run) {
  return stepsOf(run).flatMap((step) => (step.kind === 'board' ? step.ops : [])).filter((op) => op.kind === 'move')
}
function registrationsOf(run: Run) {
  return stepsOf(run).flatMap((step) => (step.kind === 'template' ? step.registrations : []))
}

describe('tp-71: 同じ日の中で手で動かした通常授業は、テンプレを保存するとテンプレどおりの位置に戻る', () => {
  it('準備: 確認用の生徒 A・B をテンプレの同じ机に登録して保存 → A を同じ日の別の時限へ、B を同じコマの別の机へ（室長の移動と同じ処理・緑にならない）', () => {
    const run = runPrep('tp-71', initialStage())
    const [regA, regB] = registrationsOf(run)
    expect([regA.studentIndex, regB.studentIndex]).toEqual([0, 1])
    expect(regA.templateDeskIndex).toBe(regB.templateDeskIndex)
    const [moveA, moveB] = moveTargets(run) as Array<{ kind: 'move'; studentId: string; fromCellId: string; to: { cellId: string; deskIndex: number; dateKey: string; slotNumber: number } }>
    const anchor = cellOf(run.stage.weeks, moveB.fromCellId)
    // テンプレの位置（保存で入った机）は空き、A は同じ日の別の時限・B は同じコマの別の机に 1 か所だけ。
    expect(ids(anchor.desks[regA.deskIndex])).toEqual([null, null])
    expect(placesOf(run.stage.weeks, regA.studentId!, anchor.dateKey)).toEqual([`${moveA.to.cellId}:${moveA.to.deskIndex}:0`])
    expect(moveA.to.dateKey).toBe(anchor.dateKey)
    expect(moveA.to.slotNumber).not.toBe(anchor.slotNumber)
    expect(placesOf(run.stage.weeks, regB.studentId!, anchor.dateKey)).toEqual([`${moveB.to.cellId}:${moveB.to.deskIndex}:0`])
    expect(moveB.to.cellId).toBe(anchor.id)
    // 動かした授業はテンプレの授業の写し（出自テンプレ・青字にしない）で、削除記録・保留（緑）は出ない。
    const movedA = cellOf(run.stage.weeks, moveA.to.cellId).desks[moveA.to.deskIndex].lesson!.studentSlots[0]!
    expect(movedA).toMatchObject({ lessonType: 'regular', origin: 'template', sameDayMoveSourceDate: anchor.dateKey })
    expect(run.stage.pendingDesks).toEqual({})
    expect(run.stage.ledgers.suppressedRegularLessonOccurrences).toEqual([])
    // ほかの週の同じコマにはテンプレの位置に 2 人とも居る（テンプレへの登録が効いている）。
    const nextWeek = cellOf(run.stage.weeks, `2026-10-15_${anchor.slotNumber}`)
    expect(ids(nextWeek.desks[regA.deskIndex])).toEqual([regA.studentId, regB.studentId])
    expect(run.message).toContain('を登録して、テンプレを保存しました。')
    expect(run.message).toContain('同じ日の別の時限')
    expect(run.message).not.toContain('詳細:')
  })

  it('手で: 何も変えずにテンプレを保存すると、A・B はテンプレの位置に 1 行で戻り、動かした先は空く（緑の机は出ない）。もう一度保存しても変わらない', () => {
    const run = runPrep('tp-71', initialStage())
    const [regA, regB] = registrationsOf(run)
    const [moveA, moveB] = moveTargets(run) as Array<{ kind: 'move'; fromCellId: string; to: { cellId: string; deskIndex: number } }>
    const saved = saveUnchanged(run.stage)
    const anchor = cellOf(saved.next.weeks, moveB.fromCellId)
    expect(ids(anchor.desks[regA.deskIndex])).toEqual([regA.studentId, regB.studentId])
    expect(ids(cellOf(saved.next.weeks, moveA.to.cellId).desks[moveA.to.deskIndex])).toEqual([null, null])
    expect(ids(anchor.desks[moveB.to.deskIndex])).toEqual([null, null])
    expect(saved.next.pendingDesks).toEqual({})
    const again = saveUnchanged(saved.next)
    expect(JSON.stringify(again.next.weeks)).toBe(JSON.stringify(saved.next.weeks))
  })

  it('手で: テンプレから A の授業を外して保存すると、A の動かした授業は消えてどこにも残らない（B はテンプレの位置へ戻る）', () => {
    const run = runPrep('tp-71', initialStage())
    const [regA, regB] = registrationsOf(run)
    const saved = saveWithout(run.stage, regA.studentId!)
    expect(placesOf(saved.next.weeks, regA.studentId!)).toEqual([])
    expect(recordsOf(saved.next.weeks, regA.studentId!)).toEqual([])
    const anchorCellId = (moveTargets(run)[1] as { fromCellId: string }).fromCellId
    // テンプレの席 2 だけの机は盤面では席 1 に詰めて置く（buildManagedScheduleCellsForRange・tp-64 の準備と同じ前提）。
    expect(ids(cellOf(saved.next.weeks, anchorCellId).desks[regB.deskIndex])).toEqual([regB.studentId, null])
  })
})

describe('tp-72: 手で動かした通常授業の席をテンプレの別の生徒が使うとき、動かした授業はテンプレの位置に戻る', () => {
  it('準備: A を登録して保存 → A を次の机へ動かす → その机・席に C をテンプレで登録して保存。その机は C の 1 行（緑にならない）・A はテンプレの元の机', () => {
    const run = runPrep('tp-72', initialStage())
    const [regA, regC] = registrationsOf(run)
    expect(regA.studentId).not.toBe(regC.studentId)
    expect(regC.templateDeskIndex).toBe(regA.templateDeskIndex + 1)
    const [move] = moveTargets(run) as Array<{ fromCellId: string; to: { deskIndex: number } }>
    expect(move.to.deskIndex).toBe(regC.deskIndex)
    const anchor = cellOf(run.stage.weeks, move.fromCellId)
    expect(ids(anchor.desks[regC.deskIndex])).toEqual([regC.studentId, null])
    expect(ids(anchor.desks[regA.deskIndex])).toEqual([regA.studentId, null])
    expect(placesOf(run.stage.weeks, regA.studentId!, anchor.dateKey)).toEqual([`${anchor.id}:${regA.deskIndex}:0`])
    expect(run.stage.pendingDesks).toEqual({})
    // 結果の文: 2 回目の保存の「詳細」（確認画面と同じ文）を載せる。
    expect(run.message).toContain('詳細:')
    expect(run.message.match(/を登録して、テンプレを保存しました。/gu)).toHaveLength(2)
  })

  it('何も変えずにもう一度保存しても形は変わらない', () => {
    const run = runPrep('tp-72', initialStage())
    const again = saveUnchanged(run.stage)
    expect(JSON.stringify(again.next.weeks)).toBe(JSON.stringify(run.stage.weeks))
    expect(again.next.pendingDesks).toEqual({})
  })
})

describe('tp-75: 同じコマに手で置いた振替がある生徒をテンプレで登録しても、テンプレの机には置かれず振替がそのまま残る', () => {
  const absentOp = (run: Run) => stepsOf(run).flatMap((step) => (step.kind === 'board' ? step.ops : [])).find((op) => op.kind === 'absent') as { studentId: string; cellId: string }
  const makeupOp = (run: Run) => stepsOf(run).flatMap((step) => (step.kind === 'board' ? step.ops : [])).find((op) => op.kind === 'makeup') as { to: { cellId: string; deskIndex: number; dateKey: string; slotNumber: number } }

  it('準備: A を別の時限のテンプレに登録して保存 → A を休み（未消化 +1）→ その振替を机に置く（−1）→ 同じコマのテンプレの別の机に A を登録して保存', () => {
    const start = initialStage()
    const run = runPrep('tp-75', start)
    const [first, second] = registrationsOf(run)
    expect(first.studentId).toBe(second.studentId)
    const studentA = first.studentId!
    const absent = absentOp(run)
    const makeup = makeupOp(run)
    // 休みの記録は休みにしたコマに残り（記録が勝つ）、振替は振替の机に 1 行（手入力・青字・緑にならない）。
    expect(recordsOf(run.stage.weeks, studentA)).toEqual([`${absent.cellId}:absent`])
    const makeupCell = cellOf(run.stage.weeks, makeup.to.cellId)
    const placed = makeupCell.desks[makeup.to.deskIndex].lesson!.studentSlots[0]!
    expect(placed).toMatchObject({ managedStudentId: studentA, lessonType: 'makeup', origin: 'manual', makeupSourceDate: cellOf(run.stage.weeks, absent.cellId).dateKey })
    expect(run.stage.pendingDesks).toEqual({})
    // テンプレの机（2 回目の登録の机）に A は入らない。このコマで A は振替の 1 か所だけ。
    expect(ids(makeupCell.desks[second.deskIndex])).toEqual([null, null])
    expect(placesOf(run.stage.weeks, studentA, makeup.to.dateKey).filter((place) => place!.startsWith(`${makeupCell.id}:`))).toEqual([`${makeupCell.id}:${makeup.to.deskIndex}:0`])
    // 1 週後の同じコマにはテンプレの A がテンプレの机に入る（登録は効いている）。
    const nextWeek = cellOf(run.stage.weeks, `2026-10-15_${makeup.to.slotNumber}`)
    expect(ids(nextWeek.desks[second.deskIndex])).toEqual([studentA, null])
    // 「詳細」に手入力が先にある理由（名前・科目つき）。
    expect(run.message).toContain(`${roster.find((student) => student.id === studentA)!.name}（${placed.subject}）: 同じコマに手入力の同じ生徒が先にあるため、テンプレのこの授業は置きません（予定数に数えません）。`)
    // A の未消化振替: 休みで +1・振替を置いて −1＝0。2 回目の保存でも変わらない。
    expect(balanceOf(run.stage, studentA)).toBe(0)
    // A の予定数: このコマの日は数えない（手入力が先）・1 週後は数える。
    const { expected } = collectExpectedTemplateLessons({ weeks: run.stage.weeks, regularLessons: rowsOf(run.stage.template), classroomSettings: settings(), fromDate: EFFECTIVE, toDate: WEEKS[1][1], suppressedRegularLessonOccurrences: run.stage.ledgers.suppressedRegularLessonOccurrences })
    const aKeys = [...expected.keys()].filter((key) => key.includes(studentA))
    expect(aKeys.length).toBeGreaterThan(0)
  })

  it('何も変えずにもう一度保存しても形・予定数・未消化は変わらない', () => {
    const run = runPrep('tp-75', initialStage())
    const studentA = registrationsOf(run)[0].studentId!
    const again = saveUnchanged(run.stage)
    expect(JSON.stringify(again.next.weeks)).toBe(JSON.stringify(run.stage.weeks))
    expect(again.next.pendingDesks).toEqual({})
    expect(balanceOf(again.next, studentA)).toBe(balanceOf(run.stage, studentA))
    const planned = (stage: Stage) => collectExpectedTemplateLessons({ weeks: stage.weeks, regularLessons: rowsOf(stage.template), classroomSettings: settings(), fromDate: EFFECTIVE, toDate: WEEKS[1][1], suppressedRegularLessonOccurrences: stage.ledgers.suppressedRegularLessonOccurrences }).expected
    expect([...planned(again.next)]).toEqual([...planned(run.stage)])
  })
})

describe('v2-6: 丸ごと振替の解除で移した手入力が元の席へ戻る／振替先に同じ生徒の手入力があると振替元は休み', () => {
  const opOf = <K extends string>(run: Run, kind: K) => stepsOf(run).flatMap((step) => (step.kind === 'board' ? step.ops : [])).find((op) => op.kind === kind) as { studentId?: string; cellId?: string; to: { cellId: string; deskIndex: number; studentIndex: number; dateKey: string; slotNumber: number } }

  it('準備: A に体験・A のテンプレに C・B に C の振替（手入力）。保存後、B ではテンプレの C を置かず振替の 1 か所だけ', () => {
    const run = runPrep('v2-6', initialStage())
    const studentC = registrationsOf(run)[0].studentId!
    const trial = opOf(run, 'trial')
    const makeup = opOf(run, 'makeup')
    const absent = opOf(run, 'absent')
    const sourceDate = trial.to.dateKey
    const targetDate = makeup.to.dateKey
    expect(targetDate).toBe('2026-10-15')
    expect(sourceDate).toBe('2026-10-08')
    expect(trial.to.slotNumber).toBe(makeup.to.slotNumber)
    const absenceDate = cellOf(run.stage.weeks, absent.cellId!).dateKey
    expect([sourceDate, targetDate]).not.toContain(absenceDate)
    const slot = trial.to.slotNumber
    const landing = registrationsOf(run)[1].deskIndex
    // A: テンプレの C（机 landing）と体験。B: C の振替だけ（テンプレの C は置かない）。
    const source = cellOf(run.stage.weeks, `${sourceDate}_${slot}`)
    expect(ids(source.desks[landing])).toEqual([studentC, null])
    expect(source.desks[trial.to.deskIndex].lesson!.studentSlots[0]).toMatchObject({ lessonType: 'trial', manualAdded: true })
    const target = cellOf(run.stage.weeks, `${targetDate}_${slot}`)
    expect(placesOf(run.stage.weeks, studentC, targetDate)).toEqual([`${target.id}:${makeup.to.deskIndex}:0`])
    expect(target.desks[makeup.to.deskIndex].lesson!.studentSlots[0]).toMatchObject({ lessonType: 'makeup', origin: 'manual' })
    expect(run.stage.pendingDesks).toEqual({})
    // A・B には出欠記録が無い（丸ごと振替を始められる）。休みの記録は別の日だけ。
    expect(recordsOf(run.stage.weeks, studentC)).toEqual([`${absent.cellId}:absent`])
    expect(balanceOf(run.stage, studentC)).toBe(0)
  })

  it('手で: A の日付で「丸ごと振替」→ B で実行すると、体験は B の同じ机・席へ、A の C は休み（振替先なし）で C の未消化振替が 1 増える。解除すると元どおり', () => {
    const run = runPrep('v2-6', initialStage())
    const studentC = registrationsOf(run)[0].studentId!
    const trial = opOf(run, 'trial')
    const makeup = opOf(run, 'makeup')
    const slot = trial.to.slotNumber
    const landing = registrationsOf(run)[1].deskIndex
    const rows = rowsOf(run.stage.template)
    const before = balanceOf(run.stage, studentC)
    const paired = computeWholeDayTransferPair({
      weeks: run.stage.weeks, sourceDateKey: trial.to.dateKey, targetDateKey: makeup.to.dateKey, classroomSettings: settings(), teachers, students: roster, regularLessons: rows,
      suppressedRegularLessonOccurrences: run.stage.ledgers.suppressedRegularLessonOccurrences, templatePendingDesks: run.stage.pendingDesks, createdAt: SAVED_AT,
    })
    if (paired.status !== 'transferred') throw new Error(paired.message)
    const transferred: Stage = { ...run.stage, weeks: paired.nextWeeks, pendingDesks: paired.nextTemplatePendingDesks, ledgers: { ...run.stage.ledgers, suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences } }
    const target = cellOf(transferred.weeks, `${makeup.to.dateKey}_${slot}`)
    expect(target.desks[trial.to.deskIndex].lesson?.studentSlots[trial.to.studentIndex]).toMatchObject({ lessonType: 'trial' })
    expect(placesOf(transferred.weeks, studentC, makeup.to.dateKey)).toEqual([`${target.id}:${makeup.to.deskIndex}:0`])
    const sourceRecord = cellOf(transferred.weeks, `${trial.to.dateKey}_${slot}`).desks[landing].statusSlots?.[0]
    expect(sourceRecord).toMatchObject({ status: 'absent', managedStudentId: studentC })
    expect(sourceRecord?.moveDestinationDateKey).toBeUndefined()
    expect(balanceOf(transferred, studentC)).toBe(before + 1)
    const released = computeWholeDayTransferPairRelease({
      weeks: transferred.weeks, dateKey: makeup.to.dateKey, classroomSettings: settings(), teachers, students: roster, regularLessons: rows,
      suppressedRegularLessonOccurrences: transferred.ledgers.suppressedRegularLessonOccurrences, templatePendingDesks: transferred.pendingDesks, createdAt: SAVED_AT,
    })
    if (released.status !== 'transferred') throw new Error(released.message)
    const back: Stage = { ...transferred, weeks: released.nextWeeks, pendingDesks: released.nextTemplatePendingDesks, ledgers: { ...transferred.ledgers, suppressedRegularLessonOccurrences: released.nextSuppressedRegularLessonOccurrences } }
    const source = cellOf(back.weeks, `${trial.to.dateKey}_${slot}`)
    expect(source.desks[trial.to.deskIndex].lesson?.studentSlots[trial.to.studentIndex]).toMatchObject({ lessonType: 'trial' })
    expect(ids(source.desks[landing])).toEqual([studentC, null])
    expect(source.desks[landing].statusSlots?.some(Boolean) ?? false).toBe(false)
    expect(balanceOf(back, studentC)).toBe(before)
  })
})

describe('v2-3: 緑の下の行だけの手入力の生徒はテンプレの席へ上がり、手置き講師がテンプレの別の机にも居る机は手置き講師のまま。同じ日に動かして休みにした授業は戻らない', () => {
  const opsOf = (run: Run) => stepsOf(run).flatMap((step) => (step.kind === 'board' ? step.ops : []))
  const templateSteps = (run: Run) => stepsOf(run).filter((step) => step.kind === 'template')

  it('準備の 3 段目（Q の登録と保存）のあと: 振替の机は緑（上の行＝Q・下の行＝A の振替）、手置き講師 X の机、動かして休みにした R', () => {
    const run = runPrep('v2-3', initialStage())
    const greenStage = run.history[2]
    const makeup = opsOf(run).find((op) => op.kind === 'makeup') as { studentId: string; to: { cellId: string; deskIndex: number } }
    const cell = cellOf(greenStage.weeks, makeup.to.cellId)
    const qId = templateSteps(run)[1].kind === 'template' ? (templateSteps(run)[1] as { registrations: Array<{ studentId?: string }> }).registrations[0].studentId! : ''
    expect(ids(cell.desks[makeup.to.deskIndex])).toEqual([qId, null])
    const lower = greenStage.pendingDesks[buildTemplatePendingDeskKey(cell.id, cell.desks[makeup.to.deskIndex].id)]?.lower
    expect(lower?.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([makeup.studentId, null])
    expect(lower?.lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', origin: 'manual' })
  })

  it('準備（最後の保存まで）: A はテンプレの机の席に 1 行（緑は消える）・X の机は X の 1 行で別の机に X も別の講師も入らない・R の元の時限に授業は戻らない', () => {
    const start = initialStage()
    const run = runPrep('v2-3', start)
    const makeup = opsOf(run).find((op) => op.kind === 'makeup') as { studentId: string; to: { cellId: string; deskIndex: number; dateKey: string } }
    const teacherOp = opsOf(run).find((op) => op.kind === 'manual-teacher') as { teacherName: string; to: { deskIndex: number } }
    const move = opsOf(run).find((op) => op.kind === 'move') as { studentId: string; fromCellId: string; to: { cellId: string } }
    const final = templateSteps(run)[2] as { registrations: Array<{ studentId?: string; deskIndex: number }>; teacherRegistrations: Array<{ teacherName: string; deskIndex: number }> }
    const cell = cellOf(run.stage.weeks, makeup.to.cellId)
    // (1) A はテンプレの机（最後の保存で登録した机）の席に上がって 1 行。振替の机は Q だけで、保留は無い。
    const aDesk = final.registrations[0].deskIndex
    expect(cell.desks[aDesk].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: makeup.studentId, lessonType: 'makeup' })
    expect(placesOf(run.stage.weeks, makeup.studentId, makeup.to.dateKey).filter((place) => place!.startsWith(`${cell.id}:`))).toEqual([`${cell.id}:${aDesk}:0`])
    expect(run.stage.pendingDesks).toEqual({})
    expect(run.message).toContain('緑の下の行にだけ居た手入力のこの生徒を、テンプレの席')
    // 2026-11-07 オーナー報告（v2-3 の「詳細」で A が 2 行）: 上げた A は「上げて 1 行」の 1 行だけ。「手入力の同じ生徒が先にある」の行・
    // 「別の机に居るため上段に置かなかった」の件数には入れない（テンプレの席に居るのは上げた A なので、どちらも起きたことと違う）。
    const aName = roster.find((student) => student.id === makeup.studentId)!.name
    const aLines = run.message.split('\n').filter((line) => line.includes(`${aName}（`))
    expect(aLines).toHaveLength(1)
    expect(aLines[0]).toContain('緑の下の行にだけ居た手入力のこの生徒を、テンプレの席')
    expect(run.message).not.toContain(`${aName}（${cell.desks[aDesk].lesson!.studentSlots[0]!.subject}）: 同じコマに手入力の同じ生徒が先にあるため`)
    const lastSave = run.saves[run.saves.length - 1]
    expect(lastSave.summary.skippedDuplicateStudents).toBe(0)
    expect(lastSave.studentNotes.filter((note) => note.studentName === aName).map((note) => note.kind)).toEqual(['lower-promoted'])
    // (2) X の机は X の 1 行（手置き）。テンプレの X の机にも、別の講師 W も入らない。このコマの X は 1 回だけ。
    const [registeredW, registeredX] = final.teacherRegistrations
    expect(cell.desks[teacherOp.to.deskIndex]).toMatchObject({ teacher: teacherOp.teacherName, manualTeacher: true })
    expect(cell.desks.filter((desk) => desk.teacher === registeredX.teacherName)).toHaveLength(1)
    expect(cell.desks.some((desk) => desk.teacher === registeredW.teacherName)).toBe(false)
    expect(cell.desks[registeredX.deskIndex].teacher).not.toBe(registeredX.teacherName)
    expect(run.message).toContain(`この机の手で置いた講師 ${teacherOp.teacherName}は同じコマの別の机にもテンプレで入るため`)
    // (3) R の元の時限（テンプレの位置）には授業が戻らず、休みの記録は動かした先のコマ。R の未消化振替は休みの 1 件だけ。
    expect(placesOf(run.stage.weeks, move.studentId, cellOf(run.stage.weeks, move.fromCellId).dateKey)).toEqual([])
    expect(recordsOf(run.stage.weeks, move.studentId)).toEqual([`${move.to.cellId}:absent`])
    expect(balanceOf(run.stage, move.studentId)).toBe(1)
  })

  it('何も変えずにもう一度保存しても形は変わらない', () => {
    const run = runPrep('v2-3', initialStage())
    const again = saveUnchanged(run.stage)
    expect(JSON.stringify(again.next.weeks)).toBe(JSON.stringify(run.stage.weeks))
    expect(again.next.pendingDesks).toEqual({})
  })
})

describe('ほかの生徒の予定数・未消化振替・講習の残り・授業の位置は動かない（INV-06・INV-02）', () => {
  for (const itemId of CHECKLIST_PREP_SEQUENCE_ITEM_IDS) {
    it(`${itemId}: 準備の前後で同じ（何も変えないテンプレ保存の後も同じ）`, () => {
      const start = initialStage()
      const before = othersSnapshot(start)
      expect(before.stock.length).toBeGreaterThan(0)
      expect(before.planned.length).toBeGreaterThan(0)
      expect(before.lectureRemaining).toBe(LECTURE_REQUESTED - 1)
      const run = runPrep(itemId, start)
      expect(othersSnapshot(run.stage)).toEqual(before)
      expect(othersSnapshot(saveUnchanged(run.stage).next)).toEqual(before)
      // 準備が台帳に積むのは確認用の生徒の分だけ。
      for (const key of Object.keys(run.stage.ledgers.manualMakeupAdjustments)) expect(prepIds.has(key.split('__')[0]), key).toBe(true)
      for (const key of run.stage.ledgers.suppressedRegularLessonOccurrences) expect(prepIds.has(key.split('__')[0]), key).toBe(true)
      expect(run.stage.ledgers.manualLectureStockCounts).toEqual({})
      // 盤面に足した生徒は確認用の生徒と体験だけ。
      const added = run.stage.weeks.flat().flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student && !before.lessons.some((place) => place?.includes(`:${student.name}:`)))
      expect(added.every((student) => student?.name.startsWith('確認用'))).toBe(true)
    })
  }
})

describe('後片づけ: 確認用の生徒の手入力の授業・出欠記録・台帳の分も消す（確認用の生徒は名簿に残す・ほかの生徒は触らない）', () => {
  for (const itemId of CHECKLIST_PREP_SEQUENCE_ITEM_IDS) {
    it(`${itemId}: 後片づけ → テンプレ保存で、確認用の生徒は盤面・記録・台帳のどこにも残らず、ほかの生徒は準備の前と同じ`, () => {
      const start = initialStage()
      const before = othersSnapshot(start)
      const run = runPrep(itemId, start)
      const cleanup = planChecklistPrepCleanup({ weeks: run.stage.weeks, pendingDesks: run.stage.pendingDesks, savedTemplate: run.stage.template, students: roster, toSaveTemplate: (template) => template, ledgers: run.stage.ledgers })
      if (cleanup.nothing) throw new Error('nothing to clean')
      expect(cleanup.ledgers).toBeDefined()
      const cleaned = commitLike(run.stage, cleanup.weeks, { ...run.stage.ledgers, ...cleanup.ledgers! })
      const saved = saveTemplate({ ...cleaned, pendingDesks: cleanup.pendingDesks ?? {} }, cleanup.template!)
      for (const id of prepIds) {
        expect(placesOf(saved.next.weeks, id), id).toEqual([])
        expect(recordsOf(saved.next.weeks, id), id).toEqual([])
      }
      for (const key of Object.keys(saved.next.ledgers.manualMakeupAdjustments)) expect(prepIds.has(key.split('__')[0]), key).toBe(false)
      for (const key of saved.next.ledgers.suppressedRegularLessonOccurrences) expect(prepIds.has(key.split('__')[0]), key).toBe(false)
      expect(othersSnapshot(saved.next)).toEqual(before)
      expect(saved.next.pendingDesks).toEqual({})
    })
  }

  it('講習の台帳は確認用の生徒の分でも外さない（準備は講習を作らない・室長が手で置いた講習の休みの分は準備で作ったものではないので残す）', () => {
    const stage = initialStage()
    const prepId = [...prepIds][0]
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [`${prepId}__数__ss1`]: 1 }, manualLectureStockOrigins: { [`${prepId}__数__ss1`]: [{ displayName: '確認用 生徒A', sessionId: 'ss1', originDateKey: '2026-10-08', originSlotNumber: 5 }] } }
    const result = cleanupChecklistPrepStudentRecords({ weeks: stage.weeks, pendingDesks: {}, prepStudentIds: prepIds, ledgers })
    expect(result.ledgers.manualLectureStockCounts).toBe(ledgers.manualLectureStockCounts)
    expect(result.ledgers.manualLectureStockOrigins).toBe(ledgers.manualLectureStockOrigins)
    expect(result.removed.ledgerEntries).toBe(0)
  })

  it('鍵が確認用の生徒でない台帳・記録・手入力の授業は消さない（ほかの生徒の休みの記録・講習・台帳）', () => {
    const stage = initialStage()
    const ledgers = { ...emptyLedgers(), manualMakeupAdjustments: { 'sC__数': [{ dateKey: '2026-10-02' }] } as unknown as StudentAbsentMarkLedgers['manualMakeupAdjustments'], suppressedRegularLessonOccurrences: ['sA__数__2026-10-15__5', 'WHOLE_DAY_PAIR__2026-10-08__2026-10-15__0'] }
    const result = cleanupChecklistPrepStudentRecords({ weeks: stage.weeks, pendingDesks: {}, prepStudentIds: prepIds, ledgers })
    expect(result.weeks).toBe(stage.weeks)
    expect(result.ledgers).toBe(ledgers)
    expect(result.removed).toEqual({ lessons: 0, records: 0, ledgerEntries: 0 })
  })
})

describe('もう一度「準備する」を押すと、別の机・別の確認用の生徒で作り直す（同じコマに同じ生徒を 2 か所に置かない・INV-12）', () => {
  for (const itemId of CHECKLIST_PREP_SEQUENCE_ITEM_IDS) {
    it(`${itemId}: 1 回目の準備の後にもう一度準備しても、どのコマにも同じ生徒が 2 か所に居ない。ほかの生徒は変わらない`, () => {
      const start = initialStage()
      const before = othersSnapshot(start)
      const first = runPrep(itemId, start)
      const second = runPrep(itemId, first.stage)
      for (const cell of second.stage.weeks.flat()) {
        const placed = cell.desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).map((student) => student?.managedStudentId).filter(Boolean))
        expect(new Set(placed).size, cell.id).toBe(placed.length)
      }
      expect(othersSnapshot(second.stage)).toEqual(before)
    })
  }
})

describe('段ごとの安全（全部か無し・行ったことを書く・INV-08）', () => {
  it('置く先の席が埋まっていたら、その段は当てずに理由を返す（入れ替えで別の生徒を動かさない・INV-02）', () => {
    const start = initialStage()
    const first = planChecklistPrepSequenceStep('tp-71', null, envOf(start))
    if (first.kind !== 'template') throw new Error(first.kind)
    const prepared = prepareChecklistPrepTemplateSave({ registrations: first.registrations, baseTemplate: baselineOf(start.template), effectiveStartDate: EFFECTIVE, students: roster, savedAt: SAVED_AT })
    if (!prepared.ok) throw new Error(prepared.reason)
    const saved = saveTemplate(start, prepared.template)
    const state = recordChecklistPrepSequenceTemplateSaved(first.state, { assigned: prepared.assigned, effectiveStartDate: EFFECTIVE, todayKey: TODAY_KEY, summary: saved.diff.summary })
    // A を動かす先の席に別の生徒（体験）が入った盤面。
    const move = state.steps[1].kind === 'board' ? state.steps[1].ops[0] : null
    if (!move || move.kind !== 'move') throw new Error('no move')
    const blocked = structuredClone(saved.next.weeks)
    cellOf(blocked, move.to.cellId).desks[move.to.deskIndex].lesson = { id: 'x', studentSlots: [{ id: 'trial-x', name: '体験生', grade: '中1', subject: '英', lessonType: 'trial', teacherType: 'normal', manualAdded: true }, null] }
    const action = planChecklistPrepSequenceStep('tp-71', state, envOf({ ...saved.next, weeks: blocked }))
    expect(action.kind).toBe('fail')
    if (action.kind !== 'fail') return
    expect(action.reason).toContain('動かす先の席が空いていません')
    // 途中で止めた文: ここまでに行ったこと（テンプレの保存）と後片づけの案内。
    const message = buildChecklistPrepSequenceFailedMessage(state, action.reason)
    expect(message).toContain('途中で止めました: 動かす先の席が空いていません')
    expect(message).toContain('を登録して、テンプレを保存しました。')
    expect(message).toContain('「後片づけ」で準備を消せます')
    // 最初の段より前の失敗は理由だけ。
    expect(buildChecklistPrepSequenceFailedMessage(null, '理由')).toBe('理由')
  })

  it('始める前に断る: 検証用教室でない・テンプレ編集中・差分反映の無い教室・確認用の生徒が足りない', () => {
    const base = { itemId: 'tp-71' as const, isVerificationClassroom: true, isTemplateMode: false, templateDiffApplyEnabled: true, students: roster }
    expect(resolveChecklistPrepSequenceStartBlock(base)).toBeNull()
    expect(resolveChecklistPrepSequenceStartBlock({ ...base, isVerificationClassroom: false })).toContain('開発用教室・テスト教室')
    expect(resolveChecklistPrepSequenceStartBlock({ ...base, isTemplateMode: true })).toContain('テンプレート編集中')
    expect(resolveChecklistPrepSequenceStartBlock({ ...base, templateDiffApplyEnabled: false })).toContain('何も変えていません')
    expect(resolveChecklistPrepSequenceStartBlock({ ...base, students: baseStudents })).toContain('確認用の生徒が名簿に足りません')
    expect(CHECKLIST_PREP_SEQUENCE_ITEM_IDS.map((itemId) => CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT[itemId])).toEqual([2, 2, 2, 3, 2])
  })

  it('置き場が無ければ何も変えずに理由を返す。盤面の週が足りなければ週を作りに移る（v2-6 は 1 週後も要る）', () => {
    const start = initialStage()
    const oneWeek: Stage = { ...start, weeks: [start.weeks[0]] }
    expect(planChecklistPrepSequenceStep('v2-6', null, envOf(oneWeek))).toEqual({ kind: 'jump', dateKey: '2026-10-15' })
    const closed = start.weeks.map((week) => week.map((cell) => ({ ...cell, isOpenDay: false })))
    const none = planChecklistPrepSequenceStep('tp-71', null, { ...envOf(start), normalizedWeeks: closed })
    expect(none.kind).toBe('fail')
    if (none.kind === 'fail') expect(none.reason).toContain('何も変えていません')
  })

  it('取りやめ・タイムアウトの文は「ここまでに行ったこと」で書く（テンプレを保存した段のあとで「テンプレは保存していません」と言わない）', () => {
    const text = resolveChecklistPrepAbortMessage('timeout', 'fallback', { kind: 'prep', summary: 'テンプレの … を登録して、テンプレを保存しました。' })
    expect(text).toContain('ここまでに行ったこと: テンプレの … を登録して、テンプレを保存しました。')
    expect(text).not.toContain('テンプレは保存していません')
    // summary の無い第 2・3 段は今の文のまま。
    expect(resolveChecklistPrepAbortMessage('timeout', 'fallback', { kind: 'prep' })).toContain('盤面には置きましたが、テンプレは保存していません')
  })
})

describe('コマ表の配線（ScheduleBoardScreen.tsx）', () => {
  const effectStart = BOARD_TSX.indexOf('if (!shouldProcessChecklistPrepRequest(checklistPrepRequest, processedChecklistPrepRequestIdRef.current, {')
  const body = BOARD_TSX.slice(effectStart, BOARD_TSX.indexOf('}, [', effectStart))
  const runner = body.slice(body.indexOf('const runChecklistPrepSequence = '), body.indexOf('const sequenceTiming = '))

  it('段を続ける項目は始める前の判断（純関数）を通してから段を進める。盤面の操作は室長の操作と同じ純関数を渡す', () => {
    const route = body.indexOf('if (isChecklistPrepSequenceItemId(request.itemId)) {')
    expect(route).toBeGreaterThan(0)
    expect(route).toBeLessThan(body.indexOf('resolveChecklistPrepStep({'))
    expect(body.slice(route, route + 600)).toContain('resolveChecklistPrepSequenceStartBlock({ itemId: request.itemId, isVerificationClassroom: isDevelopmentClassroom({ id: classroomStorageKey ?? null }), isTemplateMode, templateDiffApplyEnabled, students })')
    expect(runner).toContain('operations: CHECKLIST_PREP_BOARD_OPERATIONS,')
    expect(BOARD_TSX).toContain('export const CHECKLIST_PREP_BOARD_OPERATIONS: ChecklistPrepBoardOperations = {\n  computeStudentMove,\n  computeStudentAbsentMark,\n  computeMakeupStockPlacement,\n  applyClassroomAvailability,\n}')
  })

  it('段ごとに教室とテンプレ編集中を見直す（INV-08）。テンプレの段は手で保存するときと同じ重複ガードと保存。盤面の段は commitWeeks に台帳ごと渡す', () => {
    expect(runner.indexOf('resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: request.classroomId, classroomId: classroomStorageKey ?? null, isTemplateMode })')).toBeLessThan(runner.indexOf('planChecklistPrepSequenceStep('))
    expect(runner.indexOf('findTemplateDuplicateStudents(')).toBeLessThan(runner.indexOf('handleSaveRegularLessonTemplateByDiff(prepared.template)'))
    expect(runner).toContain('action.ledgers.manualMakeupAdjustments, action.ledgers.suppressedMakeupOrigins, action.ledgers.fallbackMakeupStudents,')
    expect(runner).toContain('action.ledgers.suppressedRegularLessonOccurrences,')
    // 次の段は盤面が変わった次のレンダーで行う（積んだときの weeks・保留マップを持つ）。進み具合は「ここまでに行ったこと」つきで App へ。
    expect(runner).toContain('queuedFromWeeks: weeks, queuedFromPendingDesks: templatePendingDesks')
    expect(runner).toContain("onChecklistPrepRequestProgress?.({ requestId: request.requestId, stage: 'board-applied', kind: 'prep', summary: summarizeChecklistPrepSequenceProgress(nextSequenceState) })")
    expect(body).toMatch(/if \(sequenceTiming === 'wait'\) \{\r?\n\s+return\r?\n\s+\}/u)
    // finish は積んだ段を捨てる。
    expect(body.slice(body.indexOf('const finish = '), body.indexOf('const finish = ') + 300)).toContain('checklistPrepSequenceRef.current = null')
  })

  it('後片づけは確認用の生徒の台帳の分を外した台帳を commitWeeks に渡す', () => {
    const cleanup = body.slice(body.indexOf("if (request.kind === 'cleanup') {"))
    expect(cleanup).toContain('ledgers: { manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, suppressedRegularLessonOccurrences } })')
    expect(cleanup).toContain('led.manualMakeupAdjustments, led.suppressedMakeupOrigins, led.fallbackMakeupStudents, undefined, undefined, undefined,')
    expect(cleanup).toContain('led.suppressedRegularLessonOccurrences, undefined, undefined, cleanupPlan.pendingDesks ?? templatePendingDesks,')
  })
})

