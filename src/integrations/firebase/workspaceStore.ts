import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch, type DocumentReference, type Firestore } from 'firebase/firestore'
import { APP_SNAPSHOT_SCHEMA_VERSION, WORKSPACE_SNAPSHOT_SCHEMA_VERSION, type AppSnapshotPayload, type ClassroomSettings, type PersistedBoardState, type WorkspaceClassroom, type WorkspaceSnapshot, type WorkspaceUser, type WorkspaceUserRole } from '../../types/appState'
import type { SlotCell } from '../../components/schedule-board/types'
import { getFirebaseFirestoreInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'

const FIREBASE_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64'
const FIREBASE_CHUNKED_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64-chunked'
const FIREBASE_SPLIT_SNAPSHOT_ENCODING = 'split-documents'
const FIREBASE_PAYLOAD_WRITE_CONCURRENCY = 1
const FIREBASE_PAYLOAD_WRITE_STALL_RETRY_MS = 30_000
const FIREBASE_PAYLOAD_WRITE_MAX_ATTEMPTS = 3
const FIREBASE_ATOMIC_BATCH_DOC_LIMIT = 50
const FIREBASE_ATOMIC_BATCH_BYTE_LIMIT = 1_000_000
const PRE_TEMPLATE_REGULAR_LESSON_CHUNK_TARGET_BYTES = 60_000
const BASIC_REGULAR_LESSON_CHUNK_TARGET_BYTES = 60_000

type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream

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

const jsonHashCache = new WeakMap<object, Promise<string>>()
const committedSnapshotMetadataByClassroomId = new Map<string, FirebaseClassroomSnapshotDoc>()

type FirebaseSaveProgress = {
  percent: number
  label: string
  details?: Record<string, unknown>
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

function serializeBoardState(boardState: PersistedBoardState | null | undefined): FirebasePersistedBoardState | null {
  if (!boardState) return null

  return {
    ...boardState,
    weeks: boardState.weeks.map((week) => ({ cells: week })),
  }
}

function getBoardUiState(boardState: FirebasePersistedBoardState | null | undefined): Omit<FirebaseClassroomBoardUiDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> | null {
  if (!boardState) return null
  return {
    weekIndex: boardState.weekIndex,
    selectedCellId: boardState.selectedCellId,
    selectedDeskIndex: boardState.selectedDeskIndex,
    isLectureStockOpen: boardState.isLectureStockOpen,
    isMakeupStockOpen: boardState.isMakeupStockOpen,
    studentScheduleRange: boardState.studentScheduleRange,
    teacherScheduleRange: boardState.teacherScheduleRange,
  }
}

function getBoardStockState(boardState: FirebasePersistedBoardState | null | undefined): Omit<FirebaseClassroomBoardStockDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> | null {
  if (!boardState) return null
  return {
    suppressedRegularLessonOccurrences: boardState.suppressedRegularLessonOccurrences,
    scheduleCountAdjustments: boardState.scheduleCountAdjustments,
    manualMakeupAdjustments: boardState.manualMakeupAdjustments,
    suppressedMakeupOrigins: boardState.suppressedMakeupOrigins,
    fallbackMakeupStudents: boardState.fallbackMakeupStudents,
    manualLectureStockCounts: boardState.manualLectureStockCounts,
    manualLectureStockOrigins: boardState.manualLectureStockOrigins,
    fallbackLectureStockStudents: boardState.fallbackLectureStockStudents,
  }
}

function chunkPreTemplateRegularLessons(preTemplateRegularLessons: ClassroomSettings['preTemplateRegularLessons']) {
  const lessons = Array.isArray(preTemplateRegularLessons) ? preTemplateRegularLessons : []
  const chunks: NonNullable<ClassroomSettings['preTemplateRegularLessons']>[] = []
  let currentChunk: NonNullable<ClassroomSettings['preTemplateRegularLessons']> = []
  lessons.forEach((lesson) => {
    const nextChunk = [...currentChunk, lesson]
    const nextBytes = measureJsonBytes({ preTemplateRegularLessons: nextChunk })
    if (currentChunk.length > 0 && nextBytes > PRE_TEMPLATE_REGULAR_LESSON_CHUNK_TARGET_BYTES) {
      chunks.push(currentChunk)
      currentChunk = [lesson]
      return
    }
    currentChunk = nextChunk
  })
  if (currentChunk.length > 0 || lessons.length === 0) chunks.push(currentChunk)
  return chunks.map((preTemplateRegularLessonsChunk, index) => ({
    index,
    preTemplateRegularLessons: preTemplateRegularLessonsChunk,
  }))
}

function chunkBasicRegularLessons(regularLessons: FirebaseAppSnapshotPayload['regularLessons']) {
  const lessons = Array.isArray(regularLessons) ? regularLessons : []
  const chunks: FirebaseAppSnapshotPayload['regularLessons'][] = []
  let currentChunk: FirebaseAppSnapshotPayload['regularLessons'] = []
  lessons.forEach((lesson) => {
    const nextChunk = [...currentChunk, lesson]
    const nextBytes = measureJsonBytes({ regularLessons: nextChunk })
    if (currentChunk.length > 0 && nextBytes > BASIC_REGULAR_LESSON_CHUNK_TARGET_BYTES) {
      chunks.push(currentChunk)
      currentChunk = [lesson]
      return
    }
    currentChunk = nextChunk
  })
  if (currentChunk.length > 0 || lessons.length === 0) chunks.push(currentChunk)
  return chunks.map((regularLessonsChunk, index) => ({
    index,
    regularLessons: regularLessonsChunk,
  }))
}

function splitClassroomSettings(settings: ClassroomSettings) {
  const core: Omit<FirebaseClassroomSettingsCoreDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    closedWeekdays: settings.closedWeekdays,
    holidayDates: settings.holidayDates,
    forceOpenDates: settings.forceOpenDates,
    deskCount: settings.deskCount,
    scheduleNotes: settings.scheduleNotes,
    scheduleHeader: settings.scheduleHeader,
    boardShareToken: settings.boardShareToken,
    initialSetupCompletedAt: settings.initialSetupCompletedAt,
  }
  const template: Omit<FirebaseClassroomSettingsTemplateDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    regularLessonTemplate: settings.regularLessonTemplate,
    regularLessonTemplateHistory: settings.regularLessonTemplateHistory,
    preTemplateRegularLessons: settings.preTemplateRegularLessons,
    templateFreezeBeforeDate: settings.templateFreezeBeforeDate,
    initialSetupMakeupStocks: settings.initialSetupMakeupStocks,
    initialSetupLectureStocks: settings.initialSetupLectureStocks,
  }
  const regularTemplate: Omit<FirebaseClassroomSettingsRegularTemplateDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    regularLessonTemplate: settings.regularLessonTemplate,
    templateFreezeBeforeDate: settings.templateFreezeBeforeDate,
  }
  const templateHistory: Omit<FirebaseClassroomSettingsTemplateHistoryDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    regularLessonTemplateHistory: settings.regularLessonTemplateHistory,
  }
  const preTemplateRegularLessons: Omit<FirebaseClassroomSettingsPreTemplateRegularLessonsDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    preTemplateRegularLessons: settings.preTemplateRegularLessons,
  }
  const initialStocks: Omit<FirebaseClassroomSettingsInitialStocksDoc, 'savedAt' | 'splitSetId' | 'updatedBy' | 'updatedAt'> = {
    initialSetupMakeupStocks: settings.initialSetupMakeupStocks,
    initialSetupLectureStocks: settings.initialSetupLectureStocks,
  }
  return { core, template, regularTemplate, templateHistory, preTemplateRegularLessons, initialStocks }
}

