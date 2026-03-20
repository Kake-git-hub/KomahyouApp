import type { AppSnapshot } from '../types/appState'

const DB_NAME = 'komahyouapp-storage'
const STORE_NAME = 'app-snapshots'
const SNAPSHOT_KEY = 'primary'
const LOCAL_STORAGE_KEY = 'komahyouapp:snapshot'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isAppSnapshot(value: unknown): value is AppSnapshot {
  return isRecord(value)
    && typeof value.schemaVersion === 'number'
    && typeof value.savedAt === 'string'
    && typeof value.screen === 'string'
    && Array.isArray(value.teachers)
    && Array.isArray(value.students)
    && Array.isArray(value.regularLessons)
    && Array.isArray(value.specialSessions)
    && Array.isArray(value.autoAssignRules)
    && 'classroomSettings' in value
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1)

    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けませんでした。'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
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

function writeToLocalStorage(snapshot: AppSnapshot) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot))
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

export function serializeAppSnapshot(snapshot: AppSnapshot) {
  return JSON.stringify(snapshot, null, 2)
}

export function parseAppSnapshot(serializedSnapshot: string) {
  const parsed = JSON.parse(serializedSnapshot)
  if (!isAppSnapshot(parsed)) throw new Error('バックアップ形式が不正です。')
  return parsed
}
