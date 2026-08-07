import { describe, expect, it, vi } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import {
  buildManagedScheduleCellsForRange,
  buildScheduleCellsForRange,
  computeStudentMove,
  computeTeacherMove,
  ensureWeeksCoverDateRange,
  overlayBoardWeeksOnScheduleCells,
} from './ScheduleBoardScreen'
import { openTeacherScheduleHtml } from '../../utils/scheduleHtml'
import { buildTeacherAssignments, collectTeacherAssignmentEntries } from '../../utils/scheduleViewData'

/**
 * INV-01 操作マトリクステスト（台帳: docs/spec-invariants.md）
 *
 * 保証 INV-01【強制】: 講師日程表では、生徒の各コマは「盤面で実際に置かれた机の講師」1名のみに
 *   表示される。旧担当（基本データ上の通常授業講師=テンプレ講師）や別の机の講師のページに
 *   同じ生徒が二重表示されてはならず、また置いた机の講師のページから漏れてもいけない。
 *
 * 違反履歴: v1.5.388（同コマ内で別講師の机へ生徒移動 → 旧講師にも二重表示） /
 *   v1.5.436（講師D&D入れ替え=swap → 旧講師・新講師の両ページに二重表示）。
 *
 * マトリクス:
 *   操作     = 配置(新規) / 移動(同コマ別講師机) / 入替(講師swap) / 削除(講師) / 生徒swap
 *   確認点   = 直後(盤面の実配置) / テンプレ再マージ後 / 保存→再読込相当(serialize往復)
 *
 * 各セル = 小さな fixture + 1操作 + 帰属一意の両方向アサート
 *   (「新講師のページに1回だけ出る」 かつ 「旧講師のページに出ない」)。
 *
 * 既存の担保（重複を避けるため薄い確認 or 省略にとどめる）:
 *   - 移動×直後/再マージ/serialize: ScheduleBoardScreen.test.ts:1207
 *   - 移動×serialize(payload regularTeacherIds): scheduleHtml.test.ts:2365
 *   - swap×直後(id補完): ScheduleBoardScreen.test.ts:4635 / 4663
 *   - swap×serialize端到端(buildTeacherAssignments): scheduleHtml.test.ts:2543
 *   本ファイルは【空セル】(配置(新規)全点 / 移動×serialize両方向 / swap×再マージ往復 /
 *   削除×dup観点 / 生徒swap全点)を厚く埋める。
 */

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 14,
}

// 2026-07-24 は金曜(dayOfWeek=5)。テンプレ通常授業は Fri/5限に置く。
const FRI = '2026-07-24'
const CELL_ID = `${FRI}_5`
const RANGE = { startDate: '2026-07-20', endDate: '2026-07-26', periodValue: '' }

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中 太郎',
    displayName: '田中',
    email: 'teacher@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '数', maxGrade: '高3' }],
    ...overrides,
  }
}

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 花子',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
    ...overrides,
  }
}

function createRegularLesson(overrides: Partial<RegularLessonRow> = {}): RegularLessonRow {
  return {
    id: 'regular-1',
    schoolYear: 2026,
    teacherId: 'teacher-1',
    student1Id: 'student-1',
    subject1: '英',
    startDate: '2026-04-01',
    endDate: '未定',
    student2Id: '',
    subject2: '',
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek: 5,
    slotNumber: 5,
    ...overrides,
  }
}

function mkStudentEntry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '井上',
    managedStudentId: 'student-inoue',
    grade: '中2',
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

// 共通の登場人物: 講師X=落合(井上の通常授業担当) / 講師Y=山本(青木の通常授業担当)。
const teacherX = createTeacher({ id: 't_ochiai', name: '落合 優太', displayName: '落合', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }] })
const teacherY = createTeacher({ id: 't_yamamoto', name: '山本 遼', displayName: '山本', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] })
const studentS1 = createStudent({ id: 'student-inoue', name: '井上 一郎', displayName: '井上' })
const studentS2 = createStudent({ id: 'student-aoki', name: '青木 二郎', displayName: '青木' })
const allTeachers = [teacherX, teacherY]
const allStudents = [studentS1, studentS2]
// 井上=落合の英(Fri5) / 青木=山本の数(Fri5)。
const regularLessons: RegularLessonRow[] = [
  createRegularLesson({ id: 'r-ochiai-inoue', teacherId: 't_ochiai', student1Id: 'student-inoue', subject1: '英' }),
  createRegularLesson({ id: 'r-yamamoto-aoki', teacherId: 't_yamamoto', student1Id: 'student-aoki', subject1: '数' }),
]

type SerializeOpts = { teachers?: TeacherRow[]; students?: StudentRow[]; regularLessons?: RegularLessonRow[] }

