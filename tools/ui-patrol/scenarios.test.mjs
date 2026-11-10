// tools/ui-patrol/scenarios.mjs の純関数(種つきの乱数・生徒の移動の候補選び・移動で変わってよい範囲)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜E・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import { MOVE_ALLOWED_SECTIONS, MOVE_KINDS, TEMPLATE_SAVE_ALLOWED_SECTIONS, buildMoveAllowedChange, createSeededRandom, pickMoveCandidates } from './scenarios.mjs'
import { BOARD_FACT_SECTIONS } from './boardFacts.ts'

const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const TODAY = '2026-11-17'

function student(id, managedStudentId, lessonType, overrides = {}) {
  const base = { id, name: `生徒${managedStudentId}`, managedStudentId, grade: '中1', subject: '数', lessonType, teacherType: 'normal' }
  if (lessonType === 'makeup') base.makeupSourceDate = '2026-11-10'
  if (lessonType === 'special') base.specialSessionId = 'winter'
  return { ...base, ...overrides }
}

function desk(id, teacher, studentSlots = [null, null], overrides = {}) {
  return { id, teacher, lesson: { id: `L-${id}`, studentSlots }, ...overrides }
}

function cell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function payloadOf(cells, board = {}) {
  return {
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4 },
    managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [cells], weekIndex: 0, ...board },
  }
}

/** 6 種類がそろう 1 週間。今日(11/17)より前の 11/16 にも生徒と空き席を置く(選ばれてはいけない)。 */
function fullWeek() {
  return [
    // 今日より前: 元にも先にもしない。
    cell('2026-11-16', 1, [desk('p0', '講師A', [student('ep', 'sE', 'regular'), null]), desk('p1', '講師B')]),
    cell('2026-11-17', 1, [
      desk('a0', '講師A', [student('e1', 'sA', 'regular'), student('e1b', 'sA2', 'regular')]),
      desk('a1', '講師B'),
      // 講師のいない机・メモのある机は先にしない。
      desk('a2', ''),
      desk('a3', '講師C', [null, null], { memoSlots: [null, 'メモ'] }),
    ]),
    cell('2026-11-17', 2, [desk('b0', '講師A', [student('e2', 'sB', 'makeup'), student('e2b', 'sB2', 'makeup')]), desk('b1', '講師B')]),
    cell('2026-11-17', 3, [desk('c0', '講師A', [student('e3', 'sC', 'special'), student('e3b', 'sC2', 'special')]), desk('c1', '講師B')]),
    cell('2026-11-18', 1, [desk('d0', '講師A'), desk('d1', '講師B')]),
    cell('2026-11-19', 1, [desk('f0', '講師A')]),
  ]
}

const factsOf = (cells, board) => collectBoardFacts(payloadOf(cells, board))
const deskKey = (seat) => `${seat.cellId}#${seat.deskIndex}`

