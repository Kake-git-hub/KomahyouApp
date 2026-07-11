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
