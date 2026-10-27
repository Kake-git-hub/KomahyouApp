import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  classifySnapshotWriteFailure,
  estimateFirestoreDocumentBytes,
  estimateFirestoreFieldsBytes,
  estimateFirestoreValueBytes,
  FIRESTORE_DOCUMENT_MAX_BYTES,
  isFirestoreDocumentTooLargeError,
  isSnapshotNearCapacity,
  isSnapshotOverCapacity,
  resolveSnapshotCapacityRatio,
  SNAPSHOT_CAPACITY_WARNING_RATIO,
  SNAPSHOT_GZIP_LEVEL,
  SNAPSHOT_TOO_LARGE_ERROR_MARKER,
} from './snapshotCapacity'

describe('Firestore 文書サイズの見積もり(公式の計算方法)', () => {
  it('値ごとの大きさ: 文字列=バイト数+1(日本語は UTF-8)・数値=8・真偽/null=1・配列=各値の和・マップ=名前+1+値', () => {
    expect(estimateFirestoreValueBytes('abc')).toBe(4)
    expect(estimateFirestoreValueBytes('あ')).toBe(4)
    expect(estimateFirestoreValueBytes(12345)).toBe(8)
    expect(estimateFirestoreValueBytes(true)).toBe(1)
    expect(estimateFirestoreValueBytes(null)).toBe(1)
    expect(estimateFirestoreValueBytes(['a', 1])).toBe(2 + 8)
    expect(estimateFirestoreValueBytes({ k: 'v' })).toBe(2 + 2)
    // undefined は書かれないので数えない
    expect(estimateFirestoreFieldsBytes({ a: undefined, b: 1 })).toBe(2 + 8)
  })

  it('文書全体 = 文書名(各区切り+1 の和 + 16) + フィールド + 32。日大前校の実文書の形で上限との差が分かる', () => {
    const path = 'workspaces/main/classroomSnapshots/5w5OMueETerSKrSf14HC'
    // 文書名: 11 + 5 + 19 + 21 + 16 = 72(2026-10-27 の実測と同じ)
    expect(estimateFirestoreDocumentBytes(path, {})).toBe(72 + 32)
    // 2026-10-27 05:45 に受理された実文書と同じフィールド構成(compressedData の長さ 1,048,236)。見積もり 1,048,549 = 上限の 27 バイト手前。
    const doc = {
      dataByteLength: 8345360,
      savedAt: '2026-10-27T05:45:52.030Z',
      schemaVersion: 1,
      version: 11707,
      compressedData: 'x'.repeat(1048236),
      dataEncoding: 'gzip-base64',
      updatedBy: 'u'.repeat(28),
      updatedAt: '2026-10-27T05:45:52.030Z',
    }
    const bytes = estimateFirestoreDocumentBytes(path, doc)
    expect(bytes).toBe(1048549)
    expect(isSnapshotOverCapacity(bytes)).toBe(false)
    expect(FIRESTORE_DOCUMENT_MAX_BYTES - bytes).toBe(27)
    // あと 28 文字増えれば超える(= 日大前校の 10/26 17:58 以降の状態)
    expect(isSnapshotOverCapacity(estimateFirestoreDocumentBytes(path, { ...doc, compressedData: 'x'.repeat(1048236 + 28) }))).toBe(true)
  })
})

describe('使用率と警告', () => {
  it('85% 以上で「上限が近い」、超過も近いに含める。使用率は小数 4 桁', () => {
    expect(SNAPSHOT_CAPACITY_WARNING_RATIO).toBe(0.85)
    expect(resolveSnapshotCapacityRatio(FIRESTORE_DOCUMENT_MAX_BYTES / 2)).toBe(0.5)
    expect(resolveSnapshotCapacityRatio(0)).toBe(0)
    expect(isSnapshotNearCapacity(Math.floor(FIRESTORE_DOCUMENT_MAX_BYTES * 0.84))).toBe(false)
    expect(isSnapshotNearCapacity(Math.ceil(FIRESTORE_DOCUMENT_MAX_BYTES * 0.85))).toBe(true)
    expect(isSnapshotNearCapacity(FIRESTORE_DOCUMENT_MAX_BYTES + 1)).toBe(true)
  })

  it('Firestore の容量超過の拒否文を見分ける(他の例外は容量超過にしない)', () => {
    expect(isFirestoreDocumentTooLargeError(new Error("Document 'projects/p/databases/(default)/documents/a/b' cannot be written because its size (1,048,601 bytes) exceeds the maximum allowed size of 1,048,576 bytes."))).toBe(true)
    expect(isFirestoreDocumentTooLargeError(new Error('14 UNAVAILABLE: No connection established'))).toBe(false)
    expect(isFirestoreDocumentTooLargeError(undefined)).toBe(false)
  })

  it('マーカーはクライアント(src/utils/saveProgressMessages.ts)と一致する', () => {
    const client = readFileSync(fileURLToPath(new URL('../../src/utils/saveProgressMessages.ts', import.meta.url)), 'utf8')
    expect(client).toContain(`SNAPSHOT_TOO_LARGE_ERROR_MARKER = '${SNAPSHOT_TOO_LARGE_ERROR_MARKER}'`)
  })
})

