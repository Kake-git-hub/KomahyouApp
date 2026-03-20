import type { StudentRow } from '../basic-data/basicDataModel'

export type AutoAssignRuleKey =
  | 'preferTwoStudentsPerTeacher'
  | 'maxOneLesson'
  | 'maxTwoLessons'
  | 'maxThreeLessons'
  | 'allowTwoConsecutiveLessons'
  | 'requireBreakBetweenLessons'
  | 'connectRegularLessons'
  | 'regularTeachersOnly'
  | 'preferLateAfternoon'
  | 'preferSecondPeriod'
  | 'preferFifthPeriod'
  | 'forbidFirstPeriod'

export type AutoAssignTargetGrade =
  | '小1'
  | '小2'
  | '小3'
  | '小4'
  | '小5'
  | '小6'
  | '中1'
  | '中2'
  | '中3'
  | '高1'
  | '高2'
  | '高3'

export type AutoAssignTarget =
  | { id: string; type: 'all' }
  | { id: string; type: 'grade'; grade: AutoAssignTargetGrade }
  | { id: string; type: 'students'; studentIds: string[] }

export type AutoAssignRuleRow = {
  key: AutoAssignRuleKey
  label: string
  description: string
  targets: AutoAssignTarget[]
  includeStudentIds: string[]
  excludeStudentIds: string[]
  updatedAt: string
}

export const autoAssignRuleDefinitions: Array<Pick<AutoAssignRuleRow, 'key' | 'label' | 'description'>> = [
  {
    key: 'preferTwoStudentsPerTeacher',
    label: '講師1人に生徒2人最優先',
    description: '可能な限り 1 卓に 2 人着席を優先します。',
  },
  {
    key: 'maxOneLesson',
    label: '1コマ上限',
    description: '同一日の授業数を 1 コマまでに抑えます。',
  },
  {
    key: 'maxTwoLessons',
    label: '2コマ上限',
    description: '同一日の授業数を 2 コマまでに抑えます。',
  },
  {
    key: 'maxThreeLessons',
    label: '3コマ上限',
    description: '同一日の授業数を 3 コマまでに抑えます。',
  },
  {
    key: 'allowTwoConsecutiveLessons',
    label: '2コマ連続',
    description: '連続 2 コマを優先候補に含めます。',
  },
  {
    key: 'requireBreakBetweenLessons',
    label: '一コマ空け',
    description: '授業の間に 1 コマ空ける形を優先します。',
  },
  {
    key: 'connectRegularLessons',
    label: '通常授業連結',
    description: '通常授業と連続する配置を優先候補に含めます。',
  },
  {
    key: 'regularTeachersOnly',
    label: '通常講師のみ',
    description: '通常授業で担当している講師への配置を優先します。',
  },
  {
    key: 'preferLateAfternoon',
    label: '3,4,5限優先',
    description: '3 限から 5 限を先に使う優先順です。',
  },
  {
    key: 'preferSecondPeriod',
    label: '2限寄り(2＞3＞4＞5限の優先順位)',
    description: '2 限から順に近いコマを優先します。',
  },
  {
    key: 'preferFifthPeriod',
    label: '5限寄り(5＞4＞3＞2限の優先順位)',
    description: '5 限から順に近いコマを優先します。',
  },
  {
    key: 'forbidFirstPeriod',
    label: '1限禁止',
    description: '1 限には配置しない前提で候補を並べます。',
  },
]

export const autoAssignTargetGradeOrder: AutoAssignTargetGrade[] = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3']

export const initialAutoAssignRules: AutoAssignRuleRow[] = autoAssignRuleDefinitions.map((definition) => ({
  ...definition,
  targets: [],
  includeStudentIds: [],
  excludeStudentIds: [],
  updatedAt: '',
}))

function getEnrollmentYear(birthYear: number, birthMonth: number, birthDay: number) {
  return birthMonth < 4 || (birthMonth === 4 && birthDay === 1) ? birthYear + 6 : birthYear + 7
}

export function resolveReferenceSchoolYear(referenceDate: string) {
  const date = new Date(`${referenceDate}T00:00:00`)
  const year = date.getFullYear()
  return date >= new Date(year, 3, 1) ? year : year - 1
}

export function resolveStudentGradeLabel(birthDate: string, referenceDate: string): AutoAssignTargetGrade | '' {
  if (!birthDate) return ''

  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if (!birthYear || !birthMonth || !birthDay) return ''

  const schoolYear = resolveReferenceSchoolYear(referenceDate)
  const gradeNumber = schoolYear - getEnrollmentYear(birthYear, birthMonth, birthDay) + 1

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

export function listAutoAssignTargetGrades(students: StudentRow[], referenceDate: string) {
  const gradeSet = new Set<AutoAssignTargetGrade>()

  for (const student of students) {
    if (student.isHidden) continue
    const grade = resolveStudentGradeLabel(student.birthDate, referenceDate)
    if (grade) gradeSet.add(grade)
  }

  return autoAssignTargetGradeOrder.filter((grade) => gradeSet.has(grade))
}

export function createAutoAssignTargetId() {
  return `target_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}