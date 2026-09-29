// テンプレ差分反映の保留（2 行）を盤面で解決する操作の回帰防止テスト（Issue #72・第 1 段 (B)・
// docs/spec-template-behavior.md §H Q26〜Q28・Q30・Q31）。
//
// 固定すること（受け入れ条件の番号は spec §実装タスク 第 1 段）:
//   - 下段の削除（条件 11）・テンプレを採用（条件 12）・既存を採用（条件 13・14）の在庫と希望回数
//   - 上段の休み → 1 行に戻る（条件 15）・合流の枠超過（条件 16）
//   - 2 行の机の生徒メニュー（条件 18）・2 行の机への着地不可（Q26-5）
//   - 解決操作の一意性検査（条件 19・INV-12）
//   - バッジ件数（条件 27）・保留がある日の休日設定/全コマ削除/丸ごと振替の停止（条件 28）

import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  buildManagedOccurrenceKey,
  buildManagedScheduleCellsForRange,
  computePendingDeskResolution,
  computePendingLowerStudentMove,
  computeTemplateDiffApplyForBoard,
  remergeBoardWeeksWithManagedData,
  type TemplatePendingResolutionLedgers,
} from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import {
  countTemplatePendingDesksOnBoard,
  resolveTemplatePendingDateBlockReason,
  resolveTemplatePendingLandingBlock,
  resolveTemplatePendingStudentMenuActions,
  settleTemplatePendingDesksAfterCommit,
  TEMPLATE_PENDING_MESSAGES,
} from './templatePendingResolution'
import { buildMakeupStockEntries, type ManualMakeupOrigin } from './makeupStock'

// ─────────────────────────────────────────────────────────────────────────────
// フィクスチャ（templateDiffApply.test.ts と同じ形：水曜 5 限・机 3 つ・反映日 2026-10-07）
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const OTHER_SLOT_CELL_ID = `${DATE}_4`
const TODAY = new Date('2026-10-01T00:00:00')
const TODAY_KEY = '2026-09-29'

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const students = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉'), studentRow('sD', '土屋'), studentRow('sM', '三浦')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤')]

function row(id: string, teacherId: string, student1Id = '', subject1 = '', student2Id = '', subject2 = '', dayOfWeek = 3, slotNumber = SLOT): RegularLessonRow {
  return {
    id, schoolYear: 2026, teacherId, student1Id, subject1, startDate: '', endDate: '', student2Id, subject2,
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek, slotNumber,
  }
}

function settings(extra: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, templateFreezeBeforeDate: EFFECTIVE, ...extra } as ClassroomSettings
}

const OLD_ROWS = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]

function buildWeek(rows: RegularLessonRow[]): SlotCell[] {
  return buildManagedScheduleCellsForRange({
    range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
    fallbackStartDate: WEEK_START,
    fallbackEndDate: WEEK_END,
    classroomSettings: settings({ templateFreezeBeforeDate: undefined }),
    teachers,
    students,
    regularLessons: rows,
    boardWeeks: [],
  })
}

function cellOf(weeks: SlotCell[][], cellId = CELL_ID) {
  const cell = weeks.flat().find((item) => item.id === cellId)
  if (!cell) throw new Error(`cell ${cellId} not found`)
  return cell
}

function deskOf(weeks: SlotCell[][], index: number, cellId = CELL_ID) {
  return cellOf(weeks, cellId).desks[index]
}

function mutateDesk(week: SlotCell[], index: number, update: (desk: DeskCell) => DeskCell, cellId = CELL_ID) {
  return week.map((cell) => (cell.id !== cellId ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === index ? update(desk) : desk)) }))
}

