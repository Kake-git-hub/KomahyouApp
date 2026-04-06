import type { AppSnapshot, WorkspaceSnapshot } from '../types/appState'

const DB_NAME = 'komahyouapp-storage'
const STORE_NAME = 'app-snapshots'
const AUTO_BACKUP_STORE_NAME = 'app-auto-backups'
const WORKSPACE_STORE_NAME = 'workspace-snapshots'
const WORKSPACE_AUTO_BACKUP_STORE_NAME = 'workspace-auto-backups'
const DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME = 'developer-cloud-backup-handle'
const SNAPSHOT_KEY = 'primary'
const LOCAL_STORAGE_KEY = 'komahyouapp:snapshot'
const LOCAL_STORAGE_AUTO_BACKUPS_KEY = 'komahyouapp:auto-backups'
const WORKSPACE_SNAPSHOT_KEY = 'primary'
const LOCAL_STORAGE_WORKSPACE_KEY = 'komahyouapp:workspace-snapshot'
const LOCAL_STORAGE_WORKSPACE_AUTO_BACKUPS_KEY = 'komahyouapp:workspace-auto-backups'
const DEVELOPER_CLOUD_BACKUP_HANDLE_KEY = 'primary'
const HOUR_IN_MS = 60 * 60 * 1000
const DAY_IN_MS = 24 * HOUR_IN_MS
const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS
const WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST = 2

export type AutoBackupSummary = {
  backupDateKey: string
  savedAt: string
}

export type WorkspaceAutoBackupEntry = {
  backupDateKey: string
  savedAt: string
  snapshot: WorkspaceSnapshot
}

type AutoBackupRecord = AutoBackupSummary & {
  snapshot: AppSnapshot
}

type WorkspaceAutoBackupRecord = AutoBackupSummary & {
  snapshot: WorkspaceSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isAppSnapshot(value: unknown): value is AppSnapshot {
  return isRecord(value)
    && typeof value.schemaVersion === 'number'
    && typeof value.savedAt === 'string'
    && typeof value.screen === 'string'
    && Array.isArray(value.managers)
    && Array.isArray(value.teachers)
    && Array.isArray(value.students)
    && Array.isArray(value.regularLessons)
    && Array.isArray(value.groupLessons)
    && Array.isArray(value.specialSessions)
    && Array.isArray(value.autoAssignRules)
    && Array.isArray(value.pairConstraints)
    && 'classroomSettings' in value
}

function isWorkspaceUser(value: unknown): value is WorkspaceSnapshot['users'][number] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.email === 'string'
    && (value.role === 'developer' || value.role === 'manager')
    && (typeof value.assignedClassroomId === 'string' || value.assignedClassroomId === null)
}

function isWorkspaceClassroom(value: unknown): value is WorkspaceSnapshot['classrooms'][number] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.contractStatus === 'active' || value.contractStatus === 'suspended')
    && typeof value.contractStartDate === 'string'
    && typeof value.contractEndDate === 'string'
    && typeof value.managerUserId === 'string'
    && (typeof value.isTemporarilySuspended === 'boolean' || typeof value.isTemporarilySuspended === 'undefined')
    && (typeof value.temporarySuspensionReason === 'string' || typeof value.temporarySuspensionReason === 'undefined')
    && isRecord(value.data)
    && isAppSnapshot({ ...value.data, schemaVersion: 1, savedAt: '1970-01-01T00:00:00.000Z' })
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  return isRecord(value)
    && typeof value.schemaVersion === 'number'
    && typeof value.savedAt === 'string'
    && (typeof value.developerPassword === 'string' || typeof value.developerPassword === 'undefined')
    && (typeof value.developerCloudBackupEnabled === 'boolean' || typeof value.developerCloudBackupEnabled === 'undefined')
    && (typeof value.developerCloudBackupFolderName === 'string' || typeof value.developerCloudBackupFolderName === 'undefined')
    && (Array.isArray(value.developerCloudSyncedAutoBackupKeys) || typeof value.developerCloudSyncedAutoBackupKeys === 'undefined')
    && typeof value.currentUserId === 'string'
    && (typeof value.actingClassroomId === 'string' || value.actingClassroomId === null)
    && Array.isArray(value.classrooms)
    && value.classrooms.every((entry) => isWorkspaceClassroom(entry))
    && Array.isArray(value.users)
    && value.users.every((entry) => isWorkspaceUser(entry))
}

