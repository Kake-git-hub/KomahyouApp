// 【INV-08 教室分離】「直前の状態に戻す」(一段 Undo スナップショット)は、取った教室にしか戻してはいけない。
//
// 違反履歴: 8316830 / v1.5.300(undoSnapshot 残存)・2026-06-13(同系統の再発)。当時の修正は
// applyWorkspaceSnapshot と logout で破棄するだけで、教室を開き直す openClassroom では破棄していなかった。
// そのため「A 教室で復元 → Undo を押さずに B 教室を開く → B の盤面に A の Undo バナーが出る → 押すと B に A の
// データが入り、保存で B が上書きされる」経路が残っていた(2026-09-18・室長の自教室復元の追加レビューで発見)。
//
// 対策は二重: (1) スナップショットに取得元の教室IDを持たせ、戻すときにここで照合する(権威)。
//             (2) openClassroom でも破棄する(バナーを残さない)。
export function canApplyUndoSnapshotToClassroom(params: {
  undoClassroomId: string | null | undefined
  actingClassroomId: string | null | undefined
}): boolean {
  const undoClassroomId = (params.undoClassroomId ?? '').trim()
  const actingClassroomId = (params.actingClassroomId ?? '').trim()
  // 教室IDを持たない(= ローカル単一教室モード)同士は同一とみなす。片方だけ空なら出所不明なので戻さない。
  return undoClassroomId === actingClassroomId
}
