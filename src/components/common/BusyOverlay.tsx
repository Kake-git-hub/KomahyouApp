// 画面全体を覆う「処理中」表示(確認リスト v1.5.504 その他・2026-09-12 オーナー要望)。
//
// PDF 出力など、数秒〜十数秒かかり**その間の操作を受け付けない**処理の最中に、スピナーと短い文言を
// 最前面に出して「固まったのではなく処理中」だと分かるようにする。message が空/未指定なら何も描画しない。
// 状態は呼び出し側(ScheduleBoardScreen など)が持ち、このコンポーネントは見た目だけを担う。
// クリックを透過させない(pointer-events は CSS 側で auto)ので、表示中は下の盤面を操作できない。

export type BusyOverlayProps = {
  /** 表示する文言。空文字 / null / undefined なら描画しない。 */
  message?: string | null
}

export function BusyOverlay({ message }: BusyOverlayProps) {
  if (!message) return null
  return (
    <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true" data-testid="busy-overlay">
      <div className="busy-overlay-card">
        <span className="busy-overlay-spinner" aria-hidden="true" />
        <span className="busy-overlay-message">{message}</span>
      </div>
    </div>
  )
}

export default BusyOverlay
