import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, where, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { type AppSnapshotPayload, type WorkspaceClassroom } from '../../types/appState'
import { ensureFirebaseAuthenticatedUser, getFirebaseFirestoreInstance, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import { sanitizeForFirestore } from './firestoreSanitize'
import { getClassroomSnapshotVersion, setClassroomSnapshotVersion } from './classroomSnapshotVersions'
import type { OperationEvent } from '../../utils/operationLog'
import type { OperationTraceEntry } from '../../utils/operationTrace'
import type { DeveloperReportRequestBody } from '../../utils/developerReport'
import type { StudentLessonLedger } from '../../utils/studentLessonLedger'
import type { StudentLessonHistoryResponse } from '../../utils/lessonHistory'
import { normalizeStudentLessonHistoryResponse } from '../../utils/lessonHistoryMessage'
// 自動バックアップの教室別化(docs/spec-save-restore.md §10-5)。目次の検査と全体の組み立て直しは共有純関数(サーバーと同じ 1 つの実装)。
import {
  assembleWorkspaceBackupFromIndex,
  resolveWorkspaceBackupSummaryLayout,
  serializeWorkspaceBackupValue,
  validateWorkspaceBackupIndex,
  WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM,
  type WorkspaceBackupIndex,
  type WorkspaceBackupSummaryLayout,
} from '../../utils/workspaceBackupLayout'

export type GoogleDriveBackupStatus = 'disabled' | 'synced' | 'failed'

/** 復元用ダウンロードの目的(§10-5・Q8)。'local-sync'(ローカル同期フォルダ)ではサーバーが復元前の控えを書かない。 */
export type ServerAutoBackupDownloadPurpose = 'restore' | 'local-sync'

export type GoogleDriveBackupDiagnostic = {
  workspaceKey: string
  backupDateKey: string
  backupKind: 'daily' | 'hourly' | 'quarterHourly'
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

export type ServerAutoBackupSummary = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly' | 'quarterHourly'
  displayLabel: string
  savedAt: string
  sourceSavedAt: string
  storagePath: string
  /** 時点の形式(§10-3)。'legacy'=全体 1 本(要約に layout が無い)・'per-classroom-v1'=教室ごとの gzip＋目次・'unknown'=この版が知らない形式。 */
  layout: WorkspaceBackupSummaryLayout
  /** 教室別形式で書いた教室ファイルの数(旧形式は undefined)。 */
  classroomCount?: number
  googleDriveBackupStatus?: GoogleDriveBackupStatus
  googleDriveBackupFileId?: string
  googleDriveBackupFileName?: string
  googleDriveBackupError?: string
  googleDriveBackupErrorHint?: string
  googleDriveBackupAuthSource?: string
  googleDriveBackupServiceAccountEmail?: string
  googleDriveBackupFolderIdMasked?: string
}

export type TriggerServerAutoBackupResult = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly' | 'quarterHourly'
  workspaceCount: number
  googleDriveBackups: GoogleDriveBackupDiagnostic[]
}

type ProvisionWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomName: string
  managerName: string
  managerEmail: string
  managerPassword?: string
  contractStartDate: string
  contractEndDate: string
  initialPayload: AppSnapshotPayload
}

type ProvisionWorkspaceClassroomWithExistingUidRequest = ProvisionWorkspaceClassroomRequest & {
  managerUserId: string
}

type ReassignWorkspaceClassroomManagerWithExistingUidRequest = {
  workspaceKey: string
  classroomId: string
  managerName: string
  managerEmail: string
  managerUserId: string
}

