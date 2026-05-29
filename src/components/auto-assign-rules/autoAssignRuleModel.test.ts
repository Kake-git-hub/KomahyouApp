import { describe, expect, it } from 'vitest'
import { resolveReferenceSchoolYear, resolveStudentGradeLabel } from './autoAssignRuleModel'

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