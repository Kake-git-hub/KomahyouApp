import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  countUnreadReportAnswers,
  REPORT_ANSWER_STATUS_LABELS,
  REPORT_ANSWER_UI_TEXT,
  formatReportAnswerBadge,
  formatReportAnswerDateLabel,
  parseReportAnswerEntry,
  resolveDeveloperReportModalInitialTab,
  resolveReportAnswerStatus,
  selectReportAnswersForClassroom,
  selectUnreadReportAnswerIds,
  sortReportAnswerEntries,
  type ReportAnswerEntry,
} from './reportAnswers'

const base = (overrides: Partial<ReportAnswerEntry> = {}): ReportAnswerEntry => ({
  id: 'r1',
  classroomId: 'C1',
  category: 'question',
  source: 'board',
  questionNote: '質問です',
  questionSummary: '質問です',
  reportedAt: '2026-09-27T01:00:00.000Z',
  answer: null,
  answeredAt: null,
  answerRevision: 0,
  readAt: null,
  aiAnswer: null,
  aiAnsweredAt: null,
  ...overrides,
})

describe('reportAnswers(室長側): 文書の読み取り', () => {
  it('必要な項目だけを読み、要約が無ければ本文から作る。壊れた文書は null', () => {
    const entry = parseReportAnswerEntry('r1', { classroomId: 'C1', category: 'question', source: 'board', questionNote: 'a  b\nc', reportedAt: 'x', answer: '回答', answeredAt: 'y', answerRevision: 2, readAt: null, aiAnswer: null, aiAnsweredAt: null })
    expect(entry).toEqual({ id: 'r1', classroomId: 'C1', category: 'question', source: 'board', questionNote: 'a  b\nc', questionSummary: 'a b c', reportedAt: 'x', answer: '回答', answeredAt: 'y', answerRevision: 2, readAt: null, aiAnswer: null, aiAnsweredAt: null })
    expect(parseReportAnswerEntry('r1', { classroomId: 'C1' })).toBeNull()
    expect(parseReportAnswerEntry('r1', { questionNote: 'a' })).toBeNull()
    expect(parseReportAnswerEntry('', { classroomId: 'C1', questionNote: 'a' })).toBeNull()
    expect(parseReportAnswerEntry('r1', null)).toBeNull()
  })

  it('不正な種類は bug・空の回答/既読は null・revision は 0 以上の整数に丸める', () => {
    const entry = parseReportAnswerEntry('r1', { classroomId: 'C1', questionNote: 'a', category: 'weird', answer: '', readAt: '', answerRevision: -3.7 })
    expect(entry).toMatchObject({ category: 'bug', answer: null, readAt: null, answerRevision: 0 })
  })

  it('教室分離(INV-08): 開いている教室の doc だけを通す。教室未選択なら空。他教室の未読はバッジにも数えない', () => {
    const entries = [base({ id: 'a', classroomId: 'C1' }), base({ id: 'b', classroomId: 'C2', answer: 'x', answeredAt: 't' })]
    expect(selectReportAnswersForClassroom(entries, 'C1').map((e) => e.id)).toEqual(['a'])
    expect(selectReportAnswersForClassroom(entries, null)).toEqual([])
    // App の useMemo と同じ組み合わせ(select → count): 他教室の未読 1 件は 0 になる
    expect(countUnreadReportAnswers(selectReportAnswersForClassroom(entries, 'C1'))).toBe(0)
    expect(countUnreadReportAnswers(selectReportAnswersForClassroom(entries, 'C2'))).toBe(1)
  })
})

