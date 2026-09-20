import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import type { ClassroomSettings } from '../../types/appState'
import {
  carryBoardStatusRecordsOntoClosedDayCell,
  clearStudentStatusFromDesk,
  computeHolidayReleaseRestoration,
  computeStudentMove,
  convertHolidayDeskEntriesToRecords,
  isStaleSeatMarkerStatus,
  materializeDisplacedStatusEntryIntoLedgers,
  overlayBoardWeeksOnScheduleCells,
  reconcileHolidayDeskStockReturns,
  remergeBoardWeekWithManagedData,
  resolveDisplayRecordClearButton,
  resolveEmptySeatMenuVariant,
  summarizeHolidayReleaseSkips,
} from './ScheduleBoardScreen'
import { buildLectureStockKey } from './lectureStock'
import { buildMakeupStockKey, collectMakeupOriginDatesByKey } from './makeupStock'

// ============================================================================
// INV-06 操作マトリクス（休日設定の「記録保持」・D5 オーナー確定 2026-09-16）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習・振替在庫は盤面実配置と一致し、明示操作なしに増減しない。誤増も違反。
//
// 変更点: 休日設定は従来 `desk.statusSlots = undefined; desk.lesson = undefined` で机の中身を
// **全部消して**いた。そのため「その日に誰が何を予定していたか」「誰が休んだか」が盤面からも
// 日程表からも消え、室長が後から確認できなかった。これを表示専用の記録として残す。
//
// ★在庫会計は 1 ミリも変えない。変換関数 convertHolidayDeskEntriesToRecords は台帳(ledgers)を
//   引数に取らない＝触れない。在庫の返却は従来どおり reconcileHolidayDeskStockReturns の仕事で、
//   呼ぶ順序は「在庫戻し → 記録変換」で固定する（逆にすると lesson が消えた後に在庫を数えて誤減する）。
// ★変換規則（設計 §2-4）を 1 行ずつここで固定する:
//     既存 moved / absent … そのまま（会計済み。会計を持つ記録を表示専用へ落とさない）
//     既存 attended / absent-no-makeup … holiday へ変換（在庫へ返し終えた＝会計を持たない）
//     配置(studentSlots) … holiday の新規記録（同じ席に既存記録があれば既存を優先）
//     体験(trial) … 記録を作らない
//     機能フラグ OFF … 全消去（従来と完全一致）
// ============================================================================

const CELL: SlotCell = {
  id: '2026-08-01_5',
  dateKey: '2026-08-01',
  dayLabel: '土',
  dateLabel: '8/1',
  slotLabel: '5限',
  slotNumber: 5,
  timeLabel: '19:00-20:20',
  isOpenDay: true,
  desks: [],
}

function student(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '大槻 太郎',
    managedStudentId: 'student-1',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function statusEntry(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
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
    dateKey: '2026-08-01',
    slotNumber: 5,
    recordedAt: '2026-07-30T00:00:00.000Z',
    status: 'attended',
    sourceLessonId: 'lesson-1',
    ...overrides,
  }
}

function desk(params: {
  lesson?: [StudentEntry | null, StudentEntry | null]
  statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]
  memoSlots?: [string | null, string | null]
}): DeskCell {
  return {
    id: 'desk-1',
    teacher: '田中講師',
    ...(params.lesson ? { lesson: { id: 'lesson-1', studentSlots: params.lesson } } : {}),
    ...(params.statusSlots ? { statusSlots: params.statusSlots } : {}),
    ...(params.memoSlots ? { memoSlots: params.memoSlots } : {}),
  }
}

function convert(target: DeskCell, enabled = true) {
  convertHolidayDeskEntriesToRecords({ desk: target, cell: CELL, enabled })
  return target
}

describe('INV-06 マトリクス: 休日設定の記録保持（機能フラグ OFF）', () => {
  it('従来どおり lesson も statusSlots も全消去する', () => {
    const target = convert(desk({
      lesson: [student(), null],
      statusSlots: [null, statusEntry({ id: 'status-2' })],
    }), false)
    expect(target.lesson).toBeUndefined()
    expect(target.statusSlots).toBeUndefined()
  })
})

