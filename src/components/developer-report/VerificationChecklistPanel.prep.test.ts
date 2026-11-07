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
const plainItem = VERIFICATION_CHECKLIST.items.find((item) => !item.autoPrep)!
// 押して確かめる autoPrep の項目(確認リストに残っているもの)。
const PREP_ITEM = 'tp-69'

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

  // 第113版(2026-11-06): v2-1 は OK で確認リストから外した。第116版(2026-11-07・v1.5.696): tp-64 も OK で外し、tp-59・tp-69・tp-70・mn-1・tp-66 に広げた。
  it('autoPrep の項目(tp-59・tp-69・tp-70・mn-1・tp-66・第 4 段の tp-71・tp-72・tp-75・v2-3・v2-6)だけに出す', () => {
    expect([...autoPrepIds].sort()).toEqual(['mn-1', 'tp-59', 'tp-66', 'tp-69', 'tp-70', 'tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'])
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) expect(button(id), id).not.toBeNull()
    expect(button(plainItem.id)).toBeNull()
    // 文に「準備する」を含むが autoPrep ではない項目(tp-69 の準備を使う ap-3・ta-1)にはボタンを出さない。
    for (const id of ['ap-3', 'ta-1']) expect(button(id), id).toBeNull()
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
      const text = row.querySelector('.verification-checklist-step-text')!
      expect(row.firstElementChild, id).toBe(button(id))
      expect(button(id)!.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
    }
  })

  // 第120版(2026-11-07・オーナー指示「準備する→操作 にこだわらず、操作の手順の一つとして、正しい手順で準備するを交えて。項目は 操作 → 確認 だけ」)。
  it('項目の見出しは「操作」「確認」の 2 つだけ。「準備する」は操作の手順の行(その手順の位置)に出る', () => {
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    const cards = [...container.querySelectorAll<HTMLElement>('[data-testid^="verification-checklist-item-"]')]
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const labels = [...card.querySelectorAll('.verification-checklist-label')].map((node) => node.textContent)
      expect(labels.filter((label) => label !== '確認'), card.dataset.testid).toEqual(['操作'])
      expect(card.querySelector('.verification-checklist-prep:not(.verification-checklist-prep-button):not(.verification-checklist-prep-result):not(.verification-checklist-prep-row)'), card.dataset.testid).toBeNull()
    }
    for (const id of autoPrepIds) {
      const item = VERIFICATION_CHECKLIST.items.find((entry) => entry.id === id)!
      const stepItems = [...button(id)!.closest('.verification-checklist-steps')!.children]
      const owner = button(id)!.closest('li')!
      expect(stepItems.indexOf(owner), id).toBe(0)
      expect(owner.querySelector('.verification-checklist-step-text')?.textContent, id).toBe(item.steps[0])
      // 手順の数は定義どおり(準備の手順を二重に出さない)。
      expect(stepItems.length, id).toBe(item.steps.length)
    }
  })

  it('押すと onPrepare(itemId)。実行中は無効で「準備中…」、終われば結果文を出し下書きには残さない', async () => {
    let resolvePrepare: (value: { ok: boolean; message: string }) => void = () => {}
    const onPrepare = vi.fn((itemId: string) => {
      void itemId
      return new Promise<{ ok: boolean; message: string }>((resolve) => { resolvePrepare = resolve })
    })
    render({ onPrepare })
    act(() => button(PREP_ITEM)!.click())
    expect(onPrepare).toHaveBeenCalledWith(PREP_ITEM)
    expect(button(PREP_ITEM)!.disabled).toBe(true)
    expect(button(PREP_ITEM)!.textContent).toContain('準備中…')
    // 1 つずつ(実行中は同じボタンをもう一度押しても呼ばない。ほかの項目の「準備する」も同じ preparingItemId で無効になる)。
    act(() => button(PREP_ITEM)!.click())
    expect(onPrepare).toHaveBeenCalledTimes(1)
    await act(async () => { resolvePrepare({ ok: true, message: '11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。' }) })
    expect(button(PREP_ITEM)!.disabled).toBe(false)
    expect(button(PREP_ITEM)!.textContent).toBe('準備する')
    const result = container.querySelector<HTMLElement>('[data-testid="verification-checklist-prep-result"]')
    expect(result?.textContent).toContain('11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました。')
    expect(result?.getAttribute('data-item-id')).toBe(PREP_ITEM)
    // 第120版(2026-11-07): 結果文は準備の手順の行(li)の中に出す。
    expect(button(PREP_ITEM)!.closest('li')!.contains(result!)).toBe(true)
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
    await act(async () => { button(PREP_ITEM)!.click() })
    const result = container.querySelector<HTMLElement>('[data-testid="verification-checklist-prep-result"]')
    expect(result?.textContent).toContain('準備できる席が見つかりませんでした。')
    expect(result?.className).toContain('is-error')

    const throwing = vi.fn(async () => { throw new Error('boom') })
    render({ onPrepare: throwing })
    await act(async () => { button(PREP_ITEM)!.click() })
    expect(button(PREP_ITEM)!.disabled).toBe(false)
    expect(container.querySelector(`[data-testid="verification-checklist-prep-result"][data-item-id="${PREP_ITEM}"]`)?.textContent).toContain('boom')
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
    act(() => button(PREP_ITEM)!.click())
    expect(cleanupButton()!.disabled).toBe(true)
    act(() => cleanupButton()!.click())
    expect(onCleanup).not.toHaveBeenCalled()
    await act(async () => { resolvePrepare({ ok: true, message: '' }) })
    expect(cleanupButton()!.disabled).toBe(false)

    act(() => cleanupButton()!.click())
    expect(button(PREP_ITEM)!.disabled).toBe(true)
    act(() => button(PREP_ITEM)!.click())
    expect(onPrepare).toHaveBeenCalledTimes(1)
    await act(async () => { resolveCleanup({ ok: true, message: '片づけるものはありません。' }) })
    expect(button(PREP_ITEM)!.disabled).toBe(false)
    expect(cleanupResult()?.textContent).toBe('片づけるものはありません。')
  })

  // 第116版(2026-11-07・確認リスト ap-3「後片付けのボタンが出てこない」): 上の 1 つだけでは、項目を見ながら下へ送っていると見つからない。
  // autoPrep の項目の準備の行(「準備する」の右)にも同じ「後片づけ」を出す。処理は同じ onCleanup・同時に 1 つだけ・結果はその項目の下に出す。
  const ITEM_CLEANUP_NOTE = '準備で作ったものを全部消します'
  const itemCleanupButton = (itemId: string) => container.querySelector<HTMLButtonElement>(`[data-testid="verification-checklist-cleanup-${itemId}"]`)
  const itemCleanupResult = (itemId: string) => container.querySelector<HTMLElement>(`[data-testid="verification-checklist-cleanup-result-${itemId}"]`)

  // 第121版(2026-11-07・オーナー指示「後片づけは確認の最後に持ってきて」): 項目の「後片づけ」は準備の行ではなく、確認の一覧のすぐ後ろに出す。
  it('autoPrep の項目の「後片づけ」は確認の最後(確認の一覧のすぐ後ろ)に出す(onCleanup があるときだけ・上の 1 つも残す)', () => {
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) expect(itemCleanupButton(id), id).toBeNull()
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })), onCleanup: vi.fn(async () => ({ ok: true, message: '' })) })
    expect(cleanupButton()).not.toBeNull()
    for (const id of autoPrepIds) {
      const cleanup = itemCleanupButton(id)!
      expect(cleanup, id).not.toBeNull()
      expect(cleanup.textContent).toBe('後片づけ')
      // 準備の行には出さない(「準備する」の隣は手順の文)。
      expect(button(id)!.closest('.verification-checklist-prep-row')!.contains(cleanup), id).toBe(false)
      const row = cleanup.closest('.verification-checklist-cleanup-item-row')!
      expect(row, id).not.toBeNull()
      // 確認の一覧のすぐ後ろ(状態の選択より前)。
      const card = button(id)!.closest('[data-testid^="verification-checklist-item-"]')!
      const checkList = card.querySelector('.verification-checklist-check')!
      expect(checkList.nextElementSibling, id).toBe(row)
      expect(row.nextElementSibling?.classList.contains('verification-checklist-status'), id).toBe(true)
      expect(row.firstElementChild, id).toBe(cleanup)
      // regression-reviewer S-1: 項目の「後片づけ」もその項目の分だけでなく準備で作ったもの全部を消すので、ボタンの横に短く書く(title にも)。
      expect(cleanup.getAttribute('title'), id).toBe(ITEM_CLEANUP_NOTE)
      const note = row.querySelector('.verification-checklist-cleanup-note')
      expect(note?.textContent, id).toBe(ITEM_CLEANUP_NOTE)
      expect(cleanup.nextElementSibling, id).toBe(note)
    }
    expect(itemCleanupButton(plainItem.id)).toBeNull()
  })

  it('項目の「後片づけ」を押すと onCleanup。結果はその項目の下に出し(上の結果欄には出さない)、実行中はどの「後片づけ」も「準備する」も押せない', async () => {
    let resolveCleanup: (value: { ok: boolean; message: string }) => void = () => {}
    const onCleanup = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { resolveCleanup = resolve }))
    const onPrepare = vi.fn(async () => ({ ok: true, message: '' }))
    render({ onPrepare, onCleanup })
    act(() => itemCleanupButton(PREP_ITEM)!.click())
    expect(onCleanup).toHaveBeenCalledTimes(1)
    expect(itemCleanupButton(PREP_ITEM)!.textContent).toBe('後片づけ中…')
    expect(itemCleanupButton(PREP_ITEM)!.disabled).toBe(true)
    expect(cleanupButton()!.disabled).toBe(true)
    expect(cleanupButton()!.textContent).toBe('後片づけ')
    for (const id of autoPrepIds) {
      expect(button(id)!.disabled, id).toBe(true)
      expect(itemCleanupButton(id)!.disabled, id).toBe(true)
    }
    act(() => cleanupButton()!.click())
    act(() => button(PREP_ITEM)!.click())
    expect(onCleanup).toHaveBeenCalledTimes(1)
    expect(onPrepare).not.toHaveBeenCalled()
    await act(async () => { resolveCleanup({ ok: true, message: '盤面から消しました: 確認用の体験 1 人・確認用のメモ 0 件・準備で置いた講師 1 人。' }) })
    expect(itemCleanupButton(PREP_ITEM)!.disabled).toBe(false)
    expect(itemCleanupButton(PREP_ITEM)!.textContent).toBe('後片づけ')
    const result = itemCleanupResult(PREP_ITEM)
    expect(result?.textContent).toContain('確認用の体験 1 人')
    expect(result?.className).toContain('is-ok')
    // 結果の欄はその項目の中(確認の最後の「後片づけ」のすぐ下)にあり、上の結果欄には出さない。
    const itemCard = button(PREP_ITEM)!.closest('[data-testid^="verification-checklist-item-"]')!
    expect(itemCard.contains(result!)).toBe(true)
    expect(itemCleanupButton(PREP_ITEM)!.closest('.verification-checklist-cleanup-item-row')!.nextElementSibling).toBe(result)
    expect(cleanupResult()).toBeNull()
    // 上の「後片づけ」を押すと、結果は上の欄に出る(項目の下の古い結果は消える)。
    const onCleanupTop = vi.fn(async () => ({ ok: true, message: '片づけるものはありません。' }))
    render({ onPrepare, onCleanup: onCleanupTop })
    await act(async () => { cleanupButton()!.click() })
    expect(cleanupResult()?.textContent).toBe('片づけるものはありません。')
    expect(itemCleanupResult(PREP_ITEM)).toBeNull()
  })

  it('項目の「後片づけ」が投げても理由をその項目の下に出して押せる状態に戻す', async () => {
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })), onCleanup: vi.fn(async () => { throw new Error('boom') }) })
    await act(async () => { itemCleanupButton(PREP_ITEM)!.click() })
    expect(itemCleanupButton(PREP_ITEM)!.disabled).toBe(false)
    expect(itemCleanupResult(PREP_ITEM)?.textContent).toContain('boom')
    expect(itemCleanupResult(PREP_ITEM)?.className).toContain('is-error')
  })
})