function deserializeSnapshotPayload(payload: FirebaseAppSnapshotPayload | AppSnapshotPayload | null | undefined): AppSnapshotPayload | null {
  if (!payload) return null

  return {
    ...payload,
    boardState: deserializeBoardState(payload.boardState),
  }
}

async function hashJson(value: unknown) {
  if (value && typeof value === 'object') {
    const cachedHash = jsonHashCache.get(value)
    if (cachedHash) return cachedHash
    const hashPromise = hashJsonValue(value)
    jsonHashCache.set(value, hashPromise)
    return hashPromise
  }
  return hashJsonValue(value)
}

async function hashJsonValue(value: unknown) {
  const json = stableStringifyJson(value)
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

function stableStringifyJson(value: unknown) {
  return JSON.stringify(toStableJsonValue(value))
}

function toStableJsonValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => toStableJsonValue(entry))
  const source = value as Record<string, unknown>
  return Object.keys(source).sort().reduce<Record<string, unknown>>((stable, key) => {
    const nextValue = toStableJsonValue(source[key])
    if (nextValue !== undefined) stable[key] = nextValue
    return stable
  }, {})
}

function measureJsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function getPayloadDocKind(ref: DocumentReference) {
  return ref.parent.id === 'boardWeeks' ? 'boardWeek' : ref.id
}

function summarizePayloadDocs(payloadDocs: { ref: DocumentReference; data: unknown }[]) {
  const byKind: Record<string, number> = {}
  let totalBytes = 0
  let maxBytes = 0
  let maxKind = ''
  const docBytes: { kind: string; bytes: number; order: number }[] = []
  payloadDocs.forEach((entry, order) => {
    const kind = getPayloadDocKind(entry.ref)
    const byteLength = measureJsonBytes(entry.data)
    byKind[kind] = (byKind[kind] ?? 0) + 1
    totalBytes += byteLength
    docBytes.push({ kind, bytes: byteLength, order })
    if (byteLength > maxBytes) {
      maxBytes = byteLength
      maxKind = kind
    }
  })
  const largestDocs = [...docBytes]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 8)
  return { byKind, totalBytes, maxBytes, maxKind, largestDocs }
}

