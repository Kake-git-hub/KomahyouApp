// 週単位の分割保存(docs/spec-save-restore.md §9)のクライアント側の読み手。目次(classroomSnapshots/{id}・storageFormat='weekly-parts')が
// 指す部品 snapshotParts/{docId} を並列 getDoc で取り、解凍(DecompressionStream)・SHA-256(crypto.subtle)で照合して教室データ全体へ組み立てる。
//
// - 分割・組み立て・週キー・目次の検査は共有純関数 src/utils/classroomSnapshotParts.ts(= functions 側の複製と同一)だけが行う。
//   ここはブラウザの解凍・ハッシュ・Firestore の取得を外から渡す薄い層(workspaceStore.ts が配線する)。
// - ★fail-closed(INV-14): 部品が 1 つでも欠ける・合わないときは例外。**空の教室データ(createEmptyClassroomPayload)にしない**。
//   旧実装は読めない形式を null → 空の教室として表示していたが、分割形式でこの道を作ると欠けた週がそのまま保存で消える。
// - Firestore への依存を持たない(getDoc 等は引数)ので、Node の vitest で解凍・照合・組み立てまで検証できる。
import {
  isSnapshotPartsAssemblyError,
  readClassroomSnapshotFromParts,
  SNAPSHOT_PART_ENCODING,
  SnapshotPartsAssemblyError,
} from '../../utils/classroomSnapshotParts'

export { isSnapshotPartsAssemblyError, SnapshotPartsAssemblyError }

/** 利用者に見せる文言(§9-5-3)。教室名は呼び出し側が添える。 */
export const SNAPSHOT_PARTS_LOAD_FAILED_MESSAGE = '教室データを読み込めませんでした。画面を再読み込みしてください。直らなければ開発者へ連絡してください。'

export function buildSnapshotPartsLoadFailedMessage(classroomName: string): string {
  const name = classroomName.trim()
  return name ? `教室「${name}」の${SNAPSHOT_PARTS_LOAD_FAILED_MESSAGE}` : SNAPSHOT_PARTS_LOAD_FAILED_MESSAGE
}

/**
 * 開発者の読み込みで、組み立てられなかった教室を一覧から外したときの案内(regression-reviewer M-2・2026-10-28)。
 * 室長は 1 教室なので読み込み全体を失敗にする(従来どおり)が、開発者は 1 教室の失敗で全教室が開けなくなるため、その教室だけ外す。
 * 外した教室は表示も保存もしない(INV-14)。
 */
export function buildSnapshotPartsLoadFailedClassroomsNotice(entries: ReadonlyArray<{ name: string }>): string {
  if (entries.length === 0) return ''
  const names = entries.map((entry) => `「${entry.name.trim() || '名称未設定の教室'}」`).join('・')
  return `教室 ${names} のデータを読み込めなかったため、この画面では開けません(一覧から外しています)。画面を再読み込みしても直らなければ、開発者へ連絡してください。`
}

/** 部品ハッシュ(SHA-256・16 進)をブラウザの crypto.subtle で計算する。無い環境(非 https など)は例外(照合を省いて読まない)。 */
export async function hashSnapshotPartInputInBrowser(input: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (!subtle) throw new Error('このブラウザでは教室データの照合ができません。Chrome か Edge の最新版でお使いください。')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 部品文書の中身を解凍して JSON 解析する(解凍関数は workspaceStore の gunzipBase64ToText を渡す)。形が違えば例外。 */
export async function decodeSnapshotPartDocInBrowser(partDoc: unknown, gunzipBase64ToText: (value: string) => Promise<string>): Promise<unknown> {
  if (!partDoc || typeof partDoc !== 'object') throw new Error('部品文書が空')
  const doc = partDoc as { encoding?: unknown; compressedData?: unknown }
  if (doc.encoding !== SNAPSHOT_PART_ENCODING) throw new Error(`部品文書の encoding が ${String(doc.encoding)}(対応=${SNAPSHOT_PART_ENCODING})`)
  if (typeof doc.compressedData !== 'string' || !doc.compressedData) throw new Error('部品文書に compressedData が無い')
  return JSON.parse(await gunzipBase64ToText(doc.compressedData)) as unknown
}

export type SnapshotPartsClientIo = {
  /** 部品文書 1 件の data()(無ければ null)。呼び出し側は並列に呼ばれる前提で実装する。 */
  getPartDoc: (docId: string) => Promise<unknown | null>
  /** 目次を読み直す(欠け・不一致のとき 1 回だけ)。無ければ null。 */
  getManifest: () => Promise<unknown | null>
  gunzipBase64ToText: (value: string) => Promise<string>
}

/**
 * 分割形式の目次から教室データ全体を組み立てる(クライアント)。戻り値の形は旧形式の読み取り結果と同じ
 * (deserializeSnapshotPayload 済みの形: 週は配列・boardState は null かオブジェクト)。失敗は SnapshotPartsAssemblyError。
 */
export async function readSnapshotPartsPayloadInBrowser(manifestDoc: unknown, io: SnapshotPartsClientIo): Promise<Record<string, unknown>> {
  return readClassroomSnapshotFromParts(manifestDoc, {
    fetchParts: (docIds) => Promise.all(docIds.map((docId) => io.getPartDoc(docId))),
    decodePart: (partDoc) => decodeSnapshotPartDocInBrowser(partDoc, io.gunzipBase64ToText),
    hash: hashSnapshotPartInputInBrowser,
    refetchManifest: io.getManifest,
  })
}
