---
name: komahyou-student-drag-move
description: 生徒名の長押しD&D移動・既存executeMoveStudent再利用・開発用教室限定・branch止まりでマージ保留
metadata: 
  node_type: memory
  type: project
  originSessionId: 27d9091a-de55-4323-ac80-0fe04ba5164c
---

ライブ盤面で生徒名を長押し(約250ms)→別の机コマへドラッグ&ドロップで移動する機能。
2026-06-28 実装(v1.5.337)→同日 **全教室展開(v1.5.338)**。`featureRollout: studentDragAndDropMove` は
**all-classrooms**(全教室で有効)。回帰で development-only へ戻さない。
移動中の画面周囲の青枠(`.drag-move-screen-frame`)はパルスさせず一定表示(オーナー要望)。

仕様(オーナーと質問で確定): ライブ盤面のみ / PCマウスのみ(タッチ非対応) / 既存「メニュー→移動」と併存 /
移動先が埋まっていれば入れ替え(現状踏襲) / 集団授業の生徒は対象外 / 出席済み生徒はドラッグ不可 /
Esc・盤面外ドロップでキャンセル / 移動中は画面周囲に色枠(`.drag-move-screen-frame`)。

実装の要(回帰防止・性能):
- 実移動は既存 `executeMoveStudent` を**そのまま再利用**(入れ替え/メモ/出席済み/重複/同位置のブロック踏襲)。
  ドラッグarm時に `selectedStudentId` を立て、ドロップ時に `executeMoveStudent(target...)` を呼ぶだけ。
- BoardGrid は起点通知(`onStudentMouseDown`)とドロップ判定用 `data-cell-id/desk-index/student-index` のみ追加。
  長押し判定・mousemove/mouseup/Esc は親 ScheduleBoardScreen の window リスナ(`handleStudentMouseDown`)。
- 毎フレーム再描画ゼロが鉄則: 追従は既存 [[komahyou-schedule-popup-sync]] とは別の `CursorFollowPreview`(隔離済み)、
  移動先強調は**純CSS `:hover`**(`.slot-adjust-grid-dragging`)、状態更新は開始/終了/確定の数回のみ。
- 開発用教室限定: `featureRollout` に `studentDragAndDropMove`(scope: `development-only`)を追加。全教室昇格はオーナー判断まで保留。

**マージ前提**: 盤面操作系は開発用教室で実機検証→マージのフロー([[komahyou-auto-assign-makeup-with-lecture]])。
Claude は開発用教室にログインできず実機D&D検証不可のため、オーナー検証後にマージする。
ビルド/型/lint(新規エラー0)/全ユニットテスト(回帰テスト追加)は通過済み。
