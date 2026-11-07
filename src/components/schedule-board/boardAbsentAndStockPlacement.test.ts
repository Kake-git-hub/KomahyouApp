// 「休み」と「未消化振替の配置」の本体を純関数へ切り出した（確認リストの「準備する」第 4 段が室長の操作と同じ処理を通すため・
// docs/plan-2026-11-07-checklist-auto-prep-stage3.md §6）。切り出しで挙動を変えない（INV-06）ことを固定する:
//   computeStudentAbsentMark … markStudentAbsentAt（メニューの「休み」・保護者連絡の自動処理）の本体。
//   computeMakeupStockPlacement … handlePlaceMakeupFromStock（未消化振替の一覧から席へ置く）の本体。
// あわせて、コマ表の 2 つの経路がこの純関数を通すこと（別実装を持たない）を字面で固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { StudentRow } from '../basic-data/basicDataModel'
import { buildManagedStudentByAnyNameMap, computeMakeupStockPlacement, computeStudentAbsentMark } from './ScheduleBoardScreen'
import type { MakeupStockEntry } from './makeupStock'
import type { DeskCell, SlotCell, StudentEntry } from './types'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

const students: StudentRow[] = [
  { id: 's1', name: '青木', displayName: '青木', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  { id: 's2', name: '馬場', displayName: '馬場', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
]
const byName = buildManagedStudentByAnyNameMap(students)
const resolveStockId = (student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'manualAdded'>) => student.managedStudentId ?? byName.get(student.name)?.id ?? `name:${student.name}`

function desk(id: string, teacher: string, slots: [StudentEntry | null, StudentEntry | null] | null): DeskCell {
  return { id, teacher, ...(slots ? { lesson: { id: `${id}_lesson`, studentSlots: slots } } : {}) }
}
function cell(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '木', dateLabel: '10/8', slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks } as SlotCell
}
const regular = (id: string, managedStudentId: string, name: string): StudentEntry => ({ id, name, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })

function board(): SlotCell[][] {
  return [[
    cell('2026-10-08', 5, [desk('d1', '田中', [regular('e1', 's1', '青木'), null]), desk('d2', '', null), desk('d3', '', null)]),
    cell('2026-10-08', 4, [desk('d4', '鈴木', [regular('e2', 's2', '馬場'), null]), desk('d5', '', null)]),
  ]]
}

const emptyLedgers = () => ({
  manualMakeupAdjustments: {}, suppressedMakeupOrigins: {}, fallbackMakeupStudents: {},
  manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackLectureStockStudents: {},
  suppressedRegularLessonOccurrences: [] as string[],
})

describe('computeStudentAbsentMark（休みの本体・markStudentAbsentAt と同じ）', () => {
  it('通常授業: 席を休みの記録にし、未消化振替の手動 origin（元の日付・時限）と削除記録を積む。ほかの席・週は変えない', () => {
    const weeks = board()
    const result = computeStudentAbsentMark({
      weeks, weekIndex: 0, seat: { cellId: '2026-10-08_5', deskIndex: 0, studentIndex: 0 }, ...emptyLedgers(),
      ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name) => name, resolveStockId,
    })
    if (!result) throw new Error('not found')
    expect(result.kind).toBe('makeup-returned')
    const target = result.nextWeeks[0][0].desks[0]
    expect(target.lesson).toBeUndefined()
    expect(target.statusSlots?.[0]).toMatchObject({ status: 'absent', managedStudentId: 's1', dateKey: '2026-10-08', slotNumber: 5 })
    expect(result.ledgers.manualMakeupAdjustments).toEqual({ 's1__数': [expect.objectContaining({ dateKey: '2026-10-08' })] })
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([expect.stringContaining('2026-10-08')])
    expect(result.makeupStock).toEqual({ stockKey: 's1__数', originDate: '2026-10-08', originSlotNumber: 5 })
    // 入力は書き換えない・ほかのコマは同じ中身。
    expect(weeks[0][0].desks[0].lesson?.studentSlots[0]?.id).toBe('e1')
    expect(result.nextWeeks[0][1]).toEqual(weeks[0][1])
    expect(result.ledgers.manualLectureStockCounts).toEqual({})
  })

  it('在庫から置いた振替（振替元あり）を休みにしても手動 origin は積まない（算出で復元・2026-07-31 の非対称ガード）', () => {
    const weeks = board()
    weeks[0][0].desks[0].lesson!.studentSlots[0] = { ...regular('e1', 's1', '青木'), lessonType: 'makeup', makeupSourceDate: '2026-10-01', makeupSourceLabel: '2026/10/1(木) 5限' }
    const result = computeStudentAbsentMark({
      weeks, weekIndex: 0, seat: { cellId: '2026-10-08_5', deskIndex: 0, studentIndex: 0 }, ...emptyLedgers(),
      ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name) => name, resolveStockId,
    })
    if (!result) throw new Error('not found')
    expect(result.ledgers.manualMakeupAdjustments).toEqual({})
    expect(result.makeupStock).toEqual({ stockKey: 's1__数', originDate: '2026-10-01', originSlotNumber: 5 })
  })

  it('講習（期間あり）は未消化講習へ戻す。期間が無い講習は戻さない', () => {
    const lecture = (sessionId?: string): StudentEntry => ({ ...regular('e1', 's1', '青木'), lessonType: 'special', ...(sessionId ? { specialSessionId: sessionId } : {}) })
    for (const [sessionId, kind] of [['ss1', 'lecture-returned'], [undefined, 'lecture-kept']] as const) {
      const weeks = board()
      weeks[0][0].desks[0].lesson!.studentSlots[0] = lecture(sessionId)
      const result = computeStudentAbsentMark({
        weeks, weekIndex: 0, seat: { cellId: '2026-10-08_5', deskIndex: 0, studentIndex: 0 }, ...emptyLedgers(),
        ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name) => name, resolveStockId,
      })
      if (!result) throw new Error('not found')
      expect(result.kind).toBe(kind)
      expect(result.makeupStock).toBeNull()
      expect(Object.values(result.ledgers.manualLectureStockCounts)).toEqual(kind === 'lecture-returned' ? [1] : [])
      expect(result.ledgers.manualMakeupAdjustments).toEqual({})
      expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([])
    }
  })

  // Issue #57（INV-06）: 席に前の生徒の振替コマの出欠記録（移動で残った休みの記録）が残っていると、休みの記録で上書きする前に台帳へ確定する。
  it('席に前の生徒の振替の休みの記録が残っていれば、上書きする前にその振替元を台帳に積む（台帳に既にあれば積まない）', () => {
    const previousRecord = {
      id: 'st-prev', studentId: 's2', managedStudentId: 's2', sourceManagedLesson: false, name: '馬場', grade: '中2' as const, subject: '数' as const, lessonType: 'makeup' as const, teacherType: 'normal' as const,
      teacherName: '田中', dateKey: '2026-10-08', slotNumber: 5, recordedAt: '2026-10-05T10:00:00Z', status: 'absent' as const, sourceLessonId: 'l-prev',
      makeupSourceDate: '2026-10-01', makeupSourceLabel: '2026/10/1(木) 4限',
    }
    const run = (ledgerOriginDatesByKey: Record<string, string[]>) => {
      const weeks = board()
      weeks[0][0].desks[0].statusSlots = [previousRecord, null]
      return computeStudentAbsentMark({
        weeks, weekIndex: 0, seat: { cellId: '2026-10-08_5', deskIndex: 0, studentIndex: 0 }, ...emptyLedgers(),
        ledgerOriginDatesByKey, managedStudentByAnyName: byName, resolveDisplayName: (name) => name, resolveStockId,
      })!
    }
    const result = run({})
    expect(result.displacedStatusEntry).toMatchObject({ id: 'st-prev', managedStudentId: 's2' })
    // 前の生徒（馬場）の振替元（10/1 4限）と、休みにした生徒（青木）の振替元の両方が台帳に入る。
    expect(result.ledgers.manualMakeupAdjustments).toEqual({
      's2__数': [{ dateKey: '2026-10-01', slotNumber: 4 }],
      's1__数': [expect.objectContaining({ dateKey: '2026-10-08' })],
    })
    // 席の記録は休みにした生徒の記録に替わる。
    expect(result.nextWeeks[0][0].desks[0].statusSlots?.[0]).toMatchObject({ status: 'absent', managedStudentId: 's1' })
    // 台帳に既にある振替元は二重に積まない。
    expect(run({ 's2__数': ['2026-10-01'] }).ledgers.manualMakeupAdjustments).toEqual({ 's1__数': [expect.objectContaining({ dateKey: '2026-10-08' })] })
  })

  it('席が見つからなければ null', () => {
    expect(computeStudentAbsentMark({
      weeks: board(), weekIndex: 0, seat: { cellId: '2026-10-08_5', deskIndex: 1, studentIndex: 0 }, ...emptyLedgers(),
      ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name) => name, resolveStockId,
    })).toBeNull()
  })
})

