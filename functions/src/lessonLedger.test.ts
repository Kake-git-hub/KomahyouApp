import { describe, expect, it } from 'vitest'

import {
  LESSON_LEDGER_ENCODING,
  LESSON_LEDGER_MAX_JSON_LENGTH,
  buildLessonLedgerDayDoc,
  decodeLessonLedgerBody,
  normalizeLessonLedger,
  toJstDateKeyFromIso,
} from './lessonLedger'

const FALLBACK = '2026-09-04T00:00:00.000Z'

function ledger(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    computedAt: '2026-09-04T10:15:00.000Z',
    rows: [{ studentId: 's001', subject: '数', makeupBalance: 1, makeupRemaining: ['2026-09-03#|手動調整'], attended: ['2026-09-01#1|regular'], absent: [], absentNoMakeup: [], placed: [] }],
    lectureRows: [],
    totals: { makeupBalance: 1, lecturePending: 0, attended: 1, placed: 0 },
    ...overrides,
  }
}

describe('normalizeLessonLedger', () => {
  it('正しい台帳はそのまま通す', () => {
    const result = normalizeLessonLedger(ledger(), { fallbackIso: FALLBACK })
    expect(result).toEqual(ledger())
  })

  it('形が崩れていれば null(保存本体は巻き添えにしない)', () => {
    expect(normalizeLessonLedger(null)).toBeNull()
    expect(normalizeLessonLedger([])).toBeNull()
    expect(normalizeLessonLedger({ rows: 'x', lectureRows: [] })).toBeNull()
    expect(normalizeLessonLedger({ rows: [], lectureRows: null })).toBeNull()
  })

  it('集計値の欠落・不正は 0 に、時刻の欠落は受領時刻に補う', () => {
    const result = normalizeLessonLedger(ledger({ totals: { makeupBalance: Number.NaN }, computedAt: 'broken', version: 'x' }), { fallbackIso: FALLBACK })!
    expect(result.totals).toEqual({ makeupBalance: 0, lecturePending: 0, attended: 0, placed: 0 })
    expect(result.computedAt).toBe(FALLBACK)
    expect(result.version).toBe(1)
  })

  it('大きすぎる台帳は捨てる', () => {
    const huge = ledger({ rows: [{ blob: 'x'.repeat(LESSON_LEDGER_MAX_JSON_LENGTH + 1) }] })
    expect(normalizeLessonLedger(huge)).toBeNull()
  })
})

describe('buildLessonLedgerDayDoc', () => {
  it('本文を圧縮し、集計と行数は平文で持つ(復号すると元の行に戻る)', () => {
    const doc = buildLessonLedgerDayDoc({
      ledger: normalizeLessonLedger(ledger())!,
      classroomId: 'c1',
      dateKey: '2026-09-04',
      savedAt: '2026-09-04T10:15:00.000Z',
      saveId: 'save-1',
      updatedBy: 'member-1',
      recordedAt: '2026-09-04T10:15:01.000Z',
    })
    expect(doc.dataEncoding).toBe(LESSON_LEDGER_ENCODING)
    expect(doc.rowCount).toBe(1)
    expect(doc.lectureRowCount).toBe(0)
    expect(doc.totals).toEqual({ makeupBalance: 1, lecturePending: 0, attended: 1, placed: 0 })
    expect(doc.updatedBy).toBe('member-1')
    expect(decodeLessonLedgerBody(doc.data)).toEqual({ rows: ledger().rows, lectureRows: [] })
  })
})

describe('toJstDateKeyFromIso', () => {
  it('UTC の日付境界をまたいでも JST の日付になる', () => {
    expect(toJstDateKeyFromIso('2026-09-03T15:30:00.000Z')).toBe('2026-09-04')
    expect(toJstDateKeyFromIso('2026-09-03T14:59:00.000Z')).toBe('2026-09-03')
  })

  it('壊れた時刻は fallback で補う', () => {
    expect(toJstDateKeyFromIso('broken', new Date('2026-09-04T00:00:00.000Z'))).toBe('2026-09-04')
  })
})
