import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildRetentionTargets,
  chunkItems,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  FIRESTORE_MAX_TRANSACTION_BYTES,
  INCIDENT_BACKUP_PRUNE_TIME_BUDGET_MS,
  resolveRetentionCutoffIso,
  RETENTION_CLEANUP_DELETE_CONCURRENCY,
  RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP,
  RETENTION_CLEANUP_PAGE_LIMIT,
  RETENTION_CLEANUP_TIME_BUDGET_MS,
  runBudgetedDeletionSweep,
  shouldContinueBudgetedSweep,
} from './retentionCleanup'

const HOUR_IN_MS = 60 * 60 * 1000

const readIndexSource = () => readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

// ページ分割された偽リスタ。1ページ = pageSize 件、最終ページだけ nextPageToken を返さない。
function createFakePages(totalItems: number, pageSize: number) {
  const pages: number[][] = []
  for (let index = 0; index < totalItems; index += pageSize) {
    pages.push(Array.from({ length: Math.min(pageSize, totalItems - index) }, (_, offset) => index + offset))
  }
  if (pages.length === 0) pages.push([])
  return pages
}

// ★回帰防止(2026-09-04・実障害): cleanupOldSaveAttempts が毎晩
// `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.` で失敗し、
// saveAttempts の30日保持が事実上無効になっていた(本番 日大前校に 2026-05-30 分から 17,519 件滞留)。
// 原因は「2026-06-03 以前に書かれた最大 1MiB の文書を 300 件まとめて WriteBatch で削除」していたこと。
describe('Transaction too big 回帰防止', () => {
  it('旧実装のバッチ件数(300)は Firestore のトランザクション上限を超える(事実の記録)', () => {
    // これは定数同士の算術なので実装が何であっても緑になる。回帰ガードではなく、
    // 「なぜ 300 が駄目だったか」を数値で残すための記録。実際のガードは次のテスト。
    expect(300 * FIRESTORE_MAX_DOCUMENT_BYTES).toBeGreaterThan(FIRESTORE_MAX_TRANSACTION_BYTES)
  })

  it('掃除の削除経路が WriteBatch へ戻されていない(戻すと障害が再発する)', () => {
    const source = readIndexSource()
    const start = source.indexOf('async function deleteExpiredDocuments')
    const end = source.indexOf('async function pruneWorkspaceIncidentBackups')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const body = source.slice(start, end)
    expect(body).toContain('runBudgetedDeletionSweep')
    expect(body).not.toContain('firestore.batch()')
    expect(source).not.toContain('const SAVE_ATTEMPT_CLEANUP_BATCH_LIMIT =')
  })

  it('削除クエリが射影(.select())を使っている(外すと初回実行が OOM で落ちて停滞が再発する)', () => {
    // 削除に本文は要らない。200件 × 最大 1MiB を読むと memory:512MiB の関数が落ちる。
    const source = readIndexSource()
    const start = source.indexOf('async function deleteExpiredDocuments')
    const end = source.indexOf('async function pruneWorkspaceIncidentBackups')
    expect(source.slice(start, end)).toContain('.select()')
  })

  it('Storage の間引きは Firestore 巡回より先に走る(後ろだと滞留分が永久に減らない)', () => {
    const source = readIndexSource()
    const body = source.slice(source.indexOf('async function runSaveAttemptCleanup'))
    const prunePosition = body.indexOf('await pruneWorkspaceIncidentBackups(')
    const firestorePosition = body.indexOf("firestore.collection('workspaces').get()")
    expect(prunePosition).toBeGreaterThan(-1)
    expect(firestorePosition).toBeGreaterThan(-1)
    expect(prunePosition).toBeLessThan(firestorePosition)
  })

  it('Storage の間引きは Firestore 巡回と独立した時間予算を持つ', () => {
    // 予算を共有すると、Firestore 側が使い切った晩は1ページだけ見て打ち切り、翌晩も1ページ目に戻る。
    expect(INCIDENT_BACKUP_PRUNE_TIME_BUDGET_MS).toBeGreaterThan(0)
    expect(INCIDENT_BACKUP_PRUNE_TIME_BUDGET_MS + RETENTION_CLEANUP_TIME_BUDGET_MS).toBeLessThan(300_000)
  })

  it('1回のスイープで滞留分をまとめて回収できる予算になっている', () => {
    // 旧実装は 1教室 1コレクションあたり 1日 300 件が上限で、17,519 件の滞留に追いつけなかった。
    expect(RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP).toBeGreaterThan(17_519)
  })

  it('削除の並列度は取得ページ数を超えない', () => {
    expect(RETENTION_CLEANUP_DELETE_CONCURRENCY).toBeGreaterThan(0)
    expect(RETENTION_CLEANUP_DELETE_CONCURRENCY).toBeLessThanOrEqual(RETENTION_CLEANUP_PAGE_LIMIT)
  })
})