// ---- serialize往復ハーネス（生成HTML の schedule-data payload を取り出す） -------------------
// scheduleHtml.ts の createBasePayload → serializeCells → resolveRegularTeacherIds(非export) を
// 経由し、講師日程表 payload の desks（teacherId / regularTeacherIds / lesson.students）を得る。
function serializeTeacherPayloadCells(cells: SlotCell[], opts: SerializeOpts = {}): Array<{
  dateKey: string
  slotNumber: number
  desks: Array<{ teacher: string; teacherId?: string; regularTeacherIds?: string[]; lesson?: { students: Array<{ id?: string; name: string }> }; statuses?: unknown[] }>
}> {
  const write = vi.fn()
  const popup = { closed: false, document: { open() {}, write, close() {} }, focus() {}, postMessage() {} } as unknown as Window
  vi.stubGlobal('window', { open: () => popup, setTimeout: (cb: () => void) => { cb(); return 0 } })
  openTeacherScheduleHtml({
    cells,
    teachers: opts.teachers ?? allTeachers,
    students: opts.students ?? allStudents,
    regularLessons: opts.regularLessons ?? regularLessons,
    defaultStartDate: RANGE.startDate,
    defaultEndDate: RANGE.endDate,
    defaultPersonId: 't_ochiai',
    titleLabel: 'INV-01',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
    targetWindow: popup,
  } as Parameters<typeof openTeacherScheduleHtml>[0])
  const html = write.mock.calls[0]?.[0] as string
  vi.unstubAllGlobals()
  const match = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
  expect(match).toBeTruthy()
  return JSON.parse(match![1]).cells
}

// serialize payload → 指定講師の日程に載る生徒名（lesson + status 由来）を集める。
function serializedTeacherStudentNames(cells: SlotCell[], teacher: { id: string; name: string; fullName: string }, opts: SerializeOpts = {}): string[] {
  const payloadCells = serializeTeacherPayloadCells(cells, opts)
  const assignmentMap = buildTeacherAssignments(payloadCells as Parameters<typeof buildTeacherAssignments>[0])
  return collectTeacherAssignmentEntries(assignmentMap, teacher as Parameters<typeof collectTeacherAssignmentEntries>[1])
    .flatMap((entry) => [
      ...(entry.students || []).map((s) => s.name),
      ...(entry.statuses || []).map((s) => s.name),
    ])
}

const asTeacherKey = (t: TeacherRow) => ({ id: t.id, name: t.displayName ?? t.name, fullName: t.name })

// 盤面(SlotCell[])から、指定生徒名を studentSlots に持つ机の講師名を集める（直後の実配置検査用）。
function boardTeachersHoldingStudent(cells: SlotCell[], studentName: string): string[] {
  const teachers: string[] = []
  for (const cell of cells) {
    for (const desk of cell.desks) {
      const slots = desk.lesson?.studentSlots ?? []
      if (slots.some((s) => s?.name === studentName)) teachers.push(desk.teacher)
    }
  }
  return teachers
}

type RemergeOpts = { students?: StudentRow[]; regularLessons?: RegularLessonRow[]; suppressedRegularLessonOccurrences?: string[] }

// テンプレ再マージ(mergeManagedWeek)を通した講師日程セルを得る。
// 移動/入替で生じた suppressedRegularLessonOccurrences を渡すと、テンプレ側の当該通常授業行が
// 再付与されない（= 移動元講師の机に生徒が復活しない）。実挙動どおり必ずスレッドする。
function remergeScheduleCells(boardWeeks: SlotCell[][], opts: RemergeOpts = {}): SlotCell[] {
  return buildScheduleCellsForRange({
    range: RANGE,
    fallbackStartDate: RANGE.startDate,
    fallbackEndDate: RANGE.endDate,
    classroomSettings,
    teachers: allTeachers,
    students: opts.students ?? allStudents,
    regularLessons: opts.regularLessons ?? regularLessons,
    boardWeeks,
    suppressedRegularLessonOccurrences: opts.suppressedRegularLessonOccurrences ?? [],
  })
}

// ============================================================================
// 操作1: 配置(新規) — 振替(makeup)を、元授業の担当(落合)とは別の講師(山本)の机へ新規配置。
//   「新規配置」は同スロットの通常授業を重複配置できない(findDuplicateStudentInCell)ため、
//   通常授業を別講師机へ置くのは操作2(移動)に相当する。ここでは realistic な新規配置=振替の配置を扱う。
//   INV-01: 振替を置いた机の講師(山本)のページにのみ出て、元授業の担当(落合)には出ない。
// ============================================================================
describe('INV-01 マトリクス: 配置(新規select) — 振替を別講師の机に置く', () => {
  // 井上の通常授業は火曜(落合)。金曜5限へその振替を、山本(id保持)の机に新規配置した盤面。
  const placeLessons: RegularLessonRow[] = [
    createRegularLesson({ id: 'r-ochiai-inoue-tue', teacherId: 't_ochiai', student1Id: 'student-inoue', subject1: '英', dayOfWeek: 2, slotNumber: 4 }),
  ]
  const buildPlacedBoard = (teacherIdOnDesk: string | undefined): SlotCell[][] => ([[
    {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        // 山本の机に井上の振替を新規配置。手動選択(setManualTeacherAssignment)相当で id を保持。
        { id: `${CELL_ID}_desk_1`, teacher: '山本', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: teacherIdOnDesk, lesson: { id: 'placed-inoue', studentSlots: [mkStudentEntry({ id: 'inoue-1', lessonType: 'makeup', makeupSourceDate: '2026-07-21', makeupSourceLabel: '2026/7/21(火) 4限' }), null] } },
      ],
    } as unknown as SlotCell,
  ]])

  it('直後: 井上(振替)は山本の机にのみ在り、他机には無い', () => {
    const board = buildPlacedBoard('t_yamamoto')
    const holders = boardTeachersHoldingStudent(board[0], '井上')
    expect(holders).toEqual(['山本'])
  })

  it('テンプレ再マージ後: 井上(振替)は山本の机にのみ残り、テンプレの落合行で復活しない', () => {
    const board = buildPlacedBoard('t_yamamoto')
    const merged = remergeScheduleCells(board, { students: [studentS1], regularLessons: placeLessons })
    const fri5 = merged.filter((c) => c.dateKey === FRI && c.slotNumber === 5)
    const holders = fri5.flatMap((c) => boardTeachersHoldingStudent([c], '井上'))
    expect(holders).toEqual(['山本'])
  })

  it('保存→再読込相当(serialize往復): 井上(振替)は山本のページにだけ出て落合(元授業担当)には出ない', () => {
    const board = buildPlacedBoard('t_yamamoto')
    const merged = remergeScheduleCells(board, { students: [studentS1], regularLessons: placeLessons })
    const namesX = serializedTeacherStudentNames(merged, asTeacherKey(teacherX), { students: [studentS1], regularLessons: placeLessons })
    const namesY = serializedTeacherStudentNames(merged, asTeacherKey(teacherY), { students: [studentS1], regularLessons: placeLessons })
    expect(namesY).toContain('井上')
    expect(namesX).not.toContain('井上')
  })
})

