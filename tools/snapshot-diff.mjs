// 2 つの時点の教室データを、生徒・コマ(机)単位で読み比べる読み取り専用ツール。
//
// ★なぜ作ったか(2026-10-22)
//   利用者報告や障害調査で「いつ・何が変わったか」を確かめるのに、これまでは Storage から gz を落として
//   JSON を目で読んでいた。盤面は週×コマ×机の入れ子で大きく、目視では差を取りこぼす。手元に落とした
//   2 ファイルを渡すと、名簿・講師・通常授業・講習・集団・自動割振ルール・ペア制約・教室設定・盤面(机単位)・
//   盤面の週セル外(在庫・補正・抑制など)の差を日本語で列挙する。
//
// ★読み取り専用(本番データ保護ルール準拠)
//   - ネットワークへは一切アクセスしない。入力は手元のファイル 2 つだけ。Firestore / Storage からの取得は
//     既存の手順(`export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)` と gsutil cp)で別に行う。
//   - ファイルを書かない(結果は標準出力だけ)。
//   - ★出力には生徒名・講師名が出る(開発者が手元で読むため・意図どおり)。出力をリポジトリ・Issue・公開ログへ貼らない。
//     入力ファイルもスクラッチ領域に置き、リポジトリへ入れない。
//
// 受け付ける入力(中身から自動判別。先頭が gzip のマジックバイト 1f 8b なら解凍してから読む。拡張子は問わない):
//   1. ワークスペース自動バックアップ  workspace-auto-backups/{ws}/.../*.json
//        { schemaVersion, savedAt, users, classrooms: [{ id, name, ..., data: AppSnapshotPayload }] }
//        functions/src/index.ts の toWorkspaceClassroom の出力形。教室データのキーは `data`
//        (念のため `snapshot` も読む。中身が保存文書の形でも payload の形でも受ける)。
//   2. 教室の直前ロールバック  workspace-latest-rollbacks/{ws}/classrooms/{id}/latest.json
//        { classroomId, sourceSavedAt, capturedAt, snapshot: FirebaseClassroomSnapshotDoc }
//        snapshot は createStoredSnapshotDoc の形で、`data` に payload が平文で入るか、
//        `dataEncoding === 'gzip-base64'` なら `compressedData` に gzip+base64 で入る(readStoredSnapshotPayload と同じ復号)。
//   3. 保存ごとの版履歴  classroom-save-history/{ws}/{classroomId}/....json.gz
//        2 と同じ形に `version` が付く(version が無くてもパスに classroom-save-history を含めば版履歴として扱う)。
//   4. 利用者報告の教室データ  developer-reports/{ws}/{classroomId}/{reportId}.json.gz
//        submitDeveloperReport が書く { reportId, workspaceKey, classroomId, classroomName, recordedAt, reportedAt,
//        appVersion, payload }(クライアントの snapshotPayload を `payload` キーで書く。`snapshotPayload` も読む)。
//   ほかに、教室スナップショット文書そのもの({ savedAt, data | dataEncoding+compressedData })と、
//   AppSnapshotPayload そのもの({ students, teachers, ..., boardState })も読める。
//   盤面の週は「cell 配列」と「{ cells: [...] }」(Firestore のネスト配列回避)の両形を受ける(deserializeBoardState と同じ)。
//
// 使い方:
//   node tools/snapshot-diff.mjs before.json.gz after.json.gz --classroom <id>
//   node tools/snapshot-diff.mjs <前のファイル> <後のファイル> [--classroom <classroomId>] [--json] [--limit <n>]
//   - 1 つ目が「前」、2 つ目が「後」。
//   - --classroom: ワークスペースバックアップから教室を選ぶ。教室が 1 つだけなら省略可。2〜4 の形は中に classroomId が
//     あるので省略可。指定したときは中の classroomId と一致するか検査し、違えば中止する(別教室のファイルを取り違えて
//     比べる事故を防ぐ。前後で教室が違う場合も中止する)。
//   - --json: 同じ内容を機械可読 JSON で出す。
//   - --limit: 盤面(机単位)の差分行の上限(既定 200・0 で無制限)。超えた分は「他 n 件」。
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { isInvokedDirectly } from './invoked-directly.mjs'

export const USAGE = '使い方: node tools/snapshot-diff.mjs <前のファイル> <後のファイル> [--classroom <classroomId>] [--json] [--limit <n>]'

/** 盤面差分の行数の既定上限。報告 1 件の調査で読み切れる量に抑える(超過は「他 n 件」)。 */
export const DEFAULT_BOARD_LIMIT = 200
/** 値の表示を切る長さ。テンプレや画像 dataURL など長い値で 1 行が埋まらないようにする。 */
export const VALUE_TEXT_LIMIT = 60
/** 配列要素の追加/削除をテキストで並べる上限(JSON 出力は全件)。 */
export const ARRAY_ITEM_TEXT_LIMIT = 20
/** 表示が同じ机の「内部項目の変化」を 1 行に並べる上限。 */
const HIDDEN_CHANGE_TEXT_LIMIT = 5
/** functions/src/index.ts の FIREBASE_COMPRESSED_SNAPSHOT_ENCODING と同じ値(サーバーの保存形と揃える)。 */
export const COMPRESSED_SNAPSHOT_ENCODING = 'gzip-base64'

export const FILE_KIND_LABELS = {
  'workspace-backup': 'ワークスペース自動バックアップ',
  'classroom-rollback': '教室の直前ロールバック',
  'save-history': '保存ごとの版履歴',
  'developer-report': '利用者報告の教室データ',
  'stored-snapshot': '教室スナップショット文書',
  payload: '教室データ(payload)',
}

const TIME_FIELD_LABELS = {
  sourceSavedAt: '元の保存時刻',
  savedAt: '保存時刻',
  capturedAt: '控えた時刻',
  recordedAt: '受領時刻',
  reportedAt: '報告時刻(端末)',
  updatedAt: '更新時刻',
}

