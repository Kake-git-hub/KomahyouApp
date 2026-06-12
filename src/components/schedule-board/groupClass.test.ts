import { describe, expect, it } from 'vitest'
import {
  cloneGroupClassEntryMap,
  groupClassEntryKey,
  isGroupClassBand,
  isGroupClassSubject,
  normalizeGroupClassEntryMap,
  resolveGroupClassDayFlags,
  type GroupClassEntryMap,
} from './groupClass'

describe('groupClassEntryKey', () => {
  it('builds a stable key from dateKey and band', () => {
    expect(groupClassEntryKey('2026-07-21', 1)).toBe('2026-07-21_1')
    expect(groupClassEntryKey('2026-07-21', 2)).toBe('2026-07-21_2')
  })
})

describe('subject / band guards', () => {
  it('accepts only the two group subjects', () => {
    expect(isGroupClassSubject('集団理科')).toBe(true)
    expect(isGroupClassSubject('集団社会')).toBe(true)
    expect(isGroupClassSubject('理')).toBe(false)
    expect(isGroupClassSubject('集団英語')).toBe(false)
    expect(isGroupClassSubject(undefined)).toBe(false)
  })

  it('accepts only band 1 and 2', () => {
    expect(isGroupClassBand(1)).toBe(true)
    expect(isGroupClassBand(2)).toBe(true)
    expect(isGroupClassBand(0)).toBe(false)
    expect(isGroupClassBand(3)).toBe(false)
    expect(isGroupClassBand('1')).toBe(false)
  })
})

describe('normalizeGroupClassEntryMap', () => {
  it('defaults to an empty map for missing / invalid input', () => {
    expect(normalizeGroupClassEntryMap(undefined)).toEqual({})
    expect(normalizeGroupClassEntryMap(null)).toEqual({})
    expect(normalizeGroupClassEntryMap('nope')).toEqual({})
    expect(normalizeGroupClassEntryMap(123)).toEqual({})
  })

  it('keeps valid entries and fills attendance arrays', () => {
    const normalized = normalizeGroupClassEntryMap({
      '2026-07-21_1': {
        dateKey: '2026-07-21',
        band: 1,
        subject: '集団理科',
        teacherName: '山田先生',
        absentStudentIds: ['s1', 's1', 's2'],
        addedStudentIds: ['s9'],
      },
    })
    expect(normalized['2026-07-21_1']).toEqual({
      dateKey: '2026-07-21',
      band: 1,
      subject: '集団理科',
      teacherName: '山田先生',
      absentStudentIds: ['s1', 's2'],
      addedStudentIds: ['s9'],
    })
  })

  it('drops entries with an invalid band or subject', () => {
    const normalized = normalizeGroupClassEntryMap({
      bad_band: { dateKey: '2026-07-21', band: 3, subject: '集団理科', absentStudentIds: [], addedStudentIds: [] },
      bad_subject: { dateKey: '2026-07-21', band: 1, subject: '集団英語', absentStudentIds: [], addedStudentIds: [] },
      no_date: { dateKey: '', band: 1, subject: '集団理科', absentStudentIds: [], addedStudentIds: [] },
      good: { dateKey: '2026-07-22', band: 2, subject: '集団社会', absentStudentIds: [], addedStudentIds: [] },
    })
    expect(Object.keys(normalized)).toEqual(['good'])
  })

  it('omits a blank teacherName but keeps attendance', () => {
    const normalized = normalizeGroupClassEntryMap({
      k: { dateKey: '2026-07-21', band: 1, subject: '集団理科', teacherName: '   ', absentStudentIds: ['s1'], addedStudentIds: [] },
    })
    expect(normalized.k).not.toHaveProperty('teacherName')
    expect(normalized.k.absentStudentIds).toEqual(['s1'])
  })

  it('survives a JSON round-trip (snapshot save / load)', () => {
    const original: GroupClassEntryMap = {
      '2026-07-21_1': { dateKey: '2026-07-21', band: 1, subject: '集団理科', teacherName: '山田先生', absentStudentIds: ['s2'], addedStudentIds: ['s9'] },
      '2026-07-21_2': { dateKey: '2026-07-21', band: 2, subject: '集団社会', absentStudentIds: [], addedStudentIds: [] },
    }
    const roundTripped = normalizeGroupClassEntryMap(JSON.parse(JSON.stringify(original)))
    expect(roundTripped).toEqual(original)
  })
})

describe('resolveGroupClassDayFlags', () => {
  const week = [
    { dateKey: '2026-07-20' }, // 月
    { dateKey: '2026-07-21' }, // 火
    { dateKey: '2026-07-22' }, // 水
    { dateKey: '2026-07-23' }, // 木
    { dateKey: '2026-07-24' }, // 金
    { dateKey: '2026-07-25' }, // 土
    { dateKey: '2026-07-26' }, // 日
  ]

  it('does not show group rows when no special period overlaps the week', () => {
    const { showGroupClassRows, specialDayIndexSet } = resolveGroupClassDayFlags(week, [])
    expect(showGroupClassRows).toBe(false)
    expect(specialDayIndexSet.size).toBe(0)
  })

  it('marks only the days inside the special period', () => {
    const { showGroupClassRows, specialDayIndexSet } = resolveGroupClassDayFlags(week, [
      { startDate: '2026-07-21', endDate: '2026-07-23' },
    ])
    expect(showGroupClassRows).toBe(true)
    expect([...specialDayIndexSet].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('unions overlapping / multiple periods within the week', () => {
    const { specialDayIndexSet } = resolveGroupClassDayFlags(week, [
      { startDate: '2026-07-20', endDate: '2026-07-20' },
      { startDate: '2026-07-24', endDate: '2026-07-31' },
    ])
    expect([...specialDayIndexSet].sort((a, b) => a - b)).toEqual([0, 4, 5, 6])
  })

  it('shows rows when a period covers the whole visible week', () => {
    const { showGroupClassRows, specialDayIndexSet } = resolveGroupClassDayFlags(week, [
      { startDate: '2026-07-01', endDate: '2026-08-31' },
    ])
    expect(showGroupClassRows).toBe(true)
    expect(specialDayIndexSet.size).toBe(7)
  })
})

describe('cloneGroupClassEntryMap', () => {
  it('deep-copies attendance arrays so mutations do not leak', () => {
    const source: GroupClassEntryMap = {
      k: { dateKey: '2026-07-21', band: 1, subject: '集団理科', absentStudentIds: ['s1'], addedStudentIds: [] },
    }
    const clone = cloneGroupClassEntryMap(source)
    clone.k.absentStudentIds.push('s2')
    expect(source.k.absentStudentIds).toEqual(['s1'])
  })

  it('returns an empty map for nullish input', () => {
    expect(cloneGroupClassEntryMap(null)).toEqual({})
    expect(cloneGroupClassEntryMap(undefined)).toEqual({})
  })
})
