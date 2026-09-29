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
  buildTemplateDiffConfirmMessage,
  buildTemplateDiffSavedMessage,
  buildTemplateOccurrenceKey,
  computePendingDeskCollapse,
  isTemplateDeskStudentContentEqual,
  isTemplateDiffTeacherTombstone,
  isTemplateManagedLesson,
  resolveAdoptExistingCountAdjustments,
  resolveDeskManualInputMark,
  resolveTemplateDeskTeacher,
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
    const message = buildTemplateDiffConfirmMessage(EFFECTIVE, { replaced: 3, kept: 2, adopted: 1, pending: 4, tombstoneCleared: 0, collapsedOnCreate: 0, qrTeacherKept: 0, deletedTeacherDeskFilled: 0, skippedDuplicateStudents: 0 })
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
})
