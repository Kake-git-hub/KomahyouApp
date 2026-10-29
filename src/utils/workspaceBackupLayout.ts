// 15 分ごとの自動バックアップの教室別化(docs/spec-save-restore.md §10・計画 docs/plan-2026-10-28-per-classroom-auto-backup-handoff.md)の【共有純関数】。
// 置き場所(パス)の組み立てと文字種検査・教室ファイルの組み立てと 3 点照合・時点の目次(index.json)の組み立てと検査・
// 要約(workspaceAutoBackupSummaries)の形式判定・目次と教室ファイルから全体(WorkspaceSnapshot)を組み立て直す処理をここに集める。
//
// ★このファイルの制約(必ず守る・classroomSnapshotParts.ts と同じ作法)
//   - **自己完結**(import 文 0 行・ビルド時メタ情報の参照・CommonJS の読み込み関数すべて禁止)。functions/scripts/sync-shared.mjs が
//     functions/src/generated/workspaceBackupLayout.ts へそのまま複製する。ズレは functions/src/workspaceBackupLayout.parity.test.ts が検出する。
//   - ハッシュ関数(Node crypto / ブラウザ crypto.subtle)・gzip・Storage/Firestore/Drive の I/O は**外から渡す**(ここでは触らない)。
//   - パスの組み立て・教室ファイルと目次の形・全体の組み立て直しは**このモジュールだけ**が行う(index.ts・adminFunctions.ts に同じ計算を再実装しない)。
//
// ★守るもの(§10-2・BK-1〜BK-9)
//   - BK-6(INV-08): 1 つの教室ファイルには 1 教室だけ。読むときは「要求の教室 ID・パス・ファイルの中の教室 ID(backupFile)」の 3 つを照合する。
//     教室 ID・時点キー・会社キーは `^[A-Za-z0-9_-]+$` だけを通す(パスの組み立て前に検査・`..` や `/` を通さない)。
//   - BK-5(INV-14): 組み立てられない教室は書かずに目次の missingClassrooms に残す。目次は全教室ファイルの後に書く(書き終わっていない時点を一覧に出さない)。
//   - BK-4: 旧形式(1 本の JSON)は永久に読める。要約に layout が無ければ旧形式(resolveWorkspaceBackupSummaryLayout)。
//   - 教室ファイルは「1 教室だけ入った WorkspaceSnapshot」。旧来の読み手(parseWorkspaceSnapshot・resolveWorkspaceBackupImportTarget・
//     tools/snapshot-diff.mjs)が無改修で読める(AC-B3)。
//
// ★同一性の約束(AC-B1): 同じ時点を旧形式で書いた JSON(buildWorkspaceBackupSnapshot)と、目次＋教室ファイルから組み立て直した
//   WorkspaceSnapshot(assembleWorkspaceBackupFromIndex / assembleWorkspaceBackupFromClassroomFiles)は stableStringify が一致する
//   (users・教室の並び・missingClassroomIds を含む)。

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 旧形式(会社ごとに全教室を 1 本の JSON)。要約に layout が無い＝これ。 */
export const WORKSPACE_BACKUP_LAYOUT_LEGACY = 'legacy'
/** 教室別形式(教室ごとに 1 本の gzip＋時点の目次 index.json)。要約の layout・教室ファイルの backupFile.layout・目次の layout に書く印。 */
export const WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM = 'per-classroom-v1'
export type WorkspaceBackupLayout = typeof WORKSPACE_BACKUP_LAYOUT_LEGACY | typeof WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
/** 要約の形式判定の結果。'unknown' は知らない layout(将来の版)＝読み手は fail-closed(空や一部を返さない)。 */
export type WorkspaceBackupSummaryLayout = WorkspaceBackupLayout | 'unknown'

