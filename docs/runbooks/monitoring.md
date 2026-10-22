# Runbook: 監視・障害検知

本番（`komahyouapp-prod`）の異常を**ユーザー報告より先に**気づくための仕組みと対応手順。

## 何で監視しているか

### 1. 外形監視（自動・実装済み）
- ワークフロー: `.github/workflows/uptime-check.yml`（スクリプト `tools/uptime-check.mjs`）。
- 頻度: **15分ごと**（GitHub スケジュール）＋手動実行可。
- チェック項目（本番）:
  - hosting `/` が 200
  - `/version.json` が取得でき version を持つ
  - QR提出 API `/api/submission/` が到達可能（403/5xx/接続不可は異常）
- **異常時の挙動**:
  - GitHub Issue を自動起票（ラベル `incident:uptime` / `severity:s1`）。既存があれば追記。
  - ワークフローが**赤**になる → GitHub の通知設定で**オーナーにメール**が届く。
  - **復旧すると** その incident Issue に「復旧」コメント＋**自動クローズ**。
- 手動実行: Actions →「Uptime Check」→ Run workflow（`monitor_staging` を入れると staging も確認）。
- 監視対象の URL は `tools/company-sites.json`（会社ごとの Hosting サイト一覧・`monitor: true` の会社の本番サイト全部）。会社を足すと自動的に監視対象に増える（2026-10-10・P-3）。

### 2. リリース時のライブ検証（自動・既存）
- `Deploy to Firebase Hosting` が毎デプロイ後に `tools/verify-firebase-hosting.mjs` で配信実体を検証。

### 3. 保存失敗の記録と監視メール（記録＝既存／メール＝2026-10-22 オーナー採用「即時対応のための案 6」）
- 保存の各試行は `classroomSnapshots/{id}/saveAttempts/{saveId}` に status（started/verified/verification-failed）が残る。
- 保存不具合の調査時はここを**読み取り**で確認する（書き込み調査は staging で）。
- **即時メール**: Cloud Function `saveClassroomSnapshot` が次の 3 つの失敗で開発者へメールを送る（利用者報告と同じ `REPORT_MAIL_*` 設定・追加設定なし）。
  件名 `【保存失敗】[コマ表アプリ 監視] <会社> / <教室> / <種類>`。本文に保存 ID・版数・端末情報・確かめること・置き場所（saveAttempts／operationTraces／版履歴）。
  - `stale-version` … 楽観ロックの版数衝突（別の端末が先に保存＝多端末同時編集の疑い）
  - `readback-failed` … 保存後の読み戻し検証に失敗
  - `data-loss-guard` … 空の管理データでの上書きを破壊防止ガードが止めた
- **教室ごとに 1 時間に 1 通**（`workspaces/{ws}/saveFailureAlerts/{classroomId}.lastSentAt`）。送らなかった分も `occurrenceCount`／`lastOccurredAt` に数える。
  メールの失敗は保存の応答に影響しない（関数ログ `[SaveFailureAlert]`）。純粋ロジックは `functions/src/saveFailureAlert.ts`。

### 4. 利用者からの「要望・報告」（自動・実装済み 2026-09-04）

- 画面の「要望・報告」ボタン（盤面ツールバー／日程表タブ）から送られた内容は Firestore
  `workspaces/main/developerReports` に溜まる。**即時にメール**（Cloud Function `notifyDeveloperReportByMail`・下記設定）が届き、
  `.github/workflows/developer-reports.yml`（15分ごと）が課題管理用に GitHub Issue を起票する（ラベル `source:user-report`）。
  内容に `#テスト` を含む報告は Issue を作らない（メールは【テスト】付きで届く）。
- Issue 本文はメタ情報と置き場所だけ（公開リポジトリのため）。操作痕跡は Firestore 文書の `recentOperations`、
  報告時点の教室データは Storage `developer-reports/...json.gz`（Issue 内の `gsutil` コマンドで取得）。
- 仕様: `docs/spec-developer-report.md`。ワークフローが赤なら Firestore 権限（サービスアカウント）か
  GitHub API の失敗。手動再実行は Actions → 「Notify developer reports」。
