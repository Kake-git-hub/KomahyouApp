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
  countTemplatePendingDesksOnBoard,
  hasTemplatePendingLowerSeatContent,
  resolveTemplatePendingBandSeat,
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

// N-2（主セッション決定 2026-09-29・Q26-1 の拡張）: 下段の同日移動の通常授業を捨てたときも、同じ日の実配置に同じ生徒×科目が残らなければ −1。
describe('下段の同日移動の通常授業を捨てたときの希望回数（N-2）', () => {
  // 机0 の下段に D の同日移動（4 限から 5 限へ・4 限の D は抑止済み）。新テンプレの机0 は C → 保留。
  function sameDayMoveLower(extraRows: RegularLessonRow[] = [], lowerOverrides: Partial<StudentEntry> = {}) {
    let week = buildWeek(OLD_ROWS)
    week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: `${desk.id}_daymove`, studentSlots: [entry('sD', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '10/7(水) 4限', ...lowerOverrides }), null] } }))
    const newRows = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3'), ...extraRows]
    const diff = applyDiff(week, newRows, [buildManagedOccurrenceKey(entry('sD'), DATE, 4)])
    const deskId = deskOf(diff.nextWeeks, 0).id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
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
    expect(result.message).toContain('テンプレの 千葉 を取り下げました')
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

  it('H-1: 会計記録が下段へあふれた机（下段 [ , M]＋D の欠席）でも既存を採用が止まらず、記録は机に戻る', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [null, makeupM()] }, statusSlots: [status('sD', 'absent'), null] }), NEW_ROWS_BOTH)
    expect(setup.diff.nextPendingDesks[setup.key].lower.statusSlots?.filter(Boolean).map((item) => item!.status)).toEqual(['absent'])
    const result = resolve('adopt-existing', setup)
    if (result.status !== 'applied') throw new Error(result.message)
    const desk0 = deskOf(result.nextWeeks, 0)
    expect(liveIds(desk0)).toEqual(['sM'])
    expect(desk0.statusSlots?.filter(Boolean).map((item) => [item!.managedStudentId, item!.status])).toEqual([['sD', 'absent']])
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

  it('M-3: 上段の生徒 2（C）を休みにしても、その席に欠席記録が残るので下段の M は戻らない（2 行のまま・知らせない）', () => {
    const setup = pendingFrom((desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupM()] } }), NEW_ROWS_BOTH)
    const afterAbsent = [mutateDesk(setup.diff.nextWeeks[0], 0, (desk) => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], null] }, statusSlots: [null, status('sC', 'absent')] }))]
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: setup.diff.nextWeeks,
      previousTemplatePendingDesks: setup.diff.nextPendingDesks,
      weeks: afterAbsent,
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
