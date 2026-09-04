import { gunzipSync, gzipSync } from 'node:zlib'
// ワークスペース自動バックアップの粒度・保持期間の純ロジック(firebase 非依存・テスト可能)。
//
// 2026-07-10 オーナー確定: 生成は15分毎(quarterHourly)の1本に一本化し、保持はプルーン時の
// 経過時間ベースの間引きで実現する(毎時生成・日次生成のスケジュール関数は廃止)。
// 「Storageで保持する回」と「Google Driveへミラーする回」は同じ判定を共有する(統一設計)。
// ★2026-09-04 の意図的な非対称: Drive は gzip(.json.gz)でミラーし、旧来の非圧縮 .json だけ 7 日で間引く
//   (shouldKeepGoogleDriveBackupByName・docs/spec-save-restore.md §8-4 に明記)。保持の段階間引き自体は共通。
// index.ts はスケジュール関数・Firestore/Storage I/O のみを担い、
// 日時計算・パス組み立て・保持判定はすべてここへ集約する(index.ts から新規 export しない=
// Firebase が export をそのまま関数としてデプロイするため、誤って新規関数がデプロイされる事故を防ぐ)。

// WorkspaceAutoBackupKind: 過去に生成された既存ドキュメントの表示ラベル解決のためだけに残す
// (新規生成は全て 'quarterHourly' になるが、既存の古いドキュメントが残存期間中は正しく表示され続ける必要がある)。
export type WorkspaceAutoBackupKind = 'daily' | 'hourly' | 'quarterHourly'

export const HOUR_IN_MS = 60 * 60 * 1000
export const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS

// Google Drive のミラーは gzip(拡張子 .json.gz)。復元時は解凍すれば元の JSON とバイト単位で同一になる(可逆)。
export const GOOGLE_DRIVE_BACKUP_COMPRESSED_SUFFIX = '.json.gz'

export function isCompressedBackupFileName(name: string | undefined) {
  return typeof name === 'string' && name.toLowerCase().endsWith(GOOGLE_DRIVE_BACKUP_COMPRESSED_SUFFIX)
}

export function compressBackupJson(json: string): Buffer {
  return gzipSync(Buffer.from(json, 'utf8'))
}

export function decompressBackupJson(compressed: Buffer): string {
  return gunzipSync(compressed).toString('utf8')
}

// Google Drive 側の保持判定。圧縮ファイル(.json.gz)は Storage と同じ段階間引き(日次 400 日)、
// 旧来の非圧縮ファイル(.json)は Drive の容量を圧迫するので **7 日**で従来どおり間引く(移行期間の暫定)。
export function shouldKeepGoogleDriveBackupByName(params: { name: string | undefined; savedAtMs: number; nowMs: number }): boolean {
  if (isCompressedBackupFileName(params.name)) {
    return shouldKeepWorkspaceAutoBackup({ savedAtMs: params.savedAtMs, nowMs: params.nowMs })
  }
  return shouldKeepWorkspaceAutoBackup({
    savedAtMs: params.savedAtMs,
    nowMs: params.nowMs,
    dailyRetentionDays: WORKSPACE_BACKUP_LEGACY_UNCOMPRESSED_DRIVE_RETENTION_DAYS,
  })
}

export function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toUtcHourKey(date: Date) {
  const dateKey = toUtcDateKey(date)
  const hour = `${date.getUTCHours()}`.padStart(2, '0')
  return `${dateKey}T${hour}`
}

// docId に コロン(:)は使えないため、時と分の区切りは `-`(例: 14:07 切り捨て→ `14-00`)。
export function toUtcQuarterHourKey(date: Date) {
  const dateKey = toUtcDateKey(date)
  const hour = `${date.getUTCHours()}`.padStart(2, '0')
  const minute = `${Math.floor(date.getUTCMinutes() / 15) * 15}`.padStart(2, '0')
  return `${dateKey}T${hour}-${minute}`
}

export function toQuarterHourlyDateKeyJst(date: Date) {
  return toUtcQuarterHourKey(new Date(date.getTime() + JST_OFFSET_IN_MS))
}

export function buildWorkspaceAutoBackupStoragePath(workspaceKey: string, backupDateKey: string, backupKind: WorkspaceAutoBackupKind = 'daily') {
  if (backupKind === 'quarterHourly') {
    return `workspace-auto-backups/${workspaceKey}/15min/${backupDateKey}.json`
  }
  if (backupKind === 'hourly') {
    return `workspace-auto-backups/${workspaceKey}/hourly/${backupDateKey}.json`
  }
  return `workspace-auto-backups/${workspaceKey}/${backupDateKey}.json`
}

