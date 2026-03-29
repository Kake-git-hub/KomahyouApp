import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2/options'

initializeApp()

setGlobalOptions({
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
})

const firestore = getFirestore()
const auth = getAuth()

type ClassroomContractStatus = 'active' | 'suspended'

type ClassroomProvisionPayload = {
  workspaceKey: string
  classroomName: string
  managerName: string
  managerEmail: string
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
  const initialPayload = readPayloadObject(rawData.initialPayload, 'initialPayload')
  const sanitizedInitialPayload = sanitizeForFirestore(initialPayload)

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc()
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomRef.id)
  const temporaryPassword = buildTemporaryPassword()
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