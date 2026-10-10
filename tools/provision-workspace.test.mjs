// 会社(workspace)新設ツールのガード(P-5/P-12・spec §6-2)。引数検査・文書の形・書き込み先ガードを固定する。
import { describe, expect, it } from 'vitest'
import { assertRequestAllowed, buildWorkspaceDocuments, parseArgs, validateArgs } from './provision-workspace.mjs'

const good = parseArgs([
  '--project', 'komahyouapp-staging', '--workspace', 'demo', '--company-name', '株式会社デモ', '--brand-name', 'デモ塾',
  '--billing-recipient', '株式会社デモ 経理部', '--billing-email', 'keiri@demo.example.com', '--unit-price', '350',
  '--developer-uid', 'OWNER_UID', '--developer-email', 'Owner@Example.com', '--developer-name', 'オーナー',
])

describe('validateArgs', () => {
  it('staging・正しい引数なら合格(--confirm 不要)', () => {
    expect(validateArgs(good)).toEqual([])
  })

  it('--project / --workspace / --company-name / --developer-uid / --developer-email は必須', () => {
    const errors = validateArgs(parseArgs([]))
    expect(errors.join('\n')).toMatch(/--project/)
    expect(errors.join('\n')).toMatch(/--workspace/)
    expect(errors.join('\n')).toMatch(/--company-name/)
    expect(errors.join('\n')).toMatch(/--developer-uid/)
    expect(errors.join('\n')).toMatch(/--developer-email/)
  })

  it('main(既存運営会社)・命名規則違反は拒否(D-2)', () => {
    expect(validateArgs({ ...good, workspaceKey: 'main' }).join()).toMatch(/既存運営会社/)
    expect(validateArgs({ ...good, workspaceKey: 'Demo' }).join()).toMatch(/命名規則/)
    expect(validateArgs({ ...good, workspaceKey: 'ab' }).join()).toMatch(/命名規則/)
    expect(validateArgs({ ...good, workspaceKey: 'a'.repeat(17) }).join()).toMatch(/命名規則/)
    expect(validateArgs({ ...good, workspaceKey: 'de-mo' }).join()).toMatch(/命名規則/)
  })

  it('本番は --confirm <会社キー> が一致しないと拒否(--dry-run は除く)', () => {
    expect(validateArgs({ ...good, project: 'komahyouapp-prod' }).join()).toMatch(/--confirm/)
    expect(validateArgs({ ...good, project: 'komahyouapp-prod', confirm: 'other' }).join()).toMatch(/--confirm/)
    expect(validateArgs({ ...good, project: 'komahyouapp-prod', confirm: 'demo' })).toEqual([])
    expect(validateArgs({ ...good, project: 'komahyouapp-prod', dryRun: true })).toEqual([])
    expect(validateArgs({ ...good, project: 'other-project' }).join()).toMatch(/--project/)
  })

  it('メール形式・単価の形式を検査', () => {
    expect(validateArgs({ ...good, developerEmail: 'bad' }).join()).toMatch(/--developer-email/)
    expect(validateArgs({ ...good, billingEmail: 'bad' }).join()).toMatch(/--billing-email/)
    expect(validateArgs({ ...good, unitPrice: '-1' }).join()).toMatch(/--unit-price/)
    expect(validateArgs({ ...good, unitPrice: '3.5' }).join()).toMatch(/--unit-price/)
    expect(validateArgs({ ...good, unitPrice: '' })).toEqual([])
  })
})