/** Storage の置き場所の先頭(旧形式と同じ)。 */
export const WORKSPACE_BACKUP_STORAGE_PREFIX = 'workspace-auto-backups'
/** 15 分ごとの時点のフォルダ(旧形式の `15min/{key}.json` と同じ階層。教室別形式は `15min/{key}/` のフォルダになる)。 */
export const WORKSPACE_BACKUP_QUARTER_HOURLY_FOLDER = '15min'
/** 時点の目次のファイル名(平文 JSON・小さい)。 */
export const WORKSPACE_BACKUP_INDEX_FILE_NAME = 'index.json'
/** 教室ファイルの拡張子(gzip)。 */
export const WORKSPACE_BACKUP_CLASSROOM_FILE_SUFFIX = '.json.gz'
/** 目次・教室ファイルの schemaVersion(旧形式の WorkspaceSnapshot.schemaVersion と同じ 1)。 */
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1
/** 要約の無い時点フォルダ(書き終わる前に止まった取り残し)を消してよい経過時間。1 日より前のものだけ(§10-6)。 */
export const WORKSPACE_BACKUP_ORPHAN_FOLDER_GRACE_HOURS = 24
/** Google Drive のミラーのファイル名の接頭辞(旧形式と同じ)。 */
export const WORKSPACE_BACKUP_DRIVE_FILE_NAME_PREFIX = 'komahyouapp'
/** Google Drive の目次ファイル名の末尾(gzip。旧形式の非圧縮 .json を 7 日で消す規則に巻き込まれないよう .json.gz にする・§10-6)。 */
export const WORKSPACE_BACKUP_DRIVE_INDEX_SUFFIX = '_index.json.gz'

/** 目次の missingClassrooms の理由。assembly-failed=組み立てられない(INV-14)・write-failed=Storage への書き込みが 2 回とも失敗。 */
export const WORKSPACE_BACKUP_MISSING_REASONS = ['assembly-failed', 'write-failed'] as const
export type WorkspaceBackupMissingReason = (typeof WORKSPACE_BACKUP_MISSING_REASONS)[number]

/** 教室 ID・時点キー・会社キーに許す文字(パス・トラバーサル対策。`/`・`..`・空文字・空白を通さない)。 */
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/
/** 目次の教室の行にだけある項目(全体を組み立て直すときに教室の項目から外す)。 */
const INDEX_ONLY_CLASSROOM_FIELDS = ['file', 'bytes', 'sha256', 'sourceSavedAt'] as const

// ---------------------------------------------------------------------------
// 型(構造だけ。アプリの型は import できないので最小限)
// ---------------------------------------------------------------------------

export type WorkspaceBackupUser = {
  id: string
  name: string
  email: string
  role: string
  assignedClassroomId: string | null
  [key: string]: unknown
}

/** 教室の項目(旧形式の classrooms[] の要素・functions の toWorkspaceClassroom の出力形)。data が教室データ全体。 */
export type WorkspaceBackupClassroomEntry = {
  id: string
  name: string
  data: Record<string, unknown>
  [key: string]: unknown
}

/** 旧形式の全体 JSON(WorkspaceSnapshot)の形。教室ファイルもこの形(＋backupFile)。 */
export type WorkspaceBackupSnapshot = {
  schemaVersion: number
  savedAt: string
  developerPassword: string
  developerCloudBackupEnabled: boolean
  developerCloudBackupFolderName: string
  developerCloudSyncedAutoBackupKeys: string[]
  currentUserId: string
  actingClassroomId: string | null
  users: WorkspaceBackupUser[]
  classrooms: WorkspaceBackupClassroomEntry[]
  /** 組み立てられず除いた教室(INV-14)。1 件以上のときだけ付く(旧形式と同じ)。 */
  missingClassroomIds?: string[]
}

/** 教室ファイルの照合用の印(BK-6・INV-08)。 */
export type WorkspaceBackupFileMarker = {
  layout: typeof WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
  workspaceKey: string
  backupDateKey: string
  classroomId: string
  savedAt: string
  sourceSavedAt: string
}

export type WorkspaceBackupClassroomFile = WorkspaceBackupSnapshot & { backupFile: WorkspaceBackupFileMarker }

/** 目次の教室の行 = 教室の項目(data 以外)＋ファイルの所在と検査値。 */
export type WorkspaceBackupIndexClassroom = {
  id: string
  name: string
  /** 時点フォルダからの相対名(`{classroomId}.json.gz`)。 */
  file: string
  /** 教室ファイルの非圧縮 JSON のバイト数(UTF-8)。 */
  bytes: number
  /** 教室ファイルの非圧縮 JSON の SHA-256(16 進)。 */
  sha256: string
  /** その教室の元データの保存時刻(教室スナップショットの savedAt)。読めなければ ''。 */
  sourceSavedAt: string
  [key: string]: unknown
}