type ReassignWorkspaceClassroomManagerWithExistingUidResponse = {
  classroomId: string
  managerUserId: string
  deletedPreviousManagerUserId?: string
  cleanupWarning?: string
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

type SaveClassroomSnapshotRequest = {
  workspaceKey: string
  classroomId: string
  savedAt: string
  saveId: string
  payload: AppSnapshotPayload
  // A1: このタブが読み込んだ時点の版数。サーバーが現在版数と照合し、古ければ拒否する。
  baseVersion?: number
  // 操作ログ(在庫が減る・記録が消える操作の監査記録)。前回保存以降に溜まった分を相乗りさせる。
  // スナップショット本体(payload)には入れない: 復元/ロールバックで「消した記録」ごと巻き戻ると監査に使えないため、
  // サーバーが別コレクション(classroomSnapshots/{id}/operationEvents)へ書く。詳細は src/utils/operationLog.ts。
  operationEvents?: OperationEvent[]
  // 生徒授業台帳(生徒×科目の授業実績と未消化・元コマ一覧つき)。内容が変わった保存にだけ相乗りさせ、
  // サーバーが JST 日付ごとに残す(classroomSnapshots/{id}/lessonLedgerDays)。詳細は src/utils/studentLessonLedger.ts。
  lessonLedger?: StudentLessonLedger
  // 保存した端末のアプリ版数と UA(2026-09-04)。古いキャッシュの版で操作していた報告を切り分ける監査項目。
  client?: { appVersion: string; userAgent: string }
  // 操作痕跡(2026-10-22 案 2)。前回保存以降の「盤面が変わる全確定・undo/redo・保存・別タブ」の要約(新しい方から最大 300 件)。
  // サーバーが classroomSnapshots/{id}/operationTraces/{saveId} へ残す(保持 90 日)。詳細は src/utils/operationTrace.ts。
  operationTrace?: OperationTraceEntry[]
}

export type SaveClassroomSnapshotOptions = {
  developmentOnly?: boolean
}

type DeleteWorkspaceClassroomRequest = {
  workspaceKey: string
  classroomId: string
}

function normalizeGoogleDriveBackupStatus(value: unknown): GoogleDriveBackupStatus | undefined {
  if (value === 'disabled' || value === 'synced' || value === 'failed') return value
  return undefined
}

function normalizeGoogleDriveBackupDiagnostic(value: unknown): GoogleDriveBackupDiagnostic | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const status = normalizeGoogleDriveBackupStatus(data.status) ?? 'disabled'
  const backupKind = data.backupKind === 'quarterHourly' ? 'quarterHourly' : data.backupKind === 'daily' ? 'daily' : 'hourly'
  const errorStatusCode = Number(data.errorStatusCode)

  return {
    workspaceKey: String(data.workspaceKey ?? ''),
    backupDateKey: String(data.backupDateKey ?? ''),
    backupKind,
    status,
    configured: Boolean(data.configured),
    folderIdMasked: String(data.folderIdMasked ?? ''),
    authSource: data.authSource === 'service-account-json' || data.authSource === 'oauth-refresh-token' ? data.authSource : 'application-default',
    serviceAccountEmail: String(data.serviceAccountEmail ?? ''),
    fileId: String(data.fileId ?? '') || undefined,
    fileName: String(data.fileName ?? '') || undefined,
    error: String(data.error ?? '') || undefined,
    errorStatusCode: Number.isFinite(errorStatusCode) ? errorStatusCode : undefined,
    errorHint: String(data.errorHint ?? '') || undefined,
  }
}

function requireFunctions() {
  const functions = getFirebaseFunctionsInstance()
  if (!functions) {
    throw new Error('サーバーに接続できません。通信状態を確認してください。')
  }

  return functions
}

function requireFirestore() {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) {
    throw new Error('サーバーに接続できません。通信状態を確認してください。')
  }

  return firestore
}

export async function provisionFirebaseWorkspaceClassroom(input: Omit<ProvisionWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
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
  await ensureFirebaseAuthenticatedUser()
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
    data: sanitizeForFirestore(input.initialPayload),
    updatedBy: '',
    updatedAt: now,
  })
  await batch.commit()

  return {
    classroomId: classroomRef.id,
    managerUserId: input.managerUserId,
  }
}

