// @vitest-environment jsdom
// 確認リストの添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)の読み込み・縮小。
// canvas は jsdom に無いので、描画先と画像の読み込みは差し替え(deps)で固定する。

import { describe, expect, it, vi } from 'vitest'

import {
  CHECKLIST_IMAGE_MAX_EDGE,
  CHECKLIST_IMAGE_PASTED_NAME,
  createChecklistAttachmentId,
  isSupportedChecklistImageType,
  pickChecklistImageFiles,
  resolveChecklistImageSize,
  shrinkChecklistImageToDataUrl,
  type ChecklistImageDeps,
} from './checklistImage'

describe('checklistImage: 対象ファイルと縮小サイズ', () => {
  it('画像(image/*)だけを拾う。null・空は空配列', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(pickChecklistImageFiles([png, txt]).map((file) => file.name)).toEqual(['a.png'])
    expect(pickChecklistImageFiles(null)).toEqual([])
    expect(pickChecklistImageFiles(undefined)).toEqual([])
  })

  it('送れる MIME は JPEG / PNG / WebP だけ', () => {
    expect(isSupportedChecklistImageType('image/jpeg')).toBe(true)
    expect(isSupportedChecklistImageType('image/png')).toBe(true)
    expect(isSupportedChecklistImageType('image/webp')).toBe(true)
    expect(isSupportedChecklistImageType('image/gif')).toBe(false)
    expect(isSupportedChecklistImageType('text/plain')).toBe(false)
  })

  it('長辺を 1600px に収める(拡大はしない・比率を保つ・1px 未満にしない)', () => {
    expect(CHECKLIST_IMAGE_MAX_EDGE).toBe(1600)
    expect(resolveChecklistImageSize(3840, 2160)).toEqual({ width: 1600, height: 900 })
    expect(resolveChecklistImageSize(1080, 1920)).toEqual({ width: 900, height: 1600 })
    expect(resolveChecklistImageSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(resolveChecklistImageSize(4000, 1)).toEqual({ width: 1600, height: 1 })
  })

  it('添付 id は時刻と乱数から作り、同じ入力なら同じ・個人情報を含まない', () => {
    expect(createChecklistAttachmentId(1_000_000, 0.5)).toBe(createChecklistAttachmentId(1_000_000, 0.5))
    expect(createChecklistAttachmentId(1_000_000, 0.5)).not.toBe(createChecklistAttachmentId(1_000_001, 0.5))
    expect(createChecklistAttachmentId(1_000_000, 0.5)).toMatch(/^att-[a-z0-9]+-[a-z0-9]{4}$/u)
  })
})

describe('shrinkChecklistImageToDataUrl', () => {
  const fakeDeps = (width: number, height: number, dataUrl = 'data:image/jpeg;base64,/9j/AAAA'): { deps: ChecklistImageDeps; drawn: number[][]; close: ReturnType<typeof vi.fn> } => {
    const drawn: number[][] = []
    const close = vi.fn()
    const deps: ChecklistImageDeps = {
      loadBitmap: async () => ({ width, height, source: {} as CanvasImageSource, close }),
      createCanvas: (w, h) => ({
        width: w,
        height: h,
        getContext: () => ({ fillRect: () => {}, drawImage: (_s: unknown, x: number, y: number, dw: number, dh: number) => { drawn.push([x, y, dw, dh]) } }),
        toDataURL: () => dataUrl,
      }) as unknown as HTMLCanvasElement,
    }
    return { deps, drawn, close }
  }

  it('長辺 1600px に縮めて JPEG の data URL を返し、ビットマップを閉じる。ファイル名が無ければ「貼り付け」', async () => {
    const { deps, drawn, close } = fakeDeps(3200, 2000)
    const result = await shrinkChecklistImageToDataUrl(new File(['x'], '', { type: 'image/png' }), deps)
    expect(result).toEqual({ name: CHECKLIST_IMAGE_PASTED_NAME, dataUrl: 'data:image/jpeg;base64,/9j/AAAA', width: 1600, height: 1000 })
    expect(drawn).toEqual([[0, 0, 1600, 1000]])
    expect(close).toHaveBeenCalledTimes(1)
    expect((await shrinkChecklistImageToDataUrl(new File(['x'], 'shot.png', { type: 'image/png' }), deps)).name).toBe('shot.png')
  })

  it('JPEG にできなかった(toDataURL が別形式)ときは例外', async () => {
    const { deps } = fakeDeps(100, 100, 'data:image/png;base64,AAAA')
    await expect(shrinkChecklistImageToDataUrl(new File(['x'], 'a.png', { type: 'image/png' }), deps)).rejects.toThrow('JPEG')
  })
})