- **受け取った後は勝手に修正を始めない**（オーナー指示 2026-09-04）。切り分け・整理まで進め、修正はオーナーの許可後。

#### メール即時通知の設定（オーナー作業 ~10分・推奨）

Cloud Function が SMTP で直接送る。Gmail の場合は **アプリパスワード**（Google アカウント → セキュリティ → 2段階認証 →
アプリパスワード）を使う。通常のログインパスワードは使えない。

1. 送信用の Gmail でアプリパスワードを発行する（16桁）。
2. functions の runtime env に次を足す（値は例。`@` は `%40` にする）。
   - `REPORT_MAIL_SMTP_URL=smtps://you%40gmail.com:xxxxxxxxxxxxxxxx@smtp.gmail.com:465`
   - `REPORT_MAIL_TO=通知を受け取るメールアドレス`（複数はカンマ区切り）
   - 任意 `REPORT_MAIL_FROM=送信元として表示するアドレス`（省略時は SMTP のユーザー）
   - 置き場所は2か所: ローカル `functions/.env`（手元デプロイ用）と、GitHub → Settings → Secrets and variables →
     Actions → **`PROD_FUNCTIONS_ENV`**（CI デプロイ用。既存の `GOOGLE_DRIVE_*` 行はそのまま残し、上の行を追記して保存）。
3. Actions → 「Deploy Cloud Functions」→ Run workflow で再デプロイする（env はデプロイ時に焼き込まれる）。
4. 画面の「要望・報告」から内容に `#テスト` を含めて送る → 【テスト】付きのメールが届けば完了（Issue は作られない）。
   届かないときは Firestore の該当文書の `mailError` / `mailSkipped` と関数ログ `[DeveloperReportMail]` を見る。

GitHub 側の通知設定は不要（Issue はあくまで課題管理の記録。Issue のメール通知も欲しければリポジトリを Watch する）。

### 5. 画面エラーの自動報告（2026-10-22 オーナー採用「即時対応のための案 3」）
- 室長の画面で未捕捉の例外・未処理の Promise 拒否・React の描画例外が起きると、アプリが操作痕跡（kind `error`）に残し、教室を開いていれば
  「質問・要望」と同じ経路で **自動報告**（本文先頭 `[自動エラー報告]`・種類 bug）を送る。**メールは届く（件名【自動エラー報告】）が Issue は作らない**
  （`notifySkipped: 'auto-error'`）。開発ダッシュボードの「通知済みだが Issue なし」で拾う。同じエラーは 1 タブ 1 回・3 通まで。
- 描画例外のときは室長に「画面の表示で問題が起きました／再読み込み」の案内が出る（`AppErrorBoundary`）。仕様 `docs/spec-developer-report.md` §D-2。

### 6. 保存ごとの版履歴・保存同梱の操作痕跡・差分ツール（2026-10-22 案 1・2・5）
- 保存のたびに Storage `classroom-save-history/{ws}/{classroomId}/v{版数 8 桁}-{保存時刻}.json.gz`（90 日・名前順＝保存順）と Firestore
  `classroomSnapshots/{id}/operationTraces/{saveId}`（前回保存以降の操作の要約・90 日）が残る。15 分バックアップでは拾えない「保存と保存の間」を辿れる。
- 調査の手順（読み取り専用）:
  ```bash
  export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)
  gsutil ls gs://komahyouapp-prod.firebasestorage.app/classroom-save-history/<ws>/<classroomId>/      # 版の一覧(名前順=保存順)
  gsutil cp gs://.../<前>.json.gz gs://.../<後>.json.gz <スクラッチ領域>/                                # 2 本を落とす
  node tools/snapshot-diff.mjs <前>.json.gz <後>.json.gz                                              # 生徒・コマ(机)単位の差分
  ```
  `operationTraces` は Firestore REST の GET で `saveId` を指定して読む。**出力・ファイルは生徒名を含むので、スクラッチ領域に置きリポジトリ・Issue へ貼らない。**
- 自動バックアップ関数は別会社 10 教室の追加に備えて 540 秒／2GiB へ増強済み（2026-10-22）。恒久対策（会社ごとの分割実行）は進行中テーマ台帳の `backup-per-workspace`。

