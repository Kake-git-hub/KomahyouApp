// JST の「今日」の正本(jstDate.ts)と、別タブ日程表の埋め込み JS 写し(scheduleHtml.ts getScheduleTodayJstKey)の突き合わせ。
// 盤面(退塾生徒の剥がし)と日程表(退塾生徒の非表示)が同じ「今日」を使うことを固定する(2026-09-15)。
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { getJstTodayDateKey } from './jstDate'

// UTC 15:00 で JST の日付が変わる。年跨ぎ・月跨ぎ・うるう日も含める。
const INSTANTS: Array<[string, string]> = [
  ['2026-09-14T14:59:59.999Z', '2026-09-14'],
  ['2026-09-14T15:00:00.000Z', '2026-09-15'],
  ['2026-09-15T23:59:00.000Z', '2026-09-16'],
  ['2026-12-31T14:59:59.000Z', '2026-12-31'],
  ['2026-12-31T15:00:00.000Z', '2027-01-01'],
  ['2028-02-28T15:00:00.000Z', '2028-02-29'],
  ['2026-08-31T15:00:00.000Z', '2026-09-01'],
]

function loadEmbeddedGetScheduleTodayJstKey() {
  const source = readFileSync(new URL('./scheduleHtml.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const match = source.match(/function getScheduleTodayJstKey\(\)\s*\{([\s\S]*?)\n {6}\}/)
  expect(match).toBeTruthy()
  return new Function(match![1]) as () => string
}

describe('getJstTodayDateKey(JST の今日の正本)', () => {
  for (const [iso, expected] of INSTANTS) {
    it(`${iso} → ${expected}`, () => {
      expect(getJstTodayDateKey(new Date(iso))).toBe(expected)
    })
  }

  it('引数省略時は現在時刻の JST 日付', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-14T15:30:00Z'))
      expect(getJstTodayDateKey()).toBe('2026-09-15')
    } finally {
      vi.useRealTimers()
    }
  })

  it('別タブ日程表の埋め込み JS 写しと全境界で同じ結果になる', () => {
    const embedded = loadEmbeddedGetScheduleTodayJstKey()
    vi.useFakeTimers()
    try {
      for (const [iso, expected] of INSTANTS) {
        vi.setSystemTime(new Date(iso))
        expect(embedded(), `埋め込み JS @ ${iso}`).toBe(expected)
        expect(embedded(), `TS 正本と一致 @ ${iso}`).toBe(getJstTodayDateKey())
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
