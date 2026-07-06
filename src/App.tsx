import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { BasicDataScreen, buildWorkbook as buildBasicDataWorkbook, createTemplateBundle as createBasicDataTemplateBundle, initialGroupLessons, initialManagers, mergeImportedBundle, parseImportedBundle, type GroupLessonRow } from './components/basic-data/BasicDataScreen'
import { validateImportedBasicDataBundle } from './components/basic-data/basicDataImportValidation'
import { AutoAssignRuleScreen, buildAutoAssignWorkbook, parseAutoAssignWorkbook } from './components/auto-assign-rules/AutoAssignRuleScreen'
import { autoAssignRuleDefinitions, backfillMissingAutoAssignRules, initialAutoAssignRules } from './components/auto-assign-rules/autoAssignRuleModel'
import { initialPairConstraints } from './types/pairConstraint'
import { deriveManagedDisplayName, getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, initialStudents, initialTeachers, isActiveOnDate, resolveCurrentStudentGradeLabel, type ManagerRow, type StudentRow, type TeacherRow } from './components/basic-data/basicDataModel'
import { createInitialRegularLessons, packSortRegularLessonRows, type RegularLessonRow } from './components/basic-data/regularLessonModel'
import { buildSpecialSessionWorkbook, buildTemplateSpecialSessions, parseSpecialSessionWorkbook, SpecialSessionScreen } from './components/special-data/SpecialSessionScreen'
import { groupClassSubmissionSubjects, initialSpecialSessions, removedDefaultSpecialSessionIds, resolveSavedGroupClassParticipation, type SpecialSessionRow } from './components/special-data/specialSessionModel'
import { ScheduleBoardScreen, buildScheduleCellsForRange, createPackedInitialBoardState, ensureWeeksCoverDateRange, normalizeScheduleRange, readStoredScheduleRange, type ScheduleRangePreference } from './components/schedule-board/ScheduleBoardScreen'
// C1: 初回読み込みを軽くするため、起動直後に出ない画面は遅延読み込みにする(コンポーネントのみ・補助関数は持たない)。
// 配布画面(BoardShareScreen)はそれ自体が重いチャンク。開発者画面/請求/バックアップ復元も初期経路外。
const BackupRestoreScreen = lazy(() => import('./components/backup-restore/BackupRestoreScreen').then((m) => ({ default: m.BackupRestoreScreen })))
const BoardShareScreen = lazy(() => import('./components/board-share/BoardShareScreen').then((m) => ({ default: m.BoardShareScreen })))
const DeveloperAdminScreen = lazy(() => import('./components/developer-admin/DeveloperAdminScreen').then((m) => ({ default: m.DeveloperAdminScreen })))
const BillingAutomationScreen = lazy(() => import('./components/billing/BillingAutomationScreen').then((m) => ({ default: m.BillingAutomationScreen })))
import { buildRegularLessonsFromTemplate, hasRegularLessonTemplateAssignments } from './components/regular-template/regularLessonTemplate'
import { importedMasterData } from './data/importedMasterData.generated'
import { deleteFirebaseWorkspaceClassroom, deleteFirebaseWorkspaceClassroomDirect, downloadClassroomFromFirebaseServerAutoBackup, downloadFirebaseServerAutoBackup, listDevelopmentClassroomBackupSources, listFirebaseServerAutoBackupSummaries, provisionFirebaseWorkspaceClassroom, provisionFirebaseWorkspaceClassroomWithExistingUid, reassignFirebaseWorkspaceClassroomManagerWithExistingUid, saveClassroomSnapshotViaFunction, triggerFirebaseServerAutoBackup, updateFirebaseWorkspaceClassroom, type DevelopmentClassroomBackupSources, type ServerAutoBackupSummary } from './integrations/firebase/adminFunctions'
import { createFirebaseAuthUser, getFirebaseCurrentUser, reauthenticateFirebaseUser, sendFirebasePasswordResetEmail, signInToFirebaseWithPassword, signOutFromFirebase, subscribeToFirebaseAuthChanges } from './integrations/firebase/client'
import { getFirebaseBackendConfig, isFirebaseAdminFunctionsEnabled, isFirebaseBackendEnabled } from './integrations/firebase/config'
import { loadFirebaseWorkspaceSnapshot } from './integrations/firebase/workspaceStore'
import { ensureSubmissionTokens, writeSubmissionDocs, markLectureSubmissionDocAsSubmitted, resetLectureSubmissionDoc, createRecentlyResetGuard, updateSubmissionOccupiedSlots, updateSubmissionGroupClassEligibility, subscribeLectureSubmissions, type SubmissionChangeEntry } from './integrations/firebase/lectureSubmission'
import type { SlotCell } from './components/schedule-board/types'
import { getWeekStart, shiftDate } from './components/schedule-board/mockData'
import { getAllClassroomSnapshotVersions } from './integrations/firebase/classroomSnapshotVersions'
import { isPendingClassroomWriteBackStale } from './data/pendingSnapshotVersionGuard'
import { clearDeveloperCloudBackupHandle, clearPendingRemoteWorkspaceSnapshotMarker, loadAppSnapshot, loadDeveloperCloudBackupHandle, loadWorkspaceSnapshot, markPendingRemoteWorkspaceSnapshotSync, parseAppSnapshot, parseWorkspaceSnapshot, readPendingRemoteWorkspaceSnapshotMarker, saveDailyWorkspaceAutoBackup, saveDeveloperCloudBackupHandle, saveWorkspaceSnapshot, serializeAppSnapshot, serializeWorkspaceSnapshot, writeWorkspaceToLocalStorageSync, type PendingRemoteWorkspaceSnapshotMarker } from './data/appSnapshotRepository'
import type { AppScreen, AppSnapshot, AppSnapshotPayload, ClassroomScreen, ClassroomSettings as SharedClassroomSettings, PersistedBoardState, WorkspaceClassroom, WorkspaceSnapshot, WorkspaceUser } from './types/appState'
import { formatWeeklyScheduleTitle, syncStudentScheduleHtml, syncTeacherScheduleHtml } from './utils/scheduleHtml'
import { compactBoardSharePayload, publishBoardShare } from './integrations/firebase/boardShare'
import { getSelectableStudentSubjectsForGrade } from './utils/studentGradeSubject'
import { useClassroomTabLock } from './utils/useClassroomTabLock'
import { useAppVersionMonitor } from './utils/useAppVersionMonitor'
import { isDevelopmentClassroom } from './utils/developmentClassroom'
import { isFeatureEnabledForClassroom } from './utils/featureRollout'
import { reflectParentOwnedSubmissionFields } from './utils/submissionReflection'
import { bumpMemCounter } from './utils/memoryDiagnostics'
import { trimBoardWeeksForMemory } from './components/schedule-board/boardWeekTrim'
import { resolveRegisteredGroupClassSubjects } from './components/schedule-board/groupClass'
import './App.css'

export type ClassroomSettings = SharedClassroomSettings

const PENDING_WORKSPACE_SNAPSHOT_WRITE_INTERVAL_MS = 5000

// 保存失敗時の作業指示(spec-save-restore.md §2)。自動リトライに頼らず、
// 自動ダウンロードしたバックアップを使って再ログイン後に復元する手順を明示する。
const SAVE_FAILURE_GUIDANCE_MESSAGE = [
  '保存に失敗しました。',
  '',
  'まず、インターネットに接続されているかご確認ください。',
  '通信が不安定な場合は、接続が回復してからもう一度「保存」をお試しください。',
  '',
  'データ保護のため、バックアップJSONを自動でダウンロードしました。',
  '接続が回復しても保存できない場合は、次の手順で復元してください。',
  '  1. インターネット接続を確認する',
  '  2. 一度ログアウトし、再ログインする',
  '  3. 「バックアップを読み込む」から、ダウンロードフォルダの最新バックアップを選ぶ',
].join('\n')

// C1: 遅延読み込み画面のロード中に出す軽量フォールバック。
function ScreenLoadingFallback() {
  return (
    <div className="workspace-auth-shell">
      <div className="workspace-auth-card">
        <h2>読み込み中</h2>
        <p>画面を準備しています。</p>
      </div>
    </div>
  )
}

// A1: サーバーが版数衝突(別端末が先に更新)を表す HttpsError メッセージに付ける安定マーカー。
// functions/src/optimisticVersion.ts の STALE_SNAPSHOT_ERROR_MARKER と一致させること。
const STALE_SNAPSHOT_ERROR_MARKER = 'STALE_SNAPSHOT'

function isStaleSnapshotConflictError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes(STALE_SNAPSHOT_ERROR_MARKER)
}

const STALE_SNAPSHOT_GUIDANCE_MESSAGE = [
  '別の端末でこの教室のデータが更新されました。',
  '',
  'このタブの変更は、最新データを上書きしないようクラウド保存を止めています。',
  'お手数ですが、次の手順でご対応ください。',
  '  1. データ保護のため、このタブの内容をバックアップJSONに書き出しました(ダウンロードフォルダ)',
  '  2. 画面を再読み込みして、最新のデータを取得してください',
  '  3. 必要な変更が最新データに無ければ、再度入力して保存してください',
  '',
  '※ コマ表は「1教室=1端末」での編集を前提にしています。複数の端末・タブで同時に開かないでください。',
].join('\n')

