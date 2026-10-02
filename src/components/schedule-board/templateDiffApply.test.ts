// テンプレ保存の差分反映＋保留（Issue #72・docs/spec-template-behavior.md §H Q21〜Q33・第 1 段 (A)）の回帰防止テスト。
//
// 固定すること（受け入れ条件の番号は spec §実装タスク 第 1 段）:
//   - 印（Q22）の判定・中身の同一（Q23）・机の講師（Q21-9）・合流（Q28）・「既存を採用」の回数（Q26-1）の純関数
//   - 差分反映の本体（computeTemplateDiffApplyForBoard）：置換／残す／採用／保留／削除記録の消去／即時合流／Q21-11／Q29
//   - 結果が盤面の再マージ（remergeBoardWeeksWithManagedData）の不動点であること（条件 21・INV-02/INV-03）
//   - 反映日より前は参照ごと不変（条件 1・INV-10）
//   - 保存前後で未消化振替が一致（条件 9・9-2・INV-06 拡張）

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  buildManagedOccurrenceKey,
  buildAppliedManagedPostFreezeCells,
  buildManagedScheduleCellsForRange,
  buildTemplateDiffTemplateCells,
  buildTemplateTeacherSuppressionKey,
  computeTemplateDiffApplyForBoard,
  isDeletedTeacherTombstone,
  remergeBoardWeeksWithManagedData,
} from './ScheduleBoardScreen'
import {
  buildFullySuppressedManagedDesk,
  buildTemplateDiffConfirmMessage,
  buildTemplateDiffSavedMessage,
  buildTemplateOccurrenceKey,
  computePendingDeskCollapse,
  computeTemplateDiffApply,
  isTemplateDeskStudentContentEqual,
  isTemplateDiffTeacherTombstone,
  isTemplateManagedLesson,
  resolveAdoptExistingCountAdjustments,
  resolveDeskManualInputMark,
  resolveTemplateDeskTeacher,
  shouldSeatSurviveRemerge,
  stripTemplateScaffoldTeacherDesk,
} from './templateDiffApply'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { buildMakeupStockEntries, type ManualMakeupOrigin } from './makeupStock'

// ─────────────────────────────────────────────────────────────────────────────
// フィクスチャ（水曜 5 限・机 3 つ。反映日は水曜 2026-10-07。同じ週の月・火は反映日より前）
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-09-29'

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const students = [
  studentRow('sA', '青木'),
  studentRow('sB', '馬場'),
  studentRow('sC', '千葉'),
  studentRow('sD', '土屋'),
  studentRow('sM', '三浦'),
]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤')]

function row(id: string, teacherId: string, student1Id = '', subject1 = '', student2Id = '', subject2 = '', dayOfWeek = 3, slotNumber = SLOT): RegularLessonRow {
  return {
    id,
    schoolYear: 2026,
    teacherId,
    student1Id,
    subject1,
    startDate: '',
    endDate: '',
    student2Id,
    subject2,
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek,
    slotNumber,
  }
}

function settings(overrides: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, ...overrides } as ClassroomSettings
}

function buildWeek(rows: RegularLessonRow[], classroomSettings = settings()): SlotCell[] {
  return buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
    fallbackStartDate: WEEK_START,
    fallbackEndDate: WEEK_END,
    classroomSettings,
    teachers,
    students,
    regularLessons: rows,
    boardWeeks: [],
  })
}

function cellOf(weeks: SlotCell[][], cellId = CELL_ID) {
  const cell = weeks.flat().find((entry) => entry.id === cellId)
  if (!cell) throw new Error(`cell ${cellId} not found`)
  return cell
}

function deskOf(weeks: SlotCell[][], index: number, cellId = CELL_ID) {
  return cellOf(weeks, cellId).desks[index]
}

function mutateDesk(week: SlotCell[], index: number, update: (desk: DeskCell) => DeskCell, cellId = CELL_ID) {
  return week.map((cell) => (cell.id !== cellId ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === index ? update(desk) : desk)) }))
}

function entry(studentId: string, overrides: Partial<StudentEntry> = {}): StudentEntry {
  const source = students.find((student) => student.id === studentId)!
  return {
    id: `${studentId}_board_${overrides.lessonType ?? 'regular'}`,
    name: source.name,
    managedStudentId: studentId,
    grade: '中2',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function status(studentId: string, statusKind: StudentStatusEntry['status'], overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  const source = students.find((student) => student.id === studentId)!
  return {
    id: `status_${studentId}_${statusKind}`,
    studentId: `${studentId}_entry`,
    sourceManagedLesson: true,
    name: source.name,
    managedStudentId: studentId,
    grade: '中2',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '田中',
    dateKey: DATE,
    slotNumber: SLOT,
    recordedAt: '2026-10-01T00:00:00.000Z',
    status: statusKind,
    sourceLessonId: 'lesson-x',
    ...overrides,
  }
}

function newSettings(extra: Partial<ClassroomSettings> = {}) {
  return settings({ templateFreezeBeforeDate: EFFECTIVE, ...extra })
}

function applyDiff(params: {
  week: SlotCell[]
  newRows: RegularLessonRow[]
  suppressed?: string[]
  pending?: TemplatePendingDeskMap
  classroomSettings?: ClassroomSettings
}) {
  const result = computeTemplateDiffApplyForBoard({
    weeks: [params.week],
    classroomSettings: params.classroomSettings ?? newSettings(),
    teachers,
    students,
    regularLessons: params.newRows,
    effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: params.suppressed ?? [],
    templatePendingDesks: params.pending ?? {},
    createdAt: '2026-09-29T10:00:00.000Z',
  })
  return result
}

function remerge(weeks: SlotCell[][], newRows: RegularLessonRow[], suppressed: string[], classroomSettings = newSettings()) {
  return remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings,
    teachers,
    students,
    regularLessons: newRows,
    suppressedRegularLessonOccurrences: suppressed,
    todayKey: TODAY_KEY,
  })
}

function byCellId(weeks: SlotCell[][]) {
  return Object.fromEntries(weeks.flat().map((cell) => [cell.id, cell]))
}

function liveNames(desk: DeskCell) {
  return (desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)
}

function countLiveInCell(weeks: SlotCell[][], studentId: string, cellId = CELL_ID) {
  return cellOf(weeks, cellId).desks.reduce((sum, desk) => sum + liveNames(desk).filter((id) => id === studentId).length, 0)
}

// 旧テンプレ: 机0=田中(A), 机1=鈴木(B), 机2=佐藤(講師だけ)
const OLD_ROWS = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]

