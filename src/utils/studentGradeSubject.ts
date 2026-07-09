import type { GradeLabel, SubjectLabel } from '../components/schedule-board/types'

export const allStudentSubjectOptions: SubjectLabel[] = ['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社', '理社']
export const elementaryStudentSubjectOptions: SubjectLabel[] = ['算', '算国', '英', '国', '理', '社', '理社']
export const middleSchoolStudentSubjectOptions: SubjectLabel[] = ['数', '英', '国', '理', '社']
export const highSchoolStudentSubjectOptions: SubjectLabel[] = ['数', '英', '国', '生', '物', '化', '社']

function toDate(value: string | Date) {
  if (value instanceof Date) return new Date(value)
  return new Date(`${value}T00:00:00`)
}

export function resolveEnrollmentYearFromBirthDateParts(birthYear: number, birthMonth: number) {
  return birthMonth < 4 ? birthYear + 6 : birthYear + 7
}

// 学年番号(小1=1 … 高3=12、13以上=高3卒業後)を返す。生年月日が無効なら null。
export function resolveGradeNumberFromBirthDate(birthDate?: string, referenceDate: string | Date = new Date()): number | null {
  if (!birthDate) return null

  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return null

  const date = toDate(referenceDate)
  if (Number.isNaN(date.getTime())) return null

  const schoolYear = date >= new Date(date.getFullYear(), 3, 1) ? date.getFullYear() : date.getFullYear() - 1
  const enrollmentYear = resolveEnrollmentYearFromBirthDateParts(birthYear, birthMonth)
  return schoolYear - enrollmentYear + 1
}

// 高3卒業判定(spec-basic-data.md): 高3(=12)の学年度が終わると翌4/1から学年番号が13以上になり、卒業＝非在籍として扱う。
export function hasGraduatedHighSchool(birthDate?: string, referenceDate: string | Date = new Date()): boolean {
  const gradeNumber = resolveGradeNumberFromBirthDate(birthDate, referenceDate)
  return gradeNumber !== null && gradeNumber >= 13
}

export function resolveGradeLabelFromBirthDate(birthDate?: string, referenceDate: string | Date = new Date()): GradeLabel | '' {
  const gradeNumber = resolveGradeNumberFromBirthDate(birthDate, referenceDate)
  if (gradeNumber === null) return ''

  if (gradeNumber <= 1) return '小1'
  if (gradeNumber === 2) return '小2'
  if (gradeNumber === 3) return '小3'
  if (gradeNumber === 4) return '小4'
  if (gradeNumber === 5) return '小5'
  if (gradeNumber === 6) return '小6'
  if (gradeNumber === 7) return '中1'
  if (gradeNumber === 8) return '中2'
  if (gradeNumber === 9) return '中3'
  if (gradeNumber === 10) return '高1'
  if (gradeNumber === 11) return '高2'
  return '高3'
}

export function isElementaryGradeLabel(gradeLabel?: string) {
  return Boolean(gradeLabel?.startsWith('小'))
}

export function isMiddleSchoolGradeLabel(gradeLabel?: string) {
  return Boolean(gradeLabel?.startsWith('中'))
}

export function isHighSchoolGradeLabel(gradeLabel?: string) {
  return Boolean(gradeLabel?.startsWith('高'))
}

export function getSelectableStudentSubjectsForGrade(gradeLabel?: string): SubjectLabel[] {
  if (isElementaryGradeLabel(gradeLabel)) return elementaryStudentSubjectOptions
  if (isMiddleSchoolGradeLabel(gradeLabel)) return middleSchoolStudentSubjectOptions
  if (isHighSchoolGradeLabel(gradeLabel)) return highSchoolStudentSubjectOptions
  return middleSchoolStudentSubjectOptions
}

export function resolveDisplayedSubjectForGrade(subject: string, gradeLabel?: string) {
  if (subject !== '算' && subject !== '数') return subject
  return isElementaryGradeLabel(gradeLabel) ? '算' : '数'
}

export function normalizeRequestedSubjectForGrade(subject: string, gradeLabel?: string) {
  if (subject === '算国') return isElementaryGradeLabel(gradeLabel) ? '算国' : '数'
  // 理社は小学限定の合体科目(算国と同型)。非小学に紛れ込んだ場合は理へ畳む。
  if (subject === '理社') return isElementaryGradeLabel(gradeLabel) ? '理社' : '理'
  if (subject === '算' || subject === '数') return isElementaryGradeLabel(gradeLabel) ? '算' : '数'
  return subject
}

export function resolveDisplayedSubjectForBirthDate(subject: string, birthDate: string | undefined, referenceDate: string | Date, fallbackGrade = '') {
  const gradeLabel = birthDate ? resolveGradeLabelFromBirthDate(birthDate, referenceDate) : fallbackGrade
  return resolveDisplayedSubjectForGrade(subject, gradeLabel)
}

export function normalizeRequestedSubjectForBirthDate(subject: string, birthDate: string | undefined, referenceDate: string | Date, fallbackGrade = '') {
  const gradeLabel = birthDate ? resolveGradeLabelFromBirthDate(birthDate, referenceDate) : fallbackGrade
  return normalizeRequestedSubjectForGrade(subject, gradeLabel)
}