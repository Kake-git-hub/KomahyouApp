import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAutoBackupDisplayLabel,
  buildWorkspaceAutoBackupStoragePath,
  resolveBackupKindFromSummary,
  shouldKeepAutoBackupSummary,
  toQuarterHourlyDateKeyJst,
  toUtcQuarterHourKey,
  WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS,
  WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS,
  WORKSPACE_QUARTER_HOURLY_AUTO_BACKUP_RETENTION_HOURS,
} from './workspaceBackupSchedule'

// 2026-07-09 オーナー確定: 15分毎(新規・保持24h) + 毎時(保持72h→48h) + 日次(保持14日→7日) の3階層化。
// 保持定数の巻き戻り検知(値そのものを固定する回帰テスト)。
describe('保持期間の定数(巻き戻り検知)', () => {
  it('日次は7日・毎時は48時間・15分毎は24時間', () => {
    expect(WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS).toBe(7)
    expect(WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS).toBe(48)
    expect(WORKSPACE_QUARTER_HOURLY_AUTO_BACKUP_RETENTION_HOURS).toBe(24)
  })
})

describe('toUtcQuarterHourKey', () => {
  it('分を15分単位で切り捨てる(コロンではなくハイフン区切り)', () => {
    expect(toUtcQuarterHourKey(new Date('2026-07-09T14:07:00Z'))).toBe('2026-07-09T14-00')
    expect(toUtcQuarterHourKey(new Date('2026-07-09T14:23:00Z'))).toBe('2026-07-09T14-15')
    expect(toUtcQuarterHourKey(new Date('2026-07-09T14:59:00Z'))).toBe('2026-07-09T14-45')
  })
})

describe('toQuarterHourlyDateKeyJst', () => {
  it('JSTへ+9時間オフセットしてから15分単位に切り捨てる', () => {
    // 2026-07-09 05:07 UTC = 2026-07-09 14:07 JST -> 14-00
    expect(toQuarterHourlyDateKeyJst(new Date('2026-07-09T05:07:00Z'))).toBe('2026-07-09T14-00')
    // 2026-07-09 05:23 UTC = 2026-07-09 14:23 JST -> 14-15
    expect(toQuarterHourlyDateKeyJst(new Date('2026-07-09T05:23:00Z'))).toBe('2026-07-09T14-15')
    // 2026-07-09 05:59 UTC = 2026-07-09 14:59 JST -> 14-45
    expect(toQuarterHourlyDateKeyJst(new Date('2026-07-09T05:59:00Z'))).toBe('2026-07-09T14-45')
    // 日付をまたぐケース: 2026-07-09 15:07 UTC = 2026-07-10 00:07 JST -> 翌日 00-00
    expect(toQuarterHourlyDateKeyJst(new Date('2026-07-09T15:07:00Z'))).toBe('2026-07-10T00-00')
  })
})

describe('buildWorkspaceAutoBackupStoragePath', () => {
  it('3種類のkindでそれぞれ異なるStorageパスを組み立てる', () => {
    expect(buildWorkspaceAutoBackupStoragePath('main', '2026-07-09', 'daily')).toBe('workspace-auto-backups/main/2026-07-09.json')
    expect(buildWorkspaceAutoBackupStoragePath('main', '2026-07-09T14', 'hourly')).toBe('workspace-auto-backups/main/hourly/2026-07-09T14.json')
    expect(buildWorkspaceAutoBackupStoragePath('main', '2026-07-09T14-15', 'quarterHourly')).toBe('workspace-auto-backups/main/15min/2026-07-09T14-15.json')
  })
})

describe('buildWorkspaceAutoBackupDisplayLabel', () => {
  it('daily・hourlyの既存表示は不変', () => {
    expect(buildWorkspaceAutoBackupDisplayLabel('2026-07-09', 'daily')).toBe('2026-07-09 日次')
    expect(buildWorkspaceAutoBackupDisplayLabel('2026-07-09T14', 'hourly')).toBe('2026-07-09 14:10 毎時')
  })

  it('quarterHourlyは日付+時:分+「15分毎」を表示する', () => {
    expect(buildWorkspaceAutoBackupDisplayLabel('2026-07-09T14-15', 'quarterHourly')).toBe('2026-07-09 14:15 15分毎')
    expect(buildWorkspaceAutoBackupDisplayLabel('2026-07-09T00-00', 'quarterHourly')).toBe('2026-07-09 00:00 15分毎')
  })
})

describe('resolveBackupKindFromSummary', () => {
  it('明示的な backupKind が保存されていればそれを優先する', () => {
    expect(resolveBackupKindFromSummary('daily', 'anything')).toBe('daily')
    expect(resolveBackupKindFromSummary('hourly', 'anything')).toBe('hourly')
    expect(resolveBackupKindFromSummary('quarterHourly', 'anything')).toBe('quarterHourly')
  })

  it('レガシー文書(backupKind未保存)は docId のヒューリスティックでフォールバックする', () => {
    expect(resolveBackupKindFromSummary(undefined, '2026-07-09')).toBe('daily')
    expect(resolveBackupKindFromSummary(undefined, '2026-07-09T14')).toBe('hourly')
    expect(resolveBackupKindFromSummary(undefined, '2026-07-09T14-15')).toBe('quarterHourly')
  })

  it('不正な backupKind 値は無視して docId フォールバックへ回る', () => {
    expect(resolveBackupKindFromSummary('unknown-kind', '2026-07-09T14-15')).toBe('quarterHourly')
  })
})

describe('shouldKeepAutoBackupSummary', () => {
  const cutoffs = {
    dailyCutoffKey: '2026-07-03',
    hourlyCutoffTime: 1_000_000,
    quarterHourlyCutoffTime: 2_000_000,
  }

  it('daily: docId がカットオフ以上(丁度含む)なら保持する', () => {
    expect(shouldKeepAutoBackupSummary('daily', { docId: '2026-07-03', savedAtMs: 0 }, cutoffs)).toBe(true)
    expect(shouldKeepAutoBackupSummary('daily', { docId: '2026-07-04', savedAtMs: 0 }, cutoffs)).toBe(true)
  })

  it('daily: docId がカットオフより古ければ破棄する', () => {
    expect(shouldKeepAutoBackupSummary('daily', { docId: '2026-07-02', savedAtMs: 0 }, cutoffs)).toBe(false)
  })

  it('hourly: savedAtMs がカットオフ丁度(境界含む)なら保持、1msでも古いと破棄', () => {
    expect(shouldKeepAutoBackupSummary('hourly', { docId: 'x', savedAtMs: cutoffs.hourlyCutoffTime }, cutoffs)).toBe(true)
    expect(shouldKeepAutoBackupSummary('hourly', { docId: 'x', savedAtMs: cutoffs.hourlyCutoffTime - 1 }, cutoffs)).toBe(false)
  })

  it('quarterHourly: savedAtMs がカットオフ丁度(境界含む)なら保持、1msでも古いと破棄', () => {
    expect(shouldKeepAutoBackupSummary('quarterHourly', { docId: 'x', savedAtMs: cutoffs.quarterHourlyCutoffTime }, cutoffs)).toBe(true)
    expect(shouldKeepAutoBackupSummary('quarterHourly', { docId: 'x', savedAtMs: cutoffs.quarterHourlyCutoffTime - 1 }, cutoffs)).toBe(false)
  })
})
