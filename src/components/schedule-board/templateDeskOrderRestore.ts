// §9-22 案 A（オーナー決定 2026-11-06・確認リスト v2-1・docs/spec-template-conflict-v2.md）: コマ表の並び替え（上に詰めて／同席番）は
// 表示中の週だけ、テンプレ由来の机も手入力の机も動かす（固定は保留〔2 行〕の机だけ・旧 Q31）。再マージは授業 ID で突き合わせるので
// 並び替えた形は読み込みでも残る。差分反映（computeTemplateDiffApply）は**机番号**でテンプレと突き合わせるので、並び替えた週のまま保存すると
// テンプレを変えていなくても 2 行・講師の入れ替わり・手入力の分散が起きる（regression-reviewer 2026-11-05 の再現）。
// そこで次のテンプレ保存の直前に、並び替えた週の机を「テンプレの並び」へ戻してから突き合わせる（このファイルの restoreTemplateDeskOrder）。
//
// ★戻すのは机の**位置だけ**（中身＝生徒・メモ・出欠記録・講師・印は変えない・机の数も変えない）。机 ID は位置で振り直す（deskSort と同じ規則）。
// ★並び替えていないコマ（テンプレ由来の机が全部テンプレの番号にある）は参照ごと不変（INV-10・不動点）。手入力だけの机もそのとき動かさない。
// ★基準の使い分け（2026-11-10 オーナー決定「手入力は講師について行く」で改定）: 講師の位置の基準は**新しいテンプレ**（usedDesks・反映するテンプレの机・抑止後）に替えた。
//   保存前のテンプレ（templateDesks＝盤面の元になったテンプレの管理セルの机・抑止前）は、(1) 机の講師を決める材料（手置き講師の机のテンプレの授業が乗っていた机の講師）と、
//   (2) 講師の手がかりの無い机の戻し先（授業 ID → 同じ生徒）にだけ使う。
//   改定前（v1.5.715 まで）は「保存前のテンプレの並び」へ戻していた。その理由は、保存で新しくなる行で並びを引くと、テンプレで机の講師を替えた保存が
//   「並び替え」に見えて机が動き、席の規則 §2-1 の机番号の意味が変わるから、だった。ところが新しいテンプレで講師の机番号が変わると、保存前の並びへ戻してから
//   机番号で突き合わせる形では手入力の生徒・メモ・出欠記録が元の机番号（＝新しいテンプレでは別の講師の机）に取り残され、2 行（緑）や別の講師の担当になっていた
//   （緑が丘の報告・本番 2 月版の保存で手入力の生徒 100 人中 24 人・INV-02）。オーナーは「机番号の意味が変わる（手入力が講師について行く）」方を選んだ（spec §2-1）。
//   - 机の「講師」（resolveDeskTeacherClue）: 足場講師（テンプレ由来）はその名前。手置き講師・入れ替えた講師の机は、机のテンプレの授業（授業 ID）が
//     保存前のテンプレで乗っていた机の講師 → 下段の講師を採用した記録 templateTeacherDeclined の講師（採用した講師が今の机の講師のときだけ）→
//     講師名を固定しただけの机（manualTeacher の印だけ）はその講師自身（新しいテンプレのそのコマにいるときだけ）。講師の削除記録・講師の休みの机は、消した／休んだ講師。
//   - その講師が新しいテンプレのそのコマにいる → 机ごと（中身はそのまま）その机番号へ。いない → 手入力があれば、テンプレが使う最後の机より下の空き机の
//     一番若いもの → 無ければテンプレが使わない机の一番若いもの → どちらも無ければ残った机（別の講師の机になりうるので確認画面に出す）。
//     テンプレの講師は付かない（差分反映がテンプレ由来の講師を外す）。手置きの講師は机と一緒に移る。
//   - 講師の手がかりが無い机（講師なしのテンプレの授業・埋め草「講師未割当」など）は従来どおり保存前のテンプレの机番号（授業 ID）で戻す。
//   テンプレを変えずに保存したときは「新しいテンプレの講師の位置」＝「保存前のテンプレの講師の位置」なので v1.5.715 と同じ結果になる。

import type { DeskCell, DeskLesson, SlotCell, StudentEntry } from './types'
import { resolveDeskTeacherOrigin } from './placementOrigin'
import { resolveStudentOriginOnDate } from './templateConflictRules'
import { isSameTeacherByAliases, isSameTeacherRecord, isSameTemplateStudent, isTemplateDiffTeacherTombstone, isTemplateManagedLesson, type TeacherAliasResolver } from './templateDiffApply'
import { doesTeacherRestMatch, type DeskTeacherRest } from './teacherRest'
import { hasRealDeskTeacher } from '../../utils/deskTeacherLabel'

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

