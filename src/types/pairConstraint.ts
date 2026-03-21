export type PairConstraintRow = {
  id: string
  personAType: 'teacher' | 'student'
  personAId: string
  personBType: 'teacher' | 'student'
  personBId: string
  type: 'incompatible'
}

export const initialPairConstraints: PairConstraintRow[] = []

export function createPairConstraintId() {
  return `constraint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}