// 前後の時点の新旧を比べるときに見る順(「その教室データがいつの保存か」に近いものを先に)。
const PRIMARY_TIME_FIELDS = ['sourceSavedAt', 'savedAt', 'recordedAt', 'reportedAt', 'capturedAt', 'updatedAt']

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { files: [], classroomId: '', json: false, limit: DEFAULT_BOARD_LIMIT, help: false, unknown: [], missingValue: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--classroom') {
      const value = argv[++index]
      if (typeof value === 'string') options.classroomId = value.trim()
      else options.missingValue.push(arg)
      continue
    }
    if (arg === '--limit') {
      const value = argv[++index]
      if (typeof value === 'string') options.limit = Number(value)
      else options.missingValue.push(arg)
      continue
    }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg.startsWith('--')) { options.unknown.push(arg); continue }
    options.files.push(arg)
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (options.files.length !== 2) errors.push(`比べるファイルを 2 つ指定してください(指定 ${options.files.length} 個)。`)
  for (const flag of options.missingValue ?? []) errors.push(`${flag} に値がありません。`)
  if (!Number.isInteger(options.limit) || options.limit < 0) errors.push('--limit は 0 以上の整数で指定してください(0 は無制限)。')
  for (const flag of options.unknown ?? []) errors.push(`知らないオプションです: ${flag}`)
  return errors
}

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** キー順に依らない比較用の文字列化(functions/src/index.ts の stableStringify と同じ考え方)。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry) ?? 'null').join(',')}]`
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/** 長い値を `limit` 字(省略記号込み)で切る。サロゲートペアを割らないよう Array.from で数える。 */
export function truncateText(text, limit = VALUE_TEXT_LIMIT) {
  const value = String(text)
  const chars = Array.from(value)
  if (limit <= 0 || chars.length <= limit) return value
  return `${chars.slice(0, limit - 1).join('')}…`
}

function oneLine(text) {
  return String(text).replace(/\r?\n/g, '⏎')
}

/** ISO 時刻を「YYYY-MM-DD HH:mm:ss JST」にする。読めない値はそのまま返す(手元の調査で原文を失わない)。 */
export function formatJstDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const jst = new Date(ms + 9 * 60 * 60 * 1000).toISOString()
  return `${jst.slice(0, 10)} ${jst.slice(11, 19)} JST`
}

// ---------------------------------------------------------------------------
// ファイルの復号と種別判定
// ---------------------------------------------------------------------------

export function isGzipBuffer(buffer) {
  return Boolean(buffer) && buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

/**
 * ファイルの中身(Buffer)を JSON として読む。gzip なら解凍してから読む。
 * gsutil は Content-Encoding: gzip の物を自動解凍して落とすことがあるので、拡張子ではなく先頭バイトで判定する。
 */
export function decodeJsonBuffer(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const raw = isGzipBuffer(source) ? gunzipSync(source) : source
  return JSON.parse(raw.toString('utf8').replace(/^﻿/, ''))
}

const PAYLOAD_ARRAY_KEYS = ['students', 'teachers', 'managers', 'regularLessons', 'groupLessons', 'specialSessions', 'autoAssignRules', 'pairConstraints']

/** AppSnapshotPayload らしいか(名簿などの配列か boardState / classroomSettings を持つ)。 */
export function isPayloadLike(value) {
  return isPlainObject(value)
    && (PAYLOAD_ARRAY_KEYS.some((key) => Array.isArray(value[key])) || 'boardState' in value || isPlainObject(value.classroomSettings))
}

function isStoredSnapshotDocLike(value) {
  return isPlainObject(value)
    && (isPlainObject(value.data) || typeof value.compressedData === 'string' || value.dataEncoding === COMPRESSED_SNAPSHOT_ENCODING)
}

/**
 * ファイルの種別を中身から判定する。`fileName` はロールバックと版履歴の見分けの補助にだけ使う
 * (版履歴は形がロールバックと同じで、`version` が無い版が混ざっても取り違えないように)。
 * @returns {'workspace-backup'|'classroom-rollback'|'save-history'|'developer-report'|'stored-snapshot'|'payload'|'unknown'}
 */
export function detectSnapshotFileKind(doc, fileName = '') {
  if (!isPlainObject(doc)) return 'unknown'
  if (Array.isArray(doc.classrooms)) return 'workspace-backup'
  if (typeof doc.reportId === 'string' && ('payload' in doc || 'snapshotPayload' in doc)) return 'developer-report'
  if (typeof doc.classroomId === 'string' && isPlainObject(doc.snapshot)) {
    if (typeof doc.version === 'number' || String(fileName).includes('classroom-save-history')) return 'save-history'
    return 'classroom-rollback'
  }
  if (isStoredSnapshotDocLike(doc)) return 'stored-snapshot'
  if (isPayloadLike(doc)) return 'payload'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// payload の取り出し(functions/src/index.ts の deserializeBoardState / readStoredSnapshotPayload と同じ復号)
// ---------------------------------------------------------------------------

/** 盤面の週を「cell 配列の配列」に揃える。保存形は週ごとに cell 配列か `{ cells: [...] }`。 */
export function normalizeBoardState(boardState) {
  if (!isPlainObject(boardState)) return null
  const weeks = asArray(boardState.weeks).map((week) => {
    if (Array.isArray(week)) return week
    return isPlainObject(week) && Array.isArray(week.cells) ? week.cells : []
  })
  return { ...boardState, weeks }
}

export function normalizeSnapshotPayload(payload) {
  if (!isPlainObject(payload)) return null
  return { ...payload, boardState: normalizeBoardState(payload.boardState) }
}

/**
 * 保存文書(createStoredSnapshotDoc の形)から payload を取り出す。
 * 平文は `data`、圧縮は `dataEncoding: 'gzip-base64'` ＋ `compressedData`(サーバー実装)。
 * 圧縮時に `data` 側へ文字列で入っている形も念のため読む(新しい保存形が来ても黙って空にしない)。
 */
export function readStoredSnapshotPayload(snapshot) {
  if (!isPlainObject(snapshot)) return null
  if (isPlainObject(snapshot.data)) return normalizeSnapshotPayload(snapshot.data)
  if (snapshot.dataEncoding === COMPRESSED_SNAPSHOT_ENCODING) {
    const encoded = trimmedString(snapshot.compressedData) || trimmedString(snapshot.data)
    if (encoded) return normalizeSnapshotPayload(JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')))
  }
  return null
}

function coerceToPayload(value) {
  if (isStoredSnapshotDocLike(value) && !isPayloadLike(value)) return readStoredSnapshotPayload(value)
  return normalizeSnapshotPayload(value)
}

function readEmbeddedClassroomId(doc, kind) {
  if (kind === 'classroom-rollback' || kind === 'save-history' || kind === 'developer-report') return trimmedString(doc?.classroomId)
  return ''
}

function describeClassroomList(classrooms) {
  if (classrooms.length === 0) return '(教室なし)'
  return classrooms.map((classroom) => `${classroom.id}${classroom.name ? `(${classroom.name})` : ''}`).join(', ')
}

/**
 * 前後のファイルから比べる教室を決める。
 * - --classroom 指定時: 中に classroomId を持つファイルがそれと違えば中止。
 * - 未指定時: 中に classroomId を持つファイルから採る(前後で違えば中止)。どちらにも無ければ空文字
 *   (ワークスペースバックアップ側で「教室が 1 つだけなら採る」に任せる)。
 * @param {Array<{ label: string, doc: unknown, kind: string }>} entries
 */
export function resolveTargetClassroomId(entries, requestedClassroomId = '') {
  const requested = trimmedString(requestedClassroomId)
  const embedded = []
  for (const entry of entries) {
    const id = readEmbeddedClassroomId(entry.doc, entry.kind)
    if (!id) continue
    if (requested && id !== requested) {
      throw new Error(`${entry.label}のファイルは教室 ${id} のデータです(--classroom ${requested} と一致しません)。比べる教室を確かめてください。`)
    }
    embedded.push({ label: entry.label, id })
  }
  if (requested) return requested
  const distinct = [...new Set(embedded.map((entry) => entry.id))]
  if (distinct.length > 1) {
    throw new Error(`前後のファイルで教室が違います(${embedded.map((entry) => `${entry.label}=${entry.id}`).join(' / ')})。同じ教室のファイルを指定してください。`)
  }
  return distinct[0] ?? ''
}

function pickTimes(source) {
  return Object.entries(source)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => ({ key, label: TIME_FIELD_LABELS[key] ?? key, iso: value, jst: formatJstDateTime(value) }))
}

/**
 * 1 ファイル分の中身から、比べる教室の payload と時点情報を取り出す。
 * @param {unknown} doc decodeJsonBuffer の結果
 * @param {{ classroomId?: string, kind?: string, file?: string }} [options]
 * @returns {{ file: string, kind: string, kindLabel: string, classroomId: string, classroomName: string,
 *   times: Array<{ key: string, label: string, iso: string, jst: string }>, version: number|null, appVersion: string, payload: object }}
 */
export function extractClassroomSnapshot(doc, options = {}) {
  const file = options.file ?? ''
  const kind = options.kind ?? detectSnapshotFileKind(doc, file)
  const requested = trimmedString(options.classroomId)
  const base = { file, kind, kindLabel: FILE_KIND_LABELS[kind] ?? kind, classroomId: '', classroomName: '', times: [], version: null, appVersion: '' }

  const assertSameClassroom = (embeddedId) => {
    if (requested && embeddedId && embeddedId !== requested) {
      throw new Error(`${file || 'ファイル'} は教室 ${embeddedId} のデータです(--classroom ${requested} と一致しません)。`)
    }
  }

  let result
  if (kind === 'workspace-backup') {
    const classrooms = doc.classrooms.filter(isPlainObject)
    let classroom = null
    if (requested) {
      classroom = classrooms.find((entry) => entry.id === requested) ?? null
      if (!classroom) throw new Error(`${file || 'ワークスペースバックアップ'} に教室 ${requested} がありません。含まれる教室: ${describeClassroomList(classrooms)}`)
    } else if (classrooms.length === 1) {
      classroom = classrooms[0]
    } else {
      throw new Error(`${file || 'ワークスペースバックアップ'} に教室が ${classrooms.length} 個あります。--classroom で選んでください: ${describeClassroomList(classrooms)}`)
    }
    result = {
      ...base,
      classroomId: trimmedString(classroom.id),
      classroomName: trimmedString(classroom.name),
      times: pickTimes({ savedAt: doc.savedAt }),
      payload: coerceToPayload(classroom.data ?? classroom.snapshot),
    }
  } else if (kind === 'classroom-rollback' || kind === 'save-history') {
    assertSameClassroom(trimmedString(doc.classroomId))
    const version = typeof doc.version === 'number' ? doc.version : (typeof doc.snapshot.version === 'number' ? doc.snapshot.version : null)
    result = {
      ...base,
      classroomId: trimmedString(doc.classroomId),
      times: pickTimes({ sourceSavedAt: doc.sourceSavedAt, savedAt: doc.snapshot.savedAt, capturedAt: doc.capturedAt }),
      version,
      payload: readStoredSnapshotPayload(doc.snapshot),
    }
  } else if (kind === 'developer-report') {
    assertSameClassroom(trimmedString(doc.classroomId))
    result = {
      ...base,
      classroomId: trimmedString(doc.classroomId),
      classroomName: trimmedString(doc.classroomName),
      times: pickTimes({ recordedAt: doc.recordedAt, reportedAt: doc.reportedAt }),
      appVersion: trimmedString(doc.appVersion),
      payload: normalizeSnapshotPayload(doc.payload ?? doc.snapshotPayload),
    }
  } else if (kind === 'stored-snapshot') {
    // 保存文書そのものには classroomId が無い(Firestore の文書 id が教室 id)。--classroom の値を表示用に引き継ぐ。
    result = {
      ...base,
      classroomId: requested,
      times: pickTimes({ savedAt: doc.savedAt, updatedAt: doc.updatedAt }),
      version: typeof doc.version === 'number' ? doc.version : null,
      payload: readStoredSnapshotPayload(doc),
    }
  } else if (kind === 'payload') {
    result = { ...base, classroomId: requested, payload: normalizeSnapshotPayload(doc) }
  } else {
    throw new Error(`${file || 'ファイル'} の形を判別できません(ワークスペースバックアップ／直前ロールバック／版履歴／利用者報告／保存文書／payload のどれでもない)。`)
  }

  if (!result.payload) throw new Error(`${file || 'ファイル'}(${result.kindLabel})から教室データ(payload)を取り出せませんでした。`)
  return result
}

// ---------------------------------------------------------------------------
// 値の差分(行・設定・週セル外で共通)
// ---------------------------------------------------------------------------

// 末尾が token の項目(保護者 QR の parentPortalToken・盤面共有の boardShareToken など)はベアラートークン。
// 手元の出力でも値は出さず「伏せ字」にする(出力が誤って貼られても使えないように)。
const SENSITIVE_KEY_PATTERN = /token$/i
// 生徒/講師 id を持つ項目(teacherId・student1Id・studentIds・personAId など)。名前を添えて読みやすくする。
const ID_FIELD_PATTERN = /(^id|Id|Ids)$/

function createEmptyNameIndex() {
  return { students: new Map(), teachers: new Map() }
}

/** 生徒/講師の id → 名前。先に渡した payload の名前を優先する(後の時点の名前を優先させるため、後→前の順で渡す)。 */
export function buildNameIndex(...payloads) {
  const index = createEmptyNameIndex()
  for (const payload of payloads) {
    for (const [key, map] of [['students', index.students], ['teachers', index.teachers]]) {
      for (const row of asArray(payload?.[key])) {
        if (!isPlainObject(row) || typeof row.id !== 'string' || !row.id || map.has(row.id)) continue
        const name = trimmedString(row.name) || trimmedString(row.displayName)
        if (name) map.set(row.id, name)
      }
    }
  }
  return index
}

function describeIdValue(fieldName, value, names) {
  if (!names || typeof value !== 'string' || !value || !ID_FIELD_PATTERN.test(fieldName)) return null
  const lower = fieldName.toLowerCase()
  const maps = lower.includes('teacher') ? [names.teachers] : lower.includes('student') ? [names.students] : [names.students, names.teachers]
  for (const map of maps) {
    const name = map.get(value)
    if (name) return `${value}(${name})`
  }
  return null
}

/** 差分表示用に値を 1 行の文字列にする(空文字・未設定を区別し、長い値は切る)。 */
export function formatValue(value, options = {}) {
  const limit = options.limit ?? VALUE_TEXT_LIMIT
  if (value === undefined) return '(なし)'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (value === '') return '(空)'
    return truncateText(oneLine(describeIdValue(options.fieldName ?? '', value, options.names) ?? value), limit)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return truncateText(oneLine(stableStringify(value)), limit)
}

function maskValue(value) {
  if (value === undefined || value === null || value === '') return formatValue(value)
  return '(伏せ字・値あり)'
}

function joinPath(path, key) {
  return path ? `${path}.${key}` : String(key)
}

function lastPathSegment(path) {
  const segments = String(path).split('.')
  return segments[segments.length - 1] ?? ''
}

function orderedUnionKeys(before, after, fieldOrder) {
  const keys = []
  const seen = new Set()
  const push = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }
  const beforeKeys = before && typeof before === 'object' ? Object.keys(before) : []
  const afterKeys = after && typeof after === 'object' ? Object.keys(after) : []
  const present = new Set([...beforeKeys, ...afterKeys])
  for (const key of fieldOrder ?? []) if (present.has(key)) push(key)
  for (const key of beforeKeys) push(key)
  for (const key of afterKeys) push(key)
  return keys
}

function valueShape(value, arrayMode) {
  if (value === undefined || value === null) return 'missing'
  if (Array.isArray(value)) return arrayMode === 'index' ? 'array' : 'scalar'
  if (isPlainObject(value)) return 'object'
  return 'scalar'
}

/** 配列を「要素の多重集合」として比べ、追加/削除された要素を返す(並べ替えだけの変化は reorderedOnly)。 */
function diffArrayElements(beforeList, afterList, path, context, flags) {
  const fieldName = lastPathSegment(path)
  const remaining = new Map()
  for (const element of beforeList) {
    const key = stableStringify(element)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const added = []
  for (const element of afterList) {
    const key = stableStringify(element)
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else added.push(formatValue(element, { fieldName, names: context.names }))
  }
  const removed = []
  for (const element of beforeList) {
    const key = stableStringify(element)
    const count = remaining.get(key) ?? 0
    if (count <= 0) continue
    remaining.set(key, count - 1)
    removed.push(formatValue(element, { fieldName, names: context.names }))
  }
  return {
    path,
    kind: 'array',
    beforeCount: beforeList.length,
    afterCount: afterList.length,
    beforeMissing: flags.beforeMissing,
    afterMissing: flags.afterMissing,
    added,
    removed,
    reorderedOnly: added.length === 0 && removed.length === 0,
  }
}

function collectValueChanges(before, after, path, depth, context, out) {
  if (stableStringify(before) === stableStringify(after)) return
  const fieldName = lastPathSegment(path)
  if (SENSITIVE_KEY_PATTERN.test(fieldName)) {
    out.push({ path, before: maskValue(before), after: maskValue(after) })
    return
  }
  const beforeIsArray = Array.isArray(before)
  const afterIsArray = Array.isArray(after)
  if (context.arrayMode !== 'index' && (beforeIsArray || afterIsArray) && (beforeIsArray || before == null) && (afterIsArray || after == null)) {
    out.push(diffArrayElements(beforeIsArray ? before : [], afterIsArray ? after : [], path, context, { beforeMissing: !beforeIsArray, afterMissing: !afterIsArray }))
    return
  }
  const beforeShape = valueShape(before, context.arrayMode)
  const afterShape = valueShape(after, context.arrayMode)
  const containerShape = beforeShape === 'missing' ? afterShape : beforeShape
  const descendable = depth > 0
    && (containerShape === 'object' || containerShape === 'array')
    && (beforeShape === containerShape || beforeShape === 'missing')
    && (afterShape === containerShape || afterShape === 'missing')
  if (descendable) {
    const keys = orderedUnionKeys(before, after, path === '' ? context.fieldOrder : null)
    for (const key of keys) collectValueChanges(before?.[key], after?.[key], joinPath(path, key), depth - 1, context, out)
    return
  }
  out.push({ path, before: formatValue(before, { fieldName, names: context.names }), after: formatValue(after, { fieldName, names: context.names }) })
}

/**
 * 2 つの値の差を「パス: 前 → 後」の一覧にする。
 * - depth: オブジェクトを何段まで項目ごとに分けて比べるか(それより深い所は文字列化して比べる)。
 * - arrayMode: 'multiset'(既定)=配列は要素の追加/削除で出す／'index'=配列も添字ごとに分けて比べる(机の内部比較用)。
 * - fieldOrder: 最上位の項目を並べる順(名簿の主要項目を先に出す)。
 * @returns {Array<{ path: string, before: string, after: string } | { path: string, kind: 'array', beforeCount: number,
 *   afterCount: number, beforeMissing: boolean, afterMissing: boolean, added: string[], removed: string[], reorderedOnly: boolean }>}
 */
export function diffValues(before, after, options = {}) {
  const context = { arrayMode: options.arrayMode ?? 'multiset', names: options.names ?? null, fieldOrder: options.fieldOrder ?? [] }
  const out = []
  collectValueChanges(before, after, options.path ?? '', options.depth ?? 0, context, out)
  return out
}

// ---------------------------------------------------------------------------
// 行(名簿・講師・通常授業…)の差分
// ---------------------------------------------------------------------------

// StudentRow(basicDataModel.ts)の主要項目を先に出す。学年は birthDate から決まり、科目は通常授業(regularLessons)側に
// あるので名簿の項目には無い。保護者 QR のトークンは SENSITIVE_KEY_PATTERN で伏せる。
export const STUDENT_FIELD_ORDER = ['name', 'displayName', 'entryDate', 'withdrawDate', 'birthDate', 'isExternal', 'deletedAt', 'graduationWithdrawAutoFilledAt', 'email']
const TEACHER_FIELD_ORDER = ['name', 'displayName', 'entryDate', 'withdrawDate', 'subjectCapabilities', 'email']
const REGULAR_LESSON_FIELD_ORDER = ['schoolYear', 'dayOfWeek', 'slotNumber', 'teacherId', 'student1Id', 'subject1', 'startDate', 'endDate', 'student2Id', 'subject2', 'student2StartDate', 'student2EndDate']

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function weekdayLabel(dayOfWeek) {
  return Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6 ? `${WEEKDAY_LABELS[dayOfWeek]}曜` : `曜日${dayOfWeek ?? '?'}`
}

function nameOf(map, id) {
  if (typeof id !== 'string' || !id) return ''
  return map.get(id) || id
}

function rowName(row) {
  return trimmedString(row.name) || trimmedString(row.displayName) || trimmedString(row.label)
}

/** 名簿以外の行に付ける「人が読める見出し」。id だけでは何の行か分からないため。 */
const ROW_SECTIONS = [
  { key: 'students', label: '生徒(名簿)', fieldOrder: STUDENT_FIELD_ORDER, describe: (row) => rowName(row) },
  { key: 'teachers', label: '講師', fieldOrder: TEACHER_FIELD_ORDER, describe: (row) => rowName(row) },
  { key: 'managers', label: '室長', fieldOrder: ['name', 'email'], describe: (row) => rowName(row) },
  {
    key: 'regularLessons',
    label: '通常授業',
    fieldOrder: REGULAR_LESSON_FIELD_ORDER,
    describe: (row, names) => {
      const students = [[row.student1Id, row.subject1], [row.student2Id, row.subject2]]
        .filter(([id]) => typeof id === 'string' && id)
        .map(([id, subject]) => `${nameOf(names.students, id)} ${subject ?? ''}`.trim())
      const head = `${weekdayLabel(row.dayOfWeek)} ${row.slotNumber ?? '?'}限`
      const year = row.schoolYear ? ` (${row.schoolYear}年度)` : ''
      return `${[head, nameOf(names.teachers, row.teacherId) || '講師なし', ...students].join(' / ')}${year}`
    },
  },
  {
    key: 'specialSessions',
    label: '講習',
    fieldOrder: ['label', 'startDate', 'endDate'],
    describe: (row) => `${trimmedString(row.label)}${row.startDate || row.endDate ? ` ${row.startDate ?? ''}〜${row.endDate ?? ''}` : ''}`,
  },
  {
    key: 'groupLessons',
    label: '集団授業',
    fieldOrder: ['schoolYear', 'dayOfWeek', 'slotLabel', 'teacherId', 'subject', 'studentIds'],
    describe: (row, names) => `${weekdayLabel(row.dayOfWeek)} ${row.slotLabel ?? ''} ${nameOf(names.teachers, row.teacherId) || '講師なし'} ${row.subject ?? ''} 生徒${asArray(row.studentIds).length}名`.replace(/\s+/g, ' ').trim(),
  },
  { key: 'autoAssignRules', label: '自動割振ルール', fieldOrder: ['label', 'category', 'priorityScore'], describe: (row) => trimmedString(row.label) },
  {
    key: 'pairConstraints',
    label: 'ペア制約',
    fieldOrder: ['personAType', 'personAId', 'personBType', 'personBId', 'type', 'category'],
    describe: (row, names) => {
      const person = (type, id) => nameOf(type === 'teacher' ? names.teachers : names.students, id) || '?'
      return `${person(row.personAType, row.personAId)} × ${person(row.personBType, row.personBId)}`
    },
  },
]

/** 行を突き合わせるキー。通常は id、自動割振ルールは key。どちらも無ければ位置。重複は @2, @3… を付けて別行にする。 */
function indexRows(rows) {
  const map = new Map()
  rows.forEach((row, index) => {
    const base = isPlainObject(row)
      ? (trimmedString(row.id) || trimmedString(row.key) || `#${index}`)
      : `#${index}`
    let key = base
    for (let suffix = 2; map.has(key); suffix += 1) key = `${base}@${suffix}`
    map.set(key, row)
  })
  return map
}

