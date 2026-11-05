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

  it('autoPrep の項目(v2-1・tp-64)だけに出す', () => {
    expect(autoPrepIds.sort()).toEqual(['tp-64', 'v2-1'])
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) expect(button(id), id).not.toBeNull()
    expect(button(plainItem.id)).toBeNull()
    expect(container.querySelectorAll('[data-testid^="verification-checklist-prep-"]:not([data-testid="verification-checklist-prep-result"])').length).toBe(autoPrepIds.length)
  })

  it('onPrepare が無ければ(検証用教室でなければ)出さない', () => {
    render({})
    for (const id of autoPrepIds) expect(button(id), id).toBeNull()
  })

  it('押すと onPrepare(itemId)。実行中は無効で「準備中…」、終われば結果文を出し下書きには残さない', async () => {
    let resolvePrepare: (value: { ok: boolean; message: string }) => void = () => {}
    const onPrepare = vi.fn((itemId: string) => {
      void itemId
      return new Promise<{ ok: boolean; message: string }>((resolve) => { resolvePrepare = resolve })
    })
    render({ onPrepare })
    act(() => button('v2-1')!.click())
    expect(onPrepare).toHaveBeenCalledWith('v2-1')
    expect(button('v2-1')!.disabled).toBe(true)
    expect(button('v2-1')!.textContent).toContain('準備中…')
    // 1 つずつ(実行中はほかの項目の「準備する」も押せない)。
    expect(button('tp-64')!.disabled).toBe(true)
    act(() => button('v2-1')!.click())
    expect(onPrepare).toHaveBeenCalledTimes(1)
    await act(async () => { resolvePrepare({ ok: true, message: '11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。' }) })
    expect(button('v2-1')!.disabled).toBe(false)
    expect(button('v2-1')!.textContent).toBe('準備する')
    const result = container.querySelector<HTMLElement>('[data-testid="verification-checklist-prep-result"]')
    expect(result?.textContent).toContain('11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。')
    expect(result?.getAttribute('data-item-id')).toBe('v2-1')
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
    await act(async () => { button('v2-1')!.click() })
    expect(button('v2-1')!.disabled).toBe(false)
    expect(container.querySelector('[data-testid="verification-checklist-prep-result"][data-item-id="v2-1"]')?.textContent).toContain('boom')
  })
})
