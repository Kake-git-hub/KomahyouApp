// §9-22 案 A（オーナー決定 2026-11-06・確認リスト v2-1・docs/spec-template-conflict-v2.md）: コマ表の並び替え（上に詰めて／同席番）は
// 表示中の週だけ、テンプレ由来の机も手入力の机も動かす（固定は保留〔2 行〕の机だけ・旧 Q31）。再マージは授業 ID で突き合わせるので
// 並び替えた形は読み込みでも残る。差分反映（computeTemplateDiffApply）は**机番号**でテンプレと突き合わせるので、並び替えた週のまま保存すると
// テンプレを変えていなくても 2 行・講師の入れ替わり・手入力の分散が起きる（regression-reviewer 2026-11-05 の再現）。
// そこで次のテンプレ保存の直前に、並び替えた週の机を「テンプレの並び」へ戻してから突き合わせる（このファイルの restoreTemplateDeskOrder）。
//
// ★戻すのは机の**位置だけ**（中身＝生徒・メモ・出欠記録・講師・印は変えない・机の数も変えない）。机 ID は位置で振り直す（deskSort と同じ規則）。
// ★並び替えていないコマ（テンプレ由来の机が全部テンプレの番号にある）は参照ごと不変（INV-10・不動点）。手入力だけの机もそのとき動かさない。
// ★対応付けの基準（templateDesks）は「盤面の元になったテンプレ」（保存前の行で作った管理セルの机・抑止前）。保存で新しくなる行で引くと、
//   テンプレで机の講師を替えた保存が「並び替え」に見えて机が動く（席の規則 §2-1 の机番号の意味が変わる）。

import type { DeskCell, DeskLesson, SlotCell, StudentEntry } from './types'
import { resolveDeskTeacherOrigin } from './placementOrigin'
import { resolveStudentOriginOnDate } from './templateConflictRules'
import { isSameTeacherByAliases, isSameTemplateStudent, isTemplateDiffTeacherTombstone, isTemplateManagedLesson, type TeacherAliasResolver } from './templateDiffApply'
import { doesTeacherRestMatch } from './teacherRest'

type TemplateDeskRef = Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId' | 'lesson'>

const defaultAliases: TeacherAliasResolver = (key) => [key]

function liveStudents(lesson?: Pick<DeskLesson, 'studentSlots'>): StudentEntry[] {
  const slots: ReadonlyArray<StudentEntry | null> = lesson?.studentSlots ?? []
  return slots.filter((student): student is StudentEntry => Boolean(student))
}

function hasTemplateDeskContent(desk: Pick<DeskCell, 'teacher' | 'lesson'> | undefined) {
  return Boolean(desk && (desk.teacher.trim() || liveStudents(desk.lesson).length > 0))
}

function isEmptyBoardDesk(desk: DeskCell) {
  return !desk.teacher.trim()
    && liveStudents(desk.lesson).length === 0
    && !(desk.memoSlots ?? []).some((memo) => typeof memo === 'string' && memo.trim() !== '')
    && !(desk.statusSlots ?? []).some(Boolean)
    && !desk.teacherRest
    && !desk.manualTeacher
    && !desk.teacherAssignmentSource
}

