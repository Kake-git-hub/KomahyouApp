// ============================================================================
// INV-02 / INV-13 / INV-01 / INV-03 マトリクス: 手置き講師の机に手で置いた生徒が居るときは、講師ごと保留（緑）にする（§H Q41・オーナー決定 B・2026-10-21）
//
// 出典: テスト教室の確認 tp-56 case3 / tp-57(3)（受付 20261020-092527755-56bbf675）。臨時出勤で手置きした講師 B の机（振替の生徒 A つき）に、
// テンプレが別の講師 D＋生徒 C を同じ机番号で置くと、Q21-9 のとおり B が D に置き換わっていた（生徒 A は下段に残るが講師 B は消えた）。
// オーナー決定 B: 手置き講師で、かつ手で置いた生徒が居る机だけ、講師 B も下段に残して「講師の重複」として緑で見せる。
//
// 行（形） × 列（検査）:
//   形: 振替 A／講習 A／手動追加の通常授業 A × 席がぶつかる／空いている、兄弟（手置き講師だけ・同じ講師・テンプレ机に講師なし・講師だけのテンプレ机・QR 講師・削除記録）
//   検査: 上段＝D＋C・下段＝A＋講師 B／件数と文言／講師日程表・PDF に B が出ない（INV-13）／既存を採用で B に戻る／テンプレを採用で D だけ／
//         上段が空いたら B で 1 行／両方の行が生きている間は自動合流しない／保留中の再保存の 4 分岐／再マージ 2 回の不動点／往復の正規化
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, computePendingDeskResolution, computeTemplateDiffApplyForBoard, remergeBoardWeeksWithManagedData, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplateDiffConfirmMessage, buildTemplateDiffSavedMessage, computePendingDeskCollapse, planManualTeacherDeskShifts, resolveManualTeacherOverlap } from './templateDiffApply'
import { buildTemplatePendingDeskKey, cloneTemplatePendingDeskMap, normalizeTemplatePendingDeskMap, collectTemplatePendingLowerTeacherNames, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import { buildTeacherPayload } from '../../utils/scheduleHtml'
import { isShiftedTemplateTeacherDesk } from '../../utils/deskTeacherLabel'
import { buildTeacherSheetViewModel } from '../../utils/scheduleViewData'

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const DATE = '2026-10-07'
const EFFECTIVE = DATE
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-10-01'

const studentRow = (id: string, name: string): StudentRow => ({ id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' })
const teacherRow = (id: string, name: string): TeacherRow => ({ id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] })
const students = [studentRow('sA', '青木'), studentRow('sC', '千葉'), studentRow('sE', '江藤'), studentRow('sX', '山田')]
// B＝倉島（手置き）・D＝田村（テンプレ）・F＝藤井（別の机）
const teachers = [teacherRow('tB', '倉島'), teacherRow('tD', '田村'), teacherRow('tF', '藤井')]
const row = (id: string, teacherId: string, student1Id = '', student2Id = ''): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id, subject2: student2Id ? '数' : '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
})
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: EFFECTIVE, ...extra }) as ClassroomSettings
/** 旧テンプレ: 机 0 は空（講師なし）、机 1 は藤井だけ。 */
const OLD_ROWS = [row('r1', 'tF')]
/** 新テンプレ: 机 0 に田村＋C（＝手置き講師 B の机 0 と重なる）、机 1 は藤井だけ。 */
const NEW_ROWS = [row('r0', 'tD', 'sC'), row('r1', 'tF')]

