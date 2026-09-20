import { describe, expect, it } from 'vitest'
import {
  buildDeleteConfirmation,
  deriveStudentDeletionStockSummary,
  DELETE_HIDE_ALTERNATIVE_HINT,
  DELETE_IRREVERSIBLE_WARNING,
  STUDENT_DELETE_APP_ONLY_WARNING,
} from './deleteGuard'

describe('deriveStudentDeletionStockSummary', () => {
  it('sums lecture and makeup remaining per managed student id', () => {
    const summary = deriveStudentDeletionStockSummary(
      [{ studentId: 's091', requestedCount: 45 }, { studentId: 's129', requestedCount: 5 }],
      [{ studentId: 's091', balance: 2 }],
    )
    expect(summary.s091).toEqual({ lecture: 45, makeup: 2 })
    expect(summary.s129).toEqual({ lecture: 5, makeup: 0 })
  })

  it('ignores non-managed keys (studentId=null) and non-positive amounts', () => {
    const summary = deriveStudentDeletionStockSummary(
      [{ studentId: null, requestedCount: 3 }, { studentId: 's001', requestedCount: 0 }],
      [{ studentId: null, balance: 4 }, { studentId: 's002', balance: -1 }],
    )
    expect(summary).toEqual({})
  })
})

describe('buildDeleteConfirmation', () => {
  it('講師は不可逆警告と退塾日の案内を出す', () => {
    const confirmation = buildDeleteConfirmation({ scope: 'teacher', name: '山田先生', requiresPassword: false })
    expect(confirmation.irreversibleWarning).toBe(DELETE_IRREVERSIBLE_WARNING)
    expect(confirmation.hideHint).toBe(DELETE_HIDE_ALTERNATIVE_HINT)
    expect(confirmation.title).toContain('山田先生')
  })

  it('生徒(退塾生徒一覧からの削除)は「データ上から削除・元に戻せない」警告で、退塾日の案内は出さない(2026-09-13 / 09-20 夜 改定)', () => {
    const confirmation = buildDeleteConfirmation({ scope: 'student', name: '富樫應佑', requiresPassword: false })
    expect(confirmation.irreversibleWarning).toBe(STUDENT_DELETE_APP_ONLY_WARNING)
    // 2026-09-20 夜(オーナー確定): 退塾後は編集できず残る操作は削除だけ。先頭で不可逆をはっきり伝える。
    expect(confirmation.irreversibleWarning).toContain('この生徒をデータ上から削除します。元に戻せません')
    expect(confirmation.irreversibleWarning).toContain('過去の記録と削除日時だけがデータに残ります')
    expect(confirmation.hideHint).toBe('')
    expect(confirmation.title).toContain('富樫應佑')
  })

  it('warns about remaining lecture stock only (no 振替 mention when makeup=0)', () => {
    const confirmation = buildDeleteConfirmation({
      scope: 'student',
      name: '富樫應佑',
      stock: { lecture: 45, makeup: 0 },
      requiresPassword: true,
    })
    expect(confirmation.stockWarning).toContain('未消化の講習 45 件')
    expect(confirmation.stockWarning).not.toContain('振替')
    expect(confirmation.requiresPassword).toBe(true)
  })

  it('mentions both lecture and makeup when both remain', () => {
    const confirmation = buildDeleteConfirmation({
      scope: 'student',
      name: '生徒A',
      stock: { lecture: 3, makeup: 2 },
      requiresPassword: false,
    })
    expect(confirmation.stockWarning).toContain('未消化の講習 3 件')
    expect(confirmation.stockWarning).toContain('未消化の振替 2 件')
  })

  it('has no stock warning when the student has no remaining stock', () => {
    const confirmation = buildDeleteConfirmation({
      scope: 'student',
      name: '生徒B',
      stock: { lecture: 0, makeup: 0 },
      requiresPassword: false,
    })
    expect(confirmation.stockWarning).toBeNull()
  })

  it('never shows a stock warning for teachers even if stock is passed', () => {
    const confirmation = buildDeleteConfirmation({
      scope: 'teacher',
      name: '山田先生',
      stock: { lecture: 9, makeup: 9 },
      requiresPassword: true,
    })
    expect(confirmation.stockWarning).toBeNull()
  })

  it('falls back to a generic name when name is blank', () => {
    expect(buildDeleteConfirmation({ scope: 'student', name: '   ', requiresPassword: false }).title).toBe('この生徒 を削除します')
    expect(buildDeleteConfirmation({ scope: 'teacher', name: '', requiresPassword: false }).title).toBe('この講師 を削除します')
  })
})
