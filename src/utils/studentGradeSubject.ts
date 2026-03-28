import type { GradeLabel, SubjectLabel } from '../components/schedule-board/types'

export const allStudentSubjectOptions: SubjectLabel[] = ['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社']
export const elementaryStudentSubjectOptions: SubjectLabel[] = ['算', '算国', '英', '国', '理', '社']
export const middleSchoolStudentSubjectOptions: SubjectLabel[] = ['数', '英', '国', '理', '社']
export const highSchoolStudentSubjectOptions: SubjectLabel[] = ['数', '英', '国', '生', '物', '化', '社']

function toDate(value: string | Date) {
  if (value instanceof Date) return new Date(value)
  return new Date(`${value}T00:00:00`)
}

export function resolveGradeLabelFromBirthDate(birthDate?: string, referenceDate: string | Date = new Date()): GradeLabel | '' {
  if (!birthDate) return ''

  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return ''

  const date = toDate(referenceDate)
  if (Number.isNaN(date.getTime())) return ''

  const schoolYear = date >= new Date(date.getFullYear(), 3, 1) ? date.getFullYear() : date.getFullYear() - 1
  const enrollmentYear = birthMonth < 4 || (birthMonth === 4 && birthDay === 1) ? birthYear + 6 : birthYear + 7
  const gradeNumber = schoolYear - enrollmentYear + 1

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

export function resolveDisplayedSubjectForBirthDate(subject: string, birthDate: string | undefined, referenceDate: string | Date, fallbackGrade = '') {
  const gradeLabel = birthDate ? resolveGradeLabelFromBirthDate(birthDate, referenceDate) : fallbackGrade
  return resolveDisplayedSubjectForGrade(subject, gradeLabel)
}