import { describe, expect, it } from 'vitest'
import { compareStudentsByCurrentGradeThenName, formatStudentSelectionLabel, resolveCurrentStudentGradeLabel, type StudentRow } from './basicDataModel'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2013-05-01',
    isHidden: false,
    ...overrides,
  }
}

describe('basicDataModel student labels and sorting', () => {
  it('formats student selection labels with the current grade', () => {
    const student = createStudent({ displayName: '山田太郎', birthDate: '2013-05-01' })

    expect(resolveCurrentStudentGradeLabel(student, '2026-03-27')).toBe('中1')
    expect(formatStudentSelectionLabel(student, '2026-03-27')).toBe('山田太郎 (中1)')
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
})