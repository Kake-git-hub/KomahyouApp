// tools/ui-patrol/dayOps.ts(台本 g「休日設定と解除・丸ごと振替」の日付の選び方・休日設定の在庫の仕様の増減)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒sA〜・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import { collectDateDeskKeys, expectedHolidayStockDeltas, pickDayOpsPlan } from './dayOps.ts'

const TODAY = '2026-11-11'
// 4 週(11/16〜12/13)。木曜は 11/19・11/26・12/3・12/10。
const DATES = Array.from({ length: 28 }, (_, index) => new Date(Date.parse('2026-11-16T00:00:00Z') + index * 86400000).toISOString().slice(0, 10))

function student(key, lessonType = 'regular', overrides = {}) {
  return { id: `e-${key}`, name: `生徒${key}`, managedStudentId: key, grade: '中1', subject: '数', lessonType, teacherType: 'normal', origin: 'template', ...overrides }
}
function desk(id, teacher, slots = [null, null], overrides = {}) {
  return { id, teacher, lesson: { id: `L-${id}`, studentSlots: slots }, ...overrides }
}
function cell(dateKey, slotNumber, desks, overrides = {}) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: '', slotLabel: '', slotNumber, timeLabel: '', isOpenDay: true, desks, ...overrides }
}
function payloadOf(cells, { settings = {}, board = {} } = {}) {
  return {
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4, ...settings },
    managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [cells], weekIndex: 0, suppressedRegularLessonOccurrences: [], ...board },
  }
}
const sequence = (...values) => { let index = 0; return () => values[index++ % values.length] }

/** 木曜 4 日に同じ形のコマ(授業のある机＋空き机)。 */
function thursdays(extra = {}) {
  return ['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10'].map((dateKey, index) => cell(dateKey, 3, [
    desk(`a${index}`, '講師A', [student(`s${index}a`), student(`s${index}b`)]),
    desk(`b${index}`, '講師B', [student(`s${index}c`), null]),
    desk(`c${index}`, ''),
  ], extra[dateKey] ?? {}))
}

