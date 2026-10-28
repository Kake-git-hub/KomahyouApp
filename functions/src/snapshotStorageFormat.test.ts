// 週単位の分割保存 段階 B: 書く形式の選択(フラグ)と古い画面の拒否(docs/spec-save-restore.md §9-7・AC-18・AC-27)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./generated/companyFeatureDefaults', async (importOriginal) => {
  const original = await importOriginal<typeof import('./generated/companyFeatureDefaults')>()
  return { ...original, resolveCompanyFeatureDefault: vi.fn(original.resolveCompanyFeatureDefault) }
})

import { resolveCompanyFeatureDefault } from './generated/companyFeatureDefaults'
import {
  buildClientTooOldMessage,
  CLIENT_TOO_OLD_ERROR_MARKER,
  compareAppVersions,
  isClientNewEnoughForSnapshotParts,
  isWeeklySplitSnapshotScopeEnabled,
  isWeeklySplitSnapshotStorageEnabledForClassroom,
  parseAppVersion,
  resolveSnapshotWriteFormat,
  SNAPSHOT_PARTS_MIN_CLIENT_APP_VERSION,
  WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE,
  WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST,
  WEEKLY_SPLIT_SNAPSHOT_FEATURE_KEY,
} from './snapshotStorageFormat'

const PROD = 'komahyouapp-prod'
const STAGING = 'komahyouapp-staging'
const DEV_CLASSROOM = 'v8OZ7zH8vONNHjjYVcR1'
const NICHIDAI = '5w5OMueETerSKrSf14HC'

describe('weeklySplitSnapshotStorage のサーバー述語(2 段解決・開発用教室 → staging → 教室指定 → 全教室)', () => {
  afterEach(() => {
    vi.mocked(resolveCompanyFeatureDefault).mockReset()
  })

  it('全教室展開(オーナー指示 2026-10-28・v1.5.656): 基本スコープは all-classrooms・教室指定は空のまま。回帰で戻さない', () => {
    expect(WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE).toBe('all-classrooms')
    expect(WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST).toEqual([])
  })

  it('会社既定の行が無ければ: 本番の全教室(日大前・緑が丘・薬円台・開発用・テスト教室)も staging も ON。会社や教室 ID が空なら OFF(fail-closed)', () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue(null)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: DEV_CLASSROOM, projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: 'test_classroom_20260507_dai', projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: NICHIDAI, projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: 'KzFnOQoTFLsCxwUp1tvh', projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: '6xnnbSTbwgGrBLy0EJKb', projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: 'any-staging-classroom', projectId: STAGING })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'company-b', classroomId: 'c-other', projectId: PROD })).toBe(true)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: '', classroomId: DEV_CLASSROOM, projectId: STAGING })).toBe(false)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: '', projectId: PROD })).toBe(false)
    expect(resolveCompanyFeatureDefault).toHaveBeenCalledWith('main', WEEKLY_SPLIT_SNAPSHOT_FEATURE_KEY)
  })

  it("会社既定 'off' でその会社の全教室を止められる(新しく移る教室を止めるだけ・既に分割形式の教室は一方通行で分割形式のまま=resolveSnapshotWriteFormat)", () => {
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('off')
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: NICHIDAI, projectId: PROD })).toBe(false)
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: DEV_CLASSROOM, projectId: PROD })).toBe(false)
    vi.mocked(resolveCompanyFeatureDefault).mockReturnValue('on')
    expect(isWeeklySplitSnapshotStorageEnabledForClassroom({ workspaceKey: 'main', classroomId: NICHIDAI, projectId: PROD })).toBe(true)
  })

  it('基本スコープが staging-environment だったときの判定(段階 B の開始時点の形・純関数で固定)', () => {
    expect(isWeeklySplitSnapshotScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: true, isAllowlisted: false })).toBe(true)
    expect(isWeeklySplitSnapshotScopeEnabled('staging-environment', { isStaging: true, isDevelopmentClassroom: false, isAllowlisted: false })).toBe(true)
    expect(isWeeklySplitSnapshotScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: false, isAllowlisted: false })).toBe(false)
  })

  it('教室指定(allowlist)はスコープに関係なく ON・all-classrooms は全部 ON', () => {
    expect(isWeeklySplitSnapshotScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: false, isAllowlisted: true })).toBe(true)
    expect(isWeeklySplitSnapshotScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: false, isAllowlisted: false })).toBe(false)
    expect(isWeeklySplitSnapshotScopeEnabled('all-classrooms', { isStaging: false, isDevelopmentClassroom: false, isAllowlisted: false })).toBe(true)
  })

  it('クライアントの featureRollout.ts にも同じキー・同じ基本スコープがある(台帳 developmentStatusLedger の整合用・権威はサーバー)', () => {
    const featureRolloutTs = readFileSync(fileURLToPath(new URL('../../src/utils/featureRollout.ts', import.meta.url)), 'utf8')
    const start = featureRolloutTs.indexOf(`${WEEKLY_SPLIT_SNAPSHOT_FEATURE_KEY}: {`)
    expect(start).toBeGreaterThan(-1)
    const entry = featureRolloutTs.slice(start, featureRolloutTs.indexOf('},', start))
    expect(entry).toContain(`scope: '${WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE}'`)
  })
})

