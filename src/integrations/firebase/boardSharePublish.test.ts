import { describe, expect, it, vi } from 'vitest'
import { publishBoardShare } from './boardShare'

// 配布用盤面の公開が「会社(workspace)識別子つき」で保存されることの回帰防止(複数会社展開 Phase 0 / T0-3)。
// boardShares はワークスペース外のトップレベルコレクションで、教室 ID は会社を跨いで衝突しうる。
// ★読み(loadBoardShare / subscribeBoardShare)は無改変。ここは書き込み側だけを見る。

const setDocMock = vi.fn(async (_ref: { path: string }, _data: Record<string, unknown>) => {})

vi.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, collectionPath: string, token: string) => ({ path: `${collectionPath}/${token}` }),
  setDoc: (ref: unknown, data: unknown) => setDocMock(ref as { path: string }, data as Record<string, unknown>),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
}))

vi.mock('./client', () => ({
  getFirebaseFirestoreInstance: () => ({}),
}))

vi.mock('./config', () => ({
  getFirebaseBackendConfig: () => ({ workspaceKey: 'main' }),
}))

describe('publishBoardShare', () => {
  it('保存ドキュメントに workspaceKey を書き足す(圧縮/非圧縮のどちらでも)', async () => {
    setDocMock.mockClear()
    await publishBoardShare({
      schemaVersion: 1,
      token: 'share-token',
      classroomId: 'classroom-1',
      classroomName: 'スクールIE 緑が丘校',
      sharedAt: '2026-09-16T00:00:00.000Z',
      cells: [],
    })

    expect(setDocMock).toHaveBeenCalledTimes(1)
    const [ref, data] = setDocMock.mock.calls[0]
    expect(ref.path).toBe('boardShares/share-token')
    expect(data.workspaceKey).toBe('main')
    // 既存の識別子・圧縮経路を壊していないこと(cells か compressedCells のどちらかで本体が載る)。
    expect(data.classroomId).toBe('classroom-1')
    expect(data.token).toBe('share-token')
    expect('cells' in data || 'compressedCells' in data).toBe(true)
  })
})
