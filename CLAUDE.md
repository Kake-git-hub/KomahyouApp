# コマ表アプリ — Claude へのルール

## ⚠️ 作業前に必ず参照するスキル（厳守）

このリポジトリでコードを**編集・追加・修正・リファクタリング**する前に、スキル
`.claude/skills/solo-git-workflow/SKILL.md`（一人開発向け Git 運用＋回帰防止）の手順に従うこと。
**本番へマージ／デプロイする前**は `.claude/skills/safe-release/SKILL.md`（staging 実機検証→本番→
ライブ検証→ロールバック、リリース前チェックリスト）にも従うこと。
ユーザーが明示的に Git や回帰に触れていなくても、編集を始める前にこのスキルの判断フロー
（壊れたら困る変更はブランチを切る／変更前にベースラインを取る／変更後に既存機能の回帰を確認／
コミット前に `git diff`）を踏むこと。下記の回帰防止ルール・本番データ保護ルールと併せて守る。

このスキルには次の2点が**必須手順**として含まれる（厳守）:
- **編集着手前にデプロイ済み最新と同期確認**: `git fetch` でローカル main が origin/main に追いついているか、
  `package.json` の version と ライブ `https://komahyouapp-prod.web.app/version.json` が一致しているかを確認する。
  ライブの方が新しいまま編集を始めない（CI が毎 push で自動 bump するためローカルは遅れがち）。
- **編集ごとに更新リスト `CHANGELOG.md` へ1行追記**: 何を・なぜ変えたかを記録する。
  バージョンは CI が自動で上げるので **`package.json` は手動で書き換えない**。
- **コミット〜main マージは Claude の判断で自動実行(常時許可・オーナー指示 2026-06-27)**:
  毎回の明示指示なしに、回帰確認(build/テスト/`git diff`)を通したうえでコミット →
  `CHANGELOG.md` の `## 未リリース` を次の版でラベル付け → main へマージ(= CI 自動デプロイ)まで進める。
  ただし**本番データへの書き込み・履歴の破壊的操作・大きな変更の main 直接着手**は対象外(従来どおり慎重に)。

## ⚠️ 回帰防止ルール（過去の修正を必ず踏襲する・厳守）

このアプリは**過去の修正を踏まえて次の修正を積み上げる**前提で開発されている。
過去に直したバグを後の変更（特にマージ/リベース/リファクタ）で**巻き戻してはいけない**。

- **既存ロジックを書き換える前に、その箇所が過去に何を直したかを確認する。**
  - `git log -L <開始>,<終了>:<ファイル>` や `git log -S "<該当コード片>"`、`git blame` で変遷を追う。
  - 関数の近くにある「回帰防止」「fix」「過去コミットID」コメントは**意図的なガード**。消さない・薄めない。
- **コードを「単純化」する誘惑に注意。** `{ ...a, ...b }` のような spread は、過去に明示していた
  フィールド補完（例: `managedStudentId: b.x ?? a.x`）を消すと回帰する。短く見えても挙動が変わる。
- **マージ衝突の解決時は、両側の修正を必ず両立させる。** 一方の修正を捨てて他方で上書きしない。
- **バグを直したら必ず回帰防止テストを追加する**（修正なしで落ち・修正ありで通ることを確認）。
  ゴールデンスナップショットだけに頼らない（リライトで保護が消える）。
- 実際に起きた回帰：`mergeManagedDeskLesson` の生徒同一性補完（commit `6793374`）が
  後のマージ（commit `2dce7b4`）で `{ ...managedStudent, ...student }` に巻き戻り、
  生徒日程表で通常授業がカウントされない不具合が再発（2026-06-10 に再修正＋テスト追加）。

## ⚠️ 本番データ保護ルール（最優先・厳守）

このアプリは **稼働中の本番サービス** です。複数の学習塾教室の実際のデータが Firebase (プロジェクト: `komahyouapp-prod`) に保存されています。

### Claudeが絶対に行ってはいけないこと

