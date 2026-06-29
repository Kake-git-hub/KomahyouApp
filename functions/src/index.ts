import { createHash, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2/options'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import { resolveOptimisticVersionDecision, STALE_SNAPSHOT_ERROR_MARKER } from './optimisticVersion'

initializeApp()

setGlobalOptions({
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
})

const firestore = getFirestore()
const auth = getAuth()
const storage = getStorage()
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'komahyouapp-prod.firebasestorage.app'

const WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS = 14
const WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS = 72
const WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST = 2
const WORKSPACE_DAILY_AUTO_BACKUP_SCHEDULE = process.env.WORKSPACE_AUTO_BACKUP_SCHEDULE ?? '10 2 * * *'
const WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE = process.env.WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE ?? '10 * * * *'
const WORKSPACE_AUTO_BACKUP_TIME_ZONE = 'Asia/Tokyo'
const WORKSPACE_INCIDENT_BACKUP_PREFIX = 'workspace-incident-backups'
const WORKSPACE_LATEST_ROLLBACK_PREFIX = 'workspace-latest-rollbacks'
const DEVELOPMENT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'
const HOUR_IN_MS = 60 * 60 * 1000
const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS
const FIREBASE_INLINE_SNAPSHOT_JSON_BYTE_LIMIT = 700_000
const FIREBASE_COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64'
const GOOGLE_DRIVE_API_SCOPE = 'https://www.googleapis.com/auth/drive'
const GOOGLE_DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3'
const GOOGLE_DRIVE_UPLOAD_API_BASE_URL = 'https://www.googleapis.com/upload/drive/v3'
const GOOGLE_DRIVE_BACKUP_FOLDER_ID = (process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID ?? '').trim()
const GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 = (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 ?? '').trim()
const GOOGLE_DRIVE_OAUTH_CLIENT_ID = (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID ?? '').trim()
const GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET ?? '').trim()
const GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = (process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN ?? '').trim()

type ClassroomContractStatus = 'active' | 'suspended'

type WorkspaceUserRole = 'developer' | 'manager'

type FirebaseWorkspaceMemberDoc = {
  displayName?: string
  email?: string
  role?: WorkspaceUserRole
  assignedClassroomId?: string | null
}

type FirebaseClassroomDoc = {
  name?: string
  contractStatus?: ClassroomContractStatus
  contractStartDate?: string
  contractEndDate?: string
  managerUserId?: string
  isTemporarilySuspended?: boolean
  temporarySuspensionReason?: string
  updatedAt?: string
}

type FirebasePersistedBoardWeek = {
  cells?: unknown[]
}

type FirebasePersistedBoardState = {
  weeks?: Array<FirebasePersistedBoardWeek | unknown[]>
} & Record<string, unknown>

type FirebaseAppSnapshotPayload = {
  screen?: string
  classroomSettings?: Record<string, unknown>
  managers?: unknown[]
  teachers?: unknown[]
  students?: unknown[]
  regularLessons?: unknown[]
  groupLessons?: unknown[]
  specialSessions?: unknown[]
  autoAssignRules?: unknown[]
  pairConstraints?: unknown[]
  boardState?: FirebasePersistedBoardState | null
} & Record<string, unknown>

type FirebaseClassroomSnapshotDoc = {
  schemaVersion?: number
  savedAt?: string
  data?: FirebaseAppSnapshotPayload
  dataEncoding?: typeof FIREBASE_COMPRESSED_SNAPSHOT_ENCODING
  compressedData?: string
  dataByteLength?: number
  updatedBy?: string
  updatedAt?: string
  // A1: 楽観ロック用の単調増加版数。保存ごとに +1。旧データには無いので optional。
  version?: number
}

type WorkspaceUser = {
  id: string
  name: string
  email: string
  role: WorkspaceUserRole
  assignedClassroomId: string | null
}

type WorkspaceClassroom = {
  id: string
  name: string
  contractStatus: ClassroomContractStatus
  contractStartDate: string
  contractEndDate: string
  managerUserId: string
  isTemporarilySuspended: boolean
  temporarySuspensionReason: string
  data: Record<string, unknown>
}

type WorkspaceSnapshot = {
  schemaVersion: number
  savedAt: string
  developerPassword: string
  developerCloudBackupEnabled: boolean
  developerCloudBackupFolderName: string
  developerCloudSyncedAutoBackupKeys: string[]
  currentUserId: string
  actingClassroomId: string | null
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
}

type WorkspaceAutoBackupKind = 'daily' | 'hourly'

type GoogleDriveBackupStatus = 'disabled' | 'synced' | 'failed'

type GoogleDriveBackupDiagnostic = {
  workspaceKey: string
  backupDateKey: string
  backupKind: WorkspaceAutoBackupKind
  status: GoogleDriveBackupStatus
  configured: boolean
  folderIdMasked: string
  authSource: 'application-default' | 'service-account-json' | 'oauth-refresh-token'
  serviceAccountEmail: string
  fileId?: string
  fileName?: string
  error?: string
  errorStatusCode?: number
  errorHint?: string
}

type WorkspaceAutoBackupSummaryDoc = {
  backupDateKey: string
  backupKind?: WorkspaceAutoBackupKind
  displayLabel?: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
  createdAt: string
  googleDriveBackupStatus?: GoogleDriveBackupStatus
  googleDriveBackupFileId?: string
  googleDriveBackupFileName?: string
  googleDriveBackupError?: string
  googleDriveBackupErrorHint?: string
  googleDriveBackupErrorAt?: string
  googleDriveBackupAuthSource?: string
  googleDriveBackupServiceAccountEmail?: string
  googleDriveBackupFolderIdMasked?: string
}

type ClassroomLatestRollbackStorageDoc = {
  classroomId: string
  sourceSavedAt: string
  capturedAt: string
  snapshot: FirebaseClassroomSnapshotDoc
}

type GoogleDriveFileMetadata = {
  id?: string
  name?: string
  appProperties?: Record<string, string>
}

type GoogleDriveFileListResponse = {
  files?: GoogleDriveFileMetadata[]
  nextPageToken?: string
}

let cachedGoogleDriveAuth: GoogleAuth | null = null
let cachedGoogleDriveOAuthClient: OAuth2Client | null = null

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

function sanitizeObjectEntries(entries: Array<[string, unknown]>) {
  const sanitizedObject: Record<string, unknown> = {}

  entries.forEach(([key, entry]) => {
    const sanitizedEntry = sanitizeFirestoreValue(entry)
    if (typeof sanitizedEntry !== 'undefined') {
      sanitizedObject[key] = sanitizedEntry
    }
  })

  return sanitizedObject
}

function sanitizeFirestoreValue(value: unknown): unknown {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Set) return Array.from(value, (entry) => {
    const sanitizedEntry = sanitizeFirestoreValue(entry)
    return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
  })
  if (value instanceof Map) return sanitizeObjectEntries(Array.from(value.entries()).map(([key, entry]) => [String(key), entry]))
  if (typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)) return null

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeFirestoreValue(entry)
      return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
    })
  }

  if (isPlainObject(value)) {
    return sanitizeObjectEntries(Object.entries(value))
  }

  if (typeof value === 'object') {
    const jsonValue = typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as { toJSON: () => unknown }).toJSON()
      : null
    if (jsonValue !== null) return sanitizeFirestoreValue(jsonValue)

    const enumerableEntries = Object.entries(value as Record<string, unknown>)
    if (enumerableEntries.length > 0) return sanitizeObjectEntries(enumerableEntries)
    return null
  }

  return value
}

