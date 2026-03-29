import { doc, getDoc, getDocs, setDoc, writeBatch, collection, type Firestore } from 'firebase/firestore'
import { APP_SNAPSHOT_SCHEMA_VERSION, WORKSPACE_SNAPSHOT_SCHEMA_VERSION, type AppSnapshotPayload, type PersistedBoardState, type WorkspaceClassroom, type WorkspaceSnapshot, type WorkspaceUser, type WorkspaceUserRole } from '../../types/appState'
import type { SlotCell } from '../../components/schedule-board/types'
import { getFirebaseFirestoreInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'

const DEFAULT_DEVELOPER_PASSWORD = 'developer'

type FirebaseWorkspaceDoc = {
  name: string
  schemaVersion?: number
}

type FirebaseWorkspaceMemberDoc = {
  displayName: string
  email: string
  role: WorkspaceUserRole
  assignedClassroomId: string | null
}

type FirebaseClassroomDoc = {
  name: string
  contractStatus: WorkspaceClassroom['contractStatus']
  contractStartDate: string
  contractEndDate: string
  managerUserId: string
  isTemporarilySuspended?: boolean
  temporarySuspensionReason?: string
  updatedAt?: string
}

type FirebaseClassroomSnapshotDoc = {
  schemaVersion: number
  savedAt: string
  data: FirebaseAppSnapshotPayload
  updatedBy: string
  updatedAt: string
}

type FirebasePersistedBoardWeek = {
  cells: SlotCell[]
}

type FirebasePersistedBoardState = Omit<PersistedBoardState, 'weeks'> & {
  weeks: FirebasePersistedBoardWeek[]
}

type FirebaseAppSnapshotPayload = Omit<AppSnapshotPayload, 'boardState'> & {
  boardState: FirebasePersistedBoardState | null
}

function requireFirestore() {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) throw new Error('Firebase 設定が不足しています。 .env に接続情報を設定してください。')
  return firestore
}

function getWorkspaceRef(firestore: Firestore) {
  const config = getFirebaseBackendConfig()
  return doc(firestore, 'workspaces', config.workspaceKey)
}

function getMembersCollection(firestore: Firestore) {
  return collection(getWorkspaceRef(firestore), 'members')
}

function getClassroomsCollection(firestore: Firestore) {
  return collection(getWorkspaceRef(firestore), 'classrooms')
}

function getSnapshotsCollection(firestore: Firestore) {
  return collection(getWorkspaceRef(firestore), 'classroomSnapshots')
}

function toWorkspaceUser(userId: string, data: FirebaseWorkspaceMemberDoc): WorkspaceUser {
  return {
    id: userId,
    name: data.displayName?.trim() || data.email?.trim() || userId,
    email: data.email?.trim() || '',
    role: data.role,
    assignedClassroomId: data.assignedClassroomId ?? null,
  }
}

function deserializeBoardState(boardState: FirebasePersistedBoardState | PersistedBoardState | null | undefined): PersistedBoardState | null {
  if (!boardState) return null

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

function serializeBoardState(boardState: PersistedBoardState | null | undefined): FirebasePersistedBoardState | null {
  if (!boardState) return null

  return {
    ...boardState,
    weeks: boardState.weeks.map((week) => ({ cells: week })),
  }
}

function deserializeSnapshotPayload(payload: FirebaseAppSnapshotPayload | AppSnapshotPayload | null | undefined): AppSnapshotPayload | null {
  if (!payload) return null

  return {
    ...payload,
    boardState: deserializeBoardState(payload.boardState),
  }
}

function serializeSnapshotPayload(payload: AppSnapshotPayload): FirebaseAppSnapshotPayload {
  return sanitizeForFirestore({
    ...payload,
    boardState: serializeBoardState(payload.boardState),
  }) as FirebaseAppSnapshotPayload
}

function toWorkspaceClassroom(classroomId: string, data: FirebaseClassroomDoc, snapshotData: AppSnapshotPayload | null, createEmptyClassroomPayload: () => AppSnapshotPayload): WorkspaceClassroom {
  return {
    id: classroomId,
    name: data.name?.trim() || '名称未設定の教室',
    contractStatus: data.contractStatus === 'suspended' ? 'suspended' : 'active',
    contractStartDate: data.contractStartDate ?? '',
    contractEndDate: data.contractEndDate ?? '',
    managerUserId: data.managerUserId,
    isTemporarilySuspended: Boolean(data.isTemporarilySuspended),
    temporarySuspensionReason: data.temporarySuspensionReason ?? '',
    data: snapshotData ?? createEmptyClassroomPayload(),
  }
}

function getLatestSavedAt(classrooms: FirebaseClassroomDoc[], snapshots: FirebaseClassroomSnapshotDoc[]) {
  const candidates = [
    ...classrooms.map((row) => row.updatedAt ?? ''),
    ...snapshots.map((row) => row.savedAt ?? ''),
  ].filter(Boolean)

  return candidates.sort((left, right) => right.localeCompare(left))[0] ?? new Date().toISOString()
}

async function loadWorkspaceMembership(firestore: Firestore, authenticatedUserId: string) {
  const membershipRef = doc(getMembersCollection(firestore), authenticatedUserId)
  const membershipSnapshot = await getDoc(membershipRef)
  if (!membershipSnapshot.exists()) {
    throw new Error('このユーザーは対象ワークスペースに紐付いていません。Firestore の members コレクションを確認してください。')
  }

  return membershipSnapshot.data() as FirebaseWorkspaceMemberDoc
}

export async function loadFirebaseWorkspaceSnapshot(params: {
  authenticatedUserId: string
  createEmptyClassroomPayload: () => AppSnapshotPayload
}) {
  const firestore = requireFirestore()
  const workspaceRef = getWorkspaceRef(firestore)
  const workspaceSnapshot = await getDoc(workspaceRef)
  if (!workspaceSnapshot.exists()) {
    throw new Error('対象 workspace が Firestore に見つかりません。docs/firebase-backend.md の初期セットアップを確認してください。')
  }

  void (workspaceSnapshot.data() as FirebaseWorkspaceDoc)
  const membership = await loadWorkspaceMembership(firestore, params.authenticatedUserId)
  const currentUser = toWorkspaceUser(params.authenticatedUserId, membership)

  const memberSnapshots = membership.role === 'developer'
    ? await getDocs(getMembersCollection(firestore))
    : null

  const users = memberSnapshots
    ? memberSnapshots.docs.map((entry) => toWorkspaceUser(entry.id, entry.data() as FirebaseWorkspaceMemberDoc))
    : [currentUser]

  const classroomDocSnapshots = membership.role === 'developer'
    ? await getDocs(getClassroomsCollection(firestore))
    : (membership.assignedClassroomId
      ? { docs: [await getDoc(doc(getClassroomsCollection(firestore), membership.assignedClassroomId))].filter((entry) => entry.exists()) }
      : { docs: [] })

  const snapshotDocSnapshots = membership.role === 'developer'
    ? await getDocs(getSnapshotsCollection(firestore))
    : (membership.assignedClassroomId
      ? { docs: [await getDoc(doc(getSnapshotsCollection(firestore), membership.assignedClassroomId))].filter((entry) => entry.exists()) }
      : { docs: [] })

  const snapshotByClassroomId = new Map(
    snapshotDocSnapshots.docs.map((entry) => {
      const data = entry.data() as FirebaseClassroomSnapshotDoc
      return [entry.id, data]
    }),
  )

  const classrooms = classroomDocSnapshots.docs.map((entry) => {
    const data = entry.data() as FirebaseClassroomDoc
    const snapshot = snapshotByClassroomId.get(entry.id)
    return toWorkspaceClassroom(entry.id, data, deserializeSnapshotPayload(snapshot?.data) ?? null, params.createEmptyClassroomPayload)
  })

  const actingClassroomId = currentUser.role === 'manager'
    ? currentUser.assignedClassroomId
    : (classrooms[0]?.id ?? null)

  return {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    savedAt: getLatestSavedAt(
      classroomDocSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomDoc),
      snapshotDocSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomSnapshotDoc),
    ),
    developerPassword: DEFAULT_DEVELOPER_PASSWORD,
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: currentUser.id,
    actingClassroomId,
    users,
    classrooms,
  } satisfies WorkspaceSnapshot
}