- **開発用教室(`v8OZ7zH8vONNHjjYVcR1`)以外のFirestoreドキュメントへの書き込み・更新・削除**
- **本番教室の復元・コピー・上書きに相当するCloud Functions呼び出し**（`saveClassroomSnapshotViaFunction`, `restoreClassroomFromServerAutoBackup`, `restoreLatestClassroomRollback`, `copyClassroomDataToDevelopmentClassroom`等）
- **管理者UID以外のmembersドキュメントへの書き込み**

### デバッグ・チェック時の読み取り専用ルール

- Firestoreデータの**確認・照合は読み取り（GET）のみ**。REST APIで `getDoc` / `getDocs` に相当する照合は可。
- gcloud / firebase CLI でのデータ参照は読み取り専用コマンドに限定する。
- **書き込みが必要な確認作業は、必ず開発用教室 `v8OZ7zH8vONNHjjYVcR1` を対象にする**。

### 教室一覧と担当者（参照用）

| 教室名 | classroomId | 用途 |
|--------|-------------|------|
| スクールIE 日大前校 | `5w5OMueETerSKrSf14HC` | 本番（読み取り専用） |
| スクールIE 緑が丘校 | `KzFnOQoTFLsCxwUp1tvh` | 本番（読み取り専用） |
| スクールIE 薬円台校 | `6xnnbSTbwgGrBLy0EJKb` | 本番（読み取り専用） |
| 開発用教室           | `v8OZ7zH8vONNHjjYVcR1` | **書き込み可能な唯一の教室** |
| テスト教室           | `test_classroom_20260507_dai` | 開発用に準じて扱う |

### 事故の記録（2026-06-06 再発防止）

Claudeの自動チェックセッションが `actingClassroomId` を適切に制御しない状態で復元/コピー操作を実行し、**日大前校のスナップショット文書が緑が丘校のデータで上書きされた**。
汚染前バックアップ（2026-06-06 T10毎時）から手動復元で対応。

再発防止：Claude はアプリのチェック・デバッグ・動作確認においても、**Firestoreへの書き込みを伴う操作は開発用教室のみ** に限定する。

---

## 保守運営の体制（エージェントとスキル）

複数ユーザー導入に向けた保守運営の役割分担。詳細は memory `komahyou-staging-and-ops` 参照。

### 役割エージェント（`.claude/agents/`）
- **triage**（Sonnet）… 曖昧な報告（口頭/LINE/スクショ）を再現手順・影響範囲・優先度に整理し GitHub Issue 化（読み取り＋起票）。
- **spec-curator**（Opus）… 思いつき要望を「あるべき姿」に照らして要求仕様へ補完・確定。`docs/spec-*.md`（正本）の維持管理者。コードは触らない。
- **dev-fix**（Opus）… 原因特定とコード修正の主力。solo-git-workflow / regression-guard / safe-release を厳守。
- **regression-reviewer**（Opus）… 変更が過去修正を巻き戻していないか検査する読み取り専用レビュー役。

### モデル割当方針（コスト最適化・オーナー指示 2026-07-04）
- **特定モデルIDに固定しない。** エージェントの frontmatter は `model: sonnet` / `model: opus` の
  エイリアスで書き、常に各系列の最新版へ自動追従させる。
- **判断・仕組みづくり・原因特定・仕様策定・レビュー → Opus 最新**（dev-fix / spec-curator / regression-reviewer）。
- **手順が確立した単純作業 → Sonnet 最新**（triage、ログ収集、一括置換、定型ドキュメント更新など）。
  dev-fix でも**機械的な小修正**（文言・ラベル・スタイル・定数変更）は Agent 起動時に
  `model: sonnet` を指定してコストを抑えてよい（判断は起動側が済ませてから渡す）。
- オーケストレーション（主セッション）は利用可能な上位モデルで行うが、**特定モデルの存在を前提に
  しない**。この CLAUDE.md・スキル・エージェント定義だけで、どのモデルでも同じ運用が再現できる
  状態を保つ（属人化ならぬ「属モデル化」を避ける）。

