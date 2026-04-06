import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackupRestoreScreen } from './components/backup-restore/BackupRestoreScreen'
import { BasicDataScreen, buildWorkbook as buildBasicDataWorkbook, createTemplateBundle as createBasicDataTemplateBundle, initialGroupLessons, initialManagers, mergeImportedBundle, parseImportedBundle, type GroupLessonRow } from './components/basic-data/BasicDataScreen'
import { validateImportedBasicDataBundle } from './components/basic-data/basicDataImportValidation'
import { AutoAssignRuleScreen, buildAutoAssignWorkbook, parseAutoAssignWorkbook } from './components/auto-assign-rules/AutoAssignRuleScreen'
import { initialAutoAssignRules } from './components/auto-assign-rules/autoAssignRuleModel'
import { initialPairConstraints } from './types/pairConstraint'
import { deriveManagedDisplayName, getStudentDisplayName, getTeacherDisplayName, initialStudents, initialTeachers, isActiveOnDate, resolveCurrentStudentGradeLabel, type ManagerRow, type StudentRow, type TeacherRow } from './components/basic-data/basicDataModel'
import { createInitialRegularLessons, packSortRegularLessonRows, type RegularLessonRow } from './components/basic-data/regularLessonModel'
import { buildSpecialSessionWorkbook, buildTemplateSpecialSessions, parseSpecialSessionWorkbook, SpecialSessionScreen } from './components/special-data/SpecialSessionScreen'
import { initialSpecialSessions, removedDefaultSpecialSessionIds } from './components/special-data/specialSessionModel'
import { ScheduleBoardScreen, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, createPackedInitialBoardState, normalizeScheduleRange, readStoredScheduleRange, type ScheduleRangePreference } from './components/schedule-board/ScheduleBoardScreen'
import { DeveloperAdminScreen } from './components/developer-admin/DeveloperAdminScreen'
import { buildRegularLessonsFromTemplate, hasRegularLessonTemplateAssignments } from './components/regular-template/regularLessonTemplate'
import { importedMasterData } from './data/importedMasterData.generated'
import { deleteFirebaseWorkspaceClassroom, deleteFirebaseWorkspaceClassroomDirect, downloadClassroomFromFirebaseServerAutoBackup, downloadFirebaseServerAutoBackup, listFirebaseServerAutoBackupSummaries, provisionFirebaseWorkspaceClassroom, provisionFirebaseWorkspaceClassroomWithExistingUid, reassignFirebaseWorkspaceClassroomManagerWithExistingUid, updateFirebaseWorkspaceClassroom, type ServerAutoBackupSummary } from './integrations/firebase/adminFunctions'
import { createFirebaseAuthUser, getFirebaseCurrentUser, reauthenticateFirebaseUser, sendFirebasePasswordResetEmail, signInToFirebaseWithPassword, signOutFromFirebase, subscribeToFirebaseAuthChanges } from './integrations/firebase/client'
import { getFirebaseBackendConfig, isFirebaseAdminFunctionsEnabled, isFirebaseBackendEnabled } from './integrations/firebase/config'
import { loadFirebaseWorkspaceSnapshot, saveFirebaseWorkspaceSnapshot } from './integrations/firebase/workspaceStore'
import { ensureSubmissionTokens, writeSubmissionDocs, resetLectureSubmissionDoc, subscribeLectureSubmissions } from './integrations/firebase/lectureSubmission'
import type { SlotCell } from './components/schedule-board/types'
import { getWeekStart, shiftDate } from './components/schedule-board/mockData'
import { clearDeveloperCloudBackupHandle, loadAppSnapshot, loadDeveloperCloudBackupHandle, loadWorkspaceAutoBackupSummaries, loadWorkspaceAutoBackupSnapshot, loadWorkspaceSnapshot, parseAppSnapshot, parseWorkspaceSnapshot, saveDailyWorkspaceAutoBackup, saveDeveloperCloudBackupHandle, saveWorkspaceSnapshot, serializeWorkspaceSnapshot, writeWorkspaceToLocalStorageSync } from './data/appSnapshotRepository'
import type { AppScreen, AppSnapshot, AppSnapshotPayload, ClassroomScreen, ClassroomSettings as SharedClassroomSettings, PersistedBoardState, WorkspaceClassroom, WorkspaceSnapshot, WorkspaceUser } from './types/appState'
import { formatWeeklyScheduleTitle, syncStudentScheduleHtml, syncTeacherScheduleHtml } from './utils/scheduleHtml'
import { syncSpecialSessionAvailabilityHtml } from './utils/specialSessionAvailabilityHtml'
import { getSelectableStudentSubjectsForGrade } from './utils/studentGradeSubject'
import './App.css'

export type ClassroomSettings = SharedClassroomSettings

export type TeacherAutoAssignRequest = {
  requestId: number
  sessionId: string
  teacherId: string
  mode: 'assign' | 'unassign'
}

export type StudentScheduleRequest = {
  requestId: number
  sessionId: string
  studentId: string
  mode: 'unassign'
}

type SchedulePopupRuntimeWindow = Window & typeof globalThis & {
  __lessonScheduleStudentWindow?: Window | null
  __lessonScheduleTeacherWindow?: Window | null
  __lessonScheduleSpecialSessionWindow?: Window | null
  __lessonScheduleSpecialSessionId?: string
  __lessonScheduleBoardWeeks?: SlotCell[][]
}

type DeveloperCloudBackupPermissionOptions = {
  mode?: 'read' | 'readwrite'
}

type DeveloperCloudBackupWritable = {
  write: (data: string | Blob) => Promise<void>
  close: () => Promise<void>
}

type DeveloperCloudBackupFileHandle = {
  createWritable: () => Promise<DeveloperCloudBackupWritable>
}

type DeveloperCloudBackupDirectoryHandle = {
  kind: 'directory'
  name: string
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<DeveloperCloudBackupFileHandle>
  queryPermission?: (options?: DeveloperCloudBackupPermissionOptions) => Promise<PermissionState>
  requestPermission?: (options?: DeveloperCloudBackupPermissionOptions) => Promise<PermissionState>
}

type DeveloperCloudBackupRuntimeWindow = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: DeveloperCloudBackupPermissionOptions) => Promise<DeveloperCloudBackupDirectoryHandle>
}

type BlazeFreeTierEstimate = {
  currentClassroomCount: number
  currentWorkspaceDailyBytes: number
  currentWorkspaceRetentionBytes: number
  currentWorkspaceUsageRate: number
  currentWorkspaceMaxRetentionDays: number
  estimatedAverageClassroomBytes: number
  estimatedReferenceDailyBytes: number
  estimatedReferenceRetentionBytes: number
  estimatedReferenceUsageRate: number
  estimatedReferenceMaxRetentionDays: number
  referenceClassroomCount: number
  retentionDays: number
  freeTierStorageBytes: number
}

const SERVER_AUTO_BACKUP_RETENTION_DAYS = 14
const BLAZE_STORAGE_FREE_TIER_BYTES = 5_000_000_000
const BLAZE_STORAGE_REFERENCE_CLASSROOM_COUNT = 50

function measureUtf8Bytes(text: string) {
  return new TextEncoder().encode(text).length
}

function measureJsonBytes(value: unknown) {
  return measureUtf8Bytes(JSON.stringify(value))
}

type DeveloperRestoreModalOption = {
  classroomId: string
  classroomName: string
  managerName: string
  existsInCurrent: boolean
  selected: boolean
}

type DeveloperRestoreModalState = {
  sourceLabel: string
  savedAt: string
  currentSnapshot: WorkspaceSnapshot
  restoringSnapshot: WorkspaceSnapshot
  options: DeveloperRestoreModalOption[]
}

type AddClassroomOptions = {
  classroomName: string
  managerName: string
  managerEmail?: string
  managerPassword?: string
  managerUserId?: string
  contractStartDate?: string
  contractEndDate?: string
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function getSchedulePopupRuntimeWindow() {
  return window as SchedulePopupRuntimeWindow
}

function getDeveloperCloudBackupRuntimeWindow() {
  return window as DeveloperCloudBackupRuntimeWindow
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getScheduleFallbackRange() {
  const weekStart = getWeekStart(new Date())
  return {
    startDate: toDateKey(weekStart),
    endDate: toDateKey(shiftDate(weekStart, 6)),
  }
}

function formatBackupFileName(savedAt: string, kind: string) {
  const parsed = new Date(savedAt)
  if (Number.isNaN(parsed.getTime())) return `コマ表アプリ_${kind}.json`

  const year = parsed.getFullYear()
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0')
  const day = `${parsed.getDate()}`.padStart(2, '0')
  const hour = `${parsed.getHours()}`.padStart(2, '0')
  const minute = `${parsed.getMinutes()}`.padStart(2, '0')
  const second = `${parsed.getSeconds()}`.padStart(2, '0')
  return `コマ表アプリ_${kind}_${year}年${month}月${day}日_${hour}時${minute}分${second}秒.json`
}

function formatPreciseBackupFileName(savedAt: string, kind: string) {
  const parsed = new Date(savedAt)
  if (Number.isNaN(parsed.getTime())) return `コマ表アプリ_${kind}_${Date.now()}.json`

  const year = parsed.getFullYear()
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0')
  const day = `${parsed.getDate()}`.padStart(2, '0')
  const hour = `${parsed.getHours()}`.padStart(2, '0')
  const minute = `${parsed.getMinutes()}`.padStart(2, '0')
  const second = `${parsed.getSeconds()}`.padStart(2, '0')
  const millisecond = `${parsed.getMilliseconds()}`.padStart(3, '0')
  return `コマ表アプリ_${kind}_${year}年${month}月${day}日_${hour}時${minute}分${second}秒${millisecond}.json`
}

function buildNormalizedScheduleRange(viewType: 'student' | 'teacher', range: ScheduleRangePreference | null) {
  const fallbackRange = getScheduleFallbackRange()
  return normalizeScheduleRange(
    range ?? readStoredScheduleRange(viewType, fallbackRange.startDate, fallbackRange.endDate),
    fallbackRange.startDate,
    fallbackRange.endDate,
  )
}

function shouldUseImportedMasterData() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return importedMasterData.teachers.length > 0 && importedMasterData.students.length > 0
}

function isSnapshotPersistenceRuntimeEnabled() {
  if (typeof navigator !== 'undefined' && navigator.webdriver && !isFirebaseBackendEnabled()) return false
  return true
}

function isDeveloperCloudBackupSupported() {
  if (typeof window === 'undefined' || !window.isSecureContext) return false
  return typeof getDeveloperCloudBackupRuntimeWindow().showDirectoryPicker === 'function'
}

function serializeAnalysisExport(payload: unknown) {
  return JSON.stringify(payload, null, 2)
}

function isDeveloperCloudBackupDirectoryHandle(value: unknown): value is DeveloperCloudBackupDirectoryHandle {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.kind === 'directory'
    && typeof record.name === 'string'
    && typeof record.getFileHandle === 'function'
}

async function ensureDeveloperCloudBackupPermission(handle: DeveloperCloudBackupDirectoryHandle) {
  if (handle.queryPermission) {
    const currentPermission = await handle.queryPermission({ mode: 'readwrite' })
    if (currentPermission === 'granted') return true
  }

  if (handle.requestPermission) {
    const requestedPermission = await handle.requestPermission({ mode: 'readwrite' })
    return requestedPermission === 'granted'
  }

  return true
}

function getDeveloperCloudBackupFileName(savedAt: string) {
  return formatPreciseBackupFileName(savedAt, '開発者バックアップ_自動保存')
}

async function writeTextFileToDeveloperCloudDirectory(handle: DeveloperCloudBackupDirectoryHandle, fileName: string, content: string) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

const removedDefaultSpecialSessionIdSet = new Set(removedDefaultSpecialSessionIds)

function sanitizeClassroomSettings(settings: ClassroomSettings): ClassroomSettings {
  const initialSettings = createInitialClassroomSettings()
  const normalizedClosedWeekdays = Array.from(new Set(
    (Array.isArray(settings.closedWeekdays) ? settings.closedWeekdays : initialSettings.closedWeekdays)
      .filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 6),
  )).sort((left, right) => left - right)
  const normalizedForceOpenDates = Array.from(new Set(
    (Array.isArray(settings.forceOpenDates) ? settings.forceOpenDates : initialSettings.forceOpenDates)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right))

  return {
    ...initialSettings,
    ...settings,
    closedWeekdays: normalizedClosedWeekdays.length > 0 ? normalizedClosedWeekdays : initialSettings.closedWeekdays,
    holidayDates: [],
    forceOpenDates: normalizedForceOpenDates,
    deskCount: Math.max(1, Number(settings.deskCount) || initialSettings.deskCount),
    initialSetupCompletedAt: typeof settings.initialSetupCompletedAt === 'string' ? settings.initialSetupCompletedAt : initialSettings.initialSetupCompletedAt,
    initialSetupMakeupStocks: Array.isArray(settings.initialSetupMakeupStocks) ? settings.initialSetupMakeupStocks : initialSettings.initialSetupMakeupStocks,
    initialSetupLectureStocks: Array.isArray(settings.initialSetupLectureStocks) ? settings.initialSetupLectureStocks : initialSettings.initialSetupLectureStocks,
  }
}

function sanitizeSpecialSessions(sessions: AppSnapshotPayload['specialSessions']) {
  return sessions.filter((session) => !removedDefaultSpecialSessionIdSet.has(session.id))
}

function sanitizeClassroomPayload(payload: AppSnapshotPayload): AppSnapshotPayload {
  return {
    ...payload,
    classroomSettings: sanitizeClassroomSettings(payload.classroomSettings),
    specialSessions: sanitizeSpecialSessions(payload.specialSessions),
  }
}

function sanitizeAppSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    ...sanitizeClassroomPayload(snapshot),
  }
}

function normalizeWorkspaceClassroom(classroom: WorkspaceClassroom): WorkspaceClassroom {
  return {
    ...classroom,
    isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
    temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
    data: sanitizeClassroomPayload(classroom.data),
  }
}

function sanitizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    classrooms: snapshot.classrooms.map((classroom) => normalizeWorkspaceClassroom(classroom)),
  }
}

function buildWorkspaceSnapshotMergeFromSelection(currentSnapshot: WorkspaceSnapshot, restoringSnapshot: WorkspaceSnapshot, restoreByClassroomId: Map<string, boolean>) {
  const currentClassroomById = new Map(currentSnapshot.classrooms.map((classroom) => [classroom.id, normalizeWorkspaceClassroom(classroom)]))
  const restoringClassroomById = new Map(restoringSnapshot.classrooms.map((classroom) => [classroom.id, normalizeWorkspaceClassroom(classroom)]))

  const mergedClassrooms: WorkspaceClassroom[] = currentSnapshot.classrooms.map((classroom) => {
    const restoringClassroom = restoringClassroomById.get(classroom.id)
    if (!restoringClassroom) return classroom
    return restoreByClassroomId.get(classroom.id) ? restoringClassroom : classroom
  })

  restoringSnapshot.classrooms.forEach((classroom) => {
    if (currentClassroomById.has(classroom.id)) return
    if (!restoreByClassroomId.get(classroom.id)) return
    mergedClassrooms.push(normalizeWorkspaceClassroom(classroom))
  })

  const restoredCount = Array.from(restoreByClassroomId.values()).filter(Boolean).length

  const currentUserById = new Map(currentSnapshot.users.map((user) => [user.id, user]))
  const restoringUserById = new Map(restoringSnapshot.users.map((user) => [user.id, user]))
  const currentDeveloperUsers = currentSnapshot.users.filter((user) => user.role !== 'manager')
  const mergedManagers: WorkspaceUser[] = mergedClassrooms.flatMap((classroom) => {
    const restoringClassroom = restoringClassroomById.get(classroom.id)
    const useRestoringClassroom = restoringClassroom && restoreByClassroomId.get(classroom.id)
    const sourceUser = useRestoringClassroom
      ? restoringUserById.get(classroom.managerUserId)
      : currentUserById.get(classroom.managerUserId) ?? restoringUserById.get(classroom.managerUserId)
    return sourceUser ? [sourceUser] : []
  })
  const uniqueManagers = Array.from(new Map(mergedManagers.map((user) => [user.id, user])).values())
  const nextUsers = [...currentDeveloperUsers, ...uniqueManagers]
  const nextActingClassroomId = mergedClassrooms.some((classroom) => classroom.id === currentSnapshot.actingClassroomId)
    ? currentSnapshot.actingClassroomId
    : (mergedClassrooms[0]?.id ?? null)
  const nextCurrentUserId = nextUsers.some((user) => user.id === currentSnapshot.currentUserId)
    ? currentSnapshot.currentUserId
    : ''

  return {
    restoredCount,
    snapshot: {
      ...currentSnapshot,
      savedAt: restoringSnapshot.savedAt,
      classrooms: mergedClassrooms,
      users: nextUsers,
      currentUserId: nextCurrentUserId,
      actingClassroomId: nextActingClassroomId,
    },
  }
}

