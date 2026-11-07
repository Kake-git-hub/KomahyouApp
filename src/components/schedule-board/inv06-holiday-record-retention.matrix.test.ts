import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import type { ClassroomSettings } from '../../types/appState'
import {
  applyStudentEdit,
  carryBoardStatusRecordsOntoClosedDayCell,
  clearMakeupOrigins,
  clearStudentStatusFromDesk,
  buildStudentStatusEntry,
  collectClearedDayMakeupSuppressions,
  collectHolidayTemplateSubjectSuppressions,
  computeDeletedLessonMakeupSuppressions,
  computeStoredLessonMakeupLedgers,
  computeStudentAbsentMark,
  ensureTemplateSubjectMakeupSuppression,
  computeHolidayReleaseRestoration,
  computePendingDeskResolution,
  computeStudentMove,
  resolveLessonMakeupOriginSlotNumber,
  convertHolidayDeskEntriesToRecords,
  isStaleSeatMarkerStatus,
  materializeDisplacedStatusEntryIntoLedgers,
  overlayBoardWeeksOnScheduleCells,
  reconcileHolidayDeskStockReturns,
  remergeBoardWeekWithManagedData,
  remergeBoardWeeksWithManagedData,
  resolveDisplayRecordClearButton,
  resolveEmptySeatMenuVariant,
  summarizeHolidayReleaseSkips,
} from './ScheduleBoardScreen'
import { buildLectureStockKey } from './lectureStock'
import { buildMakeupStockEntries, buildMakeupStockKey, collectMakeupOriginDatesByKey, resolveDeletedLessonSuppressionOrigin } from './makeupStock'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import * as FX from './templateTransferFollow.fixture'
import * as pairFx from './wholeDayTransferPair.fixture'

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
  // `includeManualAddedLessons` はハンドラが常に true を渡す(2026-10-07・Issue #73)。省略時(false)は「この改定より前の休日設定」
  // の形＝手動追加に 'none' の控えが付く旧記録を作るのに使う(行(k))。
  function runHolidaySet(params: { weeks: SlotCell[][]; ledgers: Ledgers; enabled?: boolean; ledgerOriginDatesByKey?: Record<string, string[]>; includeManualAddedLessons?: boolean }) {
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
            includeManualAddedLessons: params.includeManualAddedLessons,
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

  // 決定記録 48（2026-10-25・(b)-2・spec-template-behavior §H Q42・templateDiffApply の教室だけ）: 席に別の生徒が居るときは、戻さずに記録を隠すのではなく
  // その机の下段（保留・緑）へ戻す。在庫の巻き戻し・別日のコマの削除は席へ戻したときと同じ（下段の授業も在庫・回数に数える＝INV-06）。
  it('★(f-2) 保留マップを渡す（フラグ ON）: 席が別の生徒で埋まっていたら、その机の下段（保留）へ戻す。記録は消え、台帳は休日設定前と完全一致。抑止キーは外さない', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    findDesk(set.weeks, ALT_DATE).lesson = { id: 'alt-lesson', studentSlots: [makeupOnAltDate(), null] }
    findDesk(set.weeks, RELEASE_DATE).lesson = { id: 'other-lesson', studentSlots: [student({ id: 'other', name: '別の子', managedStudentId: 'student-2' }), null] }

    const inputPending = {}
    const released = computeHolidayReleaseRestoration({
      weeks: set.weeks, dateKey: RELEASE_DATE, ledgers: set.ledgers, managedStudentByAnyName: roster, resolveDisplayName, resolveStockId,
      templatePendingDesks: inputPending, createdAt: '2026-10-25T09:00:00.000Z',
    })
    expect(released.skipped).toEqual([])
    expect(released.restoredStudentNames).toEqual([])
    expect(released.pendingRestoredStudentNames).toEqual(['大槻 太郎'])
    // 上段は席に居る生徒のまま・記録は消える・別日のコマは消える・台帳は往復で完全一致
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    expect(desk.lesson?.studentSlots[0]?.managedStudentId).toBe('student-2')
    expect(desk.statusSlots).toBeUndefined()
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined()
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(released.ledgers).toEqual(before)
    // 下段: 同じ机・同じ席に通常授業として戻る。理由は休日解除。
    const key = buildTemplatePendingDeskKey(`${RELEASE_DATE}_1`, 'desk-1')
    expect(Object.keys(released.nextTemplatePendingDesks ?? {})).toEqual([key])
    const lower = released.nextTemplatePendingDesks![key]
    // 下段の授業は手入力の印（manualAdded）つき＝保留中の再保存（Q29）や 1 行に戻った後の Q21-8 で落ちない（regression-reviewer H-1）。
    expect(lower.lower.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', subject: '数', lessonType: 'regular', manualAdded: true })
    expect(lower.lower.lesson?.studentSlots[1]).toBeNull()
    expect(lower.origin).toMatchObject({ kind: 'holiday-release-seat-taken' })
    expect(lower.origin?.note).toContain('休日設定の解除')
    // 決定記録 59（2026-11-01）: 席の生徒がテンプレの通常生徒（印なし）のときだけ旧形（戻す授業が下段）。理由文で区別する。
    expect(lower.origin?.note).toContain('戻す授業を下段にしました')
    expect(released.displacedOccupantNames).toEqual([])
    expect(lower.effectiveStartDate).toBe(RELEASE_DATE)
    expect(lower.createdAt).toBe('2026-10-25T09:00:00.000Z')
    // 抑止キーは外さない（外すと再マージがテンプレの授業を別の机へ置き、下段と 2 か所になる＝INV-12）
    expect(released.restoredOccurrenceKeys).toEqual([])
    // 入力の保留マップは変えない（新しい参照を返す）
    expect(inputPending).toEqual({})
    expect(released.nextTemplatePendingDesks).not.toBe(inputPending)
  })

  it('★(f-3) 保留マップを渡しても、同じ机の下段が 2 席とも埋まっていれば従来どおり戻さない（別の机の下段へ勝手に逃がさない・台帳も記録も不変）', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null]), { id: 'desk-2', teacher: '' }])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    findDesk(set.weeks, RELEASE_DATE).lesson = { id: 'other-lesson', studentSlots: [student({ id: 'other', name: '別の子', managedStudentId: 'student-2' }), null] }
    const key = buildTemplatePendingDeskKey(`${RELEASE_DATE}_1`, 'desk-1')
    const fullLower = { [key]: { lower: { lesson: { id: 'lower-full', studentSlots: [student({ id: 'l1', name: '下段1', managedStudentId: 'student-3' }), student({ id: 'l2', name: '下段2', managedStudentId: 'student-4' })] as [StudentEntry, StudentEntry] } }, effectiveStartDate: RELEASE_DATE, createdAt: 'x' } }
    const released = computeHolidayReleaseRestoration({
      weeks: set.weeks, dateKey: RELEASE_DATE, ledgers: set.ledgers, managedStudentByAnyName: roster, resolveDisplayName, resolveStockId, templatePendingDesks: fullLower,
    })
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'seat-taken' }])
    expect(released.pendingRestoredStudentNames).toEqual([])
    expect(released.nextTemplatePendingDesks).toBe(fullLower)
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.status).toBe('holiday')
    expect(released.ledgers).toEqual(set.ledgers)
  })

  it('★(f-4) 下段へ戻した通常授業は、上段の席が空くと Q28 で 1 行に戻る（決定 A）', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    findDesk(set.weeks, RELEASE_DATE).lesson = { id: 'other-lesson', studentSlots: [student({ id: 'other', name: '別の子', managedStudentId: 'student-2' }), null] }
    const released = computeHolidayReleaseRestoration({
      weeks: set.weeks, dateKey: RELEASE_DATE, ledgers: set.ledgers, managedStudentByAnyName: roster, resolveDisplayName, resolveStockId, templatePendingDesks: {},
    })
    const pending = released.nextTemplatePendingDesks!
    // 室長が上段の別の子を（記録を残さず）外した
    const emptied = released.nextWeeks.map((week) => week.map((cell) => (cell.dateKey !== RELEASE_DATE ? cell : { ...cell, desks: cell.desks.map((desk) => ({ ...desk, lesson: undefined })) })))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: released.nextWeeks, previousTemplatePendingDesks: pending, weeks: emptied, templatePendingDesks: pending })
    expect(settled.collapsedKeys).toHaveLength(1)
    expect(settled.nextTemplatePendingDesks).toEqual({})
    expect(findDesk(settled.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular' })
  })

  // ============================================================================
  // 決定記録 59（オーナー決定 2026-11-01「広げる」・(b)-2・spec-template-behavior §H Q42 表 #3）: 緑 2 行の「上段＝テンプレ／下段＝手入力」を休日解除にも。
  // 戻す席に**手入力の印の生徒**（振替・講習・手動追加など）が居れば、戻す通常授業を席（上段）へ置き、席に居た生徒を同じ机・同じ席の下段へ残す。
  // 席の生徒がテンプレの通常生徒（印なし）か机が既に保留のときだけ従来の形（戻す授業が下段・(f-2)〜(f-4)）。
  // ============================================================================
  function occupantMakeup() {
    return student({ id: 'other_mk', name: '別の子', managedStudentId: 'student-2', lessonType: 'makeup', makeupSourceDate: '2026-09-20', makeupSourceLabel: '2026/9/20(日) 3限' })
  }
  function releaseDisplacing(occupant: StudentEntry, extra: { pending?: Record<string, unknown>; other?: StudentEntry | null } = {}) {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before })
    findDesk(set.weeks, ALT_DATE).lesson = { id: 'alt-lesson', studentSlots: [makeupOnAltDate(), null] }
    findDesk(set.weeks, RELEASE_DATE).lesson = { id: 'other-lesson', studentSlots: [occupant, extra.other ?? null] }
    const released = computeHolidayReleaseRestoration({
      weeks: set.weeks, dateKey: RELEASE_DATE, ledgers: set.ledgers, managedStudentByAnyName: roster, resolveDisplayName, resolveStockId,
      templatePendingDesks: (extra.pending ?? {}) as Parameters<typeof computeHolidayReleaseRestoration>[0]['templatePendingDesks'], createdAt: '2026-11-01T09:00:00.000Z',
    })
    return { before, set, released, key: buildTemplatePendingDeskKey(`${RELEASE_DATE}_1`, 'desk-1') }
  }

  it('★(f-5・決定記録 59) 席に手で置いた振替が居れば、戻す通常授業が席（上段）へ戻り、振替は同じ机・同じ席の下段へ（記録は消え・台帳は往復で完全一致・抑止キーは外す）', () => {
    const { before, released, key } = releaseDisplacing(occupantMakeup())
    expect(released.skipped).toEqual([])
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.displacedOccupantNames).toEqual(['別の子'])
    expect(released.pendingRestoredStudentNames).toEqual([])
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    // 上段＝戻した通常授業（印なし・テンプレの出現）。もう一方の席が空なので lesson は記録の元の id で作り直す（再マージの畳み込み・INV-12）。
    expect(desk.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', subject: '数', lessonType: 'regular' })
    expect(desk.lesson?.studentSlots[0]?.manualAdded).toBeFalsy()
    expect(desk.lesson?.id).toBe(MANAGED_LESSON_ID)
    expect(desk.statusSlots).toBeUndefined()
    // 別日のコマは消え、台帳は休日設定前と完全一致（在庫の巻き戻しは席へ戻したときと同じ）
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined()
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(released.ledgers).toEqual(before)
    // 下段＝席に居た手入力の振替（中身はそのまま・由来は押し出し）
    expect(Object.keys(released.nextTemplatePendingDesks ?? {})).toEqual([key])
    const lower = released.nextTemplatePendingDesks![key]
    expect(lower.lower.lesson?.studentSlots[0]).toMatchObject({ id: 'other_mk', managedStudentId: 'student-2', lessonType: 'makeup', makeupSourceDate: '2026-09-20' })
    expect(lower.lower.lesson?.studentSlots[1]).toBeNull()
    expect(lower.origin).toMatchObject({ kind: 'holiday-release-displaced' })
    expect(lower.origin?.note).toContain('休みの間に手で置いた授業を下段（保留）に残しました')
    expect(lower.effectiveStartDate).toBe(RELEASE_DATE)
    expect(lower.createdAt).toBe('2026-11-01T09:00:00.000Z')
    // 席へ戻したので抑止キーは外す（下段に戻した旧形だけが外さない）
    expect(released.restoredOccurrenceKeys).toEqual([`student-1__数__${RELEASE_DATE}__1`])
  })

  it('★(f-6・決定記録 59) 席に手で置いた講習（session）が居ても同じ: 講習は下段へ・講習の台帳は触らない', () => {
    const lecture = student({ id: 'other_lec', name: '別の子', managedStudentId: 'student-2', lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-9' })
    const { before, released, key } = releaseDisplacing(lecture)
    expect(released.displacedOccupantNames).toEqual(['別の子'])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular' })
    expect(released.nextTemplatePendingDesks![key].lower.lesson?.studentSlots[0]).toMatchObject({ id: 'other_lec', lessonType: 'special', specialSessionId: 'sess-9' })
    expect(released.ledgers.manualLectureStockCounts).toEqual(before.manualLectureStockCounts)
    expect(released.ledgers.manualLectureStockOrigins).toEqual(before.manualLectureStockOrigins)
    expect(released.ledgers).toEqual(before)
  })

  it('★(f-7・決定記録 59) 机が既に保留なら押し出さず従来の形（戻す通常授業がその保留の下段へ相乗り・由来は上書きしない）', () => {
    const pending = { [buildTemplatePendingDeskKey(`${RELEASE_DATE}_1`, 'desk-1')]: { lower: { lesson: { id: 'lower-1', studentSlots: [null, student({ id: 'l2', name: '下段2', managedStudentId: 'student-3' })] } }, effectiveStartDate: RELEASE_DATE, createdAt: '2026-10-01T00:00:00.000Z', origin: { kind: 'whole-day-transfer-displaced', note: '前の保留' } } }
    const { released, key } = releaseDisplacing(occupantMakeup(), { pending })
    expect(released.displacedOccupantNames).toEqual([])
    expect(released.pendingRestoredStudentNames).toEqual(['大槻 太郎'])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ id: 'other_mk' })
    const lower = released.nextTemplatePendingDesks![key]
    expect(lower.lower.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', manualAdded: true })
    expect(lower.origin).toMatchObject({ kind: 'whole-day-transfer-displaced' })
    expect(released.restoredOccurrenceKeys).toEqual([])
  })

  it('★(f-8・決定記録 59) 上段・下段とも生きている間は Q28 で自動で 1 行にならず、上段の通常授業を（記録を残さず）外すと下段の振替が席へ戻る', () => {
    const { released, key } = releaseDisplacing(occupantMakeup())
    const pending = released.nextTemplatePendingDesks!
    const unchanged = settleTemplatePendingDesksAfterCommit({ previousWeeks: released.nextWeeks, previousTemplatePendingDesks: pending, weeks: released.nextWeeks, templatePendingDesks: pending })
    expect(unchanged.collapsedKeys).toHaveLength(0)
    expect(unchanged.nextTemplatePendingDesks[key]).toBe(pending[key])
    const emptied = released.nextWeeks.map((week) => week.map((cell) => (cell.dateKey !== RELEASE_DATE ? cell : { ...cell, desks: cell.desks.map((desk) => ({ ...desk, lesson: undefined })) })))
    const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: released.nextWeeks, previousTemplatePendingDesks: pending, weeks: emptied, templatePendingDesks: pending })
    expect(settled.collapsedKeys).toEqual([key])
    expect(settled.nextTemplatePendingDesks).toEqual({})
    expect(findDesk(settled.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ id: 'other_mk', lessonType: 'makeup', managedStudentId: 'student-2' })
  })

  it('★(f-9・決定記録 59) 押し出した形の解除 → 再マージ 2 回でも戻した席は 1 つだけ（INV-03 / INV-12）', () => {
    const { released } = releaseDisplacing(occupantMakeup())
    const managedCell = cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])
    const boardCell = released.nextWeeks.flat().find((cell) => cell.dateKey === RELEASE_DATE)
    if (!boardCell) throw new Error('board cell not found')
    const once = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]], [])[0]
    const twice = overlayBoardWeeksOnScheduleCells([managedCell], [[once]], [])[0]
    const placements = twice.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((entry) => entry?.managedStudentId === 'student-1')
    expect(placements).toHaveLength(1)
    expect(twice.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((entry) => entry?.managedStudentId === 'student-2')).toHaveLength(0)
  })

  it('★(f-10・決定記録 59) 片づけ: 「手入力データを採用」は振替を席へ戻し、戻した通常授業は取り下げて抑止（決定記録 62 で単発削除と揃え希望回数 −1）。「テンプレ授業を採用」は振替を未消化振替へ戻し通常授業は席に残る', () => {
    const { released, key } = releaseDisplacing(occupantMakeup())
    const pending = released.nextTemplatePendingDesks!
    const ledgers = { ...released.ledgers, suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: [] as string[], scheduleCountAdjustments: [] }
    const context = { managedStudentByAnyName: roster, resolveDisplayName, resolveStockId, ledgerOriginDatesByKey: {} }
    const existing = computePendingDeskResolution({ mode: 'adopt-existing', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(existing.status).toBe('applied')
    if (existing.status !== 'applied') throw new Error('unreachable')
    expect(findDesk(existing.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ id: 'other_mk', lessonType: 'makeup' })
    expect(existing.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(existing.ledgers.suppressedRegularLessonOccurrences).toContain(`student-1__数__${RELEASE_DATE}__1`)
    // 決定記録 62（オーナー決定 2026-11-02「2つとも予定数を 1 減らして単発削除と揃えて」）: 戻した通常授業の取り下げは単発削除と同じ −1。
    expect(existing.countAdjustedCount).toBe(1)
    expect(existing.ledgers.scheduleCountAdjustments).toEqual([expect.objectContaining({ studentKey: 'student-1', countKind: 'regular', delta: -1, dateKey: RELEASE_DATE })])
    expect(existing.returnedCount).toBe(0)
    expect(existing.ledgers.manualMakeupAdjustments).toEqual(released.ledgers.manualMakeupAdjustments)

    const template = computePendingDeskResolution({ mode: 'adopt-template', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(template.status).toBe('applied')
    if (template.status !== 'applied') throw new Error('unreachable')
    expect(findDesk(template.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular' })
    expect(template.nextTemplatePendingDesks[key]).toBeUndefined()
    // 捨てた下段の振替は未消化振替へ戻る（台帳に振替元 9/20 の origin）
    const returned = template.ledgers.manualMakeupAdjustments[buildMakeupStockKey('student-2', '数')] ?? []
    expect(returned.some((origin) => origin.dateKey === '2026-09-20')).toBe(true)
  })

  // ── 兄弟被覆（regression-reviewer 第 2 回監査 2026-11-01）: もう一方の席に生徒が生きている形・記録の席が印なしでもう一方が手入力の形 ──
  function otherSeatManual() {
    return student({ id: 'other_sp', name: '隣の子', managedStudentId: 'student-4', subject: '英', lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-7' })
  }
  function otherSeatTemplate() {
    return student({ id: 'other_tpl', name: '隣の子', managedStudentId: 'student-3', subject: '英' })
  }
  function remergeTwice(released: ReturnType<typeof computeHolidayReleaseRestoration>, managedSlots: [StudentEntry | null, StudentEntry | null]) {
    const managedCell = cellOn(RELEASE_DATE, 1, [managedDesk(managedSlots)])
    const boardCell = released.nextWeeks.flat().find((cell) => cell.dateKey === RELEASE_DATE)
    if (!boardCell) throw new Error('board cell not found')
    const once = overlayBoardWeeksOnScheduleCells([managedCell], [[boardCell]], [])[0]
    const twice = overlayBoardWeeksOnScheduleCells([managedCell], [[once]], [])[0]
    return { once, twice }
  }
  const idsOf = (cell: SlotCell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).map((entry) => entry?.managedStudentId ?? null)

  it('★(f-11・兄弟) もう一方の席に生徒が生きている形: 上段＝戻した通常授業＋もう一方の生徒（lesson は元のまま）・下段＝押し出した生徒。再マージ 2 回で生存数 1・形不変（INV-03 / INV-12）', () => {
    const { before, released, key } = releaseDisplacing(occupantMakeup(), { other: otherSeatManual() })
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.displacedOccupantNames).toEqual(['別の子'])
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    // もう一方の席が生きているので lesson は作り直さず（id は元のまま）、記録の席だけ戻した通常授業に差し替わる。
    expect(desk.lesson?.id).toBe('other-lesson')
    expect(desk.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular' })
    expect(desk.lesson?.studentSlots[0]?.manualAdded).toBeFalsy()
    expect(desk.lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp', lessonType: 'special' })
    expect(desk.statusSlots).toBeUndefined()
    const lower = released.nextTemplatePendingDesks![key]
    expect(lower.lower.lesson?.studentSlots).toMatchObject([{ id: 'other_mk' }, null])
    expect(lower.origin).toMatchObject({ kind: 'holiday-release-displaced' })
    expect(released.restoredOccurrenceKeys).toEqual([`student-1__数__${RELEASE_DATE}__1`])
    expect(released.ledgers).toEqual(before)
    // 再マージ 2 回（テンプレの管理セルは A だけ）: A は 1 つ・隣の講習は残る・押し出した振替は上段に湧かない・形が変わらない
    const { once, twice } = remergeTwice(released, [regularStudent(), null])
    expect(idsOf(twice).filter((id) => id === 'student-1')).toHaveLength(1)
    expect(idsOf(twice)).toEqual(['student-1', 'student-4'])
    expect(idsOf(twice)).toEqual(idsOf(once))
    expect(twice.desks[0].lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp' })
    expect(twice.desks.flatMap((entry) => entry.statusSlots ?? []).filter(Boolean)).toEqual([])
  })

  it('★(f-12・兄弟) 記録の席の生徒が印なし（テンプレの通常生徒）で、もう一方の席が手入力のとき: 押し出さず旧形（戻す通常授業を下段へ・holiday-release-seat-taken）。もう一方の席は動かない', () => {
    const { before, released, key } = releaseDisplacing(otherSeatTemplate(), { other: otherSeatManual() })
    expect(released.displacedOccupantNames).toEqual([])
    expect(released.pendingRestoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.restoredStudentNames).toEqual([])
    expect(released.skipped).toEqual([])
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    expect(desk.lesson?.studentSlots[0]).toMatchObject({ id: 'other_tpl', managedStudentId: 'student-3' })
    expect(desk.lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp', lessonType: 'special' })
    expect(desk.statusSlots).toBeUndefined()
    const lower = released.nextTemplatePendingDesks![key]
    expect(lower.lower.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular', manualAdded: true })
    expect(lower.lower.lesson?.studentSlots[1]).toBeNull()
    expect(lower.origin).toMatchObject({ kind: 'holiday-release-seat-taken' })
    expect(lower.origin?.note).toContain('戻す授業を下段にしました')
    // 旧形: 抑止キーは外さない（上段に別の生徒が居る）・台帳は往復で一致
    expect(released.restoredOccurrenceKeys).toEqual([])
    expect(released.ledgers).toEqual(before)
  })

  it('★(f-13・兄弟) 押し出しの形（もう一方の席あり）の片づけ: 「手入力データを採用」は記録の席だけ入れ替え（隣の生徒は不動・決定記録 62 で −1・返却 0）、「テンプレ授業を採用」は振替を未消化振替へ（隣の生徒は不動）', () => {
    const { released, key } = releaseDisplacing(occupantMakeup(), { other: otherSeatManual() })
    const pending = released.nextTemplatePendingDesks!
    const ledgers = { ...released.ledgers, suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: [] as string[], scheduleCountAdjustments: [] }
    const context = { managedStudentByAnyName: roster, resolveDisplayName, resolveStockId, ledgerOriginDatesByKey: {} }
    const existing = computePendingDeskResolution({ mode: 'adopt-existing', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(existing.status).toBe('applied')
    if (existing.status !== 'applied') throw new Error('unreachable')
    const afterExisting = findDesk(existing.nextWeeks, RELEASE_DATE)
    expect(afterExisting.lesson?.studentSlots[0]).toMatchObject({ id: 'other_mk', lessonType: 'makeup' })
    expect(afterExisting.lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp', lessonType: 'special' })
    expect(existing.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(existing.ledgers.suppressedRegularLessonOccurrences).toContain(`student-1__数__${RELEASE_DATE}__1`)
    // 決定記録 62（2026-11-02）: 単発削除と揃えて −1。
    expect(existing.countAdjustedCount).toBe(1)
    expect(existing.ledgers.scheduleCountAdjustments).toEqual([expect.objectContaining({ studentKey: 'student-1', countKind: 'regular', delta: -1 })])
    expect(existing.returnedCount).toBe(0)
    expect(existing.ledgers.manualMakeupAdjustments).toEqual(released.ledgers.manualMakeupAdjustments)
    expect(existing.ledgers.manualLectureStockCounts).toEqual(released.ledgers.manualLectureStockCounts)

    const template = computePendingDeskResolution({ mode: 'adopt-template', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(template.status).toBe('applied')
    if (template.status !== 'applied') throw new Error('unreachable')
    const afterTemplate = findDesk(template.nextWeeks, RELEASE_DATE)
    expect(afterTemplate.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular' })
    expect(afterTemplate.lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp' })
    expect(template.nextTemplatePendingDesks[key]).toBeUndefined()
    const returned = template.ledgers.manualMakeupAdjustments[buildMakeupStockKey('student-2', '数')] ?? []
    expect(returned.some((origin) => origin.dateKey === '2026-09-20')).toBe(true)
    expect(template.ledgers.manualLectureStockCounts).toEqual(released.ledgers.manualLectureStockCounts)
    expect(template.ledgers.scheduleCountAdjustments).toEqual([])
  })

  it('★(f-14・兄弟) 旧形（記録の席が印なし・もう一方が手入力）の片づけ: 「テンプレ授業を採用」は下段の通常授業（印つき）を捨てても −1 も返却もしない（従来の行と同じ会計）。「手入力データを採用」は上段のテンプレ生徒を取り下げて抑止＋単発削除と同じ −1', () => {
    const { released, key } = releaseDisplacing(otherSeatTemplate(), { other: otherSeatManual() })
    const pending = released.nextTemplatePendingDesks!
    const ledgers = { ...released.ledgers, suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: [`student-1__数__${RELEASE_DATE}__1`], scheduleCountAdjustments: [] }
    const context = { managedStudentByAnyName: roster, resolveDisplayName, resolveStockId, ledgerOriginDatesByKey: {} }
    const template = computePendingDeskResolution({ mode: 'adopt-template', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(template.status).toBe('applied')
    if (template.status !== 'applied') throw new Error('unreachable')
    expect(findDesk(template.nextWeeks, RELEASE_DATE).lesson?.studentSlots.map((entry) => entry?.id ?? null)).toEqual(['other_tpl', 'other_sp'])
    expect(template.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(template.returnedCount).toBe(0)
    expect(template.ledgers.scheduleCountAdjustments).toEqual([])
    expect(template.ledgers.manualMakeupAdjustments).toEqual(released.ledgers.manualMakeupAdjustments)

    const existing = computePendingDeskResolution({ mode: 'adopt-existing', weeks: released.nextWeeks, cellId: `${RELEASE_DATE}_1`, deskId: 'desk-1', lowerIndex: 0, templatePendingDesks: pending, ledgers, ...context })
    expect(existing.status).toBe('applied')
    if (existing.status !== 'applied') throw new Error('unreachable')
    const after = findDesk(existing.nextWeeks, RELEASE_DATE)
    expect(after.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', lessonType: 'regular', manualAdded: true })
    expect(after.lesson?.studentSlots[1]).toMatchObject({ id: 'other_sp' })
    expect(existing.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(existing.ledgers.suppressedRegularLessonOccurrences).toContain(`student-3__英__${RELEASE_DATE}__1`)
    expect(existing.countAdjustedCount).toBe(1)
    expect(existing.returnedCount).toBe(0)
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

  // 行(i)〜(l): 控え kind:'none'(在庫由来の振替) の別日組み直しと、同日に時限つき/時限なし origin が併存する往復。
  // ★レビュー指摘(2026-09-20・中): 'none' を無検査で復元すると「別日のコマ＋戻した席」で 1 origin に 2 コマになる。
  function attendedInStockMakeupDesk(originDateKey: string, originLabel: string): DeskCell {
    return {
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [statusEntry({
        id: 'status-attended-makeup', status: 'attended', lessonType: 'makeup', dateKey: RELEASE_DATE, slotNumber: 1,
        makeupSourceDate: originDateKey, makeupSourceLabel: originLabel,
      }), null],
    }
  }

  it('★(i) 在庫由来(控え none)の振替を別日へ組み直してから解除: 別日のコマを消して席へ戻す(1 origin に 2 コマにしない)', () => {
    const ledgers = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: '2026-09-30' }] } })
    const weeks = [[
      cellOn(RELEASE_DATE, 1, [attendedInStockMakeupDesk('2026-09-30', '2026/9/30(水) 1限')]),
      cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }]),
    ]]
    const set = runHolidaySet({ weeks, ledgers, ledgerOriginDatesByKey: { [STOCK_KEY]: ['2026-09-30'] } })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'none' })
    // 休日設定で再浮上した未消化を別日(10/9 2限)へ組み直した状態。
    findDesk(set.weeks, ALT_DATE).lesson = {
      id: 'alt-lesson',
      studentSlots: [makeupOnAltDate({ makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限' }), null],
    }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined() // 別日のコマは消える
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.ledgers).toEqual(ledgers) // 在庫中立(別日を消して再浮上・席を戻して再消化＝±0)
  })

  it('★(j) 在庫由来(控え none)の別日コマに出欠記録があれば復元しない(実施済みの授業は消さない)', () => {
    const ledgers = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: '2026-09-30' }] } })
    const weeks = [[
      cellOn(RELEASE_DATE, 1, [attendedInStockMakeupDesk('2026-09-30', '2026/9/30(水) 1限')]),
      cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }]),
    ]]
    const set = runHolidaySet({ weeks, ledgers, ledgerOriginDatesByKey: { [STOCK_KEY]: ['2026-09-30'] } })
    findDesk(set.weeks, ALT_DATE).statusSlots = [statusEntry({
      id: 'alt-attended', status: 'attended', lessonType: 'makeup', dateKey: ALT_DATE, slotNumber: 2,
      makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
    }), null]

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'makeup-in-record' }])
    expect(released.restoredStudentNames).toEqual([])
    expect(findDesk(released.nextWeeks, ALT_DATE).statusSlots?.[0]?.id).toBe('alt-attended')
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.status).toBe('holiday')
    expect(released.ledgers).toEqual(ledgers)
  })

  // ★(k) は 2026-10-07 の改定(休日設定は手動追加も返す・Issue #73)より**前**に休日設定した旧記録の形
  //   (控え 'none'＋manualAdded)。返していないものを巻き戻してはいけないので、この行は据え置き(assert 不変)。
  //   runHolidaySet でフラグを省略(false)して旧記録を作る。改定後の形は行(n)〜(r)。
  it('★(k) 手動追加(manualAdded・控え none＝改定前の旧記録)は在庫を消化していないので、別日のコマを消さずに席へ戻すだけ', () => {
    const before = emptyLedgers()
    const manualMakeup = regularStudent({
      lessonType: 'makeup', manualAdded: true, makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
    })
    const weeks = [[
      cellOn(RELEASE_DATE, 1, [managedDesk([manualMakeup, null])]),
      cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }]),
    ]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: false })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'none' })
    // 同じ元コマ日を指す別日の振替(在庫由来の本物)。手動追加の復元で巻き込んで消してはいけない。
    findDesk(set.weeks, ALT_DATE).lesson = {
      id: 'alt-lesson',
      studentSlots: [makeupOnAltDate({ makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限' }), null],
    }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson?.studentSlots[0]?.lessonType).toBe('makeup') // 別日は無傷
    expect(released.removedMakeups).toEqual([])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ manualAdded: true })
    expect(released.ledgers).toEqual(before)
  })

  // 行(n)〜(r): 休日設定 × 手動追加(2026-10-07 オーナー確定・Issue #73・§B-2-2b の表「手動追加」行を分割)。
  //   休日設定ハンドラは includeManualAddedLessons:true を渡すので、手動追加の通常・振替・増コマには 'makeup'、手動追加の講習には
  //   'lecture' の控えが焼き込まれ、解除は**既存の** 'makeup' / 'lecture' 経路で対称に巻き戻る(解除側の会計コードは変えない)。
  //   ★兄弟監査(2026-10-07): 席へ戻す手動追加の通常授業は抑止キー(restoredOccurrenceKeys)を返さない。手動追加はテンプレの出現では
  //     ないので、返すと同じ生徒×科目×日付×時限のテンプレ授業を「削除」して手で足し直していた席で、解除がその削除の抑止を外し、
  //     再マージでテンプレ授業が復活して手動追加と二重に出る(INV-12 / INV-03)。
  function manualRegularDesk(lessonId = 'manual_lesson'): DeskCell {
    return { id: 'desk-1', teacher: '田中講師', lesson: { id: lessonId, studentSlots: [regularStudent({ id: 'manual_regular', manualAdded: true }), null] } }
  }

  it('★(n) 手動追加の通常授業: 休日設定(手動追加も返す)→解除の往復で台帳が完全一致し、席へ manualAdded のまま戻る。抑止キーは返さない', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [manualRegularDesk()]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    // 手動追加は時限つき(日付#限)で積む(regression-reviewer M-1・同じ日のテンプレ授業の自動 origin と畳まれないため)。
    expect(set.ledgers.manualMakeupAdjustments).toEqual({ [STOCK_KEY]: [{ dateKey: RELEASE_DATE, slotNumber: 1 }] }) // 未消化振替 +1(当日 origin)
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]).toMatchObject({
      status: 'holiday',
      manualAdded: true,
      holidayStockReturn: { kind: 'makeup', originDateKey: RELEASE_DATE, originSlotNumber: 1, fallbackAdded: false },
    })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    const desk = findDesk(released.nextWeeks, RELEASE_DATE)
    expect(desk.lesson?.id).toBe('manual_lesson')
    expect(desk.lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'student-1', subject: '数', lessonType: 'regular', manualAdded: true })
    expect(desk.statusSlots).toBeUndefined()
    expect(released.ledgers).toEqual(before) // ★往復で台帳が完全一致(誤増も誤減も無い)
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.removedMakeups).toEqual([])
    expect(released.skipped).toEqual([])
    // ★兄弟監査: 手動追加はテンプレの出現ではないので抑止キーを返さない(呼び出し側が削除の抑止を外してしまうのを防ぐ)。
    expect(released.restoredOccurrenceKeys).toEqual([])
  })

  it('★(o) 手動追加の通常授業の休日設定で出た未消化を別日へ組んでから解除: 別日のコマを消し、台帳は設定前と一致(±0)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [manualRegularDesk()]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    // 未消化になった振替を別日(10/9 2限)へ組んだ状態(在庫から置いた振替は manualAdded を持たない)。
    findDesk(set.weeks, ALT_DATE).lesson = { id: 'alt-lesson', studentSlots: [makeupOnAltDate(), null] }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined() // 別日のコマは消える
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ manualAdded: true, lessonType: 'regular' })
    expect(released.ledgers).toEqual(before) // origin を外す ＋ 消化が減る で ±0
  })

  it('★(p) 別日に組んだ振替に出欠記録が付いていたら、手動追加でも復元せず記録と台帳を残す(実施済みの授業を消さない)', () => {
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [manualRegularDesk()]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    findDesk(set.weeks, ALT_DATE).statusSlots = [statusEntry({
      id: 'alt-attended', status: 'attended', lessonType: 'makeup', dateKey: ALT_DATE, slotNumber: 2,
      makeupSourceDate: RELEASE_DATE, makeupSourceLabel: '2026/10/7(水) 1限',
    }), null]

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.skipped).toEqual([{ studentName: '大槻 太郎', reason: 'makeup-in-record' }])
    expect(released.restoredStudentNames).toEqual([])
    expect(findDesk(released.nextWeeks, ALT_DATE).statusSlots?.[0]?.id).toBe('alt-attended')
    expect(findDesk(released.nextWeeks, RELEASE_DATE).statusSlots?.[0]?.status).toBe('holiday')
    expect(released.ledgers).toEqual(set.ledgers) // 台帳も触らない(origin は残る＝実施した振替の根拠)
  })

  it('★(q) 手動追加の講習: 休日設定で未消化講習 +1(控え lecture)→解除で打ち消して 0 に戻り、席へ手動追加の講習のまま戻る', () => {
    const lectureStockKey = buildLectureStockKey('student-1', '数', 'sess-1')
    const before = emptyLedgers() // 手動追加の講習は配置で −1 していない(希望数に含まれない)
    const manualLecture = student({ id: `sA_${RELEASE_DATE}_講`, lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([manualLecture, null])])]]

    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    expect(set.ledgers.manualLectureStockCounts).toEqual({ [lectureStockKey]: 1 }) // 未消化講習 +1
    expect(set.ledgers.manualLectureStockOrigins[lectureStockKey]).toHaveLength(1)
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({
      kind: 'lecture', originDateKey: RELEASE_DATE, originSlotNumber: 1, fallbackAdded: false,
    })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({
      lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true,
    })
    expect(released.ledgers.manualLectureStockCounts[lectureStockKey] ?? 0).toBe(0) // +1 と −1 で 0(デルタ台帳は 0 のキーを残してよい)
    expect(released.ledgers.manualLectureStockOrigins).toEqual({})
    expect(released.ledgers.manualMakeupAdjustments).toEqual({})
  })

  it('★(r) 手動追加の講習の休日設定で出た未消化講習を別日へ組んでから解除: 別日のコマを消し、台帳は触らない(設定の +1 と配置の消費が打ち消し合う)', () => {
    const lectureStockKey = buildLectureStockKey('student-1', '数', 'sess-1')
    const manualLecture = student({ id: `sA_${RELEASE_DATE}_講`, lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([manualLecture, null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: emptyLedgers(), includeManualAddedLessons: true })
    // 未消化講習(manual 項目)から別日へ置いた状態: removeLecturePendingItemFromStockState の manual 枝＝+1 側のキー削除・origin 除去。
    findDesk(set.weeks, ALT_DATE).lesson = {
      id: 'alt-lesson',
      studentSlots: [{ ...manualLecture, id: `sA_${ALT_DATE}_講`, manualAdded: undefined, makeupSourceDate: RELEASE_DATE, makeupSourceLabel: '2026/10/7(水) 1限' }, null],
    }
    const afterPlacement: Ledgers = { ...set.ledgers, manualLectureStockCounts: {}, manualLectureStockOrigins: {} }

    const released = runHolidayRelease(set.weeks, afterPlacement)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined()
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'special' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'special', specialStockSource: 'manual', manualAdded: true })
    expect(released.ledgers.manualLectureStockCounts[lectureStockKey]).toBeUndefined() // 台帳は触らない
    expect(released.ledgers.manualLectureStockOrigins).toEqual({})
  })

  it('★(s) 出席にした「別日へ動かした手動追加の振替」: 休日設定で振替元日＋時限の origin を積み(控え makeup)、解除で往復一致・席へ振替のまま戻る', () => {
    // regression-reviewer M-2: 出欠記録の振替は materialize 経路へ回り、手動追加は対象外(none)だったので、記録が holiday になって実績 −1 だけが残り 1 コマ消えていた。
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [{
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [statusEntry({
        id: 'status-attended-manual-makeup', status: 'attended', lessonType: 'makeup', manualAdded: true, dateKey: RELEASE_DATE, slotNumber: 1,
        makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
      }), null],
    }])]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    expect(set.ledgers.manualMakeupAdjustments).toEqual({ [STOCK_KEY]: [{ dateKey: '2026-09-30', slotNumber: 1 }] })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'makeup', originDateKey: '2026-09-30', originSlotNumber: 1, fallbackAdded: false })

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', manualAdded: true, makeupSourceDate: '2026-09-30' })
    expect(released.ledgers).toEqual(before)
    // 振無休も同じ。対照: 休日設定以外(フラグ省略)では従来どおり 'none'(在庫を触らない)。
    const noMakeup = structuredClone(weeks)
    noMakeup[0][0].desks[0].statusSlots![0]!.status = 'absent-no-makeup'
    expect(runHolidaySet({ weeks: noMakeup, ledgers: before, includeManualAddedLessons: true }).ledgers.manualMakeupAdjustments).toEqual({ [STOCK_KEY]: [{ dateKey: '2026-09-30', slotNumber: 1 }] })
    const legacy = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: false })
    expect(legacy.ledgers).toEqual(before)
    expect(findDesk(legacy.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'none' })
  })

  it('★(t) 解除で「別日に組んだコマ」を探すとき、手動追加のコマは候補にしない(在庫を消費した配置ではない＝消してはいけない)', () => {
    // regression-reviewer L-3: 2026-10-07 以降は手動追加の振替にも 'makeup' の控えが付くので、同じ振替元日・同じ在庫キーの別日の手動追加コマを取り違えうる。
    const before = emptyLedgers()
    const movedManual = regularStudent({ lessonType: 'makeup', manualAdded: true, makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限' })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([movedManual, null])]), cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }])]]
    const set = runHolidaySet({ weeks, ledgers: before, includeManualAddedLessons: true })
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'makeup', originDateKey: '2026-09-30', originSlotNumber: 1, fallbackAdded: false })
    // 別日に、同じ振替元日・同じ在庫キーを持つ**手動追加**の振替コマがある(在庫から置いたものではない)。
    findDesk(set.weeks, ALT_DATE).lesson = {
      id: 'alt-lesson',
      studentSlots: [makeupOnAltDate({ manualAdded: true, makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限' }), null],
    }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson?.studentSlots[0]).toMatchObject({ manualAdded: true, lessonType: 'makeup' }) // 別日の手動追加は無傷
    expect(released.removedMakeups).toEqual([])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ manualAdded: true, lessonType: 'makeup' })
    expect(released.ledgers).toEqual(before) // 設定で積んだ origin を外して往復一致
  })

  it('★(u) 機能フラグ OFF(本番 3 教室の現状): 手動追加も在庫へ返るが holiday 記録は作られないので、解除は従来どおり何も戻さず origin は残る', () => {
    // regression-reviewer L-4: 解除の巻き戻しは transferSourceRestDisplay ON の教室だけ。OFF ではテンプレ授業と同じく返した分が未消化に残る。
    const before = emptyLedgers()
    const weeks = [[cellOn(RELEASE_DATE, 1, [manualRegularDesk()])]]
    const set = runHolidaySet({ weeks, ledgers: before, enabled: false, includeManualAddedLessons: true })
    expect(set.ledgers.manualMakeupAdjustments).toEqual({ [STOCK_KEY]: [{ dateKey: RELEASE_DATE, slotNumber: 1 }] }) // 在庫会計はフラグに依らない
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots).toBeUndefined()
    expect(findDesk(set.weeks, RELEASE_DATE).lesson).toBeUndefined()

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(released.restoredStudentNames).toEqual([])
    expect(released.ledgers).toEqual(set.ledgers) // 返した分は未消化振替に残る(テンプレ授業と同じ従来の挙動)
  })

  it('★(l) 同じ日付に時限つき/時限なしの origin が併存する往復: 休日設定で積んだ形のものだけを外す(残数が狂わない)', () => {
    // 先に「×で消した 4 限」の origin(時限つき)が台帳にあり、同じ日の 1 限を休日設定で返す(時限なし)。
    const before = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: RELEASE_DATE, slotNumber: 4 }] } })
    const weeks = [[cellOn(RELEASE_DATE, 1, [managedDesk([regularStudent(), null])])]]

    const set = runHolidaySet({ weeks, ledgers: before })
    expect(set.ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: RELEASE_DATE, slotNumber: 4 }, { dateKey: RELEASE_DATE }])

    const released = runHolidayRelease(set.weeks, set.ledgers)
    // ★時限なしを外す(先頭の 4 限を外すと件数は合うのに照合先が入れ替わり、以後の消化判定がずれる)。
    expect(released.ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: RELEASE_DATE, slotNumber: 4 }])
    expect(released.ledgers).toEqual(before)
  })

  // 行(m): (i) の兄弟＝**振無休(absent-no-makeup)**で休みにした在庫由来の振替を別日へ組み直してから解除する。
  // ★兄弟監査(2026-09-21・レビュー指摘): 在庫へ返す集合 HOLIDAY_STOCK_RETURNABLE_STATUSES は
  //   attended と absent-no-makeup の 2 つ。控え 'none' の別日検査を「出席済みだけ」で確かめると、
  //   振無休側が抜けたときに気づけない(1 origin に 2 コマ＝INV-06 違反になる)。同じ形で 1 行固定する。
  it('★(m) 兄弟: 振無休(absent-no-makeup)の在庫由来の振替を別日へ組み直してから解除でも、別日のコマを消して席へ戻す', () => {
    const ledgers = emptyLedgers({ manualMakeupAdjustments: { [STOCK_KEY]: [{ dateKey: '2026-09-30' }] } })
    const weeks = [[
      cellOn(RELEASE_DATE, 1, [{
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [statusEntry({
          id: 'status-absent-no-makeup', status: 'absent-no-makeup', lessonType: 'makeup', dateKey: RELEASE_DATE, slotNumber: 1,
          makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限',
        }), null],
      }]),
      cellOn(ALT_DATE, 2, [{ id: 'alt-desk', teacher: '佐藤講師' }]),
    ]]
    const set = runHolidaySet({ weeks, ledgers, ledgerOriginDatesByKey: { [STOCK_KEY]: ['2026-09-30'] } })
    expect(set.ledgers).toEqual(ledgers) // 在庫由来は二重計上しない(再浮上に任せる)
    expect(findDesk(set.weeks, RELEASE_DATE).statusSlots?.[0]?.holidayStockReturn).toEqual({ kind: 'none' })
    // 再浮上した未消化を別日(10/9 2限)へ組み直した状態。
    findDesk(set.weeks, ALT_DATE).lesson = {
      id: 'alt-lesson',
      studentSlots: [makeupOnAltDate({ makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 1限' }), null],
    }

    const released = runHolidayRelease(set.weeks, set.ledgers)
    expect(findDesk(released.nextWeeks, ALT_DATE).lesson).toBeUndefined()
    expect(released.removedMakeups).toEqual([{ studentName: '大槻 太郎', dateKey: ALT_DATE, slotNumber: 2, lessonType: 'makeup' }])
    expect(findDesk(released.nextWeeks, RELEASE_DATE).lesson?.studentSlots[0]).toMatchObject({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    expect(released.restoredStudentNames).toEqual(['大槻 太郎'])
    expect(released.ledgers).toEqual(ledgers) // 在庫中立(±0)
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

describe('休日解除 × メモの席（regression-reviewer 2026-10-27 中-1・仕様決定待ち）', () => {
  // 休日中にその席へメモを入れると、解除で戻した生徒がメモの席に重なりメモが隠れる(データは消えない)。
  it.todo('休日解除はメモの席に生徒を戻さず保留(下段)へ回す(tp-62 と同じ規則・仕様決定待ち)')
})

describe('休日設定 × 科目だけ編集したテンプレの授業（2026-11-07 オーナー確定「その時コマ表に入っていた科目で数える」・spec-template-conflict-v2 §4-1-2）', () => {
  // テンプレの通常授業（数）を「編集」で 国 に変えてからその日を休日にすると、未消化振替が 国 と 数 の 2 件になっていた（1 コマが 2 件＝INV-06 の誤増）。
  // 休日設定は席の授業（国）を未消化へ返し（reconcileHolidayDeskStockReturns）、未消化の計算はテンプレ行（数）からその日の休日の自動発生を立てる。
  // 編集で振替にしたときと同じく（applyStudentEdit の addedMakeupSuppressionKey）、通常 → 通常の科目の編集でもテンプレの科目の振替（その日・その時限）を
  // 抑止する（suppressedMakeupOrigins）。科目をテンプレの科目へ戻したら外す。フラグ ON／OFF とも同じ。
  const ROWS = [FX.row('r0', 't1', 'sA', 'sD'), FX.row('r1', 't2', 'sB'), FX.row('r2', 't3', '', '', 4)]
  const byName = new Map(FX.students.map((item) => [item.name, item]))
  const HOLIDAY = FX.settings({ holidayDates: [FX.WED] })
  const keysOf = (map: Record<string, number>, id = 'sA') => Object.fromEntries(Object.entries(map).filter(([key, value]) => key.startsWith(`${id}__`) && value !== 0))
  type HolidayLedgers = Parameters<typeof computeHolidayReleaseRestoration>[0]['ledgers']
  const emptyHolidayLedgers = (): HolidayLedgers => ({ manualLectureStockCounts: {}, manualLectureStockOrigins: {}, manualMakeupAdjustments: {}, fallbackLectureStockStudents: {}, fallbackMakeupStudents: {} })
  function editA(weeks: SlotCell[][], suppressedMakeupOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>>, subject: StudentEntry['subject'], stampOrigin: boolean) {
    const next = structuredClone(weeks)
    const cell = FX.cellOf(next, FX.WED_CELL)
    const target = cell.desks[0].lesson!.studentSlots[0]!
    const result = applyStudentEdit({
      student: target, draft: { subject, lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, cellDateKey: cell.dateKey, cellSlotNumber: cell.slotNumber,
      suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins, resolveStockId: FX.resolveStudentKey, stampOrigin,
    })
    cell.desks[0].lesson!.studentSlots[0] = result.student
    return { weeks: next, suppressedMakeupOrigins: result.suppressedMakeupOrigins }
  }
  function holidaySet(weeks: SlotCell[][]) {
    const next = structuredClone(weeks)
    let ledgers = emptyHolidayLedgers()
    for (const cell of next.flat()) {
      if (cell.dateKey !== FX.WED) continue
      for (const desk of cell.desks) {
        const returned = reconcileHolidayDeskStockReturns({ desk, cellDateKey: cell.dateKey, cellSlotNumber: cell.slotNumber, ledgers, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, ledgerOriginDatesByKey: {}, includeManualAddedLessons: true })
        ledgers = returned.ledgers
        convertHolidayDeskEntriesToRecords({ desk, cell, enabled: true, stockReturns: returned.stockReturnStamps })
      }
    }
    return { weeks: next, ledgers }
  }
  const board = (on: boolean) => (on ? FX.remerge([FX.buildWeek(ROWS)], ROWS, []) : remergeBoardWeeksWithManagedData([FX.buildWeek(ROWS)], { classroomSettings: FX.settings(), teachers: FX.teachers, students: FX.students, regularLessons: ROWS, suppressedRegularLessonOccurrences: [], todayKey: '2026-09-29' }))

  for (const on of [false, true]) {
    const flag = on ? 'フラグ ON' : 'フラグ OFF'
    it(`${flag}: 科目編集（数→国）→ 休日設定: 未消化振替は 国 の 1 件だけ（修正前は 国 と 数 の 2 件）。休日解除で 0 件に戻り、A（国）が席に戻る`, () => {
      const edited = editA(board(on), {}, '国', on)
      expect(edited.suppressedMakeupOrigins).toEqual({ [buildMakeupStockKey('sA', '数')]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
      const set = holidaySet(edited.weeks)
      expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, edited.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
      // 同じ机の D（編集していない）は従来どおり 数 の 1 件。
      expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, edited.suppressedMakeupOrigins), 'sD')).toEqual({ sD__数: 1 })
      const released = computeHolidayReleaseRestoration({ weeks: set.weeks, dateKey: FX.WED, ledgers: set.ledgers, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, templateOriginRules: on })
      expect(keysOf(FX.balances(released.nextWeeks, ROWS, released.ledgers.manualMakeupAdjustments, FX.settings(), edited.suppressedMakeupOrigins))).toEqual({})
      expect(FX.cellOf(released.nextWeeks, FX.WED_CELL).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '国' })
    })

    it(`${flag}: 科目編集（数→国）→ 休み → 休日設定: 未消化振替は 国 の 1 件だけ（休みの 国 とテンプレの 数 が重ならない）`, () => {
      const edited = editA(board(on), {}, '国', on)
      const absent = computeStudentAbsentMark({
        weeks: edited.weeks, weekIndex: 0, seat: { cellId: FX.WED_CELL, deskIndex: 0, studentIndex: 0 }, manualMakeupAdjustments: {}, suppressedMakeupOrigins: edited.suppressedMakeupOrigins, fallbackMakeupStudents: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {},
        fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: [], ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, templateOriginRules: on,
      })
      if (!absent) throw new Error('not found')
      const set = holidaySet(absent.nextWeeks)
      expect(keysOf(FX.balances(set.weeks, ROWS, { ...absent.ledgers.manualMakeupAdjustments, ...set.ledgers.manualMakeupAdjustments }, HOLIDAY, absent.ledgers.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
    })

    it(`${flag}: 科目をテンプレの科目へ戻す（数→国→数）と抑止は外れ、休日設定で 数 の 1 件（編集していない授業と同じ）。数→国→英 は 英 の 1 件`, () => {
      const there = editA(board(on), {}, '国', on)
      const back = editA(there.weeks, there.suppressedMakeupOrigins, '数', on)
      expect(back.suppressedMakeupOrigins).toEqual({})
      const setBack = holidaySet(back.weeks)
      expect(keysOf(FX.balances(setBack.weeks, ROWS, setBack.ledgers.manualMakeupAdjustments, HOLIDAY, back.suppressedMakeupOrigins))).toEqual({ sA__数: 1 })
      const other = editA(there.weeks, there.suppressedMakeupOrigins, '英', on)
      expect(other.suppressedMakeupOrigins).toEqual(there.suppressedMakeupOrigins)
      const setOther = holidaySet(other.weeks)
      expect(keysOf(FX.balances(setOther.weeks, ROWS, setOther.ledgers.manualMakeupAdjustments, HOLIDAY, other.suppressedMakeupOrigins))).toEqual({ sA__英: 1 })
    })

    // 修正で良い方へ変わった兄弟（regression-reviewer 2026-11-07）: 編集の抑止は席から外した後も残るので、外し方によらずテンプレの科目（数）が立たない。
    // 単発削除・格納は盤面の handleDeleteStudent・handleStoreStudent と同じ会計（削除＝今の科目の時限つき抑制／格納＝今の科目の時限つき origin＋抑制の解除）を写す。
    const removeA = (weeks: SlotCell[][]) => {
      const next = structuredClone(weeks)
      const desk = FX.cellOf(next, FX.WED_CELL).desks[0]
      const removed = desk.lesson!.studentSlots[0]!
      desk.lesson!.studentSlots[0] = null
      return { weeks: next, removed }
    }

    it(`${flag}: 科目編集（数→国）→ 単発削除 → 休日設定: 未消化振替は 0 件（削除は振替の対象にしない・テンプレの 数 も立たない）`, () => {
      const edited = editA(board(on), {}, '国', on)
      const { weeks, removed } = removeA(edited.weeks)
      const deletion = resolveDeletedLessonSuppressionOrigin({ dateKey: FX.WED, slotNumber: resolveLessonMakeupOriginSlotNumber(removed, FX.SLOT), effectiveOriginTokens: [], ledgerOrigins: [], requireExactOrigin: false })
      const suppressed = { ...edited.suppressedMakeupOrigins, [buildMakeupStockKey('sA', removed.subject)]: [deletion] }
      const set = holidaySet(weeks)
      expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, suppressed))).toEqual({})
    })

    it(`${flag}: 科目編集（数→国）→ 別の日へ移動 → 元の日を休日設定: 未消化振替は 0 件・移動先の振替（国）は残る`, () => {
      const edited = editA(board(on), {}, '国', on)
      const moving = FX.cellOf(edited.weeks, FX.WED_CELL).desks[0].lesson!.studentSlots[0]!
      const moved = computeStudentMove({
        weeks: edited.weeks, weekIndex: 0, cells: edited.weeks[0], movingStudentId: moving.id, cellId: FX.THU_CELL, deskIndex: 1, studentIndex: 0,
        suppressedRegularLessonOccurrences: [], managedStudentByAnyName: byName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: on, sourceSeat: { cellId: FX.WED_CELL, deskIndex: 0, studentIndex: 0 },
      })
      if (moved.status !== 'moved') throw new Error(moved.message)
      const set = holidaySet(moved.nextWeeks)
      expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, edited.suppressedMakeupOrigins))).toEqual({})
      expect(FX.cellOf(set.weeks, FX.THU_CELL).desks[1].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '国', lessonType: 'makeup', makeupSourceDate: FX.WED })
    })

    it(`${flag}: 科目編集（数→国）→ 格納 → 休日設定: 未消化振替は 国 の 1 件だけ（格納した分。テンプレの 数 は立たない）`, () => {
      const edited = editA(board(on), {}, '国', on)
      const { weeks, removed } = removeA(edited.weeks)
      const stockKey = buildMakeupStockKey('sA', removed.subject)
      const slot = resolveLessonMakeupOriginSlotNumber(removed, FX.SLOT)
      const stored = { [stockKey]: [{ dateKey: FX.WED, slotNumber: slot! }] }
      const suppressed = clearMakeupOrigins(edited.suppressedMakeupOrigins, stockKey, FX.WED, slot)
      const set = holidaySet(weeks)
      expect(keysOf(FX.balances(set.weeks, ROWS, { ...stored, ...set.ledgers.manualMakeupAdjustments }, HOLIDAY, suppressed))).toEqual({ sA__国: 1 })
    })
  }

  it('ロック: 編集していない授業の休日設定は 数 の 1 件・科目を変えない編集（区分も同じ）は抑止を積まない', () => {
    const base = board(false)
    const set = holidaySet(base)
    expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY))).toEqual({ sA__数: 1 })
    expect(editA(base, {}, '数', false).suppressedMakeupOrigins).toEqual({})
  })

  it('兄弟（フラグ ON の丸ごと振替＝付け替え）: 科目を編集した授業の日を同じ曜日の別の日へ付け替えても、元の日のテンプレの科目（数）の未消化が立たない（D\' の 国 の振替が授業そのもの）', () => {
    const pairBoard = structuredClone(pairFx.remerge(pairFx.buildBoard(), pairFx.ROWS, []))
    const cell = pairFx.cellAt(pairBoard, pairFx.D)
    const edited = applyStudentEdit({
      student: cell.desks[0].lesson!.studentSlots[0]!, draft: { subject: '国', lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, cellDateKey: cell.dateKey, cellSlotNumber: cell.slotNumber,
      suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, resolveStockId: pairFx.resolveStudentKey, stampOrigin: true,
    })
    cell.desks[0].lesson!.studentSlots[0] = edited.student
    const paired = pairFx.pairedOrThrow(pairFx.pairOf(pairBoard))
    const remerged = pairFx.remerge(paired.nextWeeks, pairFx.ROWS, paired.nextSuppressedRegularLessonOccurrences)
    const stock = (suppressedOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>>) => keysOf(Object.fromEntries(buildMakeupStockEntries({
      students: pairFx.students, teachers: pairFx.teachers, regularLessons: pairFx.ROWS, classroomSettings: pairFx.settings(), weeks: remerged, manualAdjustments: {}, suppressedOrigins, resolveStudentKey: pairFx.resolveStudentKey, today: pairFx.TODAY,
    }).map((item) => [item.key, item.balance])))
    // 修正前（編集が抑止を積まない）は D の付け替えに置かなかった A の「休み」（数）が未消化 1 件になっていた。
    expect(stock({})).toEqual({ sA__数: 1 })
    expect(stock(edited.suppressedMakeupOrigins)).toEqual({})
    expect(pairFx.cellAt(remerged, pairFx.D2).desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((item) => item?.managedStudentId === 'sA').map((item) => item!.subject)).toEqual(['国'])
  })

  it('科目をテンプレの科目へ戻したときは、編集で振替にして通常へ戻した後に残った抑止（数→国 振替→国 通常）も外す（席の授業がテンプレの科目に戻れば、その日その時限の テンプレの科目 の抑止は自分の休みまで消すだけ）', () => {
    // 外すのを「通常→通常の編集で積んだ分だけ」に絞らない理由のロック: 振替へ編集した分（addedMakeupSuppressionKey）は、科目を変えたまま通常へ戻すと
    // 印（editedFromRegular）ごと消えて誰が積んだか分からなくなる。絞ると下の 国→数 で抑止が残り、数 の授業を休んでも未消化に入らない（誤減）。
    const base = board(false)
    const cell = FX.cellOf(base, FX.WED_CELL)
    const target = cell.desks[0].lesson!.studentSlots[0]!
    const toMakeup = applyStudentEdit({ student: target, draft: { subject: '国', lessonType: 'makeup', teacherType: 'normal', noteSuffix: '' }, cellDateKey: FX.WED, cellSlotNumber: FX.SLOT, suppressedRegularLessonOccurrences: [], suppressedMakeupOrigins: {}, resolveStockId: FX.resolveStudentKey })
    const backRegular = applyStudentEdit({ student: toMakeup.student, draft: { subject: '国', lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, cellDateKey: FX.WED, cellSlotNumber: FX.SLOT, suppressedRegularLessonOccurrences: toMakeup.suppressedRegularLessonOccurrences, suppressedMakeupOrigins: toMakeup.suppressedMakeupOrigins, resolveStockId: FX.resolveStudentKey })
    expect(backRegular.student.editedFromRegular).toBeUndefined()
    expect(backRegular.suppressedMakeupOrigins).toEqual({ [buildMakeupStockKey('sA', '数')]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
    const toTemplateSubject = applyStudentEdit({ student: backRegular.student, draft: { subject: '数', lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, cellDateKey: FX.WED, cellSlotNumber: FX.SLOT, suppressedRegularLessonOccurrences: backRegular.suppressedRegularLessonOccurrences, suppressedMakeupOrigins: backRegular.suppressedMakeupOrigins, resolveStockId: FX.resolveStudentKey })
    expect(toTemplateSubject.suppressedMakeupOrigins).toEqual({})
  })

  // 2026-11-07（オーナー指示「直して」）: 抑止は「編集したとき」に積むので、この修正より前に科目を編集した授業（テンプレの科目の振替の抑止が無い保存データ）を
  // 編集し直さずに単発削除・格納・休み・全コマ削除してからその日を休日にすると、テンプレの科目（数）の休日の自動発生が立っていた（+1 の誤増）。
  // 外す操作の側でも、授業 ID のテンプレの科目が今の科目と違えば、テンプレの科目×その日×その時限の振替の抑止を 1 件立てる（権威関数
  // ensureTemplateSubjectMakeupSuppression・編集で積んだ分があれば重ねない）。削除・格納の会計は盤面のハンドラから切り出した純関数
  // computeDeletedLessonMakeupSuppressions・computeStoredLessonMakeupLedgers をそのまま通す。
  describe('既存データ（修正前に科目を編集した授業＝テンプレの科目の抑止なし）を編集し直さずに外してから休日設定', () => {
    const legacyBoard = (on: boolean) => {
      const weeks = structuredClone(board(on))
      const seat = FX.cellOf(weeks, FX.WED_CELL).desks[0].lesson!.studentSlots
      seat[0] = { ...seat[0]!, subject: '国', ...(on ? { origin: 'manual' as const } : {}) }
      return weeks
    }
    const deleteA = (weeks: SlotCell[][], suppressedMakeupOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>>, manualMakeupAdjustments: Record<string, Array<{ dateKey: string; slotNumber?: number }>> = {}) => {
      const { weeks: next, removed } = removeA(weeks)
      return {
        weeks: next,
        suppressedMakeupOrigins: computeDeletedLessonMakeupSuppressions({
          student: removed, cellDateKey: FX.WED, cellSlotNumber: FX.SLOT, suppressedMakeupOrigins, makeupOriginDatesByKey: {}, ledgerOriginsByKey: manualMakeupAdjustments, resolveStockId: FX.resolveStudentKey,
        }),
      }
    }
    const storeA = (weeks: SlotCell[][], suppressedMakeupOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>>) => {
      const { weeks: next, removed } = removeA(weeks)
      const stored = computeStoredLessonMakeupLedgers({
        student: removed, cellDateKey: FX.WED, cellSlotNumber: FX.SLOT, manualMakeupAdjustments: {}, suppressedMakeupOrigins, makeupOriginDatesByKey: {}, resolveStockId: FX.resolveStudentKey,
      })
      return { weeks: next, manualMakeupAdjustments: stored.nextManualMakeupAdjustments, suppressedMakeupOrigins: stored.nextSuppressedMakeupOrigins }
    }
    const absentA = (weeks: SlotCell[][], on: boolean, suppressedMakeupOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>> = {}) => {
      const absent = computeStudentAbsentMark({
        weeks, weekIndex: 0, seat: { cellId: FX.WED_CELL, deskIndex: 0, studentIndex: 0 }, manualMakeupAdjustments: {}, suppressedMakeupOrigins, fallbackMakeupStudents: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {},
        fallbackLectureStockStudents: {}, suppressedRegularLessonOccurrences: [], ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, templateOriginRules: on,
      })
      if (!absent) throw new Error('not found')
      return absent
    }
    const templateKeyA = buildMakeupStockKey('sA', '数')
    const removeA = (weeks: SlotCell[][]) => {
      const next = structuredClone(weeks)
      const desk = FX.cellOf(next, FX.WED_CELL).desks[0]
      const removed = desk.lesson!.studentSlots[0]!
      desk.lesson!.studentSlots[0] = null
      return { weeks: next, removed }
    }

    for (const on of [false, true]) {
      const flag = on ? 'フラグ ON' : 'フラグ OFF'
      it(`${flag}: 単発削除 → 休日設定: 未消化振替は 0 件（修正前はテンプレの 数 が 1 件）。テンプレの科目の抑止は 1 件・休日解除しても 0 件で A は戻らない`, () => {
        const deleted = deleteA(legacyBoard(on), {})
        expect(deleted.suppressedMakeupOrigins[templateKeyA]).toEqual([{ dateKey: FX.WED, slotNumber: FX.SLOT }])
        const set = holidaySet(deleted.weeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, deleted.suppressedMakeupOrigins))).toEqual({})
        const released = computeHolidayReleaseRestoration({ weeks: set.weeks, dateKey: FX.WED, ledgers: set.ledgers, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, templateOriginRules: on })
        expect(keysOf(FX.balances(released.nextWeeks, ROWS, released.ledgers.manualMakeupAdjustments, FX.settings(), deleted.suppressedMakeupOrigins))).toEqual({})
        expect(FX.cellOf(released.nextWeeks, FX.WED_CELL).desks[0].lesson?.studentSlots[0] ?? null).toBeNull()
      })

      it(`${flag}: 格納 → 休日設定: 未消化振替は 国 の 1 件だけ（修正前は 国 と 数 の 2 件）`, () => {
        const stored = storeA(legacyBoard(on), {})
        expect(stored.manualMakeupAdjustments).toEqual({ [buildMakeupStockKey('sA', '国')]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
        const set = holidaySet(stored.weeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, { ...stored.manualMakeupAdjustments, ...set.ledgers.manualMakeupAdjustments }, HOLIDAY, stored.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
      })

      it(`${flag}: 休み → 休日設定: 未消化振替は 国 の 1 件だけ（修正前は 国 と 数 の 2 件）。休み解除で席の 国 に戻っても抑止は残り、そのまま休日設定しても 国 の 1 件`, () => {
        const absent = absentA(legacyBoard(on), on)
        expect(absent.ledgers.suppressedMakeupOrigins[templateKeyA]).toEqual([{ dateKey: FX.WED, slotNumber: FX.SLOT }])
        const set = holidaySet(absent.nextWeeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, { ...absent.ledgers.manualMakeupAdjustments, ...set.ledgers.manualMakeupAdjustments }, HOLIDAY, absent.ledgers.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
        // 休み解除（handleClearStudentStatus と同じ: 席へ戻し、休みで積んだ 国 の origin を外す・振替の抑止は触らない）→ 休日設定。
        const cleared = structuredClone(absent.nextWeeks)
        const desk = FX.cellOf(cleared, FX.WED_CELL).desks[0]
        const restored = clearStudentStatusFromDesk(desk, 0, desk.statusSlots![0]!)
        expect(restored).toMatchObject({ managedStudentId: 'sA', subject: '国' })
        const setAfterClear = holidaySet(cleared)
        expect(keysOf(FX.balances(setAfterClear.weeks, ROWS, setAfterClear.ledgers.manualMakeupAdjustments, HOLIDAY, absent.ledgers.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
      })

      it(`${flag}: その日の生徒を全コマ削除 → 休日設定: 未消化振替は 0 件（修正前はテンプレの 数 が 1 件）`, () => {
        const weeks = legacyBoard(on)
        const cell = FX.cellOf(weeks, FX.WED_CELL)
        const suppressed = collectClearedDayMakeupSuppressions({ cell, suppressedMakeupOrigins: {}, resolveStockId: FX.resolveStudentKey })
        expect(suppressed[templateKeyA]).toEqual([{ dateKey: FX.WED, slotNumber: FX.SLOT }])
        for (const desk of cell.desks) { desk.lesson = undefined; desk.statusSlots = undefined }
        const set = holidaySet(weeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, suppressed))).toEqual({})
      })

      it(`${flag}: 編集で抑止を積んだ授業（修正後のデータ）を削除・格納・休みにしても、テンプレの科目の抑止は 1 件のまま（重ねない）`, () => {
        const edited = editA(board(on), {}, '国', on)
        const once = [{ dateKey: FX.WED, slotNumber: FX.SLOT }]
        expect(deleteA(edited.weeks, edited.suppressedMakeupOrigins).suppressedMakeupOrigins[templateKeyA]).toEqual(once)
        expect(storeA(edited.weeks, edited.suppressedMakeupOrigins).suppressedMakeupOrigins[templateKeyA]).toEqual(once)
        expect(absentA(edited.weeks, on, edited.suppressedMakeupOrigins).ledgers.suppressedMakeupOrigins[templateKeyA]).toEqual(once)
        // 削除の後の科目の編集の戻し（数へ戻す）は外す側（applyStudentEdit）と同じ 1 件なので、休み → 解除 → 数へ戻す で抑止が残らない。
        const absent = absentA(legacyBoard(on), on)
        const cleared = structuredClone(absent.nextWeeks)
        const desk = FX.cellOf(cleared, FX.WED_CELL).desks[0]
        clearStudentStatusFromDesk(desk, 0, desk.statusSlots![0]!)
        const back = editA(cleared, absent.ledgers.suppressedMakeupOrigins, '数', on)
        expect(back.suppressedMakeupOrigins[templateKeyA]).toBeUndefined()
        const set = holidaySet(back.weeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, back.suppressedMakeupOrigins))).toEqual({ sA__数: 1 })
      })
    }

    // 兄弟監査（2026-11-07）: 席や記録が盤面に残る外し方（そのまま休日設定・振無休・出席・別の日への移動）は、休日設定の側で同じ抑止を立てる
    //   （collectHolidayTemplateSubjectSuppressions・盤面のハンドラが机ごとの返却の前に通す）。休日設定の時点でその日その時限に 国 の授業（席・記録）が
    //   あるなら、テンプレの 数 の自動発生は同じ 1 コマ＝「その時コマ表に入っていた科目で数える」。
    const holidaySetWithSuppression = (weeks: SlotCell[][], suppressedMakeupOrigins: Record<string, Array<{ dateKey: string; slotNumber?: number }>> = {}) => {
      let suppressed = suppressedMakeupOrigins
      for (const cell of weeks.flat()) {
        if (cell.dateKey === FX.WED) suppressed = collectHolidayTemplateSubjectSuppressions({ cell, suppressedMakeupOrigins: suppressed, resolveStockId: FX.resolveStudentKey })
      }
      return { ...holidaySet(weeks), suppressedMakeupOrigins: suppressed }
    }
    const markRecord = (weeks: SlotCell[][], status: 'attended' | 'absent-no-makeup') => {
      const next = structuredClone(weeks)
      const cell = FX.cellOf(next, FX.WED_CELL)
      const desk = cell.desks[0]
      const entry = buildStudentStatusEntry(desk.lesson!.studentSlots[0]!, cell, desk, status)
      desk.lesson!.studentSlots[0] = null
      desk.statusSlots = [entry, desk.statusSlots?.[1] ?? null]
      return next
    }

    for (const on of [false, true]) {
      const flag = on ? 'フラグ ON' : 'フラグ OFF'
      it(`${flag}: 外さずにそのまま休日設定 → 未消化振替は 国 の 1 件だけ（修正前は 国 と 数 の 2 件）。休日解除で 0 件・A（国）が席に戻る`, () => {
        const set = holidaySetWithSuppression(legacyBoard(on))
        expect(set.suppressedMakeupOrigins).toEqual({ [templateKeyA]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
        expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, set.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
        const released = computeHolidayReleaseRestoration({ weeks: set.weeks, dateKey: FX.WED, ledgers: set.ledgers, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: FX.resolveStudentKey, templateOriginRules: on })
        expect(keysOf(FX.balances(released.nextWeeks, ROWS, released.ledgers.manualMakeupAdjustments, FX.settings(), set.suppressedMakeupOrigins))).toEqual({})
        expect(FX.cellOf(released.nextWeeks, FX.WED_CELL).desks[0].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '国' })
      })

      for (const status of ['absent-no-makeup', 'attended'] as const) {
        it(`${flag}: ${status === 'attended' ? '出席' : '振無休'} → 休日設定: 未消化振替は 国 の 1 件だけ（修正前は 国 と 数 の 2 件）`, () => {
          const set = holidaySetWithSuppression(markRecord(legacyBoard(on), status))
          expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, set.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
        })
      }

      it(`${flag}: 別の日へ移動 → 元の日を休日設定: 未消化振替は 0 件（修正前はテンプレの 数 が 1 件）・移動先の振替（国）は残る`, () => {
        const weeks = legacyBoard(on)
        const moving = FX.cellOf(weeks, FX.WED_CELL).desks[0].lesson!.studentSlots[0]!
        const moved = computeStudentMove({
          weeks, weekIndex: 0, cells: weeks[0], movingStudentId: moving.id, cellId: FX.THU_CELL, deskIndex: 1, studentIndex: 0,
          suppressedRegularLessonOccurrences: [], managedStudentByAnyName: byName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: on, sourceSeat: { cellId: FX.WED_CELL, deskIndex: 0, studentIndex: 0 },
        })
        if (moved.status !== 'moved') throw new Error(moved.message)
        const set = holidaySetWithSuppression(moved.nextWeeks)
        expect(keysOf(FX.balances(set.weeks, ROWS, set.ledgers.manualMakeupAdjustments, HOLIDAY, set.suppressedMakeupOrigins))).toEqual({})
        expect(FX.cellOf(set.weeks, FX.THU_CELL).desks[1].lesson?.studentSlots[0]).toMatchObject({ managedStudentId: 'sA', subject: '国', lessonType: 'makeup', makeupSourceDate: FX.WED })
      })

      it(`${flag}: 休み（修正前に積んだ記録＝テンプレの科目の抑止なし）→ 休日設定: 国 の 1 件だけ`, () => {
        const absent = absentA(legacyBoard(on), on)
        const set = holidaySetWithSuppression(absent.nextWeeks, {})
        expect(keysOf(FX.balances(set.weeks, ROWS, { ...absent.ledgers.manualMakeupAdjustments, ...set.ledgers.manualMakeupAdjustments }, HOLIDAY, set.suppressedMakeupOrigins))).toEqual({ sA__国: 1 })
      })
    }

    it('配線: 盤面の休日設定は机の返却の前に collectHolidayTemplateSubjectSuppressions を通し、その抑止で確定する（handleToggleHolidayDate）', () => {
      const source = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
      const start = source.indexOf('const handleToggleHolidayDate = ')
      const handler = source.slice(start, source.indexOf('\n  const handle', start + 10))
      expect(handler).toMatch(/nextSuppressedMakeupOrigins = collectHolidayTemplateSubjectSuppressions\(\{ cell, suppressedMakeupOrigins: nextSuppressedMakeupOrigins/)
      expect(handler.indexOf('collectHolidayTemplateSubjectSuppressions(')).toBeLessThan(handler.indexOf('includeManualAddedLessons: true'))
      expect(handler).toMatch(/ledgers\.manualMakeupAdjustments,\n\s+nextSuppressedMakeupOrigins,\n\s+ledgers\.fallbackMakeupStudents/)
    })

    it('ロック: 休日設定の側の抑止も、科目を変えていない授業・編集で積んだ抑止がある授業には何も足さない（1 件のまま）', () => {
      expect(holidaySetWithSuppression(board(false)).suppressedMakeupOrigins).toEqual({})
      const edited = editA(board(true), {}, '国', true)
      expect(holidaySetWithSuppression(edited.weeks, edited.suppressedMakeupOrigins).suppressedMakeupOrigins).toEqual(edited.suppressedMakeupOrigins)
    })

    it('ロック: 科目を変えていない授業（数）の削除・格納・休み・全コマ削除はテンプレの科目の抑止を足さない（従来と同じ・削除は今の科目の抑止 1 件）', () => {
      const base = board(false)
      expect(deleteA(base, {}).suppressedMakeupOrigins).toEqual({ [templateKeyA]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
      expect(storeA(base, {}).suppressedMakeupOrigins).toEqual({})
      expect(absentA(base, false).ledgers.suppressedMakeupOrigins).toEqual({})
      const cleared = collectClearedDayMakeupSuppressions({ cell: FX.cellOf(base, FX.WED_CELL), suppressedMakeupOrigins: {}, resolveStockId: FX.resolveStudentKey })
      expect(cleared[templateKeyA]).toEqual([{ dateKey: FX.WED, slotNumber: FX.SLOT }])
    })

    it('ロック: 手で足した通常授業（manualAdded）・振替・授業 ID がテンプレの形でない授業は対象外（ensureTemplateSubjectMakeupSuppression が何も足さない）', () => {
      const seat = FX.cellOf(board(false), FX.WED_CELL).desks[0].lesson!.studentSlots[0]!
      const legacy = { ...seat, subject: '国' as const }
      expect(ensureTemplateSubjectMakeupSuppression({}, legacy, FX.WED, FX.SLOT, FX.resolveStudentKey)).toEqual({ [templateKeyA]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
      expect(ensureTemplateSubjectMakeupSuppression({}, { ...legacy, manualAdded: true }, FX.WED, FX.SLOT, FX.resolveStudentKey)).toEqual({})
      expect(ensureTemplateSubjectMakeupSuppression({}, { ...legacy, lessonType: 'makeup', makeupSourceDate: FX.WED }, FX.WED, FX.SLOT, FX.resolveStudentKey)).toEqual({})
      expect(ensureTemplateSubjectMakeupSuppression({}, { ...legacy, id: 'manual-123' }, FX.WED, FX.SLOT, FX.resolveStudentKey)).toEqual({})
      // 時限なしの旧い抑止がその日にあれば足さない（日付ごと落としている＝既に抑止済み）。
      expect(ensureTemplateSubjectMakeupSuppression({ [templateKeyA]: [{ dateKey: FX.WED }] }, legacy, FX.WED, FX.SLOT, FX.resolveStudentKey)).toEqual({ [templateKeyA]: [{ dateKey: FX.WED }] })
      // 同じ日の中で動かした授業は元の時限（sameDayMoveSourceLabel）で立てる（休日の自動発生はテンプレ行の時限）。
      expect(ensureTemplateSubjectMakeupSuppression({}, { ...legacy, sameDayMoveSourceDate: FX.WED, sameDayMoveSourceLabel: '2026/10/7(水) 5限' }, FX.WED, 3, FX.resolveStudentKey)).toEqual({ [templateKeyA]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
    })
  })

  it('この修正より前に科目を編集した授業（抑止なしの 国）も、次の科目の編集（国→英）で抑止が 1 件付く', () => {
    const legacy = structuredClone(board(false))
    const seat = FX.cellOf(legacy, FX.WED_CELL).desks[0].lesson!.studentSlots
    seat[0] = { ...seat[0]!, subject: '国' }
    expect(editA(legacy, {}, '英', false).suppressedMakeupOrigins).toEqual({ [buildMakeupStockKey('sA', '数')]: [{ dateKey: FX.WED, slotNumber: FX.SLOT }] })
  })
})