describe('圧縮レベル(つなぎ・2026-10-27)', () => {
  // 縮む量は合成データでは測れない(日大前校の実データで 1,048,236 → 992,112 文字・snapshotCapacity.ts の注記)。ここは読めることだけ固定する。
  it('level 9 で圧縮したものはレベル指定なしの gunzip でそのまま読める(読む側の変更は要らない)', () => {
    const json = JSON.stringify({ weeks: Array.from({ length: 300 }, (_, index) => ({ id: `2026-10-${index}`, desks: [{ teacher: '講師', manualTeacher: false }] })) })
    const level9 = gzipSync(Buffer.from(json, 'utf8'), { level: SNAPSHOT_GZIP_LEVEL })
    expect(SNAPSHOT_GZIP_LEVEL).toBe(9)
    expect(gunzipSync(level9).toString('utf8')).toBe(json)
  })

  it('教室スナップショットの書き込み(createStoredSnapshotDoc)が level 9 を使う(ソース走査)', () => {
    const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const body = indexTs.slice(indexTs.indexOf('function createStoredSnapshotDoc('), indexTs.indexOf('function getStoredSnapshotEncoding('))
    expect(body).toContain("gzipSync(Buffer.from(json, 'utf8'), { level: SNAPSHOT_GZIP_LEVEL })")
  })
})

describe('保存関数の配線(ソース走査・2026-10-27 日大前校の容量超過)', () => {
  const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
  const save = indexTs.slice(indexTs.indexOf('async function saveClassroomSnapshotFromCallable'), indexTs.indexOf('export const saveClassroomSnapshot = onCall('))

  it('保存記録に文書サイズの見積もりと使用率を残す', () => {
    expect(save).toContain('estimateFirestoreDocumentBytes(snapshotRef.path, snapshotDoc as unknown as Record<string, unknown>)')
    expect(save).toMatch(/const saveAttemptBase = \{[\s\S]*?documentByteLength,\s*capacityRatio,\s*\}/u)
  })

  it('本体の書き込みは try で包み、失敗を started のまま放置しない(容量超過=too-large / それ以外=write-failed)', () => {
    expect(save).toMatch(/try \{\s*await snapshotRef\.set\(snapshotDoc\)\s*\} catch \(error\) \{/u)
    expect(save).toContain("recordSaveAttemptFailure('too-large', detail)")
    expect(save).toContain("recordSaveAttemptFailure('write-failed', errorText)")
    expect(save).toContain("if (classifySnapshotWriteFailure(error, documentByteLength) === 'too-large') {")
    // 記録の書き込みの失敗で利用者へ返すエラーを差し替えない(L-2)
    expect(save).toMatch(/const recordSaveAttemptFailure = async[\s\S]*?try \{[\s\S]*?\} catch \(recordError\) \{[\s\S]*?logger\.error/u)
  })

  it('容量超過は resource-exhausted + マーカーで返す(通信失敗の自動再試行に乗せない)。それ以外は元の例外を投げ直す', () => {
    expect(save).toContain("'resource-exhausted',")
    expect(save).toContain('`${SNAPSHOT_TOO_LARGE_ERROR_MARKER}:')
    expect(save).toMatch(/kind: 'write-failed',[\s\S]*?\}\)\s*throw error\s*\}/u)
  })

  it('見積もりだけで書き込みを止めない(Firestore の拒否を正とする)', () => {
    expect(save).not.toContain('isSnapshotOverCapacity(')
  })

  it('上限が近ければ保存成功の後に capacity-warning を送る(verified の記録・操作ログ・台帳・痕跡より後＝L-3)', () => {
    const verifiedAt = save.indexOf("status: 'verified',")
    const trace = save.lastIndexOf('await persistOperationTrace({')
    const warning = save.indexOf("kind: 'capacity-warning'")
    expect(verifiedAt).toBeGreaterThan(0)
    expect(warning).toBeGreaterThan(verifiedAt)
    expect(warning).toBeGreaterThan(trace)
    expect(save).toContain('if (isSnapshotNearCapacity(documentByteLength)) {')
  })
})

describe('書き込み拒否の分類(classifySnapshotWriteFailure・regression-reviewer M-1/M-2)', () => {
  const over = FIRESTORE_DOCUMENT_MAX_BYTES + 25
  const under = FIRESTORE_DOCUMENT_MAX_BYTES - 1000

  it('Firestore の容量超過の文言なら見積もりに関係なく too-large', () => {
    const error = Object.assign(new Error("3 INVALID_ARGUMENT: Document 'x' cannot be written because its size (1,048,601 bytes) exceeds the maximum allowed size of 1,048,576 bytes."), { code: 3 })
    expect(classifySnapshotWriteFailure(error, under)).toBe('too-large')
  })

  it('文言が変わっても、引数エラー(gRPC 3 / invalid-argument)かつ見積もりが上限超えなら too-large', () => {
    expect(classifySnapshotWriteFailure(Object.assign(new Error('3 INVALID_ARGUMENT: something new'), { code: 3 }), over)).toBe('too-large')
    expect(classifySnapshotWriteFailure(Object.assign(new Error('bad'), { code: 'invalid-argument' }), over)).toBe('too-large')
  })

  it('引数エラーでも見積もりが上限以下なら other(容量超過と決めつけない)', () => {
    expect(classifySnapshotWriteFailure(Object.assign(new Error('3 INVALID_ARGUMENT: other'), { code: 3 }), under)).toBe('other')
  })

  it('通信・一時障害は見積もりが上限超えでも other(元の例外を投げ直して自動再試行に任せる)', () => {
    expect(classifySnapshotWriteFailure(Object.assign(new Error('14 UNAVAILABLE: No connection established'), { code: 14 }), over)).toBe('other')
    expect(classifySnapshotWriteFailure(Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }), over)).toBe('other')
    expect(classifySnapshotWriteFailure(undefined, over)).toBe('other')
  })
})