function createRemoteSaveId(savedAt: string, classroomId: string) {
  const uniqueId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${savedAt}_${classroomId}_${uniqueId}`.replace(/[^A-Za-z0-9_-]+/g, '-')
}

function isTransientFirebaseSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|timeout|timed out/i.test(message)
}

function useLatestState<T>(initialValue: T | (() => T)) {
  const [state, setState] = useState<T>(() => (typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue))
  const ref = useRef(state)
  // 最新 state を ref に同期する定番パターン(コールバックから最新値を読むため)。意図的。
  // eslint-disable-next-line react-hooks/refs
  ref.current = state

  const setLatestState = useCallback((nextValue: SetStateAction<T>) => {
    const resolvedValue = typeof nextValue === 'function'
      ? (nextValue as (currentValue: T) => T)(ref.current)
      : nextValue
    ref.current = resolvedValue
    setState(resolvedValue)
  }, [])

  return [state, setLatestState, ref] as const
}

export type TeacherAutoAssignItem = {
  sessionId: string
  teacherId: string
  mode: 'assign' | 'unassign'
}

export type TeacherAutoAssignRequest = {
  requestId: number
  // 1リクエストで複数講師ぶんを運ぶ。QR提出の一括取り込みで反映した講師全員を1リクエストにまとめ、
  // 受け手(ScheduleBoardScreen)が全件を盤面へ畳み込む。
  items: TeacherAutoAssignItem[]
}

// QR提出の一括取り込みで反映した講師全員ぶんの自動配置アイテムを作る。
// ⚠️ 回帰防止(2026-06-30): 以前は newlyAppliedEntries を for ループで1人ずつ
// setTeacherAutoAssignRequest していたが、リクエストは単一の useState のため、同一 Firestore
// スナップショットで複数講師の提出が届く(室長が起動/リロードした初回スナップショット等)と
// 最後の1人ぶんしか盤面配置されず、残りの講師が「出席不可を提出したのに出席可能コマに名前が
// 追加されない」不具合になっていた。全員を1リクエストの items にまとめて取りこぼしを無くす。
export function buildTeacherAutoAssignItems(
  entries: Array<{ personType: 'student' | 'teacher'; sessionId: string; personId: string }>,
): TeacherAutoAssignItem[] {
  return entries
    .filter((entry) => entry.personType === 'teacher')
    .map((entry) => ({ sessionId: entry.sessionId, teacherId: entry.personId, mode: 'assign' as const }))
}

export type StudentScheduleRequest = {
  requestId: number
  sessionId: string
  studentId: string
  mode: 'unassign'
}

export type SubmissionAcknowledgementEntry = {
  id: string
  sessionId: string
  sessionLabel: string
  personType: 'student' | 'teacher'
  personId: string
  personName: string
  classroomName: string
}

export function buildSubmissionAcknowledgementEntries(
  entries: SubmissionChangeEntry[],
  params: {
    specialSessions: SpecialSessionRow[]
    students: StudentRow[]
    teachers: TeacherRow[]
    classroomName?: string | null
  },
): SubmissionAcknowledgementEntry[] {
  const sessionLabelById = new Map(params.specialSessions.map((session) => [session.id, session.label]))
  const studentNameById = new Map(params.students.map((student) => [student.id, getStudentDisplayName(student)]))
  const teacherNameById = new Map(params.teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))

  return entries.map((entry) => ({
    id: `${entry.token}:${entry.sessionId}:${entry.personType}:${entry.personId}`,
    sessionId: entry.sessionId,
    sessionLabel: sessionLabelById.get(entry.sessionId) ?? entry.sessionId,
    personType: entry.personType,
    personId: entry.personId,
    personName: entry.personType === 'student'
      ? (studentNameById.get(entry.personId) ?? entry.personId)
      : (teacherNameById.get(entry.personId) ?? entry.personId),
    classroomName: params.classroomName?.trim() || '教室',
  }))
}

type SchedulePopupRuntimeWindow = Window & typeof globalThis & {
  __lessonScheduleStudentWindow?: Window | null
  __lessonScheduleTeacherWindow?: Window | null
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
  hourlyRetentionHours: number
  freeTierStorageBytes: number
}

const SERVER_AUTO_BACKUP_RETENTION_DAYS = 14
const SERVER_AUTO_BACKUP_HOURLY_RETENTION_HOURS = 72
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
  dataTimestampLabel?: string
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

function buildNormalizedScheduleRange(viewType: 'student' | 'teacher', range: ScheduleRangePreference | null, classroomStorageKey?: string | null) {
  const fallbackRange = getScheduleFallbackRange()
  return normalizeScheduleRange(
    range ?? readStoredScheduleRange(viewType, fallbackRange.startDate, fallbackRange.endDate, classroomStorageKey ?? undefined),
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

export function sanitizeClassroomSettings(settings: ClassroomSettings): ClassroomSettings {
  const initialSettings = createInitialClassroomSettings()
  const normalizedClosedWeekdays = Array.from(new Set(
    (Array.isArray(settings.closedWeekdays) ? settings.closedWeekdays : initialSettings.closedWeekdays)
      .filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 6),
  )).sort((left, right) => left - right)
  const normalizedHolidayDates = Array.from(new Set(
    (Array.isArray(settings.holidayDates) ? settings.holidayDates : initialSettings.holidayDates)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right))
  const normalizedForceOpenDates = Array.from(new Set(
    (Array.isArray(settings.forceOpenDates) ? settings.forceOpenDates : initialSettings.forceOpenDates)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right))
  const normalizedScheduleNotes = Object.fromEntries(Object.entries(settings.scheduleNotes ?? {})
    .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && entry[0].trim().length > 0 && typeof entry[1] === 'string'))

  return {
    ...initialSettings,
    ...settings,
    closedWeekdays: normalizedClosedWeekdays.length > 0 ? normalizedClosedWeekdays : initialSettings.closedWeekdays,
    holidayDates: normalizedHolidayDates,
    forceOpenDates: normalizedForceOpenDates,
    deskCount: Math.max(1, Number(settings.deskCount) || initialSettings.deskCount),
    scheduleNotes: normalizedScheduleNotes,
    boardShareToken: typeof settings.boardShareToken === 'string' ? settings.boardShareToken : initialSettings.boardShareToken,
    initialSetupCompletedAt: typeof settings.initialSetupCompletedAt === 'string' ? settings.initialSetupCompletedAt : initialSettings.initialSetupCompletedAt,
    initialSetupMakeupStocks: Array.isArray(settings.initialSetupMakeupStocks) ? settings.initialSetupMakeupStocks : initialSettings.initialSetupMakeupStocks,
    initialSetupLectureStocks: Array.isArray(settings.initialSetupLectureStocks) ? settings.initialSetupLectureStocks : initialSettings.initialSetupLectureStocks,
  }
}

function sanitizeSpecialSessions(sessions: AppSnapshotPayload['specialSessions']) {
  return sessions.filter((session) => !removedDefaultSpecialSessionIdSet.has(session.id))
}

// 自動割振ルールの label / description は定義(autoAssignRuleDefinitions)を正本とし、読込時に同期する。
// 旧教室データに残る古いラベル(例: 旧「1限禁止」→現「指定時限禁止」)を表示・Excel出力で最新名へ揃える。
// key 以外(対象/区分/禁止時限など)は保存値を尊重し、表示用の label/description だけ定義から補完する。
// さらに、新ルール追加(例: 科目分散)より前に保存されたデータに無いルール行を末尾へ補完する(backfillMissingAutoAssignRules)。
function sanitizeAutoAssignRules(rules: AppSnapshotPayload['autoAssignRules']): AppSnapshotPayload['autoAssignRules'] {
  if (!Array.isArray(rules)) return rules
  return backfillMissingAutoAssignRules(rules.map((rule) => {
    const definition = autoAssignRuleDefinitions.find((entry) => entry.key === rule.key)
    if (!definition) return rule
    if (rule.label === definition.label && rule.description === definition.description) return rule
    return { ...rule, label: definition.label, description: definition.description }
  }))
}

function sanitizeClassroomPayload(payload: AppSnapshotPayload): AppSnapshotPayload {
  return {
    ...payload,
    classroomSettings: sanitizeClassroomSettings(payload.classroomSettings),
    specialSessions: sanitizeSpecialSessions(payload.specialSessions),
    autoAssignRules: sanitizeAutoAssignRules(payload.autoAssignRules),
  }
}

export function buildDevelopmentClassroomCopyPayload(sourcePayload: AppSnapshotPayload): AppSnapshotPayload {
  // 【本番データ混入防止・最優先】他教室→開発用教室コピーでは、コピー先(開発用)とコピー元(他教室)が
  // students / teachers / regularLessons / regularLessonTemplate などのネスト配列・オブジェクト参照を
  // 共有してはならない。共有していると、コピー後に開発用教室を編集した際にコピー元(他教室)のメモリ上
  // データまで書き換わり、全教室保存経路で他教室の Firestore に開発用データが混入する。
  // sanitizeClassroomPayload は浅いコピー(配列参照をそのまま保持)のため、コピー元を必ずディープクローン
  // してから加工し、両教室が一切の参照を共有しないようにする。
  const isolatedSource = cloneInitialValue(sourcePayload)
  const sanitizedSource = sanitizeClassroomPayload(isolatedSource)

  return sanitizeClassroomPayload({
    ...sanitizedSource,
    screen: 'board',
    classroomSettings: {
      ...sanitizedSource.classroomSettings,
      boardShareToken: '',
    },
    specialSessions: sanitizedSource.specialSessions.map((session) => ({
      ...session,
      teacherInputs: Object.fromEntries(Object.entries(session.teacherInputs).map(([personId, input]) => {
        const { submissionToken: _submissionToken, ...restInput } = input
        return [personId, restInput]
      })),
      studentInputs: Object.fromEntries(Object.entries(session.studentInputs).map(([personId, input]) => {
        const { submissionToken: _submissionToken, ...restInput } = input
        return [personId, restInput]
      })),
    })),
  })
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

// 【本番データ混入防止・最優先】Firebase 同期で書き込む教室を決める。
// かつては targetClassroomIds 未指定だと【全教室】を書いていたが、これが混入の増幅器だった
// (メモリ/ローカルに古い・混入した他教室データがあると、それを全教室へ永続化して他教室を破壊する)。
// 対象未指定でも全教室は書かず、操作中の教室のみに限定する。複数教室を書く正当な操作(復元など)は
// 呼び出し側が対象IDを明示する。acting 不明なら何も書かない(安全側に倒す)。
export function resolveWorkspaceSyncTargetClassrooms(
  classrooms: WorkspaceClassroom[],
  targetClassroomIds: string[] | undefined,
  actingClassroomId: string | null,
): WorkspaceClassroom[] {
  if (targetClassroomIds && targetClassroomIds.length > 0) {
    const idSet = new Set(targetClassroomIds)
    return classrooms.filter((classroom) => idSet.has(classroom.id))
  }
  if (actingClassroomId) {
    return classrooms.filter((classroom) => classroom.id === actingClassroomId)
  }
  return []
}

// 【本番データ混入防止・2026-06-21 インシデント回帰防止】
// 編集中の state(students 等)は「読み込んだ教室(loadedEditingClassroomId)」のものである。
// これを別教室のドキュメントへ書き込むと、ある教室が別教室のデータで上書きされる混入が起きる。
// したがって編集 state を教室へ反映してよいのは、対象教室が現在の acting であり、かつ
// その acting が「編集 state を読み込んだ教室」と一致するときに限る。
export function shouldInjectEditingStateIntoClassroom(
  classroomId: string,
  actingClassroomId: string | null,
  loadedEditingClassroomId: string | null,
): boolean {
  if (!actingClassroomId) return false
  if (classroomId !== actingClassroomId) return false
  return loadedEditingClassroomId === actingClassroomId
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

function buildDeveloperRestoreModalState(currentSnapshot: WorkspaceSnapshot, restoringSnapshot: WorkspaceSnapshot, sourceLabel: string, dataTimestampLabel?: string): DeveloperRestoreModalState {
  const currentClassroomById = new Map(currentSnapshot.classrooms.map((classroom) => [classroom.id, classroom]))
  const restoringManagerById = new Map(restoringSnapshot.users.filter((user) => user.role === 'manager').map((user) => [user.id, user.name]))
  return {
    sourceLabel,
    dataTimestampLabel,
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

async function syncWorkspaceArtifactsToDeveloperCloudDirectory(snapshot: WorkspaceSnapshot, handle: DeveloperCloudBackupDirectoryHandle) {
  await writeTextFileToDeveloperCloudDirectory(handle, getDeveloperCloudBackupFileName(snapshot.savedAt), serializeWorkspaceSnapshot(snapshot))
}

function cloneInitialValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

export function buildWorkspaceNavigationSnapshot(params: {
  snapshot: WorkspaceSnapshot
  classroomId: string
  nextScreen: AppScreen
  savedAt: string
}) {
  const targetClassroom = params.snapshot.classrooms.find((classroom) => classroom.id === params.classroomId)
  if (!targetClassroom) return params.snapshot

  return {
    ...params.snapshot,
    savedAt: params.savedAt,
    actingClassroomId: params.classroomId,
    classrooms: params.snapshot.classrooms.map((classroom) => classroom.id === params.classroomId
      ? {
          ...classroom,
          data: {
            ...classroom.data,
            screen: params.nextScreen === 'developer' ? 'board' : params.nextScreen,
          },
        }
      : classroom),
  }
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
    scheduleNotes: {},
    boardShareToken: '',
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
  setBoardMountKey?: (updater: (prev: number) => number) => void
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
  handlers.setBoardMountKey?.((prev) => prev + 1)
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

export function clampScreenForUserRole(screen: AppScreen, role: WorkspaceUser['role'] | null | undefined): AppScreen {
  if (role === 'developer') return screen
  return screen === 'developer' ? 'board' : screen
}

export function resolveInitialScreenForUser(
  classroomScreen: ClassroomScreen | null | undefined,
  role: WorkspaceUser['role'] | null | undefined,
): AppScreen {
  if (role === 'developer') return 'developer'
  if (!classroomScreen) return 'board'
  return clampScreenForUserRole(classroomScreen, role)
}

export function resolveHydratedScreenForUser(params: {
  classroomScreen: ClassroomScreen | null | undefined
  role: WorkspaceUser['role'] | null | undefined
  currentScreen: AppScreen
  previousUserId: string
  nextUserId: string
}): AppScreen {
  if (params.role !== 'developer') {
    return resolveInitialScreenForUser(params.classroomScreen, params.role)
  }

  const isSameDeveloperSession = Boolean(params.previousUserId) && params.previousUserId === params.nextUserId
  if (isSameDeveloperSession && params.currentScreen !== 'developer') {
    return clampScreenForUserRole(params.classroomScreen ?? 'board', params.role)
  }
  return 'developer'
}

export function shouldReturnDeveloperOnLogout(
  screen: AppScreen,
  role: WorkspaceUser['role'] | null | undefined,
) {
  return role === 'developer' && screen !== 'developer'
}

export function shouldSyncCurrentClassroomBeforeOpen(
  currentScreen: AppScreen,
  role: WorkspaceUser['role'] | null | undefined,
) {
  return !(role === 'developer' && currentScreen === 'developer')
}

export function hasPendingBoardSaveState(params: {
  isDirty: boolean
  isSavingNow: boolean
  isRemoteSyncPending: boolean
}) {
  return params.isDirty || params.isSavingNow || params.isRemoteSyncPending
}


function mergeWorkspaceWithLocalPreferences(remoteSnapshot: WorkspaceSnapshot, localSnapshot: WorkspaceSnapshot | null) {
  if (!localSnapshot) return remoteSnapshot

  const merged: WorkspaceSnapshot = {
    ...remoteSnapshot,
    developerCloudBackupEnabled: localSnapshot.developerCloudBackupEnabled ?? remoteSnapshot.developerCloudBackupEnabled,
    developerCloudBackupFolderName: localSnapshot.developerCloudBackupFolderName ?? remoteSnapshot.developerCloudBackupFolderName,
    developerCloudSyncedAutoBackupKeys: localSnapshot.developerCloudSyncedAutoBackupKeys ?? remoteSnapshot.developerCloudSyncedAutoBackupKeys,
  }

  // NOTE: We intentionally do NOT merge local classroom data over remote here.
  // Firebase is the source of truth for classroom data in remote backend mode.
  // Allowing local to override remote based on savedAt caused stale/empty local
  // snapshots to wipe restored data on next login (e.g. after a backup restore).
  // Offline edits are still persisted to Firebase via the autosave + visibility
  // change handlers, so remote stays current under normal usage.

  const isRecentLocalSnapshot = Math.abs(getTimestampMillis(localSnapshot.savedAt) - Date.now()) <= 5 * 60 * 1000
  const localCurrentUser = localSnapshot.users.find((user) => user.id === localSnapshot.currentUserId) ?? null
  if (isRecentLocalSnapshot && localCurrentUser?.role === 'developer') {
    const localActingClassroomId = localSnapshot.actingClassroomId
    if (localActingClassroomId && merged.classrooms.some((classroom) => classroom.id === localActingClassroomId)) {
      merged.actingClassroomId = localActingClassroomId
      const localActingClassroom = localSnapshot.classrooms.find((classroom) => classroom.id === localActingClassroomId) ?? null
      if (localActingClassroom) {
        merged.classrooms = merged.classrooms.map((classroom) => classroom.id === localActingClassroomId
          ? {
              ...classroom,
              data: {
                ...classroom.data,
                screen: localActingClassroom.data.screen,
              },
            }
          : classroom)
      }
    }
  }

  return merged
}

function getTimestampMillis(value: string) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function haveSameWorkspaceIds(left: WorkspaceSnapshot, right: WorkspaceSnapshot) {
  const leftUserIds = left.users.map((user) => user.id).sort()
  const rightUserIds = right.users.map((user) => user.id).sort()
  const leftClassroomIds = left.classrooms.map((classroom) => classroom.id).sort()
  const rightClassroomIds = right.classrooms.map((classroom) => classroom.id).sort()
  return JSON.stringify(leftUserIds) === JSON.stringify(rightUserIds)
    && JSON.stringify(leftClassroomIds) === JSON.stringify(rightClassroomIds)
}

function resolvePendingLocalClassroomSnapshotForAuthenticatedUser(
  remoteSnapshot: WorkspaceSnapshot,
  localSnapshot: WorkspaceSnapshot | null,
  marker: PendingRemoteWorkspaceSnapshotMarker | null,
  authenticatedUserId: string,
  remoteClassroomVersions?: Record<string, number>,
) {
  if (!localSnapshot || !marker) return null
  if (marker.savedAt !== localSnapshot.savedAt) return null
  if (getTimestampMillis(localSnapshot.savedAt) <= getTimestampMillis(remoteSnapshot.savedAt)) return null
  if (marker.authenticatedUserId === authenticatedUserId) return null

  const authenticatedUser = remoteSnapshot.users.find((user) => user.id === authenticatedUserId) ?? null
  if (authenticatedUser?.role !== 'manager' || !authenticatedUser.assignedClassroomId) return null
  if (!marker.targetClassroomIds?.includes(authenticatedUser.assignedClassroomId)) return null

  // A3(2026-07-06): 別端末が後からこの教室を保存済み(サーバー版数がローカル基準版数より進行)なら、
  // 古いローカルで上書きせずリモートを優先する(savedAt の壁時計比較だけに頼らない)。
  if (isPendingClassroomWriteBackStale({
    classroomId: authenticatedUser.assignedClassroomId,
    baseClassroomVersions: marker.baseClassroomVersions,
    remoteClassroomVersions,
  })) return null

  const localAssignedClassroom = localSnapshot.classrooms.find((classroom) => classroom.id === authenticatedUser.assignedClassroomId) ?? null
  if (!localAssignedClassroom) return null
  if (!remoteSnapshot.classrooms.some((classroom) => classroom.id === authenticatedUser.assignedClassroomId)) return null

  return {
    snapshot: {
      ...remoteSnapshot,
      savedAt: localSnapshot.savedAt,
      actingClassroomId: authenticatedUser.assignedClassroomId,
      classrooms: remoteSnapshot.classrooms.map((classroom) => classroom.id === authenticatedUser.assignedClassroomId
        ? normalizeWorkspaceClassroom(localAssignedClassroom)
        : classroom),
    },
    pendingTargetClassroomIds: [authenticatedUser.assignedClassroomId],
  }
}

// A4(2026-07-06): 講習提出トークンの自動発行を specialSessions へ反映するときの「マージ」規則。
// ★消してはならないガード(講習が数分後に未配置へ戻る不具合の是正):
//   ensureScheduleSubmissionTokens は関数開始時点の session スナップショットから updatedSession を
//   組み立て、その後 await writeSubmissionDocs(ネットワーク) を挟んでから state へ反映する。旧実装は
//   setSpecialSessions(current => current.map(s => s.id===updatedSession.id ? updatedSession : s)) と
//   updatedSession で対象セッションを丸ごと置換していたため、await 中に届いた別生徒のQR提出反映
//   (subscribeLectureSubmissions → countSubmitted=true / subjectSlots)を古いスナップショットが上書きし、
//   その生徒が未提出へ巻き戻る → 未提出配置除去 effect(resolveNewlyUnsubmittedSessionStudents)が
//   盤面の割振済み講習を外し講習残数が満数へ戻る(「割り振ったのに数分後に戻る」の本体)。
//   よって「新規発行トークンの追加/後埋め」だけを current(最新)へマージし、既存エントリの
//   countSubmitted / subjectSlots 等は current を保持する(スナップショットで巻き戻さない)。
export function applyIssuedSubmissionTokensToSessions(
  currentSessions: SpecialSessionRow[],
  sessionId: string,
  issuedTokens: Array<{ personType: 'student' | 'teacher'; personId: string; token: string }>,
  updatedAt: string,
): SpecialSessionRow[] {
  if (issuedTokens.length === 0) return currentSessions
  return currentSessions.map((session) => {
    if (session.id !== sessionId) return session
    const nextStudentInputs = { ...session.studentInputs }
    const nextTeacherInputs = { ...session.teacherInputs }
    let changed = false
    for (const issued of issuedTokens) {
      if (issued.personType === 'student') {
        const existing = nextStudentInputs[issued.personId]
        if (existing) {
          // 既存エントリはトークンが無いときだけ後埋め。他フィールド(countSubmitted/subjectSlots 等)は
          // current(最新)を保持し、古いスナップショットで巻き戻さない。
          if (!existing.submissionToken) {
            nextStudentInputs[issued.personId] = { ...existing, submissionToken: issued.token }
            changed = true
          }
        } else {
          nextStudentInputs[issued.personId] = {
            unavailableSlots: [],
            regularBreakSlots: [],
            subjectSlots: {},
            regularOnly: false,
            countSubmitted: false,
            submissionToken: issued.token,
            updatedAt,
          }
          changed = true
        }
      } else {
        const existing = nextTeacherInputs[issued.personId]
        if (existing) {
          if (!existing.submissionToken) {
            nextTeacherInputs[issued.personId] = { ...existing, submissionToken: issued.token }
            changed = true
          }
        } else {
          nextTeacherInputs[issued.personId] = {
            unavailableSlots: [],
            countSubmitted: false,
            submissionToken: issued.token,
            updatedAt,
          }
          changed = true
        }
      }
    }
    if (!changed) return session
    return { ...session, studentInputs: nextStudentInputs, teacherInputs: nextTeacherInputs, updatedAt }
  })
}

export function resolveRemoteWorkspaceSnapshot(
  remoteSnapshot: WorkspaceSnapshot,
  localSnapshot: WorkspaceSnapshot | null,
  marker: PendingRemoteWorkspaceSnapshotMarker | null,
  authenticatedUserId: string,
  remoteClassroomVersions?: Record<string, number>,
) {
  const mergedRemote = mergeWorkspaceWithLocalPreferences(remoteSnapshot, localSnapshot)
  const pendingLocalClassroom = resolvePendingLocalClassroomSnapshotForAuthenticatedUser(
    mergedRemote,
    localSnapshot,
    marker,
    authenticatedUserId,
    remoteClassroomVersions,
  )
  if (pendingLocalClassroom) {
    return {
      snapshot: pendingLocalClassroom.snapshot,
      usedPendingLocalSnapshot: true,
      pendingTargetClassroomIds: pendingLocalClassroom.pendingTargetClassroomIds,
    }
  }
  if (!localSnapshot || !marker) return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }
  if (marker.authenticatedUserId !== authenticatedUserId) return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }
  if (marker.savedAt !== localSnapshot.savedAt) return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }
  if (getTimestampMillis(localSnapshot.savedAt) <= getTimestampMillis(remoteSnapshot.savedAt)) return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }
  if (!haveSameWorkspaceIds(localSnapshot, remoteSnapshot)) return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }

  // A3(2026-07-06): 教室単位の版数ゲート。savedAt(壁時計・端末間で数分ズレる)で「ローカルが新しい」と
  // 判定されても、別端末が後からその教室を保存済み(サーバー版数がマーカー基準版数より進行)なら、
  // その教室はリモートを優先して stale 上書きを防ぐ。サーバーの楽観ロックは書き戻し直前の再読込で
  // baseVersion が最新へ更新され素通りしてしまうため、ここでクライアント側でも二重に塞ぐ。
  const effectiveTargetIds = (marker.targetClassroomIds && marker.targetClassroomIds.length > 0)
    ? marker.targetClassroomIds
    : (localSnapshot.actingClassroomId ? [localSnapshot.actingClassroomId] : [])
  const staleTargetIds = effectiveTargetIds.filter((classroomId) => isPendingClassroomWriteBackStale({
    classroomId,
    baseClassroomVersions: marker.baseClassroomVersions,
    remoteClassroomVersions,
  }))
  if (staleTargetIds.length > 0) {
    const safeTargetIds = effectiveTargetIds.filter((classroomId) => !staleTargetIds.includes(classroomId))
    if (safeTargetIds.length === 0) {
      // 書き戻し対象が全て stale = 別端末の最新をそのまま採用する(ローカルは破棄)。
      return { snapshot: mergedRemote, usedPendingLocalSnapshot: false, pendingTargetClassroomIds: undefined }
    }
    // safe な教室だけローカルを採用し、stale な教室はリモート最新を残す。
    const mergedClassrooms = mergedRemote.classrooms.map((remoteClassroom) => {
      if (!safeTargetIds.includes(remoteClassroom.id)) return remoteClassroom
      return localSnapshot.classrooms.find((classroom) => classroom.id === remoteClassroom.id) ?? remoteClassroom
    })
    return {
      snapshot: { ...localSnapshot, classrooms: mergedClassrooms },
      usedPendingLocalSnapshot: true,
      pendingTargetClassroomIds: safeTargetIds,
    }
  }

  return {
    snapshot: localSnapshot,
    usedPendingLocalSnapshot: true,
    pendingTargetClassroomIds: marker.targetClassroomIds,
  }
}

// A2: タブが「隠れた」瞬間(別タブ/別アプリへ切替・最小化)に workspace をクラウド同期すべきか。
// 旧実装は無条件に丸ごと送信していたため、朝開いたまま放置したタブを夕方ちょっと触っただけで
// 古いデータが送信され、別端末で行った最新の編集を上書きする事故が起きえた。
// 未変更(hasUnsavedChanges=false)なら送信しない。handleBeforeUnload と同じ未変更判定に揃える。
export function shouldSyncWorkspaceOnVisibilityHidden(params: {
  isHidden: boolean
  hasWorkspaceData: boolean
  isRemoteBackendEnabled: boolean
  remoteSessionUserId: string | null
  hasUnsavedChanges: boolean
}): boolean {
  if (!params.isHidden) return false
  if (!params.hasWorkspaceData) return false
  if (!params.isRemoteBackendEnabled || !params.remoteSessionUserId) return false
  return params.hasUnsavedChanges
}

function getBoardShareTokenFromUrl() {
  const queryToken = new URLSearchParams(window.location.search).get('boardShare')?.trim()
  if (queryToken) return queryToken

  const hashMatch = window.location.hash.match(/^#\/?board-share\/([^/?#]+)/)
  if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]).trim()

  const pathMatch = window.location.pathname.match(/^\/board-share\/([^/]+)\/?$/)
  return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]).trim() : ''
}

function getStoredBoardShareToken(classroomId: string) {
  const storageKey = `boardShareToken:${classroomId}`
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored) return stored
    const token = window.crypto?.randomUUID?.() ?? `${classroomId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.localStorage.setItem(storageKey, token)
    return token
  } catch {
    return window.crypto?.randomUUID?.() ?? `${classroomId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function getBoardShareOrigin() {
  if (window.location.origin === 'https://komahyouapp-prod.web.app') {
    return 'https://komahyouapp-prod.firebaseapp.com'
  }
  return window.location.origin
}

function buildBoardShareUrl(token: string) {
  return `${getBoardShareOrigin()}/share.html?token=${encodeURIComponent(token)}`
}

// 配布用盤面には「現在週（今日を含む週）以降」のセルだけを含める。過去週を除外することで
// 配布ペイロードを縮小しつつ、配布先では現在〜先の予定を表示できる（手動編集済みの先の週も含まれる）。
function selectBoardShareCells(weeks: SlotCell[][]): SlotCell[] {
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
  const cells: SlotCell[] = []
  for (const week of weeks) {
    if (!Array.isArray(week) || week.length === 0) continue
    let maxDateKey = ''
    for (const cell of week) {
      if (cell.dateKey > maxDateKey) maxDateKey = cell.dateKey
    }
    if (maxDateKey >= todayKey) {
      for (const cell of week) cells.push(cell)
    }
  }
  // 現在週以降が1件も無い（過去週しか保持していない）場合は、空配信を避けて全週にフォールバック。
  return cells.length > 0 ? cells : weeks.flat()
}

// メモリ削減のため盤面の週を「表示範囲＋手動編集週」に絞る。週配列が変わると weekIndex が
// ズレるため、トリム後に「見ていた週」を dateKey で再特定して weekIndex を補正する
// （見えなくなった未編集の遠い週は今週へフォールバック）。
function trimBoardStateForMemory(boardState: PersistedBoardState | null | undefined): PersistedBoardState | null {
  if (!boardState) return boardState ?? null
  const weeks = boardState.weeks
  if (!Array.isArray(weeks) || weeks.length <= 1) return boardState
  const trimmedWeeks = trimBoardWeeksForMemory(weeks)
  if (trimmedWeeks === weeks) return boardState

  const prevIndex = Math.min(Math.max(boardState.weekIndex ?? 0, 0), weeks.length - 1)
  const viewedDateKey = weeks[prevIndex]?.[0]?.dateKey ?? ''
  let nextIndex = viewedDateKey ? trimmedWeeks.findIndex((week) => week[0]?.dateKey === viewedDateKey) : -1
  if (nextIndex < 0) {
    const now = new Date()
    const todayKey = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
    nextIndex = trimmedWeeks.findIndex((week) => week.reduce((max, cell) => (cell.dateKey > max ? cell.dateKey : max), '') >= todayKey)
    if (nextIndex < 0) nextIndex = 0
  }
  return { ...boardState, weeks: trimmedWeeks, weekIndex: nextIndex }
}

// 配布用トークンを教室 ID で必ず一意化する（冪等）。
// boardShareToken がバックアップ復元や教室データのコピーで別教室へ複製されても、
// 公開先ドキュメント boardShares/{token} と QR トークンが教室ごとに必ず異なるようにし、
// 異なる教室のデータで上書き・表示されるのを防ぐ。
export function buildClassroomScopedBoardShareToken(classroomId: string, baseToken: string) {
  const safeClassroomId = (classroomId ?? '').trim()
  const safeBaseToken = (baseToken ?? '').trim()
  if (!safeClassroomId) return safeBaseToken
  const prefix = `${safeClassroomId}__`
  return safeBaseToken.startsWith(prefix) ? safeBaseToken : `${prefix}${safeBaseToken}`
}

function resolveBoardShareToken(classroomId: string, classroomSettings: ClassroomSettings) {
  const baseToken = classroomSettings.boardShareToken || getStoredBoardShareToken(classroomId)
  return buildClassroomScopedBoardShareToken(classroomId, baseToken)
}

// データ署名（ダーティ判定用）はスライスごとに分割して結合する。
// こうすることで dataSignature をスライス単位でメモ化でき、生徒1人の編集で盤面全体を
// 再 stringify する無駄を避けられる。3つの生成器（dataSignature / buildCurrentDataSignature /
// buildClassroomDataSignature）が必ず同一フォーマットになるよう共通化する（ズレるとダーティ判定が壊れる）。
const DATA_SIGNATURE_SEPARATOR = ''

function buildBoardDataForSignature(boardState: PersistedBoardState | null | undefined) {
  if (!boardState) return null
  return {
    weeks: boardState.weeks,
    suppressedRegularLessonOccurrences: boardState.suppressedRegularLessonOccurrences,
    scheduleCountAdjustments: boardState.scheduleCountAdjustments,
    manualMakeupAdjustments: boardState.manualMakeupAdjustments,
    suppressedMakeupOrigins: boardState.suppressedMakeupOrigins,
    fallbackMakeupStudents: boardState.fallbackMakeupStudents,
    manualLectureStockCounts: boardState.manualLectureStockCounts,
    manualLectureStockOrigins: boardState.manualLectureStockOrigins,
    fallbackLectureStockStudents: boardState.fallbackLectureStockStudents,
    // spec-group-lesson §G: 集団授業の変更を未保存(ダーティ)として検知させる。
    // 含めないと集団の科目/講師/出欠を変えても保存対象と認識されない回帰になる。
    groupClassEntries: boardState.groupClassEntries,
  }
}

function stringifySignaturePart(value: unknown): string {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : 'null'
  } catch {
    return ' '
  }
}

type DataSignatureSlices = {
  regularLessons: unknown
  students: unknown
  teachers: unknown
  specialSessions: unknown
  autoAssignRules: unknown
  pairConstraints: unknown
  classroomSettings: unknown
  managers: unknown
  groupLessons: unknown
}

// boardSignaturePart は事前に stringify 済み（メモ再利用のため）、残りは生値を受け取る。
function combineDataSignature(boardSignaturePart: string, slices: DataSignatureSlices): string {
  return [
    boardSignaturePart,
    stringifySignaturePart(slices.regularLessons),
    stringifySignaturePart(slices.students),
    stringifySignaturePart(slices.teachers),
    stringifySignaturePart(slices.specialSessions),
    stringifySignaturePart(slices.autoAssignRules),
    stringifySignaturePart(slices.pairConstraints),
    stringifySignaturePart(slices.classroomSettings),
    stringifySignaturePart(slices.managers),
    stringifySignaturePart(slices.groupLessons),
  ].join(DATA_SIGNATURE_SEPARATOR)
}

function AuthenticatedApp() {
  bumpMemCounter('app-render')
  const isRemoteBackendEnabled = isFirebaseBackendEnabled()
  const isRemoteAdminAutomationEnabled = isFirebaseAdminFunctionsEnabled()
  const firebaseBackendConfig = getFirebaseBackendConfig()
  const isBillingRoute = window.location.pathname.replace(/\/+$/u, '') === '/billing'
  const useImportedMasterData = shouldUseImportedMasterData()
  useAppVersionMonitor(__APP_VERSION__)
  const initialSetupAutoOpenRef = useRef(false)
  const remoteClassroomUpdateTimeoutsRef = useRef<Record<string, number>>({})
  const teacherAutoAssignRequestIdRef = useRef(0)
  const studentScheduleRequestIdRef = useRef(0)
  // 監査領域7 B4 の是正: 登録解除直後にリセット前の submitted 購読で countSubmitted が復活する
  // レースを塞ぐガード（消してはならない）。reset 前に token を add し、TTL 経過まで購読反映を無視する。
  const recentlyResetSubmissionGuardRef = useRef(createRecentlyResetGuard())
  const [screen, setScreen, screenRef] = useLatestState<AppScreen>('board')
  const [managers, setManagers, managersRef] = useLatestState<ManagerRow[]>(() => createInitialManagers())
  const [teachers, setTeachers, teachersRef] = useLatestState(() => createInitialTeachers(useImportedMasterData))
  const [students, setStudents, studentsRef] = useLatestState(() => createInitialStudents(useImportedMasterData))
  const [regularLessons, setRegularLessons, regularLessonsRef] = useLatestState(() => createInitialRegularLessonRows(useImportedMasterData))
  const [groupLessons, setGroupLessons, groupLessonsRef] = useLatestState<GroupLessonRow[]>(() => createInitialGroupLessonRows())
  const [specialSessions, setSpecialSessions, specialSessionsRef] = useLatestState(() => createInitialSpecialSessionRows())
  const [autoAssignRules, setAutoAssignRules, autoAssignRulesRef] = useLatestState(() => createInitialAutoAssignRuleRows())
  const [pairConstraints, setPairConstraints, pairConstraintsRef] = useLatestState(() => createInitialPairConstraintRows())
  const [classroomSettings, setClassroomSettings, classroomSettingsRef] = useLatestState<ClassroomSettings>(() => createInitialClassroomSettings())
  const [boardState, setBoardState, boardStateRef] = useLatestState<PersistedBoardState | null>(null)
  const boardShareStateChangePublishTimerRef = useRef<number | null>(null)
  // boardShare 公開の多重発行ガード。出席などの連続編集で同一内容を何度も setDoc し、
  // Firestore 書き込みキューが枯渇 (resource-exhausted) してメモリが暴走するのを防ぐ。
  const boardSharePublishInFlightRef = useRef(false)
  const boardSharePendingStateRef = useRef<PersistedBoardState | null>(null)
  const lastPublishedBoardShareSignatureRef = useRef<string | null>(null)
  const publishBoardStateSnapshotRef = useRef<(state: PersistedBoardState) => void>(() => {})
  const [boardMountKey, setBoardMountKey] = useState(0)
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherAutoAssignRequest, setTeacherAutoAssignRequest] = useState<TeacherAutoAssignRequest | null>(null)
  const [studentScheduleRequest, setStudentScheduleRequest] = useState<StudentScheduleRequest | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState('保存データを確認しています。')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [isSavingNow, setIsSavingNow] = useState(false)
  const [isRemoteSyncPending, setIsRemoteSyncPending] = useState(false)
  const [isRemoteSyncVisible, setIsRemoteSyncVisible] = useState(false)
  const [remoteSyncProgress, setRemoteSyncProgress] = useState<{ percent: number; label: string; elapsedSeconds: number } | null>(null)
  const isSavingNowRef = useRef(false)
  const isRemoteSyncPendingRef = useRef(false)
  const isRemoteSyncVisibleRef = useRef(false)
  const remoteSaveInFlightRef = useRef(false)
  const queuedRemoteSnapshotRef = useRef<{
    snapshot: WorkspaceSnapshot
    targetClassroomIds?: string[]
    showSlowMessage?: boolean
    downloadBackupOnFailure?: boolean
    onSuccess?: () => void
    onFailure?: (error: unknown) => void
  } | null>(null)
  const remoteSyncSlowTimerRef = useRef<number | null>(null)
  const remoteSyncProgressTimerRef = useRef<number | null>(null)
  const delayedAutoRemoteSyncTimerRef = useRef<number | null>(null)
  const remoteSyncStartedAtRef = useRef(0)
  // 直近のローカル自動保存(IndexedDB書込)を開始した時刻。連続編集中の保存間隔を制御する。
  const autosaveLastStartedAtRef = useRef(0)
  const downloadedFirebaseFailureBackupKeysRef = useRef<Set<string>>(new Set())
  // A1: 別端末が先に更新していて(版数衝突=STALE)クラウド保存が拒否された状態。
  // セットされると、同じ古いベースでの再送ループを止め、ユーザーに再読み込みを促す。
  const remoteStaleConflictRef = useRef(false)
  const [hasRemoteStaleConflict, setHasRemoteStaleConflict] = useState(false)
  isSavingNowRef.current = isSavingNow
  isRemoteSyncPendingRef.current = isRemoteSyncPending
  isRemoteSyncVisibleRef.current = isRemoteSyncVisible
  const updateSavingNow = useCallback((nextIsSaving: boolean) => {
    isSavingNowRef.current = nextIsSaving
    setIsSavingNow(nextIsSaving)
  }, [])

  const downloadFirebaseFailureBackup = useCallback((snapshot: WorkspaceSnapshot) => {
    const backupKey = `${snapshot.savedAt}:${snapshot.currentUserId}:${snapshot.actingClassroomId ?? 'none'}`
    if (downloadedFirebaseFailureBackupKeysRef.current.has(backupKey)) return false
    try {
      downloadTextFile(
        formatBackupFileName(snapshot.savedAt, 'Firebase同期失敗時バックアップ'),
        serializeWorkspaceSnapshot(snapshot),
        'application/json',
      )
      downloadedFirebaseFailureBackupKeysRef.current.add(backupKey)
      if (downloadedFirebaseFailureBackupKeysRef.current.size > 30) {
        const retained = Array.from(downloadedFirebaseFailureBackupKeysRef.current).slice(-20)
        downloadedFirebaseFailureBackupKeysRef.current = new Set(retained)
      }
      return true
    } catch {
      return false
    }
  }, [])

  const updateRemoteSyncPending = useCallback((nextIsPending: boolean) => {
    isRemoteSyncPendingRef.current = nextIsPending
    setIsRemoteSyncPending(nextIsPending)
  }, [])
  const updateRemoteSyncVisible = useCallback((nextIsVisible: boolean) => {
    isRemoteSyncVisibleRef.current = nextIsVisible
    setIsRemoteSyncVisible(nextIsVisible)
  }, [])
  const lastPendingWorkspaceSnapshotWriteAtRef = useRef(0)
  const [serverAutoBackupSummaries, setServerAutoBackupSummaries] = useState<ServerAutoBackupSummary[]>([])
  const [serverAutoBackupLoading, setServerAutoBackupLoading] = useState(false)
  const [studentHistoryState, setStudentHistoryState] = useState<null | { classroomName: string; entries: Array<{ dateKey: string; count: number }>; loading: boolean }>(null)
  const [workspaceUsers, setWorkspaceUsers, workspaceUsersRef] = useLatestState<WorkspaceUser[]>([])
  const [workspaceClassrooms, setWorkspaceClassrooms, workspaceClassroomsRef] = useLatestState<WorkspaceClassroom[]>([])
  const [developerCloudBackupEnabled, setDeveloperCloudBackupEnabled] = useState(false)
  const [developerCloudBackupFolderName, setDeveloperCloudBackupFolderName] = useState('')
  const [developerCloudBackupStatus, setDeveloperCloudBackupStatus] = useState('個人クラウドへの自動保存は未設定です。')
  const [developerCloudBackupHandle, setDeveloperCloudBackupHandle] = useState<DeveloperCloudBackupDirectoryHandle | null>(null)
  const [developerCloudSyncedAutoBackupKeys, setDeveloperCloudSyncedAutoBackupKeys] = useState<string[]>([])
  const [developerRestoreModalState, setDeveloperRestoreModalState] = useState<DeveloperRestoreModalState | null>(null)
  const [currentUserId, setCurrentUserId, currentUserIdRef] = useLatestState('')
  const [actingClassroomId, setActingClassroomId, actingClassroomIdRef] = useLatestState<string | null>(null)
  // 編集中 state(students 等)が「どの教室から読み込まれたか」を保持する。actingClassroomId と
  // これが一致するときだけ、編集 state を教室文書へ書き込んでよい(本番データ混入防止の不変条件)。
  const loadedEditingClassroomIdRef = useRef<string | null>(null)
  const [bulkTemporarySuspensionReason, setBulkTemporarySuspensionReason] = useState('')
  const [hasCheckedRemoteSession, setHasCheckedRemoteSession] = useState(!isRemoteBackendEnabled)
  const [remoteSessionUserId, setRemoteSessionUserId] = useState<string | null>(null)
  const [remoteLoginEmail, setRemoteLoginEmail] = useState('')
  const [remoteLoginPassword, setRemoteLoginPassword] = useState('')
  const [remoteAuthMessage, setRemoteAuthMessage] = useState('')
  const [isRemoteLoginSubmitting, setIsRemoteLoginSubmitting] = useState(false)
  const [hasHydratedSnapshot, setHasHydratedSnapshot] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<{ label: string; data: AppSnapshotPayload } | null>(null)
  const [submissionAcknowledgements, setSubmissionAcknowledgements] = useState<SubmissionAcknowledgementEntry[]>([])
  const currentUser = useMemo(() => workspaceUsers.find((user) => user.id === currentUserId) ?? null, [currentUserId, workspaceUsers])
  const actingClassroom = useMemo(() => workspaceClassrooms.find((classroom) => classroom.id === actingClassroomId) ?? null, [actingClassroomId, workspaceClassrooms])
  const isActingDevelopmentClassroom = useMemo(() => isDevelopmentClassroom(actingClassroom), [actingClassroom])
  const manualFirebaseSaveStabilityEnabled = useMemo(
    () => isFeatureEnabledForClassroom('manualFirebaseSaveStability', actingClassroom),
    [actingClassroom],
  )
  // Feature B: 開発用教室へ「他教室 × バックアップ時点」を読み込むための候補(サーバー由来)。
  // 旧「他教室コピー」(in-memory 参照)を廃止し、Storage の確定データのみを取り込む方式に置換。
  const [developmentBackupSources, setDevelopmentBackupSources] = useState<DevelopmentClassroomBackupSources>({ backups: [], classrooms: [] })
  const [developmentBackupLoading, setDevelopmentBackupLoading] = useState(false)
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
  const acknowledgeSubmissionEntry = useCallback((id: string) => {
    setSubmissionAcknowledgements((current) => current.filter((entry) => entry.id !== id))
  }, [])
  const acknowledgeAllSubmissions = useCallback(() => {
    setSubmissionAcknowledgements([])
  }, [])
  const renderWithSubmissionAcknowledgement = useCallback((content: ReactNode) => {
    // A1: 版数衝突(別端末が先に更新)で停止中は、全画面共通の警告バナーで再読み込みを促す。
    const staleConflictBanner = hasRemoteStaleConflict ? (
      <div className="remote-stale-conflict-banner" role="alert" data-testid="remote-stale-conflict-banner">
        <span className="remote-stale-conflict-banner-text">
          別の端末でこの教室のデータが更新されました。最新を上書きしないようクラウド保存を停止しています。
          このタブの内容はバックアップJSONに書き出し済みです。最新データを取得するため、画面を再読み込みしてください。
        </span>
        <button
          type="button"
          className="primary-button"
          onClick={() => window.location.reload()}
          data-testid="remote-stale-conflict-reload"
        >
          再読み込み
        </button>
      </div>
    ) : null

    // C1: 遅延読み込み画面(配布/開発者/請求/バックアップ復元)の解決待ちを Suspense で受ける。
    const suspendedContent = <Suspense fallback={<ScreenLoadingFallback />}>{content}</Suspense>

    if (submissionAcknowledgements.length === 0 && !staleConflictBanner) return <>{suspendedContent}</>

    return (
      <>
        {suspendedContent}
        {staleConflictBanner}
        {submissionAcknowledgements.length > 0 && (
        <div className="submission-acknowledgement-overlay" role="presentation">
          <div
            className="submission-acknowledgement-modal"
            role="dialog"
            aria-modal="true"
            aria-label="QR提出通知"
            data-testid="submission-acknowledgement-modal"
          >
            <div className="submission-acknowledgement-kicker">
              QR提出通知{submissionAcknowledgements.length > 1 ? `（${submissionAcknowledgements.length}件）` : ''}
            </div>
            <ul className="submission-acknowledgement-list">
              {submissionAcknowledgements.map((entry) => (
                <li key={entry.id} className="submission-acknowledgement-item" data-testid="submission-acknowledgement-item">
                  <button
                    type="button"
                    className="submission-acknowledgement-dismiss"
                    onClick={() => acknowledgeSubmissionEntry(entry.id)}
                    aria-label={`${entry.personName} の通知を消す`}
                    data-testid="submission-acknowledgement-dismiss"
                  >
                    ×
                  </button>
                  <div className="submission-acknowledgement-item-classroom">{entry.classroomName}</div>
                  <p className="submission-acknowledgement-message">
                    {entry.personType === 'student' ? '生徒' : '講師'}
                    {' '}
                    <strong>{entry.personName}</strong>
                    {' '}
                    が
                    {' '}
                    <strong>{entry.sessionLabel}</strong>
                    の QR 提出を完了しました。
                  </p>
                </li>
              ))}
            </ul>
            <div className="submission-acknowledgement-actions">
              <button type="button" className="primary-button" onClick={acknowledgeAllSubmissions} data-testid="submission-acknowledgement-confirm">
                すべて確認
              </button>
            </div>
          </div>
        </div>
        )}
      </>
    )
  }, [acknowledgeAllSubmissions, acknowledgeSubmissionEntry, submissionAcknowledgements, hasRemoteStaleConflict])

  const buildWorkspaceSnapshot = useCallback((savedAt: string): WorkspaceSnapshot => {
    const latestScreen = screenRef.current
    const latestManagers = managersRef.current
    const latestTeachers = teachersRef.current
    const latestStudents = studentsRef.current
    const latestRegularLessons = regularLessonsRef.current
    const latestGroupLessons = groupLessonsRef.current
    const latestSpecialSessions = specialSessionsRef.current
    const latestAutoAssignRules = autoAssignRulesRef.current
    const latestPairConstraints = pairConstraintsRef.current
    const latestClassroomSettings = classroomSettingsRef.current
    const latestBoardState = boardStateRef.current
    const latestWorkspaceUsers = workspaceUsersRef.current
    const latestWorkspaceClassrooms = workspaceClassroomsRef.current
    return {
      schemaVersion: 1,
      savedAt,
      developerCloudBackupEnabled,
      developerCloudBackupFolderName,
      developerCloudSyncedAutoBackupKeys,
      currentUserId,
      actingClassroomId,
      users: latestWorkspaceUsers,
      classrooms: latestWorkspaceClassrooms.map((classroom) => {
        // 編集 state はその教室から読み込んだものでなければ書き込まない(本番データ混入防止)。
        if (!shouldInjectEditingStateIntoClassroom(classroom.id, actingClassroomId, loadedEditingClassroomIdRef.current)) return classroom
        return {
          ...classroom,
          data: buildClassroomSnapshotPayload({
            screen: latestScreen === 'developer' ? 'board' : latestScreen,
            classroomSettings: latestClassroomSettings,
            managers: latestManagers,
            teachers: latestTeachers,
            students: latestStudents,
            regularLessons: latestRegularLessons,
            groupLessons: latestGroupLessons,
            specialSessions: latestSpecialSessions,
            autoAssignRules: latestAutoAssignRules,
            pairConstraints: latestPairConstraints,
            boardState: latestBoardState,
          }),
        }
      }),
    }
  }, [actingClassroomId, currentUserId, developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudSyncedAutoBackupKeys, autoAssignRulesRef, boardStateRef, classroomSettingsRef, groupLessonsRef, managersRef, pairConstraintsRef, regularLessonsRef, screenRef, specialSessionsRef, studentsRef, teachersRef, workspaceClassroomsRef, workspaceUsersRef])

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
        hourlyRetentionHours: SERVER_AUTO_BACKUP_HOURLY_RETENTION_HOURS,
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

    const currentWorkspaceRetentionBytes = currentWorkspaceDailyBytes * (SERVER_AUTO_BACKUP_RETENTION_DAYS + SERVER_AUTO_BACKUP_HOURLY_RETENTION_HOURS)
    const estimatedReferenceDailyBytes = estimateDailyBytes(BLAZE_STORAGE_REFERENCE_CLASSROOM_COUNT)
    const estimatedReferenceRetentionBytes = estimatedReferenceDailyBytes * (SERVER_AUTO_BACKUP_RETENTION_DAYS + SERVER_AUTO_BACKUP_HOURLY_RETENTION_HOURS)

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
      hourlyRetentionHours: SERVER_AUTO_BACKUP_HOURLY_RETENTION_HOURS,
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

  // Compute a content signature that excludes purely UI-only fields (current week,
  // selected cell/desk, side-panel open state, schedule popup ranges). Navigating
  // weeks or opening the management screen must not flip the save button to 「保存」.
  // 盤面（最も大きい）と各スライスを個別にメモ化し、変更されたスライスだけ再 stringify する。
  // 例: 生徒1人の編集では students の署名だけ再計算され、盤面全週の再 stringify は発生しない。
  const boardStateSignaturePart = useMemo(() => stringifySignaturePart(buildBoardDataForSignature(boardState)), [boardState])
  const regularLessonsSignaturePart = useMemo(() => stringifySignaturePart(regularLessons), [regularLessons])
  const studentsSignaturePart = useMemo(() => stringifySignaturePart(students), [students])
  const teachersSignaturePart = useMemo(() => stringifySignaturePart(teachers), [teachers])
  const specialSessionsSignaturePart = useMemo(() => stringifySignaturePart(specialSessions), [specialSessions])
  const autoAssignRulesSignaturePart = useMemo(() => stringifySignaturePart(autoAssignRules), [autoAssignRules])
  const pairConstraintsSignaturePart = useMemo(() => stringifySignaturePart(pairConstraints), [pairConstraints])
  const classroomSettingsSignaturePart = useMemo(() => stringifySignaturePart(classroomSettings), [classroomSettings])
  const managersSignaturePart = useMemo(() => stringifySignaturePart(managers), [managers])
  const groupLessonsSignaturePart = useMemo(() => stringifySignaturePart(groupLessons), [groupLessons])
  const dataSignature = useMemo(() => [
    boardStateSignaturePart,
    regularLessonsSignaturePart,
    studentsSignaturePart,
    teachersSignaturePart,
    specialSessionsSignaturePart,
    autoAssignRulesSignaturePart,
    pairConstraintsSignaturePart,
    classroomSettingsSignaturePart,
    managersSignaturePart,
    groupLessonsSignaturePart,
  ].join(DATA_SIGNATURE_SEPARATOR), [
    boardStateSignaturePart,
    regularLessonsSignaturePart,
    studentsSignaturePart,
    teachersSignaturePart,
    specialSessionsSignaturePart,
    autoAssignRulesSignaturePart,
    pairConstraintsSignaturePart,
    classroomSettingsSignaturePart,
    managersSignaturePart,
    groupLessonsSignaturePart,
  ])

  const buildCurrentDataSignature = useCallback(() => combineDataSignature(
    stringifySignaturePart(buildBoardDataForSignature(boardStateRef.current)),
    {
      regularLessons: regularLessonsRef.current,
      students: studentsRef.current,
      teachers: teachersRef.current,
      specialSessions: specialSessionsRef.current,
      autoAssignRules: autoAssignRulesRef.current,
      pairConstraints: pairConstraintsRef.current,
      classroomSettings: classroomSettingsRef.current,
      managers: managersRef.current,
      groupLessons: groupLessonsRef.current,
    },
  ), [autoAssignRulesRef, boardStateRef, classroomSettingsRef, groupLessonsRef, managersRef, pairConstraintsRef, regularLessonsRef, specialSessionsRef, studentsRef, teachersRef])

  const writePendingWorkspaceSnapshotForRemoteSync = useCallback(() => {
    if (!isSnapshotPersistenceRuntimeEnabled()) return null
    if (workspaceUsersRef.current.length === 0 || workspaceClassroomsRef.current.length === 0) return null

    const now = Date.now()
    if (now - lastPendingWorkspaceSnapshotWriteAtRef.current < PENDING_WORKSPACE_SNAPSHOT_WRITE_INTERVAL_MS) return null
    lastPendingWorkspaceSnapshotWriteAtRef.current = now

    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    const targetClassroomId = actingClassroomIdRef.current ?? snapshot.actingClassroomId
    const targetClassroomIds = targetClassroomId && snapshot.classrooms.some((classroom) => classroom.id === targetClassroomId)
      ? [targetClassroomId]
      : undefined
    try {
      if (isRemoteBackendEnabled && remoteSessionUserId) {
        markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, targetClassroomIds)
      }
      void saveWorkspaceSnapshot(snapshot).catch(() => {
        lastPendingWorkspaceSnapshotWriteAtRef.current = 0
      })
      return snapshot
    } catch {
      lastPendingWorkspaceSnapshotWriteAtRef.current = 0
      return null
    }
  }, [actingClassroomIdRef, buildWorkspaceSnapshot, isRemoteBackendEnabled, remoteSessionUserId, workspaceClassroomsRef, workspaceUsersRef])

  const clearRemoteSyncSlowTimer = useCallback(() => {
    if (remoteSyncSlowTimerRef.current !== null) {
      window.clearTimeout(remoteSyncSlowTimerRef.current)
      remoteSyncSlowTimerRef.current = null
    }
  }, [])

  const clearRemoteSyncProgressTimer = useCallback(() => {
    if (remoteSyncProgressTimerRef.current !== null) {
      window.clearInterval(remoteSyncProgressTimerRef.current)
      remoteSyncProgressTimerRef.current = null
    }
  }, [])

  const clearDelayedAutoRemoteSyncTimer = useCallback(() => {
    if (delayedAutoRemoteSyncTimerRef.current !== null) {
      window.clearTimeout(delayedAutoRemoteSyncTimerRef.current)
      delayedAutoRemoteSyncTimerRef.current = null
    }
  }, [])

  const getRemoteSyncElapsedSeconds = useCallback(() => {
    if (!remoteSyncStartedAtRef.current) return 0
    return Math.max(0, Math.floor((Date.now() - remoteSyncStartedAtRef.current) / 1000))
  }, [])

  const getCurrentClassroomSyncTargetIds = useCallback((snapshot: WorkspaceSnapshot) => {
    const targetClassroomId = actingClassroomIdRef.current ?? snapshot.actingClassroomId
    return targetClassroomId && snapshot.classrooms.some((classroom) => classroom.id === targetClassroomId)
      ? [targetClassroomId]
      : undefined
  }, [actingClassroomIdRef])

  // 最後に保存/読込が完了した時点のデータ署名。state なので更新で再描画され、
  // ref (useLatestState が同期更新) なので各コールバックから常に最新値を読める。
  const [cleanSignature, setCleanSignature, cleanSignatureRef] = useLatestState<string>('')

  const buildClassroomDataSignature = useCallback((payload: AppSnapshotPayload | null | undefined) => combineDataSignature(
    stringifySignaturePart(buildBoardDataForSignature(payload?.boardState ?? null)),
    {
      regularLessons: payload?.regularLessons ?? [],
      students: payload?.students ?? [],
      teachers: payload?.teachers ?? [],
      specialSessions: payload?.specialSessions ?? [],
      autoAssignRules: payload?.autoAssignRules ?? [],
      pairConstraints: payload?.pairConstraints ?? [],
      classroomSettings: payload?.classroomSettings,
      managers: payload?.managers ?? [],
      groupLessons: payload?.groupLessons ?? [],
    },
  ), [])

  const markCleanIfSnapshotMatchesCurrent = useCallback((snapshot: WorkspaceSnapshot) => {
    const targetClassroomId = actingClassroomIdRef.current ?? snapshot.actingClassroomId
    const snapshotClassroom = targetClassroomId
      ? snapshot.classrooms.find((classroom) => classroom.id === targetClassroomId)
      : null
    const snapshotSignature = buildClassroomDataSignature(snapshotClassroom?.data)
    const currentSignature = buildCurrentDataSignature()
    if (!snapshotSignature || snapshotSignature !== currentSignature) return false
    setCleanSignature(currentSignature)
    return true
  }, [actingClassroomIdRef, buildClassroomDataSignature, buildCurrentDataSignature, setCleanSignature])

  const queueFirebaseWorkspaceSync = useCallback((snapshot: WorkspaceSnapshot, showSlowMessage = false, showProgress = false, targetClassroomIds?: string[], callbacks?: {
    downloadBackupOnFailure?: boolean
    onSuccess?: () => void
    onFailure?: (error: unknown) => void
  }) => {
    if (!isRemoteBackendEnabled || !remoteSessionUserId) return false
    // A1: 版数衝突で停止中は、再読み込みまでクラウド同期を再開しない(古いベースでの上書き再試行を断つ)。
    // ローカル保存(IndexedDB)は別経路で継続するため、編集内容はブラウザ内には残る。
    if (remoteStaleConflictRef.current) return false

    try {
      markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, targetClassroomIds)
    } catch {
      // The local snapshot save path still preserves the data for the next login.
    }

    const existingQueuedItem = queuedRemoteSnapshotRef.current
    queuedRemoteSnapshotRef.current = {
      snapshot,
      targetClassroomIds,
      showSlowMessage: showSlowMessage || existingQueuedItem?.showSlowMessage,
      downloadBackupOnFailure: Boolean(callbacks?.downloadBackupOnFailure || existingQueuedItem?.downloadBackupOnFailure),
      onSuccess: () => {
        existingQueuedItem?.onSuccess?.()
        callbacks?.onSuccess?.()
      },
      onFailure: (error) => {
        existingQueuedItem?.onFailure?.(error)
        callbacks?.onFailure?.(error)
      },
    }
    updateRemoteSyncPending(true)
    if (showProgress) updateRemoteSyncVisible(true)
    if (showProgress) {
      remoteSyncStartedAtRef.current = Date.now()
      clearRemoteSyncProgressTimer()
      setRemoteSyncProgress({ percent: 1, label: 'データベースへ保存準備中', elapsedSeconds: 0 })
      remoteSyncProgressTimerRef.current = window.setInterval(() => {
        setRemoteSyncProgress((current) => current ? { ...current, elapsedSeconds: getRemoteSyncElapsedSeconds() } : current)
      }, 1000)
    }
    if (remoteSaveInFlightRef.current) return true

    remoteSaveInFlightRef.current = true
    const runNext = async (): Promise<void> => {
      const nextItem = queuedRemoteSnapshotRef.current
      if (!nextItem) {
        remoteSaveInFlightRef.current = false
        updateRemoteSyncPending(false)
        updateRemoteSyncVisible(false)
        setRemoteSyncProgress(null)
        clearRemoteSyncProgressTimer()
        clearRemoteSyncSlowTimer()
        return
      }

      queuedRemoteSnapshotRef.current = null
      remoteSyncStartedAtRef.current = Date.now()
      clearRemoteSyncSlowTimer()
      if (isRemoteSyncVisibleRef.current) {
        setRemoteSyncProgress({ percent: 1, label: 'データベースへ保存準備中', elapsedSeconds: 0 })
      }
      if (nextItem.showSlowMessage) {
        remoteSyncSlowTimerRef.current = window.setTimeout(() => {
          remoteSyncSlowTimerRef.current = null
          setPersistenceMessage('ブラウザ内には保存済みです。Firebase 同期が遅れています。反映確認前に閉じる場合は確認ダイアログでキャンセルしてください。')
        }, 5000)
      }

      let failed = false
      try {
        const targetClassrooms = resolveWorkspaceSyncTargetClassrooms(
          nextItem.snapshot.classrooms,
          nextItem.targetClassroomIds,
          nextItem.snapshot.actingClassroomId,
        )
        if (targetClassrooms.length === 0) throw new Error('保存対象の教室データが見つかりません。')
        const startProgress = { percent: 20, label: 'Cloud Functions 経由で保存準備中' }
        if (isRemoteSyncVisibleRef.current) {
          const elapsedSeconds = getRemoteSyncElapsedSeconds()
          setRemoteSyncProgress({ ...startProgress, elapsedSeconds })
          setPersistenceMessage(`${startProgress.label}(${startProgress.percent}%完了)`)
        }
        for (const [classroomIndex, targetClassroom] of targetClassrooms.entries()) {
          const percent = 20 + Math.floor((classroomIndex / targetClassrooms.length) * 75)
          const saveId = createRemoteSaveId(nextItem.snapshot.savedAt, targetClassroom.id)
          if (isRemoteSyncVisibleRef.current) {
            const elapsedSeconds = getRemoteSyncElapsedSeconds()
            const progress = { percent, label: `Cloud Functions 経由で保存中: ${classroomIndex + 1}/${targetClassrooms.length}教室` }
            setRemoteSyncProgress({ ...progress, elapsedSeconds })
            setPersistenceMessage(`${progress.label}(${progress.percent}%完了)`)
          }
          const maxAttempts = manualFirebaseSaveStabilityEnabled ? 3 : 1
          let result: Awaited<ReturnType<typeof saveClassroomSnapshotViaFunction>> | null = null
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
              // すべての教室で同一の保存経路 (saveClassroomSnapshot) を使う。
              // かつて開発用教室だけ saveDevelopmentClassroomSnapshot へ分岐していたが、
              // 関数側が単一のハードコード ID しか受け付けず開発用教室の保存が必ず失敗していたため撤去した。
              result = await saveClassroomSnapshotViaFunction({
                classroomId: targetClassroom.id,
                savedAt: nextItem.snapshot.savedAt,
                saveId,
                payload: targetClassroom.data,
              })
              break
            } catch (error) {
              if (!manualFirebaseSaveStabilityEnabled || !isTransientFirebaseSyncError(error) || attempt >= maxAttempts) {
                throw error
              }
              await new Promise<void>((resolve) => {
                window.setTimeout(resolve, 350 * attempt)
              })
            }
          }
          if (!result) throw new Error('Firebase 同期の再試行が完了できませんでした。')
        }
        const finishedProgress = { percent: 100, label: 'Cloud Functions 経由のデータベース保存完了' }
        if (isRemoteSyncVisibleRef.current) {
          const elapsedSeconds = getRemoteSyncElapsedSeconds()
          setRemoteSyncProgress({ ...finishedProgress, elapsedSeconds })
          setPersistenceMessage(`${finishedProgress.label}(${finishedProgress.percent}%完了)`)
        }
        setLastSavedAt(nextItem.snapshot.savedAt)
        nextItem.onSuccess?.()
        const markedClean = markCleanIfSnapshotMatchesCurrent(nextItem.snapshot)
        if (!queuedRemoteSnapshotRef.current) {
          const wasRemoteSyncVisible = isRemoteSyncVisibleRef.current
          clearPendingRemoteWorkspaceSnapshotMarker()
          updateRemoteSyncPending(false)
          updateRemoteSyncVisible(false)
          setRemoteSyncProgress(null)
          clearRemoteSyncProgressTimer()
          if (wasRemoteSyncVisible) {
            setPersistenceMessage(markedClean
              ? 'Firebase へ同期しました。'
              : 'Firebase 同期は完了しました。最新データ表示への切り替えを確認中です。')
          }
        }
      } catch (error) {
        failed = true
        // A1: 版数衝突(別端末が先に更新)は通常の同期失敗と分けて扱う。
        // 同じ古いベースで再送し続けても必ず失敗するため、再送ループを止めて再読み込みを促す。
        if (isStaleSnapshotConflictError(error)) {
          // このタブのデータを保全するためバックアップJSONを書き出す(スナップショット単位で重複DL抑止)。
          const downloadedStaleBackup = downloadFirebaseFailureBackup(nextItem.snapshot)
          // 以後の自動同期を止める(再読み込みまで)。キューも空にして即時の再送を断つ。
          queuedRemoteSnapshotRef.current = null
          updateRemoteSyncPending(false)
          updateRemoteSyncVisible(false)
          setRemoteSyncProgress(null)
          clearRemoteSyncProgressTimer()
          const alreadyFlagged = remoteStaleConflictRef.current
          remoteStaleConflictRef.current = true
          setHasRemoteStaleConflict(true)
          setPersistenceMessage(downloadedStaleBackup
            ? '別の端末でこの教室のデータが更新されました。最新を上書きしないようクラウド保存を停止しました。このタブの内容をバックアップJSONに書き出したので、画面を再読み込みしてください。'
            : '別の端末でこの教室のデータが更新されました。最新を上書きしないようクラウド保存を停止しました。画面を再読み込みしてください。')
          // 初回だけダイアログで手順を明示する(連続編集での多重ダイアログを防ぐ)。
          if (!alreadyFlagged) {
            window.alert(STALE_SNAPSHOT_GUIDANCE_MESSAGE)
          }
          nextItem.onFailure?.(error)
          remoteSaveInFlightRef.current = false
          clearRemoteSyncSlowTimer()
          return
        }
        updateRemoteSyncPending(Boolean(queuedRemoteSnapshotRef.current))
        if (isRemoteSyncVisibleRef.current) {
          setRemoteSyncProgress(null)
          clearRemoteSyncProgressTimer()
        }
        // 失敗時は cleanSignature を更新しないため、未保存状態 (dataSignature !== cleanSignature) が自動的に維持される。
        const message = error instanceof Error ? error.message : 'Firebase 同期に失敗しました。'
        const downloadedBackup = manualFirebaseSaveStabilityEnabled && nextItem.downloadBackupOnFailure
          ? downloadFirebaseFailureBackup(nextItem.snapshot)
          : false
        if (isRemoteSyncVisibleRef.current) setPersistenceMessage(`ブラウザ内には保存済みです。Firebase 同期は未完了です: ${message}`)
        if (isRemoteSyncVisibleRef.current && downloadedBackup) {
          setPersistenceMessage(`ブラウザ内には保存済みです。Firebase 同期は未完了です: ${message}。バックアップJSONを自動ダウンロードしました。`)
        }
        // バックアップを新規ダウンロードした失敗時のみ、再ログイン→復元の作業指示を明示する
        // (downloadFirebaseFailureBackup はスナップショット単位で重複DLを抑止するため、案内も重複しない)。
        if (downloadedBackup) {
          window.alert(SAVE_FAILURE_GUIDANCE_MESSAGE)
        }
        nextItem.onFailure?.(error)
      } finally {
        clearRemoteSyncSlowTimer()
        if (queuedRemoteSnapshotRef.current) {
          void runNext()
        } else {
          remoteSaveInFlightRef.current = false
          if (failed) {
            updateRemoteSyncVisible(false)
            setRemoteSyncProgress(null)
            clearRemoteSyncProgressTimer()
          }
        }
      }
    }

    void runNext()
    return true
  }, [clearRemoteSyncProgressTimer, clearRemoteSyncSlowTimer, downloadFirebaseFailureBackup, getRemoteSyncElapsedSeconds, isRemoteBackendEnabled, manualFirebaseSaveStabilityEnabled, markCleanIfSnapshotMatchesCurrent, remoteSessionUserId, updateRemoteSyncPending, updateRemoteSyncVisible])

  // 未保存判定は描画時に dataSignature !== cleanSignature で導出するため、専用の同期 effect は不要。
  // 保存/読込が完了したタイミングで cleanSignature を更新するだけでよい。
  const markStateLoadedClean = useCallback((expectedCleanSignature?: string) => {
    const nextCleanSignature = expectedCleanSignature || buildCurrentDataSignature()
    lastPendingWorkspaceSnapshotWriteAtRef.current = 0
    setCleanSignature(nextCleanSignature)
  }, [buildCurrentDataSignature, setCleanSignature])


  const applySnapshot = useCallback((snapshot: AppSnapshot, successMessage: string) => {
    const sanitizedBase = sanitizeAppSnapshot(snapshot)
    // 読込時に週をトリムしてメモリを抑える。clean 署名もトリム後の状態で計算し、
    // 読込直後に誤って「保存」(dirty)にならないよう一致させる。
    const trimmedBoardState = trimBoardStateForMemory(sanitizedBase.boardState)
    const sanitizedSnapshot = trimmedBoardState === sanitizedBase.boardState
      ? sanitizedBase
      : { ...sanitizedBase, boardState: trimmedBoardState }
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
    // ローカル単一教室の読込。編集 state の出所を現在の acting に合わせる。
    loadedEditingClassroomIdRef.current = actingClassroomIdRef.current
    markStateLoadedClean(buildClassroomDataSignature(sanitizedSnapshot))
  }, [actingClassroomIdRef, buildClassroomDataSignature, markStateLoadedClean])

  const syncCurrentClassroomData = useCallback((targetClassroomId: string | null) => {
    if (!targetClassroomId) return
    // 編集 state がその教室から読み込まれたものでないなら、その教室へ書き戻さない(本番データ混入防止)。
    if (loadedEditingClassroomIdRef.current !== targetClassroomId) return
    const latestScreen = screenRef.current
    const latestManagers = managersRef.current
    const latestTeachers = teachersRef.current
    const latestStudents = studentsRef.current
    const latestRegularLessons = regularLessonsRef.current
    const latestGroupLessons = groupLessonsRef.current
    const latestSpecialSessions = specialSessionsRef.current
    const latestAutoAssignRules = autoAssignRulesRef.current
    const latestPairConstraints = pairConstraintsRef.current
    const latestClassroomSettings = classroomSettingsRef.current
    const latestBoardState = boardStateRef.current

    setWorkspaceClassrooms((current) => current.map((classroom) => {
      if (classroom.id !== targetClassroomId) return classroom

      return {
        ...classroom,
        data: buildClassroomSnapshotPayload({
          screen: latestScreen === 'developer' ? 'board' : latestScreen,
          classroomSettings: latestClassroomSettings,
          managers: latestManagers,
          teachers: latestTeachers,
          students: latestStudents,
          regularLessons: latestRegularLessons,
          groupLessons: latestGroupLessons,
          specialSessions: latestSpecialSessions,
          autoAssignRules: latestAutoAssignRules,
          pairConstraints: latestPairConstraints,
          // 保存・workspace コピーは週をトリムして肥大を防ぐ（手動編集週は保持。ライブ盤面は不変）。
          boardState: trimBoardStateForMemory(latestBoardState),
        }),
      }
    }))
  }, [autoAssignRulesRef, boardStateRef, classroomSettingsRef, groupLessonsRef, managersRef, pairConstraintsRef, regularLessonsRef, screenRef, specialSessionsRef, studentsRef, teachersRef, setWorkspaceClassrooms])

  const updateClassroomSettings = useCallback((nextClassroomSettings: ClassroomSettings) => {
    classroomSettingsRef.current = nextClassroomSettings
    setClassroomSettings(nextClassroomSettings)
  }, [])

  const saveUndoSnapshot = useCallback((label: string) => {
    const latestScreen = screenRef.current
    setUndoSnapshot({
      label,
      data: buildClassroomSnapshotPayload({
        screen: latestScreen === 'developer' ? 'board' : latestScreen,
        classroomSettings: classroomSettingsRef.current,
        managers: managersRef.current,
        teachers: teachersRef.current,
        students: studentsRef.current,
        regularLessons: regularLessonsRef.current,
        groupLessons: groupLessonsRef.current,
        specialSessions: specialSessionsRef.current,
        autoAssignRules: autoAssignRulesRef.current,
        pairConstraints: pairConstraintsRef.current,
        boardState: boardStateRef.current,
      }),
    })
  }, [autoAssignRulesRef, boardStateRef, classroomSettingsRef, groupLessonsRef, managersRef, pairConstraintsRef, regularLessonsRef, screenRef, specialSessionsRef, studentsRef, teachersRef])

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
      setBoardMountKey,
    })
    // undo は現在開いている教室の編集 state を戻す操作なので、出所は acting のまま。
    loadedEditingClassroomIdRef.current = actingClassroomIdRef.current
    markStateLoadedClean()
    setPersistenceMessage(`「${undoSnapshot.label}」の実行前の状態に戻しました。`)
    setUndoSnapshot(null)
  }, [actingClassroomIdRef, markStateLoadedClean, undoSnapshot])

  const dismissUndoSnapshot = useCallback(() => {
    setUndoSnapshot(null)
  }, [])

  const navigateClassroomScreen = useCallback((nextScreen: ClassroomScreen) => {
    syncCurrentClassroomData(actingClassroomId)
    setScreen(nextScreen)
  }, [actingClassroomId, syncCurrentClassroomData])

  const openClassroom = useCallback((classroomId: string, nextScreen?: AppScreen) => {
    if (shouldSyncCurrentClassroomBeforeOpen(screenRef.current, currentUser?.role)) {
      syncCurrentClassroomData(actingClassroomId)
    }
    const nextClassroom = workspaceClassrooms.find((classroom) => classroom.id === classroomId)
    if (!nextClassroom) return
    const resolvedNextScreen = clampScreenForUserRole(nextScreen ?? nextClassroom.data.screen, currentUser?.role)

    setActingClassroomId(classroomId)
    applyClassroomPayloadToState(nextClassroom.data, {
      setScreen: () => setScreen(resolvedNextScreen),
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
      setBoardMountKey,
    })
    // 編集 state はこの教室から読み込んだ、と記録する(本番データ混入防止の不変条件)。
    loadedEditingClassroomIdRef.current = classroomId
    const navigationSnapshot = buildWorkspaceNavigationSnapshot({
      snapshot: buildWorkspaceSnapshot(new Date().toISOString()),
      classroomId,
      nextScreen: resolvedNextScreen,
      savedAt: new Date().toISOString(),
    })
    writeWorkspaceToLocalStorageSync(navigationSnapshot)
    void saveWorkspaceSnapshot(navigationSnapshot).catch(() => {})
    markStateLoadedClean(buildClassroomDataSignature(nextClassroom.data))
  }, [actingClassroomId, buildClassroomDataSignature, buildWorkspaceSnapshot, currentUser?.role, markStateLoadedClean, syncCurrentClassroomData, workspaceClassrooms])

  const applyWorkspaceSnapshot = useCallback((workspaceSnapshot: WorkspaceSnapshot, successMessage: string) => {
    const sanitizedWorkspaceSnapshot = sanitizeWorkspaceSnapshot(workspaceSnapshot)
    // メモリ削減: 各教室の盤面の週を「表示範囲＋手動編集週」へトリムする（手動編集は必ず保持）。
    const trimmedClassrooms = sanitizedWorkspaceSnapshot.classrooms.map((classroom) => {
      const trimmedBoardState = trimBoardStateForMemory(classroom.data.boardState)
      if (trimmedBoardState === classroom.data.boardState) return classroom
      return { ...classroom, data: { ...classroom.data, boardState: trimmedBoardState } }
    })
    const previousUserId = currentUserIdRef.current
    const currentScreen = screenRef.current
    // 【本番データ混入防止】新しいワークスペースを読み込む(ログイン/アカウント切替/復元)際は、
    // 前セッションの「直前に戻す(undo)」スナップショットを必ず破棄する。
    // これが残ると別教室の画面で undo バナーが出て、押すと前教室データを現在の教室へ書き込む。
    setUndoSnapshot(null)
    setWorkspaceUsers(sanitizedWorkspaceSnapshot.users)
    setWorkspaceClassrooms(trimmedClassrooms)
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
    const targetClassroom = trimmedClassrooms.find((classroom) => classroom.id === targetClassroomId) ?? trimmedClassrooms[0] ?? null
    const nextScreen = resolveHydratedScreenForUser({
      classroomScreen: targetClassroom?.data.screen,
      role: currentWorkspaceUser?.role,
      currentScreen,
      previousUserId,
      nextUserId: sanitizedWorkspaceSnapshot.currentUserId,
    })

    // 【本番データ混入防止・2026-06-21 インシデント】開発者画面で着地する場合でも、
    // actingClassroomId に対応する教室の編集 state(students 等)を必ず読み込む。
    // 以前は開発者画面のとき編集 state を読み込まず、前に開いていた別教室の名簿が
    // 残ったまま actingClassroomId だけ別教室に向き、自動保存がその別教室の文書へ
    // 前教室の名簿を書き込んで上書き汚染していた(日大前校が緑が丘/開発用データで上書き)。
    // 編集 state は常に actingClassroomId と一致させ、不変条件「編集 state は acting の教室のもの」を守る。
    if (targetClassroom) {
      applyClassroomPayloadToState(targetClassroom.data, {
        setScreen: () => setScreen(nextScreen),
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
        setBoardMountKey,
      })
      loadedEditingClassroomIdRef.current = targetClassroom.id
    } else {
      setScreen(nextScreen)
      loadedEditingClassroomIdRef.current = null
    }
    markStateLoadedClean(buildClassroomDataSignature(targetClassroom?.data))
  // currentUserIdRef is stable (ref object), so no need to include currentUserId in deps.
  // This prevents the load effect from re-running when currentUserId changes during initial load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildClassroomDataSignature, currentUserIdRef, markStateLoadedClean])

  const reloadRemoteWorkspace = useCallback(async (successMessage: string, preferredActingClassroomId?: string | null) => {
    if (!remoteSessionUserId) return

    const [remoteSnapshot, localWorkspaceSnapshot] = await Promise.all([
      loadFirebaseWorkspaceSnapshot({
        authenticatedUserId: remoteSessionUserId,
        createEmptyClassroomPayload: buildEmptyClassroomPayload,
      }),
      loadWorkspaceSnapshot().catch(() => null),
    ])

    const { snapshot: mergedSnapshot, usedPendingLocalSnapshot, pendingTargetClassroomIds } = resolveRemoteWorkspaceSnapshot(
      remoteSnapshot,
      localWorkspaceSnapshot,
      readPendingRemoteWorkspaceSnapshotMarker(),
      remoteSessionUserId,
      // A3: loadFirebaseWorkspaceSnapshot 直後のレジストリ=サーバー現在版数。stale 書き戻しの版数ゲートに使う。
      getAllClassroomSnapshotVersions(),
    )
    const nextActingClassroomId = preferredActingClassroomId ?? actingClassroomId
    if (nextActingClassroomId && mergedSnapshot.classrooms.some((classroom) => classroom.id === nextActingClassroomId)) {
      mergedSnapshot.actingClassroomId = nextActingClassroomId
    }

    applyWorkspaceSnapshot(mergedSnapshot, usedPendingLocalSnapshot ? '前回終了時の未同期データを復元しました。Firebase へ同期しています…' : successMessage)
    // A1: ワークスペースを読み直したら最新の版数をレジストリに取り込んだので、版数衝突の停止を解除する。
    remoteStaleConflictRef.current = false
    setHasRemoteStaleConflict(false)
    if (usedPendingLocalSnapshot) {
      // ログイン直後の自動復元はユーザー操作ではないため、保存ボタンの「保存中」表示や
      // 進捗バーは出さず、メッセージのみで静かに同期する。
      queueFirebaseWorkspaceSync(mergedSnapshot, false, false, pendingTargetClassroomIds, {
        onSuccess: () => {
          clearPendingRemoteWorkspaceSnapshotMarker()
          setPersistenceMessage('前回終了時の未同期データを復元し、Firebase へ同期しました。')
        },
        onFailure: (error) => {
          const message = error instanceof Error ? error.message : 'Firebase 同期に失敗しました。'
          setPersistenceMessage(`前回終了時の未同期データを復元しました。${message}`)
        },
      })
    }
    setRemoteAuthMessage('')
  }, [actingClassroomId, applyWorkspaceSnapshot, queueFirebaseWorkspaceSync, remoteSessionUserId])

  const queueCurrentWorkspaceSnapshotPersistence = useCallback(() => {
    if (!isSnapshotPersistenceRuntimeEnabled()) return null
    clearDelayedAutoRemoteSyncTimer()
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    const targetClassroomIds = getCurrentClassroomSyncTargetIds(snapshot)

    if (isRemoteBackendEnabled && remoteSessionUserId) {
      try {
        markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, targetClassroomIds)
      } catch {
        // The async local save below still preserves the snapshot.
      }
    }

    void saveWorkspaceSnapshot(snapshot)
      .then(() => {
        setLastSavedAt(snapshot.savedAt)
      })
      .catch(() => {})

    if (isRemoteBackendEnabled && remoteSessionUserId) {
      queueFirebaseWorkspaceSync(snapshot, false, false, targetClassroomIds)
    }

    return snapshot
  }, [buildWorkspaceSnapshot, clearDelayedAutoRemoteSyncTimer, getCurrentClassroomSyncTargetIds, isRemoteBackendEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId])

  const copyBoardDistributionUrl = useCallback(async () => {
    if (!actingClassroomId || !actingClassroom) throw new Error('配布対象の教室が見つかりません。')
    if (!boardState) throw new Error('配布できる盤面データがまだありません。')

    const token = resolveBoardShareToken(actingClassroomId, classroomSettings)
    if (!classroomSettings.boardShareToken) {
      setClassroomSettings((currentSettings) => currentSettings.boardShareToken ? currentSettings : { ...currentSettings, boardShareToken: token })
    }
    const url = buildBoardShareUrl(token)
    // 公開を待ってから URL を返す。公開が失敗した状態で QR を表示すると配布先で
    // 「見つかりません」になるため、失敗時は例外を投げて呼び出し側でエラー表示する。
    await publishBoardShare({
      schemaVersion: 1,
      token,
      classroomId: actingClassroomId,
      classroomName: actingClassroom.name,
      sharedAt: new Date().toISOString(),
      cells: selectBoardShareCells(boardState.weeks),
      groupClassEntries: boardState.groupClassEntries ?? {},
    })
    try {
      await copyTextToClipboard(url)
    } catch {
      // クリップボードコピー失敗は致命的でない（URL は QR とテキストで表示される）。
    }
    return url
  }, [actingClassroom, actingClassroomId, boardState, classroomSettings])

  const publishBoardStateSnapshot = useCallback((nextBoardState: PersistedBoardState) => {
    if (!actingClassroomId || !actingClassroom) return
    if (!isFirebaseBackendEnabled()) return
    const token = resolveBoardShareToken(actingClassroomId, classroomSettings)
    if (!classroomSettings.boardShareToken) {
      setClassroomSettings((currentSettings) => currentSettings.boardShareToken ? currentSettings : { ...currentSettings, boardShareToken: token })
    }
    const sharedCells = selectBoardShareCells(nextBoardState.weeks)
    // spec-group-lesson §A: 集団授業の割当も共有画面に出すため publish に含める。
    const sharedGroupClassEntries = nextBoardState.groupClassEntries ?? {}
    // 共有対象セルを compact 化した内容で署名を作り、前回公開と同一なら publish をスキップ。
    // （出席などの連続編集で同一内容を何度も setDoc しないようにする。）
    const compactedCells = compactBoardSharePayload({
      schemaVersion: 1,
      token,
      classroomId: actingClassroomId,
      classroomName: actingClassroom.name,
      sharedAt: '',
      cells: sharedCells,
    }).cells
    // 集団の変更だけでも再公開されるよう署名に含める。
    const signature = `${token}|${actingClassroom.name}|${JSON.stringify(compactedCells)}|${JSON.stringify(sharedGroupClassEntries)}`
    if (signature === lastPublishedBoardShareSignatureRef.current) return

    // 公開中に新たな変更が来たら最新内容だけを保留し、完了後に1回だけ追い公開する
    // （同時 setDoc の多重発行を防ぐ single-flight）。
    if (boardSharePublishInFlightRef.current) {
      boardSharePendingStateRef.current = nextBoardState
      return
    }
    boardSharePublishInFlightRef.current = true
    bumpMemCounter('boardshare-publish')
    publishBoardShare({
      schemaVersion: 1,
      token,
      classroomId: actingClassroomId,
      classroomName: actingClassroom.name,
      sharedAt: new Date().toISOString(),
      cells: sharedCells,
      groupClassEntries: sharedGroupClassEntries,
    })
      .then(() => {
        lastPublishedBoardShareSignatureRef.current = signature
      })
      .catch((error) => {
        console.warn('Board share publish from board state change failed', error)
      })
      .finally(() => {
        boardSharePublishInFlightRef.current = false
        const pending = boardSharePendingStateRef.current
        if (pending) {
          boardSharePendingStateRef.current = null
          publishBoardStateSnapshotRef.current(pending)
        }
      })
  }, [actingClassroom, actingClassroomId, classroomSettings])
  publishBoardStateSnapshotRef.current = publishBoardStateSnapshot

  const handleBoardStateChange = useCallback((nextBoardState: PersistedBoardState, meta: { userInitiated: boolean } = { userInitiated: true }) => {
    // ★クロス教室汚染防止（厳守）: userInitiated:false（教室切替・ロード・受動同期）では
    // 一切の書き込み/リモート同期を起こさない。ここで writePendingWorkspaceSnapshotForRemoteSync
    // を呼ぶと、acting教室とメモリ上データが食い違う切替直後の窓で他教室データを書き込み得る
    // （2026-06-06 / 2026-06-13 のクロス汚染パターン）。集団授業の変更も例外にしない。
    setBoardState(nextBoardState)
    if (!meta.userInitiated) {
      markStateLoadedClean()
      return
    }
    writePendingWorkspaceSnapshotForRemoteSync()
    if (boardShareStateChangePublishTimerRef.current) window.clearTimeout(boardShareStateChangePublishTimerRef.current)
    boardShareStateChangePublishTimerRef.current = window.setTimeout(() => {
      boardShareStateChangePublishTimerRef.current = null
      publishBoardStateSnapshot(nextBoardState)
    }, 250)
  }, [markStateLoadedClean, publishBoardStateSnapshot, setBoardState, writePendingWorkspaceSnapshotForRemoteSync])

  useEffect(() => {
    if (screen !== 'developer') return
    if (!currentUser || currentUser.role === 'developer') return
    setScreen('board')
  }, [currentUser, screen])

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
      const managerUserId = input?.managerUserId?.trim() ?? ''

      if (managerUserId) {
        setPersistenceMessage('教室を追加しています…')

        void provisionFirebaseWorkspaceClassroomWithExistingUid({
          classroomName,
          managerName,
          managerEmail,
          managerUserId,
          contractStartDate,
          contractEndDate,
          initialPayload: buildEmptyClassroomPayload(),
        }).then(async (result) => {
          await reloadRemoteWorkspace('教室を追加しました。既存の Firebase Auth UID を管理者として割り当てました。', result.classroomId)
          window.alert([
            `${classroomName} を追加しました。`,
            `管理者メール: ${managerEmail}`,
            `管理者 UID: ${managerUserId}`,
            'Firebase Auth 側で設定した既存パスワードをそのまま使用してください。',
          ].join('\n'))
        }).catch((error) => {
          const message = error instanceof Error ? error.message : '教室追加に失敗しました。'
          setPersistenceMessage(message)
          window.alert('教室追加に失敗しました: ' + message)
        })
        return
      }

      if (!isRemoteAdminAutomationEnabled) {
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
    }).then(async (result) => {
      const successMessage = result.cleanupWarning
        ? `管理者 UID を差し替えました。${result.cleanupWarning}`
        : isRemoteAdminAutomationEnabled
          ? '管理者 UID を差し替えました。旧 Authentication ユーザーも削除しました。'
          : '管理者 UID を差し替えました。旧 Authentication ユーザーの削除は Firebase Console で確認してください。'
      await reloadRemoteWorkspace(successMessage, classroomId)
    }).catch((error) => {
      const message = error instanceof Error ? error.message : '管理者 UID の差し替えに失敗しました。'
      setPersistenceMessage(message)
    })
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, reloadRemoteWorkspace, workspaceClassrooms, workspaceUsers])

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

  const syncDeveloperCloudAutoBackups = useCallback(async (handleOverride?: DeveloperCloudBackupDirectoryHandle | null) => {
    if (!developerCloudBackupEnabled) return { synced: false, message: '' }
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) return { synced: false, message: '' }

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

    const folderName = developerCloudBackupFolderName || targetHandle.name

    // サーバーバックアップ一覧を取得して未同期分をダウンロード・書き込み
    const summaries = await listFirebaseServerAutoBackupSummaries()
    setServerAutoBackupSummaries(summaries)
    const unsyncedSummaries = summaries.filter((s) => !developerCloudSyncedAutoBackupKeys.includes(s.backupDateKey))
    if (unsyncedSummaries.length === 0) {
      const message = `${folderName}: 同期済みです。(${summaries.length} 件)`
      setDeveloperCloudBackupStatus(message)
      return { synced: true, message }
    }

    setDeveloperCloudBackupStatus(`${folderName}: ${unsyncedSummaries.length} 件のバックアップを同期中…`)
    const newlySyncedKeys: string[] = []
    for (const summary of unsyncedSummaries) {
      try {
        const snapshotJson = await downloadFirebaseServerAutoBackup(summary.backupDateKey)
        const fileName = formatPreciseBackupFileName(summary.savedAt, '開発者バックアップ_自動保存')
        await writeTextFileToDeveloperCloudDirectory(targetHandle, fileName, snapshotJson)
        newlySyncedKeys.push(summary.backupDateKey)
      } catch {
        // 1件の失敗で全体を止めない
      }
    }

    if (newlySyncedKeys.length > 0) {
      setDeveloperCloudSyncedAutoBackupKeys((current) => [...current, ...newlySyncedKeys])
    }

    const message = `${folderName}: ${newlySyncedKeys.length} 件を同期しました。(全 ${summaries.length} 件)`
    setDeveloperCloudBackupStatus(message)
    return { synced: true, message }
  }, [developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupHandle, developerCloudSyncedAutoBackupKeys, isRemoteAdminAutomationEnabled, isRemoteBackendEnabled])

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

  const openDeveloperRestoreModal = useCallback((restoringSnapshot: WorkspaceSnapshot, sourceLabel: string, dataTimestampLabel?: string) => {
    const currentSnapshot = buildWorkspaceSnapshot(new Date().toISOString())
    setDeveloperRestoreModalState(buildDeveloperRestoreModalState(currentSnapshot, restoringSnapshot, sourceLabel, dataTimestampLabel))
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

    // 復元した教室は acting 教室とは限らない(例: 開発用を開いたまま日大前だけ復元)。
    // 全教室書き込みフォールバックを廃止したため、復元した教室IDを明示的に対象指定して
    // Firebase へ保存する(選択した教室「だけ」を確実に永続化し、他教室は一切触らない)。
    if (isRemoteBackendEnabled && remoteSessionUserId) {
      const restoredClassroomIds = Array.from(restoreByClassroomId.entries())
        .filter(([, selected]) => selected)
        .map(([classroomId]) => classroomId)
        .filter((classroomId) => mergeResult.snapshot.classrooms.some((classroom) => classroom.id === classroomId))
      if (restoredClassroomIds.length > 0) {
        queueFirebaseWorkspaceSync(mergeResult.snapshot, true, true, restoredClassroomIds, {
          onSuccess: () => setPersistenceMessage(`選択した教室(${restoredClassroomIds.length}件)を復元し、Firebase へ保存しました。`),
          onFailure: (error) => setPersistenceMessage(`復元しましたが Firebase 保存に失敗しました。${error instanceof Error ? error.message : ''}`),
        })
      }
    }
  }, [applyWorkspaceSnapshot, developerRestoreModalState, isRemoteBackendEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId, saveUndoSnapshot])

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
    const queuedSnapshot = queueCurrentWorkspaceSnapshotPersistence()
    setSubmissionAcknowledgements([])
    // 【本番データ混入防止】アカウント切替で前セッションの「直前に戻す(undo)」が残ると、
    // 別教室にログインした画面にバナーが出て、押すと前教室のデータを現在の教室へ書き込んでしまう。
    // ログアウト時に必ず undo を破棄する(在庫の取り違えを断つ)。
    setUndoSnapshot(null)
    setDeveloperRestoreModalState(null)

    if (shouldReturnDeveloperOnLogout(screenRef.current, currentUser?.role)) {
      setScreen('developer')
      setPersistenceMessage(queuedSnapshot && isRemoteBackendEnabled && remoteSessionUserId
        ? '開発者画面に戻りました。教室データを同期しています…'
        : '開発者画面に戻りました。')
      return
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
  }, [actingClassroomId, currentUser?.role, isRemoteBackendEnabled, queueCurrentWorkspaceSnapshotPersistence, remoteSessionUserId, syncCurrentClassroomData])

  const saveBoard = useCallback(() => {
    // クリックした瞬間に必ず「保存中…」表示へ切り替える。後続処理の順序やタイミングに
    // 依存せず、ユーザーが押したことが一目で分かるよう最優先でフラグを立てる。
    updateSavingNow(true)
    const shouldShowManualSaveProgress = isRemoteBackendEnabled && Boolean(remoteSessionUserId)
    if (shouldShowManualSaveProgress) {
      updateRemoteSyncVisible(true)
      setRemoteSyncProgress({ percent: 1, label: 'ブラウザへ保存中', elapsedSeconds: 0 })
    }

    clearDelayedAutoRemoteSyncTimer()
    syncCurrentClassroomData(actingClassroomId)
    if (!remoteSaveInFlightRef.current) remoteSyncStartedAtRef.current = Date.now()

    if (!isSnapshotPersistenceRuntimeEnabled()) {
      updateSavingNow(false)
      updateRemoteSyncVisible(false)
      setRemoteSyncProgress(null)
      setPersistenceMessage('スナップショット保存が無効化されています。')
      return
    }

    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    if (isRemoteBackendEnabled && remoteSessionUserId) {
      try {
        markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, getCurrentClassroomSyncTargetIds(snapshot))
      } catch {
        // The async save path below still attempts IndexedDB/localStorage persistence.
      }
    }

    // 保存開始時のデータ署名を記録。保存完了時に現在のデータが当時と同じなら（＝保存中に
    // ユーザーが編集していなければ）clean 署名を更新して「最新データ」表示へ切り替える。
    const signatureAtStart = buildCurrentDataSignature()
    const finalizeClean = () => {
      if (buildCurrentDataSignature() === signatureAtStart) {
        setCleanSignature(signatureAtStart)
      }
    }

    const downloadFallbackBackup = () => {
      try {
        downloadTextFile(
          formatBackupFileName(snapshot.savedAt, '保存失敗時バックアップ'),
          serializeWorkspaceSnapshot(snapshot),
          'application/json',
        )
        return true
      } catch {
        return false
      }
    }

    void (async () => {
      const localResult = await saveWorkspaceSnapshot(snapshot).catch(() => ({ savedToIndexedDb: false, savedToLocalStorage: false }))
      const savedLocally = localResult.savedToIndexedDb || localResult.savedToLocalStorage

        if (savedLocally) {
          setLastSavedAt(snapshot.savedAt)
          if (isRemoteBackendEnabled && remoteSessionUserId) {
            queueFirebaseWorkspaceSync(snapshot, true, true, getCurrentClassroomSyncTargetIds(snapshot), {
              downloadBackupOnFailure: manualFirebaseSaveStabilityEnabled,
            onSuccess: () => {
              finalizeClean()
              updateSavingNow(false)
            },
            onFailure: () => {
              updateSavingNow(false)
            },
          })
            return
          }
          finalizeClean()
          updateSavingNow(false)
          updateRemoteSyncVisible(false)
          setRemoteSyncProgress(null)
          setPersistenceMessage('保存しました。')
          return
        }

        updateSavingNow(false)
        updateRemoteSyncVisible(false)
        setRemoteSyncProgress(null)
        const downloaded = downloadFallbackBackup()
        setPersistenceMessage(downloaded
          ? '保存に失敗したため、バックアップJSONを自動ダウンロードしました。'
          : '保存に失敗しました。バックアップを書き出してください。')
        if (downloaded) {
          window.alert(SAVE_FAILURE_GUIDANCE_MESSAGE)
        }
      })()
  }, [actingClassroomId, buildCurrentDataSignature, buildWorkspaceSnapshot, clearDelayedAutoRemoteSyncTimer, getCurrentClassroomSyncTargetIds, isRemoteBackendEnabled, manualFirebaseSaveStabilityEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId, syncCurrentClassroomData, setCleanSignature, updateRemoteSyncVisible, updateSavingNow])

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
    const activeStudents = students.filter((s) => s.entryDate <= session.endDate && (!s.withdrawDate || s.withdrawDate === '未定' || s.withdrawDate >= session.startDate))
    const activeTeachers = teachers.filter((t) => t.entryDate <= session.endDate && (!t.withdrawDate || t.withdrawDate === '未定' || t.withdrawDate >= session.startDate))

    const allStudentsHaveTokens = activeStudents.every((s) => session.studentInputs[s.id]?.submissionToken)
    const allTeachersHaveTokens = activeTeachers.every((t) => session.teacherInputs[t.id]?.submissionToken)

    // Build occupied slots from board cells
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    // 盤面データは boardStateRef(最新)から読む。boardState を依存に入れると出席等の編集ごとに
    // この callback の identity が変わり、これを依存する日程表同期 effect が毎編集で再発火して
    // popup を再生成してしまう(メモリ最大スパイク要因)。ref 経由なら呼び出し時に最新を参照しつつ
    // identity を安定化でき、同期は「popup を開いた時/範囲変更時/手動『最新表示』時」だけになる。
    const latestBoardStateForTokens = boardStateRef.current
    const sessionBoardWeeks = ensureWeeksCoverDateRange({
      weeks: latestBoardStateForTokens?.weeks ?? runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      startDate: session.startDate,
      endDate: session.endDate,
      classroomSettings,
      teachers,
      students,
      regularLessons: displayRegularLessons,
    }).weeks
    const sessionCells = buildScheduleCellsForRange({
      range: { startDate: session.startDate, endDate: session.endDate, periodValue: '' },
      fallbackStartDate: session.startDate,
      fallbackEndDate: session.endDate,
      classroomSettings,
      teachers,
      students,
      regularLessons: displayRegularLessons,
      boardWeeks: sessionBoardWeeks,
      suppressedRegularLessonOccurrences: latestBoardStateForTokens?.suppressedRegularLessonOccurrences ?? [],
    })
    const lessonTypeLabels: Record<string, string> = { extra: '増コマ', regular: '通常', makeup: '振替', special: '講習' }
    const slotNumbers = Array.from(new Set(sessionCells.map((cell) => cell.slotNumber))).sort((left, right) => left - right)
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

    // spec-group-lesson §E: 提出ページの集団列(1限の左)に出す、盤面の集団授業コマ(集理/集社)を抽出。
    // key=`${dateKey}_${band}`、value=科目。講習期間内のみ。中3生徒の提出ドキュメントへ載せる。
    const sessionGroupClassSlots: Record<string, string> = {}
    for (const entry of Object.values(latestBoardStateForTokens?.groupClassEntries ?? {})) {
      if (!entry || !entry.subject) continue
      if (entry.dateKey < session.startDate || entry.dateKey > session.endDate) continue
      sessionGroupClassSlots[`${entry.dateKey}_${entry.band}`] = entry.subject
    }
    // spec-group-lesson §C: 集団参加の選択肢は「その講習に少なくとも1回盤面登録された集団科目」だけ出す。
    // 集団を設定しない講習では空配列になり、QR提出ページの集団欄を出さない(中3でも)。
    const sessionGroupClassSubjects = resolveRegisteredGroupClassSubjects(
      latestBoardStateForTokens?.groupClassEntries,
      session.startDate,
      session.endDate,
    )

    const referenceDate = session.startDate
    // オプション欄(開発用教室のみ): 学年共通のオプション文言(行0..4)を QR 提出ドキュメントへ載せる。
    // キーは生徒日程表と同じ scheduleNotes 形式(student:student-option-grade-{学年}-{行})。
    // 重要: 生徒日程表のオプション欄は「今日基準の学年」(currentGradeLabel)でキーを作って保存する。
    //   ここで講習開始日基準の学年で読むと学年が食い違い空文字になり、QR にオプションが出ない不具合になる。
    //   そのため読み取りも生徒日程表と同じ「今日基準の学年」で行う。
    const optionReferenceDate = getReferenceDateKey(new Date())
    const optionFieldEnabled = isFeatureEnabledForClassroom('studentScheduleOptionField', actingClassroom)
    const resolveStudentOptionLabels = (student: StudentRow): string[] => {
      if (!optionFieldEnabled) return []
      const optionGradeLabel = resolveCurrentStudentGradeLabel(student, optionReferenceDate)
      const notes = classroomSettings.scheduleNotes ?? {}
      return Array.from({ length: 5 }, (_, i) => String(notes[`student:student-option-grade-${optionGradeLabel}-${i}`] ?? '').trim())
    }
    const studentsWithSubjects = activeStudents.map((s) => {
      const gradeLabel = resolveCurrentStudentGradeLabel(s, referenceDate)
      const isThirdGrade = gradeLabel === '中3'
      return {
        id: s.id,
        name: getStudentDisplayName(s),
        availableSubjects: getSelectableStudentSubjectsForGrade(gradeLabel),
        // spec-group-lesson §C: 集団授業の希望提出は中3のみ表示。学年は講習開始日基準で判定。
        availableGroupClassSubjects: isThirdGrade ? [...sessionGroupClassSubjects] : [],
        occupiedSlots: studentOccupiedMap.get(s.id) ?? {},
        // spec-group-lesson §E: 集団列は中3のみ。生徒日程表と同じく盤面の集団コマをそのまま反映する。
        groupClassSlots: isThirdGrade ? sessionGroupClassSlots : {},
        optionLabels: resolveStudentOptionLabels(s),
      }
    })
    const teacherList = activeTeachers.map((t) => ({ id: t.id, name: getTeacherDisplayName(t), occupiedSlots: teacherOccupiedMap.get(t.id) ?? {} }))

    const { updatedSession, newTokens } = allStudentsHaveTokens && allTeachersHaveTokens
      ? { updatedSession: session, newTokens: [] }
      : await ensureSubmissionTokens(session, studentsWithSubjects, teacherList, classroomSettings, slotNumbers)

    if (newTokens.length > 0) {
      await writeSubmissionDocs(newTokens, actingClassroomId)
      // A4: await 中に届いた別生徒のQR提出反映を巻き戻さないよう、丸ごと置換ではなく current へ
      // 新規発行トークンだけをマージする(applyIssuedSubmissionTokensToSessions のガード参照)。
      setSpecialSessions((current) => applyIssuedSubmissionTokensToSessions(
        current,
        updatedSession.id,
        newTokens.map((entry) => ({ personType: entry.doc.personType, personId: entry.doc.personId, token: entry.token })),
        updatedSession.updatedAt,
      ))
    }

    // Update occupiedSlots on existing pending submission docs so phone shows current board state
    const existingTokenEntries: Array<{ token: string; occupiedSlots: Record<string, string>; slotNumbers: number[]; holidayDates: string[]; groupClassSlots?: Record<string, string>; optionLabels?: string[] }> = []
    const newTokenSet = new Set(newTokens.map((t) => t.token))
    const tokenHolidayDates = [...classroomSettings.holidayDates]
    for (const s of activeStudents) {
      const studentInput = updatedSession.studentInputs[s.id]
      const token = studentInput?.submissionToken
      if (token && !newTokenSet.has(token)) {
        const gradeLabel = resolveCurrentStudentGradeLabel(s, referenceDate)
        const isThirdGrade = gradeLabel === '中3'
        existingTokenEntries.push({ token, occupiedSlots: studentOccupiedMap.get(s.id) ?? {}, slotNumbers, holidayDates: tokenHolidayDates, groupClassSlots: isThirdGrade ? sessionGroupClassSlots : {}, optionLabels: resolveStudentOptionLabels(s) })
        // spec-group-lesson §C: 既配布QR(集団欄なし)でも中3が集団を選べるよう、未提出なら集団科目を後埋め。
        // 盤面に登録された集団科目のみ。空(集団未設定の講習)なら集団欄を出さないよう [] で後埋めする。
        if (!studentInput?.countSubmitted && resolveCurrentStudentGradeLabel(s, referenceDate) === '中3') {
          void updateSubmissionGroupClassEligibility(token, [...sessionGroupClassSubjects]).catch(() => { /* non-fatal */ })
        }
      }
    }
    for (const t of activeTeachers) {
      const token = updatedSession.teacherInputs[t.id]?.submissionToken
      if (token && !newTokenSet.has(token)) {
        existingTokenEntries.push({ token, occupiedSlots: teacherOccupiedMap.get(t.id) ?? {}, slotNumbers, holidayDates: tokenHolidayDates })
      }
    }
    if (existingTokenEntries.length > 0) {
      updateSubmissionOccupiedSlots(existingTokenEntries).catch(() => { /* non-fatal */ })
    }
  }, [actingClassroomId, boardStateRef, classroomSettings, displayRegularLessons, specialSessions, students, teachers])

  const buildPopupBoardWeeksForRange = useCallback((range: ScheduleRangePreference) => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const latestBoardState = boardStateRef.current
    const sourceWeeks = latestBoardState?.weeks ?? runtimeWindow.__lessonScheduleBoardWeeks ?? []
    return ensureWeeksCoverDateRange({
      weeks: sourceWeeks,
      startDate: range.startDate,
      endDate: range.endDate,
      classroomSettings,
      teachers,
      students,
      regularLessons: displayRegularLessons,
    }).weeks
  }, [boardStateRef, classroomSettings, displayRegularLessons, students, teachers])

  const getHighlightedTeacherIdFromBoardState = useCallback((nextBoardState: PersistedBoardState | null | undefined) => {
    const selectedCellId = nextBoardState?.selectedCellId
    const selectedDeskIndex = nextBoardState?.selectedDeskIndex
    if (!selectedCellId || typeof selectedDeskIndex !== 'number' || selectedDeskIndex < 0) return undefined

    const selectedCell = (nextBoardState?.weeks ?? []).flat().find((cell) => cell.id === selectedCellId)
    const selectedDesk = selectedCell?.desks?.[selectedDeskIndex]
    const teacherName = typeof selectedDesk?.teacher === 'string' ? selectedDesk.teacher.trim() : ''
    if (!teacherName) return undefined

    return teachers.find((teacher) => getTeacherDisplayName(teacher) === teacherName)?.id
  }, [teachers])

  // force=false の自動同期は実行しない(ゲート)。日程表の再生成は popup を開いた時/「最新表示」
  // ボタン押下時など明示パス(force=true)のみに限定する。本番では編集→Firestore往復で
  // specialSessions 等が更新され、それを依存する effect が再発火して毎編集で popup を再生成して
  // しまう(メモリ最大スパイク)。トリガを個別に潰すのではなく、ここで一括して自動再生成を止める。
  // rangeOverride を渡すと state 反映待ちなしにその範囲で即同期できる(「最新表示」用)。
  const syncStudentSchedulePopup = useCallback((force = false, rangeOverride: ScheduleRangePreference | null = null) => {
    if (!force) return
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const studentPopup = runtimeWindow.__lessonScheduleStudentWindow
    if (!studentPopup || studentPopup.closed) return
    bumpMemCounter('student-schedule-sync')
    const latestBoardState = boardStateRef.current
    const latestSpecialSessions = specialSessionsRef.current

    const range = buildNormalizedScheduleRange('student', rangeOverride ?? studentScheduleRange, actingClassroomId)
  const scheduleBoardWeeks = buildPopupBoardWeeksForRange(range)

    syncStudentScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: scheduleBoardWeeks,
        suppressedRegularLessonOccurrences: latestBoardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      students,
      regularLessons: displayRegularLessons,
      regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
      preTemplateRegularLessons: classroomSettings.preTemplateRegularLessons,
      scheduleCountAdjustments: latestBoardState?.scheduleCountAdjustments ?? [],
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      defaultPersonId: range.personId,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      classroomStorageKey: actingClassroomId ?? undefined,
      periodBands: latestSpecialSessions,
      specialSessions: latestSpecialSessions,
      lazyQrLoading: true,
      showSubmittedQr: true,
      targetWindow: studentPopup,
    })
  }, [actingClassroomId, boardStateRef, buildPopupBoardWeeksForRange, classroomSettings, displayRegularLessons, specialSessionsRef, studentScheduleRange, students, teachers])

  // syncStudentSchedulePopup と同様に force=true の明示パスのみ同期する(自動再生成の停止)。
  const syncTeacherSchedulePopup = useCallback((force = false, rangeOverride: ScheduleRangePreference | null = null) => {
    if (!force) return
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const teacherPopup = runtimeWindow.__lessonScheduleTeacherWindow
    if (!teacherPopup || teacherPopup.closed) return
    bumpMemCounter('teacher-schedule-sync')
    const latestBoardState = boardStateRef.current
    const latestSpecialSessions = specialSessionsRef.current
    const highlightedTeacherId = getHighlightedTeacherIdFromBoardState(latestBoardState)

    const range = buildNormalizedScheduleRange('teacher', rangeOverride ?? teacherScheduleRange, actingClassroomId)
  const scheduleBoardWeeks = buildPopupBoardWeeksForRange(range)

    syncTeacherScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons: displayRegularLessons,
        boardWeeks: scheduleBoardWeeks,
        suppressedRegularLessonOccurrences: latestBoardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      teachers,
      students,
      regularLessons: displayRegularLessons,
      regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
      preTemplateRegularLessons: classroomSettings.preTemplateRegularLessons,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      defaultPersonId: range.personId,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      classroomStorageKey: actingClassroomId ?? undefined,
      highlightedTeacherId,
      periodBands: latestSpecialSessions,
      specialSessions: latestSpecialSessions,
      lazyQrLoading: true,
      showSubmittedQr: true,
      targetWindow: teacherPopup,
    })
  }, [actingClassroomId, boardStateRef, buildPopupBoardWeeksForRange, classroomSettings, displayRegularLessons, getHighlightedTeacherIdFromBoardState, specialSessionsRef, students, teacherScheduleRange, teachers])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {
      const message = event.data
      if (!message) return

      if (message.type === 'schedule-refresh-request') {
        // 明示リフレッシュ(force=true)
        if (message.viewType === 'student') syncStudentSchedulePopup(true)
        if (message.viewType === 'teacher') syncTeacherSchedulePopup(true)
        return
      }

      if (message.type === 'schedule-popup-ready') {
        // popup を開いた直後の初期同期(force=true)
        if (message.viewType === 'student') {
          const range = buildNormalizedScheduleRange('student', studentScheduleRange, actingClassroomId)
          void ensureScheduleSubmissionTokens(range.startDate, range.endDate)
            .then(() => { syncStudentSchedulePopup(true) })
            .catch(() => { syncStudentSchedulePopup(true) })
        }
        if (message.viewType === 'teacher') {
          const range = buildNormalizedScheduleRange('teacher', teacherScheduleRange, actingClassroomId)
          void ensureScheduleSubmissionTokens(range.startDate, range.endDate)
            .then(() => { syncTeacherSchedulePopup(true) })
            .catch(() => { syncTeacherSchedulePopup(true) })
        }
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
                subjectDurations: previousInput?.subjectDurations ?? {},
                // spec-group-lesson §C: 明示再構築のため集団参加を保全（spread していないので消えるのを防ぐ）。
                groupClassParticipation: previousInput?.groupClassParticipation ?? {},
                // オプション欄(開発用教室): 明示再構築のためオプションチェックも保全（QR提出値を消さない）。
                optionChecks: previousInput?.optionChecks ?? {},
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
                // 科目ごとの授業時間(分): 登録ダイアログ(生徒日程表)で送られた値を反映。QRと同じく 60/45 のみ採用、
                // 未送信(unsubmit等)は既存を保全して消さない(QR提出値を消さない)。regularOnly は空。
                subjectDurations: regularOnly ? {} : (() => {
                  const raw = message.subjectDurations
                  if (raw === undefined) return previousInput?.subjectDurations ?? {}
                  if (!raw || typeof raw !== 'object') return {}
                  const result: Record<string, number> = {}
                  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
                    const minutes = typeof value === 'number' ? value : Number(value)
                    if (minutes === 60 || minutes === 45) result[key] = minutes
                  }
                  return result
                })(),
                // spec-group-lesson §C / Phase 7: 集団参加は講習回数とは独立。「登録」ボタンで送られた値を反映し、
                // 未送信（unsubmit等）では既存を保全して消さない。反映漏れは出席者一覧に出ない回帰になる。
                groupClassParticipation: resolveSavedGroupClassParticipation(message.groupClassParticipation, previousInput?.groupClassParticipation),
                // オプション欄(開発用教室): 登録で送られたチェックを反映、未送信は既存を保全(QR提出値を消さない)。
                optionChecks: (() => {
                  const raw = message.optionChecks
                  if (raw === undefined) return previousInput?.optionChecks ?? {}
                  if (!raw || typeof raw !== 'object') return {}
                  const result: Record<string, boolean> = {}
                  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
                    if (value === true) result[key] = true
                  }
                  return result
                })(),
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

        const targetSession = specialSessionsRef.current.find((session) => session.id === message.sessionId)
        const targetInput = targetSession?.studentInputs[message.personId]
        const studentToken = targetInput?.submissionToken
        if (studentToken) {
          // spec-special-session-submission §E / TODO2: 登録確定で提出ロック、登録解除(削除)で提出をリセット→同QRで再提出可能。
          // spec-group-lesson §C 回帰修正: 室長が日程表で決めた集団参加/オプションを提出ドキュメントにも書き戻す。
          // doc を更新しないと購読の反映(doc→ローカル)が空で上書きし、生徒日程表での集団参加登録が
          // 「最新表示」/再読込で消える(submissionReflection.ts と対になる修正)。
          if (countSubmitted) {
            markLectureSubmissionDocAsSubmitted(studentToken, {
              groupClassParticipation: targetInput?.groupClassParticipation ?? {},
              optionChecks: targetInput?.optionChecks ?? {},
            }).catch(() => { /* non-fatal */ })
          } else {
            // B4: reset 前に token をガードへ登録し、リセット前の古い submitted 購読で
            // countSubmitted が復活するのを防ぐ。TTL(既定2.5秒)後にガードが自動で解除する。
            recentlyResetSubmissionGuardRef.current.add(studentToken)
            resetLectureSubmissionDoc(studentToken).catch(() => { /* non-fatal */ })
          }
        }
        return
      }

      if (message.type === 'schedule-student-group-save') {
        // spec-group-lesson §C: 室長が日程表モーダルから集団参加を設定。既存の提出/登録データと提出状況は維持する。
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        const rawParticipation = message.groupClassParticipation && typeof message.groupClassParticipation === 'object'
          ? message.groupClassParticipation as Record<string, unknown>
          : {}
        const groupClassParticipation: Record<string, boolean> = {}
        for (const subject of groupClassSubmissionSubjects) {
          if (rawParticipation[subject] === true) groupClassParticipation[subject] = true
        }
        const updatedAt = new Date().toISOString()
        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session
          const previousInput = session.studentInputs[message.personId]
          const nextInput = previousInput
            ? { ...previousInput, groupClassParticipation, updatedAt }
            : { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, groupClassParticipation, regularOnly: false, countSubmitted: false, updatedAt }
          return {
            ...session,
            studentInputs: { ...session.studentInputs, [message.personId]: nextInput },
            updatedAt,
          }
        }))
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
          items: [{
            sessionId: message.sessionId,
            teacherId: message.personId,
            mode: countSubmitted ? 'assign' : 'unassign',
          }],
        })

        const targetTeacherSession = specialSessionsRef.current.find((session) => session.id === message.sessionId)
        const teacherToken = targetTeacherSession?.teacherInputs[message.personId]?.submissionToken
        if (teacherToken) {
          // spec-special-session-submission §E / TODO2: 登録確定で提出ロック、登録解除(削除)で提出をリセット→同QRで再提出可能。
          if (countSubmitted) markLectureSubmissionDocAsSubmitted(teacherToken).catch(() => { /* non-fatal */ })
          else resetLectureSubmissionDoc(teacherToken).catch(() => { /* non-fatal */ })
        }
        return
      }

      if (message.type !== 'schedule-range-update') return
      if (message.viewType !== 'student' && message.viewType !== 'teacher') return
      if (typeof message.startDate !== 'string' || typeof message.endDate !== 'string') return

      const nextRange = {
        startDate: message.startDate,
        endDate: message.endDate,
        periodValue: typeof message.periodValue === 'string' ? message.periodValue : '',
        personId: typeof message.personId === 'string' ? message.personId : '',
      }

      // 「最新表示」ボタン由来。範囲を保存しつつ、state 反映を待たずに nextRange で即 force 同期する
      // (これが popup を更新する唯一の能動パス)。
      // 重要(回帰修正 2026-06-22): 盤面内容(講習の自動割振結果など)は QR トークンに依存しないため、
      // 先に同期して即反映する。以前は ensureScheduleSubmissionTokens(Firebase往復)の完了を待ってから
      // 同期していたため、本番(Firebaseモード)では講習の自動割振直後に「最新表示」を押しても、トークン確保の
      // 往復が終わるまで(あるいは失敗時に)盤面変更が popup に反映されない不具合があった。
      // トークンは QR 画像の更新にのみ必要なので、確保できたら再同期して QR を差し替える。
      if (message.viewType === 'student') {
        setStudentScheduleRange(nextRange)
        syncStudentSchedulePopup(true, nextRange)
        const range = buildNormalizedScheduleRange('student', nextRange, actingClassroomId)
        void ensureScheduleSubmissionTokens(range.startDate, range.endDate)
          .then(() => { syncStudentSchedulePopup(true, nextRange) })
          .catch(() => { /* 初回同期済みのためトークン確保失敗は無視 */ })
      } else {
        setTeacherScheduleRange(nextRange)
        syncTeacherSchedulePopup(true, nextRange)
        const range = buildNormalizedScheduleRange('teacher', nextRange, actingClassroomId)
        void ensureScheduleSubmissionTokens(range.startDate, range.endDate)
          .then(() => { syncTeacherSchedulePopup(true, nextRange) })
          .catch(() => { /* 初回同期済みのためトークン確保失敗は無視 */ })
      }
    }

    window.addEventListener('message', handleScheduleRangeMessage)
    return () => window.removeEventListener('message', handleScheduleRangeMessage)
  }, [actingClassroomId, ensureScheduleSubmissionTokens, studentScheduleRange, teacherScheduleRange, syncStudentSchedulePopup, syncTeacherSchedulePopup])

  useEffect(() => {
    const timerId = window.setTimeout(() => syncStudentSchedulePopup(), 400)
    return () => window.clearTimeout(timerId)
  }, [syncStudentSchedulePopup])

  useEffect(() => {
    const timerId = window.setTimeout(() => syncTeacherSchedulePopup(), 400)
    return () => window.clearTimeout(timerId)
  }, [syncTeacherSchedulePopup])

  useEffect(() => {
    // 範囲・講習・コールバック変更時の再同期もデバウンスして、popup の全日程再生成の連発を防ぐ。
    const timerId = window.setTimeout(() => {
      const syncSchedulePopupForRange = (viewType: 'student' | 'teacher') => {
        const range = buildNormalizedScheduleRange(
          viewType,
          viewType === 'student' ? studentScheduleRange : teacherScheduleRange,
          actingClassroomId,
        )
        void ensureScheduleSubmissionTokens(range.startDate, range.endDate)
          .then(() => {
            if (viewType === 'student') syncStudentSchedulePopup()
            else syncTeacherSchedulePopup()
          })
          .catch(() => {
            if (viewType === 'student') syncStudentSchedulePopup()
            else syncTeacherSchedulePopup()
          })
      }

      syncSchedulePopupForRange('student')
      syncSchedulePopupForRange('teacher')
    }, 400)
    return () => window.clearTimeout(timerId)
  }, [actingClassroomId, ensureScheduleSubmissionTokens, specialSessions, studentScheduleRange, teacherScheduleRange, syncStudentSchedulePopup, syncTeacherSchedulePopup])

  useEffect(() => {
    if (typeof window === 'undefined' || !boardState) return
    // 日程表ポップアップは __lessonScheduleBoardWeeks をボード実績データとして参照する。
    // 以前は screen !== 'board' のときだけ更新していたが、コマ表画面のままハードリロード
    // した場合などに global が初期化されず、ポップアップが空 boardWeeks で overlay して
    // 生徒授業が脱落していたため、screen に関わらず常に最新の boardState.weeks を反映する。
    // ※ この代入は軽量(参照差し替えのみ)。手動「盤面を反映」ボタン押下時に最新が使われる。
    getSchedulePopupRuntimeWindow().__lessonScheduleBoardWeeks = boardState.weeks
    // 以前は盤面変更のたびに講師/生徒/講習の全日程ポップアップを再生成していたが、出席等を
    // 連続入力する教室では(特に両 popup を開いたまま)毎編集の全日程再生成がメモリの最大スパイク要因
    // だった。日程表は popup ツールバーの「盤面を反映」ボタン(schedule-refresh-request)や範囲変更時
    // にのみ再同期する方式へ変更し、編集ごとの自動再生成を停止する。
  }, [boardState])

  // Real-time submission reflection from Firestore
  useEffect(() => {
    if (!isRemoteBackendEnabled || !actingClassroomId) return

    const unsubscribe = subscribeLectureSubmissions(actingClassroomId, (entries, isInitial) => {
      bumpMemCounter('submission-snapshot')
      // Skip entries whose tokens were recently reset to avoid race condition
      const activeEntries = entries.filter((e) => !recentlyResetSubmissionGuardRef.current.has(e.token))
      if (activeEntries.length === 0) return

      const newlyAppliedEntries: typeof activeEntries = []

      // 登録済み生徒に対する保護者所有フィールド(optionChecks/groupClassParticipation)の反映が
      // あったか。newlyAppliedEntries とは別管理にし、これがあれば state を更新する(下の return 参照)。
      let reflectedParentFields = false

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
              if (existing?.countSubmitted) {
                // 登録済みでも、保護者がQRで決める optionChecks / groupClassParticipation は
                // 常に最新の提出値を反映する(回数・配置は再実行しない)。反映しないと室長ローカルが
                // 古いまま手動保存され、Cloud Function がスナップショットへ統合した正しい提出値を
                // 上書きして消す(QRチェックが日程表に出ない不具合の本体)。変化が無ければ据え置き。
                const reflected = reflectParentOwnedSubmissionFields(existing, entry)
                if (!reflected) return session
                reflectedParentFields = true
                return {
                  ...session,
                  studentInputs: {
                    ...session.studentInputs,
                    [entry.personId]: { ...existing, ...reflected, updatedAt: now },
                  },
                  updatedAt: now,
                }
              }
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
                    subjectDurations: entry.regularOnly ? {} : entry.subjectDurations,
                    // spec-group-lesson §C: 提出された集団参加を反映(講習回数とは独立・既存は維持)。
                    groupClassParticipation: entry.groupClassParticipation ?? existing?.groupClassParticipation ?? {},
                    // オプション欄(開発用教室): 提出されたチェック状態を反映(既存は維持)。
                    optionChecks: entry.optionChecks ?? existing?.optionChecks ?? {},
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
        // 新規反映(登録)または保護者所有フィールドの反映が無ければ参照を維持し、不要な再描画を避ける。
        return newlyAppliedEntries.length > 0 || reflectedParentFields ? updated : current
      })

      // Trigger board placement for newly submitted teachers (same as schedule-teacher-count-save handler)
      // ⚠️ 回帰防止(2026-06-30): 反映した講師全員を1リクエストの items にまとめる。1人ずつ
      // setTeacherAutoAssignRequest を呼ぶと単一 state が上書きされ最後の1人しか配置されない。
      const teacherAutoAssignItems = buildTeacherAutoAssignItems(newlyAppliedEntries)
      if (teacherAutoAssignItems.length > 0) {
        teacherAutoAssignRequestIdRef.current += 1
        setTeacherAutoAssignRequest({
          requestId: teacherAutoAssignRequestIdRef.current,
          items: teacherAutoAssignItems,
        })
      }

      // 購読直後の初回スナップショットは「既存の提出済み」を一括配信するだけなので、
      // 起動/教室切替の直後に過去の提出を「新着QR提出通知」として出さない(データ反映は上で実施済み)。
      if (!isInitial) {
        const nextAcknowledgements = buildSubmissionAcknowledgementEntries(newlyAppliedEntries, {
          specialSessions: specialSessionsRef.current,
          students: studentsRef.current,
          teachers: teachersRef.current,
          classroomName: actingClassroom?.name,
        })
        if (nextAcknowledgements.length > 0) {
          setSubmissionAcknowledgements((current) => {
            const existingIds = new Set(current.map((entry) => entry.id))
            const freshEntries = nextAcknowledgements.filter((entry) => !existingIds.has(entry.id))
            return freshEntries.length > 0 ? [...current, ...freshEntries] : current
          })
        }
      }
    })

    return unsubscribe
  }, [actingClassroom?.name, actingClassroomId, isRemoteBackendEnabled, specialSessionsRef, studentsRef, teachersRef])

  useEffect(() => {
    if (currentUserId) return
    setSubmissionAcknowledgements([])
  }, [currentUserId])

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
          const { snapshot: resolvedSnapshot, usedPendingLocalSnapshot, pendingTargetClassroomIds } = resolveRemoteWorkspaceSnapshot(
            remoteSnapshot,
            localWorkspaceSnapshot,
            readPendingRemoteWorkspaceSnapshotMarker(),
            remoteSessionUserId,
            // A3: 読込直後のレジストリ=サーバー現在版数。stale 書き戻しの版数ゲートに使う。
            getAllClassroomSnapshotVersions(),
          )
          applyWorkspaceSnapshot(
            resolvedSnapshot,
            usedPendingLocalSnapshot ? '前回終了時の未同期データを復元しました。Firebase へ同期しています…' : 'Firebase から教室ワークスペースを読み込みました。',
          )
          if (usedPendingLocalSnapshot) {
            // ログイン直後の自動復元は静かに同期する（保存ボタンの回転や進捗バーを出さない）。
            queueFirebaseWorkspaceSync(resolvedSnapshot, false, false, pendingTargetClassroomIds, {
              onSuccess: () => {
                clearPendingRemoteWorkspaceSnapshotMarker()
                setPersistenceMessage('前回終了時の未同期データを復元し、Firebase へ同期しました。')
              },
              onFailure: (error) => {
                const message = error instanceof Error ? error.message : 'Firebase 同期に失敗しました。'
                setPersistenceMessage(`前回終了時の未同期データを復元しました。${message}`)
              },
            })
          }
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
  }, [applyWorkspaceSnapshot, hasCheckedRemoteSession, isRemoteBackendEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId, useImportedMasterData])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!developerCloudBackupEnabled) {
      setDeveloperCloudBackupStatus('保存フォルダへの自動保存は未設定です。')
      return
    }

    if (developerCloudBackupFolderName && developerCloudBackupHandle) {
      setDeveloperCloudBackupStatus(`${developerCloudBackupFolderName} を保存フォルダとして使用します。`)
      // アプリ起動時にサーバーバックアップを差分同期する
      void syncDeveloperCloudAutoBackups().catch(() => {})
      return
    }

    setDeveloperCloudBackupStatus('保存フォルダの再接続が必要です。')
  }, [developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupHandle, hasHydratedSnapshot, syncDeveloperCloudAutoBackups])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return
    if (workspaceUsers.length === 0 || workspaceClassrooms.length === 0) return
    // 算出済みの dataSignature を使い、変更ごとの余計な全データ stringify を避ける。
    if (dataSignature === cleanSignatureRef.current) return
    writePendingWorkspaceSnapshotForRemoteSync()
  }, [dataSignature, hasHydratedSnapshot, workspaceClassrooms.length, workspaceUsers.length, writePendingWorkspaceSnapshotForRemoteSync])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return
    if (workspaceUsers.length === 0 || workspaceClassrooms.length === 0) return
    // 既に算出済みの dataSignature を使い、変更ごとの余計な全データ stringify を避ける。
    if (dataSignature === cleanSignatureRef.current) return

    // 自動保存は1編集ごとに workspace 全体を IndexedDB へ直列化(structuredClone)するため、
    // 出席を連続入力する巨大教室では編集ピークの一因になっていた。debounce を 5 秒に延ばして
    // 連続入力中の保存をまとめる。ただし保存されない時間が延びすぎないよう、前回保存から
    // 最大 20 秒(maxWait)で必ず保存する。タブ切替/最小化/クローズ時は別途 visibilitychange/
    // beforeunload で flush されるため、通常の離脱でデータは失われない(クラッシュ時の未保存幅のみ拡大)。
    // (spec-save-restore.md §1: デバウンス5秒 / 最大20秒)
    const AUTOSAVE_DEBOUNCE_MS = 5000
    const AUTOSAVE_MAX_WAIT_MS = 20000
    const elapsedSinceLastSave = Date.now() - autosaveLastStartedAtRef.current
    const autosaveDelay = Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS - elapsedSinceLastSave))

    const timeoutId = window.setTimeout(() => {
      autosaveLastStartedAtRef.current = Date.now()
      bumpMemCounter('autosave-run')
      // 全データの deep clone と署名生成はデバウンス後にだけ行う。連続変更のたびに
      // workspace 全体を clone / stringify するのを避け、メモリ確保を大幅に削減する。
      const savedAt = new Date().toISOString()
      const snapshot = buildWorkspaceSnapshot(savedAt)
      const signatureAtStart = buildCurrentDataSignature()
      const finalizeClean = () => {
        if (buildCurrentDataSignature() === signatureAtStart) {
          setCleanSignature(signatureAtStart)
        }
      }
      if (!remoteSaveInFlightRef.current) remoteSyncStartedAtRef.current = Date.now()
      void saveWorkspaceSnapshot(snapshot)
        .then(() => {
          setLastSavedAt(snapshot.savedAt)

          if (isRemoteBackendEnabled && remoteSessionUserId) {
            clearDelayedAutoRemoteSyncTimer()
            updateRemoteSyncPending(true)
            delayedAutoRemoteSyncTimerRef.current = window.setTimeout(() => {
              delayedAutoRemoteSyncTimerRef.current = null
              queueFirebaseWorkspaceSync(snapshot, false, false, getCurrentClassroomSyncTargetIds(snapshot), {
                onSuccess: finalizeClean,
              })
            }, 12000)
            if (!isRemoteSyncVisibleRef.current) setPersistenceMessage('自動保存しました。')
          } else {
            finalizeClean()
            setPersistenceMessage('自動保存しました。')
          }

        })
        .catch(() => {
          setPersistenceMessage('自動保存に失敗しました。バックアップを書き出してください。')
        })
    }, autosaveDelay)

    return () => window.clearTimeout(timeoutId)
    // dataSignature を依存に含めることで、教室設定/通常授業/盤面など全ての保存対象データ変更後に
    // 自動保存(ローカル + Firebase)が必ず再走するようにする。これを外すと休日変更などが
    // ブラウザ終了前に Firebase へ同期されず、再ログイン時に古いリモートが優先されてしまう。
  }, [actingClassroomId, buildCurrentDataSignature, buildWorkspaceSnapshot, clearDelayedAutoRemoteSyncTimer, dataSignature, getCurrentClassroomSyncTargetIds, hasHydratedSnapshot, isRemoteBackendEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId, setCleanSignature, workspaceClassrooms.length, workspaceUsers.length])

  // Flush save on browser close / tab close to prevent data loss
  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (workspaceUsers.length === 0 || workspaceClassrooms.length === 0) return
      const hasUnsavedLatestChanges = buildCurrentDataSignature() !== cleanSignatureRef.current
      const shouldBlockUnload = hasUnsavedLatestChanges || isSavingNowRef.current || isRemoteSyncPendingRef.current
      if (shouldBlockUnload) {
        event.preventDefault()
        event.returnValue = ''
      }

      if (!hasUnsavedLatestChanges) return
      const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
      if (isRemoteBackendEnabled && remoteSessionUserId) {
        try {
          markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, getCurrentClassroomSyncTargetIds(snapshot))
        } catch {
          // The synchronous localStorage fallback below still preserves the snapshot.
        }
      }
      try {
        writeWorkspaceToLocalStorageSync(snapshot)
      } catch {
        void saveWorkspaceSnapshot(snapshot).catch(() => {})
      }
    }

    // Save to Firebase when tab becomes hidden (tab switch, minimize, close)
    // This covers the case where the user closes the browser without logging out
    const handleVisibilityChange = () => {
      // A2: 無変更なら何も送らない。放置タブ(古いデータ)が visibilitychange を契機に
      // 最新データを丸ごと上書きする事故を防ぐ。実変更の上書きブロックは A1(サーバー側)で担保。
      const shouldSync = shouldSyncWorkspaceOnVisibilityHidden({
        isHidden: document.visibilityState === 'hidden',
        hasWorkspaceData: workspaceUsers.length > 0 && workspaceClassrooms.length > 0,
        isRemoteBackendEnabled,
        remoteSessionUserId,
        hasUnsavedChanges: buildCurrentDataSignature() !== cleanSignatureRef.current,
      })
      if (!shouldSync || !remoteSessionUserId) return
      const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
      markPendingRemoteWorkspaceSnapshotSync(snapshot, remoteSessionUserId, getCurrentClassroomSyncTargetIds(snapshot))
      void saveWorkspaceSnapshot(snapshot).catch(() => {})
      queueFirebaseWorkspaceSync(snapshot, false, false, getCurrentClassroomSyncTargetIds(snapshot))
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [buildCurrentDataSignature, buildWorkspaceSnapshot, getCurrentClassroomSyncTargetIds, hasHydratedSnapshot, isRemoteBackendEnabled, queueFirebaseWorkspaceSync, remoteSessionUserId, workspaceClassrooms.length, workspaceUsers.length])

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
      // 開発者画面は開発者専用で特定の校舎に紐づかないため、タブ名に校舎名は出さない。
      // (acting 教室名を出すと、前に開いていた教室名が残って混乱を招く)
      document.title = '開発者画面 | コマ表アプリ'
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

  // spec-save-restore §4: ローカル自動バックアップの「復元UI」は廃止（復元はJSONバックアップ一本）。
  // テンプレート上書き前のローカル退避(書き込み側)は安全網として維持する（②二段階保存廃止の際に再判断）。
  const savePreTemplateSaveBackup = useCallback(async () => {
    saveUndoSnapshot('テンプレート上書き保存')
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    await saveDailyWorkspaceAutoBackup(snapshot)
    setPersistenceMessage('テンプレート上書き前のバックアップを保存しました。')
  }, [buildWorkspaceSnapshot, saveUndoSnapshot])

  // 手動バックアップは「開いている1教室分の完全スナップショット(テンプレ・設定・盤面・ストックを含む)」を
  // AppSnapshot 形式で書き出す。読み込み(importBackup)は AppSnapshot を優先的に完全復元するため、
  // この1ファイルだけで現在の教室を丸ごと復元できる(spec-save-restore.md §5)。
  const exportBackup = useCallback(() => {
    const savedAt = new Date().toISOString()
    const snapshot: AppSnapshot = {
      schemaVersion: 1,
      savedAt,
      ...buildClassroomSnapshotPayload({
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
    downloadTextFile(formatBackupFileName(savedAt, '手動バックアップ'), serializeAppSnapshot(snapshot), 'application/json')
    setLastSavedAt(savedAt)
    setPersistenceMessage('この教室のバックアップを書き出しました。')
  }, [screen, classroomSettings, managers, teachers, students, regularLessons, groupLessons, specialSessions, autoAssignRules, pairConstraints, boardState])

  const exportWorkspaceBackup = useCallback(() => {
    const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
    downloadTextFile(formatBackupFileName(snapshot.savedAt, '開発者バックアップ'), serializeWorkspaceSnapshot(snapshot), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('開発者バックアップを書き出しました。')
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
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) {
      setPersistenceMessage('Firebase Functions が無効です。接続設定を確認してください。')
      return
    }
    setServerAutoBackupLoading(true)
    try {
      const summaries = await listFirebaseServerAutoBackupSummaries()
      setServerAutoBackupSummaries(summaries)
      setPersistenceMessage(`サーバーバックアップ一覧を取得しました。${summaries.length} 件`)

      // サーバーバックアップ一覧取得のタイミングで自動同期フォルダへ同期する
      if (summaries.length > 0 && developerCloudBackupEnabled && developerCloudBackupHandle) {
        void syncDeveloperCloudAutoBackups().catch(() => {
          setDeveloperCloudBackupStatus('自動同期フォルダへの同期に失敗しました。')
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'サーバーバックアップ一覧の取得に失敗しました。'
      setPersistenceMessage(message)
    } finally {
      setServerAutoBackupLoading(false)
    }
  }, [developerCloudBackupEnabled, developerCloudBackupHandle, isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, syncDeveloperCloudAutoBackups])

  const triggerServerAutoBackup = useCallback(async () => {
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) {
      setPersistenceMessage('Firebase Functions が無効です。接続設定を確認してください。')
      return
    }
    setServerAutoBackupLoading(true)
    try {
      const result = await triggerFirebaseServerAutoBackup()
      setPersistenceMessage(`サーバーバックアップを実行しました。(${result.backupDateKey}, ${result.workspaceCount} ワークスペース)`)
      // 完了後に一覧を再取得
      const summaries = await listFirebaseServerAutoBackupSummaries()
      setServerAutoBackupSummaries(summaries)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'サーバーバックアップの実行に失敗しました。'
      setPersistenceMessage(message)
    } finally {
      setServerAutoBackupLoading(false)
    }
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled])

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
      const count = studentList.filter((s) => isActiveOnDate(s.entryDate, s.withdrawDate, s.birthDate, refDate)).length
      entries.push({ dateKey, count })
    }
    setStudentHistoryState({ classroomName: classroom.name, entries, loading: false })
  }, [workspaceClassrooms, actingClassroomId, screen, classroomSettings, managers, teachers, students, regularLessons, groupLessons, specialSessions, autoAssignRules, pairConstraints, boardState])

  const restoreServerAutoBackup = useCallback(async (backupDateKey: string) => {
    if (!isRemoteBackendEnabled || !isRemoteAdminAutomationEnabled) {
      setPersistenceMessage('Firebase Functions が無効です。接続設定を確認してください。')
      return
    }
    const summary = serverAutoBackupSummaries.find((entry) => entry.backupDateKey === backupDateKey)
    setServerAutoBackupLoading(true)
    setPersistenceMessage('サーバーバックアップをダウンロードしています…')
    try {
      const snapshotJson = await downloadFirebaseServerAutoBackup(backupDateKey)
      const snapshot = parseWorkspaceSnapshot(snapshotJson)
      openDeveloperRestoreModal(
        snapshot,
        `サーバーバックアップ (${summary?.displayLabel ?? backupDateKey})`,
        summary?.sourceSavedAt,
      )
      setPersistenceMessage('復元する教室をモーダルで選択してください。')
    } catch (error) {
      console.error('[restoreServerAutoBackup] error:', error)
      const message = error instanceof Error ? error.message : 'サーバーバックアップのダウンロードに失敗しました。'
      setPersistenceMessage(`復元エラー: ${message}`)
    } finally {
      setServerAutoBackupLoading(false)
    }
  }, [isRemoteAdminAutomationEnabled, isRemoteBackendEnabled, openDeveloperRestoreModal, serverAutoBackupSummaries])

  // spec-save-restore §4: 教室画面の「サーバーバックアップ復元」「直前のFirebase保存前へ戻す」は廃止。
  // サーバー復元は開発者画面(restoreServerAutoBackup→openDeveloperRestoreModal)のみ。rollbackはUndoで代替。

  // Feature B: 読み込み元(他教室)× バックアップ時点の候補をサーバーから取得する。
  // in-memory の他教室参照を一切使わないため、開発用教室の室長アカウントでも機能する。
  const loadDevelopmentBackupSources = useCallback(async () => {
    if (!isActingDevelopmentClassroom) {
      setPersistenceMessage('この操作は開発用教室でのみ実行できます。')
      return
    }
    if (!isRemoteBackendEnabled) {
      setPersistenceMessage('Firebase が無効です。接続設定を確認してください。')
      return
    }
    setDevelopmentBackupLoading(true)
    setPersistenceMessage('読み込み可能な教室とバックアップ時点を取得しています…')
    try {
      const sources = await listDevelopmentClassroomBackupSources()
      setDevelopmentBackupSources(sources)
      setPersistenceMessage(`読み込み候補を取得しました(教室${sources.classrooms.length}件 / バックアップ${sources.backups.length}件)。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '読み込み候補の取得に失敗しました。'
      setPersistenceMessage(`取得エラー: ${message}`)
    } finally {
      setDevelopmentBackupLoading(false)
    }
  }, [isActingDevelopmentClassroom, isRemoteBackendEnabled])

  // Feature B: 選んだ教室の「選んだバックアップ時点」のデータを開発用教室へ読み込む。
  // サーバーから確定データを取得→ディープクローン(共有トークン除去)→【開発用教室のみ】へ書き込む。
  // 他教室には一切書き込まないため、データ混入が構造的に発生しない。
  const loadClassroomBackupIntoDevelopment = useCallback(async (backupDateKey: string, sourceClassroomId: string) => {
    if (!actingClassroomId || !isActingDevelopmentClassroom) {
      setPersistenceMessage('この操作は開発用教室でのみ実行できます。')
      return
    }
    if (!backupDateKey || !sourceClassroomId) {
      setPersistenceMessage('読み込み元の教室とバックアップ時点を選択してください。')
      return
    }
    if (sourceClassroomId === actingClassroomId) {
      setPersistenceMessage('開発用教室自身は読み込み元にできません。')
      return
    }

    setDevelopmentBackupLoading(true)
    setPersistenceMessage('選択した教室のバックアップを取得しています…')
    try {
      const source = await downloadClassroomFromFirebaseServerAutoBackup(backupDateKey, sourceClassroomId)
      const sourceStudentCount = source.data?.students?.length ?? 0
      const sourceTeacherCount = source.data?.teachers?.length ?? 0
      const sourceTemplateCells = source.data?.classroomSettings?.regularLessonTemplate?.cells?.length ?? 0
      const backupLabel = developmentBackupSources.backups.find((backup) => backup.backupDateKey === backupDateKey)?.displayLabel ?? backupDateKey
      const confirmed = window.confirm([
        `「${source.classroomName || sourceClassroomId}」(${backupLabel})のデータを開発用教室へ読み込みます。`,
        `読み込み元の規模: 生徒${sourceStudentCount}名 / 講師${sourceTeacherCount}名 / テンプレ${sourceTemplateCells}コマ`,
        'この人数・コマ数が想定と違う場合は、教室や時点の取り違えの可能性があるので中止してください。',
        '共有用トークン類は開発用教室向けに自動で外します。',
        '現在の開発用教室データは上書きされます。続行しますか?',
      ].join('\n'))
      if (!confirmed) {
        setPersistenceMessage('バックアップの読み込みをキャンセルしました。')
        return
      }

      // buildDevelopmentClassroomCopyPayload はディープクローン+共有トークン除去を行う(参照共有なし)。
      const loadedPayload = buildDevelopmentClassroomCopyPayload(source.data)
      saveUndoSnapshot(`他教室バックアップ読込 (${source.classroomName || sourceClassroomId})`)
      // 書き込みは【開発用教室(acting)のみ】。他教室の workspaceClassrooms スロットは触らない。
      setWorkspaceClassrooms((current) => current.map((classroom) =>
        classroom.id === actingClassroomId
          ? { ...classroom, data: loadedPayload }
          : classroom))
      applyClassroomPayloadToState(loadedPayload, {
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
        setBoardMountKey,
      })
      // 読み込み先は開発用教室(acting)のみ。編集 state の出所も acting に一致させる。
      loadedEditingClassroomIdRef.current = actingClassroomId
      setPersistenceMessage(`「${source.classroomName || sourceClassroomId}」(${backupLabel})のデータを開発用教室へ読み込みました。保存してください。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'バックアップの読み込みに失敗しました。'
      setPersistenceMessage(`読み込みエラー: ${message}`)
    } finally {
      setDevelopmentBackupLoading(false)
    }
  }, [actingClassroomId, developmentBackupSources, isActingDevelopmentClassroom, saveUndoSnapshot, setWorkspaceClassrooms])

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
      // 取り込み先は現在開いている教室の編集 state。出所を acting に明示する。
      loadedEditingClassroomIdRef.current = actingClassroomIdRef.current
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
      // 取り込み先は現在開いている教室の編集 state。出所を acting に明示する。
      loadedEditingClassroomIdRef.current = actingClassroomIdRef.current
      if (!hasAnyExistingSetupData()) {
        setPersistenceMessage('基本データを Excel から取り込みました。初期盤面を生成しました。')
      } else {
        setPersistenceMessage('基本データの差分を Excel から取り込みました。特別講習、ルール、盤面、ストックは保持しています。')
      }
    } catch {
      setPersistenceMessage('基本データの Excel 差分取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [actingClassroomIdRef, boardState, classroomSettings, hasAnyExistingSetupData, managers, students, teachers])

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

  const { blocked: isDuplicateTab } = useClassroomTabLock({
    enabled: hasHydratedSnapshot && currentUser?.role === 'manager',
    classroomId: actingClassroomId,
    userId: currentUser?.id ?? null,
  })

  if (!hasHydratedSnapshot) {
    return <div className="workspace-auth-shell"><div className="workspace-auth-card"><h2>読み込み中</h2><p>教室ワークスペースを準備しています。</p></div></div>
  }

  if (isDuplicateTab) {
    return renderWithSubmissionAcknowledgement(
      <div className="workspace-auth-shell">
        <div className="workspace-auth-card" data-testid="duplicate-tab-block">
          <h2>このタブは利用できません</h2>
          <p>同じ教室を既に別のタブまたはウィンドウで開いています。</p>
          <p>データの整合性を保つため、コマ表アプリは教室ごとに 1 タブのみで利用できます。</p>
          <p>先に開いているタブを閉じてから、このページを再読み込みしてください。</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>再読み込み</button>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    if (isRemoteBackendEnabled) {
      return renderWithSubmissionAcknowledgement(
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
              <button data-testid="firebase-password-reset" className="menu-link-button" type="button" onClick={() => void submitPasswordReset()}>パスワードリセットまたはパスワード変更</button>
            </div>
            {remoteAuthMessage ? <div data-testid="firebase-auth-message" className="workspace-auth-note workspace-auth-note-error">{remoteAuthMessage}</div> : null}
          </div>
        </div>
      )
    }

    return renderWithSubmissionAcknowledgement(
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

  if (isBillingRoute) {
    return renderWithSubmissionAcknowledgement(
      <BillingAutomationScreen
        currentUser={currentUser}
        authMode={isRemoteBackendEnabled ? 'firebase' : 'local'}
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
        onBackToDeveloper={() => {
          window.history.pushState({}, '', '/')
          setScreen('developer')
        }}
        onLogout={logout}
      />
    )
  }

  if (screen === 'developer' && currentUser.role === 'developer') {
    return renderWithSubmissionAcknowledgement(
      <DeveloperAdminScreen
        currentUser={currentUser}
        authMode={isRemoteBackendEnabled ? 'firebase' : 'local'}
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
        serverAutoBackupDiagnostics={[]}
        onLoadServerAutoBackupSummaries={() => void loadServerAutoBackupSummaries()}
        onTriggerServerAutoBackup={() => void triggerServerAutoBackup()}
        onRestoreServerAutoBackup={(backupDateKey) => void restoreServerAutoBackup(backupDateKey)}
        bulkTemporarySuspensionReason={bulkTemporarySuspensionReason}
        onBulkTemporarySuspensionReasonChange={setBulkTemporarySuspensionReason}
        areAllContractedClassroomsTemporarilySuspended={areAllContractedClassroomsTemporarilySuspended}
        onToggleContractedClassroomsTemporarySuspension={toggleContractedClassroomsTemporarySuspension}
        onUpdateClassroom={updateClassroom}
        onReplaceClassroomManagerUid={replaceClassroomManagerUid}
        onExportWorkspaceBackup={exportWorkspaceBackup}
        onImportWorkspaceBackup={importWorkspaceBackup}
        onRestoreAutoBackup={() => {}}
        onLoadStudentHistory={loadStudentHistory}
        studentHistoryState={studentHistoryState}
        onCloseStudentHistory={() => setStudentHistoryState(null)}
        restoreModalState={developerRestoreModalState ? {
          sourceLabel: developerRestoreModalState.sourceLabel,
          dataTimestampLabel: developerRestoreModalState.dataTimestampLabel,
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
    return renderWithSubmissionAcknowledgement(
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
    return renderWithSubmissionAcknowledgement(
      <BasicDataScreen
        classroomSettings={classroomSettings}
        teachers={teachers}
        students={students}
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
    return renderWithSubmissionAcknowledgement(
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
    return renderWithSubmissionAcknowledgement(
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
    return renderWithSubmissionAcknowledgement(
      <BackupRestoreScreen
        onBackToBoard={() => navigateClassroomScreen('board')}
        onOpenBasicData={() => navigateClassroomScreen('basic-data')}
        onOpenSpecialData={() => navigateClassroomScreen('special-data')}
        onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
        onLogout={logout}
        persistenceMessage={persistenceMessage}
        lastSavedAt={lastSavedAt}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
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
        isDevelopmentClassroom={isActingDevelopmentClassroom}
        developmentBackupSources={developmentBackupSources}
        developmentBackupLoading={developmentBackupLoading}
        onLoadDevelopmentBackupSources={() => void loadDevelopmentBackupSources()}
        onLoadClassroomBackupIntoDevelopment={(backupDateKey, sourceClassroomId) => void loadClassroomBackupIntoDevelopment(backupDateKey, sourceClassroomId)}
      />
    )
  }

  // 未保存判定はデータ署名と clean 署名の単純比較に一本化。ハイドレーション前は未保存扱いしない。
  const hasImmediateUnsavedBoardChanges = hasHydratedSnapshot && dataSignature !== cleanSignature
  const boardHasPendingSave = hasPendingBoardSaveState({
    isDirty: hasImmediateUnsavedBoardChanges,
    isSavingNow,
    isRemoteSyncPending,
  })
  const shouldShowRemoteSyncStatus = manualFirebaseSaveStabilityEnabled
    ? Boolean(isRemoteSyncVisible)
    : isRemoteSyncPending && (isRemoteSyncVisible || hasImmediateUnsavedBoardChanges)

  return renderWithSubmissionAcknowledgement(
    <ScheduleBoardScreen
      key={boardMountKey}
      classroomSettings={classroomSettings}
      classroomName={actingClassroom?.name}
      classroomStorageKey={actingClassroomId ?? undefined}
      teachers={teachers}
      students={students}
      regularLessons={displayRegularLessons}
      specialSessions={specialSessions}
      autoAssignRules={autoAssignRules}
      pairConstraints={pairConstraints}
      teacherAutoAssignRequest={teacherAutoAssignRequest}
      studentScheduleRequest={studentScheduleRequest}
      initialBoardState={boardState}
      onBoardStateChange={handleBoardStateChange}
      onReplaceRegularLessons={setRegularLessons}
      onUpdateSpecialSessions={setSpecialSessions}
      onUpdateClassroomSettings={updateClassroomSettings}
      onOpenBasicData={() => navigateClassroomScreen('basic-data')}
      onOpenSpecialData={() => navigateClassroomScreen('special-data')}
      onOpenAutoAssignRules={() => navigateClassroomScreen('auto-assign-rules')}
      onOpenBackupRestore={() => navigateClassroomScreen('backup-restore')}
      onPreTemplateSaveBackup={savePreTemplateSaveBackup}
      undoSnapshotLabel={undoSnapshot?.label ?? null}
      onRestoreUndoSnapshot={restoreUndoSnapshot}
      onDismissUndoSnapshot={dismissUndoSnapshot}
      onLogout={logout}
      onCopyDistributionUrl={copyBoardDistributionUrl}
      onSaveBoard={saveBoard}
      isBoardDirty={hasImmediateUnsavedBoardChanges}
      isBoardSaving={isSavingNow || (isRemoteSyncPending && isRemoteSyncVisible)}
      isBoardSaveDisabled={isSavingNow || (isRemoteSyncPending && isRemoteSyncVisible)}
      hasPendingSave={boardHasPendingSave}
      syncStatusMessage={shouldShowRemoteSyncStatus
        ? (remoteSyncProgress ? `${remoteSyncProgress.label}(${remoteSyncProgress.percent}%完了)` : 'データベースへ保存準備中')
        : (manualFirebaseSaveStabilityEnabled ? undefined : ((isSavingNow || hasImmediateUnsavedBoardChanges) ? persistenceMessage : undefined))}
      syncProgressPercent={shouldShowRemoteSyncStatus ? remoteSyncProgress?.percent ?? 1 : null}
      syncElapsedSeconds={shouldShowRemoteSyncStatus ? remoteSyncProgress?.elapsedSeconds ?? 0 : null}
    />
  )
}

function App() {
  const boardShareToken = getBoardShareTokenFromUrl()
  // C1: BoardShareScreen は遅延読み込みのため Suspense で受ける。
  if (boardShareToken) {
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <BoardShareScreen token={boardShareToken} />
      </Suspense>
    )
  }
  return <AuthenticatedApp />
}

export default App
