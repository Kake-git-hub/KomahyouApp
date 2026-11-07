// 段 4「丸ごと振替の付け替え」（docs/spec-template-conflict-v2.md §3・§1-1 #17・§9 決定記録 2・3・12・受け入れ条件 4-1〜4-9）。
// 在庫中立・休みで +1・不動点・解除・手入力 2 行・別曜日の拒否は INV-06 のマトリクス（inv06-whole-day-transfer.matrix.test.ts「第 2 版」）にも置く。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SlotCell, StudentEntry } from './types'
import {
  appendWholeDayTransferPair,
  collectWholeDayPairTargetDates,
  buildWholeDayTransferPairKey,
  convertToWholeDayPairStudent,
  findWholeDayTransferPairForDate,
  isWholeDayPairExpandedStudent,
  parseWholeDayTransferPairs,
  removeWholeDayTransferPair,
  resolveWholeDayPairCountDateKey,
  resolveWholeDayTransferPairWeekdayBlock,
  stripWholeDayPairDerivedRecords,
} from './wholeDayTransferPair'
import { inferStudentOrigin, resolveStudentOrigin } from './placementOrigin'
import { buildStudentStatusEntry, buildWholeDayTransferPairConfirmMessage, buildWholeDayTransferPairReleaseConfirmMessage, canReleaseWholeDayTransferPair, formatStockOriginLabel, resolveHolidayReleaseSuppressedOccurrences, computeStudentMove, computeStudentAbsentMark, prepareStudentForMove, resolveRemovedLessonOccurrenceKeysFor, resolveWholeDayTransferPairSourceBlockReason } from './ScheduleBoardScreen'
import { auditTemplateLessonAccounting, describeLessonAccountingViolations } from './templateLessonAccountingOracle'
import { collectOrphanedMakeups } from './templateTransferFollow'
import { collectMakeupOriginDatesByKey } from './makeupStock'
import { buildParentScheduleView } from '../../utils/parentSchedule'
import { buildParentScheduleView as buildGeneratedParentScheduleView } from '../../../functions/src/generated/parentSchedule'
import { buildStudentPayload } from '../../utils/scheduleHtml'
import { buildStudentSheetViewModel, countWholeDayPairLessonsFromOutside, isWholeDayPairCountedOutside } from '../../utils/scheduleViewData'
import {
  balances, buildBoard, cellAt, D, D2, MONTH_CROSS_WEEKS, pairedOrThrow, pairOf, recordIds, releaseOf, remerge, row, ROWS, save, seatIds, settings, snapshot, SLOT, students, teachers,
} from './wholeDayTransferPair.fixture'

const KEY = buildWholeDayTransferPairKey(D, D2)
const baseBoard = () => remerge(buildBoard(), ROWS, [])
const balancesOf = (weeks: SlotCell[][]) => balances(weeks, ROWS)
/** テンプレの変更: 水 5限 机 0 に生徒 2＝千葉を足す。 */
const ROWS_WITH_C = [row('r0', 't1', 'sA', 'sC'), ROWS[1], ROWS[2]]

function studentAt(weeks: SlotCell[][], dateKey: string, deskIndex: number, seat = 0, slotNumber = SLOT) {
  return cellAt(weeks, dateKey, slotNumber).desks[deskIndex]?.lesson?.studentSlots[seat] ?? null
}

describe('組の置き場（純関数・抑止キーに相乗り）', () => {
  it('キーを足す・読む・消す（4 分割の形・同じ日を 2 つの組に使うキーは読まない）', () => {
    expect(KEY).toBe(`WHOLE_DAY_PAIR__${D}__${D2}__0`)
    const keys = appendWholeDayTransferPair(['sA__数__2026-10-07__5'], { sourceDateKey: D, targetDateKey: D2 })
    expect(appendWholeDayTransferPair(keys, { sourceDateKey: D, targetDateKey: D2 })).toEqual(keys)
    expect(parseWholeDayTransferPairs([...keys, buildWholeDayTransferPairKey(D2, '2026-10-21'), 'WHOLE_DAY_PAIR__bad__2026-10-14__0'])).toEqual([{ sourceDateKey: D, targetDateKey: D2 }])
    expect(findWholeDayTransferPairForDate(keys, D)?.role).toBe('source')
    expect(findWholeDayTransferPairForDate(keys, D2)?.role).toBe('target')
    expect(findWholeDayTransferPairForDate(keys, '2026-10-21')).toBeNull()
    expect(removeWholeDayTransferPair(keys, { sourceDateKey: D, targetDateKey: D2 })).toEqual(['sA__数__2026-10-07__5'])
  })

  it('4-1: 同じ曜日だけ選べる（別の曜日は理由を返す）', () => {
    expect(resolveWholeDayTransferPairWeekdayBlock(D, D2)).toBeNull()
    expect(resolveWholeDayTransferPairWeekdayBlock(D, '2026-10-15')).toContain('同じ曜日')
  })

  it('§1-1 #17: 付け替えの授業は出自テンプレ（青字にしない）。科目・時間の手直しで手入力になると印は効かない', () => {
    const base: StudentEntry = { id: 'x', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }
    const paired = convertToWholeDayPairStudent(base, D, SLOT, formatStockOriginLabel)
    expect(paired).toMatchObject({ lessonType: 'makeup', makeupSourceDate: D, makeupSourceLabel: '2026/10/7(水) 5限', wholeDayPairSourceDate: D, origin: 'template' })
    expect(inferStudentOrigin(paired)).toBe('template')
    expect(resolveStudentOrigin(paired)).toBe('template')
    expect(isWholeDayPairExpandedStudent(paired)).toBe(true)
    expect(resolveStudentOrigin({ ...paired, origin: 'manual' })).toBe('manual')
    expect(isWholeDayPairExpandedStudent({ ...paired, origin: 'manual' })).toBe(false)
    // 印の無い普通の振替は従来どおり手入力。
    expect(inferStudentOrigin({ ...base, lessonType: 'makeup', makeupSourceDate: D })).toBe('manual')
  })

  it('動かすと印が外れて手入力になる（同じ日の中でも・別の日でも）', () => {
    const paired = convertToWholeDayPairStudent({ id: 'x', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }, D, SLOT, formatStockOriginLabel)
    for (const targetDateKey of [D2, '2026-10-21']) {
      const moved = prepareStudentForMove(paired, D2, SLOT, targetDateKey)
      expect(moved.wholeDayPairSourceDate).toBeUndefined()
      expect(moved.origin).toBe('manual')
      expect(moved.makeupSourceDate).toBe(D)
    }
  })
})

