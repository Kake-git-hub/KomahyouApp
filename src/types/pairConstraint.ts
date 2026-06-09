// spec-auto-assign-rules §E / ⑧TODO5: ペア制約の区分は 優先/制約 の2区分（既定=制約事項）。
export type PairConstraintCategory = 'priority' | 'constraint'

export type PairConstraintRow = {
  id: string
  personAType: 'teacher' | 'student'
  personAId: string
  personBType: 'teacher' | 'student'
  personBId: string
  type: 'incompatible'
  // 区分。未設定(旧データ)は既定の 'constraint'（必ず守る）として扱う。
  category?: PairConstraintCategory
}

export const initialPairConstraints: PairConstraintRow[] = []

export function createPairConstraintId() {
  return `constraint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

// 旧データ後方互換: category 未設定は 'constraint' を既定とする。
export function resolvePairConstraintCategory(row: Pick<PairConstraintRow, 'category'> | null | undefined): PairConstraintCategory {
  return row?.category === 'priority' ? 'priority' : 'constraint'
}