export async function reassignFirebaseWorkspaceClassroomManagerWithExistingUid(input: Omit<ReassignWorkspaceClassroomManagerWithExistingUidRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const config = getFirebaseBackendConfig()
  if (config.adminFunctionsEnabled) {
    const functions = requireFunctions()
    const callable = httpsCallable<ReassignWorkspaceClassroomManagerWithExistingUidRequest, ReassignWorkspaceClassroomManagerWithExistingUidResponse>(functions, 'reassignWorkspaceClassroomManager')
    const result = await callable({
      workspaceKey: config.workspaceKey,
      ...input,
    })
    return result.data
  }

  const firestore = requireFirestore()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const membersCollectionRef = collection(workspaceRef, 'members')
  const classroomsCollectionRef = collection(workspaceRef, 'classrooms')
  const classroomRef = doc(classroomsCollectionRef, input.classroomId)
  const classroomSnapshot = await getDoc(classroomRef)
  if (!classroomSnapshot.exists()) {
    throw new Error('対象の教室が見つかりません。')
  }

  const currentManagerUserId = String(classroomSnapshot.get('managerUserId') ?? '').trim()
  if (!currentManagerUserId) {
    throw new Error('現在の管理者 UID が未設定のため、差し替えできません。')
  }

  if (currentManagerUserId === input.managerUserId) {
    return {
      classroomId: input.classroomId,
      managerUserId: input.managerUserId,
    }
  }

  const currentMemberRef = doc(membersCollectionRef, currentManagerUserId)
  const nextMemberRef = doc(membersCollectionRef, input.managerUserId)
  const nextMemberSnapshot = await getDoc(nextMemberRef)
  if (nextMemberSnapshot.exists()) {
    const assignedClassroomId = String(nextMemberSnapshot.get('assignedClassroomId') ?? '').trim()
    if (assignedClassroomId && assignedClassroomId !== input.classroomId) {
      throw new Error('この UID はすでに別の教室へ割り当てられています。別ユーザーかどうかを確認してください。')
    }
  }

  const now = new Date().toISOString()
  const batch = writeBatch(firestore)

  batch.set(workspaceRef, {
    name: config.workspaceKey,
    schemaVersion: 1,
    updatedAt: now,
  }, { merge: true })
  batch.set(nextMemberRef, {
    displayName: input.managerName,
    email: input.managerEmail,
    role: 'manager',
    assignedClassroomId: input.classroomId,
    updatedAt: now,
  }, { merge: true })
  batch.set(classroomRef, {
    managerUserId: input.managerUserId,
    updatedAt: now,
  }, { merge: true })

  if (currentManagerUserId !== input.managerUserId) {
    batch.delete(currentMemberRef)
  }

  await batch.commit()

  return {
    classroomId: input.classroomId,
    managerUserId: input.managerUserId,
  }
}

export async function updateFirebaseWorkspaceClassroom(input: Omit<UpdateWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<UpdateWorkspaceClassroomRequest, { classroomId: string }>(functions, 'updateWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}

export function resolveSaveClassroomSnapshotCallableName(options?: SaveClassroomSnapshotOptions) {
  return options?.developmentOnly ? 'saveDevelopmentClassroomSnapshot' : 'saveClassroomSnapshot'
}

export async function saveClassroomSnapshotViaFunction(
  input: Omit<SaveClassroomSnapshotRequest, 'workspaceKey' | 'baseVersion'>,
  options?: SaveClassroomSnapshotOptions,
): Promise<{
  classroomId: string
  savedAt: string
  saveId: string
  payloadHash: string
  verified: boolean
  idempotentReplay: boolean
  writeMode: string
  dataByteLength: number
  version?: number
}> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<SaveClassroomSnapshotRequest, {
    classroomId: string
    savedAt: string
    saveId: string
    payloadHash: string
    verified: boolean
    idempotentReplay: boolean
    writeMode: string
    dataByteLength: number
    version?: number
  }>(functions, resolveSaveClassroomSnapshotCallableName(options), { timeout: 120_000 })
  // A1: このタブが把握している版数を baseVersion として送る(未読込なら undefined=照合スキップ)。
  const baseVersion = getClassroomSnapshotVersion(input.classroomId)
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
    ...(typeof baseVersion === 'number' ? { baseVersion } : {}),
    payload: sanitizeForFirestore(input.payload),
  })
  // 保存成功で返ってきた新版数をレジストリへ反映し、次の保存の baseVersion にする。
  if (typeof result.data.version === 'number') {
    setClassroomSnapshotVersion(input.classroomId, result.data.version)
  }
  return result.data
}

