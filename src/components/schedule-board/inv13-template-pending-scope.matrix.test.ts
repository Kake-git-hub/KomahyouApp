// @vitest-environment jsdom
/**
 * INV-13 操作マトリクステスト（台帳: docs/spec-invariants.md INV-13・Issue #72・第 1 段 (C)）
 *
 * 保証 INV-13【準観察】: テンプレ保存で生じた保留（2 行）の**下段は、保留中は盤面画面にだけ現れ**、生徒日程表・講師日程表・
 *   盤面 PDF・保護者向け表示・盤面共有・回数表（実績/予定）・給与/交通費の集計には一切入らない（これらは上段＝実配置だけを見る）。
 *   保留が解決して下段が机に戻った時点で、その中身は実配置となり、これらすべてに通常どおり反映される。
 *
 * マトリクス:
 *   行（消費者） = 生徒日程表 / 講師日程表 / 盤面 PDF / 保護者向け表示（本体と functions 複製の parity）/ 盤面共有 /
 *                  回数表（実績・予定）/ 給与・交通費（出席の集計）
 *   列（下段の中身） = 通常（手動追加）/ 振替 / 講習 / 表示専用の記録（移動元 moved）/ メモ /
 *                  席不足で下段へ入った会計記録（出席＝spec-template-behavior Q21-10。欠席・振無休は Q37〔2026-10-03〕で机に残るので列から外した）
 *   確認点 = 保留中（下段が一切出ない・上段と机に残した会計記録は出る）/ 解決後（既存を採用・上段が空いて 1 行へ戻る）
 *
 * 各セル = 実際の保存経路（computeTemplateDiffApplyForBoard）で作った保留の盤面を、各消費者の実関数に通す。
 * 解決も実際の解決経路（computePendingDeskResolution / settleTemplatePendingDesksAfterCommit）を通す。
 * 受け入れ条件（spec §実装タスク 第 1 段）: 9-2・10・14・23。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings, ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  buildManagedScheduleCellsForRange,
  computePendingDeskResolution,
  computeTemplateDiffApplyForBoard,
  type TemplatePendingResolutionLedgers,
} from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import { buildStudentPayload, buildTeacherPayload } from '../../utils/scheduleHtml'
import { buildStudentSheetViewModel, buildTeacherSheetViewModel } from '../../utils/scheduleViewData'
import { buildParentScheduleView } from '../../utils/parentSchedule'
import { buildParentScheduleView as buildGeneratedParentScheduleView } from '../../../functions/src/generated/parentSchedule'
import { compactBoardSharePayload } from '../../integrations/firebase/boardShare'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))
vi.mock('../../integrations/firebase/client', () => ({ getFirebaseFirestoreInstance: () => null }))

const { BoardGrid } = await import('./BoardGrid')
const { stripTemplatePendingLowerForPdf } = await import('../../utils/pdf')

// ─────────────────────────────────────────────────────────────────────────────
// フィクスチャ（水曜 5 限・机 3 つ・反映日 2026-10-07。templatePendingResolution.test.ts と同じ形）
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-10-01'

function studentRow(id: string, name: string): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

// 青木(A)・馬場(B)＝旧テンプレ / 千葉(C)＝新テンプレ（上段）/ 土屋(D)＝記録 / 三浦(M)＝下段の生徒
const students = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉'), studentRow('sD', '土屋'), studentRow('sM', '三浦')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤')]

function row(id: string, teacherId: string, student1Id = '', subject1 = '', student2Id = '', subject2 = ''): RegularLessonRow {
  return {
    id, schoolYear: 2026, teacherId, student1Id, subject1, startDate: '', endDate: '', student2Id, subject2,
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
  }
}

function settings(extra: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, templateFreezeBeforeDate: EFFECTIVE, ...extra } as ClassroomSettings
}

const OLD_ROWS = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]
// 机0 は講師交代（田中→鈴木）＋生徒 A→C。机1 は田中＋B。机2 は佐藤だけ。
const NEW_ROWS = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]
// 席不足（Q21-10）の列: 机1 のテンプレが 2 人（B・A）。
const NEW_ROWS_TWO_IN_DESK1 = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数', 'sA', '数'), row('r2', 't3')]

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

function mutateDesk(week: SlotCell[], index: number, update: (desk: DeskCell) => DeskCell) {
  return week.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === index ? update(desk) : desk)) }))
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
    teacherName: '鈴木',
    dateKey: DATE,
    slotNumber: SLOT,
    recordedAt: '2026-10-01T00:00:00.000Z',
    status: statusKind,
    sourceLessonId: 'lesson-x',
    ...overrides,
  }
}

const MAKEUP_M = entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' })

type LowerColumn = {
  label: string
  /** 保存前の盤面の机の中身（机 index → 中身）。 */
  desks: Record<number, (desk: DeskCell) => DeskCell>
  newRows: RegularLessonRow[]
  /** 保留になる机。 */
  pendingDeskIndex: number
  /** 下段にしか居ない（保留中はどこにも出ない）生徒・文字列。 */
  hiddenStudentIds: string[]
  hiddenTexts: string[]
  /** 保留の机の上段（テンプレ）の生徒。 */
  upperStudentId: string
  /** 下段の生徒の授業種別（保護者向け表示は通常・振替・増コマだけを出す）。 */
  lowerLessonType?: StudentEntry['lessonType']
}

