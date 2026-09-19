# 更新リスト (CHANGELOG)

コマ表アプリの変更履歴。**編集ごとに必ず追記する**(回帰防止の記録)。
運用ルールは `.claude/skills/solo-git-workflow/SKILL.md` の「編集前チェックと更新リスト」を参照。

- バージョンは CI が main への push ごとに自動で patch +1 する。**手動で `package.json` を書き換えない。**
- 作業中は `## 未リリース` に1行ずつ追記する。
- main にマージ(= デプロイ)する直前に `## 未リリース` を、次にデプロイされる版
  (`= package.json の version の patch +1`)でラベル付けし、新しい空の `## 未リリース` を上に作る。
- 書式: `- <種別>: <何を・なぜ>`(種別 = `feat` / `fix` / `refactor` / `style` / `docs` / `chore`)。
  触ったファイル名や関連コミットIDを括弧で添えると後追いが速い。

---

## 未リリース

- chore: 復旧の戻し先を「直近の正常版」主経路へ(オーナー方針 2026-09-19)。本番デプロイ CI が毎リリース `release/vX.Y.Z` タグを自動付与(デプロイ成功後・失敗しても run は緑のまま)、オーナーが確認できた版へ `stable` の印を進める手動ワークフロー `.github/workflows/mark-stable.yml` を追加(ライブ version.json から自動判定・main の履歴外と契約時タグへは進めないガードつき)。復旧は stable → release/vX.Y.Z → 契約時タグの三段で選べる。Runbook §3-0 と rollback.md A 節に戻し先の選び方、§4-1b にオフライン控えの定期運用(Drive for desktop の PC 同期＋月次 JSON 書き出し)、§5 に定期作業表を追記。テストは `tools/restore-baseline-workflow.test.mjs` を拡張(release タグ付与・stable の手動限定・床を動かさないガード・main 履歴チェック)。Runbook §4 にオーナー作業の実施順(マージ→タグ→控え→訓練→stable 初回記録)、スマホだけでタグを作る手順(Releases 画面)、stable は「マージ後のデプロイ後」でないと release タグが無く止まる注意、訓練後に staging を最新へ戻す手順を追記。アプリのコード変更なし。

- chore: 株式会社アーチとの契約時環境を固定(オーナー指示 2026-09-19)。Git タグ `contract/arch-2026-09-19`(v1.5.552・48e9e19)を基準点にし、タグから Hosting/Functions/ルールを main を触らず出し直す手動ワークフロー `.github/workflows/restore-baseline.yml`(staging 訓練可・本番は confirm 文字列で fail-closed)と Runbook `docs/runbooks/contract-baseline-arch.md`(定義台帳・症状別復旧計画・オーナー作業チェックリスト・訓練記録・基準点更新ルール)を追加。rollback.md に D 節、CLAUDE.md に参照を追記。アプリのコード変更なし。
- chore: 契約時環境の復旧ワークフローが通常デプロイとズレるのを CI で検知するテストを追加(`tools/restore-baseline-workflow.test.mjs`・新 secret/必須 VITE 変数の取り込み漏れ・push 発火・main 書き換え・confirm ガードを固定)。Runbook に Hosting 保持世代 5→30 の料金実測(dist 4.72MB・30 世代最大 142MB=無料枠 10GB の 1.4%・転送量は不変)と §8「今後の改造との関係」(データ移行・functions の --force・ルール・multi-site の 5 つの干渉点と守り方)を追記。

## v1.5.552 (2026-09-19)

- feat: 盤面ツールバー「通常授業テンプレ作成」の右に「保護者連絡」ボタンを追加(オーナー指示 2026-09-19)。保護者QRからの休み連絡の履歴を受信日時の新しい順に一覧し、モーダルで処理したものに「確認済」(保存前は「確認済(保存待ち)」)を表示。確認済は直近 10 件まで(古いものは見た目上だけ消す)。未確認の行を押すと既存の休み連絡モーダル(四択)が開く=処理経路は増やさない(INV-06)。履歴は別購読(createdAt 降順・limit 50・複合インデックス不要)で読み、未処理の権威は従来の購読のまま。教室の絞り込み・cleanup は既存と同じ(INV-08)。フラグ parentPortalQr(開発用教室＋staging)限定。functions/ルール変更なし。確認リスト q-6 (parentMessages.ts buildParentContactHistory / parentPortal.ts subscribeParentMessageHistory / ParentContactHistoryModal.tsx / BoardToolbar.tsx / App.tsx)

<!-- ここに編集内容を1行ずつ追記する -->

## v1.5.551 (2026-09-19)
- docs: 保証台帳 `docs/spec-invariants.md` へ追記(オーナー承認 2026-09-19・保証文の改定なし＝準拠経路と注記の追加のみ)。INV-06 に「出欠を自動で付ける経路は既存メニューの本体へ委譲する(保護者の休み連絡 `parentAbsenceRequest`)」、INV-03 に一過性コマンドが 3 種になったことと「週ジャンプ待ちの 2 段階」の形、INV-02 に「保存前の反映を外部状態が跨ぐ」型の注記(保存した盤面で裏を取るので undo を個別に追わない)。

## v1.5.550 (2026-09-19)
- feat: 保護者QRを**「休み連絡」専用**へ作り替え(オーナー指示 2026-09-18・開発用教室＋staging 限定のまま・docs/spec-parent-portal.md §0-5・**INV-06 / INV-08 / INV-03 / INV-11**)。着手前に懸案 4 点をオーナーと確定: ①来月は出さない(先月・今月だけ。月またぎは電話) ②当日も受け付け、室長が四択を押したら保護者ページに「教室確認済」を出す ③「振替先を今決める」= 休みにして未消化振替へ戻してから振替配置モードへ(途中でやめても休みは残る) ④処理済みにするのは**盤面を保存できた時点**(「何もしない」だけ即時。保存前に閉じたら次回もう一度通知)。
  - 盤面側: 文面モーダルを四択モーダル(休み／振無休／振替先を今決める／何もしない)へ置換。盤面を変える 3 種は App→盤面の一過性コマンド `parentAbsenceRequest`(INV-03・Issue #46 同型: 結果を必ず返し App が消費)になり、盤面は対象日の週へ移動 → 純関数 `resolveParentAbsenceTarget` で本人の席を特定 → **メニューの「休み」「振無休」と同じ 1 本の処理**(`markStudentAbsentAt` / `markStudentAbsentNoMakeupAt` へ切り出し・INV-06 の会計経路を増やさない)を呼ぶ。席が無い・テンプレ編集中は盤面を変えず理由を表示。「振替先を今決める」は続けて既存の `handleSelectMakeupStockEntry`(振替元日付つき)へ入る。
  - 保存非対称の防止(QR提出反映と同型の穴を作らない): 四択で反映した連絡は「保存待ち」に積み、保存の成功点(`saveClassroomSnapshotViaFunction` 直後)で**保存した教室・その保存のスナップショット作成時刻以前の分だけ** `stage:'notified'` を送る(50 件分割・失敗分は戻す)。教室切替/ログアウト/フラグ OFF と、教室データの丸ごと差し替え(`boardMountKey`=開き直し・復元・直前に戻す)で保存待ちを捨て、連絡を一覧へ戻す(INV-08)。購読は毎回「未処理の全件」を受け取る形へ変更。
  - (src/utils/parentMessages.ts・src/components/schedule-board/parentAbsenceTarget.ts(新規)・ScheduleBoardScreen.tsx・src/components/parent-portal/ParentMessagesModal.tsx・src/integrations/firebase/parentPortal.ts・src/App.tsx・src/App.css・テスト parentMessages.test.ts / parentAbsenceTarget.test.ts / parentAbsenceRequest.wiring.test.ts / parentPortal.wiring.test.ts / integrations parentPortal.test.ts・parentMakeupPlacement.test.ts・確認リスト q-1〜q-5 追加(版 v1.5.540 据え置き))
  - サーバー＋保護者ページ: 表示は先月・今月だけ(`PARENT_SCHEDULE_MONTHS_AFTER = 0`)。「教室へ連絡」の自由記述欄とお名前欄を廃止し、今日以降の通常・振替・増コマの行(「予定」印を含む)をタップ → 確認モーダル(当日は電話の案内を追加)→ 送信。連絡済みの行は「休み連絡済」→ 室長が四択を押すと「教室確認済」。POST は `{dateKey, slotNumber}` だけで、科目・種別はサーバーが日程計算から引く(共有純関数 `isParentLessonAbsenceReportable` をサーバー検証とページの両方で使う)。検証順 400 → 409(対象コマ)→ 409(既に連絡あり)→ 429 → `create()`。文書 ID は決定的 `abs-{トークン指紋}-{日付}-{限}`(二重連絡を原子的に弾く。生徒 ID `sNNN` は欠番再利用のため鍵にしない)。GET は `absenceKey` の単一フィールド範囲条件だけで状態を引く(複合インデックス不要)。回数制限はトークン 1 日 5 → 10 件。`markParentMessagesNotified` に `stage`(`acknowledged` / `notified`・省略は旧互換の notified)と `resolution` を追加(新しい関数は作らない)。(functions/src/parentPortal.ts・functions/src/index.ts・src/utils/parentSchedule.ts ＋ generated・ParentPortalPage.tsx・parentPortalPageModel.ts)
  - regression-reviewer の監査(ブロッカーなし・「休み/振無休」の切り出しは機械照合で挙動同一)を受けて同じ push で修正: (a) **処理済みにするのは、保存した盤面に休みの記録(休み/振無休)が実在する連絡だけ**(`hasParentAbsenceRecord`)。四択のあと盤面の「元に戻す」や休み解除で消してから保存した連絡は一覧へ戻る(保存待ちだけが残って処理済みになる穴を封鎖)。(b) 一覧を**開いている教室の連絡だけ**に絞る(`selectParentMessagesForClassroom`。教室切替直後の 1 レンダーに、前の教室の生徒 ID で新しい教室の別人を休みにしうる・INV-08)。(c) 畳んだときの入口を右下 → **左下**へ(右下は開発用教室の確認リスト z-index:2000 と重なり押せなくなる)。(d) 「振替先を今決める」の振替元を**時限まで**見る(同日同科目 2 コマで別コマを指さない・INV-06/INV-11)。選択トークンは在庫行自身の値で作る `resolveRemainingOriginToken`(台帳へ日付だけで積まれた通常授業の休みに `日付#限` を渡すと一致せず**最古の振替元へフォールバック**するため。回帰テストで固定)。(e) 配置モードへ入るかは**その科目の在庫行**の残数で判定(`resolveParentMakeupPlacement`。生徒単位の合計で見ると、先取り済みの科目で在庫の裏付けが無い振替が置かれる)。(f) 同じコマに本人の席が複数あり科目で決められないときは推測しない。(g) 週へ移れなかったときは即座に失敗を返す(`jumpToWeekByDate` が真偽を返す)。(h) 再通知の注意文を「保存されなかった」の断定から「保存された盤面で確認が取れなかった」へ。
  - test: サーバーが書く連絡 doc と盤面側の読み取りを実物どうしで噛み合わせる契約テスト(src/utils/parentMessages.contract.test.ts)。片側だけ形を変えると「保護者は送れたのに室長のモーダルに出ない」になるのを CI で検出する。基本データの QR の紙の案内文を「授業予定の確認とお休みの連絡」へ。

## v1.5.549 (2026-09-18)
- feat: 室長の自教室復元(フラグ `managerSelfRestore`・開発用教室限定)をオーナー指示で変更。(1) **パスワード要求をやめ、画面中央の大きな確認モーダル**(alertdialog・幅760px・文字17px〜)を必ず挟む。(2) そのモーダルに**「復元しても戻らないもの」**を表示し、内部用語をアプリ上の呼び名へ置換(授業台帳→生徒日程表の「通常授業履歴」に出る記録／操作ログ→操作の記録。内部語の混入はテストで禁止)。(3) 対象を**直近7日→3日**へ短縮。(4) 開発者の入口が開発者画面と二重になる点はオーナー了承。実装は「取得(準備)」と「読込(確定操作)」を別ハンドラに分け、準備段では画面のデータを書き換えず、確定時に取得した教室IDでもう一度3者一致を照合、教室を開き直したら確認待ちデータも破棄(INV-08)。(src/components/backup-restore/managerSelfRestore.ts `buildManagerSelfRestoreConfirmation`・BackupRestoreScreen.tsx・App.tsx `prepareOwnClassroomRestore`/`confirmOwnClassroomRestore`・App.css・docs/spec-save-restore.md §4-1・確認リスト s-1/s-2 差し替え)

## v1.5.548 (2026-09-18)
- feat: 室長が自教室だけをサーバーバックアップ(15分毎・直近7日)から復元できる入口をバックアップ/復元画面に追加(オーナー要望 2026-09-18・フラグ `managerSelfRestore`=開発用教室限定で先行)。ログインパスワードの再認証 → 自教室の時点データを取得 → 規模を見せて最終確認 → **画面へ読込のみ**で、確定は室長の「保存」(サーバーへ直接書く復元関数は作らない・保存前は Undo 可)。教室取り違え防止(2026-06-06 事故)として、ハンドラは教室IDを引数に取らず、室長は「担当=開いている=復元対象」の3者一致・応答の教室ID照合・取得中の教室切替検知を通す。Cloud Functions/ルールの変更なし(`downloadClassroomFromServerAutoBackup` は元から担当教室のみ許可)。(src/components/backup-restore/managerSelfRestore.ts・BackupRestoreScreen.tsx・App.tsx `restoreOwnClassroomFromServerBackup`・adminFunctions.ts `listRecentFirebaseServerAutoBackupSummaries`・テスト managerSelfRestore.test.ts / managerSelfRestore.wiring.test.ts / featureRollout.test.ts)
- fix: 【INV-08 教室分離】「直前の状態に戻す」(Undo)が教室を開き直しても残り、別教室の盤面で押すと前の教室のデータが入る穴を塞いだ(8316830 / v1.5.300 は applyWorkspaceSnapshot と logout でしか破棄しておらず `openClassroom` が漏れていた・2026-06-13 再発と同型。室長復元が Undo を安全弁にするためレビューで発見)。Undo に取得元の教室IDを持たせて戻す前に照合(権威=`src/utils/classroomScopedUndo.ts` `canApplyUndoSnapshotToClassroom`)＋`openClassroom` でも破棄。兄弟監査: 同じ callable を使う「他教室バックアップ読込(Feature B)」にも応答の教室ID照合と取得中の教室切替検知を追加(INV-08)。QR 提出は復元で不変(INV-07・読込後の盤面再マウントで自己修復が走る)。(src/App.tsx・テスト classroomScopedUndo.test.ts / managerSelfRestore.wiring.test.ts)
- docs: `docs/spec-save-restore.md` §4-1 を新設(2026-06-10 の「室長への開放は見送り」を、自教室・直近7日・パスワード再認証・読込→保存確定の条件で改定)。確認リストに s-1〜s-3 を追加(版は v1.5.540 据え置き)。

## v1.5.547 (2026-09-18)
- docs: 2 社目受け入れ計画を第 3 版へ(§2-A 確認 1〜3 のオーナー回答=タブ名は「コマ表アプリ_教室名」・薬円台削除と請求許可者切替は了承・会社登録は専用コマンド。実装は次セッションから、§8 に着手順) (docs/plan-2026-09-18-second-company-onboarding.md)

## v1.5.546 (2026-09-18)
- docs: 2 社目の受け入れ計画を第 2 版へ(D-1〜D-8 のオーナー回答を反映。既存利用者(緑が丘・日大前)への影響を §2-A に集約し、影響あり 3 件=タブ名を教室名のみ・薬円台校の削除・請求許可者の member 化 を確認欄に。請求 P-11・登録時のキー入力 P-12・薬円台削除後の記述整理 P-0 を追加) (docs/plan-2026-09-18-second-company-onboarding.md)

## v1.5.545 (2026-09-18)
- docs: 2 社目の受け入れ計画を起案(既存運営会社=株式会社アーチ(緑が丘・日大前)・フォークを切らず会社別プロファイル＋会社別ビルドで受け入れる方針・事前準備 P-1〜P-10・当日手順・要望対応手順・フォーク切替基準・判断点 D-1〜D-8)。上位計画 §7 Phase 1 から参照 (docs/plan-2026-09-18-second-company-onboarding.md, docs/plan-2026-09-15-multi-company-architecture.md)

## v1.5.544 (2026-09-18)
- feat: 複数会社展開 Phase 1 T1-1・会社レイヤの入口 `src/company/profile.ts` を新設(CompanyProfile: 会社キー=main・アプリ名・既定ロゴ・役割名辞書・機能の会社既定(派生値)・会社版番号・帳票フック・画面フック。既定値=スクールIEの現行値で全項目が出力不変)。コア本体は alias `@company/profile`(vite/vitest/tsconfig で同一定義)で読む。フォークが触ってよいのは src/company/ だけ (src/company/profile.ts・test, vite.config.ts, vitest.config.ts, tsconfig.app.json, docs/spec-multi-tenant.md §11)
- feat: Phase 1 T1-2・機能フラグを「基本スコープ → 会社既定」の 2 段解決へ(オーナー確定 2026-09-16・教室別上書きは 3 段目として予約のみ)。会社既定はコア台帳 `src/utils/companyFeatureDefaults.ts`(自己完結・sync-shared で functions へ複製)に置き、`isFeatureEnabledForClassroom` とサーバー述語(保護者ポータル `isParentPortalEnabledForClassroom`・質問 AI `isQuestionAiAnswerEnabledForClassroom` 新設)が同じ関数 `resolveFeatureEnabledByLayers`・同じキーで解決(片側だけ会社既定を見る非対称を構造で防ぐ)。台帳は空=既存運営会社は従来どおり。パリティ/配線テスト追加 (src/utils/featureRollout.ts・companyLayer.test, functions/src/parentPortal.ts・questionAiAnswer.ts・index.ts・generated/companyFeatureDefaults.ts・companyFeatureDefaults.parity.test・featureCompanyLayer.test, functions/scripts/sync-shared.mjs)
- refactor: Phase 1 T1-3・役割名(室長・教室管理者・開発者)とアプリ名を辞書経由に(役割名だけ・全域置換はしない・オーナー確定 2026-09-16)。対象=App.tsx のタブ名/ログイン題名/アカウント一覧の役割表示、日程表の「室長登録」と本体タブ未検出の警告文。埋め込み JS へは引用符・改行をエスケープして差し込む。既定辞書で出力不変(テストで固定・対象一覧は spec-multi-tenant §11-3) (src/App.tsx, src/utils/scheduleHtml.ts, src/company/roleLabels.wiring.test.ts)
- feat: Phase 1 T1-4・生徒/講師日程表・空フォーマットに会社レイヤの差し込み口(ヘッダ差替 `{{period}}{{nameLabel}}{{name}}{{page}}{{qr}}`・追加注記・既定ロゴ)を埋め込み JS に追加。payload とは別に `COMPANY_REPORT_HOOKS` を 1 回だけ埋め込む(別タブ同期で消えない)。ロゴ欄の中身は `renderLogoBoxInner` 1 か所に集約し、空フォーマットのロゴ置換を placeholder 一致から logo-box 全体の置換へ(既定ロゴがあっても利用者ロゴが優先)。既定は全項目空=従来の出力と同一 (src/utils/scheduleHtml.ts, src/company/reportHooks.wiring.test.ts)
- feat: Phase 1 T1-5・盤面ツールバー(質問・要望の右)とメニュー(既存 5 項目の下・ログアウトの上)に会社プロファイルの追加ボタン/項目の登録口。押したときに渡すのは { classroomName, weekStartDate } だけ(コア内部 state は渡さない)。既定は空=DOM 不変(jsdom テストで固定) (src/components/schedule-board/BoardToolbar.tsx, src/components/navigation/AppMenu.tsx, src/components/schedule-board/ScheduleBoardScreen.tsx, src/company/screenExtensions.wiring.test.ts)
- test: `isDevelopmentClassroomIdentity` 呼び出し数の字面テストを、質問 AI の判定が questionAiAnswer.ts へ移った配置に追随(index 5→4・questionAiAnswer 1) (functions/src/developmentClassroomIdentity.test.ts)
- docs: spec-multi-tenant に §11 Phase 1 追補(プロファイル・2 段解決とコア台帳の理由・役割名の対象一覧・帳票フック 6 項目・画面フック・完了時の判断)。計画 §7 Phase 1 に状況を追記、spec-index を更新 (docs/spec-multi-tenant.md, docs/plan-2026-09-15-multi-company-architecture.md, docs/spec-index.md)
- chore: 確認リストに Phase 1 の「見た目が変わっていないこと」を確かめる m-1〜m-3 を追加(版 v1.5.540 は据え置き) (src/utils/verificationChecklist.ts・test)
- test/docs: regression-reviewer 監査の反映。空フォーマットのロゴ置換の挙動(利用者ロゴ > 会社既定ロゴ > ロゴ欄・校舎名/題名の差し込みと併存)を埋め込み JS の実体で固定(旧 placeholder アンカー方式へ戻すと落ちる)、会社既定 'on' を段階公開機能(parentPortalQr)に書かない歯止めテスト、companyKey と env workspaceKey の一致テスト、featureRollout.ts の questionAiAnswer コメント追随、spec-multi-tenant §11 の注記(index.html の宿題・'on' の制約・辞書の対象外・ヘッダ差替の副作用)と §9 件数訂正 (src/company/reportHooks.wiring.test.ts・profile.test.ts, src/utils/companyFeatureDefaults.test.ts・featureRollout.ts, docs/spec-multi-tenant.md)

## v1.5.543 (2026-09-17)
- feat: 確認リストの項目を「前提(任意1行)／操作(1〜2個)／見るところ(最大4)」の3段に分け、全15項目を短く書き直した(オーナー指摘「手順が多すぎて大変」。ナビゲート機能ではなく書き方を軽くする案を選択)。準備 y-1 を先頭に移し、以降は読み込んだ日大前データの上で行う前提にして項目ごとの準備を削減。上限はテストで固定。id・版(v1.5.540)は据え置きで下書きは生きる。確認項目 c-3 追加 (src/utils/verificationChecklist.ts・test, VerificationChecklistPanel.tsx, App.css)

## v1.5.542 (2026-09-17)
- style: 開発用教室の確認リストパネルの文字を 11〜12px → 15〜18px に拡大し、幅 360px → 560px・高さ上限 70vh → 85vh に広げた(オーナー指摘「文字が小さすぎて読めない」)。確認項目 c-2 を第15版として追加(版 v1.5.540 は据え置き) (src/App.css, src/utils/verificationChecklist.ts・test)

## v1.5.541 (2026-09-17)
- chore: 確認リスト第14版に、日大前・緑が丘の本番(旧版で 1/1→1/29・1/2→1/30 を丸ごと振替→休日設定済み)へ後から「休)」を付ける手順の予行 y-1〜y-4 を追加。オーナー判断で薬円台校は検証用教室に登録せず、開発用教室へ日大前のバックアップを読み込んでオーナーが操作する。書きかけの下書きを消さないよう版(v1.5.540)は据え置き (src/utils/verificationChecklist.ts・test, CLAUDE.md)

## v1.5.540 (2026-09-17)
- chore: 開発用教室の確認リストを第13版(v1.5.540)に。結果待ちの b-2 を残し、v1.5.538/539 の「休)」表示・丸ごと振替/休日設定の記録保持・休日解除後の席操作・生徒日程表の振替欄(元起点・未定)を確かめる r-1〜r-8 を追加 (src/utils/verificationChecklist.ts・test)
- docs: CLAUDE.md に「新機能追加・修正のたびに確認リストを必ず更新」(オーナー指示 2026-09-17)を追記

## v1.5.539 (2026-09-16)
- fix(INV-06/INV-02): 休日セルに残した出欠記録(v1.5.538 の休日記録・丸ごと振替の移動元記録、および休み等)が、盤面の再マージ(読込時・名簿/テンプレ/設定変更時)で消えていたのを是正。休日分岐(8559c28「休日に盤面の授業を持ち込まない」)はテンプレ側セルを土台に保ったまま、机ごとの出欠記録を引き継ぐ(`carryBoardStatusRecordsOntoClosedDayCell`)。記録のある机に限り講師ブロックも引き継ぎ、休日解除後に講師が空のまま戻らない(記録の講師名と机の講師がずれ講師日程表・給与から落ちる INV-01)状態を防ぐ(regression-reviewer 監査)。本番3教室の保存データで対象セルは0件(読み取り実測)。フラグ OFF でも「定休日の曜日を後から追加」「臨時営業日を定休日に戻す」で記録が消え、振替コマの休みが未消化から無言で減っていた経路も同時に塞がる (src/components/schedule-board/ScheduleBoardScreen.tsx)
- feat(INV-06): 休日解除後、休日記録の席は移動元記録の席と同じメニュー(生徒追加/体験/メモ/表示解除)。休日中のセルの休日記録・移動元記録は解除ボタンだけ(移動元記録は従来クリックで弾かれ解除できなかった)。移動/入替で着地した席の休日記録は移動元記録と同じく消える(休み/振無休の保持=Issue #57 は不変) (`isStaleSeatMarkerStatus`・`resolveEmptySeatMenuVariant`・`resolveDisplayRecordClearButton`)
- test(INV-06): 上記の回帰固定 +16 件(inv06-holiday-record-retention.matrix)。docs: spec-makeup-stock §B-2-2c/§3-1・spec-invariants INV-06 補記のガード一覧

## v1.5.538 (2026-09-16)
- feat(INV-06/INV-05): 振替元「休)」表示・振替欄の元起点統一・丸ごと振替/休日設定の記録保持(スクールIE要望・オーナー確定 2026-09-16・機能フラグ `transferSourceRestDisplay`=**development-only**)。①別日移動の移動元マーカー(moved)を「休)→先」表示(内部は moved のまま・在庫会計不変) ②丸ごと振替が振替元の通常授業の生徒ごとに moved 記録を残す(`computeWholeDayTransfer.leaveSourceRestMarkers`・台帳不触・記録が残る日は再実行ブロック) ③休日設定が記録を消さず、在庫へ返した配置/出席/振無休を新種別 `holiday`(表示専用・会計は moved と同じ無視)へ変換(`convertHolidayDeskEntriesToRecords`) ④生徒日程表の振替欄を元コマ起点「科目 元 → 先/未定」に統一(先起点の行と重複排除・「未定」の根拠は未消化一覧の正本 `rawMakeupStockEntries` から payload `outstandingMakeupOrigins`) ⑤moved/holiday を日程表 payload に載せるのは初めてなので講師日程表・回数表・給与/交通費・別タブD&D・保護者ページから除外するガードを追加。OFF の教室は既存テスト 1963 件を無改変で緑=挙動不変 (src/utils/featureRollout.ts, src/components/schedule-board/types.ts・ScheduleBoardScreen.tsx・makeupStock.ts・lessonLinks.ts・BoardGrid.tsx, src/components/board-share/BoardShareScreen.tsx, src/utils/scheduleHtml.ts・scheduleViewData.ts・parentSchedule.ts(+functions/src/generated)・studentLessonLedger.ts・pdf.ts, src/components/schedule-view/scheduleViewMove.ts)
- test(INV-06): 上記の回帰固定 +71 件(inv06-whole-day-transfer.matrix 拡張・inv06-holiday-record-retention.matrix 新設・transferSourceRestDisplay.test 新設・lessonLinks/makeupStock/scheduleHtml/scheduleViewData/parentSchedule/studentLessonLedger)。mutation 16 件で「修正なしで落ちる」を確認
- fix(INV-05/INV-06): 全コマ削除(丸ごと振替 Phase A と共通の `disposeDayDeskEntries`)が表示専用の出欠記録(`holiday`・`moved`)を「削除された授業」として予定数/希望数 −1・抑止キー・件数に数えていたのを処分対象外に是正(regression-reviewer 監査 H1。moved 分は OFF 経路の既存バグで、別日移動元の日を全コマ削除すると移動先に置いた授業と二重処分になっていた)。回帰テスト +対照 (src/components/schedule-board/ScheduleBoardScreen.tsx・inv06-whole-day-transfer.matrix.test.ts)
- test: 新設した scheduleHtml の payload テスト(ON=開発用教室)が `.env.local` の `VITE_FIREBASE_WORKSPACE_KEY` に依存し CI(env なし)で赤になっていたのを `vi.stubEnv` で固定(同ファイル既存テストと同じ作法) (src/utils/scheduleHtml.test.ts)
- refactor: 「未定」判定に使う未消化 origin の射影 `toOutstandingMakeupOriginEntries` と盤面の在庫キー解決 `createBoardStudentStockIdResolver` を makeupStock.ts に一本化し、盤面と App.tsx の別タブ同期(盤面 unmount 中の唯一の同期経路)の両方から同じ権威で `outstandingMakeupOrigins` を渡す(監査 M4) (src/components/schedule-board/makeupStock.ts・src/App.tsx)
- docs: 仕様正本を先行改定(spec-makeup-stock §1-B/§B-2-2b/§B-2-2c/§B-2-3/§3-1・spec-lecture-stock §4-2①②・spec-schedule-pdf §E-1(「開発用教室のみ」は誤りで all-classrooms 昇格済み(2026-06-27)に訂正)/§E-1-1・spec-invariants INV-06 補記・spec-parent-portal §D-3/§K-3・spec-student-schedule-dnd §C-1/§E)

## v1.5.537 (2026-09-16)
- docs(INV-08): オーナー確定「テスト教室(石川先生)は開発用教室と同じ扱い」を仕様本文へ(kind=development/sandbox で機能解放も混入防止ガードも分けない・kind を見てよいのは会社ごとの開発用教室を 1 件決める resolveDevelopmentClassroomId だけ)。挙動の変更なし(v1.5.534 時点の実装がそのまま正となる) (docs/spec-multi-tenant.md §4-2-11・§10-7 を解決済みへ, src/utils/developmentClassroomRegistry.ts, functions/src/generated/developmentClassroomRegistry.ts, src/utils/featureRollout.test.ts)

## v1.5.536 (2026-09-16)
- test: `tools/invoked-directly.test.mjs` のバックスラッシュ相対パス検証を Windows 限定に(Linux の CI Tests で落ちていた・v1.5.535 のデプロイ自体は成功) (tools/invoked-directly.test.mjs)

