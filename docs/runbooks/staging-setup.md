# Runbook: 専用 staging 環境のセットアップ（オーナー作業）

本番（`komahyouapp-prod`）と**完全分離**した検証用 Firebase プロジェクトを新設する手順。
これが完了すると、Claude（私）は本番に一切触れずに staging で実機検証できるようになり、
「本番そっくりの環境で確認してから本番にマージする」安全なリリースフロー（[safe-release スキル](../../.claude/skills/safe-release/SKILL.md)）が回せる。

> **なぜ必要か**: 現在は本番プロジェクト内の開発用教室1つ（`v8OZ7zH8vONNHjjYVcR1`）で代用しており、
> 教室取り違えで他教室データを汚染する事故が実際に起きた（CLAUDE.md「事故の記録 2026-06-06」）。
> staging を別プロジェクトに分けることで、この事故クラスを**構造的に**なくす。

---

## 0. 前提と分担

- **クラウド側（プロジェクト作成・課金・権限・Secrets 登録）= オーナーが実施**。Claude には Firebase 認証が無く実行不可。
- **リポジトリ側（`.firebaserc`・CI ワークフロー・スキル）= Claude が用意済み**。
- 想定 staging プロジェクト ID: **`komahyouapp-staging`**（このIDで作る前提で `.firebaserc` と CI を組んである。別IDにしたい場合は Claude に伝えれば差し替える）。

---

## 1. Firebase プロジェクトを新規作成

