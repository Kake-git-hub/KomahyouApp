// Q40（Issue #75 段 2・オーナー確定 2026-10-14）: テンプレの生徒の増減を丸ごと振替・休日の振替に追従させる純関数のテスト。
// regression-reviewer 2026-10-14 の監査（H-1 日単位の根拠・H-2 台帳の根拠・H-3 生徒×科目・H-4 後ろ向きの丸ごと振替・M-2 取り下げ・M-4 講師なし・L-1 件数）も固定する。
import { describe, expect, it } from 'vitest'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildMovedSourceStatusEntry, prepareStudentForMove } from './ScheduleBoardScreen'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'
import type { TemplateDiffTemplateCell } from './templateDiffApply'
import { buildMakeupStockKey, type ManualMakeupOrigin } from './makeupStock'
import {
  collectOrphanedMakeups,
  planWholeDayTransferPlacements,
  removeOrphanedMakeups,
  resolveWholeDayTransferDestination,
  extendTemplateDiffSlotFilterWithCells,
  TEMPLATE_TRANSFER_STOCK_REASON,
} from './templateTransferFollow'

const WED = '2026-10-07'
const THU = '2026-10-08'
const EFFECTIVE = WED
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...extra }) as ClassroomSettings
const resolveStockKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'subject'>) => buildMakeupStockKey(student.managedStudentId ?? student.name, student.subject)

function student(id: string, name: string, extra: Partial<StudentEntry> = {}): StudentEntry {
  return { id, name, managedStudentId: id.replace(/_.*$/u, ''), grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...extra }
}
function makeupOf(id: string, name: string, sourceDateKey: string, label: string | undefined, extra: Partial<StudentEntry> = {}): StudentEntry {
  return student(id, name, { lessonType: 'makeup', makeupSourceDate: sourceDateKey, makeupSourceLabel: label, ...extra })
}
function desk(id: string, teacher: string, slots?: [StudentEntry | null, StudentEntry | null], statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]): DeskCell {
  return { id, teacher, ...(slots ? { lesson: { id: `lesson_${id}`, studentSlots: slots } } : {}), ...(statusSlots ? { statusSlots } : {}) }
}
function cell(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: dateKey, slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}
function status(entry: StudentEntry, dateKey: string, slotNumber: number, kind: StudentStatusEntry['status'], extra: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return { id: `st_${entry.id}_${kind}`, studentId: entry.id, sourceManagedLesson: true, name: entry.name, managedStudentId: entry.managedStudentId, grade: '中2', subject: entry.subject, lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey, slotNumber, recordedAt: 'x', status: kind, sourceLessonId: 'src', ...extra }
}
function templateCellOf(dateKey: string, slotNumber: number, desks: DeskCell[]): TemplateDiffTemplateCell {
  const raw = cell(dateKey, slotNumber, desks)
  return { raw, applied: raw, scaffoldTeachersStripped: false }
}
const A = student('sA', '青木')
const B = student('sB', '馬場')
const labelWed5 = '2026/10/7(水) 5限'
const rowWithA = { id: 'r', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 }

type CollectParams = Parameters<typeof collectOrphanedMakeups>[0]
const collect = (params: Partial<CollectParams> & Pick<CollectParams, 'weeks' | 'templateCells'>) => collectOrphanedMakeups({ regularLessons: [], manualMakeupAdjustments: {}, resolveStockKey, effectiveStartDate: EFFECTIVE, ...params })