async function setPayloadDocWithStallRetry(
  entry: { ref: DocumentReference; data: Record<string, unknown> | FirebaseClassroomSnapshotChunkDoc; kind: string; byteLength: number },
  onRetry?: (details: { kind: string; byteLength: number; attempt: number; nextAttempt: number }) => void,
) {
  for (let attempt = 1; attempt <= FIREBASE_PAYLOAD_WRITE_MAX_ATTEMPTS; attempt += 1) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const writePromise = setDoc(entry.ref, entry.data)
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), FIREBASE_PAYLOAD_WRITE_STALL_RETRY_MS)
    })
    const result = await Promise.race([
      writePromise.then(() => 'written' as const),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    })
    if (result === 'written') return
    if (attempt >= FIREBASE_PAYLOAD_WRITE_MAX_ATTEMPTS) {
      throw new Error(`Firebase payload write timed out after ${attempt} attempts: ${entry.kind}`)
    }
    onRetry?.({
      kind: entry.kind,
      byteLength: entry.byteLength,
      attempt,
      nextAttempt: attempt + 1,
    })
  }
}

async function commitBatchWithStallRetry(
  createBatch: () => ReturnType<typeof writeBatch>,
  onRetry?: (details: { attempt: number; nextAttempt: number }) => void,
) {
  for (let attempt = 1; attempt <= FIREBASE_PAYLOAD_WRITE_MAX_ATTEMPTS; attempt += 1) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const commitPromise = createBatch().commit()
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), FIREBASE_PAYLOAD_WRITE_STALL_RETRY_MS)
    })
    const result = await Promise.race([
      commitPromise.then(() => 'committed' as const),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    })
    if (result === 'committed') return
    if (attempt >= FIREBASE_PAYLOAD_WRITE_MAX_ATTEMPTS) {
      throw new Error(`Firebase batch commit timed out after ${attempt} attempts`)
    }
    onRetry?.({ attempt, nextAttempt: attempt + 1 })
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

