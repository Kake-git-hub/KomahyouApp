---
name: komahyou-teacher-schedule-regular-teacher-ids
description: 講師日程表の講師帰属はregularTeacherIds(基本データ行の講師ID)フォールバック — 同コマ内で生徒を別講師へ移動すると旧講師のページにも二重表示されたバグ(v1.5.388で修正済み)の機構
metadata: 
  node_type: memory
  type: project
  originSessionId: aba30d92-d2bd-43c3-bbf8-c6e437d9bae9
  modified: 2026-07-21T13:27:04.780Z
---

講師日程表ポップアップは各机を講師ページへ帰属させるとき、`buildTeacherAssignments`（scheduleHtml.ts 内クライアントJS）で
「机の `teacherId` があればそれ、無ければ `regularTeacherIds`（基本データ通常授業行の担当講師ID）、加えて常に机の講師名」をキーにする。

- `regularTeacherIds` は v1.5.247（commit 5395a05, 2026-05-30）で導入。目的は「机の講師名が旧表示名などでマスタと照合できない場合でも、テンプレの担当講師の日程に生徒を載せる」こと。0dd3712（2026-06-03）で「teacherId があるときは regularTeacherIds を使わない」に修正済み。
- 穴: **同コマ（同じ日付＋時限）内で生徒を別講師の机へ移動**すると、(1) 移動レッスンは `moved_*` ID で managed でないため `mergeManagedWeek`（ScheduleBoardScreen.tsx 2504-2515 付近）が非 manual 机の `teacherAssignmentTeacherId` を undefined にクリアし、(2) 生徒は同日移動なので `lessonType: 'regular'` のまま（`sameDayMoveSourceDate` 付き）で、`resolveRegularTeacherIds`（scheduleHtml.ts createBasePayload 内）が基本データ行（日・時限・生徒・科目一致）から**旧講師のID**を返す。結果、机の帰属キーが `[旧講師ID, 新講師名]` になり**旧講師・新講師の両ページに同じ生徒が二重表示**される（2026-07-04 ユーザー報告を再現確認済み）。

**Why:** 別日への移動は makeup 化＋抑止キーで守られているが、同コマ内の講師変更だけは行(日・時限)がテンプレと一致し続けるため regularTeacherIds が旧講師を指し続ける。

**How to apply:** **v1.5.388（commit 81d5202, 2026-07-04）で修正済み**: `resolveRegularTeacherIds` で `sameDayMoveSourceDate === cell.dateKey || makeupSourceDate === cell.dateKey`（盤面移動で当該コマに配置された生徒）を除外。5395a05 の旧表示名ケースは移動マーカーを持たないので挙動不変。回帰テスト2件あり（scheduleHtml.test.ts のペイロード単体＋ScheduleBoardScreen.test.ts の移動→マージ→ペイロード端到端）。この除外ガードを後のリファクタで消さないこと。merge 側（mergeManagedWeek の ID クリア）を触るのは回帰リスク大なので不採用だった。なお盤面移動はコマ単位の操作なので、講師交代を将来分へ反映するには基本データの担当講師変更が正道（盤面週の範囲外の日付は今もテンプレどおり旧講師に出る）。関連: [[komahyou-schedule-popup-sync]] [[komahyou-no-regression-rule]]

**✅ 再発ケース(講師D&D入れ替え swap)は v1.5.436(2026-07-11)で修正済み**: 同じ二重表示が**講師のD&D入れ替え(swap)**でも起きていた。開発用教室 8/25 5限で 講師A↔講師B を入れ替えると講師日程で生徒が両講師に出る。原因は v1.5.388 と同型だが**ガードが効かなかった**: `computeTeacherMove`(ScheduleBoardScreen.tsx ~3704)は机の講師ブロック6フィールドを交換し manualTeacher=true にするが、入れ替えた講師が**テンプレ配置で teacherAssignmentTeacherId を持たない**と、swap後も teacherId=undefined のまま。serializeCells(scheduleHtml.ts:364-367)は teacherId=undefined + regularTeacherIds を出し、buildTeacherAssignments は teacherId 不在→regularTeacherIds 採用。swap では**生徒が動かない**ので sameDayMoveSourceDate ガード(scheduleHtml.ts:514)が発火せず、resolveRegularTeacherIds が生徒の基本データ担当講師(=旧講師 講師A)を返す→机は[旧講師id(regularTeacherIds)+新講師名]で両ページ表示していた。

**採用した修正(最有力案どおり)**: `computeTeacherMove` に `teachers?: TeacherRow[]`(optional・default `[]`)を追加し、swap/移動後に新ヘルパー `backfillDeskTeacherAssignmentId(desk, teachers)` で**着地した机の講師名→id を解決して teacherAssignmentTeacherId を補完**(照合式は盤面の `resolveTeacherIdForDesk`(:6379)/`resolveManagedTeacherForDesk`(:5006)と同一=`getTeacherDisplayName(t)===desk.teacher || t.name===desk.teacher`)。teacherId が入れば serializeCells が teacherId を出し、buildTeacherAssignments の**else-if で regularTeacherIds は無視**される。**既に id を持つ机は上書きしない**(手動割当の正しい id を壊さない)/**マスタ照合不可の旧表示名は補完しない**ので 5395a05(旧表示名フォールバック)は不変。caller(handleTeacherMouseDown ~8698)に `teachers` を渡す。この補完は「机が本当にその講師を持つ」表現なので盤面の警告/退塾判定(id経路と名前フォールバックが同一講師へ解決)にも副作用なし(regression-reviewer 検証済)。**代替案(buildTeacherAssignments 側で名前解決ガード=TS+埋め込みJSの両方修正)は採らなかった**(書き出しの脆い埋め込みJSを2箇所触るより、write側1箇所で局所化する方が安全)。

**回帰テスト3件(いずれも修正前に落ち・修正後に通ることを実証済)**: ①computeTeacherMove がテンプレ講師swapで着地机に id を補完(ScheduleBoardScreen.test.ts)②照合不可の旧表示名は id補完せずフォールバック維持(同・5395a05 ガード)③swap→openTeacherScheduleHtml書き出し→buildTeacherAssignments/collectTeacherAssignmentEntries 端到端で「生徒が新講師にだけ出て旧講師には出ない」(scheduleHtml.test.ts・v1.5.388 と対称)。**このガード(id補完/フォールバック除外/端到端)を後のリファクタで消さないこと。** 【更新 2026-07-21】講師D&D(`teacherDragAndDropMove`)は commit `a265008`(2026-07-09)で **development-only→all-classrooms に昇格済み**＝本番全教室で有効(featureRollout.ts で `scope: 'all-classrooms'` を確認)。以前この欄にあった「本番は teacherDragMoveEnabled=false で未到達」は昇格前の記述で**現状と不一致(訂正)**。なお v1.5.453(2026-07-21)で講師名D&Dに「講師だけ入替/席まるごと入替」の選択モーダルを追加(生徒が絡むときのみ表示・`computeTeacherMove` の `swapMode`)、v1.5.454 でボタンを左右・同色化。席入替は講師と生徒のペアを保ったまま席(desk.id)を交換し、INV-01(帰属一意)はマトリクスで担保。関連: [[komahyou-schedulehtml-embedded-script]]
