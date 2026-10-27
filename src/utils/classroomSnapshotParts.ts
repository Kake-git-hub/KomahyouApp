// 週単位の分割保存(教室データ 1MiB 上限の恒久対策)の【共有純関数】= 分割・組み立て・週キー・ハッシュ入力・目次の検査。
// 正本仕様: docs/spec-save-restore.md §9(§9-3 保存形式・§9-5 読み込み・§9-9 掃除)、保証 docs/spec-invariants.md INV-14。
// 着手手順: docs/plan-2026-10-27-weekly-split-snapshot-handoff.md(段階 0)。
//
// ★このファイルの制約(必ず守る)
//   - **自己完結**(import 文 0 行・ビルド時メタ情報の参照・CommonJS の読み込み関数すべて禁止)。functions/scripts/sync-shared.mjs が
//     functions/src/generated/classroomSnapshotParts.ts へそのまま複製する(parentSchedule.ts と同じ作法)。
//     ズレは functions/src/classroomSnapshotParts.parity.test.ts が検出する。
//   - ハッシュ関数(ブラウザ crypto.subtle / Node crypto)と Firestore の読み書きは**外から渡す**(ここでは触らない)。
//   - 分割・組み立て・週キーの算出は**このモジュールだけ**が行う(§9-3-3・§9-5-1)。index.ts や workspaceStore.ts に
//     同じ計算を再実装しない(二重実装はドリフトの温床)。
//
// ★同一性の約束(§9-5-1・AC-1)
//   どんな教室データ P でも `assembleClassroomSnapshotPayload(splitClassroomSnapshotPayload(P))` は、今日の読み取り結果
//   `deserializeSnapshotPayload(sanitizeForFirestore(P))` と stableStringify が一致する(週は配列形・boardState null は null のまま・
//   未知のフィールドも残る・ui の「無い」と「null」を区別して残す)。これにより既存の読み手は無改修で動く。
//
// ★旧「分割保存」の名残(gzip-base64-chunked / split-documents・chunks / parts / boardWeeks)とは**別名**(snapshotParts)。
//   取り違えないため、この形式の印は目次の storageFormat: 'weekly-parts' だけで判定する。

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 目次(既存の classroomSnapshots/{id} 文書)に付ける形式の印。この印が無い文書は旧形式。 */
export const SNAPSHOT_PARTS_STORAGE_FORMAT = 'weekly-parts'
/** 目次の形式版。読み手が知らない版は組み立てない(fail-closed)。 */
export const SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION = 1
/** 部品のサブコレクション名(旧 chunks / parts / boardWeeks と別名)。 */
export const SNAPSHOT_PARTS_SUBCOLLECTION = 'snapshotParts'
/** 部品文書の encoding。圧縮はサーバーが level 9 で行う(§9-3-5)。 */
export const SNAPSHOT_PART_ENCODING = 'gzip-base64'
/** 全体ハッシュの入力に埋める形式名(§9-3-6)。 */
export const SNAPSHOT_PARTS_COMPOSITE_HASH_FORMAT = 'weekly-parts-v1'
/** 保存リクエストの新しい形(§9-4-1)の format 値。段階 C で使う。 */
export const SNAPSHOT_PARTS_SAVE_REQUEST_FORMAT = 'weekly-parts-v1'
/** コマが無い・日付が取れない週の週キー(§9-3-3)。 */
export const SNAPSHOT_PARTS_NODATE_WEEK_KEY = 'nodate'
/** 部品ごとの SHA-256 と全体ハッシュを saveAttempts に残すときの印(§9-3-6)。 */
export const SNAPSHOT_PARTS_HASH_SCHEME = 'parts-v1'
/** 参照が外れた旧版の部品を残す日数(§9-9・オーナー確定 Q3=3 日)。最低 1 日。 */
export const SNAPSHOT_PART_GC_GRACE_DAYS = 3
export const SNAPSHOT_PART_GC_MIN_GRACE_DAYS = 1

/**
 * 画面状態(ui)として目次へ平文で持つ boardState のフィールド(§9-3-2・**この固定リストだけ**)。
 * 未知のフィールドは ui に入れない(board 部品に残る)。
 */
export const SNAPSHOT_BOARD_UI_FIELDS = [
  'weekIndex',
  'selectedCellId',
  'selectedDeskIndex',
  'isLectureStockOpen',
  'isMakeupStockOpen',
  'studentScheduleRange',
  'teacherScheduleRange',
] as const
export type SnapshotBoardUiField = (typeof SNAPSHOT_BOARD_UI_FIELDS)[number]

export const SNAPSHOT_PART_KINDS = ['core', 'board', 'week'] as const
export type SnapshotPartKind = (typeof SNAPSHOT_PART_KINDS)[number]

