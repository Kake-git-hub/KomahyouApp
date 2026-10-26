---
name: komahyou-group-lesson-feature
description: 集団授業(特別講習・中3向け)機能の確定仕様と実装計画・未決事項
metadata: 
  node_type: memory
  type: project
  originSessionId: ab1f6d17-a11e-48af-9404-1a0d2e28259e
---

コマ表アプリに「集団授業」(特別講習期間・中3のみ・集団理科/集団社会)を新規追加する作業。2026-06-12にオーナーQ&Aで仕様確定。正本は `docs/spec-group-lesson.md`（6フェーズの実装計画つき）。

要点（コードからは読み取れない設計判断）:
- 既存の個別授業(`DeskLesson`)に**非干渉**で新経路実装。本番3教室は読み取り専用、検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。旧 `groupLessons`(死蔵)は流用しない。
- 盤面: 特別講習を含む週だけ1限の上に集団2行(10:00-11:00 / 11:10-12:10)。生徒2列を結合した科目セル＝集団理科/集団社会。空セル→科目ピッカー、科目入り→クリックメニュー(出席者一覧/削除)。
- 出欠の唯一の入力点は盤面の出席者モーダル(default出席・欠席トグル・PDF・キャンセル)。名簿=参加提出した中3。
- 希望提出(中3のみ): 参加/不参加(既定不参加)。`SpecialSessionStudentInput` に新規optionalフィールド追加。**講習ストック/振替には非干渉**、講習回数表(集理/集社)にだけ反映(表示期間内: 希望=盤面コマ数/actual=出席数)。
- 給与: 専用カテゴリ「集団」1種・1バンド=1コマ(出席1名以上で実施)・交通費日数に集団実施日も加算。
- 生徒日程表: 未登録の中3は全員表示／登録後(室長登録 or 生徒QR提出)は参加者のみ＋出欠反映。
- 移行: 夏期講習が提出中。未設定=不参加で既存提出を**書き換えない**(提出状況不変)。参加させたい中3は室長が日程表登録UIで切替。

**未決事項なし(全確定 2026-06-12)**。#1 出席者モーダルの「中3手動追加」=入れるで確定(名簿初期=参加提出者+当日手動追加可、追加分も出席/給与/回数反映)。データ構造はstudentId基準。

**全Phase実装・コミット・push済(branch feat/group-lesson)**。型/optionalの方針はsubjectDurations?踏襲。
- Phase0(413b4ee): groupClass.ts(新規)・PersistedBoardState.groupClassEntries?・SpecialSessionStudentInput.groupClassParticipation?。保存往復=workspaceStore BoardStock Pick・App.tsx buildBoardDataForSignature・studentInput明示2経路保全。
- Phase1(4556780): 盤面に集団2行(BoardGrid tbody先頭・resolveGroupClassDayFlags)・科目/講師ピッカー・削除メニュー。
- Phase2(4f9e8bb): GroupAttendanceModal.tsx(名簿=参加中3+手動追加・既定出席/欠席・保存/キャンセル・PDF)・groupAttendanceHtml.ts。
- Phase3(12e99d2): 希望提出。lectureSubmission/App/SubmissionPage/functions に availableGroupClassSubjects(中3のみ)+groupClassParticipation。**functions要デプロイ**。
- Phase4(485e733): 生徒日程表。scheduleHtml埋め込みJSに集団行+回数(集理/集社)。countSubmitted=登録(室長登録 or QR提出)。
- Phase5(b43daad): 講師日程表+給与カテゴリG(集団・1コマ・出席1名以上・交通費日数加算)。
- Phase6(0df8012 docs): 反映/検証はオーナー実施(Claudeはデプロイ/本番書込み不可)。
- Phase7(7c597dc): オーナー回答Q1反映=室長の集団参加設定(日程表モーダルに中3トグル・登録済みでも編集可・既存データ維持・schedule-student-group-save)＋既存QR後埋め(updateSubmissionGroupClassEligibility・未提出docへ冪等)。現行夏期講習でも利用可。

検証: app tsc / functions build / vitest 全337通過(scheduleHtml構文検証含む) / vite build成功。

**未保存検知/共有自動再公開の安全実装(2026-06-13 e161115)**: 集団編集の publish は「ユーザー編集時のみ」に限定。commitGroupClassEntry で `groupClassUserEditPendingRef` を立て、受動 publish effect はこのフラグ時だけ `userInitiated:true` で emit(既存の安全な保存+共有再公開経路)。教室切替/ロードではフラグが立たず userInitiated:false=無書込み。**経緯**: 一旦 handleBoardStateChange で userInitiated:false でも集団差分時に書込む実装にしたが、教室切替の食い違い窓でクロス汚染リスクがあり差し戻し([[komahyou-classroom-restore-cross-contamination]])、フラグ方式で入れ直した。**鉄則**: 盤面の書込み/同期は userInitiated:true のみ。受動イベントでは絶対に書かない。

**オーナー判断: 全て回答済(2026-06-13)**。Q2 undo非対応・Q3 欠席取消線・Q4 名簿=参加+手動追加は現状維持確定。Q1(室長参加設定)はPhase 7で実装。
**残作業(オーナーのみ・Claude実行不可)**: firebase deploy --only functions(Phase3/7反映)、開発用教室v8OZ7zH8vONNHjjYVcR1でE2E、本番個別データ不変確認、全教室反映。
**未live検証**: Firebase認証壁のため盤面/モーダル/日程表のlive動作は未確認(型/ビルド/337テスト/構文検証で担保)。要オーナーのE2E。

**集団選択肢は盤面登録済み科目のみ(v1.5.360・2026-06-30)**: 集団参加(集団理科/集団社会)の選択肢は、その講習期間内に**盤面(groupClassEntries)へ少なくとも1回その科目が登録されているとき**だけ出す。集団を設定しない講習は集団欄を一切出さない(中3でも)。正本は純関数 `resolveRegisteredGroupClassSubjects(entries,start,end)`(`src/components/schedule-board/groupClass.ts`・canonical順)。**2経路すべてに適用**: ①QR提出=App.tsx で `availableGroupClassSubjects`(新規発行 + 既配布の `updateSubmissionGroupClassEligibility` 後埋め)をこの結果に限定 / ②室長の生徒日程表登録ダイアログ=scheduleHtml 埋め込みJS `getGroupClassSubjectsInRange` で集団行を出し分け。**回帰注意**: ここを `groupClassSubmissionSubjects`(=常に[集理,集社])のハードコードに戻すと「集団なし講習にも欄が出る」回帰になる。既提出データ・提出状況は不変(後埋めは未提出のみ)。テスト groupClass.test.ts(6件)。[[komahyou-group-participation-save-paths]]

関連: [[komahyou-no-regression-rule]] [[komahyou-save-architecture]] [[komahyou-schedulehtml-embedded-script]] [[komahyou-template-editing-flow]]
