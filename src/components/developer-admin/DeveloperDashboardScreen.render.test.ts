// 開発ダッシュボードの描画スモーク(react-dom/server・2026-09-25、2026-09-28 未対応面を既定に)。
// 描画テスト環境(jsdom)は入れていないので、サーバー描画で「例外なく描け、要求された欄と確認リストの項目が出る」ことだけを見る
// (effect は走らないので取得は呼ばれない = 読み込み中の初期表示)。集計の中身は developerDashboard.test.ts /
// developerDashboardActions.test.ts で固定。

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeveloperDashboardScreen, type DeveloperDashboardScreenProps } from './DeveloperDashboardScreen'
import { VERIFICATION_CHECKLIST } from '../../utils/verificationChecklist'
import { DEVELOPMENT_STATUS_LEDGER } from '../../utils/developmentStatusLedger'
import { CLAUDE_CODE_NEW_SESSION_URL } from '../../utils/developerDashboardActions'
import { FEATURE_SCOPE_LABELS } from '../../utils/developerDashboard'
import { featureRolloutRegistry } from '../../utils/featureRollout'

const FIREBASE_PROPS: DeveloperDashboardScreenProps = {
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
}

describe('DeveloperDashboardScreen の描画', () => {
  it('既定は【未対応】面: 1 行 1 件の表・番の数・台帳の全テーマ(待ち以外)・Claude Code へ投げる導線が出て、5 欄の全量は出ない', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, FIREBASE_PROPS))
    expect(html).toContain('id="dashboard-todo"')
    expect(html).toContain('未対応 ')
    expect(html).toContain('Claude の番')
    expect(html).toContain('オーナーの番')
    expect(html).toContain('data-testid="developer-dashboard-view-toggle"')
    expect(html).toContain('詳細を見る')
    expect(html).toContain('data-testid="developer-dashboard-launch"')
    expect(html).toContain('Claude Code で開く')
    expect(html).toContain('→Claude')
    // 1 件ずつの「→Claude」は公式の入力済み URL(claude.ai/code?…prompt=…)。
    expect(html).toContain(`href="${CLAUDE_CODE_NEW_SESSION_URL}?repositories=Kake-git-hub%2FKomahyouApp&amp;prompt=`)
    // 台帳のうち待ち(確認リスト結果待ち・保留)以外は行として出る。待ちは畳まれて件数だけ。
    for (const entry of DEVELOPMENT_STATUS_LEDGER) {
      if (entry.stage === 'awaiting-checklist' || entry.stage === 'on-hold') expect(html, entry.id).not.toContain(`data-action-id="ledger-${entry.id}"`)
      else expect(html, entry.id).toContain(`data-action-id="ledger-${entry.id}"`)
    }
    expect(html).toContain('件(結果待ち・自動処理待ち・保留)')
    // 読み込み中の注記。
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('GitHub Issue を読み込んでいます')
    // 5 欄の全量(詳細面)は出ない = 一画面に収める。
    for (const id of ['dashboard-reports', 'dashboard-features', 'dashboard-ledger', 'dashboard-issues', 'dashboard-checklist']) {
      expect(html, id).not.toContain(`id="${id}"`)
    }
  })

  it('【詳細】面では従来の 5 つの欄・確認リストの全項目・台帳の全テーマ・機能フラグを描く(内容は据え置き)', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, { ...FIREBASE_PROPS, initialView: 'detail' }))
    for (const id of ['dashboard-reports', 'dashboard-features', 'dashboard-ledger', 'dashboard-issues', 'dashboard-checklist']) {
      expect(html, id).toContain(`id="${id}"`)
    }
    expect(html).toContain('未対応に戻る')
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('GitHub Issue を読み込んでいます')
    // 教室一覧の行(報告 0 件でも出る)と検証用教室の札。
    expect(html).toContain('スクールIE 緑が丘校')
    expect(html).toContain('検証用')
    for (const item of VERIFICATION_CHECKLIST.items) expect(html, item.id).toContain(`<code>${item.id}</code>`)
    for (const entry of DEVELOPMENT_STATUS_LEDGER) expect(html, entry.id).toContain(entry.title)
    // 機能フラグの段階: レジストリの全キーと、その scope の札が出る(今のフラグ状態に依存しない)。
    for (const [key, feature] of Object.entries(featureRolloutRegistry)) {
      expect(html, key).toContain(`<code>${key}</code>`)
      expect(html, key).toContain(FEATURE_SCOPE_LABELS[feature.scope])
    }
  })

  it('ローカルモードでは報告を読まず、その旨を出す(未対応面・詳細面とも)', () => {
    const localProps: DeveloperDashboardScreenProps = { ...FIREBASE_PROPS, authMode: 'local', workspaceKey: '', appVersion: '0.0.0', classrooms: [] }
    const todo = renderToString(createElement(DeveloperDashboardScreen, localProps))
    expect(todo).toContain('ローカルモードでは報告を読み込めません')
    expect(todo).not.toContain('報告を読み込んでいます')
    const detail = renderToString(createElement(DeveloperDashboardScreen, { ...localProps, initialView: 'detail' }))
    expect(detail).toContain('ローカルモードでは報告を読み込めません')
    expect(detail).not.toContain('報告を読み込んでいます')
  })
})