function sanitizeForFirestore<T>(value: T): T {
  return sanitizeFirestoreValue(value) as T
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`
}

function hashSnapshotPayload(payload: Record<string, unknown>) {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex')
}

function countRegularTemplateEntries(template: unknown) {
  if (!template || typeof template !== 'object' || !Array.isArray((template as { cells?: unknown[] }).cells)) return 0
  return ((template as { cells: unknown[] }).cells).reduce<number>((cellTotal, cell) => {
    if (!cell || typeof cell !== 'object' || !Array.isArray((cell as { desks?: unknown[] }).desks)) return cellTotal
    return cellTotal + ((cell as { desks: unknown[] }).desks).reduce<number>((deskTotal, desk) => {
      if (!desk || typeof desk !== 'object') return deskTotal
      const students = Array.isArray((desk as { students?: unknown[] }).students)
        ? (desk as { students: unknown[] }).students.filter(Boolean).length
        : 0
      const teacher = typeof (desk as { teacherId?: unknown }).teacherId === 'string' && (desk as { teacherId: string }).teacherId.trim() ? 1 : 0
      return deskTotal + students + teacher
    }, 0)
  }, 0)
}

function countClassroomManagementData(payload: Record<string, unknown>) {
  const settings = payload.classroomSettings && typeof payload.classroomSettings === 'object'
    ? payload.classroomSettings as Record<string, unknown>
    : {}
  return [
    payload.managers,
    payload.teachers,
    payload.students,
    payload.regularLessons,
    payload.groupLessons,
    settings.regularLessonTemplateHistory,
    settings.preTemplateRegularLessons,
    settings.initialSetupMakeupStocks,
    settings.initialSetupLectureStocks,
  ].reduce<number>((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
    + countRegularTemplateEntries(settings.regularLessonTemplate)
}

async function assertNoSnapshotDataLoss(params: {
  previousSnapshot: FirebaseClassroomSnapshotDoc | null
  nextPayload: Record<string, unknown>
}) {
  const nextManagementCount = countClassroomManagementData(params.nextPayload)
  if (nextManagementCount > 0) return
  if (!params.previousSnapshot) return

  const previousPayload = readStoredSnapshotPayload(params.previousSnapshot)
  const previousManagementCount = previousPayload ? countClassroomManagementData(previousPayload) : 1
  if (previousManagementCount <= 0) return

  throw new HttpsError('failed-precondition', `既存の教室管理データがあるため、空の管理データでのFirebase上書きを中止しました。前回データ件数=${previousManagementCount}`)
}

function toUtcDateKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcHourKey(date: Date) {
  const dateKey = toUtcDateKey(date)
  const hour = `${date.getUTCHours()}`.padStart(2, '0')
  return `${dateKey}T${hour}`
}

function toOperationalDateKeyJst(date: Date, boundaryHourJst = WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST) {
  const operationalDate = new Date(date.getTime() + JST_OFFSET_IN_MS - boundaryHourJst * HOUR_IN_MS)
  return toUtcDateKey(operationalDate)
}

function toHourlyDateKeyJst(date: Date) {
  const jstDate = new Date(date.getTime() + JST_OFFSET_IN_MS)
  return toUtcHourKey(jstDate)
}

function getWorkspaceDailyAutoBackupCutoffKey(referenceDate: Date, retentionDays: number) {
  const safeRetentionDays = Math.max(1, Math.trunc(retentionDays) || 1)
  const operationalDate = new Date(referenceDate.getTime() + JST_OFFSET_IN_MS - WORKSPACE_AUTO_BACKUP_BOUNDARY_HOUR_JST * HOUR_IN_MS)
  operationalDate.setUTCDate(operationalDate.getUTCDate() - (safeRetentionDays - 1))
  return toUtcDateKey(operationalDate)
}

function buildWorkspaceAutoBackupStoragePath(workspaceKey: string, backupDateKey: string, backupKind: WorkspaceAutoBackupKind = 'daily') {
  if (backupKind === 'hourly') {
    return `workspace-auto-backups/${workspaceKey}/hourly/${backupDateKey}.json`
  }
  return `workspace-auto-backups/${workspaceKey}/${backupDateKey}.json`
}

function buildWorkspaceAutoBackupDisplayLabel(backupDateKey: string, backupKind: WorkspaceAutoBackupKind) {
  if (backupKind === 'hourly') {
    const [datePart, hourPart = '00'] = backupDateKey.split('T')
    return `${datePart} ${hourPart}:10 毎時`
  }
  return `${backupDateKey} 日次`
}

function isGoogleDriveBackupConfigured() {
  return GOOGLE_DRIVE_BACKUP_FOLDER_ID.length > 0
}

function isGoogleDriveOAuthConfigured() {
  return GOOGLE_DRIVE_OAUTH_CLIENT_ID.length > 0 && GOOGLE_DRIVE_OAUTH_CLIENT_SECRET.length > 0 && GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN.length > 0
}

function maskDiagnosticValue(value: string) {
  if (!value) return ''
  if (value.length <= 10) return `${value.slice(0, 2)}***${value.slice(-2)}`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function truncateDiagnosticText(value: string, maxLength = 1800) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function getGoogleDriveCredentialDiagnostic() {
  const oauthParts = [GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN]
  if (oauthParts.some((value) => value.length > 0)) {
    const missingFields = [
      GOOGLE_DRIVE_OAUTH_CLIENT_ID ? '' : 'GOOGLE_DRIVE_OAUTH_CLIENT_ID',
      GOOGLE_DRIVE_OAUTH_CLIENT_SECRET ? '' : 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET',
      GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN ? '' : 'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN',
    ].filter(Boolean)
    return {
      authSource: 'oauth-refresh-token' as const,
      serviceAccountEmail: '',
      credentialError: missingFields.length > 0 ? `Google Drive OAuth 設定が不足しています: ${missingFields.join(', ')}` : '',
    }
  }

  if (!GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64) {
    return {
      authSource: 'application-default' as const,
      serviceAccountEmail: '',
      credentialError: '',
    }
  }

  try {
    const decodedJson = Buffer.from(GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8')
    const parsed = JSON.parse(decodedJson)
    const serviceAccountEmail = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.client_email === 'string'
      ? parsed.client_email
      : ''
    return {
      authSource: 'service-account-json' as const,
      serviceAccountEmail,
      credentialError: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      authSource: 'service-account-json' as const,
      serviceAccountEmail: '',
      credentialError: `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 の読込に失敗しました: ${message}`,
    }
  }
}

async function readDefaultRuntimeServiceAccountEmail() {
  if (!process.env.K_SERVICE) return ''

  try {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) return ''
    return (await response.text()).trim()
  } catch {
    return ''
  }
}

function getGoogleDriveErrorStatusCode(error: unknown) {
  if (!(error instanceof Error)) return undefined
  const match = error.message.match(/failed \((\d{3})\)/)
  if (!match) return undefined
  const statusCode = Number(match[1])
  return Number.isFinite(statusCode) ? statusCode : undefined
}

function buildGoogleDriveErrorHint(message: string) {
  if (!message) return ''
  if (message.includes('GOOGLE_DRIVE_BACKUP_FOLDER_ID')) {
    return 'Functions の GOOGLE_DRIVE_BACKUP_FOLDER_ID が未設定です。functions/.env を設定して Functions を再デプロイしてください。'
  }
  if (message.includes('SERVICE_DISABLED') || message.includes('accessNotConfigured') || message.includes('drive.googleapis.com/overview')) {
    return 'Google Cloud Console で Google Drive API が未有効です。drive.googleapis.com を有効化して数分後に再実行してください。'
  }
  if (message.includes('storageQuotaExceeded') || message.includes('Service Accounts do not have storage quota')) {
    return '通常のマイドライブフォルダへサービスアカウントでは新規作成できません。共有ドライブを使うか、Google Drive OAuth refresh token を Functions に設定してください。'
  }
  if (message.includes('File not found') || message.includes('notFound') || message.includes('404')) {
    return 'Drive フォルダ ID が違うか、実行サービスアカウントにフォルダ共有権限がありません。フォルダ ID と共有先メールを確認してください。'
  }
  if (message.includes('insufficient') || message.includes('PERMISSION_DENIED') || message.includes('403')) {
    return 'Drive 側の共有権限が不足しています。実行サービスアカウントを対象フォルダに編集者として共有してください。'
  }
  return ''
}

async function buildGoogleDriveBackupDiagnostic(params: {
  workspaceKey: string
  backupDateKey: string
  backupKind: WorkspaceAutoBackupKind
  status: GoogleDriveBackupStatus
  fileId?: string
  fileName?: string
  error?: unknown
}): Promise<GoogleDriveBackupDiagnostic> {
  const credentialDiagnostic = getGoogleDriveCredentialDiagnostic()
  const serviceAccountEmail = credentialDiagnostic.serviceAccountEmail || await readDefaultRuntimeServiceAccountEmail()
  const rawErrorMessage = params.error instanceof Error
    ? params.error.message
    : typeof params.error === 'undefined'
      ? (params.status === 'disabled' && !isGoogleDriveBackupConfigured()
          ? 'GOOGLE_DRIVE_BACKUP_FOLDER_ID が未設定のため、Google Drive 同期は実行されません。'
          : credentialDiagnostic.credentialError)
      : String(params.error)
  const error = rawErrorMessage ? truncateDiagnosticText(rawErrorMessage) : undefined

  return {
    workspaceKey: params.workspaceKey,
    backupDateKey: params.backupDateKey,
    backupKind: params.backupKind,
    status: params.status,
    configured: isGoogleDriveBackupConfigured(),
    folderIdMasked: maskDiagnosticValue(GOOGLE_DRIVE_BACKUP_FOLDER_ID),
    authSource: credentialDiagnostic.authSource,
    serviceAccountEmail,
    fileId: params.fileId,
    fileName: params.fileName,
    error,
    errorStatusCode: getGoogleDriveErrorStatusCode(params.error),
    errorHint: error ? buildGoogleDriveErrorHint(error) : undefined,
  }
}

function buildGoogleDriveBackupSummaryFields(diagnostic: GoogleDriveBackupDiagnostic, savedAt: string) {
  return {
    googleDriveBackupStatus: diagnostic.status,
    googleDriveBackupFileId: diagnostic.fileId ?? '',
    googleDriveBackupFileName: diagnostic.fileName ?? '',
    googleDriveBackupError: diagnostic.error ?? '',
    googleDriveBackupErrorHint: diagnostic.errorHint ?? '',
    googleDriveBackupErrorAt: diagnostic.status === 'failed' ? savedAt : '',
    googleDriveBackupAuthSource: diagnostic.authSource,
    googleDriveBackupServiceAccountEmail: diagnostic.serviceAccountEmail,
    googleDriveBackupFolderIdMasked: diagnostic.folderIdMasked,
  }
}

function requireGoogleDriveBackupFolderId() {
  if (!GOOGLE_DRIVE_BACKUP_FOLDER_ID) {
    throw new Error('GOOGLE_DRIVE_BACKUP_FOLDER_ID が未設定です。')
  }
  return GOOGLE_DRIVE_BACKUP_FOLDER_ID
}

function readGoogleDriveServiceAccountCredentials() {
  if (!GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64) return undefined

  try {
    const decodedJson = Buffer.from(GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8')
    const parsed = JSON.parse(decodedJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('decoded JSON is not an object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON parse failed'
    throw new Error(`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 の読込に失敗しました: ${message}`)
  }
}

function getGoogleDriveAuth() {
  if (cachedGoogleDriveAuth) return cachedGoogleDriveAuth

  const credentials = readGoogleDriveServiceAccountCredentials()
  cachedGoogleDriveAuth = credentials
    ? new GoogleAuth({ credentials, scopes: [GOOGLE_DRIVE_API_SCOPE] })
    : new GoogleAuth({ scopes: [GOOGLE_DRIVE_API_SCOPE] })
  return cachedGoogleDriveAuth
}

function getGoogleDriveOAuthClient() {
  if (cachedGoogleDriveOAuthClient) return cachedGoogleDriveOAuthClient
  if (!isGoogleDriveOAuthConfigured()) {
    throw new Error('Google Drive OAuth 設定が不足しています。GOOGLE_DRIVE_OAUTH_CLIENT_ID / GOOGLE_DRIVE_OAUTH_CLIENT_SECRET / GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN を設定してください。')
  }

  cachedGoogleDriveOAuthClient = new OAuth2Client(GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET)
  cachedGoogleDriveOAuthClient.setCredentials({ refresh_token: GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN })
  return cachedGoogleDriveOAuthClient
}

async function getGoogleDriveAccessToken() {
  const client = isGoogleDriveOAuthConfigured()
    ? getGoogleDriveOAuthClient()
    : await getGoogleDriveAuth().getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token
  if (!accessToken) {
    throw new Error('Google Drive API 用のアクセストークンを取得できませんでした。')
  }
  return accessToken
}

async function googleDriveApiFetch(params: {
  path: string
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | undefined>
  headers?: Record<string, string>
  body?: string | Buffer
  upload?: boolean
}) {
  const accessToken = await getGoogleDriveAccessToken()
  const baseUrl = params.upload ? GOOGLE_DRIVE_UPLOAD_API_BASE_URL : GOOGLE_DRIVE_API_BASE_URL
  const url = new URL(`${baseUrl}${params.path}`)

  Object.entries(params.query ?? {}).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      url.searchParams.set(key, value)
    }
  })

  const response = await fetch(url, {
    method: params.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...params.headers,
    },
    body: params.body,
  })

  if (response.ok) return response

  const errorText = await response.text().catch(() => '')
  throw new Error(`Google Drive API ${params.method ?? 'GET'} ${params.path} failed (${response.status}): ${errorText}`)
}

function escapeGoogleDriveQueryLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function buildGoogleDriveBackupFileName(workspaceKey: string, backupDateKey: string, backupKind: WorkspaceAutoBackupKind) {
  const safeWorkspaceKey = workspaceKey.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
  return `komahyouapp_${safeWorkspaceKey}_${backupKind}_${backupDateKey}.json`
}

async function findGoogleDriveBackupFile(fileName: string) {
  const folderId = requireGoogleDriveBackupFolderId()
  const query = [
    `'${escapeGoogleDriveQueryLiteral(folderId)}' in parents`,
    `name = '${escapeGoogleDriveQueryLiteral(fileName)}'`,
    'trashed = false',
  ].join(' and ')
  const response = await googleDriveApiFetch({
    path: '/files',
    query: {
      q: query,
      fields: 'files(id,name,appProperties)',
      pageSize: '1',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    },
  })
  const payload = await response.json() as GoogleDriveFileListResponse
  return payload.files?.[0] ?? null
}

function buildGoogleDriveMultipartBody(metadata: Record<string, unknown>, content: string) {
  const boundary = `komahyouapp-drive-${randomBytes(8).toString('hex')}`
  const body = Buffer.from([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    `${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    `${content}\r\n`,
    `--${boundary}--\r\n`,
  ].join(''), 'utf8')
  return { boundary, body }
}

