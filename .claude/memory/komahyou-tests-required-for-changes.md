---
name: komahyou-tests-required-for-changes
description: 全ての変更(新機能含む)にユニットテストを必ず添えるルール
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a2dfd6c0-4970-425c-924c-5de7bb6fd575
---

オーナー指示(2026-06-29): バグ修正だけでなく **新機能・新挙動・既存挙動の変更も、その挙動を守るユニットテストを必ず同じコミットで追加する**。テスト無しでマージしない。

**Why:** Playwright E2E を廃止した([[komahyou-test-strategy-e2e-retire]])ため、UI操作・盤面ロジック・警告・保存/権限などの回帰防止は**ユニットが唯一の自動ゲート**。新コードの被覆は自動生成されない＝書かなければ穴になる。

**How to apply:** 巨大コンポーネント内のロジックは純粋関数に切り出してから検証する(例 `computeStudentMove` / `resolveLessonPatternWarnings`)。「修正なしで落ち・修正ありで通る」を確認([[komahyou-no-regression-rule]])。保存/権限/教室分離を触れば `npm run test:rules` も。本番critical(実Firebase往復/画面表示)は staging 実機確認で補完。CLAUDE.md「テストゲート」節に明記済み。
