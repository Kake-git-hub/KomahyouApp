import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 提出用QRの API(lectureSubmissionApi)は全応答に Cache-Control: no-store を付ける(確認リスト qs-2 要改善 2026-11-03)。
// iOS Safari で登録解除のあと開き直しても「すでに提出済み」のままだった。保護者QR(parentPortalApi)と揃える。
const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
const start = indexTs.indexOf('export const lectureSubmissionApi = onRequest(')
const handler = indexTs.slice(start, indexTs.indexOf('\nexport const ', start + 10))

describe('lectureSubmissionApi のキャッシュ指定(qs-2)', () => {
  it('トークン検査(400)より前、ハンドラの最初に no-store を付ける', () => {
    expect(start).toBeGreaterThan(-1)
    const noStore = handler.indexOf("res.set('Cache-Control', 'no-store')")
    const tokenCheck = handler.indexOf("res.status(400).json({ error: 'Invalid token' })")
    expect(noStore).toBeGreaterThan(-1)
    expect(tokenCheck).toBeGreaterThan(noStore)
    expect(handler.indexOf("if (req.method === 'GET')")).toBeGreaterThan(noStore)
  })

  it('保護者QR(parentPortalApi)も同じ指定のまま', () => {
    const parent = indexTs.slice(indexTs.indexOf('export const parentPortalApi = onRequest('))
    expect(parent.slice(0, 800)).toContain("res.set('Cache-Control', 'no-store')")
  })
})