async function upsertWorkspaceGoogleDriveBackup(params: {
  workspaceKey: string
  backupDateKey: string
  backupKind: WorkspaceAutoBackupKind
  snapshotJson: string
  savedAt: string
  sourceSavedAt: string
}) {
  if (!isGoogleDriveBackupConfigured()) return null

  const folderId = requireGoogleDriveBackupFolderId()
  const fileName = buildGoogleDriveBackupFileName(params.workspaceKey, params.backupDateKey, params.backupKind)
  const existingFile = await findGoogleDriveBackupFile(fileName)
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: 'application/json',
    appProperties: {
      workspaceKey: params.workspaceKey,
      backupDateKey: params.backupDateKey,
      backupKind: params.backupKind,
      savedAt: params.savedAt,
      sourceSavedAt: params.sourceSavedAt,
      managedBy: 'komahyouapp-functions',
    },
  }
  if (!existingFile?.id) {
    metadata.parents = [folderId]
  }

  const { boundary, body } = buildGoogleDriveMultipartBody(metadata, params.snapshotJson)
  const response = await googleDriveApiFetch({
    path: existingFile?.id ? `/files/${existingFile.id}` : '/files',
    method: existingFile?.id ? 'PATCH' : 'POST',
    upload: true,
    query: {
      uploadType: 'multipart',
      supportsAllDrives: 'true',
    },
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  const payload = await response.json() as GoogleDriveFileMetadata

  return {
    fileId: payload.id ?? existingFile?.id ?? '',
    fileName: payload.name ?? fileName,
  }
}

async function listWorkspaceGoogleDriveBackupFiles(workspaceKey: string) {
  if (!isGoogleDriveBackupConfigured()) return [] as GoogleDriveFileMetadata[]

  const folderId = requireGoogleDriveBackupFolderId()
  const files: GoogleDriveFileMetadata[] = []
  let pageToken = ''
  const query = [
    `'${escapeGoogleDriveQueryLiteral(folderId)}' in parents`,
    'trashed = false',
    `appProperties has { key='workspaceKey' and value='${escapeGoogleDriveQueryLiteral(workspaceKey)}' }`,
  ].join(' and ')

  do {
    const response = await googleDriveApiFetch({
      path: '/files',
      query: {
        q: query,
        fields: 'nextPageToken,files(id,name,appProperties)',
        pageSize: '1000',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        pageToken: pageToken || undefined,
      },
    })
    const payload = await response.json() as GoogleDriveFileListResponse
    files.push(...(payload.files ?? []))
    pageToken = payload.nextPageToken ?? ''
  } while (pageToken)

  return files
}

function shouldKeepGoogleDriveBackupFile(file: GoogleDriveFileMetadata, dailyCutoffKey: string, hourlyCutoffTime: number) {
  const appProperties = file.appProperties ?? {}
  const backupKind: WorkspaceAutoBackupKind = appProperties.backupKind === 'hourly' ? 'hourly' : 'daily'
  if (backupKind === 'daily') {
    return (appProperties.backupDateKey ?? '') >= dailyCutoffKey
  }
  const savedAt = appProperties.savedAt ?? appProperties.sourceSavedAt ?? ''
  return (Date.parse(savedAt) || 0) >= hourlyCutoffTime
}

async function pruneWorkspaceGoogleDriveBackups(workspaceKey: string, referenceDate: Date) {
  if (!isGoogleDriveBackupConfigured()) return

  const dailyCutoffKey = getWorkspaceDailyAutoBackupCutoffKey(referenceDate, WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS)
  const hourlyCutoffTime = referenceDate.getTime() - WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS * HOUR_IN_MS
  const files = await listWorkspaceGoogleDriveBackupFiles(workspaceKey)
  const staleFiles = files.filter((file) => !shouldKeepGoogleDriveBackupFile(file, dailyCutoffKey, hourlyCutoffTime))

  await Promise.all(staleFiles.map(async (file) => {
    if (!file.id) return
    await googleDriveApiFetch({
      path: `/files/${file.id}`,
      method: 'DELETE',
      query: {
        supportsAllDrives: 'true',
      },
    }).catch((error) => {
      logger.warn(`[AutoBackup] Failed to delete stale Google Drive backup: workspace=${workspaceKey}, fileId=${file.id}, message=${error instanceof Error ? error.message : String(error)}`)
    })
  }))
}

function buildClassroomLatestRollbackStoragePath(workspaceKey: string, classroomId: string) {
  return `${WORKSPACE_LATEST_ROLLBACK_PREFIX}/${workspaceKey}/classrooms/${classroomId}/latest.json`
}

function buildWorkspaceIncidentBackupStoragePath(workspaceKey: string, reason: string, savedAt: string) {
  const safeReason = reason.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'incident'
  const safeTimestamp = savedAt.replace(/[:.]/g, '-')
  return `${WORKSPACE_INCIDENT_BACKUP_PREFIX}/${workspaceKey}/${safeReason}-${safeTimestamp}.json`
}

async function writeWorkspaceIncidentBackup(workspaceKey: string, reason: string) {
  const savedAt = new Date().toISOString()
  try {
    const { snapshot } = await buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt)
    const storagePath = buildWorkspaceIncidentBackupStoragePath(workspaceKey, reason, savedAt)
    const bucket = storage.bucket(STORAGE_BUCKET)
    await bucket.file(storagePath).save(JSON.stringify(snapshot, null, 2), {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })
    logger.info(`[IncidentBackup] Saved pre-restore safety snapshot to ${storagePath}`)
    return { storagePath, savedAt }
  } catch (error) {
    logger.error(`[IncidentBackup] Failed to save safety snapshot for workspace=${workspaceKey} reason=${reason}`, error)
    return null
  }
}

function stringifySnapshotPayload(payload: Record<string, unknown> | null) {
  if (!payload) return ''
  return JSON.stringify(payload)
}

async function writeLatestClassroomRollback(params: {
  workspaceKey: string
  classroomId: string
  beforeSnapshot: FirebaseClassroomSnapshotDoc
  afterSnapshot?: FirebaseClassroomSnapshotDoc | null
}) {
  const beforePayload = readStoredSnapshotPayload(params.beforeSnapshot)
  if (!beforePayload) return false

  const afterPayload = readStoredSnapshotPayload(params.afterSnapshot ?? null)
  if (afterPayload && stringifySnapshotPayload(beforePayload) === stringifySnapshotPayload(afterPayload)) {
    return false
  }

  const capturedAt = new Date().toISOString()
  const storagePath = buildClassroomLatestRollbackStoragePath(params.workspaceKey, params.classroomId)
  const storageDoc: ClassroomLatestRollbackStorageDoc = {
    classroomId: params.classroomId,
    sourceSavedAt: params.beforeSnapshot.savedAt ?? '',
    capturedAt,
    snapshot: createStoredSnapshotDoc({
      payload: beforePayload,
      savedAt: params.beforeSnapshot.savedAt ?? capturedAt,
      updatedBy: params.beforeSnapshot.updatedBy ?? 'system',
      updatedAt: params.beforeSnapshot.updatedAt ?? params.beforeSnapshot.savedAt ?? capturedAt,
      schemaVersion: params.beforeSnapshot.schemaVersion ?? 1,
    }),
  }

  const bucket = storage.bucket(STORAGE_BUCKET)
  await bucket.file(storagePath).save(JSON.stringify(storageDoc, null, 2), {
    resumable: false,
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
    },
  })
  logger.info(`[LatestRollback] Saved latest classroom rollback: workspace=${params.workspaceKey}, classroom=${params.classroomId}, sourceSavedAt=${storageDoc.sourceSavedAt}`)
  return true
}

