import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2/options'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'

initializeApp()

setGlobalOptions({
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
})

const firestore = getFirestore()
const auth = getAuth()
const storage = getStorage()
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'komahyouapp-prod.firebasestorage.app'

const WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS = 14
const WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS = 72
const WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST = 2
const WORKSPACE_DAILY_AUTO_BACKUP_SCHEDULE = process.env.WORKSPACE_AUTO_BACKUP_SCHEDULE ?? '10 2 * * *'
const WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE = process.env.WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE ?? '10 * * * *'
const WORKSPACE_AUTO_BACKUP_TIME_ZONE = 'Asia/Tokyo'
const WORKSPACE_INCIDENT_BACKUP_PREFIX = 'workspace-incident-backups'
const WORKSPACE_LATEST_ROLLBACK_PREFIX = 'workspace-latest-rollbacks'
const DEVELOPMENT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'
const HOUR_IN_MS = 60 * 60 * 1000
const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS
const FIREBASE_INLINE_SNAPSHOT_JSON_BYTE_LIMIT = 700_000
const FIREBASE_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64'

type ClassroomContractStatus = 'active' | 'suspended'

type ClassroomProvisionPayload = {
  workspaceKey: string
  classroomName: string
  managerName: string
  managerEmail: string
  managerPassword?: string
  contractStartDate: string
  contractEndDate?: string
  initialPayload: Record<string, unknown>
}

type ClassroomUpdatePayload = {
  workspaceKey: string
  classroomId: string
  classroomName: string
  managerName: string
  managerEmail: string
  contractStatus: ClassroomContractStatus
  contractStartDate: string
  contractEndDate?: string
}

type ClassroomDeletePayload = {
  workspaceKey: string
  classroomId: string
}

type ClassroomReassignManagerPayload = {
  workspaceKey: string
  classroomId: string
  managerName: string
  managerEmail: string
  managerUserId: string
}

type WorkspaceUserRole = 'developer' | 'manager'

type FirebaseWorkspaceMemberDoc = {
  displayName?: string
  email?: string
  role?: WorkspaceUserRole
  assignedClassroomId?: string | null
}

type FirebaseClassroomDoc = {
  name?: string
  contractStatus?: ClassroomContractStatus
  contractStartDate?: string
  contractEndDate?: string
  managerUserId?: string
  isTemporarilySuspended?: boolean
  temporarySuspensionReason?: string
  updatedAt?: string
}

type FirebasePersistedBoardWeek = {
  cells?: unknown[]
}

type FirebasePersistedBoardState = {
  weeks?: Array<FirebasePersistedBoardWeek | unknown[]>
} & Record<string, unknown>

type FirebaseAppSnapshotPayload = {
  screen?: string
  classroomSettings?: Record<string, unknown>
  managers?: unknown[]
  teachers?: unknown[]
  students?: unknown[]
  regularLessons?: unknown[]
  groupLessons?: unknown[]
  specialSessions?: unknown[]
  autoAssignRules?: unknown[]
  pairConstraints?: unknown[]
  boardState?: FirebasePersistedBoardState | null
} & Record<string, unknown>

type FirebaseClassroomSnapshotDoc = {
  schemaVersion?: number
  savedAt?: string
  data?: FirebaseAppSnapshotPayload
  dataEncoding?: typeof FIREBASE_COMPRESSED_SNAPSHOT_ENCODING
  compressedData?: string
  dataByteLength?: number
  updatedBy?: string
  updatedAt?: string
}

type WorkspaceUser = {
  id: string
  name: string
  email: string
  role: WorkspaceUserRole
  assignedClassroomId: string | null
}

type WorkspaceClassroom = {
  id: string
  name: string
  contractStatus: ClassroomContractStatus
  contractStartDate: string
  contractEndDate: string
  managerUserId: string
  isTemporarilySuspended: boolean
  temporarySuspensionReason: string
  data: Record<string, unknown>
}

type WorkspaceSnapshot = {
  schemaVersion: number
  savedAt: string
  developerPassword: string
  developerCloudBackupEnabled: boolean
  developerCloudBackupFolderName: string
  developerCloudSyncedAutoBackupKeys: string[]
  currentUserId: string
  actingClassroomId: string | null
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
}

type WorkspaceAutoBackupKind = 'daily' | 'hourly'

type WorkspaceAutoBackupSummaryDoc = {
  backupDateKey: string
  backupKind?: WorkspaceAutoBackupKind
  displayLabel?: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
  createdAt: string
}

type ClassroomLatestRollbackStorageDoc = {
  classroomId: string
  sourceSavedAt: string
  capturedAt: string
  snapshot: FirebaseClassroomSnapshotDoc
}

function readString(value: unknown, fieldName: string) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} は文字列で指定してください。`)
  }

  return value.trim()
}

function readOptionalString(value: unknown, fieldName: string) {
  if (typeof value === 'undefined' || value === null) return ''
  return readString(value, fieldName)
}

function readPayloadObject(value: unknown, fieldName: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `${fieldName} の形式が不正です。`)
  }

  return value as Record<string, unknown>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeFirestoreValue(value: unknown): unknown {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
    })
  }

  if (isPlainObject(value)) {
    const sanitizedObject: Record<string, unknown> = {}

    Object.entries(value).forEach(([key, entry]) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      if (typeof sanitizedEntry !== 'undefined') {
        sanitizedObject[key] = sanitizedEntry
      }
    })

    return sanitizedObject
  }

  return value
}

function sanitizeForFirestore<T>(value: T): T {
  return sanitizeFirestoreValue(value) as T
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`
}

function hashSnapshotPayload(payload: Record<string, unknown>) {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex')
}

function countRegularTemplateEntries(template: unknown) {
  if (!template || typeof template !== 'object' || !Array.isArray((template as { cells?: unknown[] }).cells)) return 0
  return ((template as { cells: unknown[] }).cells).reduce<number>((cellTotal, cell) => {
    if (!cell || typeof cell !== 'object' || !Array.isArray((cell as { desks?: unknown[] }).desks)) return cellTotal
    return cellTotal + ((cell as { desks: unknown[] }).desks).reduce<number>((deskTotal, desk) => {
      if (!desk || typeof desk !== 'object') return deskTotal
      const students = Array.isArray((desk as { students?: unknown[] }).students)
        ? (desk as { students: unknown[] }).students.filter(Boolean).length
        : 0
      const teacher = typeof (desk as { teacherId?: unknown }).teacherId === 'string' && (desk as { teacherId: string }).teacherId.trim() ? 1 : 0
      return deskTotal + students + teacher
    }, 0)
  }, 0)
}

