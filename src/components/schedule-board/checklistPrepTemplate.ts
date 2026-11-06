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
import { regularTemplateDayLabelByValue, type RegularLessonTemplate, type RegularLessonTemplateCell, type RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { normalizeRequestedSubjectForGrade, resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'
import type { SubjectLabel } from './types'

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
 * テンプレへの 1 件の登録。deskIndex は盤面の机番号（0 始まり・ChecklistPrepOp と同じ）。テンプレの机（RegularLessonTemplateDesk.deskIndex）は 1 始まりなので +1 で引く。
 * dayOfWeek は 0=日 … 6=土（Date#getDay・テンプレと同じ）。label は結果の文の「(1)」「(2)」。
 */
export type ChecklistPrepTemplateRegistration = { dayOfWeek: number; slotNumber: number; deskIndex: number; studentIndex: 0 | 1; subject: SubjectLabel; label: string }

export type ChecklistPrepTemplateAssignment = ChecklistPrepTemplateRegistration & { studentId: string; studentName: string }

function findTemplateCell(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number): RegularLessonTemplateCell | undefined {
  return template?.cells.find((cell) => cell.dayOfWeek === dayOfWeek && cell.slotNumber === slotNumber)
}

/** テンプレのその曜日・時限・机（盤面の 0 始まりの机番号）・席に生徒の登録があるか。 */
export function isChecklistPrepTemplateSeatTaken(template: RegularLessonTemplate | null | undefined, dayOfWeek: number, slotNumber: number, boardDeskIndex: number, seat: number): boolean {
  const desk = findTemplateCell(template, dayOfWeek, slotNumber)?.desks.find((entry) => entry.deskIndex === boardDeskIndex + 1)
  return Boolean(desk?.students[seat]?.studentId)
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

function templateSeatLabel(registration: Pick<ChecklistPrepTemplateRegistration, 'dayOfWeek' | 'slotNumber' | 'deskIndex' | 'studentIndex'>) {
  const day = regularTemplateDayLabelByValue[registration.dayOfWeek] ?? ''
  return `${day}曜 ${registration.slotNumber}限 机 ${registration.deskIndex + 1} の生徒 ${registration.studentIndex + 1}`
}

function cloneTemplateCell(cell: RegularLessonTemplateCell): RegularLessonTemplateCell {
  return { ...cell, desks: cell.desks.map((desk) => ({ ...desk, students: [desk.students[0], desk.students[1]] as RegularLessonTemplateDesk['students'] })) }
}

/**
 * テンプレの席に確認用の生徒を登録した新しいテンプレを返す（入力は書き換えない・触る曜日×時限だけ作り直す）。
 * 席が埋まっていれば失敗（既存の登録を消さない・INV-02）。その曜日・時限に既に居る確認用の生徒は使わない（INV-12）。1 回の準備で同じ生徒を 2 つ使わない。
 * テンプレにその曜日・時限・机が無ければ作る（講師なし）。科目は確認用の生徒の学年で使えるものに直す（数→算 など・normalizeRequestedSubjectForGrade）。
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
    const templateDeskIndex = registration.deskIndex + 1
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
