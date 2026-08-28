import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 手動テスト No.210(2026-08-29): QR提出ページ /s/** と提出API /api/submission/** に Cache-Control が無く、
// 端末が古いレスポンス(「すでに提出済みです」等)を見続けて「登録解除したのに再提出できない」の一因になり得た。
// no-store をスペックロックする(外すと落ちる)。
describe('firebase.json hosting headers (提出まわりのキャッシュ禁止)', () => {
  const firebaseJson = JSON.parse(readFileSync(resolve(__dirname, '../../firebase.json'), 'utf-8')) as {
    hosting: { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
  }

  const findCacheControl = (source: string) => firebaseJson.hosting.headers
    .find((entry) => entry.source === source)?.headers
    .find((header) => header.key === 'Cache-Control')?.value

  it('/s/** (QR提出ページ) は no-store', () => {
    expect(findCacheControl('/s/**')).toContain('no-store')
  })

  it('/api/submission/** (提出API) は no-store', () => {
    expect(findCacheControl('/api/submission/**')).toContain('no-store')
  })

  it('既存の no-store 群(index/share/version)は維持されている(回帰なし)', () => {
    for (const source of ['/', '/index.html', '/share.html', '/version.json']) {
      expect(findCacheControl(source), source).toContain('no-store')
    }
  })
})
