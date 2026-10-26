---
name: komahyou-template-editing-flow
description: テンプレ編集の本体はScheduleBoardScreenのオンボードtemplateCells経路・死蔵モーダル版は2026-07-04削除済み
metadata: 
  node_type: memory
  type: project
  originSessionId: 978c908b-8553-4d81-bc50-106e575b077c
---

コマ表アプリの通常授業テンプレ編集は**オンボード経路が唯一**（2026-07-04 以降）。

- **本体（稼働）**: `ScheduleBoardScreen.tsx` の `isTemplateMode`/`templateCells` 経路。盤面そのものを週グリッドで編集する。配置ロスターは `buildTeacherSelectionOptions`(template分岐)・`buildTemplateStudentSelectionOptions`、保存は `handleSaveRegularLessonTemplate`、参加者フィルタは `filterTemplateParticipantsForReferenceDate`。テンプレ盤面セルの cellId は `template_{dayOfWeek}_{slot}`。
- **削除済み**: モーダル版 `RegularLessonTemplateEditor.tsx` は import 0件の死蔵だったが、仕様監査 領域3 C3（オーナー確定 2026-07-04・v1.5.378）で**削除した**。かつて「先に死蔵の方を編集して無駄手戻り」が起きたため、罠ごと撤去。git 履歴には残る。

**Why:** 2026-06-09 のテンプレ仕様デルタ実装時、先に死蔵の方を編集してしまい無駄手戻りが発生した。二度目を防ぐため削除で確定。
**How to apply:** テンプレ挙動の変更は必ずオンボード経路（ScheduleBoardScreen + regularLessonTemplate.ts の関数群）に入れる。関連: [[komahyou-save-architecture]]、仕様は docs/spec-board-regular-placement.md §7 と docs/spec-template-behavior.md（二層正本・相互参照あり）。
