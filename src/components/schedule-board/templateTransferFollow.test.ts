// Q40（Issue #75 段 2・オーナー確定 2026-10-14）: テンプレの生徒の増減を丸ごと振替・休日の振替に追従させる純関数のテスト。
// regression-reviewer 2026-10-14 の監査（H-1 日単位の根拠・H-2 台帳の根拠・H-3 生徒×科目・H-4 後ろ向きの丸ごと振替・M-2 取り下げ・M-4 講師なし・L-1 件数）も固定する。
import { describe, expect, it } from 'vitest'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildMovedSourceStatusEntry, prepareStudentForMove } from './ScheduleBoardScreen'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'
import type { TemplateDiffTemplateCell } from './templateDiffApply'
import { buildOriginToken, type ManualMakeupOrigin } from './makeupStock'
import { resolveWholeDayTransferSettlement } from './templateDiffApply'
import {
  collectOrphanedMakeups,
  planWholeDayTransferPlacements,
  removeOrphanedMakeups,
  resolveWholeDayTransferDestination,
  extendTemplateDiffSlotFilterWithCells,
  TEMPLATE_TRANSFER_STOCK_REASON,
  type MakeupOriginLedger,
} from './templateTransferFollow'

const WED = '2026-10-07'
const THU = '2026-10-08'
const EFFECTIVE = WED
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...extra }) as ClassroomSettings
/** 在庫の正本の代役: 渡された台帳の origin をそのままトークンにする（本物は collectMakeupOriginDatesByKey・matrix で配線を検証）。 */
const ledgerTokens = (ledger: MakeupOriginLedger) => Object.fromEntries(Object.entries(ledger).map(([key, origins]) => [key, origins.map((origin) => buildOriginToken(origin.dateKey, origin.slotNumber))]))

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
const collect = (params: Partial<CollectParams> & Pick<CollectParams, 'weeks' | 'templateCells'>) => collectOrphanedMakeups({ regularLessons: [], manualMakeupAdjustments: {}, resolveLedgerOriginDates: ledgerTokens, effectiveStartDate: EFFECTIVE, ...params })

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

  it('新テンプレが振替元の日に生徒を持たず、在庫の正本もその日の origin を持たなければ根拠を失った振替（時限・机・席つきで返る）。台帳の取り下げは無し', () => {
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

  it('根拠 (b) は在庫の正本に委ねる（監査 H-2/H-A）: 正本がその生徒×科目のその日の有効な origin を返せば対象外（台帳の origin・振替の休みの記録・休日の自動発生のどれでも）。別の日・別の科目・時限つきでも同じ日なら根拠', () => {
    // 台帳経由（通常授業の休み・手積み）
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED }] } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: WED, slotNumber: 3 }] } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [{ dateKey: THU }] } }).removals).toHaveLength(1)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__英': [{ dateKey: WED }] } }).removals).toHaveLength(1)
    // 正本が盤面から立てる origin（振替を休んだ記録＝振替元の日に立つ・H-A）は、台帳に無くても根拠
    expect(collect({ weeks: board(), templateCells: templateWithoutA, resolveLedgerOriginDates: () => ({ 'sA__数': [buildOriginToken(WED, 5)] }) }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, resolveLedgerOriginDates: () => ({ 'sA__数': [buildOriginToken(THU, 5)] }) }).removals).toHaveLength(1)
    // 表示専用の記録（moved）は正本が origin を立てないので根拠にならない（代役は台帳しか見ない＝本物と同じ結果）
    const moved = board({ wedDesk1: desk('w5d1', '田中', undefined, [status(A, WED, 5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 }), null]) })
    expect(collect({ weeks: moved, templateCells: templateWithoutA }).removals).toHaveLength(1)
  })

  it('根拠 (b) は取り下げ後の台帳で引く（監査 M-A）: 同じ保存で取り下げる印つき origin は根拠に数えない＝その在庫から置いた振替も同じ保存で外れる', () => {
    const tagged: ManualMakeupOrigin = { dateKey: WED, slotNumber: 5, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }
    const received: MakeupOriginLedger[] = []
    const result = collect({ weeks: board(), templateCells: templateWithoutA, manualMakeupAdjustments: { 'sA__数': [tagged, { dateKey: '2026-10-14' }] }, resolveLedgerOriginDates: (ledger) => { received.push(ledger); return ledgerTokens(ledger) } })
    expect(result.ledgerRemovals).toEqual([{ stockKey: 'sA__数', dateKey: WED, slotNumber: 5 }])
    expect(received).toEqual([{ 'sA__数': [{ dateKey: '2026-10-14' }] }])
    expect(result.removals).toHaveLength(1)
  })

  it('管理生徒 ID の無い振替（名前だけ・旧データ）は触らない（監査 M-B・消さない側に倒す）', () => {
    const nameOnly = board({ makeup: { ...makeupOf('sA_mk', '青木', WED, labelWed5), managedStudentId: undefined } })
    expect(collect({ weeks: nameOnly, templateCells: templateWithoutA }).removals).toHaveLength(0)
  })

  it('手動追加の振替・振替元が反映日より前の振替・範囲外のコマの振替は対象外', () => {
    expect(collect({ weeks: board({ makeup: makeupOf('sA_mk', '青木', WED, labelWed5, { manualAdded: true }) }), templateCells: templateWithoutA }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, effectiveStartDate: THU }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(4, 5)]) } }).removals).toHaveLength(0)
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 5)]) } }).removals).toHaveLength(1)
    // 時限不明の振替元は、その曜日のどれかの時限が範囲なら入る
    expect(collect({ weeks: board({ makeup: makeupOf('sA_mk', '青木', WED, undefined) }), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 2)]) } }).removals).toHaveLength(1)
  })

  it('範囲は日単位（2026-10-21・テスト教室 tp-51）: 振替元の時限が分かっていても、同じ曜日の別の時限だけを変えた保存で根拠の無い振替は消える', () => {
    // 時限変更（5限→3限）の後に 3限だけ科目を変える保存＝変えたコマは 水 3限 だけ。旧科目の振替（振替元 水 5限）は根拠を失っているので消える。
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(3, 3)]) } }).removals).toHaveLength(1)
    // 別の曜日だけの保存では従来どおり触らない
    expect(collect({ weeks: board(), templateCells: templateWithoutA, slotFilter: { slotKeys: new Set([buildTemplateSlotKey(4, 3)]) } }).removals).toHaveLength(0)
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
    // 触らない週は配列ごと同じ参照（反映日より前だけの週＝INV-10・監査 L-A）
    const previousWeek = [cell('2026-09-30', 5, [desk('p5d1', '田中', [makeupOf('sA_old', '青木', '2026-09-23', undefined), null])])]
    const twoWeeks = [previousWeek, ...weeks]
    const twoWeekResult = removeOrphanedMakeups(twoWeeks, collect({ weeks: twoWeeks, templateCells: templateWithoutA }).removals)
    expect(twoWeekResult.weeks[0]).toBe(previousWeek)
    expect(twoWeekResult.weeks[1]).not.toBe(weeks[0])
  })
})

