// 開発ダッシュボード(開発者画面)に出す【進行中テーマの台帳】= この 1 ファイルが唯一の正本。
// 正本仕様: docs/spec-developer-report.md §E-3。起点は途中作業の洗い出し docs/review-2026-09-25-work-in-progress-inventory.md。
//
// ★何を載せるか(2026-10-30 オーナー指示「開発ダッシュボードは機能の実装がまだのものや、開発・テスト教室だけしか実施していない機能、
//   やるべきこと(確認リスト以外で)などをわかり易い文章で表示して」)
//   - 開発・テスト教室だけで動いている機能(機能フラグが全教室でないもの)
//   - やること(オーナーの判断・作業、Claude の作業)
//   - まだ作っていないもの(計画だけ・保留)
//   を **1 テーマ 1 行**で持つ。終わったテーマは**すぐ消す**(git 履歴に残る)。確認リストの結果待ちだけの話は載せない
//   (確認リストパネルが正本・ダッシュボードと重複させない)。
//
// ★書き方(オーナー指示 2026-10-30「わかり易い文章で」・長さはテストで固定)
//   - title … 何のことか一目で分かる名前。社内用語・記号(P-9・Q40・tp-51 など)を入れない。
//   - summary … 何をするもの／今どうなっているかを 1〜2 文。専門用語は避ける。
//   - nextAction … 次に「誰が」「何を」するかを 1 文。
//   - notes … 経緯・決定記録・ファイル名など Claude 向けの詳しいメモ(任意・画面では「くわしく」で開く)。
//
// ★いつ更新するか(CLAUDE.md「進行中テーマ台帳を更新する」)
//   - 機能フラグの scope を変えた(昇格した)・ブランチをマージした・保留を解除した・済んだ → その行を書き換えるか消す。
//   - 新しい先行機能・作りかけの作業・オーナー判断待ちが生まれた → 行を足す。
//   - 機能フラグと紐づく行は、フラグの scope と stage が食い違うと developmentStatusLedger.test.ts が落ちる
//     (昇格したのに「開発用教室で先行中」のまま残るのを防ぐ)。
//
// このファイルは純データのみ(import は型と featureRollout のキー型だけ)。DOM / ネットワークには触らない。

import type { FeatureRolloutKey } from './featureRollout'

/**
 * テーマの段階。
 *  - development-only … 開発用教室(検証用教室)だけで動いている先行機能。次は確認 or 昇格判断。
 *  - awaiting-checklist … 実装済みで、確認リストの結果(OK/要改善)だけを待っている(ダッシュボードには出さない)。
 *  - awaiting-owner … 実装や調査は済んでいて、オーナーの判断・作業を待っている。
 *  - in-progress … 作りかけ(未マージのブランチなど)。
 *  - planned … 計画・仕様はあるが未着手。
 *  - on-hold … オーナー判断で保留(再開条件つき)。
 */
export const DEVELOPMENT_STATUS_STAGES = ['development-only', 'awaiting-checklist', 'awaiting-owner', 'in-progress', 'planned', 'on-hold'] as const
export type DevelopmentStatusStage = (typeof DEVELOPMENT_STATUS_STAGES)[number]

export const DEVELOPMENT_STATUS_STAGE_LABELS: Readonly<Record<DevelopmentStatusStage, string>> = {
  'development-only': '開発用教室で先行中',
  'awaiting-checklist': '確認リスト結果待ち',
  'awaiting-owner': 'オーナー判断待ち',
  'in-progress': '作りかけ',
  planned: '未着手',
  'on-hold': '保留',
}

/** 次の一手を持っている人。 */
export type DevelopmentStatusWho = 'owner' | 'claude'

export const DEVELOPMENT_STATUS_WHO_LABELS: Readonly<Record<DevelopmentStatusWho, string>> = {
  owner: 'オーナー',
  claude: 'Claude',
}

/** 画面で読みやすい長さの上限(テストで固定。超えたら notes へ移す)。 */
export const DEVELOPMENT_STATUS_TEXT_LIMITS = { title: 40, summary: 140, nextAction: 110 } as const

