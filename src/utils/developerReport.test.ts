import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DEVELOPER_REPORT_AI_ANSWER_HEADING,
  DEVELOPER_REPORT_CATEGORIES,
  DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY,
  DEVELOPER_REPORT_UI_TEXT,
  resolveDeveloperReportQuestionNotice,
  resolveDeveloperReportSendingLabel,
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
    // ボタン名・題名は「質問・要望」(オーナー確定 2026-09-04「要望・報告」→ 2026-09-14 改名)。要望も同じ導線で送れることを本文で示す。
    expect(DEVELOPER_REPORT_UI_TEXT.title).toBe('質問・要望')
    expect(DEVELOPER_REPORT_UI_TEXT.description('')).toContain('要望')
    // 使い方の質問(question)も同じ導線(2026-09-13)。並びは 質問 → 要望 → 不具合、モーダルの既定は質問(オーナー指示 2026-09-14)。
    expect(DEVELOPER_REPORT_UI_TEXT.categoryOptions.map((o) => o.value)).toEqual(['question', 'request', 'bug'])
    expect(DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY).toBe('question')
    // 「#テスト と書いてください」の案内文は削除(オーナー指示 2026-09-14)。テスト判定そのものは残す(下のテスト)。
    expect(Object.keys(DEVELOPER_REPORT_UI_TEXT)).not.toContain('testHint')
    for (const text of Object.values(DEVELOPER_REPORT_UI_TEXT)) {
      const value = typeof text === 'function' ? text('教室') : text
      expect(JSON.stringify(value)).not.toContain('#テスト')
    }
    expect(DEVELOPER_REPORT_UI_TEXT.categoryOptions.find((o) => o.value === 'question')?.label).toBe('使い方の質問')
    expect(DEVELOPER_REPORT_UI_TEXT.description('')).toContain('質問')
    // 入力ヒント: 修正しやすい情報(生徒名・日付・コマ・何が起きたか)を促す(オーナー指示 2026-09-04)。
    for (const keyword of ['生徒名', '日付', 'コマ', '何が起きたか', '精度']) {
      expect(DEVELOPER_REPORT_UI_TEXT.inputHint).toContain(keyword)
    }
  })

  it('種類は bug/request/question だけを受け付け、不明なら bug', () => {
    expect(normalizeDeveloperReportCategory('request')).toBe('request')
    expect(normalizeDeveloperReportCategory('question')).toBe('question')
    // サーバー側(functions/src/developerReport.ts)の受け付け種別と二重管理。片方だけに足すとサーバーが bug に丸めるので、
    // 期待一覧を両方のテストに同じ形で固定する(operationLog.test.ts と同じ作法)。
    expect([...DEVELOPER_REPORT_CATEGORIES]).toEqual(['bug', 'request', 'question'])
    expect(normalizeDeveloperReportCategory('bug')).toBe('bug')
    expect(normalizeDeveloperReportCategory('other')).toBe('bug')
    expect(normalizeDeveloperReportCategory(undefined)).toBe('bug')
  })

  it('質問を選んだときだけ「すぐには返らない」注意文を出す(spec §G-2・盤面 React モーダル)', () => {
    // 即答の期待を作らない(利用者への自動回答はしない・オーナー確定 2026-09-12)。
    expect(DEVELOPER_REPORT_UI_TEXT.questionNotice).toContain('すぐには返りません')
    expect(DEVELOPER_REPORT_UI_TEXT.questionNotice).toContain('自動返信はしません')
    // React モーダルは question 選択時だけ注意文を描く(source-scan: コンポーネントは jsdom なしで描かないため文面の配線を固定)。
    const modalSource = readFileSync(fileURLToPath(new URL('../components/developer-report/DeveloperReportModal.tsx', import.meta.url)), 'utf8')
    expect(modalSource).toContain("{category === 'question' ? (")
    expect(modalSource).toContain('{resolveDeveloperReportQuestionNotice(aiAnswerEnabled)}')
    expect(modalSource).toContain('developer-report-question-notice')
    // 既定の種類は並びの先頭(質問)。#テスト の案内文は描かない(2026-09-14)。
    expect(modalSource).toContain('useState<DeveloperReportCategory>(DEVELOPER_REPORT_DEFAULT_MODAL_CATEGORY)')
    expect(modalSource).not.toContain('testHint')
  })

  it('AI 即時回答が有効な教室(開発用教室のみ・spec §G-7)だけ、質問の注意文と送信中文言を切り替える', () => {
    expect(resolveDeveloperReportQuestionNotice(false)).toBe(DEVELOPER_REPORT_UI_TEXT.questionNotice)
    expect(resolveDeveloperReportQuestionNotice(true)).toBe(DEVELOPER_REPORT_UI_TEXT.questionNoticeAi)
    expect(DEVELOPER_REPORT_UI_TEXT.questionNoticeAi).toContain('AI')
    expect(DEVELOPER_REPORT_UI_TEXT.questionNoticeAi).toContain('誤りがあり得ます')
    expect(resolveDeveloperReportSendingLabel('question', true)).toBe(DEVELOPER_REPORT_UI_TEXT.sendingAi)
    // AI を呼ばない組み合わせでは従来の文言(要望・不具合は AI 対象外／無効な教室は質問でも従来)。
    expect(resolveDeveloperReportSendingLabel('request', true)).toBe(DEVELOPER_REPORT_UI_TEXT.sending)
    expect(resolveDeveloperReportSendingLabel('bug', true)).toBe(DEVELOPER_REPORT_UI_TEXT.sending)
    expect(resolveDeveloperReportSendingLabel('question', false)).toBe(DEVELOPER_REPORT_UI_TEXT.sending)
  })

  it('送信結果に AI の回答(または作れなかった理由)を受付文の後ろへ添える', () => {
    const answered = formatDeveloperReportResultMessage({ ok: true, reportId: 'r1', aiAnswer: '基本データ画面で生徒を選びます。' })
    expect(answered.startsWith('開発者へ送りました（受付番号 r1）。')).toBe(true)
    expect(answered).toContain(`

${DEVELOPER_REPORT_AI_ANSWER_HEADING}
基本データ画面で生徒を選びます。`)
    const failed = formatDeveloperReportResultMessage({ ok: true, reportId: 'r2', aiAnswerError: 'AI が混み合っています' })
    expect(failed).toContain('AI の自動回答は作れませんでした: AI が混み合っています')
    expect(failed).toContain('開発者が確認してから回答します')
    // AI 結果が無い(本番教室・要望/不具合)ときは従来と同一の文。
    expect(formatDeveloperReportResultMessage({ ok: true, reportId: 'r3' })).toBe('開発者へ送りました（受付番号 r3）。ありがとうございます。')
    expect(formatDeveloperReportResultMessage({ ok: true, reportId: 'r4', isTest: true, aiAnswer: 'x' })).toContain('テストとして受け付けました')
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
