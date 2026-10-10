// 会社レイヤ【会社プロファイルの型と既定値】— src/company/profile.ts(入口)と src/company/profiles/<会社キー>.ts(各社の値)の
// 両方から読む共通部。profile.ts が profiles/ を import し、profiles/ がここを import する(循環させないため値の定義はここに置く)。
// 正本仕様: docs/spec-multi-tenant.md §11-1 / 計画 docs/plan-2026-09-18-second-company-onboarding.md P-1。
import type { CompanyFeatureDefault } from '../utils/companyFeatureDefaults'

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
  /** 会社名(例「株式会社アーチ」)。会社レイヤの識別用。画面・帳票・請求書には出さない(請求の会社名は棟の文書・P-11)。 */
  displayName: string
  /** ブランド名(例「スクールIE」)。会社名と分けて持つ(オーナー確定 2026-09-18 D-6)。画面には出さない。 */
  brandName: string
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

/**
 * 各社のプロファイル定義(src/company/profiles/<会社キー>.ts に置く形)。
 * `featureDefaults` はコア台帳からの派生値なので定義には書かせない(profile.ts が companyKey で引いて補う)。
 */
export type CompanyProfileDefinition = Omit<CompanyProfile, 'featureDefaults'>

/** 現行アプリの名前。index.html の <title> とも一致させる(テストで固定)。 */
export const DEFAULT_APP_NAME = 'コマ表アプリ'

/** 現行の役割名(出力不変の基準。変えるときは docs/spec-multi-tenant.md §11 の一覧も更新)。 */
export const DEFAULT_ROLE_LABELS: CompanyRoleLabels = Object.freeze({
  manager: '室長',
  classroomAdmin: '教室管理者',
  developer: '開発者',
})
