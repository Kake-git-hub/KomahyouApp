import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2/options'
import { onSchedule } from 'firebase-functions/v2/scheduler'

initializeApp()

setGlobalOptions({
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
})

const firestore = getFirestore()
const auth = getAuth()
const storage = getStorage()
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'komahyouapp-prod.firebasestorage.app'

const WORKSPACE_AUTO_BACKUP_RETENTION_DAYS = 14
const WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST = 2
const WORKSPACE_AUTO_BACKUP_SCHEDULE = process.env.WORKSPACE_AUTO_BACKUP_SCHEDULE ?? '10 2 * * *'
const WORKSPACE_AUTO_BACKUP_TIME_ZONE = 'Asia/Tokyo'
const HOUR_IN_MS = 60 * 60 * 1000
const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS

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

type WorkspaceAutoBackupSummaryDoc = {
  backupDateKey: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
  createdAt: string
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

function getWorkspaceAutoBackupCutoffKey(referenceDate: Date, retentionDays: number) {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays) || 1)
  const operationalDate = new Date(referenceDate.getTime() + JST_OFFSET_IN_MS - WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST * HOUR_IN_MS)
  operationalDate.setUTCDate(operationalDate.getUTCDate() - (safeRetentionDays - 1))
  return toUtcDateKey(operationalDate)
}

function buildWorkspaceAutoBackupStoragePath(workspaceKey: string, backupDateKey: string) {
  return `workspace-auto-backups/${workspaceKey}/${backupDateKey}.json`
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
    return toWorkspaceClassroom(entry.id, classroomData, deserializeSnapshotPayload(snapshotData?.data) ?? null)
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
  const cutoffKey = getWorkspaceAutoBackupCutoffKey(referenceDate, WORKSPACE_AUTO_BACKUP_RETENTION_DAYS)
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const summarySnapshots = await workspaceRef.collection('workspaceAutoBackupSummaries').get()
  const batch = firestore.batch()
  let deleteCount = 0

  await Promise.all(summarySnapshots.docs.map(async (summaryDoc) => {
    if (summaryDoc.id >= cutoffKey) return

    const summary = summaryDoc.data() as WorkspaceAutoBackupSummaryDoc
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

function buildTemporaryPassword() {
  return `Temp-${randomBytes(9).toString('base64url')}`
}

async function countClassrooms(workspaceKey: string) {
  const classroomsSnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').count().get()
  return classroomsSnapshot.data().count
}

export const provisionWorkspaceClassroom = onCall(async (request) => {
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
    const managerUser = await auth.createUser({
      email: managerEmail,
      displayName: managerName,
      password: temporaryPassword,
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
    batch.set(snapshotRef, {
      schemaVersion: 1,
      savedAt: now,
      data: sanitizedInitialPayload,
      updatedBy: request.auth?.uid ?? '',
      updatedAt: now,
    })
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

export const updateWorkspaceClassroom = onCall(async (request) => {
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

export const deleteWorkspaceClassroom = onCall(async (request) => {
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

export const downloadServerAutoBackup = onCall(async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const backupDateKey = readString(rawData.backupDateKey, 'backupDateKey')

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const storagePath = buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }

  const [content] = await file.download()
  return { snapshotJson: content.toString('utf-8') }
})

export const downloadClassroomFromServerAutoBackup = onCall(async (request) => {
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

  const storagePath = buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }

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

export const createWorkspaceServerAutoBackups = onSchedule({
  schedule: WORKSPACE_AUTO_BACKUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
}, async () => {
  const now = new Date()
  const savedAt = now.toISOString()
  const backupDateKey = toOperationalDateKeyJst(now)
  const workspacesSnapshot = await firestore.collection('workspaces').get()
  const bucket = storage.bucket(STORAGE_BUCKET)

  for (const workspaceDoc of workspacesSnapshot.docs) {
    const workspaceKey = workspaceDoc.id
    const { snapshot, latestSourceSavedAt } = await buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt)
    const storagePath = buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey)

    await bucket.file(storagePath).save(JSON.stringify(snapshot, null, 2), {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })

    await Promise.all([
      workspaceDoc.ref.collection('workspaceAutoBackupSummaries').doc(backupDateKey).set({
        backupDateKey,
        savedAt,
        sourceSavedAt: latestSourceSavedAt,
        storagePath,
        createdAt: savedAt,
      } satisfies WorkspaceAutoBackupSummaryDoc, { merge: true }),
      workspaceDoc.ref.set({
        serverAutoBackupLastSavedAt: savedAt,
        serverAutoBackupLastBackupDateKey: backupDateKey,
        serverAutoBackupLastStoragePath: storagePath,
      }, { merge: true }),
    ])

    await pruneWorkspaceServerAutoBackups(workspaceKey, now)
  }
})

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
        const payload = snapshotData?.data
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

        transaction.update(snapshotRef, {
          data: sanitizeForFirestore({ ...payload, specialSessions: sessions }),
          updatedAt: now,
        })
      })
    } catch {
      // Non-fatal: submission is saved even if snapshot update fails
    }

    res.json({ success: true, submittedAt: now })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
})