describe('resolveSnapshotWriteFormat(一方通行・AC-27)', () => {
  it('分割形式の教室はフラグ OFF でも分割形式のまま(旧形式へ戻さない)', () => {
    expect(resolveSnapshotWriteFormat({ previousIsPartsManifest: true, flagEnabled: false })).toBe('weekly-parts')
    expect(resolveSnapshotWriteFormat({ previousIsPartsManifest: true, flagEnabled: true })).toBe('weekly-parts')
  })
  it('旧形式(または文書なし)の教室はフラグ ON なら移行・OFF なら旧形式のまま', () => {
    expect(resolveSnapshotWriteFormat({ previousIsPartsManifest: false, flagEnabled: true })).toBe('weekly-parts')
    expect(resolveSnapshotWriteFormat({ previousIsPartsManifest: false, flagEnabled: false })).toBe('legacy')
  })
})

describe('古い画面からの保存の拒否(CLIENT_TOO_OLD・§9-7-3・AC-18)', () => {
  it('段階 A の版(v1.5.651)以上なら受け付け、古い・無い・読めない版は拒否', () => {
    expect(SNAPSHOT_PARTS_MIN_CLIENT_APP_VERSION).toBe('1.5.651')
    expect(isClientNewEnoughForSnapshotParts('1.5.651')).toBe(true)
    expect(isClientNewEnoughForSnapshotParts('v1.5.651')).toBe(true)
    expect(isClientNewEnoughForSnapshotParts('1.5.700')).toBe(true)
    expect(isClientNewEnoughForSnapshotParts('1.6.0')).toBe(true)
    expect(isClientNewEnoughForSnapshotParts('2.0.0')).toBe(true)
    expect(isClientNewEnoughForSnapshotParts('1.5.650')).toBe(false)
    expect(isClientNewEnoughForSnapshotParts('1.4.999')).toBe(false)
    expect(isClientNewEnoughForSnapshotParts('')).toBe(false)
    expect(isClientNewEnoughForSnapshotParts(undefined)).toBe(false)
    expect(isClientNewEnoughForSnapshotParts('dev')).toBe(false)
  })

  it('版の比較は数値で行う(文字列比較で 1.5.1000 < 1.5.651 にならない)', () => {
    expect(parseAppVersion('1.5.1000')).toEqual([1, 5, 1000])
    expect(compareAppVersions([1, 5, 1000], [1, 5, 651])).toBeGreaterThan(0)
    expect(isClientNewEnoughForSnapshotParts('1.5.1000')).toBe(true)
    expect(parseAppVersion('1.5')).toBeNull()
  })

  it('文言は先頭にマーカー・再読み込みの案内(内部語なし)', () => {
    const message = buildClientTooOldMessage()
    expect(message.startsWith(`${CLIENT_TOO_OLD_ERROR_MARKER}:`)).toBe(true)
    expect(message).toContain('再読み込み')
    expect(message).not.toMatch(/Firebase|ワークスペース|manifest|parts/i)
  })
})
