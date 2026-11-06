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
import type { TemplateDiffScopeNote } from './templateDefinitionDiff'
import { buildTemplateDiffConfirmDetail, type TemplateDiffApplySummary, type TemplateDiffStudentNote } from './templateDiffApply'
import { isTemplatePendingLowerEmpty, type TemplatePendingDeskMap, type TemplatePendingLower } from './templatePendingDesks'
import type { DeskCell, DeskLesson, SlotCell, StudentEntry, SubjectLabel } from './types'

/** 準備で置く体験の名前の頭（第 1 段から不変・checklistPrep.ts が再公開する）。 */
export const CHECKLIST_PREP_TRIAL_NAME_PREFIX = '確認用 体験'
/** 準備で書くメモの頭（第 1 段から不変・checklistPrep.ts が再公開する）。 */
export const CHECKLIST_PREP_MEMO_PREFIX = '確認用メモ'
export const CHECKLIST_PREP_STUDENT_NAME_PREFIX = '確認用 生徒'
/** 盤面だけを準備したときの結果の文の最後の一言（第 1 段から不変・checklistPrep.ts が再公開する）。 */
export const CHECKLIST_PREP_SAVE_REMINDER = '盤面はまだ保存していません。「保存」を押してから、項目の「やること」を行ってください。'
/** 第 2 段: 盤面の準備に続けてテンプレも保存したときの最後の一言（盤面だけの一言の代わりに 1 つだけ付ける）。 */
export const CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER = '盤面とテンプレはまだサーバーに保存していません。「保存」を押してから、項目の「やること」を行ってください。'
/** 第 2 段: 盤面には置いたが、テンプレの保存の段で断った・失敗した（途中まで進んだものは黙って消さない・§E-2-4-2 安全）。 */
export const CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX = '盤面には置きましたが、テンプレは保存していません: '
/** 名簿の確認用の生徒が足りない（App の足し忘れ）。何も置かない。 */
export const CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE = '確認用の生徒が名簿に足りません。もう一度押してください。何も変えていません。'
/** テンプレ保存の段の見直しで断る理由。 */
export const CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON = 'テンプレート編集中になったため。編集を終了してから、テンプレを手で保存してください。'
export const CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON = '教室が切り替わったため。'
/** 後片づけ（§E-2-4-2 決定 4）の文言。 */
export const CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE = '片づけるものはありません。'
export const CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE = '開発用教室・テスト教室でだけ後片づけできます。'
export const CHECKLIST_PREP_CLEANUP_TEMPLATE_MODE_MESSAGE = 'テンプレート編集中は後片づけできません。編集を終了してから、もう一度押してください。'
export const CHECKLIST_PREP_CLEANUP_TEMPLATE_FAILED_PREFIX = '盤面からは消しましたが、テンプレは保存していません: '
export const CHECKLIST_PREP_CLEANUP_SAVE_REMINDER = '盤面とテンプレはまだサーバーに保存していません。「保存」を押してください。'
/** 後片づけで盤面だけ消したとき（テンプレは保存していない）の最後の一言（M-1）。 */
export const CHECKLIST_PREP_CLEANUP_BOARD_SAVE_REMINDER = '盤面はまだサーバーに保存していません。「保存」を押してください。'
/** 準備でテンプレの保存の段を断った・失敗したときの最後の一言（テンプレが無いので「やること」はまだできない・M-1）。 */
export const CHECKLIST_PREP_TEMPLATE_FAILED_REMINDER = '盤面はまだサーバーに保存していません。テンプレは保存していないので、項目の「やること」はまだ行えません。「後片づけ」で盤面の準備を消せます。'
/** テンプレ保存は「元に戻す」の履歴を空にする（handleSaveRegularLessonTemplateByDiff）ので、戻し方を結果の文に書く（M-9）。 */
export const CHECKLIST_PREP_TEMPLATE_UNDO_NOTE = 'テンプレ保存で「元に戻す」は使えません。戻すときは「後片づけ」を押してください。'

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

/** 後片づけで盤面（上の行・保留の下の行）から消した数。 */
export type ChecklistPrepRemovedCounts = { trials: number; memos: number; teachers: number }
type RemovedCounts = ChecklistPrepRemovedCounts

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

// ─────────────────────────────────────────────────────────────────────────────
// コマ表の 2 段処理（盤面の準備 → テンプレ保存）と後片づけを組む純関数（§E-2-4-2・計画 Task 3）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * テンプレ保存の段（コマ表の effect が ref に積み、盤面の準備が入った次のレンダーで行う）。
 * template は保存するテンプレ（手で保存するときと同じ handleSaveRegularLessonTemplateByDiff へ渡す）。boardMessage は盤面で行ったことの文
 * （保存の段で断った・失敗したときにも黙って消さずに出す。後片づけで盤面を変えていなければ空）。
 */
