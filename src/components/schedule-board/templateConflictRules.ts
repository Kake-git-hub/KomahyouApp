// テンプレ反映の規則（第 2 版・docs/spec-template-conflict-v2.md §2・§4・段 2）。
//
// ★テンプレ保存（差分反映）と盤面の再マージ（remergeBoardWeeksWithManagedData・機能フラグ templateDiffApply の教室だけ）が、
//   「テンプレのどの生徒・講師を置かないか」をこのファイルの同じ関数で決める（権威 1 か所）。片方だけ規則を変えると、保存した盤面が
//   保存直後の再マージで書き換わる（INV-03 の不動点が崩れる）。
// ★規則は 4 本だけ（当てる順もこの順）: 休み（§2-4）→ 生徒の一意（§2-2・手入力が勝つ）→ 講師の一意（§2-3・手置き講師が勝つ）→ 席（§2-1）。
//   出自の印（placementOrigin.ts）と盤面の今の状態だけで決める。中身の比較（旧 Q23）・写しの処理（旧 Q36）・自動採用（旧 Q38）・
//   押し出し（旧 Q42）・「変えたコマだけ」（旧 Q39）はしない。抑止キーは**新しく積まない**（読むのは削除の記録 §1-1 #10・#14 だけ）。
//   ただし丸ごと振替の日（旧 Q35・日単位の抑止のある日）の扱いと、その追従（Q40・templateTransferFollow）は段 4 で付け替え方式へ
//   変えるまで今のまま残す（Q40-2 が振替先へ置く生徒を拾うため、その日の「置かなかった生徒」の抑止キーだけは今どおり積む）。
// ★テンプレの生徒・講師は、テンプレの机（管理授業 id＝`managed_…`）を席の位置ごとそのまま置く（再マージは管理授業の席の位置へ戻すため）。

import type { ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { DeskCell, DeskLesson, SlotCell, StudentEntry, StudentStatusEntry, StudentStatusKind } from './types'
import { isManualOriginDeskTeacher, isManualOriginStudent, resolveStudentOrigin } from './placementOrigin'
import { hasRealDeskTeacher, isDeskTeacherPlaceholder } from '../../utils/deskTeacherLabel'
import { parseOriginSlotNumberFromLabel } from './makeupStock'
import {
  buildTemplatePendingDeskKey,
  type TemplatePendingDesk,
  type TemplatePendingDeskMap,
  type TemplatePendingLower,
  type TemplatePendingLowerTeacher,
} from './templatePendingDesks'
import {
  alignTeacherIdentityWithRemerge,
  buildFullySuppressedManagedDesk,
  buildTemplateOccurrenceKey,
  canClearDeletedTeacherTombstone,
  createEmptyTemplateDiffApplySummary,
  doesDeletedTeacherTombstoneBlock,
  isSameTeacherByAliases,
  isSameTemplateStudent,
  isTemplateDiffTeacherTombstone,
  isTemplateManagedLesson,
  isTemplateTeacherDeclinedAtDesk,
  resolveAdoptExistingCountAdjustments,
  resolveWholeDayTransferSettlement,
  stripTemplateScaffoldTeacherDesk,
  type ComputeTemplateDiffApplyParams,
  type ComputeTemplateDiffApplyResult,
  type TeacherAliasResolver,
  type TemplateDiffApplySummary,
  type TemplateDiffStudentNote,
  type TemplateDiffTeacherNote,
  type TemplateDiffTemplateCell,
} from './templateDiffApply'

type StudentPair = [StudentEntry | null, StudentEntry | null]
type StatusPair = [StudentStatusEntry | null, StudentStatusEntry | null]
type MemoPair = [string | null, string | null]

const defaultTeacherAliases: TeacherAliasResolver = (key) => [key]

function liveStudents(lesson?: Pick<DeskLesson, 'studentSlots'>): StudentEntry[] {
  const slots: ReadonlyArray<StudentEntry | null> = lesson?.studentSlots ?? []
  return slots.filter((student): student is StudentEntry => Boolean(student))
}

function hasMemoText(memo: string | null | undefined): memo is string {
  return typeof memo === 'string' && memo.trim() !== ''
}

// ─────────────────────────────────────────────────────────────────────────────
// 休み（§2-4）・生徒の一意（§2-2）・講師の一意（§2-3）の判定材料
// ─────────────────────────────────────────────────────────────────────────────

/** §2-4: テンプレのその生徒を置かない記録（休み・振無休・出席・「移)」）。休日の表示専用の記録（holiday）は休日のコマだけなので入れない。 */
export function isTemplateBlockingRecordStatus(status: StudentStatusKind) {
  return status === 'absent' || status === 'absent-no-makeup' || status === 'attended' || status === 'moved'
}

export type TemplateBlockReason = 'record' | 'manual'

export type TemplateStudentBlocker = {
  student: Pick<StudentEntry, 'managedStudentId' | 'name'>
  reason: TemplateBlockReason
}

export type TemplateTeacherBlocker = {
  deskIndex: number
  teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>
}

/**
 * そのコマで「テンプレのこの生徒を置かない」根拠（§2-4 の記録 → §2-2 の手入力の生徒の順）と、「テンプレのこの講師を別の机に置かない」根拠
 * （§2-3 の手置き講師）。盤面の上段（机）と保留の下段の両方を見る（下段の手入力も手入力・INV-12 を下段込みで保つ）。
 */
export function collectTemplateBlockersInCell(cell: Pick<SlotCell, 'id' | 'desks' | 'dateKey'>, pendingDesks?: TemplatePendingDeskMap | null): { students: TemplateStudentBlocker[]; teachers: TemplateTeacherBlocker[] } {
  const students: TemplateStudentBlocker[] = []
  const teachers: TemplateTeacherBlocker[] = []
  cell.desks.forEach((desk, deskIndex) => {
    const pending = pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]
    for (const entry of [...(desk.statusSlots ?? []), ...(pending?.lower.statusSlots ?? [])]) {
      if (entry && isTemplateBlockingRecordStatus(entry.status)) students.push({ student: entry, reason: 'record' })
    }
    // 下段の手入力も根拠に数える（§9-14: 差分反映は下段だけの S をテンプレの席へ先に上げる＝上げた後は上段の根拠になる。上げる席が無い S は
    // 下段のまま根拠として残り、差分反映と再マージの両方でテンプレの S を置かない＝不動点）。
    for (const student of [...liveStudents(desk.lesson), ...liveStudents(pending?.lower.lesson)]) {
      if (isManualOriginStudent(student) || isUnresolvableSameDayMoveCopy(student, cell.dateKey)) students.push({ student, reason: 'manual' })
    }
    // 2026-11-07: 下段の講師が埋め草「講師未割当」（既に保存された誤った保留）は手置きの講師に数えない（hasRealDeskTeacher・INV-01）。
    if (hasRealDeskTeacher(pending?.lower.teacher?.teacher)) teachers.push({ deskIndex, teacher: pending!.lower.teacher! })
    else if (isManualOriginDeskTeacher(desk)) teachers.push({ deskIndex, teacher: desk })
  })
  return { students, teachers }
}

