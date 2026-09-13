import { describe, expect, it, vi } from 'vitest'
import { buildLegacyLessonScheduleAvailabilityUrl, buildLegacyLessonScheduleLongUrl, buildParentPortalUrl, buildSubmissionUrl, resolveLegacyLessonScheduleShortUrl, type ScheduleQrConfig } from './scheduleQrConfig'
import { extractParentPortalToken } from './parentPortalRoute'

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

  it('builds the current token submission url on hosting', () => {
    vi.stubGlobal('window', { location: { origin: 'https://komahyouapp-prod.web.app' } })

    expect(buildSubmissionUrl('abc123token')).toBe('https://komahyouapp-prod.web.app/s/abc123token')

    vi.unstubAllGlobals()
  })
})

// 保護者向け固定QR(docs/spec-parent-portal.md §C / §K-6): `/p/{token}` で、講習提出の `/s/{token}` と取り違えない。
describe('buildParentPortalUrl', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'

  it('本番ホスティングでは短縮パス /p/{token} を組み立てる', () => {
    vi.stubGlobal('window', { location: { origin: 'https://komahyouapp-prod.web.app' } })
    expect(buildParentPortalUrl(token)).toBe(`https://komahyouapp-prod.web.app/p/${token}`)
    expect(buildParentPortalUrl(token)).not.toContain('/s/')
    vi.unstubAllGlobals()
  })

  it('末尾スラッシュ付きの origin でも二重スラッシュにならない', () => {
    vi.stubGlobal('window', { location: { origin: 'https://komahyouapp-staging.web.app/' } })
    expect(buildParentPortalUrl(token)).toBe(`https://komahyouapp-staging.web.app/p/${token}`)
    vi.unstubAllGlobals()
  })

  it('ローカル開発(loopback)ではハッシュ経路 /#/parent/{token} にする', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    expect(buildParentPortalUrl(token)).toBe(`http://localhost:5173/#/parent/${token}`)
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } })
    expect(buildParentPortalUrl(token)).toBe(`http://127.0.0.1:5173/#/parent/${token}`)
    vi.unstubAllGlobals()
  })

  it('origin が無い(SSR/テスト)・トークンが空なら undefined', () => {
    vi.stubGlobal('window', { location: { origin: '' } })
    expect(buildParentPortalUrl(token)).toBeUndefined()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { origin: 'https://komahyouapp-prod.web.app' } })
    expect(buildParentPortalUrl('')).toBeUndefined()
    vi.unstubAllGlobals()
  })

  // 組み立て側(このファイル)と判定側(parentPortalRoute.ts)が対になっていることの往復テスト。
  it('組み立てた URL を extractParentPortalToken が同じトークンに戻せる(本番/ローカル両方)', () => {
    vi.stubGlobal('window', { location: { origin: 'https://komahyouapp-prod.web.app' } })
    const prodUrl = new URL(buildParentPortalUrl(token)!)
    expect(extractParentPortalToken(prodUrl.pathname, prodUrl.hash)).toBe(token)
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    const devUrl = new URL(buildParentPortalUrl(token)!)
    expect(extractParentPortalToken(devUrl.pathname, devUrl.hash)).toBe(token)
    vi.unstubAllGlobals()
  })
})