describe('INV-06 マトリクス: 休日設定の記録保持（機能フラグ ON）', () => {
  it('配置(通常授業)は holiday の表示専用記録になり、lesson は消える', () => {
    const target = convert(desk({ lesson: [student(), null] }))
    const record = target.statusSlots?.[0]
    expect(record?.status).toBe('holiday')
    expect(record?.managedStudentId).toBe('student-1')
    expect(record?.subject).toBe('数')
    expect(record?.lessonType).toBe('regular')
    expect(record?.teacherName).toBe('田中講師')
    expect(record?.dateKey).toBe('2026-08-01')
    expect(record?.slotNumber).toBe(5)
    expect(target.lesson).toBeUndefined()
  })

  it('振替・講習の配置も holiday 記録として残る(元コマ情報つき)', () => {
    const target = convert(desk({
      lesson: [
        student({ id: 'entry-makeup', lessonType: 'makeup', makeupSourceDate: '2026-07-22', makeupSourceLabel: '2026/7/22(水) 5限' }),
        student({ id: 'entry-lecture', lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1' }),
      ],
    }))
    expect(target.statusSlots?.[0]).toMatchObject({ status: 'holiday', lessonType: 'makeup', makeupSourceDate: '2026-07-22' })
    expect(target.statusSlots?.[1]).toMatchObject({ status: 'holiday', lessonType: 'special', specialSessionId: 'sess-1' })
  })

  it('体験(trial)は記録を作らない(日程表に載らず在庫も持たないため)', () => {
    const target = convert(desk({ lesson: [student({ lessonType: 'trial', manualAdded: true, managedStudentId: undefined }), null] }))
    expect(target.statusSlots).toBeUndefined()
    expect(target.lesson).toBeUndefined()
  })

  it('★出席(attended)・振無休(absent-no-makeup)は holiday へ変換する(在庫へ返し終えた＝会計を持たない)', () => {
    const target = convert(desk({
      statusSlots: [
        statusEntry({ id: 'status-attended', status: 'attended' }),
        statusEntry({ id: 'status-anm', status: 'absent-no-makeup' }),
      ],
    }))
    expect(target.statusSlots?.[0]).toMatchObject({ id: 'status-attended', status: 'holiday' })
    expect(target.statusSlots?.[1]).toMatchObject({ id: 'status-anm', status: 'holiday' })
  })

  it('★休み(absent)・移動元(moved)はそのまま残す(会計済みの記録を表示専用へ落とさない)', () => {
    const target = convert(desk({
      statusSlots: [
        statusEntry({ id: 'status-absent', status: 'absent' }),
        statusEntry({ id: 'status-moved', status: 'moved', moveDestinationDateKey: '2026-08-08', moveDestinationSlotNumber: 3 }),
      ],
    }))
    expect(target.statusSlots?.[0]).toMatchObject({ id: 'status-absent', status: 'absent' })
    expect(target.statusSlots?.[1]).toMatchObject({ id: 'status-moved', status: 'moved', moveDestinationDateKey: '2026-08-08' })
  })

  it('★同じ席に配置と出欠記録が同居していたら既存の記録を優先する(会計記録を表示記録で上書きしない)', () => {
    // 休んだ生徒の席へ別の生徒を組んだ状態（studentSlots と statusSlots が同じ index に並ぶ）。
    const target = convert(desk({
      lesson: [student({ id: 'entry-overlay', name: '別の子', managedStudentId: 'student-2' }), null],
      statusSlots: [statusEntry({ id: 'status-absent', status: 'absent' }), null],
    }))
    expect(target.statusSlots?.[0]).toMatchObject({ id: 'status-absent', status: 'absent', managedStudentId: 'student-1' })
    expect(target.lesson).toBeUndefined()
  })

  it('メモと講師は触らない(休日表示では隠れるだけでデータは残す=従来どおり)', () => {
    const target = convert(desk({ lesson: [student(), null], memoSlots: ['自習予約', null] }))
    expect(target.memoSlots).toEqual(['自習予約', null])
    expect(target.teacher).toBe('田中講師')
  })

  it('空の机は statusSlots を作らない(空配列で埋めない)', () => {
    const target = convert(desk({}))
    expect(target.statusSlots).toBeUndefined()
  })
})

describe('INV-06 マトリクス: 記録保持は在庫会計を変えない', () => {
  const roster = new Map<string, StudentRow>([['大槻 太郎', { id: 'student-1', name: '大槻 太郎' } as StudentRow]])

  function runHoliday(target: DeskCell, enabled: boolean) {
    const result = reconcileHolidayDeskStockReturns({
      desk: target,
      cellDateKey: CELL.dateKey,
      cellSlotNumber: CELL.slotNumber,
      ledgers: {
        manualLectureStockCounts: {},
        manualLectureStockOrigins: {},
        manualMakeupAdjustments: {},
        fallbackLectureStockStudents: {},
        fallbackMakeupStudents: {},
      },
      managedStudentByAnyName: roster,
      resolveDisplayName: (name: string) => name,
      resolveStockId: (entry: StudentEntry) => entry.managedStudentId ?? entry.name,
      ledgerOriginDatesByKey: {},
    })
    convertHolidayDeskEntriesToRecords({ desk: target, cell: CELL, enabled })
    return result
  }

  it('★在庫戻しの結果は ON/OFF で完全に同じ(記録を残しても台帳は動かない)', () => {
    const on = runHoliday(desk({ lesson: [student(), null], statusSlots: [null, statusEntry({ id: 'status-2', status: 'attended' })] }), true)
    const off = runHoliday(desk({ lesson: [student(), null], statusSlots: [null, statusEntry({ id: 'status-2', status: 'attended' })] }), false)
    expect(on.ledgers).toEqual(off.ledgers)
    expect(on.movedStudentCount).toBe(off.movedStudentCount)
    expect(on.returnedEntryIds).toEqual(off.returnedEntryIds)
  })

  it('★holiday 記録の解除は記録を消すだけ(配置を戻さない＝在庫から出さずにコマが増えるのを防ぐ)', () => {
    const target = convert(desk({ lesson: [student(), null] }))
    const record = target.statusSlots?.[0]
    expect(record?.status).toBe('holiday')
    const restored = clearStudentStatusFromDesk(target, 0, record as StudentStatusEntry)
    expect(restored).toBeNull()
    expect(target.lesson).toBeUndefined()
    expect(target.statusSlots).toBeUndefined()
  })

  it('比較: 休み(absent)の解除は従来どおり配置を戻す(ガードを広げすぎていない)', () => {
    const target = desk({ statusSlots: [statusEntry({ id: 'status-absent', status: 'absent' }), null] })
    const record = target.statusSlots?.[0] as StudentStatusEntry
    const restored = clearStudentStatusFromDesk(target, 0, record)
    expect(restored?.managedStudentId).toBe('student-1')
    expect(target.lesson?.studentSlots[0]?.managedStudentId).toBe('student-1')
  })
})

// ============================================================================
// 行: 休日セルの記録 × 盤面の再マージ(remergeBoardWeekWithManagedData = 読込時と、名簿/テンプレ/設定変更の effect)
//
// 不具合(2026-09-16 再現): overlayBoardWeeksOnScheduleCells の「休日セルは管理側セルを返す」分岐(8559c28)が
// 盤面セルの statusSlots まで捨てていたため、休日設定で残した holiday/moved/absent 記録が**リロードで全部消えた**
// (営業日セルでは残る)。absent が消えると collectAbsentMakeupOrigins の算出 origin が減る＝INV-06 誤減。
// 修正: 休日セルは従来どおり管理側セル(=盤面の授業・講師・メモは持ち込まない)に、机ごとの statusSlots だけ引き継ぐ
// (carryBoardStatusRecordsOntoClosedDayCell)。
// ============================================================================
describe('INV-06 マトリクス: 休日セルの記録は再マージ(リロード相当)で消えない', () => {
  const HOLIDAY = '2026-10-07' // 水
  const OPEN_DAY = '2026-10-06' // 火
  const baseSettings: ClassroomSettings = {
    closedWeekdays: [0],
    holidayDates: [HOLIDAY],
    forceOpenDates: [],
    deskCount: 3,
  }

  function stubCell(dateKey: string, slotNumber = 1): SlotCell {
    const id = `${dateKey}_${slotNumber}`
    // 机数設定(3)ぶんの空き机。盤面側が空配列だと mergeManagedWeek の結果も机 0 本になり足場講師が置けない。
    const desks: DeskCell[] = Array.from({ length: 3 }, (_, index) => ({ id: `${id}_desk_${index + 1}`, teacher: '' }))
    return { ...CELL, id, dateKey, slotNumber, slotLabel: `${slotNumber}限`, desks }
  }

  function remerge(week: SlotCell[], settings: ClassroomSettings) {
    return remergeBoardWeekWithManagedData(week, {
      classroomSettings: settings,
      teachers: [],
      students: [],
      regularLessons: [],
      suppressedRegularLessonOccurrences: [],
      todayKey: '2026-09-16',
    })
  }

  // 1 回目の再マージで週を作り、対象セルの机 0 に記録(＋持ち込まれてはいけない授業・講師・メモ)を載せる。
  function buildWeekWithRecords(dateKey: string, settings: ClassroomSettings) {
    const week = remerge([stubCell(dateKey)], settings)
    const target = week.find((cell) => cell.id === `${dateKey}_1`)
    if (!target) throw new Error('target cell not found')
    target.desks[0] = {
      ...target.desks[0],
      teacher: '田中講師',
      manualTeacher: true,
      lesson: { id: 'lesson-board', studentSlots: [null, student({ id: 'entry-board', name: '別の子', managedStudentId: 'student-2' })] },
      memoSlots: [null, 'メモ'],
      statusSlots: [
        statusEntry({ id: 'status-holiday', status: 'holiday', dateKey, slotNumber: 1 }),
        statusEntry({ id: 'status-moved', status: 'moved', dateKey, slotNumber: 1, moveDestinationDateKey: '2026-10-09', moveDestinationSlotNumber: 2 }),
      ],
    }
    target.desks[1] = {
      ...target.desks[1],
      statusSlots: [statusEntry({ id: 'status-absent', status: 'absent', dateKey, slotNumber: 1 }), null],
    }
    // 記録の無い机(講師・授業・メモだけ)。休日セルへは何も持ち込まない対照。
    target.desks[2] = {
      ...target.desks[2],
      teacher: '講師Z',
      manualTeacher: true,
      teacherAssignmentSource: 'manual',
      lesson: { id: 'lesson-board-z', studentSlots: [student({ id: 'entry-z', name: 'Zの子', managedStudentId: 'student-z' }), null] },
      memoSlots: ['Zメモ', null],
    }
    return week
  }

  function findCell(week: SlotCell[], dateKey: string) {
    const cell = week.find((entry) => entry.id === `${dateKey}_1`)
    if (!cell) throw new Error('cell not found')
    return cell
  }

  it('★休日セル: holiday / moved / absent 記録が机 index ごとに残る', () => {
    const week = buildWeekWithRecords(HOLIDAY, baseSettings)
    const reloaded = findCell(remerge(week, baseSettings), HOLIDAY)
    expect(reloaded.isOpenDay).toBe(false)
    expect(reloaded.desks[0].statusSlots?.[0]).toMatchObject({ id: 'status-holiday', status: 'holiday' })
    expect(reloaded.desks[0].statusSlots?.[1]).toMatchObject({ id: 'status-moved', status: 'moved', moveDestinationDateKey: '2026-10-09', moveDestinationSlotNumber: 2 })
    expect(reloaded.desks[1].statusSlots?.[0]).toMatchObject({ id: 'status-absent', status: 'absent' })
    expect(reloaded.desks[2].statusSlots).toBeUndefined()
  })

  it('★休日セル: 盤面の授業・メモは持ち込まない。講師は記録のある机に限り引き継ぐ(8559c28 の意図を維持・INV-01)', () => {
    const week = buildWeekWithRecords(HOLIDAY, baseSettings)
    const reloaded = findCell(remerge(week, baseSettings), HOLIDAY)
    // 記録のある机: 授業・メモは持ち込まず、講師ブロックだけ一緒に引き継ぐ。
    expect(reloaded.desks[0].lesson).toBeUndefined()
    expect(reloaded.desks[0].memoSlots).toBeUndefined()
    expect(reloaded.desks[0]).toMatchObject({ teacher: '田中講師', manualTeacher: true })
    // 記録の無い机: 講師・授業・メモのどれも持ち込まない(従来どおり)。
    expect(reloaded.desks[2].lesson).toBeUndefined()
    expect(reloaded.desks[2].memoSlots).toBeUndefined()
    expect(reloaded.desks[2].teacher).toBe('')
    expect(reloaded.desks[2].manualTeacher).toBeFalsy()
    expect(reloaded.desks[2].teacherAssignmentSource).toBeUndefined()
  })

  it('★休日 → 再マージ → 休日解除 → 再マージ: 記録のある机の講師が元のまま戻り、足場講師は二重に置かれない(INV-01)', () => {
    const teachers = [
      { id: 'tA', name: '講師A', email: '', entryDate: '2020-04-01', withdrawDate: '', subjectCapabilities: [] },
      { id: 'tB', name: '講師B', email: '', entryDate: '2020-04-01', withdrawDate: '', subjectCapabilities: [] },
    ]
    const scaffoldRow = (id: string, teacherId: string) => ({
      id, schoolYear: 2026, teacherId, student1Id: '', subject1: '', startDate: '', endDate: '',
      student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
      nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 1,
    })
    const regularLessons = [scaffoldRow('row-a', 'tA'), scaffoldRow('row-b', 'tB')]
    const openSettings: ClassroomSettings = { ...baseSettings, holidayDates: [] }
    const run = (week: SlotCell[], settings: ClassroomSettings) => remergeBoardWeekWithManagedData(week, {
      classroomSettings: settings, teachers, students: [], regularLessons, suppressedRegularLessonOccurrences: [], todayKey: '2026-09-16',
    })

    // 営業日の盤面: テンプレ足場講師 A/B の机に、出欠記録(holiday は休日設定で作られた記録・attended は OFF 経路でも残る記録)。
    const openWeek = run([stubCell(HOLIDAY)], openSettings)
    const openCell = findCell(openWeek, HOLIDAY)
    const deskIndexOf = (cell: SlotCell, name: string) => cell.desks.findIndex((desk) => desk.teacher === name)
    const indexA = deskIndexOf(openCell, '講師A')
    const indexB = deskIndexOf(openCell, '講師B')
    expect(indexA).toBeGreaterThanOrEqual(0)
    expect(indexB).toBeGreaterThanOrEqual(0)
    openCell.desks[indexA] = { ...openCell.desks[indexA], statusSlots: [statusEntry({ id: 'rec-a', status: 'holiday', teacherName: '講師A', dateKey: HOLIDAY, slotNumber: 1 }), null] }
    openCell.desks[indexB] = { ...openCell.desks[indexB], statusSlots: [statusEntry({ id: 'rec-b', status: 'attended', teacherName: '講師B', dateKey: HOLIDAY, slotNumber: 1, managedStudentId: 'student-2', studentId: 'student-2' }), null] }

    const closed = findCell(run(openWeek, baseSettings), HOLIDAY)
    expect(closed.isOpenDay).toBe(false)
    const reopenedWeek = run(run([closed], baseSettings), openSettings)
    const reopened = findCell(reopenedWeek, HOLIDAY)
    expect(reopened.isOpenDay).toBe(true)
    for (const [index, recordId, teacherName] of [[indexA, 'rec-a', '講師A'], [indexB, 'rec-b', '講師B']] as const) {
      const desk = reopened.desks[index]
      expect(desk.statusSlots?.[0]?.id).toBe(recordId)
      expect(desk.teacher).toBe(teacherName)
      // 記録の teacherName と机の講師が一致(講師日程表・給与の帰属がずれない)。
      expect(desk.statusSlots?.[0]?.teacherName).toBe(desk.teacher)
    }
    expect(reopened.desks.filter((desk) => desk.teacher === '講師A')).toHaveLength(1)
    expect(reopened.desks.filter((desk) => desk.teacher === '講師B')).toHaveLength(1)
  })

  it('机数を減らした(盤面 3 机・管理側 2 机)ときの 3 机目の記録は引き継がない(現挙動の固定)', () => {
    // 営業日側でも normalizeWeeksDeskCount が机数設定で切り詰める既存挙動と同じ(机数設定が正)。
    // 変えるなら営業日側と同時に仕様改定すること。
    const closedManaged: SlotCell = { ...stubCell(HOLIDAY), isOpenDay: false, desks: [{ id: 'm-0', teacher: '' }, { id: 'm-1', teacher: '' }] }
    const board: SlotCell = {
      ...stubCell(HOLIDAY),
      isOpenDay: false,
      desks: [
        { id: 'b-0', teacher: '講師A', statusSlots: [statusEntry({ id: 'rec-0', status: 'holiday' }), null] },
        { id: 'b-1', teacher: '' },
        { id: 'b-2', teacher: '講師C', statusSlots: [statusEntry({ id: 'rec-2', status: 'absent' }), null] },
      ],
    }
    const carried = carryBoardStatusRecordsOntoClosedDayCell(closedManaged, board)
    expect(carried.desks).toHaveLength(2)
    expect(carried.desks[0].statusSlots?.[0]?.id).toBe('rec-0')
    expect(carried.desks[1].statusSlots).toBeUndefined()
    expect(carried.desks.flatMap((desk) => desk.statusSlots ?? []).some((entry) => entry?.id === 'rec-2')).toBe(false)
  })

  it('★再マージの前後で未消化振替の origin(休みにした振替コマの算出 origin)が変わらない', () => {
    const roster = [{ id: 'student-1', name: '大槻 太郎', displayName: '大槻 太郎', email: '', entryDate: '2020-04-01', withdrawDate: '', birthDate: '2013-05-01' } as StudentRow]
    const week = remerge([stubCell(HOLIDAY)], baseSettings)
    const cell = findCell(week, HOLIDAY)
    cell.desks[0] = {
      ...cell.desks[0],
      statusSlots: [statusEntry({
        id: 'rec-absent-makeup', status: 'absent', lessonType: 'makeup', dateKey: HOLIDAY, slotNumber: 1,
        makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
      }), null],
    }
    const origins = (weeks: SlotCell[][]) => collectMakeupOriginDatesByKey({
      students: roster,
      regularLessons: [],
      classroomSettings: baseSettings,
      weeks,
      manualAdjustments: {},
      resolveStudentKey: (entry: StudentEntry) => entry.managedStudentId ?? entry.name,
      today: new Date(2026, 8, 16),
    })
    const before = origins([week])
    expect(Object.values(before).flat()).toContain('2026-09-30#1')
    expect(origins([remerge(week, baseSettings)])).toEqual(before)
  })

  it('★再マージを 2 回通しても記録は残る(読込 → 設定変更 effect の連続)', () => {
    const week = buildWeekWithRecords(HOLIDAY, baseSettings)
    const twice = findCell(remerge(remerge(week, baseSettings), baseSettings), HOLIDAY)
    expect(twice.desks[0].statusSlots?.map((entry) => entry?.id)).toEqual(['status-holiday', 'status-moved'])
    expect(twice.desks[1].statusSlots?.[0]?.id).toBe('status-absent')
  })

  it('対照: 営業日セルでも記録は残る(従来どおり)', () => {
    const week = buildWeekWithRecords(OPEN_DAY, baseSettings)
    const reloaded = findCell(remerge(week, baseSettings), OPEN_DAY)
    expect(reloaded.isOpenDay).toBe(true)
    expect(reloaded.desks[0].statusSlots?.map((entry) => entry?.id)).toEqual(['status-holiday', 'status-moved'])
    expect(reloaded.desks[1].statusSlots?.[0]?.id).toBe('status-absent')
  })

  it('★定休日(closedWeekdays)へ後から変えたセルでも記録は残る(フラグ OFF でも通る経路)', () => {
    const week = buildWeekWithRecords(OPEN_DAY, baseSettings)
    const tuesdayClosed: ClassroomSettings = { ...baseSettings, closedWeekdays: [0, 2] }
    const reloaded = findCell(remerge(week, tuesdayClosed), OPEN_DAY)
    expect(reloaded.isOpenDay).toBe(false)
    expect(reloaded.desks[0].statusSlots?.map((entry) => entry?.id)).toEqual(['status-holiday', 'status-moved'])
    expect(reloaded.desks[1].statusSlots?.[0]?.id).toBe('status-absent')
    expect(reloaded.desks[0].lesson).toBeUndefined()
  })

  it('★テンプレ固定日をまたぐ週(Mixed week): 固定日以降の休日セルでも記録が残り、授業は持ち込まない', () => {
    const mixed: ClassroomSettings = { ...baseSettings, templateFreezeBeforeDate: OPEN_DAY }
    const week = buildWeekWithRecords(HOLIDAY, mixed)
    const reloaded = findCell(remerge(week, mixed), HOLIDAY)
    expect(reloaded.desks[0].statusSlots?.map((entry) => entry?.id)).toEqual(['status-holiday', 'status-moved'])
    expect(reloaded.desks[1].statusSlots?.[0]?.id).toBe('status-absent')
    expect(reloaded.desks[0].lesson).toBeUndefined()
  })

  it('テンプレ固定日より前の週: 再マージしない(盤面そのまま)ので記録も残る', () => {
    const frozen: ClassroomSettings = { ...baseSettings, templateFreezeBeforeDate: '2026-12-01' }
    const week = buildWeekWithRecords(HOLIDAY, baseSettings)
    const reloaded = findCell(remerge(week, frozen), HOLIDAY)
    expect(reloaded.desks[0].statusSlots?.map((entry) => entry?.id)).toEqual(['status-holiday', 'status-moved'])
    expect(reloaded.desks[1].statusSlots?.[0]?.id).toBe('status-absent')
  })

  it('純関数: 記録の無い休日セルは管理側セルをそのまま返す(参照同一)', () => {
    const managed = findCell(remerge([stubCell(HOLIDAY)], baseSettings), HOLIDAY)
    const board = findCell(remerge([stubCell(HOLIDAY)], baseSettings), HOLIDAY)
    expect(carryBoardStatusRecordsOntoClosedDayCell(managed, board)).toBe(managed)
  })
})

// ============================================================================
// 行: 休日解除後の holiday 記録の席 × 席操作(オーナー要望 2026-09-16)
//   「休日解除したら、その席はできるだけ休日設定前と同じ操作ができる」。
//   holiday 記録の席は moved 記録の席と同じ扱い: 営業日ならメニューは 生徒追加/体験/メモ/表示解除、
//   生徒を移動/入替で着地させると前の人の印として(moved と同じく)消える。
//   ★在庫会計は不変(holiday は表示専用)。absent/振無休の保持(Issue #57)は変えない。
// ============================================================================
describe('INV-06 マトリクス: 休日解除後の holiday 記録の席は moved 記録の席と同じ操作ができる', () => {
  const SOURCE_DATE = '2026-10-05'
  const TARGET_DATE = '2026-10-07'
  const moveDefaults = {
    suppressedRegularLessonOccurrences: [] as string[],
    managedStudentByAnyName: new Map<string, never>(),
    resolveBoardStudentDisplayName: (name: string) => name,
  }

  function slotCell(dateKey: string, desks: DeskCell[]): SlotCell {
    return { ...CELL, id: `${dateKey}_1`, dateKey, slotNumber: 1, slotLabel: '1限', isOpenDay: true, desks }
  }

  function movingStudent(overrides: Partial<StudentEntry> = {}) {
    return student({ id: `sA_${SOURCE_DATE}_数`, name: '生徒A', managedStudentId: 'sA', ...overrides })
  }

  function holidayRecord(id: string) {
    return statusEntry({ id, status: 'holiday', dateKey: TARGET_DATE, slotNumber: 1, name: '休日の子', managedStudentId: 'sH', studentId: 'sH' })
  }

  function absentRecord(id: string) {
    return statusEntry({ id, status: 'absent', dateKey: TARGET_DATE, slotNumber: 1, name: '休んだ子', managedStudentId: 'sX', studentId: 'sX' })
  }

  function runMove(cells: SlotCell[], movingStudentId: string, target: { cellId: string; deskIndex: number; studentIndex: number }) {
    const result = computeStudentMove({ weeks: [cells], weekIndex: 0, cells, movingStudentId, ...target, ...moveDefaults })
    if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
    return result
  }

  it('★別日の holiday 記録の席へ移動すると holiday 記録は消える(moved と同じ)。隣の席の absent は保持', () => {
    const cells = [
      slotCell(SOURCE_DATE, [{ id: 'src-0', teacher: '講師S', lesson: { id: 'l-src', studentSlots: [movingStudent(), null] } }]),
      slotCell(TARGET_DATE, [{ id: 'tgt-0', teacher: '講師T', statusSlots: [holidayRecord('status-holiday'), absentRecord('status-absent')] }]),
    ]
    const result = runMove(cells, `sA_${SOURCE_DATE}_数`, { cellId: `${TARGET_DATE}_1`, deskIndex: 0, studentIndex: 0 })
    const targetDesk = result.nextWeeks[0].find((cell) => cell.dateKey === TARGET_DATE)?.desks[0]
    expect(targetDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(targetDesk?.statusSlots?.[0] ?? null).toBeNull()
    expect(targetDesk?.statusSlots?.[1]).toMatchObject({ id: 'status-absent', status: 'absent' })
    // 着地側の印の消去は「上書きで消えた会計記録」ではないので displaced に出さない(moved と同じ)。
    expect(result.displacedStatusEntries).toEqual([])
  })

  it('対照(Issue #57 不変): absent 記録の席へ移動しても absent は保持される', () => {
    const cells = [
      slotCell(SOURCE_DATE, [{ id: 'src-0', teacher: '講師S', lesson: { id: 'l-src', studentSlots: [movingStudent(), null] } }]),
      slotCell(TARGET_DATE, [{ id: 'tgt-0', teacher: '講師T', statusSlots: [absentRecord('status-absent'), null] }]),
    ]
    const result = runMove(cells, `sA_${SOURCE_DATE}_数`, { cellId: `${TARGET_DATE}_1`, deskIndex: 0, studentIndex: 0 })
    const targetDesk = result.nextWeeks[0].find((cell) => cell.dateKey === TARGET_DATE)?.desks[0]
    expect(targetDesk?.statusSlots?.[0]).toMatchObject({ id: 'status-absent', status: 'absent' })
  })

  it('★入替: 着地側と入替で戻る側の両方で holiday 記録が消える(moved と同じ)', () => {
    const partner = student({ id: `sB_${TARGET_DATE}_英`, name: '生徒B', managedStudentId: 'sB', subject: '英' })
    const cells = [
      slotCell(TARGET_DATE, [
        { id: 'a-0', teacher: '講師S', lesson: { id: 'l-a', studentSlots: [movingStudent({ id: `sA_${TARGET_DATE}_数` }), null] }, statusSlots: [holidayRecord('status-holiday-src'), null] },
        { id: 'b-0', teacher: '講師T', lesson: { id: 'l-b', studentSlots: [partner, null] }, statusSlots: [holidayRecord('status-holiday-tgt'), null] },
      ]),
    ]
    const result = runMove(cells, `sA_${TARGET_DATE}_数`, { cellId: `${TARGET_DATE}_1`, deskIndex: 1, studentIndex: 0 })
    const [deskA, deskB] = result.nextWeeks[0][0].desks
    expect(deskB.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(deskA.lesson?.studentSlots[0]?.managedStudentId).toBe('sB')
    expect(deskB.statusSlots?.[0] ?? null).toBeNull()
    expect(deskA.statusSlots?.[0] ?? null).toBeNull()
  })

  it('対照: 入替でも absent は両側で保持される', () => {
    const partner = student({ id: `sB_${TARGET_DATE}_英`, name: '生徒B', managedStudentId: 'sB', subject: '英' })
    const cells = [
      slotCell(TARGET_DATE, [
        { id: 'a-0', teacher: '講師S', lesson: { id: 'l-a', studentSlots: [movingStudent({ id: `sA_${TARGET_DATE}_数` }), null] }, statusSlots: [absentRecord('status-absent-src'), null] },
        { id: 'b-0', teacher: '講師T', lesson: { id: 'l-b', studentSlots: [partner, null] }, statusSlots: [absentRecord('status-absent-tgt'), null] },
      ]),
    ]
    const result = runMove(cells, `sA_${TARGET_DATE}_数`, { cellId: `${TARGET_DATE}_1`, deskIndex: 1, studentIndex: 0 })
    const [deskA, deskB] = result.nextWeeks[0][0].desks
    expect(deskA.statusSlots?.[0]?.id).toBe('status-absent-src')
    expect(deskB.statusSlots?.[0]?.id).toBe('status-absent-tgt')
  })

  it('★holiday 記録が上書きで消えても台帳は動かない(materialize 対象外・振替コマの holiday でも)', () => {
    const makeupHoliday = statusEntry({
      id: 'status-holiday-makeup',
      status: 'holiday',
      lessonType: 'makeup',
      makeupSourceDate: '2026-09-30',
      makeupSourceLabel: '2026/9/30(水) 1限',
    })
    const result = materializeDisplacedStatusEntryIntoLedgers({
      statusEntry: makeupHoliday,
      manualMakeupAdjustments: {},
      fallbackMakeupStudents: {},
      ledgerOriginDatesByKey: {},
      managedStudentByAnyName: new Map(),
      resolveDisplayName: (name: string) => name,
      resolveStockId: (entry: StudentEntry) => entry.managedStudentId ?? entry.name,
    })
    expect(result.materialized).toBe(false)
    expect(result.manualMakeupAdjustments).toEqual({})
    expect(result.fallbackMakeupStudents).toEqual({})
  })

  it('isStaleSeatMarkerStatus: moved と holiday だけが「前の人の印」(absent/振無休/出席は含めない)', () => {
    expect(isStaleSeatMarkerStatus('moved')).toBe(true)
    expect(isStaleSeatMarkerStatus('holiday')).toBe(true)
    expect(isStaleSeatMarkerStatus('absent')).toBe(false)
    expect(isStaleSeatMarkerStatus('absent-no-makeup')).toBe(false)
    expect(isStaleSeatMarkerStatus('attended')).toBe(false)
    expect(isStaleSeatMarkerStatus(null)).toBe(false)
  })

  it('★空き席メニュー: 営業日の holiday は moved と同じメニュー、休日中の holiday は解除だけ', () => {
    expect(resolveEmptySeatMenuVariant('holiday', true)).toBe('display-record')
    expect(resolveEmptySeatMenuVariant('moved', true)).toBe('display-record')
    expect(resolveEmptySeatMenuVariant('holiday', false)).toBe('holiday-clear-only')
    // 休日中のセルの moved(丸ごと振替→休日設定で残る移動元)も解除だけ。従来はクリック時に弾かれ到達しなかった分岐。
    expect(resolveEmptySeatMenuVariant('moved', false)).toBe('holiday-clear-only')
    // 既存の分岐は不変。
    expect(resolveEmptySeatMenuVariant('attended', true)).toBe('attended')
    expect(resolveEmptySeatMenuVariant('absent', true)).toBe('absent')
    expect(resolveEmptySeatMenuVariant('absent-no-makeup', true)).toBe('absent-no-makeup')
    expect(resolveEmptySeatMenuVariant(null, true)).toBe('empty')
    expect(resolveEmptySeatMenuVariant(undefined, false)).toBe('empty')
  })

  it('空き席メニューの解除ボタン: holiday は「休日記録の表示解除」、moved は従来の文言/testid(フラグ ON/OFF)', () => {
    expect(resolveDisplayRecordClearButton('holiday', true)).toEqual({ label: '休日記録の表示解除', testId: 'menu-clear-holiday-button' })
    expect(resolveDisplayRecordClearButton('holiday', false)).toEqual({ label: '休日記録の表示解除', testId: 'menu-clear-holiday-button' })
    expect(resolveDisplayRecordClearButton('moved', true)).toEqual({ label: '休)表示解除(移動元)', testId: 'menu-clear-moved-button' })
    expect(resolveDisplayRecordClearButton('moved', false)).toEqual({ label: '移動元表示解除', testId: 'menu-clear-moved-button' })
  })
})

// ============================================================================
// 行: 休日解除 × 席の復元・在庫の巻き戻し（オーナー確定 2026-09-20・確認リスト r-5 要改善）
//
// 改定: 従来の休日解除は「holidayDates から外して、その曜日のテンプレ通常授業を全部抑止する」だけで、
// 「休)」= holiday 記録は残ったまま席へ戻らなかった（§B-2-2c 旧「休日解除側は変更しない」）。
// オーナー確定で **休日解除は休日設定の逆操作** になった:
//   1. holiday 記録の生徒を元の席・科目・講師の机へ戻す。
//   2. 休日設定で増えた未消化（振替 origin / 講習 +1）を**控え(holidayStockReturn)どおりに**巻き戻す
//      ＝設定→解除の往復で台帳が**完全一致**する。
//   3. その未消化を既に別日へ組んでいたら、その振替/講習コマを盤面から消す（消した件数を室長に知らせる）。
// 戻せないものは触らない（記録も台帳もそのまま・件数だけ返す）: 控えの無い旧データ／席が別の生徒で埋まっている／
// 別日のコマに出欠記録がある（実施済みの授業は消さない）。
//
// ★個別ボタン「休日記録の表示解除」の仕様は**変えていない**（上の「記録を消すだけ」assert は不変で維持）。
// ============================================================================
describe('INV-06 マトリクス: 休日解除は休日設定の逆操作(席へ復元・在庫巻き戻し・別日の振替は消す)', () => {
  const RELEASE_DATE = '2026-10-07' // 水
  const ALT_DATE = '2026-10-09' // 金（別日に組んだ振替を置く日）
  const MANAGED_LESSON_ID = 'managed_row1_2026-10-07'
  const STOCK_KEY = buildMakeupStockKey('student-1', '数')

  type Ledgers = Parameters<typeof computeHolidayReleaseRestoration>[0]['ledgers']

  const roster = new Map<string, StudentRow>([['大槻 太郎', { id: 'student-1', name: '大槻 太郎' } as StudentRow]])
  const resolveDisplayName = (name: string) => name
  const resolveStockId = (entry: StudentEntry) => entry.managedStudentId ?? roster.get(entry.name)?.id ?? `name:${entry.name}`

  function emptyLedgers(overrides: Partial<Ledgers> = {}): Ledgers {
    return {
      manualLectureStockCounts: {},
      manualLectureStockOrigins: {},
      manualMakeupAdjustments: {},
      fallbackLectureStockStudents: {},
      fallbackMakeupStudents: {},
      ...overrides,
    }
  }

  function cellOn(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
    return { ...CELL, id: `${dateKey}_${slotNumber}`, dateKey, slotNumber, slotLabel: `${slotNumber}限`, isOpenDay: true, desks }
  }

  function managedDesk(studentSlots: [StudentEntry | null, StudentEntry | null]): DeskCell {
    return { id: 'desk-1', teacher: '田中講師', lesson: { id: MANAGED_LESSON_ID, note: '管理データ反映', studentSlots } }
  }

  function regularStudent(overrides: Partial<StudentEntry> = {}) {
    return student({ id: `sA_${RELEASE_DATE}_数`, ...overrides })
  }

  function findDesk(weeks: SlotCell[][], dateKey: string, deskIndex = 0) {
    const cell = weeks.flat().find((entry) => entry.dateKey === dateKey)
    if (!cell) throw new Error(`cell not found: ${dateKey}`)
    return cell.desks[deskIndex]
  }

  // 休日設定ハンドラと同じ順序（在庫戻し → 記録変換）で 1 日分を休日にする。
  function runHolidaySet(params: { weeks: SlotCell[][]; ledgers: Ledgers; enabled?: boolean; ledgerOriginDatesByKey?: Record<string, string[]> }) {
    const nextWeeks = structuredClone(params.weeks)
    let ledgers = params.ledgers
    for (const week of nextWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== RELEASE_DATE) continue
        for (const desk of cell.desks) {
          const result = reconcileHolidayDeskStockReturns({
            desk,
            cellDateKey: cell.dateKey,
            cellSlotNumber: cell.slotNumber,
            ledgers,
            managedStudentByAnyName: roster,
            resolveDisplayName,
            resolveStockId,
            ledgerOriginDatesByKey: params.ledgerOriginDatesByKey ?? {},
          })
          ledgers = result.ledgers
          convertHolidayDeskEntriesToRecords({ desk, cell, enabled: params.enabled ?? true, stockReturns: result.stockReturnStamps })
        }
      }
    }
    return { weeks: nextWeeks, ledgers }
  }

  function runHolidayRelease(weeks: SlotCell[][], ledgers: Ledgers) {
    return computeHolidayReleaseRestoration({
      weeks,
      dateKey: RELEASE_DATE,
      ledgers,
      managedStudentByAnyName: roster,
      resolveDisplayName,
      resolveStockId,
    })
  }

  function makeupOnAltDate(overrides: Partial<StudentEntry> = {}) {
    return student({
      id: `sA_${ALT_DATE}_数`,
      lessonType: 'makeup',
      makeupSourceDate: RELEASE_DATE,
      makeupSourceLabel: '2026/10/7(水) 1限',
      ...overrides,
    })
  }

  it('★(a)(b) 通常授業: 設定→解除の往復で席が元の机・科目・講師で戻り、台帳は休日設定前と完全一致する', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]

    const set = runHolidaySet({ weeks, ledgers: before })
    // 休日設定: 振替 origin が 1 件積まれ、記録に「返した控え」が載る。
    expect(set.ledgers.manualMakeupAdjustments).toEqual({ [STOCK_KEY]: [{ dateKey: RELEASE_DATE }] })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]).toMatchObject({
      status: 'holiday',
      holidayStockReturn: { kind: 'makeup', originDateKey: RELEASE_DATE, fallbackAdded: false },
    })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    expect(desk.lesson?.id).toBe(MANAGED_LESSON_ID)
    expect(desk.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', subject: '数', lessonType: 'regular' })
    expect(desk.teacher).toBe('田中講師')
    expect(desk.statusSlots).toBeUndefined()
    expect(released.ledgers).toEqual(before) // ★往復で台帳が完全一致（誤増も誤減も無い）
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.removedMakeups).toEqual([])
    expect(released.skipped).toEqual([])
    // 復元した通常授業の抑止キーは呼び出し側で**積まない/外す**ためのもの。
    expect(released.restoredOccurrenceKeys).toEqual([`student-1__数__${RELEASE_DATE}__1`])
  })

  it('★(c) 別日に組んだ振替コマは消え、在庫は中立(origin を外す ＋ 消化が減る で ±0)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    // 未消化になった振替を別日(10/9 2限)へ組んだ状態を作る。
    findDesk(set.weeks, ALT_DATE).lesson = { id: 'alt-lesson', studentSlots: [makeupOnAltDate(), null] }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined() // 別日のコマは消える
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]?.managedStudentId).toBe('student-1')
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(released.ledgers).toEqual(before) // 消化 −1 と origin 除去が打ち消し合う
  })

  it('★(d) 別日の振替に出欠記録(出席)が付いていたら、そのコマは消さず復元をスキップする', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    findDesk(set.weeks, ALT_DATE).statusSlots = [statusEntry({
      id: 'alt-attended', status: 'attended', lessonType: 'makeup', dateKey: ALT_DATE, slotNumber: 2,
      makeupSourceDate: RELEASE_DATE, makeupSourceLabel: '2026/10/7(水) 1限',
    }), null]

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'makeup-in-record' }])
    expect(released.restoredStudentNames).toEqual([])
    expect(findDesk(released.nextWeeks, ALT_DATE).statusSlots?.[0]?.id).toBe('alt-attended') // 実施済みの授業は消さない
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.status).toBe('holiday') // 記録は残す
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson).toBeUndefined()
    expect(released.ledgers).toEqual(set.ledgers) // 台帳も触らない
  })

  it('★(e) absent / moved の記録は復元対象にしない(会計の根拠・移動先の会計を壊さない)', () => {
    const ledgers = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [{
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [
        statusEntry({ id: 'status-absent', status: 'absent', dateKey: RELEASE_DATE, slotNumber: 1 }),
        statusEntry({ id: 'status-moved', status: 'moved', dateKey: RELEASE_DATE, slotNumber: 1, moveDestinationDateKey: ALT_DATE, moveDestinationSlotNumber: 2 }),
      ],
    }])]]

    const released = runHolidayRelease(weeks, ledgers)
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    expect(desk.statusSlots?.map((entry) => entry?.id)).toEqual(['status-absent', 'status-moved'])
    expect(desk.lesson).toBeUndefined()
    expect(released.restoredStudentNames).toEqual([])
    expect(released.skipped).toEqual([])
    expect(released.ledgers).toEqual(ledgers)
  })

  it('★(f) 席が別の生徒で埋まっていたら復元しない(上書きせず記録も台帳も残す)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    // 休日中/解除後にその席へ別の生徒を組んだ状態（記録は生徒の下に隠れている）。
    findDesk(set.weeks, RELEASE_DATE).lesson = {
      id: 'other-lesson',
      studentSlots: [student({ id: 'other', name: '別の子', managedStudentId: 'student-2' }), null],
    }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'seat-taken' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]?.managedStudentId).toBe('student-2')
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.status).toBe('holiday')
    expect(released.ledgers).toEqual(set.ledgers)
  })

  it('★(g) 解除 → 再マージ 2 回でも席は 1 つだけ・台帳も不変(INV-03 / INV-12)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    const released = runHolidayRelease(set.weeks, set.ledgers)

    // テンプレ側(管理セル)は同じ managed lesson を持つ。抑止キーは**積まない**(復元したので)。
    const managedCell = cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])
    const boardCell = released.nextWeeks.flat().find((cell) => cell.dateKey === RELEASE_DATE)
    if (!boardCell) throw new Error('board cell not found')
    const once = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]], [])[0]
    const twice = overlayBoardWeeksOnScheduleCells([managedCell], [[once]], [])[0]
    const placements = twice.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((entry) => entry?.managedStudentId === 'student-1')
    expect(placements).toHaveLength(1)
    expect(twice.desks.flatMap((desk) => desk.statusSlots ?? []).filter((entry) => entry)).toEqual([])
    expect(released.ledgers).toEqual(before)

    // 対照(この改定の要): 復元したのに抑止を積むと、再マージでテンプレ授業が消され戻した席まで落ちる。
    const suppressed = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]], [`student-1__数__${RELEASE_DATE}__1`])[0]
    expect(suppressed.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((entry) => entry)).toEqual([])
  })

  it('★(h) 機能フラグ OFF: holiday 記録が作られないので解除は従来どおり何も戻さない', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]
    const set = runHolidaySet({ weeks, ledgers: before, enabled: false })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots).toBeUndefined()

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.restoredStudentNames).toEqual([])
    expect(released.removedMakeups).toEqual([])
    expect(released.skipped).toEqual([])
    expect(released.ledgers).toEqual(set.ledgers) // 休日設定で積んだ origin はそのまま(従来の挙動)
  })

  it('★講習(session): 往復で希望数デルタと origin が完全一致する(別日に組んでいないとき)', () => {
    const lectureStockKey = buildLectureStockKey('student-1', '数', 'sess-1')
    const before = emptyLedgers({ manualLectureStockCounts: { [lectureStockKey]: -1 } }) // 1 コマ配置済み＝消化 −1
    const lecture = student({
      id: `sA_${RELEASE_DATE}_講`,
      lessonType: 'special',
      specialStockSource: 'session',
      specialSessionId: 'sess-1',
      makeupSourceDate: '2026-09-20',
      makeupSourceLabel: '2026/9/20(日) 3限',
    })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([lecture, null])])]]

    const set = runHolidaySet({ weeks, ledgers: before })
    expect(set.ledgers.manualLectureStockCounts).toEqual({ [lectureStockKey]: 0 }) // 在庫へ +1
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({
      kind: 'lecture', originDateKey: '2026-09-20', originSlotNumber: 3, fallbackAdded: false,
    })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'special', specialSessionId: 'sess-1' })
    expect(released.ledgers).toEqual(before)
  })

  it('★講習(session)を別日へ組んでいたとき: そのコマを消し、台帳は触らない(設定の +1 と配置の −1 が打ち消し合う)', () => {
    const lectureStockKey = buildLectureStockKey('student-1', '数', 'sess-1')
    const lecture = student({
      id: `sA_${RELEASE_DATE}_講`,
      lessonType: 'special',
      specialStockSource: 'session',
      specialSessionId: 'sess-1',
      makeupSourceDate: '2026-09-20',
      makeupSourceLabel: '2026/9/20(日) 3限',
    })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([lecture, null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: emptyLedgers({ manualLectureStockCounts: { [lectureStockKey]: -1 } }) })
    // 別日へ組み直した状態: 配置で −1 と origin 消費（= 休日設定の +1 / origin 追加を打ち消した状態）。
    findDesk(set.weeks, ALT_DATE).lesson = { id: 'alt-lesson', studentSlots: [{ ...lecture, id: `sA_${ALT_DATE}_講` }, null] }
    const afterPlacement: Ledgers = {
      ...set.ledgers,
      manualLectureStockCounts: { [lectureStockKey]: -1 },
      manualLectureStockOrigins: {},
    }

    const released = runHolidayRelease(set.weeks, afterPlacement)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined()
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'special' }])
    expect(released.ledgers.manualLectureStockCounts).toEqual({ [lectureStockKey]: -1 })
    expect(released.ledgers.manualLectureStockOrigins).toEqual({})
  })

  it('★在庫由来の振替を出席にしてから休日にした記録: 控えは none で、解除は席へ戻すだけ(台帳を触らない)', () => {
    // 台帳に origin がある＝盤面から外れれば自動で再浮上する振替。設定時に積まないので解除でも外さない。
    const ledgers = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: '2026-09-30' }] } })
    const weeks = [[cellOn(RELEASE_DATE, 1, [{
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [statusEntry({
        id: 'status-attended-makeup', status: 'attended', lessonType: 'makeup', dateKey: RELEASE_DATE, slotNumber: 1,
        makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
      }), null],
    }])]]

    const set = runHolidaySet({ weeks, ledgers, ledgerOriginDatesByKey: { [STOCK_KEY]: ['2026-09-30'] } })
    expect(set.ledgers).toEqual(ledgers) // 二重計上しない(既に台帳にある)
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'none' })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    expect(released.ledgers).toEqual(ledgers)
  })

  it('★控えが無い記録(この改定より前のデータ)は復元しない: 巻き戻し量が決められないので安全側', () => {
    const ledgers = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: RELEASE_DATE }] } })
    const weeks = [[cellOn(RELEASE_DATE, 1, [{
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [statusEntry({ id: 'legacy-holiday', status: 'holiday', dateKey: RELEASE_DATE, slotNumber: 1 }), null],
    }])]]

    const released = runHolidayRelease(weeks, ledgers)
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'legacy-record' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.id).toBe('legacy-holiday')
    expect(released.ledgers).toEqual(ledgers)
  })

  it('純関数: 入力の weeks と台帳は書き換えない(commitWeeks 1 回で確定できる形)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    const snapshot = structuredClone(set.weeks)
    const ledgerSnapshot = structuredClone(set.ledgers)

    runHolidayRelease(set.weeks, set.ledgers)
    expect(set.weeks).toEqual(snapshot)
    expect(set.ledgers).toEqual(ledgerSnapshot)
  })

  it('戻せなかった理由のまとめ文(確認ダイアログと完了メッセージで共有)', () => {
    expect(summarizeHolidayReleaseSkips([
      { reason: 'seat-taken' },
      { reason: 'seat-taken' },
      { reason: 'makeup-in-record' },
    ])).toBe('席に別の生徒がいるため2件・別日に組んだコマに出欠記録があるため1件')
    expect(summarizeHolidayReleaseSkips([])).toBe('')
  })
})