function isAutoBackupRecord(value: unknown): value is AutoBackupRecord {
  return isRecord(value)
    && typeof value.backupDateKey === 'string'
    && typeof value.savedAt === 'string'
    && isAppSnapshot(value.snapshot)
}

function isWorkspaceAutoBackupRecord(value: unknown): value is WorkspaceAutoBackupRecord {
  return isRecord(value)
    && typeof value.backupDateKey === 'string'
    && typeof value.savedAt === 'string'
    && isWorkspaceSnapshot(value.snapshot)
}

function isAutoBackupRecordList(value: unknown): value is AutoBackupRecord[] {
  return Array.isArray(value) && value.every((entry) => isAutoBackupRecord(entry))
}

function isWorkspaceAutoBackupRecordList(value: unknown): value is WorkspaceAutoBackupRecord[] {
  return Array.isArray(value) && value.every((entry) => isWorkspaceAutoBackupRecord(entry))
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toOperationalDateKeyJst(date: Date, boundaryHourJst = WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST) {
  const operationalDate = new Date(date.getTime() + JST_OFFSET_IN_MS - boundaryHourJst * HOUR_IN_MS)
  return toUtcDateKey(operationalDate)
}

function sortBackupRecords<T extends AutoBackupSummary>(records: T[]) {
  return records.slice().sort((left, right) => {
    const dateCompare = right.backupDateKey.localeCompare(left.backupDateKey)
    if (dateCompare !== 0) return dateCompare
    return right.savedAt.localeCompare(left.savedAt)
  })
}

function summarizeBackupRecords<T extends AutoBackupSummary>(records: T[]): AutoBackupSummary[] {
  return sortBackupRecords(records).map(({ backupDateKey, savedAt }) => ({ backupDateKey, savedAt }))
}

function pruneBackupRecords<T extends AutoBackupSummary>(records: T[], retentionDays: number, referenceDate: Date) {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays) || 1)
  const cutoffDate = new Date(referenceDate)
  cutoffDate.setHours(0, 0, 0, 0)
  cutoffDate.setDate(cutoffDate.getDate() - (safeRetentionDays - 1))
  const cutoffKey = toDateKey(cutoffDate)
  return sortBackupRecords(records).filter((record) => record.backupDateKey >= cutoffKey)
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 4)

    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けませんでした。'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
      if (!database.objectStoreNames.contains(AUTO_BACKUP_STORE_NAME)) {
        database.createObjectStore(AUTO_BACKUP_STORE_NAME, { keyPath: 'backupDateKey' })
      }
      if (!database.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        database.createObjectStore(WORKSPACE_STORE_NAME)
      }
      if (!database.objectStoreNames.contains(WORKSPACE_AUTO_BACKUP_STORE_NAME)) {
        database.createObjectStore(WORKSPACE_AUTO_BACKUP_STORE_NAME, { keyPath: 'backupDateKey' })
      }
      if (!database.objectStoreNames.contains(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME)) {
        database.createObjectStore(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function readFromIndexedDb(): Promise<AppSnapshot | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(SNAPSHOT_KEY)

    request.onerror = () => reject(request.error ?? new Error('保存済みスナップショットの読込に失敗しました。'))
    request.onsuccess = () => {
      const result = request.result
      resolve(isAppSnapshot(result) ? result : null)
    }
    transaction.oncomplete = () => database.close()
  })
}

async function writeToIndexedDb(snapshot: AppSnapshot) {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(snapshot, SNAPSHOT_KEY)

    request.onerror = () => reject(request.error ?? new Error('保存済みスナップショットの書込に失敗しました。'))
    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('保存済みスナップショットの書込に失敗しました。'))
  })
}

