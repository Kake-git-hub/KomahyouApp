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

  it('enables the student schedule option field in every classroom', () => {
    // 開発用教室で検証後、全教室へ展開済み(オーナー指示 2026-06-27)。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.studentScheduleOptionField.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentScheduleOptionField', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('studentScheduleOptionField', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })

  it('limits long-press drag-and-drop move to the development classroom only', () => {
    // 生徒名の長押しD&D移動はまず開発用教室のみ。全教室昇格はオーナー判断まで development-only を維持する。
    expect(featureRolloutRegistry.studentDragAndDropMove.scope).toBe('development-only')
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(false)
  })
})