function countClassroomManagementData(payload: Record<string, unknown>) {
  const settings = payload.classroomSettings && typeof payload.classroomSettings === 'object'
    ? payload.classroomSettings as Record<string, unknown>
    : {}
  return [
    payload.managers,
    payload.teachers,
    payload.students,
    payload.regularLessons,
    payload.groupLessons,
    settings.regularLessonTemplateHistory,
    settings.preTemplateRegularLessons,
    settings.initialSetupMakeupStocks,
    settings.initialSetupLectureStocks,
  ].reduce<number>((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
    + countRegularTemplateEntries(settings.regularLessonTemplate)
}

async function assertNoSnapshotDataLoss(params: {
  previousSnapshot: FirebaseClassroomSnapshotDoc | null
  nextPayload: Record<string, unknown>
}) {
  const nextManagementCount = countClassroomManagementData(params.nextPayload)
  if (nextManagementCount > 0) return
  if (!params.previousSnapshot) return

  const previousPayload = readStoredSnapshotPayload(params.previousSnapshot)
  const previousManagementCount = previousPayload ? countClassroomManagementData(previousPayload) : 1
  if (previousManagementCount <= 0) return

  throw new HttpsError('failed-precondition', `既存の教室管理データがあるため、空の管理データでのFirebase上書きを中止しました。前回データ件数=${previousManagementCount}`)
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcHourKey(date: Date) {
  const dateKey = toUtcDateKey(date)
  const hour = `${date.getUTCHours()}`.padStart(2, '0')
  return `${dateKey}T${hour}`
}

function toOperationalDateKeyJst(date: Date, boundaryHourJst = WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST) {
  const operationalDate = new Date(date.getTime() + JST_OFFSET_IN_MS - boundaryHourJst * HOUR_IN_MS)
  return toUtcDateKey(operationalDate)
}

function toHourlyDateKeyJst(date: Date) {
  const jstDate = new Date(date.getTime() + JST_OFFSET_IN_MS)
  return toUtcHourKey(jstDate)
}

function getWorkspaceDailyAutoBackupCutoffKey(referenceDate: Date, retentionDays: number) {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays) || 1)
  const operationalDate = new Date(referenceDate.getTime() + JST_OFFSET_IN_MS - WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST * HOUR_IN_MS)
  operationalDate.setUTCDate(operationalDate.getUTCDate() - (safeRetentionDays - 1))
  return toUtcDateKey(operationalDate)
}

function buildWorkspaceAutoBackupStoragePath(workspaceKey: string, backupDateKey: string, backupKind: WorkspaceAutoBackupKind = 'daily') {
  if (backupKind === 'hourly') {
    return `workspace-auto-backups/${workspaceKey}/hourly/${backupDateKey}.json`
  }
  return `workspace-auto-backups/${workspaceKey}/${backupDateKey}.json`
}

function buildWorkspaceAutoBackupDisplayLabel(backupDateKey: string, backupKind: WorkspaceAutoBackupKind) {
  if (backupKind === 'hourly') {
    const [datePart, hourPart = '00'] = backupDateKey.split('T')
    return `${datePart} ${hourPart}:10 毎時`
  }
  return `${backupDateKey} 日次`
}

function buildClassroomLatestRollbackStoragePath(workspaceKey: string, classroomId: string) {
  return `${WORKSPACE_LATEST_ROLLBACK_PREFIX}/${workspaceKey}/classrooms/${classroomId}/latest.json`
}

function buildWorkspaceIncidentBackupStoragePath(workspaceKey: string, reason: string, savedAt: string) {
  const safeReason = reason.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'incident'
  const safeTimestamp = savedAt.replace(/[:.]/g, '-')
  return `${WORKSPACE_INCIDENT_BACKUP_PREFIX}/${workspaceKey}/${safeReason}-${safeTimestamp}.json`
}

async function writeWorkspaceIncidentBackup(workspaceKey: string, reason: string) {
  const savedAt = new Date().toISOString()
  try {
    const { snapshot } = await buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt)
    const storagePath = buildWorkspaceIncidentBackupStoragePath(workspaceKey, reason, savedAt)
    const bucket = storage.bucket(STORAGE_BUCKET)
    await bucket.file(storagePath).save(JSON.stringify(snapshot, null, 2), {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })
    logger.info(`[IncidentBackup] Saved pre-restore safety snapshot to ${storagePath}`)
    return { storagePath, savedAt }
  } catch (error) {
    logger.error(`[IncidentBackup] Failed to save safety snapshot for workspace=${workspaceKey} reason=${reason}`, error)
    return null
  }
}

function stringifySnapshotPayload(payload: Record<string, unknown> | null) {
  if (!payload) return ''
  return JSON.stringify(payload)
}

async function writeLatestClassroomRollback(params: {
  workspaceKey: string
  classroomId: string
  beforeSnapshot: FirebaseClassroomSnapshotDoc
  afterSnapshot?: FirebaseClassroomSnapshotDoc | null
}) {
  const beforePayload = readStoredSnapshotPayload(params.beforeSnapshot)
  if (!beforePayload) return false

  const afterPayload = readStoredSnapshotPayload(params.afterSnapshot ?? null)
  if (afterPayload && stringifySnapshotPayload(beforePayload) === stringifySnapshotPayload(afterPayload)) {
    return false
  }

  const capturedAt = new Date().toISOString()
  const storagePath = buildClassroomLatestRollbackStoragePath(params.workspaceKey, params.classroomId)
  const storageDoc: ClassroomLatestRollbackStorageDoc = {
    classroomId: params.classroomId,
    sourceSavedAt: params.beforeSnapshot.savedAt ?? '',
    capturedAt,
    snapshot: createStoredSnapshotDoc({
      payload: beforePayload,
      savedAt: params.beforeSnapshot.savedAt ?? capturedAt,
      updatedBy: params.beforeSnapshot.updatedBy ?? 'system',
      updatedAt: params.beforeSnapshot.updatedAt ?? params.beforeSnapshot.savedAt ?? capturedAt,
      schemaVersion: params.beforeSnapshot.schemaVersion ?? 1,
    }),
  }

  const bucket = storage.bucket(STORAGE_BUCKET)
  await bucket.file(storagePath).save(JSON.stringify(storageDoc, null, 2), {
    resumable: false,
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
    },
  })
  logger.info(`[LatestRollback] Saved latest classroom rollback: workspace=${params.workspaceKey}, classroom=${params.classroomId}, sourceSavedAt=${storageDoc.sourceSavedAt}`)
  return true
}

