import { describe, expect, it } from 'vitest'
import { sanitizeForFirestore } from './firestoreSanitize'

describe('sanitizeForFirestore', () => {
  it('removes undefined object fields recursively', () => {
    expect(sanitizeForFirestore({
      name: 'snapshot',
      optional: undefined,
      nested: {
        keep: true,
        drop: undefined,
      },
    })).toEqual({
      name: 'snapshot',
      nested: {
        keep: true,
      },
    })
  })

  it('converts undefined array entries to null while preserving order', () => {
    expect(sanitizeForFirestore([
      'first',
      undefined,
      { keep: 'value', drop: undefined },
    ])).toEqual([
      'first',
      null,
      { keep: 'value' },
    ])
  })

  it('converts Date, Set, Map, bigint, and non-finite numbers into Firestore-safe values', () => {
    expect(sanitizeForFirestore({
      when: new Date('2026-06-03T13:23:00.000Z'),
      tags: new Set(['A', undefined, 'B']),
      keyed: new Map([['left', 1], ['right', undefined]]),
      huge: 12n,
      infinite: Number.POSITIVE_INFINITY,
    })).toEqual({
      when: '2026-06-03T13:23:00.000Z',
      tags: ['A', null, 'B'],
      keyed: { left: 1 },
      huge: '12',
      infinite: null,
    })
  })

  it('falls back to toJSON or enumerable fields for custom objects', () => {
    class JsonBackedValue {
      toJSON() {
        return { kind: 'json-backed', extra: undefined }
      }
    }

    class EnumerableValue {
      constructor() {
        Object.assign(this, { kind: 'enumerable', keep: true, drop: undefined })
      }
    }

    expect(sanitizeForFirestore({
      jsonValue: new JsonBackedValue(),
      enumerableValue: new EnumerableValue(),
    })).toEqual({
      jsonValue: { kind: 'json-backed' },
      enumerableValue: { kind: 'enumerable', keep: true },
    })
  })
})
