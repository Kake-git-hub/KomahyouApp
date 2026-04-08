import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { type AppSnapshotPayload, type WorkspaceClassroom } from '../../types/appState'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'

export type ServerAutoBackupSummary = {
  backupDateKey: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
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

type DeleteWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomId: string
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
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
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
  const q = query(summariesRef, orderBy('backupDateKey', 'desc'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    return {
      backupDateKey: String(data.backupDateKey ?? entry.id),
      savedAt: String(data.savedAt ?? ''),
      sourceSavedAt: String(data.sourceSavedAt ?? ''),
      storagePath: String(data.storagePath ?? ''),
    }
  })
}

export async function downloadFirebaseServerAutoBackup(backupDateKey: string): Promise<string> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string }, { snapshotJson: string }>(functions, 'downloadServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
  })
  return result.data.snapshotJson
}

export async function triggerFirebaseServerAutoBackup(): Promise<{ backupDateKey: string; workspaceCount: number }> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string }, { backupDateKey: string; workspaceCount: number }>(functions, 'triggerWorkspaceServerAutoBackup', { timeout: 120_000 })
  const result = await callable({ workspaceKey: config.workspaceKey })
  return result.data
}

export type ClassroomFromServerAutoBackup = {
  classroomId: string
  classroomName: string
  savedAt: string
  data: AppSnapshotPayload
}

export async function downloadClassroomFromFirebaseServerAutoBackup(backupDateKey: string, classroomId: string): Promise<ClassroomFromServerAutoBackup> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string; classroomId: string }, ClassroomFromServerAutoBackup>(functions, 'downloadClassroomFromServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
    classroomId,
  })
  return result.data
}