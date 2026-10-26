---
name: komahyou-transient-request-remount-refire
description: "一過性コマンド(unassign等)を永続stateに載せ重複ガードを再マウントで消えるローカルrefに置くと盤面key再マウントで再発火する構造・Issue#46をv1.5.406で消費方式修正"
metadata: 
  node_type: memory
  type: project
  originSessionId: aeb67707-7eb0-4855-9a8b-afbc2947d417
---

盤面(ScheduleBoardScreen)は `key={boardMountKey}` で教室ロード/画面遷移のたびに**再マウント**され、コンポーネントローカルな `useRef` の重複ガードが毎回 null にリセットされる。一過性コマンド(1回だけ実行すべきイベント)を App 側の**永続 state に載せたまま null 化しない**と、再マウント後にガードが消えて古いコマンドが「新規」として**再発火**する。

**実例 Issue #46 (v1.5.406 で修正)**: 登録解除の `studentScheduleRequest`(mode:'unassign')が処理後もクリアされず、`processedStudentScheduleRequestIdRef`(ローカル ref)だけが再マウントで消えていた。結果、登録解除→再登録→再割振後に画面遷移すると組み直した講習コマが未消化へ戻る(ローカルモードでも100%再現=フロント状態管理のバグ、サーバー同期レースとは別系統)。

**修正パターン(踏襲すること)**: 処理側が処理を終えたらコールバックで App の一過性 state を**消費済み(null)にする**。判定を純関数化(`shouldProcessStudentScheduleRequest` / `consumeStudentScheduleRequest`、`ScheduleBoardScreen.tsx`)。消費は「処理した requestId が現在の state と一致するときだけ」= 処理〜クリアの間に届いた新リクエストを取りこぼさない。セッション/生徒ロード後にのみ消費(未ロード取りこぼしも解消)。回帰テストはマウント→再マウントのライフサイクルを純関数で再現し「修正なし=複数回処理 / 修正あり=1回」で固定。

**同型経路 `teacherAutoAssignRequest`(assign/unassign)も修正済み(2026-07-09・v1.5.421)**: 同じ「null化されない state + 再マウントで消えるローカル ref」構造で、緑が丘 8/4 講習の講師(講師I/講師J等)が削除操作なしに盤面から消える本番障害として顕在化。古い unassign(登録解除)が盤面再マウントごとに再発火して講師を再削除していた。studentScheduleRequest と同じ規律で修正 = `shouldProcessTeacherAutoAssignRequest`/`consumeTeacherAutoAssignRequest`(純関数)＋処理後に App 側 state を消費(null)＋データ未ロード中は消費しない。assign は起動時 `reconcileSubmittedTeacherPlacements` が countSubmitted=true の未配置講師を自己修復するため再発火に頼らず配置維持。回帰テスト8件(マウント→再マウントで 修正なし=3回/修正あり=1回)。この構造の一過性 prop はもう残っていないはず(新規追加時は同規律を必ず適用)。

**Why:** 一過性イベントを宣言的な永続 state に載せる設計が穴。ガードだけを再マウント transient に置くと守れない。
**How to apply:** ワンショットのリクエスト prop を追加/変更するときは「処理後に必ず消費(null)」「判定を純関数化して再マウント再発火のテストを付ける」。関連 [[komahyou-lecture-stock-subject-selection]] [[komahyou-no-regression-rule]] [[komahyou-tests-required-for-changes]]