### 標準フロー（バグ・要望共通）
1. 報告/要望 → **triage** で整理・Issue 化（曖昧点は質問で返す）。
2. 新機能・挙動変更・仕様が曖昧なバグは → **spec-curator** で未定義を補完し正本を更新、
   受け入れ条件つきで実装タスク化（単純な明白バグはスキップ可）。
3. → **dev-fix** で実装＋回帰防止テスト（同コミット必須）。
4. → **regression-reviewer** で巻き戻し検査（リファクタ・マージ衝突解決後は必須）。
5. → **safe-release** で staging 実機確認 → 本番マージ → ライブ検証。

### スキル（`.claude/skills/`）
- `solo-git-workflow`（Git運用）/ `regression-guard`（回帰防止の実務）/ `safe-release`（安全リリース）/
  `staging-environment`（検証環境）/ `bug-triage`（報告→Issue 一本化）。

### 課題管理
- バグ・要望は **GitHub Issues に一本化**（`Kake-git-hub/KomahyouApp`）。テンプレ `.github/ISSUE_TEMPLATE/`、
  ラベル `type:* / severity:s1〜s3 / area:* / status:*`。フローは `bug-triage` スキル参照。

### テストゲート
- **⚠️ 変更には必ずテストを添える（厳守・オーナー指示 2026-06-29）**：バグ修正だけでなく**新機能・新挙動の追加・既存挙動の変更も、その挙動を守るユニットテストを必ず同じコミットで追加する**。
  E2E を廃止した今、UI操作・盤面ロジック・警告・保存/権限などの回帰防止はユニットが唯一の自動ゲート。テスト無しでマージしない。
  - 純粋関数として書けるよう設計する（巨大コンポーネント内のロジックは `computeStudentMove` / `resolveLessonPatternWarnings` のように切り出してから検証する）。
  - 「修正なしで落ち・修正ありで通る」を確認（回帰防止）。`docs/test-strategy.md` の方針に従う。
  - 保存/権限/教室分離を触ったら `npm run test:rules` も回す。本番critical（実Firebase往復・画面表示）は staging 実機確認で補完。
- `.github/workflows/ci-tests.yml` がブランチ push ごとに **lint / unit / build** を実行（毎push・約1分・決定的）。
  main マージ前に緑を確認する。マージ前チェックは `.github/PULL_REQUEST_TEMPLATE.md` ＝ `docs/runbooks/release-checklist.md`。
- **Playwright E2E は廃止（2026-06-29）**。全シナリオをユニット（純粋関数）へ移植済み。方針と移植マップは `docs/test-strategy.md`。
  UI操作の回帰はユニットが、実環境の通し動作は staging 実機確認が担保。Firestore ルールの教室分離は `npm run test:rules`（手動・要 Java + エミュレータ）。

### 監視・障害検知 / ロールバック
- **外形監視**: `.github/workflows/uptime-check.yml`（15分ごと＋手動）が本番の index/version.json/QR API を確認。
  異常時は `incident:uptime` ラベルの Issue を自動起票＋ワークフロー赤（メール通知）、復旧で自動クローズ。詳細 `docs/runbooks/monitoring.md`。
- **ロールバック**: 症状別の戻し手順は `docs/runbooks/rollback.md`（A=Hosting / B=Functions / C=データ復元）。
  データ復元は「開いている教室」に書き込むため最重要の慎重操作（本番データ保護ルール）。

---

## プロジェクト概要

- **技術スタック**: React + TypeScript + Firebase (Firestore / Cloud Functions / Hosting / Storage)
- **状態管理**: useState / useRef / useCallback 中心（外部状態ライブラリなし）
- **保存アーキテクチャ**: 手動保存ボタン → Cloud Function `saveClassroomSnapshot` に一本化。Firestore 直書き経路は廃止済み。
- **ビルド**: `npm run build` / 開発: `npm run dev`（ポート5173）
- **デプロイ**: `npm run deploy` → Firebase Hosting

