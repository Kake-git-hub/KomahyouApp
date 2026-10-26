---
name: komahyou-manager-self-restore
description: 室長の自教室サーバーバックアップ復元(v1.5.548→549・**v1.5.556 で全教室昇格 2026-09-22**)の確定設計(確認モーダル方式・直近3日)と Undo の教室照合
metadata: 
  node_type: memory
  type: project
  originSessionId: 24665bbc-ab27-404d-bfb0-1c6f33b4cbd3
  modified: 2026-09-18T12:16:25.495Z
---

室長が 15分毎のサーバーバックアップから**自教室だけ**を復元できる入口(バックアップ/復元画面)。v1.5.548(2026-09-18)で main へ反映。
フラグ `managerSelfRestore` = development-only → **v1.5.556(2026-09-22)で all-classrooms へ昇格**(確認リスト s-1〜s-3 OK・オーナー指示「機能問題ないので本番へ展開して」・functions/ルール無変更)。仕様正本は `docs/spec-save-restore.md` §4-1(2026-06-10 の「室長への開放は見送り」を改定)。

**v1.5.549 でオーナーが同日改定**: (1) パスワード再認証は廃止 → 画面中央の大きな確認モーダル(alertdialog・幅760px)。(2) モーダルに「復元しても戻らないもの」を必ず表示し、内部語は画面の呼び名へ(授業台帳→生徒日程表の「通常授業履歴」に出る記録／操作ログ→操作の記録。内部語混入はテストで禁止)。(3) 対象は直近7日→**3日**。(4) 開発者の入口が開発者画面と二重になるのは**了承済み**(昇格時の再確認は不要)。
実装は `prepareOwnClassroomRestore`(取得→確認待ち state・画面は書き換えない)＋`confirmOwnClassroomRestore`(確定時に再ガード・backup-restore 画面以外からは不可)の2段。確認待ちデータは Undo と同じ3経路(openClassroom/applyWorkspaceSnapshot/logout)で破棄。

当初のオーナー確定(2026-09-18・AskUserQuestion。★パスワードと7日は上記で上書き済み):
- 画面へ読込 → 室長の「保存」で確定(サーバーへ直接書く復元関数は**作らない**)。保存前は Undo で取り消せる。
- パスワード = ログインパスワード再認証(`reauthenticateFirebaseUser`)。権限境界ではなく誤操作・第三者操作の防止。
- 対象 = 直近7日(画面側の制限。サーバーは絞らない)。それより前は開発者へ依頼。
- 公開 = 開発用教室 → 全教室の段階公開。

実装の要点:
- 権威は `src/components/backup-restore/managerSelfRestore.ts`(3者一致ガード `resolveManagerSelfRestoreGuard`・応答の教室ID照合 `isRestoreSourceForClassroom`・`replaceClassroomData`)。
- App.tsx `prepareOwnClassroomRestore` / `confirmOwnClassroomRestore`(v1.5.548 の旧名 restoreOwnClassroomFromServerBackup は廃止)は**教室IDを引数に取らない**(復元元も先も actingClassroomId)。字面は `managerSelfRestore.wiring.test.ts` で固定。
- Cloud Functions / Firestore ルールは無変更(`downloadClassroomFromServerAutoBackup` は元から担当教室のみ許可、`workspaceAutoBackupSummaries` はメンバー read 可)。= functions デプロイ不要。
- 自教室復元なので共有トークンは剥がさない(剥がすのは他教室→検証用教室コピーだけ)。

同時に塞いだ既存の穴(INV-08): Undo スナップショットが `openClassroom` で破棄されず、別教室の盤面で「直前の状態に戻す」を押すと前の教室のデータが入った(8316830 / v1.5.300 の塞ぎ残し)。
`src/utils/classroomScopedUndo.ts` で取得元の教室IDを照合＋openClassroom でも破棄。regression-reviewer が発見。[[komahyou-classroom-restore-cross-contamination]]

**Why:** 復元は 2026-06-06 に教室取り違え事故を起こした最重要の慎重操作。Undo を安全弁に据える設計なので、Undo 自体の教室越えを先に塞ぐ必要があった。

**How to apply:**
- 確認リスト s-1〜s-3 は OK(2026-09-22)。全教室昇格済み。残る確認は s-4(本番教室にも復元パネルが出る・**見るだけ**・本番で「この時点へ復元」は押さない)。
- 本番教室で復元を確定するのは室長/オーナーの操作。Claude は本番教室で復元を実行しない(本番データ保護ルール)。
- オーナーは**利用者向けの文言に内部用語(台帳・ログ等)を出すのを嫌う**。画面に出す言葉はアプリ上のボタン名・画面名に合わせる。
- 復元で戻らないもの: QR講習提出・保護者連絡・操作ログ・授業台帳。boardShareToken と名簿は巻き戻る(再発行済みURLのズレ・提出の孤児化表示に注意)。[[komahyou-lecture-submission-survives-rollback]] [[komahyou-deleted-student-orphan-lecture-stock]]
- ブラウザ検証は dev-local だとパネルが出ない(リモート無効・本番ログインは Claude には不可)。モーダルの見た目だけなら dev-local のページへ同じクラスのマークアップを注入して CSS を確認できる(1366x768 でスクロール無しに収まることを確認済み)。通しの実機確認はオーナー側。
