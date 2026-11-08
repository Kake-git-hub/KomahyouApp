import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroom } from './developmentClassroom'
import { featureRolloutRegistry, isFeatureEnabledForClassroom, isFeatureScopeEnabled, isStagingEnvironment } from './featureRollout'

describe('featureRollout', () => {
  it('enables manual Firebase save stability in every classroom', () => {
    // 開発用教室で検証後、全教室へ展開済み。開発用教室も通常教室と同じ保存経路を使う。
    expect(featureRolloutRegistry.manualFirebaseSaveStability.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('manualFirebaseSaveStability', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('manualFirebaseSaveStability', { id: 'classroom-1' }, 'main')).toBe(true)
  })

  it('keeps all-classroom rollouts enabled everywhere', () => {
    expect(featureRolloutRegistry.scheduleQrPopupBehavior.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('scheduleQrPopupBehavior', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('scheduleQrPopupBehavior', { id: 'classroom-1' }, 'main')).toBe(true)
  })

  it('enables the student schedule option field in every classroom', () => {
    // 開発用教室で検証後、全教室へ展開済み(オーナー指示 2026-06-27)。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.studentScheduleOptionField.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentScheduleOptionField', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('studentScheduleOptionField', { id: 'classroom-1' }, 'main')).toBe(true)
  })

  it('enables long-press drag-and-drop move in every classroom', () => {
    // 開発用教室で先行後、全教室へ展開済み(オーナー指示 2026-06-28)。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.studentDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('studentDragAndDropMove', { id: 'classroom-1' }, 'main')).toBe(true)
  })

  it('enables teacher drag-and-drop move in every classroom', () => {
    // 開発用教室で先行検証後、オーナー確定(2026-07-09)で全教室へ昇格。回帰で development-only へ戻さない。
    expect(featureRolloutRegistry.teacherDragAndDropMove.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('teacherDragAndDropMove', { id: 'classroom-1' }, 'main')).toBe(true)
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
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('studentScheduleDndMove', { id: 'classroom-1' }, 'main')).toBe(true)
  })

  it('enables schedule popup auto-sync (自動同期+スピナー) in every classroom', () => {
    // コマ組みの移動結果反映に必要。コマ組みと同時に全教室へ展開(オーナー確定 2026-07-09)。回帰で戻さない。
    expect(featureRolloutRegistry.schedulePopupAutoSync.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('schedulePopupAutoSync', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('schedulePopupAutoSync', { id: 'classroom-1' }, 'main')).toBe(true)
  })
})

describe('featureRollout: boardOnlyScheduleCells（日程表を盤面そのままで描く）', () => {
  it('全教室で有効（盤面と日程表が構造的に一致する）', () => {
    // 開発用教室で先行(v1.5.472)→ オーナー確定で全教室へ昇格(2026-08-07)。
    // 回帰で development-only へ戻さない。戻すと「盤面にあるのに日程表に無い」が再発する。
    expect(featureRolloutRegistry.boardOnlyScheduleCells.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-2' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardOnlyScheduleCells', { id: 'classroom-3' }, 'main')).toBe(true)
  })
})

describe('featureRollout: boardPrintSelection（盤面PDFのコマ選択）', () => {
  it('全教室で有効（開発用教室で先行検証後に昇格・戻さない）', () => {
    // 開発用教室で先行検証後、オーナー指示(2026-09-13)で全教室へ昇格。回帰で development-only へ戻さない
    // (戻すと本番教室の「PDF出力」がコマ選択モーダルなしの即出力に退行する)。
    expect(featureRolloutRegistry.boardPrintSelection.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-2' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('boardPrintSelection', { id: 'classroom-3' }, 'main')).toBe(true)
  })
})

describe('featureRollout: parentPortalQr（保護者向け固定QR・サーバーとの左右対称）', () => {
  it('判定式はサーバー側 functions/src/parentPortal.ts と同じ形を保つ(片側だけ昇格させない)', () => {
    // クライアント: 開発用教室で先行(v1.5.512・staging-environment) → オーナー指示(2026-11-08「開発・テスト教室だけで動いている機能を全教室展開して」)で
    // 全教室へ昇格。回帰で staging-environment / development-only へ戻さない(戻すと配った QR が 403 になる)。
    expect(featureRolloutRegistry.parentPortalQr.scope).toBe('all-classrooms')
    // サーバー: PARENT_PORTAL_BASE_SCOPE(クライアントの scope と同じ値) → 会社既定、の 2 段解決。
    // → 基本スコープの値と述語の形を字面で固定する(両方を同時に変えないと落ちる)。
    // ★2026-09-16: 開発用教室の判定は両側とも登録台帳 src/utils/developmentClassroomRegistry.ts の (workspaceKey, 教室ID)。
    const serverSource = readFileSync(fileURLToPath(new URL('../../functions/src/parentPortal.ts', import.meta.url)), 'utf8')
    const baseScope = /export const PARENT_PORTAL_BASE_SCOPE[^=]*= '([a-z-]+)'/u.exec(serverSource)
    expect(baseScope?.[1], 'サーバーの基本スコープ PARENT_PORTAL_BASE_SCOPE').toBe(featureRolloutRegistry.parentPortalQr.scope)
    const start = serverSource.indexOf('export function isParentPortalEnabledForClassroom')
    expect(start).toBeGreaterThan(-1)
    const body = serverSource.slice(start, start + 1000)
    expect(body).toContain("PARENT_PORTAL_BASE_SCOPE === 'all-classrooms'")
    expect(body).toContain('isDevelopmentClassroomIdentity({ workspaceKey, classroomId })')
    expect(body).toContain('PARENT_PORTAL_STAGING_PROJECT_ID')
    // ★2026-09-18(Phase 1 T1-2): 2 段解決(基本スコープ → 会社既定)もクライアントと同じ関数・同じ台帳キーで行う。
    expect(body).toContain('resolveFeatureEnabledByLayers({')
    expect(body).toContain("resolveCompanyFeatureDefault(workspaceKey, 'parentPortalQr')")
    // 会社や教室 ID が空なら OFF(fail-closed・questionAiAnswer と同じ形)。
    expect(body).toContain('if (!workspaceKey || !classroomId) return false')
    // 本番教室 ID の直接許可(片側だけ広い形)を復活させていないこと。
    expect(body).not.toContain('v8OZ7zH8vONNHjjYVcR1')
    // 教室名による判定を復活させていないこと(他社の同名教室で誤って有効になる)。
    expect(body).not.toContain('identity.name')
  })

  it('本番教室でも開発用/テスト教室でも有効(2026-11-08 全教室昇格)・教室が無ければ無効', () => {
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'test_classroom_20260507_dai' }, 'main')).toBe(true)
    for (const [id, name] of [['5w5OMueETerSKrSf14HC', 'スクールIE 日大前校'], ['KzFnOQoTFLsCxwUp1tvh', 'スクールIE 緑が丘校']]) {
      expect(isFeatureEnabledForClassroom('parentPortalQr', { id }, 'main'), `${id} (${name})`).toBe(true)
    }
    // 教室が無い(null)ときの fail-closed はサーバー側(isParentPortalEnabledForClassroom)が担う。クライアントの all-classrooms は
    // 識別子に関係なく true(「all-classrooms の機能は教室・会社に関係なく有効のまま」のテストと同じ)。
  })
})

