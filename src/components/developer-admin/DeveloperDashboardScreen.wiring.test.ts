// 開発ダッシュボードの配線ガード(source-scan・2026-09-25、2026-09-28 未対応面の追加、2026-10-30【いまの状況】への作り直しに追随)。
//
// ⚠️ 本番データ保護: ダッシュボードは**読むだけ**の画面。取得は developerReportsStore(getDocs)と GitHub 公開 API の GET に
// 限り、画面から Firestore・callable・GitHub へ書く導線を作らない。集計は utils の純関数へ委譲する。
// Claude Code へ渡すのは URL(claude.ai/code?prompt=…)とクリップボードだけ。
// 描画テスト環境が無いのでソース走査で担保する(作法は VerificationChecklistPanel.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ADMIN_TSX = readFileSync(fileURLToPath(new URL('./DeveloperAdminScreen.tsx', import.meta.url)), 'utf8')
const DASHBOARD_TSX = readFileSync(fileURLToPath(new URL('./DeveloperDashboardScreen.tsx', import.meta.url)), 'utf8')
const DETAIL_TSX = readFileSync(fileURLToPath(new URL('./DeveloperDashboardDetail.tsx', import.meta.url)), 'utf8')
const ACTIONS_TS = readFileSync(fileURLToPath(new URL('../../utils/developerDashboardActions.ts', import.meta.url)), 'utf8')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const SCREEN_SOURCES = [DASHBOARD_TSX, DETAIL_TSX]

describe('開発ダッシュボードの配線(DeveloperAdminScreen)', () => {
  it('開発者画面のサブページとして import され、切替ボタンから開く', () => {
    expect(ADMIN_TSX).toContain("import { DeveloperDashboardScreen } from './DeveloperDashboardScreen'")
    expect(ADMIN_TSX).toContain("useState<'main' | 'classrooms' | 'dashboard' | 'answers'>('main')")
    expect(ADMIN_TSX).toContain('data-testid="developer-dashboard-toggle-button"')
    expect(ADMIN_TSX).toContain("{subPage === 'dashboard' ? (")
    expect(ADMIN_TSX).toContain('<DeveloperDashboardScreen')
  })

  it('開発者画面自体は App.tsx で role === developer に限定されている(室長には出ない)', () => {
    expect(APP_TSX).toContain("if (screen === 'developer' && currentUser.role === 'developer') {")
  })
})

describe('開発ダッシュボード本体(いまの状況＋報告と Issue の一覧)', () => {
  it('取得は読み取り専用モジュールだけを使い、Firestore / callable / GitHub への書き込みを持たない', () => {
    expect(DASHBOARD_TSX).toContain("from '../../integrations/firebase/developerReportsStore'")
    expect(DASHBOARD_TSX).toContain("from '../../integrations/github/issues'")
    for (const source of [...SCREEN_SOURCES, ACTIONS_TS]) {
      expect(source).not.toContain("from 'firebase/")
      expect(source).not.toMatch(/httpsCallable|setDoc|updateDoc|deleteDoc|writeBatch|addDoc/u)
      expect(source).not.toMatch(/\bfetch\(/u)
      expect(source).not.toContain('localStorage')
      expect(source).not.toMatch(/window\.open\(/u)
    }
    // 詳細面は取得しない(親から受け取るだけ)。
    expect(DETAIL_TSX).not.toContain('developerReportsStore')
    expect(DETAIL_TSX).not.toContain("integrations/github")
  })

  it('集計は utils の純関数へ委譲する', () => {
    const joined = SCREEN_SOURCES.join('\n')
    expect(DASHBOARD_TSX).toContain("from '../../utils/developerDashboard'")
    expect(DASHBOARD_TSX).toContain("from '../../utils/developerDashboardActions'")
    for (const fn of ['summarizeDeveloperReportsByClassroom', 'buildFeatureRolloutOverview', 'resolveDeveloperReportStatus', 'buildIssueStateMap', 'buildDashboardOverview', 'resolveClaudeCodeSessionUrl']) {
      expect(joined, fn).toContain(`${fn}(`)
    }
  })

  it('既定は【いまの状況】(initialView = overview)で、3 つの欄・面の切替・カードごとの「Claude に頼む」を持つ', () => {
    expect(DASHBOARD_TSX).toContain("initialView = 'overview'")
    expect(DASHBOARD_TSX).toContain('data-testid="developer-dashboard-view-toggle"')
    expect(DASHBOARD_TSX).toContain('id="dashboard-overview"')
    expect(DASHBOARD_TSX).toContain("todo: 'dashboard-todo'")
    expect(DASHBOARD_TSX).toContain("trial: 'dashboard-trial'")
    expect(DASHBOARD_TSX).toContain("'not-built': 'dashboard-not-built'")
    expect(DASHBOARD_TSX).toContain('<DeveloperDashboardDetail')
    expect(DASHBOARD_TSX).toContain('resolveClaudeCodeSessionUrl(card.prompt)')
    // 新セッションは公式の URL 形式(claude.ai/code?prompt=…&repositories=…)。別の入口へ差し替えない。
    expect(ACTIONS_TS).toContain("CLAUDE_CODE_NEW_SESSION_URL = 'https://claude.ai/code'")
    expect(ACTIONS_TS).toContain("new URLSearchParams({ repositories: GITHUB_REPOSITORY, prompt })")
    // URL の # を変えない(# 始まりの URL は共有盤面・講習提出の入口が読む)。
    expect(DASHBOARD_TSX).not.toMatch(/href=\{`#/u)
  })

  it('確認リストとの重複をなくす(2026-10-30): 画面も集計も確認リストの結果を読まず、一覧面から確認リスト・台帳の欄を外した', () => {
    for (const source of [...SCREEN_SOURCES, ACTIONS_TS]) {
      expect(source).not.toContain('summarizeVerificationChecklistStatus')
      expect(source).not.toContain('VerificationChecklistStatusSummary')
    }
    expect(DETAIL_TSX).not.toContain('id="dashboard-checklist"')
    expect(DETAIL_TSX).not.toContain('id="dashboard-ledger"')
    expect(DETAIL_TSX).toContain('id="dashboard-reports"')
    expect(DETAIL_TSX).toContain('id="dashboard-features"')
    expect(DETAIL_TSX).toContain('id="dashboard-issues"')
  })

  it('検証用教室の判定は教室 ID で行う(名前判定へ戻さない・2026-09-16 の是正を維持)', () => {
    expect(DETAIL_TSX).toContain('isDevelopmentClassroom({ id }, workspaceKey)')
  })
})
