// tools/ui-patrol/scenarios.mjs の純関数(種つきの乱数・生徒の移動の候補選び・移動で変わってよい範囲)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜E・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import {
  ATTENDANCE_ALLOWED_SECTIONS, ATTENDANCE_SLOTS, MOVE_ALLOWED_SECTIONS, MOVE_DISPLACED_STATUS_SECTIONS, MOVE_KINDS, buildAttendanceAllowedChange, collectStockIneligibleSeatKeys, expectedStockDeltas, pickAttendancePlan, TEMPLATE_EDIT_ALLOWED_SECTIONS, TEMPLATE_SAVE_ALLOWED_SECTIONS, buildMoveAllowedChange, buildTemplateEditAllowedChange, collectTemplateTeacherlessKeys,
  createSeededRandom, pickMoveCandidates, runClassroomPatrol, weekStartsFrom,
} from './scenarios.mjs'
import { BOARD_FACT_SECTIONS } from './boardFacts.ts'
import * as boardFactsModule from './boardFacts.ts'
import * as checksModule from './checks.ts'
import { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff.ts'
import * as templateEditModule from './templateEdit.ts'
import { isActiveOnDate } from '../../src/components/basic-data/basicDataModel.ts'
import { findMakeupOriginLabel } from './stock.ts'

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
    // 既定では出欠記録の台帳(移)の印で上書きした前の生徒の記録を確定する経路)は入れない。元か先の机に出欠記録があるときだけ。
    for (const name of MOVE_DISPLACED_STATUS_SECTIONS) expect(allowed.sections.has(name)).toBe(false)
    const withStatuses = buildMoveAllowedChange({ kind: 'regular-other-day', from: { cellId: 'a', deskIndex: 0, seat: 0 }, to: { cellId: 'b', deskIndex: 0, seat: 0 }, studentId: 'sA' }, { hasDisplacedStatuses: true })
    for (const name of [...MOVE_ALLOWED_SECTIONS, ...MOVE_DISPLACED_STATUS_SECTIONS]) expect(withStatuses.sections.has(name)).toBe(true)
  })

  it('変わってよい部分は、盤面の事実が知っている部分の名前だけ(書き損じで点検が黙らない)', () => {
    for (const name of [...MOVE_ALLOWED_SECTIONS, ...MOVE_DISPLACED_STATUS_SECTIONS, ...TEMPLATE_SAVE_ALLOWED_SECTIONS]) expect(BOARD_FACT_SECTIONS).toContain(name)
    // 名簿・講師・教室設定のテンプレ以外は、移動でもテンプレ保存でも変わってはいけない。
    for (const name of ['students', 'teachers', 'classroomSettings.other']) {
      expect(MOVE_ALLOWED_SECTIONS).not.toContain(name)
      expect(TEMPLATE_SAVE_ALLOWED_SECTIONS).not.toContain(name)
    }
  })
})

describe('候補の週・テンプレ自体の講師なし', () => {
  it('候補を探す週は来週の月曜から 3 週先まで(4 週)', () => {
    expect(weekStartsFrom('2026-11-16')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
  })

  it('テンプレ自体が講師なしの授業の鍵(曜日|時限|生徒キー)を集める', () => {
    const template = {
      effectiveStartDate: '2026-11-16',
      cells: [
        { dayOfWeek: 4, slotNumber: 4, desks: [
          { deskIndex: 1, teacherId: '', students: [{ studentId: 's071', subject: '英' }, null] },
          { deskIndex: 2, teacherId: 't1', students: [{ studentId: 's072', subject: '数' }, null] },
        ] },
      ],
    }
    const result = collectTemplateTeacherlessKeys(template)
    expect([...result.keys]).toEqual(['4|4|s071'])
    expect(result.fromDateKey).toBe('2026-11-16')
    expect([...collectTemplateTeacherlessKeys(null).keys]).toEqual([])
  })
})

// ── 台本のつなぎ(偽の driver・本物の盤面の事実と点検)。ブラウザは使わない。
const ROOM = 'roomA'
const PATROL_TODAY = '2026-11-11' // 来週の月曜は 11/16
const app = { ...boardFactsModule, ...checksModule, resolveNextMondayDateKey, auditClassroomSnapshot: () => ({ findings: [] }) }
const appD = { ...app, ...templateEditModule, isActiveOnDate }
const clone = (value) => structuredClone(value)

function patrolPayload(cells, settings = {}) {
  return { ...payloadOf(cells), classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4, ...settings } }
}

function findDesk(payload, cellId, deskIndex) {
  return payload.boardState.weeks.flat().find((item) => item.id === cellId).desks[deskIndex]
}

/** 移動を盤面へ当てる(偽のアプリ)。 */
function applyMove(payload, from, to) {
  const next = clone(payload)
  const source = findDesk(next, from.cellId, from.deskIndex)
  const target = findDesk(next, to.cellId, to.deskIndex)
  target.lesson.studentSlots[to.seat] = source.lesson.studentSlots[from.seat]
  source.lesson.studentSlots[from.seat] = null
  return next
}

