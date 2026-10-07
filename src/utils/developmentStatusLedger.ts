// 開発ダッシュボード(開発者画面)に出す【進行中テーマの台帳】= この 1 ファイルが唯一の正本。
// 正本仕様: docs/spec-developer-report.md §E-3。起点は途中作業の洗い出し docs/review-2026-09-25-work-in-progress-inventory.md。
//
// ★何を載せるか
//   「開発用教室だけで止まっているもの」「作りかけで止まっているもの」「オーナーの判断・確認を待っているもの」
//   「計画はあるが未着手のもの」「保留にしたもの」を **1 テーマ 1 行**で持つ。完了(全教室へ昇格・マージ済み)した
//   テーマは**載せない**(確認リストと同じ運用 = 終わったものは git 履歴に残る)。
//
// ★いつ更新するか(CLAUDE.md「新機能追加・修正のたびに確認リストを必ず更新」と同じ扱い)
//   - 機能フラグの scope を変えた(昇格した)・ブランチをマージした・保留を解除した → その行を書き換えるか消す。
//   - 新しい先行機能・作りかけの作業・オーナー判断待ちが生まれた → 行を足す。
//   - 機能フラグと紐づく行は、フラグの scope と stage が食い違うと developmentStatusLedger.test.ts が落ちる
//     (昇格したのに「開発用教室で先行中」のまま残るのを防ぐ)。
//
// このファイルは純データのみ(import は型と featureRollout のキー型だけ)。DOM / ネットワークには触らない。

import type { FeatureRolloutKey } from './featureRollout'

/**
 * テーマの段階。
 *  - development-only … 開発用教室(検証用教室)だけで動いている先行機能。次は確認リスト or 昇格判断。
 *  - awaiting-checklist … 実装済みで、確認リストの結果(OK/要改善)を待っている。
 *  - awaiting-owner … 実装や調査は済んでいて、オーナーの判断(昇格・許可・回答)を待っている。
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
  'in-progress': '作業中(未マージ)',
  planned: '未着手(計画あり)',
  'on-hold': '保留',
}

export type DevelopmentStatusEntry = {
  /** 一意の識別子(英小文字とハイフン)。 */
  id: string
  /** 画面に出す短い題名。 */
  title: string
  stage: DevelopmentStatusStage
  /** 何が済んでいて何が残っているか(1〜3 文)。 */
  summary: string
  /** 紐づく機能フラグ(featureRollout.ts のキー)。scope と stage の整合はテストで固定。 */
  featureKeys?: readonly FeatureRolloutKey[]
  /** 紐づく確認リストの項目 id(verificationChecklist.ts)。版が変わると id も変わるので参考情報。 */
  checklistItemIds?: readonly string[]
  /** 次の一手(誰が何をするか)。 */
  nextAction: string
  /** 根拠(docs のパス・Issue 番号・ブランチ名など)。 */
  references: readonly string[]
  /** この行を最後に見直した日(YYYY-MM-DD)。 */
  updatedOn: string
}

