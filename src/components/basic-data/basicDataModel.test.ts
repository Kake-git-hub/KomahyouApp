import { describe, expect, it } from 'vitest'
import { compareStudentsByCurrentGradeThenName, formatStudentSelectionLabel, isTeacherVisibleInManagement, resolveCurrentStudentGradeLabel, resolveManagementRosterStatusLabel, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from './basicDataModel'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2013-05-01',
    ...overrides,
  }
}

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '山田講師',
    displayName: '山田',
    email: 'teacher@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    ...overrides,
  }
}

describe('basicDataModel student labels and sorting', () => {
  it('formats student selection labels with the school-year grade', () => {
    const student = createStudent({ displayName: '山田太郎', birthDate: '2013-05-01' })

    expect(resolveCurrentStudentGradeLabel(student, '2026-03-27')).toBe('小6')
    expect(formatStudentSelectionLabel(student, '2026-03-27')).toBe('山田太郎 (小6)')
  })

  it('does not advance the grade after the birthday inside the same school year', () => {
    const student = createStudent({ birthDate: '2013-05-01' })

    expect(resolveCurrentStudentGradeLabel(student, '2026-05-08')).toBe('中1')
  })

  it('treats April 1 births in the same school-year group as other April births', () => {
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-a', birthDate: '2012-04-01' }), '2026-05-09')).toBe('中2')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-b', birthDate: '2012-04-02' }), '2026-05-09')).toBe('中2')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-c', birthDate: '2013-04-01' }), '2026-05-09')).toBe('中1')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-d', birthDate: '2013-04-02' }), '2026-05-09')).toBe('中1')
  })

  it('sorts students by smaller current grade first and then by display name', () => {
    const students = [
      createStudent({ id: 'student-1', name: '高橋 花', displayName: '高橋', birthDate: '2009-05-01' }),
      createStudent({ id: 'student-2', name: '青木 太郎', displayName: '青木', birthDate: '2014-05-01' }),
      createStudent({ id: 'student-3', name: '伊藤 次郎', displayName: '伊藤', birthDate: '2014-04-01' }),
    ]

    const sorted = students.slice().sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, '2026-03-27'))

    expect(sorted.map((student) => student.displayName)).toEqual(['伊藤', '青木', '高橋'])
  })

  it('treats upcoming teachers as 入塾前 and hides them from active management views until entry', () => {
    const upcomingTeacher = createTeacher({ entryDate: '2026-05-01' })

    expect(resolveTeacherRosterStatus(upcomingTeacher, '2026-04-21')).toBe('入塾前')
    expect(isTeacherVisibleInManagement(upcomingTeacher, '2026-04-21')).toBe(false)
    expect(resolveManagementRosterStatusLabel(resolveTeacherRosterStatus(upcomingTeacher, '2026-04-21'))).toBe('非在籍')
    expect(resolveManagementRosterStatusLabel('退塾')).toBe('非在籍')
  })

  it('treats future-entry students as 入塾前 while keeping active students with empty or 未定 withdrawDate enrolled', () => {
    const futureEntryEmptyWithdraw = createStudent({ entryDate: '2027-04-01', withdrawDate: '' })
    const pastEntryUndefinedWithdraw = createStudent({ id: 'student-2', entryDate: '2020-04-01', withdrawDate: '未定' })
    const pastEntryEmptyWithdraw = createStudent({ id: 'student-3', entryDate: '2020-04-01', withdrawDate: '' })

    expect(resolveCurrentStudentGradeLabel(futureEntryEmptyWithdraw, '2026-04-22')).toBe('入塾前')
    expect(resolveCurrentStudentGradeLabel(pastEntryUndefinedWithdraw, '2026-04-22')).not.toBe('退塾')
    expect(resolveCurrentStudentGradeLabel(pastEntryEmptyWithdraw, '2026-04-22')).not.toBe('退塾')
  })

  it('高3卒業後(翌4/1以降)は退塾(非在籍)として扱う / 在籍中の高3は高3表示', () => {
    const current3rd = createStudent({ birthDate: '2008-05-01' }) // 2026年度は高3(在籍中)
    const graduated = createStudent({ birthDate: '2006-05-01' }) // 高3卒業済み
    const withdrawnAdult = createStudent({ id: 'student-w', birthDate: '2006-05-01', withdrawDate: '2025-03-31' })

    expect(resolveCurrentStudentGradeLabel(current3rd, '2026-04-22')).toBe('高3')
    expect(resolveCurrentStudentGradeLabel(graduated, '2026-04-22')).toBe('退塾')
    expect(resolveCurrentStudentGradeLabel(withdrawnAdult, '2026-04-22')).toBe('退塾')
  })
})
