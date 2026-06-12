// A1: 多端末の「古いデータ上書き」防止のための楽観ロック判定（純粋関数・firebase 非依存）。
//
// クライアントは「読み込んだ時点の版数(baseVersion)」を保存リクエストに付ける。
// サーバーは「現在の版数(previousVersion)」と照合し、一致する時だけ保存して版数を +1 する。
// 食い違う場合は別端末が先に更新した = このリクエストは古いベースなので拒否する。
//
// 後方互換（デプロイ順序事故の防止）:
//  - baseVersion 未送信(旧クライアント) → 照合せず常に許可（従来通り）。
//  - 既存教室で版数未設定(previousVersion=undefined) → 0 とみなす。初回保存で版数=1 になる。
//  - 同一 saveId の再送(冪等リプレイ・isReplay=true) → 同一論理保存なので照合しない。

export type OptimisticVersionDecision =
  | { ok: true; nextVersion: number }
  | { ok: false; reason: 'stale'; previousVersion: number; incomingBaseVersion: number }

export function resolveOptimisticVersionDecision(params: {
  incomingBaseVersion: number | undefined
  previousVersion: number | undefined
  isReplay: boolean
}): OptimisticVersionDecision {
  const previousVersion = typeof params.previousVersion === 'number' && Number.isFinite(params.previousVersion)
    ? params.previousVersion
    : 0

  const hasBaseVersion = typeof params.incomingBaseVersion === 'number' && Number.isFinite(params.incomingBaseVersion)

  if (!params.isReplay && hasBaseVersion && params.incomingBaseVersion !== previousVersion) {
    return {
      ok: false,
      reason: 'stale',
      previousVersion,
      incomingBaseVersion: params.incomingBaseVersion as number,
    }
  }

  return { ok: true, nextVersion: previousVersion + 1 }
}

// クライアント/サーバーで STALE を判別するための安定マーカー。
// HttpsError('failed-precondition') は空データ上書き拒否(assertNoSnapshotDataLoss)でも使うため、
// メッセージ先頭のこのマーカーで「版数衝突」だけを見分ける。
export const STALE_SNAPSHOT_ERROR_MARKER = 'STALE_SNAPSHOT'
