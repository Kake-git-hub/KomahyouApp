// iOS(Safari)は Android(Chrome)と提出ページの「拡大率」が異なって見えるため、
// iOS のときだけ下記の補正を適用して Android の見え方に合わせる。
// 値は実機デバッグ(#/submit-debug)で調整して確定する。
//   - IOS_VIEWPORT_WIDTH: レイアウトビューポート幅(px)。null = width=device-width(無補正)。
//     値を入れるとブラウザがその幅を画面に収めるよう一様に拡縮する(リフロー有り＝表も再フィット)。
//   - IOS_ZOOM: CSS zoom(等倍=1)。リフロー無しのピクセル拡縮。微調整用。
//
// 2026-06-15 実機(iPhone)で Android と並べて調整した確定値。width=520 + zoom=0.7 が一致。
export const IOS_VIEWPORT_WIDTH: number | null = 520
export const IOS_ZOOM = 0.7

// Android(Chrome)用の補正。iOS と同じく「レイアウトビューポート幅を画面より広く取って一様に縮小」
// する方式(固定px化の撤回 c4563f6 を踏襲し、vw単位は使わない)。device-width のままだとボタン等の
// 固定pxが大きすぎる指摘への対応。既定値は実機(#/submit-debug)で微調整して確定する。
//   - ANDROID_VIEWPORT_WIDTH を device 幅より広く取ると、表は 100vw のまま幅いっぱいを保ちつつ
//     固定px(ボタン/文字)が相対的に縮む。null = 無補正(device-width)。
export const ANDROID_VIEWPORT_WIDTH: number | null = 480
export const ANDROID_ZOOM = 1

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent)
}

// 提出ページの viewport meta を組み立てる。width 補正時は initial-scale を付けない
// (付けると幅に収めず等倍表示になり横はみ出すため)。無補正時は従来の device-width 固定。
export function buildSubmissionViewportContent(widthOverride: number | null): string {
  if (widthOverride && widthOverride > 0) {
    return `width=${Math.round(widthOverride)}, user-scalable=no, viewport-fit=cover`
  }
  return 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
}

// 初回ペイント前(main.tsx で render する前)に同期的に呼ぶ。iOS では viewport の width 変更を
// useEffect 後(描画後)に行うと、iOS が device-width の倍率を保持したまま再フィットせず
// 「見切れ・要ピンチ」になる。初回レイアウトの時点で正しい width を与えることで解消する。
// Android も同様に初回で幅を確定させ、描画後のちらつき(再フィット)を防ぐ。
export function applySubmissionViewport(): void {
  if (typeof document === 'undefined') return
  const width = isIOS() ? IOS_VIEWPORT_WIDTH : isAndroid() ? ANDROID_VIEWPORT_WIDTH : null
  if (!(width && width > 0)) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta) meta.setAttribute('content', buildSubmissionViewportContent(width))
}

// 後方互換のための別名(従来の呼び出し名)。中身は iOS/Android 両対応に一般化済み。
export const applyIOSSubmissionViewport = applySubmissionViewport