export type SubmitDeveloperReportResponse = {
  reportId: string
  storagePath: string
  recordedAt: string
  /** 内容に #テスト を含みテスト扱いになった(Issue 起票なし)。旧関数は返さない。 */
  isTest?: boolean
  /** 質問への AI 即時回答(開発用教室の質問のみ・spec-developer-report §G-7)。成功時は回答文、失敗時は理由。 */
  aiAnswer?: string
  aiAnswerError?: string
}

/**
 * 「開発者へ報告」を Cloud Function `submitDeveloperReport` へ送る。
 * 報告本文の組み立ては src/utils/developerReport.ts（純粋関数）。実行者・受領時刻はサーバーが付ける。
 */
export async function submitDeveloperReportViaFunction(input: DeveloperReportRequestBody): Promise<SubmitDeveloperReportResponse> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<DeveloperReportRequestBody & { workspaceKey: string }, SubmitDeveloperReportResponse>(functions, 'submitDeveloperReport', { timeout: 190_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
    snapshotPayload: input.snapshotPayload ? sanitizeForFirestore(input.snapshotPayload) : null,
  })
  return result.data
}

export type StudentLessonHistoryRequest = {
  classroomId: string
  studentId: string
  /** `YYYY-MM-DD`。省略/空ならサーバー既定（終了日=JSTの今日・開始日=その1年前）。 */
  from?: string
  to?: string
}

/**
 * 講習履歴（生徒1人の出席・休み・振替・予定・未消化の一覧）を Cloud Function
 * `getStudentLessonHistory` から取る（docs/plan-2026-09-11-five-requests.md §6 / H-2〜H-3）。
 *
 * 台帳 `lessonLedgerDays` は firestore.rules に match が無く**クライアントから直接読めない**。
 * ここを Firestore 直読みに「単純化」しないこと（読めずに常に空になる）。
 * この callable は読み取り専用で、呼んでも Firestore へは何も書かない（本番データ保護ルール）。
 */
export async function fetchStudentLessonHistoryViaFunction(input: StudentLessonHistoryRequest): Promise<StudentLessonHistoryResponse> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; classroomId: string; studentId: string; from?: string; to?: string }, StudentLessonHistoryResponse>(
    functions,
    'getStudentLessonHistory',
    { timeout: 120_000 },
  )
  const result = await callable({
    workspaceKey: config.workspaceKey,
    classroomId: input.classroomId,
    studentId: input.studentId,
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
  })
  return normalizeStudentLessonHistoryResponse(result.data)
}

export async function deleteFirebaseWorkspaceClassroom(input: Omit<DeleteWorkspaceClassroomRequest, 'workspaceKey'>) {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<DeleteWorkspaceClassroomRequest, { classroomId: string }>(functions, 'deleteWorkspaceClassroom')
  const result = await callable({
    workspaceKey: config.workspaceKey,
    ...input,
  })
  return result.data
}

export async function deleteFirebaseWorkspaceClassroomDirect(input: { classroomId: string }) {
  const authenticatedUser = await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const classroomsCollectionRef = collection(workspaceRef, 'classrooms')
  const membersCollectionRef = collection(workspaceRef, 'members')
  const snapshotsCollectionRef = collection(workspaceRef, 'classroomSnapshots')
  const classroomRef = doc(classroomsCollectionRef, input.classroomId)
  const classroomSnapshot = await getDoc(classroomRef)
  if (!classroomSnapshot.exists()) {
    throw new Error('対象の教室が見つかりません。')
  }
  const managerUserId = String(classroomSnapshot.get('managerUserId') ?? '').trim()

  // Delete classroom doc first
  await deleteDoc(classroomRef)

  // Delete snapshot doc (ignore if not exists)
  try {
    await deleteDoc(doc(snapshotsCollectionRef, input.classroomId))
  } catch {
    // snapshot may not exist
  }

  // Delete member doc only if it belongs to a different user (not the developer)
  if (managerUserId && managerUserId !== authenticatedUser.uid) {
    try {
      await deleteDoc(doc(membersCollectionRef, managerUserId))
    } catch {
      // member doc may not exist
    }
  }

  return { classroomId: input.classroomId }
}

