---
name: komahyou-total-review-2026-06-12
description: 2026-06-12トータルレビュー=B3/A2/A1/A3/C1/B2/A4を実装デプロイ済(1.5.305)・残はC2のみ・1教室1端末方針
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ca194bb-2807-40d4-af66-27d09b35bc9c
---

2026-06-12 にオーナーと実施したコマ表アプリのトータルレビュー（データ確実保存・整合性・軽快性）。改修台帳は `docs/review-2026-06-12-total-review.md`。**同セッションで B3/A2/A1/A3/C1/B2/A4 を実装・本番デプロイ完了（1.5.305）。残るは長期課題 C2 のみ。**

**オーナー決定**：「1教室＝1端末」での編集を基本ルールとする（複数端末同時編集は想定しない）。ただしルール違反時に黙ってデータが消えるのは不可＝アプリ側に安全網を必須。

**実装済み（本番反映済み）**：
- A2(1.5.303)：`shouldSyncWorkspaceOnVisibilityHidden`(`src/App.tsx`)。タブを隠した時の無変更ガード。
- A1(1.5.304・最重要)：楽観ロック。サーバー `functions/src/optimisticVersion.ts`(`resolveOptimisticVersionDecision`)＋`saveClassroomSnapshotFromCallable`。クライアントは `src/integrations/firebase/classroomSnapshotVersions.ts` レジストリで版数保持し `baseVersion` 送信。STALE時はバックアップDL＋同期停止＋全画面バナー(`remote-stale-conflict-banner`)。**QR提出のサーバー側マージ(lectureSubmissionApi)は版数据え置き**で管理者保存を誤ブロックしない。functions先行→client段階デプロイ。後方互換(baseVersion未送信なら従来通り)。
- A3(rules)：`firebase/firestore.rules` で classroomSnapshots/Settings/chunks/parts/boardWeeks の create/update を `isDeveloper` に限定。マネージャーは CF経由なので影響なし。
- B3(1.5.303)：QR提出の休日反映・提出済み閲覧・初回通知抑止(`isInitial`)。
- C1(1.5.305)：BoardShare/Developer/Billing/BackupRestore を React.lazy 化(Suspense)。xlsxは既に動的import。
- B2/A4(1.5.305)：死蔵 appSnapshotSync.ts 削除・`cleanupOldSaveAttempts`(毎日JST3:30・30日保持)追加。

**未実装**：C2（低・長期）巨大ファイル（ScheduleBoardScreen 9000行等）を純粋関数から段階的に分割（一括リファクタ禁止・実害が出てから）。

**オーナーに推奨した追加確認**：開発用教室で1回保存して同期成功を確認・別端末で同教室を編集保存してSTALEバナーが出れば正常。

関連：[[komahyou-save-architecture]] [[komahyou-no-regression-rule]] [[komahyou-classroom-restore-cross-contamination]]