function makeFakeDriver(initialPayload, behavior = {}) {
  const state = { payload: clone(initialPayload), status: '初期', undo: [], redo: [], gotoWeeks: [], undoDisabled: false, dragCount: 0 }
  const session = { dialogs: [], downloads: 0, externalRequests: [], pageErrors: [] }
  const driver = {
    seedAndOpen: async (_session, seed) => { state.payload = clone(seed.classrooms[0].data) },
    readClassroom: async () => ({ classroomId: ROOM, payload: clone(state.payload) }),
    readStatusText: async () => state.status,
    readSaveState: async () => 'clean',
    clickSave: async () => false,
    reloadApp: async () => {},
    // アプリは週を開いたときに初めてその週を作る(createBoardWeek)。behavior.onGoto で「開いたあとの盤面」を作れる。
    gotoWeekOf: async (_session, dateKey) => { state.gotoWeeks.push(dateKey); if (behavior.onGoto) state.payload = behavior.onGoto(clone(state.payload), dateKey) },
    dragStudent: async (_session, from, to) => {
      state.dragCount += 1
      const result = (behavior.drag ?? (() => 'move'))(state.dragCount, from, to)
      if (result === 'move') {
        state.undo.push(state.payload)
        state.redo = []
        state.payload = applyMove(state.payload, from, to)
        state.status = `移動しました ${state.dragCount}`
      } else if (result === 'blocked') {
        state.status = `断りました ${state.dragCount}`
      }
      return state.status
    },
    clickUndo: async () => {
      if (state.undoDisabled || state.undo.length === 0) return false
      state.redo.push(state.payload)
      state.payload = state.undo.pop()
      state.status = '元に戻しました'
      return true
    },
    clickRedo: async () => {
      if (state.redo.length === 0) return false
      state.undo.push(state.payload)
      state.payload = state.redo.pop()
      state.status = 'やり直しました'
      return true
    },
    openTemplateEditor: async () => behavior.templateDefaultDate ?? '2026-11-16',
    setTemplateStartDate: async () => {},
    requestTemplateSave: async () => behavior.templateConfirm ?? { confirmMessage: '11/16 以降に反映します（置き換え 0机・保留 0机）。', detailText: '' },
    confirmTemplateSave: async () => { if (behavior.templateApply) state.payload = behavior.templateApply(clone(state.payload)) },
    takeScreenshot: async () => null,
  }
  return { state, session, driver }
}

async function runPatrol(payload, { scenarios, behavior, moves = 2 } = {}) {
  const fake = makeFakeDriver(payload, behavior)
  const seedSnapshot = { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] }
  const report = await runClassroomPatrol({
    session: fake.session, app, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' }, seedSnapshot,
    options: { scenarios, moves, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
  })
  return { report, fake }
}

/** 11/17(火) 1限に生徒 2 人と空いた講師の机 2 つ(同じコマの移動の候補が 2 つ)。 */
const twoMoveWeek = () => patrolPayload([cell('2026-11-17', 1, [
  desk('a0', '講師A', [student('e1', 'sA', 'regular'), student('e2', 'sB', 'regular')]),
  desk('a1', '講師B'),
  desk('a2', '講師C'),
])])
const stepsOf = (report, name) => report.steps.filter((step) => step.name === name)

describe('runClassroomPatrol(台本 b のつなぎ)', () => {
  it('移動のあと状態が変わらず、ステータスの文も変わらなければ中断(押しても何も起きない・台本が画面に合っていない)', async () => {
    const { report } = await runPatrol(twoMoveWeek(), { scenarios: ['boot', 'b'], behavior: { drag: () => 'nothing' } })
    expect(report.aborted).toMatch(/^b: /)
    expect(report.aborted).toContain('何も起きません')
  })

  it('ステータスの文が変わって状態が変わらなければ info move-blocked・操作 1(元に戻す・やり直しは押さない)', async () => {
    const { report, fake } = await runPatrol(twoMoveWeek(), { scenarios: ['boot', 'b'], behavior: { drag: (count) => (count === 1 ? 'blocked' : 'move') } })
    expect(report.aborted).toBeNull()
    const [blocked, moved] = stepsOf(report, 'b').slice(1)
    expect(blocked.findings.map((finding) => `${finding.level}:${finding.code}`)).toEqual(['info:move-blocked'])
    expect(blocked.findings[0].message).toContain('断りました 1')
    expect(blocked.operations).toBe(1)
    expect(moved.operations).toBe(4)
    expect(moved.findings.filter((finding) => finding.level === 'stop')).toEqual([])
    // 週へ移るだけの準備は操作に数えない
    expect(stepsOf(report, 'b')[0].operations).toBe(0)
    expect(fake.state.gotoWeeks).toEqual(['2026-11-16'])
  })

  it('効いた移動が 1 回も無ければ教室を中断する(全部断られた・候補が 0)', async () => {
    const allBlocked = await runPatrol(twoMoveWeek(), { scenarios: ['boot', 'b'], behavior: { drag: () => 'blocked' } })
    expect(allBlocked.report.aborted).toContain('効いた移動が 1 回もありません')
    const none = await runPatrol(patrolPayload([cell('2026-11-17', 1, [desk('a0', '講師A')])]), { scenarios: ['boot', 'b'] })
    expect(none.report.aborted).toContain('効いた移動が 1 回もありません')
  })

  it('週を開く前のデータにその週が無く、開いたあとの読み取りで初めて机が現れる → 開いたあとの事実で候補を選んで移動まで進む', async () => {
    const onGoto = (payload, dateKey) => {
      if (dateKey === '2026-11-16') payload.boardState.weeks.push([cell('2026-11-17', 1, [desk('n0', '講師A', [student('e1', 'sA', 'regular'), null]), desk('n1', '講師B')])])
      return payload
    }
    const { report, fake } = await runPatrol(patrolPayload([]), { scenarios: ['boot', 'b'], moves: 1, behavior: { onGoto } })
    expect(report.aborted).toBeNull()
    expect(fake.state.gotoWeeks).toEqual(['2026-11-16'])
    const steps = stepsOf(report, 'b')
    expect(steps[0].operations).toBe(0)
    expect(steps[1].operations).toBe(4)
    expect(steps[1].findings.filter((finding) => finding.level === 'stop')).toEqual([])
  })

  it('来週は開いても候補が無く、再来週を開くと候補がある → 再来週を使う(使った週を notes に出す)', async () => {
    const onGoto = (payload, dateKey) => {
      if (dateKey === '2026-11-16') payload.boardState.weeks.push([cell('2026-11-17', 1, [desk('n0', '講師A')])])
      if (dateKey === '2026-11-23') payload.boardState.weeks.push([cell('2026-11-24', 1, [desk('x0', '講師A', [student('e1', 'sA', 'regular'), null]), desk('x1', '講師B')])])
      return payload
    }
    const { report, fake } = await runPatrol(patrolPayload([]), { scenarios: ['boot', 'b'], moves: 1, behavior: { onGoto } })
    expect(report.aborted).toBeNull()
    expect(fake.state.gotoWeeks).toEqual(['2026-11-16', '2026-11-23'])
    expect(stepsOf(report, 'b')[0].notes.join('\n')).toContain('使った週: 2026-11-23 の週')
    // 4 週とも候補が無ければ、効いた移動 0 で中断(4 週とも開く)
    const none = await runPatrol(patrolPayload([]), { scenarios: ['boot', 'b'], moves: 1 })
    expect(none.fake.state.gotoWeeks).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
    expect(none.report.aborted).toContain('効いた移動が 1 回もありません')
  })

  it('移動が効いたのに元に戻すが押せなければ stop undo-not-restored(押せなかったボタンは数えない)', async () => {
    const fake = makeFakeDriver(twoMoveWeek(), {})
    const originalDrag = fake.driver.dragStudent
    fake.driver.dragStudent = async (...args) => { const result = await originalDrag(...args); fake.state.undoDisabled = true; return result }
    const report = await runClassroomPatrol({
      session: fake.session, app, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: twoMoveWeek() }] },
      options: { scenarios: ['boot', 'b'], moves: 2, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    const moveStep = stepsOf(report, 'b')[1]
    expect(moveStep.findings.map((finding) => `${finding.level}:${finding.code}`)).toContain('stop:undo-not-restored')
    expect(moveStep.operations).toBe(1)
    // 土台が戻らないので、残りの候補は流さない
    expect(stepsOf(report, 'b')).toHaveLength(2)
  })
})

