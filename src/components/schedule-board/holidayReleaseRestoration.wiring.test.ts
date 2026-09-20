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
