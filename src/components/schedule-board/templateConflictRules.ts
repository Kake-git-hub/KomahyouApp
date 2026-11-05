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
  resolveAdoptExistingCountAdjustments,
  resolveWholeDayTransferSettlement,
  stripTemplateScaffoldTeacherDesk,
  type ComputeTemplateDiffApplyParams,
  type ComputeTemplateDiffApplyResult,
  type TeacherAliasResolver,
  type TemplateDiffApplySummary,
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
export function collectTemplateBlockersInCell(cell: Pick<SlotCell, 'id' | 'desks'>, pendingDesks?: TemplatePendingDeskMap | null): { students: TemplateStudentBlocker[]; teachers: TemplateTeacherBlocker[] } {
  const students: TemplateStudentBlocker[] = []
  const teachers: TemplateTeacherBlocker[] = []
  cell.desks.forEach((desk, deskIndex) => {
    const pending = pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]
    for (const entry of [...(desk.statusSlots ?? []), ...(pending?.lower.statusSlots ?? [])]) {
      if (entry && isTemplateBlockingRecordStatus(entry.status)) students.push({ student: entry, reason: 'record' })
    }
    for (const student of [...liveStudents(desk.lesson), ...liveStudents(pending?.lower.lesson)]) {
      if (isManualOriginStudent(student)) students.push({ student, reason: 'manual' })
    }
    if (pending?.lower.teacher?.teacher.trim()) teachers.push({ deskIndex, teacher: pending.lower.teacher })
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
 * 講師の休み（§2-4・段 3 で足す）の差し込み口。段 2 では常に「休みでない」。段 3 は盤面の休みの記録（日付×時限×講師 ID）をここで引く。
 * 差分反映と再マージの両方がこの関数を通す（片方だけ休みを見ると不動点が崩れる）。
 */
export type TemplateTeacherRestPredicate = (cell: Pick<SlotCell, 'dateKey' | 'slotNumber'>, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>) => boolean
export const noTemplateTeacherRest: TemplateTeacherRestPredicate = () => false

/**
 * 再マージ（機能フラグ templateDiffApply の教室）が管理セル（抑止・丸ごと振替の strip を当てた後）へ当てる、§2-2・§2-3・§2-4 の取り除き。
 * 差分反映が同じコマで置かなかったテンプレの生徒・講師を、保存直後・読み込み時の再マージでも置かない（不動点）。抑止キーを積まずに
 * 「盤面の今の状態から毎回同じ結果」を出すための唯一の経路（§6 抑止キー）。
 * 生徒は全員取り除かれた机を抑止と同じ形（buildFullySuppressedManagedDesk）にする。
 */
export function applyTemplateOriginRulesToManagedCell(managedCell: SlotCell, boardCell: Pick<SlotCell, 'id' | 'desks'>, pendingDesks: TemplatePendingDeskMap | null | undefined, aliases: TeacherAliasResolver = defaultTeacherAliases, isTeacherOnRest: TemplateTeacherRestPredicate = noTemplateTeacherRest, sameDayMoveSources: readonly SameDayMoveSource[] = []): SlotCell {
  const blockers = collectTemplateBlockersInCell(boardCell, pendingDesks)
  // §1-1 #2: 同じ日の中で手で動かしたテンプレの授業（写し）の元の時限には、次のテンプレ反映までテンプレの同じ授業を置き直さない（移動の抑止キーの代わり）。
  const movedAway = sameDayMoveSources.filter((source) => source.slotNumber === managedCell.slotNumber)
  if (blockers.students.length === 0 && blockers.teachers.length === 0 && movedAway.length === 0) return managedCell
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
    if (next.teacher.trim() && (findManualTeacherDeskElsewhere(deskIndex, next, blockers.teachers, aliases) >= 0 || isTeacherOnRest(managedCell, next))) {
      changed = true
      next = { ...next, teacher: '', teacherAssignmentTeacherId: undefined }
    }
    return next
  })
  return changed ? { ...managedCell, desks } : managedCell
}

/** 同じ日の中で手で動かしたテンプレの授業（写し）の、元の時限（sameDayMoveSourceLabel の時限）。 */
export type SameDayMoveSource = { student: Pick<StudentEntry, 'managedStudentId' | 'name'>; subject: string; slotNumber: number }

/**
 * 日付 → その日の写しの元の時限（上段・保留の下段）。出自＝テンプレで sameDayMoveSourceDate がその日の通常授業だけ。元の時限が読めない旧データは入れない
 * （その授業は移動の抑止キーで守られている＝キーは外さない側に倒す・collectSameDayMovedTemplateOccurrenceKeys と対）。
 */
