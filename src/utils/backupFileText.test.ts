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

// ★2026-09-04: サーバー自動バックアップの書き出しを整形(2スペース字下げ)から最小化へ変更した。
// 復元は「整形版(2026-09-04 以前のファイル)」と「最小化版(以降のファイル)」の**両方**を
// 同じ結果として読めなければならない。ファイル形式そのものは変えていないことの担保。
describe('整形版と最小化版のバックアップが同じ結果に復元される', () => {
  // 形式検証(isWorkspaceSnapshot)を通る最小のワークスペーススナップショット。
  const snapshot = {
    schemaVersion: 1,
    savedAt: '2026-09-04T01:15:04.205Z',
    currentUserId: 'dev',
    actingClassroomId: 'c1',
    users: [],
    classrooms: [],
  }
  const prettyJson = JSON.stringify(snapshot, null, 2)
  const compactJson = JSON.stringify(snapshot)

  it('非圧縮: 整形版と最小化版が同じスナップショットとして解析できる', async () => {
    const pretty = parseWorkspaceSnapshot(await readBackupFileText(new Blob([prettyJson], { type: 'application/json' })))
    const compact = parseWorkspaceSnapshot(await readBackupFileText(new Blob([compactJson], { type: 'application/json' })))
    expect(compact).toEqual(pretty)
    expect(compact.actingClassroomId).toBe('c1')
  })

  it('gzip(.json.gz): 整形版と最小化版が同じスナップショットとして解析できる', async () => {
    const toBlob = (text: string) => new Blob([new Uint8Array(gzipSync(Buffer.from(text, 'utf8')))], { type: 'application/gzip' })
    const pretty = parseWorkspaceSnapshot(await readBackupFileText(toBlob(prettyJson)))
    const compact = parseWorkspaceSnapshot(await readBackupFileText(toBlob(compactJson)))
    expect(compact).toEqual(pretty)
  })

  it('最小化しても gzip 後は整形版より小さい(Drive の 15GB 上限に効く)', () => {
    expect(gzipSync(Buffer.from(compactJson, 'utf8')).length)
      .toBeLessThanOrEqual(gzipSync(Buffer.from(prettyJson, 'utf8')).length)
  })
})