describe('組を作る（computeWholeDayTransferPair）', () => {
  it('4-1: 別の曜日の日は選べない（盤面は変わらない）', () => {
    const result = pairOf(baseBoard(), { target: '2026-10-15' })
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.message).toContain('同じ曜日')
  })

  it('出欠記録・既存の組・以前の形の丸ごと振替・反映日より前・休日の振替先は止める', () => {
    const board = baseBoard()
    expect(pairOf(board, { suppressed: [KEY] }).status).toBe('blocked')
    expect(pairOf(board, { suppressed: ['TEMPLATE_TEACHER__DAY__2026-10-14__0'] }).status).toBe('blocked')
    expect(pairOf(board, { classroomSettings: settings({ templateFreezeBeforeDate: '2026-10-08' }) }).status).toBe('blocked')
    expect(pairOf(board, { classroomSettings: settings({ holidayDates: [D2] }) }).status).toBe('blocked')
    // テンプレの授業も手入力も無い日（木曜）から木曜へは移すものが無い。
    expect(pairOf(board, { source: '2026-10-08', target: '2026-10-15' })).toEqual({ status: 'blocked', message: '振替元の日に移動できる授業がありません。' })
    const withRecord = structuredClone(board)
    const d2Cell = cellAt(withRecord, D2)
    d2Cell.desks[0].statusSlots = [buildStudentStatusEntry(d2Cell.desks[0].lesson!.studentSlots[0]!, d2Cell, d2Cell.desks[0], 'attended'), null]
    expect(pairOf(withRecord).status).toBe('blocked')
    // メニュー押下の軽い判定: 中身が無くても始められる（テンプレから展開する）・出欠記録は止める。
    expect(resolveWholeDayTransferPairSourceBlockReason(cellsOf(board, D))).toBeNull()
    expect(resolveWholeDayTransferPairSourceBlockReason(cellsOf(withRecord, D2))).toContain('出欠記録')
  })

  it('4-2: 組が 1 本だけ抑止キーに残る（在庫台帳・希望回数は触らない＝戻り値に持たない）', () => {
    const result = pairedOrThrow(pairOf(baseBoard()))
    expect(result.nextSuppressedRegularLessonOccurrences).toEqual([KEY])
    expect(Object.keys(result)).not.toContain('nextManualMakeupAdjustments')
    expect(Object.keys(result)).not.toContain('nextScheduleCountAdjustments')
  })

  it('4-3: D\' の同じ時限・同じ机番号に D のテンプレが「振)」（出自テンプレ）で出て、D は空で「休)」記録', () => {
    const result = pairedOrThrow(pairOf(baseBoard()))
    expect(seatIds(result.nextWeeks, D2)).toEqual([['sA', null], ['sB', null]])
    expect(studentAt(result.nextWeeks, D2, 0)).toMatchObject({ lessonType: 'makeup', makeupSourceDate: D, wholeDayPairSourceDate: D, origin: 'template' })
    expect(cellAt(result.nextWeeks, D2).desks.map((desk) => desk.teacher)).toEqual(['田中', '鈴木'])
    expect(seatIds(result.nextWeeks, D)).toEqual([[], []])
    expect(recordIds(result.nextWeeks, D)).toEqual([['moved:sA', null], ['moved:sB', null]])
    const record = cellAt(result.nextWeeks, D).desks[0].statusSlots![0]!
    expect(record).toMatchObject({ wholeDayPairDerived: true, moveDestinationDateKey: D2, moveDestinationSlotNumber: SLOT, teacherName: '田中' })
    // 講師だけの机（水 4限 佐藤）も D' へ付け替わり、D には出ない。
    expect(cellAt(result.nextWeeks, D2, 4).desks[0].teacher).toBe('佐藤')
    expect(cellAt(result.nextWeeks, D, 4).desks[0].teacher).toBe('')
    expect(result.summary).toMatchObject({ expandedStudentCount: 2, movedManualCount: 0, removedTargetTemplateCount: 2, pendingCount: 0 })
    expect(buildWholeDayTransferPairConfirmMessage(D, D2, result.summary)).toContain('「休)」')
  })

  it('4-3: テンプレを変えると D の新テンプレに追従する（テンプレ保存でも、読み込み時の再マージでも）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const saved = save(paired.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(saved.nextWeeks, D2)).toEqual([['sA', 'sC'], ['sB', null]])
    expect(studentAt(saved.nextWeeks, D2, 0, 1)).toMatchObject({ lessonType: 'makeup', makeupSourceDate: D, origin: 'template' })
    expect(recordIds(saved.nextWeeks, D)).toEqual([['moved:sA', 'moved:sC'], ['moved:sB', null]])
    // 4-2: テンプレの保存は組を消さない。
    expect(saved.removedSuppressedRegularLessonOccurrences).not.toContain(KEY)
    const remerged = remerge(paired.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(remerged, D2)).toEqual([['sA', 'sC'], ['sB', null]])
    expect(recordIds(remerged, D)).toEqual([['moved:sA', 'moved:sC'], ['moved:sB', null]])
    // 同じ机の生徒を替えた（青木 → 土屋）: 再マージでも前の付け替えの生徒は残らず、新テンプレの生徒に置き直る（付け替えの授業もテンプレが置き場を決める）。
    const replacedRows = [row('r0', 't1', 'sD'), ROWS[1], ROWS[2]]
    const replaced = remerge(paired.nextWeeks, replacedRows, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(replaced, D2)).toEqual([['sD', null], ['sB', null]])
    expect(recordIds(replaced, D)).toEqual([['moved:sD', null], ['moved:sB', null]])
    // テンプレから外した生徒は（テンプレの保存で）D' からも D の「休)」からも消える。
    const removed = save(saved.nextWeeks, [ROWS[0], ROWS[2]], paired.nextSuppressedRegularLessonOccurrences, { previousRegularLessons: ROWS_WITH_C }).nextWeeks
    expect(seatIds(removed, D2)).toEqual([['sA', null], []])
    expect(recordIds(removed, D)).toEqual([['moved:sA', null], [null, null]])
  })

  it('4-2: D を休日設定にしても組は残り、D のテンプレが D\' に出続ける', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const holiday = settings({ holidayDates: [D] })
    const remerged = remerge(paired.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences, holiday)
    expect(seatIds(remerged, D2)).toEqual([['sA', 'sC'], ['sB', null]])
    expect(recordIds(remerged, D)).toEqual([['moved:sA', 'moved:sC'], ['moved:sB', null]])
  })

  it('4-4: D\' 自身のテンプレは組がある間は出ず（在庫にも入れない）、組を消すと戻る', () => {
    // 10/14 からだけ有効な 3限の行（D\' 自身のテンプレにだけある授業）。
    const rows = [...ROWS, row('r3', 't4', 'sD', '', { slotNumber: 3, startDate: D2 })]
    const board = remerge(buildBoard(rows), rows, [])
    expect(seatIds(board, D2, 3)).toEqual([['sD', null], []])
    const paired = pairedOrThrow(pairOf(board, { rows }))
    expect(seatIds(paired.nextWeeks, D2, 3)).toEqual([[], []])
    expect(remerge(paired.nextWeeks, rows, paired.nextSuppressedRegularLessonOccurrences)).toEqual(paired.nextWeeks)
    // 会計の監査: D' 自身のテンプレ（土屋の 3限）は期待に数えない＝「無言の消失」にならない（決定記録 2）。
    const violations = auditTemplateLessonAccounting({
      weeks: paired.nextWeeks, regularLessons: rows, students, classroomSettings: settings(), scheduleCountAdjustments: [], manualMakeupAdjustments: {},
      fromDate: D, toDate: '2026-10-18', suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences,
    })
    expect(violations, describeLessonAccountingViolations(violations)).toEqual([])
    const released = releaseOf(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences, { rows })
    if (released.status !== 'transferred') throw new Error(released.message)
    expect(released.nextSuppressedRegularLessonOccurrences).toEqual([])
    expect(seatIds(released.nextWeeks, D2, 3)).toEqual([['sD', null], []])
    expect(studentAt(released.nextWeeks, D2, 0)).toMatchObject({ lessonType: 'regular' })
    expect(studentAt(released.nextWeeks, D2, 0)?.wholeDayPairSourceDate).toBeUndefined()
    expect(seatIds(released.nextWeeks, D)).toEqual([['sA', null], ['sB', null]])
    expect(recordIds(released.nextWeeks, D)).toEqual([[null, null], [null, null]])
  })

  it('解除は D\' に出欠記録があれば止める（付け替えの「休)」記録は数えない）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    expect(releaseOf(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences, { dateKey: D }).status).toBe('transferred')
    const withRecord = structuredClone(paired.nextWeeks)
    cellAt(withRecord, D2).desks[0].statusSlots = [{ ...cellAt(paired.nextWeeks, D).desks[0].statusSlots![0]!, wholeDayPairDerived: undefined, status: 'attended', dateKey: D2 }, null]
    const blocked = releaseOf(withRecord, paired.nextSuppressedRegularLessonOccurrences)
    expect(blocked.status).toBe('blocked')
    expect(stripWholeDayPairDerivedRecords(cellAt(paired.nextWeeks, D)).desks.every((desk) => !desk.statusSlots)).toBe(true)
  })

  it('D の手入力は D\' の同じ席へ移り（手入力のまま）、D\' の同じ席に手入力があれば止める', () => {
    const board = baseBoard()
    const trial: StudentEntry = { id: 'trial-1', name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' }
    const withTrial = structuredClone(board)
    cellAt(withTrial, D).desks[1].lesson!.studentSlots[1] = trial
    cellAt(withTrial, D).desks[0].memoSlots = [null, '自習']
    const paired = pairedOrThrow(pairOf(withTrial))
    expect(studentAt(paired.nextWeeks, D2, 1, 1)).toMatchObject({ id: 'trial-1', lessonType: 'trial', origin: 'manual' })
    expect(cellAt(paired.nextWeeks, D2).desks[0].memoSlots).toEqual([null, '自習'])
    expect(studentAt(paired.nextWeeks, D, 1, 1)).toBeNull()
    expect(paired.summary.movedManualCount).toBe(2)
    const conflict = structuredClone(withTrial)
    cellAt(conflict, D2).desks[1].lesson!.studentSlots[1] = { ...trial, id: 'trial-2', name: '体験生2' }
    const blocked = pairOf(conflict)
    expect(blocked.status).toBe('blocked')
    if (blocked.status === 'blocked') expect(blocked.message).toContain('5限 2机目')
  })

  it('付け替えの授業を D\' で消す・別の日へ動かすと、移動元 D の日付で削除記録が積まれ再マージで生き返らない（印は外れる・監査 要修正-B）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const d2 = cellAt(paired.nextWeeks, D2)
    const moved = computeStudentMove({
      weeks: paired.nextWeeks, weekIndex: 1, cells: paired.nextWeeks[1], movingStudentId: studentAt(paired.nextWeeks, D2, 0)!.id,
      cellId: cellAt(paired.nextWeeks, '2026-10-15').id, deskIndex: 0, studentIndex: 0,
      suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences,
      managedStudentByAnyName: new Map(students.map((student) => [student.name, student])), resolveBoardStudentDisplayName: (name: string) => name,
      templateOriginRules: true,
    })
    if (moved.status !== 'moved') throw new Error(moved.message)
    expect(moved.nextSuppressedRegularLessonOccurrences).toContain(`sA__数__${D}__${SLOT}`)
    expect(moved.nextSuppressedRegularLessonOccurrences).not.toContain(`sA__数__${D2}__${SLOT}`)
    expect(d2.id).toBeTruthy()
    const remerged = remerge(moved.nextWeeks, ROWS, moved.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(remerged, D2)).toEqual([[], ['sB', null]])
    const landed = studentAt(remerged, '2026-10-15', 0)
    expect(landed).toMatchObject({ managedStudentId: 'sA', origin: 'manual' })
    expect(landed?.wholeDayPairSourceDate).toBeUndefined()
    // D の「休)」記録も D' に出さなくなった生徒には付けない。
    expect(recordIds(remerged, D)).toEqual([[null, null], ['moved:sB', null]])
  })

  it('INV-06: 付け替えは会計の監査（auditTemplateLessonAccounting）で説明できる（D の授業＝D\' の振替・D\' 自身のテンプレは数えない）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const saved = save(paired.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences)
    for (const weeks of [paired.nextWeeks, saved.nextWeeks]) {
      const violations = auditTemplateLessonAccounting({
        weeks, regularLessons: weeks === paired.nextWeeks ? ROWS : ROWS_WITH_C, students, classroomSettings: settings(), scheduleCountAdjustments: [], manualMakeupAdjustments: {},
        fromDate: D, toDate: '2026-10-18', suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences,
      })
      expect(violations, describeLessonAccountingViolations(violations)).toEqual([])
    }
  })
})