export const SNAPSHOT_PART_KEY_CORE = 'core'
export const SNAPSHOT_PART_KEY_BOARD = 'board'
export const SNAPSHOT_PART_KEY_WEEK_PREFIX = 'week:'

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/**
 * 画面状態。キーが**無い**と **null** を区別して残す(同一性の約束)。
 * - screen: 教室データ直下の `screen`(あれば)。
 * - board: boardState の SNAPSHOT_BOARD_UI_FIELDS のうち存在したものだけ(boardState が null なら無し)。
 */
export type SnapshotUiState = {
  screen?: unknown
  board?: Partial<Record<SnapshotBoardUiField, unknown>>
}

export type SnapshotWeekPart = {
  /** 週キー(§9-3-3)。目次の中で一意。 */
  key: string
  /** 週の中身 = コマの配列(旧 `{ cells }` 形は配列に直してある)。 */
  cells: unknown[]
}

/** splitClassroomSnapshotPayload の結果。中身はすべて sanitize 済み。 */
export type SplitClassroomSnapshot = {
  /** 管理データ(boardState と screen を除いた教室データ全部・未知のフィールドも含む)。 */
  core: Record<string, unknown>
  /** 盤面の週以外(boardState から weeks と ui フィールドを除いた全部)。boardState が null なら null。 */
  board: Record<string, unknown> | null
  /** 週(目次の順 = boardState.weeks の順)。 */
  weeks: SnapshotWeekPart[]
  ui: SnapshotUiState
  hasBoardState: boolean
}

/** 目次の部品情報(§9-3-4)。 */
export type SnapshotPartInfo = {
  docId: string
  hash: string
  rawBytes: number
  storedBytes: number
}

export type SnapshotPartsManifestWeek = SnapshotPartInfo & { key: string }

export type SnapshotPartsLastWriter = 'save' | 'qr-submission' | 'provision'

/** 目次(classroomSnapshots/{id} 文書)の分割形式での項目(§9-3-4)。旧形式の data / compressedData は持たない。 */
export type SnapshotPartsManifest = {
  schemaVersion: number
  storageFormat: typeof SNAPSHOT_PARTS_STORAGE_FORMAT
  storageFormatVersion: number
  version?: number
  savedAt?: string
  updatedAt?: string
  updatedBy?: string
  saveId?: string
  compositeHash: string
  managementCount: number
  dataByteLength: number
  hasBoardState: boolean
  ui: SnapshotUiState
  parts: { core: SnapshotPartInfo; board?: SnapshotPartInfo }
  weeks: SnapshotPartsManifestWeek[]
  lastWriter: SnapshotPartsLastWriter
}

/** 部品文書(classroomSnapshots/{id}/snapshotParts/{docId})の項目(§9-3-5)。 */
export type SnapshotPartDoc = {
  classroomId: string
  kind: SnapshotPartKind
  key: string
  hash: string
  encoding: typeof SNAPSHOT_PART_ENCODING
  compressedData: string
  rawByteLength: number
  createdAt: string
  createdBy: string
  createdForVersion: number
  gcMarkedAt?: string | null
}

/** 目次が参照する部品 1 件(読み手が取りに行く単位)。順番は core → board → 週(目次の順)。 */
export type SnapshotPartReference = {
  partKey: string
  kind: SnapshotPartKind
  /** 週なら週キー。core / board は '-'。 */
  key: string
  docId: string
  hash: string
}

// ---------------------------------------------------------------------------
// sanitize(Firestore に書ける形へ・src/integrations/firebase/firestoreSanitize.ts と同じ規則)
// ---------------------------------------------------------------------------
// ★ここに写しを置く理由: 部品ハッシュは「sanitize 済みの中身」から計算する(§9-3-6)。クライアント(段階 C)とサーバーが
//   同じ sanitize を通さないとハッシュが食い違い、毎回全量送信になる。規則のズレは classroomSnapshotParts.test.ts が
//   firestoreSanitize.ts と突き合わせて検出する。

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeObjectEntriesForSnapshot(entries: Array<[string, unknown]>) {
  const sanitizedObject: Record<string, unknown> = {}
  entries.forEach(([key, entry]) => {
    const sanitizedEntry = sanitizeSnapshotValue(entry)
    if (typeof sanitizedEntry !== 'undefined') {
      sanitizedObject[key] = sanitizedEntry
    }
  })
  return sanitizedObject
}