function buildWeek(rows: RegularLessonRow[], deskCount = 2) {
  return buildManagedScheduleCellsForRange({ range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' }, fallbackStartDate: WEEK_START, fallbackEndDate: WEEK_END, classroomSettings: settings({ templateFreezeBeforeDate: undefined, deskCount }), teachers, students, regularLessons: rows, boardWeeks: [] })
}
const entry = (studentId: string, overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id: `${studentId}_board_${overrides.lessonType ?? 'regular'}`, name: students.find((s) => s.id === studentId)!.name, managedStudentId: studentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides })
const MAKEUP_A = entry('sA', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 5限' })
const SPECIAL_A = entry('sA', { lessonType: 'special', specialSessionId: 'session_x' })
const MANUAL_A = entry('sA', { manualAdded: true })
const MANUAL_TEACHER_B: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentTeacherId'> = { teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 'tB' }

function mutateDesk(week: SlotCell[], index: number, update: (desk: DeskCell) => DeskCell) {
  return week.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === index ? update(desk) : desk)) }))
}
/** 机 0 に手置き講師 B と手で置いた生徒（席 0 か席 1）を置く。 */
function boardWith(student: StudentEntry, seat: 0 | 1 = 0, teacher: Partial<DeskCell> = MANUAL_TEACHER_B, deskCount = 2) {
  const slots: [StudentEntry | null, StudentEntry | null] = seat === 0 ? [student, null] : [null, student]
  return mutateDesk(buildWeek(OLD_ROWS, deskCount), 0, (desk) => ({ ...desk, ...teacher, lesson: { id: `${desk.id}_hand`, studentSlots: slots } }))
}
function save(week: SlotCell[], rows: RegularLessonRow[], pending: TemplatePendingDeskMap = {}, suppressed: string[] = [], deskCount = 2) {
  return computeTemplateDiffApplyForBoard({ weeks: [week], classroomSettings: settings({ deskCount }), teachers, students, regularLessons: rows, effectiveStartDate: EFFECTIVE, suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: pending, createdAt: '2026-10-21T10:00:00.000Z', manualMakeupAdjustments: {}, scheduleCountAdjustments: [] })
}
const cellOf = (weeks: SlotCell[][]) => weeks[0].find((cell) => cell.id === CELL_ID)!
const desk0 = (weeks: SlotCell[][]) => cellOf(weeks).desks[0]
const key0 = (weeks: SlotCell[][]) => buildTemplatePendingDeskKey(CELL_ID, desk0(weeks).id)
const ids = (desk: DeskCell) => (desk.lesson?.studentSlots ?? []).map((student) => student?.managedStudentId ?? null)
function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], deskCount = 2) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings({ deskCount }), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY })
}
function expectFixpoint(weeks: SlotCell[][], pending: TemplatePendingDeskMap, rows: RegularLessonRow[], suppressed: string[], deskCount = 2) {
  const once = remerge(weeks, rows, suppressed, deskCount)
  expect(once.flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
  expect(remerge(once, rows, suppressed, deskCount).flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
  expect(cloneTemplatePendingDeskMap(pending)).toEqual(pending)
}
function teacherSheetPeople(weeks: SlotCell[][], teacherId: string) {
  const payload = buildTeacherPayload({ cells: weeks.flat(), defaultStartDate: WEEK_START, defaultEndDate: WEEK_END, titleLabel: 'Q41', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, teachers, students, regularLessons: NEW_ROWS })
  const vm = buildTeacherSheetViewModel(payload, { startDate: WEEK_START, endDate: WEEK_END, teacherId, todayKey: TODAY_KEY })
  if (!vm) return []
  const cell = vm.rows.find((item) => item.slotNumber === SLOT)?.cells.find((item) => item.dateKey === DATE)
  return (cell?.people ?? []).map((person) => person.name)
}
const emptyLedgers = (): TemplatePendingResolutionLedgers => ({ manualLectureStockCounts: {}, manualLectureStockOrigins: {}, manualMakeupAdjustments: {}, fallbackLectureStockStudents: {}, fallbackMakeupStudents: {}, suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: [], scheduleCountAdjustments: [] })
const CONTEXT = { managedStudentByAnyName: new Map<string, StudentRow>(students.map((student) => [student.name, student])), resolveDisplayName: (name: string) => name, resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name, ledgerOriginDatesByKey: {} as Record<string, string[]> }
function resolve(mode: 'adopt-existing' | 'adopt-template', weeks: SlotCell[][], pending: TemplatePendingDeskMap, lowerIndex?: number) {
  return computePendingDeskResolution({ mode, weeks, cellId: CELL_ID, deskId: desk0(weeks).id, lowerIndex, templatePendingDesks: pending, ledgers: emptyLedgers(), ...CONTEXT })
}

describe('Q41-2 権威関数 resolveManualTeacherOverlap', () => {
  const template = { teacher: '田村', lesson: { id: 't', studentSlots: [entry('sC'), null] as [StudentEntry | null, StudentEntry | null] } }
  it('手置き講師＋テンプレの別の講師＋テンプレに生徒＋手で置いた生徒 → 2 行。由来 manual-replaced・manualTeacher だけでも同じ', () => {
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: template, handPlacedStudents: [MAKEUP_A] })).toBe(true)
    expect(resolveManualTeacherOverlap({ existingTeacher: { ...MANUAL_TEACHER_B, manualTeacher: false, teacherAssignmentSource: 'manual-replaced' }, templateDesk: template, handPlacedStudents: [MAKEUP_A] })).toBe(true)
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '倉島', manualTeacher: true }, templateDesk: template, handPlacedStudents: [MAKEUP_A] })).toBe(true)
  })
  it('しない側: QR 講師・削除記録・同じ講師（ID／登録名）・テンプレに講師なし・講師だけのテンプレ机・手で置いた生徒が居ない', () => {
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 's1' }, templateDesk: template, handPlacedStudents: [MAKEUP_A] })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '', teacherAssignmentSource: 'deleted' }, templateDesk: template, handPlacedStudents: [MAKEUP_A] })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: '倉島' }, handPlacedStudents: [MAKEUP_A] })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: 'tB' }, handPlacedStudents: [MAKEUP_A], resolveAliases: (key) => (key === 'tB' || key === '倉島' ? ['tB', '倉島'] : [key]) })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: '' }, handPlacedStudents: [MAKEUP_A] })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { teacher: '田村' }, handPlacedStudents: [MAKEUP_A] })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: template, handPlacedStudents: [] })).toBe(false)
  })
})