/** テンプレのこの生徒が置けない理由（置けるなら null）。記録が先（§2 の当てる順）。 */
export function resolveTemplateStudentBlock(student: Pick<StudentEntry, 'managedStudentId' | 'name'>, blockers: readonly TemplateStudentBlocker[]): TemplateBlockReason | null {
  if (blockers.some((blocker) => blocker.reason === 'record' && isSameTemplateStudent(blocker.student, student))) return 'record'
  if (blockers.some((blocker) => blocker.reason === 'manual' && isSameTemplateStudent(blocker.student, student))) return 'manual'
  return null
}

/** テンプレのこの机（deskIndex）の講師 X を置けないか（同じコマの**別の机**に手置きの X が居る・§2-3）。置けないとき、その机の番号（0 始まり）。 */
export function findManualTeacherDeskElsewhere(deskIndex: number, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>, blockers: readonly TemplateTeacherBlocker[], aliases: TeacherAliasResolver = defaultTeacherAliases): number {
  if (!teacher.teacher.trim()) return -1
  const hit = blockers.find((blocker) => blocker.deskIndex !== deskIndex && isSameTeacherByAliases(blocker.teacher.teacher, teacher.teacher, aliases))
  return hit ? hit.deskIndex : -1
}

/**
 * §9-15（オーナー決定 2026-11-05）: 手置き講師 X の机にテンプレが別の講師 W を置き、テンプレが同じコマの別の机にも X を置く形では、その机の講師は X のまま
 * （W を置かず講師欄は 1 行・別の机にも X を置かない）。X がテンプレの別の机に居るかを見る（差分反映と再マージが同じこの関数で判定する）。
 * isRested（段 3 の講師の休み §2-4）: そのコマで休みの講師はテンプレの机に「居ない」と数える（休みの X は机に置かれない方が勝つ＝§9-15 の「X のまま」で W を押さえない）。
 */
export function isManualTeacherAlsoInTemplateElsewhere(deskIndex: number, manualTeacher: Pick<DeskCell, 'teacher'>, templateDesks: ReadonlyArray<Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>>, aliases: TeacherAliasResolver = defaultTeacherAliases, isRested: (templateDesk: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>) => boolean = () => false): boolean {
  if (!manualTeacher.teacher.trim()) return false
  return templateDesks.some((templateDesk, index) => index !== deskIndex && templateDesk.teacher.trim() !== '' && isSameTeacherByAliases(templateDesk.teacher, manualTeacher.teacher, aliases) && !isRested(templateDesk))
}

/**
 * 講師の休み（§2-4・段 3）の差し込み口。盤面の休みの記録（日付×時限×講師）から teacherRest.ts の buildTemplateTeacherRestPredicate が作る。
 * 差分反映と再マージの両方がこの関数を通す（片方だけ休みを見ると不動点が崩れる）。休みが無い教室・フラグ OFF の教室は noTemplateTeacherRest。
 */
export type TemplateTeacherRestPredicate = (cell: Pick<SlotCell, 'dateKey' | 'slotNumber'>, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>) => boolean
export const noTemplateTeacherRest: TemplateTeacherRestPredicate = () => false

/**
 * 再マージ（機能フラグ templateDiffApply の教室）が管理セル（抑止・丸ごと振替の strip を当てた後）へ当てる、§2-2・§2-3・§2-4 の取り除き。
 * 差分反映が同じコマで置かなかったテンプレの生徒・講師を、保存直後・読み込み時の再マージでも置かない（不動点）。抑止キーを積まずに
 * 「盤面の今の状態から毎回同じ結果」を出すための唯一の経路（§6 抑止キー）。
 * 生徒は全員取り除かれた机を抑止と同じ形（buildFullySuppressedManagedDesk）にする。
 */
export function applyTemplateOriginRulesToManagedCell(managedCell: SlotCell, boardCell: Pick<SlotCell, 'id' | 'desks' | 'dateKey'>, pendingDesks: TemplatePendingDeskMap | null | undefined, aliases: TeacherAliasResolver = defaultTeacherAliases, isTeacherOnRest: TemplateTeacherRestPredicate = noTemplateTeacherRest, sameDayMoveSources: readonly SameDayMoveSource[] = []): SlotCell {
  const blockers = collectTemplateBlockersInCell(boardCell, pendingDesks)
  // §1-1 #2: 同じ日の中で手で動かしたテンプレの授業（写し）の元の時限には、次のテンプレ反映までテンプレの同じ授業を置き直さない（移動の抑止キーの代わり）。
  const movedAway = sameDayMoveSources.filter((source) => source.slotNumber === managedCell.slotNumber)
  // 休みの述語（§2-4）を渡されたときは、ほかの取り除きが無くてもテンプレの講師を休みと突き合わせる（早く返すと休みの講師が置かれる）。
  if (blockers.students.length === 0 && blockers.teachers.length === 0 && movedAway.length === 0 && isTeacherOnRest === noTemplateTeacherRest) return managedCell
  const isMovedAway = (student: StudentEntry) => movedAway.some((source) => source.subject === student.subject && isSameTemplateStudent(source.student, student))
  let changed = false
  const desks = managedCell.desks.map((desk, deskIndex) => {
    let next = desk
    if (desk.lesson && isTemplateManagedLesson(desk.lesson) && (blockers.students.length > 0 || movedAway.length > 0)) {
      const slots = desk.lesson.studentSlots.map((student) => (student && (resolveTemplateStudentBlock(student, blockers.students) || isMovedAway(student)) ? null : student)) as StudentPair
      if (slots[0] !== desk.lesson.studentSlots[0] || slots[1] !== desk.lesson.studentSlots[1]) {
        changed = true
        next = !slots[0] && !slots[1] ? buildFullySuppressedManagedDesk(desk) : { ...desk, lesson: { ...desk.lesson, studentSlots: slots } }
      }
    }
    // §9-22 案 A（2026-11-06）: 並び替えた週では管理机 i と盤面机 i が対応しない（再マージは授業 ID で突き合わせる）。「自分の机」は授業 ID の対応
    // （授業の無いテンプレの机は同じテンプレ講師の机）で引き、見つからないときだけ机番号（差分反映の直後は番号が揃っているので結果は今までと同じ）。
    const boardDeskIndex = resolveBoardDeskIndexForManagedDesk(managedCell.desks, deskIndex, boardCell.desks, aliases)
    const ownManual = blockers.teachers.find((blocker) => blocker.deskIndex === boardDeskIndex)
    const keptByManualX = Boolean(ownManual) && !isSameTeacherByAliases(ownManual!.teacher.teacher, next.teacher, aliases) && isManualTeacherAlsoInTemplateElsewhere(deskIndex, ownManual!.teacher, managedCell.desks, aliases, (templateDesk) => isTeacherOnRest(managedCell, templateDesk))
    if (next.teacher.trim() && (keptByManualX || findManualTeacherDeskElsewhere(boardDeskIndex, next, blockers.teachers, aliases) >= 0 || isTeacherOnRest(managedCell, next))) {
      changed = true
      next = { ...next, teacher: '', teacherAssignmentTeacherId: undefined }
    }
    return next
  })
  return changed ? { ...managedCell, desks } : managedCell
}

/**
 * 管理机（テンプレの机・deskIndex）に対応する盤面の机の番号（§9-22 案 A・並び替えた週の再マージ）。mergeManagedWeek と同じく授業 ID で突き合わせる。
 * 授業の無いテンプレの机（足場講師）は、同じ講師の非 manual の盤面の机（テンプレの授業を持たない）へ。同じ講師の講師だけの机がテンプレに 2 つ以上あると
 * どれか決められないので机番号。どれも見つからなければ机番号（並び替えていない週・差分反映の直後と同じ）。
 */