function stockEntry(overrides: Partial<MakeupStockEntry> = {}): MakeupStockEntry {
  return {
    key: 's1__数', studentId: 's1', studentName: '青木', displayName: '青木', subject: '数', balance: 1, autoShortage: 0, absentMakeupOrigins: 0, manualAdjustments: 1,
    plannedMakeups: 0, totalLessonCount: 0, assignedRegularLessons: 0, assignedMakeupLessons: 0, overAssignedRegularLessons: 0,
    remainingOriginDates: ['2026-10-01', '2026-10-02'], remainingOriginSlots: [5, 4], remainingOriginLabels: ['2026/10/1(木) 5限', '2026/10/2(金) 4限'], remainingOriginReasonLabels: ['休み', '休み'],
    nextOriginDate: '2026-10-01', nextOriginSlot: 5, nextOriginLabel: '2026/10/1(木) 5限', nextOriginReasonLabel: '休み', negativeReason: null, ...overrides,
  }
}

describe('computeMakeupStockPlacement（未消化振替の配置の本体・handlePlaceMakeupFromStock と同じ）', () => {
  const place = (weeks: SlotCell[][], target: { cellId: string; deskIndex: number; studentIndex: number }, selectedOriginToken: string | null = null) => computeMakeupStockPlacement({
    weeks, weekIndex: 0, ...target, stockStudentKey: 's1', stockDisplayName: '青木', placementEntry: stockEntry(), selectedOriginToken, students,
    createStudentId: (cellId, deskIndex, studentIndex) => `${cellId}_${deskIndex}_${studentIndex}_x`, managedStudentByAnyName: byName, resolveDisplayName: (name) => name,
  })

  it('空き席へ振替（手入力）を置く。選んだ振替元（日付#限）を使い、空き机には「元の通常授業」の注記つきの授業を作る', () => {
    const result = place(board(), { cellId: '2026-10-08_4', deskIndex: 1, studentIndex: 0 }, '2026-10-02#4')
    if (result.status !== 'placed') throw new Error(result.status)
    const placedDesk = result.nextWeeks[0][1].desks[1]
    expect(placedDesk.lesson).toMatchObject({ id: '2026-10-08_4_desk_2_makeup', note: '元の通常授業: 2026/10/2(金) 4限（休み）' })
    expect(placedDesk.lesson?.studentSlots[0]).toMatchObject({ id: '2026-10-08_4_1_0_x', name: '青木', managedStudentId: 's1', subject: '数', lessonType: 'makeup', makeupSourceDate: '2026-10-02', makeupSourceLabel: '2026/10/2(金) 4限' })
    expect(result.resolvedOriginDate).toBe('2026-10-02')
  })

  it('選んでいなければ最古の振替元。埋まった席・メモの席・同じコマに同じ生徒が居る席には置かない（理由の文は今の文）', () => {
    const oldest = place(board(), { cellId: '2026-10-08_4', deskIndex: 1, studentIndex: 0 })
    if (oldest.status !== 'placed') throw new Error(oldest.status)
    expect(oldest.resolvedOriginDate).toBe('2026-10-01')
    expect(place(board(), { cellId: '2026-10-08_4', deskIndex: 0, studentIndex: 0 })).toEqual({ status: 'blocked', message: 'クリックした移動先は埋まっています。空欄の生徒マスを選んでください。' })
    const memo = board()
    memo[0][1].desks[1].memoSlots = ['自習', null]
    expect(place(memo, { cellId: '2026-10-08_4', deskIndex: 1, studentIndex: 0 })).toEqual({ status: 'blocked', message: 'クリックした移動先にはメモがあります。メモを削除してから配置してください。' })
    expect(place(board(), { cellId: '2026-10-08_5', deskIndex: 1, studentIndex: 0 })).toEqual({ status: 'blocked', message: '同コマにすでに青木が組まれているため振替できません。' })
    expect(place(board(), { cellId: '2026-10-08_5', deskIndex: 9, studentIndex: 0 })).toEqual({ status: 'missing' })
  })
})