function entry(studentId: string, overrides: Partial<StudentEntry> = {}): StudentEntry {
  const source = students.find((student) => student.id === studentId)!
  return {
    id: `${studentId}_board_${overrides.lessonType ?? 'regular'}`,
    name: source.name,
    managedStudentId: studentId,
    grade: '中2',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function status(studentId: string, statusKind: StudentStatusEntry['status'], overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  const source = students.find((student) => student.id === studentId)!
  return {
    id: `status_${studentId}_${statusKind}`,
    studentId: `${studentId}_entry`,
    sourceManagedLesson: true,
    name: source.name,
    managedStudentId: studentId,
    grade: '中2',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '田中',
    dateKey: DATE,
    slotNumber: SLOT,
    recordedAt: '2026-10-01T00:00:00.000Z',
    status: statusKind,
    sourceLessonId: 'lesson-x',
    ...overrides,
  }
}

function applyDiff(week: SlotCell[], newRows: RegularLessonRow[], suppressed: string[] = []) {
  return computeTemplateDiffApplyForBoard({
    weeks: [week],
    classroomSettings: settings(),
    teachers,
    students,
    regularLessons: newRows,
    effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: suppressed,
    templatePendingDesks: {},
    createdAt: '2026-09-29T10:00:00.000Z',
  })
}

function liveIds(desk: DeskCell) {
  return (desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)
}

// 振替の在庫台帳（在庫由来の振替 M・D の origin）。
const MANUAL_ADJUSTMENTS: Record<string, ManualMakeupOrigin[]> = {
  'sM__数': [{ dateKey: '2026-09-30' }],
  'sD__数': [{ dateKey: '2026-09-23' }],
}

function emptyLedgers(extra: Partial<TemplatePendingResolutionLedgers> = {}): TemplatePendingResolutionLedgers {
  return {
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
    ...extra,
  }
}

const CONTEXT = {
  managedStudentByAnyName: new Map<string, StudentRow>(students.map((student) => [student.name, student])),
  resolveDisplayName: (name: string) => name,
  resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name,
  ledgerOriginDatesByKey: { 'sM__数': ['2026-09-30'], 'sD__数': ['2026-09-23'] } as Record<string, string[]>,
}

function balances(weeks: SlotCell[][], rows: RegularLessonRow[], templatePendingDesks: TemplatePendingDeskMap | undefined, ledgers: TemplatePendingResolutionLedgers) {
  const manual: Record<string, ManualMakeupOrigin[]> = { ...MANUAL_ADJUSTMENTS }
  for (const [key, origins] of Object.entries(ledgers.manualMakeupAdjustments)) manual[key] = [...(manual[key] ?? []), ...origins]
  const entries = buildMakeupStockEntries({
    students,
    teachers,
    regularLessons: rows,
    classroomSettings: settings(),
    weeks,
    manualAdjustments: manual,
    suppressedOrigins: ledgers.suppressedMakeupOrigins,
    resolveStudentKey: (student) => student.managedStudentId ?? student.name,
    today: TODAY,
    templatePendingDesks,
  })
  return Object.fromEntries(entries.map((item) => [item.key, item.balance]))
}

// 机0 に在庫由来の振替 M（下段になる）・メモ・移動元の記録、新テンプレは机0 に C → 保留（2 行）。
function pendingWithMakeupLower(lowerOverrides: Partial<StudentEntry> = {}) {
  let week = buildWeek(OLD_ROWS)
  week = mutateDesk(week, 0, (desk) => ({
    ...desk,
    lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限', ...lowerOverrides }), null] },
    statusSlots: [null, status('sD', 'moved')],
    memoSlots: [null, '持ち物'],
  }))
  const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
  const diff = applyDiff(week, newRows)
  const deskId = deskOf(diff.nextWeeks, 0).id
  const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
  expect(diff.nextPendingDesks[key]).toBeDefined()
  return { before: [week], diff, newRows, deskId, key }
}

// ─────────────────────────────────────────────────────────────────────────────
// 盤面の形だけの純関数
// ─────────────────────────────────────────────────────────────────────────────

describe('バッジ件数（条件 27）と保留のある日の停止（条件 28・Q31）', () => {
  it('盤面に存在する机を指し、反映日以降のキーだけ数える（孤児・反映日より前は数えない）', () => {
    const { diff, key } = pendingWithMakeupLower()
    const map: TemplatePendingDeskMap = {
      ...diff.nextPendingDesks,
      [buildTemplatePendingDeskKey('2099-01-01_5', 'x')]: diff.nextPendingDesks[key],
      [buildTemplatePendingDeskKey(`2026-10-06_${SLOT}`, `2026-10-06_${SLOT}_desk_1`)]: diff.nextPendingDesks[key],
    }
    expect(countTemplatePendingDesksOnBoard(diff.nextPendingDesks, diff.nextWeeks)).toBe(1)
    expect(countTemplatePendingDesksOnBoard(map, diff.nextWeeks)).toBe(1)
    expect(countTemplatePendingDesksOnBoard({}, diff.nextWeeks)).toBe(0)
  })

  it('保留がある日は休日設定・全コマ削除・丸ごと振替の前に止める理由が出る。保留の無い日・保留が無い教室は null', () => {
    const { diff } = pendingWithMakeupLower()
    expect(resolveTemplatePendingDateBlockReason(diff.nextPendingDesks, diff.nextWeeks, DATE, '休日設定')).toContain('先に保留を片づけてください')
    expect(resolveTemplatePendingDateBlockReason(diff.nextPendingDesks, diff.nextWeeks, DATE, '休日設定')).toContain('1 机')
    expect(resolveTemplatePendingDateBlockReason(diff.nextPendingDesks, diff.nextWeeks, '2026-10-08', '休日設定')).toBeNull()
    expect(resolveTemplatePendingDateBlockReason({}, diff.nextWeeks, DATE, '休日設定')).toBeNull()
  })
})

describe('2 行の机の生徒メニュー（条件 18・Q26-2・Q26-3・Q27）', () => {
  it('上段は休み・振無休・移動・削除だけ（出席は出さない）', () => {
    const actions = resolveTemplatePendingStudentMenuActions('upper')
    expect(actions).toEqual(['absent', 'absent-no-makeup', 'move', 'delete'])
    expect(actions).not.toContain('attend')
  })

  it('下段の生徒は削除・移動だけ（出席・休み・振無休は出さない）。メモだけの下段は削除だけ', () => {
    const lower = resolveTemplatePendingStudentMenuActions('lower', 'student')
    expect(lower).toEqual(['delete', 'move'])
    for (const forbidden of ['attend', 'absent', 'absent-no-makeup'] as const) expect(lower).not.toContain(forbidden)
    expect(resolveTemplatePendingStudentMenuActions('lower', 'memo')).toEqual(['delete'])
  })

  it('他の机から 2 行の机（上段の空席を含む）への着地は不可。同じ机の中・保留でない机は可（Q26-5）', () => {
    const { diff, key } = pendingWithMakeupLower()
    const cell = cellOf(diff.nextWeeks)
    const otherKey = buildTemplatePendingDeskKey(CELL_ID, cell.desks[1].id)
    expect(resolveTemplatePendingLandingBlock(diff.nextPendingDesks, cell, 0, otherKey)).toBe(TEMPLATE_PENDING_MESSAGES.landingBlocked)
    expect(resolveTemplatePendingLandingBlock(diff.nextPendingDesks, cell, 0, null)).toBe(TEMPLATE_PENDING_MESSAGES.landingBlocked)
    expect(resolveTemplatePendingLandingBlock(diff.nextPendingDesks, cell, 0, key)).toBeNull()
    expect(resolveTemplatePendingLandingBlock(diff.nextPendingDesks, cell, 1, key)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 解決操作（台帳つき）
// ─────────────────────────────────────────────────────────────────────────────

function resolve(mode: Parameters<typeof computePendingDeskResolution>[0]['mode'], setup: ReturnType<typeof pendingWithMakeupLower>, extra: { lowerIndex?: number; ledgers?: TemplatePendingResolutionLedgers; weeks?: SlotCell[][]; pending?: TemplatePendingDeskMap } = {}) {
  return computePendingDeskResolution({
    mode,
    weeks: extra.weeks ?? setup.diff.nextWeeks,
    cellId: CELL_ID,
    deskId: setup.deskId,
    lowerIndex: extra.lowerIndex,
    templatePendingDesks: extra.pending ?? setup.diff.nextPendingDesks,
    ledgers: extra.ledgers ?? emptyLedgers(),
    ...CONTEXT,
  })
}

describe('下段の削除（条件 11・Q26-3）', () => {
  it('在庫由来の振替を削除すると未消化振替が 1 増え、下段に生徒がいなくなれば 1 行へ（メモは机へ・移動元の記録は捨てる）', () => {
    const setup = pendingWithMakeupLower()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('delete-lower-student', setup, { lowerIndex: 0 })
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.nextTemplatePendingDesks[setup.key]).toBeUndefined()
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sC'])
    expect(desk0.memoSlots?.filter(Boolean)).toEqual(['持ち物'])
    expect((desk0.statusSlots ?? []).filter(Boolean).map((item) => item!.status)).not.toContain('moved')
    expect(result.ledgers.scheduleCountAdjustments).toEqual([])
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数']).toBe((before['sM__数'] ?? 0) + 1)
  })

  it('手動追加の振替を削除しても未消化振替は増えない', () => {
    const setup = pendingWithMakeupLower({ manualAdded: true })
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('delete-lower-student', setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
    expect(result.returnedCount).toBe(0)
  })

  it('在庫由来の講習を削除すると未消化講習が 1 増え、手動追加の講習は増えない', () => {
    const session = pendingWithMakeupLower({ lessonType: 'special', makeupSourceDate: undefined, makeupSourceLabel: undefined, specialStockSource: 'session', specialSessionId: 'ss1' })
    const sessionResult = resolve('delete-lower-student', session, { lowerIndex: 0 })
    if (sessionResult.status !== 'applied') throw new Error(sessionResult.message)
    expect(Object.values(sessionResult.ledgers.manualLectureStockCounts)).toEqual([1])
    const manual = pendingWithMakeupLower({ lessonType: 'special', makeupSourceDate: undefined, makeupSourceLabel: undefined, specialStockSource: 'manual', specialSessionId: 'ss1' })
    const manualResult = resolve('delete-lower-student', manual, { lowerIndex: 0 })
    if (manualResult.status !== 'applied') throw new Error(manualResult.message)
    expect(manualResult.ledgers.manualLectureStockCounts).toEqual({})
  })

  it('メモだけの下段（合流できずに残った机）はメモの削除で 1 行に戻る', () => {
    const setup = pendingWithMakeupLower()
    // 下段の生徒だけ先に削除 → メモが机へ入れば合流済み。ここでは机の空き席を埋めて合流できない形を作る。
    const weeks = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, statusSlots: [null, status('sA', 'absent')] }))]
    const first = resolve('delete-lower-student', setup, { lowerIndex: 0, weeks })
    if (first.status !== 'applied') throw new Error(first.message)
    expect(first.collapsed).toBe(false)
    expect(first.message).toContain('先に下段を片づけてください')
    expect(first.nextTemplatePendingDesks[setup.key].lower.memoSlots).toEqual([null, '持ち物'])
    const second = resolve('delete-lower-memo', setup, { lowerIndex: 1, weeks: first.nextWeeks, pending: first.nextTemplatePendingDesks })
    if (second.status !== 'applied') throw new Error(second.message)
    expect(second.collapsed).toBe(true)
    expect(second.nextTemplatePendingDesks[setup.key]).toBeUndefined()
  })
})

describe('テンプレを採用（条件 12）', () => {
  it('下段の振替は在庫へ戻り、希望回数は変わらず、メモは枠内で机へ・表示専用の記録は捨てられる', () => {
    const setup = pendingWithMakeupLower()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('adopt-template', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.nextTemplatePendingDesks).toEqual({})
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sC'])
    expect(desk0.memoSlots?.filter(Boolean)).toEqual(['持ち物'])
    expect((desk0.statusSlots ?? []).filter(Boolean)).toEqual([])
    expect(result.ledgers.scheduleCountAdjustments).toEqual([])
    expect(balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)['sM__数']).toBe((before['sM__数'] ?? 0) + 1)
    // 再マージの不動点（1 行に戻った机が再マージで書き換わらない）
    const once = remergeBoardWeeksWithManagedData(result.nextWeeks, {
      classroomSettings: settings(),
      teachers,
      students,
      regularLessons: setup.newRows,
      suppressedRegularLessonOccurrences: result.ledgers.suppressedRegularLessonOccurrences,
      todayKey: TODAY_KEY,
    })
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
  })

  it('出欠枠を超えるなら実行せず「先に下段を片づけてください」が出て、盤面・保留マップ・台帳は変わらない（条件 16）', () => {
    const setup = pendingWithMakeupLower()
    // 机の空き席を会計記録で埋める → 下段のメモが入らない
    const weeks = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, statusSlots: [null, status('sA', 'absent')] }))]
    const ledgers = emptyLedgers()
    const result = resolve('adopt-template', setup, { weeks, ledgers })
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('先に下段を片づけてください')
  })
})

