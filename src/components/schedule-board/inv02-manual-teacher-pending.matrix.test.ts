// ============================================================================
// INV-02 / INV-13 / INV-01 / INV-03 マトリクス: 手置き講師の机に手で置いた生徒が居るときは、講師ごと保留（緑）にする（§H Q41・オーナー決定 B・2026-10-21）
//
// 出典: テスト教室の確認 tp-56 case3 / tp-57(3)（受付 20261020-092527755-56bbf675）。臨時出勤で手置きした講師 B の机（振替の生徒 A つき）に、
// テンプレが別の講師 D＋生徒 C を同じ机番号で置くと、Q21-9 のとおり B が D に置き換わっていた（生徒 A は下段に残るが講師 B は消えた）。
// オーナー決定 B: 手置き講師で、かつ手で置いた生徒が居る机だけ、講師 B も下段に残して「講師の重複」として緑で見せる。
// → オーナー決定 2026-11-01「緑 2 段へ広げる」（自動処理一覧 A-6・A-7）: 手で置いた生徒が居ない机・テンプレ机が講師だけの机も講師ごと保留にする（Q41-13 のずらしは廃止）。
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
import { buildManagedScheduleCellsForRange, computePendingDeskResolution, computePendingLowerStudentMove, computeTemplateDiffApplyForBoard, remergeBoardWeeksWithManagedData, type TemplatePendingResolutionLedgers, type TemplatePendingResolutionMode } from './ScheduleBoardScreen'
import { buildTemplateDiffConfirmMessage, buildTemplateDiffSavedMessage, resolveManualTeacherOverlap } from './templateDiffApply'
import { buildTemplatePendingDeskKey, cloneTemplatePendingDeskMap, normalizeTemplatePendingDeskMap, collectTemplatePendingLowerTeacherNames, type TemplatePendingDeskMap } from './templatePendingDesks'
import { buildTemplatePendingTeacherChoiceConfirm, isTemplatePendingTeacherOnly, resolveTemplatePendingDateBlockReason, settleTemplatePendingDesk, TEMPLATE_PENDING_MESSAGES } from './templatePendingResolution'
import { buildTemplatePendingList, describeTemplatePendingTeacherReason } from './templatePendingList'
import { buildTeacherPayload } from '../../utils/scheduleHtml'
import { buildTeacherSheetViewModel } from '../../utils/scheduleViewData'
import { releaseDeskTeacherRest, restDeskTeacher } from './teacherRest'

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
// 機能フラグ templateDiffApply の教室の再マージ（第 2 版の規則〔§2-2〜§2-4〕を保留マップ込みで当てる）。
function remerge(weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[], deskCount = 2, pending: TemplatePendingDeskMap = {}) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings({ deskCount }), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY, templateOriginRules: { pendingDesks: pending } })
}
function expectFixpoint(weeks: SlotCell[][], pending: TemplatePendingDeskMap, rows: RegularLessonRow[], suppressed: string[], deskCount = 2) {
  const once = remerge(weeks, rows, suppressed, deskCount, pending)
  expect(once.flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
  expect(remerge(once, rows, suppressed, deskCount, pending).flat().map((cell) => cell.desks)).toEqual(weeks.flat().map((cell) => cell.desks))
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
function resolve(mode: TemplatePendingResolutionMode, weeks: SlotCell[][], pending: TemplatePendingDeskMap, lowerIndex?: number) {
  return computePendingDeskResolution({ mode, weeks, cellId: CELL_ID, deskId: desk0(weeks).id, lowerIndex, templatePendingDesks: pending, ledgers: emptyLedgers(), ...CONTEXT })
}

describe('Q41-2 権威関数 resolveManualTeacherOverlap（オーナー決定 2026-11-01「緑 2 段へ広げる」で旧 (c)(d) を撤廃）', () => {
  const template = { teacher: '田村', lesson: { id: 't', studentSlots: [entry('sC'), null] as [StudentEntry | null, StudentEntry | null] } }
  it('手置き講師＋テンプレの別の講師 → 2 行。由来 manual-replaced・manualTeacher だけでも同じ', () => {
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: template })).toBe(true)
    expect(resolveManualTeacherOverlap({ existingTeacher: { ...MANUAL_TEACHER_B, manualTeacher: false, teacherAssignmentSource: 'manual-replaced' }, templateDesk: template })).toBe(true)
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '倉島', manualTeacher: true }, templateDesk: template })).toBe(true)
  })
  it('オーナー決定 2026-11-01（戻さない）: 講師だけのテンプレ机（旧 (c)・A-7）も 2 行。手で置いた生徒の有無（旧 (d)・A-6）は判定に入らない', () => {
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { teacher: '田村' } })).toBe(true)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { teacher: '田村', lesson: undefined } })).toBe(true)
  })
  it('しない側（従来どおり）: QR 講師・削除記録・同じ講師（ID／登録名）・テンプレに講師なし', () => {
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 's1' }, templateDesk: template })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: { teacher: '', teacherAssignmentSource: 'deleted' }, templateDesk: template })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: '倉島' } })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: 'tB' }, resolveAliases: (key) => (key === 'tB' || key === '倉島' ? ['tB', '倉島'] : [key]) })).toBe(false)
    expect(resolveManualTeacherOverlap({ existingTeacher: MANUAL_TEACHER_B, templateDesk: { ...template, teacher: '' } })).toBe(false)
  })
})

