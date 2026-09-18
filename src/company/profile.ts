// 会社レイヤ【会社プロファイル】= フォーク(会社リポジトリ)が差し替えてよい唯一の置き場 `src/company/` の入口。
// 正本仕様: docs/spec-multi-tenant.md §2・§7-5・§11(Phase 1)/ 計画 docs/plan-2026-09-15-multi-company-architecture.md §2-2・§7 Phase 1。
//
// ★役割(2026-09-18・Phase 1 T1-1)
//   会社ごとに違ってよいもの(ブランド・呼称・帳票の注記/ヘッダ・追加ボタン/メニュー・会社版番号)を
//   **この 1 ファイルのプロファイル**に閉じ込め、コア本体(盤面ロジック・保存/復元・データ形・functions・rules)は
//   会社差を知らずに `companyProfile` を読むだけにする。フォークはコア本体ファイルを直接編集せず、
//   ここ(と src/company/ 配下)だけを書き換える(上流同期の衝突と回帰を最小にするため)。
//
// ★既定値 = 既存運営会社(スクールIE・workspaces/main)の現行値。**全項目が「出力不変」**になるよう
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
import type { CompanyFeatureDefault } from '../utils/companyFeatureDefaults'
import { resolveCompanyFeatureDefaults } from '../utils/companyFeatureDefaults'

// ───────────────────────────────────────────────────────────────────────────
// 呼称(役割名)辞書 — Phase 1 T1-3。役割名だけ(オーナー確定 2026-09-16。授業用語は辞書化しない)。
// ───────────────────────────────────────────────────────────────────────────

/**
 * 役割名のキー。
 *  - manager       … 教室を運営する人(スクールIE では「室長」)。帳票・日程表の「室長登録」などに使う。
 *  - classroomAdmin … アカウント一覧に出す manager ロールの表示名(現行は「教室管理者」。manager と別の言葉なので別キー)。
 *  - developer     … 全教室を見る開発者(現行は「開発者」)。
 */
export type CompanyRoleKey = 'manager' | 'classroomAdmin' | 'developer'
export type CompanyRoleLabels = Readonly<Record<CompanyRoleKey, string>>

// ───────────────────────────────────────────────────────────────────────────
// 帳票フック — Phase 1 T1-4。生徒／講師日程表・空フォーマット(scheduleHtml.ts)への差し込み口。
// 帳票は別タブ(埋め込み JS)で描くため、関数ではなく**静的な HTML 文字列**を payload で渡す。
// ───────────────────────────────────────────────────────────────────────────

/**
 * 帳票への差し込み。**すべて空文字が既定**で、空のときは従来の出力と完全に同じ(出力不変)。
 *
 * ヘッダ差替(`*HeaderHtml`): 空でなければ、日程表 1 枚の上部ブロック(ロゴ欄・校舎名欄・題名欄・期間/氏名/ページ)
 *   を**丸ごと**この HTML に置き換える。次のトークンを埋め込める(値は HTML エスケープ済みで差し込まれる):
 *   `{{period}}`(期間)・`{{nameLabel}}`(「生徒名」/「講師名」)・`{{name}}`(氏名)・`{{page}}`(ページ番号 1 始まり)。
 *   `{{qr}}` だけは QR の SVG(HTML そのまま)。空フォーマットは生徒側のヘッダを使う(氏名は空)。
 * 追加注記(`*NoteHtml`): 空でなければ、日程表 1 枚の末尾(回数表の下)にそのまま挿入する。
 *   空フォーマットは `emptyFormatNoteHtml` を使う(生徒側の注記は入れない)。
 * 既定ロゴ(`logoDefaultUrl`): 空でなければ、利用者がロゴを未設定のときだけ「ロゴ欄」の代わりに表示する
 *   (利用者が設定したロゴが常に優先)。
 */
export type CompanyReportHooks = {
  studentHeaderHtml: string
  teacherHeaderHtml: string
  studentNoteHtml: string
  teacherNoteHtml: string
  emptyFormatNoteHtml: string
  logoDefaultUrl: string
}

export const EMPTY_COMPANY_REPORT_HOOKS: CompanyReportHooks = Object.freeze({
  studentHeaderHtml: '',
  teacherHeaderHtml: '',
  studentNoteHtml: '',
  teacherNoteHtml: '',
  emptyFormatNoteHtml: '',
  logoDefaultUrl: '',
})