describe('resolveWholeDayTransferSettlement（Q40-3・2026-10-21 テスト教室 tp-48 → regression-reviewer H-A）', () => {
  const C = student('sC_t', '千葉')
  const movedC5 = status(C, WED, 5, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 5 })
  const skippedAt = (slotNumber: number) => ({ student: C, dateKey: WED, slotNumber, deskIndex: 0, seatIndex: 0 })
  /** 水 5限 の C を木 5限 へ移送済み（記録＋振替）の盤面。 */
  const transferred = () => [[
    cell(WED, 5, [desk('w5d1', '', undefined, [movedC5, null]), desk('w5d2', '')]),
    cell(THU, 5, [desk('t5d1', '鈴木', [makeupOf('sC_mk', '千葉', WED, labelWed5), null]), desk('t5d2', '佐藤')]),
  ]]
  const template = (...slots: number[]) => slots.map((slotNumber) => templateCellOf(WED, slotNumber, [desk(`w${slotNumber}d1`, '田中', [C, null])]))
  const resolve = (items: ReturnType<typeof skippedAt>[], extra: Partial<Parameters<typeof resolveWholeDayTransferSettlement>[1]> = {}) =>
    resolveWholeDayTransferSettlement(items, { weeks: transferred(), pendingDesks: {}, templateCells: template(5), suppressedRegularLessonOccurrences: [], originDatesByKey: {}, scheduleCountAdjustments: [], ...extra })

  it('(1) 同じ時限のキーが保存前からあれば精算済み（前の保存か丸ごと振替が処分済み＝再保存の冪等性）', () => {
    const item = skippedAt(5)
    expect(resolve([item], { suppressedRegularLessonOccurrences: [`sC__数__${WED}__5`] }).has(item)).toBe(true)
    expect(resolve([item], { suppressedRegularLessonOccurrences: [`sC__英__${WED}__5`, `sC__数__${THU}__5`] }).has(item)).toBe(true) // 説明（移送済みの振替）があるので (2) で精算済み
  })
  it('(2) 時限変更（5→3限）: 移送済みの振替が説明になるので新しい時限の分は精算済み（H-1・新時限へ二重に置かない）', () => {
    const item = skippedAt(3)
    expect(resolve([item], { templateCells: template(3), suppressedRegularLessonOccurrences: [`sC__数__${WED}__5`] }).has(item)).toBe(true)
  })
  it('tp-48: 同じ科目を 3限にも持つ生徒を 5限に足す＝3限は移送済み（説明 1）・テンプレの授業 2 → 5限の分は説明が無いので精算済みでない（置く）', () => {
    const weeks = [[
      cell(WED, 3, [desk('w3d1', '', undefined, [status(C, WED, 3, 'moved', { moveDestinationDateKey: THU, moveDestinationSlotNumber: 3 }), null])]),
      cell(WED, 5, [desk('w5d1', '', undefined), desk('w5d2', '')]),
      cell(THU, 3, [desk('t3d1', '鈴木', [makeupOf('sC_mk3', '千葉', WED, '2026/10/7(水) 3限'), null])]),
    ]]
    const item = skippedAt(5)
    expect(resolve([item], { weeks, templateCells: template(3, 5), suppressedRegularLessonOccurrences: [`sC__数__${WED}__3`] }).has(item)).toBe(false)
  })
  it('H-A 再現 1: 1 回の保存で 5→3限 と 4限にも足す＝説明は 1（5限の振替）なので時限の小さい 3限だけ精算済み・4限は置く', () => {
    const items = [skippedAt(4), skippedAt(3)]
    const settled = resolve(items, { templateCells: template(3, 4), suppressedRegularLessonOccurrences: [`sC__数__${WED}__5`] })
    expect(settled.has(items[1])).toBe(true)
    expect(settled.has(items[0])).toBe(false)
  })
  it('H-A 再現 2: 5→3限 で保存した後に 4限にも足す＝3限は抑止済み（置かなかった以外のテンプレの授業 1）で説明 1 を使い切る → 4限は置く', () => {
    const item = skippedAt(4)
    expect(resolve([item], { templateCells: template(3, 4), suppressedRegularLessonOccurrences: [`sC__数__${WED}__5`, `sC__数__${WED}__3`] }).has(item)).toBe(false)
  })
  it('説明が無ければ精算済みでない。希望回数 −1 の純減・在庫の origin・同じコマの別種の授業は説明になる', () => {
    const empty = [[cell(WED, 5, [desk('w5d1', ''), desk('w5d2', '')])]]
    const item = skippedAt(5)
    expect(resolve([item], { weeks: empty }).has(item)).toBe(false)
    expect(resolve([item], { weeks: empty, scheduleCountAdjustments: [{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: WED, delta: -1 }] }).has(item)).toBe(true)
    // +1 で戻した分は打ち消す
    expect(resolve([item], { weeks: empty, scheduleCountAdjustments: [{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: WED, delta: -1 }, { studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: WED, delta: 1 }] }).has(item)).toBe(false)
    expect(resolve([item], { weeks: empty, originDatesByKey: { sC__数: [buildOriginToken(WED, 5)] } }).has(item)).toBe(true)
    const withMakeupSameSlot = [[cell(WED, 5, [desk('w5d1', '田中', [makeupOf('sC_mk', '千葉', '2026-09-30', undefined, { manualAdded: true }), null]), desk('w5d2', '')])]]
    expect(resolve([item], { weeks: withMakeupSameSlot }).has(item)).toBe(true)
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
    weeks, skipped: [skippedC], pendingDesks: {}, classroomSettings: settings(), effectiveStartDate: EFFECTIVE, settled: new Set(), prepareStudentForMove, buildMovedSourceStatusEntry, ...extra,
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

  it('テンプレの席が埋まっていればもう一方の席。同じ机が満席なら同じコマの別の机へ（講師が居る机を優先）。満席なら同じ机番号の下段（保留）へ（決定記録 48・休日でも同じ）', () => {
    const otherSeat = run(board(desk('t5d1', '鈴木', [null, makeupOf('sB_mk', '馬場', WED, labelWed5)])))
    expect(otherSeat.placed[0]?.seatIndex).toBe(0)
    expect(otherSeat.placed[0]?.fallbackDesk).toBe(false)
    // L-5 (a)（オーナー確定 2026-10-21）: 同じ机が満席 → 同じコマの別の机（t5d2・佐藤）の席へ
    const fullSameDesk = board(desk('t5d1', '鈴木', [makeupOf('sB_mk', '馬場', WED, labelWed5), student('sD_m', '土屋', { manualAdded: true })]))
    const fallback = run(fullSameDesk)
    expect(fallback.placed).toEqual([expect.objectContaining({ deskId: 't5d2', seatIndex: 1, fallbackDesk: true })])
    expect(fallback.stocked).toHaveLength(0)
    // 別の机に講師が居なくても空席なら置く（オーナー指示 2026-10-21）。満席（どの机にも空席が無い）のときだけ未消化
    const teacherlessOther = fullSameDesk.map((week) => week.map((entry) => (entry.id === `${THU}_5` ? { ...entry, desks: [entry.desks[0], desk('t5d2', '')] } : entry)))
    const teacherless = run(teacherlessOther)
    expect(teacherless.placed).toEqual([expect.objectContaining({ deskId: 't5d2', fallbackDesk: true, teacherless: true })])
    const full = fullSameDesk.map((week) => week.map((entry) => (entry.id === `${THU}_5` ? { ...entry, desks: [entry.desks[0], desk('t5d2', '佐藤', [student('sE_m', '江藤', { manualAdded: true }), student('sF_m', '藤井', { manualAdded: true })])] } : entry)))
    // 決定記録 48（2026-10-25・(b)-1）: 満席なら未消化へ逃がさず、同じ机番号の机の下段（保留・緑）へ振替として置く（台帳には積まない）。
    const full_ = run(full)
    expect(full_.placed).toHaveLength(0)
    expect(full_.stocked).toHaveLength(0)
    expect(full_.pendingPlaced).toEqual([expect.objectContaining({ sourceDateKey: WED, sourceSlotNumber: 5, targetDateKey: THU, deskId: 't5d1', deskIndex: 0, fallbackDesk: false })])
    const key = buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')
    expect(Object.keys(full_.nextPendingDesks)).toEqual([key])
    expect(full_.nextPendingDesks[key].lower.lesson?.studentSlots[full_.pendingPlaced[0].seatIndex]).toMatchObject({ managedStudentId: 'sC', lessonType: 'makeup', makeupSourceDate: WED })
    expect(full_.nextPendingDesks[key].origin?.kind).toBe('transfer-follow-full')
    expect(full_.nextPendingDesks[key].effectiveStartDate).toBe(THU)
    expect(full_.handledKeys.has('sC__数__2026-10-07')).toBe(true)
    expect(full_.handledCount).toBe(1)
    // 振替元の机には置いたときと同じく移動元記録を残す（授業は下段に生きている）。振替先のセルの上段は変えない。
    const wedFull = full_.weeks[0].find((entry) => entry.id === `${WED}_5`)!
    expect(wedFull.desks[0].statusSlots?.some((entry) => entry?.status === 'moved' && entry.managedStudentId === 'sC')).toBe(true)
    expect(full_.weeks[0].find((entry) => entry.id === `${THU}_5`)).toBe(full[0].find((entry) => entry.id === `${THU}_5`))
    const holiday = run(full, { classroomSettings: settings({ holidayDates: [WED] }) })
    expect(holiday.pendingPlaced).toHaveLength(1)
    expect(holiday.stocked).toHaveLength(0)
  })

  it('振替元の机の記録は授業も記録も無い席に置く（監査 L-3）: テンプレの席に生きている生徒（記録なし）が居れば、もう一方の席へ', () => {
    // 水 5限 机 0: 席 0 に生きている生徒 X（手動追加）・記録なし。移動元記録は机 1 にある（振替先の特定用）。
    const weeks = [[
      cell(WED, 5, [desk('w5d1', '', [student('sX_m', '山田', { manualAdded: true }), null]), desk('w5d2', '', undefined, [movedB, null])]),
      cell(THU, 5, [desk('t5d1', '鈴木', [makeupOf('sB_mk', '馬場', WED, labelWed5), null]), desk('t5d2', '佐藤')]),
    ]]
    const plan = run(weeks, { skipped: [{ ...skippedC, seatIndex: 0 }] })
    expect(plan.placed).toHaveLength(1)
    const wed = plan.weeks[0].find((entry) => entry.id === `${WED}_5`)!
    expect(wed.desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sX')
    expect(wed.desks[0].statusSlots?.[0] ?? null).toBeNull()
    expect(wed.desks[0].statusSlots?.[1]).toMatchObject({ status: 'moved', managedStudentId: 'sC' })
  })

  it('同じ机に講師が居なくても空席なら置く（オーナー指示 2026-10-21・旧 M-4「講師のいない机には置かない」を改定）。講師の居る別の机があってもまず同じ机', () => {
    const sameDeskTeacherless = run(board(desk('t5d1', '', [makeupOf('sB_mk', '馬場', WED, labelWed5), null])))
    expect(sameDeskTeacherless.placed).toEqual([expect.objectContaining({ deskId: 't5d1', seatIndex: 1, fallbackDesk: false, teacherless: true })])
    // 同じ机が満席で、別の机は講師の居る机を優先。講師の居ない机しか無ければそこへ
    const sameFull = board(desk('t5d1', '', [makeupOf('sB_mk', '馬場', WED, labelWed5), student('sD_m', '土屋', { manualAdded: true })]))
    expect(run(sameFull).placed).toEqual([expect.objectContaining({ deskId: 't5d2', teacherless: false })])
    const onlyTeacherless = sameFull.map((week) => week.map((entry) => (entry.id === `${THU}_5` ? { ...entry, desks: [entry.desks[0], desk('t5d2', '')] } : entry)))
    expect(run(onlyTeacherless).placed).toEqual([expect.objectContaining({ deskId: 't5d2', teacherless: true })])
  })

  it('保留（2 行）の机は下段へ相乗り・同じコマに同じ生徒が生きている・振替先のセルが無いときは未消化。移動元記録が無い日と別の時限で精算済みの生徒は触らない', () => {
    const weeks = board()
    // 同じ机が保留で、別の机（t5d2）も保留 → 置ける机が無い＝満席扱いで未消化。別の机が空いていれば L-5 (a) でそちらへ。
    const bothPending = { [buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')]: { lower: {}, effectiveStartDate: WED, createdAt: 'x' }, [buildTemplatePendingDeskKey(`${THU}_5`, 't5d2')]: { lower: {}, effectiveStartDate: WED, createdAt: 'x' } }
    // 決定記録 48: 置ける机が無ければ同じ机番号の机の下段へ（既にある保留の下段の空いた席に相乗り）。未消化にはしない。
    const pending = run(weeks, { pendingDesks: bothPending })
    expect(pending.stocked).toHaveLength(0)
    expect(pending.pendingPlaced).toEqual([expect.objectContaining({ deskId: 't5d1', fallbackDesk: false })])
    expect(pending.nextPendingDesks[buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')].lower.lesson?.studentSlots.some((student) => student?.managedStudentId === 'sC')).toBe(true)
    // 既存の保留の由来（テンプレ保存）は上書きしない。
    expect(pending.nextPendingDesks[buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')].origin).toBeUndefined()
    const pendingSameDeskOnly = run(weeks, { pendingDesks: { [buildTemplatePendingDeskKey(`${THU}_5`, 't5d1')]: { lower: {}, effectiveStartDate: WED, createdAt: 'x' } } })
    expect(pendingSameDeskOnly.placed).toEqual([expect.objectContaining({ deskId: 't5d2', fallbackDesk: true })])
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
    const accounted = run(weeks, { settled: new Set([skippedC]) })
    expect(accounted.placed).toHaveLength(0)
    expect(accounted.stocked).toHaveLength(0)
    expect(accounted.handledKeys.size).toBe(0)
    expect(accounted.settled.map((item) => item.student.managedStudentId)).toEqual(['sC'])
  })

  it('精算済みの集合に入っていない生徒は置く。集合は要素参照で見る（2026-10-21・判定は resolveWholeDayTransferSettlement が 1 か所で行う）', () => {
    const weeks = board()
    const placed = run(weeks, { settled: new Set([{ ...skippedC }]) })
    expect(placed.placed).toHaveLength(1)
    expect(placed.settled).toHaveLength(0)
    expect(placed.handledKeys.has(`sC__数__${WED}`)).toBe(true)
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
