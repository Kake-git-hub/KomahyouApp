<!--
本番(komahyouapp-prod)へのマージ前チェック。詳細は docs/runbooks/release-checklist.md / safe-release スキル。
直接 main にマージする運用でも、この観点を満たしてから出すこと。
-->

## 変更概要
<!-- 何を・なぜ -->

## リリース前チェック（release-checklist.md）
- [ ] `npm run test:unit` ＋ `npm run build` が緑（CI: Lint+Unit+Build）
- [ ] バグ修正なら回帰防止テストを追加（修正なしで落ち・ありで通る / regression-guard）
- [ ] 確認リスト（`src/utils/verificationChecklist.ts`）に、変更を開発用教室で確かめる項目を足した（staging 実機確認は 2026-11-05 から任意）
- [ ] `CHANGELOG.md` の `## 未リリース` に1行追記
- [ ] `git diff` を通読し、意図しない巻き戻し（spread での補完欠落・回帰防止コメント削除）が無い

## 影響範囲 / ロールバック
<!-- 影響する機能・教室。問題時の戻し方（rollback.md のどれ） -->

## 関連 Issue
<!-- #番号 -->