function deserializeBoardState(boardState: FirebasePersistedBoardState | Record<string, unknown> | null | undefined) {
  if (!boardState || typeof boardState !== 'object') return null

  const rawWeeks = Array.isArray(boardState.weeks) ? boardState.weeks : []
  const weeks = rawWeeks.map((week) => {
    if (Array.isArray(week)) return week
    return Array.isArray(week?.cells) ? week.cells : []
  })

  return {
    ...boardState,
    weeks,
  }
}

function deserializeSnapshotPayload(payload: FirebaseAppSnapshotPayload | null | undefined) {
  if (!payload || typeof payload !== 'object') return null

  return {
    ...payload,
    boardState: deserializeBoardState(payload.boardState),
  }
}

function createStoredSnapshotDoc(params: {
  payload: Record<string, unknown>
  savedAt: string
  updatedBy: string
  updatedAt?: string
  schemaVersion?: number
}): FirebaseClassroomSnapshotDoc {
  const sanitizedPayload = sanitizeForFirestore(params.payload) as FirebaseAppSnapshotPayload
  const json = JSON.stringify(sanitizedPayload)
  const dataByteLength = Buffer.byteLength(json, 'utf8')
  const updatedAt = typeof params.updatedAt === 'string' ? params.updatedAt : params.savedAt
  const schemaVersion = typeof params.schemaVersion === 'number' ? params.schemaVersion : 1

  if (dataByteLength <= FIREBASE_INLINE_SNAPSHOT_JSON_BYTE_LIMIT) {
    return {
      schemaVersion,
      savedAt: params.savedAt,
      data: sanitizedPayload,
      updatedBy: params.updatedBy,
      updatedAt,
    }
  }

  return {
    schemaVersion,
    savedAt: params.savedAt,
    dataEncoding: FIREBASE_COMPRESSED_SNAPSHOT_ENCODING,
    compressedData: gzipSync(Buffer.from(json, 'utf8')).toString('base64'),
    dataByteLength,
    updatedBy: params.updatedBy,
    updatedAt,
  }
}

function readStoredSnapshotPayload(snapshot: FirebaseClassroomSnapshotDoc | null | undefined) {
  if (!snapshot) return null

  if (snapshot.data && typeof snapshot.data === 'object') {
    return deserializeSnapshotPayload(snapshot.data)
  }

  if (snapshot.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING && typeof snapshot.compressedData === 'string' && snapshot.compressedData) {
    const json = gunzipSync(Buffer.from(snapshot.compressedData, 'base64')).toString('utf8')
    return deserializeSnapshotPayload(JSON.parse(json) as FirebaseAppSnapshotPayload)
  }

  return null
}

function createEmptyAppSnapshotPayload() {
  return {
    screen: 'board',
    classroomSettings: {
      closedWeekdays: [0],
      holidayDates: [],
      forceOpenDates: [],
      deskCount: 14,
      initialSetupCompletedAt: '',
      initialSetupMakeupStocks: [],
      initialSetupLectureStocks: [],
    },
    managers: [],
    teachers: [],
    students: [],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: null,
  } satisfies Record<string, unknown>
}

function toWorkspaceUser(userId: string, data: FirebaseWorkspaceMemberDoc): WorkspaceUser {
  const email = typeof data.email === 'string' ? data.email.trim() : ''
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
  const role = data.role === 'developer' ? 'developer' : 'manager'
  const assignedClassroomId = typeof data.assignedClassroomId === 'string'
    ? data.assignedClassroomId.trim() || null
    : null

  return {
    id: userId,
    name: displayName || email || userId,
    email,
    role,
    assignedClassroomId,
  }
}

function toWorkspaceClassroom(classroomId: string, data: FirebaseClassroomDoc, snapshotData: Record<string, unknown> | null): WorkspaceClassroom {
  return {
    id: classroomId,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '名称未設定の教室',
    contractStatus: data.contractStatus === 'suspended' ? 'suspended' : 'active',
    contractStartDate: typeof data.contractStartDate === 'string' ? data.contractStartDate : '',
    contractEndDate: typeof data.contractEndDate === 'string' ? data.contractEndDate : '',
    managerUserId: typeof data.managerUserId === 'string' ? data.managerUserId : '',
    isTemporarilySuspended: Boolean(data.isTemporarilySuspended),
    temporarySuspensionReason: typeof data.temporarySuspensionReason === 'string' ? data.temporarySuspensionReason : '',
    data: snapshotData ?? createEmptyAppSnapshotPayload(),
  }
}

function getLatestSavedAt(classrooms: FirebaseClassroomDoc[], snapshots: FirebaseClassroomSnapshotDoc[], fallbackSavedAt: string) {
  const candidates = [
    ...classrooms.map((row) => (typeof row.updatedAt === 'string' ? row.updatedAt : '')),
    ...snapshots.map((row) => (typeof row.savedAt === 'string' ? row.savedAt : '')),
  ].filter(Boolean)

  return candidates.sort((left, right) => right.localeCompare(left))[0] ?? fallbackSavedAt
}

