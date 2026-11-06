// 机へ講師を「手で置く」書き込み（ScheduleBoardScreen.tsx から切り出し・2026-11-06 確認リストの「準備する」と共有するため）。
// 講師メニューの「保存」と、確認リストの自動準備（checklistPrep.ts の applyChecklistPrepOps）が同じ 1 本を通る（手で置いた講師の形を分散させない）。
// 中身は切り出し前と同じ（挙動不変）。

import { releaseTeacherRestIfSameTeacherPlaced } from './teacherRest'
import type { TeacherAliasResolver } from './templateDiffApply'
import type { DeskCell } from './types'

export function setManualTeacherAssignment(desk: DeskCell, teacherName: string, teacherId?: string, assignmentSource: 'manual' | 'manual-replaced' = 'manual', teacherAliases?: TeacherAliasResolver) {
  desk.teacher = teacherName
  desk.manualTeacher = true
  desk.teacherAssignmentSource = assignmentSource
  desk.teacherAssignmentSessionId = undefined
  desk.teacherAssignmentTeacherId = teacherId
  // 確認リストの準備で置いた講師の印は、室長が講師を置き直したら外す（後片づけで室長の置いた講師を消さない・INV-02・§E-2-4-2）。
  // 準備の自動処理は、この呼び出しの後で印を付け直す（checklistPrep.ts の applyChecklistPrepOps）。
  delete desk.checklistPrepTeacher
  // §9-19: 休んだ講師本人を手で置き直したら休みを解除する（別の講師なら残す）。呼び名（ID・登録名・表示名）の対応表は D&D と同じ（監査 要確認-6）。
  releaseTeacherRestIfSameTeacherPlaced(desk, teacherAliases)
}

// 講師メニューの「保存」と同じ出自の決め方: 授業の無い机のテンプレ講師を替える＝manual-replaced、それ以外＝manual。
export function resolveManualTeacherAssignmentSource(desk: Pick<DeskCell, 'lesson' | 'teacher' | 'manualTeacher'>): 'manual' | 'manual-replaced' {
  return !desk.lesson && desk.teacher.trim() && !desk.manualTeacher ? 'manual-replaced' : 'manual'
}