// 講師の削除記録・講師の休みの机の「講師」とテンプレの机の照合（resolveAnchorCandidates の 4・5 段と resolveDeskTeacherClue が共有する・片方だけ直して食い違わないように）。
/** 講師の削除記録（消した講師が分かるもの・講習 ID つきは除く）の、消した講師（記録の講師 ID）。該当しなければ null。 */
function resolveDeskDeletedTeacher(desk: DeskCell): string | null {
  if (!isTemplateDiffTeacherTombstone(desk) || desk.teacherAssignmentSessionId) return null
  return desk.teacherAssignmentTeacherId?.trim() || null
}
/** テンプレの机が、消した講師の机か（講師名か講師 ID を呼び名の対応表で）。 */
function isDeletedTeacherTemplateDesk(deleted: string, templateDesk: TemplateDeskRef, aliases: TeacherAliasResolver) {
  return Boolean(templateDesk.teacher.trim()) && (isSameTeacherByAliases(templateDesk.teacher, deleted, aliases) || Boolean(templateDesk.teacherAssignmentTeacherId && isSameTeacherByAliases(templateDesk.teacherAssignmentTeacherId, deleted, aliases)))
}
/** 講師の休み（§2-4）の机（講師欄が空で休みの記録がある）の、休みの記録。該当しなければ null。 */
function resolveDeskRestRecord(desk: DeskCell): DeskTeacherRest | null {
  return desk.teacherRest && !desk.teacher.trim() ? desk.teacherRest : null
}
/** テンプレの机が、休んだ講師の机か。 */
function isRestTeacherTemplateDesk(rest: DeskTeacherRest, templateDesk: TemplateDeskRef, aliases: TeacherAliasResolver) {
  return Boolean(templateDesk.teacher.trim()) && doesTeacherRestMatch(rest, templateDesk, aliases)
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
  const deleted = resolveDeskDeletedTeacher(desk)
  if (deleted) return ordered((templateDesk) => isDeletedTeacherTemplateDesk(deleted, templateDesk, aliases))
  // 5. 講師の休み（§2-4）の机は、休んだ講師のテンプレの机へ
  const rest = resolveDeskRestRecord(desk)
  if (rest) return ordered((templateDesk) => isRestTeacherTemplateDesk(rest, templateDesk, aliases))
  return []
}

/**
 * 2026-11-10（「手入力は講師について行く」）: 机の「講師」の手がかり。label は確認画面に出す講師の名前、matches は新しいテンプレの机がその講師の机か。
 * null＝講師の手がかりが無い（従来どおり保存前のテンプレの机番号で戻す）。derived＝机の今の講師ではなく、手置き講師の机の手がかり
 * （テンプレの授業・採用の記録・固定した講師名）。足場講師の机より後に番号を取る。
 * onlyIfPresent＝その講師が新しいテンプレのそのコマにいなければ手がかりに使わない（講師名を固定しただけの机・regression-reviewer M-3）。
 */
type DeskTeacherClue = { label: string; matches: (templateDesk: TemplateDeskRef) => boolean; derived: boolean; onlyIfPresent?: boolean }

