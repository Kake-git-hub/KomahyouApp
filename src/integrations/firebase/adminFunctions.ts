import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { type AppSnapshotPayload, type WorkspaceClassroom } from '../../types/appState'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'
import { getClassroomSnapshotVersion, setClassroomSnapshotVersion } from './classroomSnapshotVersions'

export type GoogleDriveBackupStatus = 'disabled' | 'synced' | 'failed'

export type GoogleDriveBackupDiagnostic = {
  workspaceKey: string
  backupDateKey: string
  backupKind: 'daily' | 'hourly'
  status: GoogleDriveBackupStatus
  configured: boolean
  folderIdMasked: string
  authSource: 'application-default' | 'service-account-json' | 'oauth-refresh-token'
  serviceAccountEmail: string
  fileId?: string
  fileName?: string
  error?: string
  errorStatusCode?: number
  errorHint?: string
}

export type ServerAutoBackupSummary = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly'
  displayLabel: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
  googleDriveBackupStatus?: GoogleDriveBackupStatus
  googleDriveBackupFileId?: string
  googleDriveBackupFileName?: string
  googleDriveBackupError?: string
  googleDriveBackupErrorHint?: string
  googleDriveBackupAuthSource?: string
  googleDriveBackupServiceAccountEmail?: string
  googleDriveBackupFolderIdMasked?: string
}

export type TriggerServerAutoBackupResult = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly'
  workspaceCount: number
  googleDriveBackups: GoogleDriveBackupDiagnostic[]
}

type ProvisionWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomName: string
  managerName: string
  managerEmail: string
  managerPassword?: string
  contractStartDate: string
  contractEndDate: string
  initialPayload: AppSnapshotPayload
}

type ProvisionWorkspaceClassroomWithExistingUidRequest = ProvisionWorkspaceClassroomRequest & {
  managerUserId: string
}

type ReassignWorkspaceClassroomManagerWithExistingUidRequest = {
  workspaceKey: string
  classroomId: string
  managerName: string
  managerEmail: string
  managerUserId: string
}

type ReassignWorkspaceClassroomManagerWithExistingUidResponse = {
  classroomId: string
  managerUserId: string
  deletedPreviousManagerUserId?: string
  cleanupWarning?: string
}

type ProvisionWorkspaceClassroomResponse = {
  classroomId: string
  managerUserId: string
  temporaryPassword: string
}

type UpdateWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomId: string
  classroomName: string
  managerName: string
  managerEmail: string
  contractStatus: WorkspaceClassroom['contractStatus']
  contractStartDate: string
  contractEndDate: string
}

type SaveClassroomSnapshotRequest = {
  workspaceKey: string
  classroomId: string
  savedAt: string
  saveId: string
  payload: AppSnapshotPayload
  // A1: このタブが読み込んだ時点の版数。サーバーが現在版数と照合し、古ければ拒否する。
  baseVersion?: number
}

export type SaveClassroomSnapshotOptions = {
  developmentOnly?: boolean
}

type DeleteWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomId: string
}

function normalizeGoogleDriveBackupStatus(value: unknown): GoogleDriveBackupStatus | undefined {
  if (value === 'disabled' || value === 'synced' || value === 'failed') return value
  return undefined
}

function normalizeGoogleDriveBackupDiagnostic(value: unknown): GoogleDriveBackupDiagnostic | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const status = normalizeGoogleDriveBackupStatus(data.status) ?? 'disabled'
  const backupKind = data.backupKind === 'daily' ? 'daily' : 'hourly'
  const errorStatusCode = Number(data.errorStatusCode)

  return {
    workspaceKey: String(data.workspaceKey ?? ''),
    backupDateKey: String(data.backupDateKey ?? ''),
    backupKind,
    status,
    configured: Boolean(data.configured),
    folderIdMasked: String(data.folderIdMasked ?? ''),
    authSource: data.authSource === 'service-account-json' || data.authSource === 'oauth-refresh-token' ? data.authSource : 'application-default',
    serviceAccountEmail: String(data.serviceAccountEmail ?? ''),
    fileId: String(data.fileId ?? '') || undefined,
    fileName: String(data.fileName ?? '') || undefined,
    error: String(data.error ?? '') || undefined,
    errorStatusCode: Number.isFinite(errorStatusCode) ? errorStatusCode : undefined,
    errorHint: String(data.errorHint ?? '') || undefined,
  }
}

function requireFunctions() {
  const functions = getFirebaseFunctionsInstance()
  if (!functions) {
    throw new Error('Firebase Functions を利用できません。接続設定を確認してください。')
  }

  return functions
}

function requireFirestore() {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) {
    throw new Error('Firebase Firestore を利用できません。接続設定を確認してください。')
  }

  return firestore
}

