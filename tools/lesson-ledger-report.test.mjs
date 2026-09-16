// --workspace 必須化(2026-09-16 複数会社展開 Phase 0 T0-4)の回帰防止テスト。
// 既定 workspace='main' への暗黙フォールバックが復活していないことを固定する。
// import しても await main() が走らない(invokedDirectly ガード)ことも確認する
// (走ってしまうと gcloud 呼び出し/ネットワークアクセスでテストが壊れる)。
import { describe, it, expect } from 'vitest'
import { parseArgs, validateArgs } from './lesson-ledger-report.mjs'

describe('parseArgs', () => {
  it('--workspace を読み取る(既定値は無い)', () => {
    const options = parseArgs(['someClassroom', '--workspace', 'main'])
    expect(options.workspaceKey).toBe('main')
    expect(options.classroomId).toBe('someClassroom')
  })

  it('未指定なら workspaceKey は空文字のまま', () => {
    expect(parseArgs(['someClassroom']).workspaceKey).toBe('')
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

describe('モジュール import の副作用', () => {
  it('import しただけでは main() が実行されない(トップレベル await が invokedDirectly でガードされている)', async () => {
    // このテストファイルが最後まで読み込めていること自体が、import 時に main() が走って
    // gcloud/ネットワーク呼び出しで例外にならなかったことの証跡になる。
    const mod = await import('./lesson-ledger-report.mjs')
    expect(typeof mod.parseArgs).toBe('function')
  })
})
