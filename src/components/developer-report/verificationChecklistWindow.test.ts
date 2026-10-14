// @vitest-environment jsdom
// 確認リストの別タブ表示(2026-10-14 オーナー指示「確認リストを別タブでひらけるようにして」)。
// - 補助関数: 別タブの文書へアプリのスタイルを写し、入れ物を作る(使い回しても中身が重ならない)。
// - パネル: 「別タブで開く」で別の文書へ描かれ、そこでの操作が同じ下書き(localStorage)・同じ送信経路に届く。
//   別タブを閉じる/「元の画面に戻す」/パネルが外れると、右下の表示へ戻り別タブは閉じる。
// 別タブは jsdom の iframe の window(別の文書)で代用する(window.open を差し替える)。

import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { DeveloperReportSubmitResult } from '../../utils/developerReport'

import { VerificationChecklistPanel } from './VerificationChecklistPanel'
import {
  VERIFICATION_CHECKLIST_WINDOW_BODY_CLASS,
  VERIFICATION_CHECKLIST_WINDOW_NAME,
  VERIFICATION_CHECKLIST_WINDOW_ROOT_ID,
  VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT,
  VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS,
  VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY,
  openVerificationChecklistWindow,
  parseVerificationChecklistWindowZoom,
  prepareVerificationChecklistWindowDocument,
  stepVerificationChecklistWindowZoom,
  verificationChecklistWindowZoomToCss,
} from './verificationChecklistWindow'
import { VERIFICATION_CHECKLIST, VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, verificationChecklistStorageKey } from '../../utils/verificationChecklist'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('prepareVerificationChecklistWindowDocument', () => {
  it('元の文書の <style> と <link rel="stylesheet">(絶対 URL)を写し、題名・入れ物を作る', () => {
    // 元の文書は本番と同じくアプリのページ(URL を持つ文書)。about:blank の文書では相対 URL が解決できないため。
    const source = document
    source.documentElement.lang = 'ja'
    const previousHead = source.head.innerHTML
    source.head.innerHTML = '<style>.a{color:red}</style><link rel="stylesheet" href="/assets/index.css"><link rel="icon" href="/favicon.ico">'
    const target = document.implementation.createHTMLDocument('')

    const root = prepareVerificationChecklistWindowDocument(source, target, '確認リスト v1')
    source.head.innerHTML = previousHead

    expect(target.title).toBe('確認リスト v1')
    expect(target.documentElement.lang).toBe('ja')
    expect(target.head.querySelector('style')?.textContent).toBe('.a{color:red}')
    const links = [...target.head.querySelectorAll('link')]
    expect(links).toHaveLength(1)
    expect(links[0].rel).toBe('stylesheet')
    // 元の文書で解決した絶対 URL(about:blank のタブでも同じ CSS を読める)。
    expect(links[0].getAttribute('href')).toBe(new URL('/assets/index.css', document.baseURI).href)
    expect(target.documentElement.className).toBe(VERIFICATION_CHECKLIST_WINDOW_BODY_CLASS)
    expect(target.body.className).toBe(VERIFICATION_CHECKLIST_WINDOW_BODY_CLASS)
    expect(root.id).toBe(VERIFICATION_CHECKLIST_WINDOW_ROOT_ID)
    expect(root.parentElement).toBe(target.body)
  })

  it('使い回したタブでも作り直す(スタイル・入れ物が重ならない)', () => {
    const source = document.implementation.createHTMLDocument('src')
    source.head.innerHTML = '<style>.a{}</style>'
    const target = document.implementation.createHTMLDocument('')
    prepareVerificationChecklistWindowDocument(source, target, 'x')
    prepareVerificationChecklistWindowDocument(source, target, 'x')
    expect(target.head.querySelectorAll('style')).toHaveLength(1)
    expect(target.body.children).toHaveLength(1)
  })
})

describe('openVerificationChecklistWindow', () => {
  it('名前付きの空タブを開く(2 回押しても同じタブ)・止められたら null', () => {
    const fakeWindow = {} as Window
    const open = vi.fn(() => fakeWindow)
    expect(openVerificationChecklistWindow({ open })).toBe(fakeWindow)
    expect(open).toHaveBeenCalledWith('', VERIFICATION_CHECKLIST_WINDOW_NAME)
    expect(openVerificationChecklistWindow({ open: () => null })).toBeNull()
    expect(openVerificationChecklistWindow({ open: () => { throw new Error('blocked') } })).toBeNull()
  })
})

