// ワークスペース自動バックアップの粒度・保持期間の純ロジック(firebase 非依存・テスト可能)。
//
// 2026-07-10 オーナー確定: 生成は15分毎(quarterHourly)の1本に一本化し、保持はプルーン時の
// 経過時間ベースの間引きで実現する(毎時生成・日次生成のスケジュール関数は廃止)。
// 「Storageで保持する回」と「Google Driveへミラーする回」は同じ判定を共有する(統一設計)。
// index.ts はスケジュール関数・Firestore/Storage I/O のみを担い、
// 日時計算・パス組み立て・保持判定はすべてここへ集約する(index.ts から新規 export しない=
// Firebase が export をそのまま関数としてデプロイするため、誤って新規関数がデプロイされる事故を防ぐ)。

// WorkspaceAutoBackupKind: 過去に生成された既存ドキュメントの表示ラベル解決のためだけに残す
// (新規生成は全て 'quarterHourly' になるが、既存の古いドキュメントが残存期間中は正しく表示され続ける必要がある)。
export type WorkspaceAutoBackupKind = 'daily' | 'hourly' | 'quarterHourly'

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
// 「Storageで保持する回」と「Google Driveへミラーする回」は同じ判定を共有する(統一設計)。
export const WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS = 24
export const WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS = 72
export const WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS = 7
export const WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST = 3

// バックアップの実時刻(savedAtMs)と現在時刻(nowMs)から、保持すべきかを判定する純関数。
// age<24h: 全保持(15分毎そのまま) / 24h≤age<72h: JSTで分=00のみ(実質毎時) /
// 72h≤age<7日: JSTで時=03かつ分=00のみ(実質日次AM3:00) / age≥7日: 削除。
// kind(生成種別)には依存しない(生成が15分毎1本化されたため、判定は実時刻だけで完結する)。
export function shouldKeepWorkspaceAutoBackup(params: { savedAtMs: number; nowMs: number }): boolean {
  const ageMs = params.nowMs - params.savedAtMs
  if (ageMs < WORKSPACE_BACKUP_FULL_RESOLUTION_RETENTION_HOURS * HOUR_IN_MS) return true
  if (ageMs >= WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS * 24 * HOUR_IN_MS) return false

  const jst = new Date(params.savedAtMs + JST_OFFSET_IN_MS)
  const minuteJst = jst.getUTCMinutes()
  if (ageMs < WORKSPACE_BACKUP_HOURLY_THINNED_RETENTION_HOURS * HOUR_IN_MS) {
    return minuteJst === 0
  }
  return jst.getUTCHours() === WORKSPACE_BACKUP_DAILY_THINNED_HOUR_JST && minuteJst === 0
}