export async function provisionFirebaseWorkspaceClassroom(input: Omit<ProvisionWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<ProvisionWorkspaceClassroomRequest, ProvisionWorkspaceClassroomResponse>(functions, 'provisionWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}

export async function provisionFirebaseWorkspaceClassroomWithExistingUid(input: Omit<ProvisionWorkspaceClassroomWithExistingUidRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const membersCollectionRef = collection(workspaceRef, 'members')
  const classroomsCollectionRef = collection(workspaceRef, 'classrooms')
  const snapshotsCollectionRef = collection(workspaceRef, 'classroomSnapshots')
  const memberRef = doc(membersCollectionRef, input.managerUserId)
  const memberSnapshot = await getDoc(memberRef)
  if (memberSnapshot.exists()) {
    throw new Error('この UID はすでに members に登録されています。既存ユーザーかどうかを確認してください。')
  }

  const classroomRef = doc(classroomsCollectionRef)
  const snapshotRef = doc(snapshotsCollectionRef, classroomRef.id)
  const now = new Date().toISOString()
  const batch = writeBatch(firestore)

  batch.set(workspaceRef, {
    name: config.workspaceKey,
    schemaVersion: 1,
    updatedAt: now,
  }, { merge: true })
  batch.set(memberRef, {
    displayName: input.managerName,
    email: input.managerEmail,
    role: 'manager',
    assignedClassroomId: classroomRef.id,
    updatedAt: now,
  })
  batch.set(classroomRef, {
    name: input.classroomName,
    contractStatus: 'active',
    contractStartDate: input.contractStartDate,
    contractEndDate: input.contractEndDate,
    managerUserId: input.managerUserId,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    updatedAt: now,
  })
  batch.set(snapshotRef, {
    schemaVersion: 1,
    savedAt: now,
    data: sanitizeForFirestore(input.initialPayload),
    updatedBy: '',
    updatedAt: now,
  })
  await batch.commit()

  return {
    classroomId: classroomRef.id,
    managerUserId: input.managerUserId,
  }
}

export async function reassignFirebaseWorkspaceClassroomManagerWithExistingUid(input: Omit<ReassignWorkspaceClassroomManagerWithExistingUidRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const config = getFirebaseBackendConfig()
  if (config.adminFunctionsEnabled) {
    const functions = requireFunctions()
    const callable = httpsCallable<ReassignWorkspaceClassroomManagerWithExistingUidRequest, ReassignWorkspaceClassroomManagerWithExistingUidResponse>(functions, 'reassignWorkspaceClassroomManager')
    const result = await callable({
      workspaceKey: config.workspaceKey,
      ...input,
    })
    return result.data
  }

  const firestore = requireFirestore()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const membersCollectionRef = collection(workspaceRef, 'members')
  const classroomsCollectionRef = collection(workspaceRef, 'classrooms')
  const classroomRef = doc(classroomsCollectionRef, input.classroomId)
  const classroomSnapshot = await getDoc(classroomRef)
  if (!classroomSnapshot.exists()) {
    throw new Error('対象の教室が見つかりません。')
  }

  const currentManagerUserId = String(classroomSnapshot.get('managerUserId') ?? '').trim()
  if (!currentManagerUserId) {
    throw new Error('現在の管理者 UID が未設定のため、差し替えできません。')
  }

  if (currentManagerUserId === input.managerUserId) {
    return {
      classroomId: input.classroomId,
      managerUserId: input.managerUserId,
    }
  }

  const currentMemberRef = doc(membersCollectionRef, currentManagerUserId)
  const nextMemberRef = doc(membersCollectionRef, input.managerUserId)
  const nextMemberSnapshot = await getDoc(nextMemberRef)
  if (nextMemberSnapshot.exists()) {
    const assignedClassroomId = String(nextMemberSnapshot.get('assignedClassroomId') ?? '').trim()
    if (assignedClassroomId && assignedClassroomId !== input.classroomId) {
      throw new Error('この UID はすでに別の教室へ割り当てられています。別ユーザーかどうかを確認してください。')
    }
  }

  const now = new Date().toISOString()
  const batch = writeBatch(firestore)

  batch.set(workspaceRef, {
    name: config.workspaceKey,
    schemaVersion: 1,
    updatedAt: now,
  }, { merge: true })
  batch.set(nextMemberRef, {
    displayName: input.managerName,
    email: input.managerEmail,
    role: 'manager',
    assignedClassroomId: input.classroomId,
    updatedAt: now,
  }, { merge: true })
  batch.set(classroomRef, {
    managerUserId: input.managerUserId,
    updatedAt: now,
  }, { merge: true })

  if (currentManagerUserId !== input.managerUserId) {
    batch.delete(currentMemberRef)
  }

  await batch.commit()

  return {
    classroomId: input.classroomId,
    managerUserId: input.managerUserId,
  }
}

export async function updateFirebaseWorkspaceClassroom(input: Omit<UpdateWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<UpdateWorkspaceClassroomRequest, { classroomId: string }>(functions, 'updateWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}

export function resolveSaveClassroomSnapshotCallableName(options?: SaveClassroomSnapshotOptions) {
  return options?.developmentOnly ? 'saveDevelopmentClassroomSnapshot' : 'saveClassroomSnapshot'
}

export async function saveClassroomSnapshotViaFunction(
  input: Omit<SaveClassroomSnapshotRequest, 'workspaceKey' | 'baseVersion'>,
  options?: SaveClassroomSnapshotOptions,
): Promise<{
  classroomId: string
  savedAt: string
  saveId: string
  payloadHash: string
  verified: boolean
  idempotentReplay: boolean
  writeMode: string
  dataByteLength: number
  version?: number
}> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<SaveClassroomSnapshotRequest, {
    classroomId: string
    savedAt: string
    saveId: string
    payloadHash: string
    verified: boolean
    idempotentReplay: boolean
    writeMode: string
    dataByteLength: number
    version?: number
  }>(functions, resolveSaveClassroomSnapshotCallableName(options), { timeout: 120_000 })
  // A1: このタブが把握している版数を baseVersion として送る(未読込なら undefined=照合スキップ)。
  const baseVersion = getClassroomSnapshotVersion(input.classroomId)
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
    ...(typeof baseVersion === 'number' ? { baseVersion } : {}),
    payload: sanitizeForFirestore(input.payload),
  })
  // 保存成功で返ってきた新版数をレジストリへ反映し、次の保存の baseVersion にする。
  if (typeof result.data.version === 'number') {
    setClassroomSnapshotVersion(input.classroomId, result.data.version)
  }
  return result.data
}

export async function deleteFirebaseWorkspaceClassroom(input: Omit<DeleteWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<DeleteWorkspaceClassroomRequest, { classroomId: string }>(functions, 'deleteWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}

export async function deleteFirebaseWorkspaceClassroomDirect(input: { classroomId: string }) {
  const authenticatedUser = await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const classroomsCollectionRef = collection(workspaceRef, 'classrooms')
  const membersCollectionRef = collection(workspaceRef, 'members')
  const snapshotsCollectionRef = collection(workspaceRef, 'classroomSnapshots')
  const classroomRef = doc(classroomsCollectionRef, input.classroomId)
  const classroomSnapshot = await getDoc(classroomRef)
  if (!classroomSnapshot.exists()) {
    throw new Error('対象の教室が見つかりません。')
  }
  const managerUserId = String(classroomSnapshot.get('managerUserId') ?? '').trim()

  // Delete classroom doc first
  await deleteDoc(classroomRef)

  // Delete snapshot doc (ignore if not exists)
  try {
    await deleteDoc(doc(snapshotsCollectionRef, input.classroomId))
  } catch {
    // snapshot may not exist
  }

  // Delete member doc only if it belongs to a different user (not the developer)
  if (managerUserId && managerUserId !== authenticatedUser.uid) {
    try {
      await deleteDoc(doc(membersCollectionRef, managerUserId))
    } catch {
      // member doc may not exist
    }
  }

  return { classroomId: input.classroomId }
}

export async function listFirebaseServerAutoBackupSummaries(): Promise<ServerAutoBackupSummary[]> {
  await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const summariesRef = collection(workspaceRef, 'workspaceAutoBackupSummaries')
  const q = query(summariesRef, orderBy('savedAt', 'desc'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    const backupDateKey = String(data.backupDateKey ?? entry.id)
    const backupKind = data.backupKind === 'hourly' ? 'hourly' : 'daily'
    return {
      backupDateKey,
      backupKind,
      displayLabel: String(data.displayLabel ?? backupDateKey),
      savedAt: String(data.savedAt ?? ''),
      sourceSavedAt: String(data.sourceSavedAt ?? ''),
      storagePath: String(data.storagePath ?? ''),
      googleDriveBackupStatus: normalizeGoogleDriveBackupStatus(data.googleDriveBackupStatus),
      googleDriveBackupFileId: String(data.googleDriveBackupFileId ?? ''),
      googleDriveBackupFileName: String(data.googleDriveBackupFileName ?? ''),
      googleDriveBackupError: String(data.googleDriveBackupError ?? ''),
      googleDriveBackupErrorHint: String(data.googleDriveBackupErrorHint ?? ''),
      googleDriveBackupAuthSource: String(data.googleDriveBackupAuthSource ?? ''),
      googleDriveBackupServiceAccountEmail: String(data.googleDriveBackupServiceAccountEmail ?? ''),
      googleDriveBackupFolderIdMasked: String(data.googleDriveBackupFolderIdMasked ?? ''),
    }
  })
}

// 本番のワークスペースバックアップ JSON は数十 MB に達する(教室分のフルスナップショット)。
// Firebase callable のレスポンス上限(約10MB)を超えると `internal` で失敗するため、
// サーバーは gzip+base64 で圧縮して返す(44MB→約2.4MB)。ここで元の JSON 文字列へ復元する。
async function gunzipBase64ToString(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  if (typeof DecompressionStream === 'function') {
    const decompressedStream = new Response(new Blob([bytes])).body?.pipeThrough(new DecompressionStream('gzip'))
    if (!decompressedStream) throw new Error('サーバーバックアップの展開に失敗しました。')
    return await new Response(decompressedStream).text()
  }
  throw new Error('このブラウザは圧縮バックアップの展開に対応していません。最新のブラウザでお試しください。')
}

export async function downloadFirebaseServerAutoBackup(backupDateKey: string): Promise<string> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string }, { snapshotJson?: string; snapshotGzipBase64?: string }>(functions, 'downloadServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
  })
  if (typeof result.data.snapshotGzipBase64 === 'string' && result.data.snapshotGzipBase64) {
    return await gunzipBase64ToString(result.data.snapshotGzipBase64)
  }
  if (typeof result.data.snapshotJson === 'string') {
    return result.data.snapshotJson
  }
  throw new Error('サーバーバックアップの応答が不正です。')
}