1. [Firebase コンソール](https://console.firebase.google.com/) → 「プロジェクトを追加」。
2. プロジェクト名 / ID を **`komahyouapp-staging`** にする。
3. Google アナリティクスは不要（オフでよい）。

## 2. 課金（Blaze）を有効化 ← Cloud Functions に必須

Cloud Functions（gen2）は Blaze プランでないとデプロイできない。
- プロジェクト設定 → 使用量と請求 → プランを **Blaze** にアップグレード。
- staging は実トラフィックがほぼ無いので、無料枠内で費用はほぼ発生しない。
- 暴走防止に **予算アラート**（例: 月 ¥1,000 で通知）を設定しておくと安心。

## 3. 利用プロダクトを有効化（本番と同構成）

本番と同じ構成にする。Firebase コンソールで以下を作成：
- **Firestore Database**（本番と同じロケーション推奨。例: `asia-northeast1`）。モードは本番ルールをデプロイするので空でよい。
- **Authentication** → 本番で使っているサインイン方法を同じく有効化（メール/パスワード等）。
- **Storage** → バケットを作成。**バケット名を控える**（例: `komahyouapp-staging.firebasestorage.app`）。手順6で使う。
- **Hosting** → 開始しておく（`komahyouapp-staging.web.app` が払い出される）。

## 4. Web アプリ登録 → フロント接続設定を取得

1. プロジェクトの概要 → アプリを追加 → **Web**。
2. 表示される `firebaseConfig`（apiKey, authDomain, projectId, appId など）を控える。
3. これを `.env.local` と同じ形式のテキストにまとめる（手順7で GitHub Secret に登録）：

   ```dotenv
   VITE_EXTERNAL_BACKEND_MODE=firebase
   VITE_FIREBASE_API_KEY=＜staging の apiKey＞
   VITE_FIREBASE_AUTH_DOMAIN=komahyouapp-staging.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=komahyouapp-staging
   VITE_FIREBASE_STORAGE_BUCKET=komahyouapp-staging.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=＜staging の senderId＞
   VITE_FIREBASE_APP_ID=＜staging の appId＞
   VITE_FIREBASE_WORKSPACE_KEY=main
   ```

   > `VITE_EXTERNAL_BACKEND_MODE=local` だと Firebase に繋がらない。必ず `firebase` にする（CI 側でも検証している）。

## 5. デプロイ用サービスアカウント（SA）を発行

1. [GCP コンソール](https://console.cloud.google.com/) でプロジェクト `komahyouapp-staging` を選択。
2. IAM と管理 → サービス アカウント → 新規作成（例: `ci-deployer`）。
3. 以下のロールを付与（本番 SA と同等。CLAUDE.md「一度きりの前提セットアップ」参照）：
   - **オーナー**（`Owner`）を付与するのが確実（staging は捨てて良いサンドボックスなので可）。
     - 理由: gen2 Functions の初回デプロイで firebase が**プロジェクトの IAM ポリシーを書き換える**
       （pubsub/compute サービスエージェントへロール付与）。これには「編集者」では不足で、
       `Owner` か `プロジェクト IAM 管理者`（`roles/resourcemanager.projectIamAdmin`）が要る。
       2026-06-29 の初回構築で「編集者」だけだと "We failed to modify the IAM policy" で失敗した。
   - Owner を避けたい場合の最小構成: **編集者** + **Firebase Admin** + **サービス アカウント ユーザー**
     + **プロジェクト IAM 管理者**（IAM 書き換えに必須）。
   - ⚠️ IAM 付与は**反映に数分かかる**。付与直後にデプロイすると伝播前で失敗することがある（数分待つ）。
4. **Cloud Billing API**（`cloudbilling.googleapis.com`）を有効化。
5. この SA の **JSON 鍵**を発行してダウンロード（全文を手順7で登録）。

## 6. functions の Storage バケットを staging に向ける ← クロス汚染の最重要対策

`functions/src/index.ts` は `STORAGE_BUCKET` 環境変数が未設定だと
**本番バケット `komahyouapp-prod.firebasestorage.app` をデフォルトで参照する**。
このまま staging に functions をデプロイすると、**staging の関数が本番 Storage を読み書きしてしまう**。

→ staging functions には必ず `STORAGE_BUCKET=komahyouapp-staging.firebasestorage.app` を設定する。
CI ワークフロー（`deploy-staging.yml`）はこの env を関数に渡すよう組んであるので、
**手順7で GitHub Secret `STAGING_STORAGE_BUCKET` を登録すれば自動で適用**される。手作業は不要。

## 7. GitHub Secrets を登録

リポジトリ → Settings → Secrets and variables → Actions → New repository secret で以下を追加：

| Secret 名 | 中身 |
|---|---|
| `STAGING_FIREBASE_WEB_ENV` | 手順4で作った `.env.local` 形式のテキスト全文 |
| `STAGING_FIREBASE_SERVICE_ACCOUNT` | 手順5の SA JSON 鍵 **全文** |
| `STAGING_STORAGE_BUCKET` | `komahyouapp-staging.firebasestorage.app` |

> 本番用の `RE_FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_WEB_ENV` とは**別物**。混同しないこと。

## 8. 初回デプロイ（CI 経由）

1. リポジトリ → Actions → **「Deploy to Staging」** → Run workflow（ブランチ = 任意。通常は作業ブランチか main）。
2. 緑になれば `https://komahyouapp-staging.web.app` で staging アプリが開く。
3. ログインし、教室を1つ作って動作確認（このデータは捨ててよい検証用）。

## 9. 検証用の初期データ（任意）

本番そっくりの確認をしたい場合、本番の構造に近いダミー教室を staging に作る。
- 本番データの**コピーは行わない**（個人情報・他教室データの持ち込み防止）。
- 手で教室・生徒・コマを数件入れた「検証用教室」を作るだけで、回帰確認の大半はできる。

---

## 完了チェックリスト

- [ ] `komahyouapp-staging` プロジェクト作成・Blaze 有効化
- [ ] Firestore / Auth / Storage / Hosting 有効化、Storage バケット名を控えた
- [ ] Web アプリ登録、`STAGING_FIREBASE_WEB_ENV` 用テキスト作成
- [ ] SA 発行＋必要ロール付与、JSON 鍵取得
- [ ] GitHub Secrets 3件登録（`STAGING_FIREBASE_WEB_ENV` / `STAGING_FIREBASE_SERVICE_ACCOUNT` / `STAGING_STORAGE_BUCKET`）
- [ ] 「Deploy to Staging」ワークフローが緑、`komahyouapp-staging.web.app` が開く

完了したら Claude に「staging できた」と伝える。以降は safe-release フローで staging 検証→本番リリースを回す。
