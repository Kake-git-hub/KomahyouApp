// 機能フラグの 2 段解決(基本スコープ → 会社既定)がクライアントの isFeatureEnabledForClassroom に配線されている
// ことの回帰固定(Phase 1 T1-2・docs/spec-multi-tenant.md §11)。会社既定の台帳は空(既存運営会社は行なし)なので、
// 台帳の引き関数をモックして「行があったらこう効く」を固定する。順序は resolveFeatureEnabledByLayers 1 か所。
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./companyFeatureDefaults', async (importOriginal) => {
  const original = await importOriginal<typeof import('./companyFeatureDefaults')>()
  return { ...original, resolveCompanyFeatureDefault: vi.fn(original.resolveCompanyFeatureDefault) }
})

import { resolveCompanyFeatureDefault } from './companyFeatureDefaults'
import { featureRolloutRegistry, isFeatureEnabledForClassroom } from './featureRollout'

const DEV_CLASSROOM = { id: 'v8OZ7zH8vONNHjjYVcR1' }
const PROD_CLASSROOM = { id: '5w5OMueETerSKrSf14HC' }

describe('isFeatureEnabledForClassroom: 会社既定(2 段目)', () => {
  afterEach(() => {
    vi.mocked(resolveCompanyFeatureDefault).mockReset()
  })

  it('台帳は (workspaceKey, featureKey) で引かれる(会社の壁: 接続先 workspace のキーをそのまま渡す)', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(featureRolloutRegistry.lessonHistory.scope).toBe('development-only')
    expect(isFeatureEnabledForClassroom('lessonHistory', PROD_CLASSROOM, 'main')).toBe(false)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('main', 'lessonHistory')
    expect(isFeatureEnabledForClassroom('lessonHistory', PROD_CLASSROOM, 'company-b')).toBe(false)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('company-b', 'lessonHistory')
  })

  it("会社既定 'on' は development-only の機能を本番教室でも有効にする(会社の全教室へ出す)", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('on')
    expect(isFeatureEnabledForClassroom('lessonHistory', PROD_CLASSROOM, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('lessonHistory', DEV_CLASSROOM, 'main')).toBe(true)
  })

  it("会社既定 'off' は all-classrooms の機能も無効にする(開発用教室でも無効)", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('off')
    expect(featureRolloutRegistry.studentDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', PROD_CLASSROOM, 'main')).toBe(false)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', DEV_CLASSROOM, 'main')).toBe(false)
  })

  it('会社既定なし(null)は基本スコープのとおり(従来の挙動)', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(isFeatureEnabledForClassroom('lessonHistory', DEV_CLASSROOM, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('lessonHistory', PROD_CLASSROOM, 'main')).toBe(false)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', PROD_CLASSROOM, 'main')).toBe(true)
  })
})