describe('tp-56 case3: 手置き講師 B＋手で置いた生徒 A の机に、テンプレが別の講師 D＋生徒 C を置く', () => {
  for (const [label, student] of [['振替', MAKEUP_A], ['講習', SPECIAL_A], ['手動追加の通常授業', MANUAL_A]] as const) {
    for (const seat of [0, 1] as const) {
      // 第 2 版（spec-template-conflict-v2 §2-1・§2-3）: 講師欄と席は別々に決まる。講師欄は 2 行（上＝D／下＝B）。席は §2-1: C とぶつかる席 0 の A は下段（2 行）、
      // 空いた席 1 の A は上段に 1 行で残る（旧 Q41「講師ごと保留＝空いた席の生徒も下段へ」は廃止・§6）。
      it(`${label} A が席 ${seat}（${seat === 0 ? 'C とぶつかる' : '空いた席'}）: 講師欄＝上 D／下 B・${seat === 0 ? '席 0 は上＝C／下＝A' : '上段＝C＋A（1 行）'}・件数 1・講師日程表と PDF に B は出ない・再マージの不動点`, () => {
        const week = boardWith(student, seat)
        const saved = save(week, NEW_ROWS)
        const desk = desk0(saved.nextWeeks)
        expect(desk.teacher).toBe('田村')
        expect(desk.manualTeacher).toBe(false)
        expect(ids(desk)).toEqual(seat === 0 ? ['sC', null] : ['sC', 'sA'])
        const pending = saved.nextPendingDesks[key0(saved.nextWeeks)]
        expect(pending).toBeDefined()
        expect(pending!.lower.lesson ? ids({ id: 'x', teacher: '', lesson: pending!.lower.lesson }) : null).toEqual(seat === 0 ? ['sA', null] : null)
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
        expect(teacherSheetPeople(saved.nextWeeks, 'tD')).toEqual(seat === 0 ? ['千葉'] : ['千葉', '青木'])
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

  // ─────────────────────────────────────────────────────────────────────────
  // 講師と生徒を別々に採用（オーナー確定 2026-10-27・確認リスト tp-64「そもそも講師と生徒部分はリンクさせないでそれぞれ採用できないか」）。
  // 旧（v1.5.623〜）: 生徒の「手入力データを採用」で机の講師も B に戻し、B が同じコマの別の机に居ると止まった（確認の後に何も起きない）。
  // 新: 生徒の操作は講師に触れない（机の講師はテンプレの D のまま）。B は講師だけの保留（緑）に残り、講師欄の 2 択でだけ決まる。
  // ─────────────────────────────────────────────────────────────────────────
  it('生徒の「手入力データを採用」は講師に触れない: 机は D＋A・C は取り下げ・下段は講師 B だけで残る（緑）・講師日程表は D・入力は不変・再マージの不動点', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const before = JSON.stringify({ weeks: saved.nextWeeks, pending: saved.nextPendingDesks })
    const result = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    const desk = desk0(result.nextWeeks)
    expect(desk.teacher).toBe('田村')
    expect(desk.manualTeacher).toBe(false)
    expect(ids(desk)).toEqual(['sA', null])
    expect(result.nextTemplatePendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(isTemplatePendingTeacherOnly(result.nextTemplatePendingDesks[key].lower)).toBe(true)
    expect(result.collapsed).toBe(true)
    expect(result.message).toContain('千葉 を取り下げ')
    expect(result.message).toContain(TEMPLATE_PENDING_MESSAGES.teacherChoiceRemains)
    expect(result.message).not.toContain('講師を 倉島 に戻す')
    expect(teacherSheetPeople(result.nextWeeks, 'tD')).toEqual(['青木'])
    expect(teacherSheetPeople(result.nextWeeks, 'tB')).toEqual([])
    expect(JSON.stringify({ weeks: saved.nextWeeks, pending: saved.nextPendingDesks })).toBe(before)
    // 講師だけの保留は自動では解けない（Q28 の settle は何もしない）・Q41-5 の「そのコマに居る講師」に数える・一覧に講師の理由で出る
    expect(settleTemplatePendingDesk({ weeks: result.nextWeeks, templatePendingDesks: result.nextTemplatePendingDesks, key }).status).toBe('unchanged')
    expect(collectTemplatePendingLowerTeacherNames(result.nextTemplatePendingDesks, CELL_ID)).toEqual(['倉島'])
    // Q31: 講師だけの保留も保留の机として数え、その日の休日設定・生徒を空にする・丸ごと振替を止める（regression-reviewer 2026-10-27 中-2・現行仕様を固定）
    expect(resolveTemplatePendingDateBlockReason(result.nextTemplatePendingDesks, result.nextWeeks, cellOf(result.nextWeeks).dateKey, '休日設定')).toContain('保留の机が 1 机')
    const listRow = buildTemplatePendingList(result.nextTemplatePendingDesks, result.nextWeeks)
    expect(listRow).toHaveLength(1)
    expect(listRow[0].lowerLabels).toEqual(['講師 倉島'])
    expect(listRow[0].upperLabels).toEqual(['青木（数）', '講師 田村'])
    expect(listRow[0].reason).toBe(describeTemplatePendingTeacherReason('田村', '倉島'))
    expect(normalizeTemplatePendingDeskMap(JSON.parse(JSON.stringify(result.nextTemplatePendingDesks)))).toEqual(result.nextTemplatePendingDesks)
    expectFixpoint(result.nextWeeks, result.nextTemplatePendingDesks, NEW_ROWS, result.ledgers.suppressedRegularLessonOccurrences)

    // 講師欄「手入力の講師を採用」: 机の講師が B（manual・由来と講師 ID は保存時の値）になり、保留は消えて 1 行。A は B の担当
    const manual = resolve('adopt-existing-teacher', result.nextWeeks, result.nextTemplatePendingDesks)
    expect(manual.status).toBe('applied')
    if (manual.status !== 'applied') return
    const manualDesk = desk0(manual.nextWeeks)
    expect([manualDesk.teacher, manualDesk.manualTeacher, manualDesk.teacherAssignmentSource, manualDesk.teacherAssignmentTeacherId]).toEqual(['倉島', true, 'manual', 'tB'])
    expect(ids(manualDesk)).toEqual(['sA', null])
    expect(manual.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(manual.collapsed).toBe(true)
    expect(manual.message).toBe('手入力の講師 倉島 を採用しました（テンプレの講師 田村 は外す）。1 行に戻しました。')
    expect(teacherSheetPeople(manual.nextWeeks, 'tB')).toEqual(['青木'])
    expect(teacherSheetPeople(manual.nextWeeks, 'tD')).toEqual([])
    expectFixpoint(manual.nextWeeks, manual.nextTemplatePendingDesks, NEW_ROWS, result.ledgers.suppressedRegularLessonOccurrences)

    // 講師欄「テンプレの講師を採用」: 机は D のまま、B は外れて 1 行
    const template = resolve('adopt-template-teacher', result.nextWeeks, result.nextTemplatePendingDesks)
    expect(template.status).toBe('applied')
    if (template.status !== 'applied') return
    expect(desk0(template.nextWeeks)).toEqual(desk0(result.nextWeeks))
    expect(template.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(template.message).toBe('テンプレの講師 田村 を採用しました（手で置いた講師 倉島 は外す）。1 行に戻しました。')
    expectFixpoint(template.nextWeeks, template.nextTemplatePendingDesks, NEW_ROWS, result.ledgers.suppressedRegularLessonOccurrences)
  })

  it('講師を先に選んでも生徒の保留は残る（講師と生徒は独立）: 手入力の講師を採用 → 机は B＋C・下段は A だけ（講師なし）→ 生徒の採用で B＋A の 1 行', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    expect(buildTemplatePendingTeacherChoiceConfirm(desk0(saved.nextWeeks), saved.nextPendingDesks[key], 'manual')).toBe('手入力の講師 倉島 を採用します。テンプレの講師 田村 はこの机から外れます。この机の生徒は 倉島 の担当になります。よろしいですか？')
    expect(buildTemplatePendingTeacherChoiceConfirm(desk0(saved.nextWeeks), saved.nextPendingDesks[key], 'template')).toBe('テンプレの講師 田村 を採用します。手で置いた講師 倉島 はこの机から外れます。よろしいですか？')
    const teacherFirst = resolve('adopt-existing-teacher', saved.nextWeeks, saved.nextPendingDesks)
    expect(teacherFirst.status).toBe('applied')
    if (teacherFirst.status !== 'applied') return
    expect(desk0(teacherFirst.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(teacherFirst.nextWeeks))).toEqual(['sC', null])
    expect(teacherFirst.collapsed).toBe(false)
    expect(teacherFirst.message).toContain('生徒の保留は残っています。')
    const rest = teacherFirst.nextTemplatePendingDesks[key]
    expect(rest?.lower.teacher).toBeUndefined()
    expect(ids({ id: 'x', teacher: '', lesson: rest?.lower.lesson })).toEqual(['sA', null])
    const students = resolve('adopt-existing', teacherFirst.nextWeeks, teacherFirst.nextTemplatePendingDesks, 0)
    expect(students.status).toBe('applied')
    if (students.status !== 'applied') return
    expect(desk0(students.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(students.nextWeeks))).toEqual(['sA', null])
    expect(students.nextTemplatePendingDesks[key]).toBeUndefined()
    expectFixpoint(students.nextWeeks, students.nextTemplatePendingDesks, NEW_ROWS, students.ledgers.suppressedRegularLessonOccurrences)
  })

  it('既存を採用（席ごと・押していない席にテンプレの生徒 E が残る）: 机は D のまま A・E。手入力の講師を採用すると E も B の担当（Q41-12 (2) を講師の選択へ）', () => {
    const rows = [row('r0', 'tD', 'sC', 'sE'), row('r1', 'tF')]
    const saved = save(boardWith(MAKEUP_A, 0), rows)
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sC', 'sE'])
    const result = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks, 0)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(desk0(result.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(result.nextWeeks))).toEqual(['sA', 'sE'])
    const manual = resolve('adopt-existing-teacher', result.nextWeeks, result.nextTemplatePendingDesks)
    expect(manual.status).toBe('applied')
    if (manual.status !== 'applied') return
    expect(desk0(manual.nextWeeks).teacher).toBe('倉島')
    expect(ids(desk0(manual.nextWeeks))).toEqual(['sA', 'sE'])
    expect(teacherSheetPeople(manual.nextWeeks, 'tB')).toEqual(['青木', '江藤'])
  })

  // 削除（第 2 版）: 「テンプレが B を別の机に置く」形は §2-3・§9-1（手入力が勝つ＝別の机に B を置かない）で作らない。下の「第 2 版 §2-3」の §9-1 の行で固定。

  it('保留中に B を別の机へ手で置いた形: 生徒の採用は講師に触れず通る・手入力の講師を採用は止まる（INV-01 の兄弟）', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const weeks = [mutateDesk(saved.nextWeeks[0], 1, (desk) => ({ ...desk, teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'manual' }))]
    const result = resolve('adopt-existing', weeks, saved.nextPendingDesks)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(cellOf(result.nextWeeks).desks.map((item) => item.teacher)).toEqual(['田村', '倉島'])
    expect(ids(desk0(result.nextWeeks))).toEqual(['sA', null])
    const blocked = resolve('adopt-existing-teacher', result.nextWeeks, result.nextTemplatePendingDesks)
    expect(blocked.status).toBe('blocked')
    if (blocked.status === 'blocked') expect(blocked.message).toContain('講師 倉島 が同じコマの机 2 に居ます')
  })

  it('生徒の「テンプレを採用」: 下段の A は消え D＋C の机・講師 B は講師だけの保留に残る → テンプレの講師を採用で 1 行', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const result = resolve('adopt-template', saved.nextWeeks, saved.nextPendingDesks, 0)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(desk0(result.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(result.nextWeeks))).toEqual(['sC', null])
    expect(result.nextTemplatePendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(result.message).toContain(TEMPLATE_PENDING_MESSAGES.teacherChoiceRemains)
    expect(teacherSheetPeople(result.nextWeeks, 'tB')).toEqual([])
    // 机ごと（lowerIndex 無し）でも同じ
    const whole = resolve('adopt-template', saved.nextWeeks, saved.nextPendingDesks)
    expect(whole.status === 'applied' && whole.nextTemplatePendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    const template = resolve('adopt-template-teacher', result.nextWeeks, result.nextTemplatePendingDesks)
    expect(template.status === 'applied' && template.nextTemplatePendingDesks[key]).toBeUndefined()
  })

  it('下段の削除・移動も講師に触れない: 最後の生徒を削除／別の机へ移動すると講師だけの保留が残る', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const deleted = computePendingDeskResolution({ mode: 'delete-lower-student', weeks: saved.nextWeeks, cellId: CELL_ID, deskId: desk0(saved.nextWeeks).id, lowerIndex: 0, templatePendingDesks: saved.nextPendingDesks, ledgers: emptyLedgers(), ...CONTEXT })
    expect(deleted.status).toBe('applied')
    if (deleted.status !== 'applied') return
    expect(deleted.nextTemplatePendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(deleted.collapsed).toBe(true)
    expect(deleted.message).toContain(TEMPLATE_PENDING_MESSAGES.teacherChoiceRemains)
    expect(desk0(deleted.nextWeeks)).toEqual(desk0(saved.nextWeeks))
    const moved = computePendingLowerStudentMove({
      weeks: saved.nextWeeks, weekIndex: 0, cells: saved.nextWeeks[0], templatePendingDesks: saved.nextPendingDesks,
      source: { cellId: CELL_ID, deskId: desk0(saved.nextWeeks).id, lowerIndex: 0 }, cellId: CELL_ID, deskIndex: 1, studentIndex: 1,
      suppressedRegularLessonOccurrences: [], managedStudentByAnyName: CONTEXT.managedStudentByAnyName, resolveBoardStudentDisplayName: (name: string) => name,
    })
    expect(moved.status).toBe('moved')
    if (moved.status !== 'moved') return
    expect(moved.nextTemplatePendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(moved.message).toContain(TEMPLATE_PENDING_MESSAGES.teacherChoiceRemains)
    expect(cellOf(moved.nextWeeks).desks[1].teacher).toBe('藤井')
  })

  // 削除（第 2 版）: 空いた席の A は §2-1 で上段に 1 行で残る（下段へ入らない）ので、この形は保存で作らない。

  it('保留中の再保存（Q41-8・2026-11-01 で 3 分岐）: 同じ講師→テンプレの講師で下段の講師は消える／講師なし→B が机へ／別の講師（生徒あり・講師だけ）→下段の講師を維持', () => {
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
    // 講師だけ（田村だけ・生徒なし）: オーナー決定 2026-11-01（旧 Q41-13 のずらしは廃止）＝講師の衝突は保留のまま。
    // ★2026-11-05 改定（決定記録 64・tp-70）: 上段はテンプレの講師 D＋手で置いた A（上の行に残す）、下段は講師 B だけ。件数は manualTeacherPending・理由の行に「テンプレのこの机は講師だけ」。
    const teacherOnlyRows = [row('r0', 'tD'), row('r1', 'tF')]
    const teacherOnly = resave(teacherOnlyRows)
    expect(teacherOnly.summary.manualTeacherPending).toBe(1)
    expect(teacherOnly.summary.manualTeacherReplaced).toBe(0)
    expect(teacherOnly.nextPendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect([desk0(teacherOnly.nextWeeks).teacher, desk0(teacherOnly.nextWeeks).manualTeacher]).toEqual(['田村', false])
    expect(ids(desk0(teacherOnly.nextWeeks))).toEqual(['sA', null])
    // 再保存で形が変わらない（INV-03）
    const teacherOnlyAgain = save(teacherOnly.nextWeeks[0], teacherOnlyRows, teacherOnly.nextPendingDesks, [...suppressed, ...teacherOnly.addedSuppressedRegularLessonOccurrences])
    expect(cellOf(teacherOnlyAgain.nextWeeks).desks).toEqual(cellOf(teacherOnly.nextWeeks).desks)
    expect(teacherOnlyAgain.nextPendingDesks).toEqual(teacherOnly.nextPendingDesks)
    expect(cellOf(teacherOnly.nextWeeks).desks.map((desk) => desk.teacher)).toEqual(['田村', '藤井'])
    expect(teacherOnly.studentNotes.filter((note) => note.kind === 'teacher-pending').map((note) => [note.keptStudentNames, note.templateTeacherOnly])).toEqual([[['青木'], true]])
    expectFixpoint(teacherOnly.nextWeeks, teacherOnly.nextPendingDesks, teacherOnlyRows, [...suppressed, ...teacherOnly.addedSuppressedRegularLessonOccurrences])
  })
})

describe('regression-reviewer 2026-10-21（H-1/H-2/M-1〜M-4）', () => {
  // 削除（第 2 版）: 旧 Q41 の「空いた席の生徒も下段へ」は廃止（§2-1・§6）。

  // 2026-10-27 改定（tp-64・講師と生徒を別々に採用）: 上段が空いて下段の生徒が上がっても講師は戻さないので、B が別の机に居ても止める理由が無い。
  // 生徒は机へ上がり（講師は D のまま）、B は講師だけの保留に残る。B を机の講師にする「手入力の講師を採用」は一意性検査で止まる（同じ講師 2 机を作らない＝INV-01）。
  // 削除（第 2 版）: 前提の「空いた席の A が下段」を保存で作らない（§2-1）。

  it('M-1（2026-11-01 改定）: 再保存で手で置いた生徒が全員テンプレに採用される（同じ生徒×科目×種別）と、生徒は 1 行に戻るが講師の衝突は講師だけの保留で残る（旧「B は外れて manualTeacherReplaced」は廃止）', () => {
    const saved = save(boardWith(MANUAL_A, 1), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    expect(saved.nextPendingDesks[key]?.lower.teacher).toEqual(MANUAL_TEACHER_B)
    // 新テンプレ: 田村＋C＋A（A は手動追加の通常授業と同じ中身＝Q34-2 の採用）
    const adoptingRows = [row('r0', 'tD', 'sC', 'sA'), row('r1', 'tF')]
    const again = save(saved.nextWeeks[0], adoptingRows, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(again.nextPendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(desk0(again.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(again.nextWeeks))).toEqual(['sC', 'sA'])
    expect(again.summary.manualTeacherPending).toBe(1)
    expect(again.summary.manualTeacherReplaced).toBe(0)
    expect(again.studentNotes.filter((note) => note.kind.startsWith('teacher-')).map((note) => note.kind)).toEqual(['teacher-pending'])
    expectFixpoint(again.nextWeeks, again.nextPendingDesks, adoptingRows, [...saved.addedSuppressedRegularLessonOccurrences, ...again.addedSuppressedRegularLessonOccurrences])
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

  // 2026-10-27 改定（tp-64）: 講師は席の操作で外れないので、残る席の保留が講師 B を持ち続ける（講師欄で選ぶまで）。机の講師は D のまま。
  // 削除（第 2 版）: 前提の「空いた席の A が下段」を保存で作らない（§2-1）。

  // 削除（第 2 版）: Q21-11 は §2-2（手入力が勝つ）に置き換えた（INV-12 マトリクスの第 2 版の行で固定）。

  it('兄弟: テンプレ足場の講師（manual でない）の机に手で置いた生徒が居ても、下段に講師は入らない（従来の保留）', () => {
    const week = mutateDesk(buildWeek([row('r0', 'tF'), row('r1', 'tF')]), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [MAKEUP_A, null] } }))
    expect(desk0([week]).manualTeacher).toBeFalsy()
    const saved = save(week, NEW_ROWS)
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toBeUndefined()
    expect(saved.summary.manualTeacherPending + saved.summary.manualTeacherReplaced).toBe(0)
  })
})

// 削除（第 2 版）: 旧 Q41-9（講師ごと保留）・A-6・A-7（決定記録 64）・Q41-13（ずらし）・Q21-9 例外 1（QR）は §2-3 の表に置き換えた。下の「第 2 版 §2-3」で固定。

// tp-64（オーナー確定 2026-10-27・講師と生徒を別々に採用）の兄弟: 講師だけが残った保留の再保存（Q41-8）。オーナー決定 2026-11-01 以降、
// 講師の衝突は生徒の採用では解けず、講師の選択（テンプレの講師を採用／手入力の講師を採用）か、テンプレ側の講師が変わる（同じ講師・講師なし）ときだけ決着する。
describe('tp-64 兄弟: 講師だけの保留の再保存（Q41-8）', () => {
  // 2026-11-05（決定記録 64）: テンプレ机が講師だけになった再保存では、手で置いた A は上の行へ戻し、講師の衝突だけ保留に残す（作成時と同じ形＝INV-03）。
  it('生徒を採用した後（机に手で置いた A・C は取り下げ済み）の再保存: テンプレ机は講師だけになるが講師の衝突は保留のまま（上段 D＋A／下段 講師 B だけ・2026-11-05 改定）', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const adopted = resolve('adopt-existing', saved.nextWeeks, saved.nextPendingDesks)
    if (adopted.status !== 'applied') throw new Error('adopt failed')
    const suppressed = [...saved.addedSuppressedRegularLessonOccurrences, ...adopted.ledgers.suppressedRegularLessonOccurrences]
    const again = save(adopted.nextWeeks[0], NEW_ROWS, adopted.nextTemplatePendingDesks, suppressed)
    expect(again.nextPendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect([desk0(again.nextWeeks).teacher, desk0(again.nextWeeks).manualTeacher]).toEqual(['田村', false])
    expect(ids(desk0(again.nextWeeks))).toEqual(['sA', null])
    expect(again.summary.manualTeacherPending).toBe(1)
    expect(again.summary.manualTeacherReplaced).toBe(0)
    expectFixpoint(again.nextWeeks, again.nextPendingDesks, NEW_ROWS, [...suppressed, ...again.addedSuppressedRegularLessonOccurrences])
  })
  it('生徒をテンプレで採用した後（机は D＋C・手で置いた生徒なし）の再保存: 講師だけの保留のまま（旧「D に揃い B は外れる」は 2026-11-01 で廃止）。テンプレ机が空→B が机へ／同じ講師→解消 は従来どおり', () => {
    const saved = save(boardWith(MAKEUP_A), NEW_ROWS)
    const key = key0(saved.nextWeeks)
    const adopted = resolve('adopt-template', saved.nextWeeks, saved.nextPendingDesks, 0)
    if (adopted.status !== 'applied') throw new Error('adopt failed')
    const again = save(adopted.nextWeeks[0], NEW_ROWS, adopted.nextTemplatePendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(again.nextPendingDesks[key]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(desk0(again.nextWeeks).teacher).toBe('田村')
    expect(ids(desk0(again.nextWeeks))).toEqual(['sC', null])
    expect(again.summary.manualTeacherPending).toBe(1)
    expect(again.summary.manualTeacherReplaced).toBe(0)
    // テンプレ机が空 → B が机へ（Q21-9）／テンプレも同じ講師 → 講師の重複は解消（保留は消える）
    const empty = save(adopted.nextWeeks[0], [], adopted.nextTemplatePendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(empty.nextPendingDesks[key]).toBeUndefined()
    expect([desk0(empty.nextWeeks).teacher, desk0(empty.nextWeeks).manualTeacher]).toEqual(['倉島', true])
    const same = save(adopted.nextWeeks[0], [row('r0', 'tB', 'sC'), row('r1', 'tF')], adopted.nextTemplatePendingDesks, saved.addedSuppressedRegularLessonOccurrences)
    expect(same.nextPendingDesks[key]).toBeUndefined()
    expect(desk0(same.nextWeeks).teacher).toBe('倉島')
  })
})

// 決定記録 66（オーナー決定 2026-11-05・確認リスト tp-59）: 手置き講師 X（倉島）の机 1 があるコマで、テンプレが同じコマの別の机 0 に X を生徒つきで置く。
// 旧（Q21-9「テンプレ机に講師なし→手置き講師を残す」）: 机 0 と机 1 の両方に倉島が 1 行で出て緑にならなかった（講師日程表に 2 コマ＝INV-01 の懸念）。
// 新: 机 0 は倉島で確定。机 1 は手で置いた生徒を上の行に残し、講師欄だけ「上＝講師なし／下＝倉島」の保留（緑）。
// 削除（第 2 版）: 決定記録 66（講師の 2 行）は §9-1 で取り消し（手入力が勝つ）。下の「第 2 版 §2-3」の §9-1 の行で固定。

// ============================================================================
// 第 2 版（docs/spec-template-conflict-v2.md §2-3 講師の一意・§2-1 席・§9-1・§9-13・2026-11-05 オーナー承認・§8 の読み替え）
//   講師欄と席は別々に決まる。手置き講師（QR で自動で入った講師を含む）の机にテンプレの別の講師 → **講師欄だけ 2 行**（上＝テンプレ／下＝手入力）。
//   席は §2-1（テンプレの生徒とぶつかる席だけ 2 行・空いた席の手入力は上段に 1 行）。手置き講師 X の机があるコマでテンプレが別の机に X を置く → その机に X を置かない
//   （生徒は置く・講師欄は空・確認の画面に理由）。同じ講師は上段のどの机にも 2 つ出ない（INV-01）。
//   旧 Q41（講師ごと保留）・Q41-13（ずらし）・Q21-9 例外 1（QR の講師はそのまま／寄せて外す）・決定記録 64・66 はこの表に置き換えた（§6）。
// ============================================================================
describe('第 2 版 §2-3: 講師欄は講師だけで決まる（手置き講師が勝つ・同じ講師は 1 コマに 1 机）', () => {
  const ROWS_D_C = [row('r0', 'tD', 'sC'), row('r1', 'tF')]
  const resaveSame = (saved: ReturnType<typeof save>, rows: RegularLessonRow[]) => save(saved.nextWeeks[0], rows, saved.nextPendingDesks, saved.addedSuppressedRegularLessonOccurrences)

  it('手置き講師 B だけ（手で置いた生徒なし）の机にテンプレが D＋C → 上段＝D＋C・講師欄の下段＝B（講師だけの保留・黙って D に替えない）・理由の行・再保存と再マージで同じ', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, ...MANUAL_TEACHER_B }))
    const saved = save(week, ROWS_D_C)
    expect([desk0(saved.nextWeeks).teacher, desk0(saved.nextWeeks).manualTeacher]).toEqual(['田村', false])
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sC', null])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
    expect(saved.summary.manualTeacherPending).toBe(1)
    expect(saved.studentNotes.filter((note) => note.kind === 'teacher-pending').map((note) => [note.studentName, note.detail])).toEqual([['倉島', '田村']])
    expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual([])
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, ROWS_D_C, saved.addedSuppressedRegularLessonOccurrences)
    const again = resaveSame(saved, ROWS_D_C)
    expect(cellOf(again.nextWeeks).desks).toEqual(cellOf(saved.nextWeeks).desks)
    expect(again.nextPendingDesks).toEqual(saved.nextPendingDesks)
  })

  for (const [label, student] of [['講習', SPECIAL_A], ['振替', MAKEUP_A], ['手動追加の通常授業', MANUAL_A]] as const) {
    it(`テンプレ机が講師だけ（D・生徒なし）× 手置き講師 B＋手で置いた${label} A → A は席に 1 行で残り（決定 6）、講師欄だけ 2 行（上＝D／下＝B）。再保存・再マージで同じ`, () => {
      const rows = [row('r0', 'tD'), row('r1', 'tF')]
      const saved = save(boardWith(student, 0), rows)
      expect([desk0(saved.nextWeeks).teacher, desk0(saved.nextWeeks).manualTeacher]).toEqual(['田村', false])
      expect(ids(desk0(saved.nextWeeks))).toEqual(['sA', null])
      expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower).toEqual({ teacher: MANUAL_TEACHER_B })
      expect(saved.studentNotes.filter((note) => note.kind === 'teacher-pending').map((note) => [note.keptStudentNames, note.templateTeacherOnly])).toEqual([[['青木'], true]])
      expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
      const again = resaveSame(saved, rows)
      expect(cellOf(again.nextWeeks).desks).toEqual(cellOf(saved.nextWeeks).desks)
      expect(again.nextPendingDesks).toEqual(saved.nextPendingDesks)
      // 講師欄の 2 択で決着（手入力の講師を採用 → B＋A の 1 行）
      const manual = resolve('adopt-existing-teacher', saved.nextWeeks, saved.nextPendingDesks)
      expect(manual.status).toBe('applied')
      if (manual.status !== 'applied') return
      expect([desk0(manual.nextWeeks).teacher, desk0(manual.nextWeeks).manualTeacher]).toEqual(['倉島', true])
      expect(manual.nextTemplatePendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    })
  }

  it('§9-13: QR 提出で自動で入った講師も手入力 → テンプレの別の講師（D＋C）と講師欄 2 行（上＝D／下＝QR の B）。下段の QR 講師は講師日程表に出ない（INV-13）', () => {
    const qrB: Partial<DeskCell> = { teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 'tB' }
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, ...qrB }))
    const saved = save(week, ROWS_D_C)
    expect(desk0(saved.nextWeeks).teacher).toBe('田村')
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toMatchObject({ teacher: '倉島', teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1' })
    expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual([])
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, ROWS_D_C, saved.addedSuppressedRegularLessonOccurrences)
  })

  it('同じ講師（テンプレも倉島）: 講師欄は 2 行にしない（手置きのまま）', () => {
    const rows = [row('r0', 'tB', 'sC'), row('r1', 'tF')]
    const saved = save(mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, ...MANUAL_TEACHER_B })), rows)
    expect([desk0(saved.nextWeeks).teacher, desk0(saved.nextWeeks).manualTeacher]).toEqual(['倉島', true])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]).toBeUndefined()
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
  })

  // §9-1（決定記録 66 の「講師の 2 行」は取り消し）: 手置き講師 X（倉島）の机 1（手で置いた A）があるコマで、テンプレが机 0 に倉島＋C を置く → 手入力が勝つ。
  for (const withStudent of [true, false]) {
    it(`§9-1: 手置き講師 倉島の机 1（${withStudent ? '手で置いた A つき' : '生徒なし'}）× テンプレが机 0 に倉島＋C → 机 0 に倉島を置かない（C は置く・講師欄は空）。理由の行・講師日程表に倉島は${withStudent ? ' A だけ' : '出ない'}・再保存・再マージで同じ`, () => {
      const rows = [row('r0', 'tB', 'sC')]
      const week = mutateDesk(buildWeek(OLD_ROWS), 1, (desk) => ({ ...desk, ...MANUAL_TEACHER_B, lesson: withStudent ? { id: 'hand', studentSlots: [MAKEUP_A, null] as [StudentEntry | null, StudentEntry | null] } : undefined }))
      const saved = save(week, rows)
      const cell = cellOf(saved.nextWeeks)
      expect([cell.desks[0].teacher, ids(cell.desks[0])]).toEqual(['', ['sC', null]])
      expect([cell.desks[1].teacher, cell.desks[1].manualTeacher, ids(cell.desks[1])]).toEqual(['倉島', true, withStudent ? ['sA', null] : []])
      expect(saved.nextPendingDesks).toEqual({})
      expect(cell.desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(1)
      expect(saved.studentNotes.filter((note) => note.kind === 'teacher-elsewhere').map((note) => [note.studentName, note.detail])).toEqual([['倉島', '2']])
      expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual(withStudent ? ['青木'] : [])
      expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
      const again = resaveSame(saved, rows)
      expect(cellOf(again.nextWeeks).desks).toEqual(cell.desks)
    })
  }

  it('§9-1 の兄弟: テンプレの別の机が倉島だけ（生徒なし）でも同じ＝その机に倉島を置かない。机 1 は倉島＋A の 1 行のまま', () => {
    const rows = [row('r0', 'tB')]
    const week = mutateDesk(buildWeek(OLD_ROWS), 1, (desk) => ({ ...desk, ...MANUAL_TEACHER_B, lesson: { id: 'hand', studentSlots: [MAKEUP_A, null] as [StudentEntry | null, StudentEntry | null] } }))
    const saved = save(week, rows)
    const cell = cellOf(saved.nextWeeks)
    expect(cell.desks.map((desk) => desk.teacher)).toEqual(['', '倉島'])
    expect(saved.nextPendingDesks).toEqual({})
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
  })

  // §9-15（オーナー決定 2026-11-05・受け入れ条件 2-12）: 手置き講師 倉島の机 0 にテンプレが別の講師 田村を置き、さらに別の机 1 にテンプレの倉島が来る形は、
  // 机 0 は倉島のまま（田村を置かず講師欄は 1 行）・机 1 にも倉島を置かない。理由の行は 2 つ。倉島は講師日程表に 1 回だけ。
  it('§9-15: 手置き 倉島の机 0 × テンプレが机 0 に田村＋C・机 1 に倉島＋X → 机 0 は倉島のまま（講師欄 1 行）・机 1 は講師なし。理由の行 2 つ・倉島は日程表に 1 回', () => {
    const rows = [row('r0', 'tD', 'sC'), row('r1', 'tB', 'sX')]
    const saved = save(boardWith(MAKEUP_A, 0), rows)
    const cell = cellOf(saved.nextWeeks)
    expect([cell.desks[0].teacher, cell.desks[0].manualTeacher]).toEqual(['倉島', true])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toBeUndefined()
    // 席は §2-1: 生徒 1 の席は上＝テンプレの C／下＝手入力の A
    expect(ids(cell.desks[0])).toEqual(['sC', null])
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect([cell.desks[1].teacher, ids(cell.desks[1])]).toEqual(['', ['sX', null]])
    expect(saved.studentNotes.filter((note) => note.kind === 'teacher-kept' || note.kind === 'teacher-elsewhere').map((note) => [note.kind, note.studentName])).toEqual([['teacher-kept', '田村'], ['teacher-elsewhere', '倉島']])
    expect(cell.desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(1)
    expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual(['千葉'])
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
    const again = resaveSame(saved, rows)
    expect(cellOf(again.nextWeeks).desks).toEqual(cell.desks)
  })

  // 段 3 × §9-15（統合 2026-11-05）: テンプレの別の机 1 の倉島がこのコマで休み → 休みの倉島は机に置かれない方が勝つ。テンプレはこのコマに倉島を置かないので
  // §9-15 の前提（テンプレが別の机にも X を置く）が無く、机 0 は §2-3 の 2 行目どおり（上＝田村／下＝手置きの倉島・保留）。机 1 は講師なしで休みの記録が残る。
  // 休みを §9-15 が見ないと、机 0 は倉島のまま田村を押さえてしまう（置かれない倉島を理由に W を消す）。反映・再マージ 2 回で不変（INV-03）。
  it('§9-15 × 講師の休み: 机 1 の倉島が休み × テンプレが机 0 に田村・机 1 に倉島 → 机 1 に倉島は置かない（休みが勝つ）・机 0 は「倉島のまま」にしない（上＝田村／下＝倉島）', () => {
    const rows = [row('r0', 'tD', 'sC'), row('r1', 'tB', 'sX')]
    const restedOnDesk1 = mutateDesk(boardWith(MAKEUP_A, 0), 1, (desk) => ({ ...desk, teacher: '', teacherAssignmentTeacherId: undefined, teacherRest: { teacher: '倉島', teacherId: 'tB' } }))
    const saved = save(restedOnDesk1, rows)
    const cell = cellOf(saved.nextWeeks)
    expect(cell.desks[1]).toMatchObject({ teacher: '', teacherRest: { teacher: '倉島' } })
    expect(cell.desks[0].teacher).toBe('田村')
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher?.teacher).toBe('倉島')
    expect(saved.studentNotes.some((note) => note.kind === 'teacher-kept')).toBe(false)
    expect(cell.desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(0)
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
    expect(cellOf(resaveSame(saved, rows).nextWeeks).desks).toEqual(cell.desks)
  })

  it('§9-1 × QR（§9-13）: QR の倉島の机 1 があるコマで、テンプレが机 0 に倉島＋C → 机 0 に倉島を置かない（QR の講師も手入力が勝つ）', () => {
    const rows = [row('r0', 'tB', 'sC')]
    const week = mutateDesk(buildWeek(OLD_ROWS), 1, (desk) => ({ ...desk, teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 'tB' }))
    const saved = save(week, rows)
    expect(cellOf(saved.nextWeeks).desks.map((desk) => desk.teacher)).toEqual(['', '倉島'])
    expect(cellOf(saved.nextWeeks).desks[1].teacherAssignmentSource).toBe('schedule-registration')
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, rows, saved.addedSuppressedRegularLessonOccurrences)
  })
})

