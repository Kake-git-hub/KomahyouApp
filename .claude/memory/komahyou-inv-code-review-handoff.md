---
name: komahyou-inv-code-review-handoff
description: INV(横断保証)駆動のコード全体レビュー完了(2026-07-11・v1.5.438)。権威関数分散マップ+一元化候補(優先度)+INV-04昇格判定+マトリクス空セルを産出。確認された脆さは講師側とWRITE側に集中。着手はマトリクス先行(禁忌=広域リファクタ先行)。次アクション順序と実コードで裏取り済みの所見を記録
metadata: 
  node_type: memory
  type: project
  originSessionId: 66cdcfa6-823f-44ba-8eee-10fbc129e66b
---

# INV駆動コード全体レビュー — 完了（2026-07-11・HEAD v1.5.438）

オーナー指示「実装した保証(INV)の考えでコード全体レビュー」を実施。8 INV(01/02/03/04/06/07/08/09)を
並列スイープ→各分散所見を独立2検証で敵対検証→統合(51エージェント/エラー0)。主セッションが最重要3件を実コード再確認。
正本 `docs/spec-invariants.md`(11 INV)。関連 [[komahyou-invariant-registry-plan]] [[komahyou-no-regression-rule]]。

## 中心結論
**「生徒側=堅い(単一権威)/講師側・WRITE側=脆い(分散)」の仮説は検証で裏付け・強化。**
確認された本物の分散/破れは講師帰属・講師登録解除・講師日程表param・在庫返却WRITEに集中。
スイープの過剰申告は敵対検証で大幅補正(INV-03は7サイト中6が誤検出=実質単一権威、INV-08主要書込経路も健全)。

## 実コードで裏取り済み(主セッション確認)
- **INV-01 講師帰属4フィールド分散(P0・最優先)**: `ScheduleBoardScreen.tsx` mergeManagedWeek の三項束
  2620-2624/2635-2638/2662-2665/2729-2732＋埋め込みJS複製 `scheduleHtml.ts:3155-3175`(buildTeacherAssignments逐語)。
  単一 `resolveDeskTeacherIdentity` は不在(grep 0件)。消費者=resolveManagedTeacherForDesk(5020)/resolveTeacherIdForDesk(6399)/
  scheduleViewData buildTeacherAssignments(341・唯一regularTeacherIdsフォールバック)。※serializeCells(361)と机再構築ループ
  (2755-2803)は検証でscope外と確定(前者=population問題、後者=INV-02足場配置)。
- **INV-07 講師登録解除の guard.add 欠落(現に破れ・小修正で是正可)**: `App.tsx:3733` の講師 unregister が
  `resetLectureSubmissionDoc(teacherToken)` を呼ぶ前に `recentlyResetSubmissionGuardRef.current.add()` を欠く。
  生徒版(3624)は正しく add→reset。v1.5.392(生徒版レース修正)の**講師版が未適用**=解除直後の古いsubmitted購読で
  countSubmitted＋盤面配置が復活しうる。台帳の兄弟監査が狙う典型的な穴。
- **INV-06 在庫返却WRITEの活性ドリフト(P0)**: `handleStoreStudent`(9219-9220)は `makeupSourceDate ?? dateKey`、
  `handleMarkStudentAbsent`(9334-9335)は素の `dateKey`=講習ストックorigin メタが経路で食い違う。両者+休日除去(7477)+
  テンプレ上書き前戻し(4072)の4経路が戻し分岐をコピー実装。

## 一元化候補(優先度・マトリクス先行が厳守)
- **P0** `resolveDeskTeacherIdentity`(INV-01/02講師帰属)/`reconcileStockForBoardEntryRemoval`(INV-06在庫返却WRITE・
  9219vs9334ドリフト是正を同時に)。
- **P1** 講師 `guard.add` 即時修正+`unregisterSubmissionToken`(INV-07)/`buildSchedulePayloadSyncInput`(INV-04・後述昇格と同一改修)/
  `isAutoAssignTargetLesson`+`subjectCapableTeachersOnly`(6283)へregular除外ガード追加(INV-09・新規ギャップ確認)。
- **P2** `stripAllSubmissionTokens`(INV-08コピー隔離・App.tsx 496/500 inline再実装)。
- **格下げ** INV-03汎用フックは任意(分散は検証で否定)。

## INV-04 昇格判定=昇格すべき(準観察→強制)
講師side param二重同期(`App.tsx:3396-3441` と `ScheduleBoardScreen.tsx:5894-5918` が鏡像非対称+全置換rAF最後勝ちで
集団理科/社会の帯が消える)が独立2検証+台帳Issue#42(OPEN)で確定。subjectDurations(664e3fa)に次ぐ内容乖離2件目=two-strike成立。
最小修正=App両経路に `groupClassEntries`(+optionFieldEnabled/teachers)追加→`inv04-schedule-parity.matrix.test.ts`新設→一元化。

## 次アクション順序(マトリクス先行)
1. ~~INV-07 講師 `guard.add` 即時修正~~ → **完了・本番反映 v1.5.439(2026-07-11)**。生徒/講師の登録解除を
   `guardAndResetLectureSubmissionDoc`(lectureSubmission.ts)へ一本化しガード欠落の非対称を構造解消。回帰テスト3件を
   recentlyResetGuard.test.ts に追加(ガードを外すと落ちる mutation 確認済み)。staging実機OK→main→ライブ検証済み。
   残: INV-07 の本格マトリクス(inv07-*.matrix.test.ts)新設は未実施(台帳の暫定担保のまま・次の違反時 or 別タスク)、
   台帳 spec-invariants.md への違反履歴転記はオーナー承認(spec-curator)待ち。
2. INV-04 最小修正(App両経路にgroupClassEntries)+回帰テスト(#42実害を先に封じる)。
3. INV-06 マトリクス新設`inv06-stock-reconciliation.matrix.test.ts`最優先→9219vs9334ドリフト是正→reconcileStock…一元化。
4. INV-01/02 マトリクス空セル5点を厚くし tombstone符号(teacherAssignmentTeacherIdが削除枝で講師名/他枝でID=多義)を正規化→resolveDeskTeacherIdentity着手。
5. INV-09 isAutoAssignTargetLesson導入+subjectCapableTeachersOnlyガード追加+和集合一致テスト(lessonLimit/patternのregular除外可否はオーナー裁定後)。
6. INV-04 parityマトリクス→buildSchedulePayloadSyncInput一元化(台帳昇格追記はオーナー承認・同一push)。
7. INV-08空セルのマトリクス化→stripAllSubmissionTokens(低リスク置換)。

**禁忌**: マトリクス無しの広域リファクタ先行。regularTeacherIds和集合(v1.5.317)・makeupSourceDate/managedStudentId三項補完・
除外コメントを spread/単純化で薄めない。

**Why:** 反応型パッチから予防型(保証の強制)への棚卸しを一度コード全体に適用。分散=再発源を可視化した。
**How to apply:** 上記1〜7をマトリクス先行で。実装は台帳の完了定義4点に従う。全文レポートは当セッションのworkflow出力に保存。