function cellsOf(weeks: SlotCell[][], dateKey: string) {
  return weeks.flat().filter((cell) => cell.dateKey === dateKey)
}

describe('4-7: 保護者 QR の日程（本体と Functions の複製が同じ）', () => {
  it('D は「お休み → 振替先 D\'」、D\' は振替（振替元 D）で出る', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const payload = { students, teachers, regularLessons: ROWS, classroomSettings: settings(), boardState: { weeks: paired.nextWeeks, suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences } }
    const range = { from: '2026-10-05', to: '2026-10-18' }
    const view = buildParentScheduleView(payload, 'sA', range)
    expect(buildGeneratedParentScheduleView(payload, 'sA', range)).toEqual(view)
    const byDate = Object.fromEntries((view?.days ?? []).map((day) => [day.dateKey, day.lessons]))
    expect(byDate[D]).toEqual([expect.objectContaining({ slotNumber: SLOT, kind: 'absent', makeupDestination: { dateKey: D2, slotNumber: SLOT } })])
    expect(byDate[D2]).toEqual([expect.objectContaining({ slotNumber: SLOT, kind: 'makeup', makeupOrigin: { dateKey: D, slotNumber: SLOT } })])
  })
})

describe('4-8 / INV-05: 予定数は移動元 D の月で数える（月をまたぐ組）', () => {
  const SRC = '2026-10-28'
  const DST = '2026-11-04'
  const crossSettings = settings({ templateFreezeBeforeDate: SRC })
  const regularCount = (weeks: SlotCell[][], startDate: string, endDate: string) => {
    const payload = buildStudentPayload({
      cells: weeks.flat(), defaultStartDate: startDate, defaultEndDate: endDate, titleLabel: '段4', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] },
      students, teachers, regularLessons: ROWS, boardBasedPlannedCountEnabled: true,
    })
    const vm = buildStudentSheetViewModel(payload, { startDate, endDate, studentId: 'sA', todayKey: '2026-10-01' })!
    return { actual: vm.regularCountRows.reduce((sum, item) => sum + item.count, 0), planned: vm.regularCountRows.reduce((sum, item) => sum + item.desired, 0), payload }
  }
  it('組が無ければ各月 1 回、組があれば 10 月に 1 回（11/4 の振替を 10 月に数える）・11 月に 0 回（実績・予定とも同じ＝不一致の警告にならない）', () => {
    const board = remerge(buildBoard(ROWS, crossSettings, MONTH_CROSS_WEEKS), ROWS, [], crossSettings)
    expect(regularCount(board, '2026-10-01', '2026-10-31')).toMatchObject({ actual: 1, planned: 1 })
    expect(regularCount(board, '2026-11-01', '2026-11-30')).toMatchObject({ actual: 1, planned: 1 })
    const paired = pairedOrThrow(pairOf(board, { source: SRC, target: DST, classroomSettings: crossSettings }))
    expect(studentAt(paired.nextWeeks, DST, 0)).toMatchObject({ wholeDayPairSourceDate: SRC })
    // 10 月: 10/28 の授業（11/4 に付け替え）を 10 月に数える。11 月: 11/4 自身のテンプレは出さないので 0。
    const october = regularCount(paired.nextWeeks, '2026-10-01', '2026-10-31')
    expect(october).toMatchObject({ actual: 1, planned: 1 })
    expect(regularCount(paired.nextWeeks, '2026-11-01', '2026-11-30')).toMatchObject({ actual: 0, planned: 0 })
    // 判定の部品（埋め込み版と同じ規則）
    const lesson = october.payload.cells.find((cell) => cell.dateKey === DST && cell.slotNumber === SLOT)!.desks[0].lesson!.students[0]
    expect(lesson.wholeDayPairSourceDate).toBe(SRC)
    expect(isWholeDayPairCountedOutside(lesson, '2026-11-01', '2026-11-30')).toBe(true)
    expect(isWholeDayPairCountedOutside(lesson, '2026-10-01', '2026-10-31')).toBe(false)
    expect(countWholeDayPairLessonsFromOutside(october.payload, october.payload.students.find((item) => item.id === 'sA')!, '2026-10-01', '2026-10-31')).toEqual(['数'])
  })
})

