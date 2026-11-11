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
    // 段 4 監査 重大-1（2026-11-05）: 抑止キーの組み立てを純関数 resolveHolidayReleaseSuppressedOccurrences へ移した（中の 2 つの守りはそのまま）。
    expect(branch).toContain('resolveHolidayReleaseSuppressedOccurrences({')
    const fnIndex = BOARD_TSX.indexOf('export function resolveHolidayReleaseSuppressedOccurrences(')
    expect(fnIndex).toBeGreaterThan(0)
    const fn = BOARD_TSX.slice(fnIndex, BOARD_TSX.indexOf('\n}\n', fnIndex))
    expect(fn).toContain('.filter((key) => !restoredOccurrenceKeys.has(key))')
    expect(fn).toContain('if (restoredOccurrenceKeys.has(occurrenceKey)) continue')
  })

  it('実行前に件数を確認し、キャンセルなら何も変えない', () => {
    const branch = holidayReleaseBranch()
    // 2026-10-25 2 行化（オーナー指示）: 件数（元の席へ n人・別日のコマ・戻せない人数）は確認に残す。
    expect(branch).toContain('`元の席へ ${restoration.restoredStudentNames.length}人`')
    // 決定記録 59（2026-11-01）: 席に居た手入力の生徒を下の行へ残して戻した人数も確認に出す。
    expect(branch).toContain('席に居た手入力の生徒を下の行に残して戻す ${restoration.displacedOccupantNames.length}人')
    expect(branch).toContain('displacedCount: restoration?.displacedOccupantNames.length ?? 0')
    expect(branch).toContain('`別日のコマ ${removedLabel} を削除`')
    const confirmIndex = branch.indexOf('if (!window.confirm(confirmText))')
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

  // Issue #86(INV-06): 在庫由来の振替の配置を台帳へ積まない(控え none)のは休日設定だけ。会計は inv06-holiday-record-retention.matrix.test.ts の行(v)〜(aa)。
  //   全コマ削除・丸ごと振替の振替先の処分・テンプレ保留の採用は重なりが未消化の計算で畳まれて残が正しいので、挙動を変えない(渡さない)。
  it('★休日設定ハンドラの reconcile 呼び出しだけが skipLedgerBackedMakeupPlacements:true を渡す(Issue #86・盤面全体で 1 か所)', () => {
    expect(holidaySetBranch()).toContain('skipLedgerBackedMakeupPlacements: true,')
    expect(BOARD_TSX.match(/skipLedgerBackedMakeupPlacements: true/g)).toHaveLength(1)
    expect(BOARD_TSX).toContain('skipLedgerBackedMakeupPlacements = false')
    const callSites = BOARD_TSX.split('reconcileHolidayDeskStockReturns({').slice(1)
    for (const site of callSites.filter((entry) => entry.slice(0, 800).includes('includeRegularLessons: false'))) {
      expect(site.slice(0, 800)).not.toContain('skipLedgerBackedMakeupPlacements')
    }
  })

  it('解除側: 席へ戻す手動追加の通常授業は抑止キーを返さない(兄弟監査・テンプレ授業の削除の抑止を外さない)', () => {
    const fnIndex = BOARD_TSX.indexOf('export function computeHolidayReleaseRestoration(')
    expect(fnIndex).toBeGreaterThan(0)
    const body = BOARD_TSX.slice(fnIndex, BOARD_TSX.indexOf('const HOLIDAY_RELEASE_SKIP_LABELS', fnIndex))
    // 2026-11-07（INV-12）: キーは権威関数 resolveSuppressedRegularLessonOccurrenceKeys の 0〜2 本（手動追加・下段へ戻した分は null のまま）。
    expect(body).toContain('const occurrenceKeys = restoredStudent.manualAdded')
    expect(body).toContain('? null')
  })
})
