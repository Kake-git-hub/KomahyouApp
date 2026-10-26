---
name: komahyou-teacher-schedule-print-density
description: 講師日程表の印刷密度/A4収まり(縦書きセル・A3自動切替・screen+print二重フォント段)の調整ポイント
metadata: 
  node_type: memory
  type: project
  originSessionId: 17bef88b-4174-47ee-8261-187545eadf6b
---

講師日程表(`src/utils/scheduleHtml.ts`)を A4 横1枚に収める密度調整をする際の非自明ポイント。オーナーは印刷密度を継続的に詰めたい意向(A3飛び出しを嫌う)。

**セルは縦書き**: 講師セルのカードは `writing-mode: vertical-rl; text-orientation: upright`。1コマの中で「名前スパン→メタスパン(科目+種別[通/振/講]+状態[出/休/振無休])」を**縦に積む**(flex main軸が縦)。`renderTeacherCellCard` が描画、`is-single`(1人)/`is-pair`(2人)/`is-multi`(3-4人)でグリッド列数が変わる。

**A3自動切替の仕組み**: `.sheet` は `aspect-ratio` 固定＋`overflow:hidden`。`applySalaryOverflowPaging` が描画後に `sheet.scrollHeight - sheet.clientHeight` を測り、`shouldTeacherSheetUseA3(0, overflow>4)` で A3(is-a3-portrait)へ切替。**行が少ないと各行がシート高を埋めて伸びる(stretch)、行が多いと自然高になり超過分でA3**。だから密度検証は「多行(8限×5日)＋現実的な短い名前」の重いモックで `isA3` と A4想定オーバーpx を測る(名前を長くすると縦書きで不当に伸び誤判定)。

**フォント段は screen と print(@media print)で二重定義**: `.teacher-lesson-name/meta` の font-size は基準＋`.schedule-table.is-compact/is-dense/is-ultra-dense`(列数≥18/28/38で付与)の各段が、**通常CSSと`@media print`ブロックの両方**にある。変更は必ず両方を直す。`is-single` は既定で `is-pair` 規則へ同居させると単数=複数サイズに統一できる(v1.5.444)。

**密度の主レバー**(効いた順): (1)メタのラベル長(状態は1文字「出」、科目/種別/状態は空白なし連結「数60通出」= `getCompactStatusLabel`/`formatTeacherLessonLabel`/renderTeacherCellCardの`join('')`。tooltipのverboseは「出席」維持)。 (2)`teacher-lesson-person` の gap/padding=0＋講師カードのコマ余白0。 (3)講師シート限定 `[data-role="teacher-sheet"] .schedule-table thead th` の上下余白圧縮(生徒日程表=別ドキュメントへ波及させない)。 実測: 8限×5日で 変更前A4縦オーバー130px→A3化 が 変更後0px→A4収まり。

**波及境界**: `teacher-lesson-*`・`formatTeacherLessonLabel`・`getCompactStatusLabel` は講師専用。生徒日程表(`openStudentScheduleHtml`=別ドキュメント)は無改変を保つ。給与2列化は [[komahyou-empty-format-standalone-persistence]] とは別。埋め込みJSの罠は [[komahyou-schedulehtml-embedded-script]]。
