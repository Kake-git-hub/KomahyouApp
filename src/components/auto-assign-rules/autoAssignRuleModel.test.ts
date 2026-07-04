import { describe, expect, it } from 'vitest'
import { backfillMissingAutoAssignRules, getAllowedRuleCategories, getDefaultRuleCategory, initialAutoAssignRules, resolveForbiddenPeriods, resolvePeriodPriorityOrder, resolveReferenceSchoolYear, resolveRuleCategory, resolveStudentGradeLabel } from './autoAssignRuleModel'

// spec-auto-assign-rules ⑧TODO3: 指定時限禁止。未設定=[1]、1〜5のみ・昇順ユニーク。
describe('resolveForbiddenPeriods', () => {
  it('defaults to [1] when unset/empty (旧1限禁止)', () => {
    expect(resolveForbiddenPeriods(undefined)).toEqual([1])
    expect(resolveForbiddenPeriods({ forbiddenPeriods: [] })).toEqual([1])
    expect(resolveForbiddenPeriods({ forbiddenPeriods: undefined })).toEqual([1])
  })

  it('normalizes to sorted unique 1-5 and drops out-of-range', () => {
    expect(resolveForbiddenPeriods({ forbiddenPeriods: [3, 1, 3] })).toEqual([1, 3])
    expect(resolveForbiddenPeriods({ forbiddenPeriods: [5, 2, 9, 0] })).toEqual([2, 5])
    expect(resolveForbiddenPeriods({ forbiddenPeriods: [7, 8] })).toEqual([1])
  })
})

// spec-auto-assign-rules ⑧TODO2: 時限優先スライダー。未設定=[5,4,3,2,1]、欠けは既定順で補完し常に1〜5全時限。
describe('resolvePeriodPriorityOrder', () => {
  it('defaults to [5,4,3,2,1] when unset/invalid (旧3,4,5限優先)', () => {
    expect(resolvePeriodPriorityOrder(undefined)).toEqual([5, 4, 3, 2, 1])
    expect(resolvePeriodPriorityOrder({ periodPriorityOrder: undefined })).toEqual([5, 4, 3, 2, 1])
    expect(resolvePeriodPriorityOrder({ periodPriorityOrder: [] })).toEqual([5, 4, 3, 2, 1])
  })

  it('keeps the given order and appends missing periods in default order', () => {
    expect(resolvePeriodPriorityOrder({ periodPriorityOrder: [2, 3] })).toEqual([2, 3, 5, 4, 1])
    expect(resolvePeriodPriorityOrder({ periodPriorityOrder: [1, 2, 3, 4, 5] })).toEqual([1, 2, 3, 4, 5])
  })

  it('drops out-of-range and duplicate periods', () => {
    expect(resolvePeriodPriorityOrder({ periodPriorityOrder: [3, 3, 9, 0, 2] })).toEqual([3, 2, 5, 4, 1])
  })
})

// spec-auto-assign-rules ⑧TODO1/TODO6: 区分許可リスト。
// 制約可＝コマ数上限3種/指定時限禁止/科目対応講師のみ/通常講師のみ の6ルール。
// ★Issue #44 (2026-07-04 B案): diversifySubjects(科目分散)は制約可リストから外し優先のみに戻した。
describe('auto-assign rule category allow-list', () => {
  it('allows constraint only for the 6 hard-capable rules; others are priority-only', () => {
    expect(getAllowedRuleCategories('forbidFirstPeriod')).toEqual(['constraint', 'priority'])
    expect(getAllowedRuleCategories('maxOneLesson')).toEqual(['constraint', 'priority'])
    expect(getAllowedRuleCategories('maxTwoLessons')).toEqual(['constraint', 'priority'])
    expect(getAllowedRuleCategories('maxThreeLessons')).toEqual(['constraint', 'priority'])
    expect(getAllowedRuleCategories('subjectCapableTeachersOnly')).toEqual(['constraint', 'priority'])
    expect(getAllowedRuleCategories('regularTeachersOnly')).toEqual(['constraint', 'priority'])
    // ★Issue #44: 科目分散はもう制約に選べない(優先のみ)。
    expect(getAllowedRuleCategories('diversifySubjects')).toEqual(['priority'])
    expect(getAllowedRuleCategories('preferDateConcentration')).toEqual(['priority'])
    expect(getAllowedRuleCategories('preferLateAfternoon')).toEqual(['priority'])
    expect(getAllowedRuleCategories('preferTwoStudentsPerTeacher')).toEqual(['priority'])
  })

  it('keeps current defaults: 3 forced rules constraint, lesson limits priority', () => {
    expect(getDefaultRuleCategory('forbidFirstPeriod')).toBe('constraint')
    expect(getDefaultRuleCategory('subjectCapableTeachersOnly')).toBe('constraint')
    expect(getDefaultRuleCategory('regularTeachersOnly')).toBe('constraint')
    expect(getDefaultRuleCategory('maxOneLesson')).toBe('priority')
    expect(getDefaultRuleCategory('preferDateConcentration')).toBe('priority')
  })

  it('resolves to set category when allowed, else falls back to default', () => {
    expect(resolveRuleCategory({ key: 'maxOneLesson', category: 'constraint' })).toBe('constraint')
    expect(resolveRuleCategory({ key: 'maxOneLesson', category: undefined })).toBe('priority')
    // 優先専用ルールに constraint を入れても既定(priority)へ丸める
    expect(resolveRuleCategory({ key: 'preferDateConcentration', category: 'constraint' })).toBe('priority')
    // 設定なしは既定
    expect(resolveRuleCategory({ key: 'forbidFirstPeriod', category: undefined })).toBe('constraint')
  })
})

