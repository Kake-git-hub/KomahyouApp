import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  chunkItems,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  FIRESTORE_MAX_TRANSACTION_BYTES,
  resolveRetentionCutoffIso,
  RETENTION_CLEANUP_DELETE_CONCURRENCY,
  RETENTION_CLEANUP_MAX_DELETES_PER_RUN,
  RETENTION_CLEANUP_PAGE_LIMIT,
  RETENTION_CLEANUP_TIME_BUDGET_MS,
  shouldContinueRetentionPass,
} from './retentionCleanup'

const HOUR_IN_MS = 60 * 60 * 1000

// ★回帰防止(2026-09-04・実障害): cleanupOldSaveAttempts が毎晩
// `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.` で失敗し、
// saveAttempts の30日保持が事実上無効になっていた(本番 日大前校に 2026-05-30 分から 17,519 件滞留)。
// 原因は「1件が最大 1MiB の文書を 300 件まとめて WriteBatch で削除」していたこと。
describe('Transaction too big 回帰防止', () => {
  it('旧実装のバッチ件数(300)は Firestore のトランザクション上限を確実に超える', () => {
    const legacyBatchLimit = 300
    expect(legacyBatchLimit * FIRESTORE_MAX_DOCUMENT_BYTES).toBeGreaterThan(FIRESTORE_MAX_TRANSACTION_BYTES)
  })

  it('掃除の削除経路が WriteBatch へ戻されていない(戻すと障害が再発する)', () => {
    // 個別 delete にはトランザクションサイズ上限が無い、というのがこの修正の本体。
    // 実装ファイルを読んで「バッチへの逆戻り」を検知する(純粋関数だけでは守れないため)。
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const start = source.indexOf('async function deleteExpiredDocuments')
    const end = source.indexOf('async function pruneWorkspaceIncidentBackups')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const body = source.slice(start, end)
    expect(body).toContain('doc.ref.delete()')
    expect(body).not.toContain('firestore.batch()')
    // 撤去した旧定数を復活させない。
    expect(source).not.toContain('const SAVE_ATTEMPT_CLEANUP_BATCH_LIMIT =')
  })

  it('削除の並列度は常識的な範囲に収まっている', () => {
    expect(RETENTION_CLEANUP_DELETE_CONCURRENCY).toBeGreaterThan(0)
    expect(RETENTION_CLEANUP_DELETE_CONCURRENCY).toBeLessThanOrEqual(RETENTION_CLEANUP_PAGE_LIMIT)
  })

  it('1回の実行で滞留分をまとめて回収できる予算になっている', () => {
    // 旧実装は 1教室 1コレクションあたり 1日 300 件が上限で、17,519 件の滞留に追いつけなかった。
    expect(RETENTION_CLEANUP_MAX_DELETES_PER_RUN).toBeGreaterThan(17_519)
  })

  it('時間予算は関数の timeoutSeconds=300 より前に打ち切る', () => {
    expect(RETENTION_CLEANUP_TIME_BUDGET_MS).toBeLessThan(300_000)
  })
})

describe('resolveRetentionCutoffIso', () => {
  const nowMs = new Date('2026-09-04T03:30:00.000Z').getTime()

  it('保持日数だけ過去の ISO 文字列を返す', () => {
    expect(resolveRetentionCutoffIso(nowMs, 30)).toBe('2026-08-05T03:30:00.000Z')
  })

  it('保持日数 0 は現在時刻(=すべて期限切れ)', () => {
    expect(resolveRetentionCutoffIso(nowMs, 0)).toBe('2026-09-04T03:30:00.000Z')
  })

  it('負の保持日数は 0 として扱い、未来の締切を作らない', () => {
    // 未来の締切を作ると「まだ消してはいけない文書」を消してしまう。
    expect(resolveRetentionCutoffIso(nowMs, -10)).toBe('2026-09-04T03:30:00.000Z')
  })

  it('小数の保持日数は切り捨てる', () => {
    expect(resolveRetentionCutoffIso(nowMs, 1.9)).toBe(new Date(nowMs - 24 * HOUR_IN_MS).toISOString())
  })

  it('ISO 文字列は辞書順=時系列順なので締切との文字列比較が成立する', () => {
    const older = '2026-05-30T04:41:11.504Z'
    const cutoff = resolveRetentionCutoffIso(nowMs, 30)
    expect(older < cutoff).toBe(true)
    expect('2026-09-03T00:00:00.000Z' < cutoff).toBe(false)
  })
})

describe('chunkItems', () => {
  it('指定サイズで分割する', () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('割り切れるときは端数チャンクを作らない', () => {
    expect(chunkItems([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('空配列は空配列', () => {
    expect(chunkItems([], 10)).toEqual([])
  })

  it('サイズ 0 や負数でも無限ループにならない(1 として扱う)', () => {
    expect(chunkItems([1, 2], 0)).toEqual([[1], [2]])
    expect(chunkItems([1, 2], -5)).toEqual([[1], [2]])
  })

  it('要素数がサイズより少なければ 1 チャンク', () => {
    expect(chunkItems([1], 50)).toEqual([[1]])
  })
})

describe('shouldContinueRetentionPass', () => {
  const base = {
    lastPageSize: RETENTION_CLEANUP_PAGE_LIMIT,
    pageLimit: RETENTION_CLEANUP_PAGE_LIMIT,
    deletedTotal: 200,
    maxDeletes: RETENTION_CLEANUP_MAX_DELETES_PER_RUN,
    elapsedMs: 1_000,
    timeBudgetMs: RETENTION_CLEANUP_TIME_BUDGET_MS,
  }

  it('ページが満杯で予算内なら次のページへ進む(滞留分の回収に必要)', () => {
    expect(shouldContinueRetentionPass(base)).toBe(true)
  })

  it('ページが上限未満 = 対象を消し切ったので打ち切る', () => {
    expect(shouldContinueRetentionPass({ ...base, lastPageSize: RETENTION_CLEANUP_PAGE_LIMIT - 1 })).toBe(false)
  })

  it('取得 0 件なら打ち切る', () => {
    expect(shouldContinueRetentionPass({ ...base, lastPageSize: 0 })).toBe(false)
  })

  it('件数の予算に達したら打ち切る', () => {
    expect(shouldContinueRetentionPass({ ...base, deletedTotal: RETENTION_CLEANUP_MAX_DELETES_PER_RUN })).toBe(false)
  })

  it('時間の予算に達したら打ち切る(関数のタイムアウトより手前で止める)', () => {
    expect(shouldContinueRetentionPass({ ...base, elapsedMs: RETENTION_CLEANUP_TIME_BUDGET_MS })).toBe(false)
  })
})
