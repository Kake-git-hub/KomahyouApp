# テスト方針（2026-06 見直し・E2E廃止と代替）

> オーナー判断（2026-06-29）：Playwright E2E は現状の費用対効果が低いため廃止する。
> ただし **「段階移植してから削除」**＝価値ある挙動をユニット等へ移してカバレッジ欠落を作らずに退役する。
> このファイルが移植の進捗台帳。完了したら E2E を削除する。

## なぜ E2E を廃止するか（評価の根拠）

- **本番critical未カバー**: E2E は `VITE_EXTERNAL_BACKEND_MODE=local` で動き、Firebase 保存/復元・教室クロス汚染・QR/Functions 提出という**一番怖い経路を一切検証していない**。緑でも本番安全を意味しない。
- **日常の安全網になっていない**: e2e は `ci-tests.yml` で **手動(workflow_dispatch)のみ**。毎push ゲートは unit/build だけ。
- **flaky＋陳腐化**: headless で約18件が不安定・約18分。`schedule-board.spec.ts` 以外は 2026-04〜05 で更新停止。
- **重複**: モデルロジックの大半は既にユニットで担保済み（下表）。E2E は同じ事をUI経由で再テストしているだけ。

実際にこのアプリで痛かった回帰（`mergeManagedDeskLesson` 巻き戻り / scheduleHtml エスケープ崩れ / 保存の版数競合 / 講師保持）は**すべてユニットが守る領域**だった。

## 代替テスト構成（E2Eの置き換え）

| 層 | 手段 | 守る対象 | 実行 |
|---|---|---|---|
| 1. ロジック単体（主ゲート） | vitest(node)。盤面操作を純粋関数に切り出してテスト | UI操作の回帰（move/swap/status/undo 等） | 毎push必須・約1分・決定的 |
| 2. Firebase エミュレータ統合（少数） | `firebase emulators:exec` ＋ node/vitest | 保存→復元で席一致／actingClassroom以外に書かない／QR提出反映 | リリース前・手動 |
| 3. staging DOM 駆動チェック（人＝Claude） | 実deployに対しJSでクリック発火＋セル内容を文字確認＋最後に1枚 | 実環境の通し動作 | 変更/新機能の主要フローのみ |
| 4. build + tsc 型チェック | 既存 | コンパイル健全性 | 毎push |

## E2E 移植マップ（disposition）

凡例：**[済]**=既にユニットで担保（E2E削除でOK） / **[移]**=ユニット新規が必要 / **[捨]**=低価値UI機構なので破棄。

### A. 盤面操作 orchestration（`schedule-board.spec.ts`の核） — ここが唯一の真の移植対象
`executeMoveStudent`/swap/status 遷移を純粋関数（例 `boardMutations.ts` の `moveStudentInWeeks(weeks, source, target)`）へ抽出し、以下を再現するユニットを追加する。

- [移] 15 7日表示維持で生徒を正確に移動 → 移動結果の weeks 検証
- [移] 16 選択生徒を次週へまたいで移動
- [移] 17 元に戻す/やり直し（undo/redo スタック）
- [移] 25 通常授業を同日移動すると通常のまま元授業ヒントを残さない
- [移] 27 増コマを同日移動しても通常にならない
- [移] 28 / 51 振替を元授業日へ戻すと通常扱いになる
- [移] 34 休みマスへ別生徒を移動しても前の休み日付を引き継がない（既知回帰・memory `komahyou-move-date-inheritance`）
- [移] 10 講師を削除/生徒0でも盤面状態（講師名）を保持（v1.5.349 のマージ層テストは追加済み。操作層も追加）
- [移] 70 / 71 同コマに同生徒がいると振替/移動不可で状態維持
- [移] 33 休みにすると盤面へ薄字＋生徒日程表の休み欄
- [移] 41 / 42 出席にすると薄字、画面遷移後も維持（status の永続）

### B. 既にユニットで担保済み → E2E削除でOK（重複）
- [済] 警告: 35 科目対応外赤 / 36,37 一コマ空け / 55,56 講習の絶対制約 → **インライン判定を純粋関数へ抽出してユニット化済み**（`canTeacherHandleStudentSubject`=35 / `resolveLessonPatternWarnings`=36,37 / `isLectureOutsideSessionPeriod`=55 / `isStudentUnavailableAtSlot`=56）＋ 既存 `shouldWarnForbiddenPeriod` `shouldWarnRegularTeachersOnly`
- [済] 振替/講習ストック: 21,32,39,43〜62,72 → `makeupStock.test.ts`(1244行) / `lectureStockSnapshot` / `resolveSelectedMakeupOrigin` / `buildMakeupAutoAssignPendingItems`
- [済] 日程導出: 48〜52,67〜69,73 → `buildScheduleCellsForRange マージ` / `buildStudentOccurrencesByDateIndex`
- [済] 基本データ CRUD: `basic-data-management.spec.ts` 全 → `basicDataModel` / `BasicDataScreen` / `basicDataImportValidation`
- [済] 特別講習 CRUD: `special-sessions.spec.ts` 全 → `specialSessionModel` / `SpecialSessionScreen`
- [済] 自動割振/ペア制約: `auto-assign-rules.spec.ts` 全 → `autoAssignRuleModel` / `pairConstraint`
- [済] テンプレ: `template-mode.spec.ts` の追加/編集/削除/上書き → `regularLessonTemplate` ＋ ScheduleBoard「テンプレ移動→上書き regression」
- [済] 保存/復元/初期設定: `backup-restore.spec.ts` → `appSnapshotRepository` / `saveClassroomSnapshotVersion` / `boardSnapshot`（ただし **実Firebaseの保存往復は層2エミュレータで別途担保**）