describe('featureRollout: テスト教室(sandbox)は development-only 機能の対象に含める', () => {
  // ★オーナー確定 2026-09-16: 「テスト教室(石川先生)は開発用教室と同じ扱いでいい」。
  //   したがって kind(development / sandbox)で機能の解放を分けない(docs/spec-multi-tenant.md §4-2-11)。
  //   kind の用途は resolveDevelopmentClassroomId(会社に 1 つの開発用教室を決める)だけ。
  // 経緯: 旧配線(盤面側が教室名だけを渡していた)ではテスト教室 test_classroom_20260507_dai で
  //   盤面ベース予定数・講習履歴が偶然 OFF だった(regression-reviewer 所見 B-1)。台帳化で ON になり、
  //   オーナー確定によりこれが正となった。**この期待値を kind で絞る方向へ黙って反転させない。**
  // ★2026-10-13: 盤面ベース予定数(boardBasedPlannedCount)は全教室へ昇格したので、まだ development-only の
  //   講習履歴・テンプレ差分反映で同じ保証を固定していた(AI 即答は 2026-10-30 に全教室へ昇格)。
  // ★2026-11-08: テンプレ差分反映・保護者QR・講習の日程公開・講師専用講習も全教室へ昇格し、development-only /
  //   staging-environment のフラグが 1 本も無くなった。保証そのもの(テスト教室＝開発用教室と同じ扱い)は
  //   scope の判定関数と登録台帳の組み合わせで固定し続ける(次に先行機能を足したとき、ここへそのキーを足す)。
  it('テスト教室でも development-only / staging-environment の機能が有効になる(登録台帳 × scope 判定)', () => {
    const sandbox = { id: 'test_classroom_20260507_dai' }
    expect(isDevelopmentClassroom(sandbox, 'main')).toBe(true)
    expect(isFeatureScopeEnabled('development-only', { isStaging: false, isDevelopmentClassroom: isDevelopmentClassroom(sandbox, 'main') })).toBe(true)
    expect(isFeatureScopeEnabled('staging-environment', { isStaging: false, isDevelopmentClassroom: isDevelopmentClassroom(sandbox, 'main') })).toBe(true)
    // 別会社(workspaceKey 違い)では同じ ID でも無効(会社の壁)。
    expect(isDevelopmentClassroom(sandbox, 'other-company')).toBe(false)
    expect(isFeatureScopeEnabled('development-only', { isStaging: false, isDevelopmentClassroom: isDevelopmentClassroom(sandbox, 'other-company') })).toBe(false)
  })
})

