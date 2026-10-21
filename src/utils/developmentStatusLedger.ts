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
    id: 'template-duplicate-save-guard',
    title: '日大前校のテンプレの重複(金 3限・机 4 と机 7 に同じ生徒)の案内',
    stage: 'awaiting-owner',
    summary: '確認リスト 2026-10-14 の質問「テンプレの講師が追従しない日がある」の調査で見つかった(開発用教室は日大前の写し)。オーナー指示(2026-10-14)でテンプレ編集の追加・変更・Excel 取り込み・保存の同コマ重複検査は全教室で有効になった。日大前校は次のテンプレ保存が「同じコマに同じ生徒が 2 か所に入っているため保存できません(金曜 3限: …)」で止まり、片方を外せば保存できる(11/6 以降の金 3限で机 7 の講師が落ちている症状も直る)。',
    featureKeys: ['templateDiffApply'],
    checklistItemIds: ['tp-41'],
    nextAction: 'オーナー: 日大前校へ「金曜 3限の机 7 の生徒を外して(机 4 に残す)テンプレを保存し直す」を先に案内するか、保存時の文言に任せるかを決める。',
    references: ['docs/spec-invariants.md INV-12(2026-10-14)', 'src/components/schedule-board/templateEditorGuards.ts', '受付 20261014-062117803-c223100f'],
    updatedOn: '2026-10-14',
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
    id: 'template-diff-apply',
    title: 'テンプレ保存の差分反映＋保留(2 行表示)(Issue #72)',
    stage: 'development-only',
    summary: '第 1 段の (A)(B)(C) 実装済み・開発用教室で試用中。確認リスト第 34 版(v1.5.572)の tp-1〜tp-14・tp-16 は OK(2026-09-30)。同日その他欄の指示で突き合わせを机単位から席単位(生徒 1・生徒 2 を別々)へ変更(v1.5.573・§H Q34): テンプレのその席が空なら既存の生徒は 1 行のまま残し、テンプレと同じ生徒×科目×種別は採用、同じ席がテンプレで埋まる生徒だけ下段へ。「既存を採用」は下段の席のテンプレ生徒だけ取り下げ、上段の操作で元の席が空けば下段が自動で戻る。第 35 版(v1.5.573)の結果(2026-10-02)で tp-17/18/20/21/23 は OK。要改善 2 件を v1.5.576 で対応: 保留の見せ方を席ごとに(下段の無い席は 1 行・緑なし・下段の文字は上段と同じスタイル・§H Q34-11)、丸ごと振替した日はテンプレの生徒を置かず振替を優先(§H Q35・置かなかった生徒に抑止キー)。あわせて保留の机メニュー・講師メニューの位置を実測で画面内に収めた。第 36 版(v1.5.576)は tp-19/22/24/25 とも OK(2026-10-02)。オーナー回答で v1.5.577: 保留の操作制限を席単位に(§H Q34-12)・置かなかった生徒の希望回数 −1(§H Q35-8)・保留の席のメニューを 4 択に・テンプレ編集の見出し行をボタン行へ統合。第 37 版(v1.5.577)は tp-26〜29 OK(2026-10-03)。同日のオーナー報告(重大バグ: テンプレで時限を移した生徒が移動元・移動先の両方に出る＝同日移動の写しが印として残った)とその他欄(通常同士なのに保留・生徒 1 の操作で生徒 2 が動く)で v1.5.578: 同日移動の写しはテンプレに合わせ写しの抑止キーも外す(§H Q36)・休み/振無休の記録は席の空白扱い(§H Q37)・採用の 2 択を席ごとに(§H Q26-10)・日程表の「休」に振替先日付を出さない(フラグ transferSourceRestDisplay)。(A) 機能フラグ・保留マップの全経路配線・突き合わせの純関数・保存経路の切替・在庫の走査に下段を含める。(B) 2 行表示・保留件数バッジ・採用ボタン・下段の削除/移動・2 行の机の制限。(C) 周辺処理(詰め直し・講習の講師自動割当・QR 自己修復・退塾・保護者の休み連絡)と INV-13 マトリクス。2026-10-13 オーナー報告(手動追加の通常授業がテンプレと同じ内容なのに別の机だと緑＋別の机の上段の 2 か所)で v1.5.592: 同じコマの別の机にテンプレが同じ生徒×科目を置く手動追加の通常授業はテンプレを自動採用(§H Q38・科目違い／振替・講習は緑のまま)。今ある緑は同じテンプレの再保存で片づく(実データ実測 11 件中 4 件)。同日 v1.5.593: 保留の下段の生徒を長押し D&D で動かせるように(§H Q26-8 追記・上段は従来の生徒 D&D)。2026-10-14 緑が丘校 #75 のオーナー案で v1.5.598: テンプレで変えたコマ(曜日×時限)だけ突き合わせ、違わないコマは一切触らない(§H Q39・確認モーダルに変更点一覧と「すべてのコマ」の選択・変えたコマが 0 なら全コマ)。反映開始日の既定は来週の月曜(過去日は警告)。2026-10-15 の確認リスト(受付 20261015-133308495-046ae8de)で tp-39/40/41/42/43/44/45/46/52・c-6 が OK。同受付のメモ・要改善で v1.5.602: 確認モーダルの範囲のラジオを外して自動に(§H Q39-3 改定・tp-53)、反映開始日は今日より前を選べない(min＋入力値/Excel の丸め・§H Q39-5 追記・tp-47 差し替え)、QR 自動割振りの講師と同じ講師をテンプレが同じコマの別の机に生徒つきで置くなら QR の机の講師を外す(§H Q21-9 例外 1 の絞り込み・差分反映と再マージの両方＝再マージは全教室。オーナー確定 2026-10-15「QR 重複解消を全教室に効かせたままでよい」・tp-54)。tp-47・tp-53・tp-54・c-5 は同日 OK(受付 20261015-151056959-a8890098)。残る兄弟: 手置きの同じ講師とテンプレの講師が同じコマの 2 机に出る形(報告の盤面で 4 コマ・未対応)、上段が空いた保留の QR 机が外れた後に再マージの置き先になりうる(L-3)、机番号のずれによる取りこぼし(L-4)、同じ講師かの判定が表示名一致の箇所(L-5)、読み込み時に外した分が操作ログに残らない(L-6)。',
    featureKeys: ['templateDiffApply'],
    checklistItemIds: ['tp-15', 'tp-56', 'tp-57', 'tp-58', 'tp-59'],
    nextAction: '【2026-10-21】テスト教室(テスト担当・v1.5.604・受付 20261020-092527755-56bbf675)の結果: tp-55 OK。tp-48/tp-51 は本物の不具合で v1.5.622 で修正(Q40-3 の精算済み判定を権威関数 isWholeDayTransferSettled に・Q40-1 の範囲を日単位・決定記録 40/41)、確認の画面に生徒ごとの理由(名前つき・決定記録 42・tp-58)。再発防止は人手でなく自動監査(templateLessonAccountingOracle ＋ inv06-template-save-sequences.matrix.test.ts＝操作の全順序ペア・決定記録 43)。**オーナー決定 2026-10-21**: L-5 は (a) 同じコマの別の机へ置く(v1.5.623 で実装)。手置き講師は案 B(手置き生徒が居る机だけ 2 行＝講師の重複として表す)。INV-02 の例外文の改定(範囲を曜日単位)は承認済み(台帳本文へ反映)。**残るオーナー判断**: (c) L-5 の残り＝そのコマに講師の居る空席の机が 1 つも無いときは依然として未消化 origin がフォールバック消化で食われる(監査は検出・シーケンス監査はこの形だけ許容)。候補は Q35-8 と同じ −1／時限つき origin は日付フォールバックしない。(a) tp-56 case3/tp-57(3)＝オーナー決定 B(2026-10-21): 手置き講師の机に手で置いた生徒が居るときだけ講師ごと保留(緑・下段が講師を持つ)＝§H Q41・Q21-9 例外 3。v1.5.623 で実装(権威関数 resolveManualTeacherOverlap・下段の teacher・既存を採用で講師を戻す・講師の一意性検査・自動割振りは下段の講師を居ると数える・tp-59)。**暫定 5 点(Q41-12)は要確認**: 講師だけのテンプレ机は対象外／席ごとの採用で押していない席のテンプレ生徒も手置き講師の担当／「手で置いた生徒」は Q22 の印の集合／同じコマの別の机にテンプレが同じ講師を置く形も 2 行／manualTeacherReplaced の件数表示。INV-02/INV-13 の改定案は注記(承認待ち)。(b) tp-56 case1＝同じコマに振替が生きている生徒の通常授業を置かない(Q21-11)は仕様どおり。確認の画面に理由が出るようにしたので据え置きでよいか。テスト教室で tp-48〜51・tp-58 を再確認。／緑が丘校の #75(2026-10-14)が本機能の昇格を前提にする(計画 docs/plan-2026-10-14-template-slot-change-and-transfer-follow.md §3: Q33-1・N-1・穴 8・tp-* の OK・INV 監査の後に scope を all-classrooms へ)。段 1-0(Q39・v1.5.598)の tp-44〜47 と段 2(Q40・v1.5.599)の tp-48〜51 を開発用教室(オーナー)とテスト教室(テスト担当・2026-10-15 指示)で確認。開発用教室で第 46 版(v1.5.587 据え置き・v1.5.593 配信)の tp-38(保留の下段の長押し D&D)と、第 45 版(v1.5.592 配信)の tp-36(手動追加の通常授業がテンプレと同じ内容ならテンプレの机に合わせて緑が消える・同じテンプレの再保存で今ある緑 4 件が片づく)・tp-37(科目違い・振替・講習は緑のまま)を確認。残る判断: ぶつからない形(Q21-11 前段で手置きの机に残っていた形)もテンプレの机へ寄せる線引き(Q38・決定記録 33)に異議が無いか。以下は第 38 版からの持ち越し: 開発用教室で第 38 版(v1.5.578)を試用: 同日移動の写しがテンプレに合う tp-31/tp-32(重大バグ＝テンプレで時限を移した生徒が移動元・移動先の両方に出る、の修正。§H Q36)・休みの席の手入力データを自動採用 tp-33(§H Q37)・日程表の「休」に振替先日付を出さない tp-34・採用の 2 択を席ごとに tp-35(§H Q26-10)。tp-30(講習の重複)と tp-15 も結果待ち。残るオーナー判断: 同日移動の写しのうち「テンプレがその日に持つが抑止で置かれず、席もぶつからない」写しだけ残す線引き(Q36-2)に異議が無いか。全 OK・Q33-1 のすき間(旧版タブの保存で保留が落ちる)の塞ぎ方の決定と実装・regression-reviewer の INV 監査の後、全教室へ広げるかをオーナーが判断。第 2 段(保留一覧・一括採用・孤児キーの整合チェック)は未着手。',
    references: ['docs/spec-template-behavior.md §H', 'Issue #72', 'src/components/schedule-board/templateDiffApply.ts', 'src/components/schedule-board/templatePendingResolution.ts', 'src/components/schedule-board/inv13-template-pending-scope.matrix.test.ts', 'src/components/schedule-board/templateLessonAccountingOracle.ts', 'src/components/schedule-board/inv06-template-save-sequences.matrix.test.ts'],
    updatedOn: '2026-10-21',
  },
  {
    id: 'question-ai-answer',
    title: '質問への AI 即時回答(Claude API・Haiku・承認なしで即表示・試験)',
    stage: 'development-only',
    summary: 'オーナー指示(2026-09-14)で開発用教室だけに実装(v1.5.524)。Vertex AI 経由は割り当て 0 の 429 で一度も回答できなかったため、2026-10-16 オーナー指示で Claude API 直(API キー)へ切り替え(支払い窓口が Anthropic に 1 つ増える)。同日、全教室展開(15 教室見込み・月 3,000 円以下)に向けモデルを Haiku 最新へ(1 問約 0.2 円の試算・アプリ側の回数上限なし)。同日(v1.5.609)回答の決まり(謝らない・不具合を認めない・金額を答えない・他教室を出さない)をシステム指示＋機械検査で追加し、確認用の 20 問 qa-q01〜q20 を確認リストへ。v1.5.610 で評価ワークフロー(Actions「Question AI eval」)。同日夜(v1.5.612)オーナー指示で ①モデルを Sonnet 最新へ戻し(1 問約 5 円の試算) ②「マニュアルでは〜」の他責の言い回しを禁止(指示＋機械検査) ③使い方の説明 docs/user-manual.md を骨子から本文(全 12 章・約 1.3 万字)へ拡充。同日夜(v1.5.615)オーナー採用の妥協案 B(質問に名前が出た生徒の数字と日付だけを権威関数の値で渡す・他の生徒名は機械検査で止める)と、開発中の二重回答(主 Sonnet・影 Haiku を同時に呼び aiAnswerShadow* に記録・評価ワークフローも 2 モデル比較)を実装。同日深夜(v1.5.619)オーナー確定: ①モデルは Haiku(評価 4・5 回目で Sonnet とほぼ同等・費用約 1/20)・二重回答は終了 ②「申し訳ありませんが」程度の謝罪は止めない(機械検査から謝罪語を外す) ③オーナー承認なしで室長にすぐ表示 ④開発者にはメールで回答文を知らせる(AI の結果が書かれてから送る)・訂正回答は開発者画面「質問への回答」から ⑤開発者の回答が必要なときの決まり文句は「開発者より別途回答いたします」に統一 ⑥QA の輪のオーナー承認の段も外した。本番教室へ広げる予定は決まっていない(§G-1 は「即答は作らない」)。',
    featureKeys: ['questionAiAnswer'],
    checklistItemIds: ['qa-ai-1', 'qa-ai-2', 'qa-ai-3', 'qa-ai-4', 'qa-q01', 'qa-q02', 'qa-q03', 'qa-q04', 'qa-q05', 'qa-q06', 'qa-q07', 'qa-q08', 'qa-q09', 'qa-q10', 'qa-q11', 'qa-q12', 'qa-q13', 'qa-q14', 'qa-q15', 'qa-q16', 'qa-q17', 'qa-q18', 'qa-q19', 'qa-q20', 'qa-q21', 'qa-q22', 'qa-q23'],
    nextAction: 'オーナーが Anthropic コンソールで請求登録＋API キー発行 → GitHub secret ANTHROPIC_API_KEY を追加 → Actions「Deploy Cloud Functions」を実行。開発用教室で確認リスト qa-ai-1・qa-q01〜q20(20 問)を送り、回答の中身と決まりの守られ方を確かめる。OK なら全教室へ展開する(オーナー確定 2026-10-16「開発用教室で確認後」: featureRollout の scope とサーバーの isQuestionAiAnswerEnabledForClassroom を同時に all-classrooms へ・§G-1 の例外を全教室に広げる仕様改定と同じ push)。モデルは Haiku に確定済み(2026-10-16 夜)。開発用教室で qa-ai-3(すぐ表示＋メールに回答文)・qa-ai-4(訂正回答の経路)・qa-q21〜23(自教室の生徒名に置き換え)を確認。評価ワークフロー(既定 Haiku 23 問・約 6 円)で決まり文句の言い方と謝罪の程度を見る。',
    references: ['docs/spec-developer-report.md §G-7', 'functions/src/questionAiAnswer.ts', '.github/workflows/deploy-functions.yml'],
    updatedOn: '2026-10-16',
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
    id: 'user-request-issue-75',
    title: '緑が丘校の質問 #75(実質は要望): テンプレをコマ単位で直したい・祝日/丸ごと振替の日にも追従してほしい',
    summary: 'Issue #75(2026-10-14・source:user-report・種別は質問だが中身は要望)。「12 月以降の休み・振替を手で組んだのでテンプレ(上書き)を触れない。対象 1 コマだけ変えるテンプレは作れないか。生徒の増減が祝日や丸ごと振替の日にも追従すると効率がいい」。計画: 1 コマ用テンプレは作らず、差分反映(#72・§H)の全教室昇格(段 1)＋変更点一覧などの見え方(段 1b)＋根拠を失った振替の処理と丸ごと振替先への配置(段 2・新規仕様)。祝日由来の未消化の発生は差分反映で既に追従するが、配置済みの振替と丸ごと振替の振替先は追従しない(計画 §1-3)。壁打ち 1 周目(2026-10-14)でオーナー確定: 根拠を失った振替は保存で消す／足した生徒は振替先の同じ机へ置き空きが無ければ未消化／暫定回答は LINE でオーナーが伝える。加えてオーナー案「変化のあったコマだけ差分反映する」(計画 §2-1・§H Q39)で保留を極力減らす。2 周目(同日)で確定: コマ単位・0 件は全コマ・反映開始日の既定は来週の月曜＋過去日は警告・着手順は段 1-0 → 段 2 → 昇格。段 1-0 を v1.5.598 で開発用教室へ(Q39・変更点一覧・ボタン文言・既定日。regression-reviewer の監査 H-1/H-2 と再検査 M-1/L を取り込み済み)。段 2(§H Q40)は 3 周目のオーナー確定(H〜K・2026-10-14)で v1.5.599 に実装(templateTransferFollow.ts: 根拠を失った振替は保存で消し移動元記録も消す／丸ごと振替した日に足した生徒は振替先の同じ机の空席へ振替として置き、置けなければ未消化〔休日でなければ台帳に origin 1 件＝INV-06 の唯一の例外〕)。',
    stage: 'awaiting-checklist',
    checklistItemIds: ['tp-48', 'tp-49', 'tp-50', 'tp-51', 'tp-56', 'tp-57', 'tp-58', 'tp-59'],
    nextAction: '【2026-10-21】テスト教室の結果(受付 20261020-092527755-56bbf675・v1.5.604): tp-55 OK／tp-48・tp-51 は不具合(同じ科目を同じ曜日の別の時限にも持つ生徒の追加が消える・時限変更→科目変更で旧科目の振替が残る)→ v1.5.622 で修正＋自動監査(spec-template-behavior 決定記録 40〜43)／tp-49・tp-50 は tp-48 の前提崩れと手順の説明不足→文面を直した／tp-56 case3・tp-57(3) は Q21-9 どおり(確認リストの文を直した・手置き講師の例外はオーナー判断待ち)／tp-56 case1 は Q21-11 どおり(確認の画面に理由を出すようにした)。テスト教室で tp-48〜51・tp-56〜58 を再確認。／段 1-0 の tp-44〜46 は 2026-10-15 に OK(受付 20261015-133308495-046ae8de・メモの「選択肢は不要」は v1.5.602 で反映＝tp-53)。v1.5.602 の tp-47(今日より前を選べない)・tp-53・tp-54(QR 講師の重複)も同日 OK(受付 20261015-151056959-a8890098)。オーナー: 開発用教室で tp-48〜51、テスト担当: テスト教室(test_classroom_20260507_dai)で tp-48〜51 と基本仕様の tp-55〜57(未消化数が変わらない・日程表とコマ表が一致・意図しない変更が無い)を確認(オーナー指示 2026-10-15)。テスト教室の結果は verification-checklist-report.mjs --classroom test_classroom_20260507_dai で読む。全 OK なら昇格の残課題(Q33-1・N-1・穴 8)→ INV 監査 → 全教室への昇格をオーナーが判断(#75 の緑が丘校はここで解決)。',
    references: ['Issue #75', 'Issue #72', 'Issue #69', 'docs/plan-2026-10-14-template-slot-change-and-transfer-follow.md', 'docs/spec-template-behavior.md §H'],
    updatedOn: '2026-10-21',
  },
  {
    id: 'user-report-issue-76',
    title: '緑が丘校の報告 #76: 生徒を削除して並べ替えると講師の名前が消える(修正済み v1.5.600・全教室)',
    stage: 'awaiting-checklist',
    summary: 'Issue #76(2026-10-15・source:user-report・type:bug)。triage(2026-10-15): 想定外。並べ替えで下へ動いたテンプレ由来の講師だけの机を、次のテンプレ再マージ(教室の開き直し・次の生徒削除・基本データ/教室設定の変更の effect)が「同じ机番号の盤面の机に授業があれば消費済み」とみなして戻さず講師を消していた(mergeManagedWeek の consumedManagedTeacherIndexes・pack / seat とも・削除は必要条件でない)。オーナー承認(同日「修正に進めて、すぐに全校展開して」)で v1.5.600 に修正(フラグなし・全教室): テンプレ(抑止後)のそのコマに同じ講師の講師だけの机があり、他の机に同じ講師が居らず、削除記録でもなければ机番号に関係なく今の机に残す。兄弟の「再マージで講師が前の空き机へずれる」(INV-02 L-7 ②)も止まる。INV-02 マトリクスに 9 件、INV-12 の L-7 兄弟 2 の並びの期待を改定(台帳に記録)。',
    checklistItemIds: [],
    nextAction: '確認リスト tp-52 は 2026-10-15 に OK(受付 20261015-133308495-046ae8de)。オーナーが Issue #76 をクローズし、室長へ「直った」と伝える(その後この行を消す)。すでに講師が消えてしまった週は、講師セルから手で置き直す(手置きは再マージで消えない)。',
    references: ['Issue #76', 'CHANGELOG v1.5.600', 'docs/spec-invariants.md INV-02(2026-10-15)', 'src/components/schedule-board/ScheduleBoardScreen.tsx mergeManagedWeek'],
    updatedOn: '2026-10-15',
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
    title: '2 社目の受け入れ準備(P-1〜P-8・P-11 実装済み / P-9 予行演習・P-0・請求許可者 第 2 段が残り)',
    stage: 'awaiting-owner',
    summary: '2026-10-10 に P-1(会社別プロファイル)・P-2(タブ名)・P-3(multi-site)・P-4(会社別配信 CI)・P-5/P-12(workspace 新設ツール)・P-6/P-7/P-8(runbook・Excel 雛形)・P-11(会社宛請求 ①〜③・④ 第 1 段)を main へ。残り: P-9 staging での予行演習(オーナー + Claude・runbook §10 に記録)、P-0(薬円台校の削除後の記述整理・オーナーの削除待ち)、請求許可者の第 2 段(オーナーが会員文書に billingAllowed を立ててからメール固定を撤去)。',
    nextAction: 'オーナーが staging に架空の会社 demo で予行演習(runbook §2〜§10)を 1 周し、所要時間と詰まりを §10 の表へ。並行して確認リスト mc-1(タブ名)を開発用教室で確認。',
    checklistItemIds: ['mc-1'],
    references: ['docs/plan-2026-09-18-second-company-onboarding.md §3/§8', 'docs/runbooks/company-onboarding.md', 'docs/spec-multi-tenant.md §11-1/§12/§13'],
    updatedOn: '2026-10-10',
  },
  {
    id: 'multi-company-phase2-3',
    title: '複数会社展開 Phase 2〜3 の残り(フォーク雛形・バックアップ関数の棟分割 P-10・オフボーディング T3-4)',
    stage: 'planned',
    summary: 'Phase 2 の multi-site(T2-1)と Phase 3 の新設ツール(T3-1)・会社宛請求(T3-3)は 2 社目受け入れ準備(P-3/P-5/P-11)として 2026-10-10 に実装済み。残りはフォーク用 CI 雛形(T2-2〜T2-4・フォークを切る判断が出てから)、バックアップ関数の棟分割(P-10・15 教室に近づく前)、workspace のオフボーディング手順(T3-4)。',
    nextAction: '2 社目の要望の大きさを見てフォークを切るか決める(計画 §6 の基準)。P-10 は教室数の推移を見て別 Issue で着手。',
    references: ['docs/plan-2026-09-15-multi-company-architecture.md §7/§9-9', 'docs/spec-multi-tenant.md §7'],
    updatedOn: '2026-10-10',
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
