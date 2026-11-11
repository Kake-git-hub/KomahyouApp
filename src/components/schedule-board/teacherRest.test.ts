// 講師の休み（docs/spec-template-conflict-v2.md §2-4・§5・§9 決定記録 4・7・8・§10 段 3 の受け入れ条件 3-1〜3-5）の経路テスト。
// INV-01（講師帰属の一意）・INV-02（休みの記録は反映で消えない）・INV-03（同じ保存 2 回・再マージ 2 回で不変）。
// 機能フラグ templateDiffApply が ON の教室の再マージ（templateOriginRules を渡す）と差分反映（computeTemplateDiffApplyForBoard）の両方を通す。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computePendingTeacherChoice } from './templatePendingResolution'
import type { TemplatePendingDeskMap } from './templatePendingDesks'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell } from './types'
import {
  applyUserDeletedTeacherTombstone,
  buildManagedScheduleCellsForRange,
  cloneWeeks,
  computeTeacherMove,
  computeTemplateDiffApplyForBoard,
  isDeletedTeacherTombstone,
  reconcileSubmittedTeacherPlacements,
  remergeBoardWeeksWithManagedData,
  repackTeacherOnlyDesks,
} from './ScheduleBoardScreen'
import { applyTemplateOriginRulesToManagedCell } from './templateConflictRules'
import { buildTeacherAliasResolver } from './templateDiffApply'
import { isManualOriginDeskTeacher } from './placementOrigin'
import { weekHasManualBoardData } from './boardWeekTrim'
import {
  buildTemplateTeacherRestPredicate,
  computeToggleDeskTeacherRest,
  hasDeskTeacherRest,
  isTeacherRestedInCell,
  releaseDeskTeacherRest,
  releaseTeacherRestIfSameTeacherPlaced,
  releaseTeacherRestInCellIfSameTeacherPlaced,
  restDeskTeacher,
} from './teacherRest'
import { resolveManualTeacherAssignmentSource, setManualTeacherAssignment } from './deskTeacherAssignment'
import { applyChecklistPrepOps } from './checklistPrep'
import { buildTeacherPayload } from '../../utils/scheduleHtml'
import { buildTeacherSheetViewModel } from '../../utils/scheduleViewData'
import { buildParentScheduleView } from '../../utils/parentSchedule'
import { cloneParentScheduleFixturePayload, PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE } from '../../utils/parentSchedule.fixture'
import type { AppSnapshotPayload } from '../../types/appState'

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-10-01'

const studentRow = (id: string, name: string): StudentRow => ({ id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' })
const teacherRow = (id: string, name: string): TeacherRow => ({ id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] })
const students = [studentRow('sA', '青木'), studentRow('sB', '馬場')]
// t1=田中（休みにする講師）・t2=鈴木・t3=佐藤（講師だけの机）・t4=高橋（休みの机に手で置く講師）
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤'), teacherRow('t4', '高橋')]
const row = (id: string, teacherId: string, student1Id = ''): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
})
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, templateFreezeBeforeDate: DATE, ...extra }) as ClassroomSettings
/** 水 5限: 机 0=田中+青木・机 1=鈴木+馬場・机 2=佐藤（講師だけ）。 */
const ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')]
/** テンプレを変えて田中を机 2（講師だけ）へ、佐藤を机 0 へ。 */
const MOVED_ROWS = [row('r0', 't3', 'sA'), row('r1', 't2', 'sB'), row('r2', 't1')]

