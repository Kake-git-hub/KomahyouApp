// 講師日程表の帰属 × 講師の居ない机の埋め草「講師未割当」（2026-11-07・INV-01・regression-reviewer の指摘）。
// serializeCells（buildTeacherPayload 経由）が机に載せる regularTeacherIds（基本データ行の担当講師）は、机に講師 ID が無いときの帰属先になる
// （buildTeacherAssignments の else-if）。埋め草の机は講師なしの机なので、基本データ行の講師へ帰属させない。
//   (a) 講師 D&D でテンプレの講師 T を講師の居ない行の机へ動かした跡: 元の机は埋め草＋生徒 S のまま → S は T のページに出ない。
//   (b) 兄弟: 本物の講師名だけで講師 ID の無い机は従来どおり基本データの講師へ帰属する／講師の居ない行そのものの生徒は誰のページにも出ない。
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { DeskCell, SlotCell, StudentEntry } from '../components/schedule-board/types'
import { buildTeacherPayload } from './scheduleHtml'
import { buildTeacherAssignments } from './scheduleViewData'

const DATE = '2026-10-07' // 水曜
const SLOT = 5
const PLACEHOLDER = '講師未割当'
const studentRow = (id: string, name: string): StudentRow => ({ id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' })
const teacherRow = (id: string, name: string): TeacherRow => ({ id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] })
const students = [studentRow('sS', '生徒S'), studentRow('sX', '生徒X'), studentRow('sE', '生徒E'), studentRow('sA', '生徒A')]
const teachers = [teacherRow('tT', '講師T'), teacherRow('tD', '講師D')]
const row = (id: string, teacherId: string, student1Id: string): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
})
// 基本データ: S の担当は講師T、X は講師の居ない行、E の担当は講師D、A は講師の居ない行。
const regularLessons = [row('r0', 'tT', 'sS'), row('r1', '', 'sX'), row('r2', 'tD', 'sE'), row('r3', '', 'sA')]
const entry = (id: string): StudentEntry => ({ id: `e_${id}`, name: students.find((student) => student.id === id)!.name, managedStudentId: id, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })
const desk = (index: number, extra: Partial<DeskCell>, studentId: string): DeskCell => ({ id: `${DATE}_${SLOT}_desk_${index + 1}`, teacher: '', lesson: { id: `managed_r${index}_${DATE}`, studentSlots: [entry(studentId), null] }, ...extra })

function assignments(desks: DeskCell[]) {
  const cell: SlotCell = { id: `${DATE}_${SLOT}`, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true, desks }
  const payload = buildTeacherPayload({ cells: [cell], defaultStartDate: DATE, defaultEndDate: DATE, titleLabel: 't', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, teachers, students, regularLessons })
  const map = buildTeacherAssignments(payload.cells)
  const namesFor = (teacher: TeacherRow) => [...new Set([teacher.id, teacher.name].flatMap((key) => (map.get(key) ?? []).flatMap((item) => item.students.map((student) => student.name))))].sort()
  return { tT: namesFor(teachers[0]), tD: namesFor(teachers[1]) }
}

describe('講師日程表の帰属: 埋め草の机の生徒を基本データの担当講師へ帰属させない', () => {
  it('(a) 講師T を講師の居ない行の机（生徒X）へ動かした跡: 元の机（埋め草＋生徒S・固定あり）の S は講師T のページに出ない。講師T のページは X だけ', () => {
    const result = assignments([
      desk(0, { teacher: PLACEHOLDER, manualTeacher: true }, 'sS'),
      desk(1, { teacher: '講師T', manualTeacher: true, teacherAssignmentTeacherId: 'tT' }, 'sX'),
    ])
    expect(result.tT).toEqual(['生徒X'])
  })
  it('(a) 固定の無い埋め草でも同じ（埋め草は講師なし）', () => {
    expect(assignments([desk(0, { teacher: PLACEHOLDER }, 'sS')]).tT).toEqual([])
  })
  it('(b) 兄弟: 本物の講師名だけで講師 ID の無い机（講師D＋生徒E）は従来どおり基本データの講師D へ帰属する', () => {
    expect(assignments([desk(2, { teacher: '講師D' }, 'sE')]).tD).toEqual(['生徒E'])
  })
  it('(b) 兄弟: 講師の居ない行そのもの（埋め草＋生徒A）は誰のページにも出ない（基本データの講師も空・修正の前後で同じ）', () => {
    const result = assignments([desk(3, { teacher: PLACEHOLDER }, 'sA')])
    expect(result).toEqual({ tT: [], tD: [] })
  })
})