async function buildWorkspaceServerBackupSnapshot(workspaceKey: string, savedAt: string) {
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const [memberSnapshots, classroomSnapshots, snapshotSnapshots] = await Promise.all([
    workspaceRef.collection('members').get(),
    workspaceRef.collection('classrooms').get(),
    workspaceRef.collection('classroomSnapshots').get(),
  ])

  const users = memberSnapshots.docs.map((entry) => toWorkspaceUser(entry.id, entry.data() as FirebaseWorkspaceMemberDoc))
  const snapshotByClassroomId = new Map(
    snapshotSnapshots.docs.map((entry) => [entry.id, entry.data() as FirebaseClassroomSnapshotDoc]),
  )

  const classrooms = classroomSnapshots.docs.map((entry) => {
    const classroomData = entry.data() as FirebaseClassroomDoc
    const snapshotData = snapshotByClassroomId.get(entry.id)
    return toWorkspaceClassroom(entry.id, classroomData, readStoredSnapshotPayload(snapshotData) ?? null)
  })

  const latestSourceSavedAt = getLatestSavedAt(
    classroomSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomDoc),
    snapshotSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomSnapshotDoc),
    savedAt,
  )

  return {
    latestSourceSavedAt,
    snapshot: {
      schemaVersion: 1,
      savedAt,
      developerPassword: 'developer',
      developerCloudBackupEnabled: false,
      developerCloudBackupFolderName: '',
      developerCloudSyncedAutoBackupKeys: [],
      currentUserId: '',
      actingClassroomId: classrooms[0]?.id ?? null,
      users,
      classrooms,
    } satisfies WorkspaceSnapshot,
  }
}

async function pruneWorkspaceServerAutoBackups(workspaceKey: string, referenceDate: Date) {
  const dailyCutoffKey = getWorkspaceDailyAutoBackupCutoffKey(referenceDate, WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS)
  const hourlyCutoffTime = referenceDate.getTime() - WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS * HOUR_IN_MS
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const summarySnapshots = await workspaceRef.collection('workspaceAutoBackupSummaries').get()
  const batch = firestore.batch()
  let deleteCount = 0

  await Promise.all(summarySnapshots.docs.map(async (summaryDoc) => {
    const summary = summaryDoc.data() as WorkspaceAutoBackupSummaryDoc
    const backupKind: WorkspaceAutoBackupKind = summary.backupKind === 'hourly' || summaryDoc.id.includes('T')
      ? 'hourly'
      : 'daily'
    const shouldKeep = backupKind === 'hourly'
      ? (Date.parse(summary.savedAt || '') || 0) >= hourlyCutoffTime
      : summaryDoc.id >= dailyCutoffKey
    if (shouldKeep) return

    if (typeof summary.storagePath === 'string' && summary.storagePath.trim()) {
      await bucket.file(summary.storagePath).delete().catch(() => undefined)
    }
    batch.delete(summaryDoc.ref)
    deleteCount += 1
  }))

  if (deleteCount === 0) return
  await batch.commit()
}

function validateEmailAddress(value: string, fieldName: string) {
  const normalized = value.toLowerCase()
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailPattern.test(normalized)) {
    throw new HttpsError('invalid-argument', `${fieldName} の形式が不正です。`)
  }
  return normalized
}

function validateContractStatus(value: string) {
  if (value !== 'active' && value !== 'suspended') {
    throw new HttpsError('invalid-argument', 'contractStatus の値が不正です。')
  }

  return value satisfies ClassroomContractStatus
}

async function requireDeveloperMember(authUid: string | undefined, workspaceKey: string) {
  if (!authUid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(authUid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as { role?: string } | undefined
  if (member?.role !== 'developer') {
    throw new HttpsError('permission-denied', '開発者権限が必要です。')
  }

  return memberRef
}

async function requireClassroomAccessMember(authUid: string | undefined, workspaceKey: string, classroomId: string) {
  if (!authUid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(authUid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as { role?: string; assignedClassroomId?: string | null } | undefined
  if (member?.role !== 'developer' && member?.assignedClassroomId !== classroomId) {
    throw new HttpsError('permission-denied', 'この教室を保存する権限がありません。')
  }

  return memberRef
}

function buildTemporaryPassword() {
  return `Temp-${randomBytes(9).toString('base64url')}`
}

async function countClassrooms(workspaceKey: string) {
  const classroomsSnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').count().get()
  return classroomsSnapshot.data().count
}

function isFirebaseAuthError(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code)
}

async function deleteOrphanedWorkspaceAuthUserByEmail(workspaceKey: string, email: string) {
  let existingUser: Awaited<ReturnType<typeof auth.getUserByEmail>>

  try {
    existingUser = await auth.getUserByEmail(email)
  } catch (error) {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      return { deleted: false, uid: '' }
    }
    throw error
  }

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const [memberSnapshot, classroomSnapshot] = await Promise.all([
    workspaceRef.collection('members').doc(existingUser.uid).get(),
    workspaceRef.collection('classrooms').where('managerUserId', '==', existingUser.uid).limit(1).get(),
  ])

  if (memberSnapshot.exists || !classroomSnapshot.empty) {
    return { deleted: false, uid: existingUser.uid }
  }

  await auth.deleteUser(existingUser.uid)
  logger.info(`Deleted orphaned Auth user before classroom provision: workspace=${workspaceKey}, uid=${existingUser.uid}`)
  return { deleted: true, uid: existingUser.uid }
}

async function createWorkspaceManagerAuthUser(params: {
  workspaceKey: string
  managerEmail: string
  managerName: string
  temporaryPassword: string
}) {
  try {
    return await auth.createUser({
      email: params.managerEmail,
      displayName: params.managerName,
      password: params.temporaryPassword,
    })
  } catch (error) {
    if (!isFirebaseAuthError(error, 'auth/email-already-exists')) {
      throw error
    }

    const cleanup = await deleteOrphanedWorkspaceAuthUserByEmail(params.workspaceKey, params.managerEmail)
    if (!cleanup.deleted) {
      throw error
    }

    return await auth.createUser({
      email: params.managerEmail,
      displayName: params.managerName,
      password: params.temporaryPassword,
    })
  }
}

export const provisionWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomName = readString(rawData.classroomName, 'classroomName')
  const managerName = readString(rawData.managerName, 'managerName')
  const managerEmail = validateEmailAddress(readString(rawData.managerEmail, 'managerEmail'), 'managerEmail')
  const contractStartDate = readString(rawData.contractStartDate, 'contractStartDate')
  const contractEndDate = readOptionalString(rawData.contractEndDate, 'contractEndDate')
  const managerPassword = readOptionalString(rawData.managerPassword, 'managerPassword')
  const initialPayload = readPayloadObject(rawData.initialPayload, 'initialPayload')
  const sanitizedInitialPayload = sanitizeForFirestore(initialPayload)

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc()
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomRef.id)
  const temporaryPassword = managerPassword || buildTemporaryPassword()
  const now = new Date().toISOString()

  let managerUserId = ''

  try {
    const managerUser = await createWorkspaceManagerAuthUser({
      workspaceKey,
      managerEmail,
      managerName,
      temporaryPassword,
    })
    managerUserId = managerUser.uid

    const batch = firestore.batch()
    batch.set(workspaceRef, {
      name: workspaceKey,
      schemaVersion: 1,
      updatedAt: Timestamp.now(),
    }, { merge: true })
    batch.set(workspaceRef.collection('members').doc(managerUser.uid), {
      displayName: managerName,
      email: managerEmail,
      role: 'manager',
      assignedClassroomId: classroomRef.id,
      updatedAt: now,
    })
    batch.set(classroomRef, {
      name: classroomName,
      contractStatus: 'active',
      contractStartDate,
      contractEndDate,
      managerUserId: managerUser.uid,
      isTemporarilySuspended: false,
      temporarySuspensionReason: '',
      updatedAt: now,
    })
    batch.set(snapshotRef, createStoredSnapshotDoc({
      payload: sanitizedInitialPayload,
      savedAt: now,
      updatedBy: request.auth?.uid ?? '',
      updatedAt: now,
      schemaVersion: 1,
    }))
    await batch.commit()

    return {
      classroomId: classroomRef.id,
      managerUserId: managerUser.uid,
      temporaryPassword,
    }
  } catch (error) {
    if (managerUserId) {
      await auth.deleteUser(managerUserId).catch(() => undefined)
    }

    if (error instanceof HttpsError) {
      throw error
    }

    const message = error instanceof Error ? error.message : '教室の追加に失敗しました。'
    throw new HttpsError('internal', message)
  }
})