export async function listFirebaseServerAutoBackupSummaries(): Promise<ServerAutoBackupSummary[]> {
  await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const workspaceRef = doc(firestore, 'workspaces', config.workspaceKey)
  const summariesRef = collection(workspaceRef, 'workspaceAutoBackupSummaries')
  const q = query(summariesRef, orderBy('savedAt', 'desc'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    const backupDateKey = String(data.backupDateKey ?? entry.id)
    const backupKind = data.backupKind === 'quarterHourly' ? 'quarterHourly' : data.backupKind === 'hourly' ? 'hourly' : 'daily'
    return {
      backupDateKey,
      backupKind,
      displayLabel: String(data.displayLabel ?? backupDateKey),
      savedAt: String(data.savedAt ?? ''),
      sourceSavedAt: String(data.sourceSavedAt ?? ''),
      storagePath: String(data.storagePath ?? ''),
      layout: resolveWorkspaceBackupSummaryLayout(data),
      classroomCount: typeof data.classroomCount === 'number' ? data.classroomCount : undefined,
      googleDriveBackupStatus: normalizeGoogleDriveBackupStatus(data.googleDriveBackupStatus),
      googleDriveBackupFileId: String(data.googleDriveBackupFileId ?? ''),
      googleDriveBackupFileName: String(data.googleDriveBackupFileName ?? ''),
      googleDriveBackupError: String(data.googleDriveBackupError ?? ''),
      googleDriveBackupErrorHint: String(data.googleDriveBackupErrorHint ?? ''),
      googleDriveBackupAuthSource: String(data.googleDriveBackupAuthSource ?? ''),
      googleDriveBackupServiceAccountEmail: String(data.googleDriveBackupServiceAccountEmail ?? ''),
      googleDriveBackupFolderIdMasked: String(data.googleDriveBackupFolderIdMasked ?? ''),
    }
  })
}

// 室長の自教室復元(docs/spec-save-restore.md §4-1)用: 指定時刻以降のバックアップ時点だけを新しい順に取る。
// 一覧は Firestore ルールでワークスペースのメンバーなら読める(書き込みは不可)。日次 400 日分まで読まないよう
// savedAt(ISO 文字列)の範囲で絞る。範囲と並べ替えが同じ単一フィールドなので複合インデックスは要らない。
export async function listRecentFirebaseServerAutoBackupSummaries(sinceIso: string): Promise<Array<Pick<ServerAutoBackupSummary, 'backupDateKey' | 'backupKind' | 'displayLabel' | 'savedAt' | 'sourceSavedAt'>>> {
  await ensureFirebaseAuthenticatedUser()
  const firestore = requireFirestore()
  const config = getFirebaseBackendConfig()
  const summariesRef = collection(doc(firestore, 'workspaces', config.workspaceKey), 'workspaceAutoBackupSummaries')
  const snapshot = await getDocs(query(summariesRef, where('savedAt', '>=', sinceIso), orderBy('savedAt', 'desc')))
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    const backupDateKey = String(data.backupDateKey ?? entry.id)
    return {
      backupDateKey,
      backupKind: data.backupKind === 'quarterHourly' ? 'quarterHourly' : data.backupKind === 'hourly' ? 'hourly' : 'daily',
      displayLabel: String(data.displayLabel ?? backupDateKey),
      savedAt: String(data.savedAt ?? ''),
      sourceSavedAt: String(data.sourceSavedAt ?? ''),
    }
  })
}

// 本番のワークスペースバックアップ JSON は数十 MB に達する(教室分のフルスナップショット)。
// Firebase callable のレスポンス上限(約10MB)を超えると `internal` で失敗するため、
// サーバーは gzip+base64 で圧縮して返す(44MB→約2.4MB)。ここで元の JSON 文字列へ復元する。
async function gunzipBase64ToString(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  if (typeof DecompressionStream === 'function') {
    const decompressedStream = new Response(new Blob([bytes])).body?.pipeThrough(new DecompressionStream('gzip'))
    if (!decompressedStream) throw new Error('バックアップを開けませんでした。')
    return await new Response(decompressedStream).text()
  }
  throw new Error('このブラウザでは復元できません。Chrome か Edge の最新版でお使いください。')
}