function buildDeveloperRestoreModalState(currentSnapshot: WorkspaceSnapshot, restoringSnapshot: WorkspaceSnapshot, sourceLabel: string): DeveloperRestoreModalState {
  const currentClassroomById = new Map(currentSnapshot.classrooms.map((classroom) => [classroom.id, classroom]))
  const restoringManagerById = new Map(restoringSnapshot.users.filter((user) => user.role === 'manager').map((user) => [user.id, user.name]))
  return {
    sourceLabel,
    savedAt: restoringSnapshot.savedAt,
    currentSnapshot,
    restoringSnapshot,
    options: restoringSnapshot.classrooms.map((classroom) => ({
      classroomId: classroom.id,
      classroomName: classroom.name || '名称未設定の教室',
      managerName: restoringManagerById.get(classroom.managerUserId) ?? '未設定',
      existsInCurrent: currentClassroomById.has(classroom.id),
      selected: true,
    })),
  }
}

function buildWorkspaceAnalysisExport(snapshot: WorkspaceSnapshot) {
  return {
    exportedAt: snapshot.savedAt,
    schemaVersion: snapshot.schemaVersion,
    classroomCount: snapshot.classrooms.length,
    userCount: snapshot.users.length,
    classrooms: snapshot.classrooms.map((classroom) => {
      const managerUser = snapshot.users.find((user) => user.id === classroom.managerUserId) ?? null
      const payload = classroom.data
      return {
        classroomId: classroom.id,
        classroomName: classroom.name,
        contractStatus: classroom.contractStatus,
        contractStartDate: classroom.contractStartDate,
        contractEndDate: classroom.contractEndDate,
        isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
        temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
        managerUser: managerUser
          ? {
            id: managerUser.id,
            name: managerUser.name,
            email: managerUser.email,
          }
          : null,
        counts: {
          managers: payload.managers.length,
          teachers: payload.teachers.length,
          students: payload.students.length,
          regularLessons: payload.regularLessons.length,
          groupLessons: payload.groupLessons.length,
          specialSessions: payload.specialSessions.length,
          autoAssignRules: payload.autoAssignRules.length,
          pairConstraints: payload.pairConstraints.length,
        },
        data: payload,
      }
    }),
  }
}

async function syncWorkspaceArtifactsToDeveloperCloudDirectory(snapshot: WorkspaceSnapshot, handle: DeveloperCloudBackupDirectoryHandle) {
  await writeTextFileToDeveloperCloudDirectory(handle, getDeveloperCloudBackupFileName(snapshot.savedAt), serializeWorkspaceSnapshot(snapshot))
}

function cloneInitialValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function createImportedTeachers() {
  return importedMasterData.teachers.map((teacher) => ({
    ...teacher,
    displayName: deriveManagedDisplayName(teacher.name),
  }))
}

function createImportedStudents() {
  return importedMasterData.students.map((student) => ({
    ...student,
    displayName: deriveManagedDisplayName(student.name),
  }))
}

function createImportedRegularLessons(teachers = createImportedTeachers()) {
  return packSortRegularLessonRows(importedMasterData.regularLessons.map((row) => ({
    ...row,
    schoolYear: 2026,
  })), (row) => teachers.find((teacher) => teacher.id === row.teacherId)?.displayName ?? '')
}

function createInitialManagers() {
  return cloneInitialValue(initialManagers)
}

function createInitialTeachers(useImportedMasterData: boolean) {
  return useImportedMasterData ? createImportedTeachers() : cloneInitialValue(initialTeachers)
}

function createInitialStudents(useImportedMasterData: boolean) {
  return useImportedMasterData ? createImportedStudents() : cloneInitialValue(initialStudents)
}

function createInitialRegularLessonRows(useImportedMasterData: boolean) {
  return useImportedMasterData ? createImportedRegularLessons() : createInitialRegularLessons()
}

function createInitialGroupLessonRows() {
  return cloneInitialValue(initialGroupLessons)
}

function createInitialSpecialSessionRows() {
  return cloneInitialValue(initialSpecialSessions)
}

function createInitialAutoAssignRuleRows() {
  return cloneInitialValue(initialAutoAssignRules)
}

function createInitialPairConstraintRows() {
  return cloneInitialValue(initialPairConstraints)
}

function createInitialClassroomSettings(): ClassroomSettings {
  return {
    closedWeekdays: [0],
    holidayDates: [],
    forceOpenDates: [],
    deskCount: 14,
    regularLessonTemplate: null,
    initialSetupCompletedAt: '',
    initialSetupMakeupStocks: [],
    initialSetupLectureStocks: [],
  }
}

function createDraftId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function buildInitialClassroomPayload(useImportedMasterData: boolean): AppSnapshotPayload {
  return {
    screen: 'board',
    classroomSettings: createInitialClassroomSettings(),
    managers: createInitialManagers(),
    teachers: createInitialTeachers(useImportedMasterData),
    students: createInitialStudents(useImportedMasterData),
    regularLessons: createInitialRegularLessonRows(useImportedMasterData),
    groupLessons: createInitialGroupLessonRows(),
    specialSessions: createInitialSpecialSessionRows(),
    autoAssignRules: createInitialAutoAssignRuleRows(),
    pairConstraints: createInitialPairConstraintRows(),
    boardState: null,
  }
}

function buildEmptyClassroomPayload(): AppSnapshotPayload {
  return {
    screen: 'board',
    classroomSettings: createInitialClassroomSettings(),
    managers: [],
    teachers: [],
    students: [],
    regularLessons: [],
    groupLessons: [],
    specialSessions: createInitialSpecialSessionRows(),
    autoAssignRules: createInitialAutoAssignRuleRows(),
    pairConstraints: createInitialPairConstraintRows(),
    boardState: null,
  }
}

function getTodayDateValue() {
  return toDateKey(new Date())
}

function createInitialWorkspace(useImportedMasterData: boolean): WorkspaceSnapshot {
  const classroomId = 'classroom_001'
  const managerUserId = 'manager_001'
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: '',
    actingClassroomId: classroomId,
    users: [
      {
        id: 'developer_001',
        name: '開発者',
        email: 'developer@example.local',
        role: 'developer',
        assignedClassroomId: null,
      },
      {
        id: managerUserId,
        name: '初期教室管理者',
        email: 'classroom001@example.local',
        role: 'manager',
        assignedClassroomId: classroomId,
      },
    ],
    classrooms: [
      {
        id: classroomId,
        name: '初期教室',
        contractStatus: 'active',
        contractStartDate: getTodayDateValue(),
        contractEndDate: '',
        managerUserId,
        isTemporarilySuspended: false,
        temporarySuspensionReason: '',
        data: buildInitialClassroomPayload(useImportedMasterData),
      },
    ],
  }
}

function applyClassroomPayloadToState(payload: AppSnapshotPayload, handlers: {
  setScreen: (value: ClassroomScreen) => void
  setManagers: (value: ManagerRow[]) => void
  setTeachers: (value: TeacherRow[]) => void
  setStudents: (value: StudentRow[]) => void
  setRegularLessons: (value: RegularLessonRow[]) => void
  setGroupLessons: (value: GroupLessonRow[]) => void
  setSpecialSessions: (value: typeof initialSpecialSessions) => void
  setAutoAssignRules: (value: typeof initialAutoAssignRules) => void
  setPairConstraints: (value: typeof initialPairConstraints) => void
  setClassroomSettings: (value: ClassroomSettings) => void
  setBoardState: (value: PersistedBoardState | null) => void
}) {
  const sanitizedPayload = sanitizeClassroomPayload(payload)
  handlers.setScreen(sanitizedPayload.screen)
  handlers.setManagers(sanitizedPayload.managers)
  handlers.setTeachers(sanitizedPayload.teachers)
  handlers.setStudents(sanitizedPayload.students)
  handlers.setRegularLessons(sanitizedPayload.regularLessons)
  handlers.setGroupLessons(sanitizedPayload.groupLessons)
  handlers.setSpecialSessions(sanitizedPayload.specialSessions)
  handlers.setAutoAssignRules(sanitizedPayload.autoAssignRules)
  handlers.setPairConstraints(sanitizedPayload.pairConstraints)
  handlers.setClassroomSettings(sanitizedPayload.classroomSettings)
  handlers.setBoardState(sanitizedPayload.boardState)
}

function buildClassroomSnapshotPayload(params: {
  screen: ClassroomScreen
  classroomSettings: ClassroomSettings
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  groupLessons: GroupLessonRow[]
  specialSessions: typeof initialSpecialSessions
  autoAssignRules: typeof initialAutoAssignRules
  pairConstraints: typeof initialPairConstraints
  boardState: PersistedBoardState | null
}): AppSnapshotPayload {
  return sanitizeClassroomPayload({
    screen: params.screen,
    classroomSettings: params.classroomSettings,
    managers: params.managers,
    teachers: params.teachers,
    students: params.students,
    regularLessons: params.regularLessons,
    groupLessons: params.groupLessons,
    specialSessions: params.specialSessions,
    autoAssignRules: params.autoAssignRules,
    pairConstraints: params.pairConstraints,
    boardState: params.boardState,
  })
}

function mergeWorkspaceWithLocalPreferences(remoteSnapshot: WorkspaceSnapshot, localSnapshot: WorkspaceSnapshot | null) {
  if (!localSnapshot) return remoteSnapshot

  return {
    ...remoteSnapshot,
    developerCloudBackupEnabled: localSnapshot.developerCloudBackupEnabled ?? remoteSnapshot.developerCloudBackupEnabled,
    developerCloudBackupFolderName: localSnapshot.developerCloudBackupFolderName ?? remoteSnapshot.developerCloudBackupFolderName,
    developerCloudSyncedAutoBackupKeys: localSnapshot.developerCloudSyncedAutoBackupKeys ?? remoteSnapshot.developerCloudSyncedAutoBackupKeys,
  }
}

