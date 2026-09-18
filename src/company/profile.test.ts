// 会社プロファイル(Phase 1 T1-1)の型・既定値を固定する。
// 既定値は「既存運営会社(スクールIE)の現行値」で、**全項目が出力不変**(帳票フック空・追加ボタン/メニュー空・
// 会社版番号空・呼称は今の言葉)であることをここで守る。変えるときは docs/spec-multi-tenant.md §11 を先に改定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { getFirebaseBackendConfig } from '../integrations/firebase/config'
import { resolveCompanyFeatureDefaults } from '../utils/companyFeatureDefaults'
import {
  appName,
  COMPANY_KEY,
  companyProfile,
  DEFAULT_APP_NAME,
  DEFAULT_ROLE_LABELS,
  EMPTY_COMPANY_REPORT_HOOKS,
  EMPTY_COMPANY_SCREEN_EXTENSIONS,
  formatAppVersionLabel,
  resolveCompanyReportHooks,
  roleLabel,
} from '@company/profile'
import * as viaRelativePath from './profile'

const INDEX_HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

describe('companyProfile(既存運営会社 = スクールIE の既定値)', () => {
  it('会社キーは既存運営会社の workspace(main)', () => {
    expect(COMPANY_KEY).toBe('main')
    expect(companyProfile.companyKey).toBe('main')
  })

  it('`@company/profile` alias は src/company/profile.ts と同じモジュール(vite / vitest / tsconfig の alias が揃っている)', () => {
    expect(viaRelativePath.companyProfile).toBe(companyProfile)
  })

  it('アプリ名は現行の「コマ表アプリ」で index.html の <title> と一致する', () => {
    expect(DEFAULT_APP_NAME).toBe('コマ表アプリ')
    expect(appName()).toBe('コマ表アプリ')
    expect(INDEX_HTML).toContain(`<title>${DEFAULT_APP_NAME}</title>`)
  })

  it('役割名は現行の言葉(室長・教室管理者・開発者)', () => {
    expect(DEFAULT_ROLE_LABELS).toEqual({ manager: '室長', classroomAdmin: '教室管理者', developer: '開発者' })
    expect(roleLabel('manager')).toBe('室長')
    expect(roleLabel('classroomAdmin')).toBe('教室管理者')
    expect(roleLabel('developer')).toBe('開発者')
  })

  it('役割名は空文字にしない(辞書を差し替えても画面に空のラベルが出ない)', () => {
    for (const [key, label] of Object.entries(companyProfile.roleLabels)) {
      expect(label.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('帳票フックは全項目が空(既定の帳票出力を変えない)', () => {
    expect(companyProfile.reportHooks).toEqual({
      studentHeaderHtml: '',
      teacherHeaderHtml: '',
      studentNoteHtml: '',
      teacherNoteHtml: '',
      emptyFormatNoteHtml: '',
      logoDefaultUrl: '',
    })
    expect(companyProfile.logoDefault).toBeNull()
    expect(resolveCompanyReportHooks()).toBe(EMPTY_COMPANY_REPORT_HOOKS)
  })

  it('既定ロゴ(logoDefault)は reportHooks.logoDefaultUrl が空のときだけ補完される', () => {
    const withLogo = { ...companyProfile, logoDefault: 'data:image/png;base64,AAAA' }
    expect(resolveCompanyReportHooks(withLogo).logoDefaultUrl).toBe('data:image/png;base64,AAAA')
    const withBoth = { ...withLogo, reportHooks: { ...EMPTY_COMPANY_REPORT_HOOKS, logoDefaultUrl: '/company-logo.png' } }
    expect(resolveCompanyReportHooks(withBoth).logoDefaultUrl).toBe('/company-logo.png')
  })

  it('画面フック(追加ボタン・追加メニュー)は空(既定の DOM を変えない)', () => {
    expect(companyProfile.screenExtensions.boardToolbarButtons).toEqual([])
    expect(companyProfile.screenExtensions.appMenuItems).toEqual([])
    expect(companyProfile.screenExtensions).toBe(EMPTY_COMPANY_SCREEN_EXTENSIONS)
  })

  it('会社既定の機能スイッチはコア台帳からの派生値(手書きしない)で、既存運営会社は行なし = 基本スコープのとおり', () => {
    expect(companyProfile.featureDefaults).toEqual(resolveCompanyFeatureDefaults('main'))
    expect(companyProfile.featureDefaults).toEqual({})
  })

  it('会社版番号は空(コアそのもの)。版表示はコア版のまま／会社版があれば `+` でつなぐ', () => {
    expect(companyProfile.companyVersion).toBe('')
    expect(formatAppVersionLabel('1.5.543')).toBe('1.5.543')
    expect(formatAppVersionLabel('1.5.543', 'companyB.12')).toBe('1.5.543+companyB.12')
    expect(formatAppVersionLabel('1.5.543', '  ')).toBe('1.5.543')
  })

  it('接続先 workspaceKey(env)が設定されているときは companyKey と一致する(プロファイル上は会社B・機能解決は会社A のドリフト防止)', () => {
    const workspaceKey = getFirebaseBackendConfig().workspaceKey
    if (workspaceKey) expect(companyProfile.companyKey).toBe(workspaceKey)
    vi.stubEnv('VITE_FIREBASE_WORKSPACE_KEY', 'main')
    try {
      expect(companyProfile.companyKey).toBe(getFirebaseBackendConfig().workspaceKey)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('プロファイルは凍結されている(実行時に書き換えて会社差を出さない)', () => {
    expect(Object.isFrozen(companyProfile)).toBe(true)
    expect(Object.isFrozen(companyProfile.reportHooks)).toBe(true)
    expect(Object.isFrozen(companyProfile.screenExtensions)).toBe(true)
  })
})
