// @vitest-environment jsdom
//
// 確認リストパネルが props の definition で項目を切り替えられることの描画テスト(2026-10-14 オーナー指示「テスト教室にも確認リストを設けて」)。
// jsdom で実際に描き、テスト教室の定義(tc- 系・前書きつき)を渡したとき 前書き・見出し・項目・下書きの保存先・送信本文 が
// その定義のものになり、開発用教室の項目(tp- など)が混ざらないことを固定する。作法は verificationChecklistWindow.test.ts と同じ。

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { DeveloperReportSubmitResult } from '../../utils/developerReport'
import { VERIFICATION_CHECKLIST, VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, verificationChecklistStorageKey } from '../../utils/verificationChecklist'
import { TEST_CLASSROOM_VERIFICATION_CHECKLIST, TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET } from '../../utils/verificationChecklistTestClassroom'
import { VerificationChecklistPanel } from './VerificationChecklistPanel'

describe('VerificationChecklistPanel の definition 切り替え', () => {
  const classroomId = TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET.classroomId
  let container: HTMLDivElement
  let root: Root
  let onSubmitNote: Mock<(note: string) => Promise<DeveloperReportSubmitResult>>

  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, 'open')
    onSubmitNote = vi.fn<(note: string) => Promise<DeveloperReportSubmitResult>>(async () => ({ ok: true, reportId: 'r-1' }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const render = (definition?: typeof TEST_CLASSROOM_VERIFICATION_CHECKLIST) => {
    act(() => {
      root.render(createElement(VerificationChecklistPanel, { classroomId, classroomName: 'テスト教室', onSubmitNote, definition }))
    })
  }

  it('テスト教室の定義を渡すと、前書き・対象ラベル・版・tc- の項目だけが描かれる', () => {
    render(TEST_CLASSROOM_VERIFICATION_CHECKLIST)
    const panel = container.querySelector('[data-testid="verification-checklist-panel"]')!
    expect(panel.querySelector('.verification-checklist-title')?.textContent).toBe(`確認リスト ${TEST_CLASSROOM_VERIFICATION_CHECKLIST.version}`)
    expect(panel.querySelector('.verification-checklist-subtitle')?.textContent).toContain('テスト教室(全校展開前の最終テスト)／テスト教室')
    const intro = panel.querySelector('[data-testid="verification-checklist-intro"]')!
    expect(intro).not.toBeNull()
    expect(intro.querySelectorAll('p')).toHaveLength(TEST_CLASSROOM_VERIFICATION_CHECKLIST.intro!.length)
    expect(intro.textContent).toContain('未消化振替')
    for (const item of TEST_CLASSROOM_VERIFICATION_CHECKLIST.items) {
      expect(panel.querySelector(`[data-testid="verification-checklist-item-${item.id}"]`), item.id).not.toBeNull()
    }
    for (const item of VERIFICATION_CHECKLIST.items) {
      expect(panel.querySelector(`[data-testid="verification-checklist-item-${item.id}"]`), item.id).toBeNull()
    }
    // 分類見出しは定義の順(0. 準備 → … → 5.)。
    const areas = [...panel.querySelectorAll('.verification-checklist-area')].map((node) => node.textContent ?? '')
    expect(areas.slice(0, 6).map((area) => area.slice(0, 2))).toEqual(['0.', '1.', '2.', '3.', '4.', '5.'])
    expect(areas[areas.length - 1]).toBe('その他の気づき')
  })

  it('下書きはテスト教室の版のキーに保存され、送信本文はテスト教室の版のマーカーと tc- の id になる', async () => {
    render(TEST_CLASSROOM_VERIFICATION_CHECKLIST)
    const okRadio = container.querySelector<HTMLInputElement>('input[name="verification-checklist-tc-s1"][value="ok"]')!
    act(() => okRadio.click())
    const key = verificationChecklistStorageKey(classroomId, TEST_CLASSROOM_VERIFICATION_CHECKLIST.version)
    expect(key).toBe('verification-checklist:test_classroom_20260507_dai:v1.5.596')
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({ version: 'v1.5.596', entries: { 'tc-s1': { status: 'ok' } } })
    // 開発用教室の版のキーには何も書かない。
    expect(window.localStorage.getItem(verificationChecklistStorageKey(classroomId, VERIFICATION_CHECKLIST.version))).toBeNull()
    expect(container.querySelector('[data-testid="verification-checklist-toggle"]')).toBeNull()
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="verification-checklist-submit"]')!
    await act(async () => {
      submit.click()
      await Promise.resolve()
    })
    expect(onSubmitNote).toHaveBeenCalledTimes(1)
    expect(onSubmitNote.mock.calls[0][0]).toBe('[確認リスト v1.5.596]\n- tc-s1 OK')
  })

  it('definition を省略すると従来どおり開発用教室の定義(前書きなし・「開発用教室のみ」)', () => {
    render(undefined)
    const panel = container.querySelector('[data-testid="verification-checklist-panel"]')!
    expect(panel.querySelector('.verification-checklist-title')?.textContent).toBe(`確認リスト ${VERIFICATION_CHECKLIST.version}`)
    expect(panel.querySelector('.verification-checklist-subtitle')?.textContent).toContain('開発用教室のみ')
    expect(panel.querySelector('[data-testid="verification-checklist-intro"]')).toBeNull()
    expect(panel.querySelector(`[data-testid="verification-checklist-item-${VERIFICATION_CHECKLIST.items[0].id}"]`)).not.toBeNull()
    expect(panel.querySelector('[data-testid="verification-checklist-item-tc-00"]')).toBeNull()
  })
})
