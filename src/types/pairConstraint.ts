export type PairConstraintRow = {
  id: string
  personAType: 'teacher' | 'student'
  personAId: string
  personBType: 'teacher' | 'student'
  personBId: string
  type: 'incompatible'
}

export const initialPairConstraints: PairConstraintRow[] = [
  { id: 'c001', personAType: 'teacher', personAId: 't001', personBType: 'student', personBId: 's002', type: 'incompatible' },
  { id: 'c002', personAType: 'teacher', personAId: 't004', personBType: 'student', personBId: 's007', type: 'incompatible' },
  { id: 'c003', personAType: 'student', personAId: 's010', personBType: 'student', personBId: 's011', type: 'incompatible' },
  { id: 'c004', personAType: 'teacher', personAId: 't008', personBType: 'student', personBId: 's024', type: 'incompatible' },
]

export function createPairConstraintId() {
  return `constraint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}