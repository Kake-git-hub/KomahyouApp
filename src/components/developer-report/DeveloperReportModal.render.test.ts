// 「質問・要望」モーダルの描画スモーク(react-dom/server・2026-09-28)。履歴タブ(§G-5)の出し分けを固定する。
// 描画テスト環境(jsdom)は入れていないので、サーバー描画で「例外なく描け、要素の有無が正しい」ことだけを見る。

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeveloperReportModal } from './DeveloperReportModal'
import type { ReportAnswerEntry } from '../../utils/reportAnswers'

const entry = (overrides: Partial<ReportAnswerEntry> = {}): ReportAnswerEntry => ({
  id: 'r1',
  classroomId: 'C1',
  category: 'question',
  source: 'board',
  questionNote: '振替先を後から変えるには？',
  questionSummary: '振替先を後から変えるには？',
  reportedAt: '2026-09-27T01:00:00.000Z',
  answer: null,
  answeredAt: null,
  answerRevision: 0,
  readAt: null,
  ...overrides,
})

const baseProps = { classroomName: '教室1', sending: false, resultMessage: null, onSubmit: () => {}, onClose: () => {} }

describe('DeveloperReportModal の描画(履歴タブ)', () => {
  it('answers を渡さない(ローカルモード)ときは従来どおりタブ無しの送信フォーム', () => {
    const html = renderToString(createElement(DeveloperReportModal, baseProps))
    expect(html).not.toContain('data-testid="developer-report-tabs"')
    expect(html).toContain('data-testid="developer-report-note"')
  })

  it('未読の回答が無ければ送信フォームから開き、履歴タブにバッジは付かない', () => {
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers: [entry()], canMarkAnswersRead: true, onMarkAnswersRead: () => {} }))
    expect(html).toContain('data-testid="developer-report-tabs"')
    expect(html).toContain('data-testid="developer-report-note"')
    expect(html).not.toContain('data-testid="developer-report-tab-badge"')
  })

  it('未読の回答があれば履歴タブから開き、回答本文と「確認しました」を出す(回答待ちの質問は「回答待ち」)', () => {
    const answers = [
      entry({ id: 'pending' }),
      entry({ id: 'unread', questionNote: '講師の出勤表はどこ？', answer: '講師日程表の右上から出せます。', answeredAt: '2026-09-28T02:00:00.000Z', answerRevision: 1 }),
      entry({ id: 'read', questionNote: '既読の質問', answer: '既読の回答', answeredAt: '2026-09-26T02:00:00.000Z', answerRevision: 2, readAt: '2026-09-26T03:00:00.000Z' }),
    ]
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers, canMarkAnswersRead: true, onMarkAnswersRead: () => {} }))
    expect(html).toContain('data-testid="developer-report-tab-badge"')
    expect(html).toContain('data-testid="developer-report-history-list"')
    expect(html).not.toContain('data-testid="developer-report-note"')
    expect(html).toContain('講師日程表の右上から出せます。')
    expect(html).toContain('data-testid="developer-report-mark-read"')
    expect(html).toContain('回答待ち')
    expect(html).toContain('新しい回答')
    expect(html).toContain('回答済み')
    expect(html).toContain('(回答が更新されました)')
    // 未読は 1 件なので「すべて確認しました」は出ない
    expect(html).not.toContain('data-testid="developer-report-mark-all-read"')
    // 新しいものが上: 回答日時 9/28 の unread → 送信 9/27 の pending → 回答 9/26 の read
    expect(html.indexOf('講師の出勤表はどこ？')).toBeLessThan(html.indexOf('振替先を後から変えるには？'))
    expect(html.indexOf('振替先を後から変えるには？')).toBeLessThan(html.indexOf('既読の質問'))
  })

  it('開発者が本番教室を開いている(canMarkAnswersRead=false)ときは「確認しました」を出さない(室長の未読を消さない)', () => {
    const answers = [
      entry({ id: 'u1', answer: 'a', answeredAt: '2026-09-28T02:00:00.000Z', answerRevision: 1 }),
      entry({ id: 'u2', answer: 'b', answeredAt: '2026-09-28T03:00:00.000Z', answerRevision: 1 }),
    ]
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers, canMarkAnswersRead: false, onMarkAnswersRead: () => {} }))
    expect(html).toContain('data-testid="developer-report-history-list"')
    expect(html).not.toContain('data-testid="developer-report-mark-read"')
    expect(html).not.toContain('data-testid="developer-report-mark-all-read"')
    const withPermission = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers, canMarkAnswersRead: true, onMarkAnswersRead: () => {} }))
    expect(withPermission).toContain('data-testid="developer-report-mark-all-read"')
  })

  it('履歴が空なら案内文(これから送るものが載る)', () => {
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers: [], canMarkAnswersRead: true, onMarkAnswersRead: () => {} }))
    // 未読 0 なので送信タブから開く。履歴タブは存在する。
    expect(html).toContain('data-testid="developer-report-tab-history"')
  })
})
