// 会社レイヤ【会社プロファイル】= フォーク(会社リポジトリ)が差し替えてよい唯一の置き場 `src/company/` の入口。
// 正本仕様: docs/spec-multi-tenant.md §2・§7-5・§11(Phase 1)/ 計画 docs/plan-2026-09-15-multi-company-architecture.md §2-2・§7 Phase 1。
//
// ★役割(2026-09-18・Phase 1 T1-1)
//   会社ごとに違ってよいもの(ブランド・呼称・帳票の注記/ヘッダ・追加ボタン/メニュー・会社版番号)を
//   **この 1 ファイルのプロファイル**に閉じ込め、コア本体(盤面ロジック・保存/復元・データ形・functions・rules)は
//   会社差を知らずに `companyProfile` を読むだけにする。フォークはコア本体ファイルを直接編集せず、
//   ここ(と src/company/ 配下)だけを書き換える(上流同期の衝突と回帰を最小にするため)。
//
// ★会社ごとの値は src/company/profiles/<会社キー>.ts(P-1・2026-10-10)。env VITE_COMPANY_KEY(無ければ
//   VITE_FIREBASE_WORKSPACE_KEY)で 1 社を選び、未登録のキーはビルド失敗(fail-closed)。
// ★既定値 = 既存運営会社(株式会社アーチ・workspaces/main)の現行値。**全項目が「出力不変」**になるよう
//   選んである(帳票フックは空・追加ボタン/メニューは空・会社版番号は空・呼称は今の言葉)。
//   コアに手を入れずに会社差を出したい要望が来たら、まず「この差し込み口で足りるか／コアの機能にすべきか」を
//   判定する(計画 §10-2「巨大ファイルは分割しない。差し込み口を数か所開けるだけ」)。
//
// ★触ってはいけない線
//   - `companyKey` は接続先 workspace(env VITE_FIREBASE_WORKSPACE_KEY)と一致させる。会社の壁は
//     workspaceKey で張られている(docs/spec-multi-tenant.md §1)ので、ここを別会社のキーにしても
//     他社データは見えない・書けない(見えたら INV 候補 C1 の違反 = バグ)。
//   - `featureDefaults` は**手書きしない**。コア台帳 src/utils/companyFeatureDefaults.ts から会社キーで
//     引いた派生値で、サーバー(Cloud Functions)と同じ台帳を読む(片側だけ変えると保護者 QR・質問 AI が
//     非対称になる)。会社既定を変えたいときは台帳へ行を足して上流(コア)へ取り込む。
import { resolveCompanyFeatureDefaults } from '../utils/companyFeatureDefaults'
import { COMPANY_PROFILE_DEFINITIONS, listRegisteredCompanyKeys } from './profiles'
import type { CompanyProfile, CompanyProfileDefinition, CompanyReportHooks, CompanyRoleKey } from './profileTypes'

// 型と既定値は profileTypes.ts に置く(profiles/<会社キー>.ts と循環させないため)。コア本体からは従来どおり
// `@company/profile` から読めるよう、ここで再公開する。
export type {
  CompanyMenuItem,
  CompanyProfile,
  CompanyProfileDefinition,
  CompanyReportHooks,
  CompanyRoleKey,
  CompanyRoleLabels,
  CompanyScreenActionContext,
  CompanyScreenExtensions,
  CompanyToolbarButton,
} from './profileTypes'
export {
  DEFAULT_APP_NAME,
  DEFAULT_ROLE_LABELS,
  EMPTY_COMPANY_REPORT_HOOKS,
  EMPTY_COMPANY_SCREEN_EXTENSIONS,
} from './profileTypes'
export { COMPANY_PROFILE_DEFINITIONS, listRegisteredCompanyKeys } from './profiles'

// ───────────────────────────────────────────────────────────────────────────
// 会社の選択(P-1・2026-10-10)— env で 1 社を選ぶ。未知のキーは fail-closed(例外 = ビルド/起動失敗)。
// ───────────────────────────────────────────────────────────────────────────

/** 既存運営会社(株式会社アーチ)の会社キー = workspaces/main。env が無いローカルモードの既定でもある。 */
export const DEFAULT_COMPANY_KEY = 'main'

export type CompanyKeyEnv = {
  VITE_COMPANY_KEY?: unknown
  VITE_FIREBASE_WORKSPACE_KEY?: unknown
}

function readEnvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * env から会社キーを決める。優先順: VITE_COMPANY_KEY → VITE_FIREBASE_WORKSPACE_KEY → 'main'(どちらも無い = ローカルモード)。
 * 両方あって食い違う場合は例外(計画 §7「2 社目のビルドがアーチの secret で動く(workspace の混線)」の歯止め。
 * プロファイル上は会社B・接続先は会社A のビルドを作らせない)。
 */
