// 開発者画面「質問への回答」の描画スモーク(react-dom/server・2026-09-28・spec-developer-report §G-3)。

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeveloperReportAnswerScreen } from './DeveloperReportAnswerScreen'

describe('DeveloperReportAnswerScreen の描画', () => {
  it('Firebase モードでは読み込み中の一覧と、報告を選ぶ前の案内を描く(effect は走らない)', () => {
    const html = renderToString(createElement(DeveloperReportAnswerScreen, {
      authMode: 'firebase',
      classrooms: [{ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' }],
      onBack: () => {},
      loadReports: async () => [],
      submitAnswer: async () => ({ reportId: 'r', classroomId: 'c', answeredAt: '', answerRevision: 1, isRevision: false }),
    }))
    expect(html).toContain('質問への回答')
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('data-testid="report-answer-placeholder"')
    expect(html).toContain('data-testid="report-answer-filter-unanswered"')
    expect(html).toContain('開発用教室')
  })

  it('ローカルモードでは Firebase 接続時のみの案内を出す', () => {
    const html = renderToString(createElement(DeveloperReportAnswerScreen, { authMode: 'local', classrooms: [], onBack: () => {} }))
    expect(html).toContain('ローカルモードでは報告を読み込めません')
  })
})
