// @vitest-environment jsdom
// 別タブ表示の共通補助(確認リスト 2026-10-14 → 質問・要望 2026-10-29 で共通化)。
// - prepareDetachedWindowDocument: 元の文書のスタイルを写し、呼び出し側のクラス・入れ物 id で作る(使い回しても重ならない)。
// - openNamedBlankWindow: 名前付きの空タブ・止められたら null。
// - watchDetachedWindow: 別タブが閉じたら知らせ、元のタブが閉じるときは別タブも閉じる。後始末で見張りを外して閉じる。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DETACHED_WINDOW_CLOSED_POLL_MS, openNamedBlankWindow, prepareDetachedWindowDocument, watchDetachedWindow } from './detachedWindow'

describe('prepareDetachedWindowDocument', () => {
  it('元の文書のスタイルを写し、渡したクラス・入れ物 id・題名で作る', () => {
    const source = document.implementation.createHTMLDocument('src')
    source.documentElement.lang = 'ja'
    source.head.innerHTML = '<style>.a{color:red}</style><link rel="icon" href="/favicon.ico">'
    const target = document.implementation.createHTMLDocument('')

    const root = prepareDetachedWindowDocument(source, target, { title: '質問・要望（教室A）', className: 'developer-report-window', rootId: 'developer-report-window-root' })

    expect(target.title).toBe('質問・要望（教室A）')
    expect(target.documentElement.lang).toBe('ja')
    expect(target.head.querySelector('style')?.textContent).toBe('.a{color:red}')
    expect(target.head.querySelectorAll('link')).toHaveLength(0)
    expect(target.documentElement.className).toBe('developer-report-window')
    expect(target.body.className).toBe('developer-report-window')
    expect(root.id).toBe('developer-report-window-root')
    expect(root.parentElement).toBe(target.body)
  })

  it('使い回したタブでも作り直す(スタイル・入れ物が重ならない)', () => {
    const source = document.implementation.createHTMLDocument('src')
    source.head.innerHTML = '<style>.a{}</style>'
    const target = document.implementation.createHTMLDocument('')
    const layout = { title: 'x', className: 'c', rootId: 'r' }
    prepareDetachedWindowDocument(source, target, layout)
    prepareDetachedWindowDocument(source, target, layout)
    expect(target.head.querySelectorAll('style')).toHaveLength(1)
    expect(target.body.children).toHaveLength(1)
  })
})

describe('openNamedBlankWindow', () => {
  it('名前付きの空タブを開く・止められたら null', () => {
    const fakeWindow = {} as Window
    const open = vi.fn(() => fakeWindow)
    expect(openNamedBlankWindow({ open }, 'komahyou-x')).toBe(fakeWindow)
    expect(open).toHaveBeenCalledWith('', 'komahyou-x')
    expect(openNamedBlankWindow({ open: () => null }, 'komahyou-x')).toBeNull()
    expect(openNamedBlankWindow({ open: () => { throw new Error('blocked') } }, 'komahyou-x')).toBeNull()
  })
})

describe('watchDetachedWindow', () => {
  let frame: HTMLIFrameElement
  let win: Window
  let close: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    frame = document.createElement('iframe')
    document.body.append(frame)
    win = frame.contentWindow!
    close = vi.fn(() => {
      Object.defineProperty(win, 'closed', { value: true, configurable: true })
    })
    win.close = close as unknown as () => void
  })

  afterEach(() => {
    frame.remove()
    vi.useRealTimers()
  })

  it('別タブの pagehide で知らせる', () => {
    const onGone = vi.fn()
    const stop = watchDetachedWindow(window, win, onGone)
    win.dispatchEvent(new Event('pagehide'))
    expect(onGone).toHaveBeenCalledTimes(1)
    stop()
  })

  it('pagehide を取りこぼしても、閉じたことを一定間隔で見て知らせる', () => {
    const onGone = vi.fn()
    const stop = watchDetachedWindow(window, win, onGone)
    vi.advanceTimersByTime(DETACHED_WINDOW_CLOSED_POLL_MS)
    expect(onGone).not.toHaveBeenCalled()
    Object.defineProperty(win, 'closed', { value: true, configurable: true })
    vi.advanceTimersByTime(DETACHED_WINDOW_CLOSED_POLL_MS)
    expect(onGone).toHaveBeenCalled()
    stop()
  })

  it('元のタブが閉じる(pagehide)ときは別タブも閉じる', () => {
    const stop = watchDetachedWindow(window, win, vi.fn())
    window.dispatchEvent(new Event('pagehide'))
    expect(close).toHaveBeenCalledTimes(1)
    stop()
  })

  it('後始末で別タブを閉じ、以後は何も知らせない(見張りを外す)', () => {
    const onGone = vi.fn()
    const stop = watchDetachedWindow(window, win, onGone)
    stop()
    expect(close).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(DETACHED_WINDOW_CLOSED_POLL_MS * 3)
    expect(onGone).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