/** 値 1 つを Firestore に書ける形へ(undefined は「無し」・配列内の undefined は null・Date は ISO・Set/Map は配列/オブジェクト)。 */
export function sanitizeSnapshotValue(value: unknown): unknown {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Set) return Array.from(value, (entry) => {
    const sanitizedEntry = sanitizeSnapshotValue(entry)
    return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
  })
  if (value instanceof Map) return sanitizeObjectEntriesForSnapshot(Array.from(value.entries()).map(([key, entry]) => [String(key), entry]))
  if (typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)) return null

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeSnapshotValue(entry)
      return typeof sanitizedEntry === 'undefined' ? null : sanitizedEntry
    })
  }

  if (isPlainObjectValue(value)) {
    return sanitizeObjectEntriesForSnapshot(Object.entries(value))
  }

  if (typeof value === 'object') {
    const jsonValue = typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as { toJSON: () => unknown }).toJSON()
      : null
    if (jsonValue !== null) return sanitizeSnapshotValue(jsonValue)

    const enumerableEntries = Object.entries(value as Record<string, unknown>)
    if (enumerableEntries.length > 0) return sanitizeObjectEntriesForSnapshot(enumerableEntries)
    return null
  }

  return value
}

// ---------------------------------------------------------------------------
// stableStringify(キーを並べ替えた決定的 JSON・functions/src/index.ts の stableStringify と同じ規則)
// ---------------------------------------------------------------------------

/** キーを辞書順に並べ替えた JSON 文字列。ハッシュの入力と同一性の比較に使う。 */
export function stableStringifySnapshotValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringifySnapshotValue(entry)).join(',')}]`
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringifySnapshotValue(objectValue[key])}`).join(',')}}`
}

// ---------------------------------------------------------------------------
// 週キー(§9-3-3)
// ---------------------------------------------------------------------------

/** 週 1 つの中身を配列形へ(旧 `{ cells }` 形は配列に・それ以外は空配列)。deserializeBoardState と同じ規則。 */
export function normalizeSnapshotWeekCells(week: unknown): unknown[] {
  if (Array.isArray(week)) return week
  if (week && typeof week === 'object' && Array.isArray((week as { cells?: unknown }).cells)) {
    return (week as { cells: unknown[] }).cells
  }
  return []
}

/**
 * 週キーの日付部分 = その週のコマの dateKey の最小値('YYYY-MM-DD' の文字列比較・boardWeekTrim.ts weekDateRange と同じ規則)。
 * コマが無い・日付が取れない週は 'nodate'。
 */
export function resolveSnapshotWeekBaseKey(cells: readonly unknown[]): string {
  let min = ''
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object') continue
    const dateKey = (cell as { dateKey?: unknown }).dateKey
    if (typeof dateKey !== 'string' || !dateKey) continue
    if (!min || dateKey < min) min = dateKey
  }
  return min || SNAPSHOT_PARTS_NODATE_WEEK_KEY
}

/**
 * 全週の週キー(順番は入力どおり)。同じ日付部分が 2 回以上出たら 2 回目以降を `~2`・`~3`… とする(目次の中で一意)。
 * 同じ入力には常に同じ結果(AC-3)。
 */
export function resolveSnapshotWeekKeys(weeks: readonly (readonly unknown[])[]): string[] {
  const seen = new Map<string, number>()
  return weeks.map((cells) => {
    const base = resolveSnapshotWeekBaseKey(cells)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}~${count}`
  })
}

/** 週キーから日付部分(`~n` を除いた部分)を返す。サーバーの申告キー検査(§9-4-4 2)に使う。 */
export function stripSnapshotWeekKeySuffix(weekKey: string): string {
  const index = weekKey.indexOf('~')
  return index < 0 ? weekKey : weekKey.slice(0, index)
}

export function buildSnapshotWeekPartKey(weekKey: string): string {
  return `${SNAPSHOT_PART_KEY_WEEK_PREFIX}${weekKey}`
}

