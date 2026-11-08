// ============================================================================
// 第 2 版の規則の権威関数（templateConflictRules.ts・docs/spec-template-conflict-v2.md §2-2〜§2-4・§4-2 規則 1）
//   - applyTemplateOriginRulesToManagedCell: 再マージ（フラグ ON）が差分反映と同じ生徒・講師をテンプレから外す（不動点の要）
//   - フラグ OFF の再マージ（templateOriginRules を渡さない）は従来どおり（本番 3 校の挙動は変えない）
//   - collectManualFirstBlockedLessons: §2-2 で置かれていない回を盤面の状態から導く（−1 を積まない・INV-05）
//   - 同日移動（フラグ ON）は抑止キーを積まず、写しの元の時限にテンプレを置き直さない
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { AppSnapshot, ClassroomSettings, PersistedBoardState } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, collectSameDayMovedTemplateOccurrenceKeys, computeStudentMove, computeTemplateDiffApplyForBoard, createInitialBoardSnapshot, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { parseAppSnapshot, serializeAppSnapshot } from '../../data/appSnapshotRepository'
import { assembleClassroomSnapshotPayload, splitClassroomSnapshotPayload } from '../../utils/classroomSnapshotParts'
import { applyTemplateOriginRulesToManagedCell, collectTemplateBlockersInCell, findManualTeacherDeskElsewhere, isTemplateBlockingRecordStatus, collectManualFirstBlockedLessons, resolveTemplateStudentBlock } from './templateConflictRules'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'

const DATE = '2026-10-07'
const CELL_ID = `${DATE}_5`
const student = (overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id: 's', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides })
const cellWith = (desks: SlotCell['desks']): SlotCell => ({ id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true, desks })

describe('判定の材料（§2-2〜§2-4）', () => {
  it('§2-4 の記録は休み・振無休・出席・移)。休日の表示専用の記録は入れない', () => {
    expect(['absent', 'absent-no-makeup', 'attended', 'moved'].every((status) => isTemplateBlockingRecordStatus(status as never))).toBe(true)
    expect(isTemplateBlockingRecordStatus('holiday')).toBe(false)
  })

  it('手入力の生徒（上段・保留の下段）と記録は生徒の根拠、手置き講師（上段・下段）は講師の根拠。テンプレ由来の生徒は根拠にならない', () => {
    const cell = cellWith([
      { id: 'd1', teacher: '田中', lesson: { id: 'managed_x', studentSlots: [student({ id: 't', managedStudentId: 'sT' }), null] } },
      { id: 'd2', teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand', studentSlots: [student({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } },
    ])
    const pending = { [buildTemplatePendingDeskKey(CELL_ID, 'd1')]: { lower: { lesson: { id: 'l', studentSlots: [student({ id: 'b', managedStudentId: 'sB', manualAdded: true }), null] as [StudentEntry | null, StudentEntry | null] }, teacher: { teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual' as const } }, effectiveStartDate: DATE, createdAt: 'x' } }
    const blockers = collectTemplateBlockersInCell(cell, pending)
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sA', name: '青木' }, blockers.students)).toBe('manual')
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sB', name: '馬場' }, blockers.students)).toBe('manual')
    expect(resolveTemplateStudentBlock({ managedStudentId: 'sT', name: 'テ' }, blockers.students)).toBeNull()
    expect(findManualTeacherDeskElsewhere(0, { teacher: '佐藤' }, blockers.teachers)).toBe(1)
    expect(findManualTeacherDeskElsewhere(1, { teacher: '佐藤' }, blockers.teachers)).toBe(-1)
    expect(findManualTeacherDeskElsewhere(1, { teacher: '鈴木' }, blockers.teachers)).toBe(0)
  })

  it('applyTemplateOriginRulesToManagedCell: 手入力の同じ生徒・別の机の手置き講師と同じ講師を管理セルから外す。根拠が無ければ参照ごと返す', () => {
    const managed = cellWith([
      { id: 'm1', teacher: '佐藤', lesson: { id: 'managed_r0', note: '管理データ反映', studentSlots: [student(), null] } },
      { id: 'm2', teacher: '田中', lesson: { id: 'managed_r1', note: '管理データ反映', studentSlots: [student({ id: 'c', managedStudentId: 'sC', name: '千葉' }), null] } },
    ])
    const board = cellWith([
      { id: 'd1', teacher: '' },
      { id: 'd2', teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand', studentSlots: [student({ lessonType: 'special' }), null] } },
    ])
    const ruled = applyTemplateOriginRulesToManagedCell(managed, board, {})
    expect(ruled.desks[0].lesson).toBeUndefined()
    expect(ruled.desks[0].teacher).toBe('')
    // §9-15: 机 2（index 1）の手置き 佐藤 はテンプレの机 1 にも居るので、机 2 のテンプレの講師 田中 は置かない（生徒 C は置く）。
    expect(ruled.desks[1].teacher).toBe('')
    expect(ruled.desks[1].lesson).toBe(managed.desks[1].lesson)
    expect(applyTemplateOriginRulesToManagedCell(managed, cellWith([{ id: 'd1', teacher: '' }]), {})).toBe(managed)
  })
})

describe('再マージ: フラグ ON だけ規則を当てる（OFF＝本番 3 校は従来どおり）', () => {
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }]
  const rows: RegularLessonRow[] = [{ id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 }]
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const week = buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [] })
    .map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : { ...desk, lesson: { id: 'hand', studentSlots: [student({ id: 'a_lecture', lessonType: 'special' }), null] as [StudentEntry | null, StudentEntry | null] } })) }))
  const run = (on: boolean) => remergeBoardWeeksWithManagedData([week], { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: [], todayKey: '2026-09-29', templateOriginRules: on ? { pendingDesks: {} } : null })
  const aliveA = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL_ID)!.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((item) => item?.managedStudentId === 'sA').length

  it('OFF: 手で置いた講習の A がいても、テンプレの A を空いた机に置く（従来の挙動・INV-12 の警告で知らせる）', () => {
    expect(aliveA(run(false))).toBe(2)
  })
  it('ON（§2-2）: 手入力の A が勝つ＝テンプレの A を置かない。抑止キーは要らない', () => {
    expect(aliveA(run(true))).toBe(1)
  })
})

