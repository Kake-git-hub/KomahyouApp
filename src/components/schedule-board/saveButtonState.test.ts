import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSaveBoardButtonState } from './saveButtonState'

// 2026-09-14 オーナー指示: 右上の保存ボタンは 保存・保存中 = 赤 / 最新データ = 緑。
describe('resolveSaveBoardButtonState', () => {
  it('保存中は未保存の有無に関わらず saving', () => {
    expect(resolveSaveBoardButtonState({ isSavingInProgress: true, hasPendingSave: true })).toBe('saving')
    expect(resolveSaveBoardButtonState({ isSavingInProgress: true, hasPendingSave: false })).toBe('saving')
  })

  it('未保存ありは dirty(ラベル「保存」)、なしは clean(ラベル「最新データ」)', () => {
    expect(resolveSaveBoardButtonState({ isSavingInProgress: false, hasPendingSave: true })).toBe('dirty')
    expect(resolveSaveBoardButtonState({ isSavingInProgress: false, hasPendingSave: false })).toBe('clean')
  })
})

describe('保存ボタンの色(App.css)', () => {
  const css = readFileSync(fileURLToPath(new URL('../../App.css', import.meta.url)), 'utf8')
  const backgroundOf = (state: string) => {
    const match = css.match(new RegExp(`\\.primary-button\\.save-board-button\\[data-state='${state}'\\]\\s*\\{([^}]*)\\}`))
    return match?.[1].match(/background:\s*([^;]+);/)?.[1].trim()
  }

  it('保存(dirty)・保存中(saving)は赤、最新データ(clean)は緑', () => {
    expect(backgroundOf('dirty')).toBe('#d93025')
    expect(backgroundOf('saving')).toBe('#d93025')
    expect(backgroundOf('clean')).toBe('#2e7d32')
  })

  it('BoardToolbar の保存ボタンが save-board-button クラスと resolveSaveBoardButtonState を使っている', () => {
    const toolbar = readFileSync(fileURLToPath(new URL('./BoardToolbar.tsx', import.meta.url)), 'utf8')
    expect(toolbar).toContain('className="primary-button slim save-board-button"')
    expect(toolbar).toContain('data-state={resolveSaveBoardButtonState(')
  })
})
