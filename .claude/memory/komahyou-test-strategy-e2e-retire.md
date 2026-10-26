---
name: komahyou-test-strategy-e2e-retire
description: コマ表のテスト方針見直し・Playwright E2E廃止と代替(段階移植中)
metadata: 
  node_type: memory
  type: project
  originSessionId: a2dfd6c0-4970-425c-924c-5de7bb6fd575
---

オーナー判断(2026-06-29): Playwright **E2E は廃止**する。理由=local モードで Firebase 保存/復元・教室クロス汚染・QR を一切検証せず本番criticalが空、毎pushでなく手動のみ、約18件flaky+18分、モデルロジックは既にユニットで重複担保。方式は **「段階移植してから削除」**(カバレッジ欠落を作らない)。**2026-06-29 に全Phase完了・本番反映済**。

正本台帳: `docs/test-strategy.md`(移植マップ・完了サマリ)。

完了状態(2026-06-29): tests/・playwright config・@playwright/test・test:e2e* を削除済。自動テスト= **ユニット425件(毎push `test:unit`)＋Firestoreルール分離13件(手動 `npm run test:rules`・要Java+エミュレータ)**。`ci-tests.yml` は lint/unit/build(毎push)＋rules(手動 workflow_dispatch)。移動は `computeStudentMove`、警告評価は `canTeacherHandleStudentSubject`/`resolveLessonPatternWarnings`/`isLectureOutsideSessionPeriod`/`isStudentUnavailableAtSlot` に純粋関数として抽出済。

代替4層: ①ロジック単体(vitest/node・主ゲート毎push) ②Firebaseエミュレータ統合(保存→復元席一致/actingClassroom分離/QR・リリース前) ③Claudeのstaging DOM駆動チェック(実環境・変更フローのみ) ④build+tsc。

真の移植対象は **盤面操作 orchestration のみ**(`executeMoveStudent`/swap/status が未export)。同日移動が通常のまま/増コマ/元日へ戻すと通常/休み日付の非引継ぎ([[komahyou-move-date-inheritance]])/同コマ重複ブロック/週跨ぎ移動/undo-redo/出席保持。純粋 reducer に抽出してユニット化(回帰防止ルール厳守 [[komahyou-no-regression-rule]])。それ以外(基本データ/特別講習/自動割振/テンプレ/ストック/日程導出/警告)は既にユニット担保済みでE2E削除可。

Claudeの既定テスト運用: 修正=ユニット+build+変更フローのstaging DOM確認 / 機能追加=＋薄い統合+新規ユニット。スクショは最後の1枚だけ(画像がコスト要因)。
