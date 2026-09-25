// 開発ダッシュボードの描画スモーク(react-dom/server・2026-09-25)。
// 描画テスト環境(jsdom)は入れていないので、サーバー描画で「例外なく描け、要求された欄と確認リストの項目が出る」ことだけを見る
// (effect は走らないので取得は呼ばれない = 読み込み中の初期表示)。集計の中身は developerDashboard.test.ts で固定。

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeveloperDashboardScreen } from './DeveloperDashboardScreen'
import { VERIFICATION_CHECKLIST } from '../../utils/verificationChecklist'
import { DEVELOPMENT_STATUS_LEDGER } from '../../utils/developmentStatusLedger'

describe('DeveloperDashboardScreen の描画', () => {
  it('Firebase モードで 5 つの欄・確認リストの全項目・台帳の全テーマを描く(取得前は読み込み中)', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, {
      authMode: 'firebase',
      workspaceKey: 'main',
      appVersion: '1.5.557',
      classrooms: [
        { id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室', contractStatus: 'active' },
        { id: 'KzFnOQoTFLsCxwUp1tvh', name: 'スクールIE 緑が丘校', contractStatus: 'active' },
      ],
      onBack: () => {},
      loadReports: async () => [],
      loadIssues: async () => [],
    }))
    for (const id of ['dashboard-reports', 'dashboard-features', 'dashboard-ledger', 'dashboard-issues', 'dashboard-checklist']) {
      expect(html, id).toContain(`id="${id}"`)
    }
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('GitHub Issue を読み込んでいます')
    // 教室一覧の行(報告 0 件でも出る)と検証用教室の札。
    expect(html).toContain('スクールIE 緑が丘校')
    expect(html).toContain('検証用')
    for (const item of VERIFICATION_CHECKLIST.items) expect(html, item.id).toContain(`<code>${item.id}</code>`)
    for (const entry of DEVELOPMENT_STATUS_LEDGER) expect(html, entry.id).toContain(entry.title)
    // 機能フラグの段階(全教室に出ていないものの札)。
    expect(html).toContain('開発用教室のみ')
    expect(html).toContain('transferSourceRestDisplay')
  })

  it('ローカルモードでは報告を読まず、その旨を出す', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, {
      authMode: 'local',
      workspaceKey: '',
      appVersion: '0.0.0',
      classrooms: [],
      onBack: () => {},
      loadReports: async () => [],
      loadIssues: async () => [],
    }))
    expect(html).toContain('ローカルモードでは報告を読み込めません')
    expect(html).not.toContain('報告を読み込んでいます')
  })
})