function App() {
  const isRemoteBackendEnabled = isFirebaseBackendEnabled()
  const isRemoteAdminAutomationEnabled = isFirebaseAdminFunctionsEnabled()
  const firebaseBackendConfig = getFirebaseBackendConfig()
  const useImportedMasterData = shouldUseImportedMasterData()
  const initialSetupAutoOpenRef = useRef(false)
  const remoteClassroomUpdateTimeoutsRef = useRef<Record<string, number>>({})
  const teacherAutoAssignRequestIdRef = useRef(0)
  const studentScheduleRequestIdRef = useRef(0)
  const recentlyResetSubmissionTokensRef = useRef<Set<string>>(new Set())
  const [screen, setScreen] = useState<AppScreen>('board')
  const [managers, setManagers] = useState<ManagerRow[]>(() => createInitialManagers())
  const [teachers, setTeachers] = useState(() => createInitialTeachers(useImportedMasterData))
  const [students, setStudents] = useState(() => createInitialStudents(useImportedMasterData))
  const [regularLessons, setRegularLessons] = useState(() => createInitialRegularLessonRows(useImportedMasterData))
  const [groupLessons, setGroupLessons] = useState<GroupLessonRow[]>(() => createInitialGroupLessonRows())
  const [specialSessions, setSpecialSessions] = useState(() => createInitialSpecialSessionRows())
  const [autoAssignRules, setAutoAssignRules] = useState(() => createInitialAutoAssignRuleRows())
  const [pairConstraints, setPairConstraints] = useState(() => createInitialPairConstraintRows())
  const [classroomSettings, setClassroomSettings] = useState<ClassroomSettings>(() => createInitialClassroomSettings())
  const [boardState, setBoardState] = useState<PersistedBoardState | null>(null)
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherAutoAssignRequest, setTeacherAutoAssignRequest] = useState<TeacherAutoAssignRequest | null>(null)
  const [studentScheduleRequest, setStudentScheduleRequest] = useState<StudentScheduleRequest | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState('保存データを確認しています。')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [serverAutoBackupSummaries, setServerAutoBackupSummaries] = useState<ServerAutoBackupSummary[]>([])
  const [serverAutoBackupLoading, setServerAutoBackupLoading] = useState(false)
  const [localAutoBackupSummaries, setLocalAutoBackupSummaries] = useState<{ backupDateKey: string; savedAt: string }[]>([])
  const [studentHistoryState, setStudentHistoryState] = useState<null | { classroomName: string; entries: Array<{ dateKey: string; count: number }>; loading: boolean }>(null)
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([])
  const [workspaceClassrooms, setWorkspaceClassrooms] = useState<WorkspaceClassroom[]>([])
  const [developerCloudBackupEnabled, setDeveloperCloudBackupEnabled] = useState(false)
  const [developerCloudBackupFolderName, setDeveloperCloudBackupFolderName] = useState('')
  const [developerCloudBackupStatus, setDeveloperCloudBackupStatus] = useState('個人クラウドへの自動保存は未設定です。')
  const [developerCloudBackupHandle, setDeveloperCloudBackupHandle] = useState<DeveloperCloudBackupDirectoryHandle | null>(null)
  const [developerCloudSyncedAutoBackupKeys, setDeveloperCloudSyncedAutoBackupKeys] = useState<string[]>([])
  const [developerRestoreModalState, setDeveloperRestoreModalState] = useState<DeveloperRestoreModalState | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [actingClassroomId, setActingClassroomId] = useState<string | null>(null)
  const [bulkTemporarySuspensionReason, setBulkTemporarySuspensionReason] = useState('')
  const [hasCheckedRemoteSession, setHasCheckedRemoteSession] = useState(!isRemoteBackendEnabled)
  const [remoteSessionUserId, setRemoteSessionUserId] = useState<string | null>(null)
  const [remoteLoginEmail, setRemoteLoginEmail] = useState('')
  const [remoteLoginPassword, setRemoteLoginPassword] = useState('')
  const [remoteAuthMessage, setRemoteAuthMessage] = useState('')
  const [isRemoteLoginSubmitting, setIsRemoteLoginSubmitting] = useState(false)
  const [hasHydratedSnapshot, setHasHydratedSnapshot] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<{ label: string; data: AppSnapshotPayload } | null>(null)
  const currentUser = useMemo(() => workspaceUsers.find((user) => user.id === currentUserId) ?? null, [currentUserId, workspaceUsers])
  const actingClassroom = useMemo(() => workspaceClassrooms.find((classroom) => classroom.id === actingClassroomId) ?? null, [actingClassroomId, workspaceClassrooms])
  const displayRegularLessons = useMemo(() => {
    const templateRows = buildRegularLessonsFromTemplate({
      template: classroomSettings.regularLessonTemplate,
      teachers,
      students,
    })
    return templateRows.length > 0 ? templateRows : regularLessons
  }, [classroomSettings.regularLessonTemplate, regularLessons, students, teachers])
  const isCurrentClassroomTemporarilySuspended = Boolean(actingClassroom?.isTemporarilySuspended)
  const isCurrentClassroomCancelled = actingClassroom?.contractStatus === 'suspended'
  const isCurrentClassroomSuspended = isCurrentClassroomCancelled || isCurrentClassroomTemporarilySuspended
  const areAllContractedClassroomsTemporarilySuspended = useMemo(() => {
    const contractedClassrooms = workspaceClassrooms.filter((classroom) => classroom.contractStatus === 'active')
    if (contractedClassrooms.length === 0) return false
    return contractedClassrooms.every((classroom) => classroom.isTemporarilySuspended)
  }, [workspaceClassrooms])

  const buildWorkspaceSnapshot = useCallback((savedAt: string): WorkspaceSnapshot => ({
    schemaVersion: 1,
    savedAt,
    developerCloudBackupEnabled,
    developerCloudBackupFolderName,
    developerCloudSyncedAutoBackupKeys,
    currentUserId,
    actingClassroomId,
    users: workspaceUsers,
    classrooms: workspaceClassrooms.map((classroom) => {
      if (classroom.id !== actingClassroomId) return classroom
      return {
        ...classroom,
        data: buildClassroomSnapshotPayload({
          screen: screen === 'developer' ? 'board' : screen,
          classroomSettings,
          managers,
          teachers,
          students,
          regularLessons,
          groupLessons,
          specialSessions,
          autoAssignRules,
          pairConstraints,
          boardState,
        }),
      }
    }),
  }), [actingClassroomId, autoAssignRules, boardState, classroomSettings, currentUserId, developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudSyncedAutoBackupKeys, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers, workspaceClassrooms, workspaceUsers])

  const blazeFreeTierEstimate = useMemo<BlazeFreeTierEstimate | null>(() => {
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    const currentClassroomCount = snapshot.classrooms.length
    const currentWorkspaceDailyBytes = measureUtf8Bytes(serializeWorkspaceSnapshot(snapshot))
    if (currentClassroomCount === 0) {
      return {
        currentClassroomCount: 0,
        currentWorkspaceDailyBytes,
        currentWorkspaceRetentionBytes: 0,
        currentWorkspaceUsageRate: 0,
        currentWorkspaceMaxRetentionDays: 0,
        estimatedAverageClassroomBytes: 0,
        estimatedReferenceDailyBytes: 0,
        estimatedReferenceRetentionBytes: 0,
        estimatedReferenceUsageRate: 0,
        estimatedReferenceMaxRetentionDays: 0,
        referenceClassroomCount: BLAZE_STORAGE_REFERENCE_CLASSROOM_COUNT,
        retentionDays: SERVER_AUTO_BACKUP_RETENTION_DAYS,
        freeTierStorageBytes: BLAZE_STORAGE_FREE_TIER_BYTES,
      }
    }

    const developerUsers = snapshot.users.filter((user) => user.role === 'developer')
    const fixedSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      currentUserId: developerUsers.some((user) => user.id === snapshot.currentUserId)
        ? snapshot.currentUserId
        : (developerUsers[0]?.id ?? ''),
      actingClassroomId: null,
      classrooms: [],
      users: developerUsers,
    }
    const fixedSnapshotBytes = measureUtf8Bytes(serializeWorkspaceSnapshot(fixedSnapshot))
    const classroomManagerUsers = snapshot.classrooms.flatMap((classroom) => {
      const manager = snapshot.users.find((user) => user.role === 'manager' && user.id === classroom.managerUserId)
      return manager ? [manager] : []
    })
    const totalClassroomBytes = snapshot.classrooms.reduce((sum, classroom) => sum + measureJsonBytes(classroom), 0)
    const totalManagerBytes = classroomManagerUsers.reduce((sum, user) => sum + measureJsonBytes(user), 0)
    const estimatedAverageClassroomBytes = Math.max(1, Math.round((totalClassroomBytes + totalManagerBytes) / currentClassroomCount))
    const estimateDailyBytes = (classroomCount: number) => fixedSnapshotBytes + estimatedAverageClassroomBytes * Math.max(0, classroomCount)

    const currentWorkspaceRetentionBytes = currentWorkspaceDailyBytes * SERVER_AUTO_BACKUP_RETENTION_DAYS
    const estimatedReferenceDailyBytes = estimateDailyBytes(BLAZE_STORAGE_REFERENCE_CLASSROOM_COUNT)
    const estimatedReferenceRetentionBytes = estimatedReferenceDailyBytes * SERVER_AUTO_BACKUP_RETENTION_DAYS

    return {
      currentClassroomCount,
      currentWorkspaceDailyBytes,
      currentWorkspaceRetentionBytes,
      currentWorkspaceUsageRate: currentWorkspaceRetentionBytes / BLAZE_STORAGE_FREE_TIER_BYTES * 100,
      currentWorkspaceMaxRetentionDays: Math.floor(BLAZE_STORAGE_FREE_TIER_BYTES / currentWorkspaceDailyBytes),
      estimatedAverageClassroomBytes,
      estimatedReferenceDailyBytes,
      estimatedReferenceRetentionBytes,
      estimatedReferenceUsageRate: estimatedReferenceRetentionBytes / BLAZE_STORAGE_FREE_TIER_BYTES * 100,
      estimatedReferenceMaxRetentionDays: Math.floor(BLAZE_STORAGE_FREE_TIER_BYTES / estimatedReferenceDailyBytes),
      referenceClassroomCount: BLAZE_STORAGE_REFERENCE_CLASSROOM_COUNT,
      retentionDays: SERVER_AUTO_BACKUP_RETENTION_DAYS,
      freeTierStorageBytes: BLAZE_STORAGE_FREE_TIER_BYTES,
    }
  }, [buildWorkspaceSnapshot])

  const queueRemoteWorkspaceClassroomUpdate = useCallback((params: {
    classroomId: string
    classroomName: string
    managerName: string
    managerEmail: string
    contractStatus: WorkspaceClassroom['contractStatus']
    contractStartDate: string
    contractEndDate: string
  }) => {
    if (!isRemoteBackendEnabled) return
    if (!isRemoteAdminAutomationEnabled) return
    if (!params.classroomName.trim() || !params.managerName.trim()) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.managerEmail.trim())) return

    const existingTimeoutId = remoteClassroomUpdateTimeoutsRef.current[params.classroomId]
    if (typeof existingTimeoutId === 'number') {
      window.clearTimeout(existingTimeoutId)
    }

    remoteClassroomUpdateTimeoutsRef.current[params.classroomId] = window.setTimeout(() => {
      void updateFirebaseWorkspaceClassroom({
        classroomId: params.classroomId,
        classroomName: params.classroomName,
        managerName: params.managerName,
        managerEmail: params.managerEmail,
        contractStatus: params.contractStatus,
        contractStartDate: params.contractStartDate,
        contractEndDate: params.contractEndDate,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Firebase への教室情報同期に失敗しました。'
        setPersistenceMessage(message)
      }).finally(() => {
        delete remoteClassroomUpdateTimeoutsRef.current[params.classroomId]
      })
    }, 700)
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled])

  const applySnapshot = useCallback((snapshot: AppSnapshot, successMessage: string) => {
    const sanitizedSnapshot = sanitizeAppSnapshot(snapshot)
    setScreen(sanitizedSnapshot.screen)
    setManagers(sanitizedSnapshot.managers)
    setTeachers(sanitizedSnapshot.teachers)
    setStudents(sanitizedSnapshot.students)
    setRegularLessons(sanitizedSnapshot.regularLessons)
    setGroupLessons(sanitizedSnapshot.groupLessons)
    setSpecialSessions(sanitizedSnapshot.specialSessions)
    setAutoAssignRules(sanitizedSnapshot.autoAssignRules)
    setPairConstraints(sanitizedSnapshot.pairConstraints)
    setClassroomSettings(sanitizedSnapshot.classroomSettings)
    setBoardState(sanitizedSnapshot.boardState)
    setLastSavedAt(sanitizedSnapshot.savedAt)
    setPersistenceMessage(successMessage)
  }, [])

  const syncCurrentClassroomData = useCallback((targetClassroomId: string | null) => {
    if (!targetClassroomId) return

    setWorkspaceClassrooms((current) => current.map((classroom) => {
      if (classroom.id !== targetClassroomId) return classroom

      return {
        ...classroom,
        data: buildClassroomSnapshotPayload({
          screen: screen === 'developer' ? 'board' : screen,
          classroomSettings,
          managers,
          teachers,
          students,
          regularLessons,
          groupLessons,
          specialSessions,
          autoAssignRules,
          pairConstraints,
          boardState,
        }),
      }
    }))
  }, [autoAssignRules, boardState, classroomSettings, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers])

  const saveUndoSnapshot = useCallback((label: string) => {
    setUndoSnapshot({
      label,
      data: buildClassroomSnapshotPayload({
        screen: screen === 'developer' ? 'board' : screen,
        classroomSettings,
        managers,
        teachers,
        students,
        regularLessons,
        groupLessons,
        specialSessions,
        autoAssignRules,
        pairConstraints,
        boardState,
      }),
    })
  }, [autoAssignRules, boardState, classroomSettings, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers])

  const restoreUndoSnapshot = useCallback(() => {
    if (!undoSnapshot) return
    applyClassroomPayloadToState(undoSnapshot.data, {
      setScreen: (value) => setScreen(value),
      setManagers,
      setTeachers,
      setStudents,
      setRegularLessons,
      setGroupLessons,
      setSpecialSessions,
      setAutoAssignRules,
      setPairConstraints,
      setClassroomSettings,
      setBoardState,
    })
    setPersistenceMessage(`「${undoSnapshot.label}」の実行前の状態に戻しました。`)
    setUndoSnapshot(null)
  }, [undoSnapshot])

  const dismissUndoSnapshot = useCallback(() => {
    setUndoSnapshot(null)
  }, [])

  const navigateClassroomScreen = useCallback((nextScreen: ClassroomScreen) => {
    syncCurrentClassroomData(actingClassroomId)
    setScreen(nextScreen)
  }, [actingClassroomId, syncCurrentClassroomData])

  const openClassroom = useCallback((classroomId: string, nextScreen?: AppScreen) => {
    syncCurrentClassroomData(actingClassroomId)
    const nextClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
    if (!nextClassroom) return

    setActingClassroomId(classroomId)
    applyClassroomPayloadToState(nextClassroom.data, {
      setScreen: (value) => setScreen(nextScreen ?? value),
      setManagers,
      setTeachers,
      setStudents,
      setRegularLessons,
      setGroupLessons,
      setSpecialSessions,
      setAutoAssignRules,
      setPairConstraints,
      setClassroomSettings,
      setBoardState,
    })
  }, [actingClassroomId, syncCurrentClassroomData, workspaceClassrooms])

  const applyWorkspaceSnapshot = useCallback((workspaceSnapshot: WorkspaceSnapshot, successMessage: string) => {
    const sanitizedWorkspaceSnapshot = sanitizeWorkspaceSnapshot(workspaceSnapshot)
    setWorkspaceUsers(sanitizedWorkspaceSnapshot.users)
    setWorkspaceClassrooms(sanitizedWorkspaceSnapshot.classrooms)
    setDeveloperCloudBackupEnabled(sanitizedWorkspaceSnapshot.developerCloudBackupEnabled ?? false)
    setDeveloperCloudBackupFolderName(sanitizedWorkspaceSnapshot.developerCloudBackupFolderName ?? '')
    setDeveloperCloudSyncedAutoBackupKeys(sanitizedWorkspaceSnapshot.developerCloudSyncedAutoBackupKeys ?? [])
    setCurrentUserId(sanitizedWorkspaceSnapshot.currentUserId)
    setActingClassroomId(sanitizedWorkspaceSnapshot.actingClassroomId)
    setLastSavedAt(sanitizedWorkspaceSnapshot.savedAt)
    setPersistenceMessage(successMessage)

    const currentWorkspaceUser = sanitizedWorkspaceSnapshot.users.find((user) => user.id === sanitizedWorkspaceSnapshot.currentUserId) ?? null
    const targetClassroomId = currentWorkspaceUser?.role === 'manager'
      ? currentWorkspaceUser.assignedClassroomId
      : sanitizedWorkspaceSnapshot.actingClassroomId
    const targetClassroom = sanitizedWorkspaceSnapshot.classrooms.find((classroom) => classroom.id === targetClassroomId) ?? sanitizedWorkspaceSnapshot.classrooms[0] ?? null

    if (targetClassroom) {
      applyClassroomPayloadToState(targetClassroom.data, {
        setScreen: (value) => setScreen(currentWorkspaceUser?.role === 'developer' ? 'developer' : value),
        setManagers,
        setTeachers,
        setStudents,
        setRegularLessons,
        setGroupLessons,
        setSpecialSessions,
        setAutoAssignRules,
        setPairConstraints,
        setClassroomSettings,
        setBoardState,
      })
    } else {
      setScreen(currentWorkspaceUser?.role === 'developer' ? 'developer' : 'board')
    }
  }, [])

  const reloadRemoteWorkspace = useCallback(async (successMessage: string, preferredActingClassroomId?: string | null) => {
    if (!remoteSessionUserId) return

    const [remoteSnapshot, localWorkspaceSnapshot] = await Promise.all([
      loadFirebaseWorkspaceSnapshot({
        authenticatedUserId: remoteSessionUserId,
        createEmptyClassroomPayload: buildEmptyClassroomPayload,
      }),
      loadWorkspaceSnapshot().catch(() => null),
    ])

    const mergedSnapshot = mergeWorkspaceWithLocalPreferences(remoteSnapshot, localWorkspaceSnapshot)
    const nextActingClassroomId = preferredActingClassroomId ?? actingClassroomId
    if (nextActingClassroomId && mergedSnapshot.classrooms.some((classroom) => classroom.id === nextActingClassroomId)) {
      mergedSnapshot.actingClassroomId = nextActingClassroomId
    }

    applyWorkspaceSnapshot(mergedSnapshot, successMessage)
    setRemoteAuthMessage('')
  }, [actingClassroomId, applyWorkspaceSnapshot, remoteSessionUserId])

  const addClassroom = useCallback((input?: AddClassroomOptions) => {
    if (isRemoteBackendEnabled) {
      const firebaseUser = getFirebaseCurrentUser()
      if (!firebaseUser || (remoteSessionUserId && firebaseUser.uid !== remoteSessionUserId)) {
        const message = 'Firebase のログイン状態を確認できません。再ログイン後にもう一度教室追加を実行してください。'
        setPersistenceMessage(message)
        window.alert(message)
        return
      }

      const classroomName = input?.classroomName?.trim() ?? window.prompt('追加する教室名を入力してください。', `新規教室 ${workspaceClassrooms.length + 1}`)?.trim() ?? ''
      if (!classroomName) {
        setPersistenceMessage('教室追加をキャンセルしました。')
        return
      }

      const managerName = input?.managerName?.trim() ?? window.prompt('管理者名を入力してください。', `教室管理者 ${workspaceClassrooms.length + 1}`)?.trim() ?? ''
      if (!managerName) {
        setPersistenceMessage('教室追加をキャンセルしました。')
        return
      }

      const managerEmail = input?.managerEmail?.trim() ?? window.prompt('管理者メールアドレスを入力してください。', '')?.trim() ?? ''

      const contractStartDate = input?.contractStartDate?.trim() || getTodayDateValue()
      const contractEndDate = input?.contractEndDate?.trim() || ''

      const managerPassword = input?.managerPassword?.trim() ?? ''

      if (!isRemoteAdminAutomationEnabled) {
        const managerUserId = input?.managerUserId?.trim() ?? ''

        if (managerUserId) {
          void provisionFirebaseWorkspaceClassroomWithExistingUid({
            classroomName,
            managerName,
            managerEmail,
            managerUserId,
            contractStartDate,
            contractEndDate,
            initialPayload: buildEmptyClassroomPayload(),
          }).then(async (result) => {
            await reloadRemoteWorkspace('教室を追加しました。', result.classroomId)
          }).catch((error) => {
            const message = error instanceof Error ? error.message : '教室追加に失敗しました。'
            setPersistenceMessage(message)
          })
          return
        }

        const temporaryPassword = managerPassword || ('Koma' + Math.random().toString(36).slice(2, 8) + '!')
        setPersistenceMessage('管理者アカウントを作成しています…')

        void (async () => {
          try {
            const createdUid = await createFirebaseAuthUser(managerEmail, temporaryPassword)
            const result = await provisionFirebaseWorkspaceClassroomWithExistingUid({
              classroomName,
              managerName,
              managerEmail,
              managerUserId: createdUid,
              contractStartDate,
              contractEndDate,
              initialPayload: buildEmptyClassroomPayload(),
            })
            await reloadRemoteWorkspace('教室を追加しました。管理者アカウントを発行しました。', result.classroomId)
            window.alert([
              `${classroomName} を追加しました。`,
              `管理者メール: ${managerEmail}`,
              `初期パスワード: ${temporaryPassword}`,
              '初回ログイン後に管理者自身で変更してください。',
            ].join('\n'))
          } catch (error) {
            const message = error instanceof Error ? error.message : '教室追加に失敗しました。'
            setPersistenceMessage(message)
          }
        })()
        return
      }

      setPersistenceMessage('教室を追加しています…')

      void provisionFirebaseWorkspaceClassroom({
        classroomName,
        managerName,
        managerEmail,
        managerPassword: managerPassword || undefined,
        contractStartDate,
        contractEndDate,
        initialPayload: buildEmptyClassroomPayload(),
      }).then(async (result) => {
        await reloadRemoteWorkspace('教室を追加しました。管理者アカウントを Firebase Auth に発行しました。', result.classroomId)
        window.alert([
          `${classroomName} を追加しました。`,
          `管理者メール: ${managerEmail}`,
          `初期パスワード: ${result.temporaryPassword}`,
          '初回ログイン後に管理者自身で変更してください。',
        ].join('\n'))
      }).catch((error) => {
        const message = error instanceof Error ? error.message : '教室追加に失敗しました。'
        setPersistenceMessage(message)
        window.alert('教室追加に失敗しました: ' + message)
      })
      return
    }

    const classroomId = createDraftId('classroom')
    const managerId = createDraftId('manager')
    const nextClassroom: WorkspaceClassroom = {
      id: classroomId,
      name: `新規教室 ${workspaceClassrooms.length + 1}`,
      contractStatus: 'active',
      contractStartDate: getTodayDateValue(),
      contractEndDate: '',
      managerUserId: managerId,
      isTemporarilySuspended: false,
      temporarySuspensionReason: '',
      data: buildEmptyClassroomPayload(),
    }
    const nextManager: WorkspaceUser = {
      id: managerId,
      name: `教室管理者 ${workspaceClassrooms.length + 1}`,
      email: `${classroomId}@example.local`,
      role: 'manager',
      assignedClassroomId: classroomId,
    }
    setWorkspaceUsers((current) => [...current, nextManager])
    setWorkspaceClassrooms((current) => [...current, nextClassroom])
    setPersistenceMessage('教室を追加しました。管理者アカウントと契約状態を確認してください。')
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, reloadRemoteWorkspace, remoteSessionUserId, workspaceClassrooms.length])

  const updateClassroom = useCallback((classroomId: string, updates: {
    name?: string
    contractStatus?: WorkspaceClassroom['contractStatus']
    contractStartDate?: string
    contractEndDate?: string
    managerName?: string
    managerEmail?: string
    studentUnitPrice?: number
  }) => {
    const targetClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
    if (!targetClassroom) return
    const currentManager = workspaceUsers.find((user) => user.id === targetClassroom.managerUserId)
    if (!currentManager) return
    if (isRemoteBackendEnabled && !isRemoteAdminAutomationEnabled && typeof updates.managerEmail === 'string' && updates.managerEmail !== currentManager.email) {
      setPersistenceMessage('Spark 構成では管理者メールをアプリから変更できません。Firebase Auth と Firestore members を Console 側で更新してください。')
      return
    }

    const nextClassroom: WorkspaceClassroom = {
      ...targetClassroom,
      name: updates.name ?? targetClassroom.name,
      contractStatus: updates.contractStatus ?? targetClassroom.contractStatus,
      contractStartDate: updates.contractStartDate ?? targetClassroom.contractStartDate,
      contractEndDate: updates.contractEndDate ?? targetClassroom.contractEndDate,
      isTemporarilySuspended: (updates.contractStatus ?? targetClassroom.contractStatus) === 'suspended' ? false : targetClassroom.isTemporarilySuspended,
      temporarySuspensionReason: (updates.contractStatus ?? targetClassroom.contractStatus) === 'suspended' ? '' : targetClassroom.temporarySuspensionReason,
      studentUnitPrice: updates.studentUnitPrice ?? targetClassroom.studentUnitPrice,
    }
    const nextManager: WorkspaceUser = {
      ...currentManager,
      name: updates.managerName ?? currentManager.name,
      email: updates.managerEmail ?? currentManager.email,
    }

    setWorkspaceClassrooms((current) => current.map((classroom) => {
      if (classroom.id !== classroomId) return classroom
      return nextClassroom
    }))
    setWorkspaceUsers((current) => current.map((user) => {
      if (user.id !== targetClassroom.managerUserId) return user
      return nextManager
    }))

    if (isRemoteBackendEnabled) {
      queueRemoteWorkspaceClassroomUpdate({
        classroomId,
        classroomName: nextClassroom.name,
        managerName: nextManager.name,
        managerEmail: nextManager.email,
        contractStatus: nextClassroom.contractStatus,
        contractStartDate: nextClassroom.contractStartDate,
        contractEndDate: nextClassroom.contractEndDate,
      })
    }

    setPersistenceMessage('教室設定を更新しました。')
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, queueRemoteWorkspaceClassroomUpdate, workspaceClassrooms, workspaceUsers])

  const replaceClassroomManagerUid = useCallback((classroomId: string, managerUserId: string, managerEmail: string) => {
    if (!isRemoteBackendEnabled) {
      setPersistenceMessage('管理者 UID の差し替えは Firebase 運用時のみ利用できます。')
      return
    }

    const normalizedManagerUserId = managerUserId.trim()
    const normalizedManagerEmail = managerEmail.trim()
    if (!normalizedManagerUserId) {
      setPersistenceMessage('差し替え先の管理者 UID を入力してください。')
      return
    }
    if (!normalizedManagerEmail) {
      setPersistenceMessage('差し替え先の管理者メールアドレスを入力してください。')
      return
    }

    const targetClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
    if (!targetClassroom) return

    if (normalizedManagerUserId === targetClassroom.managerUserId) {
      setPersistenceMessage('現在と同じ UID のため、差し替えは不要です。')
      return
    }

    const currentManager = workspaceUsers.find((user) => user.id === targetClassroom.managerUserId)
    if (!currentManager) {
      setPersistenceMessage('現在の管理者情報が見つからないため、UID を差し替えできません。')
      return
    }

    const confirmed = window.confirm(`「${targetClassroom.name || 'この教室'}」の管理者 UID を ${normalizedManagerUserId} に差し替えます。続行しますか?`)
    if (!confirmed) {
      setPersistenceMessage('管理者 UID の差し替えをキャンセルしました。')
      return
    }

    void reassignFirebaseWorkspaceClassroomManagerWithExistingUid({
      classroomId,
      managerName: currentManager.name,
      managerEmail: normalizedManagerEmail,
      managerUserId: normalizedManagerUserId,
    }).then(async () => {
      await reloadRemoteWorkspace('管理者 UID を差し替えました。新しい Authentication ユーザーでこの教室へログインできます。', classroomId)
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '管理者 UID の差し替えに失敗しました。'
      setPersistenceMessage(message)
    })
  }, [isRemoteBackendEnabled, reloadRemoteWorkspace, workspaceClassrooms, workspaceUsers])

  const deleteClassroom = useCallback(async (classroomId: string, password: string) => {
    if (isRemoteBackendEnabled) {
      try {
        await reauthenticateFirebaseUser(password)
      } catch {
        setPersistenceMessage('ログインパスワードが一致しないため、教室を削除できませんでした。')
        return
      }

      const targetClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
      if (!targetClassroom) return

      const confirmed = window.confirm(`「${targetClassroom.name || 'この教室'}」を削除します。続行しますか?`)
      if (!confirmed) {
        setPersistenceMessage('教室削除をキャンセルしました。')
        return
      }

      const fallbackClassroomId = actingClassroomId === classroomId
        ? (workspaceClassrooms.find((classroom) => classroom.id !== classroomId)?.id ?? null)
        : actingClassroomId

      try {
        const deleteOperation = isRemoteAdminAutomationEnabled
          ? deleteFirebaseWorkspaceClassroom({ classroomId })
          : deleteFirebaseWorkspaceClassroomDirect({ classroomId })
        await deleteOperation
        await reloadRemoteWorkspace('教室を削除しました。', fallbackClassroomId)
      } catch (error) {
        const message = error instanceof Error ? error.message : '教室削除に失敗しました。'
        setPersistenceMessage(message)
        window.alert('教室削除に失敗しました: ' + message)
      }
      return
    }

    if (workspaceClassrooms.length <= 1) {
      setPersistenceMessage('最後の1教室は削除できません。')
      return
    }

    const targetClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
    if (!targetClassroom) return

    setWorkspaceClassrooms((current) => current.filter((classroom) => classroom.id !== classroomId))
    setWorkspaceUsers((current) => current.filter((user) => user.id !== targetClassroom.managerUserId))
    if (actingClassroomId === classroomId) {
      const fallback = workspaceClassrooms.find((classroom) => classroom.id !== classroomId)
      if (fallback) openClassroom(fallback.id, currentUser?.role === 'developer' ? 'developer' : fallback.data.screen)
    }
    setPersistenceMessage('教室を削除しました。開発者バックアップまたは自動バックアップから復元できます。')
  }, [actingClassroomId, currentUser?.role, isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, openClassroom, reloadRemoteWorkspace, workspaceClassrooms])
  const toggleContractedClassroomsTemporarySuspension = useCallback(() => {
    const contractedClassrooms = workspaceClassrooms.filter((classroom) => classroom.contractStatus === 'active')
    if (contractedClassrooms.length === 0) {
      setPersistenceMessage('契約中の教室がないため、一時利用停止の対象がありません。')
      return
    }

    if (contractedClassrooms.every((classroom) => classroom.isTemporarilySuspended)) {
      setWorkspaceClassrooms((current) => current.map((classroom) => classroom.contractStatus === 'active'
        ? { ...classroom, isTemporarilySuspended: false, temporarySuspensionReason: '' }
        : classroom))
      setPersistenceMessage('契約中教室の一時利用停止を解除しました。')
      return
    }

    const normalizedReason = bulkTemporarySuspensionReason.trim()
    if (!normalizedReason) {
      setPersistenceMessage('一時停止理由を入力してください。')
      return
    }

    setWorkspaceClassrooms((current) => current.map((classroom) => classroom.contractStatus === 'active'
      ? { ...classroom, isTemporarilySuspended: true, temporarySuspensionReason: normalizedReason }
      : classroom))
    setPersistenceMessage('契約中教室を一時利用停止に変更しました。')
  }, [bulkTemporarySuspensionReason, workspaceClassrooms])

  const syncDeveloperCloudAutoBackups = useCallback(async (handleOverride?: DeveloperCloudBackupDirectoryHandle | null, snapshotOverride?: WorkspaceSnapshot) => {
    if (!developerCloudBackupEnabled) return { synced: false, message: '' }

    if (!isDeveloperCloudBackupSupported()) {
      const message = 'このブラウザでは保存フォルダ連携を利用できません。'
      setDeveloperCloudBackupStatus(message)
      return { synced: false, message }
    }

    const targetHandle = handleOverride ?? developerCloudBackupHandle
    if (!targetHandle) {
      const message = '保存フォルダが見つかりません。開発者画面から再接続してください。'
      setDeveloperCloudBackupStatus(message)
      return { synced: false, message }
    }

    const granted = await ensureDeveloperCloudBackupPermission(targetHandle)
    if (!granted) {
      const message = '保存フォルダへの書き込み権限がありません。再設定してください。'
      setDeveloperCloudBackupStatus(message)
      return { synced: false, message }
    }

    const snapshot = snapshotOverride
    if (!snapshot) {
      const folderName = developerCloudBackupFolderName || targetHandle.name
      const message = `${folderName}: 同期するスナップショットがありません。`
      setDeveloperCloudBackupStatus(message)
      return { synced: false, message: '' }
    }

    await syncWorkspaceArtifactsToDeveloperCloudDirectory(snapshot, targetHandle)

    const folderName = developerCloudBackupFolderName || targetHandle.name
    const message = `${folderName} にバックアップを保存しました。`
    setDeveloperCloudBackupStatus(message)
    return { synced: true, message }
  }, [developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupHandle])

  const connectDeveloperCloudBackupFolder = useCallback(async () => {
    if (!isDeveloperCloudBackupSupported()) {
      setDeveloperCloudBackupStatus('このブラウザでは保存フォルダ連携を利用できません。')
      setPersistenceMessage('保存フォルダの設定に失敗しました。対応ブラウザで開いてください。')
      return
    }

    try {
      const handle = await getDeveloperCloudBackupRuntimeWindow().showDirectoryPicker?.({ mode: 'readwrite' })
      if (!handle) {
        setDeveloperCloudBackupStatus('保存フォルダの選択をキャンセルしました。')
        return
      }

      const granted = await ensureDeveloperCloudBackupPermission(handle)
      if (!granted) {
        setDeveloperCloudBackupStatus('保存フォルダへの書き込み権限がありません。')
        setPersistenceMessage('保存フォルダの権限取得に失敗しました。')
        return
      }

      const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
      await syncWorkspaceArtifactsToDeveloperCloudDirectory(snapshot, handle)

      setDeveloperCloudBackupHandle(handle)
      setDeveloperCloudBackupEnabled(true)
      setDeveloperCloudBackupFolderName(handle.name)
      setDeveloperCloudSyncedAutoBackupKeys([])
      const persisted = await saveDeveloperCloudBackupHandle(handle)
      setDeveloperCloudBackupStatus(persisted
        ? `${handle.name} を保存フォルダに設定しました。`
        : `${handle.name} を保存フォルダに設定しました。再起動後は再選択が必要です。`)
      setPersistenceMessage(persisted
        ? '保存フォルダを設定しました。以後はサーバーバックアップ一覧取得時に最新バックアップを同期します。'
        : '保存フォルダを設定しました。今のセッション中は有効ですが、再起動後は再選択が必要です。')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setDeveloperCloudBackupStatus('保存フォルダの選択をキャンセルしました。')
        return
      }
      const message = error instanceof Error ? error.message : '保存フォルダの設定に失敗しました。'
      setDeveloperCloudBackupStatus(`保存フォルダの設定に失敗しました。${message}`)
      setPersistenceMessage(`保存フォルダの設定に失敗しました。${message}`)
    }
  }, [buildWorkspaceSnapshot])

  const disconnectDeveloperCloudBackupFolder = useCallback(async () => {
    setDeveloperCloudBackupEnabled(false)
    setDeveloperCloudBackupFolderName('')
    setDeveloperCloudBackupHandle(null)
    setDeveloperCloudSyncedAutoBackupKeys([])
    setDeveloperCloudBackupStatus('保存フォルダへの自動保存を停止しました。')
    await clearDeveloperCloudBackupHandle()
    setPersistenceMessage('保存フォルダへの自動保存を停止しました。')
  }, [])

  const openDeveloperRestoreModal = useCallback((restoringSnapshot: WorkspaceSnapshot, sourceLabel: string) => {
    const currentSnapshot = buildWorkspaceSnapshot(new Date().toISOString())
    setDeveloperRestoreModalState(buildDeveloperRestoreModalState(currentSnapshot, restoringSnapshot, sourceLabel))
  }, [buildWorkspaceSnapshot])

  const closeDeveloperRestoreModal = useCallback(() => {
    setDeveloperRestoreModalState(null)
  }, [])

  const toggleDeveloperRestoreClassroom = useCallback((classroomId: string) => {
    setDeveloperRestoreModalState((current) => {
      if (!current) return current
      return {
        ...current,
        options: current.options.map((option) => option.classroomId === classroomId
          ? { ...option, selected: !option.selected }
          : option),
      }
    })
  }, [])

  const setAllDeveloperRestoreSelections = useCallback((selected: boolean) => {
    setDeveloperRestoreModalState((current) => {
      if (!current) return current
      return {
        ...current,
        options: current.options.map((option) => ({ ...option, selected })),
      }
    })
  }, [])

  const confirmDeveloperRestoreModal = useCallback(() => {
    if (!developerRestoreModalState) return
    const restoreByClassroomId = new Map(developerRestoreModalState.options.map((option) => [option.classroomId, option.selected]))
    const mergeResult = buildWorkspaceSnapshotMergeFromSelection(
      developerRestoreModalState.currentSnapshot,
      developerRestoreModalState.restoringSnapshot,
      restoreByClassroomId,
    )
    if (mergeResult.restoredCount === 0) {
      setPersistenceMessage('復元対象の教室が選択されなかったため、現在の状態を維持しました。')
      setDeveloperRestoreModalState(null)
      return
    }
    saveUndoSnapshot('開発者バックアップ復元')
    applyWorkspaceSnapshot(mergeResult.snapshot, `選択した教室だけ${developerRestoreModalState.sourceLabel}から復元しました。`)
    setDeveloperRestoreModalState(null)
  }, [applyWorkspaceSnapshot, developerRestoreModalState, saveUndoSnapshot])

  const loginAsUser = useCallback((userId: string) => {
    syncCurrentClassroomData(actingClassroomId)
    const nextUser = workspaceUsers.find((user) => user.id === userId)
    if (!nextUser) return

    setCurrentUserId(userId)
    if (nextUser.role === 'developer') {
      setScreen('developer')
      return
    }

    const classroomId = nextUser.assignedClassroomId
    if (classroomId) openClassroom(classroomId)
  }, [actingClassroomId, openClassroom, syncCurrentClassroomData, workspaceUsers])

  const submitRemoteLogin = useCallback(async () => {
    const normalizedEmail = remoteLoginEmail.trim()
    if (!normalizedEmail || !remoteLoginPassword) {
      setRemoteAuthMessage('メールアドレスとパスワードを入力してください。')
      return
    }

    setIsRemoteLoginSubmitting(true)
    setRemoteAuthMessage('')

    try {
      await signInToFirebaseWithPassword(normalizedEmail, remoteLoginPassword)
      setPersistenceMessage('Firebase へログインしました。ワークスペースを読み込みます。')
      setRemoteLoginPassword('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Firebase ログインに失敗しました。'
      setRemoteAuthMessage(message)
    } finally {
      setIsRemoteLoginSubmitting(false)
    }
  }, [remoteLoginEmail, remoteLoginPassword])

  const submitPasswordReset = useCallback(async () => {
    const normalizedEmail = remoteLoginEmail.trim()
    if (!normalizedEmail) {
      setRemoteAuthMessage('パスワードリセット用のメールアドレスを入力してください。')
      return
    }
    try {
      await sendFirebasePasswordResetEmail(normalizedEmail)
      setRemoteAuthMessage(`${normalizedEmail} にパスワードリセットメールを送信しました。メール内のリンクから再設定してください。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'パスワードリセットメールの送信に失敗しました。'
      setRemoteAuthMessage(message)
    }
  }, [remoteLoginEmail])

  const logout = useCallback(() => {
    syncCurrentClassroomData(actingClassroomId)

    // Flush save synchronously before clearing state
    if (isSnapshotPersistenceRuntimeEnabled()) {
      const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
      void saveWorkspaceSnapshot(snapshot)

      // Sync to Firebase before signing out so the remote snapshot is up to date
      if (isRemoteBackendEnabled && remoteSessionUserId) {
        void saveFirebaseWorkspaceSnapshot(snapshot, remoteSessionUserId)
          .catch(() => {})
          .finally(() => {
            void signOutFromFirebase()
              .then(() => {
                setCurrentUserId('')
                setScreen('board')
                setPersistenceMessage('Firebase からログアウトしました。')
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : 'ログアウトに失敗しました。'
                setPersistenceMessage(message)
              })
          })
        return
      }
    }

    if (isRemoteBackendEnabled) {
      void signOutFromFirebase()
        .then(() => {
          setCurrentUserId('')
          setScreen('board')
          setPersistenceMessage('Firebase からログアウトしました。')
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'ログアウトに失敗しました。'
          setPersistenceMessage(message)
        })
      return
    }

    setCurrentUserId('')
    setScreen('board')
    setPersistenceMessage('ログアウトしました。')
  }, [actingClassroomId, buildWorkspaceSnapshot, isRemoteBackendEnabled, remoteSessionUserId, syncCurrentClassroomData])

  const hasAnyExistingSetupData = useCallback(() => (
    managers.length > 0
    || teachers.length > 0
    || students.length > 0
    || regularLessons.length > 0
    || hasRegularLessonTemplateAssignments(classroomSettings.regularLessonTemplate)
    || groupLessons.length > 0
    || specialSessions.some((session) => Object.keys(session.studentInputs).length > 0 || Object.keys(session.teacherInputs).length > 0)
    || autoAssignRules.some((rule) => rule.targets.length > 0 || rule.excludeTargets.length > 0)
    || pairConstraints.length > 0
    || boardState !== null
    || (classroomSettings.initialSetupMakeupStocks?.length ?? 0) > 0
    || (classroomSettings.initialSetupLectureStocks?.length ?? 0) > 0
  ), [autoAssignRules, boardState, classroomSettings.initialSetupLectureStocks, classroomSettings.initialSetupMakeupStocks, classroomSettings.regularLessonTemplate, groupLessons.length, managers.length, pairConstraints.length, regularLessons.length, specialSessions, students.length, teachers.length])

  const ensureScheduleSubmissionTokens = useCallback(async (scheduleStartDate: string, scheduleEndDate: string) => {
    const config = getFirebaseBackendConfig()
    if (!config.enabled || !actingClassroomId) return

    const overlapping = specialSessions.filter((s) => s.startDate <= scheduleEndDate && s.endDate >= scheduleStartDate)
    if (overlapping.length !== 1) return

    const session = overlapping[0]
    const activeStudents = students.filter((s) => !s.isHidden && s.entryDate <= session.endDate && (!s.withdrawDate || s.withdrawDate === '未定' || s.withdrawDate >= session.startDate))
    const activeTeachers = teachers.filter((t) => !t.isHidden && t.entryDate <= session.endDate && (!t.withdrawDate || t.withdrawDate === '未定' || t.withdrawDate >= session.startDate))

    const allStudentsHaveTokens = activeStudents.every((s) => session.studentInputs[s.id]?.submissionToken)
    const allTeachersHaveTokens = activeTeachers.every((t) => session.teacherInputs[t.id]?.submissionToken)
    if (allStudentsHaveTokens && allTeachersHaveTokens) return

    // Build occupied slots from board cells
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const sessionCells = buildScheduleCellsForRange({
      range: { startDate: session.startDate, endDate: session.endDate, periodValue: '' },
      fallbackStartDate: session.startDate,
      fallbackEndDate: session.endDate,
      classroomSettings,
      teachers,
      students,
      regularLessons: displayRegularLessons,
      boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
    })
    const lessonTypeLabels: Record<string, string> = { regular: '通常', makeup: '振替', special: '講習' }
    const studentOccupiedMap = new Map<string, Record<string, string>>()
    const teacherOccupiedMap = new Map<string, Record<string, string>>()
    for (const cell of sessionCells) {
      const slotKey = `${cell.dateKey}_${cell.slotNumber}`
      for (const desk of cell.desks) {
        if (!desk.lesson) continue
        const teacherName = desk.teacher
        const matchedTeacher = activeTeachers.find((t) => getTeacherDisplayName(t) === teacherName)
        if (matchedTeacher) {
          if (!teacherOccupiedMap.has(matchedTeacher.id)) teacherOccupiedMap.set(matchedTeacher.id, {})
          const existing = teacherOccupiedMap.get(matchedTeacher.id)!
          if (!existing[slotKey]) existing[slotKey] = lessonTypeLabels[desk.lesson.studentSlots[0]?.lessonType ?? ''] ?? ''
        }
        for (const studentSlot of desk.lesson.studentSlots) {
          if (!studentSlot) continue
          const studentId = studentSlot.managedStudentId ?? studentSlot.id
          if (!studentOccupiedMap.has(studentId)) studentOccupiedMap.set(studentId, {})
          const existing = studentOccupiedMap.get(studentId)!
          if (!existing[slotKey]) existing[slotKey] = lessonTypeLabels[studentSlot.lessonType] ?? ''
        }
      }
    }

    const referenceDate = session.startDate
    const studentsWithSubjects = activeStudents.map((s) => ({
      id: s.id,
      name: getStudentDisplayName(s),
      availableSubjects: getSelectableStudentSubjectsForGrade(resolveCurrentStudentGradeLabel(s, referenceDate)),
      occupiedSlots: studentOccupiedMap.get(s.id) ?? {},
    }))
    const teacherList = activeTeachers.map((t) => ({ id: t.id, name: getTeacherDisplayName(t), occupiedSlots: teacherOccupiedMap.get(t.id) ?? {} }))

    const { updatedSession, newTokens } = await ensureSubmissionTokens(session, studentsWithSubjects, teacherList, classroomSettings)
    if (newTokens.length === 0) return

    await writeSubmissionDocs(newTokens, actingClassroomId)
    setSpecialSessions((current) => current.map((s) => s.id === updatedSession.id ? updatedSession : s))
  }, [actingClassroomId, boardState?.suppressedRegularLessonOccurrences, classroomSettings, displayRegularLessons, specialSessions, students, teachers])

  const syncStudentSchedulePopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const studentPopup = runtimeWindow.__lessonScheduleStudentWindow
    if (!studentPopup || studentPopup.closed) return

    const range = buildNormalizedScheduleRange('student', studentScheduleRange)

    syncStudentScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      plannedCells: buildManagedScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      students,
      regularLessons: displayRegularLessons,
      scheduleCountAdjustments: boardState?.scheduleCountAdjustments ?? [],
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      targetWindow: studentPopup,
    })
  }, [boardState?.scheduleCountAdjustments, boardState?.suppressedRegularLessonOccurrences, classroomSettings, displayRegularLessons, specialSessions, studentScheduleRange, students, teachers])

  const syncTeacherSchedulePopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const teacherPopup = runtimeWindow.__lessonScheduleTeacherWindow
    if (!teacherPopup || teacherPopup.closed) return

    const range = buildNormalizedScheduleRange('teacher', teacherScheduleRange)

    syncTeacherScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      plannedCells: buildManagedScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      teachers,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      targetWindow: teacherPopup,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, displayRegularLessons, specialSessions, students, teacherScheduleRange, teachers])

  const syncSpecialSessionPopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const popupWindow = runtimeWindow.__lessonScheduleSpecialSessionWindow
    const sessionId = runtimeWindow.__lessonScheduleSpecialSessionId
    if (!popupWindow || popupWindow.closed || !sessionId) return

    const session = specialSessions.find((row) => row.id === sessionId)
    if (!session) return

    syncSpecialSessionAvailabilityHtml({
      session,
      allSessions: specialSessions,
      classroomSettings,
      teachers,
      students,
      scheduleCells: buildScheduleCellsForRange({
        range: {
          startDate: session.startDate,
          endDate: session.endDate,
          periodValue: '',
        },
        fallbackStartDate: session.startDate,
        fallbackEndDate: session.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      targetWindow: popupWindow,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, displayRegularLessons, specialSessions, students, teachers])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {
      const message = event.data
      if (!message) return

      if (message.type === 'schedule-refresh-request') {
        if (message.viewType === 'student') syncStudentSchedulePopup()
        if (message.viewType === 'teacher') syncTeacherSchedulePopup()
        return
      }

      if (message.type === 'schedule-popup-ready') {
        if (message.viewType === 'student') {
          const range = buildNormalizedScheduleRange('student', studentScheduleRange)
          ensureScheduleSubmissionTokens(range.startDate, range.endDate).catch(() => { /* ignore */ })
          syncStudentSchedulePopup()
        }
        if (message.viewType === 'teacher') {
          const range = buildNormalizedScheduleRange('teacher', teacherScheduleRange)
          ensureScheduleSubmissionTokens(range.startDate, range.endDate).catch(() => { /* ignore */ })
          syncTeacherSchedulePopup()
        }
        return
      }

      if (message.type === 'schedule-submission-reset') {
        const personType = message.personType
        const personId = message.personId
        if (!personId || typeof personId !== 'string') return
        if (personType !== 'teacher' && personType !== 'student') return
        const updatedAt = new Date().toISOString()
        setSpecialSessions((current) => current.map((session) => {
          if (personType === 'teacher') {
            const input = session.teacherInputs[personId]
            if (!input?.countSubmitted) return session
            return {
              ...session,
              teacherInputs: {
                ...session.teacherInputs,
                [personId]: {
                  ...input,
                  countSubmitted: false,
                  unavailableSlots: [],
                  updatedAt,
                },
              },
              updatedAt,
            }
          }
          const input = session.studentInputs[personId]
          if (!input?.countSubmitted) return session
          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [personId]: {
                ...input,
                countSubmitted: false,
                unavailableSlots: [],
                subjectSlots: {},
                regularOnly: false,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        // Also reset the Firestore submission document and trigger board unassign
        for (const session of specialSessions) {
          const input = personType === 'teacher' ? session.teacherInputs[personId] : session.studentInputs[personId]
          if (input?.submissionToken) {
            recentlyResetSubmissionTokensRef.current.add(input.submissionToken)
            resetLectureSubmissionDoc(input.submissionToken).then(() => {
              recentlyResetSubmissionTokensRef.current.delete(input.submissionToken!)
            }).catch(() => {
              recentlyResetSubmissionTokensRef.current.delete(input.submissionToken!)
            })
          }
          if (input?.countSubmitted && personType === 'teacher') {
            teacherAutoAssignRequestIdRef.current += 1
            setTeacherAutoAssignRequest({
              requestId: teacherAutoAssignRequestIdRef.current,
              sessionId: session.id,
              teacherId: personId,
              mode: 'unassign',
            })
          }
          if (input?.countSubmitted && personType === 'student') {
            studentScheduleRequestIdRef.current += 1
            setStudentScheduleRequest({
              requestId: studentScheduleRequestIdRef.current,
              sessionId: session.id,
              studentId: personId,
              mode: 'unassign',
            })
          }
        }
        return
      }

      if (message.type === 'special-session-availability-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (message.personType !== 'teacher' && message.personType !== 'student') return
        const unavailableSlotCandidates = message.unavailableSlots
        if (!Array.isArray(unavailableSlotCandidates) || unavailableSlotCandidates.some((value: unknown) => typeof value !== 'string')) return
        const regularOnly = message.personType === 'student' ? Boolean(message.regularOnly) : false
        const subjectSlotCandidates = message.personType === 'student' && message.subjectSlots && typeof message.subjectSlots === 'object'
          ? message.subjectSlots as Record<string, unknown>
          : {}
        const subjectSlots = Object.entries(subjectSlotCandidates).reduce<Record<string, number>>((accumulator, [subject, value]) => {
          const normalizedValue = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(normalizedValue)) return accumulator

          const count = Math.max(0, Math.trunc(normalizedValue))
          if (count > 0) accumulator[subject] = count
          return accumulator
        }, {})

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(unavailableSlotCandidates as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          if (message.personType === 'teacher') {
            return {
              ...session,
              teacherInputs: {
                ...session.teacherInputs,
                [message.personId]: {
                  unavailableSlots,
                  countSubmitted: Boolean(session.teacherInputs[message.personId]?.countSubmitted),
                  submissionToken: session.teacherInputs[message.personId]?.submissionToken,
                  updatedAt,
                },
              },
              updatedAt,
            }
          }

          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots,
                regularBreakSlots: session.studentInputs[message.personId]?.regularBreakSlots ?? [],
                subjectSlots: regularOnly ? {} : subjectSlots,
                regularOnly,
                countSubmitted: Boolean(session.studentInputs[message.personId]?.countSubmitted),
                submissionToken: session.studentInputs[message.personId]?.submissionToken,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-student-unavailable-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (!Array.isArray(message.unavailableSlots) || message.unavailableSlots.some((value: unknown) => typeof value !== 'string')) return

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(message.unavailableSlots as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.studentInputs[message.personId]
          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots,
                regularBreakSlots: previousInput?.regularBreakSlots ?? [],
                subjectSlots: previousInput?.subjectSlots ?? {},
                regularOnly: Boolean(previousInput?.regularOnly),
                countSubmitted: Boolean(previousInput?.countSubmitted),
                submissionToken: previousInput?.submissionToken,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-student-count-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return

        const rawSubjectSlots = message.subjectSlots && typeof message.subjectSlots === 'object'
          ? message.subjectSlots as Record<string, unknown>
          : {}
        const subjectSlots = Object.entries(rawSubjectSlots).reduce<Record<string, number>>((accumulator, [subject, value]) => {
          const normalizedValue = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(normalizedValue)) return accumulator

          const count = Math.max(0, Math.trunc(normalizedValue))
          if (count > 0) accumulator[subject] = count
          return accumulator
        }, {})

        const updatedAt = new Date().toISOString()
        const regularOnly = Boolean(message.regularOnly)
        const countSubmitted = Boolean(message.countSubmitted)

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.studentInputs[message.personId]
          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots: previousInput?.unavailableSlots ?? [],
                regularBreakSlots: previousInput?.regularBreakSlots ?? [],
                subjectSlots: regularOnly ? {} : subjectSlots,
                regularOnly,
                countSubmitted,
                submissionToken: previousInput?.submissionToken,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))

        if (!countSubmitted) {
          studentScheduleRequestIdRef.current += 1
          setStudentScheduleRequest({
            requestId: studentScheduleRequestIdRef.current,
            sessionId: message.sessionId,
            studentId: message.personId,
            mode: 'unassign',
          })
        }
        return
      }

      if (message.type === 'schedule-teacher-unavailable-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (!Array.isArray(message.unavailableSlots) || message.unavailableSlots.some((value: unknown) => typeof value !== 'string')) return

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(message.unavailableSlots as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.teacherInputs[message.personId]
          return {
            ...session,
            teacherInputs: {
              ...session.teacherInputs,
              [message.personId]: {
                unavailableSlots,
                countSubmitted: Boolean(previousInput?.countSubmitted),
                submissionToken: previousInput?.submissionToken,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-teacher-count-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return

        const updatedAt = new Date().toISOString()
        const countSubmitted = Boolean(message.countSubmitted)

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.teacherInputs[message.personId]
          return {
            ...session,
            teacherInputs: {
              ...session.teacherInputs,
              [message.personId]: {
                unavailableSlots: previousInput?.unavailableSlots ?? [],
                countSubmitted,
                submissionToken: previousInput?.submissionToken,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))

        teacherAutoAssignRequestIdRef.current += 1
        setTeacherAutoAssignRequest({
          requestId: teacherAutoAssignRequestIdRef.current,
          sessionId: message.sessionId,
          teacherId: message.personId,
          mode: countSubmitted ? 'assign' : 'unassign',
        })
        return
      }

      if (message.type === 'special-session-availability-save-students') {
        if (typeof message.sessionId !== 'string') return
        if (!Array.isArray(message.entries)) return

        const normalizedEntries = message.entries.flatMap((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return []

          const rawEntry = entry as {
            personId?: unknown
            unavailableSlots?: unknown
            regularBreakSlots?: unknown
            subjectSlots?: unknown
            regularOnly?: unknown
            countSubmitted?: unknown
          }

          const personId = typeof rawEntry.personId === 'string' ? rawEntry.personId : ''
          if (!personId) return []

          const unavailableSlots = Array.isArray(rawEntry.unavailableSlots)
            ? rawEntry.unavailableSlots.filter((value: unknown): value is string => typeof value === 'string')
            : []
          const regularBreakSlots = Array.isArray(rawEntry.regularBreakSlots)
            ? rawEntry.regularBreakSlots.filter((value: unknown): value is string => typeof value === 'string')
            : []
          const rawSubjectSlots = rawEntry.subjectSlots && typeof rawEntry.subjectSlots === 'object'
            ? rawEntry.subjectSlots as Record<string, unknown>
            : {}
          const subjectSlots = Object.entries(rawSubjectSlots).reduce<Record<string, number>>((accumulator, [subject, value]) => {
            const normalizedValue = typeof value === 'number' ? value : Number(value)
            if (!Number.isFinite(normalizedValue)) return accumulator

            const count = Math.max(0, Math.trunc(normalizedValue))
            if (count > 0) accumulator[subject] = count
            return accumulator
          }, {})

          return [{
            personId,
            unavailableSlots: Array.from(new Set<string>(unavailableSlots)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            regularBreakSlots: Array.from(new Set<string>(regularBreakSlots)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            regularOnly: Boolean(rawEntry.regularOnly),
            countSubmitted: Boolean(rawEntry.countSubmitted),
            subjectSlots,
          }]
        })

        const updatedAt = new Date().toISOString()
        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const nextStudentInputs = { ...session.studentInputs }
          for (const entry of normalizedEntries) {
            const previousInput = session.studentInputs[entry.personId]
            nextStudentInputs[entry.personId] = {
              unavailableSlots: entry.unavailableSlots,
              regularBreakSlots: entry.regularBreakSlots,
              subjectSlots: entry.regularOnly ? {} : entry.subjectSlots,
              regularOnly: entry.regularOnly,
              countSubmitted: entry.countSubmitted,
              submissionToken: previousInput?.submissionToken,
              updatedAt,
            }
          }

          return {
            ...session,
            studentInputs: nextStudentInputs,
            updatedAt,
          }
        }))
        return
      }

      if (message.type !== 'schedule-range-update') return
      if (message.viewType !== 'student' && message.viewType !== 'teacher') return
      if (typeof message.startDate !== 'string' || typeof message.endDate !== 'string') return

      const nextRange = {
        startDate: message.startDate,
        endDate: message.endDate,
        periodValue: typeof message.periodValue === 'string' ? message.periodValue : '',
      }

      if (message.viewType === 'student') setStudentScheduleRange(nextRange)
      else setTeacherScheduleRange(nextRange)
    }

    window.addEventListener('message', handleScheduleRangeMessage)
    return () => window.removeEventListener('message', handleScheduleRangeMessage)
  }, [ensureScheduleSubmissionTokens, studentScheduleRange, teacherScheduleRange, syncStudentSchedulePopup, syncTeacherSchedulePopup])

  useEffect(() => {
    syncSpecialSessionPopup()
  }, [syncSpecialSessionPopup])

  useEffect(() => {
    syncStudentSchedulePopup()
  }, [syncStudentSchedulePopup])

  useEffect(() => {
    syncTeacherSchedulePopup()
  }, [syncTeacherSchedulePopup])

  useEffect(() => {
    if (typeof window === 'undefined' || !boardState) return
    getSchedulePopupRuntimeWindow().__lessonScheduleBoardWeeks = boardState.weeks
    syncSpecialSessionPopup()
    syncStudentSchedulePopup()
    syncTeacherSchedulePopup()
  }, [boardState, syncSpecialSessionPopup, syncStudentSchedulePopup, syncTeacherSchedulePopup])

  // Real-time submission reflection from Firestore
  useEffect(() => {
    if (!isRemoteBackendEnabled || !actingClassroomId) return

    const unsubscribe = subscribeLectureSubmissions(actingClassroomId, (entries) => {
      // Skip entries whose tokens were recently reset to avoid race condition
      const activeEntries = entries.filter((e) => !recentlyResetSubmissionTokensRef.current.has(e.token))
      if (activeEntries.length === 0) return

      const newlyAppliedEntries: typeof activeEntries = []

      setSpecialSessions((current) => {
        let updated = current
        for (const entry of activeEntries) {
          updated = updated.map((session) => {
            if (session.id !== entry.sessionId) return session
            const now = new Date().toISOString()
            if (entry.personType === 'teacher') {
              const existing = session.teacherInputs[entry.personId]
              if (existing?.countSubmitted) return session
              newlyAppliedEntries.push(entry)
              return {
                ...session,
                teacherInputs: {
                  ...session.teacherInputs,
                  [entry.personId]: {
                    ...existing,
                    unavailableSlots: entry.unavailableSlots,
                    countSubmitted: true,
                    updatedAt: now,
                  },
                },
                updatedAt: now,
              }
            } else {
              const existing = session.studentInputs[entry.personId]
              if (existing?.countSubmitted) return session
              newlyAppliedEntries.push(entry)
              return {
                ...session,
                studentInputs: {
                  ...session.studentInputs,
                  [entry.personId]: {
                    ...existing,
                    unavailableSlots: entry.unavailableSlots,
                    regularBreakSlots: existing?.regularBreakSlots ?? [],
                    subjectSlots: entry.subjectSlots,
                    regularOnly: entry.regularOnly,
                    countSubmitted: true,
                    updatedAt: now,
                  },
                },
                updatedAt: now,
              }
            }
          })
        }
        return updated
      })

      // Trigger board placement for newly submitted teachers (same as schedule-teacher-count-save handler)
      for (const entry of newlyAppliedEntries) {
        if (entry.personType === 'teacher') {
          teacherAutoAssignRequestIdRef.current += 1
          setTeacherAutoAssignRequest({
            requestId: teacherAutoAssignRequestIdRef.current,
            sessionId: entry.sessionId,
            teacherId: entry.personId,
            mode: 'assign',
          })
        }
      }
    })

    return unsubscribe
  }, [isRemoteBackendEnabled, actingClassroomId])

  useEffect(() => {
    if (!isRemoteBackendEnabled) return

    let disposed = false
    const currentUser = getFirebaseCurrentUser()
    Promise.resolve(currentUser)
      .then((user) => {
        if (disposed) return
        setRemoteSessionUserId(user?.uid ?? null)
        setHasCheckedRemoteSession(true)
      })
      .catch((error) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : '外部認証の初期化に失敗しました。'
        setRemoteAuthMessage(message)
        setHasCheckedRemoteSession(true)
      })

    const unsubscribe = subscribeToFirebaseAuthChanges((user) => {
      if (disposed) return
      setRemoteSessionUserId(user?.uid ?? null)
      setHasCheckedRemoteSession(true)
      if (!user) {
        setCurrentUserId('')
        setScreen('board')
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [isRemoteBackendEnabled])

  useEffect(() => () => {
    Object.values(remoteClassroomUpdateTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
  }, [])

  useEffect(() => {
    if (isRemoteBackendEnabled && !hasCheckedRemoteSession) return

    if (!isSnapshotPersistenceRuntimeEnabled()) {
      const initialWorkspace = createInitialWorkspace(useImportedMasterData)
      applyWorkspaceSnapshot(initialWorkspace, '')
      setPersistenceMessage('')
      setHasHydratedSnapshot(true)
      return
    }

    let disposed = false

    if (isRemoteBackendEnabled) {
      if (!remoteSessionUserId) {
        void Promise.all([
          loadDeveloperCloudBackupHandle().catch(() => null),
        ]).then(([storedDeveloperCloudBackupHandle]) => {
          if (disposed) return
          if (isDeveloperCloudBackupDirectoryHandle(storedDeveloperCloudBackupHandle)) {
            setDeveloperCloudBackupHandle(storedDeveloperCloudBackupHandle)
          }
          setWorkspaceUsers([])
          setWorkspaceClassrooms([])
          setHasHydratedSnapshot(true)
          setPersistenceMessage('Firebase にログインしてください。')
        })
        return () => {
          disposed = true
        }
      }

      void Promise.all([
        loadFirebaseWorkspaceSnapshot({
          authenticatedUserId: remoteSessionUserId,
          createEmptyClassroomPayload: buildEmptyClassroomPayload,
        }),
        loadWorkspaceSnapshot().catch(() => null),
        loadDeveloperCloudBackupHandle().catch(() => null),
      ])
        .then(([remoteSnapshot, localWorkspaceSnapshot, storedDeveloperCloudBackupHandle]) => {
          if (disposed) return
          if (isDeveloperCloudBackupDirectoryHandle(storedDeveloperCloudBackupHandle)) {
            setDeveloperCloudBackupHandle(storedDeveloperCloudBackupHandle)
          }
          applyWorkspaceSnapshot(
            mergeWorkspaceWithLocalPreferences(remoteSnapshot, localWorkspaceSnapshot),
            'Firebase から教室ワークスペースを読み込みました。',
          )
          setRemoteAuthMessage('')
          setHasHydratedSnapshot(true)
        })
        .catch((error) => {
          if (disposed) return
          const message = error instanceof Error ? error.message : 'Firebase からの読み込みに失敗しました。'
          setRemoteAuthMessage(message)
          setPersistenceMessage(message)
          setHasHydratedSnapshot(true)
        })

      return () => {
        disposed = true
      }
    }

    void Promise.all([
      loadWorkspaceSnapshot().catch(() => null),
      loadAppSnapshot().catch(() => null),
      loadDeveloperCloudBackupHandle().catch(() => null),
    ])
      .then(([workspaceSnapshot, legacySnapshot, storedDeveloperCloudBackupHandle]) => {
        if (disposed) return
        if (isDeveloperCloudBackupDirectoryHandle(storedDeveloperCloudBackupHandle)) {
          setDeveloperCloudBackupHandle(storedDeveloperCloudBackupHandle)
        }
        if (workspaceSnapshot) {
          applyWorkspaceSnapshot(workspaceSnapshot, '教室ワークスペースを読み込みました。')
        } else if (legacySnapshot) {
          const migratedWorkspace = createInitialWorkspace(useImportedMasterData)
          migratedWorkspace.classrooms = migratedWorkspace.classrooms.map((classroom, index) => index === 0
            ? {
              ...classroom,
              data: {
                ...legacySnapshot,
                screen: legacySnapshot.screen,
              },
            }
            : classroom)
          migratedWorkspace.savedAt = legacySnapshot.savedAt
          applyWorkspaceSnapshot(migratedWorkspace, '既存の単一教室データを初期教室へ移行しました。')
        } else {
          const initialWorkspace = createInitialWorkspace(useImportedMasterData)
          applyWorkspaceSnapshot(initialWorkspace, '初期教室ワークスペースを作成しました。')
          setPersistenceMessage('保存データはまだありません。必要なら初期設定から開始してください。')
        }
        setHasHydratedSnapshot(true)
      })
      .catch(() => {
        if (disposed) return
        setPersistenceMessage('保存データの読み込みに失敗しました。現在の初期データで続行します。')
        setHasHydratedSnapshot(true)
      })

    return () => {
      disposed = true
    }
  }, [applyWorkspaceSnapshot, hasCheckedRemoteSession, isRemoteBackendEnabled, remoteSessionUserId, useImportedMasterData])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!developerCloudBackupEnabled) {
      setDeveloperCloudBackupStatus('保存フォルダへの自動保存は未設定です。')
      return
    }

    if (developerCloudBackupFolderName && developerCloudBackupHandle) {
      setDeveloperCloudBackupStatus(`${developerCloudBackupFolderName} を保存フォルダとして使用します。`)
      return
    }

    setDeveloperCloudBackupStatus('保存フォルダの再接続が必要です。')
  }, [developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupHandle, hasHydratedSnapshot])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return
    if (workspaceUsers.length === 0 || workspaceClassrooms.length === 0) return

    const savedAt = new Date().toISOString()
    const snapshot = buildWorkspaceSnapshot(savedAt)

    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceSnapshot(snapshot)
        .then(async () => {
          setLastSavedAt(snapshot.savedAt)
          setPersistenceMessage('自動保存しました。')

          if (isRemoteBackendEnabled && remoteSessionUserId) {
            try {
              await saveFirebaseWorkspaceSnapshot(snapshot, remoteSessionUserId)
              setPersistenceMessage('自動保存し、Firebase へ同期しました。')
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Firebase 同期に失敗しました。'
              setPersistenceMessage(`自動保存しましたが、${message}`)
            }
          }
        })
        .catch(() => {
          setPersistenceMessage('自動保存に失敗しました。バックアップを書き出してください。')
        })
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [buildWorkspaceSnapshot, hasHydratedSnapshot, isRemoteBackendEnabled, remoteSessionUserId, workspaceClassrooms.length, workspaceUsers.length])

  // Flush save on browser close / tab close to prevent data loss
  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return

    const handleBeforeUnload = () => {
      if (workspaceUsers.length === 0 || workspaceClassrooms.length === 0) return
      const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
      writeWorkspaceToLocalStorageSync(snapshot)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [buildWorkspaceSnapshot, hasHydratedSnapshot, workspaceClassrooms.length, workspaceUsers.length])

  useEffect(() => {
    if (!currentUser) return
    if (currentUser.role !== 'manager') return
    if (!currentUser.assignedClassroomId) return
    if (actingClassroomId === currentUser.assignedClassroomId) return
    openClassroom(currentUser.assignedClassroomId)
  }, [actingClassroomId, currentUser, openClassroom])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (typeof navigator === 'undefined' || !navigator.webdriver) return
    if (isRemoteBackendEnabled) return
    if (currentUser) return
    const fallbackManager = workspaceUsers.find((user) => user.role === 'manager') ?? workspaceUsers[0]
    if (!fallbackManager) return
    loginAsUser(fallbackManager.id)
  }, [currentUser, hasHydratedSnapshot, isRemoteBackendEnabled, loginAsUser, workspaceUsers])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!currentUser) {
      document.title = 'コマ表アプリ'
      return
    }

    const classroomName = actingClassroom?.name?.trim()
    if (screen === 'developer') {
      document.title = classroomName ? `${classroomName} | 開発者画面 | コマ表アプリ` : '開発者画面 | コマ表アプリ'
      return
    }

    document.title = classroomName ? `${classroomName} | コマ表アプリ` : 'コマ表アプリ'
  }, [actingClassroom?.name, currentUser, screen])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (typeof navigator !== 'undefined' && navigator.webdriver) return
    if (screen === 'developer') return
    if (classroomSettings.initialSetupCompletedAt) return
    if (initialSetupAutoOpenRef.current) return
    initialSetupAutoOpenRef.current = true
    setScreen('backup-restore')
  }, [classroomSettings.initialSetupCompletedAt, hasHydratedSnapshot, screen])

  const savePreTemplateSaveBackup = useCallback(async () => {
    saveUndoSnapshot('テンプレート上書き保存')
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    const result = await saveDailyWorkspaceAutoBackup(snapshot)
    setLocalAutoBackupSummaries(result.summaries)
    setPersistenceMessage('テンプレート上書き前のバックアップを保存しました。')
  }, [buildWorkspaceSnapshot, saveUndoSnapshot])

  const refreshLocalAutoBackupSummaries = useCallback(async () => {
    const summaries = await loadWorkspaceAutoBackupSummaries()
    setLocalAutoBackupSummaries(summaries)
  }, [])

  const restoreLocalAutoBackup = useCallback(async (backupDateKey: string) => {
    const snapshot = await loadWorkspaceAutoBackupSnapshot(backupDateKey)
    if (!snapshot) {
      setPersistenceMessage('指定された日付のバックアップが見つかりませんでした。')
      return
    }
    // actingClassroomId に該当する教室データを抽出して復元
    const classroomEntry = actingClassroomId
      ? snapshot.classrooms?.find((c) => c.id === actingClassroomId)
      : snapshot.classrooms?.[0]
    if (!classroomEntry?.data) {
      setPersistenceMessage('バックアップにこの教室のデータが含まれていませんでした。')
      return
    }
    saveUndoSnapshot('ローカルバックアップ復元')
    applyClassroomPayloadToState(classroomEntry.data, {
      setScreen: (value) => setScreen(value),
      setManagers,
      setTeachers,
      setStudents,
      setRegularLessons,
      setGroupLessons,
      setSpecialSessions,
      setAutoAssignRules,
      setPairConstraints,
      setClassroomSettings,
      setBoardState,
    })
    setPersistenceMessage(`ローカルバックアップ (${backupDateKey}) からこの教室を復元しました。`)
  }, [actingClassroomId, saveUndoSnapshot])

  const exportBackup = useCallback(() => {
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    downloadTextFile(formatBackupFileName(snapshot.savedAt, '手動バックアップ'), serializeWorkspaceSnapshot(snapshot), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('バックアップを書き出しました。')
  }, [buildWorkspaceSnapshot])

  const exportWorkspaceBackup = useCallback(() => {
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    downloadTextFile(formatBackupFileName(snapshot.savedAt, '開発者バックアップ'), serializeWorkspaceSnapshot(snapshot), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('開発者バックアップを書き出しました。')
  }, [buildWorkspaceSnapshot])

  const exportAnalysisData = useCallback(() => {
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    const analysisPayload = buildWorkspaceAnalysisExport(snapshot)
    downloadTextFile(formatBackupFileName(snapshot.savedAt, 'AI分析用データ'), serializeAnalysisExport(analysisPayload), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('AI分析用データを書き出しました。')
  }, [buildWorkspaceSnapshot])

  const importWorkspaceBackup = useCallback(async (file: File, _password: string) => {
    try {
      const text = await file.text()
      const snapshot = parseWorkspaceSnapshot(text)
      openDeveloperRestoreModal(snapshot, '開発者バックアップ')
      setPersistenceMessage('復元する教室をモーダルで選択してください。')
    } catch {
      setPersistenceMessage('開発者バックアップの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }, [openDeveloperRestoreModal])

  const importBackup = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      let snapshot: AppSnapshot
      try {
        snapshot = parseAppSnapshot(text)
      } catch {
        // AppSnapshot形式でない場合、WorkspaceSnapshot形式を試す
        const workspaceSnapshot = parseWorkspaceSnapshot(text)
        const targetClassroom = workspaceSnapshot.classrooms.find((c) => c.id === actingClassroomId)
          ?? workspaceSnapshot.classrooms[0]
        if (!targetClassroom) {
          setPersistenceMessage('バックアップに教室データが含まれていません。')
          return
        }
        snapshot = {
          schemaVersion: workspaceSnapshot.schemaVersion,
          savedAt: workspaceSnapshot.savedAt,
          ...targetClassroom.data,
        }
      }
      const confirmed = window.confirm([
        'バックアップを復元します。',
        `保存日時: ${new Date(snapshot.savedAt).toLocaleString('ja-JP')}`,
        '現在のデータはこの内容で上書きされます。',
        '復元してよろしいですか?',
      ].join('\n'))
      if (!confirmed) {
        setPersistenceMessage('バックアップの復元をキャンセルしました。')
        return
      }
      saveUndoSnapshot('バックアップ復元')
      applySnapshot(snapshot, 'バックアップを読み込みました。')
    } catch {
      setPersistenceMessage('バックアップの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }, [actingClassroomId, applySnapshot, saveUndoSnapshot])

  const loadServerAutoBackupSummaries = useCallback(async () => {
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) return
    setServerAutoBackupLoading(true)
    try {
      const summaries = await listFirebaseServerAutoBackupSummaries()
      setServerAutoBackupSummaries(summaries)
      setPersistenceMessage(`サーバーバックアップ一覧を取得しました。${summaries.length} 件`)

      // サーバーバックアップ一覧取得のタイミングで自動同期フォルダへ同期する
      if (summaries.length > 0 && developerCloudBackupEnabled && developerCloudBackupHandle) {
        const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
        void syncDeveloperCloudAutoBackups(undefined, snapshot).catch(() => {
          setDeveloperCloudBackupStatus('自動同期フォルダへの同期に失敗しました。')
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'サーバーバックアップ一覧の取得に失敗しました。'
      setPersistenceMessage(message)
    } finally {
      setServerAutoBackupLoading(false)
    }
  }, [buildWorkspaceSnapshot, developerCloudBackupEnabled, developerCloudBackupHandle, isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, syncDeveloperCloudAutoBackups])

  const loadStudentHistory = useCallback((classroomId: string) => {
    const allClassrooms = workspaceClassrooms.map((c) =>
      c.id === actingClassroomId
        ? { ...c, data: buildClassroomSnapshotPayload({ screen: screen === 'developer' ? 'board' : screen, classroomSettings, managers, teachers, students, regularLessons, groupLessons, specialSessions, autoAssignRules, pairConstraints, boardState }) }
        : c,
    )
    const classroom = allClassrooms.find((c) => c.id === classroomId)
    if (!classroom) return
    const studentList = classroom.data.students
    if (studentList.length === 0) {
      setStudentHistoryState({ classroomName: classroom.name, entries: [], loading: false })
      return
    }
    const today = new Date()
    const entries: Array<{ dateKey: string; count: number }> = []
    const startDate = new Date(today.getFullYear(), today.getMonth() - 11, 1)
    for (let d = new Date(startDate); d <= today; d.setMonth(d.getMonth() + 1)) {
      const dateKey = d.toISOString().slice(0, 7)
      const refDate = `${dateKey}-01`
      const count = studentList.filter((s) => isActiveOnDate(s.entryDate, s.withdrawDate, s.isHidden, refDate)).length
      entries.push({ dateKey, count })
    }
    setStudentHistoryState({ classroomName: classroom.name, entries, loading: false })
  }, [workspaceClassrooms, actingClassroomId, screen, classroomSettings, managers, teachers, students, regularLessons, groupLessons, specialSessions, autoAssignRules, pairConstraints, boardState])

  const restoreServerAutoBackup = useCallback(async (backupDateKey: string) => {
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) return
    setPersistenceMessage('サーバーバックアップをダウンロードしています…')
    try {
      const snapshotJson = await downloadFirebaseServerAutoBackup(backupDateKey)
      const snapshot = parseWorkspaceSnapshot(snapshotJson)
      openDeveloperRestoreModal(snapshot, `サーバーバックアップ (${backupDateKey})`)
      setPersistenceMessage('復元する教室をモーダルで選択してください。')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'サーバーバックアップのダウンロードに失敗しました。'
      setPersistenceMessage(message)
    }
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, openDeveloperRestoreModal])

  const restoreClassroomFromServerAutoBackup = useCallback(async (backupDateKey: string) => {
    if (!isRemoteBackendEnabled || !actingClassroomId) return
    setPersistenceMessage('サーバーバックアップから教室データをダウンロードしています…')
    try {
      const result = await downloadClassroomFromFirebaseServerAutoBackup(backupDateKey, actingClassroomId)

      saveUndoSnapshot('サーバーバックアップ復元')

      const updatedClassrooms = workspaceClassrooms.map((classroom) =>
        classroom.id === actingClassroomId
          ? { ...classroom, data: result.data }
          : classroom,
      )
      setWorkspaceClassrooms(updatedClassrooms)
      applyClassroomPayloadToState(result.data, {
        setScreen: (value) => setScreen(value),
        setManagers,
        setTeachers,
        setStudents,
        setRegularLessons,
        setGroupLessons,
        setSpecialSessions,
        setAutoAssignRules,
        setPairConstraints,
        setClassroomSettings,
        setBoardState,
      })
      setPersistenceMessage(`サーバーバックアップ (${backupDateKey}) からこの教室を復元しました。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'サーバーバックアップからの教室復元に失敗しました。'
      setPersistenceMessage(message)
    }
  }, [actingClassroomId, isRemoteBackendEnabled, saveUndoSnapshot, workspaceClassrooms])

  const exportBasicDataTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, createBasicDataTemplateBundle()), '基本データテンプレート.xlsx')
    setPersistenceMessage('基本データの Excel テンプレートを出力しました。')
  }, [])

  const exportBasicDataCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, { managers, teachers, students, classroomSettings }), '基本データ_現在.xlsx')
    setPersistenceMessage('基本データを Excel 出力しました。')
  }, [classroomSettings, managers, students, teachers])

  const importInitialBasicDataWorkbook = useCallback(async (file: File) => {
    try {
      if (hasAnyExistingSetupData() && !window.confirm([
        '基本データを初期取り込みします。',
        '現在の基本データ、自動割振ルール、盤面、開始時点ストックは初期化されます。',
        '続行しますか?',
      ].join('\n'))) {
        setPersistenceMessage('基本データの初期取り込みをキャンセルしました。')
        return
      }

      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const fallbackBundle = { managers, teachers, students, classroomSettings }
      const imported = parseImportedBundle(xlsx, workbook, fallbackBundle)
      const resetClassroomSettings = {
        ...createInitialClassroomSettings(),
        ...imported.classroomSettings,
        closedWeekdays: imported.classroomSettings.closedWeekdays,
        holidayDates: [],
        forceOpenDates: imported.classroomSettings.forceOpenDates,
        deskCount: imported.classroomSettings.deskCount,
      }
      const initialImportedBundle = {
        ...imported,
        classroomSettings: resetClassroomSettings,
      }
      const validationErrors = validateImportedBasicDataBundle(initialImportedBundle)
      if (validationErrors.length > 0) {
        window.alert([
          '基本データの取り込みを中断しました。',
          '以下の矛盾をすべて修正してから再取り込みしてください。',
          '',
          ...validationErrors.map((message, index) => `${index + 1}. ${message}`),
        ].join('\n'))
        setPersistenceMessage('基本データに矛盾が見つかったため、取り込みを中断しました。')
        return
      }

      saveUndoSnapshot('基本データ初期取込')

      setManagers(initialImportedBundle.managers)
      setTeachers(initialImportedBundle.teachers)
      setStudents(initialImportedBundle.students)
      setRegularLessons([])
      setGroupLessons([])
      setClassroomSettings(initialImportedBundle.classroomSettings)
      setAutoAssignRules(createInitialAutoAssignRuleRows())
      setPairConstraints(createInitialPairConstraintRows())
      const initialBoardRegularLessons = buildRegularLessonsFromTemplate({
        template: initialImportedBundle.classroomSettings.regularLessonTemplate,
        teachers: initialImportedBundle.teachers,
        students: initialImportedBundle.students,
      })
      setBoardState(createPackedInitialBoardState({
        classroomSettings: initialImportedBundle.classroomSettings,
        teachers: initialImportedBundle.teachers,
        students: initialImportedBundle.students,
        regularLessons: initialBoardRegularLessons,
      }))
      setPersistenceMessage('基本データを初期取り込みしました。特別講習、ルール、盤面、開始時点ストックは初期化しました。')
    } catch {
      setPersistenceMessage('基本データの Excel 初期取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [classroomSettings, hasAnyExistingSetupData, managers, saveUndoSnapshot, students, teachers])

  const importDiffBasicDataWorkbook = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const fallbackBundle = { managers, teachers, students, classroomSettings }
      const imported = parseImportedBundle(xlsx, workbook, fallbackBundle)
      const merged = mergeImportedBundle(imported, fallbackBundle)
      const validationErrors = validateImportedBasicDataBundle(merged)
      if (validationErrors.length > 0) {
        window.alert([
          '基本データの取り込みを中断しました。',
          '以下の矛盾をすべて修正してから再取り込みしてください。',
          '',
          ...validationErrors.map((message, index) => `${index + 1}. ${message}`),
        ].join('\n'))
        setPersistenceMessage('基本データに矛盾が見つかったため、取り込みを中断しました。')
        return
      }

      setManagers(merged.managers)
      setTeachers(merged.teachers)
      setStudents(merged.students)
      setClassroomSettings(merged.classroomSettings)
      if (!boardState) {
        const mergedBoardRegularLessons = buildRegularLessonsFromTemplate({
          template: merged.classroomSettings.regularLessonTemplate,
          teachers: merged.teachers,
          students: merged.students,
        })
        setBoardState(createPackedInitialBoardState({
          classroomSettings: merged.classroomSettings,
          teachers: merged.teachers,
          students: merged.students,
          regularLessons: mergedBoardRegularLessons,
        }))
      }
      if (!hasAnyExistingSetupData()) {
        setPersistenceMessage('基本データを Excel から取り込みました。初期盤面を生成しました。')
      } else {
        setPersistenceMessage('基本データの差分を Excel から取り込みました。特別講習、ルール、盤面、ストックは保持しています。')
      }
    } catch {
      setPersistenceMessage('基本データの Excel 差分取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [boardState, classroomSettings, hasAnyExistingSetupData, managers, students, teachers])

  const exportSpecialDataTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildSpecialSessionWorkbook(xlsx, buildTemplateSpecialSessions(initialSpecialSessions, students, teachers), students, teachers), '特別講習データテンプレート.xlsx')
    setPersistenceMessage('特別講習データの Excel テンプレートを出力しました。')
  }, [students, teachers])

  const exportSpecialDataCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildSpecialSessionWorkbook(xlsx, specialSessions, students, teachers), '特別講習データ_現在.xlsx')
    setPersistenceMessage('特別講習データを Excel 出力しました。')
  }, [specialSessions, students, teachers])

  const importSpecialDataWorkbook = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      setSpecialSessions(parseSpecialSessionWorkbook(xlsx, workbook, specialSessions))
      setPersistenceMessage('特別講習データを Excel から取り込みました。')
    } catch {
      setPersistenceMessage('特別講習データの Excel 取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [specialSessions])

  const exportAutoAssignTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildAutoAssignWorkbook(xlsx, initialAutoAssignRules, [], Object.fromEntries(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), Object.fromEntries(students.map((student) => [student.id, getStudentDisplayName(student)]))), '自動割振ルールテンプレート.xlsx')
    setPersistenceMessage('自動割振ルールの Excel テンプレートを出力しました。')
  }, [students, teachers])

  const exportAutoAssignCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildAutoAssignWorkbook(xlsx, autoAssignRules, pairConstraints, Object.fromEntries(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), Object.fromEntries(students.map((student) => [student.id, getStudentDisplayName(student)]))), '自動割振ルール_現在.xlsx')
    setPersistenceMessage('自動割振ルールを Excel 出力しました。')
  }, [autoAssignRules, pairConstraints, students, teachers])

  const importAutoAssignWorkbookFile = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const teacherIdByName = new Map<string, string>()
      teachers.forEach((teacher) => {
        teacherIdByName.set(teacher.name, teacher.id)
        teacherIdByName.set(getTeacherDisplayName(teacher), teacher.id)
      })
      const studentIdByName = new Map<string, string>()
      students.forEach((student) => {
        studentIdByName.set(student.name, student.id)
        studentIdByName.set(getStudentDisplayName(student), student.id)
      })
      const imported = parseAutoAssignWorkbook(xlsx, workbook, autoAssignRules, pairConstraints, teacherIdByName, studentIdByName)
      setAutoAssignRules(imported.rules)
      setPairConstraints(imported.pairConstraints)
      setPersistenceMessage('自動割振ルールを Excel から取り込みました。')
    } catch {
      setPersistenceMessage('自動割振ルールの Excel 取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [autoAssignRules, pairConstraints, students, teachers])

  const completeInitialSetup = useCallback(() => {
    const completedAt = new Date().toISOString()
    const nextClassroomSettings = {
      ...classroomSettings,
      initialSetupCompletedAt: completedAt,
    }
    setClassroomSettings(nextClassroomSettings)
    setBoardState(createPackedInitialBoardState({
      classroomSettings: nextClassroomSettings,
      teachers,
      students,
      regularLessons: displayRegularLessons,
    }))
    setPersistenceMessage('初期設定を完了し、管理データと開始時点ストックを反映したコマ表にリセットしました。')
    setScreen('board')
  }, [classroomSettings, displayRegularLessons, students, teachers])

  if (!hasHydratedSnapshot) {
    return <div className="workspace-auth-shell"><div className="workspace-auth-card"><h2>読み込み中</h2><p>教室ワークスペースを準備しています。</p></div></div>
  }

  if (!currentUser) {
    if (isRemoteBackendEnabled) {
      return (
        <div className="workspace-auth-shell">
          <div className="workspace-auth-card" data-testid="firebase-login-card">
            <h1>コマ表アプリログイン</h1>
            <form className="workspace-auth-form" onSubmit={(event) => {
              event.preventDefault()
              void submitRemoteLogin()
            }}>
              <label className="workspace-auth-field">
                <span>メールアドレス</span>
                <input data-testid="firebase-login-email" type="email" value={remoteLoginEmail} onChange={(event) => setRemoteLoginEmail(event.target.value)} autoComplete="username" />
              </label>
              <label className="workspace-auth-field">
                <span>パスワード</span>
                <input data-testid="firebase-login-password" type="password" value={remoteLoginPassword} onChange={(event) => setRemoteLoginPassword(event.target.value)} autoComplete="current-password" />
              </label>
              <div className="workspace-auth-actions">
                <button data-testid="firebase-login-submit" className="primary-button" type="submit" disabled={isRemoteLoginSubmitting}>{isRemoteLoginSubmitting ? 'ログイン中...' : 'ログイン'}</button>
              </div>
            </form>
            <div className="workspace-auth-actions">
              <button data-testid="firebase-password-reset" className="menu-link-button" type="button" onClick={() => void submitPasswordReset()}>パスワードを忘れた方はこちら</button>
            </div>
            {remoteAuthMessage ? <div data-testid="firebase-auth-message" className="workspace-auth-note workspace-auth-note-error">{remoteAuthMessage}</div> : null}
          </div>
        </div>
      )
    }

    return (
      <div className="workspace-auth-shell">
        <div className="workspace-auth-card">
          <p className="panel-kicker">Local Session</p>
          <h1>仮ログイン</h1>
          <p className="page-summary">認証方式をまだ確定していないため、いまは画面操作の確認用にローカルアカウントを選んで入ります。</p>
          <div className="workspace-account-list">
            {workspaceUsers.map((user) => {
              const assignedClassroomName = user.assignedClassroomId
                ? workspaceClassrooms.find((classroom) => classroom.id === user.assignedClassroomId)?.name ?? '未割当'
                : '全教室'
              return (
                <button key={user.id} className="workspace-account-card" type="button" onClick={() => loginAsUser(user.id)}>
                  <strong>{user.name}</strong>
                  <span>{user.role === 'developer' ? '開発者' : '教室管理者'}</span>
                  <span>{user.email}</span>
                  <span>対象: {assignedClassroomName}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'developer' && currentUser.role === 'developer') {
    return (
      <DeveloperAdminScreen
        currentUser={currentUser}
        authMode={isRemoteBackendEnabled ? 'firebase' : 'local'}
        accountProvisioningLocked={isRemoteBackendEnabled && !isRemoteAdminAutomationEnabled}
        managerEmailLocked={isRemoteBackendEnabled && !isRemoteAdminAutomationEnabled}
        firebaseProjectId={firebaseBackendConfig.projectId}
        persistenceMessage={persistenceMessage}
        developerCloudBackupEnabled={developerCloudBackupEnabled}
        developerCloudBackupFolderName={developerCloudBackupFolderName}
        developerCloudBackupStatus={developerCloudBackupStatus}
        onConnectDeveloperCloudBackupFolder={() => void connectDeveloperCloudBackupFolder()}
        onDisconnectDeveloperCloudBackupFolder={() => void disconnectDeveloperCloudBackupFolder()}
        classrooms={workspaceClassrooms.map((classroom) => classroom.id === actingClassroomId
          ? {
            ...classroom,
            data: buildClassroomSnapshotPayload({
              screen: screen === 'developer' ? 'board' : screen,
              classroomSettings,
              managers,
              teachers,
              students,
              regularLessons,
              groupLessons,
              specialSessions,
              autoAssignRules,
              pairConstraints,
              boardState,
            }),
          }
          : classroom)}
        users={workspaceUsers}
        actingClassroomId={actingClassroomId}
        onAddClassroom={addClassroom}
        blazeFreeTierEstimate={blazeFreeTierEstimate}
        serverAutoBackupSummaries={serverAutoBackupSummaries}
        serverAutoBackupLoading={serverAutoBackupLoading}
        onLoadServerAutoBackupSummaries={() => void loadServerAutoBackupSummaries()}
        onRestoreServerAutoBackup={(backupDateKey) => void restoreServerAutoBackup(backupDateKey)}
        bulkTemporarySuspensionReason={bulkTemporarySuspensionReason}
        onBulkTemporarySuspensionReasonChange={setBulkTemporarySuspensionReason}
        areAllContractedClassroomsTemporarilySuspended={areAllContractedClassroomsTemporarilySuspended}
        onToggleContractedClassroomsTemporarySuspension={toggleContractedClassroomsTemporarySuspension}
        onUpdateClassroom={updateClassroom}
        onReplaceClassroomManagerUid={replaceClassroomManagerUid}
        onExportWorkspaceBackup={exportWorkspaceBackup}
        onExportAnalysisData={exportAnalysisData}
        onImportWorkspaceBackup={importWorkspaceBackup}
        onRestoreAutoBackup={() => {}}
        onLoadStudentHistory={loadStudentHistory}
        studentHistoryState={studentHistoryState}
        onCloseStudentHistory={() => setStudentHistoryState(null)}
        restoreModalState={developerRestoreModalState ? {
          sourceLabel: developerRestoreModalState.sourceLabel,
          savedAt: developerRestoreModalState.savedAt,
          options: developerRestoreModalState.options,
        } : null}
        onToggleRestoreClassroom={toggleDeveloperRestoreClassroom}
        onSelectAllRestoreClassrooms={() => setAllDeveloperRestoreSelections(true)}
        onClearAllRestoreClassrooms={() => setAllDeveloperRestoreSelections(false)}
        onConfirmRestoreSelection={confirmDeveloperRestoreModal}
        onCancelRestoreSelection={closeDeveloperRestoreModal}
        onDeleteClassroom={deleteClassroom}
        onOpenClassroom={(classroomId) => openClassroom(classroomId, 'board')}
        onLogout={logout}
      />
    )
  }

  if (currentUser.role === 'manager' && isCurrentClassroomSuspended) {
    return (
      <div className="workspace-auth-shell">
        <div className="workspace-auth-card workspace-auth-card--warning">
          <p className="panel-kicker">Suspended</p>
          <h1>{actingClassroom?.name ?? '教室'} は停止中です</h1>
          {isCurrentClassroomTemporarilySuspended && actingClassroom?.temporarySuspensionReason ? (
            <div className="toolbar-status">停止理由: {actingClassroom.temporarySuspensionReason}</div>
          ) : null}
          <div className="workspace-status-bar__actions">
            <button className="secondary-button slim" type="button" onClick={logout}>ログアウト</button>
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'basic-data') {
    return (
      <BasicDataScreen
        classroomSettings={classroomSettings}
        managers={managers}
        teachers={teachers}
        students={students}
        onUpdateManagers={setManagers}
        onUpdateTeachers={setTeachers}
        onUpdateStudents={setStudents}
        onUpdateClassroomSettings={setClassroomSettings}
        onBackToBoard={() => navigateClassroomScreen('board')}
        onOpenSpecialData={() => navigateClassroomScreen('special-data')}
        onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
        onOpenBackupRestore={() => navigateClassroomScreen('backup-restore')}
        onLogout={logout}
      />
    )
  }

  if (screen === 'special-data') {
    return (
      <SpecialSessionScreen
        sessions={specialSessions}
        students={students}
        teachers={teachers}
        onUpdateSessions={setSpecialSessions}
        onBackToBoard={() => navigateClassroomScreen('board')}
        onOpenBasicData={() => navigateClassroomScreen('basic-data')}
        onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
        onOpenBackupRestore={() => navigateClassroomScreen('backup-restore')}
        onLogout={logout}
      />
    )
  }

  if (screen === 'auto-assign-rules') {
    return (
      <AutoAssignRuleScreen
        rules={autoAssignRules}
        teachers={teachers}
        students={students}
        pairConstraints={pairConstraints}
        onUpdateRules={setAutoAssignRules}
        onUpdatePairConstraints={setPairConstraints}
        onBackToBoard={() => navigateClassroomScreen('board')}
        onOpenBasicData={() => navigateClassroomScreen('basic-data')}
        onOpenSpecialData={() => navigateClassroomScreen('special-data')}
        onOpenBackupRestore={() => navigateClassroomScreen('backup-restore')}
        onLogout={logout}
      />
    )
  }

  if (screen === 'backup-restore') {
    return (
      <BackupRestoreScreen
        onBackToBoard={() => navigateClassroomScreen('board')}
        onOpenBasicData={() => navigateClassroomScreen('basic-data')}
        onOpenSpecialData={() => navigateClassroomScreen('special-data')}
        onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
        onLogout={logout}
        persistenceMessage={persistenceMessage}
        lastSavedAt={lastSavedAt}
        classroomName={actingClassroom?.name ?? '教室'}
        autoBackupSummaries={localAutoBackupSummaries}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        onRestoreAutoBackup={(backupDateKey) => void restoreLocalAutoBackup(backupDateKey)}
        onRefreshAutoBackupSummaries={() => void refreshLocalAutoBackupSummaries()}
        showServerBackups={isRemoteBackendEnabled}
        serverAutoBackupSummaries={serverAutoBackupSummaries}
        serverAutoBackupLoading={serverAutoBackupLoading}
        onLoadServerAutoBackupSummaries={() => void loadServerAutoBackupSummaries()}
        onRestoreClassroomFromServerAutoBackup={(backupDateKey) => void restoreClassroomFromServerAutoBackup(backupDateKey)}
        classroomSettings={classroomSettings}
        students={students}
        specialSessions={specialSessions}
        onUpdateClassroomSettings={setClassroomSettings}
        onCompleteInitialSetup={completeInitialSetup}
        onExportBasicDataTemplate={exportBasicDataTemplate}
        onExportBasicDataCurrent={exportBasicDataCurrent}
        onImportInitialBasicDataWorkbook={importInitialBasicDataWorkbook}
        onImportDiffBasicDataWorkbook={importDiffBasicDataWorkbook}
        onExportSpecialDataTemplate={exportSpecialDataTemplate}
        onExportSpecialDataCurrent={exportSpecialDataCurrent}
        onImportSpecialDataWorkbook={importSpecialDataWorkbook}
        onExportAutoAssignTemplate={exportAutoAssignTemplate}
        onExportAutoAssignCurrent={exportAutoAssignCurrent}
        onImportAutoAssignWorkbook={importAutoAssignWorkbookFile}
        undoSnapshotLabel={undoSnapshot?.label ?? null}
        onRestoreUndoSnapshot={restoreUndoSnapshot}
        onDismissUndoSnapshot={dismissUndoSnapshot}
      />
    )
  }

  return (
    <ScheduleBoardScreen
      classroomSettings={classroomSettings}
      teachers={teachers}
      students={students}
      regularLessons={displayRegularLessons}
      specialSessions={specialSessions}
      autoAssignRules={autoAssignRules}
      pairConstraints={pairConstraints}
      teacherAutoAssignRequest={teacherAutoAssignRequest}
      studentScheduleRequest={studentScheduleRequest}
      initialBoardState={boardState}
      onBoardStateChange={setBoardState}
      onReplaceRegularLessons={setRegularLessons}
      onUpdateSpecialSessions={setSpecialSessions}
      onUpdateClassroomSettings={setClassroomSettings}
      onOpenBasicData={() => navigateClassroomScreen('basic-data')}
      onOpenSpecialData={() => navigateClassroomScreen('special-data')}
      onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
      onOpenBackupRestore={() => navigateClassroomScreen('backup-restore')}
      onPreTemplateSaveBackup={savePreTemplateSaveBackup}
      undoSnapshotLabel={undoSnapshot?.label ?? null}
      onRestoreUndoSnapshot={restoreUndoSnapshot}
      onDismissUndoSnapshot={dismissUndoSnapshot}
      onLogout={logout}
    />
  )
}

export default App
