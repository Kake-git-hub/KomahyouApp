// tools/ui-patrol/driver.mjs の純関数(止めずに通す URL)を固定する。ブラウザ操作の部品そのものは実際に流して確かめる。
import { describe, it, expect } from 'vitest'
import { closePatrolBrowser, isAllowedPatrolUrl } from './driver.mjs'

describe('isAllowedPatrolUrl', () => {
  const base = 'http://127.0.0.1:5199'
  it('手元のサーバーと同じ origin・data:・blob: だけ通す', () => {
    expect(isAllowedPatrolUrl('http://127.0.0.1:5199/src/main.tsx', base)).toBe(true)
    expect(isAllowedPatrolUrl('data:image/png;base64,AAAA', base)).toBe(true)
    expect(isAllowedPatrolUrl('blob:http://127.0.0.1:5199/abc', base)).toBe(true)
    // vite の HMR(同じ origin の WebSocket)
    expect(isAllowedPatrolUrl('ws://127.0.0.1:5199/?token=x', base)).toBe(true)
  })

  it('同じホストの別のポート・localhost の別名・外のホストは通さない', () => {
    expect(isAllowedPatrolUrl('http://127.0.0.1:8080/x', base)).toBe(false)
    expect(isAllowedPatrolUrl('ws://127.0.0.1:8080/', base)).toBe(false)
    expect(isAllowedPatrolUrl('http://localhost:5199/x', base)).toBe(false)
    expect(isAllowedPatrolUrl('https://firestore.googleapis.com/v1/x', base)).toBe(false)
    expect(isAllowedPatrolUrl('https://127.0.0.1:5199/x', base)).toBe(false)
    expect(isAllowedPatrolUrl('not a url', base)).toBe(false)
  })
})

describe('closePatrolBrowser', () => {
  it('ブラウザが閉じなくても、上限の時間で諦めて先へ進む(片づけ中に Ctrl+C を何度押しても抜けられない、を防ぐ)', async () => {
    let closeCalls = 0
    const stuck = { browser: { close: () => { closeCalls += 1; return new Promise(() => {}) } } }
    const started = Date.now()
    await closePatrolBrowser(stuck, { timeoutMs: 50 })
    expect(closeCalls).toBe(1)
    expect(Date.now() - started).toBeLessThan(2000)
    // 閉じられるブラウザはそのまま閉じる。無いときは何もしない。
    let closed = false
    await closePatrolBrowser({ browser: { close: async () => { closed = true } } }, { timeoutMs: 50 })
    expect(closed).toBe(true)
    await closePatrolBrowser(null)
  })
})
