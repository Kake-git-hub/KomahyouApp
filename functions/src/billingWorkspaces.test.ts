import { describe, expect, it } from 'vitest'
import { isDeveloperMember, sortBillingWorkspaces, summarizeBillingWorkspace } from './billingWorkspaces'

describe('listBillingWorkspaces の純粋ロジック(P-11 ③)', () => {
  it('developer 会員だけが対象(manager・未所属は false)', () => {
    expect(isDeveloperMember({ role: 'developer' })).toBe(true)
    expect(isDeveloperMember({ role: 'manager', assignedClassroomId: 'A' })).toBe(false)
    expect(isDeveloperMember(undefined)).toBe(false)
    expect(isDeveloperMember(null)).toBe(false)
  })

  it('棟の文書(会社名・請求先・標準単価)と教室数・請求許可フラグをまとめる', () => {
    expect(summarizeBillingWorkspace({
      workspaceKey: 'demo',
      workspaceData: { companyName: '株式会社デモ', brandName: 'デモ塾', billing: { recipientName: '経理部', recipientEmail: 'k@demo.example.com', standardUnitPrice: 350 } },
      memberData: { role: 'developer', billingAllowed: true },
      classroomCount: 3,
    })).toEqual({
      workspaceKey: 'demo', companyName: '株式会社デモ', brandName: 'デモ塾', recipientName: '経理部', recipientEmail: 'k@demo.example.com', standardUnitPrice: 350, classroomCount: 3, billingAllowed: true,
    })
  })

  it('既存運営会社(main)のように会社の項目が無い棟でも落ちない・フラグ無し = false', () => {
    expect(summarizeBillingWorkspace({ workspaceKey: 'main', workspaceData: { name: 'main', schemaVersion: 1 }, memberData: { role: 'developer', email: 'x@example.com' }, classroomCount: 2 })).toEqual({
      workspaceKey: 'main', companyName: '', brandName: '', recipientName: '', recipientEmail: '', standardUnitPrice: null, classroomCount: 2, billingAllowed: false,
    })
  })

  it('並びは main が先頭・あとは会社キー順', () => {
    const entry = (workspaceKey: string) => summarizeBillingWorkspace({ workspaceKey, workspaceData: {}, memberData: {}, classroomCount: 0 })
    expect(sortBillingWorkspaces([entry('zeta'), entry('main'), entry('alpha')]).map((e) => e.workspaceKey)).toEqual(['main', 'alpha', 'zeta'])
  })
})
