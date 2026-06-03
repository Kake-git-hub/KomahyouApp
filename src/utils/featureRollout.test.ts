import { describe, expect, it } from 'vitest'
import { featureRolloutRegistry, isFeatureEnabledForClassroom } from './featureRollout'

describe('featureRollout', () => {
  it('enables manual Firebase save stability in every classroom', () => {
    // 開発用教室で検証後、全教室へ展開済み。開発用教室も通常教室と同じ保存経路を使う。
    expect(featureRolloutRegistry.manualFirebaseSaveStability.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('manualFirebaseSaveStability', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('manualFirebaseSaveStability', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })

  it('keeps all-classroom rollouts enabled everywhere', () => {
    expect(featureRolloutRegistry.scheduleQrPopupBehavior.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('scheduleQrPopupBehavior', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('scheduleQrPopupBehavior', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })
})
