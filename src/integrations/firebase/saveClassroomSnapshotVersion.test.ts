import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveClassroomSnapshotViaFunction } from './adminFunctions'
import { clearClassroomSnapshotVersions, getClassroomSnapshotVersion, setClassroomSnapshotVersion } from './classroomSnapshotVersions'
import type { AppSnapshotPayload } from '../../types/appState'

// A1 回帰防止: クライアントが baseVersion を正しく送り、保存成功で版数を追従することを担保する。
// ここが壊れると「自分の連続保存が STALE 誤判定で弾かれて保存できない」本番障害になりうる。

const callableImpl = vi.fn()

vi.mock('firebase/functions', () => ({
  httpsCallable: () => (payload: unknown) => callableImpl(payload),
}))

vi.mock('./client', () => ({
  ensureFirebaseAuthenticatedUser: vi.fn(async () => {}),
  getFirebaseFunctionsInstance: () => ({}),
  getFirebaseFirestoreInstance: () => ({}),
}))

vi.mock('./config', () => ({
  getFirebaseBackendConfig: () => ({ workspaceKey: 'main' }),
}))

vi.mock('./firestoreSanitize', () => ({
  sanitizeForFirestore: (value: unknown) => value,
}))

const emptyPayload = {} as AppSnapshotPayload

describe('saveClassroomSnapshotViaFunction baseVersion threading (A1)', () => {
  beforeEach(() => {
    clearClassroomSnapshotVersions()
    callableImpl.mockReset()
  })
  afterEach(() => {
    clearClassroomSnapshotVersions()
  })

  it('版数未把握なら baseVersion を送らず(後方互換)、返ってきた版数を記録する', async () => {
    callableImpl.mockResolvedValue({ data: { classroomId: 'room-1', version: 1, verified: true } })

    await saveClassroomSnapshotViaFunction({ classroomId: 'room-1', savedAt: 't', saveId: 's1', payload: emptyPayload })

    const sent = callableImpl.mock.calls[0][0] as Record<string, unknown>
    expect('baseVersion' in sent).toBe(false)
    expect(getClassroomSnapshotVersion('room-1')).toBe(1)
  })

  it('把握している版数を baseVersion として送り、成功で次の版数に更新する', async () => {
    setClassroomSnapshotVersion('room-1', 4)
    callableImpl.mockResolvedValue({ data: { classroomId: 'room-1', version: 5, verified: true } })

    await saveClassroomSnapshotViaFunction({ classroomId: 'room-1', savedAt: 't', saveId: 's2', payload: emptyPayload })

    const sent = callableImpl.mock.calls[0][0] as Record<string, unknown>
    expect(sent.baseVersion).toBe(4)
    expect(getClassroomSnapshotVersion('room-1')).toBe(5)
  })

  it('連続保存で版数が連鎖し、自端末の保存が自分でブロックされない', async () => {
    setClassroomSnapshotVersion('room-1', 1)
    callableImpl.mockResolvedValueOnce({ data: { classroomId: 'room-1', version: 2, verified: true } })
    await saveClassroomSnapshotViaFunction({ classroomId: 'room-1', savedAt: 't', saveId: 'a', payload: emptyPayload })
    callableImpl.mockResolvedValueOnce({ data: { classroomId: 'room-1', version: 3, verified: true } })
    await saveClassroomSnapshotViaFunction({ classroomId: 'room-1', savedAt: 't', saveId: 'b', payload: emptyPayload })

    expect((callableImpl.mock.calls[0][0] as Record<string, unknown>).baseVersion).toBe(1)
    expect((callableImpl.mock.calls[1][0] as Record<string, unknown>).baseVersion).toBe(2)
    expect(getClassroomSnapshotVersion('room-1')).toBe(3)
  })

  it('サーバーが版数を返さない場合は既存の版数を据え置く', async () => {
    setClassroomSnapshotVersion('room-1', 7)
    callableImpl.mockResolvedValue({ data: { classroomId: 'room-1', verified: true } })

    await saveClassroomSnapshotViaFunction({ classroomId: 'room-1', savedAt: 't', saveId: 's3', payload: emptyPayload })

    expect(getClassroomSnapshotVersion('room-1')).toBe(7)
  })
})
