---
name: komahyou-move-date-inheritance
description: コマ表の生徒移動で移動先スロットに前生徒の移)日付が滞留すると新生徒に引き継がれる不具合の修正点
metadata: 
  node_type: memory
  type: project
  originSessionId: 14476a67-d799-4575-98b9-bfb3a9fb475c
---

コマ表画面で生徒を移動した先のスロットに、前に移動した生徒の「移動元表示(status='moved')」=移)日付ステータスが滞留していると、上書きしたはずの新しい生徒がその移動日付を引き継いで表示される不具合（2026-06-15 修正）。

原因は2層:
1. データ: `executeMoveStudent`（ScheduleBoardScreen.tsx）が移動先スロットへ生徒を置いた後、そのスロットの `statusSlots` をクリアしていなかった。→ 置いた直後に `setDeskStudentStatus(targetDesk, studentIndex, null)`、swap時は source 側も同様にクリア。
2. 表示: BoardGrid の `moveDestinationDateLabel`/`linkedDestinationDateLabel` が studentName の有無に関わらず statusEntry から算出していた。→ `lessonLinks.ts` の `resolveVisibleSlotDateLabel` に抽出し、実在生徒(hasStudent)がいるスロットでは status 由来の移動日付を出さない（本人の makeupSourceDate のみ）。

回帰防止テスト: `lessonLinks.test.ts`（hasStudent=true + moved status で空文字を期待）。[[komahyou-no-regression-rule]] のとおり修正なしで落ちる構成。
