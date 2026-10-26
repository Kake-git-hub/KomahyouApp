---
name: komahyou-regular-teachers-only-board-source
description: 「通常講師のみ」は判定元を盤面にしないとライブregularLessons配列と食い違って効かない
metadata: 
  node_type: memory
  type: project
  originSessionId: 78f3bdb4-118f-4ca4-adb5-0641168009c8
---

「通常講師のみ」ルールの“その生徒の通常授業担当講師”は、**ライブ regularLessons 配列だけで判定すると効かない**ことがある。

**症状**: 通常と違う曜日でも、その生徒の通常講師(テンプレでの組み合わせ)に空きがあるのに、講習自動割振がその通常講師へ割り振られない(他講師に配置される)。0件ではなく「通常講師に当たらない」。

**重要な前提**: このルールはソフト(スコア)。`buildForcedConstraintScoreParts` の「絶対事項合計」に+1され、同条件なら通常講師のデスクが必ず勝つ。だから *通常講師に当たらない=その講師が `ruleRegularTeacherIds` に入っていない* と断定できる(ハードフィルタは無い／オーナー方針)。

**真因**: 自動割振が探索するのは persisted/テンプレ反映済の盤面(`cloneWeeks(normalizedWeeks)`)。一方で担当講師判定は `regularLessons` 配列(基本データ)を参照していた。基本データの通常授業を編集すると配列と盤面が食い違い、配列側にその生徒↔講師の行が無く空集合になる([[komahyou-template-editing-flow]]／2026-06-15 の regularTeacherIds 食い違いと同根)。

**対処(2026-06-22, v1.5.317)**: `collectStudentRegularTeacherIdsFromWeeks` を追加し、**盤面の通常授業スロット(lessonType==='regular')**からその生徒のデスク担当講師IDを集め、配列由来(`resolveRegularTeacherIdsForStudentAnyDay`)と**和集合**で判定。生徒同定は `resolveStockComparableStudentKey`(自動割振の他処理と同一)。候補スコア(findBestLectureAutoAssignCandidate)と盤面赤字警告の両方を同じ判定に統一。

**経緯**: 1回目の修正(曜日別→any-day、v1.5.315)は配列参照のままだったため不十分だった。判定元を盤面にするのが要点。
