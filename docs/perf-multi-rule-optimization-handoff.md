# 引き継ぎ（専用）：多ルール×「全員」対象のパフォーマンス最適化

> このファイルは「自動割振ルールを多数の教室が実運用し始め、盤面操作が重くなったとき」に着手する**単一タスク専用**の引き継ぎ。
> 着手前に必ず `CLAUDE.md`（回帰防止・本番データ保護）と `docs/spec-auto-assign-rules.md`（区分は全ソフト維持で確定）を読むこと。

## 0. 目的・スコープ
- **目的**：自動割振ルールに「全員」対象を複数設定した教室で、盤面の警告再計算と自動割振が重い（実機で**数十秒ブロック**した）問題を、**割振結果・警告表示を一切変えずに**高速化する。
- **やらないこと**：割振ロジックの仕様変更（区分のハード化等）。**挙動は完全不変**が絶対条件（純粋な性能最適化＝メモ化/データ構造改善のみ）。
- **発火条件**：実運用で多ルール×全員の教室が出て体感が悪化したら着手。出ていなければ不要。

## 1. 症状・再現・計測
- 実機事例（2026-06-10・開発用教室・既配置222マス）：6ルールに「全員」対象を設定 → 盤面の警告再計算＋1講習（6コマ/5597候補）の自動割振で操作が数十秒ブロック。
- **再現**：開発用教室 `v8OZ7zH8vONNHjjYVcR1`（書込検証はここのみ）で、`AutoAssignRuleScreen` から複数ルールに対象「全員」を設定 → 盤面で講習自動割振を実行。
- **計測**：`performance.now()` で下記2か所を別々に計測（警告 useMemo と 割振実行）。最適化前後で「結果が同一（差分なし）」かつ「時間短縮」を確認。

## 2. ホットパス（具体）

### A. 盤面の警告再計算（最有力・まずここ）
`src/components/schedule-board/ScheduleBoardScreen.tsx` の **`boardStudentWarningsByLocation` useMemo（L4822〜4949）**。
全セル × デスク × 生徒スロットを三重ループし、生徒1人ごとに以下を実行する。deps に `cells` を含むため**盤面編集のたび全再計算**。

ループ内の重い処理：
- **L4853 `students.find((entry) => entry.id === student.managedStudentId)`** … 生徒スロット毎に**全生徒線形探索 ＝ O(セル×デスク×生徒×生徒) の O(n²)**。**最優先で潰す**。
- **L4855-4857 `resolveSchoolGradeLabel(birthDate, parseDateKey(cell.dateKey))`** … 生徒×日付ごとに学齢計算。
- **L4876 `resolveRegularTeacherIdsForStudentOnDate(id, cell.dateKey)`（定義 L4059）** … 呼ぶ毎に**全 `regularLessons` 走査**（緑が丘は768件）。生徒×日付ごとに繰り返す。
- **`isAutoAssignRuleApplicable(rule, studentId, grade)`（定義 L294）** を各ルールキーで複数回（L4866/4871/4875/4881/4889/4898…）。中で `rule.targets`/`excludeTargets` を `matchesAutoAssignTarget` で走査。**「全員」ターゲットならセルに依らず生徒ごとに同結果**。
- `resolveManagedTeacherForDesk(desk, dateKey)`（L3984）をデスク×日付ごとに。

### B. 自動割振の実行（候補評価）
`buildCommonAutoAssignScoreParts`（L4109）/ `buildForcedConstraintScoreParts`（L313 付近）/ 候補生成・スコア比較（`compareScoreVectors` L304）。1講習で数千候補×各ルール評価。A と同じ `isAutoAssignRuleApplicable` / 講師解決を候補ごとに呼ぶ。

## 3. 最適化案（優先順・すべて挙動不変）
1. **`students` を `Map<id, StudentRow>` 化**（既存 `managedStudentByRegisteredName` の隣に `managedStudentById` を用意し、L4853 の `.find` を `.get` に）。**O(n²)→O(n)**。最小工数・最大効果。**まずこれだけで再計測**。
2. **`isAutoAssignRuleApplicable` の結果を `(ruleKey, studentId)` でメモ化**：警告ループ／割振の頭で `Map<studentId, {subjectCapable, forbidFirstPeriod, regularTeachersOnly, lessonLimitKey, …}>` を1回だけ構築して参照。全員ターゲットはセル非依存なので生徒数ぶんの計算で済む（セル×生徒×ルールが生徒×ルールに）。
3. **`(studentId, dateKey)` のキャッシュ**：`resolveRegularTeacherIdsForStudentOnDate` と学齢 `resolveSchoolGradeLabel` を `Map<\`${studentId}_${dateKey}\`, …>` でメモ化（または事前に regularLessons を `Map<\`${schoolYear}_${dayOfWeek}_${studentId}\`, Set<teacherId>>` へインデックス化して O(1) 参照）。
4. **割振候補評価（B）**：2/3 のキャッシュを候補ループでも共有。明らかに不可能な候補の早期枝刈り（絶対事項違反は候補生成段で除外）。
5. **最後の手段（大改修・要オーナー判断）**：警告 useMemo を「編集セル周辺だけ差分更新」or デバウンス（操作中は粗く・確定後に精緻化）。挙動・表示が変わりうるので慎重に。1〜3で足りるなら不要。