function createSnapshotWriteSetId(savedAt: string) {
  return savedAt.replace(/[^0-9A-Za-z]/g, '') || `${Date.now()}`
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

function countRegularTemplateEntries(template: ClassroomSettings['regularLessonTemplate']) {
  if (!template || !Array.isArray(template.cells)) return 0
  return template.cells.reduce((cellTotal, cell) => cellTotal + (Array.isArray(cell.desks)
    ? cell.desks.reduce((deskTotal, desk) => deskTotal + (Array.isArray(desk.students)
      ? desk.students.filter(Boolean).length
      : 0) + (desk.teacherId ? 1 : 0), 0)
    : 0), 0)
}

function countClassroomManagementData(payload: AppSnapshotPayload | FirebaseAppSnapshotPayload | null | undefined) {
  if (!payload) return 0
  const settings = payload.classroomSettings
  return [
    payload.managers,
    payload.teachers,
    payload.students,
    payload.regularLessons,
    payload.groupLessons,
    settings?.regularLessonTemplateHistory,
    settings?.preTemplateRegularLessons,
    settings?.initialSetupMakeupStocks,
    settings?.initialSetupLectureStocks,
  ].reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
    + countRegularTemplateEntries(settings?.regularLessonTemplate)
}

async function assertNoRemoteManagementDataLoss(params: {
  previousSnapshotDoc: FirebaseClassroomSnapshotDoc | null
  snapshotRef: DocumentReference
  nextPayload: AppSnapshotPayload
}) {
  if (!params.previousSnapshotDoc) return
  const nextManagementCount = countClassroomManagementData(params.nextPayload)
  if (nextManagementCount > 0) return

  const previousPayload = await readFirebaseSnapshotPayload(params.previousSnapshotDoc, params.snapshotRef)
  const previousManagementCount = countClassroomManagementData(previousPayload)
  if (previousManagementCount <= 0) return

  throw new Error(`既存の教室管理データがあるため、空の管理データでのFirebase上書きを中止しました。前回データ件数=${previousManagementCount}`)
}

async function prepareSnapshotWrite(params: {
  firestore: Firestore
  classroomId: string
  payload: AppSnapshotPayload
  savedAt: string
  authenticatedUserId: string
  onProgress?: (progress: FirebaseSaveProgress) => void
}) {
  const snapshotRef = doc(getSnapshotsCollection(params.firestore), params.classroomId)
  const data = {
    ...params.payload,
    boardState: serializeBoardState(params.payload.boardState),
  } as FirebaseAppSnapshotPayload
  const splitSetId = createSnapshotWriteSetId(params.savedAt)
  const boardWeeks = Array.isArray(data.boardState?.weeks) ? data.boardState.weeks : []
  const boardUiState = getBoardUiState(data.boardState)
  const boardStockState = getBoardStockState(data.boardState)
  params.onProgress?.({ percent: 22, label: `差分判定中: 週${boardWeeks.length}件` })
  const cachedSnapshotDoc = committedSnapshotMetadataByClassroomId.get(params.classroomId)
  const previousSnapshotDoc = cachedSnapshotDoc ?? await getDoc(snapshotRef).then((previousSnapshot) => previousSnapshot.exists() ? previousSnapshot.data() as FirebaseClassroomSnapshotDoc : null) ?? null
  await assertNoRemoteManagementDataLoss({
    previousSnapshotDoc,
    snapshotRef,
    nextPayload: params.payload,
  })
  const hasSplitBasicData = Boolean(previousSnapshotDoc?.basicDataDocId || (
    previousSnapshotDoc?.basicManagersDocId
    && previousSnapshotDoc.basicTeachersDocId
    && previousSnapshotDoc.basicStudentsDocId
    && (previousSnapshotDoc.basicRegularLessonsDocId || Array.isArray(previousSnapshotDoc.basicRegularLessonDocIds))
    && previousSnapshotDoc.basicGroupLessonsDocId
  ))
  const isFirstDifferentialSave = previousSnapshotDoc?.dataEncoding !== FIREBASE_SPLIT_SNAPSHOT_ENCODING
    || !previousSnapshotDoc.shellDocId
    || !hasSplitBasicData
    || !previousSnapshotDoc.rulesDocId
    || !Array.isArray(previousSnapshotDoc.boardWeekDocIds)
  if (isFirstDifferentialSave) {
    params.onProgress?.({ percent: 20, label: '初回保存のためデータ保存に時間がかかります。少々お待ちください。' })
  }
  const partsCollection = getSnapshotPartsCollection(snapshotRef)
  const boardWeeksCollection = getSnapshotBoardWeeksCollection(snapshotRef)
  const splitSettings = splitClassroomSettings(data.classroomSettings)
  const shellData = sanitizeForFirestore({
    screen: data.screen,
    boardState: null,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSplitShellDoc) as Record<string, unknown>
  const settingsCoreData = sanitizeForFirestore({
    ...splitSettings.core,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSettingsCoreDoc) as Record<string, unknown>
  const settingsRegularTemplateData = sanitizeForFirestore({
    ...splitSettings.regularTemplate,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSettingsRegularTemplateDoc) as Record<string, unknown>
  const settingsTemplateHistoryData = sanitizeForFirestore({
    ...splitSettings.templateHistory,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSettingsTemplateHistoryDoc) as Record<string, unknown>
  const preTemplateRegularLessonChunks = chunkPreTemplateRegularLessons(splitSettings.preTemplateRegularLessons.preTemplateRegularLessons)
  const settingsInitialStocksData = sanitizeForFirestore({
    ...splitSettings.initialStocks,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSettingsInitialStocksDoc) as Record<string, unknown>
  const boardUiData = boardUiState ? sanitizeForFirestore({
    ...boardUiState,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBoardUiDoc) as Record<string, unknown> : null
  const boardStockData = boardStockState ? sanitizeForFirestore({
    ...boardStockState,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBoardStockDoc) as Record<string, unknown> : null
  const basicManagersData = sanitizeForFirestore({
    managers: data.managers,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBasicManagersDoc) as Record<string, unknown>
  const basicTeachersData = sanitizeForFirestore({
    teachers: data.teachers,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBasicTeachersDoc) as Record<string, unknown>
  const basicStudentsData = sanitizeForFirestore({
    students: data.students,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBasicStudentsDoc) as Record<string, unknown>
  const basicRegularLessonChunks = chunkBasicRegularLessons(data.regularLessons)
  const basicGroupLessonsData = sanitizeForFirestore({
    groupLessons: data.groupLessons,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomBasicGroupLessonsDoc) as Record<string, unknown>
  const rulesData = sanitizeForFirestore({
    specialSessions: data.specialSessions,
    autoAssignRules: data.autoAssignRules,
    pairConstraints: data.pairConstraints,
    savedAt: params.savedAt,
    splitSetId,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  } satisfies FirebaseClassroomSplitRulesDoc) as Record<string, unknown>
  const modernShellDocId = `shell_${await hashJson({ screen: data.screen })}`
  const legacySettingsShellDocId = `shell_${await hashJson({ screen: data.screen, classroomSettings: data.classroomSettings })}`
  const shouldReuseLegacySettingsShell = !previousSnapshotDoc?.settingsDocId && previousSnapshotDoc?.shellDocId === legacySettingsShellDocId
  const shellDocId = shouldReuseLegacySettingsShell ? legacySettingsShellDocId : modernShellDocId
  const settingsCoreDocId = `settingsCore_${await hashJson(splitSettings.core)}`
  const settingsTemplateHash = await hashJson(splitSettings.template)
  const settingsTemplateDocId = `settingsTemplate_${settingsTemplateHash}`
  const settingsRegularTemplateDocId = `settingsRegularTemplate_${await hashJson(splitSettings.regularTemplate)}`
  const settingsTemplateHistoryDocId = `settingsTemplateHistory_${await hashJson(splitSettings.templateHistory)}`
  const legacySettingsPreTemplateRegularLessonsDocId = `settingsPreTemplateRegularLessons_${await hashJson(splitSettings.preTemplateRegularLessons)}`
  const settingsPreTemplateRegularLessonChunkEntries = await Promise.all(preTemplateRegularLessonChunks.map(async (entry) => {
    const data = sanitizeForFirestore({
      index: entry.index,
      preTemplateRegularLessons: entry.preTemplateRegularLessons,
      savedAt: params.savedAt,
      splitSetId,
      updatedBy: params.authenticatedUserId,
      updatedAt: params.savedAt,
    } satisfies FirebaseClassroomSettingsPreTemplateRegularLessonChunkDoc) as Record<string, unknown>
    const docId = `settingsPreTemplateRegularLessons_${`${entry.index}`.padStart(4, '0')}_${await hashJson(entry.preTemplateRegularLessons)}`
    return { docId, ref: doc(partsCollection, docId), data }
  }))
  const settingsInitialStocksDocId = `settingsInitialStocks_${await hashJson(splitSettings.initialStocks)}`
  const previousSettingsDocId = previousSnapshotDoc?.settingsDocId
  let reusableLegacySettingsDocId = shouldReuseLegacySettingsShell ? undefined : previousSettingsDocId
  if (reusableLegacySettingsDocId && !previousSnapshotDoc?.settingsTemplateDocId) {
    const previousSettingsSnapshot = await getDoc(doc(partsCollection, reusableLegacySettingsDocId)).catch(() => null)
    const previousSettingsData = previousSettingsSnapshot?.exists() ? previousSettingsSnapshot.data() as FirebaseClassroomSplitSettingsDoc : null
    const previousTemplateHash = previousSettingsData?.classroomSettings
      ? await hashJson(splitClassroomSettings(previousSettingsData.classroomSettings).template)
      : null
    if (previousTemplateHash !== settingsTemplateHash) reusableLegacySettingsDocId = undefined
  }
  const boardUiDocId = boardUiState ? `boardUi_${await hashJson(boardUiState)}` : undefined
  const boardStockDocId = boardStockState ? `boardStock_${await hashJson(boardStockState)}` : undefined
  const legacyBasicDataDocId = `basic_${await hashJson({ managers: data.managers, teachers: data.teachers, students: data.students, regularLessons: data.regularLessons, groupLessons: data.groupLessons })}`
  const basicManagersDocId = `basicManagers_${await hashJson(data.managers)}`
  const basicTeachersDocId = `basicTeachers_${await hashJson(data.teachers)}`
  const basicStudentsDocId = `basicStudents_${await hashJson(data.students)}`
  const legacyBasicRegularLessonsDocId = `basicRegularLessons_${await hashJson(data.regularLessons)}`
  const basicRegularLessonChunkEntries = await Promise.all(basicRegularLessonChunks.map(async (entry) => {
    const data = sanitizeForFirestore({
      index: entry.index,
      regularLessons: entry.regularLessons,
      savedAt: params.savedAt,
      splitSetId,
      updatedBy: params.authenticatedUserId,
      updatedAt: params.savedAt,
    } satisfies FirebaseClassroomBasicRegularLessonChunkDoc) as Record<string, unknown>
    const docId = `basicRegularLessons_${`${entry.index}`.padStart(4, '0')}_${await hashJson(entry.regularLessons)}`
    return { docId, ref: doc(partsCollection, docId), data }
  }))
  const basicGroupLessonsDocId = `basicGroupLessons_${await hashJson(data.groupLessons)}`
  const rulesDocId = `rules_${await hashJson({ specialSessions: data.specialSessions, autoAssignRules: data.autoAssignRules, pairConstraints: data.pairConstraints })}`
  const boardWeekEntries = await Promise.all(boardWeeks.map(async (week, index) => {
    const cells = Array.isArray(week.cells) ? week.cells : []
    const docId = `week_${`${index}`.padStart(4, '0')}_${await hashJson(cells)}`
    return {
      docId,
      ref: doc(boardWeeksCollection, docId),
      data: sanitizeForFirestore({
        index,
        cells,
        splitSetId,
        savedAt: params.savedAt,
        updatedBy: params.authenticatedUserId,
        updatedAt: params.savedAt,
      } satisfies FirebaseClassroomBoardWeekDoc) as Record<string, unknown>,
    }
  }))
  const snapshotDoc: FirebaseClassroomSnapshotDoc = {
    schemaVersion: APP_SNAPSHOT_SCHEMA_VERSION,
    savedAt: params.savedAt,
    dataEncoding: FIREBASE_SPLIT_SNAPSHOT_ENCODING,
    splitSetId,
    shellDocId,
    settingsCoreDocId,
    basicManagersDocId,
    basicTeachersDocId,
    basicStudentsDocId,
    basicRegularLessonDocIds: basicRegularLessonChunkEntries.map((entry) => entry.docId),
    basicGroupLessonsDocId,
    rulesDocId,
    boardWeekDocIds: boardWeekEntries.map((entry) => entry.docId),
    boardWeekCount: boardWeeks.length,
    updatedBy: params.authenticatedUserId,
    updatedAt: params.savedAt,
  }
  if (reusableLegacySettingsDocId) {
    snapshotDoc.settingsDocId = reusableLegacySettingsDocId
  } else if (previousSnapshotDoc?.settingsTemplateDocId === settingsTemplateDocId) {
    snapshotDoc.settingsTemplateDocId = settingsTemplateDocId
  }
  snapshotDoc.settingsRegularTemplateDocId = settingsRegularTemplateDocId
  snapshotDoc.settingsTemplateHistoryDocId = settingsTemplateHistoryDocId
  snapshotDoc.settingsPreTemplateRegularLessonDocIds = settingsPreTemplateRegularLessonChunkEntries.map((entry) => entry.docId)
  if (previousSnapshotDoc?.settingsPreTemplateRegularLessonsDocId === legacySettingsPreTemplateRegularLessonsDocId) {
    snapshotDoc.settingsPreTemplateRegularLessonsDocId = legacySettingsPreTemplateRegularLessonsDocId
  }
  snapshotDoc.settingsInitialStocksDocId = settingsInitialStocksDocId
  if (boardUiDocId) snapshotDoc.boardUiDocId = boardUiDocId
  if (boardStockDocId) snapshotDoc.boardStockDocId = boardStockDocId
  if (previousSnapshotDoc?.basicDataDocId === legacyBasicDataDocId) snapshotDoc.basicDataDocId = legacyBasicDataDocId
  if (previousSnapshotDoc?.basicRegularLessonsDocId === legacyBasicRegularLessonsDocId) snapshotDoc.basicRegularLessonsDocId = legacyBasicRegularLessonsDocId
  const splitDocs: { ref: DocumentReference; data: Record<string, unknown> }[] = [
    previousSnapshotDoc?.shellDocId === shellDocId ? null : { ref: doc(partsCollection, shellDocId), data: shellData },
    previousSnapshotDoc?.settingsCoreDocId === settingsCoreDocId ? null : { ref: doc(partsCollection, settingsCoreDocId), data: settingsCoreData },
    previousSnapshotDoc?.settingsRegularTemplateDocId === settingsRegularTemplateDocId ? null : { ref: doc(partsCollection, settingsRegularTemplateDocId), data: settingsRegularTemplateData },
    previousSnapshotDoc?.settingsTemplateHistoryDocId === settingsTemplateHistoryDocId ? null : { ref: doc(partsCollection, settingsTemplateHistoryDocId), data: settingsTemplateHistoryData },
    ...settingsPreTemplateRegularLessonChunkEntries.map((entry, index) => previousSnapshotDoc?.settingsPreTemplateRegularLessonDocIds?.[index] === entry.docId
      ? null
      : { ref: entry.ref, data: entry.data }),
    previousSnapshotDoc?.settingsInitialStocksDocId === settingsInitialStocksDocId ? null : { ref: doc(partsCollection, settingsInitialStocksDocId), data: settingsInitialStocksData },
    !boardUiDocId || previousSnapshotDoc?.boardUiDocId === boardUiDocId ? null : { ref: doc(partsCollection, boardUiDocId), data: boardUiData ?? {} },
    !boardStockDocId || previousSnapshotDoc?.boardStockDocId === boardStockDocId ? null : { ref: doc(partsCollection, boardStockDocId), data: boardStockData ?? {} },
    previousSnapshotDoc?.basicManagersDocId === basicManagersDocId ? null : { ref: doc(partsCollection, basicManagersDocId), data: basicManagersData },
    previousSnapshotDoc?.basicTeachersDocId === basicTeachersDocId ? null : { ref: doc(partsCollection, basicTeachersDocId), data: basicTeachersData },
    previousSnapshotDoc?.basicStudentsDocId === basicStudentsDocId ? null : { ref: doc(partsCollection, basicStudentsDocId), data: basicStudentsData },
    ...basicRegularLessonChunkEntries.map((entry, index) => previousSnapshotDoc?.basicRegularLessonDocIds?.[index] === entry.docId
      ? null
      : { ref: entry.ref, data: entry.data }),
    previousSnapshotDoc?.basicGroupLessonsDocId === basicGroupLessonsDocId ? null : { ref: doc(partsCollection, basicGroupLessonsDocId), data: basicGroupLessonsData },
    previousSnapshotDoc?.rulesDocId === rulesDocId ? null : { ref: doc(partsCollection, rulesDocId), data: rulesData },
    ...boardWeekEntries.map((entry, index) => previousSnapshotDoc?.boardWeekDocIds?.[index] === entry.docId
      ? null
      : { ref: entry.ref, data: entry.data }),
  ].filter((entry): entry is { ref: DocumentReference; data: Record<string, unknown> } => Boolean(entry))
  params.onProgress?.({ percent: 60, label: `差分判定完了: 書込${splitDocs.length}件 / 週${boardWeeks.length}件` })
  return {
    classroomId: params.classroomId,
    snapshotRef,
    snapshotDoc,
    chunkDocs: [] as { ref: DocumentReference; data: FirebaseClassroomSnapshotChunkDoc }[],
    splitDocs,
  }
}

async function commitPreparedSnapshotWrites(
  firestore: Firestore,
  preparedSnapshots: Awaited<ReturnType<typeof prepareSnapshotWrite>>[],
  onProgress?: (progress: FirebaseSaveProgress) => void,
) {
  const payloadDocs = preparedSnapshots.flatMap((preparedSnapshot) => [
    ...preparedSnapshot.chunkDocs,
    ...preparedSnapshot.splitDocs,
  ]).map((entry) => ({
    ...entry,
    kind: getPayloadDocKind(entry.ref),
    byteLength: measureJsonBytes(entry.data),
  })).sort((left, right) => left.byteLength - right.byteLength)
  const payloadSummary = summarizePayloadDocs(payloadDocs)
  const snapshotDocCount = preparedSnapshots.length
  if (payloadDocs.length === 0) {
    onProgress?.({
      percent: 100,
      label: 'データベース保存完了',
      details: {
        writeMode: 'no-op',
        payloadDocCount: 0,
        snapshotDocCount,
      },
    })
    preparedSnapshots.forEach((preparedSnapshot) => {
      committedSnapshotMetadataByClassroomId.set(preparedSnapshot.classroomId, preparedSnapshot.snapshotDoc)
    })
    return
  }
  const canUseAtomicBatch = false
  onProgress?.({
    percent: 86,
    label: `差分データを書き込み中: 0/${payloadDocs.length}件`,
    details: {
      writeMode: canUseAtomicBatch ? 'atomic-batch' : 'parallel-set-doc',
      payloadDocCount: payloadDocs.length,
      payloadDocKinds: payloadSummary.byKind,
      totalBytes: payloadSummary.totalBytes,
      maxBytes: payloadSummary.maxBytes,
      maxKind: payloadSummary.maxKind,
      largestDocs: payloadSummary.largestDocs,
      concurrency: FIREBASE_PAYLOAD_WRITE_CONCURRENCY,
      stalledRetryMs: FIREBASE_PAYLOAD_WRITE_STALL_RETRY_MS,
      atomicBatchDocLimit: FIREBASE_ATOMIC_BATCH_DOC_LIMIT,
      atomicBatchByteLimit: FIREBASE_ATOMIC_BATCH_BYTE_LIMIT,
    },
  })
  if (canUseAtomicBatch) {
    const createAtomicBatch = () => {
      const batch = writeBatch(firestore)
      payloadDocs.forEach((entry) => {
        batch.set(entry.ref, entry.data)
      })
      preparedSnapshots.forEach(({ snapshotRef, snapshotDoc }) => {
        batch.set(snapshotRef, snapshotDoc)
      })
      return batch
    }
    await commitBatchWithStallRetry(createAtomicBatch, (retryDetails) => {
      onProgress?.({
        percent: 86,
        label: `差分データの応答待ちを再試行中: 0/${payloadDocs.length}件`,
        details: {
          writeMode: 'atomic-batch-retry',
          payloadDocCount: payloadDocs.length,
          snapshotDocCount,
          ...retryDetails,
        },
      })
    })
    onProgress?.({
      percent: 100,
      label: 'データベース保存完了',
      details: {
        writeMode: 'atomic-batch',
        payloadDocCount: payloadDocs.length,
        snapshotDocCount,
      },
    })
    preparedSnapshots.forEach((preparedSnapshot) => {
      committedSnapshotMetadataByClassroomId.set(preparedSnapshot.classroomId, preparedSnapshot.snapshotDoc)
    })
    return
  }
  let writtenCount = 0
  let nextPayloadIndex = 0
  const reportPayloadWriteProgress = () => {
    const percent = payloadDocs.length > 0
      ? 86 + Math.min(8, Math.floor((writtenCount / payloadDocs.length) * 8))
      : 94
    onProgress?.({
      percent,
      label: `差分データを書き込み中: ${writtenCount}/${payloadDocs.length}件`,
      details: {
        writeMode: 'parallel-set-doc',
        writtenCount,
        payloadDocCount: payloadDocs.length,
      },
    })
  }
  async function writeNextPayloadDoc(): Promise<void> {
    const payloadIndex = nextPayloadIndex
    nextPayloadIndex += 1
    const entry = payloadDocs[payloadIndex]
    if (!entry) return
    await setPayloadDocWithStallRetry(entry, (retryDetails) => {
      onProgress?.({
        percent: 86,
        label: `差分データの応答待ちを再試行中: ${writtenCount}/${payloadDocs.length}件`,
        details: {
          writeMode: 'parallel-set-doc-retry',
          writtenCount,
          payloadDocCount: payloadDocs.length,
          ...retryDetails,
        },
      })
    })
    writtenCount += 1
    reportPayloadWriteProgress()
    await writeNextPayloadDoc()
  }
  await Promise.all(Array.from(
    { length: Math.min(FIREBASE_PAYLOAD_WRITE_CONCURRENCY, payloadDocs.length) },
    () => writeNextPayloadDoc(),
  ))

  onProgress?.({ percent: 96, label: '保存内容を確定中' })
  await commitBatchWithStallRetry(() => {
    const batch = writeBatch(firestore)
    preparedSnapshots.forEach(({ snapshotRef, snapshotDoc }) => {
      batch.set(snapshotRef, snapshotDoc)
    })
    return batch
  }, (retryDetails) => {
    onProgress?.({
      percent: 96,
      label: '保存内容の確定応答待ちを再試行中',
      details: {
        writeMode: 'snapshot-parent-retry',
        snapshotDocCount,
        ...retryDetails,
      },
    })
  })
  preparedSnapshots.forEach((preparedSnapshot) => {
    committedSnapshotMetadataByClassroomId.set(preparedSnapshot.classroomId, preparedSnapshot.snapshotDoc)
  })
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

async function deleteMissingDocs(params: {
  firestore: Firestore
  classroomIds: string[]
  userIds: string[]
  protectedUserIds: string[]
}) {
  const { firestore, classroomIds, userIds, protectedUserIds } = params
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
    .filter((entry) => !userIds.includes(entry.id) && !protectedUserIds.includes(entry.id))
    .forEach((entry) => {
      batch.delete(entry.ref)
    })

  await batch.commit()
}

export async function saveFirebaseWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  authenticatedUserId: string,
  onProgress?: (progress: FirebaseSaveProgress) => void,
  options?: { targetClassroomIds?: string[] },
) {
  const firestore = requireFirestore()
  onProgress?.({ percent: 5, label: 'データベース接続を確認中' })
  const membership = await loadWorkspaceMembership(firestore, authenticatedUserId)
  const savedAt = snapshot.savedAt || new Date().toISOString()
  onProgress?.({ percent: 15, label: '保存データを準備中' })

  if (membership.role === 'developer') {
    // 自分自身（ログイン中の開発者）が users から欠けていると、後段の deleteMissingDocs で
    // 自分の member ドキュメントが削除されてしまい、以降ログイン不能になる。
    // 保存対象の users に必ず自分自身を含めるよう、欠けていればこの場で補う。
    const ensuredUsers = snapshot.users.some((user) => user.id === authenticatedUserId)
      ? snapshot.users
      : [
        ...snapshot.users,
        {
          id: authenticatedUserId,
          name: membership.displayName?.trim() || membership.email?.trim() || authenticatedUserId,
          email: membership.email?.trim() || '',
          role: membership.role,
          assignedClassroomId: membership.assignedClassroomId ?? null,
        },
      ]

    const targetClassroomIds = options?.targetClassroomIds?.filter((classroomId) => snapshot.classrooms.some((classroom) => classroom.id === classroomId))
    const snapshotClassrooms = targetClassroomIds && targetClassroomIds.length > 0
      ? snapshot.classrooms.filter((classroom) => targetClassroomIds.includes(classroom.id))
      : snapshot.classrooms
    const preparedSnapshots = await Promise.all(snapshotClassrooms.map((classroom) => prepareSnapshotWrite({
      firestore,
      classroomId: classroom.id,
      payload: classroom.data,
      savedAt,
      authenticatedUserId,
      onProgress,
    })))
    onProgress?.({ percent: 65, label: '保存データを分割・圧縮済み' })
    if (targetClassroomIds && targetClassroomIds.length > 0) {
      onProgress?.({ percent: 85, label: 'データベースへ保存中' })
      await commitPreparedSnapshotWrites(firestore, preparedSnapshots, onProgress)
      onProgress?.({ percent: 100, label: 'データベース保存完了' })
      return savedAt
    }

    const batch = writeBatch(firestore)

    batch.set(getWorkspaceRef(firestore), {
      name: getFirebaseBackendConfig().workspaceKey,
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    } satisfies FirebaseWorkspaceDoc, { merge: true })

    ensuredUsers.forEach((user) => {
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
    })
    onProgress?.({ percent: 85, label: 'データベースへ保存中' })
    await batch.commit()
    await commitPreparedSnapshotWrites(firestore, preparedSnapshots, onProgress)
    onProgress?.({ percent: 92, label: '保存後の整合性を確認中' })
    await deleteMissingDocs({
      firestore,
      classroomIds: snapshot.classrooms.map((classroom) => classroom.id),
      userIds: ensuredUsers.map((user) => user.id),
      // 念のため二重ガード: 自分自身の member は絶対に削除させない
      protectedUserIds: [authenticatedUserId],
    })
    onProgress?.({ percent: 100, label: 'データベース保存完了' })
    return savedAt
  }

  const targetClassroomId = membership.assignedClassroomId
  const targetClassroom = snapshot.classrooms.find((classroom) => classroom.id === targetClassroomId)
  if (!targetClassroom) {
    throw new Error('担当教室のスナップショットが見つからないため、Firebase へ保存できませんでした。')
  }

  const preparedSnapshot = await prepareSnapshotWrite({
    firestore,
    classroomId: targetClassroom.id,
    payload: targetClassroom.data,
    savedAt,
    authenticatedUserId,
    onProgress,
  })
  onProgress?.({ percent: 70, label: '保存データを分割・圧縮済み' })
  onProgress?.({ percent: 85, label: 'データベースへ保存中' })
  await commitPreparedSnapshotWrites(firestore, [preparedSnapshot], onProgress)
  onProgress?.({ percent: 100, label: 'データベース保存完了' })

  return savedAt
}

export async function saveFirebaseClassroomSettingsSnapshot(params: {
  classroomId: string
  settings: ClassroomSettings
  authenticatedUserId: string
  savedAt: string
}) {
  const firestore = requireFirestore()
  await loadWorkspaceMembership(firestore, params.authenticatedUserId)
  await writeBatch(firestore)
    .set(doc(getClassroomSettingsCollection(firestore), params.classroomId), sanitizeForFirestore({
      settings: params.settings,
      savedAt: params.savedAt,
      updatedBy: params.authenticatedUserId,
      updatedAt: params.savedAt,
    }) satisfies FirebaseClassroomSettingsDoc)
    .commit()
  return params.savedAt
}

