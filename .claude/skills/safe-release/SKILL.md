---
name: safe-release
description: コマ表アプリを本番(komahyouapp-prod)へ安全にリリースするための手順。staging 実機検証→本番マージ→ライブ検証→必要ならロールバックの流れと、リリース前チェックリストを定める。コードをマージ/デプロイする前、リリース判断をするとき、本番に変更を出すとき、ロールバックを検討するときは必ずこのスキルに従う。回帰防止は solo-git-workflow と regression-guard を併用する。
---

# 安全リリース手順（staging → 本番）

このアプリは**稼働中の本番サービス**。リリースの安全性が最優先。
本スキルは「壊れたまま本番に出さない／出たらすぐ戻す」を制度化する。土台として
`solo-git-workflow`（Git運用）と回帰防止ルール（CLAUDE.md／regression-guard）に必ず従う。

## 安全性の4本柱

1. **自動テストが網羅的に通る** — マージ前にローカル/CI で unit + build を緑にする（保存/権限を触ったら `test:rules` も）。※Playwright E2E は 2026-06-29 に廃止しユニットへ移植済み（`docs/test-strategy.md`）。
2. **本番そっくり staging で実機確認** — `komahyouapp-staging` で実際に画面を触ってから本番へ
3. **リリース前チェックリスト** — 毎回同じ観点（下記）を見落とさず確認
4. **壊れても即ロールバック** — Hosting ロールバック＋バックアップ復元の手順を即実行できる

---

## リリースの流れ（標準フロー）

### 1. 作業はブランチで（solo-git-workflow 厳守）
- `git fetch` でローカル main が origin/main に追随しているか、`package.json` の version と
  ライブ `https://komahyouapp-prod.web.app/version.json` が一致しているか確認。
- 作業ブランチを切ってから編集。

### 2. 自動テストを通す（第1の柱）
```bash
npm run lint
npm run test:unit          # vitest（回帰防止テストを含む。盤面操作/警告/移動も純粋関数で担保）
npm run test:rules         # Firestore ルールの教室分離（保存/権限/教室分離を触ったとき。要 Java + エミュレータ）
npm run build              # tsc -b + vite build が通ること
```
- バグ修正なら**回帰防止テストを必ず追加**（修正なしで落ち・ありで通ることを確認）。詳細は regression-guard。
- ※E2E は廃止。UI操作の回帰はユニット（純粋関数）で、実環境の通し動作は staging 実機確認で担保する（`docs/test-strategy.md`）。

### 3. staging で実機確認（第2の柱）
- 作業ブランチをそのまま使い、GitHub → Actions → **「Deploy to Staging」** を Run workflow。
- 緑になったら `https://komahyouapp-staging.web.app` を**ハードリロード（Ctrl+Shift+R）**して開く。
- 変更箇所＋下のチェックリストを実機で確認。**staging は書き込み自由**（本番データ保護ルールの対象外）。
- staging 未整備の場合は `docs/runbooks/staging-setup.md`。整備が終わるまではローカル `npm run dev` で代替し、その旨を明示する。

### 4. リリース前チェックリスト（第3の柱）
本番にマージする前に、毎回これを確認（詳細版は `docs/runbooks/release-checklist.md`）。
- [ ] lint / test:unit / build が緑（保存/権限/教室分離を触ったら test:rules も）
- [ ] 変更に対応する回帰防止テストを追加した（バグ修正時）
- [ ] staging 実機で**変更箇所**が期待どおり動く
- [ ] staging 実機で**主要回帰観点**が壊れていない：複数教室の切替・QR提出・自動割振・手動保存（Cloud Function 経由）・生徒日程表のカウント
- [ ] `CHANGELOG.md` の `## 未リリース` に1行追記した
- [ ] `git diff` を読み、意図しない変更（spread での補完欠落・回帰防止コメント削除）が無い

### 5. 本番へマージ＝デプロイ
- ブランチを **main にマージ**（CI が build→本番 Hosting デプロイ→ライブ検証→patch bump まで自動）。
- `CHANGELOG.md` の `## 未リリース` を、次にデプロイされる版でラベル付けし、新しい空の `## 未リリース` を上に作る。
- **Cloud Functions を変えた場合**は別途「Deploy Cloud Functions」ワークフロー（本番）も実行。
  - functions の本番反映は 409 で誤成功し得る。実反映は live GET / `gcloud functions describe` の updateTime で検証（memory: functions-deploy-409 参照）。

### 6. ライブ検証（第4の柱の前段）
- Actions が緑、`https://komahyouapp-prod.web.app/version.json` が新版になっているか確認。
- 本番アプリをハードリロードして変更箇所がそのまま出るか確認。

---

## ロールバック手順（壊れたとき）

> 詳細な実行手順は **`docs/runbooks/rollback.md`**（症状別 A/B/C・データ復元の注意）。
> 障害の自動検知と対応フローは **`docs/runbooks/monitoring.md`**（外形監視→incident Issue）。以下は要点。

### A. フロント（Hosting）の巻き戻し
1. Firebase コンソール → Hosting → リリース履歴 → **直前の正常リリースへロールバック**。
2. 緊急で手が空かないときは、`git revert` して main にマージすれば CI が前状態を再デプロイする。

### B. Cloud Functions の巻き戻し
- 直前の正常コミットを `git revert` して「Deploy Cloud Functions」を再実行。

### C. データが壊れた／汚染された場合
- **本番データへの書き込み・復元は最重要の慎重操作**（CLAUDE.md 本番データ保護ルール）。
- バックアップ: 毎時（直近3日）/ 日次（14日）。Storage `workspace-auto-backups/main/hourly/{key}.json`。
- 復元は**開いている教室（actingClassroomId）に書き込む**ため、教室取り違えで他教室を汚染した前例あり
  （memory: classroom-restore-cross-contamination）。復元前に対象教室を必ず確認。
- 自動チェック中の Firestore 書き込みは**開発用教室 / staging のみ**に限定する。

---

## やってはいけないこと（再掲・厳守）
- staging が無いことを理由に、本番でいきなり実機確認すること
- テスト・チェックリストを飛ばして main にマージすること
- 過去の修正を巻き戻すコード変更（regression-guard 参照）
- 本番データへの書き込みを伴うデバッグ（staging / 開発用教室で行う）
