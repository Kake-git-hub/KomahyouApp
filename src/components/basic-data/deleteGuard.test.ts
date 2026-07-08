import { describe, expect, it } from 'vitest'
import {
  buildDeleteConfirmation,
  deriveStudentDeletionStockSummary,
  DELETE_HIDE_ALTERNATIVE_HINT,
  DELETE_IRREVERSIBLE_WARNING,
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
  it('always includes the irreversible warning and the 退塾日 hide hint', () => {
    const confirmation = buildDeleteConfirmation({ scope: 'student', name: '富樫應佑', requiresPassword: false })
    expect(confirmation.irreversibleWarning).toBe(DELETE_IRREVERSIBLE_WARNING)
    expect(confirmation.hideHint).toBe(DELETE_HIDE_ALTERNATIVE_HINT)
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
