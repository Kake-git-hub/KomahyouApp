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

import { isCellInTemplateDiffScope, isTemplateEffectiveStartDateInPast, resolveDayOfWeekFromDateKey, type TemplateDiffScopeNote, type TemplateDiffSlotFilter } from './templateDefinitionDiff'
import type { ScheduleCountAdjustmentEntry } from '../../types/appState'
import { buildLessonFactKey, collectCountAdjustmentsByKey, collectLessonExplanationFacts, countLessonExplanations, countOriginsOnDate } from './templateLessonAccounting'
import type { DeskCell, DeskLesson, LessonType, SlotCell, StudentEntry, StudentStatusEntry, StudentStatusKind } from './types'
import { isShiftedTemplateTeacherDesk } from '../../utils/deskTeacherLabel'
import {
  buildTemplatePendingDeskKey,
  cloneTemplatePendingLower,
  parseTemplatePendingDeskKey,
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

/**
 * Q40-3「精算済み」判定（2026-10-21・テスト教室 tp-48 → regression-reviewer H-A で再改定）。権威関数＝配置計画（Q40-2）と Q35-8 の −1 の両方がこれを使う。
 *
 * 丸ごと振替した日に Q35 が置かなかったテンプレの生徒（生徒×科目×日付ごとにまとめる）のうち、その日の授業が**もう説明されている**分は
 * 置かず・未消化にせず・−1 もしない。説明の数え方は監査（templateLessonAccountingOracle）と同じ `countLessonExplanations`:
 *   (1) **同じ時限**の抑止キーが保存前からある生徒は、前の保存か丸ごと振替が処分済み（再保存の冪等性）→ 精算済み。
 *   (2) 残りは件数で決める: 説明できる件数 E（生きている通常授業・出欠/移動元の記録・記録と対にならない振替・在庫の origin・−1 の純減）から、
 *       この保存で置かなかった以外のテンプレの授業数（T − |置かなかった|＝既に抑止されている分）と (1) の件数を引いた**余り**の分だけ、
 *       時限の小さい順に精算済みにする。同じコマに同じ生徒の別種の授業（振替・講習）がある生徒は Q21-11 と同じ理由で精算済み（余りを消費しない）。
 * 改定前（キー単位: 別の時限のキーがあれば精算済み）は、キー 1 本が複数の授業を説明してしまい、同じ科目を同じ曜日の 2 コマに持つ生徒の追加が
 * 置かず・未消化にせず・−1 もせずに消えていた（INV-05/INV-06・テスト教室 2026-10-17、regression-reviewer H-A の再現 1〜3）。
 */
export type WholeDayTransferSettlementInput = {
  /** 保存前の盤面（説明の材料。この保存で置く振替はまだ無い）。 */
  weeks: SlotCell[][]
  pendingDesks: TemplatePendingDeskMap
  /** 新テンプレ（抑止前の raw）＝その日のテンプレの授業数 T。 */
  templateCells: readonly TemplateDiffTemplateCell[]
  /** 保存前の抑止キー（(1) の同じ時限の判定）。 */
  suppressedRegularLessonOccurrences: readonly string[]
  /** 在庫の正本（collectMakeupOriginDatesByKey）が返す 生徒×科目 → 有効な origin トークン。 */
  originDatesByKey: Record<string, string[]>
  /** 希望回数の補正（−1 の純減をその日の説明に数える）。 */
  scheduleCountAdjustments: readonly ScheduleCountAdjustmentEntry[]
}

export function resolveWholeDayTransferSettlement<T extends { student: StudentEntry; dateKey: string; slotNumber: number }>(items: readonly T[], input: WholeDayTransferSettlementInput): Set<T> {
  const settled = new Set<T>()
  if (items.length === 0) return settled
  const facts = collectLessonExplanationFacts({ weeks: input.weeks, pendingDesks: input.pendingDesks })
  const adjustments = collectCountAdjustmentsByKey(input.scheduleCountAdjustments)
  const templateCount = new Map<string, number>()
  // Q40-2 休日設定した振替元（2026-10-25）: 休日の raw にはテンプレの授業が無いので、開けた形のテンプレ机（closedTransferSourceDesks）で数える。
  // その日の「テンプレ行×休日」の自動発生 origin は、これから振替先へ置いて埋める不足そのもので説明ではない（数えると新しく足した生徒が
  // 置かれずに精算済み扱いで消える）ので、テンプレの授業数ぶんだけ origin から引く（移送済みの生徒は置いた振替が消化するので結果は同じ）。
  const closedTemplateCount = new Map<string, number>()
  for (const entry of input.templateCells) {
    for (const desk of entry.raw.desks) for (const student of liveStudents(desk.lesson)) {
      const key = buildLessonFactKey(student.managedStudentId ?? student.name, student.subject, entry.raw.dateKey)
      templateCount.set(key, (templateCount.get(key) ?? 0) + 1)
    }
    if (entry.applied.isOpenDay || !entry.closedTransferSourceDesks) continue
    for (const desk of entry.closedTransferSourceDesks) for (const student of liveStudents(desk.lesson)) {
      const key = buildLessonFactKey(student.managedStudentId ?? student.name, student.subject, entry.raw.dateKey)
      closedTemplateCount.set(key, (closedTemplateCount.get(key) ?? 0) + 1)
    }
  }
  const preSaveKeys = new Set(input.suppressedRegularLessonOccurrences)
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = buildLessonFactKey(item.student.managedStudentId ?? item.student.name, item.student.subject, item.dateKey)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  for (const [key, group] of groups) {
    const ordered = [...group].sort((left, right) => left.slotNumber - right.slotNumber)
    const studentId = ordered[0].student.managedStudentId ?? ordered[0].student.name
    const subject = ordered[0].student.subject
    const dateKey = ordered[0].dateKey
    // (1) 同じ時限のキー
    const rest: T[] = []
    let sameSlotSettled = 0
    for (const item of ordered) {
      if (preSaveKeys.has(buildTemplateOccurrenceKey(item.student, dateKey, item.slotNumber))) { settled.add(item); sameSlotSettled += 1 } else rest.push(item)
    }
    if (rest.length === 0) continue
    // (2) 件数の余り
    const closedCount = closedTemplateCount.get(key) ?? 0
    const total = Math.max((templateCount.get(key) ?? 0) + closedCount, group.length)
    const origins = Math.max(0, countOriginsOnDate(input.originDatesByKey, studentId, subject, dateKey) - closedCount)
    const { explained } = countLessonExplanations(facts, { studentId, subject, dateKey, origins, countAdjusted: adjustments.get(key) ?? 0, slotsForOtherLesson: [] })
    let spare = explained - (total - group.length) - sameSlotSettled
    for (const item of rest) {
      if ((facts.otherLessonBySlot.get(`${studentId}__${dateKey}__${item.slotNumber}`) ?? 0) > 0) { settled.add(item); continue }
      if (spare > 0) { settled.add(item); spare -= 1 }
    }
  }
  return settled
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

/**
 * 休み・振無休の記録（オーナー指示 2026-10-03「休みと振無休みは空白と同じような扱い（ただし実績データは保持）」・Q37）。
 * 席の突き合わせ・1 行への合流では、この記録だけの席を**空席と同じ**に扱う＝生徒はその席に座れ、記録は同じ席番号に残る
 * （盤面の通常操作で「休みにした席へ振替を置く」と同じ形。表示は生徒が前に出て、日程表・在庫には記録が残る）。
 * 出席（attended）は従来どおり席を確保する（上段の生徒の下に隠さない）。表示専用（moved / holiday）は元から席を確保しない。
 */
export function isAbsenceRecordStatus(status: StudentStatusKind) {
  return status === 'absent' || status === 'absent-no-makeup'
}

/** 席を確保する（生徒の下に隠せない）会計記録＝出席だけ（Q37）。 */
export function isSeatReservingStatus(status: StudentStatusKind) {
  return isAccountingStatus(status) && !isAbsenceRecordStatus(status)
}

// 講師の削除記録（tombstone: teacher='' かつ teacherAssignmentSource='deleted'。講習 ID つきも同じ）。Q21-9 例外 2・Q22。
// ★意味の区別（regression-reviewer N-4）: これは「**講師欄の**削除記録」＝机に生徒が居ても講師欄を削除のまま保ち、印に数える判定。
//   ScheduleBoardScreen の isDeletedTeacherTombstone（授業なし∧manualTeacher∧deleted）は「**空き机としての** tombstone」＝
//   詰め直し・講習の講師自動割当が空き机とみなさないための判定で、目的が違う。正規の tombstone の授業の無い机では両者が一致する
//   （templateDiffApply.test.ts で固定）。片方で他方を書くと非正規形の机で挙動が変わるので統一しない。
export function isTemplateDiffTeacherTombstone(desk: Pick<DeskCell, 'teacher' | 'teacherAssignmentSource'>) {
  return !desk.teacher.trim() && desk.teacherAssignmentSource === 'deleted'
}

// QR 提出の自動割振り講師（schedule-registration＋講習期間 ID）。Q21-9 例外 1。
export function isTemplateDiffQrTeacher(desk: Pick<DeskCell, 'teacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId'>) {
  return Boolean(desk.teacher.trim()) && desk.teacherAssignmentSource === 'schedule-registration' && Boolean(desk.teacherAssignmentSessionId)
}

/**
 * 日程表登録（QR 自動割振り・schedule-registration＋講習期間 ID）の講師が、同じコマの**別の机**にテンプレ由来（非 manual）の同じ講師として
 * 置かれているとき、その QR 机の index を返す（オーナー指示 2026-10-15・確認リスト v1.5.596 その他「日程表より登録された講師が、テンプレで組まれている
 * 同じ講師がいても組まれてしまい、一コマに同じ講師が 2 人いる場合がある。日程表からの講師追加はテンプレが入っていたら消えて良い」）。
 * Q21-9 例外 1 の絞り込み（INV-01 講師帰属の一意性の兄弟・spec-invariants INV-12 2026-10-14 の「未対応の兄弟」）:
 *  - 例外 1 は「QR 講師を置き換えると起動時の自己修復（reconcileSubmittedTeacherPlacements）が別の空き机へ置き直して二重化する」ための保護。
 *    同じ講師がテンプレで同じコマの別の机に居るなら、自己修復の自動割振り（autoAssignTeacherToSpecialSession）は「その講師が既に居るコマ」には
 *    置かないので、QR 机の講師を外しても二重化しない。
 *  - 条件は 2 つとも要る: (1) 盤面のそのコマの別の机に**非 manual**（＝テンプレ由来）の同じ講師が居る、(2) テンプレ（抑止・strip 後）のそのコマの
 *    別の机にその講師が居る。(1) だけだと偶然同名で残った足場講師で QR を消し、(2) だけだと削除記録などでテンプレの講師が置かれなかったコマで
 *    その講師が居なくなる。手置き（manual / manual-replaced）の同じ講師は対象外（室長が意図して置いた机は触らない・INV-02）。
 *  - (2) のテンプレ机が**講師だけの机（足場）**で、QR 机に生徒が居るときは外さない（従来どおり足場の方を置かない＝INV-02 L-7 兄弟 2 の裁定。
 *    外すと QR 講師の下の講習生徒が講師なし／別の講師になる）。QR 机にも生徒が居なければ（講師だけ同士）QR の方を外す。
 *  - 差分反映（computeTemplateDiffApply の机の組み立ての後）と再マージ（mergeManagedWeek の末尾）が同じこの関数で判定する（権威 1 か所）。
 *  - 同じ机にテンプレの同じ講師が来る形（QR 机＝テンプレ机）は重複でないので従来どおり kept-qr。
 */
/**
 * QR 机の講師を外すときに机へ残す記録（types.ts の `scheduleRegistrationSupersededByTemplate`）。差分反映と再マージが同じ形で書く（不動点）。
 * 講師 ID が無い旧データは表示名で残す（自己修復は ID・表示名・氏名のどれでも照合する）。
 */
export function buildScheduleRegistrationSupersession(desk: Pick<DeskCell, 'teacher' | 'teacherAssignmentSessionId' | 'teacherAssignmentTeacherId'>): NonNullable<DeskCell['scheduleRegistrationSupersededByTemplate']> {
  return { sessionId: desk.teacherAssignmentSessionId ?? '', teacherId: desk.teacherAssignmentTeacherId?.trim() || desk.teacher.trim() }
}

/**
 * QR 机の講師を外した後にその机に置く講師（regression-reviewer M-1・2026-10-15: 「外す机」だけでなく「外した後に誰を置くか」も 1 か所で決める）。
 * そのコマのテンプレ（抑止・strip 後）の**同じ机番号**の講師（テンプレ足場扱い・非 manual）。居なければ講師なし。差分反映と再マージの両方がこれを使う。
 */
export function resolveSupersededQrDeskTeacherFields(templateDesk: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'> | null | undefined): TemplateDeskTeacherFields {
  const templateTeacher = templateDesk?.teacher?.trim() ? templateDesk.teacher : ''
  return {
    teacher: templateTeacher,
    manualTeacher: false,
    teacherAssignmentSource: undefined,
    teacherAssignmentSessionId: undefined,
    teacherAssignmentTeacherId: templateTeacher ? templateDesk?.teacherAssignmentTeacherId : undefined,
  }
}

export function findQrTeacherDesksSupersededByTemplate(
  desks: ReadonlyArray<TemplateDeskTeacherFields & Pick<DeskCell, 'lesson'>>,
  templateDesks: ReadonlyArray<Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId' | 'lesson'>>,
  resolveAliases: TeacherAliasResolver = defaultTeacherAliases,
): number[] {
  const result: number[] = []
  desks.forEach((desk, index) => {
    if (!isTemplateDiffQrTeacher(desk)) return
    const qrDeskHasStudents = liveStudents(desk.lesson).length > 0
    const qrKeys = new Set([
      ...resolveAliases(desk.teacher.trim()),
      ...(desk.teacherAssignmentTeacherId?.trim() ? resolveAliases(desk.teacherAssignmentTeacherId.trim()) : []),
    ])
    const matches = (other: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>) => {
      const name = other.teacher?.trim() ?? ''
      const id = other.teacherAssignmentTeacherId?.trim() ?? ''
      if (!name) return false
      return [...resolveAliases(name), ...(id ? resolveAliases(id) : [])].some((key) => qrKeys.has(key))
    }
    const placedElsewhereByTemplate = desks.some((other, otherIndex) => otherIndex !== index
      && !other.manualTeacher
      && other.teacherAssignmentSource !== 'schedule-registration'
      && matches(other))
    if (!placedElsewhereByTemplate) return
    const templateHasTeacherElsewhere = templateDesks.some((templateDesk, templateIndex) => templateIndex !== index
      && matches(templateDesk)
      && (!qrDeskHasStudents || liveStudents(templateDesk.lesson).length > 0))
    if (!templateHasTeacherElsewhere) return
    result.push(index)
  })
  return result
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
// keep は「残す生徒」の判定（既定＝印のある生徒）。Q38 は「印はあるがテンプレが同じコマの別の机に同じ生徒×科目を置く手動追加の通常授業」も外すために渡す。
function stripUnmarkedRegularStudents(lesson: DeskLesson | undefined, deskId: string, keep: (student: StudentEntry) => boolean = studentHasManualMark): DeskLesson | undefined {
  if (!lesson) return undefined
  const slots = lesson.studentSlots.map((student) => (student && keep(student) ? { ...student } : null)) as StudentPair
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

export type TemplateDeskTeacherReason = 'template' | 'template-over-deleted' | 'kept-user' | 'kept-qr' | 'kept-deleted' | 'cleared'

/**
 * 講師の削除記録（tombstone）が「この講師」を塞ぐか（Q21-9 例外 2・**オーナー決定 2026-10-14**「削除した講師だけに有効にして。
 * 別講師はそこに割り振ることがある」）。
 *  - 塞ぐ＝削除した講師（`teacherAssignmentTeacherId`。表示名か講師 ID。作る経路で違う）と同じ講師。
 *  - 置く講師が居ない／誰を消したか分からない旧データ（ID なし）→ 従来どおり塞ぐ（安全側・記録を残す）。
 *  - **講習 ID つき（QR 登録机の削除）は従来どおり誰でも塞ぐ**：記録を別の講師で上書きすると、起動時の自己修復
 *    （reconcileSubmittedTeacherPlacements）が「室長が外した」印を失い、消した QR 講師を別の空き机へ置き直す（2026-09-14 の再発）。
 * 差分反映（resolveTemplateDeskTeacher）と再マージ（mergeManagedWeek）の両方がこの 1 関数で判定する（権威関数）。
 * ★「塞がない」＝その講師をそのコマに置いてよい、であって、削除記録を消してよいとは限らない（下の canClearDeletedTeacherTombstone）。
 */
export function doesDeletedTeacherTombstoneBlock(
  tombstone: TemplateDeskTeacherFields,
  teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'> | null | undefined,
  resolveAliases: TeacherAliasResolver = defaultTeacherAliases,
): boolean {
  if (!isTemplateDiffTeacherTombstone(tombstone)) return false
  const target = teacher?.teacher?.trim() ?? ''
  if (!target) return true
  if (tombstone.teacherAssignmentSessionId) return true
  const deleted = tombstone.teacherAssignmentTeacherId?.trim() ?? ''
  if (!deleted) return true
  return isSameTeacherKey(deleted, teacher, resolveAliases)
}

/** 削除記録の講師キー（表示名か ID）が、この講師（表示名＋ID）と同じ講師か。呼び名の対応表で重なりを見る。 */
function isSameTeacherKey(deletedKey: string, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'> | null | undefined, resolveAliases: TeacherAliasResolver) {
  const target = teacher?.teacher?.trim() ?? ''
  const targetId = teacher?.teacherAssignmentTeacherId?.trim() ?? ''
  if (!target && !targetId) return false
  const deletedKeys = new Set(resolveAliases(deletedKey))
  const targetKeys = [...(target ? resolveAliases(target) : []), ...(targetId ? resolveAliases(targetId) : [])]
  return targetKeys.some((key) => deletedKeys.has(key))
}

/**
 * 削除記録を消して（別の講師で上書きして）よいか。削除記録はそのコマで「消した講師 B を再付与しない」唯一の記憶
 * （再マージの deletedTeacherNameSet はこの記録から毎回作り直す）なので、**B がそのコマのテンプレのどこか（別の机）に居る間は消さない**
 * （消すと次の再マージで B が戻る＝2026-07-10 の本番不具合の再発・regression-reviewer H-1）。B がテンプレのどこにも居なければ記憶は不要なので消してよい。
 * 講習 ID つき・ID 無しは消さない（doesDeletedTeacherTombstoneBlock と同じ安全側）。
 */
export function canClearDeletedTeacherTombstone(
  tombstone: TemplateDeskTeacherFields,
  cellTemplateTeachers: ReadonlyArray<Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>>,
  resolveAliases: TeacherAliasResolver = defaultTeacherAliases,
): boolean {
  if (!isTemplateDiffTeacherTombstone(tombstone)) return false
  if (tombstone.teacherAssignmentSessionId) return false
  const deleted = tombstone.teacherAssignmentTeacherId?.trim() ?? ''
  if (!deleted) return false
  return !cellTemplateTeachers.some((teacher) => isSameTeacherKey(deleted, teacher, resolveAliases))
}

/** 講師の呼び名（講師 ID・登録名・表示名）を同じ講師としてまとめる。無ければそのキーだけ。 */
export type TeacherAliasResolver = (key: string) => readonly string[]
const defaultTeacherAliases: TeacherAliasResolver = (key) => [key]

export function buildTeacherAliasResolver(teachers: ReadonlyArray<{ id: string; name: string; displayName?: string }>): TeacherAliasResolver {
  const byKey = new Map<string, string[]>()
  for (const teacher of teachers) {
    const keys = [teacher.id, teacher.name, teacher.displayName ?? ''].map((key) => key.trim()).filter(Boolean)
    const unique = [...new Set(keys)]
    for (const key of unique) byKey.set(key, unique)
  }
  return (key) => byKey.get(key.trim()) ?? [key]
}

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

/** 手置き講師（Q41-1）: 削除記録（例外 2）→ QR 自動割振り（例外 1）の順に除いたうえで、manualTeacher または manual / manual-replaced。 */
export function isManualPlacedTeacher(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId'>) {
  if (!desk.teacher.trim()) return false
  if (isTemplateDiffTeacherTombstone(desk) || isTemplateDiffQrTeacher(desk)) return false
  return Boolean(desk.manualTeacher) || desk.teacherAssignmentSource === 'manual' || desk.teacherAssignmentSource === 'manual-replaced'
}

/** 同じ講師か（ID・登録名・表示名の呼び名の対応で見る・Q41-1）。 */
export function isSameTeacherByAliases(left: string, right: string, resolveAliases: TeacherAliasResolver = defaultTeacherAliases) {
  const l = left.trim()
  const r = right.trim()
  if (!l || !r) return false
  if (l === r) return true
  const leftKeys = new Set(resolveAliases(l))
  return leftKeys.has(r) || resolveAliases(r).some((key) => leftKeys.has(key))
}

/**
 * Q41-2（オーナー決定 B・2026-10-21・テスト教室 tp-56 case3）: 手置き講師の机をテンプレの別の講師と重ねて保留（緑）にするか。権威関数（差分反映の保留の作成だけが使う）。
 *  (a) 既存の講師が手置き講師（保留中の再保存では下段の講師を既存の講師とみなす＝呼び出し側が渡す）
 *  (b) テンプレ机に別の講師が居る（同じ講師なら 2 行にしない）
 *  (c) テンプレ机に生徒が居る（講師だけのテンプレ机は暫定で対象外・Q41-12 (1)）
 *  (d) 手で置いた生徒（Q22 の印を持つ生きている生徒から Q34-2 の採用・Q38・Q36 で外れる生徒を除いた集合）が 1 人以上居る
 */
export function resolveManualTeacherOverlap(params: {
  existingTeacher: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId'>
  templateDesk: Pick<DeskCell, 'teacher' | 'lesson'>
  handPlacedStudents: readonly StudentEntry[]
  resolveAliases?: TeacherAliasResolver
}): boolean {
  if (!isManualPlacedTeacher(params.existingTeacher)) return false
  if (!params.templateDesk.teacher.trim()) return false
  if (liveStudents(params.templateDesk.lesson).length === 0) return false
  if (isSameTeacherByAliases(params.existingTeacher.teacher, params.templateDesk.teacher, params.resolveAliases)) return false
  return params.handPlacedStudents.length > 0
}

export type ManualTeacherDeskShift = {
  /** 手置き講師の机（テンプレの講師だけの机と同じ番号）。 */
  fromIndex: number
  manualTeacher: Pick<DeskCell, 'teacher'>
  templateTeacher: string
  /** その机に手で置いた生徒（保留中は下段の生徒も）。文言用。 */
  handPlacedStudentNames: string[]
  /**
   * テンプレの講師の置き先。placed＝同じコマの空き机（前回ずらした先の講師だけの机を含む）へ／present＝同じコマの別の机に既に居るので置かない／
   * none＝空き机が無いのでこのコマには置かない。
   */
  placement: { kind: 'placed'; deskIndex: number } | { kind: 'present'; deskIndex: number } | { kind: 'none' }
}

/**
 * Q41-13（オーナー指示 2026-10-22「手入力講師がいる場合、テンプレで上書きされずに、手入力されたそのコマの空き講師枠に詰めてずらす」）。
 * 権威関数: テンプレの**講師だけ（生徒なし）**の机と同じ番号の盤面の机に**手置き講師**（Q41-1。保留中は下段の手置き講師）が居て別の講師なら、
 * その机のテンプレの講師を同じコマの空き机へずらす。ずらした後のテンプレ机で机ごとの突き合わせを行うので、手置き講師の机は Q21-9 の
 * 「テンプレ机に講師が居ない → ユーザーが置いた講師は残す」になり、手で置いた生徒（振替・講習など）もその講師の担当のまま 1 行で残る（2 行にしない）。
 *  - 置き先の優先: (1) 前回の保存でずらした先＝同じ講師が非 manual の講師だけで居る机（テンプレのその机は空）→ そのまま（再保存で講師が動かない）。
 *    (2) 同じ講師が同じコマの別の机（手置き・授業あり・保留の下段）に既に居る → 置かない（同じ講師を 2 机にしない・INV-01）。
 *    (3) 先頭の空き机（授業・講師・出欠記録・メモ・削除記録・保留が無く、テンプレのその机も空）＝再マージが足場講師を置くのと同じ「先頭の空き机」。
 *    (4) 無ければ置かない（理由の行に出す）。
 *  - 対象外（従来どおり）: QR 自動割振りの講師（例外 1）・講師の削除記録（例外 2）・同じ講師・テンプレ机に生徒が居る（Q41 の 2 行、または置き換え）・
 *    保留中の下段の手置き講師が同じコマの別の机に居る（Q41-8 の「講師なし」分岐で机へ戻せない形）。
 *  - 再マージの不動点: ずらした先の講師だけの机は、再マージの足場講師の据え置き（Issue #76）で同じ講師が管理セルに居る限り残り、
 *    元の机番号の管理机（講師だけ）は盤面の机に授業があれば消費済み、無ければ「同じ講師が既に居る」で置き直されない。
 */
export function planManualTeacherDeskShifts(params: {
  desks: readonly DeskCell[]
  templateDesks: readonly DeskCell[]
  rawTemplateDesks?: readonly DeskCell[]
  pendingDesks?: TemplatePendingDeskMap | null
  cellId: string
  resolveAliases?: TeacherAliasResolver
}): ManualTeacherDeskShift[] {
  const aliases = params.resolveAliases ?? defaultTeacherAliases
  const pendingOf = (desk: DeskCell) => params.pendingDesks?.[buildTemplatePendingDeskKey(params.cellId, desk.id)]
  const isTemplateDeskEmpty = (index: number) => {
    const applied = params.templateDesks[index]
    const raw = params.rawTemplateDesks?.[index]
    const empty = (desk: DeskCell | undefined) => !desk || (!desk.teacher.trim() && liveStudents(desk.lesson).length === 0)
    return empty(applied) && empty(raw)
  }
  const hasRecords = (desk: DeskCell) => (desk.statusSlots ?? []).some(Boolean)
  const hasMemo = (desk: DeskCell) => (desk.memoSlots ?? []).some((memo) => hasMemoText(memo))
  const taken = new Set<number>()
  const shifts: ManualTeacherDeskShift[] = []
  params.desks.forEach((desk, index) => {
    const templateDesk = params.templateDesks[index]
    if (!templateDesk || !templateDesk.teacher.trim() || liveStudents(templateDesk.lesson).length > 0) return
    const pending = pendingOf(desk)
    const manualTeacher = pending?.lower.teacher ?? (isManualPlacedTeacher(desk) ? desk : null)
    if (!manualTeacher) return
    if (isSameTeacherByAliases(manualTeacher.teacher, templateDesk.teacher, aliases)) return
    if (pending?.lower.teacher && isTeacherElsewhereInCell({ desks: params.desks }, desk.id, manualTeacher, aliases)) return
    const handPlacedStudentNames = [...liveStudents(desk.lesson).filter(studentHasManualMark), ...liveStudents(pending?.lower.lesson)].map((student) => student.name)
    const base = { fromIndex: index, manualTeacher: { teacher: manualTeacher.teacher }, templateTeacher: templateDesk.teacher, handPlacedStudentNames }
    const sameTeacherAt = (other: DeskCell) => other.teacher.trim() !== '' && isSameTeacherByAliases(other.teacher, templateDesk.teacher, aliases)
    const previousTarget = params.desks.findIndex((other, j) => (
      j !== index && !taken.has(j) && sameTeacherAt(other) && !other.lesson && !other.manualTeacher && !hasRecords(other) && !pendingOf(other) && isTemplateDeskEmpty(j)
    ))
    if (previousTarget >= 0) {
      taken.add(previousTarget)
      shifts.push({ ...base, placement: { kind: 'placed', deskIndex: previousTarget } })
      return
    }
    const present = params.desks.findIndex((other, j) => j !== index && (sameTeacherAt(other) || Boolean(pendingOf(other)?.lower.teacher && isSameTeacherByAliases(pendingOf(other)!.lower.teacher!.teacher, templateDesk.teacher, aliases))))
    if (present >= 0) {
      shifts.push({ ...base, placement: { kind: 'present', deskIndex: present } })
      return
    }
    const target = params.desks.findIndex((other, j) => (
      j !== index && !taken.has(j) && !other.lesson && !other.teacher.trim() && !other.manualTeacher && !isTemplateDiffTeacherTombstone(other)
      && !hasRecords(other) && !hasMemo(other) && !pendingOf(other) && isTemplateDeskEmpty(j)
    ))
    if (target >= 0) {
      taken.add(target)
      shifts.push({ ...base, placement: { kind: 'placed', deskIndex: target } })
      return
    }
    shifts.push({ ...base, placement: { kind: 'none' } })
  })
  return shifts
}

/**
 * 机の講師を決める（Q21-9・オーナー確定 2026-09-29）。講師は突き合わせに使わない。
 *  - 例外 2：講師の削除記録（tombstone）の机 → **削除した講師と同じ講師なら**講師欄は削除のまま（記録も保持）。
 *    テンプレ机の講師が削除した講師と**別人**で、削除した講師がそのコマのテンプレのどこにも居なければ、その講師を置く
 *    （オーナー決定 2026-10-14・doesDeletedTeacherTombstoneBlock ＋ canClearDeletedTeacherTombstone）。削除した講師がテンプレの別の机に居るときは
 *    記録を残す（kept-deleted）＝別人の講師は差分反映後の再マージが空き机へ置く（削除記録の机は塞がない）。
 *  - 例外 1：QR 提出の自動割振り講師（schedule-registration＋講習期間 ID）→ そのまま残す（由来・講習期間 ID も保持）。
 *    置き換えると起動時の自己修復（reconcileSubmittedTeacherPlacements）が別の空き机へ置き直して二重化する。
 *  - テンプレ机に講師がいる → その講師（手置きの印〔manualTeacher・由来・講習期間 ID〕は外れ、テンプレ足場の講師として扱う）。
 *  - テンプレ机に講師がいない → ユーザーが置いた講師は残す／テンプレ足場の講師（非 manual）は外す（INV-02 の既存裁定）。
 */
export function resolveTemplateDeskTeacher(
  templateDesk: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'> | null | undefined,
  existingDesk: TemplateDeskTeacherFields,
  resolveAliases: TeacherAliasResolver = defaultTeacherAliases,
  /** そのコマのテンプレの全机（削除した講師が別の机に居れば記録を残す）。省略時はこの机だけで判定。 */
  cellTemplateTeachers: ReadonlyArray<Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>> = templateDesk ? [templateDesk] : [],
): {
  teacherFields: TemplateDeskTeacherFields
  reason: TemplateDeskTeacherReason
} {
  const tombstone = isTemplateDiffTeacherTombstone(existingDesk)
  if (tombstone && (doesDeletedTeacherTombstoneBlock(existingDesk, templateDesk, resolveAliases) || !canClearDeletedTeacherTombstone(existingDesk, cellTemplateTeachers, resolveAliases))) {
    return { teacherFields: pickTeacherFields(existingDesk), reason: 'kept-deleted' }
  }
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
      reason: tombstone ? 'template-over-deleted' : 'template',
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
  // Q41-13 の「ずらして置いた講師」の印は、講師が替わったら外す（置き直しの印は手順 0.5 の後処理が付け直す）。
  if (fields.teacher !== desk.teacher) delete next.templateTeacherShift
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

// 生徒を座らせるときの席の埋まり具合（Q37）: 休み・振無休の記録だけの席は空席と同じ（生徒がその上に座り、記録は残る）。
// 出席・表示専用の記録・メモ・生徒のいる席は埋まっている。記録・メモを置くときは occupancyOf を使う（記録同士は重ねない）。
function occupancyForStudents(desk: Pick<DeskCell, 'lesson' | 'statusSlots' | 'memoSlots'>): SeatOccupancy {
  return [0, 1].map((index) => {
    const record = desk.statusSlots?.[index]
    return Boolean(
      desk.lesson?.studentSlots[index]
      || (record && !isAbsenceRecordStatus(record.status))
      || hasMemoText(desk.memoSlots?.[index]),
    )
  }) as SeatOccupancy
}

// 元の席が空いていればそこ、空いていなければもう一方の空いた席。どちらも埋まっていれば -1。
function pickSeat(occupancy: SeatOccupancy, preferredIndex: number) {
  if (!occupancy[preferredIndex]) return preferredIndex
  const other = preferredIndex === 0 ? 1 : 0
  return occupancy[other] ? -1 : other
}

// ─────────────────────────────────────────────────────────────────────────────
// 席ごとの突き合わせ（オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄）
// 「生徒 1 と生徒 2 の重複は別々で処理して。そうすればテンプレ空白なら既存があれば自動で 1 行になるはず。
//   また片方が通常同士なのに 2 行になることもない。」
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 管理授業（テンプレの授業・id=`managed_…`）の席に置いた生徒が、再マージ（mergeManagedDeskLesson）で落ちずに残るか。
 * 通常授業（印なし・元の日付へ戻したもの以外）は「管理データが配置を決める」ので落ちる＝管理授業に同居させない。
 * mergeManagedDeskLesson の保持条件（lessonType !== 'regular' || manualAdded || isReturnedToOriginalDate）と同じ判定。
 * dateKey が無いときは、元の日付へ戻したかを判定できないので、印なし・手動追加でない通常授業はすべて落ちる側に倒す（保守的）。
 * ★同じ条件の写しが ScheduleBoardScreen の mergeManagedDeskLesson／mergeManagedWeek（carryover・fallback）にある。
 *   templateDiffApply.test.ts の parity テストで「管理授業の空いた席に置いて再マージした結果」と突き合わせて固定している。
 */
export function shouldSeatSurviveRemerge(student: StudentEntry, dateKey?: string) {
  if (student.lessonType !== 'regular' || student.manualAdded) return true
  if (!dateKey) return false
  return student.makeupSourceDate === dateKey || student.sameDayMoveSourceDate === dateKey
}

/**
 * テンプレの生徒（印なし）がいなくなった管理授業を、机固有の授業へ付け替える（冒頭 ★ の「残す机」と同じ約束）。
 * 「既存を採用」で上段のテンプレ生徒を取り下げ、残した既存の生徒（印あり）だけが残るときに使う（regression-reviewer M-1／L-3・2026-09-30）。
 * 管理授業の id のまま残すと、後で同じ行 id の管理授業が戻ったとき mergeManagedDeskLesson の上書きで生徒が落ちる余地がある。
 */
export function detachTemplateLessonWithoutTemplateStudents(lesson: DeskLesson | undefined, deskId: string): DeskLesson | undefined {
  if (!lesson || !isTemplateManagedLesson(lesson)) return lesson
  if (liveStudents(lesson).some((student) => !studentHasManualMark(student))) return lesson
  return detachManagedLessonIdentity(lesson, deskId)
}

/** 生徒の印（Q22 生徒単位）があるか。「既存を採用」で取り下げるテンプレの生徒（印なし）を見分けるのに使う。 */
export function isTemplateDiffMarkedStudent(student: StudentEntry) {
  return studentHasManualMark(student)
}

// ─────────────────────────────────────────────────────────────────────────────
// Q36：同日移動の通常授業（旧テンプレの授業を日の中で動かした写し）とテンプレ（オーナー指示 2026-10-03）
// 「テンプレですでに入っていた生徒を一つ早い時限に移動して、反映したら移動元のコマにも移動先のコマにも両方表示された」
// 「まだ通常同士なのに保留扱いになっています」
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 旧テンプレの通常授業を**同じ日の中で**動かした写しか（手動追加でない `lessonType='regular'` で、`sameDayMoveSourceDate` または
 * `makeupSourceDate`〔別の日へ動かして元の日付へ戻した〕がその日）。同一コマ内の机替えにも付く（Q22）。
 * 写しは「その日のテンプレの授業そのもの」なので、新テンプレが同じ日にその生徒×科目を置くなら写しは古い位置の重複、
 * テンプレがその日にその生徒×科目を持たなければ消えた授業の残骸。どちらも通常授業の決め手はテンプレ（Q21-8 の同胞）。
 * 振替・講習・手動追加の通常授業は手入力データなので対象外（従来どおり印として残る）。
 */
export function isSameDayMovedTemplateCopy(student: StudentEntry, dateKey: string) {
  if (student.lessonType !== 'regular' || student.manualAdded) return false
  return student.sameDayMoveSourceDate === dateKey || student.makeupSourceDate === dateKey
}

/**
 * Q39-9（regression-reviewer H-1・2026-10-14）: 「変えたコマだけ」の絞り込みに、**その日を全コマにする日**を足す。
 * Q36 の写しの判定（superseded／stale／collided）は日単位で、写しの検出は突き合わせるセルの中でしか動かない。写しが範囲の外の時限に居ると
 * 「テンプレで時限を移した生徒が移動元・移動先の両方に出る」（2026-10-03 の重大バグ）が再発するので、変えた机に関わる生徒
 * （sameDayMoveStudentIdsByWeekday）の写しが上段か保留の下段に居る日は、その日のセルを全部突き合わせる（写しを外したときに
 * その日のその生徒×科目の抑止キーを全時限ぶん外す resolveSameDayMoveCopyKeysToRemove の副作用も同じ日の中で収まる）。
 * 絞り込みが無い・関わる生徒が無い・写しが無いときは入力をそのまま返す。
 */
export function expandTemplateDiffSlotFilterForSameDayMoves(params: {
  weeks: SlotCell[][]
  pendingDesks: TemplatePendingDeskMap
  effectiveStartDate: string
  filter: TemplateDiffSlotFilter | null | undefined
}): TemplateDiffSlotFilter | null | undefined {
  const filter = params.filter
  if (!filter) return filter
  const byWeekday = filter.sameDayMoveStudentIdsByWeekday
  const baseFilter: TemplateDiffSlotFilter = { ...filter, fullDates: undefined }
  const fullDates = new Set(filter.fullDates ?? [])
  // 写しの日を広げる条件: (a) 変えた机に関わる生徒の写し、または (b) 範囲の中のコマに居る写し（どの生徒でも。範囲の中で collided になって外れると
  //   元の時限の抑止キーも外れ、同じ日に同じ科目がもう 1 つあると元の時限へ戻るのが保存直後の再マージになる・regression-reviewer 再検査 L）。
  const consider = (student: StudentEntry | null | undefined, cell: Pick<SlotCell, 'dateKey' | 'slotNumber'>) => {
    const dateKey = cell.dateKey
    if (!student || dateKey < params.effectiveStartDate || fullDates.has(dateKey)) return
    if (!isSameDayMovedTemplateCopy(student, dateKey)) return
    const id = student.managedStudentId
    const involved = Boolean(id) && Boolean(byWeekday?.get(resolveDayOfWeekFromDateKey(dateKey))?.has(id as string))
    if (involved || isCellInTemplateDiffScope(cell, baseFilter)) fullDates.add(dateKey)
  }
  const cellById = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) {
    cellById.set(cell.id, cell)
    for (const desk of cell.desks) for (const student of desk.lesson?.studentSlots ?? []) consider(student, cell)
  }
  for (const [key, entry] of Object.entries(params.pendingDesks)) {
    const parsed = parseTemplatePendingDeskKey(key)
    const cell = parsed ? cellById.get(parsed.cellId) : undefined
    if (!cell) continue
    for (const student of entry.lower.lesson?.studentSlots ?? []) consider(student, cell)
  }
  if (fullDates.size === (filter.fullDates?.size ?? 0)) return filter
  return { ...filter, fullDates }
}

/**
 * 写しは「その日のその生徒×科目の通常授業そのもの」なので、同じ日のその生徒×科目の抑止キーは写しの移動の履歴（多段に動かすと 1 回ごとに
 * 元の時限のキーが積まれる）。写しを外すときは**その日のその生徒×科目のキーをすべて**外す（regression-reviewer H-2(a)・2026-10-03。
 * 移動元ラベルの時限 1 つだけ外すと、5→4→3 限と動かした写しの 4 限のキーが残り、テンプレの授業がどこにも戻らない）。
 * 休み・出席の記録が積んだキーは、記録のある生徒×科目を写しとしない（`isSameDayMovedTemplateCopy` の呼び出し側のガード・H-1）ので、ここには来ない。
 */
export function resolveSameDayMoveCopyKeysToRemove(revert: Pick<SameDayMoveCopyRevert, 'student' | 'dateKey'>, suppressed: readonly string[]): string[] {
  const prefix = `${studentSubjectKey(revert.student)}__${revert.dateKey}__`
  return suppressed.filter((key) => key.startsWith(prefix))
}

/** H-2(b) の保護キー（コマ ID × 生徒 id）。写しは外しても同じ id のまま別の場所へ行かないので、これで同じ写しを指せる。 */
export function buildSameDayMoveCopyProtectionKey(cellId: string, student: Pick<StudentEntry, 'id'>) {
  return `${cellId}::${student.id}`
}

/** テンプレに合わせて外す写し 1 件（場所つき）。reason は件数表示・テストのため。 */
export type SameDayMoveCopyRevert = {
  cellId: string
  deskId: string
  row: 'upper' | 'lower'
  seat: number
  student: StudentEntry
  dateKey: string
  /**
   * superseded＝新テンプレが同じ日の別のコマにその生徒×科目を置く／stale＝テンプレ（抑止前）がその日にその生徒×科目を持たない／
   * collided＝テンプレがその日にその生徒×科目を持ち（抑止で置かれていない）、写しの席を新テンプレの別の生徒が埋める。
   */
  reason: 'superseded' | 'stale' | 'collided'
}

export function studentSubjectKey(student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'subject'>) {
  return `${student.managedStudentId ?? student.name}__${student.subject}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Q38（オーナー指示 2026-10-13）：手動追加の通常授業は、同じコマの別の机にテンプレが同じ生徒×科目を置くならテンプレを自動採用
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 手動追加の通常授業（`lessonType='regular'` かつ `manualAdded`）が、同じコマの**別の机**のテンプレ（抑止を当てた後）に
 * 同じ生徒×同じ科目の通常授業として居るか（Q38・オーナー回答 2026-10-13「手動追加の中身がテンプレと同じ場合はテンプレを自動採用としたい。
 * 中身が違う場合は重複表示のままそこのセルに置いておきたい」「対象は通常授業だけ」）。
 * 真なら既存の手動追加は外し（1 行の机からも、保留の下段〔緑〕にも残さない）、テンプレの机に任せる。机が違っても同じコマに居れば配置済み。
 * 開発用教室の実例（2026-10-13）: 10/15(木) 4 限の机 3 に手で足した通常授業（国）と、テンプレが机 13 に置く同じ生徒（国）が、
 * 机 3 の席がテンプレの別の生徒とぶつかったため下段（緑）＋机 13 の上段の 2 か所に出ていた（Q21-11 は 1 行の机しか見ないため）。
 *  - **科目が違う**同じ生徒は「中身が違う」ので対象外（従来どおり保留〔緑〕で知らせる。同じ机の同じ席でも同じ。オーナー回答 2026-10-13）。
 *  - 振替・講習・体験・増コマ、同日移動の写し（Q36・手動追加でない）、別日移動は対象外（手入力データとして従来どおり守る＝Q21-11）。
 *  - **同じ机**のテンプレは見ない（席ごとの突き合わせ `planTemplateDeskSeats` の「同じ生徒×科目×種別は採用」が従来どおり扱う）。
 *  - 評価に使うテンプレ机は Q35（丸ごと振替の日）を当てた後・Q21-11 の反復の**前**で固定する（反復と絡めず単調収束を保つ）。
 */
export function isManualRegularAdoptedByTemplateInCell(
  student: StudentEntry,
  templateDesks: readonly Pick<DeskCell, 'lesson'>[],
  deskIndex: number,
): boolean {
  if (student.lessonType !== 'regular' || !student.manualAdded) return false
  return templateDesks.some((templateDesk, index) => (
    index !== deskIndex
    && liveStudents(templateDesk.lesson).some((other) => (
      other.lessonType === 'regular' && other.subject === student.subject && isSameTemplateStudent(other, student)
    ))
  ))
}

/**
 * 写しを盤面（上段）と保留の下段から外す（Q36・純関数。入力は変えない）。外して空になった授業は机から外し、
 * 下段に生きている生徒がいなくなれば下段の授業を外す（記録・メモは残す）。
 */
export function stripSameDayMoveCopies(weeks: SlotCell[][], pendingDesks: TemplatePendingDeskMap, reverts: readonly SameDayMoveCopyRevert[]): { weeks: SlotCell[][]; pendingDesks: TemplatePendingDeskMap; stripped: SameDayMoveCopyRevert[] } {
  if (reverts.length === 0) return { weeks, pendingDesks, stripped: [] }
  const stripped: SameDayMoveCopyRevert[] = []
  const upperByCell = new Map<string, SameDayMoveCopyRevert[]>()
  const nextPending: TemplatePendingDeskMap = { ...pendingDesks }
  for (const revert of reverts) {
    if (revert.row === 'lower') {
      const key = buildTemplatePendingDeskKey(revert.cellId, revert.deskId)
      const entry = nextPending[key]
      // 席の生徒が指定の写し（id 一致）のときだけ外す（別の生徒を巻き込まない）。
      if (!entry?.lower.lesson || entry.lower.lesson.studentSlots[revert.seat]?.id !== revert.student.id) continue
      const lower = cloneTemplatePendingLower(entry.lower)
      const slots = [...lower.lesson!.studentSlots] as StudentPair
      slots[revert.seat] = null
      stripped.push(revert)
      if (slots[0] || slots[1]) lower.lesson = { ...lower.lesson!, studentSlots: slots }
      else delete lower.lesson
      nextPending[key] = { ...entry, lower }
      continue
    }
    const list = upperByCell.get(revert.cellId) ?? []
    list.push(revert)
    upperByCell.set(revert.cellId, list)
  }
  const nextWeeks = upperByCell.size === 0 ? weeks : weeks.map((week) => {
    if (!week.some((cell) => upperByCell.has(cell.id))) return week
    return week.map((cell) => {
      const list = upperByCell.get(cell.id)
      if (!list) return cell
      return {
        ...cell,
        desks: cell.desks.map((desk) => {
          const targets = list.filter((revert) => revert.deskId === desk.id && desk.lesson?.studentSlots[revert.seat]?.id === revert.student.id)
          if (targets.length === 0 || !desk.lesson) return desk
          const slots = [desk.lesson.studentSlots[0] ? { ...desk.lesson.studentSlots[0] } : null, desk.lesson.studentSlots[1] ? { ...desk.lesson.studentSlots[1] } : null] as StudentPair
          for (const revert of targets) { slots[revert.seat] = null; stripped.push(revert) }
          const next: DeskCell = { ...desk }
          if (slots[0] || slots[1]) next.lesson = { ...desk.lesson, studentSlots: slots }
          else delete next.lesson
          return next
        }),
      }
    })
  })
  return { weeks: nextWeeks, pendingDesks: nextPending, stripped }
}

export type TemplateDeskSeatCandidate = { student: StudentEntry; seat: number }

export type TemplateDeskSeatPlan = {
  /** 上段（1 行の机）の席。テンプレの生徒は席の位置固定、残した既存の生徒は空いた席。 */
  upperSlots: StudentPair
  /** 下段（保留）へ入る生徒。元の席の位置。 */
  lowerSlots: StudentPair
  /** 空いた席に残した既存の生徒（1 行側で生きる＝Q21-11 の重複判定の相手）。 */
  kept: StudentEntry[]
  /** テンプレの同じ生徒×科目×種別に採用した既存の生徒（印を外す）。 */
  adopted: StudentEntry[]
  /** 下段の席が足りなかった（整合の取れたデータでは起きない）。呼び出し側は机を変えずに扱う。 */
  overflow: boolean
}

/**
 * 1 つの机で、テンプレの生徒と既存の生徒（印のある生徒・保留の下段の生徒）を**席ごと**に突き合わせる。
 *  1. テンプレに同じ生徒×科目×種別がいる既存の生徒 → テンプレを採用（既存は捨てて印を外す・Q23）。
 *  2. テンプレに同じ生徒（科目・種別違い）がいる、またはテンプレの授業に置くと再マージで落ちる既存の生徒 → 下段（保留）。
 *     同じコマに同じ生徒を 2 か所で生かさない（INV-12）。
 *  3. 残りは、テンプレの**同じ席**（生徒 1 は生徒 1・生徒 2 は生徒 2）が空いていればそこに置く＝1 行のまま残す。
 *  4. 同じ席がテンプレの生徒で埋まっている既存の生徒だけが下段（保留）へ入る（もう一方の空いた席へはずらさない：
 *     席を勝手に動かさない。オーナーの「生徒 1 と生徒 2 を別々に」の文面どおり席ごとに比べる）。
 * テンプレの生徒は席の位置ごとそのまま（再マージの不動点）。templateLesson が無ければ既存の生徒だけで席を埋める。
 * reservedSeats（机に残す会計を持つ出欠記録の数）の分の空き席は記録のために空けておく: 記録が席を失うと上段の生徒の下に
 * 隠れ、その生徒を休みにしたときに上書きされて在庫が狂う（INV-06）。空き席が足りなければ既存の生徒の方を下段へ入れる（従来の保留）。
 */
export function planTemplateDeskSeats(templateLesson: DeskLesson | undefined, candidates: readonly TemplateDeskSeatCandidate[], dateKey: string, options: { reservedSeats?: number } = {}): TemplateDeskSeatPlan {
  const upperSlots: StudentPair = [
    templateLesson?.studentSlots[0] ? { ...templateLesson.studentSlots[0] } : null,
    templateLesson?.studentSlots[1] ? { ...templateLesson.studentSlots[1] } : null,
  ]
  const templateStudents = liveStudents(templateLesson)
  const matched = new Set<StudentEntry>()
  const adopted: StudentEntry[] = []
  const toSeat: TemplateDeskSeatCandidate[] = []
  const toLower: TemplateDeskSeatCandidate[] = []
  for (const candidate of candidates) {
    const identical = templateStudents.find((student) => (
      !matched.has(student)
      && student.subject === candidate.student.subject
      && student.lessonType === candidate.student.lessonType
      && isSameTemplateStudent(student, candidate.student)
    ))
    if (identical) {
      matched.add(identical)
      adopted.push(candidate.student)
      continue
    }
    const sameStudentInTemplate = templateStudents.some((student) => isSameTemplateStudent(student, candidate.student))
    if (sameStudentInTemplate || (templateLesson && !shouldSeatSurviveRemerge(candidate.student, dateKey))) {
      toLower.push(candidate)
      continue
    }
    toSeat.push(candidate)
  }
  const occupancy: SeatOccupancy = [Boolean(upperSlots[0]), Boolean(upperSlots[1])]
  const allowedKept = occupancy.filter((filled) => !filled).length - (options.reservedSeats ?? 0)
  const kept: StudentEntry[] = []
  for (const candidate of toSeat) {
    if (occupancy[candidate.seat] || kept.length >= allowedKept) { toLower.push(candidate); continue }
    upperSlots[candidate.seat] = { ...candidate.student }
    occupancy[candidate.seat] = true
    kept.push(candidate.student)
  }
  const lowerSlots: StudentPair = [null, null]
  let overflow = false
  for (const candidate of toLower) {
    if (!placeIntoPair(lowerSlots, candidate.seat, { ...candidate.student })) overflow = true
  }
  return { upperSlots, lowerSlots, kept, adopted, overflow }
}

function seatCandidatesOf(lesson: DeskLesson | undefined, predicate: (student: StudentEntry) => boolean = () => true): TemplateDeskSeatCandidate[] {
  const candidates: TemplateDeskSeatCandidate[] = []
  ;(lesson?.studentSlots ?? []).forEach((student, seat) => {
    if (student && predicate(student)) candidates.push({ student, seat })
  })
  return candidates
}

// 下段の生きている生徒を、机の元の席（上段の生徒・机の出欠記録・メモのない席）へ足した授業を返す。入らなければ null。
function mergeLowerStudentsIntoFreeSeats(
  desk: DeskCell,
  lowerLesson: DeskLesson,
  upperLive: readonly StudentEntry[],
  options: { liveStudentsElsewhere?: readonly Pick<StudentEntry, 'managedStudentId' | 'name'>[]; dateKey?: string },
): DeskLesson | null {
  if (!desk.lesson) return null
  const lowerCandidates = seatCandidatesOf(lowerLesson)
  const upperIsManaged = isTemplateManagedLesson(desk.lesson)
  for (const { student } of lowerCandidates) {
    if (upperLive.some((other) => isSameTemplateStudent(other, student))) return null
    if (options.liveStudentsElsewhere?.some((other) => isSameTemplateStudent(other, student))) return null
    if (upperIsManaged && !shouldSeatSurviveRemerge(student, options.dateKey)) return null
  }
  const slots: StudentPair = [desk.lesson.studentSlots[0] ? { ...desk.lesson.studentSlots[0] } : null, desk.lesson.studentSlots[1] ? { ...desk.lesson.studentSlots[1] } : null]
  // Q37: 上段の生徒を休み・振無休にして席に記録だけが残った席は空席と同じ（下段の生徒がその席へ戻り、記録は残る）。
  const occupancy = occupancyForStudents(desk)
  // 席ごと: 下段の生徒は元の席（生徒 1 は生徒 1・生徒 2 は生徒 2）が空いたときだけ戻す（もう一方の席へはずらさない）。
  for (const candidate of lowerCandidates) {
    if (occupancy[candidate.seat]) return null
    slots[candidate.seat] = { ...candidate.student }
    occupancy[candidate.seat] = true
  }
  return { ...desk.lesson, studentSlots: slots }
}

/**
 * 「既存を採用」で取り下げる上段の生徒の席（席ごと・2026-09-30）。取り下げるのはテンプレの生徒（印なし）だけで、
 *  - 下段の生きている生徒の元の席にいるテンプレの生徒
 *  - 下段の生徒と同じ生徒のテンプレの生徒（同じコマに同じ生徒を 2 か所で生かさない・INV-12）
 * 差分反映で空いた席に残した既存の生徒（印あり）と、下段と関係のない席のテンプレの生徒は取り下げない。
 * all=true は旧来（v1.5.572）の「上段のテンプレの生徒を全部取り下げる」（席ごとに戻せない旧形式の保留の予備）。
 */
export function resolveAdoptExistingWithdrawSeats(desk: Pick<DeskCell, 'lesson'>, lower: TemplatePendingLower, options: { all?: boolean } = {}): number[] {
  const upperSlots: ReadonlyArray<StudentEntry | null> = desk.lesson?.studentSlots ?? [null, null]
  const lowerSlots: ReadonlyArray<StudentEntry | null> = lower.lesson?.studentSlots ?? [null, null]
  const lowerLive = liveStudents(lower.lesson)
  const seats: number[] = []
  upperSlots.forEach((student, seat) => {
    if (!student || studentHasManualMark(student)) return
    if (options.all || lowerSlots[seat] || lowerLive.some((other) => isSameTemplateStudent(other, student))) seats.push(seat)
  })
  return seats
}

// ─────────────────────────────────────────────────────────────────────────────
// Q28：1 行に戻す（合流）
// ─────────────────────────────────────────────────────────────────────────────

export type TemplatePendingCollapseResult =
  | { ok: true; nextDesk: DeskCell }
  | { ok: false; reason: 'both-rows-live' | 'status-overflow' | 'memo-overflow' | 'duplicate-student' | 'teacher-duplicate' }

/** Q41-6/-7（INV-01）: そのコマの別の机に同じ講師が居るか（表示名・講師 ID・呼び名の対応で見る）。1 行に戻る経路・既存を採用・再保存の 3 か所が同じ判定を使う。 */
export function isTeacherElsewhereInCell(cell: { desks: readonly DeskCell[] }, deskId: string, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>, resolveAliases: TeacherAliasResolver = defaultTeacherAliases) {
  const keys = new Set<string>()
  for (const key of [teacher.teacher.trim(), teacher.teacherAssignmentTeacherId?.trim() ?? '']) if (key) for (const alias of resolveAliases(key)) keys.add(alias)
  if (keys.size === 0) return false
  return cell.desks.some((desk) => desk.id !== deskId && desk.teacher.trim() !== '' && (keys.has(desk.teacher.trim()) || (desk.teacherAssignmentTeacherId ? keys.has(desk.teacherAssignmentTeacherId.trim()) : false)))
}

/**
 * 保留（2 行）を 1 行に戻す（Q28）。どちらかの行に生きている生徒がいないときだけ合流できる。
 *  - 残った行の生徒が机になる（下段が残るなら、旧テンプレ由来の管理授業は机固有の id に付け替える）。講師は机の講師のまま。
 *  - 机の出欠記録（会計を持つ記録は元から机に残っている）はそのまま。下段の会計記録（席不足で入ったもの）は空いた席へ戻す。
 *    下段の表示専用の記録（moved / holiday）は捨てる。出欠枠（2）を超えるなら合流しない（'status-overflow'）。
 *    ★Issue #57 の台帳確定（materializeDisplacedStatusEntryIntoLedgers）は使わない（在庫を動かさない）。
 *  - 下段のメモは空いた席へ引き継ぐ。入らなければ合流しない（'memo-overflow'）。
 *  - liveStudentKeysElsewhere（同じコマの別の机で生きている生徒）を渡すと、下段を机へ戻した結果が同じコマに同じ生徒を
 *    2 か所で生かすなら止める（'duplicate-student'・Q26-4・INV-12）。
 *  - ★席ごと（オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄）: 上段と下段の両方に生きている生徒がいても、下段の生徒が
 *    全員、机の**元の席**（上段の生徒・机の出欠記録・メモのない席）に入り、上段・同じコマの別の机と同じ生徒にならず、
 *    再マージで落ちない（shouldSeatSurviveRemerge）なら 1 行へ戻す（上段の授業に下段の生徒を足す）。入らなければ 'both-rows-live'。
 */
export function computePendingDeskCollapse(desk: DeskCell, pending: Pick<TemplatePendingDesk, 'lower'>, options: {
  liveStudentsElsewhere?: readonly Pick<StudentEntry, 'managedStudentId' | 'name'>[]
  /** コマの日付（席ごとの合流で、管理授業に足した生徒が再マージで落ちないかの判定に使う）。 */
  dateKey?: string
  /**
   * Q41-6/-7: 下段に手置き講師が居る机の扱い。'auto'（既定）＝両方の行に生徒が居る間は自動で合流しない（講師の重複は利用者が決める）。
   * 上段が空になって下段が机へ戻るときは机の講師を手置き講師に戻す。'adopt'＝「既存を採用」。合流の可否は従来どおりで、戻した机の講師を手置き講師にする。
   */
  lowerTeacher?: 'auto' | 'adopt'
  /** Q41-7（INV-01）: 戻す手置き講師が同じコマの別の机に居るか（居れば auto では合流しない）。 */
  teacherElsewhere?: (teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>) => boolean
} = {}): TemplatePendingCollapseResult {
  const upperLive = liveStudents(desk.lesson)
  const lowerLive = liveStudents(pending.lower.lesson)
  const lowerTeacherMode = options.lowerTeacher ?? 'auto'
  if (lowerTeacherMode === 'auto' && pending.lower.teacher && upperLive.length > 0 && lowerLive.length > 0) return { ok: false, reason: 'both-rows-live' }
  if (lowerTeacherMode === 'auto' && pending.lower.teacher && upperLive.length === 0 && lowerLive.length > 0 && options.teacherElsewhere?.(pending.lower.teacher)) return { ok: false, reason: 'teacher-duplicate' }
  let baseLesson: DeskLesson | undefined
  if (upperLive.length > 0 && lowerLive.length > 0) {
    const merged = mergeLowerStudentsIntoFreeSeats(desk, pending.lower.lesson!, upperLive, options)
    if (!merged) return { ok: false, reason: 'both-rows-live' }
    baseLesson = merged
  } else {
    baseLesson = upperLive.length > 0
      ? desk.lesson
      : (lowerLive.length > 0 && pending.lower.lesson ? detachManagedLessonIdentity(cloneLesson(pending.lower.lesson), desk.id) : undefined)
  }

  if (upperLive.length === 0 && lowerLive.length > 0 && options.liveStudentsElsewhere?.length) {
    const duplicated = lowerLive.some((student) => options.liveStudentsElsewhere!.some((other) => isSameTemplateStudent(other, student)))
    if (duplicated) return { ok: false, reason: 'duplicate-student' }
  }

  const nextStatus: StatusPair = [desk.statusSlots?.[0] ? cloneStatusEntry(desk.statusSlots[0]) : null, desk.statusSlots?.[1] ? cloneStatusEntry(desk.statusSlots[1]) : null]
  const nextMemo: MemoPair = [desk.memoSlots?.[0] ?? null, desk.memoSlots?.[1] ?? null]
  const occupancy = occupancyOf({ lesson: baseLesson, statusSlots: nextStatus, memoSlots: nextMemo })

  const lowerStatus = pending.lower.statusSlots ?? [null, null]
  // 席を確保する記録（出席）から先に席へ（L-1）。休みの記録は席が無くても元の席（生徒の下）に残せる（Q37）。
  const lowerAccounting = sortStatusItemsForSeating(collectStatusItems(lowerStatus, (entry) => isAccountingStatus(entry.status)))
  for (const { index, entry } of lowerAccounting) {
    const seat = pickSeat(occupancy, index)
    if (seat < 0) {
      // Q37: 休み・振無休の記録は空いた席が無ければ元の席（生徒の下）に残す。記録の枠も埋まっていれば合流しない。
      if (isAbsenceRecordStatus(entry.status) && placeIntoPair(nextStatus, index, cloneStatusEntry(entry))) continue
      return { ok: false, reason: 'status-overflow' }
    }
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

  let nextDesk: DeskCell = { ...desk }
  if (baseLesson) nextDesk.lesson = baseLesson
  else delete nextDesk.lesson
  if (isEmptyPair(nextStatus)) delete nextDesk.statusSlots
  else nextDesk.statusSlots = nextStatus
  if (isEmptyPair(nextMemo, (memo) => memo != null)) delete nextDesk.memoSlots
  else nextDesk.memoSlots = nextMemo
  // Q41-7: 上段が空になって下段だけが机へ戻るとき（または「既存を採用」）は、机の講師を下段の手置き講師に戻す。下段が空で上段が残るときはテンプレの講師のまま。
  if (pending.lower.teacher && lowerLive.length > 0 && (lowerTeacherMode === 'adopt' || upperLive.length === 0)) nextDesk = applyTeacherFields(nextDesk, pending.lower.teacher)
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

/**
 * 下段から捨てる**同日移動の通常授業**（lessonType='regular' かつ sameDayMoveSourceDate）の希望回数（主セッション決定 2026-09-29・
 * Q26-1 の拡張・regression-reviewer N-2）。「テンプレを採用」「下段の削除」で捨てたとき、Q26-1 と同じ判定を当てる：
 * 操作の後の同じ日の実配置（保留中の下段は含まない＝INV-13）に同じ生徒×科目の授業が生きていなければ削除と同じ −1、生きていれば補正しない。
 * 同日移動の通常授業は元の時限の通常授業が抑止済みで、上段のテンプレの通常授業は別の生徒のことが多い。捨てたのに回数を据え置くと
 * 予定＝実績が崩れる。旧テンプレ由来の通常授業（同日移動でない）・振替・講習は従来どおり対象外（Q26-1「テンプレを採用」）。
 * 判定は resolveAdoptExistingCountAdjustments と同じ関数（別の規則を書かない）。
 */
export function resolveDiscardedLowerSameDayMoveCountAdjustments(params: {
  discardedLowerStudents: readonly StudentEntry[]
  dateKey: string
  placementsAfterDiscard: readonly SlotCell[]
}): Array<{ student: StudentEntry; dateKey: string }> {
  return resolveAdoptExistingCountAdjustments({
    // 手動追加は希望回数に数えていない（appendDeletedStudentScheduleCountAdjustment も飛ばす）ので対象外＝件数表示と台帳を食い違わせない。
    withdrawnTemplateStudents: params.discardedLowerStudents.filter((student) => student.lessonType === 'regular' && Boolean(student.sameDayMoveSourceDate) && !student.manualAdded),
    dateKey: params.dateKey,
    placementsAfterAdoption: params.placementsAfterDiscard,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Q21：差分反映の本体
// ─────────────────────────────────────────────────────────────────────────────

/** 突き合わせに使うテンプレのコマ。raw＝抑止前（印の帰属に使う）、applied＝抑止と足場講師 strip を当てた後（Q21-5）。 */
export type TemplateDiffTemplateCell = {
  raw: SlotCell
  applied: SlotCell
  /** applied に丸ごと振替の日の足場講師 strip を当てた日か（Q21-11 で後から空けた机にも同じ strip を当てる・L-7 兄弟 1）。 */
  scaffoldTeachersStripped?: boolean
  /**
   * Q40-2 休日設定した振替元（2026-10-25）: 休日の管理セルにはテンプレの授業が生成されない（Q21-6 で机は空扱い）ため、丸ごと振替した日
   * （日単位抑止あり）が休日設定のとき、その日を**開けた形**で作り同じ抑止を当てたテンプレ机。振替先へ置く生徒を拾うためだけに使い、
   * 休日のコマ自体には置かない。普通の休日（日単位抑止なし）では作らない。
   */
  closedTransferSourceDesks?: readonly DeskCell[]
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
  /** 同じコマの別の机にテンプレが同じ講師を置くため、日程表登録（QR）の講師を外した机（Q21-9 例外 1 の絞り込み・オーナー指示 2026-10-15）。 */
  qrTeacherRemoved: number
  /** 講師を削除した机にテンプレの生徒を置いた机（Q21-9 例外 2・削除した講師と同じ講師がテンプレに居て講師欄が空のままの机）。 */
  deletedTeacherDeskFilled: number
  /** 講師を削除した机に、削除した講師とは別のテンプレの講師を置いた机（Q21-9 例外 2 の改定・オーナー決定 2026-10-14）。 */
  deletedTeacherDeskReassigned: number
  /** 同じコマの別の 1 行の机に生きているため上段に置かなかった生徒（Q21-11）。 */
  skippedDuplicateStudents: number
  /**
   * 印あり＋中身が違う机を席ごとに突き合わせ、テンプレの生徒と既存の生徒（空いた席に残した生徒）を 1 行にまとめた机
   * （オーナー指示 2026-09-30。保留にならなかった机）。
   */
  seatMerged: number
  /**
   * 丸ごと振替した日（日単位抑止のある日＝振替元・振替先）なので、テンプレの生徒を置かず振替を優先した生徒（Q35・オーナー指示 2026-10-02）。
   * テンプレの生徒を変えなかったとき（抑止で元から居ない）と同じ扱いにするため、重複（Q21-11）とは別に数える。
   */
  wholeDayTransferSkippedStudents: number
  /** そのうち希望回数を −1 する生徒（同じ日の実配置に同じ生徒×科目が残らない・Q35-8・オーナー決定 2026-10-02「盤面の回数と同じ思想」）。 */
  wholeDayTransferCountAdjusted: number
  /**
   * 同じ日の中で手で動かした通常授業（同日移動・元の日付へ戻した）の写しのうち、テンプレに合わせて外した生徒の数
   * （Q36・オーナー指示 2026-10-03。新テンプレが同じ日の別のコマに置く／テンプレがその日に持たない／席で新テンプレの別の生徒とぶつかる）。
   * `computeTemplateDiffApplyForBoard` が外して数える（`computeTemplateDiffApply` 単体は候補を返すだけで 0 のまま）。
   */
  sameDayMoveCopiesReverted: number
  /**
   * 手動追加の通常授業のうち、同じコマの別の机にテンプレが同じ生徒×科目を置くので外してテンプレの机に任せた生徒の数
   * （Q38・オーナー指示 2026-10-13「手動追加の中身がテンプレと同じ場合はテンプレを自動採用」）。1 行の机・保留になる机・保留中の再保存の下段のどこから外しても数える。
   * 抑止キーは積まない（テンプレ側が置く）。科目が違う同じ生徒・振替・講習は対象外（従来どおり保留〔緑〕）。
   */
  manualRegularAdoptedByCellTemplate: number
  /** Q40-1（Issue #75 段 2）: テンプレから外した生徒の、根拠を失った振替を机から外した件数（入口が数える）。 */
  orphanedMakeupsRemoved: number
  /** Q40-2: 丸ごと振替した日に足した生徒を振替先へ置いた人数（入口が数える）。 */
  wholeDayTransferPlacedStudents: number
  /** Q40-2: 置けずに未消化振替にした人数（入口が数える。台帳へ積む分と休日の自動発生に任せる分の合計）。 */
  wholeDayTransferStockedStudents: number
  /** Q41（2026-10-21）: 手置き講師の机に手で置いた生徒が居て、テンプレの別の講師と重ねて保留（緑）にした机の数。 */
  manualTeacherPending: number
  /** Q41-11: 本条の対象外（手で置いた生徒が居ない等）で、手置き講師をテンプレの講師に替えた机の数（文言だけ・従来どおりの置き換え）。 */
  manualTeacherReplaced: number
  /** Q41-13（2026-10-22）: 手置き講師を残し、テンプレの講師だけの机を同じコマの空き机へずらした（または置かなかった）机の数。 */
  manualTeacherKept: number
}

export function createEmptyTemplateDiffApplySummary(): TemplateDiffApplySummary {
  return { replaced: 0, kept: 0, adopted: 0, pending: 0, tombstoneCleared: 0, collapsedOnCreate: 0, qrTeacherKept: 0, qrTeacherRemoved: 0, deletedTeacherDeskFilled: 0, deletedTeacherDeskReassigned: 0, skippedDuplicateStudents: 0, seatMerged: 0, wholeDayTransferSkippedStudents: 0, wholeDayTransferCountAdjusted: 0, sameDayMoveCopiesReverted: 0, manualRegularAdoptedByCellTemplate: 0, orphanedMakeupsRemoved: 0, wholeDayTransferPlacedStudents: 0, wholeDayTransferStockedStudents: 0, manualTeacherPending: 0, manualTeacherReplaced: 0, manualTeacherKept: 0 }
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
  /**
   * Q36 で外さない写し（`buildSameDayMoveCopyProtectionKey` のキー）。入口 `computeTemplateDiffApplyForBoard` が、外した結果その日の通常授業が
   * どこにも残らなかった写し（regression-reviewer H-2(b): 移動先のコマで Q21-11 がテンプレの生徒を置かない等）を守って再計算するために渡す。
   */
  protectedSameDayMoveCopies?: ReadonlySet<string>
  /** 講師の呼び名（ID・登録名・表示名）を同じ講師にまとめる（削除記録と同じ講師かの判定・2026-10-14）。無ければ文字列一致だけ。 */
  teacherAliases?: TeacherAliasResolver
  /**
   * Q39（オーナー案 2026-10-14・Issue #75）: テンプレで変えたコマ（曜日×時限）だけ突き合わせる絞り込み。無ければ従来どおり全コマ。
   * 絞り込みの外のセルは反映日より前のセルと同じく**参照ごと**返す（＝保存しなかったのと同じ。件数にも出ない）。
   */
  slotFilter?: TemplateDiffSlotFilter | null
  /** Q40-3（2026-10-21）: 精算済み判定の材料（在庫の正本の origin・希望回数の補正）。省略不可（省略できると精算済みの判定が黙って変わる）。 */
  wholeDayTransferSettlement: Pick<WholeDayTransferSettlementInput, 'originDatesByKey' | 'scheduleCountAdjustments'>
}

export type ComputeTemplateDiffApplyResult = {
  nextWeeks: SlotCell[][]
  nextPendingDesks: TemplatePendingDeskMap
  summary: TemplateDiffApplySummary
  /** Q21-11（重複）と Q35（丸ごと振替した日）で上段に置かなかった生徒の通常授業の抑止キー（保存時に抑止へ足す）。 */
  addedSuppressedRegularLessonOccurrences: string[]
  /** Q35 で置かなかったテンプレの生徒（テンプレの机番号・席つき）。入口の Q40-2 が振替先へ置くのに使う。 */
  wholeDayTransferSkipped: Array<{ student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number; seatIndex: number }>
  /** Q40-3: wholeDayTransferSkipped のうち精算済み（置かず・未消化にせず・−1 もしない）の生徒。配置計画は同じ要素参照で除外する。 */
  wholeDayTransferSettled: Array<{ student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number; seatIndex: number }>
  /** Q21-11 で上段に置かなかった生徒（同じコマの別の 1 行の机に同じ生徒が生きている）。確認の画面に名前と理由を出すため（2026-10-21・tp-56 case1）。 */
  skippedDuplicates: Array<{ student: StudentEntry; dateKey: string; slotNumber: number }>
  /** Q41: 手置き講師の扱い（重ねて保留／テンプレの講師に替えた）。確認の画面の理由の行に出す。 */
  teacherNotes: TemplateDiffTeacherNote[]
  /**
   * Q35 で置かなかった生徒のうち、希望回数を −1 する生徒×日付（Q35-8・オーナー決定 2026-10-02）。判定は「既存を採用」と同じ
   * resolveAdoptExistingCountAdjustments（保存後の同じ日の実配置に同じ生徒×科目が生きていなければ −1）。保存が
   * resolveDeletedStudentCountAccounting（単発削除と同じ）で積む。この関数は台帳を触らない。
   */
  wholeDayTransferCountAdjustments: Array<{ student: StudentEntry; dateKey: string }>
  /**
   * Q36: テンプレに合わせて外すべき同日移動の写し（この関数は検出するだけで盤面は変えない）。
   * `computeTemplateDiffApplyForBoard` がこれを盤面・保留から外し、写しの抑止キーを外して、テンプレの授業が元の位置へ戻るまで反復する。
   */
  sameDayMoveCopyReverts: SameDayMoveCopyRevert[]
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

/**
 * 管理授業の生徒が全員抑止された机の形（講師名は残し、授業と講師の割り当て情報を外す）。
 * 再マージの suppressManagedStudentsInCell（ScheduleBoardScreen.tsx）と差分反映の Q21-11（filterTemplateDeskStudents）の
 * 両方がこれを呼ぶ。片方だけ形を変えると保存結果が再マージの不動点でなくなる（regression-reviewer L-7・INV-02 / INV-03）。
 */
export function buildFullySuppressedManagedDesk(desk: DeskCell): DeskCell {
  return {
    ...desk,
    teacher: desk.teacher,
    manualTeacher: false,
    teacherAssignmentSource: undefined,
    teacherAssignmentSessionId: undefined,
    teacherAssignmentTeacherId: undefined,
    lesson: undefined,
  }
}

/**
 * 丸ごと振替の日の「生徒のいない机の講師（テンプレ足場講師）」を落とした形（授業のある机はそのまま）。
 * 再マージの stripTemplateScaffoldTeachers（ScheduleBoardScreen.tsx）と差分反映の Q21-11 の両方がこれを呼ぶ。
 * 再マージは「抑止 → strip」の順なので、Q21-11 で生徒を全員外した机にも strip を当てないと、丸ごと振替の日に
 * 保存結果の講師名が再マージで消える（regression-reviewer L-7 兄弟 1・INV-02 / INV-03）。
 */
export function stripTemplateScaffoldTeacherDesk(desk: DeskCell): DeskCell {
  if (desk.lesson) return desk
  return {
    ...desk,
    teacher: '',
    manualTeacher: false,
    teacherAssignmentSource: undefined,
    teacherAssignmentSessionId: undefined,
    teacherAssignmentTeacherId: undefined,
  }
}

function filterTemplateDeskStudents(desk: DeskCell, excluded: readonly StudentEntry[], options: { stripScaffoldTeacher: boolean }): { desk: DeskCell; removed: StudentEntry[] } {
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
  // 管理授業の生徒が全員抑止されたときの形（再マージの suppressManagedStudentsInCell と同じ関数で作る）。
  // 回帰防止（regression-reviewer L-7・2026-09-30）: teacherAssignmentTeacherId も外す。再マージは抑止で空になった机の講師を
  // ID なしで置き直すため、ここで ID を残すと保存結果が再マージの不動点にならない（INV-02 / INV-03・置き換えと残すの両経路）。手で写さない。
  // 丸ごと振替の日は再マージと同じ順（抑止 → 足場講師 strip）で strip も当てる（L-7 兄弟 1）。
  if (!slots[0] && !slots[1]) {
    const suppressed = buildFullySuppressedManagedDesk(desk)
    return { desk: options.stripScaffoldTeacher ? stripTemplateScaffoldTeacherDesk(suppressed) : suppressed, removed }
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
  // 席を確保する記録（出席）から先に席へ入れる（regression-reviewer L-1・2026-10-03）。休みの記録が先に空き席を取ると、出席が下段へ追い出されて
  // 保留中は日程表・給与から消える。休みの記録は席が無くても生徒の下に残せる（Q37）ので後回しでよい。
  for (const item of sortStatusItemsForSeating(params.keptStatus)) {
    const seat = pickSeat(occupancy, item.index)
    if (seat < 0) {
      // Q37: 休み・振無休の記録は空いた席が無ければ元の席（上段の生徒の下）に残す（下段へ退避しない・1 行を妨げない）。
      if (isAbsenceRecordStatus(item.entry.status) && placeIntoPair(statusSlots, item.index, cloneStatusEntry(item.entry))) continue
      overflowStatus.push(item)
      continue
    }
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

// 記録を席へ入れる順（L-1）: 席を確保する会計記録（出席）→ 休み・振無休 → 表示専用。同じ区分の中は元の順（席番号順）。
function statusSeatingPriority(status: StudentStatusKind) {
  if (isSeatReservingStatus(status)) return 0
  if (isAbsenceRecordStatus(status)) return 1
  return 2
}

function sortStatusItemsForSeating<T extends { entry: StudentStatusEntry }>(items: readonly T[]): T[] {
  return items.map((item, order) => ({ item, order })).sort((a, b) => (statusSeatingPriority(a.item.entry.status) - statusSeatingPriority(b.item.entry.status)) || (a.order - b.order)).map(({ item }) => item)
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
 * テンプレ保存の差分反映（Q21・Q21-11・Q24-1・Q28-6・Q29・Q35）。保存本体と確認文の件数の両方がこれを呼ぶ（Q32-1）。
 * 反映日より前のセル・週は**参照ごと**そのまま返す（INV-10）。
 */
export function computeTemplateDiffApply(params: ComputeTemplateDiffApplyParams): ComputeTemplateDiffApplyResult {
  const summary = createEmptyTemplateDiffApplySummary()
  const nextPendingDesks: TemplatePendingDeskMap = { ...params.pendingDesks }
  const addedSuppressed = new Set<string>()
  const existingSuppressed = new Set(params.suppressedRegularLessonOccurrences)
  const wholeDayTransferSkipped: Array<{ student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number; seatIndex: number }> = []
  const skippedDuplicates: Array<{ student: StudentEntry; dateKey: string; slotNumber: number }> = []
  const teacherNotes: TemplateDiffTeacherNote[] = []
  const sameDayMoveCopyReverts: SameDayMoveCopyRevert[] = []
  // Q36 H-1（regression-reviewer 2026-10-03）: その日に同じ生徒×科目の**会計を持つ出欠記録**（休み・振無休・出席）がある生徒は写しとしない。
  // 在庫から振替を元の日付に置いたコマは `normalizeLessonPlacement` で regular＋makeupSourceDate＝その日になり、写しと同じ形になるが、
  // 休みの記録（在庫の発生）が同じ日に残っている。写しと見なして外すと在庫が増え、休みのキーまで外すと休んだ時限に通常授業が湧く。
  // 本当の同日移動は移動元に会計記録を残さない（残るのは表示専用の moved）ので、この区別で足りる。
  const accountingByDate = new Map<string, Set<string>>()
  const noteAccounting = (dateKey: string, slots: StatusPair | undefined) => {
    for (const entry of slots ?? []) {
      if (!entry || !isAccountingStatus(entry.status)) continue
      const keys = accountingByDate.get(dateKey) ?? new Set<string>()
      keys.add(studentSubjectKey(entry))
      accountingByDate.set(dateKey, keys)
    }
  }
  const dateKeyByCellId = new Map<string, string>()
  for (const week of params.weeks) for (const cell of week) {
    dateKeyByCellId.set(cell.id, cell.dateKey)
    for (const desk of cell.desks) noteAccounting(cell.dateKey, desk.statusSlots)
  }
  for (const [key, entry] of Object.entries(params.pendingDesks)) {
    const parsed = parseTemplatePendingDeskKey(key)
    const dateKey = parsed ? dateKeyByCellId.get(parsed.cellId) : undefined
    if (dateKey) noteAccounting(dateKey, entry.lower.statusSlots)
  }
  const templateById = new Map(params.templateCells.map((entry) => [entry.applied.id, entry]))
  const templateByDateSlot = new Map(params.templateCells.map((entry) => [buildDateSlotKey(entry.applied), entry]))
  // Q36: 日ごとの「新テンプレが置く生徒×科目 → コマ ID」（抑止後・丸ごと振替の日は置かないので除く・休日のコマは空）と、
  // 「テンプレ（抑止前）がその日に持つ生徒×科目」。写しが重複か残骸かの判定に使う。
  const templatePlacedByDate = new Map<string, Map<string, Set<string>>>()
  const templateRawByDate = new Map<string, Set<string>>()
  for (const entry of params.templateCells) {
    if (!entry.applied.isOpenDay) continue
    const rawKeys = templateRawByDate.get(entry.raw.dateKey) ?? new Set<string>()
    for (const desk of entry.raw.desks) for (const student of liveStudents(desk.lesson)) rawKeys.add(studentSubjectKey(student))
    templateRawByDate.set(entry.raw.dateKey, rawKeys)
    if (entry.scaffoldTeachersStripped) continue
    const placed = templatePlacedByDate.get(entry.applied.dateKey) ?? new Map<string, Set<string>>()
    for (const desk of entry.applied.desks) {
      for (const student of liveStudents(desk.lesson)) {
        const key = studentSubjectKey(student)
        const cells = placed.get(key) ?? new Set<string>()
        cells.add(entry.applied.id)
        placed.set(key, cells)
      }
    }
    templatePlacedByDate.set(entry.applied.dateKey, placed)
  }

  const nextWeeks = params.weeks.map((week) => {
    const lastDateKey = week.reduce((max, cell) => (cell.dateKey > max ? cell.dateKey : max), '')
    if (lastDateKey < params.effectiveStartDate) return week
    return week.map((cell) => {
      // 禁忌: テンプレ反映日より前のコマ表は不変（INV-10・Q1）。
      if (cell.dateKey < params.effectiveStartDate) return cell
      // Q39: テンプレで変えたコマだけ突き合わせる（絞り込みの外は参照ごと不変）。
      if (!isCellInTemplateDiffScope(cell, params.slotFilter)) return cell
      const templateCell = templateById.get(cell.id) ?? templateByDateSlot.get(buildDateSlotKey(cell))
      if (!templateCell) return cell
      return applyTemplateDiffToCell({
        teacherAliases: params.teacherAliases,
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
        wholeDayTransferSkipped,
        skippedDuplicates,
        teacherNotes,
        sameDayMoveCopyReverts,
        templatePlacedOnDate: templatePlacedByDate.get(cell.dateKey),
        templateRawOnDate: templateRawByDate.get(cell.dateKey),
        accountingOnDate: accountingByDate.get(cell.dateKey),
        protectedSameDayMoveCopies: params.protectedSameDayMoveCopies,
      })
    })
  })

  // Q35-8: 置かなかった生徒の希望回数（日ごとに「既存を採用」と同じ判定）。
  // 二重計上の防止（regression-reviewer M-1 → 2026-10-21 H-A で再改定）: その日の授業がもう説明されている（精算済み）生徒は −1 しない。
  // 判定は権威関数 resolveWholeDayTransferSettlement（Q40-2 の配置計画と同じ集合を使う＝判定を 2 か所に分けない）。
  const wholeDayTransferSettledSet = resolveWholeDayTransferSettlement(wholeDayTransferSkipped, {
    weeks: params.weeks, pendingDesks: params.pendingDesks, templateCells: params.templateCells, suppressedRegularLessonOccurrences: params.suppressedRegularLessonOccurrences,
    originDatesByKey: params.wholeDayTransferSettlement.originDatesByKey, scheduleCountAdjustments: params.wholeDayTransferSettlement.scheduleCountAdjustments,
  })
  const skippedDates = [...new Set(wholeDayTransferSkipped.map((item) => item.dateKey))]
  const wholeDayTransferCountAdjustments = skippedDates.flatMap((dateKey) => resolveAdoptExistingCountAdjustments({
    withdrawnTemplateStudents: wholeDayTransferSkipped.filter((item) => item.dateKey === dateKey && !wholeDayTransferSettledSet.has(item)).map((item) => item.student),
    dateKey,
    placementsAfterAdoption: nextWeeks.flat(),
  }))
  summary.wholeDayTransferCountAdjusted = wholeDayTransferCountAdjustments.length

  return {
    nextWeeks,
    nextPendingDesks,
    summary,
    addedSuppressedRegularLessonOccurrences: [...addedSuppressed],
    wholeDayTransferCountAdjustments,
    wholeDayTransferSkipped,
    wholeDayTransferSettled: wholeDayTransferSkipped.filter((item) => wholeDayTransferSettledSet.has(item)),
    skippedDuplicates,
    teacherNotes,
    sameDayMoveCopyReverts,
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
  wholeDayTransferSkipped: Array<{ student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number; seatIndex: number }>
  skippedDuplicates: Array<{ student: StudentEntry; dateKey: string; slotNumber: number }>
  teacherNotes: TemplateDiffTeacherNote[]
  sameDayMoveCopyReverts: SameDayMoveCopyRevert[]
  /** Q36: その日に新テンプレが置く生徒×科目 → 置くコマ ID（抑止後）。 */
  templatePlacedOnDate: ReadonlyMap<string, ReadonlySet<string>> | undefined
  /** Q36: その日にテンプレ（抑止前）が持つ生徒×科目。 */
  templateRawOnDate: ReadonlySet<string> | undefined
  /** Q36 H-1: その日に会計を持つ出欠記録（休み・振無休・出席）がある生徒×科目（写しとしない）。 */
  accountingOnDate: ReadonlySet<string> | undefined
  teacherAliases: TeacherAliasResolver | undefined
  /** Q36 H-2(b): 外さない写し（`buildSameDayMoveCopyProtectionKey`）。 */
  protectedSameDayMoveCopies: ReadonlySet<string> | undefined
}): SlotCell {
  const { cell, templateCell, summary } = context
  // Q21-6：休日のコマはテンプレ机を「空」とみなす。
  const isClosed = !templateCell.applied.isOpenDay
  let rawTemplateDesks = cell.desks.map((_, index) => (isClosed ? EMPTY_TEMPLATE_DESK : (templateCell.raw.desks[index] ?? EMPTY_TEMPLATE_DESK)))
  const appliedTemplateDesks = cell.desks.map((_, index) => (isClosed ? EMPTY_TEMPLATE_DESK : (templateCell.applied.desks[index] ?? EMPTY_TEMPLATE_DESK)))

  // ── 0'. Q40-2 休日設定した振替元（オーナー承認 2026-10-25・テスト教室 tp-48/tp-49/tp-51 の真因）: 丸ごと振替した日（日単位抑止あり）を
  //   後から「休日設定」しても、テンプレで足した生徒は振替先へ置く対象（wholeDayTransferSkipped）に拾う。休日のコマはテンプレ机を空とみなす
  //   （Q21-6）ので、拾わないと手順 0 が走らず Q40-2 が起動せず、未消化（テンプレ行×休日の自動発生）へ逃げていた（休校日だから丸ごと振替する
  //   →元の日を休日設定、の順は実運用で普通）。置くのは振替先（入口 computeTemplateDiffApplyForBoard の planWholeDayTransferPlacements）で、
  //   この休日のコマ自体には置かない。移動元記録が無い（振替先の日そのもの等）なら置かれず、休日なので −1 も積まない（入口が休日の −1 を外す）。
  //   抑止キーは手順 0 と同じく積む（再保存で二重に拾わない＝不動点）。日単位抑止の無い普通の休日は従来どおり何もしない（回帰防止テストあり）。
  if (isClosed && templateCell.scaffoldTeachersStripped && templateCell.closedTransferSourceDesks) {
    templateCell.closedTransferSourceDesks.forEach((templateDesk, deskIndex) => {
      if (deskIndex >= cell.desks.length) return
      for (const student of liveStudents(templateDesk.lesson)) {
        const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
        if (context.existingSuppressed.has(key)) continue
        summary.wholeDayTransferSkippedStudents += 1
        const seatIndex = Math.max(0, (templateDesk.lesson?.studentSlots ?? []).findIndex((seat) => seat === student))
        context.wholeDayTransferSkipped.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex, seatIndex })
        context.addedSuppressed.add(key)
      }
    })
  }

  // ── Q36（オーナー指示 2026-10-03）: 同じ日の中で手で動かした通常授業の写しは、テンプレに合わせる（検出だけ。外すのは呼び出し側）。
  //   superseded＝新テンプレが同じ日の**別のコマ**に同じ生徒×科目を置く（移動元・移動先の両方に出る二重配置の原因）
  //   stale＝テンプレ（抑止前）がその日にその生徒×科目を持たない（テンプレから消した／別の曜日へ移した授業の残骸）
  //   collided＝テンプレがその日に持つが写しの抑止で置かれておらず、写しの席を新テンプレの別の生徒が埋める（「通常同士なのに保留」）→ 下の席ごとの突き合わせで検出
  //   同じコマの別の机に 1 行で残る写し（席が空いている）は従来どおり残す（Q21-11: その机の手置きが勝ち、テンプレの生徒はそのコマに置かない）。
  const pushRevert = (desk: DeskCell, row: 'upper' | 'lower', seat: number, student: StudentEntry, reason: SameDayMoveCopyRevert['reason']) => {
    if (context.sameDayMoveCopyReverts.some((item) => item.cellId === cell.id && item.deskId === desk.id && item.row === row && item.seat === seat)) return
    context.sameDayMoveCopyReverts.push({ cellId: cell.id, deskId: desk.id, row, seat, student, dateKey: cell.dateKey, reason })
  }
  // 写しか（Q36-1）＋ H-1 のガード（その日に会計記録のある生徒×科目は写しとしない）＋ H-2(b) の保護（外すと授業が消える写し）。
  const isRevertibleCopy = (student: StudentEntry) => isSameDayMovedTemplateCopy(student, cell.dateKey)
    && !context.accountingOnDate?.has(studentSubjectKey(student))
    && !context.protectedSameDayMoveCopies?.has(buildSameDayMoveCopyProtectionKey(cell.id, student))
  const resolveCopyReason = (student: StudentEntry): SameDayMoveCopyRevert['reason'] | null => {
    if (isClosed || !isRevertibleCopy(student)) return null
    const key = studentSubjectKey(student)
    const placedCells = context.templatePlacedOnDate?.get(key)
    if (placedCells && [...placedCells].some((cellId) => cellId !== cell.id)) return 'superseded'
    if (!context.templateRawOnDate?.has(key)) return 'stale'
    return null
  }
  cell.desks.forEach((desk) => {
    ;(desk.lesson?.studentSlots ?? []).forEach((student, seat) => {
      const reason = student ? resolveCopyReason(student) : null
      if (student && reason) pushRevert(desk, 'upper', seat, student, reason)
    })
    const pending = context.pendingDesks[buildTemplatePendingDeskKey(cell.id, desk.id)]
    ;(pending?.lower.lesson?.studentSlots ?? []).forEach((student, seat) => {
      const reason = student ? resolveCopyReason(student) : null
      if (student && reason) pushRevert(desk, 'lower', seat, student, reason)
    })
  })
  // collided: 席ごとの突き合わせで下段へ入る写し（新テンプレの別の生徒が席を埋めた）。写しは上段（机）か下段（保留中の再保存）から来る。
  const collectCollidedCopies = (desk: DeskCell, pending: TemplatePendingDesk | undefined, plan: TemplateDeskSeatPlan) => {
    if (isClosed) return
    for (const student of plan.lowerSlots) {
      if (!student || !isRevertibleCopy(student)) continue
      // 写しの所在は id で引く（planTemplateDeskSeats は下段の席が埋まっていればもう一方の席へ置くので、plan 上の席番号は元の席と限らない）。
      const upperSeat = (desk.lesson?.studentSlots ?? []).findIndex((item) => item?.id === student.id)
      if (upperSeat >= 0) { pushRevert(desk, 'upper', upperSeat, student, 'collided'); continue }
      const lowerSeat = (pending?.lower.lesson?.studentSlots ?? []).findIndex((item) => item?.id === student.id)
      if (lowerSeat >= 0) pushRevert(desk, 'lower', lowerSeat, student, 'collided')
    }
  }

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

  // 席ごとの突き合わせ（オーナー指示 2026-09-30・planTemplateDeskSeats）。
  //  - 'pending'（印あり＋中身が違う）… 机の印のある生きている生徒を候補にする（印のない通常生徒＝旧テンプレ由来は置き換える・Q21-8）。
  //    印のある生きている生徒がいなければ null（記録・メモだけの机＝従来どおり保留を作ってその場で 1 行へ・Q28-6）。
  //  - 'pending-rebase'（保留中の再保存・Q29）… 上段に残した既存の生徒（印あり）と下段の印のある生徒を候補にする。
  // 席を確保する記録＝出席だけ（Q37: 休み・振無休の記録は空席と同じ扱い。その席に残した生徒の下に記録が残る）。
  const accountingCount = (slots: StatusPair | undefined) => (slots ?? []).filter((entry) => entry && isSeatReservingStatus(entry.status)).length
  // Q38（オーナー指示 2026-10-13）: 手動追加の通常授業のうち、同じコマの別の机にテンプレ（Q35 を当てた後・Q21-11 の反復の前で固定）が
  // 同じ生徒×科目を置くものは、席の候補にも 1 行の机にも残さずテンプレの机に任せる（手順 0 の後で adoptionTemplateDesks を確定する）。
  let adoptionTemplateDesks: readonly DeskCell[] = appliedTemplateDesks
  const isAdoptedByCellTemplate = (student: StudentEntry, deskIndex: number) => isManualRegularAdoptedByTemplateInCell(student, adoptionTemplateDesks, deskIndex)
  const keepsInOneRow = (deskIndex: number) => (student: StudentEntry) => studentHasManualMark(student) && !isAdoptedByCellTemplate(student, deskIndex)
  const markedSeatCandidates = (desk: DeskCell, decision: DeskDecision): TemplateDeskSeatCandidate[] => {
    if (decision.kind === 'pending') return seatCandidatesOf(desk.lesson, studentHasManualMark)
    if (decision.kind === 'pending-rebase') {
      return [
        ...seatCandidatesOf(desk.lesson, studentHasManualMark),
        ...seatCandidatesOf(decision.pending.lower.lesson, studentHasManualMark),
      ]
    }
    return []
  }
  /** Q38 でテンプレの机に任せる（席の候補から外す）手動追加の通常授業。件数表示用（保存本体と確認文が同じ関数で数える・Q32）。 */
  const cellAdoptedStudents = (desk: DeskCell, decision: DeskDecision, deskIndex: number): StudentEntry[] => {
    if (decision.kind === 'keep') return liveStudents(desk.lesson).filter((student) => isAdoptedByCellTemplate(student, deskIndex))
    return markedSeatCandidates(desk, decision).map((candidate) => candidate.student).filter((student) => isAdoptedByCellTemplate(student, deskIndex))
  }
  const planSeatsFor = (desk: DeskCell, decision: DeskDecision, templateDesk: DeskCell, deskIndex: number): TemplateDeskSeatPlan | null => {
    if (decision.kind !== 'pending' && decision.kind !== 'pending-rebase') return null
    const marked = markedSeatCandidates(desk, decision)
    // 'pending' で印のある生きている生徒がいなければ null（記録・メモだけの机＝Q28-6）。Q38 で全員外した机は候補 0 の plan（＝テンプレを採用）。
    if (decision.kind === 'pending' && marked.length === 0) return null
    const candidates = marked.filter((candidate) => !isAdoptedByCellTemplate(candidate.student, deskIndex))
    const reservedSeats = decision.kind === 'pending'
      ? accountingCount(desk.statusSlots)
      : accountingCount(desk.statusSlots) + accountingCount(decision.pending.lower.statusSlots)
    return planTemplateDeskSeats(templateLessonOf(templateDesk), candidates, cell.dateKey, { reservedSeats })
  }

  // 1 行の机として机に残る「テンプレ以外の生きている生徒」（Q21-11 の重複判定の相手）。
  // 席ごとの突き合わせで空いた席に残した既存の生徒も 1 行側で生きるので数える（2026-09-30）。
  // Q38 でテンプレの机に任せる手動追加の通常授業は数えない（数えると Q21-11 がテンプレ側を外し、生徒がどこにも無くなる）。
  // Q41（2026-10-21・regression-reviewer M-3）: 手置き講師の机（講師ごと保留）では残した席の生徒も下段へ移るので、1 行で生きる生徒には数えない。
  const isManualTeacherOverlapDesk = (desk: DeskCell, decision: DeskDecision, templateDesk: DeskCell, plan: TemplateDeskSeatPlan | null) => {
    if (!plan || plan.overflow || liveStudents(templateDesk.lesson).length === 0) return false
    const existingTeacher = decision.kind === 'pending-rebase' && decision.pending.lower.teacher ? decision.pending.lower.teacher : desk
    if (decision.kind !== 'pending' && !(decision.kind === 'pending-rebase' && decision.pending.lower.teacher)) return false
    return resolveManualTeacherOverlap({ existingTeacher, templateDesk, handPlacedStudents: [...plan.kept, ...liveStudents({ id: '', studentSlots: plan.lowerSlots })], resolveAliases: context.teacherAliases })
  }
  const oneRowNonTemplateLiveStudents = (desk: DeskCell, decision: DeskDecision, templateDesk: DeskCell, deskIndex: number): StudentEntry[] => {
    if (decision.kind === 'keep') return liveStudents(stripUnmarkedRegularStudents(desk.lesson, desk.id, keepsInOneRow(deskIndex)))
    const plan = planSeatsFor(desk, decision, templateDesk, deskIndex)
    if (isManualTeacherOverlapDesk(desk, decision, templateDesk, plan)) return []
    return plan && !plan.overflow ? plan.kept : []
  }

  // ── 0. Q35（オーナー指示 2026-10-02・確認リスト v1.5.573 tp-22）: 丸ごと振替した日（日単位抑止 TEMPLATE_TEACHER__DAY__ のある日＝
  //   振替元・振替先）は、テンプレの生徒を置かない。丸ごと振替は「その日の姿ごと別日へ移す」操作で、テンプレの生徒を変えなかったときは
  //   row-scan の抑止で元からテンプレの生徒が居ない（= 既存の振替が 1 行のまま残る）。生徒を変えたとき（新しい生徒には抑止キーが無い）も
  //   同じ扱いにし、振替を優先する（重複として 2 行にしない）。置かなかった生徒には Q21-11 と同じく抑止キーを積み、再マージの不動点を保つ
  //   （INV-02 / INV-03）。机の形は Q21-11 で全員外した机と同じ（抑止 → 足場講師 strip の順・stripTemplateScaffoldTeacherDesk）。
  let templateDesks = appliedTemplateDesks
  if (templateCell.scaffoldTeachersStripped) {
    templateDesks = templateDesks.map((templateDesk, deskIndex) => {
      const filtered = filterTemplateDeskStudents(templateDesk, liveStudents(templateDesk.lesson), { stripScaffoldTeacher: true })
      for (const student of filtered.removed) {
        summary.wholeDayTransferSkippedStudents += 1
        // Q40-2: 振替先へ置くために、テンプレの机番号と席を添える（入口 computeTemplateDiffApplyForBoard が使う）。
        const seatIndex = Math.max(0, (templateDesk.lesson?.studentSlots ?? []).findIndex((seat) => seat === student))
        context.wholeDayTransferSkipped.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex, seatIndex })
        const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
        if (!context.existingSuppressed.has(key)) context.addedSuppressed.add(key)
      }
      return filtered.desk
    })
  }
  // ── 0.5 Q41-13（オーナー指示 2026-10-22）: 手入力講師の机はテンプレで上書きしない。テンプレのその机が講師だけ（生徒なし）で盤面のその机に
  //   手置き講師（保留中は下段の手置き講師）が居て別の講師なら、テンプレの講師を同じコマの空き机へ詰めてずらす（判定・置き先は権威関数
  //   planManualTeacherDeskShifts）。以降の突き合わせはずらした後のテンプレ机で行う＝手置き講師の机は「テンプレ机に講師が居ない」になり、
  //   Q21-9 で手置き講師が残り、手で置いた生徒もその講師の担当のまま 1 行（2 行にしない）。raw も講師だけ同じにずらす（Q35-7 の keepsWholeDayTeacher・
  //   削除記録の突き合わせが見る。raw の生徒は動かさない＝抑止の帰属は元の机のまま）。
  const teacherShifts = planManualTeacherDeskShifts({ desks: cell.desks, templateDesks, rawTemplateDesks, pendingDesks: context.pendingDesks, cellId: cell.id, resolveAliases: context.teacherAliases })
  if (teacherShifts.length > 0) {
    const shifted = [...templateDesks]
    const shiftedRaw = [...rawTemplateDesks]
    for (const shift of teacherShifts) {
      const from = shifted[shift.fromIndex]
      const fromRaw = shiftedRaw[shift.fromIndex]
      shifted[shift.fromIndex] = { ...from, teacher: '', teacherAssignmentTeacherId: undefined }
      shiftedRaw[shift.fromIndex] = { ...fromRaw, teacher: '', teacherAssignmentTeacherId: undefined }
      if (shift.placement.kind === 'placed') {
        const to = shift.placement.deskIndex
        shifted[to] = { ...shifted[to], teacher: from.teacher, teacherAssignmentTeacherId: from.teacherAssignmentTeacherId }
        shiftedRaw[to] = { ...shiftedRaw[to], teacher: fromRaw.teacher || from.teacher, teacherAssignmentTeacherId: fromRaw.teacherAssignmentTeacherId ?? from.teacherAssignmentTeacherId }
      }
      summary.manualTeacherKept += 1
      context.teacherNotes.push({ kind: 'teacher-kept', teacherName: shift.manualTeacher.teacher, templateTeacher: shift.templateTeacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber, keptStudentNames: shift.handPlacedStudentNames, placement: shift.placement })
    }
    templateDesks = shifted
    rawTemplateDesks = shiftedRaw
  }
  // Q38: 手動追加の通常授業をテンプレの机に任せるかは、Q35 を当てた後・Q21-11 の反復の前のテンプレ机で固定する。
  adoptionTemplateDesks = templateDesks
  let decisions = cell.desks.map((desk, index) => classify(desk, index, templateDesks[index]))
  const skippedByDesk = cell.desks.map(() => [] as StudentEntry[])
  // ── 2. Q21-11：同じコマの別の 1 行の机に生きている生徒は上段に置かない（振り分けが安定するまで繰り返す）。
  // テンプレ側の生徒は反復ごとに減るだけ（単調）なので、テンプレの生徒数＋1 回で必ず収束する（席ごとの突き合わせで「残した既存の生徒」が
  // テンプレの中身に依存するようになったため、机の数では足りない連鎖がありうる・regression-reviewer L-4）。
  const iterationLimit = appliedTemplateDesks.reduce((sum, desk) => sum + liveStudents(desk.lesson).length, 0) + 1
  for (let iteration = 0; iteration <= iterationLimit; iteration += 1) {
    const livingByDesk = cell.desks.map((desk, index) => oneRowNonTemplateLiveStudents(desk, decisions[index], templateDesks[index], index))
    let changed = false
    const nextTemplateDesks = templateDesks.map((templateDesk, index) => {
      const elsewhere = livingByDesk.flatMap((students, otherIndex) => (otherIndex === index ? [] : students))
      // stripScaffoldTeacher: 丸ごと振替の日は Q35（手順 0）が先にテンプレの生徒を全員外すので、ここで strip に当たる机は今は無い。
      // Q35 を狭める・戻すときは、L-7 兄弟 1（21d5573）の「Q21-11 で空けた机にも strip」の assert をこの経路へ戻すこと。
      const filtered = filterTemplateDeskStudents(templateDesk, elsewhere, { stripScaffoldTeacher: Boolean(templateCell.scaffoldTeachersStripped) })
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
      context.skippedDuplicates.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber })
      const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
      if (!context.existingSuppressed.has(key)) context.addedSuppressed.add(key)
    }
  })

  // ── 3. 机を組み立てる。
  const nextDesks = cell.desks.map((desk, index) => {
    const templateDesk = templateDesks[index]
    const decision = decisions[index]
    const pendingKey = buildTemplatePendingDeskKey(cell.id, desk.id)
    // Q35-7（regression-reviewer 中-1・2026-10-02）: 丸ごと振替の日は、テンプレにその机の講師が居ても（抑止前の raw で見る）日単位の strip
    // （applyManagedCellSuppressions または手順 0）で外れる。既存の机に印のある生きている生徒が残る（残す／保留中の再保存）なら、机の講師は
    // 既存のまま（manual でない講師も外さない）。v1.5.573〜575 の差分反映はこの机の講師をテンプレの講師（manual でない）に置き換えていたため、
    // Q21-9 の「テンプレ机に講師がいない → 足場講師は外す」をそのまま当てると再保存で振替の机が講師なしになる。
    // 再マージは管理授業でない机の manual でない講師の名前を残すので、残す方が不動点（INV-01 / INV-02）。
    const keepsWholeDayTeacher = Boolean(templateCell.scaffoldTeachersStripped)
      && rawTemplateDesks[index].teacher.trim() !== ''
      && !templateDesk.teacher.trim()
      && desk.teacher.trim() !== ''
      && !isTemplateDiffTeacherTombstone(desk)
      && (
        (decision.kind === 'keep' && liveStudents(desk.lesson).some(studentHasManualMark))
        || (decision.kind === 'pending-rebase' && [...liveStudents(desk.lesson), ...liveStudents(decision.pending.lower.lesson)].some(studentHasManualMark))
      )
    const teacher = keepsWholeDayTeacher
      ? { teacherFields: pickTeacherFields(desk), reason: 'kept-user' as const }
      // 削除した講師が「そのコマのテンプレのどこかに居るか」は抑止・strip 前の素のテンプレ(raw)で見る(別の机に居れば記録を残す・H-1)。
      : resolveTemplateDeskTeacher(templateDesk, desk, context.teacherAliases, context.templateCell.raw.desks)
    if (teacher.reason === 'kept-qr' && templateDesk.teacher.trim()) summary.qrTeacherKept += 1
    if (teacher.reason === 'template-over-deleted') summary.deletedTeacherDeskReassigned += 1
    // Q41-11: 手置き講師がテンプレの別の講師に替わる机（本条の対象外）。保留にする机は下で取り消す。
    const manualTeacherReplacedHere = teacher.reason === 'template' && isManualPlacedTeacher(desk) && !isSameTeacherByAliases(desk.teacher, templateDesk.teacher, context.teacherAliases)
    const dropReplacedNote = () => {
      summary.manualTeacherReplaced -= 1
      const noteIndex = context.teacherNotes.findIndex((note) => note.kind === 'teacher-replaced' && note.dateKey === cell.dateKey && note.slotNumber === cell.slotNumber && note.teacherName === desk.teacher)
      if (noteIndex >= 0) context.teacherNotes.splice(noteIndex, 1)
    }
    // 理由の行。「残す」の机（テンプレ机が講師だけ＝Q41-12 (1)）では、テンプレの講師の担当で机に残る手で置いた生徒の名前を下で足す。
    const replacedNote: TemplateDiffTeacherNote | null = manualTeacherReplacedHere
      ? { kind: 'teacher-replaced', teacherName: desk.teacher, templateTeacher: templateDesk.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber, keptStudentNames: [] }
      : null
    if (replacedNote) {
      summary.manualTeacherReplaced += 1
      context.teacherNotes.push(replacedNote)
    }
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
      // Q38: テンプレが同じコマの別の机に置く手動追加の通常授業は、ここでも外してテンプレの机に任せる（抑止キーは積まない）。
      summary.manualRegularAdoptedByCellTemplate += cellAdoptedStudents(desk, decision, index).length
      const keptLesson = stripUnmarkedRegularStudents(desk.lesson, desk.id, keepsInOneRow(index))
      // Q41-12 (1): 講師だけのテンプレ机で手置き講師が替わる机。机に残る手で置いた生徒（印あり）の名前を理由の行に出す。
      if (replacedNote) replacedNote.keptStudentNames = liveStudents(keptLesson).map((student) => student.name)
      return withSlots(withTeacher, keptLesson, desk.statusSlots, desk.memoSlots)
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
      // 席ごと（2026-09-30）: テンプレの空いた席に入る既存の生徒は 1 行のまま残し、テンプレと同じ生徒×科目×種別は採用する。
      // 下段（保留）へ入るのは、席が埋まっていてぶつかった生徒だけ。ぶつかる生徒がいなければ 2 行にしない。
      // Q38: テンプレが同じコマの別の机に置く手動追加の通常授業は候補から外れ（下段にも入れない）、テンプレの机に任せる。
      summary.manualRegularAdoptedByCellTemplate += cellAdoptedStudents(desk, decision, index).length
      const plan = planSeatsFor(desk, decision, templateDesk, index)
      if (plan) collectCollidedCopies(desk, undefined, plan)
      const filledDeletedTeacherDeskBySeat = teacher.reason === 'kept-deleted' && Boolean(upperLesson)
      // Q41（オーナー決定 B・2026-10-21）: 手置き講師の机に手で置いた生徒が居て、テンプレが別の講師＋生徒を置く → 手で置いた生徒を席の空きに関係なく全員と、
      // 手置き講師を下段に残して保留（緑）にする（Q34-4 の「空いた席なら 1 行のまま」をこの机には当てない＝生徒が黙って別の講師の担当になる形を作らない）。
      const handPlaced = plan && !plan.overflow ? [...plan.kept, ...liveStudents({ id: '', studentSlots: plan.lowerSlots })] : []
      const manualTeacherOverlap = Boolean(plan) && !plan!.overflow && Boolean(upperLesson)
        && resolveManualTeacherOverlap({ existingTeacher: desk, templateDesk, handPlacedStudents: handPlaced, resolveAliases: context.teacherAliases })
      if (!manualTeacherOverlap && plan && !plan.overflow && isEmptyPair(plan.lowerSlots) && upperLesson) {
        const mergedLesson: DeskLesson = { ...upperLesson, studentSlots: plan.upperSlots }
        // 1 行の机なので、出欠記録・メモは「採用」と同じく消さずに空いた席へ残す（入らなければ元の席に残す）。
        // 会計を持つ記録から先に席へ（空き席は planTemplateDeskSeats が記録の分だけ空けてある）。
        const seated = seatUpperWithDeskRecords({
          upperLesson: mergedLesson,
          keptStatus: [
            ...collectStatusItems(desk.statusSlots, (entry) => isAccountingStatus(entry.status)),
            ...collectStatusItems(desk.statusSlots, (entry) => !isAccountingStatus(entry.status)),
          ],
          keptMemo: collectMemoItems(desk.memoSlots),
        })
        // 会計を持つ記録が席に入らないときは 1 行にしない（上段の生徒の下に隠すと、その生徒を休みにしたとき上書きされうる＝INV-06・
        // regression-reviewer L-1）。下の保留の経路へ回し、あふれた記録は従来どおり下段へ入れる（Q21-10）。
        const accountingOverflow = seated.overflowStatus.some((item) => isAccountingStatus(item.entry.status))
        if (!accountingOverflow) {
          for (const item of seated.overflowStatus) placeIntoPair(seated.statusSlots, item.index, cloneStatusEntry(item.entry))
          for (const item of seated.overflowMemo) placeIntoPair(seated.memoSlots, item.index, item.memo)
          if (filledDeletedTeacherDeskBySeat) summary.deletedTeacherDeskFilled += 1
          if (plan.kept.length > 0) summary.seatMerged += 1
          else summary.adopted += 1
          return withSlots(withTeacher, mergedLesson, seated.statusSlots, seated.memoSlots)
        }
      }
      const pendingUpperLesson = manualTeacherOverlap ? upperLesson : (plan && !plan.overflow && upperLesson ? { ...upperLesson, studentSlots: plan.upperSlots } : upperLesson)
      // 上段＝テンプレ（＋空いた席に残した既存の生徒）、会計を持つ記録は机に残す（席不足分だけ下段へ）、
      // 表示専用の記録・メモ・ぶつかった生徒は下段へ（Q24-1・Q21-10）。
      const seated = seatUpperWithDeskRecords({
        upperLesson: pendingUpperLesson,
        keptStatus: collectStatusItems(desk.statusSlots, (entry) => isAccountingStatus(entry.status)),
        keptMemo: [],
      })
      const lower: TemplatePendingLower = {}
      if (manualTeacherOverlap && plan && desk.lesson) {
        // 手で置いた生徒を元の席のまま全員下段へ（残した席の生徒も含む）。
        const overlapSlots: StudentPair = [...plan.lowerSlots] as StudentPair
        for (const student of plan.kept) {
          const seat = desk.lesson.studentSlots.findIndex((candidate) => candidate === student)
          if (seat >= 0 && !overlapSlots[seat]) overlapSlots[seat] = student
          else placeIntoPair(overlapSlots, Math.max(0, seat), student)
        }
        if (!isEmptyPair(overlapSlots)) lower.lesson = { ...cloneLesson(desk.lesson), studentSlots: overlapSlots }
        lower.teacher = pickTeacherFields(desk)
        summary.manualTeacherPending += 1
        if (manualTeacherReplacedHere) dropReplacedNote()
        context.teacherNotes.push({ kind: 'teacher-pending', teacherName: desk.teacher, templateTeacher: templateDesk.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber })
      } else if (plan && !plan.overflow) {
        if (desk.lesson && !isEmptyPair(plan.lowerSlots)) lower.lesson = { ...cloneLesson(desk.lesson), studentSlots: plan.lowerSlots }
      } else if (plan && desk.lesson) {
        lower.lesson = cloneLesson(desk.lesson)
      }
      const existingLive = liveStudents(lower.lesson)
      const lowerStatus: StatusPair = [null, null]
      for (const item of collectStatusItems(desk.statusSlots, (entry) => !isAccountingStatus(entry.status))) placeIntoPair(lowerStatus, item.index, cloneStatusEntry(item.entry))
      for (const item of seated.overflowStatus) placeIntoPair(lowerStatus, item.index, cloneStatusEntry(item.entry))
      if (!isEmptyPair(lowerStatus)) lower.statusSlots = lowerStatus
      const lowerMemo: MemoPair = [null, null]
      for (const item of collectMemoItems(desk.memoSlots)) placeIntoPair(lowerMemo, item.index, item.memo)
      if (!isEmptyPair(lowerMemo, (memo) => memo != null)) lower.memoSlots = lowerMemo

      const upperDesk = withSlots(withTeacher, pendingUpperLesson, seated.statusSlots, undefined)
      const filledDeletedTeacherDesk = filledDeletedTeacherDeskBySeat
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
    // ★席ごと（2026-09-30）: 上段に残した既存の生徒（印あり）と下段の印のある生徒を、新しいテンプレと席ごとに突き合わせ直す
    //   （同じ生徒×科目×種別は採用・空いた席に入れば 1 行・ぶつかった生徒だけ下段）。印のない通常生徒は新しいテンプレで置き換える。
    const pending = decision.pending
    // Q38: 下段（旧版の保存が作った保留を含む）の手動追加の通常授業も、テンプレが同じコマの別の机に同じ生徒×科目を置くなら外す（再保存で片づく）。
    summary.manualRegularAdoptedByCellTemplate += cellAdoptedStudents(desk, decision, index).length
    const plan = planSeatsFor(desk, decision, templateDesk, index)!
    collectCollidedCopies(desk, pending, plan)
    if (plan.overflow) {
      // 下段の席が足りない（整合の取れたデータでは起きない）→ 机の中身と保留を変えずに残す（黙って捨てない）。
      summary.pending += 1
      return withTeacher
    }
    const lower = cloneTemplatePendingLower(pending.lower)
    // Q41-8（保留中の再保存・regression-reviewer H-1/M-1 で改定）: 下段に手置き講師が居る机。判定は作成時と同じ権威関数 resolveManualTeacherOverlap
    // （手で置いた生徒＝残した席＋下段の生徒。Q34-2 で全員採用されれば居ない）で、新しいテンプレ机の講師により 4 分岐:
    //   同じ講師→テンプレの講師（下段の講師は消える）／講師なし→手置き講師を机へ（別の机に同じ講師が居れば戻さず置き換え側）／
    //   別の講師＋生徒で手で置いた生徒が居る→下段の講師ごと維持（残した席の生徒も下段へ＝作成時と同じく Q34-4 を当てない）／それ以外（講師だけのテンプレ机・手で置いた生徒なし）→テンプレの講師（件数に数える）。
    let rebasedWithTeacher = withTeacher
    let overlapRebase = false
    if (pending.lower.teacher) {
      const lowerTeacher = pending.lower.teacher
      if (manualTeacherReplacedHere) dropReplacedNote()
      const handPlacedOnRebase = [...plan.kept, ...liveStudents({ id: '', studentSlots: plan.lowerSlots })]
      if (!templateDesk.teacher.trim()) {
        if (isTeacherElsewhereInCell(cell, desk.id, lowerTeacher, context.teacherAliases)) {
          summary.manualTeacherReplaced += 1
          context.teacherNotes.push({ kind: 'teacher-replaced', teacherName: lowerTeacher.teacher, templateTeacher: '', dateKey: cell.dateKey, slotNumber: cell.slotNumber })
        } else {
          rebasedWithTeacher = applyTeacherFields(desk, lowerTeacher)
        }
        delete lower.teacher
      } else if (isSameTeacherByAliases(lowerTeacher.teacher, templateDesk.teacher, context.teacherAliases)) {
        delete lower.teacher
      } else if (resolveManualTeacherOverlap({ existingTeacher: lowerTeacher, templateDesk, handPlacedStudents: handPlacedOnRebase, resolveAliases: context.teacherAliases })) {
        overlapRebase = true
        summary.manualTeacherPending += 1
        context.teacherNotes.push({ kind: 'teacher-pending', teacherName: lowerTeacher.teacher, templateTeacher: templateDesk.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber })
      } else {
        delete lower.teacher
        summary.manualTeacherReplaced += 1
        // 講師だけのテンプレ机（Q41-8 の暫定）: 下段の生徒は机へ戻り新しいテンプレの講師の担当になる。手で置いた生徒が全員採用された形は空。
        context.teacherNotes.push({ kind: 'teacher-replaced', teacherName: lowerTeacher.teacher, templateTeacher: templateDesk.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber, keptStudentNames: handPlacedOnRebase.map((student) => student.name) })
      }
    }
    const lowerBaseLesson = pending.lower.lesson ?? desk.lesson
    if (overlapRebase && lowerBaseLesson) {
      // 残した席の生徒も元の席のまま下段へ（上段はテンプレだけ）。
      const overlapSlots: StudentPair = [...plan.lowerSlots] as StudentPair
      for (const student of plan.kept) {
        // 残した席の生徒の元の席は上段（机）か下段（保留）のどちらか。
        const seatInUpper = (desk.lesson?.studentSlots ?? [null, null]).findIndex((candidate) => candidate === student)
        const seat = seatInUpper >= 0 ? seatInUpper : (pending.lower.lesson?.studentSlots ?? [null, null]).findIndex((candidate) => candidate === student)
        if (seat >= 0 && !overlapSlots[seat]) overlapSlots[seat] = student
        else placeIntoPair(overlapSlots, Math.max(0, seat), student)
      }
      if (!isEmptyPair(overlapSlots)) lower.lesson = { ...cloneLesson(lowerBaseLesson), studentSlots: overlapSlots }
      else delete lower.lesson
    } else if (!isEmptyPair(plan.lowerSlots) && lowerBaseLesson) lower.lesson = { ...cloneLesson(lowerBaseLesson), studentSlots: plan.lowerSlots }
    else delete lower.lesson
    const keptBaseLesson = desk.lesson ?? pending.lower.lesson
    const rebasedUpperLesson: DeskLesson | undefined = overlapRebase
      ? upperLesson
      : upperLesson
        ? { ...upperLesson, studentSlots: plan.upperSlots }
        : (plan.kept.length > 0 && keptBaseLesson ? detachManagedLessonIdentity({ ...cloneLesson(keptBaseLesson), studentSlots: plan.upperSlots }, desk.id) : undefined)
    const seated = seatUpperWithDeskRecords({
      upperLesson: rebasedUpperLesson,
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
    const upperDesk = withSlots(rebasedWithTeacher, rebasedUpperLesson, seated.statusSlots, seated.memoSlots)

    if (liveStudents(lower.lesson).length === 0) {
      // ぶつかる生徒がいなければ 1 行へ（下段の記録・メモは空いた席へ・表示専用の記録は捨てる＝Q28）。
      const collapsed = computePendingDeskCollapse(upperDesk, { lower })
      if (collapsed.ok) {
        delete context.nextPendingDesks[pendingKey]
        if (!upperLesson) {
          summary.kept += 1
          const restored = collapsed.nextDesk
          return withSlots(restored, stripUnmarkedRegularStudents(restored.lesson, desk.id), restored.statusSlots, restored.memoSlots)
        }
        if (plan.kept.length > 0) summary.seatMerged += 1
        else summary.adopted += 1
        return collapsed.nextDesk
      }
    }
    summary.pending += 1
    context.nextPendingDesks[pendingKey] = { lower, effectiveStartDate: pending.effectiveStartDate, createdAt: pending.createdAt }
    return upperDesk
  })

  // ── 4. 日程表登録（QR）の講師が、同じコマの別の机にテンプレの同じ講師として置かれたなら QR 机の講師を外す（オーナー指示 2026-10-15・
  //    findQrTeacherDesksSupersededByTemplate＝再マージと同じ権威関数）。その机のテンプレに講師が居ればその講師（テンプレ足場扱い）、居なければ講師なし。
  for (const index of findQrTeacherDesksSupersededByTemplate(nextDesks, templateDesks, context.teacherAliases)) {
    const templateDesk = templateDesks[index]
    const fields = resolveSupersededQrDeskTeacherFields(templateDesk)
    const supersession = buildScheduleRegistrationSupersession(nextDesks[index])
    nextDesks[index] = {
      ...applyTeacherFields(nextDesks[index], fields),
      // 自己修復が「配置済み」と数えるための記録（types.ts）。再マージも同じ形で書く。
      scheduleRegistrationSupersededByTemplate: supersession,
    }
    summary.qrTeacherRemoved += 1
    // 上の kept-qr の数え方（テンプレ机に講師が居るときだけ数える）と対にする。
    if (fields.teacher) summary.qrTeacherKept -= 1
  }

  // ── 5. Q41-13 の後処理（オーナー指示 2026-10-22「詰めた講師は緑色で分かるように。保留ではない」）: ずらして置いたテンプレの講師の机に印
  //   （templateTeacherShift）を付け、この机以外の古い印（講師が替わった・手で置き直した）は外す。表示専用（isShiftedTemplateTeacherDesk）。
  const shiftedTargets = new Map<number, ManualTeacherDeskShift>()
  for (const shift of teacherShifts) if (shift.placement.kind === 'placed') shiftedTargets.set(shift.placement.deskIndex, shift)
  nextDesks.forEach((desk, index) => {
    const shift = shiftedTargets.get(index)
    if (shift && !desk.manualTeacher && isSameTeacherByAliases(desk.teacher, shift.templateTeacher, context.teacherAliases)) {
      nextDesks[index] = { ...desk, templateTeacherShift: { teacher: desk.teacher, fromDeskIndex: shift.fromIndex } }
      return
    }
    if (desk.templateTeacherShift && !isShiftedTemplateTeacherDesk(desk)) {
      const { templateTeacherShift: _stale, ...rest } = desk
      nextDesks[index] = rest
    }
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
/**
 * 「反映開始日以降をこのテンプレで上書き保存」を押してから確認モーダルが出るまでの「処理中」文言(2026-10-14 オーナー指摘)。
 * 確認文の件数(Q32-1)は保存本体と同じ計画関数を試し実行して出すため数秒かかる。その間 BusyOverlay にこの文言を出す。
 */
export const TEMPLATE_DIFF_PREVIEW_BUSY_MESSAGE = 'テンプレの差分を確認しています…'

export type TemplateDiffConfirmContext = {
  /** Q39: どの範囲を突き合わせるか（変えたコマだけ／すべて）。無ければ範囲の行を出さない（従来の文）。 */
  scopeNote?: TemplateDiffScopeNote
  /** Q39-5: 反映開始日が今日より前なら警告を出す（保存は止めない）。 */
  todayKey?: string
  /** 2026-10-21: テンプレの生徒を置かない／動かす生徒の名前と理由（件数だけでは「どこへ消えたか」が分からない・テスト教室 tp-48/tp-56）。 */
  studentNotes?: readonly TemplateDiffStudentNote[]
}

/**
 * 確認の画面に出す「生徒ごとの理由」（2026-10-21・テスト教室の確認 tp-48「これ以外は機能していない」・tp-56 case1「通常授業はどこに消えたのか」）。
 * 保存がテンプレの生徒を**置かない／別の形にする**判定は Q21-11（同じコマに同じ生徒）・Q35（丸ごと振替した日）・Q40-2（振替先へ置く／未消化）・
 * Q40-3（精算済み）・Q40-1（根拠を失った振替を消す）の 5 系統あり、件数の合計だけでは室長もテスト担当も「誰が・なぜ」を追えない。
 * 名前つきで出すことで、黙って消える形（改定前の M-1 の誤認など）が確認の画面の時点で見える。
 */
export type TemplateDiffStudentNote = {
  kind: 'duplicate-skipped' | 'transfer-placed' | 'transfer-stocked' | 'transfer-settled' | 'transfer-count-adjusted' | 'orphan-removed' | 'teacher-pending' | 'teacher-replaced' | 'teacher-kept'
  /** 生徒の名前（講師の行では講師の名前）。 */
  studentName: string
  /** 科目（講師の行では空）。 */
  subject: string
  dateKey: string
  slotNumber: number | null
  /** 追加情報（振替先の日付・未消化の理由など）。 */
  detail?: string
  /**
   * 講師の行（teacher-replaced）だけ: テンプレの講師の担当で机に残る、手で置いた生徒の名前（Q41-11「生徒 A は D の担当になります」）。
   * 空＝手で置いた生徒が居ない（講師だけ・記録／メモだけ・全員テンプレに採用）。テスト教室 2026-10-22: 講師だけのテンプレ机（Q41-12 (1)）で
   * 未消化講習を手で置いた机にも「手で置いた生徒が居ないため」と出て、講習が手置きと認識されていないと誤解させた。理由は「テンプレの机が講師だけ」。
   */
  keptStudentNames?: string[]
  /** teacher-kept（Q41-13）: ずらしたテンプレの講師の置き先。 */
  placement?: ManualTeacherDeskShift['placement']
}

/** Q41: 確認の画面に出す講師ごとの理由。 */
export type TemplateDiffTeacherNote = {
  kind: 'teacher-pending' | 'teacher-replaced' | 'teacher-kept'
  teacherName: string
  templateTeacher: string
  dateKey: string
  slotNumber: number
  /** teacher-replaced: テンプレの講師の担当として机に残る手で置いた生徒。teacher-kept: 手置き講師の担当のまま机に残る手で置いた生徒。空なら手で置いた生徒が居ない。 */
  keptStudentNames?: string[]
  /** teacher-kept（Q41-13）: ずらしたテンプレの講師の置き先。 */
  placement?: ManualTeacherDeskShift['placement']
}

const TEMPLATE_DIFF_STUDENT_NOTE_LIMIT = 12

function describeTemplateDiffStudentNote(note: TemplateDiffStudentNote) {
  const where = `${formatMonthDay(note.dateKey)}${note.slotNumber != null ? ` ${note.slotNumber}限` : ''}`
  const who = note.subject ? `${note.studentName}（${note.subject}）` : `講師 ${note.studentName}`
  switch (note.kind) {
    case 'teacher-pending': return `${where} ${who}: 手で置いた講師の机にテンプレの講師${note.detail ? `（${note.detail}）` : ''}が入るため、手で置いた生徒と一緒に下の行に残して保留（緑）にします。`
    case 'teacher-kept': {
      // Q41-13（オーナー指示 2026-10-22）: 手入力講師の机はテンプレで上書きせず、テンプレの講師（講師だけの机）を同じコマの空き机へずらす。
      const templateTeacher = note.detail || 'テンプレの講師'
      const students = note.keptStudentNames && note.keptStudentNames.length > 0 ? `手で置いた ${note.keptStudentNames.join('・')} もこの机に残ります。` : ''
      const placement = note.placement?.kind === 'placed'
        ? `テンプレのこの机は講師だけ（生徒なし）なので、${templateTeacher} は同じコマの空いている机 ${note.placement.deskIndex + 1} へずらして置きます。`
        : note.placement?.kind === 'present'
          ? `${templateTeacher} は同じコマの机 ${note.placement.deskIndex + 1} に既に居るので、この机には置きません。`
          : `${templateTeacher} を置く空き机がこのコマに無いため、このコマには置きません。`
      return `${where} ${who}: 手で置いた講師なので、テンプレの講師（${templateTeacher}）に替えず残します。${students}${placement}`
    }
    case 'teacher-replaced': {
      const templateTeacher = note.detail ? `テンプレの講師（${note.detail}）` : 'テンプレの講師'
      // Q41-12 (1)（暫定・オーナー確定 2026-10-21）: テンプレの机が講師だけ（生徒なし）なら、手で置いた生徒が居ても講師はテンプレに揃い、生徒はその講師の担当で机に残る。
      // 理由を「手で置いた生徒が居ないため」と出すと手置きの振替・講習が認識されていないように読める（テスト教室 2026-10-22）ので、形ごとに分ける。
      if (note.keptStudentNames && note.keptStudentNames.length > 0) {
        return `${where} ${who}: 手で置いた講師ですが、テンプレのこの机が講師だけ（生徒なし）のため${templateTeacher}に替わります。手で置いた ${note.keptStudentNames.join('・')} は${note.detail || 'テンプレの講師'}の担当で机に残ります。`
      }
      return `${where} ${who}: 手で置いた講師ですが、手で置いた生徒が居ないため${templateTeacher}に替わります。`
    }
    case 'duplicate-skipped': return `${where} ${who}: 同じコマに同じ生徒の授業（振替・講習など）があるため、テンプレの通常授業は置きません。`
    case 'transfer-placed': return `${where} ${who}: 丸ごと振替した日なので、振替先${note.detail ? `（${note.detail}）` : ''}の同じ机へ振替として置きます。`
    case 'transfer-stocked': return `${where} ${who}: 丸ごと振替した日ですが振替先に置けない${note.detail ? `（${note.detail}）` : ''}ため、未消化振替にします。`
    case 'transfer-settled': return `${where} ${who}: 丸ごと振替した日で、この授業の分は前の保存か別の時限からの移送で処理済みのため置きません（精算済み）。`
    case 'transfer-count-adjusted': return `${where} ${who}: 丸ごと振替した日なので置かず、希望回数を −1 します。`
    case 'orphan-removed': return `${where} ${who}: 振替元の授業がテンプレから無くなったため、この振替を消します${note.detail ? `（${note.detail}）` : ''}。`
    default: return `${where} ${who}`
  }
}

/** 確認の画面の「生徒ごとの理由」の行。多いときは先頭 12 件＋「ほか n 件」。 */
export function buildTemplateDiffStudentNoteLines(notes: readonly TemplateDiffStudentNote[] | undefined, limit = TEMPLATE_DIFF_STUDENT_NOTE_LIMIT): string[] {
  if (!notes || notes.length === 0) return []
  const shown = notes.slice(0, limit).map((note) => `・${describeTemplateDiffStudentNote(note)}`)
  const rest = notes.length - shown.length
  return ['テンプレの生徒・講師の扱いの理由:', ...shown, ...(rest > 0 ? [`・ほか ${rest} 件`] : [])]
}

/** 未消化にした理由の表示（Q40-2）。 */
export function describeWholeDayTransferStockReason(reason: 'no-seat' | 'no-teacher' | 'pending-desk' | 'duplicate' | 'no-target-cell') {
  switch (reason) {
    case 'no-seat': return '振替先のコマが満席'
    case 'no-teacher': return '振替先のコマが満席'
    case 'pending-desk': return '振替先のコマが満席'
    case 'duplicate': return '同じコマに同じ生徒がいる'
    case 'no-target-cell': return '振替先のコマが無い'
    default: return ''
  }
}

/** 確認文の日付表記（M/D）。生徒ごとの理由の行でも使う。 */
export function formatTemplateDiffMonthDay(dateKey: string) {
  return formatMonthDay(dateKey)
}

function formatMonthDay(dateKey: string) {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}/${day}`
}

/** Q39: 範囲の説明（確認文・保存後メッセージ共通）。 */
export function describeTemplateDiffScopeNote(note: TemplateDiffScopeNote | undefined) {
  if (!note) return ''
  if (note.scope === 'changed-slots') {
    const base = `テンプレで変えたコマ（${note.slotLabels.join('・')}）だけを突き合わせます。変えていないコマは変わりません。`
    // Q39-2（regression-reviewer H-2b）: 盤面の通常授業の行が今のテンプレと食い違うコマ（退塾した講師が保存済みテンプレに残っているなど）は
    // テンプレで変えていなくても突き合わせる（保存直後の再マージで黙って変わるのを防ぐ）。
    const lines = [base]
    if (note.extraSlotLabels.length > 0) lines.push(`加えて、盤面の通常授業の行が今のテンプレと食い違うコマ（${note.extraSlotLabels.join('・')}）も突き合わせます（退塾した講師の整理など）。`)
    // Q39-9: その日を全コマにした日は件数に入るので、確認文でも断る（regression-reviewer M-1）。
    if (note.fullDates && note.fullDates.length > 0) lines.push(`同じ日の中で手で動かした授業がある日（${note.fullDates.map(formatMonthDay).join('・')}）は、その日の全コマを突き合わせます。`)
    return lines.join('\n')
  }
  switch (note.reason) {
    case 'no-change': return 'テンプレの中身に変更はありません。すべてのコマを突き合わせます（講師の揃え・保留の片づけ）。'
    case 'no-previous': return '比べられる前回のテンプレが無いため、すべてのコマを突き合わせます。'
    case 'school-year': return '年度が変わるため、すべてのコマを突き合わせます。'
    case 'desk-count': return '机の数が変わったため、すべてのコマを突き合わせます。'
    default: return 'すべてのコマを突き合わせます。'
  }
}

/**
 * 確認の画面の 1 行（オーナー指示 2026-10-24「テンプレの流れでモーダルやナビバーの文章が長すぎる。ユーザーはほとんど見ない。1 行くらいに大事なことだけ」）。
 * 反映開始日・置き換え・保留（あとで片づける机）と、過去の週を含む警告だけ。範囲・内訳・生徒ごとの理由は「詳細」に畳む（buildTemplateDiffConfirmDetail）。
 */
export function buildTemplateDiffConfirmHeadline(effectiveStartDate: string, summary: TemplateDiffApplySummary, context?: Pick<TemplateDiffConfirmContext, 'todayKey'>) {
  const past = context?.todayKey && isTemplateEffectiveStartDateInPast(effectiveStartDate, context.todayKey) ? ' ⚠ 今日より前の週も含みます。' : ''
  return `${formatMonthDay(effectiveStartDate)} 以降に反映します（置き換え ${summary.replaced}机・保留 ${summary.pending}机）。${past}`
}

/** 確認の画面の「詳細」（畳んだ中身）。従来の確認文から最後の「実行しますか？」を除いたもの。 */
export function buildTemplateDiffConfirmDetail(effectiveStartDate: string, summary: TemplateDiffApplySummary, context?: TemplateDiffConfirmContext) {
  return buildTemplateDiffConfirmLines(effectiveStartDate, summary, context).join('\n')
}

export function buildTemplateDiffConfirmMessage(effectiveStartDate: string, summary: TemplateDiffApplySummary, context?: TemplateDiffConfirmContext) {
  return [...buildTemplateDiffConfirmLines(effectiveStartDate, summary, context), '', '実行しますか？'].join('\n')
}

function buildTemplateDiffConfirmLines(effectiveStartDate: string, summary: TemplateDiffApplySummary, context?: TemplateDiffConfirmContext): string[] {
  const scopeLine = describeTemplateDiffScopeNote(context?.scopeNote)
  const pastWarning = context?.todayKey && isTemplateEffectiveStartDateInPast(effectiveStartDate, context.todayKey)
    ? `⚠ 反映開始日（${effectiveStartDate}）が今日より前です。過去の週も突き合わせます（出欠のある机は残ります）。`
    : ''
  return [
    `${effectiveStartDate} 以降のコマ表にテンプレートを反映します。`,
    ...(scopeLine ? [scopeLine] : []),
    ...(pastWarning ? [pastWarning] : []),
    '',
    `${summary.replaced}机を置き換え、${summary.pending}机が保留（緑）になります。`,
    `そのまま残す${summary.kept}机・印を外して採用${summary.adopted}机。`,
    ...(summary.seatMerged > 0 ? [`テンプレの空いた席に既存の生徒を残して 1 行にする${summary.seatMerged}机。`] : []),
    ...(summary.wholeDayTransferSkippedStudents > 0 ? [`丸ごと振替した日はテンプレの生徒を置かず振替を優先${summary.wholeDayTransferSkippedStudents}名（希望回数 −1: ${summary.wholeDayTransferCountAdjusted}名）。`] : []),
    ...(summary.sameDayMoveCopiesReverted > 0 ? [`同じ日の中で手で動かしていた通常授業${summary.sameDayMoveCopiesReverted}名はテンプレの位置に合わせます。`] : []),
    ...(summary.manualRegularAdoptedByCellTemplate > 0 ? [`手動追加の通常授業${summary.manualRegularAdoptedByCellTemplate}名はテンプレと同じ内容なのでテンプレの机に合わせます。`] : []),
    ...(summary.orphanedMakeupsRemoved > 0 ? [`テンプレから外した生徒の振替${summary.orphanedMakeupsRemoved}件を消します（振替元の授業が無くなるため）。`] : []),
    ...(summary.wholeDayTransferPlacedStudents + summary.wholeDayTransferStockedStudents > 0 ? [`丸ごと振替した日に足した生徒${summary.wholeDayTransferPlacedStudents}名を振替先へ置きます（空きが無い${summary.wholeDayTransferStockedStudents}名は未消化振替へ）。`] : []),
    ...(summary.manualTeacherPending > 0 ? [`手で置いた講師の机をテンプレの講師と重ねて保留（緑）にする机: ${summary.manualTeacherPending}机。`] : []),
    ...(summary.manualTeacherReplaced > 0 ? [`手で置いた講師をテンプレの講師に替える机: ${summary.manualTeacherReplaced}机。`] : []),
    ...(summary.manualTeacherKept > 0 ? [`手で置いた講師を残し、テンプレの講師を同じコマの空き机へずらす机: ${summary.manualTeacherKept}机。`] : []),
    ...(context?.studentNotes && context.studentNotes.length > 0 ? ['', ...buildTemplateDiffStudentNoteLines(context.studentNotes)] : []),
    '',
    '振替・講習・メモ・出欠の記録は消えません。保留になった机は、あとで机ごとに「テンプレを採用」「既存を採用」で片づけます。',
  ]
}

/** 保存後のナビバー 1 行（オーナー指示 2026-10-24・確認の画面の 1 行と同じ件数だけ）。内訳は buildTemplateDiffSavedMessage（操作の記録に残す）。 */
export function buildTemplateDiffSavedHeadline(effectiveStartDate: string, summary: TemplateDiffApplySummary) {
  return `テンプレを保存しました（${formatMonthDay(effectiveStartDate)} 以降・置き換え ${summary.replaced}机・保留 ${summary.pending}机）。`
}

/** 保存後のメッセージ（Q32-1）。確認文の 4 件数に、即時合流・QR 講師・講師を削除した机・上段に置かなかった生徒を足す。 */
export function buildTemplateDiffSavedMessage(effectiveStartDate: string, summary: TemplateDiffApplySummary, scopeNote?: TemplateDiffScopeNote) {
  const parts = [
    `通常授業テンプレートを保存しました。${effectiveStartDate} 以降: ${summary.replaced}机を置き換え・${summary.pending}机が保留・そのまま残す${summary.kept}机・印を外して採用${summary.adopted}机。`,
  ]
  if (scopeNote?.scope === 'changed-slots') parts.push(`対象はテンプレで変えたコマ（${scopeNote.slotLabels.join('・')}）だけ。`)
  if (summary.seatMerged > 0) parts.push(`テンプレの空いた席に既存の生徒を残して 1 行にした机: ${summary.seatMerged}机。`)
  if (summary.collapsedOnCreate > 0) parts.push(`${summary.collapsedOnCreate}机は既存のメモ・記録を残してテンプレの生徒を置きました。`)
  if (summary.qrTeacherKept > 0) parts.push(`QR 自動割振りの講師を残した机: ${summary.qrTeacherKept}机。`)
  if (summary.qrTeacherRemoved > 0) parts.push(`テンプレの同じ講師が同じコマに居るため日程表登録の講師を外した机: ${summary.qrTeacherRemoved}机。`)
  if (summary.deletedTeacherDeskFilled > 0) parts.push(`講師を削除した机にテンプレの生徒を置いた机: ${summary.deletedTeacherDeskFilled}机。`)
  if (summary.deletedTeacherDeskReassigned > 0) parts.push(`講師を削除した机に別の講師をテンプレから置いた机: ${summary.deletedTeacherDeskReassigned}机。`)
  if (summary.skippedDuplicateStudents > 0) parts.push(`同じコマの別の机に居るため上段に置かなかった生徒: ${summary.skippedDuplicateStudents}名。`)
  if (summary.wholeDayTransferSkippedStudents > 0) parts.push(`丸ごと振替した日のためテンプレの生徒を置かず振替を優先した生徒: ${summary.wholeDayTransferSkippedStudents}名（希望回数 −1: ${summary.wholeDayTransferCountAdjusted}名）。`)
  if (summary.sameDayMoveCopiesReverted > 0) parts.push(`同じ日の中で手で動かしていた通常授業をテンプレの位置に合わせた生徒: ${summary.sameDayMoveCopiesReverted}名。`)
  if (summary.manualRegularAdoptedByCellTemplate > 0) parts.push(`手動追加の通常授業をテンプレの机に合わせた生徒（テンプレと同じ内容）: ${summary.manualRegularAdoptedByCellTemplate}名。`)
  if (summary.tombstoneCleared > 0) parts.push(`講師の削除記録だけの空き机 ${summary.tombstoneCleared}机は記録を外しました。`)
  if (summary.orphanedMakeupsRemoved > 0) parts.push(`テンプレから外した生徒の振替を消した: ${summary.orphanedMakeupsRemoved}件。`)
  if (summary.wholeDayTransferPlacedStudents + summary.wholeDayTransferStockedStudents > 0) parts.push(`丸ごと振替した日に足した生徒を振替先へ置いた: ${summary.wholeDayTransferPlacedStudents}名（未消化振替にした: ${summary.wholeDayTransferStockedStudents}名）。`)
  if (summary.manualTeacherPending > 0) parts.push(`手で置いた講師の机をテンプレの講師と重ねて保留（緑）にした机: ${summary.manualTeacherPending}机。`)
  if (summary.manualTeacherReplaced > 0) parts.push(`手で置いた講師をテンプレの講師に替えた机: ${summary.manualTeacherReplaced}机。`)
  if (summary.manualTeacherKept > 0) parts.push(`手で置いた講師を残し、テンプレの講師を同じコマの空き机へずらした机: ${summary.manualTeacherKept}机。`)
  return parts.join('')
}
