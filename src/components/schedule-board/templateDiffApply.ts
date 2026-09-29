// テンプレ保存の「差分反映＋保留（2 行表示）」の純関数群（Issue #72・docs/spec-template-behavior.md §H Q21〜Q33）。
//
// ★機能フラグ templateDiffApply（development-only＝開発用教室だけ）が ON の教室のテンプレ保存だけがこれを通る。
//   フラグ OFF の教室（本番 3 教室を含む）は handleSaveRegularLessonTemplate の旧方式（上書き）のまま。
// ★保存本体と保存前の確認文（件数の試し実行）は**同じ関数・同じ入力**を使う（Q32-1。表示と結果を食い違わせない）。
// ★結果は盤面の再マージ（remergeBoardWeeksWithManagedData → overlayBoardWeeksOnScheduleCells / mergeManagedWeek）の
//   **不動点**でなければならない（Q31・INV-02/INV-03）。保存直後に教室設定・通常授業の変更 effect が再マージを走らせるため、
//   不動点でないと保存した瞬間に結果が書き換わる。そのための約束:
//     - 上段（テンプレの生徒）は、テンプレの管理授業（id=`managed_…`）を**席の位置ごと**そのまま置く
//       （再マージは管理授業の席の位置に生徒を戻すため。会計記録を元の席に残すと重なる席は、記録の方を空いた席へ移す）。
//     - 残す机に旧テンプレ由来の管理授業（`managed_…` / note='管理データ反映'）が居れば、机固有の id に付け替えて
//       管理授業でなくす（新テンプレの同じ行 id と突き合って別の机の授業に吸われる・落ちる経路を断つ）。
//     - 同じコマの別の 1 行の机に生きている生徒をテンプレから外すとき（Q21-11）は、通常授業の抑止キーを足す
//       （足さないと再マージがテンプレどおり置き直して二重配置になる）。
// ★講師は比べない・テンプレ机に講師がいればその講師に揃える（Q21-9）。例外 1＝QR 自動割振り講師、例外 2＝講師の削除記録。
// ★在庫台帳（manualMakeupAdjustments / manualLectureStockCounts 等）・希望回数補正・抑止は**この関数では触らない**
//   （Q7〜Q10 改定・INV-06 拡張「テンプレ保存そのものでは在庫が増減しない」）。Q21-11 の抑止キーの追加だけを返す。

import type { DeskCell, DeskLesson, LessonType, SlotCell, StudentEntry, StudentStatusEntry, StudentStatusKind } from './types'
import {
  buildTemplatePendingDeskKey,
  cloneTemplatePendingLower,
  type TemplatePendingDesk,
  type TemplatePendingDeskMap,
  type TemplatePendingLower,
} from './templatePendingDesks'

type StudentPair = [StudentEntry | null, StudentEntry | null]
type StatusPair = [StudentStatusEntry | null, StudentStatusEntry | null]
type MemoPair = [string | null, string | null]

// ─────────────────────────────────────────────────────────────────────────────
// 共通の小道具
// ─────────────────────────────────────────────────────────────────────────────

// ScheduleBoardScreen の isManagedLesson と同じ判定（parity テストで固定）。
export function isTemplateManagedLesson(lesson?: DeskLesson) {
  return Boolean(lesson && (lesson.note === '管理データ反映' || lesson.id.startsWith('managed_')))
}

// ScheduleBoardScreen の buildManagedOccurrenceKey と同じ鍵の形（parity テストで固定）。形を変えるときは両方直す。
export function buildTemplateOccurrenceKey(student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'subject'>, dateKey: string, slotNumber: number) {
  return `${student.managedStudentId ?? student.name}__${student.subject}__${dateKey}__${slotNumber}`
}

// 同じ生徒か（Q23-1：managedStudentId 優先・無ければ名前）。mergeManagedDeskLesson の同一性判定と同じ流儀。
export function isSameTemplateStudent(left: Pick<StudentEntry, 'managedStudentId' | 'name'>, right: Pick<StudentEntry, 'managedStudentId' | 'name'>) {
  if (left.managedStudentId && right.managedStudentId) return left.managedStudentId === right.managedStudentId
  return left.name === right.name
}

// 会計を持つ出欠記録（INV-06 の区分）。moved / holiday は表示専用。
export function isAccountingStatus(status: StudentStatusKind) {
  return status === 'absent' || status === 'absent-no-makeup' || status === 'attended'
}

// 講師の削除記録（tombstone: teacher='' かつ teacherAssignmentSource='deleted'。講習 ID つきも同じ）。Q21-9 例外 2・Q22。
export function isTemplateDiffTeacherTombstone(desk: Pick<DeskCell, 'teacher' | 'teacherAssignmentSource'>) {
  return !desk.teacher.trim() && desk.teacherAssignmentSource === 'deleted'
}

// QR 提出の自動割振り講師（schedule-registration＋講習期間 ID）。Q21-9 例外 1。
export function isTemplateDiffQrTeacher(desk: Pick<DeskCell, 'teacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId'>) {
  return Boolean(desk.teacher.trim()) && desk.teacherAssignmentSource === 'schedule-registration' && Boolean(desk.teacherAssignmentSessionId)
}

function liveStudents(lesson?: DeskLesson): StudentEntry[] {
  const slots: ReadonlyArray<StudentEntry | null> = lesson?.studentSlots ?? []
  return slots.filter((student): student is StudentEntry => Boolean(student))
}

function hasMemoText(memo: string | null | undefined) {
  return typeof memo === 'string' && memo.trim() !== ''
}

function cloneLesson(lesson: DeskLesson): DeskLesson {
  return { ...lesson, studentSlots: [lesson.studentSlots[0] ? { ...lesson.studentSlots[0] } : null, lesson.studentSlots[1] ? { ...lesson.studentSlots[1] } : null] }
}

function cloneStatusEntry(entry: StudentStatusEntry): StudentStatusEntry {
  return { ...entry, ...(entry.holidayStockReturn ? { holidayStockReturn: { ...entry.holidayStockReturn } } : {}) }
}