function deserializeBoardState(boardState: FirebasePersistedBoardState | Record<string, unknown> | null | undefined) {
  if (!boardState || typeof boardState !== 'object') return null

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

function deserializeSnapshotPayload(payload: FirebaseAppSnapshotPayload | null | undefined) {
  if (!payload || typeof payload !== 'object') return null

  return {
    ...payload,
    boardState: deserializeBoardState(payload.boardState),
  }
}

function createStoredSnapshotDoc(params: {
  payload: Record<string, unknown>
  savedAt: string
  updatedBy: string
  updatedAt?: string
  schemaVersion?: number
  version?: number
}): FirebaseClassroomSnapshotDoc {
  const sanitizedPayload = sanitizeForFirestore(params.payload) as FirebaseAppSnapshotPayload
  const json = JSON.stringify(sanitizedPayload)
  const dataByteLength = Buffer.byteLength(json, 'utf8')
  const updatedAt = typeof params.updatedAt === 'string' ? params.updatedAt : params.savedAt
  const schemaVersion = typeof params.schemaVersion === 'number' ? params.schemaVersion : 1
  const versionField = typeof params.version === 'number' ? { version: params.version } : {}

  if (dataByteLength <= FIREBASE_INLINE_SNAPSHOT_JSON_BYTE_LIMIT) {
    return {
      schemaVersion,
      savedAt: params.savedAt,
      data: sanitizedPayload,
      updatedBy: params.updatedBy,
      updatedAt,
      ...versionField,
    }
  }

  return {
    schemaVersion,
    savedAt: params.savedAt,
    dataEncoding: FIREBASE_COMPRESSED_SNAPSHOT_ENCODING,
    compressedData: gzipSync(Buffer.from(json, 'utf8')).toString('base64'),
    dataByteLength,
    updatedBy: params.updatedBy,
    updatedAt,
    ...versionField,
  }
}

function getStoredSnapshotEncoding(snapshot: FirebaseClassroomSnapshotDoc) {
  return snapshot.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING ? FIREBASE_COMPRESSED_SNAPSHOT_ENCODING : 'inline'
}

function buildSaveAttemptPayload(params: {
  classroomId: string
  savedAt: string
  saveId: string
  payloadHash: string
  status: 'started' | 'verification-failed' | 'verified'
  verified: boolean
  writeMode: string
  dataByteLength: number
  snapshotEncoding: string
  updatedBy: string
  createdAt: string
  failedAt?: string
  verifiedAt?: string
  readbackHash?: string
  errorMessage?: string
  snapshotVersion?: number
}) {
  return {
    classroomId: params.classroomId,
    savedAt: params.savedAt,
    saveId: params.saveId,
    payloadHash: params.payloadHash,
    status: params.status,
    verified: params.verified,
    writeMode: params.writeMode,
    dataByteLength: params.dataByteLength,
    snapshotEncoding: params.snapshotEncoding,
    updatedBy: params.updatedBy,
    createdAt: params.createdAt,
    ...(params.failedAt ? { failedAt: params.failedAt } : {}),
    ...(params.verifiedAt ? { verifiedAt: params.verifiedAt } : {}),
    ...(typeof params.readbackHash === 'string' ? { readbackHash: params.readbackHash } : {}),
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
    // A1: 冪等リプレイ時にクライアントへ現在の版数を返すため保持する。
    ...(typeof params.snapshotVersion === 'number' ? { snapshotVersion: params.snapshotVersion } : {}),
  }
}

function readStoredSnapshotPayload(snapshot: FirebaseClassroomSnapshotDoc | null | undefined) {
  if (!snapshot) return null

  if (snapshot.data && typeof snapshot.data === 'object') {
    return deserializeSnapshotPayload(snapshot.data)
  }

  if (snapshot.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING && typeof snapshot.compressedData === 'string' && snapshot.compressedData) {
    const json = gunzipSync(Buffer.from(snapshot.compressedData, 'base64')).toString('utf8')
    return deserializeSnapshotPayload(JSON.parse(json) as FirebaseAppSnapshotPayload)
  }

  return null
}

function createEmptyAppSnapshotPayload() {
  return {
    screen: 'board',
    classroomSettings: {
      closedWeekdays: [0],
      holidayDates: [],
      forceOpenDates: [],
      deskCount: 14,
      initialSetupCompletedAt: '',
      initialSetupMakeupStocks: [],
      initialSetupLectureStocks: [],
    },
    managers: [],
    teachers: [],
    students: [],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: null,
  } satisfies Record<string, unknown>
}

function toWorkspaceUser(userId: string, data: FirebaseWorkspaceMemberDoc): WorkspaceUser {
  const email = typeof data.email === 'string' ? data.email.trim() : ''
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
  const role = data.role === 'developer' ? 'developer' : 'manager'
  const assignedClassroomId = typeof data.assignedClassroomId === 'string'
    ? data.assignedClassroomId.trim() || null
    : null

  return {
    id: userId,
    name: displayName || email || userId,
    email,
    role,
    assignedClassroomId,
  }
}

function toWorkspaceClassroom(classroomId: string, data: FirebaseClassroomDoc, snapshotData: Record<string, unknown> | null): WorkspaceClassroom {
  return {
    id: classroomId,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '名称未設定の教室',
    contractStatus: data.contractStatus === 'suspended' ? 'suspended' : 'active',
    contractStartDate: typeof data.contractStartDate === 'string' ? data.contractStartDate : '',
    contractEndDate: typeof data.contractEndDate === 'string' ? data.contractEndDate : '',
    managerUserId: typeof data.managerUserId === 'string' ? data.managerUserId : '',
    isTemporarilySuspended: Boolean(data.isTemporarilySuspended),
    temporarySuspensionReason: typeof data.temporarySuspensionReason === 'string' ? data.temporarySuspensionReason : '',
    data: snapshotData ?? createEmptyAppSnapshotPayload(),
  }
}

function getLatestSavedAt(classrooms: FirebaseClassroomDoc[], snapshots: FirebaseClassroomSnapshotDoc[], fallbackSavedAt: string) {
  const candidates = [
    ...classrooms.map((row) => (typeof row.updatedAt === 'string' ? row.updatedAt : '')),
    ...snapshots.map((row) => (typeof row.savedAt === 'string' ? row.savedAt : '')),
  ].filter(Boolean)

  return candidates.sort((left, right) => right.localeCompare(left))[0] ?? fallbackSavedAt
}

async function buildWorkspaceServerBackupSnapshot(workspaceKey: string, savedAt: string) {
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const [memberSnapshots, classroomSnapshots, snapshotSnapshots] = await Promise.all([
    workspaceRef.collection('members').get(),
    workspaceRef.collection('classrooms').get(),
    workspaceRef.collection('classroomSnapshots').get(),
  ])

  const users = memberSnapshots.docs.map((entry) => toWorkspaceUser(entry.id, entry.data() as FirebaseWorkspaceMemberDoc))
  const snapshotByClassroomId = new Map(
    snapshotSnapshots.docs.map((entry) => [entry.id, entry.data() as FirebaseClassroomSnapshotDoc]),
  )

  const classrooms = classroomSnapshots.docs.map((entry) => {
    const classroomData = entry.data() as FirebaseClassroomDoc
    const snapshotData = snapshotByClassroomId.get(entry.id)
    return toWorkspaceClassroom(entry.id, classroomData, readStoredSnapshotPayload(snapshotData) ?? null)
  })

  const latestSourceSavedAt = getLatestSavedAt(
    classroomSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomDoc),
    snapshotSnapshots.docs.map((entry) => entry.data() as FirebaseClassroomSnapshotDoc),
    savedAt,
  )

  return {
    latestSourceSavedAt,
    snapshot: {
      schemaVersion: 1,
      savedAt,
      developerPassword: 'developer',
      developerCloudBackupEnabled: false,
      developerCloudBackupFolderName: '',
      developerCloudSyncedAutoBackupKeys: [],
      currentUserId: '',
      actingClassroomId: classrooms[0]?.id ?? null,
      users,
      classrooms,
    } satisfies WorkspaceSnapshot,
  }
}

