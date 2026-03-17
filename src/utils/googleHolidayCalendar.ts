const GOOGLE_HOLIDAY_SYNC_CACHE_KEY = 'lesson-schedule:google-holiday-sync-cache'
const GOOGLE_HOLIDAY_SYNC_STALE_MS = 24 * 60 * 60 * 1000

export const DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com'

export type GoogleHolidaySyncCache = {
  syncedHolidayDates: string[]
  lastSyncedAt: string
}

type GoogleHolidayEventItem = {
  start?: {
    date?: string
    dateTime?: string
  }
}

type GoogleHolidayEventsResponse = {
  items?: GoogleHolidayEventItem[]
  nextPageToken?: string
}

type FetchGoogleHolidayDatesParams = {
  apiKey: string
  calendarId?: string
  now?: Date
  fetchImpl?: typeof fetch
}

function formatUtcDateTime(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0)).toISOString()
}

function normalizeDateKey(value: string) {
  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (directMatch) return directMatch[1]

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getUTCFullYear()
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${parsed.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function uniqueSortedDateKeys(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

export function createGoogleHolidayTimeRange(now = new Date()) {
  const currentYear = now.getFullYear()
  return {
    timeMin: formatUtcDateTime(currentYear - 1, 0, 1),
    timeMax: formatUtcDateTime(currentYear + 2, 11, 31),
  }
}

export function mergeSyncedHolidayDates(currentHolidayDates: string[], previousSyncedDates: string[], nextSyncedDates: string[]) {
  const previousSyncedSet = new Set(previousSyncedDates)
  const manualHolidayDates = currentHolidayDates.filter((dateKey) => !previousSyncedSet.has(dateKey))
  return uniqueSortedDateKeys([...manualHolidayDates, ...nextSyncedDates])
}

export function shouldRefreshGoogleHolidayCache(lastSyncedAt: string, now = Date.now()) {
  if (!lastSyncedAt) return true
  const lastSyncedTime = new Date(lastSyncedAt).getTime()
  if (Number.isNaN(lastSyncedTime)) return true
  return now - lastSyncedTime >= GOOGLE_HOLIDAY_SYNC_STALE_MS
}

export function readGoogleHolidaySyncCache(): GoogleHolidaySyncCache | null {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.localStorage.getItem(GOOGLE_HOLIDAY_SYNC_CACHE_KEY)
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue) as Partial<GoogleHolidaySyncCache>
    if (!Array.isArray(parsed.syncedHolidayDates) || typeof parsed.lastSyncedAt !== 'string') return null
    return {
      syncedHolidayDates: uniqueSortedDateKeys(parsed.syncedHolidayDates.map((value) => String(value))),
      lastSyncedAt: parsed.lastSyncedAt,
    }
  } catch {
    return null
  }
}

export function writeGoogleHolidaySyncCache(cache: GoogleHolidaySyncCache) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(GOOGLE_HOLIDAY_SYNC_CACHE_KEY, JSON.stringify({
    syncedHolidayDates: uniqueSortedDateKeys(cache.syncedHolidayDates),
    lastSyncedAt: cache.lastSyncedAt,
  }))
}

export async function fetchGoogleHolidayDates(params: FetchGoogleHolidayDatesParams) {
  const { apiKey, calendarId = DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID, now = new Date(), fetchImpl = fetch } = params
  const { timeMin, timeMax } = createGoogleHolidayTimeRange(now)
  const dateKeys: string[] = []
  let nextPageToken = ''

  do {
    const searchParams = new URLSearchParams({
      key: apiKey,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      timeMin,
      timeMax,
    })
    if (nextPageToken) searchParams.set('pageToken', nextPageToken)

    const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${searchParams.toString()}`)
    if (!response.ok) {
      throw new Error(`Google祝日取得に失敗しました (${response.status})`)
    }

    const payload = (await response.json()) as GoogleHolidayEventsResponse
    for (const item of payload.items ?? []) {
      const dateKey = normalizeDateKey(item.start?.date ?? item.start?.dateTime ?? '')
      if (dateKey) dateKeys.push(dateKey)
    }
    nextPageToken = payload.nextPageToken ?? ''
  } while (nextPageToken)

  return uniqueSortedDateKeys(dateKeys)
}