describe('buildWorkspaceDocuments(棟の文書 = P-11 ①の形・developer 会員 = billingAllowed フラグ)', () => {
  it('会社名・ブランド名・請求先・標準単価を棟の文書に、オーナーを developer(billingAllowed:true)に', () => {
    const docs = buildWorkspaceDocuments(good, '2026-10-10T00:00:00.000Z')
    expect(docs.workspacePath).toBe('workspaces/demo')
    expect(docs.memberPath).toBe('workspaces/demo/members/OWNER_UID')
    expect(docs.workspaceDoc).toEqual({
      name: { stringValue: 'demo' },
      schemaVersion: { integerValue: '1' },
      companyName: { stringValue: '株式会社デモ' },
      brandName: { stringValue: 'デモ塾' },
      billing: { mapValue: { fields: {
        recipientName: { stringValue: '株式会社デモ 経理部' },
        recipientEmail: { stringValue: 'keiri@demo.example.com' },
        standardUnitPrice: { integerValue: '350' },
      } } },
      createdAt: { stringValue: '2026-10-10T00:00:00.000Z' },
      updatedAt: { timestampValue: '2026-10-10T00:00:00.000Z' },
      provisionedBy: { stringValue: 'tools/provision-workspace.mjs' },
    })
    expect(docs.memberDoc).toEqual({
      displayName: { stringValue: 'オーナー' },
      email: { stringValue: 'owner@example.com' },
      role: { stringValue: 'developer' },
      assignedClassroomId: { nullValue: null },
      billingAllowed: { booleanValue: true },
      updatedAt: { stringValue: '2026-10-10T00:00:00.000Z' },
    })
  })

  it('省略時の既定: 請求先名 = 会社名・請求先メール空・標準単価 300・表示名 = メール', () => {
    const docs = buildWorkspaceDocuments({ ...good, brandName: '', billingRecipient: '', billingEmail: '', unitPrice: '', developerName: '' })
    expect(docs.workspaceDoc.brandName).toEqual({ stringValue: '' })
    expect(docs.workspaceDoc.billing.mapValue.fields.recipientName).toEqual({ stringValue: '株式会社デモ' })
    expect(docs.workspaceDoc.billing.mapValue.fields.recipientEmail).toEqual({ stringValue: '' })
    expect(docs.workspaceDoc.billing.mapValue.fields.standardUnitPrice).toEqual({ integerValue: '300' })
    expect(docs.memberDoc.displayName).toEqual({ stringValue: 'owner@example.com' })
  })
})

describe('assertRequestAllowed(指定した新キー以外へ書けないガード・spec §6-2)', () => {
  const guard = { projectId: 'komahyouapp-staging', workspaceKey: 'demo', developerUid: 'OWNER_UID' }
  const base = 'https://firestore.googleapis.com/v1/projects/komahyouapp-staging/databases/(default)/documents'

  it('棟の文書と会員文書への create-only PATCH と GET だけ許す', () => {
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/demo?currentDocument.exists=false`, ...guard })).not.toThrow()
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/demo/members/OWNER_UID?currentDocument.exists=false`, ...guard })).not.toThrow()
    expect(() => assertRequestAllowed({ method: 'GET', url: `${base}/workspaces/demo`, ...guard })).not.toThrow()
  })

  it('main・他社・教室・別 UID・別プロジェクト・上書き(前提なし)・DELETE/POST は拒否', () => {
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/main?currentDocument.exists=false`, ...guard })).toThrow(/拒否/)
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/other?currentDocument.exists=false`, ...guard })).toThrow(/拒否/)
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/demo/classrooms/x?currentDocument.exists=false`, ...guard })).toThrow(/拒否/)
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/demo/members/OTHER?currentDocument.exists=false`, ...guard })).toThrow(/拒否/)
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base.replace('komahyouapp-staging', 'komahyouapp-prod')}/workspaces/demo?currentDocument.exists=false`, ...guard })).toThrow(/拒否/)
    expect(() => assertRequestAllowed({ method: 'PATCH', url: `${base}/workspaces/demo`, ...guard })).toThrow(/create-only/)
    expect(() => assertRequestAllowed({ method: 'DELETE', url: `${base}/workspaces/demo`, ...guard })).toThrow(/メソッド/)
    expect(() => assertRequestAllowed({ method: 'POST', url: `${base}/workspaces/demo:commit`, ...guard })).toThrow(/メソッド/)
    expect(() => assertRequestAllowed({ method: 'GET', url: `${base}/workspaces/main`, ...guard })).toThrow(/拒否/)
  })
})