describe('既存を採用（条件 13・14・19）', () => {
  it('上段を取り下げて下段を机へ戻す。講師は変わらず、振替在庫は増えず、抑止キーで再マージ 2 回でも上段が湧かない', () => {
    const setup = pendingWithMakeupLower()
    const teacherBefore = deskOf(setup.diff.nextWeeks, 0).teacher
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sM'])
    expect(desk0.teacher).toBe(teacherBefore)
    expect(result.nextTemplatePendingDesks).toEqual({})
    // 条件 14: 戻った下段は週データ（全消費者の入力）の机にある
    expect(desk0.lesson?.studentSlots[0]?.lessonType).toBe('makeup')
    const withdrawnKey = buildManagedOccurrenceKey(entry('sC'), DATE, SLOT)
    expect(result.ledgers.suppressedRegularLessonOccurrences).toContain(withdrawnKey)
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
    expect(after['sC__数'] ?? 0).toBe(before['sC__数'] ?? 0)
    const remerge = (weeks: SlotCell[][]) => remergeBoardWeeksWithManagedData(weeks, {
      classroomSettings: settings(),
      teachers,
      students,
      regularLessons: setup.newRows,
      suppressedRegularLessonOccurrences: result.ledgers.suppressedRegularLessonOccurrences,
      todayKey: TODAY_KEY,
    })
    const once = remerge(result.nextWeeks)
    const twice = remerge(once)
    // 再マージの不動点（Q31・条件 13 の「再マージを 2 回通しても上段が湧かない」）: 机ごと変わらない
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(cellOf(twice)).toEqual(cellOf(result.nextWeeks))
    expect(liveIds(deskOf(twice, 0))).toEqual(['sM'])
    expect(cellOf(twice).desks.flatMap(liveIds).filter((id) => id === 'sC')).toHaveLength(0)
  })

  it('取り下げた生徒×科目が同じ日の実配置に残っていなければ希望回数 −1（単発削除と同じ）', () => {
    const setup = pendingWithMakeupLower()
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.countAdjustedCount).toBe(1)
    expect(result.ledgers.scheduleCountAdjustments).toEqual([{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: DATE, delta: -1 }])
  })

  it('取り下げた生徒×科目が同じ日の別の時限に生きていれば希望回数は変わらない', () => {
    const setup = pendingWithMakeupLower()
    const cSomewhereElse = setup.diff.nextWeeks.map((week) => week.map((cell) => (cell.id !== OTHER_SLOT_CELL_ID ? cell : {
      ...cell,
      desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { id: 'c_other', studentSlots: [entry('sC', { id: 'c-other', sameDayMoveSourceDate: DATE }), null] as [StudentEntry | null, StudentEntry | null] } } : desk)),
    })))
    const result = resolve('adopt-existing', setup, { weeks: cSomewhereElse })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.countAdjustedCount).toBe(0)
    expect(result.ledgers.scheduleCountAdjustments).toEqual([])
  })

  it('INV-12: 下段の生徒が同じコマの別の 1 行の机に生きていれば実行せず「先に上段側を片づけてください」（盤面・保留・台帳は不変）', () => {
    const setup = pendingWithMakeupLower()
    const weeks = [mutateDesk(setup.diff.nextWeeks[0], 2, (desk) => ({ ...desk, lesson: { id: 'm_elsewhere', studentSlots: [entry('sM', { id: 'm-elsewhere', manualAdded: true }), null] } }))]
    const ledgers = emptyLedgers()
    const result = resolve('adopt-existing', setup, { weeks, ledgers })
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('2 か所')
    expect(result.message).toContain('先に上段側を片づけてください')
  })
})