describe('tp-56 case3: 手置き講師 B＋手で置いた生徒 A の机に、テンプレが別の講師 D＋生徒 C を置く', () => {
  for (const [label, student] of [['振替', MAKEUP_A], ['講習', SPECIAL_A], ['手動追加の通常授業', MANUAL_A]] as const) {
    for (const seat of [0, 1] as const) {
      it(`${label} A が席 ${seat}（${seat === 0 ? 'C とぶつかる' : '空いた席'}）: 上段＝D＋C・下段＝A＋講師 B・件数 1・講師日程表と PDF に B は出ない・再マージの不動点`, () => {
        const week = boardWith(student, seat)
        const saved = save(week, NEW_ROWS)
        const desk = desk0(saved.nextWeeks)
        expect(desk.teacher).toBe('田村')
        expect(desk.manualTeacher).toBe(false)
        expect(ids(desk)).toEqual(['sC', null])
        const pending = saved.nextPendingDesks[key0(saved.nextWeeks)]
        expect(pending).toBeDefined()
        // 席が空いていても下段へ（Q34-4 を当てない＝A が黙って D の担当にならない）
        expect(ids({ id: 'x', teacher: '', lesson: pending!.lower.lesson })).toEqual(seat === 0 ? ['sA', null] : [null, 'sA'])
        expect(pending!.lower.teacher).toEqual(MANUAL_TEACHER_B)
        expect(saved.summary.pending).toBe(1)
        expect(saved.summary.seatMerged).toBe(0)
        expect(saved.summary.manualTeacherPending).toBe(1)
        expect(saved.summary.manualTeacherReplaced).toBe(0)
        expect(saved.studentNotes.filter((note) => note.kind === 'teacher-pending').map((note) => note.studentName)).toEqual(['倉島'])
        expect(buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })).toContain('手で置いた講師の机をテンプレの講師と重ねて保留（緑）にする机: 1机')
        expect(buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })).toContain('講師 倉島: 手で置いた講師の机にテンプレの講師（田村）が入るため')
        expect(buildTemplateDiffSavedMessage(EFFECTIVE, saved.summary)).toContain('重ねて保留（緑）にした机: 1机')
        // INV-13: 下段の講師は週データの消費者に出ない（講師日程表: B の日程表にこのコマの生徒は出ず、D の日程表に C が出る）
        expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual([])
        expect(teacherSheetPeople(saved.nextWeeks, 'tD')).toEqual(['千葉'])
        // Q41-5: 講習の講師自動割当・QR 自己修復は下段の B を「そのコマに居る」と数える材料
        expect(collectTemplatePendingLowerTeacherNames(saved.nextPendingDesks, CELL_ID)).toEqual(['倉島'])
        expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, NEW_ROWS, saved.addedSuppressedRegularLessonOccurrences)
        // 往復の正規化で下段の講師が残る（不正な値は捨てる）
        const roundTrip = normalizeTemplatePendingDeskMap(JSON.parse(JSON.stringify(saved.nextPendingDesks)))
        expect(roundTrip).toEqual(saved.nextPendingDesks)
        const broken = normalizeTemplatePendingDeskMap({ [key0(saved.nextWeeks)]: { ...pending, lower: { ...pending!.lower, teacher: { teacher: '' } } } })
        expect(broken[key0(saved.nextWeeks)].lower.teacher).toBeUndefined()
      })
    }
  }

  it('既存を採用: 机の講師が B（manual・由来と講師 ID は保存時の値）に戻り、下段は消える。テンプレ授業 C は取り下げ。Undo 相当＝入力は不変', () => {
    const week = boardWith(MAKEUP_A)
    const saved = save(week, NEW_ROWS)
    const before = JSON.stringify({ weeks: saved.nextWeeks, pending: saved.nextPendingDesks })
    const result = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    const desk = desk0(result.nextWeeks)
    expect(desk.teacher).toBe('倉島')
    expect(desk.manualTeacher).toBe(true)
    expect(desk.teacherAssignmentSource).toBe('manual')
    expect(desk.teacherAssignmentTeacherId).toBe('tB')
    expect(ids(desk)).toEqual(['sA', null])
    expect(result.nextTemplatePendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expect(result.message).toContain('講師を 倉島 に戻す')
    expect(teacherSheetPeople(result.nextWeeks, 'tB')).toEqual(['青木'])
    expect(teacherSheetPeople(result.nextWeeks, 'tD')).toEqual([])
    expect(JSON.stringify({ weeks: saved.nextWeeks, pending: saved.nextPendingDesks })).toBe(before)
    expectFixpoint(result.nextWeeks, result.nextTemplatePendingDesks, NEW_ROWS, result.ledgers.suppressedRegularLessonOccurrences)
  })

  it('既存を採用（席ごと・押していない席にテンプレの生徒 E が残る）: 机の講師は B になり E も B の担当（暫定・Q41-12 (2)）', () => {
    const rows = [row('r0', 'tD', 'sC', 'sE'), row('r1', 'tF')]
    const week = boardWith(MAKEUP_A, 0)
    const saved = save(week, rows)
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sC', 'sE'])
    const result = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks, 0)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    const desk = desk0(result.nextWeeks)
    expect(desk.teacher).toBe('倉島')
    expect(ids(desk)).toEqual(['sA', 'sE'])
  })

  it('既存を採用は、B が同じコマの別の机に居れば止まり、盤面・保留は不変（講師の一意性・INV-01 の兄弟）', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    // 保留中に室長が B を別の机（机 1）へ手で置いた形
    const weeks = [mutateDesk(saved.nextWeeks[0], 1, (desk) => ({ ...desk, teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'manual' }))]
    const result = resolve('adopt-existing', weeks, saved.nextPendingDesks)
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.message).toContain('倉島 が同じコマの別の机に居ます')
  })

  it('テンプレを採用: 下段（A と講師 B）が消えて D＋C の 1 行。講師日程表は D だけ', () => {
    const week = boardWith(MAKEUP_A)
    const saved = save(week, NEW_ROWS)
    const result = resolve('adopt-template', saved.nextWeeks, saved.nextPendingDesks)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(desk0(result.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(result.nextWeeks))).toEqual(['sC', null])
    expect(result.nextTemplatePendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expect(teacherSheetPeople(result.nextWeeks, 'tB')).toEqual([])
  })

  it('上段の C を外して上段が空になると、講師 B で 1 行に戻る（Q41-7）。両方の行に生徒が居る間は Q34-9 の自動合流をしない', () => {
    const week = boardWith(MAKEUP_A, 1)
    const saved = save(week, NEW_ROWS)
    const key = key0(saved.nextWeeks)
    // 両方生きている: 上段 C（席 0）・下段 A（席 1）＝席は空いているが自動合流しない
    const stuck = settleTemplatePendingDesksAfterCommit({ previousWeeks: saved.nextWeeks, previousTemplatePendingDesks: saved.nextPendingDesks, weeks: saved.nextWeeks.map((w) => w.map((c) => ({ ...c }))), templatePendingDesks: saved.nextPendingDesks })
    expect(stuck.collapsedKeys).toEqual([])
    expect(computePendingDeskCollapse(desk0(saved.nextWeeks), saved.nextPendingDesks[key]).ok).toBe(false)
    // 上段を空にする（C を削除）
    const removed = saved.nextWeeks.map((w) => w.map((c) => (c.id !== CELL_ID ? c : { ...c, desks: c.desks.map((d, i) => (i !== 0 ? d : { ...d, lesson: undefined })) })))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: saved.nextWeeks, previousTemplatePendingDesks: saved.nextPendingDesks, weeks: removed, templatePendingDesks: saved.nextPendingDesks })
    expect(settled.collapsedKeys).toEqual([key])
    const desk = desk0(settled.nextWeeks)
    expect(desk.teacher).toBe('倉島')
    expect(desk.manualTeacher).toBe(true)
    expect(ids(desk)).toEqual([null, 'sA'])
    expect(settled.nextTemplatePendingDesks[key]).toBeUndefined()
  })

  it('保留中の再保存（Q41-8）: 同じ講師→テンプレの講師で下段の講師は消える／講師なし→B が机へ／講師だけ→テンプレの講師（暫定・件数に出る）／別の講師＋生徒→下段の講師を維持', () => {
    const week = boardWith(MAKEUP_A)
    const saved = save(week, NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const suppressed = saved.addedSuppressedRegularLessonOccurrences
    const resave = (rows: RegularLessonRow[]) => save(cellOf(saved.nextWeeks) ? saved.nextWeeks[0] : saved.nextWeeks[0], rows, saved.nextPendingDesks, suppressed)
    // 別の講師＋生徒（同じテンプレ）: 維持
    const same = resave(NEW_ROWS)
    expect(same.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
    expect(same.summary.manualTeacherPending).toBe(1)
    expectFixpoint(same.nextWeeks, same.nextPendingDesks, NEW_ROWS, [...suppressed, ...same.addedSuppressedRegularLessonOccurrences])
    // 同じ講師（テンプレを倉島に）: 下段の講師は消え、上段は倉島（テンプレ由来）
    const sameTeacherRows = [row('r0', 'tB', 'sC'), row('r1', 'tF')]
    const sameTeacher = resave(sameTeacherRows)
    expect(sameTeacher.nextPendingDesks[key]?.lower.teacher).toBeUndefined()
    expect(desk0(sameTeacher.nextWeeks).teacher).toBe('倉島')
    expect(sameTeacher.summary.manualTeacherPending).toBe(0)
    // 講師なし（テンプレの行を全部外す＝机 0 のテンプレ机が空）: 上段が空になり下段が机へ戻る → 講師 B
    const noTeacher = resave([])
    expect(noTeacher.nextPendingDesks[key]).toBeUndefined()
    expect(desk0(noTeacher.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(noTeacher.nextWeeks))).toEqual(['sA', null])
    // 講師だけ（田村だけ・生徒なし）: Q41-13（オーナー指示 2026-10-22）＝テンプレの講師を空き机へずらし、下段の生徒は机へ戻って講師は B（手置き）。
    // 机は 2 つ（机 1 は藤井）なので置き先が無く、田村はこのコマに置かない。件数 manualTeacherKept に出る
    const teacherOnly = resave([row('r0', 'tD'), row('r1', 'tF')])
    expect(teacherOnly.summary.manualTeacherKept).toBe(1)
    expect(teacherOnly.summary.manualTeacherReplaced).toBe(0)
    expect(teacherOnly.nextPendingDesks[key]).toBeUndefined()
    expect(desk0(teacherOnly.nextWeeks).teacher).toBe('倉島')
    expect(desk0(teacherOnly.nextWeeks).manualTeacher).toBe(true)
    expect(ids(desk0(teacherOnly.nextWeeks))).toEqual(['sA', null])
    expect(cellOf(teacherOnly.nextWeeks).desks.map((desk) => desk.teacher)).toEqual(['倉島', '藤井'])
    expect(teacherOnly.studentNotes.filter((note) => note.kind === 'teacher-kept').map((note) => [note.keptStudentNames, note.placement])).toEqual([[['青木'], { kind: 'none' }]])
    expectFixpoint(teacherOnly.nextWeeks, teacherOnly.nextPendingDesks, [row('r0', 'tD'), row('r1', 'tF')], [...suppressed, ...teacherOnly.addedSuppressedRegularLessonOccurrences])
  })
})