// 科目分散(diversifySubjects): ★Issue #44 (2026-07-04 B案) で制約可リストから外し優先のみに戻した。
// 意図的変更: 以前は 制約/優先 を切替可能だったが、ハードフィルタ化すると隣接コマの科目依存で未消化が
// 量産されるため優先のみへ。旧データで constraint でも resolveRuleCategory が優先へ丸めて解決する(データは壊れない)。
describe('diversifySubjects rule (科目分散)', () => {
  it('is defined and is priority-only (constraint no longer selectable)', () => {
    expect(initialAutoAssignRules.some((rule) => rule.key === 'diversifySubjects')).toBe(true)
    expect(getAllowedRuleCategories('diversifySubjects')).toEqual(['priority'])
    expect(getDefaultRuleCategory('diversifySubjects')).toBe('priority')
    // ★Issue #44: 旧データで category:'constraint' が保存されていても許可外なので優先へ丸まる(回帰防止)。
    expect(resolveRuleCategory({ key: 'diversifySubjects', category: 'constraint' })).toBe('priority')
    expect(resolveRuleCategory({ key: 'diversifySubjects', category: undefined })).toBe('priority')
  })
})

// 新ルール追加より前に保存された教室データにはルール行が無い。読込時に末尾へ補完し、既存行は変えない。
describe('backfillMissingAutoAssignRules', () => {
  it('appends missing rules to the end and keeps existing rows/order untouched', () => {
    const savedRules = initialAutoAssignRules
      .filter((rule) => rule.key !== 'diversifySubjects')
      .map((rule) => ({ ...rule, updatedAt: '2026-01-01 00:00' }))

    const backfilled = backfillMissingAutoAssignRules(savedRules)
    expect(backfilled.slice(0, savedRules.length)).toEqual(savedRules)
    expect(backfilled[backfilled.length - 1]?.key).toBe('diversifySubjects')
    expect(backfilled[backfilled.length - 1]?.targets).toEqual([])
  })

  it('returns the array as-is when nothing is missing', () => {
    const completeRules = initialAutoAssignRules.map((rule) => ({ ...rule }))
    expect(backfillMissingAutoAssignRules(completeRules)).toBe(completeRules)
  })
})

describe('autoAssignRuleModel grade resolution', () => {
  it('switches school year on April 1', () => {
    expect(resolveReferenceSchoolYear('2026-03-31')).toBe(2025)
    expect(resolveReferenceSchoolYear('2026-04-01')).toBe(2026)
  })

  it('treats April 1 births in the same cohort as other April births', () => {
    expect(resolveStudentGradeLabel('2013-04-01', '2026-03-31')).toBe('小6')
    expect(resolveStudentGradeLabel('2013-04-01', '2026-04-01')).toBe('中1')
    expect(resolveStudentGradeLabel('2013-04-02', '2026-04-01')).toBe('中1')
    expect(resolveStudentGradeLabel('2012-04-01', '2026-04-01')).toBe('中2')
    expect(resolveStudentGradeLabel('2012-04-02', '2026-04-01')).toBe('中2')
  })
})