export type WorkspaceBackupMissingClassroom = { id: string; reason: WorkspaceBackupMissingReason }

export type WorkspaceBackupIndex = {
  layout: typeof WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
  schemaVersion: number
  workspaceKey: string
  backupDateKey: string
  savedAt: string
  sourceSavedAt: string
  users: WorkspaceBackupUser[]
  classrooms: WorkspaceBackupIndexClassroom[]
  missingClassrooms: WorkspaceBackupMissingClassroom[]
}

// ---------------------------------------------------------------------------
// 例外
// ---------------------------------------------------------------------------

export type WorkspaceBackupLayoutErrorReason =
  | 'invalid-workspace-key'
  | 'invalid-backup-date-key'
  | 'invalid-classroom-id'
  | 'invalid-index'
  | 'index-mismatch'
  | 'invalid-classroom-file'
  | 'classroom-file-mismatch'
  | 'missing-classroom-file'
  | 'hash-mismatch'

/** 形式の検査・照合の失敗。読み手は空や一部を返さず、この例外をそのまま失敗にする(INV-08・INV-14)。 */
export class WorkspaceBackupLayoutError extends Error {
  readonly reason: WorkspaceBackupLayoutErrorReason
  readonly details: string[]

  constructor(reason: WorkspaceBackupLayoutErrorReason, details: string[] = []) {
    super(`workspace-backup-layout: ${reason}${details.length > 0 ? ` (${details.join(' / ')})` : ''}`)
    this.name = 'WorkspaceBackupLayoutError'
    this.reason = reason
    this.details = details
  }
}

export function isWorkspaceBackupLayoutError(error: unknown): error is WorkspaceBackupLayoutError {
  return error instanceof WorkspaceBackupLayoutError
    || Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'WorkspaceBackupLayoutError')
}

// ---------------------------------------------------------------------------
// 文字種検査とパス(BK-6)
// ---------------------------------------------------------------------------

export function isSafeWorkspaceBackupPathSegment(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PATH_SEGMENT_PATTERN.test(value)
}

export function assertSafeWorkspaceBackupWorkspaceKey(workspaceKey: unknown): string {
  if (!isSafeWorkspaceBackupPathSegment(workspaceKey)) throw new WorkspaceBackupLayoutError('invalid-workspace-key')
  return workspaceKey
}

export function assertSafeWorkspaceBackupDateKey(backupDateKey: unknown): string {
  if (!isSafeWorkspaceBackupPathSegment(backupDateKey)) throw new WorkspaceBackupLayoutError('invalid-backup-date-key')
  return backupDateKey
}

/** 教室 ID の文字種検査。パスを組み立てる前・Storage を読む前に必ず通す(AC-B5)。 */
export function assertSafeWorkspaceBackupClassroomId(classroomId: unknown): string {
  if (!isSafeWorkspaceBackupPathSegment(classroomId)) throw new WorkspaceBackupLayoutError('invalid-classroom-id')
  return classroomId
}

/** 時点のフォルダ(末尾 `/`)。`workspace-auto-backups/{ws}/15min/{key}/`。旧形式の `15min/{key}.json` とは名前が重ならない。 */
export function buildWorkspaceBackupTimePointPrefix(workspaceKey: string, backupDateKey: string): string {
  return `${WORKSPACE_BACKUP_STORAGE_PREFIX}/${assertSafeWorkspaceBackupWorkspaceKey(workspaceKey)}/${WORKSPACE_BACKUP_QUARTER_HOURLY_FOLDER}/${assertSafeWorkspaceBackupDateKey(backupDateKey)}/`
}

/** 教室ファイルの名前(フォルダからの相対)。 */
export function buildWorkspaceBackupClassroomFileName(classroomId: string): string {
  return `${assertSafeWorkspaceBackupClassroomId(classroomId)}${WORKSPACE_BACKUP_CLASSROOM_FILE_SUFFIX}`
}

/** フォルダ(末尾 `/`)の下の教室ファイルのパス。時点フォルダにも復元前の控え(incident)のフォルダにも使う。 */
export function buildWorkspaceBackupClassroomFilePath(folderPrefix: string, classroomId: string): string {
  return `${assertFolderPrefix(folderPrefix)}${buildWorkspaceBackupClassroomFileName(classroomId)}`
}