export function resolveBoardDeskIndexForManagedDesk(managedDesks: ReadonlyArray<Pick<DeskCell, 'teacher' | 'lesson'>>, deskIndex: number, boardDesks: ReadonlyArray<Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'lesson'>>, aliases: TeacherAliasResolver = defaultTeacherAliases): number {
  const managedDesk = managedDesks[deskIndex]
  if (!managedDesk) return deskIndex
  if (managedDesk.lesson && isTemplateManagedLesson(managedDesk.lesson)) {
    const lessonId = managedDesk.lesson.id
    if (boardDesks[deskIndex]?.lesson?.id === lessonId) return deskIndex
    const hit = boardDesks.findIndex((desk) => desk.lesson?.id === lessonId)
    return hit >= 0 ? hit : deskIndex
  }
  const name = managedDesk.teacher.trim()
  if (!name || managedDesk.lesson) return deskIndex
  const sameTeacherOnly = managedDesks.filter((desk) => !desk.lesson && isSameTeacherByAliases(desk.teacher, name, aliases)).length
  if (sameTeacherOnly !== 1) return deskIndex
  const isScaffoldOf = (desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'lesson'>) => !isManualOriginDeskTeacher(desk) && !(desk.lesson && isTemplateManagedLesson(desk.lesson)) && isSameTeacherByAliases(desk.teacher, name, aliases)
  if (boardDesks[deskIndex] && isScaffoldOf(boardDesks[deskIndex])) return deskIndex
  const hit = boardDesks.findIndex(isScaffoldOf)
  return hit >= 0 ? hit : deskIndex
}

/**
 * 同じ日の中で手で動かしたテンプレの授業の「元の時限」を決める**唯一の権威関数**（regression-reviewer 重大-1）。
 * 再マージ（collectSameDayMoveSourcesByDate）・保存のキー外し（collectSameDayMovedTemplateOccurrenceKeys）・削除／格納の削除記録の時限
 * （ScheduleBoardScreen の resolveRemovedLessonOccurrenceKey）がこれを通す。生きている写し（StudentEntry）と、写しに付けた記録
 * （StudentStatusEntry・buildStudentStatusEntry が sameDayMoveSourceDate／Label を写す）の両方に使える。
 * 通常授業で sameDayMoveSourceDate がその日・出自＝テンプレ・元の時限（sameDayMoveSourceLabel）が読めるときだけ時限を返す。
 */
export function resolveSameDayMoveSourceSlot(entry: Pick<StudentEntry, 'origin' | 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular' | 'sameDayMoveSourceDate' | 'sameDayMoveSourceLabel'>, dateKey: string): number | null {
  if (entry.lessonType !== 'regular' || entry.sameDayMoveSourceDate !== dateKey || resolveStudentOrigin(entry) !== 'template') return null
  return parseOriginSlotNumberFromLabel(entry.sameDayMoveSourceLabel) || null
}

/**
 * 元の時限が読めない旧い写し（同じ日の中で動かしたテンプレの授業で sameDayMoveSourceLabel が無い・読めない）。キーを外せない（削除の記録を守る側に倒す）ので、
 * テンプレ反映で捨てると、その日のその授業がどこにも無くなる（regression-reviewer 要修正-3・INV-02）。手入力として残す。
 */
export function isUnresolvableSameDayMoveCopy(student: Pick<StudentEntry, 'origin' | 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular' | 'sameDayMoveSourceDate' | 'sameDayMoveSourceLabel'>, dateKey: string): boolean {
  return student.lessonType === 'regular' && student.sameDayMoveSourceDate === dateKey && resolveStudentOrigin(student) === 'template' && resolveSameDayMoveSourceSlot(student, dateKey) == null
}

/** その日に置いた場所での出自（元の時限が読めない旧い写しは手入力として扱う）。差分反映の席・§2-2 の根拠の両方がこれを使う。 */
export function resolveStudentOriginOnDate(student: StudentEntry, dateKey: string) {
  return isUnresolvableSameDayMoveCopy(student, dateKey) ? 'manual' : resolveStudentOrigin(student)
}

/** 同じ日の中で手で動かしたテンプレの授業の元の時限。kind: copy＝生きている写し／record＝写しに付けた記録（休み・振無休・出席・移)）。 */
export type SameDayMoveSource = { student: Pick<StudentEntry, 'managedStudentId' | 'name'>; subject: string; slotNumber: number; kind: 'copy' | 'record' }

/**
 * 日付 → その日の写し・写しの記録の元の時限（上段・保留の下段）。判定は resolveSameDayMoveSourceSlot。
 * 再マージ（フラグ ON）は両方の元の時限にテンプレの同じ授業を置き直さない。差分反映は記録の元の時限にだけ置かない（写しはテンプレの位置へ戻す）。
 */
export function collectSameDayMoveSourcesByDate(weeks: SlotCell[][], pendingDesks?: TemplatePendingDeskMap | null): Map<string, SameDayMoveSource[]> {
  const byDate = new Map<string, SameDayMoveSource[]>()
  const consider = (entry: StudentEntry | StudentStatusEntry | null | undefined, dateKey: string, kind: SameDayMoveSource['kind']) => {
    if (!entry) return
    const slotNumber = resolveSameDayMoveSourceSlot(entry, dateKey)
    if (!slotNumber) return
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), { student: entry, subject: entry.subject, slotNumber, kind }])
  }
  for (const week of weeks) for (const cell of week) for (const desk of cell.desks) {
    const lower = pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower
    for (const student of [...(desk.lesson?.studentSlots ?? []), ...(lower?.lesson?.studentSlots ?? [])]) consider(student, cell.dateKey, 'copy')
    for (const record of [...(desk.statusSlots ?? []), ...(lower?.statusSlots ?? [])]) consider(record, cell.dateKey, 'record')
  }
  return byDate
}

/**
 * §4-2 規則 1・§2-2（INV-05）: 盤面の今の状態から、§2-2 でテンプレの授業が置かれていない回を導く（保存で −1 を積まない）。
 * expected＝その日・その時限にテンプレが持つ授業（生徒 ID×科目）。その時限のコマに手入力の同じ生徒（上段・下段）が居て、テンプレの同じ生徒が
 * そのコマに居ない回だけを返す。保存でも読み込みでも同じ結果、手入力を消せば自動で戻る、何回保存しても二重にならない。
 * ★削除の記録（抑止キー）がある回は数えない: 「下段（手入力）を採用する」で室長が明示的に取り下げた授業（決定記録 62）や単発削除は、
 *   単発削除と同じ −1（scheduleCountAdjustments）を操作の記録として積んでいるので、ここで引くと二重になる。
 */