## スマホからのデプロイ手順（PC不要・GitHub経由）

PC が無くても、GitHub（モバイルアプリ/ブラウザ）だけで本番（`komahyouapp-prod`）へデプロイできる。
GitHub Actions がリポジトリのシークレット（`RE_FIREBASE_SERVICE_ACCOUNT` ほか）でデプロイを実行する。

### フロント（ホスティング）
- 作業ブランチを **`main` にマージ** すると、`.github/workflows/deploy-firebase-hosting.yml` が自動実行され、
  ビルド→本番ホスティングへデプロイ→ライブ検証まで行う（毎回 patch バージョンを自動 bump）。

### Cloud Functions（`lectureSubmissionApi` ほか）
- ホスティングCIは **functions を出さない**。functions は専用ワークフロー `.github/workflows/deploy-functions.yml` を使う。
  - **手動**: GitHub アプリ → 対象リポジトリ → **Actions → 「Deploy Cloud Functions」→ Run workflow**（ブランチ=main）。
  - **自動**: `functions/**` を変更して `main` にマージすると発火。
- 成否は Actions の **緑/赤** で判断できる（`set -o pipefail` で firebase の失敗を正しく検知する。緑=本当に成功）。
  - 補足: 大量の gen2 関数を同時更新すると一部が 409「unable to queue」警告を出すことがあるが、firebase が
    最終的に成功(exit 0)していれば自動リトライで解消済み。緑なら問題なし。

### 一度きりの前提セットアップ（2026-06-26 実施済み・記録）
CIのサービスアカウント `firebase-adminsdk-fbsvc@komahyouapp-prod.iam.gserviceaccount.com` に、
GCP コンソール（プロジェクト `komahyouapp-prod`）で以下を付与済み。functions デプロイにはこれらが必須：
- ロール **サービス アカウント ユーザー**（`roles/iam.serviceAccountUser`）… 実行SA(`...@appspot`)を ActAs するため
- ロール **Cloud Functions 管理者**（`roles/cloudfunctions.admin`）
- API **Cloud Billing API**（`cloudbilling.googleapis.com`）を有効化
- ロール **Cloud Scheduler 管理者**（`roles/cloudscheduler.admin`）… スケジュール関数（毎時/日次バックアップ・
  saveAttempts掃除）のジョブ更新に必要。2026-07-04 のデプロイで `cloudscheduler.jobs.update` の 403 が初出。
  **オーナーが付与するまで functions デプロイは赤になる**（付与後に Actions → Deploy Cloud Functions を再実行）。

### 注意
- デプロイ後は各端末で **ハードリロード（Ctrl+Shift+R）** を徹底（旧バンドルのキャッシュ事故防止）。
- Claude(私)の実行サンドボックスには Firebase 認証情報が無いため、`firebase deploy` を直接は実行できない。
  デプロイは上記 GitHub Actions（＝GitHubのサーバー上）経由か、認証済みPCで行う。

## 重要な実装メモ

- `workspaceKey` = `main`（本番）/ `.env.local` の `VITE_FIREBASE_WORKSPACE_KEY` で設定
- 復元・コピーは `actingClassroomId`（現在開いている教室）に書き込む。**開いている教室の確認なしに復元操作をしてはいけない**。
- バックアップ: 毎時（直近3日）・日次（14日）。Storage パス `workspace-auto-backups/main/hourly/{key}.json`
- **staging 環境**: 本番と分離した検証用プロジェクト `komahyouapp-staging`（`komahyouapp-staging.web.app`）。
  **書き込み自由**で実機検証に使う。CI は `.github/workflows/deploy-staging.yml`（手動実行）。
  未整備なら `docs/runbooks/staging-setup.md`（オーナーがクラウド側を設定）。functions は
  `STORAGE_BUCKET` を staging に向けないと本番バケットを触る点に注意（runbook 手順6）。
- 詳細: `memory/komahyou-save-architecture.md` および `memory/komahyou-classroom-restore-cross-contamination.md` 参照