## v1.5.535 (2026-09-16)
- refactor(INV-08): 検証用教室の識別子型 `DevelopmentClassroomIdentity` から `name` を削除し、`{ id }` だけにした。教室名だけを渡す旧形(`{ name: classroomName }`)が**コンパイルエラー**になり、development-only 機能が開発用教室で静かに無効化される回帰を型で止める (src/utils/developmentClassroom.ts・src/components/schedule-board/ScheduleBoardScreen.tsx・src/utils/scheduleHtml.ts)
- refactor(INV-08): サーバー側 `isDevelopmentClassroomIdentity` を同型 string 2 引数から名前付き引数 `{ workspaceKey, classroomId }` に変更(順序を取り違えても型が通り静かに false になるのを防ぐ)。呼び出し 6 か所を追随 (functions/src/developmentClassroomIdentity.ts・functions/src/index.ts・functions/src/parentPortal.ts)
- test(INV-08): `isDevelopmentClassroom` / `isFeatureEnabledForClassroom` の呼び出しを **src 全体走査**で固定する兄弟テストを追加(2 ファイル限定だった字面テストが新規ファイルの呼び出しを見逃す穴を塞ぐ・App.tsx の CRLF も正規化して走査) (src/utils/developmentClassroom.callSites.test.ts)
- test(INV-08): `requireClassroomAccessMember` の配線(developer のときだけ教室 doc を読み、その結果を `resolveClassroomAccessDecision` に渡す)と、`saveDevelopmentClassroomSnapshot` の developmentOnly 分岐(未登録の会社は failed-precondition)を字面スキャンで固定 (functions/src/classroomAccess.test.ts・functions/src/developmentClassroomIdentity.test.ts)
- refactor: CLI ツールの「直接実行されたときだけ動かす」判定が 3 方式に分かれていたのを共通ヘルパ 1 方式へ統一(`node:fs.realpathSync` で実体比較。ジャンクション/シンボリックリンク越しや相対パス起動で無言 exit 0 しない) (tools/invoked-directly.mjs 新設・tools/*.mjs 7 本・functions/scripts/sync-shared.mjs)

## v1.5.534 (2026-09-16)
- docs: マルチテナント(会社=workspace)の境界仕様を新設(会社の壁/開発用教室レジストリ/越境ガード/ツールの棟指定必須・Phase 0 T0-1) (docs/spec-multi-tenant.md, docs/spec-index.md)
- chore: 複数会社展開 Phase 0 T0-4・運用ツール(tools/*.mjs)の workspace 既定値 'main' を廃止し `--workspace` を必須化(6-1/6-12 の是正)。`copy-prod-classroom-to-staging.mjs` は既定教室(日大前)も廃止し `--classroom` 必須に。vitest の import で main() が走らないよう shebang を除去し invokedDirectly ガードを追加、呼び出し側(functions-logs.yml・docs)も追随 (tools/copy-prod-classroom-to-staging.mjs, tools/lesson-history-diagnose.mjs, tools/lesson-ledger-report.mjs, tools/verification-checklist-report.mjs, tools/firebase-first-classroom-helper.mjs, .github/workflows/functions-logs.yml, docs/handoff-popup-sync-and-dnd.md, docs/spec-save-restore.md)
- fix(INV-08): テナント(会社=workspace)越境ガードを追加 — 開発者会員の callable は教室 doc の実在を確認してから通す(別会社/存在しない教室 ID の素通りを封鎖・functions/src/classroomAccess.ts・functions/src/index.ts requireClassroomAccessMember)。配布用盤面の共有ドキュメントに workspaceKey を書き足し(読みは無改変・src/integrations/firebase/boardShare.ts)、Firestore ルールに会社越境の遮断テストを追加(firebase/rules/firestore.rules.test.ts)
- fix(INV-08): 検証用(開発用・テスト)教室の判定を「教室名/曖昧ID」から**会社(workspaceKey)ごとの教室ID登録台帳**へ是正(計画 §6-2)。他社が「開発用教室」という名前の教室を作っても検証用特権(Feature B・先行機能・保護者QR・AI即答)が付かない (src/utils/developmentClassroomRegistry.ts 新設・src/utils/developmentClassroom.ts・src/utils/featureRollout.ts)
- refactor: クライアント/サーバーの二重実装(手書きコピー)を解消し、functions は sync-shared の生成物を読む薄いラッパへ。ズレはパリティテストが検出(計画 §6-3) (functions/scripts/sync-shared.mjs・functions/src/generated/developmentClassroomRegistry.ts・functions/src/developmentClassroomIdentity.ts・functions/src/developmentClassroomRegistry.parity.test.ts)
- fix(INV-05/INV-08): 機能フラグの教室判定に教室ID を渡すよう配線を修正(教室名だけ渡す旧形が残ると開発用教室で development-only 機能が無効化される)。副作用として**テスト教室(test_classroom_20260507_dai)でも盤面側の development-only 機能(盤面ベース予定数・講習履歴・AI即答表示)が有効化**される(旧配線は教室名だけで判定していたため偶然 OFF だった。CLAUDE.md「テスト教室は開発用に準じて扱う」とサーバー側の既存判定に揃える。戻す場合は台帳の kind で絞る) (src/components/schedule-board/ScheduleBoardScreen.tsx・src/utils/scheduleHtml.ts・ScheduleBoardScreen.featureFlags.wiring.test.ts)
- fix: 開発用教室限定の保存実験(saveDevelopmentClassroomSnapshot)の教室ID直書き定数を廃し、会社ごとに台帳から解決(未登録の会社は failed-precondition) (functions/src/index.ts)

## v1.5.533 (2026-09-16)
- docs: 複数会社展開計画の残判断点を確定(方式B 上流フォーク・複製は2社目の要望を見てから／Phase 0→1 を今から着手) (docs/plan-2026-09-15-multi-company-architecture.md §9)

## v1.5.532 (2026-09-16)
- docs: 複数会社展開計画を第2版へ(§6 問題点15件のオーナー質疑結果を §10 に記録・機能スイッチは当面2段/開発用教室は会社ごとにID固定/請求は会社宛合算+教室宛/会社リポは私有/版はコア版+会社識別子/想定10〜30教室) (docs/plan-2026-09-15-multi-company-architecture.md)

## v1.5.531 (2026-09-16)
- fix: UTC の日付(toISOString().slice(0,10))のせいで JST 0:00〜8:59 に前日になっていた残り3か所を getJstTodayDateKey へ寄せた(請求書PDFの発行日 / 初期在庫登録の生徒選択肢の在籍判定 / 開発者管理画面の教室在籍数と教室追加の契約開始日初期値)。バックアップの日付キーはサーバー側で既に JST で、この3か所とは無関係と確認 (invoicePdf.ts, BackupRestoreScreen.tsx, DeveloperAdminScreen.tsx, jstDateRemainingSites.test.ts)

## v1.5.530 (2026-09-15)
- docs: 複数会社展開に向けた構成見直しの計画を起案(会社=workspace で DB は1つのまま・フロントは上流フォーク方式・共通/会社固有の判定基準・現行の問題点15件・Phase 0〜4・オーナー回答欄) (docs/plan-2026-09-15-multi-company-architecture.md)

## v1.5.529 (2026-09-15)
- chore: v1.5.528 退塾改定のレビュー残課題3件を解消(INV-02/INV-10・オーナー承認済み)。(1) 台帳 INV-10 節に「テンプレ固定日前の週も生徒の退塾では max(退塾日, 今日[JST]) 以降のテンプレ由来通常授業だけ剥がれる」例外を追記し詳細は INV-02 節へ参照(保証文は不変)。(2) JST の「今日」を返す TS 関数の重複(billing.ts `getJstTodayDateKey`＝盤面/請求・scheduleViewData.ts `getScheduleTodayJstKey`＝日程表)を新設 `src/utils/jstDate.ts` の `getJstTodayDateKey` 1 つに統合(挙動不変・UTC 15:00 境界)。埋め込み JS 写しとの一致を境界7時点で突き合わせる jstDate.test.ts を追加。(3) INV-02 マトリクスに「別の日から移動してきた生徒(makeup 扱い)は退塾日以降でも剥がさない」行を追加(剥がし判定が makeup も対象にすると落ちることを確認)。(jstDate.ts, billing.ts, scheduleViewData.ts, ScheduleBoardScreen.tsx, BillingAutomationScreen.tsx, scheduleHtml.ts コメント, inv02-manual-edit-persistence.matrix.test.ts, docs/spec-invariants.md INV-02/INV-10)

## v1.5.528 (2026-09-15)
- fix: **生徒の退塾日を「その日から非在籍」に改定**(INV-01/02/04/05/06/09/10・確認リスト v1.5.527 b-2 要改善・受付 20260915-131600682-f14273d0「今日の盤面からも消してほしい・退塾日当日はもう退塾」「非在籍生徒表示で削除ボタンが出ない」・オーナー決定 2026-09-15)。在籍は退塾日の前日まで。判定を `isStudentWithdrawnOnDate` に一元化し、`isActiveOnDate`／`resolveScheduledStatus`／新設 `resolveManagedStudentRosterStatus`(生徒の名簿表示・学年列・退塾/削除ボタン)と写し(functions `isStudentActiveOnDate`=毎月15日の在籍数記録、`parentSchedule.isParentStudentActiveOnDate`→functions 生成物を再同期=保護者QR、日程表の生徒用 `isStudentVisibleInRange`=scheduleViewData.ts と埋め込みJS、講習QRトークン発行対象 App.tsx)を同じ境界に揃え、4 か所+権威の一致表テストで固定。**盤面(INV-01/02/10)**: 既に盤面にある週は Issue #28 の保持分岐やテンプレ固定日前の凍結で退塾生徒の通常授業が残るため、読込と名簿/テンプレ/設定変更の再マージ(2 か所に複製されていた処理を `remergeBoardWeekWithManagedData` に集約)の先頭で、**テンプレ由来の通常授業だけを max(退塾日, 今日[JST]) 以降で外す** `stripWithdrawnStudentsFromBoardWeek` を追加(テンプレ固定日の前後を問わない・固定日前の週は剥がしのみでテンプレ再マージしない・**昨日以前の盤面には触れない**)。退塾ボタンでも編集の日付入力でもその場で反映。手置きの講習・振替・手動追加・移動(同日移動/席入替を含む)・出欠記録は消さず、manualTeacher や出欠記録のある机は講師を残す。非 manual 講師の机は空になる(テンプレ足場の追従・今日以降のみ許容・講師日程表と一致を固定)。**在庫(INV-05/06)**: 振替の元の自動算出(`computeAutomaticShortageOrigins`／`computeScheduleConflictOrigins`)は退塾日当日の休日・コマ重なりから元を作らなくなり、旧定義より 1 件減る(新しい定義として受け入れ)。回数表の予定数も退塾日当日を数えない。**警告・割振対象(INV-09)**: 盤面の生徒追加候補・自動割振の対象からも退塾日当日から外れる。**日程表(INV-04)**: 生徒一覧は退塾日当日から出さない。日程表の「今日」を UTC から JST に修正(生徒・講師とも・JST 0:00〜8:59 に前日扱いだった)。v1.5.527 の一覧だけの特別扱いは生徒判定と同一に整理(押した直後に非在籍一覧へ移る回帰テストは維持)。削除ボタンは退塾日当日から出る。退塾確認文を新定義に更新。**高3卒業**は自動補完の退塾日を表示 3/31 のまま、3/31 まで在籍・4/1 から非在籍(自動補完日だけは「その日まで在籍」・手入力の退塾日は当日から非在籍)。**講師の退職日は変更なし(当日在籍)**。過去の退塾生徒も在籍の最終日が1日早まる(オーナー承知)。回帰テスト: 前日/当日/翌日を isActiveOnDate・名簿・削除/退塾ボタン・請求・functions 記録・保護者QR(ハンドラも生成物で)・日程表(TS/埋め込みJS・JST)・予定数・盤面の生成と剥がし(単独/同コマ他生徒/昨日以前は残る/固定日前の週/講師日程表一致/配線)・卒業 3/31/4/1、INV-02 マトリクス 5 行・INV-06 マトリクス 3 行(basicDataModel.ts, withdrawGuard.ts, ScheduleBoardScreen.tsx, scheduleViewData.ts, scheduleHtml.ts, parentSchedule.ts, functions/src/monthlyStudentCount.ts, App.tsx, lectureStock.ts・docs/spec-basic-data.md §B/§C/§H, docs/spec-parent-portal.md P-6, docs/spec-invariants.md INV-02/06)
- chore: 確認リストを第12版 v1.5.528 に差し替え(b-2 を新定義の確認手順に)(verificationChecklist.ts)

## v1.5.527 (2026-09-15)
- fix: 基本データの「退塾」ボタンを押しても生徒が翌日まで在籍一覧に残っていた(確認リスト その他 2026-09-14「押した瞬間に非表示に」)。生徒一覧の振り分けだけ、退塾日が今日の生徒も「非在籍生徒表示」側へ移す(isStudentInWithdrawnRosterList)。退塾日は今日のまま記録し、盤面・請求・保護者QRの在籍判定(当日は在籍)は変えない(前日付けにする案は今日の授業・請求まで外れるためオーナーが不採用)。回帰テスト: 押した直後に非在籍一覧/退塾日は今日のまま・共有判定は当日在籍/未定・将来・過去・卒業の振り分け/画面がこの判定を使う source-scan(withdrawGuard.ts, BasicDataScreen.tsx・docs/spec-basic-data.md §H)
- chore: 確認リストを第11版 v1.5.527 に差し替え(b-2 のみ・第10版 k-11/k-12/h-10 は OK)(verificationChecklist.ts)

## v1.5.526 (2026-09-14)
- fix: 保護者QRページで**振替に回した日(振替元)に何も出なかった**(確認リスト第9版 k-11「休みとなった日が行表示されない」)。真因は、日付メニューの丸ごと振替は振替元の机を空にするだけ、生徒のドラッグ移動は振替元に「移動」記録(保護者ページでは非表示)を残すだけで、どちらも振替元に「休」が無かったこと(開発用教室 浮須 9/23→9/30 で実データ確認)。振替先の振替コマ(makeupSourceDate＋元コマの限)から逆に引き、振替元の日に「お休み＋振替先」を補う。同じ限・科目の行が既にあれば足さない(休みで振替先が引けていなければ埋める)／振替コマ自体を休みにした分(在庫へ戻った)からは補わない／臨時・祝日休みから振替に回した分は「教室休み」の行に振替先を添える。開発用教室の全生徒×6か月で新旧を比較し重複・他生徒混入なしを確認。回帰テスト: 丸ごと振替/ドラッグ移動/範囲外の振替先/既存の休みと重ねない/教室休み/本人以外の振替を付けない(修正を外すと6件落ちる)。regression-reviewer 指摘を同一 push で反映: 同じ限に別の日から来た出席済み振替があっても休みを隠さない(A-2)／丸ごと振替・移動の振替先を休みにしても振替元の行を残す(A-3)／同じ科目・限の別生徒の振替を付けない回帰テスト(A-1)／講習コマから補わない回帰テスト／パリティ比較の除外を「振替先つきの休み」に限定(B-3)。※保護者ページは保証台帳 INV-04(日程表の経路一致)の対象外のため INV-ID なし(対象へ含めるかはオーナー判断待ち)(src/utils/parentSchedule.ts・functions 生成物を再同期・docs/spec-parent-portal.md §D-3/§D-5)
- style: 保護者QRページの振替の補足を**1行に収まる短い表記**に(k-11「振替日付も含めて1行表示」・教室休みの行だけは振替先が多いと折り返す A-4): 「9/30 5限に振替」「9/23 5限の振替」「出席（9/23 5限の振替）」「9/19 2限分 振替なし」「振替日は調整中」。列幅・余白を詰め、教室休みの行は時限欄まで本文を広げた。実ブラウザで幅390pxは全行1行・360pxは「今日」印の行だけ折り返しうることを計測(parentPortalPageModel.ts, ParentPortalPage.tsx)
- fix: 基本データで追加直後の生徒の QR ボタン(保存待ち)のスピナーが見えなかった(k-12)。App.css 後方の共通 `.button-spinner` が白い線で、白いボタンの上では見えなかったのが原因。保存待ちのボタンだけ青い線で描き、文言を「QR準備中」に(parentPortalQr.ts, BasicDataScreen.tsx, App.css・source-scan テスト)
- feat: 生徒日程表の「通常授業履歴」で**振替元列を廃止し、状態欄に振替元・振替先・未消化をまとめて表示**(確認リスト その他 2026-09-14)。例「休み（振替先 9/30 5限）」「出席（振替元 9/23 5限）」「休み（未消化）」「未消化（手動調整）」。サーバーが台帳 1 行(生徒×科目)の中で期間フィルタ前に突き合わせる(振替を休んだら次の振替先へ連鎖・同じ日の2コマは限で振り分け・`linkLessonHistoryMakeups`・表示文字列 statusText)。そのため生徒授業台帳のトークンを 4 状態とも `日付#限|種別|振替元日|振替元限` にそろえた(旧は出席・振無休に振替元日なし、どれも限なし。末尾追加なので旧トークンも読める＝この版で保存した後の台帳から限が出る)。回帰テスト: 突き合わせ8件(修正を外すと落ちる・休みの記録が無い振替元からの連鎖 A-3 と講習/通常を混ぜない A-6 はレビュー指摘で追加)/台帳トークン/応答の正規化で新項目を落とさない/表の列(src/utils/lessonHistory.ts と functions/src/lessonLedgerHistory.ts の複製・パリティ緑, studentLessonLedger.ts, lessonHistoryMessage.ts, scheduleHtml.ts・docs/spec-save-restore.md §8-1c, plan-2026-09-11 §6)
- chore: 確認リストを第10版 v1.5.526 に差し替え(k-11/k-12/h-10)(verificationChecklist.ts)

## v1.5.525 (2026-09-14)
- fix: 講師を削除して別画面へ行き盤面に戻る(またはリロード)と、削除した講師が同コマの別の机に再出する不具合を修正(INV-02)。真因は盤面マウント時の自己修復 reconcileSubmittedTeacherPlacements が削除tombstoneを数えず、QR提出済み講師の「その講習での最後の登録机」を消すと未配置と誤判定して空き机へ置き直していたこと(バックアップ書き出しは無関係・画面切替で盤面が再マウントされるのが引き金)。講師メニューで講習登録の机を削除したときだけ tombstone に講習IDを残し(applyUserDeletedTeacherTombstone)、その講習IDの tombstone がある講師は置き直さない。講習IDの無い tombstone(通常授業机の削除・丸ごと振替・旧データ)は数えず揮発した提出配置の自己修復は従来どおり(名前/期間一致だと自己修復まで止まる経路があるため講習IDに限定・regression-reviewer 指摘)。旧データの tombstone しか残っていない講師は次の再マウントで1回だけ置き直され、それを削除すれば以後出ない。実例: 開発用教室 9/22 1・2限の能勢(ScheduleBoardScreen.tsx・inv02 マトリクスに回帰6件・spec-invariants INV-02 違反履歴)
- style: 右上の保存ボタンを状態で色分け。保存・保存中… = 赤／最新データ = 緑(オーナー指示 2026-09-14・旧「青固定」2026-08-29 を改定。saveButtonState.ts / BoardToolbar.tsx / App.css・spec-save-restore §1)

## v1.5.524 (2026-09-14)
- refactor: 質問への AI 即時回答(開発用教室のみ)の呼び出し先を Claude API 直(API キー)から **Claude on Google Cloud(Vertex AI)** へ変更。請求先を GCP にまとめるため(オーナー指示 2026-09-14)。API キーは不要になり、Cloud Functions の実行サービスアカウントで認証・リージョン既定 global。権限不足/モデル未有効化は結果画面に短い理由で出す(functions/src/questionAiAnswer.ts・@anthropic-ai/vertex-sdk・spec-developer-report §G-7)

## v1.5.523 (2026-09-14)
- feat: 「要望・報告」ボタンを「質問・要望」へ改名し、種類の並びを 質問 → 要望 → 不具合（開いたときの既定は質問）に変更。「#テスト と書いてください」の案内文を削除（テスト判定自体は残す）。盤面・日程表タブで同一（オーナー指示 2026-09-14・developerReport.ts / DeveloperReportModal.tsx / BoardToolbar.tsx / scheduleHtml.ts・spec-developer-report §B）
- feat: 質問への AI 即時回答を**開発用教室だけ**試験実装。質問を送ると記録・通知は従来どおり行ったうえで、利用者マニュアル＋質問文＋直近操作を Claude Sonnet 最新へ渡し、結果画面に「AI の自動回答（試験中）」を表示。API キー（functions env `ANTHROPIC_API_KEY`）未設定なら AI を呼ばず理由だけ出す。featureRollout `questionAiAnswer`＝development-only（functions/src/questionAiAnswer.ts・sync-shared でマニュアルを同梱・spec-developer-report §G-7）

## v1.5.522 (2026-09-14)
- feat: 未消化のまま退塾した生徒が「未消化講習／未消化振替」の一覧に残り続けていたので、**退塾済み(退塾日の翌日以降・高3卒業後)の生徒を一覧とツールバーのバッジ数から外した**(オーナー指示)。表示だけの絞り込みで在庫・台帳・保存データは変えない(退塾日を消せば再表示)。入塾前の生徒・名簿に居ない生徒は従来どおり表示。削除確認の残数警告と自動割振は絞り込み前の一覧のまま。回帰テスト: 退塾/当日/卒業/入塾前/ID無しの判定と配線(schedule-board/lectureStock.ts `excludeWithdrawnStudentStockEntries`, ScheduleBoardScreen.tsx, lectureStockWithdrawnVisibility.test.ts)

## v1.5.521 (2026-09-14)
- fix: 確認リストの読み取りツールが、アプリの送る「- その他: …」行を読めず**その他欄の要望を黙って落としていた**(v1.5.512/v1.5.518 のその他要望が未対応のまま残った真因)。1 行形式も拾うようにし、アプリの送信本文をそのまま読む回帰テストを追加(修正を外すと2件落ちる)(tools/verification-checklist-report.lib.mjs)
- feat: 保護者QRページの日程を**1コマ1行**の一覧にしてスクロール量を減らした(日付は同じ日の先頭行だけ・時限と開始時刻・テンプレ由来は「予定」印)。純関数 `buildParentScheduleRows` に切り出してテスト(確認リスト その他 2026-09-14・第9版 k-10)(parent-portal/parentPortalPageModel.ts・ParentPortalPage.tsx)
- feat: 保護者QRページで**振替の行に振替元**(「振替（振替元: 9月15日 4限）」)、休みの行に振替先(表記を「振替先:」に)を月日コマで出す。日程計算の権威 parentSchedule.ts が振替コマに `makeupOrigin` を付ける(配置の振替と、振替を出席/振無休にしたもの)。functions 生成物を再同期(パリティ緑)。回帰テスト: 付く/付かない/元コマ不明/同じ日(第9版 k-11)(src/utils/parentSchedule.ts, docs/spec-parent-portal.md §D-5)
- fix: 生徒日程表の「通常授業履歴」で、期間を変えても前の結果(既定の1年分)が残り範囲設定が効かないように見えた。既定を**今月の1日〜末日**にし、日付を変えたら「表示」を押さなくても読み直す(「表示」ボタンにもスタイルが当たっていなかった)。あわせて**記録開始より前の月を指定すると0件**になっていた(「to 以前で最新」の台帳文書が無い)ので、直後の台帳から期間で絞るフォールバックを追加(読み取りのみ・dateKey 単一フィールド索引)。回帰テスト: 既定期間の算出(月末・閏年)/変更で読み直す配線/フォールバックの呼び分けとクエリ形/index.ts の配線(第9版 h-9)(src/utils/scheduleHtml.ts, functions/src/lessonLedgerHistory.ts, functions/src/index.ts)
- fix: 基本データで生徒を追加してすぐ「QR」を押すと、サーバーの名簿(保存済みデータ)にまだ居ないため発行に失敗した。保存済みデータに居ない生徒の QR ボタンは**保存が終わるまでスピナーで押せない**ようにした(`resolveParentPortalQrRowState` の `pending-save`・保存済み id は `resolveSavedStudentIds` がデータ署名=保存済み署名のときだけ更新)。発行済み・既存生徒は影響なし(第9版 k-12)(basic-data/parentPortalQr.ts, BasicDataScreen.tsx, App.tsx)
- style: 盤面の「通常授業テンプレ作成」ボタンを「未消化講習」の左へ移動(オーナー指示・第9版 b-1)(BoardToolbar.tsx)
- chore: 確認リストを第9版 v1.5.521 に差し替え(k-10/k-11/k-12/h-9/b-1)(verificationChecklist.ts)

## v1.5.520 (2026-09-14)
- feat: 自動割当ルール画面から「登校日集約/分散」を非表示にした(分かりづらいとの意見・オーナー指示)。見えない設定が効き続けないよう、自動割振/警告でも対象設定の有無にかかわらず適用しない(`isAutoAssignRuleApplicable` で除外=「対象ルールなし」と同じスコア)。Excel出力からも外す(取込時は未記載ルール=現設定維持なので消えない)。保存データの行・対象設定は削除しないので非表示リストから外せば復帰。回帰テスト: 非表示判定・全員対象でも不適用(他ルールは適用)・Excel出力除外(src/components/auto-assign-rules/autoAssignRuleModel.ts・AutoAssignRuleScreen.tsx・hiddenAutoAssignRules.test.ts, ScheduleBoardScreen.tsx, docs/spec-auto-assign-rules.md §C)

## v1.5.519 (2026-09-14)
- fix: 保護者QRのページ(開発用教室限定)で、講習だけだった月(夏期講習中に入塾した生徒の8月など)が「教室休み」しか出ず出席データが消えたように見えた(確認リスト第7版 k-4 要改善)。実データ(開発用教室を読み取りのみ)で原因を確認: 講習コマは仕様どおり出さないため。オーナー回答で講習コマは出さず、日程計算が真偽値 `hasLectureLessons`(範囲内の開講日に講習コマ=配置 or 出欠記録(moved除く)があったか・件数日付は出さない)を返し、通常授業の日が0日でこの印が真の月だけ「この月は通常授業がありません（講習の日程はこのページには表示されません）。」を出す。講習も無い月は従来どおり。旧functions応答(印なし)は偽扱い。functions 生成物を再同期。回帰テスト: 印の真偽(範囲/他生徒/statusSlots/moved除外)・応答キー・注記の出し分け。確認リスト第8版 v1.5.519(k-4 のみ)(src/utils/parentSchedule.ts, functions/src/parentPortal.ts, parent-portal/parentPortalPageModel.ts・ParentPortalPage.tsx, verificationChecklist.ts, docs/spec-parent-portal.md §0-4-5)

## v1.5.518 (2026-09-14)
- fix: 保護者向け固定QRのページ(開発用教室限定)を確認リスト第6版の要改善 k-4/k-5 に合わせて改定。表示と移動を**暦の1か月単位**(「前の月／次の月」・先月〜来月だけ・見出し「2026年9月」)にし、**授業(通常・振替・お休み等)がある日だけ**行を出す。教室休みは**臨時・祝日休み(holidayDates)だけ**「教室休み」の1行(毎週の定休曜日は出さない)。講習期間の「別途ご案内」行を廃止し、講習期間中も**通常授業だけ**を出す(講習は講習提出QRで案内・オーナー回答 2026-09-14)。応答の kind から lecture-period/none と lectureLabel を削除。日程の権威 parentSchedule.ts を直し functions の生成物を再同期(パリティテスト緑)。回帰テスト: 月丸め(年またぎ・閏年・範囲外寄せ)/月移動の端/空行を出さない/定休曜日は行なし・臨時休みは行あり/講習期間でも通常授業。確認リストは第7版 v1.5.518(k-4/k-5 の再確認のみ)(src/utils/parentSchedule.ts, parent-portal/ParentPortalPage.tsx・parentPortalPageModel.ts, verificationChecklist.ts, docs/spec-parent-portal.md §0-4)

## v1.5.517 (2026-09-13)
- fix: 開発用教室の確認リストで**メモ欄を全項目に常に出す**(オーナー指摘「テキストが入力できない」: 以前は要改善を選ぶまで入力欄が無かった)。未確認のままメモを書くと要改善に切り替え、送信本文から黙って落ちないようにした(`setVerificationChecklistMemo`)。あわせて確認リストの送信は**メール通知も Issue 起票もしない**(オーナー指示・開発者がツールで読んで必ず修正するため)。サーバーが開発用教室かつ先頭行 `[確認リスト vX.Y.Z]` のとき `isVerificationChecklist` で記録し `notifiedAt` 即時・メールトリガーは送信前に打ち切る。本番教室は対象外。回帰テスト(純関数3件・サーバー判定3件・配線 source-scan 2件)を追加し、メール打ち切りを外すと落ちることを確認(VerificationChecklistPanel.tsx, verificationChecklist.ts, functions/src/developerReport.ts, functions/src/index.ts, docs/spec-developer-report.md §E-2)

## v1.5.516 (2026-09-13)
- feat: 講師日程表の給与計算欄で**小計を直接入力できる**ようにした(オーナー指示 2026-09-13・特別な事情の調整用)。入力した小計を正として合計に反映し、空欄なら単価×コマ数(交通費は日数・事務給は単価)を小計欄に表示、空にすると自動計算へ戻る。手入力の小計は画面だけ薄い黄色(印刷は色なし)、端末には記憶しない(`data-salary-key` を付けない＝単価の記憶キー5件は不変)。判定は純関数 `resolveSalaryRowSubtotal` に切り出し、`recalcSalary` は全小計の合計に変更。回帰テスト2件(純関数/jsdom の実DOMで 単価入力→自動表示・手入力優先・単価変更で上書きしない・空で自動復帰・記憶しない)を追加し、修正を外すと2件落ちることを確認。あわせて交通費日数の数え方(出席記録のある日＋集団実施日)を仕様書に明記(緑が丘 神=9日/植野=17日の問い合わせは本番実データで調査しバグではないと確認・定義は変更しない)(src/utils/scheduleHtml.ts・docs/spec-schedule-pdf.md §E-2)

## v1.5.515 (2026-09-13)
- feat: 非在籍生徒一覧にだけ「削除」ボタンを残す。押すとアプリ上（基本データの両一覧・Excel 出力・取込一致）から消えるが、行は物理削除せず削除日時 `deletedAt` を記録してデータに残す（オーナー指示）。取込で削除済みを復活させず、同名・同IDは新しいIDで別生徒として追加 (basicDataModel.isStudentDeletedFromApp, withdrawGuard.ts, BasicDataScreen.tsx, deleteGuard.ts, spec-basic-data §H)

## v1.5.514 (2026-09-13)
- feat: 基本データの生徒「削除」ボタンを「退塾」ボタンに置き換え。押した日を退塾日として記録し、名簿データは残して後から非在籍一覧で追えるようにした（オーナー指示・日付入力での退塾も従来どおり・講師の削除は変更なし）(basic-data/withdrawGuard.ts, BasicDataScreen.tsx, spec-basic-data §H)

## v1.5.513 (2026-09-13)
- docs: 保護者向け固定QRの仕様に §0-3「デプロイ順の注意」を追記。新しい Hosting rewrite が指す関数がまだ無いと
  Hosting デプロイが 400(`Cloud Run service "parentportalapi" does not exist`)で落ちる(v1.5.512 で実際に発生。main マージは
  Hosting と Functions を並行に起こすため順序保証が無い)。対処は「Functions が緑になってから Hosting を再実行」＋
  `/api/parent/x` の live GET で実反映を確認、ルールは `firebase deploy --only firestore:rules` を別途実行(`docs/spec-parent-portal.md`)

## v1.5.512 (2026-09-13)
- feat: **保護者向け固定QR(第1段・開発用教室限定)** を実装(オーナー指示 2026-09-13「保護者からのQR読み込みによる室長連絡機能を開発用教室のみで実装して」。仕様 `docs/spec-parent-portal.md`・計画 §7 K-2〜K-6・INV-08/INV-07)。生徒ごとの固定QR(`/p/{トークン}`)から保護者が **通常＋振替の日程を閲覧**し、**室長へ一方向でテキスト連絡**できる。内訳: ①日程計算の権威純関数 `src/utils/parentSchedule.ts`(自己完結・盤面優先→無い日だけテンプレ補完・講習期間は一律非表示・休み→振替先は出席済みでもリンクを切らない(P-10)・講師名/机/他生徒/在庫は一切返さない)を新設し、`functions/scripts/sync-shared.mjs`(prebuild)で `functions/src/generated/parentSchedule.ts` へ複製＋パリティテストでドリフト検出 ②サーバー `parentPortalApi`(GET/POST・検証順=書式→失効→フラグ→在籍で、落ちたら教室データを読まない・回数制限はトークン1日5件/教室1時間60件・応答は no-store・ログはトークン先頭6文字だけ)と callable `issueStudentPortalToken`/`revokeStudentPortalToken`/`markParentMessagesNotified` ③トークンの権威 `studentPortalTokens`＋有効1本の索引 `studentPortalTokenOwners`(どちらもクライアント read/write 不可)・写しは `StudentRow.parentPortalToken`＋発行元教室タグ ④保護者連絡 `parentMessages`(教室メンバー read・write は CF のみ・保持365日)と室長への通知モーダル(「送信者は本人確認をしていません」注記・「確認」で既読をサーバー記録) ⑤基本データ画面の「QR」ボタン(表示・印刷1生徒1枚・再発行)。他教室コピーでは写しトークンを `stripParentPortalTokensFromStudents` で剥がす(単一権威・2026-07-09 の提出トークン混入事故と同型の穴を作らない)。テスト約250件追加。**⚠️ Firestore ルールは main マージでは反映されない → `firebase deploy --only firestore:rules` を別途実行**。functions は Actions「Deploy Cloud Functions」(main マージで自動発火・409 誤成功に注意し `/api/parent/x` の GET で実反映を確認)
- fix: 上の第1段に対するレビュー(INV 監査／セキュリティ／日程計算の突き合わせ／統合・運用の4視点)の指摘を反映。**(a)** 生徒削除時の失効を写しトークンの有無に依存させない(写しが無くてもサーバーには有効トークンが残るうえ、生徒ID `sNNN` は欠番を再利用するため、失効漏れの古いQRが後から入った別の生徒に一致して**その子の日程が旧家庭に見える**恐れがあった・INV-08) **(b)** 連絡の回数制限を「読む→判定→許可のときだけ加算」に変更(拒否でも加算していたため、1 本の漏洩QRからの連打で教室×時カウンタが上限を越え**同じ教室の他の保護者が 1 時間送れなくなる**＋書き込み課金が止まらなかった) **(c)** GET にトークンごとのスロットル(10 分 60 回・Firestore へは書かない)を追加(1 GET でスナップショット読み取り＋解凍が走るため無制限は増幅経路) **(d)** 連絡購読に `onSnapshot` のエラーコールバックを追加(ルール未反映の permission-denied が「連絡 0 件」と区別できず無音だった) **(e)** 既読化を 50 件ずつ分割(未読 51 件で「すべて確認」が丸ごと失敗し全画面モーダルが毎起動で残った) **(f)** 回数制限カウンタの文書 ID をトークン全文からハッシュへ＋ログのトークン伏せ(文書パスが例外メッセージ経由でログに出る) **(g)** 「要望・報告」の同梱スナップショットから写しトークンを除去(生きたベアラートークンを持ち出し経路に載せない) **(h)** QR モーダルを開くたびに権威トークンを取り直す(写しが失効済みを指すと死んだQRを印刷して配ってしまう) **(i)** クライアントのフラグ scope を `staging-environment` にしてサーバーの判定と同一化(staging で「ページは開けるのに QR が出ない」非対称を解消・片側昇格を字面テストで検知) **(j)** CORS を本番/staging/localhost に限定、発行時に名簿の生徒実在を確認、ゼロ幅文字を除去、`GOOGLE_CLOUD_PROJECT` へのフォールバック、机数の既定を 14(欠落時に 2 行目以降のテンプレ授業が静かに消えていた)、空 id の status で振替先を引かない **(k)** 写した定数(コマ時間・科目一覧・テンプレ曜日/時限・抑止鍵の形)を権威と突き合わせるパリティテストと、振替先が表示範囲外/休講日の盤面配置/statusSlots の体験・講習除外の欠落テストを追加。テスト +約40 件(いずれも修正なしで落ちることを確認)
- chore: CI(`ci-tests.yml`)に functions の型チェックを追加(従来 `npm run build` は functions を見ず、コンパイルエラーが「Deploy Cloud Functions が赤」になるまで分からなかった。ホスティングだけ先に緑でデプロイされ `/api/parent/**` の rewrite が 404 を指す穴)。`eslint.config.js` の無視対象に `functions/lib`(ローカルビルド出力)を追加
- chore: 確認リストを第6版 `v1.5.512` へ。第5版(p-3/p-12)は Issue #66 で OK だったので載せず、保護者QRの確認 9 件(k-1〜k-9・本番教室で入口が出ないこと k-8 と、他教室コピー直後に本番生徒のQRが出ないこと k-9 を含む)にした(`src/utils/verificationChecklist.ts`)
- docs: `docs/spec-parent-portal.md` の §0 を「採用した既定値と実装差分」へ改訂(P-1〜P-12 は推奨案のまま採用。連絡の保存先を `classroomSnapshots/{id}/parentMessages` に、POST を `/api/parent/{token}` に、発行を QR ボタン初回押下時の getOrIssue に、フラグを development-only のクライアント＋サーバー同時判定に確定。全体1分30件の制限と連絡履歴一覧は第1段では未実装)＋`docs/spec-index.md`

## v1.5.511 (2026-09-13)
- feat: 「要望・報告」に種類「使い方の質問」(category = question)を追加(計画 docs/plan-2026-09-11-five-requests.md §3 Q-2・仕様 docs/spec-developer-report.md §G・オーナー指示 2026-09-13)。不具合/要望と同じ流れ(送信→developerReports にストック→メール通知→後で開発者が対応)で、利用者への自動回答はしない。盤面 React モーダルと日程表タブの埋め込みモーダルは同じ選択肢定数から描くので両方に 3 択が出て、質問を選んだときだけ「回答は開発者が確認してからお返しします(すぐには返りません)」の注意文が出る。メール件名は【質問】付き、GitHub Issue はラベル `type:question`(リポジトリに作成済み)・タイトル `[利用者質問]`(`src/utils/developerReport.ts` / `DeveloperReportModal.tsx` / `scheduleHtml.ts` / `functions/src/developerReport.ts` / `tools/developer-report-notify.mjs`・テストに question ケースと client↔server 種別一致テストを追加)。**functions の反映は Actions「Deploy Cloud Functions」(main マージで自動発火)**
- docs: 仕様 §G 質問／§H 蓄積とまとめ読み／§I 受け入れ条件と `docs/user-manual.md` 骨子(2026-09-12 spec-curator 起草・feat/report-question)を main に取り込み。§G-3〜§G-6(承認画面・返答通知・QA 公開)と §H(ダイジェスト)は未実装(計画 Q-3〜Q-6)

## v1.5.510 (2026-09-13)
- feat: 盤面PDF「コマ選択」(`boardPrintSelection`)を開発用教室限定から全教室へ昇格(オーナー指示 2026-09-13「指定コマPDFは完了したので全教室展開して」。確認リスト第1〜5版 v1.5.500〜509 で行高さ/文字はみ出し/講師名見切れ/集団行ガイドを是正済み)。本番教室でも「PDF出力」で曜日×時限の選択モーダルが開く(初期状態は全選択＝従来と同一出力)。回帰で development-only へ戻さない(`src/utils/featureRollout.ts` / `featureRollout.test.ts` / `docs/spec-schedule-pdf.md`)

## v1.5.509 (2026-09-13)
- fix: 盤面PDFコマ選択で講師名が見切れる(2 文字は両端が欠け・3 文字は縮んでも左が欠ける)不具合を修正(確認リスト第4版 p-3・v1.5.508 の結果)。真因は講師名のはみ出し判定が td(padding 込み 56px)の幅と scrollWidth を比べていたこと。講師名ボックス自身は 50px で、しかも中央寄せ flex では左側にはみ出た分が scrollWidth に載らないため、文字幅 65px でも「収まった」扱いになっていた(実ブラウザで再現・修正後は 2 文字 25px/3 文字 17px に収束し html2canvas 描画でも欠けない)。Range の矩形で文字幅を測りボックス自身の幅と比べる `singleLineTextOverflows` に変更(`src/utils/pdf.ts`・回帰テスト3件)
- fix: 盤面PDFで集団行の未設定科目セルに画面用の操作ガイド「＋ 科目を選択」(CSS ::before)が印字されていたのを空白にする(第4版 p-3 メモ「講師未割り当ては空白でよい」)。PDF クローンから目印クラス `sa-group-subject-empty` を外す `clearGroupSubjectPlaceholdersForPdf`(全選択・部分選択とも・盤面 DOM は不変・テスト2件・`docs/spec-schedule-pdf.md`)
- chore: 確認リストを第5版 `v1.5.509` へ(p-3 の再確認と、集団行ガイドが空白になっていることの確認 p-12 のみ)(`src/utils/verificationChecklist.ts`)

## v1.5.508 (2026-09-13)
- fix: 盤面PDFコマ選択で「文字が大きすぎてセルからはみ出ている」(生徒名と学年科目が重なって見切れる)不具合を修正(確認リスト第3版 p-2/p-3・v1.5.506 の結果)。真因は v1.5.506 で生徒欄の内側(`.sa-student-inner`)を固定高さにした際、flex(column) の子が flex-shrink で押し潰されて `scrollHeight` が伸びず、はみ出し判定が一度も真にならなかったこと(緩めた上限 72px のまま描画)。子の `flex-shrink` を 0 にし、固定した内側(目印 `data-pdf-locked-height`)は子の高さの合計と固定高さを直接比べて判定する(`studentInnerContentOverflows`)。全選択(従来出力)は固定しないので不変(`src/utils/pdf.ts` / `docs/spec-schedule-pdf.md`・回帰テスト3件、修正なしで落ちることを確認)
- chore: 確認リストを第4版 `v1.5.508` へ。前回 OK の項目(c-1/p-11/h-2/h-8)は載せず、再確認 p-2/p-3 だけにした(`src/utils/verificationChecklist.ts`)

## v1.5.507 (2026-09-12)
- docs: CLAUDE.md にサービスアカウントへの `roles/logging.viewer` 付与(未実施・関数ログ読み取りワークフロー用)と、関数が「INTERNAL」しか返さないときの調べ方(REST runQuery で再現・文書ID降順は複合インデックス必須)を追記(コード変更なし)

## v1.5.506 (2026-09-12)
- fix(functions): 通常授業履歴が「取得できませんでした: INTERNAL」になる不具合を修正(確認リスト v1.5.504 h-2・Issue #63)。真因は callable `getStudentLessonHistory` の台帳クエリが文書 ID(`__name__`)の**降順**で並べていたこと。文書 ID の降順は Firestore の自動インデックスに無く、複合インデックス未作成のため FAILED_PRECONDITION「The query requires an index」で拒否され、firebase-functions が非 HttpsError を汎用「INTERNAL」に潰していた(`tools/lesson-history-diagnose.mjs` で再現・修正後は開発用教室の台帳 219 行/117 名で例外なしを確認)。並べ替えを台帳文書が必ず持つフィールド `dateKey`(単一フィールド索引は昇順・降順とも自動)に変更(`buildLatestLedgerQuery`・索引の追加デプロイ不要)。あわせて想定外の例外は原因文つきの `HttpsError('internal')` に包み、画面に理由が出るようにした(`toLessonHistoryHttpsError`・`functions/src/lessonLedgerHistory.ts` / `functions/src/index.ts`・回帰テスト追加)
- fix: 盤面PDFコマ選択で「生徒のいる行だけ高く・空席の行は低い」と行高さが揃わない不具合を修正(確認リスト第2版 p-2/p-3・Issue #63)。緩めた文字上限(最大 72px)まで大きくなった生徒名 2 行が行を押し広げていたため、部分選択では生徒欄の内側(`.sa-student-inner`)を「机行の高さ − 上下 padding」に固定し(`lockStudentInnerHeightForPdf`)、生徒文字はその高さに収まるまで縮める。全選択(従来出力)は固定しない(`src/utils/pdf.ts` / `docs/spec-schedule-pdf.md`・回帰テスト追加)
- feat: 操作を受け付けない処理中に画面全体へスピナーを出す `BusyOverlay` を追加(確認リスト v1.5.504 その他)。盤面 PDF 出力(全選択・コマ選択)とテンプレ上書き保存のレポート PDF に適用し、日程表タブの通常授業履歴の読み込み中にもスピナーを表示(`src/components/common/BusyOverlay.tsx` / `ScheduleBoardScreen.tsx` / `src/utils/scheduleHtml.ts` / `App.css`・テスト追加)
- chore: 確認リストを第3版 `v1.5.506` へ。前回 OK だった項目は載せず(オーナー指摘「以前確認し終わったものが残っている」)、再確認 3 件(p-2/p-3/h-2)と新規 3 件(c-1 リスト整理・p-11 PDF 出力中スピナー・h-8 履歴読み込み中スピナー)だけにした(`src/utils/verificationChecklist.ts`)
- chore: ログ読み取りワークフロー `functions-logs.yml` に通常授業履歴の経路診断ジョブ(`tools/lesson-history-diagnose.mjs`・Firestore 読み取りのみ)を追加。**「read-logs」ジョブはサービスアカウントに `roles/logging.viewer` が無く PERMISSION_DENIED になる(オーナーが GCP IAM で付与するまで赤)**

## v1.5.505 (2026-09-12)
- chore: Cloud Functions の実行ログを読む手動ワークフロー `.github/workflows/functions-logs.yml` を追加(読み取り専用・gcloud ログイン無しで関数の例外を確認できる。確認リスト v1.5.504 h-2「通常授業履歴を取得できませんでした: INTERNAL」の原因調査用。アプリのコード変更なし)

## v1.5.504 (2026-09-12)
- fix: 開発用教室の確認リスト(v1.5.502・受付 2026-09-11)の要改善 6 件を修正。**盤面PDFコマ選択** (p-1) 定休日(日曜)も選択候補に含める(`buildBoardPrintGrid` の isOpenDay フィルタ撤廃・モーダルは薄く表示)／出力した選択を曜日×時限のパターンとして教室ごとに `localStorage`(`board-print-selection:<教室>`)へ記憶し次回の初期状態にする(`serializeBoardPrintPattern` / `applyBoardPrintPattern`・記憶なし/壊れは全選択)。(p-2/p-3) 間引き後の表を A3 縦いっぱいに使う倍率を `resolveBoardPrintLayoutRelief` に一元化: 曜日を絞ると列が伸び(従来)、**時限を絞ると行が縦に伸びる**(従来は下半分が白紙)。文字上限は生徒 34px→最大 72px・講師名 24px→relief 倍・席番号 22px→列が伸びるときだけ relief 倍で揃えて拡大し、**講師名は列幅に収まるまで縮める**(`fitSingleLineTextForPdf`・従来は 24px 固定で 3 文字が見切れた)。PDF タイトル(=ファイル名)を選択に応じて `予定表9月14日(月)-9月16日(水) 1限-3限` の形で組む(`buildBoardPrintTitle`・全選択は従来の週タイトル)。(p-6) 集団行の時限ラベル「集団」を横書きに(縦回転 36px は 40px 行で見切れていた)。**通常授業履歴(旧・講習履歴)** (h-1) ボタン名・見出し・印刷タイトル・エラー文を「通常授業履歴」へ改名(id・メッセージ種別は不変)。(h-2) 「表示」で期間を正規化した結果を入力欄へ書き戻していたため「開始日が終了日に書き換わる」と見えていた不具合を修正: 開始日 > 終了日 は入れ替えずに理由を表示して送らず、入力欄は一切書き換えない。実際の表示期間(366日超の丸め後)は注記「表示期間」に出す(`src/utils/boardPrintSelection.ts` / `src/utils/pdf.ts` / `BoardPrintSelectionModal.tsx` / `ScheduleBoardScreen.tsx` / `src/utils/scheduleHtml.ts` / `lessonHistoryMessage.ts` / `docs/spec-schedule-pdf.md`・回帰テスト追加)
- chore: 確認リストを第2版 `v1.5.504` へ(p-8 定休日選択・p-9 選択の記憶・p-10 ファイル名を追加、p-1/p-2/p-3/p-6/h-1/h-2/h-3 の手順を修正確認用に差し替え。下書きは版別なので旧版の下書きは引き継がない)

## v1.5.503 (2026-09-12)
- feat: 開発用教室だけに確認事項チェックリストのパネルを追加(操作しながら OK/要改善+メモを記録し、下書きは教室別・版別に localStorage 保持。「保存して送信」は既存の「要望・報告」経路 submitDeveloperReport へ 2000 字ごとに分割送信。本番教室には一切出さない・src/utils/verificationChecklist.ts / src/components/developer-report/VerificationChecklistPanel.tsx)
- chore: 開発用教室から送られた「確認リスト」結果(要望・報告経路の note 先頭行マーカー `[確認リスト vX.Y.Z]`)を読み取り専用で集計する `tools/verification-checklist-report.mjs`(純関数は `tools/verification-checklist-report.lib.mjs`)を追加。Firestore への書き込みは行わない

## v1.5.502 (2026-09-12)
- fix: 「戻す」「やり直し」と一段スナップショット復元の直後に盤面が「保存済み」扱いになり保存できず、リロードで戻す前の状態へ巻き戻る不具合を修正(undo/redo を純関数 applyHistoryEntry 経由で版数 bump ＋ userInitiated:true publish／restoreUndoSnapshot は clean 化しない・INV-02)
- fix: 上記の追随(U-0c・INV-02/INV-03)。②一段スナップショット復元は盤面以外の画面からも起動でき、盤面未マウントだと未保存フラグが残留して**次に開いた教室が未保存扱いになり自動保存が走る**ため、明示 clean 化経路(読込/教室切替/ユーザー切替)で必ず落とすよう純関数 `resolveRestoreFlagLifecycle` に一元化(`src/App.tsx`)。あわせて undo/redo でも `commitWeeks` と同様に丸ごと振替の選択モード(`wholeDayTransferSourceDate`)と講師メニューを解除し、選択中の undo による古い振替元での誤実行を防止(INV-03 兄弟)
- feat: 盤面PDF出力に「コマ選択」を追加(曜日×時限のチェック表で選んだコマだけを A3 縦に最大化・初期状態は全選択＝従来と同一出力・定休日は選択不可・空選択は出力不可)。純関数 `src/utils/boardPrintSelection.ts` と DOM 間引き `pruneBoardTableForSelection`(`src/utils/pdf.ts`)を新設し、既存 `exportBoardPdf` は無改変の入口として残して全選択時はそこへ委譲する。機能フラグ `boardPrintSelection`(開発用教室のみ)・仕様は `docs/spec-schedule-pdf.md` §I-0(レビュー追修正: html2canvas の解像度 scale は選択コマ数ではなく間引き後に残る矩形サイズ(曜日数×時限数)基準に修正・空選択は無改変出力への委譲をやめ no-op に修正・生徒文字上限の定数二重定義を解消し `pdf.ts` は `boardPrintSelection.ts` の `BOARD_PRINT_STUDENT_BASE_MAX_FONT_SIZE` を正本として import・回帰防止テスト追加)
- chore: 盤面PDFの DOM 間引き(`pruneBoardTableForSelection`)を合成テーブルで検証するため devDependency に `jsdom` を追加(対象テストのみ `// @vitest-environment jsdom`。既存のユニットは従来どおり node 環境)
- feat: 講習履歴(テーマ5)の土台。台帳トークンを日付順イベントへ展開する純関数 `src/utils/lessonHistory.ts` と、教室メンバー権限で `lessonLedgerDays` を読む callable `getStudentLessonHistory`(`functions/src/lessonLedgerHistory.ts`・期間は最大366日・読み取り専用)を追加(H-1/H-2)。
- feat: 講習履歴を画面から使えるようにした(H-3/H-4)。生徒日程表タブ(別タブ)の「講習集計結果」の左に「講習履歴」ボタンを追加し、`schedule-lesson-history-request` → 本体が callable `getStudentLessonHistory` を中継 → `schedule-lesson-history-result` でタブ内オーバーレイに表示(期間指定・既定は終了日から1年・366日超は丸め、全授業種別のフィルタ、状態別集計、印刷)。台帳 `lessonLedgerDays` はクライアントから直接読めないため本体中継が唯一の経路(読み取りのみ)。表示は保存済みの記録のみである旨と保存時刻を画面に明記。機能フラグ `lessonHistory` は開発用教室のみ先行(`src/utils/lessonHistoryMessage.ts` / `src/utils/scheduleHtml.ts` / `ScheduleBoardScreen.tsx` / `adminFunctions.ts`)
- fix: 講習履歴のレビュー追修正(INV-08: 教室分離は callable 側のメンバー判定＋教室ID突き合わせの二段構え)。要求メッセージに要求元タブの教室(`DATA.classroomStorageKey`)を載せ、本体側で現在開いている教室と不一致なら callable を呼ばず「教室が切り替わっています」で弾く(`isLessonHistoryClassroomMismatch`)。応答受信側(別タブ)でも `history.classroomId` を突き合わせて不一致なら破棄。加えて (a) 授業種別ラベルの正本 `scheduleLessonTypeLabels` を functions 側複製・埋め込みJSの種別フィルタとパリティテストで一致保証し、フィルタは未知種別を無言で消さず常に表示、(b) 期間の逆転入力は「入れ替え」に統一(サーバー/埋め込みJS/純関数の3者で規則を揃える)、(c) 台帳日付キーのサーバークエリに `isLessonHistoryDateKey` の妥当性チェックを追加、(d) `lessonHistoryEnabled` フラグ OFF では中継 useEffect 自体を早期リターン、(e) 印刷タブは `document.close()` 後に `focus()/print()` を呼ぶ(`src/utils/lessonHistoryMessage.ts` / `functions/src/lessonLedgerHistory.ts` / `functions/src/index.ts` / `ScheduleBoardScreen.tsx` / `src/utils/scheduleHtml.ts`)

## v1.5.501 (2026-09-12)

- docs: 計画書 `docs/plan-2026-09-11-five-requests.md` を第4版へ改訂(コード変更なし)。オーナー指示(2026-09-12): 要望・報告・質問は**同じ扱いで「ストック → メール通知 → 後で開発者が対応」**、**AI には全データを渡してよい設計なので伏字化・除外をやめる**(操作痕跡・教室データ・送信者情報も含めてダイジェストに出す)、**実行頻度は決めない**。ダイジェストを Git 管理外(`local/`)に置く措置は AI 制限ではなく公開リポジトリへの流出防止として維持

## v1.5.500 (2026-09-12)

- docs: 計画書 `docs/plan-2026-09-11-five-requests.md` を第3版へ改訂(コード変更なし)。オーナー指示(2026-09-12)で**要望・報告・質問のすべてを当面は API を使わず「蓄積 → 後から AI でまとめて読む」方針**に変更(§3)。読み取り専用の書き出しツール `tools/developer-report-digest.mjs`(予定)で AI に渡してよい項目だけのダイジェストを作り(操作痕跡・教室データ・メール・UID は除外、本文中の生徒名は伏字)、Claude Code スキルまたは任意の AI で仕分け・重複の束ね・既知 Issue 照合・優先度案・質問の回答案を作る。ダイジェストは公開リポジトリにコミットしない(`local/`)。API 自動処理は将来オプションとして設計と費用試算だけ残す

## v1.5.499 (2026-09-11)

- docs: 計画書 `docs/plan-2026-09-11-five-requests.md` を第2版へ改訂(コード変更なし)。オーナー回答を反映: 戻るボタンの再定義は**保留**し現行バグ疑い U-0 のみ修正／盤面PDFは **A3 縦固定のまま**コマ選択印刷／質問種別は **AI 提供者非依存**(プロンプト書き出し＝ルートB・Claude Code スキル＝ルートA・API 自動＝ルートC)で**利用者への即答なし**、Claude API の費用規模を試算(Opus 5 ≈¥21/件・Sonnet 5 ≈¥8/件・Batches で半額・固定費なし)。追加要望「**保護者向け固定QR**(生徒別トークン→通常＋振替の日程閲覧＋室長へテキスト連絡・壁打ち4点=通常＋振替/アプリ内通知のみ/一方向/基本データで個別表示・印刷)」を §7 に追加(既存の QR 講習提出=Cloud Function オンデマンド型を踏襲・配布用盤面型は生徒数×編集回数の書込と公開文書常駐のため不採用・`lectureSubmissionApi` に無い所有権検証と回数制限を関数側で新設)

## v1.5.498 (2026-09-11)

- docs: オーナー要望5件(戻るボタン統一/要望・報告に「質問」+AI回答案/教室別オプション化/盤面PDFのコマ選択印刷/講習履歴)の調査結果と実装計画を `docs/plan-2026-09-11-five-requests.md` に起案(次セッション着手用・コード変更なし・役割分担=計画審査 Fable 5.1/実装 Opus/単純作業 Sonnet)。調査で判明した**現行バグ疑い「保存後に 戻る/やり直し を押すと盤面が保存済み扱いになり保存できず、リロードで巻き戻る」**(`ScheduleBoardScreen.tsx` handleUndo/handleRedo が `committedBoardChangeVersionRef` を上げず publish effect が userInitiated:false で `markStateLoadedClean` する・undo 履歴は保存で消えない・INV-02 相当)は **U-0 として最優先で計画に登録(本版では未修正)**

## v1.5.497 (2026-09-07)

- feat: 生徒日程表の講習回数表の右括弧(希望数)を印刷にも載せる(Issue #61・緑が丘の要望: 講師が紙の実績だけを見て講習終了と誤読)。紙の見出しは「講習回数(予定)」、画面は「(希望数)」のまま。印字は提出由来の希望がある個別科目だけで、フォールバック行・集団(集理/集社)・通常回数の予定数・講師日程表は従来どおり画面のみ(`scheduleHtml.ts` toCountRows の printDesired / spec-schedule-pdf §E・INV-05 準観察)

<!-- ここに編集内容を1行ずつ追記する。例:
- fix: 〇〇の不具合を修正(src/...・関連コミット xxxxxxx)
-->

## v1.5.496 (2026-09-04)

- style: 盤面の要望・報告モーダルをブラウザの表示倍率に左右されない実寸表示にした。盤面はコマ表を1週間分見るため倍率を下げて使うことが多く、モーダルまで一緒に縮んで日程表タブ(別タブ・通常100%)より読みにくくなっていた。寸法・文字を `--developer-report-unit`(vw/vh 基準・1920x1080 100% で 1px 相当・上限1.6px)基準に書き換え、倍率を下げても画面上の実寸が保たれるようにした。100% 表示時の見た目は従来と同一。(オーナー指示 2026-09-04 / src/App.css, src/utils/developerReportModalStyle.test.ts)

## v1.5.495 (2026-09-04)

- feat: 要望・報告モーダルに入力のヒント(生徒名・日付・コマ・どの操作で何が起きたかを具体的に書くと確認精度が上がる)を追加し、例文も具体化(盤面・日程表とも同一文言)。(オーナー指示 2026-09-04 / src/utils/developerReport.ts, src/components/developer-report/DeveloperReportModal.tsx, src/utils/scheduleHtml.ts, src/App.css)

## v1.5.494 (2026-09-04)

- feat: 「開発者へ報告」ボタンを「要望・報告」に改名し、種類(不具合・おかしい／追加してほしい・要望)を選んで送れるようにした(盤面・日程表とも同一モーダル・既定は不具合)。Issue のラベルは種類で type:bug / type:feature。(src/utils/developerReport.ts, src/components/developer-report/DeveloperReportModal.tsx, src/utils/scheduleHtml.ts, src/components/schedule-board/BoardToolbar.tsx, tools/developer-report-notify.mjs)
- feat: 要望・報告をメールへ即時通知する Cloud Function notifyDeveloperReportByMail(developerReports 作成トリガ・SMTP/nodemailer・env REPORT_MAIL_SMTP_URL / REPORT_MAIL_TO)。LINE 通知は撤回(オーナー判断: Messaging API の取得条件が厳しくなったため)。設定手順は docs/runbooks/monitoring.md。(functions/src/index.ts, functions/src/developerReport.ts, functions/.env.example)
- feat: 内容に「#テスト」を含む要望・報告はテスト扱いにして GitHub Issue を自動起票しない(サーバーが notifiedAt を即時に埋める・メールは【テスト】付き・結果文でテスト受付を明示)。(functions/src/index.ts, tools/developer-report-notify.mjs)

## v1.5.493 (2026-09-04)

- chore: CHANGELOG の版ラベル修正のみ(変更なし: 直前の2コミットがCIで同時にデプロイされ v1.5.492 にまとまったため、別版として書いていた CRLF 復旧の記載を v1.5.492 へ統合)

## v1.5.492 (2026-09-04)

- chore: src/App.tsx の改行コードを CRLF に戻す(内容変更なし: 同版の編集で LF 化し全行差分になっていたため。git が -text 扱いの巨大ファイルなので自動正規化されない。書き換え後は CRLF に戻してからコミットする)

- feat: 「開発者へ報告」の一言を必須化(空欄では送れない・盤面/日程表とも)、日程表側も prompt をやめ盤面と同一表示・同一文言のモーダルに統一(文言正本 DEVELOPER_REPORT_UI_TEXT)、モーダルを大きく読みやすく(幅820px・本文17px・入力7行)。(オーナー指示 2026-09-04 / src/utils/developerReport.ts, src/components/developer-report/DeveloperReportModal.tsx, src/utils/scheduleHtml.ts, src/App.tsx, src/App.css)
- feat: 利用者報告の受け取り後は勝手に修正を始めない運用を明文化(Issue 本文・CLAUDE.md・仕様)。LINE Messaging API への push 通知を追加(secrets LINE_CHANNEL_ACCESS_TOKEN / LINE_NOTIFY_TO 設定時のみ・設定手順は docs/runbooks/monitoring.md)。(tools/developer-report-notify.mjs, .github/workflows/developer-reports.yml)

## v1.5.491 (2026-09-04)

- feat: 操作痕跡の盤面差分に生徒ID(#managedStudentId・無ければ盤面id)を生徒名に添える(オーナー指示 2026-09-04: 誰の何がバグかを取り違えずに追うため)。(src/utils/operationTrace.ts)

## v1.5.490 (2026-09-04)

- feat: 「開発者へ報告」ボタンを追加(オーナー指示 2026-09-04・仕様 docs/spec-developer-report.md)。盤面ツールバーの「講師日程共有」の右と、日程表(別タブ)の「登録された講習期間を表示する」の右に色違いで配置。任意の一言は空欄でも送れる。端末内の全操作リングバッファ(commitWeeks 差分・undo/redo・保存・操作ログの写し・別タブメッセージ、教室ごと最新300件を localStorage にも保持。サーバーへは送らない)と報告時点の教室データ(未保存込み)を Cloud Function `submitDeveloperReport` へ送り、Firestore `developerReports`＋Storage `developer-reports/` に保存(本番データには書かない)。(src/utils/operationTrace.ts, src/utils/developerReport.ts, src/components/developer-report/DeveloperReportModal.tsx, functions/src/developerReport.ts, functions/src/index.ts, src/utils/scheduleHtml.ts, firebase/firestore.rules)
- feat: 開発者が報告を受け取る仕組み: GitHub Actions `.github/workflows/developer-reports.yml`(15分ごと)が未通知の報告を Issue 起票(ラベル type:bug/status:triage/source:user-report)し notifiedAt を埋める。公開リポジトリのため Issue には生徒名を含む操作痕跡・教室データを載せず置き場所だけ示す。(tools/developer-report-notify.mjs)

## v1.5.489 (2026-09-04)

- fix: 日次の保持期間掃除 `cleanupOldSaveAttempts` が毎晩 `Transaction too big` で失敗し、saveAttempts の
  30日保持が事実上無効になっていたのを修正(本番 日大前校に 2026-05-30 分から 17,519 件が滞留・
  1件最大 1MiB の文書を 300 件まとめて WriteBatch 削除していたため Firestore の 10MiB 上限超過)。
  WriteBatch をやめ並列度つきの個別 delete へ移行し、1回の実行で予算(2万件/240秒)の範囲でページを繰り返す
  ようにした。最初の教室で例外死して operationEvents / lessonLedgerDays の掃除にも到達していなかった問題も
  併せて解消(教室・コレクション単位で失敗を握って続行)。回帰テスト
  `functions/src/retentionCleanup.test.ts`(バッチへの逆戻りを実装ファイル走査で検知)
- fix: サーバー自動バックアップ・復元前スナップショット・直前ロールバックの JSON を整形出力(2スペース字下げ)
  から最小化へ変更。1本 54.3MB → 24.1MB(2.26倍の無駄)。日次400日保持(2026-09-04 開始)と教室数増加で効く。
  読み出しは `JSON.parse` なので**既存の整形済みファイルもそのまま読める**(復元仕様は不変・
  ファイル形式を gzip へ変える話とは別物)。`serializeWorkspaceBackupJson` に一本化
- fix: 復元前の安全スナップショット(`workspace-incident-backups/`)に自動削除が無く、本番に 3,978 本＝46.8GB が
  残置されていたのを **90日保持**で間引くようにした(オーナー確定 2026-09-04・仕様書 §8-1 の10番と §8-1a を改定)。
  作成時刻は GCS の `timeCreated` を正とし、**読めないもの・未来日時は削除しない**。
  掃除は `cleanupOldSaveAttempts` の同じ巡回で実施
- fix: 上記の掃除経路をレビュー指摘で堅くした。(a) 削除クエリに `.select()` を付けて本文を読まない
  (200件 × 最大1MiB を読むと memory:512MiB の関数が OOM で落ち、エラー名が変わっただけの停滞になる)。
  (b) 復元前スナップショットの間引きを Firestore 巡回より**先**に、**独立した時間予算**(90秒)で走らせる
  (後ろかつ予算共有だと、Firestore が使い切った晩は1ページ見て打ち切り、翌晩も1ページ目に戻るため
  46.8GB が永久に減らない)。(c) 削除失敗を成功件数に数えない。(d) 予算上限で打ち切ったら `logger.error`
  で出す(3ヶ月気づかなかった再発を早く見つけるため)。(e) 教室ループの手前でも予算を見る
- refactor: ページ送り・予算判断・件数集計を `runBudgetedDeletionSweep`(I/O 注入式)へ集約し、
  今回壊れていたループ本体をユニットから直接動かせるようにした(純粋関数だけのテストでは
  ループが一行も実行されていなかったのが「テストで防げなかった」構造要因)。
  コレクションと時刻フィールドの対応表も `buildRetentionTargets` としてデータ化しテストで固定
  (取り違えると掃除が静かに0件になり、operationEvents=1年 / lessonLedgerDays=2年 では1年間発覚しない)
- chore: 復元前スナップショット間引きの空実行フラグ `INCIDENT_BACKUP_PRUNE_DRY_RUN=1` を追加
  (消さずに対象をログ出力する)。本番の削除対象は実測済み: **3,963本 46.31GB を削除・15本 0.45GB を保持**。
  バケットはソフト削除7日が有効なので、削除後7日間は復旧可能（その間は容量課金も残る）
- docs: 上記に伴い `docs/spec-save-restore.md` §8-1(表の10番)と §8-1a(新設)を更新

## v1.5.488 (2026-09-04)

- feat: **日次バックアップ(JST 3:00)の保持を 7日→400日へ延長・Google Drive ミラーを gzip 化**(オーナー確定 2026-09-04・★1)。緑が丘の調査で 8/29 以前の盤面が検証不能だった教訓。Storage/Firestore は非圧縮のまま(`WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS=400`)、Drive は 15GB 上限のため `.json.gz`(`application/gzip`・multipart は Buffer 連結)で保存し、旧来の非圧縮 `.json` だけ 7 日で間引く(`shouldKeepGoogleDriveBackupByName`・移行期間の暫定)。**復元経路**: 「バックアップを読み込む」が gzip のマジックバイト判定でブラウザ内解凍(`src/utils/backupFileText.ts`・`DecompressionStream`)。往復テスト(圧縮→解凍で元 JSON と完全一致)・保持境界テスト・`.gz` 取り込みテストを追加し、保持期間スペックロックと `docs/spec-save-restore.md` §8(#7/#8・8-2)を同コミットで更新
- fix(INV監査反映 2026-09-04): ★1 の regression-reviewer 指摘を同 push で対応。①**開発者画面の「開発者バックアップを読み込む」も `.json.gz` を受け付ける**(`importWorkspaceBackup` が `file.text()` のままで Drive ミラーからの復旧本線が塞がっていた→`readBackupFileText` へ統一・accept 追加・ワークスペース全体の gz 往復テスト) ②**App 側の保持本数見積り(開発者画面の容量表示)が 7 日のまま取り残されていた**(7a9b1e2 型ドリフトの再発)→ `src/utils/backupRetentionEstimate.ts` へ切り出し 400 日(541本)に更新・スペックロックテストで固定 ③保持期間の画面文言・コメント・正本 §8-1b(自動処理は「配置」も記録する例外・record-displaced)/§8-1c/§8-2/§8-3/§8-4(Drive gzip の意図的な非対称を明記)を追従 ④gzip 本体破損・空ファイルの異常系テスト
- feat: **自動処理の記録**(★2)。人の操作でないため操作ログに載らなかった盤面の自動変更を記録: 起動時の自己修復 `auto-teacher-reconcile`(placedCount)・QR 提出/登録解除に伴う講師の自動登録/解除 `auto-teacher-assign`(メッセージ1件ずつ)・生徒の登録解除に伴う講習コマ除去 `auto-student-unassign`(source=schedule-request/submission-reset)。★操作ログの教室登録を `useLayoutEffect` に変更(盤面の起動時 effect より先に走らせないと最初の自動処理が教室未登録で捨てられる)
- feat: **保存ごとにアプリ版数と端末情報を記録**(★3)。保存リクエストに `client{appVersion,userAgent}` を添え、`saveAttempts`・`operationEvents` に保存(サーバー側で長さを切り詰め)。「古いキャッシュの版で操作していた」報告の切り分け用

## v1.5.487 (2026-09-04)

- feat: **生徒授業台帳(生徒×科目の授業実績と未消化・元コマ一覧つき)を日付ごとに記録**(オーナー指示 2026-09-04・「未消化数は重要」)。操作ログは「減った理由」しか残らず「ある時点で各生徒の授業数・未消化数がいくつだったか」は復元できない(残数は保存せず毎回計算・過去の盤面は7日分のバックアップのみ)ため、保存のたびに**盤面画面と同じ関数**(`buildMakeupStockEntries`/`buildLecturePendingItemsByEntryKey`・同じ生徒キー規則)で生徒×科目の台帳を計算し、**内容が変わったとき(または JST 日付が変わったとき)だけ**保存に相乗りさせる(新規 `src/utils/studentLessonLedger.ts`)。サーバーは `classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}` へ JST 日付ごとに1ドキュメント(同日は上書き＝その日の最終状態・本文 gzip+base64・合計値は平文)で残し、保持**2年**(`LESSON_LEDGER_RETENTION_DAYS`・`cleanupOldSaveAttempts` が同じ巡回で掃除)(新規 `functions/src/lessonLedger.ts`)。実績・配置のコマ一覧は直近400日分に絞る。失敗しても保存本体は成功のまま。閲覧は読み取り専用ツール `tools/lesson-ledger-report.mjs`(最新/指定日/生徒絞り込み/一覧)。ユニットテスト12件(計算6件・サーバー側6件)。正本 `docs/spec-save-restore.md` §8-1c・保持期間一覧 #13
- fix(INV監査反映 2026-09-04): 操作ログの regression-reviewer 指摘を同 push で対応。①**ログアウトで未送信バッファを破棄**(残すと保存失敗で戻された前ユーザーの操作が次のユーザーの保存に相乗りし実行者を誤記録) ②クライアントのバッファ上限をサーバーの1リクエスト上限と同じ **400** に(超過分が黙って切り捨てられ永久に失われる) ③種別 `record-displaced` を追加し、**生徒移動の「移)」マーカーが別生徒の出欠記録を上書きして消した**ケース(調査で実在した「席の再利用で休が消える」の移動版)も記録 ④種別一覧の二重管理ドリフト検知テスト・再送で重複しない経路テスト・上限一致テストを追加
- feat: **操作ログ(在庫が減る・記録が消える操作の監査記録)を追加**(オーナー指示 2026-09-04)。「未消化振替が減った/消えた」の問い合わせに対し、従来は15分毎の自動バックアップを前後比較して**推測**するしかなく「いつ誰が×で消したか」は残っていなかった(2026-09-04 の緑が丘校の調査でこの限界に当たった)。対象は**在庫が減る・記録が消える操作だけ**(未消化振替の×削除/未消化講習の×削除/コマ削除/格納/出欠付与/出欠解除/その日の生徒を全コマ削除/丸ごと振替/休日設定・解除)。★置き場所は**教室スナップショットの外**(`classroomSnapshots/{id}/operationEvents`)＝盤面データに混ぜると復元・ロールバックで「消した記録」ごと巻き戻り監査に使えなくなるため。★**実行者と受領時刻はサーバー(Cloud Function)が付ける**(クライアントの自己申告にしない)。クライアントは操作のたびにバッファへ積み次の保存へ相乗りさせ、失敗したら戻して再送(イベント id をドキュメント id にするので重複しない)。**保存が確定してから書き、ログの書き込みに失敗しても保存は成功のまま**にする。出欠付与では**上書きで消える出欠記録(displaced)も残す**(「休」の席に別生徒を入れて出席にすると前の生徒の「休」表示が消える件を後から追えるようにする)。保持は**1年**(`OPERATION_EVENT_RETENTION_DAYS`・既存の `cleanupOldSaveAttempts` が同じ巡回で掃除)。画面表示は無し(オーナー確定「まず記録だけ」)。ユニットテスト16件(クライアント側バッファ8件・サーバー側正規化8件)。新規 `src/utils/operationLog.ts` / `functions/src/operationEvents.ts`、`docs/spec-save-restore.md` §8-1b に正本を明記。⚠️**functions の反映は Hosting CI ではなく「Deploy Cloud Functions」ワークフロー**(`functions/**` の main マージで自動発火)

## v1.5.486 (2026-09-04)

- fix: **振替コマを「出席」にすると元コマの「休」に添えていた振替先日付が消える**のを修正(緑が丘 室長報告 2026-09-04・「休みの振替を他の日に入れて出席にしたら元のコマの振替日が消える」)。`buildLinkedLessonDestinationMap`(src/components/schedule-board/lessonLinks.ts)が振替先を配置(studentSlots)だけから集めており、出席/振無休で statusSlots へ移った振替コマを見ていなかった(cc5e5e8 導入時からの欠落)。在庫会計 `collectMakeupUsageByKey` は出席済み振替を消化として数えるので**残数は正しく表示だけ欠ける**非対称だった。本番実データ(緑が丘 9/3 時点・読み取り専用)で休み記録18件のうち出席済み振替13件が全件リンク無し、未出欠の配置5件はリンクあり。対処＝statusSlots の `attended`/`absent-no-makeup` も振替先として収集(★`absent`=在庫へ戻った振替・`moved`=移動元マーカーは対象外のまま)。盤面(BoardGrid)と生徒日程表の振替欄「→ 日付」(scheduleHtml/scheduleViewData)は同関数なので両方直る。回帰テスト4件を追加し、修正なしで2件落ち・修正ありで通ることを確認。※保証台帳の INV には該当なし(在庫会計不変・表示のみ)。仕様正本 `docs/spec-makeup-stock.md` §1-B に「出席にしても振替先表示は維持」を明記

## v1.5.485 (2026-08-29)

- docs: 第三者手動テスト(v1.5.455)への回答と再テスト版チェックリストを追加
  - docs/runbooks/コマ表アプリ動作チェックリスト(再テスト版・v1.5.484).xlsx を新規作成
    (前回結果/気づきを転記＋「開発からの回答」「再テスト」列＋色分け。◎必須21件/○推奨73件/―不要12件)
  - 正本チェックリストの期待値を v1.5.484 のオーナー確定に合わせて更新
    (No.21 1教室1タブの範囲/No.38・39・41 保存ボタン=青とラベル/No.75 黄色コマのツールチップ/
     No.143 手動追加講習の削除で希望数−1/No.148 講師登録解除の範囲/No.202 黄色コマの割振確認手順/
     No.234 学年の相互排他/No.247 校舎名・ロゴは要設定/No.259 理社は小学生限定)

## v1.5.484 (2026-08-29)

- docs: 手動テスト2026-08 由来の仕様確認8論点をオーナー確定に沿って正本へ反映(コード挙動の変更なし)
  - docs/spec-save-restore.md §1: 保存ボタンは「常に緑」を撤回し**青固定＋ラベルで状態表現**(保存/最新データ/保存中…)に改定。
    `.primary-button.is-clean` は死蔵と明記。BoardToolbar.tsx の旧仕様コメントも追従。
  - docs/spec-save-restore.md: **1教室1タブ制約は BroadcastChannel = 同一ブラウザ内のみ**を明文化(多端末の唯一の実効ガードは楽観ロック・UI警告は追加しない)
  - docs/spec-special-session-submission.md §C-1b: 黄色コマは**配置削除でも保持(一方通行)**・**黄色化後は赤字警告が出ないのが正**を確定
  - docs/spec-special-session-submission.md §E-2a(新設): 講師の登録解除は `schedule-registration` × 同セッション × 同講師の AND のみ外す(手動配置は不可侵・INV-02)
  - docs/spec-board-regular-placement.md: **5週目は特別扱いしない／授業回数＝週の数(月◯回の概念を持たない)・回数調整は室長の手動運用**を明文化
  - docs/spec-makeup-stock.md §B-2-2b(新設): 休日設定で在庫へ**戻る/戻らない**の確定一覧(status別・戻すと−1は排他)
  - docs/spec-auto-assign-rules.md: 黄色コマの自動割振は**通常の可能コマと同等・候補は講師の居る机のみ・本人在席セルはスキップ**を明文化
  - docs/runbooks/コマ表アプリ動作チェックリスト(全項目・網羅版).xlsx: No.74(赤文字条件)・No.207(黄色の一方通行)の期待値を上記確定に合わせて更新

## v1.5.483 (2026-08-29)

- fix: **日程表(講師日程表のセル・ツールチップ)も改名に追従するようにした**(手動テスト No.146 の残り・オーナー確定 2026-08-29)。v1.5.482 で盤面だけ ID 優先解決にしたため「盤面は新しい名前・講師に配る日程表は古い名前」という食い違いが残っていた。`serializeCells` で氏名を名簿の現在の表示名へ差し替える(`resolveSerializedEntryName`・`managedStudentId` で解決)。★**氏名だけが対象**で、**科目・授業種別・授業時間は配置時の値のまま**(その授業の記録なので名簿の希望科目に追従させない)。学年は生年月日から都度算出するため元から追従。名簿に無い名前(体験生・メモ)と ID を持たない旧データはそのまま。在庫キー・照合キーは従来どおり ID 優先で不変(v1.5.451 を巻き戻さない)。回帰テスト1件を追加し、名簿追従を外す mutation で2件落ちることを確認。既存テスト「表示名が古くても ID で紐付く」の**氏名の期待値のみ**新仕様へ更新(紐付け＝主眼の assert は維持)
- docs: 上記の線引き(氏名=名簿追従／科目・種別・授業時間=配置時のまま／学年=自動追従)を `docs/spec-basic-data.md` §B-1 に明文化。**保証台帳(INV)には載せない**とオーナーが判断(2026-08-29・実害が限定的でマトリクス維持コストに見合わないため。同種の再発時に昇格を検討)

## v1.5.482 (2026-08-29)

- fix(INV監査反映 2026-08-29): regression-reviewer の監査指摘(A)を同 push で修正。**No.131 の delta 記録が減算実体(current<=0 で no-op)と非対称で、提出データに当該科目が無い状態の削除→undo で希望数が 0→1 に誤増**し得た → 記録条件を `resolveDeleteSubjectDelta`(現在値>0 のときだけ)へ純関数化(回帰テスト3件)。あわせて監査指摘のテスト補強3点(講習選択のフォールバック分岐を実際に踏む fixture へ是正/opener 可視化の残り2経路〔黄色化・移動〕をスペックロック/INV-12 の配置系4経路を it.todo で可視化)と、台帳の件数更新(inv06-whole-day-transfer 39件)・INV-05 への希望数経路(undo/redo 差分適用)追記・spec-special-session-submission.md へ講習選択規則を明文化
- fix: **第三者手動テストの小粒バグ9件を一括修正**(2026-08-29・オーナー指示。各修正に回帰テスト計19件を同伴):
  - **No.22/243 日程表タブ名に教室名が出ない** … 2026-07-09 のオーナー指示のコード(`document.title = … classroomName …`)は存在したが呼び出し側が `classroomName` を渡しておらず常に空(配線漏れ)。open/sync/全員表示の5経路すべてに配線(src/components/schedule-board/ScheduleBoardScreen.tsx)
  - **No.250(INV-04) 日程表セルに講習の授業時間(60/45分)が出ない** … 描画側は対応済みだったがシリアライズが `noteSuffix` を落としていた(`SerializedStudentEntry` に項目が無い・出欠記録済みコマだけ出る非対称)。項目を追加(src/utils/scheduleHtml.ts)
  - **No.148 学年ソートが「中→小→高」** … 学年ラベルの文字コード比較(中U+4E2D<小U+5C0F<高U+9AD8)が原因。学齢順の数値キー(`resolveManagedStudentGradeSortValue`/`buildManagedStudentNameSortValue`・権威関数化)へ。表示名ソートの学年プレフィクスも同根で修正(src/components/basic-data/)
  - **No.119(INV-06) 「未消化講習」バッジが人数単位** … 行数(生徒×講習期間)を出しており「未消化振替」(コマ数合計)と単位が食い違っていた。`sumLectureStockRequestedCount` でコマ数合計へ統一(No.118「欠席にしても未消化講習に戻らない」誤認の主因)
  - **No.279 D&D 無効ドロップが無言** … 理由表示は盤面から ok:false が返るケースだけで、別タブ側で弾く不成立に else が無かった。コマのセル上の不可ドロップ(休校日/同一生徒のコマ/机情報なし)に理由オーバーレイを表示(セル外への誤ドロップは従来どおり無言キャンセル)
  - **No.131(INV-05) 講習削除の undo で希望数が戻らない** … 削除は在庫台帳(undo対象)と提出データ subjectSlots(undo対象外)の2本を動かすのに undo が片方しか戻さず、undo のたびに希望数が1ずつ欠損していた。提出データはQR提出の並行更新があるためスナップショット復元は INV-07 違反 → 操作の差分(`SpecialSessionSubjectDelta`)を履歴に記録し undo=逆適用/redo=順適用する差分方式(`applySubjectSlotsDeltaToSessions`・0クランプ・適用先消滅時は不変)
  - **No.201(INV-07) 講習期間が表示範囲に2つ重なると全員のQR/提出済みバッジが消える** … `findOverlappingSession` が「複数重複=undefined」で全消しし、トークン発行・提出状況の後追い反映(App.tsx)も止まっていた。`resolveDisplayedOverlappingSession`(表示開始日を含む講習を優先→無ければ最初に始まる講習)で1つを選ぶ方式へ(App.tsx も同規則)。**登録解除がどの講習の解除かを見ずにバッジを落とす**別バグも `qrSessionId` ガードで修正
  - **No.210(INV-07) 登録解除→再提出できない** … リセットのロジック自体は正しく、(1) opener(本体タブ)不在で postMessage が黙って捨てられ画面上は成功に見える (2) reset 失敗が `.catch(()=>{})` で握り潰される (3) QRページ `/s/**`・提出API `/api/submission/**` にキャッシュ禁止が無い、の複合。(1)明示操作(提出/解除/黄色化/移動)は反映されない旨をその場で通知(自動通知系は連発防止で対象外・スペックロック) (2)失敗を alert で可視化 (3)`no-store` を追加しヘッダ検証テストで固定(firebase.json・src/utils/hostingHeaders.test.ts)
  - **No.146 登録名の改名が盤面の既存配置に反映されない** … 表示解決が名前逆引きだけだった(在庫キーは v1.5.451 で ID 優先へ是正済み・表示だけ残存)。`resolveStudentEntryDisplayNameFromRoster`(managedStudentId 最優先→名前逆引き→そのまま)を新設し BoardGrid の表示を ID 優先へ。※日程表セルの表示名はこの版では据え置き(→ **次版で名簿追従へ揃えた**)。INV 化はオーナー判断で見送り(`docs/spec-basic-data.md` §B-1 に線引きを記録)
- docs(INV-12): **保証台帳に INV-12「配置の一意性」を新設**(オーナー承認 2026-08-29)。同一生徒を同一コマに二重配置しない保証(Issue #56 の違反履歴を transcribe)。強制層のためマトリクス `inv12-placement-uniqueness.matrix.test.ts` を新設し、`ScheduleBoardScreen.test.ts` から #56 の回帰テスト4件+テンプレ純関数化の todo を移設(テスト内容は不変・場所の昇格のみ)
- fix(Issue #59, INV-06): **丸ごと振替の振替先処分にも全コマ削除(Issue #58)と同じ振替抑制を積むようにした**(オーナー確定 2026-08-29)。振替先で処分(希望回数−1)した通常授業が、その日を後から休日設定すると自動計算(テンプレ根拠)で振替に積み直される非対称を対称化。`computeWholeDayTransfer` の Phase A が処分前に `collectClearedDayMakeupSuppressions` を通し、`nextSuppressedMakeupOrigins` を返して commitWeeks へ配線。★振替元には積まない(移送された振替コマの消化が自動 origin を打ち消して中立=#58 の moved スキップと同じ構図)。マトリクス3件を追加(inv06-whole-day-transfer 36→39件)し、収集をスキップする mutation で2件落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md・docs/spec-invariants.md)

## v1.5.481 (2026-08-29)

- fix(INV監査反映・Issue #56/#57/#58): regression-reviewer の INV 監査(2026-08-29)で見つかった3点を同 push で修正。①**moved マーカーへの抑制で「移動先の振替を休み→移動元日を全コマ削除」の順に算出復元 origin が消える誤減**(#58 の初版実装の欠陥・端到端テストで実証)→ moved もスキップに変更 ②**同日移動した通常授業は抑制の時限が盤面時限になり自動 origin(テンプレ時限)に当たらず取りこぼす**→ `sameDayMoveSourceLabel` の元時限で積むよう修正 ③**テンプレモードの入れ替えにも #56 と同型の穴(入れ替え相手の着地先に重複検査なし)が残存**→ 同じ検査を配線(テンプレ移動の純関数化+テストはフォローアップ・it.todo で可視化)。あわせて `materializeDisplacedStatusEntryIntoLedgers` の直接テスト4件を追加し、`docs/spec-invariants.md`(INV-06 違反履歴2件+マトリクス56件)と `docs/spec-makeup-stock.md`(§2 削除・「空にする」の 2026-07-06 確定の改定・§B-2-1 破棄操作の列挙に生徒移動を追加)を改定
- fix(Issue #58, INV-06): **「その日の生徒を全コマ削除」した日を休日設定すると、処分済みの通常授業が振替に積み直される**のを修正(第三者手動テスト No.121・「5週目対応が難しい」の正体)。全コマ削除は通常授業を「返さず希望回数−1(もうやらない)」で処分する(v1.5.464 裁定)のに振替抑制(`suppressedMakeupOrigins`)を積まない非対称があり、休日振替の自動計算(`computeAutomaticShortageOrigins`)が**盤面ではなくテンプレを根拠に**発火するため、盤面を空にしても振替が積み直されて「希望−1」と「振替+1」が二重にかかっていた。対処=単発削除(`handleDeleteStudent`)と同様に抑制を積む(新設 `collectClearedDayMakeupSuppressions`・処分前に収集。※単発削除は時限なし=日付丸ごと、こちらは時限つき=粒度が異なる)。★**時限つき**で積む(時限なしの日付ワイルドカードだと、同じ生徒×科目の欠席済み origin=台帳確定済みの在庫まで巻き込んで消す)。★**absent の記録には積まない**(mark-absent が台帳へ確定済み=抑制すると立っている在庫が消える誤減。attended/振無休/moved は積む)。「全コマ削除→コマを足し直して休み」は順序方式(v1.5.459)の `clearMakeupOrigins` がそのまま効いて振替に入ることもテストで固定。回帰テスト3件(INV-06マトリクス・収集を無効化する mutation で2件落ちることを確認)(src/components/schedule-board/ScheduleBoardScreen.tsx・inv06-makeup-absence-stock.matrix.test.ts)
- fix(Issue #57, INV-06): **生徒移動が移動先スロットの欠席記録を破棄し「休」表示が消える・移動由来振替の在庫が無言消滅する**のを修正(第三者手動テスト No.113)。`computeStudentMove` が移動先(と入れ替え着地)の出欠記録を一律 null 化していた(ee5728c「移)日付の滞留を消す」が absent まで巻き込み)。移動由来振替の absent は台帳に origin が無く算出で復元される(v1.5.459)ため、記録が消えると未消化振替が1件消滅していた。対処=①消すのは **moved マーカーだけ**にし absent/振無休は保持(「休」表示と在庫算出の根拠が残る) ②上書きが避けられない箇所は台帳へ確定してから消す: moved マーカー書き込みは消える記録を `displacedStatusEntries` で返し呼び出し側(盤面移動/日程表D&D)が確定、出欠付与(休み/振無休/出席)ハンドラは上書き前に確定。確定処理は休日設定・全コマ削除と同じロジックを共通関数 `materializeDisplacedStatusEntryIntoLedgers` へ切り出して一本化(reconcileHolidayDeskStockReturns も同関数へ委譲・挙動不変はマトリクス101件で確認)。★moved マーカーの削除まで保持に変えると ee5728c(移動日付の引き継ぎ)が再発するので戻さないこと。回帰テスト5件(computeStudentMove 4件+INV-06マトリクス端到端1件)を追加し、一律 null 化へ戻す mutation で4件落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・inv06-makeup-absence-stock.matrix.test.ts)
- fix(Issue #56): **入れ替え(日程表D&D/盤面)で同一生徒が同コマに二重配置される**のを修正(第三者手動テスト No.276・実例=富樫/小林のスワップで8/25に同一生徒×2)。`computeStudentMove` の入れ替え経路に2つの穴があった: ①**入れ替え相手の着地先(移動元コマ)に重複検査が皆無** ②移動先側の検査が「見つかった最初の1件が相手なら免除」のため、同コマに同一生徒が2エントリ(相手+別机)ある状態を素通り。対処=①相手の着地先にも同一生徒検査を追加してブロック ②相手を**検索から除外**する方式へ変更(免除をやめる・`findDuplicateStudentInCellByKey` を除外ID複数対応に拡張、単一 string の既存呼び出しは互換)。回帰テスト3件を同コミットで追加し、旧実装へ戻す mutation で2件落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx)。※「同一生徒の同コマ重複配置禁止」に該当する INV は台帳に無く、新 INV(配置の一意性)の追加はオーナー承認待ち(regression-reviewer 監査 2026-08-29 の指摘・完了報告で提案)

## v1.5.480 (2026-08-16)

- docs: データ保持期間(どのデータをどこまで遡れるか)をアプリ仕様として明文化(`docs/spec-save-restore.md` §8 を正本として新設・
  盤面の週/管理データ/QR提出/在籍数台帳/自動バックアップ(Storage・Google Drive)/ロールバック/saveAttempts を一覧化・
  `docs/spec-index.md` から参照)
- test: 保持期間のスペックロックを追加(24h/72h/7日・静音帯 JST3-9・日次アンカー3:00 を
  `functions/src/workspaceBackupSchedule.test.ts` に、過去6週/未来26週と「出欠を付けた週は無期限保持」を
  `src/components/schedule-board/boardWeekTrim.test.ts` に固定。数値だけが静かにドリフトするのを検知する)

## v1.5.479 (2026-08-16)

- feat: **並べ替えを2種類にした(「上に詰めて並べ替え」＋新「同席番で並べ替え」)**(オーナー要望 2026-08-16)。ツールバーの `詰めて並び替え` を `並べ替え` に変え、押すと種類を選ぶモーダル(`board-sort-menu-modal`)を出す。**同席番で並べ替え**は 1日(テンプレでは1曜日)の中で講師ができるだけ同じ席番の机に座り続けるよう並べ替える(コマ数の多い講師から順に、その講師が入っている全コマで空いている最小席番を確保。確保できない講師はそのコマの空き席へ＝部分最適)。適用範囲は従来どおり**テンプレ画面=テンプレ全体／盤面=表示中の週だけ**で、モーダルに明示した。机は中身(講師・生徒・出欠記録)ごと移動するため講師と実績の対応は崩れない(INV-01)。`packSortCellDesks` は挙動そのままに `src/components/schedule-board/deskSort.ts` へ移設し、新設 `seatSortCells` と正規化処理を共有(回帰テスト `deskSort.test.ts` 8件)

## v1.5.478 (2026-08-08)

- fix: **未来日を恒久記録できないようにした**(v1.5.477 の穴・同日発見)。台帳は write-once なので、請求画面の既定集計日「当月15日」が未来日である月の前半に手動記録ボタンを押すと、8/15 の記録が押した日の名簿で先に作られ、**15日 0:10 の定期実行が「既に記録あり」でスキップして本当の15日時点の在籍数が永久に残らなくなる**。サーバー(`triggerMonthlyStudentCountRecord`)で未来日を invalid-argument で拒否し、画面側もボタンを無効化して理由を表示(`isFutureSnapshotDate` / `isFutureBillingSnapshotDate`・両側同一規則・回帰テスト5件)。今日ちょうどの日付は従来どおり記録できる

## v1.5.477 (2026-08-08)

- feat: **毎月15日 0:00(JST)時点の在籍生徒数を Firebase に恒久記録し、請求画面がそれを読むようにした**(オーナー指示 2026-08-08)。従来は選択中の集計日で現在の名簿からライブ再計算していたため、生徒を名簿から消したり入塾日/退塾日を後から直すと「当時の人数」を再現できなかった(自動バックアップも保持は最長7日)。新設のスケジュール関数 `recordMonthlyStudentCounts`(`10 0 15 * *` / Asia/Tokyo)が `workspaces/{key}/studentCountLedger/{YYYY-MM-DD}` とその `classrooms/{classroomId}` に人数＋内訳(生徒ID)を書き込む(functions/src/index.ts)
- feat: 台帳は**書き込み一回きり(write-once)**。同じ集計日の記録があれば `batch.create` でコミットごと失敗させ、上書き・二重記録を防ぐ。Firestore ルールもクライアントからは `read` のみ・`write: false` に閉じた(firebase/firestore.rules `studentCountLedger`・回帰テスト3件を firebase/rules/firestore.rules.test.ts に追加)
- feat: 請求画面の生徒数を「恒久記録 > ライブ計算」の優先順で解決するようにした(`resolveBillingStudentCount`・src/utils/billing.ts)。記録がある日は `恒久記録` バッジ＋記録日時を表示し、現在の名簿と食い違う教室は「現在の名簿では N 人」を併記(請求額は記録値で計算)。記録が無い日は `暫定` バッジで参考値と明示(src/components/billing/BillingAutomationScreen.tsx)
- feat: 定期実行前の当月分や取り逃した日を埋めるため、集計日に記録が無いときだけ出る「この日の人数を恒久記録する」ボタンと callable `triggerMonthlyStudentCountRecord`(開発者のみ)を追加。write-once なので何度押しても既存記録は壊れない
- fix(回帰防止): 在籍判定をサーバーへ写すにあたり、クライアントの権威関数(`isActiveOnDate` / `hasGraduatedHighSchool`)と**必ず同じ答えを返す**パリティテストを追加した(functions/src/monthlyStudentCount.test.ts・13ケース)。Date の組み立て方まで写してあるのは実行環境の TZ 差で答えがズレないようにするため。片方だけ変えるとテストが落ちる
- fix(回帰防止): 「保存済み `billingMonths.studentCount` は表示に使わない」という既存ガード(古い可変値との食い違い防止)は**維持**した。台帳は別コレクションの write-once な記録で、あちらの復活ではない。ガードの維持をテストで固定(src/components/billing/BillingAutomationScreen.test.ts)

## v1.5.476 (2026-08-08)

- style: 講師共有画面フッターの「N限」を**日付のすぐ隣に寄せた**(オーナー指示 2026-08-08)。v1.5.475 では `justify-content: space-between` でボタン右端に飛ばしていたが、日付と離れて読みづらいため `flex-start` ＋ `gap: 6px` に変更。320/390/430px で最長ケース(`12/25(水) 5限`)が1行に収まることを再実測(src/App.css `.board-share-date-row`)

## v1.5.475 (2026-08-08)

- feat: **講師共有画面フッターの日付行の右に「何限か」を併記**(オーナー指示 2026-08-08)。v1.5.474 で下段を時間帯にしたことで日付行の右が余ったため、そこに `3限` を小さめ・淡色で右寄せした(時間帯だけだと何コマ目か分かりにくい)。`resolveBoardShareSlotLabel` が公開データの `slotLabel` を優先し、空/未設定なら `slotNumber` から組み立てるので**表示が空にならない**。320/390/430px で日付(最長 `12/25(水)`)＋`5限` が1行に収まることを実測(src/components/board-share/BoardShareScreen.tsx・src/App.css)
- test: 日付行のコマ番号表示(slotLabel 優先→slotNumber 補完)を固定するテストを追加

## v1.5.474 (2026-08-08)

- feat: **講師共有画面(配布用盤面)のフッターを時刻表示に変更**(オーナー指示 2026-08-08)。左下の表示を「3限」から**コマの時間帯「16:20-17:50」**に変えた(講師は何限かより何時からかを見るため)。あわせて**「今日」ボタンを廃止**し、前日/前コマ/後コマ/翌日の4つを右側いっぱいに詰め、左の日付/時間ボタンを 78px → 116px に広げた。★今日へ跳ぶ手段は**左の日付ボタン(=日付ピッカー)**が引き続き担う(消えていない)(src/components/board-share/BoardShareScreen.tsx・src/App.css)
- feat: 配布用盤面の共有データにコマの時間帯 `timeLabel` を載せるようにした(`compactBoardSharePayload`)。**公開済みの旧ドキュメントには無いので、`resolveBoardShareTimeLabel` が `slotNumber` から盤面と同じ定義で補完**する(＝共有URLを作り直さなくても時刻表示になる)。定義外のコマだけ従来の「N限」に倒す(src/integrations/firebase/boardShare.ts)
- refactor: コマ時間の定義(13:00-14:30〜19:40-21:10)を `src/components/schedule-board/slotTimes.ts` に一本化(盤面 `ScheduleBoardScreen` とモックデータで二重定義されていた)。共有画面もここを参照するため、時間帯を変えるときの直し漏れが起きない
- style: フッターのボタンを1行固定(`white-space: nowrap`)にし、幅の狭い端末(≤360px)用に文字サイズと日付ボタン幅を一段落とすメディアクエリを追加(320/390/430px で「16:20-17:50」と「前コマ/後コマ」が両方1行に収まることを実測)
- test: 時刻表示の解決規則(公開データ優先→slotNumber補完→N限フォールバック)と、共有ペイロードが `timeLabel` を落とさないことを固定するテストを追加(src/components/board-share/boardShareTimeLabel.test.ts)

## v1.5.473 (2026-08-07)

- feat(INV-01, INV-02): **生徒/講師日程表を「盤面そのまま」で描く方式を全教室へ昇格**(オーナー確定 2026-08-07。v1.5.472 で開発用教室に先行導入 → 同日確定)。これで**盤面と日程表がズレる余地が構造的に無くなる**(日程表は常に盤面の写し)。従来は日程表だけが通常授業テンプレを読み直して盤面を重ね直しており、そこが唯一のズレ発生源だった。★**保留だった「テンプレにだけ残る通常授業が日程表に湧く」件は「盤面が正」でオーナー裁定**(実測1件＝日大前 8/6 5限 絹川・山口千陽の英/通常。盤面では同日4限に稲永先生の講習で出席済み)→ 本昇格で解消。★唯一の体感差＝基本データ(通常授業テンプレ)を直しても**盤面を開いて反映するまで日程表に出ない**。`boardOnly=false` の旧経路(`overlayBoardWeeksOnScheduleCells` / `mergeManagedWeek`)は**ロールバック用に残す**(挙動は INV-01 マトリクス操作7で固定)。フラグを development-only へ戻さないこと(戻すと「盤面にあるのに日程表に無い」が再発する)(src/utils/featureRollout.ts・docs/spec-invariants.md)
- test(INV-01): 昇格の前提「テンプレ再マージを外しても範囲内の日付が欠けない」を固定するテストを追加(盤面が前週しか持たない状態から `ensureWeeksCoverDateRange` が範囲の週をテンプレから生成し、`boardOnly` でもその週が日程表に載ることを確認)。段階導入スコープのテストは all-classrooms へ更新

## v1.5.472 (2026-08-07)

- feat(INV-01, INV-02): **生徒/講師日程表を「盤面そのまま」で描く方式を、開発用教室のみで有効化**(オーナー確定 2026-08-07・段階導入)。従来の日程表は `buildScheduleCellsForRange` で通常授業テンプレを読み直し、盤面を上から重ねて**作り直して**いた。盤面自身はこの作り直しをしないため、ここが**盤面と日程表がズレる唯一の発生源**で、v1.5.471 の「出欠記録のある机がテンプレ足場講師に奪われる」不具合もここで起きた。★**テンプレの二度読みである点が要点**: 日程表へ渡す盤面は呼び出し側の `ensureWeeksCoverDateRange` が未生成週をテンプレから生成済みなので、再マージを外しても未来週が空白にならない。★**有効時の唯一の体感差**＝基本データ(通常授業テンプレ)を直しても盤面を開いて反映するまで日程表に出なくなる(＝日程表は常に盤面の写し)。本番実データ実測(2026-08-07・読み取りのみ): 日程表に出る机 10,373件のうち「盤面にあるのに日程表に無い/違う」は修正後 **0件**、「盤面に無いのに日程表にだけ出る」が **1件**(日大前 8/6 5限 絹川・山口千陽の通常授業＝テンプレにだけ残る授業)残っており、本方式で解消する。段階導入フラグ `boardOnlyScheduleCells`(development-only)で切り替え、**本番3教室は従来方式のまま無影響**(src/utils/featureRollout.ts・src/components/schedule-board/ScheduleBoardScreen.tsx・src/App.tsx)
- test(INV-01): boardOnly の一致検証テスト5件を追加(従来方式では「テンプレにしか無い通常授業が日程表にだけ湧く」ことを記録し、boardOnly では日程表に出る机が盤面と完全一致すること・出欠記録の机の講師が置き換わらないこと・盤面を書き換えないことを固定)。段階導入スコープ(本番3教室は無効)も `featureRollout.test.ts` で固定

## v1.5.471 (2026-08-07)

- fix(INV-01): 講師日程表で「出欠を記録した机」のコマが空白になり、テンプレ足場講師のページに他人の生徒が出る不具合を修正(報告: 緑が丘校 8/6 4限 加藤先生)。`mergeManagedWeek` の再付与ループが `lesson` の無い机を一律「空き机」とみなし、`statusSlots` に実績が入った机の `teacher` をテンプレ講師で上書きしていた。`hasRecordedStatusSlots` を追加し、`consumedManagedTeacherIndexes` と `targetDesk` 選定の両方で除外(src/components/schedule-board/ScheduleBoardScreen.tsx)。本番実測: 日大前 12 件・緑が丘 3 件 → 修正後 0 件
- fix(INV-01, INV-02): 兄弟監査で見つかった盤面側の同型ルートも修正。`repackTeacherOnlyDesks` の詰め直しと講習の講師自動割当の空き机判定が、出欠記録のある机を「講師だけの机」として講師名を移動/上書きしていた(記録はその場に残り別講師の実績になる)。削除 tombstone と同じ扱いで据え置く
- test(INV-01, INV-02): 回帰防止テスト4件を追加(`inv01-teacher-attribution.matrix.test.ts` に「出欠記録のみの机」操作行3件、`inv02-manual-edit-persistence.matrix.test.ts` の出欠入力行に ×詰め直し(repack) 1件)。いずれも修正なしで落ち・修正ありで通ることをミューテーションで確認

## v1.5.470 (2026-08-05)

- feat(INV-05・Step2): **生徒日程表の通常回数の括弧内(予定数)を「盤面ベース」で出す方式を、開発用教室のみで有効化**(オーナー確定 2026-08-05・段階導入)。新方式＝**その期間の実績 ＋ その期間の未振替の休み**。テンプレ由来(`expectedRegularOccurrences`)と通常側の表示調整(`scheduleCountAdjustments`)は**読み捨てる**(消さない＝ロールバックで旧版の数字を復元できるようにするため)。これにより①**出欠記録が無ければ左と括弧が必ず一致し警告が出ない** ②休んで振替がまだならその分だけ括弧が多い ③**振替を表示期間外へ置くと元の期間の括弧からも減る**(7月に休み・8月に振替なら 7月 `3(3)`／8月 `5(5)`・現行はどちらの月にも警告が残っていた) ④削除は盤面から消えるので**分岐を書かなくても括弧が減る**。⚠️**仕様上の割り切り**(オーナー承認済み): 組み忘れ・組み過ぎ・二重取りは検出しない(二重取りは欠席解除時の確認モーダルで操作時点に防ぐ方針)／休日設定・未消化一覧の×・丸ごと振替の移送で消えたコマの合図は**未消化振替パネルに一本化**(日程表には出さない)。★**増コマの予定側 +1 を新方式では同時に止めた**(盤面から直接数えるため。止めないと1コマで括弧が2増える＝v1.5.468 の二重減算と同じ「新経路を足して旧経路を外し忘れる」型)。講習の希望数は**新旧どちらでも提出データが正本のまま**(不変)。段階導入フラグ `boardBasedPlannedCount`(development-only)で切り替え、**本番3教室は旧方式のまま無影響**。埋め込みHTML経路と別タブ経路(`scheduleViewData.ts`)の**両方**に同じ式を入れた(片方だけだと経路で表示が食い違う＝INV-04)。未振替の休みは**盤面全体**から算出する(表示期間で絞ると期間外へ置いた振替を消化できない)。回帰テスト7件を追加(src/utils/scheduleHtml.ts・src/utils/scheduleViewData.ts・src/utils/featureRollout.ts・docs/spec-invariants.md・docs/spec-schedule-pdf.md)
- docs(INV-05): 保証台帳の「呼称の正本」を**旧方式(テンプレ由来)と新方式(盤面ベース)の対比表＋移行段取り**へ改定し、`docs/spec-schedule-pdf.md` の「planned の唯一の根拠は expectedRegularOccurrences」を移行中の記述へ是正(定義は台帳に1回だけ書き、PDF仕様書からは逆参照＝重複ゼロ原則)。Step2 の最優先チェック(増コマ +1 の二重計上)と、移行時に過去月の数字が一度動く点も台帳に明記

- feat(INV-05, INV-06): **生徒日程表の通常回数の括弧内を「盤面ベース」へ変える改修の土台**として、盤面だけから「まだ振替コマが組まれていない休み」を算出する純関数 `computeOutstandingAbsenceOrigins` を追加(オーナー確定 2026-08-05)。**この時点では表示は一切変えない**(呼び出し元なし・Step2 で開発用教室のみ有効化)。新仕様＝「通常回数の括弧内＝その期間の実績＋その期間の未振替の休み」で、出欠記録が無ければ左と括弧が必ず一致し警告が出ない／休んで振替がまだならその分だけ括弧が多い／振替を表示期間外へ置いたら**元の期間の括弧からも減る**(7月に休み・8月に振替なら7月は 3(3))。★**未消化在庫の台帳・「今日」・学年度を一切使わない**のがこの関数の存在意義: 在庫は(a)休日設定/格納/削除など由来の違うものが同じ器に混ざり区別できない (b)`today = new Date()` と学年度に依存して増減する (c)テンプレを曜日展開しただけで盤面に一度も存在しないコマを含む——ため、括弧の根拠にすると「操作していないのに日付が変わるだけで過去月が動く」「出欠を1件も付けていない生徒に警告が出る」が起きる(設計検証で確認)。算出は多重集合の1対1消化で、既存の在庫算出と**同じ2段消化**を共有するため `consumeOriginDates` から `consumeMatchingOriginTokens` を切り出した(挙動不変・既存73件緑を確認)。義務＝`status='absent'` の記録(振無休は実績に数えるので義務にしない)、消化＝`makeupSourceDate` を持つコマで**未出欠と出欠済みの両方を走査**(★片走査だと出席を付けた瞬間に消化が消えて振替済みの休みが復活する＝INV-06 と同じ両走査規則)。講習・体験は対象外。**INV 監査の指摘2件を反映**: ①**休み(absent)の振替コマを「消化」に数えていたため、別日へ移動した授業を休むと義務が1件も立たず静かに消えていた**(移動元は moved で義務にならないため、同じ記録が義務と消化の両方へ積まれ相殺していた。INV-06 の v1.5.459「moved-makeup-absence-loss」と同型)。休みの振替は消化に数えないよう修正。②同じ元コマを指す休みを**トークン単位で畳む** `dedupeOwedOriginTokens` を追加(「休み→振替→その振替もまた休み」は1回分の未実施なので義務1件。畳まないと2件に誤増。★同じ日でも時限が違えば別物のまま=同日2コマ休みは2件)。回帰テスト17件(+todo1)を追加し、mutation 7種(片走査へ戻す/多重集合を潰す/振無休を義務に含める/休みの振替を消化に数える/畳み込みを外す 等)で落ちることを確認済み。今日の日付を2026→2030へ変えても結果が変わらないこと・引数に在庫台帳を足せない形であることもテストで固定(src/components/schedule-board/makeupStock.ts)

## v1.5.469 (2026-08-05)

- docs(INV-05): **two-strike 到達後も準観察のまま据え置くとオーナーが判断**(2026-08-05)したため台帳へ記録。あわせて運用ルール §2 の「two-strike で昇格」を**「昇格を検討する契機／実施可否はオーナー判断」**へ明確化した(マトリクス1ファイルは以後ずっと維持コストを負い、上限15〜20件の"横に増やさない"設計原則と競合するため)。見送り時は**判断・日付・代わりの担保**を該当 INV 節へ残す運用を明記。INV-05 の代替担保＝希望数の正本の排他／削除後の希望数の実数値固定／予定側 +1 の対称性の各経路テスト(いずれも mutation で落ちることを実測確認済み)。v1.5.468 の記述に残っていた旧関数名 `resolveDeletedStudentCountAdjustments` を実装どおり `resolveDeletedStudentCountAccounting` へ是正(docs/spec-invariants.md)

## v1.5.468 (2026-08-05)

- fix(INV-05): **在庫由来(session)の講習コマを単発削除すると、生徒日程表の講習「希望数」が 2 減っていた**のを修正(オーナー確定 2026-08-05)。希望数を減らす正本が2系統あり(提出データ `subjectSlots` と表示調整 `scheduleCountAdjustments`)、単発削除が**両方**に −1 を積んでいた。確認ダイアログは「希望数が1減ります」と言うのに 2 減るため、削除しただけで「希望数と一致していません！」が**逆向きに**出る(実績1減・希望2減)。`74c830d` で `decrementSpecialSessionSubjectCount`(subjectSlots −1)を足したとき、それ以前からあった表示調整 −1 を外し忘れたのが真因。**2つの帳簿の行き先を1つの戻り値で決める純関数 `resolveDeletedStudentCountAccounting`** に固定した(`{ nextAdjustments, decrementSubjectSlots }` を返し、呼び出し側は配るだけ。判定は `isSessionLectureDeletion`)。★片方を別経路で取り直せる形だと `74c830d` と同型の事故がそのまま再発するため、**戻り値を分解して片方だけ取り直さないこと**。★兄弟監査: 「その日の生徒を全コマ削除」「丸ごと振替」は在庫へ**返す**経路なので `decrementSpecialSessionSubjectCount` を呼ばず二重減算は起きない(INV-06 の「返す＝別日にやる／返さない＝もうやらない」を維持・古いコメントを実態へ是正)。回帰テスト4件＋別タブ経路で**希望数を実数値で固定**する1件(`scheduleViewData.test.ts`)。⚠️後者は **希望3→残2 の規模**で書くこと: 希望1→残0 だと `applyCountAdjustments` の0クランプで行ごと消え「希望＝実績」に化け、**二重減算が素通りする**(実測で確認)。いずれも mutation(排他を外す)で落ちることを確認済み(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-invariants.md INV-05)
- fix(INV-05): **増コマを足すと「予定数と一致していません！」が出っぱなしになる**のを修正(オーナー確定 2026-08-05)。予定/希望側 +1 を**講習だけ**が受けていたため、室長が意図的に足した増コマは実績だけ増えて永久に警告が残っていた(その科目がテンプレ予定に無い場合は「希望=実績」フォールバックで警告が出ない、という科目による挙動差もあった)。`buildSerializedScheduleCountAdjustments` の +1 を**増コマ(extra)にも**適用した。数える条件は実績側と厳密に対称: 体験(trial)は生徒日程表に載らないので対象外／**`studentSlots` と `statusSlots` の両方を走査**(出欠を付けるとコマは statusSlots へ**移る**ため、片方だけだと出席を付けた途端に +1 が消えて警告が出る。★INV-06 と同じ両走査規則)／欠席(absent)・移動済み(moved)は実績に数えないので +1 もしない(振無休 absent-no-makeup は数えるので +1 する)。⚠️**手動追加の通常(regular)・振替(makeup)は対象外のまま**とした: 当初オーナー承認は「増コマ・手動追加の通常/振替も揃える」だったが、**本番実データの事前実測(2026-08-05・読み取り専用)で二重計上が判明**したため範囲を絞った。手動追加の通常授業のうち基本データの同じ枠(生徒/科目/曜日/時限)と重なるものが 日大前 173/223 件・緑が丘 208/269 件あり、削除調整や抑止で相殺されていないものが **54 件 / 68 件**残存。これに +1 すると予定が二重に増え、**逆に新規の警告が出る**。増コマはテンプレに存在しないためこの重複が起きない。通常/振替まで広げるにはテンプレ予定との重複排除が要る(オーナー判断待ち)。★履歴(巻き戻し注意): この special 限定ガードは `7ac998d`(v1.5.50「keep regular desired counts contract-based」)が意図的に置いたものだが、同コミットの他の3点(削除調整 −1 を予定側に効かせない／予定側から regularCountAdjustments を外す／その回帰テスト)は **`cc5e5e8`(2026-05-29 の寄せ集めコミット)で無言のうちに巻き戻り、テストも消えている**(`2dce7b4` 型の事故がこの関数で既に1件起きていた)。今回の増コマ +1 はその残りをオーナー確定で意図的に上書きしたもので、「契約ベースだから」を根拠に戻さないこと。回帰テスト6件(src/utils/scheduleHtml.ts)
- style: **生徒日程表の回数表の括弧と警告文を、通常＝「予定数」・講習＝「希望数」で呼び分けた**(オーナー確定 2026-08-05)。両方「(希望数)」表記だったが出どころが違う(通常＝基本データ/テンプレ由来の**予定**、講習＝QR提出・室長登録の**希望**)ため、通常側が提出由来だと誤読された。警告文も「希望数と予定数が一致していません！」の混在表記をやめ、通常＝「予定数と一致していません！」／講習＝「希望数と一致していません！」に分けた。いずれも画面のみ(`print-only-hidden`)で**印刷面は不変**。`data-testid` は既存のまま(src/utils/scheduleHtml.ts)

## v1.5.467 (2026-08-03)

- feat(INV-02): **丸ごと振替した日にテンプレ足場講師が湧かないようにした**(オーナー指示 2026-08-03「振替先にテンプレ講師が湧くのを止める」)。丸ごと振替は「その日の姿ごと別日へ移す」操作なので、**講師の顔ぶれもユーザーの操作結果で固定**する。実測(v1.5.466)ではリロード(テンプレ再マージ)後に 振替元=空／振替先=移送講師＋**その日のテンプレ講師** となり表示が揃わなかった(机位置がずれると再付与ループが発火)。日単位の抑止キー `TEMPLATE_TEACHER__DAY__<日付>__0` を**既存の `suppressedRegularLessonOccurrences` に相乗り**させ、`overlayBoardWeeksOnScheduleCells` が該当日の管理セルから「生徒のいない机の講師」を落とす(`stripTemplateScaffoldTeachers`)。★相乗りの理由＝この配列は保存/復元・undo/redo・publish 3経路・App のダーティ署名・overlay 受け渡しが**既に全経路で通っている**(専用フィールドは約40箇所の配線が必要で1つ漏れると黙って消える)。キーは通常の抑止キーと同じ4分割で **parts[2] が日付**＝テンプレ上書きの日付フィルタがそのまま効き、反映日以降は抑止解除でテンプレ追従へ戻る。**抑止していない日の挙動は不変**(INV-02 のテンプレ追従は維持・ロックテストあり)。**講習自動割振/QR自動配置の経路は生きている**(tombstone ではないため空き机として使える)が、⚠️**満席判定は変わる**(足場講師が落ちてその日の空き机が増えるため、従来「空き机なし」でスキップしていたコマに提出済み講師が新規配置され得る＝多角レビューで実測再現し、docs/CHANGELOG の「影響しない」という言い切りを是正)。回帰テスト3件(本番形＝テンプレに授業がある日で抑止が効くケースを含む)＋mutation 2種(抑止無効化／strip と抑止の順序入替)で落ちることを確認。★strip は必ず `suppressManagedStudentsInCell` の**後**に当てる(順序が load-bearing。先に当てると lesson 付き管理机を素通しして再付与が復活する)(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md §B-2-3・docs/spec-invariants.md INV-02)
- refactor(INV-06): **「その日の既存コマを処分する」ループを共通関数 `disposeDayDeskEntries` へ一本化**(挙動不変)。丸ごと振替の Phase A と「その日の生徒を全コマ削除」がほぼ同型の二重実装になっており、片方だけ直すと v1.5.464 で確定した会計裁定がズレる温床だった。違いはオプション2つだけ(`clearMemoSlots`＝丸ごと振替のみ true／`suppressClearedRegularOccurrences`＝丸ごと振替のみ true)にし、在庫会計はさらに `reconcileHolidayDeskStockReturns`(`includeRegularLessons:false`)へ委譲。**`studentSlots` と `statusSlots` の両方を同じ規則で走査**する形に統一(片方だけ走査は INV-06 の再発温床)。「返す」と「希望回数−1」を同時にやらない規則(`returnedEntryIds`)も1か所に集約。共通関数の回帰テスト4件を追加(既存の全コマ削除7件・丸ごと振替29件は緑のまま)

## v1.5.466 (2026-08-02)

- fix(INV-02): **丸ごと振替で講習期間外へ移した QR 提出講師を、起動時の自己修復が期間内へ置き直さない**ようにした(オーナー指示 2026-08-02「講師移動をわかって振替しているので」・v1.5.465 の丸ごと振替に対する追随)。`reconcileSubmittedTeacherPlacements` の「配置済み」判定が**講習期間内のセルだけ**を走査していたため、期間外へ意図的に移した机を「未配置」と誤判定し、起動毎に期間内へ自動配置して**手動の移動が巻き戻っていた**(移送先にも残るため同じ講師が2か所に見える)。判定を**盤面全体**へ広げて修正(この自己修復が直したい不具合は「配置が揮発してどこにも居ない」ケースなので、盤面のどこかに居るなら触らないのが正しい。揮発ケースの復旧・部分配置の尊重・未提出のスキップは従来どおり)。★**期間内限定に戻すと再発**するガード。回帰テスト2件(INV-02マトリクス29件へ+1／自己修復の経路テスト+1)を追加し、mutation で両方落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md §B-2-3・docs/spec-lecture-stock.md §4-2・docs/spec-invariants.md INV-02)

## v1.5.465 (2026-08-02)

- fix(INV-06): 丸ごと振替の INV 監査(regression-reviewer)反映。①**オーナー確定2件**=振替元の日は tombstone 化で以後講習自動割振・QR自動配置の対象外(仕様として正本明記)/QR提出講師(schedule-registration)の机を講習期間外へ移送すると次回起動の自己修復が期間内へ自動で置き直す(ブロックせず正本明記・INV-07隣接) ②確認ダイアログに**振替先で消える講師の実人数を開示**(講師カウントを机数→ユニーク実人数へ) ③空 lesson シェル非伝播/コマ構成(時限×机数)不一致・movedマーカー日のブロック/テンプレモード遷移で選択モード解除 ④権威関数の一本化=再マージ抑止 row-scan を `collectManagedOccurrenceSuppressionsForDate` へ(全コマ削除も同関数化・休日解除側は講師在籍フィルタが意図的な差のため据え置き)・講師削除 tombstone を `applyDeletedTeacherTombstone` へ(handleDeleteTeacher も同関数化) ⑤マトリクス22→**29件**(複数コマ×複数机の1対1マッピング/主用途連鎖=丸ごと振替→振替元休日設定の在庫中立(過去日=自動休校日origin発火構成)/移送側の2由来対称/増コマ・体験の移送実体+2人目スロット)・mutation 3件目(机index取り違え)で落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md §B-2-3・docs/spec-invariants.md)
- feat(INV-06): **日付クリックメニューの先頭に「丸ごと振替」を追加**(Issue #40・オーナー確定 2026-08-02)。振替元日の全コマ(講師・メモ・生徒)を同じ講師・生徒のまま振替先日へ移す。メニュー押下で**振替先選択モード**(固定バナー・週切替可・Escape/キャンセル可)に入り、振替先ヘッダークリック→件数内訳つき確認ダイアログ→実行(1回の `commitWeeks`=undo 1回で全戻り)。**移送側は在庫台帳を一切触らない在庫中立**(通常→振替変換は消化+1と使用済みorigin+1の均衡・`prepareStudentForMove` 再利用・元日へ戻る振替は通常へ復帰・講習/増コマ/体験/既存振替は素通し)。**振替先の既存コマの処分は「全コマ削除」と同一裁定へ委譲**(`reconcileHolidayDeskStockReturns` `includeRegularLessons:false`・判定を分散させない): 在庫から出したコマ(振替・session講習)=未消化へ返却(§B-2-2の由来対称を継承)/通常・体験・**増コマ(オーナー指示で消去のみ)**・手動追加=返さず消去(通常のみ希望回数−1・`returnedEntryIds`で返却分の−1を飛ばす)。**出欠記録が両日のどちらかにあれば実行不可**(出欠記録を破棄する下流操作にしない)・振替先が非営業日/同日/範囲外もブロック・振替元は空の営業日のまま残す。講師ブロックは manual固定+ID補完で移送し、振替元/上書きされた振替先の講師机は削除tombstone(再マージ・講師日程反映での復活防止)。両日とも再マージ抑止(per-studentキー+row-scan)。マトリクス新設 `inv06-whole-day-transfer.matrix.test.ts`(22件: 処分×全種別/2由来対称/在庫中立deep-equal/講師帰属・再マージ耐性=INV-01・INV-02/ブロック系)、mutation 2件(通常も返す/移送側で台帳に積む)で落ちることを確認。正本 `spec-lecture-stock.md` §4-2(3択とも定義確定・②の v1.5.464 裁定も反映)・`spec-makeup-stock.md` §B-2-3 新設・`spec-invariants.md` INV-06/01/02 更新(src/components/schedule-board/ScheduleBoardScreen.tsx・src/App.css)

## v1.5.464 (2026-08-02)

- fix(INV-06): **振替コマの「由来」で結果が食い違う**非対称を解消(オーナー指摘 2026-08-02「在庫から出したコマと盤面で移動して在庫を経由しなかったもので異なる処理にならないか」)。在庫由来(台帳に origin あり)と移動由来(在庫を経由していない)を、盤面から外す全操作 × 出欠状態で総当たり実測したところ、**出席済み・振無休の振替コマで非対称が実在**した(休日設定すると 在庫由来=残2／移動由来=残1＝移動由来だけ1コマ消える)。真因は出欠記録を在庫へ返すとき**当日**を元コマとして積んでいたこと: 在庫由来は台帳 origin の再浮上と合わせて二重計上、移動由来は当日 origin が同じ日の別 origin に吸収されて消える。対処＝**振替コマの出欠記録は状態を問わず「振替元日」で会計**し台帳にあれば積まない(`resolveAbsentMakeupOriginToMaterialize` を出席・振無休へ拡張し `resolveMakeupStatusOriginToMaterialize` へ改名・判定を1本に集約。`moved` は会計を移動先が持つので対象外／手動追加は在庫未消費のため返さず `absent` だけ §B-3 の確定により例外)。8パターンすべてで由来による差が消えたことを実測で確認。**ルール化**: 内部の道筋(再浮上に任せる/台帳へ確定する)は違ってよいが**ユーザーから見た残数は必ず一致**させる(docs/spec-makeup-stock.md §B-2-2・docs/spec-invariants.md)
- feat(INV-06): **「その日の全コマの生徒を削除」で振替・講習を未消化ストックへ戻す**ようにした(オーナー確定 2026-08-02)。従来は「ストックへの移行は行いません」と明示しつつ**台帳に origin がある在庫由来だけが勝手に戻る**非対称だった。確定仕様＝**在庫から出したコマ(振替・ストック由来の講習)は返す／通常授業・体験・増コマ・手動追加コマは返さず日程表の希望回数を1減らす**。原則は「**教室都合で外す(休日設定・全コマ削除)＝返す／1コマずつ要らないと消す(削除・一覧の×)＝返さない**」。会計は休日設定と同じ権威関数 `reconcileHolidayDeskStockReturns` へ委譲し、違いは `includeRegularLessons:false` だけにした(判定を2か所へ分散させない)。⚠️**「返す」と「希望回数−1」を同時にやってはいけない**(返す=別日にやるので回数はそのまま)ため、返した記録を `returnedEntryIds` で呼び出し側へ伝えその分の−1を飛ばす。確認ダイアログと完了メッセージも実挙動に合わせて変更。マトリクスを49件へ拡張(由来の対称性3件＋全コマ削除7件)し、当日 origin へ戻す/通常授業も返す の2 mutation で計7件落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・makeupStock.ts)

## v1.5.463 (2026-08-02)

- fix(INV-06): **休みにした振替コマが「その日を休日設定」「非営業日化」で在庫ごと消える**下流の穴を塞いだ(2026-08-01 下流監査・オーナー依頼のP0)。v1.5.459 の算出方式(台帳へ書き戻さず `absent` の出欠記録から振替元日を復元)は**出欠記録が盤面に残っている間だけ**成立する仮の姿なので、記録を破棄する操作が確定させないと消える。実測で2経路が消滅していた: ①休日設定(`handleToggleHolidayDate` が `desk.statusSlots = undefined` で破棄。`HOLIDAY_STOCK_RETURNABLE_STATUSES` が absent を外す前提「mark-absent が積み済み」は**在庫由来・通常・講習にしか当てはまらない**) ②非営業日化(`collectAbsentMakeupOrigins` が `isOpenDay=false` のセルを飛ばしていた)。対処＝①破棄する側で台帳へ確定(`resolveAbsentMakeupOriginToMaterialize`・台帳に同じ日付の origin があれば積まない/無ければ振替元日で積む・手動追加も対象=例外を作らない) ②非営業日セルも走査(在庫の**根拠**を集めるので、消化を数える他の収集関数とは判定が違う)。⚠️台帳判定は**算出由来を除いた版**(`collectMakeupOriginDatesByKey` の `includeAbsentMakeupOrigins: false`)を使う(含めると算出で復元した自分自身を「台帳にある」と誤読し、破棄と同時に消える)。⚠️同じ元コマを指す absent が複数あっても台帳へは1件だけ確定(算出側はトークン集合で畳むため)。**本番影響の事前実測(読み取り専用)**: 緑が丘校・日大前校とも非営業日セルに残る欠席記録は0件＝**在庫数は1件も増えない**(過去に休日化された分は痕跡ごと消えており復活しない)。現在リスクを抱えているのは各校1件(緑が丘 藤田/英・日大前 松島/英)。マトリクスを39件へ拡張(下流列6件)し、確定の無効化/isOpenDayスキップ復活/台帳判定に算出由来を含める の3 mutation で計7件落ちることを確認(src/components/schedule-board/makeupStock.ts・ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md §B-2-1・docs/spec-invariants.md)
- fix(INV-06): **格納(未消化振替へ戻す)が在庫由来の振替を二重に積む**誤増を修正。呼び出し側が渡す台帳は時限つきトークン(`YYYY-MM-DD#限`)なのに `resolveStoreMakeupOriginDate` が素の `includes` で**日付だけ**と比べており、「台帳に無い」と誤判定していた(時限単位化 `d02379c`/v1.5.459 の取りこぼし。ユニットの fixture がトークン化前の形のままだったため緑をすり抜けていた)。突き合わせを日付単位の権威関数 `ledgerOriginsIncludeDate` へ一本化(時限不明はワイルドカード＝過大計上しない側に倒す既存方針と同じ)。回帰テスト2件を追加し mutation で確認

## v1.5.462 (2026-08-01)

- fix: **生徒登録フォームの外部生チェックにラベルが出ず、用途不明の四角になっていた**のを修正(オーナー指摘 2026-08-01)。原因は `.basic-data-compact-form .basic-data-inline-field span { display: none }`: このフォームは他の欄がプレースホルダ(「生徒名」「入塾日を選択」)で内容を示すためラベル文言を全て隠す設計だが、**チェックボックスにはプレースホルダが無い**ので隠すと何も手掛かりが残らなかった。`.basic-data-inline-field-check` にラベル表示の上書きを追加(⚠️ この上書きを消すと再発する)。あわせて2点: (1) `.basic-data-compact-form-student` の `grid-template-columns` 末尾を `auto auto` にした(列を足さないと外部生チェックが追加ボタンの列を占め、**追加ボタンが次の行へ折り返す**)。 (2) 基底の `.basic-data-inline-field` は `min-width: 0`(伸縮する入力欄向け)だが、この欄は文字とチェックだけで伸縮の余地が無く、そのままだと横幅が詰まったときにグリッド列が 0px へ潰れてラベルが消えるため `min-width: max-content` を指定。1920px/1280px の両方でラベル(36px)＋チェック(16px)が表示され追加ボタンと同じ行に収まる(横あふれ 0)ことを実機で確認(src/App.css)

## v1.5.461 (2026-08-01)

- feat: **配布用盤面(共有URL)も外部生表記 外) に対応**(オーナー要望 2026-08-01・v1.5.460 で盤面のみ対応した続き)。共有ドキュメントに `externalStudentIds`(外部生の managedStudentId 一覧)を追加し、共有画面は `isExternalBoardShareStudent` で突き合わせて 通/振/講/増/体 を **外** に、下段チップを **外部生** に置き換える。⚠️ **名簿そのものは共有しない**(必要なのは ID の集合だけ)。未設定/型崩れの旧ドキュメントは空集合＝全員通常表示に倒す(`normalizeExternalStudentIds`・後方互換)。**公開署名(`lastPublishedBoardShareSignatureRef`)にも `externalStudentIds` を含める**: ここを外すと外部生チェックを付け外ししても署名が変わらず publish がスキップされ、配布用盤面だけ旧表記のまま取り残される。また外部生チェックは**盤面を編集しない**ため `handleBoardStateChange` 経由の公開が走らない。専用の追い公開 effect を追加したが、**★クロス教室汚染防止として「教室が切り替わった直後は公開しない」ガードを必ず残す**(切替中は actingClassroomId が先に新教室へ変わり boardState/名簿が旧教室のまま残る窓があり、そこで公開すると旧教室の盤面を新教室のトークンで配布する=2026-06-06 のクロス汚染と同じ形)。直前に公開した教室IDと外部生集合を ref で覚え、**同じ教室のまま集合が変わったときだけ**追い公開する。あわせて `isExternalStudentRow` の引数を `Pick<StudentRow,'isExternal'>` から `StudentRow` へ変更(弱い型になり isExternal 未設定の生徒を渡すと TS2559 で落ちるため)。回帰テスト7件を同コミットで追加(旧ドキュメント/重複・整列/compact 化での欠落/managedStudentId なしは対象外/全区分で 外/学年・科目・分数は維持)。外部生分岐と整列を外す mutation で3件落ちることを確認(src/integrations/firebase/boardShare.ts・src/components/board-share/BoardShareScreen.tsx・src/App.tsx)

## v1.5.460 (2026-08-01)

- feat: 生徒基本データに**外部生チェック**を追加(オーナー要望 2026-08-01)。チェックを付けた生徒はコマ表(盤面)の授業区分表記が、通)/振)/講)/増)/体) をまとめて **外)** になる。新規登録フォームと既存生徒の「編集」の両方から切り替えでき、盤面は名簿の変更を即座に反映する(保存不要の表示解決)。⚠️ **表示だけの置き換えで、`StudentEntry.lessonType` の実データは書き換えない**(オーナー判断 2026-08-01): 振替在庫・講習ストック・コマ数集計・自動割振はすべて従来どおり計上する。ここを「実データの授業区分を外部生用の値へ変える」実装にすると INV-06(在庫整合)まで巻き込むため、**その方向へ寄せてはいけない**。判定は権威関数 `isExternalStudentRow` に一本化し(`row.isExternal` を直読みしない)、盤面側は登録名・表示名のどちらでも引ける `managedStudentByAnyName` 経由の `isExternalStudentName` で解決する(名簿外の体験生・メモは常に通常表示)。`StudentRow.isExternal` は optional=未設定は通常生徒なので既存データの移行は不要。Excel の生徒シートにも「外部生」列を追加(出力は はい/空欄、取り込みは はい/○/1/true などを受ける `parseExternalStudentFlag`)。反映範囲は**盤面のみ**(生徒日程表・講師日程表・盤面共有画面は従来表記のまま=オーナー選択)。回帰テスト6件を同コミットで追加(src/components/basic-data/basicDataModel.ts・BasicDataScreen.tsx・src/components/schedule-board/BoardGrid.tsx・ScheduleBoardScreen.tsx・src/App.css)
- feat: **振替(makeup)にも授業時間(90/60/45分)を持たせた**(オーナー要望 2026-08-01)。従来は通常・増コマ・講習だけが授業時間を保持し、振替は追加時に選べず 90 分固定表示だった。生徒追加メニューに加えて**編集メニューからも変更できる**(追加でだけ選べて後から直せない非対称を作らないため・オーナー選択)。対象区分は `LESSON_TYPES_WITH_MINUTES` と権威関数 `resolveLessonMinutesNoteSuffix` へ集約し、追加/編集の2つの保存経路が同じ関数を通る(片方だけ広げると保存時に分数が落ちる)。体験(trial)は名簿外の一時登録なので従来どおり対象外。回帰テスト4件を同コミットで追加(src/components/schedule-board/mockData.ts・ScheduleBoardScreen.tsx)

## v1.5.459

- fix(INV-06): **手動追加した講習を「休み」にしても未消化講習に戻らず1コマ宙に浮く**問題を修正(オーナー確定 2026-07-31・例外を作らない)。旧挙動は「手動追加講習のため未消化講習には戻していません」で戻さなかったが、日程表では手動追加講習も**実績+1・希望数+1**(`buildSerializedScheduleCountAdjustments`)で釣り合っており、休みにすると実績だけ−1になって希望1・実績0の1コマが残る。判定を権威関数 `shouldReturnLectureStockOnAbsence` に一本化し、**休み側と休み解除側の両方が同じ関数を使う**(片方だけ広げると解除後に在庫が残って誤増する)。★判定に `specialStockSource`(session/manual)を**使わない**=使うと例外が復活する。対象外は講習期間(`specialSessionId`)を持たないコマだけで、**手動追加時も講習期間は必須入力**(「講習を追加するには特別講習を選択してください。」)なので通常は発生しない旧データ向けの保険(未消化講習は講習期間ごとに並ぶため戻し先の行が決まらない。本番2教室の手動追加講習51件はすべて講習期間あり=影響なしを実データで確認)。削除は従来どおり(ストック由来は希望数−1・手動追加は変更なし)。回帰テスト4件を同コミットで追加(ストック由来/手動追加/講習期間なし/通常・振替・増コマは対象外)(src/components/schedule-board/ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md §B-4)
- fix(INV-06): **同じ日に同じ科目の授業が2コマある日、両方を「休み」にしても未消化振替が1コマ分しか立たない**誤減を修正(オーナー指摘 2026-07-31)。未消化 origin の同一性が**日付**単位だったため、8/5 の 数4限 と 数5限 を両方休みにしても残1にしかならず1コマ消えていた。**origin を「日付＋時限」トークン(`YYYY-MM-DD#限`)で識別**するようにした(`buildOriginToken`/`parseOriginToken`)。⚠️ **時限が分からない origin はワイルドカード**として同じ日付の時限つき origin と同一視する: これを別物として数えると「元の授業の休み」と「その振替コマの休み」＝**同じ1コマ**が2件になり誤増する(過大計上しない側に倒す)。抑制・解除・消化・一覧選択も同時に時限単位へ揃えた(片方だけだと穴が空く): 削除は `suppressedMakeupOrigins` に時限を持たせて積み同じ日の別コマを巻き込まない/**時限なしの抑制(旧データ)はその日付を丸ごと落とす後方互換を維持**/`clearMakeupOrigins` は「同じ日付 かつ(時限なし or 同じ時限)」だけ外す/`consumeOriginDates` は完全一致→同日フォールバックの順で突き合わせる(フォールバックが無いと振替元ラベルから時限が取れない旧データの配置で**消化済みが未消化として再出現**する)/未消化振替一覧は同じ日付が2行並びうるため選択キーをトークン化し `resolveSelectedMakeupOrigin` が選んだ時限を配置へ引き継ぐ(旧「日付だけ」の選択も受け付ける)。保存データの移行は不要(時限不明は不明のまま動く)。マトリクスを27件へ拡張(両方休みで残2/同じ1コマを指す origin は残1/時限不明の吸収/時限つき抑制は別コマを巻き込まない/時限なし抑制の後方互換/解除の時限指定/配置選択の引き継ぎ)し、日付単位へ戻す mutation で2件落ちることを確認(src/components/schedule-board/makeupStock.ts・ScheduleBoardScreen.tsx・docs/spec-makeup-stock.md・docs/spec-invariants.md)
- fix(INV-06): **一度「削除」した日を、後からコマを足し直して「休み」にしても未消化振替に入らない**不具合を修正(スクールIE緑が丘校 室長報告 2026-07-31・大槻 8/5 5限ほか。上の moved-makeup とは**別原因**で、報告の実例はこちらだった)。`suppressedMakeupOrigins`(削除＝未消化振替一覧の×／盤面コマの削除で積まれる)は生徒×科目×**日付**の永続フィルタで解除UIが無い(Issue #39)ため、その日は恒久的にブロックされていた。過去に削除した日を持つ生徒だけ症状が出る＝「同じ休みでも生徒によって違う」の正体。**対処＝順序方式(後にやった操作が勝つ・オーナー確定 2026-07-31)**: 「休み」(`handleMarkStudentAbsent`)と「未消化振替へ戻す＝格納」(`handleStoreStudent`)は `clearMakeupOrigins` でその元コマ日の抑制を**解除**し、削除は従来どおり抑制を積む。これで「削除→足し直し→休み＝入る」「休み→×で消す＝消えたまま」の両方が操作の順番だけで説明できる。**休み解除では抑制を戻さない**(解除は台帳 origin を取り下げるだけ・二重の状態遷移を作らないための意図的な非対称)。⚠️ **算出で一律に無効化する方式(「休みの記録がある日は抑制を無視」)は採らない**: 本番実データで緑が丘13件・日大前4件が復活し、うち10件は元の予定コマが盤面に残ったまま行だけ×で消した＝**意図的な削除**だった(お盆8/11-15の一括削除125件も同種)。順序方式なら過去データは動かず、抑制されたまま残っている分は「休み解除→もう一度休み」で戻せる。**併せて手動追加コマの扱いを確定(§B-3・例外を作らない)**: 手動追加した通常・振替・増コマの休みも未消化振替へ戻す。日程表の実績カウント(`scheduleHtml.ts`)は `manualAdded` を除外せず実績+1するため、戻さないと1コマ消える(**手動追加した振替コマは台帳にも積まれず算出でも除外されて実際に消滅していた**)。`collectAbsentMakeupOrigins` の `manualAdded` 除外を撤廃。消化(配置)側が数えない非対称は据え置き＝在庫の純増はオーナー了承。マトリクスを20件へ拡張(削除→足し直し→休みで入る／`clearMakeupOrigins` 単体／手動追加振替の期待値を反転)し、両変更の mutation で3件落ちることを確認(src/components/schedule-board/ScheduleBoardScreen.tsx・makeupStock.ts・docs/spec-makeup-stock.md §2/§B-3・docs/spec-invariants.md)
- chore(INV-06): 上記修正で**未消化振替がどれだけ増えるか**を配信前に洗い出す読み取り専用レポートを追加(オーナー依頼 2026-07-31「緑が丘校と日大前校で増えるコマを全部出して」)。書き出し済みバックアップ JSON(AppSnapshot)を入力に、盤面画面と同じ計算(`buildMakeupStockEntries`)を**修正前/修正後の2通り**で回し、その差分を生徒・科目ごとの増分＋コマ単位の内訳(休みにした日・限/振替元日/増える・増えない理由)として出す。修正前の再現は「absent かつ makeup の statusSlot から `makeupSourceDate` を落とす」方式: `makeupStock.ts` で absent の statusSlots を読むのは `collectAbsentMakeupOrigins` だけで `countPlannedMakeupsByKey`/`collectMakeupUsageByKey` は absent を必ず除外するため、他の会計を一切動かさずに修正前の残数を再現できる(この前提が崩れる変更をしたらレポート側も見直す)。理由は4分類(今回の修正で戻る/在庫由来で従来から戻っていた/元コマ削除済みで復活しない/同じ元コマの振替が別に配置済みで残数に出ない)。Firestore へは読み書きせずローカルの JSON を読むだけ＝本番データ保護ルールに抵触しない。`node tools/vanished-makeup-report.mjs <JSON> [...] [--csv 出力先]`。回帰テスト5件を同コミットで追加(移動しただけ→増える/在庫由来→増えない/削除済み→増えない/同一元コマ2コマでも+1/振無休・出席・通常欠席は対象外)。`stripAbsentMakeupOrigins` を素通りさせる mutation で2件落ちることを確認(src/components/schedule-board/vanishedMakeupReport.ts・tools/vanished-makeup-report.mjs・tools/vanishedMakeupReportEntry.ts)
- chore: `makeupStock.ts` のコメントに混入していた別言語の文字を修正(和집合→和集合)。挙動に影響なし
- fix(INV-06): **生徒を「休み」にしても未消化振替に入らず1コマ消滅する**不具合を修正(スクールIE緑が丘校 室長報告 2026-07-31・大槻 8/5 5限ほか)。原因は**通常授業を別日へ移動した振替コマ**が台帳(自動休校日/同時間帯重複/手動調整)に origin を登録しない設計にあった。この種の振替コマは「盤面に置かれていること」＋「消化(plannedMakeups)と使用済み origin の打ち消し合い」で残0を保つ均衡なので、休みにすると盤面から消え、absent は消化に数えない(正)のに戻すべき origin が台帳に無く、未消化振替へ1件も戻らなかった。在庫由来(台帳に origin あり)の振替コマは正しく戻るため、**同じ「休み」でも生徒によって結果が違う**という報告どおりの症状になっていた。修正は `makeupStock.ts` の `collectAbsentMakeupOrigins` で、absent の出欠記録が盤面にある限り**振替元日を origin として算出で復元**する(台帳へ書き戻さない)。**台帳へ materialize しない理由**: (1)在庫由来では二重計上になる (2)休み解除側の同条件ガードと非対称になる (3)**既に壊れて保存済みのデータが復旧しない**。算出方式なら休み解除で自動的に消え、**デプロイ後に教室を開き直すだけで過去分も自動復旧する**(データ修復操作・本番書き込み不要)。statusSlots を持つ週は trimBoardWeeksForMemory が必ず保持するため算出元は失われない。有効 origin の決定は新設の権威関数 `resolveEffectiveMakeupOriginDates`(4発生源の和集合−個別抑制)へ一本化。**兄弟監査で同根の穴をもう1つ是正**: 格納(未消化振替へ戻す・handleStoreStudent)も移動しただけの振替コマを origin なしで盤面から外していた(出欠記録すら残らず算出でも救えない)ため、`resolveStoreMakeupOriginDate`(台帳に origin あれば積まない=二重計上防止／無ければ振替元日で積む=消滅防止)を新設。削除は従来どおり suppressedMakeupOrigins へ退避=振替対象にしない(意図的な非対称)。**先日の v1.5.447/448(休み→休み解除の未消化数量)とは無関係**で、当該ガードは両コミットの前後で不変(講習在庫・休日化のみを触っていた)＝本件は少なくとも当リポジトリ履歴の全期間で潜在していた既存バグ。回帰マトリクス `inv06-makeup-absence-stock.matrix.test.ts` 18件を同コミットで追加(休み×通常/同日移動/在庫由来の振替/移動しただけの振替/手動追加・休み解除の往復・隣接出欠〔振無休/出席/移動〕の誤増なし・格納の origin 判定・個別抑制した元コマを復活させない)。修正を戻すと3件が落ちることを mutation で確認済み。ゴールデンスナップショット(makeupStockSnapshot)は不変(src/components/schedule-board/makeupStock.ts・ScheduleBoardScreen.tsx・docs/spec-invariants.md・docs/spec-makeup-stock.md)

## v1.5.458

- fix: 検証用(サンドボックス)教室の判定を**教室名ベースから教室IDベースへ**変更(オーナー指示 2026-07-28「名前判定じゃ不安」)。テスト教室は `test_classroom_20260507_dai`(管理者 石川 / dai.in.the.mood@gmail.com / UID `6HptuGOIqHcuEAqlXxZFb7Nv3Yu1`。workspaces/main/members を読み取り専用で照合)を許可リスト `SANDBOX_CLASSROOM_IDS` に固定し、名前「テスト教室」による判定は廃止。これで(1)教室名を変えても Feature B が効き続け、(2)**別教室を「テスト教室」に改名しても他教室データを読み込めない**(本番教室の改名で穴が空くのを塞ぐ)。ID は Firestore のドキュメントID なので正規化せず完全一致(前方一致・大小差では通さない)。開発用教室の既存判定(名前「開発用教室」/ id の development・dev_ パターン)は staging を含む他環境の検証教室が外れないよう据え置き。クライアント `src/utils/developmentClassroom.ts` とサーバー `functions/src/developmentClassroomIdentity.ts` の**2か所を同内容で更新**。回帰テストを17件へ拡張し、①許可リストを空にすると落ちる ②名前判定を戻すと「名前だけでは通さない」ロックが落ちる、の両方を mutation で確認

## v1.5.457

- feat: 「他教室のバックアップをこの教室に読み込む(Feature B)」を**テスト教室でも使える**ようにした(オーナー確定 2026-07-28・手動テスト手順書をテスト教室で他教室データを使って回すため)。判定は**教室名ベース**(オーナー選択): 「開発用教室」に加え「テスト教室」を含む名前を検証用(サンドボックス)教室とみなす。**クライアントとサーバーの2か所に同じ判定がある**ため両方を更新(`src/utils/developmentClassroom.ts` の `isDevelopmentClassroom` / functions 側は index.ts 内のローカル関数を `functions/src/developmentClassroomIdentity.ts` へ切り出して同規則へ)。**混入防止ガードとセットで有効化**している点が要: この判定は Feature B の解放だけでなく「自教室が発行していない提出トークンは日程表でQRを出さない・コピー時に剥がす・そのトークンへ書き込まない」(v1.5.415/416)にも使われ、片方だけ広げると 2026-07-09 のQR混入事故(開発用教室のテストが日大前校へ書込)が再発する。読み込み元候補はサンドボックス教室を除いた全教室=本番3教室(オーナー確定「全教室をコピー元にする」)。UI文言も「開発用教室へ読み込む」→「この教室へ読み込む」等へ教室中立化。回帰テスト13件を同コミットで追加(テスト教室=true・**本番3教室は必ず false**・「テスト」を含むだけの一般教室名は false・client/server 同規則。修正なしで落ちることを mutation で確認済み)。**functions のデプロイが必要**(main マージで Deploy Cloud Functions が自動発火)
- docs: 上記に伴いチェックリストへ Feature B の確認4項目を追加(読み込み元取得/本番教室の読み込み/読み込み後のQRが自教室発行になること/本番3教室にはパネルが出ないこと)。307→310項目

## v1.5.456

- docs: 人手による全操作テストのチェックリストを v1.5.455 時点へ全面刷新(オーナー依頼 2026-07-27・`docs/runbooks/コマ表アプリ動作チェックリスト（全項目・網羅版）.xlsx` を新規追加)。前回版(2026-06-30・v1.5.355・166項目)は未マージブランチ `claude/test-procedure-docs-tm1y8t` に残ったままで約100版ぶんの新機能・仕様変更が未反映だったため、main 上の正本として作り直した。**307項目/29分類**(新規116・更新21)。実施環境は staging 前提。シート構成=進め方(版合わせ/ハードリロード/本番データ保護/合否基準)・全項目チェック(No./分類/立場/やること/こうなればOK/重要度/前回比/結果〈○×未プルダウン〉/気づいたこと。見出し固定・オートフィルタ・横向き印刷)・分類一覧・確認情報。**旧版から期待結果を訂正した主な項目**: 自動割振の制約事項はハードフィルタ化により「必ず埋まる」→「守れなければ未消化に残す」(v1.5.395)、警告表示はセル黄色背景を廃止し生徒名の赤文字は出席不可コマ配置/講師未選択の机のみ(v1.5.361/362/446)、未保存離脱はブラウザ標準の離脱確認(spec-save-restore §1)、サーバーバックアップは15分毎の経過時間ベース間引き＋静音帯スキップ(v1.5.426/431)。**新規に確認項目化した機能**: 黄色コマ(後から出席可能・v1.5.449)/講師D&Dと席入替モーダル(v1.5.422/436/453/454)/表示週選択の自作カレンダー(v1.5.429)/日程表コマ組みD&Dと机選択モーダル(v1.5.417/419/431)/別タブ日程表の自動同期スピナー/QR提出の起動時モーダル通知(v1.5.452)/提出日時・提出方法・講師版講習集計(v1.5.425)/空フォーマットの単体入力(v1.5.440/441)/講師日程表の印刷密度・給与欄2列(v1.5.443/444)/生徒・講師の削除確認モーダル(v1.5.433)/管理データの在籍表示(v1.5.434)/理社(v1.5.413)/講師選択肢の同コマ重複除外・○×記号(v1.5.359/420)/教室分離・多端末競合・1教室1タブ・講師日程共有URL。INV台帳の保証(INV-01/02/06/07/08/09/11)は実機で確認できる形に落として各分類へ配置。コード変更なし(docs のみ)

## v1.5.455 (2026-07-23)

- fix: 外形監視(uptime-check)が一時的なネットワーク瞬断で誤って赤くなり incident 起票＋失敗メールが出ていた問題を修正。問題があれば最大3回まで再試行し、連続失敗のみ異常扱いにする(誤報抑制)。回帰テストを同コミットで追加(tools/uptime-check.mjs・tools/uptime-check.test.mjs・vitest.config.ts・Issue #50)

## v1.5.454 (2026-07-21)

- style(講師D&D): 席入替の選択モーダルのボタンを上下→左右並び・同色(primary)に変更(左=講師だけ入れ替え / 右=席を入れ替え)。オーナー要望のレイアウト。機能・スコープは不変(teacherDragAndDropMoveは2026-07-09に全教室昇格済み)(src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.453 (2026-07-21)

- feat(INV-01): 講師名D&Dで生徒が絡む机へドロップしたとき、「講師だけ入替 / 生徒ごと席入替」を選ぶモーダルを追加(オーナー要望=席番号と講師生徒のペアを任意に合わせたい)。`computeTeacherMove` に `swapMode`('teacher'=従来 / 'seat'=席まるごと)を追加し、seat は講師ブロック＋生徒コンテンツ(メモ/出欠/lesson)を席番号(desk.id)固定でペアごと交換。生徒がいなければ両者同結果なのでモーダルは出さず即入替。回帰テスト(computeTeacherMove seat 3件+teacherMoveInvolvesStudents+INV-01マトリクス seat swap 3件)を同コミットで追加。開発用教室のみ有効(teacherDragAndDropMove)は不変(src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.452 (2026-07-21)

- feat(QR提出通知/INV-07): PCを閉じている間に届いたQR提出も、次回コマ表を開いた最初にモーダル通知するようにした(オーナー要望)。以前は初回スナップショット(isInitial)では一切通知せず、閉じている間の提出は起動時にモーダルへ出なかった。localStorage は使わずサーバー側で既読管理する。提出ドキュメントに既読記録 `notifiedAt` を追加(表示した提出は `markLectureSubmissionsNotified` で `notifiedAt=submittedAt` を記録し再読込での再通知を防止)。通知対象の選び方を初回/実行中で分けた: (a)起動時は当該教室の submitted 全件から「前回保存 `lastSavedAt` 以降 かつ 未通知」を拾う `selectStartupSubmissionsToNotify`。これは Cloud Functions が QR提出時に classroomSnapshot へ `countSubmitted:true` を先行マージするため、反映差分 `newlyAppliedEntries` だけでは閉PC提出を取りこぼす(regression-reviewer 指摘)ことへの対処。ウォーターマークで過去分の氾濫を、notifiedAt で再通知を、それぞれ防ぐ。(b)実行中は従来どおり `newlyAppliedEntries`(室長の手動登録は楽観更新で除外)。**INV-07**: `notifiedAt` は提出内容(status/submittedAt/unavailableSlots/subjectSlots 等)に触れない既読メタのみ。`reopenedSlots:[]` リセット・recentlyReset ガード・reflectParentOwnedSubmissionFields は無改変。回帰テスト: `selectUnnotifiedSubmissions` 4件・`selectStartupSubmissionsToNotify`(閉PC検出/ウォーターマーク境界/既通知除外/不明時は非通知)・`markLectureSubmissionsNotified`(記録/冪等/他教室ガード)3件・subscribe の notifiedAt 伝搬。(src/App.tsx・src/integrations/firebase/lectureSubmission.ts)

## v1.5.451 (2026-07-19)

- style(QR提出): iOS でも出席不可コマの表を Android と同じく画面全幅にした(オーナー要望)。表(.sub-table-wrap)への逆ズーム(1/zoom)適用条件を isAndroid 限定から「zoom≠1(=iOS/Android 共通)」に一般化(iOS/Android は viewport 520+zoom0.7 が同一のため同じ全幅になる)。見出し/ボタン等の固定px要素は 0.7 のままでボタン類は両OS現状維持。(src/components/submission/SubmissionPage.tsx)
- style(QR提出): 提出後(閲覧専用)の希望コマ数「10コマ / 90分」のテキストを科目ラベルと同じ大きさに(オーナー要望)。コマ数(主)を科目と同一の 40px、分(従)を 30px に拡大(旧 15px/12px)。(sub-subject-readonly-value / sub-readonly-minutes)

## v1.5.450 (2026-07-19)

- fix(INV-07/INV-08): 開発用教室で「管理上は提出済み(countSubmitted=true)なのに提出トークンが pending のまま＝提出用QRを再読込すると再提出(上書き)できる」非対称を修正(恩珂 呼欄で発覚)。生徒/講師の登録=常にロック・登録解除=常にリセットを本番と同一挙動にした(App.tsx の isActingDevelopmentClassroom スキップを撤廃)。教室混入(他教室=本番 doc への誤書込)は markLectureSubmissionDocAsSubmitted / resetLectureSubmissionDoc 側の doc.classroomId ガード(isForeignClassroomSubmissionDoc・actingClassroomId を貫通)で担保=App層の入力タグより権威的な doc.classroomId で守る。本番教室は doc.classroomId が常に一致するため挙動不変。反映(doc→ローカル)は従来どおり reflectParentOwnedSubmissionFields の union のみで希望科目数/配置/出席不可は不変。(App.tsx/lectureSubmission.ts・回帰テスト7件 lectureSubmission.test.ts)
- feat: 提出用QRの割り振られたコマ表記を「種別+科目」にした(例: 講習の数学→講数・通常の英語→通英・振替の国語→振国)。提出後の再読込(閲覧専用)画面でも科目まで分かる。生徒の occupiedSlots のみ対象(講師は1コマに生徒2人で科目が一意でないため種別ラベル維持)。純関数 buildOccupiedSlotLabel に切り出し。出席不可コマ/黄色コマ(後から出席可能)/希望提出内容の提出後表示は v1.5.449 で実装済み。(App.tsx/occupiedSlotLabel.ts・テスト occupiedSlotLabel.test.ts 8件)

## v1.5.449 (2026-07-18)

- fix: 黄色コマが講師の登録解除で剥がれる回帰を修正(staging実機確認で発覚)。別タブ日程表のローカル明示再構築4関数(updateUnavailableSlotsLocally/updateStudentCountLocally/updateTeacherUnavailableSlotsLocally/updateTeacherCountLocally)が reopenedSlots を落としていた(v1.5.318型の保全漏れ)。4関数すべてで保全＋回帰テスト追加(scheduleHtml.ts/scheduleHtml.test.ts)
- feat: 不可コマの「後から出席可能に変更」(黄色コマ)を追加(塚田先生要望 2026-07-18・LINE 合意)。室長が不可コマへ生徒を配置/移動/入替/手動追加/日程表D&Dしたとき確認ダイアログ承認で黄色化(reopenedSlots・提出 unavailableSlots は不変=INV-07)、講師は講師日程表の不可セルクリック→確認で黄色化。黄色コマは完全に可能コマ扱い(赤警告消去・自動割振/自動配置の候補化・○×記号は○)。登録解除でも黄色は保持、QR新規再提出でリセット、戻す操作なし(ラチェット)。日程表(画面/印刷 #f9e79f)・保護者/講師QR画面(黄色+注記)に表示。既存の不可コマ上の配置は自動変換しない(新規操作のみ)。QRドキュメントは配布情報として保持し Functions GET/POST 対応(要 functions デプロイ)。(specialSessionModel/App/ScheduleBoardScreen/scheduleHtml/scheduleViewData/scheduleViewMove/lectureStock/lectureSubmission/SubmissionPage/SpecialSessionScreen/functions・回帰テスト20件)

## v1.5.448 (2026-07-18)

- fix(INV-06 #49): 「その日を休日に設定」で出欠済み(statusSlots)の講習・振替を出欠種別を見ず無条件に在庫へ+1し二重計上/誤返却していた不具合を修正。休日化の在庫戻しを status 認識にした(reconcileHolidayDeskStockReturns へ純関数化)：欠席(absent=mark時に既に戻し済み)・移動(moved=消化は移動先が保持)は触らず二重計上を防止、出席(attended)・振替なし欠席(absent-no-makeup=mark時に在庫未処理で消化-1のまま)は在庫へ戻して過少計上(孤児化)を防止。未出欠の配置(studentSlots)は従来どおり戻す。回帰マトリクス inv06-holiday-stock-reconciliation.matrix.test.ts(16件・全statusを両方向で固定＋振替origin/dateKey/併存/改名の端ケース)
- fix(INV-06): 講習の在庫キーを managedStudentId 最優先へ統一(resolveLectureStockStudentKey)。配置後に基本データで生徒を改名すると名前逆引きが外れ配置(-1)と戻し(+1)のキーがズレて残数が壊れる問題を解消(欠席/欠席解除/格納/削除/休日化/テンプレ上書きの講習キー6+1経路)。makeup側resolveBoardStudentStockIdは既にmanagedStudentId優先で無改変

## v1.5.447 (2026-07-17)

- fix(INV-06): 講習の欠席解除で消化記録が消え未消化講習が二重計上される不具合を修正(緑が丘 犬飼凜 夏期講習 数4回で実発生)。欠席解除(handleClearStudentStatus)の session講習相殺が負値デルタ台帳に removeLectureStockCount(0以下でキー削除)を誤用し、盤面配置済みでも未消化に再出現していた。生徒を盤面へ再配置し直す操作なので appendLectureStockCount(-1) で1回積み直す reconsumeSessionLectureStock を新設して解消(回帰マトリクス inv06-lecture-stock-reconciliation.matrix.test.ts 4件)。テンプレ上書き(handleSaveRegularLessonTemplate 分岐C)は均衡復元で意味が異なるため統一せず、誤統一防止のガードコメントを付与(freeze境界の過少/過剰は Issue #48 で別途分析)
- docs(INV-06): 保証台帳 docs/spec-invariants.md に本違反(lecture-stock-clear-status-wipe)を転記し、新設マトリクス inv06-lecture-stock-reconciliation.matrix.test.ts を台帳へ反映(担保状況に Issue #48 を追記)

## v1.5.446 (2026-07-17)

- style: 盤面の生徒名赤文字の条件に「講師未選択の机に配置」を追加(オーナー指示 2026-07-17・出席不可コマ配置は従来どおり・他警告は黄背景+ツールチップのまま。shouldHighlightStudentName に missingTeacherWarning を追加 / BoardGrid.tsx・回帰テスト更新。関連: 43d9e06 の2026-07-02限定)

## v1.5.445 (2026-07-14)

- refactor: 対話用日程表の React ビュー(ドック⇄ポップアウト)を撤去。既に別タブ(生成HTML)方式へ回帰済みで本番では `scheduleReactViewEnabled=false`・staging スコープにより無効だったため、将来再検討用に温存していた React 経路一式を削除した(オーナー指示・本番挙動は不変)。削除: `src/components/schedule-view/` の ScheduleView.tsx / ScheduleViewPanel.tsx / ScheduleSheet.tsx / PopoutWindow.tsx / scheduleViewPrint.ts(+test)/ scheduleView.css、および ScheduleBoardScreen.tsx 内の React 専用 state・payload useMemo(buildStudentPayload/buildTeacherPayload 経路)・range/note/印刷委譲ハンドラ・描画・`scheduleReactViewEnabled` 分岐、featureRollout の `scheduleInteractiveReactView` エントリ。**維持(別タブ経路と共有・本番稼働中)**: `scheduleViewData.ts`(生成HTMLの表示算出正本)、`scheduleViewMove.ts`(+test・buildDeskPickerDesks は生成HTMLが使用)、`executeScheduleViewMove` 一式(別タブコマ組み studentScheduleDndMove の D&D 移動で再利用・line 8322 の request 処理)。約3,200行削減。回帰ゲート: tsc -b / eslint(0 error)/ vitest 768件全通過 / vite build 成功。別タブの生徒・講師日程表(表示/コマ組みD&D/自動同期)は既存テスト(scheduleViewData/scheduleViewMove/ScheduleBoardScreen/INVマトリクス)で保護され不変。

## v1.5.444 (2026-07-14)

- style: 講師日程表のコマ(縦書きカード)を高密度化し A3 への飛び出しをさらに減らす(src/utils/scheduleHtml.ts・オーナー要望の続き)。4点: (1) 生徒1人(is-single)の名前/メタ文字サイズを2人(is-pair)と統一(画面・印刷の全密度段で is-single を is-pair 規則へ同居。1人だけ大きくして余白を取らない)。 (2) 名前まわりの上下余白と名前↔メタ(科目/種別/状態)の空きを詰める(teacher-lesson-person の gap/padding を 0、講師カードのコマ余白も 0)。 (3) メタは科目・種別(通/振/講)・状態(出/休/振無休)を空白なしで連結(例「数60通出」)。 (4) 出席の状態ラベルはセルでは1文字「出」に(tooltip の verbose は「出席」を維持)。加えて講師シート限定で日付/曜日ヘッダの上下余白を詰める([data-role="teacher-sheet"] 限定で生徒日程表へは波及なし)。すべて講師セル/講師シート限定で生徒日程表は無改変。回帰テスト2件追加(getCompactStatusLabel の '出'/メタ空白なし連結/is-single 同居/gap0)。ブラウザ実測: 8限×5日の重い講師で変更前 A4 縦オーバー130px→A3化だったのが、変更後オーバー0px→A4 に収まる(A3化せず)ことを確認。

## v1.5.443 (2026-07-14)

- style: 講師日程表を A4 横1枚に収めやすくレイアウト調整(src/utils/scheduleHtml.ts)。オーナー要望・印刷最適化。3点: (1) 休み生徒の席に別生徒が重なってコマ人数が通常の2席を超えたとき、溢れた休み生徒をセルから間引く新純関数 selectVisibleTeacherCellStatuses を追加(実配置生徒が居るコマのみ・出席実績は席占有としてカウント・溢れた分だけ非表示。単なる休み=実生徒1+休み1=2人は従来どおり表示。tooltip は全員保持)。 (2) 講師日程表の下段から振替授業欄を削除(週グリッド内の振替コマ自体は不変)。 (3) 空いた横幅を給与計算欄へ回し、レッスン行を常に左右2列(.salary-columns)へ振り分け+2列時は数値列/単価入力を細くしフォント1px詰めでラベル切れ防止。縦スクロール枠(salary-scroll)を廃止し縦伸びを解消(A3自動切替はシート本体はみ出しの安全網のみ残す)。合計計算は .salary-section 全体集計のまま不変。回帰テスト7ケース追加(scheduleHtml.test.ts・renderSalarySection を実体呼び出しして単一section内に全入力＋合計が収まることも実行時に固定)。ブラウザ実測で A4横に収まり(A3化せず縦はみ出し0)・ラベル無切れ・合計計算(A60小計＋事務給→合計)OKを確認。表示層のみの変更で講師帰属(INV-01)・回数表示(INV-05)・振替在庫(INV-06)の保証本体は不変(regression-reviewer 監査済・マージ可)。React版日程表経路(scheduleReactViewEnabled=false で棚上げ中)は未追従＝将来再有効化時の経路乖離に注意

## v1.5.442 (2026-07-12)

- refactor: 教室コピー時の「提出トークン消し」が2か所に別実装だったのを一本化(レビュー報告の指摘)。剥がすフィールド(submissionToken / submissionTokenClassroomId)の定義を developmentClassroom の唯一の権威関数 stripSubmissionToken / stripSubmissionTokensFromInputs に集約し、buildDevelopmentClassroomCopyPayload のインライン分割代入を廃してこれへ委譲。stripForeignSubmissionToken も同関数へ委譲(条件判定のみ担当)。挙動は不変(無条件で全トークンを剥がす)・書き込み経路や他教室には一切影響なし。回帰テスト追加(src/App.tsx・src/utils/developmentClassroom.ts)

## v1.5.441 (2026-07-12)

- fix: 空フォーマットの連絡事項/オプション欄をクリックしても入力モードに入れなかった不具合を修正(INV-04)。body.all-view .sheet の pointer-events:none(一覧は非操作)を空フォーマット欄が継承していたため。data-empty-format-field 欄だけ pointer-events:auto へ再有効化する上書きをポップアップに注入。実ブラウザで elementFromPoint がフィールドに当たること・クリックで focus/入力できることを確認。回帰テスト追加(v1.5.440 で入った同機能の欠落)(src/utils/scheduleHtml.ts)

## v1.5.440 (2026-07-11)

- feat: 講習集計結果(生徒版)に「オプション」列と「オプション有 N人」集計を追加(開発用教室=optionFieldEnabled 限定)。各生徒の学年別オプションのうちチェック済み項目のラベルを表示する。純関数 formatLectureOptionCell を追加し回帰テストで固定。非開発用教室では列・集計とも従来とバイト等価(src/utils/scheduleHtml.ts)
- style: 集団授業 出席者一覧の印刷HTMLを内容幅で左詰めに変更(table幅100%→auto・roster-col伸長廃止)。無駄に横長だったのを解消。最右に手書きチェック用の空「チェック欄」列を追加(空行colspan 3→4)(src/components/schedule-board/groupAttendanceHtml.ts)
- feat: 空フォーマット単体で共通連絡事項(学年別)・個別連絡事項・オプションを入力/保持できるように変更(オーナー確認済み・INV-04)。実データ(scheduleNotes)から切り離した空フォーマット専用ストレージ(sharedGlobalStoragePrefix + 'empty-format:')へ保存する data-empty-format-field 方式に切替。開いても自動印刷せず「編集してから印刷」(印刷ボタン+入力保持スクリプト buildEmptyFormatEditorScript を注入)。通常の生徒日程表の保存経路(data-note-key/memo-input)は不変。埋め込みスクリプトの構文妥当性は new Function パーステストで固定(src/utils/scheduleHtml.ts)
- chore: 空フォーマットのロゴ欄・校舎名/TELは従来どおり生徒日程表と共通の共有ストレージから流し込み(applyEmptyFormatBranding)を維持(既実装の確認)

## v1.5.439 (2026-07-11)

- fix: 講師の講習登録解除で提出が復活しうる回帰を修正(INV-07)。schedule-teacher-count-save の解除経路が recentlyReset ガードへ add せず bare reset していたため、解除直後の古い submitted 購読で countSubmitted と盤面自動配置が復活していた(生徒版 v1.5.392 の講師版・INV駆動レビュー2026-07-11で確認)。生徒/講師の解除を guardAndResetLectureSubmissionDoc へ集約し非対称を構造的に解消(src/integrations/firebase/lectureSubmission.ts・src/App.tsx)
- test: INV-07回帰防止テストを追加(登録解除は reset 前に必ずトークンをガードする。ガードを外すと落ちるmutation確認済み・src/integrations/firebase/recentlyResetGuard.test.ts)

## v1.5.438 (2026-07-11)

- docs: INV-02「非manual講師の既知乖離」を仕様確定で決着(コード無変更・INV-02)。実地調査でユーザーの講師配置は全経路manual扱い=自動処理で不可侵と判明し「手動配置が消える」は前提誤り。非manual=テンプレ足場講師のテンプレ追従を確定仕様として台帳へ記載、テスト2074に関する誤記(非manualクリアをロック中→実際はmanual生存方向のみ)も訂正(docs/spec-invariants.md)
- test: inv02マトリクスのit.todoを講師帰属境界の仕様ロック4件へ置換(テンプレ足場の追従クリア/再付与・manual配置不可侵・QR自動割当不可侵。24+todo1→28テスト・INV-02)
- chore: 残課題「出勤不可テンプレ講師の赤置き直し」をIssue #47として分離起票(実装前に懸案+妥協案の擦り合わせ要)

## v1.5.437 (2026-07-11)

- docs: 横断保証(INV)台帳を制度化(docs/spec-invariants.md 新設・11件=強制7+準観察4・オーナー承認済み文言/例外/違反履歴/担保状況。spec-index.md に独立セクション追記)
- feat: INV改定ガードをCIへ追加(.github/workflows/ci-tests.yml の inv-guard ジョブ。*.matrix.test.ts を触る差分は spec-invariants.md の改定を伴わないと落ちる=assert薄化防止)
- test: INV-01 講師帰属一意の操作マトリクステスト新設(inv01-teacher-attribution.matrix.test.ts・14件。配置/移動/講師swap/削除/生徒swap × 直後/再マージ/serialize往復。INV-01)
- test: INV-02 手動編集永続の操作マトリクステスト新設(inv02-manual-edit-persistence.matrix.test.ts・24件+todo1。6手動編集 × 再マージ/自動割当/詰め直し/リロード。非manual講師×再マージはオーナー裁定「テンプレ反映日適用時のみテンプレが正」と現実装が乖離のため it.todo で可視化・修正は別タスク。INV-02)
- chore: 保守体制へINV制度を組込(CLAUDE.md にINVアンカー節、dev-fix にUX系バグの完了定義4点、regression-reviewer をINV監査ゲートへ昇格、spec-curator を台帳管理者化)

## v1.5.436 (2026-07-11)

- fix: 講師のD&D入れ替え(swap)後に、講師日程表で同じ生徒が旧講師・新講師の両ページに二重表示される不具合を修正。テンプレ配置由来で teacherAssignmentTeacherId を持たない講師どうしを入れ替えると、着地した机が id を欠いたまま残り、書き出し(scheduleHtml serializeCells)が生徒の基本データ担当講師(=旧講師)の regularTeacherIds を採用して二重表示していた。swap では生徒が動かず v1.5.388 の同日移動ガードが発火しないための穴。computeTeacherMove が着地講師名から id を解決して teacherAssignmentTeacherId を補完(盤面の resolveTeacherIdForDesk と同じ照合規則)。既に id を持つ机は上書きせず、マスタ照合不可の旧表示名は補完しないため 5395a05 の regularTeacherIds フォールバックは不変。開発用教室のみ先行機能で未本番(src/components/schedule-board/ScheduleBoardScreen.tsx・回帰テスト2件追加=修正前に落ちる)

## v1.5.435 (2026-07-11)

- fix: 消した講師が更新後に赤く盤面へ戻る不具合を修正。講師削除の tombstone(source='deleted')を repackTeacherOnlyDesks が「講師名が空の机」として巻き込みクリアしていたため、テンプレ再マージで削除講師が復活していた。repack が tombstone を消さないようにし、手動編集(削除/手動配置)を再マージより優先して永続化(src/components/schedule-board/ScheduleBoardScreen.tsx・回帰テスト5件追加)
- fix: 上記の続き。講習の講師自動割当 autoAssignTeacherToSpecialSession も削除 tombstone(teacher='')を「空き机」とみなして上書きし(source='deleted'→'schedule-registration')削除記録を壊していた。この経路は起動毎に reconcileSubmittedTeacherPlacements から自動で走るため、repack だけ直しても更新で削除講師が復活していた。空き机カウント/配置先選択から tombstone を除外(mergeManagedWeek の !manualTeacher ガードと同様)。回帰テスト1件追加(修正前に落ちる。多エージェント検証で発覚)

## v1.5.434

- feat: 管理データ画面の在籍表示を入塾日不問へ変更(オーナー指示)。入塾日が未来でも在籍として名簿に出し、退塾日は当日在籍・翌日以降を非在籍に。高3卒業は卒業日(翌3/31)を退塾日として自動補完して非在籍表示。盤面/請求/日程表の共有判定(isActiveOnDate/resolveScheduledStatus)は従来どおり入塾日前・卒業で非在籍のまま(この画面限定)。新設 resolveManagedRosterStatus/resolveEffectiveManagedWithdrawDate/resolveManagedStudentGradeLabel/compareManagedStudentsByGradeThenName(src/components/basic-data/basicDataModel.ts・BasicDataScreen.tsx)＋回帰テスト7件(管理挙動・共有isActiveOnDateロック含む)・spec-basic-data.md 更新

## v1.5.433 (2026-07-10)

- feat: 基本データの生徒/講師削除に確認モーダルを追加(window.confirm 廃止)。不可逆である旨・データを残すなら退塾日で非表示にできる案内・未消化の講習/振替が残る生徒への警告・本番はログインアカウントのパスワード再認証を要求(src/components/basic-data/BasicDataScreen.tsx・deleteGuard.ts)。富樫兄弟(講習提出済み)の誤削除で講習一覧に生ID表示された事象の再発防止。
- feat: 盤面(ScheduleBoardScreen)が未消化の講習/振替残数を生徒ID単位で親へ通知し、削除警告に利用(onDeletionStockSummaryChange・App.tsx)。
- test: 削除ガードの純ロジックに回帰テストを追加(deleteGuard.test.ts・講習のみ/両方/なし/講師除外/名前フォールバック)。

## v1.5.432 (2026-07-10)

- docs(保守体制にオーナー要望3点を明文化・オーナー指示 2026-07-10): ①**隔離開発環境(staging)と本番の版を常に一致** — どちらでも動作確認するため。常時CI自動追従はせず「staging で新機能の実装・検証を始める直前に最新 main を Deploy to Staging で反映し両 version.json を揃える」オンデマンド同期を採用(CLAUDE.md staging 項・staging-environment スキルに手順追加・safe-release 手順3/チェックリストに版一致項目追加)。②**モデルのコスト使い分けを再確認** — 複雑作業・構想・原因特定・仕様策定・レビュー=高コスト上位モデル/確立した単純作業=安い下位モデル。主セッションの Agent 起動・Workflow の agent() の model 選択にも適用する旨を「モデル割当方針」冒頭に大原則として明記。③**ユーザビリティ影響の機能要望は実装前に懸案+妥協案を提示して合意** — 標準フロー step2 と spec-curator エージェント(手順5・アウトプット形式)に妥協案ゲートを追加。合意前に dev-fix へ渡さない(CLAUDE.md・.claude/skills/{safe-release,staging-environment}・.claude/agents/spec-curator.md)

## v1.5.431 (2026-07-10)

- fix(サーバーバックアップの Google Drive 自動同期がCIデプロイで無効化される事故の恒久対策): `functions/.env`(Google Drive OAuth 一式)は .gitignore 済みで CI のチェックアウトに含まれないのに、本番 `deploy-functions.yml` には staging のような env 書き込みステップが無かったため、CI経由で functions をデプロイするたびに `GOOGLE_DRIVE_BACKUP_FOLDER_ID` 等が空になり `isGoogleDriveBackupConfigured()` が false となって Drive 同期が黙って停止していた(2026-07-10 のバックアップ再設計で初めてCI経由デプロイして顕在化)。deploy-functions.yml に「Write functions env for production」ステップを追加し、GitHub シークレット `PROD_FUNCTIONS_ENV`(ローカル functions/.env と同内容)を `functions/.env.komahyouapp-prod` へ書き出して runtime env に焼き込むようにした。**シークレット `PROD_FUNCTIONS_ENV` の登録が必要**(.github/workflows/deploy-functions.yml)
- feat(自動バックアップ: 早朝の静音時間帯をスキップして取得回数を抑制・オーナー確定 2026-07-10): 15分毎バックアップのうち JST 3:15〜8:45(ユーザーが操作しない早朝)は生成をスキップし、9:00 から通常の15分刻みへ復帰する。ただし 72時間〜7日帯の日次保持アンカーである **AM3:00 の1本だけは静音帯でも取得**する(取らないと3〜7日前の日次バックアップが存在しなくなるため)。純関数 `isWorkspaceAutoBackupSkippedAt` をスケジュール関数側で判定(手動「今すぐバックアップ」は対象外)。回帰テスト7件を同コミットで追加(functions/src/workspaceBackupSchedule.ts(+test)・functions/src/index.ts・src/components/developer-admin/DeveloperAdminScreen.tsx)
- fix(生徒日程表コマ組みの机選択モーダル: ブラウザ拡大時に画面からはみ出す): コマ組み(別タブD&D)で移動先を選ぶ「机選択モーダル」を、日程表をブラウザ拡大していても画面いっぱいに収まるよう修正。原因は2点 — (1) `.desk-picker-modal` の `transform-origin` が `center top` で、机数が多く縦長になると flex 中央寄せでボックス上端が画面外に出た状態から上基点で縮むため上端が切れていた → `center center` に変更し中央基点で確実に画面内へ収める。(2) 縮小率計算が高さのみで幅を見ておらず、ブラウザ拡大で viewport の CSS px が縮むと固定px寸法の盤面が横にもはみ出していた → `computeDeskPickerFitScale` を高さ・幅の両方で判定し厳しい方の縮小率を採用(埋め込みJSミラーも同式に更新)。回帰テスト5件を同コミットで追加(src/utils/scheduleHtml.ts(+test))

## v1.5.429 (2026-07-10)

- feat(表示週選択を自作カレンダーへ差し替え: 月送りでは週を変えず日付タップでのみ確定・オーナー確定 2026-07-10): 盤面ツールバー「表示週を選択」のネイティブ日付ピッカー(`<input type="date">`)を廃止し、アプリ自作のカレンダーポップオーバーに差し替え。ネイティブは「月送り」と「日選択」をどちらも同じ change で通知し端末によっては blur も来ないため、月を送っただけで表示週が変わる/選んでも変わらない、をコード側で確実に分離できなかった(v1.5.427/428 の試行錯誤)。自作カレンダーは **‹ › の月送りは表示月(state)だけを変え週は一切変えず、日付ボタンのタップで初めて `onJumpToDate` を呼んで確定** する挙動を全端末で決定的に再現。今日/選択中の週/前後月をハイライト、外側クリック・Escape・「閉じる」で週を変えずに閉じる、「今日」ボタンで今日の週へ。表示計算(月曜始まり6週×7日の行列生成・月送り・週内判定・今日)は純関数 `weekJumpCalendar.ts` に切り出し回帰テスト9件を同コミットで追加。旧 `weekJumpPicker.ts`(＋test)は役目を終えたため削除(src/components/schedule-board/weekJumpCalendar.ts(+test)・src/components/schedule-board/BoardToolbar.tsx・src/App.css)

## v1.5.428 (2026-07-10)

- fix(表示週選択カレンダー: 日付を選んで確定した時に確実に切り替える・v1.5.427の追随修正・オーナー報告 2026-07-10): v1.5.427 で「blur / Enter で確定」にした結果、デスクトップ等のカレンダーは**日付をクリックしてもフォーカスが外れず(=blur が来ず)、選んでも表示週が切り替わらない**回帰が出た。プラットフォーム差(タブレットのホイール/カレンダーは操作途中に change 連発、デスクトップのカレンダークリックは blur なし)を吸収するため、確定トリガーを「**最後の change から約320msの静止＝日付を選び終えた**」とみなす方式へ変更。blur / Enter が来れば即確定(待ち時間ゼロ)、Escape は取り消し、アンマウント時はタイマー解除。純関数 `createWeekJumpPicker`(stage/commit/reset)はそのまま流用し、確定タイミングのみ component 側(`weekJumpCommitTimerRef`)で制御(src/components/schedule-board/BoardToolbar.tsx)

## v1.5.427 (2026-07-10)

- fix(盤面の表示週選択カレンダー: 日付を確定するまで表示週を変えない・オーナー依頼 2026-07-10): 「表示週を選択」のネイティブ日付ピッカー(`<input type="date">`)は、タブレット等でホイール/カレンダー操作中に `change` を発火させるため、以前は確定前に表示週が勝手に切り替わっていた。`change` では週を変えず「保留(stage)」のみ行い、ピッカーを閉じて確定した時(blur / Enter)に最後の値へジャンプする方式へ変更(Escape はキャンセルで保留破棄)。確定制御を純関数 `createWeekJumpPicker`(stage/commit/reset)に切り出し、controlled(`value`)だと保留中に値が戻ってしまうため uncontrolled(`defaultValue`＋`key={weekStartDate}`)にして週変更時のみ再同期。回帰防止テスト: stage だけでは commit まで値を返さない/commit は最後の値を一度だけ返す(多重ジャンプ防止)/空値・reset は null、を新規追加(src/components/schedule-board/weekJumpPicker.ts(+test)・src/components/schedule-board/BoardToolbar.tsx)

## v1.5.426 (2026-07-10)

- refactor(ワークスペース自動バックアップの間引き方式へ再設計・オーナー確定 2026-07-10): 生成スケジュールを15分毎(`*/15 * * * *`)の1本に一本化し、毎時生成(`createWorkspaceServerHourlyBackups`)・日次生成(`createWorkspaceServerAutoBackups`)の**Cloud Functionsを本番から削除**。保持はプルーン時の経過時間ベースの間引きで実現(新関数 `shouldKeepWorkspaceAutoBackup`: age<24h=全保持/24-72h=JST分00のみ/72h-7日=JST時03分00のみ/7日以上=削除)。Google Driveミラーも「15分毎はスキップ」を撤回し毎回アップロード、プルーンも同じ間引きルールへ統一(`shouldKeepGoogleDriveBackupFile`)。フロントのストレージ使用量見積り(`src/App.tsx`)も新方式の概算本数(96+48+4=148本)に合わせて修正し、旧実装が保持短縮(14日→7日、72h→48h)の反映漏れで古い数値のまま放置されていたバグも併せて修正。回帰防止テスト: `shouldKeepWorkspaceAutoBackup` の境界値(24h/72h/7日ちょうど・JSTオフセット跨ぎ含む)を新規追加(functions/src/workspaceBackupSchedule.ts(+test)・functions/src/index.ts・src/App.tsx・src/components/developer-admin/DeveloperAdminScreen.tsx)

## v1.5.425 (2026-07-09)

- feat(講習集計結果に提出日時・提出方法を表示＋講師日程にも集計結果ボタン・オーナー依頼 2026-07-09): 生徒の「講習集計結果」に「提出日時」(QR提出/室長登録の日時・JST `M/D HH:MM`)と「提出方法」(`QR提出`/`室長登録`・不明は `—`)の2列を追加。方法は最後の操作で決まる(保護者/講師のQR提出=`qr`、室長が日程表の登録操作で確定=`manual`)。搬送は4経路を揃える: (1)QR提出のFunctions側スナップショット統合(`lectureSubmissionApi`)に `submittedAt`/`submissionMethod:'qr'` を追加、(2)購読反映(`subscribeLectureSubmissions`/`SubmissionChangeEntry` に `submittedAt` を追加し `App.tsx` の新規反映で `qr` を付与)、(3)室長の代行登録(`schedule-student-count-save`/`schedule-teacher-count-save` で `manual`＋操作時刻、登録解除でクリア)、(4)payload serialize(`SerializedStudent/TeacherSpecialSessionInput` へ追加=欠落すると popup で全て `—` に化ける v1.5.400 と同型の非対称を回避)。**講師日程にも「講習集計結果」ボタンを新設**(`buildTeacherLectureSummaryHtml`)。講師版は希望科目列を出さない(No./講師名/登録状況/提出日時/提出方法の5列)。既存データ(未搬送)は `—` 表示・遡及バックフィルなし(本番書き込みを伴うため)。回帰テスト: `formatSubmissionDateTime`(JST・日付境界・不正)/`resolveSubmissionMethodLabel`(qr/manual/未登録/不明)/payload serialize(生徒・講師)/講師ボタン・列構成 を同コミットで追加(src/utils/scheduleHtml.ts(+test)・functions/src/index.ts・src/App.tsx・src/integrations/firebase/lectureSubmission.ts・src/components/special-data/specialSessionModel.ts・src/App.test.ts)

## v1.5.423 (2026-07-09)

- feat(講師D&Dを全教室へ展開・オーナー確定 2026-07-09): 講師の同コマ内D&D移動/入れ替え(`teacherDragAndDropMove`)の scope を `development-only` から `all-classrooms` へ昇格。開発用教室での実機検証OK。テスト更新: 全教室で有効(src/utils/featureRollout.ts(+test))
- style(掴み中のカーソルを grabbing に): 長押しD&D中(生徒/講師とも)、盤面全体のマウスカーソルを「掴んでいる手(grabbing)」にして掴んでいる最中であることを明示する。従来は生徒セル(`.sa-student`)だけに付いており講師ドラッグ時は既定カーソルのままだった。`.slot-adjust-grid-dragging` 配下全体へ `cursor: grabbing` を適用(src/App.css)

## v1.5.422 (2026-07-09)

- feat(盤面で講師を生徒のようにD&Dで移動/入れ替え・同一コマ限定・開発用教室先行): 講師名を長押し(約250ms)して掴み、同じコマ内の別の机へドラッグ&ドロップで移動できる。移動先が空き講師なら単純移動、講師がいれば2机の講師だけを入れ替える(生徒=lesson は動かさない)。別コマの講師セルへ離しても無効(同一コマ限定)。実移動は純関数 `computeTeacherMove`(机の「講師ブロック」6フィールドだけを入れ替え・lesson の無い机に残った講師は managed 再マージで消えないよう manualTeacher=true に固定=v1.5.349 の emptiedSourceDesk ガードと同型)に集約。UIは生徒D&D(`studentDragAndDropMove`)と同じ操作感で、独立した `teacherDragMoveRef`/`draggingTeacherLabel`/`suppressNextTeacherClickRef` を使い生徒ドラッグ状態と干渉させない。新フラグ `teacherDragAndDropMove` は scope=`development-only`(本番3教室は無効のまま・検証後に昇格予定)。回帰テスト: `computeTeacherMove` 5件＋フラグの development-only 1件を同コミットで追加(src/utils/featureRollout.ts(+test)・src/components/schedule-board/ScheduleBoardScreen.tsx(+test)・src/components/schedule-board/BoardGrid.tsx)

## v1.5.421 (2026-07-09)

- fix: 講師が盤面から削除操作なしに勝手に消える不具合を修正(緑が丘 8/4 講習で門田/角田等)。原因は `teacherAutoAssignRequest`(講師の自動配置/登録解除の一過性コマンド)が App 永続 state に載ったまま消費されず、盤面 key 再マウントで重複ガード(processedRef)が消えるたびに古い unassign(登録解除)が再発火して講師を再削除していた。Issue #46(studentScheduleRequest)と同型で、同じ規律=処理後に App 側 state を消費(null)＋判定を純関数化(`shouldProcessTeacherAutoAssignRequest`/`consumeTeacherAutoAssignRequest`)で修正。再マウント再発火の回帰テスト8件追加(src/App.tsx・src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.420 (2026-07-09)

- feat(講師選択セレクターに講習の出席可否記号・オーナー要望 2026-07-09・全教室): 盤面の講師選択セレクター(`<select>`)で、そのコマの日が講習期間内かつ講師が出席不可コマを提出済み(`countSubmitted`)のとき、講師名の横に **○=出席可能 / ×=出席不可** を付ける。未提出(teacherInputs 無し/`countSubmitted=false`)や講習期間外は記号なし。純関数 `resolveTeacherLectureSlotMark`(specialSessions から日付でセッションを引き、`teacherInputs[id].unavailableSlots` の有無で判定)を新設しユニットテスト4件を同コミットで追加。`value` は従来どおり `teacher.name` のままで保存/確定ロジックは不変(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

## v1.5.419 (2026-07-09)

- feat(日程表コマ組みを全教室へ公開): 生徒日程表(別タブ)のコマ組みD&D(`studentScheduleDndMove`)と、その移動結果の即反映に必要な自動同期＋スピナー(`schedulePopupAutoSync`)の scope を `staging-environment` から `all-classrooms` へ昇格(オーナー確定 2026-07-09)。staging→本番の開発用教室で段階検証済み。2026-06-05 のポップアップ再生成メモリ障害はデバウンス+fingerprintスキップ+表示範囲限定で緩和済み。テスト更新: 両フラグが全教室で有効(src/utils/featureRollout.ts(+test))

- feat(自動バックアップ3階層化・オーナー確定 2026-07-09): ワークスペース自動バックアップを hourly(72h保持)+daily(14日保持) の2階層から、**15分毎(新規・保持24時間)+毎時(保持48時間に短縮)+日次(保持7日に短縮)** の3階層へ変更。純ロジック(日時キー生成・Storageパス・displayLabel・保持判定)を `functions/src/workspaceBackupSchedule.ts` へ抽出しユニットテスト化(`functions/src/workspaceBackupSchedule.test.ts`・13件)。15分tierはStorage+Firestore summaryのみでGoogle Driveミラーはスキップ(APIクォータ回避・保持定数は既存のDriveプルーンが自動追従)。ダウンロード解決経路(storagePath由来)は無変更。フロント型 `backupKind` を `'daily'|'hourly'|'quarterHourly'` へ拡張(src/integrations/firebase/adminFunctions.ts)。**次回プルーン実行時、既存の48時間超の毎時バックアップ・7日超の日次バックアップは仕様どおり削除される点に注意。**

## v1.5.417 (2026-07-09)

- feat(Phase C 本番展開ゲート): 日程表コマ組み(別タブD&D)を本番の**開発用教室のみ**へ展開(scope=staging-environment・本番3教室は無効)。加えて別タブ日程表の**自動同期(デバウンス)＋同期スピナー**も本番3教室では意図せず有効化されないよう新フラグ `schedulePopupAutoSync`(staging-environment)を追加してゲート。off の教室では自動同期effectを no-op にし従来どおり「最新表示ボタン/開いた時のみ更新」に保つ(2026-06-05 のポップアップ再生成メモリ障害と同種の負荷が本番大教室で未検証のため・オーナー確定 2026-07-09)。回帰テスト追加(src/utils/featureRollout.ts(+test) / src/components/schedule-board/ScheduleBoardScreen.tsx)
- fix(Phase C 出席済み席への配置ガード): 出席済みにした生徒は studentSlots から除去され statusSlots に退避される仕様上、`computeStudentMove` の出席ガードが `targetStudentBeforeMove &&` 条件で studentSlots 依存になっており出席席へ別生徒を配置・入れ替えできてしまう回帰を修正。statusSlots が `attended` なら studentSlots の有無に関わらずブロックするよう変更(欠席/振無休/移動済みは従来どおり配置可能な空席のまま)。机選択モーダル側(`buildDeskPickerDesks`)も出席席を `selectable:false` にし、埋め込みJS(`renderDeskPickerSeatCellHtml`)も非選択席を記録ラベル付きのブロック表示に変更。回帰テスト追加(src/components/schedule-board/ScheduleBoardScreen.tsx(+test)・src/components/schedule-view/scheduleViewMove.ts(+test)・src/utils/scheduleHtml.ts)
- fix(Phase C 日程表コマ組みの同期即時化・二重スピナー修正): 別タブでの生徒移動成立時、1.5秒の自動同期デバウンス任せだった別タブへの反映を短縮。当初は即時 `setScheduleSyncTrigger` を別途足したが、自動同期(デバウンス)effectと経路が二重化し「早期hide→再show」でスピナーが2回出る問題が判明。同期経路を自動同期effectに一本化し、移動時だけ次回1回のデバウンス遅延を0msにする方式(`scheduleSyncDelayRef`)に変更してスピナーを1回・最短に(src/components/schedule-board/ScheduleBoardScreen.tsx)

- fix(Phase C D&D対象拡大): 日程表コマ組み(別タブD&D)で増コマ(lessonType='extra')が掴めなかった問題を修正。prepareStudentForMove は regular/makeup 以外は単純な位置移動のみで既存の講習(special)と同じ経路のため副作用なし。buildLessonCardDragAttrs の対象種別に 'extra' を追加(spec-student-schedule-dnd.md も更新)。回帰テスト追加(src/utils/scheduleHtml.ts(+test))
- fix(Phase C 週自動拡張の上限): 日程表コマ組みD&Dで移動先が現在ロード済みの週から離れていると weeks state が無制限に肥大化し(cloneWeeks全週クローン+Undo履歴×最大10で増幅)後続操作が重くなる問題に対処。executeScheduleViewMove に上限8週間(56日)のガードを追加し、超える移動は ensureWeeksCoverDateRange を呼ばず不成立を返す(盤面自体の週送りには影響なし・スコープ限定)。純関数 checkScheduleViewMoveRangeWithinCap を export しユニットテスト化(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))
- refactor(ensureWeeksCoverDateRange 性能): 週の自動拡張ループが毎回 `[newWeek, ...nextWeeks]` / `[...nextWeeks, newWeek]` で配列全体をコピーしO(n^2)になっていたのを、前方/後方それぞれ一時配列に貯めてから最後に一度だけ結合するO(n)に最適化。生成される週の内容・順序・weekIndexOffsetは完全に不変(リファクタ前実装との出力一致をスタッシュ比較で確認済み)。回帰テスト追加(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

- fix(Phase C 机選択モーダル 3): 机が多い/横向き画面で全机が縦スクロール必須になる問題を修正。`.desk-picker-modal` を `overflow:auto/max-height` から `overflow:visible`+`transform-origin:center top` に変更し、表示直後にモーダル実高さから `scale(k)`(k<=1)を算出して縮小適用し、全机を1画面に収める(横幅は `max-width:92vw` を維持)。純関数 `computeDeskPickerFitScale` を export しユニットテスト化(埋め込みJS側は同式のミラー)(src/utils/scheduleHtml.ts(+test))
- fix(Phase C 移動成立ハイライト): 移動成立時の黄色ハイライトが「同期中」スピナー表示中に始まり被って見えづらい問題を修正。成立通知は即ハイライトせず `pendingScheduleMoveHighlightKey` に保留し、`flushIncomingPayload` でスピナーを消した直後(250ms後)に開始する`promotePendingScheduleMoveHighlight`へ昇格。メッセージ到着順の保険として、既にスピナーが消えている場合は即昇格する(src/utils/scheduleHtml.ts)
- fix(Phase C 講習自動割振後の武装解除): 講習自動割振で割振りきれない残があると `selectedLectureStockKey` 等がセットされタップ配置モードに武装されてしまう挙動を廃止(オーナー確定 2026-07-09)。純関数 `resolvePostLectureAutoAssignView` を export し、割振り後は常に選択キーをクリアしたうえで、講習残があれば未消化講習一覧・講習ゼロで振替残があれば未消化振替一覧・両ゼロなら未消化講習一覧を開くだけにする。回帰テスト4件(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

- fix(Phase C 席の解決2): 「空き席なのに移動不可」の残存を根治。resolveScheduleViewTargetSeat の机特定を **deskId→机の在席者(deskOccupantEntryIds)→講師名→positional** に強化(日程表と盤面で机の並び/deskId が食い違っても、在席生徒で「その机」を一意特定)。空きも入れ替え対象も無いときは盤面の実際の席内容(席1=◯/席2=◯)を添えた診断メッセージを返す。回帰テスト: 在席者での机特定・診断(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- fix(Phase C×出席不可トグル): 掴めるカード(通/振/講)をタップすると出席不可トグルが効かない回帰を修正。D&Dの pointerdown が stopImmediatePropagation でトグルを潰していたため、長押し未満のタップ(pending→up)でカードでも `handleUnavailablePointerDown` を実行するようにした(カード全体が反応対象＝テキストの短い/余白の狭いコマでもトグル可)。staging のD&D有効時のみの回帰(本番は影響なし)。回帰テスト: タップ→トグルの配線(scheduleHtml.ts(+test))
- perf(Phase C×出席不可トグル): 出席不可コマの連続入力を妨げないよう、ポップアップ自身の操作(出席不可トグル)では「同期中」スピナーを抑制(この操作はローカル反映＋fingerprint スキップ済みでエコーに描画変化なし)。applyStudent/TeacherUnavailableSlots で suppress 窓(3秒)を張り、showScheduleSyncingOverlay で抑制。移動(反映待ち)は抑制を解除してスピナー表示。回帰テスト: 抑制の配線(scheduleHtml.ts(+test))

- fix(Phase C 席の解決): 別タブのコマ組みで「空き席なのに『すでに生徒がいます』で移動不可」を根治。日程表(overlay 済みセル)と盤面の生 weeks は机内の席(左右=studentSlots)の並びも食い違うことがあり、positional な studentIndex を鵜呑みにすると占有席を指していた。resolveScheduleViewTargetSeat で机は deskId→講師名、席は「入れ替え対象の在席生徒(occupantEntryId)/その机の実際の空き席」で解決してから配置するようにした(旧 resolveScheduleViewTargetDeskIndex を置換)。空きも入れ替え対象も無い場合は理由を出す。回帰テスト4件(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 入れ替え): 机選択モーダルで在席の生徒を選ぶと**盤面の入れ替えと同じ**挙動で交換できるようにした(オーナー要望)。在席セルをクリック可(橙ホバー・「入替」表示)にし、相手の entryId を送って computeStudentMove の入れ替え(相手を移動元へ振替で入れる)に乗せる。メモ席のみ選択不可。回帰テスト: 入れ替えの通し1件・席セルの入替属性(scheduleViewMove.ts(+test) / scheduleHtml.ts(+test))

- fix(Phase C 移動失敗の原因): 別タブのコマ組みで「本来移動できるはずが移動不可になる」ケースを修正。日程表(overlay 済みセル)と盤面の生 weeks は机の並び/本数が食い違うことがあり、モーダルの positional deskIndex が盤面の別の机(占有/存在せず)を指して弾かれていた。机選択モーダルに机同一性(deskId=盤面 desk.id・講師名)を持たせ、移動確定時に resolveScheduleViewTargetDeskIndex で deskId→講師名→positional の順に実机へ解決してから検証・移動する。回帰テスト3件(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 移動の結果表示): 盤面→別タブへ移動結果を ack 送信。成功=移動先コマを数秒(約4s)黄色ハイライト(自動同期の再描画をまたいで持続)。失敗=理由を最前面に大きく表示し「日程表に戻る」ボタンで閉じる(盤面は不変)。回帰テスト: 配線マーカー(scheduleHtml.ts(+test) / ScheduleBoardScreen.tsx)
- style(Phase C 机選択モーダル 2): 説明テキスト(タイトル/注記)を削除し、机列の左に時限列(rowspan)・一番上に日付行を追加して「盤面の一コマをそのまま切り取った」表にした(オーナー要望)。回帰テスト: 席セルの机同一性属性・日付/時限セルの配線(scheduleHtml.ts(+test))
- style(Phase C 机選択モーダル): 机一覧の形式を盤面と同じ「1コマを切り取った」表に変更(オーナー要望)。カード式(席を縦積み)をやめ、盤面の .slot-adjust-grid/sa-* に合わせた 1机=1行 [机番号][講師][席1][席2] のダーク罫線テーブルに。空席=クリック可td(青ホバー)・占有=非クリックtd(生徒名+科目)・メモ/休記録=淡色。回帰テスト: 席セルtd形式2件・盤面テーブルの配線マーカー(scheduleHtml.ts(+test))
- feat(Phase C 別タブD&D本体): 生徒日程表(別タブ・生成HTML)の授業カード長押しD&Dでコマ組み。通常/振替/講習カードを約250ms長押しで掴み→空きコマ(開校日・当該生徒が空き)へドラッグ(青枠ハイライト)→ドロップで机選択モーダル(移動先コマの全机=pickerDesks をコマ表と同配置で表示・空席のみ選択可・自動割振ルール/警告は無関係)→席確定で本体へ schedule-student-move-request 送信→盤面が executeScheduleViewMove で実移動→自動同期で別タブ更新。pointerdown は再描画に強い pagesElement 委譲で拾い、空きコマトグルより先に登録し掴めるカードのみ後続を止める。自動同期の再描画中はドラッグ/モーダルを破棄。scheduleDndEnabled(staging/開発用教室)時のみ有効。埋め込みJSのエスケープ罠に配慮(new Function 構文検証テストが番人)。回帰テスト: 掴めるカードのゲート/対象外種別/配線 3件(scheduleHtml.ts(+test))
- feat(Phase C 机レイアウト+ゲート): 日程表コマ組みの机選択モーダル用データとフィーチャーゲート。serializeCells に includeDeskPicker フラグを追加し、有効時は開校日コマに pickerDesks(空席の机も含む全机レイアウト=既存テスト済み buildDeskPickerDesks)を別途載せる(desks は空席の机を落とすので机選択に不足するため。印刷/講師/全員表示のペイロードは不変)。featureRollout に `studentScheduleDndMove`(staging-environment スコープ)を追加、盤面が生徒ペイロードに scheduleDndEnabled として渡す。回帰テスト: pickerDesks の載せ分け2件・featureRollout スコープ1件(scheduleHtml.ts(+test) / featureRollout.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 土台): 日程表コマ組み(別タブD&D)の受け側配線。StudentScheduleRequest を discriminated union 化し `mode:'move'`(source/seat)を追加、App.tsx が別タブからの `schedule-student-move-request` を純関数 parseScheduleViewMoveMessage で厳密検証して一過性リクエスト化、盤面が executeScheduleViewMove で実移動する effect を追加(Issue #46 規律: 処理時に消費・weeks 未ロード時は待つ)。埋め込みJSのD&D UI・机選択モーダルは次コミット。回帰テスト: parseScheduleViewMoveMessage 6件(scheduleViewMove.ts(+test) / App.tsx / ScheduleBoardScreen.tsx)
- refactor: 対話用日程表の方針を「別タブ(生成HTML)に同期＋コマ組みを実装」へ回帰(オーナー確定 2026-07-08)。React ポップアウトは別ブラウザウィンドウへの portal で pointer 操作(D&D の drop)が確実に届かず・従来タブと操作感が変わるため棚上げ。scheduleReactViewEnabled を常時 false に(React ビュー・featureRollout は将来再検討用に温存)、日程表ボタンは従来の生成HTMLタブ(openStudentScheduleHtml/openTeacherScheduleHtml)を開く。(ScheduleBoardScreen.tsx)
- feat: 別タブ日程表への自動同期(デバウンス約1.5秒)。盤面編集を別タブへ自動反映する。編集ごとの即再生成は 2026-06-05 メモリ障害の温床のため、①デバウンスで連打を1回に集約 ②受信側(埋め込みJS)の buildPayloadFingerprint で等価ペイロードの再描画をスキップ ③表示範囲限定、の3点で防ぐ。ポップアップを開いている間だけ作動。「最新表示(期間・生徒適用)」ボタンは残す。staging で ?memlog=1 の heap 実測を行う。(ScheduleBoardScreen.tsx)
- feat: 別タブ日程表の「同期中」スピナー(オーナー指示 2026-07-08)。盤面編集→別タブ反映までの数秒、最前面に大きくスピナー＋「コマ表の最新を反映中…」を表示する。本体(盤面)が編集時に埋め込みJSの `__showScheduleSyncing()` を即時に呼び、同期ペイロード適用(flushIncomingPayload)で自動的に消える(等価ペイロードでも固着しないよう flush 末尾で必ず非表示＋8秒の保険タイマー)。ポップアップを開いた直後の初期表示ではスピナーを出さない。回帰テスト1件。(scheduleHtml.ts(+test) / ScheduleBoardScreen.tsx)

- feat: 対話用日程表のReact化 Phase 0+1(土台＋リアルタイム同期・staging先行)。盤面と同一Reactツリーの `ScheduleView`(ドック⇄ポップアウト切替・spec-schedule-interactive-view)を新設し、staging環境判定(`isStagingEnvironment`/`scheduleInteractiveReactView`・stagingと開発用教室のみ有効)で日程表ボタンの対話用途を差し替え。表示算出は生成HTMLと同じ `buildStudentPayload`/`buildTeacherPayload` を共有し、埋め込みJSの表示ロジックを `scheduleViewData.ts` へ純関数移植(等価性テスト同梱)。行は React.memo＋signature比較で変更行のみ再レンダー(メモリ規律・`bumpMemCounter('schedule-view-row-render')` 等で ?memlog=1 実測可)。絞り込みは即時適用(旧「最新表示」ボタン廃止・Reactビュー内のみ)。印刷/PDF(全員表示・空フォーマット)と旧同期機構(forceゲート/scheduleSyncTrigger)は無変更で温存。本番3教室は従来の生成HTMLタブのまま(オーナーチェック合格まで main へマージしない)。(src/utils/scheduleViewData.ts / src/components/schedule-view/* / featureRollout.ts / ScheduleBoardScreen.tsx / BoardToolbar.tsx)
- chore: ローカル検証用の launch 設定 `dev-local`(VITE_EXTERNAL_BACKEND_MODE=local・ポート5199)を追加。(.claude/launch.json)
- feat: 日程表コマ組み Phase 2(spec-student-schedule-dnd・staging先行)。生徒日程表(Reactビュー)の授業カード(通/振/講)を長押し(約250ms)D&D→空きコマへドロップ→机選択モーダル(コマ表と同じ机配置・物理的な空きのみ判定、自動割振ルール/警告は評価も表示もしない)→盤面の computeStudentMove を直接実行。通常授業は「移動先に振替manual追加＋移動元当該日の抑制」の両方(7/20事故の教訓)、講習は選択科目・授業時間維持(v1.5.364回帰なし)、週範囲は ensureWeeksCoverDateRange で自動拡張、source は entryId+生徒id+日付+時限で特定(取り違え防止)、Undoで1操作復元。未保存のローカル変更(手動保存で確定)。集団カード・出欠カードは掴めない。テスト8件同梱(scheduleViewMove.test.ts)。(schedule-view/scheduleViewMove.ts / ScheduleView.tsx / ScheduleSheet.tsx / ScheduleBoardScreen.tsx / scheduleViewData.ts)
- feat/fix: 対話用日程表のUX調整(オーナーstaging指摘・2026-07-08)。①対話は**別ウィンドウ(ポップアウト)既定**に変更しドック/トグルUIを撤去(ドックはポップアップブロック時のフォールバックのみ)。②ポップアウトの chrome バー(「生徒日程表」タイトル/ボタン)・D&Dヒントバーを撤去、ウィンドウは location/menubar/toolbar 無効のポップアップで開き document.title を空に(タブの about:blank/タイトルを抑制)。③日程表コマ組みの緑ハイライトを撤去し、盤面D&Dと同じ**画面周囲の青枠**＋ドロップ先コマの青枠ハイライト(直接DOM操作で行を再レンダーしない=メモリ規律)に変更。ドロップ判定を hover 追跡＋イベントの ownerDocument での elementFromPoint に堅牢化し**ポップアウトでも移動成立**。④ポップアウトは日程表シートが下まで収まるよう **zoom を自動調整**(fitToWindow)。⑤ポップアウトの **Ctrl+P は日程表だけを従来体裁で印刷**(子ウィンドウ専用の印刷CSSを注入・非対象パーツ非表示・A4横・fit zoom打ち消し)。印刷CSS回帰テスト＋行メモ化テスト更新。(schedule-view/ScheduleView.tsx / ScheduleSheet.tsx / ScheduleViewPanel.tsx / PopoutWindow.tsx / scheduleViewPrint.ts(+test) / scheduleView.css / ScheduleBoardScreen.tsx)
- fix: 対話用日程表のオーナー再指摘対応(2026-07-08)。①**ポップアウトでD&Dが効かない不具合を根治**: pointer 操作を document への addEventListener＋ownerDocument 依存から、カード要素の **React synthetic pointer events ＋ setPointerCapture** に変更し、hit-test は event.view.document(発生元ウィンドウ)で行う。dock/popout の両方で長押し→ドロップ→机選択→移動が成立(盤面側が誤って掴まれる副作用も解消)。②**別ウィンドウを最大化(画面いっぱい)で開く**(availWidth/Height で open＋moveTo/resizeTo)。③**印刷は A4横いっぱいの倍率**(余白3mm・シート291×204mm・aspect-ratio固定解除)。④**「印刷用全員表示」を直接呼び出しで動作**(postMessage 経由をやめ runOpenAllSchedule 直呼び)。⑤**空フォーマット印刷・講習集計結果ボタンを復活**(生成HTMLの生徒日程タブへ委譲・講習集計は講習期間が重なる時のみ表示)。⑥**生徒/講師セレクター右の「期間・◯反映」ボタンを復活**(旧「最新表示」相当のdraft＋apply。選択は反映を押すまで表示に効かない)。(schedule-view/ScheduleView.tsx / ScheduleSheet.tsx / PopoutWindow.tsx / scheduleViewPrint.ts(+test) / ScheduleBoardScreen.tsx)
## v1.5.416 (2026-07-09)

- fix: v1.5.415 のガードで開発用教室のQRが生徒/講師日程表に表示されなくなった回帰を修正。開発用教室の既発行トークンは全て「発行元教室タグ未設定」のためガードが一律に他教室由来とみなして除去していた。ensureScheduleSubmissionTokens で**開発用教室のみ**、自教室が発行したものでない(未タグ/他教室タグ)トークンを自教室タグ付きで**再発行**するようにした(applyIssuedSubmissionTokensToSessions に差し替え分岐・提出内容は保持)。再発行後は owned となりQRが復活し、かつ他教室トークンが残らないため混入も起きない。本番教室は素通し(既存・印刷配布済みトークンは不変)。
- feat: 日程表(別タブ)のタブ名に「開いている教室名」を表示、期間表示は廃止(取り違え防止・オーナー要望)。scheduleHtml に classroomName を渡し document.title を教室名ベースに変更(App.tsx / scheduleHtml.ts)。
- fix(混入監査): 開発用教室での登録/登録解除(markLectureSubmissionDocAsSubmitted / resetLectureSubmissionDoc)が、自教室発行でないトークンのドキュメント(=他教室=本番)へ書き込み得る残存経路にガードを追加(開発用のみ・所有トークンのみ書込)。他の書込経路(教室スナップショット保存=acting限定、occupiedSlots/集団同期=再発行後の所有トークンのみ)は問題なしを確認。
- test: 再発行差し替え・冪等性・タブ名・所有判定の回帰テストを追加(App.test.ts / scheduleHtml.test.ts / developmentClassroom.test.ts)。関連メモリ [[komahyou-dev-classroom-qr-token-contamination]]

## v1.5.415 (2026-07-09)

- fix: 開発用教室のQRテストが本番教室(日大前校)へ書き込まれる混入事故の恒久対策。開発用教室は他教室の生データをコピーしてテストするため、コピー元(本番)の提出トークンが残っていると日程表がそのQRを表示し、スキャンで本番へ誤書き込みする(2026-07-09 実発生・日大前校の複数生徒が誤登録)。対策: 提出トークンに発行元教室ID(`submissionTokenClassroomId`)を刻み(applyIssuedSubmissionTokensToSessions)、他教室→開発用コピー時に除去(buildDevelopmentClassroomCopyPayload)、**開発用教室でのみ**日程表へ渡す前に「自教室が発行したものでないトークン」を除去してQRを出せなくする(applyDevelopmentScheduleTokenGuard)。本番教室ではこのガードは一切走らず、既存・印刷配布済みトークンは不変。純関数化して回帰テスト追加(developmentClassroom.ts / App.tsx / specialSessionModel.ts)。関連メモリ [[komahyou-classroom-restore-cross-contamination]]

## v1.5.414 (2026-07-09)

- fix: 追加した科目「理社」がQR提出画面に出ない不具合を修正。availableSubjects はトークン発行時に提出ドキュメントへ凍結保存されるため、v1.5.413 以前に発行済みの生徒トークンには理社が伝播していなかった。既発行トークンの同期経路 `updateSubmissionOccupiedSlots` に availableSubjects の伝播を追加し、盤面更新のたびに最新の選択可能科目へ揃うようにした(提出済みドキュメントでも subjectSlots>0 の科目のみ表示するため害なし)。回帰テスト2件追加(lectureSubmission.ts・App.tsx)

## v1.5.413 (2026-07-09)

- feat: 小学生の科目に合体科目「理社」を追加(算国と同型・小学限定)。要望対応。1コマで理科+社会をまとめて扱う選択肢で、科目選択・体験授業・通常テンプレ・QR希望提出(getSelectableStudentSubjectsForGrade経由)・回数表(社の直後に表示)に反映。講師対応判定は理または社の担当で可。非小学に紛れた場合は理へ畳む。A4への影響: 回数表は理社の授業がある生徒のみ1行(理+社の2行を1行に統合する形で最悪行数は増えない・講習表はhideZeroZeroで0非表示)。回帰テスト追加(types.ts/studentGradeSubject.ts/scheduleHtml.ts/ScheduleBoardScreen.tsx/regularLessonTemplate.ts)

## v1.5.412 (2026-07-09)

- fix: `tools/copy-prod-classroom-to-staging.mjs` が無出力のまま止まって見える不具合を修正。`classroomSnapshots/{id}/saveAttempts`(保存の冪等性ログ・稼働中教室では数百〜数千件に達し得る)を削除・コピーの両方で丸ごとスキップするようにした(進捗ログも追加)。アプリ本体(デプロイ物)には影響しない開発ツールのみの変更(tools/copy-prod-classroom-to-staging.mjs)

## v1.5.411 (2026-07-08)

- fix: 生徒日程表の印刷で、講習回数の科目が多い生徒が A4横シート(height:190mm; overflow:hidden)の下端で見切れる不具合を修正。@media print 内で通常回数/講習回数表(.count-table)の行高を 22px→16px・縦paddingを詰めた(画面表示は22pxのまま)。回帰テスト同コミット追加(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.410 (2026-07-08)

- docs: 対話用日程表のReact化を土台に据える方針転換を確定(オーナー確定 2026-07-08。stagingでは生成HTMLタブを対話用途はReactビューに置換・印刷/PDFのHTML生成は残す)。同一Reactツリー化でリアルタイム同期は自動反映・日程表コマ組みはexecuteMoveStudent直呼びに単純化。ドック⇄ポップアウト(React portal→子ウィンドウ)トグルで両表示をstagingでユーザーが比較。新正本 docs/spec-schedule-interactive-view.md 追加、既存2仕様に§0(方式転換)追記、手順書をReact土台版(Phase0→1→2)に再構成、spec-index更新

## v1.5.409 (2026-07-08)

- docs: 機能2を「日程表コマ組み」と命名・自動割振ルール/警告をスコープ外に・両機能ともstaging先行オーナーチェック待ちへリリース方針変更(オーナー確定 2026-07-08。spec-student-schedule-dnd / spec-schedule-popup-realtime-sync / handoff-popup-sync-and-dnd / spec-index)
- chore: 本番教室→stagingのFirestoreコピースクリプトを追加(tools/copy-prod-classroom-to-staging.mjs。日大前の現状データをstagingテストデータ化するオーナー明示指示対応。本番=読み取りのみ/staging=書き込みのみのURLガード付き。実行はオーナーのターミナルから)

## v1.5.408 (2026-07-08)

- docs: 日程表同期+D&D仕様のギャップ精査追補(教室切替ガード・バージョンスキュー自己修復・机選択モーダルは物理空きのみ判定・週範囲拡張・操作ロック・Undo)と、手順書へテスト計画/デバッグ手順(?memlog計測手順)/本番エラーゼロチェックリストを追加(spec-*-realtime-sync / spec-student-schedule-dnd / handoff-popup-sync-and-dnd。コード変更なし)

## v1.5.407 (2026-07-08)

- docs: 日程表リアルタイム同期＋生徒日程表D&D移動の確定仕様と改修手順書を追加(オーナーQ&A 10問で要件確定。docs/spec-schedule-popup-realtime-sync.md / docs/spec-student-schedule-dnd.md / docs/handoff-popup-sync-and-dnd.md。spec-index の大方針6を正式上書き。コード変更なし)

## v1.5.406 (2026-07-07)

- fix: 登録解除→再登録→再割振後に画面遷移すると組み直した講習コマが消える回帰を修正(Issue #46)。一過性の unassign リクエスト(`studentScheduleRequest`)が処理後も App state に残り、盤面 `key={boardMountKey}` 再マウントで重複ガード(ローカル ref)が消えて再発火していた。処理後に App 側 state を消費済み(null)にする `consumeStudentScheduleRequest` を導入し、処理判定 `shouldProcessStudentScheduleRequest` を純関数化。セッション/生徒ロード後にのみ消費するよう処理順も整理(未ロード時の取りこぼしも解消)。再マウント再発火の回帰テスト同梱(src/App.tsx, src/components/schedule-board/ScheduleBoardScreen.tsx, ScheduleBoardScreen.test.ts)

## 1.5.405

- fix: 「保存し忘れ救済」(起動時の未保存ローカル書き戻し)を完全撤去(オーナー決定 2026-07-07)。起動時は常にサーバー最新を正とし、暗黙の書き戻し(7/6障害の主因・A3の残存リスク源)を経路ごと排除。閉じる前の未保存警告・タブ切替時の即時同期・ローカル控え保存は維持(src/App.tsx, src/data/appSnapshotRepository.ts, pendingSnapshotVersionGuard削除, 回帰テスト置換)

## 1.5.404

- docs: 7/6障害の最有力経路を初回評価誤除去→A3(stale書き戻し)へ訂正(被害生徒=提出済み本人とオーナー確認・リセット保存が提出到着1秒前の状態とほぼ同一サイズ・docs/analysis-qr-submitted-at-2026-07-06.md)

## 1.5.403

- docs: 7/6 講習巻き戻り障害の実データ解析結果を追加(docs/analysis-qr-submitted-at-2026-07-06.md・A4は当該障害の経路ではなく初回評価誤除去/A3が有力・handoffタスク1完了)

## 1.5.402

- docs: 引き継ぎ文書 docs/handoff-qr-submitted-at.md を追加。①本番 lectureSubmissions の submittedAt と問題報告時刻の突き合わせ解析(A4真因説の実データ裏付け・読み取り専用・アクセス制約と欠損注意つき) ②講習集計結果画面へのQR提出時刻表示(実装ポインタ・submittedAt を studentInputs へ搬送する3経路・着手前に spec-curator で確定すべき仕様点)を別セッションで進めるための背景・手順・制約をまとめた

## 1.5.401

- feat: 講習集計結果に「希望科目（授業時間）」列を追加。各生徒の希望各科目を授業時間付き数量で表示(例 `英×1 / 数60分×2`)。90分(既定)は分数なし、未登録・通常のみ・希望なしは `—`。授業時間は subjectDurations 由来(講習回数表と同ルール)。オーナー要望。src/utils/scheduleHtml.ts(formatDesiredSubjectsWithDuration 追加・buildLectureSummaryHtml に列追加)・docs/spec-schedule-pdf.md
- test: 講習集計結果の授業時間付き数量の回帰テストを追加。formatDesiredSubjectsWithDuration(60/45分併記・90分なし・SUBJECT_SORT_ORDER順・通常のみ/未登録/希望なしは `—`)を出荷後スクリプトの実体で固定。列ヘッダと関数の存在も確認。src/utils/scheduleHtml.test.ts

## 1.5.400

- fix: 講習回数表に希望登録の授業時間(60/45分)が表示されない不具合を修正。根本原因は payload シリアライズで studentInputs.subjectDurations が欠落していたこと(subjectSlots は載っていたため希望数だけ出て授業時間が消える非対称)。popup の DATA.specialSessions に届かず、未配置の希望科目で分数が一切出なかった。serialize に subjectDurations を追加し、配置済み(noteSuffix由来)・未配置(希望登録由来)の両方で分数が出るようにした。src/utils/scheduleHtml.ts(buildSerializedSchedulePayload・SerializedStudentSpecialSessionInput)・docs/spec-schedule-pdf.md §E
- test: payload に subjectDurations が載ることを固定する回帰テストを追加(未配置科目に分数が出ない根本原因の再発防止)。修正なしで落ち・ありで通ることを確認。src/utils/scheduleHtml.test.ts

## 1.5.399

- feat: 講習回数表の授業時間併記を、希望登録のみで盤面未配置の科目にも表示。実配置コマの noteSuffix を優先し、未配置科目は希望登録(QR提出の subjectDurations)の 60/45分でフォールバック。実配置と食い違う場合は実配置優先。オーナー要望。src/utils/scheduleHtml.ts(buildDesiredLectureMinutesMap・resolveLectureMinutesBySubject 追加)・docs/spec-schedule-pdf.md §E
- test: 未配置フォールバックの回帰テストを追加。resolveLectureMinutesBySubject(未配置は希望分数/実配置優先/実配置混在は希望へフォールバック/両方なしは併記せず)を出荷後スクリプトの実体で固定。src/utils/scheduleHtml.test.ts

## 1.5.398

- feat: 生徒日程表の講習回数表で、科目名の横に授業時間(60/45分)を併記(例 `英60分`)。90分(既定)は付けない(日程表セルと同ルール)。分数は実配置コマの noteSuffix 由来で、科目内で 60/45 が一意なときのみ併記(混在・不明・90分だけ・未配置は付けない)。オーナー要望。src/utils/scheduleHtml.ts(toCountRows に labelMinutesMap・pickLectureMinutesSuffix 追加、buildStudentSheetHtml で科目別に分数収集)・docs/spec-schedule-pdf.md §E
- test: 講習回数表の授業時間併記の回帰テストを追加。pickLectureMinutesSuffix(一意=併記/混在・空=なし/60+90=60)と toCountRows(labelMinutesMap ありで `英60分`・なしで素の科目名)を出荷後スクリプトの実体で固定。src/utils/scheduleHtml.test.ts

## 1.5.397

- docs: 登録解除の現状挙動をオーナー確定(2026-07-06)として正本に明文化。「講習だけ外し振替は残す(未消化へ戻さない)非対称は意図的」「希望数(subjectSlots)は in-app 保持・doc はクリアの二層」「ストック調整は台帳クリア方式が正・restoreSessionStock の +1 復元はデッド」「自動除去は提出済み→未提出の実遷移のみ発火」「セッション/生徒削除・期間変更では自動掃除しない」を追記。「空にする」での振替再出現(講習は台帳方式ゆえ再出現しない)の非対称を確定に格上げ。docs/spec-special-session-submission.md(E-2b 新設)・spec-lecture-stock.md(§5-1 新設)・spec-makeup-stock.md(§2)
- test: 確定仕様固定の回帰テストを追加。`removeStudentAssignmentsFromSpecialSession` を export(挙動変更なし)し、①special は外れ同一生徒の makeup は不変(最重要) ②specialSessionId 一致セッションのみ除去 ③セッション紐付き手動配置(specialStockSource='manual')も除去 ④台帳はその生徒×セッション分だけクリア(他生徒・他セッションのデルタは不変) ⑤デフォルト経路は +1 復元せず台帳クリアのみ(デッド分岐に依存しない)、を固定。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts

## 1.5.396

- test: A4 配線ガード(regression-reviewer 指摘)。トークン発行の state 反映を薄いラッパー `reflectIssuedSubmissionTokens` に切り出し、「関数型アップデータで setter 実行時点の最新 current へマージする」配線をテストで固定(stale スナップショット丸ごと置換へ戻すと落ちる)。あわせて症状連鎖の端到端テスト(トークン発行反映後も提出済み生徒が未提出除去の対象にならない=割振済み講習が戻らない)を追加。src/App.tsx・src/App.test.ts
- fix: 講習提出トークンの自動発行反映を「丸ごと置換」から「current(最新)へマージ」へ修正(A4)。生徒日程表popupを開く/最新表示すると ensureScheduleSubmissionTokens が走り、関数開始時点の session スナップショットから updatedSession を作って `await writeSubmissionDocs`(ネットワーク)後に `setSpecialSessions(current => current.map(s => s.id===updatedSession.id ? updatedSession : s))` で対象セッションを丸ごと置換していた。この await 中に別生徒のQR提出反映(subscribeLectureSubmissions → countSubmitted=true)が届くと、古いスナップショットが上書きしてその生徒を未提出へ巻き戻し、未提出配置除去 effect が盤面の割振済み講習を外し講習残数が満数へ戻る経路になり得た。純関数 `applyIssuedSubmissionTokensToSessions` を新設し、新規発行トークンの追加/後埋めだけを current へマージ・既存エントリの countSubmitted/subjectSlots 等は保持するよう変更(回帰テスト4件)。src/App.tsx・src/App.test.ts
- fix: 未提出配置の自動除去判定 `resolveNewlyUnsubmittedSessionStudents` の基準を「未提出集合」から「提出済み集合」へ厳密化。除去対象を「前回提出済みだった生徒が今回未提出になった=登録解除」だけに限定し、トークン自動発行(ensureSubmissionTokens が countSubmitted:false エントリをセッション途中に新規追加)で現れる『初めから未提出』の生徒を『新たに未提出』と誤判定して除去する経路を原理的に排除。null 番兵(初回/再マウントは基準取り込みのみ)と空ロード据え置きガードは維持。回帰テスト更新(『初めから未提出』は除去しない/登録解除は除去する・旧基準では落ちることを確認)。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts
- test: 多端末 stale 書き戻しガード(A3)に単一端末シーケンスの版数ゲートテストを追加。自分の保存でサーバー版数が進んだ(v11>マーカー基準v10)場合、残存した旧マーカーの書き戻しをブロックしリモート(=保存済み最新)を優先することを固定(単一PCでも成立)。src/App.test.ts
- test: 多端末 stale 書き戻し修正(A3)の regression-reviewer 指摘テスト補強3点。①部分マージ分岐(複数教室で stale=リモート維持/safe=ローカル書き戻し・pendingTargetClassroomIds が safe のみ・採用マッピング反転の変異で落ちることを確認済み) ②manager 専用パス(別ユーザーのマーカー→担当教室)の版数ゲート(stale=書き戻さない/一致=従来どおり) ③pending マーカー baseClassroomVersions の localStorage 往復(mark→read 欠落なし・不正値除去・旧マーカー後方互換)。src/App.test.ts・src/data/appSnapshotRepository.test.ts
- fix: 「講習を自動割振して数分後に未配置へ戻る／講習残数が増える」多端末 stale 書き戻し不具合を修正(単一端末では再現せず・中学生=大容量教室で顕著)。真因は保存の楽観ロック(教室単位 version・functions/optimisticVersion.ts)を、ログイン時の「前回終了時の未同期ローカル書き戻し」経路が素通りしていたこと。書き戻し直前の `loadFirebaseWorkspaceSnapshot` が版数レジストリをサーバー最新版数へ更新するため baseVersion が最新になり、サーバーは stale と気づけない。ゲートはワークスペース全体の savedAt(クライアント壁時計・端末間で数分ズレる)比較だけで教室単位版数を見ておらず、別端末が後から保存した最新教室データを古いローカルが savedAt 勝ちで黙って上書きしていた。盤面(weeks)だけ古い状態へ戻り提出(subjectSlots)は残るため講習残数が満数へ戻る(残数が増える)。対策: マーカーに教室単位の基準版数 `baseClassroomVersions` を記録し、書き戻し判定でサーバー現在版数と突き合わせて「別端末が後保存済み(remote版数>基準版数)」の教室はローカルで上書きせずリモートを優先する純関数ガード `isPendingClassroomWriteBackStale` を新設(`resolveRemoteWorkspaceSnapshot`/`resolvePendingLocalClassroomSnapshotForAuthenticatedUser` に版数ゲートを追加)。既存の savedAt ガード・A2 放置タブガード・A1 サーバー楽観ロックは巻き戻さず強化(二重防御)。回帰テスト追加(修正前=stale ローカルが savedAt 勝ちで上書きして落ち・修正後=リモート優先で通る/版数一致は従来どおり書き戻す/旧マーカーは後方互換)。src/data/pendingSnapshotVersionGuard.ts・src/App.tsx・src/data/appSnapshotRepository.ts・src/integrations/firebase/classroomSnapshotVersions.ts
- fix: 講習を自動割振したのに(教室を開き直すと)割り振った講習が未配置に戻る不具合を修正。未提出(countSubmitted=false)の生徒も fallback/manual ストック(lectureStock.ts の manualLectureStockCounts 正デルタ経路)から講習を自動割振できるが、「未提出になった生徒の講習配置を盤面から自動除去する」effect が基準集合 `prevUnsubmittedSessionStudentKeysRef` を空 Set で初期化していたため、教室ロード直後の初回評価で『以前から未提出だった生徒』まで「新たに未提出になった」と誤判定し、保存済みの割振済み講習を消していた。判定を純関数 `resolveNewlyUnsubmittedSessionStudents` へ切り出し、初回/再マウント(previousUnsubmittedKeys=null)は除去せず現在の未提出集合を基準として取り込むだけにし、提出→未提出へ実際に遷移した生徒だけを除去対象にした(コメント "Only clean up ... newly unsubmitted (not previously known)" の本来の意図に整合)。あわせて specialSessions 未ロード(空)の間は基準を進めず既存基準を据え置くガードを純関数へ一本化し、非同期ロードの「空→充填」遷移で既存未提出を全消しする再発も塞いだ(nextBasisKeys 番兵)。回帰テスト7件追加(修正前=初回/空充填で既存未提出を誤除去して落ち・修正後=通る)。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts

## 1.5.395

- feat: 自動割振の区分「制約事項」をソフト(強い減点+警告)からハードフィルタへ転換(Issue #44・B案・2026-07-04オーナー確定)。findBestAutoAssignCandidate のスコア構築前に純関数 shouldExcludeAutoAssignCandidateByConstraint で違反候補を continue 除外し、置ける候補が無ければ既存の「候補不足でストックに残す」経路で未消化在庫に残す。制約可リストから diversifySubjects(科目分散)を外し優先のみへ(旧データの constraint は resolveRuleCategory が優先へ丸め)。理由=違反状態で埋まるより未消化に残して気づけるほうがよいという運用哲学へ転換(2026-06-11「全ソフト維持」の意図的上書き・仕様書§Bに新旧併記)。制約対象なしは割振結果・スコア・走査順を完全不変に保つ(ゴールデン維持)。通常講師のみの判定元は配列+盤面の和集合を踏襲(v1.5.317)・『絶対事項合計』ソフト次元は存続(§H)。回帰テスト11件+モデル許可リスト縮小テスト更新(autoAssignRuleModel.ts/ScheduleBoardScreen.tsx/AutoAssignRuleScreen.tsx説明シート文言・正本 docs/spec-auto-assign-rules.md 反映)。staging実機検証で発見した画面冒頭説明文の旧ソフト挙動記述(「候補がないときだけ優先事項違反で割り振り」)もハード挙動(「守れない候補は未消化に残す」)へ更新し文言回帰テスト2件を追加

## 1.5.394

- fix: ペア制約の警告(制約=赤「組み合わせ不可」/優先=「組み合わせ回避」)を他ソフト制約(指定時限禁止・通常講師のみ・科目分散)と同一原則に統一し、通常授業(lessonType='regular')を警告対象外に(監査領域8 A3/C2オーナー確定・純関数 resolvePairConstraintWarningSeverity 新設・回帰テスト5件・自動割振スコア isPairConstraintBlocked は挙動不変)
- refactor: 日程表payloadの未使用 plannedCells 送出を全経路(scheduleHtml.ts型/serialize・App.tsx sync 2箇所・ScheduleBoardScreen all-view/useMemo/sync/open 7箇所)から撤去(監査領域9 A1/C1オーナー確定・plannedの唯一の根拠は expectedRegularOccurrences・b3279cc以降デッドと履歴で確認・buildManagedScheduleCellsForRange はテスト検証面として維持・回帰テスト追加)
- docs: 仕様監査領域8/9のオーナー確定を正本反映(spec-auto-assign-rules.md=全ソフト明記/キー名乖離/共有コア・振替同時割当/グループ二重管理/盤面∪配列判定/Excel列仕様/相互排他単位/スコア設計/4点セット等、spec-schedule-pdf.md=planned由来訂正/4.8px/二重同期H-1/印刷出し分け/派生印刷/unionガード/マルチタブ/提出済QR/盤面連動/埋め込みJS制約等)・台帳へ処置記録・Issue #42(App.tsx同期payload欠落)/#43(旧テスト教室2 QR残骸撤去)起票

## 1.5.393

- docs: 仕様監査の領域8(自動割振ルール・所見14件 A3/B9/C2)と領域9(日程表・PDF・所見16件 A2/B11/C3)を実施し監査台帳へ追記(docs/spec-audit-2026-07.md・spec-curator読み取り監査・正本/コードは未変更)。全9領域の監査が完了。C確定(領域8: 全ソフト明記/ペア制約の通常授業警告、領域9: plannedCellsデッドpayload/ポップアップ二重同期payload欠落/旧テスト教室2 QR残骸)はオーナー待ち

## 1.5.392

- fix: 講習提出の登録解除直後に、リセット前の古い購読スナップショットで登録(countSubmitted)が勝手に復活するレースを修正(監査領域7 B4)。無効だったガードを TTL 付き `createRecentlyResetGuard()` に切り出して実効化(src/integrations/firebase/lectureSubmission.ts・src/App.tsx・回帰テスト recentlyResetGuard.test.ts)

## 1.5.391

- docs+style: 仕様監査領域7(特別講習データ・提出ページ)のオーナー確定を反映。正本 `docs/spec-special-session-submission.md` を実装に合わせ更新(C2=提出は一段階モデル〈提出＝即ロック＝即countSubmitted・再提出可能化は室長の登録解除のみ〉に書換・二段階記述を撤回/C3=オプション欄optionChecksを開発用教室限定機能として正本化+学年解決の今日基準/講習開始日基準の非対称を注記・講習期間の重複禁止をA に明文化/B1集団参加の相互参照とunion反映ガード・B3永続化非対称と起動時reconcile・B5デッドdelete・B6トークン後追い反映・B7 Excel非対称・B8スマホ最適化/submit-debug・B9リセット粒度を明記)。あわせて C1: 講習編集パネルに残っていた廃止済みの死んだ案内文「…別タブで開きます。」を日程表/QR 案内へ統一(src/components/special-data/SpecialSessionScreen.tsx・回帰テスト2件追加・別タブ言及の復活を防止)。表示文言のみでロジック変更なし。監査台帳 docs/spec-audit-2026-07.md にオーナー確定を追記
- fix: staging(komahyouapp-staging)への functions デプロイが2回連続赤に。原因はソースから削除済みの孤児関数(downloadLatestClassroomRollback・gcloudで削除済み)と、Artifact Registry のクリーンアップポリシー未設定を non-interactive モードで確認できず abort していたため。`firebase deploy --only functions` に `--force` を追加し、staging限定でこれらの確認を自動承認するよう修正(.github/workflows/deploy-staging.yml)。あわせて .claude/launch.json に `dev-staging`(vite --mode staging・ポート5175)を追加し、ローカルから staging Firebase へ直接繋いで実機検証できるようにした(認証情報は .env.staging.local・gitignore済み・配信バンドルの公開設定値から生成)

## v1.5.389 (2026-07-04)

- feat: 自動割振ルールに「科目分散」(diversifySubjects)を新規追加。通常・講習を問わず同日の隣接コマ(±1時限)が同一科目になる候補を不利にし、違反は割振り対象(非通常)コマへ警告表示。区分は制約/優先の切替可(既定=優先事項)・優先順位グループとして上下入替可。旧教室データへは読込時にルール行を末尾補完(backfillMissingAutoAssignRules)。ルール未設定なら割振結果・警告とも不変(autoAssignRuleModel.ts / ScheduleBoardScreen.tsx / AutoAssignRuleScreen.tsx / App.tsx・ユニットテスト12件追加・仕様正本 docs/spec-auto-assign-rules.md 更新)

## v1.5.388 (2026-07-04)

- fix: 講師日程表で、同コマ内で別講師の机へ移動した生徒が旧講師のページにも二重表示される不具合を修正。moved_* レッスンはマージで机の講師IDが消えるため、基本データ行由来の regularTeacherIds(v1.5.247 導入の旧表示名救済)が旧講師を指し続けていた。盤面移動で配置された生徒(同日移動/元コマへ戻した振替)を regularTeacherIds の帰属から除外(src/utils/scheduleHtml.ts resolveRegularTeacherIds)。回帰テスト2件追加(ペイロード単体+移動操作→マージ→ペイロードの端到端・修正なしで落ちることを確認済み)

## v1.5.387 (2026-07-04)

- docs(changelog): 版ズレ修正(未リリース下に溜めたまま複数回デプロイした監査分を実デプロイ版 v1.5.379〜384 へ振り直し)。以後はマージごとに次版でラベル付けする(ラベル同乗ルール)

## v1.5.386 (2026-07-04)

- test: 講習ストックのゴールデン2件(lectureStockSnapshot/lecturePendingItems)が毎年4/1の年度替わりで自動的に落ちる問題を恒久対応。buildLectureStockEntries に省略可能な referenceDate を追加し(本番呼び出しは無引数のまま挙動不変)、テストは fixture 一元定義の固定基準日 2026-07-01 を渡す。referenceDate 尊重の回帰テスト追加(2028年基準で高2)。既存スナップショットは更新なしで通過=挙動不変を確認

## v1.5.385 (2026-07-04)

- chore(ci): GitHub Pages への副次デプロイを廃止(deploy-pages.yml 削除・オーナー確定 2026-07-04)。2026-03-17導入の前身デプロイで、Firebase Hosting CI 確立(6/25)以降は未参照の第二入口＋直近2日で約4割が GitHub 側エラーで赤だった。vite.config.ts の base を '/' 固定へ簡素化(6/25本番真っ白障害の発生条件そのものを消滅・経緯コメントは保持)、不活性化した FIREBASE_DEPLOY env を3ワークフローから除去、CI に dist/index.html のルート相対資産アサートを追加(regression-reviewer 検査済み・実ビルドで /KomahyouApp/ 参照0件を確認)

## v1.5.384 (2026-07-04)

- docs: 仕様監査 領域6のオーナー確定(C1: 並び替え/フィルタは生徒・講師タブに限ると補正・C2: managers完全撤去を Issue #41 に起票〈自然消滅方式の移行計画つき〉・C3: Excelシート整理の完了条件を確定)を正本 spec-basic-data.md へ反映。B2〜B6(学年ラベル定義・同一性照合ID→メール→表示名→名前は消してはならない設計・差分取込は削除しない・nextStudent*死蔵・note授業時間転用)を明文化(docs/spec-audit-2026-07.md に処置記録)

## v1.5.383 (2026-07-04)

- docs: 仕様監査 領域6(基本データ画面)を実施・所見11件(A1/B7/C3)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。UI削ぎ落とし方針(マネージャータブ/isHidden/availableSlots廃止等)はUI上実装済みで、差分はmanagers等のデータ配管残骸に集中。同一性照合ID→メール→表示名→名前は消してはならない設計と記録。C1〜C3はオーナー確定待ち

## v1.5.382 (2026-07-04)

- docs: 仕様監査 領域5のオーナー確定(C1: 日付メニュー3択に再定義〈空にする=単純クリア確定・振替える新設は Issue #40〉・C2: 残数のデルタ台帳方式を明文化＋reconcileしない・C3: 旧文書 lecture-edit-flow.md に注記)を正本 spec-lecture-stock.md へ反映。B1〜B7(データモデル・消化順・正負デルタ辞書・集計キー・specialStockSource対応表・欠席返却・overwrite返却/相殺)を「消してはならないガード」として明文化(docs/spec-audit-2026-07.md に処置記録)
- test+refactor: 講習残数計算 lecturePendingItemsByEntryKey を純関数 buildLecturePendingItemsByEntryKey として lectureStock.ts へ切り出し(ロジック不変・キー生成ヘルパ3種と LectureStockPendingItem 型も移設)、残数ゴールデン lecturePendingItems.test.ts を追加(仕様監査 領域5 C2・デルタ適用後の残数が初のユニット保護)

## v1.5.381 (2026-07-04)

- docs: 仕様監査 領域5(講習・講習ストック)を実施・所見13件(A3/B7/C3)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。振替=盤面走査/講習=デルタ台帳の構造非対称が所見の根。科目選択修正(v1.5.364)と自動割振共有コア(v1.5.331)の現存・回帰テスト保護を確認。C1〜C3はオーナー確定待ち

## v1.5.380 (2026-07-04)

- docs: 仕様監査 領域4のオーナー確定(C1: 凍結前・過去年度の休日振替は自動計上対象外＝手動追加で復帰・C2: §4撤去=balance減算撤去と確定しデータ辞書明記・C3: 削除済み未消化振替の復帰UIを Issue #39 に起票・C4: 同時間帯重複§1-D＋初期設定日フロア追加・C5: 分散正本4書と相互参照)を正本 spec-makeup-stock.md へ反映。B2データモデル/B4キー正規化/B5消化アルゴリズム/B7自動割振balance上限を「消してはならないガード」として明文化(docs/spec-audit-2026-07.md に処置記録)

## v1.5.379 (2026-07-04)

- docs: 仕様監査 領域4(振替ストック)を実施・所見15件(A2/B8/C5)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。既知事故(7/20振替消失: 凍結前origin未生成A1＋抑制suppressedMakeupOriginsの復帰UI欠如B1)と突き合わせ済み。C1〜C5はオーナー確定待ち

## v1.5.378 (2026-07-04)

- docs: 仕様監査 領域3のオーナー確定(C1: 授業時間はnote転用をデータ辞書明記・C2: 二層正本の相互参照＋B2〜B6要約取込・C3: 死蔵エディタ削除)を正本 spec-board-regular-placement.md(§6・§7新設)と spec-template-behavior.md へ反映(docs/spec-audit-2026-07.md に処置記録)
- chore: 死蔵コンポーネント RegularLessonTemplateEditor.tsx を削除(import 0件・仕様監査 領域3 C3・オーナー承認済み)。テンプレ編集はオンボード経路(ScheduleBoardScreen templateCells)のみ。copilot-instructions.md の参照も現行仕様(Q14)へ更新
- docs: CLAUDE.md の CIセットアップ記録に Cloud Scheduler 管理者ロール要件を追記(2026-07-04 functions デプロイでスケジュール関数の cloudscheduler.jobs.update 403 が初出。オーナー付与→再実行が必要)

## v1.5.377 (2026-07-04)

- chore: デッド関数 downloadLatestClassroomRollback(functions/src/index.ts)と、呼び出し0件のクライアント死蔵ラッパー downloadLatestFirebaseClassroomRollback＋型 ClassroomLatestRollback(src/integrations/firebase/adminFunctions.ts)を撤去(仕様監査 領域2 補足の掃除・オーナー承認済み 2026-07-04)。書き込み側 mirrorLatestClassroomRollback とヘルパーは手動復旧用に維持
- chore(ci): deploy-functions.yml に --force を追加(--non-interactive のみではソースから削除した関数を本番から消せずデプロイが失敗するため。関数削除はオーナー承認済みマージのみ main に入れる運用を注記)

## v1.5.376 (2026-07-04)

- docs: 仕様監査 領域3(コマ表の基本配置・テンプレ方式)を実施(docs/spec-audit-2026-07.md)。所見10件(A1/B6/C3)＋一致点12項目。上位正本と細部正本 spec-template-behavior.md の二層関係が未明記(B1)、テンプレ凍結(B2)・overwrite時ストック返却/相殺(B3)が上位正本未定義である点を特定。オーナー確認C1〜C3は確定待ち
- docs: 領域2補足の訂正(downloadLatestClassroomRollback は「src/ 参照0件」でなく死蔵ラッパーが存在。ブランチ chore/remove-dead-rollback-download で両方撤去・マージはオーナー承認待ち)

## v1.5.375 (2026-07-04)

- docs: 仕様監査 領域2のオーナー確定(C1: 離脱時は実装を正・C2: transient再試行を例外明文化・C3: 復元警告を実装)を正本 spec-save-restore.md へ反映。B1〜B6(楽観ロック・保存時3層防御・QR反映非対称・全教室書出・平文・Feature B)を明文化し「消してはならない破壊防止ガード」を明記(docs/spec-audit-2026-07.md に処置記録)
- fix: 開発者画面のサーバーバックアップ復元モーダルに不可逆警告「復元すると選択教室の現在データは上書きされ、元に戻せません」を追加(spec-save-restore §4 の警告必須要件・監査 領域2 A3。DeveloperAdminScreen.tsx＋回帰テスト DeveloperAdminScreen.test.ts)

## v1.5.374 (2026-07-04)

- docs: 仕様監査 領域2(保存・バックアップ・復元)を実施(docs/spec-audit-2026-07.md)。所見12件(A3/B6/C3)＋一致点14項目。楽観ロック・空データ上書き拒否・読み戻し検証など「意図的な破壊防止ガード」が正本未定義である点を特定(B1/B2)。オーナー確認事項C1〜C3は確定待ち(正本 spec-save-restore.md は未編集)

## v1.5.373

- docs: CHANGELOG の版ズレ修正(v1.5.371ラベル単独pushが変更なし版として挟まったため監査分をv1.5.372へ付け替え)。solo-git-workflow スキルに「版ラベルは内容と同じpushに含める」ルールを追記(再発防止)

## v1.5.372

- docs: 仕様監査（全9領域・オーナー指示2026-07-04）の台帳 docs/spec-audit-2026-07.md を新設し、領域1(教室権限・ログイン・開発者画面)を監査。所見12件(A3/B4/C5)。オーナー確定を正本 spec-classroom-auth.md へ反映(一時停止は全件一括のみ・localは開発専用・contractStatusデータ辞書)。教室追加のアプリ内完結化は Issue #38 起票

## v1.5.371

- (変更なし: CHANGELOG ラベル付けのみの再デプロイ)

## v1.5.370

- chore: 保守運営体制のブラッシュアップ。spec-curator エージェント新設(思いつき要望→要求仕様の補完・確定役)、モデル割当方針(単純作業=Sonnet最新/判断=Opus最新・モデルID固定禁止)と標準フロー(triage→spec-curator→dev-fix→regression-reviewer→safe-release)を CLAUDE.md に明文化。bug-triage スキルに仕様確定ステップを追記。古い引き継ぎ文書2件(docs/NEXT-SESSION-PROMPT.md, SESSION-HANDOFF.md)へ廃止ヘッダ追加(.claude/agents/spec-curator.md ほか)

## v1.5.369

- fix: 講習集計結果ページの最下部がWindowsタスクバーに隠れて見えない問題を修正。ポップアップ本文に padding-bottom:160px を追加し、最後の行までスクロールで確実に見えるようにした(印刷時は0に戻す)。回帰防止アサート追加(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.368

- feat: 生徒日程表の「印刷用全員表示」の左に「講習集計結果」ボタンを追加。表示期間に講習期間(specialSession)が重なるときだけ表示し、クリックで全生徒の講習登録状況(登録/未登録、登録でも通常のみは「登録（通常のみ）」の注記)を新タブに一覧表示する。判定は studentInputs の countSubmitted=登録・regularOnly=通常のみ。読み取り専用(DATA参照+新タブ生成のみ、Firestore書き込みなし)。埋め込みスクリプト系のため new Function 抽出で状態分類を、生成HTMLの配線有無を回帰テストで担保(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.367

- chore(一時機能撤去): 7/20休日振替の復帰ボタン(v1.5.366で追加)を撤去。対象4名(緑が丘 白川:数/古賀:英、日大前 劉:数/神:理)の復帰は室長が各教室でクリック→手動保存済みで本番反映を確認(manualMakeupAdjustmentsに7/20あり・suppressedMakeupOriginsから除去済み)。撤去は button/ハンドラ/import/restore720Holiday.ts/restore720Holiday.test.ts の削除のみでデータには非干渉のため7/20は在庫に残り続ける(src/components/schedule-board/ScheduleBoardScreen.tsx・restore720Holiday.ts削除・関連コミット 2edf396)

## v1.5.366

- docs: リリースチェックリストに「在庫数量(未消化振替/講習)の非退行チェック」§6を追加。ゴールデンスナップショット(makeupStockSnapshot/lectureStockSnapshot)を自動ガードとして明記し、意図的変更時のみ -u 更新+目視レビューするルール、在庫計算を触った版の本番スポットチェック手順、2026-07-03基準値(未消化振替294/未消化講習raw1436)を記録(docs/runbooks/release-checklist.md)
- feat(一時機能): 7/20(海の日)の休日振替を対象4名だけ未消化振替へ復帰する一時ボタンを未消化振替パネルに追加。テンプレ凍結で在庫計算(buildMakeupStockEntries)から漏れた7/20を、対象キー(緑が丘 白川:数/古賀:英、日大前 劉:数/神:理)に「手動追加(manualMakeupAdjustments) + 抑制解除(suppressedMakeupOrigins)」の両方を適用して復帰する(片方だけでは+0=両方必須)。対象教室(actingClassroomId)のときのみ表示・冪等。純粋ロジックは新規 restore720Holiday.ts に分離し回帰防止テスト付き(実データで各キー+1・他生徒不変を検証済み)。**室長が各教室で1クリック→手動保存した後、本ボタンは撤去する**(撤去後も保存済みデータに残り7/20は在庫に残り続ける)。buildMakeupStockEntries自体は不変=ゴールデン不変(src/components/schedule-board/restore720Holiday.ts・ScheduleBoardScreen.tsx)

## v1.5.364

- fix(未消化講習): モーダルで選んだ科目が無視され、常に先頭科目が配置される不具合を修正(例: 中3で数学を選ぶと英語が置かれる)。振替(makeup)側の rawKey に相当する選択科目の尊重が講習側に無かったのが原因(2026-03-20/06-15 由来の既存バグ・直近デプロイとは無関係)。選択科目(subject+sessionId)を記憶し配置対象を解決する純粋関数 `resolveSelectedLecturePlacementItem` を追加、未選択/不一致は先頭へ安全フォールバック。回帰防止テスト付き(src/components/schedule-board/lectureStockPlacement.ts・ScheduleBoardScreen.tsx)

## v1.5.363

- refactor: 振替在庫の「空きコマ不足」自動origin(`computeOccupiedSlotOrigins`)を経路ごと廃止(オーナー指示 2026-07-03)。テンプレ毎週強制適用が前提で開講日にコマが埋まっていても未消化を自動生成しない。過去にこの偽originが大量発生→一括削除される際、本物の休講日振替(例: スクールIE緑が丘 白川 数 7/20)まで巻き込まれ消える事故の再発防止。未消化源は「休講日(自動)/同時間帯重複/手動」のみに一本化。占有origin関連テストは新契約(在庫を生成しない)へ反転(src/components/schedule-board/makeupStock.ts・makeupStock.test.ts)

## v1.5.362

- style: 警告時のセル黄色背景(`.sa-warning`)を全条件で廃止。警告は名前の赤文字(出席不可コマ配置のみ)とツールチップで示す。背景を支えていた `.sa-warning .sa-student-detail` の文字色調整も併せて削除(見た目のみ・ロジック/クラス付与は不変・src/App.css)

## v1.5.361

- style: 生徒名の赤文字ハイライトを「出席不可コマに配置された生徒」のみに限定(制約違反/講師なし/手動追加等の他警告はセル背景=黄とツールチップのみで示し名前は赤くしない・講師名は従来から出席不可のみで変更なし・ツールチップは不変)。名前の赤文字判定を純関数 `shouldHighlightStudentName` に集約し回帰テスト追加(src/components/schedule-board/BoardGrid.tsx・ScheduleBoardScreen.tsx・types.ts)

## v1.5.360 (2026-06-30)

- feat: 生徒日程表の登録ダイアログと QR 提出画面の「集団授業(集団理科/集団社会)」の選択肢を、その講習の期間内に**少なくとも1回その集団科目がコマ表(盤面)に登録されているときだけ**表示するよう変更(オーナー要望 2026-06-30)。集団授業を設定しない講習では集団欄を一切出さない(中3でも)。盤面の集団科目を canonical 順で抽出する純関数 `resolveRegisteredGroupClassSubjects` を新設(src/components/schedule-board/groupClass.ts)。App.tsx は QR 提出ドキュメントの `availableGroupClassSubjects`(新規発行・既配布の後埋め)をこの結果に限定。生徒日程表は scheduleHtml 埋め込みJSに `getGroupClassSubjectsInRange` を追加し登録ダイアログの集団欄を出し分け。既提出データ・提出状況は不変。回帰防止テスト6件追加(groupClass.test.ts: 未登録=空/盤面登録科目のみ/canonical順/重複排除/期間外除外/境界日含む)。

## v1.5.359 (2026-06-30)

- feat: コマ表盤面・テンプレの講師名選択肢から、同じコマ(同セル)の他机に既に割り振られている講師を除外(オーナー要望 2026-06-30)。1人の講師が同コマで複数の机を担当することはできないため、選択肢に出さないことで二重配置を未然に防ぐ。編集中の机自身の講師(currentTeacher)は除外しない。`buildTeacherSelectionOptions` 内で同セルの他机の `teacherAssignmentTeacherId`/`teacher`(名)を集めて除外集合を作り、id 一致・表示名一致の双方で判定。盤面/テンプレ両モードの3呼び出し元すべてに共通適用(src/components/schedule-board/ScheduleBoardScreen.tsx)。回帰防止テスト: 他机講師の除外/現在机の講師は残す/id一致での除外/テンプレモードでの除外、の4件に更新・追加。

## v1.5.358 (2026-06-30)

- fix: 講師日程表で授業コマ(週グリッド)が縦に長く、画面/印刷で下部が見切れてスクロールしないと全体が見えない講師ページを A3 縦へ自動切替するよう修正。従来の A3 自動切替は給与計算スクロール枠(`.salary-scroll`)のはみ出しだけを検知しており、グリッド自体が長くてシート本体(`.sheet` は overflow:hidden + A4横アスペクト比固定)からはみ出すケースを拾えていなかった。`applySalaryOverflowPaging` でシート全体のはみ出し量 `sheet.scrollHeight - sheet.clientHeight` も計測し、判定を純関数 `shouldTeacherSheetUseA3(salaryHidden, sheetOverflow)` に切り出し(給与 >2px か シート >4px で A3)。A3縦は幅がA4横と同じ297mmなので週グリッドの横レイアウトは保ったまま縦に伸ばして全コマ+給与を1ページに収める。回帰防止テストとして出荷スクリプトから純関数を `new Function` 抽出し挙動を固定(src/utils/scheduleHtml.ts)。

## v1.5.357 (2026-06-30)

- fix: 講師がQRで提出した出席可否が「開いても反映されない/リロードしても戻らない/講師日程表から登録し直さないと出ない」不具合を修正(v1.5.356 の取りこぼし修正とは別の根本原因)。真因は保存タイミングの非対称: `countSubmitted`(提出反映フラグ=specialSessions)は手動保存なしでも workspace 自動同期で永続化される一方、盤面への講師配置(weeks)は手動保存のみ。よって手動保存前にリロードすると配置だけ揮発し、以後は取り込みの `countSubmitted` ガード(App.tsx onSubmitted 3742)でスキップされ二度と自動配置されずスタックしていた。対策として起動(マウント=教室ロード/リロード毎に boardMountKey で再マウント)時に「提出済みなのに盤面に居ない講師」を自己修復する純関数 `reconcileSubmittedTeacherPlacements` を追加(未配置の講師だけ冪等に配置・既に一部でも schedule-registration 配置済みの講師は触らず室長の手動調整/部分削除を尊重)。回帰防止テスト3件追加(未配置→配置/配置済みは不変/未提出は対象外)。あわせて自動配置はスロットごと独立で、満席の4限が空きの1限をスキップさせない挙動も確認済み。src/components/schedule-board/ScheduleBoardScreen.tsx。

## v1.5.356 (2026-06-30)

- fix: 講師がQRで出席不可コマを提出しても出席可能コマに名前が追加されない不具合を修正。原因は QR一括取り込み(`subscribeLectureSubmissions` onSubmitted)で講師ごとに `setTeacherAutoAssignRequest` をループ発行していたが、リクエストが単一 `useState` のため同一スナップショットで複数講師が届くと最後の1人ぶんしか盤面配置されなかった(室長が起動/リロードした初回スナップショットで複数講師の提出が一括到着する経路で再発しやすい)。`TeacherAutoAssignRequest` を `items[]` 化し全講師を1リクエストにまとめ、受け手 `ScheduleBoardScreen` の `applyTeacherAutoAssignRequest`(新規・純関数)で全件を weeks へ畳み込む。回帰防止テスト追加(`buildTeacherAutoAssignItems`=全講師ぶん生成 / `applyTeacherAutoAssignRequest`=2講師とも配置)。src/App.tsx・src/components/schedule-board/ScheduleBoardScreen.tsx。

- chore(test): Playwright E2E を廃止(全挙動をユニットへ移植完了)。`tests/`・playwright 各 config・`@playwright/test`・`test:e2e*` スクリプトを削除。`ci-tests.yml` は e2e ジョブ2つを削除し手動 `rules` ジョブを追加。CLAUDE.md/dev-fix/safe-release/release-checklist/.vscode を新方針へ更新。lint の未使用 import(rules テストの expect)も修正。自動テストは ユニット425件(毎push)＋ルール13件(手動)。方針は docs/test-strategy.md。
- refactor(test): E2E廃止の前提整備(層1残り)。盤面の警告評価を純粋関数へ挙動不変で抽出しユニット化(+15)。科目対応外(`canTeacherHandleStudentSubject` を export・35) / 一コマ空け等の授業パターン(`resolveLessonPatternWarnings`・36,37) / 講習絶対制約(`isLectureOutsideSessionPeriod`・55, `isStudentUnavailableAtSlot`・56)。これでE2Eが唯一カバーしていた警告表示もユニットで担保。全425テスト＋build 緑。

## v1.5.351 (2026-06-29)

- test(rules): E2E廃止の代替・層2。Firestore セキュリティルールの分離テストを追加(`firebase/rules/firestore.rules.test.ts`・13件・`npm run test:rules` でエミュレータ実行)。教室アクセス分離(担当外教室は読めない)/保存の裏口防止(マネージャーは classroomSnapshots 直書き不可=CF経由のみ)/members 権限保護/billing限定を検証。毎push の `test:unit` には含めず(エミュレータ不要のまま)。`@firebase/rules-unit-testing` 導入。

## v1.5.350 (2026-06-29)

- refactor(test): E2E廃止方針に伴い、生徒移動ロジックを純粋関数 `computeStudentMove` へ挙動不変で抽出(executeMoveStudent は委譲)。盤面移動のE2Eシナリオ(基本移動/講師保持/同日・別日移動/同コマ重複ブロック/同一位置/滞留ステータス除去/入れ替え)をユニット化(+7)。全410テスト＋build 緑。方針と移植マップは docs/test-strategy.md。

## v1.5.349 (2026-06-29)

- fix(コマ表): 生徒を移動して移動元の机が0人(レッスン無し)になっても講師名を保持するようにした。executeMoveStudent で空になった移動元机を manualTeacher 扱いに固定し、commit 後の managed 再マージ(mergeManagedWeek の自動割当講師クリア分岐, ScheduleBoardScreen.tsx 2467行付近)で講師名が消えないようにする。入れ替え(swap)は移動元に相手生徒が入り対象外。回帰防止テスト追加(ScheduleBoardScreen.test.ts)。staging(隔離開発環境テスト教室)で同日・別机/別日の移動を実機確認し、移動元の講師(斎藤/山崎)が残ることを確認済み。

## v1.5.348 (2026-06-29)

- docs(運用): triage エージェント(.claude/agents/triage.md)に「着手前に必ず曖昧点・未言及の影響点を質問で返す」手順を追加。対象/再現条件/期待挙動の曖昧さに加え、他機能・他教室・保存/QR/自動割振への波及、過去修正の巻き戻し、データ影響、仕様の例外ケースを能動的に点検し、少しでも不明なら AskUserQuestion 等で確認してから起票/着手する。任せる旨の明言時は採用前提を Issue に明記。
## v1.5.347 (2026-06-29)

- docs(監視): docs/runbooks/monitoring.md に UptimeRobot による5分間隔の外部監視セットアップ手順(オーナー作業)を追記。GitHub Actions の15分外形監視と二段構えにする。
- docs(e2e): e2e #35 の調査結果を Issue に記録。失敗は emulator e2e は解消済みで local e2e のみ、根因は(1)削除済み機能(休み欄 v1.5.334)を検証する stale テスト群と(2)headless クリーン状態での前提崩れ。安易に緩めず現行仕様に合わせた更新が必要(別タスク)。
## v1.5.346 (2026-06-29) — lint 負債解消(挙動中立)

- chore(lint): lint エラー96→0(挙動中立)。eslint.config.js で react-refresh/only-export-components を warn 化(開発時専用・実行時影響なし)、no-unused-vars に `^_` 無視を追加(既存の意図的未使用規約を尊重)。地雷の scheduleHtml.ts は no-useless-escape をファイル単位 disable(埋め込みスクリプトのエスケープは意図的・memory 参照で変更厳禁)、gmail/drafts.ts の no-control-regex は意図的 disable。App.tsx/BasicDataScreen.tsx の react-hooks/refs は「最新値を ref に同期」する定番イディオムのため個別 disable。ScheduleBoardScreen.tsx の prefer-const×2、functions の未使用型4件(コンパイル出力不変)、テストの未使用識別子(`_`化)/any→unknown を整理。CI(ci-tests.yml)の lint をブロッキング化し再発防止。unit402/前後build/functions build 緑。
## v1.5.345 (2026-06-29) — Phase3/4: ロールバック手順＋外形監視(アプリ挙動の変更なし)

- docs(運用基盤/Phase3): ロールバック手順書 docs/runbooks/rollback.md(症状別 A=Hosting/B=Functions/C=データ復元・クロス汚染注意)を追加。リリースチェックリストを PR テンプレ(.github/PULL_REQUEST_TEMPLATE.md)に組み込み運用開始。safe-release スキル・CLAUDE.md から参照。
- chore(運用基盤/Phase4): 外形監視を追加。tools/uptime-check.mjs ＋ .github/workflows/uptime-check.yml(15分ごと＋手動)が本番の index/version.json/QR API を確認し、異常時は incident:uptime ラベルの Issue を自動起票(復旧で自動クローズ)＋ワークフロー赤で通知。手順 docs/runbooks/monitoring.md(GitHub スケジュールの限界と UptimeRobot/Cloud Monitoring 併用の推奨も記載)。

## v1.5.344 (2026-06-29) — 保守運営の体制づくり(アプリ挙動の変更なし・運用基盤のみ)

### Phase 1: 役割・課題管理・テストゲート
- chore(運用基盤): 役割エージェント3体(.claude/agents/ の triage / dev-fix / regression-reviewer)を追加。曖昧な報告の整理→修正→回帰検査を分担。
- chore(運用基盤): スキルを追加(regression-guard=回帰防止の実務版 / bug-triage=報告のIssue一本化 / staging-environment=検証環境の使い方)。CLAUDE.md に体制の節を追加。
- chore(運用基盤): GitHub Issue テンプレ(.github/ISSUE_TEMPLATE/ bug_report・feature_request・config)とラベル体系(type/severity/area/status 計15個)を整備。
- chore(CI): テストゲート .github/workflows/ci-tests.yml を追加。push/PR ごとに必須ゲートとして unit(vitest 402件)＋build を実行(約1分・決定的)。lint は既存負債96件のため continue-on-error の参考表示。Playwright e2e(local/Firebaseエミュレータ)は headless CI で18件不安定・18分かかるため workflow_dispatch の手動のみに分離(安定化は Issue #35)。emulator は firebase-tools 要件で Java21。

### Phase 2: 専用 staging 環境(komahyouapp-staging)
- chore(運用基盤): 本番(komahyouapp-prod)と分離した検証用 Firebase プロジェクト komahyouapp-staging を導入。書き込み自由な実機検証環境。.firebaserc に staging エイリアス、オーナー作業手順書 docs/runbooks/staging-setup.md。
- chore(staging): 手動デプロイ CI .github/workflows/deploy-staging.yml。hosting と functions を別ステップに分離(gen2 の 409 が hosting release を巻き込む「Site Not Found」回避)、hosting の「is the current active version」400 を本番同様 benign 成功扱い、functions に STORAGE_BUCKET 注入(本番バケットへのクロス汚染防止)、Java21、gen2 functions に allUsers→run.invoker 付与(本番同等の公開呼び出し=保存/QR の 403 解消・認証は関数内で検証)。
- chore(staging): 検証用の教室ブートストラップ/シード(講師40・生徒150・通常授業240)スクリプト+CI(.github/workflows/staging-bootstrap.yml・staging-seed.yml、functions/scripts/、projectId!=staging なら中断の本番保護)。
- chore(CI): deploy-functions.yml の paths に !functions/scripts/** を追加(staging 専用スクリプトで本番 functions が誤って再デプロイされないように)。
- docs(運用基盤): safe-release スキル(.claude/skills/safe-release)とリリース前チェックリスト(docs/runbooks/release-checklist.md)を追加。staging 実機検証→本番→ライブ検証→ロールバックの流れを制度化。CLAUDE.md から参照。

## v1.5.343 (2026-06-29)

- feat(生徒日程表): 講習の登録ダイアログでも、QRと同じように科目ごとの授業時間(90/60/45分)を選択できるようにした。各科目の希望数の隣に授業時間プルダウンを追加(90=既定、60/45のみ保持)。登録すると subjectDurations として保存され、回数表/講習ストックの授業時間表示(60/45サフィックス)に反映。登録済みは「2 (60分)」のように読み取り表示。通常のみONでプルダウンも無効化。既存のQR提出値は未送信時に保全(消さない)。回帰防止: schedule-student-count-save ハンドラが従来 subjectDurations をメッセージから反映せず既存保全のみだった点を修正し、配線文字列の存在テストを追加(src/utils/scheduleHtml.ts・src/App.tsx・scheduleHtml.test.ts)

## v1.5.342 (2026-06-28)

- fix(盤面): 自動割振ルール「指定時限禁止」の制約違反で、固定の通常授業まで生徒名が赤文字になっていた不具合を修正。「通常講師のみ」と同様、通常授業(lessonType==='regular')は割振り対象でないため違反扱いしない。判定を純粋関数 shouldWarnForbiddenPeriod に切り出し回帰防止テストを追加(src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts)
- fix(生徒日程表): 講習自動割振の後、開いていた生徒日程表タブで「最新表示」を押しても割り振った講習が反映されない(タブを閉じて開き直すと反映される)不具合に対処。「最新表示」は popup→opener の postMessage 往復に依存して取りこぼし/競合が起きうるため、自動割振の確定後に board→popup 方向で日程表popupを1回だけ能動再同期するトリガを追加(往復に依存せず盤面内容と揃える。popup 未表示時は no-op / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.341 (2026-06-28)

- feat(盤面): 長押しD&D移動中、盤面の端付近(上下左右)へポインタを寄せると盤面が自動スクロールするようにした(画面に表示されていない画面外のコマへも移動できる)。requestAnimationFrame で掴んでいる間だけ回し、端からの距離に応じて速度を可変(外側へ出るほど速い・上限あり)。state を毎フレーム更新せず scrollLeft/scrollTop を直接操作(再描画を増やさない / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.340 (2026-06-28)

- fix(盤面): 長押しD&D移動中に他の生徒名の上を通ると文字選択(青いハイライト)になり見えづらかった不具合を修正。ドラッグ中の盤面に user-select:none を適用し、掴んだ瞬間に既存の選択を removeAllRanges でクリアするようにした(src/App.css・src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.339 (2026-06-28)

- fix(盤面): 長押しD&Dで生徒を離しても配置されず、再クリックが必要だった不具合を修正。原因はドロップ
  (mouseup)が mousedown 時点の古い executeMoveStudent クロージャ(selectedStudentId=null)を呼んでいたため。
  executeMoveStudent に掴んでいる生徒IDを明示で渡せるようにし、ドロップは安定ラッパ経由で最新クロージャを
  実行するよう変更。離した瞬間に配置が確定する。配置できないコマ(メモ/出席済み/重複等)へ離した場合は選択を
  解除してキャンセル扱いにする(再クリックで配置を残さない / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.338 (2026-06-28)

- feat: 生徒名の長押しD&D移動を全教室へ展開(featureRollout の studentDragAndDropMove を development-only → all-classrooms。オーナー指示 2026-06-28・回帰テスト更新 / src/utils/featureRollout.ts)
- style: 長押しD&D移動中の画面周囲の青枠を点滅(パルス)させず、移動中ずっと一定で表示し続けるよう変更(src/App.css)

## v1.5.337 (2026-06-28)

- feat: ライブ盤面で生徒名を長押し(約250ms)してから別の机コマへドラッグ&ドロップで移動できる機能を追加(PC マウス専用・開発用教室限定で先行有効)。実移動は既存 executeMoveStudent を再利用し入れ替え/メモ/出席済み/重複/同位置などのブロックを踏襲。移動中は画面周囲に色枠を表示、移動先は純CSS :hover で強調(毎フレーム再描画を増やさない設計)。出席済み生徒はドラッグ不可、Esc/盤面外ドロップでキャンセル(src/components/schedule-board/BoardGrid.tsx, ScheduleBoardScreen.tsx, src/App.css, src/utils/featureRollout.ts)

## v1.5.336 (2026-06-27)

- fix(集団授業): 登録済み中3の集団参加(集団理科/集団社会)・オプションが、起動直後の購読反映で
  一括消失する回帰を恒久修正(本番データ消失。緑が丘5名・日大前2名が同一時刻に {} へ消失を確認)。
  原因は `reflectParentOwnedSubmissionFields`(src/utils/submissionReflection.ts)が空の提出ドキュメント
  ({}・v1.5.335 以前に室長登録した中3の doc は空のまま)で登録済みローカル値を上書き消失させていたため
  (購読 entry は常に `?? {}` で届くので `entry ?? existing` の保全が効かない)。反映を **union(追加のみ・
  削減しない)** に変更し、空 doc が既存を消さないようにした。この経路は countSubmitted=true(提出ロック済み)
  の生徒にだけ走るため保護者が QR で外すことはなく union で安全。これにより v1.5.335 以前の空 doc も
  再登録不要で自己修復する(次回読込で消えなくなる)。回帰防止テスト追加(submissionReflection.test.ts)。

## v1.5.335 (2026-06-27)

- fix(集団授業): 生徒日程表で室長が手動で集団参加をチェックして登録しても「最新表示」/再読込で
  集団参加が消える回帰を修正。原因は登録時に提出ドキュメント(lectureSubmissions)へ集団参加/オプションを
  書き戻しておらず、doc が空のまま購読の反映(doc→ローカル: reflectParentOwnedSubmissionFields)が
  室長の手動設定を空で上書きしていたため(登録解除→登録の経路では doc が空に戻るため特に再発)。
  `markLectureSubmissionDocAsSubmitted` に集団参加/オプションの書き戻しを追加し、生徒 count-save 経路で
  最新ローカル値を渡すよう変更。回帰防止テストを追加
  (src/integrations/firebase/lectureSubmission.ts・src/App.tsx・lectureSubmission.test.ts)。
  ※既に登録済みで集団参加が消えてしまった中3は、一度「登録解除」してから集団をチェックして再登録すると恒久反映される。

## v1.5.334 (2026-06-27)

- feat(生徒日程表): オプション欄機能(休み欄を削除し振替を左詰め＋2列5行のオプション欄/QR提出のチェック
  往復)を開発用教室限定から全教室へ公開。featureRollout の studentScheduleOptionField を
  development-only → all-classrooms に変更し、回帰防止テストを追加(オーナー指示 2026-06-27 /
  src/utils/featureRollout.ts)
  ※「未消化振替も同時に自動割り当て」は v1.5.331 で既に全教室公開済みのため追加変更なし。

## v1.5.333 (2026-06-27)

- style(QR提出ページ): Android の表示補正をオーナー指示で iOS と同じ 幅520+zoom0.7 に変更。ただし
  「出席不可コマの表は現状の全幅のまま」の要望に合わせ、Android のときだけ表(.sub-table-wrap)へ
  逆ズーム(1/zoom)を当てて全幅へ戻す(見出し/科目数/ボタン等の固定pxだけ 0.7 で縮む。iOS は従来どおり
  表も 0.7 のまま)。ネスト zoom+vw の挙動はブラウザ実測で全幅維持を確認
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx)

## v1.5.332 (2026-06-27)

- style(生徒日程表): 振替欄が枠に収まらない問題に対応し、年と曜日を省いて月日+限だけに詰めて表示
  (compactMakeupSourceLabel/compactMakeupDateSlot 追加・講師日程表の振替欄も同様・埋め込みスクリプトの
  正規表現は二重エスケープ必須・回帰テスト追加 / src/utils/scheduleHtml.ts)
- style(QR提出ページ): オプション欄のチェック右の「なし/あり」テキストを削除(編集画面のみ。提出済み閲覧は
  状態表示として維持 / src/components/submission/SubmissionPage.tsx)
- fix(QR提出ページ): Android のボタン/文字が大きすぎる問題に対応。iOS と同じビューポート幅補正方式で
  Android も一様縮小(既定 ANDROID_VIEWPORT_WIDTH=480・vw化の撤回 c4563f6 を踏襲し固定px維持)。
  実機調整用に #/submit-debug をプラットフォーム判別対応にし Android 値も調整・表示
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx・main.tsx)

## v1.5.331 (2026-06-27)

- feat: 未消化講習の自動割振モーダルに「未消化振替も同時に自動割り当てする」チェックボックス(既定OFF)を追加。ONにすると講習を全配置した後、同じ生徒の未消化振替を講習期間内の空きコマへ「振るい順(古い振替元から)」で同一規則で割り振る(src/components/schedule-board/ScheduleBoardScreen.tsx)。開発用教室で実機検証済み
- refactor: 講習・振替の自動割振候補探索を共有コア `findBestAutoAssignCandidate` に統一(規則ロジックの二重管理=ドリフトを防止)。講習側の出力スコアは従来と完全一致(回帰防止)
- test: `buildMakeupAutoAssignPendingItems`(振るい順展開・balance厳守)の単体テストを追加(src/components/schedule-board/ScheduleBoardScreen.test.ts)

## v1.5.330 (2026-06-27)

- docs: 更新リスト `CHANGELOG.md` を新規導入(編集ごとの記録ルールを明文化)
- docs: solo-git-workflow スキルに「編集前のデプロイ済み最新との同期確認」と「更新リスト記載義務」「コミット〜main マージの常時許可」を追記
- docs: CLAUDE.md に上記必須手順へのポインタを追加

---

> これ以前の履歴は git log の `chore(release): vX.Y.Z` コミットを参照
> (CHANGELOG 導入時点のデプロイ済み最新は v1.5.329)。
