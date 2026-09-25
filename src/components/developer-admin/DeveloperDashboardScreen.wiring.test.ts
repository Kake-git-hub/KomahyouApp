// 開発ダッシュボードの配線ガード(source-scan・2026-09-25)。
//
// ⚠️ 本番データ保護: ダッシュボードは**読むだけ**の画面。取得は developerReportsStore(getDocs)と GitHub 公開 API の GET に
// 限り、画面から Firestore・callable・GitHub へ書く導線を作らない。集計は utils の純関数へ委譲する。
// 描画テスト環境が無いのでソース走査で担保する(作法は VerificationChecklistPanel.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ADMIN_TSX = readFileSync(fileURLToPath(new URL('./DeveloperAdminScreen.tsx', import.meta.url)), 'utf8')
const DASHBOARD_TSX = readFileSync(fileURLToPath(new URL('./DeveloperDashboardScreen.tsx', import.meta.url)), 'utf8')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

describe('開発ダッシュボードの配線(DeveloperAdminScreen)', () => {
  it('開発者画面のサブページとして import され、切替ボタンから開く', () => {
    expect(ADMIN_TSX).toContain("import { DeveloperDashboardScreen } from './DeveloperDashboardScreen'")
    expect(ADMIN_TSX).toContain("useState<'main' | 'classrooms' | 'dashboard'>('main')")
    expect(ADMIN_TSX).toContain('data-testid="developer-dashboard-toggle-button"')
    expect(ADMIN_TSX).toContain("{subPage === 'dashboard' ? (")
    expect(ADMIN_TSX).toContain('<DeveloperDashboardScreen')
  })

  it('開発者画面自体は App.tsx で role === developer に限定されている(室長には出ない)', () => {
    expect(APP_TSX).toContain("if (screen === 'developer' && currentUser.role === 'developer') {")
  })
})

describe('開発ダッシュボード本体', () => {
  it('取得は読み取り専用モジュールだけを使い、Firestore / callable / GitHub への書き込みを持たない', () => {
    expect(DASHBOARD_TSX).toContain("from '../../integrations/firebase/developerReportsStore'")
    expect(DASHBOARD_TSX).toContain("from '../../integrations/github/issues'")
    expect(DASHBOARD_TSX).not.toContain("from 'firebase/")
    expect(DASHBOARD_TSX).not.toMatch(/httpsCallable|setDoc|updateDoc|deleteDoc|writeBatch|addDoc/u)
    expect(DASHBOARD_TSX).not.toMatch(/\bfetch\(/u)
    expect(DASHBOARD_TSX).not.toContain('localStorage')
  })

  it('集計は utils の純関数へ委譲し、台帳は developmentStatusLedger を読む', () => {
    expect(DASHBOARD_TSX).toContain("from '../../utils/developerDashboard'")
    expect(DASHBOARD_TSX).toContain("from '../../utils/developmentStatusLedger'")
    for (const fn of ['summarizeDeveloperReportsByClassroom', 'buildFeatureRolloutOverview', 'summarizeVerificationChecklistStatus', 'resolveDeveloperReportStatus', 'buildIssueStateMap']) {
      expect(DASHBOARD_TSX, fn).toContain(`${fn}(`)
    }
  })

  it('要求された 3 つの欄(報告要望状況・開発状況・確認未確認)を必ず持つ', () => {
    expect(DASHBOARD_TSX).toContain('id="dashboard-reports"')
    expect(DASHBOARD_TSX).toContain('id="dashboard-features"')
    expect(DASHBOARD_TSX).toContain('id="dashboard-ledger"')
    expect(DASHBOARD_TSX).toContain('id="dashboard-issues"')
    expect(DASHBOARD_TSX).toContain('id="dashboard-checklist"')
  })

  it('検証用教室の判定は教室 ID で行う(名前判定へ戻さない・2026-09-16 の是正を維持)', () => {
    expect(DASHBOARD_TSX).toContain('isDevelopmentClassroom({ id }, workspaceKey)')
  })
})
