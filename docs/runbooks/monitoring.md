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

### 2. リリース時のライブ検証（自動・既存）
- `Deploy to Firebase Hosting` が毎デプロイ後に `tools/verify-firebase-hosting.mjs` で配信実体を検証。

### 3. 保存失敗の記録（あり・要確認運用）
- 保存の各試行は `classroomSnapshots/{id}/saveAttempts/{saveId}` に status（started/verified/verification-failed）が残る。
- 保存不具合の調査時はここを**読み取り**で確認する（書き込み調査は staging で）。

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

## 将来の拡張候補（未実装）
- 保存失敗（saveAttempts の verification-failed 急増）の検知。
- 主要導線の合成シナリオ監視（ログイン→保存）。Firebase Auth が絡むためトークン運用の設計が必要。
- エラーログ集約（Sentry 等）でフロントの実行時例外を収集。
