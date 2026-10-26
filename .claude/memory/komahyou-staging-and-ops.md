---
name: komahyou-staging-and-ops
description: コマ表アプリの保守運営体制づくり・専用staging環境の導入。決定事項とPhase進捗
metadata: 
  node_type: memory
  type: project
  originSessionId: 71bfd5fe-5a7d-4bbd-8c4b-c30125f2ea0e
---

2026-06-29 開始。複数ユーザー本格導入に向けた保守運営体制づくり。オーナーの決定事項:

- **体制**: オーナー1人＋Claude(エージェント)。人間の追加採用は当面なし。
- **最優先**: リリースの安全性(自動テスト網羅・本番そっくりstaging実機確認・即ロールバック・リリース前チェックリストの4本柱すべて)。
- **開発環境**: 本番(komahyouapp-prod)と分離した**専用Firebaseプロジェクト `komahyouapp-staging`** を新設。書き込み自由でClaudeの検証先にし、本番内「開発用教室1つ」依存(教室取り違え汚染の温床)を解消。クラウド設定はGitHub Actionsで極力自動化。
- **課題管理**: GitHub Issues に一本化(テンプレ・ラベルでトリアージ)。現状は口頭/LINEで未整理。
- **役割エージェント**: triage(報告整理)・dev-fix(開発修正)・regression-reviewer(回帰検査) の3体に分ける方針。リリースは専用エージェントでなくsafe-releaseスキル＋CIで回す。

