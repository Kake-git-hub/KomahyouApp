// 保持期間ごみ掃除(cleanupOldSaveAttempts)の純ロジック。firebase 非依存でテストできる形に切り出す。
// index.ts 側は Firestore/Storage の I/O 差し込み(loadPage / deleteItem)だけを担い、
// ページ送り・予算判断・件数集計はすべてここへ集約する
// (index.ts から新規 export しない = Firebase が export をそのまま関数としてデプロイするため)。
//
// ★2026-09-04 の回帰修正(実障害): cleanupOldSaveAttempts が毎晩
//   `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.`
// で失敗し続けており、saveAttempts の30日保持がまったく効いていなかった
// (本番 日大前校に 2026-05-30 分から 17,519 件が滞留)。
//
// 真因は「2026-06-03(commit 461894a)より前に書かれた saveAttempts が
// `snapshot.compressedData` を丸ごと持っており 1件あたり最大 1MiB になる」ところへ、
// 「300件まとめて WriteBatch で削除」していたこと。Firestore のトランザクション上限 10MiB を超える。
// ※現行の書き込み(buildSaveAttemptPayload)はハッシュ等の小さなメタデータだけなので、
//   **いま書かれる doc を見ても巨大さは分からない**。巨大なのは 2026-06-03 以前の旧 doc だけ。
//   「今は小さいからバッチに戻してよい」と判断しないこと(滞留分が残っている限り再発する)。
// さらに `where(...,'<',cutoff).limit(...)` は orderBy 省略時に対象フィールドの昇順が暗黙適用されるため、
// 毎晩1ページ目に必ず同じ巨大 doc 群が来て、同じ場所で失敗し続けていた(3ヶ月停滞)。
// しかも最初の教室で例外死するため、後続の operationEvents / lessonLedgerDays の掃除にも到達していなかった。
//
// 対策は次の3点。**どれか一つでも欠けると再発する**ので、消す変更をしてはいけない:
//   (1) WriteBatch(=トランザクション)をやめ、1件ずつの delete を並列度制限つきで流す。
//       個別 delete にはトランザクションサイズ上限が無いので、文書がいくら大きくても落ちない。
//       掃除は冪等なので原子性は不要(途中で止まっても次回の実行が続きから消す)。
//   (2) 読み出しは射影(.select())で「本文を持ってこない」。削除に本文は要らないのに、
//       200件 × 最大 1MiB を読むと memory:512MiB の関数が OOM で落ちる = 停滞が再発する。
//   (3) 1回の実行で「1ページ消して終わり」にせず、予算(件数・時間)の範囲でページを繰り返す。
//       これが無いと滞留分にいつまでも追いつかない(旧実装は 1教室 1コレクションあたり 1日 300件が上限だった)。

// Firestore の上限(参考値)。「なぜ 300 件バッチが落ちたか」を数値として残すための記録であって、
// 実装を守る回帰ガードではない(定数同士の算術なので実装が何であっても緑になる)。
// 実際のガードは retentionCleanup.test.ts の「実装ファイル走査」テスト。
export const FIRESTORE_MAX_TRANSACTION_BYTES = 10 * 1024 * 1024
export const FIRESTORE_MAX_DOCUMENT_BYTES = 1024 * 1024

// 1回のクエリ/一覧取得で取り出す件数。個別 delete なのでトランザクション上限とは無関係。
export const RETENTION_CLEANUP_PAGE_LIMIT = 200
// 同時に投げる delete の本数。上げすぎると Firestore/GCS 側で contention が出るため控えめにする。
export const RETENTION_CLEANUP_DELETE_CONCURRENCY = 50
// 1回のスイープで消す上限。スイープは (教室 × コレクション種別) ごと、および incident backup で1本ずつ走るので、
// これは「掃除全体の上限」ではなく「1スイープの上限」。全体の歯止めは時間予算の側が担う。
export const RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP = 20000
// Firestore 巡回に使ってよい時間。関数の timeoutSeconds=300 に対して余裕を残す。
export const RETENTION_CLEANUP_TIME_BUDGET_MS = 180_000
// 復元前スナップショット(Storage)の間引きに使ってよい時間。Firestore 巡回とは**独立**に持つ。
// ★これを Firestore と共有すると、Firestore 側が予算を使い切った晩は Storage 側が
//   毎回1ページだけ見て打ち切り、次の晩もまた1ページ目から読み直す = 46.8GB が永久に減らない。
export const INCIDENT_BACKUP_PRUNE_TIME_BUDGET_MS = 90_000

const HOUR_IN_MS = 60 * 60 * 1000

// 保持期間の締切(ISO 文字列)。createdAt / recordedAt は ISO 文字列で保存されており、
// 辞書順=時系列順なので文字列比較で「保持期間より古い」を抽出できる。
export function resolveRetentionCutoffIso(nowMs: number, retentionDays: number): string {
  const safeDays = Math.max(0, Math.trunc(retentionDays))
  return new Date(nowMs - safeDays * 24 * HOUR_IN_MS).toISOString()
}

