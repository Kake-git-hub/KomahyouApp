// 機能フラグの教室判定の配線ガード(source-scan・2026-09-16・docs/spec-multi-tenant.md)。
//
// 検証用(開発用・サンドボックス)教室の判定は、教室名ではなく**登録台帳の (workspaceKey, 教室ID)**に
// なった(src/utils/developmentClassroomRegistry.ts)。したがって `isFeatureEnabledForClassroom` の
// 呼び出し側は **必ず教室ID を渡す**必要がある。`{ name: classroomName }` だけを渡す旧形が 1 か所でも
// 残っていると、その画面の development-only 機能が開発用教室でも丸ごと無効になる
// (講習履歴ボタンが出ない・盤面ベース予定数が旧方式に戻る・AI 即答の表示が出ない)。
// 描画テスト環境が無いので字面で固定する(作法は parentPortal.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
const SCHEDULE_HTML_TS = readFileSync(fileURLToPath(new URL('../../utils/scheduleHtml.ts', import.meta.url)), 'utf8')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

function collectFeatureFlagCalls(source: string) {
  return source.match(/isFeatureEnabledForClassroom\([^)]*\)/g) ?? []
}

describe('機能フラグの呼び出しは教室ID を渡す(2026-09-16 回帰防止)', () => {
  it('ScheduleBoardScreen.tsx の全呼び出しが id を含む(名前だけ渡す旧形を残さない)', () => {
    const calls = collectFeatureFlagCalls(BOARD_TSX)
    expect(calls.length).toBeGreaterThanOrEqual(9)
    for (const call of calls) {
      expect(call, call).toContain('id: classroomStorageKey')
      expect(call, call).not.toMatch(/\(\s*'[A-Za-z]+',\s*\{\s*name:/u)
    }
  })

  it('scheduleHtml.ts(別タブ日程表のペイロード)も id を渡す', () => {
    const calls = collectFeatureFlagCalls(SCHEDULE_HTML_TS)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const call of calls) {
      expect(call, call).toContain('id: params.classroomStorageKey')
    }
  })

  // ★ここが要: ScheduleBoardScreen の `classroomStorageKey` は App.tsx が渡す `actingClassroomId`
  //   (＝開いている教室の Firestore ドキュメントID)。App 側でこの受け渡しを変えると、
  //   上の id 指定が「教室IDではない何か」になり、開発用教室の先行機能が静かに無効化される。
  it('App.tsx は classroomStorageKey に actingClassroomId を渡している(教室IDであることの根拠)', () => {
    expect(APP_TSX).toContain('classroomStorageKey={actingClassroomId ?? undefined}')
    expect(APP_TSX).toContain('classroomStorageKey: actingClassroomId ?? undefined,')
  })

  // App.tsx の isDevelopmentClassroom / isFeatureEnabledForClassroom は actingClassroom(= id 付きの
  // 教室オブジェクト)をそのまま渡す。ここを name だけの値へ差し替えない。
  it('App.tsx は教室オブジェクト(actingClassroom)ごと渡す', () => {
    expect(APP_TSX).toContain('isDevelopmentClassroom(actingClassroom)')
    expect(APP_TSX).toContain("isFeatureEnabledForClassroom('parentPortalQr', actingClassroom)")
  })

  // 退塾の自動掃除(2026-09-21・開発用教室限定で先行)。盤面側(掃除)と App 側(高3卒業の退塾日 自動入力)は
  // **同じフラグ**で開閉する。片方だけ広げると「盤面は消すのに退塾日が入らない/退塾日は入るのに掃除されない」
  // の非対称になる(どちらも確認なしで実データを書き換える操作)。
  it('studentWithdrawAutoSweep は盤面(教室ID)と App(actingClassroom)の両側で同じフラグを引く', () => {
    expect(BOARD_TSX).toContain("isFeatureEnabledForClassroom('studentWithdrawAutoSweep', { id: classroomStorageKey })")
    expect(APP_TSX).toContain("isFeatureEnabledForClassroom('studentWithdrawAutoSweep', actingClassroom)")
    // 基本データ画面は App から評価結果を受け取る(自前で教室判定を持たない)。
    expect(APP_TSX).toContain('studentWithdrawAutoSweepEnabled={studentWithdrawAutoSweepEnabled}')
  })
})