describe('collectOrphanedMakeups（Q40-1）', () => {
  // 盤面: 木 5限 机 1 に A の振替（振替元 水 10/7 5限）。水 5限 机 1 は空（A は移送済み）。
  const board = (extra: Partial<{ wedDesk1: DeskCell; makeup: StudentEntry }> = {}) => [[
    cell(WED, 3, [desk('w3d1', '')]),
    extra.wedDesk1 ? cell(WED, 5, [extra.wedDesk1]) : cell(WED, 5, [desk('w5d1', '田中')]),
    cell(THU, 5, [desk('t5d1', '田中', [extra.makeup ?? makeupOf('sA_mk', '青木', WED, labelWed5), null])]),
  ]]
  const templateWithoutA = [templateCellOf(WED, 5, [desk('tw5d1', '田中', [null, null])]), templateCellOf(WED, 3, [desk('tw3d1', '', [null, null])])]
  const templateWithA = [templateCellOf(WED, 5, [desk('tw5d1', '田中', [student('sA_t', '青木'), null])])]
  const templateAtSlot3 = [templateCellOf(WED, 5, [desk('tw5d1', '田中', [null, null])]), templateCellOf(WED, 3, [desk('tw3d1', '', [student('sA_t', '青木'), null])])]

  it('新テンプレが振替元の日に生徒を持たず、会計記録も台帳の origin も無ければ根拠を失った振替（時限・机・席つきで返る）。台帳の取り下げは無し', () => {
    const result = collect({ weeks: board(), templateCells: templateWithoutA })
    expect(result.removals).toHaveLength(1)
    expect(result.removals[0]).toMatchObject({ cellId: `${THU}_5`, deskId: 't5d1', seatIndex: 0, sourceDateKey: WED, sourceSlotNumber: 5 })
    expect(result.ledgerRemovals).toEqual([])
  })

  it('根拠 (a) は日単位（監査 H-1）: 新テンプレが振替元の日のどの時限かにその生徒×科目を持てば対象外（時限だけ変えたテンプレで振替を消さない）', () => {
    expect(collect({ weeks: board(), templateCells: templateWithA }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateAtSlot3 }).removals).toHaveLength(0)
    // 時限がラベルから取れない振替元も同じ（日単位）
    const noLabel = board({ makeup: makeupOf('sA_mk', '青木', WED, undefined) })
    expect(collect({ weeks: noLabel, templateCells: templateAtSlot3 }).removals).toHaveLength(0)
    expect(collect({ weeks: noLabel, templateCells: templateWithoutA }).removals).toHaveLength(1)
  })

  it('根拠 (a) は生徒×科目（監査 H-3）: 同じ生徒でも科目が違えば根拠にならない（科目変更＝外す＋足す）', () => {
    const templateWithAEnglish = [templateCellOf(WED, 5, [desk('tw5d1', '田中', [student('sA_t', '青木', { subject: '英' }), null])])]
    expect(collect({ weeks: board(), templateCells: templateWithAEnglish }).removals).toHaveLength(1)
    expect(collect({ weeks: board(), templateCells: [], regularLessons: [{ ...rowWithA, subject1: '英' }] }).removals).toHaveLength(1)
  })

  it('根拠 (a) はテンプレ行でも見る: 休日設定した日は管理セルが空になるが、行がその曜日のどこかに生徒×科目を持てば対象外（丸ごと振替した日を後から休日にしても振替が消えない）', () => {
    const emptyTemplate = [templateCellOf(WED, 5, [desk('tw5d1', '', [null, null])])]
    expect(collect({ regularLessons: [rowWithA], weeks: board(), templateCells: emptyTemplate }).removals).toHaveLength(0)
    expect(collect({ regularLessons: [{ ...rowWithA, slotNumber: 3 }], weeks: board(), templateCells: emptyTemplate }).removals).toHaveLength(0)
    expect(collect({ regularLessons: [{ ...rowWithA, dayOfWeek: 4 }], weeks: board(), templateCells: emptyTemplate }).removals).toHaveLength(1)
  })

  it('根拠 (b): 振替元の日に会計を持つ出欠記録（欠席）があれば対象外。表示専用の記録（moved）は根拠にならない', () => {
    const absent = board({ wedDesk1: desk('w5d1', '田中', undefined, [status(A, WED, 5, 'absent'), null]) })
    expect(collect({ weeks: absent, templateCells: templateWithoutA }).removals).toHaveLength(0)
    const moved = board({ wedDesk1: desk('w5d1', '田中', undefined, [status(A, WED, 5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 }), null]) })
    expect(collect({ weeks: moved, templateCells: templateWithoutA }).removals).toHaveLength(1)
  })

  it('根拠 (c)（監査 H-2）: 台帳にその生徒×科目のその日の origin があれば対象外（在庫由来の振替。消すと origin が再浮上して誤増）。別の日・別の科目の origin は根拠にならない', () => {
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED }] } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED, slotNumber: 3 }] } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: THU }] } }).removals).toHaveLength(1)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__英': [{ dateKey: WED }] } }).removals).toHaveLength(1)
  })

  it('手動追加の振替・振替元が反映日より前の振替・範囲外のコマの振替は対象外', () => {
    expect(collect({ weeks: board({ makeup: makeupOf('sA_mk', '青木', WED, labelWed5, { manualAdded: true }) }), templateCells: templateWithoutA }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, effectiveStartDate: THU }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(4, 5)]) } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 5)]) } }).removals).toHaveLength(1)
    // 時限不明の振替元は、その曜日のどれかの時限が範囲なら入る
    expect(collect({ weeks: board({ makeup: makeupOf('sA_mk', '青木', WED, undefined) }), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 2)]) } }).removals).toHaveLength(1)
  })

  it('台帳の取り下げ（M-2）: 以前の保存が積んだ印つき origin は、その生徒×科目がその曜日のテンプレ行から外れたら取り下げる。手で積んだ origin・反映日より前・範囲外・行に残る生徒は取り下げない', () => {
    const tagged: ManualMakeupOrigin = { dateKey: WED, slotNumber: 5, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }
    const ledger = { 'sA__数': [tagged, { dateKey: WED, slotNumber: 5 }], 'sB__数': [{ ...tagged, dateKey: '2026-10-14' }] }
    const weeks = [[cell(WED, 5, [desk('w5d1', '田中')])]]
    const removed = collect({ weeks, templateCells: [], manualMakeupAdjustments: ledger })
    expect(removed.ledgerRemovals).toEqual([{ stockKey: 'sA__数', dateKey: WED, slotNumber: 5 }, { stockKey: 'sB__数', dateKey: '2026-10-14', slotNumber: 5 }])
    // 行に残る生徒×科目（時限は問わない）は取り下げない。科目が違えば取り下げる
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: ledger, regularLessons: [{ ...rowWithA, slotNumber: 3 }] }).ledgerRemovals).toEqual([{ stockKey: 'sB__数', dateKey: '2026-10-14', slotNumber: 5 }])
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: { 'sA__数': [tagged] }, regularLessons: [{ ...rowWithA, subject1: '英' }] }).ledgerRemovals).toHaveLength(1)
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: ledger, effectiveStartDate: THU }).ledgerRemovals).toEqual([{ stockKey: 'sB__数', dateKey: '2026-10-14', slotNumber: 5 }])
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: ledger, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(4, 5)]) } }).ledgerRemovals).toEqual([])
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED, slotNumber: 5 }] } }).ledgerRemovals).toEqual([])
    // 時限の無い印つき origin（保存は必ず時限つきで積む）は取り下げの対象にしない
    expect(collect({ weeks, templateCells: [], manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }] } }).ledgerRemovals).toEqual([])
  })

  it('removeOrphanedMakeups: 席を空け（机と講師は残す）、振替元の移動元記録だけ消し、触ったセルの ID を返す。触らないセルは参照ごと同じ', () => {
    const weeks = board({ wedDesk1: desk('w5d1', '田中', undefined, [status(A, WED, 5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 }), status(B, WED, 5, 'moved', { moveDestinationDateKey: THU })]) })
    const { removals } = collect({ weeks, templateCells: templateWithoutA })
    const result = removeOrphanedMakeups(weeks, removals)
    const thu = result.weeks[0].find((entry) => entry.id === `${THU}_5`)!
    expect(thu.desks[0].lesson).toBeUndefined()
    expect(thu.desks[0].teacher).toBe('田中')
    const wed = result.weeks[0].find((entry) => entry.id === `${WED}_5`)!
    expect(wed.desks[0].statusSlots?.[0]).toBeNull()
    expect(wed.desks[0].statusSlots?.[1]?.managedStudentId).toBe('sB')
    expect(result.removedMovedRecords).toBe(1)
    expect([...result.touchedCellIds].sort()).toEqual([`${WED}_5`, `${THU}_5`].sort())
    expect(result.weeks[0].find((entry) => entry.id === `${WED}_3`)).toBe(weeks[0][0])
    // 何も無ければ参照ごと同じ
    expect(removeOrphanedMakeups(weeks, []).weeks).toBe(weeks)
  })
})