// ★穴A対策: コレクションと時刻フィールドの対応を取り違えると掃除が静かに0件になる。
// operationEvents(1年)と lessonLedgerDays(2年)は実際に消え始めるのが1年以上先なので、
// 誤りがあっても1年間発覚しない。対応表そのものをテストで固定する。
describe('buildRetentionTargets', () => {
  it('コレクションと時刻フィールドの対応を固定する(仕様正本 docs/spec-save-restore.md §8-1 の 11〜13 行)', () => {
    expect(buildRetentionTargets()).toEqual([
      { key: 'saveAttempts', collectionId: 'saveAttempts', timestampField: 'createdAt' },
      { key: 'operationEvents', collectionId: 'operationEvents', timestampField: 'recordedAt' },
      { key: 'lessonLedgerDays', collectionId: 'lessonLedgerDays', timestampField: 'recordedAt' },
    ])
  })

  it('掃除の巡回が対応表を使っている(index.ts への直書きへ戻していない)', () => {
    const source = readIndexSource()
    const body = source.slice(source.indexOf('async function runSaveAttemptCleanup'))
    expect(body).toContain('buildRetentionTargets()')
  })
})

// ★穴B対策: バックアップ書き出しの整形(null, 2)が3箇所のうち1箇所だけ戻る「部分巻き戻し」を検知する。
describe('バックアップ JSON の最小化が部分的に巻き戻っていない', () => {
  it('index.ts に整形付きのバックアップ書き出しが1箇所も残っていない', () => {
    const source = readIndexSource()
    expect(source).not.toContain('null, 2')
    expect(source).toContain('serializeWorkspaceBackupJson(snapshot)')
    expect(source).toContain('serializeWorkspaceBackupJson(storageDoc)')
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
})

describe('shouldContinueBudgetedSweep', () => {
  const base = {
    hasNextPage: true,
    deletedTotal: 200,
    maxDeletes: RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP,
    elapsedMs: 1_000,
    timeBudgetMs: RETENTION_CLEANUP_TIME_BUDGET_MS,
  }

  it('次ページがあり予算内なら進む(滞留分の回収に必要)', () => {
    expect(shouldContinueBudgetedSweep(base)).toBe(true)
  })

  it('次ページが無ければ打ち切る', () => {
    expect(shouldContinueBudgetedSweep({ ...base, hasNextPage: false })).toBe(false)
  })

  it('件数の予算に達したら打ち切る', () => {
    expect(shouldContinueBudgetedSweep({ ...base, deletedTotal: RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP })).toBe(false)
  })

  it('時間の予算に達したら打ち切る(関数のタイムアウトより手前で止める)', () => {
    expect(shouldContinueBudgetedSweep({ ...base, elapsedMs: RETENTION_CLEANUP_TIME_BUDGET_MS })).toBe(false)
  })
})

// ★今回壊れていたのはこのループ本体。純粋関数だけのテストでは一行も実行されていなかったので、
// I/O を注入して実際に回す。
describe('runBudgetedDeletionSweep', () => {
  it('複数ページを最後まで歩いて全件消す', async () => {
    const pages = createFakePages(437, 200)
    const deleted: number[] = []
    let pageIndex = 0

    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => {
        const items = pages[pageIndex] ?? []
        const hasMore = pageIndex < pages.length - 1
        pageIndex += 1
        return { items, nextPageToken: hasMore ? `page-${pageIndex}` : undefined }
      },
      deleteItem: async (item) => {
        deleted.push(item)
        return true
      },
    })

    expect(result.deleted).toBe(437)
    expect(result.failed).toBe(0)
    expect(result.pagesLoaded).toBe(3)
    expect(result.stoppedByBudget).toBe(false)
    expect(new Set(deleted).size).toBe(437)
  })

  it('削除に失敗しても同じページを読み続けない(無限ループにならない)', async () => {
    const pages = createFakePages(400, 200)
    let pageIndex = 0

    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => {
        const items = pages[pageIndex] ?? []
        const hasMore = pageIndex < pages.length - 1
        pageIndex += 1
        return { items, nextPageToken: hasMore ? 'more' : undefined }
      },
      // すべて失敗させる
      deleteItem: async () => false,
    })

    expect(result.deleted).toBe(0)
    expect(result.failed).toBe(400)
    expect(result.pagesLoaded).toBe(2)
  })

  it('失敗を件数予算に数えない(消せていないのに早期打ち切りしない)', async () => {
    let pageIndex = 0
    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => {
        pageIndex += 1
        return { items: [1, 2, 3, 4], nextPageToken: pageIndex < 3 ? 'more' : undefined }
      },
      // 半分だけ成功させる
      deleteItem: async (item) => item % 2 === 0,
      maxDeletes: 6,
    })

    expect(result.deleted).toBe(6)
    expect(result.failed).toBe(6)
  })

  it('件数の予算で打ち切り、続きが残っていることを stoppedByBudget で伝える', async () => {
    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => ({ items: [1, 2, 3], nextPageToken: 'more' }),
      deleteItem: async () => true,
      maxDeletes: 6,
    })

    expect(result.deleted).toBe(6)
    expect(result.stoppedByBudget).toBe(true)
  })

  it('時間の予算で打ち切る(注入した時計で判定する)', async () => {
    let clock = 0
    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => ({ items: [1, 2], nextPageToken: 'more' }),
      deleteItem: async () => true,
      timeBudgetMs: 100,
      startedAtMs: 0,
      now: () => {
        clock += 60
        return clock
      },
    })

    expect(result.stoppedByBudget).toBe(true)
    expect(result.deleted).toBeLessThanOrEqual(4)
  })

  it('中断しても次の実行が続きから消せる(冪等)', async () => {
    const remaining = Array.from({ length: 10 }, (_, index) => index)

    const sweep = (maxDeletes: number) => runBudgetedDeletionSweep<number>({
      loadPage: async () => ({
        items: remaining.slice(0, 4),
        nextPageToken: remaining.length > 4 ? 'more' : undefined,
      }),
      deleteItem: async (item) => {
        const position = remaining.indexOf(item)
        if (position >= 0) remaining.splice(position, 1)
        return true
      },
      maxDeletes,
    })

    const first = await sweep(4)
    expect(first.deleted).toBe(4)
    expect(remaining).toHaveLength(6)

    const second = await sweep(100)
    expect(second.deleted).toBe(6)
    expect(remaining).toHaveLength(0)
  })

  it('1ページ目が全て保持対象(0件)でも次のページへ進む(46.8GB が永久に減らない状態を防ぐ)', async () => {
    // 期限切れは3ページ目にしか無い、という状況。
    const pageContents = [[], [], [1, 2, 3]]
    let pageIndex = 0

    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => {
        const items = pageContents[pageIndex] ?? []
        const hasMore = pageIndex < pageContents.length - 1
        pageIndex += 1
        return { items, nextPageToken: hasMore ? 'more' : undefined }
      },
      deleteItem: async () => true,
    })

    expect(result.pagesLoaded).toBe(3)
    expect(result.deleted).toBe(3)
    expect(result.stoppedByBudget).toBe(false)
  })

  it('対象が1件も無ければ1ページ読んで終わる', async () => {
    const result = await runBudgetedDeletionSweep<number>({
      loadPage: async () => ({ items: [] }),
      deleteItem: async () => true,
    })

    expect(result).toEqual({ deleted: 0, failed: 0, pagesLoaded: 1, stoppedByBudget: false })
  })
})