function buildWeek(rows: RegularLessonRow[] = ROWS) {
  return buildManagedScheduleCellsForRange({ range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' }, fallbackStartDate: WEEK_START, fallbackEndDate: WEEK_END, classroomSettings: settings({ templateFreezeBeforeDate: undefined }), teachers, students, regularLessons: rows, boardWeeks: [] })
}
const cellOf = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL_ID)!
const ids = (desk: DeskCell) => (desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)
const teachersIn = (weeks: SlotCell[][]) => cellOf(weeks).desks.map((desk) => desk.teacher)
function remerge(weeks: SlotCell[][], rows: RegularLessonRow[] = ROWS, flagOn = true) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings(), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: [], todayKey: TODAY_KEY, templateOriginRules: flagOn ? { pendingDesks: {} } : null })
}
function save(weeks: SlotCell[][], rows: RegularLessonRow[] = ROWS) {
  return computeTemplateDiffApplyForBoard({ weeks, classroomSettings: settings(), teachers, students, regularLessons: rows, effectiveStartDate: DATE, suppressedRegularLessonOccurrences: [], templatePendingDesks: {}, createdAt: '2026-10-01T10:00:00.000Z', manualMakeupAdjustments: {}, scheduleCountAdjustments: [] })
}
function toggle(weeks: SlotCell[][], deskIndex: number) {
  const result = computeToggleDeskTeacherRest({ weeks, weekIndex: 0, cellId: CELL_ID, deskIndex, resolveTeacherId: (name) => teachers.find((teacher) => teacher.name === name)?.id })
  if (result.status === 'blocked') throw new Error(result.message)
  return result
}
/** 机 0（田中）を休みにした盤面（読み込みの再マージを通した正規形）。 */
function restedBoard() {
  return remerge(toggle([buildWeek()], 0).nextWeeks)
}
function placeManualTeacher(weeks: SlotCell[][], deskIndex: number, name: string, id: string) {
  return weeks.map((week) => week.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === deskIndex ? { ...desk, teacher: name, manualTeacher: true, teacherAssignmentSource: 'manual' as const, teacherAssignmentTeacherId: id } : desk)) })))
}
function expectFixpoint(weeks: SlotCell[][], rows: RegularLessonRow[] = ROWS) {
  const once = remerge(weeks, rows)
  expect(once.flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
  expect(remerge(once, rows).flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
}
function teacherSheetStudents(weeks: SlotCell[][], teacherId: string) {
  const payload = buildTeacherPayload({ cells: weeks.flat(), defaultStartDate: WEEK_START, defaultEndDate: WEEK_END, titleLabel: '休み', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, teachers, students, regularLessons: ROWS })
  const vm = buildTeacherSheetViewModel(payload, { startDate: WEEK_START, endDate: WEEK_END, teacherId, todayKey: TODAY_KEY })
  const cell = vm?.rows.find((item) => item.slotNumber === SLOT)?.cells.find((item) => item.dateKey === DATE)
  return (cell?.people ?? []).map((person) => person.name)
}

describe('3-1・3-5 講師欄の「休み」ボタン（computeToggleDeskTeacherRest）: 1 コマ（机）ごと・同じボタンで解除・削除記録とは別', () => {
  it('押すと机の講師が空になり休みの記録（講師名・講師 ID）が残る。生徒は残り、他の机・他のコマは参照ごと不変', () => {
    const weeks = [buildWeek()]
    const result = toggle(weeks, 0)
    expect(result.status).toBe('rested')
    const desk = cellOf(result.nextWeeks).desks[0]
    expect(desk).toMatchObject({ teacher: '', manualTeacher: false, teacherRest: { teacher: '田中', teacherId: 't1' } })
    expect(desk.teacherAssignmentSource).toBeUndefined()
    expect(ids(desk)).toEqual(['sA'])
    expect(cellOf(result.nextWeeks).desks[1]).toBe(cellOf(weeks).desks[1])
    expect(result.nextWeeks[0].filter((cell) => cell.id !== CELL_ID)).toEqual(weeks[0].filter((cell) => cell.id !== CELL_ID))
    // 渡した盤面は書き換えない
    expect(cellOf(weeks).desks[0].teacher).toBe('田中')
    // 削除記録ではない（§9-8）
    expect(isDeletedTeacherTombstone(desk)).toBe(false)
  })

  it('同じボタンをもう一度押すと解除（記録だけ消える・講師欄は空のまま）', () => {
    const rested = toggle([buildWeek()], 0).nextWeeks
    const released = toggle(rested, 0)
    expect(released.status).toBe('released')
    const desk = cellOf(released.nextWeeks).desks[0]
    expect(desk.teacherRest).toBeUndefined()
    expect(desk.teacher).toBe('')
    expect(ids(desk)).toEqual(['sA'])
  })

  it('講師の居ない机・休校のコマでは押せない（blocked）。講師の削除記録の机も講師が居ないので休みにならない', () => {
    const weeks = [buildWeek().map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? (() => { const next = { ...desk }; applyUserDeletedTeacherTombstone(next); return next })() : desk)) }))]
    expect(cellOf(weeks).desks[0]).toMatchObject({ teacher: '', teacherAssignmentSource: 'deleted' })
    expect(computeToggleDeskTeacherRest({ weeks, weekIndex: 0, cellId: CELL_ID, deskIndex: 0 }).status).toBe('blocked')
    // 削除しても休みにはならない
    expect(hasDeskTeacherRest(cellOf(weeks).desks[0])).toBe(false)
    const closed = [buildWeek().map((cell) => (cell.id === CELL_ID ? { ...cell, isOpenDay: false } : cell))]
    expect(computeToggleDeskTeacherRest({ weeks: closed, weekIndex: 0, cellId: CELL_ID, deskIndex: 0 }).status).toBe('blocked')
  })

  it('日程表登録（QR）の講師を休みにすると講習 ID を記録に残す。休みの机の画面だけの印（出席不可の警告・ずらした緑）は外す', () => {
    const desk: DeskCell = { id: 'd', teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't1', teacherUnavailableWarning: true, templateTeacherShift: { teacher: '田中', fromDeskIndex: 1 } }
    const rested = restDeskTeacher(desk)!
    expect(rested.teacherRest).toEqual({ teacher: '田中', teacherId: 't1', sessionId: 'ss1' })
    expect(rested.teacherUnavailableWarning).toBeUndefined()
    expect(rested.templateTeacherShift).toBeUndefined()
    expect(restDeskTeacher(rested)).toBeNull()
    expect(releaseDeskTeacherRest({ id: 'd', teacher: '' })).toBeNull()
  })
})

