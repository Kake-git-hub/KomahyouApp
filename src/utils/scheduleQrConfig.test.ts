import { describe, expect, it } from 'vitest'
import { buildLegacyLessonScheduleAvailabilityUrl, buildLegacyLessonScheduleLongUrl, resolveLegacyLessonScheduleShortUrl, type ScheduleQrConfig } from './scheduleQrConfig'

describe('scheduleQrConfig', () => {
  const baseConfig: ScheduleQrConfig = {
    baseUrl: 'https://kake-git-hub.github.io/LessonScheduleTable',
    classroomId: '0002',
    sessionId: '2026-spring',
    schoolNamePattern: 'テスト教室2',
  }

  it('builds the legacy long url when a short base is not configured', () => {
    expect(buildLegacyLessonScheduleAvailabilityUrl(baseConfig, 'student', 's001')).toBe(
      'https://kake-git-hub.github.io/LessonScheduleTable/#/c/0002/availability/2026-spring/student/s001',
    )
  })

  it('builds a short hosting url when a short base is configured', () => {
    expect(buildLegacyLessonScheduleAvailabilityUrl({
      ...baseConfig,
      shortUrlBase: 'https://komahyouapp-prod.web.app',
    }, 'teacher', 't001')).toBe(
      'https://komahyouapp-prod.web.app/KomahyouApp/0002/2026-spring/teacher/t001',
    )
  })

  it('resolves a short hosting url back to the legacy lesson schedule url', () => {
    expect(resolveLegacyLessonScheduleShortUrl('/KomahyouApp/0002/2026-spring/student/s001', baseConfig.baseUrl)).toBe(
      buildLegacyLessonScheduleLongUrl(baseConfig.baseUrl, '0002', '2026-spring', 'student', 's001'),
    )
  })

  it('keeps resolving the old /s path for backward compatibility', () => {
    expect(resolveLegacyLessonScheduleShortUrl('/s/0002/2026-spring/student/s001', baseConfig.baseUrl)).toBe(
      buildLegacyLessonScheduleLongUrl(baseConfig.baseUrl, '0002', '2026-spring', 'student', 's001'),
    )
  })

  it('returns undefined for unrelated paths', () => {
    expect(resolveLegacyLessonScheduleShortUrl('/developer', baseConfig.baseUrl)).toBeUndefined()
  })
})