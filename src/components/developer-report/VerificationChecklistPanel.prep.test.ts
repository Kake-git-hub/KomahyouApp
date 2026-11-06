// @vitest-environment jsdom
// 確認リストの「準備する」ボタン(2026-11-06 案 C 第 1 段・spec-developer-report §E-2-4)の描画テスト。
// - ボタンは autoPrep の項目だけ・onPrepare が無ければ出さない(App は検証用教室のときだけ渡す)。
// - 押すと onPrepare(itemId)・実行中は無効で「準備中…」・結果文を項目の下に出す(下書きには保存しない)。

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeveloperReportSubmitResult } from '../../utils/developerReport'
import { VERIFICATION_CHECKLIST, VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY } from '../../utils/verificationChecklist'
import { VerificationChecklistPanel, type VerificationChecklistPanelProps } from './VerificationChecklistPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const classroomId = 'v8OZ7zH8vONNHjjYVcR1'
const autoPrepIds = VERIFICATION_CHECKLIST.items.filter((item) => item.autoPrep).map((item) => item.id)
const plainItem = VERIFICATION_CHECKLIST.items.find((item) => !item.autoPrep && item.prep)!

describe('VerificationChecklistPanel の「準備する」', () => {
  let container: HTMLDivElement
  let root: Root
  const onSubmitNote = vi.fn<(note: string) => Promise<DeveloperReportSubmitResult>>(async () => ({ ok: true, reportId: 'r-1' }))

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, 'open')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const render = (props: Partial<VerificationChecklistPanelProps>) => {
    act(() => {
      root.render(createElement(VerificationChecklistPanel, { classroomId, audience: 'development', onSubmitNote, ...props }))
    })
  }
  const button = (itemId: string) => container.querySelector<HTMLButtonElement>(`[data-testid="verification-checklist-prep-${itemId}"]`)

  // 第113版(2026-11-06): v2-1 は OK で確認リストから外したので、autoPrep の項目は tp-64 だけ。
  it('autoPrep の項目(tp-64)だけに出す', () => {
    expect(autoPrepIds.sort()).toEqual(['tp-64'])
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) expect(button(id), id).not.toBeNull()
    expect(button(plainItem.id)).toBeNull()
    expect(container.querySelectorAll('[data-testid^="verification-checklist-prep-"]:not([data-testid="verification-checklist-prep-result"])').length).toBe(autoPrepIds.length)
  })

  it('onPrepare が無ければ(検証用教室でなければ)出さない', () => {
    render({})
    for (const id of autoPrepIds) expect(button(id), id).toBeNull()
  })

  it('ボタンは準備の行の左(準備の文より前)に出る(オーナー指示 2026-11-06 ap-1)', () => {
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) {
      const row = button(id)!.closest('.verification-checklist-prep-row')!
      const text = row.querySelector('.verification-checklist-prep')!
      expect(row.firstElementChild, id).toBe(button(id))
      expect(button(id)!.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
    }
  })

  it('押すと onPrepare(itemId)。実行中は無効で「準備中…」、終われば結果文を出し下書きには残さない', async () => {
    let resolvePrepare: (value: { ok: boolean; message: string }) => void = () => {}
    const onPrepare = vi.fn((itemId: string) => {
      void itemId
      return new Promise<{ ok: boolean; message: string }>((resolve) => { resolvePrepare = resolve })
    })
    render({ onPrepare })
    act(() => button('tp-64')!.click())
    expect(onPrepare).toHaveBeenCalledWith('tp-64')
    expect(button('tp-64')!.disabled).toBe(true)
    expect(button('tp-64')!.textContent).toContain('準備中…')
    // 1 つずつ(実行中は同じボタンをもう一度押しても呼ばない。ほかの項目の「準備する」も同じ preparingItemId で無効になる)。
    act(() => button('tp-64')!.click())
    expect(onPrepare).toHaveBeenCalledTimes(1)
    await act(async () => { resolvePrepare({ ok: true, message: '11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。' }) })
    expect(button('tp-64')!.disabled).toBe(false)
    expect(button('tp-64')!.textContent).toBe('準備する')
    const result = container.querySelector<HTMLElement>('[data-testid="verification-checklist-prep-result"]')
    expect(result?.textContent).toContain('11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。')
    expect(result?.getAttribute('data-item-id')).toBe('tp-64')
    expect(result?.className).toContain('is-ok')
    // 結果文は画面だけ(下書きに保存しない)。
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) ?? ''
      expect(window.localStorage.getItem(key) ?? '').not.toContain('確認用 体験1')
    }
  })

  it('失敗(置けない・断られた)ときは理由を出す。onPrepare が投げても理由を出して押せる状態に戻す', async () => {
    const onPrepare = vi.fn(async () => ({ ok: false, message: '準備できる席が見つかりませんでした。' }))
    render({ onPrepare })
    await act(async () => { button('tp-64')!.click() })
    const result = container.querySelector<HTMLElement>('[data-testid="verification-checklist-prep-result"]')
    expect(result?.textContent).toContain('準備できる席が見つかりませんでした。')
    expect(result?.className).toContain('is-error')

    const throwing = vi.fn(async () => { throw new Error('boom') })
    render({ onPrepare: throwing })
    await act(async () => { button('tp-64')!.click() })
    expect(button('tp-64')!.disabled).toBe(false)
    expect(container.querySelector('[data-testid="verification-checklist-prep-result"][data-item-id="tp-64"]')?.textContent).toContain('boom')
  })

  // 「後片づけ」(2026-11-06 第 2 段・spec-developer-report §E-2-4-2 決定 4): パネルの上の方に 1 つ。onCleanup が無ければ出さない(本番 3 校)。
  const cleanupButton = () => container.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-cleanup"]')
  const cleanupResult = () => container.querySelector<HTMLElement>('[data-testid="verification-checklist-cleanup-result"]')

  it('「後片づけ」は onCleanup があるときだけ出す(無ければ出さない＝本番 3 校)。項目より上(フリーメモより前)に 1 つ', () => {
    render({})
    expect(cleanupButton()).toBeNull()
    render({ onCleanup: vi.fn(async () => ({ ok: true, message: '' })) })
    expect(container.querySelectorAll('[data-testid="verification-checklist-cleanup"]')).toHaveLength(1)
    const freeMemo = container.querySelector('[data-testid="verification-checklist-other-notes"]')!
    expect(cleanupButton()!.compareDocumentPosition(freeMemo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cleanupButton()!.textContent).toBe('後片づけ')
  })

  it('押すと onCleanup。実行中は「後片づけ中…」で無効、終われば結果文を出す(下書きには残さない)', async () => {
    let resolveCleanup: (value: { ok: boolean; message: string }) => void = () => {}
    const onCleanup = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { resolveCleanup = resolve }))
    render({ onCleanup })
    act(() => cleanupButton()!.click())
    expect(onCleanup).toHaveBeenCalledTimes(1)
    expect(cleanupButton()!.disabled).toBe(true)
    expect(cleanupButton()!.textContent).toBe('後片づけ中…')
    act(() => cleanupButton()!.click())
    expect(onCleanup).toHaveBeenCalledTimes(1)
    await act(async () => { resolveCleanup({ ok: true, message: '盤面から消しました: 確認用の体験 2 人・確認用のメモ 0 件・準備で置いた講師 1 人。' }) })
    expect(cleanupButton()!.disabled).toBe(false)
    expect(cleanupButton()!.textContent).toBe('後片づけ')
    expect(cleanupResult()?.textContent).toContain('確認用の体験 2 人')
    expect(cleanupResult()?.className).toContain('is-ok')
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) ?? ''
      expect(window.localStorage.getItem(key) ?? '').not.toContain('確認用の体験 2 人')
    }
  })

  it('失敗・投げたときは理由を出して押せる状態に戻す', async () => {
    render({ onCleanup: vi.fn(async () => { throw new Error('boom') }) })
    await act(async () => { cleanupButton()!.click() })
    expect(cleanupButton()!.disabled).toBe(false)
    expect(cleanupResult()?.textContent).toContain('boom')
    expect(cleanupResult()?.className).toContain('is-error')
  })

  it('準備中は後片づけを押せない。後片づけ中は「準備する」を押せない(同時に 1 つだけ)', async () => {
    let resolvePrepare: (value: { ok: boolean; message: string }) => void = () => {}
    const onPrepare = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { resolvePrepare = resolve }))
    let resolveCleanup: (value: { ok: boolean; message: string }) => void = () => {}
    const onCleanup = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { resolveCleanup = resolve }))
    render({ onPrepare, onCleanup })
    act(() => button('tp-64')!.click())
    expect(cleanupButton()!.disabled).toBe(true)
    act(() => cleanupButton()!.click())
    expect(onCleanup).not.toHaveBeenCalled()
    await act(async () => { resolvePrepare({ ok: true, message: '' }) })
    expect(cleanupButton()!.disabled).toBe(false)

    act(() => cleanupButton()!.click())
    expect(button('tp-64')!.disabled).toBe(true)
    act(() => button('tp-64')!.click())
    expect(onPrepare).toHaveBeenCalledTimes(1)
    await act(async () => { resolveCleanup({ ok: true, message: '片づけるものはありません。' }) })
    expect(button('tp-64')!.disabled).toBe(false)
    expect(cleanupResult()?.textContent).toBe('片づけるものはありません。')
  })
})
