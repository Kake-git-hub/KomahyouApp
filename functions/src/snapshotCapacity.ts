// 教室スナップショット文書の容量(Firestore 1 文書 1MiB 上限)の見積もりと判定(2026-10-27)。
//
// ★なぜ作ったか
//   教室データは 1 文書(classroomSnapshots/{classroomId})に gzip+base64 でまるごと入れている。日大前校は
//   2026-10-26 17:58 に上限(1,048,576 バイト)を超え、以後の保存が全部 Firestore に拒否された。
//   拒否は HttpsError でない例外だったので、保存記録(saveAttempts)は status=started のまま止まり、
//   利用者の画面には「INTERNAL」(=通信の失敗に見える文言)が出て、開発者へのメールも飛ばなかった。
//   - 圧縮を最大(level 9)にして当面の余裕を作る(恒久対策=週単位の分割保存までのつなぎ)。
//   - 書き込みの失敗は理由つきで saveAttempts に残し、開発者へメールする。
//   - 保存ごとに使用率を記録し、上限に近づいたら(85%)知らせる。
//
// 文書サイズの数え方は Firestore の公式の計算方法(Storage size calculations)に合わせる:
//   文書名 = パスの各区切りの (UTF-8 バイト数 + 1) の和 + 16、文字列 = バイト数 + 1、整数/小数/時刻 = 8、
//   真偽/null = 1、マップ = 各フィールド (名前のバイト数 + 1 + 値) の和、配列 = 各値の和、文書全体 = 文書名 + フィールド + 32。
//   日大前校の実文書(2026-10-27 05:45 保存・受理済み)でこの式は 1,048,549 バイト(上限まで 27 バイト)と出る。

/** Firestore の 1 文書の上限(バイト)。 */
export const FIRESTORE_DOCUMENT_MAX_BYTES = 1024 * 1024
/**
 * 教室スナップショットの gzip 圧縮レベル。既定(6)より 5% ほど小さくなる(日大前校の実データで
 * 1,048,236 → 992,112 文字)。速さの差は 8MB で 0.1 秒ほど。読む側(gunzip)はレベルに関係なく読めるので変更は要らない。
 */
export const SNAPSHOT_GZIP_LEVEL = 9
/** この使用率以上で「上限が近い」と開発者へ知らせる。 */
export const SNAPSHOT_CAPACITY_WARNING_RATIO = 0.85

function utf8Bytes(value: string) {
  return Buffer.byteLength(value, 'utf8')
}

/** 値 1 つの保存サイズ(Firestore の計算方法)。undefined のフィールドは書かれないので 0。 */
export function estimateFirestoreValueBytes(value: unknown): number {
  if (value === undefined) return 0
  if (value === null) return 1
  if (typeof value === 'string') return utf8Bytes(value) + 1
  if (typeof value === 'number' || typeof value === 'bigint') return 8
  if (typeof value === 'boolean') return 1
  if (value instanceof Date) return 8
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + estimateFirestoreValueBytes(item), 0)
  if (typeof value === 'object') return estimateFirestoreFieldsBytes(value as Record<string, unknown>)
  return 0
}

/** フィールドの集まり(マップ・文書本体)の保存サイズ。 */
export function estimateFirestoreFieldsBytes(fields: Record<string, unknown>): number {
  let total = 0
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue
    total += utf8Bytes(name) + 1 + estimateFirestoreValueBytes(value)
  }
  return total
}

/** 文書 1 件の保存サイズ。documentPath はデータベース内の相対パス(例 workspaces/main/classroomSnapshots/abc)。 */
export function estimateFirestoreDocumentBytes(documentPath: string, fields: Record<string, unknown>): number {
  const nameBytes = documentPath.split('/').filter(Boolean).reduce((sum, segment) => sum + utf8Bytes(segment) + 1, 0) + 16
  return nameBytes + estimateFirestoreFieldsBytes(fields) + 32
}

/** 使用率(0〜)。小数 4 桁に丸める(記録用)。 */
export function resolveSnapshotCapacityRatio(documentBytes: number, maxBytes = FIRESTORE_DOCUMENT_MAX_BYTES): number {
  if (!Number.isFinite(documentBytes) || documentBytes <= 0 || maxBytes <= 0) return 0
  return Math.round((documentBytes / maxBytes) * 10000) / 10000
}

/** 上限を超えていれば true(書けば Firestore に拒否される)。 */
export function isSnapshotOverCapacity(documentBytes: number, maxBytes = FIRESTORE_DOCUMENT_MAX_BYTES): boolean {
  return documentBytes > maxBytes
}

/** 上限が近い(警告を出す)か。超えている場合も true。 */
export function isSnapshotNearCapacity(documentBytes: number, maxBytes = FIRESTORE_DOCUMENT_MAX_BYTES): boolean {
  return resolveSnapshotCapacityRatio(documentBytes, maxBytes) >= SNAPSHOT_CAPACITY_WARNING_RATIO
}

/**
 * Firestore の書き込み例外が「文書が大きすぎる」拒否かどうか。
 * 例: "Document '...' cannot be written because its size (1,048,601 bytes) exceeds the maximum allowed size of 1,048,576 bytes."
 */
export function isFirestoreDocumentTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /exceeds the maximum allowed size/i.test(message)
}

/**
 * 利用者向けの「容量超過」エラーに付ける安定マーカー。クライアント(src/utils/saveProgressMessages.ts の
 * SNAPSHOT_TOO_LARGE_ERROR_MARKER)と一致させること。版数衝突の STALE_SNAPSHOT と同じ作法。
 */
export const SNAPSHOT_TOO_LARGE_ERROR_MARKER = 'SNAPSHOT_TOO_LARGE'