/** フォルダ(末尾 `/`)の下の目次のパス。 */
export function buildWorkspaceBackupIndexFilePath(folderPrefix: string): string {
  return `${assertFolderPrefix(folderPrefix)}${WORKSPACE_BACKUP_INDEX_FILE_NAME}`
}

export function buildWorkspaceBackupIndexStoragePath(workspaceKey: string, backupDateKey: string): string {
  return buildWorkspaceBackupIndexFilePath(buildWorkspaceBackupTimePointPrefix(workspaceKey, backupDateKey))
}

export function buildWorkspaceBackupClassroomStoragePath(workspaceKey: string, backupDateKey: string, classroomId: string): string {
  return buildWorkspaceBackupClassroomFilePath(buildWorkspaceBackupTimePointPrefix(workspaceKey, backupDateKey), classroomId)
}

function assertFolderPrefix(folderPrefix: string): string {
  if (typeof folderPrefix !== 'string' || !folderPrefix.endsWith('/') || folderPrefix.includes('..')) {
    throw new WorkspaceBackupLayoutError('invalid-backup-date-key', ['folder prefix must end with / and must not contain ..'])
  }
  return folderPrefix
}

/** 時点フォルダのパスから会社キー・時点キー・ファイル名を読む。形が違えば null(旧形式の `15min/{key}.json` も null)。 */
export function parseWorkspaceBackupTimePointPath(path: string): { workspaceKey: string; backupDateKey: string; fileName: string } | null {
  const match = /^workspace-auto-backups\/([A-Za-z0-9_-]+)\/15min\/([A-Za-z0-9_-]+)\/([^/]+)$/.exec(path)
  if (!match) return null
  return { workspaceKey: match[1], backupDateKey: match[2], fileName: match[3] }
}