/** 部品キー('core' / 'board' / 'week:{週キー}')を種類と週キーに分解する。形が違えば null。 */
export function parseSnapshotPartKey(partKey: string): { kind: SnapshotPartKind; key: string } | null {
  if (partKey === SNAPSHOT_PART_KEY_CORE) return { kind: 'core', key: '-' }
  if (partKey === SNAPSHOT_PART_KEY_BOARD) return { kind: 'board', key: '-' }
  if (partKey.startsWith(SNAPSHOT_PART_KEY_WEEK_PREFIX)) {
    const key = partKey.slice(SNAPSHOT_PART_KEY_WEEK_PREFIX.length)
    return key ? { kind: 'week', key } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// 部品文書 ID(§9-3-5)
// ---------------------------------------------------------------------------

/**
 * 部品文書の ID = `{kind}~{key}~v{版数}~{書き手 ID の先頭 12 文字}`(core / board の key は '-')。
 * 中身が変われば必ず新しい ID(版数か書き手が変わる)。Firestore の文書 ID に使えない文字('/')は書き手 ID から落とす。
 */
export function buildSnapshotPartDocId(params: { kind: SnapshotPartKind; key: string; version: number; writerId: string }): string {
  const writer = params.writerId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'unknown'
  const key = params.kind === 'week' ? params.key : '-'
  return `${params.kind}~${key}~v${Math.max(0, Math.floor(params.version))}~${writer}`
}

// ---------------------------------------------------------------------------
// 分割(§9-3-2)
// ---------------------------------------------------------------------------

/**
 * 教室データを core / board / 週 / ui に分ける。入力は先に sanitize する(undefined を落とす・配列内は null)ので、
 * 生の画面状態を渡してもサーバーと同じ中身・同じハッシュになる。
 */
export function splitClassroomSnapshotPayload(payload: unknown): SplitClassroomSnapshot {
  const sanitized = sanitizeSnapshotValue(payload)
  const source: Record<string, unknown> = isPlainObjectValue(sanitized) ? sanitized : {}

  const core: Record<string, unknown> = {}
  const ui: SnapshotUiState = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'boardState') continue
    if (key === 'screen') {
      ui.screen = value
      continue
    }
    core[key] = value
  }

  // boardState が null・未設定・オブジェクト以外なら「盤面なし」(今日の deserializeBoardState と同じ規則。配列は
  // オブジェクト扱いで通す=同一性の約束を厳密に守る。実データで配列になることはない)。
  const rawBoardState = source.boardState
  if (!rawBoardState || typeof rawBoardState !== 'object') {
    return { core, board: null, weeks: [], ui: normalizeSnapshotUiState(ui), hasBoardState: false }
  }

  const boardSource = rawBoardState as Record<string, unknown>
  const board: Record<string, unknown> = {}
  const boardUi: Partial<Record<SnapshotBoardUiField, unknown>> = {}
  const uiFieldSet = new Set<string>(SNAPSHOT_BOARD_UI_FIELDS)
  for (const [key, value] of Object.entries(boardSource)) {
    if (key === 'weeks') continue
    if (uiFieldSet.has(key)) {
      boardUi[key as SnapshotBoardUiField] = value
      continue
    }
    board[key] = value
  }
  ui.board = boardUi

  const rawWeeks = Array.isArray(boardSource.weeks) ? boardSource.weeks : []
  const normalizedWeeks = rawWeeks.map((week) => normalizeSnapshotWeekCells(week))
  const keys = resolveSnapshotWeekKeys(normalizedWeeks)
  const weeks = normalizedWeeks.map((cells, index) => ({ key: keys[index], cells }))

  return { core, board, weeks, ui: normalizeSnapshotUiState(ui), hasBoardState: true }
}

/**
 * ui は目次に**平文**で書く(部品は gzip JSON)。旧形式は JSON 化で NaN / -0 が null / 0 になるので、ui も JSON 往復で同じ正規化に
 * そろえる(そろえないと組み立て後の weekIndex が NaN になる・regression-reviewer L-1)。キーの有無・null は保たれる。
 */
export function normalizeSnapshotUiState(ui: SnapshotUiState): SnapshotUiState {
  return JSON.parse(JSON.stringify(ui)) as SnapshotUiState
}

/** 分割結果を「部品キー → 中身」の一覧にする(ハッシュ計算・送信の単位)。順番は core → board → 週。 */
export function listSnapshotPartContents(split: SplitClassroomSnapshot): Array<{ partKey: string; kind: SnapshotPartKind; key: string; content: unknown }> {
  const entries: Array<{ partKey: string; kind: SnapshotPartKind; key: string; content: unknown }> = [
    { partKey: SNAPSHOT_PART_KEY_CORE, kind: 'core', key: '-', content: split.core },
  ]
  if (split.hasBoardState && split.board) {
    entries.push({ partKey: SNAPSHOT_PART_KEY_BOARD, kind: 'board', key: '-', content: split.board })
  }
  for (const week of split.weeks) {
    entries.push({ partKey: buildSnapshotWeekPartKey(week.key), kind: 'week', key: week.key, content: week.cells })
  }
  return entries
}

// ---------------------------------------------------------------------------
// 組み立て(§9-5)
// ---------------------------------------------------------------------------

/**
 * core / board / 週 / ui から教室データを組み立てる(分割の逆)。週の順番は入力の順(日付順に並べ直さない・AC-2)。
 * 戻り値の形は今日の読み取り結果(deserializeSnapshotPayload)と同じ: boardState は常にキーがあり、無ければ null。
 */
