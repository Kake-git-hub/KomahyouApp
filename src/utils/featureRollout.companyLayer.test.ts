// 機能フラグの 2 段解決(基本スコープ → 会社既定)がクライアントの isFeatureEnabledForClassroom に配線されている
// ことの回帰固定(Phase 1 T1-2・docs/spec-multi-tenant.md §11)。会社既定の台帳は空(既存運営会社は行なし)なので、
// 台帳の引き関数をモックして「行があったらこう効く」を固定する。順序は resolveFeatureEnabledByLayers 1 か所。
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./companyFeatureDefaults', async (importOriginal) => {
  const original = await importOriginal<typeof import('./companyFeatureDefaults')>()
  return { ...original, resolveCompanyFeatureDefault: vi.fn(original.resolveCompanyFeatureDefault) }
})

import { resolveCompanyFeatureDefault, resolveFeatureEnabledByLayers } from './companyFeatureDefaults'
import { featureRolloutRegistry, isFeatureEnabledForClassroom, isFeatureScopeEnabled, resolveExpectedFeatureScope } from './featureRollout'

const DEV_CLASSROOM = { id: 'v8OZ7zH8vONNHjjYVcR1' }
const PROD_CLASSROOM = { id: '5w5OMueETerSKrSf14HC' }

describe('isFeatureEnabledForClassroom: 会社既定(2 段目)', () => {
  afterEach(() => {
    vi.mocked(resolveCompanyFeatureDefault).mockReset()
  })

  // ★2026-11-08: テンプレ差分反映(templateDiffApply)も全教室へ昇格し、development-only の実例が無くなった。
  //   台帳の引き方は all-classrooms の機能でも同じ(会社既定 'off' で止められる)ので、templateDiffApply のまま固定する。
  it('台帳は (workspaceKey, featureKey) で引かれる(会社の壁: 接続先 workspace のキーをそのまま渡す)', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    // 期待値は戻しの記録(FEATURE_ROLLBACKS)から導く。記録された戻しなら本番教室は無効、記録が無ければ全教室で有効。
    expect(featureRolloutRegistry.templateDiffApply.scope).toBe(resolveExpectedFeatureScope('templateDiffApply'))
    const expectedOnProduction = resolveExpectedFeatureScope('templateDiffApply') === 'all-classrooms'
    expect(isFeatureEnabledForClassroom('templateDiffApply', PROD_CLASSROOM, 'main')).toBe(expectedOnProduction)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('main', 'templateDiffApply')
    expect(isFeatureEnabledForClassroom('templateDiffApply', PROD_CLASSROOM, 'company-b')).toBe(expectedOnProduction)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('company-b', 'templateDiffApply')
  })

  it("会社既定 'on' は基本スコープで無効な機能を本番教室でも有効にする(会社の全教室へ出す)", () => {
    // development-only の実例が無いので(2026-11-08)、2 段目の向きは純関数で固定する。
    expect(isFeatureScopeEnabled('development-only', { isStaging: false, isDevelopmentClassroom: false })).toBe(false)
    expect(resolveFeatureEnabledByLayers({ scopeEnabled: false, companyDefault: 'on' })).toBe(true)
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('on')
    expect(isFeatureEnabledForClassroom('templateDiffApply', PROD_CLASSROOM, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('templateDiffApply', DEV_CLASSROOM, 'main')).toBe(true)
  })

  it("会社既定 'off' は all-classrooms の機能も無効にする(開発用教室でも無効)", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('off')
    expect(featureRolloutRegistry.studentDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', PROD_CLASSROOM, 'main')).toBe(false)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', DEV_CLASSROOM, 'main')).toBe(false)
  })

  it('会社既定なし(null)は基本スコープのとおり(従来の挙動)', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(isFeatureEnabledForClassroom('templateDiffApply', DEV_CLASSROOM, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('templateDiffApply', PROD_CLASSROOM, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', PROD_CLASSROOM, 'main')).toBe(true)
    expect(resolveFeatureEnabledByLayers({ scopeEnabled: false, companyDefault: null })).toBe(false)
  })
})
