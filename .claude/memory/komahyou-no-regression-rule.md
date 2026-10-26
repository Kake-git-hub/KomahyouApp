---
name: komahyou-no-regression-rule
description: コマ表アプリでは過去の修正を必ず踏襲・後の変更で巻き戻さない（オーナー厳命）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 26464665-3fdf-4fa1-b483-5cbeadd60b26
---

コマ表アプリは**過去の修正を踏まえて次の修正を積み上げる**前提。過去に直したバグを後の変更（特にマージ/リベース/リファクタ）で**巻き戻してはいけない**（オーナー厳命・2026-06-10）。

**Why:** 実際に回帰が起きた。`mergeManagedDeskLesson` の生徒同一性補完（`id`/`managedStudentId`/`birthDate` を managed 側から `?? `補完）が commit `6793374` で入ったのに、後のマージ commit `2dce7b4` で `{ ...managedStudent, ...student }` の単純 spread に巻き戻り、生徒日程表で通常授業がカウントされない不具合が再発した。

**How to apply:**
- 既存ロジックを書き換える前に `git log -L`／`git log -S "<コード片>"`／`git blame` で「その箇所が過去に何を直したか」を確認する。
- 関数近くの「回帰防止」「fix」「過去コミットID」コメントは意図的ガード。消さない・薄めない。
- spread での「単純化」に注意：明示フィールド補完を消すと回帰する。
- マージ衝突は両側の修正を両立させる（一方を捨てて上書きしない）。
- バグ修正には必ず回帰防止テストを追加（修正なしで落ち・修正ありで通ることを確認）。ゴールデンスナップショット頼みにしない。
- ルール本文は `CLAUDE.md` 冒頭「回帰防止ルール」にも記載済み。保存系の回帰温床は [[komahyou-save-architecture]]。
