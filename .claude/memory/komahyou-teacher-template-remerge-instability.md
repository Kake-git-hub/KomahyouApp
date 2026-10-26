---
name: komahyou-teacher-template-remerge-instability
description: 講習期間中、通常授業テンプレの再マージ(mergeManagedWeek)が講習の出勤可否を無視して講師を置き直す構造・日大前2026-07報告・削除tombstoneはv1.5.435で修正済み・「非manual講師が消える」は2026-07-11に前提誤りと確定(仕様確定・INV-02)・赤置き直しはIssue#47・★空き机判定の穴は削除tombstoneと出欠記録の2種(v1.5.471でstatusSlots側も封鎖)・日程表は v1.5.473 で盤面そのまま描画へ(全教室)・prod読取調査は15分毎バックアップJSONが最短
metadata: 
  node_type: memory
  type: project
  originSessionId: b0fcc0f2-e23a-483c-93ce-0c35932701dc
  modified: 2026-08-07T01:00:54.489Z
---

日大前校の室長報告(2026-07-10)「消した講師が更新で赤く戻る／付けた講師が消えて生徒1人だけ残る」の根本原因。

`ScheduleBoardScreen.tsx` の `mergeManagedWeek`(2568〜, 呼出2419)が盤面を開く/更新するたびに通常授業テンプレを盤面へ**再マージ**する。ここが2方向で講師配置を壊す:
- **戻る方向**: テンプレ上の講師を `manualTeacher=false / teacherAssignmentSource=undefined / teacherAssignmentTeacherId=<id>`(=盤面上は `src=-`)で置き直す(2781-2785)。このとき**講習(specialSession)の teacherInputs.unavailableSlots(出勤可否)を一切参照しない**ため、出勤不可(×)の講師が通常コマに置かれ `teacherUnavailableWarning`(赤)になる。消してもテンプレが次の更新で置き直す＝赤く戻る。
- **消える方向**: 2729行で managed lesson 抑止時に `teacher: desk.manualTeacher ? desk.teacher : ''`。**非manualの講師配置は再マージで消える**→非manualで置いた講師が更新後に消え生徒だけ残る。既知の band-aid コメントが 3619/3686 にあるが漏れている。
  **→ 2026-07-11 実地調査で前提誤りと確定(下記「仕様確定」)。**

削除は tombstone 方式: `handleDeleteTeacher`(7305)が teacher=''・manualTeacher=true・`teacherAssignmentSource='deleted'`・`teacherAssignmentTeacherId=<削除した講師名>`を立て、merge 側 `deletedTeacherNameSet`(2756-2774)が**名前一致・セル単位**で再付与を抑止する設計。だが実データ上は消えず戻っているので**永続化に穴**(名前不一致/セル再生成/未保存のいずれか。要repro)。

実データ(本番・読取専用で確認): 講師A(t025)/講師C(t027)は 2026-07-25 全限×提出済なのに 3限/4限に `src=-` の赤で配置(生徒ゼロの講師のみ机)。同じ土曜でも 8/8 は講師A未配置できれい＝状態が不安定に揺れる。reconcile 再付与(countSubmitted×未配置)は今回は主因でない(講師Dのみ該当)。

