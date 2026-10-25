// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey } from './makeupStock'
import {
  buildWholeDayTransferConfirmMessage,
  computeWholeDayTransfer,
  remergeBoardWeekWithManagedData,
  type ComputeWholeDayTransferResult,
} from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, cloneTemplatePendingDeskMap, normalizeTemplatePendingDeskMap, type TemplatePendingDeskMap } from './templatePendingDesks'
import { resolveTemplatePendingDateBlockReason, settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import { buildWholeDayTransferResultMessage } from './boardResultMessages'
import { isWholeDayTransferDisplacedLesson } from './wholeDayTransferDisplaced'

const { BoardGrid } = await import('./BoardGrid')
const { stripTemplatePendingLowerForPdf } = await import('../../utils/pdf')

// ============================================================================
// INV-02 / INV-06 / INV-13 マトリクス: 丸ごと振替で押し出された授業は保留（下段・緑）で残す
// （決定記録 48・2026-10-25・docs/plan-2026-10-25-conflict-placement.md §2 場面 1 / §4 (a)・spec-template-behavior §H Q42）
//
// 保証（台帳 docs/spec-invariants.md の注記）:
//   INV-02 … 振替先に室長が置いていた体験・増コマ・手動追加は、丸ごと振替で消えない（空き席に残る／別の机へずらす／同じ机番号の下段）。
//   INV-06 … 残した授業は在庫も希望回数も動かさない（残数・台帳・−1 が前後で同じ）。テンプレ由来の通常・振替・講習は従来どおり。
//   INV-13 … 下段は盤面専用（PDF から外れる）。再マージ 2 回で下段が残り二重にならない（不動点）。上段の席が空けば Q28 で 1 行に戻る。
// 列 ＝ 押し出される授業の種別（体験・増コマ・手動追加の通常）× 置き先（元の机の空き席・別の机・下段）
// 行 ＝ 従来どおりの種別（テンプレ由来の通常・振替・講習）とフラグ OFF の不変
// ============================================================================

const SOURCE_DATE = '2026-08-05' // 水
const TARGET_DATE = '2026-08-19' // 水
const TODAY = new Date('2026-07-31T00:00:00')
const CREATED_AT = '2026-10-25T09:00:00.000Z'

const student: StudentRow = { id: 'student-1', name: '大槻 太郎', displayName: '大槻', email: 's1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
const student2: StudentRow = { id: 'student-2', name: '鈴木 花子', displayName: '鈴木', email: 's2@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-06-01' }
const students = [student, student2]
const teacher: TeacherRow = { id: 'teacher-1', name: '田中講師', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
const teacher2: TeacherRow = { id: 'teacher-2', name: '佐藤講師', email: 't2@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }] }
const teachers = [teacher, teacher2]
const regularLesson: RegularLessonRow = {
  id: 'regular-1', schoolYear: 2026, teacherId: 'teacher-1', student1Id: 'student-1', subject1: '数', startDate: '', endDate: '',
  student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5,
}
const settings: ClassroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2 }

function entry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return { id: 'entry-1', name: '大槻 太郎', managedStudentId: 'student-1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}
const trial = (seat: string) => entry({ id: `trial-${seat}`, name: '体験生', managedStudentId: undefined, lessonType: 'trial', manualAdded: true })
const extra = () => entry({ id: 'extra-1', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英', lessonType: 'extra', manualAdded: true })
const manualRegular = () => entry({ id: 'manual-1', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英', lessonType: 'regular', manualAdded: true })

function desk(id: string, teacherName: string, slots: [StudentEntry | null, StudentEntry | null] | null, lessonId = `lesson-${id}`): DeskCell {
  return { id, teacher: teacherName, ...(teacherName ? { manualTeacher: true } : {}), ...(slots ? { lesson: { id: lessonId, studentSlots: slots } } : {}) }
}
function cell(dateKey: string, desks: DeskCell[]): SlotCell {
  return { id: `${dateKey}_5`, dateKey, dayLabel: '水', dateLabel: dateKey === SOURCE_DATE ? '8/5' : '8/19', slotLabel: '5限', slotNumber: 5, timeLabel: '19:00-20:20', isOpenDay: true, desks }
}
const resolveStudentKey = (e: StudentEntry) => e.managedStudentId ?? e.id

function run(sourceDesks: DeskCell[], targetDesks: DeskCell[], options: { pending?: TemplatePendingDeskMap | null } = {}) {
  const weeks = [[cell(SOURCE_DATE, sourceDesks), cell(TARGET_DATE, targetDesks)]]
  const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: [regularLesson], classroomSettings: settings, weeks, manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
  const result = computeWholeDayTransfer({
    weeks, sourceDateKey: SOURCE_DATE, targetDateKey: TARGET_DATE,
    manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {}, fallbackLectureStockStudents: {},
    suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, scheduleCountAdjustments: [],
    students, teachers, regularLessons: [regularLesson],
    managedStudentByAnyName: new Map(students.map((s) => [s.name, s])),
    resolveDisplayName: (name) => name, resolveStockId: resolveStudentKey, ledgerOriginDatesByKey,
    leaveSourceRestMarkers: true,
    // 既定＝フラグ ON（空の保留マップを渡す）。null を渡すとフラグ OFF の従来経路。
    templatePendingDesks: options.pending === undefined ? {} : options.pending,
    createdAt: CREATED_AT,
  })
  if (result.status !== 'transferred') throw new Error(`expected transferred: ${result.message}`)
  const target = result.nextWeeks.flat().find((c) => c.dateKey === TARGET_DATE)!
  return { weeks, result, target, pending: result.nextTemplatePendingDesks ?? {} }
}

function balanceOf(weeks: SlotCell[][], result: Extract<ComputeWholeDayTransferResult, { status: 'transferred' }> | null, pending: TemplatePendingDeskMap, key: string) {
  return buildMakeupStockEntries({
    students, teachers, regularLessons: [regularLesson], classroomSettings: settings, weeks,
    manualAdjustments: result?.nextManualMakeupAdjustments ?? {}, suppressedOrigins: result?.nextSuppressedMakeupOrigins ?? {}, resolveStudentKey, today: TODAY, templatePendingDesks: pending,
  }).find((e) => e.key === key)?.balance ?? 0
}

const liveNames = (d: DeskCell | undefined) => (d?.lesson?.studentSlots ?? []).flatMap((s) => (s ? [`${s.lessonType}:${s.name}`] : []))

describe('INV-02 マトリクス: 丸ごと振替で振替先の室長の手置きは消えない（決定記録 48・templateDiffApply の教室）', () => {
  it('対象の種別: 体験・増コマ・手動追加の通常だけ（テンプレ由来の通常・振替・講習は従来どおり処分）', () => {
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'trial' })).toBe(true)
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'extra' })).toBe(true)
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'regular', manualAdded: true })).toBe(true)
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'regular' })).toBe(false)
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'makeup', manualAdded: true })).toBe(false)
    expect(isWholeDayTransferDisplacedLesson({ lessonType: 'special' })).toBe(false)
  })

  it('元の机に空き席があれば体験はその席に残る（kept）。移送された通常は振替として同じ机に入る', () => {
    const { result, target, pending } = run(
      [desk('s0', '田中講師', [entry(), null]), desk('s1', '', null)],
      [desk('t0', '佐藤講師', [null, trial('a')]), desk('t1', '', null)],
    )
    expect(liveNames(target.desks[0])).toEqual(['makeup:大槻 太郎', 'trial:体験生'])
    expect(result.summary.displaced).toEqual({ keptCount: 1, shiftedCount: 0, pendingCount: 0, names: ['体験:体験生'] })
    expect(result.summary.clearedTrialCount).toBe(0)
    expect(pending).toEqual({})
    expect(result.nextScheduleCountAdjustments).toEqual([])
  })

  it('元の机が移送で埋まれば、同じコマの別の机の空き席へずらす（講師が居る机を優先・shifted）', () => {
    // 振替先の講師は移送で上書きされる（従来どおり）ので、移送後に講師が居るのは振替元 s2 の佐藤講師が移る t2。
    const { result, target, pending } = run(
      [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })]), desk('s1', '', null), desk('s2', '佐藤講師', null)],
      // 増コマは移送で来る生徒と別の生徒（同じ生徒なら INV-12 で下段へ回る＝別の行で固定）。
      [desk('t0', '', [entry({ id: 'extra-3', name: '別の子', managedStudentId: 'student-3', subject: '英', lessonType: 'extra', manualAdded: true }), null]), desk('t1', '', null), desk('t2', '', null)],
    )
    expect(liveNames(target.desks[0])).toEqual(['makeup:大槻 太郎', 'makeup:鈴木 花子'])
    expect(liveNames(target.desks[1])).toEqual([])
    expect(liveNames(target.desks[2])).toEqual(['extra:別の子'])
    expect(result.summary.displaced).toMatchObject({ keptCount: 0, shiftedCount: 1, pendingCount: 0 })
    expect(result.summary.clearedExtraCount).toBe(0)
    expect(pending).toEqual({})
  })

  it('空き席が無ければ同じ机番号の机の下段（保留・緑）に残す（pending）。理由と対象日を持つ', () => {
    const { result, target, pending } = run(
      [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })])],
      [desk('t0', '佐藤講師', [manualRegular(), null])],
    )
    expect(liveNames(target.desks[0])).toEqual(['makeup:大槻 太郎', 'makeup:鈴木 花子'])
    const key = buildTemplatePendingDeskKey(target.id, 't0')
    expect(Object.keys(pending)).toEqual([key])
    expect(pending[key].lower.lesson?.studentSlots.map((s) => s?.name ?? null)).toEqual(['鈴木 花子', null])
    expect(pending[key].lower.lesson?.studentSlots[0]?.manualAdded).toBe(true)
    expect(pending[key].effectiveStartDate).toBe(TARGET_DATE)
    expect(pending[key].createdAt).toBe(CREATED_AT)
    expect(pending[key].origin?.kind).toBe('whole-day-transfer-displaced')
    expect(pending[key].origin?.note).toContain(`${SOURCE_DATE} → ${TARGET_DATE}`)
    expect(result.summary.displaced).toEqual({ keptCount: 0, shiftedCount: 0, pendingCount: 1, names: ['手動追加:鈴木 花子'] })
    expect(result.summary.clearedManualCount).toBe(0)
    expect(result.summary.clearedRegularCount).toBe(0)
    // 入力の保留マップは変えない（新しい参照）。
    expect(result.nextTemplatePendingDesks).not.toBe(undefined)
    expect(Object.keys(pending)).toHaveLength(1)
  })

  it('INV-12（regression-reviewer H-2）: 移送で同じ生徒が上段に来るなら、残す授業は上段に残さず・ずらさず下段へ回す（同じコマに同じ生徒を 2 件にしない）', () => {
    const { result, target, pending } = run(
      [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })]), desk('s1', '', null)],
      [desk('t0', '', null), desk('t1', '佐藤講師', [extra(), null])],
    )
    expect(liveNames(target.desks[0])).toEqual(['makeup:大槻 太郎', 'makeup:鈴木 花子'])
    expect(liveNames(target.desks[1])).toEqual([])
    const upperIds = target.desks.flatMap((d) => (d.lesson?.studentSlots ?? []).flatMap((s) => (s?.managedStudentId ? [s.managedStudentId] : [])))
    expect(upperIds.filter((id) => id === 'student-2')).toHaveLength(1)
    const key = buildTemplatePendingDeskKey(target.id, 't1')
    expect(pending[key].lower.lesson?.studentSlots[0]).toMatchObject({ id: 'extra-1', lessonType: 'extra' })
    expect(result.summary.displaced).toMatchObject({ keptCount: 0, shiftedCount: 0, pendingCount: 1 })
  })

  it('入力の保留マップは変えない（新しい参照を返す）。講師の居ない机に残す授業は確認文に「(講師なし)」と出る', () => {
    const inputPending: TemplatePendingDeskMap = {}
    const weeks = [[cell(SOURCE_DATE, [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })])]), cell(TARGET_DATE, [desk('t0', '佐藤講師', [manualRegular(), null])])]]
    const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({ students, regularLessons: [regularLesson], classroomSettings: settings, weeks, manualAdjustments: {}, resolveStudentKey, today: TODAY, includeAbsentMakeupOrigins: false })
    const result = computeWholeDayTransfer({
      weeks, sourceDateKey: SOURCE_DATE, targetDateKey: TARGET_DATE, manualMakeupAdjustments: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackMakeupStudents: {}, fallbackLectureStockStudents: {},
      suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, scheduleCountAdjustments: [], students, teachers, regularLessons: [regularLesson], managedStudentByAnyName: new Map(students.map((s) => [s.name, s])),
      resolveDisplayName: (name) => name, resolveStockId: resolveStudentKey, ledgerOriginDatesByKey, templatePendingDesks: inputPending, createdAt: CREATED_AT,
    })
    if (result.status !== 'transferred') throw new Error('expected transferred')
    expect(inputPending).toEqual({})
    expect(result.nextTemplatePendingDesks).not.toBe(inputPending)
    expect(Object.keys(result.nextTemplatePendingDesks ?? {})).toHaveLength(1)
    // 講師なしの開示（M-1）: 振替元に講師が居ない机へ移った体験は「(講師なし)」。
    const teacherless = run(
      [desk('s0', '', [entry(), null])],
      [desk('t0', '佐藤講師', [null, trial('a')])],
    )
    expect(teacherless.result.summary.displaced?.names).toEqual(['体験:体験生(講師なし)'])
    expect(teacherless.target.desks[0].teacher).toBe('')
  })

  it('下段の 2 席が埋まれば次の机の下段へ（同じ机に体験 2 人＋別の机から押し出し）', () => {
    const full = (id: string, lessonId: string) => desk(id, '', [entry({ id: `${id}-a` }), entry({ id: `${id}-b`, name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })], lessonId)
    const { target, pending } = run(
      [full('s0', 'l0'), full('s1', 'l1')],
      [desk('t0', '', [trial('a'), trial('b')]), desk('t1', '', [extra(), null])],
    )
    const key0 = buildTemplatePendingDeskKey(target.id, 't0')
    const key1 = buildTemplatePendingDeskKey(target.id, 't1')
    expect(pending[key0].lower.lesson?.studentSlots.map((s) => s?.id ?? null)).toEqual(['trial-a', 'trial-b'])
    expect(pending[key1].lower.lesson?.studentSlots.map((s) => s?.id ?? null)).toEqual(['extra-1', null])
  })

  it('テンプレ由来の通常（管理授業）は従来どおり消して −1＋抑止。振替・講習は従来どおり未消化へ（フラグ ON でも変わらない）', () => {
    const regularOut = run(
      [desk('s0', '田中講師', [entry(), null])],
      [desk('t0', '佐藤講師', [entry({ id: 'managed-x', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' }), null], 'managed_t0')],
    )
    expect(regularOut.result.summary.clearedRegularCount).toBe(1)
    expect(regularOut.result.nextScheduleCountAdjustments).toEqual([{ studentKey: 'student-2', subject: '英', countKind: 'regular', dateKey: TARGET_DATE, delta: -1 }])
    expect(regularOut.result.summary.displaced).toEqual({ keptCount: 0, shiftedCount: 0, pendingCount: 0, names: [] })
    expect(regularOut.pending).toEqual({})

    const makeupOut = run(
      [desk('s0', '田中講師', [entry(), null])],
      [desk('t0', '佐藤講師', [entry({ id: 'mk', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英', lessonType: 'makeup', makeupSourceDate: '2026-07-29' }), null])],
    )
    expect(makeupOut.result.summary.returnedMakeupCount).toBe(1)
    expect(makeupOut.pending).toEqual({})

    const specialOut = run(
      [desk('s0', '田中講師', [entry(), null])],
      [desk('t0', '佐藤講師', [entry({ id: 'sp', lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1' }), null])],
    )
    expect(specialOut.result.summary.returnedLectureCount).toBe(1)
    expect(specialOut.pending).toEqual({})
  })

  it('フラグ OFF（保留マップを渡さない）: 従来どおり体験・増コマ・手動追加は消える（本番 3 教室の挙動は不変）', () => {
    const { result, target } = run(
      [desk('s0', '田中講師', [entry(), null])],
      [desk('t0', '佐藤講師', [trial('a'), extra()])],
      { pending: null },
    )
    expect(liveNames(target.desks[0])).toEqual(['makeup:大槻 太郎'])
    expect(result.summary.clearedTrialCount).toBe(1)
    expect(result.summary.clearedExtraCount).toBe(1)
    expect(result.summary.displaced).toBeUndefined()
    expect(result.nextTemplatePendingDesks).toBeUndefined()
  })
})

describe('INV-06 マトリクス: 残した授業は在庫も希望回数も動かさない', () => {
  it('下段に残しても残数・台帳・−1 が前後で同じ（体験・増コマ・手動追加は在庫を持たない）', () => {
    const { weeks, result, pending } = run(
      [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })])],
      [desk('t0', '佐藤講師', [manualRegular(), extra()])],
    )
    expect(result.nextManualMakeupAdjustments).toEqual({})
    expect(result.nextManualLectureStockCounts).toEqual({})
    expect(result.nextScheduleCountAdjustments).toEqual([])
    for (const key of ['student-1__数', 'student-2__英']) {
      expect(balanceOf(weeks, null, {}, key), key).toBe(balanceOf(result.nextWeeks, result, pending, key))
    }
    expect(Object.keys(pending)).toHaveLength(1)
    expect(result.summary.displaced?.pendingCount).toBe(2)
  })
})

describe('INV-13 マトリクス: 下段は盤面専用・不動点・Q28 で 1 行に戻る', () => {
  function pendingCase() {
    return run(
      [desk('s0', '田中講師', [entry(), entry({ id: 'entry-2', name: '鈴木 花子', managedStudentId: 'student-2', subject: '英' })])],
      [desk('t0', '佐藤講師', [trial('a'), null])],
    )
  }

  it('再マージを 2 回通しても上段は変わらず、下段は残り、体験が上段に湧かない（不動点・INV-12）', () => {
    const { result, pending } = pendingCase()
    const remerge = (week: SlotCell[]) => remergeBoardWeekWithManagedData(week, { classroomSettings: settings, teachers, students, regularLessons: [regularLesson], suppressedRegularLessonOccurrences: result.nextSuppressedRegularLessonOccurrences, todayKey: '2026-07-31' })
    const once = remerge(result.nextWeeks[0])
    const twice = remerge(once)
    const targetOnce = once.find((c) => c.dateKey === TARGET_DATE)!
    const targetTwice = twice.find((c) => c.dateKey === TARGET_DATE)!
    // 再マージは週の空の日を生成し直す（既存の性質）ので、比べるのは振替先・振替元のコマ。
    expect(JSON.stringify(targetTwice)).toBe(JSON.stringify(targetOnce))
    expect(JSON.stringify(twice.find((c) => c.dateKey === SOURCE_DATE))).toBe(JSON.stringify(once.find((c) => c.dateKey === SOURCE_DATE)))
    expect(JSON.stringify(targetOnce.desks)).toBe(JSON.stringify(result.nextWeeks.flat().find((c) => c.dateKey === TARGET_DATE)!.desks))
    expect(liveNames(targetOnce.desks[0])).toEqual(['makeup:大槻 太郎', 'makeup:鈴木 花子'])
    // 保留マップは再マージが触らない（別マップ）。
    expect(cloneTemplatePendingDeskMap(pending)).toEqual(pending)
  })

  it('保存の往復（JSON → 正規化）で理由（origin）が残る。知らない種別は従来のテンプレ保存の保留として扱う', () => {
    const { pending } = pendingCase()
    const roundTrip = normalizeTemplatePendingDeskMap(JSON.parse(JSON.stringify(pending)))
    expect(roundTrip).toEqual(pending)
    const key = Object.keys(pending)[0]
    const broken = normalizeTemplatePendingDeskMap({ [key]: { ...pending[key], origin: { kind: 'unknown', note: 'x' } } })
    expect(broken[key].origin).toBeUndefined()
  })

  it('下段のある日は丸ごと振替・全コマ削除が止まる（Q31 の既存ガードが新しい保留にも効く）', () => {
    const { result, pending } = pendingCase()
    expect(resolveTemplatePendingDateBlockReason(pending, result.nextWeeks, TARGET_DATE, '丸ごと振替')).toContain('保留')
    expect(resolveTemplatePendingDateBlockReason(pending, result.nextWeeks, SOURCE_DATE, '丸ごと振替')).toBeNull()
  })

  it('上段の席が空くと Q28 で自動で 1 行に戻る（決定 A）: 体験が机へ戻り保留が消える', () => {
    const { result, pending, target } = pendingCase()
    // 室長が上段の 2 人を別の日へ動かした（記録を残さず削除した）形。
    const nextWeeks = result.nextWeeks.map((week) => week.map((c) => (c.id === target.id ? { ...c, desks: c.desks.map((d) => ({ ...d, lesson: undefined })) } : c)))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: result.nextWeeks, previousTemplatePendingDesks: pending, weeks: nextWeeks, templatePendingDesks: pending })
    expect(settled.collapsedKeys).toEqual(Object.keys(pending))
    expect(settled.nextTemplatePendingDesks).toEqual({})
    const settledTarget = settled.nextWeeks.flat().find((c) => c.dateKey === TARGET_DATE)!
    expect(liveNames(settledTarget.desks[0])).toEqual(['trial:体験生'])
    // 片方の席だけ空いても戻る（下段の体験が元の席 0 に入る）。
    const oneSeat = result.nextWeeks.map((week) => week.map((c) => (c.id === target.id ? { ...c, desks: c.desks.map((d) => ({ ...d, lesson: d.lesson ? { ...d.lesson, studentSlots: [null, d.lesson.studentSlots[1]] as [StudentEntry | null, StudentEntry | null] } : undefined })) } : c)))
    const settledOne = settleTemplatePendingDesksAfterCommit({ previousWeeks: result.nextWeeks, previousTemplatePendingDesks: pending, weeks: oneSeat, templatePendingDesks: pending })
    expect(settledOne.collapsedKeys).toHaveLength(1)
    expect(liveNames(settledOne.nextWeeks.flat().find((c) => c.dateKey === TARGET_DATE)!.desks[0])).toEqual(['trial:体験生', 'makeup:鈴木 花子'])
  })

  it('盤面は下段を緑で描き、ツールチップに理由が出る。盤面 PDF は下段を外す', () => {
    const { result, pending } = pendingCase()
    const html = renderToStaticMarkup(createElement(BoardGrid, {
      cells: result.nextWeeks[0],
      selectedStudentId: null,
      highlightedCell: null,
      highlightedHolidayDate: null,
      yearLabel: '2026',
      specialPeriods: [],
      resolveStudentDisplayName: (name: string) => name,
      resolveStudentGradeLabel: (_name: string, grade: string) => grade,
      resolveDisplayedLessonType: (_name: string, _subject: string, lessonType) => lessonType,
      onDayHeaderClick: () => {},
      onTeacherClick: () => {},
      onStudentClick: () => {},
      templatePendingDesks: pending,
      onTemplatePendingLowerClick: () => {},
    }))
    const container = document.createElement('div')
    container.innerHTML = html
    const lower = container.querySelector('.sa-pending-lower')
    expect(lower).not.toBeNull()
    expect(lower?.getAttribute('title')).toContain('丸ごと振替')
    expect(lower?.textContent).toContain('体験生')
    // 黄色・赤文字の別クラスは付けない（既存の保留と同じ緑）。
    expect(container.querySelector('.sa-conflict')).toBeNull()
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelector('.sa-pending-lower')).toBeNull()
    expect(container.textContent).not.toContain('体験生')
  })

  it('確認ダイアログと結果の帯に件数と名前が出る（消える件数には数えない）', () => {
    const { result } = pendingCase()
    const message = buildWholeDayTransferConfirmMessage(SOURCE_DATE, TARGET_DATE, result.summary)
    expect(message).toContain('残す: 1件（体験:体験生・保留(下段)に1件）')
    expect(message).not.toContain('体験1件')
    expect(message.split('\n')).toHaveLength(2)
    expect(buildWholeDayTransferResultMessage({ sourceDateKey: SOURCE_DATE, targetDateKey: TARGET_DATE, movedStudentCount: 2, movedTeacherCount: 1, returnedCount: 0, pendingCount: 1 })).toContain('保留(下段)に 1件')
    expect(buildWholeDayTransferResultMessage({ sourceDateKey: SOURCE_DATE, targetDateKey: TARGET_DATE, movedStudentCount: 2, movedTeacherCount: 1, returnedCount: 0 })).not.toContain('保留')
  })
})
