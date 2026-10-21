// テンプレ保存の**授業の会計監査**（2026-10-21・テスト教室の確認 tp-48/tp-51 の再発防止）。
//
// 背景: テンプレの差分反映は「テンプレの生徒を置かない／別の形にする」判定を 5 系統持つ（Q21-11・Q35・Q40-1・Q40-2・Q40-3）。
// 各系統は単体で仕様どおりでも、組み合わせ（同じ科目を同じ曜日に 2 コマ持つ生徒／時限変更→科目変更の順の保存）で
// **授業が痕跡なく消える**形があった（置かず・未消化にせず・−1 もしない）。件数ベースのテストは仕様の形しか見ないので素通りする。
//
// この監査は**仕様の形に依らない保存則**を 1 つだけ見る:
//   反映日以降の開校日の、新テンプレの各「生徒×科目×日付」の授業数（期待）は、保存後の次の合計（説明）以上でなければならない。
//     (a) その日に生きている同じ生徒×科目の通常授業（上段・保留の下段）
//     (b) その日を振替元とする振替（丸ごと振替・Q40-2 で移送した分）
//     (c) 在庫の正本がその日に持つ有効な origin（台帳・休日の自動発生・振替を休んだ記録）
//     (d) その日の希望回数 −1（scheduleCountAdjustments の regular）
//     (e) その日に同じコマで生きている同じ生徒の別種の授業（振替・講習・手動追加＝Q21-11 が置かない正当な理由）
//     (f) その日のその生徒×科目の出欠記録（出席・休み・休日。移動元記録 moved は会計を持たないので数えない）
//   説明 < 期待 なら「無言の消失」＝違反（kind='missing'）として返す。説明 > 期待 は違反にしない（消さない側に倒す M-3 は許容）。
//   加えて、盤面の振替（手動追加でない・管理生徒 ID あり・振替元が範囲内）は、振替元の日にその生徒×科目の根拠（新テンプレの授業・在庫の正本の origin・
//   出欠記録）が無ければ「根拠の無い振替」＝違反（kind='surplus-makeup'。tp-51 で旧科目の振替が消えずに残った形）。
//
// 純関数。テストの **シーケンス監査**（保存を 1 手ずつ重ねて毎手この監査と冪等性を見る）と、将来は保存前の自己点検（開発用教室）にも使える。
import type { ClassroomSettings, ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SlotCell, StudentEntry } from './types'
import { collectMakeupOriginDatesByKey, isClosedDate, originTokenDateKey, type ManualMakeupOrigin } from './makeupStock'
import { resolveDayOfWeekFromDateKey } from './templateDefinitionDiff'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

export type LessonAccountingViolation = {
  kind: 'missing' | 'surplus-makeup'
  studentId: string
  subject: string
  dateKey: string
  expected: number
  explained: number
  /** 説明の内訳（どこで数えたか）。 */
  breakdown: { regular: number; makeupFromDate: number; origin: number; countAdjusted: number; otherLessonSameSlot: number; statusRecord: number }
}

export type LessonAccountingAuditParams = {
  weeks: SlotCell[][]
  regularLessons: readonly RegularLessonRow[]
  students: StudentRow[]
  classroomSettings: ClassroomSettings
  scheduleCountAdjustments: readonly ScheduleCountAdjustmentEntry[]
  manualMakeupAdjustments: Record<string, ManualMakeupOrigin[]>
  suppressedMakeupOrigins?: Record<string, ManualMakeupOrigin[]>
  templatePendingDesks?: TemplatePendingDeskMap | null
  /** 監査する日付の範囲（反映日〜盤面の最終日など）。 */
  fromDate: string
  toDate: string
  today?: Date
}

const key3 = (studentId: string, subject: string, dateKey: string) => `${studentId}__${subject}__${dateKey}`

function rowInEffect(row: RegularLessonRow, seat: 1 | 2, dateKey: string) {
  const start = seat === 1 ? row.startDate : (row.student2StartDate || row.startDate)
  const end = seat === 1 ? row.endDate : (row.student2EndDate || row.endDate)
  if (start && dateKey < start) return false
  if (end && dateKey > end) return false
  return true
}

