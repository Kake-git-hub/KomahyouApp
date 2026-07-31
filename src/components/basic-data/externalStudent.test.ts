import { describe, expect, it } from 'vitest'
import { isExternalStudentRow, parseExternalStudentFlag, type StudentRow } from './basicDataModel'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: '',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2011-05-01',
    ...overrides,
  }
}

// 外部生フラグ(2026-08-01・オーナー要望)。盤面の授業区分表記を 外) にするための「表示専用」フラグ。
describe('外部生フラグ (StudentRow.isExternal)', () => {
  // 既存データ(isExternal 未設定)は外部生にならない。後方互換の要。
  it('treats students without the flag as internal (backward compatible)', () => {
    expect(isExternalStudentRow(createStudent())).toBe(false)
    expect(isExternalStudentRow(createStudent({ isExternal: false }))).toBe(false)
    expect(isExternalStudentRow(null)).toBe(false)
    expect(isExternalStudentRow(undefined)).toBe(false)
  })

  it('treats students with the flag as external', () => {
    expect(isExternalStudentRow(createStudent({ isExternal: true }))).toBe(true)
  })

  // Excel 取り込み: 空欄は通常生徒。真値表記のゆらぎ(はい/○/1/true)は外部生として受ける。
  describe('parseExternalStudentFlag (Excel 取り込み)', () => {
    it('reads blank cells as internal', () => {
      expect(parseExternalStudentFlag('')).toBe(false)
      expect(parseExternalStudentFlag('   ')).toBe(false)
      expect(parseExternalStudentFlag(undefined)).toBe(false)
      expect(parseExternalStudentFlag(null)).toBe(false)
      expect(parseExternalStudentFlag('いいえ')).toBe(false)
    })

    it('accepts the common truthy spellings', () => {
      for (const value of ['はい', 'TRUE', 'true', '1', 'yes', '○', '〇', '外部生', true]) {
        expect(parseExternalStudentFlag(value)).toBe(true)
      }
    })
  })
})
