// 会社プロファイル(Phase 1 T1-1)の型・既定値を固定する。
// 既定値は「既存運営会社(スクールIE)の現行値」で、**全項目が出力不変**(帳票フック空・追加ボタン/メニュー空・
// 会社版番号空・呼称は今の言葉)であることをここで守る。変えるときは docs/spec-multi-tenant.md §11 を先に改定する。
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { getFirebaseBackendConfig } from '../integrations/firebase/config'
import { resolveCompanyFeatureDefaults } from '../utils/companyFeatureDefaults'
import {
  appDocumentTitle,
  appName,
  COMPANY_KEY,
  COMPANY_PROFILE_DEFINITIONS,
  companyProfile,
  DEFAULT_APP_NAME,
  DEFAULT_COMPANY_KEY,
  DEFAULT_ROLE_LABELS,
  EMPTY_COMPANY_REPORT_HOOKS,
  EMPTY_COMPANY_SCREEN_EXTENSIONS,
  formatAppVersionLabel,
  listRegisteredCompanyKeys,
  resolveCompanyKeyFromEnv,
  resolveCompanyReportHooks,
  roleLabel,
  selectCompanyProfile,
  type CompanyKeyEnv,
} from '@company/profile'
import * as viaRelativePath from './profile'
import { mainCompanyProfile } from './profiles/main'

const INDEX_HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

describe('companyProfile(既存運営会社 = 株式会社アーチ(スクールIE)の既定値)', () => {
  it('会社キーは既存運営会社の workspace(main)', () => {
    expect(DEFAULT_COMPANY_KEY).toBe('main')
    // このテスト環境(env 未設定 or main)では main が選ばれる。会社別ビルドの env を入れて走らせたときはその会社になる。
    expect(COMPANY_KEY).toBe(resolveCompanyKeyFromEnv(import.meta.env as unknown as CompanyKeyEnv))
    expect(companyProfile.companyKey).toBe(COMPANY_KEY)
  })

  it('会社名は「株式会社アーチ」・ブランド名は「スクールIE」(D-6・どちらも画面には出さない)', () => {
    expect(mainCompanyProfile.displayName).toBe('株式会社アーチ')
    expect(mainCompanyProfile.brandName).toBe('スクールIE')
    expect(selectCompanyProfile('main').displayName).toBe('株式会社アーチ')
    expect(selectCompanyProfile('main').brandName).toBe('スクールIE')
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

describe('会社の選択(P-1): env → 会社キー → profiles/<会社キー>.ts', () => {
  it('VITE_COMPANY_KEY が最優先・無ければ VITE_FIREBASE_WORKSPACE_KEY・どちらも無ければ main(ローカルモード)', () => {
    expect(resolveCompanyKeyFromEnv({})).toBe('main')
    expect(resolveCompanyKeyFromEnv({ VITE_FIREBASE_WORKSPACE_KEY: ' main ' })).toBe('main')
    expect(resolveCompanyKeyFromEnv({ VITE_FIREBASE_WORKSPACE_KEY: 'xyz' })).toBe('xyz')
    expect(resolveCompanyKeyFromEnv({ VITE_COMPANY_KEY: 'xyz' })).toBe('xyz')
    expect(resolveCompanyKeyFromEnv({ VITE_COMPANY_KEY: 'xyz', VITE_FIREBASE_WORKSPACE_KEY: 'xyz' })).toBe('xyz')
    expect(resolveCompanyKeyFromEnv({ VITE_COMPANY_KEY: '', VITE_FIREBASE_WORKSPACE_KEY: 'xyz' })).toBe('xyz')
    expect(resolveCompanyKeyFromEnv({ VITE_COMPANY_KEY: 123 as unknown as string })).toBe('main')
  })

  it('会社キーと接続先 workspace が食い違うビルドは作らせない(会社B のプロファイルで会社A に接続する混線の防止)', () => {
    expect(() => resolveCompanyKeyFromEnv({ VITE_COMPANY_KEY: 'xyz', VITE_FIREBASE_WORKSPACE_KEY: 'main' })).toThrow(/食い違って/)
  })

  it('main を選ぶと現行のプロファイルと完全に同じ(出力不変)・凍結されている', () => {
    const selected = selectCompanyProfile('main')
    expect(selected).toEqual({
      ...mainCompanyProfile,
      featureDefaults: resolveCompanyFeatureDefaults('main'),
    })
    expect(selected.appName).toBe(DEFAULT_APP_NAME)
    expect(selected.roleLabels).toEqual(DEFAULT_ROLE_LABELS)
    expect(selected.reportHooks).toBe(EMPTY_COMPANY_REPORT_HOOKS)
    expect(selected.screenExtensions).toBe(EMPTY_COMPANY_SCREEN_EXTENSIONS)
    expect(selected.companyVersion).toBe('')
    expect(selected.logoDefault).toBeNull()
    expect(Object.isFrozen(selected)).toBe(true)
    // 現在のビルドが main なら companyProfile と同値。
    if (COMPANY_KEY === 'main') expect(companyProfile).toEqual(selected)
  })

  it('未登録の会社キーは例外(fail-closed・既定の main に黙って落とさない)', () => {
    expect(() => selectCompanyProfile('nosuchcompany')).toThrow(/未登録/)
    expect(() => selectCompanyProfile('')).toThrow(/未登録/)
    expect(() => selectCompanyProfile('constructor')).toThrow(/未登録/)
    expect(() => selectCompanyProfile('__proto__')).toThrow(/未登録/)
  })

  it('登録簿のキー = ファイル名 = 定義の companyKey(src/company/profiles/ の .ts は全部登録されている)', () => {
    const profilesDir = fileURLToPath(new URL('./profiles/', import.meta.url))
    const files = readdirSync(profilesDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'index.ts')
      .map((name) => name.slice(0, -'.ts'.length))
      .sort()
    expect(listRegisteredCompanyKeys()).toEqual(files)
    for (const key of files) {
      expect(COMPANY_PROFILE_DEFINITIONS[key].companyKey, key).toBe(key)
      // 会社キーの命名規則(D-2: 英小文字と数字・3〜16 文字)。main は既存キーとして許容。
      expect(key, key).toMatch(/^[a-z0-9]{3,16}$/)
      // 定義は featureDefaults を手書きしない(コア台帳からの派生値)。
      expect('featureDefaults' in COMPANY_PROFILE_DEFINITIONS[key], key).toBe(false)
    }
  })
})

describe('タブ名(P-2・D-7): `<アプリ名>_<場面>`', () => {
  it('教室名があれば「コマ表アプリ_緑が丘校」・空ならアプリ名だけ・開発者画面は「コマ表アプリ_開発者画面」', () => {
    expect(appDocumentTitle('緑が丘校')).toBe('コマ表アプリ_緑が丘校')
    expect(appDocumentTitle('')).toBe('コマ表アプリ')
    expect(appDocumentTitle('   ')).toBe('コマ表アプリ')
    expect(appDocumentTitle(`${roleLabel('developer')}画面`)).toBe('コマ表アプリ_開発者画面')
  })

  it('別会社のアプリ名でも同じ形(プロファイルを渡せる)', () => {
    const other = { ...companyProfile, appName: 'XYZ コマ表' }
    expect(appDocumentTitle('本校', other)).toBe('XYZ コマ表_本校')
    expect(appDocumentTitle('', other)).toBe('XYZ コマ表')
  })
})
