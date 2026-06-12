import { collection, doc, getDoc, getDocs, query, where, type DocumentReference, type Firestore } from 'firebase/firestore'
import { WORKSPACE_SNAPSHOT_SCHEMA_VERSION, type AppSnapshotPayload, type ClassroomSettings, type PersistedBoardState, type WorkspaceClassroom, type WorkspaceSnapshot, type WorkspaceUser, type WorkspaceUserRole } from '../../types/appState'
import type { SlotCell } from '../../components/schedule-board/types'
import { getFirebaseFirestoreInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { clearClassroomSnapshotVersions, setClassroomSnapshotVersion } from './classroomSnapshotVersions'

const FIREBASE_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64'
const FIREBASE_CHUNKED_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64-chunked'
const FIREBASE_SPLIT_SNAPSHOT_ENCODING = 'split-documents'

type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream

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
  data?: FirebaseAppSnapshotPayload
  dataEncoding?: typeof FIREBASE_COMPRESSED_SNAPSHOT_ENCODING
    | typeof FIREBASE_CHUNKED_COMPRESSED_SNAPSHOT_ENCODING
    | typeof FIREBASE_SPLIT_SNAPSHOT_ENCODING
  compressedData?: string
  chunkCount?: number
  chunkSetId?: string
  splitSetId?: string
  shellDocId?: string
  settingsDocId?: string
  settingsCoreDocId?: string
  settingsTemplateDocId?: string
  settingsRegularTemplateDocId?: string
  settingsTemplateHistoryDocId?: string
  settingsPreTemplateRegularLessonsDocId?: string
  settingsPreTemplateRegularLessonDocIds?: string[]
  settingsInitialStocksDocId?: string
  boardMetaDocId?: string
  boardUiDocId?: string
  boardStockDocId?: string
  basicDataDocId?: string
  basicManagersDocId?: string
  basicTeachersDocId?: string
  basicStudentsDocId?: string
  basicRegularLessonsDocId?: string
  basicRegularLessonDocIds?: string[]
  basicGroupLessonsDocId?: string
  rulesDocId?: string
  boardWeekDocIds?: string[]
  boardWeekCount?: number
  dataByteLength?: number
  compressedByteLength?: number
  updatedBy: string
  updatedAt: string
  // A1: 楽観ロック用の版数。保存ごとに +1。旧データには無いので optional。
  version?: number
}

type FirebaseClassroomSnapshotChunkDoc = {
  index: number
  data: string
  chunkSetId?: string
  updatedAt: string
}

