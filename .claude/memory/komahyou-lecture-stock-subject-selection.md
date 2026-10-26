---
name: komahyou-lecture-stock-subject-selection
description: 未消化講習の手動配置が選択科目を無視し先頭科目を置く既存バグ(中3 数学→英語)・v1.5.364で修正
metadata: 
  node_type: memory
  type: project
  originSessionId: fb7ebdf1-1563-42c4-9c7e-5d66561a1bf6
---

未消化**講習**(lecture stock)の手動配置は、長らく `buildLecturePendingItems(entry)[0]`(＝先頭科目)を無条件に配置しており、モーダルで科目を選んでも先頭科目が置かれていた。中3など複数の講習科目を持つ生徒で「数学を選ぶと英語が置かれる」不具合(2026-07-03 講師K報告)。1科目しか無い生徒では [0] が正解のため学年により顕在化。

**原因:** 振替(makeup)側は `selectedMakeupStockRawKey` で選択科目を尊重する(モーダルが `rawKey: item.rawEntryKey` を渡す)のに対し、講習側モーダルは `item` を渡さず選択科目の記憶が無かった。2026-03-20(b31d6a0)/06-15(2c10f65)由来の**既存バグ**で、直近デプロイ(v1.5.361〜363)とは無関係。

**修正(v1.5.364):** 選択キー state `selectedLectureStockItemKey`(subject+sessionId)を追加。モーダルクリックで item を渡し、配置時に純粋関数 `resolveSelectedLecturePlacementItem(pendingItems, selectedKey)`([lectureStockPlacement.ts](../../../../Desktop/自作ソフト/コマ表アプリ/src/components/schedule-board/lectureStockPlacement.ts))で解決。未選択/不一致は先頭へ安全フォールバック。回帰テスト付き。

**教訓:** バグ報告の切り分けはデプロイ時刻とライブ版数の照合から(今回は報告18:00 > デプロイ19:44 で当該デプロイ無関係を即断定)。振替と講習は似て非なる別経路——片方の修正はもう片方に自動適用されない。関連: [[komahyou-auto-assign-rules-architecture]] / [[komahyou-occupied-origin-and-suppressed-makeup]]
