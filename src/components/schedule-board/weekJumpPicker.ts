// 盤面ツールバーの「表示週を選択」ネイティブ日付ピッカーの確定制御。
//
// なぜ必要か（回帰防止）:
//   タブレット等のネイティブ日付ピッカーは、ホイール/カレンダーを操作している
//   最中に input/change を発火させる（「完了」を押す前に値が変わる）。以前は
//   input の onChange で即 onJumpToDate していたため、日付を確定する前に表示週が
//   勝手に変わってしまっていた。オーナー要望（2026-07-10）で「日付を実際に選んで
//   確定した時だけ週を切り替える」仕様に変更。
//
//   そこで change は「ステージ（保留）」のみ行い、ピッカーを閉じて確定した時
//   （blur / Enter）に最後の値へジャンプする。この純ロジックを切り出して単体テスト
//   で守る（UI 側の配線は薄く保つ）。
export interface WeekJumpPicker {
  /** ピッカー操作中の値変更。ジャンプはせず最後の値だけ保留する。 */
  stage(value: string | null | undefined): void
  /** 確定（blur / Enter）。ジャンプすべき日付を返す。無ければ null。 */
  commit(): string | null
  /** 保留中の値（テスト用/デバッグ用）。 */
  getPending(): string | null
  /** 保留を破棄（確定せずキャンセルした時）。 */
  reset(): void
}

export function createWeekJumpPicker(): WeekJumpPicker {
  let pending: string | null = null
  return {
    stage(value) {
      // 空値（クリア）は保留しない。
      pending = value ? value : null
    },
    commit() {
      const value = pending
      pending = null
      return value
    },
    getPending() {
      return pending
    },
    reset() {
      pending = null
    },
  }
}