/** 新テンプレの期待: 生徒×科目×日付 → 授業数、と 生徒×科目×日付×時限 の集合。 */
export function collectExpectedTemplateLessons(params: Pick<LessonAccountingAuditParams, 'weeks' | 'regularLessons' | 'classroomSettings' | 'fromDate' | 'toDate'>) {
  const expected = new Map<string, number>()
  const slotsByKey = new Map<string, Set<number>>()
  const dates = new Set<string>()
  for (const week of params.weeks) for (const cell of week) if (cell.dateKey >= params.fromDate && cell.dateKey <= params.toDate && cell.isOpenDay) dates.add(cell.dateKey)
  for (const dateKey of dates) {
    if (isClosedDate(dateKey, params.classroomSettings)) continue
    const dayOfWeek = resolveDayOfWeekFromDateKey(dateKey)
    for (const row of params.regularLessons) {
      if (row.dayOfWeek !== dayOfWeek) continue
      for (const [seat, studentId, subject] of [[1, row.student1Id, row.subject1], [2, row.student2Id, row.subject2]] as const) {
        if (!studentId || !subject || !rowInEffect(row, seat, dateKey)) continue
        const key = key3(studentId, subject, dateKey)
        expected.set(key, (expected.get(key) ?? 0) + 1)
        slotsByKey.set(key, (slotsByKey.get(key) ?? new Set<number>()).add(row.slotNumber))
      }
    }
  }
  return { expected, slotsByKey }
}

function identityOf(student: Pick<StudentEntry, 'managedStudentId' | 'name'>) {
  return student.managedStudentId ?? student.name
}

/**
 * 保存後の盤面・台帳・補正を突き合わせ、説明 < 期待 の生徒×科目×日付を返す（空なら保存則を満たす）。
 */
