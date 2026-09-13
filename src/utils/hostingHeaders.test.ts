import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 手動テスト No.210(2026-08-29): QR提出ページ /s/** と提出API /api/submission/** に Cache-Control が無く、
// 端末が古いレスポンス(「すでに提出済みです」等)を見続けて「登録解除したのに再提出できない」の一因になり得た。
// no-store をスペックロックする(外すと落ちる)。
describe('firebase.json hosting headers (提出まわりのキャッシュ禁止)', () => {
  const firebaseJson = JSON.parse(readFileSync(resolve(__dirname, '../../firebase.json'), 'utf-8')) as {
    hosting: {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
      rewrites: Array<{ source: string; destination?: string; function?: { functionId: string; region: string } }>
    }
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

  // 保護者向け固定QR(docs/spec-parent-portal.md §C): 古い日程を端末キャッシュで見せない。
  it('/p/** (保護者ポータルページ) は no-store', () => {
    expect(findCacheControl('/p/**')).toContain('no-store')
  })

  it('/api/parent/** (保護者ポータルAPI) は no-store', () => {
    expect(findCacheControl('/api/parent/**')).toContain('no-store')
  })

  it('/api/parent/** は parentPortalApi(asia-northeast1)へ rewrite され、catch-all(**) より前にある', () => {
    const rewrites = firebaseJson.hosting.rewrites
    const parentIndex = rewrites.findIndex((entry) => entry.source === '/api/parent/**')
    const catchAllIndex = rewrites.findIndex((entry) => entry.source === '**')
    expect(parentIndex).toBeGreaterThan(-1)
    expect(catchAllIndex).toBeGreaterThan(-1)
    expect(parentIndex).toBeLessThan(catchAllIndex)
    expect(rewrites[parentIndex]?.function).toEqual({ functionId: 'parentPortalApi', region: 'asia-northeast1' })
  })

  it('既存の /api/submission/** rewrite は維持されている(回帰なし)', () => {
    const entry = firebaseJson.hosting.rewrites.find((candidate) => candidate.source === '/api/submission/**')
    expect(entry?.function).toEqual({ functionId: 'lectureSubmissionApi', region: 'asia-northeast1' })
  })
})