describe('4-9: 休日の振替の追従（旧 Q40-1）は今どおり消す・付け替えの授業は孤児にしない', () => {
  it('テンプレから外れた生徒の、休日の振替は外す対象・付け替えの振替は対象外', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const weeks = structuredClone(paired.nextWeeks)
    // 9/30（水・休日）の千葉の授業の振替を 10/15 に置いた形。テンプレには千葉が居ない＝根拠なし。
    cellAt(weeks, '2026-10-15').desks[0].lesson = { id: 'm1', studentSlots: [{ id: 'mk', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-10-07', makeupSourceLabel: '2026/10/7(水) 5限' }, null] }
    const orphaned = collectOrphanedMakeups({
      weeks, templateCells: [], regularLessons: ROWS, manualMakeupAdjustments: {}, resolveLedgerOriginDates: () => ({}), effectiveStartDate: D, pendingDesks: {},
    })
    expect(orphaned.removals.map((item) => item.student.managedStudentId)).toEqual(['sC'])
  })
})

describe('INV-03: 作成・保存・解除は再マージの不動点', () => {
  it('作った直後・テンプレ保存の後・2 行のある盤面・解除の後に再マージしても盤面が変わらない', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    expect(snapshot(remerge(paired.nextWeeks, ROWS, paired.nextSuppressedRegularLessonOccurrences))).toBe(snapshot(paired.nextWeeks))
    const saved = save(paired.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences)
    expect(snapshot(remerge(saved.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences, settings(), saved.nextPendingDesks))).toBe(snapshot(saved.nextWeeks))
    const savedAgain = save(saved.nextWeeks, ROWS_WITH_C, paired.nextSuppressedRegularLessonOccurrences, { previousRegularLessons: ROWS_WITH_C })
    expect(snapshot(savedAgain.nextWeeks)).toBe(snapshot(saved.nextWeeks))
    const released = releaseOf(saved.nextWeeks, paired.nextSuppressedRegularLessonOccurrences, { rows: ROWS_WITH_C })
    if (released.status !== 'transferred') throw new Error(released.message)
    expect(snapshot(remerge(released.nextWeeks, ROWS_WITH_C, released.nextSuppressedRegularLessonOccurrences, settings(), released.nextTemplatePendingDesks))).toBe(snapshot(released.nextWeeks))
  })
})

// 2026-11-07（オーナー指示「直して」の 2 件目の調査）: 「作成で D から D' へ移した手入力（印 wholeDayPairMovedFrom）を D' で削除してからテンプレを保存すると、
// D のテンプレの生徒が D' に出る（再マージでは出ない）」という報告を、削除・休み・別の日への移動 × 移した手入力 3 種で再現した。
// 結果: 削除の直後の盤面には出ないが、テンプレ保存（computeTemplateDiffApplyForBoard）と再マージ（読み込み直し）はどちらも同じ答え（D のテンプレの生徒が D' に出る）。
// 保存と再マージは割れていない（INV-03 は成り立つ）。削除の直後に出ないのは、§2-2 で手入力に負けて置かなかったテンプレの生徒は次の再マージ・保存で
// 置き直す（付け替えでない日の手入力の削除と同じ）ため。ここではその不動点を固定する。
describe('INV-03: D から D\' へ移した手入力を D\' で外した盤面も、テンプレ保存と再マージが同じ答え（2026-11-07 調査）', () => {
  const byName = new Map(students.map((student) => [student.name, student]))
  const resolveKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => student.managedStudentId ?? student.name
  const setups: Record<string, (weeks: SlotCell[][]) => void> = {
    体験: (weeks) => { cellAt(weeks, D).desks[1].lesson!.studentSlots[1] = { id: 'trial-1', name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' } },
    同じ生徒の在庫の振替: (weeks) => { cellAt(weeks, D).desks[1].lesson!.studentSlots[1] = { id: 'mkA', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '英', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 5限', origin: 'manual' } },
    科目を変えたテンプレの授業: (weeks) => { const seat = cellAt(weeks, D).desks[0].lesson!.studentSlots; seat[0] = { ...seat[0]!, subject: '英', origin: 'manual' } },
  }
  const pairedWith = (setup: (weeks: SlotCell[][]) => void) => {
    const board = structuredClone(baseBoard())
    setup(board)
    return pairedOrThrow(pairOf(remerge(board, ROWS, [])))
  }
  const movedSeat = (weeks: SlotCell[][]) => {
    const desks = cellAt(weeks, D2).desks
    const deskIndex = desks.findIndex((desk) => desk.lesson?.studentSlots.some((student) => student?.wholeDayPairMovedFrom))
    const studentIndex = desks[deskIndex]!.lesson!.studentSlots.findIndex((student) => student?.wholeDayPairMovedFrom)
    return { cellId: cellAt(weeks, D2).id, deskIndex, studentIndex, student: desks[deskIndex]!.lesson!.studentSlots[studentIndex]! }
  }
  const ops = {
    削除: (weeks: SlotCell[][], suppressed: string[]) => {
      const next = structuredClone(weeks)
      const seat = movedSeat(next)
      const keys = resolveRemovedLessonOccurrenceKeysFor(seat.student, D2, SLOT, true)
      const desk = cellAt(next, D2).desks[seat.deskIndex]
      desk.lesson!.studentSlots[seat.studentIndex] = null
      if (!desk.lesson!.studentSlots[0] && !desk.lesson!.studentSlots[1]) desk.lesson = undefined
      return { weeks: next, suppressed: [...suppressed, ...keys.filter((key) => !suppressed.includes(key))], manual: {} }
    },
    休み: (weeks: SlotCell[][], suppressed: string[]) => {
      const seat = movedSeat(weeks)
      const absent = computeStudentAbsentMark({
        weeks, weekIndex: 1, seat, manualMakeupAdjustments: {}, suppressedMakeupOrigins: {}, fallbackMakeupStudents: {}, manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackLectureStockStudents: {},
        suppressedRegularLessonOccurrences: suppressed, ledgerOriginDatesByKey: {}, managedStudentByAnyName: byName, resolveDisplayName: (name: string) => name, resolveStockId: resolveKey, templateOriginRules: true,
      })
      if (!absent) throw new Error('not found')
      return { weeks: absent.nextWeeks, suppressed: absent.ledgers.suppressedRegularLessonOccurrences, manual: absent.ledgers.manualMakeupAdjustments }
    },
    別の日へ移動: (weeks: SlotCell[][], suppressed: string[]) => {
      const seat = movedSeat(weeks)
      const moved = computeStudentMove({
        weeks, weekIndex: 1, cells: weeks[1], movingStudentId: seat.student.id, cellId: cellAt(weeks, '2026-10-15').id, deskIndex: 1, studentIndex: 1,
        suppressedRegularLessonOccurrences: suppressed, managedStudentByAnyName: byName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: true,
        sourceSeat: { cellId: seat.cellId, deskIndex: seat.deskIndex, studentIndex: seat.studentIndex },
      })
      if (moved.status !== 'moved') throw new Error(moved.message)
      return { weeks: moved.nextWeeks, suppressed: moved.nextSuppressedRegularLessonOccurrences, manual: {} }
    },
  }

  for (const [setupName, setup] of Object.entries(setups)) {
    for (const [opName, op] of Object.entries(ops)) {
      it(`${setupName}を D' で${opName} → 再マージとテンプレ保存の盤面・記録・在庫が同じ`, () => {
        const paired = pairedWith(setup)
        const after = op(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences)
        const remerged = remerge(after.weeks, ROWS, after.suppressed)
        const saved = save(after.weeks, ROWS, after.suppressed, { manualMakeupAdjustments: after.manual })
        for (const dateKey of [D, D2, '2026-10-15']) {
          expect(JSON.stringify(cellAt(saved.nextWeeks, dateKey)), dateKey).toBe(JSON.stringify(cellAt(remerged, dateKey)))
        }
        expect(balances(saved.nextWeeks, ROWS, after.manual)).toEqual(balances(remerged, ROWS, after.manual))
      })
    }
  }

  it('真因（2026-11-07）: 科目を変えたテンプレの授業を D\' から別の日へ動かしても、D のテンプレの A（元の科目）を D\' に出さない（保存でも再マージでも・同じ机に別の生徒が残っても A は 1 コマ）', () => {
    // 修正前: 暗黙のキー（振替から導く）が振替の今の科目（英）で作られ D のテンプレの A（数）に当たらなかった。机が空くと講師が手置きに固定され、
    //   再マージはその机へ A を戻さず、保存だけが A を D' に置いた（割れる）。机に千葉が残ると両方とも A を D' に置き、A が D' と 10/15 の 2 コマになった。
    for (const rows of [ROWS, ROWS_WITH_C]) {
      const board = structuredClone(remerge(buildBoard(rows), rows, []))
      const seat = cellAt(board, D).desks[0].lesson!.studentSlots
      seat[0] = { ...seat[0]!, subject: '英', origin: 'manual' }
      const paired = pairedOrThrow(pairOf(remerge(board, rows, []), { rows }))
      const after = ops.別の日へ移動(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences)
      const placesOfA = (weeks: SlotCell[][]) => weeks.flat().flatMap((cell) => cell.desks.flatMap((desk) => (desk.lesson?.studentSlots ?? []).filter((student) => student?.managedStudentId === 'sA').map((student) => `${cell.dateKey}:${student!.subject}`)))
      const remerged = remerge(after.weeks, rows, after.suppressed)
      const saved = save(after.weeks, rows, after.suppressed, { previousRegularLessons: rows })
      expect(placesOfA(remerged), JSON.stringify(rows.map((item) => item.student2Id))).toEqual(['2026-10-15:英'])
      expect(placesOfA(saved.nextWeeks)).toEqual(['2026-10-15:英'])
      expect(JSON.stringify(cellAt(saved.nextWeeks, D2))).toBe(JSON.stringify(cellAt(remerged, D2)))
    }
  })

  it('削除の後は、D のテンプレの生徒が D\' に出る（保存でも再マージでも・付け替えでない日の手入力の削除と同じ）。D の記録は「休)→D\'」', () => {
    const paired = pairedWith(setups.同じ生徒の在庫の振替)
    const after = ops.削除(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(after.weeks, D2)).toEqual([[], ['sB', null]])
    expect(seatIds(remerge(after.weeks, ROWS, after.suppressed), D2)).toEqual([['sA', null], ['sB', null]])
    expect(seatIds(save(after.weeks, ROWS, after.suppressed).nextWeeks, D2)).toEqual([['sA', null], ['sB', null]])
    expect(recordIds(remerge(after.weeks, ROWS, after.suppressed), D)).toEqual([['moved:sA', null], ['moved:sB', null]])
  })

  // 仕様の判断待ち（2026-11-07 報告）: 「編集」で科目だけ変えたテンプレの授業（A 数→英）を付け替えで D' へ移し、D' で削除すると、テンプレの A（数）が D' に戻る
  //   （保存・再マージとも）。付け替えでない日なら §4-1-2（2026-11-07 オーナー決定）で戻らない。付け替えで移した手入力は振替（makeup）になり抑止キーを積まないため。
  it.todo('§4-1-2 の兄弟（判断待ち）: 科目だけ変えたテンプレの授業を付け替えで D\' へ移してから D\' で削除したら、テンプレの元の科目は D\' に戻らない（戻すなら今のまま）')
  // 調査で見つかった別の穴（2026-11-07・判断待ち）: 移した手入力が D のテンプレの同じ生徒（上の 2 種）だと、§9-21 の「D' に同じ生徒の手入力が先にある」とみなされ、
  //   D の記録が「休み」になって作成だけで未消化振替が +1 になる（付け替えは在庫中立＝§3 に反する・作成前は §2-2 で数えていない）。
  it.todo('INV-06（判断待ち）: 作成で D から移した手入力は §9-21 の「先にあった手入力」に数えず、D の記録は「休)→D\'」のまま（作成で未消化振替が増えない）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 段 4 監査（2026-11-05・HEAD d0f8283）の要修正・要確認と §9-20 / §9-21
// ─────────────────────────────────────────────────────────────────────────────

describe('監査 重大-1(b): D の日付の抑止キーは再マージと差分反映で同じ結果', () => {
  it('D の日付の削除記録（青木）があると、再マージでもテンプレの保存でも D\' の付け替えから青木だけ外れる（ほかは残る・在庫 0）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const keys = [...paired.nextSuppressedRegularLessonOccurrences, `sA__数__${D}__${SLOT}`]
    const remerged = remerge(paired.nextWeeks, ROWS, keys)
    const saved = save(paired.nextWeeks, ROWS, keys)
    expect(seatIds(remerged, D2)).toEqual([[], ['sB', null]])
    expect(seatIds(saved.nextWeeks, D2)).toEqual(seatIds(remerged, D2))
    expect(snapshot(remerge(saved.nextWeeks, ROWS, keys, settings(), saved.nextPendingDesks))).toBe(snapshot(saved.nextWeeks))
    expect(Object.keys(saved.nextPendingDesks)).toEqual([])
    expect(balancesOf(saved.nextWeeks)).toEqual({})
  })
})

describe('監査 要修正-A / 4-8: 付け替えの授業を出席・振無休にしても D の月で数える', () => {
  const SRC = '2026-10-28'
  const DST = '2026-11-04'
  const crossSettings = settings({ templateFreezeBeforeDate: SRC })
  const count = (weeks: SlotCell[][], startDate: string, endDate: string) => {
    const payload = buildStudentPayload({
      cells: weeks.flat(), defaultStartDate: startDate, defaultEndDate: endDate, titleLabel: '段4', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] },
      students, teachers, regularLessons: ROWS, boardBasedPlannedCountEnabled: true,
    })
    const vm = buildStudentSheetViewModel(payload, { startDate, endDate, studentId: 'sA', todayKey: '2026-10-01' })!
    return { actual: vm.regularCountRows.reduce((sum, item) => sum + item.count, 0), planned: vm.regularCountRows.reduce((sum, item) => sum + item.desired, 0), payload }
  }
  for (const status of ['attended', 'absent-no-makeup'] as const) {
    it(`${status}: 記録にしても 10 月に 1 回・11 月に 0 回（画面版）。書き出しに振替元 D が載る（埋め込み版が読む）`, () => {
      const board = remerge(buildBoard(ROWS, crossSettings, MONTH_CROSS_WEEKS), ROWS, [], crossSettings)
      const paired = pairedOrThrow(pairOf(board, { source: SRC, target: DST, classroomSettings: crossSettings }))
      const weeks = structuredClone(paired.nextWeeks)
      const cell = cellAt(weeks, DST)
      const record = buildStudentStatusEntry(cell.desks[0].lesson!.studentSlots[0]!, cell, cell.desks[0], status)
      cell.desks[0].lesson = undefined
      cell.desks[0].statusSlots = [record, null]
      expect(record.wholeDayPairSourceDate).toBe(SRC)
      const october = count(weeks, '2026-10-01', '2026-10-31')
      expect(october).toMatchObject({ actual: 1, planned: 1 })
      expect(count(weeks, '2026-11-01', '2026-11-30')).toMatchObject({ actual: 0, planned: 0 })
      const serialized = october.payload.cells.find((item) => item.dateKey === DST && item.slotNumber === SLOT)!.desks[0].statuses![0]!
      expect(serialized.wholeDayPairSourceDate).toBe(SRC)
      expect(resolveWholeDayPairCountDateKey(serialized, DST)).toBe(SRC)
      expect(resolveWholeDayPairCountDateKey({}, DST)).toBe(DST)
    })
  }
})

describe('§9-20: 作成 → 解除で元の形へ戻る（D から移した手入力も D へ戻る）', () => {
  it('体験・メモを D に置いた盤面で、作成 → 解除の盤面・保留・抑止キー・在庫が作成前と同じ', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[1].lesson!.studentSlots[1] = { id: 'trial-1', name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' }
    cellAt(before, D).desks[0].memoSlots = [null, '自習']
    const settledBefore = remerge(before, ROWS, [])
    const paired = pairedOrThrow(pairOf(settledBefore))
    expect(studentAt(paired.nextWeeks, D2, 1, 1)?.wholeDayPairMovedFrom).toMatchObject({ dateKey: D })
    expect(cellAt(paired.nextWeeks, D2).desks[0].wholeDayPairMovedMemoFrom).toEqual([null, { dateKey: D, text: '自習' }])
    const released = releaseOf(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences)
    if (released.status !== 'transferred') throw new Error(released.message)
    expect(released.nextWeeks).toEqual(settledBefore)
    expect(released.nextSuppressedRegularLessonOccurrences).toEqual([])
    expect(released.nextTemplatePendingDesks).toEqual({})
    expect(balancesOf(released.nextWeeks)).toEqual(balancesOf(settledBefore))
  })

  it('D\' で後から手で置いた手入力は D\' に残す（移した印の無いもの）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const weeks = structuredClone(paired.nextWeeks)
    cellAt(weeks, D2, 4).desks[1].lesson = { id: 'later', studentSlots: [{ id: 'trial-9', name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' }, null] }
    const released = releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences)
    if (released.status !== 'transferred') throw new Error(released.message)
    expect(studentAt(released.nextWeeks, D2, 1, 0, 4)?.id).toBe('trial-9')
    expect(studentAt(released.nextWeeks, D, 1, 0, 4)).toBeNull()
  })
})

describe('監査 要確認-3（収束）: 組の無い形で作り直された D\' の週に組のキーを当てても付け替えの形に収束する', () => {
  it('D\' 自身の通常授業・D のテンプレの通常授業が残る盤面を、組のキーで再マージすると作成直後と同じ形', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const regenerated = remerge(baseBoard(), ROWS, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(regenerated, D2)).toEqual(seatIds(paired.nextWeeks, D2))
    expect(studentAt(regenerated, D2, 0)).toMatchObject({ lessonType: 'makeup', wholeDayPairSourceDate: D, origin: 'template' })
    expect(seatIds(regenerated, D)).toEqual([[], []])
    expect(recordIds(regenerated, D)).toEqual(recordIds(paired.nextWeeks, D))
    expect(snapshot(remerge(regenerated, ROWS, paired.nextSuppressedRegularLessonOccurrences))).toBe(snapshot(regenerated))
  })
})

describe('監査 要確認-5: フラグを OFF に戻しても、組のある日には「丸ごと振替を解除」を出す', () => {
  it('canReleaseWholeDayTransferPair は組の日だけ真・メニューはフラグで包まない', () => {
    expect(canReleaseWholeDayTransferPair([KEY], D)).toBe(true)
    expect(canReleaseWholeDayTransferPair([KEY], D2)).toBe(true)
    expect(canReleaseWholeDayTransferPair([KEY], '2026-10-21')).toBe(false)
    expect(canReleaseWholeDayTransferPair([], D)).toBe(false)
    const board = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
    expect(board).toContain('{canReleaseWholeDayTransferPair(suppressedRegularLessonOccurrences, dayHeaderMenu.dateKey) ? (')
    expect(board).not.toContain('templateDiffApplyEnabled && findWholeDayTransferPairForDate(')
    // 作るのは ON の教室だけ（OFF は第 1 版の computeWholeDayTransfer のまま）。
    expect(board).toContain('if (templateDiffApplyEnabled) {\n      handleWholeDayTransferPairTarget(sourceDateKey, targetDateKey)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 段 4 再監査（2026-11-05・4d548b7）
// ─────────────────────────────────────────────────────────────────────────────

const trialEntry = (id = 'trial-1'): StudentEntry => ({ id, name: '体験生', grade: '中1', subject: '数', lessonType: 'trial', teacherType: 'normal', manualAdded: true, origin: 'manual' })
const byStudentName = new Map(students.map((student) => [student.name, student]))
const weekIndexOf = (weeks: SlotCell[][], dateKey: string) => weeks.findIndex((week) => week.some((cell) => cell.dateKey === dateKey))
const releasedOrThrow = (result: ReturnType<typeof releaseOf>) => {
  if (result.status !== 'transferred') throw new Error(result.message)
  return result
}

describe('再監査 要修正-1: D から移した手入力は、D\' の中で動かした・並べ替えたら解除で D へ戻さない', () => {
  it('D から移した体験を D\' で別の時限へ動かすと解除で D\' に残る（印も外れる）', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[1].lesson!.studentSlots[1] = trialEntry()
    const paired = pairedOrThrow(pairOf(before))
    const index = weekIndexOf(paired.nextWeeks, D2)
    const moved = computeStudentMove({
      weeks: paired.nextWeeks, weekIndex: index, cells: paired.nextWeeks[index], movingStudentId: 'trial-1', cellId: cellAt(paired.nextWeeks, D2, 4).id, deskIndex: 1, studentIndex: 0,
      suppressedRegularLessonOccurrences: paired.nextSuppressedRegularLessonOccurrences, managedStudentByAnyName: byStudentName, resolveBoardStudentDisplayName: (name: string) => name, templateOriginRules: true,
    })
    if (moved.status !== 'moved') throw new Error(moved.message)
    expect(studentAt(moved.nextWeeks, D2, 1, 0, 4)?.wholeDayPairMovedFrom).toBeUndefined()
    const released = releasedOrThrow(releaseOf(moved.nextWeeks, moved.nextSuppressedRegularLessonOccurrences))
    expect(studentAt(released.nextWeeks, D2, 1, 0, 4)?.id).toBe('trial-1')
    expect(studentAt(released.nextWeeks, D, 1, 0, 4)).toBeNull()
    expect(studentAt(released.nextWeeks, D, 1, 1)).toBeNull()
  })

  it('D\' を並べ替えた後の解除は、違う席へは戻さず D\' に残す（印は外れる）', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[1].lesson!.studentSlots[1] = trialEntry()
    const paired = pairedOrThrow(pairOf(before))
    const weeks = structuredClone(paired.nextWeeks)
    // 並べ替えで体験が机 2 の生徒 2 → 机 1 の生徒 2 へ移った形（印は付いたまま・位置だけ変わる）。
    const target = cellAt(weeks, D2)
    target.desks[0].lesson!.studentSlots[1] = target.desks[1].lesson!.studentSlots[1]
    target.desks[1].lesson!.studentSlots[1] = null
    const released = releasedOrThrow(releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences))
    expect(studentAt(released.nextWeeks, D2, 0, 1)).toMatchObject({ id: 'trial-1' })
    expect(studentAt(released.nextWeeks, D2, 0, 1)?.wholeDayPairMovedFrom).toBeUndefined()
    expect(studentAt(released.nextWeeks, D, 0, 1)).toBeNull()
    expect(studentAt(released.nextWeeks, D, 1, 1)).toBeNull()
  })
})

describe('再監査 要修正-2: 机の印は移した中身を控え、D\' で替えた講師・書き換えたメモは D へ持っていかない', () => {
  const withTeacher = () => {
    const before = structuredClone(baseBoard())
    const desk = cellAt(before, D, 4).desks[1]
    Object.assign(desk, { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4' })
    desk.lesson = { id: 'manual-4', studentSlots: [trialEntry(), null] }
    return remerge(before, ROWS, [])
  }
  it('講師を移した場合の作成 → 解除が元と deep-equal', () => {
    const before = withTeacher()
    const paired = pairedOrThrow(pairOf(before))
    expect(cellAt(paired.nextWeeks, D2, 4).desks[1]).toMatchObject({ teacher: '高橋', wholeDayPairMovedTeacherFrom: { dateKey: D, teacher: '高橋', teacherId: 't4' } })
    const released = releasedOrThrow(releaseOf(paired.nextWeeks, paired.nextSuppressedRegularLessonOccurrences))
    expect(released.nextWeeks).toEqual(before)
  })
  it('D\' で講師を替えた机は解除で D へ戻さない（替えた講師は D\' に残る）', () => {
    const paired = pairedOrThrow(pairOf(withTeacher()))
    const weeks = structuredClone(paired.nextWeeks)
    Object.assign(cellAt(weeks, D2, 4).desks[1], { teacher: '田中', teacherAssignmentTeacherId: 't1' })
    const released = releasedOrThrow(releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences))
    expect(cellAt(released.nextWeeks, D2, 4).desks[1].teacher).toBe('田中')
    expect(cellAt(released.nextWeeks, D, 4).desks[1].teacher).toBe('')
    expect(cellAt(released.nextWeeks, D2, 4).desks[1].wholeDayPairMovedTeacherFrom).toBeUndefined()
  })
  it('D\' でメモを書き換えた席は戻さない（書き換えたメモは D\' に残る）', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[0].memoSlots = [null, '自習']
    const paired = pairedOrThrow(pairOf(remerge(before, ROWS, [])))
    const weeks = structuredClone(paired.nextWeeks)
    cellAt(weeks, D2).desks[0].memoSlots = [null, '自習（変更）']
    const released = releasedOrThrow(releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences))
    expect(cellAt(released.nextWeeks, D2).desks[0].memoSlots).toEqual([null, '自習（変更）'])
    expect(cellAt(released.nextWeeks, D).desks[0].memoSlots ?? [null, null]).toEqual([null, null])
    expect(cellAt(released.nextWeeks, D2).desks[0].wholeDayPairMovedMemoFrom).toBeUndefined()
  })
})

describe('再監査: 解除を止める経路（理由つき）', () => {
  it('戻す D の席がふさがっていると止める', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[1].lesson!.studentSlots[1] = trialEntry()
    const paired = pairedOrThrow(pairOf(before))
    const weeks = structuredClone(paired.nextWeeks)
    cellAt(weeks, D).desks[1].lesson = { id: 'later', studentSlots: [null, trialEntry('trial-2')] }
    const blocked = releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences)
    expect(blocked.status).toBe('blocked')
    if (blocked.status === 'blocked') expect(blocked.message).toContain('席がふさがっている')
  })
  it('移した手入力が保留の下段に移っていると止める', () => {
    const before = structuredClone(baseBoard())
    cellAt(before, D).desks[1].lesson!.studentSlots[1] = trialEntry()
    const paired = pairedOrThrow(pairOf(before))
    const weeks = structuredClone(paired.nextWeeks)
    const target = cellAt(weeks, D2)
    const moved = target.desks[1].lesson!.studentSlots[1]!
    target.desks[1].lesson!.studentSlots[1] = null
    const pending = { [`${target.id}::${target.desks[1].id}`]: { lower: { lesson: { id: 'lower', studentSlots: [moved, null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: D, createdAt: '2026-10-01T10:00:00.000Z' } }
    const blocked = releaseOf(weeks, paired.nextSuppressedRegularLessonOccurrences, { pendingDesks: pending })
    expect(blocked.status).toBe('blocked')
    if (blocked.status === 'blocked') expect(blocked.message).toContain('緑の下の行')
  })
})

describe('再監査 要確認-1〜4', () => {
  it('要確認-1: 以前の形の丸ごと振替が残る日（日単位の足場講師の抑止）は、新しい組の振替先にも振替元にも選べない（理由を出す）', () => {
    for (const legacyDate of [D2, D]) {
      const result = pairOf(baseBoard(), { suppressed: [`TEMPLATE_TEACHER__DAY__${legacyDate}__0`] })
      expect(result).toEqual({ status: 'blocked', message: `${legacyDate} には以前の形の丸ごと振替が残っているため、丸ごと振替できません。` })
    }
  })
  it('要確認-2: 付け替えの印の無い振替から導くキーは今までどおり効く（D の青木を別の日へ置いた振替があれば D\' に青木を出さない）', () => {
    const paired = pairedOrThrow(pairOf(baseBoard()))
    const weeks = structuredClone(paired.nextWeeks)
    cellAt(weeks, '2026-10-15').desks[0].lesson = { id: 'm', studentSlots: [{ id: 'mk', name: '青木', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: D, makeupSourceLabel: '2026/10/7(水) 5限', origin: 'manual' }, null] }
    const remerged = remerge(weeks, ROWS, paired.nextSuppressedRegularLessonOccurrences)
    expect(seatIds(remerged, D2)).toEqual([[], ['sB', null]])
    // 付け替えの授業そのものから導くキーは効かない（効くと D' の全員が消える）。
    expect(seatIds(remerge(paired.nextWeeks, ROWS, paired.nextSuppressedRegularLessonOccurrences), D2)).toEqual([['sA', null], ['sB', null]])
  })
  it('要確認-3: 組の D\' は盤面の印に加えて組のキーからも読む', () => {
    expect([...collectWholeDayPairTargetDates([], [KEY])]).toEqual([D2])
    expect([...collectWholeDayPairTargetDates([])]).toEqual([])
    // 盤面に D の記録も D' の授業も無くても、組のキーがあれば D' 自身のテンプレで休日振替を積まない。
    const holiday = settings({ holidayDates: [D2] })
    const empty = buildBoard(ROWS, holiday).map((week) => week.map((cell) => ({ ...cell, desks: cell.desks.map((desk) => ({ id: desk.id, teacher: '' })) })))
    const late = new Date('2026-10-20T00:00:00')
    expect(Object.keys(collectMakeupOriginDatesByKey({ students, regularLessons: ROWS, classroomSettings: holiday, weeks: empty, manualAdjustments: {}, resolveStudentKey: (student) => student.managedStudentId ?? student.name, today: late, wholeDayPairKeys: [KEY] }))).toEqual([])
    expect(Object.keys(collectMakeupOriginDatesByKey({ students, regularLessons: ROWS, classroomSettings: holiday, weeks: empty, manualAdjustments: {}, resolveStudentKey: (student) => student.managedStudentId ?? student.name, today: late })).sort()).toEqual(['sA__数', 'sB__数'])
  })
  it('要確認-4: 組の無い日の休日解除は、その日のテンプレの授業の抑止キーを積み、席へ戻した分は積まない（既にあるものも外す）', () => {
    const keys = resolveHolidayReleaseSuppressedOccurrences({
      dateKey: D, regularLessons: ROWS, students, teachers, suppressedRegularLessonOccurrences: [`sB__数__${D}__${SLOT}`, 'other__数__2026-10-21__5'], restoredOccurrenceKeys: new Set([`sB__数__${D}__${SLOT}`]),
    })
    expect(keys).toEqual(['other__数__2026-10-21__5', `sA__数__${D}__${SLOT}`])
    // 組の日は積まない（席へ戻した分を外すのは同じ）。
    expect(resolveHolidayReleaseSuppressedOccurrences({ dateKey: D, regularLessons: ROWS, students, teachers, suppressedRegularLessonOccurrences: [KEY], restoredOccurrenceKeys: new Set() })).toEqual([KEY])
  })
})

describe('再監査 要修正-3: 解除の確認文は §9-20（移した手入力は元の日へ戻す・後から置いたものは残す）', () => {
  it('確認文に戻す・残すの両方が出て、旧い「手入力はそのまま残します」は出ない', () => {
    const message = buildWholeDayTransferPairReleaseConfirmMessage({ sourceDateKey: D, targetDateKey: D2 })
    expect(message).toContain('10/7(水) から移した手入力は 10/7(水) の元の席へ戻します（10/14(水) で後から置いたものは残ります）')
    expect(message).not.toContain('手入力はそのまま残します')
  })
})