describe('コマ表の経路が純関数を通す（別実装を持たない）', () => {
  it('markStudentAbsentAt は computeStudentAbsentMark の結果を commitWeeks に渡すだけ', () => {
    const start = BOARD_TSX.indexOf('const markStudentAbsentAt = ')
    const end = BOARD_TSX.indexOf('const handleMarkStudentAbsent = () => {')
    const body = BOARD_TSX.slice(start, end)
    expect(body).toContain('computeStudentAbsentMark({')
    expect(body).not.toContain('appendMakeupOrigin(')
    expect(body).not.toContain('removeStudentFromDeskLesson(')
  })

  it('handlePlaceMakeupFromStock は休日の判定のあとで computeMakeupStockPlacement を呼び、その結果を commit する', () => {
    const start = BOARD_TSX.indexOf('const handlePlaceMakeupFromStock = (')
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('const handlePlaceLectureFromStock = (', start))
    const guard = body.indexOf('resolveClosedDayStudentPlacementBlock(cells.find((cell) => cell.id === cellId))')
    expect(guard).toBeGreaterThan(0)
    expect(body.indexOf('computeMakeupStockPlacement({')).toBeGreaterThan(guard)
    expect(body.indexOf('commitWeeks(placement.nextWeeks')).toBeGreaterThan(body.indexOf('computeMakeupStockPlacement({'))
    expect(body).not.toContain('normalizeLessonPlacement(')
  })

  it('handlePlaceMakeupFromStock は出席不可コマの確認（confirmReopenForPlacements）を通してから commit し、承認分を黄色化する', () => {
    const start = BOARD_TSX.indexOf('const handlePlaceMakeupFromStock = (')
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('const handlePlaceLectureFromStock = (', start))
    const placementIndex = body.indexOf('computeMakeupStockPlacement({')
    const confirmIndex = body.indexOf('const reopenTargets = confirmReopenForPlacements([{')
    const commitIndex = body.indexOf('commitWeeks(placement.nextWeeks')
    expect(confirmIndex).toBeGreaterThan(placementIndex)
    expect(commitIndex).toBeGreaterThan(confirmIndex)
    expect(body.slice(confirmIndex, commitIndex)).toContain("setStatusMessage('出席不可コマへの配置を取りやめました。')")
    expect(body.slice(commitIndex)).toContain('if (reopenTargets.length > 0) onApplyReopenedSlots?.(reopenTargets)')
  })
})
