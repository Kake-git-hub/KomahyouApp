import { resolveEnrollmentYearFromBirthDateParts } from '../../utils/studentGradeSubject'
import type { StudentRow } from '../basic-data/basicDataModel'

export type AutoAssignRuleKey =
  | 'preferDateConcentration'
  | 'preferNextDayOrLater'
  | 'preferTwoStudentsPerTeacher'
  | 'maxOneLesson'
  | 'maxTwoLessons'
  | 'maxThreeLessons'
  | 'allowTwoConsecutiveLessons'
  | 'requireBreakBetweenLessons'
  | 'connectRegularLessons'
  | 'subjectCapableTeachersOnly'
  | 'regularTeachersOnly'
  | 'preferLateAfternoon'
  // ⑧TODO2 で「時限優先」1ルール(preferLateAfternoon + periodPriorityOrder)へ統合済。
  // 旧スナップショット互換のため型は残すが、定義/UI/アルゴリズムでは使わない（対象なし運用）。
  | 'preferSecondPeriod'
  | 'preferFifthPeriod'
  | 'forbidFirstPeriod'
  | 'diversifySubjects'

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

// spec-auto-assign-rules ⑧TODO1/TODO6: 区分（優先事項／制約事項）。区分は2値のまま。
// 既定の固定「絶対事項」3つ（既存コマ不変／出席可能コマのみ／期間内割振）はユーザールールとは別データの
// 表示専用ハードコードで、この category とは別枠（§B）。「絶対事項」区分の新設はしない（A案廃案）。
export type AutoAssignRuleCategory = 'priority' | 'constraint'

// 制約事項にも選べるルール（ハードフィルタとして意味が成立する6ルール）。それ以外は優先事項のみ。
// spec-auto-assign-rules §B/TODO6（2026-07-04 B案・オーナー確定）：制約事項はハードフィルタ化した。
// diversifySubjects（科目分散）はハード化すると隣接コマの科目依存で「置ける候補が無い」が続発し未消化が量産
// されるため、制約可リストから外し優先のみに戻した（旧データで constraint でも resolveRuleCategory が優先へ丸める）。
const constraintCapableRuleKeys = new Set<AutoAssignRuleKey>([
  'maxOneLesson',
  'maxTwoLessons',
  'maxThreeLessons',
  'subjectCapableTeachersOnly',
  'regularTeachersOnly',
  'forbidFirstPeriod',
])
// 既定で制約事項として扱うルール（現状の forcedRuleKeys を踏襲）。
const defaultConstraintRuleKeys = new Set<AutoAssignRuleKey>([
  'subjectCapableTeachersOnly',
  'regularTeachersOnly',
  'forbidFirstPeriod',
])

// ルールごとに選べる区分（許可リスト）。成立しない組合せ（優先専用ルールを制約に）を作れないようにする。
export function getAllowedRuleCategories(key: AutoAssignRuleKey): AutoAssignRuleCategory[] {
  return constraintCapableRuleKeys.has(key) ? ['constraint', 'priority'] : ['priority']
}

// ルールの既定区分。
export function getDefaultRuleCategory(key: AutoAssignRuleKey): AutoAssignRuleCategory {
  return defaultConstraintRuleKeys.has(key) ? 'constraint' : 'priority'
}

// ルールの区分を解決。未設定/許可外は既定区分に丸める。
export function resolveRuleCategory(rule: Pick<AutoAssignRuleRow, 'key' | 'category'> | null | undefined): AutoAssignRuleCategory {
  if (!rule) return 'priority'
  const allowed = getAllowedRuleCategories(rule.key)
  if (rule.category && allowed.includes(rule.category)) return rule.category
  return getDefaultRuleCategory(rule.key)
}

export type AutoAssignTargetOrigin = 'manual' | 'group-conflict'

export type AutoAssignTarget =
  | { id: string; type: 'all'; origin?: AutoAssignTargetOrigin; sourceRuleKey?: AutoAssignRuleKey }
  | { id: string; type: 'grade'; grade: AutoAssignTargetGrade; origin?: AutoAssignTargetOrigin; sourceRuleKey?: AutoAssignRuleKey }
  | { id: string; type: 'students'; studentIds: string[]; origin?: AutoAssignTargetOrigin; sourceRuleKey?: AutoAssignRuleKey }

export type AutoAssignRuleRow = {
  key: AutoAssignRuleKey
  label: string
  description: string
  targets: AutoAssignTarget[]
  excludeTargets: AutoAssignTarget[]
  priorityScore: number
  // spec-auto-assign-rules ⑧TODO1: 区分（優先事項／制約事項）。未設定は getDefaultRuleCategory で補完。
  category?: AutoAssignRuleCategory
  includeStudentIds?: string[]
  excludeStudentIds?: string[]
  // spec-auto-assign-rules ⑧TODO3: 指定時限禁止（forbidFirstPeriod を一般化）。禁止する時限(1〜5)。
  // 未設定は [1]（旧「1限禁止」）として扱う。
  forbiddenPeriods?: number[]
  // spec-auto-assign-rules ⑧TODO2: 時限優先（preferLateAfternoon を一般化）。優先する時限の並び順。
  // index0 が最優先。未設定は [5,4,3,2,1]（旧「3,4,5限優先」）として扱う。
  periodPriorityOrder?: number[]
  updatedAt: string
}

