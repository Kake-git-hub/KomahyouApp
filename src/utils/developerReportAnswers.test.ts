import { describe, expect, it } from 'vitest'

import type { DeveloperReportRecord } from './developerDashboard'
import {
  buildReportAnswerSentMessage,
  checkReportAnswerSubmit,
  DEVELOPER_REPORT_ANSWER_LIMIT,
  filterReportsForAnswering,
  isReportAnswered,
  REPORT_ANSWER_GUIDELINES,
  REPORT_ANSWER_SUBMIT_ERRORS,
  selectAnswerableReports,
} from './developerReportAnswers'

const record = (overrides: Partial<DeveloperReportRecord> = {}): DeveloperReportRecord => ({
  reportId: 'r',
  classroomId: 'C1',
  classroomName: '教室1',
  source: 'board',
  category: 'question',
  isTest: false,
  isVerificationChecklist: false,
  note: 'q',
  reportedAt: '2026-09-27T00:00:00.000Z',
  recordedAt: '2026-09-27T00:00:01.000Z',
  appVersion: '1.5.562',
  reporterRole: 'manager',
  notifiedAt: null,
  notifySkipped: null,
  issueNumber: null,
  issueUrl: '',
  hasAiAnswer: false,
  aiAnswerError: '',
  mailSentAt: null,
  mailError: '',
  answerFinal: '',
  answeredAt: null,
  answerRevision: 0,
  ...overrides,
})

describe('developerReportAnswers: 一覧', () => {
  it('テスト送信と確認リストは回答対象から外す', () => {
    const list = selectAnswerableReports([record({ reportId: 'a' }), record({ reportId: 't', isTest: true }), record({ reportId: 'c', isVerificationChecklist: true })])
    expect(list.map((r) => r.reportId)).toEqual(['a'])
  })

  it('未回答/回答済み/すべて の絞り込みと教室での絞り込み・新しい順', () => {
    const records = [
      record({ reportId: 'old', recordedAt: '2026-09-20T00:00:00.000Z' }),
      record({ reportId: 'answered', recordedAt: '2026-09-25T00:00:00.000Z', answerFinal: 'a', answeredAt: '2026-09-26T00:00:00.000Z', answerRevision: 1 }),
      record({ reportId: 'new', recordedAt: '2026-09-28T00:00:00.000Z' }),
      record({ reportId: 'other', classroomId: 'C2', recordedAt: '2026-09-29T00:00:00.000Z' }),
    ]
    expect(filterReportsForAnswering(records, { filter: 'unanswered' }).map((r) => r.reportId)).toEqual(['other', 'new', 'old'])
    expect(filterReportsForAnswering(records, { filter: 'answered' }).map((r) => r.reportId)).toEqual(['answered'])
    expect(filterReportsForAnswering(records, { filter: 'all', classroomId: 'C1' }).map((r) => r.reportId)).toEqual(['new', 'answered', 'old'])
    expect(isReportAnswered(record({ answerFinal: 'a' }))).toBe(false)
    expect(isReportAnswered(record({ answerFinal: 'a', answeredAt: 't' }))).toBe(true)
  })
})

describe('developerReportAnswers: 送信可否(§I-4: 基準のチェックを満たさないと押せない)', () => {
  it('空・上限超え・基準未確認・同じ本文は止める。通れば整形済みの本文を返す', () => {
    expect(checkReportAnswerSubmit({ answer: '  ', guidelinesConfirmed: true })).toEqual({ ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.empty })
    expect(checkReportAnswerSubmit({ answer: 'x'.repeat(DEVELOPER_REPORT_ANSWER_LIMIT + 1), guidelinesConfirmed: true })).toEqual({ ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.tooLong })
    expect(checkReportAnswerSubmit({ answer: '回答', guidelinesConfirmed: false })).toEqual({ ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.unconfirmed })
    expect(checkReportAnswerSubmit({ answer: '回答 ', guidelinesConfirmed: true, currentAnswer: '回答' })).toEqual({ ok: false, reason: REPORT_ANSWER_SUBMIT_ERRORS.unchanged })
    expect(checkReportAnswerSubmit({ answer: ' 1\r\n2 ', guidelinesConfirmed: true, currentAnswer: '旧' })).toEqual({ ok: true, answer: '1\n2' })
  })

  it('基準は §G-4 の 7 項目', () => {
    expect(REPORT_ANSWER_GUIDELINES).toHaveLength(7)
  })

  it('送信後の文言: 初回は未読 1 件・改訂は既読を戻さない旨', () => {
    expect(buildReportAnswerSentMessage({ classroomName: '教室1', isRevision: false, answerRevision: 1 })).toContain('未読 1 件')
    expect(buildReportAnswerSentMessage({ classroomName: '教室1', isRevision: true, answerRevision: 2 })).toContain('未読に戻りません')
  })
})