## 4. 厳守・検証
- **挙動完全不変が絶対条件**。割振結果・警告の「文言/ハイライト/位置」が1ピクセルも変わらないこと。
  - `npm run test:unit`（286件）グリーン維持。`__snapshots__/*.snap`（ゴールデン）は**変えない**（変わったら挙動が変わった証拠＝バグ）。`makeupStockSnapshot.test.ts.snap` は改行差分が出たら `git checkout --` で戻す。
  - 可能なら最適化前後で同一入力（開発用教室の実データ）に対し警告Map・割振結果が**完全一致**するスナップショット/ハッシュ比較を一時的に追加して担保。
- **本番3教室は読み取り専用**。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
- **回帰防止**：既存ロジック書換前に `git log -L`/`git blame` で意図確認。区分=全ソフトの確定方針（`spec-auto-assign-rules.md` B節）を崩さない。
- メモリ：`komahyou-auto-assign-rules-architecture.md`（区分の実装事実・2つのグループ定義が別物）。

## 5. 完了の定義
- 多ルール×全員でも盤面操作・割振が体感スムーズ（目安：警告再計算が編集ごとに数百ms以内）。
- 割振結果・警告表示が最適化前と完全一致。テスト286件グリーン・型/ビルドOK。
- デプロイ手順は `docs/SESSION-HANDOFF.md` §4（version上げ→push→`npm run deploy:firebase`。Functions変更なし想定なので `:with-functions` 不要）。**コミット/デプロイはオーナー指示後**。

---

## 6. 次セッション用プロンプト（コピペ用）

> 多ルール教室が出て盤面が重くなったときに、下の「===」以降をそのまま新しいチャットに貼る。

===

コマ表アプリ（本番稼働中・複数教室）の**自動割振パフォーマンス最適化**だけをやります。まず `docs/perf-multi-rule-optimization-handoff.md` を全部読んでから着手して。続いて `CLAUDE.md`（回帰防止・本番データ保護）と `docs/spec-auto-assign-rules.md` のB節（区分は全ソフト維持で確定＝**ハード化しない**）も確認。

## タスク
ルールに「全員」対象を複数設定した教室で盤面操作・自動割振が重い（実機で数十秒ブロック）。**割振結果・警告表示を一切変えずに**高速化する純粋な性能最適化（メモ化／データ構造改善のみ）。挙動変更は禁止。

## まず見るホットパス（ScheduleBoardScreen.tsx）
- `boardStudentWarningsByLocation` useMemo（L4822〜4949・deps に `cells`＝盤面編集毎に全再計算）。
  - **L4853 `students.find(...)` が O(n²)** ＝最優先。`Map<id,student>` 化で潰す。
  - L4876 `resolveRegularTeacherIdsForStudentOnDate`（定義 L4059）は呼ぶ毎に全 `regularLessons` 走査。`(studentId,dateKey)` でメモ化 or 事前インデックス化。
  - `isAutoAssignRuleApplicable`（定義 L294）を各ルール×生徒×セルで多重呼び。「全員」はセル非依存なので `(ruleKey,studentId)` でメモ化。
  - 学齢 `resolveSchoolGradeLabel` も `(studentId,dateKey)` でキャッシュ。
- 割振本体：`buildCommonAutoAssignScoreParts`（L4109）/ `buildForcedConstraintScoreParts`/候補スコア評価でも同じキャッシュを共有。

## 進め方
1. `students` Map 化（L4853）→ **まず再計測**（これだけで効くことが多い）。
2. 足りなければ (ruleKey,studentId)・(studentId,dateKey) のメモ化を追加。
3. それでも重ければ割振候補評価の枝刈り。警告のデバウンス/差分更新は大改修なので最後＆要オーナー判断。

## 厳守
- **挙動完全不変**が絶対条件。警告の文言/ハイライト/位置、割振結果が変わらないこと。`npm run test:unit`（286件）グリーン維持、`__snapshots__/*.snap` は変えない（変わったら挙動が変わった証拠）。`makeupStockSnapshot.test.ts.snap` の改行差分は `git checkout --` で戻す。
- 最適化前後で同一入力（開発用教室の実データ）の警告Map・割振結果が**完全一致**することをハッシュ/スナップショットで一時的に担保すると安全。
- 本番3教室は読み取り専用。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。回帰防止（`git log -L`/`git blame` で意図確認）。コミット/デプロイはオーナー指示後。
- 参考メモリ：`komahyou-auto-assign-rules-architecture.md`。

===