export type DevelopmentStatusEntry = {
  /** 一意の識別子(英小文字とハイフン)。 */
  id: string
  /** 画面に出す短い名前(社内用語・記号を入れない)。 */
  title: string
  stage: DevelopmentStatusStage
  /** 次の一手を持っている人。 */
  who: DevelopmentStatusWho
  /** 何をするもの／今どうなっているか(1〜2 文・平易に)。 */
  summary: string
  /** 次に誰が何をするか(1 文)。 */
  nextAction: string
  /** 経緯・決定記録・関係ファイルなど詳しいメモ(任意・画面では「くわしく」で開く)。 */
  notes?: string
  /** 紐づく機能フラグ(featureRollout.ts のキー)。scope と stage の整合はテストで固定。 */
  featureKeys?: readonly FeatureRolloutKey[]
  /** 根拠(docs のパス・Issue 番号・ブランチ名など)。`Issue #N` の形で書くと画面が Issue へのリンクにする。 */
  references: readonly string[]
  /** この行を最後に見直した日(YYYY-MM-DD)。 */
  updatedOn: string
}

export const DEVELOPMENT_STATUS_LEDGER: readonly DevelopmentStatusEntry[] = [
  // ── 開発・テスト教室だけで動いている機能 ───────────────────────────────────
  // 2026-11-08: 確認リストが全部 OK になり、オーナー指示「開発・テスト教室だけで動いている機能の 4 件を全教室展開して」で
  // テンプレ差分反映(templateDiffApply)・保護者向けQR(parentPortalQr)・講習の日程公開(lectureSchedulePublishToggle)・
  // 講師専用の特別講習(teacherOnlySpecialSession)を全教室へ昇格(v1.5.711・サーバーの PARENT_PORTAL_BASE_SCOPE も同じ push)。
  // この欄は今は空(消した 4 行は git 履歴の v1.5.710 時点を参照)。次の先行機能はここへ足す。
  {
    id: 'template-conflict-v2',
    title: 'テンプレ反映の古い説明を畳み、机の対応付けを 1 か所にまとめる',
    stage: 'planned',
    who: 'claude',
    summary: 'テンプレ反映の新しい規則(出自の印・2 行・講師の休み・丸ごと振替の付け替え)は 11/8 に全教室へ出した。残りは、置き換えた古い説明を「旧仕様」として畳むことと、管理データと盤面の机の対応付けが 3 か所に分かれているのを 1 つにまとめる内部の整理。',
    nextAction: 'Claude が古い説明を畳む。机の対応付けは、次にテンプレ周りを直すときに 1 か所へまとめる(急がない)。',
    notes: '2026-11-05 オーナー決定で §H(Q21〜Q42・決定記録 66 本)を docs/spec-template-conflict-v2.md に置き換え、段 1〜段 5 を v1.5.689〜v1.5.710 で開発用/テスト教室に出した(確認リスト v2-1〜v2-6・se-1〜se-10・mg-1/mg-2 OK)。2026-11-08 オーナー指示で templateDiffApply を all-classrooms へ(全教室昇格前の必須だった Q33-1=旧版タブのすき間は版が揃うまでの一時的なもの＝反映後のハードリロードで潰す・N-1=フラグを戻したときの保留の保護は 2026-11-08 に塞いだ(保留のある教室は OFF でも第 2 版・resolveTemplateDiffApplyActive)・既知の穴=同名講師の不動点は it.todo のまま)。残り: (1) spec-template-behavior.md §H を「旧仕様(2026-11-05 まで)」として畳み spec-template-conflict-v2.md を正本にする(§H の冒頭に注記は済み・本文の畳み込みは未)。(2) 監査(2026-11-06)の中期課題: 管理机↔盤面の机の対応付けが mergeManagedWeek・resolveBoardDeskIndexForManagedDesk・resolveAnchorCandidates(templateDeskOrderRestore)の 3 か所に分かれているので 1 つの権威関数へまとめる(6793374 型の食い違いを防ぐ)。(3) it.todo: 付け替えの移した先 D\' の休日設定・別の日へ動かして戻す往復・移した先から別の週へ動かした場合の暗黙の抑止キー。',
    references: ['docs/spec-template-conflict-v2.md', 'docs/spec-template-behavior.md §H(旧仕様)', 'src/components/schedule-board/templateDiffApply.ts', 'src/components/schedule-board/templateDeskOrderRestore.ts'],
    updatedOn: '2026-11-08',
  },
  // ── オーナー判断待ち ───────────────────────────────────────────────────────
  {
    id: 'checklist-auto-prep',
    title: '確認リストの準備をアプリが自動で作る',
    stage: 'development-only',
    who: 'owner',
    summary: '確認リストの「準備する」を押すと、体験や講師を置き、確認用の生徒や講師をテンプレに登録して保存するところまでアプリが行う。「後片づけ」で消せる。結果の文は短く、日付と名前は項目の文に出る。開発用教室とテスト教室だけ。',
    nextAction: 'オーナーが確認リストで、新しく準備を付けた項目を試す。',
    notes: 'フリーメモ 20261105-190026128・20261105-190336460(v1.5.689)。2026-11-06 オーナー選択: 案 C(段階導入)。計画 docs/plan-2026-11-06-checklist-auto-prep.md・仕様 spec-developer-report §E-2-4。第 1 段(v1.5.692): v2-1・tp-64 に autoPrep。純関数 checklistPrep.ts(置き場・操作・結果文)、一過性リクエスト checklistPrepRequest(App → ScheduleBoardScreen・Issue #46 同型・10 秒の保険タイマー・教室切り替えで取りやめ)、commitWeeks を 1 回通す(保存は手動)。会計中立(体験・メモ・手置き講師だけ・INV-06)。本番 3 校にはパネルも処理も出ない(isActingDevelopmentClassroom の二重ガード)。第 2 段(v1.5.694): tp-64 の準備がテンプレ登録と保存まで進み、後片づけ(ap-3)を足した。関数は checklistPrepTemplate.ts の ensureChecklistPrepStudents・assignChecklistPrepTemplateStudents・cleanupChecklistPrepBoard・removeChecklistPrepTemplateStudents、App の checklistPrepRequest(kind prep/cleanup)。次の段の候補: tp-71(同じ日の別の時限へ動かす)・v2-6(振替＝休み→在庫から配置・会計を伴う)・v2-3。v1.5.692 の確認(受付 20261105-234703564)で ap-1 OK・メモ「やることも手順ごとに準備と同じように自動化して」「準備ボタンは項目の左側に」→ ボタンの位置は v1.5.693 で直した(ap-2)。やることの自動化は懸案(確かめたい操作そのものを機械が行うと画面の不具合を見逃す・テンプレ保存の自動化は重い・項目ごとに専用の処理が要る)を示し、2026-11-06 オーナー選択: データ作りだけ自動化・テンプレ保存まで自動(確認画面と保存前 PDF は出さず詳細は結果の文へ)・確認用の生徒を名簿に作る・後片づけボタン・まず tp-64 だけ(仕様 spec-developer-report §E-2-4-2)。v2-1 は OK で確認リストから外したが準備の処理は残す。第 3 段(v1.5.696・2026-11-07 オーナー指示「他のテンプレにも準備するを適用して」): tp-59・tp-69・tp-70 に新しい置き方(テンプレの空き机へ講師も登録・印 checklistPrepTeacherId)、mn-1・tp-66 は tp-64 と同じ置き方。tp-64 は OK で外したが処理は残す。後片づけを各項目の準備の行にも出した(ap-3)。計画 docs/plan-2026-11-07-checklist-auto-prep-stage3.md・仕様 §E-2-4-3。第 4 段(v1.5.697・オーナー回答 2026-11-07): tp-71・tp-72・tp-75・v2-3・v2-6。確認用の生徒に限り休み・振替・移動を準備で行う(checklistPrepSequence.ts)。v2-5 は付けない。第119版(2026-11-07 オーナー指示「など細かい事象説明は不要。今のシンプルにした文に、いつの誰を追記して」): 成功の結果の文を 2 行にし、facts を項目の文の {{prep:キー}} へ差し込む(仕様 §E-2-4-4・確認リスト ap-4)。',
    references: ['docs/plan-2026-11-06-checklist-auto-prep.md', 'docs/spec-developer-report.md §E-2-4', 'src/components/schedule-board/checklistPrep.ts', 'src/components/developer-report/VerificationChecklistPanel.tsx'],
    updatedOn: '2026-11-07',
  },

  // ── やること(オーナー) ──────────────────────────────────────────────────────
  {
    id: 'finished-issues-cleanup',
    title: '対応が済んだ Issue を閉じる(8 件)',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '中身は済んでいて記録のために開いたままの Issue。確認リストの古い自動起票(#62〜#66)、LINE で回答済みの質問(#69・#70)、修正済みの不具合(#76)。',
    nextAction: 'オーナーがこのカードの「#N を閉じる」か GitHub で閉じる(Claude に頼んでもよい)。済んだらこの行を消す。',
    notes: '#62〜#66 は 2026-09-13 に「確認リストは Issue を起票しない」へ変える前の自動起票。#69・#70 はオーナーから「今日までの質問はすべて LINE で対応済み」(2026-09-28)。#76(生徒を削除して並べ替えると講師の名前が消える)は v1.5.600 で全教室修正・確認 tp-52 OK(2026-10-15)。閉じたら開発者画面「質問への回答」で該当の報告を「解決済みにする」。',
    references: ['Issue #62', 'Issue #63', 'Issue #64', 'Issue #65', 'Issue #66', 'Issue #69', 'Issue #70', 'Issue #76'],
    updatedOn: '2026-11-03',
  },
  {
    id: 'template-duplicate-save-guard',
    title: '日大前校のテンプレで同じ生徒が 2 か所にいる(金曜 3限)',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '日大前校のテンプレの金曜 3限で、机 4 と机 7 に同じ生徒が入っている。次にテンプレを保存すると「保存できません」と止まり、片方を外せば保存できる。',
    nextAction: '室長へ先に「机 7 の生徒を外して保存し直して」と伝えるか、保存時の案内に任せるかをオーナーが決める。',
    notes: '確認リスト 2026-10-14 の質問「テンプレの講師が追従しない日がある」の調査で見つかった。テンプレ編集の同じコマの重複検査は全教室で有効(INV-12・templateEditorGuards.ts)。直せば 11/6 以降の金 3限で机 7 の講師が落ちる症状も直る。受付 20261014-062117803-c223100f。',
    references: ['docs/spec-invariants.md INV-12', 'src/components/schedule-board/templateEditorGuards.ts'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'stale-branches-2026-06',
    title: '使っていない古いブランチを消す',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '不要と決まった古いブランチ 3 本と、取り込み済みのブランチがたくさん残っている。Claude の環境からは消せない。',
    nextAction: 'オーナーが GitHub の Actions →「Delete stale branches」を実行する(まず dry_run=true で一覧を確認 → false で実行)。',
    notes: '破棄が決まっているのは ci/functions-deploy-409-targeted・claude/test-procedure-docs-tm1y8t・agents/feature-data-integrity-checks(2026-09-28 オーナー判断)。済んだらこの行と .github/workflows/delete-stale-branches.yml を消す。',
    references: ['.github/workflows/delete-stale-branches.yml', 'docs/review-2026-09-25-work-in-progress-inventory.md §3'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'contract-baseline-arch',
    title: 'アーチ社との契約時点の環境を固定して戻せるようにする(作りかけ)',
    stage: 'in-progress',
    who: 'owner',
    summary: '契約した時点の版に印を付け、いつでもその版へ戻せる手順と仕組みを足す内容。9 月 19 日からブランチに作りかけのまま。',
    nextAction: 'ブランチを取り込むか捨てるかをオーナーが決める(取り込むなら Claude が仕上げる)。',
    notes: 'ブランチ claude/arch-contract-recovery-plan-m7765e(5 コミット・未マージ)。release タグ自動付与・stable の印・復旧ワークフロー・runbook。CI ワークフローが増えるので慎重に。契約時タグの push はオーナー作業。',
    references: ['claude/arch-contract-recovery-plan-m7765e', 'docs/runbooks/contract-baseline-arch.md(ブランチ内)'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'ui-text-review',
    title: '室長・保護者向け画面の言葉の見直し(Excel)',
    stage: 'in-progress',
    who: 'owner',
    summary: '画面の言葉から社内用語を減らす修正案を Excel にまとめてある(ブランチ内・まだ取り込んでいない)。',
    nextAction: 'オーナーが Excel に可否を書き込む → Claude が画面へ反映する。',
    notes: 'ブランチ claude/stoic-carson-srb4tr(4 コミット・docs のみ)。docs/ui-text-review-2026-09-18.md(ブランチ内)。',
    references: ['claude/stoic-carson-srb4tr', 'docs/ui-text-review-2026-09-18.md(ブランチ内)'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'second-company-onboarding',
    title: '2 社目を受け入れる準備の残り',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '会社ごとの設定・請求・新しい会社を作る道具などは作成済み。残りは検証環境での予行演習と、請求画面を見られる人の設定。',
    nextAction: 'オーナーが検証環境で架空の会社を作る予行演習を 1 周する(手順書 docs/runbooks/company-onboarding.md)。',
    notes: '残り: P-9 予行演習(runbook §2〜§10・所要時間と詰まりを §10 の表へ)、P-0(薬円台校の削除後の記述整理・オーナーの削除待ち)、請求許可者の第 2 段(オーナーが会員文書に billingAllowed を立ててからメール固定を撤去)。確認 mc-1(タブ名)。',
    references: ['docs/plan-2026-09-18-second-company-onboarding.md §3/§8', 'docs/runbooks/company-onboarding.md', 'docs/spec-multi-tenant.md §11-1/§12/§13'],
    updatedOn: '2026-10-30',
  },

  // ── やること(Claude) ────────────────────────────────────────────────────────
  {
    id: 'rollout-week-rollback-readiness',
    title: '全教室展開週の戻し準備と毎朝の健診',
    stage: 'in-progress',
    who: 'claude',
    summary: '11/8 に全教室へ出した 4 機能を 1 本ずつ止められるようにし、毎朝 7:40 に本番 2 校を読み取りだけで点検する。生徒ごとの経緯と保証台帳の違反を調べる道具も足した。',
    nextAction: '11/16 に健診を止め、この行を消す。調べる道具は続けて使う。',
    notes: '2026-11-08 オーナー採用: 案 1(フラグを即 OFF に戻せる準備)＋案 4(毎朝の自動健診)。見送り: 15 分バックアップの間引き停止・版履歴から復元 JSON を出すツール・元に戻すの永続化。N-1 は「保留のある教室はフラグ OFF でも第 2 版の経路」で塞いだ(resolveTemplateDiffApplyActive)。戻しは FEATURE_ROLLBACKS に記録し tools/feature-flag-rollback.mjs 1 本＋main マージ 1 回(昇格を固定するテストは記録を見る・保護者QRの範囲 ≦ 講習の公開の範囲は無条件の門番)。健診は tools/board-health-check.mjs と docs/runbooks/morning-health-check.md、Claude のスケジュール実行(新セッション・7:40 JST・11/9〜11/15・プッシュ通知)。計画 docs/plan-2026-11-08-rollback-readiness-week.md。 2026-11-09 オーナー指示「戻すより室長の質問への回答とバグ時の生徒の処理が優先」で追加: 保証台帳の違反の洗い出し tools/inv-audit.mjs(「決めつけずに保証台帳に違反しているものがバグ」・休日に残る授業もバグ・毎朝の健診に組み込み)、生徒ごとの経緯 tools/student-timeline.mjs と手順書 docs/runbooks/student-inquiry.md、自動処理(盤面を開いたときと基本データ変更時の再反映・起動時の自己修復・QR 提出の反映)を操作痕跡に残す(机が変わったときだけ・保存あたり 50 件)。計画 docs/plan-2026-11-09-student-tracing-and-inv-audit.md。',
    references: ['docs/plan-2026-11-08-rollback-readiness-week.md', 'docs/runbooks/feature-flag-rollback.md', 'docs/runbooks/morning-health-check.md'],
    updatedOn: '2026-11-09',
  },
  {
    id: 'auto-backup-per-classroom',
    title: '自動バックアップの取り残しを自動で消すか決める',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '教室ごとのバックアップへの切り替え(10/30)後、書きかけで残ったフォルダは 0 件だった(11/3 に Claude が数えた)。今は取り残しを「数えるだけ」の設定。',
    nextAction: '今後に備えて自動で消す設定にするかをオーナーが決める(するなら Claude が手順を案内する・急がない)。',
    notes: '2026-11-03 読み取り専用で実測: main は時点フォルダ 113・要約 176・要約の無いフォルダ 0(1 日以上前も新しいものも 0)。有効にするなら secret PROD_FUNCTIONS_ENV に WORKSPACE_BACKUP_ORPHAN_PRUNE_DRY_RUN=0 を足して Deploy Cloud Functions(オーナー作業)。secret 全文の貼り直しを避けたいなら、コードの既定を 0 に変える案もある(Claude・safe-release)。教室が増える前の重さの実測は backup-per-workspace の行。⚠️ Functions を v1.5.662 より前へ戻さない(rollback.md B-6)。仕様 docs/spec-save-restore.md §10。',
    references: ['docs/spec-save-restore.md §10', 'docs/plan-2026-10-28-per-classroom-auto-backup-handoff.md', 'functions/src/workspaceBackupLayoutConfig.ts', 'functions/src/index.ts pruneOrphanedWorkspaceBackupFolders'],
    updatedOn: '2026-11-03',
  },

  // ── まだ作っていないもの(計画あり) ──────────────────────────────────────────
  {
    id: 'issue-backlog-2026-07',
    title: '小さな改善の積み残し(8 件)',
    stage: 'planned',
    who: 'owner',
    summary: '教室追加をアプリだけで完結(#38)・消した振替を戻す画面(#39)・使っていない仕組みの撤去(#41・#43)・日程表の二重更新(#42)・出勤できない講師が置かれ続ける(#47)・残数のズレ(#48・#74)。どれも急ぎではない。',
    nextAction: 'オーナーが優先順を決め、Claude が 1 件ずつ直す。',
    references: ['Issue #38', 'Issue #39', 'Issue #41', 'Issue #42', 'Issue #43', 'Issue #47', 'Issue #48', 'Issue #74'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'parent-portal-rate-limit',
    title: '保護者ページの使いすぎ防止(全体で 1 分 30 件まで)',
    stage: 'planned',
    who: 'owner',
    summary: '保護者向け QR は 11/8 に全教室へ出した。1 人の QR あたり 1 日 10 件・教室あたり 1 時間 60 件・読み取りは 10 分 60 回の上限はあるが、全体で 1 分 30 件までの上限はまだ作っていない(今はサーバーの台数の上限で代わりにしている)。',
    nextAction: '本番で使われ始めて不審なアクセスや費用の増えが見えたら、作るかをオーナーと決める(急がない)。',
    notes: 'docs/spec-parent-portal.md §0 P-4(トークンあたり 1 日 10 件・教室あたり 1 時間 60 件)・§0-2(GET はトークンあたり 10 分 60 回のインスタンス内スロットル)・§G。全体 1 分 30 件は maxInstances: 10 で代替。2026-11-08 の全教室昇格時はこのままで出した(オーナー指示は 4 件の展開のみ)。',
    references: ['functions/src/parentPortal.ts', 'docs/spec-parent-portal.md §G'],
    updatedOn: '2026-11-08',
  },
  {
    id: 'multi-company-phase2-3',
    title: '会社ごとに別版を作る仕組み・解約時の片付け手順',
    stage: 'planned',
    who: 'owner',
    summary: '会社ごとに専用の版を作るための雛形と、会社が解約したときのデータの片付け手順がまだ無い。',
    nextAction: '2 社目の要望の大きさを見て、別版を作るかをオーナーが決めてから着手する。',
    notes: 'フォーク用 CI 雛形(T2-2〜T2-4)、workspace のオフボーディング(T3-4)。バックアップ関数の分割(P-10)は backup-per-workspace の行。',
    references: ['docs/plan-2026-09-15-multi-company-architecture.md §7/§9-9', 'docs/spec-multi-tenant.md §7'],
    updatedOn: '2026-10-30',
  },

  // ── まだ作っていないもの(保留・再開条件つき) ─────────────────────────────────
  {
    id: 'classroom-snapshot-capacity',
    title: '保存をもっと速くする(変わった所だけ送る)',
    stage: 'on-hold',
    who: 'owner',
    summary: '保存できなくなる事故(データの大きさの上限)は分割保存で解決済み。残りは保存時間を約 18 秒から数秒にする改善と、古い週の整理。',
    nextAction: '室長から「保存が遅い」と声が出たら着手する。古い週の整理は来年の講習期に測ってから決める。',
    notes: '週単位の分割保存は段階 B まで全教室(v1.5.656)。保留は段階 C(端末も変わった部品だけ送る)と段階 D(過去週のアーカイブ・第 2 段の部品分割)。容量 50% 通知 split-capacity-notice が来たら前倒し。docs/plan-2026-10-27-weekly-split-snapshot-handoff.md・spec-save-restore §9・INV-14。',
    references: ['docs/plan-2026-10-27-weekly-split-snapshot-handoff.md', 'docs/spec-save-restore.md §9', 'docs/spec-invariants.md INV-14'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'backup-per-workspace',
    title: 'バックアップ処理を会社ごとに分けて動かす',
    stage: 'on-hold',
    who: 'owner',
    summary: '教室が増えるとバックアップ 1 回にかかる時間が延びる。当面は使える時間とメモリを増やして間に合わせている。',
    nextAction: '1 回が 300 秒を超えるか 3 社目が来たら着手する(その前に Claude が重さを測る)。',
    notes: '2026-10-28 オーナー確定(Q7): 教室別化を先に、分割実行は条件つきで後回し。会社ごとの try/catch で「1 社の失敗が他社を止める」は解消済み(v1.5.662)。1 時点 約 3MB の見積りは backupRetentionEstimate.ts。',
    references: ['Issue #77', 'docs/spec-save-restore.md §10-12', 'docs/spec-multi-tenant.md §7-16'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'classroom-feature-override-o1',
    title: '教室ごとに機能を ON/OFF する仕組み',
    stage: 'on-hold',
    who: 'owner',
    summary: '今は機能を「全教室」か「会社ごと」でしか切り替えられない。',
    nextAction: '教室ごとに切り替えたいという要望が複数出たら着手する。',
    notes: '機能スイッチは当面 2 段(基本スコープ → 会社既定)。3 段目が O-1(オーナー確定 2026-09-16)。',
    references: ['docs/plan-2026-09-11-five-requests.md §4', 'docs/spec-multi-tenant.md §7-1'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'undo-redefinition',
    title: '「戻る」ボタンの作り直し',
    stage: 'on-hold',
    who: 'owner',
    summary: 'どの操作でも 1 つ前に戻せるようにする構想。今の「戻る」の不具合だけ直して保留中。',
    nextAction: 'オーナーが再開を決めたら着手する。',
    references: ['docs/plan-2026-09-11-five-requests.md §2'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'schedule-react-view',
    title: '日程表を画面の横に並べて出す',
    stage: 'on-hold',
    who: 'owner',
    summary: '別ウィンドウだとドラッグが効かないため棚上げ。今の「別タブで開く」方式で足りている。',
    nextAction: '作らないと決めるなら、Claude が仕様書に「廃止」と書いてこの行を消す。',
    notes: 'React ビュー本体のコードは既に無い(scheduleViewData.ts / scheduleViewMove.ts は別タブ方式で現役)。',
    references: ['docs/handoff-popup-sync-and-dnd.md', 'docs/spec-schedule-interactive-view.md'],
    updatedOn: '2026-10-30',
  },
  {
    id: 'perf-multi-rule-all-students',
    title: '自動割振の高速化(ルールが多く対象が全員のとき)',
    stage: 'on-hold',
    who: 'owner',
    summary: '重くなる条件の教室がまだ無いので未着手。手順書は用意してある。',
    nextAction: '室長から「重い」と声が出たら着手する。',
    references: ['docs/perf-multi-rule-optimization-handoff.md'],
    updatedOn: '2026-10-30',
  },
]
