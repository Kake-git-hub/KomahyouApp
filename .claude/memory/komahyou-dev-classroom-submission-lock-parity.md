---
name: komahyou-dev-classroom-submission-lock-parity
description: 開発用教室でも提出ロック/リセットを本番と同一挙動にした(v1.5.450)・混入防止はdoc.classroomIdガードへ移設
metadata: 
  node_type: memory
  type: project
  originSessionId: 730e17ef-d664-4880-b742-cd89471eb5b1
---

開発用教室で「管理上は提出済み(countSubmitted=true)なのに提出トークン(lectureSubmissions/{token})が status='pending' のまま＝提出用QRを再読込すると再提出=上書きできる」非対称を修正(生徒S 呼欄で発覚・v1.5.450 / 2026-07-19本番反映)。

**設計判断(回帰防止・厳守)**: App.tsx の `schedule-student-count-save`/`schedule-teacher-count-save` から `(!isActingDevelopmentClassroom || isSubmissionTokenOwnedByClassroom(...))` を撤廃し、生徒/講師とも本番と同一に「登録=常に markLectureSubmissionDocAsSubmitted / 登録解除=常に guardAndResetLectureSubmissionDoc」を呼ぶ(actingClassroomId を第3引数で貫通)。
- **App層の入力タグ(submissionTokenClassroomId)ガードを lock/reset 経路へ復活させない**。混入防止(他教室=本番docへの誤書込・[[komahyou-dev-classroom-qr-token-contamination]] INV-08)は lectureSubmission.ts の低レベルガード `isForeignClassroomSubmissionDoc(data, expectedClassroomId)`(doc.classroomId が操作教室と異なれば書かない)で担保。doc.classroomId は入力タグより権威的(「提出先はトークンのclassroomIdで決まる」)。空/未設定classroomIdの旧トークンは後方互換で許可(稼働docは writeSubmissionDocs で必ず付与=到達不能)。
- 本番教室は doc.classroomId 常一致で挙動不変。反映(doc→ローカル)は reflectParentOwnedSubmissionFields の union のみ=希望/配置/出席不可は不変([[komahyou-submission-board-persistence-asymmetry]] INV-07)。
- reopenedSlots同期(updateSubmissionReopenedSlots・App.tsx 3460付近)は従来のApp層ownedガードを維持(意図的・ロックとは別concern)。**残る分散**: 配布情報書き込み3経路(updateSubmissionOccupiedSlots/updateSubmissionGroupClassEligibility/updateSubmissionReopenedSlots)は doc.classroomId ガード未統一=中期でSpawn済みタスク。

**既存desyncの手当て**: 修正は今後の登録を正すのみ。既にズレている生徒(生徒S等)は 日程表を開き直し(トークン再発行=dev-owned化)→登録解除→再登録 で token が submitted にロックされ整合する。

割振コマ表記も同版で「種別+科目」化(講習の数学→講数・通常の英語→通英)。純関数 `buildOccupiedSlotLabel`(src/utils/occupiedSlotLabel.ts)・生徒occupiedSlotsのみ(講師は科目非一意で種別ラベル維持)。出席不可/黄色コマ/希望提出内容の提出後表示は v1.5.449 で実装済み。
