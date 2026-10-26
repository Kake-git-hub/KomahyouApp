---
name: komahyou-combined-subject-risha
description: 合体科目「理社」を算国と同型で追加(v1.5.413)・合体科目を触るとき更新すべき全サイトとA4影響の考え方
metadata: 
  node_type: memory
  type: project
  originSessionId: aaac1be4-838f-4308-a71d-aee1caacfc05
---

小学生の科目に合体科目「理社」を追加(2026-07-09・v1.5.413・本番全教室反映済み)。
「算国」と同型＝1コマで理科+社会をまとめて扱う小学限定の選択肢。要望対応。

**合体科目(算国/理社)を追加・変更するときに更新する全サイト**(grep `'算国'` が起点):
- `types.ts` SubjectLabel union
- `studentGradeSubject.ts`: allStudentSubjectOptions / elementaryStudentSubjectOptions /
  normalizeRequestedSubjectForGrade(非小学は主科目へ畳む: 算国→数, 理社→理)
- `scheduleHtml.ts`(埋め込みスクリプト): subjectDefinitions / SUBJECT_SORT_ORDER(社の直後・集理集社の前) /
  getVisibleSubjectsForStudent(小学のみ表示) / normalizeSubjectForStudent
- `ScheduleBoardScreen.tsx`: canTeacherHandleStudentSubject(理社=理or社の担当で可) / 体験授業の科目候補リスト
- `regularLessonTemplate.ts` subjectOptions
- QR希望提出は `App.tsx` の `getSelectableStudentSubjectsForGrade` 経由で自動反映(専用対応不要)

**A4影響の結論**: 回数表はデータ駆動。通常回数表は該当授業がある生徒のみ行が出る。
講習回数表は forcedLabels でも `hideZeroZero:true` で0なら非表示。合体科目は理+社の2行を
1行に統合する形なので、生徒あたり最悪行数は増えない(直近 c1cec08 のA4見切れ対策と非干渉)。

回帰防止テストは studentGradeSubject.test.ts / ScheduleBoardScreen.test.ts /
scheduleHtml.test.ts に追加済み(選択肢・表示・正規化・講師対応・埋め込み分岐)。関連 [[komahyou-schedulehtml-embedded-script]] [[komahyou-tests-required-for-changes]]。
