import { describe, expect, it } from 'vitest'
import { resolveOptimisticVersionDecision } from './optimisticVersion'

describe('resolveOptimisticVersionDecision (A1: 多端末の古いデータ上書き防止)', () => {
  it('baseVersion 未送信(旧クライアント)は照合せず常に許可し版数を+1する', () => {
    expect(resolveOptimisticVersionDecision({ incomingBaseVersion: undefined, previousVersion: 5, isReplay: false }))
      .toEqual({ ok: true, nextVersion: 6 })
  })

  it('既存教室で版数未設定なら 0 とみなし初回保存で版数=1', () => {
    expect(resolveOptimisticVersionDecision({ incomingBaseVersion: undefined, previousVersion: undefined, isReplay: false }))
      .toEqual({ ok: true, nextVersion: 1 })
  })

  it('baseVersion が現在の版数と一致すれば許可して+1', () => {
    expect(resolveOptimisticVersionDecision({ incomingBaseVersion: 3, previousVersion: 3, isReplay: false }))
      .toEqual({ ok: true, nextVersion: 4 })
  })

  it('baseVersion が古い(別端末が先に更新)なら拒否する', () => {
    const decision = resolveOptimisticVersionDecision({ incomingBaseVersion: 2, previousVersion: 5, isReplay: false })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.reason).toBe('stale')
      expect(decision.previousVersion).toBe(5)
      expect(decision.incomingBaseVersion).toBe(2)
    }
  })

  it('冪等リプレイ(同一saveIdの再送)は版数が食い違っても拒否しない', () => {
    expect(resolveOptimisticVersionDecision({ incomingBaseVersion: 2, previousVersion: 5, isReplay: true }))
      .toEqual({ ok: true, nextVersion: 6 })
  })

  it('baseVersion=0 と previousVersion 未設定(=0)は一致扱いで許可', () => {
    expect(resolveOptimisticVersionDecision({ incomingBaseVersion: 0, previousVersion: undefined, isReplay: false }))
      .toEqual({ ok: true, nextVersion: 1 })
  })

  it('版数が一致していても baseVersion が新しすぎる(先回り)なら拒否', () => {
    // 通常は起きないが、クライアント側のずれを安全側(拒否)に倒す。
    const decision = resolveOptimisticVersionDecision({ incomingBaseVersion: 9, previousVersion: 5, isReplay: false })
    expect(decision.ok).toBe(false)
  })
})
