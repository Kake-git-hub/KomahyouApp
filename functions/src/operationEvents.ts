// 操作ログ（在庫が減る・記録が消える操作の監査記録）のサーバー側正規化。
//
// クライアント（src/utils/operationLog.ts）が保存リクエストに載せて送ってくるイベントを、
// Firestore へ書く前に検証・整形する。**クライアントの自己申告を信用しない**のが役割:
//  - 実行者(updatedBy)と受領時刻(recordedAt)は呼び出し側（Cloud Function）が付ける。ここでは受け取らない。
//  - 想定外の巨大データ・入れ子オブジェクトを弾く（Firestore ドキュメントの肥大化・書き込み失敗を防ぐ）。
//  - 1リクエストあたりの件数を上限で切る（Firestore のバッチ上限 500 を超えないため）。
//
// 保持期間はオーナー確定で **1 年**（2026-09-04）。掃除は index.ts の定期クリーンアップが行う。

/** クライアントが送ってよい操作種別。ここに無い kind は捨てる（将来の種別追加はこの配列に足す）。 */
export const OPERATION_EVENT_KINDS = [
  'makeup-stock-delete',
  'lecture-stock-delete',
  'lesson-delete',
  'lesson-store',
  'status-mark',
  'status-clear',
  'clear-day-students',
  'whole-day-transfer',
  'holiday-toggle',
  'record-displaced',
] as const

export type OperationEventKind = (typeof OPERATION_EVENT_KINDS)[number]

export type NormalizedOperationEvent = {
  id: string
  at: string
  kind: OperationEventKind
  detail: Record<string, string | number | boolean>
}

/** 1回の保存で受け付けるイベント数の上限（Firestore バッチ上限 500 に対する余裕を持たせる）。 */
export const OPERATION_EVENT_REQUEST_LIMIT = 400
/** ドキュメント id に使うので、パス区切りなどを含まない安全な文字だけ許可する。 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const DETAIL_KEY_LIMIT = 24
const DETAIL_VALUE_LIMIT = 120

function normalizeDetail(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= DETAIL_KEY_LIMIT) break
    if (!DETAIL_KEY_PATTERN.test(key)) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) result[key] = trimmed.slice(0, DETAIL_VALUE_LIMIT)
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) result[key] = value
      continue
    }
    if (typeof value === 'boolean') result[key] = value
  }
  return result
}

function normalizeIsoTimestamp(raw: unknown, fallbackIso: string): string {
  if (typeof raw !== 'string') return fallbackIso
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso
}

/**
 * 受信した操作ログを正規化する。壊れた要素は**その要素だけ捨てて残りは通す**
 * （1件の不正で保存全体を失敗させない。保存本体より監査記録の優先度は低い）。
 * 同じ id が複数あれば最初の1件だけ残す（再送とバッチ内重複の両方に効く）。
 */
export function normalizeOperationEvents(raw: unknown, options: { fallbackIso?: string; limit?: number } = {}): NormalizedOperationEvent[] {
  if (!Array.isArray(raw)) return []
  const fallbackIso = options.fallbackIso ?? new Date().toISOString()
  const limit = options.limit ?? OPERATION_EVENT_REQUEST_LIMIT
  const kinds = new Set<string>(OPERATION_EVENT_KINDS)
  const seenIds = new Set<string>()
  const result: NormalizedOperationEvent[] = []

  for (const entry of raw) {
    if (result.length >= limit) break
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id : ''
    if (!SAFE_ID_PATTERN.test(id) || seenIds.has(id)) continue
    const kind = typeof candidate.kind === 'string' ? candidate.kind : ''
    if (!kinds.has(kind)) continue
    seenIds.add(id)
    result.push({
      id,
      at: normalizeIsoTimestamp(candidate.at, fallbackIso),
      kind: kind as OperationEventKind,
      detail: normalizeDetail(candidate.detail),
    })
  }

  return result
}
