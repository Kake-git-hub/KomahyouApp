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

  it('uses the April 1 to next March 31 school-year grouping', () => {
    expect(resolveGradeLabelFromBirthDate('2012-04-01', '2026-05-09')).toBe('中2')
    expect(resolveGradeLabelFromBirthDate('2012-04-02', '2026-05-09')).toBe('中2')
    expect(resolveGradeLabelFromBirthDate('2013-04-01', '2026-05-09')).toBe('中1')
    expect(resolveGradeLabelFromBirthDate('2013-04-02', '2026-05-09')).toBe('中1')
  })

  it('advances grades on the April 1 school-year boundary, not on birthdays inside the year', () => {
    expect(resolveGradeLabelFromBirthDate('2013-04-01', '2026-03-31')).toBe('小6')
    expect(resolveGradeLabelFromBirthDate('2013-04-01', '2026-04-01')).toBe('中1')
    expect(resolveGradeLabelFromBirthDate('2012-04-02', '2026-03-31')).toBe('中1')
    expect(resolveGradeLabelFromBirthDate('2012-04-02', '2026-04-01')).toBe('中2')
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

  it('returns 算国 and 理社 only for elementary selectable subjects', () => {
    expect(getSelectableStudentSubjectsForGrade('小4')).toEqual(['算', '算国', '英', '国', '理', '社', '理社'])
    expect(getSelectableStudentSubjectsForGrade('中1')).toEqual(['数', '英', '国', '理', '社'])
    expect(getSelectableStudentSubjectsForGrade('高1')).toEqual(['数', '英', '国', '生', '物', '化', '社'])
    // 理社は算国と同じく小学限定の合体科目。中高の選択肢には出さない。
    expect(getSelectableStudentSubjectsForGrade('中1')).not.toContain('理社')
    expect(getSelectableStudentSubjectsForGrade('高1')).not.toContain('理社')
  })

  it('keeps 理社 displayed as-is (合体科目・学年不問の表示)', () => {
    expect(resolveDisplayedSubjectForGrade('理社', '小4')).toBe('理社')
    expect(resolveDisplayedSubjectForBirthDate('理社', '2015-05-10', '2026-03-25')).toBe('理社')
  })

  it('keeps 理社 for elementary but folds it to 理 for non-elementary requests', () => {
    expect(normalizeRequestedSubjectForGrade('理社', '小4')).toBe('理社')
    expect(normalizeRequestedSubjectForBirthDate('理社', '2015-05-10', '2026-03-25')).toBe('理社')
    expect(normalizeRequestedSubjectForGrade('理社', '中1')).toBe('理')
    expect(normalizeRequestedSubjectForBirthDate('理社', '2012-05-10', '2026-04-10')).toBe('理')
  })
})