export type ChecklistPrepTemplatePhase =
  | { kind: 'prep'; requestId: number; classroomId: string | null; template: RegularLessonTemplate; assigned: ChecklistPrepTemplateAssignment[]; boardMessage: string; queuedFromWeeks: SlotCell[][] }
  | { kind: 'cleanup'; requestId: number; classroomId: string | null; template: RegularLessonTemplate; removed: ChecklistPrepRemovedCounts; templateRemoved: number; boardMessage: string; queuedFromWeeks: SlotCell[][] }

/**
 * 積んだテンプレ保存の段をこのレンダーで走らせてよいか（修正ラウンド 1 I-1）。
 *  - none … 段が無い。 stale … 別のリクエストの段（捨てる）。
 *  - wait … 段を積んだときの weeks（盤面を当てる前の参照）のまま＝盤面を当てたのと同じレンダーのクロージャ（StrictMode の effect の 2 回目など）。
 *    ここで保存すると buildTemplateDiffSavePlan が準備前の weeks から盤面を作り直し、その setWeeks が準備を上書きして消す。次のレンダーを待つ。
 *  - run … weeks が変わった（盤面の準備が入った）レンダー。
 */
export function resolveChecklistPrepTemplatePhaseTiming(params: { phase: ChecklistPrepTemplatePhase | null; requestId: number; weeks: SlotCell[][] }): 'none' | 'stale' | 'wait' | 'run' {
  if (!params.phase) return 'none'
  if (params.phase.requestId !== params.requestId) return 'stale'
  return params.weeks === params.phase.queuedFromWeeks ? 'wait' : 'run'
}

/** 後片づけのテンプレ保存の反映開始日（主セッションの判断 2026-11-06）: 今日と保存済みの反映開始日の遅い方（今日より前の週に確認用の生徒を残さない・保存済みの先日付の版を前倒ししない）。 */
export function resolveChecklistPrepCleanupEffectiveStartDate(todayKey: string, savedEffectiveStartDate: string | null | undefined): string {
  return savedEffectiveStartDate && savedEffectiveStartDate > todayKey ? savedEffectiveStartDate : todayKey
}

/**
 * App が名簿へ確認用の生徒を足したことを結果の文に書く（M-2）。足したあとで断られても名簿は変わっているので、断った文の「何も変えていません」は
 * 「盤面とテンプレは変えていません」にする（名簿の確認用の生徒は次の準備で使うので残す）。足していなければ同じ結果を返す。
 */
export function annotateChecklistPrepResultWithAddedStudents(result: { ok: boolean; message: string }, added: readonly Pick<StudentRow, 'name'>[]): { ok: boolean; message: string } {
  if (added.length === 0) return result
  const line = `名簿に確認用の生徒（${added.map((student) => student.name.trim()).join('・')}）を足しました（次の準備でも使うので残します）。`
  const message = result.ok ? result.message : result.message.split('何も変えていません。').join('盤面とテンプレは変えていません。')
  return { ok: result.ok, message: [line, message].filter(Boolean).join('\n') }
}

/** handleSaveRegularLessonTemplateByDiff が返す、保存した計画の中身（確認画面の「詳細」と同じ材料）。 */
export type ChecklistPrepTemplateSaveResult = { summary: TemplateDiffApplySummary; studentNotes?: readonly TemplateDiffStudentNote[]; scopeNote?: TemplateDiffScopeNote }

/** 盤面の文の最後の一言（CHECKLIST_PREP_SAVE_REMINDER）を外す（テンプレも保存したときは別の一言を最後に 1 つだけ付ける）。 */
function stripBoardSaveReminder(boardMessage: string): string[] {
  const lines = boardMessage.split('\n')
  while (lines.length > 0 && (lines[lines.length - 1] === CHECKLIST_PREP_SAVE_REMINDER || !lines[lines.length - 1].trim())) lines.pop()
  return lines
}

/** 確認画面の「詳細」と同じ組み立て（buildTemplateDiffConfirmDetail は studentNotes を渡すと生徒ごとの理由〔buildTemplateDiffStudentNoteLines〕も載せる）。 */
function buildSavedDetailLines(params: { effectiveStartDate: string; todayKey: string } & ChecklistPrepTemplateSaveResult): string[] {
  return ['詳細:', buildTemplateDiffConfirmDetail(params.effectiveStartDate, params.summary, { scopeNote: params.scopeNote, todayKey: params.todayKey, studentNotes: params.studentNotes })]
}