export function auditTemplateLessonAccounting(params: LessonAccountingAuditParams): LessonAccountingViolation[] {
  const { expected, slotsByKey } = collectExpectedTemplateLessons(params)
  if (expected.size === 0) return []
  const resolveStudentKey = (student: StudentEntry) => identityOf(student)
  const originDatesByKey = collectMakeupOriginDatesByKey({
    students: params.students, regularLessons: [...params.regularLessons], classroomSettings: params.classroomSettings, weeks: params.weeks,
    manualAdjustments: params.manualMakeupAdjustments, suppressedOrigins: params.suppressedMakeupOrigins ?? {}, resolveStudentKey,
    today: params.today ?? new Date(`${params.fromDate}T00:00:00`), includeAbsentMakeupOrigins: true, templatePendingDesks: params.templatePendingDesks,
  })
  const regular = new Map<string, number>()
  const makeupFromDate = new Map<string, number>()
  const statusRecord = new Map<string, number>()
  /** 生徒（科目を問わず）×日付×時限 → その生徒の通常授業以外の生きている授業数（Q21-11 の正当な理由）。 */
  const otherLessonBySlot = new Map<string, number>()
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  const scanStudent = (student: StudentEntry, cell: SlotCell) => {
    const id = identityOf(student)
    if (student.lessonType === 'regular') bump(regular, key3(id, student.subject, cell.dateKey))
    else bump(otherLessonBySlot, `${id}__${cell.dateKey}__${cell.slotNumber}`)
    if (student.lessonType === 'makeup' && student.makeupSourceDate) bump(makeupFromDate, key3(id, student.subject, student.makeupSourceDate))
  }
  for (const week of params.weeks) for (const cell of week) {
    if (cell.dateKey < params.fromDate || cell.dateKey > params.toDate) continue
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) if (student) scanStudent(student, cell)
      // 移動元記録（moved）は会計を持たない（INV-06・会計は移動先の振替が持つ）ので説明に数えない。休日・出欠の記録だけ数える。
      for (const entry of desk.statusSlots ?? []) if (entry && entry.status !== 'moved') bump(statusRecord, key3(identityOf(entry), entry.subject, cell.dateKey))
      const pending = params.templatePendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]
      for (const student of pending?.lower.lesson?.studentSlots ?? []) if (student) scanStudent(student, cell)
    }
  }
  const countAdjusted = new Map<string, number>()
  for (const entry of params.scheduleCountAdjustments) {
    if (entry.countKind !== 'regular' || entry.delta >= 0) continue
    const key = key3(entry.studentKey, entry.subject, entry.dateKey)
    countAdjusted.set(key, (countAdjusted.get(key) ?? 0) + Math.abs(entry.delta))
  }
  const violations: LessonAccountingViolation[] = []
  for (const [key, want] of expected) {
    const [studentId, subject, dateKey] = key.split('__')
    const origins = (originDatesByKey[`${studentId}__${subject}`] ?? []).filter((token) => originTokenDateKey(token) === dateKey).length
    let otherLessonSameSlot = 0
    for (const slotNumber of slotsByKey.get(key) ?? []) otherLessonSameSlot += otherLessonBySlot.get(`${studentId}__${dateKey}__${slotNumber}`) ?? 0
    const breakdown = {
      regular: regular.get(key) ?? 0,
      makeupFromDate: makeupFromDate.get(key) ?? 0,
      origin: origins,
      countAdjusted: countAdjusted.get(key) ?? 0,
      otherLessonSameSlot,
      statusRecord: statusRecord.get(key) ?? 0,
    }
    const explained = breakdown.regular + breakdown.makeupFromDate + breakdown.origin + breakdown.countAdjusted + breakdown.otherLessonSameSlot + breakdown.statusRecord
    if (explained < want) violations.push({ kind: 'missing', studentId, subject, dateKey, expected: want, explained, breakdown })
  }
  // 根拠の無い振替（Q40-1 の定義と同じ: 振替元の日に 新テンプレの授業・在庫の正本の origin・出欠記録 のどれも無い）。
  const seenSurplus = new Set<string>()
  for (const week of params.weeks) for (const cell of week) {
    if (cell.dateKey < params.fromDate || cell.dateKey > params.toDate) continue
    for (const desk of cell.desks) for (const student of desk.lesson?.studentSlots ?? []) {
      if (!student || student.lessonType !== 'makeup' || student.manualAdded || !student.managedStudentId || !student.makeupSourceDate) continue
      const sourceDateKey = student.makeupSourceDate
      if (sourceDateKey < params.fromDate || sourceDateKey > params.toDate) continue
      const key = key3(student.managedStudentId, student.subject, sourceDateKey)
      if (seenSurplus.has(key)) continue
      const origins = (originDatesByKey[`${student.managedStudentId}__${student.subject}`] ?? []).filter((token) => originTokenDateKey(token) === sourceDateKey).length
      const breakdown = { regular: regular.get(key) ?? 0, makeupFromDate: makeupFromDate.get(key) ?? 0, origin: origins, countAdjusted: countAdjusted.get(key) ?? 0, otherLessonSameSlot: 0, statusRecord: statusRecord.get(key) ?? 0 }
      const want = expected.get(key) ?? 0
      if (want > 0 || origins > 0 || breakdown.statusRecord > 0) continue
      seenSurplus.add(key)
      violations.push({ kind: 'surplus-makeup', studentId: student.managedStudentId, subject: student.subject, dateKey: sourceDateKey, expected: want, explained: breakdown.makeupFromDate, breakdown })
    }
  }
  return violations
}

/** 違反を 1 行ずつの文にする（テストの失敗メッセージ用）。 */
export function describeLessonAccountingViolations(violations: readonly LessonAccountingViolation[]) {
  return violations.map((item) => `${item.kind === 'missing' ? '無言の消失' : '根拠の無い振替'} ${item.dateKey} ${item.studentId}×${item.subject}: 期待 ${item.expected} に対し説明 ${item.explained}（${JSON.stringify(item.breakdown)}）`).join('\n')
}