describe('reportAnswers(室長側): 状態・未読件数・並び', () => {
  it('回答が無い=回答待ち／回答あり・未読／回答あり・既読', () => {
    expect(resolveReportAnswerStatus(base())).toBe('pending')
    expect(resolveReportAnswerStatus(base({ answer: 'x', answeredAt: 't' }))).toBe('unread')
    expect(resolveReportAnswerStatus(base({ answer: 'x', answeredAt: 't', readAt: 'u' }))).toBe('read')
    // 回答本文だけあって日時が無い壊れた doc は回答待ち扱い(未読バッジを出さない)
    expect(resolveReportAnswerStatus(base({ answer: 'x' }))).toBe('pending')
  })

  it('AI の自動回答だけがある=自動回答あり(回答待ちと言わない・未読に数えない)。開発者が回答すると未読/既読は従来どおり(オーナー指示 2026-10-22 qa-ai-1)', () => {
    const aiOnly = base({ aiAnswer: 'AI の回答', aiAnsweredAt: 't0' })
    expect(resolveReportAnswerStatus(aiOnly)).toBe('ai-answered')
    expect(REPORT_ANSWER_STATUS_LABELS['ai-answered']).toBe('自動回答あり')
    expect(countUnreadReportAnswers([aiOnly])).toBe(0)
    expect(resolveDeveloperReportModalInitialTab(countUnreadReportAnswers([aiOnly]))).toBe('send')
    expect(resolveReportAnswerStatus(base({ aiAnswer: 'AI の回答', aiAnsweredAt: 't0', answer: '訂正', answeredAt: 't1' }))).toBe('unread')
    expect(resolveReportAnswerStatus(base({ aiAnswer: 'AI の回答', aiAnsweredAt: 't0', answer: '訂正', answeredAt: 't1', readAt: 't2' }))).toBe('read')
    // 文書の読み取り: aiAnswer / aiAnsweredAt を読む。無ければ null。
    expect(parseReportAnswerEntry('r1', { classroomId: 'C1', questionNote: 'q', aiAnswer: 'AI', aiAnsweredAt: 't0' })).toMatchObject({ aiAnswer: 'AI', aiAnsweredAt: 't0' })
    expect(parseReportAnswerEntry('r1', { classroomId: 'C1', questionNote: 'q' })).toMatchObject({ aiAnswer: null, aiAnsweredAt: null })
    // 画面の見出し: AI の回答は「自動回答」、その後の開発者の回答は「訂正・補足」。回答待ちの一文は開発者の回答も AI の回答も無いときだけ。
    expect(REPORT_ANSWER_UI_TEXT.aiAnswerHead).toBe('自動回答（試験中・誤りがあることがあります）')
    expect(REPORT_ANSWER_UI_TEXT.developerAnswerAfterAiHead).toBe('開発者からの回答（訂正・補足）')
    const modal = readFileSync(new URL('../components/developer-report/DeveloperReportModal.tsx', import.meta.url), 'utf8')
    expect(modal).toContain('data-testid="developer-report-history-ai-answer"')
    expect(modal).toContain("{entry.aiAnswer ? REPORT_ANSWER_UI_TEXT.developerAnswerAfterAiHead : REPORT_ANSWER_UI_TEXT.developerAnswerHead}")
    // 回答待ちの一文は status が pending のときだけ(自動回答ありでは出さない)。
    expect(modal).toMatch(/status === 'pending' \? \(\s*<p className="developer-report-history-pending">\{REPORT_ANSWER_UI_TEXT\.pendingNote\}<\/p>/u)
  })

  it('バッジの件数は未読の回答だけを数える(回答待ち・既読は数えない)', () => {
    const entries = [
      base({ id: 'p' }),
      base({ id: 'u1', answer: 'x', answeredAt: 't' }),
      base({ id: 'u2', answer: 'x', answeredAt: 't' }),
      base({ id: 'r', answer: 'x', answeredAt: 't', readAt: 'u' }),
    ]
    expect(countUnreadReportAnswers(entries)).toBe(2)
    expect(selectUnreadReportAnswerIds(entries)).toEqual(['u1', 'u2'])
  })

  it('新しいものが上。回答が付いた質問は回答日時で並ぶ(送信が古くても上に来る)', () => {
    const entries = [
      base({ id: 'old-pending', reportedAt: '2026-09-20T00:00:00.000Z' }),
      base({ id: 'new-pending', reportedAt: '2026-09-28T00:00:00.000Z' }),
      base({ id: 'old-answered', reportedAt: '2026-09-10T00:00:00.000Z', answer: 'x', answeredAt: '2026-09-29T00:00:00.000Z' }),
    ]
    expect(sortReportAnswerEntries(entries).map((e) => e.id)).toEqual(['old-answered', 'new-pending', 'old-pending'])
    // 入力配列は変えない
    expect(entries[0].id).toBe('old-pending')
  })

  it('モーダルの最初のタブ: 未読があれば履歴、無ければ送信フォーム(自動で開くモーダルは出さない・オーナー確定 2026-09-28)', () => {
    expect(resolveDeveloperReportModalInitialTab(0)).toBe('send')
    expect(resolveDeveloperReportModalInitialTab(1)).toBe('history')
  })

  it('バッジ文字列: 0 以下は出さない・100 以上は 99+', () => {
    expect(formatReportAnswerBadge(0)).toBeNull()
    expect(formatReportAnswerBadge(-1)).toBeNull()
    expect(formatReportAnswerBadge(3)).toBe('3')
    expect(formatReportAnswerBadge(120)).toBe('99+')
  })

  it('日時は JST の「年/月/日 時:分」。不正・空は空文字', () => {
    expect(formatReportAnswerDateLabel('2026-09-28T00:05:00.000Z')).toBe('2026/9/28 9:05')
    expect(formatReportAnswerDateLabel('bad')).toBe('')
    expect(formatReportAnswerDateLabel(null)).toBe('')
  })
})