const COLUMNS: LowerColumn[] = [
  {
    label: '通常（手動追加）',
    desks: { 0: (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [entry('sM', { manualAdded: true }), null] } }) },
    newRows: NEW_ROWS, pendingDeskIndex: 0, hiddenStudentIds: ['sM'], hiddenTexts: ['三浦'], upperStudentId: 'sC', lowerLessonType: 'regular',
  },
  {
    label: '振替',
    desks: { 0: (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [MAKEUP_M, null] } }) },
    newRows: NEW_ROWS, pendingDeskIndex: 0, hiddenStudentIds: ['sM'], hiddenTexts: ['三浦'], upperStudentId: 'sC', lowerLessonType: 'makeup',
  },
  {
    label: '講習',
    desks: { 0: (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [entry('sM', { lessonType: 'special' }), null] } }) },
    newRows: NEW_ROWS, pendingDeskIndex: 0, hiddenStudentIds: ['sM'], hiddenTexts: ['三浦'], upperStudentId: 'sC', lowerLessonType: 'special',
  },
  {
    label: '表示専用の記録（移動元 moved）',
    desks: { 0: (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [MAKEUP_M, null] }, statusSlots: [null, status('sD', 'moved', { moveDestinationDateKey: '2026-10-09' })] }) },
    newRows: NEW_ROWS, pendingDeskIndex: 0, hiddenStudentIds: ['sM', 'sD'], hiddenTexts: ['三浦', '土屋'], upperStudentId: 'sC', lowerLessonType: 'makeup',
  },
  {
    label: 'メモ',
    desks: { 0: (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [MAKEUP_M, null] }, memoSlots: [null, '下段の持ち物メモ'] }) },
    newRows: NEW_ROWS, pendingDeskIndex: 0, hiddenStudentIds: ['sM'], hiddenTexts: ['三浦', '下段の持ち物メモ'], upperStudentId: 'sC', lowerLessonType: 'makeup',
  },
  // 「席不足で下段へ入った会計記録（欠席）」の列は Q37（オーナー指示 2026-10-03「休みと振無休みは空白と同じような扱い」）で消えた:
  // 休み・振無休の記録は席を確保せず、席が足りなくても机（上段の生徒の下）に残る＝保留中も日程表・在庫に出る（下の describe で固定）。
  {
    label: '席不足で下段へ入った会計記録（出席）',
    desks: { 1: (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sD', 'attended', { teacherName: '田中' }), null] }) },
    newRows: NEW_ROWS_TWO_IN_DESK1, pendingDeskIndex: 1, hiddenStudentIds: ['sD'], hiddenTexts: ['土屋'], upperStudentId: 'sB',
  },
]

function buildPendingBoard(column: LowerColumn) {
  let week = buildWeek(OLD_ROWS)
  for (const [index, update] of Object.entries(column.desks)) week = mutateDesk(week, Number(index), update)
  const diff = computeTemplateDiffApplyForBoard({
    weeks: [week],
    classroomSettings: settings(),
    teachers,
    students,
    regularLessons: column.newRows,
    effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: [],
    templatePendingDesks: {},
    createdAt: '2026-09-29T10:00:00.000Z',
  })
  const cell = diff.nextWeeks[0].find((item) => item.id === CELL_ID)!
  const deskId = cell.desks[column.pendingDeskIndex].id
  const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
  // 前提: 実際の保存経路で保留（2 行）になり、下段は週データの外（保留マップ）にある。
  expect(diff.nextPendingDesks[key], column.label).toBeDefined()
  return { weeks: diff.nextWeeks, pending: diff.nextPendingDesks, deskId, key, teacherName: cell.desks[column.pendingDeskIndex].teacher }
}

// ─────────────────────────────────────────────────────────────────────────────
// 消費者（行）: 盤面の状態 → 各消費者の実関数の出力
// ─────────────────────────────────────────────────────────────────────────────

type BoardState = { weeks: SlotCell[][]; pending: TemplatePendingDeskMap; scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[] }

const scheduleBase = (state: BoardState) => ({
  cells: state.weeks.flat(),
  defaultStartDate: WEEK_START,
  defaultEndDate: WEEK_END,
  titleLabel: 'INV-13',
  classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] },
})