async function readWorkspaceFromIndexedDb(): Promise<WorkspaceSnapshot | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE_NAME, 'readonly')
    const store = transaction.objectStore(WORKSPACE_STORE_NAME)
    const request = store.get(WORKSPACE_SNAPSHOT_KEY)

    request.onerror = () => reject(request.error ?? new Error('管理ワークスペースの読込に失敗しました。'))
    request.onsuccess = () => {
      const result = request.result
      resolve(isWorkspaceSnapshot(result) ? result : null)
    }
    transaction.oncomplete = () => database.close()
  })
}

async function writeWorkspaceToIndexedDb(snapshot: WorkspaceSnapshot) {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(WORKSPACE_STORE_NAME)
    const request = store.put(snapshot, WORKSPACE_SNAPSHOT_KEY)

    request.onerror = () => reject(request.error ?? new Error('管理ワークスペースの書込に失敗しました。'))
    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('管理ワークスペースの書込に失敗しました。'))
  })
}

async function readAllAutoBackupRecordsFromIndexedDb(): Promise<AutoBackupRecord[]> {
  const database = await openDatabase()
  if (!database) return []

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTO_BACKUP_STORE_NAME, 'readonly')
    const store = transaction.objectStore(AUTO_BACKUP_STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(request.error ?? new Error('自動バックアップの読込に失敗しました。'))
    request.onsuccess = () => {
      const result = request.result
      resolve(isAutoBackupRecordList(result) ? sortBackupRecords(result) : [])
    }
    transaction.oncomplete = () => database.close()
  })
}

async function readAutoBackupRecordFromIndexedDb(backupDateKey: string): Promise<AutoBackupRecord | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTO_BACKUP_STORE_NAME, 'readonly')
    const store = transaction.objectStore(AUTO_BACKUP_STORE_NAME)
    const request = store.get(backupDateKey)

    request.onerror = () => reject(request.error ?? new Error('自動バックアップの読込に失敗しました。'))
    request.onsuccess = () => {
      resolve(isAutoBackupRecord(request.result) ? request.result : null)
    }
    transaction.oncomplete = () => database.close()
  })
}

async function readAllWorkspaceAutoBackupRecordsFromIndexedDb(): Promise<WorkspaceAutoBackupRecord[]> {
  const database = await openDatabase()
  if (!database) return []

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_AUTO_BACKUP_STORE_NAME, 'readonly')
    const store = transaction.objectStore(WORKSPACE_AUTO_BACKUP_STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(request.error ?? new Error('管理ワークスペース自動バックアップの読込に失敗しました。'))
    request.onsuccess = () => {
      const result = request.result
      resolve(isWorkspaceAutoBackupRecordList(result) ? sortBackupRecords(result) : [])
    }
    transaction.oncomplete = () => database.close()
  })
}

async function readWorkspaceAutoBackupRecordFromIndexedDb(backupDateKey: string): Promise<WorkspaceAutoBackupRecord | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_AUTO_BACKUP_STORE_NAME, 'readonly')
    const store = transaction.objectStore(WORKSPACE_AUTO_BACKUP_STORE_NAME)
    const request = store.get(backupDateKey)

    request.onerror = () => reject(request.error ?? new Error('管理ワークスペース自動バックアップの読込に失敗しました。'))
    request.onsuccess = () => {
      resolve(isWorkspaceAutoBackupRecord(request.result) ? request.result : null)
    }
    transaction.oncomplete = () => database.close()
  })
}

async function writeAutoBackupRecordsToIndexedDb(records: AutoBackupRecord[]) {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(AUTO_BACKUP_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(AUTO_BACKUP_STORE_NAME)
    const clearRequest = store.clear()

    clearRequest.onerror = () => reject(clearRequest.error ?? new Error('自動バックアップの更新に失敗しました。'))
    clearRequest.onsuccess = () => {
      records.forEach((record) => {
        store.put(record)
      })
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('自動バックアップの更新に失敗しました。'))
  })
}

