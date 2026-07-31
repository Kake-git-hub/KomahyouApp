import { describe, expect, it } from 'vitest'
import type { ClassroomSettings } from '../../types/appState'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import type { ManualMakeupOrigin } from './makeupStock'
import { VANISHED_MAKEUP_REASONS, buildVanishedMakeupReport, collectAbsentMakeupCandidates } from './vanishedMakeupReport'

// INV-06 の修正で「未消化振替が増えるコマ」を洗い出すレポートの検証。
// 教室への説明・配信前の影響確認に使うため、増える/増えないの判定が実際の残数差分と一致することを固定する。

const STOCK_KEY = 'student-1__数'
const MOVED_SOURCE_DATE = '2026-07-29' // 水曜。ただ別日へ移動した元コマ（台帳に origin なし）
const HOLIDAY_SOURCE_DATE = '2026-07-22' // 水曜。休日設定済み＝台帳(自動休校日)に origin あり
const BOARD_DATE = '2026-08-05' // 水曜。振替先＝欠席が起きたコマ
const SECOND_BOARD_DATE = '2026-08-12' // 水曜。同じ元コマの欠席をもう1コマ作る用
const TODAY = new Date('2026-07-31T00:00:00')

const student: StudentRow = {
  id: 'student-1',
  name: '大槻 太郎',
  displayName: '大槻',
  email: 'student@example.com',
  entryDate: '2025-04-01',
  withdrawDate: '未定',
  birthDate: '2012-05-01',
}

const teacher: TeacherRow = {
  id: 'teacher-1',
  name: '田中講師',
  email: 'teacher@example.com',
  entryDate: '2025-04-01',
  withdrawDate: '未定',
  subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
}

const regularLesson: RegularLessonRow = {
  id: 'regular-1',
  schoolYear: 2026,
  teacherId: 'teacher-1',
  student1Id: 'student-1',
  subject1: '数',
  startDate: '',
  endDate: '',
  student2Id: '',
  subject2: '',
  student2StartDate: '',
  student2EndDate: '',
  nextStudent1Id: '',
  nextSubject1: '',
  nextStudent2Id: '',
  nextSubject2: '',
  dayOfWeek: 3,
  slotNumber: 5,
}

function createSettings(overrides: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1, ...overrides }
}

function boardStatus(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return {
    id: 'status-1',
    studentId: 'student-1',
    sourceManagedLesson: true,
    name: '大槻 太郎',
    managedStudentId: 'student-1',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '田中講師',
    dateKey: BOARD_DATE,
    slotNumber: 5,
    recordedAt: '2026-07-30T00:00:00.000Z',
    status: 'absent',
    sourceLessonId: 'lesson-1',
    ...overrides,
  }
}

function cellWithStatus(statusEntry: StudentStatusEntry, dateKey = BOARD_DATE): SlotCell {
  const desk: DeskCell = {
    id: `desk-${dateKey}`,
    teacher: '田中講師',
    statusSlots: [statusEntry, null],
    lesson: { id: `lesson-${dateKey}`, studentSlots: [null, null] },
  }
  return {
    id: `cell-${dateKey}`,
    dateKey,
    dayLabel: '水',
    dateLabel: dateKey.slice(5).replace('-', '/'),
    slotLabel: '5限',
    slotNumber: 5,
    timeLabel: '19:00-20:20',
    isOpenDay: true,
    desks: [desk],
  }
}

/** 通常授業を別日へ移動しただけの振替コマ（台帳に origin を持たない）を休みにした状態 */
const movedMakeupAbsence = boardStatus({
  lessonType: 'makeup',
  makeupSourceDate: MOVED_SOURCE_DATE,
  makeupSourceLabel: '7/29(水) 5限',
})

/** 在庫由来（元コマ 7/22 が休日＝台帳に origin がある）の振替コマを休みにした状態 */
const ledgerMakeupAbsence = boardStatus({
  lessonType: 'makeup',
  makeupSourceDate: HOLIDAY_SOURCE_DATE,
  makeupSourceLabel: '7/22(水) 5限',
})

