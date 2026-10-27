import type { SlotCell } from './types'

// INV-02（主）/ INV-06（従）・オーナー指示 2026-10-27（確認リスト tp-63 のメモ）:
// 「そもそも休日に生徒はおけない。おけなくて良い。」——休日（休校のコマ＝`isOpenDay === false`。
// 休日設定・定休日のどちらも）には、室長の操作で生徒を置かせない。
//
// なぜ入口で止めるか: 再マージ（overlayBoardWeeksOnScheduleCells の休日分岐＝carryBoardStatusRecordsOntoClosedDayCell・8559c28）は
// 休日のセルへ盤面の授業を**持ち込まない**（出欠記録だけ引き継ぐ）。そのため休日へ置いた生徒はリロード・設定変更の再マージで
// 黙って消える（手動編集が巻き戻る＝INV-02 違反）。移動なら移動元に「移)」記録だけが残り、講習の配置なら台帳の −1 だけが残る（INV-06 誤減）。
// 休日分岐の「持ち込まない」は意図的なガードなので崩さず、置けない場所へ置かせない側で塞ぐ。
//
// 判定の正本は**開校ルールを当てた後のセル**の `isOpenDay`（applyClassroomAvailability / computeWeekAvailability が
// forceOpenDates・closedWeekdays・holidayDates から決める唯一の場所）。盤面の生 weeks の `isOpenDay` は古いことがあるので、
// 呼び出し側は必ず開校ルール適用後のセル（盤面の `cells` / `normalizedWeeks`）を渡すこと。
// 対象外（システム側の処理）: 休日設定・休日解除の席戻し・丸ごと振替・テンプレ差分反映。自動割振・講師の配置は
// 既に `isOpenDay` で休日を飛ばしている（ここを通さない）。日程表（別タブ）の移動は scheduleViewMove の
// resolveScheduleViewTargetSeat と盤面側 executeScheduleViewMove が「移動先は休校日のため移動できません。」で既に止めている。

export const CLOSED_DAY_STUDENT_PLACEMENT_MESSAGE = '休日のコマには生徒を置けません。'
export const CLOSED_DAY_STUDENT_SWAP_MESSAGE = '入れ替えると休日のコマに生徒が入るため、入れ替えできません。'

type AvailabilityCell = Pick<SlotCell, 'isOpenDay'>

// 1 コマへ生徒を新しく置く操作（未消化振替・未消化講習の配置／生徒追加／体験追加）の休日検査。
// 置けないときは上の帯へ出す 1 行を返す。セルが見つからないときは null（呼び出し側の既存の「見つからない」処理に任せる）。
export function resolveClosedDayStudentPlacementBlock(cell: AvailabilityCell | null | undefined): string | null {
  if (!cell) return null
  return cell.isOpenDay ? null : CLOSED_DAY_STUDENT_PLACEMENT_MESSAGE
}

// 生徒の移動（メニューの「移動」・長押しD&D）の休日検査。computeStudentMove と同じ見つけ方
// （全週を先頭から走査して最初に見つかった生徒）で移動元を決める。
//   - 移動先が休日 → 置けない（入れ替えでも同じ）。
//   - 移動先に相手が居る入れ替えで、移動元が休日 → 相手が休日のコマへ入るので止める。
//   - 休日のコマから**出す**だけの移動（入れ替えなし）は通す（過去に置けてしまった生徒を片づける道を塞がない）。
// cells は**開校ルール適用後**の全週ぶんのセル（normalizedWeeks.flat()）。
export function resolveStudentMoveClosedDayBlock(params: {
  cells: SlotCell[]
  movingStudentId: string
  cellId: string
  deskIndex: number
  studentIndex: number
}): string | null {
  const { cells, movingStudentId, cellId, deskIndex, studentIndex } = params
  const targetCell = cells.find((cell) => cell.id === cellId)
  if (!targetCell) return null
  if (!targetCell.isOpenDay) return CLOSED_DAY_STUDENT_PLACEMENT_MESSAGE
  const swapStudent = targetCell.desks[deskIndex]?.lesson?.studentSlots[studentIndex] ?? null
  if (!swapStudent || swapStudent.id === movingStudentId) return null
  const sourceCell = cells.find((cell) => cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student?.id === movingStudentId)))
  if (sourceCell && !sourceCell.isOpenDay) return CLOSED_DAY_STUDENT_SWAP_MESSAGE
  return null
}