export function collectSameDayMoveSourcesByDate(weeks: SlotCell[][], pendingDesks?: TemplatePendingDeskMap | null): Map<string, SameDayMoveSource[]> {
  const byDate = new Map<string, SameDayMoveSource[]>()
  const consider = (student: StudentEntry | null | undefined, dateKey: string) => {
    if (!student || student.lessonType !== 'regular' || student.sameDayMoveSourceDate !== dateKey || resolveStudentOrigin(student) !== 'template') return
    const slotNumber = parseOriginSlotNumberFromLabel(student.sameDayMoveSourceLabel)
    if (!slotNumber) return
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), { student, subject: student.subject, slotNumber }])
  }
  for (const week of weeks) for (const cell of week) for (const desk of cell.desks) {
    for (const student of desk.lesson?.studentSlots ?? []) consider(student, cell.dateKey)
    for (const student of pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower.lesson?.studentSlots ?? []) consider(student, cell.dateKey)
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
  expected: ReadonlyArray<{ studentId: string; subject: string; dateKey: string; slotNumber: number }>
  suppressedRegularLessonOccurrences?: readonly string[]
}): Array<{ studentId: string; subject: string; dateKey: string; slotNumber: number }> {
  const suppressed = new Set(params.suppressedRegularLessonOccurrences ?? [])
  const cellByDateSlot = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) cellByDateSlot.set(`${cell.dateKey}_${cell.slotNumber}`, cell)
  return params.expected.filter((item) => {
    if (suppressed.has(`${item.studentId}__${item.subject}__${item.dateKey}__${item.slotNumber}`)) return false
    const cell = cellByDateSlot.get(`${item.dateKey}_${item.slotNumber}`)
    if (!cell || !cell.isOpenDay) return false
    const same = (student: StudentEntry) => (student.managedStudentId ?? student.name) === item.studentId
    const live = cell.desks.flatMap((desk) => [...liveStudents(desk.lesson), ...liveStudents(params.pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower.lesson)]).filter(same)
    return live.some((student) => resolveStudentOrigin(student) === 'manual') && !live.some((student) => resolveStudentOrigin(student) === 'template')
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 差分反映（席の規則 §2-1 まで）
// ─────────────────────────────────────────────────────────────────────────────

/** §2-2 で置かなかったテンプレの生徒（確認の画面に名前つき・§4-2 規則 1 の −1 の候補）。 */
export type TemplateManualFirstSkip = { student: StudentEntry; dateKey: string; slotNumber: number; deskIndex: number }

/** 席に入る手入力の 1 件（生徒かメモ）。 */
type ManualSeatItem = { kind: 'student'; student: StudentEntry; seat: number } | { kind: 'memo'; memo: string; seat: number }

const TEACHER_FIELD_KEYS = ['teacher', 'manualTeacher', 'teacherAssignmentSource', 'teacherAssignmentSessionId', 'teacherAssignmentTeacherId'] as const

function pickTeacher(desk: TemplatePendingLowerTeacher): TemplatePendingLowerTeacher {
  return {
    teacher: desk.teacher,
    manualTeacher: desk.manualTeacher,
    teacherAssignmentSource: desk.teacherAssignmentSource,
    teacherAssignmentSessionId: desk.teacherAssignmentSessionId,
    teacherAssignmentTeacherId: desk.teacherAssignmentTeacherId,
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
function collectManualSeatItems(desk: DeskCell, pending: TemplatePendingDesk | undefined): { items: ManualSeatItem[]; discardedTemplateStudents: StudentEntry[] } {
  const items: ManualSeatItem[] = []
  const discardedTemplateStudents: StudentEntry[] = []
  const take = (lesson: DeskLesson | undefined, memos: MemoPair | undefined) => {
    ;(lesson?.studentSlots ?? []).forEach((student, seat) => {
      if (!student) return
      if (resolveStudentOrigin(student) === 'manual') items.push({ kind: 'student', student: { ...student }, seat })
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
  const { items, discardedTemplateStudents } = collectManualSeatItems(desk, pending)
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
  const templateTeacher = templateDesk.teacher.trim() && !params.isTeacherOnRest(cell, templateDesk) ? templateDesk : null
  const claimedAt = templateTeacher ? findManualTeacherDeskElsewhere(deskIndex, templateTeacher, params.teacherBlockers, params.aliases) : -1
  const placeableTemplateTeacher = templateTeacher && claimedAt < 0 ? templateTeacher : null
  if (templateTeacher && claimedAt >= 0) {
    params.teacherNotes.push({ kind: 'teacher-elsewhere', teacherName: templateTeacher.teacher, templateTeacher: String(claimedAt + 1), dateKey: cell.dateKey, slotNumber: cell.slotNumber })
  }
  const manualTeacher: TemplatePendingLowerTeacher | null = pending?.lower.teacher?.teacher.trim()
    ? pending.lower.teacher
    : isManualOriginDeskTeacher(desk) ? pickTeacher(desk) : null
  let upperTeacher: TemplatePendingLowerTeacher
  let lowerTeacher: TemplatePendingLowerTeacher | null = null
  const hasUpperStudents = Boolean(upperSlots[0] || upperSlots[1])
  if (manualTeacher) {
    if (!placeableTemplateTeacher || isSameTeacherByAliases(placeableTemplateTeacher.teacher, manualTeacher.teacher, params.aliases)) upperTeacher = pickTeacher(manualTeacher)
    else {
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
export function computeTemplateDiffApply(params: ComputeTemplateDiffApplyParams & { isTeacherOnRest?: TemplateTeacherRestPredicate; scheduleCountAdjustments?: readonly ScheduleCountAdjustmentEntry[] }): ComputeTemplateDiffApplyResult & { manualFirstSkipped: TemplateManualFirstSkip[]; discardedTemplateStudents: Array<{ student: StudentEntry; dateKey: string; cellId: string }> } {
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
  const templateById = new Map(params.templateCells.map((entry) => [entry.applied.id, entry]))
  const templateByDateSlot = new Map(params.templateCells.map((entry) => [`${entry.applied.dateKey}_${entry.applied.slotNumber}`, entry]))

  const applyCell = (cell: SlotCell, templateCell: TemplateDiffTemplateCell): SlotCell => {
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
    const blockers = collectTemplateBlockersInCell(cell, params.pendingDesks)
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
        const reason = resolveTemplateStudentBlock(student, blockers.students)
        if (!reason) return
        slots[seat] = null
        if (reason === 'manual') {
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
      const pending = params.pendingDesks[pendingKey]
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
  }
}

function deskChanged(before: DeskCell, after: DeskCell) {
  if (before.teacher !== after.teacher) return true
  const left = liveStudents(before.lesson)
  const right = liveStudents(after.lesson)
  if (left.length !== right.length) return true
  return left.some((student, index) => student.id !== right[index]?.id || student.subject !== right[index]?.subject)
}
