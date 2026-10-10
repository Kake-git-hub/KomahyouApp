// toWorkspaceUser(members → WorkspaceUser)の billingAllowed(P-11 ④): true のときだけキーを載せ、無い/false ではキー自体を作らない
// (undefined キーを作ると既存のスナップショット比較・保存 payload を汚す)。関数は非公開なので字面で固定する(source-scan)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./workspaceStore.ts', import.meta.url)), 'utf8')

describe('workspaceStore.toWorkspaceUser の billingAllowed', () => {
  it('true のときだけ載せる(spread 条件)。`billingAllowed: data.billingAllowed` のような常時キー化へ戻さない', () => {
    expect(source).toContain("...(data.billingAllowed === true ? { billingAllowed: true } : {}),")
    expect(source).not.toMatch(/billingAllowed:\s*data\.billingAllowed\b/)
  })
})