describe('planWholeDayTransferPlacements（Q40-2）', () => {
  const movedB = status(B, WED, 5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 })
  // 丸ごと振替後の形: 水 5限 机 1 は空＋B の移動元記録、木 5限 机 1 に B の振替（席 0）。
  const board = (thuDesk: DeskCell = desk('t5d1', '鈴木', [makeupOf('sB_mk', '馬場', WED, labelWed5), null]), wedStatus: [StudentStatusEntry | null, StudentStatusEntry | null] = [movedB, null]) => [[
    cell(WED, 5, [desk('w5d1', '', undefined, wedStatus), desk('w5d2', '')]),
    cell(THU, 5, [thuDesk, desk('t5d2', '佐藤')]),
  ]]
  const skippedC = { student: student('sC_t', '千葉'), dateKey: WED, slotNumber: 5, deskIndex: 0, seatIndex: 1 }
  const run = (weeks: SlotCell[][], extra: Partial<Parameters<typeof planWholeDayTransferPlacements>[0]> = {}) => planWholeDayTransferPlacements({
    weeks, skipped: [skippedC], pendingDesks: {}, classroomSettings: settings(), effectiveStartDate: EFFECTIVE, suppressedRegularLessonOccurrences: [], prepareStudentForMove, buildMovedSourceStatusEntry, ...extra,
  })

  it('振替先の同じ時限・同じ机番号の空いた席へ振替として置き、振替元に「休)→ 先」の記録を残す。希望回数 −1 の対象から外す', () => {
    const weeks = board()
    const plan = run(weeks)
    expect(plan.placed).toHaveLength(1)
    expect(plan.stocked).toHaveLength(0)
    expect(plan.handledCount).toBe(1)
    const thu = plan.weeks[0].find((entry) => entry.id === `${THU}_5`)!
    const placed = thu.desks[0].lesson?.studentSlots[1]
    expect(placed).toMatchObject({ managedStudentId: 'sC', lessonType: 'makeup', makeupSourceDate: WED })
    expect(placed?.makeupSourceLabel).toContain('5限')
    expect(thu.desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sB')
    const wed = plan.weeks[0].find((entry) => entry.id === `${WED}_5`)!
    expect(wed.desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC', moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 })
    expect(plan.handledKeys.has('sC__数__2026-10-07')).toBe(true)
    expect([...plan.touchedCellIds].sort()).toEqual([`${WED}_5`, `${THU}_5`].sort())
    // 触らないセルは参照ごと同じ（木 5限 机 2 など）
    expect(thu.desks[1]).toBe(weeks[0][1].desks[1])
  })

  it('テンプレの席が埋まっていればもう一方の席。両方埋まっていれば未消化（休日でないので台帳へ）、休日なら自動発生に任せる', () => {
    const otherSeat = run(board(desk('t5d1', '鈴木', [null, makeupOf('sB_mk', '馬場', WED, labelWed5)])))
    expect(otherSeat.placed[0]?.seatIndex).toBe(0)
    const full = board(desk('t5d1', '鈴木', [makeupOf('sB_mk', '馬場', WED, labelWed5), student('sD_m', '土屋', { manualAdded: true })]))
    const stocked = run(full)
    expect(stocked.placed).toHaveLength(0)
    expect(stocked.stocked).toEqual([expect.objectContaining({ sourceDateKey: WED, sourceSlotNumber: 5, ledger: true, reason: 'no-seat' })])
    expect(stocked.handledKeys.has('sC__数__2026-10-07')).toBe(true)
    expect(stocked.handledCount).toBe(1)
    expect(stocked.weeks).toBe(full)
    const holiday = run(full, { classroomSettings: settings({ holidayDates: [WED] }) })
    expect(holiday.stocked[0]?.ledger).toBe(false)
  })

  it('講師のいない机には置かない（監査 M-4・講師日程表に出ない授業を作らない）＝未消化', () => {
    const noTeacher = run(board(desk('t5d1', '', [makeupOf('sB_mk', '馬場', WED, labelWed5), null])))
    expect(noTeacher.placed).toHaveLength(0)
    expect(noTeacher.stocked[0]).toMatchObject({ reason: 'no-teacher', ledger: true })
  })

  it('保留（2 行）の机・同じコマに同じ生徒が生きている・振替先のセルが無いときは未消化。移動元記録が無い日と別の時限で精算済みの生徒は触らない', () => {
    const weeks = board()
    const pending = run(weeks, { pendingDesks: { [buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')]: { lower: {}, effectiveStartDate: WED, createdAt: 'x' } } })
    expect(pending.stocked[0]?.reason).toBe('pending-desk')
    const duplicate = run(board(desk('t5d1', '鈴木', [makeupOf('sB_mk', '馬場', WED, labelWed5), null]), [movedB, null]).map((week) => week.map((entry) => (entry.id === `${THU}_5` ? { ...entry, desks: [entry.desks[0], desk('t5d2', '佐藤', [student('sC_x', '千葉'), null])] } : entry))))
    expect(duplicate.stocked[0]?.reason).toBe('duplicate')
    const noTarget = run([[weeks[0][0]]])
    expect(noTarget.stocked[0]?.reason).toBe('no-target-cell')
    // 移動元記録が無い日（振替先の日そのもの・古い丸ごと振替）は触らない＝従来どおり Q35-8（置かず −1）
    const noRecord = run(board(undefined, [null, null]))
    expect(noRecord.placed).toHaveLength(0)
    expect(noRecord.stocked).toHaveLength(0)
    expect(noRecord.handledKeys.size).toBe(0)
    expect(noRecord.handledCount).toBe(0)
    const accounted = run(weeks, { suppressedRegularLessonOccurrences: ['sC__数__2026-10-07__3'] })
    expect(accounted.placed).toHaveLength(0)
    expect(accounted.stocked).toHaveLength(0)
    expect(accounted.handledKeys.size).toBe(0)
  })

  it('後ろ向きの丸ごと振替（振替先が反映日より前）は触らない（監査 H-4・INV-10）＝従来どおり Q35-8', () => {
    // 木 10/8 → 水 10/7 へ移送した形。反映日は木。
    const movedBBack = status(B, THU, 5, 'moved', { moveDestinationDateKey: WED, moveDestinationSlotNumber: 5 })
    const weeks = [[
      cell(WED, 5, [desk('w5d1', '鈴木', [makeupOf('sB_mk', '馬場', THU, '2026/10/8(木) 5限'), null]), desk('w5d2', '')]),
      cell(THU, 5, [desk('t5d1', '', undefined, [movedBBack, null]), desk('t5d2', '佐藤')]),
    ]]
    const plan = run(weeks, { skipped: [{ ...skippedC, dateKey: THU }], effectiveStartDate: THU })
    expect(plan.placed).toHaveLength(0)
    expect(plan.stocked).toHaveLength(0)
    expect(plan.handledCount).toBe(0)
    expect(plan.weeks).toBe(weeks)
  })

  it('同じ生徒が同じ日に 2 回スキップされたら件数は 2（L-1・確認文の引き算は件数）、−1 から外す鍵は 1 つ', () => {
    const twice = run(board(), { skipped: [skippedC, { ...skippedC, deskIndex: 1, seatIndex: 0 }] })
    expect(twice.placed).toHaveLength(1)
    expect(twice.stocked[0]?.reason).toBe('duplicate')
    expect(twice.handledCount).toBe(2)
    expect(twice.handledKeys.size).toBe(1)
  })

  it('resolveWholeDayTransferDestination: 同じ時限の記録を優先し、無ければその日のどれかの記録（時限は同じと見なす）', () => {
    const weeks = [[
      cell(WED, 3, [desk('w3d1', '', undefined, [status(A, WED, 3, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 3 }), null])]),
      cell(WED, 5, [desk('w5d1', '', undefined, [status(B, WED, 5, 'moved', { moveDestinationDateKey: '2026-10-09', moveDestinationSlotNumber: 5 }), null])]),
    ]]
    expect(resolveWholeDayTransferDestination(weeks, WED, 5)).toEqual({ dateKey: '2026-10-09', slotNumber: 5 })
    expect(resolveWholeDayTransferDestination(weeks, WED, 4)).toEqual({ dateKey: THU, slotNumber: 4 })
    expect(resolveWholeDayTransferDestination(weeks, THU, 5)).toBeNull()
  })

  it('extendTemplateDiffSlotFilterWithCells: 絞り込みが無ければそのまま、あれば触ったセルを足す', () => {
    expect(extendTemplateDiffSlotFilterWithCells(undefined, new Set(['x']))).toBeUndefined()
    const filter = { slotKeys: new Set([buildTemplateSlotKey(3, 5)]) }
    expect(extendTemplateDiffSlotFilterWithCells(filter, new Set())).toBe(filter)
    expect(extendTemplateDiffSlotFilterWithCells(filter, new Set(['2026-10-08_5']))?.cellIds).toEqual(new Set(['2026-10-08_5']))
  })
})
