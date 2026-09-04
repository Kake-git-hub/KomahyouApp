import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAutoBackupDisplayLabel,
  buildWorkspaceAutoBackupStoragePath,
  HOUR_IN_MS,
  isWorkspaceAutoBackupSkippedAt,
  resolveBackupKindFromSummary,
  shouldKeepWorkspaceAutoBackup,
  toQuarterHourlyDateKeyJst,
  toUtcDateKey,
  toUtcHourKey,
  toUtcQuarterHourKey,
  WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST,
  WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS,
  WORKSPACE_BACKUP_LEGACY_UNCOMPRESSED_DRIVE_RETENTION_DAYS,
  WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS,
  compressBackupJson,
  decompressBackupJson,
  isCompressedBackupFileName,
  shouldKeepGoogleDriveBackupByName,
  WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS,
  WORKSPACE_BACKUP_QUIET_HOURS_END_JST,
  WORKSPACE_BACKUP_QUIET_HOURS_START_JST,
} from './workspaceBackupSchedule'

// 保持期間のスペックロック（正本: docs/spec-save-restore.md §8「データ保持期間」8-2）。
// 保持期間はユーザーへの約束であり、コードの都合で黙って変えてよい数値ではない。
// この値を変えるときは §8 の表・CHANGELOG.md と**同じコミット**で更新すること
// （過去に App.tsx 側の保持本数の見積りだけが短縮反映漏れになったドリフト事故があるため、
//   数値そのものをテストで固定して静かなズレを検知する）。
describe('保持期間のスペックロック（docs/spec-save-restore.md §8-2）', () => {
  it('自動バックアップの段階間引きは 24時間 / 72時間 / 400日、日次アンカーは JST 3:00(2026-09-04 オーナー確定)', () => {
    expect(WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS).toBe(24)
    expect(WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS).toBe(72)
    expect(WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS).toBe(400)
    expect(WORKSPACE_BACKUP_LEGACY_UNCOMPRESSED_DRIVE_RETENTION_DAYS).toBe(7)
    expect(WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST).toBe(3)
  })

  it('静音時間帯は JST 3:00〜9:00（実質 3:15〜8:45・3:00 の日次アンカーだけは取得）', () => {
    expect(WORKSPACE_BACKUP_QUIET_HOURS_START_JST).toBe(3)
    expect(WORKSPACE_BACKUP_QUIET_HOURS_END_JST).toBe(9)
    // 日次アンカーが静音帯に飲み込まれると 72時間〜7日帯が丸ごと消える（§8-2 の注記）。
    expect(WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST).toBeGreaterThanOrEqual(WORKSPACE_BACKUP_QUIET_HOURS_START_JST)
    expect(WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST).toBeLessThan(WORKSPACE_BACKUP_QUIET_HOURS_END_JST)
    expect(isWorkspaceAutoBackupSkippedAt(new Date('2026-07-09T18:00:00Z'))).toBe(false) // JST 03:00
  })

  it('400日を超えたバックアップは種別・時刻によらず必ず削除される（遡れる上限＝400日）', () => {
    const savedAtMs = new Date('2026-07-03T18:00:00Z').getTime() // JST 2026-07-04 03:00（日次アンカー）
    const overRetention = savedAtMs + (WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS * 24 + 1) * HOUR_IN_MS
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs: overRetention })).toBe(false)
  })
})

describe('isWorkspaceAutoBackupSkippedAt (静音時間帯 JST 3:15〜8:45 をスキップ・3:00は取得)', () => {
  // JST = UTC+9。UTC 18:00 = JST 翌 03:00。
  const at = (utcIso: string) => isWorkspaceAutoBackupSkippedAt(new Date(utcIso))

  it('日次アンカーの JST 3:00 は取得する(スキップしない)', () => {
    expect(at('2026-07-09T18:00:00Z')).toBe(false) // JST 2026-07-10 03:00
  })
  it('JST 3:15 はスキップする', () => {
    expect(at('2026-07-09T18:15:00Z')).toBe(true) // JST 03:15
  })
  it('JST 3:45 はスキップする', () => {
    expect(at('2026-07-09T18:45:00Z')).toBe(true) // JST 03:45
  })
  it('JST 4:00〜8:45 はスキップする', () => {
    expect(at('2026-07-09T19:00:00Z')).toBe(true) // JST 04:00
    expect(at('2026-07-09T23:45:00Z')).toBe(true) // JST 08:45
    expect(at('2026-07-09T23:00:00Z')).toBe(true) // JST 08:00
  })
  it('JST 9:00 から通常の取得へ復帰する(スキップしない)', () => {
    expect(at('2026-07-10T00:00:00Z')).toBe(false) // JST 09:00
    expect(at('2026-07-10T00:15:00Z')).toBe(false) // JST 09:15
  })
  it('静音帯の直前 JST 2:45 は取得する(スキップしない)', () => {
    expect(at('2026-07-09T17:45:00Z')).toBe(false) // JST 02:45
  })
  it('昼間(JST 12:00)は取得する', () => {
    expect(at('2026-07-10T03:00:00Z')).toBe(false) // JST 12:00
  })
})