function report(params: {
  weeks: SlotCell[][]
  settings?: ClassroomSettings
  manualAdjustments?: Record<string, ManualMakeupOrigin[]>
  suppressedOrigins?: Record<string, ManualMakeupOrigin[]>
}) {
  return buildVanishedMakeupReport({
    students: [student],
    teachers: [teacher],
    regularLessons: [regularLesson],
    classroomSettings: params.settings ?? createSettings(),
    weeks: params.weeks,
    manualAdjustments: params.manualAdjustments ?? {},
    suppressedOrigins: params.suppressedOrigins ?? {},
    resolveStudentKey: (entry: StudentEntry) => entry.managedStudentId ?? entry.id,
    today: TODAY,
  })
}

describe('vanishedMakeupReport: INV-06 修正で未消化振替が増えるコマの洗い出し', () => {
  it('移動しただけの振替コマを休みにしたコマは「増える」として挙がる', () => {
    const result = report({ weeks: [[cellWithStatus(movedMakeupAbsence)]] })

    expect(result.increasedTotal).toBe(1)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      studentName: '大槻 太郎',
      subject: '数',
      absentDateKey: BOARD_DATE,
      absentSlotNumber: 5,
      makeupSourceDate: MOVED_SOURCE_DATE,
      willIncrease: true,
      reason: VANISHED_MAKEUP_REASONS.increase,
    })
    expect(result.totals).toEqual([
      { key: STOCK_KEY, studentName: '大槻 太郎', subject: '数', balanceBefore: 0, balanceAfter: 1, increase: 1 },
    ])
  })

  it('在庫由来（台帳に元コマがある）の振替コマは修正前から戻っていたので増えない', () => {
    const result = report({
      weeks: [[cellWithStatus(ledgerMakeupAbsence)]],
      settings: createSettings({ holidayDates: [HOLIDAY_SOURCE_DATE] }),
    })

    expect(result.increasedTotal).toBe(0)
    expect(result.totals).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ willIncrease: false, reason: VANISHED_MAKEUP_REASONS.ledger })
  })

  it('元コマを削除（個別抑制）済みなら復活しないので増えない', () => {
    const result = report({
      weeks: [[cellWithStatus(movedMakeupAbsence)]],
      suppressedOrigins: { [STOCK_KEY]: [{ dateKey: MOVED_SOURCE_DATE }] },
    })

    expect(result.increasedTotal).toBe(0)
    expect(result.rows[0]).toMatchObject({ willIncrease: false, reason: VANISHED_MAKEUP_REASONS.suppressed })
  })

  it('同じ元コマの欠席が2コマあっても残数は日付単位なので +1 だけ（残りは相殺と表示する）', () => {
    const result = report({
      weeks: [[
        cellWithStatus(movedMakeupAbsence),
        cellWithStatus({ ...movedMakeupAbsence, id: 'status-2', dateKey: SECOND_BOARD_DATE }, SECOND_BOARD_DATE),
      ]],
    })

    expect(result.increasedTotal).toBe(1)
    expect(result.rows.filter((row) => row.willIncrease)).toHaveLength(1)
    expect(result.rows.filter((row) => !row.willIncrease)[0].reason).toBe(VANISHED_MAKEUP_REASONS.consumed)
  })

  it('振無休・出席・通常授業の欠席は対象外（この修正では増えない）', () => {
    const weeks = [[
      cellWithStatus({ ...movedMakeupAbsence, id: 'status-a', status: 'absent-no-makeup' }),
      cellWithStatus({ ...movedMakeupAbsence, id: 'status-b', status: 'attended' }, SECOND_BOARD_DATE),
      cellWithStatus({ ...boardStatus({ id: 'status-c' }) }, '2026-08-19'),
    ]]

    expect(collectAbsentMakeupCandidates(weeks, (entry: StudentEntry) => entry.managedStudentId ?? entry.id)).toEqual([])
    expect(report({ weeks }).increasedTotal).toBe(0)
  })
})