export const reassignWorkspaceClassroomManager = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')
  const managerName = readString(rawData.managerName, 'managerName')
  const managerEmail = validateEmailAddress(readString(rawData.managerEmail, 'managerEmail'), 'managerEmail')
  const managerUserId = readString(rawData.managerUserId, 'managerUserId')

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc(classroomId)
  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }

  const currentManagerUserId = readString(classroomSnapshot.get('managerUserId') ?? '', 'managerUserId')
  if (currentManagerUserId === managerUserId) {
    return {
      classroomId,
      managerUserId,
    }
  }

  try {
    await auth.getUser(managerUserId)
  } catch (error) {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      throw new HttpsError('not-found', '差し替え先の Authentication ユーザーが見つかりません。')
    }
    const message = error instanceof Error ? error.message : '差し替え先の Authentication ユーザー確認に失敗しました。'
    throw new HttpsError('internal', message)
  }

  const currentMemberRef = workspaceRef.collection('members').doc(currentManagerUserId)
  const nextMemberRef = workspaceRef.collection('members').doc(managerUserId)
  const nextMemberSnapshot = await nextMemberRef.get()
  if (nextMemberSnapshot.exists) {
    const assignedClassroomId = readOptionalString(nextMemberSnapshot.get('assignedClassroomId'), 'assignedClassroomId')
    if (assignedClassroomId && assignedClassroomId !== classroomId) {
      throw new HttpsError('already-exists', 'この UID はすでに別の教室へ割り当てられています。別ユーザーかどうかを確認してください。')
    }
  }

  const now = new Date().toISOString()
  const batch = firestore.batch()
  batch.set(workspaceRef, {
    name: workspaceKey,
    schemaVersion: 1,
    updatedAt: Timestamp.now(),
  }, { merge: true })
  batch.set(nextMemberRef, {
    displayName: managerName,
    email: managerEmail,
    role: 'manager',
    assignedClassroomId: classroomId,
    updatedAt: now,
  }, { merge: true })
  batch.set(classroomRef, {
    managerUserId,
    updatedAt: now,
  }, { merge: true })
  batch.delete(currentMemberRef)
  await batch.commit()

  let cleanupWarning = ''
  await auth.deleteUser(currentManagerUserId).catch((error) => {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      return undefined
    }
    cleanupWarning = error instanceof Error
      ? `旧 Authentication ユーザー削除に失敗しました: ${error.message}`
      : '旧 Authentication ユーザー削除に失敗しました。'
    logger.warn(`Failed to delete previous manager auth user: workspace=${workspaceKey}, uid=${currentManagerUserId}, message=${cleanupWarning}`)
    return undefined
  })

  return {
    classroomId,
    managerUserId,
    deletedPreviousManagerUserId: currentManagerUserId,
    cleanupWarning: cleanupWarning || undefined,
  }
})

