import { describe, expect, it } from 'vitest'
import { resolveForbiddenPeriods, resolveReferenceSchoolYear, resolveStudentGradeLabel } from './autoAssignRuleModel'

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