// ============================================================================
// 操作2: 移動(同コマ別講師机) — 落合の机の井上を、同コマの山本(空き)机へ移動。
//   sameDayMoveSourceDate ガード + 机の講師名/id で山本のページにのみ出る。
// ============================================================================
describe('INV-01 マトリクス: 移動(同コマ別講師机) — 生徒を別講師の空き机へ', () => {
  // テンプレから盤面週を生成し、井上を同コマ内の山本(空き)机へ移す。
  const buildMovedBoard = () => {
    // 井上=落合(Fri5 英)。山本は生徒を持たない teacher-only 行(移動先の空き机)。
    const localRegularLessons: RegularLessonRow[] = [
      createRegularLesson({ id: 'r-ochiai-inoue', teacherId: 't_ochiai', student1Id: 'student-inoue', subject1: '英' }),
      createRegularLesson({ id: 'r-yamamoto-only', teacherId: 't_yamamoto', student1Id: '', subject1: '' }),
    ]
    const boardWeek = buildManagedScheduleCellsForRange({
      range: RANGE,
      fallbackStartDate: RANGE.startDate,
      fallbackEndDate: RANGE.endDate,
      classroomSettings,
      teachers: allTeachers,
      students: [studentS1],
      regularLessons: localRegularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const targetCell = boardWeek.find((c) => c.dateKey === FRI && c.slotNumber === 5)!
    const oldDeskIndex = targetCell.desks.findIndex((d) => d.lesson?.studentSlots.some((s) => s?.managedStudentId === 'student-inoue'))
    const newDeskIndex = targetCell.desks.findIndex((d) => !d.lesson && d.teacher === '山本')
    const movingEntry = targetCell.desks[oldDeskIndex]!.lesson!.studentSlots.find((s) => s?.managedStudentId === 'student-inoue')!
    const move = computeStudentMove({
      weeks: [boardWeek],
      weekIndex: 0,
      cells: boardWeek,
      movingStudentId: movingEntry.id,
      cellId: targetCell.id,
      deskIndex: newDeskIndex,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: new Map([[studentS1.name, studentS1], ['井上', studentS1]]),
      resolveBoardStudentDisplayName: (n: string) => n,
    })
    expect(move.status).toBe('moved')
    if (move.status !== 'moved') throw new Error('move failed')
    return { nextWeeks: move.nextWeeks, localRegularLessons, suppressed: move.nextSuppressedRegularLessonOccurrences }
  }

  it('直後: 井上は山本の机にのみ在り、落合の机には残らない', () => {
    const { nextWeeks } = buildMovedBoard()
    const holders = boardTeachersHoldingStudent(nextWeeks[0], '井上')
    expect(holders).toEqual(['山本'])
  })

  it('テンプレ再マージ後: 井上は山本の机にのみ残る(落合行で復活しない)', () => {
    const { nextWeeks, localRegularLessons, suppressed } = buildMovedBoard()
    const merged = remergeScheduleCells(nextWeeks, { students: [studentS1], regularLessons: localRegularLessons, suppressedRegularLessonOccurrences: suppressed })
    const holders = boardTeachersHoldingStudent(merged, '井上')
    expect(holders).toEqual(['山本'])
  })

  it('保存→再読込相当(serialize往復): 井上は山本のページにだけ出て落合に二重表示されない', () => {
    const { nextWeeks, localRegularLessons, suppressed } = buildMovedBoard()
    const merged = remergeScheduleCells(nextWeeks, { students: [studentS1], regularLessons: localRegularLessons, suppressedRegularLessonOccurrences: suppressed })
    const namesX = serializedTeacherStudentNames(merged, asTeacherKey(teacherX), { students: [studentS1], regularLessons: localRegularLessons })
    const namesY = serializedTeacherStudentNames(merged, asTeacherKey(teacherY), { students: [studentS1], regularLessons: localRegularLessons })
    expect(namesY).toContain('井上')
    expect(namesX).not.toContain('井上')
  })
})

// ============================================================================
// 操作3: 入替(講師swap) — computeTeacherMove で 2机の講師だけを入れ替える。
//   テンプレ由来で id 未保持の机でも、着地講師名から id を補完し帰属を一意に保つ。
//   直後は既存(4635)で担保済み → ここは【再マージ往復】を厚く埋める。
// ============================================================================
describe('INV-01 マトリクス: 入替(講師swap) — 講師ブロックのみ入替', () => {
  // 盤面: Fri5 に落合(井上)と山本(青木)がテンプレ配置。どちらも id 未保持(stale)を再現。
  const buildSwappedBoard = () => {
    const boardWeeks = [[{
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '落合', manualTeacher: false, teacherAssignmentTeacherId: undefined, lesson: { id: 'l-inoue', studentSlots: [mkStudentEntry({ id: 'inoue-1' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '山本', manualTeacher: false, teacherAssignmentTeacherId: undefined, lesson: { id: 'l-aoki', studentSlots: [mkStudentEntry({ id: 'aoki-1', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    }]] as unknown as SlotCell[][]
    const move = computeTeacherMove({ weeks: boardWeeks, weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers: allTeachers })
    expect(move.status).toBe('moved')
    if (move.status !== 'moved') throw new Error('swap failed')
    return move.nextWeeks
  }

  it('直後(薄い確認): 井上は山本机に、青木は落合机に移り、各生徒は1机のみ', () => {
    const next = buildSwappedBoard()
    expect(boardTeachersHoldingStudent(next[0], '井上')).toEqual(['山本'])
    expect(boardTeachersHoldingStudent(next[0], '青木')).toEqual(['落合'])
  })

  it('テンプレ再マージ(overlay)後: 入替後の帰属が保たれ、テンプレの元担当へ戻らない', () => {
    const next = buildSwappedBoard()
    // テンプレ側(元の担当: 落合=井上 / 山本=青木)を managed セルとして overlay する。
    const managedCell = {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '落合', teacherAssignmentTeacherId: 't_ochiai', lesson: { id: 'managed_r-ochiai_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'inoue-m' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '山本', teacherAssignmentTeacherId: 't_yamamoto', lesson: { id: 'managed_r-yamamoto_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'aoki-m', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    } as unknown as SlotCell
    const merged = overlayBoardWeeksOnScheduleCells([managedCell], next)
    // 入替の結果(井上=山本机 / 青木=落合机)が維持され、元担当へ戻っていない。
    expect(boardTeachersHoldingStudent(merged, '井上')).toEqual(['山本'])
    expect(boardTeachersHoldingStudent(merged, '青木')).toEqual(['落合'])
  })

  it('テンプレ再マージ(overlay)→serialize往復: 生徒は新担当のページにだけ出る', () => {
    const next = buildSwappedBoard()
    const managedCell = {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '落合', teacherAssignmentTeacherId: 't_ochiai', lesson: { id: 'managed_r-ochiai_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'inoue-m' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '山本', teacherAssignmentTeacherId: 't_yamamoto', lesson: { id: 'managed_r-yamamoto_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'aoki-m', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    } as unknown as SlotCell
    const merged = overlayBoardWeeksOnScheduleCells([managedCell], next)
    const namesX = serializedTeacherStudentNames(merged, asTeacherKey(teacherX))
    const namesY = serializedTeacherStudentNames(merged, asTeacherKey(teacherY))
    // 井上は新担当(山本)にだけ / 青木は新担当(落合)にだけ。旧担当への二重表示なし(両方向)。
    expect(namesY).toContain('井上')
    expect(namesX).not.toContain('井上')
    expect(namesX).toContain('青木')
    expect(namesY).not.toContain('青木')
  })
})

// ============================================================================
// 操作3b: 席まるごと入替(講師seat swap・2026-07-21) — computeTeacherMove swapMode:'seat'。
//   講師と生徒のペアを保ったまま席(desk.id)だけを交換する。講師だけ入替(操作3)と違い、
//   生徒は講師に付いて動くので「井上=落合 / 青木=山本」の帰属が保たれる(ペア不変)。
//   INV-01観点: ペアが動いても各生徒は1机の講師にのみ表示され、旧位置に二重表示しない。
// ============================================================================
describe('INV-01 マトリクス: 席まるごと入替(seat swap) — 講師と生徒のペアを保ったまま席を交換', () => {
  const buildSeatSwappedBoard = () => {
    const boardWeeks = [[{
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '落合', manualTeacher: false, teacherAssignmentTeacherId: undefined, lesson: { id: 'l-inoue', studentSlots: [mkStudentEntry({ id: 'inoue-1' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '山本', manualTeacher: false, teacherAssignmentTeacherId: undefined, lesson: { id: 'l-aoki', studentSlots: [mkStudentEntry({ id: 'aoki-1', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    }]] as unknown as SlotCell[][]
    const move = computeTeacherMove({ weeks: boardWeeks, weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers: allTeachers, swapMode: 'seat' })
    expect(move.status).toBe('moved')
    if (move.status !== 'moved') throw new Error('seat swap failed')
    return move.nextWeeks
  }

  it('直後: 井上は落合机(席2へ移動)に、青木は山本机(席1へ移動)に付いて動き、ペアが保たれる', () => {
    const next = buildSeatSwappedBoard()
    // 講師だけ入替(操作3)なら井上=山本になるが、席まるごと入替では井上=落合のまま(ペア不変)。
    expect(boardTeachersHoldingStudent(next[0], '井上')).toEqual(['落合'])
    expect(boardTeachersHoldingStudent(next[0], '青木')).toEqual(['山本'])
  })

  it('テンプレ再マージ(overlay)後: ペア(井上=落合 / 青木=山本)が保たれ二重表示しない', () => {
    const next = buildSeatSwappedBoard()
    const managedCell = {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '落合', teacherAssignmentTeacherId: 't_ochiai', lesson: { id: 'managed_r-ochiai_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'inoue-m' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '山本', teacherAssignmentTeacherId: 't_yamamoto', lesson: { id: 'managed_r-yamamoto_2026-07-24', note: '管理データ反映', studentSlots: [mkStudentEntry({ id: 'aoki-m', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    } as unknown as SlotCell
    const merged = overlayBoardWeeksOnScheduleCells([managedCell], next)
    expect(boardTeachersHoldingStudent(merged, '井上')).toEqual(['落合'])
    expect(boardTeachersHoldingStudent(merged, '青木')).toEqual(['山本'])
  })

  it('serialize往復: 井上は落合のページに、青木は山本のページにだけ出る(両方向・漏れも二重もなし)', () => {
    const next = buildSeatSwappedBoard()
    const namesX = serializedTeacherStudentNames(next[0], asTeacherKey(teacherX))
    const namesY = serializedTeacherStudentNames(next[0], asTeacherKey(teacherY))
    // 落合(X)=井上のみ / 山本(Y)=青木のみ。
    expect(namesX).toContain('井上')
    expect(namesX).not.toContain('青木')
    expect(namesY).toContain('青木')
    expect(namesY).not.toContain('井上')
  })
})

// ============================================================================
// 操作4: 削除(講師) — handleDeleteTeacher 相当（teacher='' / source='deleted' /
//   teacherAssignmentTeacherId=削除した講師名）。講師のいなくなった机の生徒は、
//   テンプレ担当(regularTeacherIds)へ漏れて別ページに出てはいけない（dup観点）。
// ============================================================================
describe('INV-01 マトリクス: 削除(講師) — 講師を消した机の生徒がテンプレ担当へ漏れない', () => {
  // Fri5: 山本机に井上(井上のテンプレ担当は落合)、落合机に青木を配置した盤面。
  const buildBoard = (): SlotCell[][] => ([[
    {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '山本', manualTeacher: true, teacherAssignmentTeacherId: 't_yamamoto', lesson: { id: 'l-inoue', studentSlots: [mkStudentEntry({ id: 'inoue-1' }), null] } },
        { id: `${CELL_ID}_desk_2`, teacher: '落合', manualTeacher: true, teacherAssignmentTeacherId: 't_ochiai', lesson: { id: 'l-aoki', studentSlots: [mkStudentEntry({ id: 'aoki-1', name: '青木', managedStudentId: 'student-aoki', subject: '数' }), null] } },
      ],
    } as unknown as SlotCell,
  ]])

  // handleDeleteTeacher 相当の削除を desk1(山本)へ適用する。
  const deleteTeacherOnDesk1 = (board: SlotCell[][]): SlotCell[][] => {
    const desk = board[0][0].desks[0]
    const deletedName = desk.teacher
    desk.teacher = ''
    desk.manualTeacher = true
    desk.teacherAssignmentSource = 'deleted'
    desk.teacherAssignmentSessionId = undefined
    desk.teacherAssignmentTeacherId = deletedName || undefined
    return board
  }

  it('直後: 講師を消した机は teacher が空になり、隣の青木は落合机のまま', () => {
    const board = deleteTeacherOnDesk1(buildBoard())
    expect(board[0][0].desks[0].teacher).toBe('')
    // 青木は無関係の落合机に残る。
    expect(boardTeachersHoldingStudent(board[0], '青木')).toEqual(['落合'])
  })

  it('保存→再読込相当(serialize往復): 井上は落合(テンプレ担当)にも山本にも出ない / 青木は落合にのみ', () => {
    const board = deleteTeacherOnDesk1(buildBoard())
    const namesX = serializedTeacherStudentNames(board[0], asTeacherKey(teacherX))
    const namesY = serializedTeacherStudentNames(board[0], asTeacherKey(teacherY))
    // 講師を消した机の井上は、テンプレ担当(落合)へ regularTeacherIds 経由で漏れない。
    expect(namesX).not.toContain('井上')
    // 山本のページにも出ない(講師を外した=講師なしの授業)。
    expect(namesY).not.toContain('井上')
    // 青木は自分の机の担当(落合)にだけ出る(削除の巻き添えで消えたり重複したりしない)。
    expect(namesX).toContain('青木')
    expect(namesY).not.toContain('青木')
  })
})

// ============================================================================
// 操作5: 生徒swap — computeStudentMove で生徒同士を入れ替え(相手は移動元へ)。
//   両生徒とも同日移動(sameDayMoveSourceDate)扱いになり、各々の着地机の講師にのみ帰属する。
// ============================================================================
describe('INV-01 マトリクス: 生徒swap — 生徒2人を入れ替え', () => {
  // Fri5: 落合机に井上(落合担当) / 山本机に青木(山本担当)。井上を山本机へ動かして入替。
  const buildSwappedBoard = () => {
    const boardWeek = buildManagedScheduleCellsForRange({
      range: RANGE,
      fallbackStartDate: RANGE.startDate,
      fallbackEndDate: RANGE.endDate,
      classroomSettings,
      teachers: allTeachers,
      students: allStudents,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const cell = boardWeek.find((c) => c.dateKey === FRI && c.slotNumber === 5)!
    const inoueDeskIndex = cell.desks.findIndex((d) => d.lesson?.studentSlots.some((s) => s?.managedStudentId === 'student-inoue'))
    const aokiDeskIndex = cell.desks.findIndex((d) => d.lesson?.studentSlots.some((s) => s?.managedStudentId === 'student-aoki'))
    expect(inoueDeskIndex).toBeGreaterThanOrEqual(0)
    expect(aokiDeskIndex).toBeGreaterThanOrEqual(0)
    const movingEntry = cell.desks[inoueDeskIndex]!.lesson!.studentSlots.find((s) => s?.managedStudentId === 'student-inoue')!
    const move = computeStudentMove({
      weeks: [boardWeek],
      weekIndex: 0,
      cells: boardWeek,
      movingStudentId: movingEntry.id,
      cellId: cell.id,
      deskIndex: aokiDeskIndex,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: new Map([
        [studentS1.name, studentS1], ['井上', studentS1],
        [studentS2.name, studentS2], ['青木', studentS2],
      ]),
      resolveBoardStudentDisplayName: (n: string) => n,
    })
    expect(move.status).toBe('moved')
    if (move.status !== 'moved') throw new Error('student swap failed')
    return { nextWeeks: move.nextWeeks, suppressed: move.nextSuppressedRegularLessonOccurrences }
  }

  it('直後: 井上は山本机に、青木は落合机に入れ替わり、各生徒は1机のみ', () => {
    const { nextWeeks } = buildSwappedBoard()
    expect(boardTeachersHoldingStudent(nextWeeks[0], '井上')).toEqual(['山本'])
    expect(boardTeachersHoldingStudent(nextWeeks[0], '青木')).toEqual(['落合'])
  })

  it('テンプレ再マージ後: 入替後の帰属が保たれ、テンプレの元担当へ戻らない', () => {
    const { nextWeeks, suppressed } = buildSwappedBoard()
    const merged = remergeScheduleCells(nextWeeks, { suppressedRegularLessonOccurrences: suppressed })
    expect(boardTeachersHoldingStudent(merged, '井上')).toEqual(['山本'])
    expect(boardTeachersHoldingStudent(merged, '青木')).toEqual(['落合'])
  })

  it('保存→再読込相当(serialize往復): 井上=山本 / 青木=落合 にだけ出て、旧担当へ二重表示されない', () => {
    const { nextWeeks, suppressed } = buildSwappedBoard()
    const merged = remergeScheduleCells(nextWeeks, { suppressedRegularLessonOccurrences: suppressed })
    const namesX = serializedTeacherStudentNames(merged, asTeacherKey(teacherX))
    const namesY = serializedTeacherStudentNames(merged, asTeacherKey(teacherY))
    expect(namesY).toContain('井上')
    expect(namesX).not.toContain('井上')
    expect(namesX).toContain('青木')
    expect(namesY).not.toContain('青木')
  })
})

// ============================================================================
// 操作6: 出欠記録のみの机 — 授業レコード(lesson)は無いが statusSlots に出欠が入った机。
//   実障害(2026-08-07 緑が丘校 8/6 4限): 加藤先生の机が日程表の再マージで「空き机」と
//   みなされ、テンプレ足場講師(井上)に teacher を上書きされた。statusSlots は机に残るため、
//   加藤のページは空白／井上のページに他人の生徒が出る、という INV-01 の3例目の経路。
//   本番実測: 日大前12件・緑が丘3件（修正後 0 件）。
//
//   再現条件: 「講師が空でテンプレ足場でもない机」が1つも無い(=第1候補の find が空振り)コマで、
//   第2候補 find(!lesson && !manualTeacher) が出欠記録だけの机を掴む。
// ============================================================================
describe('INV-01 マトリクス: 出欠記録のみの机 — テンプレ足場講師に奪われない', () => {
  // 机2つだけの教室。desk0=山本(テンプレ足場=非manual・出欠記録あり) / desk1=田中(manual)で埋める。
  const twoDeskSettings: ClassroomSettings = { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2 }
  // テンプレは Fri5 に「生徒のいない落合の机」(足場講師)だけを生む。
  const scaffoldOnlyLessons: RegularLessonRow[] = [
    createRegularLesson({ id: 'r-ochiai-scaffold', teacherId: 't_ochiai', student1Id: '', subject1: '' }),
  ]

  const buildBoard = (): SlotCell[][] => ([[
    {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        // 山本の机で青木の出席を記録済み。授業レコード(lesson)は持たない(実障害と同じ形)。
        {
          id: `${CELL_ID}_desk_1`,
          teacher: '山本',
          manualTeacher: false,
          teacherAssignmentTeacherId: 't_yamamoto',
          statusSlots: [
            { id: 'st-aoki', name: '青木', managedStudentId: 'student-aoki', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', status: 'attended', teacherName: '山本' },
            null,
          ],
        },
        // 第1候補(講師が空・非manual)の机を残さないための埋め机。
        { id: `${CELL_ID}_desk_2`, teacher: '田中', manualTeacher: true, teacherAssignmentTeacherId: 'teacher-1' },
      ],
    } as unknown as SlotCell,
  ]])

  const merge = (boardWeeks: SlotCell[][]) => buildScheduleCellsForRange({
    range: RANGE,
    fallbackStartDate: RANGE.startDate,
    fallbackEndDate: RANGE.endDate,
    classroomSettings: twoDeskSettings,
    teachers: allTeachers,
    students: allStudents,
    regularLessons: scaffoldOnlyLessons,
    boardWeeks,
    suppressedRegularLessonOccurrences: [],
  })

  it('テンプレ再マージ後: 出欠を記録した机の講師(山本)が足場講師(落合)に差し替わらない', () => {
    const merged = merge(buildBoard())
    const cell = merged.find((c) => c.dateKey === FRI && c.slotNumber === 5)
    const statusDesk = cell?.desks.find((desk) => (desk.statusSlots ?? []).some((s) => s?.name === '青木'))
    expect(statusDesk).toBeDefined()
    // 修正前はここが '落合'(テンプレ足場講師)に上書きされていた。
    expect(statusDesk?.teacher).toBe('山本')
    // 注: 非manual机の teacherAssignmentTeacherId は再マージで落ちる（INV-02 のテンプレ追従仕様・
    // 本修正の対象外）。帰属は payload の teacher.name(=displayName) 照合で成立する。
  })

  it('テンプレ再マージ後: 盤面に無い足場講師が別の机へ湧かない', () => {
    const merged = merge(buildBoard())
    const cell = merged.find((c) => c.dateKey === FRI && c.slotNumber === 5)
    // 出欠記録のある机は「埋まっている」ので、その index のテンプレ足場講師は消費済み扱いになる。
    expect(cell?.desks.filter((desk) => desk.teacher === '落合')).toHaveLength(0)
  })

  it('保存→再読込相当(serialize往復): 青木は山本のページにのみ出て、落合のページには出ない', () => {
    const merged = merge(buildBoard())
    const namesX = serializedTeacherStudentNames(merged, asTeacherKey(teacherX), { regularLessons: scaffoldOnlyLessons })
    const namesY = serializedTeacherStudentNames(merged, asTeacherKey(teacherY), { regularLessons: scaffoldOnlyLessons })
    expect(namesY).toEqual(['青木'])
    expect(namesX).not.toContain('青木')
  })
})

// ============================================================================
// 操作7: boardOnly（日程表を盤面そのままで描く・boardOnlyScheduleCells＝全教室で有効）
//   オーナー確定 2026-08-07:「必ず盤面と日程表がそろうようにして」。開発用教室で先行(v1.5.472)後、
//   同日オーナー確定で全教室へ昇格。「テンプレにだけ残る通常授業」は**盤面が正**で裁定済み。
//   日程表は従来テンプレを読み直して盤面を重ね直しており、その作り直しが唯一のズレ発生源だった
//   （操作6 の実障害／テンプレにだけ残る通常授業が日程表に湧く 等）。boardOnly=true では
//   テンプレを読まず盤面をそのまま返すので、ズレる余地が構造的に無くなる。
//   ※ 日程表へ渡す盤面は呼び出し側の ensureWeeksCoverDateRange が未生成週をテンプレから
//     生成済みのため、再マージを外しても未来週が空白にならない（この前提を崩さないこと）。
// ============================================================================
describe('INV-01 マトリクス: boardOnly — 日程表が盤面と完全一致する', () => {
  // 空き机を1つ残す(3机)。テンプレの授業が着地できる状態にして、従来挙動との差を見えるようにする。
  const twoDeskSettings: ClassroomSettings = { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 3 }
  // テンプレは Fri5 に「落合の足場講師」と「山本＋青木の通常授業」を生む（盤面には無い姿）。
  const templateLessons: RegularLessonRow[] = [
    createRegularLesson({ id: 'r-ochiai-scaffold', teacherId: 't_ochiai', student1Id: '', subject1: '' }),
    createRegularLesson({ id: 'r-yamamoto-aoki-fri', teacherId: 't_yamamoto', student1Id: 'student-aoki', subject1: '数' }),
  ]

  // 盤面: 山本の机で井上の出席を記録済み（授業レコードは持たない）。青木も落合も盤面には居ない。
  const buildBoard = (): SlotCell[][] => ([[
    {
      id: CELL_ID,
      dateKey: FRI,
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        {
          id: `${CELL_ID}_desk_1`,
          teacher: '山本',
          manualTeacher: false,
          teacherAssignmentTeacherId: 't_yamamoto',
          statusSlots: [
            { id: 'st-inoue', name: '井上', managedStudentId: 'student-inoue', grade: '中2', subject: '英', lessonType: 'regular', teacherType: 'normal', status: 'attended', teacherName: '山本' },
            null,
          ],
        },
        { id: `${CELL_ID}_desk_2`, teacher: '田中', manualTeacher: true, teacherAssignmentTeacherId: 'teacher-1' },
        { id: `${CELL_ID}_desk_3`, teacher: '', manualTeacher: false },
      ],
    } as unknown as SlotCell,
  ]])

  const merge = (boardWeeks: SlotCell[][], boardOnly: boolean) => buildScheduleCellsForRange({
    range: RANGE,
    fallbackStartDate: RANGE.startDate,
    fallbackEndDate: RANGE.endDate,
    classroomSettings: twoDeskSettings,
    teachers: allTeachers,
    students: allStudents,
    regularLessons: templateLessons,
    boardWeeks,
    suppressedRegularLessonOccurrences: [],
    boardOnly,
  })

  // 日程表に「出る」机だけを、講師＋人の組で取り出す（buildTeacherAssignments と同じ可視条件）。
  const visibleSignatures = (cells: SlotCell[]) => cells
    .filter((cell) => cell.dateKey === FRI && cell.slotNumber === 5)
    .flatMap((cell) => cell.desks)
    .filter((desk) => desk.teacher.trim() && (desk.lesson || (desk.statusSlots ?? []).some(Boolean)))
    .map((desk) => [
      desk.teacher,
      ...(desk.lesson?.studentSlots ?? []).filter(Boolean).map((s) => s!.name),
      ...(desk.statusSlots ?? []).filter(Boolean).map((s) => s!.name),
    ].join('/'))
    .sort()

  it('boardOnly=false(旧経路・ロールバック用に保持): テンプレにしか無い青木の通常授業が日程表にだけ湧く', () => {
    // 旧挙動の記録。これが「盤面に無いのに日程表に出る」の正体で、全教室昇格の理由。
    // この経路は本番からは呼ばれない(フラグ all-classrooms)が、戻せるよう挙動を固定しておく。
    const merged = merge(buildBoard(), false)
    expect(visibleSignatures(merged)).toContain('山本/青木')
  })

  it('boardOnly=true: 日程表に出る机が盤面と完全に一致する（湧かない・消えない）', () => {
    const board = buildBoard()
    const merged = merge(board, true)
    expect(visibleSignatures(merged)).toEqual(visibleSignatures(board[0]))
    expect(visibleSignatures(merged)).toEqual(['山本/井上'])
  })

  it('boardOnly=true: 出欠を記録した机の講師はテンプレ足場講師に置き換わらない', () => {
    const merged = merge(buildBoard(), true)
    const statusDesk = merged
      .filter((cell) => cell.dateKey === FRI && cell.slotNumber === 5)
      .flatMap((cell) => cell.desks)
      .find((desk) => (desk.statusSlots ?? []).some((s) => s?.name === '井上'))
    expect(statusDesk?.teacher).toBe('山本')
    expect(statusDesk?.teacherAssignmentTeacherId).toBe('t_yamamoto')
  })

  it('boardOnly=true: 盤面を書き換えない（返り値はクローン）', () => {
    const board = buildBoard()
    const merged = merge(board, true)
    merged[0].desks[0].teacher = '書き換え'
    expect(board[0][0].desks[0].teacher).toBe('山本')
  })
})

// ============================================================================
// 操作7-b: boardOnly の前提（この前提が崩れると未来週の日程表が空白になる）
//   日程表へ渡す盤面は呼び出し側の ensureWeeksCoverDateRange が未生成週をテンプレから生成する。
//   だからテンプレ再マージを外しても範囲内の日付が欠けない。ここを固定しておく。
// ============================================================================
describe('INV-01 マトリクス: boardOnly の前提 — 範囲内の日付が欠けない', () => {
  it('盤面がまだ前の週しか持たなくても、範囲の週がテンプレから生成され日程表に載る', () => {
    // 盤面は前週(7/13〜7/19)だけ。日程表の範囲(7/20〜7/26)は未生成 = 日程表を開くと初めて作られる。
    const priorWeek = buildManagedScheduleCellsForRange({
      range: { startDate: '2026-07-13', endDate: '2026-07-19', periodValue: '' },
      fallbackStartDate: '2026-07-13',
      fallbackEndDate: '2026-07-19',
      classroomSettings,
      teachers: allTeachers,
      students: allStudents,
      regularLessons,
      boardWeeks: [],
      suppressedRegularLessonOccurrences: [],
    })
    const boardWeeks = ensureWeeksCoverDateRange({
      weeks: [priorWeek],
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
      classroomSettings,
      teachers: allTeachers,
      students: allStudents,
      regularLessons,
    }).weeks

    const cells = buildScheduleCellsForRange({
      range: RANGE,
      fallbackStartDate: RANGE.startDate,
      fallbackEndDate: RANGE.endDate,
      classroomSettings,
      teachers: allTeachers,
      students: allStudents,
      regularLessons,
      boardWeeks,
      suppressedRegularLessonOccurrences: [],
      boardOnly: true,
    })

    // 開校日(月〜土。closedWeekdays=[0] なので日曜 7/26 は盤面にコマを持たない＝旧経路も同じ)。
    const datesInRange = new Set(cells.filter((cell) => cell.dateKey >= RANGE.startDate && cell.dateKey <= RANGE.endDate).map((cell) => cell.dateKey))
    for (const dateKey of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', FRI, '2026-07-25']) {
      expect(datesInRange.has(dateKey)).toBe(true)
    }
    // 範囲内の金5限に、テンプレ由来の通常授業（井上=落合 / 青木=山本）が生成時点で載っている。
    const fridayCells = cells.filter((cell) => cell.dateKey === FRI)
    expect(boardTeachersHoldingStudent(fridayCells, '井上')).toEqual(['落合'])
    expect(boardTeachersHoldingStudent(fridayCells, '青木')).toEqual(['山本'])
  })
})
