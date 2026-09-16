// workspace 既定値 'main' へのフォールバック廃止(2026-09-16 複数会社展開 Phase 0 T0-4)の回帰防止テスト。
// このツールは .env(.local) の VITE_FIREBASE_WORKSPACE_KEY を読む経路は維持しつつ、
// 環境変数も引数も無いときに黙って 'main' を補う挙動だけを廃止した。
// import しても main() は走らない(invokedDirectly ガード)。
import { describe, it, expect } from 'vitest'
import { parseArgs, readWorkspaceKeyFromEnvFile, validateNonInteractiveConfig } from './firebase-first-classroom-helper.mjs'

describe('readWorkspaceKeyFromEnvFile', () => {
  it('.env(.local) に一致行が無ければ空文字を返す(旧: 既定値 main へフォールバックしていた)', () => {
    // このプロセスの cwd(worktree ルート)には VITE_FIREBASE_WORKSPACE_KEY を含む .env.local/.env が無い前提。
    expect(readWorkspaceKeyFromEnvFile()).toBe('')
  })
})

describe('parseArgs', () => {
  it('--workspace-key を読み取る', () => {
    expect(parseArgs(['--workspace-key', 'main'])['workspace-key']).toBe('main')
  })

  it('未指定ならキーが無い(既定値を補わない)', () => {
    expect(parseArgs([])['workspace-key']).toBeUndefined()
  })
})

describe('validateNonInteractiveConfig', () => {
  it('workspaceKey が欠けていれば不足扱い(非対話モードでの必須化)', () => {
    const config = { workspaceKey: '', classroomName: 'x', managerUid: 'u', managerName: 'n', managerEmail: 'e', developerUid: 'd' }
    expect(validateNonInteractiveConfig(config)).toContain('workspaceKey')
  })

  it('全部揃っていれば不足なし', () => {
    const config = { workspaceKey: 'main', classroomName: 'x', managerUid: 'u', managerName: 'n', managerEmail: 'e', developerUid: 'd' }
    expect(validateNonInteractiveConfig(config)).toEqual([])
  })
})