function studentSheet(state: BoardState, studentId: string) {
  const payload = buildStudentPayload({ ...scheduleBase(state), students, teachers, regularLessons: NEW_ROWS, scheduleCountAdjustments: state.scheduleCountAdjustments })
  const vm = buildStudentSheetViewModel(payload, { startDate: WEEK_START, endDate: WEEK_END, studentId, todayKey: TODAY_KEY })!
  expect(vm.student.id).toBe(studentId)
  const cell = vm.rows.find((item) => item.slotNumber === SLOT)!.cells.find((item) => item.dateKey === DATE)!
  const count = (rows: Array<{ count: number }>) => rows.reduce((total, item) => total + item.count, 0)
  return {
    cards: cell.cards,
    actual: count(vm.regularCountRows) + count(vm.lectureCountRows),
    desiredRegular: vm.regularCountRows.reduce((total, item) => total + item.desired, 0),
    absenceNotes: vm.absenceNotes,
    makeupNotes: vm.makeupNotes,
  }
}

function teacherSheet(state: BoardState, teacherId: string) {
  const payload = buildTeacherPayload({ ...scheduleBase(state), teachers, students, regularLessons: NEW_ROWS })
  const vm = buildTeacherSheetViewModel(payload, { startDate: WEEK_START, endDate: WEEK_END, teacherId, todayKey: TODAY_KEY })!
  expect(vm.teacher.id).toBe(teacherId)
  const cell = vm.rows.find((item) => item.slotNumber === SLOT)!.cells.find((item) => item.dateKey === DATE)!
  return {
    people: cell.people.map((person) => person.name),
    salaryCount: vm.salary.rows.reduce((total, item) => total + item.count, 0),
    attendanceDays: vm.salary.attendanceDays,
  }
}

function boardPdfText(state: BoardState) {
  const html = renderToStaticMarkup(createElement(BoardGrid, {
    cells: state.weeks[0],
    selectedStudentId: null,
    highlightedCell: null,
    highlightedHolidayDate: null,
    yearLabel: '2026',
    specialPeriods: [],
    resolveStudentDisplayName: (name: string) => name,
    resolveStudentGradeLabel: (_name: string, grade: string) => grade,
    resolveDisplayedLessonType: (_name: string, _subject: string, lessonType) => lessonType,
    onDayHeaderClick: () => {},
    onTeacherClick: () => {},
    onStudentClick: () => {},
    // 盤面画面は下段を描く（フラグ ON）。PDF は複製から下段を外す。
    templatePendingDesks: state.pending,
    onTemplatePendingLowerClick: () => {},
  }))
  const container = document.createElement('div')
  container.innerHTML = html
  const boardText = container.textContent ?? ''
  stripTemplatePendingLowerForPdf(container)
  return { boardText, pdfText: container.textContent ?? '' }
}