describe('§4-2 規則 1（collectManualFirstBlockedLessons）: 置かれていない回は積まずに盤面の状態から導く（INV-05）', () => {
  const expected = [{ studentId: 'sA', subject: '数', dateKey: DATE, slotNumber: 5 }]
  const withManual = cellWith([{ id: 'd1', teacher: '田中' }, { id: 'd2', teacher: '', lesson: { id: 'hand', studentSlots: [student({ lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }])
  it('同じコマに手入力の A（上段）が居てテンプレの A が居ない回を数える。下段だけの A は「置いてある」に数えない（§9-14・差分反映は下段だけの A をテンプレの席へ上げる）', () => {
    expect(collectManualFirstBlockedLessons({ weeks: [[withManual]], expected })).toEqual(expected)
    const lowerOnly = cellWith([{ id: 'd1', teacher: '田中' }])
    const pending = { [buildTemplatePendingDeskKey(CELL_ID, 'd1')]: { lower: { lesson: { id: 'l', studentSlots: [student({ manualAdded: true }), null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: DATE, createdAt: 'x' } }
    expect(collectManualFirstBlockedLessons({ weeks: [[lowerOnly]], pendingDesks: pending, expected })).toEqual([])
  })
  it('同一性は isSameTemplateStudent: 盤面の生徒に管理生徒 ID が無い旧データは名前で突き合わせる（ID の作り方の違いで取りこぼさない）', () => {
    const legacy = cellWith([{ id: 'd2', teacher: '', lesson: { id: 'hand', studentSlots: [student({ managedStudentId: undefined, lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }])
    expect(collectManualFirstBlockedLessons({ weeks: [[legacy]], expected: [{ ...expected[0], name: '青木' }] })).toHaveLength(1)
  })
  it('数えない回: 手入力が無い・テンプレの A が置かれている・休日・削除の記録（室長が取り下げた授業・単発削除）がある', () => {
    expect(collectManualFirstBlockedLessons({ weeks: [[cellWith([{ id: 'd1', teacher: '' }])]], expected })).toEqual([])
    const both = cellWith([...withManual.desks, { id: 'd3', teacher: '', lesson: { id: 'managed_r0', studentSlots: [student({ id: 't', origin: 'template' }), null] } }])
    expect(collectManualFirstBlockedLessons({ weeks: [[both]], expected })).toEqual([])
    expect(collectManualFirstBlockedLessons({ weeks: [[{ ...withManual, isOpenDay: false }]], expected })).toEqual([])
    expect(collectManualFirstBlockedLessons({ weeks: [[withManual]], expected, suppressedRegularLessonOccurrences: [`sA__数__${DATE}__5`] })).toEqual([])
  })
})

// ============================================================================
// §1-1 #2（2026-11-05 主セッション指示）: テンプレ由来の授業を同じ日の中で動かしても、フラグ ON の教室は移動の抑止キーを積まない。
// 再マージは写しの元の時限（sameDayMoveSourceLabel）にテンプレの同じ授業を置き直さない（collectSameDayMoveSourcesByDate）。
// 既存データのキーを外すのは写しの元の時限の分だけ（同じ日の別の時限の単発削除の記録は外さない）。
// ============================================================================
describe('同日移動（フラグ ON）: 抑止キーを積まず、写しの元の時限にはテンプレを置き直さない。テンプレ反映でキーを外すのは元の時限の分だけ', () => {
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }]
  const rowAt = (id: string, slotNumber: number): RegularLessonRow => ({ id, schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber })
  // A は水曜 3 限と 5 限に数を持つ
  const rows = [rowAt('r3', 3), rowAt('r5', 5)]
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const buildWeek = () => buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [] })
  const managedStudentByAnyName = new Map(students.map((item) => [item.name, item]))
  const remerge = (weeks: SlotCell[][], suppressed: string[], on: boolean) => remergeBoardWeeksWithManagedData(weeks, { classroomSettings, teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29', templateOriginRules: on ? { pendingDesks: {} } : null })
  const aliveOnDay = (weeks: SlotCell[][]) => weeks.flat().filter((cell) => cell.dateKey === DATE).flatMap((cell) => cell.desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).filter((item) => item?.managedStudentId === 'sA').map(() => cell.slotNumber)))
  const moveFrom5To4 = (on: boolean) => {
    // 時限ごとに生徒の id を分ける（同じ生徒の 3 限と 5 限を取り違えない）
    const week = buildWeek().map((cell) => (cell.dateKey !== DATE ? cell : { ...cell, desks: cell.desks.map((desk) => (!desk.lesson ? desk : { ...desk, lesson: { ...desk.lesson, studentSlots: desk.lesson.studentSlots.map((item) => (item ? { ...item, id: `${item.id}_${cell.slotNumber}` } : null)) as [StudentEntry | null, StudentEntry | null] } })) }))
    const source = week.find((cell) => cell.id === `${DATE}_5`)!
    const moving = source.desks[0].lesson!.studentSlots[0]!
    return computeStudentMove({ weeks: [week], weekIndex: 0, cells: week, movingStudentId: moving.id, cellId: `${DATE}_4`, deskIndex: 1, studentIndex: 0, suppressedRegularLessonOccurrences: [], managedStudentByAnyName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: on })
  }

  it('フラグ ON: 同じ日の 5 限 → 4 限の移動はキーを積まず、再マージしても A は 4 限（写し）と 3 限だけ（5 限に戻らない・二重にならない）', () => {
    const moved = moveFrom5To4(true)
    if (moved.status !== 'moved') throw new Error(moved.message)
    expect(moved.nextSuppressedRegularLessonOccurrences).toEqual([])
    expect(aliveOnDay(remerge(moved.nextWeeks, [], true)).sort()).toEqual([3, 4])
  })

  it('フラグ OFF（本番 3 校）: 従来どおり移動元のキーを積む（積まないと再マージで 5 限にも戻る＝キーが要る証拠）', () => {
    const moved = moveFrom5To4(false)
    if (moved.status !== 'moved') throw new Error(moved.message)
    expect(moved.nextSuppressedRegularLessonOccurrences).toEqual([`sA__数__${DATE}__5`])
    expect(aliveOnDay(remerge(moved.nextWeeks, moved.nextSuppressedRegularLessonOccurrences, false)).sort()).toEqual([3, 4])
    expect(aliveOnDay(remerge(moved.nextWeeks, [], false)).sort()).toEqual([3, 4, 5])
  })

  it('テンプレ反映で外すキーは写しの元の時限（5 限）の分だけ。同じ日の 3 限で単発削除した記録は外さない＝写しを戻しても 3 限は復活しない', () => {
    const moved = moveFrom5To4(false)
    if (moved.status !== 'moved') throw new Error(moved.message)
    const deletion3 = `sA__数__${DATE}__3`
    const suppressed = [...moved.nextSuppressedRegularLessonOccurrences, deletion3]
    const weeks = remerge(moved.nextWeeks, suppressed, true)
    expect([...collectSameDayMovedTemplateOccurrenceKeys({ weeks, templatePendingDesks: {}, suppressedRegularLessonOccurrences: suppressed, effectiveStartDate: DATE })]).toEqual([`sA__数__${DATE}__5`])
    const saved = computeTemplateDiffApplyForBoard({ weeks, classroomSettings, teachers, students, regularLessons: rows, effectiveStartDate: DATE, suppressedRegularLessonOccurrences: suppressed, templatePendingDesks: {}, createdAt: '2026-09-29T10:00:00.000Z', manualMakeupAdjustments: {}, scheduleCountAdjustments: [] })
    expect(saved.removedSuppressedRegularLessonOccurrences).toEqual([`sA__数__${DATE}__5`])
    expect(aliveOnDay(saved.nextWeeks)).toEqual([5])
  })

  it('元の時限が読めない旧データの写しは何も外さない（削除の記録を守る側に倒す）', () => {
    const copy = student({ id: 'c', sameDayMoveSourceDate: DATE, origin: 'template' })
    const week = [[cellWith([{ id: 'd1', teacher: '', lesson: { id: 'm', studentSlots: [copy, null] } }])]]
    expect([...collectSameDayMovedTemplateOccurrenceKeys({ weeks: week, templatePendingDesks: {}, suppressedRegularLessonOccurrences: [`sA__数__${DATE}__3`], effectiveStartDate: DATE })]).toEqual([])
  })
})

// ============================================================================
// 戻し互換（2026-11-08・全教室展開した templateDiffApply をすぐ OFF に戻せるようにする準備・INV-06）
//   ON の間に盤面の生徒へ付いた出自の印（StudentEntry.origin）を、OFF の版の読み書き（JSON の書き出し/読み込み・
//   分割保存の部品の往復・読み込み createInitialBoardSnapshot の applyTemplateOriginRules: false）が消さないこと、
//   そして ON に戻した読み込みで ON のときと同じ印になることを固定する。保留の往復は Task 1（templatePendingDesks）が固定済み。
// ============================================================================
describe('戻し互換: フラグ OFF の版でも出自の印を消さない(2026-11-08)', () => {
  const students: StudentRow[] = [
    { id: 'sA', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sB', name: '生徒B', displayName: '生徒B', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sM', name: '生徒M', displayName: '生徒M', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  ]
  const teachers: TeacherRow[] = [{ id: 't1', name: '講師A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高3' }] }]
  const rows: RegularLessonRow[] = [{ id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: 'sB', subject2: '数', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 }]
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const managedWeek = buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [] })
  const studentA = (overrides: Partial<StudentEntry> = {}) => student({ id: 'a', name: '生徒A', managedStudentId: 'sA', ...overrides })
  const studentB = (overrides: Partial<StudentEntry> = {}) => student({ id: 'b', name: '生徒B', managedStudentId: 'sB', ...overrides })
  const studentM = (overrides: Partial<StudentEntry> = {}) => student({ id: 'm', name: '生徒M', managedStudentId: 'sM', ...overrides })

  // ON の間に保存された盤面: テンプレの机の 生徒A＝template、同じ机で科目を編集した 生徒B＝manual（§9-11）、
  // 机 2 に在庫から置いた振替の 生徒M＝manual。
  const onWeek = managedWeek.map((cell) => (cell.id !== CELL_ID ? cell : {
    ...cell,
    desks: cell.desks.map((desk, index) => {
      if (index === 0 && desk.lesson) return { ...desk, lesson: { ...desk.lesson, studentSlots: [studentA({ ...desk.lesson.studentSlots[0], origin: 'template' }), studentB({ ...desk.lesson.studentSlots[1], subject: '英', origin: 'manual' })] as [StudentEntry | null, StudentEntry | null] } }
      if (index === 1) return { ...desk, lesson: { id: 'hand', studentSlots: [studentM({ lessonType: 'makeup', makeupSourceDate: '2026-09-30', origin: 'manual' }), null] as [StudentEntry | null, StudentEntry | null] } }
      return desk
    }),
  }))
  const onState = { weeks: [onWeek], suppressedRegularLessonOccurrences: [] } as unknown as PersistedBoardState
  const originsAt = (weeks: SlotCell[][]) => {
    const desks = weeks.flat().find((cell) => cell.id === CELL_ID)!.desks
    return desks.map((desk) => (desk.lesson?.studentSlots ?? []).map((entry) => (entry ? `${entry.managedStudentId}:${entry.subject}:${entry.origin ?? '-'}` : null)))
  }
  const EXPECTED = [['sA:数:template', 'sB:英:manual'], ['sM:数:manual', null]]

  it('前提: ON の盤面の印はこの形', () => {
    expect(originsAt(onState.weeks)).toEqual(EXPECTED)
  })

  it('JSON の書き出し/読み込み（serializeAppSnapshot → parseAppSnapshot）で印が同じ値で残る', () => {
    const snapshot = { screen: 'board', classroomSettings, managers: [], teachers, students, regularLessons: rows, groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [], boardState: onState, schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot
    const parsed = parseAppSnapshot(serializeAppSnapshot(snapshot))
    expect(originsAt(parsed.boardState!.weeks)).toEqual(EXPECTED)
    expect(parsed.boardState!.weeks).toEqual(onState.weeks)
  })

  it('分割保存の部品の往復（splitClassroomSnapshotPayload → assembleClassroomSnapshotPayload）でも印が残る', () => {
    const split = splitClassroomSnapshotPayload({ screen: 'board', students, boardState: onState })
    const assembled = assembleClassroomSnapshotPayload({ core: split.core, board: split.board, weeks: split.weeks.map((week) => week.cells), ui: split.ui, hasBoardState: split.hasBoardState }) as { boardState: PersistedBoardState }
    expect(originsAt(assembled.boardState.weeks)).toEqual(EXPECTED)
  })

  it('OFF の版の読み込み（applyTemplateOriginRules: false）は印を消さない。もう一度 OFF で読んでも同じ', () => {
    const off = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: onState, applyTemplateOriginRules: false })
    expect(originsAt(off.weeks)).toEqual(EXPECTED)
    const offAgain = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: { ...onState, weeks: off.weeks }, applyTemplateOriginRules: false })
    expect(originsAt(offAgain.weeks)).toEqual(EXPECTED)
  })

  it('OFF で読んで保存した盤面を ON に戻して読むと、ON のまま読んだときと同じ印になる', () => {
    const onDirect = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: onState, applyTemplateOriginRules: true })
    const off = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: onState, applyTemplateOriginRules: false })
    const savedByOff = parseAppSnapshot(serializeAppSnapshot({ screen: 'board', classroomSettings, managers: [], teachers, students, regularLessons: rows, groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [], boardState: { ...onState, weeks: off.weeks }, schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot))
    const backOn = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: savedByOff.boardState, applyTemplateOriginRules: true })
    expect(originsAt(onDirect.weeks)).toEqual(EXPECTED)
    expect(originsAt(backOn.weeks)).toEqual(originsAt(onDirect.weeks))
  })
})