/** 盤面の机が戻る先の候補（テンプレの机番号・0 始まり）を優先順で返す。空＝テンプレ由来の手がかりが無い（手入力の机と同じ扱い）。 */
function resolveAnchorCandidates(desk: DeskCell, deskIndex: number, dateKey: string, templateDesks: readonly TemplateDeskRef[], aliases: TeacherAliasResolver): number[] {
  const indexes = templateDesks.map((_, index) => index)
  // 今の番号が当てはまるならそれを最優先（並び替えていない机を動かさない）
  const ordered = (match: (templateDesk: TemplateDeskRef) => boolean) => {
    const hits = indexes.filter((index) => match(templateDesks[index]))
    return hits.includes(deskIndex) ? [deskIndex, ...hits.filter((index) => index !== deskIndex)] : hits
  }
  const students = liveStudents(desk.lesson)
  const templateStudents = students.filter((student) => resolveStudentOriginOnDate(student, dateKey) === 'template')
  if (desk.lesson && isTemplateManagedLesson(desk.lesson)) {
    // 1. 管理授業（テンプレの授業）は授業 ID が同じテンプレの机へ
    const lessonId = desk.lesson.id
    const byId = ordered((templateDesk) => templateDesk.lesson?.id === lessonId)
    if (byId.length > 0) return byId
    // 2. ID が一致しない（行が消えた・作り直した）テンプレの授業は、同じ生徒を持つテンプレの机へ
    if (templateStudents.length > 0) {
      const byStudent = ordered((templateDesk) => liveStudents(templateDesk.lesson).some((candidate) => templateStudents.some((own) => isSameTemplateStudent(own, candidate))))
      if (byStudent.length > 0) return byStudent
    }
  }
  if (templateStudents.length > 0) return []
  // 3. テンプレの講師（足場講師・手入力の生徒が乗った机を含む）は、同じ講師（呼び名の対応表）のテンプレの机へ。講師だけのテンプレの机を先に。
  if (resolveDeskTeacherOrigin(desk) === 'template') {
    const sameTeacher = (templateDesk: TemplateDeskRef) => isSameTeacherByAliases(templateDesk.teacher, desk.teacher, aliases)
    const teacherOnly = ordered((templateDesk) => sameTeacher(templateDesk) && liveStudents(templateDesk.lesson).length === 0)
    const withStudents = ordered((templateDesk) => sameTeacher(templateDesk) && liveStudents(templateDesk.lesson).length > 0)
    if (teacherOnly.includes(deskIndex) || withStudents.includes(deskIndex)) return [deskIndex, ...[...teacherOnly, ...withStudents].filter((index) => index !== deskIndex)]
    return [...teacherOnly, ...withStudents]
  }
  // 4. 講師の削除記録（消した講師が分かるもの）は、その講師のテンプレの机へ（記録がその机の講師を塞ぎ続ける）
  if (isTemplateDiffTeacherTombstone(desk) && !desk.teacherAssignmentSessionId && desk.teacherAssignmentTeacherId?.trim()) {
    const deleted = desk.teacherAssignmentTeacherId.trim()
    return ordered((templateDesk) => Boolean(templateDesk.teacher.trim()) && (isSameTeacherByAliases(templateDesk.teacher, deleted, aliases) || Boolean(templateDesk.teacherAssignmentTeacherId && isSameTeacherByAliases(templateDesk.teacherAssignmentTeacherId, deleted, aliases))))
  }
  // 5. 講師の休み（§2-4）の机は、休んだ講師のテンプレの机へ
  if (desk.teacherRest && !desk.teacher.trim()) {
    const rest = desk.teacherRest
    return ordered((templateDesk) => Boolean(templateDesk.teacher.trim()) && doesTeacherRestMatch(rest, templateDesk, aliases))
  }
  return []
}

export type RestoreTemplateDeskOrderOptions = {
  /** 位置・机 ID・中身を固定する机（そのコマの保留〔2 行〕の机・保留マップのキーは机 ID）。 */
  lockedDeskIds?: ReadonlySet<string>
  /** 手入力だけの机を寄せる「テンプレが使わない番号」を決めるテンプレの机（反映するテンプレ・抑止後）。省略時は templateDesks。 */
  usedDesks?: ReadonlyArray<Pick<DeskCell, 'teacher' | 'lesson'>>
  aliases?: TeacherAliasResolver
}

/**
 * 並び替えた 1 コマの机を「テンプレの並び」へ戻す（純関数・入力は変えない）。templateDesks は盤面の元になったテンプレの机（抑止前）。
 * テンプレ由来の机（管理授業・テンプレの生徒・足場講師・その講師の削除記録／休み）をテンプレの机番号へ、手入力だけの机（メモだけ・出欠記録だけを含む）は
 * 今の番号がテンプレで使われていなければそのまま、使われていればテンプレが使わない番号の一番若いものへ（無ければ残った番号＝§2-1 で 2 行）。
 * 保留の机は動かさない。並び替えていないコマは参照ごと同じものを返す。
 */