**読取専用の実データ調査法(最短・2026-08-07 実証)**: Firestore の分割スナップショット(parts/boardWeeks を数十docかき集める)を再組立てするより、**Cloud Storage の 15分毎自動バックアップ JSON を1本落とす**方が圧倒的に速い。`gcloud auth print-access-token` → `https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o?prefix=workspace-auto-backups/main/15min/` で一覧 → `?alt=media` で取得(全教室入りで約54MB・数秒)。中身は `{classrooms:[{id,name,data:{classroomSettings,teachers,students,regularLessons,specialSessions,boardState:{weeks,suppressedRegularLessonOccurrences,...}}}]}` で、`data` をそのまま `buildScheduleCellsForRange` に流せる(=盤面 vs 日程表の差分を実データで再現できる)。`src/__prodprobe.test.ts` のような一時 vitest プローブで実行し**必ず削除**。vitest は console を握るので出力はファイルへ書く(`--reporter=basic` は存在せずエラー)。取得した JSON は生徒氏名を含むので調査後に消す。**旧手順(重いとき用)**: `.env.local`(=prod komahyouapp-prod/workspaceKey=main) を使い、`src/` 配下に `*.test.ts` の一時プローブを置いて `vitest` で実行。`signInToFirebaseWithPassword(email,pw)`→`loadFirebaseWorkspaceSnapshot({authenticatedUserId,createEmptyClassroomPayload})` で教室スナップショットを復号(全decodeを再利用)。書込APIは呼ばない。認証はスクラッチのcredsファイル。**deserializeBoardState後の `weeks` は「セルの配列」**で `week.cells` ではない(`cellsOf = w=>Array.isArray(w)?w:(w.cells||[])`)。使用後プローブは削除(prod叩くのでCommit/CI禁止・projectId assertで誤プロジェクト防止)。

**Why:** 通常授業テンプレ再マージと講習ボード状態が別系統で、手動編集/出勤可否より再マージが勝つ設計。

**修正状況(本番反映済み・v1.5.435・2026-07-11)**: オーナーは「手動編集を常に最優先」を選択(×講師の自動除去は不採用)。真因は**削除tombstoneが2経路で消されていた**こと: (1)`repackTeacherOnlyDesks`が teacher='' の机として tombstone をクリア(commit b8b075f で修正)、(2)`autoAssignTeacherToSpecialSession`(起動毎に `reconcileSubmittedTeacherPlacements` から自動実行)が tombstone を空き机とみなし `setScheduleRegistrationTeacherAssignment` で上書きし source を 'schedule-registration' に(commit 1699788 で修正)。両経路で tombstone(`isDeletedTeacherTombstone`=`!lesson && manualTeacher && source==='deleted'`)を保護。tombstone は save→Firestore(sanitizeForFirestoreはteacher=''/'deleted'を保持・undefinedのみ落とす)→reload を無傷で通過し `mergeManagedWeek` の `deletedTeacherNameSet`(名前一致)/`consumedManagedTeacherIndexes` が再付与を抑止する(多エージェント敵対検証で確認・(2)の穴は検証で発覚し追修正)。回帰テスト計6件(fail-before/pass-after)。**検証**: staging 実機(A: ブラウザで 7/25 3限の赤い講師Aを削除→更新で戻らない・赤 8→7→7)＋保存データ raw 照合(B: source='deleted' tombstone が残り講師Aは復活せず)で二重確認済み。**「講師が消えて生徒だけ残る」逆方向はこの修正の対象外**=merge は manualTeacher/schedule-registration の講師を剥がさないので、再発するなら別系統(teacherAutoAssignRequest 再マウント再発火 [[komahyou-transient-request-remount-refire]] か removeAutoAssignedTeacherFromSpecialSession、あるいは基本データで担当講師を外したテンプレ行)→ 具体コマを取得して別調査。任意hardening(未実施)=sanitizeForFirestore往復のtombstone保持テスト/deskCount縮小時のtombstone保護。

**仕様確定(2026-07-11・INV-02・正本=docs/spec-invariants.md)**: 「消える方向」は実地調査で**前提誤り**と確定。(a) ユーザーが講師を置く全経路(講師セル選択/削除/生徒移動ピン/講師D&D/QR講習自動割当)は manualTeacher=true で記録され日常の自動処理で不可侵=「非manualでユーザーが置いた講師」は存在しない。(b) mergeManagedWeek に「講師だけ消え生徒が残る」を起こす分岐は無い(lesson保持分岐は teacher を維持・クリア分岐は lesson も落とす)。非manual=テンプレ足場講師のみで、**テンプレ追従(基本データ編集で変わる/消える)が確定仕様**(オーナー確定・コード無変更)。マトリクス inv02 の旧it.todoは仕様ロックテストへ置換済み。残る実害=「戻る方向」(出勤不可テンプレ講師の赤置き直し)は Issue #47 で別課題化(実装前に懸案+妥協案の擦り合わせ要)。

