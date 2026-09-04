import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { parseWorkspaceSnapshot } from '../data/appSnapshotRepository'
import { isGzipBytes, readBackupFileText } from './backupFileText'

const json = JSON.stringify({ schemaVersion: 1, savedAt: '2026-09-04T00:00:00.000Z', classrooms: [{ id: 'c1', name: 'テスト教室' }] }, null, 2)

describe('readBackupFileText', () => {
  it('非圧縮の JSON は従来どおりそのまま読む', async () => {
    const file = new Blob([json], { type: 'application/json' })
    await expect(readBackupFileText(file)).resolves.toBe(json)
  })

  it('gzip(.json.gz)は解凍して元の JSON と完全一致する(Drive ミラーからの復元)', async () => {
    const compressed = gzipSync(Buffer.from(json, 'utf8'))
    const file = new Blob([new Uint8Array(compressed)], { type: 'application/gzip' })
    await expect(readBackupFileText(file)).resolves.toBe(json)
  })

  it('開発者バックアップ(ワークスペース全体)の .json.gz も解凍→解析で教室一覧が取れる(Drive ミラーからの復旧本線)', async () => {
    const workspaceJson = JSON.stringify({
      schemaVersion: 1,
      savedAt: '2026-09-04T00:00:00.000Z',
      currentUserId: 'dev',
      actingClassroomId: 'c1',
      users: [],
      classrooms: [],
    })
    const file = new Blob([new Uint8Array(gzipSync(Buffer.from(workspaceJson, 'utf8')))], { type: 'application/gzip' })
    const text = await readBackupFileText(file)
    expect(text).toBe(workspaceJson)
    // 解凍結果がそのまま開発者バックアップとして解析できる(形式検証を通る)
    const snapshot = parseWorkspaceSnapshot(text)
    expect(snapshot.savedAt).toBe('2026-09-04T00:00:00.000Z')
    expect(snapshot.actingClassroomId).toBe('c1')
  })

  it('gzip のマジックバイトだが本体が壊れていれば例外(黙って空を返さない)', async () => {
    const broken = new Blob([new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03])])
    await expect(readBackupFileText(broken)).rejects.toBeTruthy()
  })

  it('空ファイルはテキスト経路で空文字を返す', async () => {
    await expect(readBackupFileText(new Blob([]))).resolves.toBe('')
  })

  it('判定は拡張子ではなくマジックバイトで行う', () => {
    expect(isGzipBytes(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true)
    expect(isGzipBytes(new Uint8Array([0x7b, 0x0a]))).toBe(false) // "{\n"
    expect(isGzipBytes(new Uint8Array([0x1f]))).toBe(false)
  })
})
