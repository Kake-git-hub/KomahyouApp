---
name: komahyou-lecture-stock-clear-status-wipe
description: 欠席解除(handleClearStudentStatus)が講習デルタ台帳の負値(消費記録)をremoveLectureStockCountの「0以下でキー削除」で丸ごと消す実バグ(2026-07-17・緑が丘 生徒s028 数4回二重計上)・v1.5.447で本番反映済(欠席解除のみreconsumeSessionLectureStockへ・staging実機確認済)・テンプレ上書き分岐Cは誤統一しない(逆に過少計上・Issue#48)・応急処置(生徒s028幽霊4件削除/生徒s079英1コマ追加)は要オーナー実施・生徒s079 英1回分消失は別系統
metadata: 
  node_type: memory
  type: project
  originSessionId: 74d3f6f2-cc2b-4648-b60e-2bad04b1f8f5
---

# 欠席解除による講習ストック台帳の消費記録消滅（2026-07-17）

**状態(2026-07-17 完了)**: **v1.5.447 で本番反映済み**。オーナーが staging 実機で欠席→欠席解除を確認後に main マージ(349bec8)・CI緑・ライブ version.json=1.5.447 照合済み。全ゲート緑(lint0/unit773/build/回帰マトリクス inv06-lecture-stock-reconciliation.matrix.test.ts 4件・fail-before pass-after)・INV監査(regression-reviewer)通過・保証台帳 spec-invariants.md へ違反転記済み。ブランチ `fix/lecture-stock-clear-status-wipe`(e869f07 初版→ ed59959 で範囲訂正→ 4aa1bdc 台帳転記)。**残タスク: 生徒s028/生徒s079の応急処置(下記)はオーナー実施待ち**(コード修正は再発防止のみでデータは直らない)。**重要な訂正**: 修正対象は欠席解除サイト(handleClearStudentStatus)のみ。当初テンプレ上書き(handleSaveRegularLessonTemplate 分岐C)も同関数へ統一したが、INV監査で「あちらは範囲一掃＋均衡復元(board+stock=希望数・起源8436bf5)で意味が異なり -1純減は逆に未消化を過少計上する新規回帰」と判明→分岐Cは元のremoveLectureStockCountへ戻し誤統一防止コメント付与。分岐Cのfreeze境界(凍結前配置が残る場合の過少/過剰)は旧新どちらも未対応で Issue#48 に別課題化。

**症状**: 緑が丘校 生徒s028・2026夏期講習(session_mpdyu73o_086v)。提出=英7/数4。盤面に講習(special)11コマ全配置済みなのに未消化講習に数学4回が幽霊表示（二重計上）。授業消失ではない。

**真因（コード＋実データで確定）**: `ScheduleBoardScreen.tsx` の `handleClearStudentStatus`（欠席解除・9313行付近）が session由来講習の台帳戻しに `removeLectureStockCount`（1093行付近）を使用。このヘルパは「結果0以下でキーごと削除」＝**正の手動繰越専用の規約**で、負値=配置消費を記録するデルタ台帳 `manualLectureStockCounts` に使うと消費履歴ごと消える。実経過: 7/6自動割当で数=-4 → 7/14欠席×2で-2(正常) → 7/16 18時台の欠席解除×2で「-2-1=-3≤0→キー削除」「0-1=-1≤0→削除のまま」→ 消費0。欠席化(`handleMarkStudentAbsent`=+1 append)と非対称。日程表D&D移動・自動割当は台帳非関与で無罪。INV-06(在庫返却WRITEドリフト)ファミリー。

**修正方針**: 欠席解除のsession講習分岐を `appendLectureStockCount(key, -1)`（負値保持）に変更。兄弟監査: `handleSaveRegularLessonTemplate` 4117行付近も absent statusSlots 相殺に同ヘルパ使用=同型潜在バグ。`handleDeleteLecturePendingItem` の manual分岐は正カウント前提で正当。INV完了定義4点(inv06マトリクス新設含む)に従う。

**クリックメニュー横断監査(2026-07-17・v1.5.447公開後)**: 全操作×講習/振替の台帳対称性を精査した結果、**休日化(handleToggleHolidayDate)のstatusSlotsループがstatus種別を見ずに無条件+1する既存バグを検出(Issue #49・s2)**。他は✔(出席/欠席往復=修正済/振無休/移動/格納/パネル操作)。低優先の要確認2件=削除のname:フォールバック非対称・一括削除handleClearStudentsOnDate(=「生徒を空にする」)の在庫非移行(ダイアログ明示=仕様)。テンプレ上書き分岐Cの順序依存過大(T1)はIssue#48へコメント追記。

**Issue #49 修正・完了(v1.5.448・2026-07-18本番反映)**: 休日化の在庫戻しを**status認識**に是正(reconcileHolidayDeskStockReturns へ純関数化)。★重要な教訓: 「statusSlotsは一律で触らない」は**誤り**——mark時の在庫会計がstatusで異なる(handleMarkStudentAbsent=+1戻し済み/handleMarkStudentAttended・handleMarkStudentAbsentNoMakeup=在庫非処理で消化-1のまま/moved=消化は移動先が保持)。一律スキップだとattended/振無休で消化-1が孤児化し**過少計上を新規導入**(1回目コミットa9e883bで実際にやらかし、INV再監査で発覚→41321afで是正)。正解=`HOLIDAY_STOCK_RETURNABLE_STATUSES={attended, absent-no-makeup}`だけ戻す・absent/moved触らない・studentSlots必ず戻す。**一律スキップも一律返却も誤り＝status認識必須**。あわせて講習在庫キーを`resolveLectureStockStudentKey`(managedStudentId最優先→名簿逆引き→name:)へ6+1経路で統一し**改名時のキーズレ**(配置-1と戻し+1が別キーに落ちる)を解消(makeup側resolveBoardStudentStockIdは既にmanagedStudentId優先)。回帰マトリクスinv06-holiday-stock-reconciliation.matrix.test.ts(16件・全status両方向固定+振替origin/dateKey/併存/改名)。生徒s079の英1回減は**オーナー確認で意図的削除と判明・問題なし**。恒久候補「+1側もreturnSessionLectureToStockへ一元化」は未実施。

**横断監査(2026-07-17・全教室)**: 不整合は緑が丘のみ2件。(1)生徒s028 数 diff=+4(上記) (2)**生徒s079 英: 希望6・盤面5・未消化0・台帳-6=1回分がどこにも無い(授業やり忘れリスク・逆方向)**。生徒s079は7/11以前発生でバックアップ間引きにより発生時点追跡不能・欠席status無し・別経路(返却漏れ系)の疑い。日大前(172キー)・薬円台は健全。

**応急処置(教室長操作)**: 生徒s028=未消化パネルで数学の幽霊4件を「削除」(希望数に触れず台帳のみ-4になる実装を確認済み)→保存。生徒s079=英講習1コマを手動追加(台帳非関与)。

**調査手法(再利用可)**: gcloud token+Firestore REST(スナップショットdoc `workspaces/main/classroomSnapshots/{id}` はdataEncoding=gzip-base64をzlibで復号) と Storage 15分毎バックアップ `workspace-auto-backups/main/15min/{JST時刻}.json`(全教室44MB・24h全保持/以降間引き・7日で消える)の時系列比較で「台帳がいつ壊れたか」を15分単位で特定できる。entryId末尾のbase36はDate.now()=作成時刻(操作の同一バースト判定に有効)。スクリプトはprobe-student.cjs/backup-timeline.cjs/audit-all.cjs(スクラッチパッド・使い捨て)。

**Why**: デルタ台帳(負値あり)と正カウント台帳でヘルパの削除規約が異なるのに共用された。
**How to apply**: 講習台帳を減らす操作は必ず appendLectureStockCount(key, -1)。removeLectureStockCount は正の手動繰越の消費専用。修正時は inv06 マトリクスと欠席化⇄解除の往復対称性テストを必ず追加。関連 [[komahyou-inv-code-review-handoff]] [[komahyou-invariant-registry-plan]] [[komahyou-lecture-stock-subject-selection]]