async function writeWorkspaceAutoBackupRecordsToIndexedDb(records: WorkspaceAutoBackupRecord[]) {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_AUTO_BACKUP_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(WORKSPACE_AUTO_BACKUP_STORE_NAME)
    const clearRequest = store.clear()

    clearRequest.onerror = () => reject(clearRequest.error ?? new Error('管理ワークスペース自動バックアップの更新に失敗しました。'))
    clearRequest.onsuccess = () => {
      records.forEach((record) => {
        store.put(record)
      })
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('管理ワークスペース自動バックアップの更新に失敗しました。'))
  })
}

async function readDeveloperCloudBackupHandleFromIndexedDb(): Promise<unknown | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME, 'readonly')
    const store = transaction.objectStore(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME)
    const request = store.get(DEVELOPER_CLOUD_BACKUP_HANDLE_KEY)

    request.onerror = () => reject(request.error ?? new Error('クラウド同期フォルダ設定の読込に失敗しました。'))
    request.onsuccess = () => resolve(request.result ?? null)
    transaction.oncomplete = () => database.close()
  })
}

async function writeDeveloperCloudBackupHandleToIndexedDb(handle: unknown) {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME)
    const request = store.put(handle, DEVELOPER_CLOUD_BACKUP_HANDLE_KEY)

    request.onerror = () => reject(request.error ?? new Error('クラウド同期フォルダ設定の保存に失敗しました。'))
    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('クラウド同期フォルダ設定の保存に失敗しました。'))
  })
}

async function deleteDeveloperCloudBackupHandleFromIndexedDb() {
  const database = await openDatabase()
  if (!database) return false

  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(DEVELOPER_CLOUD_BACKUP_HANDLE_STORE_NAME)
    const request = store.delete(DEVELOPER_CLOUD_BACKUP_HANDLE_KEY)

    request.onerror = () => reject(request.error ?? new Error('クラウド同期フォルダ設定の削除に失敗しました。'))
    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('クラウド同期フォルダ設定の削除に失敗しました。'))
  })
}

function readFromLocalStorage(): AppSnapshot | null {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue)
    return isAppSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readWorkspaceFromLocalStorage(): WorkspaceSnapshot | null {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_KEY)
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue)
    return isWorkspaceSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeToLocalStorage(snapshot: AppSnapshot) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot))
}

export function writeWorkspaceToLocalStorageSync(snapshot: WorkspaceSnapshot) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_KEY, JSON.stringify(snapshot))
}

function readAutoBackupRecordsFromLocalStorage(): AutoBackupRecord[] {
  if (typeof window === 'undefined') return []

  try {
    const rawValue = window.localStorage.getItem(LOCAL_STORAGE_AUTO_BACKUPS_KEY)
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue)
    return isAutoBackupRecordList(parsed) ? sortBackupRecords(parsed) : []
  } catch {
    return []
  }
}

function readWorkspaceAutoBackupRecordsFromLocalStorage(): WorkspaceAutoBackupRecord[] {
  if (typeof window === 'undefined') return []

  try {
    const rawValue = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_AUTO_BACKUPS_KEY)
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue)
    return isWorkspaceAutoBackupRecordList(parsed) ? sortBackupRecords(parsed) : []
  } catch {
    return []
  }
}

function writeAutoBackupRecordsToLocalStorage(records: AutoBackupRecord[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_AUTO_BACKUPS_KEY, JSON.stringify(records))
}

function writeWorkspaceAutoBackupRecordsToLocalStorage(records: WorkspaceAutoBackupRecord[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_AUTO_BACKUPS_KEY, JSON.stringify(records))
}

export async function loadAppSnapshot() {
  const indexedDbSnapshot = await readFromIndexedDb().catch(() => null)
  return indexedDbSnapshot ?? readFromLocalStorage()
}

export async function saveAppSnapshot(snapshot: AppSnapshot) {
  const savedToIndexedDb = await writeToIndexedDb(snapshot).catch(() => false)
  if (!savedToIndexedDb) writeToLocalStorage(snapshot)
  else writeToLocalStorage(snapshot)
}

