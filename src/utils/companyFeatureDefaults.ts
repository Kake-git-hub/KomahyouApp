// 会社(= workspace)ごとの【機能既定の台帳】と、機能フラグの段階解決(2 段)= この 1 ファイルが唯一の正本。
// 正本仕様: docs/spec-multi-tenant.md §7-1・§11(Phase 1 T1-2)/ 計画 docs/plan-2026-09-15-multi-company-architecture.md §10-2。
//
// ★なぜ「会社既定」をここ(コア)に置くか(Phase 1・2026-09-18)
//   機能フラグは基本スコープ(featureRollout.ts の development-only / staging-environment / all-classrooms)で
//   決まるが、会社ごとに「この機能は全教室で使う／使わない」を決められるようにする(オーナー確定 2026-09-16:
//   当面 2 段 = 基本スコープ → 会社既定。教室別上書き(O-1)は再開しないが 3 段目を後から差し込める形にする)。
//   保護者ポータル・質問 AI のように **サーバー(Cloud Functions)側にも同じ述語がある機能**は、クライアントだけ
//   会社既定を変えると「QR は出るのに API は 403」(またはその逆)の非対称になる。そこで会社既定は
//   フォークが触る src/company/ ではなく**コアの台帳**に置き、functions へ sync-shared で複製して両側が
//   同じ台帳・同じ解決順で判定する。会社プロファイル(src/company/profile.ts)の featureDefaults は
//   この台帳から会社キーで引いた**派生値**で、手書きしない。
//
// ★このファイルの制約(必ず守る・developmentClassroomRegistry.ts と同じ)
//   - **自己完結**(import 文 0 行・ビルド時メタ情報の参照・CommonJS の読み込み関数すべて禁止)。functions/scripts/sync-shared.mjs が
//     functions/src/generated/companyFeatureDefaults.ts へそのまま複製する。
//   - featureKey は文字列で持つ(featureRollout.ts を import できないため)。台帳の featureKey が
//     featureRolloutRegistry に実在することは src/utils/companyFeatureDefaults.test.ts が検査する。
//   - クライアントとサーバーの二重実装は禁止。ズレは functions/src/companyFeatureDefaults.parity.test.ts が検出する。
//
// ★会社既定を足すとき
//   COMPANY_FEATURE_DEFAULTS へ 1 行足す(workspaceKey・featureKey・'on'|'off'・理由)。足したら
//   `npm --prefix functions run sync-shared` を実行して生成物もコミットする。
//   - 'on'  = 基本スコープに関係なく、その会社の**全教室**で有効(開発用教室限定の機能を会社全体へ出す等)。
//   - 'off' = 基本スコープに関係なく、その会社の**全教室**で無効(開発用教室でも無効になる。検証したい間は書かない)。
//   - 行が無い = 基本スコープのとおり(既存運営会社 main は 2026-09-18 時点で行なし = 従来どおり)。

/** 会社既定の値。行が無い(= null)ときは基本スコープのとおり。 */
export type CompanyFeatureDefault = 'on' | 'off'

export type CompanyFeatureDefaultEntry = {
  /** 会社 = workspace のキー(`workspaces/{workspaceKey}`)。 */
  workspaceKey: string
  /** featureRollout.ts の featureRolloutRegistry のキー(文字列。実在はテストで検査)。 */
  featureKey: string
  value: CompanyFeatureDefault
  /** 人間向けの理由(判定には使わない)。 */
  reason: string
}

// 会社ごとの機能既定。**ここに無い(会社, 機能)は基本スコープのとおり**。
export const COMPANY_FEATURE_DEFAULTS: readonly CompanyFeatureDefaultEntry[] = [
  // 既存運営会社(main)は行なし = 全機能が基本スコープのとおり(Phase 1 導入時点の挙動不変)。
]

function normalizeKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 台帳から (workspaceKey, featureKey) の完全一致で会社既定を引く。無ければ null(= 基本スコープのとおり)。 */
export function resolveCompanyFeatureDefault(
  workspaceKey: string | null | undefined,
  featureKey: string | null | undefined,
): CompanyFeatureDefault | null {
  const ws = normalizeKey(workspaceKey)
  const key = normalizeKey(featureKey)
  if (!ws || !key) return null
  return COMPANY_FEATURE_DEFAULTS.find((entry) => entry.workspaceKey === ws && entry.featureKey === key)?.value ?? null
}

/** その会社の会社既定をまとめて引く(会社プロファイルの featureDefaults の派生元)。 */
export function resolveCompanyFeatureDefaults(workspaceKey: string | null | undefined): Readonly<Record<string, CompanyFeatureDefault>> {
  const ws = normalizeKey(workspaceKey)
  const result: Record<string, CompanyFeatureDefault> = {}
  if (!ws) return result
  for (const entry of COMPANY_FEATURE_DEFAULTS) {
    if (entry.workspaceKey === ws) result[entry.featureKey] = entry.value
  }
  return result
}

/**
 * 機能フラグの段階解決に渡す入力。段は**この順**で適用する(クライアント・サーバー共通)。
 *   1. scopeEnabled     … 基本スコープ(development-only / staging-environment / all-classrooms)の判定結果
 *   2. companyDefault   … 会社既定('on' なら有効・'off' なら無効・null なら 1 のまま)
 *   3. classroomOverride … 教室別上書き(O-1)。**Phase 1 では再開しない**が、後から差し込めるよう
 *                          入力の形だけ予約する。型を `null | undefined` に固定し、値を渡す経路が無い
 *                          (再開するときはここを `boolean | null` に広げ、2 の後に適用する)。
 */
export type FeatureLayerInput = {
  scopeEnabled: boolean
  companyDefault: CompanyFeatureDefault | null
  classroomOverride?: null
}

/**
 * 機能フラグを 2 段(基本スコープ → 会社既定)で解決する純関数。3 段目(教室別上書き)は予約のみ。
 * ★段の順序を入れ替えない・段を飛ばさない(クライアントとサーバーで同じ順序であることが非対称防止の要)。
 */
export function resolveFeatureEnabledByLayers(input: FeatureLayerInput): boolean {
  // 1. 基本スコープ
  let enabled = input.scopeEnabled
  // 2. 会社既定
  if (input.companyDefault === 'on') enabled = true
  else if (input.companyDefault === 'off') enabled = false
  // 3. 教室別上書き(O-1・未再開)。classroomOverride は型で null 固定なのでここでは何もしない。
  return enabled
}
