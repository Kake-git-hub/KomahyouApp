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
  openVerificationChecklistWindow,
  prepareVerificationChecklistWindowDocument,
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

describe('VerificationChecklistPanel の別タブ表示', () => {
  const classroomId = 'v8OZ7zH8vONNHjjYVcR1'
  let container: HTMLDivElement
  let root: Root
  let frame: HTMLIFrameElement
  let popup: { window: Window }
  let popupClose: Mock<() => void>
  let onSubmitNote: Mock<(note: string) => Promise<DeveloperReportSubmitResult>>

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
    onSubmitNote = vi.fn<(note: string) => Promise<DeveloperReportSubmitResult>>(async () => ({ ok: true, reportId: 'r-1' }))
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

  it('ポップアップを止められたら右下のまま理由を出す', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    openWindow()
    expect(container.querySelector('[data-testid="verification-checklist-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-result"]')?.textContent).toContain('別タブを開けませんでした')
  })
})
