// 机へ講師を手で置く書き込み（deskTeacherAssignment.ts）のテスト。
// 確認リストの「準備する」で置いた講師の印（checklistPrepTeacher・§E-2-4-2）は、室長が講師メニューで講師を替えたら外れる
// （後片づけで室長の置いた講師を消さない・INV-02）。
import { describe, expect, it } from 'vitest'

import { resolveManualTeacherAssignmentSource, setManualTeacherAssignment } from './deskTeacherAssignment'
import type { DeskCell } from './types'

describe('setManualTeacherAssignment', () => {
  it('手で置いた講師の形（manual・ID つき・講習 ID は外す）', () => {
    const desk: DeskCell = { id: 'd1', teacher: '講師A', teacherAssignmentSessionId: 'ss1' }
    setManualTeacherAssignment({ desks: [desk] }, desk, '講師B', 't2')
    expect(desk).toEqual({ id: 'd1', teacher: '講師B', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentSessionId: undefined, teacherAssignmentTeacherId: 't2' })
  })

  it('準備の印の付いた机に講師を置き直すと印が外れる（あとで手で替えた講師は後片づけで消さない）', () => {
    const desk: DeskCell = { id: 'd1', teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true }
    setManualTeacherAssignment({ desks: [desk] }, desk, '講師E', 't5', resolveManualTeacherAssignmentSource(desk))
    expect(desk.checklistPrepTeacher).toBeUndefined()
    expect('checklistPrepTeacher' in desk).toBe(false)
    expect(desk).toMatchObject({ teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't5' })
  })
})
