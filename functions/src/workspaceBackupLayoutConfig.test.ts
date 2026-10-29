import { describe, expect, it } from 'vitest'

import { parseWorkspaceAutoBackupLayoutConfig, resolveWorkspaceAutoBackupLayout } from './workspaceBackupLayoutConfig'

describe('自動バックアップの書く形式の設定(WORKSPACE_AUTO_BACKUP_LAYOUT・§10-7)', () => {
  it('未設定・空・legacy は旧形式(既定)。per-classroom-v1 で教室別形式', () => {
    expect(parseWorkspaceAutoBackupLayoutConfig({}).defaultLayout).toBe('legacy')
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: '' }).defaultLayout).toBe('legacy')
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: ' legacy ' }).defaultLayout).toBe('legacy')
    expect(parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'per-classroom-v1' }).defaultLayout).toBe('per-classroom-v1')
  })

  it('知らない値は旧形式として扱い、警告を返す(打ち間違いでバックアップが止まらない)', () => {
    const config = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT: 'per-classroom' })
    expect(config.defaultLayout).toBe('legacy')
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
    const config = parseWorkspaceAutoBackupLayoutConfig({ WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES: 'main,=per-classroom-v1,demo=v9,ok=per-classroom-v1' })
    expect([...config.overrides.entries()]).toEqual([['ok', 'per-classroom-v1']])
    expect(config.warnings).toHaveLength(3)
  })
})
