---
name: komahyou-perf-multi-rule-optimization
description: 多ルール×全員の性能最適化の実装内容と非自明な発見（警告useMemoはdeps関数identityで毎レンダー再計算だった）・2026-06-11時点で未コミット
metadata: 
  node_type: memory
  type: project
  originSessionId: 960b0596-304f-4c14-a43b-8180db9dd292
---

多ルール×「全員」対象のパフォーマンス最適化（docs/perf-multi-rule-optimization-handoff.md のタスク）を 2026-06-11 に実装・コミット・デプロイ済み（v1.5.302, commit 1f9a0cb）。

**非自明な発見（引き継ぎ文書に未記載だった真因の一つ）**: `boardStudentWarningsByLocation` useMemo の deps に素の関数 `resolveManagedTeacherForDesk`・`isPairConstraintBlocked` が入っており、毎レンダーで identity が変わるため **useMemo が実質キャッシュ無効＝盤面編集どころか全レンダーで全再計算**だった。useCallback 化で解消。`const cells = normalizedWeeks[weekIndex] ?? []` も範囲外時に毎レンダー新配列で同様の無効化要因（useMemo 化済み）。

**実装した最適化（全て挙動不変・メモ化/インデックスのみ）**:
1. `managedStudentById` Map（`.find` と同じ先勝ち）で O(n²) 解消
2. `isRuleApplicableCached`: (ruleKey|studentId|grade) でメモ化、ルール変更で破棄。モジュールヘルパ `isSubjectCapabilityConstraintApplicable`/`resolveApplicableLessonLimit` には `isApplicable` 注入引数を追加（既定値=従来関数）
3. `resolveRegularTeacherIdsForStudentOnDate`: (schoolYear_dayOfWeek) インデックス＋(studentId|dateKey) キャッシュ
4. `resolveSchoolGradeLabelForDateKey`: (birthDate|dateKey) モジュールレベルキャッシュ
5. `buildStudentOccurrencesByDateIndex`（export・テストあり）: 同日コマ収集を生徒スロット毎の全盤面走査→全盤面1パスのインデックスへ。**走査順(週→セル→デスク→スロット)保存が挙動同一の要件**
6. `findBestLectureAutoAssignCandidate`: `collectStudentAssignedDateKeys` はセル非依存で探索前1回、`collectStudentLessonsOnDate` は日付ごと1回に巻き上げ

**やらなかったこと**: 候補の早期枝刈り（evaluatedCandidateCount がデバッグレポートに出るため挙動が変わる）、警告のデバウンス/差分更新（要オーナー判断）。区分ハード化は [[komahyou-auto-assign-rules-architecture]] のとおり禁止。

検証: テスト288件(既存286+回帰防止2)グリーン・tsc/vite build OK・eslint は既存比で警告7件減（react-refresh エラー+1はテスト用 export の既存パターン）。`makeupStockSnapshot.test.ts.snap` は vitest 実行毎に改行差分が出るので `git checkout --` で戻す（引き継ぎ§4どおり）。実機計測（performance.now・開発用教室）は未実施＝オーナー側で要確認。
