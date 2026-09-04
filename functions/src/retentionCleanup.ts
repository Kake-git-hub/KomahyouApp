// 保持期間ごみ掃除(cleanupOldSaveAttempts)の純ロジック。firebase 非依存でテストできる形に切り出す。
// index.ts 側は Firestore/Storage の I/O だけを担い、件数・時間の予算判断はここへ集約する
// (index.ts から新規 export しない = Firebase が export をそのまま関数としてデプロイするため)。
//
// ★2026-09-04 の回帰修正(実障害): cleanupOldSaveAttempts が毎晩
//   `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.`
// で失敗し続けており、saveAttempts の30日保持がまったく効いていなかった
// (本番 日大前校に 2026-05-30 分から 17,519 件が滞留。1件あたり最大 1MiB)。
// 真因は「1件が最大 1MiB になりうる saveAttempts(snapshot.compressedData を持つ)を
// 300件まとめて WriteBatch で削除」していたこと。Firestore のトランザクション上限 10MiB を超える。
// しかも最初の教室で例外死するため、後続の operationEvents / lessonLedgerDays の掃除にも到達していなかった。
//
// 対策は次の2点。**どちらか一方だけでは再発する**ので、片方を消す変更をしてはいけない:
//   (1) WriteBatch(=トランザクション)をやめ、1件ずつの delete を並列度制限つきで流す。
//       個別 delete にはトランザクションサイズ上限が無いので、文書がいくら大きくても落ちない。
//       掃除は冪等なので原子性は不要(途中で止まっても次回の実行が続きから消す)。
//   (2) 1回の実行で「1ページ消して終わり」にせず、予算(件数・時間)の範囲でページを繰り返す。
//       これが無いと滞留分にいつまでも追いつかない(旧実装は 1教室 1コレクションあたり
//       1日 300件が上限だった)。

// Firestore の上限(参考値)。テストで「バッチ削除へ戻す変更」を検知するために定数として持つ。
export const FIRESTORE_MAX_TRANSACTION_BYTES = 10 * 1024 * 1024
export const FIRESTORE_MAX_DOCUMENT_BYTES = 1024 * 1024

// 1回のクエリで取り出す件数。個別 delete なのでトランザクション上限とは無関係。
export const RETENTION_CLEANUP_PAGE_LIMIT = 200
// 同時に投げる delete の本数。上げすぎると Firestore 側で contention が出るため控えめにする。
export const RETENTION_CLEANUP_DELETE_CONCURRENCY = 50
// 1回の実行で消す上限(コレクション種別ごと)。滞留分を数日かけて回収する想定。
export const RETENTION_CLEANUP_MAX_DELETES_PER_RUN = 20000
// 1回の実行に使ってよい時間。関数の timeoutSeconds=300 に対して余裕を残す。
export const RETENTION_CLEANUP_TIME_BUDGET_MS = 240_000

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

export type RetentionPassState = {
  // 直前のページで実際に取れた件数。pageLimit 未満なら「もう残っていない」= 打ち切り。
  lastPageSize: number
  pageLimit: number
  deletedTotal: number
  maxDeletes: number
  elapsedMs: number
  timeBudgetMs: number
}

// 次のページを取りに行ってよいか。件数・時間・「取り切った」の3条件で打ち切る。
export function shouldContinueRetentionPass(state: RetentionPassState): boolean {
  if (state.lastPageSize <= 0) return false
  // 取れた件数がページ上限に満たない = 対象を消し切った。
  if (state.lastPageSize < Math.max(1, Math.trunc(state.pageLimit))) return false
  if (state.deletedTotal >= state.maxDeletes) return false
  if (state.elapsedMs >= state.timeBudgetMs) return false
  return true
}
