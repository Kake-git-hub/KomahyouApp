import { describe, expect, it } from 'vitest'

import {
  countUnreadReportAnswers,
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
  ...overrides,
})

describe('reportAnswers(室長側): 文書の読み取り', () => {
  it('必要な項目だけを読み、要約が無ければ本文から作る。壊れた文書は null', () => {
    const entry = parseReportAnswerEntry('r1', { classroomId: 'C1', category: 'question', source: 'board', questionNote: 'a  b\nc', reportedAt: 'x', answer: '回答', answeredAt: 'y', answerRevision: 2, readAt: null })
    expect(entry).toEqual({ id: 'r1', classroomId: 'C1', category: 'question', source: 'board', questionNote: 'a  b\nc', questionSummary: 'a b c', reportedAt: 'x', answer: '回答', answeredAt: 'y', answerRevision: 2, readAt: null })
    expect(parseReportAnswerEntry('r1', { classroomId: 'C1' })).toBeNull()
    expect(parseReportAnswerEntry('r1', { questionNote: 'a' })).toBeNull()
    expect(parseReportAnswerEntry('', { classroomId: 'C1', questionNote: 'a' })).toBeNull()
    expect(parseReportAnswerEntry('r1', null)).toBeNull()
  })

  it('不正な種類は bug・空の回答/既読は null・revision は 0 以上の整数に丸める', () => {
    const entry = parseReportAnswerEntry('r1', { classroomId: 'C1', questionNote: 'a', category: 'weird', answer: '', readAt: '', answerRevision: -3.7 })
    expect(entry).toMatchObject({ category: 'bug', answer: null, readAt: null, answerRevision: 0 })
  })

  it('教室分離(INV-08): 開いている教室の doc だけを通す。教室未選択なら空', () => {
    const entries = [base({ id: 'a', classroomId: 'C1' }), base({ id: 'b', classroomId: 'C2' })]
    expect(selectReportAnswersForClassroom(entries, 'C1').map((e) => e.id)).toEqual(['a'])
    expect(selectReportAnswersForClassroom(entries, null)).toEqual([])
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