describe('下段の移動（Q26-3・Q26-5・INV-12）', () => {
  function move(setup: ReturnType<typeof pendingWithMakeupLower>, target: { cellId?: string; deskIndex: number; studentIndex: number }, weeks = setup.diff.nextWeeks) {
    return computePendingLowerStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      templatePendingDesks: setup.diff.nextPendingDesks,
      source: { cellId: CELL_ID, deskId: setup.deskId, lowerIndex: 0 },
      cellId: target.cellId ?? CELL_ID,
      deskIndex: target.deskIndex,
      studentIndex: target.studentIndex,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: CONTEXT.managedStudentByAnyName,
      resolveBoardStudentDisplayName: (name) => name,
    })
  }

  it('空いた席へ移すと生徒は移動先に 1 か所だけ生き、下段が空いて 1 行へ。振替の残数は変わらない', () => {
    const setup = pendingWithMakeupLower()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = move(setup, { deskIndex: 2, studentIndex: 0 })
    if (result.status !== 'moved') throw new Error(result.message)
    expect(liveIds(deskOf(result.nextWeeks, 2))).toEqual(['sM'])
    expect(deskOf(result.nextWeeks, 2).lesson?.studentSlots[0]?.id).toBe(entry('sM', { lessonType: 'makeup' }).id)
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sC'])
    expect(result.nextTemplatePendingDesks[setup.key]).toBeUndefined()
    expect(result.collapsed).toBe(true)
    expect(balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, emptyLedgers())['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
  })

  it('下段の通常授業（同日移動）を別の日へ移すと振替になり（既存の移動と同じ形）、振替の残数は変わらず、上段の抑止キーは積まない', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_daymove`, studentSlots: [entry('sD', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '10/7(水) 4限' }), null] } }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const diff = applyDiff(week, newRows)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const setup = { before: [week], diff, newRows, deskId, key: buildTemplatePendingDeskKey(CELL_ID, deskId) }
    expect(diff.nextPendingDesks[setup.key]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sD')
    const before = balances(diff.nextWeeks, newRows, diff.nextPendingDesks, emptyLedgers())
    const thursday = `2026-10-08_${SLOT}`
    const result = move(setup, { cellId: thursday, deskIndex: 0, studentIndex: 0 })
    if (result.status !== 'moved') throw new Error(result.message)
    const moved = deskOf(result.nextWeeks, 0, thursday).lesson?.studentSlots[0]
    expect(moved?.managedStudentId).toBe('sD')
    expect(moved?.lessonType).toBe('makeup')
    expect(moved?.makeupSourceDate).toBe(DATE)
    expect(result.nextTemplatePendingDesks[setup.key]).toBeUndefined()
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sC'])
    expect((deskOf(result.nextWeeks, 0).statusSlots ?? []).filter(Boolean)).toEqual([])
    expect(balances(result.nextWeeks, newRows, result.nextTemplatePendingDesks, emptyLedgers())['sD__数'] ?? 0).toBe(before['sD__数'] ?? 0)
  })

  it('移動先が 2 行の机（上段の空席を含む）なら不可、生徒のいる席・同じコマに同じ生徒が生きる席も不可', () => {
    const setup = pendingWithMakeupLower()
    const toPending = move(setup, { deskIndex: 0, studentIndex: 1 })
    expect(toPending).toEqual({ status: 'blocked', message: TEMPLATE_PENDING_MESSAGES.landingBlocked })
    const toOccupied = move(setup, { deskIndex: 1, studentIndex: 0 })
    expect(toOccupied).toEqual({ status: 'blocked', message: TEMPLATE_PENDING_MESSAGES.lowerMoveNeedsEmptySeat })
    const weeks = [mutateDesk(setup.diff.nextWeeks[0], 1, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], entry('sM', { id: 'm-live' })] } }))]
    const duplicate = move(setup, { deskIndex: 2, studentIndex: 0 }, weeks)
    expect(duplicate.status).toBe('blocked')
    if (duplicate.status === 'blocked') expect(duplicate.message).toContain('移動不可')
  })
})

describe('上段の操作の後に 1 行へ戻る（条件 15・Q28）', () => {
  it('上段の生徒を休みにして上段に生きている生徒が残らなければ 1 行に戻り、下段の生徒と上段の休み記録が机に残る', () => {
    const setup = pendingWithMakeupLower()
    // 上段 C を休みにした後の盤面（休み処理そのものは既存の markStudentAbsentAt）
    const afterAbsent = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sC', 'absent'), null] }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterAbsent,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(settled.collapsedKeys).toEqual([setup.key])
    expect(settled.nextTemplatePendingDesks).toEqual({})
    const desk0 = deskOf(settled.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sM'])
    expect(desk0.statusSlots?.[0]?.status).toBe('absent')
    expect(desk0.memoSlots?.filter(Boolean)).toEqual(['持ち物'])
  })

  it('両方の行が生きていれば何もしない（同じ参照）。この確定で片方が空いたのに戻せない机だけ知らせる', () => {
    const setup = pendingWithMakeupLower()
    const untouched = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: setup.diff.nextWeeks,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(untouched.nextWeeks).toBe(setup.diff.nextWeeks)
    expect(untouched.nextTemplatePendingDesks).toBe(setup.diff.nextPendingDesks)
    // 上段 C を削除 → 上段は空。机の両席を会計記録で埋めて下段のメモが入らない形にする
    const afterDelete = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sA', 'absent'), status('sB', 'absent')] }))]
    const stuck = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterDelete,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(stuck.newlyStuck).toEqual([{ key: setup.key, reason: 'memo-overflow' }])
    expect(stuck.nextTemplatePendingDesks).toBe(setup.diff.nextPendingDesks)
  })
})
