import { describe, expect, it } from 'vitest'

import {
  DEVELOPER_REPORT_UI_TEXT,
  isDeveloperReportTestNote,
  normalizeDeveloperReportCategory,
  validateDeveloperReportNote,
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

describe('developerReport: 一言は必須(2026-09-04 改定)', () => {
  it('validateDeveloperReportNote は空/空白/非文字列を弾き、入力があれば null', () => {
    expect(validateDeveloperReportNote('')).toBe(DEVELOPER_REPORT_UI_TEXT.requiredError)
    expect(validateDeveloperReportNote('   \n ')).toBe(DEVELOPER_REPORT_UI_TEXT.requiredError)
    expect(validateDeveloperReportNote(undefined)).toBe(DEVELOPER_REPORT_UI_TEXT.requiredError)
    expect(validateDeveloperReportNote('9/3 の振替が消えた')).toBeNull()
    // 文言に「空欄のままでも送れます」を復活させない(オーナー指示で撤回)。
    for (const text of Object.values(DEVELOPER_REPORT_UI_TEXT)) {
      const value = typeof text === 'function' ? text('教室') : text
      expect(value).not.toContain('空欄')
    }
    expect(DEVELOPER_REPORT_UI_TEXT.description('緑が丘校')).toContain('教室「緑が丘校」')
    // ボタン名・題名は「要望・報告」(オーナー確定 2026-09-04)。要望も同じ導線で送れることを本文で示す。
    expect(DEVELOPER_REPORT_UI_TEXT.title).toBe('要望・報告')
    expect(DEVELOPER_REPORT_UI_TEXT.description('')).toContain('要望')
    expect(DEVELOPER_REPORT_UI_TEXT.categoryOptions.map((o) => o.value)).toEqual(['bug', 'request'])
    // 入力ヒント: 修正しやすい情報(生徒名・日付・コマ・何が起きたか)を促す(オーナー指示 2026-09-04)。
    for (const keyword of ['生徒名', '日付', 'コマ', '何が起きたか', '精度']) {
      expect(DEVELOPER_REPORT_UI_TEXT.inputHint).toContain(keyword)
    }
  })

  it('種類は bug/request だけを受け付け、不明なら bug', () => {
    expect(normalizeDeveloperReportCategory('request')).toBe('request')
    expect(normalizeDeveloperReportCategory('bug')).toBe('bug')
    expect(normalizeDeveloperReportCategory('other')).toBe('bug')
    expect(normalizeDeveloperReportCategory(undefined)).toBe('bug')
  })

  it('内容に #テスト(または #test) があればテスト扱いと先読みできる', () => {
    expect(isDeveloperReportTestNote('#テスト 送信確認')).toBe(true)
    expect(isDeveloperReportTestNote('送信確認 #test')).toBe(true)
    expect(isDeveloperReportTestNote('テストの振替が消えた')).toBe(false)
    expect(isDeveloperReportTestNote('#testing')).toBe(false)
  })

  it('normalizeDeveloperReportNote は整形だけを担い、必須判定は validateDeveloperReportNote が担う', () => {
    expect(normalizeDeveloperReportNote(undefined)).toBe('')
    expect(normalizeDeveloperReportNote('')).toBe('')
    expect(normalizeDeveloperReportNote(42)).toBe('')
    expect(normalizeDeveloperReportNote('  9/3 の振替が消えた  ')).toBe('9/3 の振替が消えた')
    expect(normalizeDeveloperReportNote('x'.repeat(DEVELOPER_REPORT_NOTE_LIMIT + 10))).toHaveLength(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(normalizeDeveloperReportNote('a\r\nb')).toBe('a\nb')
  })

  it('日程表からのメッセージは type が一致するときだけ受け付ける(空 note は解析は通し、本体側の必須検証で弾く)', () => {
    expect(parseScheduleDeveloperReportMessage(null)).toBeNull()
    expect(parseScheduleDeveloperReportMessage({ type: 'schedule-student-count-save' })).toBeNull()
    const empty = parseScheduleDeveloperReportMessage({ type: SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE })
    expect(empty).toEqual({ note: '', category: 'bug', scheduleContext: undefined })
    expect(validateDeveloperReportNote(empty?.note)).toBe(DEVELOPER_REPORT_UI_TEXT.requiredError)
    expect(parseScheduleDeveloperReportMessage({
      type: SCHEDULE_DEVELOPER_REPORT_MESSAGE_TYPE,
      note: ' 表示がおかしい ',
      category: 'request',
      context: { viewType: 'student', startDate: '2026-09-01', endDate: '2026-09-07', personLabel: '山田', nested: { a: 1 }, count: 3, flag: true, 'bad key': 'x' },
    })).toEqual({
      note: '表示がおかしい',
      category: 'request',
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
      category: 'bug',
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
    expect(body.category).toBe('bug')
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
      category: 'request',
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
    expect(body.category).toBe('request')
    expect(body.scheduleContext).toEqual({ viewType: 'teacher', personLabel: '佐藤' })
  })

  it('結果文は成功に受付番号、テストはその旨、失敗に理由を含む', () => {
    expect(formatDeveloperReportResultMessage({ ok: true, reportId: '20260904-1200-abc' })).toContain('20260904-1200-abc')
    expect(formatDeveloperReportResultMessage({ ok: true, reportId: 'r', isTest: true })).toContain('テストとして受け付けました')
    expect(formatDeveloperReportResultMessage({ ok: false, error: 'network' })).toContain('network')
  })
})