export function collectManualFirstBlockedLessons(params: {
  weeks: SlotCell[][]
  pendingDesks?: TemplatePendingDeskMap | null
  expected: ReadonlyArray<{ studentId: string; name?: string; subject: string; dateKey: string; slotNumber: number }>
  suppressedRegularLessonOccurrences?: readonly string[]
  /** §2-4 の記録（別の科目）でテンプレの授業が置かれていない回も数える（保存則の監査が使う）。 */
  includeRecordBlocked?: boolean
}): Array<{ studentId: string; name?: string; subject: string; dateKey: string; slotNumber: number }> {
  const suppressed = new Set(params.suppressedRegularLessonOccurrences ?? [])
  const cellByDateSlot = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) cellByDateSlot.set(`${cell.dateKey}_${cell.slotNumber}`, cell)
  return params.expected.filter((item) => {
    if (suppressed.has(`${item.studentId}__${item.subject}__${item.dateKey}__${item.slotNumber}`)) return false
    const cell = cellByDateSlot.get(`${item.dateKey}_${item.slotNumber}`)
    if (!cell || !cell.isOpenDay) return false
    const same = (student: StudentEntry) => isSameTemplateStudent({ managedStudentId: item.studentId, name: item.name ?? item.studentId }, student)
    // §9-14: 下段は「置いてある」に数えない（上段＝実配置の手入力の S だけ・同一性は isSameTemplateStudent）。
    const live = cell.desks.flatMap((desk) => liveStudents(desk.lesson)).filter(same)
    if (live.some((student) => resolveStudentOrigin(student) === 'template')) return false
    if (live.some((student) => resolveStudentOrigin(student) === 'manual')) return true
    // §2-4（includeRecordBlocked）: そのコマに同じ生徒の別の科目の記録（休み・振無休・出席・移)）があるとテンプレの S は置かない（記録が勝つ）。
    // 同じ科目の記録はその授業そのものの説明なので数えない（監査の statusRecord と重ねない）。
    if (!params.includeRecordBlocked) return false
    return cell.desks.some((desk) => [...(desk.statusSlots ?? []), ...(params.pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower.statusSlots ?? [])]
      .some((entry) => entry && isTemplateBlockingRecordStatus(entry.status) && entry.subject !== item.subject && isSameTemplateStudent({ managedStudentId: item.studentId, name: item.name ?? item.studentId }, entry)))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 差分反映（席の規則 §2-1 まで）
// ─────────────────────────────────────────────────────────────────────────────

/** §2-2 で置かなかったテンプレの生徒（確認の画面に名前つき・§4-2 規則 1 の −1 の候補）。 */
export type TemplateManualFirstSkip = { student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number }

/** 席に入る手入力の 1 件（生徒かメモ）。 */
type ManualSeatItem = { kind: 'student'; student: StudentEntry; seat: number } | { kind: 'memo'; memo: string; seat: number }

// checklistPrepTeacher（確認リストの準備で置いた講師の印・§E-2-4-2）も講師の項目として一緒に動かす（テンプレの講師に替わると外れる・下の行の講師へ移る）。
const TEACHER_FIELD_KEYS = ['teacher', 'manualTeacher', 'teacherAssignmentSource', 'teacherAssignmentSessionId', 'teacherAssignmentTeacherId', 'checklistPrepTeacher'] as const

function pickTeacher(desk: TemplatePendingLowerTeacher): TemplatePendingLowerTeacher {
  return {
    teacher: desk.teacher,
    manualTeacher: desk.manualTeacher,
    teacherAssignmentSource: desk.teacherAssignmentSource,
    teacherAssignmentSessionId: desk.teacherAssignmentSessionId,
    teacherAssignmentTeacherId: desk.teacherAssignmentTeacherId,
    ...(desk.checklistPrepTeacher ? { checklistPrepTeacher: true as const } : {}),
  }
}

function withTeacher(desk: DeskCell, fields: TemplatePendingLowerTeacher): DeskCell {
  const next: DeskCell = { ...desk }
  for (const key of TEACHER_FIELD_KEYS) {
    const value = fields[key]
    if (value === undefined) delete (next as Record<string, unknown>)[key]
    else (next as Record<string, unknown>)[key] = value
  }
  next.teacher = fields.teacher ?? ''
  return next
}

const NO_TEACHER: TemplatePendingLowerTeacher = { teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: undefined }

function templateTeacherFields(templateDesk: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>): TemplatePendingLowerTeacher {
  const teacher = templateDesk.teacher.trim() ? templateDesk.teacher : ''
  return { teacher, manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: teacher ? templateDesk.teacherAssignmentTeacherId : undefined }
}

function cloneStatus(entry: StudentStatusEntry): StudentStatusEntry {
  return { ...entry, ...(entry.holidayStockReturn ? { holidayStockReturn: { ...entry.holidayStockReturn } } : {}) }
}

/** 机の手入力（生徒・メモ）を席ごとに集める。上段→下段の順（上段のものが元の席を先に取る）。テンプレ由来の生徒は入れない（新テンプレで置き直す）。 */
function collectManualSeatItems(desk: DeskCell, pending: TemplatePendingDesk | undefined, dateKey: string): { items: ManualSeatItem[]; discardedTemplateStudents: StudentEntry[] } {
  const items: ManualSeatItem[] = []
  const discardedTemplateStudents: StudentEntry[] = []
  const take = (lesson: DeskLesson | undefined, memos: MemoPair | undefined) => {
    ;(lesson?.studentSlots ?? []).forEach((student, seat) => {
      if (!student) return
      if (resolveStudentOriginOnDate(student, dateKey) === 'manual') items.push({ kind: 'student', student: { ...student }, seat })
      else discardedTemplateStudents.push(student)
    })
    ;(memos ?? []).forEach((memo, seat) => { if (hasMemoText(memo)) items.push({ kind: 'memo', memo, seat }) })
  }
  take(desk.lesson, desk.memoSlots)
  take(pending?.lower.lesson, pending?.lower.memoSlots)
  return { items, discardedTemplateStudents }
}

type DeskApplyOutcome = {
  desk: DeskCell
  pending: TemplatePendingDesk | null
  /** 席で 2 行になった（生徒・メモ）。 */
  seatPending: boolean
  /** 講師欄で 2 行になった。 */
  teacherPending: boolean
  overflow: boolean
}

function seatIndexOf(lesson: DeskLesson | undefined, student: StudentEntry) {
  return Math.max(0, (lesson?.studentSlots ?? []).findIndex((seat) => seat === student))
}

/**
 * 1 つの机に §2-1（席）と §2-3（講師）を当てる。templateDesk は §2-2・§2-4・丸ごと振替の日の取り除きを当てた後のテンプレの机。
 * 戻り値の desk は上段（テンプレ＋テンプレの席が空いた所の手入力）、pending は下段（テンプレと同じ席の手入力・手置き講師）。
 */
function applyRulesToDesk(params: {
  cell: SlotCell
  desk: DeskCell
  deskIndex: number
  templateDesk: DeskCell
  pending: TemplatePendingDesk | undefined
  teacherBlockers: readonly TemplateTeacherBlocker[]
  aliases: TeacherAliasResolver
  isTeacherOnRest: TemplateTeacherRestPredicate
  keepTemplateOriginTeacherWithManualStudents: boolean
  createdAt: string
  effectiveStartDate: string
  teacherNotes: TemplateDiffTeacherNote[]
  discarded: StudentEntry[]
  /** そのコマのテンプレ（抑止・丸ごと振替の取り除き前）の講師（削除記録を外してよいかの判定）。 */
  cellTemplateTeachers: ReadonlyArray<Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>>
  onDeletedTeacherDeskReassigned: () => void
  onDeletedTeacherDeskFilled: () => void
  onTombstoneCleared: () => void
}): DeskApplyOutcome {
  const { cell, desk, deskIndex, templateDesk, pending } = params
  const templateLesson = templateDesk.lesson && liveStudents(templateDesk.lesson).length > 0 ? templateDesk.lesson : undefined
  const { items, discardedTemplateStudents } = collectManualSeatItems(desk, pending, cell.dateKey)
  params.discarded.push(...discardedTemplateStudents)

  // ── 席（§2-1）: 上段＝テンプレの生徒の席。手入力は元の席の上段が空いていれば上段（1 行）、テンプレの生徒が居れば下段（2 行）、
  //    下段も埋まっていればもう一方の席。生徒とメモは別の枠（studentSlots / memoSlots）なので、下段では同じ席に生徒とメモが並べる（旧来の保留と同じ形）。
  const upperSlots: StudentPair = [null, null]
  const upperMemos: MemoPair = [null, null]
  const lowerSlots: StudentPair = [null, null]
  const lowerMemos: MemoPair = [null, null]
  if (templateLesson) templateLesson.studentSlots.forEach((student, seat) => { if (student) upperSlots[seat] = { ...student } })
  const upperFree = (seat: number) => !upperSlots[seat] && upperMemos[seat] == null
  let overflow = false
  const ordered = [...items.filter((item) => item.kind === 'student'), ...items.filter((item) => item.kind === 'memo')]
  for (const item of ordered) {
    let placed = false
    for (const seat of [item.seat, item.seat === 0 ? 1 : 0]) {
      if (upperFree(seat)) {
        if (item.kind === 'memo') upperMemos[seat] = item.memo
        else upperSlots[seat] = item.student
        placed = true
        break
      }
      if (item.kind === 'student' && !lowerSlots[seat]) { lowerSlots[seat] = item.student; placed = true; break }
      if (item.kind === 'memo' && lowerMemos[seat] == null) { lowerMemos[seat] = item.memo; placed = true; break }
    }
    if (!placed) overflow = true
  }
  if (overflow) {
    // 席が足りない（整合の取れたデータでは起きない）→ 机と保留を変えない（黙って捨てない）。
    return { desk, pending: pending ?? null, seatPending: Boolean(pending), teacherPending: Boolean(pending?.lower.teacher), overflow: true }
  }

  // ── 講師（§2-3・§2-4 講師の休み）
  // 2026-11-07（オーナー指示・INV-01 / INV-02）: テンプレの机の講師が埋め草「講師未割当」（講師の居ない行）でも templateTeacher には入れたまま
  // （手置き講師の居ない机・削除記録の机には従来どおり埋め草を書く＝再マージが管理授業の机に同じ埋め草を入れる不動点・INV-03）。
  // 埋め草は手置きの講師（blockers・manualTeacher）に数えないので「別の机に手で置いた同じ講師」にはならず、手置き講師とのぶつかりでは
  // 「テンプレに講師なし」として扱う（下の manualTeacher の分岐）。
  const templateTeacher = templateDesk.teacher.trim() && !params.isTeacherOnRest(cell, templateDesk) ? templateDesk : null
  const claimedAt = templateTeacher ? findManualTeacherDeskElsewhere(deskIndex, templateTeacher, params.teacherBlockers, params.aliases) : -1
  const placeableTemplateTeacher = templateTeacher && claimedAt < 0 ? templateTeacher : null
  const elsewhereNote: TemplateDiffTeacherNote | null = templateTeacher && claimedAt >= 0
    ? { kind: 'teacher-elsewhere', teacherName: templateTeacher.teacher, templateTeacher: String(claimedAt + 1), dateKey: cell.dateKey, slotNumber: cell.slotNumber }
    : null
  if (elsewhereNote) params.teacherNotes.push(elsewhereNote)
  // 下段の講師が埋め草（既に保存された誤った保留・2026-11-07）は手置きの講師ではない＝外す（下段に講師を残さない）。
  const manualTeacher: TemplatePendingLowerTeacher | null = hasRealDeskTeacher(pending?.lower.teacher?.teacher)
    ? pending!.lower.teacher!
    : isManualOriginDeskTeacher(desk) ? pickTeacher(desk) : null
  let upperTeacher: TemplatePendingLowerTeacher
  let lowerTeacher: TemplatePendingLowerTeacher | null = null
  const hasUpperStudents = Boolean(upperSlots[0] || upperSlots[1])
  // 2026-11-07（§4-1 の講師欄版・tp-64 / tp-69 / tp-70）: 「下段(手入力)の講師を採用する」でこの机で取り下げたテンプレの講師は、机に手置き講師が居る間この机に置かない
  // （§2-3「手置き講師 Y × テンプレに講師なし → Y のまま」と同じ形）。下段にまだ講師の選択が残っている机（未解決のぶつかり）には使わない。
  const declinedHere = !hasRealDeskTeacher(pending?.lower.teacher?.teacher) && isTemplateTeacherDeclinedAtDesk(desk, templateDesk, params.aliases)
  if (manualTeacher) {
    // 埋め草（講師の居ない行）は「テンプレに講師なし」＝手置き講師のまま 1 行（講師欄 2 行にしない・2026-11-07）。
    if (!placeableTemplateTeacher || isDeskTeacherPlaceholder(placeableTemplateTeacher.teacher) || declinedHere || isSameTeacherByAliases(placeableTemplateTeacher.teacher, manualTeacher.teacher, params.aliases)) {
      upperTeacher = pickTeacher(manualTeacher)
      // 2026-11-11 オーナー決定「文を事実に合わせる」: テンプレの講師を置かなかった机（teacher-elsewhere）に手で置いた講師が残るときは、確認画面の文を
      // 「講師欄は手で置いた講師 Y のままです」にする（動きは変えない・埋め草は講師ではない＝空のままの文）。
      if (elsewhereNote && hasRealDeskTeacher(upperTeacher.teacher)) elsewhereNote.deskTeacherName = upperTeacher.teacher
    } else if (isManualTeacherAlsoInTemplateElsewhere(deskIndex, manualTeacher, params.cellTemplateTeachers, params.aliases, (templateDesk) => params.isTeacherOnRest(cell, templateDesk))) {
      // §9-15: X がテンプレの別の机にも居る → この机は X のまま（W を置かない・講師欄は 1 行）。別の机の X は §2-3 で置かない。
      upperTeacher = pickTeacher(manualTeacher)
      params.teacherNotes.push({ kind: 'teacher-kept', teacherName: placeableTemplateTeacher.teacher, templateTeacher: manualTeacher.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber })
    } else {
      upperTeacher = templateTeacherFields(placeableTemplateTeacher)
      lowerTeacher = pickTeacher(manualTeacher)
      const keptStudentNames = upperSlots.filter((student): student is StudentEntry => Boolean(student) && resolveStudentOrigin(student!) === 'manual').map((student) => student.name)
      params.teacherNotes.push({ kind: 'teacher-pending', teacherName: manualTeacher.teacher, templateTeacher: placeableTemplateTeacher.teacher, dateKey: cell.dateKey, slotNumber: cell.slotNumber, keptStudentNames, templateTeacherOnly: !templateLesson })
    }
  } else if (isTemplateDiffTeacherTombstone(desk) && !placeableTemplateTeacher && !templateLesson && !(upperSlots[0] || upperSlots[1]) && !desk.statusSlots?.some(Boolean) && upperMemos[0] == null && upperMemos[1] == null && !pending) {
    // 講師の削除記録だけの空き机で、テンプレの机も空 → 記録を外す（覚えておく講師が居ない・旧 Q21-3 の 5 行目と同じ）。
    upperTeacher = NO_TEACHER
    params.onTombstoneCleared()
  } else if (isTemplateDiffTeacherTombstone(desk)) {
    // 削除記録（§1-1 #14）: 消した講師は置かない。別の講師なら置く（削除記録は消した講師だけに有効・オーナー決定 2026-10-14）。
    // ただし消した講師がそのコマのテンプレの別の机に居る間は記録を残す（記録が「消した講師を再付与しない」唯一の記憶・H-1・canClearDeletedTeacherTombstone）。
    if (placeableTemplateTeacher && !doesDeletedTeacherTombstoneBlock(desk, placeableTemplateTeacher, params.aliases) && canClearDeletedTeacherTombstone(desk, params.cellTemplateTeachers, params.aliases)) {
      upperTeacher = templateTeacherFields(placeableTemplateTeacher)
      params.onDeletedTeacherDeskReassigned()
    } else {
      upperTeacher = pickTeacher(desk)
      if (templateLesson) params.onDeletedTeacherDeskFilled()
    }
  } else if (placeableTemplateTeacher) {
    upperTeacher = templateTeacherFields(placeableTemplateTeacher)
  } else if (params.keepTemplateOriginTeacherWithManualStudents && hasUpperStudents && desk.teacher.trim()) {
    // 丸ごと振替の日（旧 Q35-7・段 4 まで今のまま）: テンプレの講師は日単位で外れるが、手入力の生徒が残る机の講師はそのまま。
    upperTeacher = pickTeacher(desk)
  } else {
    upperTeacher = NO_TEACHER
  }

  // ── 机を組み立てる
  let upperLesson: DeskLesson | undefined
  if (templateLesson) upperLesson = { ...templateLesson, studentSlots: upperSlots }
  else if (upperSlots[0] || upperSlots[1]) {
    const base = desk.lesson ?? pending?.lower.lesson ?? { id: `${desk.id}_manual` }
    upperLesson = { ...base, studentSlots: upperSlots }
    if (isTemplateManagedLesson(upperLesson)) {
      // 旧テンプレの管理授業の id のまま残すと、新テンプレの同じ行 id と突き合って別の机の授業に吸われる（机固有の id に付け替える）。
      upperLesson = { ...upperLesson, id: `${desk.id}_template_kept` }
      if (upperLesson.note === '管理データ反映') delete upperLesson.note
    }
  }
  // 記録（§4-2 規則 3: 採用の対象外・動かさない）。上段の記録は元の席のまま。下段の記録は上段の同じ席（空いていればもう一方）へ戻し、入らなければ下段に残す。
  const upperStatus: StatusPair = [desk.statusSlots?.[0] ? cloneStatus(desk.statusSlots[0]) : null, desk.statusSlots?.[1] ? cloneStatus(desk.statusSlots[1]) : null]
  const lowerStatus: StatusPair = [null, null]
  ;(pending?.lower.statusSlots ?? []).forEach((entry, seat) => {
    if (!entry) return
    const other = seat === 0 ? 1 : 0
    if (!upperStatus[seat]) upperStatus[seat] = cloneStatus(entry)
    else if (!upperStatus[other]) upperStatus[other] = cloneStatus(entry)
    else lowerStatus[seat] = cloneStatus(entry)
  })

  const base = withTeacher(desk, upperTeacher)
  const nextDesk: DeskCell = { ...base }
  // 取り下げの記録は、テンプレがこの机に同じ講師を置き続ける間だけ残す（別の講師・講師なしになった反映で使い切り。戻ってきたら新しいぶつかりとして 2 行）。
  if (!declinedHere) delete nextDesk.templateTeacherDeclined
  if (upperLesson) nextDesk.lesson = upperLesson
  else delete nextDesk.lesson
  if (upperStatus[0] || upperStatus[1]) nextDesk.statusSlots = upperStatus
  else delete nextDesk.statusSlots
  if (upperMemos[0] != null || upperMemos[1] != null) nextDesk.memoSlots = upperMemos
  else delete nextDesk.memoSlots

  const seatPending = Boolean(lowerSlots[0] || lowerSlots[1] || lowerMemos[0] != null || lowerMemos[1] != null || lowerStatus[0] || lowerStatus[1])
  if (!seatPending && !lowerTeacher) return { desk: nextDesk, pending: null, seatPending: false, teacherPending: false, overflow: false }
  const nextLower: TemplatePendingLower = {}
  if (lowerSlots[0] || lowerSlots[1]) nextLower.lesson = { ...(pending?.lower.lesson ?? { id: `pending_lower_${cell.dateKey}_${cell.slotNumber}_${deskIndex}` }), studentSlots: lowerSlots }
  if (lowerStatus[0] || lowerStatus[1]) nextLower.statusSlots = lowerStatus
  if (lowerMemos[0] != null || lowerMemos[1] != null) nextLower.memoSlots = lowerMemos
  if (lowerTeacher) nextLower.teacher = lowerTeacher
  const nextPending: TemplatePendingDesk = pending
    ? { ...pending, lower: nextLower }
    : { lower: nextLower, effectiveStartDate: params.effectiveStartDate, createdAt: params.createdAt }
  return { desk: nextDesk, pending: nextPending, seatPending, teacherPending: Boolean(lowerTeacher), overflow: false }
}

function seatOfStudentIn(lesson: DeskLesson | undefined, student: StudentEntry) {
  return seatIndexOf(lesson, student)
}

/**
 * テンプレ保存の差分反映（第 2 版）。保存本体と確認の画面の件数（試し実行）の両方が同じ入力で呼ぶ（Q32-1）。
 * 反映日より前のセル・週は参照ごとそのまま返す（INV-10・Q1）。範囲は反映日以降の生成済みの全コマ（旧 Q39 の絞り込みは使わない・§6）。
 */
export function computeTemplateDiffApply(params: ComputeTemplateDiffApplyParams & { isTeacherOnRest?: TemplateTeacherRestPredicate; scheduleCountAdjustments?: readonly ScheduleCountAdjustmentEntry[] }): ComputeTemplateDiffApplyResult & { manualFirstSkipped: TemplateManualFirstSkip[]; discardedTemplateStudents: Array<{ student: StudentEntry; dateKey: string; cellId: string }>; lowerPromotionNotes: TemplateDiffStudentNote[] } {
  const summary: TemplateDiffApplySummary = createEmptyTemplateDiffApplySummary()
  const aliases = params.teacherAliases ?? defaultTeacherAliases
  const isTeacherOnRest = params.isTeacherOnRest ?? noTemplateTeacherRest
  const nextPendingDesks: TemplatePendingDeskMap = { ...params.pendingDesks }
  const existingSuppressed = new Set(params.suppressedRegularLessonOccurrences)
  const addedSuppressed = new Set<string>()
  const wholeDayTransferSkipped: ComputeTemplateDiffApplyResult['wholeDayTransferSkipped'] = []
  const teacherNotes: TemplateDiffTeacherNote[] = []
  const manualFirstSkipped: TemplateManualFirstSkip[] = []
  const discardedTemplateStudents: Array<{ student: StudentEntry; dateKey: string; cellId: string }> = []
  const sameDayMoveSourcesByDate = collectSameDayMoveSourcesByDate(params.weeks, params.pendingDesks)
  const templateById = new Map(params.templateCells.map((entry) => [entry.applied.id, entry]))
  const templateByDateSlot = new Map(params.templateCells.map((entry) => [`${entry.applied.dateKey}_${entry.applied.slotNumber}`, entry]))

  const studentNotes: TemplateDiffStudentNote[] = []
  const applyCell = (inputCell: SlotCell, templateCell: TemplateDiffTemplateCell): SlotCell => {
    let cell = inputCell
    // 休日（Q21-6）: 休日のコマは再マージが記録だけを残す（carryBoardStatusRecordsOntoClosedDayCell）。差分反映は触らない。
    // ただし丸ごと振替した日を休日設定した振替元（Q40-2・段 4 まで今のまま）は、足した生徒を振替先へ置く対象に拾う。
    if (!templateCell.applied.isOpenDay) {
      if (templateCell.scaffoldTeachersStripped && templateCell.closedTransferSourceDesks) {
        templateCell.closedTransferSourceDesks.forEach((templateDesk, deskIndex) => {
          if (deskIndex >= cell.desks.length) return
          for (const student of liveStudents(templateDesk.lesson)) {
            const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
            if (existingSuppressed.has(key)) continue
            summary.wholeDayTransferSkippedStudents += 1
            wholeDayTransferSkipped.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex, seatIndex: seatOfStudentIn(templateDesk.lesson, student) })
            addedSuppressed.add(key)
          }
        })
      }
      return cell
    }
    // §9-14（オーナー決定 2026-11-05・受け入れ条件 2-11）: 手入力の S が緑の下の行にしか居ない（上の行には居ない）ときにテンプレが S を置こうとしたら、
    // 下の行の S をテンプレの席へ上げて 1 行にする（テンプレの S は置かない・その席は手入力の S）。上げる席が無い（その席に手入力・メモ・下段がある）ときは
    // 上げず、テンプレの S も置かない（§2-2・確認の画面に理由）。上げた後の盤面で残りの規則を当てる。
    const promoted = promoteLowerOnlyManualStudents(cell, templateCell, params.pendingDesks)
    cell = promoted.cell
    const cellPending = promoted.pendingDesks
    for (const item of promoted.promotions) studentNotes.push({ kind: 'lower-promoted', studentName: item.student.name, subject: item.student.subject, dateKey: cell.dateKey, slotNumber: cell.slotNumber, detail: String(item.deskIndex + 1) })
    // 2026-11-07 オーナー報告（確認リスト v2-3 の「詳細」で上げた生徒が 2 行）: 上げた席のテンプレの S は、上げた手入力の S が席に居るので下で置かない（盤面は今のまま）が、
    // それは「上げて 1 行（テンプレの同じ授業は置きません）」の 1 行で言い終えている。「同じコマに手入力の同じ生徒が先にある」の行と
    // 「別の机に居るため上段に置かなかった」の件数には入れない（予定数は盤面から導く collectManualFirstBlockedLessons のままで変わらない・INV-06）。
    const blockers = collectTemplateBlockersInCell(cell, cellPending)
    // 重大-1（regression-reviewer）: 同じ日の中で動かしたテンプレの授業に記録（休み・振無休・出席・移)）を付けた生徒は、記録が勝つ（§2-4）＝元の時限にも
    // テンプレの同じ授業を置かない（置くと休んだ授業が元の時限に生き返る）。生きている写しはテンプレの位置へ戻す（§1-1 #2）ので数えない。
    const recordMovedAway = (sameDayMoveSourcesByDate.get(cell.dateKey) ?? []).filter((source) => source.kind === 'record' && source.slotNumber === cell.slotNumber)
    // ── テンプレの机（丸ごと振替の日・§2-4・§2-2 を当てる）
    const templateDesks = cell.desks.map((_, deskIndex) => {
      const templateDesk = templateCell.applied.desks[deskIndex] ?? { id: '', teacher: '' }
      if (!templateDesk.lesson || liveStudents(templateDesk.lesson).length === 0) return templateDesk
      const slots = [...templateDesk.lesson.studentSlots] as StudentPair
      slots.forEach((student, seat) => {
        if (!student) return
        if (templateCell.scaffoldTeachersStripped) {
          // 丸ごと振替した日（旧 Q35・段 4 まで今のまま）: テンプレの生徒を置かず、振替先へ置く対象（Q40-2）に回す。抑止キーは今どおり積む。
          summary.wholeDayTransferSkippedStudents += 1
          wholeDayTransferSkipped.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex, seatIndex: seat })
          const key = buildTemplateOccurrenceKey(student, cell.dateKey, cell.slotNumber)
          if (!existingSuppressed.has(key)) addedSuppressed.add(key)
          slots[seat] = null
          return
        }
        if (recordMovedAway.some((source) => source.subject === student.subject && isSameTemplateStudent(source.student, student))) { slots[seat] = null; return }
        const reason = resolveTemplateStudentBlock(student, blockers.students)
        if (!reason) return
        slots[seat] = null
        if (reason === 'manual' && !promoted.promotions.some((item) => item.deskIndex === deskIndex && item.seat === seat && isSameTemplateStudent(item.student, student))) {
          summary.skippedDuplicateStudents += 1
          manualFirstSkipped.push({ student, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex })
        }
      })
      if (slots[0] || slots[1]) return { ...templateDesk, lesson: { ...templateDesk.lesson, studentSlots: slots } }
      const emptied = buildFullySuppressedManagedDesk(templateDesk)
      return templateCell.scaffoldTeachersStripped ? stripTemplateScaffoldTeacherDesk(emptied) : emptied
    })
    const cellDiscarded: StudentEntry[] = []
    const desks = cell.desks.map((desk, deskIndex) => {
      const pendingKey = buildTemplatePendingDeskKey(cell.id, desk.id)
      const pending = cellPending[pendingKey]
      const outcome = applyRulesToDesk({
        cell, desk, deskIndex, templateDesk: templateDesks[deskIndex], pending,
        cellTemplateTeachers: templateCell.raw.desks, onDeletedTeacherDeskReassigned: () => { summary.deletedTeacherDeskReassigned += 1 },
        onDeletedTeacherDeskFilled: () => { summary.deletedTeacherDeskFilled += 1 }, onTombstoneCleared: () => { summary.tombstoneCleared += 1 },
        teacherBlockers: blockers.teachers, aliases, isTeacherOnRest,
        keepTemplateOriginTeacherWithManualStudents: Boolean(templateCell.scaffoldTeachersStripped),
        createdAt: params.createdAt, effectiveStartDate: params.effectiveStartDate, teacherNotes, discarded: cellDiscarded,
      })
      if (outcome.pending) {
        nextPendingDesks[pendingKey] = outcome.pending
        summary.pending += 1
        if (outcome.teacherPending) summary.manualTeacherPending += 1
      } else {
        delete nextPendingDesks[pendingKey]
      }
      if (!outcome.overflow && deskChanged(desk, outcome.desk)) summary.replaced += 1
      // 件数（確認の画面・保存後の 1 行）: 手入力が 1 行で残った机（テンプレの生徒が居なければ「そのまま残す」、居れば「空いた席に残して 1 行」）。
      if (!outcome.overflow && !outcome.pending) {
        const upperStudents = liveStudents(outcome.desk.lesson)
        const manualCount = upperStudents.filter((student) => resolveStudentOrigin(student) === 'manual').length + (outcome.desk.memoSlots ?? []).filter(hasMemoText).length
        if (manualCount > 0) {
          if (upperStudents.some((student) => resolveStudentOrigin(student) === 'template')) summary.seatMerged += 1
          else summary.kept += 1
        }
      }
      return alignTeacherIdentityWithRemerge(outcome.desk)
    })
    for (const student of cellDiscarded) {
      discardedTemplateStudents.push({ student, dateKey: cell.dateKey, cellId: cell.id })
      if (student.sameDayMoveSourceDate === cell.dateKey) summary.sameDayMoveCopiesReverted += 1
    }
    return { ...cell, isOpenDay: templateCell.applied.isOpenDay, desks }
  }

  const nextWeeks = params.weeks.map((week) => {
    const lastDateKey = week.reduce((max, cell) => (cell.dateKey > max ? cell.dateKey : max), '')
    if (lastDateKey < params.effectiveStartDate) return week
    return week.map((cell) => {
      // 禁忌: テンプレ反映日より前のコマ表は不変（INV-10・Q1）。
      if (cell.dateKey < params.effectiveStartDate) return cell
      const templateCell = templateById.get(cell.id) ?? templateByDateSlot.get(`${cell.dateKey}_${cell.slotNumber}`)
      if (!templateCell) return cell
      return applyCell(cell, templateCell)
    })
  })

  // 丸ごと振替の日の −1（旧 Q35-8・段 4 まで今のまま）。精算済みの判定は権威関数 resolveWholeDayTransferSettlement。
  const settledSet = resolveWholeDayTransferSettlement(wholeDayTransferSkipped, {
    weeks: params.weeks, pendingDesks: params.pendingDesks, templateCells: params.templateCells, suppressedRegularLessonOccurrences: params.suppressedRegularLessonOccurrences,
    originDatesByKey: params.wholeDayTransferSettlement.originDatesByKey, scheduleCountAdjustments: params.wholeDayTransferSettlement.scheduleCountAdjustments,
  })
  const skippedDates = [...new Set(wholeDayTransferSkipped.map((item) => item.dateKey))]
  const wholeDayTransferCountAdjustments = skippedDates.flatMap((dateKey) => resolveAdoptExistingCountAdjustments({
    withdrawnTemplateStudents: wholeDayTransferSkipped.filter((item) => item.dateKey === dateKey && !settledSet.has(item)).map((item) => item.student),
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
    wholeDayTransferSettled: wholeDayTransferSkipped.filter((item) => settledSet.has(item)),
    skippedDuplicates: manualFirstSkipped.map(({ student, dateKey, slotNumber }) => ({ student, dateKey, slotNumber })),
    duplicateDemotions: [],
    teacherNotes,
    sameDayMoveCopyReverts: [],
    sameDayMoveCopiesKeptByRecord: [],
    manualFirstSkipped,
    discardedTemplateStudents,
    /** §9-14: 下段だけの手入力の生徒をテンプレの席へ上げた行（確認の画面）。 */
    lowerPromotionNotes: studentNotes,
  }
}

/**
 * §9-14: 下段にしか居ない手入力の生徒 S を、テンプレが S を置く席（机・席）へ上げる（純関数・入力は変えない）。上げる席の上段に手入力の生徒・メモがある／
 * その席の下段に何かある／丸ごと振替の日／休日は上げない。上段の同じ席に居るテンプレ由来の生徒は、どのみち新テンプレで置き直すので上書きしてよい。
 */
export function promoteLowerOnlyManualStudents(cell: SlotCell, templateCell: Pick<TemplateDiffTemplateCell, 'applied' | 'scaffoldTeachersStripped'>, pendingDesks: TemplatePendingDeskMap): { cell: SlotCell; pendingDesks: TemplatePendingDeskMap; promotions: Array<{ student: StudentEntry; deskIndex: number; seat: number }> } {
  const promotions: Array<{ student: StudentEntry; deskIndex: number; seat: number }> = []
  if (!templateCell.applied.isOpenDay || templateCell.scaffoldTeachersStripped) return { cell, pendingDesks, promotions }
  let desks = cell.desks
  let pending = pendingDesks
  const upperManual = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => desks.some((desk) => liveStudents(desk.lesson).some((other) => isSameTemplateStudent(other, student) && resolveStudentOriginOnDate(other, cell.dateKey) === 'manual'))
  templateCell.applied.desks.forEach((templateDesk, deskIndex) => {
    if (deskIndex >= desks.length || !templateDesk.lesson || !isTemplateManagedLesson(templateDesk.lesson)) return
    templateDesk.lesson.studentSlots.forEach((templateStudent, seat) => {
      if (!templateStudent || upperManual(templateStudent)) return
      // 下段だけに居る手入力の S（どの机の下段でもよい）
      let found: { key: string; lowerSeat: number; student: StudentEntry } | null = null
      for (const desk of desks) {
        const key = buildTemplatePendingDeskKey(cell.id, desk.id)
        const lower = pending[key]?.lower
        ;(lower?.lesson?.studentSlots ?? []).forEach((student, lowerSeat) => {
          if (found || !student || !isSameTemplateStudent(student, templateStudent) || resolveStudentOriginOnDate(student, cell.dateKey) !== 'manual') return
          found = { key, lowerSeat, student }
        })
        if (found) break
      }
      if (!found) return
      const hit = found as { key: string; lowerSeat: number; student: StudentEntry }
      const target = desks[deskIndex]
      const occupant = target.lesson?.studentSlots[seat]
      const targetLower = pending[buildTemplatePendingDeskKey(cell.id, target.id)]?.lower
      if ((occupant && resolveStudentOriginOnDate(occupant, cell.dateKey) === 'manual') || hasMemoText(target.memoSlots?.[seat])) return
      if (buildTemplatePendingDeskKey(cell.id, target.id) !== hit.key && (targetLower?.lesson?.studentSlots[seat] || hasMemoText(targetLower?.memoSlots?.[seat]))) return
      // 下段から外す
      const entry = pending[hit.key]
      const lowerSlots = [...entry.lower.lesson!.studentSlots] as StudentPair
      lowerSlots[hit.lowerSeat] = null
      const nextLower: TemplatePendingLower = { ...entry.lower }
      if (lowerSlots[0] || lowerSlots[1]) nextLower.lesson = { ...entry.lower.lesson!, studentSlots: lowerSlots }
      else delete nextLower.lesson
      pending = { ...pending, [hit.key]: { ...entry, lower: nextLower } }
      // テンプレの席へ上げる
      const upperSlots = [target.lesson?.studentSlots[0] ?? null, target.lesson?.studentSlots[1] ?? null] as StudentPair
      upperSlots[seat] = { ...hit.student }
      desks = desks.map((desk, index) => (index !== deskIndex ? desk : { ...desk, lesson: { ...(desk.lesson ?? { id: `${desk.id}_manual` }), studentSlots: upperSlots } }))
      promotions.push({ student: hit.student, deskIndex, seat })
    })
  })
  return promotions.length > 0 ? { cell: { ...cell, desks }, pendingDesks: pending, promotions } : { cell, pendingDesks, promotions }
}

function deskChanged(before: DeskCell, after: DeskCell) {
  if (before.teacher !== after.teacher) return true
  const left = liveStudents(before.lesson)
  const right = liveStudents(after.lesson)
  if (left.length !== right.length) return true
  return left.some((student, index) => student.id !== right[index]?.id || student.subject !== right[index]?.subject)
}
