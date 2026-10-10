// 会社プロファイルの【登録簿】= 会社キー → src/company/profiles/<会社キー>.ts の定義。
// 会社を足すとき: profiles/<会社キー>.ts を作り、ここへ 1 行足す(キー = ファイル名 = 定義の companyKey。
// 揃っていないと src/company/profile.test.ts が赤)。ビルドは env VITE_COMPANY_KEY(無ければ
// VITE_FIREBASE_WORKSPACE_KEY)でここから 1 社を選ぶ。未登録のキーはビルド失敗(fail-closed・vite.config.ts と profile.ts)。
import type { CompanyProfileDefinition } from '../profileTypes'
import { mainCompanyProfile } from './main'

export const COMPANY_PROFILE_DEFINITIONS: Readonly<Record<string, CompanyProfileDefinition>> = Object.freeze({
  main: mainCompanyProfile,
})

/** 登録済みの会社キー一覧(ソート済み)。 */
export function listRegisteredCompanyKeys(): string[] {
  return Object.keys(COMPANY_PROFILE_DEFINITIONS).sort()
}
