// ============================================================================
// INV-06 操作マトリクス（テンプレ差分反映のフラグを OFF へ戻したときの保留・N-1・2026-11-08）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習・振替在庫は盤面実配置と一致し、明示操作なしに増減しない。誤増も違反。
//
// N-1（spec-template-behavior §H Q33）: templateDiffApply を OFF に戻したとき、保留（2 行）の残る教室で
//   旧方式の上書き保存が下段の講習を台帳へ返さずに捨てていた（上書きの在庫返却は上段の weeks しか見ない）。
//   オーナー決定（2026-11-08・データで決まる方式）: 保留が 1 件でも残る教室はフラグ OFF でも第 2 版の経路のまま
//   （resolveTemplateDiffApplyActive）。保留 0 件になった教室だけが旧方式へ戻る（同じ画面のうちでも戻る＝意図どおり）。
// ★ここで固定すること:
//   A: フラグ OFF・保留ありでもテンプレ保存は差分反映（'diff'）へ分岐する。
//   B: そのテンプレ保存の前後で下段の講習の在庫（台帳＋盤面＋下段の配置）が変わらない。フラグだけで判定する旧経路なら −1。
//   C: 保留を解消して 0 件になった後は旧経路に戻り、その再マージで席・記録・在庫が変わらない。
// ============================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { LectureStockCountMap } from '../../types/appState'
import type { SlotCell, StudentEntry } from './types'
import { buildLectureStockKey } from './lectureStock'
import { computeStudentMove, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { stampPlacementOrigins } from './placementOrigin'
import { computeToggleDeskTeacherRest } from './teacherRest'
import {
  buildTemplatePendingDeskKey,
  buildTemplatePendingLowerScanWeeks,
  pruneTemplatePendingDesksOnOrAfter,
  resolveTemplateDiffApplyActive,
  type TemplatePendingDeskMap,
} from './templatePendingDesks'
import { resolveTemplateReportMode } from './templateDiffApply'
import * as FX from './templateTransferFollow.fixture'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

const SESSION_ID = 'session-winter'
/** 下段の講習（講習の未消化から置いた 1 コマ）。生徒 C（fixture の sC）・数学。 */
const LECTURE: StudentEntry = {
  id: 'lecture-entry-1', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数',
  lessonType: 'special', teacherType: 'normal', specialStockSource: 'session', specialSessionId: SESSION_ID,
}
const LECTURE_KEY = buildLectureStockKey('sC', '数', SESSION_ID)

type RollbackState = {
  weeks: SlotCell[][]
  pendingDesks: TemplatePendingDeskMap
  manualLectureStockCounts: LectureStockCountMap
}

/** 準備: 水 5限の机 1（鈴木＋生徒 B のテンプレ行）に保留 1 件。下段は在庫由来の講習 1 コマ。講習の台帳は残り 2。 */
function prepare(): RollbackState {
  const weeks = FX.remerge([FX.buildWeek(FX.OLD_ROWS)], FX.OLD_ROWS, [])
  const desk = FX.cellOf(weeks, FX.WED_CELL).desks[1]
  return {
    weeks,
    pendingDesks: {
      [buildTemplatePendingDeskKey(FX.WED_CELL, desk.id)]: {
        lower: { lesson: { id: 'lower-lesson-1', studentSlots: [{ ...LECTURE }, null] } },
        effectiveStartDate: FX.EFFECTIVE,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    },
    manualLectureStockCounts: { [LECTURE_KEY]: 2 },
  }
}

/** 講習の在庫の総量＝台帳の残り＋盤面（上段）の配置＋保留の下段の配置（在庫の走査の 3 本目と同じ下段の読み方）。 */
function lectureTotal(state: RollbackState, key = LECTURE_KEY) {
  const placed = [...state.weeks, ...buildTemplatePendingLowerScanWeeks(state.weeks, state.pendingDesks)]
    .flat()
    .flatMap((cell) => cell.desks)
    .flatMap((desk) => desk.lesson?.studentSlots ?? [])
    .filter((student): student is StudentEntry => Boolean(student) && student!.lessonType === 'special' && student!.specialStockSource === 'session')
    .filter((student) => buildLectureStockKey(student.managedStudentId ?? student.name, student.subject, student.specialSessionId) === key)
    .length
  return (state.manualLectureStockCounts[key] ?? 0) + placed
}

/**
 * テンプレ保存の分岐（ScheduleBoardScreen の handleTemplateSaveConfirm と同じ判定）。
 *  - 'diff'      … 差分反映（computeTemplateDiffApplyForBoard・在庫台帳は書き換えない）。
 *  - 'overwrite' … 旧方式の上書き。在庫の返却は上段（weeks）だけを走査し、保留は反映日以降を pruneTemplatePendingDesksOnOrAfter で消す
 *                  （下段は台帳へ返さない＝N-1 の穴。返却ループが weeks だけを見ることは下の字面テストで固定する）。
 *                  この盤面の上段に講習は無いので、返却は 0 件。
 */
function saveTemplate(state: RollbackState, active: boolean): RollbackState {
  if (resolveTemplateReportMode(active) === 'diff') {
    const saved = FX.save(state.weeks, FX.OLD_ROWS, [], { templatePendingDesks: state.pendingDesks })
    return { weeks: saved.nextWeeks, pendingDesks: saved.nextPendingDesks, manualLectureStockCounts: state.manualLectureStockCounts }
  }
  return {
    weeks: state.weeks,
    pendingDesks: pruneTemplatePendingDesksOnOrAfter(state.pendingDesks, state.weeks, FX.EFFECTIVE),
    manualLectureStockCounts: state.manualLectureStockCounts,
  }
}

/** 旧経路の再マージ（フラグ OFF かつ保留なしの教室＝第 2 版の規則を当てない・templateOriginRules: null）。 */
function remergeWithoutRules(weeks: SlotCell[][], rows = FX.OLD_ROWS, suppressed: string[] = []) {
  return remergeBoardWeeksWithManagedData(weeks, { classroomSettings: FX.settings(), teachers: FX.teachers, students: FX.students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29', templateOriginRules: null })
}

function projectDesks(weeks: SlotCell[][]) {
  return weeks.flat().map((cell) => ({
    id: cell.id,
    desks: cell.desks.map((desk) => ({
      teacher: desk.teacher,
      students: (desk.lesson?.studentSlots ?? []).map((student) => (student ? { id: student.managedStudentId ?? student.name, subject: student.subject, type: student.lessonType } : null)),
      statuses: (desk.statusSlots ?? []).map((entry) => (entry ? { id: entry.managedStudentId ?? entry.name, subject: entry.subject, status: entry.status } : null)),
    })),
  }))
}

describe('INV-06 × N-1: 保留のある教室はフラグ OFF でもテンプレ保存で下段の講習の在庫を変えない', () => {
  it('準備: 下段の講習は在庫の総量に数えられている（台帳 2＋下段 1）', () => {
    expect(lectureTotal(prepare())).toBe(3)
  })

  it('A: フラグ OFF・保留ありでも第 2 版（差分反映 = diff）へ分岐する', () => {
    const state = prepare()
    const active = resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: state.pendingDesks })
    expect(active).toBe(true)
    expect(resolveTemplateReportMode(active)).toBe('diff')
    // 保留なしのフラグ OFF だけが旧方式
    expect(resolveTemplateReportMode(resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: {} }))).toBe('overwrite')
    expect(resolveTemplateReportMode(resolveTemplateDiffApplyActive({ flagEnabled: true, pendingDesks: {} }))).toBe('diff')
  })

  it('B: フラグ OFF・保留ありのテンプレ保存の前後で講習の在庫は 0（フラグだけで判定する旧経路なら −1）', () => {
    const before = prepare()
    const active = resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: before.pendingDesks })
    const after = saveTemplate(before, active)
    expect(lectureTotal(after) - lectureTotal(before)).toBe(0)
    expect(after.pendingDesks).toEqual(before.pendingDesks)
    // 対照（N-1 の穴そのもの）: フラグだけで判定すると旧方式の上書きへ入り、下段の講習が台帳へ戻らず消える。
    // ★旧経路の −1 は穴の説明（saveTemplate の模型から必ず出る値）であって本体の検証ではない。回帰を止めるのは
    //   templatePendingDesks.wiring.test.ts の字面テスト（templateDiffApplyEnabled = resolveTemplateDiffApplyActive(…)）と下の字面テスト。
    const flagOnly = saveTemplate(prepare(), false)
    expect(lectureTotal(flagOnly) - lectureTotal(before)).toBe(-1)
  })

  it('C: 保留を解消して 0 件になった後は旧経路に戻り、その再マージで席・記録・在庫が変わらない', () => {
    const state = prepare()
    // 保留の解消（下段の講習を台帳へ返して保留を外した形＝「テンプレを採用」の結果と同じ会計）
    const resolved: RollbackState = { weeks: state.weeks, pendingDesks: {}, manualLectureStockCounts: { [LECTURE_KEY]: 3 } }
    expect(lectureTotal(resolved)).toBe(lectureTotal(state))
    expect(resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: resolved.pendingDesks })).toBe(false)
    // 旧経路の再マージ（第 2 版の規則なし）
    const plainRemerged = remergeWithoutRules(resolved.weeks)
    expect(projectDesks(plainRemerged)).toEqual(projectDesks(resolved.weeks))
    expect(lectureTotal({ ...resolved, weeks: plainRemerged })).toBe(lectureTotal(resolved))
  })

  // 保留 0 件で旧経路へ戻ると、第 2 版の規則（講師の休み §2-4・同じ日の移動 §1-1 #2）は再マージで当たらなくなる（2026-11-08 レビュー Important-1）。
  // いまの挙動をそのまま固定する（rollback.md A-1・featureRollout.ts の templateDiffApply のコメントに明記）。
  it('C-a: 講師の休みの机は、旧経路の再マージでテンプレの講師が机に戻る（休みの印は残り、第 2 版へ戻せばまた休みになる）', () => {
    const weeks = FX.remerge([FX.buildWeek(FX.OLD_ROWS)], FX.OLD_ROWS, [])
    const rested = computeToggleDeskTeacherRest({ weeks, weekIndex: 0, cellId: FX.WED_CELL, deskIndex: 0, resolveTeacherId: (name) => (name === '田中' ? 't1' : undefined) })
    if (rested.status === 'blocked') throw new Error('講師の休みにできない')
    const desk0 = (board: SlotCell[][]) => { const desk = FX.cellOf(board, FX.WED_CELL).desks[0]; return { teacher: desk.teacher, rest: desk.teacherRest?.teacher ?? null, students: (desk.lesson?.studentSlots ?? []).map((item) => item?.managedStudentId ?? null) } }
    expect(desk0(rested.nextWeeks)).toEqual({ teacher: '', rest: '田中', students: ['sA', null] })
    // 第 2 版の再マージでは休みのまま（対照）
    expect(desk0(FX.remerge(rested.nextWeeks, FX.OLD_ROWS, []))).toEqual({ teacher: '', rest: '田中', students: ['sA', null] })
    // 旧経路の再マージ: 講師欄にテンプレの田中が戻る。休みの印・生徒・隣の机はそのまま。
    const plain = remergeWithoutRules(rested.nextWeeks)
    expect(desk0(plain)).toEqual({ teacher: '田中', rest: '田中', students: ['sA', null] })
    expect(FX.cellOf(plain, FX.WED_CELL).desks[1].teacher).toBe('鈴木')
    // 第 2 版の経路へ戻れば、残った休みの印でまた講師なしに戻る（印は失われていない）。
    expect(desk0(FX.remerge(plain, FX.OLD_ROWS, []))).toEqual({ teacher: '', rest: '田中', students: ['sA', null] })
  })

  it('C-b: 印つきで同じ日に動かしたテンプレの授業は、旧経路の再マージでも元の時限に重ねて置かれない（INV-12）', () => {
    // 水 5限 机 0＝生徒 A・机 1＝生徒 B、水 4限 机 0＝生徒 C。生徒 A を同じ日の 4限 机 1 へ移す（第 2 版の移動＝抑止キーを積まない）。
    const rows = [...FX.OLD_ROWS, FX.row('r9', 't3', 'sC', '', 3, { slotNumber: 4 })]
    const week = FX.buildWeek(rows)
    const moving = FX.cellOf([week], `${FX.WED}_5`).desks[0].lesson!.studentSlots[0]!
    const moved = computeStudentMove({ weeks: [week], weekIndex: 0, cells: week, movingStudentId: moving.id, cellId: `${FX.WED}_4`, deskIndex: 1, studentIndex: 0, suppressedRegularLessonOccurrences: [], managedStudentByAnyName: new Map(FX.students.map((item) => [item.name, item])), resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: true })
    if (moved.status !== 'moved') throw new Error(moved.message)
    expect(moved.nextSuppressedRegularLessonOccurrences).toEqual([])
    // 盤面の確定（commitWeeks）と同じく出自の印を付ける
    const stamped = stampPlacementOrigins(moved.nextWeeks, {}).weeks
    const slotsOfA = (board: SlotCell[][]) => board.flat().filter((cell) => cell.dateKey === FX.WED)
      .flatMap((cell) => cell.desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).filter((item) => item?.managedStudentId === 'sA').map(() => cell.slotNumber)))
    const movedA = FX.cellOf(stamped, `${FX.WED}_4`).desks[1].lesson?.studentSlots[0]
    expect(movedA?.managedStudentId).toBe('sA')
    expect(movedA?.origin).toBeTruthy()
    expect(slotsOfA(stamped)).toEqual([4])
    expect(slotsOfA(FX.remerge(stamped, rows, []))).toEqual([4])
    // 旧経路の再マージでも 4限の 1 か所だけ（5限にテンプレの A が生き返らない）
    const plain = remergeWithoutRules(stamped, rows, [])
    expect(slotsOfA(plain)).toEqual([4])
    expect(projectDesks(remergeWithoutRules(plain, rows, []))).toEqual(projectDesks(plain))
  })

  it('字面: 旧方式の上書きの在庫返却は上段（weeks）だけを走査する（下段を返さない＝第 2 版の経路を保つ理由）', () => {
    const start = BOARD_TSX.indexOf('const handleSaveRegularLessonTemplate = useCallback(')
    const overwrite = BOARD_TSX.slice(start, BOARD_TSX.indexOf('useEffect(() => {', start))
    expect(overwrite).toContain('for (const week of weeks) {')
    expect(overwrite).toContain('pruneTemplatePendingDesksOnOrAfter(templatePendingDesks, weeks, effectiveStart)')
    // 上書き経路で下段も台帳へ返す完全版（N-1 の (2)）を入れると落ちる。落ちたら N-1 の記述（spec-template-behavior 第 2 段 7・rollback.md A-1）を見直す。
    expect(overwrite).not.toContain('buildTemplatePendingLowerScanWeeks')
    // テンプレ保存の分岐は resolveTemplateReportMode(templateDiffApplyEnabled) から
    expect(BOARD_TSX).toContain('const templateReportMode = resolveTemplateReportMode(templateDiffApplyEnabled)')
  })
})
