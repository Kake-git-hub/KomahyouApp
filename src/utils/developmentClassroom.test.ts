import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroom } from './developmentClassroom'

describe('isDevelopmentClassroom', () => {
  it('accepts exact and extended development classroom names', () => {
    expect(isDevelopmentClassroom({ id: 'development', name: '開発用教室' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'classroom-1', name: '開発用教室（検証用）' })).toBe(true)
  })

  it('accepts ids containing development markers', () => {
    expect(isDevelopmentClassroom({ id: 'development_classroom', name: '検証教室' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'dev_room_001', name: '検証教室' })).toBe(true)
  })

  it('does not match normal classrooms', () => {
    expect(isDevelopmentClassroom({ id: 'classroom_001', name: '本校' })).toBe(false)
  })
})