async function pruneWorkspaceServerAutoBackups(workspaceKey: string, referenceDate: Date) {
  const dailyCutoffKey = getWorkspaceDailyAutoBackupCutoffKey(referenceDate, WORKSPACE_DAILY_AUTO_BACKUP_RETENTION_DAYS)
  const hourlyCutoffTime = referenceDate.getTime() - WORKSPACE_HOURLY_AUTO_BACKUP_RETENTION_HOURS * HOUR_IN_MS
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const summarySnapshots = await workspaceRef.collection('workspaceAutoBackupSummaries').get()
  const batch = firestore.batch()
  let deleteCount = 0

  await Promise.all(summarySnapshots.docs.map(async (summaryDoc) => {
    const summary = summaryDoc.data() as WorkspaceAutoBackupSummaryDoc
    const backupKind: WorkspaceAutoBackupKind = summary.backupKind === 'hourly' || summaryDoc.id.includes('T')
      ? 'hourly'
      : 'daily'
    const shouldKeep = backupKind === 'hourly'
      ? (Date.parse(summary.savedAt || '') || 0) >= hourlyCutoffTime
      : summaryDoc.id >= dailyCutoffKey
    if (shouldKeep) return

    if (typeof summary.storagePath === 'string' && summary.storagePath.trim()) {
      await bucket.file(summary.storagePath).delete().catch(() => undefined)
    }
    batch.delete(summaryDoc.ref)
    deleteCount += 1
  }))

  if (deleteCount === 0) return
  await batch.commit()
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

async function requireClassroomAccessMember(authUid: string | undefined, workspaceKey: string, classroomId: string) {
  if (!authUid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(authUid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as { role?: string; assignedClassroomId?: string | null } | undefined
  if (member?.role !== 'developer' && member?.assignedClassroomId !== classroomId) {
    throw new HttpsError('permission-denied', 'この教室を保存する権限がありません。')
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

function isFirebaseAuthError(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code)
}

async function deleteOrphanedWorkspaceAuthUserByEmail(workspaceKey: string, email: string) {
  let existingUser: Awaited<ReturnType<typeof auth.getUserByEmail>>

  try {
    existingUser = await auth.getUserByEmail(email)
  } catch (error) {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      return { deleted: false, uid: '' }
    }
    throw error
  }

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const [memberSnapshot, classroomSnapshot] = await Promise.all([
    workspaceRef.collection('members').doc(existingUser.uid).get(),
    workspaceRef.collection('classrooms').where('managerUserId', '==', existingUser.uid).limit(1).get(),
  ])

  if (memberSnapshot.exists || !classroomSnapshot.empty) {
    return { deleted: false, uid: existingUser.uid }
  }

  await auth.deleteUser(existingUser.uid)
  logger.info(`Deleted orphaned Auth user before classroom provision: workspace=${workspaceKey}, uid=${existingUser.uid}`)
  return { deleted: true, uid: existingUser.uid }
}

async function createWorkspaceManagerAuthUser(params: {
  workspaceKey: string
  managerEmail: string
  managerName: string
  temporaryPassword: string
}) {
  try {
    return await auth.createUser({
      email: params.managerEmail,
      displayName: params.managerName,
      password: params.temporaryPassword,
    })
  } catch (error) {
    if (!isFirebaseAuthError(error, 'auth/email-already-exists')) {
      throw error
    }

    const cleanup = await deleteOrphanedWorkspaceAuthUserByEmail(params.workspaceKey, params.managerEmail)
    if (!cleanup.deleted) {
      throw error
    }

    return await auth.createUser({
      email: params.managerEmail,
      displayName: params.managerName,
      password: params.temporaryPassword,
    })
  }
}

export const provisionWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomName = readString(rawData.classroomName, 'classroomName')
  const managerName = readString(rawData.managerName, 'managerName')
  const managerEmail = validateEmailAddress(readString(rawData.managerEmail, 'managerEmail'), 'managerEmail')
  const contractStartDate = readString(rawData.contractStartDate, 'contractStartDate')
  const contractEndDate = readOptionalString(rawData.contractEndDate, 'contractEndDate')
  const managerPassword = readOptionalString(rawData.managerPassword, 'managerPassword')
  const initialPayload = readPayloadObject(rawData.initialPayload, 'initialPayload')
  const sanitizedInitialPayload = sanitizeForFirestore(initialPayload)

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc()
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomRef.id)
  const temporaryPassword = managerPassword || buildTemporaryPassword()
  const now = new Date().toISOString()

  let managerUserId = ''

  try {
    const managerUser = await createWorkspaceManagerAuthUser({
      workspaceKey,
      managerEmail,
      managerName,
      temporaryPassword,
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
    batch.set(snapshotRef, createStoredSnapshotDoc({
      payload: sanitizedInitialPayload,
      savedAt: now,
      updatedBy: request.auth?.uid ?? '',
      updatedAt: now,
      schemaVersion: 1,
    }))
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

export const reassignWorkspaceClassroomManager = onCall({ invoker: 'public' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')
  const managerName = readString(rawData.managerName, 'managerName')
  const managerEmail = validateEmailAddress(readString(rawData.managerEmail, 'managerEmail'), 'managerEmail')
  const managerUserId = readString(rawData.managerUserId, 'managerUserId')

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc(classroomId)
  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }

  const currentManagerUserId = readString(classroomSnapshot.get('managerUserId') ?? '', 'managerUserId')
  if (currentManagerUserId === managerUserId) {
    return {
      classroomId,
      managerUserId,
    }
  }

  try {
    await auth.getUser(managerUserId)
  } catch (error) {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      throw new HttpsError('not-found', '差し替え先の Authentication ユーザーが見つかりません。')
    }
    const message = error instanceof Error ? error.message : '差し替え先の Authentication ユーザー確認に失敗しました。'
    throw new HttpsError('internal', message)
  }

  const currentMemberRef = workspaceRef.collection('members').doc(currentManagerUserId)
  const nextMemberRef = workspaceRef.collection('members').doc(managerUserId)
  const nextMemberSnapshot = await nextMemberRef.get()
  if (nextMemberSnapshot.exists) {
    const assignedClassroomId = readOptionalString(nextMemberSnapshot.get('assignedClassroomId'), 'assignedClassroomId')
    if (assignedClassroomId && assignedClassroomId !== classroomId) {
      throw new HttpsError('already-exists', 'この UID はすでに別の教室へ割り当てられています。別ユーザーかどうかを確認してください。')
    }
  }

  const now = new Date().toISOString()
  const batch = firestore.batch()
  batch.set(workspaceRef, {
    name: workspaceKey,
    schemaVersion: 1,
    updatedAt: Timestamp.now(),
  }, { merge: true })
  batch.set(nextMemberRef, {
    displayName: managerName,
    email: managerEmail,
    role: 'manager',
    assignedClassroomId: classroomId,
    updatedAt: now,
  }, { merge: true })
  batch.set(classroomRef, {
    managerUserId,
    updatedAt: now,
  }, { merge: true })
  batch.delete(currentMemberRef)
  await batch.commit()

  let cleanupWarning = ''
  await auth.deleteUser(currentManagerUserId).catch((error) => {
    if (isFirebaseAuthError(error, 'auth/user-not-found')) {
      return undefined
    }
    cleanupWarning = error instanceof Error
      ? `旧 Authentication ユーザー削除に失敗しました: ${error.message}`
      : '旧 Authentication ユーザー削除に失敗しました。'
    logger.warn(`Failed to delete previous manager auth user: workspace=${workspaceKey}, uid=${currentManagerUserId}, message=${cleanupWarning}`)
    return undefined
  })

  return {
    classroomId,
    managerUserId,
    deletedPreviousManagerUserId: currentManagerUserId,
    cleanupWarning: cleanupWarning || undefined,
  }
})

export const updateWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
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

async function saveClassroomSnapshotFromCallable(request: CallableRequest, options?: { developmentOnly?: boolean }) {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')
  const savedAt = readString(rawData.savedAt, 'savedAt')
  const saveId = readString(rawData.saveId, 'saveId')
  const payload = readPayloadObject(rawData.payload, 'payload')
  const sanitizedPayload = sanitizeForFirestore(payload)
  // A1: クライアントが「読み込んだ時点の版数」。旧クライアントは送らない(undefined)。
  const incomingBaseVersion = typeof rawData.baseVersion === 'number' ? rawData.baseVersion : undefined

  if (options?.developmentOnly && classroomId !== DEVELOPMENT_CLASSROOM_ID) {
    throw new HttpsError('failed-precondition', 'この保存実験は開発用教室だけで利用できます。')
  }

  const memberRef = await requireClassroomAccessMember(request.auth?.uid, workspaceKey, classroomId)
  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const classroomRef = workspaceRef.collection('classrooms').doc(classroomId)
  const snapshotRef = workspaceRef.collection('classroomSnapshots').doc(classroomId)
  const saveAttemptRef = snapshotRef.collection('saveAttempts').doc(saveId)
  const payloadHash = hashSnapshotPayload(sanitizedPayload)

  const existingAttemptSnapshot = await saveAttemptRef.get()
  if (existingAttemptSnapshot.exists) {
    const existingAttempt = existingAttemptSnapshot.data() as { payloadHash?: string; verified?: boolean; savedAt?: string; writeMode?: string; dataByteLength?: number; snapshotVersion?: number } | undefined
    if (existingAttempt?.payloadHash !== payloadHash) {
      throw new HttpsError('already-exists', '同じ saveId で異なる保存内容が送信されました。')
    }
    if (existingAttempt.verified) {
      return {
        classroomId,
        savedAt: existingAttempt.savedAt || savedAt,
        saveId,
        payloadHash,
        verified: true,
        idempotentReplay: true,
        writeMode: existingAttempt.writeMode || 'cloud-function-verified-replay',
        dataByteLength: existingAttempt.dataByteLength ?? 0,
        // A1: リプレイでもクライアントが版数を追従できるよう返す(無ければ undefined)。
        version: typeof existingAttempt.snapshotVersion === 'number' ? existingAttempt.snapshotVersion : undefined,
      }
    }
  }
  // exists だが未verified = 同一saveIdの再試行(冪等リプレイ)。版数照合をスキップする。
  const isReplay = existingAttemptSnapshot.exists

  const classroomSnapshot = await classroomRef.get()
  if (!classroomSnapshot.exists) {
    throw new HttpsError('not-found', '対象の教室が見つかりません。')
  }
  const previousSnapshot = await snapshotRef.get()
  const previousSnapshotData = previousSnapshot.exists ? previousSnapshot.data() as FirebaseClassroomSnapshotDoc : null
  await assertNoSnapshotDataLoss({
    previousSnapshot: previousSnapshotData,
    nextPayload: sanitizedPayload,
  })

  // A1: 楽観ロック。別端末が先に更新していれば(版数不一致)古いベースなので拒否する。
  const versionDecision = resolveOptimisticVersionDecision({
    incomingBaseVersion,
    previousVersion: previousSnapshotData?.version,
    isReplay,
  })
  if (!versionDecision.ok) {
    throw new HttpsError(
      'failed-precondition',
      `${STALE_SNAPSHOT_ERROR_MARKER}:別の端末でこの教室のデータが更新されています(サーバー版数=${versionDecision.previousVersion}/送信版数=${versionDecision.incomingBaseVersion})。最新を読み込むため、画面を再読み込みしてください。`,
    )
  }
  const nextVersion = versionDecision.nextVersion

  const snapshotDoc = createStoredSnapshotDoc({
    payload: sanitizedPayload,
    savedAt,
    updatedBy: memberRef.id,
    updatedAt: savedAt,
    schemaVersion: 1,
    version: nextVersion,
  })
  const writeMode = snapshotDoc.dataEncoding === FIREBASE_COMPRESSED_SNAPSHOT_ENCODING ? 'cloud-function-compressed' : 'cloud-function-inline'
  const dataByteLength = snapshotDoc.dataByteLength ?? Buffer.byteLength(JSON.stringify(snapshotDoc.data ?? {}), 'utf8')
  const saveAttemptCreatedAt = new Date().toISOString()
  const saveAttemptBase = {
    classroomId,
    savedAt,
    saveId,
    payloadHash,
    writeMode,
    dataByteLength,
    snapshotEncoding: getStoredSnapshotEncoding(snapshotDoc),
    updatedBy: memberRef.id,
    createdAt: saveAttemptCreatedAt,
    snapshotVersion: nextVersion,
  }
  await saveAttemptRef.set(buildSaveAttemptPayload({
    ...saveAttemptBase,
    status: 'started',
    verified: false,
  }))
  await snapshotRef.set(snapshotDoc)

  const readbackSnapshot = await snapshotRef.get()
  const readbackPayload = readStoredSnapshotPayload(readbackSnapshot.exists ? readbackSnapshot.data() as FirebaseClassroomSnapshotDoc : null)
  const readbackHash = readbackPayload ? hashSnapshotPayload(readbackPayload) : ''
  if (readbackHash !== payloadHash) {
    await saveAttemptRef.set(buildSaveAttemptPayload({
      ...saveAttemptBase,
      status: 'verification-failed',
      verified: false,
      failedAt: new Date().toISOString(),
      readbackHash,
      errorMessage: 'Firebase保存後の読み戻し検証に失敗しました。',
    }), { merge: true })
    throw new HttpsError('internal', 'Firebase保存後の読み戻し検証に失敗しました。')
  }

  await saveAttemptRef.set(buildSaveAttemptPayload({
    ...saveAttemptBase,
    status: 'verified',
    verified: true,
    readbackHash,
    verifiedAt: new Date().toISOString(),
  }), { merge: true })

  return {
    classroomId,
    savedAt,
    saveId,
    payloadHash,
    verified: true,
    idempotentReplay: false,
    writeMode,
    dataByteLength,
    version: nextVersion,
  }
}

export const saveClassroomSnapshot = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  return saveClassroomSnapshotFromCallable(request)
})

export const saveDevelopmentClassroomSnapshot = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  return saveClassroomSnapshotFromCallable(request, { developmentOnly: true })
})

