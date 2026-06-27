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

// Android(Chrome)用の補正。オーナー指示(2026-06-27)で iOS と同じ 幅520 + zoom0.7 を採用。
// ただし「出席不可コマの表は現状の全幅のまま」という要望のため、SubmissionPage 側で Android のときだけ
// 表(.sub-table-wrap)に逆ズーム(1/zoom)を当てて全幅へ戻す(見出し/ボタン等の固定pxだけが 0.7 で縮む)。
// 固定px化の撤回 c4563f6 を踏襲し vw単位は使わない。値は実機(#/submit-debug)で微調整可能。
export const ANDROID_VIEWPORT_WIDTH: number | null = 520
export const ANDROID_ZOOM = 0.7

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
