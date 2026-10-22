import { describe, expect, it, vi } from 'vitest'

import {
  SCREEN_CAPTURE_IGNORED_SELECTOR,
  SCREEN_CAPTURE_SCALE,
  buildScreenCaptureFileName,
  captureScreenToDataUrl,
  resolveScreenCaptureOptions,
  shouldIgnoreElementForCapture,
  type ScreenCaptureDeps,
} from './screenCapture'

describe('resolveScreenCaptureOptions(いま見えている範囲だけを描く)', () => {
  it('スクロール位置から始まるビューポート大の矩形・倍率 1・白背景', () => {
    const options = resolveScreenCaptureOptions({ innerWidth: 1366.4, innerHeight: 768, scrollX: 120.6, scrollY: 300 })
    expect(options).toMatchObject({ x: 121, y: 300, width: 1366, height: 768, windowWidth: 1366, windowHeight: 768, scrollX: 121, scrollY: 300, scale: SCREEN_CAPTURE_SCALE, backgroundColor: '#ffffff', logging: false })
    expect(SCREEN_CAPTURE_SCALE).toBe(1)
  })

  it('負のスクロールや 0 幅でも壊れない', () => {
    expect(resolveScreenCaptureOptions({ innerWidth: 0, innerHeight: -5, scrollX: -10, scrollY: -1 })).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('shouldIgnoreElementForCapture(モーダルの覆いと確認リストは写さない)', () => {
  it('セレクタに合う要素だけ無視し、matches が無い・投げる要素は無視しない', () => {
    expect(SCREEN_CAPTURE_IGNORED_SELECTOR).toContain('.auto-assign-modal-overlay')
    expect(SCREEN_CAPTURE_IGNORED_SELECTOR).toContain('.verification-checklist-panel')
    expect(shouldIgnoreElementForCapture({ matches: (selector) => selector === SCREEN_CAPTURE_IGNORED_SELECTOR })).toBe(true)
    expect(shouldIgnoreElementForCapture({ matches: () => false })).toBe(false)
    expect(shouldIgnoreElementForCapture({})).toBe(false)
    expect(shouldIgnoreElementForCapture({ matches: () => { throw new Error('x') } })).toBe(false)
  })
})

describe('buildScreenCaptureFileName', () => {
  it('現地時刻で 画面_YYYYMMDD-HHMMSS.jpg', () => {
    expect(buildScreenCaptureFileName(new Date(2026, 9, 22, 15, 4, 9))).toBe('画面_20261022-150409.jpg')
  })
})

describe('captureScreenToDataUrl(描画 → 長辺 1600px の JPEG)', () => {
  function fakeDeps(sourceSize: { width: number; height: number }, overrides: Partial<ScreenCaptureDeps> = {}) {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const created: Array<{ width: number; height: number }> = []
    const deps: ScreenCaptureDeps = {
      render: vi.fn(async () => sourceSize as unknown as HTMLCanvasElement),
      createCanvas: (width, height) => {
        created.push({ width, height })
        return {
          width,
          height,
          getContext: () => ({ fillRect, drawImage, fillStyle: '' }),
          toDataURL: () => 'data:image/jpeg;base64,/9j/AAAA',
        } as unknown as HTMLCanvasElement
      },
      viewport: () => ({ innerWidth: 1920, innerHeight: 1080, scrollX: 0, scrollY: 40 }),
      root: () => ({} as HTMLElement),
      now: () => new Date(2026, 9, 22, 9, 30, 0),
      ...overrides,
    }
    return { deps, drawImage, fillRect, created }
  }

  it('ビューポートを描き、1920 幅は 1600 に縮め、白地に描いて JPEG にする', async () => {
    const { deps, drawImage, fillRect, created } = fakeDeps({ width: 1920, height: 1080 })
    const result = await captureScreenToDataUrl(deps)
    expect(deps.render).toHaveBeenCalledTimes(1)
    const options = (deps.render as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>
    expect(options).toMatchObject({ width: 1920, height: 1080, y: 40, scale: 1 })
    expect(typeof options.ignoreElements).toBe('function')
    expect(created).toEqual([{ width: 1600, height: 900 }])
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1600, 900)
    expect(drawImage).toHaveBeenCalled()
    expect(result).toEqual({ name: '画面_20261022-093000.jpg', dataUrl: 'data:image/jpeg;base64,/9j/AAAA', width: 1600, height: 900 })
  })

  it('小さい画面は拡大しない。描けない(canvas 無し)・JPEG にならないときは例外', async () => {
    const small = fakeDeps({ width: 800, height: 600 })
    expect((await captureScreenToDataUrl(small.deps)).width).toBe(800)
    const noContext = fakeDeps({ width: 800, height: 600 }, { createCanvas: () => ({ getContext: () => null } as unknown as HTMLCanvasElement) })
    await expect(captureScreenToDataUrl(noContext.deps)).rejects.toThrow('canvas')
    const notJpeg = fakeDeps({ width: 800, height: 600 }, { createCanvas: () => ({ getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: '' }), toDataURL: () => 'data:image/png;base64,AAAA' } as unknown as HTMLCanvasElement) })
    await expect(captureScreenToDataUrl(notJpeg.deps)).rejects.toThrow('JPEG')
  })

  it('描画そのものが失敗したら例外をそのまま伝える(呼び出し側が「画像を選ぶ」を案内する)', async () => {
    const failing = fakeDeps({ width: 1, height: 1 }, { render: async () => { throw new Error('render failed') } })
    await expect(captureScreenToDataUrl(failing.deps)).rejects.toThrow('render failed')
  })
})
