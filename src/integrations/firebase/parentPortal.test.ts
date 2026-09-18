import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  issueStudentPortalTokenViaFunction,
  markParentMessagesNotifiedViaFunction,
  revokeStudentPortalTokenViaFunction,
  subscribeParentMessages,
} from './parentPortal'
import type { ParentMessageEntry } from '../../utils/parentMessages'

// lectureSubmission.test.ts と同じ vi.mock 作法(firebase SDK と client/config を差し替え、呼び出し形だけを固定する)。
const ensureAuth = vi.fn(async () => undefined)
const callableFactory = vi.fn()
const callableInvoke = vi.fn()
const collectionMock = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments }))
const whereMock = vi.fn((...args: unknown[]) => ({ where: args }))
const queryMock = vi.fn((...args: unknown[]) => ({ query: args }))
let onSnapshotCallback: ((snapshot: unknown) => void) | null = null
let onSnapshotErrorCallback: ((error: { code?: string }) => void) | null = null
let firestoreInstance: object | null = { db: true }
let workspaceKey = 'main'

vi.mock('./client', () => ({
  getFirebaseFirestoreInstance: () => firestoreInstance,
  getFirebaseFunctionsInstance: () => ({ functions: true }),
  ensureFirebaseAuthenticatedUser: () => ensureAuth(),
}))

vi.mock('./config', () => ({
  getFirebaseBackendConfig: () => ({ workspaceKey }),
}))

vi.mock('firebase/functions', () => ({
  httpsCallable: (functions: unknown, name: string, options: unknown) => {
    callableFactory(functions, name, options)
    return (payload: unknown) => callableInvoke(payload)
  },
}))

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, ...segments: string[]) => collectionMock(db, ...segments),
  query: (...args: unknown[]) => queryMock(...args),
  where: (...args: unknown[]) => whereMock(...args),
  onSnapshot: (_query: unknown, callback: (snapshot: unknown) => void, errorCallback?: (error: { code?: string }) => void) => {
    onSnapshotCallback = callback
    onSnapshotErrorCallback = errorCallback ?? null
    return () => {}
  },
}))

beforeEach(() => {
  ensureAuth.mockClear()
  callableFactory.mockReset()
  callableInvoke.mockReset()
  collectionMock.mockClear()
  whereMock.mockClear()
  queryMock.mockClear()
  onSnapshotCallback = null
  onSnapshotErrorCallback = null
  firestoreInstance = { db: true }
  workspaceKey = 'main'
})