export async function triggerFirebaseServerAutoBackup(): Promise<TriggerServerAutoBackupResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string }, {
    backupDateKey: string
    backupKind?: 'daily' | 'hourly'
    workspaceCount: number
    googleDriveBackups?: unknown[]
  }>(functions, 'triggerWorkspaceServerAutoBackup', { timeout: 120_000 })
  const result = await callable({ workspaceKey: config.workspaceKey })
  return {
    backupDateKey: String(result.data.backupDateKey ?? ''),
    backupKind: result.data.backupKind === 'daily' ? 'daily' : 'hourly',
    workspaceCount: Number(result.data.workspaceCount ?? 0),
    googleDriveBackups: (result.data.googleDriveBackups ?? [])
      .map(normalizeGoogleDriveBackupDiagnostic)
      .filter((entry): entry is GoogleDriveBackupDiagnostic => entry !== null),
  }
}

export type ClassroomFromServerAutoBackup = {
  classroomId: string
  classroomName: string
  savedAt: string
  data: AppSnapshotPayload
}

export type ClassroomLatestRollback = {
  classroomId: string
  sourceSavedAt: string
  capturedAt: string
  data: AppSnapshotPayload
}

export type DevelopmentBackupSource = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly'
  displayLabel: string
  savedAt: string
  sourceSavedAt: string
}

