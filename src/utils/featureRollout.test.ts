import { describe, expect, it } from 'vitest'
import { featureRolloutRegistry, isFeatureEnabledForClassroom, isFeatureScopeEnabled, isStagingEnvironment } from './featureRollout'

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

  it('enables long-press drag-and-drop move in every classroom', () => {
    // 開発用教室で先行後、全教室へ展開済み(オーナー指示 2026-06-28)。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.studentDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })

  it('judges the staging environment by Firebase project id', () => {
    // staging 先行機能(日程表 React ビュー)は教室IDでなくプロジェクトIDで有効化する(2026-07-08 確定)。
    expect(isStagingEnvironment('komahyouapp-staging')).toBe(true)
    expect(isStagingEnvironment('komahyouapp-prod')).toBe(false)
    expect(isStagingEnvironment('')).toBe(false)
  })

  it('keeps the interactive React schedule view staging-first (production classrooms stay on HTML tabs)', () => {
    // オーナーチェック合格まで本番3教室では無効のまま。staging では全教室、その他環境では開発用教室のみ。
    expect(featureRolloutRegistry.scheduleInteractiveReactView.scope).toBe('staging-environment')
    expect(isFeatureScopeEnabled('staging-environment', { isStaging: true, isDevelopmentClassroom: false })).toBe(true)
    expect(isFeatureScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: true })).toBe(true)
    expect(isFeatureScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: false })).toBe(false)
  })

  it('keeps schedule drag-and-drop (日程表コマ組み) staging-first (production classrooms unaffected)', () => {
    // spec-student-schedule-dnd: 本番3教室ではオーナーチェック合格まで無効。staging/開発用教室でのみ有効。
    expect(featureRolloutRegistry.studentScheduleDndMove.scope).toBe('staging-environment')
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(false)
  })
})