// ─────────────────────────────────────────────────────────────────────────────
// Q22：印
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDeskManualInputMark（Q22・条件 7）', () => {
  const base: DeskCell = { id: 'd', teacher: '田中', lesson: { id: 'managed_r0_x', note: '管理データ反映', studentSlots: [entry('sA'), null] } }
  const ctx = { dateKey: DATE, slotNumber: SLOT, suppressedRegularLessonOccurrences: [] as string[] }

  it('テンプレどおりの通常授業だけの机は印なし', () => {
    expect(resolveDeskManualInputMark(base, ctx)).toEqual({ marked: false, reasons: [] })
  })

  it.each([
    ['makeup'], ['special'], ['trial'], ['extra'],
  ] as const)('種別 %s の生徒は印あり', (lessonType) => {
    const desk: DeskCell = { ...base, lesson: { id: 'l', studentSlots: [entry('sM', { lessonType }), null] } }
    expect(resolveDeskManualInputMark(desk, ctx).reasons.map((reason) => reason.kind)).toContain('lesson-type')
  })

  it.each([
    ['manualAdded', { manualAdded: true }, 'manual-added'],
    ['sameDayMoveSourceDate', { sameDayMoveSourceDate: DATE }, 'same-day-move'],
    ['makeupSourceDate', { makeupSourceDate: '2026-09-30' }, 'makeup-source'],
  ] as const)('%s を持つ生徒は印あり', (_label, overrides, kind) => {
    const desk: DeskCell = { ...base, lesson: { id: 'l', studentSlots: [entry('sA', overrides), null] } }
    const mark = resolveDeskManualInputMark(desk, ctx)
    expect(mark.marked).toBe(true)
    expect(mark.reasons.map((reason) => reason.kind)).toContain(kind)
  })

  it.each(['absent', 'absent-no-makeup', 'attended', 'moved', 'holiday'] as const)('出欠記録 %s は印あり', (statusKind) => {
    const desk: DeskCell = { ...base, statusSlots: [status('sC', statusKind), null] }
    expect(resolveDeskManualInputMark(desk, ctx).reasons).toEqual([{ kind: 'status-record', studentName: '千葉', status: statusKind }])
  })

  it('空でないメモは印あり・空白だけのメモは印なし', () => {
    expect(resolveDeskManualInputMark({ ...base, memoSlots: ['連絡', null] }, ctx).marked).toBe(true)
    expect(resolveDeskManualInputMark({ ...base, memoSlots: ['  ', null] }, ctx).marked).toBe(false)
  })

  it('その日の通常授業の削除記録は、テンプレ机（抑止前）の生徒×科目に一致するものだけ帰属する', () => {
    const key = buildTemplateOccurrenceKey(entry('sA'), DATE, SLOT)
    const templateDesk = { lesson: { id: 'managed_r0_x', studentSlots: [entry('sA'), null] as [StudentEntry | null, StudentEntry | null] } }
    const empty: DeskCell = { id: 'd', teacher: '田中' }
    expect(resolveDeskManualInputMark(empty, { ...ctx, suppressedRegularLessonOccurrences: [key], templateDeskBeforeSuppression: templateDesk }).reasons)
      .toEqual([{ kind: 'deleted-regular-occurrence', occurrenceKey: key }])
    // 別の机のテンプレ生徒の抑止は帰属しない
    const otherTemplateDesk = { lesson: { id: 'managed_r1_x', studentSlots: [entry('sB'), null] as [StudentEntry | null, StudentEntry | null] } }
    expect(resolveDeskManualInputMark(empty, { ...ctx, suppressedRegularLessonOccurrences: [key], templateDeskBeforeSuppression: otherTemplateDesk }).marked).toBe(false)
  })

  it('講師の削除記録（講習 ID つきを含む）は印あり', () => {
    expect(resolveDeskManualInputMark({ id: 'd', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted' }, ctx).reasons).toEqual([{ kind: 'deleted-teacher' }])
    expect(resolveDeskManualInputMark({ id: 'd', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentSessionId: 'session-1' }, ctx).marked).toBe(true)
  })

  it.each([
    ['manualTeacher', { manualTeacher: true, teacherAssignmentSource: 'manual' as const }],
    ['manual-replaced', { manualTeacher: true, teacherAssignmentSource: 'manual-replaced' as const }],
    ['schedule-registration', { manualTeacher: true, teacherAssignmentSource: 'schedule-registration' as const, teacherAssignmentSessionId: 'session-1' }],
  ])('講師の配置（%s）だけを持つ机は印なし', (_label, overrides) => {
    expect(resolveDeskManualInputMark({ id: 'd', teacher: '田中', ...overrides }, ctx).marked).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q23：中身が同じ
// ─────────────────────────────────────────────────────────────────────────────

describe('isTemplateDeskStudentContentEqual（Q23-1）', () => {
  const desk = (slots: [StudentEntry | null, StudentEntry | null]) => ({ lesson: { id: 'l', studentSlots: slots } })

  it('席順（左右）は問わない', () => {
    expect(isTemplateDeskStudentContentEqual(desk([entry('sA'), entry('sB')]), desk([entry('sB'), entry('sA')]))).toBe(true)
  })

  it('種別が違えば違う（振替の A とテンプレの通常 A は同じにしない）', () => {
    expect(isTemplateDeskStudentContentEqual(desk([entry('sA'), null]), desk([entry('sA', { lessonType: 'makeup' }), null]))).toBe(false)
  })

  it('科目が違えば違う・人数が違えば違う', () => {
    expect(isTemplateDeskStudentContentEqual(desk([entry('sA'), null]), desk([entry('sA', { subject: '英' }), null]))).toBe(false)
    expect(isTemplateDeskStudentContentEqual(desk([entry('sA'), null]), desk([entry('sA'), entry('sB')]))).toBe(false)
  })

  it('managedStudentId が片方に無ければ名前で比べる・印や授業時間は比べない', () => {
    const noId = entry('sA', { managedStudentId: undefined, manualAdded: true, noteSuffix: '90分' })
    expect(isTemplateDeskStudentContentEqual(desk([entry('sA'), null]), desk([noId, null]))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q21-9：机の講師
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTemplateDeskTeacher（Q21-9・条件 6）', () => {
  const template = { teacher: '鈴木', teacherAssignmentTeacherId: 't2' }

  it('(a) テンプレ机に講師 T・既存が手置き M → T になり手置きの印が外れる', () => {
    const result = resolveTemplateDeskTeacher(template, { teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't1' })
    expect(result.reason).toBe('template')
    expect(result.teacherFields).toEqual({ teacher: '鈴木', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: 't2' })
  })

  it('(b) テンプレ机に講師なし・既存が手置き M → M が残る', () => {
    const existing = { teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' as const, teacherAssignmentTeacherId: 't1' }
    expect(resolveTemplateDeskTeacher({ teacher: '' }, existing)).toEqual({ teacherFields: { ...existing, teacherAssignmentSessionId: undefined }, reason: 'kept-user' })
  })

  it('(c) テンプレ机に講師なし・既存がテンプレ足場の講師（非 manual）→ 外れる', () => {
    expect(resolveTemplateDeskTeacher({ teacher: '' }, { teacher: '田中', teacherAssignmentTeacherId: 't1' })).toEqual({
      teacherFields: { teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: undefined },
      reason: 'cleared',
    })
  })

  it('(d) QR 自動割振り（schedule-registration＋講習期間 ID）→ テンプレ机に講師がいても講師・由来・講習期間 ID が残る', () => {
    const qr = { teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'schedule-registration' as const, teacherAssignmentSessionId: 'session-1', teacherAssignmentTeacherId: 't3' }
    expect(resolveTemplateDeskTeacher(template, qr)).toEqual({ teacherFields: qr, reason: 'kept-qr' })
  })

  it('(e) 講師の削除記録（講習 ID つきを含む）→ テンプレ机に講師がいても講師欄は空のまま・記録も残る', () => {
    const tombstone = { teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted' as const, teacherAssignmentSessionId: 'session-1', teacherAssignmentTeacherId: 't1' }
    expect(resolveTemplateDeskTeacher(template, tombstone)).toEqual({ teacherFields: tombstone, reason: 'kept-deleted' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q28：合流
// ─────────────────────────────────────────────────────────────────────────────

describe('computePendingDeskCollapse（Q28）', () => {
  const upper: DeskCell = { id: 'd', teacher: '田中', lesson: { id: 'managed_r0_x', note: '管理データ反映', studentSlots: [entry('sA'), null] } }

  it('下段の表示専用の記録は捨て、メモと会計記録は空いた席へ引き継ぐ', () => {
    const result = computePendingDeskCollapse(upper, { lower: { statusSlots: [status('sC', 'moved'), null], memoSlots: ['連絡', null] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextDesk.statusSlots).toBeUndefined()
    expect(result.nextDesk.memoSlots).toEqual([null, '連絡'])
  })

  it('出欠枠を超えるなら合流しない（Issue #57 の台帳確定は使わない＝机も在庫も変えない）', () => {
    const full: DeskCell = { ...upper, lesson: { id: 'managed_r0_x', studentSlots: [entry('sA'), entry('sB')] } }
    expect(computePendingDeskCollapse(full, { lower: { statusSlots: [status('sC', 'absent'), null] } })).toEqual({ ok: false, reason: 'status-overflow' })
    expect(computePendingDeskCollapse(full, { lower: { memoSlots: ['連絡', null] } })).toEqual({ ok: false, reason: 'memo-overflow' })
  })

  it('両方の行に生きている生徒がいれば合流しない', () => {
    expect(computePendingDeskCollapse(upper, { lower: { lesson: { id: 'l', studentSlots: [entry('sM', { lessonType: 'makeup' }), null] } } })).toEqual({ ok: false, reason: 'both-rows-live' })
  })

  it('上段が空なら下段の生徒が机になり、旧テンプレ由来の管理授業は机固有の id に付け替わる', () => {
    const emptyUpper: DeskCell = { id: 'd', teacher: '田中' }
    const result = computePendingDeskCollapse(emptyUpper, { lower: { lesson: { id: 'managed_old_x', note: '管理データ反映', studentSlots: [entry('sA', { sameDayMoveSourceDate: DATE }), null] } } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextDesk.lesson?.id).toBe('d_template_kept')
    expect(isTemplateManagedLesson(result.nextDesk.lesson)).toBe(false)
  })

  it('席ごと（2026-09-30）: 両方の行に生きている生徒がいても、下段の生徒の元の席が空いていれば上段の授業に足して 1 行へ', () => {
    const result = computePendingDeskCollapse(upper, { lower: { lesson: { id: 'l', studentSlots: [null, entry('sM', { lessonType: 'makeup' })] } } }, { dateKey: DATE })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextDesk.lesson?.id).toBe('managed_r0_x')
    expect(result.nextDesk.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
  })

  it('席ごと: 元の席が埋まっている・上段と同じ生徒・元の席に出欠記録・管理授業で再マージに落ちる通常授業なら戻さない（もう一方の席へはずらさない）', () => {
    const lowerAt = (student: StudentEntry, seat: 0 | 1) => ({ lower: { lesson: { id: 'l', studentSlots: (seat === 0 ? [student, null] : [null, student]) as [StudentEntry | null, StudentEntry | null] } } })
    expect(computePendingDeskCollapse(upper, lowerAt(entry('sM', { lessonType: 'makeup' }), 0), { dateKey: DATE })).toEqual({ ok: false, reason: 'both-rows-live' })
    expect(computePendingDeskCollapse(upper, lowerAt(entry('sA', { lessonType: 'makeup' }), 1), { dateKey: DATE })).toEqual({ ok: false, reason: 'both-rows-live' })
    expect(computePendingDeskCollapse({ ...upper, statusSlots: [null, status('sC', 'absent')] }, lowerAt(entry('sM', { lessonType: 'makeup' }), 1), { dateKey: DATE })).toEqual({ ok: false, reason: 'both-rows-live' })
    expect(computePendingDeskCollapse(upper, lowerAt(entry('sM', { makeupSourceDate: '2026-09-30' }), 1), { dateKey: DATE })).toEqual({ ok: false, reason: 'both-rows-live' })
    expect(computePendingDeskCollapse(upper, lowerAt(entry('sM', { lessonType: 'makeup' }), 1), { dateKey: DATE, liveStudentsElsewhere: [entry('sM')] })).toEqual({ ok: false, reason: 'both-rows-live' })
  })

  it('下段を戻すと同じコマの別の机と生徒が重なるなら止める（INV-12）', () => {
    const result = computePendingDeskCollapse({ id: 'd', teacher: '' }, { lower: { lesson: { id: 'l', studentSlots: [entry('sA', { lessonType: 'makeup' }), null] } } }, { liveStudentsElsewhere: [entry('sA')] })
    expect(result).toEqual({ ok: false, reason: 'duplicate-student' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q26-1：「既存を採用」の回数
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveAdoptExistingCountAdjustments（Q26-1・条件 13）', () => {
  const cell = (desks: DeskCell[], dateKey = DATE, slotNumber = SLOT): SlotCell => ({ id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '水', dateLabel: '', slotLabel: '', slotNumber, timeLabel: '', isOpenDay: true, desks })

  it('同じ日の実配置に同じ生徒×科目が残っていなければ −1 の対象', () => {
    const result = resolveAdoptExistingCountAdjustments({ withdrawnTemplateStudents: [entry('sA')], dateKey: DATE, placementsAfterAdoption: [cell([{ id: 'd', teacher: '', lesson: { id: 'l', studentSlots: [entry('sM', { lessonType: 'makeup' }), null] } }])] })
    expect(result.map((item) => item.student.managedStudentId)).toEqual(['sA'])
  })

  it('戻した下段の同日移動・同じ日の別時限の授業が残っていれば補正しない（種別・時限は問わない）', () => {
    const sameDayMove = cell([{ id: 'd', teacher: '', lesson: { id: 'l', studentSlots: [entry('sA', { sameDayMoveSourceDate: DATE }), null] } }])
    expect(resolveAdoptExistingCountAdjustments({ withdrawnTemplateStudents: [entry('sA')], dateKey: DATE, placementsAfterAdoption: [sameDayMove] })).toEqual([])
    const otherSlot = cell([{ id: 'd', teacher: '', lesson: { id: 'l', studentSlots: [entry('sA', { lessonType: 'makeup' }), null] } }], DATE, 3)
    expect(resolveAdoptExistingCountAdjustments({ withdrawnTemplateStudents: [entry('sA')], dateKey: DATE, placementsAfterAdoption: [otherSlot] })).toEqual([])
  })

  it('別の日の授業・出欠記録・別の科目は「残っている」に数えない', () => {
    const otherDate = cell([{ id: 'd', teacher: '', lesson: { id: 'l', studentSlots: [entry('sA'), null] } }], '2026-10-08')
    const onlyRecord = cell([{ id: 'd', teacher: '', statusSlots: [status('sA', 'absent'), null] }])
    const otherSubject = cell([{ id: 'd', teacher: '', lesson: { id: 'l', studentSlots: [entry('sA', { subject: '英' }), null] } }])
    expect(resolveAdoptExistingCountAdjustments({ withdrawnTemplateStudents: [entry('sA')], dateKey: DATE, placementsAfterAdoption: [otherDate, onlyRecord, otherSubject] })).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 鍵・管理授業判定の parity（ScheduleBoardScreen と同じ形）
// ─────────────────────────────────────────────────────────────────────────────

describe('parity: 抑止キー・管理授業の判定', () => {
  it('buildTemplateOccurrenceKey は buildManagedOccurrenceKey と同じ鍵を作る', () => {
    for (const student of [entry('sA'), entry('sB', { managedStudentId: undefined }), entry('sC', { subject: '英' })]) {
      expect(buildTemplateOccurrenceKey(student, DATE, SLOT)).toBe(buildManagedOccurrenceKey(student, DATE, SLOT))
    }
  })

  it('N-4: 講師の削除記録の 2 判定は、正規の tombstone の授業の無い机で一致し、目的の違う形でだけ分かれる', () => {
    // 正規の tombstone（applyDeletedTeacherTombstone / handleDeleteTeacher が作る形。講習 ID つきを含む）
    const canonical: DeskCell = { id: 'd', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: '田中' }
    const canonicalWithSession: DeskCell = { ...canonical, teacherAssignmentSessionId: 'session-1' }
    for (const desk of [canonical, canonicalWithSession]) {
      expect(isDeletedTeacherTombstone(desk)).toBe(true)
      expect(isTemplateDiffTeacherTombstone(desk)).toBe(true)
    }
    // 生徒が居る机: 空き机ではない（前者 false）が、講師欄の削除記録ではある（後者 true＝講師を戻さない・印）
    const withStudent: DeskCell = { ...canonical, lesson: { id: 'l', studentSlots: [entry('sA'), null] } }
    expect(isDeletedTeacherTombstone(withStudent)).toBe(false)
    expect(isTemplateDiffTeacherTombstone(withStudent)).toBe(true)
    // 削除記録でない机はどちらも false
    for (const desk of [{ id: 'd', teacher: '' }, { id: 'd', teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' as const }] as DeskCell[]) {
      expect(isDeletedTeacherTombstone(desk)).toBe(false)
      expect(isTemplateDiffTeacherTombstone(desk)).toBe(false)
    }
  })

  it('isTemplateManagedLesson は id 接頭辞 managed_ と note=管理データ反映 のどちらでも真', () => {
    expect(isTemplateManagedLesson({ id: 'managed_r0_x', studentSlots: [null, null] })).toBe(true)
    expect(isTemplateManagedLesson({ id: 'x', note: '管理データ反映', studentSlots: [null, null] })).toBe(true)
    expect(isTemplateManagedLesson({ id: 'x_desk_1_manual', studentSlots: [null, null] })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 差分反映の本体
// ─────────────────────────────────────────────────────────────────────────────

describe('computeTemplateDiffApplyForBoard（Q21・条件 1〜8・21）', () => {
  it('条件 1・INV-10：反映日より前のセル・週は参照ごと不変', () => {
    const week = buildWeek(OLD_ROWS)
    const previousWeek = week.map((cell) => ({ ...cell, dateKey: cell.dateKey.replace('2026-10', '2026-09'), id: `prev_${cell.id}` }))
    const result = computeTemplateDiffApplyForBoard({
      weeks: [previousWeek, week],
      classroomSettings: newSettings(),
      teachers,
      students,
      regularLessons: [row('r0', 't2', 'sC', '数')],
      effectiveStartDate: EFFECTIVE,
      suppressedRegularLessonOccurrences: [],
      templatePendingDesks: {},
      createdAt: 'x',
    })
    expect(result.nextWeeks[0]).toBe(previousWeek)
    const before = week.filter((cell) => cell.dateKey < EFFECTIVE)
    expect(before.length).toBeGreaterThan(0)
    for (const cell of before) expect(result.nextWeeks[1].find((next) => next.id === cell.id)).toBe(cell)
  })

  it('条件 2：印のない机は生徒・講師がテンプレどおりに置き換わる（テンプレ机に生徒がいなければ空席）', () => {
    const week = buildWeek(OLD_ROWS)
    // 新テンプレ: 机0=鈴木(C), 机1=田中(講師だけ)
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1')]
    const result = applyDiff({ week, newRows })
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('鈴木')
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sC'])
    expect(deskOf(result.nextWeeks, 1).teacher).toBe('田中')
    expect(deskOf(result.nextWeeks, 1).lesson).toBeUndefined()
    expect(deskOf(result.nextWeeks, 2).teacher).toBe('')
    expect(result.summary.replaced).toBeGreaterThanOrEqual(3)
    expect(result.nextPendingDesks).toEqual({})
  })

  it('条件 3・6(帰結)：印あり＋テンプレ机に生徒なし＝既存の生徒・記録・メモを残し、講師はテンプレの講師（旧テンプレ由来の通常生徒だけ外す）', () => {
    let week = buildWeek(OLD_ROWS)
    // 机0: 旧テンプレの A ＋ 手置きの振替 M ＋ メモ（印）
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      memoSlots: [null, null],
      lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] },
    }))
    // 新テンプレ: 机0=佐藤(講師だけ)
    const newRows = [row('r0', 't3'), row('r1', 't2', 'sB', '数')]
    const result = applyDiff({ week, newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.teacher).toBe('佐藤')
    expect(desk0.manualTeacher).toBe(false)
    expect(liveNames(desk0)).toEqual(['sM'])
    expect(isTemplateManagedLesson(desk0.lesson)).toBe(false)
    expect(result.summary.kept).toBe(1)
    // A はテンプレに無いので、どの机にも生きていない（二重に数えない）
    expect(countLiveInCell(result.nextWeeks, 'sA')).toBe(0)
  })

  it('条件 4：印あり＋中身が同じ（席順違い）＝テンプレを採用して印を外す・出欠記録とメモは残る', () => {
    let week = buildWeek([row('r0', 't1', 'sA', '数', 'sB', '数')])
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      lesson: { id: `${desk.id}_manual`, studentSlots: [entry('sB', { manualAdded: true }), entry('sA', { sameDayMoveSourceDate: DATE })] },
    }))
    week = mutateDesk(week, 1, (desk) => ({ ...desk, memoSlots: ['連絡', null] }))
    const newRows = [row('r0', 't2', 'sA', '数', 'sB', '数'), row('r1', 't3', 'sC', '数')]
    const result = applyDiff({ week, newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.teacher).toBe('鈴木')
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId)).toEqual(['sA', 'sB'])
    expect(desk0.lesson?.studentSlots.every((student) => !student?.manualAdded && !student?.sameDayMoveSourceDate)).toBe(true)
    expect(isTemplateManagedLesson(desk0.lesson)).toBe(true)
    expect(result.summary.adopted).toBe(1)
    // 机1: メモだけ（生きている生徒なし）＋テンプレ C → 即時合流で 1 行（メモは空いた席へ）
    const desk1 = deskOf(result.nextWeeks, 1)
    expect(liveNames(desk1)).toEqual(['sC'])
    expect(desk1.memoSlots).toEqual([null, '連絡'])
    expect(result.summary.collapsedOnCreate).toBe(1)
  })

  it('条件 5：印あり＋中身が違う＝保留。上段はテンプレ、下段に生きている生徒・表示専用の記録・メモ、会計記録は机に残る。講師は下段に入らない', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      teacher: '佐藤',
      manualTeacher: true,
      teacherAssignmentSource: 'manual',
      lesson: { id: `${desk.id}_makeup`, studentSlots: [null, entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] },
      statusSlots: [status('sA', 'absent'), null],
      memoSlots: [null, '持ち物'],
    }))
    const newRows = [row('r0', 't2', 'sC', '数')]
    const result = applyDiff({ week, newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.teacher).toBe('鈴木')
    expect(desk0.manualTeacher).toBe(false)
    expect(desk0.teacherAssignmentSource).toBeUndefined()
    expect(liveNames(desk0)).toEqual(['sC'])
    // 会計記録は机に残る。テンプレの C が席 0 に座るので、記録は空いている席 1 へ（席の位置だけ移る）。
    expect(desk0.statusSlots?.filter(Boolean).map((item) => item!.status)).toEqual(['absent'])
    expect(desk0.memoSlots).toBeUndefined()
    const pending = result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)]
    expect(pending.lower.lesson?.studentSlots[1]?.managedStudentId).toBe('sM')
    expect(pending.lower.memoSlots).toEqual([null, '持ち物'])
    expect(pending.lower.statusSlots).toBeUndefined()
    expect(pending.effectiveStartDate).toBe(EFFECTIVE)
    expect(Object.keys(pending.lower)).not.toContain('teacher')
    expect(result.summary.pending).toBe(1)
  })

  it('条件 6(e)(f)：削除記録の机は講師が戻らない。削除記録だけ＋テンプレ空＝消す／テンプレ講師だけ＝講師なしのまま 1 行', () => {
    let week = buildWeek(OLD_ROWS)
    const tombstone = (desk: DeskCell): DeskCell => ({ ...desk, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: 't3', lesson: undefined })
    week = mutateDesk(week, 1, tombstone)
    week = mutateDesk(week, 2, tombstone)
    // 新テンプレ: 机0=田中(A), 机1=鈴木(講師だけ), 机2=空
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2')]
    const result = applyDiff({ week, newRows })
    const desk1 = deskOf(result.nextWeeks, 1)
    expect(desk1.teacher).toBe('')
    expect(desk1.teacherAssignmentSource).toBe('deleted')
    const desk2 = deskOf(result.nextWeeks, 2)
    expect(desk2.teacherAssignmentSource).toBeUndefined()
    expect(desk2.manualTeacher).toBe(false)
    expect(result.summary.tombstoneCleared).toBe(1)
    // 再マージを 2 回通しても鈴木は戻らない
    const once = remerge(result.nextWeeks, newRows, [])
    const twice = remerge(once, newRows, [])
    expect(deskOf(twice, 1).teacher).toBe('')
    expect(cellOf(twice).desks.some((desk) => desk.teacher === '鈴木')).toBe(false)
  })

  it('条件 6(e)：削除記録の机にテンプレの生徒 → 講師なしの 1 行にテンプレの生徒が載り、件数に出る', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 1, (desk) => ({ ...desk, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', lesson: undefined }))
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sC', '数')]
    const result = applyDiff({ week, newRows })
    const desk1 = deskOf(result.nextWeeks, 1)
    expect(desk1.teacher).toBe('')
    expect(liveNames(desk1)).toEqual(['sC'])
    expect(result.summary.deletedTeacherDeskFilled).toBe(1)
    expect(result.nextPendingDesks).toEqual({})
  })

  it('条件 6(d)・22：QR 自動割振り講師は残り、2 行になっても下段に講師は入らない', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      teacher: '佐藤',
      manualTeacher: true,
      teacherAssignmentSource: 'schedule-registration',
      teacherAssignmentSessionId: 'session-1',
      teacherAssignmentTeacherId: 't3',
      lesson: { id: `${desk.id}_special`, studentSlots: [entry('sM', { lessonType: 'special', specialSessionId: 'session-1', specialStockSource: 'session' }), null] },
    }))
    const newRows = [row('r0', 't2', 'sC', '数')]
    const result = applyDiff({ week, newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.teacher).toBe('佐藤')
    expect(desk0.teacherAssignmentSource).toBe('schedule-registration')
    expect(desk0.teacherAssignmentSessionId).toBe('session-1')
    expect(liveNames(desk0)).toEqual(['sC'])
    expect(result.summary.qrTeacherKept).toBe(1)
    const pending = result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)]
    expect(pending.lower).toEqual({ lesson: expect.objectContaining({ studentSlots: [expect.objectContaining({ managedStudentId: 'sM' }), null] }) })
    // リロード（再マージ）で QR 講師が別の机へ動かず、講師も入れ替わらない
    const once = remerge(result.nextWeeks, newRows, [])
    expect(deskOf(once, 0).teacher).toBe('佐藤')
    expect(cellOf(once).desks.filter((desk) => desk.teacher === '佐藤')).toHaveLength(1)
  })

  it('条件 7：欠席で抑止された通常生徒は上段に湧かない', () => {
    let week = buildWeek(OLD_ROWS)
    const suppressed = [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)]
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sA', 'absent'), null] }))
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数')]
    const result = applyDiff({ week, newRows, suppressed })
    expect(countLiveInCell(result.nextWeeks, 'sA')).toBe(0)
    expect(deskOf(result.nextWeeks, 0).statusSlots?.[0]?.status).toBe('absent')
    expect(result.nextPendingDesks).toEqual({})
  })

  it('条件 7：講師を削除して生徒を同じコマの別の机へ移した後に保存しても、その生徒は同じコマに 1 か所だけ生きる', () => {
    let week = buildWeek(OLD_ROWS)
    const suppressed = [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)]
    week = mutateDesk(week, 0, (desk) => ({ ...desk, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', lesson: undefined }))
    week = mutateDesk(week, 2, (desk) => ({ ...desk, lesson: { id: 'daymove_x', studentSlots: [entry('sA', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '5限' }), null] } }))
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]
    const result = applyDiff({ week, newRows, suppressed })
    expect(countLiveInCell(result.nextWeeks, 'sA')).toBe(1)
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('')
    expect(liveNames(deskOf(result.nextWeeks, 2))).toEqual(['sA'])
    const suppressedAfter = [...suppressed, ...result.addedSuppressedRegularLessonOccurrences]
    const once = remerge(result.nextWeeks, newRows, suppressedAfter)
    expect(countLiveInCell(once, 'sA')).toBe(1)
  })

  it('条件 7（Q21-11 前段）：別の 1 行の机に生きている生徒は上段に置かず、件数と抑止キーが返り、再マージでも湧かない', () => {
    let week = buildWeek(OLD_ROWS)
    // 机2（テンプレは講師だけ）に A の振替を手置き
    week = mutateDesk(week, 2, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sA', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }))
    // 新テンプレ: 机0 に A（通常）
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]
    const result = applyDiff({ week, newRows })
    expect(countLiveInCell(result.nextWeeks, 'sA')).toBe(1)
    expect(liveNames(deskOf(result.nextWeeks, 2))).toEqual(['sA'])
    expect(result.summary.skippedDuplicateStudents).toBe(1)
    expect(result.addedSuppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)])
    const once = remerge(result.nextWeeks, newRows, result.addedSuppressedRegularLessonOccurrences)
    expect(countLiveInCell(once, 'sA')).toBe(1)
    expect(buildTemplateDiffSavedMessage(EFFECTIVE, result.summary)).toContain('上段に置かなかった生徒: 1名')
  })

  it('条件 7（Q21-11 後段）：別の机の下段にだけ生きている生徒は上段に置く', () => {
    let week = buildWeek(OLD_ROWS)
    // 机1: 振替 A を手置き → 新テンプレは机1 に B を置く → 中身が違うので保留（下段に A）
    week = mutateDesk(week, 1, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sA', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }))
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数')]
    const result = applyDiff({ week, newRows })
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sA'])
    expect(result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, deskOf(result.nextWeeks, 1).id)].lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(result.summary.skippedDuplicateStudents).toBe(0)
  })

  it('条件 8：反映日以降の休日は残り、休日のコマでは印なし机が空席・印あり机の記録は残る', () => {
    const holidaySettings = newSettings({ holidayDates: [DATE] })
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 1, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sB', 'absent'), null] }))
    const newRows = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数')]
    const result = applyDiff({ week, newRows, classroomSettings: holidaySettings })
    const cell = cellOf(result.nextWeeks)
    expect(cell.isOpenDay).toBe(false)
    expect(liveNames(cell.desks[0])).toEqual([])
    expect(cell.desks[1].statusSlots?.[0]?.status).toBe('absent')
  })

  it('条件 21：差分反映の直後に同じテンプレ・同じ抑止で再マージを 2 回通しても、机・保留マップが変わらない', () => {
    let week = buildWeek(OLD_ROWS)
    // 机0: 振替 M（保留になる）、机1: メモ（採用）、机2: 手置き講師だけ（置き換え）
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] }, statusSlots: [null, status('sD', 'absent')] }))
    week = mutateDesk(week, 1, (desk) => ({ ...desk, memoSlots: [null, '連絡'] }))
    week = mutateDesk(week, 2, (desk) => ({ ...desk, teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3', 'sD', '英')]
    const result = applyDiff({ week, newRows })
    expect(result.summary.pending).toBe(1)
    const once = remerge(result.nextWeeks, newRows, result.addedSuppressedRegularLessonOccurrences)
    const twice = remerge(once, newRows, result.addedSuppressedRegularLessonOccurrences)
    expect(byCellId(once)).toEqual(byCellId(result.nextWeeks))
    expect(byCellId(twice)).toEqual(byCellId(result.nextWeeks))
  })

  it('条件 21：残す机の旧テンプレ由来の管理授業（同じ行 id が新テンプレの別の机にある）も再マージで吸われない', () => {
    let week = buildWeek(OLD_ROWS)
    // 机1（旧テンプレ r1=B）に B の同日移動（印）を残し、新テンプレは r1 を別の生徒 D にして机0へ詰める
    week = mutateDesk(week, 1, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [entry('sB', { sameDayMoveSourceDate: DATE }), null] } }))
    const newRows = [row('r1', 't1', 'sD', '数'), row('r9', 't2')]
    const result = applyDiff({ week, newRows })
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sD'])
    expect(liveNames(deskOf(result.nextWeeks, 1))).toEqual(['sB'])
    const once = remerge(result.nextWeeks, newRows, [])
    expect(byCellId(once)).toEqual(byCellId(result.nextWeeks))
  })

  it('Q29：保留中の再保存。新しい上段が下段と同じ中身なら 1 行に戻り、テンプレ机に生徒がいなければ下段が机に戻る', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }))
    week = mutateDesk(week, 1, (desk) => ({ ...desk, lesson: { id: `${desk.id}_x`, studentSlots: [entry('sD', { manualAdded: true }), null] } }))
    const firstRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')]
    const first = applyDiff({ week, newRows: firstRows })
    expect(first.summary.pending).toBe(2)
    // 再保存: 机0 は講師だけ（上段が空 → 下段 M が机へ）・机1 は下段と同じ D（手置きの印は外れる）
    const secondRows = [row('r0', 't2'), row('r1', 't1', 'sD', '数')]
    const second = applyDiff({ week: first.nextWeeks[0], newRows: secondRows, pending: first.nextPendingDesks })
    expect(second.nextPendingDesks).toEqual({})
    expect(liveNames(deskOf(second.nextWeeks, 0))).toEqual(['sM'])
    expect(deskOf(second.nextWeeks, 0).teacher).toBe('鈴木')
    expect(liveNames(deskOf(second.nextWeeks, 1))).toEqual(['sD'])
    expect(deskOf(second.nextWeeks, 1).lesson?.studentSlots[0]?.manualAdded).toBeUndefined()
    expect(second.summary).toMatchObject({ kept: 1, adopted: 1, pending: 0 })
  })

  it('Q29：保留中の再保存で反映日より前の保留は触らない（Q1）', () => {
    const week = buildWeek(OLD_ROWS)
    const earlyCell = week.find((cell) => cell.dateKey < EFFECTIVE)!
    const key = buildTemplatePendingDeskKey(earlyCell.id, earlyCell.desks[0].id)
    const pending: TemplatePendingDeskMap = { [key]: { lower: { memoSlots: ['古い保留', null] }, effectiveStartDate: '2026-10-01', createdAt: 'old' } }
    const result = applyDiff({ week, newRows: OLD_ROWS, pending })
    expect(result.nextPendingDesks[key]).toBe(pending[key])
  })

  it('条件 25：確認文は 4 件数を出し、「すべてのデータが消去され」を出さない', () => {
    const message = buildTemplateDiffConfirmMessage(EFFECTIVE, { replaced: 3, kept: 2, adopted: 1, pending: 4, tombstoneCleared: 0, collapsedOnCreate: 0, qrTeacherKept: 0, deletedTeacherDeskFilled: 0, skippedDuplicateStudents: 0, seatMerged: 0, wholeDayTransferSkippedStudents: 0 })
    expect(message).toContain('3机を置き換え、4机が保留（緑）になります')
    expect(message).toContain('そのまま残す2机・印を外して採用1机')
    expect(message).not.toContain('すべてのデータが消去され')
  })

  it('条件 25：確認文の試し実行と保存本体は同じ入力で同じ件数になる（同じ関数）', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, memoSlots: ['連絡', null] }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')]
    expect(applyDiff({ week, newRows }).summary).toEqual(applyDiff({ week, newRows }).summary)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 席ごとの突き合わせ（オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄）
// 「生徒 1 と生徒 2 の重複は別々で処理して。そうすればテンプレ空白なら既存があれば自動で 1 行になるはず。
//   また片方が通常同士なのに 2 行になることもない。」
// ─────────────────────────────────────────────────────────────────────────────

describe('席ごとの突き合わせ（2026-09-30）', () => {
  const MAKEUP_M = () => entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
  // 机0: 旧テンプレの A（生徒 1・印なし）＋手で置いた振替 M（生徒 2）
  const weekWithMakeupInSeat2 = () => mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], MAKEUP_M()] } }))

  it('講師だけ交代（生徒 1 は同じ A・生徒 2 は空）→ 2 行にせず [A, M] の 1 行。確認文・保存後のメッセージに件数が出る', () => {
    const newRows = [row('r0', 't2', 'sA', '数'), row('r1', 't1', 'sB', '数')]
    const result = applyDiff({ week: weekWithMakeupInSeat2(), newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.teacher).toBe('鈴木')
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(isTemplateManagedLesson(desk0.lesson)).toBe(true)
    expect(result.nextPendingDesks).toEqual({})
    expect(result.summary).toMatchObject({ pending: 0, seatMerged: 1 })
    expect(buildTemplateDiffConfirmMessage(EFFECTIVE, result.summary)).toContain('テンプレの空いた席に既存の生徒を残して 1 行にする1机')
    expect(buildTemplateDiffSavedMessage(EFFECTIVE, result.summary)).toContain('テンプレの空いた席に既存の生徒を残して 1 行にした机: 1机')
    const once = remerge(result.nextWeeks, newRows, result.addedSuppressedRegularLessonOccurrences)
    expect(byCellId(once)).toEqual(byCellId(result.nextWeeks))
  })

  it('生徒 1 が別の生徒 C に替わる（生徒 2 は空）→ 生徒 1 は印が無いので C に置き換わり、生徒 2 の M は残る [C, M]', () => {
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')]
    const result = applyDiff({ week: weekWithMakeupInSeat2(), newRows })
    expect(deskOf(result.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sC', 'sM'])
    expect(result.nextPendingDesks).toEqual({})
    expect(countLiveInCell(result.nextWeeks, 'sA')).toBe(0)
  })

  it('テンプレが生徒 1・生徒 2 を両方埋める → ぶつかった生徒 2 の M だけが下段（生徒 1 の A は下段に入れない）', () => {
    const newRows = [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数')]
    const result = applyDiff({ week: weekWithMakeupInSeat2(), newRows })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveNames(desk0)).toEqual(['sA', 'sC'])
    const pending = result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)]
    expect(pending.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sM'])
    expect(result.summary.pending).toBe(1)
  })

  it('生徒 1 の席で振替がテンプレとぶつかったら、テンプレの生徒 2 の席が空いていてもずらさずに保留（席を勝手に動かさない）', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [MAKEUP_M(), null] } }))
    const result = applyDiff({ week, newRows: [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')] })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveNames(desk0)).toEqual(['sC'])
    expect(result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)].lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sM')
  })

  it('机に残す会計記録（欠席）の席を先に確保する: 空き席が記録の分しかなければ、生徒 2 の振替は 1 行に残さず下段へ（記録を上段の生徒の下に隠さない・INV-06）', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [null, MAKEUP_M()] }, statusSlots: [status('sA', 'absent'), null] }))
    const result = applyDiff({ week, newRows: [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')], suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)] })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveNames(desk0)).toEqual(['sC'])
    expect(desk0.statusSlots?.filter(Boolean).map((item) => item!.status)).toEqual(['absent'])
    expect(desk0.statusSlots?.[0]).toBeNull()
    expect(result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)].lower.lesson?.studentSlots[1]?.managedStudentId).toBe('sM')
  })

  it('L-1: 全員採用で 1 行にできても、会計を持つ記録が席に入らなければ 1 行にせず記録を下段へ（上段の生徒の下に隠さない）', () => {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [null, entry('sD', { manualAdded: true })] }, statusSlots: [status('sA', 'absent'), null] }))
    const result = applyDiff({ week, newRows: [row('r0', 't2', 'sC', '数', 'sD', '数'), row('r1', 't1', 'sB', '数')], suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)] })
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveNames(desk0)).toEqual(['sC', 'sD'])
    expect((desk0.statusSlots ?? []).filter(Boolean)).toEqual([])
    expect(result.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)].lower.statusSlots?.filter(Boolean).map((item) => [item!.managedStudentId, item!.status])).toEqual([['sA', 'absent']])
  })

  it('L-2 parity: shouldSeatSurviveRemerge は「管理授業の空いた席に置いて再マージしたら残るか」と一致する', () => {
    const cases: Array<[string, StudentEntry]> = [
      ['振替', entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })],
      ['講習', entry('sM', { lessonType: 'special', specialSessionId: 'ss1' })],
      ['体験', entry('sM', { lessonType: 'trial' })],
      ['増コマ', entry('sM', { lessonType: 'extra' })],
      ['手動追加の通常', entry('sM', { manualAdded: true })],
      ['同日移動の通常', entry('sM', { sameDayMoveSourceDate: DATE })],
      ['元の日付へ戻した通常', entry('sM', { makeupSourceDate: DATE })],
      ['別日移動の通常', entry('sM', { makeupSourceDate: '2026-09-30' })],
      ['印のない通常', entry('sM')],
    ]
    for (const [label, student] of cases) {
      const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], student] } }))
      const once = remerge([week], OLD_ROWS, [], settings())
      const survived = liveNames(deskOf(once, 0)).includes('sM')
      expect(survived, label).toBe(shouldSeatSurviveRemerge(student, DATE))
    }
    // 日付が無いときは、印のない・手動追加でない通常授業はすべて落ちる側（保守的）
    expect(shouldSeatSurviveRemerge(entry('sM', { sameDayMoveSourceDate: DATE }))).toBe(false)
  })

  it('Q29 再保存: 生徒 2 だけ保留の机で、新しいテンプレの生徒 2 が空になれば自動で 1 行 [A, M] に戻る', () => {
    const first = applyDiff({ week: weekWithMakeupInSeat2(), newRows: [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数')] })
    expect(first.summary.pending).toBe(1)
    const secondRows = [row('r0', 't2', 'sA', '数'), row('r1', 't1', 'sB', '数')]
    const second = applyDiff({ week: first.nextWeeks[0], newRows: secondRows, pending: first.nextPendingDesks })
    expect(second.nextPendingDesks).toEqual({})
    expect(deskOf(second.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(second.summary).toMatchObject({ pending: 0, seatMerged: 1 })
    const once = remerge(second.nextWeeks, secondRows, [])
    expect(byCellId(once)).toEqual(byCellId(second.nextWeeks))
  })

  it('Q29 再保存: テンプレ机が空になれば、上段に残していた既存の生徒と下段の生徒がどちらも机に残る（上段の既存を落とさない）', () => {
    // 机0: 振替 M（生徒 1）＋手動追加 D（生徒 2）。テンプレ C（生徒 1）→ M だけ下段、D は 1 行側に残る。
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [MAKEUP_M(), entry('sD', { manualAdded: true })] } }))
    const first = applyDiff({ week, newRows: [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数')] })
    const desk0 = deskOf(first.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sC', 'sD'])
    expect(first.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk0.id)].lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', null])
    const second = applyDiff({ week: first.nextWeeks[0], newRows: [row('r0', 't2'), row('r1', 't1', 'sB', '数')], pending: first.nextPendingDesks })
    expect(second.nextPendingDesks).toEqual({})
    expect(deskOf(second.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    expect(second.summary.kept).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// INV-06 拡張：保存前後で未消化振替が一致（条件 9・9-2）
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-06 拡張：テンプレ差分反映の保存前後で未消化振替の残数が一致する（条件 9・9-2）', () => {
  const TODAY = new Date('2026-10-01T00:00:00')
  const manualAdjustments: Record<string, ManualMakeupOrigin[]> = {
    'sM__数': [{ dateKey: '2026-09-30' }],
    'sD__数': [{ dateKey: '2026-09-23' }],
  }

  function balances(weeks: SlotCell[][], rows: RegularLessonRow[], templatePendingDesks?: TemplatePendingDeskMap) {
    const entries = buildMakeupStockEntries({
      students,
      teachers,
      regularLessons: rows,
      classroomSettings: newSettings(),
      weeks,
      manualAdjustments,
      resolveStudentKey: (student) => student.managedStudentId ?? student.name,
      today: TODAY,
      templatePendingDesks,
    })
    return Object.fromEntries(entries.map((item) => [item.key, item.balance]))
  }

  it('振替が下段に入り、振替コマの欠席記録が席不足で下段へあふれても、残数は保存前と同じ', () => {
    let week = buildWeek(OLD_ROWS)
    // 机0: 振替 M（配置済み＝消化）→ 新テンプレ C と食い違い保留（下段に M）
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }))
    // 机1: 振替 D を休み（absent・振替元から在庫を算出）→ 新テンプレは 2 人（B・C）で席不足 → 記録は下段へ
    week = mutateDesk(week, 1, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sD', 'absent', { lessonType: 'makeup', makeupSourceDate: '2026-09-16', makeupSourceLabel: '9/16(水) 5限' }), null] }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数', 'sA', '数')]
    const before = balances([week], newRows)
    const result = applyDiff({ week, newRows })
    const desk1Key = buildTemplatePendingDeskKey(CELL_ID, deskOf(result.nextWeeks, 1).id)
    // 席不足の退避（Q21-10）: 机1 は上段 2 人・欠席記録は下段へ
    expect(liveNames(deskOf(result.nextWeeks, 1))).toEqual(['sB', 'sA'])
    expect(deskOf(result.nextWeeks, 1).statusSlots).toBeUndefined()
    expect(result.nextPendingDesks[desk1Key].lower.statusSlots?.[0]?.status).toBe('absent')
    const after = balances(result.nextWeeks, newRows, result.nextPendingDesks)
    expect(after).toEqual(before)
    // 回帰防止: 下段を走査しないと、振替 M の消化が消えて残数が増え、欠席由来の D の在庫が消える
    const withoutLowerScan = balances(result.nextWeeks, newRows)
    expect(withoutLowerScan).not.toEqual(before)
  })

  it('机に残した欠席記録・同日移動の生徒がある机でも、残数は保存前と同じ', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sD', 'absent', { lessonType: 'makeup', makeupSourceDate: '2026-09-16', makeupSourceLabel: '9/16(水) 5限' }), null] }))
    week = mutateDesk(week, 2, (desk) => ({ ...desk, lesson: { id: 'daymove', studentSlots: [entry('sA', { sameDayMoveSourceDate: DATE }), null] } }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const before = balances([week], newRows)
    const result = applyDiff({ week, newRows, suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)] })
    expect(deskOf(result.nextWeeks, 0).statusSlots?.filter(Boolean)).toHaveLength(1)
    expect(balances(result.nextWeeks, newRows, result.nextPendingDesks)).toEqual(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 権威関数の一本化（regression-reviewer R-5）: 差分反映の突き合わせ相手（applied）と再マージの管理セル準備は同じ関数を通る
// ─────────────────────────────────────────────────────────────────────────────

describe('buildTemplateDiffTemplateCells と再マージの管理セル準備が同じ当て方をする（Q21-5・R-5）', () => {
  it('通常授業の抑止・盤面の振替コマ由来の抑止・丸ごと振替の日の足場講師 strip を当てた姿が、空の盤面を再マージした結果と一致する', () => {
    const THURSDAY = '2026-10-08'
    const FRIDAY_CELL = `2026-10-09_${SLOT}`
    let week = buildWeek(OLD_ROWS)
    // 金曜の机に B の振替（振替元＝水曜 5 限）→ 水曜 5 限の B は盤面の振替コマ由来で抑止される
    week = mutateDesk(week, 2, (desk) => ({ ...desk, lesson: { id: 'fri_makeup', studentSlots: [entry('sB', { lessonType: 'makeup', makeupSourceDate: DATE, makeupSourceLabel: '10/7(水) 5限' }), null] } }), FRIDAY_CELL)
    const suppressed = [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT), buildTemplateTeacherSuppressionKey(THURSDAY)]
    const rows = [...OLD_ROWS, row('r4', 't1', 'sC', '数', '', '', 4, SLOT), row('r5', 't2', '', '', '', '', 4, SLOT)]
    const templateCells = buildTemplateDiffTemplateCells({
      weeks: [week],
      classroomSettings: newSettings(),
      teachers,
      students,
      regularLessons: rows,
      effectiveStartDate: EFFECTIVE,
      suppressedRegularLessonOccurrences: suppressed,
    })
    // 盤面を「テンプレの管理セルだけ」（利用者の中身なし・金曜の振替だけ）にして再マージすると、管理セルの準備がそのまま出る。
    const remerged = remerge([week], rows, suppressed)
    const project = (cell: SlotCell) => cell.desks.map((desk) => ({ teacher: desk.teacher, students: liveNames(desk) }))
    const checked = templateCells.filter((item) => item.applied.id !== FRIDAY_CELL)
    expect(checked.length).toBeGreaterThan(0)
    for (const item of checked) {
      expect(project(item.applied)).toEqual(project(cellOf(remerged, item.applied.id)))
    }
    // 抑止が実際に効いている（A・B は水曜 5 限の applied に居ない／木曜の講師だけの机は足場講師が外れる）
    const wednesday = templateCells.find((item) => item.applied.id === CELL_ID)!
    expect(wednesday.raw.desks.flatMap(liveNames)).toEqual(['sA', 'sB'])
    expect(wednesday.applied.desks.flatMap(liveNames)).toEqual([])
    const thursday = templateCells.find((item) => item.applied.id === `${THURSDAY}_${SLOT}`)!
    expect(thursday.applied.desks.map((desk) => desk.teacher)).toEqual(['田中', '', ''])
    expect(thursday.raw.desks.map((desk) => desk.teacher)).toEqual(['田中', '鈴木', ''])
    // 共通関数の出力そのもの（再マージもこれを通す）と一致する
    const shared = buildAppliedManagedPostFreezeCells(week, { classroomSettings: newSettings(), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, freezeDate: EFFECTIVE })
    expect(templateCells.map((item) => item.applied)).toEqual(shared.managedCells.map((item) => item.applied))
    expect(templateCells.map((item) => item.raw)).toEqual(shared.managedCells.map((item) => item.raw))
  })

  it('配線: 差分反映と再マージは共通関数を呼び、抑止・strip を手で写さない', () => {
    const board = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
    const slice = (start: string, length: number) => {
      const index = board.indexOf(start)
      expect(index).toBeGreaterThanOrEqual(0)
      return board.slice(index, index + length)
    }
    const templateCellsFn = slice('export function buildTemplateDiffTemplateCells(', 1400)
    expect(templateCellsFn).toContain('buildAppliedManagedPostFreezeCells(week, { ...params, freezeDate: params.effectiveStartDate })')
    for (const copied of ['suppressManagedStudentsInCell(', 'stripTemplateScaffoldTeachers(', 'buildSuppressedManagedOccurrenceKeys(', 'createBoardWeek(']) {
      expect(templateCellsFn).not.toContain(copied)
    }
    const remergeFn = slice('export function remergeBoardWeekWithManagedData(', 1800)
    expect(remergeFn).toContain('buildAppliedManagedPostFreezeCells(week, { ...params, freezeDate })')
    expect(remergeFn).not.toContain('createBoardWeek(')
  })

  // regression-reviewer L-7（2026-09-30）: Q21-11 で生徒を全員外した机と、再マージで全員抑止された管理授業の机は同じ関数で作る
  // （手で写すと講師の割り当て情報の外し方がずれ、保存結果が再マージの不動点でなくなる）。
  it('配線: 全員抑止の机の形は再マージ（suppressManagedStudentsInCell）と Q21-11（filterTemplateDeskStudents）で同じ関数を呼ぶ（L-7）', () => {
    const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const sliceOf = (source: string, start: string, length: number) => {
      const index = source.indexOf(start)
      expect(index).toBeGreaterThanOrEqual(0)
      return source.slice(index, index + length)
    }
    const suppressFn = sliceOf(read('./ScheduleBoardScreen.tsx'), 'function suppressManagedStudentsInCell(', 1000)
    expect(suppressFn).toContain('return buildFullySuppressedManagedDesk(desk)')
    expect(suppressFn).not.toContain('teacherAssignmentTeacherId: undefined')
    const filterFn = sliceOf(read('./templateDiffApply.ts'), 'function filterTemplateDeskStudents(', 1400)
    expect(filterFn).toContain('buildFullySuppressedManagedDesk(desk)')
    expect(filterFn).not.toContain('teacherAssignmentTeacherId: undefined')
    // 兄弟 1: 丸ごと振替の日の足場講師 strip も机 1 つ分の形を共有し、Q21-11 は再マージと同じ順（抑止 → strip）で当てる。
    expect(filterFn).toContain('stripTemplateScaffoldTeacherDesk(suppressed)')
    const stripFn = sliceOf(read('./ScheduleBoardScreen.tsx'), 'function stripTemplateScaffoldTeachers(', 400)
    expect(stripFn).toContain('cell.desks.map(stripTemplateScaffoldTeacherDesk)')
    expect(stripFn).not.toContain("teacher: ''")
  })

  // L-7 兄弟 2（2026-09-30）: 講師だけの机の置き直し（同名は足さない → 先頭の空き机）は机をまたぐ再マージの計算なので差分反映に写さず、
  // 保存結果の反映日以降へ再マージの重ね合わせそのものを保存と同じ抑止で 1 回当てる。
  it('配線: 差分反映の入口は保存結果の反映日以降へ再マージの重ね合わせを保存と同じ抑止で当てる（L-7 兄弟 2）', () => {
    const board = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const sliceOf = (start: string, length: number) => {
      const index = board.indexOf(start)
      expect(index).toBeGreaterThanOrEqual(0)
      return board.slice(index, index + length)
    }
    const entryFn = sliceOf('export function computeTemplateDiffApplyForBoard(', 2600)
    expect(entryFn).toContain('[...params.suppressedRegularLessonOccurrences, ...diff.addedSuppressedRegularLessonOccurrences]')
    expect(entryFn).toContain('settleTemplateDiffWeekWithRemerge(week, { ...params, suppressedRegularLessonOccurrences: settledSuppressed })')
    const settleFn = sliceOf('function settleTemplateDiffWeekWithRemerge(', 1400)
    expect(settleFn).toContain('buildAppliedManagedPostFreezeCells(week, { ...params, freezeDate: params.effectiveStartDate })')
    expect(settleFn).toContain('overlayPreparedManagedCells(managedCells, [postFreezeBoard])')
    expect(settleFn).toContain('cell.dateKey < params.effectiveStartDate ? cell')
    expect(settleFn).not.toContain('mergeManagedWeek(')
  })

  // 入口の再マージ当て（上の配線）が無くても、差分反映の本体（純関数）だけで丸ごと振替の日の机が再マージと同じ形になること（二重の守り）。
  // Q35（2026-10-02）: 丸ごと振替の日はテンプレの生徒を置かないので、B は Q21-11（重複）ではなく Q35 で外れる。机の形（抑止 → strip）は同じ。
  it('純関数: 丸ごと振替の日に生徒を全員外した机は、差分反映の本体だけで足場講師も外れる（抑止 → strip の順・L-7 兄弟 1・Q35）', () => {
    const suppressed = [buildTemplateTeacherSuppressionKey(DATE)]
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], entry('sB', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] } }))
    const templateCells = buildTemplateDiffTemplateCells({
      weeks: [week], classroomSettings: newSettings(), teachers, students, regularLessons: OLD_ROWS, effectiveStartDate: EFFECTIVE, suppressedRegularLessonOccurrences: suppressed,
    })
    expect(templateCells.find((entry) => entry.applied.id === CELL_ID)?.scaffoldTeachersStripped).toBe(true)
    const result = computeTemplateDiffApply({ weeks: [week], templateCells, effectiveStartDate: EFFECTIVE, suppressedRegularLessonOccurrences: suppressed, pendingDesks: {}, createdAt: '2026-09-29T10:00:00.000Z' })
    expect(result.summary.skippedDuplicateStudents).toBe(0)
    expect(result.summary.wholeDayTransferSkippedStudents).toBe(2)
    expect(deskOf(result.nextWeeks, 1)).toMatchObject({ teacher: '', manualTeacher: false })
    expect(deskOf(result.nextWeeks, 1).lesson).toBeUndefined()
    expect(deskOf(result.nextWeeks, 1).teacherAssignmentTeacherId).toBeUndefined()
  })

  it('足場講師 strip の机の形: 授業のある机はそのまま、授業のない机は講師名と割り当て情報を外し、記録・メモは残す（L-7 兄弟 1）', () => {
    const lessonDesk: DeskCell = { id: 'd0', teacher: '田中', teacherAssignmentTeacherId: 't1', lesson: { id: 'managed_r0', studentSlots: [entry('sA'), null] } }
    expect(stripTemplateScaffoldTeacherDesk(lessonDesk)).toBe(lessonDesk)
    const teacherOnly: DeskCell = { id: 'd1', teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't2', memoSlots: ['連絡あり', null] }
    expect(stripTemplateScaffoldTeacherDesk(teacherOnly)).toEqual({ id: 'd1', teacher: '', manualTeacher: false, memoSlots: ['連絡あり', null] })
  })

  it('全員抑止の机の形: 講師名と机の記録は残し、授業と講師の割り当て情報（手置きの印・由来・講習期間 ID・講師 ID）を外す（L-7）', () => {
    const desk: DeskCell = {
      id: 'd1',
      teacher: '鈴木',
      manualTeacher: true,
      teacherAssignmentSource: 'manual',
      teacherAssignmentSessionId: 'session-1',
      teacherAssignmentTeacherId: 't2',
      memoSlots: ['連絡あり', null],
      lesson: { id: 'managed_r1', studentSlots: [entry('sB'), null] },
    }
    expect(buildFullySuppressedManagedDesk(desk)).toEqual({ id: 'd1', teacher: '鈴木', manualTeacher: false, memoSlots: ['連絡あり', null] })
    expect(desk.teacherAssignmentTeacherId).toBe('t2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q35：丸ごと振替した日はテンプレの生徒を置かず振替を優先（オーナー指示 2026-10-02・確認リスト v1.5.573 tp-22 要改善
// 「生徒を変えたときも丸ごと振替した日は重複とせず、振替を優先として。テンプレの生徒を変えなかったときとテンプレの生徒を変えたときが
//   丸ごと振替先では同じ扱いがいい」）
// ─────────────────────────────────────────────────────────────────────────────

describe('Q35: 丸ごと振替した日（日単位抑止のある日）はテンプレの生徒を置かない', () => {
  const SOURCE_DATE = '2026-10-05'
  // 丸ごと振替（computeWholeDayTransfer）の後の振替先の姿: 旧テンプレの A・B は row-scan の抑止キーで消え、日単位抑止があり、
  // 移送された机ブロック（講師は manual 固定・生徒は振替）が机 0 に居る。机 0 の生徒 2 には別の机のテンプレの生徒 B の振替を手で置く（tp-21/22 の形）。
  const wholeDaySuppressed = [
    buildManagedOccurrenceKey(entry('sA'), DATE, SLOT),
    buildManagedOccurrenceKey(entry('sB'), DATE, SLOT),
    buildTemplateTeacherSuppressionKey(DATE),
  ]
  function transferredWeek() {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({
      id: desk.id,
      teacher: '田中',
      manualTeacher: true,
      teacherAssignmentSource: 'manual',
      lesson: { id: `${desk.id}_moved`, studentSlots: [entry('sA', { lessonType: 'makeup', makeupSourceDate: SOURCE_DATE }), entry('sB', { lessonType: 'makeup', makeupSourceDate: SOURCE_DATE })] },
    }))
    week = mutateDesk(week, 1, (desk) => ({ id: desk.id, teacher: '' }))
    week = mutateDesk(week, 2, (desk) => ({ id: desk.id, teacher: '' }))
    return week
  }
  // 新テンプレ: 机 0 の生徒を A → D（新しい生徒＝抑止キーが無い）に替える。講師は変えない。
  const CHANGED_ROWS = [row('r0', 't1', 'sD', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]

  it('テンプレの生徒を変えても（D）、丸ごと振替した日には D を置かず、振替の机は 1 行のまま（保留にならない）。D の抑止キーを積み、保存 → 再マージの不動点', () => {
    const week = transferredWeek()
    const result = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: wholeDaySuppressed })
    expect(result.summary.pending).toBe(0)
    expect(result.summary.wholeDayTransferSkippedStudents).toBe(1)
    expect(result.summary.skippedDuplicateStudents).toBe(0)
    expect(Object.keys(result.nextPendingDesks)).toEqual([])
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sB'])
    expect(deskOf(result.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.lessonType)).toEqual(['makeup', 'makeup'])
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('田中')
    expect(countLiveInCell(result.nextWeeks, 'sD')).toBe(0)
    // 生徒のいない机に講師が出ない（丸ごと振替の日の足場講師 strip・tp-22）
    expect(deskOf(result.nextWeeks, 1).teacher).toBe('')
    expect(deskOf(result.nextWeeks, 2).teacher).toBe('')
    expect(result.addedSuppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(entry('sD'), DATE, SLOT)])
    const suppressedAfter = [...wholeDaySuppressed, ...result.addedSuppressedRegularLessonOccurrences]
    const once = remerge(result.nextWeeks, CHANGED_ROWS, suppressedAfter)
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(countLiveInCell(once, 'sD')).toBe(0)
    expect(buildTemplateDiffConfirmMessage(EFFECTIVE, result.summary)).toContain('丸ごと振替した日はテンプレの生徒を置かず振替を優先1名')
    expect(buildTemplateDiffSavedMessage(EFFECTIVE, result.summary)).toContain('丸ごと振替した日のためテンプレの生徒を置かず振替を優先した生徒: 1名')
  })

  it('テンプレの生徒を変えなかったとき（A・B は抑止で元から居ない）と、変えたとき（D）で、丸ごと振替した日の机の形は同じ', () => {
    const week = transferredWeek()
    const unchanged = applyDiff({ week, newRows: OLD_ROWS, suppressed: wholeDaySuppressed })
    const changed = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: wholeDaySuppressed })
    expect(unchanged.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(unchanged.summary.pending).toBe(0)
    expect(cellOf(changed.nextWeeks)).toEqual(cellOf(unchanged.nextWeeks))
    expect(changed.nextPendingDesks).toEqual(unchanged.nextPendingDesks)
    expect(buildTemplateDiffConfirmMessage(EFFECTIVE, unchanged.summary)).not.toContain('丸ごと振替した日')
  })

  it('講師だけを替えた保存（tp-22 の操作）: 丸ごと振替した日の振替の机は 1 行のまま・置かなかった生徒は 0 名・生徒のいない机に講師が出ない', () => {
    const week = transferredWeek()
    const teacherChanged = [row('r0', 't2', 'sA', '数'), row('r1', 't3', 'sB', '数'), row('r2', 't1')]
    const result = applyDiff({ week, newRows: teacherChanged, suppressed: wholeDaySuppressed })
    expect(result.summary.pending).toBe(0)
    expect(result.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sB'])
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('田中')
    expect(deskOf(result.nextWeeks, 1).teacher).toBe('')
    expect(deskOf(result.nextWeeks, 2).teacher).toBe('')
    const once = remerge(result.nextWeeks, teacherChanged, [...wholeDaySuppressed, ...result.addedSuppressedRegularLessonOccurrences])
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
  })

  it('丸ごと振替していない日（日単位抑止なし）は従来どおり: 変えた生徒 D はテンプレの席に置かれ、ぶつかった振替は保留の下段へ（Q35 は丸ごと振替の日だけ）', () => {
    const week = transferredWeek()
    const normalDaySuppressed = [buildManagedOccurrenceKey(entry('sA'), DATE, SLOT), buildManagedOccurrenceKey(entry('sB'), DATE, SLOT)]
    const result = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: normalDaySuppressed })
    expect(result.summary.wholeDayTransferSkippedStudents).toBe(0)
    expect(result.summary.pending).toBe(1)
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sD', 'sB'])
    const pendingKey = buildTemplatePendingDeskKey(CELL_ID, deskOf(result.nextWeeks, 0).id)
    expect(result.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', null])
  })

  // regression-reviewer 中-1（2026-10-02）: v1.5.573〜575 の差分反映は、丸ごと振替の日にテンプレの生徒を変えると移送された手置きの講師を
  // テンプレの講師（manual でない）に置き換えていた。その机を Q35 で再保存しても講師は残る（再マージも名前を残す＝不動点・INV-01 / INV-02）。
  it('振替の机の講師が manual でない（v1.5.575 までの保存で置き換わった）ままでも、Q35 の保存で講師は残る（保存 → 再マージの不動点）', () => {
    let week = transferredWeek()
    week = mutateDesk(week, 0, (desk) => ({ ...desk, manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentTeacherId: 't1' }))
    const result = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: wholeDaySuppressed })
    expect(result.summary.pending).toBe(0)
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sB'])
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('田中')
    const once = remerge(result.nextWeeks, CHANGED_ROWS, [...wholeDaySuppressed, ...result.addedSuppressedRegularLessonOccurrences])
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(deskOf(once, 0).teacher).toBe('田中')
  })

  it('v1.5.575 までに作られた保留の机（上段 D・B振／下段 A振・講師はテンプレの講師）を丸ごと振替の日に再保存すると、1 行 [A振, B振] に戻り講師が残る。D は 0 か所・再マージで不変', () => {
    let week = transferredWeek()
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      manualTeacher: false,
      teacherAssignmentSource: undefined,
      teacherAssignmentTeacherId: 't1',
      lesson: { id: 'managed_r0_x', note: '管理データ反映', studentSlots: [entry('sD'), entry('sB', { lessonType: 'makeup', makeupSourceDate: SOURCE_DATE })] },
    }))
    const pendingKey = buildTemplatePendingDeskKey(CELL_ID, deskOf([week], 0).id)
    const pending: TemplatePendingDeskMap = {
      [pendingKey]: {
        lower: { lesson: { id: `${deskOf([week], 0).id}_moved`, studentSlots: [entry('sA', { lessonType: 'makeup', makeupSourceDate: SOURCE_DATE }), null] } },
        effectiveStartDate: EFFECTIVE,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    }
    const suppressed = [...wholeDaySuppressed, buildManagedOccurrenceKey(entry('sD'), DATE, SLOT)]
    const result = applyDiff({ week, newRows: CHANGED_ROWS, suppressed, pending })
    expect(result.summary.pending).toBe(0)
    expect(Object.keys(result.nextPendingDesks)).toEqual([])
    expect(liveNames(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sB'])
    expect(deskOf(result.nextWeeks, 0).teacher).toBe('田中')
    expect(countLiveInCell(result.nextWeeks, 'sD')).toBe(0)
    const once = remerge(result.nextWeeks, CHANGED_ROWS, [...suppressed, ...result.addedSuppressedRegularLessonOccurrences])
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(countLiveInCell(once, 'sD')).toBe(0)
  })

  it('同じテンプレで 2 回保存しても丸ごと振替の日の机は変わらず、抑止キーも増えない（INV-03）', () => {
    const week = transferredWeek()
    const first = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: wholeDaySuppressed })
    const suppressedAfter = [...wholeDaySuppressed, ...first.addedSuppressedRegularLessonOccurrences]
    const second = applyDiff({ week: first.nextWeeks[0], newRows: CHANGED_ROWS, suppressed: suppressedAfter, pending: first.nextPendingDesks })
    expect(cellOf(second.nextWeeks)).toEqual(cellOf(first.nextWeeks))
    expect(second.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(second.summary.wholeDayTransferSkippedStudents).toBe(0)
  })

  // regression-reviewer 中-2 / 中-3（2026-10-02・オーナー判断待ち）: Q35 で置かなかった生徒の希望回数（旧方式の予定数はテンプレを数えるので
  // 実績より 1 多くなる。盤面ベースの予定数は開発用教室だけ）と、振替元の日を後で休日にしたときの自動 origin（抑止キーを見ない）の扱い。
  it.todo('INV-05: Q35 で置かなかった生徒の予定数（旧方式）と実績の差をどう扱うか（−1 を積む／盤面ベースの予定数を全教室へ）をオーナー判断で固定する')
  it.todo('INV-06: 丸ごと振替 → 振替元の日を後で休日にしたとき、Q35 で置かなかった生徒に自動 origin（振替在庫）が生まれる挙動をオーナー判断で固定する')

  it('丸ごと振替した日の置き換え（印なし・空の机）にも D を置かない（振替元の日＝空のまま残す）', () => {
    const week = mutateDesk(mutateDesk(mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ id: desk.id, teacher: '' })), 1, (desk) => ({ id: desk.id, teacher: '' })), 2, (desk) => ({ id: desk.id, teacher: '' }))
    const result = applyDiff({ week, newRows: CHANGED_ROWS, suppressed: wholeDaySuppressed })
    expect(result.summary.wholeDayTransferSkippedStudents).toBe(1)
    expect(result.summary.replaced).toBe(0)
    expect(cellOf(result.nextWeeks).desks.every((desk) => !desk.lesson && desk.teacher === '')).toBe(true)
    const once = remerge(result.nextWeeks, CHANGED_ROWS, [...wholeDaySuppressed, ...result.addedSuppressedRegularLessonOccurrences])
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
  })
})
