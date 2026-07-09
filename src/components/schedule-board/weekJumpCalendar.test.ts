import { describe, it, expect } from 'vitest'
import {
  buildMonthMatrix,
  formatMonthLabel,
  isWithinWeek,
  monthOfDateKey,
  shiftMonth,
  todayDateKey,
} from './weekJumpCalendar'

describe('monthOfDateKey', () => {
  it('dateKey を年月へ分解する', () => {
    expect(monthOfDateKey('2026-07-15')).toEqual({ year: 2026, month: 7 })
    expect(monthOfDateKey('2026-01-01')).toEqual({ year: 2026, month: 1 })
  })
})

describe('shiftMonth', () => {
  it('前後の月へ移動し、年跨ぎも正しく繰り上げ/繰り下げる', () => {
    expect(shiftMonth({ year: 2026, month: 7 }, 1)).toEqual({ year: 2026, month: 8 })
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
  })
})

describe('formatMonthLabel', () => {
  it('YYYY年M月 で表記する', () => {
    expect(formatMonthLabel({ year: 2026, month: 7 })).toBe('2026年7月')
  })
})

describe('buildMonthMatrix', () => {
  it('6週×7日=42セルを月曜始まりで返す', () => {
    const matrix = buildMonthMatrix({ year: 2026, month: 7 })
    expect(matrix).toHaveLength(6)
    expect(matrix.every((row) => row.length === 7)).toBe(true)
    // 2026-07-01 は水曜。月曜始まりなので先頭行は 6/29(月),6/30(火),7/1(水)...
    expect(matrix[0][0].dateKey).toBe('2026-06-29')
    expect(matrix[0][0].inMonth).toBe(false)
    expect(matrix[0][2]).toMatchObject({ dateKey: '2026-07-01', day: 1, inMonth: true })
  })

  it('月初が月曜のときは前月を含めず1日から始まる', () => {
    // 2026-06-01 は月曜。
    const matrix = buildMonthMatrix({ year: 2026, month: 6 })
    expect(matrix[0][0]).toMatchObject({ dateKey: '2026-06-01', day: 1, inMonth: true })
  })

  it('末尾は翌月の日で埋め inMonth=false になる', () => {
    const matrix = buildMonthMatrix({ year: 2026, month: 7 })
    const last = matrix[5][6]
    expect(last.inMonth).toBe(false)
    expect(monthOfDateKey(last.dateKey).month).toBe(8)
  })
})

describe('isWithinWeek', () => {
  it('weekStart から7日間(月〜日)を含む', () => {
    const weekStart = '2026-07-13' // 月曜
    expect(isWithinWeek('2026-07-13', weekStart)).toBe(true) // 月
    expect(isWithinWeek('2026-07-19', weekStart)).toBe(true) // 日(7日目)
    expect(isWithinWeek('2026-07-12', weekStart)).toBe(false) // 前日
    expect(isWithinWeek('2026-07-20', weekStart)).toBe(false) // 翌週月曜
  })

  it('weekStartKey が空なら常に false', () => {
    expect(isWithinWeek('2026-07-13', '')).toBe(false)
  })
})

describe('todayDateKey', () => {
  it('渡した日付のローカル dateKey を返す', () => {
    expect(todayDateKey(new Date(2026, 6, 5))).toBe('2026-07-05')
  })
})
