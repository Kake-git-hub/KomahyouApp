import { collection, doc, getDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { type AppSnapshotPayload, type WorkspaceClassroom } from '../../types/appState'
import { getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'

type ProvisionWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomName: string
  managerName: string
  managerEmail: string
  contractStartDate: string
  contractEndDate: string
  initialPayload: AppSnapshotPayload
}

type ProvisionWorkspaceClassroomWithExistingUidRequest = ProvisionWorkspaceClassroomRequest & {
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
    data: input.initialPayload,
    updatedBy: '',
    updatedAt: now,
  })
  await batch.commit()

  return {
    classroomId: classroomRef.id,
    managerUserId: input.managerUserId,
  }
}

export async function updateFirebaseWorkspaceClassroom(input: Omit<UpdateWorkspaceClassroomRequest, 'workspaceKey'>) {
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
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<DeleteWorkspaceClassroomRequest, { classroomId: string }>(functions, 'deleteWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}