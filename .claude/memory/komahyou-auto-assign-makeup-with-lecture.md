---
name: komahyou-auto-assign-makeup-with-lecture
description: 未消化講習の自動割振に「振替も同時割当」選択肢を実装・v1.5.331で本番反映済み
metadata: 
  node_type: memory
  type: project
  originSessionId: 881439ad-e85e-4028-9968-517b73e07f93
---

未消化講習の自動割振モーダルに「未消化振替も同時に自動割り当てする」チェックボックス(既定OFF)を実装。
ONで講習を全配置後、同じ生徒の未消化振替を「講習期間内の空きコマ」へ振るい順(古い振替元から)で同一規則割当。

- 実装: 2026-06-27・**PR #34 マージ済→v1.5.331 で本番デプロイ済み**(開発用教室で実機検証OK後)。設計正本は `docs/handoff-student-schedule-option-field.md` A〜F節。
- 共有コア `findBestAutoAssignCandidate<TItem>` に講習・振替の規則評価を統一。`findBestLectureAutoAssignCandidate` は委譲化で講習スコア従来完全一致。`findBestMakeupAutoAssignCandidate` は session期間内のみ・末尾=振るい順優先。
- `handleAutoAssignLectureStockEntry(entry, { includeMakeup })`・純関数 `buildMakeupAutoAssignPendingItems`(export/単体テスト済)。
- typecheck/build/test:unit(389)グリーン。

**Why:** 引き継ぎE/F節が「開発用教室で検証してから本番運用へ」を明示ゲート化。オーナーが開発用教室で
実機検証→OK後にマージ・デプロイした。私は本番Firebaseへ書込不可なので、盤面操作系の本番デプロイは
この「オーナーが開発用教室で検証→OK→マージ」フローを踏むのが定石。

**How to apply:** 盤面操作を伴う機能は、検証用に branch を `npm run dev` でローカル起動(CIはmain以外を出さない・
ポート競合時は5174等に逃げる)→オーナーが開発用教室 `v8OZ7zH8vONNHjjYVcR1` で確認→OKなら回帰確認を通して
PR作成→main マージ(CI自動デプロイ・版bump)([[komahyou-autonomous-commit-merge]])。回帰防止は [[komahyou-no-regression-rule]] 厳守。