function isEmptyPair<T>(pair: [T | null, T | null] | undefined, isFilled: (value: T | null) => boolean = (value) => value != null) {
  return !pair || (!isFilled(pair[0]) && !isFilled(pair[1]))
}

// 生徒の印（Q22 生徒単位）。
function studentHasManualMark(student: StudentEntry) {
  return student.lessonType !== 'regular'
    || Boolean(student.manualAdded)
    || Boolean(student.sameDayMoveSourceDate)
    || Boolean(student.makeupSourceDate)
}

// 旧テンプレ由来の管理授業を「机固有の授業」に付け替える（冒頭 ★ 参照）。
function detachManagedLessonIdentity(lesson: DeskLesson, deskId: string): DeskLesson {
  if (!isTemplateManagedLesson(lesson)) return lesson
  const next: DeskLesson = { ...lesson, id: `${deskId}_template_kept` }
  if (next.note === '管理データ反映') delete next.note
  return next
}

// Q21-8：「既存をそのまま残す」机から、印を持たない通常生徒（旧テンプレ由来）を外す。
function stripUnmarkedRegularStudents(lesson: DeskLesson | undefined, deskId: string): DeskLesson | undefined {
  if (!lesson) return undefined
  const slots = lesson.studentSlots.map((student) => (student && studentHasManualMark(student) ? { ...student } : null)) as StudentPair
  if (!slots[0] && !slots[1]) return undefined
  return detachManagedLessonIdentity({ ...lesson, studentSlots: slots }, deskId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Q22：手入力の印
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateDeskMarkReason =
  | { kind: 'lesson-type'; studentName: string; lessonType: LessonType }
  | { kind: 'manual-added'; studentName: string }
  | { kind: 'same-day-move'; studentName: string }
  | { kind: 'makeup-source'; studentName: string }
  | { kind: 'status-record'; studentName: string; status: StudentStatusKind }
  | { kind: 'memo' }
  | { kind: 'deleted-regular-occurrence'; occurrenceKey: string }
  | { kind: 'deleted-teacher' }

export type TemplateDeskManualInputMark = {
  marked: boolean
  reasons: TemplateDeskMarkReason[]
}

/**
 * 机が「手入力の印」を持つか（Q22・判定はこの関数に一本化）。
 * ★講師の配置（manualTeacher・teacherAssignmentSource の manual / manual-replaced / schedule-registration）は**印に数えない**。
 *   講師系で印になるのは講師の削除記録（tombstone）だけ（オーナー確定 2026-09-29）。
 * ★週トリムの weekHasManualBoardData（講師の手置きも痕跡に数える保守的な判定）とは目的が違う。寄せない。
 * 通常授業の削除記録は抑止キーに机が無いので、「このコマの抑止キーのうち、テンプレ机（抑止前）の生徒×科目に一致するもの」を
 * その机の印として帰属させる。
 */
export function resolveDeskManualInputMark(desk: DeskCell, params: {
  dateKey: string
  slotNumber: number
  suppressedRegularLessonOccurrences: readonly string[]
  templateDeskBeforeSuppression?: Pick<DeskCell, 'lesson'> | null
}): TemplateDeskManualInputMark {
  const reasons: TemplateDeskMarkReason[] = []

  for (const student of liveStudents(desk.lesson)) {
    if (student.lessonType !== 'regular') reasons.push({ kind: 'lesson-type', studentName: student.name, lessonType: student.lessonType })
    if (student.manualAdded) reasons.push({ kind: 'manual-added', studentName: student.name })
    if (student.sameDayMoveSourceDate) reasons.push({ kind: 'same-day-move', studentName: student.name })
    if (student.makeupSourceDate) reasons.push({ kind: 'makeup-source', studentName: student.name })
  }

  for (const entry of desk.statusSlots ?? []) {
    if (entry) reasons.push({ kind: 'status-record', studentName: entry.name, status: entry.status })
  }

  if ((desk.memoSlots ?? []).some((memo) => hasMemoText(memo))) reasons.push({ kind: 'memo' })

  if (params.suppressedRegularLessonOccurrences.length > 0) {
    const suppressed = new Set(params.suppressedRegularLessonOccurrences)
    for (const student of liveStudents(params.templateDeskBeforeSuppression?.lesson ?? undefined)) {
      const occurrenceKey = buildTemplateOccurrenceKey(student, params.dateKey, params.slotNumber)
      if (suppressed.has(occurrenceKey)) reasons.push({ kind: 'deleted-regular-occurrence', occurrenceKey })
    }
  }

  if (isTemplateDiffTeacherTombstone(desk)) reasons.push({ kind: 'deleted-teacher' })

  return { marked: reasons.length > 0, reasons }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q23：中身が同じ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生きている生徒 × 科目 × 種別（lessonType）が一致するか（Q23-1）。席順（ペアの左右）は問わない。
 * 講師・印の有無・授業時間（noteSuffix）・出欠記録・メモは比べない。
 * 種別を比べる理由: 既存が振替の A・テンプレが通常の A を同じとして採用すると振替の消化が消え、保存だけで在庫が 1 増える（Q25）。
 */
export function isTemplateDeskStudentContentEqual(templateDesk: Pick<DeskCell, 'lesson'> | null | undefined, existingDesk: Pick<DeskCell, 'lesson'> | null | undefined) {
  const templateStudents = liveStudents(templateDesk?.lesson ?? undefined)
  const existingStudents = liveStudents(existingDesk?.lesson ?? undefined)
  if (templateStudents.length !== existingStudents.length) return false
  const unmatched = [...templateStudents]
  for (const student of existingStudents) {
    const index = unmatched.findIndex((candidate) => (
      candidate.subject === student.subject
      && candidate.lessonType === student.lessonType
      && isSameTemplateStudent(candidate, student)
    ))
    if (index < 0) return false
    unmatched.splice(index, 1)
  }
  return unmatched.length === 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Q21-9：机の講師
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateDeskTeacherFields = Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId' | 'teacherAssignmentTeacherId'>

export type TemplateDeskTeacherReason = 'template' | 'kept-user' | 'kept-qr' | 'kept-deleted' | 'cleared'

function pickTeacherFields(desk: TemplateDeskTeacherFields): TemplateDeskTeacherFields {
  return {
    teacher: desk.teacher,
    manualTeacher: desk.manualTeacher,
    teacherAssignmentSource: desk.teacherAssignmentSource,
    teacherAssignmentSessionId: desk.teacherAssignmentSessionId,
    teacherAssignmentTeacherId: desk.teacherAssignmentTeacherId,
  }
}

function isUserPlacedTeacher(desk: TemplateDeskTeacherFields) {
  if (!desk.teacher.trim()) return false
  return Boolean(desk.manualTeacher)
    || desk.teacherAssignmentSource === 'manual'
    || desk.teacherAssignmentSource === 'manual-replaced'
    || desk.teacherAssignmentSource === 'schedule-registration'
}

/**
 * 机の講師を決める（Q21-9・オーナー確定 2026-09-29）。講師は突き合わせに使わない。
 *  - 例外 2：講師の削除記録（tombstone）の机 → 講師欄は削除のまま（テンプレの講師で埋めない・記録も保持）。
 *  - 例外 1：QR 提出の自動割振り講師（schedule-registration＋講習期間 ID）→ そのまま残す（由来・講習期間 ID も保持）。
 *    置き換えると起動時の自己修復（reconcileSubmittedTeacherPlacements）が別の空き机へ置き直して二重化する。
 *  - テンプレ机に講師がいる → その講師（手置きの印〔manualTeacher・由来・講習期間 ID〕は外れ、テンプレ足場の講師として扱う）。
 *  - テンプレ机に講師がいない → ユーザーが置いた講師は残す／テンプレ足場の講師（非 manual）は外す（INV-02 の既存裁定）。
 */
export function resolveTemplateDeskTeacher(templateDesk: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'> | null | undefined, existingDesk: TemplateDeskTeacherFields): {
  teacherFields: TemplateDeskTeacherFields
  reason: TemplateDeskTeacherReason
} {
  if (isTemplateDiffTeacherTombstone(existingDesk)) return { teacherFields: pickTeacherFields(existingDesk), reason: 'kept-deleted' }
  if (isTemplateDiffQrTeacher(existingDesk)) return { teacherFields: pickTeacherFields(existingDesk), reason: 'kept-qr' }
  const templateTeacher = templateDesk?.teacher?.trim() ? templateDesk.teacher : ''
  if (templateTeacher) {
    return {
      teacherFields: {
        teacher: templateTeacher,
        manualTeacher: false,
        teacherAssignmentSource: undefined,
        teacherAssignmentSessionId: undefined,
        teacherAssignmentTeacherId: templateDesk?.teacherAssignmentTeacherId,
      },
      reason: 'template',
    }
  }
  if (isUserPlacedTeacher(existingDesk)) return { teacherFields: pickTeacherFields(existingDesk), reason: 'kept-user' }
  return {
    teacherFields: { teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: undefined },
    reason: 'cleared',
  }
}

function applyTeacherFields(desk: DeskCell, fields: TemplateDeskTeacherFields): DeskCell {
  const next: DeskCell = { ...desk, ...fields }
  if (fields.teacher !== desk.teacher) delete next.teacherUnavailableWarning
  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// 席の割り当て（Q21-10）
// ─────────────────────────────────────────────────────────────────────────────

type SeatOccupancy = [boolean, boolean]

function occupancyOf(desk: Pick<DeskCell, 'lesson' | 'statusSlots' | 'memoSlots'>): SeatOccupancy {
  return [0, 1].map((index) => Boolean(
    desk.lesson?.studentSlots[index]
    || desk.statusSlots?.[index]
    || hasMemoText(desk.memoSlots?.[index]),
  )) as SeatOccupancy
}

// 元の席が空いていればそこ、空いていなければもう一方の空いた席。どちらも埋まっていれば -1。
function pickSeat(occupancy: SeatOccupancy, preferredIndex: number) {
  if (!occupancy[preferredIndex]) return preferredIndex
  const other = preferredIndex === 0 ? 1 : 0
  return occupancy[other] ? -1 : other
}

// ─────────────────────────────────────────────────────────────────────────────
// Q28：1 行に戻す（合流）
// ─────────────────────────────────────────────────────────────────────────────

export type TemplatePendingCollapseResult =
  | { ok: true; nextDesk: DeskCell }
  | { ok: false; reason: 'both-rows-live' | 'status-overflow' | 'memo-overflow' | 'duplicate-student' }

/**
 * 保留（2 行）を 1 行に戻す（Q28）。どちらかの行に生きている生徒がいないときだけ合流できる。
 *  - 残った行の生徒が机になる（下段が残るなら、旧テンプレ由来の管理授業は机固有の id に付け替える）。講師は机の講師のまま。
 *  - 机の出欠記録（会計を持つ記録は元から机に残っている）はそのまま。下段の会計記録（席不足で入ったもの）は空いた席へ戻す。
 *    下段の表示専用の記録（moved / holiday）は捨てる。出欠枠（2）を超えるなら合流しない（'status-overflow'）。
 *    ★Issue #57 の台帳確定（materializeDisplacedStatusEntryIntoLedgers）は使わない（在庫を動かさない）。
 *  - 下段のメモは空いた席へ引き継ぐ。入らなければ合流しない（'memo-overflow'）。
 *  - liveStudentKeysElsewhere（同じコマの別の机で生きている生徒）を渡すと、下段を机へ戻した結果が同じコマに同じ生徒を
 *    2 か所で生かすなら止める（'duplicate-student'・Q26-4・INV-12）。
 */
export function computePendingDeskCollapse(desk: DeskCell, pending: Pick<TemplatePendingDesk, 'lower'>, options: {
  liveStudentsElsewhere?: readonly Pick<StudentEntry, 'managedStudentId' | 'name'>[]
} = {}): TemplatePendingCollapseResult {
  const upperLive = liveStudents(desk.lesson)
  const lowerLive = liveStudents(pending.lower.lesson)
  if (upperLive.length > 0 && lowerLive.length > 0) return { ok: false, reason: 'both-rows-live' }

  const baseLesson = upperLive.length > 0
    ? desk.lesson
    : (lowerLive.length > 0 && pending.lower.lesson ? detachManagedLessonIdentity(cloneLesson(pending.lower.lesson), desk.id) : undefined)

  if (upperLive.length === 0 && lowerLive.length > 0 && options.liveStudentsElsewhere?.length) {
    const duplicated = lowerLive.some((student) => options.liveStudentsElsewhere!.some((other) => isSameTemplateStudent(other, student)))
    if (duplicated) return { ok: false, reason: 'duplicate-student' }
  }

  const nextStatus: StatusPair = [desk.statusSlots?.[0] ? cloneStatusEntry(desk.statusSlots[0]) : null, desk.statusSlots?.[1] ? cloneStatusEntry(desk.statusSlots[1]) : null]
  const nextMemo: MemoPair = [desk.memoSlots?.[0] ?? null, desk.memoSlots?.[1] ?? null]
  const occupancy = occupancyOf({ lesson: baseLesson, statusSlots: nextStatus, memoSlots: nextMemo })

  const lowerStatus = pending.lower.statusSlots ?? [null, null]
  for (const index of [0, 1]) {
    const entry = lowerStatus[index]
    if (!entry || !isAccountingStatus(entry.status)) continue
    const seat = pickSeat(occupancy, index)
    if (seat < 0) return { ok: false, reason: 'status-overflow' }
    nextStatus[seat] = cloneStatusEntry(entry)
    occupancy[seat] = true
  }

  const lowerMemo = pending.lower.memoSlots ?? [null, null]
  for (const index of [0, 1]) {
    const memo = lowerMemo[index]
    if (!hasMemoText(memo)) continue
    const seat = pickSeat(occupancy, index)
    if (seat < 0) return { ok: false, reason: 'memo-overflow' }
    nextMemo[seat] = memo
    occupancy[seat] = true
  }

  const nextDesk: DeskCell = { ...desk }
  if (baseLesson) nextDesk.lesson = baseLesson
  else delete nextDesk.lesson
  if (isEmptyPair(nextStatus)) delete nextDesk.statusSlots
  else nextDesk.statusSlots = nextStatus
  if (isEmptyPair(nextMemo, (memo) => memo != null)) delete nextDesk.memoSlots
  else nextDesk.memoSlots = nextMemo
  return { ok: true, nextDesk }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q26-1：「既存を採用」の希望回数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 「既存を採用」で取り下げた上段のテンプレ生徒のうち、希望回数 −1（既存の「削除」と同じ扱い）を当てる生徒を返す（Q26-1）。
 * 操作の後の**同じ日の実配置**（盤面の机＝上段・1 行の机。今戻した下段を含み、他の机の保留中の下段は含まない＝INV-13）に
 * 同じ生徒×科目の授業が生きていなければ −1、生きていれば補正しない（種別・時限・机は問わない）。出欠記録は「生きている」に数えない。
 * placementsAfterAdoption には操作後の盤面のセル（日付を問わず渡してよい。dateKey で絞る）を渡す。保留マップは渡さない。
 */
export function resolveAdoptExistingCountAdjustments(params: {
  withdrawnTemplateStudents: readonly StudentEntry[]
  dateKey: string
  placementsAfterAdoption: readonly SlotCell[]
}): Array<{ student: StudentEntry; dateKey: string }> {
  const livingOnDate: StudentEntry[] = []
  for (const cell of params.placementsAfterAdoption) {
    if (cell.dateKey !== params.dateKey) continue
    for (const desk of cell.desks) livingOnDate.push(...liveStudents(desk.lesson))
  }
  return params.withdrawnTemplateStudents
    .filter((student) => !livingOnDate.some((living) => living.subject === student.subject && isSameTemplateStudent(living, student)))
    .map((student) => ({ student, dateKey: params.dateKey }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Q21：差分反映の本体
// ─────────────────────────────────────────────────────────────────────────────

/** 突き合わせに使うテンプレのコマ。raw＝抑止前（印の帰属に使う）、applied＝抑止と足場講師 strip を当てた後（Q21-5）。 */
export type TemplateDiffTemplateCell = {
  raw: SlotCell
  applied: SlotCell
}

export type TemplateDiffApplySummary = {
  /** 印なしの机で、生徒または講師が実際に変わった机（Q21-3 の 1 行目）。 */
  replaced: number
  /** 印ありでテンプレ机に生徒がいない → 既存をそのまま残した机（Q21-3 の 2 行目。Q29 で下段を机へ戻した机を含む）。 */
  kept: number
  /** 印ありで中身が同じ → テンプレを採用して印を外した机（Q21-3 の 3 行目。Q29 で自動で 1 行に戻した机を含む）。 */
  adopted: number
  /** 保留（2 行）になった机（Q21-3 の 4 行目。前回からの保留を含む）。 */
  pending: number
  /** 講師の削除記録だけの空き机で、テンプレ机も空なので削除記録を外した机（Q21-3 の 5 行目）。 */
  tombstoneCleared: number
  /** 既存のメモ・記録を残して（または表示専用の記録を捨てて）その場で 1 行にした机（Q28-6）。 */
  collapsedOnCreate: number
  /** テンプレ机に講師がいたが QR 自動割振りの講師を残した机（Q21-9 例外 1）。 */
  qrTeacherKept: number
  /** 講師を削除した机にテンプレの生徒を置いた机（Q21-9 例外 2）。 */
  deletedTeacherDeskFilled: number
  /** 同じコマの別の 1 行の机に生きているため上段に置かなかった生徒（Q21-11）。 */
  skippedDuplicateStudents: number
}

export function createEmptyTemplateDiffApplySummary(): TemplateDiffApplySummary {
  return { replaced: 0, kept: 0, adopted: 0, pending: 0, tombstoneCleared: 0, collapsedOnCreate: 0, qrTeacherKept: 0, deletedTeacherDeskFilled: 0, skippedDuplicateStudents: 0 }
}

export type ComputeTemplateDiffApplyParams = {
  weeks: SlotCell[][]
  /** 反映日以降の各コマに対応するテンプレのコマ（id → 無ければ 日付×時限 で引く）。 */
  templateCells: readonly TemplateDiffTemplateCell[]
  effectiveStartDate: string
  /** 保存時点で保持している通常授業の抑止（印の帰属と Q21-11 の重複判定に使う。この関数は消さない）。 */
  suppressedRegularLessonOccurrences: readonly string[]
  pendingDesks: TemplatePendingDeskMap
  /** 新しく作る保留の createdAt（ISO）。 */
  createdAt: string
}

export type ComputeTemplateDiffApplyResult = {
  nextWeeks: SlotCell[][]
  nextPendingDesks: TemplatePendingDeskMap
  summary: TemplateDiffApplySummary
  /** Q21-11 で上段に置かなかった生徒の通常授業の抑止キー（保存時に抑止へ足す）。 */
  addedSuppressedRegularLessonOccurrences: string[]
}

type DeskDecision =
  | { kind: 'replace' }
  | { kind: 'keep' }
  | { kind: 'adopt' }
  | { kind: 'pending' }
  | { kind: 'tombstone-clear' }
  | { kind: 'pending-rebase'; pending: TemplatePendingDesk }

const EMPTY_TEMPLATE_DESK: DeskCell = { id: '', teacher: '' }

function buildDateSlotKey(cell: Pick<SlotCell, 'dateKey' | 'slotNumber'>) {
  return `${cell.dateKey}_${cell.slotNumber}`
}

function filterTemplateDeskStudents(desk: DeskCell, excluded: readonly StudentEntry[]): { desk: DeskCell; removed: StudentEntry[] } {
  if (!desk.lesson || excluded.length === 0) return { desk, removed: [] }
  const removed: StudentEntry[] = []
  const slots = desk.lesson.studentSlots.map((student) => {
    if (!student) return null
    if (excluded.some((other) => isSameTemplateStudent(other, student))) {
      removed.push(student)
      return null
    }
    return student
  }) as StudentPair
  if (removed.length === 0) return { desk, removed }
  // 管理授業の生徒が全員抑止されたときの形（suppressManagedStudentsInCell と同じ：講師は残し授業だけ消す）。
  if (!slots[0] && !slots[1]) {
    const next = { ...desk }
    delete next.lesson
    return { desk: next, removed }
  }
  return { desk: { ...desk, lesson: { ...desk.lesson, studentSlots: slots } }, removed }
}

function templateLessonOf(templateDesk: DeskCell): DeskLesson | undefined {
  return templateDesk.lesson && liveStudents(templateDesk.lesson).length > 0 ? cloneLesson(templateDesk.lesson) : undefined
}

// 上段（テンプレの管理授業・席の位置固定）を机に置き、机に残す出欠記録・メモを空いた席へ詰める。
// 入らない出欠記録・メモは overflow で返す（呼び出し側が下段へ入れる／1 行ならそのまま元の席に残す）。
function seatUpperWithDeskRecords(params: {
  upperLesson: DeskLesson | undefined
  keptStatus: Array<{ index: number; entry: StudentStatusEntry }>
  keptMemo: Array<{ index: number; memo: string }>
}) {
  const statusSlots: StatusPair = [null, null]
  const memoSlots: MemoPair = [null, null]
  const occupancy: SeatOccupancy = [Boolean(params.upperLesson?.studentSlots[0]), Boolean(params.upperLesson?.studentSlots[1])]
  const overflowStatus: Array<{ index: number; entry: StudentStatusEntry }> = []
  const overflowMemo: Array<{ index: number; memo: string }> = []
  for (const item of params.keptStatus) {
    const seat = pickSeat(occupancy, item.index)
    if (seat < 0) { overflowStatus.push(item); continue }
    statusSlots[seat] = cloneStatusEntry(item.entry)
    occupancy[seat] = true
  }
  for (const item of params.keptMemo) {
    const seat = pickSeat(occupancy, item.index)
    if (seat < 0) { overflowMemo.push(item); continue }
    memoSlots[seat] = item.memo
    occupancy[seat] = true
  }
  return { statusSlots, memoSlots, overflowStatus, overflowMemo }
}

function withSlots(desk: DeskCell, lesson: DeskLesson | undefined, statusSlots: StatusPair | undefined, memoSlots: MemoPair | undefined): DeskCell {
  const next: DeskCell = { ...desk }
  if (lesson) next.lesson = lesson
  else delete next.lesson
  if (statusSlots && !isEmptyPair(statusSlots)) next.statusSlots = statusSlots
  else delete next.statusSlots
  if (memoSlots && !isEmptyPair(memoSlots, (memo) => memo != null)) next.memoSlots = memoSlots
  else delete next.memoSlots
  return next
}

// 元の席、空いていなければもう一方へ置く。両方埋まっていれば置かずに false（上書きして消さない）。
function placeIntoPair<T>(pair: [T | null, T | null], index: number, value: T): boolean {
  if (pair[index] == null) { pair[index] = value; return true }
  const other = index === 0 ? 1 : 0
  if (pair[other] == null) { pair[other] = value; return true }
  return false
}

function studentsChanged(before: DeskLesson | undefined, after: DeskLesson | undefined) {
  const left = liveStudents(before)
  const right = liveStudents(after)
  if (left.length !== right.length) return true
  return left.some((student, index) => {
    const other = right[index]
    return !other || !isSameTemplateStudent(student, other) || student.subject !== other.subject || student.lessonType !== other.lessonType
  })
}

/**
 * テンプレ保存の差分反映（Q21・Q21-11・Q24-1・Q28-6・Q29）。保存本体と確認文の件数の両方がこれを呼ぶ（Q32-1）。
 * 反映日より前のセル・週は**参照ごと**そのまま返す（INV-10）。
 */
export function computeTemplateDiffApply(params: ComputeTemplateDiffApplyParams): ComputeTemplateDiffApplyResult {
  const summary = createEmptyTemplateDiffApplySummary()
  const nextPendingDesks: TemplatePendingDeskMap = { ...params.pendingDesks }
  const addedSuppressed = new Set<string>()
  const existingSuppressed = new Set(params.suppressedRegularLessonOccurrences)
  const templateById = new Map(params.templateCells.map((entry) => [entry.applied.id, entry]))
  const templateByDateSlot = new Map(params.templateCells.map((entry) => [buildDateSlotKey(entry.applied), entry]))

  const nextWeeks = params.weeks.map((week) => {
    const lastDateKey = week.reduce((max, cell) => (cell.dateKey > max ? cell.dateKey : max), '')
    if (lastDateKey < params.effectiveStartDate) return week
    return week.map((cell) => {
      // 禁忌: テンプレ反映日より前のコマ表は不変（INV-10・Q1）。
      if (cell.dateKey < params.effectiveStartDate) return cell
      const templateCell = templateById.get(cell.id) ?? templateByDateSlot.get(buildDateSlotKey(cell))
      if (!templateCell) return cell
      return applyTemplateDiffToCell({
        cell,
        templateCell,
        suppressedRegularLessonOccurrences: params.suppressedRegularLessonOccurrences,
        existingSuppressed,
        pendingDesks: params.pendingDesks,
        nextPendingDesks,
        effectiveStartDate: params.effectiveStartDate,
        createdAt: params.createdAt,
        summary,
        addedSuppressed,
      })
    })
  })

  return {
    nextWeeks,
    nextPendingDesks,
    summary,
    addedSuppressedRegularLessonOccurrences: [...addedSuppressed],
  }
}

function applyTemplateDiffToCell(context: {
  cell: SlotCell
  templateCell: TemplateDiffTemplateCell
  suppressedRegularLessonOccurrences: readonly string[]
  existingSuppressed: Set<string>
  pendingDesks: TemplatePendingDeskMap
  nextPendingDesks: TemplatePendingDeskMap
  effectiveStartDate: string
  createdAt: string
  summary: TemplateDiffApplySummary
  addedSuppressed: Set<string>
}): SlotCell {
  const { cell, templateCell, summary } = context
  // Q21-6：休日のコマはテンプレ机を「空」とみなす。
  const isClosed = !templateCell.applied.isOpenDay
  const rawTemplateDesks = cell.desks.map((_, index) => (isClosed ? EMPTY_TEMPLATE_DESK : (templateCell.raw.desks[index] ?? EMPTY_TEMPLATE_DESK)))
  const appliedTemplateDesks = cell.desks.map((_, index) => (isClosed ? EMPTY_TEMPLATE_DESK : (templateCell.applied.desks[index] ?? EMPTY_TEMPLATE_DESK)))

  // ── 1. 机ごとの振り分け（Q21-3・Q29）。Q21-11 の重複は 2. で除いてから振り分け直す。
  const classify = (desk: DeskCell, index: number, templateDesk: DeskCell): DeskDecision => {
    const pending = context.pendingDesks[buildTemplatePendingDeskKey(cell.id, desk.id)]
    if (pending) return { kind: 'pending-rebase', pending }
    const mark = resolveDeskManualInputMark(desk, {
      dateKey: cell.dateKey,
      slotNumber: cell.slotNumber,
      suppressedRegularLessonOccurrences: context.suppressedRegularLessonOccurrences,
      templateDeskBeforeSuppression: rawTemplateDesks[index],
    })
    if (!mark.marked) return { kind: 'replace' }
    const templateHasStudents = liveStudents(templateDesk.lesson).length > 0
    const tombstoneOnly = mark.reasons.every((reason) => reason.kind === 'deleted-teacher')
    if (tombstoneOnly && !templateHasStudents && !templateDesk.teacher.trim()) return { kind: 'tombstone-clear' }
    if (!templateHasStudents) return { kind: 'keep' }
    if (isTemplateDeskStudentContentEqual(templateDesk, desk)) return { kind: 'adopt' }
    return { kind: 'pending' }
  }

  // 1 行の机として机に残る「テンプレ以外の生きている生徒」（Q21-11 の重複判定の相手）。
  const oneRowNonTemplateLiveStudents = (desk: DeskCell, decision: DeskDecision, templateDesk: DeskCell): StudentEntry[] => {
    if (decision.kind === 'keep') return liveStudents(stripUnmarkedRegularStudents(desk.lesson, desk.id))
    if (decision.kind === 'pending-rebase' && liveStudents(templateDesk.lesson).length === 0) {
      // 新しいテンプレ机に生徒がいない → 下段が机に戻る（Q29）。
      return liveStudents(stripUnmarkedRegularStudents(decision.pending.lower.lesson, desk.id))
    }
    return []
  }

  let templateDesks = appliedTemplateDesks
  let decisions = cell.desks.map((desk, index) => classify(desk, index, templateDesks[index]))
  const skippedByDesk = cell.desks.map(() => [] as StudentEntry[])
  // ── 2. Q21-11：同じコマの別の 1 行の机に生きている生徒は上段に置かない（振り分けが安定するまで繰り返す）。
  for (let iteration = 0; iteration <= cell.desks.length; iteration += 1) {
    const livingByDesk = cell.desks.map((desk, index) => oneRowNonTemplateLiveStudents(desk, decisions[index], templateDesks[index]))
    let changed = false
    const nextTemplateDesks = templateDesks.map((templateDesk, index) => {
      const elsewhere = livingByDesk.flatMap((students, otherIndex) => (otherIndex === index ? [] : students))
      const filtered = filterTemplateDeskStudents(templateDesk, elsewhere)
      if (filtered.removed.length > 0) {
        changed = true
        skippedByDesk[index].push(...filtered.removed)
      }
      return filtered.desk
    })
    if (!changed) break
    templateDesks = nextTemplateDesks
    decisions = cell.desks.map((desk, index) => classify(desk, index, templateDesks[index]))
  }
  skippedByDesk.forEach((removed) => {
    for (const student of removed) {
      summary.skippedDuplicateStudents += 1
      const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
      if (!context.existingSuppressed.has(key)) context.addedSuppressed.add(key)
    }
  })

  // ── 3. 机を組み立てる。
  const nextDesks = cell.desks.map((desk, index) => {
    const templateDesk = templateDesks[index]
    const decision = decisions[index]
    const pendingKey = buildTemplatePendingDeskKey(cell.id, desk.id)
    const teacher = resolveTemplateDeskTeacher(templateDesk, desk)
    if (teacher.reason === 'kept-qr' && templateDesk.teacher.trim()) summary.qrTeacherKept += 1
    const withTeacher = applyTeacherFields(desk, teacher.teacherFields)
    const upperLesson = templateLessonOf(templateDesk)

    if (decision.kind === 'replace') {
      const next = withSlots(withTeacher, upperLesson, desk.statusSlots, desk.memoSlots)
      if (studentsChanged(desk.lesson, upperLesson) || next.teacher !== desk.teacher) summary.replaced += 1
      return next
    }

    if (decision.kind === 'tombstone-clear') {
      summary.tombstoneCleared += 1
      return withSlots({ ...desk, teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: undefined }, undefined, undefined, undefined)
    }

    if (decision.kind === 'keep') {
      summary.kept += 1
      return withSlots(withTeacher, stripUnmarkedRegularStudents(desk.lesson, desk.id), desk.statusSlots, desk.memoSlots)
    }

    if (decision.kind === 'adopt') {
      summary.adopted += 1
      // 印を外す＝テンプレの生徒（印なし）をそのまま置く。出欠記録・メモは消さずに机へ残す（Q23-3）。
      const seated = seatUpperWithDeskRecords({
        upperLesson,
        keptStatus: collectStatusItems(desk.statusSlots, () => true),
        keptMemo: collectMemoItems(desk.memoSlots),
      })
      // 1 行の机なので入らない記録・メモも捨てない（元の席に残す。整合の取れた既存データでは起きない）。
      for (const item of seated.overflowStatus) placeIntoPair(seated.statusSlots, item.index, cloneStatusEntry(item.entry))
      for (const item of seated.overflowMemo) placeIntoPair(seated.memoSlots, item.index, item.memo)
      return withSlots(withTeacher, upperLesson, seated.statusSlots, seated.memoSlots)
    }

    if (decision.kind === 'pending') {
      // 上段＝テンプレ、会計を持つ記録は机に残す（席不足分だけ下段へ）、表示専用の記録・メモ・生きている生徒は下段へ（Q24-1・Q21-10）。
      const seated = seatUpperWithDeskRecords({
        upperLesson,
        keptStatus: collectStatusItems(desk.statusSlots, (entry) => isAccountingStatus(entry.status)),
        keptMemo: [],
      })
      const lower: TemplatePendingLower = {}
      const existingLive = liveStudents(desk.lesson)
      if (existingLive.length > 0 && desk.lesson) lower.lesson = cloneLesson(desk.lesson)
      const lowerStatus: StatusPair = [null, null]
      for (const item of collectStatusItems(desk.statusSlots, (entry) => !isAccountingStatus(entry.status))) placeIntoPair(lowerStatus, item.index, cloneStatusEntry(item.entry))
      for (const item of seated.overflowStatus) placeIntoPair(lowerStatus, item.index, cloneStatusEntry(item.entry))
      if (!isEmptyPair(lowerStatus)) lower.statusSlots = lowerStatus
      const lowerMemo: MemoPair = [null, null]
      for (const item of collectMemoItems(desk.memoSlots)) placeIntoPair(lowerMemo, item.index, item.memo)
      if (!isEmptyPair(lowerMemo, (memo) => memo != null)) lower.memoSlots = lowerMemo

      const upperDesk = withSlots(withTeacher, upperLesson, seated.statusSlots, undefined)
      const filledDeletedTeacherDesk = teacher.reason === 'kept-deleted' && Boolean(upperLesson)
      // Q28-6：下段に生きている生徒がいなければ、2 行を作らずにその場で 1 行にする。
      if (existingLive.length === 0) {
        const collapsed = computePendingDeskCollapse(upperDesk, { lower })
        if (collapsed.ok) {
          if (filledDeletedTeacherDesk) summary.deletedTeacherDeskFilled += 1
          const hadInputOtherThanTombstone = Boolean(desk.statusSlots?.some(Boolean))
            || (desk.memoSlots ?? []).some((memo) => hasMemoText(memo))
            || resolveDeskManualInputMark(desk, {
              dateKey: cell.dateKey,
              slotNumber: cell.slotNumber,
              suppressedRegularLessonOccurrences: context.suppressedRegularLessonOccurrences,
              templateDeskBeforeSuppression: rawTemplateDesks[index],
            }).reasons.some((reason) => reason.kind === 'deleted-regular-occurrence')
          if (hadInputOtherThanTombstone) summary.collapsedOnCreate += 1
          return collapsed.nextDesk
        }
      }
      if (filledDeletedTeacherDesk) summary.deletedTeacherDeskFilled += 1
      summary.pending += 1
      context.nextPendingDesks[pendingKey] = { lower, effectiveStartDate: context.effectiveStartDate, createdAt: context.createdAt }
      return upperDesk
    }

    // Q29：保留中の再保存。上段だけ差し替え、下段は維持。新しい上段が下段と同じ中身なら自動で 1 行に戻す。
    // 新しいテンプレ机に生徒がいなければ上段が空になり、下段が机に戻る（＝印あり＋テンプレ机に生徒なしの「残す」と同じ結果）。
    const pending = decision.pending
    const lower = cloneTemplatePendingLower(pending.lower)
    const seated = seatUpperWithDeskRecords({
      upperLesson,
      keptStatus: collectStatusItems(desk.statusSlots, () => true),
      keptMemo: collectMemoItems(desk.memoSlots),
    })
    // 上段が替わって机に入らなくなった記録・メモは下段へ（黙って捨てない）。下段も埋まっていれば机の元の席に残す
    // （表示は上段の生徒に隠れるがデータは消さない。机の記録は元から 2 件以下なので机の枠からはあふれない）。
    if (seated.overflowStatus.length > 0) {
      const lowerStatus: StatusPair = lower.statusSlots ? [...lower.statusSlots] as StatusPair : [null, null]
      for (const item of seated.overflowStatus) {
        const entry = cloneStatusEntry(item.entry)
        if (!placeIntoPair(lowerStatus, item.index, entry)) placeIntoPair(seated.statusSlots, item.index, entry)
      }
      if (!isEmptyPair(lowerStatus)) lower.statusSlots = lowerStatus
    }
    if (seated.overflowMemo.length > 0) {
      const lowerMemo: MemoPair = lower.memoSlots ? [...lower.memoSlots] as MemoPair : [null, null]
      for (const item of seated.overflowMemo) {
        if (!placeIntoPair(lowerMemo, item.index, item.memo)) placeIntoPair(seated.memoSlots, item.index, item.memo)
      }
      if (!isEmptyPair(lowerMemo, (memo) => memo != null)) lower.memoSlots = lowerMemo
    }
    const upperDesk = withSlots(withTeacher, upperLesson, seated.statusSlots, seated.memoSlots)

    const lowerHasLive = liveStudents(lower.lesson).length > 0
    const sameContent = Boolean(upperLesson) && isTemplateDeskStudentContentEqual({ lesson: upperLesson }, { lesson: lower.lesson })
    if (!upperLesson || !lowerHasLive || sameContent) {
      // 同じ中身なら下段の生徒は上段と重なるので捨てる（テンプレを採用＝印を外す）。
      const collapseSource = sameContent ? { lower: { ...lower, lesson: undefined } } : { lower }
      const collapsed = computePendingDeskCollapse(upperDesk, collapseSource)
      if (collapsed.ok) {
        delete context.nextPendingDesks[pendingKey]
        if (!upperLesson) {
          summary.kept += 1
          const restored = collapsed.nextDesk
          return withSlots(restored, stripUnmarkedRegularStudents(restored.lesson, desk.id), restored.statusSlots, restored.memoSlots)
        }
        summary.adopted += 1
        return collapsed.nextDesk
      }
    }
    summary.pending += 1
    context.nextPendingDesks[pendingKey] = { lower, effectiveStartDate: pending.effectiveStartDate, createdAt: pending.createdAt }
    return upperDesk
  })

  return {
    ...cell,
    isOpenDay: templateCell.applied.isOpenDay,
    desks: nextDesks.map(alignTeacherIdentityWithRemerge),
  }
}

// 再マージ（mergeManagedWeek）は、管理授業でない机（手置きの授業・記録だけの机）の非 manual 講師から
// teacherAssignmentTeacherId を外す。差分反映の結果を再マージの不動点にするため、同じ形に揃える（講師名は変えない）。
// export は第 1 段 (B) の解決操作（下段を机へ戻した机・templatePendingResolution.ts / computePendingDeskResolution）でも同じ形に揃えるため。
export function alignTeacherIdentityWithRemerge(desk: DeskCell): DeskCell {
  if (desk.manualTeacher || desk.teacherAssignmentTeacherId === undefined) return desk
  const hasManagedLesson = Boolean(desk.lesson) && isTemplateManagedLesson(desk.lesson)
  if (hasManagedLesson) return desk
  const keepsTeacherWithoutTemplateLesson = Boolean(desk.lesson) || Boolean(desk.statusSlots?.some(Boolean))
  if (!keepsTeacherWithoutTemplateLesson) return desk
  return { ...desk, teacherAssignmentTeacherId: undefined }
}

function collectStatusItems(slots: StatusPair | undefined, predicate: (entry: StudentStatusEntry) => boolean) {
  const items: Array<{ index: number; entry: StudentStatusEntry }> = []
  ;(slots ?? [null, null]).forEach((entry, index) => {
    if (entry && predicate(entry)) items.push({ index, entry })
  })
  return items
}

function collectMemoItems(slots: MemoPair | undefined) {
  const items: Array<{ index: number; memo: string }> = []
  ;(slots ?? [null, null]).forEach((memo, index) => {
    if (typeof memo === 'string' && hasMemoText(memo)) items.push({ index, memo })
  })
  return items
}

// ─────────────────────────────────────────────────────────────────────────────
// Q32：確認文・保存後のメッセージ
// ─────────────────────────────────────────────────────────────────────────────

/** 保存前の確認文（Q32-1・懸案 3 案 2）。「すべてのデータが消去され」は出さない。 */
export function buildTemplateDiffConfirmMessage(effectiveStartDate: string, summary: TemplateDiffApplySummary) {
  return [
    `${effectiveStartDate} 以降のコマ表にテンプレートを反映します。`,
    '',
    `${summary.replaced}机を置き換え、${summary.pending}机が保留（緑）になります。`,
    `そのまま残す${summary.kept}机・印を外して採用${summary.adopted}机。`,
    '',
    '振替・講習・メモ・出欠の記録は消えません。保留になった机は、あとで机ごとに「テンプレを採用」「既存を採用」で片づけます。',
    '',
    '実行しますか？',
  ].join('\n')
}

/** 保存後のメッセージ（Q32-1）。確認文の 4 件数に、即時合流・QR 講師・講師を削除した机・上段に置かなかった生徒を足す。 */
export function buildTemplateDiffSavedMessage(effectiveStartDate: string, summary: TemplateDiffApplySummary) {
  const parts = [
    `通常授業テンプレートを保存しました。${effectiveStartDate} 以降: ${summary.replaced}机を置き換え・${summary.pending}机が保留・そのまま残す${summary.kept}机・印を外して採用${summary.adopted}机。`,
  ]
  if (summary.collapsedOnCreate > 0) parts.push(`${summary.collapsedOnCreate}机は既存のメモ・記録を残してテンプレの生徒を置きました。`)
  if (summary.qrTeacherKept > 0) parts.push(`QR 自動割振りの講師を残した机: ${summary.qrTeacherKept}机。`)
  if (summary.deletedTeacherDeskFilled > 0) parts.push(`講師を削除した机にテンプレの生徒を置いた机: ${summary.deletedTeacherDeskFilled}机。`)
  if (summary.skippedDuplicateStudents > 0) parts.push(`同じコマの別の机に居るため上段に置かなかった生徒: ${summary.skippedDuplicateStudents}名。`)
  if (summary.tombstoneCleared > 0) parts.push(`講師の削除記録だけの空き机 ${summary.tombstoneCleared}机は記録を外しました。`)
  return parts.join('')
}
