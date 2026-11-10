// 画面の自動巡回(tools/ui-patrol.mjs)の取得。本番(komahyouapp-prod)の自動バックアップを**読み取りだけ**で取る。
//
// ★読み取り専用(本番データ保護ルール・最重要)
//   - 通信は sendReadOnly() の 1 か所からだけ出す。出す前に必ず assertReadOnlyRequest を通す。
//     許すのは「Storage JSON API と Firestore REST への GET」「Firestore の :runQuery への POST(読み取り)」だけ。
//     PUT・PATCH・DELETE・:commit・:batchWrite・Cloud Functions(cloudfunctions.net)・知らないホストは throw。
//   - 取得した教室データ(実名入り)はメモリの中だけで扱う。この関数群はファイルを書かない。
// ★手順は docs/runbooks/morning-health-check.md §1〜§2 と同じ(最新の時点を引く → 教室ファイルを GET)。

export const DEFAULT_CLASSROOMS = [
  { id: '5w5OMueETerSKrSf14HC', label: '日大前校' },
  { id: 'KzFnOQoTFLsCxwUp1tvh', label: '緑が丘校' },
]

const PROJECT_ID = 'komahyouapp-prod'
const BUCKET = 'komahyouapp-prod.firebasestorage.app'
const WORKSPACE_KEY = 'main'
const FIRESTORE_HOST = 'firestore.googleapis.com'
const STORAGE_HOST = 'storage.googleapis.com'
const EXPECTED_LAYOUT = 'per-classroom-v1'

/** 最新の時点(savedAt の降順で 1 件)を引く :runQuery。読み取り。 */
export function buildLatestBackupKeyRequest() {
  return {
    url: `https://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/workspaces/${WORKSPACE_KEY}:runQuery`,
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'workspaceAutoBackupSummaries' }],
        orderBy: [{ field: { fieldPath: 'savedAt' }, direction: 'DESCENDING' }],
        limit: 1,
      },
    }),
  }
}

/** runQuery の結果から { key, layout }。結果が空なら null。 */
export function parseLatestBackupKey(json) {
  const first = Array.isArray(json) ? json.find((item) => item?.document?.name) : null
  if (!first) return null
  const key = String(first.document.name).split('/').pop()
  if (!key) return null
  return { key, layout: first.document.fields?.layout?.stringValue ?? '' }
}

export function buildClassroomBackupRequest(key, classroomId) {
  const objectPath = `workspace-auto-backups/${WORKSPACE_KEY}/15min/${key}/${classroomId}.json.gz`
  return { url: `https://${STORAGE_HOST}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`, method: 'GET' }
}

/** 読み取りでない通信・知らないホストへの通信なら throw する。道具の通信は必ずこれを通す。 */
export function assertReadOnlyRequest({ url, method = 'GET' }) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`読み取り専用ガード: URL を読めません: ${String(url).slice(0, 80)}`)
  }
  const verb = String(method).toUpperCase()
  if (parsed.protocol !== 'https:' || (parsed.hostname !== FIRESTORE_HOST && parsed.hostname !== STORAGE_HOST)) {
    throw new Error(`読み取り専用ガード: 許可していないホストへの通信です(${parsed.hostname})。`)
  }
  if (verb === 'GET') return
  if (verb === 'POST' && parsed.hostname === FIRESTORE_HOST && parsed.pathname.endsWith(':runQuery')) return
  throw new Error(`読み取り専用ガード: ${verb} ${parsed.hostname}${parsed.pathname.slice(-40)} は許可していません(GET と :runQuery だけ)。`)
}

/** 道具の通信が出る唯一の関数。 */
async function sendReadOnly({ url, method = 'GET', body }, token, fetchImpl) {
  assertReadOnlyRequest({ url, method })
  return fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}),
  })
}

function httpError(what, status) {
  const hint = status === 403 ? ' 読み取り専用トークンの権限を確かめてください。' : status === 404 ? ' その時点・教室のファイルがありません。' : ''
  return new Error(`${what}を取得できません(HTTP ${status})。${hint}`)
}

/** 最新の時点の key を引く。教室別の形(per-classroom-v1)でなければ止まる。 */
export async function fetchLatestBackupKey({ token, fetchImpl = fetch }) {
  const response = await sendReadOnly(buildLatestBackupKeyRequest(), token, fetchImpl)
  // 200 だけを成功とする(206 部分取得・204 空応答を黙って通さない)。
  if (response.status !== 200) throw httpError('最新のバックアップの時点', response.status)
  const latest = parseLatestBackupKey(await response.json())
  if (!latest) throw new Error('最新のバックアップの時点が見つかりません(結果が空です)。')
  if (latest.layout !== EXPECTED_LAYOUT) throw new Error(`最新のバックアップ(${latest.key})は教室別の形ではありません(layout=${latest.layout || '不明'})。`)
  return latest.key
}

/** 教室ファイル(gzip のまま)を取る。key 省略時は最新。取った中身はメモリの中だけ。 */
export async function fetchClassroomBackup({ token, classroomId, key, fetchImpl = fetch }) {
  const resolvedKey = key || await fetchLatestBackupKey({ token, fetchImpl })
  const response = await sendReadOnly(buildClassroomBackupRequest(resolvedKey, classroomId), token, fetchImpl)
  if (response.status !== 200) throw httpError(`教室 ${classroomId} のバックアップ(${resolvedKey})`, response.status)
  return { key: resolvedKey, buffer: Buffer.from(await response.arrayBuffer()) }
}
