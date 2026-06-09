import { describe, expect, it } from 'vitest'
import { initialSpecialSessions, removedDefaultSpecialSessionIds, resolveLectureSubjectDuration } from './specialSessionModel'

describe('specialSessionModel', () => {
  it('starts with no default special sessions', () => {
    expect(initialSpecialSessions).toEqual([])
  })

  it('keeps the legacy default session ids for cleanup migrations', () => {
    expect(removedDefaultSpecialSessionIds).toEqual([
      'session_2026_summer',
      'session_2026_spring',
      'session_2026_exam',
      'session_2026_winter',
    ])
  })
})

// spec-lecture-stock §6 / TODO4: 授業時間。未設定=90、60/45 を許容、それ以外は90へ丸め。
describe('resolveLectureSubjectDuration', () => {
  it('defaults to 90 when unset', () => {
    expect(resolveLectureSubjectDuration(undefined, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: undefined }, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: {} }, '数')).toBe(90)
  })

  it('returns 60/45 when explicitly set', () => {
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 60 } }, '数')).toBe(60)
    expect(resolveLectureSubjectDuration({ subjectDurations: { 英: 45 } }, '英')).toBe(45)
  })

  it('rounds invalid values to 90', () => {
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 30 } }, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 0 } }, '数')).toBe(90)
  })
})