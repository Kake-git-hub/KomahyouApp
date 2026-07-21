import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecentlyResetGuard, guardAndResetLectureSubmissionDoc, markLectureSubmissionDocAsSubmitted, markLectureSubmissionsNotified, resetLectureSubmissionDoc, subscribeLectureSubmissions, updateSubmissionOccupiedSlots, updateSubmissionReopenedSlots, type SubmissionChangeEntry } from './lectureSubmission'

const existingData = vi.fn()
const setDoc = vi.fn()
const updateDoc = vi.fn()
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
  updateDoc: (...args: unknown[]) => updateDoc(...args),
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

  // 回帰防止: 後から追加した科目(理社など)が、既発行トークンの提出画面に出ない不具合の是正。
  // availableSubjects は発行時に凍結されるため、既存トークンにも同期して伝播する必要がある。
  it('propagates availableSubjects to existing tokens when provided', async () => {
    existingData.mockReturnValue({
      status: 'pending',
      occupiedSlots: {},
      availableSubjects: ['算', '算国', '英', '国', '理', '社'], // 理社 追加前の古い凍結値
    })

    await updateSubmissionOccupiedSlots([{
      token: 'student-token',
      occupiedSlots: {},
      availableSubjects: ['算', '算国', '英', '国', '理', '社', '理社'],
    }])

    expect(setDoc).toHaveBeenCalledWith(
      { token: 'student-token' },
      expect.objectContaining({ availableSubjects: ['算', '算国', '英', '国', '理', '社', '理社'] }),
    )
  })

  // 後方互換: availableSubjects を渡さない呼び出し(講師トークン等)では既存値を書き換えない。
  it('does not overwrite availableSubjects when omitted', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      occupiedSlots: {},
      availableSubjects: ['数', '英', '国', '理', '社'],
    })

    await updateSubmissionOccupiedSlots([{
      token: 'teacher-token',
      occupiedSlots: { '2026-08-31_1': '通常' },
    }])

    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.availableSubjects).toEqual(['数', '英', '国', '理', '社']) // 既存値(spread)が維持される
  })
})