進捗:
- **2026-06-29 完了・本番マージ済み(v1.5.344)**。Phase1+Phase2 を main へ統合(merge c258bfd)、CI で本番 hosting+functions 再デプロイ成功・prod live=1.5.344(アプリ挙動の変更なし=運用基盤/docs/CIのみ)。feature ブランチ2本は削除済み。staging は構築〜ログイン〜保存/QR実機検証まで全て OK。
  - 後片付け済み: 3つの staging workflow(deploy-staging/bootstrap/seed)は workflow_dispatch 専用に戻した(main にあるので手動実行可能)。deploy-functions.yml に !functions/scripts/** を追加(ただし deploy-functions.yml 自身の編集はそのワークフローを発火させる点に注意=今回 prod functions が同一コードで再デプロイされた)。
- (旧記録)**Phase 2(staging・最優先)着手**。ブランチ `feat/staging-environment-setup`(9f320a2〜)。
  - 追加物: `.github/workflows/deploy-staging.yml`(手動), `.firebaserc` staging エイリアス, `docs/runbooks/staging-setup.md`(オーナー作業手順), `.claude/skills/safe-release`, `docs/runbooks/release-checklist.md`, CLAUDE.md 参照追記。
  - **地雷**: `functions/src/index.ts:25` の STORAGE_BUCKET 既定が本番バケット。staging functions に `STORAGE_BUCKET` を渡さないとstagingから本番Storageを触る。CIが `STAGING_STORAGE_BUCKET` を `functions/.env.komahyouapp-staging` に注入して防止。
- **staging 構築完了 2026-06-29**: `komahyouapp-staging` 稼働中(https://komahyouapp-staging.web.app・HTTP200・v1.5.343)。hosting+firestore/storageルール+functions 全部デプロイ済み・QR submission API も200。本番は無傷を確認。
  - SA は `ci-deployer@komahyouapp-staging` に **Owner** 付与(編集者だけだと gen2 Functions 初回デプロイの IAM ポリシー書換で "failed to modify the IAM policy" 失敗→Owner で解決)。IAM 反映は数分かかる。
  - GitHub Secrets 3件登録済み(STAGING_FIREBASE_WEB_ENV / STAGING_FIREBASE_SERVICE_ACCOUNT / STAGING_STORAGE_BUCKET=komahyouapp-staging.firebasestorage.app)。env は VITE_FIREBASE_ENABLE_FUNCTIONS=true・FUNCTIONS_REGION=asia-northeast1 込み。
  - **deploy-staging.yml の重要修正**(構築中に判明): ①workflow_dispatch は main に無いと起動不可→暫定で push トリガ(branch=feat/staging-environment-setup)追加(**main統合前に外す**)。②hosting と functions を別ステップに分離(gen2 409 が hosting release を巻き込み Site Not Found を防ぐ)。③hosting の "is the current active version" 400 を本番同様 benign 成功扱い。Java21。
  - **ブートストラップ完了**: 管理者 オーナーの Google アカウント(UID <オーナーUID>)＋教室 staging_test_classroom「隔離開発環境テスト教室」を作成済み。仕組みは `functions/scripts/staging-bootstrap-first-classroom.mjs`＋`.github/workflows/staging-bootstrap.yml`(config 投入で起動・projectId!=komahyouapp-staging なら中断の本番保護)。firebase-admin v13 は initializeApp の戻り値から projectId を見る(db.app は無い)。
  - **検証用シード投入済み**: 講師40・生徒150(小1〜高3分散)・通常授業240コマ。`functions/scripts/staging-seed-data.mjs`＋`.github/workflows/staging-seed.yml`(スクリプト変更で起動)。classroomSnapshots/{id}.data にプレーン保存(loaderがdataを直接読む経路・split/圧縮未使用)。specialSessions/autoAssignRules/settingsは維持。冪等(set上書き・versionは+1ではなく現状+1)。
  - データ読込経路の要点: workspaceStore.readFirebaseSnapshotPayload は dataEncoding 未設定なら snapshot.data をそのまま使う。型は basicDataModel.ts(TeacherRow/StudentRow)・regularLessonModel.ts(RegularLessonRow)。
  - **403 ハマり→解決(重要)**: 保存(callable saveClassroomSnapshot)もQR(lectureSubmissionApi)も初回は 403。原因は gen2 functions の Cloud Run サービスが未認証呼び出し不可だったため(本番は invoker:'public')。deploy-staging.yml に「Allow public invoke」ステップ(gcloud run services add-iam-policy-binding allUsers→roles/run.invoker を全関数に)を追加して解決。callable は仕組み上 allUsers 公開が必須で認証は関数内 request.auth で担保=本番同等。**この操作は auto-mode で一度ブロック→オーナー承認後に実施**。
  - **次の手動検証待ち**: オーナーが staging にログイン(オーナーの Google アカウント＋コンソール設定パスワード)→保存/QR/自動割振などを実機確認。
- **main統合前のクリーンアップ TODO**(忘れない): ①deploy-staging.yml の push トリガ(branch=feat/staging-environment-setup)を外し workflow_dispatch のみに戻す ②staging-bootstrap.yml の push トリガも整理 ③Phase1ブランチ(feat/ops-phase1-agents-issues)と Phase2 を統合する際 CHANGELOG/CLAUDE.md の衝突解決(両側の追記を両立)。
- **マージ方針(オーナー決定 2026-06-29)**: Phase 1・Phase 2 とも main 未マージで温存。**staging クラウド設定が完了してから Phase 1+2 をまとめて main に出す**(勝手に先行マージしない)。両ブランチは CHANGELOG の `## 未リリース` 同一箇所を編集しており、まとめる際は CHANGELOG/CLAUDE.md の衝突解決が要る(両側の追記を両立)。
- **Phase 1 実装済み**(branch `feat/ops-phase1-agents-issues`・コミット 3bc65e3・origin push 済み・**main未マージ**)。
  - エージェント3体 `.claude/agents/`(triage/dev-fix/regression-reviewer)、スキル3本 `.claude/skills/`(regression-guard/bug-triage/staging-environment)。
  - Issueテンプレ `.github/ISSUE_TEMPLATE/`(bug_report/feature_request/config)、ラベル15個は gh で**作成済み**(type/severity/area/status)。
  - テストゲート `.github/workflows/ci-tests.yml`: **push/PR の必須ゲートは unit(lint非ブロッキング+vitest402+build, ~40秒で緑)**。Playwright e2e(local/emulator)は CI で17.8分・18件不安定(環境差)のため **workflow_dispatch 手動のみ**に分離(if 条件)。emulator は Java21 必須。CI 実証済み(run 28338626004 緑)。
  - **e2e 安定化は Issue #35** で追跡(18件・schedule-board.spec.ts のポップアップ/休日/振替系)。安定化後に push ゲートへ昇格。
  - GitHub Issue ラベル15個は稼働確認済み(#35 起票で実証)。
  - CLAUDE.md に「保守運営の体制」節を追加。
  - 注意: Phase 1 と Phase 2 は別ブランチ。両方 CLAUDE.md/CHANGELOG を編集するがアンカーを分けて衝突回避済み。
- **Phase 3 完了(v1.5.345・2026-06-29)**: ロールバック手順書 docs/runbooks/rollback.md(症状別 A=Hosting/B=Functions/C=データ復元・クロス汚染注意)、リリースチェックリストを .github/PULL_REQUEST_TEMPLATE.md に組込み運用開始。
- **Phase 4 完了(v1.5.345)**: 外形監視 tools/uptime-check.mjs + .github/workflows/uptime-check.yml(15分cron+手動)。本番の index/version.json/QR API を確認し異常で incident:uptime Issue 自動起票(復旧で自動クローズ)+ワークフロー赤通知。手動実行で healthy/green を実証済み。手順 docs/runbooks/monitoring.md(GitHubスケジュールの限界→UptimeRobot/Cloud Monitoring併用推奨)。リポジトリは PUBLIC。
- **要対処(未)**: functions/scripts/staging-bootstrap.config.json に実メール(オーナーの Google アカウント)/UID が public リポジトリに露出。低リスクだがスパム源。例示プレースホルダ化を提案済み。
- 全フェーズ完了。
- **lint 負債解消済み(v1.5.346・2026-06-29・挙動中立)**: 96→0 errors。eslint.config.js で react-refresh/only-export-components=warn・no-unused-vars に `^_` 無視。scheduleHtml.ts は no-useless-escape をファイル disable(埋め込み escape は変更厳禁)、drafts.ts は no-control-regex 意図的 disable、App/BasicData の react-hooks/refs は「最新値ref同期」イディオムで個別 disable、ScheduleBoardScreen prefer-const×2、functions 未使用型4削除(出力不変)、テスト未使用は `_`化/any→unknown。**CI(ci-tests.yml)の lint をブロッキング化済**(errors=0維持・warning許容)。staging検証→本番。
- **UptimeRobot 手順追記済み(v1.5.347)**: docs/runbooks/monitoring.md にオーナー作業の5分間隔外部監視セットアップ手順(GitHub外形監視15分との二段構え)。実セットアップはオーナー作業。
- **e2e #35 調査済み(未修正・別タスク)**: CI run で判明 — emulator e2e は成功(Java21化で解消)、失敗は local e2e のみ。根因2系統: (1)削除済み機能を検証する **stale テスト**(例 schedule-board.spec.ts:1589 「休み欄」は v1.5.334 で削除済み・他に 1698/2113/2139/2310/2611/2710)、(2)basic-data-management.spec.ts(23/95/110)の **headless クリーン状態の前提崩れ**(localStorage 残留前提)。安易に緩めず現行仕様で再定義＋helpers のセットアップ確定化が必要(18分/サイクル＋仕様知識)。詳細は Issue #35 のコメント。
- **最適化の提案(未実施)**: deploy-firebase-hosting.yml は main への全 push で発火するため、docs/.claude/md のみの変更でも本番再デプロイ＋version bump が走る。paths-ignore(**.md, docs/**, .claude/**, functions/scripts/** 等)で無駄な再デプロイを抑制できる(クリティカルな workflow 変更のため要慎重・オーナー判断)。

- **staging実機検証フローが確立(2026-07-04)**: 「科目分散」ルール検証で初めてstagingにログインしての実機確認を実施、成功。
  - **ログイン方法**: staging はメール/パスワード認証。ローカル `npm run dev -- --mode staging`(`.claude/launch.json` に `dev-staging`・port5175 追加済み)で staging Firebase に直結できる。接続設定(`.env.staging.local`・gitignore対象)は配信バンドル(`/assets/config-*.js`)から `AIza...`/senderId/appId 等の**公開値**を抽出して作成(秘匿情報ではない)。
  - **ログインアカウントは無い前提で都度作る**: `gcloud auth print-access-token` と Identity Toolkit REST(`accounts` create、`x-goog-user-project: komahyouapp-staging` ヘッダ必須=ADCのquota project未設定403対策)でテストユーザーを作成→Firestore `workspaces/main/members/{uid}` に `role:manager, assignedClassroomId:staging_test_classroom` を書き込み→ログイン可能に。**検証後はaccounts:delete+membersドキュメント削除で必ず後片付け**(オーファンアカウント防止)。
  - **functions デプロイが2回連続赤だった実例**: (1) ソース側で削除した関数(例 `downloadLatestClassroomRollback`)が実行環境に残っていると non-interactive で確認できずabort→`gcloud functions delete --gen2` で個別削除が要る。(2) Artifact Registry クリーンアップポリシー未設定も同様にabort。**恒久対策**: `deploy-staging.yml` の functions deploy に `--force` を追加(staging限定でこの2つを自動承認・91e9ded)。今後同種の赤が出たら先にこの2点を疑う。
  - **同一時限に同じ生徒を2机へ手動追加すると、リロード時に client 側の整合性チェックで自動的に両方消える**(findDuplicateStudentInCellByKey相当のセル内重複排除)。バグではなく想定動作。検証時に「保存したのに消えた」と焦らないための記録。
  - **確認できたこと**: ルール画面に「科目分散」グループ表示・対象設定モーダル・区分トグル(優先⇄制約)・盤面の赤字警告(`制約違反\n制約事項: 科目分散`)・保存→Firestore反映(gzip-base64の`compressedData`をpython decodeして読み取り確認)まで一通り実機で動作確認済み(v1.5.389)。

- **staging↔本番の版一致ルール(オーナー指示 2026-07-10)**: オーナーはどちらの環境でも動作確認する。本番は push 毎に
  自動 bump するが staging は bump しない構造のため放置すると必ずずれる。→ **常時 CI 自動追従はしない。staging で新機能の
  実装・検証を始めるとき(=staging を使うタイミング)に、その直前に最新 main を「Deploy to Staging」で反映し、両
  `version.json`(prod/staging)を揃えてから検証する**。古い staging で「本番と挙動が違う」と誤判定しないため。
  CLAUDE.md「重要な実装メモ」staging 項＋ staging-environment スキル「使い始める前に本番と版を合わせる」＋ safe-release
  手順3/チェックリストに組込み済み。(検討時、本番 workflow から staging を自動起動する全自動案も提示したが、オーナーは
  「新機能で staging を使うときだけ都度反映」を選択。)

関連: [[komahyou-classroom-restore-cross-contamination]] [[komahyou-no-regression-rule]] [[komahyou-functions-deploy-409-false-status]] [[komahyou-autonomous-commit-merge]] [[komahyou-auto-assign-rules-architecture]] [[komahyou-clarify-before-proceeding]] [[komahyou-ops-model-assignment]]