export const updateWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')
  const classroomName = readString(rawData.classroomName, 'classroomName')
  const managerName = readString(rawData.managerName, 'managerName')
  const managerEmail = validateEmailAddress(readString(rawData.managerEmail, 'managerEmail'), 'managerEmail')
  const contractStatus = validateContractStatus(readString(rawData.contractStatus, 'contractStatus'))
  const contractStartDate = readString(rawData.contractStartDate, 'contractStartDate')
  const contractEndDate = readOptionalString(rawData.contractEndDate, 'contractEndDate')

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const classroomRef = firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').doc(classroomId)
  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }

  const classroom = classroomSnapshot.data() as { managerUserId?: string } | undefined
  const managerUserId = readString(classroom?.managerUserId ?? '', 'managerUserId')
  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(managerUserId)

  try {
    await auth.updateUser(managerUserId, {
      email: managerEmail,
      displayName: managerName,
    })

    const batch = firestore.batch()
    batch.set(memberRef, {
      displayName: managerName,
      email: managerEmail,
      role: 'manager',
      assignedClassroomId: classroomId,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    batch.set(classroomRef, {
      name: classroomName,
      contractStatus,
      contractStartDate,
      contractEndDate,
      isTemporarilySuspended: contractStatus === 'suspended' ? false : Boolean(classroomSnapshot.get('isTemporarilySuspended')),
      temporarySuspensionReason: contractStatus === 'suspended' ? '' : (classroomSnapshot.get('temporarySuspensionReason') ?? ''),
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    await batch.commit()

    return { classroomId }
  } catch (error) {
    const message = error instanceof Error ? error.message : '教室情報の更新に失敗しました。'
    throw new HttpsError('internal', message)
  }
})

async function saveClassroomSnapshotFromCallable(request: CallableRequest, options?: { developmentOnly?: boolean }) {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')
  const savedAt = readString(rawData.savedAt, 'savedAt')
  const saveId = readString(rawData.saveId, 'saveId')
  const payload = readPayloadObject(rawData.payload, 'payload')

  if (options?.developmentOnly && classroomId !== DEVELOPMENT_CLASSROOM_ID) {
    throw new HttpsError('failed-precondition', 'この保存実験は開発用教室だけで利用できます。')
  }

  const memberRef = await requireClassroomAccessMember(request.auth?.uid, workspaceKey, classroomId)
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc(classroomId)
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomId)
  const saveAttemptRef = snapshotRef.collection('saveAttempts').doc(saveId)
  const payloadHash = hashSnapshotPayload(payload)

  const existingAttemptSnapshot = await saveAttemptRef.get()
  if (existingAttemptSnapshot.exists) {
    const existingAttempt = existingAttemptSnapshot.data() as { payloadHash?: string; verified?: boolean; savedAt?: string; writeMode?: string; dataByteLength?: number } | undefined
    if (existingAttempt?.payloadHash !== payloadHash) {
      throw new HttpsError('already-exists', '同じ saveId で異なる保存内容が送信されました。')
    }
    if (existingAttempt.verified) {
      return {
        classroomId,
        savedAt: existingAttempt.savedAt || savedAt,
        saveId,
        payloadHash,
        verified: true,
        idempotentReplay: true,
        writeMode: existingAttempt.writeMode || 'cloud-function-verified-replay',
        dataByteLength: existingAttempt.dataByteLength ?? 0,
      }
    }
  }

  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }
  const previousSnapshot = await snapshotRef.get()
  await assertNoSnapshotDataLoss({
    previousSnapshot: previousSnapshot.exists ? previousSnapshot.data() as FirebaseClassroomSnapshotDoc : null,
    nextPayload: payload,
  })

  const snapshotDoc = createStoredSnapshotDoc({
    payload,
    savedAt,
    updatedBy: memberRef.id,
    updatedAt: savedAt,
    schemaVersion: 1,
  })
  const writeMode = snapshotDoc.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING ? 'cloud-function-compressed' : 'cloud-function-inline'
  const dataByteLength = snapshotDoc.dataByteLength ?? Buffer.byteLength(JSON.stringify(snapshotDoc.data ?? {}), 'utf8')
  await saveAttemptRef.set({
    classroomId,
    savedAt,
    saveId,
    payloadHash,
    status: 'started',
    verified: false,
    writeMode,
    dataByteLength,
    updatedBy: memberRef.id,
    createdAt: new Date().toISOString(),
    snapshot: snapshotDoc,
  })
  await snapshotRef.set(snapshotDoc)

  const readbackSnapshot = await snapshotRef.get()
  const readbackPayload = readStoredSnapshotPayload(readbackSnapshot.exists ? readbackSnapshot.data() as FirebaseClassroomSnapshotDoc : null)
  const readbackHash = readbackPayload ? hashSnapshotPayload(readbackPayload) : ''
  if (readbackHash !== payloadHash) {
    await saveAttemptRef.set({
      status: 'verification-failed',
      verified: false,
      readbackHash,
      failedAt: new Date().toISOString(),
    }, { merge: true })
    throw new HttpsError('internal', 'Firebase保存後の読み戻し検証に失敗しました。')
  }

  await saveAttemptRef.set({
    status: 'verified',
    verified: true,
    readbackHash,
    verifiedAt: new Date().toISOString(),
  }, { merge: true })

  return {
    classroomId,
    savedAt,
    saveId,
    payloadHash,
    verified: true,
    idempotentReplay: false,
    writeMode,
    dataByteLength,
  }
}

export const saveClassroomSnapshot = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  return saveClassroomSnapshotFromCallable(request)
})

export const saveDevelopmentClassroomSnapshot = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  return saveClassroomSnapshotFromCallable(request, { developmentOnly: true })
})

export const deleteWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const classroomCount = await countClassrooms(workspaceKey)
  if (classroomCount <= 1) {
    throw new HttpsError('failed-precondition', '最後の1教室は削除できません。')
  }

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc(classroomId)
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomId)
  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }

  const managerUserId = readString(classroomSnapshot.get('managerUserId') ?? '', 'managerUserId')
  const batch = firestore.batch()
  batch.delete(classroomRef)
  batch.delete(snapshotRef)
  batch.delete(workspaceRef.collection('members').doc(managerUserId))
  await batch.commit()

  await auth.deleteUser(managerUserId).catch(() => undefined)

  return {
    classroomId,
    managerUserId,
    deletedAt: new Date().toISOString(),
  }
})

