import { describe, expect, it } from 'vitest'
import { initialSpecialSessions, removedDefaultSpecialSessionIds } from './specialSessionModel'

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