**「空き机」判定の第2の穴＝出欠記録のある机(v1.5.471・2026-08-07・INV-01)**: `lesson` が無くても `statusSlots` に出欠実績が入った机は**空き机ではない**。`mergeManagedWeek` の再付与ループがこれを空き机とみなし、テンプレ足場講師で `teacher` を上書きしていた(記録は机に残るので、元講師のコマは講師日程表で空白／テンプレ講師のページに他人の生徒。報告=緑が丘 8/6 4限 講師E→講師F。本番実測 日大前12/緑が丘3 → 修正後0)。`hasRecordedStatusSlots` を追加し、`consumedManagedTeacherIndexes`・`targetDesk` 選定に加え、**兄弟監査で盤面側の同型ルート**(`repackTeacherOnlyDesks` の詰め直し／`autoAssignTeacherToSpecialSession` の `emptyDeskCount`・`candidateDesk`)も同時に塞いだ。★**盤面は自分の state をそのまま描くが、生徒/講師日程表は `buildScheduleCellsForRange` で作り直す**ため、「盤面にあるのに日程表に無い」系はまずこの再マージを疑う(`mergeManagedWeek` の呼出元は overlay 経路のみ)。

**構造対策=日程表を盤面そのままで描く(v1.5.473で全教室・2026-08-07 オーナー確定)**: 「必ず盤面と日程表がそろうように」の指示で、`buildScheduleCellsForRange` に `boardOnly` を追加し、段階導入フラグ `featureRollout.boardOnlyScheduleCells`(all-classrooms)で切替。true ならテンプレ再マージをせず盤面をクローンして返すだけ。★成立の根拠=日程表へ渡す盤面は呼び出し側の `ensureWeeksCoverDateRange` が**未生成週をテンプレから生成済み**なので、再マージを外しても未来週は空白にならない(テンプレの二度読みだった)。★有効時の唯一の体感差=基本データを直しても盤面を開いて反映するまで日程表に出ない。呼び出しは計8箇所(ScheduleBoardScreen 5・App.tsx 3)で**全部に `boardOnly` を通すこと**(1つ漏れると経路で表示が食い違う)。**昇格済み(v1.5.472 開発用教室先行 → v1.5.473 全教室)。フラグを development-only へ戻さないこと**(戻すと「盤面にあるのに日程表に無い」が再発)。旧経路(overlayBoardWeeksOnScheduleCells/mergeManagedWeek)はロールバック用に温存し挙動を INV-01 マトリクス操作7で固定。「テンプレにだけ残る通常授業が日程表に湧く」件は**盤面が正**でオーナー裁定(2026-08-07・実測1件=日大前 8/6 5限 講師H・生徒R)。★ensureWeeksCoverDateRange は**盤面が空だと何も生成しない**(既存週を前後に伸ばすだけ)ので、この前提を語るときは「盤面は最低1週持っている」ことが条件。

**How to apply:** 机を「空き」とみなす判定を新設したら、必ず `isDeletedTeacherTombstone`(削除記録)と `hasRecordedStatusSlots`(出欠記録)の**両方**で除外する(repack/autoAssign/mergeManagedWeek と同規律)。id ベース tombstone 化は不可(`buildTeacherSelectionOptions` 1932 が id を「割当済み」扱いし削除講師が他机の選択肢から消える回帰)。バグ修正には回帰テスト必須。関連 [[komahyou-transient-request-remount-refire]] [[komahyou-regular-teachers-only-board-source]] [[komahyou-no-regression-rule]] [[komahyou-tests-required-for-changes]]
