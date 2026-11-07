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

  // 第119版(2026-11-07・オーナー指示「今のシンプルにした文に、いつの誰を追記して」): 項目の操作・結果の {{prep:キー}} は、その項目の最後の準備結果の
  // facts で置き換える。押す前・facts の無い結果(失敗)では既定の言葉(講師 X・生徒 A など)。生の {{prep: は画面に出さない。
  it('操作・結果の {{prep:キー}} を、その項目の最後の準備結果の facts で置き換える(押す前・facts の無い結果では既定の言葉)', async () => {
    const itemCard = (itemId: string) => container.querySelector<HTMLElement>(`[data-testid="verification-checklist-item-${itemId}"]`)!
    let resolvePrepare: (value: { ok: boolean; message: string; facts?: Record<string, string> }) => void = () => {}
    const onPrepare = vi.fn(() => new Promise<{ ok: boolean; message: string; facts?: Record<string, string> }>((resolve) => { resolvePrepare = resolve }))
    render({ onPrepare })
    expect(container.textContent).not.toContain('{{prep:')
    expect(itemCard(PREP_ITEM).textContent).toContain('準備したコマ 机 A の下の行の講師名(講師 X)')
    act(() => button(PREP_ITEM)!.click())
    await act(async () => {
      resolvePrepare({ ok: true, message: '準備しました（2/2(火) 2限）。', facts: { slot: '2/2(火) 2限', deskA: '机 2', X: '講師A', Y: '講師B', A: '確認用 生徒B' } })
    })
    const card = itemCard(PREP_ITEM).textContent ?? ''
    expect(card).toContain('2/2(火) 2限 机 2 の下の行の講師名(講師A)')
    expect(card).toContain('上の行=講師Bと確認用 生徒B、講師欄の下の行=講師A(緑)')
    expect(card).toContain('手入力を採用 → 講師A＋確認用 生徒B の 1 行')
    expect(card).not.toContain('講師 X')
    expect(container.textContent).not.toContain('{{prep:')
    // ほかの項目はその項目の準備結果だけを使う(押していない項目は既定の言葉のまま)。
    expect(itemCard('tp-70').textContent).toContain('講師 X')
    expect(itemCard('tp-70').textContent).not.toContain('講師A')
    // facts の無い結果(失敗)は既定の言葉に戻す(前の準備の名前を残さない)。
    const failing = vi.fn(async () => ({ ok: false, message: '準備できる席が見つかりませんでした。' }))
    render({ onPrepare: failing })
    await act(async () => { button(PREP_ITEM)!.click() })
    expect(itemCard(PREP_ITEM).textContent).toContain('準備したコマ 机 A の下の行の講師名(講師 X)')
    expect(itemCard(PREP_ITEM).textContent).not.toContain('講師A')
    // facts は画面だけ(下書きに保存しない)。
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) ?? ''
      expect(window.localStorage.getItem(key) ?? '').not.toContain('確認用 生徒B')
    }
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

  it('autoPrep の項目の準備の行に、「準備する」の右に「後片づけ」を出す(onCleanup があるときだけ・上の 1 つも残す)', () => {
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })) })
    for (const id of autoPrepIds) expect(itemCleanupButton(id), id).toBeNull()
    render({ onPrepare: vi.fn(async () => ({ ok: true, message: '' })), onCleanup: vi.fn(async () => ({ ok: true, message: '' })) })
    expect(cleanupButton()).not.toBeNull()
    for (const id of autoPrepIds) {
      const cleanup = itemCleanupButton(id)!
      expect(cleanup, id).not.toBeNull()
      expect(cleanup.textContent).toBe('後片づけ')
      const row = button(id)!.closest('.verification-checklist-prep-row')!
      expect(cleanup.closest('.verification-checklist-prep-row'), id).toBe(row)
      expect(button(id)!.nextElementSibling, id).toBe(cleanup)
      expect(cleanup.compareDocumentPosition(row.querySelector('.verification-checklist-prep')!) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
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
    // 結果の欄はその項目の中(準備の行の後ろ)にあり、上の結果欄には出さない。
    const itemCard = button(PREP_ITEM)!.closest('.verification-checklist-prep-row')!.parentElement!
    expect(itemCard.contains(result!)).toBe(true)
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
