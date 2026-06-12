import { describe, expect, it } from 'vitest'
import { buildAvailableDates } from './SubmissionPage'

// B3 回帰防止: QR提出ページで「コマ表側の個別休日(holidayDates)」を休校日として提出不可にする。
// 定休日(曜日)・強制開校(forceOpenDates)との組み合わせも検証する。
describe('buildAvailableDates holiday handling', () => {
  const slotNumbers = [1, 2, 3]

  it('marks individually-configured holiday dates as closed', () => {
    const dates = buildAvailableDates('2026-08-10', '2026-08-12', [], [], ['2026-08-11'], slotNumbers)
    const byKey = new Map(dates.map((date) => [date.dateKey, date]))
    expect(byKey.get('2026-08-10')?.isClosed).toBe(false)
    expect(byKey.get('2026-08-11')?.isClosed).toBe(true)
    expect(byKey.get('2026-08-12')?.isClosed).toBe(false)
  })

  it('treats weekday closures and holiday dates independently (either closes the day)', () => {
    // 2026-08-09 は日曜。closedWeekdays=[0] と holidayDates の両方を渡す。
    const dates = buildAvailableDates('2026-08-09', '2026-08-11', [0], [], ['2026-08-10'], slotNumbers)
    const byKey = new Map(dates.map((date) => [date.dateKey, date]))
    expect(byKey.get('2026-08-09')?.isClosed).toBe(true) // 定休日(日曜)
    expect(byKey.get('2026-08-10')?.isClosed).toBe(true) // 個別休日
    expect(byKey.get('2026-08-11')?.isClosed).toBe(false)
  })

  it('keeps forceOpen overriding weekday closure, but holiday still closes', () => {
    // 日曜(定休)だが強制開校 → 開校。別の個別休日は休校のまま。
    const dates = buildAvailableDates('2026-08-09', '2026-08-10', [0], ['2026-08-09'], ['2026-08-10'], slotNumbers)
    const byKey = new Map(dates.map((date) => [date.dateKey, date]))
    expect(byKey.get('2026-08-09')?.isClosed).toBe(false) // forceOpen が定休を上書き
    expect(byKey.get('2026-08-10')?.isClosed).toBe(true)  // 個別休日は休校
  })

  it('defaults to open when no holiday dates are provided', () => {
    const dates = buildAvailableDates('2026-08-10', '2026-08-11', [], [], [], slotNumbers)
    expect(dates.every((date) => date.isClosed === false)).toBe(true)
  })
})