export async function loadWorkspaceSnapshot() {
  const indexedDbSnapshot = await readWorkspaceFromIndexedDb().catch(() => null)
  const localStorageSnapshot = readWorkspaceFromLocalStorage()
  if (!indexedDbSnapshot) return localStorageSnapshot
  if (!localStorageSnapshot) return indexedDbSnapshot
  // Return the snapshot with the newer savedAt timestamp to prevent stale IndexedDB reads
  if (localStorageSnapshot.savedAt > indexedDbSnapshot.savedAt) return localStorageSnapshot
  return indexedDbSnapshot
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  // Write to localStorage first (synchronous) to prevent data loss on logout/close
  writeWorkspaceToLocalStorageSync(snapshot)
  await writeWorkspaceToIndexedDb(snapshot).catch(() => false)
}

export async function loadDeveloperCloudBackupHandle() {
  return readDeveloperCloudBackupHandleFromIndexedDb().catch(() => null)
}

export async function saveDeveloperCloudBackupHandle(handle: unknown) {
  return writeDeveloperCloudBackupHandleToIndexedDb(handle).catch(() => false)
}

export async function clearDeveloperCloudBackupHandle() {
  return deleteDeveloperCloudBackupHandleFromIndexedDb().catch(() => false)
}

export async function loadAutoBackupSummaries() {
  const indexedDbRecords = await readAllAutoBackupRecordsFromIndexedDb().catch(() => [])
  if (indexedDbRecords.length > 0) return summarizeBackupRecords(indexedDbRecords)
  return summarizeBackupRecords(readAutoBackupRecordsFromLocalStorage())
}

export async function loadAutoBackupSnapshot(backupDateKey: string) {
  const indexedDbRecord = await readAutoBackupRecordFromIndexedDb(backupDateKey).catch(() => null)
  if (indexedDbRecord) return indexedDbRecord.snapshot
  const localStorageRecord = readAutoBackupRecordsFromLocalStorage().find((record) => record.backupDateKey === backupDateKey)
  return localStorageRecord?.snapshot ?? null
}

export async function loadWorkspaceAutoBackupSummaries() {
  const indexedDbRecords = await readAllWorkspaceAutoBackupRecordsFromIndexedDb().catch(() => [])
  if (indexedDbRecords.length > 0) return summarizeBackupRecords(indexedDbRecords)
  return summarizeBackupRecords(readWorkspaceAutoBackupRecordsFromLocalStorage())
}

export async function loadWorkspaceAutoBackupEntries(): Promise<WorkspaceAutoBackupEntry[]> {
  const indexedDbRecords = await readAllWorkspaceAutoBackupRecordsFromIndexedDb().catch(() => [])
  if (indexedDbRecords.length > 0) return indexedDbRecords.map((record) => ({
    backupDateKey: record.backupDateKey,
    savedAt: record.savedAt,
    snapshot: record.snapshot,
  }))
  return readWorkspaceAutoBackupRecordsFromLocalStorage().map((record) => ({
    backupDateKey: record.backupDateKey,
    savedAt: record.savedAt,
    snapshot: record.snapshot,
  }))
}

export async function loadWorkspaceAutoBackupSnapshot(backupDateKey: string) {
  const indexedDbRecord = await readWorkspaceAutoBackupRecordFromIndexedDb(backupDateKey).catch(() => null)
  if (indexedDbRecord) return indexedDbRecord.snapshot
  const localStorageRecord = readWorkspaceAutoBackupRecordsFromLocalStorage().find((record) => record.backupDateKey === backupDateKey)
  return localStorageRecord?.snapshot ?? null
}