describe('runClassroomPatrol(台本 a のつなぎ)', () => {
  it('根拠を失った振替(件数)・テンプレ自体が講師なしの授業・手前の日付で当てた注を組み立てる', async () => {
    const holiday = '2026-11-20'
    const movedRecord = { id: 'st', studentId: 'm1', name: '生徒sM', managedStudentId: 'sM', subject: '英', lessonType: 'regular', status: 'moved', dateKey: holiday, slotNumber: 4 }
    const before = patrolPayload([
      cell(holiday, 4, [desk('h0', '', [null, null], { statusSlots: [movedRecord, null] })]),
      cell('2026-11-26', 4, [desk('m0', '講師A', [student('m1', 'sM', 'makeup', { subject: '英', makeupSourceDate: holiday }), null]), desk('m1', '講師B'), desk('m2', '')]),
    ])
    const templateApply = (payload) => {
      findDesk(payload, `${holiday}_4`, 0).statusSlots = [null, null]
      findDesk(payload, '2026-11-26_4', 0).lesson.studentSlots = [null, null]
      // テンプレ自体が講師なしで置く授業(木曜 4限 sT)と、テンプレには講師がいるのに講師なしで置かれた授業(sU)
      findDesk(payload, '2026-11-26_4', 2).lesson.studentSlots = [student('t1', 'sT', 'regular'), student('u1', 'sU', 'regular')]
      payload.classroomSettings.regularLessonTemplate = {
        effectiveStartDate: '2026-11-16',
        cells: [{ dayOfWeek: 4, slotNumber: 4, desks: [{ deskIndex: 3, teacherId: '', students: [{ studentId: 'sT', subject: '数' }, null] }, { deskIndex: 2, teacherId: 't9', students: [{ studentId: 'sU', subject: '数' }, null] }] }],
      }
      return payload
    }
    const { report } = await runPatrol(before, {
      scenarios: ['boot', 'a'],
      behavior: {
        templateDefaultDate: '2027-02-01',
        templateConfirm: { confirmMessage: '11/16 以降に反映します（置き換え 1机・保留 0机）。', detailText: 'テンプレの中身に変更はありません。\nテンプレから外した生徒の振替1件を消します（振替元の授業が無くなるため）。' },
        templateApply,
      },
    })
    expect(report.aborted).toBeNull()
    const step = stepsOf(report, 'a')[0]
    const codes = step.findings.map((finding) => `${finding.level}:${finding.code}`)
    expect(codes.filter((code) => code === 'info:orphaned-makeup-removed-announced')).toHaveLength(2)
    expect(codes).toContain('info:teacherless-student-by-template')
    expect(step.findings.filter((finding) => finding.level === 'stop').map((finding) => `${finding.code}:${finding.studentId}`)).toEqual(['teacherless-student-added:sU'])
    expect(step.notes.join('\n')).toContain('保存済みのテンプレ(反映日 2027-02-01)を手前の日付で当てています')
  })
})

