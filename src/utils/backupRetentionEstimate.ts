// サーバー自動バックアップの「保持される概算本数」(開発者画面の容量見積りに使う)。
//
// ★数値は functions/src/workspaceBackupSchedule.ts の保持定数と**同じ値**にする(正本は docs/spec-save-restore.md §8-2)。
//   過去に「サーバー側だけ短縮してこの見積りが取り残される」ドリフト(7a9b1e2 で修正)と、
//   「サーバー側だけ 400 日へ延長してここが 7 日のまま」(2026-09-04 INV 監査で検出)が起きたため、
//   App.tsx から切り出してスペックロックテスト(backupRetentionEstimate.test.ts)で固定する。
//   保持期間を変えるときは functions 側の定数・§8-2・このファイル・両テストを同一コミットで更新すること。

/** 24 時間分は 15 分毎そのまま = 96 本 */
export const SERVER_AUTO_BACKUP_FULL_RESOLUTION_COUNT = 24 * 4
/** 24〜72 時間帯は毎時 1 本 = 48 本 */
export const SERVER_AUTO_BACKUP_HOURLY_THINNED_COUNT = 72 - 24
/** 72 時間〜400 日帯は日次(JST 3:00)1 本 = 397 本(2026-09-04 に 7 日→400 日へ延長) */
export const SERVER_AUTO_BACKUP_DAILY_RETENTION_DAYS = 400
export const SERVER_AUTO_BACKUP_DAILY_THINNED_COUNT = SERVER_AUTO_BACKUP_DAILY_RETENTION_DAYS - 3
export const SERVER_AUTO_BACKUP_ESTIMATED_RETAINED_COUNT = SERVER_AUTO_BACKUP_FULL_RESOLUTION_COUNT
  + SERVER_AUTO_BACKUP_HOURLY_THINNED_COUNT
  + SERVER_AUTO_BACKUP_DAILY_THINNED_COUNT