export const deleteWorkspaceClassroom = onCall({ invoker: 'public' }, async (request) => {
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

export const downloadServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const backupDateKey = readString(rawData.backupDateKey, 'backupDateKey')

  logger.info(`downloadServerAutoBackup: workspaceKey=${workspaceKey}, backupDateKey=${backupDateKey}`)

  await requireDeveloperMember(request.auth?.uid, workspaceKey)

  const summarySnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('workspaceAutoBackupSummaries').doc(backupDateKey).get()
  if (!summarySnapshot.exists) {
    throw new HttpsError('not-found', `指定したサーバーバックアップが見つかりません。(${backupDateKey})`)
  }
  const summary = summarySnapshot.data() as WorkspaceAutoBackupSummaryDoc
  const storagePath = typeof summary.storagePath === 'string' && summary.storagePath.trim()
    ? summary.storagePath
    : buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, summary.backupKind === 'hourly' ? 'hourly' : 'daily')
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    logger.warn(`downloadServerAutoBackup: file not found at ${storagePath}`)
    throw new HttpsError('not-found', `指定したサーバーバックアップが見つかりません。(${storagePath})`)
  }

  await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-workspace-${backupDateKey}`)

  const [content] = await file.download()
  // ワークスペースバックアップは数十 MB に達する。Firebase callable のレスポンス上限(約10MB)を
  // 超えると `internal` で失敗するため、gzip+base64 で圧縮して返す(クライアントが展開する)。
  const compressed = gzipSync(content)
  logger.info(`downloadServerAutoBackup: downloaded ${content.length} bytes, compressed to ${compressed.length} bytes from ${storagePath}`)
  return { snapshotGzipBase64: compressed.toString('base64') }
})

// 開発用教室の判定(クライアント src/utils/developmentClassroom.ts と同じ規則)。
// 本番の開発用教室は id=v8OZ7zH8vONNHjjYVcR1・name=「開発用教室」なので name 判定が要。
function isDevelopmentClassroomIdentity(id: string | null | undefined, name: string | null | undefined) {
  const normalizedId = (id ?? '').trim().toLowerCase()
  const normalizedName = (name ?? '').trim()
  return normalizedId === 'development'
    || normalizedId === 'dev'
    || normalizedId.includes('development')
    || normalizedId.startsWith('dev_')
    || normalizedName === '開発用教室'
    || normalizedName.includes('開発用教室')
}

// 「他教室のバックアップを開発用教室へ読み込む(Feature B)」のアクセス判定。
// 許可: 開発者、または【開発用教室の室長】(開発用教室はサンドボックスのため任意教室を読み込める)。
async function resolveDevelopmentBackupAccess(authUid: string | undefined, workspaceKey: string) {
  if (!authUid) throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  const memberSnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(authUid).get()
  if (!memberSnapshot.exists) throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  const member = memberSnapshot.data() as FirebaseWorkspaceMemberDoc
  if (member.role === 'developer') return { member, isDeveloper: true as const }
  const assignedId = typeof member.assignedClassroomId === 'string' ? member.assignedClassroomId.trim() : ''
  if (assignedId) {
    const classroomSnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').doc(assignedId).get()
    const name = (classroomSnapshot.data() as FirebaseClassroomDoc | undefined)?.name ?? ''
    if (isDevelopmentClassroomIdentity(assignedId, name)) return { member, isDeveloper: false as const, developmentClassroomId: assignedId }
  }
  throw new HttpsError('permission-denied', 'この操作には開発者または開発用教室の権限が必要です。')
}

// Feature B のピッカー用: 利用可能なバックアップ一覧と、読み込み元として選べる教室(id+名前)を返す。
// 開発用教室の室長でも直接 Firestore を読まずに済むよう、サーバー(admin権限)でまとめて返す。
export const listDevelopmentClassroomBackupSources = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  await resolveDevelopmentBackupAccess(request.auth?.uid, workspaceKey)

  const workspaceRef = firestore.collection('workspaces').doc(workspaceKey)
  const [summariesSnapshot, classroomsSnapshot] = await Promise.all([
    workspaceRef.collection('workspaceAutoBackupSummaries').orderBy('savedAt', 'desc').limit(200).get(),
    workspaceRef.collection('classrooms').get(),
  ])

  const backups = summariesSnapshot.docs.map((entry) => {
    const data = entry.data() as WorkspaceAutoBackupSummaryDoc
    return {
      backupDateKey: String(data.backupDateKey ?? entry.id),
      backupKind: data.backupKind === 'hourly' ? 'hourly' : 'daily',
      displayLabel: String(data.displayLabel ?? data.backupDateKey ?? entry.id),
      savedAt: String(data.savedAt ?? ''),
      sourceSavedAt: String(data.sourceSavedAt ?? ''),
    }
  })

  // 読み込み元候補は開発用教室自身を除いた全教室。
  const classrooms = classroomsSnapshot.docs
    .map((entry) => ({ id: entry.id, name: (entry.data() as FirebaseClassroomDoc).name ?? entry.id }))
    .filter((classroom) => !isDevelopmentClassroomIdentity(classroom.id, classroom.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'))

  return { backups, classrooms }
})

export const downloadClassroomFromServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const backupDateKey = readString(rawData.backupDateKey, 'backupDateKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(request.auth.uid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  // 許可: 開発者 / 自分の担当教室 / 開発用教室の室長(任意教室を開発用へ読み込むため)。
  const member = memberSnapshot.data() as FirebaseWorkspaceMemberDoc | undefined
  let allowed = member?.role === 'developer' || member?.assignedClassroomId === classroomId
  if (!allowed && typeof member?.assignedClassroomId === 'string' && member.assignedClassroomId) {
    const ownClassroomSnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').doc(member.assignedClassroomId).get()
    const ownName = (ownClassroomSnapshot.data() as FirebaseClassroomDoc | undefined)?.name ?? ''
    if (isDevelopmentClassroomIdentity(member.assignedClassroomId, ownName)) allowed = true
  }
  if (!allowed) {
    throw new HttpsError('permission-denied', 'この教室のバックアップにアクセスする権限がありません。')
  }

  const summarySnapshot = await firestore.collection('workspaces').doc(workspaceKey).collection('workspaceAutoBackupSummaries').doc(backupDateKey).get()
  if (!summarySnapshot.exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }
  const summary = summarySnapshot.data() as WorkspaceAutoBackupSummaryDoc
  const storagePath = typeof summary.storagePath === 'string' && summary.storagePath.trim()
    ? summary.storagePath
    : buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, summary.backupKind === 'hourly' ? 'hourly' : 'daily')
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')
  }

  const [content] = await file.download()
  const snapshot = JSON.parse(content.toString('utf-8')) as WorkspaceSnapshot
  const classroom = snapshot.classrooms?.find((c) => c.id === classroomId)
  if (!classroom) {
    throw new HttpsError('not-found', 'バックアップ内に該当教室のデータが見つかりません。')
  }

  // 1教室分でも数MBになりうるため、callable の応答上限(約10MB)対策で gzip+base64 で返す。
  const dataGzipBase64 = gzipSync(Buffer.from(JSON.stringify(classroom.data), 'utf8')).toString('base64')
  return {
    classroomId: classroom.id,
    classroomName: classroom.name,
    savedAt: snapshot.savedAt,
    dataGzipBase64,
  }
})

export const mirrorLatestClassroomRollback = onDocumentWritten({
  document: 'workspaces/{workspaceKey}/classroomSnapshots/{classroomId}',
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (event) => {
  const beforeSnapshot = event.data?.before.data() as FirebaseClassroomSnapshotDoc | undefined
  const afterSnapshot = event.data?.after.data() as FirebaseClassroomSnapshotDoc | undefined

  if (!beforeSnapshot) return

  try {
    await writeLatestClassroomRollback({
      workspaceKey: event.params.workspaceKey,
      classroomId: event.params.classroomId,
      beforeSnapshot,
      afterSnapshot,
    })
  } catch (error) {
    logger.error(`[LatestRollback] Failed to mirror previous classroom snapshot: workspace=${event.params.workspaceKey}, classroom=${event.params.classroomId}`, error)
    throw error
  }
})

export const downloadLatestClassroomRollback = onCall({ invoker: 'public', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  const classroomId = readString(rawData.classroomId, 'classroomId')

  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Firebase へログインしてください。')
  }

  const memberRef = firestore.collection('workspaces').doc(workspaceKey).collection('members').doc(request.auth.uid)
  const memberSnapshot = await memberRef.get()
  if (!memberSnapshot.exists) {
    throw new HttpsError('permission-denied', 'このワークスペースのメンバーではありません。')
  }

  const member = memberSnapshot.data() as FirebaseWorkspaceMemberDoc | undefined
  if (member?.role !== 'developer' && member?.assignedClassroomId !== classroomId) {
    throw new HttpsError('permission-denied', 'この教室の直前保存にアクセスする権限がありません。')
  }

  const storagePath = buildClassroomLatestRollbackStoragePath(workspaceKey, classroomId)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError('not-found', 'この教室にはまだ直前の Firebase 保存データがありません。')
  }

  await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-latest-classroom-${classroomId}`)

  const [content] = await file.download()
  const rollbackDoc = JSON.parse(content.toString('utf-8')) as ClassroomLatestRollbackStorageDoc
  const payload = readStoredSnapshotPayload(rollbackDoc.snapshot)
  if (!payload) {
    throw new HttpsError('data-loss', '直前保存データの読み込みに失敗しました。')
  }

  return {
    classroomId: rollbackDoc.classroomId,
    sourceSavedAt: rollbackDoc.sourceSavedAt,
    capturedAt: rollbackDoc.capturedAt,
    data: payload,
  }
})

