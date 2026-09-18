// サーバー側の機能述語(保護者ポータル・質問 AI)に、クライアントと同じ 2 段解決(基本スコープ → 会社既定)が
// 配線されていることの回帰固定(Phase 1 T1-2・docs/spec-multi-tenant.md §11)。
// 台帳(生成物)の引き関数をモックし、「会社既定の行があったらサーバーも同じ向きに倒れる」ことを固定する
// (片側だけ会社既定を見ると「QR は出るのに API は 403」の非対称になる)。
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./generated/companyFeatureDefaults', async (importOriginal) => {
  const original = await importOriginal<typeof import('./generated/companyFeatureDefaults')>()
  return { ...original, resolveCompanyFeatureDefault: vi.fn(original.resolveCompanyFeatureDefault) }
})

import { resolveCompanyFeatureDefault } from './generated/companyFeatureDefaults'
import { isParentPortalEnabledForClassroom } from './parentPortal'
import { isQuestionAiAnswerEnabledForClassroom, shouldAnswerQuestionWithAi } from './questionAiAnswer'

const PROD = 'komahyouapp-prod'

describe('サーバー側述語の会社既定(2 段目)', () => {
  afterEach(() => {
    vi.mocked(resolveCompanyFeatureDefault).mockReset()
  })

  it('保護者ポータル: 台帳は (workspaceKey, "parentPortalQr") で引かれ、行なしなら基本スコープのとおり', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'v8OZ7zH8vONNHjjYVcR1', projectId: PROD })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: '5w5OMueETerSKrSf14HC', projectId: PROD })).toBe(false)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('main', 'parentPortalQr')
  })

  it("保護者ポータル: 会社既定 'on' で本番教室も有効・'off' で開発用教室も無効", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('on')
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: '5w5OMueETerSKrSf14HC', projectId: PROD })).toBe(true)
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('off')
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'v8OZ7zH8vONNHjjYVcR1', projectId: PROD })).toBe(false)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'any', projectId: 'komahyouapp-staging' })).toBe(false)
  })

  it('質問 AI: 台帳は (workspaceKey, "questionAiAnswer") で引かれ、行なしなら開発用教室だけ', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(isQuestionAiAnswerEnabledForClassroom({ workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(true)
    expect(isQuestionAiAnswerEnabledForClassroom({ workspaceKey: 'main', classroomId: '5w5OMueETerSKrSf14HC' })).toBe(false)
    expect(isQuestionAiAnswerEnabledForClassroom({ workspaceKey: 'company-b', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(false)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('main', 'questionAiAnswer')
  })

  it("質問 AI: 会社既定 'on' で本番教室も有効・'off' で開発用教室も無効。shouldAnswerQuestionWithAi はその結果を受ける", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('on')
    const enabledOnProd = isQuestionAiAnswerEnabledForClassroom({ workspaceKey: 'main', classroomId: '5w5OMueETerSKrSf14HC' })
    expect(enabledOnProd).toBe(true)
    expect(shouldAnswerQuestionWithAi({ category: 'question', isFeatureEnabled: enabledOnProd, isVerificationChecklist: false })).toBe(true)
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('off')
    expect(isQuestionAiAnswerEnabledForClassroom({ workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(false)
  })
})