// 並列度を抑えるための分割。size は 1 未満にならないよう丸める。
export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.trunc(size))
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize))
  }
  return chunks
}

// 掃除対象のコレクションと「時刻フィールド」の対応表。
// ★ここを取り違えると掃除が静かに0件になる(しかも operationEvents=1年 / lessonLedgerDays=2年 は
//   実際に消え始めるのが1年以上先なので、誤りが1年間発覚しない)。
//   対応表そのものをテストで固定するため、index.ts に直書きせずデータとしてここに置く。
export type RetentionTargetKey = 'saveAttempts' | 'operationEvents' | 'lessonLedgerDays'

export type RetentionTarget = {
  key: RetentionTargetKey
  collectionId: string
  timestampField: string
}

export function buildRetentionTargets(): RetentionTarget[] {
  return [
    // 保存の監査ログ。createdAt = サーバー側で採番した ISO 文字列。
    { key: 'saveAttempts', collectionId: 'saveAttempts', timestampField: 'createdAt' },
    // 操作ログ。recordedAt = サーバー受領時刻(クライアント時計に依存しない)。
    { key: 'operationEvents', collectionId: 'operationEvents', timestampField: 'recordedAt' },
    // 生徒授業台帳。recordedAt = サーバー受領時刻。
    { key: 'lessonLedgerDays', collectionId: 'lessonLedgerDays', timestampField: 'recordedAt' },
  ]
}

export type BudgetedSweepDecision = {
  hasNextPage: boolean
  deletedTotal: number
  maxDeletes: number
  elapsedMs: number
  timeBudgetMs: number
}

// 次のページへ進んでよいか。「取り切った」「件数の予算」「時間の予算」の3条件で打ち切る。
export function shouldContinueBudgetedSweep(decision: BudgetedSweepDecision): boolean {
  if (!decision.hasNextPage) return false
  if (decision.deletedTotal >= decision.maxDeletes) return false
  if (decision.elapsedMs >= decision.timeBudgetMs) return false
  return true
}

export type BudgetedSweepPage<T> = {
  items: readonly T[]
  // 次ページがあるときだけ値を入れる。Firestore のように「削除したら対象が消える」再クエリ方式では
  // 「ページが満杯だった = まだ残っている」を表す任意の印を入れればよい。
  nextPageToken?: string
}

export type BudgetedSweepResult = {
  deleted: number
  failed: number
  pagesLoaded: number
  stoppedByBudget: boolean
}

// 予算(件数・時間)の範囲でページを繰り返しながら削除するスイープ本体。
// I/O は loadPage / deleteItem として注入するので、この関数はテストから直接動かせる
// (★今回の障害はこのループ本体で起きたのに、純粋関数だけのテストでは一行も実行されていなかった)。
// deleteItem は「実際に消せたら true」を返す。失敗は failed に数え、**件数予算には数えない**
// (失敗を成功として数えると、削除できていないのに予算到達で早期打ち切りしてしまう)。
export async function runBudgetedDeletionSweep<T>(params: {
  loadPage: (pageToken: string | undefined) => Promise<BudgetedSweepPage<T>>
  deleteItem: (item: T) => Promise<boolean>
  concurrency?: number
  maxDeletes?: number
  timeBudgetMs?: number
  startedAtMs?: number
  now?: () => number
}): Promise<BudgetedSweepResult> {
  const concurrency = params.concurrency ?? RETENTION_CLEANUP_DELETE_CONCURRENCY
  const maxDeletes = params.maxDeletes ?? RETENTION_CLEANUP_MAX_DELETES_PER_SWEEP
  const timeBudgetMs = params.timeBudgetMs ?? RETENTION_CLEANUP_TIME_BUDGET_MS
  const now = params.now ?? Date.now
  const startedAtMs = params.startedAtMs ?? now()

  let pageToken: string | undefined
  let deleted = 0
  let failed = 0
  let pagesLoaded = 0
  let stoppedByBudget = false

  for (;;) {
    const page = await loadPageSafely(params.loadPage, pageToken)
    pagesLoaded += 1

    for (const chunk of chunkItems(page.items, concurrency)) {
      const outcomes = await Promise.all(chunk.map((item) => params.deleteItem(item)))
      for (const succeeded of outcomes) {
        if (succeeded) deleted += 1
        else failed += 1
      }
    }

    const decision: BudgetedSweepDecision = {
      hasNextPage: Boolean(page.nextPageToken),
      deletedTotal: deleted,
      maxDeletes,
      elapsedMs: now() - startedAtMs,
      timeBudgetMs,
    }
    if (!shouldContinueBudgetedSweep(decision)) {
      stoppedByBudget = decision.hasNextPage
      break
    }
    pageToken = page.nextPageToken
  }

  return { deleted, failed, pagesLoaded, stoppedByBudget }
}

async function loadPageSafely<T>(
  loadPage: (pageToken: string | undefined) => Promise<BudgetedSweepPage<T>>,
  pageToken: string | undefined,
): Promise<BudgetedSweepPage<T>> {
  const page = await loadPage(pageToken)
  return { items: page.items ?? [], nextPageToken: page.nextPageToken }
}
