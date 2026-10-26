---
name: komahyou-qr-submission-notify-closed-pc
description: 閉PC中のQR提出も次回起動時にモーダル通知(v1.5.452)・起動/実行中で通知経路を分割・functions の savedAt 据え置き依存
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d443f59-400e-451d-85cc-f43f9ff1cc39
  modified: 2026-07-21T12:20:14.596Z
---

QR提出通知モーダル(submission-acknowledgement-modal)を「PCを閉じている間に届いた提出も次回コマ表を開いた最初に表示」へ拡張(オーナー要望・v1.5.452本番反映 2026-07-21)。従来は初回スナップショット(isInitial)では一切通知せず閉PC提出を取りこぼしていた。

**非自明な要点(再修正/回帰監視で必須):**
- **既読管理はサーバー側 `notifiedAt`(提出doc)** ・localStorage 不使用(オーナー明示指示)。表示した提出は `markLectureSubmissionsNotified` が `updateDoc({notifiedAt})` の**部分更新**で記録(全上書きにすると getDoc→書込窓で並行再提出を巻き戻す=INV-07)。冪等スキップ+`isForeignClassroomSubmissionDoc` ガード。
- **通知対象の選び方を初回/実行中で分割(App.tsx 購読コールバック):**
  - 起動時(isInitial): `selectStartupSubmissionsToNotify(activeEntries, lastSavedAtRef.current)` = 当該教室 submitted 全件から「`submittedAt > lastSavedAt`(前回保存ウォーターマーク) かつ 未通知」。
  - 実行中(!isInitial): 従来どおり `selectUnnotifiedSubmissions(newlyAppliedEntries)`(室長の手動登録は楽観 countSubmitted で除外=自己通知の回帰防止)。
- **なぜ起動時に newlyAppliedEntries が使えないか(初回実装の重大欠陥・レビュー検出):** Cloud Functions の QR POST が classroomSnapshot へ `countSubmitted:true` を**先行マージ**(functions/src/index.ts:2218)するため、次回起動でロードした snapshot は既に countSubmitted=true → 反映差分に乗らず取りこぼす。→ activeEntries+ウォーターマーク方式へ。
- **⚠️ 回帰監視点:** この検出は「functions の QR提出マージが classroomSnapshot の `savedAt` を**据え置く**(index.ts:2230・now に上げない)」前提に依存。functions が QR提出で savedAt を前進させると、ウォーターマークが提出時刻を追い越し閉PC提出を取りこぼす。
- 二重の氾濫防止: ウォーターマークで過去分の一斉表示を、notifiedAt で再読込の再通知を、それぞれ防ぐ。ウォーターマーク不明(空/不正)は非通知(安全側)。
- **既知の限界(非ブロッカー):** `lastSavedAt` は workspace 共通 savedAt。1教室1端末のマネージャ運用では実質教室固有=無影響。開発者の教室切替時のみ過少通知(モーダル出ない)方向に倒れ得るがデータ反映は別経路で正・氾濫や欠損は無し=安全側。

回帰テスト: selectUnnotifiedSubmissions 4 / selectStartupSubmissionsToNotify 4 / markLectureSubmissionsNotified(updateDoc/冪等/他教室) 3 / subscribe の notifiedAt 伝搬 1。関連: [[komahyou-lecture-submission-survives-rollback]] [[komahyou-submission-board-persistence-asymmetry]] [[komahyou-transient-request-remount-refire]]
