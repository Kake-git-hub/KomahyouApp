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
  planTemplatePendingAdoptExisting,
  remergeBoardWeeksWithManagedData,
  type TemplatePendingResolutionLedgers,
} from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import {
  clearTemplatePendingLowerSeatForAdopt,
  countTemplatePendingDesksOnBoard,
  hasTemplatePendingLowerContent,
  hasTemplatePendingLowerSeatContent,
  isTemplatePendingSeatLinked,
  resolveTemplatePendingBandSeat,
  resolveTemplatePendingDateBlockReason,
  resolveTemplatePendingLandingBlock,
  resolveTemplatePendingStudentMenuActions,
  settleTemplatePendingDesksAfterCommit,
  splitTemplatePendingLowerSeat,
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

type PendingSetup = { diff: { nextWeeks: SlotCell[][]; nextPendingDesks: TemplatePendingDeskMap }; deskId: string; key: string; newRows: RegularLessonRow[] }

function resolve(mode: Parameters<typeof computePendingDeskResolution>[0]['mode'], setup: PendingSetup, extra: { lowerIndex?: number; ledgers?: TemplatePendingResolutionLedgers; weeks?: SlotCell[][]; pending?: TemplatePendingDeskMap } = {}) {
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

// N-2（主セッション決定 2026-09-29・Q26-1 の拡張）: 下段の同日移動の通常授業を捨てたときも、同じ日の実配置に同じ生徒×科目が残らなければ −1。
describe('下段の同日移動の通常授業を捨てたときの希望回数（N-2）', () => {
  // 机0 の下段に D の同日移動（4 限から 5 限へ）。新テンプレの机0 は C。
  // Q36（2026-10-03）以降、同日移動の写しは保存で下段に入らない（テンプレに合わせる）ので、旧版（〜v1.5.577）が作った下段を手で組んで
  // 解決操作の会計（N-2）を固定する。テンプレは D の 4 限を持たない形（写しは残骸）＝同じ日に D の授業が残らない。
  function sameDayMoveLower(extraRows: RegularLessonRow[] = [], lowerOverrides: Partial<StudentEntry> = {}) {
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3'), ...extraRows]
    const week = buildWeek(newRows)
    const deskId = cellOf([week]).desks[0].id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    const lower = entry('sD', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '10/7(水) 4限', ...lowerOverrides })
    const pending: TemplatePendingDeskMap = { [key]: { lower: { lesson: { id: `${deskId}_daymove`, studentSlots: [lower, null] } }, effectiveStartDate: EFFECTIVE, createdAt: 'legacy' } }
    const diff = { nextWeeks: [week], nextPendingDesks: pending }
    expect(diff.nextPendingDesks[key]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sD')
    return { before: [week], diff, newRows, deskId, key }
  }
  const minusD = [{ studentKey: 'sD', subject: '数', countKind: 'regular', dateKey: DATE, delta: -1 }]

  it.each(['adopt-template', 'delete-lower-student'] as const)('%s: 同じ日に D が残らなければ希望回数 −1（単発削除と同じ）', (mode) => {
    const setup = sameDayMoveLower()
    const result = resolve(mode, setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.countAdjustedCount).toBe(1)
    expect(result.ledgers.scheduleCountAdjustments).toEqual(minusD)
    expect(result.message).toContain('1件の希望回数を1減らしました')
  })

  it.each(['adopt-template', 'delete-lower-student'] as const)('%s: 同じ日の別の時限に D が生きていれば補正しない', (mode) => {
    const setup = sameDayMoveLower([row('r9', 't3', 'sD', '数', '', '', 3, 3)])
    expect(cellOf(setup.diff.nextWeeks, `${DATE}_3`).desks.flatMap(liveIds)).toContain('sD')
    const result = resolve(mode, setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.countAdjustedCount).toBe(0)
    expect(result.ledgers.scheduleCountAdjustments).toEqual([])
  })

  it('旧テンプレ由来の通常授業（同日移動でない）・手動追加の同日移動は対象外（従来どおり希望回数を動かさない）', () => {
    // 印のある机（メモ）に旧テンプレの B（印なし通常）が残った下段の形を直接作る
    const setup = sameDayMoveLower()
    const plainRegular = { ...setup.diff.nextPendingDesks, [setup.key]: { ...setup.diff.nextPendingDesks[setup.key], lower: { lesson: { id: 'old', studentSlots: [entry('sD'), null] as [StudentEntry | null, StudentEntry | null] } } } }
    const plain = resolve('adopt-template', setup, { pending: plainRegular })
    if (plain.status !== 'applied') throw new Error(plain.message)
    expect(plain.ledgers.scheduleCountAdjustments).toEqual([])
    const manual = sameDayMoveLower([], { manualAdded: true })
    const manualResult = resolve('adopt-template', manual)
    if (manualResult.status !== 'applied') throw new Error(manualResult.message)
    expect(manualResult.ledgers.scheduleCountAdjustments).toEqual([])
    expect(manualResult.countAdjustedCount).toBe(0)
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
  function move(setup: { diff: { nextWeeks: SlotCell[][]; nextPendingDesks: TemplatePendingDeskMap }; deskId: string }, target: { cellId?: string; deskIndex: number; studentIndex: number }, weeks = setup.diff.nextWeeks) {
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
    // Q36（2026-10-03）以降、同日移動の写しは保存で下段に入らない（テンプレに合わせる）。旧版（v1.5.577 まで）が作った下段の写しを
    // 手で組んで、下段の移動の経路（既存データの片づけ）を固定する。
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const week = buildWeek(newRows)
    const deskId = cellOf([week]).desks[0].id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    const pending: TemplatePendingDeskMap = { [key]: { lower: { lesson: { id: `${deskId}_daymove`, studentSlots: [entry('sD', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '10/7(水) 4限' }), null] } }, effectiveStartDate: EFFECTIVE, createdAt: 'legacy' } }
    const diff = { nextWeeks: [week], nextPendingDesks: pending }
    const setup = { before: [week], diff, newRows, deskId, key }
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

  // regression-reviewer H-1（2026-10-02・INV-02 / INV-13 / INV-06）: 席単位化で、下段の無い席（上段 [C, 空]・下段 [M, 空] の席 2）への
  // 「手入力データを移動」が着地ガードを通るようになった。旧経路（下段を一時的に机の中身にして computeStudentMove → 元の机で上書き）では
  // 移した生徒が盤面から消え、振替の残数が増えていた（修正前は落ちる）。
  it('下段の生徒を同じ机の上段の空席へ移すと、上段のその席に入って 1 行に戻る（生徒は 1 か所・振替の残数は不変）', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' }), null] } }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const diff = applyDiff(week, newRows)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    expect(diff.nextPendingDesks[key]?.lower.lesson?.studentSlots.map((item) => item?.managedStudentId ?? null)).toEqual(['sM', null])
    const setup = { before: [week], diff, newRows, deskId, key }
    const before = balances(diff.nextWeeks, newRows, diff.nextPendingDesks, emptyLedgers())
    const result = move(setup, { deskIndex: 0, studentIndex: 1 })
    if (result.status !== 'moved') throw new Error(result.message)
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sC', 'sM'])
    expect(deskOf(result.nextWeeks, 0).lesson?.studentSlots[1]?.lessonType).toBe('makeup')
    expect(result.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(result.collapsed).toBe(true)
    expect(result.message).toContain('同じ机の生徒2の席へ戻しました')
    const liveCount = result.nextWeeks.flat().filter((cell) => cell.id === CELL_ID).flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.managedStudentId === 'sM').length
    expect(liveCount).toBe(1)
    expect(balances(result.nextWeeks, newRows, result.nextTemplatePendingDesks, emptyLedgers())['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
    // 同じ机でも生徒のいる席（保留に関わる席）へは不可
    expect(move(setup, { deskIndex: 0, studentIndex: 0 }).status).toBe('blocked')
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
    if (duplicate.status === 'blocked') expect(duplicate.message).toContain('移動できません')
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

  it('N-9(b): 確定で触られていないコマの保留は見ない（無関係な操作の Undo 1 段に別の机の 1 行戻しを同乗させない）', () => {
    const setup = pendingWithMakeupLower()
    // 確定の外（再マージ・同期など）で上段が空いた保留の机がある盤面
    const upperEmptied = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: undefined }))]
    // 無関係なコマ（木曜 5 限）だけを変える確定 → この保留は触らない（同じ参照）
    const thursday = `2026-10-08_${SLOT}`
    const unrelated = [mutateDesk(upperEmptied[0], 1, (desk) => ({ ...desk, memoSlots: ['連絡', null] }), thursday)]
    const untouched = settleTemplatePendingDesksAfterCommit({
      previousWeeks: upperEmptied,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: unrelated,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(untouched.collapsedKeys).toEqual([])
    expect(untouched.nextWeeks).toBe(unrelated)
    expect(untouched.nextTemplatePendingDesks).toBe(setup.diff.nextPendingDesks)
    // 同じコマの別の机を変える確定なら見る（Q26-4 の一意性検査が同じコマの別の机を見るため）→ 1 行へ戻る
    const sameCell = [mutateDesk(upperEmptied[0], 2, (desk) => ({ ...desk, memoSlots: ['連絡', null] }))]
    const touched = settleTemplatePendingDesksAfterCommit({
      previousWeeks: upperEmptied,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: sameCell,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(touched.collapsedKeys).toEqual([setup.key])
    expect(liveIds(deskOf(touched.nextWeeks, 0))).toEqual(['sM'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 席ごとの突き合わせ（オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄）: 生徒 2 の席だけ保留の机の解決
// ─────────────────────────────────────────────────────────────────────────────

describe('席ごと: 生徒 2 の席だけ保留の机（上段 [A, C]・下段 [ , M]）の解決', () => {
  // 机0: 旧テンプレの A（生徒 1）＋在庫由来の振替 M（生徒 2）。新テンプレは机0 に A・C（両方の席を埋める）→ 生徒 2 の席だけ保留。
  function seat2Pending() {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({
      ...desk,
      lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' })] },
    }))
    const newRows = [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const diff = applyDiff(week, newRows)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    expect(liveIds(deskOf(diff.nextWeeks, 0))).toEqual(['sA', 'sC'])
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sM'])
    return { before: [week], diff, newRows, deskId, key }
  }
  const remergeWith = (weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[]) => remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings: settings(), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY,
  })

  it('既存を採用: 生徒 2 の席のテンプレ C だけ取り下げ、生徒 1 の A はそのまま [A, M]。C だけ抑止・希望回数 −1、再マージ 2 回でも変わらない', () => {
    const setup = seat2Pending()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(result.nextTemplatePendingDesks).toEqual({})
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(entry('sC'), DATE, SLOT)])
    expect(result.ledgers.scheduleCountAdjustments).toEqual([{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: DATE, delta: -1 }])
    expect(result.message).toContain('テンプレ授業の 千葉 を取り下げました')
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
    const once = remergeWith(result.nextWeeks, setup.newRows, result.ledgers.suppressedRegularLessonOccurrences)
    const twice = remergeWith(once, setup.newRows, result.ledgers.suppressedRegularLessonOccurrences)
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(cellOf(twice)).toEqual(cellOf(result.nextWeeks))
  })

  it('テンプレを採用: 下段の M だけ未消化へ戻り [A, C] の 1 行（A・C は変わらない）', () => {
    const setup = seat2Pending()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const result = resolve('adopt-template', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sC'])
    expect(result.nextTemplatePendingDesks).toEqual({})
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数']).toBe((before['sM__数'] ?? 0) + 1)
  })

  it('上段の生徒 2（C）を削除して席が空けば、この確定で下段の M がその席に戻り 1 行 [A, M]（生徒 1 の A が残っていても戻る）', () => {
    const setup = seat2Pending()
    const afterDelete = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], null] } }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterDelete,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(settled.collapsedKeys).toEqual([setup.key])
    expect(settled.nextTemplatePendingDesks).toEqual({})
    expect(deskOf(settled.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(settled.newlyStuck).toEqual([])
  })

  it('上段の生徒 1（A）を削除しても、M の元の席（生徒 2）は C が埋めているので 2 行のまま・知らせない（もう一方の席へはずらさない）', () => {
    const setup = seat2Pending()
    const afterDelete = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [null, desk.lesson!.studentSlots[1]] } }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterDelete,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(settled.collapsedKeys).toEqual([])
    expect(settled.nextTemplatePendingDesks).toBe(setup.diff.nextPendingDesks)
    expect(settled.newlyStuck).toEqual([])
  })

  it('旧形式の保留（v1.5.572 で作られた、下段に机の生徒をまるごと持つ保留）も既存を採用できる（上段のテンプレの生徒を全部取り下げる）', () => {
    const setup = seat2Pending()
    // 旧形式: 下段 = 保存前の机そのまま（印の無い旧テンプレの A を含む）
    const legacyLower = { ...setup.diff.nextPendingDesks[setup.key], lower: { lesson: { ...setup.before[0].find((cell) => cell.id === CELL_ID)!.desks[0].lesson! } } }
    const result = resolve('adopt-existing', setup, { pending: { [setup.key]: legacyLower } })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sM'])
    expect(isManagedLessonId(deskOf(result.nextWeeks, 0).lesson?.id)).toBe(false)
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual(expect.arrayContaining([buildManagedOccurrenceKey(entry('sC'), DATE, SLOT)]))
  })
})

describe('席ごと: regression-reviewer 指摘（2026-09-30）の固定', () => {
  const NEW_ROWS_BOTH = [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
  const makeupM = () => entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' })
  function pendingFrom(update: (desk: DeskCell) => DeskCell, rows: RegularLessonRow[], suppressed: string[] = []) {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, update)
    const diff = applyDiff(week, rows, suppressed)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    expect(diff.nextPendingDesks[key]).toBeDefined()
    return { before: [week], diff, newRows: rows, deskId, key }
  }
  const remergeWith = (weeks: SlotCell[][], rows: RegularLessonRow[], suppressed: string[]) => remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings: settings(), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY,
  })

  it('H-1: メモのある机（下段 [ , M]＋メモ）で既存を採用が止まらない（席ごとに戻すとメモがあふれる → 上段のテンプレを全部取り下げてやり直す）', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [null, makeupM()] }, memoSlots: ['持ち物', null] }), NEW_ROWS_BOTH)
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sM'])
    expect(desk0.memoSlots).toEqual(['持ち物', null])
    expect(result.nextTemplatePendingDesks).toEqual({})
  })

  it('H-1: 会計記録が下段へあふれた机（下段 [ , M]＋D の出席）でも既存を採用が止まらず、記録は机に戻る', () => {
    // Q37（2026-10-03）: 休みの記録は席を確保せず机に残るので、下段へあふれる会計記録は出席だけになった。
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [null, makeupM()] }, statusSlots: [status('sD', 'attended'), null] }), NEW_ROWS_BOTH)
    expect(setup.diff.nextPendingDesks[setup.key].lower.statusSlots?.filter(Boolean).map((item) => item!.status)).toEqual(['attended'])
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sM'])
    expect(desk0.statusSlots?.filter(Boolean).map((item) => [item!.managedStudentId, item!.status])).toEqual([['sD', 'attended']])
  })

  it('Q37: D の欠席記録は席を確保せず机に残る（上段 [A, C]・下段 [ , M]）。既存を採用で M が戻っても記録は同じ席に残る', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [null, makeupM()] }, statusSlots: [status('sD', 'absent'), null] }), NEW_ROWS_BOTH)
    expect(setup.diff.nextPendingDesks[setup.key].lower.statusSlots).toBeUndefined()
    expect(deskOf(setup.diff.nextWeeks, 0).statusSlots?.map((item) => item?.status ?? null)).toEqual(['absent', null])
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(desk0.statusSlots?.map((item) => (item ? [item.managedStudentId, item.status] : null))).toEqual([['sD', 'absent'], null])
  })

  it('M-1: 上段 [C, 残した D]・下段 [別日移動の通常 M, ] でも既存を採用でき [M, D]。管理授業の id を外して再マージ 2 回でも不動点', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [entry('sM', { makeupSourceDate: '2026-09-30' }), entry('sD', { manualAdded: true })] } }), [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')])
    expect(liveIds(deskOf(setup.diff.nextWeeks, 0))).toEqual(['sC', 'sD'])
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    expect(isManagedLessonId(desk0.lesson?.id)).toBe(false)
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(entry('sC'), DATE, SLOT)])
    const once = remergeWith(result.nextWeeks, setup.newRows, result.ledgers.suppressedRegularLessonOccurrences)
    const twice = remergeWith(once, setup.newRows, result.ledgers.suppressedRegularLessonOccurrences)
    expect(cellOf(once)).toEqual(cellOf(result.nextWeeks))
    expect(cellOf(twice)).toEqual(cellOf(result.nextWeeks))
  })

  it('M-2: 確認文と本体が同じ関数で取り下げる生徒を決める（上段 [A, C]・下段 [ , M] では C だけ。A は出さない）', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupM()] } }), NEW_ROWS_BOTH)
    const cell = cellOf(setup.diff.nextWeeks)
    const plan = planTemplatePendingAdoptExisting({ cell, desk: cell.desks[0], entry: setup.diff.nextPendingDesks[setup.key] })
    expect(plan.withdrawnStudents.map((student) => student.managedStudentId)).toEqual(['sC'])
  })

  // Q37（オーナー指示 2026-10-03「休みと振無休みは空白と同じような扱い（ただし実績データは保持）」）: 旧 M-3 の逆。
  // 上段の生徒 2（C）を休み・振無休にすると、その席は記録だけになり空席と同じ＝下段の M がその席へ戻って 1 行、C の記録は同じ席に残る。
  it.each(['absent', 'absent-no-makeup'] as const)('Q37: 上段の生徒 2（C）を %s にすると、下段の M がその席に戻って 1 行 [A, M]・C の記録は生徒 2 の席に残る（在庫は不変）', (kind) => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupM()] } }), NEW_ROWS_BOTH)
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, emptyLedgers())
    const afterAbsent = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], null] }, statusSlots: [null, status('sC', kind)] }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterAbsent,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(settled.collapsedKeys).toEqual([setup.key])
    expect(settled.nextTemplatePendingDesks).toEqual({})
    const desk0 = deskOf(settled.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', 'sM'])
    expect(desk0.statusSlots?.map((item) => (item ? [item.managedStudentId, item.status] : null))).toEqual([null, ['sC', kind]])
    expect(balances(settled.nextWeeks, setup.newRows, settled.nextTemplatePendingDesks, emptyLedgers())['sM__数'] ?? 0).toBe(before['sM__数'] ?? 0)
  })

  it('M-3（出席）: 上段の生徒 2（C）に出席の記録が残る席へは下段の M は戻らない（2 行のまま・知らせない）', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupM()] } }), NEW_ROWS_BOTH)
    const afterAttended = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], null] }, statusSlots: [null, status('sC', 'attended')] }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterAttended,
      templatePendingDesks: setup.diff.nextPendingDesks,
    })
    expect(settled.collapsedKeys).toEqual([])
    expect(settled.newlyStuck).toEqual([])
  })

  it('席ごとに戻せない（下段が印のない通常授業で管理授業に同居できない）ときは、上段のテンプレを全部取り下げてやり直す', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupM()] } }), NEW_ROWS_BOTH)
    // 旧形式に近い下段: 生徒 1 の席に印のない通常授業 D（テンプレに無い生徒）だけ
    const legacy = { ...setup.diff.nextPendingDesks[setup.key], lower: { lesson: { id: 'legacy', studentSlots: [entry('sD'), null] as [StudentEntry | null, StudentEntry | null] } } }
    const cell = cellOf(setup.diff.nextWeeks)
    const plan = planTemplatePendingAdoptExisting({ cell, desk: cell.desks[0], entry: legacy })
    expect(plan.collapse.ok).toBe(true)
    expect(plan.withdrawnStudents.map((student) => student.managedStudentId)).toEqual(['sA', 'sC'])
  })
})