async function deleteMissingDocs(params: {
  firestore: Firestore
  classroomIds: string[]
  userIds: string[]
}) {
  const { firestore, classroomIds, userIds } = params
  const existingClassrooms = await getDocs(getClassroomsCollection(firestore))
  const existingMembers = await getDocs(getMembersCollection(firestore))
  const batch = writeBatch(firestore)

  existingClassrooms.docs
    .filter((entry) => !classroomIds.includes(entry.id))
    .forEach((entry) => {
      batch.delete(entry.ref)
      batch.delete(doc(getSnapshotsCollection(firestore), entry.id))
    })

  existingMembers.docs
    .filter((entry) => !userIds.includes(entry.id))
    .forEach((entry) => {
      batch.delete(entry.ref)
    })

  await batch.commit()
}

export async function saveFirebaseWorkspaceSnapshot(snapshot: WorkspaceSnapshot, authenticatedUserId: string) {
  const firestore = requireFirestore()
  const membership = await loadWorkspaceMembership(firestore, authenticatedUserId)
  const savedAt = snapshot.savedAt || new Date().toISOString()

  if (membership.role === 'developer') {
    const batch = writeBatch(firestore)
    snapshot.users.forEach((user) => {
      batch.set(doc(getMembersCollection(firestore), user.id), {
        displayName: user.name,
        email: user.email,
        role: user.role,
        assignedClassroomId: user.assignedClassroomId ?? null,
      } satisfies FirebaseWorkspaceMemberDoc)
    })

    snapshot.classrooms.forEach((classroom) => {
      batch.set(doc(getClassroomsCollection(firestore), classroom.id), {
        name: classroom.name,
        contractStatus: classroom.contractStatus,
        contractStartDate: classroom.contractStartDate,
        contractEndDate: classroom.contractEndDate,
        managerUserId: classroom.managerUserId,
        isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
        temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
        updatedAt: savedAt,
      } satisfies FirebaseClassroomDoc)
      batch.set(doc(getSnapshotsCollection(firestore), classroom.id), {
        schemaVersion: APP_SNAPSHOT_SCHEMA_VERSION,
        savedAt,
        data: serializeSnapshotPayload(classroom.data),
        updatedBy: authenticatedUserId,
        updatedAt: savedAt,
      } satisfies FirebaseClassroomSnapshotDoc)
    })
    await batch.commit()
    await deleteMissingDocs({
      firestore,
      classroomIds: snapshot.classrooms.map((classroom) => classroom.id),
      userIds: snapshot.users.map((user) => user.id),
    })
    return savedAt
  }

  const targetClassroomId = membership.assignedClassroomId
  const targetClassroom = snapshot.classrooms.find((classroom) => classroom.id === targetClassroomId)
  if (!targetClassroom) {
    throw new Error('担当教室のスナップショットが見つからないため、Firebase へ保存できませんでした。')
  }

  await setDoc(doc(getSnapshotsCollection(firestore), targetClassroom.id), {
    schemaVersion: APP_SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    data: serializeSnapshotPayload(targetClassroom.data),
    updatedBy: authenticatedUserId,
    updatedAt: savedAt,
  } satisfies FirebaseClassroomSnapshotDoc)

  return savedAt
}