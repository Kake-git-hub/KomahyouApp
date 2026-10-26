---
name: komahyou-invariant-registry-plan
description: 保証(INV)台帳は制度化完了(2026-07-11・v1.5.437)。正本は docs/spec-invariants.md — 本memoryはポインタと制度化時の裁定記録のみ(重複ゼロ原則)
metadata: 
  node_type: memory
  type: project
  originSessionId: 66cdcfa6-823f-44ba-8eee-10fbc129e66b
---

# 保証(INV)台帳 — 制度化完了（2026-07-11・v1.5.437 本番反映）

**正本は `docs/spec-invariants.md`**（11 INV=強制7+準観察4・運用ルール・違反履歴・担保状況）。
保証文・ルールの詳細をここに複製しない（重複ゼロ原則・台帳 §重複ゼロ参照）。

## 制度化時に確定した内容（オーナー裁定・選択式Q&Aで全論点確定）
- 文言拡張: INV-06=増減しない(誤増も違反)/INV-07=双方向(解除の巻き戻りも違反)/INV-09=割振対象判定含む/INV-02=出欠入力含む6操作。INV-04強制範囲は生徒/講師日程のみ(PDF/共有は準拠)。INV-11(選択対象の忠実配置)を準観察で追加。
- **非manual講師×再マージの裁定**: 「テンプレの反映日を決めて適用したときのみ反映日以降はテンプレが正(上書き)。それ以外はユーザーの配置が正」。現実装(mergeManagedWeekが常にクリア・テスト2074が現挙動ロック)は乖離しており**修正待ち別タスク**(inv02マトリクスに it.todo で可視化済み)。
- 運用: CIブロッキング+改定ガード(ci-tests.yml inv-guard=matrix.test変更にspec-invariants.md改定を強制)/兄弟監査はUX系バグのみ必須/regression-reviewer=INV監査ゲート4点出力/講師帰属の権威関数一元化は別タスク・マトリクス先行。

## 実装済み成果物（v1.5.437）
- `docs/spec-invariants.md`(台帳正本)+`docs/spec-index.md`(横断保証セクション)
- `inv01-teacher-attribution.matrix.test.ts`(14件)/`inv02-manual-edit-persistence.matrix.test.ts`(24件+todo1)
- `ci-tests.yml` inv-guard/CLAUDE.md INVアンカー節/dev-fix完了定義4点/regression-reviewer昇格/spec-curator台帳管理者化

## 残タスク
1. ~~非manual講師の実装修正~~ → **2026-07-11 仕様確定で決着(コード無変更)**: 実地調査でユーザーの講師配置は全経路manual扱い=不可侵と判明し「手動配置が消える」は前提誤り。非manual=テンプレ足場でテンプレ追従が仕様。it.todoは仕様ロックテストへ置換・台帳の2074誤記も訂正。残る実害(出勤不可テンプレ講師の赤置き直し)は Issue #47 へ分離。
2. **講師帰属の権威関数一元化**（resolveDeskTeacherIdentity等）— マトリクスに守られた最初の改修として中期
3. INV-04 Issue #42(payload経路一致)・INV-06 Issue #39(復帰UI)・Issue #47(赤置き直し) — OPEN のまま

**Why:** 反応型(経路パッチ)から予防型(保証の強制)へ。バグ史36件の検証で7 INVがtwo-strike実証済みだった。
**How to apply:** バグ修正時は台帳の完了定義4点(INV特定→マトリクス拡張→兄弟監査→INV-ID記載)に従う。詳細は必ず台帳を読む。関連 [[komahyou-no-regression-rule]] [[komahyou-teacher-schedule-regular-teacher-ids]] [[komahyou-teacher-template-remerge-instability]]