function resolveDeskTeacherClue(desk: DeskCell, templateDesks: readonly TemplateDeskRef[], aliases: TeacherAliasResolver): DeskTeacherClue | null {
  const byName = (name: string, derived: boolean, onlyIfPresent = false): DeskTeacherClue => ({
    label: name, derived, onlyIfPresent, matches: (templateDesk) => hasRealDeskTeacher(templateDesk.teacher) && isSameTeacherByAliases(templateDesk.teacher, name, aliases),
  })
  const origin = resolveDeskTeacherOrigin(desk)
  // 足場講師（テンプレ由来・埋め草でない本物の講師）はその名前
  if (origin === 'template' && hasRealDeskTeacher(desk.teacher)) return byName(desk.teacher.trim(), false)
  if (origin === 'manual') {
    // 手置き講師・入れ替えた講師の机は、机のテンプレの授業が保存前のテンプレで乗っていた机の講師（授業の手がかりがあれば §9-15 どおり授業の講師について行く）
    if (desk.lesson && isTemplateManagedLesson(desk.lesson)) {
      const lessonId = desk.lesson.id
      const anchor = templateDesks.find((templateDesk) => templateDesk.lesson?.id === lessonId && hasRealDeskTeacher(templateDesk.teacher))
      if (anchor) return byName(anchor.teacher.trim(), true)
    }
    // 下段（手入力）の講師を採用したときに取り下げたテンプレの講師（この机はその講師の机だった）。採用した講師が今の机の講師のときだけ
    // （isTemplateTeacherDeclinedAtDesk の S-1 と同じ条件＝あとで別の講師へ替えた机では古い記録を使わない）。
    const declined = desk.templateTeacherDeclined
    if (declined?.adopted && hasRealDeskTeacher(declined.teacher) && isSameTeacherRecord(declined.adopted, desk, aliases)) {
      return { label: declined.teacher.trim(), derived: true, matches: (templateDesk) => hasRealDeskTeacher(templateDesk.teacher) && isSameTeacherRecord(declined, templateDesk, aliases) }
    }
    // 講師名を固定しただけの机（盤面の操作で名前に manualTeacher の印だけが付いた机＝生徒を動かして空いた机・丸ごと振替で移した机。授業の手がかりも採用の記録も無い）は、
    // その講師が新しいテンプレのそのコマにいればその講師の机へ（同じ講師なのでぶつからない・regression-reviewer M-3）。
    // ★手で置いた講師（teacherAssignmentSource が manual／manual-replaced／schedule-registration）は対象外: テンプレがその講師を別の机に置いても手置きの机が勝つ
    //   （§2-3・§9-15・決定記録 66・確認リスト tp-59／v2-3 で確認済み）。ついて行かせるとその形が崩れる。
    if (!desk.teacherAssignmentSource && hasRealDeskTeacher(desk.teacher)) return byName(desk.teacher.trim(), true, true)
    return null
  }
  // 講師の削除記録（消した講師が分かるもの）は消した講師（記録がその講師を塞ぐので講師の新しい机へ付いて行く）
  const deleted = resolveDeskDeletedTeacher(desk)
  if (deleted) {
    // 確認画面に出す名前は呼び名の対応表の最後（表示名）。名簿に居なければ記録のまま。
    const names = aliases(deleted)
    return { label: names[names.length - 1]?.trim() || deleted, derived: false, matches: (templateDesk) => isDeletedTeacherTemplateDesk(deleted, templateDesk, aliases) }
  }
  // 講師の休み（§2-4）の机は休んだ講師
  const rest = resolveDeskRestRecord(desk)
  if (rest) return { label: rest.teacher.trim() || rest.teacherId?.trim() || '', derived: false, matches: (templateDesk) => isRestTeacherTemplateDesk(rest, templateDesk, aliases) }
  return null
}

/** 机に手入力（手入力の生徒・メモ・出欠記録・手置きの講師）があるか（講師が新しいテンプレにいない机を下の空き机へ移すかの判定）。 */
function hasManualDeskContent(desk: DeskCell, dateKey: string) {
  return liveStudents(desk.lesson).some((student) => resolveStudentOriginOnDate(student, dateKey) !== 'template')
    || (desk.memoSlots ?? []).some((memo) => typeof memo === 'string' && memo.trim() !== '')
    || (desk.statusSlots ?? []).some(Boolean)
    || resolveDeskTeacherOrigin(desk) === 'manual'
}

/**
 * 講師が新しいテンプレのそのコマにいない机の手入力の行き先（確認画面に名前つきで出す）。
 * moved＝テンプレが使わない机へ移した。no-desk＝テンプレが使わない机に空きが無く、残った机（テンプレが使う机＝別の講師の机になりうる）へ入った（今の番号に残る形を含む）。
 */
export type TemplateDeskTeacherLeftMove = {
  kind: 'moved' | 'no-desk'
  cellId: string
  dateKey: string
  slotNumber: number
  /** 移す前・入った先の机の番号（0 始まり）。 */
  fromDeskIndex: number
  toDeskIndex: number
  /** 机の講師（新しいテンプレのそのコマにいない講師）。 */
  formerTeacherName: string
  /** 机と一緒に移る手置きの講師（無ければ undefined＝講師なしの机になる）。 */
  movedTeacherName?: string
  /** no-desk: 入った先の机の新しいテンプレの講師（無ければ undefined）。 */
  deskTeacherName?: string
  /** 机の手入力の生徒（テンプレ由来の生徒は新しいテンプレの位置に置き直されるので含めない）。 */
  manualStudents: StudentEntry[]
}

