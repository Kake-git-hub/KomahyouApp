// 講師欄の D&D の起点と「席に動かす中身があるか」（2026-11-07・regression-reviewer の指摘 1）。
// 講師の居ない行の机の埋め草「講師未割当」は講師ではない（utils/deskTeacherLabel.ts の hasRealDeskTeacher）が、埋め草の机に生徒・出欠記録・
// メモがあれば「生徒ごと席入替」（computeTeacherMove の swapMode='seat'）で中身を動かせる（埋め草の修正の前からできた操作・巻き戻さない）。
// 埋め草だけで中身の無い机は動かすものが無いのでドラッグを始めない。講師欄が空の机は従来どおり掴めない。
import type { DeskCell } from './types'
import { hasRealDeskTeacher } from '../../utils/deskTeacherLabel'

/** 席入替で動く中身（生徒・出欠記録・メモ）があるか。computeTeacherMove の席入替が移す項目（lesson / statusSlots / memoSlots）と同じ範囲。 */
export function hasDeskSeatContent(desk: Pick<DeskCell, 'lesson' | 'statusSlots' | 'memoSlots'> | null | undefined): boolean {
  if (!desk) return false
  if (desk.lesson?.studentSlots.some((slot) => slot != null)) return true
  if (desk.statusSlots?.some((slot) => slot != null)) return true
  return Boolean(desk.memoSlots?.some((memo) => typeof memo === 'string' && memo.trim() !== ''))
}

/** 講師欄の長押しで D&D を始めてよいか。本物の講師の机、または埋め草の机で席に中身があるときだけ。 */
export function canStartTeacherDrag(desk: Pick<DeskCell, 'teacher' | 'lesson' | 'statusSlots' | 'memoSlots'>): boolean {
  if (hasRealDeskTeacher(desk.teacher)) return true
  return desk.teacher.trim() !== '' && hasDeskSeatContent(desk)
}