describe('休みの判定（isTeacherRestedInCell・buildTemplateTeacherRestPredicate）は日付×時限×講師（呼び名の対応表で同じ講師）', () => {
  const aliases = buildTeacherAliasResolver(teachers)
  it('記録が講師 ID だけでも、表示名で置こうとする同じ講師を休みと判定する。別の講師・別のコマは休みでない', () => {
    const cell = { desks: [{ id: 'd0', teacher: '', teacherRest: { teacher: '', teacherId: 't1' } }] }
    expect(isTeacherRestedInCell(cell, { teacher: '田中' }, aliases)).toBe(true)
    expect(isTeacherRestedInCell(cell, { teacher: '鈴木', teacherAssignmentTeacherId: 't2' }, aliases)).toBe(false)
    const predicate = buildTemplateTeacherRestPredicate([[{ dateKey: DATE, slotNumber: SLOT, ...cell }]], aliases)!
    expect(predicate({ dateKey: DATE, slotNumber: SLOT }, { teacher: '田中' })).toBe(true)
    expect(predicate({ dateKey: DATE, slotNumber: SLOT - 1 }, { teacher: '田中' })).toBe(false)
    expect(predicate({ dateKey: '2026-10-08', slotNumber: SLOT }, { teacher: '田中' })).toBe(false)
  })
  it('休みが 1 件も無い盤面は null（差分反映・再マージは今までどおり）', () => {
    expect(buildTemplateTeacherRestPredicate([buildWeek()], aliases)).toBeNull()
  })
  it('再マージの取り除き（applyTemplateOriginRulesToManagedCell）: ほかの取り除きが無いコマでも、休みの講師はテンプレのどの机からも外す（早く返さない）', () => {
    const managed = cellOf([buildWeek(MOVED_ROWS)])
    const boardCell = cellOf(restedBoard())
    const predicate = buildTemplateTeacherRestPredicate([[boardCell]], aliases)!
    const ruled = applyTemplateOriginRulesToManagedCell(managed, boardCell, {}, aliases, predicate)
    expect(ruled.desks.map((desk) => desk.teacher)).toEqual(['佐藤', '鈴木', ''])
    // 述語を渡さなければ従来どおり（参照ごと返す）
    expect(applyTemplateOriginRulesToManagedCell(managed, cellOf([buildWeek()]), {}, aliases)).toBe(managed)
  })
})