describe('createSeededRandom', () => {
  it('乱数: 同じ種なら同じ列・違う種なら違う列', () => {
    const take = (seed) => { const random = createSeededRandom(seed); return Array.from({ length: 8 }, () => random()) }
    expect(take(1)).toEqual(take(1))
    expect(take(1)).not.toEqual(take(2))
    for (const value of take(7)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('pickMoveCandidates', () => {
  it('移動の候補: 6 種類をそれぞれ選ぶ(合成の 1 週間)。同じ種なら同じ候補', () => {
    const facts = factsOf(fullWeek())
    const picked = pickMoveCandidates(facts, { weekDateKeys: WEEK, todayKey: TODAY, count: 6, seed: 1 })
    expect(picked.map((candidate) => candidate.kind).sort()).toEqual([...MOVE_KINDS].sort())
    expect(pickMoveCandidates(facts, { weekDateKeys: WEEK, todayKey: TODAY, count: 6, seed: 1 })).toEqual(picked)
    for (const candidate of picked) {
      const from = facts.desks.get(deskKey(candidate.from))
      const to = facts.desks.get(deskKey(candidate.to))
      expect(from.students[candidate.from.seat].key).toBe(candidate.studentId)
      expect(to.students[candidate.to.seat]).toBeNull()
      if (candidate.kind.endsWith('same-slot')) expect(to.cellId).toBe(from.cellId)
      else expect(to.dateKey).not.toBe(from.dateKey)
      expect(candidate.kind.startsWith({ regular: 'regular', makeup: 'makeup', special: 'special' }[from.students[candidate.from.seat].lessonType])).toBe(true)
    }
    // 同じ席を 2 回使わない。
    const seats = picked.flatMap((candidate) => [candidate.from, candidate.to]).map((seat) => `${deskKey(seat)}/${seat.seat}`)
    expect(new Set(seats).size).toBe(seats.length)
  })

  it('移動の候補: 先は本物の講師がいる空いた席だけ。メモ・出欠記録のある席・保留の机・今日より前の日は選ばない', () => {
    const cells = [
      cell('2026-11-16', 1, [desk('p0', '講師A', [student('ep', 'sE', 'regular'), null]), desk('p1', '講師B')]),
      cell('2026-11-17', 1, [
        desk('a0', '講師A', [student('e1', 'sA', 'regular'), null]),
        desk('a1', ''),
        desk('a2', '講師未割当'),
        desk('a3', '講師C', [null, null], { memoSlots: ['メモ', null] }),
        desk('a4', '講師B', [null, null], { statusSlots: [{ id: 'st', studentId: 'x', name: '生徒sD', managedStudentId: 'sD', subject: '英', lessonType: 'regular', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }, null] }),
        desk('a5', '講師D'),
        desk('a6', '講師E', [null, null], { teacherRest: { teacher: '講師E' } }),
      ]),
      // 出欠記録のある机の生徒は元にしない。
      cell('2026-11-18', 2, [desk('b0', '講師A', [student('e2', 'sB', 'regular'), null], { statusSlots: [null, { id: 'st2', studentId: 'y', name: '生徒sF', managedStudentId: 'sF', subject: '数', lessonType: 'regular', status: 'attended', dateKey: '2026-11-18', slotNumber: 2 }] }), desk('b1', '講師B')]),
    ]
    const pendingKey = '2026-11-17_1::a5'
    const facts = factsOf(cells, { templatePendingDesks: { [pendingKey]: { lower: { lesson: { id: 'low', studentSlots: [student('e9', 'sG', 'makeup'), null] } }, effectiveStartDate: '2026-11-16', createdAt: '2026-11-10T00:00:00.000Z' } } })
    for (const seed of [1, 2, 3, 4, 5]) {
      const picked = pickMoveCandidates(facts, { weekDateKeys: WEEK, todayKey: TODAY, count: 12, seed })
      expect(picked.length).toBeGreaterThan(0)
      for (const candidate of picked) {
        expect(candidate.from.cellId).toBe('2026-11-17_1')
        expect(candidate.from.deskIndex).toBe(0)
        // 先は 11/17 1限の講師なし・埋め草・メモ・出欠記録・保留・講師の休みの机には行かない。11/16 にも行かない。11/18 2限の b1 だけ。
        expect(deskKey(candidate.to)).toBe('2026-11-18_2#1')
      }
    }
  })

  it('移動の候補: 別の日の先は、その生徒がまだいないコマだけ', () => {
    const cells = [
      cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA', 'regular'), null])]),
      // 11/18 1限には生徒 sA がもういる(席の上段)。11/19 1限には保留の下段にいる。どちらも先にしない。
      cell('2026-11-18', 1, [desk('d0', '講師A', [student('e5', 'sA', 'regular'), null]), desk('d1', '講師B')]),
      cell('2026-11-19', 1, [desk('f0', '講師A'), desk('f1', '講師B')]),
      cell('2026-11-20', 1, [desk('g0', '講師A')]),
    ]
    const facts = factsOf(cells, { templatePendingDesks: { '2026-11-19_1::f0': { lower: { lesson: { id: 'low', studentSlots: [student('e6', 'sA', 'regular'), null] } }, effectiveStartDate: '2026-11-16', createdAt: '2026-11-10T00:00:00.000Z' } } })
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const picked = pickMoveCandidates(facts, { weekDateKeys: WEEK, todayKey: TODAY, count: 6, seed })
      const fromA = picked.filter((candidate) => candidate.studentId === 'sA' && candidate.kind === 'regular-other-day' && candidate.from.cellId === '2026-11-17_1')
      for (const candidate of fromA) expect(candidate.to.cellId).toBe('2026-11-20_1')
    }
  })

  it('移動の候補: 候補の無い種類は飛ばす。全部無ければ空', () => {
    const onlyRegular = factsOf([cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA', 'regular'), null]), desk('a1', '講師B')])])
    const picked = pickMoveCandidates(onlyRegular, { weekDateKeys: WEEK, todayKey: TODAY, count: 6, seed: 1 })
    expect(picked.map((candidate) => candidate.kind)).toEqual(['regular-same-slot'])
    const empty = factsOf([cell('2026-11-17', 1, [desk('a0', '講師A')])])
    expect(pickMoveCandidates(empty, { weekDateKeys: WEEK, todayKey: TODAY, count: 6, seed: 1 })).toEqual([])
    // 週の外の日は見ない。
    expect(pickMoveCandidates(onlyRegular, { weekDateKeys: ['2026-11-23'], todayKey: TODAY, count: 6, seed: 1 })).toEqual([])
  })

  it('移動の候補: count が種類の数より多ければ 2 周目に入る(席は使い回さない)', () => {
    const cells = [cell('2026-11-17', 1, [
      desk('a0', '講師A', [student('e1', 'sA', 'regular'), student('e2', 'sB', 'regular')]),
      desk('a1', '講師B'),
      desk('a2', '講師C'),
    ])]
    const picked = pickMoveCandidates(factsOf(cells), { weekDateKeys: WEEK, todayKey: TODAY, count: 10, seed: 3 })
    expect(picked.map((candidate) => candidate.kind)).toEqual(['regular-same-slot', 'regular-same-slot'])
    const seats = picked.flatMap((candidate) => [candidate.from, candidate.to]).map((seat) => `${deskKey(seat)}/${seat.seat}`)
    expect(new Set(seats).size).toBe(seats.length)
  })
})

describe('変わってよい範囲', () => {
  it('移動で変わってよい範囲は、元と先の机だけ', () => {
    const allowed = buildMoveAllowedChange({ kind: 'regular-other-day', from: { cellId: '2026-11-17_1', deskIndex: 0, seat: 0 }, to: { cellId: '2026-11-18_2', deskIndex: 3, seat: 1 }, studentId: 'sA' })
    expect([...allowed.deskKeys].sort()).toEqual(['2026-11-17_1#0', '2026-11-18_2#3'])
    expect(allowed.fromDateKey).toBeUndefined()
    expect([...allowed.sections].sort()).toEqual([...MOVE_ALLOWED_SECTIONS].sort())
  })

  it('変わってよい部分は、盤面の事実が知っている部分の名前だけ(書き損じで点検が黙らない)', () => {
    for (const name of [...MOVE_ALLOWED_SECTIONS, ...TEMPLATE_SAVE_ALLOWED_SECTIONS]) expect(BOARD_FACT_SECTIONS).toContain(name)
    // 名簿・講師・教室設定のテンプレ以外は、移動でもテンプレ保存でも変わってはいけない。
    for (const name of ['students', 'teachers', 'classroomSettings.other']) {
      expect(MOVE_ALLOWED_SECTIONS).not.toContain(name)
      expect(TEMPLATE_SAVE_ALLOWED_SECTIONS).not.toContain(name)
    }
  })
})
