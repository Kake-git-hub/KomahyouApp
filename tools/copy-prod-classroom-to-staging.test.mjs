// --workspace / --classroom 必須化(2026-09-16 複数会社展開 Phase 0 T0-4)の回帰防止テスト。
// 既定教室(日大前)・既定 workspace(main) へのフォールバックが復活していないことを固定する。
// import しても main() や gcloud 呼び出しが走らない(invokedDirectly ガード)ことも別途確認する。
import { describe, it, expect } from 'vitest'
import { parseArgs, validateArgs } from './copy-prod-classroom-to-staging.mjs'

describe('parseArgs', () => {
  it('--workspace と --classroom を読み取る(既定値は無い)', () => {
    const options = parseArgs(['--workspace', 'main', '--classroom', '5w5OMueETerSKrSf14HC'])
    expect(options).toEqual({ workspaceKey: 'main', classroomId: '5w5OMueETerSKrSf14HC', promoteMember: false, assignMember: false })
  })

  it('未指定なら空文字のまま(既定教室・既定 workspace へフォールバックしない)', () => {
    const options = parseArgs([])
    expect(options.workspaceKey).toBe('')
    expect(options.classroomId).toBe('')
  })

  it('--promote-staging-member / --assign-staging-member を認識する', () => {
    expect(parseArgs(['--promote-staging-member']).promoteMember).toBe(true)
    expect(parseArgs(['--assign-staging-member']).assignMember).toBe(true)
  })
})

describe('validateArgs', () => {
  it('--workspace 無しはエラー', () => {
    const errors = validateArgs({ workspaceKey: '', classroomId: 'x' })
    expect(errors).toContain('--workspace <key> は必須です。')
  })

  it('--classroom 無しはエラー(既定教室=日大前 は廃止済み)', () => {
    const errors = validateArgs({ workspaceKey: 'main', classroomId: '' })
    expect(errors).toContain('--classroom <classroomId> は必須です。')
  })

  it('両方指定していればエラー無し', () => {
    expect(validateArgs({ workspaceKey: 'main', classroomId: '5w5OMueETerSKrSf14HC' })).toEqual([])
  })
})
