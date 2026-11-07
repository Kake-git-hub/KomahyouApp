import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SlotCell, StudentEntry } from './types'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import {
  buildManagedScheduleCellsForRange,
  collectStudentMoveLandingPlacements,
  computeStudentMove,
  remergeBoardWeeksWithManagedData,
} from './ScheduleBoardScreen'
import { findScheduleViewMoveSource } from '../schedule-view/scheduleViewMove'
import { CLOSED_DAY_STUDENT_SWAP_MESSAGE, resolveStudentMoveClosedDayBlock } from './closedDayPlacementGuard'
import { findStudentMoveSource, isBoardStudentSeatSelected } from './studentMoveSource'

// ============================================================================
// 同じ日・同じ科目のテンプレの授業が 2 コマある生徒（授業の id が同じになる）の移動（INV-02 / INV-11）。
//
// テンプレの授業の id は `生徒ID_日付_科目`（createManagedStudentEntry）で時限を含まない。同じ日に同じ科目を 2 コマ持つと
// 2 つの授業が同じ id になり、移動（メニュー・長押し D&D・日程表 D&D）が id で移動元を探していたため、後ろの時限を選んでも
// 前の時限の授業が動いていた（2026-11-07 オーナー報告「すぐ直して」）。
// 直し方: id の形は変えない（在庫・履歴・保存データ・再マージの突き合わせが id を使う）。移動元を「選んだ席」（セル＋机＋席）で
// 決める（findStudentMoveSource）。席が渡らない・席の生徒が別人のときは従来どおり id で最初に見つかった授業。
// ============================================================================

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const DATE = '2026-10-07' // 水
const OTHER_DATE = '2026-10-08' // 木

const settings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3 } as unknown as ClassroomSettings
const studentRows: StudentRow[] = [['sA', '生徒A'], ['sB', '生徒B']].map(([id, name]) => ({
  id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01',
})) as StudentRow[]
const teacherRows: TeacherRow[] = [['t1', '講師A'], ['t2', '講師B'], ['t3', '講師C']].map(([id, name]) => ({
  id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
})) as TeacherRow[]
const row = (id: string, teacherId: string, studentId: string, subject: string, dayOfWeek: number, slotNumber: number): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id: studentId, subject1: subject, startDate: '', endDate: '', student2Id: '', subject2: '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek, slotNumber,
})
// 生徒A: 水曜 1 限と 2 限に同じ科目「数」（講師は別）。生徒B: 木曜 3 限「英」（入れ替えの相手）。
const ROWS = [row('r1', 't1', 'sA', '数', 3, 1), row('r2', 't2', 'sA', '数', 3, 2), row('r3', 't3', 'sB', '英', 4, 3)]
const SAME_ID = `sA_${DATE}_数`

function boardWeeks(): SlotCell[][] {
  return [buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
    fallbackStartDate: WEEK_START,
    fallbackEndDate: WEEK_END,
    classroomSettings: settings,
    teachers: teacherRows,
    students: studentRows,
    regularLessons: ROWS,
    boardWeeks: [],
  })]
}

type Seat = { cellId: string; deskIndex: number; studentIndex: number; student: StudentEntry; teacher: string }
function seatsOf(weeks: SlotCell[][], predicate: (student: StudentEntry) => boolean): Seat[] {
  const seats: Seat[] = []
  for (const cell of weeks.flat()) {
    cell.desks.forEach((desk, deskIndex) => desk.lesson?.studentSlots.forEach((student, studentIndex) => {
      if (student && predicate(student)) seats.push({ cellId: cell.id, deskIndex, studentIndex, student, teacher: desk.teacher })
    }))
  }
  return seats
}
const seatOfSlot = (weeks: SlotCell[][], cellId: string) => seatsOf(weeks, (student) => student.managedStudentId === 'sA').find((seat) => seat.cellId === cellId)

const moveDefaults = {
  suppressedRegularLessonOccurrences: [] as string[],
  managedStudentByAnyName: new Map<string, StudentRow>(),
  resolveBoardStudentDisplayName: (name: string) => name,
}

