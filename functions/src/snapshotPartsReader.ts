// 週単位の分割保存(docs/spec-save-restore.md §9)のサーバー側の読み手。目次(classroomSnapshots/{id}・storageFormat='weekly-parts')が
// 指す部品(snapshotParts/{docId})を取り、解凍・ハッシュ照合して教室データ全体へ組み立てる。
//
// - 分割・組み立て・週キー・ハッシュ入力・目次の検査は共有純関数(generated/classroomSnapshotParts.ts = src/utils の複製)だけが行う。
//   ここは Node の zlib / crypto と Firestore の取得(getAll)を外から渡す薄い層。
// - ★fail-closed(INV-14): 部品が 1 つでも欠ける・合わないときは例外(SnapshotPartsAssemblyError)。空の教室データも
//   一部だけの教室データも返さない。文書そのものが無いときだけ呼び出し側が null(新しい教室)にする。
// - 部品は目次が指す文書 ID だけを取りに行く(サブコレクション全体は読まない=掃除待ちの旧版まで読まないため・§9-5-4)。
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  isSnapshotPartsManifest,
  readClassroomSnapshotFromParts,
  SNAPSHOT_PART_ENCODING,
  SnapshotPartsAssemblyError,
} from './generated/classroomSnapshotParts'

export { isSnapshotPartsManifest, SnapshotPartsAssemblyError }

/** 部品ハッシュ(SHA-256・16 進)。入力は共有関数 buildSnapshotPartHashInput の文字列。 */
export function hashSnapshotPartInput(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * 部品文書の中身を解凍して JSON 解析する。encoding が gzip-base64 でない・compressedData が無い・解凍や解析に失敗 → 例外
 * (読み手は decode-failed として扱い、空にしない)。
 */
export function decodeSnapshotPartDoc(partDoc: unknown): unknown {
  if (!partDoc || typeof partDoc !== 'object') throw new Error('部品文書が空')
  const doc = partDoc as { encoding?: unknown; compressedData?: unknown }
  if (doc.encoding !== SNAPSHOT_PART_ENCODING) throw new Error(`部品文書の encoding が ${String(doc.encoding)}(対応=${SNAPSHOT_PART_ENCODING})`)
  if (typeof doc.compressedData !== 'string' || !doc.compressedData) throw new Error('部品文書に compressedData が無い')
  const json = gunzipSync(Buffer.from(doc.compressedData, 'base64')).toString('utf8')
  return JSON.parse(json) as unknown
}

export type SnapshotPartsFirestoreIo = {
  /** 文書 ID の並びに対応する部品文書の data()(無ければ null)。サーバーは firestore.getAll。 */
  fetchPartDocs: (docIds: string[]) => Promise<Array<unknown | null>>
  /** 目次を読み直す(欠け・不一致のとき 1 回だけ)。無ければ null。 */
  refetchManifest: () => Promise<unknown | null>
}

/**
 * 分割形式の目次から教室データ全体を組み立てる(非同期)。戻り値の形は旧形式の readStoredSnapshotPayload と同じ
 * (週は配列形・boardState は null か オブジェクト)。失敗は SnapshotPartsAssemblyError。
 */
export async function assembleSnapshotPartsManifest(manifestDoc: unknown, io: SnapshotPartsFirestoreIo): Promise<Record<string, unknown>> {
  return readClassroomSnapshotFromParts(manifestDoc, {
    fetchParts: io.fetchPartDocs,
    decodePart: decodeSnapshotPartDoc,
    hash: hashSnapshotPartInput,
    refetchManifest: io.refetchManifest,
  })
}

/** 組み立て失敗の原因文(ログ・開発者メール用。生徒名などの中身は含まない)。 */
export function describeSnapshotAssemblyFailure(error: unknown): string {
  if (error instanceof SnapshotPartsAssemblyError || (error && typeof error === 'object' && (error as { name?: unknown }).name === 'SnapshotPartsAssemblyError')) {
    const typed = error as SnapshotPartsAssemblyError
    return `${typed.reason}: ${typed.partKeys.join(', ') || '-'}${typed.details.length > 0 ? ` (${typed.details.join(' / ')})` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}