/** 旧形式(全体 1 本)の時点を丸ごと取得する(§10-5)。教室別形式の時点に呼ぶとサーバーが failed-precondition で止める(再読み込みの案内)。 */
export async function downloadFirebaseServerAutoBackup(backupDateKey: string, options: { purpose?: ServerAutoBackupDownloadPurpose } = {}): Promise<string> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string; purpose: ServerAutoBackupDownloadPurpose }, { snapshotJson?: string; snapshotGzipBase64?: string }>(functions, 'downloadServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
    purpose: options.purpose ?? 'restore',
  })
  if (typeof result.data.snapshotGzipBase64 === 'string' && result.data.snapshotGzipBase64) {
    return await gunzipBase64ToString(result.data.snapshotGzipBase64)
  }
  if (typeof result.data.snapshotJson === 'string') {
    return result.data.snapshotJson
  }
  throw new Error('サーバーバックアップの応答が不正です。')
}

export type PreparedServerAutoBackupRestore = {
  layout: typeof WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
  index: WorkspaceBackupIndex
}

/**
 * 教室別形式の時点の全体復元・ローカル同期の準備(§10-5)。復元('restore')ならサーバーが復元前の控えを先に書く。
 * 返る目次は共有純関数で検査する(会社・時点の照合・INV-08)。
 */
export async function prepareFirebaseServerAutoBackupRestore(backupDateKey: string, purpose: ServerAutoBackupDownloadPurpose): Promise<PreparedServerAutoBackupRestore> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  // サーバーの timeoutSeconds(300)より長く待つ(同じ値だとサーバーの失敗応答より先にクライアントが諦める・regression-reviewer 低-9)。
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string; purpose: ServerAutoBackupDownloadPurpose }, { layout?: unknown; index?: unknown }>(functions, 'prepareServerAutoBackupRestore', { timeout: 330_000 })
  const result = await callable({ workspaceKey: config.workspaceKey, backupDateKey, purpose })
  if (result.data.layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) {
    throw new Error('サーバーバックアップの応答が不正です。')
  }
  return { layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM, index: validateWorkspaceBackupIndex(result.data.index, { workspaceKey: config.workspaceKey, backupDateKey }) }
}

/**
 * 時点の全体(WorkspaceSnapshot)を JSON 文字列で取得する。形式は要約の layout で読み分ける(§10-5):
 *  - 旧形式 … 従来の downloadServerAutoBackup(全体 1 本)。
 *  - 教室別形式 … 目次を取り(復元なら控えを書いた後)、教室ごとに downloadClassroomFromServerAutoBackup で取って、共有純関数で
 *    全体を組み立て直す(AC-B1: 旧形式で書いた JSON と同じ中身)。教室選択モーダルも JSON 読込も今までどおりこの文字列を受ける。
 *  - 知らない形式 … 進まない(再読み込みを促す)。
 */
export type ServerAutoBackupDownloadDeps = {
  downloadLegacy: typeof downloadFirebaseServerAutoBackup
  prepare: typeof prepareFirebaseServerAutoBackupRestore
  downloadClassroom: typeof downloadClassroomFromFirebaseServerAutoBackup
}

export async function downloadFirebaseServerAutoBackupJson(
  summary: { backupDateKey: string; layout?: WorkspaceBackupSummaryLayout },
  options: { purpose: ServerAutoBackupDownloadPurpose; onProgress?: (done: number, total: number) => void },
  // callable はテストから差し替える(組み立ての順番・照合・中止をユニットで直接動かすため)。
  deps: ServerAutoBackupDownloadDeps = { downloadLegacy: downloadFirebaseServerAutoBackup, prepare: prepareFirebaseServerAutoBackupRestore, downloadClassroom: downloadClassroomFromFirebaseServerAutoBackup },
): Promise<string> {
  const layout = summary.layout ?? 'legacy'
  if (layout === 'legacy') return deps.downloadLegacy(summary.backupDateKey, { purpose: options.purpose })
  if (layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) {
    throw new Error('このバックアップの形式はこの版では読めません。画面を再読み込みしてから、もう一度お試しください。')
  }
  const prepared = await deps.prepare(summary.backupDateKey, options.purpose)
  const total = prepared.index.classrooms.length
  const classroomData: Array<{ classroomId: string; data: Record<string, unknown> }> = []
  for (const [position, classroom] of prepared.index.classrooms.entries()) {
    const source = await deps.downloadClassroom(summary.backupDateKey, classroom.id)
    // 応答の教室 ID が要求と違えば組み立てない(別教室の混入を防ぐ・INV-08)。
    if (source.classroomId !== classroom.id) {
      throw new Error('取得した教室がバックアップの目次と一致しないため、復元を中止しました。')
    }
    classroomData.push({ classroomId: classroom.id, data: source.data as unknown as Record<string, unknown> })
    options.onProgress?.(position + 1, total)
  }
  return serializeWorkspaceBackupValue(assembleWorkspaceBackupFromIndex(prepared.index, classroomData))
}

