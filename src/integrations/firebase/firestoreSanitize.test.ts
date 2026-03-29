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
})