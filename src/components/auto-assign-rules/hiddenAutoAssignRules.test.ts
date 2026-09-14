import * as xlsx from 'xlsx'
import { describe, expect, it } from 'vitest'
import { isAutoAssignRuleApplicable } from '../schedule-board/ScheduleBoardScreen'
import { buildAutoAssignWorkbook } from './AutoAssignRuleScreen'
import { initialAutoAssignRules, isHiddenAutoAssignRule, type AutoAssignRuleRow } from './autoAssignRuleModel'

// オーナー指示 2026-09-14: 「登校日集約/分散」は分かりづらいため画面から外し、割振でも効かせない。
function withAllTarget(rule: AutoAssignRuleRow): AutoAssignRuleRow {
  return { ...rule, targets: [{ id: 't1', type: 'all' }] }
}

describe('非表示ルール（登校日集約/分散）', () => {
  it('登校日集約/分散だけが非表示', () => {
    expect(isHiddenAutoAssignRule('preferDateConcentration')).toBe(true)
    expect(isHiddenAutoAssignRule('preferNextDayOrLater')).toBe(true)
    const visible = initialAutoAssignRules.filter((rule) => !isHiddenAutoAssignRule(rule.key)).map((rule) => rule.key)
    expect(visible).toContain('preferTwoStudentsPerTeacher')
    expect(visible).toContain('diversifySubjects')
    expect(visible).toHaveLength(initialAutoAssignRules.length - 2)
  })

  it('対象「全員」が保存済みでも自動割振では適用しない（他ルールは従来どおり適用）', () => {
    const byKey = new Map(initialAutoAssignRules.map((rule) => [rule.key, withAllTarget(rule)]))
    expect(isAutoAssignRuleApplicable(byKey.get('preferDateConcentration'), 's001', '中1')).toBe(false)
    expect(isAutoAssignRuleApplicable(byKey.get('preferNextDayOrLater'), 's001', '中1')).toBe(false)
    expect(isAutoAssignRuleApplicable(byKey.get('preferTwoStudentsPerTeacher'), 's001', '中1')).toBe(true)
  })

  it('Excel 出力に非表示ルールを含めない', () => {
    const rules = initialAutoAssignRules.map(withAllTarget)
    const workbook = buildAutoAssignWorkbook(xlsx, rules, [], {}, {})
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['ルール'])
    const keys = rows.map((row) => row['ルールキー'])
    expect(keys).not.toContain('preferDateConcentration')
    expect(keys).not.toContain('preferNextDayOrLater')
    expect(keys).toContain('preferTwoStudentsPerTeacher')
  })
})