export async function triggerFirebaseServerAutoBackup(): Promise<TriggerServerAutoBackupResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string }, {
    backupDateKey: string
    backupKind?: 'daily' | 'hourly' | 'quarterHourly'
    workspaceCount: number
    googleDriveBackups?: unknown[]
  }>(functions, 'triggerWorkspaceServerAutoBackup', { timeout: 120_000 })
  const result = await callable({ workspaceKey: config.workspaceKey })
  return {
    backupDateKey: String(result.data.backupDateKey ?? ''),
    backupKind: result.data.backupKind === 'quarterHourly' ? 'quarterHourly' : result.data.backupKind === 'daily' ? 'daily' : 'hourly',
    workspaceCount: Number(result.data.workspaceCount ?? 0),
    googleDriveBackups: (result.data.googleDriveBackups ?? [])
      .map(normalizeGoogleDriveBackupDiagnostic)
      .filter((entry): entry is GoogleDriveBackupDiagnostic => entry !== null),
  }
}

export type ClassroomFromServerAutoBackup = {
  classroomId: string
  classroomName: string
  savedAt: string
  data: AppSnapshotPayload
}

export type DevelopmentBackupSource = {
  backupDateKey: string
  backupKind: 'daily' | 'hourly' | 'quarterHourly'
  displayLabel: string
  savedAt: string
  sourceSavedAt: string
}

export type DevelopmentClassroomBackupSources = {
  backups: DevelopmentBackupSource[]
  classrooms: Array<{ id: string; name: string }>
}

// Feature B: 開発用教室へ読み込める「他教室 × バックアップ時点」の候補を取得する。
// 開発者でも開発用教室の室長でも呼べる(サーバー側で権限判定)。
export async function listDevelopmentClassroomBackupSources(): Promise<DevelopmentClassroomBackupSources> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string }, DevelopmentClassroomBackupSources>(functions, 'listDevelopmentClassroomBackupSources', { timeout: 120_000 })
  const result = await callable({ workspaceKey: config.workspaceKey })
  return {
    backups: Array.isArray(result.data.backups) ? result.data.backups : [],
    classrooms: Array.isArray(result.data.classrooms) ? result.data.classrooms : [],
  }
}

export async function downloadClassroomFromFirebaseServerAutoBackup(backupDateKey: string, classroomId: string): Promise<ClassroomFromServerAutoBackup> {
  await ensureFirebaseAuthenticatedUser()
  const functions = requireFunctions()
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; backupDateKey: string; classroomId: string }, { classroomId: string; classroomName: string; savedAt: string; dataGzipBase64?: string; data?: AppSnapshotPayload }>(functions, 'downloadClassroomFromServerAutoBackup', { timeout: 120_000 })
  const result = await callable({
    workspaceKey: config.workspaceKey,
    backupDateKey,
    classroomId,
  })
  // 1教室分でも数MBになりうるため、サーバーは gzip+base64 で返す。ここで AppSnapshotPayload へ復元する。
  let data: AppSnapshotPayload
  if (typeof result.data.dataGzipBase64 === 'string' && result.data.dataGzipBase64) {
    data = JSON.parse(await gunzipBase64ToString(result.data.dataGzipBase64)) as AppSnapshotPayload
  } else if (result.data.data) {
    data = result.data.data
  } else {
    throw new Error('教室バックアップの応答が不正です。')
  }
  return {
    classroomId: result.data.classroomId,
    classroomName: result.data.classroomName,
    savedAt: result.data.savedAt,
    data,
  }
}