export function resolveCompanyKeyFromEnv(env: CompanyKeyEnv): string {
  const companyKey = readEnvValue(env.VITE_COMPANY_KEY)
  const workspaceKey = readEnvValue(env.VITE_FIREBASE_WORKSPACE_KEY)
  if (companyKey && workspaceKey && companyKey !== workspaceKey) {
    throw new Error(
      `会社キーと接続先 workspace が食い違っています: VITE_COMPANY_KEY=${companyKey} / VITE_FIREBASE_WORKSPACE_KEY=${workspaceKey}。`
      + ' 同じ会社キーに揃えてください(会社ごとのビルド secret FIREBASE_WEB_ENV_<会社キー> を確認)。',
    )
  }
  return companyKey || workspaceKey || DEFAULT_COMPANY_KEY
}

/**
 * 会社キーで登録簿(src/company/profiles/index.ts)から 1 社を選び、コア台帳の会社既定(featureDefaults)を補って
 * 完全なプロファイルにする。未登録のキーは例外(fail-closed: 既定の main に黙って落とさない)。
 */
export function selectCompanyProfile(companyKey: string): CompanyProfile {
  const key = companyKey.trim()
  const definition: CompanyProfileDefinition | undefined = Object.prototype.hasOwnProperty.call(COMPANY_PROFILE_DEFINITIONS, key)
    ? COMPANY_PROFILE_DEFINITIONS[key]
    : undefined
  if (!definition) {
    throw new Error(
      `会社プロファイルが未登録です: "${key}"(登録済み: ${listRegisteredCompanyKeys().join(', ')})。`
      + ' src/company/profiles/<会社キー>.ts を作り profiles/index.ts に登録してください。',
    )
  }
  if (definition.companyKey !== key) {
    throw new Error(`会社プロファイルの companyKey(${definition.companyKey})が登録キー(${key})と一致しません。`)
  }
  return Object.freeze({
    ...definition,
    featureDefaults: resolveCompanyFeatureDefaults(definition.companyKey),
  })
}

/** このビルドの会社キー(env から決定)。 */
export const COMPANY_KEY: string = resolveCompanyKeyFromEnv(import.meta.env as unknown as CompanyKeyEnv)

/**
 * このビルドの会社プロファイル。env VITE_COMPANY_KEY(無ければ VITE_FIREBASE_WORKSPACE_KEY)で profiles/ から 1 社を選ぶ。
 * ★既存運営会社(main)を選ぶと全項目が現行値(出力不変・src/company/profile.test.ts で固定)。
 */
export const companyProfile: CompanyProfile = selectCompanyProfile(COMPANY_KEY)

// ───────────────────────────────────────────────────────────────────────────
// コア本体から使う小さな読み取り関数(プロファイルの形に直接依存する箇所を減らす)
// ───────────────────────────────────────────────────────────────────────────

/** 役割名を辞書から引く。未知のキーはコンパイルで落ちる(型)。 */
export function roleLabel(key: CompanyRoleKey, profile: CompanyProfile = companyProfile): string {
  return profile.roleLabels[key]
}

/** アプリ名(タブ名・題名用)。 */
export function appName(profile: CompanyProfile = companyProfile): string {
  return profile.appName
}

/**
 * ブラウザのタブ名(document.title)。形は `<アプリ名>_<場面>`(オーナー確定 2026-09-18 D-7・§2-A 影響 1 承認済み・P-2)。
 *   - 場面が空(ログイン前など) → アプリ名だけ「コマ表アプリ」
 *   - 教室を開いている        → 「コマ表アプリ_緑が丘校」
 *   - 開発者画面              → 「コマ表アプリ_開発者画面」
 * 旧形「緑が丘校 | コマ表アプリ」へ戻さない(src/company/roleLabels.wiring.test.ts が字面を固定)。
 */
export function appDocumentTitle(scene: string, profile: CompanyProfile = companyProfile): string {
  const suffix = scene.trim()
  return suffix ? `${appName(profile)}_${suffix}` : appName(profile)
}

/**
 * 帳票へ渡す差し込み値。既定ロゴ(logoDefault)は reportHooks.logoDefaultUrl が空のときの補完に使う
 * (どちらも空なら従来どおり「ロゴ欄」)。
 */
export function resolveCompanyReportHooks(profile: CompanyProfile = companyProfile): CompanyReportHooks {
  const hooks = profile.reportHooks
  const logoDefaultUrl = hooks.logoDefaultUrl || profile.logoDefault || ''
  if (logoDefaultUrl === hooks.logoDefaultUrl) return hooks
  return { ...hooks, logoDefaultUrl }
}

/** 会社版番号つきの版表示。会社版が空ならコア版そのまま(Phase 2 で表示へ配線)。 */
export function formatAppVersionLabel(coreVersion: string, companyVersion: string = companyProfile.companyVersion): string {
  const suffix = companyVersion.trim()
  return suffix ? `${coreVersion}+${suffix}` : coreVersion
}
