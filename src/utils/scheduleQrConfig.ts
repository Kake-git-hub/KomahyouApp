export type ScheduleQrConfig = {
  baseUrl: string
  classroomId: string
  sessionId: string
  schoolNamePattern: string
  shortUrlBase?: string
}

type ScheduleQrPersonType = 'student' | 'teacher'
const PRIMARY_SHORT_URL_PREFIX = 'KomahyouApp'
const LEGACY_SHORT_URL_PREFIXES = [PRIMARY_SHORT_URL_PREFIX, 's']

function readEnvText(value: unknown) {
  return String(value ?? '').trim()
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function getRuntimeShortUrlBase() {
  if (typeof window === 'undefined') return ''
  const origin = readEnvText(window.location.origin)
  if (!origin || isLoopbackUrl(origin)) return ''
  return trimTrailingSlashes(origin)
}

export function buildLegacyLessonScheduleLongUrl(baseUrl: string, classroomId: string, sessionId: string, personType: ScheduleQrPersonType, personId: string) {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl)
  return `${normalizedBaseUrl}/#/c/${encodeURIComponent(classroomId)}/availability/${encodeURIComponent(sessionId)}/${personType}/${encodeURIComponent(personId)}`
}

export function buildLegacyLessonScheduleAvailabilityUrl(qrConfig: ScheduleQrConfig | undefined, personType: ScheduleQrPersonType, personId: string) {
  if (!qrConfig?.baseUrl || !qrConfig.classroomId || !qrConfig.sessionId || !personId) return undefined
  if (qrConfig.shortUrlBase) {
    return `${trimTrailingSlashes(qrConfig.shortUrlBase)}/${PRIMARY_SHORT_URL_PREFIX}/${encodeURIComponent(qrConfig.classroomId)}/${encodeURIComponent(qrConfig.sessionId)}/${personType}/${encodeURIComponent(personId)}`
  }

  return buildLegacyLessonScheduleLongUrl(qrConfig.baseUrl, qrConfig.classroomId, qrConfig.sessionId, personType, personId)
}

export function resolveLegacyLessonScheduleShortUrl(pathname: string, baseUrl: string) {
  const normalizedPath = pathname.split('#')[0]?.split('?')[0] ?? ''
  const segments = normalizedPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (segments.length !== 5 || !LEGACY_SHORT_URL_PREFIXES.includes(segments[0] ?? '')) return undefined

  const personType = segments[3]
  if (personType !== 'student' && personType !== 'teacher') return undefined

  return buildLegacyLessonScheduleLongUrl(
    baseUrl,
    decodePathSegment(segments[1]),
    decodePathSegment(segments[2]),
    personType,
    decodePathSegment(segments[4]),
  )
}

export function resolveCurrentLegacyLessonScheduleShortUrl(pathname: string) {
  const baseUrl = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_BASE_URL ?? 'https://kake-git-hub.github.io/LessonScheduleTable')
  if (!baseUrl) return undefined
  return resolveLegacyLessonScheduleShortUrl(pathname, baseUrl)
}

export function createLegacyLessonScheduleQrConfig(): ScheduleQrConfig | undefined {
  const baseUrl = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_BASE_URL ?? 'https://kake-git-hub.github.io/LessonScheduleTable')
  const classroomId = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_TEST_CLASSROOM_ID ?? '0002')
  const sessionId = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_TEST_CLASSROOM_SESSION_ID ?? '2026-spring')
  const schoolNamePattern = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_QR_SCHOOL_PATTERN ?? 'テスト教室2')
  const shortUrlBase = readEnvText(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_SHORT_URL_BASE) || getRuntimeShortUrlBase()

  if (!baseUrl || !classroomId || !sessionId || !schoolNamePattern) return undefined

  return {
    baseUrl: trimTrailingSlashes(baseUrl),
    classroomId,
    sessionId,
    schoolNamePattern,
    shortUrlBase: shortUrlBase ? trimTrailingSlashes(shortUrlBase) : undefined,
  }
}