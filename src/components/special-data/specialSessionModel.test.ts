import { describe, expect, it } from 'vitest'
import { groupClassSubmissionSubjects, initialSpecialSessions, removedDefaultSpecialSessionIds, resolveGroupClassParticipation, resolveLectureSubjectDuration } from './specialSessionModel'

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

// spec-group-lesson §C: 集団授業の参加可否。未設定=不参加(既定)、明示 true のみ参加。
describe('resolveGroupClassParticipation', () => {
  it('exposes the two group submission subjects', () => {
    expect(groupClassSubmissionSubjects).toEqual(['集団理科', '集団社会'])
  })

  it('defaults to 不参加 (false) when unset', () => {
    expect(resolveGroupClassParticipation(undefined, '集団理科')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: undefined }, '集団理科')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: {} }, '集団理科')).toBe(false)
  })

  it('returns 参加 (true) only when explicitly true', () => {
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団理科: true } }, '集団理科')).toBe(true)
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団理科: true } }, '集団社会')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団社会: false } }, '集団社会')).toBe(false)
  })
})