describe('issueStudentPortalTokenViaFunction', () => {
  it('callable issueStudentPortalToken を workspaceKey 注入・60 秒タイムアウト・認証確認つきで呼び、token/reissued を返す', async () => {
    callableInvoke.mockResolvedValue({ data: { token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345', reissued: false } })
    const result = await issueStudentPortalTokenViaFunction({ classroomId: 'v8OZ7zH8vONNHjjYVcR1', studentId: 's001' })
    expect(ensureAuth).toHaveBeenCalledTimes(1)
    expect(callableFactory).toHaveBeenCalledWith({ functions: true }, 'issueStudentPortalToken', { timeout: 60_000 })
    expect(callableInvoke).toHaveBeenCalledWith({ workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1', studentId: 's001', reissue: false })
    expect(result).toEqual({ token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345', reissued: false })
  })
  it('reissue: true を明示したときだけ再発行フラグを送る', async () => {
    callableInvoke.mockResolvedValue({ data: { token: 'NewTokenNewTokenNewTokenNewToken', reissued: true } })
    const result = await issueStudentPortalTokenViaFunction({ classroomId: 'dev', studentId: 's001', reissue: true })
    expect(callableInvoke.mock.calls[0]![0]).toMatchObject({ reissue: true })
    expect(result.reissued).toBe(true)
  })
  it('応答に token が無ければ利用者向けの日本語エラーにする(画面に生 INTERNAL を出さない)', async () => {
    callableInvoke.mockResolvedValue({ data: { reissued: false } })
    await expect(issueStudentPortalTokenViaFunction({ classroomId: 'dev', studentId: 's001' })).rejects.toThrow('保護者用QRの発行結果を読み取れませんでした')
    callableInvoke.mockResolvedValue({ data: null })
    await expect(issueStudentPortalTokenViaFunction({ classroomId: 'dev', studentId: 's001' })).rejects.toThrow(/発行結果/)
  })
})

describe('revokeStudentPortalTokenViaFunction', () => {
  it('callable revokeStudentPortalToken を reason つきで呼び、revoked を真偽で返す', async () => {
    callableInvoke.mockResolvedValue({ data: { revoked: true } })
    const result = await revokeStudentPortalTokenViaFunction({ classroomId: 'dev', studentId: 's001', reason: 'studentDeleted' })
    expect(ensureAuth).toHaveBeenCalledTimes(1)
    expect(callableFactory).toHaveBeenCalledWith({ functions: true }, 'revokeStudentPortalToken', { timeout: 60_000 })
    expect(callableInvoke).toHaveBeenCalledWith({ workspaceKey: 'main', classroomId: 'dev', studentId: 's001', reason: 'studentDeleted' })
    expect(result).toEqual({ revoked: true })
  })
  it('応答が崩れていても revoked:false に丸める', async () => {
    callableInvoke.mockResolvedValue({ data: undefined })
    expect(await revokeStudentPortalTokenViaFunction({ classroomId: 'dev', studentId: 's001', reason: 'manual' })).toEqual({ revoked: false })
  })
})

describe('markParentMessagesNotifiedViaFunction', () => {
  it('callable markParentMessagesNotified に教室・messageIds(重複・空白除去)・stage を送り updated を返す', async () => {
    callableInvoke.mockResolvedValue({ data: { updated: 2 } })
    const result = await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: ['m1', ' m2 ', 'm1', ''], stage: 'notified' })
    expect(callableFactory).toHaveBeenCalledWith({ functions: true }, 'markParentMessagesNotified', { timeout: 60_000 })
    expect(callableInvoke).toHaveBeenCalledWith({ workspaceKey: 'main', classroomId: 'dev', messageIds: ['m1', 'm2'], stage: 'notified' })
    expect(result).toEqual({ updated: 2 })
  })
  it("'acknowledged'(四択を押した=保護者ページの「教室確認済」)は resolution を添えて送る", async () => {
    callableInvoke.mockResolvedValue({ data: { updated: 1 } })
    await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: ['m1'], stage: 'acknowledged', resolution: 'makeup-now' })
    expect(callableInvoke).toHaveBeenCalledWith({ workspaceKey: 'main', classroomId: 'dev', messageIds: ['m1'], stage: 'acknowledged', resolution: 'makeup-now' })
  })
  it('resolution を渡さないときは resolution キー自体を送らない(サーバー側で既存値を上書きさせない)', async () => {
    callableInvoke.mockResolvedValue({ data: { updated: 1 } })
    await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: ['m1'], stage: 'notified' })
    expect(Object.keys(callableInvoke.mock.calls[0]![0] as object)).not.toContain('resolution')
  })
  it('messageIds が空なら callable を呼ばずに updated:0(無駄な往復と権限エラーを避ける)', async () => {
    expect(await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: [], stage: 'notified' })).toEqual({ updated: 0 })
    expect(await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: ['  '], stage: 'notified' })).toEqual({ updated: 0 })
    expect(callableInvoke).not.toHaveBeenCalled()
    expect(ensureAuth).not.toHaveBeenCalled()
  })
  it('updated が数値でなければ 0 に丸める', async () => {
    callableInvoke.mockResolvedValue({ data: { updated: 'x' } })
    expect(await markParentMessagesNotifiedViaFunction({ classroomId: 'dev', messageIds: ['m1'], stage: 'notified' })).toEqual({ updated: 0 })
  })
})

