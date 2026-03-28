import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackupRestoreScreen } from './components/backup-restore/BackupRestoreScreen'
import { BasicDataScreen, buildWorkbook as buildBasicDataWorkbook, createTemplateBundle as createBasicDataTemplateBundle, initialGroupLessons, initialManagers, mergeImportedBundle, parseImportedBundle, type GroupLessonRow } from './components/basic-data/BasicDataScreen'
import { validateImportedBasicDataBundle } from './components/basic-data/basicDataImportValidation'
import { AutoAssignRuleScreen, buildAutoAssignWorkbook, parseAutoAssignWorkbook } from './components/auto-assign-rules/AutoAssignRuleScreen'
import { initialAutoAssignRules } from './components/auto-assign-rules/autoAssignRuleModel'
import { initialPairConstraints } from './types/pairConstraint'
import { deriveManagedDisplayName, getStudentDisplayName, getTeacherDisplayName, initialStudents, initialTeachers, type ManagerRow, type StudentRow, type TeacherRow } from './components/basic-data/basicDataModel'
import { createInitialRegularLessons, packSortRegularLessonRows, type RegularLessonRow } from './components/basic-data/regularLessonModel'
import { buildSpecialSessionWorkbook, buildTemplateSpecialSessions, parseSpecialSessionWorkbook, SpecialSessionScreen } from './components/special-data/SpecialSessionScreen'
import { initialSpecialSessions } from './components/special-data/specialSessionModel'
import { ScheduleBoardScreen, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, createPackedInitialBoardState, normalizeScheduleRange, readStoredScheduleRange, type ScheduleRangePreference } from './components/schedule-board/ScheduleBoardScreen'
import { DeveloperAdminScreen } from './components/developer-admin/DeveloperAdminScreen'
import { importedMasterData } from './data/importedMasterData.generated'
import { deleteFirebaseWorkspaceClassroom, provisionFirebaseWorkspaceClassroom, provisionFirebaseWorkspaceClassroomWithExistingUid, reassignFirebaseWorkspaceClassroomManagerWithExistingUid, updateFirebaseWorkspaceClassroom } from './integrations/firebase/adminFunctions'
import { getFirebaseCurrentUser, signInToFirebaseWithPassword, signOutFromFirebase, subscribeToFirebaseAuthChanges } from './integrations/firebase/client'
import { getFirebaseBackendConfig, isFirebaseAdminFunctionsEnabled, isFirebaseBackendEnabled } from './integrations/firebase/config'
import { loadFirebaseWorkspaceSnapshot, saveFirebaseWorkspaceSnapshot } from './integrations/firebase/workspaceStore'
import type { SlotCell } from './components/schedule-board/types'
import { getWeekStart, shiftDate } from './components/schedule-board/mockData'
import { clearDeveloperCloudBackupHandle, loadAppSnapshot, loadDeveloperCloudBackupHandle, loadWorkspaceAutoBackupEntries, loadWorkspaceAutoBackupSnapshot, loadWorkspaceAutoBackupSummaries, loadWorkspaceSnapshot, parseAppSnapshot, parseWorkspaceSnapshot, saveDailyWorkspaceAutoBackup, saveDeveloperCloudBackupHandle, saveWorkspaceSnapshot, serializeAppSnapshot, serializeWorkspaceSnapshot, type AutoBackupSummary } from './data/appSnapshotRepository'
import type { AppScreen, AppSnapshot, AppSnapshotPayload, ClassroomScreen, ClassroomSettings as SharedClassroomSettings, PersistedBoardState, WorkspaceClassroom, WorkspaceSnapshot, WorkspaceUser } from './types/appState'
import { DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID, fetchGoogleHolidayDates, mergeSyncedHolidayDates, readGoogleHolidaySyncCache, shouldRefreshGoogleHolidayCache, writeGoogleHolidaySyncCache } from './utils/googleHolidayCalendar'
import { createLegacyLessonScheduleQrConfig } from './utils/scheduleQrConfig'
import { formatWeeklyScheduleTitle, syncStudentScheduleHtml, syncTeacherScheduleHtml } from './utils/scheduleHtml'
import { syncSpecialSessionAvailabilityHtml } from './utils/specialSessionAvailabilityHtml'
import './App.css'

export type ClassroomSettings = SharedClassroomSettings

type GoogleHolidaySyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'disabled'

type GoogleHolidaySyncState = {
  status: GoogleHolidaySyncStatus
  message: string
}

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
  managerEmail: string
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

function isGoogleHolidaySyncRuntimeEnabled() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return true
}

function shouldUseImportedMasterData() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return importedMasterData.teachers.length > 0 && importedMasterData.students.length > 0
}

function isSnapshotPersistenceRuntimeEnabled() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
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

function getDeveloperCloudAnalysisFileName(savedAt: string) {
  return formatPreciseBackupFileName(savedAt, 'AI分析用データ_自動保存')
}

async function writeTextFileToDeveloperCloudDirectory(handle: DeveloperCloudBackupDirectoryHandle, fileName: string, content: string) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