describe('Google Drive ミラーの圧縮と保持(2026-09-04)', () => {
  it('gzip は可逆: 圧縮→解凍で元の JSON と完全一致する', () => {
    const json = JSON.stringify({ classrooms: [{ id: 'c1', name: 'スクールIE 緑が丘校', data: { weeks: [[{ dateKey: '2026-09-04' }]] } }], savedAt: '2026-09-04T00:00:00.000Z' }, null, 2)
    const compressed = compressBackupJson(json)
    expect(compressed.length).toBeLessThan(Buffer.byteLength(json, 'utf8'))
    expect(decompressBackupJson(compressed)).toBe(json)
    expect(JSON.parse(decompressBackupJson(compressed))).toEqual(JSON.parse(json))
  })

  it('圧縮ファイル(.json.gz)は Storage と同じ 400 日、旧来の非圧縮(.json)は 7 日で間引く', () => {
    const nowAt3am = new Date('2026-07-10T18:00:00Z').getTime() // JST 03:00
    const tenDaysAgo = nowAt3am - 10 * 24 * HOUR_IN_MS
    expect(isCompressedBackupFileName('komahyouapp_main_quarterHourly_2026-07-01T03-00.json.gz')).toBe(true)
    expect(isCompressedBackupFileName('komahyouapp_main_quarterHourly_2026-07-01T03-00.json')).toBe(false)
    expect(shouldKeepGoogleDriveBackupByName({ name: 'x.json.gz', savedAtMs: tenDaysAgo, nowMs: nowAt3am })).toBe(true)
    expect(shouldKeepGoogleDriveBackupByName({ name: 'x.json', savedAtMs: tenDaysAgo, nowMs: nowAt3am })).toBe(false)
    // 7日未満の非圧縮は従来どおり残る
    expect(shouldKeepGoogleDriveBackupByName({ name: 'x.json', savedAtMs: nowAt3am - 5 * 24 * HOUR_IN_MS, nowMs: nowAt3am })).toBe(true)
  })
})