export function assembleClassroomSnapshotPayload(input: {
  core: Record<string, unknown>
  board: Record<string, unknown> | null
  weeks: readonly (readonly unknown[])[]
  ui: SnapshotUiState
  hasBoardState: boolean
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...input.core }
  if (input.ui && Object.prototype.hasOwnProperty.call(input.ui, 'screen')) {
    payload.screen = input.ui.screen
  }
  if (!input.hasBoardState) {
    payload.boardState = null
    return payload
  }
  const boardState: Record<string, unknown> = { ...(input.board ?? {}) }
  const boardUi = input.ui?.board
  if (boardUi && typeof boardUi === 'object') {
    for (const field of SNAPSHOT_BOARD_UI_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(boardUi, field)) {
        boardState[field] = boardUi[field]
      }
    }
  }
  boardState.weeks = input.weeks.map((cells) => [...cells])
  payload.boardState = boardState
  return payload
}

// ---------------------------------------------------------------------------
// ハッシュの入力(§9-3-6)。SHA-256 そのものは外から渡す。
// ---------------------------------------------------------------------------

/** 部品ハッシュの入力 = stableStringify(sanitize 済みの中身)。週は配列形で渡す。 */
export function buildSnapshotPartHashInput(content: unknown): string {
  return stableStringifySnapshotValue(sanitizeSnapshotValue(content) ?? null)
}

/**
 * 全体ハッシュ(compositeHash)の入力。変わっていない部品を読まずに計算できるよう、部品ハッシュの一覧から作る。
 * weeks は [週キー, ハッシュ] の配列(順番 = 目次の順)。
 */
export function buildSnapshotCompositeHashInput(params: {
  ui: SnapshotUiState
  hasBoardState: boolean
  coreHash: string
  boardHash: string | null
  weeks: ReadonlyArray<readonly [string, string]>
}): string {
  return stableStringifySnapshotValue({
    f: SNAPSHOT_PARTS_COMPOSITE_HASH_FORMAT,
    ui: sanitizeSnapshotValue(params.ui) ?? {},
    hasBoardState: params.hasBoardState,
    core: params.coreHash,
    board: params.hasBoardState ? params.boardHash : null,
    weeks: params.weeks.map(([key, hash]) => [key, hash]),
  })
}

/** 目次からそのまま全体ハッシュの入力を作る(読み戻し検証・目次の整合確認に使う)。 */
export function buildSnapshotCompositeHashInputFromManifest(manifest: SnapshotPartsManifest): string {
  return buildSnapshotCompositeHashInput({
    ui: manifest.ui,
    hasBoardState: manifest.hasBoardState,
    coreHash: manifest.parts.core.hash,
    boardHash: manifest.parts.board?.hash ?? null,
    weeks: manifest.weeks.map((week) => [week.key, week.hash] as const),
  })
}

// ---------------------------------------------------------------------------
// 目次の判定と検査(§9-3-4・fail-closed)
// ---------------------------------------------------------------------------

/** その文書が分割形式の目次か(印 storageFormat だけで判定・旧形式の chunks / parts / boardWeeks とは無関係)。 */
export function isSnapshotPartsManifest(doc: unknown): doc is SnapshotPartsManifest {
  return Boolean(doc && typeof doc === 'object' && (doc as { storageFormat?: unknown }).storageFormat === SNAPSHOT_PARTS_STORAGE_FORMAT)
}

/** 部品文書 ID に使える文字(buildSnapshotPartDocId が作り得る形)。'/' などは Firestore のパスを壊すので目次の検査で落とす。 */
export const SNAPSHOT_PART_DOC_ID_PATTERN = /^[A-Za-z0-9_~.:-]+$/

function isPartInfo(value: unknown): value is SnapshotPartInfo {
  if (!value || typeof value !== 'object') return false
  const info = value as Record<string, unknown>
  return typeof info.docId === 'string' && SNAPSHOT_PART_DOC_ID_PATTERN.test(info.docId) && typeof info.hash === 'string' && info.hash.length > 0
}

/**
 * 目次の形を検査する。読み手が知らない形式版・知らない部品の種類・board の有無と hasBoardState の食い違い・
 * 週キーや文書 ID の重複は**すべて失敗**(空や一部欠けの教室を作らない・INV-14)。
 */
