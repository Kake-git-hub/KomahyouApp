// 既存運営会社【株式会社アーチ】(workspaces/main)の会社プロファイル。
// ★全項目が現行値(出力不変)。帳票フック空・追加ボタン/メニュー空・会社版番号空・呼称は今の言葉。
//   会社名(displayName)とブランド名(brandName)は Phase 1〜2 では画面・帳票・請求書に出ない
//   (オーナー確定 2026-09-18 D-6「既存利用者に影響が無いなら会社名=株式会社アーチ・ブランド名=スクールIE」)。
// ファイル名 = 会社キー(profiles/<会社キー>.ts)。登録は profiles/index.ts に 1 行。
import {
  DEFAULT_APP_NAME,
  DEFAULT_ROLE_LABELS,
  EMPTY_COMPANY_REPORT_HOOKS,
  EMPTY_COMPANY_SCREEN_EXTENSIONS,
  type CompanyProfileDefinition,
} from '../profileTypes'

export const mainCompanyProfile: CompanyProfileDefinition = Object.freeze({
  companyKey: 'main',
  displayName: '株式会社アーチ',
  brandName: 'スクールIE',
  appName: DEFAULT_APP_NAME,
  logoDefault: null,
  roleLabels: DEFAULT_ROLE_LABELS,
  companyVersion: '',
  reportHooks: EMPTY_COMPANY_REPORT_HOOKS,
  screenExtensions: EMPTY_COMPANY_SCREEN_EXTENSIONS,
})
