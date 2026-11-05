// @vitest-environment jsdom
// ============================================================================
// 出自の印（docs/spec-template-conflict-v2.md §1-1・§5・§7・段 1・受け入れ条件 1-1〜1-6・INV-02 / INV-03）
//   1-1 置いた瞬間に印が付く（commitWeeks の推定・別日移動・科目／授業時間の手直し）
//   1-2 同じ日の中の移動はテンプレのまま・別日の移動先は手入力
//   1-3 保存・読み込み・記録を付けて外す往復で印が変わらない
//   1-4 印の無い旧データは推定で 1 回だけ付き、2 回目は何も変えない
//   1-5 手入力の生徒名・講師名・メモが盤面で青字（PDF には出ない）
//   1-6(改・§9-22 案 A) コマ表の並び替えはテンプレ由来の机も動かす（その週だけ・保留の机だけ固定）。次のテンプレ保存の直前にテンプレの並びへ戻る
// ============================================================================
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings, PersistedBoardState } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import {
  applyStudentEditDraft,
  buildManagedScheduleCellsForRange,
  buildStudentEntryFromStatus,
  buildStudentStatusEntry,
  createInitialBoardSnapshot,
  prepareStudentForMove,
} from './ScheduleBoardScreen'
import {
  inferStudentOrigin,
  MANUAL_ORIGIN_CLASS,
  resolveDeskTeacherOrigin,
  resolveMovedStudentOrigin,
  resolveStudentOrigin,
  stampPlacementOrigins,
} from './placementOrigin'
import { packSortCellDesks } from './deskSort'
import { BoardGrid } from './BoardGrid'
import { stripTemplatePendingLowerForPdf } from '../../utils/pdf'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))

const DATE = '2026-10-07'
const CELL_ID = `${DATE}_5`
const base = (overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id: 's1', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides })

describe('§7 の推定（印の無い旧データ）と印の優先', () => {
  it.each([
    ['テンプレの通常授業', {}, 'template'],
    ['同じ日の中で動かした通常授業（§1-1 #2）', { sameDayMoveSourceDate: DATE }, 'template'],
    ['在庫から置いた振替', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }, 'manual'],
    ['元の日付に置いた振替（通常＋makeupSourceDate）', { makeupSourceDate: DATE }, 'manual'],
    ['講習', { lessonType: 'special' }, 'manual'],
    ['体験', { lessonType: 'trial' }, 'manual'],
    ['増コマ', { lessonType: 'extra' }, 'manual'],
    ['手動追加の通常授業（決定 6）', { manualAdded: true }, 'manual'],
    ['編集で振替にした授業', { editedToMakeup: true }, 'manual'],
  ] as const)('%s → %s', (_label, overrides, expected) => {
    expect(inferStudentOrigin(base(overrides as Partial<StudentEntry>))).toBe(expected)
    expect(resolveStudentOrigin(base(overrides as Partial<StudentEntry>))).toBe(expected)
  })

  it('印 manual は推定（テンプレ）より勝つ。既存の手入力の印（区分・手動追加・在庫由来・編集で振替にした印）は印 template より勝つ（二重の守り・regression-reviewer 重大-2）', () => {
    expect(resolveStudentOrigin(base({ origin: 'manual' }))).toBe('manual')
    expect(resolveStudentOrigin(base({ origin: 'template' }))).toBe('template')
    expect(resolveStudentOrigin(base({ lessonType: 'makeup', makeupSourceDate: '2026-09-30', origin: 'template' }))).toBe('manual')
    expect(resolveStudentOrigin(base({ lessonType: 'extra', origin: 'template' }))).toBe('manual')
    expect(resolveStudentOrigin(base({ manualAdded: true, origin: 'template' }))).toBe('manual')
    expect(resolveStudentOrigin(base({ editedToMakeup: true, lessonType: 'makeup', origin: 'template' }))).toBe('manual')
    expect(resolveStudentOrigin(base({ editedFromRegular: { subject: '数', dateKey: DATE, slotNumber: 5 }, lessonType: 'extra', origin: 'template' }))).toBe('manual')
  })

  it('講師の出自: 手置き・入替・QR（§9-13）・操作で名前を固定した講師は手入力、足場はテンプレ、講師なし・削除記録は null', () => {
    expect(resolveDeskTeacherOrigin({ teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' })).toBe('manual')
    expect(resolveDeskTeacherOrigin({ teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual-replaced' })).toBe('manual')
    expect(resolveDeskTeacherOrigin({ teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'schedule-registration' })).toBe('manual')
    expect(resolveDeskTeacherOrigin({ teacher: '田中', manualTeacher: true })).toBe('manual')
    expect(resolveDeskTeacherOrigin({ teacher: '田中', manualTeacher: false })).toBe('template')
    expect(resolveDeskTeacherOrigin({ teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted' })).toBeNull()
  })
})

describe('1-4: stampPlacementOrigins は印の無い生徒にだけ 1 回付け、2 回目は何も変えない（参照ごと）', () => {
  const weeks: SlotCell[][] = [[{
    id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [
      { id: 'd1', teacher: '田中', lesson: { id: 'managed_x', studentSlots: [base(), base({ id: 's2', managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] } },
      { id: 'd2', teacher: '', lesson: { id: 'hand', studentSlots: [base({ id: 's3', managedStudentId: 'sC', origin: 'template' }), null] } },
    ],
  }]]
  const pending = { [`${CELL_ID}::d1`]: { lower: { lesson: { id: 'lower', studentSlots: [base({ id: 's4', managedStudentId: 'sD', manualAdded: true }), null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: DATE, createdAt: 'x' } }

  it('1 回目: 推定で付く（印のある生徒は変えない）', () => {
    const first = stampPlacementOrigins(weeks, pending)
    const desks = first.weeks[0][0].desks
    expect(desks[0].lesson?.studentSlots.map((student) => student?.origin)).toEqual(['template', 'manual'])
    expect(desks[1].lesson?.studentSlots[0]?.origin).toBe('template')
    expect(desks[1]).toBe(weeks[0][0].desks[1])
    expect(first.pendingDesks?.[`${CELL_ID}::d1`].lower.lesson?.studentSlots[0]?.origin).toBe('manual')
  })

  it('2 回目: 何も変えない（週・保留とも参照が同じ）', () => {
    const first = stampPlacementOrigins(weeks, pending)
    const second = stampPlacementOrigins(first.weeks, first.pendingDesks)
    expect(second.weeks).toBe(first.weeks)
    expect(second.pendingDesks).toBe(first.pendingDesks)
  })
})

describe('1-1・1-2: 置く経路の印', () => {
  it('同じ日の中の移動は元の印のまま（テンプレはテンプレ）。別の日へ移した先は手入力', () => {
    const template = base({ origin: 'template' })
    const sameDay = prepareStudentForMove(template, DATE, 5, DATE)
    expect(sameDay.origin).toBe('template')
    expect(sameDay.sameDayMoveSourceDate).toBe(DATE)
    const otherDay = prepareStudentForMove(template, DATE, 5, '2026-10-08')
    expect(otherDay.origin).toBe('manual')
    expect(otherDay.lessonType).toBe('makeup')
    // 印の無い旧データは推定に任せる（項目を足さない）。別日の移動先は推定でも手入力。
    const legacy = prepareStudentForMove(base(), DATE, 5, '2026-10-08')
    expect(legacy).not.toHaveProperty('origin')
    expect(resolveStudentOrigin(legacy)).toBe('manual')
    expect(resolveMovedStudentOrigin({ origin: 'manual' }, DATE, DATE)).toBe('manual')
  })

  it('§9-11: テンプレの授業の科目・授業時間・区分を「編集」で変えると手入力（フラグ ON）。科目も時間も区分も同じまま確定しても印は変わらない', () => {
    const on = { stampOrigin: true }
    const template = base({ origin: 'template' })
    expect(applyStudentEditDraft(template, { subject: '英', lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, on).origin).toBe('manual')
    expect(applyStudentEditDraft(template, { subject: '数', lessonType: 'regular', teacherType: 'normal', noteSuffix: '60' }, on).origin).toBe('manual')
    expect(applyStudentEditDraft(template, { subject: '数', lessonType: 'makeup', teacherType: 'normal', noteSuffix: '' }, on).origin).toBe('manual')
    expect(applyStudentEditDraft(template, { subject: '数', lessonType: 'extra', teacherType: 'normal', noteSuffix: '' }, on).origin).toBe('manual')
    expect(applyStudentEditDraft(template, { subject: '数', lessonType: 'regular', teacherType: 'substitute', noteSuffix: '' }, on).origin).toBe('template')
    // 何も変えずに確定（授業時間は両側を同じ正規化で比べる: 未設定と '' と 90 分扱いは同じ）
    expect(applyStudentEditDraft(base({ origin: 'template', noteSuffix: undefined }), { subject: '数', lessonType: 'regular', teacherType: 'normal', noteSuffix: '' }, on).origin).toBe('template')
    expect(applyStudentEditDraft(base({ origin: 'template', noteSuffix: '60' }), { subject: '数', lessonType: 'regular', teacherType: 'normal', noteSuffix: '60' }, on).origin).toBe('template')
  })

  it('要修正 A: フラグ OFF（本番 3 校）の「編集」は印を付けない（保存データに origin を入れない）', () => {
    expect(applyStudentEditDraft(base(), { subject: '英', lessonType: 'makeup', teacherType: 'normal', noteSuffix: '60' })).not.toHaveProperty('origin')
    expect(applyStudentEditDraft(base(), { subject: '英', lessonType: 'makeup', teacherType: 'normal', noteSuffix: '60' }, { stampOrigin: false })).not.toHaveProperty('origin')
  })

  it('1-3: 記録を付けて外す（休み → 解除）往復で生徒の印が戻る', () => {
    const cell: SlotCell = { id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true, desks: [] }
    const desk: DeskCell = { id: 'd1', teacher: '田中', lesson: { id: 'hand', studentSlots: [base({ origin: 'manual' }), null] } }
    const record = buildStudentStatusEntry(desk.lesson!.studentSlots[0]!, cell, desk, 'absent')
    expect(record.origin).toBe('manual')
    expect(buildStudentEntryFromStatus(record).origin).toBe('manual')
    const legacyRecord = buildStudentStatusEntry(base(), cell, desk, 'absent')
    expect(legacyRecord).not.toHaveProperty('origin')
  })

  it('1-1 配線: コマ表の確定（commitWeeks）はフラグ ON の教室だけ印を付け、読み込みも同じ（OFF は保存の形を変えない）', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    const commit = source.slice(source.indexOf('  const commitWeeks = ('), source.indexOf('    // 操作痕跡(2026-09-04)'))
    expect(commit).toContain('if (templateDiffApplyEnabled) {\n      const stamped = stampPlacementOrigins(nextWeeks, nextTemplatePendingDesks)')
    expect(source).toContain('createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons, initialBoardState, applyTemplateOriginRules: templateDiffApplyEnabled })')
  })
})

describe('1-4: 読み込み（createInitialBoardSnapshot）はフラグ ON の教室だけ印を付け、2 回目の読み込みで変わらない', () => {
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }, { id: 'sM', name: '三浦', displayName: '三浦', email: 'm@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }]
  const rows: RegularLessonRow[] = [{ id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 }]
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const week = buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: rows, boardWeeks: [] })
    .map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, lesson: { id: 'hand', studentSlots: [base({ id: 'm1', name: '三浦', managedStudentId: 'sM', lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] as [StudentEntry | null, StudentEntry | null] } } : desk)) }))
  const state = { weeks: [week], suppressedRegularLessonOccurrences: [] } as unknown as PersistedBoardState

  it('ON: テンプレの A＝template・振替の M＝manual。保存して読み直しても同じ', () => {
    const first = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: state, applyTemplateOriginRules: true })
    const desks = first.weeks.flat().find((cell) => cell.id === CELL_ID)!.desks
    expect(desks[0].lesson?.studentSlots[0]?.origin).toBe('template')
    expect(desks[1].lesson?.studentSlots[0]?.origin).toBe('manual')
    const second = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: { ...state, weeks: first.weeks }, applyTemplateOriginRules: true })
    expect(second.weeks).toEqual(first.weeks)
  })

  it('OFF（本番 3 校）: 印を付けない（読み込みの結果は従来と同じ）', () => {
    const off = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: rows, initialBoardState: state })
    const desks = off.weeks.flat().find((cell) => cell.id === CELL_ID)!.desks
    expect(desks[0].lesson?.studentSlots[0]).not.toHaveProperty('origin')
    expect(desks[1].lesson?.studentSlots[0]).not.toHaveProperty('origin')
  })
})

describe('1-6(改・§9-22 案 A・オーナー決定 2026-11-06): コマ表の並び替えはテンプレ由来の机も動かす（その週だけ）', () => {
  const cell: SlotCell = {
    id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [
      { id: `${CELL_ID}_desk_1`, teacher: '' },
      { id: `${CELL_ID}_desk_2`, teacher: '田中', lesson: { id: 'managed_a', studentSlots: [base({ origin: 'template' }), null] } },
      { id: `${CELL_ID}_desk_3`, teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand', studentSlots: [base({ id: 'm', managedStudentId: 'sM', lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), base({ id: 'n', managedStudentId: 'sN', lessonType: 'special' })] } },
    ],
  }
  it('詰めて並び替え: 固定しなければテンプレの机も手入力の机も上に詰まる（テンプレの机 2 は机 2 に居座らない）', () => {
    const sorted = packSortCellDesks(cell)
    expect(sorted.map((desk) => desk.teacher)).toEqual(['佐藤', '田中', ''])
    expect(sorted[0].lesson?.id).toBe('hand')
    expect(sorted[1].lesson?.id).toBe('managed_a')
  })
  const source = () => readFileSync(path.resolve(process.cwd(), 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
  it('配線: 盤面の並び替え（handleBoardSort）が固定するのは保留の机だけ（テンプレ由来の机は固定しない・フラグ ON/OFF とも同じ）', () => {
    const text = source()
    const sort = text.slice(text.indexOf('  const handleBoardSort = (mode: BoardSortMode) => {'), text.indexOf('  const handleApplySortMode = (mode: BoardSortMode) => {'))
    expect(sort.length).toBeGreaterThan(200)
    expect(sort).toContain('const resolveLockedDeskIds = (cellId: string) => collectTemplatePendingDeskIdsInCell(activeTemplatePendingDesks, cellId)')
    expect(sort).not.toContain('templateDiffApplyEnabled')
    expect(sort).not.toContain('collectTemplateOriginDeskIds')
  })
  it('配線: テンプレ保存の差分反映（runTemplateDiffApplyV2）は突き合わせる前に restoreTemplateDeskOrderForDiff で並びを戻し、戻した週を computeTemplateDiffApply に渡す（基準は保存前の行）', () => {
    const text = source()
    const run = text.slice(text.indexOf('function runTemplateDiffApplyV2('), text.indexOf('export function restoreTemplateDeskOrderForDiff('))
    expect(run).toContain('const weeks = restoreTemplateDeskOrderForDiff({')
    expect(run).toContain('buildTemplateDiffTemplateCells({ ...params, regularLessons: [...params.previousRegularLessons]')
    expect(run).toContain('anchorCells })')
    expect(run).toMatch(/computeTemplateDiffApply\(\{\s+weeks,/)
    expect(run).toContain('buildTemplateTeacherRestPredicate(weeks, teacherAliases)')
    const restore = text.slice(text.indexOf('export function restoreTemplateDeskOrderForDiff('), text.indexOf('export function collectSameDayMovedTemplateOccurrenceKeys('))
    expect(restore).toContain('restoreTemplateDeskOrder(cell, anchor.raw.desks')
    expect(restore).toContain('lockedDeskIds: collectTemplatePendingDeskIdsInCell(params.templatePendingDesks, cell.id)')
  })
})

describe('1-5: 手入力の生徒名・講師名・メモは盤面で青字（PDF には出ない）', () => {
  const cell: SlotCell = {
    id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: [
      { id: 'd1', teacher: '田中', lesson: { id: 'managed_a', studentSlots: [base({ name: 'テンプレ生徒', origin: 'template' }), base({ id: 'm', name: '振替生徒', managedStudentId: 'sM', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] } },
      { id: 'd2', teacher: '手置き講師', manualTeacher: true, teacherAssignmentSource: 'manual', memoSlots: ['手入力メモ', null] },
    ],
  }
  const render = (showManualOriginColor: boolean) => renderToStaticMarkup(createElement(BoardGrid, {
    cells: [cell], selectedStudentId: null, highlightedCell: null, highlightedHolidayDate: null, yearLabel: '2026', specialPeriods: [],
    resolveStudentDisplayName: (name: string) => name, resolveStudentGradeLabel: (_name: string, grade: string) => grade,
    resolveDisplayedLessonType: (_name: string, _subject: string, lessonType) => lessonType,
    onDayHeaderClick: () => {}, onTeacherClick: () => {}, onStudentClick: () => {}, showManualOriginColor,
  }))
  const blueTexts = (html: string) => {
    const container = document.createElement('div')
    container.innerHTML = html
    return { container, texts: [...container.querySelectorAll(`.${MANUAL_ORIGIN_CLASS}`)].map((node) => node.textContent ?? '') }
  }
  it('ON: 振替の生徒・手置き講師・メモが青字。テンプレの生徒・テンプレの講師は青くしない', () => {
    const { texts } = blueTexts(render(true))
    expect(texts).toContain('振替生徒')
    expect(texts).toContain('手置き講師')
    expect(texts).toContain('手入力メモ')
    expect(texts).not.toContain('テンプレ生徒')
    expect(texts).not.toContain('田中')
  })
  it('OFF（フラグ OFF・テンプレ編集）: 青字にしない', () => {
    expect(blueTexts(render(false)).texts).toEqual([])
  })
  it('盤面 PDF は青字のクラスを外す（INV-13・盤面画面だけの印）', () => {
    const { container } = blueTexts(render(true))
    stripTemplatePendingLowerForPdf(container)
    expect(container.querySelectorAll(`.${MANUAL_ORIGIN_CLASS}`)).toHaveLength(0)
    expect(container.textContent).toContain('振替生徒')
  })
})