describe('3-2・3-4 休みが勝つ（INV-02・INV-03）: 再マージでもテンプレの反映でも休みの講師はそのコマのどの机にも置かれない', () => {
  it('再マージ（読み込み・名簿の変更）: 机 0 は講師なしのまま・生徒は残る・記録も残る。2 回通しても同じ', () => {
    const weeks = restedBoard()
    expect(teachersIn(weeks)).toEqual(['', '鈴木', '佐藤'])
    expect(cellOf(weeks).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    expect(ids(cellOf(weeks).desks[0])).toEqual(['sA'])
    expectFixpoint(weeks)
  })

  it('フラグ OFF の教室の再マージ（規則を渡さない）は休みを見ない＝この教室ではボタンも出さず記録も書かない（OFF の挙動は従来どおり）', () => {
    const weeks = remerge(toggle([buildWeek()], 0).nextWeeks, ROWS, false)
    expect(teachersIn(weeks)).toEqual(['田中', '鈴木', '佐藤'])
  })

  it('テンプレで田中を別の机（机 2）へ動かして反映しても、田中はこのコマのどの机にも置かれない。机 0 にはテンプレの佐藤（休みの記録は残る）', () => {
    const saved = save(restedBoard(), MOVED_ROWS)
    expect(teachersIn(saved.nextWeeks)).toEqual(['佐藤', '鈴木', ''])
    expect(cellOf(saved.nextWeeks).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    expect(saved.nextPendingDesks).toEqual({})
    expectFixpoint(saved.nextWeeks, MOVED_ROWS)
    // 同じ保存をもう一度しても変わらない（INV-03）
    const again = save(saved.nextWeeks, MOVED_ROWS)
    expect(again.nextWeeks.flat().map((cell) => cell.desks)).toEqual(saved.nextWeeks.flat().map((cell) => cell.desks))
  })

  it('同じテンプレの反映でも田中は戻らない（机 0 は講師なし・生徒は残る）', () => {
    const saved = save(restedBoard())
    expect(teachersIn(saved.nextWeeks)).toEqual(['', '鈴木', '佐藤'])
    expect(ids(cellOf(saved.nextWeeks).desks[0])).toEqual(['sA'])
    expectFixpoint(saved.nextWeeks)
  })

  it('解除すると、次の反映（再マージ・テンプレの反映）でテンプレの田中が机 0 に戻る', () => {
    const released = toggle(restedBoard(), 0).nextWeeks
    expect(teachersIn(released)).toEqual(['', '鈴木', '佐藤'])
    expect(teachersIn(remerge(released))).toEqual(['田中', '鈴木', '佐藤'])
    expect(teachersIn(save(released).nextWeeks)).toEqual(['田中', '鈴木', '佐藤'])
  })

  it('休みの机（講師だけの机・講師なし）より後ろに空き机があれば、テンプレに足した講師だけの机は空き机へ置く（休みのグレーを別の講師で隠さない）', () => {
    // 机 0=佐藤（講師だけ）・机 1=鈴木+馬場・机 2=空き。佐藤を休みにした後、テンプレに高橋（講師だけ・机 2）を足す。
    const rows = [row('r0', 't3'), row('r1', 't2', 'sB')]
    const rested = remerge(toggle([buildWeek(rows)], 0).nextWeeks, rows)
    expect(teachersIn(rested)).toEqual(['', '鈴木', ''])
    const added = [...rows, row('r2', 't4')]
    const weeks = remerge(rested, added)
    expect(teachersIn(weeks)).toEqual(['', '鈴木', '高橋'])
    expect(cellOf(weeks).desks[0].teacherRest).toEqual({ teacher: '佐藤', teacherId: 't3' })
    expectFixpoint(weeks, added)
  })

  it('講師だけの机（佐藤）を休みにしても、再マージで佐藤が別の空き机に湧かない・休みの机に別の講師が詰められない', () => {
    const weeks = remerge(toggle([buildWeek()], 2).nextWeeks)
    expect(teachersIn(weeks)).toEqual(['田中', '鈴木', ''])
    expect(cellOf(weeks).desks[2].teacherRest).toEqual({ teacher: '佐藤', teacherId: 't3' })
    expectFixpoint(weeks)
  })
})

describe('3-3 休みの机に別の講師を手で置く: 青字の手入力・休みの記録は残る・テンプレの休みの講師は引き続き置かない', () => {
  it('高橋を手で置く → 反映・再マージの後も高橋（手入力）で 1 行（講師欄 2 行にならない）。記録は残り、田中はどの机にも出ない', () => {
    const weeks = placeManualTeacher(restedBoard(), 0, '高橋', 't4')
    const desk = cellOf(weeks).desks[0]
    expect(isManualOriginDeskTeacher(desk)).toBe(true)
    expect(desk.teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    const saved = save(weeks)
    expect(teachersIn(saved.nextWeeks)).toEqual(['高橋', '鈴木', '佐藤'])
    expect(cellOf(saved.nextWeeks).desks[0]).toMatchObject({ manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '田中' } })
    expect(saved.nextPendingDesks).toEqual({})
    expectFixpoint(saved.nextWeeks)
    // 講師日程表: 青木は高橋のページにだけ出る（INV-01）
    expect(teacherSheetStudents(saved.nextWeeks, 't4')).toEqual(['青木'])
    expect(teacherSheetStudents(saved.nextWeeks, 't1')).toEqual([])
  })
})

describe('3-4 講師日程表・保護者 QR には休みを出さない（講師なしの机として出る）', () => {
  it('講師日程表: 休みの田中のページに青木は出ない（基本データの担当講師へも漏れない）。鈴木のページは今のまま', () => {
    const weeks = restedBoard()
    expect(teacherSheetStudents(weeks, 't1')).toEqual([])
    expect(teacherSheetStudents(weeks, 't2')).toEqual(['馬場'])
    expect(JSON.stringify(buildTeacherPayload({ cells: weeks.flat(), defaultStartDate: WEEK_START, defaultEndDate: WEEK_END, titleLabel: '休み', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, teachers, students, regularLessons: ROWS }))).not.toContain('teacherRest')
  })

  it('保護者 QR の日程: 盤面に休みの記録があっても、無いときと同じ結果（講師は出さない）', () => {
    const payload = cloneParentScheduleFixturePayload() as AppSnapshotPayload
    const restedPayload = cloneParentScheduleFixturePayload() as AppSnapshotPayload
    let rested = 0
    restedPayload.boardState!.weeks = restedPayload.boardState!.weeks.map((week) => (Array.isArray(week) ? week.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk) => {
        const next = desk.teacher.trim() ? restDeskTeacher(desk) : null
        if (next) rested += 1
        return next ?? desk
      }),
    })) : week))
    expect(rested).toBeGreaterThan(0)
    for (const studentId of ['s001', 's002']) {
      const before = buildParentScheduleView(payload, studentId, { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE })
      const after = buildParentScheduleView(JSON.parse(JSON.stringify(restedPayload)), studentId, { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE })
      expect(after).toEqual(before)
      expect(JSON.stringify(after)).not.toContain('田中')
    }
  })
})

describe('休みの机を「空き机」として潰さない（削除記録・記録のある机と同じ守り方）', () => {
  const restedEmpty = (teacher = '田中'): DeskCell => ({ id: 'd0', teacher: '', teacherRest: { teacher } })
  it('講師だけの机の詰め直し（repackTeacherOnlyDesks）: 休みの机は入れ先にしない・据え置く。休みの机に手で置いた講師も動かさない', () => {
    const desks: DeskCell[] = [restedEmpty(), { id: 'd1', teacher: '' }, { id: 'd2', teacher: '佐藤' }]
    const repacked = repackTeacherOnlyDesks(desks)
    expect(repacked[0]).toBe(desks[0])
    expect(repacked.map((desk) => desk.teacher)).toEqual(['', '佐藤', ''])
    const overridden: DeskCell[] = [{ id: 'd0', teacher: '', lesson: { id: 'l', studentSlots: [null, null] } }, { id: 'd1', teacher: '' }, { id: 'd2', teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '田中' } }]
    const repacked2 = repackTeacherOnlyDesks(overridden)
    expect(repacked2[2]).toBe(overridden[2])
    expect(repacked2[1].teacher).toBe('')
  })

  it('間引き（weekHasManualBoardData）: 休みの記録だけの週も手入力のある週として残す（消えると次の再マージでテンプレの講師が戻る）', () => {
    const plain: SlotCell[] = [{ ...cellOf([buildWeek()]), desks: [{ id: 'd0', teacher: '佐藤' }] }]
    expect(weekHasManualBoardData(plain)).toBe(false)
    expect(weekHasManualBoardData(toggle([plain], 0).nextWeeks[0])).toBe(true)
  })
})

