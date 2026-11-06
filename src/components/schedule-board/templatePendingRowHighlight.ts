// 保留（2 行・緑）の机で「押した行だけ」に選択中の枠を付ける（オーナー指示 2026-11-06・確認リスト tp-64 受付 20261105-234609713
// 「上の行クリック時は誰もハイライトされず、下の行クリック時は両方ハイライトされてしまっています。クリックしている行だけハイライトして。」）。
// 回帰防止: v1.5.689 は 2026-11-05 のフリーメモ「上段クリック時は上段が…、下段も同様に…ハイライト」を「上段と下段の両方」と読み違え、
// 保留メニューの state をそのまま盤面へ渡して同じ席の上段・下段の両方に枠を付けていた（上段の生徒メニューでは枠が出なかった）。
// どの行に枠を付けるかはこの純関数だけで決める（盤面 BoardGrid の openedPendingSeat・DOM に触らない）。
// ★枠は盤面画面だけ（盤面 PDF は stripTemplatePendingLowerForPdf が上段の印を外し、下段は丸ごと外す＝INV-13）。

/** 保留メニューを開いたときに押した行（上段＝テンプレ／下段＝手入力）と席。 */
export type TemplatePendingPressedRow = { row: 'upper' | 'lower'; seatIndex: number }

/** 盤面で選択中の枠を付ける行。seat＝席の上段（.sa-student-inner）か下段（.sa-pending-lower）。teacher-lower＝講師欄の下段（手置き講師）。 */
export type OpenedPendingRowHighlight =
  | { kind: 'seat'; cellId: string; deskId: string; seatIndex: number; row: 'upper' | 'lower' }
  | { kind: 'teacher-lower'; cellId: string; deskId: string }

export function resolveOpenedPendingRowHighlight(params: {
  isTemplateMode: boolean
  /**
   * 保留メニュー（ScheduleBoardScreen の templatePendingDeskMenu）。target='teacher' は講師欄の 2 択（講師欄の下段を押した）。
   * pressed は席のメニューを開いた経路が入れる押した行（下段・帯＝lower／上段の空席・「保留を片づける」＝upper）。
   */
  pendingDeskMenu: { cellId: string; deskId: string; target?: 'teacher'; pressed?: TemplatePendingPressedRow } | null
  /** 生徒メニューが保留の席の上段の生徒を対象に開いているとき、その席（menuStudentOnTemplatePendingDesk）。 */
  studentMenuPendingUpperSeat: { cellId: string; deskId: string; seatIndex: number } | null
}): OpenedPendingRowHighlight | null {
  if (params.isTemplateMode) return null
  const menu = params.pendingDeskMenu
  if (menu) {
    if (menu.target === 'teacher') return { kind: 'teacher-lower', cellId: menu.cellId, deskId: menu.deskId }
    // 押した行が分からないときは枠を付けない（違う行を光らせない）。
    if (!menu.pressed) return null
    return { kind: 'seat', cellId: menu.cellId, deskId: menu.deskId, seatIndex: menu.pressed.seatIndex, row: menu.pressed.row }
  }
  const upper = params.studentMenuPendingUpperSeat
  if (upper) return { kind: 'seat', cellId: upper.cellId, deskId: upper.deskId, seatIndex: upper.seatIndex, row: 'upper' }
  return null
}