/**
 * 行の配列(名簿など)を id で突き合わせ、追加・削除・変更を返す。
 * 変更は項目ごとに「前 → 後」(入れ子は 1 段まで分け、配列は要素の追加/削除で出す)。
 * @returns {{ added: Array<{ id: string, label: string }>, removed: Array<{ id: string, label: string }>,
 *   changed: Array<{ id: string, label: string, changes: ReturnType<typeof diffValues> }> }}
 */
export function diffRowCollection(beforeRows, afterRows, options = {}) {
  const names = options.names ?? createEmptyNameIndex()
  const describe = options.describe ?? ((row) => rowName(row))
  const label = (row) => {
    if (!isPlainObject(row)) return formatValue(row)
    try {
      return describe(row, names)
    } catch {
      // 見出しは読みやすさのための飾り。想定外の形の行でも差分本体は出す。
      return ''
    }
  }
  const beforeMap = indexRows(asArray(beforeRows))
  const afterMap = indexRows(asArray(afterRows))
  const added = []
  const removed = []
  const changed = []
  for (const [id, row] of afterMap) if (!beforeMap.has(id)) added.push({ id, label: label(row) })
  for (const [id, row] of beforeMap) if (!afterMap.has(id)) removed.push({ id, label: label(row) })
  for (const [id, afterRow] of afterMap) {
    if (!beforeMap.has(id)) continue
    const changes = diffValues(beforeMap.get(id), afterRow, { depth: 2, names, fieldOrder: options.fieldOrder ?? [] })
    if (changes.length > 0) changed.push({ id, label: label(afterRow), changes })
  }
  return { added, removed, changed }
}

