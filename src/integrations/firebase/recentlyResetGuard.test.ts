import { describe, expect, it } from 'vitest'
import { createRecentlyResetGuard } from './lectureSubmission'

/**
 * 監査領域7 B4 の回帰防止テスト。
 *
 * ガードの契約:
 *  - reset 前に add(token) した token は、TTL 経過までは has(token)=true（購読反映側が無視する）。
 *  - TTL 経過後は has(token)=false に戻り、再び有効な提出として反映される。
 *
 * 実害の再現（このガードが無い/機能しないと）:
 *  室長が登録解除した直後、リセット前の submitted スナップショットが購読で届き、
 *  「ローカル未登録なのに submitted＝新規提出」と誤認して countSubmitted が復活する。
 */

/** 仮想時間のタイマー。テストから任意に時刻を進められる。 */
function createFakeTimer() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { fireAt: number; callback: () => void }>()
  return {
    timer: {
      set: (callback: () => void, delayMs: number) => {
        const id = nextId++
        pending.set(id, { fireAt: now + delayMs, callback })
        return id
      },
      clear: (id: number) => {
        pending.delete(id)
      },
    },
    advance(ms: number) {
      now += ms
      for (const [id, entry] of [...pending.entries()]) {
        if (entry.fireAt <= now) {
          pending.delete(id)
          entry.callback()
        }
      }
    },
  }
}

describe('createRecentlyResetGuard', () => {
  it('空集合ではどのトークンもブロックしない', () => {
    const guard = createRecentlyResetGuard(2500)
    expect(guard.has('tok-a')).toBe(false)
  })

  it('add したトークンは TTL 経過までブロックし、経過後に解除される（B4 レース）', () => {
    const { timer, advance } = createFakeTimer()
    const guard = createRecentlyResetGuard(2500, timer)

    // 修正前は .add が存在せず、この時点でも has=false のまま（＝レース防げず）。
    guard.add('tok-a')
    expect(guard.has('tok-a')).toBe(true)

    // TTL 未満: まだブロック（リセット前後に届く古い submitted 購読を無視できる）。
    advance(2000)
    expect(guard.has('tok-a')).toBe(true)

    // TTL 経過: 解除され、以後は有効な提出として反映される。
    advance(600)
    expect(guard.has('tok-a')).toBe(false)
  })

  it('連続 add で TTL を張り直す（最後の add から ttlMs 保持）', () => {
    const { timer, advance } = createFakeTimer()
    const guard = createRecentlyResetGuard(2500, timer)

    guard.add('tok-a')
    advance(2000)
    guard.add('tok-a') // 張り直し
    advance(2000) // 初回 add からは4000ms 経過だが、張り直し後は2000msなのでまだ有効
    expect(guard.has('tok-a')).toBe(true)
    advance(600)
    expect(guard.has('tok-a')).toBe(false)
  })

  it('別トークンは互いに独立してブロック/解除される', () => {
    const { timer, advance } = createFakeTimer()
    const guard = createRecentlyResetGuard(2500, timer)

    guard.add('tok-a')
    advance(1000)
    guard.add('tok-b')

    advance(1600) // tok-a は2600ms経過で解除、tok-b は1600msでまだ有効
    expect(guard.has('tok-a')).toBe(false)
    expect(guard.has('tok-b')).toBe(true)
  })

  it('clear で全トークンとタイマーを解除する', () => {
    const { timer } = createFakeTimer()
    const guard = createRecentlyResetGuard(2500, timer)
    guard.add('tok-a')
    guard.add('tok-b')
    guard.clear()
    expect(guard.has('tok-a')).toBe(false)
    expect(guard.has('tok-b')).toBe(false)
  })

  it('空文字トークンは無視する', () => {
    const guard = createRecentlyResetGuard(2500)
    guard.add('')
    expect(guard.has('')).toBe(false)
  })
})
