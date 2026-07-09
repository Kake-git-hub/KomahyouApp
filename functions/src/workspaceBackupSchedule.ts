// ワークスペース自動バックアップの粒度・保持期間の純ロジック(firebase 非依存・テスト可能)。
//
// 2026-07-09 オーナー確定: hourly(72h)+daily(14日) の2階層 から、
//  - 15分毎(quarterHourly): 保持 24時間
//  - 毎時(hourly): 保持 48時間(72h→48hへ短縮)
//  - 日次(daily): 保持 7日(14日→7日へ短縮)
// の3階層へ変更する。index.ts はスケジュール関数・Firestore/Storage I/O のみを担い、
// 日時計算・パス組み立て・保持判定はすべてここへ集約する(index.ts から新規 export しない=
// Firebase が export をそのまま関数としてデプロイするため、誤って新規関数がデプロイされる事故を防ぐ)。

export type WorkspaceAutoBackupKind = 'daily' | 'hourly' | 'quarterHourly'

export const WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS = 7
export const WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS = 48
export const WORKSPACE_QUARTER_HOURLY_AUTO_BACKUP_RETENTION_HOURS = 24

export const WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST = 2
export const HOUR_IN_MS = 60 * 60 * 1000
export const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS

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

export function toOperationalDateKeyJst(date: Date, boundaryHourJst = WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST) {
  const operationalDate = new Date(date.getTime() + JST_OFFSET_IN_MS - boundaryHourJst * HOUR_IN_MS)
  return toUtcDateKey(operationalDate)
}

export function toHourlyDateKeyJst(date: Date) {
  const jstDate = new Date(date.getTime() + JST_OFFSET_IN_MS)
  return toUtcHourKey(jstDate)
}

export function toQuarterHourlyDateKeyJst(date: Date) {
  return toUtcQuarterHourKey(new Date(date.getTime() + JST_OFFSET_IN_MS))
}

export function getWorkspaceDailyAutoBackupCutoffKey(referenceDate: Date, retentionDays: number) {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays) || 1)
  const operationalDate = new Date(referenceDate.getTime() + JST_OFFSET_IN_MS - WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST * HOUR_IN_MS)
  operationalDate.setUTCDate(operationalDate.getUTCDate() - (safeRetentionDays - 1))
  return toUtcDateKey(operationalDate)
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

export function shouldKeepAutoBackupSummary(
  kind: WorkspaceAutoBackupKind,
  params: { docId: string; savedAtMs: number },
  cutoffs: { dailyCutoffKey: string; hourlyCutoffTime: number; quarterHourlyCutoffTime: number },
): boolean {
  if (kind === 'daily') return params.docId >= cutoffs.dailyCutoffKey
  if (kind === 'hourly') return params.savedAtMs >= cutoffs.hourlyCutoffTime
  return params.savedAtMs >= cutoffs.quarterHourlyCutoffTime
}