describe('regression-reviewer 2026-10-21（H-1/H-2/M-1〜M-4）', () => {
  it('H-1: 席が空いている形（A が席 1）で同じテンプレをもう一度保存しても、下段＝A＋講師 B のまま（残した席の生徒を Q34-4 で上段へ寄せない）・件数は pending の内数', () => {
    const saved = save(boardWith(MAKEUP_A, 1), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const again = save(saved.nextWeeks[0], NEW_ROWS, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(again.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
    expect(ids({ id: 'x', teacher: '', lesson: again.nextPendingDesks[key]?.lower.lesson })).toEqual([null, 'sA'])
    expect(desk0(again.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(again.nextWeeks))).toEqual(['sC', null])
    expect(again.summary.manualTeacherPending).toBe(1)
    expect(again.summary.manualTeacherPending).toBeLessThanOrEqual(again.summary.pending)
    const third = save(again.nextWeeks[0], NEW_ROWS, again.nextPendingDesks, [...saved.addedSuppressedRegularLessonOccurrences, ...again.addedSuppressedRegularLessonOccurrences])
    expect(third.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
  })

  it('H-2: 保留中に B を別の机へ手で置いた後、上段が空いても自動では 1 行に戻らない（講師の一意性・理由 teacher-duplicate）', () => {
    const saved = save(boardWith(MAKEUP_A, 1), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const withBElsewhere = [mutateDesk(saved.nextWeeks[0], 1, (desk) => ({ ...desk, teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'manual' }))]
    const removed = withBElsewhere.map((w) => w.map((c) => (c.id !== CELL_ID ? c : { ...c, desks: c.desks.map((d, i) => (i !== 0 ? d : { ...d, lesson: undefined })) })))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: withBElsewhere, previousTemplatePendingDesks: saved.nextPendingDesks, weeks: removed, templatePendingDesks: saved.nextPendingDesks })
    expect(settled.collapsedKeys).toEqual([])
    expect(settled.nextTemplatePendingDesks[key]).toBeDefined()
    expect(desk0(settled.nextWeeks).teacher).toBe('田村')
    const collapse = computePendingDeskCollapse(desk0(removed), saved.nextPendingDesks[key], { teacherElsewhere: () => true })
    expect(collapse.ok).toBe(false)
    if (!collapse.ok) expect(collapse.reason).toBe('teacher-duplicate')
    // 再保存の「講師なし」分岐でも、B が別の机に居れば机へ戻さない（置き換え側に数える）
    const resaved = save(withBElsewhere[0], [], saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(desk0(resaved.nextWeeks).teacher).not.toBe('倉島')
    expect(resaved.summary.manualTeacherReplaced).toBe(1)
  })

  it('M-1: 再保存で手で置いた生徒が全員テンプレに採用される（同じ生徒×科目×種別）と、B は外れて manualTeacherReplaced に数える', () => {
    const saved = save(boardWith(MANUAL_A, 1), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    expect(saved.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
    // 新テンプレ: 田村＋C＋A（A は手動追加の通常授業と同じ中身＝Q34-2 の採用）
    const adoptingRows = [row('r0', 'tD', 'sC', 'sA'), row('r1', 'tF')]
    const again = save(saved.nextWeeks[0], adoptingRows, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(again.nextPendingDesks[key]).toBeUndefined()
    expect(desk0(again.nextWeeks).teacher).toBe('田村')
    expect(again.summary.manualTeacherPending).toBe(0)
    expect(again.summary.manualTeacherReplaced).toBe(1)
    expect(again.studentNotes.filter((note) => note.kind.startsWith('teacher-')).map((note) => note.kind)).toEqual(['teacher-replaced'])
  })

  it('M-2: 下段がメモだけの席で席ごとの「既存を採用」をしても、講師は戻さず「戻しました」とも言わない', () => {
    const saved = save(boardWith(MAKEUP_A, 0), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const withMemo = { ...saved.nextPendingDesks, [key]: { ...saved.nextPendingDesks[key], lower: { ...saved.nextPendingDesks[key].lower, memoSlots: [null, '持ち物'] as [string | null, string | null] } } }
    const result = resolve('adopt-existing', saved.nextWeeks, withMemo, 1)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(desk0(result.nextWeeks).teacher).toBe('田村')
    expect(result.message).not.toContain('戻しました')
  })

  it('M-4: 席ごとの「既存を採用」の後、残る席の保留は講師を持たない', () => {
    // 下段 2 席: A（席 0・振替）と X（席 1・講習）
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, ...MANUAL_TEACHER_B, lesson: { id: `${desk.id}_hand`, studentSlots: [MAKEUP_A, entry('sX', { lessonType: 'special', specialSessionId: 's' })] } }))
    const saved = save(week, NEW_ROWS)
    const key = key0(saved.nextWeeks)
    expect(saved.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
    const result = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks, 0)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(desk0(result.nextWeeks).teacher).toBe('倉島')
    const rest = result.nextTemplatePendingDesks[key]
    if (rest) expect(rest.lower.teacher).toBeUndefined()
  })

  it('M-3: Q41 の机の残した席の生徒は Q21-11 の「1 行で生きる生徒」に数えない（別の机のテンプレの同じ生徒を外さない）', () => {
    // 机 0 = B＋振替 A（席 1）。テンプレ: 机 0 に D＋C、机 1 に F＋通常の A。
    const rows = [row('r0', 'tD', 'sC'), row('r1', 'tF', 'sA')]
    const saved = save(boardWith(MAKEUP_A, 1), rows)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(ids(cellOf(saved.nextWeeks).desks[1])).toEqual(['sA', null])
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
  })

  it('兄弟: テンプレ足場の講師（manual でない）の机に手で置いた生徒が居ても、下段に講師は入らない（従来の保留）', () => {
    const week = mutateDesk(buildWeek([row('r0', 'tF'), row('r1', 'tF')]), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [MAKEUP_A, null] } }))
    expect(desk0([week]).manualTeacher).toBeFalsy()
    const saved = save(week, NEW_ROWS)
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toBeUndefined()
    expect(saved.summary.manualTeacherPending + saved.summary.manualTeacherReplaced).toBe(0)
  })
})

describe('Q41-9 兄弟（従来どおり）', () => {
  it('手置き講師だけ（手で置いた生徒なし）: D に替わる（件数 manualTeacherReplaced=1・理由の行）。2 行にしない', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, ...MANUAL_TEACHER_B }))
    const saved = save(week, NEW_ROWS)
    expect(desk0(saved.nextWeeks).teacher).toBe('田村')
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expect(saved.summary.manualTeacherPending).toBe(0)
    expect(saved.summary.manualTeacherReplaced).toBe(1)
    expect(saved.studentNotes.map((note) => note.kind)).toEqual(['teacher-replaced'])
    // 手で置いた生徒が居ない形だけ「手で置いた生徒が居ないため」
    expect(saved.studentNotes[0].keptStudentNames ?? []).toEqual([])
    expect(buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })).toContain('講師 倉島: 手で置いた講師ですが、手で置いた生徒が居ないためテンプレの講師（田村）に替わります。')
  })
  it('同じ講師（テンプレも倉島）: 2 行になっても下段に講師は入らない（従来の保留）', () => {
    const week = boardWith(MAKEUP_A)
    const saved = save(week, [row('r0', 'tB', 'sC'), row('r1', 'tF')])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toBeUndefined()
    expect(saved.summary.manualTeacherPending).toBe(0)
    expect(saved.summary.manualTeacherReplaced).toBe(0)
  })
  it('テンプレ机が空（行なし）: 手置き講師も手で置いた生徒もそのまま残る（Q21-9「テンプレ机に講師が居ない」）・2 行にしない', () => {
    const week = boardWith(MAKEUP_A)
    const saved = save(week, [])
    expect(desk0(saved.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sA', null])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expect(saved.summary.manualTeacherPending + saved.summary.manualTeacherReplaced).toBe(0)
  })
  // Q41-13（オーナー指示 2026-10-22「手入力講師がいる場合、テンプレで上書きされずに、手入力されたそのコマの空き講師枠に詰めてずらす」）:
  // テスト教室 2026-10-22 の形（11/24(水) 5限 机 13 に講師 A と未消化講習の生徒 B を手で置き、テンプレで同じ机に講師 C だけを登録）。
  // 旧: C が A を上書きし B は C の担当（Q41-12 (1) 暫定）。新: A と B はそのまま 1 行で残り、C は同じコマの空き机へずらして置く。
  const TEACHER_ONLY_ROWS = [row('r0', 'tD'), row('r1', 'tF')]
  for (const [label, student] of [['講習', SPECIAL_A], ['振替', MAKEUP_A], ['手動追加の通常授業', MANUAL_A]] as const) {
    it(`講師だけのテンプレ机 × 手で置いた${label}（机 3 つ）: B と A は 1 行のまま・D は空き机 3 へ・2 行にしない・件数と理由の行・再保存で動かない・再マージの不動点`, () => {
      const saved = save(boardWith(student, 0, MANUAL_TEACHER_B, 3), TEACHER_ONLY_ROWS, {}, [], 3)
      const desk = desk0(saved.nextWeeks)
      expect(desk.teacher).toBe('倉島')
      expect(desk.manualTeacher).toBe(true)
      expect(desk.teacherAssignmentSource).toBe('manual')
      expect(ids(desk)).toEqual(['sA', null])
      expect(saved.nextPendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
      const desks = cellOf(saved.nextWeeks).desks
      expect(desks.map((item) => item.teacher)).toEqual(['倉島', '藤井', '田村'])
      expect(desks[2].manualTeacher).toBeFalsy()
      expect(desks[2].lesson).toBeUndefined()
      // 「詰めた講師は緑色で分かるように。保留ではない」（オーナー指示 2026-10-22）: ずらした先の机に表示用の印・手置き講師の机には付かない・保留は作らない
      expect(desks[2].templateTeacherShift).toEqual({ teacher: '田村', fromDeskIndex: 0 })
      expect(isShiftedTemplateTeacherDesk(desks[2])).toBe(true)
      expect(desks[0].templateTeacherShift).toBeUndefined()
      expect(saved.summary.manualTeacherKept).toBe(1)
      expect(saved.summary.manualTeacherPending).toBe(0)
      expect(saved.summary.manualTeacherReplaced).toBe(0)
      const teacherNotes = saved.studentNotes.filter((note) => note.kind.startsWith('teacher-'))
      expect(teacherNotes.map((note) => [note.kind, note.studentName, note.detail, note.keptStudentNames, note.placement])).toEqual([['teacher-kept', '倉島', '田村', ['青木'], { kind: 'placed', deskIndex: 2 }]])
      const message = buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })
      expect(message).toContain('・10/7 5限 講師 倉島: 手で置いた講師なので、テンプレの講師（田村）に替えず残します。手で置いた 青木 もこの机に残ります。テンプレのこの机は講師だけ（生徒なし）なので、田村 は同じコマの空いている机 3 へずらして置きます。')
      expect(message).toContain('手で置いた講師を残し、テンプレの講師を同じコマの空き机へずらす机: 1机。')
      expect(message).not.toContain('手で置いた生徒が居ないため')
      expect(buildTemplateDiffSavedMessage(EFFECTIVE, saved.summary)).toContain('手で置いた講師を残し、テンプレの講師を同じコマの空き机へずらした机: 1机。')
      // 再マージ 2 回で不変（ずらした先の田村は足場講師として据え置き・元の机番号の管理机は授業ありで消費済み）
      expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, TEACHER_ONLY_ROWS, saved.addedSuppressedRegularLessonOccurrences, 3)
      // 同じテンプレをもう一度保存しても田村は机 3 のまま（前回ずらした先を優先）・盤面は同じ
      const again = save(saved.nextWeeks[0], TEACHER_ONLY_ROWS, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences, 3)
      expect(cellOf(again.nextWeeks).desks).toEqual(desks)
      expect(again.summary.manualTeacherKept).toBe(1)
      expect(again.studentNotes.filter((note) => note.kind === 'teacher-kept').map((note) => note.placement)).toEqual([{ kind: 'placed', deskIndex: 2 }])
      // 手置き講師を外してから（テンプレの机が空く）再保存すると、D は元の机 1 へ戻り、机 3 の D と印は消える（印が残ったまま別の机に付かない）
      const freed = [mutateDesk(saved.nextWeeks[0], 0, (desk) => ({ ...desk, teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentTeacherId: undefined }))]
      const back = save(freed[0], TEACHER_ONLY_ROWS, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences, 3)
      const backDesks = cellOf(back.nextWeeks).desks
      expect(backDesks.map((item) => item.teacher)).toEqual(['田村', '藤井', ''])
      expect(backDesks.every((item) => item.templateTeacherShift === undefined)).toBe(true)
      expect(back.summary.manualTeacherKept).toBe(0)
    })
  }
  it('講師だけのテンプレ机 × 手で置いた振替（机 2 つ・空き机なし）: B と A は残り、D はこのコマに置かない（理由の行に出る）', () => {
    const saved = save(boardWith(MAKEUP_A), TEACHER_ONLY_ROWS)
    expect(desk0(saved.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sA', null])
    expect(cellOf(saved.nextWeeks).desks.map((item) => item.teacher)).toEqual(['倉島', '藤井'])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expect(saved.summary.manualTeacherKept).toBe(1)
    expect(saved.summary.manualTeacherReplaced).toBe(0)
    const message = buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })
    expect(message).toContain('田村 を置く空き机がこのコマに無いため、このコマには置きません。')
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, TEACHER_ONLY_ROWS, saved.addedSuppressedRegularLessonOccurrences)
  })
  it('講師だけのテンプレ机 × 手置き講師だけ（手で置いた生徒なし）: 手入力講師はテンプレで上書きしない＝B は残り D は空き机へ（Q41-9 の 1 行目の講師だけの形は置き換えのまま）', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS, 3), 0, (desk) => ({ ...desk, ...MANUAL_TEACHER_B }))
    const saved = save(week, TEACHER_ONLY_ROWS, {}, [], 3)
    expect(cellOf(saved.nextWeeks).desks.map((item) => [item.teacher, Boolean(item.manualTeacher)])).toEqual([['倉島', true], ['藤井', false], ['田村', false]])
    expect(saved.summary.manualTeacherKept).toBe(1)
    expect(saved.summary.manualTeacherReplaced).toBe(0)
    expect(saved.studentNotes.filter((note) => note.kind === 'teacher-kept').map((note) => note.keptStudentNames ?? [])).toEqual([[]])
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, TEACHER_ONLY_ROWS, saved.addedSuppressedRegularLessonOccurrences, 3)
    // テンプレが別の講師＋生徒（D＋C）を置く形は従来どおり置き換え（Q41-9 1 行目・オーナー決定 B）
    const replaced = save(week, NEW_ROWS, {}, [], 3)
    expect(desk0(replaced.nextWeeks).teacher).toBe('田村')
    expect(replaced.summary.manualTeacherReplaced).toBe(1)
    expect(replaced.summary.manualTeacherKept).toBe(0)
  })
  it('講師だけのテンプレ机で D が同じコマの別の机に手で置かれている: ずらさず「既に居る」（同じ講師を 2 机にしない・INV-01）', () => {
    const week = mutateDesk(boardWith(MAKEUP_A, 0, MANUAL_TEACHER_B, 3), 2, (desk) => ({ ...desk, teacher: '田村', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 'tD' }))
    const saved = save(week, TEACHER_ONLY_ROWS, {}, [], 3)
    expect(cellOf(saved.nextWeeks).desks.map((item) => item.teacher)).toEqual(['倉島', '藤井', '田村'])
    expect(saved.studentNotes.filter((note) => note.kind === 'teacher-kept').map((note) => note.placement)).toEqual([{ kind: 'present', deskIndex: 2 }])
    // 既に居る（手置き）田村には「ずらした講師」の印を付けない
    expect(cellOf(saved.nextWeeks).desks.every((item) => item.templateTeacherShift === undefined)).toBe(true)
    expect(buildTemplateDiffConfirmMessage(EFFECTIVE, saved.summary, { studentNotes: saved.studentNotes })).toContain('田村 は同じコマの机 3 に既に居るので、この机には置きません。')
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, TEACHER_ONLY_ROWS, saved.addedSuppressedRegularLessonOccurrences, 3)
  })
  it('権威関数 planManualTeacherDeskShifts: QR 講師・削除記録・同じ講師・テンプレ机に生徒あり・テンプレ机に講師なし は対象外', () => {
    const template = (teacher: string, withStudent = false): DeskCell => ({ id: 't', teacher, lesson: withStudent ? { id: 'tl', studentSlots: [entry('sC'), null] } : undefined })
    const empty: DeskCell = { id: 'e', teacher: '' }
    const manualDesk: DeskCell = { id: 'd0', ...MANUAL_TEACHER_B, lesson: { id: 'l', studentSlots: [MAKEUP_A, null] } }
    const plan = (desk: DeskCell, templateDesk: DeskCell) => planManualTeacherDeskShifts({ desks: [desk, empty], templateDesks: [templateDesk, empty], cellId: CELL_ID })
    expect(plan(manualDesk, template('田村')).map((shift) => shift.placement)).toEqual([{ kind: 'placed', deskIndex: 1 }])
    expect(plan({ ...manualDesk, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 's1' }, template('田村'))).toEqual([])
    expect(plan({ ...manualDesk, teacher: '', teacherAssignmentSource: 'deleted' }, template('田村'))).toEqual([])
    expect(plan(manualDesk, template('倉島'))).toEqual([])
    expect(plan(manualDesk, template('田村', true))).toEqual([])
    expect(plan(manualDesk, template(''))).toEqual([])
    expect(plan({ ...manualDesk, manualTeacher: false, teacherAssignmentSource: undefined }, template('田村'))).toEqual([])
  })
  it('QR 自動割振りの講師: 例外 1 のまま（講師は残り、下段に講師は入らない）', () => {
    const week = boardWith(MAKEUP_A, 0, { teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'session_x', teacherAssignmentTeacherId: 'tB' })
    const saved = save(week, NEW_ROWS)
    expect(desk0(saved.nextWeeks).teacher).toBe('倉島')
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toBeUndefined()
    expect(saved.summary.manualTeacherPending).toBe(0)
  })
})