type FirebaseClassroomSettingsDoc = {
  settings: ClassroomSettings
  savedAt: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSplitShellDoc = Pick<FirebaseAppSnapshotPayload, 'screen'> & {
  classroomSettings?: ClassroomSettings
  boardState?: FirebasePersistedBoardState | null
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSplitSettingsDoc = {
  classroomSettings: ClassroomSettings
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsCoreDoc = Pick<ClassroomSettings,
  'closedWeekdays'
  | 'holidayDates'
  | 'forceOpenDates'
  | 'deskCount'
  | 'scheduleNotes'
  | 'scheduleHeader'
  | 'boardShareToken'
  | 'initialSetupCompletedAt'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsTemplateDoc = Pick<ClassroomSettings,
  'regularLessonTemplate'
  | 'regularLessonTemplateHistory'
  | 'preTemplateRegularLessons'
  | 'templateFreezeBeforeDate'
  | 'initialSetupMakeupStocks'
  | 'initialSetupLectureStocks'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsRegularTemplateDoc = Pick<ClassroomSettings,
  'regularLessonTemplate'
  | 'templateFreezeBeforeDate'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsTemplateHistoryDoc = Pick<ClassroomSettings, 'regularLessonTemplateHistory'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsPreTemplateRegularLessonsDoc = Pick<ClassroomSettings, 'preTemplateRegularLessons'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsPreTemplateRegularLessonChunkDoc = Pick<ClassroomSettings, 'preTemplateRegularLessons'> & {
  index: number
  splitSetId: string
  savedAt: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSettingsInitialStocksDoc = Pick<ClassroomSettings,
  'initialSetupMakeupStocks'
  | 'initialSetupLectureStocks'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBoardMetaDoc = Omit<FirebasePersistedBoardState, 'weeks'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBoardUiDoc = Pick<FirebasePersistedBoardState,
  'weekIndex'
  | 'selectedCellId'
  | 'selectedDeskIndex'
  | 'isLectureStockOpen'
  | 'isMakeupStockOpen'
  | 'studentScheduleRange'
  | 'teacherScheduleRange'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBoardStockDoc = Pick<FirebasePersistedBoardState,
  'suppressedRegularLessonOccurrences'
  | 'scheduleCountAdjustments'
  | 'manualMakeupAdjustments'
  | 'suppressedMakeupOrigins'
  | 'fallbackMakeupStudents'
  | 'manualLectureStockCounts'
  | 'manualLectureStockOrigins'
  | 'fallbackLectureStockStudents'
  // spec-group-lesson §G: 集団授業の割当/出欠。分割読込(boardUi && boardStock)経路でも
  // 復元されるよう Pick に含める（含めないと往復で消える）。
  | 'groupClassEntries'
> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSplitBasicDataDoc = Pick<FirebaseAppSnapshotPayload, 'managers' | 'teachers' | 'students' | 'regularLessons' | 'groupLessons'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicManagersDoc = Pick<FirebaseAppSnapshotPayload, 'managers'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicTeachersDoc = Pick<FirebaseAppSnapshotPayload, 'teachers'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicStudentsDoc = Pick<FirebaseAppSnapshotPayload, 'students'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicRegularLessonsDoc = Pick<FirebaseAppSnapshotPayload, 'regularLessons'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicRegularLessonChunkDoc = Pick<FirebaseAppSnapshotPayload, 'regularLessons'> & {
  index: number
  splitSetId: string
  savedAt: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBasicGroupLessonsDoc = Pick<FirebaseAppSnapshotPayload, 'groupLessons'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomSplitRulesDoc = Pick<FirebaseAppSnapshotPayload, 'specialSessions' | 'autoAssignRules' | 'pairConstraints'> & {
  savedAt: string
  splitSetId: string
  updatedBy: string
  updatedAt: string
}

type FirebaseClassroomBoardWeekDoc = FirebasePersistedBoardWeek & {
  index: number
  splitSetId: string
  savedAt: string
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

function getClassroomSettingsCollection(firestore: Firestore) {
  return collection(getWorkspaceRef(firestore), 'classroomSettings')
}

function getSnapshotChunksCollection(snapshotRef: DocumentReference) {
  return collection(snapshotRef, 'chunks')
}

function getSnapshotPartsCollection(snapshotRef: DocumentReference) {
  return collection(snapshotRef, 'parts')
}

function getSnapshotBoardWeeksCollection(snapshotRef: DocumentReference) {
  return collection(snapshotRef, 'boardWeeks')
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

function deserializeSnapshotPayload(payload: FirebaseAppSnapshotPayload | AppSnapshotPayload | null | undefined): AppSnapshotPayload | null {
  if (!payload) return null

  return {
    ...payload,
    boardState: deserializeBoardState(payload.boardState),
  }
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function getDecompressionStreamConstructor() {
  return (globalThis as { DecompressionStream?: DecompressionStreamConstructor }).DecompressionStream
}

async function gunzipBase64ToText(value: string) {
  const DecompressionStreamClass = getDecompressionStreamConstructor()
  if (!DecompressionStreamClass) {
    throw new Error('このブラウザは Firebase 圧縮スナップショット読込に未対応です。Chrome / Edge の最新版で再度お試しください。')
  }

  const stream = new Blob([fromBase64(value)]).stream().pipeThrough(new DecompressionStreamClass('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

async function readFirebaseSnapshotPayload(snapshot: FirebaseClassroomSnapshotDoc | null | undefined, snapshotRef?: DocumentReference) {
  if (!snapshot) return null

  if (snapshot.dataEncoding === FIREBASE_SPLIT_SNAPSHOT_ENCODING && snapshotRef) {
    return readSplitSnapshotPayload(snapshot, snapshotRef)
  }

  if (snapshot.data) {
    return deserializeSnapshotPayload(snapshot.data)
  }

  if (snapshot.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING && typeof snapshot.compressedData === 'string' && snapshot.compressedData) {
    const json = await gunzipBase64ToText(snapshot.compressedData)
    return deserializeSnapshotPayload(JSON.parse(json) as FirebaseAppSnapshotPayload)
  }

  if (snapshot.dataEncoding === FIREBASE_CHUNKED_COMPRESSED_SNAPSHOT_ENCODING && snapshotRef) {
    const chunkSetId = snapshot.chunkSetId
    const chunksCollection = getSnapshotChunksCollection(snapshotRef)
    const chunkSnapshots = await getDocs(chunkSetId
      ? query(chunksCollection, where('chunkSetId', '==', chunkSetId))
      : chunksCollection)
    const compressedData = chunkSnapshots.docs
      .map((entry) => entry.data() as FirebaseClassroomSnapshotChunkDoc)
      .filter((entry) => chunkSetId ? entry.chunkSetId === chunkSetId : !entry.chunkSetId)
      .sort((left, right) => left.index - right.index)
      .slice(0, Math.max(0, snapshot.chunkCount ?? 0))
      .map((entry) => entry.data)
      .join('')
    if (compressedData) {
      const json = await gunzipBase64ToText(compressedData)
      return deserializeSnapshotPayload(JSON.parse(json) as FirebaseAppSnapshotPayload)
    }
  }

  return null
}

async function readSplitSnapshotPayload(snapshot: FirebaseClassroomSnapshotDoc, snapshotRef: DocumentReference) {
  const splitSetId = snapshot.splitSetId
  const usesSplitBasicDocIds = Boolean(snapshot.basicManagersDocId
    && snapshot.basicTeachersDocId
    && snapshot.basicStudentsDocId
    && (snapshot.basicRegularLessonsDocId || Array.isArray(snapshot.basicRegularLessonDocIds))
    && snapshot.basicGroupLessonsDocId)
  const usesDocIds = Boolean(snapshot.shellDocId && (snapshot.basicDataDocId || usesSplitBasicDocIds) && snapshot.rulesDocId)
  const preTemplateRegularLessonDocIds = snapshot.settingsPreTemplateRegularLessonDocIds ?? []
  const basicRegularLessonDocIds = snapshot.basicRegularLessonDocIds ?? []
  if (!splitSetId && !usesDocIds) return null

  const partsCollection = getSnapshotPartsCollection(snapshotRef)
  const boardWeeksCollection = getSnapshotBoardWeeksCollection(snapshotRef)
  const boardWeekDocIds = snapshot.boardWeekDocIds ?? []
  const [shellSnapshot, settingsSnapshot, settingsCoreSnapshot, settingsTemplateSnapshot, settingsRegularTemplateSnapshot, settingsTemplateHistorySnapshot, settingsPreTemplateRegularLessonsSnapshot, settingsPreTemplateRegularLessonChunkSnapshots, settingsInitialStocksSnapshot, boardMetaSnapshot, boardUiSnapshot, boardStockSnapshot, basicDataSnapshot, basicManagersSnapshot, basicTeachersSnapshot, basicStudentsSnapshot, basicRegularLessonsSnapshot, basicRegularLessonChunkSnapshots, basicGroupLessonsSnapshot, rulesSnapshot, boardWeekResults] = await Promise.all([
    getDoc(doc(partsCollection, snapshot.shellDocId ?? `${splitSetId}_shell`)),
    snapshot.settingsDocId ? getDoc(doc(partsCollection, snapshot.settingsDocId)) : Promise.resolve(null),
    snapshot.settingsCoreDocId ? getDoc(doc(partsCollection, snapshot.settingsCoreDocId)) : Promise.resolve(null),
    snapshot.settingsTemplateDocId ? getDoc(doc(partsCollection, snapshot.settingsTemplateDocId)) : Promise.resolve(null),
    snapshot.settingsRegularTemplateDocId ? getDoc(doc(partsCollection, snapshot.settingsRegularTemplateDocId)) : Promise.resolve(null),
    snapshot.settingsTemplateHistoryDocId ? getDoc(doc(partsCollection, snapshot.settingsTemplateHistoryDocId)) : Promise.resolve(null),
    snapshot.settingsPreTemplateRegularLessonsDocId ? getDoc(doc(partsCollection, snapshot.settingsPreTemplateRegularLessonsDocId)) : Promise.resolve(null),
    Promise.all(preTemplateRegularLessonDocIds.map((docId) => getDoc(doc(partsCollection, docId)))),
    snapshot.settingsInitialStocksDocId ? getDoc(doc(partsCollection, snapshot.settingsInitialStocksDocId)) : Promise.resolve(null),
    snapshot.boardMetaDocId ? getDoc(doc(partsCollection, snapshot.boardMetaDocId)) : Promise.resolve(null),
    snapshot.boardUiDocId ? getDoc(doc(partsCollection, snapshot.boardUiDocId)) : Promise.resolve(null),
    snapshot.boardStockDocId ? getDoc(doc(partsCollection, snapshot.boardStockDocId)) : Promise.resolve(null),
    snapshot.basicDataDocId ? getDoc(doc(partsCollection, snapshot.basicDataDocId)) : Promise.resolve(null),
    snapshot.basicManagersDocId ? getDoc(doc(partsCollection, snapshot.basicManagersDocId)) : Promise.resolve(null),
    snapshot.basicTeachersDocId ? getDoc(doc(partsCollection, snapshot.basicTeachersDocId)) : Promise.resolve(null),
    snapshot.basicStudentsDocId ? getDoc(doc(partsCollection, snapshot.basicStudentsDocId)) : Promise.resolve(null),
    snapshot.basicRegularLessonsDocId ? getDoc(doc(partsCollection, snapshot.basicRegularLessonsDocId)) : Promise.resolve(null),
    Promise.all(basicRegularLessonDocIds.map((docId) => getDoc(doc(partsCollection, docId)))),
    snapshot.basicGroupLessonsDocId ? getDoc(doc(partsCollection, snapshot.basicGroupLessonsDocId)) : Promise.resolve(null),
    getDoc(doc(partsCollection, snapshot.rulesDocId ?? `${splitSetId}_rules`)),
    usesDocIds
      ? Promise.all(boardWeekDocIds.map((docId) => getDoc(doc(boardWeeksCollection, docId))))
      : getDocs(query(boardWeeksCollection, where('splitSetId', '==', splitSetId))),
  ])

  if (!shellSnapshot.exists() || (!basicDataSnapshot?.exists() && !usesSplitBasicDocIds) || !rulesSnapshot.exists()) return null
  const shell = shellSnapshot.data() as FirebaseClassroomSplitShellDoc
  const settings = settingsSnapshot?.exists() ? settingsSnapshot.data() as FirebaseClassroomSplitSettingsDoc : null
  const settingsCore = settingsCoreSnapshot?.exists() ? settingsCoreSnapshot.data() as FirebaseClassroomSettingsCoreDoc : null
  const settingsTemplate = settingsTemplateSnapshot?.exists() ? settingsTemplateSnapshot.data() as FirebaseClassroomSettingsTemplateDoc : null
  const settingsRegularTemplate = settingsRegularTemplateSnapshot?.exists() ? settingsRegularTemplateSnapshot.data() as FirebaseClassroomSettingsRegularTemplateDoc : null
  const settingsTemplateHistory = settingsTemplateHistorySnapshot?.exists() ? settingsTemplateHistorySnapshot.data() as FirebaseClassroomSettingsTemplateHistoryDoc : null
  const settingsPreTemplateRegularLessons = settingsPreTemplateRegularLessonsSnapshot?.exists() ? settingsPreTemplateRegularLessonsSnapshot.data() as FirebaseClassroomSettingsPreTemplateRegularLessonsDoc : null
  const settingsPreTemplateRegularLessonChunks = settingsPreTemplateRegularLessonChunkSnapshots
    .filter((entry) => entry.exists())
    .map((entry) => entry.data() as FirebaseClassroomSettingsPreTemplateRegularLessonChunkDoc)
  const settingsInitialStocks = settingsInitialStocksSnapshot?.exists() ? settingsInitialStocksSnapshot.data() as FirebaseClassroomSettingsInitialStocksDoc : null
  const boardMeta = boardMetaSnapshot?.exists() ? boardMetaSnapshot.data() as FirebaseClassroomBoardMetaDoc : null
  const boardUi = boardUiSnapshot?.exists() ? boardUiSnapshot.data() as FirebaseClassroomBoardUiDoc : null
  const boardStock = boardStockSnapshot?.exists() ? boardStockSnapshot.data() as FirebaseClassroomBoardStockDoc : null
  const basicData = basicDataSnapshot?.exists() ? basicDataSnapshot.data() as FirebaseClassroomSplitBasicDataDoc : null
  const basicManagers = basicManagersSnapshot?.exists() ? basicManagersSnapshot.data() as FirebaseClassroomBasicManagersDoc : null
  const basicTeachers = basicTeachersSnapshot?.exists() ? basicTeachersSnapshot.data() as FirebaseClassroomBasicTeachersDoc : null
  const basicStudents = basicStudentsSnapshot?.exists() ? basicStudentsSnapshot.data() as FirebaseClassroomBasicStudentsDoc : null
  const basicRegularLessons = basicRegularLessonsSnapshot?.exists() ? basicRegularLessonsSnapshot.data() as FirebaseClassroomBasicRegularLessonsDoc : null
  const basicRegularLessonChunks = basicRegularLessonChunkSnapshots
    .filter((entry) => entry.exists())
    .map((entry) => entry.data() as FirebaseClassroomBasicRegularLessonChunkDoc)
  const basicGroupLessons = basicGroupLessonsSnapshot?.exists() ? basicGroupLessonsSnapshot.data() as FirebaseClassroomBasicGroupLessonsDoc : null
  const rules = rulesSnapshot.data() as FirebaseClassroomSplitRulesDoc
  if (!usesDocIds && (
    shell.splitSetId !== splitSetId
    || (settings && settings.splitSetId !== splitSetId)
    || (settingsCore && settingsCore.splitSetId !== splitSetId)
    || (settingsTemplate && settingsTemplate.splitSetId !== splitSetId)
    || (settingsRegularTemplate && settingsRegularTemplate.splitSetId !== splitSetId)
    || (settingsTemplateHistory && settingsTemplateHistory.splitSetId !== splitSetId)
    || (settingsPreTemplateRegularLessons && settingsPreTemplateRegularLessons.splitSetId !== splitSetId)
    || settingsPreTemplateRegularLessonChunks.some((entry) => entry.splitSetId !== splitSetId)
    || (settingsInitialStocks && settingsInitialStocks.splitSetId !== splitSetId)
    || (basicData && basicData.splitSetId !== splitSetId)
    || (basicManagers && basicManagers.splitSetId !== splitSetId)
    || (basicTeachers && basicTeachers.splitSetId !== splitSetId)
    || (basicStudents && basicStudents.splitSetId !== splitSetId)
    || (basicRegularLessons && basicRegularLessons.splitSetId !== splitSetId)
    || basicRegularLessonChunks.some((entry) => entry.splitSetId !== splitSetId)
    || (basicGroupLessons && basicGroupLessons.splitSetId !== splitSetId)
    || rules.splitSetId !== splitSetId
    || (boardMeta && boardMeta.splitSetId !== splitSetId)
    || (boardUi && boardUi.splitSetId !== splitSetId)
    || (boardStock && boardStock.splitSetId !== splitSetId)
  )) return null

  const boardWeekDocs = Array.isArray(boardWeekResults) ? boardWeekResults : boardWeekResults.docs
  const weeks = boardWeekDocs
    .filter((entry) => entry.exists())
    .map((entry) => entry.data() as FirebaseClassroomBoardWeekDoc)
    .filter((entry) => usesDocIds || entry.splitSetId === splitSetId)
    .sort((left, right) => left.index - right.index)
    .slice(0, Math.max(0, snapshot.boardWeekCount ?? 0))
    .map((entry) => ({ cells: Array.isArray(entry.cells) ? entry.cells : [] }))

  const boardState = boardUi && boardStock
    ? { ...boardUi, ...boardStock, weeks }
    : (boardMeta ? { ...boardMeta, weeks } : (shell.boardState ? { ...shell.boardState, weeks } : null))
  const chunkedPreTemplateRegularLessons = preTemplateRegularLessonDocIds.length > 0 && settingsPreTemplateRegularLessonChunks.length === preTemplateRegularLessonDocIds.length
    ? settingsPreTemplateRegularLessonChunks
      .sort((left, right) => left.index - right.index)
      .flatMap((entry) => Array.isArray(entry.preTemplateRegularLessons) ? entry.preTemplateRegularLessons : [])
    : null
  const classroomSettings = settingsCore
    ? ({
      ...(settings?.classroomSettings ?? shell.classroomSettings ?? {}),
      ...settingsCore,
      ...(settingsTemplate ?? {}),
      ...(settingsRegularTemplate ?? {}),
      ...(settingsTemplateHistory ?? {}),
      ...(settingsPreTemplateRegularLessons ?? {}),
      ...(chunkedPreTemplateRegularLessons ? { preTemplateRegularLessons: chunkedPreTemplateRegularLessons } : {}),
      ...(settingsInitialStocks ?? {}),
    } as ClassroomSettings)
    : (settings?.classroomSettings ?? shell.classroomSettings)
  const mergedBasicData = {
    managers: basicManagers?.managers ?? basicData?.managers ?? [],
    teachers: basicTeachers?.teachers ?? basicData?.teachers ?? [],
    students: basicStudents?.students ?? basicData?.students ?? [],
    regularLessons: basicRegularLessonDocIds.length > 0 && basicRegularLessonChunks.length === basicRegularLessonDocIds.length
      ? basicRegularLessonChunks
        .sort((left, right) => left.index - right.index)
        .flatMap((entry) => Array.isArray(entry.regularLessons) ? entry.regularLessons : [])
      : basicRegularLessons?.regularLessons ?? basicData?.regularLessons ?? [],
    groupLessons: basicGroupLessons?.groupLessons ?? basicData?.groupLessons ?? [],
  }

  return deserializeSnapshotPayload({
    screen: shell.screen,
    classroomSettings,
    managers: mergedBasicData.managers,
    teachers: mergedBasicData.teachers,
    students: mergedBasicData.students,
    regularLessons: mergedBasicData.regularLessons,
    groupLessons: mergedBasicData.groupLessons,
    specialSessions: rules.specialSessions ?? [],
    autoAssignRules: rules.autoAssignRules ?? [],
    pairConstraints: rules.pairConstraints ?? [],
    boardState,
  } as FirebaseAppSnapshotPayload)
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

  // A1: 各教室の現在の版数をレジストリへ記録する。版数フィールドが無い旧データは 0 とみなす。
  // 先に clear することで、別アカウント/別教室の古い版数が残らないようにする。
  clearClassroomSnapshotVersions()
  snapshotByClassroomId.forEach((data, classroomId) => {
    setClassroomSnapshotVersion(classroomId, typeof data.version === 'number' ? data.version : 0)
  })

  const settingsDocSnapshots = membership.role === 'developer'
    ? await getDocs(getClassroomSettingsCollection(firestore))
    : (membership.assignedClassroomId
      ? { docs: [await getDoc(doc(getClassroomSettingsCollection(firestore), membership.assignedClassroomId))].filter((entry) => entry.exists()) }
      : { docs: [] })

  const settingsByClassroomId = new Map(
    settingsDocSnapshots.docs.map((entry) => [entry.id, entry.data() as FirebaseClassroomSettingsDoc]),
  )

  const classrooms = await Promise.all(classroomDocSnapshots.docs.map(async (entry) => {
    const data = entry.data() as FirebaseClassroomDoc
    const snapshot = snapshotByClassroomId.get(entry.id)
    const settingsDoc = settingsByClassroomId.get(entry.id)
    const payload = await readFirebaseSnapshotPayload(snapshot, doc(getSnapshotsCollection(firestore), entry.id))
    if (payload && settingsDoc && (settingsDoc.savedAt ?? '') > (snapshot?.savedAt ?? '')) {
      payload.classroomSettings = settingsDoc.settings
    }
    return toWorkspaceClassroom(entry.id, data, payload, params.createEmptyClassroomPayload)
  }))

  const actingClassroomId = currentUser.role === 'manager'
    ? currentUser.assignedClassroomId
    : (classrooms[0]?.id ?? null)

  return {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    savedAt: getLatestSavedAt(
      classroomDocSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomDoc),
      [
        ...snapshotDocSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomSnapshotDoc),
        ...settingsDocSnapshots.docs.map((entry) => ({ savedAt: (entry.data() as FirebaseClassroomSettingsDoc).savedAt }) as FirebaseClassroomSnapshotDoc),
      ],
    ),
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: currentUser.id,
    actingClassroomId,
    users,
    classrooms,
  } satisfies WorkspaceSnapshot
}
