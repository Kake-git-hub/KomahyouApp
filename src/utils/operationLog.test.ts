import { beforeEach, describe, expect, it } from 'vitest'

import {
  OPERATION_EVENT_BUFFER_LIMIT,
  OPERATION_EVENT_DETAIL_VALUE_LIMIT,
  appendOperationEvent,
  buildOperationEvent,
  clearOperationEvents,
  peekOperationEvents,
  recordOperationEvent,
  restoreOperationEvents,
  setOperationLogClassroomId,
  takeOperationEvents,
} from './operationLog'

describe('operationLog', () => {
  beforeEach(() => {
    clearOperationEvents()
  })

  it('detail の undefined / 空文字 / 非有限数を落とし、長い文字列を切り詰める', () => {
    const event = buildOperationEvent('makeup-stock-delete', {
      studentName: '  青木 太郎  ',
      empty: '',
      long: 'あ'.repeat(400),
      count: 3,
      broken: Number.NaN,
      flag: false,
      missing: undefined as unknown as string,
    }, { now: new Date('2026-09-04T10:00:00.000Z'), idSuffix: 'fixed' })

    expect(event.detail).toEqual({
      studentName: '青木 太郎',
      long: 'あ'.repeat(OPERATION_EVENT_DETAIL_VALUE_LIMIT),
      count: 3,
      flag: false,
    })
    expect(event.at).toBe('2026-09-04T10:00:00.000Z')
    expect(event.id).toBe(`${new Date('2026-09-04T10:00:00.000Z').getTime().toString(36)}_makeup-stock-delete_fixed`)
  })

  it('同じミリ秒に作っても id が衝突しない(ドキュメント id を兼ねるため)', () => {
    const now = new Date('2026-09-04T10:00:00.000Z')
    const ids = new Set(Array.from({ length: 50 }, () => buildOperationEvent('lesson-delete', {}, { now }).id))
    expect(ids.size).toBe(50)
  })

  it('バッファ上限を超えたら古いものから捨てる', () => {
    let buffer = [] as ReturnType<typeof buildOperationEvent>[]
    for (let index = 0; index < 5; index += 1) {
      buffer = appendOperationEvent(buffer, buildOperationEvent('lesson-delete', { index }), 3)
    }
    expect(buffer).toHaveLength(3)
    expect(buffer.map((event) => event.detail.index)).toEqual([2, 3, 4])
  })

  it('教室が未登録なら記録しない(別教室への混入を避ける)', () => {
    expect(recordOperationEvent('makeup-stock-delete', { studentName: '青木' })).toBeNull()
    expect(peekOperationEvents('classroom-a')).toEqual([])
  })

  it('教室ごとにバッファを分け、take で取り出すと空になる', () => {
    setOperationLogClassroomId('classroom-a')
    recordOperationEvent('makeup-stock-delete', { studentName: '青木' })
    setOperationLogClassroomId('classroom-b')
    recordOperationEvent('lesson-delete', { studentName: '井上' })

    expect(peekOperationEvents('classroom-a')).toHaveLength(1)
    const taken = takeOperationEvents('classroom-a')
    expect(taken.map((event) => event.kind)).toEqual(['makeup-stock-delete'])
    expect(peekOperationEvents('classroom-a')).toEqual([])
    // 別教室のバッファは影響を受けない
    expect(peekOperationEvents('classroom-b')).toHaveLength(1)
  })

  it('保存に失敗したイベントは先頭へ戻り、操作順が保たれる', () => {
    setOperationLogClassroomId('classroom-a')
    const first = recordOperationEvent('makeup-stock-delete', { order: 1 })!
    const sent = takeOperationEvents('classroom-a')
    expect(sent).toEqual([first])

    // 送信中に発生した新しい操作
    const second = recordOperationEvent('lesson-delete', { order: 2 })!
    restoreOperationEvents('classroom-a', sent)

    expect(peekOperationEvents('classroom-a').map((event) => event.detail.order)).toEqual([1, 2])
    expect(peekOperationEvents('classroom-a')[1].id).toBe(second.id)
  })

  it('戻すときも上限を超えない', () => {
    setOperationLogClassroomId('classroom-a')
    const overflow = Array.from({ length: OPERATION_EVENT_BUFFER_LIMIT + 5 }, (_, index) => buildOperationEvent('lesson-delete', { index }))
    restoreOperationEvents('classroom-a', overflow)
    expect(peekOperationEvents('classroom-a')).toHaveLength(OPERATION_EVENT_BUFFER_LIMIT)
  })

  it('clear でアカウント切替時に持ち越さない', () => {
    setOperationLogClassroomId('classroom-a')
    recordOperationEvent('lesson-store', {})
    clearOperationEvents()
    expect(peekOperationEvents('classroom-a')).toEqual([])
    expect(recordOperationEvent('lesson-store', {})).toBeNull()
  })
})