export type RestoreTemplateDeskOrderOptions = {
  /** 位置・机 ID・中身を固定する机（そのコマの保留〔2 行〕の机・保留マップのキーは机 ID）。 */
  lockedDeskIds?: ReadonlySet<string>
  /**
   * 反映するテンプレの机（抑止後）。省略時は templateDesks。講師の机が移る先（その講師の机番号）と、手入力の机を寄せる「テンプレが使わない番号」・
   * 「テンプレが使う最後の机」の両方をこれで決める（2026-11-10 から）。
   */
  usedDesks?: readonly TemplateDeskRef[]
  aliases?: TeacherAliasResolver
}

/**
 * 1 コマの机を、新しいテンプレの講師の位置（講師の手がかりの無い机はテンプレの並び）へ並べ直す（純関数・入力は変えない）。templateDesks は盤面の元になったテンプレの机（抑止前）、
 * usedDesks（省略時は templateDesks）は反映するテンプレの机（抑止後）。
 * 講師の手がかりのある机（足場講師・手置き講師の机の講師・削除記録／休みの講師）は**新しいテンプレのその講師の机番号**へ。
 * 講師が新しいテンプレのそのコマにいない机の手入力は、テンプレが使う最後の机より下の空き机 → テンプレが使わない机 → 残った机の順で一番若いものへ。
 * 講師の手がかりの無い机は従来どおりテンプレの机番号（授業 ID → 同じ生徒）へ、手入力だけの机（メモだけ・出欠記録だけを含む）は今の番号がテンプレで使われていなければそのまま、
 * 使われていればテンプレが使わない番号の一番若いものへ（無ければ残った番号＝§2-1 で 2 行）。
 * 保留の机は動かさない。新しいテンプレの並びどおりに並んでいるコマは参照ごと同じものを返す（INV-10）。
 */
export function restoreTemplateDeskOrder(cell: SlotCell, templateDesks: readonly TemplateDeskRef[], options: RestoreTemplateDeskOrderOptions = {}): SlotCell {
  return restoreTemplateDeskOrderWithMoves(cell, templateDesks, options).cell
}

type DeskRoute =
  | { kind: 'locked' }
  /** 講師が新しいテンプレのそのコマにいる（候補＝その講師の机番号・今の番号を先頭に）。 */
  | { kind: 'follow'; candidates: number[]; derived: boolean }
  /** 講師の手がかりはあるが、その講師が新しいテンプレのそのコマにいない。 */
  | { kind: 'teacher-left'; teacherName: string }
  /** 講師の手がかりが無い（従来どおり保存前のテンプレの机番号）。 */
  | { kind: 'anchor'; candidates: number[] }

/** 呼び名の対応表を 1 コマの間だけ覚えておく（同じ講師名の呼び名を机×テンプレの机の組ごとに引き直さない・L-3）。 */
function memoizeAliases(aliases: TeacherAliasResolver): TeacherAliasResolver {
  const cache = new Map<string, readonly string[]>()
  return (key) => {
    const hit = cache.get(key)
    if (hit) return hit
    const value = aliases(key)
    cache.set(key, value)
    return value
  }
}

