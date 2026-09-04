import { describe, expect, it } from 'vitest'

import { OPERATION_EVENT_REQUEST_LIMIT, normalizeOperationEvents } from './operationEvents'

const FALLBACK = '2026-09-04T00:00:00.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc123_makeup-stock-delete_x1',
    at: '2026-09-04T10:15:00.000Z',
    kind: 'makeup-stock-delete',
    detail: { studentName: '青木 太郎', subject: '数', originDate: '2026-08-11' },
    ...overrides,
  }
}

describe('normalizeOperationEvents', () => {
  it('正しいイベントはそのまま通す', () => {
    expect(normalizeOperationEvents([event()], { fallbackIso: FALLBACK })).toEqual([{
      id: 'abc123_makeup-stock-delete_x1',
      at: '2026-09-04T10:15:00.000Z',
      kind: 'makeup-stock-delete',
      detail: { studentName: '青木 太郎', subject: '数', originDate: '2026-08-11' },
    }])
  })

  it('配列でない入力・未知の種別・不正な id は捨てる', () => {
    expect(normalizeOperationEvents(null)).toEqual([])
    expect(normalizeOperationEvents({ id: 'x' })).toEqual([])
    expect(normalizeOperationEvents([event({ kind: 'drop-database' })])).toEqual([])
    // ドキュメント id を兼ねるのでパス区切りを含む id は受け付けない
    expect(normalizeOperationEvents([event({ id: 'a/b' })])).toEqual([])
    expect(normalizeOperationEvents([event({ id: '' })])).toEqual([])
  })

  it('壊れた1件だけ捨てて残りは通す(保存本体を巻き添えにしない)', () => {
    const result = normalizeOperationEvents([event({ id: 'bad/id' }), event({ id: 'good_1' })], { fallbackIso: FALLBACK })
    expect(result.map((entry) => entry.id)).toEqual(['good_1'])
  })

  it('同じ id は最初の1件だけ残す(再送・重複の吸収)', () => {
    const result = normalizeOperationEvents([
      event({ id: 'dup_1', detail: { order: 1 } }),
      event({ id: 'dup_1', detail: { order: 2 } }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].detail).toEqual({ order: 1 })
  })

  it('detail は文字列/数値/真偽値だけ通し、入れ子・長すぎる値・不正キーを落とす', () => {
    const result = normalizeOperationEvents([event({
      detail: {
        studentName: '  青木 太郎  ',
        nested: { a: 1 },
        list: [1, 2],
        long: 'あ'.repeat(300),
        count: 2,
        flag: true,
        broken: Number.POSITIVE_INFINITY,
        '危険なキー': 'x',
        '__proto__': 'x',
      },
    })], { fallbackIso: FALLBACK })

    expect(result[0].detail).toEqual({
      studentName: '青木 太郎',
      long: 'あ'.repeat(120),
      count: 2,
      flag: true,
    })
  })

  it('detail のキー数に上限がある', () => {
    const detail: Record<string, number> = {}
    for (let index = 0; index < 50; index += 1) detail[`key${index}`] = index
    const result = normalizeOperationEvents([event({ detail })])
    expect(Object.keys(result[0].detail)).toHaveLength(24)
  })

  it('時刻が壊れていれば受領時刻で補う', () => {
    expect(normalizeOperationEvents([event({ at: 'not-a-date' })], { fallbackIso: FALLBACK })[0].at).toBe(FALLBACK)
    expect(normalizeOperationEvents([event({ at: undefined })], { fallbackIso: FALLBACK })[0].at).toBe(FALLBACK)
  })

  it('1リクエストの件数に上限がある(Firestore バッチ上限を超えない)', () => {
    const many = Array.from({ length: OPERATION_EVENT_REQUEST_LIMIT + 20 }, (_, index) => event({ id: `id_${index}` }))
    expect(normalizeOperationEvents(many)).toHaveLength(OPERATION_EVENT_REQUEST_LIMIT)
  })
})