function parentLessonsOn(state: BoardState, studentId: string) {
  const payload = {
    students,
    teachers,
    regularLessons: NEW_ROWS,
    classroomSettings: settings(),
    boardState: { weeks: state.weeks, templatePendingDesks: state.pending, suppressedRegularLessonOccurrences: [] },
  }
  const range = { from: WEEK_START, to: WEEK_END }
  const view = buildParentScheduleView(payload, studentId, range)
  // functions の複製（保護者 QR の本番経路）と同じ入力で同じ結果（parity）。
  expect(buildGeneratedParentScheduleView(payload, studentId, range)).toEqual(view)
  return view?.days.find((day) => day.dateKey === DATE)?.lessons ?? []
}

function boardShareCellJson(state: BoardState) {
  const compacted = compactBoardSharePayload({ schemaVersion: 1, token: 't', classroomId: 'c', classroomName: 'n', sharedAt: '', cells: state.weeks.flat() })
  return JSON.stringify(compacted.cells.find((cell) => cell.id === CELL_ID))
}

function studentName(studentId: string) {
  return students.find((student) => student.id === studentId)!.name
}

// ─────────────────────────────────────────────────────────────────────────────
// 解決（下段が机へ戻る）
// ─────────────────────────────────────────────────────────────────────────────

function emptyLedgers(): TemplatePendingResolutionLedgers {
  return {
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
  }
}

const CONTEXT = {
  managedStudentByAnyName: new Map<string, StudentRow>(students.map((student) => [student.name, student])),
  resolveDisplayName: (name: string) => name,
  resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name,
  ledgerOriginDatesByKey: { 'sM__数': ['2026-09-30'] } as Record<string, string[]>,
}

// 下段に生きている生徒がいる列:「既存を採用」。会計記録だけの列: 上段の 1 人を外して（上段の削除と同じ形）確定 → Q28 で 1 行へ戻る。
function resolvePending(column: LowerColumn, board: ReturnType<typeof buildPendingBoard>): BoardState {
  if (column.pendingDeskIndex === 0) {
    const result = computePendingDeskResolution({
      mode: 'adopt-existing',
      weeks: board.weeks,
      cellId: CELL_ID,
      deskId: board.deskId,
      templatePendingDesks: board.pending,
      ledgers: emptyLedgers(),
      ...CONTEXT,
    })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.nextTemplatePendingDesks[board.key]).toBeUndefined()
    return { weeks: result.nextWeeks, pending: result.nextTemplatePendingDesks, scheduleCountAdjustments: result.ledgers.scheduleCountAdjustments }
  }
  const removedUpper = board.weeks.map((week) => week.map((cell) => (cell.id !== CELL_ID ? cell : {
    ...cell,
    desks: cell.desks.map((desk) => (desk.id !== board.deskId || !desk.lesson ? desk : {
      ...desk,
      lesson: { ...desk.lesson, studentSlots: [desk.lesson.studentSlots[0], null] as [StudentEntry | null, StudentEntry | null] },
    })),
  })))
  const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: board.weeks, previousTemplatePendingDesks: board.pending, weeks: removedUpper, templatePendingDesks: board.pending })
  expect(settled.collapsedKeys).toEqual([board.key])
  return { weeks: settled.nextWeeks, pending: settled.nextTemplatePendingDesks }
}

// ─────────────────────────────────────────────────────────────────────────────
// マトリクス本体
// ─────────────────────────────────────────────────────────────────────────────

