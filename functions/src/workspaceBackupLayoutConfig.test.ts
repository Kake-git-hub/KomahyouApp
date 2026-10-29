import { describe, expect, it } from 'vitest'

import { parseWorkspaceAutoBackupLayoutConfig, readBackupDownloadPurpose, resolveWorkspaceAutoBackupLayout, WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT } from './workspaceBackupLayoutConfig'

describe('自動バックアップの書く形式の設定(WORKSPACE_AUTO_BACKUP_LAYOUT・§10-7)', () => {
  it('コードの既定は教室別形式(2026-10-30 v1.5.663 オーナー選択 A)。戻すときは定数を legacy に戻す(スペックロック)', () => {
    expect(WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT).toBe('per-classroom-v1')
  })

  it('未設定・空はコードの既定。env の legacy / per-classroom-v1 は明示の上書き', () => {
    expect(parseWorkspaceAutoBackupLayoutConfig({}).defaultLayout).toBe(WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT)
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: '' }).defaultLayout).toBe(WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT)
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: ' legacy ' }).defaultLayout).toBe('legacy')
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'per-classroom-v1' }).defaultLayout).toBe('per-classroom-v1')
  })

  it('知らない値はコードの既定として扱い、警告を返す(打ち間違いでバックアップが止まらない)', () => {
    const config = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'per-classroom' })
    expect(config.defaultLayout).toBe(WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT)
    expect(config.warnings).toHaveLength(1)
    expect(config.warnings[0]).toContain('per-classroom')
  })

  it('会社ごとの指定は key=layout のカンマ区切り。会社指定 → 既定の順で解決する', () => {
    const config = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'legacy', WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES: ' main = per-classroom-v1 , demo=legacy ' })
    expect(resolveWorkspaceAutoBackupLayout('main', config)).toBe('per-classroom-v1')
    expect(resolveWorkspaceAutoBackupLayout('demo', config)).toBe('legacy')
    expect(resolveWorkspaceAutoBackupLayout('other', config)).toBe('legacy')
    expect(config.warnings).toEqual([])
    const flipped = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'per-classroom-v1', WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES: 'demo=legacy' })
    expect(resolveWorkspaceAutoBackupLayout('main', flipped)).toBe('per-classroom-v1')
    expect(resolveWorkspaceAutoBackupLayout('demo', flipped)).toBe('legacy')
  })

  it('会社指定の壊れた項目(= が無い・知らない layout・空の key)は無視して警告にする', () => {
    const config = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES: 'main,=per-classroom-v1,demo=v9,empty=,ok=per-classroom-v1' })
    expect([...config.overrides.entries()]).toEqual([['ok', 'per-classroom-v1']])
    expect(config.warnings).toHaveLength(4)
  })
})

describe('復元用ダウンロードの目的(readBackupDownloadPurpose・§10-5 Q8)', () => {
  it("'local-sync' だけが控えを書かない目的。未指定(古い画面)・'restore'・知らない値は 'restore'(控えを書く・BK-7)", () => {
    expect(readBackupDownloadPurpose('local-sync')).toBe('local-sync')
    expect(readBackupDownloadPurpose('restore')).toBe('restore')
    expect(readBackupDownloadPurpose(undefined)).toBe('restore')
    expect(readBackupDownloadPurpose(null)).toBe('restore')
    expect(readBackupDownloadPurpose('x')).toBe('restore')
    expect(readBackupDownloadPurpose(1)).toBe('restore')
  })
})
