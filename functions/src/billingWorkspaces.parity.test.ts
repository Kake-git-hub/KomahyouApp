import { describe, expect, it } from 'vitest'
import { summarizeBillingWorkspace } from './billingWorkspaces'
// ⚠️ アプリ側の実装(棟の文書 → 会社の請求プロファイル)。サーバーの summarizeBillingWorkspace は同じ項目を同じ規則で読む鏡像。
import { parseCompanyBillingProfile } from '../../src/utils/companyBilling'

// 棟の文書(workspaces/{key})の会社項目は、クライアント(この会社タブ・直接 getDoc)とサーバー(全社タブ・listBillingWorkspaces)の
// 両方が読む。片方だけ項目名や既定値を変えると「この会社タブでは標準単価 350 円・全社タブでは未設定」のようにズレる。
describe('棟の文書の読み方はクライアントとサーバーで同じ(P-11 ①/③ パリティ)', () => {
  const docs: Array<[string, unknown]> = [
    ['demo', { companyName: '株式会社デモ', brandName: 'デモ塾', billing: { recipientName: '経理部', recipientEmail: 'k@demo.example.com', standardUnitPrice: 350 } }],
    ['main', { name: 'main', schemaVersion: 1 }],
    ['str', { companyName: '文字列単価', billing: { standardUnitPrice: '400' } }],
    ['neg', { companyName: '負の単価', billing: { standardUnitPrice: -1 } }],
    ['norecip', { companyName: '請求先なし', billing: {} }],
    ['empty', undefined],
  ]

  it.each(docs)('workspaces/%s', (workspaceKey, data) => {
    const client = parseCompanyBillingProfile(workspaceKey, data)
    const server = summarizeBillingWorkspace({ workspaceKey, workspaceData: data, memberData: { role: 'developer' }, classroomCount: 0 })
    expect({
      workspaceKey: server.workspaceKey,
      companyName: server.companyName,
      brandName: server.brandName,
      recipientName: server.recipientName,
      recipientEmail: server.recipientEmail,
      standardUnitPrice: server.standardUnitPrice,
    }).toEqual(client)
  })
})