describe.each(COLUMNS)('INV-13 マトリクス: 下段＝$label', (column) => {
  const board = buildPendingBoard(column)
  const pendingState: BoardState = { weeks: board.weeks, pending: board.pending }
  const isAccountingRecordColumn = column.pendingDeskIndex === 1

  describe('保留中: 下段は盤面画面にだけ出て、他の消費者には一切出ない（上段は出る）', () => {
    it('盤面画面には下段が出る（前提）/ 盤面 PDF には下段が出ない・上段は出る', () => {
      const { boardText, pdfText } = boardPdfText(pendingState)
      for (const text of column.hiddenTexts) {
        expect(boardText, text).toContain(text)
        expect(pdfText, text).not.toContain(text)
      }
      expect(pdfText).toContain(studentName(column.upperStudentId))
    })

    it('生徒日程表: 下段の生徒のその日のコマは空・上段の生徒は出る', () => {
      for (const studentId of column.hiddenStudentIds) {
        expect(studentSheet(pendingState, studentId).cards, studentId).toEqual([])
      }
      expect(studentSheet(pendingState, column.upperStudentId).cards.length).toBeGreaterThan(0)
    })

    it('講師日程表: 机の講師のその日のコマに下段の生徒は出ず、上段の生徒は出る', () => {
      const teacherId = teachers.find((teacher) => teacher.name === board.teacherName)!.id
      const people = teacherSheet(pendingState, teacherId).people
      for (const studentId of column.hiddenStudentIds) expect(people, studentId).not.toContain(studentName(studentId))
      expect(people).toContain(studentName(column.upperStudentId))
    })

    it('回数表（実績・予定）: 下段の生徒の実績は 0・予定も増えない', () => {
      for (const studentId of column.hiddenStudentIds) {
        const sheet = studentSheet(pendingState, studentId)
        expect(sheet.actual, studentId).toBe(0)
        expect(sheet.desiredRegular, studentId).toBe(0)
        expect(sheet.absenceNotes, studentId).toEqual([])
      }
      expect(studentSheet(pendingState, column.upperStudentId).actual).toBeGreaterThan(0)
    })

    it('給与・交通費: 下段の出席記録は机の講師の集計に入らない', () => {
      const teacherId = teachers.find((teacher) => teacher.name === board.teacherName)!.id
      const salary = teacherSheet(pendingState, teacherId)
      expect(salary.salaryCount).toBe(0)
      expect(salary.attendanceDays).toBe(0)
    })

    it('保護者向け表示（本体と functions 複製が一致）: 下段の生徒のその日は出ず、上段の生徒は出る', () => {
      for (const studentId of column.hiddenStudentIds) expect(parentLessonsOn(pendingState, studentId), studentId).toEqual([])
      expect(parentLessonsOn(pendingState, column.upperStudentId).length).toBeGreaterThan(0)
    })

    it('盤面共有: 共有するコマに下段の生徒・記録・メモが載らず、上段の生徒は載る', () => {
      const json = boardShareCellJson(pendingState)
      for (const text of column.hiddenTexts) expect(json, text).not.toContain(text)
      expect(json).toContain(studentName(column.upperStudentId))
    })
  })

  describe(isAccountingRecordColumn ? '解決後（上段が空いて 1 行へ）: 記録が机へ戻り、全消費者に通常どおり出る' : '解決後（既存を採用）: 下段だった中身が実配置として全消費者に出る', () => {
    const resolved = resolvePending(column, board)
    const displayOnly = column.label.startsWith('表示専用')
    // 表示専用の記録（moved）は 1 行へ戻るときに捨てる（Q28-3）ので、解決後に出るのは生徒・会計記録・メモだけ。
    const surfacedStudentIds = column.hiddenStudentIds.filter((studentId) => !(displayOnly && studentId === 'sD'))
    const surfacedTexts = column.hiddenTexts.filter((text) => !(displayOnly && text === '土屋'))

    it('保留マップから消え、盤面 PDF・盤面共有に下段だった中身が出る', () => {
      expect(resolved.pending[board.key]).toBeUndefined()
      const { pdfText } = boardPdfText(resolved)
      const json = boardShareCellJson(resolved)
      for (const text of surfacedTexts) {
        expect(pdfText, text).toContain(text)
        // 盤面共有はメモを載せない（従来仕様）。
        if (text !== '下段の持ち物メモ') expect(json, text).toContain(text)
      }
      if (displayOnly) {
        expect(pdfText).not.toContain('土屋')
        expect(json).not.toContain('土屋')
      }
    })

    it('生徒日程表・回数表（実績）に下段だった生徒が出る', () => {
      for (const studentId of surfacedStudentIds) {
        const sheet = studentSheet(resolved, studentId)
        expect(sheet.cards.length, studentId).toBeGreaterThan(0)
        if (column.label.endsWith('（欠席）')) {
          // 欠席は実績に数えず、日程表の「休」と欠席欄に出る（条件 9-2・10）。
          expect(sheet.cards.map((card) => card.main).join(' ')).toContain('休')
          expect(sheet.absenceNotes.length).toBeGreaterThan(0)
        } else {
          expect(sheet.actual, studentId).toBeGreaterThan(0)
        }
      }
    })

    it('講師日程表に下段だった生徒が机の講師の下に出る', () => {
      const teacherId = teachers.find((teacher) => teacher.name === board.teacherName)!.id
      const people = teacherSheet(resolved, teacherId).people
      for (const studentId of surfacedStudentIds) expect(people, studentId).toContain(studentName(studentId))
    })

    it('給与・交通費: 下段だった出席記録が机の講師の集計に入る（出席の列だけ）', () => {
      const teacherId = teachers.find((teacher) => teacher.name === board.teacherName)!.id
      const salary = teacherSheet(resolved, teacherId)
      const expected = column.label.endsWith('（出席）') ? 1 : 0
      expect(salary.salaryCount).toBe(expected)
      expect(salary.attendanceDays).toBe(expected)
    })

    it('保護者向け表示（本体と functions 複製が一致）: 下段だった通常・振替・欠席が出る（講習・出席は保護者向けの対象外）', () => {
      for (const studentId of surfacedStudentIds) {
        const lessons = parentLessonsOn(resolved, studentId)
        const shownToParents = column.lowerLessonType === 'regular' || column.lowerLessonType === 'makeup' || column.label.endsWith('（欠席）')
        if (shownToParents) expect(lessons.length, studentId).toBeGreaterThan(0)
      }
    })

    if (!isAccountingRecordColumn) {
      it('取り下げた上段の生徒はその日の実配置から消え、予定（希望回数）も −1 されて予定＝実績のまま（Q26-1）', () => {
        expect(studentSheet(resolved, column.upperStudentId).cards).toEqual([])
        expect(parentLessonsOn(resolved, column.upperStudentId)).toEqual([])
        const before = studentSheet(pendingState, column.upperStudentId)
        const after = studentSheet(resolved, column.upperStudentId)
        expect(after.actual).toBe(before.actual - 1)
        expect(after.desiredRegular).toBe(before.desiredRegular - 1)
      })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 机に残した会計記録（INV-13 の対象外＝保留中も通常どおり出る・受け入れ条件 10）
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-13 マトリクス: 机に残した会計記録（欠席）は保留中も通常どおり出る（保存の前後で日程表・回数表が同じ）', () => {
  // 机0: 旧テンプレの青木が欠席（机に残る会計記録）＋手で置いた振替 三浦（下段になる）。新テンプレは机0 に千葉と馬場（2 席とも埋めるので三浦の席がぶつかる）。
  // Q37（2026-10-03）: 欠席の記録は席を確保せず、三浦の席がテンプレで空いていれば 1 行にまとまるので、保留を作るには 2 席とも埋める。
  let week = buildWeek(OLD_ROWS)
  week = mutateDesk(week, 0, (desk) => ({ ...desk, lesson: { id: 'l0', studentSlots: [null, MAKEUP_M] }, statusSlots: [status('sA', 'absent', { teacherName: '田中' }), null] }))
  const beforeState: BoardState = { weeks: [week], pending: {} }
  const diff = computeTemplateDiffApplyForBoard({
    weeks: [week],
    classroomSettings: settings(),
    teachers,
    students,
    regularLessons: [row('r0', 't2', 'sC', '数', 'sB', '数'), row('r1', 't1'), row('r2', 't3')],
    effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: [],
    templatePendingDesks: {},
    createdAt: '2026-09-29T10:00:00.000Z',
  })
  const afterState: BoardState = { weeks: diff.nextWeeks, pending: diff.nextPendingDesks }
  const desk = diff.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[0]

  it('前提: 欠席記録は机に残り（下段へ入らない）、手で置いた振替だけが下段に入る', () => {
    const key = buildTemplatePendingDeskKey(CELL_ID, desk.id)
    expect(desk.statusSlots?.filter(Boolean).map((item) => [item!.managedStudentId, item!.status])).toEqual([['sA', 'absent']])
    expect(diff.nextPendingDesks[key].lower.statusSlots).toBeUndefined()
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.filter(Boolean).map((item) => item!.managedStudentId)).toEqual(['sM'])
  })

  it('生徒日程表の「休」・欠席欄・回数表（実績）は保存の前後で同じ', () => {
    const before = studentSheet(beforeState, 'sA')
    const after = studentSheet(afterState, 'sA')
    expect(before.cards.map((card) => card.main).join(' ')).toContain('休')
    expect(after.cards).toEqual(before.cards)
    expect(after.absenceNotes.length).toBe(before.absenceNotes.length)
    expect(after.actual).toBe(before.actual)
  })

  it('保護者向け表示（本体と functions 複製が一致）でも欠席は保存の前後で同じく出る', () => {
    expect(parentLessonsOn(afterState, 'sA')).toEqual(parentLessonsOn(beforeState, 'sA'))
    expect(parentLessonsOn(afterState, 'sA').length).toBeGreaterThan(0)
  })

  // Q37（オーナー指示 2026-10-03）: 席が足りなくても休みの記録は机に残る（上段 2 人の下）。旧 Q21-10 の「記録だけ下段へ退避」はしない。
  it('Q37: 新テンプレが 2 席とも埋めて席が足りなくても、欠席記録は机に残り（下段へ入らず）、生徒日程表の「休」と保護者向け表示は保存の前後で同じ', () => {
    let crowded = buildWeek(OLD_ROWS)
    crowded = mutateDesk(crowded, 1, (desk) => ({ ...desk, lesson: undefined, statusSlots: [status('sD', 'absent', { lessonType: 'makeup', makeupSourceDate: '2026-09-16', makeupSourceLabel: '9/16(水) 5限', teacherName: '田中' }), null] }))
    const before: BoardState = { weeks: [crowded], pending: {} }
    const saved = computeTemplateDiffApplyForBoard({
      weeks: [crowded], classroomSettings: settings(), teachers, students, regularLessons: NEW_ROWS_TWO_IN_DESK1,
      effectiveStartDate: EFFECTIVE, suppressedRegularLessonOccurrences: [], templatePendingDesks: {}, createdAt: '2026-10-03T10:00:00.000Z',
    })
    const after: BoardState = { weeks: saved.nextWeeks, pending: saved.nextPendingDesks }
    const desk1 = saved.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[1]
    expect(desk1.lesson?.studentSlots.filter(Boolean)).toHaveLength(2)
    expect(desk1.statusSlots?.map((item) => item?.status ?? null)).toEqual(['absent', null])
    expect(saved.nextPendingDesks[buildTemplatePendingDeskKey(CELL_ID, desk1.id)]).toBeUndefined()
    expect(studentSheet(after, 'sD').cards).toEqual(studentSheet(before, 'sD').cards)
    expect(studentSheet(after, 'sD').cards.map((card) => card.main).join(' ')).toContain('休')
    expect(parentLessonsOn(after, 'sD')).toEqual(parentLessonsOn(before, 'sD'))
  })
})

// 既知の穴（2026-10-01・regression-reviewer の L-7 兄弟監査で再現・保存の settle〔v1.5.575〕以前からある）:
// 再マージ（mergeManagedWeek）は保留の机を知らないので、上段が空のまま残った保留の机（会計を持つ記録で席が埋まり振替が下段に残る形）の講師は、
// 同じコマに同名の講師が居ると外れ、空いた机へ別の講師が置かれる（下段の生徒が別の講師の下に見える）。Q31 の固定は詰め直し・自動割当にしか入っていない。
describe('INV-13 × 再マージ: 保留の机の講師（既知の穴）', () => {
  it.todo('上段が空のまま残った保留の机も、同じコマに同名の講師が居る保存 → 再マージで講師を保つ（Q31 の固定を再マージにも）')
})
