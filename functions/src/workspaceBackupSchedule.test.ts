import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAutoBackupDisplayLabel,
  buildWorkspaceAutoBackupStoragePath,
  HOUR_IN_MS,
  isGoogleDriveDailyPruneRunAt,
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
  serializeWorkspaceBackupJson,
  shouldKeepWorkspaceIncidentBackup,
  WORKSPACE_INCIDENT_BACKUP_RETENTION_DAYS,
  WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS,
  WORKSPACE_BACKUP_QUIET_HOURS_END_JST,
  WORKSPACE_BACKUP_QUIET_HOURS_START_JST,
  buildClassroomSaveHistoryStoragePath,
  CLASSROOM_SAVE_HISTORY_PREFIX,
  CLASSROOM_SAVE_HISTORY_RETENTION_DAYS,
  shouldKeepClassroomSaveHistory,
  toStorageSafeTimestampKey,
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

// ★2026-09-04: Storage / Drive へ書き出す JSON の整形をやめた(1本 54.3MB → 24.1MB)。
// 読み出し側は JSON.parse なので整形の有無に依存しない = 既存の整形済みファイルも読める(復元仕様は不変)。
describe('serializeWorkspaceBackupJson', () => {
  const snapshot = {
    schemaVersion: 1,
    savedAt: '2026-09-04T01:15:04.205Z',
    classrooms: [{ id: 'c1', name: 'テスト教室', data: { board: [1, 2, 3] } }],
  }

  it('字下げ・改行を含まない(整形へ戻すと容量が2倍以上になる)', () => {
    // 整形の有無は JSON.stringify の既定出力(字下げなし)と一致するかで固定する。
    expect(serializeWorkspaceBackupJson(snapshot)).toBe(JSON.stringify(snapshot))
  })

  it('整形版と同じ内容へ復元できる(復元仕様は不変)', () => {
    expect(JSON.parse(serializeWorkspaceBackupJson(snapshot))).toEqual(snapshot)
    // 既存の整形済みファイルも同じ内容として読めることを明示しておく。
    expect(JSON.parse(JSON.stringify(snapshot, null, 2))).toEqual(snapshot)
  })

  it('整形版より確実に小さい', () => {
    const compact = serializeWorkspaceBackupJson(snapshot).length
    const pretty = JSON.stringify(snapshot, null, 2).length
    expect(compact).toBeLessThan(pretty)
  })

  it('gzip ミラー(Drive)も同じ最小化 JSON から作れる', () => {
    const json = serializeWorkspaceBackupJson(snapshot)
    expect(decompressBackupJson(compressBackupJson(json))).toBe(json)
  })
})

// ★2026-09-04: workspace-incident-backups/ には自動削除が無く、本番に 3,978 本 = 46.8GB が残置されていた。
describe('shouldKeepWorkspaceIncidentBackup', () => {
  const nowMs = new Date('2026-09-04T00:00:00.000Z').getTime()
  const dayMs = 24 * HOUR_IN_MS

  it('保持期間の仕様ロック(変えるときは docs と CHANGELOG を同じコミットで更新する)', () => {
    expect(WORKSPACE_INCIDENT_BACKUP_RETENTION_DAYS).toBe(90)
  })

  it('保持期間内は残す', () => {
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: nowMs - 89 * dayMs, nowMs })).toBe(true)
  })

  it('保持期間ちょうどで削除対象になる', () => {
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: nowMs - 90 * dayMs, nowMs })).toBe(false)
  })

  it('2026年5月に集中していた残置分(約97日前)は削除対象', () => {
    const mayMs = new Date('2026-05-30T04:41:11.504Z').getTime()
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: mayMs, nowMs })).toBe(false)
  })

  it('作成時刻が不明なものは必ず残す(日付が読めないものを消さない)', () => {
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: 0, nowMs })).toBe(true)
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: Number.NaN, nowMs })).toBe(true)
  })

  it('未来日時(時計ずれ)も残す', () => {
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: nowMs + dayMs, nowMs })).toBe(true)
  })

  it('retentionDays を渡すと上書きできる', () => {
    expect(shouldKeepWorkspaceIncidentBackup({ createdAtMs: nowMs - 100 * dayMs, nowMs, retentionDays: 400 })).toBe(true)
  })
})