// ---------------------------------------------------------------------------
// 盤面(机単位)の差分 — src/utils/operationTrace.ts の summarizeWeeksDiff と同じ考え方
// (表示に効く項目=講師・生徒・出欠・メモを文字列化して机ごとに比べる)。ここでは出欠の種別も出し、
// 表示が同じで内部項目(警告・割当元など)だけ変わった机も「内部項目が変化」として拾う。
// ---------------------------------------------------------------------------

const LESSON_TYPE_LABELS = { regular: '通常', makeup: '振替', special: '講習', extra: '増コマ', trial: '体験' }
const STATUS_LABELS = { attended: '出席', absent: '休み', 'absent-no-makeup': '振無休', moved: '移動', holiday: '休日' }

/** 生徒名に「#id」を添える(名簿の生徒 ID を優先。同名の生徒を取り違えないため・operationTrace と同じ)。 */
function formatStudentRef(name, managedStudentId, fallbackId) {
  const id = trimmedString(managedStudentId) || trimmedString(fallbackId)
  return `${trimmedString(name) || '(名前なし)'}${id ? `#${id}` : ''}`
}

function describeStudentEntry(student) {
  const makeupSource = trimmedString(student.makeupSourceLabel) || trimmedString(student.makeupSourceDate)
  const moveSource = trimmedString(student.sameDayMoveSourceLabel) || trimmedString(student.sameDayMoveSourceDate)
  const marks = [
    LESSON_TYPE_LABELS[student.lessonType] ?? trimmedString(student.lessonType),
    trimmedString(student.subject),
    makeupSource ? `振)${makeupSource}` : '',
    moveSource ? `移)${moveSource}` : '',
    trimmedString(student.specialSessionId) ? `講習:${student.specialSessionId}` : '',
    trimmedString(student.noteSuffix),
  ].filter(Boolean).join(' ')
  return `${formatStudentRef(student.name, student.managedStudentId, student.id)}(${marks})`
}

