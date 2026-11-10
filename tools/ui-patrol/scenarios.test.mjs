// tools/ui-patrol/scenarios.mjs の純関数(種つきの乱数・生徒の移動の候補選び・移動で変わってよい範囲)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜E・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import {
  MOVE_ALLOWED_SECTIONS, MOVE_DISPLACED_STATUS_SECTIONS, MOVE_KINDS, TEMPLATE_SAVE_ALLOWED_SECTIONS, buildMoveAllowedChange, collectTemplateTeacherlessKeys,
  createSeededRandom, pickMoveCandidates, runClassroomPatrol, weekStartsFrom,
} from './scenarios.mjs'
import { BOARD_FACT_SECTIONS } from './boardFacts.ts'
import * as boardFactsModule from './boardFacts.ts'
import * as checksModule from './checks.ts'
import { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff.ts'

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
