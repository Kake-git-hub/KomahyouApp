// 退塾取消(オーナー確定 2026-11-05・docs/spec-basic-data.md §H)の盤面側の保証。
//
//   - 戻るもの: テンプレ由来の通常授業(退塾中は stripWithdrawnStudentsFromBoardWeek が剥がしているだけ ＝ 在籍に戻れば
//     再マージで戻る)と、未消化の振替・講習の残数(台帳に残っていて excludeWithdrawnStudentStockEntries が隠しているだけ)。
//   - 戻らないもの: 退塾スイープが消した今日以降の手置きのコマ・出欠記録(消した内容は results.removedLessons で受け取り、
//     App が名簿行へ残して取消の確認画面に出す)。
// 保証(docs/spec-invariants.md): INV-06(取消で未消化が湧きも減りもしない＝台帳は退塾の前後で同じ)・INV-02(手置きのコマを勝手に戻さない)。
import { describe, expect, it } from 'vitest'
import { initialStudents, initialTeachers, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import { applyStudentWithdrawCancel, applyStudentWithdrawToday, appendStudentWithdrawSweepRemovedLessons, buildStudentWithdrawCancelConfirmation } from '../basic-data/withdrawGuard'
import type { ClassroomSettings } from '../../types/appState'
import { excludeWithdrawnStudentStockEntries } from './lectureStock'
import { applyStudentWithdrawSweepToBoard, buildManagedScheduleCellsForRange, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import type { SlotCell, StudentEntry } from './types'

const MON = '2026-09-21' // 今日(退塾ボタンを押した日)
const TUE = '2026-09-22' // 通常授業の日
const settings: ClassroomSettings = { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 6 }
const teacher: TeacherRow = { ...initialTeachers[0]!, id: 'teacher-a', name: '講師 太郎', displayName: '講師A', entryDate: '2026-04-01', withdrawDate: '未定' }
const studentBase: StudentRow = { ...initialStudents[0]!, id: 'sW', name: '生徒 W', displayName: '生徒W', entryDate: '2026-04-01', withdrawDate: '', birthDate: '2012-05-01' }
const regular: RegularLessonRow = {
  id: 'regular-w', schoolYear: 2026, teacherId: 'teacher-a', student1Id: 'sW', subject1: '数',
  startDate: '2026-04-01', endDate: '未定', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
  nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 2, slotNumber: 5,
}
const resolveStockId = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

function buildWeek(students: StudentRow[]): SlotCell[] {
  return buildManagedScheduleCellsForRange({
    range: { startDate: MON, endDate: '2026-09-26', periodValue: '' },
    fallbackStartDate: MON,
    fallbackEndDate: '2026-09-26',
    classroomSettings: settings,
    teachers: [teacher],
    students,
    regularLessons: [regular],
    boardWeeks: [],
    suppressedRegularLessonOccurrences: [],
  })
}

function tracesOfW(weeks: SlotCell[][]) {
  return weeks.flat().flatMap((cell) => cell.desks.flatMap((desk) => ([...(desk.lesson?.studentSlots ?? [])] as Array<StudentEntry | null>)
    .filter((entry): entry is StudentEntry => entry?.managedStudentId === 'sW')
    .map((entry) => `${cell.dateKey}:${cell.slotNumber}:${entry.lessonType}`)))
}

function remerge(weeks: SlotCell[][], students: StudentRow[]) {
  return remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings: settings,
    teachers: [teacher],
    students,
    regularLessons: [regular],
    suppressedRegularLessonOccurrences: [],
    todayKey: MON,
  })
}

describe('退塾取消: 通常授業と未消化は戻り、手置きのコマは戻らない', () => {
  it('退塾 → スイープ → 取消 → 再マージで通常授業が戻り、消えた手置きの振替は戻らない(取消の確認画面には出る)', () => {
    // 在籍中の盤面: 火曜 5 限に通常授業、水曜 3 限に手で置いた振替。
    const week = buildWeek([studentBase])
    const wedIndex = week.findIndex((cell) => cell.dateKey === '2026-09-23' && cell.slotNumber === 3)
    expect(wedIndex).toBeGreaterThanOrEqual(0)
    const manualMakeup: StudentEntry = {
      id: 'w-makeup', name: '生徒 W', managedStudentId: 'sW', grade: '中2', subject: '英', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-10',
    }
    week[wedIndex] = { ...week[wedIndex]!, desks: week[wedIndex]!.desks.map((desk, index) => (index === 0 ? { ...desk, teacher: '講師A', manualTeacher: true, lesson: { id: 'w-desk', studentSlots: [manualMakeup, null] } } : desk)) }
    expect(tracesOfW([week])).toEqual([`${TUE}:5:regular`, '2026-09-23:3:makeup'])

    // 退塾ボタン(今日付け・記録を [] で始める) → 盤面のスイープ。
    const withdrawn = applyStudentWithdrawToday([studentBase], 'sW', MON)
    const sweep = applyStudentWithdrawSweepToBoard({
      weeks: [week], students: withdrawn, teachers: [teacher], regularLessons: [regular], classroomSettings: settings,
      suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, todayKey: MON, resolveStockId,
    })
    expect(sweep.changed).toBe(true)
    expect(tracesOfW(sweep.nextWeeks)).toEqual([])
    // App が消した内容を名簿行へ追記する(通常授業は剥がしなので含めない＝戻るもの)。
    const recorded = appendStudentWithdrawSweepRemovedLessons(withdrawn, sweep.results)
    expect(recorded[0].withdrawSweepRemovedLessons).toEqual([{ dateKey: '2026-09-23', slotNumber: 3, kind: 'seat', lessonType: 'makeup', subject: '英' }])
    expect(buildStudentWithdrawCancelConfirmation({ name: '生徒W', removedLessons: recorded[0].withdrawSweepRemovedLessons }).removedLessonLines)
      .toEqual(['9/23(水) 3限 振替 英'])

    // 退塾取消 → 再マージ(名簿が変わったときの effect と同じ合成関数)。
    const cancelled = applyStudentWithdrawCancel(recorded, 'sW')
    const after = remerge(sweep.nextWeeks, cancelled)
    // 通常授業(テンプレ由来)は戻る。消えた手置きの振替は戻らない。
    expect(tracesOfW(after)).toEqual([`${TUE}:5:regular`])
    // 2 回通しても同じ(冪等・INV-03)。
    expect(tracesOfW(remerge(after, cancelled))).toEqual([`${TUE}:5:regular`])
  })

  it('未消化の一覧: 退塾中は隠れ、取消すと再び出る(台帳はそのまま)', () => {
    const entries = [{ key: 'makeup-w', studentId: 'sW' }, { key: 'lecture-w', studentId: 'sW' }]
    const withdrawn = applyStudentWithdrawToday([studentBase], 'sW', MON)
    expect(excludeWithdrawnStudentStockEntries(entries, withdrawn, MON)).toEqual([])
    const cancelled = applyStudentWithdrawCancel(withdrawn, 'sW')
    expect(excludeWithdrawnStudentStockEntries(entries, cancelled, MON)).toEqual(entries)
  })
})