export function validateSnapshotPartsManifest(doc: unknown): { ok: true; manifest: SnapshotPartsManifest } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isSnapshotPartsManifest(doc)) return { ok: false, errors: ['storageFormat が weekly-parts ではない'] }
  const manifest = doc as Record<string, unknown>
  if (manifest.storageFormatVersion !== SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION) {
    errors.push(`storageFormatVersion=${String(manifest.storageFormatVersion)} はこの版では読めない(対応=${SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION})`)
  }
  if (typeof manifest.hasBoardState !== 'boolean') errors.push('hasBoardState が真偽値ではない')
  if (!manifest.ui || typeof manifest.ui !== 'object' || Array.isArray(manifest.ui)) errors.push('ui がオブジェクトではない')
  const parts = manifest.parts
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) {
    errors.push('parts がオブジェクトではない')
  } else {
    const partsRecord = parts as Record<string, unknown>
    for (const key of Object.keys(partsRecord)) {
      if (key !== SNAPSHOT_PART_KEY_CORE && key !== SNAPSHOT_PART_KEY_BOARD) errors.push(`知らない部品の種類 parts.${key}`)
    }
    if (!isPartInfo(partsRecord.core)) errors.push('parts.core が無い(docId / hash)')
    const hasBoardPart = typeof partsRecord.board !== 'undefined'
    if (hasBoardPart && !isPartInfo(partsRecord.board)) errors.push('parts.board の形が違う(docId / hash)')
    if (manifest.hasBoardState === true && !hasBoardPart) errors.push('hasBoardState=true なのに parts.board が無い')
    if (manifest.hasBoardState === false && hasBoardPart) errors.push('hasBoardState=false なのに parts.board がある')
  }
  if (!Array.isArray(manifest.weeks)) {
    errors.push('weeks が配列ではない')
  } else {
    const seenKeys = new Set<string>()
    const seenDocIds = new Set<string>()
    manifest.weeks.forEach((week, index) => {
      const weekKey = week && typeof week === 'object' ? (week as { key?: unknown }).key : undefined
      if (!isPartInfo(week) || typeof weekKey !== 'string' || !weekKey) {
        errors.push(`weeks[${index}] の形が違う(key / docId / hash)`)
        return
      }
      const typed = week as unknown as SnapshotPartsManifestWeek
      if (seenKeys.has(typed.key)) errors.push(`週キーが重複 ${typed.key}`)
      seenKeys.add(typed.key)
      if (seenDocIds.has(typed.docId)) errors.push(`週の文書 ID が重複 ${typed.docId}`)
      seenDocIds.add(typed.docId)
    })
    if (manifest.hasBoardState === false && manifest.weeks.length > 0) errors.push('hasBoardState=false なのに weeks がある')
  }
  if (typeof manifest.compositeHash !== 'string' || !manifest.compositeHash) errors.push('compositeHash が無い')
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: doc }
}

/** 目次が参照する部品の一覧(core → board → 週の順)。読み手はこの docId だけを取りに行く(サブコレクション全体は読まない)。 */
export function listSnapshotPartReferences(manifest: SnapshotPartsManifest): SnapshotPartReference[] {
  const refs: SnapshotPartReference[] = [
    { partKey: SNAPSHOT_PART_KEY_CORE, kind: 'core', key: '-', docId: manifest.parts.core.docId, hash: manifest.parts.core.hash },
  ]
  if (manifest.hasBoardState && manifest.parts.board) {
    refs.push({ partKey: SNAPSHOT_PART_KEY_BOARD, kind: 'board', key: '-', docId: manifest.parts.board.docId, hash: manifest.parts.board.hash })
  }
  for (const week of manifest.weeks) {
    refs.push({ partKey: buildSnapshotWeekPartKey(week.key), kind: 'week', key: week.key, docId: week.docId, hash: week.hash })
  }
  return refs
}

/** 目次から「部品キー → ハッシュ」を作る(クライアントの台帳・§9-4-2 / 保存の照合・§9-4-4)。 */
export function buildSnapshotPartHashMapFromManifest(manifest: SnapshotPartsManifest): Record<string, string> {
  const map: Record<string, string> = {}
  for (const ref of listSnapshotPartReferences(manifest)) map[ref.partKey] = ref.hash
  return map
}

// ---------------------------------------------------------------------------
// 組み立て失敗(fail-closed・INV-14)
// ---------------------------------------------------------------------------

export type SnapshotPartsAssemblyFailureReason = 'invalid-manifest' | 'missing-part' | 'hash-mismatch' | 'decode-failed' | 'invalid-part-content'

/**
 * 組み立てに失敗したときの例外。読み手は**空の教室データも一部だけの教室データも作らず**、この例外を伝える(§9-5-3)。
 * class は複製先(functions)でもそのまま使える(import 不要)。
 */
export class SnapshotPartsAssemblyError extends Error {
  readonly reason: SnapshotPartsAssemblyFailureReason
  readonly partKeys: string[]
  readonly details: string[]

  constructor(reason: SnapshotPartsAssemblyFailureReason, partKeys: string[], details: string[] = []) {
    super(`教室データを組み立てられませんでした(${reason}: ${partKeys.join(', ') || '-'})${details.length > 0 ? ` ${details.join(' / ')}` : ''}`)
    this.name = 'SnapshotPartsAssemblyError'
    this.reason = reason
    this.partKeys = partKeys
    this.details = details
  }
}

export function isSnapshotPartsAssemblyError(error: unknown): error is SnapshotPartsAssemblyError {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'SnapshotPartsAssemblyError')
}

