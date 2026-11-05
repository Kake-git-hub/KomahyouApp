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
  {
    id: 'template-diff-apply',
    title: 'テンプレ保存で「変えたコマだけ」盤面に反映する',
    stage: 'development-only',
    who: 'owner',
    summary: 'テンプレを保存すると変えたコマだけを盤面に反映し、手で組んだ授業とぶつかる所は 2 行(緑)で残して室長が選べるようにする。開発用・テスト教室で試用中。',
    nextAction: '11/5 に「根本から作り直す」と決まったので、11/5 の 4 件の修正は作業ブランチに止めて本番へ出さない。新仕様が固まったら作り直す。',
    notes: '機能フラグ templateDiffApply。全教室へ出す前の条件: 旧版のタブで保存すると保留が落ちるすき間(§H Q33-1)の塞ぎ方を決めて実装 → regression-reviewer の INV 監査 → オーナー判断。2026-11-01 のオーナー決定(決定記録 51〜55): 満席は上がテンプレ・下が手入力／手置き講師の衝突は常に緑 2 段／テンプレ保存後は元に戻すを空にする(v1.5.670)。2026-11-05 のオーナー決定(決定記録 63〜・v1.5.688): 同日移動の写しは手入力として残さずテンプレ通りに戻す(11/1 の決定 53 を取り消し・例外は記録のある日と戻せない写し)／講師だけのテンプレ机では手で置いた生徒を席に残し講師だけ緑／満席の押し出しは手動追加の振替も対象(「通常」=テンプレ由来)／手置き講師がテンプレで同じコマの別の机に入るときは手置きの机を講師の保留に。確認リスト第109版(tp-59/70/71/72/73/75・mn-1)。オーナー判断待ち: A-10(同じ生徒が別の机に居るときテンプレの生徒を下の行へ置く案)の再説明・A-14(外した生徒の振替)の整理・休日解除と時限変更の追従(Q42 (b)-2/(b)-3)にも残る「下の行＝テンプレ由来」の逆転・collided の写しを「テンプレ授業を採用」で捨てた後にテンプレの位置へ戻らない件。残課題: 生徒を足すだけの保存は盤面の机がずれているとテンプレの机番号の机へ入る(仕様判断待ち)・休日解除で戻した生徒がメモの席に重なる・一括採用と孤児キーの整合チェックは未着手。開発用教室からの報告 #80(保留を解消したのに講師に保留が残る)もこの機能。決定記録は docs/spec-template-behavior.md §H と docs/plan-2026-10-25-conflict-placement.md、2026-10-30 までの詳しい経過はこのファイルの git 履歴(v1.5.666 時点の summary / nextAction)。',
    featureKeys: ['templateDiffApply'],
    references: ['Issue #72', 'Issue #75', 'docs/spec-template-behavior.md §H', 'docs/plan-2026-10-14-template-slot-change-and-transfer-follow.md', 'docs/plan-2026-10-25-conflict-placement.md', 'src/components/schedule-board/templateDiffApply.ts'],
    updatedOn: '2026-11-05',
  },
  {
    id: 'template-conflict-v2',
    title: 'テンプレ反映と手入力のぶつかりを、出自の印で単純に作り直す',
    stage: 'in-progress',
    who: 'claude',
    summary: '反映先に手入力があれば 2 行、同じ生徒なら手入力が勝つ、休みは常に勝つ、手入力は青字、丸ごと振替は同じ曜日だけで日付の付け替えとして残す、という短い規則に作り直す。講師の休みボタンも足す。',
    nextAction: '段 1〜4 を開発用・テスト教室に出した(回帰の監査 3 回・指摘は全部修正)。オーナーが確認リストの第 2 版の項目を見る。既存の保留の作り直しは確認リストの手順で進める。',
    notes: '2026-11-05 オーナー決定: 今の §H(Q21〜Q42・決定記録 66 本)は場合分けが多すぎるので置き換える。実運用で別の曜日への丸ごと振替は無い。手入力の生徒とテンプレの同じ生徒が同じコマで 2 か所になったら手入力が勝つ。生徒・講師とも休みはテンプレより勝つ(講師は休みボタンを新設・グレー表示・他の講師で上書き可)。検討点(出自の印・講師の一意性・移動先に同じ曜日のテンプレがある件・会計 3 規則・Functions のパリティ・既存データの凍結か作り直しか)は仕様の「オーナー確認」に載せる。2026-11-05 午後: 段 1・段 2 を実装(placementOrigin.ts・templateConflictRules.ts。再マージはフラグ ON の教室だけ同じ規則を当てる＝抑止キーを新しく積まない。丸ごと振替の追従 Q40 は段 4 まで今のまま)。同日夕方: 段 3 講師の休みを実装(teacherRest.ts・DeskCell.teacherRest・差分反映と再マージが同じ述語を通す・確認リスト v2-2)。同日夜: 段 4 丸ごと振替の付け替えを実装(wholeDayTransferPair.ts・組は抑止キーに相乗り・管理セルの準備で振替元のテンプレを振替先へ展開・確認リスト v2-4)。以前の形の丸ごと振替は段 5 まで今のまま。',
    references: ['docs/spec-template-conflict-v2.md', 'docs/spec-template-behavior.md §H(旧仕様)', 'src/components/schedule-board/templateDiffApply.ts'],
    updatedOn: '2026-11-05',
  },
  {
    id: 'lecture-schedule-publish',
    title: '講習の日程公開(コマ組みが終わるまで隠す)',
    stage: 'development-only',
    who: 'owner',
    summary: '講習ごとに「公開」を押すまで、提出用QRと保護者QRに講習の日程を出さない。公開すると保護者QRから講習の休み連絡もできる。開発用・テスト教室と検証環境だけで動作中。',
    nextAction: 'オーナーが確認リストで見る。全教室に出すときは、先に室長へ「公開を押すまで日程は見えない」と知らせる。',
    notes: '機能フラグ lectureSchedulePublishToggle(scope staging-environment・保護者QR parentPortalQr と同じ)。SpecialSessionRow.schedulePublished(未設定=公開・新規作成はフラグ ON のとき false)。提出用QRは App.tsx ensureScheduleSubmissionTokens → buildSubmissionOccupiedSlotMaps で非公開の講習コマを文書へ書かず、提出後の画面は resolveSubmittedViewOccupiedSlots で組まれたコマを隠す(functions の GET が schedulePublished を返す・Functions のデプロイが要る)。保護者QRは parentSchedule.ts(kind lecture・公開した講習の期間の日だけ・終了月まで「次の月」)と盤面の休み連絡(講習は 休み/振無休/何もしない)。保護者QRを全教室へ出すときはこのフラグも同じ push で広げる。オーナー確定 2026-11-03(仕様 spec-special-session-submission §B-2・spec-parent-portal §0-8)。',
    featureKeys: ['lectureSchedulePublishToggle'],
    references: ['docs/spec-special-session-submission.md §B-2', 'docs/spec-parent-portal.md §0-8', 'src/utils/submissionOccupiedSlots.ts', 'src/utils/parentSchedule.ts'],
    updatedOn: '2026-11-03',
  },
  {
    id: 'teacher-only-special-session',
    title: '講師だけが予定を出す特別講習',
    stage: 'development-only',
    who: 'owner',
    summary: '特別講習を「講師専用」で作ると、生徒日程表・生徒のQR・保護者QR・講習回数には出ず、講師日程表と講師のQRだけに出る。開発用・テスト教室と検証環境だけで動作中。',
    nextAction: 'オーナーが確認リストで見る。問題なければ、全教室に出すかオーナーが決める。',
    notes: '機能フラグ teacherOnlySpecialSession(scope staging-environment・作成欄のチェックを出すかだけ)。隠す処理はデータ SpecialSessionRow.teacherOnly で決まりフラグに依らない(isTeacherOnlySpecialSession / selectStudentFacingSpecialSessions)。オーナー確定 2026-11-03: 生徒側から全部隠す・期間はほかの講習と重ねない(今どおり)・印は作成時だけ(あとから付け外ししない)・講師専用では保護者への公開トグルを出さない。隠す場所は生徒日程表と印刷用生徒日程表(toStudentFacingScheduleParams)・生徒の提出用QRの発行(App.tsx ensureScheduleSubmissionTokens と ensureSubmissionTokens)・盤面の講習の選択(addableSpecialSessions)・未消化講習(buildLectureStockEntries)・保護者QR(parentSchedule.ts readLectureSessions と functions の写し)・Excel 取り込み。確認リストのフリーメモ 20261103-105053536-c0f31680(対応済み)。保護者QRの写しを変えたので Functions のデプロイが要る。',
    featureKeys: ['teacherOnlySpecialSession'],
    references: ['docs/spec-special-session-submission.md §B-3', 'docs/spec-parent-portal.md §0-8', 'docs/plan-2026-11-03-teacher-only-special-session-handoff.md'],
    updatedOn: '2026-11-03',
  },
  {
    id: 'parent-portal-qr',
    title: '保護者向けQR(休みの連絡)',
    stage: 'awaiting-owner',
    who: 'owner',
    summary: '生徒ごとの QR を保護者がスマホで読むと、日程の確認と休みの連絡ができる。開発用・テスト教室と検証環境で動作中で、確認はすべて OK。',
    nextAction: 'どの教室から本番で使い始めるかをオーナーが決める(決まれば 検証環境 → 1 教室 → 全教室 の順に広げる)。',
    notes: '機能フラグ parentPortalQr(scope staging-environment)。サーバー側 functions/src/parentPortal.ts の isParentPortalEnabledForClassroom と同じ判定なので、昇格は両側を同じ push で。2026-10-24 確認リスト q-1〜q-7・tp-15 OK(受付 20261024-062027562-37618588)。同じ受付のメモで今月の「次の月」ボタンを出さないように。使いすぎ防止(1 分 30 件)の要否も昇格時に決める(parent-portal-rate-limit)。',
    featureKeys: ['parentPortalQr'],
    references: ['docs/spec-parent-portal.md §0-5/§0-7/§H', 'functions/src/parentPortal.ts'],
    updatedOn: '2026-10-30',
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
    title: '保護者ページの使いすぎ防止(1 分 30 件まで)',
    stage: 'planned',
    who: 'owner',
    summary: '保護者ページへのアクセス回数の上限はまだ作っていない(今はサーバーの台数の上限で代わりにしている)。',
    nextAction: '保護者向け QR を本番に出すときに、今のままでよいかをオーナーと決める。',
    references: ['functions/src/parentPortal.ts', 'docs/spec-parent-portal.md §G'],
    updatedOn: '2026-10-30',
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