### C. 低価値UI機構 → 破棄（移植不要）
- [捨] 画面遷移/メニュー開閉: 1,9,11,13,14,31, `screen-navigation.spec.ts` 全
- [捨] メモ入力UI: 18,19,20,40
- [捨] ツールチップ/マウス追従プレビュー/パネル開閉: 22,23,24,30,38,84
- [捨] 日程ポップアップのUI操作: 74〜82,85,86（同期ロジックの核は scheduleHtml/occurrences ユニットで担保。UI操作自体は staging で随時確認）
- [捨] 認証フロー: `firebase-auth.spec.ts`（ログイン/権限は層2 or staging。ロジックは `billing`/`developmentClassroom` ユニット）

## 退役の段取り

1. **層1の抽出＋移植**（A群）。`executeMoveStudent` 等を純粋 reducer に切り出し、A群シナリオをユニット化。回帰防止ルール厳守（挙動不変リファクタ＋移植テストが旧挙動を再現）。
2. **層2エミュレータ統合**を数件追加（保存→復元席一致 / 教室分離 / QR反映）。
3. **B/C群の最終確認**（[済]の関数存在をスポット確認）。
4. ここまで緑になったら **E2E一式を削除**：`tests/`・`playwright.config.ts`・`playwright.firebase.config.ts`・`@playwright/test`・`test:e2e*` スクリプト・`ci-tests.yml` の e2e ジョブ2つ。
5. **記述更新**：`CLAUDE.md`（テストゲート節）・`.claude/skills/safe-release`・`docs/runbooks/release-checklist.md` の「e2e を回す」を本方針へ差し替え。

## 現在地

- [x] 方針確定・移植マップ作成（本ファイル）
- [x] 層1: 盤面操作 reducer 抽出＋A群移植 **（完了・v1.5.350 本番反映済）**
  - [x] `executeMoveStudent` の移動ロジックを純粋関数 `computeStudentMove` へ挙動不変で抽出（executeMoveStudent は委譲）。staging で同日移動(講師保持)・入れ替えを実機スモーク確認。
  - [x] A群移植（`computeStudentMove`の7テスト）: 基本移動 / 講師保持(manual固定) / 同日移動は通常のまま移動済みを残さない / 別日移動は移動済み＋移動先日付を残す / 同コマ重複ブロック(70,71) / 同一位置取りやめ / 滞留ステータス除去(34) / 入れ替え(swap)
  - [x] 残A群は**既存ユニットで担保済み**（新規不要）: 増コマ同日→通常にならない(27)=`prepareStudentForMove`「keeps extra lessons as extra」 / 振替を元日へ戻すと通常(28,51)=`normalizeLessonPlacement`「same-day return as regular」 / undo/redo(17)=`appendHistoryEntry`スタックテスト / 出席の永続(41,42)=`packSortCellDesks` と managed merge が `attended`/`statusSlots` を保持するテスト
- [x] 層2: Firestore セキュリティルールの分離テスト **（完了・2b スコープ）**
  - `firebase/rules/firestore.rules.test.ts`(13件)を `@firebase/rules-unit-testing` ＋ Firestore エミュレータで実行。コマンド `npm run test:rules`(firestore エミュレータ起動下)。
  - 検証内容: 教室アクセス分離(担当外教室は読めない=クロス汚染の入口を塞ぐ) / 保存の裏口防止(マネージャーは classroomSnapshots を直書きできない=CF経由のみ) / members 権限台帳の保護(他人の member doc 不可・権限昇格不可) / billing は billing開発者のみ。
  - 通常 `test:unit`(src/functions のみ)には含めない＝**毎push CI はエミュレータ不要のまま**。リリース前 or 手動で `test:rules`。
  - 範囲外(2a): 保存→復元の往復・QR提出のフル統合は未自動化。保存/復元の純粋ロジックは既存ユニット、実往復は staging DOM 確認で担保。
- [x] B/C 最終確認 **（完了）**: B群は既存ユニットで担保、唯一の隙間だった「盤面の警告評価(35/36/37/55/56)」も純粋関数へ抽出してユニット化(+15)。C群は破棄でOK。**全E2E挙動の移植が完了**。
- [x] E2E 削除＋ドキュメント更新 **（完了）**: `tests/`・`playwright.config.ts`・`playwright.firebase.config.ts`・`playwright.live-save-debug.config.ts`・`@playwright/test`・`test:e2e*` スクリプトを削除。`ci-tests.yml` は e2e ジョブ2つを削除し、代わりに手動の `rules` ジョブを追加。`CLAUDE.md`/`.claude/agents/dev-fix.md`/`safe-release`スキル/`release-checklist.md`/`.vscode/tasks.json` を新方針へ差し替え。

## 完了サマリ（2026-06-29）

Playwright E2E（9 spec・約148ケース）を廃止し、全挙動をユニット（純粋関数）へ移植完了。
- **層1**: 移動ロジック `computeStudentMove` 抽出＋盤面移動/警告評価をユニット化（+22）。
- **層2**: Firestore ルールの教室分離テスト 13件（`npm run test:rules`・エミュレータ）。
- 現状の自動テスト: ユニット **425件**（毎push・約1分）＋ ルール13件（手動）。E2E 由来の重複・flaky・陳腐化を解消。
- 実環境の通し動作は staging 実機確認（Claude の DOM 駆動チェック）で担保。