describe('別タブの拡大率(2026-10-14 オーナー指摘「別タブ時の拡大縮小は独立でできるようにして」)', () => {
  it('保存値は一覧にある値だけ受け付け、それ以外は既定の 100%', () => {
    expect(VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT).toBe(100)
    expect(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS).toContain(100)
    expect([...VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS]).toEqual([...VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS].sort((a, b) => a - b))
    expect(parseVerificationChecklistWindowZoom('150')).toBe(150)
    expect(parseVerificationChecklistWindowZoom(' 80 ')).toBe(80)
    expect(parseVerificationChecklistWindowZoom(125)).toBe(125)
    for (const bad of [null, undefined, '', 'abc', '99', '1000', '-50', NaN]) expect(parseVerificationChecklistWindowZoom(bad), String(bad)).toBe(100)
  })

  it('1 段ずつ動き、端で止まる。一覧に無い現在値は 100% を基準に動く', () => {
    expect(stepVerificationChecklistWindowZoom(100, 1)).toBe(110)
    expect(stepVerificationChecklistWindowZoom(100, -1)).toBe(90)
    expect(stepVerificationChecklistWindowZoom(200, 1)).toBe(200)
    expect(stepVerificationChecklistWindowZoom(50, -1)).toBe(50)
    expect(stepVerificationChecklistWindowZoom(123, 1)).toBe(110)
  })

  it('CSS zoom は倍率(100% → 1・150% → 1.5)。不正値は 1', () => {
    expect(verificationChecklistWindowZoomToCss(100)).toBe(1)
    expect(verificationChecklistWindowZoomToCss(150)).toBe(1.5)
    expect(verificationChecklistWindowZoomToCss(0)).toBe(1)
  })

  it('保存キーは別タブ専用(右下の浮き窓の折りたたみ・下書きのキーと別)', () => {
    expect(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY).toBe('verification-checklist:window-zoom')
    expect(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY).not.toBe(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY)
  })
})