describe('QR 提出講師の自己修復・講習の講師自動割当（reconcileSubmittedTeacherPlacements）: 休みの講師を置き直さない', () => {
  const session = (teacherIds: string[]): SpecialSessionRow => ({
    id: 'ss1', label: '秋期講習', startDate: DATE, endDate: DATE,
    teacherInputs: Object.fromEntries(teacherIds.map((id) => [id, { unavailableSlots: [], countSubmitted: true, updatedAt: '' }])),
    studentInputs: {}, createdAt: '', updatedAt: '',
  }) as SpecialSessionRow
  const params = (weeks: SlotCell[][]) => ({ weeks, specialSessions: [session(['t4'])], teachers, students, regularLessons: ROWS, classroomSettings: settings(), templatePendingDesks: {} })
  const countTeacher = (weeks: SlotCell[][], name: string, cellId?: string) => weeks.flat().filter((cell) => !cellId || cell.id === cellId).flatMap((cell) => cell.desks).filter((desk) => desk.teacher === name).length

  it('この講習の登録机の講師（高橋）を休みにした → 記録の講習 ID で「室長が外した」と数え、自己修復が別の机へ置き直さない（何回通しても）', () => {
    const board = [buildWeek().map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 2 ? { ...desk, teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'schedule-registration' as const, teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't4' } : desk)) }))]
    const rested = toggle(board, 2).nextWeeks
    expect(cellOf(rested).desks[2].teacherRest).toEqual({ teacher: '高橋', teacherId: 't4', sessionId: 'ss1' })
    const first = reconcileSubmittedTeacherPlacements(params(rested))
    expect(first.hasChanges).toBe(false)
    expect(countTeacher(first.nextWeeks, '高橋')).toBe(0)
  })

  it('提出済みで未配置の講師（高橋）は置き直すが、高橋を休みにしたコマ（講習 ID の無い休み）には置かない', () => {
    // 5限の机 0 で高橋を手で置いて休みにした記録（通常授業の机）。高橋は講習の登録机にはどこにも居ない＝自己修復の対象。机 2 は空き机（置ける形）。
    const rows = ROWS.slice(0, 2)
    const board = placeManualTeacher([buildWeek(rows)], 0, '高橋', 't4')
    const rested = toggle(board, 0).nextWeeks
    expect(cellOf(rested).desks[0].teacherRest).toEqual({ teacher: '高橋', teacherId: 't4' })
    expect(cellOf(rested).desks[2]).toMatchObject({ teacher: '' })
    const result = reconcileSubmittedTeacherPlacements({ ...params(rested), regularLessons: rows })
    expect(result.placedCount).toBe(1)
    expect(countTeacher(result.nextWeeks, '高橋')).toBeGreaterThan(0)
    expect(countTeacher(result.nextWeeks, '高橋', CELL_ID)).toBe(0)
    expect(cellOf(result.nextWeeks).desks[0].teacherRest).toEqual({ teacher: '高橋', teacherId: 't4' })
  })
})

