// --workspace 必須化(2026-09-16 複数会社展開 Phase 0 T0-4)の回帰防止テスト。
// 既定 workspace='main' への暗黙フォールバックが復活していないことを固定する。
// import しても main() が走らない(isDirectRun ガード)前提で parseArgs/validateArgs だけを検証する。
import { describe, it, expect } from 'vitest'
import { parseArgs, validateArgs } from './lesson-history-diagnose.mjs'

describe('parseArgs', () => {
  it('--workspace を読み取る(既定値は無い)', () => {
    const options = parseArgs(['--workspace', 'main'])
    expect(options.workspaceKey).toBe('main')
  })

  it('未指定なら workspaceKey は空文字のまま', () => {
    expect(parseArgs([]).workspaceKey).toBe('')
  })

  it('classroomId は既定の開発用教室のまま(こちらは変更対象外)', () => {
    expect(parseArgs([]).classroomId).toBe('v8OZ7zH8vONNHjjYVcR1')
  })
})

describe('validateArgs', () => {
  it('--workspace 無しはエラー', () => {
    expect(validateArgs({ workspaceKey: '' })).toEqual(['--workspace <key> は必須です。'])
  })

  it('--workspace 有りはエラー無し', () => {
    expect(validateArgs({ workspaceKey: 'main' })).toEqual([])
  })
})