export const downloadServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const backupDateKey = readString(rawData.backupDateKey, 'backupDateKey')

  logger.info(`downloadServerAutoBackup: workspaceKey=${workspaceKey}, backupDateKey=${backupDateKey}`)

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const summarySnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('workspaceAutoBackupSummaries').doc(backupDateKey).get()
  if (!summarySnapshot.exists) {
    throw new HttpsError('not-found', `指定したサーバーバックアップが見つかりません。(${backupDateKey})`)
  }
  const summary = summarySnapshot.data() as WorkspaceAutoBackupSummaryDoc
  const storagePath = typeof summary.storagePath === 'string' && summary.storagePath.trim()
    ? summary.storagePath
    : buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, summary.backupKind === 'hourly' ? 'hourly' : 'daily')
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    logger.warn(`downloadServerAutoBackup: file not found at ${storagePath}`)
    throw new HttpsError('not-found', `指定したサーバーバックアップが見つかりません。(${storagePath})`)
  }

  await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-workspace-${backupDateKey}`)

  const [content] = await file.download()
  logger.info(`downloadServerAutoBackup: downloaded ${content.length} bytes from ${storagePath}`)
  return { snapshotJson: content.toString('utf-8') }
})

export const downloadClassroomFromServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const backupDateKey = readString(rawData.backupDateKey, 'backupDateKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(request.auth.uid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as FirebaseWorkspaceMemberDoc | undefined
  if (member?.role !== 'developer' && member?.assignedClassroomId !== classroomId) {
    throw new HttpsError('permission-denied', 'この教室のバックアップにアクセスする権限がありません。')
  }

  const summarySnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('workspaceAutoBackupSummaries').doc(backupDateKey).get()
  if (!summarySnapshot.exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }
  const summary = summarySnapshot.data() as WorkspaceAutoBackupSummaryDoc
  const storagePath = typeof summary.storagePath === 'string' && summary.storagePath.trim()
    ? summary.storagePath
    : buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, summary.backupKind === 'hourly' ? 'hourly' : 'daily')
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }

  await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-classroom-${classroomId}-${backupDateKey}`)

  const [content] = await file.download()
  const snapshot = JSON.parse(content.toString('utf-8')) as WorkspaceSnapshot
  const classroom = snapshot.classrooms?.find((c) => c.id === classroomId)
  if (!classroom) {
    throw new HttpsError('not-found', 'バックアップ内に該当教室のデータが見つかりません。')
  }

  return {
    classroomId: classroom.id,
    classroomName: classroom.name,
    savedAt: snapshot.savedAt,
    data: classroom.data,
  }
})

