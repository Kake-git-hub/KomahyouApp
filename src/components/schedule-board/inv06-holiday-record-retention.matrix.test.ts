import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  clearStudentStatusFromDesk,
  convertHolidayDeskEntriesToRecords,
  reconcileHolidayDeskStockReturns,
} from './ScheduleBoardScreen'

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
