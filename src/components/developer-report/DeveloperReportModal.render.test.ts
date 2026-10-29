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
  aiAnswer: null,
  aiAnsweredAt: null,
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

  it('AI の自動回答は開発者の回答が無くても黄色の枠で出し「回答待ち」とは言わない。開発者が回答すると「訂正・補足」として下に並ぶ(オーナー指示 2026-10-22 qa-ai-1)', () => {
    const answers = [
      entry({ id: 'ai-only', questionNote: '体験の追加方法は？', aiAnswer: '席をクリックして「体験授業」を選びます。', aiAnsweredAt: '2026-10-22T15:43:37.300Z' }),
      entry({ id: 'ai-then-dev', questionNote: '成績の記録は？', aiAnswer: 'この点は開発者より別途回答いたします。', aiAnsweredAt: '2026-10-22T15:46:50.535Z', answer: '成績の記録機能はありません。', answeredAt: '2026-10-22T16:00:00.000Z', answerRevision: 1 }),
    ]
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, answers, canMarkAnswersRead: true, onMarkAnswersRead: () => {} }))
    // 開いた直後は未読 1 件(開発者の回答)なので履歴タブ。AI だけの質問は未読に数えないのでバッジは 1。
    expect(html).toContain('data-testid="developer-report-history-ai-answer"')
    expect(html).toContain('席をクリックして「体験授業」を選びます。')
    expect(html).toContain('自動回答あり')
    expect(html).toContain('自動回答（試験中・誤りがあることがあります）')
    expect(html).not.toContain('回答待ち')
    expect(html).not.toContain('developer-report-history-pending')
    expect(html).toContain('開発者からの回答（訂正・補足）')
    expect(html).toContain('成績の記録機能はありません。')
    expect((html.match(/data-testid="developer-report-mark-read"/gu) ?? []).length).toBe(1)
    // 同じ質問の中では AI の回答が上、開発者の回答が下。
    expect(html.indexOf('この点は開発者より別途回答いたします。')).toBeLessThan(html.indexOf('成績の記録機能はありません。'))
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

describe('DeveloperReportModal の描画(添付画像・2026-10-22 オーナー決定 A)', () => {
  it('撮る関数を渡すと「画面を撮る」と「画像を選ぶ」の両方と盤面向けの案内を描く', () => {
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, onCaptureScreen: async () => ({ name: 'x', dataUrl: 'data:image/jpeg;base64,AAAA' }) }))
    expect(html).toContain('data-testid="developer-report-attachments"')
    expect(html).toContain('data-testid="developer-report-capture"')
    expect(html).toContain('>画面を撮る<')
    expect(html).toContain('data-testid="developer-report-attach-input"')
    expect(html).toContain('画像を選ぶ')
    expect(html).toContain('画像（任意・3 枚まで）')
    expect(html).toContain('いまのコマ表の画面がそのまま付きます')
    // 画像が無ければ一覧の器は描かない(空の枠を出さない)。
    expect(html).not.toContain('data-testid="developer-report-attachment"')
  })

  it('撮る関数が無ければ「画像を選ぶ」だけと、スクリーンショットを選ぶ案内', () => {
    const html = renderToString(createElement(DeveloperReportModal, baseProps))
    expect(html).not.toContain('data-testid="developer-report-capture"')
    expect(html).toContain('data-testid="developer-report-attach-input"')
    expect(html).toContain('スクリーンショットを撮って「画像を選ぶ」から付けられます')
  })
})

describe('DeveloperReportModal の描画(別タブ・2026-10-29 オーナー指示「AI 回答を見ながら画面操作する可能性があるので別タブで」)', () => {
  it('既定(盤面のモーダル)は覆いつきのダイアログで、別タブ向けの一言は出さない', () => {
    const html = renderToString(createElement(DeveloperReportModal, baseProps))
    expect(html).toContain('class="auto-assign-modal-overlay"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-presentation="modal"')
    expect(html).not.toContain('data-testid="developer-report-window-hint"')
    expect(html).not.toContain('data-testid="developer-report-window-blocked"')
  })

  it('別タブ(presentation="window")は覆いを付けずページとして描き、元の画面に戻って操作できる一言を出す', () => {
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, presentation: 'window' as const }))
    expect(html).not.toContain('auto-assign-modal-overlay')
    expect(html).toContain('data-testid="developer-report-window-page"')
    expect(html).toContain('developer-report-modal is-window')
    expect(html).toContain('role="main"')
    expect(html).not.toContain('aria-modal')
    expect(html).toContain('このタブを開いたまま、元の画面のタブに戻って操作できます。')
    // 中身(種類・内容・送信)は盤面のモーダルと同じ。
    expect(html).toContain('data-testid="developer-report-note"')
    expect(html).toContain('data-testid="developer-report-submit"')
  })

  it('別タブを開けずモーダルで開いたときだけ、ポップアップの許可を確かめる一言を出す', () => {
    const html = renderToString(createElement(DeveloperReportModal, { ...baseProps, windowBlocked: true }))
    expect(html).toContain('data-testid="developer-report-window-blocked"')
    expect(html).toContain('ブラウザのポップアップの許可を確認してください')
  })
})