export const mirrorLatestClassroomRollback = onDocumentWritten({
  document: 'workspaces/{workspaceKey}/classroomSnapshots/{classroomId}',
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (event) => {
  const beforeSnapshot = event.data?.before.data() as FirebaseClassroomSnapshotDoc | undefined
  const afterSnapshot = event.data?.after.data() as FirebaseClassroomSnapshotDoc | undefined

  if (!beforeSnapshot) return

  try {
    await writeLatestClassroomRollback({
      workspaceKey: event.params.workspaceKey,
      classroomId: event.params.classroomId,
      beforeSnapshot,
      afterSnapshot,
    })
  } catch (error) {
    logger.error(`[LatestRollback] Failed to mirror previous classroom snapshot: workspace=${event.params.workspaceKey}, classroom=${event.params.classroomId}`, error)
    throw error
  }
})

export const downloadLatestClassroomRollback = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(request.auth.uid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as FirebaseWorkspaceMemberDoc | undefined
  if (member?.role !== 'developer' && member?.assignedClassroomId !== classroomId) {
    throw new HttpsError('permission-denied', 'この教室の直前保存にアクセスする権限がありません。')
  }

  const storagePath = buildClassroomLatestRollbackStoragePath(workspaceKey, classroomId)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', 'この教室にはまだ直前の Firebase 保存データがありません。')
  }

  await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-latest-classroom-${classroomId}`)

  const [content] = await file.download()
  const rollbackDoc = JSON.parse(content.toString('utf-8')) as ClassroomLatestRollbackStorageDoc
  const payload = readStoredSnapshotPayload(rollbackDoc.snapshot)
  if (!payload) {
    throw new HttpsError('data-loss', '直前保存データの読み込みに失敗しました。')
  }

  return {
    classroomId: rollbackDoc.classroomId,
    sourceSavedAt: rollbackDoc.sourceSavedAt,
    capturedAt: rollbackDoc.capturedAt,
    data: payload,
  }
})

export const createWorkspaceServerAutoBackups = onSchedule({
  schedule: WORKSPACE_DAILY_AUTO_BACKUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
}, async () => {
  await runWorkspaceServerAutoBackup('daily')
})

export const createWorkspaceServerHourlyBackups = onSchedule({
  schedule: WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
}, async () => {
  await runWorkspaceServerAutoBackup('hourly')
})

export const triggerWorkspaceServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  await requireDeveloperMember(request.auth?.uid, workspaceKey)
  const result = await runWorkspaceServerAutoBackup('hourly')
  return result
})

async function runWorkspaceServerAutoBackup(backupKind: WorkspaceAutoBackupKind) {
  const now = new Date()
  const savedAt = now.toISOString()
  const backupDateKey = backupKind === 'daily' ? toOperationalDateKeyJst(now) : toHourlyDateKeyJst(now)
  logger.info(`[AutoBackup] Starting ${backupKind} backup run: backupDateKey=${backupDateKey}, savedAt=${savedAt}, bucket=${STORAGE_BUCKET}`)
  const workspacesSnapshot = await firestore.collection('workspaces').get()
  logger.info(`[AutoBackup] Found ${workspacesSnapshot.docs.length} workspace(s)`)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const results: Array<{ workspaceKey: string; backupDateKey: string; storagePath: string; backupKind: WorkspaceAutoBackupKind }> = []

  for (const workspaceDoc of workspacesSnapshot.docs) {
    const workspaceKey = workspaceDoc.id
    logger.info(`[AutoBackup] Processing workspace: ${workspaceKey} (${backupKind})`)
    const { snapshot, latestSourceSavedAt } = await buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt)
    const storagePath = buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, backupKind)

    await bucket.file(storagePath).save(JSON.stringify(snapshot, null, 2), {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })
    logger.info(`[AutoBackup] Saved to Storage: ${storagePath}`)

    await Promise.all([
      workspaceDoc.ref.collection('workspaceAutoBackupSummaries').doc(backupDateKey).set({
        backupDateKey,
        backupKind,
        displayLabel: buildWorkspaceAutoBackupDisplayLabel(backupDateKey, backupKind),
        savedAt,
        sourceSavedAt: latestSourceSavedAt,
        storagePath,
        createdAt: savedAt,
      } satisfies WorkspaceAutoBackupSummaryDoc, { merge: true }),
      workspaceDoc.ref.set({
        serverAutoBackupLastSavedAt: savedAt,
        serverAutoBackupLastBackupDateKey: backupDateKey,
        serverAutoBackupLastBackupKind: backupKind,
        serverAutoBackupLastStoragePath: storagePath,
      }, { merge: true }),
    ])
    logger.info(`[AutoBackup] Saved summary for workspace=${workspaceKey}, backupDateKey=${backupDateKey}, backupKind=${backupKind}`)

    await pruneWorkspaceServerAutoBackups(workspaceKey, now)
    results.push({ workspaceKey, backupDateKey, storagePath, backupKind })
  }

  logger.info(`[AutoBackup] Completed ${backupKind}: ${results.length} workspace(s) backed up`)
  return { backupDateKey, backupKind, workspaceCount: results.length, results }
}

// ---------------------------------------------------------------------------
// Lecture submission API (unauthenticated access via token)
// ---------------------------------------------------------------------------

type LectureSubmissionDoc = {
  workspaceKey: string
  classroomId: string
  sessionId: string
  personType: 'student' | 'teacher'
  personId: string
  personName: string
  sessionLabel: string
  sessionStartDate: string
  sessionEndDate: string
  closedWeekdays: number[]
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  slotNumbers?: number[]
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
  submittedAt: string | null
  createdAt: string
}

function extractTokenFromPath(rawPath: string) {
  const segments = rawPath.replace(/^\/+|\/+$/g, '').split('/')
  return segments.pop() || ''
}

function isValidSlotKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}_\d+$/.test(value)
}

function sanitizeUnavailableSlots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(isValidSlotKey).slice(0, 5000)
}

function sanitizeSubjectSlots(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length <= 10 && typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 999) {
      result[key] = val
    }
  }
  return result
}

function sanitizeSlotNumbers(value: unknown, fallbackCount: number) {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : Array.from({ length: Math.max(1, Math.min(20, fallbackCount || 7)) }, (_, index) => index + 1)

  return Array.from(new Set(source
    .map((slotNumber) => Math.trunc(Number(slotNumber)))
    .filter((slotNumber) => Number.isFinite(slotNumber) && slotNumber > 0 && slotNumber <= 20)))
    .sort((left, right) => left - right)
}

export const lectureSubmissionApi = onRequest({
  cors: true,
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
}, async (req, res) => {
  const token = extractTokenFromPath(req.path)
  if (!token || token.length < 16 || token.length > 64) {
    res.status(400).json({ error: 'Invalid token' })
    return
  }

  const docRef = firestore.collection('lectureSubmissions').doc(token)

  if (req.method === 'GET') {
    const doc = await docRef.get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const data = doc.data() as LectureSubmissionDoc
    res.json({
      personName: data.personName ?? '',
      personType: data.personType ?? '',
      sessionLabel: data.sessionLabel ?? '',
      sessionStartDate: data.sessionStartDate ?? '',
      sessionEndDate: data.sessionEndDate ?? '',
      closedWeekdays: data.closedWeekdays ?? [],
      forceOpenDates: data.forceOpenDates ?? [],
      availableSubjects: data.availableSubjects ?? [],
      slotCount: data.slotCount ?? 7,
      slotNumbers: sanitizeSlotNumbers(data.slotNumbers, data.slotCount ?? 7),
      status: data.status ?? 'pending',
      unavailableSlots: data.unavailableSlots ?? [],
      subjectSlots: data.subjectSlots ?? {},
      regularOnly: data.regularOnly ?? false,
      occupiedSlots: data.occupiedSlots ?? {},
    })
    return
  }

  if (req.method === 'POST') {
    const doc = await docRef.get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const data = doc.data() as LectureSubmissionDoc
    if (data.status === 'submitted') {
      res.status(409).json({ error: 'Already submitted' })
      return
    }

    const body = typeof req.body === 'object' && req.body !== null ? req.body : {}
    const unavailableSlots = sanitizeUnavailableSlots(body.unavailableSlots)
    const subjectSlots = data.personType === 'student' ? sanitizeSubjectSlots(body.subjectSlots) : {}
    const regularOnly = data.personType === 'student' ? Boolean(body.regularOnly) : false
    const now = new Date().toISOString()

    await docRef.update({
      status: 'submitted',
      unavailableSlots,
      subjectSlots,
      regularOnly,
      submittedAt: now,
    })

    // Also update the classroom snapshot so admin sees the data immediately
    try {
      const snapshotRef = firestore
        .collection('workspaces').doc(data.workspaceKey)
        .collection('classroomSnapshots').doc(data.classroomId)

      await firestore.runTransaction(async (transaction) => {
        const snapshotDoc = await transaction.get(snapshotRef)
        if (!snapshotDoc.exists) return

        const snapshotData = snapshotDoc.data() as FirebaseClassroomSnapshotDoc
        const payload = readStoredSnapshotPayload(snapshotData)
        if (!payload?.specialSessions || !Array.isArray(payload.specialSessions)) return

        const sessions = payload.specialSessions as Array<Record<string, unknown>>
        const sessionIndex = sessions.findIndex((s) => s.id === data.sessionId)
        if (sessionIndex < 0) return

        const session = sessions[sessionIndex]
        const inputKey = data.personType === 'teacher' ? 'teacherInputs' : 'studentInputs'
        const inputs = (session[inputKey] ?? {}) as Record<string, Record<string, unknown>>
        const existingInput = inputs[data.personId] ?? {}

        inputs[data.personId] = {
          ...existingInput,
          unavailableSlots,
          ...(data.personType === 'student' ? { subjectSlots, regularOnly, regularBreakSlots: existingInput.regularBreakSlots ?? [] } : {}),
          countSubmitted: true,
          submissionToken: token,
          updatedAt: now,
        }
        session[inputKey] = inputs
        sessions[sessionIndex] = session

        transaction.set(snapshotRef, createStoredSnapshotDoc({
          payload: { ...payload, specialSessions: sessions },
          savedAt: typeof snapshotData?.savedAt === 'string' && snapshotData.savedAt ? snapshotData.savedAt : now,
          updatedBy: typeof snapshotData?.updatedBy === 'string' ? snapshotData.updatedBy : '',
          updatedAt: now,
          schemaVersion: typeof snapshotData?.schemaVersion === 'number' ? snapshotData.schemaVersion : 1,
        }))
      })
    } catch {
      // Non-fatal: submission is saved even if snapshot update fails
    }

    res.json({ success: true, submittedAt: now })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
})