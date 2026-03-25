import { describe, expect, it } from 'vitest'
import { resolveDisplayedSubjectForBirthDate, resolveDisplayedSubjectForGrade, resolveGradeLabelFromBirthDate } from './studentGradeSubject'

describe('studentGradeSubject', () => {
  it('resolves school grade from birth date and reference date', () => {
    expect(resolveGradeLabelFromBirthDate('2015-05-10', '2026-03-25')).toBe('小4')
    expect(resolveGradeLabelFromBirthDate('2012-05-10', '2026-03-25')).toBe('中1')
  })

  it('maps math display subject to 算 for elementary grades', () => {
    expect(resolveDisplayedSubjectForGrade('数', '小4')).toBe('算')
    expect(resolveDisplayedSubjectForBirthDate('数', '2015-05-10', '2026-03-25')).toBe('算')
  })

  it('maps math display subject to 数 for middle and high grades', () => {
    expect(resolveDisplayedSubjectForGrade('算', '中1')).toBe('数')
    expect(resolveDisplayedSubjectForBirthDate('算', '2012-05-10', '2026-03-25')).toBe('数')
  })
})