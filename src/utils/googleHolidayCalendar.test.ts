import { describe, expect, it } from 'vitest'
import { fetchGoogleHolidayDates } from './googleHolidayCalendar'

describe('googleHolidayCalendar', () => {
  it('keeps only official public holidays when Google returns extra non-holiday dates', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('holidays-jp.github.io')) {
        return new Response(JSON.stringify({
          '2026-03-20': '春分の日',
          '2026-04-29': '昭和の日',
        }), { status: 200 })
      }

      return new Response(JSON.stringify({
        items: [
          { start: { date: '2026-03-03' } },
          { start: { date: '2026-03-20' } },
          { start: { date: '2026-04-29' } },
        ],
      }), { status: 200 })
    }

    const dates = await fetchGoogleHolidayDates({
      apiKey: 'dummy',
      fetchImpl,
    })

    expect(dates).toEqual(['2026-03-20', '2026-04-29'])
  })
})