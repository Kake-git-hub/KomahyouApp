import { httpsCallable } from 'firebase/functions'
import { type AppSnapshotPayload, type WorkspaceClassroom } from '../../types/appState'
import { getFirebaseFunctionsInstance } from './client'
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