### 7. Firestore の過去時点読み取り（PITR）を有効にする（オーナー作業 ~5 分・2026-10-22 案 4・任意）
- 有効にすると、Firestore の全文書を**過去 7 日・1 分刻み**の任意時点で読める（コード変更なし）。保存ごとの版履歴（§6）が 90 日ぶん積み上がるまでのつなぎ、
  および版履歴が書けなかったときの保険。
- 手順（オーナーの gcloud・プロジェクト `komahyouapp-prod`）:
  ```bash
  gcloud firestore databases update --database='(default)' --enable-pitr --project=komahyouapp-prod
  gcloud firestore databases describe --database='(default)' --project=komahyouapp-prod   # pointInTimeRecoveryEnablement を確認
  ```
- 費用は PITR 分のデータ容量に対する Firestore のストレージ課金（数百 MB 〜 数 GB の見込み・月 100〜300 円程度）。翌月の請求で実額を確認し、見合わなければ `--no-enable-pitr` で戻す。
- 読み方は Admin SDK／REST の `readTime` 指定（Claude が読み取り専用トークンで行う）。復元に使うときは従来どおり「開いている教室へ読み込み → 保存」の経路だけ（直接書かない）。

## アラートが来たら（対応フロー）
1. 自動起票された `incident:uptime` Issue とワークフローのログ（report）を見る。
2. 実際に `https://komahyouapp-prod.web.app` を開いて症状を確認（誤検知の切り分け）。
3. 本物の障害なら **[rollback.md](./rollback.md)** に従って止血（A/B/C を症状で選択）。
4. 復旧したら外形監視が次回実行で Issue を自動クローズ（手動クローズでも可）。
5. 原因調査 → 恒久対策は通常フロー（staging 検証 → [release-checklist](./release-checklist.md) → main）。

## GitHub スケジュール監視の限界（理解しておく）
- スケジュールは**遅延・スキップ**され得る（数分〜十数分）。秒単位の検知には不向き。
- 60日リポジトリ無活動でスケジュールは自動停止する。
- → **より厳密にしたい場合の推奨（任意）**:
  - **UptimeRobot（無料）** などで `https://komahyouapp-prod.web.app/version.json` を5分間隔監視＋メール/LINE通知。
  - 関数のエラー率は **GCP Cloud Monitoring** のアラート（`cloudfunctions` の error count）で設定可能（コンソール作業）。

## UptimeRobot で5分間隔の外部監視を足す（推奨・オーナー作業 ~10分）

GitHub スケジュールより**速く・確実に**気づけるよう、無料の外部監視を併用する。

1. [uptimerobot.com](https://uptimerobot.com/) で無料アカウント作成（メール登録）。
2. **「+ New monitor」** を作成：
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `KomahyouApp prod`
   - URL: `https://komahyouapp-prod.web.app/version.json`
   - Monitoring interval: **5 minutes**（無料枠）
3. （任意・推奨）**キーワード監視**にするとより確実：
   - Monitor Type: **Keyword** / Keyword: `version` / URL は同上。
   - → ページが 200 でも中身が壊れた（version が無い）場合も検知できる。
4. **アラート連絡先（Alert Contacts）**を設定：
   - メール（既定）。スマホ通知が欲しければ UptimeRobot アプリ、または
   - Webhook で LINE Notify 等に飛ばすことも可能（任意）。
5. 作成後、**わざと検知させるテスト**は不要（本番を止められないため）。代わりに staging URL で1つ作ってテストしてもよい。

> これで「GitHub Actions の外形監視（15分・Issue自動起票）」＋「UptimeRobot（5分・即通知）」の二段構えになる。
> どちらかが落ちても他方が拾う。

## 将来の拡張候補（未実装）
- 保存失敗（saveAttempts の verification-failed 急増）の検知。
- 主要導線の合成シナリオ監視（ログイン→保存）。Firebase Auth が絡むためトークン運用の設計が必要。
- エラーログ集約（Sentry 等）でフロントの実行時例外を収集。
