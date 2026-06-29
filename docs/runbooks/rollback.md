# Runbook: ロールバック（本番を前の状態に戻す）

本番（`komahyouapp-prod`）で問題が出たときに**素早く・安全に**戻すための手順。
判断フローの正本は [safe-release スキル](../../.claude/skills/safe-release/SKILL.md)。本書はその実行詳細。

> 大原則: **まず止血（戻す）→ 次に原因調査**。ユーザー影響を最小化することを最優先する。
> データの復元は最もリスクが高い（[クロス汚染の前例](../../CLAUDE.md) 参照）。落ち着いて教室を確認してから行う。

---

## どれを戻すか（症状から判断）

| 症状 | 戻す対象 | 手順 |
|---|---|---|
| 画面が真っ白・表示崩れ・JSエラーで操作不能 | フロント（Hosting） | A |
| QR提出/保存/バックアップなどサーバ処理が失敗 | Cloud Functions | B |
| データが消えた・他教室のデータが出る・壊れた | データ（Firestore/Storage） | C（最重要・慎重に） |

複数当てはまる場合は **A → B → C** の順で切り分ける。

---

## A. フロント（Hosting）のロールバック

### A-1. 最速：Firebase コンソールでロールバック（推奨・1分）
1. [Firebase コンソール → Hosting](https://console.firebase.google.com/project/komahyouapp-prod/hosting/sites)。
2. リリース履歴から、**直前の正常リリース**の「︙」→ **「ロールバック」**。
3. 各端末で **ハードリロード（Ctrl+Shift+R）** して回復を確認。

### A-2. コードを直して出し直す（恒久対応）
1. 問題コミットを `git revert <sha>`（または修正をコミット）。
2. `main` にマージ → `Deploy to Firebase Hosting` が自動で再デプロイ＆ライブ検証。
3. `https://komahyouapp-prod.web.app/version.json` が新版になったか確認。

> どちらでも良いが、原因コミットが分かっているなら A-2（revert）が履歴的にきれい。緊急時は A-1 で即止血 → 後で A-2。

---

## B. Cloud Functions のロールバック

1. 問題の functions 変更を `git revert <sha>`。
2. GitHub → Actions → **「Deploy Cloud Functions」→ Run workflow**（ブランチ=main）。
3. 緑を確認。**実反映の検証**：`gcloud functions describe <fn> --region=asia-northeast1` の updateTime、
   または対象機能の実動作で確認（CI が緑でも 409 で未反映のことがある＝[memory: functions-deploy-409](../../CLAUDE.md)）。
4. 緊急で revert 前に戻したいだけなら、直前に成功した functions のコミットを再デプロイする。

---

## C. データ（Firestore / Storage）の復元 ★最重要・最も慎重に

> **本番データ保護ルール厳守**（CLAUDE.md）。復元は誤ると**他教室を上書き**する（2026-06-06 の事故）。
> 復元系の操作は**「今アプリで開いている教室（actingClassroomId）」に書き込む**。必ず対象教室を開いてから行う。

### バックアップの所在
- 自動バックアップ: **毎時（直近3日）** と **日次（14日）**。
- Storage パス例: `workspace-auto-backups/main/hourly/{classroomKey}.json`。

### 復元手順（アプリ内 / 開発者）
1. **影響範囲を特定**：どの教室の・いつの時点へ戻すか。汚染なら「汚染前の毎時バックアップ」。
2. アプリで **対象の教室を開く**（ここを間違えると別教室を壊す）。開いている教室名を声に出して確認。
3. バックアップ/復元 画面から、**対象教室・対象時刻**を選んで復元（`restoreClassroomFromServerAutoBackup` 等）。
4. 復元後、データが正しいか**読み取りで照合**。問題なければ完了。

### 照合だけ先にしたいとき（書き込みなし）
- REST/コンソールで対象ドキュメントを **GET して内容確認**（読み取りのみ）。
- 書き込みを伴う検証は **staging / 開発用教室** で行う（本番では行わない）。

### Claude（自動セッション）が行う場合の制約
- 本番への**書き込み復元は行わない**。手順提示と読み取り照合まで。実行はオーナーが行う。

---

## ロールバック後にやること
- [ ] 回復をユーザー影響面で確認（実際の画面/機能）。
- [ ] 原因の Issue を起票（`type:bug` ＋ `severity`）。外形監視由来なら `incident:uptime` の Issue に追記。
- [ ] 恒久対策は通常フロー（ブランチ → staging 検証 → [release-checklist](./release-checklist.md) → main）。
- [ ] 同種の再発防止に**回帰防止テストを追加**（regression-guard）。
