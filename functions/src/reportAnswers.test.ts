import { describe, expect, it } from 'vitest'

import {
  buildPendingReportAnswerDoc,
  normalizeAnswerDeveloperReportRequest,
  normalizeMarkReportAnswersReadRequest,
  planReportAnswerWrite,
  REPORT_ANSWER_ERROR_EMPTY,
  REPORT_ANSWER_ERROR_TOO_LONG,
  REPORT_ANSWER_LIMIT,
  resolveReportAnswerReadWrites,
  shouldCreateReportAnswerDoc,
  summarizeReportQuestion,
} from './reportAnswers'

const report = {
  reportId: 'r-2026-09-28-abc',
  classroomId: 'C1',
  category: 'question',
  source: 'board',
  note: '休みにした生徒の振替先を後から変えるには？\n2 行目',
  reportedAt: '2026-09-28T01:00:00.000Z',
  recordedAt: '2026-09-28T01:00:05.000Z',
}

describe('reportAnswers: 送信時の「回答待ち」文書(docs/spec-developer-report.md §G-5)', () => {
  it('テスト送信と確認リストは室長側の文書を作らない', () => {
    expect(shouldCreateReportAnswerDoc({ isTest: false, isVerificationChecklist: false })).toBe(true)
    expect(shouldCreateReportAnswerDoc({ isTest: true })).toBe(false)
    expect(shouldCreateReportAnswerDoc({ isVerificationChecklist: true })).toBe(false)
  })

  it('回答待ちの文書は本文・要約・種類・教室だけを持ち、教室データ・操作痕跡・送信者は含まない', () => {
    const doc = buildPendingReportAnswerDoc(report, '2026-09-28T01:00:06.000Z')
    expect(doc).toEqual({
      reportId: 'r-2026-09-28-abc',
      classroomId: 'C1',
      category: 'question',
      source: 'board',
      questionNote: report.note,
      questionSummary: '休みにした生徒の振替先を後から変えるには？ 2 行目',
      reportedAt: '2026-09-28T01:00:00.000Z',
      answer: null,
      answeredAt: null,
      answerRevision: 0,
      readAt: null,
      unreadAnswer: false,
      updatedAt: '2026-09-28T01:00:06.000Z',
    })
    expect(Object.keys(doc)).not.toContain('recentOperations')
    expect(Object.keys(doc)).not.toContain('reportedBy')
    expect(Object.keys(doc)).not.toContain('reporterEmail')
  })

  it('要約は空白を 1 つに詰め、上限を超えたら末尾に「…」', () => {
    expect(summarizeReportQuestion('  a \n b  ')).toBe('a b')
    expect(summarizeReportQuestion('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
    expect(summarizeReportQuestion('x'.repeat(10), 10)).toBe('x'.repeat(10))
  })

  it('不正な種類は bug に丸める(サーバーの正規化と同じ既定)', () => {
    expect(buildPendingReportAnswerDoc({ ...report, category: 'weird' }, '2026-09-28T01:00:06.000Z').category).toBe('bug')
  })
})

describe('reportAnswers: callable answerDeveloperReport の入力検証(§I-4)', () => {
  it('本文が空なら拒否・上限超えも拒否・改行は LF に正規化して前後の空白を落とす', () => {
    expect(normalizeAnswerDeveloperReportRequest({ workspaceKey: 'main', reportId: 'r1', answer: '   ' })).toEqual({ ok: false, reason: REPORT_ANSWER_ERROR_EMPTY })
    expect(normalizeAnswerDeveloperReportRequest({ workspaceKey: 'main', reportId: 'r1', answer: 'x'.repeat(REPORT_ANSWER_LIMIT + 1) })).toEqual({ ok: false, reason: REPORT_ANSWER_ERROR_TOO_LONG })
    expect(normalizeAnswerDeveloperReportRequest({ workspaceKey: 'main', reportId: 'r1', answer: ' 1 行目\r\n2 行目 ' })).toEqual({ ok: true, value: { workspaceKey: 'main', reportId: 'r1', answer: '1 行目\n2 行目' } })
  })

  it('workspaceKey / reportId が無い・形式が変なら拒否', () => {
    expect(normalizeAnswerDeveloperReportRequest(null).ok).toBe(false)
    expect(normalizeAnswerDeveloperReportRequest({ reportId: 'r1', answer: 'a' }).ok).toBe(false)
    expect(normalizeAnswerDeveloperReportRequest({ workspaceKey: 'main', reportId: '../x', answer: 'a' }).ok).toBe(false)
  })
})

describe('reportAnswers: 回答の書き込み計画(状態遷移は一方向・改訂は既読を戻さない・§G-3)', () => {
  it('初回回答: developerReports には回答フィールドだけ merge・室長側文書は未読の回答済みになる', () => {
    const plan = planReportAnswerWrite({
      report,
      existingAnswerDoc: buildPendingReportAnswerDoc(report, '2026-09-28T01:00:06.000Z'),
      answer: '基本データの生徒詳細から変更できます。',
      answeredBy: 'dev-uid',
      nowIso: '2026-09-28T09:00:00.000Z',
    })
    expect(plan.isRevision).toBe(false)
    expect(plan.reportUpdate).toEqual({ answerFinal: '基本データの生徒詳細から変更できます。', answeredAt: '2026-09-28T09:00:00.000Z', answeredBy: 'dev-uid', answerRevision: 1 })
    expect(plan.answerDoc.answer).toBe('基本データの生徒詳細から変更できます。')
    expect(plan.answerDoc.answeredAt).toBe('2026-09-28T09:00:00.000Z')
    expect(plan.answerDoc.answerRevision).toBe(1)
    expect(plan.answerDoc.readAt).toBeNull()
    expect(plan.answerDoc.unreadAnswer).toBe(true)
    // 質問文・教室・送信元は据え置き
    expect(plan.answerDoc.questionNote).toBe(report.note)
    expect(plan.answerDoc.classroomId).toBe('C1')
    expect(plan.answerDoc.source).toBe('board')
  })

  it('室長側文書が無い(旧報告)ときは計画の中で作る', () => {
    const plan = planReportAnswerWrite({ report, existingAnswerDoc: null, answer: '回答', answeredBy: 'dev-uid', nowIso: '2026-09-28T09:00:00.000Z' })
    expect(plan.answerDoc.reportId).toBe(report.reportId)
    expect(plan.answerDoc.unreadAnswer).toBe(true)
    expect(plan.answerDoc.reportedAt).toBe('2026-09-28T01:00:00.000Z')
  })

  it('改訂(2 回目以降): revision +1・既読済みなら既読のまま(未読に戻さない)・未読なら未読のまま', () => {
    const answered = { ...buildPendingReportAnswerDoc(report, 'x'), answer: '旧', answeredAt: '2026-09-28T09:00:00.000Z', answerRevision: 1, readAt: '2026-09-28T10:00:00.000Z', unreadAnswer: false }
    const revised = planReportAnswerWrite({ report: { ...report, answerRevision: 1 }, existingAnswerDoc: answered, answer: '新', answeredBy: 'dev-uid', nowIso: '2026-09-28T11:00:00.000Z' })
    expect(revised.isRevision).toBe(true)
    expect(revised.reportUpdate.answerRevision).toBe(2)
    expect(revised.answerDoc.answer).toBe('新')
    expect(revised.answerDoc.readAt).toBe('2026-09-28T10:00:00.000Z')
    expect(revised.answerDoc.unreadAnswer).toBe(false)

    const stillUnread = planReportAnswerWrite({ report: { ...report, answerRevision: 1 }, existingAnswerDoc: { ...answered, readAt: null, unreadAnswer: true }, answer: '新', answeredBy: 'dev-uid', nowIso: '2026-09-28T11:00:00.000Z' })
    expect(stillUnread.answerDoc.readAt).toBeNull()
    expect(stillUnread.answerDoc.unreadAnswer).toBe(true)
  })

  it('developerReports 側の既存フィールドは計画に含まれない(note / recentOperations 等を上書きしない)', () => {
    const plan = planReportAnswerWrite({ report, existingAnswerDoc: null, answer: '回答', answeredBy: 'dev-uid', nowIso: '2026-09-28T09:00:00.000Z' })
    expect(Object.keys(plan.reportUpdate).sort()).toEqual(['answerFinal', 'answerRevision', 'answeredAt', 'answeredBy'])
  })
})

describe('reportAnswers: 既読化(callable markReportAnswersRead・部分更新・§I-5)', () => {
  it('入力検証: 教室 ID 必須・reportIds は重複除去し形式の合わないものを落とす・0 件は拒否', () => {
    expect(normalizeMarkReportAnswersReadRequest({ workspaceKey: 'main', classroomId: 'C1', reportIds: ['a', 'a', ' b ', '../x', 3] })).toEqual({ ok: true, value: { workspaceKey: 'main', classroomId: 'C1', reportIds: ['a', 'b'] } })
    expect(normalizeMarkReportAnswersReadRequest({ workspaceKey: 'main', classroomId: '', reportIds: ['a'] }).ok).toBe(false)
    expect(normalizeMarkReportAnswersReadRequest({ workspaceKey: 'main', classroomId: 'C1', reportIds: [] }).ok).toBe(false)
    expect(normalizeMarkReportAnswersReadRequest({ workspaceKey: 'main', classroomId: 'C1', reportIds: 'a' }).ok).toBe(false)
  })

  it('既読にするのは「存在し・自教室で・回答があり・未読」の文書だけ。更新は readAt / unreadAnswer / updatedAt のみ', () => {
    const writes = resolveReportAnswerReadWrites([
      { id: 'unread', exists: true, classroomId: 'C1', answeredAt: '2026-09-28T09:00:00.000Z', readAt: null },
      { id: 'already-read', exists: true, classroomId: 'C1', answeredAt: '2026-09-28T09:00:00.000Z', readAt: '2026-09-28T10:00:00.000Z' },
      { id: 'pending', exists: true, classroomId: 'C1', answeredAt: null, readAt: null },
      { id: 'other-classroom', exists: true, classroomId: 'C2', answeredAt: '2026-09-28T09:00:00.000Z', readAt: null },
      { id: 'missing', exists: false },
    ], { classroomId: 'C1', nowIso: '2026-09-28T12:00:00.000Z' })
    expect(writes).toEqual([{ id: 'unread', update: { readAt: '2026-09-28T12:00:00.000Z', unreadAnswer: false, updatedAt: '2026-09-28T12:00:00.000Z' } }])
  })
})