/** restoreTemplateDeskOrder の本体。講師が新しいテンプレにいない机の手入力の行き先（teacherLeftMoves）も返す（確認画面の行の材料）。 */
export function restoreTemplateDeskOrderWithMoves(cell: SlotCell, templateDesks: readonly TemplateDeskRef[], options: RestoreTemplateDeskOrderOptions = {}): { cell: SlotCell; teacherLeftMoves: TemplateDeskTeacherLeftMove[] } {
  const aliases = memoizeAliases(options.aliases ?? defaultAliases)
  const usedDesks: readonly TemplateDeskRef[] = options.usedDesks ?? templateDesks
  const size = cell.desks.length
  const unchanged = { cell, teacherLeftMoves: [] as TemplateDeskTeacherLeftMove[] }
  const lockedIndexes = new Set<number>()
  cell.desks.forEach((desk, index) => { if (options.lockedDeskIds?.has(desk.id)) lockedIndexes.add(index) })
  const positions = cell.desks.map((_, index) => index)
  const currentFirst = (index: number, hits: number[]) => (hits.includes(index) ? [index, ...hits.filter((hit) => hit !== index)] : hits)

  const routes: DeskRoute[] = cell.desks.map((desk, index): DeskRoute => {
    if (lockedIndexes.has(index)) return { kind: 'locked' }
    const anchorRoute = (): DeskRoute => ({ kind: 'anchor', candidates: resolveAnchorCandidates(desk, index, cell.dateKey, templateDesks, aliases).filter((target) => target < size && !lockedIndexes.has(target)) })
    const clue = resolveDeskTeacherClue(desk, templateDesks, aliases)
    if (!clue) return anchorRoute()
    // 新しいテンプレのその講師の机（保留の机が塞いでいても「講師はいる」＝下の机へは移さない。行けなければ手入力だけの机と同じ扱い）
    const hits = positions.filter((target) => {
      const templateDesk = usedDesks[target]
      return Boolean(templateDesk) && clue.matches(templateDesk)
    })
    if (hits.length > 0) return { kind: 'follow', candidates: currentFirst(index, hits.filter((target) => !lockedIndexes.has(target))), derived: clue.derived }
    // 講師名を固定しただけの机は、その講師が新しいテンプレにいなければ手がかりにしない（従来どおり）
    if (clue.onlyIfPresent) return anchorRoute()
    return { kind: 'teacher-left', teacherName: clue.label }
  })
  const candidatesOf = (index: number) => {
    const route = routes[index]
    return route.kind === 'follow' || route.kind === 'anchor' ? route.candidates : []
  }
  const targetByDesk = new Map<number, number>()
  const claimed = new Set<number>()
  const claim = (index: number) => {
    if (targetByDesk.has(index)) return
    const target = candidatesOf(index).find((candidate) => !claimed.has(candidate))
    if (target === undefined) return
    targetByDesk.set(index, target)
    claimed.add(target)
  }
  const claimInPlace = (index: number) => {
    if (candidatesOf(index)[0] === index && !claimed.has(index)) { targetByDesk.set(index, index); claimed.add(index) }
  }
  const ofKind = (match: (route: DeskRoute) => boolean) => positions.filter((index) => match(routes[index]))
  // 講師について行く机が先（新しいテンプレの講師の位置で突き合わせる）。足場講師の机（今の番号に居る机 → ほか）→ 手置き講師の机（テンプレの授業・採用の記録・
  // 固定した講師名から引いた講師。今の番号に居る机 → ほか）の順（L-1: 手置き講師の机は同じ講師の足場講師の机に番号を譲る）。
  // そのあと講師の手がかりの無い机が保存前のテンプレの番号を取る（今の番号に居る机が先＝並び替えていない机を押し出さない）。
  const scaffoldFollowers = ofKind((route) => route.kind === 'follow' && !route.derived)
  const derivedFollowers = ofKind((route) => route.kind === 'follow' && route.derived)
  scaffoldFollowers.forEach(claimInPlace)
  scaffoldFollowers.forEach(claim)
  derivedFollowers.forEach(claimInPlace)
  derivedFollowers.forEach(claim)
  const anchored = ofKind((route) => route.kind === 'anchor')
  anchored.forEach(claimInPlace)
  anchored.forEach(claim)

  const rest = positions.filter((index) => !lockedIndexes.has(index) && !targetByDesk.has(index))
  const teacherLeftManual = rest.filter((index) => routes[index].kind === 'teacher-left' && hasManualDeskContent(cell.desks[index], cell.dateKey))
  // 講師の手がかりの無い机・講師の机へ行けなかった机のうち中身のあるもの（従来の「手入力だけの机」）
  const manualDesks = rest.filter((index) => routes[index].kind !== 'teacher-left' && !isEmptyBoardDesk(cell.desks[index]))
  // 空き机と、講師がいなくなった手入力の無い机（テンプレが置き直すのでどこでもよい）
  const looseDesks = rest.filter((index) => !teacherLeftManual.includes(index) && !manualDesks.includes(index))
  const rearranged = [...targetByDesk].some(([index, target]) => index !== target)
  // 講師の机が全部その講師の新しい番号にあり（並び替えていない・講師の机番号も変わっていない）、講師がいなくなった机の手入力も無い → 何も動かさない（INV-10）
  if (!rearranged && teacherLeftManual.length === 0) return unchanged

  const assigned = new Map<number, number>(targetByDesk)
  const taken = new Set<number>([...lockedIndexes, ...claimed])
  const isFree = (index: number) => !taken.has(index)
  const isUnused = (index: number) => !hasTemplateDeskContent(usedDesks[index])
  const take = (deskIndex: number, target: number) => { assigned.set(deskIndex, target); taken.add(target) }
  if (!rearranged) {
    // 講師の机は動かない（講師がいなくなった机の手入力だけがある）: 手入力だけの机は今の番号のまま（v1.5.715 までと同じ）
    for (const index of manualDesks) if (isFree(index)) take(index, index)
  } else {
    // 手入力だけの机: 今の番号が空いていてテンプレが使わない → そのまま
    for (const index of manualDesks) if (isFree(index) && isUnused(index)) take(index, index)
  }
  // 講師が新しいテンプレのそのコマにいない机の手入力（M-1・M-2）: テンプレが使う最後の机より下の空き机の一番若いもの → 無ければテンプレが使わない机の一番若いもの
  // → どちらも無ければ残った机（今の番号が空いていればそこ）。残った机はテンプレが使う机（別の講師の机になりうる）なので確認画面に必ず出す（no-desk）。
  const lastUsedIndex = positions.reduce((last, index) => (isUnused(index) ? last : index), -1)
  const teacherLeftMoves: TemplateDeskTeacherLeftMove[] = []
  for (const index of teacherLeftManual) {
    const unused = positions.find((position) => position > lastUsedIndex && isFree(position) && isUnused(position))
      ?? positions.find((position) => isFree(position) && isUnused(position))
    const target = unused ?? (isFree(index) ? index : positions.find(isFree))
    if (target === undefined) continue
    take(index, target)
    const desk = cell.desks[index]
    const route = routes[index]
    const base = {
      cellId: cell.id, dateKey: cell.dateKey, slotNumber: cell.slotNumber, fromDeskIndex: index, toDeskIndex: target, formerTeacherName: route.kind === 'teacher-left' ? route.teacherName : '',
      ...(resolveDeskTeacherOrigin(desk) === 'manual' && hasRealDeskTeacher(desk.teacher) ? { movedTeacherName: desk.teacher.trim() } : {}),
      manualStudents: liveStudents(desk.lesson).filter((student) => resolveStudentOriginOnDate(student, cell.dateKey) !== 'template'),
    }
    if (unused === undefined) {
      const deskTeacher = usedDesks[target]?.teacher ?? ''
      teacherLeftMoves.push({ kind: 'no-desk', ...base, ...(hasRealDeskTeacher(deskTeacher) ? { deskTeacherName: deskTeacher.trim() } : {}) })
    } else if (unused !== index) {
      // 確認画面に出すのは実際に別の机へ移したものだけ（今の番号が既に行き先なら机はそのまま）
      teacherLeftMoves.push({ kind: 'moved', ...base })
    }
  }
  // それ以外の手入力だけの机は、テンプレが使わない番号の一番若いもの → 無ければ今の番号（空いていれば）→ 残った番号の一番若いもの
  for (const index of manualDesks) {
    if (assigned.has(index)) continue
    const target = positions.find((position) => isFree(position) && isUnused(position)) ?? (isFree(index) ? index : positions.find(isFree))
    if (target !== undefined) take(index, target)
  }
  for (const index of looseDesks) {
    const target = isFree(index) ? index : positions.find(isFree)
    if (target !== undefined) take(index, target)
  }

  const placed: DeskCell[] = new Array(size)
  lockedIndexes.forEach((index) => { placed[index] = cell.desks[index] })
  assigned.forEach((target, index) => { placed[target] = cell.desks[index] })
  if (placed.some((desk) => !desk) || placed.length !== size) return unchanged
  // 机 ID は位置どおりに振り直す（保留の机は元の ID のまま・deskSort の assignSortedDeskIds と同じ規則。固定した机の ID と衝突するなら元の ID のまま）
  const lockedIds = new Set([...lockedIndexes].map((index) => cell.desks[index].id))
  const collides = placed.some((_desk, index) => !lockedIndexes.has(index) && lockedIds.has(`${cell.id}_desk_${index + 1}`))
  const desks = placed.map((desk, index) => {
    if (lockedIndexes.has(index) || collides) return desk
    const id = `${cell.id}_desk_${index + 1}`
    return desk.id === id ? desk : { ...desk, id }
  })
  // 机が 1 つも動かなくても、残った机（別の講師の机）へ入る手入力は確認画面に出す（no-desk）
  if (desks.every((desk, index) => desk === cell.desks[index])) return { cell, teacherLeftMoves }
  return { cell: { ...cell, desks }, teacherLeftMoves }
}