export function restoreTemplateDeskOrder(cell: SlotCell, templateDesks: readonly TemplateDeskRef[], options: RestoreTemplateDeskOrderOptions = {}): SlotCell {
  const aliases = options.aliases ?? defaultAliases
  const usedDesks = options.usedDesks ?? templateDesks
  const size = cell.desks.length
  const lockedIndexes = new Set<number>()
  cell.desks.forEach((desk, index) => { if (options.lockedDeskIds?.has(desk.id)) lockedIndexes.add(index) })

  const candidatesByDesk = cell.desks.map((desk, index) => (lockedIndexes.has(index)
    ? []
    : resolveAnchorCandidates(desk, index, cell.dateKey, templateDesks, aliases).filter((target) => target < size && !lockedIndexes.has(target))))
  const targetByDesk = new Map<number, number>()
  const claimed = new Set<number>()
  // 今の番号に居る机が先にその番号を取る（並び替えていない机を押し出さない）
  candidatesByDesk.forEach((candidates, index) => {
    if (candidates[0] === index && !claimed.has(index)) { targetByDesk.set(index, index); claimed.add(index) }
  })
  candidatesByDesk.forEach((candidates, index) => {
    if (targetByDesk.has(index)) return
    const target = candidates.find((candidate) => !claimed.has(candidate))
    if (target === undefined) return
    targetByDesk.set(index, target)
    claimed.add(target)
  })
  // テンプレ由来の机が全部テンプレの番号にある＝並び替えていない → 何も動かさない（手入力だけの机も今のまま）
  if (![...targetByDesk].some(([index, target]) => index !== target)) return cell

  const assigned = new Map<number, number>(targetByDesk)
  const taken = new Set<number>([...lockedIndexes, ...claimed])
  const isFree = (index: number) => !taken.has(index)
  const isUnused = (index: number) => !hasTemplateDeskContent(usedDesks[index])
  const take = (deskIndex: number, target: number) => { assigned.set(deskIndex, target); taken.add(target) }
  const rest = cell.desks.map((_, index) => index).filter((index) => !lockedIndexes.has(index) && !assigned.has(index))
  const manualDesks = rest.filter((index) => !isEmptyBoardDesk(cell.desks[index]))
  const emptyDesks = rest.filter((index) => isEmptyBoardDesk(cell.desks[index]))
  const positions = cell.desks.map((_, index) => index)
  // 手入力だけの机: 今の番号が空いていてテンプレが使わない → そのまま
  for (const index of manualDesks) if (isFree(index) && isUnused(index)) take(index, index)
  // それ以外は、テンプレが使わない番号の一番若いもの → 無ければ今の番号（空いていれば）→ 残った番号の一番若いもの
  for (const index of manualDesks) {
    if (assigned.has(index)) continue
    const target = positions.find((position) => isFree(position) && isUnused(position)) ?? (isFree(index) ? index : positions.find(isFree))
    if (target !== undefined) take(index, target)
  }
  for (const index of emptyDesks) {
    const target = isFree(index) ? index : positions.find(isFree)
    if (target !== undefined) take(index, target)
  }

  const placed: DeskCell[] = new Array(size)
  lockedIndexes.forEach((index) => { placed[index] = cell.desks[index] })
  assigned.forEach((target, index) => { placed[target] = cell.desks[index] })
  if (placed.some((desk) => !desk) || placed.length !== size) return cell
  // 机 ID は位置どおりに振り直す（保留の机は元の ID のまま・deskSort の assignSortedDeskIds と同じ規則。固定した机の ID と衝突するなら元の ID のまま）
  const lockedIds = new Set([...lockedIndexes].map((index) => cell.desks[index].id))
  const collides = placed.some((_desk, index) => !lockedIndexes.has(index) && lockedIds.has(`${cell.id}_desk_${index + 1}`))
  const desks = placed.map((desk, index) => {
    if (lockedIndexes.has(index) || collides) return desk
    const id = `${cell.id}_desk_${index + 1}`
    return desk.id === id ? desk : { ...desk, id }
  })
  if (desks.every((desk, index) => desk === cell.desks[index])) return cell
  return { ...cell, desks }
}