/** Google Drive のファイル名に使える会社キー(旧形式の buildGoogleDriveBackupFileName と同じ置換)。 */
export function sanitizeWorkspaceKeyForDriveFileName(workspaceKey: string): string {
  return workspaceKey.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

/** Drive の教室ファイル名 `komahyouapp_{ws}_{kind}_{key}_{classroomId}.json.gz`(旧形式の全体ファイル名の末尾に教室 ID を足した形)。 */
export function buildGoogleDriveClassroomBackupFileName(workspaceKey: string, backupKind: string, backupDateKey: string, classroomId: string): string {
  return `${WORKSPACE_BACKUP_DRIVE_FILE_NAME_PREFIX}_${sanitizeWorkspaceKeyForDriveFileName(workspaceKey)}_${backupKind}_${assertSafeWorkspaceBackupDateKey(backupDateKey)}_${assertSafeWorkspaceBackupClassroomId(classroomId)}${WORKSPACE_BACKUP_CLASSROOM_FILE_SUFFIX}`
}

/** Drive の目次ファイル名 `komahyouapp_{ws}_{kind}_{key}_index.json.gz`。 */
export function buildGoogleDriveIndexBackupFileName(workspaceKey: string, backupKind: string, backupDateKey: string): string {
  return `${WORKSPACE_BACKUP_DRIVE_FILE_NAME_PREFIX}_${sanitizeWorkspaceKeyForDriveFileName(workspaceKey)}_${backupKind}_${assertSafeWorkspaceBackupDateKey(backupDateKey)}${WORKSPACE_BACKUP_DRIVE_INDEX_SUFFIX}`
}

// ---------------------------------------------------------------------------
// 全体 JSON の形(旧形式と教室ファイルの共通の土台)
// ---------------------------------------------------------------------------

/** users / classrooms の型を呼び出し側の型(サーバーの WorkspaceUser 等)のまま保つための形(satisfies で照合できるように)。 */
export type WorkspaceBackupSnapshotOf<TUser extends WorkspaceBackupUser, TClassroom extends WorkspaceBackupClassroomEntry> =
  Omit<WorkspaceBackupSnapshot, 'users' | 'classrooms'> & { users: TUser[]; classrooms: TClassroom[] }

/**
 * 旧形式の全体 JSON(WorkspaceSnapshot)の形を作る。サーバーの buildWorkspaceServerBackupSnapshot も教室ファイルの組み立ても
 * ここを通る(1 か所)。actingClassroomId は先頭の教室・missingClassroomIds は 1 件以上のときだけ付く(旧形式と同じ)。
 * ★項目と順番は 2026-10-29 より前の index.ts のリテラルと同じ(ゴールデンテストで固定)。変えると旧形式の JSON が変わる。
 */
export function buildWorkspaceBackupSnapshot<TUser extends WorkspaceBackupUser, TClassroom extends WorkspaceBackupClassroomEntry>(params: {
  savedAt: string
  users: readonly TUser[]
  classrooms: readonly TClassroom[]
  missingClassroomIds?: readonly string[]
}): WorkspaceBackupSnapshotOf<TUser, TClassroom> {
  const missingClassroomIds = [...(params.missingClassroomIds ?? [])]
  return {
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    savedAt: params.savedAt,
    developerPassword: 'developer',
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: '',
    actingClassroomId: params.classrooms[0]?.id ?? null,
    users: [...params.users],
    classrooms: [...params.classrooms],
    ...(missingClassroomIds.length > 0 ? { missingClassroomIds } : {}),
  }
}

/** JSON の文字列化(字下げなし・旧形式の serializeWorkspaceBackupJson と同じ)。 */
export function serializeWorkspaceBackupValue(value: unknown): string {
  return JSON.stringify(value)
}

/** UTF-8 のバイト数(目次の bytes)。自己完結のため TextEncoder に頼らず文字コードから数える(サロゲートペアは 4 バイト)。 */
export function measureWorkspaceBackupJsonBytes(json: string): number {
  let bytes = 0
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

// ---------------------------------------------------------------------------
// 教室ファイル(BK-6)
// ---------------------------------------------------------------------------

/** 教室ファイル = 1 教室だけ入った WorkspaceSnapshot(users は空・actingClassroomId はその教室)＋照合用の backupFile。 */
export function buildWorkspaceBackupClassroomFile(params: {
  workspaceKey: string
  backupDateKey: string
  savedAt: string
  sourceSavedAt: string
  classroom: WorkspaceBackupClassroomEntry
}): WorkspaceBackupClassroomFile {
  const classroomId = assertSafeWorkspaceBackupClassroomId(params.classroom.id)
  return {
    ...buildWorkspaceBackupSnapshot({ savedAt: params.savedAt, users: [], classrooms: [params.classroom] }),
    backupFile: {
      layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM,
      workspaceKey: assertSafeWorkspaceBackupWorkspaceKey(params.workspaceKey),
      backupDateKey: assertSafeWorkspaceBackupDateKey(params.backupDateKey),
      classroomId,
      savedAt: params.savedAt,
      sourceSavedAt: params.sourceSavedAt,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 教室ファイルの検査と 3 点照合(AC-B6)。形が違えば invalid-classroom-file、backupFile(会社・時点・教室)または中身の教室 ID が
 * 要求と違えば classroom-file-mismatch。どちらも読み込まずに失敗にする(別教室のデータを返さない・INV-08)。
 */
export function validateWorkspaceBackupClassroomFile(
  value: unknown,
  expected: { workspaceKey: string; backupDateKey: string; classroomId: string },
): WorkspaceBackupClassroomFile {
  if (!isRecord(value)) throw new WorkspaceBackupLayoutError('invalid-classroom-file', ['not an object'])
  const marker = value.backupFile
  if (!isRecord(marker)) throw new WorkspaceBackupLayoutError('invalid-classroom-file', ['backupFile missing'])
  if (marker.layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) throw new WorkspaceBackupLayoutError('invalid-classroom-file', [`layout=${String(marker.layout)}`])
  for (const field of ['workspaceKey', 'backupDateKey', 'classroomId', 'savedAt', 'sourceSavedAt'] as const) {
    if (typeof marker[field] !== 'string') throw new WorkspaceBackupLayoutError('invalid-classroom-file', [`backupFile.${field}`])
  }
  if (typeof value.savedAt !== 'string' || !Array.isArray(value.classrooms) || !Array.isArray(value.users)) {
    throw new WorkspaceBackupLayoutError('invalid-classroom-file', ['savedAt / classrooms / users'])
  }
  if (value.classrooms.length !== 1) throw new WorkspaceBackupLayoutError('invalid-classroom-file', [`classrooms=${value.classrooms.length}`])
  const classroom = value.classrooms[0]
  if (!isRecord(classroom) || typeof classroom.id !== 'string' || !isRecord(classroom.data)) {
    throw new WorkspaceBackupLayoutError('invalid-classroom-file', ['classrooms[0]'])
  }
  const mismatches: string[] = []
  if (marker.workspaceKey !== expected.workspaceKey) mismatches.push('workspaceKey')
  if (marker.backupDateKey !== expected.backupDateKey) mismatches.push('backupDateKey')
  if (marker.classroomId !== expected.classroomId) mismatches.push('backupFile.classroomId')
  if (classroom.id !== expected.classroomId) mismatches.push('classrooms[0].id')
  if (mismatches.length > 0) throw new WorkspaceBackupLayoutError('classroom-file-mismatch', mismatches)
  return value as unknown as WorkspaceBackupClassroomFile
}

// ---------------------------------------------------------------------------
// 時点の目次(index.json)
// ---------------------------------------------------------------------------

/** 教室の項目から目次の行を作る(data を外し、ファイルの所在と検査値を足す)。 */
export function buildWorkspaceBackupIndexClassroom(params: {
  classroom: WorkspaceBackupClassroomEntry
  bytes: number
  sha256: string
  sourceSavedAt: string
}): WorkspaceBackupIndexClassroom {
  const { data: _data, ...meta } = params.classroom
  void _data
  const classroomId = assertSafeWorkspaceBackupClassroomId(params.classroom.id)
  return {
    ...meta,
    id: classroomId,
    name: typeof params.classroom.name === 'string' ? params.classroom.name : '',
    file: buildWorkspaceBackupClassroomFileName(classroomId),
    bytes: params.bytes,
    sha256: params.sha256,
    sourceSavedAt: params.sourceSavedAt,
  }
}

export function buildWorkspaceBackupIndex(params: {
  workspaceKey: string
  backupDateKey: string
  savedAt: string
  sourceSavedAt: string
  users: readonly WorkspaceBackupUser[]
  classrooms: readonly WorkspaceBackupIndexClassroom[]
  missingClassrooms: readonly WorkspaceBackupMissingClassroom[]
}): WorkspaceBackupIndex {
  return {
    layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM,
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    workspaceKey: assertSafeWorkspaceBackupWorkspaceKey(params.workspaceKey),
    backupDateKey: assertSafeWorkspaceBackupDateKey(params.backupDateKey),
    savedAt: params.savedAt,
    sourceSavedAt: params.sourceSavedAt,
    users: [...params.users],
    classrooms: [...params.classrooms],
    missingClassrooms: params.missingClassrooms.map((entry) => ({ id: entry.id, reason: entry.reason })),
  }
}

/** 目次の missingClassrooms を ID の並びに(要約・全体 JSON の missingClassroomIds と同じ形)。 */
export function listWorkspaceBackupMissingClassroomIds(index: Pick<WorkspaceBackupIndex, 'missingClassrooms'>): string[] {
  return index.missingClassrooms.map((entry) => entry.id)
}

/**
 * 目次の検査(形・教室 ID の文字種と重複・missing との重なり)。expected を渡すと会社キー・時点キーの照合もする(index-mismatch)。
 * 知らない layout・schemaVersion は invalid-index(読み手は fail-closed)。
 */
export function validateWorkspaceBackupIndex(value: unknown, expected?: { workspaceKey?: string; backupDateKey?: string }): WorkspaceBackupIndex {
  if (!isRecord(value)) throw new WorkspaceBackupLayoutError('invalid-index', ['not an object'])
  if (value.layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) throw new WorkspaceBackupLayoutError('invalid-index', [`layout=${String(value.layout)}`])
  if (value.schemaVersion !== WORKSPACE_BACKUP_SCHEMA_VERSION) throw new WorkspaceBackupLayoutError('invalid-index', [`schemaVersion=${String(value.schemaVersion)}`])
  for (const field of ['workspaceKey', 'backupDateKey', 'savedAt', 'sourceSavedAt'] as const) {
    if (typeof value[field] !== 'string') throw new WorkspaceBackupLayoutError('invalid-index', [field])
  }
  if (!isSafeWorkspaceBackupPathSegment(value.workspaceKey)) throw new WorkspaceBackupLayoutError('invalid-index', ['workspaceKey chars'])
  if (!isSafeWorkspaceBackupPathSegment(value.backupDateKey)) throw new WorkspaceBackupLayoutError('invalid-index', ['backupDateKey chars'])
  if (!Array.isArray(value.users) || !value.users.every((entry) => isRecord(entry) && typeof entry.id === 'string')) {
    throw new WorkspaceBackupLayoutError('invalid-index', ['users'])
  }
  if (!Array.isArray(value.classrooms)) throw new WorkspaceBackupLayoutError('invalid-index', ['classrooms'])
  const seen = new Set<string>()
  for (const [position, entry] of value.classrooms.entries()) {
    if (!isRecord(entry) || !isSafeWorkspaceBackupPathSegment(entry.id)) throw new WorkspaceBackupLayoutError('invalid-index', [`classrooms[${position}].id`])
    if (typeof entry.name !== 'string' || typeof entry.file !== 'string' || typeof entry.sha256 !== 'string' || typeof entry.sourceSavedAt !== 'string'
      || typeof entry.bytes !== 'number' || !Number.isFinite(entry.bytes)) {
      throw new WorkspaceBackupLayoutError('invalid-index', [`classrooms[${position}]`])
    }
    if (entry.file !== buildWorkspaceBackupClassroomFileName(entry.id)) throw new WorkspaceBackupLayoutError('invalid-index', [`classrooms[${position}].file`])
    if (seen.has(entry.id)) throw new WorkspaceBackupLayoutError('invalid-index', [`duplicate classroom ${entry.id}`])
    seen.add(entry.id)
  }
  if (!Array.isArray(value.missingClassrooms)) throw new WorkspaceBackupLayoutError('invalid-index', ['missingClassrooms'])
  for (const [position, entry] of value.missingClassrooms.entries()) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !(WORKSPACE_BACKUP_MISSING_REASONS as readonly string[]).includes(String(entry.reason))) {
      throw new WorkspaceBackupLayoutError('invalid-index', [`missingClassrooms[${position}]`])
    }
    if (seen.has(entry.id)) throw new WorkspaceBackupLayoutError('invalid-index', [`classroom ${entry.id} is both present and missing`])
  }
  const mismatches: string[] = []
  if (expected?.workspaceKey !== undefined && value.workspaceKey !== expected.workspaceKey) mismatches.push('workspaceKey')
  if (expected?.backupDateKey !== undefined && value.backupDateKey !== expected.backupDateKey) mismatches.push('backupDateKey')
  if (mismatches.length > 0) throw new WorkspaceBackupLayoutError('index-mismatch', mismatches)
  return value as unknown as WorkspaceBackupIndex
}

// ---------------------------------------------------------------------------
// 要約の形式判定(BK-4)
// ---------------------------------------------------------------------------

/** 要約(workspaceAutoBackupSummaries)の形式。layout が無い＝旧形式。知らない文字列＝'unknown'(読み手は進まない)。 */
export function resolveWorkspaceBackupSummaryLayout(summary: unknown): WorkspaceBackupSummaryLayout {
  const layout = isRecord(summary) ? summary.layout : undefined
  if (layout === undefined || layout === null || layout === '' || layout === WORKSPACE_BACKUP_LAYOUT_LEGACY) return WORKSPACE_BACKUP_LAYOUT_LEGACY
  if (layout === WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) return WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
  return 'unknown'
}

/** 要約が教室別形式のとき、その時点の Storage のフォルダ(間引きで丸ごと消す単位)。旧形式なら null。 */
export function resolveWorkspaceBackupTimePointPrefixForSummary(summary: unknown, workspaceKey: string, backupDateKey: string): string | null {
  if (resolveWorkspaceBackupSummaryLayout(summary) !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) return null
  return buildWorkspaceBackupTimePointPrefix(workspaceKey, backupDateKey)
}

// ---------------------------------------------------------------------------
// 全体の組み立て直し(AC-B1)
// ---------------------------------------------------------------------------

/** 目次の行から教室の項目(data 以外)を取り出す(目次だけにある項目を外す)。 */
export function toWorkspaceBackupClassroomMeta(entry: WorkspaceBackupIndexClassroom): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...entry }
  for (const field of INDEX_ONLY_CLASSROOM_FIELDS) delete meta[field]
  return meta
}

/**
 * 目次＋教室ごとの data から全体(WorkspaceSnapshot)を組み立て直す。教室の並びは目次の並び。
 * 目次にある教室の data が 1 つでも無ければ missing-classroom-file(一部だけの全体を作らない・INV-14)。
 * 目次に無い教室の data は使わない(別教室の混入を防ぐ・INV-08)。
 */
export function assembleWorkspaceBackupFromIndex(
  index: WorkspaceBackupIndex,
  classroomData: ReadonlyArray<{ classroomId: string; data: Record<string, unknown> }>,
): WorkspaceBackupSnapshot {
  const dataById = new Map<string, Record<string, unknown>>()
  for (const entry of classroomData) {
    if (!isRecord(entry.data)) throw new WorkspaceBackupLayoutError('invalid-classroom-file', [`data of ${entry.classroomId}`])
    dataById.set(entry.classroomId, entry.data)
  }
  const missing = index.classrooms.filter((entry) => !dataById.has(entry.id)).map((entry) => entry.id)
  if (missing.length > 0) throw new WorkspaceBackupLayoutError('missing-classroom-file', missing)
  const classrooms = index.classrooms.map((entry) => ({ ...toWorkspaceBackupClassroomMeta(entry), data: dataById.get(entry.id)! }) as WorkspaceBackupClassroomEntry)
  return buildWorkspaceBackupSnapshot({
    savedAt: index.savedAt,
    users: index.users,
    classrooms,
    missingClassroomIds: listWorkspaceBackupMissingClassroomIds(index),
  })
}

/**
 * 目次＋教室ファイル(JSON 文字列)から全体を組み立て直す(サーバー・ツール用)。hash を渡すと目次の sha256 と照合する(hash-mismatch)。
 * 各教室ファイルは 3 点照合(validateWorkspaceBackupClassroomFile)を通す。
 */
export function assembleWorkspaceBackupFromClassroomFiles(
  index: WorkspaceBackupIndex,
  files: ReadonlyArray<{ classroomId: string; json: string }>,
  hash?: (json: string) => string,
): WorkspaceBackupSnapshot {
  const jsonById = new Map(files.map((file) => [file.classroomId, file.json] as const))
  const classroomData: Array<{ classroomId: string; data: Record<string, unknown> }> = []
  for (const entry of index.classrooms) {
    const json = jsonById.get(entry.id)
    if (json === undefined) continue
    if (hash && hash(json) !== entry.sha256) throw new WorkspaceBackupLayoutError('hash-mismatch', [entry.id])
    const file = validateWorkspaceBackupClassroomFile(JSON.parse(json), { workspaceKey: index.workspaceKey, backupDateKey: index.backupDateKey, classroomId: entry.id })
    classroomData.push({ classroomId: entry.id, data: file.classrooms[0].data })
  }
  return assembleWorkspaceBackupFromIndex(index, classroomData)
}

// ---------------------------------------------------------------------------
// 取り残しの掃除(§10-6)
// ---------------------------------------------------------------------------

/**
 * 要約の無い時点フォルダ(書き終わる前に止まった取り残し)を消してよいか。
 * 要約がある・作成時刻が読めない・未来日時・1 日より新しいものは消さない(incident backup の間引きと同じ安全側の規則)。
 */
export function isOrphanedWorkspaceBackupFolder(params: { hasSummary: boolean; newestFileCreatedAtMs: number; nowMs: number; graceHours?: number }): boolean {
  if (params.hasSummary) return false
  if (!Number.isFinite(params.newestFileCreatedAtMs) || params.newestFileCreatedAtMs <= 0) return false
  const ageMs = params.nowMs - params.newestFileCreatedAtMs
  if (ageMs < 0) return false
  const graceHours = params.graceHours ?? WORKSPACE_BACKUP_ORPHAN_FOLDER_GRACE_HOURS
  return ageMs >= graceHours * 60 * 60 * 1000
}

export function stableStringifyWorkspaceBackupValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringifyWorkspaceBackupValue(entry)).join(',')}]`
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyWorkspaceBackupValue(objectValue[key])}`).join(',')}}`
}
