// テンプレ差分反映の保留（2 行）と「他の処理・操作」の回帰防止テスト（Issue #72・第 1 段 (C)・
// docs/spec-template-behavior.md §H Q31・Q32-3・受け入れ条件 22 の後半）。
//
// 固定すること:
//   - 講師だけの机の詰め直し（repackTeacherOnlyDesks）・講習の講師自動割当（applyTeacherAutoAssignRequest）：保留の机は「埋まっている」
//     とみなし、講師を抜かない・講師を置かない（保留マップのキーは机 ID なので、講師が動くと下段が別の講師の下へずれる）。
//   - QR 提出講師の起動時自己修復（reconcileSubmittedTeacherPlacements）：保留の机に残した QR 講師は配置済み（置き直さない・二重にしない＝
//     INV-02 の 2026-08-02／09-14 と同型を防ぐ）。未配置の講師も保留の机には置かない。
//   - ユーザーの詰め替え（packSortCellDesks）・同席番並べ替え（seatSortCells）：保留の机は位置・机 ID・中身を固定し、他の机だけ並べ替える。
//   - 退塾スイープ：下段の生徒・記録も消す（在庫は戻さず抑止を積む＝INV-06 の退塾スイープ規則）。下段にしか居ない生徒も拾う。
//   - 保護者からの休み連絡の自動処理：上段に居れば従来どおり、下段にしか居なければ自動処理しない（pending-lower-only）。
//   - 下段の移動の出席不可コマ確認の対象・保存前レポートの見出し（Q32-3）。
//   - いずれも保留マップを渡さない（＝機能フラグ templateDiffApply OFF の教室）ときは従来どおり。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  applyStudentWithdrawSweepToBoard,
  applyTeacherAutoAssignRequest,
  buildManagedScheduleCellsForRange,
  collectPendingLowerMoveLandingPlacements,
  computeStudentWithdrawSweep,
  computeTemplateDiffApplyForBoard,
  reconcileSubmittedTeacherPlacements,
  repackTeacherOnlyDesks,
} from './ScheduleBoardScreen'
import { packSortCellDesks, seatSortCells } from './deskSort'
import { buildTemplatePendingDeskKey, collectTemplatePendingDeskIdsInCell, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'
import { collectStudentWithdrawSweepTargets } from './studentWithdrawSweep'
import { PARENT_ABSENCE_TARGET_PENDING_LOWER_MESSAGE, resolveParentAbsenceTarget } from './parentAbsenceTarget'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))
const { buildOverwriteReportHtml, resolveTemplateOverwriteReportLabels } = await import('../../utils/pdf')

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

function sliceBody(source: string, start: string, length: number) {
  const index = source.indexOf(start)
  expect(index, start).toBeGreaterThanOrEqual(0)
  return source.slice(index, index + length)
}