export const createWorkspaceServerAutoBackups = onSchedule({
  schedule: WORKSPACE_DAILY_AUTO_BACKUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
  timeoutSeconds: 300,
  memory: '1GiB',
}, async () => {
  await runWorkspaceServerAutoBackup('daily')
})

export const createWorkspaceServerHourlyBackups = onSchedule({
  schedule: WORKSPACE_HOURLY_AUTO_BACKUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
  timeoutSeconds: 300,
  memory: '1GiB',
}, async () => {
  await runWorkspaceServerAutoBackup('hourly')
})

// A4: 保存ごとに増える saveAttempts(冪等保存の重複防止記録)を定期的に掃除する。
// saveAttempts は保存リクエストの再送(ネットワーク再試行)を見分けるための一時記録で、
// 数十日後の saveId が再送されることはないため、保持期間を過ぎたものは削除して無限増加を防ぐ。
// 削除対象は classroomSnapshots/{id}/saveAttempts のみ。スナップショット本体・バックアップ・
// 版数(version はメインdoc)には一切触れない。
const SAVE_ATTEMPT_RETENTION_DAYS = Math.max(7, Math.trunc(Number(process.env.SAVE_ATTEMPT_RETENTION_DAYS)) || 30)
const SAVE_ATTEMPT_CLEANUP_SCHEDULE = process.env.SAVE_ATTEMPT_CLEANUP_SCHEDULE ?? '30 3 * * *'
const SAVE_ATTEMPT_CLEANUP_BATCH_LIMIT = 300

async function runSaveAttemptCleanup() {
  const cutoffIso = new Date(Date.now() - SAVE_ATTEMPT_RETENTION_DAYS * 24 * HOUR_IN_MS).toISOString()
  const workspacesSnapshot = await firestore.collection('workspaces').get()
  let deletedTotal = 0

  for (const workspaceDoc of workspacesSnapshot.docs) {
    const snapshotsSnapshot = await workspaceDoc.ref.collection('classroomSnapshots').get()
    for (const snapshotDoc of snapshotsSnapshot.docs) {
      // createdAt は ISO 文字列。辞書順=時系列順なので文字列比較で「保持期間より古い」を抽出できる。
      const oldAttempts = await snapshotDoc.ref.collection('saveAttempts')
        .where('createdAt', '<', cutoffIso)
        .limit(SAVE_ATTEMPT_CLEANUP_BATCH_LIMIT)
        .get()
      if (oldAttempts.empty) continue
      const batch = firestore.batch()
      oldAttempts.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
      deletedTotal += oldAttempts.size
    }
  }

  logger.info(`[SaveAttemptCleanup] Deleted ${deletedTotal} old saveAttempts (older than ${cutoffIso}, retentionDays=${SAVE_ATTEMPT_RETENTION_DAYS})`)
  return { deleted: deletedTotal, cutoffIso, retentionDays: SAVE_ATTEMPT_RETENTION_DAYS }
}

export const cleanupOldSaveAttempts = onSchedule({
  schedule: SAVE_ATTEMPT_CLEANUP_SCHEDULE,
  timeZone: WORKSPACE_AUTO_BACKUP_TIME_ZONE,
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  await runSaveAttemptCleanup()
})

export const triggerWorkspaceServerAutoBackup = onCall({ invoker: 'public', timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
  const rawData = readPayloadObject(request.data, 'request.data')
  const workspaceKey = readString(rawData.workspaceKey, 'workspaceKey')
  await requireDeveloperMember(request.auth?.uid, workspaceKey)
  const result = await runWorkspaceServerAutoBackup('hourly')
  return result
})