function describeStatusEntry(status) {
  const destination = trimmedString(status.moveDestinationDateKey)
    ? `移)${status.moveDestinationDateKey}${status.moveDestinationSlotNumber ? ` ${status.moveDestinationSlotNumber}限` : ''}`
    : ''
  const parts = [
    STATUS_LABELS[status.status] ?? (trimmedString(status.status) || '記録'),
    formatStudentRef(status.name, status.managedStudentId, status.studentId),
    trimmedString(status.subject),
    destination,
  ].filter(Boolean)
  return `[${parts.join(' ')}]`
}

/** 机 1 台を「講師: 枠1 / 枠2」の 1 行にする。枠は 生徒(種別 科目…)・[出欠 生徒 科目]・メモ を + でつなぐ。 */
export function describeDeskForDiff(desk) {
  if (!isPlainObject(desk)) return '(机なし)'
  const teacher = trimmedString(desk.teacher) || '講師なし'
  const studentSlots = asArray(desk.lesson?.studentSlots)
  const statusSlots = asArray(desk.statusSlots)
  const memoSlots = asArray(desk.memoSlots)
  const slots = [0, 1].map((index) => {
    const parts = []
    if (isPlainObject(studentSlots[index])) parts.push(describeStudentEntry(studentSlots[index]))
    if (isPlainObject(statusSlots[index])) parts.push(describeStatusEntry(statusSlots[index]))
    if (trimmedString(memoSlots[index])) parts.push(`メモ:${oneLine(memoSlots[index])}`)
    return parts.length > 0 ? parts.join(' + ') : '空'
  })
  const note = trimmedString(desk.lesson?.note) ? ` 注:${oneLine(desk.lesson.note)}` : ''
  return `${teacher}: ${slots.join(' / ')}${note}`
}

