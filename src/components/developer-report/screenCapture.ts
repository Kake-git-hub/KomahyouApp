// 「画面を撮る」(2026-10-22 オーナー決定 A: 盤面の「質問・要望」モーダルに、いま見えている画面をそのまま付ける)。
//
// OS のスクリーンショットの操作を知らなくても 1 クリックで付けられるようにする。描画は PDF 出力でも使っている html2canvas。
//  - 撮るのは **いま見えている範囲(ビューポート)** だけ(盤面全体を描くと数千 px になりタブレットでメモリを食う)。
//  - モーダル自身・確認リストの浮き窓は写さない(ignoreElements)。
//  - 長辺 1600px の JPEG に縮めてから返す(確認リストの画像と同じ規則・1 枚 1.5MB の上限に収める)。
//  - 失敗したら例外を投げる(呼び出し側が「スクリーンショットを撮って『画像を選ぶ』から」と案内する)。
// DOM に触る部分(html2canvas・canvas・window)は deps で差し替えられるようにし、判定と整形は純関数でテストする。

import html2canvas from 'html2canvas'

import { CHECKLIST_IMAGE_JPEG_QUALITY, CHECKLIST_IMAGE_MAX_EDGE, resolveChecklistImageSize } from './checklistImage'

/** 写さない要素。モーダルの覆い(盤面の各モーダル共通の overlay)と、開発用教室の確認リストの浮き窓。 */
export const SCREEN_CAPTURE_IGNORED_SELECTOR = '.auto-assign-modal-overlay, .developer-report-overlay, .verification-checklist-toggle, .verification-checklist-panel'
/** 描画の倍率。1 で十分読める(1920×1080 → JPEG 200〜400KB)。上げると時間とメモリが倍々で増える。 */
export const SCREEN_CAPTURE_SCALE = 1

export type ScreenCaptureViewport = { innerWidth: number; innerHeight: number; scrollX: number; scrollY: number }

/** html2canvas に渡す「いま見えている範囲だけ」の指定。 */
export function resolveScreenCaptureOptions(viewport: ScreenCaptureViewport) {
  const width = Math.max(1, Math.round(viewport.innerWidth))
  const height = Math.max(1, Math.round(viewport.innerHeight))
  const scrollX = Math.max(0, Math.round(viewport.scrollX))
  const scrollY = Math.max(0, Math.round(viewport.scrollY))
  return {
    x: scrollX,
    y: scrollY,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX,
    scrollY,
    scale: SCREEN_CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  }
}

export function shouldIgnoreElementForCapture(element: { matches?: (selector: string) => boolean }): boolean {
  try {
    return typeof element.matches === 'function' && element.matches(SCREEN_CAPTURE_IGNORED_SELECTOR)
  } catch {
    return false
  }
}

/** 添付の表示名。端末の時計(現地時刻)で「画面_YYYYMMDD-HHMMSS.jpg」。 */
export function buildScreenCaptureFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `画面_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`
}

export type ScreenCaptureCanvasLike = { width: number; height: number }

export type ScreenCaptureDeps = {
  /** ビューポートを描く(既定: html2canvas)。 */
  render: (root: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>
  createCanvas: (width: number, height: number) => HTMLCanvasElement
  viewport: () => ScreenCaptureViewport
  root: () => HTMLElement
  now: () => Date
}

function defaultDeps(): ScreenCaptureDeps {
  return {
    render: (root, options) => html2canvas(root, options as Parameters<typeof html2canvas>[1]),
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    },
    viewport: () => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY }),
    root: () => document.body,
    now: () => new Date(),
  }
}

/** いま見えている画面を撮り、長辺 1600px の JPEG data URL にする。撮れない・描けないときは例外。 */
export async function captureScreenToDataUrl(deps: ScreenCaptureDeps = defaultDeps()): Promise<{ name: string; dataUrl: string; width: number; height: number }> {
  const source = await deps.render(deps.root(), { ...resolveScreenCaptureOptions(deps.viewport()), ignoreElements: shouldIgnoreElementForCapture })
  const size = resolveChecklistImageSize(source.width, source.height, CHECKLIST_IMAGE_MAX_EDGE)
  const canvas = deps.createCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画面を画像にできませんでした(canvas が使えません)。')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(source, 0, 0, size.width, size.height)
  const dataUrl = canvas.toDataURL('image/jpeg', CHECKLIST_IMAGE_JPEG_QUALITY)
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('画面を JPEG にできませんでした。')
  return { name: buildScreenCaptureFileName(deps.now()), dataUrl, width: size.width, height: size.height }
}