async function runWorkspaceServerAutoBackup(backupKind: WorkspaceAutoBackupKind) {
  const now = new Date()
  const savedAt = now.toISOString()
  const backupDateKey = backupKind === 'daily' ? toOperationalDateKeyJst(now) : toHourlyDateKeyJst(now)
  logger.info(`[AutoBackup] Starting ${backupKind} backup run: backupDateKey=${backupDateKey}, savedAt=${savedAt}, bucket=${STORAGE_BUCKET}`)
  const workspacesSnapshot = await firestore.collection('workspaces').get()
  logger.info(`[AutoBackup] Found ${workspacesSnapshot.docs.length} workspace(s)`)
  const bucket = storage.bucket(STORAGE_BUCKET)
  const results: Array<{ workspaceKey: string; backupDateKey: string; storagePath: string; backupKind: WorkspaceAutoBackupKind; googleDriveBackup: GoogleDriveBackupDiagnostic }> = []

  for (const workspaceDoc of workspacesSnapshot.docs) {
    const workspaceKey = workspaceDoc.id
    logger.info(`[AutoBackup] Processing workspace: ${workspaceKey} (${backupKind})`)
    const { snapshot, latestSourceSavedAt } = await buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt)
    const storagePath = buildWorkspaceAutoBackupStoragePath(workspaceKey, backupDateKey, backupKind)
    const snapshotJson = JSON.stringify(snapshot, null, 2)

    await bucket.file(storagePath).save(snapshotJson, {
      resumable: false,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        cacheControl: 'private, max-age=0, no-transform',
      },
    })
    logger.info(`[AutoBackup] Saved to Storage: ${storagePath}`)

    const summaryRef = workspaceDoc.ref.collection('workspaceAutoBackupSummaries').doc(backupDateKey)

    await Promise.all([
      summaryRef.set({
        backupDateKey,
        backupKind,
        displayLabel: buildWorkspaceAutoBackupDisplayLabel(backupDateKey, backupKind),
        savedAt,
        sourceSavedAt: latestSourceSavedAt,
        storagePath,
        createdAt: savedAt,
      } satisfies WorkspaceAutoBackupSummaryDoc, { merge: true }),
      workspaceDoc.ref.set({
        serverAutoBackupLastSavedAt: savedAt,
        serverAutoBackupLastBackupDateKey: backupDateKey,
        serverAutoBackupLastBackupKind: backupKind,
        serverAutoBackupLastStoragePath: storagePath,
      }, { merge: true }),
    ])
    logger.info(`[AutoBackup] Saved summary for workspace=${workspaceKey}, backupDateKey=${backupDateKey}, backupKind=${backupKind}`)

    await pruneWorkspaceServerAutoBackups(workspaceKey, now)
    let googleDriveBackup = await buildGoogleDriveBackupDiagnostic({
      workspaceKey,
      backupDateKey,
      backupKind,
      status: 'disabled',
    })
    if (isGoogleDriveBackupConfigured()) {
      try {
        const googleDriveResult = await upsertWorkspaceGoogleDriveBackup({
          workspaceKey,
          backupDateKey,
          backupKind,
          snapshotJson,
          savedAt,
          sourceSavedAt: latestSourceSavedAt,
        })
        await pruneWorkspaceGoogleDriveBackups(workspaceKey, now)
        googleDriveBackup = await buildGoogleDriveBackupDiagnostic({
          workspaceKey,
          backupDateKey,
          backupKind,
          status: 'synced',
          fileId: googleDriveResult?.fileId ?? '',
          fileName: googleDriveResult?.fileName ?? '',
        })
        await workspaceDoc.ref.set({
          googleDriveBackupLastSyncedAt: savedAt,
          googleDriveBackupLastBackupDateKey: backupDateKey,
          googleDriveBackupLastBackupKind: backupKind,
          googleDriveBackupLastFileId: googleDriveResult?.fileId ?? '',
          googleDriveBackupLastFileName: googleDriveResult?.fileName ?? '',
          googleDriveBackupLastError: '',
        }, { merge: true })
        await summaryRef.set(buildGoogleDriveBackupSummaryFields(googleDriveBackup, savedAt), { merge: true })
        logger.info(`[AutoBackup] Synced Google Drive backup: workspace=${workspaceKey}, fileName=${googleDriveResult?.fileName ?? ''}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        googleDriveBackup = await buildGoogleDriveBackupDiagnostic({
          workspaceKey,
          backupDateKey,
          backupKind,
          status: 'failed',
          error,
        })
        logger.error(`[AutoBackup] Google Drive sync failed: workspace=${workspaceKey}, backupDateKey=${backupDateKey}, backupKind=${backupKind}`, error)
        await Promise.all([
          workspaceDoc.ref.set({
            googleDriveBackupLastError: message,
            googleDriveBackupLastErrorHint: googleDriveBackup.errorHint ?? '',
            googleDriveBackupLastErrorAt: savedAt,
            googleDriveBackupLastBackupDateKey: backupDateKey,
            googleDriveBackupLastBackupKind: backupKind,
            googleDriveBackupLastAuthSource: googleDriveBackup.authSource,
            googleDriveBackupLastServiceAccountEmail: googleDriveBackup.serviceAccountEmail,
            googleDriveBackupLastFolderIdMasked: googleDriveBackup.folderIdMasked,
          }, { merge: true }),
          summaryRef.set(buildGoogleDriveBackupSummaryFields(googleDriveBackup, savedAt), { merge: true }),
        ]).catch(() => undefined)
      }
    } else {
      await summaryRef.set(buildGoogleDriveBackupSummaryFields(googleDriveBackup, savedAt), { merge: true }).catch(() => undefined)
    }
    results.push({ workspaceKey, backupDateKey, storagePath, backupKind, googleDriveBackup })
  }

  logger.info(`[AutoBackup] Completed ${backupKind}: ${results.length} workspace(s) backed up`)
  return { backupDateKey, backupKind, workspaceCount: results.length, results, googleDriveBackups: results.map((result) => result.googleDriveBackup) }
}

// ---------------------------------------------------------------------------
// Lecture submission API (unauthenticated access via token)
// ---------------------------------------------------------------------------

type LectureSubmissionDoc = {
  workspaceKey: string
  classroomId: string
  sessionId: string
  personType: 'student' | 'teacher'
  personId: string
  personName: string
  sessionLabel: string
  sessionStartDate: string
  sessionEndDate: string
  closedWeekdays: number[]
  // コマ表側で個別に休日設定した日付(YYYY-MM-DD)。定休日(closedWeekdays)と合わせて提出不可にする。
  holidayDates?: string[]
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  slotNumbers?: number[]
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  // 科目ごとの授業時間(分)。未設定=90分扱い。後方互換のため optional。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C: 集団授業(中3のみ)。availableGroupClassSubjects=選べる集団科目(中3のみ非空)。
  // groupClassParticipation=科目→参加(true)。未設定/false=不参加(既定)。後方互換のため optional。
  availableGroupClassSubjects?: string[]
  groupClassParticipation?: Record<string, boolean>
  // 生徒日程表のオプション欄(開発用教室)。optionLabels=学年共通のオプション文言(行0..4。空文字は提出ページに出さない)。
  // optionChecks=提出されたチェック状態(キー=行番号'0'..'4' -> true)。後方互換のため optional。
  optionLabels?: string[]
  optionChecks?: Record<string, boolean>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
  // spec-group-lesson §E: 中3の集団授業コマ。key=`${dateKey}_${band}`、value=科目。後方互換のため optional。
  groupClassSlots?: Record<string, string>
  submittedAt: string | null
  createdAt: string
}

function extractTokenFromPath(rawPath: string) {
  const segments = rawPath.replace(/^\/+|\/+$/g, '').split('/')
  return segments.pop() || ''
}

function isValidSlotKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}_\d+$/.test(value)
}

function sanitizeUnavailableSlots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(isValidSlotKey).slice(0, 5000)
}

function sanitizeSubjectSlots(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length <= 10 && typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 999) {
      result[key] = val
    }
  }
  return result
}

// 授業時間(分)は 45/60/90 のみ許容。90(既定)や不正値は保存しない(=未設定として90扱い)。
function sanitizeSubjectDurations(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length <= 10 && (val === 45 || val === 60)) {
      result[key] = val
    }
  }
  return result
}

// spec-group-lesson §C: 集団授業の参加可否。allowed(=その生徒が選べる集団科目)のキーだけ、true(参加)のみ保存。
// false/未設定は不参加(既定)として保存しない。中3でない生徒は allowed が空＝何も保存されない。
function sanitizeGroupClassParticipation(value: unknown, allowed: string[]): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowSet = new Set(allowed)
  const result: Record<string, boolean> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (allowSet.has(key) && val === true) result[key] = true
  }
  return result
}

// オプション欄(開発用教室): optionLabels の非空行(行番号'0'..'4')のみ true(チェック)を保存。
// 空ラベルの行や未チェックは保存しない(未チェックが既定)。
function sanitizeOptionChecks(value: unknown, optionLabels: string[]): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowSet = new Set(
    optionLabels
      .map((label, index) => (typeof label === 'string' && label.trim() ? String(index) : ''))
      .filter((key) => key !== ''),
  )
  const result: Record<string, boolean> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (allowSet.has(key) && val === true) result[key] = true
  }
  return result
}

function sanitizeSlotNumbers(value: unknown, fallbackCount: number) {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : Array.from({ length: Math.max(1, Math.min(20, fallbackCount || 7)) }, (_, index) => index + 1)

  return Array.from(new Set(source
    .map((slotNumber) => Math.trunc(Number(slotNumber)))
    .filter((slotNumber) => Number.isFinite(slotNumber) && slotNumber > 0 && slotNumber <= 20)))
    .sort((left, right) => left - right)
}

export const lectureSubmissionApi = onRequest({
  cors: true,
  region: process.env.FUNCTION_REGION ?? 'asia-northeast1',
  maxInstances: 10,
}, async (req, res) => {
  const token = extractTokenFromPath(req.path)
  if (!token || token.length < 16 || token.length > 64) {
    res.status(400).json({ error: 'Invalid token' })
    return
  }

  const docRef = firestore.collection('lectureSubmissions').doc(token)

  if (req.method === 'GET') {
    const doc = await docRef.get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const data = doc.data() as LectureSubmissionDoc
    res.json({
      personName: data.personName ?? '',
      personType: data.personType ?? '',
      sessionLabel: data.sessionLabel ?? '',
      sessionStartDate: data.sessionStartDate ?? '',
      sessionEndDate: data.sessionEndDate ?? '',
      closedWeekdays: data.closedWeekdays ?? [],
      holidayDates: data.holidayDates ?? [],
      forceOpenDates: data.forceOpenDates ?? [],
      availableSubjects: data.availableSubjects ?? [],
      slotCount: data.slotCount ?? 7,
      slotNumbers: sanitizeSlotNumbers(data.slotNumbers, data.slotCount ?? 7),
      status: data.status ?? 'pending',
      unavailableSlots: data.unavailableSlots ?? [],
      subjectSlots: data.subjectSlots ?? {},
      subjectDurations: data.subjectDurations ?? {},
      availableGroupClassSubjects: data.availableGroupClassSubjects ?? [],
      groupClassParticipation: data.groupClassParticipation ?? {},
      optionLabels: data.optionLabels ?? [],
      optionChecks: data.optionChecks ?? {},
      regularOnly: data.regularOnly ?? false,
      occupiedSlots: data.occupiedSlots ?? {},
      groupClassSlots: data.groupClassSlots ?? {},
    })
    return
  }

  if (req.method === 'POST') {
    const doc = await docRef.get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const data = doc.data() as LectureSubmissionDoc
    if (data.status === 'submitted') {
      res.status(409).json({ error: 'Already submitted' })
      return
    }

    const body = typeof req.body === 'object' && req.body !== null ? req.body : {}
    const unavailableSlots = sanitizeUnavailableSlots(body.unavailableSlots)
    const subjectSlots = data.personType === 'student' ? sanitizeSubjectSlots(body.subjectSlots) : {}
    const subjectDurations = data.personType === 'student' ? sanitizeSubjectDurations(body.subjectDurations) : {}
    const groupClassParticipation = data.personType === 'student'
      ? sanitizeGroupClassParticipation(body.groupClassParticipation, data.availableGroupClassSubjects ?? [])
      : {}
    const optionChecks = data.personType === 'student'
      ? sanitizeOptionChecks(body.optionChecks, data.optionLabels ?? [])
      : {}
    const regularOnly = data.personType === 'student' ? Boolean(body.regularOnly) : false
    const now = new Date().toISOString()

    await docRef.update({
      status: 'submitted',
      unavailableSlots,
      subjectSlots,
      subjectDurations,
      groupClassParticipation,
      optionChecks,
      regularOnly,
      submittedAt: now,
    })

    // Also update the classroom snapshot so admin sees the data immediately
    try {
      const snapshotRef = firestore
        .collection('workspaces').doc(data.workspaceKey)
        .collection('classroomSnapshots').doc(data.classroomId)

      await firestore.runTransaction(async (transaction) => {
        const snapshotDoc = await transaction.get(snapshotRef)
        if (!snapshotDoc.exists) return

        const snapshotData = snapshotDoc.data() as FirebaseClassroomSnapshotDoc
        const payload = readStoredSnapshotPayload(snapshotData)
        if (!payload?.specialSessions || !Array.isArray(payload.specialSessions)) return

        const sessions = payload.specialSessions as Array<Record<string, unknown>>
        const sessionIndex = sessions.findIndex((s) => s.id === data.sessionId)
        if (sessionIndex < 0) return

        const session = sessions[sessionIndex]
        const inputKey = data.personType === 'teacher' ? 'teacherInputs' : 'studentInputs'
        const inputs = (session[inputKey] ?? {}) as Record<string, Record<string, unknown>>
        const existingInput = inputs[data.personId] ?? {}

        inputs[data.personId] = {
          ...existingInput,
          unavailableSlots,
          ...(data.personType === 'student' ? { subjectSlots, subjectDurations, groupClassParticipation, optionChecks, regularOnly, regularBreakSlots: existingInput.regularBreakSlots ?? [] } : {}),
          countSubmitted: true,
          submissionToken: token,
          updatedAt: now,
        }
        session[inputKey] = inputs
        sessions[sessionIndex] = session

        transaction.set(snapshotRef, createStoredSnapshotDoc({
          payload: { ...payload, specialSessions: sessions },
          savedAt: typeof snapshotData?.savedAt === 'string' && snapshotData.savedAt ? snapshotData.savedAt : now,
          updatedBy: typeof snapshotData?.updatedBy === 'string' ? snapshotData.updatedBy : '',
          updatedAt: now,
          schemaVersion: typeof snapshotData?.schemaVersion === 'number' ? snapshotData.schemaVersion : 1,
          // A1: QR提出のサーバー側マージは楽観ロックの版数を据え置く(+1しない)。
          // 版数を変えると、提出のたびに管理者側の保存が STALE 誤判定でブロックされてしまう。
          // (提出内容は管理者側の onSnapshot 購読でローカルにも反映されるため、版数据え置きで整合する)
          version: typeof snapshotData?.version === 'number' ? snapshotData.version : undefined,
        }))
      })
    } catch {
      // Non-fatal: submission is saved even if snapshot update fails
    }

    res.json({ success: true, submittedAt: now })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
})
