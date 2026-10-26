---
name: komahyou-auto-assign-rules-architecture
description: コマ表⑧自動割振ルールの区分は全てソフト(スコア+警告)・絶対事項だけハード・適用はtargets依存
metadata: 
  node_type: memory
  type: project
  originSessionId: 26464665-3fdf-4fa1-b483-5cbeadd60b26
---

コマ表アプリ ⑧自動割振ルール（`AutoAssignRuleScreen.tsx` / `autoAssignRuleModel.ts` / 割振本体は `ScheduleBoardScreen.tsx`）の非自明な実装事実。

- **⚠️2026-07-04以降「制約事項」はハードフィルタ（この行より下の「全ソフト」記述は歴史）**：v1.5.395 で「制約事項」区分はソフト（強い減点＋赤字警告）から**ハードフィルタ（候補列挙段階で違反候補を完全除外→置ける候補が無ければ未消化在庫に残す）**へ転換した（B案・Issue #44）。純関数 `shouldExcludeAutoAssignCandidateByConstraint`（`ScheduleBoardScreen.tsx`）を `findBestAutoAssignCandidate` のスコア構築**直前**に `continue` で挿入。制約を選べるのは6ルール（コマ数上限3種・科目対応講師のみ・通常講師のみ・指定時限禁止）＝`constraintCapableRuleKeys` から `diversifySubjects`(科目分散)を外した。優先事項・ルール未設定(targets空)は完全不変（ゴールデン維持）。常時ソフト次元「絶対事項合計」(`buildForcedConstraintScoreParts`)は**廃止せず存続**（制約に設定しないときの「なるべく避ける」挙動を保つ）。⇒ ハード除外は「絶対事項」3つ＋「制約事項に設定されたルール」。詳細は `docs/spec-auto-assign-rules.md` §B（新旧併記）。
- **ルールの適用可否は `targets`（＋対象）依存**：`isAutoAssignRuleApplicable` は `targets.length===0` なら不適用。区分(category)ではなく対象設定で効く/効かないが決まる。
- **時限スコアは `buildCommonAutoAssignScoreParts`（lecture/makeup 共通）** の `group.key==='time-preference'` 分岐。ルール未設定時の既定は「遅い時限優先 [5,4,3,2,1]」。
- **2つのグループ定義が別物**：UI＝`AutoAssignRuleScreen` の `ruleGroupDefinitions`、アルゴリズム＝`ScheduleBoardScreen` の `lectureConstraintGroupDefinitions`。UIグループを増やしてもアルゴリズムは別管理（forbidFirstPeriod/subjectCapable/regularTeachers は `buildForcedConstraintScoreParts` で常時スコア化）。

**2026-07-04 オーナー方針転換（2026-06-11「全ソフト維持」を正式上書き・v1.5.395）**：
- 旧方針(2026-06-11)＝制約事項はハード化しない・全ソフト維持（理由＝ハードだと候補が無いときコマが空く）。**この方針は撤回した**。
- 新方針(2026-07-04)＝制約事項をハードフィルタ化（上記⚠️行）。運用哲学が「違反して埋まるより、未消化に残って気づけるほうがよい」へ転換したため。**巻き戻しではなく意図的な方針転換**（regression-reviewer もこの新旧併記をもって意図的変更と判断する）。`docs/spec-auto-assign-rules.md` §B に新旧併記。
- 検討したが**採らなかった案(A案)**＝区分を3値化し「絶対事項」区分を新設して opt-in ハード化。用語衝突（既存「絶対事項合計」ラベル）と実装量・3段階の説明コストで廃案。B案（既存の制約事項の意味を変える）を採用。
- ⚠️**リリース前監査が必須**：デプロイ即座に既存の制約設定の挙動がソフト→ハードへ変わる。反映前に本番各教室の autoAssignRules を読み取り専用(REST GET・gzip-base64 の compressedData を展開)で洗い出し「category が constraint に解決され targets 非空」のルールを確認する。日大前=指定時限禁止×全員×[1,2,4,5]（3限のみ許可）はオーナー確認済でそのまま反映した。
- 旧「2限寄り/5限寄り」教室の自動移行＝対象教室ゼロで該当なし（クローズ）。

**新ルールをキーごと追加するときの必須手当（2026-07-04「科目分散 diversifySubjects」追加で確立）**：
- 保存済み教室データの rules 配列には新キーが**存在しない**。読込時補完 `backfillMissingAutoAssignRules`（`autoAssignRuleModel.ts`・`App.tsx` の `sanitizeAutoAssignRules` から呼ぶ・末尾=優先順位最下位へ追加・冪等）を通さないと UI に出ず優先順位付けもできない。
- `resolveLectureConstraintGroupOrder`（ScheduleBoardScreen）は `findIndex` なので、配列にキーが無いと **-1=最上位に化ける**ガードを入れてある（missing→最下位）。消さない。
- 追加箇所は4点セット：モデル（key/定義/許可リスト）・アルゴリズム（`lectureConstraintGroupDefinitions`+`buildCommonAutoAssignScoreParts` 分岐+盤面警告）・UI（`ruleGroupDefinitions`+Excel説明文）・読込補完。スコア次元が増えても**ルール未設定なら全候補0で順位不変**（講習ゴールデンで担保）。
- 科目分散の警告は**非通常(regular以外)の占有コマだけ**に出す（通常授業は固定配置＝指定時限禁止と同じ扱い）。判定の隣接相手には通常授業も含む。

**2026-06-10 Phase6⑧ TODO1/TODO2 実装時のオーナー確定（[[komahyou-save-architecture]] とは別領域）**：
- TODO1 区分(category)＝**ソフト維持**（制約事項をハードフィルタ化しない＝本番割振結果を変えない）。区分の役割は UIセクション分け・赤字警告ラベル・Excel「分類」・許可リスト編集に限定。
- 既定区分は現状維持（指定時限禁止/科目対応/通常講師=制約、コマ数上限=優先）。許可リストは spec C 準拠固定。
- 詳細・残課題は `docs/spec-auto-assign-rules.md` の実装状況。**⑧ TODO5/4/3/2/1 は PR #24 でマージ・本番デプロイ済（v1.5.292・2026-06-10）**。Phase6 の残は ②保存クラウド一本化本体（未着手・最高リスク [[komahyou-classroom-restore-cross-contamination]]）のみ。