// ─────────────────────────────────────────────────────────────────────────────
// フィクスチャ（templatePendingResolution.test.ts と同じ形：水曜 5 限・机 3 つ・反映日 2026-10-07）
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const EFFECTIVE = '2026-10-07'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`

function studentRow(id: string, name: string, extra: Partial<StudentRow> = {}): StudentRow {
  return { id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...extra }
}

function teacherRow(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

const students = [studentRow('sA', '青木'), studentRow('sB', '馬場'), studentRow('sC', '千葉'), studentRow('sD', '土屋'), studentRow('sM', '三浦')]
const teachers = [teacherRow('t1', '田中'), teacherRow('t2', '鈴木'), teacherRow('t3', '佐藤')]

function row(id: string, teacherId: string, student1Id = '', subject1 = '', dayOfWeek = 3, slotNumber = SLOT): RegularLessonRow {
  return {
    id, schoolYear: 2026, teacherId, student1Id, subject1, startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek, slotNumber,
  }
}

function settings(extra: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, templateFreezeBeforeDate: EFFECTIVE, ...extra } as ClassroomSettings
}

const OLD_ROWS = [row('r0', 't1', 'sA', '数'), row('r1', 't2', 'sB', '数'), row('r2', 't3')]
const NEW_ROWS = [row('r0', 't2', 'sC', '数'), row('r1', 't1', 'sB', '数'), row('r2', 't3')]

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

function applyDiff(week: SlotCell[], newRows: RegularLessonRow[] = NEW_ROWS) {
  return computeTemplateDiffApplyForBoard({
    weeks: [week],
    classroomSettings: settings(),
    teachers,
    students,
    regularLessons: newRows,
    effectiveStartDate: EFFECTIVE,
    suppressedRegularLessonOccurrences: [],
    templatePendingDesks: {},
    createdAt: '2026-09-29T10:00:00.000Z',
  })
}

// 机0 に在庫由来の振替 M（下段になる）・移動元の記録・メモ。机0 の講師は QR 自動割振り（田中・講習 ss1）。新テンプレは机0 に C（鈴木）。
function pendingWithQrTeacher() {
  let week = buildWeek(OLD_ROWS)
  week = mutateDesk(week, 0, (desk) => ({
    ...desk,
    teacher: '田中',
    manualTeacher: true,
    teacherAssignmentSource: 'schedule-registration',
    teacherAssignmentSessionId: 'ss1',
    teacherAssignmentTeacherId: 't1',
    lesson: { id: `${desk.id}_makeup`, studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30', makeupSourceLabel: '9/30(水) 5限' }), null] },
    statusSlots: [null, status('sD', 'moved')],
    memoSlots: [null, '持ち物'],
  }))
  const diff = applyDiff(week)
  const deskId = cellOf(diff.nextWeeks).desks[0].id
  const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
  expect(diff.nextPendingDesks[key]).toBeDefined()
  return { diff, deskId, key }
}

function session(teacherIds: string[], range = { startDate: DATE, endDate: DATE }): SpecialSessionRow {
  return {
    id: 'ss1',
    label: '秋期講習',
    ...range,
    teacherInputs: Object.fromEntries(teacherIds.map((id) => [id, { unavailableSlots: [], countSubmitted: true, updatedAt: '' }])),
    studentInputs: {},
    createdAt: '',
    updatedAt: '',
  } as SpecialSessionRow
}

// 盤面で「上段が空いたまま 1 行へ戻せない」保留の机（例: 上段を削除したが下段のメモが枠を超える）を模した 1 コマ。
// 机1 = 保留の机（上段の生徒なし・講師は QR でない手置き）・机2 = 講師だけ・机3 = 空。
function stuckPendingCell(): { cell: SlotCell; map: TemplatePendingDeskMap } {
  const cell: SlotCell = {
    id: CELL_ID,
    dateKey: DATE,
    dayLabel: '水',
    dateLabel: '10/7',
    slotLabel: '5限',
    slotNumber: SLOT,
    timeLabel: '',
    isOpenDay: true,
    desks: [
      { id: `${CELL_ID}_desk_1`, teacher: '', memoSlots: ['上段のメモ', '上段のメモ2'] },
      { id: `${CELL_ID}_desk_2`, teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual' },
      { id: `${CELL_ID}_desk_3`, teacher: '' },
    ],
  }
  const map: TemplatePendingDeskMap = {
    [buildTemplatePendingDeskKey(CELL_ID, `${CELL_ID}_desk_1`)]: {
      lower: { lesson: { id: 'lower', studentSlots: [entry('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] }, memoSlots: ['下段のメモ', null] },
      effectiveStartDate: EFFECTIVE,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
  }
  return { cell, map }
}

// ─────────────────────────────────────────────────────────────────────────────
// 講師だけの机の詰め直し・講習の講師自動割当（Q31 行 2・条件 22）
// ─────────────────────────────────────────────────────────────────────────────

describe('講師だけの机の詰め直し（repackTeacherOnlyDesks）: 保留の机は動かさない・上書きしない（Q31）', () => {
  it('保留の机（上段が空いていても）は講師の入れ先にならず、机に居る講師も抜かれない', () => {
    const { cell, map } = stuckPendingCell()
    const lockedDeskIds = collectTemplatePendingDeskIdsInCell(map, CELL_ID)
    expect(lockedDeskIds).toEqual(new Set([`${CELL_ID}_desk_1`]))
    const repacked = repackTeacherOnlyDesks(cell.desks, lockedDeskIds)
    // 保留の机（机1）は元のまま（講師を詰め込まれない）。講師だけの机（鈴木）は保留の机を飛ばして次の空き机へ詰まる。
    expect(repacked[0]).toBe(cell.desks[0])
    expect(repacked[0].teacher).toBe('')
    expect(repacked.map((desk) => desk.teacher)).toEqual(['', '鈴木', ''])
  })

  it('保留の机に居る講師（上段が空いた机）も抜かれない', () => {
    const { cell, map } = stuckPendingCell()
    const withTeacher = { ...cell, desks: [{ ...cell.desks[0], teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual' as const }, { ...cell.desks[1], teacher: '' }, cell.desks[2]] }
    // 机の順: 机1=保留（佐藤）・机2=空・机3=空。保留でなければ佐藤は机1 のまま（先頭）なので、並びを入れ替えて確かめる。
    const reordered = [withTeacher.desks[1], withTeacher.desks[0], withTeacher.desks[2]]
    const repacked = repackTeacherOnlyDesks(reordered, collectTemplatePendingDeskIdsInCell(map, CELL_ID))
    expect(repacked[1]).toBe(reordered[1])
    expect(repacked.map((desk) => desk.teacher)).toEqual(['', '佐藤', ''])
    // 回帰の確認: 固定しない（フラグ OFF と同じ）と、保留の机の講師が先頭の机へ詰められて下段と講師がずれる。
    expect(repackTeacherOnlyDesks(reordered).map((desk) => desk.teacher)).toEqual(['佐藤', '', ''])
  })

  it('固定する机が無い（省略・保留の無いコマ）なら従来と同じ結果', () => {
    const { cell } = stuckPendingCell()
    expect(repackTeacherOnlyDesks(cell.desks, undefined)).toEqual(repackTeacherOnlyDesks(cell.desks))
    expect(repackTeacherOnlyDesks(cell.desks, new Set())).toEqual(repackTeacherOnlyDesks(cell.desks))
  })
})

describe('講習の講師自動割当（applyTeacherAutoAssignRequest）: 保留の机は空き机に数えない（Q31）', () => {
  const teacherSato = teacherRow('t3', '佐藤')

  it('空き机が保留の机だけなら置かずにスキップする（保留マップを渡さないと保留の机に置いてしまう＝回帰の確認）', () => {
    const { cell, map } = stuckPendingCell()
    // 机3 も埋めて、空いているのは保留の机（机1）だけにする。
    const weeks = [[{ ...cell, desks: [cell.desks[0], cell.desks[1], { ...cell.desks[2], teacher: '田中', lesson: { id: 'x', studentSlots: [entry('sA'), null] as [StudentEntry | null, StudentEntry | null] } }] }]]
    const params = {
      weeks,
      items: [{ sessionId: 'ss1', teacherId: 't3', mode: 'assign' as const }],
      specialSessions: [session(['t3'])],
      teachers: [teacherSato],
      students,
      regularLessons: [],
      classroomSettings: settings(),
    }
    const locked = applyTeacherAutoAssignRequest({ ...params, templatePendingDesks: map })
    const lockedCell = cellOf(locked.nextWeeks)
    expect(lockedCell.desks[0].teacher).toBe('')
    expect(lockedCell.desks.some((desk) => desk.teacher === '佐藤')).toBe(false)
    expect(locked.hasChanges).toBe(false)
    expect(locked.messages.join('')).toContain('自動登録対象はありませんでした')

    const unlocked = applyTeacherAutoAssignRequest(params)
    expect(cellOf(unlocked.nextWeeks).desks[0].teacher).toBe('佐藤')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// QR 提出講師の起動時自己修復（Q31 行 3・条件 22 の後半・INV-02）
// ─────────────────────────────────────────────────────────────────────────────

describe('QR 提出講師の起動時自己修復（reconcileSubmittedTeacherPlacements）: 保留の机の QR 講師は配置済み（Q31・Q21-9）', () => {
  it('差分反映で保留になった机の QR 講師は机に残り、自己修復を何回通しても別の机へ置き直されない（講師が 2 か所に出ない）', () => {
    const { diff, key } = pendingWithQrTeacher()
    const pendingDesk = cellOf(diff.nextWeeks).desks[0]
    // Q21-9 末尾: 机の講師は QR 講師のまま・下段に講師は入らない。
    expect(pendingDesk.teacher).toBe('田中')
    expect(pendingDesk.teacherAssignmentSource).toBe('schedule-registration')
    expect(diff.nextPendingDesks[key].lower).not.toHaveProperty('teacher')
    const params = { specialSessions: [session(['t1'])], teachers, students, regularLessons: NEW_ROWS, classroomSettings: settings(), templatePendingDesks: diff.nextPendingDesks }
    const first = reconcileSubmittedTeacherPlacements({ weeks: diff.nextWeeks, ...params })
    expect(first.hasChanges).toBe(false)
    expect(first.placedCount).toBe(0)
    const second = reconcileSubmittedTeacherPlacements({ weeks: first.nextWeeks, ...params })
    expect(second.hasChanges).toBe(false)
    expect(second.nextWeeks).toEqual(diff.nextWeeks)
    // QR の登録机（講習 ss1・田中）は保留の机の 1 か所だけ（机 2 の田中はテンプレの通常授業の机）。
    const qrDesks = second.nextWeeks.flat().flatMap((cell) => cell.desks).filter((desk) => desk.teacherAssignmentSource === 'schedule-registration' && desk.teacherAssignmentTeacherId === 't1')
    expect(qrDesks.map((desk) => desk.id)).toEqual([pendingDesk.id])
  })

  it('未配置の提出講師を置き直すときも、上段の空いた保留の机は置き先にしない（渡さないと置いてしまう＝回帰の確認）', () => {
    const { cell, map } = stuckPendingCell()
    const weeks = [[{ ...cell, desks: [cell.desks[0], cell.desks[1], { ...cell.desks[2], teacher: '田中', lesson: { id: 'x', studentSlots: [entry('sA'), null] as [StudentEntry | null, StudentEntry | null] } }] }]]
    const params = { specialSessions: [session(['t3'])], teachers: [teacherRow('t3', '佐藤')], students, regularLessons: [], classroomSettings: settings() }
    const locked = reconcileSubmittedTeacherPlacements({ weeks, ...params, templatePendingDesks: map })
    expect(locked.placedCount).toBe(0)
    expect(cellOf(locked.nextWeeks).desks[0].teacher).toBe('')
    const unlocked = reconcileSubmittedTeacherPlacements({ weeks, ...params })
    expect(unlocked.placedCount).toBe(1)
    expect(cellOf(unlocked.nextWeeks).desks[0].teacher).toBe('佐藤')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ユーザーの詰め替え・同席番並べ替え（Q31 行 4）
// ─────────────────────────────────────────────────────────────────────────────

function sortCell(id: string, dateKey: string, desks: DeskCell[]): SlotCell {
  return { id, dateKey, dayLabel: '水', dateLabel: '', slotLabel: '', slotNumber: Number(id.split('_')[1]), timeLabel: '', isOpenDay: true, desks }
}

function lessonOf(studentId: string): DeskCell['lesson'] {
  return { id: `l_${studentId}`, studentSlots: [entry(studentId), null] }
}

describe('詰め替え（packSortCellDesks）・同席番並べ替え（seatSortCells）: 保留の机は位置・机 ID・中身を固定（Q31）', () => {
  it('詰め替え: 保留の机はその位置・その ID のまま（中身も正規化しない）。他の机だけが残りの位置へ詰まる', () => {
    const cellId = `${DATE}_5`
    const pendingDesk: DeskCell = { id: `${cellId}_desk_3`, teacher: '鈴木', lesson: { id: 'p', studentSlots: [null, entry('sC')] } }
    const cell = sortCell(cellId, DATE, [
      { id: `${cellId}_desk_1`, teacher: '' },
      { id: `${cellId}_desk_2`, teacher: '田中' },
      pendingDesk,
    ])
    const packed = packSortCellDesks(cell, { skipStatusSlotPack: true, lockedDeskIds: new Set([pendingDesk.id]) })
    expect(packed[2]).toBe(pendingDesk)
    expect(packed.map((desk) => desk.id)).toEqual([`${cellId}_desk_1`, `${cellId}_desk_2`, `${cellId}_desk_3`])
    expect(packed.map((desk) => desk.teacher)).toEqual(['田中', '', '鈴木'])
    // 回帰の確認: 固定しない（フラグ OFF と同じ）と、保留の机が先頭へ動き ID が付け替わって保留マップのキーとずれる。
    const unlocked = packSortCellDesks(cell, { skipStatusSlotPack: true })
    expect(unlocked[0].teacher).toBe('鈴木')
    expect(unlocked[0].id).toBe(`${cellId}_desk_1`)
  })

  it('詰め替え: 固定した机の ID が位置どおりでない（旧データ）ときは、他の机も元の ID のまま（同じ ID を 2 つ作らない）', () => {
    const cellId = `${DATE}_5`
    const pendingDesk: DeskCell = { id: `${cellId}_desk_1`, teacher: '鈴木', lesson: lessonOf('sC') }
    const cell = sortCell(cellId, DATE, [
      { id: `${cellId}_desk_2`, teacher: '' },
      pendingDesk,
      { id: `${cellId}_desk_3`, teacher: '田中', lesson: lessonOf('sB') },
    ])
    const packed = packSortCellDesks(cell, { lockedDeskIds: new Set([pendingDesk.id]) })
    expect(packed[1]).toBe(pendingDesk)
    const ids = packed.map((desk) => desk.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同席番並べ替え: 保留の机は今の席・今の ID のまま。他の講師は保留の机の席を避けて同席番に揃う', () => {
    const cell1 = sortCell(`${DATE}_4`, DATE, [
      { id: `${DATE}_4_desk_1`, teacher: '馬場先生', lesson: lessonOf('sB') },
      { id: `${DATE}_4_desk_2`, teacher: '青木先生', lesson: lessonOf('sA') },
    ])
    const cell2 = sortCell(`${DATE}_5`, DATE, [
      { id: `${DATE}_5_desk_1`, teacher: '青木先生', lesson: lessonOf('sC') },
      { id: `${DATE}_5_desk_2`, teacher: '馬場先生', lesson: lessonOf('sD') },
    ])
    const pendingId = `${DATE}_4_desk_2`
    const locked = seatSortCells([cell1, cell2], { skipStatusSlotPack: true, resolveLockedDeskIds: (cellId) => (cellId === cell1.id ? new Set([pendingId]) : undefined) })
    expect(locked[0].desks[1]).toBe(cell1.desks[1])
    expect(locked[0].desks.map((desk) => desk.teacher)).toEqual(['馬場先生', '青木先生'])
    expect(locked[0].desks.map((desk) => desk.id)).toEqual([`${DATE}_4_desk_1`, pendingId])
    // 回帰の確認: 固定しないと、青木先生（五十音で先）が席 1 に揃えられ、保留の机が先頭へ動いて ID が付け替わる。
    const unlocked = seatSortCells([cell1, cell2], { skipStatusSlotPack: true })
    expect(unlocked[0].desks[0].teacher).toBe('青木先生')
    expect(unlocked[0].desks[0].id).toBe(`${DATE}_4_desk_1`)
  })

  it('固定しない（省略）なら従来と同じ結果', () => {
    const cellId = `${DATE}_5`
    const cell = sortCell(cellId, DATE, [{ id: `${cellId}_desk_1`, teacher: '' }, { id: `${cellId}_desk_2`, teacher: '田中', lesson: lessonOf('sB') }])
    expect(packSortCellDesks(cell, { lockedDeskIds: new Set() })).toEqual(packSortCellDesks(cell))
    expect(seatSortCells([cell], { resolveLockedDeskIds: () => undefined })).toEqual(seatSortCells([cell]))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 退塾スイープ（Q31 行 6・INV-06）
// ─────────────────────────────────────────────────────────────────────────────

describe('退塾スイープ: 保留の下段の生徒・記録も消す（在庫は戻さず抑止を積む・Q31）', () => {
  const withdrawn = students.map((student) => (student.id === 'sM' ? { ...student, withdrawDate: '2026-10-01' } : student))
  const resolveStockId = (student: StudentEntry) => student.managedStudentId ?? student.name

  it('下段にしか居ない退塾生徒も検出する（保留マップを渡さないと拾えない＝回帰の確認）', () => {
    const { diff } = pendingWithQrTeacher()
    expect(collectStudentWithdrawSweepTargets({ weeks: diff.nextWeeks, students: withdrawn, todayKey: '2026-10-02', templatePendingDesks: diff.nextPendingDesks }).map((target) => target.studentId)).toEqual(['sM'])
    expect(collectStudentWithdrawSweepTargets({ weeks: diff.nextWeeks, students: withdrawn, todayKey: '2026-10-02' })).toEqual([])
  })

  it('下段の振替を消し、振替元日を抑止へ積む（未消化へ戻さない）。下段に生きている生徒がいなくなった机は確定の中で 1 行へ戻る', () => {
    const { diff, key } = pendingWithQrTeacher()
    const sweep = computeStudentWithdrawSweep({
      weeks: diff.nextWeeks,
      students: withdrawn,
      studentId: 'sM',
      fromDateKey: '2026-10-02',
      suppressedMakeupOrigins: {},
      resolveStockId,
      templatePendingDesks: diff.nextPendingDesks,
    })
    expect(sweep.changed).toBe(true)
    expect(sweep.removedSeatCount).toBe(1)
    expect(sweep.nextWeeks[0]).toBe(diff.nextWeeks[0])
    expect(sweep.nextTemplatePendingDesks![key].lower.lesson).toBeUndefined()
    expect(sweep.nextSuppressedMakeupOrigins).toEqual({ 'sM__数': [{ dateKey: '2026-09-30' }] })
    // 入力の保留マップは変えない。
    expect(diff.nextPendingDesks[key].lower.lesson).toBeDefined()
    const settled = settleTemplatePendingDesksAfterCommit({
      previousWeeks: diff.nextWeeks,
      previousTemplatePendingDesks: diff.nextPendingDesks,
      weeks: sweep.nextWeeks,
      templatePendingDesks: sweep.nextTemplatePendingDesks!,
    })
    expect(settled.collapsedKeys).toEqual([key])
    expect(settled.nextTemplatePendingDesks[key]).toBeUndefined()
    const desk = cellOf(settled.nextWeeks).desks[0]
    expect((desk.lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)).toEqual(['sC'])
    expect(desk.memoSlots).toContain('持ち物')
  })

  it('消去開始日より前の保留は触らない。保留マップを渡さなければ従来どおり（保留マップの項目を返さない）', () => {
    const { diff } = pendingWithQrTeacher()
    const later = computeStudentWithdrawSweep({ weeks: diff.nextWeeks, students: withdrawn, studentId: 'sM', fromDateKey: '2026-10-08', suppressedMakeupOrigins: {}, resolveStockId, templatePendingDesks: diff.nextPendingDesks })
    expect(later.changed).toBe(false)
    expect(later.nextTemplatePendingDesks).toBe(diff.nextPendingDesks)
    const off = computeStudentWithdrawSweep({ weeks: diff.nextWeeks, students: withdrawn, studentId: 'sM', fromDateKey: '2026-10-02', suppressedMakeupOrigins: {}, resolveStockId })
    expect(off.changed).toBe(false)
    expect(off).not.toHaveProperty('nextTemplatePendingDesks')
  })

  it('盤面の effect が使う applyStudentWithdrawSweepToBoard も下段を掃除し、保留マップを返す', () => {
    const { diff, key } = pendingWithQrTeacher()
    const batch = applyStudentWithdrawSweepToBoard({
      weeks: diff.nextWeeks,
      students: withdrawn,
      teachers,
      regularLessons: NEW_ROWS,
      classroomSettings: settings(),
      suppressedRegularLessonOccurrences: [],
      suppressedMakeupOrigins: {},
      todayKey: '2026-10-02',
      resolveStockId,
      templatePendingDesks: diff.nextPendingDesks,
    })
    expect(batch.changed).toBe(true)
    expect(batch.results.map((result) => [result.studentId, result.removedSeatCount])).toEqual([['sM', 1]])
    expect(batch.nextTemplatePendingDesks![key].lower.lesson).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 保護者からの休み連絡の自動処理（Q31 行 7）
// ─────────────────────────────────────────────────────────────────────────────

describe('保護者からの休み連絡: 上段は従来どおり・下段にしか居なければ自動処理しない（Q31・Q26-3）', () => {
  it('上段の生徒は保留の机でもその席を返す（上段の休みは既存の意味どおり）', () => {
    const { diff } = pendingWithQrTeacher()
    const resolution = resolveParentAbsenceTarget({ cells: diff.nextWeeks[0], students, studentId: 'sC', dateKey: DATE, slotNumber: SLOT, subject: '数', templatePendingDesks: diff.nextPendingDesks })
    expect(resolution).toMatchObject({ ok: true, target: { cellId: CELL_ID, deskIndex: 0, studentIndex: 0 } })
  })

  it('下段にしか居ない生徒は pending-lower-only（一覧に残す理由の文言つき）。保留マップを渡さなければ従来の student-not-found', () => {
    const { diff } = pendingWithQrTeacher()
    const base = { cells: diff.nextWeeks[0], students, studentId: 'sM', dateKey: DATE, slotNumber: SLOT, subject: '数' }
    expect(resolveParentAbsenceTarget({ ...base, templatePendingDesks: diff.nextPendingDesks })).toEqual({ ok: false, reason: 'pending-lower-only' })
    expect(resolveParentAbsenceTarget(base)).toEqual({ ok: false, reason: 'student-not-found' })
    expect(PARENT_ABSENCE_TARGET_PENDING_LOWER_MESSAGE).toContain('保留')
  })

  it('盤面の effect は pending-lower-only のとき専用の文言で ok=false を返し、盤面を変えない（字面）', () => {
    const effect = sliceBody(BOARD_TSX, 'const resolution = resolveParentAbsenceTarget({', 900)
    expect(effect).toContain('templatePendingDesks: activeTemplatePendingDesks,')
    expect(effect).toContain("resolution.reason === 'pending-lower-only' ? PARENT_ABSENCE_TARGET_PENDING_LOWER_MESSAGE : PARENT_ABSENCE_TARGET_NOT_FOUND_MESSAGE")
    const beforeApply = effect.slice(0, effect.indexOf('markStudentAbsent'))
    expect(beforeApply).toContain('finish(false,')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 下段の移動の出席不可コマ確認（(B) の残り）・保存前レポートの見出し（Q32-3）
// ─────────────────────────────────────────────────────────────────────────────

describe('下段の生徒の移動: 通常の移動と同じ出席不可コマの確認（Q26-3）', () => {
  it('別の時限・別の日への移動は移す生徒 1 人を確認対象にする。同じコマの別の机は対象にしない', () => {
    const { diff, deskId } = pendingWithQrTeacher()
    const otherSlot = buildWeek(OLD_ROWS).find((cell) => cell.dateKey === '2026-10-08' && cell.slotNumber === SLOT)!
    const common = {
      weeks: diff.nextWeeks,
      templatePendingDesks: diff.nextPendingDesks,
      source: { cellId: CELL_ID, deskId, lowerIndex: 0 },
      managedStudentByAnyName: new Map(students.map((student) => [student.name, student])),
      resolveBoardStudentDisplayName: (name: string) => name,
    }
    expect(collectPendingLowerMoveLandingPlacements({ ...common, cells: [...diff.nextWeeks[0], otherSlot], cellId: otherSlot.id })).toEqual([
      { managedStudentId: 'sM', displayName: '三浦', dateKey: '2026-10-08', slotNumber: SLOT },
    ])
    expect(collectPendingLowerMoveLandingPlacements({ ...common, cells: diff.nextWeeks[0], cellId: CELL_ID })).toEqual([])
  })

  it('下段の移動の確定は、確認ダイアログ（confirmReopenForPlacements）を通してから commit し、承認分を黄色化する（字面）', () => {
    const handler = sliceBody(BOARD_TSX, 'const executeTemplatePendingLowerMove = (', 3200)
    const confirmIndex = handler.indexOf('confirmReopenForPlacements(collectPendingLowerMoveLandingPlacements({')
    const commitIndex = handler.indexOf('commitWeeks(')
    expect(confirmIndex).toBeGreaterThan(0)
    expect(commitIndex).toBeGreaterThan(confirmIndex)
    expect(handler).toContain("setStatusMessage('出席不可コマへの移動を取りやめました。')")
    expect(handler).toContain('if (reopenTargets.length > 0) onApplyReopenedSlots?.(reopenTargets)')
  })
})

describe('保存前レポートの見出し（Q32-3）', () => {
  it('差分反映の教室（diff）は「テンプレ保存前の盤面」。旧方式（overwrite・既定）は従来の文言のまま', () => {
    const diffHtml = buildOverwriteReportHtml([], '2026-10-07', 'diff')
    expect(diffHtml).toContain('テンプレ保存前の盤面')
    expect(diffHtml).not.toContain('削除')
    const overwriteHtml = buildOverwriteReportHtml([], '2026-10-07')
    expect(overwriteHtml).toContain('<h2 style="margin:0 0 8px;font-size:16px;">テンプレート上書き削除データ一覧</h2>')
    expect(overwriteHtml).toContain('削除される通常授業以外のデータはありません。')
    expect(buildOverwriteReportHtml([], '2026-10-07', 'overwrite')).toBe(overwriteHtml)
    expect(resolveTemplateOverwriteReportLabels('overwrite').fileNamePrefix).toBe('テンプレ上書き削除データ')
    expect(resolveTemplateOverwriteReportLabels('diff').fileNamePrefix).toBe('テンプレ保存前の盤面')
  })

  it('盤面はフラグ templateDiffApply ON のときだけ diff を渡す（字面）', () => {
    const confirm = sliceBody(BOARD_TSX, 'const handleTemplateSaveConfirm = async () => {', 900)
    expect(confirm).toContain("const templateReportMode = templateDiffApplyEnabled ? 'diff' as const : 'overwrite' as const")
    expect(confirm).toContain('mode: templateReportMode,')
  })
})

describe('盤面の配線: 保留マップはフラグ ON の教室だけ（activeTemplatePendingDesks）周辺処理へ渡す（字面）', () => {
  it('講習の講師自動割当・自己修復・退塾スイープ・並べ替えに activeTemplatePendingDesks を渡す', () => {
    expect(sliceBody(BOARD_TSX, 'const result = applyTeacherAutoAssignRequest({', 500)).toContain('templatePendingDesks: activeTemplatePendingDesks,')
    expect(sliceBody(BOARD_TSX, 'const result = reconcileSubmittedTeacherPlacements({', 500)).toContain('templatePendingDesks: activeTemplatePendingDesks,')
    expect(sliceBody(BOARD_TSX, 'const sweep = applyStudentWithdrawSweepToBoard({', 700)).toContain('templatePendingDesks: activeTemplatePendingDesks,')
    const sort = sliceBody(BOARD_TSX, 'const handleBoardSort = (mode: BoardSortMode) => {', 1200)
    expect(sort).toContain('collectTemplatePendingDeskIdsInCell(activeTemplatePendingDesks, cellId)')
    expect(sort).toContain('seatSortCells(nextCells, { skipStatusSlotPack: true, resolveLockedDeskIds })')
    expect(sort).toContain('packSortCellDesks(cell, { skipStatusSlotPack: true, lockedDeskIds: resolveLockedDeskIds(cell.id) })')
    // テンプレ編集画面の並べ替えは保留と無関係（テンプレのセル）なので従来どおり。
    const templateSort = sliceBody(BOARD_TSX, 'const handleTemplateSort = (mode: BoardSortMode) => {', 700)
    expect(templateSort).not.toContain('lockedDeskIds')
  })

  it('退塾スイープの確定は保留マップを commitWeeks へ渡す（下段を消した机は同じ確定の中で 1 行へ戻る）', () => {
    const effect = sliceBody(BOARD_TSX, 'const sweep = applyStudentWithdrawSweepToBoard({', 3000)
    expect(effect).toContain('sweep.nextTemplatePendingDesks ?? templatePendingDesks,')
  })
})