/** 読み手(取りに行った結果)が渡す部品 1 件。content は解凍・JSON 解析済み。hash は中身から計算した部品ハッシュ。 */
export type SnapshotPartResolved = { content: unknown; hash: string }

/**
 * 目次と取得済みの部品から教室データを組み立てる(純関数)。
 * - 部品が 1 つでも無い → missing-part / ハッシュが目次と違う → hash-mismatch(どちらも例外・空にしない)。
 * - core / board は平文オブジェクト、週は配列でなければ invalid-part-content。
 */
export function assembleClassroomSnapshotFromParts(
  manifest: SnapshotPartsManifest,
  resolvePart: (ref: SnapshotPartReference) => SnapshotPartResolved | null | undefined,
): Record<string, unknown> {
  const refs = listSnapshotPartReferences(manifest)
  const missing: string[] = []
  const mismatched: string[] = []
  const invalid: string[] = []
  const resolved = new Map<string, unknown>()
  for (const ref of refs) {
    const part = resolvePart(ref)
    if (!part) {
      missing.push(ref.partKey)
      continue
    }
    if (part.hash !== ref.hash) {
      mismatched.push(ref.partKey)
      continue
    }
    if (ref.kind === 'week') {
      if (!Array.isArray(part.content)) {
        invalid.push(ref.partKey)
        continue
      }
    } else if (!isPlainObjectValue(part.content)) {
      invalid.push(ref.partKey)
      continue
    }
    resolved.set(ref.partKey, part.content)
  }
  if (missing.length > 0) throw new SnapshotPartsAssemblyError('missing-part', missing)
  if (mismatched.length > 0) throw new SnapshotPartsAssemblyError('hash-mismatch', mismatched)
  if (invalid.length > 0) throw new SnapshotPartsAssemblyError('invalid-part-content', invalid)

  return assembleClassroomSnapshotPayload({
    core: resolved.get(SNAPSHOT_PART_KEY_CORE) as Record<string, unknown>,
    board: manifest.hasBoardState ? (resolved.get(SNAPSHOT_PART_KEY_BOARD) as Record<string, unknown>) : null,
    weeks: manifest.weeks.map((week) => resolved.get(buildSnapshotWeekPartKey(week.key)) as unknown[]),
    ui: manifest.ui,
    hasBoardState: manifest.hasBoardState,
  })
}

/**
 * 読み手の共通手順(§9-5-2): 目次を検査 → 部品を取る → 解凍・ハッシュ照合 → 組み立て。
 * 部品が無い・合わないときは**目次を 1 回だけ読み直して**やり直し、それでも欠ければ例外(fail-closed)。
 * Firestore・解凍・SHA-256 は io で外から渡す(サーバー = getAll + zlib + crypto / クライアント = getDoc + DecompressionStream + crypto.subtle)。
 */
