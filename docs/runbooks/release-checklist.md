# Runbook: リリース前チェックリスト

本番（`komahyouapp-prod`）へマージする前に毎回確認する。判断フローの正本は
[safe-release スキル](../../.claude/skills/safe-release/SKILL.md)。ここはその確認票。

## 1. 着手前（同期）
- [ ] `git fetch` 済み・ローカル main が origin/main に追随
- [ ] `package.json` version とライブ `https://komahyouapp-prod.web.app/version.json` が一致
- [ ] 作業はブランチで行っている

## 2. 自動テスト（緑であること）
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:rules`（保存/権限/教室分離を触ったとき・要 Java + エミュレータ）
- [ ] `npm run build`
- [ ] バグ修正なら回帰防止テストを追加（修正なしで落ち・ありで通る）
- ※Playwright E2E は廃止（2026-06-29）。UI操作の回帰はユニット、実環境の通し動作は staging 実機確認で担保（`docs/test-strategy.md`）。

## 3. staging 実機確認（`komahyouapp-staging.web.app`）
> 詳細な実機テスト手順書 → [`manual-test-procedure.md`](./manual-test-procedure.md)（共通スモーク＋変更箇所別チェック）。
- [ ] 「Deploy to Staging」ワークフローが緑
- [ ] ハードリロード（Ctrl+Shift+R）して開いた
- [ ] **変更箇所**が期待どおり動く
- [ ] 主要回帰観点が壊れていない:
  - [ ] 複数教室の切替
  - [ ] QR 提出 → 出席者一覧反映
  - [ ] 自動割振（指定時限禁止・通常講師判定・振替同時割当）
  - [ ] 手動保存（Cloud Function 経由）→ 再読込で保持
  - [ ] 生徒日程表の通常授業カウント

## 4. 記録
- [ ] `CHANGELOG.md` の `## 未リリース` に1行追記
- [ ] `git diff` を通読し、意図しない変更が無い（spread での補完欠落・回帰防止コメント削除に注意）

## 5. リリース
- [ ] main にマージ（CI が本番 Hosting に自動デプロイ）
- [ ] `## 未リリース` を次の版でラベル付けし、空の `## 未リリース` を新設
- [ ] functions を変えたら「Deploy Cloud Functions」も実行＋実反映を検証
- [ ] ライブ `version.json` 更新と本番アプリの動作を確認

## 異常時
- ロールバック手順は safe-release スキルの「ロールバック手順」を参照。