describe('featureRollout: questionAiAnswer（質問への AI 即時回答）', () => {
  it('全教室で有効（開発用教室で先行 → オーナー指示 2026-10-30「AI回答機能を全教室に展開して」で昇格・戻さない）', () => {
    // サーバー functions/src/questionAiAnswer.ts の QUESTION_AI_ANSWER_BASE_SCOPE と同じ値(questionAiAnswer.test.ts が突合)。
    expect(featureRolloutRegistry.questionAiAnswer.scope).toBe('all-classrooms')
    for (const id of ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb', 'v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai']) {
      expect(isFeatureEnabledForClassroom('questionAiAnswer', { id }, 'main'), id).toBe(true)
    }
  })
})

describe('featureRollout: lessonHistory（講習履歴）', () => {
  it('全教室で有効（開発用教室で先行 → 確認 h-1〜h-10 OK・オーナー指示 2026-11-03「全教室に出して」で昇格・戻さない）', () => {
    expect(featureRolloutRegistry.lessonHistory.scope).toBe('all-classrooms')
    for (const id of ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb', 'v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai']) {
      expect(isFeatureEnabledForClassroom('lessonHistory', { id }, 'main'), id).toBe(true)
    }
  })
})

describe('featureRollout: managerSelfRestore（室長の自教室復元）', () => {
  it('全教室で有効（開発用教室で先行 → 確認リスト s-1〜s-3 OK・オーナー指示 2026-09-22 で昇格）', () => {
    // オーナー確定 2026-09-18: 開発用教室 → 全教室の段階公開。2026-09-22 の確認リスト(v1.5.555)その他欄
    // 「サーバーバックアップから復元(直近3日)は機能問題ないので本番へ展開して」で昇格した。
    // 回帰防止: development-only へ戻すと本番教室の入口が消える。戻すのはオーナー指示があるときだけ。
    expect(featureRolloutRegistry.managerSelfRestore.scope).toBe('all-classrooms')
    expect(isFeatureEnabledForClassroom('managerSelfRestore', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('managerSelfRestore', { id: '5w5OMueETerSKrSf14HC' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('managerSelfRestore', { id: 'KzFnOQoTFLsCxwUp1tvh' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('managerSelfRestore', { id: '6xnnbSTbwgGrBLy0EJKb' }, 'main')).toBe(true)
  })
})

describe('featureRollout: 開発用教室で先行した 3 機能の全教室昇格(オーナー指示 2026-10-13)', () => {
  // 「振替元『休)』表示・丸ごと振替/休日設定の記録保持」「退塾の自動掃除・高3卒業の退塾日自動入力」
  // 「生徒日程表の予定数を盤面ベースで数える(INV-05)」を全教室へ展開した。
  // 回帰防止: development-only へ戻すと本番3教室で表示・自動掃除・予定数の数え方が旧方式へ戻る。戻すのはオーナー指示があるときだけ。
  const PROMOTED = ['transferSourceRestDisplay', 'studentWithdrawAutoSweep', 'boardBasedPlannedCount'] as const
  const PRODUCTION_CLASSROOM_IDS = ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb'] as const

  it.each(PROMOTED)('%s は全教室で有効(本番3教室・開発用/テスト教室)', (key) => {
    expect(featureRolloutRegistry[key].scope).toBe('all-classrooms')
    for (const id of [...PRODUCTION_CLASSROOM_IDS, 'v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai']) {
      expect(isFeatureEnabledForClassroom(key, { id }, 'main'), `${key} / ${id}`).toBe(true)
    }
  })
})

describe('featureRollout: parentPortalQr（有効範囲・2026-11-08 全教室昇格）', () => {
  it('本番教室・開発用/テスト教室・別会社でも有効(会社ごとに止めるのは会社既定 companyFeatureDefaults)', () => {
    // docs/spec-parent-portal.md §H: 公開順は 開発用教室 → staging → 本番 1 教室 → 全教室 だったが、確認リスト全 OK を受けた
    // オーナー指示(2026-11-08)で staging・本番 1 教室の段を省いて全教室へ。昇格はサーバー側 functions/src/parentPortal.ts の
    // PARENT_PORTAL_BASE_SCOPE と同じ push で行った(上の describe が字面で突合)。
    for (const id of ['v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai', 'classroom-9', '5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh']) {
      expect(isFeatureEnabledForClassroom('parentPortalQr', { id }, 'main'), id).toBe(true)
    }
    expect(isFeatureEnabledForClassroom('parentPortalQr', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'company-b')).toBe(true)
  })

  it('staging プロジェクトでも有効のまま(先行検証の経路を残す)', () => {
    expect(isFeatureScopeEnabled(featureRolloutRegistry.parentPortalQr.scope, { isStaging: true, isDevelopmentClassroom: false })).toBe(true)
    expect(isFeatureScopeEnabled(featureRolloutRegistry.parentPortalQr.scope, { isStaging: false, isDevelopmentClassroom: false })).toBe(true)
  })
})

describe('featureRollout: 開発・テスト教室で先行した 4 機能の全教室昇格(オーナー指示 2026-11-08)', () => {
  // 確認リストがすべて OK になったのを受けて、オーナー指示(2026-11-08「開発ダッシュボードに今残っている開発・テスト教室だけで
  // 動いている機能の 4 件を全教室展開して」)で次を all-classrooms にした。
  //  - parentPortalQr(保護者向けQR・休みの連絡)… サーバー functions/src/parentPortal.ts の PARENT_PORTAL_BASE_SCOPE と同じ push で昇格
  //  - lectureSchedulePublishToggle(講習の「保護者への公開」)… 保護者QRと同じ範囲(schedulePublish.test.ts が突合)
  //  - teacherOnlySpecialSession(講師専用の特別講習)
  //  - templateDiffApply(テンプレ保存の差分反映＝第 2 版の出自の印と 4 本の規則・講師の休み・丸ごと振替の付け替え)
  // 回帰防止: development-only / staging-environment へ戻すと、本番教室で配った保護者QRが 403 になり、講習の公開トグル・講師専用チェック・
  // 講師の休みボタンが消え、テンプレ保存が上書き方式へ戻る。戻すのはオーナー指示があるときだけ。
  const PROMOTED = ['parentPortalQr', 'lectureSchedulePublishToggle', 'teacherOnlySpecialSession', 'templateDiffApply'] as const
  const PRODUCTION_CLASSROOM_IDS = ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh'] as const

  it.each(PROMOTED)('%s は全教室で有効(本番教室・開発用/テスト教室)', (key) => {
    expect(featureRolloutRegistry[key].scope).toBe('all-classrooms')
    for (const id of [...PRODUCTION_CLASSROOM_IDS, 'v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai']) {
      expect(isFeatureEnabledForClassroom(key, { id }, 'main'), `${key} / ${id}`).toBe(true)
    }
  })

  it('2026-11-08 時点で development-only / staging-environment のフラグは残っていない(残すなら進行中テーマ台帳へ載せる)', () => {
    const pending = Object.entries(featureRolloutRegistry).filter(([, feature]) => feature.scope !== 'all-classrooms').map(([key]) => key)
    expect(pending).toEqual([])
  })
})
