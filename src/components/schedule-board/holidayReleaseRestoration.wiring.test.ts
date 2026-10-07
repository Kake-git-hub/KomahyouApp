// 休日解除＝休日設定の逆操作(オーナー確定 2026-09-20・確認リスト r-5 要改善・INV-06)の**配線**ガード。
// 会計と復元そのものは純関数 computeHolidayReleaseRestoration のマトリクス
// (inv06-holiday-record-retention.matrix.test.ts)で固定している。ここで守るのはハンドラ側の 4 点:
//   1. 解除分岐が純関数を呼び、その結果の weeks と台帳 5 本を commitWeeks へ渡す(1 回で確定＝Undo 可)。
//   2. 復元した通常授業の抑止キーを**積まない/外す**(積むと再マージで戻した席が消える)。
//   3. 実行前に window.confirm で件数を知らせ、キャンセルなら何もしない。
//   4. 機能フラグ OFF では復元を走らせない(従来どおりの解除)。
// 描画テスト環境が無いので字面で固定する(既存の *.wiring.test.ts と同じ作法)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

function holidayReleaseBranch() {
  const handlerIndex = BOARD_TSX.indexOf('const handleToggleHolidayDate = (dateKey: string) => {')
  expect(handlerIndex).toBeGreaterThan(0)
  const branchIndex = BOARD_TSX.indexOf('if (isHoliday) {', handlerIndex)
  expect(branchIndex).toBeGreaterThan(0)
  const endIndex = BOARD_TSX.indexOf('if (isClosedWeekday) {', branchIndex)
  expect(endIndex).toBeGreaterThan(branchIndex)
  return BOARD_TSX.slice(branchIndex, endIndex)
}

describe('休日解除の配線(席の復元・在庫巻き戻し)', () => {
  it('解除分岐が純関数を1回だけ呼び、フラグ OFF では呼ばない', () => {
    const branch = holidayReleaseBranch()
    expect(branch).toContain('transferSourceRestDisplayEnabled')
    expect(branch).toContain('? computeHolidayReleaseRestoration({')
    expect(branch.match(/computeHolidayReleaseRestoration\(/g)).toHaveLength(1)
    // 呼び出しは解除ハンドラの1点だけ(再マージ effect・読込経路に混ぜない=INV-03)。
    expect(BOARD_TSX.match(/computeHolidayReleaseRestoration\(\{/g)).toHaveLength(1)
  })

  it('復元後の weeks と台帳 5 本を commitWeeks へ渡す(commitWeeks は 1 回)', () => {
    const branch = holidayReleaseBranch()
    expect(branch).toContain('restoration?.nextWeeks ?? cloneWeeks(weeks)')
    expect(branch).toContain('restoration?.ledgers.manualMakeupAdjustments')
    expect(branch).toContain('restoration?.ledgers.fallbackMakeupStudents')
    expect(branch).toContain('restoration?.ledgers.manualLectureStockCounts')
    expect(branch).toContain('restoration?.ledgers.manualLectureStockOrigins')
    expect(branch).toContain('restoration?.ledgers.fallbackLectureStockStudents')
    expect(branch.match(/commitWeeks\(/g)).toHaveLength(1)
  })

  it('★復元した通常授業の抑止キーは積まず、既にあるものは外す(積むと再マージで戻した席が消える)', () => {
    const branch = holidayReleaseBranch()
    expect(branch).toContain('const restoredOccurrenceKeys = new Set(restoration?.restoredOccurrenceKeys ?? [])')
    expect(branch).toContain('.filter((key) => !restoredOccurrenceKeys.has(key))')
    expect(branch).toContain('if (restoredOccurrenceKeys.has(occurrenceKey)) continue')
  })

  it('実行前に件数を確認し、キャンセルなら何も変えない', () => {
    const branch = holidayReleaseBranch()
    expect(branch).toContain('人を元の席へ戻します。')
    expect(branch).toContain('別日に組んだコマ')
    const confirmIndex = branch.indexOf('if (!window.confirm(confirmLines.join')
    expect(confirmIndex).toBeGreaterThan(0)
    expect(branch.slice(confirmIndex, confirmIndex + 200)).toContain("setStatusMessage('休日設定の解除をキャンセルしました。')")
    // キャンセルは commitWeeks より前に return する。
    expect(confirmIndex).toBeLessThan(branch.indexOf('commitWeeks('))
    expect(branch).toContain('summarizeHolidayReleaseSkips(restoration.skipped)')
  })

  it('休日設定側は在庫戻しの控え(stockReturnStamps)を記録へ焼き込む', () => {
    expect(BOARD_TSX).toContain('stockReturns: result.stockReturnStamps')
  })
})

// 休日設定 × 手動追加(2026-10-07 オーナー確定・Issue #73・INV-06・spec-makeup-stock §B-2-2b)の**配線**ガード。
// 会計そのものは inv06-holiday-stock-reconciliation.matrix.test.ts(T-1〜T-6)で固定している。ここで守るのは
// 「手動追加を返すのは休日設定の呼び出しだけ」という配線(全コマ削除・丸ごと振替・テンプレ保留の採用へ漏らさない)。
describe('休日設定の配線(手動追加も未消化へ返す・Issue #73)', () => {
  function holidaySetBranch() {
    const handlerIndex = BOARD_TSX.indexOf('const handleToggleHolidayDate = (dateKey: string) => {')
    expect(handlerIndex).toBeGreaterThan(0)
    const endIndex = BOARD_TSX.indexOf('const handleDayHeaderClick = ', handlerIndex)
    expect(endIndex).toBeGreaterThan(handlerIndex)
    return BOARD_TSX.slice(handlerIndex, endIndex)
  }

  it('休日設定ハンドラの reconcile 呼び出しだけが includeManualAddedLessons:true を渡す(盤面全体で 1 か所)', () => {
    expect(holidaySetBranch()).toContain('includeManualAddedLessons: true,')
    expect(BOARD_TSX.match(/includeManualAddedLessons: true/g)).toHaveLength(1)
  })

  it('★全コマ削除・丸ごと振替・テンプレ保留の採用(includeRegularLessons:false の呼び出し)にはフラグを渡さない(既定 false＝従来どおり返さない)', () => {
    // 純関数側の既定は false(真にすると全コマ削除経路の希望回数 −1 と二重になる)。
    expect(BOARD_TSX).toContain('includeManualAddedLessons = false')
    const callSites = BOARD_TSX.split('reconcileHolidayDeskStockReturns({').slice(1)
    expect(callSites.length).toBeGreaterThanOrEqual(3) // 休日設定・全コマ削除(disposeDayDeskEntries)・テンプレ保留の採用
    const clearDayCalls = callSites.filter((site) => site.slice(0, 800).includes('includeRegularLessons: false'))
    expect(clearDayCalls.length).toBeGreaterThanOrEqual(2)
    for (const site of clearDayCalls) {
      expect(site.slice(0, 800)).not.toContain('includeManualAddedLessons')
    }
  })

  it('解除側: 席へ戻す手動追加の通常授業は抑止キーを返さない(兄弟監査・テンプレ授業の削除の抑止を外さない)', () => {
    const fnIndex = BOARD_TSX.indexOf('export function computeHolidayReleaseRestoration(')
    expect(fnIndex).toBeGreaterThan(0)
    const body = BOARD_TSX.slice(fnIndex, BOARD_TSX.indexOf('const HOLIDAY_RELEASE_SKIP_LABELS', fnIndex))
    expect(body).toContain('const occurrenceKey = restoredStudent.manualAdded')
    expect(body).toContain('? null')
  })
})