describe('同じ日・同じ科目の 2 コマ（同じ id）の移動は選んだ席の授業を動かす（INV-02 / INV-11）', () => {
  it('前提: テンプレの 2 行は同じ id の授業を 1 限と 2 限に置く（id は時限を含まない＝原因の固定）', () => {
    const weeks = boardWeeks()
    const sameId = seatsOf(weeks, (student) => student.id === SAME_ID)
    expect(sameId.map((seat) => seat.cellId).sort()).toEqual([`${DATE}_1`, `${DATE}_2`])
  })

  it('findStudentMoveSource: 選んだ席の生徒が同じ id ならその席を返す・席が無い/別人なら id で最初の授業（従来どおり）', () => {
    const weeks = boardWeeks()
    const second = seatOfSlot(weeks, `${DATE}_2`)!
    const first = seatOfSlot(weeks, `${DATE}_1`)!
    const bySeat = findStudentMoveSource(weeks.flat(), SAME_ID, { cellId: second.cellId, deskIndex: second.deskIndex, studentIndex: second.studentIndex })
    expect(bySeat?.cell.id).toBe(`${DATE}_2`)
    expect(bySeat?.deskIndex).toBe(second.deskIndex)
    expect(bySeat?.studentIndex).toBe(second.studentIndex)
    // 席が渡らない → id で最初の授業（1 限）
    expect(findStudentMoveSource(weeks.flat(), SAME_ID)?.cell.id).toBe(`${DATE}_1`)
    expect(findStudentMoveSource(weeks.flat(), SAME_ID, null)?.cell.id).toBe(`${DATE}_1`)
    // 席の生徒が別の id（古い選択）→ 席を信じず id で探す
    const sB = seatsOf(weeks, (student) => student.managedStudentId === 'sB')[0]
    expect(findStudentMoveSource(weeks.flat(), SAME_ID, { cellId: sB.cellId, deskIndex: sB.deskIndex, studentIndex: sB.studentIndex })?.cell.id).toBe(`${DATE}_1`)
    // 存在しない席 → id で探す
    expect(findStudentMoveSource(weeks.flat(), SAME_ID, { cellId: 'none', deskIndex: 0, studentIndex: 0 })?.cell.id).toBe(`${DATE}_1`)
    expect(first.student.id).toBe(SAME_ID)
    // 見つからない id
    expect(findStudentMoveSource(weeks.flat(), 'missing', null)).toBeNull()
  })

  it('別の日へ移動: 2 限を選んで動かすと 2 限が動き、1 限の授業はそのまま（再マージ後も）', () => {
    const weeks = boardWeeks()
    const second = seatOfSlot(weeks, `${DATE}_2`)!
    const result = computeStudentMove({
      weeks, weekIndex: 0, cells: weeks[0], movingStudentId: SAME_ID,
      cellId: `${OTHER_DATE}_1`, deskIndex: 0, studentIndex: 0,
      sourceSeat: { cellId: second.cellId, deskIndex: second.deskIndex, studentIndex: second.studentIndex },
      ...moveDefaults,
    })
    if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}: ${result.message}`)
    // 1 限は残り、2 限は空き、移動先に振替で入る
    expect(seatOfSlot(result.nextWeeks, `${DATE}_1`)?.student.lessonType).toBe('regular')
    expect(seatOfSlot(result.nextWeeks, `${DATE}_2`)).toBeUndefined()
    const landed = seatOfSlot(result.nextWeeks, `${OTHER_DATE}_1`)
    expect(landed?.student.lessonType).toBe('makeup')
    expect(landed?.student.makeupSourceLabel).toContain('2限')
    // 削除記録（抑止キー）は 2 限に積む（1 限ではない）
    expect(result.nextSuppressedRegularLessonOccurrences).toEqual([`sA__数__${DATE}__2`])
    // 移動元の「移)」記録は 2 限の席に付く
    const sourceCell2 = result.nextWeeks.flat().find((cell) => cell.id === `${DATE}_2`)!
    expect(sourceCell2.desks[second.deskIndex].statusSlots?.[second.studentIndex]?.status).toBe('moved')
    const sourceCell1 = result.nextWeeks.flat().find((cell) => cell.id === `${DATE}_1`)!
    expect(sourceCell1.desks.some((desk) => desk.statusSlots?.some((entry) => entry?.status === 'moved'))).toBe(false)
    // 再マージ（リロード相当）でも 1 限は残り、2 限にテンプレの授業は生き返らない
    const remerged = remergeBoardWeeksWithManagedData(result.nextWeeks, {
      classroomSettings: settings, teachers: teacherRows, students: studentRows, regularLessons: ROWS,
      suppressedRegularLessonOccurrences: result.nextSuppressedRegularLessonOccurrences, todayKey: '2026-10-01',
    })
    expect(seatOfSlot(remerged, `${DATE}_1`)?.student.lessonType).toBe('regular')
    expect(seatOfSlot(remerged, `${DATE}_2`)).toBeUndefined()
    expect(seatOfSlot(remerged, `${OTHER_DATE}_1`)?.student.lessonType).toBe('makeup')
  })

  it('1 限を選んだときは従来どおり 1 限が動く（席を渡しても・渡さなくても）', () => {
    const weeks = boardWeeks()
    const first = seatOfSlot(weeks, `${DATE}_1`)!
    for (const sourceSeat of [{ cellId: first.cellId, deskIndex: first.deskIndex, studentIndex: first.studentIndex }, undefined]) {
      const result = computeStudentMove({
        weeks, weekIndex: 0, cells: weeks[0], movingStudentId: SAME_ID,
        cellId: `${OTHER_DATE}_1`, deskIndex: 0, studentIndex: 0, sourceSeat, ...moveDefaults,
      })
      if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
      expect(seatOfSlot(result.nextWeeks, `${DATE}_1`)).toBeUndefined()
      expect(seatOfSlot(result.nextWeeks, `${DATE}_2`)?.student.lessonType).toBe('regular')
      expect(result.nextSuppressedRegularLessonOccurrences).toEqual([`sA__数__${DATE}__1`])
    }
  })

  it('同じ日の中の移動（第 2 版・templateOriginRules）: 2 限を 3 限へ動かすと元の時限は 2 限と記録され、1 限は動かない', () => {
    const weeks = boardWeeks()
    const second = seatOfSlot(weeks, `${DATE}_2`)!
    const result = computeStudentMove({
      weeks, weekIndex: 0, cells: weeks[0], movingStudentId: SAME_ID,
      cellId: `${DATE}_3`, deskIndex: 0, studentIndex: 0,
      sourceSeat: { cellId: second.cellId, deskIndex: second.deskIndex, studentIndex: second.studentIndex },
      templateOriginRules: true,
      ...moveDefaults,
    })
    if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
    expect(seatOfSlot(result.nextWeeks, `${DATE}_1`)?.student.sameDayMoveSourceDate).toBeUndefined()
    expect(seatOfSlot(result.nextWeeks, `${DATE}_2`)).toBeUndefined()
    const landed = seatOfSlot(result.nextWeeks, `${DATE}_3`)!
    expect(landed.student.sameDayMoveSourceDate).toBe(DATE)
    expect(landed.student.sameDayMoveSourceLabel).toContain('2限')
  })

  it('入れ替え: 2 限を選んで生徒B の席へ落とすと、生徒B は 2 限の席へ入り、1 限の授業はそのまま', () => {
    const weeks = boardWeeks()
    const second = seatOfSlot(weeks, `${DATE}_2`)!
    const sB = seatsOf(weeks, (student) => student.managedStudentId === 'sB')[0]
    const result = computeStudentMove({
      weeks, weekIndex: 0, cells: weeks[0], movingStudentId: SAME_ID,
      cellId: sB.cellId, deskIndex: sB.deskIndex, studentIndex: sB.studentIndex,
      sourceSeat: { cellId: second.cellId, deskIndex: second.deskIndex, studentIndex: second.studentIndex },
      ...moveDefaults,
    })
    if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
    expect(seatOfSlot(result.nextWeeks, `${DATE}_1`)?.student.lessonType).toBe('regular')
    const swappedIn = seatsOf(result.nextWeeks, (student) => student.managedStudentId === 'sB')
    expect(swappedIn.map((seat) => [seat.cellId, seat.deskIndex, seat.studentIndex])).toEqual([[second.cellId, second.deskIndex, second.studentIndex]])
    expect(seatOfSlot(result.nextWeeks, sB.cellId)?.student.lessonType).toBe('makeup')
  })

  it('出席不可の確認の着地（collectStudentMoveLandingPlacements）も選んだ席で決める: 入れ替え相手の着地は 2 限', () => {
    const weeks = boardWeeks()
    const second = seatOfSlot(weeks, `${DATE}_2`)!
    const sB = seatsOf(weeks, (student) => student.managedStudentId === 'sB')[0]
    const placements = collectStudentMoveLandingPlacements({
      weeks, cells: weeks[0], movingStudentId: SAME_ID,
      cellId: sB.cellId, deskIndex: sB.deskIndex, studentIndex: sB.studentIndex,
      sourceSeat: { cellId: second.cellId, deskIndex: second.deskIndex, studentIndex: second.studentIndex },
      managedStudentByAnyName: new Map(), resolveBoardStudentDisplayName: (name: string) => name,
    })
    const partner = placements.find((placement) => placement.displayName === '生徒B')
    expect(partner).toMatchObject({ dateKey: DATE, slotNumber: 2 })
  })

  it('日程表 D&D の経路: 日付＋時限で見つけた移動元（findScheduleViewMoveSource）の席で computeStudentMove が 2 限を動かす', () => {
    const weeks = boardWeeks()
    const hit = findScheduleViewMoveSource(weeks, { entryId: SAME_ID, studentId: 'sA', sourceDateKey: DATE, sourceSlotNumber: 2, lessonType: 'regular', subject: '数', studentName: '生徒A' })!
    expect(hit.cellId).toBe(`${DATE}_2`)
    const result = computeStudentMove({
      weeks, weekIndex: 0, cells: weeks[0], movingStudentId: SAME_ID,
      cellId: `${OTHER_DATE}_1`, deskIndex: 0, studentIndex: 0,
      sourceSeat: { cellId: hit.cellId, deskIndex: hit.deskIndex, studentIndex: hit.studentIndex },
      ...moveDefaults,
    })
    if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
    expect(seatOfSlot(result.nextWeeks, `${DATE}_1`)?.student.lessonType).toBe('regular')
    expect(seatOfSlot(result.nextWeeks, `${DATE}_2`)).toBeUndefined()
  })
})

describe('休日の入れ替え検査（resolveStudentMoveClosedDayBlock）も選んだ席の移動元で決める', () => {
  // 同じ id の授業が休日のコマ（前に置けてしまった授業）と営業日のコマにある形。営業日の方を選んで入れ替えるのは止めない。
  const entry = (id: string, managedStudentId: string) => ({ id, name: managedStudentId, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }) as StudentEntry
  const cell = (id: string, dateKey: string, slotNumber: number, isOpenDay: boolean, student: StudentEntry) => ({
    id, dateKey, dayLabel: '', dateLabel: '', slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay,
    desks: [{ id: `${id}_d0`, teacher: '講師A', lesson: { id: `l_${id}`, studentSlots: [student, null] } }],
  }) as unknown as SlotCell
  const cells = [
    cell('2026-10-07_1', '2026-10-07', 1, false, entry(SAME_ID, 'sA')),
    cell('2026-10-08_2', '2026-10-08', 2, true, entry(SAME_ID, 'sA')),
    cell('2026-10-09_3', '2026-10-09', 3, true, entry('sB_2026-10-09_英', 'sB')),
  ]
  const base = { cells, movingStudentId: SAME_ID, cellId: '2026-10-09_3', deskIndex: 0, studentIndex: 0 }
  it('営業日の方を選んだ入れ替えは止めない・休日の方（または席なし＝従来どおり最初の授業）は止める', () => {
    expect(resolveStudentMoveClosedDayBlock({ ...base, sourceSeat: { cellId: '2026-10-08_2', deskIndex: 0, studentIndex: 0 } })).toBeNull()
    expect(resolveStudentMoveClosedDayBlock({ ...base, sourceSeat: { cellId: '2026-10-07_1', deskIndex: 0, studentIndex: 0 } })).toBe(CLOSED_DAY_STUDENT_SWAP_MESSAGE)
    expect(resolveStudentMoveClosedDayBlock(base)).toBe(CLOSED_DAY_STUDENT_SWAP_MESSAGE)
  })
})

describe('盤面の選択枠（isBoardStudentSeatSelected）は動かす授業の席だけ', () => {
  const student = { id: SAME_ID } as StudentEntry
  const seat2 = { cellId: `${DATE}_2`, deskIndex: 1, studentIndex: 0 }
  it('席があれば同じ id でもその席だけ・席が無ければ従来どおり id が同じ席すべて', () => {
    expect(isBoardStudentSeatSelected({ selectedStudentId: SAME_ID, selectedSeat: seat2, student, cellId: `${DATE}_2`, deskIndex: 1, studentIndex: 0 })).toBe(true)
    expect(isBoardStudentSeatSelected({ selectedStudentId: SAME_ID, selectedSeat: seat2, student, cellId: `${DATE}_1`, deskIndex: 1, studentIndex: 0 })).toBe(false)
    expect(isBoardStudentSeatSelected({ selectedStudentId: SAME_ID, selectedSeat: seat2, student, cellId: `${DATE}_2`, deskIndex: 0, studentIndex: 0 })).toBe(false)
    expect(isBoardStudentSeatSelected({ selectedStudentId: SAME_ID, selectedSeat: null, student, cellId: `${DATE}_1`, deskIndex: 0, studentIndex: 0 })).toBe(true)
    expect(isBoardStudentSeatSelected({ selectedStudentId: null, selectedSeat: null, student, cellId: `${DATE}_1`, deskIndex: 0, studentIndex: 0 })).toBe(false)
    expect(isBoardStudentSeatSelected({ selectedStudentId: 'other', selectedSeat: seat2, student, cellId: `${DATE}_2`, deskIndex: 1, studentIndex: 0 })).toBe(false)
    expect(isBoardStudentSeatSelected({ selectedStudentId: SAME_ID, selectedSeat: seat2, student: null, cellId: `${DATE}_2`, deskIndex: 1, studentIndex: 0 })).toBe(false)
  })
})

// 配線: 盤面の画面関数は React の中なので、選んだ席が移動の各判定へ渡っていることをソースで固定する（templateSlotChangeFollow.wiring.test.ts の作法）。
describe('配線: 選んだ席を移動の判定へ渡す（同じ id の授業の取り違え防止）', () => {
  const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
  const sliceFn = (start: string, end: string) => {
    const from = BOARD_TSX.indexOf(start)
    const to = BOARD_TSX.indexOf(end, from + start.length)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    return BOARD_TSX.slice(from, to)
  }

  it('executeMoveStudent は computeStudentMove・着地の確認・保留の机の判定に選んだ席を渡す', () => {
    const body = sliceFn('const executeMoveStudent = (', 'const stableExecuteMoveStudent')
    expect(body).toMatch(/computeStudentMove\(\{[\s\S]*?sourceSeat: movingSourceSeat,[\s\S]*?\}\)/)
    expect(body).toMatch(/collectStudentMoveLandingPlacements\(\{[\s\S]*?sourceSeat: movingSourceSeat,[\s\S]*?\}\)/)
    expect(body).toContain('findStudentMoveSource(weeks.flat(), movingStudentId, movingSourceSeat)')
    expect(body).toContain('resolveStudentMoveClosedDayBlock({ cells: normalizedWeeks.flat(), movingStudentId, cellId, deskIndex, studentIndex, sourceSeat: movingSourceSeat })')
  })

  it('executeScheduleViewMove は findScheduleViewMoveSource の席を computeStudentMove と着地の確認へ渡す', () => {
    const body = sliceFn('const executeScheduleViewMove = (', 'const stableExecuteScheduleViewMove')
    const seatArg = 'sourceSeat: { cellId: sourceHit.cellId, deskIndex: sourceHit.deskIndex, studentIndex: sourceHit.studentIndex },'
    expect(body.split(seatArg).length - 1).toBe(2)
  })

  it('メニューの「移動」と長押し D&D は選んだ席を覚える', () => {
    const startMove = sliceFn('const handleStartMove = () => {', 'const handleOpenAddExistingStudent')
    expect(startMove).toContain('setSelectedStudentSeat({ cellId: studentMenu.cellId, deskIndex: studentMenu.deskIndex, studentIndex: studentMenu.studentIndex })')
    const mouseDown = sliceFn('const handleStudentMouseDown = (', 'dragMoveRef.current = {')
    expect(mouseDown).toContain('setSelectedStudentSeat(sourceSeat)')
    expect(mouseDown).toContain('stableExecuteMoveStudent(targetCellId, targetDeskIndex, targetStudentIndex, sourceStudentId, sourceSeat)')
  })
})
