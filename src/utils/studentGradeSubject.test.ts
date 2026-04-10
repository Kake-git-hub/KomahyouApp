import { describe, expect, it } from 'vitest'
import {
  getSelectableStudentSubjectsForGrade,
  normalizeRequestedSubjectForBirthDate,
  normalizeRequestedSubjectForGrade,
  resolveDisplayedSubjectForBirthDate,
  resolveDisplayedSubjectForGrade,
  resolveGradeLabelFromBirthDate,
} from './studentGradeSubject'

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

  it('keeps 算国 displayed as-is', () => {
    expect(resolveDisplayedSubjectForGrade('算国', '小4')).toBe('算国')
    expect(resolveDisplayedSubjectForBirthDate('算国', '2012-05-10', '2026-03-25')).toBe('算国')
  })

  it('normalizes legacy elementary requested subjects for middle school students', () => {
    expect(normalizeRequestedSubjectForGrade('算', '中1')).toBe('数')
    expect(normalizeRequestedSubjectForGrade('算国', '中1')).toBe('数')
    expect(normalizeRequestedSubjectForBirthDate('算国', '2012-05-10', '2026-04-10')).toBe('数')
  })

  it('keeps elementary requested subjects for elementary students', () => {
    expect(normalizeRequestedSubjectForGrade('算', '小4')).toBe('算')
    expect(normalizeRequestedSubjectForGrade('算国', '小4')).toBe('算国')
    expect(normalizeRequestedSubjectForBirthDate('算国', '2015-05-10', '2026-03-25')).toBe('算国')
  })

  it('returns 算国 only for elementary selectable subjects', () => {
    expect(getSelectableStudentSubjectsForGrade('小4')).toEqual(['算', '算国', '英', '国', '理', '社'])
    expect(getSelectableStudentSubjectsForGrade('中1')).toEqual(['数', '英', '国', '理', '社'])
    expect(getSelectableStudentSubjectsForGrade('高1')).toEqual(['数', '英', '国', '生', '物', '化', '社'])
  })
})