// 「後から出席可能に変更」(reopenedSlots・2026-07-18) の QR ドキュメント反映。
describe('updateSubmissionReopenedSlots / reopenedSlots の配布情報扱い', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
  })

  it('提出済みドキュメントにも reopenedSlots を反映する(変換は通常提出後に起きる)', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      unavailableSlots: ['2026-07-25_3', '2026-07-26_2'],
      occupiedSlots: {},
    })

    await updateSubmissionReopenedSlots('student-token', ['2026-07-25_3'])

    expect(setDoc).toHaveBeenCalledWith(
      { token: 'student-token' },
      expect.objectContaining({
        status: 'submitted',
        unavailableSlots: ['2026-07-25_3', '2026-07-26_2'], // 提出内容は不変(INV-07)
        reopenedSlots: ['2026-07-25_3'],
      }),
    )
  })

  it('同値なら書き込まない(冪等)', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      unavailableSlots: ['2026-07-25_3'],
      reopenedSlots: ['2026-07-25_3'],
    })

    await updateSubmissionReopenedSlots('student-token', ['2026-07-25_3'])

    expect(setDoc).not.toHaveBeenCalled()
  })

  // 確定仕様(2026-07-18): 登録解除しても黄色(reopenedSlots)はキープする。
  // resetLectureSubmissionDoc のクリア対象に reopenedSlots を加えると本テストが落ちる(巻き戻し検知)。
  it('登録解除(reset)は reopenedSlots を配布情報として維持する', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      unavailableSlots: ['2026-07-25_3'],
      reopenedSlots: ['2026-07-25_3'],
      subjectSlots: { 数: 4 },
      occupiedSlots: { '2026-07-21_1': '数' },
      submittedAt: '2026-07-18T00:00:00.000Z',
    })

    await resetLectureSubmissionDoc('student-token')

    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.status).toBe('pending')
    expect(writtenDoc.unavailableSlots).toEqual([]) // 提出内容はクリア
    expect(writtenDoc.subjectSlots).toEqual({})
    expect(writtenDoc.reopenedSlots).toEqual(['2026-07-25_3']) // 黄色はキープ
    expect(writtenDoc.occupiedSlots).toEqual({ '2026-07-21_1': '数' }) // 配布情報は維持(既存仕様)
  })

  it('updateSubmissionOccupiedSlots の後追い反映は reopenedSlots を指定時のみ更新する', async () => {
    existingData.mockReturnValue({
      status: 'submitted',
      occupiedSlots: {},
      reopenedSlots: ['2026-07-25_3'],
    })

    await updateSubmissionOccupiedSlots([{
      token: 'student-token',
      occupiedSlots: {},
      reopenedSlots: ['2026-07-25_3', '2026-07-26_2'],
    }])

    expect(setDoc).toHaveBeenCalledWith(
      { token: 'student-token' },
      expect.objectContaining({ reopenedSlots: ['2026-07-25_3', '2026-07-26_2'] }),
    )

    setDoc.mockReset()
    await updateSubmissionOccupiedSlots([{
      token: 'student-token',
      occupiedSlots: {},
    }])
    const writtenDoc = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(writtenDoc.reopenedSlots).toEqual(['2026-07-25_3']) // 未指定は既存値(spread)を維持
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

// 本番データ保護(2026-07-19): 開発用教室でも本番と同じく「常にロック/リセット」する方針に変更したため、
// 書き込み関数側で doc.classroomId を権威に「別教室の doc には書かない」低レベルガードを追加した。
// このガードが消えると、開発用教室で他教室(本番)由来トークンをロック/リセットし本番docを汚染する回帰になる。
describe('本番データ保護: 別教室 doc への書き込みを弾く (expectedClassroomId ガード)', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
  })

  it('mark: doc.classroomId が期待教室と一致すればロックする', async () => {
    existingData.mockReturnValue({ status: 'pending', classroomId: 'dev-classroom', groupClassParticipation: {}, optionChecks: {} })
    await markLectureSubmissionDocAsSubmitted('tok', undefined, 'dev-classroom')
    const written = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.status).toBe('submitted')
  })

  it('mark: doc.classroomId が別教室なら書き込まない(本番docを提出済みにしない)', async () => {
    existingData.mockReturnValue({ status: 'pending', classroomId: 'prod-classroom', groupClassParticipation: {}, optionChecks: {} })
    await markLectureSubmissionDocAsSubmitted('tok', undefined, 'dev-classroom')
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('mark: expectedClassroomId 未指定なら従来どおり書き込む(後方互換)', async () => {
    existingData.mockReturnValue({ status: 'pending', classroomId: 'prod-classroom', groupClassParticipation: {}, optionChecks: {} })
    await markLectureSubmissionDocAsSubmitted('tok')
    expect(setDoc).toHaveBeenCalled()
  })

  it('reset: doc.classroomId が別教室なら書き込まない', async () => {
    existingData.mockReturnValue({ status: 'submitted', classroomId: 'prod-classroom', unavailableSlots: ['2026-07-25_3'] })
    await resetLectureSubmissionDoc('tok', 'dev-classroom')
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('reset: doc.classroomId が一致すれば pending に戻す', async () => {
    existingData.mockReturnValue({ status: 'submitted', classroomId: 'dev-classroom', unavailableSlots: ['2026-07-25_3'] })
    await resetLectureSubmissionDoc('tok', 'dev-classroom')
    const written = setDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.status).toBe('pending')
  })

  it('guardAndReset: expectedClassroomId を reset まで貫通し、別教室なら書き込まない', async () => {
    existingData.mockReturnValue({ status: 'submitted', classroomId: 'prod-classroom', unavailableSlots: ['2026-07-25_3'] })
    const guard = createRecentlyResetGuard(2500, { set: () => 0, clear: () => {} })
    await guardAndResetLectureSubmissionDoc(guard, 'tok', 'dev-classroom')
    expect(setDoc).not.toHaveBeenCalled()
  })

  // 設計判断の固定(regression-reviewer 指摘): doc.classroomId が空/未設定の旧トークンは
  // expectedClassroomId 指定でも「弾かない=書き込む」(後方互換)。稼働 doc は writeSubmissionDocs で
  // 必ず classroomId を持つため実データでは踏まれないが、将来ここを「弾く」に変えたら気づける形で固定する。
  it('mark: doc.classroomId が空/未設定なら expectedClassroomId 指定でも書き込む(旧トークン後方互換)', async () => {
    existingData.mockReturnValue({ status: 'pending', groupClassParticipation: {}, optionChecks: {} }) // classroomId 無し
    await markLectureSubmissionDocAsSubmitted('tok', undefined, 'dev-classroom')
    expect(setDoc).toHaveBeenCalled()
    existingData.mockReturnValue({ status: 'pending', classroomId: '', groupClassParticipation: {}, optionChecks: {} }) // 空文字
    setDoc.mockReset()
    await markLectureSubmissionDocAsSubmitted('tok', undefined, 'dev-classroom')
    expect(setDoc).toHaveBeenCalled()
  })

  // 別教室 doc でも guard.add 自体は行われる(reset だけ弾く)。害はないが挙動を明示。
  it('guardAndReset: 別教室でも guard へ add はする(reset のみ弾く)', async () => {
    existingData.mockReturnValue({ status: 'submitted', classroomId: 'prod-classroom', unavailableSlots: [] })
    const added: string[] = []
    const guard = { add: (t: string) => { added.push(t) }, has: () => false, clear: () => {} }
    await guardAndResetLectureSubmissionDoc(guard, 'tok', 'dev-classroom')
    expect(added).toEqual(['tok'])
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

  it('passes notifiedAt through to the change entry (null when absent)', () => {
    const calls: Array<{ entries: SubmissionChangeEntry[] }> = []
    subscribeLectureSubmissions('classroom-1', (entries) => {
      calls.push({ entries })
    })

    onSnapshotCallback?.({
      docChanges: () => [
        {
          type: 'added' as const,
          doc: { id: 'notified', data: () => ({ sessionId: 's1', personType: 'student', personId: 'p1', submittedAt: '2026-07-20T00:00:00.000Z', notifiedAt: '2026-07-20T00:00:00.000Z' }) },
        },
        {
          type: 'added' as const,
          doc: { id: 'fresh', data: () => ({ sessionId: 's1', personType: 'student', personId: 'p2', submittedAt: '2026-07-21T00:00:00.000Z' }) },
        },
      ],
    })

    expect(calls[0].entries.map((e) => [e.token, e.notifiedAt])).toEqual([
      ['notified', '2026-07-20T00:00:00.000Z'],
      ['fresh', null],
    ])
  })
})

describe('markLectureSubmissionsNotified', () => {
  beforeEach(() => {
    existingData.mockReset()
    setDoc.mockReset()
    updateDoc.mockReset()
  })

  it('records notifiedAt = submittedAt via a partial updateDoc (does not overwrite submission content)', async () => {
    existingData.mockReturnValue({ classroomId: 'classroom-1', status: 'submitted', submittedAt: '2026-07-20T00:00:00.000Z' })

    await markLectureSubmissionsNotified([{ token: 'student-token', submittedAt: '2026-07-20T00:00:00.000Z' }], 'classroom-1')

    // INV-07: 全上書き(setDoc)ではなく notifiedAt だけの部分更新(並行再提出のクロバー窓を閉じる)。
    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc).toHaveBeenCalledWith(
      { token: 'student-token' },
      { notifiedAt: '2026-07-20T00:00:00.000Z' },
    )
  })

  it('is idempotent: skips the write when already notified for the same submittedAt', async () => {
    existingData.mockReturnValue({ classroomId: 'classroom-1', status: 'submitted', submittedAt: '2026-07-20T00:00:00.000Z', notifiedAt: '2026-07-20T00:00:00.000Z' })

    await markLectureSubmissionsNotified([{ token: 'student-token', submittedAt: '2026-07-20T00:00:00.000Z' }], 'classroom-1')

    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('does not write to a submission doc belonging to another classroom (本番データ保護)', async () => {
    existingData.mockReturnValue({ classroomId: 'other-classroom', status: 'submitted', submittedAt: '2026-07-20T00:00:00.000Z' })

    await markLectureSubmissionsNotified([{ token: 'foreign-token', submittedAt: '2026-07-20T00:00:00.000Z' }], 'classroom-1')

    expect(updateDoc).not.toHaveBeenCalled()
  })
})