export async function readClassroomSnapshotFromParts(
  manifestDoc: unknown,
  io: {
    /** 文書 ID の並びに対応する部品文書(無ければ null)。 */
    fetchParts: (docIds: string[]) => Promise<Array<unknown | null>>
    /** 部品文書の中身を解凍・JSON 解析する(失敗は例外)。 */
    decodePart: (partDoc: unknown) => Promise<unknown> | unknown
    /** 部品ハッシュ(SHA-256・16 進)。入力は buildSnapshotPartHashInput の文字列。 */
    hash: (input: string) => Promise<string> | string
    /** 目次を読み直す(1 回だけ呼ばれる)。無ければ null。 */
    refetchManifest?: () => Promise<unknown | null>
  },
): Promise<Record<string, unknown>> {
  const attempt = async (doc: unknown): Promise<Record<string, unknown>> => {
    const validation = validateSnapshotPartsManifest(doc)
    if (!validation.ok) throw new SnapshotPartsAssemblyError('invalid-manifest', [], validation.errors)
    const manifest = validation.manifest
    const refs = listSnapshotPartReferences(manifest)
    const partDocs = await io.fetchParts(refs.map((ref) => ref.docId))
    const resolved = new Map<string, SnapshotPartResolved>()
    const decodeFailedKeys: string[] = []
    const decodeFailedDetails: string[] = []
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index]
      const partDoc = partDocs[index]
      if (!partDoc) continue
      try {
        const content = await io.decodePart(partDoc)
        const hash = await io.hash(buildSnapshotPartHashInput(content))
        resolved.set(ref.partKey, { content, hash })
      } catch (error) {
        decodeFailedKeys.push(ref.partKey)
        decodeFailedDetails.push(`${ref.partKey}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (decodeFailedKeys.length > 0) throw new SnapshotPartsAssemblyError('decode-failed', decodeFailedKeys, decodeFailedDetails)
    return assembleClassroomSnapshotFromParts(manifest, (ref) => resolved.get(ref.partKey))
  }

  try {
    return await attempt(manifestDoc)
  } catch (error) {
    // 読み取り中に目次が切り替わった可能性(新しい保存が部品を差し替えた)。目次を 1 回だけ読み直してやり直す。
    // 旧版の部品は最低 3 日残る(§9-9)ので普通は 1 回目で揃う。それでも欠ければ fail-closed。
    if (!isSnapshotPartsAssemblyError(error) || !io.refetchManifest) throw error
    if (error.reason !== 'missing-part' && error.reason !== 'hash-mismatch') throw error
    const refetched = await io.refetchManifest()
    // 読み直した文書が目次でない(一方通行なので実運用では起きない)・目次が変わっていない(同じ compositeHash)なら、
    // やり直しても同じ結果なので元の例外をそのまま伝える(全部品を 2 回読まない・元の原因を隠さない・regression-reviewer L-4)。
    if (!isSnapshotPartsManifest(refetched)) throw error
    if (isSnapshotPartsManifest(manifestDoc) && refetched.compositeHash === manifestDoc.compositeHash) throw error
    return attempt(refetched)
  }
}

// ---------------------------------------------------------------------------
// 送る部品の決め方(§9-4-2・§9-4-3・段階 C)
// ---------------------------------------------------------------------------

/**
 * 手元の部品ハッシュ(毎回中身から計算したもの)と台帳(読込・保存成功時に記録したサーバーの目次のハッシュ)を比べ、
 * 違う部品だけ送る。台帳が無ければ全量(sendMode='full')。★参照の同一性で計算を省かない(INV-02)のは呼び出し側の約束。
 */
export function resolveSnapshotPartsToSend(params: {
  currentHashes: Readonly<Record<string, string>>
  ledgerHashes: Readonly<Record<string, string>> | null
}): { sendMode: 'full' | 'delta'; sent: string[]; unchanged: Record<string, string> } {
  const keys = Object.keys(params.currentHashes)
  if (!params.ledgerHashes) return { sendMode: 'full', sent: keys, unchanged: {} }
  const sent: string[] = []
  const unchanged: Record<string, string> = {}
  for (const key of keys) {
    const ledgerHash = params.ledgerHashes[key]
    if (typeof ledgerHash === 'string' && ledgerHash === params.currentHashes[key]) {
      unchanged[key] = ledgerHash
    } else {
      sent.push(key)
    }
  }
  return { sendMode: 'delta', sent, unchanged }
}

// ---------------------------------------------------------------------------
// 掃除の判定(§9-9・AC-25)
// ---------------------------------------------------------------------------

export type SnapshotPartGcCandidate = { docId: string; gcMarkedAt?: string | null }
export type SnapshotPartGcActions = {
  /** 参照されておらず印が無い → 今の時刻で印を付ける。 */
  mark: string[]
  /** 参照されておらず印から猶予日数以上たった → 削除(呼び出し側は削除前に目次を読み直して再確認する)。 */
  remove: string[]
  /** 参照されているのに印がある(目次の巻き戻しで再び参照された) → 印を消す。 */
  unmark: string[]
}

/**
 * 旧版の部品の掃除(純関数)。目次が無い教室は呼び出し側が**何もしない**(referencedDocIds を null で渡すと全部 no-op)。
 * 猶予は最低 1 日(SNAPSHOT_PART_GC_MIN_GRACE_DAYS)。印の時刻が読めない部品は印を付け直す(消さない)。
 */
export function resolveSnapshotPartGcActions(params: {
  referencedDocIds: ReadonlySet<string> | null
  parts: readonly SnapshotPartGcCandidate[]
  nowIso: string
  graceDays?: number
}): SnapshotPartGcActions {
  const actions: SnapshotPartGcActions = { mark: [], remove: [], unmark: [] }
  if (!params.referencedDocIds) return actions
  const graceDays = Math.max(SNAPSHOT_PART_GC_MIN_GRACE_DAYS, params.graceDays ?? SNAPSHOT_PART_GC_GRACE_DAYS)
  const nowMs = Date.parse(params.nowIso)
  if (!Number.isFinite(nowMs)) return actions
  const graceMs = graceDays * 24 * 60 * 60 * 1000
  for (const part of params.parts) {
    const referenced = params.referencedDocIds.has(part.docId)
    const markedMs = typeof part.gcMarkedAt === 'string' && part.gcMarkedAt ? Date.parse(part.gcMarkedAt) : Number.NaN
    const hasMark = Number.isFinite(markedMs)
    if (referenced) {
      if (part.gcMarkedAt) actions.unmark.push(part.docId)
      continue
    }
    if (!hasMark) {
      actions.mark.push(part.docId)
      continue
    }
    if (nowMs - markedMs >= graceMs) actions.remove.push(part.docId)
  }
  return actions
}