function isDeskVisiblyEmpty(desk) {
  if (!isPlainObject(desk)) return true
  if (trimmedString(desk.teacher)) return false
  if (asArray(desk.lesson?.studentSlots).some(isPlainObject)) return false
  if (asArray(desk.statusSlots).some(isPlainObject)) return false
  if (asArray(desk.memoSlots).some((memo) => trimmedString(memo))) return false
  return !trimmedString(desk.lesson?.note)
}

function indexBoardCells(weeks) {
  const map = new Map()
  for (const week of asArray(weeks)) {
    for (const cell of asArray(week)) {
      if (!isPlainObject(cell)) continue
      map.set(`${cell.dateKey ?? ''}#${cell.slotNumber ?? ''}`, cell)
    }
  }
  return map
}

function compareCells(left, right) {
  const dateOrder = String(left.dateKey ?? '').localeCompare(String(right.dateKey ?? ''))
  if (dateOrder !== 0) return dateOrder
  return (Number(left.slotNumber) || 0) - (Number(right.slotNumber) || 0)
}

function omitDesks(cell) {
  const rest = { ...cell }
  delete rest.desks
  return rest
}

/**
 * 前後の盤面(週 → コマ → 机)を机単位で比べる。並びは 日付 → 時限 → (コマ属性) → 机番号。
 * - 机: { scope: 'desk', dateKey, slotNumber, deskNumber, before, after }。表示が同じで内部項目だけ違えば hiddenChanges 付き。
 * - コマ: { scope: 'cell', change: 'added'|'removed'|'changed', ... }。週の範囲が広がった/狭まったときは
 *   コマ単位で 1 行にまとめ、中身のある机だけ机単位で出す(空の机を何百行も並べない)。
 */
export function diffBoardWeeks(beforeWeeks, afterWeeks) {
  const before = indexBoardCells(beforeWeeks)
  const after = indexBoardCells(afterWeeks)
  const keys = [...new Set([...before.keys(), ...after.keys()])]
    .sort((left, right) => compareCells(after.get(left) ?? before.get(left), after.get(right) ?? before.get(right)))
  const entries = []
  for (const key of keys) {
    const prevCell = before.get(key)
    const nextCell = after.get(key)
    const ref = nextCell ?? prevCell
    const where = { dateKey: String(ref.dateKey ?? ''), slotNumber: ref.slotNumber ?? null }

    if (!prevCell || !nextCell) {
      const desks = asArray(ref.desks)
      const filled = desks.map((desk, index) => ({ desk, index })).filter(({ desk }) => !isDeskVisiblyEmpty(desk))
      entries.push({ scope: 'cell', ...where, change: prevCell ? 'removed' : 'added', deskCount: desks.length, nonEmptyDeskCount: filled.length })
      for (const { desk, index } of filled) {
        entries.push({
          scope: 'desk',
          ...where,
          deskNumber: index + 1,
          before: prevCell ? describeDeskForDiff(desk) : '(机なし)',
          after: prevCell ? '(机なし)' : describeDeskForDiff(desk),
        })
      }
      continue
    }

    const prevDesks = asArray(prevCell.desks)
    const nextDesks = asArray(nextCell.desks)
    const cellChanges = diffValues(omitDesks(prevCell), omitDesks(nextCell), { depth: 1 })
    if (prevDesks.length !== nextDesks.length) cellChanges.push({ path: '机数', before: String(prevDesks.length), after: String(nextDesks.length) })
    if (cellChanges.length > 0) entries.push({ scope: 'cell', ...where, change: 'changed', changes: cellChanges })

    for (let index = 0; index < Math.max(prevDesks.length, nextDesks.length); index += 1) {
      const prevDesk = prevDesks[index]
      const nextDesk = nextDesks[index]
      if (stableStringify(prevDesk) === stableStringify(nextDesk)) continue
      // 机数の増減で増えた/消えた「空の机」は上の「机数」で数えたので、机単位では出さない。
      if ((prevDesk === undefined && isDeskVisiblyEmpty(nextDesk)) || (nextDesk === undefined && isDeskVisiblyEmpty(prevDesk))) continue
      const beforeText = prevDesk === undefined ? '(机なし)' : describeDeskForDiff(prevDesk)
      const afterText = nextDesk === undefined ? '(机なし)' : describeDeskForDiff(nextDesk)
      const entry = { scope: 'desk', ...where, deskNumber: index + 1, before: beforeText, after: afterText }
      if (beforeText === afterText) entry.hiddenChanges = diffValues(prevDesk, nextDesk, { depth: 8, arrayMode: 'index' })
      entries.push(entry)
    }
  }
  return entries
}

function summarizeWeeks(weeks) {
  const dateKeys = asArray(weeks).flatMap((week) => asArray(week).map((cell) => (isPlainObject(cell) ? String(cell.dateKey ?? '') : ''))).filter(Boolean).sort()
  return {
    weekCount: asArray(weeks).length,
    range: dateKeys.length > 0 ? `${dateKeys[0]}〜${dateKeys[dateKeys.length - 1]}` : '(なし)',
  }
}