// 自動割振で扱う時限の範囲（1〜5限）。
export const autoAssignPeriodOptions = [1, 2, 3, 4, 5] as const

// 指定時限禁止の禁止時限を解決。未設定/空は既定 [1]（旧1限禁止）。1〜5のみ・昇順ユニーク。
export function resolveForbiddenPeriods(rule: Pick<AutoAssignRuleRow, 'forbiddenPeriods'> | null | undefined): number[] {
  const raw = rule?.forbiddenPeriods
  if (!Array.isArray(raw) || raw.length === 0) return [1]
  const normalized = Array.from(new Set(raw.filter((period) => autoAssignPeriodOptions.includes(period as (typeof autoAssignPeriodOptions)[number]))))
    .sort((left, right) => left - right)
  return normalized.length > 0 ? normalized : [1]
}

// 時限優先のスライダー順を解決。index0 が最優先。未設定/不正は既定 [5,4,3,2,1]（旧「3,4,5限優先」）。
// 与えられた並びを尊重しつつ、欠けている時限を既定順で末尾に補い、常に 1〜5 の全時限を含む並びに正規化する。
export function resolvePeriodPriorityOrder(rule: Pick<AutoAssignRuleRow, 'periodPriorityOrder'> | null | undefined): number[] {
  const fallback = [5, 4, 3, 2, 1]
  const raw = rule?.periodPriorityOrder
  const ordered: number[] = []
  if (Array.isArray(raw)) {
    for (const period of raw) {
      if (autoAssignPeriodOptions.includes(period as (typeof autoAssignPeriodOptions)[number]) && !ordered.includes(period)) {
        ordered.push(period)
      }
    }
  }
  for (const period of fallback) {
    if (!ordered.includes(period)) ordered.push(period)
  }
  return ordered
}

export const autoAssignRuleDefinitions: Array<Pick<AutoAssignRuleRow, 'key' | 'label' | 'description'>> = [
  {
    key: 'preferDateConcentration',
    label: '登校日集約',
    description: '同じ日に複数コマをまとめつつ、登校日どうしは期間内でほどよく間隔が空く候補を優先します。',
  },
  {
    key: 'preferNextDayOrLater',
    label: '登校日分散',
    description: '同じ日にまとめるより、別日の登校へ分散できる候補を優先します。',
  },
  {
    key: 'preferTwoStudentsPerTeacher',
    label: '講師1人に生徒2人配置',
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
    label: '通常連結2コマ',
    description: '通常授業と連続する配置を優先候補に含めます。',
  },
  {
    key: 'subjectCapableTeachersOnly',
    label: '科目対応講師のみ',
    description: '講師の科目担当に収まる生徒だけを配置候補にします。',
  },
  {
    key: 'regularTeachersOnly',
    label: '通常講師のみ',
    description: '割振りを通常授業で担当している講師だけに制限します。',
  },
  {
    key: 'preferLateAfternoon',
    label: '時限優先',
    description: '優先する時限の順番を 1〜5 限で並べ替えて、上にある時限から先に使うよう優先します。',
  },
  {
    key: 'forbidFirstPeriod',
    label: '指定時限禁止',
    description: '対象者を、指定した時限（既定は1限）に配置しないよう制限します。',
  },
  {
    key: 'diversifySubjects',
    label: '科目分散',
    description: '通常・講習を問わず、同じ日の隣り合うコマが同じ科目にならないよう分散します。',
  },
]

export const autoAssignTargetGradeOrder: AutoAssignTargetGrade[] = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3']

export const initialAutoAssignRules: AutoAssignRuleRow[] = autoAssignRuleDefinitions.map((definition) => ({
  ...definition,
  targets: [],
  excludeTargets: [],
  priorityScore: 3,
  category: getDefaultRuleCategory(definition.key),
  includeStudentIds: [],
  excludeStudentIds: [],
  updatedAt: '',
}))

// 新ルール追加(例: 科目分散)より前に保存された教室データには、そのルール行が存在しない。
// 読込時に不足分を定義から末尾(=優先順位最下位)へ補完し、UI表示・優先順位付け・割振評価の対象にする。
// 既存行はそのまま維持する(並び順・対象・区分を変えない)。不足がなければ元配列をそのまま返す。
export function backfillMissingAutoAssignRules(rules: AutoAssignRuleRow[]): AutoAssignRuleRow[] {
  const existingKeys = new Set(rules.map((rule) => rule.key))
  const missingRules = initialAutoAssignRules.filter((rule) => !existingKeys.has(rule.key))
  if (missingRules.length === 0) return rules
  return [...rules, ...missingRules.map((rule) => ({ ...rule }))]
}

function getEnrollmentYear(birthYear: number, birthMonth: number) {
  return resolveEnrollmentYearFromBirthDateParts(birthYear, birthMonth)
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
  const gradeNumber = schoolYear - getEnrollmentYear(birthYear, birthMonth) + 1

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
    const grade = resolveStudentGradeLabel(student.birthDate, referenceDate)
    if (grade) gradeSet.add(grade)
  }

  return autoAssignTargetGradeOrder.filter((grade) => gradeSet.has(grade))
}

export function createAutoAssignTargetId() {
  return `target_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}