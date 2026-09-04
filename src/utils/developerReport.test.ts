import { describe, expect, it } from 'vitest'

import {
  DEVELOPER_REPORT_NOTE_LIMIT,
  DEVELOPER_REPORT_TRACE_LIMIT,
  SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE,
  buildDeveloperReportRequestBody,
  formatDeveloperReportResultMessage,
  normalizeDeveloperReportNote,
  normalizeDeveloperReportScheduleContext,
  parseScheduleDeveloperReportMessage,
} from './developerReport'
import type { OperationTraceEntry } from './operationTrace'

function trace(index: number): OperationTraceEntry {
  return { at: `2026-09-04T00:00:${String(index % 60).padStart(2, '0')}.000Z`, kind: 'board-commit', summary: `op-${index}` }
}

describe('developerReport: 任意の一言は空でも送れる', () => {
  it('note が無い/空/非文字列でも空文字として通す(送信を止めない)', () => {
    expect(normalizeDeveloperReportNote(undefined)).toBe('')
    expect(normalizeDeveloperReportNote('')).toBe('')
    expect(normalizeDeveloperReportNote(42)).toBe('')
    expect(normalizeDeveloperReportNote('  9/3 の振替が消えた  ')).toBe('9/3 の振替が消えた')
    expect(normalizeDeveloperReportNote('x'.repeat(DEVELOPER_REPORT_NOTE_LIMIT + 10))).toHaveLength(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(normalizeDeveloperReportNote('a\r\nb')).toBe('a\nb')
  })

  it('日程表からのメッセージは type が一致するときだけ受け付け、note 無しでも報告になる', () => {
    expect(parseScheduleDeveloperReportMessage(null)).toBeNull()
    expect(parseScheduleDeveloperReportMessage({ type: 'schedule-student-count-save' })).toBeNull()
    expect(parseScheduleDeveloperReportMessage({ type: SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE })).toEqual({ note: '', scheduleContext: undefined })
    expect(parseScheduleDeveloperReportMessage({
      type: SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE,
      note: ' 表示がおかしい ',
      context: { viewType: 'student', startDate: '2026-09-01', endDate: '2026-09-07', personLabel: '山田', nested: { a: 1 }, count: 3, flag: true, 'bad key': 'x' },
    })).toEqual({
      note: '表示がおかしい',
      scheduleContext: { viewType: 'student', startDate: '2026-09-01', endDate: '2026-09-07', personLabel: '山田', count: '3', flag: 'true' },
    })
  })

  it('scheduleContext はキー数・値長を制限し、空なら undefined', () => {
    expect(normalizeDeveloperReportScheduleContext({})).toBeUndefined()
    expect(normalizeDeveloperReportScheduleContext('x')).toBeUndefined()
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v']))
    expect(Object.keys(normalizeDeveloperReportScheduleContext(many) ?? {})).toHaveLength(12)
    expect(normalizeDeveloperReportScheduleContext({ a: 'x'.repeat(500) })?.a).toHaveLength(200)
  })
})

describe('developerReport: 送信本文の組み立て', () => {
  it('操作痕跡は新しい方から上限件数だけ同梱し、メタを切り詰める', () => {
    const operations = Array.from({ length: DEVELOPER_REPORT_TRACE_LIMIT + 20 }, (_, i) => trace(i))
    const body = buildDeveloperReportRequestBody({
      classroomId: 'c1',
      source: 'board',
      note: undefined,
      appVersion: '1.5.490',
      userAgent: 'u'.repeat(500),
      pageUrl: 'https://example.test/' + 'p'.repeat(500),
      screen: 'board',
      boardDirty: true,
      lastSavedAt: '2026-09-04T00:00:00.000Z',
      recentOperations: operations,
      snapshotPayload: null,
      now: new Date('2026-09-04T12:00:00.000Z'),
    })
    expect(body.note).toBe('')
    expect(body.reportedAt).toBe('2026-09-04T12:00:00.000Z')
    expect(body.recentOperations).toHaveLength(DEVELOPER_REPORT_TRACE_LIMIT)
    expect(body.recentOperations[0]?.summary).toBe('op-20')
    expect(body.recentOperations.at(-1)?.summary).toBe(`op-${DEVELOPER_REPORT_TRACE_LIMIT + 19}`)
    expect(body.userAgent).toHaveLength(300)
    expect(body.pageUrl).toHaveLength(300)
    expect(body.boardDirty).toBe(true)
    expect('scheduleContext' in body).toBe(false)
    expect(body.snapshotPayload).toBeNull()
  })

  it('日程表からの報告は scheduleContext を正規化して載せる', () => {
    const body = buildDeveloperReportRequestBody({
      classroomId: 'c1',
      source: 'schedule',
      note: 'x',
      appVersion: '1',
      userAgent: '',
      pageUrl: '',
      screen: 'board',
      boardDirty: false,
      lastSavedAt: '',
      recentOperations: [],
      scheduleContext: { viewType: 'teacher', personLabel: ' 佐藤 ' },
      snapshotPayload: null,
    })
    expect(body.source).toBe('schedule')
    expect(body.scheduleContext).toEqual({ viewType: 'teacher', personLabel: '佐藤' })
  })

  it('結果文は成功に受付番号、失敗に理由を含む', () => {
    expect(formatDeveloperReportResultMessage({ ok: true, reportId: '20260904-1200-abc' })).toContain('20260904-1200-abc')
    expect(formatDeveloperReportResultMessage({ ok: false, error: 'network' })).toContain('network')
  })
})