/**
 * 盤面の週セル外(PersistedBoardState の weeks 以外: 通常授業の抑制・回数補正・手動振替・振替抑制・講習在庫・集団の割当など)を
 * 項目ごとに比べる。マップは 1 段下のキーごと、配列は要素の追加/削除で出す。
 * @returns {Array<{ key: string, changes: ReturnType<typeof diffValues> }>}
 */
export function diffBoardExtras(beforeBoard, afterBoard, options = {}) {
  const before = isPlainObject(beforeBoard) ? beforeBoard : {}
  const after = isPlainObject(afterBoard) ? afterBoard : {}
  const result = []
  for (const key of orderedUnionKeys(before, after, null)) {
    if (key === 'weeks') continue
    const changes = diffValues(before[key], after[key], { path: key, depth: 1, names: options.names ?? null })
    if (changes.length > 0) result.push({ key, changes })
  }
  return result
}

// ---------------------------------------------------------------------------
// 全体の差分と出力
// ---------------------------------------------------------------------------

// payload の最上位で、上の各節が受け持つ項目。それ以外(将来足される項目)は「その他の項目」で拾う。
// screen は最後に開いていた画面(UI 状態)で、データの差ではないので比べない。
const HANDLED_PAYLOAD_KEYS = new Set([...ROW_SECTIONS.map((section) => section.key), 'classroomSettings', 'boardState', 'screen'])

function describeSource(snapshot) {
  return {
    file: snapshot.file,
    kind: snapshot.kind,
    kindLabel: snapshot.kindLabel,
    classroomId: snapshot.classroomId,
    classroomName: snapshot.classroomName,
    times: snapshot.times,
    version: snapshot.version,
    appVersion: snapshot.appVersion,
  }
}

function primaryTimeMs(snapshot) {
  for (const key of PRIMARY_TIME_FIELDS) {
    const entry = snapshot.times.find((time) => time.key === key)
    const ms = entry ? Date.parse(entry.iso) : Number.NaN
    if (Number.isFinite(ms)) return ms
  }
  return Number.NaN
}

/**
 * extractClassroomSnapshot の結果 2 つから差分レポート(JSON 化できる素のオブジェクト)を作る。
 * 文字列化(--json 以外)は formatSnapshotDiffText に任せる。payload 本体はレポートに入れない(出力を小さく保つ)。
 * @param {{ limit?: number }} [options] limit: 盤面差分の行数上限(0 で無制限)
 */
export function buildSnapshotDiff(beforeSnapshot, afterSnapshot, options = {}) {
  const limit = options.limit ?? DEFAULT_BOARD_LIMIT
  const beforePayload = beforeSnapshot.payload ?? {}
  const afterPayload = afterSnapshot.payload ?? {}
  const names = buildNameIndex(afterPayload, beforePayload)

  const sections = ROW_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    ...diffRowCollection(beforePayload[section.key], afterPayload[section.key], { names, describe: section.describe, fieldOrder: section.fieldOrder }),
  }))

  const classroomSettings = diffValues(
    isPlainObject(beforePayload.classroomSettings) ? beforePayload.classroomSettings : {},
    isPlainObject(afterPayload.classroomSettings) ? afterPayload.classroomSettings : {},
    { depth: 2, names },
  )

  const beforeWeeks = asArray(beforePayload.boardState?.weeks)
  const afterWeeks = asArray(afterPayload.boardState?.weeks)
  const boardEntries = diffBoardWeeks(beforeWeeks, afterWeeks)
  const shownEntries = limit > 0 ? boardEntries.slice(0, limit) : boardEntries

  const boardExtras = diffBoardExtras(beforePayload.boardState, afterPayload.boardState, { names })

  const otherKeys = orderedUnionKeys(beforePayload, afterPayload, null).filter((key) => !HANDLED_PAYLOAD_KEYS.has(key))
  const otherChanges = otherKeys.flatMap((key) => diffValues(beforePayload[key], afterPayload[key], { path: key, depth: 1, names }))

  const warnings = []
  const beforeMs = primaryTimeMs(beforeSnapshot)
  const afterMs = primaryTimeMs(afterSnapshot)
  if (Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs < beforeMs) {
    warnings.push('「後」のファイルの時点が「前」より古い(引数の順を確かめる。差分の向きが逆になる)。')
  }
  if (!isPlainObject(beforePayload.boardState)) warnings.push('「前」のデータに盤面(boardState)がありません。')
  if (!isPlainObject(afterPayload.boardState)) warnings.push('「後」のデータに盤面(boardState)がありません。')

  const hasChanges = sections.some((section) => section.added.length + section.removed.length + section.changed.length > 0)
    || classroomSettings.length > 0
    || boardEntries.length > 0
    || boardExtras.length > 0
    || otherChanges.length > 0

  return {
    classroomId: afterSnapshot.classroomId || beforeSnapshot.classroomId || '',
    classroomName: afterSnapshot.classroomName || beforeSnapshot.classroomName || '',
    before: describeSource(beforeSnapshot),
    after: describeSource(afterSnapshot),
    warnings,
    hasChanges,
    sections,
    classroomSettings,
    board: {
      before: summarizeWeeks(beforeWeeks),
      after: summarizeWeeks(afterWeeks),
      totalCount: boardEntries.length,
      limit,
      entries: shownEntries,
      omittedCount: boardEntries.length - shownEntries.length,
    },
    boardExtras,
    otherChanges,
  }
}

function appendCapped(lines, items, prefix) {
  const shown = items.slice(0, ARRAY_ITEM_TEXT_LIMIT)
  for (const item of shown) lines.push(`${prefix}${item}`)
  if (items.length > shown.length) lines.push(`${prefix}… 他 ${items.length - shown.length} 件`)
}

function countLabel(missing, count) {
  return missing ? '(なし)' : `${count}件`
}

/** 1 つの変化を複数行にする(配列は追加 + / 削除 - を 1 要素 1 行で)。 */
export function formatChangeLines(change, indent = '') {
  const path = change.path || '(値)'
  if (change.kind !== 'array') return [`${indent}${path}: ${change.before} → ${change.after}`]
  const head = `${indent}${path}: ${countLabel(change.beforeMissing, change.beforeCount)} → ${countLabel(change.afterMissing, change.afterCount)}`
  if (change.reorderedOnly) return [`${head}(並び順のみ変化)`]
  const lines = [head]
  appendCapped(lines, change.added, `${indent}  + `)
  appendCapped(lines, change.removed, `${indent}  - `)
  return lines
}

