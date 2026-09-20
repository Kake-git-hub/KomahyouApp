// 丸ごと振替ができない理由を画面中央のダイアログで出す配線ガード(確認リスト r-2 要改善・2026-09-20)。
// 上部の状態欄(setStatusMessage)だけだと見落とす、というオーナー指摘。描画テスト環境が無いので字面で固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

describe('丸ごと振替のブロック理由はダイアログで出す', () => {
  it('通知は状態欄とダイアログの両方へ出す 1 本にまとめる', () => {
    const index = BOARD_TSX.indexOf('const notifyWholeDayTransferBlocked = (message: string) => {')
    expect(index).toBeGreaterThan(0)
    const body = BOARD_TSX.slice(index, index + 200)
    expect(body).toContain('setStatusMessage(message)')
    expect(body).toContain('setWholeDayTransferBlockedNotice(message)')
  })

  it('振替元のブロック(出欠記録あり等)・同日・休日・計算結果の blocked の 4 経路すべてがダイアログを通る', () => {
    expect(BOARD_TSX).toContain('notifyWholeDayTransferBlocked(blockReason)')
    expect(BOARD_TSX).toContain("notifyWholeDayTransferBlocked('同じ日へは振替できません。")
    expect(BOARD_TSX).toContain('notifyWholeDayTransferBlocked(`振替先 ${targetDateKey} は休日です。')
    const handlerIndex = BOARD_TSX.indexOf('const handleWholeDayTransferTargetClick = (targetDateKey: string) => {')
    const handler = BOARD_TSX.slice(handlerIndex, BOARD_TSX.indexOf('window.confirm(buildWholeDayTransferConfirmMessage', handlerIndex))
    expect(handler).toContain('notifyWholeDayTransferBlocked(result.message)')
    // このハンドラのブロック経路に、状態欄だけへ出す書き方を残さない。
    expect(handler).not.toContain('setStatusMessage(')
  })

  it('ダイアログは閉じるボタンと枠外クリックで閉じる', () => {
    expect(BOARD_TSX).toContain('data-testid="whole-day-transfer-blocked-modal"')
    expect(BOARD_TSX).toContain('data-testid="whole-day-transfer-blocked-close-button"')
  })
})
