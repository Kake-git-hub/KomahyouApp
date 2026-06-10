import { describe, expect, it } from 'vitest'
import { resolvePairConstraintCategory } from './pairConstraint'

// spec-auto-assign-rules §E / ⑧TODO5: 既定=制約事項。旧データ(category未設定)も制約扱い。
describe('resolvePairConstraintCategory', () => {
  it('defaults to constraint when unset (backward compatible)', () => {
    expect(resolvePairConstraintCategory(undefined)).toBe('constraint')
    expect(resolvePairConstraintCategory(null)).toBe('constraint')
    expect(resolvePairConstraintCategory({})).toBe('constraint')
    expect(resolvePairConstraintCategory({ category: undefined })).toBe('constraint')
  })

  it('returns priority only when explicitly set', () => {
    expect(resolvePairConstraintCategory({ category: 'priority' })).toBe('priority')
    expect(resolvePairConstraintCategory({ category: 'constraint' })).toBe('constraint')
  })
})