function isManagedLessonId(id: string | undefined) {
  return Boolean(id?.startsWith('managed_'))
}

// 席ごとの保留表示（オーナー指示 2026-10-02・確認リスト v1.5.573 tp-19 要改善「生徒 1 と生徒 2 の保留状態がリンクしている」）。
describe('hasTemplatePendingLowerSeatContent / resolveTemplatePendingBandSeat（席ごとの保留表示）', () => {
  const makeup: StudentEntry = { id: 'm1', name: '三浦', managedStudentId: 'sM', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30' }
  const record = { id: 'st1', studentId: 'x', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: '2026-10-07', slotNumber: 5, recordedAt: '', status: 'moved', sourceLessonId: 'l' } as unknown as StudentStatusEntry

  it('下段に生きている生徒・出欠記録・メモのある席だけ中身ありとする（空白だけのメモは中身なし）', () => {
    expect(hasTemplatePendingLowerSeatContent({ lesson: { id: 'l', studentSlots: [null, makeup] } }, 0)).toBe(false)
    expect(hasTemplatePendingLowerSeatContent({ lesson: { id: 'l', studentSlots: [null, makeup] } }, 1)).toBe(true)
    expect(hasTemplatePendingLowerSeatContent({ statusSlots: [record, null] }, 0)).toBe(true)
    expect(hasTemplatePendingLowerSeatContent({ memoSlots: ['持ち物', '  '] }, 0)).toBe(true)
    expect(hasTemplatePendingLowerSeatContent({ memoSlots: ['持ち物', '  '] }, 1)).toBe(false)
    expect(hasTemplatePendingLowerSeatContent({}, 0)).toBe(false)
  })

  it('帯「保留 n」は下段に中身のある最初の席に付ける（生徒 2 の席だけなら 1・両方または無しなら 0）', () => {
    expect(resolveTemplatePendingBandSeat({ lesson: { id: 'l', studentSlots: [null, makeup] } })).toBe(1)
    expect(resolveTemplatePendingBandSeat({ lesson: { id: 'l', studentSlots: [makeup, null] }, memoSlots: [null, '持ち物'] })).toBe(0)
    expect(resolveTemplatePendingBandSeat({ memoSlots: [null, '持ち物'] })).toBe(1)
    expect(resolveTemplatePendingBandSeat({})).toBe(0)
  })
})

// オーナー決定 2026-10-02「席単位にする」（spec-template-behavior Q34-12）。
describe('isTemplatePendingSeatLinked / resolveTemplatePendingLandingBlock の席ごと判定', () => {
  const makeupA: StudentEntry = { id: 'a-m', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30' }
  const regularA: StudentEntry = { id: 'a-r', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '英', lessonType: 'regular', teacherType: 'normal' }
  const regularB: StudentEntry = { id: 'b-r', name: '馬場', managedStudentId: 'sB', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }
  const lowerSeat1 = { lesson: { id: 'l', studentSlots: [null, makeupA] as [StudentEntry | null, StudentEntry | null] } }

  it('下段のある席は関わる。下段の無い席は、上段の生徒が下段の生徒と同じ生徒のときだけ関わる', () => {
    const deskBA: DeskCell = { id: 'd', teacher: '田中', lesson: { id: 'managed', studentSlots: [regularB, regularA] } }
    expect(isTemplatePendingSeatLinked(deskBA, lowerSeat1, 1)).toBe(true)
    expect(isTemplatePendingSeatLinked(deskBA, lowerSeat1, 0)).toBe(false)
    // 上段の生徒 1 が下段の A と同じ生徒（科目違い）→ 「手入力データを採用」で取り下げられる席なので関わる
    const deskAB: DeskCell = { id: 'd', teacher: '田中', lesson: { id: 'managed', studentSlots: [regularA, regularB] } }
    expect(isTemplatePendingSeatLinked(deskAB, lowerSeat1, 0)).toBe(true)
    // 上段が空の席で下段も無い → 関わらない（空欄メニュー・配置ができる）
    const deskEmpty: DeskCell = { id: 'd', teacher: '田中' }
    expect(isTemplatePendingSeatLinked(deskEmpty, lowerSeat1, 0)).toBe(false)
  })

  it('着地ガードは seatIndex を渡すと席ごと: 関わらない席への着地は止めず、関わる席は止める。渡さなければ机単位のまま', () => {
    const cell = { id: 'C1', desks: [{ id: 'd1', teacher: '田中', lesson: { id: 'managed', studentSlots: [regularB, null] as [StudentEntry | null, StudentEntry | null] } }] }
    const map: TemplatePendingDeskMap = { [buildTemplatePendingDeskKey('C1', 'd1')]: { lower: lowerSeat1, effectiveStartDate: '2026-10-07', createdAt: '' } }
    expect(resolveTemplatePendingLandingBlock(map, cell, 0, null, 0)).toBeNull()
    expect(resolveTemplatePendingLandingBlock(map, cell, 0, null, 1)).toBe(TEMPLATE_PENDING_MESSAGES.landingBlocked)
    expect(resolveTemplatePendingLandingBlock(map, cell, 0)).toBe(TEMPLATE_PENDING_MESSAGES.landingBlocked)
    expect(resolveTemplatePendingLandingBlock(map, cell, 0, buildTemplatePendingDeskKey('C1', 'd1'), 1)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q26-10（オーナー指示 2026-10-03・確認リスト v1.5.577 その他欄）: 採用の 2 つも席ごと。
// 「生徒 1 の手入力データ削除を操作しているのに、生徒 2 の生徒名が説明欄にでてくる」「生徒 1 の手入力データを採用したのに
//   生徒 2 の既存データが生徒 2 のテンプレを上書きしている」「生徒 1 と生徒 2 がデータリンクしちゃっている気がします。完全に独立させて」
// ─────────────────────────────────────────────────────────────────────────────

describe('席ごとの採用（Q26-10・2026-10-03）: 押した席の下段だけを対象にし、もう一方の席の下段は保留のまま', () => {
  // 机 0: 手で置いた振替 M（生徒 1）と振替 D（生徒 2）。新テンプレは机 0 に A・C（2 席とも埋める）→ 両方の席が保留（上段 [A, C]・下段 [M, D]）。
  const makeupM = () => entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' })
  const makeupD = () => entry('sD', { lessonType: 'makeup', makeupSourceDate: '2026-09-23', makeupSourceLabel: '9/23(水) 5限' })
  const NEW_ROWS_BOTH = [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
  function bothSeatsPending(memoAtSeat0 = false) {
    const week = mutateDesk(buildWeek(OLD_ROWS), 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [makeupM(), makeupD()] }, ...(memoAtSeat0 ? { memoSlots: ['持ち物', null] as [string | null, string | null] } : {}) }))
    const diff = applyDiff(week, NEW_ROWS_BOTH)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    expect(liveIds(deskOf(diff.nextWeeks, 0))).toEqual(['sA', 'sC'])
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    return { before: [week], diff, newRows: NEW_ROWS_BOTH, deskId, key }
  }
  const ledgersWithStock = () => emptyLedgers()

  it('手入力データを採用（生徒 1）: 生徒 1 のテンプレ A だけ取り下げて M を戻す [M, C]。生徒 2 の下段 D は保留のまま（C は動かない）。確認文の対象も A だけ', () => {
    const setup = bothSeatsPending()
    const cell = cellOf(setup.diff.nextWeeks)
    const plan = planTemplatePendingAdoptExisting({ cell, desk: cell.desks[0], entry: setup.diff.nextPendingDesks[setup.key], seatIndex: 0 })
    expect(plan.withdrawnStudents.map((student) => student.managedStudentId)).toEqual(['sA'])
    expect(plan.restLower?.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, ledgersWithStock())
    const result = resolve('adopt-existing', setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sC'])
    expect(result.nextTemplatePendingDesks[setup.key]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
    expect(result.collapsed).toBe(false)
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(entry('sA'), DATE, SLOT)])
    expect(result.message).toContain('テンプレ授業の 青木 を取り下げました')
    expect(result.message).not.toContain('千葉')
    expect(result.message).toContain('もう一方の席の手入力データは保留のままです')
    // 在庫: M は机へ戻って消化のまま、D は下段のまま消化のまま（どちらも残数は変わらない）
    expect(balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)).toEqual(before)
    // 続けて生徒 2 も手入力データを採用 → C を取り下げて D を戻し、保留が消える [M, D]
    const second = computePendingDeskResolution({ mode: 'adopt-existing', weeks: result.nextWeeks, cellId: CELL_ID, deskId: setup.deskId, lowerIndex: 1, templatePendingDesks: result.nextTemplatePendingDesks, ledgers: result.ledgers, ...CONTEXT })
    if (second.status !== 'applied') throw new Error(second.message)
    expect(deskOf(second.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    expect(second.nextTemplatePendingDesks).toEqual({})
    expect(second.collapsed).toBe(true)
  })

  it('テンプレ授業を採用（生徒 1）: 生徒 1 の下段 M だけ未消化へ戻し、上段 [A, C] はそのまま。生徒 2 の下段 D は保留のまま', () => {
    const setup = bothSeatsPending()
    const before = balances(setup.diff.nextWeeks, setup.newRows, setup.diff.nextPendingDesks, ledgersWithStock())
    const result = resolve('adopt-template', setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(liveIds(deskOf(result.nextWeeks, 0))).toEqual(['sA', 'sC'])
    expect(result.nextTemplatePendingDesks[setup.key]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
    expect(result.collapsed).toBe(false)
    expect(result.returnedCount).toBe(1)
    expect(result.message).toContain('手入力データ（下段）の 三浦 を外しました')
    expect(result.message).not.toContain('土屋')
    const after = balances(result.nextWeeks, setup.newRows, result.nextTemplatePendingDesks, result.ledgers)
    expect(after['sM__数']).toBe((before['sM__数'] ?? 0) + 1)
    expect(after['sD__数'] ?? 0).toBe(before['sD__数'] ?? 0)
    // 続けて生徒 2 もテンプレ授業を採用 → 保留が消えて 1 行 [A, C]
    const second = computePendingDeskResolution({ mode: 'adopt-template', weeks: result.nextWeeks, cellId: CELL_ID, deskId: setup.deskId, lowerIndex: 1, templatePendingDesks: result.nextTemplatePendingDesks, ledgers: result.ledgers, ...CONTEXT })
    if (second.status !== 'applied') throw new Error(second.message)
    expect(second.nextTemplatePendingDesks).toEqual({})
    expect(second.collapsed).toBe(true)
    expect(liveIds(deskOf(second.nextWeeks, 0))).toEqual(['sA', 'sC'])
  })

  it('テンプレ授業を採用（生徒 1）は、その席の下段のメモも捨てる（会計を持つ記録は捨てない）', () => {
    const setup = bothSeatsPending(true)
    expect(setup.diff.nextPendingDesks[setup.key].lower.memoSlots).toEqual(['持ち物', null])
    const result = resolve('adopt-template', setup, { lowerIndex: 0 })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.nextTemplatePendingDesks[setup.key]?.lower.memoSlots).toBeUndefined()
    expect(result.nextTemplatePendingDesks[setup.key]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
  })

  it('lowerIndex を渡さない（机ごと・旧来）なら両方の席の下段が対象（一括操作の予備・既存テストの互換）', () => {
    const setup = bothSeatsPending()
    const adoptAll = resolve('adopt-template', setup)
    if (adoptAll.status !== 'applied') throw new Error(adoptAll.message)
    expect(adoptAll.nextTemplatePendingDesks).toEqual({})
    expect(adoptAll.returnedCount).toBe(2)
    const existingAll = resolve('adopt-existing', setup)
    if (existingAll.status !== 'applied') throw new Error(existingAll.message)
    expect(deskOf(existingAll.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    expect(existingAll.nextTemplatePendingDesks).toEqual({})
  })

  it('splitTemplatePendingLowerSeat / clearTemplatePendingLowerSeatForAdopt: 席の分と残りに分ける・採用で捨てるのは生徒とメモと表示専用の記録だけ', () => {
    const lower = { lesson: { id: 'l', studentSlots: [makeupM(), makeupD()] as [StudentEntry | null, StudentEntry | null] }, statusSlots: [status('sA', 'attended'), status('sB', 'moved')] as [StudentStatusEntry | null, StudentStatusEntry | null], memoSlots: ['持ち物', '連絡'] as [string | null, string | null] }
    const split = splitTemplatePendingLowerSeat(lower, 0)
    expect(split.seatLower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', null])
    expect(split.seatLower.statusSlots?.map((item) => item?.status ?? null)).toEqual(['attended', null])
    expect(split.seatLower.memoSlots).toEqual(['持ち物', null])
    expect(split.restLower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
    expect(split.restLower.statusSlots?.map((item) => item?.status ?? null)).toEqual([null, 'moved'])
    expect(split.restLower.memoSlots).toEqual([null, '連絡'])
    expect(hasTemplatePendingLowerContent(split.restLower)).toBe(true)
    expect(hasTemplatePendingLowerContent({})).toBe(false)
    const entryX = { lower, effectiveStartDate: EFFECTIVE, createdAt: 'x' }
    const cleared0 = clearTemplatePendingLowerSeatForAdopt(entryX, 0)
    expect(cleared0.removed.map((student) => student.managedStudentId)).toEqual(['sM'])
    expect(cleared0.nextEntry.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sD'])
    expect(cleared0.nextEntry.lower.memoSlots).toEqual([null, '連絡'])
    // 出席（会計を持つ記録）は捨てない
    expect(cleared0.nextEntry.lower.statusSlots?.map((item) => item?.status ?? null)).toEqual(['attended', 'moved'])
    const cleared1 = clearTemplatePendingLowerSeatForAdopt(entryX, 1)
    // 表示専用の記録（moved）は捨てる
    expect(cleared1.nextEntry.lower.statusSlots?.map((item) => item?.status ?? null)).toEqual(['attended', null])
    expect(lower.lesson.studentSlots[0]?.managedStudentId).toBe('sM')
  })
})

// regression-reviewer M-2（2026-10-03）: 席ごとの「手入力データを採用」で、席ごとに戻せない（下段が別日移動の通常授業で管理授業に同居できない）とき、
// 旧来の「上段のテンプレ生徒を全部取り下げる」フォールバックを使うと、押していない席のテンプレ生徒まで取り下がり、その席の下段が机へ戻る。
// もう一方の席に下段が残るなら止める（押した席の分だけで戻せないときは「既存を採用できません」）。
describe('席ごとの採用（Q26-10）: もう一方の席に下段が残るときは全席のフォールバックを使わない（M-2）', () => {
  it('上段 [A, C]・下段 [別日移動の通常 M, 振替 D] で生徒 1 の手入力データを採用 → 止まる（C は取り下がらず D も戻らない・盤面と保留は不変）', () => {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [entry('sM', { makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' }), entry('sD', { lessonType: 'makeup', makeupSourceDate: '2026-09-23', makeupSourceLabel: '9/23(水) 5限' })] } }))
    const newRows = [row('r0', 't2', 'sA', '数', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
    const diff = applyDiff(week, newRows)
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    expect(liveIds(deskOf(diff.nextWeeks, 0))).toEqual(['sA', 'sC'])
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
    const cell = cellOf(diff.nextWeeks)
    const plan = planTemplatePendingAdoptExisting({ cell, desk: cell.desks[0], entry: diff.nextPendingDesks[key], seatIndex: 0 })
    expect(plan.collapse.ok).toBe(false)
    expect(plan.withdrawnStudents.map((student) => student.managedStudentId)).toEqual(['sA'])
    const result = resolve('adopt-existing', { diff, deskId, key, newRows }, { lowerIndex: 0 })
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('既存を採用できません')
    // 机ごと（lowerIndex 無し）なら旧来どおり全部取り下げて [M, D]
    const whole = resolve('adopt-existing', { diff, deskId, key, newRows })
    if (whole.status !== 'applied') throw new Error(whole.message)
    expect(deskOf(whole.nextWeeks, 0).lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sM', 'sD'])
  })
})