describe('toUtcDateKey', () => {
  it('UTC日付を YYYY-MM-DD 形式にする', () => {
    expect(toUtcDateKey(new Date('2026-07-09T14:07:00Z'))).toBe('2026-07-09')
    expect(toUtcDateKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05')
  })
})

describe('toUtcHourKey', () => {
  it('UTC日付+時を YYYY-MM-DDTHH 形式にする', () => {
    expect(toUtcHourKey(new Date('2026-07-09T14:07:00Z'))).toBe('2026-07-09T14')
    expect(toUtcHourKey(new Date('2026-07-09T04:59:00Z'))).toBe('2026-07-09T04')
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

// 2026-07-10 オーナー確定: 生成は15分毎(quarterHourly)の1本に一本化し、保持はプルーン時の
// 経過時間ベースの間引きで実現する。kind非依存・実時刻(savedAtMs/nowMs)だけで判定する。
describe('shouldKeepWorkspaceAutoBackup', () => {
  // 基準となる「今」: 2026-07-10T12:00:00Z (JST 21:00, 分=00・時=21)
  const nowMs = new Date('2026-07-10T12:00:00Z').getTime()

  it('age = 0(今作った) → 保持する', () => {
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowMs, nowMs })).toBe(true)
  })

  it('age = 23時間59分 → 24h未満は無条件で保持する', () => {
    const savedAtMs = nowMs - (23 * HOUR_IN_MS + 59 * 60 * 1000)
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })).toBe(true)
  })

  it('age = 24時間ちょうど、分=15のとき → 24h以降は分=00以外は保持しない', () => {
    // nowMsを分=15に合わせ、ちょうど24h前(分も15のまま)のsavedAtMsを使う。
    const nowMsAt15Min = new Date('2026-07-10T12:15:00Z').getTime() // JST 21:15
    const savedAtMs = nowMsAt15Min - 24 * HOUR_IN_MS // JST 2026-07-09 21:15、分=15
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs: nowMsAt15Min })).toBe(false)
  })

  it('age = 24時間ちょうど、分=00のとき → 保持する(実質毎時)', () => {
    const savedAtMs = nowMs - 24 * HOUR_IN_MS // JST 2026-07-09 21:00、分=00
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })).toBe(true)
  })

  it('age = 71時間59分、分=00 → 保持する', () => {
    // 分=00を保つため、72h境界の1分前ではなく60分前(=1時間前)を使う。
    const savedAtMs = nowMs - 71 * HOUR_IN_MS
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })).toBe(true)
  })

  it('age = 72時間ちょうど、分=00だが時=03でない → 72h以降は時03分00以外NG', () => {
    const savedAtMs = nowMs - 72 * HOUR_IN_MS // JST 2026-07-07 21:00、分=00・時=21
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })).toBe(false)
  })

  it('age = 72時間ちょうど、時=03かつ分=00 → 保持する', () => {
    // nowMs を JST 03:00 の3日後にずらしたケースで検証する。
    const nowAt3am = new Date('2026-07-10T18:00:00Z').getTime() // JST 2026-07-11 03:00
    const savedAtMs = nowAt3am - 72 * HOUR_IN_MS // JST 2026-07-08 03:00
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs: nowAt3am })).toBe(true)
  })

  it('age = 6日23時間59分、時=03分00 → 保持する', () => {
    // savedAtMs = JST 2026-07-04 03:00(時=03分00)から、ちょうど6日23時間59分後を nowMs とする。
    const savedAtMs = new Date('2026-07-03T18:00:00Z').getTime() // JST 2026-07-04 03:00
    const nowMsAtAge = savedAtMs + (6 * 24 * HOUR_IN_MS + 23 * HOUR_IN_MS + 59 * 60 * 1000)
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs: nowMsAtAge })).toBe(true)
  })

  it('age = 7日・8日でも時=03分00 なら保持する(日次は 400 日まで遡れる)', () => {
    const nowAt3am = new Date('2026-07-10T18:00:00Z').getTime() // JST 2026-07-11 03:00
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowAt3am - 7 * 24 * HOUR_IN_MS, nowMs: nowAt3am })).toBe(true)
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowAt3am - 8 * 24 * HOUR_IN_MS, nowMs: nowAt3am })).toBe(true)
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowAt3am - 399 * 24 * HOUR_IN_MS, nowMs: nowAt3am })).toBe(true)
  })

  it('age = 400日ちょうど → 無条件削除(時=03分00でも削除)', () => {
    const nowAt3am = new Date('2026-07-10T18:00:00Z').getTime() // JST 2026-07-11 03:00
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowAt3am - 400 * 24 * HOUR_IN_MS, nowMs: nowAt3am })).toBe(false)
  })

  it('age = 8日の 03:00 以外(例: 21:00)は 72h 以降なので削除する', () => {
    const nowMs2 = new Date('2026-07-10T12:00:00Z').getTime() // JST 21:00
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs: nowMs2 - 8 * 24 * HOUR_IN_MS, nowMs: nowMs2 })).toBe(false)
  })

  it('JSTオフセット(UTC+9)を跨ぐ境界(UTC 18:00=JST翌3:00)で正しく時=03と判定する', () => {
    // savedAtMs = UTC 2026-07-07T18:00:00Z = JST 2026-07-08 03:00 (時=03, 分=00)
    const savedAtMs = new Date('2026-07-07T18:00:00Z').getTime()
    // nowMs をちょうど72h後(72h帯の境界)に設定
    const nowMsAt72h = savedAtMs + 72 * HOUR_IN_MS
    expect(shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs: nowMsAt72h })).toBe(true)
  })
})