// ── 台本 d(テンプレを実際に変えて保存)のつなぎ。偽のアプリは、画面で変えたテンプレの机を保存で盤面へ当てる(規則は最小限)。
describe('runClassroomPatrol(台本 d のつなぎ)', () => {
  const teachersD = [
    { id: 't1', name: '講師A', displayName: '講師A', entryDate: '', withdrawDate: '', memo: '' },
    { id: 't2', name: '講師B', displayName: '講師B', entryDate: '', withdrawDate: '', memo: '' },
    { id: 't3', name: '講師C', displayName: '講師C', entryDate: '', withdrawDate: '', memo: '' },
    { id: 't4', name: '講師D', displayName: '講師D', entryDate: '', withdrawDate: '', memo: '' },
  ]
  const rosterD = ['sA', 'sB', 'sC', 'sD', 'sE'].map((id) => ({ id, name: `生徒${id}`, displayName: `生徒${id}`, entryDate: '', withdrawDate: '', birthDate: '2012-05-01', email: '', memo: '' }))
  const tplDesk = (deskIndex, teacherId, ids = []) => ({ deskIndex, teacherId, students: [0, 1].map((seat) => (ids[seat] ? { studentId: ids[seat], subject: '数', note: '' } : null)) })
  const tplStudent = (id, key) => student(id, key, 'regular', { origin: 'template' })
  /** テンプレ: 火(2) 1限 = 講師A(生徒A)・講師B(生徒B・生徒C)／水(3) 1限 = 講師C(生徒D)／木(4) 1限 = 講師D(生徒E)。盤面は 11/17〜11/26 の火水木。 */
  function dPayload() {
    const tuesday = (dateKey) => cell(dateKey, 1, [
      desk(`${dateKey}-0`, '講師A', [tplStudent(`${dateKey}-a`, 'sA'), null]),
      desk(`${dateKey}-1`, '講師B', [tplStudent(`${dateKey}-b`, 'sB'), tplStudent(`${dateKey}-c`, 'sC')]),
      desk(`${dateKey}-2`, ''),
    ])
    const wednesday = (dateKey) => cell(dateKey, 1, [desk(`${dateKey}-0`, '講師C', [tplStudent(`${dateKey}-d`, 'sD'), null]), desk(`${dateKey}-1`, '')])
    const thursday = (dateKey) => cell(dateKey, 1, [desk(`${dateKey}-0`, '講師D', [tplStudent(`${dateKey}-e`, 'sE'), null]), desk(`${dateKey}-1`, '')])
    const payload = patrolPayload([tuesday('2026-11-17'), wednesday('2026-11-18'), thursday('2026-11-19'), tuesday('2026-11-24'), wednesday('2026-11-25'), thursday('2026-11-26')], {
      deskCount: 3,
      regularLessonTemplate: {
        version: 1, effectiveStartDate: '2026-11-16', savedAt: '',
        cells: [
          { dayOfWeek: 2, slotNumber: 1, desks: [tplDesk(1, 't1', ['sA']), tplDesk(2, 't2', ['sB', 'sC'])] },
          { dayOfWeek: 3, slotNumber: 1, desks: [tplDesk(1, 't3', ['sD'])] },
          { dayOfWeek: 4, slotNumber: 1, desks: [tplDesk(1, 't4', ['sE'])] },
        ],
      },
    })
    return { ...payload, teachers: teachersD, students: rosterD }
  }
  const nameOf = (teacherId) => teachersD.find((teacher) => teacher.id === teacherId)?.name ?? ''
  const dayOf = (dateKey) => new Date(`${dateKey}T00:00:00Z`).getUTCDay()

  /** 画面で変えたテンプレの机を、保存で盤面へ当てる偽のアプリ。broken で「当てない」形を作る。 */
  function applyTemplateEdit(payload, edit, broken = {}) {
    const [, dow, slot] = edit.cellId.split('_').map(Number)
    const tplCell = payload.classroomSettings.regularLessonTemplate.cells.find((item) => item.dayOfWeek === dow && item.slotNumber === slot)
    const tplDeskEntry = tplCell.desks.find((item) => item.deskIndex === edit.deskIndex + 1)
    const oldTeacher = nameOf(tplDeskEntry.teacherId)
    if (edit.kind === 'add') tplDeskEntry.students[edit.seat] = { studentId: edit.studentId, subject: '英', note: '' }
    if (edit.kind === 'teacher') tplDeskEntry.teacherId = teachersD.find((teacher) => teacher.name === edit.teacher).id
    if (edit.kind === 'delete') { tplDeskEntry.teacherId = ''; tplDeskEntry.students = [null, null] }
    if (broken[edit.kind]) return payload
    for (const boardCell of payload.boardState.weeks.flat()) {
      if (boardCell.slotNumber !== slot || dayOf(boardCell.dateKey) !== dow || boardCell.dateKey < '2026-11-16') continue
      const target = boardCell.desks.find((item) => item.teacher === oldTeacher)
      if (!target) continue
      if (edit.kind === 'add') target.lesson.studentSlots[edit.seat] = tplStudent(`${boardCell.dateKey}-add`, edit.studentId)
      if (edit.kind === 'teacher') target.teacher = edit.teacher
      if (edit.kind === 'delete') { target.teacher = ''; target.lesson.studentSlots = [null, null] }
    }
    return payload
  }

  function makeTemplateEditDriver(payload, broken = {}) {
    const fake = makeFakeDriver(payload, {})
    const edits = []
    let pending = null
    Object.assign(fake.driver, {
      templateAddStudent: async (_session, position, choose) => {
        const studentId = choose(rosterD.map((row) => ({ value: row.id, label: row.displayName })))
        if (studentId) pending = { kind: 'add', ...position, studentId }
        return { studentId }
      },
      templateChangeTeacher: async (_session, position, choose) => {
        const teacher = choose([{ value: '', label: '' }, ...teachersD.map((row) => ({ value: row.name, label: row.name }))])
        if (teacher) pending = { kind: 'teacher', ...position, teacher }
        return { teacher }
      },
      templateDeleteDesk: async (_session, position) => { pending = { kind: 'delete', ...position } },
      closeTemplateEditor: async () => { pending = null },
      confirmTemplateSave: async () => {
        if (pending) { edits.push(pending); fake.state.payload = applyTemplateEdit(clone(fake.state.payload), pending, broken) }
        pending = null
      },
    })
    return { ...fake, edits }
  }

  async function runD(payload, { broken, seed = 1, scenarios = ['boot', 'd'] } = {}) {
    const fake = makeTemplateEditDriver(payload, broken)
    const report = await runClassroomPatrol({
      session: fake.session, app: appD, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] },
      options: { scenarios, moves: 1, seed }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    return { report, fake }
  }

  it('台本 d の変わってよい範囲: 反映日以降の机・テンプレ保存と同じ部分(在庫・名簿・講習・保留の机に無い部分は入れない)', () => {
    const allowed = buildTemplateEditAllowedChange('2026-11-16')
    expect(allowed.fromDateKey).toBe('2026-11-16')
    expect(allowed.deskKeys).toBeUndefined()
    expect([...allowed.sections].sort()).toEqual([...TEMPLATE_SAVE_ALLOWED_SECTIONS].sort())
    expect(TEMPLATE_EDIT_ALLOWED_SECTIONS).toEqual(TEMPLATE_SAVE_ALLOWED_SECTIONS)
    for (const section of ['students', 'teachers', 'specialSessions', 'boardState.manualLectureStockCounts', 'boardState.templatePendingDesks.unmatched']) expect(allowed.sections.has(section)).toBe(false)
  })

  it('3 種類を 1 回ずつ保存し(別々のコマ)、何をどこへを仮名と ID で残す。正しく当たれば止める所見 0・最後に保存→読み込み直し', async () => {
    const { report, fake } = await runD(dPayload())
    expect(report.aborted).toBeNull()
    const steps = stepsOf(report, 'd')
    expect(steps.map((step) => step.title)).toEqual([
      'テンプレを変えて保存 1(生徒を 1 人足す・反映日 2026-11-16)',
      'テンプレを変えて保存 2(講師を替える・反映日 2026-11-16)',
      'テンプレを変えて保存 3(机を消す・反映日 2026-11-16)',
      'テンプレを変えて保存のあと 保存→読み込み直し',
    ])
    expect(fake.edits.map((edit) => edit.kind)).toEqual(['add', 'teacher', 'delete'])
    // 3 つとも別のコマ(所見が出たとき、どの変更のせいか分かるように)
    expect(new Set(fake.edits.map((edit) => edit.cellId)).size).toBe(3)
    for (const step of steps.slice(0, 3)) {
      expect(step.findings.filter((finding) => finding.level === 'stop')).toEqual([])
      expect(step.operations).toBe(5)
    }
    const addNote = steps[0].notes.join('\n')
    expect(addNote).toMatch(/生徒を 1 人足す: テンプレ (火|水|木)曜 1限 机\d 席\d ← 生徒s[A-E]\(s[A-E]\)\(講師[A-D]\(t\d\) の机\)/)
    expect(addNote).toMatch(/確かめる日 2 コマ/)
    expect(steps[1].notes.join('\n')).toMatch(/講師を替える: テンプレ (火|水|木)曜 1限 机\d 講師[A-D]\(t\d\) → 講師[A-D]\(t\d\)/)
    expect(steps[2].notes.join('\n')).toMatch(/机を消す: テンプレ (火|水|木)曜 1限 机\d 講師[A-D]\(t\d\)・生徒 s[A-E]/)
    // 同じ種なら同じ選び方
    const again = await runD(dPayload())
    expect(again.fake.edits).toEqual(fake.edits)
  })

  it('変えたのに盤面へ当たらない(足した生徒を置かない・替えた講師を置かない・消した机が残る)は stop template-edit-not-applied', async () => {
    const { report } = await runD(dPayload(), { broken: { add: true, teacher: true, delete: true } })
    expect(report.aborted).toBeNull()
    const steps = stepsOf(report, 'd').slice(0, 3)
    expect(steps).toHaveLength(3)
    for (const step of steps) {
      expect(step.findings.filter((finding) => finding.level === 'stop').map((finding) => finding.code)).toContain('template-edit-not-applied')
    }
  })

  it('候補の無い種類は飛ばして注に理由を書く。3 種類とも 1 度もできなければ中断', async () => {
    const none = patrolPayload([cell('2026-11-17', 1, [desk('a0', '講師A')])])
    const { report } = await runD(none)
    expect(report.aborted).toMatch(/^d: /)
    expect(report.aborted).toContain('1 回もできませんでした')
    expect(stepsOf(report, 'd').map((step) => step.notes.join('\n')).join('\n')).toContain('飛ばした')
  })
})