/**
 * 準備 → テンプレ保存まで済んだときの結果の文: 盤面の行（盤面だけの一言は外す）→ テンプレへ登録した席と確認用の生徒 →「詳細:」＋確認画面の「詳細」と同じ文
 * （言い回しを二重に持たない）→ 最後に CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER を 1 つだけ。
 */
export function buildChecklistPrepTemplateSavedMessage(params: {
  boardMessage: string
  assigned: readonly ChecklistPrepTemplateAssignment[]
  effectiveStartDate: string
  summary: TemplateDiffApplySummary
  studentNotes?: readonly TemplateDiffStudentNote[]
  scopeNote?: TemplateDiffScopeNote
  todayKey: string
}): string {
  const seats = params.assigned.map((entry) => `${entry.label} ${templateSeatLabel(entry)} に「${entry.studentName}」`).join('、')
  return [
    ...stripBoardSaveReminder(params.boardMessage),
    `テンプレの ${seats}を登録して、テンプレを保存しました。`,
    ...buildSavedDetailLines(params),
    CHECKLIST_PREP_TEMPLATE_UNDO_NOTE,
    CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER,
  ].join('\n')
}

/**
 * テンプレ保存の段で断った・失敗したときの文（Review Focus 3）。盤面で行ったことは残っているので、その文を続けて出す（黙って消さない）。
 * 準備: 「盤面には置きましたが、テンプレは保存していません: 理由」＋盤面の文（最後は盤面の保存の一言）。
 * 後片づけ: 盤面を変えていれば「盤面からは消しましたが…」＋消した件数の文、変えていなければ「テンプレは保存していません: 理由」だけ。
 */
export function buildChecklistPrepTemplateFailedMessage(params: { kind: 'prep' | 'cleanup'; reason: string; boardMessage: string }): string {
  if (params.kind === 'cleanup') {
    if (!params.boardMessage) return `テンプレは保存していません: ${params.reason}`
    // 後片づけの盤面の文は盤面だけの一言（CHECKLIST_PREP_CLEANUP_BOARD_SAVE_REMINDER）で終わる＝テンプレを保存していないことと食い違わない。
    return `${CHECKLIST_PREP_CLEANUP_TEMPLATE_FAILED_PREFIX}${params.reason}\n${params.boardMessage}`
  }
  // 準備の盤面の文の最後の一言（「保存」を押してから「やること」を）はテンプレが無いと食い違うので、外して失敗用の一言に替える（M-1）。
  return [`${CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX}${params.reason}`, ...stripBoardSaveReminder(params.boardMessage), CHECKLIST_PREP_TEMPLATE_FAILED_REMINDER].join('\n')
}

/** 保存の段の見直し: 積んだときの教室と違う・テンプレ編集中になったら理由を返す（教室の切り替えで取りやめ・INV-08）。問題が無ければ null。 */
export function resolveChecklistPrepTemplatePhaseBlock(params: { phaseClassroomId: string | null; classroomId: string | null; isTemplateMode: boolean }): string | null {
  if (!params.classroomId || params.phaseClassroomId !== params.classroomId) return CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON
  if (params.isTemplateMode) return CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON
  return null
}

/**
 * 保存するテンプレを作る（盤面を当てる前に行い、失敗なら盤面も変えない）。baseTemplate は保存済みテンプレを在籍で絞ったもの
 * （buildTemplateDiffSavePlan の baseline と同じ）。反映開始日と保存時刻を差し替えてから確認用の生徒を登録する（学年は反映開始日で見る）。
 * 名簿の使える確認用の生徒が登録の数より少なければ CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE（App の足し忘れ）。
 */
export function prepareChecklistPrepTemplateSave(params: {
  registrations: readonly ChecklistPrepTemplateRegistration[]
  baseTemplate: RegularLessonTemplate | null | undefined
  effectiveStartDate: string
  students: readonly StudentRow[]
  savedAt: string
}): { ok: true; template: RegularLessonTemplate; assigned: ChecklistPrepTemplateAssignment[] } | { ok: false; reason: string } {
  if (!params.baseTemplate) return { ok: false, reason: 'テンプレがまだ無いため、確認用の生徒を登録できません。何も変えていません。' }
  const prepStudents = params.students.filter(isUsableChecklistPrepStudent)
  if (prepStudents.length < params.registrations.length) return { ok: false, reason: CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE }
  return assignChecklistPrepTemplateStudents({ ...params.baseTemplate, effectiveStartDate: params.effectiveStartDate, savedAt: params.savedAt }, params.registrations, prepStudents)
}