describe('保存ごとの教室版履歴(2026-10-22 案 1)', () => {
  const nowMs = new Date('2026-10-22T03:30:00.000Z').getTime()
  const dayMs = 24 * HOUR_IN_MS

  it('保持期間の仕様ロック(90 日・変えるときは docs/spec-save-restore.md §8-1 と CHANGELOG を同じコミットで)', () => {
    expect(CLASSROOM_SAVE_HISTORY_RETENTION_DAYS).toBe(90)
    expect(CLASSROOM_SAVE_HISTORY_PREFIX).toBe('classroom-save-history')
  })

  it('置き場所は 教室フォルダ/v版数(8 桁)-保存時刻.json.gz で、名前に : と . を含まない(名前順 = 保存順)', () => {
    const path = buildClassroomSaveHistoryStoragePath('main', 'cls1', '2026-10-22T06:32:10.123Z', 42)
    expect(path).toBe('classroom-save-history/main/cls1/v00000042-2026-10-22T06-32-10-123Z.json.gz')
    expect(path.split('/').pop()!.replace(/\.json\.gz$/u, '')).not.toMatch(/[:.]/u)
    // 版数順に並ぶ(端末の時計が前後していても、サーバーの版数が順序を決める・L-4)。
    const earlier = buildClassroomSaveHistoryStoragePath('main', 'cls1', '2026-10-22T06:32:11.000Z', 41)
    expect(earlier < path).toBe(true)
    expect(buildClassroomSaveHistoryStoragePath('main', 'cls1', '2026-10-22T06:32:10.000Z', 100) > path).toBe(true)
  })

  it('版数が読めない旧文書は v00000000、読めない時刻は epoch へ丸める(例外にしない)', () => {
    expect(buildClassroomSaveHistoryStoragePath('main', 'cls1', '2026-10-22T06:32:10.000Z', undefined)).toContain('/v00000000-')
    expect(buildClassroomSaveHistoryStoragePath('main', 'cls1', 'not-a-date', 3)).toBe('classroom-save-history/main/cls1/v00000003-1970-01-01T00-00-00-000Z.json.gz')
    expect(toStorageSafeTimestampKey('2026-10-22T06:32:10.123Z')).toBe('2026-10-22T06-32-10-123Z')
  })

  it('保持判定: 90 日未満は残し、90 日ちょうどで削除対象。時刻不明・未来は必ず残す', () => {
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: nowMs - 89 * dayMs, nowMs })).toBe(true)
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: nowMs - 90 * dayMs, nowMs })).toBe(false)
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: 0, nowMs })).toBe(true)
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: Number.NaN, nowMs })).toBe(true)
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: nowMs + dayMs, nowMs })).toBe(true)
    expect(shouldKeepClassroomSaveHistory({ createdAtMs: nowMs - 100 * dayMs, nowMs, retentionDays: 400 })).toBe(true)
  })
})

describe('isGoogleDriveDailyPruneRunAt (教室別形式の Drive の掃除は 1 日 1 回・JST 3:00 の回だけ・§10-6)', () => {
  it('日次アンカーの JST 3:00 の回(時点キーが T03-00)だけ true。実行開始が 3:01 や 3:14 にずれても同じ回', () => {
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T18:00:00Z'))).toBe(true) // JST 03:00
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T18:00:59Z'))).toBe(true)
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T18:01:30Z'))).toBe(true) // JST 03:01(起動の遅れ)
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T18:14:59Z'))).toBe(true) // JST 03:14 = まだ T03-00 の回
  })

  it('旧形式の 1 本のパスと教室別形式の時点フォルダは同じ階層(15min/{key})にある(権威の分散をパリティで固定・低-8)', async () => {
    const shared = await import('./generated/workspaceBackupLayout')
    const legacy = buildWorkspaceAutoBackupStoragePath('main', '2026-10-29T15-00', 'quarterHourly')
    expect(legacy).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00.json')
    expect(shared.buildWorkspaceBackupTimePointPrefix('main', '2026-10-29T15-00')).toBe(`${legacy.slice(0, -'.json'.length)}/`)
    expect(shared.parseWorkspaceBackupTimePointPath(`${legacy.slice(0, -'.json'.length)}/index.json`)?.backupDateKey).toBe('2026-10-29T15-00')
    expect(shared.parseWorkspaceBackupTimePointPath(legacy)).toBeNull()
  })

  it('3:15・2:45・昼間・UTC の 3:00(JST 12:00)は false', () => {
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T18:15:00Z'))).toBe(false)
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T17:45:00Z'))).toBe(false)
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T03:00:00Z'))).toBe(false)
    expect(isGoogleDriveDailyPruneRunAt(new Date('2026-07-09T12:00:00Z'))).toBe(false)
  })

  it('日次アンカー(静音帯でも必ず取る 3:00)と同じ回なので、スキップ判定とは両立する', () => {
    const anchor = new Date('2026-07-09T18:00:00Z')
    expect(isWorkspaceAutoBackupSkippedAt(anchor)).toBe(false)
    expect(isGoogleDriveDailyPruneRunAt(anchor)).toBe(true)
  })
})