describe('VerificationChecklistPanel の別タブ表示', () => {
  const classroomId = 'v8OZ7zH8vONNHjjYVcR1'
  let container: HTMLDivElement
  let root: Root
  let frame: HTMLIFrameElement
  let popup: { window: Window }
  let popupClose: Mock<() => void>
  let onSubmitNote: Mock<(note: string, attachments?: unknown) => Promise<DeveloperReportSubmitResult>>

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, 'open')
    frame = document.createElement('iframe')
    document.body.append(frame)
    popup = { window: frame.contentWindow! }
    popupClose = vi.fn<() => void>(() => {
      Object.defineProperty(popup.window, 'closed', { value: true, configurable: true })
    })
    popup.window.close = popupClose
    popup.window.focus = vi.fn()
    vi.spyOn(window, 'open').mockImplementation(() => popup.window)
    onSubmitNote = vi.fn<(note: string, attachments?: unknown) => Promise<DeveloperReportSubmitResult>>(async () => ({ ok: true, reportId: 'r-1' }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root.render(createElement(VerificationChecklistPanel, { classroomId, onSubmitNote }))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    frame.remove()
    vi.restoreAllMocks()
  })

  const openWindow = () => {
    const button = container.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-open-window"]')
    expect(button).not.toBeNull()
    act(() => button!.click())
  }

  it('「別タブで開く」でパネルが別の文書へ移り、元の画面には「別タブで表示中」だけが残る', () => {
    openWindow()
    expect(window.open).toHaveBeenCalledWith('', VERIFICATION_CHECKLIST_WINDOW_NAME)
    const popupDoc = popup.window.document
    expect(popupDoc.querySelector('[data-testid="verification-checklist-panel"]')?.className).toContain('is-detached')
    expect(popupDoc.querySelector('[data-testid="verification-checklist-return"]')).not.toBeNull()
    expect(popupDoc.querySelector('[data-testid="verification-checklist-open-window"]')).toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-panel"]')).toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-detached-toggle"]')?.textContent).toContain('別タブで表示中')
  })

  it('別タブでの記入は元のタブと同じ下書き・同じ送信経路に届く', async () => {
    openWindow()
    const popupDoc = popup.window.document
    const firstItem = VERIFICATION_CHECKLIST.items[0]
    const okRadio = popupDoc.querySelector<HTMLInputElement>(`input[name="verification-checklist-${firstItem.id}"][value="ok"]`)
    expect(okRadio).not.toBeNull()
    act(() => okRadio!.click())

    const saved = JSON.parse(window.localStorage.getItem(verificationChecklistStorageKey(classroomId)) ?? '{}')
    expect(saved.entries?.[firstItem.id]?.status).toBe('ok')

    const submit = popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-submit"]')
    await act(async () => {
      submit!.click()
    })
    expect(onSubmitNote).toHaveBeenCalledTimes(1)
    expect(String(onSubmitNote.mock.calls[0][0])).toContain(firstItem.id)
    expect(popupDoc.querySelector('[data-testid="verification-checklist-result"]')?.textContent).toContain('送りました')
  })

  it('「元の画面に戻す」で別タブを閉じ、右下へ戻る(記入は残る)', () => {
    openWindow()
    const popupDoc = popup.window.document
    const firstItem = VERIFICATION_CHECKLIST.items[0]
    act(() => popupDoc.querySelector<HTMLInputElement>(`input[name="verification-checklist-${firstItem.id}"][value="needs-fix"]`)!.click())
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-return"]')!.click())

    expect(popupClose).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="verification-checklist-panel"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>(`input[name="verification-checklist-${firstItem.id}"][value="needs-fix"]`)?.checked).toBe(true)
  })

  it('別タブが閉じられたら(pagehide)右下へ戻る', () => {
    openWindow()
    act(() => {
      popup.window.dispatchEvent(new Event('pagehide'))
    })
    expect(container.querySelector('[data-testid="verification-checklist-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-detached-toggle"]')).toBeNull()
  })

  it('元のタブが閉じる/再読み込みする(pagehide)・パネルが外れると別タブも閉じる', () => {
    openWindow()
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(popupClose).toHaveBeenCalledTimes(1)

    popupClose.mockClear()
    Object.defineProperty(popup.window, 'closed', { value: false, configurable: true })
    act(() => root.render(createElement(VerificationChecklistPanel, { classroomId, onSubmitNote })))
    act(() => root.render(createElement(Fragment)))
    expect(popupClose).toHaveBeenCalledTimes(1)
  })

  it('別タブの「＋/－」はそのタブのパネルだけ CSS zoom で拡大縮小し、値は別タブ専用キーに残る。右下へ戻ると zoom は付かない', () => {
    openWindow()
    const popupDoc = popup.window.document
    const panel = () => popupDoc.querySelector<HTMLElement>('[data-testid="verification-checklist-panel"]')!
    expect(panel().style.zoom).toBe('1')
    expect(popupDoc.querySelector('[data-testid="verification-checklist-zoom-value"]')?.textContent).toBe('100%')
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-zoom-in"]')!.click())
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-zoom-in"]')!.click())
    expect(panel().style.zoom).toBe('1.25')
    expect(popupDoc.querySelector('[data-testid="verification-checklist-zoom-value"]')?.textContent).toBe('125%')
    expect(window.localStorage.getItem(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY)).toBe('125')
    // 下書きには混ざらない。
    expect(window.localStorage.getItem(verificationChecklistStorageKey(classroomId)) ?? '').not.toContain('125')
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-zoom-out"]')!.click())
    expect(panel().style.zoom).toBe('1.1')
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-zoom-value"]')!.click())
    expect(panel().style.zoom).toBe('1')
    expect(window.localStorage.getItem(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY)).toBe('100')

    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-zoom-in"]')!.click())
    act(() => popupDoc.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-return"]')!.click())
    const mainPanel = container.querySelector<HTMLElement>('[data-testid="verification-checklist-panel"]')!
    expect(mainPanel.style.zoom).toBe('')
    expect(container.querySelector('[data-testid="verification-checklist-zoom"]')).toBeNull()
  })

  it('保存してあった拡大率で別タブが開く', () => {
    window.localStorage.setItem(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY, '150')
    act(() => root.render(createElement(Fragment)))
    act(() => root.render(createElement(VerificationChecklistPanel, { classroomId, onSubmitNote })))
    openWindow()
    expect(popup.window.document.querySelector<HTMLElement>('[data-testid="verification-checklist-panel"]')!.style.zoom).toBe('1.5')
  })

  // 添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)。縮小は差し替え(shrinkImage)で固定する。
  it('画像の貼り付け(Ctrl+V)・ファイル選択で項目に画像が付き、下書きに残り、送信の 1 通目に label=項目 id で同梱される', async () => {
    const dataUrl = `data:image/jpeg;base64,${Buffer.alloc(12, 1).toString('base64')}`
    const shrinkImage = vi.fn(async (file: File) => ({ name: file.name || '貼り付け', dataUrl }))
    act(() => root.render(createElement(Fragment)))
    act(() => root.render(createElement(VerificationChecklistPanel, { classroomId, onSubmitNote, shrinkImage })))
    const firstItem = VERIFICATION_CHECKLIST.items[0]
    const memo = container.querySelector<HTMLTextAreaElement>(`[data-testid="verification-checklist-memo-${firstItem.id}"]`)!
    const pasted = new File(['x'], '', { type: 'image/png' })
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown }
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [pasted], getData: () => '' } })
    await act(async () => {
      memo.dispatchEvent(pasteEvent)
    })
    expect(shrinkImage).toHaveBeenCalledWith(pasted)
    const attachments = () => container.querySelectorAll(`[data-testid="verification-checklist-attachments-${firstItem.id}"] img`)
    expect(attachments()).toHaveLength(1)
    expect(attachments()[0].getAttribute('src')).toBe(dataUrl)
    // 未確認のまま画像を付けたので要改善になる(メモと同じ)。
    expect(container.querySelector<HTMLInputElement>(`input[name="verification-checklist-${firstItem.id}"][value="needs-fix"]`)?.checked).toBe(true)
    const saved = JSON.parse(window.localStorage.getItem(verificationChecklistStorageKey(classroomId)) ?? '{}')
    expect(saved.attachments).toHaveLength(1)
    expect(saved.attachments[0]).toMatchObject({ itemId: firstItem.id, dataUrl })

    // ファイル選択
    const input = container.querySelector<HTMLInputElement>(`[data-testid="verification-checklist-attach-${firstItem.id}"]`)!
    const chosen = new File(['y'], 'shot.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [chosen], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(attachments()).toHaveLength(2)
    expect(container.querySelector(`[data-testid="verification-checklist-attachments-${firstItem.id}"]`)?.textContent).toContain('shot.png')

    // 文字の貼り付けは画像扱いしない(shrinkImage を呼ばない)。
    const textPaste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(textPaste, 'clipboardData', { value: { files: [], getData: () => 'abc' } })
    await act(async () => { memo.dispatchEvent(textPaste) })
    expect(shrinkImage).toHaveBeenCalledTimes(2)
    expect(textPaste.defaultPrevented).toBe(false)

    // 送信: 1 通目に添付が label=項目 id で付く
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-submit"]')!.click()
    })
    expect(onSubmitNote).toHaveBeenCalledTimes(1)
    const [note, sent] = onSubmitNote.mock.calls[0] as unknown as [string, Array<{ label: string; name: string; dataUrl: string }>]
    expect(note).toContain(`${firstItem.id} 要改善: [画像2枚]`)
    expect(sent.map((attachment) => attachment.label)).toEqual([firstItem.id, firstItem.id])
    expect(sent[1].name).toBe('shot.png')
    expect(container.querySelector('[data-testid="verification-checklist-result"]')?.textContent).toContain('画像 2 枚')

    // 外すと消える
    const removeButton = container.querySelector<HTMLButtonElement>(`[data-testid^="verification-checklist-attachment-remove-"]`)!
    act(() => removeButton.click())
    expect(attachments()).toHaveLength(1)
  })

  it('画像を読めなかったときは理由を出し、下書きは変えない', async () => {
    const shrinkImage = vi.fn(async () => { throw new Error('canvas が使えません') })
    act(() => root.render(createElement(Fragment)))
    act(() => root.render(createElement(VerificationChecklistPanel, { classroomId, onSubmitNote, shrinkImage })))
    const firstItem = VERIFICATION_CHECKLIST.items[0]
    const input = container.querySelector<HTMLInputElement>(`[data-testid="verification-checklist-attach-${firstItem.id}"]`)!
    Object.defineProperty(input, 'files', { value: [new File(['y'], 'bad.png', { type: 'image/png' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector('[data-testid="verification-checklist-result"]')?.textContent).toContain('bad.png')
    expect(container.querySelectorAll(`[data-testid="verification-checklist-attachments-${firstItem.id}"] img`)).toHaveLength(0)
    expect(window.localStorage.getItem(verificationChecklistStorageKey(classroomId))).toBeNull()
  })

  it('ポップアップを止められたら右下のまま理由を出す', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    openWindow()
    expect(container.querySelector('[data-testid="verification-checklist-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-result"]')?.textContent).toContain('別タブを開けませんでした')
  })
})
