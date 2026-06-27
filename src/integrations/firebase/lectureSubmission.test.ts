import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markLectureSubmissionDocAsSubmitted, subscribeLectureSubmissions, updateSubmissionOccupiedSlots, type SubmissionChangeEntry } from './lectureSubmission'

const existingData = vi.fn()
const setDoc = vi.fn()
let onSnapshotCallback: ((snapshot: unknown) => void) | null = null

vi.mock('./client', () => ({
  getFirebaseFirestoreInstance: () => ({}),
}))

vi.mock('./config', () => ({
  getFirebaseBackendConfig: () => ({ workspaceKey: 'main' }),
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collectionName: string, token: string) => ({ token }),
  collection: () => ({}),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  getDoc: vi.fn(async () => ({
    exists: () => true,
    data: existingData,
  })),
  setDoc: (...args: unknown[]) => setDoc(...args),
  deleteDoc: vi.fn(),
  onSnapshot: (_query: unknown, callback: (snapshot: unknown) => void) => {
    onSnapshotCallback = callback
    return () => {}
  },
}))

describe('updateSubmissionOccupiedSlots', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
    onSnapshotCallback = null
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

  // B3 回帰防止: 後から休日を設定/解除した場合に、既発行トークンへ holidayDates を伝播する。
  it('propagates holidayDates to existing tokens when provided', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      occupiedSlots: {},
      holidayDates: ['2026-08-10'],
    })

    await updateSubmissionOccupiedSlots([{
      token: 'student-token',
      occupiedSlots: {},
      holidayDates: ['2026-08-10', '2026-08-15'],
    }])

    expect(setDoc).toHaveBeenCalledWith(
      { token: 'student-token' },
      expect.objectContaining({ holidayDates: ['2026-08-10', '2026-08-15'] }),
    )
  })

  // 後方互換: holidayDates を渡さない呼び出しでは既存値を書き換えない(キーを追加しない)。
  it('does not overwrite holidayDates when omitted', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      occupiedSlots: {},
      holidayDates: ['2026-08-10'],
    })

    await updateSubmissionOccupiedSlots([{
      token: 'student-token',
      occupiedSlots: { '2026-08-31_1': '通常' },
    }])

    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.holidayDates).toEqual(['2026-08-10']) // 既存値(spread)が維持される
  })
})

// spec-group-lesson §C 回帰防止: 室長が生徒日程表の「登録」で決めた集団参加/オプションを
// 提出ドキュメントへ書き戻す。書き戻さないと doc が空のままになり、購読の反映(doc→ローカル)が
// 室長の手動設定を空で上書きして消す(生徒日程表で集団に入れても最新表示/再読込で消える回帰)。
describe('markLectureSubmissionDocAsSubmitted (室長登録の集団参加を doc へ書き戻す)', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
  })

  it('集団参加/オプションを提出ドキュメントに書き戻してロックする', async () => {
    existingData.mockReturnValue({
      status: 'pending',
      groupClassParticipation: {},
      optionChecks: {},
      availableGroupClassSubjects: ['集団理科', '集団社会'],
    })

    await markLectureSubmissionDocAsSubmitted('student-token', {
      groupClassParticipation: { 集団理科: true },
      optionChecks: { '0': true },
    })

    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.status).toBe('submitted')
    expect(writtenDoc.submittedAt).toEqual(expect.any(String))
    expect(writtenDoc.groupClassParticipation).toEqual({ 集団理科: true })
    expect(writtenDoc.optionChecks).toEqual({ '0': true })
  })

  it('フィールド未指定なら既存値を保全する(講師経路など後方互換)', async () => {
    existingData.mockReturnValue({
      status: 'pending',
      groupClassParticipation: { 集団社会: true },
      optionChecks: { '1': true },
    })

    await markLectureSubmissionDocAsSubmitted('teacher-token')

    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.status).toBe('submitted')
    expect(writtenDoc.groupClassParticipation).toEqual({ 集団社会: true })
    expect(writtenDoc.optionChecks).toEqual({ '1': true })
  })

  it('既に提出済みなら何も書き込まない(再提出ロック)', async () => {
    existingData.mockReturnValue({ status: 'submitted', groupClassParticipation: {} })

    await markLectureSubmissionDocAsSubmitted('student-token', { groupClassParticipation: { 集団理科: true } })

    expect(setDoc).not.toHaveBeenCalled()
  })
})

// B3 回帰防止: 購読直後の初回スナップショットは isInitial=true で配信し、
// 起動/教室切替の直後に過去の提出を「新着」通知しないようにする。
describe('subscribeLectureSubmissions initial-snapshot flag', () => {
  beforeEach(() => {
    onSnapshotCallback = null
  })

  function fakeSnapshot(tokens: string[]) {
    return {
      docChanges: () => tokens.map((token) => ({
        type: 'added' as const,
        doc: {
          id: token,
          data: () => ({
            sessionId: 's1',
            personType: 'student' as const,
            personId: 'p1',
            unavailableSlots: [],
            subjectSlots: {},
            subjectDurations: {},
            regularOnly: false,
          }),
        },
      })),
    }
  }

  it('marks the first snapshot as initial and subsequent ones as not initial', () => {
    const calls: Array<{ entries: SubmissionChangeEntry[]; isInitial: boolean }> = []
    subscribeLectureSubmissions('classroom-1', (entries, isInitial) => {
      calls.push({ entries, isInitial })
    })
    expect(onSnapshotCallback).toBeTypeOf('function')

    onSnapshotCallback?.(fakeSnapshot(['token-a']))
    onSnapshotCallback?.(fakeSnapshot(['token-b']))

    expect(calls).toHaveLength(2)
    expect(calls[0].isInitial).toBe(true)
    expect(calls[0].entries.map((entry) => entry.token)).toEqual(['token-a'])
    expect(calls[1].isInitial).toBe(false)
    expect(calls[1].entries.map((entry) => entry.token)).toEqual(['token-b'])
  })
})