export async function saveDailyAutoBackup(snapshot: AppSnapshot, retentionDays = 14) {
  const savedAtDate = new Date(snapshot.savedAt)
  const normalizedSavedAtDate = Number.isNaN(savedAtDate.getTime()) ? new Date() : savedAtDate
  const backupDateKey = toDateKey(normalizedSavedAtDate)
  const existingRecords = await readAllAutoBackupRecordsFromIndexedDb().catch(() => readAutoBackupRecordsFromLocalStorage())
  const nextRecords = pruneBackupRecords([
    ...existingRecords.filter((record) => record.backupDateKey !== backupDateKey),
    { backupDateKey, savedAt: snapshot.savedAt, snapshot },
  ], retentionDays, normalizedSavedAtDate)
  const savedToIndexedDb = await writeAutoBackupRecordsToIndexedDb(nextRecords).catch(() => false)

  if (!savedToIndexedDb) writeAutoBackupRecordsToLocalStorage(nextRecords)
  else writeAutoBackupRecordsToLocalStorage(nextRecords)

  return {
    created: !existingRecords.some((record) => record.backupDateKey === backupDateKey),
    summaries: summarizeBackupRecords(nextRecords),
  }
}

export async function saveDailyWorkspaceAutoBackup(snapshot: WorkspaceSnapshot, retentionDays = 14) {
  const savedAtDate = new Date(snapshot.savedAt)
  const normalizedSavedAtDate = Number.isNaN(savedAtDate.getTime()) ? new Date() : savedAtDate
  const backupDateKey = toOperationalDateKeyJst(normalizedSavedAtDate)
  const existingRecords = await readAllWorkspaceAutoBackupRecordsFromIndexedDb().catch(() => readWorkspaceAutoBackupRecordsFromLocalStorage())
  const cutoffReferenceDate = new Date(normalizedSavedAtDate.getTime() + JST_OFFSET_IN_MS - WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST * HOUR_IN_MS - (Math.max(1, Math.trunc(retentionDays) || 1) - 1) * DAY_IN_MS)
  const cutoffKey = toUtcDateKey(cutoffReferenceDate)
  const nextRecords = pruneBackupRecords([
    ...existingRecords.filter((record) => record.backupDateKey !== backupDateKey),
    { backupDateKey, savedAt: snapshot.savedAt, snapshot },
  ], retentionDays, normalizedSavedAtDate).filter((record) => record.backupDateKey >= cutoffKey)
  const savedToIndexedDb = await writeWorkspaceAutoBackupRecordsToIndexedDb(nextRecords).catch(() => false)

  if (!savedToIndexedDb) writeWorkspaceAutoBackupRecordsToLocalStorage(nextRecords)
  else writeWorkspaceAutoBackupRecordsToLocalStorage(nextRecords)

  return {
    created: !existingRecords.some((record) => record.backupDateKey === backupDateKey),
    summaries: summarizeBackupRecords(nextRecords),
  }
}

export function serializeAppSnapshot(snapshot: AppSnapshot) {
  return JSON.stringify(snapshot, null, 2)
}

export function parseAppSnapshot(serializedSnapshot: string) {
  const parsed = JSON.parse(serializedSnapshot)
  if (!isAppSnapshot(parsed)) throw new Error('バックアップ形式が不正です。')
  return parsed
}

export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  return JSON.stringify(snapshot, null, 2)
}

export function parseWorkspaceSnapshot(serializedSnapshot: string) {
  const parsed = JSON.parse(serializedSnapshot)
  if (!isWorkspaceSnapshot(parsed)) throw new Error('開発者バックアップ形式が不正です。')

  return {
    ...parsed,
    developerPassword: parsed.developerPassword ?? 'developer',
    developerCloudBackupEnabled: parsed.developerCloudBackupEnabled ?? false,
    developerCloudBackupFolderName: parsed.developerCloudBackupFolderName ?? '',
    developerCloudSyncedAutoBackupKeys: Array.isArray(parsed.developerCloudSyncedAutoBackupKeys)
      ? parsed.developerCloudSyncedAutoBackupKeys.filter((value): value is string => typeof value === 'string')
      : [],
    classrooms: parsed.classrooms.map((classroom) => ({
      ...classroom,
      isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
      temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
    })),
  }
}