export type DevelopmentClassroomBackupSources = {
  backups: DevelopmentBackupSource[]
  classrooms: Array<{ id: string; name: string }>
}

// Feature B: 開発用教室へ読み込める「他教室 × バックアップ時点」の候補を取得する。
// 開発者でも開発用教室の室長でも呼べる(サーバー側で権限判定)。
export async function listDevelopmentClassroomBackupSources(): Promise<DevelopmentClassroomBackupSources> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string }, DevelopmentClassroomBackupSources>(functions, 'listDevelopmentClassroomBackupSources', { timeout: 120_000 })
  const result = await callable({ workspaceKey: config.workspaceKey })
  return {
    backups: Array.isArray(result.data.backups) ? result.data.backups : [],
    classrooms: Array.isArray(result.data.classrooms) ? result.data.classrooms : [],
  }
}

export async function downloadClassroomFromFirebaseServerAutoBackup(backupDateKey: string, classroomId: string): Promise<ClassroomFromServerAutoBackup> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string; classroomId: string }, { classroomId: string; classroomName: string; savedAt: string; dataGzipBase64?: string; data?: AppSnapshotPayload }>(functions, 'downloadClassroomFromServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
    classroomId,
  })
  // 1教室分でも数MBになりうるため、サーバーは gzip+base64 で返す。ここで AppSnapshotPayload へ復元する。
  let data: AppSnapshotPayload
  if (typeof result.data.dataGzipBase64 === 'string' && result.data.dataGzipBase64) {
    data = JSON.parse(await gunzipBase64ToString(result.data.dataGzipBase64)) as AppSnapshotPayload
  } else if (result.data.data) {
    data = result.data.data
  } else {
    throw new Error('教室バックアップの応答が不正です。')
  }
  return {
    classroomId: result.data.classroomId,
    classroomName: result.data.classroomName,
    savedAt: result.data.savedAt,
    data,
  }
}

export async function downloadLatestFirebaseClassroomRollback(classroomId: string): Promise<ClassroomLatestRollback> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string }, ClassroomLatestRollback>(functions, 'downloadLatestClassroomRollback', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId,
  })
  return result.data
}