describe('pickDayOpsPlan(台本 g の日付の選び方)', () => {
  it('丸ごと振替は 振替元＝授業のある日・振替先＝同じ曜日の別の日(近い順に 3 つまで)。休日は残りの日から選ぶ。どれも今日より後', () => {
    const payload = payloadOf(thursdays())
    const plan = pickDayOpsPlan({ facts: collectBoardFacts(payload), payload, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(plan.transfer.sourceDateKey).toBe('2026-11-19')
    expect(plan.transfer.targetDateKeys).toEqual(['2026-11-26', '2026-12-03', '2026-12-10'])
    expect(plan.transfer.studentCount).toBe(3)
    // Issue #87: 振替先が全部断られたときに試す次の振替元(日付の順に 2 つまで・選んだ振替元は入れない)。
    expect(plan.transfer.otherSources.map((other) => other.sourceDateKey)).toEqual(['2026-11-26', '2026-12-03'])
    expect(plan.transfer.otherSources[0].targetDateKeys).toEqual(['2026-11-19', '2026-12-03', '2026-12-10'])
    // 休日は振替元と別の日。振替先の候補でない日を先に選び、無ければ振替先の候補の日も使う(休日は丸ごと振替の前に解除する)。
    expect(plan.holiday.dateKey).toBe('2026-11-26')
    expect(plan.holiday.studentCount).toBe(3)
    // 振替先の候補でない日(金曜)があればそちらを選ぶ
    const withFriday = payloadOf([...thursdays(), cell('2026-11-20', 3, [desk('f', '講師A', [student('sF'), null])])])
    expect(pickDayOpsPlan({ facts: collectBoardFacts(withFriday), payload: withFriday, dateKeys: DATES, todayKey: TODAY, random: sequence(0) }).holiday.dateKey).toBe('2026-11-20')
    expect(plan.skipped).toEqual([])
    // 同じ乱数なら同じ
    expect(pickDayOpsPlan({ facts: collectBoardFacts(payload), payload, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })).toEqual(plan)
  })

  it('選ばない日: 今日以前・休日・定休日を開けた日・休みの日(閉じたコマ)・出欠記録・保留・講師の休み・丸ごと振替の組。抑止キーのある日は選ぶ(本番では平日のほとんどにある)', () => {
    const cells = thursdays({ '2026-11-19': { isOpenDay: false } })
    // 11/26 は出欠記録、12/3 は講師の休み
    cells[1].desks[2] = desk('c1', '講師C', [null, null], { statusSlots: [{ id: 'x', studentId: 'e', name: '生徒x', managedStudentId: 'sx', subject: '英', lessonType: 'regular', status: 'absent', dateKey: '2026-11-26', slotNumber: 3 }, null] })
    cells[2].desks[2] = desk('c2', '', [null, null], { teacherRest: { teacher: '講師C' } })
    // 12/10 は抑止キーがあっても選べる(振替先の候補が無いので丸ごと振替は無し・休日は 12/10)
    const payload = payloadOf(cells, { board: { suppressedRegularLessonOccurrences: ['s3a__数__2026-12-10__3'] } })
    const plan = pickDayOpsPlan({ facts: collectBoardFacts(payload), payload, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(plan.transfer).toBeNull()
    expect(plan.holiday.dateKey).toBe('2026-12-10')
    cells[3].isOpenDay = false
    const closedPayload = payloadOf(cells)
    const closedPlan = pickDayOpsPlan({ facts: collectBoardFacts(closedPayload), payload: closedPayload, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(closedPlan.transfer).toBeNull()
    expect(closedPlan.holiday).toBeNull()
    expect(closedPlan.skipped.join('\n')).toContain('丸ごと振替')
    expect(closedPlan.skipped.join('\n')).toContain('休日設定')
    // 丸ごと振替の組の日・定休日を開けた日・休日も選ばない
    const paired = payloadOf(thursdays(), { settings: { forceOpenDates: ['2026-11-26'], holidayDates: ['2026-12-03'] }, board: { suppressedRegularLessonOccurrences: ['WHOLE_DAY_PAIR__2026-11-19__2026-12-10__0'] } })
    const pairedPlan = pickDayOpsPlan({ facts: collectBoardFacts(paired), payload: paired, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(pairedPlan.transfer).toBeNull()
    expect(pairedPlan.holiday).toBeNull()
    // 今日以前は選ばない
    const past = payloadOf(thursdays())
    expect(pickDayOpsPlan({ facts: collectBoardFacts(past), payload: past, dateKeys: DATES, todayKey: '2026-12-10', random: sequence(0) }).holiday).toBeNull()
  })

  it('振替先は 振替元の授業・講師と同じ席に手入力(生徒・メモ・講師)が無く、振替元の時限がそろい机の数が足りる日だけ。テンプレの反映日より前は振替元にも振替先にもしない', () => {
    const cells = thursdays()
    // 11/26: 振替元の生徒の席(机 1 席 1)に手入力 → 振替先にしない。重ならない席(机 3)の手入力は構わない(12/10)。
    cells[1].desks[0] = desk('a1', '講師A', [student('sm', 'regular', { origin: 'manual', manualAdded: true }), null])
    cells[3].desks[2] = desk('c3', '講師C', [student('sn', 'regular', { origin: 'manual', manualAdded: true }), null], { manualTeacher: true })
    cells[2] = cell('2026-12-03', 3, [desk('a2', '講師A')])
    const payload = payloadOf(cells)
    const plan = pickDayOpsPlan({ facts: collectBoardFacts(payload), payload, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(plan.transfer.sourceDateKey).toBe('2026-11-19')
    expect(plan.transfer.targetDateKeys).toEqual(['2026-12-10'])
    const frozen = payloadOf(thursdays(), { settings: { templateFreezeBeforeDate: '2026-12-01' } })
    const frozenPlan = pickDayOpsPlan({ facts: collectBoardFacts(frozen), payload: frozen, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(frozenPlan.transfer.sourceDateKey).toBe('2026-12-03')
    expect(frozenPlan.transfer.targetDateKeys).toEqual(['2026-12-10'])
    // 開いた週がすべて反映日より前なら、丸ごと振替はできない(アプリの決まり)と理由に書く
    const allFrozen = payloadOf(thursdays(), { settings: { templateFreezeBeforeDate: '2027-02-01' } })
    const allFrozenPlan = pickDayOpsPlan({ facts: collectBoardFacts(allFrozen), payload: allFrozen, dateKeys: DATES, todayKey: TODAY, random: sequence(0) })
    expect(allFrozenPlan.transfer).toBeNull()
    expect(allFrozenPlan.skipped.join('\n')).toContain('テンプレの反映日(2027-02-01)より前')
    expect(allFrozenPlan.holiday).not.toBeNull()
  })
})

describe('expectedHolidayStockDeltas(休日設定の在庫の仕様の増減)', () => {
  it('通常・振替の生徒は未消化振替 +1(鍵 生徒キー__科目)。講習は講習の鍵を比べない・体験は 0。手動追加など数え方が別の席・同じ日に同じ科目が 2 つは比べない', () => {
    const cells = [
      cell('2026-11-19', 3, [
        desk('a', '講師A', [student('sA'), student('sB', 'makeup')]),
        desk('b', '講師B', [student('sC', 'special'), student('sD', 'trial')]),
        desk('c', '講師C', [student('sE'), student('sF')]),
      ]),
      cell('2026-11-19', 4, [desk('d', '講師A', [student('sE'), null])]),
      cell('2026-11-20', 3, [desk('e', '講師A', [student('sZ'), null])]),
    ]
    const facts = collectBoardFacts(payloadOf(cells))
    const result = expectedHolidayStockDeltas(facts, '2026-11-19', new Set(['2026-11-19_3#2/1']))
    expect(result.expected.makeup).toEqual({ 'sA__数': 1, 'sB__数': 1 })
    expect(result.expected.lecture).toEqual({})
    expect([...result.ignore.makeup].sort()).toEqual(['sE__数', 'sF__数'])
    expect(result.ignore.lecturePrefixes).toEqual(['sC__'])
    expect(result.checkedCount).toBe(2)
  })

  it('collectDateDeskKeys: 前と後のどちらかにある、その日の机の鍵', () => {
    const before = collectBoardFacts(payloadOf([cell('2026-11-19', 3, [desk('a', '講師A')]), cell('2026-11-20', 3, [desk('b', '講師A')])]))
    const after = collectBoardFacts(payloadOf([cell('2026-11-19', 3, [desk('a', '講師A'), desk('x', '')]), cell('2026-11-20', 3, [desk('b', '講師A')])]))
    expect([...collectDateDeskKeys([before, after], ['2026-11-19'])].sort()).toEqual(['2026-11-19_3#0', '2026-11-19_3#1'])
  })
})
