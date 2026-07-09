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

  it('keeps teacher drag-and-drop move development-only until validated', () => {
    // 講師の同コマ内D&D移動/入れ替えは開発用教室で先行検証中。本番3教室ではまだ無効(検証後に昇格予定)。
    expect(featureRolloutRegistry.teacherDragAndDropMove.scope).toBe('development-only')
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(false)
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

  it('enables schedule drag-and-drop (日程表コマ組み) in every classroom', () => {
    // staging→本番の開発用教室で段階検証後、オーナー確定(2026-07-09)で全教室へ展開。回帰で staging-environment へ戻さない。
    expect(featureRolloutRegistry.studentScheduleDndMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })

  it('enables schedule popup auto-sync (自動同期+スピナー) in every classroom', () => {
    // コマ組みの移動結果反映に必要。コマ組みと同時に全教室へ展開(オーナー確定 2026-07-09)。回帰で戻さない。
    expect(featureRolloutRegistry.schedulePopupAutoSync.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('schedulePopupAutoSync', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('schedulePopupAutoSync', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })
})