// ── 台本 e(出欠)。候補選び・変わってよい範囲・在庫の仕様の増減は純関数、つなぎは偽の driver と偽の在庫で確かめる。
describe('台本 e(出欠)の候補選び・範囲', () => {
  /** 11/17〜11/19 に通常 4 人・振替 1 人・講習 1 人と空いた講師の机。11/16(今日より前)・休校日・記録のある机・保留・講師の休みにも生徒を置く(選ばれてはいけない)。 */
  function attendanceWeek() {
    return [
      cell('2026-11-16', 1, [desk('p0', '講師A', [student('ep', 'sP', 'regular'), null]), desk('p1', '講師B')]),
      cell('2026-11-17', 1, [
        desk('a0', '講師A', [student('e1', 'sA', 'regular'), student('e2', 'sB', 'regular')]),
        desk('a1', '講師B', [student('e3', 'sC', 'regular'), null]),
        desk('a2', '講師C'),
        // 記録のある机・メモのある机・講師なしの机の生徒は選ばない。
        desk('a3', '講師D', [student('e4', 'sX', 'regular'), null], { statusSlots: [null, { id: 'st', studentId: 'z', name: '生徒sZ', managedStudentId: 'sZ', subject: '英', lessonType: 'regular', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }] }),
        desk('a4', '', [student('e5', 'sY', 'regular'), null]),
      ]),
      cell('2026-11-17', 2, [desk('b0', '講師A', [student('e6', 'sD', 'regular'), null]), desk('b1', '講師B', [student('e7', 'sM', 'makeup'), null]), desk('b2', '講師C')]),
      cell('2026-11-18', 1, [desk('c0', '講師A', [student('e8', 'sS', 'special'), null]), desk('c1', '講師B'), desk('c2', '講師E', [student('e9', 'sR', 'regular'), null], { teacherRest: { teacher: '講師E' } })]),
      { ...cell('2026-11-19', 1, [desk('h0', '講師A', [student('h1', 'sH', 'regular'), null]), desk('h1', '講師B')]), isOpenDay: false },
      cell('2026-11-20', 1, [desk('n0', '講師A', [{ ...student('nn', 'x', 'regular'), managedStudentId: undefined, name: '名簿外' }, null]), desk('n1', '講師B')]),
    ]
  }
  const planOf = (cells, seed = 1, options = {}) => pickAttendancePlan(factsOf(cells, options.board), { weekDateKeys: WEEK, todayKey: TODAY, seed, ...options })

  it('6 つの操作(通常の休み → その振替先 → 通常の振無休 → 通常の出席 → 振替の休み → 講習の出席)を選ぶ。机も生徒も重ならない・同じ種なら同じ', () => {
    const plan = planOf(attendanceWeek())
    expect(plan.ops.map((op) => op.slot)).toEqual(ATTENDANCE_SLOTS.map((slot) => slot.name))
    expect(planOf(attendanceWeek())).toEqual(plan)
    const marks = plan.ops.filter((op) => op.kind === 'mark')
    const deskKeys = [...marks.map((op) => deskKey(op.seat)), deskKey(plan.ops[1].to)]
    expect(new Set(deskKeys).size).toBe(deskKeys.length)
    expect(new Set(marks.map((op) => op.studentKey)).size).toBe(marks.length)
    // 選んではいけない生徒(今日より前・記録のある机・講師なし・講師の休み・休校日・名簿外)は出ない
    for (const op of marks) expect(['sA', 'sB', 'sC', 'sD', 'sM', 'sS']).toContain(op.studentKey)
    expect(plan.ops.find((op) => op.slot === 'makeup-absent').studentKey).toBe('sM')
    expect(plan.ops.find((op) => op.slot === 'special-attended').studentKey).toBe('sS')
    // 振替先: 休みにした生徒の別のコマ(その生徒がいない)・本物の講師・空いた席。休みの生徒・科目を引き継ぐ。
    const [absent, place] = plan.ops
    expect(place).toMatchObject({ kind: 'place', studentKey: absent.studentKey, subject: absent.subject, sourceDateKey: absent.dateKey, sourceSlotNumber: absent.slotNumber })
    expect(place.to.cellId).not.toBe(absent.seat.cellId)
    const target = factsOf(attendanceWeek()).desks.get(deskKey(place.to))
    expect(target.teacher).not.toBe('')
    expect(target.students[place.to.seat]).toBeNull()
    expect(target.dateKey >= TODAY).toBe(true)
  })

  it('候補の無い操作は飛ばして理由を残す(通常の休みが無ければ振替先も飛ばす)・除く席(手動追加など)は選ばない', () => {
    const onlySpecial = [cell('2026-11-17', 1, [desk('c0', '講師A', [student('e8', 'sS', 'special'), null]), desk('c1', '講師B')])]
    const plan = planOf(onlySpecial)
    expect(plan.ops.map((op) => op.slot)).toEqual(['special-attended'])
    expect(plan.skipped.join('\n')).toContain('通常・休み')
    expect(plan.skipped.join('\n')).toContain('振替先')
    const excluded = planOf(attendanceWeek(), 1, { excludeSeatKeys: new Set(['2026-11-17_2#1/0']) })
    expect(excluded.ops.some((op) => op.slot === 'makeup-absent')).toBe(false)
  })

  it('手動追加・編集で振替にした生徒の席を集める(在庫の数え方が別なので台本 e は選ばない)', () => {
    const payload = payloadOf([cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA', 'regular', { manualAdded: true }), student('e2', 'sB', 'makeup', { editedToMakeup: true })]), desk('a1', '講師B', [student('e3', 'sC', 'regular'), null])])])
    expect([...collectStockIneligibleSeatKeys(payload)].sort()).toEqual(['2026-11-17_1#0/0', '2026-11-17_1#0/1'])
  })

  it('変わってよい範囲と在庫の仕様の増減(休み=+1・振無休=±0・出席=±0・振替先へ置く=−1・INV-06)', () => {
    const seat = { cellId: '2026-11-17_1', deskIndex: 0, seat: 1 }
    const mark = (status, lessonType = 'regular') => ({ kind: 'mark', status, seat, studentKey: 'sA', subject: '数', lessonType })
    expect([...buildAttendanceAllowedChange(mark('absent')).deskKeys]).toEqual(['2026-11-17_1#0'])
    expect([...buildAttendanceAllowedChange(mark('absent')).sections].sort()).toEqual([...ATTENDANCE_ALLOWED_SECTIONS.absent].sort())
    expect(ATTENDANCE_ALLOWED_SECTIONS.absent).toEqual(expect.arrayContaining(['boardState.manualMakeupAdjustments', 'boardState.suppressedRegularLessonOccurrences']))
    expect(ATTENDANCE_ALLOWED_SECTIONS['absent-no-makeup']).toEqual(['boardState.suppressedRegularLessonOccurrences'])
    expect(ATTENDANCE_ALLOWED_SECTIONS.attended).toEqual(['boardState.suppressedRegularLessonOccurrences'])
    expect(ATTENDANCE_ALLOWED_SECTIONS.place).toEqual([])
    for (const sections of Object.values(ATTENDANCE_ALLOWED_SECTIONS)) for (const section of sections) expect(BOARD_FACT_SECTIONS).toContain(section)
    // 在庫(講習)・名簿・講習の帳簿は範囲に入れない
    for (const section of ['students', 'specialSessions', 'boardState.manualLectureStockCounts']) expect(buildAttendanceAllowedChange(mark('absent')).sections.has(section)).toBe(false)
    expect(expectedStockDeltas(mark('absent'))).toEqual({ makeup: { 'sA__数': 1 }, lecture: {} })
    expect(expectedStockDeltas(mark('absent', 'makeup'))).toEqual({ makeup: { 'sA__数': 1 }, lecture: {} })
    expect(expectedStockDeltas(mark('absent-no-makeup'))).toEqual({ makeup: {}, lecture: {} })
    expect(expectedStockDeltas(mark('attended', 'special'))).toEqual({ makeup: {}, lecture: {} })
    const place = { kind: 'place', to: { cellId: '2026-11-18_1', deskIndex: 1, seat: 0 }, studentKey: 'sA', subject: '数' }
    expect(expectedStockDeltas(place)).toEqual({ makeup: { 'sA__数': -1 }, lecture: {} })
    expect([...buildAttendanceAllowedChange(place).deskKeys]).toEqual(['2026-11-18_1#1'])
  })
})

describe('runClassroomPatrol(台本 e のつなぎ)', () => {
  const STATUS_BY_KIND = { absent: 'absent', 'absent-no-makeup': 'absent-no-makeup', attended: 'attended' }
  /** 偽の在庫: 台帳(manualMakeupAdjustments)の振替元の数 − 盤面の振替の数(生徒キー__科目)。 */
  function fakeStock(payload) {
    const makeup = {}
    const makeupRows = []
    for (const [key, origins] of Object.entries(payload.boardState.manualMakeupAdjustments ?? {})) {
      makeup[key] = origins.length
      makeupRows.push({ key, balance: origins.length, remainingOriginDates: origins.map((origin) => origin.dateKey), remainingOriginSlots: origins.map((origin) => origin.slotNumber), remainingOriginLabels: origins.map((origin) => `${origin.dateKey} ${origin.slotNumber}限`) })
    }
    for (const boardCell of payload.boardState.weeks.flat()) for (const item of boardCell.desks) for (const entry of item.lesson?.studentSlots ?? []) {
      if (entry?.lessonType === 'makeup' && entry.makeupSourceDate) { const key = `${entry.managedStudentId}__${entry.subject}`; makeup[key] = (makeup[key] ?? 0) - 1 }
    }
    for (const key of Object.keys(makeup)) if (makeup[key] === 0) delete makeup[key]
    return { makeup, lecture: {}, makeupRows }
  }
  const appE = { ...app, findMakeupOriginLabel, collectStockBalances: (payload) => fakeStock(payload) }

  /** 出欠を付ける偽のアプリ。broken で「在庫を増やさない」「ほかの机も変える」「記録を付けない」を作る。 */
  function makeAttendanceDriver(payload, broken = {}) {
    const fake = makeFakeDriver(payload, {})
    const marks = []
    const commit = (next) => { fake.state.undo.push(fake.state.payload); fake.state.redo = []; fake.state.payload = next }
    Object.assign(fake.driver, {
      markStudentAttendance: async (_session, seat, status) => {
        const next = clone(fake.state.payload)
        const target = findDesk(next, seat.cellId, seat.deskIndex)
        const entry = target.lesson.studentSlots[seat.seat]
        const boardCell = next.boardState.weeks.flat().find((item) => item.id === seat.cellId)
        target.lesson.studentSlots[seat.seat] = null
        if (!broken.noRecord) {
          target.statusSlots = target.statusSlots ?? [null, null]
          target.statusSlots[seat.seat] = { id: `${entry.id}_${status}`, studentId: entry.id, name: entry.name, managedStudentId: entry.managedStudentId, subject: entry.subject, lessonType: entry.lessonType, status: STATUS_BY_KIND[status], dateKey: boardCell.dateKey, slotNumber: boardCell.slotNumber }
        }
        // アプリと同じく、通常の休みは振替元を台帳へ積む。振替の休みは積まない(消化が外れて元の振替元が戻る)。
        if (status === 'absent' && entry.lessonType === 'regular' && !broken.noStock) {
          const key = `${entry.managedStudentId}__${entry.subject}`
          const ledger = next.boardState.manualMakeupAdjustments ?? {}
          next.boardState.manualMakeupAdjustments = { ...ledger, [key]: [...(ledger[key] ?? []), { dateKey: boardCell.dateKey, slotNumber: boardCell.slotNumber }] }
        }
        if (broken.otherDesk) findDesk(next, '2026-11-17_1', 2).teacher = '講師Z'
        marks.push({ seat, status })
        commit(next)
        fake.state.status = `${status} ${marks.length}`
        return fake.state.status
      },
      placeMakeupFromStock: async (_session, { stockStudentKey, choose }, to) => {
        const rows = fakeStock(fake.state.payload).makeupRows.filter((row) => row.key.startsWith(`${stockStudentKey}__`))
        const items = rows.flatMap((row) => row.remainingOriginLabels.map((label) => `${row.key.split('__')[1]} ${label} (休み)`))
        const index = choose(items)
        if (index < 0) return { placed: false, status: fake.state.status }
        const row = rows[0]
        const next = clone(fake.state.payload)
        findDesk(next, to.cellId, to.deskIndex).lesson.studentSlots[to.seat] = student('pm', stockStudentKey, 'makeup', { subject: row.key.split('__')[1], makeupSourceDate: row.remainingOriginDates[0] })
        commit(next)
        fake.state.status = '振替を置きました'
        return { placed: true, status: fake.state.status }
      },
    })
    return { ...fake, marks }
  }

  const eWeek = () => patrolPayload([
    cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA', 'regular'), student('e2', 'sB', 'regular')]), desk('a1', '講師B', [student('e3', 'sC', 'regular'), null]), desk('a2', '講師C')]),
    cell('2026-11-17', 2, [desk('b0', '講師A', [student('e7', 'sM', 'makeup'), null]), desk('b1', '講師B', [student('e8', 'sS', 'special'), null]), desk('b2', '講師C')]),
  ], {})
  // 振替の生徒 sM は台帳の振替元(11/10)を消化している(残 0)。
  const eWeekWithLedger = () => { const payload = eWeek(); payload.boardState.manualMakeupAdjustments = { 'sM__数': [{ dateKey: '2026-11-10', slotNumber: 1 }] }; return payload }

  async function runE(payload, { broken, scenarios = ['boot', 'e'], behavior } = {}) {
    const fake = makeAttendanceDriver(payload, broken)
    if (behavior?.templateApply) fake.driver.confirmTemplateSave = async () => { fake.state.payload = behavior.templateApply(clone(fake.state.payload)) }
    const report = await runClassroomPatrol({
      session: fake.session, app: appE, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] },
      options: { scenarios, moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    return { report, fake }
  }

  it('仕様どおりに効けば止める所見 0。誰のどのコマに何をしたかを仮名と ID で残し、最初の休みで元に戻す・やり直しを確かめ、最後に保存→読み込み直し', async () => {
    const { report, fake } = await runE(eWeekWithLedger())
    expect(report.aborted).toBeNull()
    const steps = stepsOf(report, 'e')
    expect(steps[0].title).toContain('出欠の準備')
    expect(steps.at(-1).title).toBe('出欠のあと 保存→読み込み直し')
    const opSteps = steps.slice(1, -1)
    expect(opSteps.length).toBeGreaterThanOrEqual(5)
    for (const step of opSteps) expect([step.title, step.findings.filter((finding) => finding.level === 'stop')]).toEqual([step.title, []])
    // 最初の休みは 押す・元に戻す・やり直す の 3 操作
    expect(opSteps[0].title).toContain('通常・休み')
    expect(opSteps[0].operations).toBe(3)
    expect(opSteps[1].title).toContain('振替先')
    expect(opSteps.map((step) => step.notes.join('\n')).join('\n')).toMatch(/生徒s[A-Z]\(s[A-Z]\)/)
    expect(fake.marks.map((mark) => mark.status)).toEqual(expect.arrayContaining(['absent', 'absent-no-makeup', 'attended']))
  })

  it('わざと壊す: 休みで在庫が増えない → stop stock-delta-mismatch／ほかの机も変わる → stop outside-allowed-range／記録が付かない → stop attendance-not-applied', async () => {
    const noStock = await runE(eWeekWithLedger(), { broken: { noStock: true } })
    expect(stepsOf(noStock.report, 'e').flatMap((step) => step.findings).map((finding) => `${finding.level}:${finding.code}`)).toContain('stop:stock-delta-mismatch')
    const otherDesk = await runE(eWeekWithLedger(), { broken: { otherDesk: true } })
    expect(stepsOf(otherDesk.report, 'e').flatMap((step) => step.findings).map((finding) => `${finding.level}:${finding.code}`)).toContain('stop:outside-allowed-range')
    const noRecord = await runE(eWeekWithLedger(), { broken: { noRecord: true } })
    expect(stepsOf(noRecord.report, 'e').flatMap((step) => step.findings).map((finding) => `${finding.level}:${finding.code}`)).toContain('stop:attendance-not-applied')
  })

  it('出欠を付けられる生徒がいなければ中断(台本 b・d と同じ扱い)', async () => {
    const { report } = await runE(patrolPayload([cell('2026-11-17', 1, [desk('a0', '講師A')])]))
    expect(report.aborted).toMatch(/^e: /)
  })

  it('台本 e は a の前に流れ、テンプレ保存が出欠記録のコマに生徒を置き直したら a で stop attendance-record-overridden', async () => {
    // 偽のテンプレ保存: 休みにした生徒を同じコマの空いた机へ置き直す(記録が勝たない形)。
    const templateApply = (payload) => {
      for (const boardCell of payload.boardState.weeks.flat()) for (const item of boardCell.desks) (item.statusSlots ?? []).forEach((record) => {
        if (record?.status !== 'absent' || record.lessonType !== 'regular') return
        const free = boardCell.desks.find((other) => other.teacher && other.lesson.studentSlots.every((seat) => seat === null))
        if (free) free.lesson.studentSlots[0] = student(`re-${record.studentId}`, record.managedStudentId, 'regular', { origin: 'template' })
      })
      return payload
    }
    const { report } = await runE(eWeekWithLedger(), { scenarios: ['boot', 'a', 'e'], behavior: { templateApply } })
    const order = report.steps.map((step) => step.name).filter((name, index, list) => list.indexOf(name) === index)
    expect(order.indexOf('e')).toBeLessThan(order.indexOf('a'))
    expect(stepsOf(report, 'a')[0].findings.map((finding) => `${finding.level}:${finding.code}`)).toContain('stop:attendance-record-overridden')
  })
})