export const DEVELOPMENT_STATUS_LEDGER: readonly DevelopmentStatusEntry[] = [
  // ── 開発用教室だけで動いている先行機能 ──────────────────────────────────────
  {
    id: 'transfer-source-rest-display',
    title: '振替元「休)」表示・丸ごと振替/休日設定の記録保持',
    stage: 'awaiting-owner',
    summary: '実装済み(v1.5.539・2026-09-16・INV-06/INV-05)。r-1〜r-8 は OK。A→B→C の再移動で日付が追いつかない件(v1.5.556 で修正)の確認 t-1 も OK(2026-09-28)。',
    featureKeys: ['transferSourceRestDisplay'],
    nextAction: 'staging → 全教室への昇格をオーナーが決める。',
    references: ['docs/spec-makeup-stock.md', 'CHANGELOG v1.5.556'],
    updatedOn: '2026-09-28',
  },
  {
    id: 'student-withdraw-auto-sweep',
    title: '退塾の自動掃除・高3卒業の退塾日 自動入力',
    stage: 'awaiting-owner',
    summary: '実装済み(v1.5.553〜554・2026-09-20/21)。室長の確認なしに実データを書き換えるため開発用教室限定で先行。本番 3 教室の初回対象は 0 名(2026-09-21 実測)。確認 b-2 / b-3 は OK(2026-09-28)。',
    featureKeys: ['studentWithdrawAutoSweep'],
    nextAction: '全教室への昇格をオーナーが決める。',
    references: ['docs/spec-basic-data.md §B/§H'],
    updatedOn: '2026-09-28',
  },
  {
    id: 'parent-portal-qr',
    title: '保護者向け固定QR(休み連絡専用)',
    stage: 'awaiting-checklist',
    summary: '第1段を実装(v1.5.513・2026-09-13)。2026-09-18 に「休み連絡」専用へ改定(§0-5・v1.5.550)。クライアントとサーバーの両側に同じ判定があり、昇格は両側同時に行う。',
    featureKeys: ['parentPortalQr'],
    checklistItemIds: ['q-1', 'q-2', 'q-3', 'q-4', 'q-5', 'q-6'],
    nextAction: 'q-1〜q-6 の結果を待つ。OK なら staging 実機 → 本番 1 教室(オーナー指定) → 全教室の順(§H)。',
    references: ['docs/spec-parent-portal.md §0-5/§H', 'functions/src/parentPortal.ts'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'holiday-return-manual-added',
    title: '休日設定で手で追加したコマも未消化へ返す(Issue #73・日大前校の質問)',
    stage: 'awaiting-checklist',
    summary: '実装済み(v1.5.579・2026-10-07・INV-06)。休日設定だけ、手動追加の通常・増コマ・振替を未消化振替へ、手動追加の講習を未消化講習へ返す(「休み」と同じ扱い。フラグ無しで全教室)。全コマ削除・コマ 1 つずつの削除は従来どおり返さない。過去の休日(10/12)には遡及しない(室長了承)。',
    checklistItemIds: ['hm-1', 'hm-2', 'hm-3', 'hm-4'],
    nextAction: 'hm-1〜hm-4 の結果を待つ。OK ならこの行を消し、オーナー確認後に Issue #73 をクローズ(室長への回答は開発者画面「質問への回答」から・計画書 §6 の文案)。',
    references: ['docs/plan-2026-10-07-holiday-return-manual-added.md', 'docs/spec-makeup-stock.md §B-2-2b/§B-3/§B-4', 'Issue #73', 'CHANGELOG v1.5.579'],
    updatedOn: '2026-10-07',
  },
  {
    id: 'lesson-history',
    title: '講習履歴(生徒日程表タブの「講習履歴」ボタン)',
    stage: 'awaiting-owner',
    summary: '実装済み(v1.5.502・2026-09-12・H-1〜H-4)。確認リストの h-1〜h-10 は OK 済み(Issue #63〜#66・第10版)。全教室へ出すかの判断が未定。',
    featureKeys: ['lessonHistory'],
    nextAction: 'オーナーが昇格を決めたら scope を all-classrooms へ(functions は読み取りのみなので片側昇格の非対称は無い)。',
    references: ['docs/plan-2026-09-11-five-requests.md §6'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'board-based-planned-count',
    title: '生徒日程表の通常回数(予定数)を盤面ベースで数える(INV-05 Step2)',
    stage: 'awaiting-owner',
    summary: 'オーナー確定 2026-08-05 で開発用教室に導入(v1.5.471・2026-08-07)したまま 7 週間止まっている。ON にすると過去月の数字が動くため段階導入(開発用 → staging → 全教室)。確認リストの項目は未作成。',
    featureKeys: ['boardBasedPlannedCount'],
    nextAction: '開発用教室で数字を見比べる確認項目を確認リストへ足し、OK なら staging → 全教室へ。',
    references: ['docs/spec-invariants.md INV-05'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'template-diff-apply',
    title: 'テンプレ保存の差分反映＋保留(2 行表示)(Issue #72)',
    stage: 'development-only',
    summary: '第 1 段の (A)(B)(C) 実装済み・開発用教室で試用中。確認リスト第 34 版(v1.5.572)の tp-1〜tp-14・tp-16 は OK(2026-09-30)。同日その他欄の指示で突き合わせを机単位から席単位(生徒 1・生徒 2 を別々)へ変更(v1.5.573・§H Q34): テンプレのその席が空なら既存の生徒は 1 行のまま残し、テンプレと同じ生徒×科目×種別は採用、同じ席がテンプレで埋まる生徒だけ下段へ。「既存を採用」は下段の席のテンプレ生徒だけ取り下げ、上段の操作で元の席が空けば下段が自動で戻る。第 35 版(v1.5.573)の結果(2026-10-02)で tp-17/18/20/21/23 は OK。要改善 2 件を v1.5.576 で対応: 保留の見せ方を席ごとに(下段の無い席は 1 行・緑なし・下段の文字は上段と同じスタイル・§H Q34-11)、丸ごと振替した日はテンプレの生徒を置かず振替を優先(§H Q35・置かなかった生徒に抑止キー)。あわせて保留の机メニュー・講師メニューの位置を実測で画面内に収めた。第 36 版(v1.5.576)は tp-19/22/24/25 とも OK(2026-10-02)。オーナー回答で v1.5.577: 保留の操作制限を席単位に(§H Q34-12)・置かなかった生徒の希望回数 −1(§H Q35-8)・保留の席のメニューを 4 択に・テンプレ編集の見出し行をボタン行へ統合。第 37 版(v1.5.577)は tp-26〜29 OK(2026-10-03)。同日のオーナー報告(重大バグ: テンプレで時限を移した生徒が移動元・移動先の両方に出る＝同日移動の写しが印として残った)とその他欄(通常同士なのに保留・生徒 1 の操作で生徒 2 が動く)で v1.5.578: 同日移動の写しはテンプレに合わせ写しの抑止キーも外す(§H Q36)・休み/振無休の記録は席の空白扱い(§H Q37)・採用の 2 択を席ごとに(§H Q26-10)・日程表の「休」に振替先日付を出さない(フラグ transferSourceRestDisplay)。(A) 機能フラグ・保留マップの全経路配線・突き合わせの純関数・保存経路の切替・在庫の走査に下段を含める。(B) 2 行表示・保留件数バッジ・採用ボタン・下段の削除/移動・2 行の机の制限。(C) 周辺処理(詰め直し・講習の講師自動割当・QR 自己修復・退塾・保護者の休み連絡)と INV-13 マトリクス。',
    featureKeys: ['templateDiffApply'],
    checklistItemIds: ['tp-15', 'tp-30', 'tp-31', 'tp-32', 'tp-33', 'tp-34', 'tp-35'],
    nextAction: '開発用教室で第 38 版(v1.5.578)を試用: 同日移動の写しがテンプレに合う tp-31/tp-32(重大バグ＝テンプレで時限を移した生徒が移動元・移動先の両方に出る、の修正。§H Q36)・休みの席の手入力データを自動採用 tp-33(§H Q37)・日程表の「休」に振替先日付を出さない tp-34・採用の 2 択を席ごとに tp-35(§H Q26-10)。tp-30(講習の重複)と tp-15 も結果待ち。残るオーナー判断: 同日移動の写しのうち「テンプレがその日に持つが抑止で置かれず、席もぶつからない」写しだけ残す線引き(Q36-2)に異議が無いか。全 OK・Q33-1 のすき間(旧版タブの保存で保留が落ちる)の塞ぎ方の決定と実装・regression-reviewer の INV 監査の後、全教室へ広げるかをオーナーが判断。第 2 段(保留一覧・一括採用・孤児キーの整合チェック)は未着手。',
    references: ['docs/spec-template-behavior.md §H', 'Issue #72', 'src/components/schedule-board/templateDiffApply.ts', 'src/components/schedule-board/templatePendingResolution.ts', 'src/components/schedule-board/inv13-template-pending-scope.matrix.test.ts'],
    updatedOn: '2026-10-03',
  },
  {
    id: 'question-ai-answer',
    title: '質問への AI 即時回答(Vertex AI・試験)',
    stage: 'development-only',
    summary: 'オーナー指示(2026-09-14)で開発用教室だけに実装(v1.5.524)。本番教室へ広げる予定は決まっていない(§G-1 は「即答は作らない」)。',
    featureKeys: ['questionAiAnswer'],
    nextAction: '試験を続けるか本番へ出すかをオーナーが決める。出すときはクライアントとサーバーを同時に変える。',
    references: ['docs/spec-developer-report.md §G-7', 'functions/src/questionAiAnswer.ts'],
    updatedOn: '2026-09-25',
  },

  // ── 実装済み・確認リスト結果待ち ──────────────────────────────────────────

  // ── 作りかけ(未マージのブランチ) ────────────────────────────────────────────
  {
    id: 'contract-baseline-arch',
    title: '株式会社アーチとの契約時環境の固定と復旧計画',
    stage: 'in-progress',
    summary: 'ブランチ claude/arch-contract-recovery-plan-m7765e(2026-09-19・5 コミット・未マージ)。release タグ自動付与・stable の印・復旧ワークフロー・runbook を追加する内容。契約時タグの push はオーナー作業。',
    nextAction: 'オーナーが内容を確認し、マージするか破棄するかを決める(CI ワークフローを増やすので慎重に)。',
    references: ['claude/arch-contract-recovery-plan-m7765e', 'docs/runbooks/contract-baseline-arch.md(ブランチ内)'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'ui-text-review',
    title: '室長・保護者向け画面の文言棚卸し(Excel・オーナー記入欄つき)',
    stage: 'in-progress',
    summary: 'ブランチ claude/stoic-carson-srb4tr(2026-09-19・4 コミット・docs のみ・未マージ)。保護者画面から社内用語を排除する修正案を記入済み。',
    nextAction: 'オーナーが Excel に可否を記入 → 反映する実装テーマを起票する。',
    references: ['claude/stoic-carson-srb4tr', 'docs/ui-text-review-2026-09-18.md(ブランチ内)'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'stale-branches-2026-06',
    title: '古いリモートブランチの削除(3 本は破棄と決定済み・削除操作だけ残り)',
    stage: 'awaiting-owner',
    summary: '2026-09-28 オーナー判断で 6 月の 3 本(ci/functions-deploy-409-targeted・claude/test-procedure-docs-tm1y8t・agents/feature-data-integrity-checks)は取り込まず破棄(いずれも main で別対応済み／役目終了)。PR #31 はクローズ済み。Claude のクラウド環境は作業ブランチ以外へ push できないため、リモートからの削除だけ残っている。',
    nextAction: 'オーナーが Actions →「Delete stale branches」を Run workflow(まず dry_run=true で一覧確認 → false で実行)して 3 本とマージ済み 45 本を削除する。済んだらこの行とワークフローを消す。',
    references: ['PR #31', '.github/workflows/delete-stale-branches.yml', 'docs/review-2026-09-25-work-in-progress-inventory.md §3'],
    updatedOn: '2026-09-28',
  },

  // ── オーナー判断待ち(Issue) ─────────────────────────────────────────────────
  {
    id: 'user-question-issue-69',
    title: '緑が丘校からの利用者質問(丸ごと振替後に入った生徒の日付)',
    stage: 'awaiting-owner',
    summary: 'Issue #69(2026-09-16・source:user-report)。利用者報告 Issue は勝手に修正を始めない(オーナー指示 2026-09-04)。オーナーから「今日までの質問はすべて LINE で対応済み」(2026-09-28)。',
    nextAction: 'LINE で対応済みなら、オーナーが Issue #69 をクローズし、「質問への回答」で該当の報告を「解決済みにする」。',
    references: ['Issue #69', 'docs/spec-developer-report.md §E'],
    updatedOn: '2026-09-28',
  },
  {
    id: 'user-question-issue-70',
    title: '緑が丘校からの利用者質問(振替を動かし直したときの振替日表示)と講師日程共有の日付ズレ',
    stage: 'awaiting-owner',
    summary: 'Issue #70(2026-09-26・source:user-report)。「講師日程共有で振替先日付が追従しない」の修正(v1.5.558)は確認 t-2 で OK(2026-09-28)。オーナーから「今日までの質問はすべて LINE で対応済み」(2026-09-28)。',
    nextAction: 'オーナーが Issue #70 をクローズし、「質問への回答」で該当の報告を「解決済みにする」。',
    references: ['Issue #70', 'CHANGELOG v1.5.558'],
    updatedOn: '2026-09-28',
  },
  {
    id: 'checklist-issues-cleanup',
    title: '確認リスト由来の Issue #62〜#66 のクローズ',
    stage: 'awaiting-owner',
    summary: '2026-09-13 に「確認リストは Issue を起票しない」へ変えた前に自動起票された 5 件。中身の項目はすべて対応済みで、記録としてだけ残っている。',
    nextAction: 'オーナーがクローズする(内容は git 履歴と確認リストの版に残る)。',
    references: ['Issue #62', 'Issue #63', 'Issue #64', 'Issue #65', 'Issue #66'],
    updatedOn: '2026-09-25',
  },

  // ── 未着手(計画あり) ────────────────────────────────────────────────────────
  {
    id: 'second-company-onboarding',
    title: '2 社目の受け入れ準備 P-1〜P-12',
    stage: 'planned',
    summary: '計画第 3 版(2026-09-18)でオーナー回答済み(タブ名は「コマ表アプリ_教室名」・薬円台削除と請求許可者切替は了承)。実装は未着手。P-0(薬円台削除後の記述整理)はオーナーの削除実施待ち。',
    nextAction: 'P-1(プロファイルの会社別選択) → P-2(タブ名) → P-3(multi-site) の順で着手する。',
    references: ['docs/plan-2026-09-18-second-company-onboarding.md §3/§8'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'multi-company-phase2-3',
    title: '複数会社展開 Phase 2(フォーク・CI 分離)/ Phase 3(会社合算請求・workspace 新設ツール)',
    stage: 'planned',
    summary: 'Phase 0・1 は完了(2026-09-18)。Phase 2 以降は「2 社目が具体化してから」(オーナー確定 2026-09-16)。バックアップ関数の棟分割(P-10)は 15 教室に近づく前に別枠で着手。',
    nextAction: '2 社目の要望の大きさを見てフォークを切るか決める(Phase 1 完了時の立ち止まり)。',
    references: ['docs/plan-2026-09-15-multi-company-architecture.md §7/§9-9', 'docs/spec-multi-tenant.md §7'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'issue-backlog-2026-07',
    title: '7 月の改善バックログ(Issue #38/#39/#41/#42/#43/#47/#48)',
    stage: 'planned',
    summary: '教室追加のアプリ内完結(#38)・削除した未消化振替の復帰 UI(#39)・managers 配管の撤去(#41)・日程表ポップアップ二重同期(#42)・旧 QR デッドコード(#43)・出勤不可講師の赤配置(#47)・講習ストック相殺の残数ズレ(#48)。いずれも severity s3。',
    nextAction: '優先順をオーナーと決めて 1 件ずつ dev-fix へ。',
    references: ['Issue #38', 'Issue #39', 'Issue #41', 'Issue #42', 'Issue #43', 'Issue #47', 'Issue #48'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'parent-portal-rate-limit',
    title: '保護者ページ API の全体レート制限(1 分 30 件)',
    stage: 'planned',
    summary: 'functions/src/parentPortal.ts に「未実装(maxInstances で代替)」と明記。保護者 QR を本番へ広げる前に要否を決める。',
    nextAction: '保護者 QR の昇格判断と同時に、maxInstances のままでよいか決める。',
    references: ['functions/src/parentPortal.ts', 'docs/spec-parent-portal.md §G'],
    updatedOn: '2026-09-25',
  },

  // ── 保留(オーナー判断・再開条件つき) ────────────────────────────────────────
  {
    id: 'classroom-feature-override-o1',
    title: '教室別オプション基盤 O-1 / 容易度 A 機能のオプション登録 O-2',
    stage: 'on-hold',
    summary: '機能スイッチは当面 2 段(基本スコープ → 会社既定)。教室単位の要望が増えたら 3 段目(O-1)へ(オーナー確定 2026-09-16)。',
    nextAction: '教室単位の ON/OFF 要望が複数出たら再開する。',
    references: ['docs/plan-2026-09-11-five-requests.md §4', 'docs/spec-multi-tenant.md §7-1'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'undo-redefinition',
    title: '戻るボタンの再定義(統一 undo・U-1〜U-6)',
    stage: 'on-hold',
    summary: 'オーナー判断 2026-09-11 で保留。現行バグの疑い U-0 だけ修正済み(u0-1〜u0-5 OK)。',
    nextAction: '再定義を再開するときは §2-3 の障害・影響から読み直す。',
    references: ['docs/plan-2026-09-11-five-requests.md §2'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'schedule-react-view',
    title: '対話用日程表の React 化(ドック/ポップアウト)',
    stage: 'on-hold',
    summary: '2026-07-08 に棚上げ(別ウィンドウへの portal で D&D の drop が届かない)。React ビュー本体のコードは既に無く、scheduleViewData.ts / scheduleViewMove.ts は別タブ方式のコマ組み・日程表で現役。同期とコマ組みは別タブ方式で全教室へ展開済み。',
    nextAction: '再開しない方針なら spec-schedule-interactive-view.md と handoff 文書に「廃止」と書き、spec-index の「未実装」表記を直す。',
    references: ['docs/handoff-popup-sync-and-dnd.md', 'docs/spec-schedule-interactive-view.md'],
    updatedOn: '2026-09-25',
  },
  {
    id: 'perf-multi-rule-all-students',
    title: '多ルール×「全員」対象の自動割振の性能最適化',
    stage: 'on-hold',
    summary: '発火条件(実運用で多ルール×全員の教室が出て体感が悪化)を満たしていないため未着手。手順書は用意済み。',
    nextAction: '室長から「重い」報告が来たら docs/perf-multi-rule-optimization-handoff.md に従って着手する。',
    references: ['docs/perf-multi-rule-optimization-handoff.md'],
    updatedOn: '2026-09-25',
  },
]
