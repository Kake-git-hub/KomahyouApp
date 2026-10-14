import { describe, expect, it } from 'vitest'

import { waitForNextPaint } from './waitForNextPaint'

describe('waitForNextPaint(処理中表示を描いてから重い計算を始めるための待ち・2026-10-14)', () => {
  it('requestAnimationFrame → setTimeout(0) の順に譲ってから解決する', async () => {
    const order: string[] = []
    let frame: (() => void) | null = null
    let timer: (() => void) | null = null
    const promise = waitForNextPaint({
      requestAnimationFrame: (callback) => { order.push('raf'); frame = callback },
      setTimeout: (callback, ms) => { order.push(`timeout:${ms}`); timer = callback },
    })
    let resolved = false
    void promise.then(() => { resolved = true })
    expect(order).toEqual(['raf'])
    frame!()
    expect(order).toEqual(['raf', 'timeout:0'])
    await Promise.resolve()
    expect(resolved).toBe(false) // タイマーが鳴る前は解決しない(スピナーが描かれる前に計算を始めない)。
    timer!()
    await promise
    expect(resolved).toBe(true)
  })

  it('requestAnimationFrame が無い環境では setTimeout(0) だけで譲る', async () => {
    let timer: (() => void) | null = null
    const promise = waitForNextPaint({ setTimeout: (callback) => { timer = callback } })
    expect(timer).not.toBeNull()
    timer!()
    await expect(promise).resolves.toBeUndefined()
  })

  it('window が無い(scheduler が null)なら即解決する', async () => {
    await expect(waitForNextPaint(null)).resolves.toBeUndefined()
  })
})