// 第 2 版 段 3（spec-template-conflict-v2 §2-3 の表の 5 行目・§2-4・§9-7）: 講師の休み。テンプレの講師 D（田村）を休みにした机は講師なし（休みが勝つ）。
// 休みの机に手置き講師 B（倉島）を置くと、テンプレの D は休みで置かないので講師欄は 2 行にならない（B の 1 行・休みの記録は残る）。
// 休みを解除すると D が戻り、手置きの B とは講師欄 2 行（§2-3 の 2 行目）になる＝2 行にしないのは休みの記録のおかげ。反映・再マージ 2 回で不変（INV-03）。
describe('講師の休み（§2-4）: 休みの記録は反映で消えない・休みの机に手で置いた講師は 1 行', () => {
  const restedBoard = (extra: Partial<DeskCell> = {}) => mutateDesk(buildWeek(NEW_ROWS), 0, (desk) => ({ ...restDeskTeacher(desk)!, ...extra }))
  it('D を休みにした机 0 × 反映 → 講師なし・生徒 C は残る・記録は残る・保留なし。再マージ 2 回で不変。講師日程表の D のページに C は出ない', () => {
    const saved = save(restedBoard(), NEW_ROWS)
    expect(desk0(saved.nextWeeks)).toMatchObject({ teacher: '', teacherRest: { teacher: '田村', teacherId: 'tD' } })
    expect(ids(desk0(saved.nextWeeks))).toEqual(['sC', null])
    expect(saved.nextPendingDesks).toEqual({})
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, NEW_ROWS, [])
    expect(teacherSheetPeople(saved.nextWeeks, 'tD')).toEqual([])
  })
  it('休みの机 0 に B を手で置く × 反映 → B の 1 行（講師欄 2 行にならない）・休みの記録は残る。C は B のページにだけ出る', () => {
    const saved = save(restedBoard(MANUAL_TEACHER_B), NEW_ROWS)
    expect(desk0(saved.nextWeeks)).toMatchObject({ teacher: '倉島', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '田村' } })
    expect(saved.nextPendingDesks).toEqual({})
    expect(saved.summary.manualTeacherPending).toBe(0)
    expectFixpoint(saved.nextWeeks, saved.nextPendingDesks, NEW_ROWS, [])
    expect(teacherSheetPeople(saved.nextWeeks, 'tB')).toEqual(['千葉'])
    expect(teacherSheetPeople(saved.nextWeeks, 'tD')).toEqual([])
  })
  it('休みを解除して B が残る机 0 × 反映 → D が戻り、講師欄だけ 2 行（上＝D／下＝B）。休みの記録が無ければ §2-3 の 2 行目どおり', () => {
    const released = mutateDesk(restedBoard(MANUAL_TEACHER_B), 0, (desk) => releaseDeskTeacherRest(desk)!)
    const saved = save(released, NEW_ROWS)
    expect(desk0(saved.nextWeeks)).toMatchObject({ teacher: '田村', manualTeacher: false })
    expect(desk0(saved.nextWeeks).teacherRest).toBeUndefined()
    expect(saved.nextPendingDesks[key0(saved.nextWeeks)]?.lower.teacher).toMatchObject({ teacher: '倉島' })
  })
})