function normalizeWorkspaceClassroom(classroom: WorkspaceClassroom): WorkspaceClassroom {
  return {
    ...classroom,
    isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
    temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
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
  await writeTextFileToDeveloperCloudDirectory(handle, getDeveloperCloudAnalysisFileName(snapshot.savedAt), serializeAnalysisExport(buildWorkspaceAnalysisExport(snapshot)))
}

const DEFAULT_DEVELOPER_PASSWORD = 'developer'

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
  if (!isGoogleHolidaySyncRuntimeEnabled()) {
    return {
      closedWeekdays: [0],
      holidayDates: [],
      forceOpenDates: [],
      deskCount: 14,
      initialSetupCompletedAt: '',
      initialSetupMakeupStocks: [],
      initialSetupLectureStocks: [],
      googleHolidayCalendarSyncedDates: [],
      googleHolidayCalendarLastSyncedAt: '',
    }
  }

  const cache = readGoogleHolidaySyncCache()
  return {
    closedWeekdays: [0],
    holidayDates: cache?.syncedHolidayDates ?? [],
    forceOpenDates: [],
    deskCount: 14,
    initialSetupCompletedAt: '',
    initialSetupMakeupStocks: [],
    initialSetupLectureStocks: [],
    googleHolidayCalendarSyncedDates: cache?.syncedHolidayDates ?? [],
    googleHolidayCalendarLastSyncedAt: cache?.lastSyncedAt ?? '',
  }
}

