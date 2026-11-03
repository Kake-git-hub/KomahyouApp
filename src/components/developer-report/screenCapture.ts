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

// ───────────────────────────────────────────────────────────────────────────
// 「タブを選んで撮る」(2026-11-03 オーナー指示「質問要望の画面を撮る では開いているタブを選択できるようにして。コマ表や生徒日程表など」・
// 確認リスト v1.5.672 その他欄・オーナー選択「ブラウザのタブ選択画面」)。
//  - ブラウザの「共有するタブを選ぶ」画面(getDisplayMedia)を出し、選んだタブを 1 枚だけ撮ってすぐ共有を止める。
//    コマ表・生徒日程表・講師日程表など開いているタブを、見た目のまま(縦書きも崩れずに)写せる。
//  - 「質問・要望」のタブ自身は候補から外す(selfBrowserSurface: 'exclude')。撮ったあとも「質問・要望」のタブのまま(focus を移さない)。
//  - 選ばずに閉じた(NotAllowedError)ときは「選ばなかった」として扱い、エラーの案内を出さない。
//  - getDisplayMedia はボタンを押したタブ(「質問・要望」の別タブ)の navigator から呼ぶ(押したタブにだけユーザー操作の印が付くため)。
// ───────────────────────────────────────────────────────────────────────────

/** 選んだタブの最初の 1 枚が真っ黒にならないよう、映像が来てから待つ時間(ミリ秒)。 */
export const TAB_CAPTURE_SETTLE_MS = 350

export type TabCaptureMediaDevices = { getDisplayMedia?: (options?: Record<string, unknown>) => Promise<MediaStream> }

/** このブラウザで「タブを選んで撮る」が使えるか(getDisplayMedia がある＝PC の Chrome / Edge など。スマホ・タブレットは多くが未対応)。 */
export function canCaptureBrowserTab(mediaDevices: TabCaptureMediaDevices | undefined | null): boolean {
  return Boolean(mediaDevices && typeof mediaDevices.getDisplayMedia === 'function')
}

/** getDisplayMedia へ渡す指定。タブの一覧を先に出し、音は取らず、自分のタブは出さない。 */
export function buildTabCaptureOptions(controller: unknown | null): Record<string, unknown> {
  return {
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
    ...(controller ? { controller } : {}),
  }
}

/** 選ばずに閉じた(またはブラウザが許可しなかった)ときの例外か。 */
export function isTabCaptureCancelled(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'NotAllowedError')
}

/** 撮影を選ばずにやめたことを呼び出し側へ伝える例外(画面はエラーの案内を出さない)。 */
export class TabCaptureCancelledError extends Error {
  constructor() {
    super('タブを選ばなかったため撮りませんでした。')
    this.name = 'TabCaptureCancelledError'
  }
}

type FrameSource = CanvasImageSource & { width: number; height: number }

export type TabCaptureDeps = {
  mediaDevices: TabCaptureMediaDevices
  /** CaptureController(撮ったあと focus を移さないため)。使えないブラウザでは null。 */
  createController: () => { setFocusBehavior?: (behavior: string) => void } | null
  /** 映像から 1 枚取り出す(既定: video 要素に流して待ってから)。 */
  grabFrame: (stream: MediaStream) => Promise<FrameSource>
  createCanvas: (width: number, height: number) => HTMLCanvasElement
  now: () => Date
}

function stopStream(stream: MediaStream) {
  try {
    for (const track of stream.getTracks()) track.stop()
  } catch {
    // 止められなくてもブラウザが共有を終える。
  }
}

/** 選んだタブを 1 枚撮り、長辺 1600px の JPEG data URL にする。選ばなかったら TabCaptureCancelledError、撮れなければ例外。 */
export async function captureBrowserTabToDataUrl(deps: TabCaptureDeps): Promise<{ name: string; dataUrl: string; width: number; height: number }> {
  if (!canCaptureBrowserTab(deps.mediaDevices)) throw new Error('このブラウザではタブを選んで撮れません。')
  const controller = deps.createController()
  let stream: MediaStream
  try {
    stream = await (deps.mediaDevices.getDisplayMedia as NonNullable<TabCaptureMediaDevices['getDisplayMedia']>)(buildTabCaptureOptions(controller))
  } catch (error) {
    if (isTabCaptureCancelled(error)) throw new TabCaptureCancelledError()
    throw error
  }
  // 共有が始まった直後(同じ処理の中)に指定しないと効かない。選んだタブへ画面が移らないようにする。
  try {
    controller?.setFocusBehavior?.('no-focus-change')
  } catch {
    // タブ以外(ウィンドウ・画面全体)を選んだときなどは指定できない。撮影は続ける。
  }
  try {
    const frame = await deps.grabFrame(stream)
    const size = resolveChecklistImageSize(frame.width, frame.height, CHECKLIST_IMAGE_MAX_EDGE)
    const canvas = deps.createCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画面を画像にできませんでした(canvas が使えません)。')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(frame, 0, 0, size.width, size.height)
    const dataUrl = canvas.toDataURL('image/jpeg', CHECKLIST_IMAGE_JPEG_QUALITY)
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('画面を JPEG にできませんでした。')
    return { name: buildScreenCaptureFileName(deps.now()), dataUrl, width: size.width, height: size.height }
  } finally {
    stopStream(stream)
  }
}

/** 映像を video 要素に流し、最初の映像が来て少し待ってから canvas に写す(ボタンを押したタブの document で作る)。 */
function grabFrameWithVideo(doc: Document, view: Window, stream: MediaStream): Promise<FrameSource> {
  return new Promise<FrameSource>((resolve, reject) => {
    const video = doc.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    const timeout = view.setTimeout(() => reject(new Error('選んだタブの映像が届きませんでした。')), 8000)
    video.onloadeddata = () => {
      void video.play().catch(() => undefined)
      view.setTimeout(() => {
        view.clearTimeout(timeout)
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) {
          reject(new Error('選んだタブの大きさが分かりませんでした。'))
          return
        }
        const canvas = doc.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('画面を画像にできませんでした(canvas が使えません)。'))
          return
        }
        context.drawImage(video, 0, 0, width, height)
        video.srcObject = null
        resolve(canvas)
      }, TAB_CAPTURE_SETTLE_MS)
    }
  })
}

/** 「質問・要望」のボタンが置かれたタブ(view)から、ブラウザのタブ選択画面を出して撮る。 */
export function captureBrowserTabFromView(view: Window): Promise<{ name: string; dataUrl: string; width: number; height: number }> {
  const doc = view.document
  const ControllerCtor = (view as unknown as { CaptureController?: new () => { setFocusBehavior?: (behavior: string) => void } }).CaptureController
  return captureBrowserTabToDataUrl({
    mediaDevices: (view.navigator.mediaDevices ?? {}) as TabCaptureMediaDevices,
    createController: () => {
      try {
        return ControllerCtor ? new ControllerCtor() : null
      } catch {
        return null
      }
    },
    grabFrame: (stream) => grabFrameWithVideo(doc, view, stream),
    createCanvas: (width, height) => {
      const canvas = doc.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    },
    now: () => new Date(),
  })
}