describe('§9-19 休んだ講師本人を手で置き直すと休みを自動で解除する（別の講師なら残す・自動配置では解除しない）', () => {
  const aliases = buildTeacherAliasResolver(teachers)
  it('本人（ID でも表示名でも）を置き直すと記録が消える。別の講師なら記録は残る', () => {
    const byId: DeskCell = { id: 'd', teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't1', teacherRest: { teacher: '田中', teacherId: 't1' } }
    expect(releaseTeacherRestIfSameTeacherPlaced(byId)).toBe(true)
    expect(byId.teacherRest).toBeUndefined()
    const byName: DeskCell = { id: 'd', teacher: '田中', manualTeacher: true, teacherRest: { teacher: '', teacherId: 't1' } }
    expect(releaseTeacherRestIfSameTeacherPlaced(byName, aliases)).toBe(true)
    const other: DeskCell = { id: 'd', teacher: '高橋', manualTeacher: true, teacherAssignmentTeacherId: 't4', teacherRest: { teacher: '田中', teacherId: 't1' } }
    expect(releaseTeacherRestIfSameTeacherPlaced(other, aliases)).toBe(false)
    expect(other.teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
  })

  it('講師の D&D（computeTeacherMove）で休みの机へ本人を戻すと解除・別の講師を入れると残る', () => {
    // 机 0＝田中の休み（講師なし）・机 1＝鈴木。机 2 に田中を手で置いた形から、机 2 → 机 0 へ田中を動かす。
    const rested = placeManualTeacher(restedBoard(), 2, '田中', 't1')
    const back = computeTeacherMove({ weeks: rested, weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 2, targetDeskIndex: 0, teachers })
    if (back.status !== 'moved') throw new Error(back.message)
    expect(cellOf(back.nextWeeks).desks[0]).toMatchObject({ teacher: '田中' })
    expect(cellOf(back.nextWeeks).desks[0].teacherRest).toBeUndefined()
    const otherTeacher = computeTeacherMove({ weeks: restedBoard(), weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 1, targetDeskIndex: 0, teachers })
    if (otherTeacher.status !== 'moved') throw new Error(otherTeacher.message)
    expect(cellOf(otherTeacher.nextWeeks).desks[0]).toMatchObject({ teacher: '鈴木', teacherRest: { teacher: '田中' } })
  })

  it('再マージ・テンプレの反映（自動配置）では解除しない（田中は戻らず記録も残る）', () => {
    const weeks = save(restedBoard()).nextWeeks
    expect(cellOf(remerge(weeks)).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
  })
})

// 段 4 監査 要確認-6（§9-19）: 保留の「下段(手入力)の講師を採用する」でも、休んだ講師本人（呼び名の対応表で同じ講師）なら休みを解除する。
describe('§9-19 × 保留の講師の採用: 休んだ講師本人を採用したら休みを解除する（呼び名の対応表を通す）', () => {
  const aliasTeachers: TeacherRow[] = [{ id: 't1', name: '田中 一郎', displayName: '田中', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }]
  const pendingWeeks = (): SlotCell[][] => [[{
    id: 'c1', dateKey: '2026-10-07', dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [{ id: 'd1', teacher: '', teacherRest: { teacher: '田中 一郎', teacherId: 't1' } }],
  }]]
  const pendingMap = (): TemplatePendingDeskMap => ({ 'c1::d1': { lower: { teacher: { teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' } }, effectiveStartDate: '2026-10-07', createdAt: '2026-10-01T00:00:00.000Z' } })
  it('対応表あり: 表示名「田中」で採用しても登録名「田中 一郎」の休みが解除される／対応表なし（名前の一致だけ）では残る', () => {
    const withAliases = computePendingTeacherChoice({ weeks: pendingWeeks(), templatePendingDesks: pendingMap(), cellId: 'c1', deskId: 'd1', choice: 'manual', teacherAliases: buildTeacherAliasResolver(aliasTeachers) })
    if (withAliases.status !== 'applied') throw new Error(withAliases.message)
    expect(withAliases.nextWeeks[0][0].desks[0]).toMatchObject({ teacher: '田中' })
    expect(withAliases.nextWeeks[0][0].desks[0].teacherRest).toBeUndefined()
    const withoutAliases = computePendingTeacherChoice({ weeks: pendingWeeks(), templatePendingDesks: pendingMap(), cellId: 'c1', deskId: 'd1', choice: 'manual' })
    if (withoutAliases.status !== 'applied') throw new Error(withoutAliases.message)
    expect(withoutAliases.nextWeeks[0][0].desks[0].teacherRest).toEqual({ teacher: '田中 一郎', teacherId: 't1' })
  })
  it('配線: 盤面の保留の解決は呼び名の対応表を渡す', () => {
    const board = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
    expect(board).toContain('teacherAliases: params.teacherAliases })')
    expect(board).toContain('      teacherAliases: buildTeacherAliasResolver(teachers),\n    })')
  })
})

// §9-25（2026-11-11 オーナー決定・案 1）: 休みにした講師 X を同じコマ（日付×時限）のどこかの机へ**手で**置いたら、そのコマにある X の休みの記録を全部消す
// （どの机に残っていても・代わりの講師 Y の机はそのまま）。§9-19（休みにした机へ置き直す）はこの特別な場合。自動で講師が入る経路（テンプレの反映・再マージ・
// 講習の自動割振・QR 提出の反映）は対象外（上の「再マージ・テンプレの反映（自動配置）では解除しない」・「QR 提出講師の自己修復…」の describe が固定）。
describe('§9-25 休みの講師を同じコマのどこかへ手で置いたら、そのコマの休みの記録を全部消す（権威関数 releaseTeacherRestInCellIfSameTeacherPlaced）', () => {
  const aliases = buildTeacherAliasResolver(teachers)
  const restOf = (weeks: SlotCell[][]) => cellOf(weeks).desks.map((desk) => desk.teacherRest ?? null)
  /** 机 0＝田中の休みの記録＋代わりの高橋（手置き）・机 1＝鈴木・机 2＝佐藤（講師だけ）。 */
  function restedWithSubstitute() {
    return placeManualTeacher(restedBoard(), 0, '高橋', 't4')
  }
  /** v1.5.722 より前に作られた食い違った形: 休みの記録が高橋の机（机 0）に残り、田中が同じコマの机 2 に居る。机 3＝空き机。 */
  function staleBoard() {
    const weeks = placeManualTeacher(restedWithSubstitute(), 2, '田中', 't1')
    return weeks.map((week) => week.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: [...cell.desks, { id: `${CELL_ID}_desk_4`, teacher: '' }] })))
  }

  describe('単体（権威関数）', () => {
    const desks = (): DeskCell[] => [
      { id: 'd0', teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', memoSlots: ['連絡', null], lesson: { id: 'l0', studentSlots: [null, null] }, teacherRest: { teacher: '田中', teacherId: 't1' } },
      { id: 'd1', teacher: '鈴木', teacherAssignmentTeacherId: 't2' },
      { id: 'd2', teacher: '', teacherRest: { teacher: '田中', teacherId: 't1' } },
      { id: 'd3', teacher: '', teacherRest: { teacher: '佐藤', teacherId: 't3' } },
    ]
    it('(a)(b) 別の机へ田中を置く → 代わりの講師の机の記録も、講師欄が空の休みの机の記録も、田中の分は全部消える。ほかの項目と別の講師の休みは不変', () => {
      const cell = desks()
      const before = desks()
      const placed: DeskCell = { id: 'd1', teacher: '田中', manualTeacher: true, teacherAssignmentTeacherId: 't1' }
      expect(releaseTeacherRestInCellIfSameTeacherPlaced(cell, placed, aliases)).toBe(true)
      expect(cell[0].teacherRest).toBeUndefined()
      expect(cell[2].teacherRest).toBeUndefined()
      const { teacherRest: _drop, ...restOfDesk0 } = before[0]
      expect(cell[0]).toEqual(restOfDesk0)
      expect(cell[3].teacherRest).toEqual({ teacher: '佐藤', teacherId: 't3' })
      expect(cell[1]).toEqual(before[1])
    })
    it('(c) 別の講師（高橋）を置く → 田中の記録は残る（false）', () => {
      const cell = desks()
      expect(releaseTeacherRestInCellIfSameTeacherPlaced(cell, { teacher: '高橋', teacherAssignmentTeacherId: 't4' }, aliases)).toBe(false)
      expect(cell.map((desk) => desk.teacherRest ?? null)).toEqual(desks().map((desk) => desk.teacherRest ?? null))
    })
    it('(e) 呼び名の対応表: 記録は講師 ID だけ・置いた机は表示名だけでも消える。講師名が空の机（講師なし）を置いたことにはならない', () => {
      const cell: DeskCell[] = [{ id: 'd0', teacher: '高橋', teacherRest: { teacher: '', teacherId: 't1' } }]
      expect(releaseTeacherRestInCellIfSameTeacherPlaced(cell, { teacher: '田中' }, aliases)).toBe(true)
      expect(cell[0].teacherRest).toBeUndefined()
      const empty: DeskCell[] = [{ id: 'd0', teacher: '', teacherRest: { teacher: '田中', teacherId: 't1' } }]
      expect(releaseTeacherRestInCellIfSameTeacherPlaced(empty, { teacher: '', teacherAssignmentTeacherId: 't1' }, aliases)).toBe(false)
      expect(empty[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    })
    it('(f) §9-19: 休みにした机へ本人を置き直す（机 1 つだけを渡す形）は今までどおり消える', () => {
      const desk: DeskCell = { id: 'd', teacher: '田中', manualTeacher: true, teacherAssignmentTeacherId: 't1', teacherRest: { teacher: '田中', teacherId: 't1' } }
      expect(releaseTeacherRestInCellIfSameTeacherPlaced([desk], desk, aliases)).toBe(true)
      expect(desk.teacherRest).toBeUndefined()
    })
  })

  it('(d) 講師メニューの保存（setManualTeacherAssignment にコマを渡す）: 別のコマ（同じ日の別の時限・別の日の同じ時限）の田中の休みは残る', () => {
    // 同じ日の 4限・別の日（木）の 5限にも田中の休みの記録を置く
    const otherKeys = new Set([`${DATE}_4`, '2026-10-08_5'])
    const board = restedWithSubstitute().map((week) => week.map((cell) => (!otherKeys.has(cell.id) ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, teacherRest: { teacher: '田中', teacherId: 't1' } } : desk)) })))
    expect(board.flat().filter((cell) => otherKeys.has(cell.id))).toHaveLength(2)
    const next = cloneWeeks(board)
    const cell = cellOf(next)
    setManualTeacherAssignment(cell, cell.desks[2], '田中', 't1', 'manual', aliases)
    expect(restOf(next)).toEqual([null, null, null])
    expect(next.flat().filter((item) => otherKeys.has(item.id)).map((item) => item.desks[0].teacherRest)).toEqual([{ teacher: '田中', teacherId: 't1' }, { teacher: '田中', teacherId: 't1' }])
  })

  describe('経路ごと（それぞれ修正なしで落ちる）。元に戻す（Undo）は操作の前の週データの写しを戻す＝渡した weeks に記録が残っていることを見る', () => {
    it('講師メニューの保存: 休みの机に高橋を置いた後、田中を佐藤の机（机 2）へ手で置く → 机 0 の記録が消える。高橋・青木はそのまま。前の写しには記録が残る', () => {
      const board = restedWithSubstitute()
      const next = cloneWeeks(board)
      const cell = cellOf(next)
      setManualTeacherAssignment(cell, cell.desks[2], '田中', 't1', resolveManualTeacherAssignmentSource(cell.desks[2]), aliases)
      expect(restOf(next)).toEqual([null, null, null])
      expect(cellOf(next).desks[0]).toMatchObject({ teacher: '高橋', manualTeacher: true, teacherAssignmentTeacherId: 't4' })
      expect(ids(cellOf(next).desks[0])).toEqual(['sA'])
      expect(cellOf(next).desks[2]).toMatchObject({ teacher: '田中', manualTeacher: true })
      expect(cellOf(board).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    })

    it('確認リストの準備（applyChecklistPrepOps＝同じ書き込み）: 田中を机 2 へ置く → 机 0 の記録が消える。渡した weeks は変えない', () => {
      const board = restedWithSubstitute()
      const applied = applyChecklistPrepOps(board, [{ kind: 'manual-teacher', cellId: CELL_ID, deskIndex: 2, teacherName: '田中', teacherId: 't1' }], aliases, { now: 1 })
      expect(applied.skipped).toBe(0)
      expect(restOf(applied.weeks)).toEqual([null, null, null])
      expect(cellOf(applied.weeks).desks[0]).toMatchObject({ teacher: '高橋' })
      expect(cellOf(board).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    })

    it.each([
      ['講師だけ入替（田中 机 2 ↔ 鈴木 机 1）', 2, 1, 'teacher' as const],
      ['生徒ごと席入替（田中 机 2 ↔ 鈴木 机 1）', 2, 1, 'seat' as const],
      ['講師の移動（田中 机 2 → 空き机 3）', 2, 3, 'teacher' as const],
      ['入替でドラッグしたのが鈴木（鈴木 机 1 ↔ 田中 机 2・田中も手で動いた）', 1, 2, 'teacher' as const],
    ])('D&D %s: 食い違った形（記録が高橋の机に残る）から田中を動かす → そのコマの田中の記録が消える。高橋の机はそのまま。渡した weeks は変えない', (_label, sourceDeskIndex, targetDeskIndex, swapMode) => {
      const board = staleBoard()
      const result = computeTeacherMove({ weeks: board, weekIndex: 0, cellId: CELL_ID, sourceDeskIndex, targetDeskIndex, teachers, swapMode })
      if (result.status !== 'moved') throw new Error(result.message)
      expect(restOf(result.nextWeeks)).toEqual([null, null, null, null])
      expect(cellOf(result.nextWeeks).desks[0]).toMatchObject({ teacher: '高橋', manualTeacher: true })
      expect(ids(cellOf(result.nextWeeks).desks[0])).toEqual(['sA'])
      expect(cellOf(board).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    })

    it('D&D 生徒ごと席入替（田中 机 2 ↔ 鈴木 机 1）: 動かしていない代わりの講師の机（机 0）は生徒・メモ・出欠記録が不変で、teacherRest だけ消える', () => {
      const record = { id: 'st_sB', studentId: 'sB', sourceManagedLesson: false, name: '馬場', managedStudentId: 'sB', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '高橋', dateKey: DATE, slotNumber: SLOT, recordedAt: '2026-10-07T00:00:00.000Z', status: 'absent' } as const
      const board = staleBoard().map((week) => week.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, memoSlots: [null, '連絡'] as [string | null, string | null], statusSlots: [null, { ...record }] as DeskCell['statusSlots'] } : desk)) })))
      const before = structuredClone(cellOf(board).desks[0])
      const result = computeTeacherMove({ weeks: board, weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 2, targetDeskIndex: 1, teachers, swapMode: 'seat' })
      if (result.status !== 'moved') throw new Error(result.message)
      const { teacherRest: dropped, ...expected } = before
      expect(dropped).toEqual({ teacher: '田中', teacherId: 't1' })
      expect(cellOf(result.nextWeeks).desks[0]).toEqual(expected)
      expect(ids(cellOf(result.nextWeeks).desks[0])).toEqual(['sA'])
      expect(cellOf(result.nextWeeks).desks[1]).toMatchObject({ teacher: '田中' })
      expect(restOf(result.nextWeeks)).toEqual([null, null, null, null])
      expect(cellOf(board).desks[0]).toEqual(before)
    })

    it('D&D で別の講師（鈴木 机 1 → 空き机 3）だけを動かす → 田中の記録は残る', () => {
      const result = computeTeacherMove({ weeks: staleBoard(), weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 1, targetDeskIndex: 3, teachers })
      if (result.status !== 'moved') throw new Error(result.message)
      expect(cellOf(result.nextWeeks).desks[0].teacherRest).toEqual({ teacher: '田中', teacherId: 't1' })
    })

    it('保留の下の行の講師（田中）を採用: 別の机（代わりの高橋の机）の田中の記録が消える。高橋の机のほかの項目は不変。渡した weeks は変えない', () => {
      const weeks = (): SlotCell[][] => [[{
        id: 'c1', dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
        desks: [
          { id: 'd1', teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', memoSlots: ['連絡', null], teacherRest: { teacher: '田中', teacherId: 't1' } },
          { id: 'd2', teacher: '鈴木', teacherAssignmentTeacherId: 't2' },
          { id: 'd3', teacher: '', teacherRest: { teacher: '佐藤', teacherId: 't3' } },
        ],
      }]]
      const pending: TemplatePendingDeskMap = { 'c1::d2': { lower: { teacher: { teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't1' } }, effectiveStartDate: DATE, createdAt: '2026-10-01T00:00:00.000Z' } }
      const input = weeks()
      const result = computePendingTeacherChoice({ weeks: input, templatePendingDesks: pending, cellId: 'c1', deskId: 'd2', choice: 'manual', teacherAliases: aliases })
      if (result.status !== 'applied') throw new Error(result.message)
      const desksAfter = result.nextWeeks[0][0].desks
      expect(desksAfter[1]).toMatchObject({ teacher: '田中' })
      expect(desksAfter[0].teacherRest).toBeUndefined()
      const { teacherRest: _drop, ...substitute } = weeks()[0][0].desks[0]
      expect(desksAfter[0]).toEqual(substitute)
      expect(desksAfter[2]).toEqual(input[0][0].desks[2])
      expect(input).toEqual(weeks())
    })
  })
})
