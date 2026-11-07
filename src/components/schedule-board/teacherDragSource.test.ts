// 講師欄の D&D の起点（2026-11-07・regression-reviewer の指摘 1）。講師の居ない行の机の埋め草「講師未割当」は講師ではないが、
// 埋め草の机に生徒・出欠記録・メモがあれば「生徒ごと席入替」で中身を動かせる（埋め草の修正の前からできた操作・巻き戻さない）。
// 埋め草だけで中身の無い机は動かすものが無いのでドラッグを始めない。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DeskCell, StudentEntry } from './types'
import { canStartTeacherDrag, hasDeskSeatContent } from './teacherDragSource'

const student = { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry
const desk = (extra: Partial<DeskCell>): DeskCell => ({ id: 'd', teacher: '', ...extra })

describe('canStartTeacherDrag / hasDeskSeatContent', () => {
  it('本物の講師の机は中身が無くても掴める（従来どおり）', () => {
    expect(canStartTeacherDrag(desk({ teacher: '講師A' }))).toBe(true)
  })
  it('埋め草の机は、生徒・出欠記録・メモのどれかがあるときだけ掴める（生徒ごと席入替のため）', () => {
    expect(canStartTeacherDrag(desk({ teacher: '講師未割当', lesson: { id: 'l', studentSlots: [student, null] } }))).toBe(true)
    expect(canStartTeacherDrag(desk({ teacher: '講師未割当', statusSlots: [{ ...student, status: 'absent' } as never, null] }))).toBe(true)
    expect(canStartTeacherDrag(desk({ teacher: '講師未割当', memoSlots: ['メモ', null] }))).toBe(true)
    expect(canStartTeacherDrag(desk({ teacher: '講師未割当' }))).toBe(false)
    expect(canStartTeacherDrag(desk({ teacher: '講師未割当', memoSlots: ['  ', null], lesson: { id: 'l', studentSlots: [null, null] } }))).toBe(false)
  })
  it('講師欄が空の机は従来どおり掴めない', () => {
    expect(canStartTeacherDrag(desk({ lesson: { id: 'l', studentSlots: [student, null] } }))).toBe(false)
    expect(hasDeskSeatContent(desk({ lesson: { id: 'l', studentSlots: [student, null] } }))).toBe(true)
  })
  it('配線: コマ表の講師欄（BoardGrid）はこの関数でドラッグの起点を決める', () => {
    const grid = readFileSync(new URL('./BoardGrid.tsx', import.meta.url), 'utf8')
    expect(grid).toContain('Boolean(cell.isOpenDay && canStartTeacherDrag(desk))')
    expect(grid).not.toContain('Boolean(cell.isOpenDay && desk.teacher.trim()), event.button')
  })
})
