// 開発ダッシュボードの描画スモーク(react-dom/server・2026-09-25、2026-09-28 未対応面を既定に、
// 2026-10-30 オーナー指示で【いまの状況】= 3 つの欄のカードへ作り直し)。
// 描画テスト環境(jsdom)は入れていないので、サーバー描画で「例外なく描け、要求された欄と確認リストの項目が出る」ことだけを見る
// (effect は走らないので取得は呼ばれない = 読み込み中の初期表示)。集計の中身は developerDashboard.test.ts /
// developerDashboardActions.test.ts で固定。

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeveloperDashboardScreen, type DeveloperDashboardScreenProps } from './DeveloperDashboardScreen'
import { VERIFICATION_CHECKLIST } from '../../utils/verificationChecklist'
import { DEVELOPMENT_STATUS_LEDGER } from '../../utils/developmentStatusLedger'
import { CLAUDE_CODE_NEW_SESSION_URL, resolveLedgerSection } from '../../utils/developerDashboardActions'
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
  it('既定は【いまの状況】: 3 つの数字のタイルと 3 つの欄、台帳の行が平易な文のカードで出る', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, FIREBASE_PROPS))
    expect(html).toContain('id="dashboard-overview"')
    for (const id of ['dashboard-todo', 'dashboard-trial', 'dashboard-not-built']) expect(html, id).toContain(`id="${id}"`)
    expect(html).toContain('やること')
    expect(html).toContain('開発・テスト教室だけで動いている機能')
    expect(html).toContain('まだ作っていないもの')
    expect(html).toContain('オーナー</span>がやること')
    expect(html).toContain('Claude</span>がやること')
    // 台帳: 確認リスト結果待ちだけの行は出さず、それ以外はカードとして題名・要約・次の一手が出る。
    for (const entry of DEVELOPMENT_STATUS_LEDGER) {
      if (resolveLedgerSection(entry) === null) {
        expect(html, entry.id).not.toContain(`data-card-id="ledger-${entry.id}"`)
        continue
      }
      expect(html, entry.id).toContain(`data-card-id="ledger-${entry.id}"`)
      expect(html, entry.id).toContain(escapeHtml(entry.title))
      expect(html, entry.id).toContain(escapeHtml(entry.summary))
      expect(html, entry.id).toContain(escapeHtml(entry.nextAction))
      // 経緯(notes)は「くわしく」を押すまで出さない。
      if (entry.notes) expect(html, entry.id).not.toContain(escapeHtml(entry.notes))
    }
    expect(html).toContain('くわしく')
    expect(html).toContain('Claude に頼む')
    // 「Claude に頼む」は公式の入力済み URL(claude.ai/code?…prompt=…)。
    expect(html).toContain(`href="${CLAUDE_CODE_NEW_SESSION_URL}?repositories=Kake-git-hub%2FKomahyouApp&amp;prompt=`)
    expect(html).toContain('data-testid="developer-dashboard-view-toggle"')
    expect(html).toContain('報告と Issue の一覧')
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('GitHub Issue を読み込んでいます')
    // 一覧面の欄はこの面には出ない。
    for (const id of ['dashboard-reports', 'dashboard-features', 'dashboard-issues']) expect(html, id).not.toContain(`id="${id}"`)
  })

  it('確認リストとの重複をなくす: 確認リストの項目・要改善の欄・複数選択と指示の編集欄はどちらの面にも出ない(2026-10-30)', () => {
    for (const view of ['overview', 'detail'] as const) {
      const html = renderToString(createElement(DeveloperDashboardScreen, { ...FIREBASE_PROPS, initialView: view }))
      expect(html, view).not.toContain('id="dashboard-checklist"')
      expect(html, view).not.toContain('id="dashboard-ledger"')
      expect(html, view).not.toContain('要改善')
      expect(html, view).not.toContain('<textarea')
      expect(html, view).not.toContain('type="checkbox"')
      for (const item of VERIFICATION_CHECKLIST.items) expect(html, `${view} ${item.id}`).not.toContain(`<code>${item.id}</code>`)
    }
  })

  it('【報告と Issue の一覧】面では 報告(教室別)・GitHub Issue・機能の公開範囲 の 3 欄を描く', () => {
    const html = renderToString(createElement(DeveloperDashboardScreen, { ...FIREBASE_PROPS, initialView: 'detail' }))
    for (const id of ['dashboard-reports', 'dashboard-features', 'dashboard-issues']) expect(html, id).toContain(`id="${id}"`)
    expect(html).not.toContain('id="dashboard-overview"')
    expect(html).toContain('いまの状況')
    expect(html).toContain('報告の期間')
    expect(html).toContain('報告を読み込んでいます')
    expect(html).toContain('GitHub Issue を読み込んでいます')
    // 教室一覧の行(報告 0 件でも出る)と検証用教室の札。
    expect(html).toContain('スクールIE 緑が丘校')
    expect(html).toContain('検証用')
    // 機能フラグの段階: レジストリの全キーと、その scope の札が出る(今のフラグ状態に依存しない)。
    for (const [key, feature] of Object.entries(featureRolloutRegistry)) {
      expect(html, key).toContain(`<code>${key}</code>`)
      expect(html, key).toContain(FEATURE_SCOPE_LABELS[feature.scope])
    }
  })

  it('ローカルモードでは報告を読まず、その旨を出す(いまの状況・一覧とも)', () => {
    const localProps: DeveloperDashboardScreenProps = { ...FIREBASE_PROPS, authMode: 'local', workspaceKey: '', appVersion: '0.0.0', classrooms: [] }
    const overview = renderToString(createElement(DeveloperDashboardScreen, localProps))
    expect(overview).toContain('ローカルモードでは報告を読み込めません')
    expect(overview).not.toContain('報告を読み込んでいます')
    const detail = renderToString(createElement(DeveloperDashboardScreen, { ...localProps, initialView: 'detail' }))
    expect(detail).toContain('ローカルモードでは報告を読み込めません')
    expect(detail).not.toContain('報告を読み込んでいます')
  })
})

function escapeHtml(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#x27;')
}