/** 後片づけを断る（検証用教室でない・テンプレ編集中）。断らなければ null。 */
export function resolveChecklistPrepCleanupBlock(params: { isVerificationClassroom: boolean; isTemplateMode: boolean }): string | null {
  if (!params.isVerificationClassroom) return CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE
  if (params.isTemplateMode) return CHECKLIST_PREP_CLEANUP_TEMPLATE_MODE_MESSAGE
  return null
}

export type ChecklistPrepCleanupPlan =
  | { nothing: true }
  | {
    nothing: false
    /** 盤面から 1 件以上消すか（false なら weeks・pendingDesks は入力のまま・commitWeeks しない）。 */
    boardChanged: boolean
    weeks: SlotCell[][]
    pendingDesks: TemplatePendingDeskMap | null
    removed: ChecklistPrepRemovedCounts
    /** 保存するテンプレ（確認用の生徒の登録を外して toSaveTemplate を通したもの）。外すものが無ければ null。 */
    template: RegularLessonTemplate | null
    templateRemoved: number
  }

/**
 * 後片づけの計画（純関数）: 盤面は cleanupChecklistPrepBoard、テンプレは確認用の生徒（isChecklistPrepStudent＝退塾した確認用も含む）の登録だけ外す。
 * テンプレは保存済みのもの（絞り込む前）で外し、件数もそこで数える（退塾した確認用の登録は在籍の絞り込みで見えなくなるため）。保存する形は toSaveTemplate
 * （在籍の絞り込み・反映開始日・保存時刻）で作る。「片づけるものはありません」は**件数**で決める（盤面の removed がすべて 0 かつテンプレの removed が 0）。
 * cleanupChecklistPrepBoard は古い印だけ外した机で新しい参照を返すことがあるが、件数 0 なら盤面を変えない（何も変えずに知らせる・Review Focus 5）。
 */
export function planChecklistPrepCleanup(params: {
  weeks: SlotCell[][]
  pendingDesks: TemplatePendingDeskMap | null
  savedTemplate: RegularLessonTemplate | null | undefined
  students: readonly StudentRow[]
  toSaveTemplate: (template: RegularLessonTemplate) => RegularLessonTemplate
}): ChecklistPrepCleanupPlan {
  const board = cleanupChecklistPrepBoard(params.weeks, params.pendingDesks)
  const boardChanged = board.removed.trials + board.removed.memos + board.removed.teachers > 0
  const prepStudentIds = new Set(params.students.filter(isChecklistPrepStudent).map((student) => student.id))
  const removedTemplate = params.savedTemplate && prepStudentIds.size > 0 ? removeChecklistPrepTemplateStudents(params.savedTemplate, prepStudentIds) : null
  const templateRemoved = removedTemplate?.removed ?? 0
  if (!boardChanged && templateRemoved === 0) return { nothing: true }
  return {
    nothing: false,
    boardChanged,
    weeks: boardChanged ? board.weeks : params.weeks,
    pendingDesks: boardChanged ? board.pendingDesks : params.pendingDesks,
    removed: board.removed,
    template: removedTemplate && templateRemoved > 0 ? params.toSaveTemplate(removedTemplate.template) : null,
    templateRemoved,
  }
}

/**
 * 後片づけの結果の文: 盤面から消した件数（消したときだけ）→ テンプレから外した件数＋「詳細:」（保存したときだけ）→ 保存の一言。
 * テンプレの保存の段で断った・失敗したときは templateRemoved: 0 で盤面の行だけを作り、buildChecklistPrepTemplateFailedMessage に渡す。
 */
export function buildChecklistPrepCleanupMessage(params: {
  removed: ChecklistPrepRemovedCounts
  templateRemoved: number
  templateSaved?: { effectiveStartDate: string; todayKey: string } & ChecklistPrepTemplateSaveResult
}): string {
  const { trials, memos, teachers } = params.removed
  const lines: string[] = []
  if (trials + memos + teachers > 0) lines.push(`盤面から消しました: 確認用の体験 ${trials} 人・確認用のメモ ${memos} 件・準備で置いた講師 ${teachers} 人。`)
  if (params.templateRemoved > 0 && params.templateSaved) {
    lines.push(`テンプレから確認用の生徒の登録 ${params.templateRemoved} 件を外して、テンプレを保存しました。`)
    lines.push(...buildSavedDetailLines(params.templateSaved))
  }
  // テンプレも保存したときは「盤面とテンプレ」、盤面だけのときは「盤面」（M-1）。
  lines.push(params.templateRemoved > 0 && params.templateSaved ? CHECKLIST_PREP_CLEANUP_SAVE_REMINDER : CHECKLIST_PREP_CLEANUP_BOARD_SAVE_REMINDER)
  return lines.join('\n')
}
