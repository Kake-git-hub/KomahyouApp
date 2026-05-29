import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateSubmissionOccupiedSlots } from './lectureSubmission'

const existingData = vi.fn()
const setDoc = vi.fn()

vi.mock('./client', () => ({
  getFirebaseFirestoreInstance: () => ({}),
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collectionName: string, token: string) => ({ token }),
  getDoc: vi.fn(async () => ({
    exists: () => true,
    data: existingData,
  })),
  setDoc: (...args: unknown[]) => setDoc(...args),
}))

describe('updateSubmissionOccupiedSlots', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
  })

  it('refreshes occupied slots even after a submission is locked as submitted', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      unavailableSlots: ['2026-08-24_3'],
      occupiedSlots: { '2026-08-24_3': '通常' },
      slotNumbers: [1, 2, 3],
      slotCount: 3,
    })

    await updateSubmissionOccupiedSlots([{
      token: 'teacher-token',
      occupiedSlots: { '2026-08-31_4': '通常' },
      slotNumbers: [1, 2, 3, 4],
    }])

    expect(setDoc).toHaveBeenCalledWith(
      { token: 'teacher-token' },
      {
        status: 'submitted',
        unavailableSlots: ['2026-08-24_3'],
        occupiedSlots: { '2026-08-31_4': '通常' },
        slotNumbers: [1, 2, 3, 4],
        slotCount: 4,
      },
    )
  })
})