// ───────────────────────────────────────────────────────────────────────────
// 画面フック — Phase 1 T1-5。盤面ツールバーの追加ボタンとメニューの追加項目の登録口(既定は空 = DOM 不変)。
// ───────────────────────────────────────────────────────────────────────────

/** 追加ボタン/項目を押したときに渡す文脈。コアの内部 state は渡さない(フォークがコアの形に依存しないため)。 */
export type CompanyScreenActionContext = {
  /** いま開いている教室の名前(未確定なら空文字)。 */
  classroomName: string
  /** 盤面が表示している週の開始日(YYYY-MM-DD)。メニューから呼ばれたときは空文字。 */
  weekStartDate: string
}

export type CompanyToolbarButton = {
  /** DOM の data-company-button と React key に使う一意な ID(英数字とハイフン)。 */
  id: string
  label: string
  title?: string
  onClick: (context: CompanyScreenActionContext) => void
}

export type CompanyMenuItem = {
  /** DOM の data-company-menu-item と React key に使う一意な ID(英数字とハイフン)。 */
  id: string
  label: string
  onClick: (context: CompanyScreenActionContext) => void
}

export type CompanyScreenExtensions = {
  /** 盤面ツールバー左側(質問・要望ボタンの右)に並べる追加ボタン。 */
  boardToolbarButtons: readonly CompanyToolbarButton[]
  /** メニュー(コマ表/基本データ/…)の既存項目の下・ログアウトの上に並べる追加項目。 */
  appMenuItems: readonly CompanyMenuItem[]
}

export const EMPTY_COMPANY_SCREEN_EXTENSIONS: CompanyScreenExtensions = Object.freeze({
  boardToolbarButtons: [],
  appMenuItems: [],
})

// ───────────────────────────────────────────────────────────────────────────
// プロファイル本体
// ───────────────────────────────────────────────────────────────────────────

export type CompanyProfile = {
  /** 会社キー = workspaceKey(`workspaces/{companyKey}`)。接続先 env VITE_FIREBASE_WORKSPACE_KEY と一致させる。 */
  companyKey: string
  /** 会社の表示名(請求書の宛名などではなく、会社レイヤの識別用。画面には Phase 1 では出さない)。 */
  displayName: string
  /** アプリ名(ブラウザのタブ名・ログイン画面の題名)。 */
  appName: string
  /** 既定ロゴ(帳票のロゴ欄に、利用者がロゴ未設定のときだけ出す)。null = 既定ロゴなし(従来どおり「ロゴ欄」)。 */
  logoDefault: string | null
  roleLabels: CompanyRoleLabels
  /** 会社既定の機能スイッチ(コア台帳 companyFeatureDefaults.ts からの派生値・手書きしない)。 */
  featureDefaults: Readonly<Record<string, CompanyFeatureDefault>>
  /**
   * 会社版番号(例 'companyB.12')。コア版と組み合わせて `1.5.530+companyB.12` の形にする(計画 §10-4)。
   * 空文字 = コアそのもの。表示への配線は Phase 2(T2-2)で行い、Phase 1 では値だけ持つ。
   */
  companyVersion: string
  reportHooks: CompanyReportHooks
  screenExtensions: CompanyScreenExtensions
}

/** 既存運営会社(スクールIE)の会社キー = workspaces/main。 */
export const COMPANY_KEY = 'main'

/** 現行アプリの名前。index.html の <title> とも一致させる(テストで固定)。 */
export const DEFAULT_APP_NAME = 'コマ表アプリ'

/** 現行の役割名(出力不変の基準。変えるときは docs/spec-multi-tenant.md §11 の一覧も更新)。 */
export const DEFAULT_ROLE_LABELS: CompanyRoleLabels = Object.freeze({
  manager: '室長',
  classroomAdmin: '教室管理者',
  developer: '開発者',
})

/**
 * 既存運営会社(スクールIE)のプロファイル = 最初の会社プロファイル。
 * ★全項目が現行値(出力不変)。フォークはこのオブジェクトを差し替える。
 */
export const companyProfile: CompanyProfile = Object.freeze({
  companyKey: COMPANY_KEY,
  displayName: 'スクールIE',
  appName: DEFAULT_APP_NAME,
  logoDefault: null,
  roleLabels: DEFAULT_ROLE_LABELS,
  featureDefaults: resolveCompanyFeatureDefaults(COMPANY_KEY),
  companyVersion: '',
  reportHooks: EMPTY_COMPANY_REPORT_HOOKS,
  screenExtensions: EMPTY_COMPANY_SCREEN_EXTENSIONS,
})

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