export function buildWorkspaceAutoBackupDisplayLabel(backupDateKey: string, backupKind: WorkspaceAutoBackupKind) {
  if (backupKind === 'quarterHourly') {
    const [datePart, timePart = '00-00'] = backupDateKey.split('T')
    const [hourPart = '00', minutePart = '00'] = timePart.split('-')
    return `${datePart} ${hourPart}:${minutePart} 15分毎`
  }
  if (backupKind === 'hourly') {
    const [datePart, hourPart = '00'] = backupDateKey.split('T')
    return `${datePart} ${hourPart}:10 毎時`
  }
  return `${backupDateKey} 日次`
}

// summary.backupKind が保存されていないレガシー文書向けのフォールバック判定。
// docId の 'T' 以降に '-' を含む → quarterHourly(例: 2026-07-09T14-15) / 'T' を含む → hourly(例: 2026-07-09T14) / それ以外 → daily。
export function resolveBackupKindFromSummary(backupKind: unknown, docId: string): WorkspaceAutoBackupKind {
  if (backupKind === 'quarterHourly') return 'quarterHourly'
  if (backupKind === 'hourly') return 'hourly'
  if (backupKind === 'daily') return 'daily'

  const tIndex = docId.indexOf('T')
  if (tIndex === -1) return 'daily'
  const afterT = docId.slice(tIndex + 1)
  return afterT.includes('-') ? 'quarterHourly' : 'hourly'
}

// 2026-07-10 オーナー確定: 生成は15分毎(quarterHourly)の1本に一本化し、保持はプルーン時の
// 経過時間ベースの間引きで実現する(毎時生成・日次生成のスケジュール関数は廃止)。
// 「Storageで保持する回」と「Google Driveへミラーする回」は同じ段階間引きを共有する(旧来の非圧縮 Drive ファイルだけ 7 日)。
export const WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS = 24
export const WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS = 72
// 2026-09-04 オーナー確定: 日次(JST 3:00)は **400 日**保持へ延長(「1年分を盤面ごと振り返れる」ため。
// 緑が丘の調査で 8/29 以前が検証不能だった教訓)。Storage/Firestore は非圧縮のまま、Google Drive 側は gzip で
// ミラーする(15GB 上限のため)。旧来の非圧縮 Drive ファイル(.json)は 7 日で従来どおり間引く(下記)。
export const WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS = 400
export const WORKSPACE_BACKUP_LEGACY_UNCOMPRESSED_DRIVE_RETENTION_DAYS = 7
export const WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST = 3

// 静音時間帯(JST 3:00〜9:00・ユーザーが操作しない早朝)はバックアップ生成をスキップし取得回数を抑える
// (オーナー確定 2026-07-10)。ただし日次保持アンカーの 3:00(WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST)だけは
// 取得する — これを取らないと 72h〜7日帯の日次バックアップ(3:00のみ保持)が丸ごと存在しなくなるため。
// 実質のスキップ帯は 3:15〜8:45、9:00 から通常の15分毎へ復帰する。
export const WORKSPACE_BACKUP_QUIET_HOURS_START_JST = 3
export const WORKSPACE_BACKUP_QUIET_HOURS_END_JST = 9

export function isWorkspaceAutoBackupSkippedAt(date: Date): boolean {
  const jst = new Date(date.getTime() + JST_OFFSET_IN_MS)
  const hourJst = jst.getUTCHours()
  const minuteJst = jst.getUTCMinutes()
  // 日次アンカー(3:00)は静音帯でも必ず取得する。
  if (hourJst === WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST && minuteJst === 0) return false
  return hourJst >= WORKSPACE_BACKUP_QUIET_HOURS_START_JST && hourJst < WORKSPACE_BACKUP_QUIET_HOURS_END_JST
}

// バックアップの実時刻(savedAtMs)と現在時刻(nowMs)から、保持すべきかを判定する純関数。
// age<24h: 全保持(15分毎そのまま) / 24h≤age<72h: JSTで分=00のみ(実質毎時) /
// 72h≤age<400日: JSTで時=03かつ分=00のみ(実質日次AM3:00) / age≥400日: 削除(2026-09-04 に 7日→400日)。
// dailyRetentionDays を渡すと日次帯の上限だけ差し替えられる(旧来の非圧縮 Drive ファイル用の 7 日)。
// kind(生成種別)には依存しない(生成が15分毎1本化されたため、判定は実時刻だけで完結する)。
export function shouldKeepWorkspaceAutoBackup(params: { savedAtMs: number; nowMs: number; dailyRetentionDays?: number }): boolean {
  const ageMs = params.nowMs - params.savedAtMs
  const dailyRetentionDays = params.dailyRetentionDays ?? WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS
  if (ageMs < WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS * HOUR_IN_MS) return true
  if (ageMs >= dailyRetentionDays * 24 * HOUR_IN_MS) return false

  const jst = new Date(params.savedAtMs + JST_OFFSET_IN_MS)
  const minuteJst = jst.getUTCMinutes()
  if (ageMs < WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS * HOUR_IN_MS) {
    return minuteJst === 0
  }
  return jst.getUTCHours() === WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST && minuteJst === 0
}
