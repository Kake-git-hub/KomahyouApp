import { describe, expect, it } from 'vitest'

import {
  SERVER_AUTO_BACKUP_DAILY_RETENTION_DAYS,
  SERVER_AUTO_BACKUP_DAILY_THINNED_COUNT,
  SERVER_AUTO_BACKUP_ESTIMATED_RETAINED_COUNT,
  SERVER_AUTO_BACKUP_FULL_RESOLUTION_COUNT,
  SERVER_AUTO_BACKUP_HOURLY_THINNED_COUNT,
} from './backupRetentionEstimate'

// 保持期間のスペックロック(クライアント側)。functions/src/workspaceBackupSchedule.test.ts と対で、
// サーバーの保持定数(24h / 72h / 400日)とこの見積りがズレていないことを固定する
// (サーバー側だけ変えて見積りが取り残されるドリフトが 2 度起きた: 7a9b1e2 と 2026-09-04)。
describe('サーバー自動バックアップの保持本数見積り(docs/spec-save-restore.md §8-2 と一致)', () => {
  it('24時間=96本 / 24〜72時間=48本 / 72時間〜400日=397本 / 合計 541本', () => {
    expect(SERVER_AUTO_BACKUP_FULL_RESOLUTION_COUNT).toBe(96)
    expect(SERVER_AUTO_BACKUP_HOURLY_THINNED_COUNT).toBe(48)
    expect(SERVER_AUTO_BACKUP_DAILY_RETENTION_DAYS).toBe(400)
    expect(SERVER_AUTO_BACKUP_DAILY_THINNED_COUNT).toBe(397)
    expect(SERVER_AUTO_BACKUP_ESTIMATED_RETAINED_COUNT).toBe(541)
  })
})