describe('subscribeParentMessages', () => {
  function messageDoc(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      data: () => ({
        classroomId: 'dev',
        studentId: 's001',
        studentName: '青木',
        kind: 'absence',
        absence: { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'regular', isTentative: false },
        createdAt: '2026-09-13T01:00:00.000Z',
        acknowledgedAt: null,
        resolution: null,
        notifiedAt: null,
        ...overrides,
      }),
    }
  }

  it('自教室のネストしたパスを notifiedAt == null の等値 1 条件だけで購読する(orderBy なし・複合インデックス不要)', () => {
    subscribeParentMessages('dev', () => {})
    expect(collectionMock).toHaveBeenCalledWith({ db: true }, 'workspaces', 'main', 'classroomSnapshots', 'dev', 'parentMessages')
    expect(whereMock).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalledWith('notifiedAt', '==', null)
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0]).toHaveLength(2) // collection + where のみ(orderBy を足していない)
    expect(onSnapshotCallback).toBeTypeOf('function')
  })

  // 2026-09-18: 差分(docChanges)ではなく毎回「未処理の全件」を渡す。保存待ちを捨てたとき(教室データの読み直し・復元)に
  // その連絡を一覧へ戻せるようにするため。処理済みになった doc はクエリから外れるので、次の全件から自動で消える。
  it('毎回、未処理の全件(snapshot.docs)を渡す。処理済みで外れた doc は次の配信に含まれない', () => {
    const calls: string[][] = []
    subscribeParentMessages('dev', (entries) => { calls.push(entries.map((entry) => entry.id)) })
    onSnapshotCallback?.({ docs: [messageDoc('m1'), messageDoc('m2')] })
    onSnapshotCallback?.({ docs: [messageDoc('m2')] })
    expect(calls).toEqual([['m1', 'm2'], ['m2']])
  })

  it('0 件になったときも空配列で知らせる(知らせないと最後の 1 件が画面に残り続ける)', () => {
    const onChange = vi.fn()
    subscribeParentMessages('dev', onChange)
    onSnapshotCallback?.({ docs: [] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('doc.classroomId が購読教室と違う doc・壊れた doc・旧形式(自由記述)の doc は捨てる(INV-08)', () => {
    const received: ParentMessageEntry[][] = []
    subscribeParentMessages('dev', (entries) => { received.push(entries) })
    onSnapshotCallback?.({
      docs: [
        messageDoc('own'),
        messageDoc('foreign', { classroomId: '5w5OMueETerSKrSf14HC' }),
        messageDoc('untagged', { classroomId: '' }),
        messageDoc('broken', { createdAt: undefined }),
        messageDoc('legacy', { kind: undefined, absence: undefined, body: '欠席します', senderName: '母' }),
      ],
    })
    expect(received).toHaveLength(1)
    expect(received[0]!.map((entry) => entry.id)).toEqual(['own'])
    expect(received[0]![0]).toMatchObject({
      classroomId: 'dev',
      studentId: 's001',
      absence: { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'regular', isTentative: false },
      acknowledgedAt: null,
      resolution: null,
      notifiedAt: null,
    })
  })

  // ルール未反映(permission-denied)や索引不足が「連絡 0 件」と区別できず無音で壊れるのを防ぐ
  // (Firestore ルールは main マージでは反映されないので実際に踏みうる・レビュー指摘 2026-09-13)。
  it('購読エラーはエラーコールバックで拾い、code だけをログに出す(本文・生徒名・トークンは出さない)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    subscribeParentMessages('dev', () => {})
    expect(onSnapshotErrorCallback).toBeTypeOf('function')
    onSnapshotErrorCallback?.({ code: 'permission-denied' })
    expect(consoleError).toHaveBeenCalledWith('[parentMessages] subscribe failed', 'permission-denied')
    consoleError.mockRestore()
  })

  it('Firestore 未接続・教室未指定・workspaceKey 未設定なら購読せず no-op の解除関数を返す', () => {
    firestoreInstance = null
    expect(subscribeParentMessages('dev', () => {})).toBeTypeOf('function')
    firestoreInstance = { db: true }
    subscribeParentMessages('', () => {})
    workspaceKey = ''
    subscribeParentMessages('dev', () => {})
    expect(collectionMock).not.toHaveBeenCalled()
    expect(onSnapshotCallback).toBeNull()
  })
})