function sanitizeClassroomSettingsWithHolidayCache(settings: ClassroomSettings) {
  const cache = readGoogleHolidaySyncCache()
  if (!cache) return settings

  return {
    ...settings,
    holidayDates: mergeSyncedHolidayDates(settings.holidayDates, settings.googleHolidayCalendarSyncedDates ?? [], cache.syncedHolidayDates),
    googleHolidayCalendarSyncedDates: cache.syncedHolidayDates,
    googleHolidayCalendarLastSyncedAt: cache.lastSyncedAt,
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
    developerPassword: DEFAULT_DEVELOPER_PASSWORD,
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
  handlers.setScreen(payload.screen)
  handlers.setManagers(payload.managers)
  handlers.setTeachers(payload.teachers)
  handlers.setStudents(payload.students)
  handlers.setRegularLessons(payload.regularLessons)
  handlers.setGroupLessons(payload.groupLessons)
  handlers.setSpecialSessions(payload.specialSessions)
  handlers.setAutoAssignRules(payload.autoAssignRules)
  handlers.setPairConstraints(payload.pairConstraints)
  handlers.setClassroomSettings(sanitizeClassroomSettingsWithHolidayCache(payload.classroomSettings))
  handlers.setBoardState(payload.boardState)
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
  return {
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
  }
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
  const isGoogleHolidaySyncEnabled = isGoogleHolidaySyncRuntimeEnabled()
  const isRemoteBackendEnabled = isFirebaseBackendEnabled()
  const isRemoteAdminAutomationEnabled = isFirebaseAdminFunctionsEnabled()
  const firebaseBackendConfig = getFirebaseBackendConfig()
  const useImportedMasterData = shouldUseImportedMasterData()
  const googleHolidayApiKey = (import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY ?? '').trim()
  const googleHolidayCalendarId = (import.meta.env.VITE_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID ?? DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID).trim()
  const holidaySyncInFlightRef = useRef(false)
  const holidaySyncBootstrapRef = useRef(false)
  const initialSetupAutoOpenRef = useRef(false)
  const remoteClassroomUpdateTimeoutsRef = useRef<Record<string, number>>({})
  const teacherAutoAssignRequestIdRef = useRef(0)
  const studentScheduleRequestIdRef = useRef(0)
  const scheduleQrConfig = createLegacyLessonScheduleQrConfig()
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
  const [autoBackupSummaries, setAutoBackupSummaries] = useState<AutoBackupSummary[]>([])
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([])
  const [workspaceClassrooms, setWorkspaceClassrooms] = useState<WorkspaceClassroom[]>([])
  const [developerPassword, setDeveloperPassword] = useState(DEFAULT_DEVELOPER_PASSWORD)
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
  const [googleHolidaySyncState, setGoogleHolidaySyncState] = useState<GoogleHolidaySyncState>(() => {
    if (!isGoogleHolidaySyncEnabled) {
      return { status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' }
    }

    const cache = readGoogleHolidaySyncCache()
    return cache?.lastSyncedAt
      ? { status: 'idle', message: googleHolidayApiKey ? 'Google公開祝日の差分を起動時に反映します。' : '公開祝日データの差分を起動時に反映します。' }
      : { status: 'idle', message: googleHolidayApiKey ? 'Google公開祝日の初回同期を待機しています。' : '公開祝日データの初回同期を待機しています。' }
  })
  const currentUser = useMemo(() => workspaceUsers.find((user) => user.id === currentUserId) ?? null, [currentUserId, workspaceUsers])
  const actingClassroom = useMemo(() => workspaceClassrooms.find((classroom) => classroom.id === actingClassroomId) ?? null, [actingClassroomId, workspaceClassrooms])
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
    developerPassword,
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
  }), [actingClassroomId, autoAssignRules, boardState, classroomSettings, currentUserId, developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudSyncedAutoBackupKeys, developerPassword, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers, workspaceClassrooms, workspaceUsers])

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

  const runGoogleHolidaySync = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!isGoogleHolidaySyncEnabled) {
      setGoogleHolidaySyncState({ status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' })
      return
    }
    if (holidaySyncInFlightRef.current) return

    const cache = readGoogleHolidaySyncCache()
    if (!options?.force && cache?.lastSyncedAt && !shouldRefreshGoogleHolidayCache(cache.lastSyncedAt)) {
      if (!classroomSettings.googleHolidayCalendarLastSyncedAt) {
        setClassroomSettings((current) => ({
          ...current,
          holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], cache.syncedHolidayDates),
          googleHolidayCalendarSyncedDates: cache.syncedHolidayDates,
          googleHolidayCalendarLastSyncedAt: cache.lastSyncedAt,
        }))
      }
      return
    }

    holidaySyncInFlightRef.current = true
    setGoogleHolidaySyncState({
      status: 'syncing',
      message: options?.background
        ? (googleHolidayApiKey ? 'Google公開祝日をバックグラウンド同期中です。' : '公開祝日データをバックグラウンド同期中です。')
        : (googleHolidayApiKey ? 'Google公開祝日を同期中です。' : '公開祝日データを同期中です。'),
    })

    try {
      const syncedHolidayDates = await fetchGoogleHolidayDates({
        apiKey: googleHolidayApiKey,
        calendarId: googleHolidayCalendarId,
      })
      const syncedAt = new Date().toISOString()

      setClassroomSettings((current) => ({
        ...current,
        holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], syncedHolidayDates),
        googleHolidayCalendarSyncedDates: syncedHolidayDates,
        googleHolidayCalendarLastSyncedAt: syncedAt,
      }))
      writeGoogleHolidaySyncCache({ syncedHolidayDates, lastSyncedAt: syncedAt })
      setGoogleHolidaySyncState({ status: 'success', message: `${googleHolidayApiKey ? 'Google公開祝日' : '公開祝日データ'}を ${syncedHolidayDates.length} 件同期しました。` })
    } catch (error) {
      const message = error instanceof Error ? error.message : '祝日同期に失敗しました。'
      setGoogleHolidaySyncState({ status: 'error', message })
    } finally {
      holidaySyncInFlightRef.current = false
    }
  }, [classroomSettings.googleHolidayCalendarLastSyncedAt, googleHolidayApiKey, googleHolidayCalendarId, isGoogleHolidaySyncEnabled])

  const applySnapshot = useCallback((snapshot: AppSnapshot, successMessage: string) => {
    setScreen(snapshot.screen)
    setManagers(snapshot.managers)
    setTeachers(snapshot.teachers)
    setStudents(snapshot.students)
    setRegularLessons(snapshot.regularLessons)
    setGroupLessons(snapshot.groupLessons)
    setSpecialSessions(snapshot.specialSessions)
    setAutoAssignRules(snapshot.autoAssignRules)
    setPairConstraints(snapshot.pairConstraints)
    setClassroomSettings(sanitizeClassroomSettingsWithHolidayCache(snapshot.classroomSettings))
    setBoardState(snapshot.boardState)
    setLastSavedAt(snapshot.savedAt)
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
    setWorkspaceUsers(workspaceSnapshot.users)
    setWorkspaceClassrooms(workspaceSnapshot.classrooms.map((classroom) => ({
      ...classroom,
      isTemporarilySuspended: Boolean(classroom.isTemporarilySuspended),
      temporarySuspensionReason: classroom.temporarySuspensionReason ?? '',
    })))
    setDeveloperPassword(workspaceSnapshot.developerPassword ?? DEFAULT_DEVELOPER_PASSWORD)
    setDeveloperCloudBackupEnabled(workspaceSnapshot.developerCloudBackupEnabled ?? false)
    setDeveloperCloudBackupFolderName(workspaceSnapshot.developerCloudBackupFolderName ?? '')
    setDeveloperCloudSyncedAutoBackupKeys(workspaceSnapshot.developerCloudSyncedAutoBackupKeys ?? [])
    setCurrentUserId(workspaceSnapshot.currentUserId)
    setActingClassroomId(workspaceSnapshot.actingClassroomId)
    setLastSavedAt(workspaceSnapshot.savedAt)
    setPersistenceMessage(successMessage)

    const currentWorkspaceUser = workspaceSnapshot.users.find((user) => user.id === workspaceSnapshot.currentUserId) ?? null
    const targetClassroomId = currentWorkspaceUser?.role === 'manager'
      ? currentWorkspaceUser.assignedClassroomId
      : workspaceSnapshot.actingClassroomId
    const targetClassroom = workspaceSnapshot.classrooms.find((classroom) => classroom.id === targetClassroomId) ?? workspaceSnapshot.classrooms[0] ?? null

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
      if (!managerEmail) {
        setPersistenceMessage('教室追加をキャンセルしました。')
        return
      }

      const contractStartDate = input?.contractStartDate?.trim() || getTodayDateValue()
      const contractEndDate = input?.contractEndDate?.trim() || ''

      if (!isRemoteAdminAutomationEnabled) {
        const managerUserId = input?.managerUserId?.trim() ?? ''
        if (!managerUserId) {
          setPersistenceMessage('Spark 構成で教室追加するには、Authentication で作成した管理者 UID を入力してください。')
          return
        }

        void provisionFirebaseWorkspaceClassroomWithExistingUid({
          classroomName,
          managerName,
          managerEmail,
          managerUserId,
          contractStartDate,
          contractEndDate,
          initialPayload: buildEmptyClassroomPayload(),
        }).then(async (result) => {
          await reloadRemoteWorkspace('教室を追加しました。Authentication で作成済みの UID を教室管理者へ紐付けました。', result.classroomId)
        }).catch((error) => {
          const message = error instanceof Error ? error.message : '教室追加に失敗しました。'
          setPersistenceMessage(message)
        })
        return
      }

      void provisionFirebaseWorkspaceClassroom({
        classroomName,
        managerName,
        managerEmail,
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
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, reloadRemoteWorkspace, workspaceClassrooms.length])

  const updateClassroom = useCallback((classroomId: string, updates: {
    name?: string
    contractStatus?: WorkspaceClassroom['contractStatus']
    contractStartDate?: string
    contractEndDate?: string
    managerName?: string
    managerEmail?: string
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

  const replaceClassroomManagerUid = useCallback((classroomId: string, managerUserId: string) => {
    if (!isRemoteBackendEnabled || isRemoteAdminAutomationEnabled) {
      setPersistenceMessage('管理者 UID の差し替えは Spark 構成の Firebase 画面でのみ利用できます。')
      return
    }

    const normalizedManagerUserId = managerUserId.trim()
    if (!normalizedManagerUserId) {
      setPersistenceMessage('差し替え先の管理者 UID を入力してください。')
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
      managerEmail: currentManager.email,
      managerUserId: normalizedManagerUserId,
    }).then(async () => {
      await reloadRemoteWorkspace('管理者 UID を差し替えました。新しい Authentication ユーザーでこの教室へログインできます。', classroomId)
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '管理者 UID の差し替えに失敗しました。'
      setPersistenceMessage(message)
    })
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, reloadRemoteWorkspace, workspaceClassrooms, workspaceUsers])

  const deleteClassroom = useCallback((classroomId: string, password: string) => {
    if (isRemoteBackendEnabled) {
      if (!isRemoteAdminAutomationEnabled) {
        setPersistenceMessage('Spark 構成では教室削除をアプリから実行できません。Firebase Console で Auth ユーザーと Firestore ドキュメントを削除してください。')
        return
      }

      const targetClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
      if (!targetClassroom) return

      const confirmed = window.confirm(`「${targetClassroom.name || 'この教室'}」を削除します。関連する管理者アカウントも Firebase Auth から削除されます。続行しますか?`)
      if (!confirmed) {
        setPersistenceMessage('教室削除をキャンセルしました。')
        return
      }

      const fallbackClassroomId = actingClassroomId === classroomId
        ? (workspaceClassrooms.find((classroom) => classroom.id !== classroomId)?.id ?? null)
        : actingClassroomId

      void deleteFirebaseWorkspaceClassroom({ classroomId })
        .then(() => reloadRemoteWorkspace('教室を削除しました。Firebase Auth の管理者アカウントも整理しました。', fallbackClassroomId))
        .catch((error) => {
          const message = error instanceof Error ? error.message : '教室削除に失敗しました。'
          setPersistenceMessage(message)
        })
      return
    }

    if (workspaceClassrooms.length <= 1) {
      setPersistenceMessage('最後の1教室は削除できません。')
      return
    }

    if (password !== developerPassword) {
      setPersistenceMessage('開発者パスワードが一致しないため、教室を削除できませんでした。')
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
  }, [actingClassroomId, currentUser?.role, developerPassword, isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, openClassroom, reloadRemoteWorkspace, workspaceClassrooms])

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

  const syncDeveloperCloudAutoBackups = useCallback(async (handleOverride?: DeveloperCloudBackupDirectoryHandle | null) => {
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

    const entries = await loadWorkspaceAutoBackupEntries()
    const unsyncedEntries = entries.filter((entry) => !developerCloudSyncedAutoBackupKeys.includes(entry.backupDateKey))
    if (unsyncedEntries.length === 0) {
      const folderName = developerCloudBackupFolderName || targetHandle.name
      const message = `${folderName} と自動バックアップは同期済みです。`
      setDeveloperCloudBackupStatus(message)
      return { synced: false, message: '' }
    }

    for (const entry of unsyncedEntries) {
      await syncWorkspaceArtifactsToDeveloperCloudDirectory(entry.snapshot, targetHandle)
    }

    const syncedKeys = unsyncedEntries.map((entry) => entry.backupDateKey)
    setDeveloperCloudSyncedAutoBackupKeys((current) => Array.from(new Set([...current, ...syncedKeys])).sort())
    const folderName = developerCloudBackupFolderName || targetHandle.name
    const message = `${folderName} に ${syncedKeys.length} 件の未同期自動バックアップとAI分析用データを保存しました。`
    setDeveloperCloudBackupStatus(message)
    return { synced: true, message }
  }, [developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupHandle, developerCloudSyncedAutoBackupKeys])

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
        ? '保存フォルダを設定しました。以後は自動保存ごとに最新バックアップとAI分析用データを更新します。'
        : '保存フォルダを設定しました。今のセッション中は自動保存されますが、再起動後は再選択が必要です。')
      void syncDeveloperCloudAutoBackups(handle).catch(() => {
        setDeveloperCloudBackupStatus('保存フォルダの初回同期に失敗しました。')
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setDeveloperCloudBackupStatus('保存フォルダの選択をキャンセルしました。')
        return
      }
      const message = error instanceof Error ? error.message : '保存フォルダの設定に失敗しました。'
      setDeveloperCloudBackupStatus(`保存フォルダの設定に失敗しました。${message}`)
      setPersistenceMessage(`保存フォルダの設定に失敗しました。${message}`)
    }
  }, [syncDeveloperCloudAutoBackups])

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
    applyWorkspaceSnapshot(mergeResult.snapshot, `選択した教室だけ${developerRestoreModalState.sourceLabel}から復元しました。`)
    setDeveloperRestoreModalState(null)
  }, [applyWorkspaceSnapshot, developerRestoreModalState])

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

  const logout = useCallback(() => {
    syncCurrentClassroomData(actingClassroomId)
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
  }, [actingClassroomId, isRemoteBackendEnabled, syncCurrentClassroomData])

  const hasAnyExistingSetupData = useCallback(() => (
    managers.length > 0
    || teachers.length > 0
    || students.length > 0
    || regularLessons.length > 0
    || groupLessons.length > 0
    || specialSessions.some((session) => Object.keys(session.studentInputs).length > 0 || Object.keys(session.teacherInputs).length > 0)
    || autoAssignRules.some((rule) => rule.targets.length > 0 || rule.excludeTargets.length > 0)
    || pairConstraints.length > 0
    || boardState !== null
    || (classroomSettings.initialSetupMakeupStocks?.length ?? 0) > 0
    || (classroomSettings.initialSetupLectureStocks?.length ?? 0) > 0
  ), [autoAssignRules, boardState, classroomSettings.initialSetupLectureStocks, classroomSettings.initialSetupMakeupStocks, groupLessons.length, managers.length, pairConstraints.length, regularLessons.length, specialSessions, students.length, teachers.length])

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
        regularLessons,
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
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      students,
      regularLessons,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: studentPopup,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, regularLessons, scheduleQrConfig, specialSessions, studentScheduleRange, students, teachers])

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
        regularLessons,
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
        regularLessons,
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
      qrConfig: scheduleQrConfig,
      targetWindow: teacherPopup,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, regularLessons, scheduleQrConfig, specialSessions, students, teacherScheduleRange, teachers])

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
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      targetWindow: popupWindow,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, specialSessions, students, teachers])

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
        if (message.viewType === 'student') syncStudentSchedulePopup()
        if (message.viewType === 'teacher') syncTeacherSchedulePopup()
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
            nextStudentInputs[entry.personId] = {
              unavailableSlots: entry.unavailableSlots,
              regularBreakSlots: entry.regularBreakSlots,
              subjectSlots: entry.regularOnly ? {} : entry.subjectSlots,
              regularOnly: entry.regularOnly,
              countSubmitted: entry.countSubmitted,
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
  }, [syncStudentSchedulePopup, syncTeacherSchedulePopup])

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
    if (!isGoogleHolidaySyncEnabled) return
    if (holidaySyncBootstrapRef.current) return
    holidaySyncBootstrapRef.current = true

    const cache = readGoogleHolidaySyncCache()
    if (cache && classroomSettings.googleHolidayCalendarLastSyncedAt !== cache.lastSyncedAt) {
      setClassroomSettings((current) => ({
        ...current,
        holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], cache.syncedHolidayDates),
        googleHolidayCalendarSyncedDates: cache.syncedHolidayDates,
        googleHolidayCalendarLastSyncedAt: cache.lastSyncedAt,
      }))
    }

    void runGoogleHolidaySync({ background: true })

    if (!googleHolidayApiKey) return

    const intervalId = window.setInterval(() => {
      const latestCache = readGoogleHolidaySyncCache()
      if (latestCache?.lastSyncedAt && !shouldRefreshGoogleHolidayCache(latestCache.lastSyncedAt)) return
      void runGoogleHolidaySync({ background: true })
    }, 60 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [classroomSettings.googleHolidayCalendarLastSyncedAt, googleHolidayApiKey, isGoogleHolidaySyncEnabled, runGoogleHolidaySync])

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
          loadWorkspaceAutoBackupSummaries().catch(() => []),
          loadDeveloperCloudBackupHandle().catch(() => null),
        ]).then(([autoBackups, storedDeveloperCloudBackupHandle]) => {
          if (disposed) return
          setAutoBackupSummaries(autoBackups)
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
        loadWorkspaceAutoBackupSummaries().catch(() => []),
        loadDeveloperCloudBackupHandle().catch(() => null),
      ])
        .then(([remoteSnapshot, localWorkspaceSnapshot, autoBackups, storedDeveloperCloudBackupHandle]) => {
          if (disposed) return
          setAutoBackupSummaries(autoBackups)
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
      loadWorkspaceAutoBackupSummaries().catch(() => []),
      loadAppSnapshot().catch(() => null),
      loadDeveloperCloudBackupHandle().catch(() => null),
    ])
      .then(([workspaceSnapshot, autoBackups, legacySnapshot, storedDeveloperCloudBackupHandle]) => {
        if (disposed) return
        setAutoBackupSummaries(autoBackups)
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
    if (!developerCloudBackupEnabled) return
    if (!developerCloudBackupHandle) return

    void syncDeveloperCloudAutoBackups().catch(() => {
      setDeveloperCloudBackupStatus('保存フォルダへの未同期バックアップ同期に失敗しました。')
    })
  }, [developerCloudBackupEnabled, developerCloudBackupHandle, hasHydratedSnapshot, syncDeveloperCloudAutoBackups])

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

          try {
            const autoBackupResult = await saveDailyWorkspaceAutoBackup(snapshot)
            setAutoBackupSummaries(autoBackupResult.summaries)
          } catch {
            setPersistenceMessage('自動保存しましたが、自動バックアップの更新に失敗しました。')
          }

          if (isRemoteBackendEnabled && remoteSessionUserId) {
            try {
              await saveFirebaseWorkspaceSnapshot(snapshot, remoteSessionUserId)
              setPersistenceMessage('自動保存し、Firebase へ同期しました。')
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Firebase 同期に失敗しました。'
              setPersistenceMessage(`自動保存しましたが、${message}`)
            }
          }

          try {
            const cloudSyncResult = await syncDeveloperCloudAutoBackups()
            if (cloudSyncResult.synced) {
              setPersistenceMessage('自動保存し、保存フォルダへ未同期バックアップとAI分析用データを同期しました。')
            } else if (developerCloudBackupEnabled && cloudSyncResult.message) {
              setPersistenceMessage(`自動保存しましたが、${cloudSyncResult.message}`)
            }
          } catch {
            if (developerCloudBackupEnabled) {
              setDeveloperCloudBackupStatus('保存フォルダへの自動保存に失敗しました。')
              setPersistenceMessage('自動保存しましたが、保存フォルダへの自動保存に失敗しました。')
            }
          }
        })
        .catch(() => {
          setPersistenceMessage('自動保存に失敗しました。バックアップを書き出してください。')
        })
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [buildWorkspaceSnapshot, developerCloudBackupEnabled, hasHydratedSnapshot, isRemoteBackendEnabled, remoteSessionUserId, syncDeveloperCloudAutoBackups, workspaceClassrooms.length, workspaceUsers.length])

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

  const exportBackup = useCallback(() => {
    const snapshot: AppSnapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
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
    }
    downloadTextFile(formatBackupFileName(snapshot.savedAt, '手動バックアップ'), serializeAppSnapshot(snapshot), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('バックアップを書き出しました。')
  }, [autoAssignRules, boardState, classroomSettings, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers])

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

  const importWorkspaceBackup = useCallback(async (file: File, password: string) => {
    if (!isRemoteBackendEnabled && password !== developerPassword) {
      setPersistenceMessage('開発者パスワードが一致しないため、開発者バックアップを復元できませんでした。')
      return
    }

    try {
      const text = await file.text()
      const snapshot = parseWorkspaceSnapshot(text)
      openDeveloperRestoreModal(snapshot, '開発者バックアップ')
      setPersistenceMessage('復元する教室をモーダルで選択してください。')
    } catch {
      setPersistenceMessage('開発者バックアップの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }, [developerPassword, isRemoteBackendEnabled, openDeveloperRestoreModal])

  const importBackup = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const snapshot = parseAppSnapshot(text)
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
      applySnapshot(snapshot, 'バックアップを読み込みました。')
    } catch {
      setPersistenceMessage('バックアップの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }, [applySnapshot])

  const restoreAutoBackup = useCallback(async (backupDateKey: string) => {
    try {
      const snapshot = await loadWorkspaceAutoBackupSnapshot(backupDateKey)
      if (!snapshot) {
        setPersistenceMessage('指定した自動バックアップが見つかりませんでした。')
        return
      }
      const confirmed = window.confirm([
        '自動バックアップ時点へ復元します。',
        `保存日時: ${new Date(snapshot.savedAt).toLocaleString('ja-JP')}`,
        '現在のデータはこの内容で上書きされます。',
        '復元してよろしいですか?',
      ].join('\n'))
      if (!confirmed) {
        setPersistenceMessage('自動バックアップからの復元をキャンセルしました。')
        return
      }
      applyWorkspaceSnapshot(snapshot, '自動バックアップを読み込みました。')
    } catch {
      setPersistenceMessage('自動バックアップの読み込みに失敗しました。')
    }
  }, [applyWorkspaceSnapshot])

  const restoreDeveloperAutoBackup = useCallback(async (backupDateKey: string, password: string) => {
    if (!isRemoteBackendEnabled && password !== developerPassword) {
      setPersistenceMessage('開発者パスワードが一致しないため、自動バックアップを復元できませんでした。')
      return
    }

    try {
      const snapshot = await loadWorkspaceAutoBackupSnapshot(backupDateKey)
      if (!snapshot) {
        setPersistenceMessage('指定した自動バックアップが見つかりませんでした。')
        return
      }
      openDeveloperRestoreModal(snapshot, '自動バックアップ')
      setPersistenceMessage('復元する教室をモーダルで選択してください。')
    } catch {
      setPersistenceMessage('自動バックアップの読み込みに失敗しました。')
    }
  }, [developerPassword, isRemoteBackendEnabled, openDeveloperRestoreModal])

  const exportBasicDataTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, createBasicDataTemplateBundle()), '基本データテンプレート.xlsx')
    setPersistenceMessage('基本データの Excel テンプレートを出力しました。')
  }, [])

  const exportBasicDataCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, { managers, teachers, students, regularLessons, groupLessons, classroomSettings }), '基本データ_現在.xlsx')
    setPersistenceMessage('基本データを Excel 出力しました。')
  }, [classroomSettings, groupLessons, managers, regularLessons, students, teachers])

  const importInitialBasicDataWorkbook = useCallback(async (file: File) => {
    try {
      if (hasAnyExistingSetupData() && !window.confirm([
        '基本データを初期取り込みします。',
        '現在の基本データ、特別講習データ、自動割振ルール、盤面、開始時点ストックは初期化されます。',
        '続行しますか?',
      ].join('\n'))) {
        setPersistenceMessage('基本データの初期取り込みをキャンセルしました。')
        return
      }

      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const fallbackBundle = { managers, teachers, students, regularLessons, groupLessons, classroomSettings }
      const imported = parseImportedBundle(xlsx, workbook, fallbackBundle)
      const resetClassroomSettings = sanitizeClassroomSettingsWithHolidayCache({
        ...createInitialClassroomSettings(),
        ...imported.classroomSettings,
        closedWeekdays: imported.classroomSettings.closedWeekdays,
        holidayDates: imported.classroomSettings.holidayDates,
        forceOpenDates: imported.classroomSettings.forceOpenDates,
        deskCount: imported.classroomSettings.deskCount,
      })
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

      setManagers(initialImportedBundle.managers)
      setTeachers(initialImportedBundle.teachers)
      setStudents(initialImportedBundle.students)
      setRegularLessons(initialImportedBundle.regularLessons)
      setGroupLessons(initialImportedBundle.groupLessons)
      setClassroomSettings(initialImportedBundle.classroomSettings)
      setSpecialSessions(createInitialSpecialSessionRows())
      setAutoAssignRules(createInitialAutoAssignRuleRows())
      setPairConstraints(createInitialPairConstraintRows())
      setBoardState(createPackedInitialBoardState({
        classroomSettings: initialImportedBundle.classroomSettings,
        teachers: initialImportedBundle.teachers,
        students: initialImportedBundle.students,
        regularLessons: initialImportedBundle.regularLessons,
      }))
      setPersistenceMessage('基本データを初期取り込みしました。特別講習、ルール、盤面、開始時点ストックは初期化しました。')
      void runGoogleHolidaySync({ force: true, background: true })
    } catch {
      setPersistenceMessage('基本データの Excel 初期取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [classroomSettings, groupLessons, hasAnyExistingSetupData, managers, regularLessons, runGoogleHolidaySync, students, teachers])

  const importDiffBasicDataWorkbook = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const fallbackBundle = { managers, teachers, students, regularLessons, groupLessons, classroomSettings }
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
      setRegularLessons(merged.regularLessons)
      setGroupLessons(merged.groupLessons)
      setClassroomSettings(merged.classroomSettings)
      if (!boardState) {
        setBoardState(createPackedInitialBoardState({
          classroomSettings: merged.classroomSettings,
          teachers: merged.teachers,
          students: merged.students,
          regularLessons: merged.regularLessons,
        }))
      }
      if (!hasAnyExistingSetupData()) {
        setPersistenceMessage('基本データを Excel から取り込みました。初期盤面を生成しました。')
      } else {
        setPersistenceMessage('基本データの差分を Excel から取り込みました。特別講習、ルール、盤面、ストックは保持しています。')
      }
      void runGoogleHolidaySync({ force: true, background: true })
    } catch {
      setPersistenceMessage('基本データの Excel 差分取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [boardState, classroomSettings, groupLessons, hasAnyExistingSetupData, managers, regularLessons, runGoogleHolidaySync, students, teachers])

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
      regularLessons,
    }))
    setPersistenceMessage('初期設定を完了し、管理データと開始時点ストックを反映したコマ表にリセットしました。')
    setScreen('board')
  }, [classroomSettings, regularLessons, students, teachers])

  if (!hasHydratedSnapshot) {
    return <div className="workspace-auth-shell"><div className="workspace-auth-card"><h2>読み込み中</h2><p>教室ワークスペースを準備しています。</p></div></div>
  }

  if (!currentUser) {
    if (isRemoteBackendEnabled) {
      return (
        <div className="workspace-auth-shell">
          <div className="workspace-auth-card">
            <p className="panel-kicker">Firebase Auth</p>
            <h1>外部ログイン</h1>
            <p className="page-summary">外部データベースを有効化しているため、教室ワークスペースは Firebase 認証後に読み込みます。管理者は担当教室のみ、開発者は全教室へアクセスします。</p>
            <form className="workspace-auth-form" onSubmit={(event) => {
              event.preventDefault()
              void submitRemoteLogin()
            }}>
              <label className="workspace-auth-field">
                <span>メールアドレス</span>
                <input type="email" value={remoteLoginEmail} onChange={(event) => setRemoteLoginEmail(event.target.value)} autoComplete="username" />
              </label>
              <label className="workspace-auth-field">
                <span>パスワード</span>
                <input type="password" value={remoteLoginPassword} onChange={(event) => setRemoteLoginPassword(event.target.value)} autoComplete="current-password" />
              </label>
              <div className="workspace-auth-actions">
                <button className="primary-button" type="submit" disabled={isRemoteLoginSubmitting}>{isRemoteLoginSubmitting ? 'ログイン中...' : 'Firebase にログイン'}</button>
              </div>
            </form>
            {remoteAuthMessage ? <div className="workspace-auth-note workspace-auth-note-error">{remoteAuthMessage}</div> : null}
            <div className="workspace-auth-note">接続先の設定は `.env.example` と `firebase/firestore.rules` を参照してください。</div>
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
        firebaseWorkspaceKey={firebaseBackendConfig.workspaceKey}
        firebaseAuthDomain={firebaseBackendConfig.authDomain}
        persistenceMessage={persistenceMessage}
        developerPassword={developerPassword}
        onDeveloperPasswordChange={setDeveloperPassword}
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
        autoBackupSummaries={autoBackupSummaries}
        bulkTemporarySuspensionReason={bulkTemporarySuspensionReason}
        onBulkTemporarySuspensionReasonChange={setBulkTemporarySuspensionReason}
        areAllContractedClassroomsTemporarilySuspended={areAllContractedClassroomsTemporarilySuspended}
        onToggleContractedClassroomsTemporarySuspension={toggleContractedClassroomsTemporarySuspension}
        onUpdateClassroom={updateClassroom}
        onReplaceClassroomManagerUid={replaceClassroomManagerUid}
        onExportWorkspaceBackup={exportWorkspaceBackup}
        onExportAnalysisData={exportAnalysisData}
        onImportWorkspaceBackup={importWorkspaceBackup}
        onRestoreAutoBackup={restoreDeveloperAutoBackup}
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
        googleHolidaySyncState={googleHolidaySyncState}
        isGoogleHolidayApiConfigured={Boolean(googleHolidayApiKey) && isGoogleHolidaySyncEnabled}
        managers={managers}
        teachers={teachers}
        students={students}
        regularLessons={regularLessons}
        groupLessons={groupLessons}
        onUpdateManagers={setManagers}
        onUpdateTeachers={setTeachers}
        onUpdateStudents={setStudents}
        onUpdateRegularLessons={setRegularLessons}
        onUpdateGroupLessons={setGroupLessons}
        onUpdateClassroomSettings={setClassroomSettings}
        onSyncGoogleHolidays={() => void runGoogleHolidaySync({ force: true })}
        onBackToBoard={() => setScreen('board')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
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
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
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
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
        onLogout={logout}
      />
    )
  }

  if (screen === 'backup-restore') {
    return (
      <BackupRestoreScreen
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        onLogout={logout}
        persistenceMessage={persistenceMessage}
        lastSavedAt={lastSavedAt}
        autoBackupSummaries={autoBackupSummaries}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        onRestoreAutoBackup={restoreAutoBackup}
        classroomSettings={classroomSettings}
        students={students}
        specialSessions={specialSessions}
        googleHolidaySyncState={googleHolidaySyncState}
        isGoogleHolidayApiConfigured={isGoogleHolidaySyncEnabled}
        onUpdateClassroomSettings={setClassroomSettings}
        onSyncGoogleHolidays={() => void runGoogleHolidaySync({ force: true })}
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
      />
    )
  }

  return (
    <ScheduleBoardScreen
      classroomSettings={classroomSettings}
      teachers={teachers}
      students={students}
      regularLessons={regularLessons}
      specialSessions={specialSessions}
      autoAssignRules={autoAssignRules}
      pairConstraints={pairConstraints}
      teacherAutoAssignRequest={teacherAutoAssignRequest}
      studentScheduleRequest={studentScheduleRequest}
      initialBoardState={boardState}
      onBoardStateChange={setBoardState}
      onUpdateSpecialSessions={setSpecialSessions}
      onUpdateClassroomSettings={setClassroomSettings}
      onOpenBasicData={() => setScreen('basic-data')}
      onOpenSpecialData={() => setScreen('special-data')}
      onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
      onOpenBackupRestore={() => setScreen('backup-restore')}
      onLogout={logout}
    />
  )
}

export default App
