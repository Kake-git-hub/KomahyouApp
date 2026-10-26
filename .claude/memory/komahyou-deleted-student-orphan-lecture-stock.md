---
name: komahyou-deleted-student-orphan-lecture-stock
description: 講習提出済みの生徒を名簿から削除するとstudentInputsが孤児化し講習一覧に生ID表示・削除ガードは本番反映済(v1.5.433)
metadata: 
  node_type: memory
  type: project
  originSessionId: f5650cbf-3be7-4a69-ae6f-3971e19ff4c5
---

2026-07-08、スクールIE日大前校の講習一覧に生徒表示名でない `s091`/`s129` が出た件の原因と対策。

**原因（読み取り確認済み）**: `s091`・`s129` はアプリ自動採番の本物の生徒ID（`BasicDataScreen.tsx` の `student: prefix 's' padding 3` → s001/s091/s129）。この2名を **15:10→16:27 のバックアップ間でオーナーが名簿から削除**したが、2026夏期講習の提出(`specialSessions[].studentInputs['s091'/'s129']`, countSubmitted)が残存し孤児化。`lectureStock.ts` の表示名解決が `studentMap.get(id)` 失敗時に**生IDへフォールバック**するため生ID表示（学年ラベルも付かないのが目印）。s091は入塾2025-04-08・通常授業2件・盤面226箇所を持つ在籍中の生徒で誤削除濃厚→**15:10(T15)バックアップから教室単位で復元**推奨（復元は生徒s135 等15:10以降の変更も巻き戻る点に注意）。関連: [[komahyou-submission-board-persistence-asymmetry]] [[komahyou-lecture-submission-survives-rollback]]

**恒久対策（本番反映済 v1.5.433・2026-07-10）**: 当初 `fix/basic-data-delete-guards` に実装したが**main へマージし忘れていた**（staging デプロイも別セッションに上書きされ、オーナーが「モーダルが出ない」と気付いて発覚）。最新 main(v1.5.432)へ追従マージ(衝突は両側保持=講師D&D computeTeacherMove 等を残す)→ main マージ→本番デプロイ済。基本データの生徒/講師削除を確認モーダル化。①不可逆警告 ②退塾日で非表示にできる案内(手動isHiddenは復活させない=[[komahyou-no-regression-rule]]・spec-basic-data.md §B/§C現行維持をオーナー確定) ③未消化の講習/振替が残る生徒への残数警告(盤面が算出→App経由 `onDeletionStockSummaryChange`) ④本番はログインアカウント再認証(`reauthenticateFirebaseUser`・教室削除と同じ)。純ロジックは `deleteGuard.ts`＋回帰テスト `deleteGuard.test.ts`。**次工程: safe-releaseでstaging実機確認→mainマージ(大変更のため自動マージ対象外)**。パスワード種別・非表示方針はAskUserQuestionでオーナー確定済(ログイン中アカウント/退塾日維持)。
