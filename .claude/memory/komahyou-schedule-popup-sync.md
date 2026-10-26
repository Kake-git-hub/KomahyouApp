---
name: komahyou-schedule-popup-sync
description: 生徒/講師日程表ポップアップの同期アーキテクチャと「最新表示」が反映されない罠
metadata: 
  node_type: memory
  type: project
  originSessionId: 78f3bdb4-118f-4ca4-adb5-0641168009c8
---

生徒/講師日程表ポップアップ(別ウィンドウ)への同期の正本は **App.tsx の `syncStudentSchedulePopup` / `syncTeacherSchedulePopup`**(`force=true` の能動パスのみ実行。`boardStateRef.current.weeks` を読む)。コメント上も「これが popup を更新する唯一の能動パス」とされる。トリガは popup→opener の postMessage：`schedule-range-update`(=ポップアップ内「最新表示」ボタン)、`schedule-popup-ready`(初回)、`schedule-refresh-request`(盤面を反映)。

ハマりどころ(2026-06-22 修正・PC/本番で再現):「最新表示」で講習の自動割振結果が反映されない不具合は、App.tsx のハンドラが同期を `ensureScheduleSubmissionTokens()`(Firebase往復・QRトークン確保)の `.then()` でgateしていたのが原因。盤面内容(セル/講習)はトークン非依存なので、**先に同期して即反映 → トークン確保後にQR更新で再同期**する形に修正。

追加修正(2026-06-28・branch `fix/auto-assign-warning-and-popup-sync` 未マージ):「講習自動割振の後、開いていた生徒日程表で『最新表示』を押しても割り振った講習が反映されない(閉じて開き直すと反映)」問題に対処。静的解析では App.tsx(`boardStateRef`)・ScheduleBoardScreen(`normalizedWeeks`)双方とも commitWeeks→onBoardStateChange で**fresh**、`cloneWeeks` は全週新refで WeakMap stale clone も起きず、popup の fingerprint も差分時は必ず再描画 → **コード上はどの経路も新鮮で再現しないはず**。残る非決定要因は popup→opener の postMessage 往復(取りこぼし/レース/`window.opener` 喪失)。Firebase認証がないサンドボックスでは実機再現不可。→ 往復に依存しない対策として **`handleAutoAssignLectureStockEntry` の commitWeeks 直後に `setScheduleSyncTrigger(prev=>prev+1)` を追加**し、board→popup 方向(boardがwindowハンドル直持ち)で1回だけ能動再同期。これで自動割振直後に popup が自動更新され、最新表示の往復不調でも内容が揃う。**効果は要オーナー実機検証(開発用教室)**。

注意点:
- `ScheduleBoardScreen.tsx` にも重複した同期 effect(`scheduleSyncTrigger` 依存・`studentScheduleWindowRef.current` 宛)が残っており、App.tsx 側と二重に同じ popup を更新しうる(レース要因)。App.tsx 払い出しpayloadは `optionFieldEnabled`/`groupClassEntries`/`highlightedStudentSlot`/`scheduleCountAdjustments` を欠き、ScheduleBoardScreen 側payloadと内容が一致しない(rAF dedup で最後勝ち=ScheduleBoardScreen側になりがち)。
- ポップアップ側スクリプトは [[komahyou-schedulehtml-embedded-script]]。`applyIncomingPayload` は `buildPayloadFingerprint` 一致時は再描画せず DATA だけ更新する(同一内容の echo を弾く最適化)。
- 自動同期は `force=false` だと即return(メモリ対策のゲート)。盤面変更しても明示パス(最新表示/盤面を反映/開いた時)以外では popup は更新されない設計。
- ローカルmode(`VITE_EXTERNAL_BACKEND_MODE=local`)では `ensureScheduleSubmissionTokens` は即returnするため本不具合は再現しない(本番=Firebaseモード固有)。ブラウザ自動化ではポップアップがブロックされ再現困難。
