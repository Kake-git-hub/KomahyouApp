import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

  it('enables teacher drag-and-drop move in every classroom', () => {
    // 開発用教室で先行検証後、オーナー確定(2026-07-09)で全教室へ昇格。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.teacherDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
  })

  it('judges the staging environment by Firebase project id', () => {
    // staging 先行機能は教室IDでなくプロジェクトIDで有効化する(stagingテスト教室は開発用教室IDではないため)。
    expect(isStagingEnvironment('komahyouapp-staging')).toBe(true)
    expect(isStagingEnvironment('komahyouapp-prod')).toBe(false)
    expect(isStagingEnvironment('')).toBe(false)
  })

  it('keeps the staging-environment scope staging-first (production classrooms stay disabled)', () => {
    // 将来の staging 先行機能のためのスコープ判定基盤。staging では全教室、その他環境では開発用教室のみ、本番3教室は無効。
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

describe('featureRollout: boardOnlyScheduleCells（日程表を盤面そのままで描く）', () => {
  it('全教室で有効（盤面と日程表が構造的に一致する）', () => {
    // 開発用教室で先行(v1.5.472)→ オーナー確定で全教室へ昇格(2026-08-07)。
    // 回帰で development-only へ戻さない。戻すと「盤面にあるのに日程表に無い」が再発する。
    expect(featureRolloutRegistry.boardOnlyScheduleCells.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-2', name: 'スクールIE 緑が丘校' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-3', name: 'スクールIE 薬円台校' })).toBe(true)
  })
})

describe('featureRollout: boardPrintSelection（盤面PDFのコマ選択）', () => {
  it('全教室で有効（開発用教室で先行検証後に昇格・戻さない）', () => {
    // 開発用教室で先行検証後、オーナー指示(2026-09-13)で全教室へ昇格。回帰で development-only へ戻さない
    // (戻すと本番教室の「PDF出力」がコマ選択モーダルなしの即出力に退行する)。
    expect(featureRolloutRegistry.boardPrintSelection.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-2', name: 'スクールIE 緑が丘校' })).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-3', name: 'スクールIE 薬円台校' })).toBe(true)
  })
})

describe('featureRollout: parentPortalQr（保護者向け固定QR・サーバーとの左右対称）', () => {
  it('判定式はサーバー側 functions/src/parentPortal.ts と同じ形を保つ(片側だけ昇格させない)', () => {
    // クライアント: scope 'staging-environment' = isStagingEnvironment() || isDevelopmentClassroom({ id, name })
    expect(featureRolloutRegistry.parentPortalQr.scope).toBe('staging-environment')
    // サーバー: isDevelopmentClassroomIdentity(id, name) || projectId === 'komahyouapp-staging'
    // → 述語が一致していることを字面で固定する(両方を同時に変えないと落ちる)。
    const serverSource = readFileSync(fileURLToPath(new URL('../../functions/src/parentPortal.ts', import.meta.url)), 'utf8')
    const start = serverSource.indexOf('export function isParentPortalEnabledForClassroom')
    expect(start).toBeGreaterThan(-1)
    const body = serverSource.slice(start, start + 400)
    expect(body).toContain('isDevelopmentClassroomIdentity(identity.id, identity.name)')
    expect(body).toContain('PARENT_PORTAL_STAGING_PROJECT_ID')
    // 本番教室 ID の直接許可(片側だけ広い形)を復活させていないこと。
    expect(body).not.toContain('v8OZ7zH8vONNHjjYVcR1')
  })

  it('本番3教室では無効・開発用/テスト教室では有効', () => {
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'dev', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'test_classroom_20260507_dai', name: 'テスト教室' })).toBe(true)
    for (const [id, name] of [['5w5OMueETerSKrSf14HC', 'スクールIE 日大前校'], ['KzFnOQoTFLsCxwUp1tvh', 'スクールIE 緑が丘校'], ['6xnnbSTbwgGrBLy0EJKb', 'スクールIE 薬円台校']]) {
      expect(isFeatureEnabledForClassroom('parentPortalQr', { id, name }), id).toBe(false)
    }
    expect(isFeatureEnabledForClassroom('parentPortalQr', null)).toBe(false)
  })
})

describe('featureRollout: lessonHistory（講習履歴）', () => {
  it('開発用教室でのみ有効（本番3教室では出さない）', () => {
    // 新機能はフラグ付きで作る方針(docs/plan-2026-09-11-five-requests.md)。まず開発用教室で先行検証する。
    // 昇格(all-classrooms)はオーナー確認後。ここを勝手に広げないこと。
    expect(featureRolloutRegistry.lessonHistory.scope).toBe('development-only')
    expect(isFeatureEnabledForClassroom('lessonHistory', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('lessonHistory', { id: 'classroom-1', name: 'スクールIE 日大前校' })).toBe(false)
    expect(isFeatureEnabledForClassroom('lessonHistory', { id: 'classroom-2', name: 'スクールIE 緑が丘校' })).toBe(false)
    expect(isFeatureEnabledForClassroom('lessonHistory', { id: 'classroom-3', name: 'スクールIE 薬円台校' })).toBe(false)
  })
})

describe('featureRollout: parentPortalQr（開発用教室・staging での有効範囲）', () => {
  it('開発用/テスト教室では有効・本番3教室では無効(名前を変えれば両側同時に無効になる)', () => {
    // docs/spec-parent-portal.md §H: 公開順は 開発用教室 → staging → 本番1教室 → 全教室。
    // 昇格はサーバー側 functions/src/parentPortal.ts の isParentPortalEnabledForClassroom と同時に、オーナー確認後に行う。
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'development', name: '開発用教室' })).toBe(true)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' })).toBe(true)
    // ★本番の開発用教室は**名前**で一致する(ID 単独の許可は入れない = サーバーと同じ述語)。
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'v8OZ7zH8vONNHjjYVcR1', name: '名前を変えた教室' })).toBe(false)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: '5w5OMueETerSKrSf14HC', name: 'スクールIE 日大前校' })).toBe(false)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'KzFnOQoTFLsCxwUp1tvh', name: 'スクールIE 緑が丘校' })).toBe(false)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: '6xnnbSTbwgGrBLy0EJKb', name: 'スクールIE 薬円台校' })).toBe(false)
    expect(isFeatureEnabledForClassroom('parentPortalQr', null)).toBe(false)
  })

  it('staging プロジェクトでは一般教室でも有効(§H の staging 実機確認ができる)', () => {
    expect(isFeatureScopeEnabled(featureRolloutRegistry.parentPortalQr.scope, { isStaging: true, isDevelopmentClassroom: false })).toBe(true)
    expect(isFeatureScopeEnabled(featureRolloutRegistry.parentPortalQr.scope, { isStaging: false, isDevelopmentClassroom: false })).toBe(false)
  })
})