/** 1 つの変化を 1 行に詰める(盤面の行の中で使う)。 */
export function formatChangeInline(change) {
  const path = change.path || '(値)'
  if (change.kind !== 'array') return `${path}: ${change.before} → ${change.after}`
  const counts = `${countLabel(change.beforeMissing, change.beforeCount)} → ${countLabel(change.afterMissing, change.afterCount)}`
  if (change.reorderedOnly) return `${path}: ${counts}(並び順のみ)`
  const parts = [
    change.added.length > 0 ? `+${change.added.slice(0, 3).join(', ')}${change.added.length > 3 ? ` 他${change.added.length - 3}` : ''}` : '',
    change.removed.length > 0 ? `-${change.removed.slice(0, 3).join(', ')}${change.removed.length > 3 ? ` 他${change.removed.length - 3}` : ''}` : '',
  ].filter(Boolean)
  return `${path}: ${counts} (${parts.join(' ')})`
}

/** 盤面の差分 1 件を「YYYY-MM-DD N限 机M: 前 → 後」の 1 行にする。 */
export function formatBoardEntry(entry) {
  const where = `${entry.dateKey} ${entry.slotNumber ?? '?'}限`
  if (entry.scope === 'cell') {
    if (entry.change === 'added') return `${where} (コマ): コマが増えた(机 ${entry.deskCount} 台・中身あり ${entry.nonEmptyDeskCount} 台)`
    if (entry.change === 'removed') return `${where} (コマ): コマが無くなった(机 ${entry.deskCount} 台・中身あり ${entry.nonEmptyDeskCount} 台)`
    return `${where} (コマ): ${entry.changes.map(formatChangeInline).join(' / ')}`
  }
  if (entry.hiddenChanges) {
    const shown = entry.hiddenChanges.slice(0, HIDDEN_CHANGE_TEXT_LIMIT).map(formatChangeInline)
    const rest = entry.hiddenChanges.length - shown.length
    return `${where} 机${entry.deskNumber}: 表示は同じ・内部項目が変化 (${shown.join(' / ')}${rest > 0 ? ` / 他${rest}件` : ''}) [${entry.after}]`
  }
  return `${where} 机${entry.deskNumber}: ${entry.before} → ${entry.after}`
}

function formatSourceLines(label, source) {
  const lines = [`${label}: ${source.kindLabel}${source.file ? `  ${source.file}` : ''}`]
  const meta = [
    ...source.times.map((time) => `${time.label}(${time.key}) ${time.jst}`),
    source.version !== null && source.version !== undefined ? `版 ${source.version}` : '',
    source.appVersion ? `アプリ ${source.appVersion}` : '',
  ].filter(Boolean)
  if (meta.length > 0) lines.push(`    ${meta.join(' / ')}`)
  return lines
}

/** buildSnapshotDiff の結果を、人が読む Markdown 風のプレーンテキストにする。 */
export function formatSnapshotDiffText(report) {
  const lines = []
  lines.push('# 教室データの差分(読み取り専用ツールの出力・生徒名を含む。リポジトリ・Issue・公開ログへ貼らない)')
  lines.push(`教室: ${report.classroomId || '(不明)'}${report.classroomName ? ` ${report.classroomName}` : ''}`)
  lines.push(...formatSourceLines('前', report.before))
  lines.push(...formatSourceLines('後', report.after))
  for (const warning of report.warnings) lines.push(`※ ${warning}`)

  if (!report.hasChanges) {
    lines.push('')
    lines.push('差分なし(比べた項目はすべて同じ)。')
    return lines.join('\n')
  }

  const unchanged = []
  for (const section of report.sections) {
    const total = section.added.length + section.removed.length + section.changed.length
    if (total === 0) {
      unchanged.push(section.label)
      continue
    }
    lines.push('')
    lines.push(`## ${section.label}: 追加 ${section.added.length} / 削除 ${section.removed.length} / 変更 ${section.changed.length}`)
    for (const row of section.added) lines.push(`  + 追加 #${row.id} ${row.label}`.trimEnd())
    for (const row of section.removed) lines.push(`  - 削除 #${row.id} ${row.label}`.trimEnd())
    for (const row of section.changed) {
      lines.push(`  ~ 変更 #${row.id} ${row.label}`.trimEnd())
      for (const change of row.changes) lines.push(...formatChangeLines(change, '      '))
    }
  }

  if (report.classroomSettings.length > 0) {
    lines.push('')
    lines.push(`## 教室設定: 変更 ${report.classroomSettings.length} 項目`)
    for (const change of report.classroomSettings) lines.push(...formatChangeLines(change, '  '))
  } else {
    unchanged.push('教室設定')
  }

  if (report.board.totalCount > 0) {
    lines.push('')
    lines.push(`## 盤面(机単位): ${report.board.totalCount} 件`)
    lines.push(`  週数 ${report.board.before.weekCount} → ${report.board.after.weekCount} / 範囲 ${report.board.before.range} → ${report.board.after.range}`)
    for (const entry of report.board.entries) lines.push(`  ${formatBoardEntry(entry)}`)
    if (report.board.omittedCount > 0) lines.push(`  … 他 ${report.board.omittedCount} 件(--limit で表示件数を増やせる・0 で無制限)`)
  } else {
    unchanged.push('盤面(机)')
  }

  if (report.boardExtras.length > 0) {
    lines.push('')
    lines.push(`## 盤面の週セル外: 変化あり ${report.boardExtras.length} 項目`)
    for (const extra of report.boardExtras) {
      lines.push(`  ■ ${extra.key}: 変化あり`)
      for (const change of extra.changes) lines.push(...formatChangeLines(change, '      '))
    }
  } else {
    unchanged.push('盤面の週セル外')
  }

  if (report.otherChanges.length > 0) {
    lines.push('')
    lines.push(`## その他の項目: 変更 ${report.otherChanges.length}`)
    for (const change of report.otherChanges) lines.push(...formatChangeLines(change, '  '))
  }

  if (unchanged.length > 0) {
    lines.push('')
    lines.push(`変化なし: ${unchanged.join(' / ')}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  try {
    const entries = options.files.map((file, index) => {
      const doc = decodeJsonBuffer(readFileSync(file))
      return { label: index === 0 ? '前' : '後', file, doc, kind: detectSnapshotFileKind(doc, file) }
    })
    const classroomId = resolveTargetClassroomId(entries, options.classroomId)
    const [before, after] = entries.map((entry) => extractClassroomSnapshot(entry.doc, { classroomId, kind: entry.kind, file: basename(entry.file) }))
    const report = buildSnapshotDiff(before, after, { limit: options.limit })
    console.log(options.json ? JSON.stringify(report, null, 2) : formatSnapshotDiffText(report))
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

// import しただけでは何も実行しない(テストから純関数だけを読むため・tools/invoked-directly.mjs)。
if (isInvokedDirectly(import.meta.url)) {
  main()
}
