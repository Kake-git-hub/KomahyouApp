// 確認リストの「準備する」第 2 段（データ作りまで自動・2026-11-06 オーナー選択・docs/spec-developer-report.md §E-2-4-2・
// docs/plan-2026-11-06-checklist-auto-prep-stage2.md）の純関数。
//
// ★確認用の生徒: テンプレに登録するのは名簿の「確認用 生徒A」「確認用 生徒B」…だけ（今いる生徒をテンプレに登録しない＝ほかの生徒の
//   予定数・未消化・日程表を動かさない・INV-06）。名簿に居なければ足す（入塾日＝今日・退塾日なし・小学生の固定の生年月日）。
//   後片づけでも名簿から消さない（次の準備で使い回す）。
// ★同じ曜日・時限に既に登録のある確認用の生徒は使わず、次の確認用の生徒を使う（同じコマに同じ生徒を 2 か所置かない・INV-12）。
// ★テンプレから消すのは確認用の生徒の登録だけ（INV-02）。
// このファイルは純データ・純関数のみ（DOM / ネットワークに触らない）。

import { getStudentDisplayName, isStudentDeletedFromApp, normalizeDateText, type StudentRow } from '../basic-data/basicDataModel'
import { resolveStudentOrigin } from './placementOrigin'
import { regularTemplateDayLabelByValue, type RegularLessonTemplate, type RegularLessonTemplateCell, type RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { normalizeRequestedSubjectForGrade, resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'
import { isTemplatePendingLowerEmpty, type TemplatePendingDeskMap, type TemplatePendingLower } from './templatePendingDesks'
import type { DeskCell, DeskLesson, SlotCell, StudentEntry, SubjectLabel } from './types'

/** 準備で置く体験の名前の頭（第 1 段から不変・checklistPrep.ts が再公開する）。 */
export const CHECKLIST_PREP_TRIAL_NAME_PREFIX = '確認用 体験'
/** 準備で書くメモの頭（第 1 段から不変・checklistPrep.ts が再公開する）。 */
export const CHECKLIST_PREP_MEMO_PREFIX = '確認用メモ'
export const CHECKLIST_PREP_STUDENT_NAME_PREFIX = '確認用 生徒'

/**
 * 確認用の生徒の生年月日: todayKey の属する年度（4/1 始まり）に小 4 になる 4/2 生まれ（＝年度の開始年の 10 年前の 4/2）。
 * 学年の計算（resolveGradeNumberFromBirthDate）は 4/2〜翌 4/1 生まれを同じ学年に数えるので、4/2 生まれはその年度のあいだずっと小 4。
 */
export function CHECKLIST_PREP_STUDENT_BIRTH_DATE(todayKey: string): string {
  const [year, month] = todayKey.split('-').map(Number)
  const schoolYear = (month || 1) >= 4 ? year : year - 1
  return `${String(schoolYear - 10).padStart(4, '0')}-04-02`
}

/** 確認用の生徒か（名前が「確認用 生徒」で始まる）。 */
export function isChecklistPrepStudent(student: Pick<StudentRow, 'name'>): boolean {
  return student.name.trim().startsWith(CHECKLIST_PREP_STUDENT_NAME_PREFIX)
}

/** 準備に使える確認用の生徒（削除されていない・退塾日が無い）。退塾日のある確認用の生徒は数えない・テンプレに登録しない。 */
export function isUsableChecklistPrepStudent(student: StudentRow): boolean {
  return isChecklistPrepStudent(student) && !isStudentDeletedFromApp(student) && !normalizeDateText(student.withdrawDate ?? '')
}

/** 0→A, 25→Z, 26→AA …（名前の末尾の文字）。 */
function prepStudentLetter(index: number): string {
  let value = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return letters
}

/**
 * 使える確認用の生徒が count 人未満なら、空いている文字（A, B, …・名簿の名前と重ならない）で足す。足りていれば同じ配列を返し added は空。
 * 足す行は名簿の後ろ。ほかの行はそのまま（同じ参照）。id は createId（名簿と足した分の id を taken に渡す）。
 */
export function ensureChecklistPrepStudents(
  students: readonly StudentRow[],
  count: number,
  params: { todayKey: string; createId: (taken: ReadonlySet<string>) => string },
): { students: StudentRow[]; added: StudentRow[] } {
  const missing = count - students.filter(isUsableChecklistPrepStudent).length
  if (missing <= 0) return { students: students as StudentRow[], added: [] }
  const takenNames = new Set(students.map((student) => student.name.trim()))
  const takenIds = new Set(students.map((student) => student.id))
  const birthDate = CHECKLIST_PREP_STUDENT_BIRTH_DATE(params.todayKey)
  const added: StudentRow[] = []
  for (let index = 0; added.length < missing; index += 1) {
    const name = `${CHECKLIST_PREP_STUDENT_NAME_PREFIX}${prepStudentLetter(index)}`
    if (takenNames.has(name)) continue
    const id = params.createId(takenIds)
    takenIds.add(id)
    takenNames.add(name)
    // 表示名は名前と同じにする（空だと deriveManagedDisplayName が空白の前の「確認用」だけを表示名にする）。
    added.push({ id, name, displayName: name, email: '', entryDate: params.todayKey, withdrawDate: '', birthDate })
  }
  return { students: [...students, ...added], added }
}

/**
 * テンプレへの 1 件の登録。
 *  - deskIndex … 盤面の机番号（0 始まり・ChecklistPrepOp と同じ・結果の文の盤面側）。
 *  - templateDeskIndex … 登録先のテンプレの机番号（RegularLessonTemplateDesk.deskIndex・1 始まり）。**盤面の机番号 + 1 とは限らない**
 *    （盤面はテンプレの中身のある机を最初の空き机へ詰めて置く・並び替えた週は机が動く）。resolveChecklistPrepTemplateDeskIndex で引く。
 * dayOfWeek は 0=日 … 6=土（Date#getDay・テンプレと同じ）。label は結果の文の「(1)」「(2)」。
 */
export type ChecklistPrepTemplateRegistration = { dayOfWeek: number; slotNumber: number; deskIndex: number; templateDeskIndex: number; studentIndex: 0 | 1; subject: SubjectLabel; label: string }

export type ChecklistPrepTemplateAssignment = ChecklistPrepTemplateRegistration & { studentId: string; studentName: string }

function findTemplateCell(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number): RegularLessonTemplateCell | undefined {
  return template?.cells.find((cell) => cell.dayOfWeek === dayOfWeek && cell.slotNumber === slotNumber)
}

/** テンプレのその曜日・時限・机（テンプレの机番号・1 始まり）を返す。 */
export function findChecklistPrepTemplateDesk(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number, templateDeskIndex: number): RegularLessonTemplateDesk | undefined {
  return findTemplateCell(template, dayOfWeek, slotNumber)?.desks.find((entry) => entry.deskIndex === templateDeskIndex)
}

/** テンプレのその曜日・時限・机（テンプレの机番号・1 始まり）・席に生徒の登録があるか。 */
export function isChecklistPrepTemplateSeatTaken(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number, templateDeskIndex: number, seat: number): boolean {
  return Boolean(findChecklistPrepTemplateDesk(template, dayOfWeek, slotNumber, templateDeskIndex)?.students[seat]?.studentId)
}

// 盤面のテンプレの授業 id: `managed_${row.id}_${dateKey}`（ScheduleBoardScreen の buildManagedRegularLessonsRange）、
// テンプレから作る行の id: `template_${年度}_${曜}_${限}_${机}`（regularLessonTemplate.ts の buildRegularLessonsFromTemplate）。形を変えるときはここも直す。
const TEMPLATE_MANAGED_LESSON_ID = /^managed_template_\d+_(\d+)_(\d+)_(\d+)_/u

/**
 * 盤面の机に対応するテンプレの机番号（1 始まり）。引けなければ null（その机は準備に使わない）。
 *  1. 授業 id（managed_template_<年度>_<曜>_<限>_<机>_<日付>）が同じ曜日・時限を指し、テンプレにその机があればその机。
 *  2. 引けなければ、その机のテンプレの生徒（出自がテンプレ・managedStudentId）を持つテンプレの机（同じ曜日・時限）。
 * 差分反映の並びの戻し（templateDeskOrderRestore.ts の resolveAnchorCandidates）と同じ順の手がかり（授業 id → 生徒）。向こうは盤面の形の
 * テンプレの机を相手にするので、ここは保存するテンプレ（RegularLessonTemplate）を相手に同じ順で引く。
 */
export function resolveChecklistPrepTemplateDeskIndex(desk: Pick<DeskCell, 'lesson'>, template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number): number | null {
  const cell = findTemplateCell(template, dayOfWeek, slotNumber)
  if (!cell || !desk.lesson) return null
  const matched = TEMPLATE_MANAGED_LESSON_ID.exec(desk.lesson.id)
  if (matched && Number(matched[1]) === dayOfWeek && Number(matched[2]) === slotNumber) {
    const byId = cell.desks.find((entry) => entry.deskIndex === Number(matched[3]))
    if (byId) return byId.deskIndex
  }
  const templateStudentIds = desk.lesson.studentSlots
    .filter((student): student is StudentEntry => Boolean(student?.managedStudentId) && resolveStudentOrigin(student!) === 'template')
    .map((student) => student.managedStudentId!)
  if (templateStudentIds.length === 0) return null
  const byStudent = cell.desks.find((entry) => entry.students.some((student) => student?.studentId && templateStudentIds.includes(student.studentId)))
  return byStudent ? byStudent.deskIndex : null
}

function collectTemplateStudentIdsInSlot(cell: RegularLessonTemplateCell | undefined): Set<string> {
  const ids = new Set<string>()
  for (const desk of cell?.desks ?? []) {
    for (const student of desk.students) if (student?.studentId) ids.add(student.studentId)
  }
  return ids
}

/** その曜日・時限にまだ登録の無い、使える確認用の生徒（名前の文字の順）。 */
export function listAvailableChecklistPrepStudents(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number, students: readonly StudentRow[]): StudentRow[] {
  const inSlot = collectTemplateStudentIdsInSlot(findTemplateCell(template, dayOfWeek, slotNumber))
  return sortPrepStudents(students.filter((student) => isUsableChecklistPrepStudent(student) && !inSlot.has(student.id)))
}

function sortPrepStudents(students: StudentRow[]): StudentRow[] {
  return [...students].sort((left, right) => left.name.trim().length - right.name.trim().length || left.name.trim().localeCompare(right.name.trim()))
}

/**
 * 名簿に居てほしい確認用の生徒の数（App が「準備する」で名簿へ足す数）。どの曜日・時限に当たっても base 人を新しく登録できるように、
 * 1 つの曜日・時限に既に登録されている確認用の生徒の最大数を足す（2 回目の準備で同じ曜日・時限に当たっても足りる・INV-12）。
 */
export function resolveChecklistPrepStudentCount(template: RegularLessonTemplate | null | undefined, students: readonly StudentRow[], base: number): number {
  const prepIds = new Set(students.filter(isUsableChecklistPrepStudent).map((student) => student.id))
  let maxInSlot = 0
  for (const cell of template?.cells ?? []) {
    const inSlot = [...collectTemplateStudentIdsInSlot(cell)].filter((id) => prepIds.has(id)).length
    if (inSlot > maxInSlot) maxInSlot = inSlot
  }
  return base + maxInSlot
}

function templateSeatLabel(registration: Pick<ChecklistPrepTemplateRegistration, 'dayOfWeek' | 'slotNumber' | 'templateDeskIndex' | 'studentIndex'>) {
  const day = regularTemplateDayLabelByValue[registration.dayOfWeek] ?? ''
  return `${day}曜 ${registration.slotNumber}限 机 ${registration.templateDeskIndex} の生徒 ${registration.studentIndex + 1}`
}

function cloneTemplateCell(cell: RegularLessonTemplateCell): RegularLessonTemplateCell {
  return { ...cell, desks: cell.desks.map((desk) => ({ ...desk, students: [desk.students[0], desk.students[1]] as RegularLessonTemplateDesk['students'] })) }
}

/**
 * テンプレの席に確認用の生徒を登録した新しいテンプレを返す（入力は書き換えない・触る曜日×時限だけ作り直す）。
 * 席が埋まっていれば失敗（既存の登録を消さない・INV-02）。その曜日・時限に既に居る確認用の生徒は使わない（INV-12）。1 回の準備で同じ生徒を 2 つ使わない。
 * 登録先はテンプレの机番号（registration.templateDeskIndex）。テンプレにその曜日・時限・机が無ければ作る（講師なし）。科目は確認用の生徒の学年で使えるものに直す（数→算 など・normalizeRequestedSubjectForGrade）。
 * 失敗したら何も登録しない（途中まで登録した形を返さない）。
 */
export function assignChecklistPrepTemplateStudents(
  template: RegularLessonTemplate,
  registrations: readonly ChecklistPrepTemplateRegistration[],
  prepStudents: readonly StudentRow[],
): { ok: true; template: RegularLessonTemplate; assigned: ChecklistPrepTemplateAssignment[] } | { ok: false; reason: string } {
  const cells = [...template.cells]
  const clonedIndexes = new Set<number>()
  const usedIds = new Set<string>()
  const assigned: ChecklistPrepTemplateAssignment[] = []
  for (const registration of registrations) {
    let cellIndex = cells.findIndex((cell) => cell.dayOfWeek === registration.dayOfWeek && cell.slotNumber === registration.slotNumber)
    if (cellIndex < 0) {
      cells.push({ dayOfWeek: registration.dayOfWeek, slotNumber: registration.slotNumber, desks: [] })
      cellIndex = cells.length - 1
      clonedIndexes.add(cellIndex)
    }
    if (!clonedIndexes.has(cellIndex)) {
      cells[cellIndex] = cloneTemplateCell(cells[cellIndex])
      clonedIndexes.add(cellIndex)
    }
    const cell = cells[cellIndex]
    const templateDeskIndex = registration.templateDeskIndex
    let desk = cell.desks.find((entry) => entry.deskIndex === templateDeskIndex)
    if (!desk) {
      desk = { deskIndex: templateDeskIndex, teacherId: '', students: [null, null] }
      cell.desks = [...cell.desks, desk].sort((left, right) => left.deskIndex - right.deskIndex)
    }
    if (desk.students[registration.studentIndex]?.studentId) {
      return { ok: false, reason: `テンプレの ${templateSeatLabel(registration)} には登録があります。何も登録していません。` }
    }
    const inSlot = collectTemplateStudentIdsInSlot(cell)
    const student = sortPrepStudents(prepStudents.filter((entry) => isUsableChecklistPrepStudent(entry) && !inSlot.has(entry.id) && !usedIds.has(entry.id)))[0]
    if (!student) {
      return { ok: false, reason: `確認用の生徒が足りません（テンプレの ${templateSeatLabel(registration)} に登録できる確認用の生徒が名簿に居ません）。何も登録していません。` }
    }
    usedIds.add(student.id)
    const grade = resolveGradeLabelFromBirthDate(student.birthDate, template.effectiveStartDate) || '小4'
    desk.students[registration.studentIndex] = { studentId: student.id, subject: normalizeRequestedSubjectForGrade(registration.subject, grade) as SubjectLabel }
    assigned.push({ ...registration, studentId: student.id, studentName: getStudentDisplayName(student) })
  }
  return { ok: true, template: { ...template, cells }, assigned }
}

/** テンプレの確認用の生徒の登録だけを空にする（ほかの生徒・講師はそのまま・INV-02）。何も無ければ同じテンプレを返す。 */
export function removeChecklistPrepTemplateStudents(template: RegularLessonTemplate, prepStudentIds: ReadonlySet<string>): { template: RegularLessonTemplate; removed: number } {
  let removed = 0
  const cells = template.cells.map((cell) => {
    if (!cell.desks.some((desk) => desk.students.some((student) => student?.studentId && prepStudentIds.has(student.studentId)))) return cell
    return {
      ...cell,
      desks: cell.desks.map((desk) => {
        if (!desk.students.some((student) => student?.studentId && prepStudentIds.has(student.studentId))) return desk
        return {
          ...desk,
          students: desk.students.map((student) => {
            if (!student?.studentId || !prepStudentIds.has(student.studentId)) return student
            removed += 1
            return null
          }) as RegularLessonTemplateDesk['students'],
        }
      }),
    }
  })
  if (removed === 0) return { template, removed: 0 }
  return { template: { ...template, cells }, removed }
}

// ─────────────────────────────────────────────────────────────────────────────
// 後片づけ（§E-2-4-2 決定 4）: 盤面の「確認用」だけを消す
// ─────────────────────────────────────────────────────────────────────────────

/** 準備で置いた体験（手で足した体験で、名前が「確認用 体験」で始まる）。名前が違う体験・手で足していない体験は消さない（INV-02）。 */
function isChecklistPrepTrial(student: StudentEntry | null | undefined): boolean {
  return Boolean(student) && student!.lessonType === 'trial' && student!.manualAdded === true && student!.name.trim().startsWith(CHECKLIST_PREP_TRIAL_NAME_PREFIX)
}

function isChecklistPrepMemo(memo: string | null | undefined): boolean {
  return typeof memo === 'string' && memo.trim().startsWith(CHECKLIST_PREP_MEMO_PREFIX)
}

/**
 * 印の付いた講師が今も「準備で手で置いた講師」の形か（講師が居て・手置き〔manual／manual-replaced〕）。
 * 講師を消した記録（deleted）・日程表登録（QR）の講師・講師なしに変わった机は、印が残っていても講師を外さない（室長や自動処理が置き直したもの・INV-02）。
 */
function isLivePrepTeacher(fields: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource'>): boolean {
  return Boolean(fields.teacher.trim()) && fields.manualTeacher === true && (fields.teacherAssignmentSource === 'manual' || fields.teacherAssignmentSource === 'manual-replaced')
}

/** 出欠記録のある机（行）。講師を外すと記録の講師の帰属が空になる（INV-01）ので、準備の講師は外さず印だけ外す。 */
function hasStatusRecords(statusSlots: DeskCell['statusSlots']): boolean {
  return Boolean(statusSlots?.some(Boolean))
}

type RemovedCounts = { trials: number; memos: number; teachers: number }

/** 授業から準備の体験を外す。外したものが無ければ同じ授業、全部の席が空けば undefined。 */
function stripPrepTrials(lesson: DeskLesson | undefined, counts: RemovedCounts): DeskLesson | undefined {
  if (!lesson || !lesson.studentSlots.some(isChecklistPrepTrial)) return lesson
  const studentSlots = lesson.studentSlots.map((student) => {
    if (!isChecklistPrepTrial(student)) return student
    counts.trials += 1
    return null
  }) as DeskLesson['studentSlots']
  if (!studentSlots.some(Boolean)) return undefined
  return { ...lesson, studentSlots }
}

/** メモから準備のメモを外す。外したものが無ければ同じ配列、両方の席が空けば undefined。 */
function stripPrepMemos(memoSlots: [string | null, string | null] | undefined, counts: RemovedCounts): [string | null, string | null] | undefined {
  if (!memoSlots || !memoSlots.some(isChecklistPrepMemo)) return memoSlots
  const next = memoSlots.map((memo) => {
    if (!isChecklistPrepMemo(memo)) return memo
    counts.memos += 1
    return null
  }) as [string | null, string | null]
  if (next[0] == null && next[1] == null) return undefined
  return next
}

function cleanupDesk(desk: DeskCell, counts: RemovedCounts): DeskCell {
  const lesson = stripPrepTrials(desk.lesson, counts)
  const memoSlots = stripPrepMemos(desk.memoSlots, counts)
  const marked = desk.checklistPrepTeacher === true
  if (lesson === desk.lesson && memoSlots === desk.memoSlots && !marked) return desk
  const next: DeskCell = { ...desk }
  if (lesson) next.lesson = lesson
  else delete next.lesson
  if (memoSlots) next.memoSlots = memoSlots
  else delete next.memoSlots
  if (marked) {
    delete next.checklistPrepTeacher
    if (isLivePrepTeacher(desk) && !hasStatusRecords(desk.statusSlots)) {
      // 講師なしの机へ戻す（盤面の clearTeacherAssignment と同じ形）。テンプレの講師の机だったなら、再マージがテンプレの講師を置き直す
      // （準備 → 後片づけ → 再マージの通しテストで固定・checklistPrep.templateSave.test.ts）。
      next.teacher = ''
      next.manualTeacher = false
      next.teacherAssignmentSource = undefined
      next.teacherAssignmentSessionId = undefined
      next.teacherAssignmentTeacherId = undefined
      delete next.teacherUnavailableWarning
      counts.teachers += 1
    }
  }
  return next
}

function cleanupPendingLower(lower: TemplatePendingLower, counts: RemovedCounts): TemplatePendingLower {
  const lesson = stripPrepTrials(lower.lesson, counts)
  const memoSlots = stripPrepMemos(lower.memoSlots, counts)
  const teacher = lower.teacher
  const dropTeacher = Boolean(teacher?.checklistPrepTeacher) && isLivePrepTeacher(teacher!) && !hasStatusRecords(lower.statusSlots)
  const staleMark = Boolean(teacher?.checklistPrepTeacher) && !dropTeacher
  if (lesson === lower.lesson && memoSlots === lower.memoSlots && !teacher?.checklistPrepTeacher) return lower
  const next: TemplatePendingLower = { ...lower }
  if (lesson) next.lesson = lesson
  else delete next.lesson
  if (memoSlots) next.memoSlots = memoSlots
  else delete next.memoSlots
  if (dropTeacher) {
    // 下の行の準備の講師を消す（講師のぶつかりが解け、講師欄はテンプレの講師の 1 行に戻る）。
    delete next.teacher
    counts.teachers += 1
  } else if (staleMark) {
    const rest = { ...teacher! }
    delete rest.checklistPrepTeacher
    next.teacher = rest
  }
  return next
}

/**
 * 後片づけ（純関数・入力は書き換えない）: 盤面（上の行）と保留の下の行から、準備で置いた「確認用 体験」（手で足した体験だけ）・「確認用メモ」・
 * 準備の印の付いた手置き講師を消す。下の行が空になった保留は消す。名前が「確認用」で始まらない体験・印の無い講師は残す（INV-02）。
 * 印が残っていても手置きの講師でなくなった机（削除の記録・QR の講師など）・出欠記録のある机（記録の講師の帰属・INV-01）は講師を外さず古い印だけ外す（数には入れない）。
 * 触ったコマ・週だけ作り直す。何も無ければ removed はすべて 0 で、weeks・pendingDesks は入力と同じ参照。
 * テンプレの確認用の生徒の登録はここでは消さない（removeChecklistPrepTemplateStudents → テンプレの保存で消す）。
 */
export function cleanupChecklistPrepBoard(
  weeks: SlotCell[][],
  pendingDesks: TemplatePendingDeskMap | null,
): { weeks: SlotCell[][]; pendingDesks: TemplatePendingDeskMap | null; removed: RemovedCounts } {
  const counts: RemovedCounts = { trials: 0, memos: 0, teachers: 0 }
  let weeksChanged = false
  const nextWeeks = weeks.map((week) => {
    let weekChanged = false
    const nextWeek = week.map((cell) => {
      let cellChanged = false
      const desks = cell.desks.map((desk) => {
        const next = cleanupDesk(desk, counts)
        if (next !== desk) cellChanged = true
        return next
      })
      if (!cellChanged) return cell
      weekChanged = true
      return { ...cell, desks }
    })
    if (!weekChanged) return week
    weeksChanged = true
    return nextWeek
  })

  let nextPendingDesks = pendingDesks
  if (pendingDesks) {
    let pendingChanged = false
    const rebuilt: TemplatePendingDeskMap = {}
    for (const [key, entry] of Object.entries(pendingDesks)) {
      const lower = cleanupPendingLower(entry.lower, counts)
      if (lower === entry.lower) {
        rebuilt[key] = entry
        continue
      }
      pendingChanged = true
      if (isTemplatePendingLowerEmpty(lower)) continue
      rebuilt[key] = { ...entry, lower }
    }
    if (pendingChanged) nextPendingDesks = rebuilt
  }

  return { weeks: weeksChanged ? nextWeeks : weeks, pendingDesks: nextPendingDesks, removed: counts }
}
