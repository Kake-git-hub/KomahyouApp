// tools/ui-patrol/scenarios.mjs の純関数(種つきの乱数・生徒の移動の候補選び・移動で変わってよい範囲)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜E・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import { PatrolAbortError } from './driver.mjs'
import { resolveExitCode } from './report.mjs'
import {
  ATTENDANCE_ALLOWED_SECTIONS, ATTENDANCE_SLOTS, MOVE_ALLOWED_SECTIONS, MOVE_DISPLACED_STATUS_SECTIONS, MOVE_KINDS, buildAttendanceAllowedChange, collectStockIneligibleSeatKeys, expectedStockDeltas, pickAttendancePlan, TEMPLATE_EDIT_ALLOWED_SECTIONS, TEMPLATE_SAVE_ALLOWED_SECTIONS, buildMoveAllowedChange, buildTemplateEditAllowedChange, collectTemplateTeacherlessKeys,
  createSeededRandom, pickMoveCandidates, runClassroomPatrol, weekStartsFrom,
  TEACHER_OPS, buildTeacherOpAllowedChange, collectRestReleasedDeskKeys, isTeacherInCell, pickTeacherPlan,
  HOLIDAY_ALLOWED_SECTIONS, HOLIDAY_RELEASE_ALLOWED_SECTIONS, WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS, mondayOf, summarizeSectionDiff,
  AUTO_ASSIGN_ALLOWED_SECTIONS,
} from './scenarios.mjs'
import { BOARD_FACT_SECTIONS } from './boardFacts.ts'
import * as boardFactsModule from './boardFacts.ts'
import * as checksModule from './checks.ts'
import { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff.ts'
import * as templateEditModule from './templateEdit.ts'
import { isActiveOnDate } from '../../src/components/basic-data/basicDataModel.ts'
import { findMakeupOriginLabel } from './stock.ts'
import * as dayOpsModule from './dayOps.ts'
import * as autoAssignModule from './autoAssign.ts'

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

// ── 台本 f(講師の移動・入れ替え・休み・2026-11-11 第 2 段の 3 本目)
describe('台本 f(講師)の候補選び・範囲', () => {
  /** 11/17 に 6 つのコマ(どれも講師 2 人以上の机と空き机がある)。11/16(今日より前)と保留・休みのあるコマは選ばない。 */
  const fWeek = () => [
    cell('2026-11-16', 1, [desk('p0', '講師A', [student('ep', 'sP', 'regular'), null]), desk('p1', '講師B'), desk('p2', '')]),
    ...[1, 2, 3, 4, 5, 6].map((slot) => cell('2026-11-17', slot, [
      desk(`a${slot}0`, '講師A', [student(`e${slot}0`, `s${slot}0`, 'regular'), null]),
      desk(`a${slot}1`, '講師B', [student(`e${slot}1`, `s${slot}1`, 'regular'), null]),
      desk(`a${slot}2`, '', [null, null]),
    ])),
    // 休みの記録のあるコマは選ばない(前からある休みと混ざる)
    cell('2026-11-18', 1, [desk('r0', '', [student('er', 'sR', 'regular'), null], { teacherRest: { teacher: '講師C' } }), desk('r1', '講師A'), desk('r2', '')]),
  ]

  it('6 つの操作(講師の移動 → 講師だけ入替 → 生徒ごと席入替 → 講師メニューで替える → 休みの流れ → 休みと解除)を別々のコマで選ぶ。同じ種なら同じ', () => {
    const facts = factsOf(fWeek())
    const plan = pickTeacherPlan(facts, { weekDateKeys: WEEK, todayKey: TODAY, seed: 1 })
    expect(plan.ops.map((op) => op.name)).toEqual(TEACHER_OPS.map((op) => op.name))
    expect(plan.skipped).toEqual([])
    expect(new Set(plan.ops.map((op) => op.cellId)).size).toBe(plan.ops.length)
    for (const op of plan.ops) expect(op.cellId.startsWith('2026-11-17_')).toBe(true)
    expect(pickTeacherPlan(facts, { weekDateKeys: WEEK, todayKey: TODAY, seed: 1 })).toEqual(plan)
    const byName = Object.fromEntries(plan.ops.map((op) => [op.name, op]))
    const at = (op, index) => facts.desks.get(`${op.cellId}#${index}`)
    // 講師の移動・休みの流れの先は講師も生徒も居ない机
    for (const name of ['move', 'rest-flow']) {
      expect(at(byName[name], byName[name].deskIndex).teacher).not.toBe('')
      expect(at(byName[name], byName[name].targetDeskIndex).teacher).toBe('')
      expect(at(byName[name], byName[name].targetDeskIndex).students).toEqual([null, null])
    }
    // 入れ替えは講師どうし
    for (const name of ['teacher-swap', 'seat-swap']) {
      expect(at(byName[name], byName[name].deskIndex).teacher).not.toBe('')
      expect(at(byName[name], byName[name].targetDeskIndex).teacher).not.toBe('')
    }
    expect(byName['rest-flow'].teacher).toBe(at(byName['rest-flow'], byName['rest-flow'].deskIndex).teacher)
  })

  it('候補の無い操作は飛ばして理由を残す(空き机が無いコマでは講師の移動・休みの流れを選ばない)', () => {
    const cells = [cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA', 'regular'), null]), desk('a1', '講師B')])]
    const plan = pickTeacherPlan(factsOf(cells), { weekDateKeys: WEEK, todayKey: TODAY, seed: 1 })
    expect(plan.ops.map((op) => op.name)).toHaveLength(1)
    expect(plan.skipped.length).toBe(TEACHER_OPS.length - 1)
    expect(plan.skipped.join('\n')).toContain('講師の移動')
    expect(pickTeacherPlan(factsOf([]), { weekDateKeys: WEEK, todayKey: TODAY, seed: 1 }).ops).toEqual([])
  })

  it('変わってよい範囲: 操作した机(入れ替えは 2 机)だけ・部分は無し。休みの講師を手で置いたときは、同じコマで休みの記録だけ消えた机も範囲に入る', () => {
    expect([...buildTeacherOpAllowedChange({ kind: 'teacher-swap', cellId: 'c', deskIndex: 0, targetDeskIndex: 2 }).deskKeys]).toEqual(['c#0', 'c#2'])
    expect([...buildTeacherOpAllowedChange({ kind: 'rest', cellId: 'c', deskIndex: 1 }).deskKeys]).toEqual(['c#1'])
    expect(buildTeacherOpAllowedChange({ kind: 'rest', cellId: 'c', deskIndex: 1 }).sections.size).toBe(0)
    const before = factsOf([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null], { teacherRest: { teacher: '講師A' } }), desk('a1', ''), desk('a2', '講師C', [null, null], { teacherRest: { teacher: '講師A' } })])])
    const after = factsOf([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null]), desk('a1', '講師A'), desk('a2', '講師D')])])
    // 机0 は記録が消えただけ(範囲に入る)。机2 は講師も替わった(入らない)。
    expect([...collectRestReleasedDeskKeys(before, after, '2026-11-17_1', { teacher: '講師A' })]).toEqual(['2026-11-17_1#0'])
    // 別の講師 Z の休みの記録が消えた机は範囲に入れない(置いた講師の記録だけ・手直し 1 M-2)
    const otherBefore = factsOf([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null], { teacherRest: { teacher: '講師Z' } }), desk('a1', '')])])
    const otherAfter = factsOf([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null]), desk('a1', '講師A')])])
    expect([...collectRestReleasedDeskKeys(otherBefore, otherAfter, '2026-11-17_1', { teacher: '講師A' })]).toEqual([])
  })

  it('講師の照合はアプリの権威関数(呼び名の対応表): 休みの記録が講師 ID だけ・講師欄が表示名だけでも同じ講師と分かる(手直し 1 M-2・M-3)', () => {
    const teachers = [{ id: 't1', name: '講師A本名', displayName: '講師A' }, { id: 't2', name: '講師B' }]
    const withTeachers = (cells) => collectBoardFacts({ ...payloadOf(cells), teachers })
    const before = withTeachers([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null], { teacherRest: { teacher: '', teacherId: 't1' } }), desk('a1', '')])])
    const after = withTeachers([cell('2026-11-17', 1, [desk('a0', '講師B', [student('e1', 'sA', 'regular'), null]), desk('a1', '講師A')])])
    expect([...collectRestReleasedDeskKeys(before, after, '2026-11-17_1', { teacher: '講師A' })]).toEqual(['2026-11-17_1#0'])
    // 講師メニューの選択肢の名前で「そのコマに居る」: 講師欄の登録名・休みの記録の ID でも当たる
    expect(isTeacherInCell(before, '2026-11-17_1', '講師A本名')).toBe(true)
    expect(isTeacherInCell(before, '2026-11-17_1', '講師A')).toBe(true)
    expect(isTeacherInCell(after, '2026-11-17_1', '講師A本名')).toBe(true)
    expect(isTeacherInCell(after, '2026-11-17_1', '講師C')).toBe(false)
  })
})

describe('runClassroomPatrol(台本 f のつなぎ)', () => {
  /** 講師の操作を盤面へ当てる偽のアプリ。broken で「§9-25 を机単位に戻す」「講師だけ入替で生徒も動く」を作る。 */
  function makeTeacherDriver(payload, broken = {}) {
    const fake = makeFakeDriver(payload, {})
    const ops = []
    const commit = (next, status) => { fake.state.undo.push(fake.state.payload); fake.state.redo = []; fake.state.payload = next; fake.state.status = `${status} ${ops.length}`; return fake.state.status }
    const cellOf = (next, cellId) => next.boardState.weeks.flat().find((item) => item.id === cellId)
    const releaseInCell = (boardCell, placed, placedIndex) => {
      boardCell.desks.forEach((item, index) => {
        if (broken.restDeskOnly && index !== placedIndex) return
        if (item.teacherRest?.teacher === placed) delete item.teacherRest
      })
    }
    const blockOf = (item) => ({ teacher: item.teacher, manualTeacher: item.manualTeacher })
    Object.assign(fake.driver, {
      dragTeacher: async (_session, from, to, swapMode) => {
        ops.push({ kind: 'drag', from, to, swapMode })
        const next = clone(fake.state.payload)
        const boardCell = cellOf(next, from.cellId)
        const source = boardCell.desks[from.deskIndex]
        const target = boardCell.desks[to.deskIndex]
        const [sourceBlock, targetBlock] = [blockOf(source), blockOf(target)]
        Object.assign(source, targetBlock, { manualTeacher: Boolean(targetBlock.teacher) })
        Object.assign(target, sourceBlock, { manualTeacher: true })
        if (swapMode === 'seat' || broken.swapMovesStudents) [source.lesson, target.lesson] = [target.lesson, source.lesson]
        return { status: commit(next, '講師を動かしました'), modal: true }
      },
      setBoardTeacher: async (_session, position, choose) => {
        const options = ['講師A', '講師B', '講師C', '講師D'].map((name) => ({ value: name, label: name }))
        const teacher = choose(options)
        if (!teacher) return { teacher: null, status: fake.state.status }
        ops.push({ kind: 'menu', position, teacher })
        const next = clone(fake.state.payload)
        const boardCell = cellOf(next, position.cellId)
        Object.assign(boardCell.desks[position.deskIndex], { teacher, manualTeacher: true, teacherAssignmentSource: 'manual' })
        releaseInCell(boardCell, teacher, position.deskIndex)
        return { teacher, status: commit(next, '講師を設定しました') }
      },
      toggleTeacherRest: async (_session, position) => {
        ops.push({ kind: 'rest', position })
        const next = clone(fake.state.payload)
        const item = cellOf(next, position.cellId).desks[position.deskIndex]
        if (item.teacherRest) {
          delete item.teacherRest
          return { status: commit(next, '休みを解除しました'), label: '休みを解除する' }
        }
        item.teacherRest = { teacher: item.teacher }
        item.teacher = ''
        item.manualTeacher = false
        return { status: commit(next, '休みにしました'), label: '休み' }
      },
    })
    return { ...fake, ops }
  }

  const fPayload = () => patrolPayload([1, 2, 3, 4, 5, 6].map((slot) => cell('2026-11-17', slot, [
    desk(`a${slot}0`, '講師A', [student(`e${slot}0`, `s${slot}0`, 'regular'), null]),
    desk(`a${slot}1`, '講師B', [student(`e${slot}1`, `s${slot}1`, 'regular'), null]),
    desk(`a${slot}2`, '', [null, null]),
  ])))
  const appF = { ...app, collectStockBalances: () => ({ makeup: {}, lecture: {} }), resolveTeacherIdByDisplayName: () => '' }

  async function runF(payload, { broken, scenarios = ['boot', 'f'] } = {}) {
    const fake = makeTeacherDriver(payload, broken)
    const report = await runClassroomPatrol({
      session: fake.session, app: appF, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] },
      options: { scenarios, moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    return { report, fake }
  }
  const stopsOf = (report) => stepsOf(report, 'f').flatMap((step) => step.findings).filter((finding) => finding.level === 'stop').map((finding) => finding.code)

  it('仕様どおりに効けば止める所見 0。操作ごとに 何をどこへ を仮名で残し、休みの流れは 休み → 代わりの講師 → 別の机へ手で置く → 元に戻す。最後に保存→読み込み直し', async () => {
    const { report, fake } = await runF(fPayload())
    expect(report.aborted).toBeNull()
    expect(stopsOf(report)).toEqual([])
    const titles = stepsOf(report, 'f').map((step) => step.title)
    expect(titles[0]).toContain('講師の操作の準備')
    expect(titles.at(-1)).toBe('講師の操作のあと 保存→読み込み直し')
    expect(titles.join('\n')).toContain('休みの講師を同じコマの別の机へ手で置く')
    expect(fake.ops.map((op) => op.kind)).toEqual(['drag', 'drag', 'drag', 'menu', 'rest', 'menu', 'menu', 'rest', 'rest'])
    expect(fake.ops.filter((op) => op.kind === 'drag').map((op) => op.swapMode)).toEqual(['teacher', 'teacher', 'seat'])
    expect(stepsOf(report, 'f').map((step) => step.notes.join('\n')).join('\n')).toMatch(/講師[AB]/)
    // ドラッグで休みの講師を置く形は作れない(休みの講師は机に居ない)ことを注に書く
    expect(stepsOf(report, 'f')[0].notes.join('\n')).toContain('ドラッグ')
  })

  it('わざと壊す: §9-25 を机単位に戻す → stop teacher-rested-but-present／講師だけ入替で生徒も動く → stop teacher-op-not-applied', async () => {
    const deskOnly = await runF(fPayload(), { broken: { restDeskOnly: true } })
    expect(stopsOf(deskOnly.report)).toContain('teacher-rested-but-present')
    expect(stopsOf(deskOnly.report)).toContain('teacher-op-not-applied')
    const swap = await runF(fPayload(), { broken: { swapMovesStudents: true } })
    expect(stopsOf(swap.report)).toContain('teacher-op-not-applied')
  })

  it('講師を動かせる机が無ければ中断(台本 b・d・e と同じ扱い)。台本 f は e のあと・a の前に流れる', async () => {
    const { report } = await runF(patrolPayload([cell('2026-11-17', 1, [desk('a0', '')])]))
    expect(report.aborted).toMatch(/^f: /)
    const order = (await runF(fPayload(), { scenarios: ['boot', 'a', 'f'] })).report.steps.map((step) => step.name).filter((name, index, list) => list.indexOf(name) === index)
    expect(order.indexOf('f')).toBeLessThan(order.indexOf('a'))
  })
})

// ── 台本 g(休日設定と解除・丸ごと振替・2026-11-11 第 2 段の 4 本目)
describe('台本 g(日付の操作)の範囲', () => {
  it('変わってよい部分は盤面の事実が知っている名前だけ。休日は教室設定(休日の日付)と在庫の台帳、解除は抑止キーも、丸ごと振替は抑止キー(組の鍵)だけ', () => {
    for (const name of [...HOLIDAY_ALLOWED_SECTIONS, ...HOLIDAY_RELEASE_ALLOWED_SECTIONS, ...WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS]) expect(BOARD_FACT_SECTIONS).toContain(name)
    expect(HOLIDAY_ALLOWED_SECTIONS).toContain('classroomSettings.other')
    expect(HOLIDAY_ALLOWED_SECTIONS).not.toContain('boardState.scheduleCountAdjustments')
    expect(HOLIDAY_RELEASE_ALLOWED_SECTIONS).toContain('boardState.suppressedRegularLessonOccurrences')
    expect(WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS).toEqual(['boardState.suppressedRegularLessonOccurrences'])
    for (const name of ['students', 'teachers', 'regularLessons', 'classroomSettings.template']) {
      expect([...HOLIDAY_ALLOWED_SECTIONS, ...HOLIDAY_RELEASE_ALLOWED_SECTIONS, ...WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS]).not.toContain(name)
    }
    expect(mondayOf('2026-11-19')).toBe('2026-11-16')
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
  })
})

describe('summarizeSectionDiff(止めた所見の差分ファイルに部分の違いを残す)', () => {
  it('配列は 増えた・減った要素、オブジェクトは 値の違う鍵(前と後)。40 件まで', () => {
    expect(summarizeSectionDiff(JSON.stringify(['a', 'b', 'c']), JSON.stringify(['b', 'c', 'd']))).toEqual({ added: ['d'], removed: ['a'] })
    // 同じ要素が 2 つになった(数で見る)
    expect(summarizeSectionDiff(JSON.stringify(['a']), JSON.stringify(['a', 'a']))).toEqual({ added: ['a'], removed: [] })
    expect(summarizeSectionDiff(JSON.stringify({ k1: [1], k2: [2], k3: [3] }), JSON.stringify({ k1: [1], k2: [2, 2], k4: [4] }))).toEqual({ changed: { k2: { before: [2], after: [2, 2] }, k3: { before: [3], after: null }, k4: { before: null, after: [4] } } })
    expect(summarizeSectionDiff('null', JSON.stringify(['x']))).toEqual({ added: ['x'], removed: [] })
    const many = summarizeSectionDiff(JSON.stringify([]), JSON.stringify(Array.from({ length: 50 }, (_, index) => `k${index}`)))
    expect(many.added).toHaveLength(40)
    expect(many.more).toBe(10)
    // 大きい値(テンプレなど)は長さだけ
    const big = summarizeSectionDiff(JSON.stringify({ t: 'x' }), JSON.stringify({ t: 'y'.repeat(5000) }))
    expect(big.changed.t.after).toEqual({ clipped: true, length: 5002 })
  })
})

describe('runClassroomPatrol(台本 g のつなぎ)', () => {
  /** 偽の在庫: boardState.__stock(盤面の事実の部分に入らない名前)をそのまま読む。 */
  const fakeStock = (payload) => ({ makeup: { ...(payload.boardState.__stock?.makeup ?? {}) }, lecture: { ...(payload.boardState.__stock?.lecture ?? {}) }, makeupRows: [] })
  const appG = { ...app, ...dayOpsModule, collectStockBalances: (payload) => fakeStock(payload) }
  const cellsOn = (payload, dateKey) => payload.boardState.weeks.flat().filter((item) => item.dateKey === dateKey)
  const bump = (payload, key, delta) => {
    const stock = payload.boardState.__stock ?? { makeup: {}, lecture: {} }
    stock.makeup = { ...stock.makeup, [key]: (stock.makeup[key] ?? 0) + delta }
    if (stock.makeup[key] === 0) delete stock.makeup[key]
    payload.boardState.__stock = stock
  }
  const record = (entry, boardCell, status) => ({ id: `${entry.id}_${status}`, studentId: entry.id, name: entry.name, managedStudentId: entry.managedStudentId, subject: entry.subject, lessonType: entry.lessonType, status, dateKey: boardCell.dateKey, slotNumber: boardCell.slotNumber })

  /** 休日設定・解除・丸ごと振替・解除を盤面へ当てる偽のアプリ。broken で壊し方を作る。 */
  function makeDayDriver(payload, broken = {}) {
    const fake = makeFakeDriver(payload, {})
    const ops = []
    let transferSource = null
    let targetAttempts = 0
    let firstSource = null
    const commit = (next, status) => { fake.state.undo.push(fake.state.payload); fake.state.redo = []; fake.state.payload = next; fake.state.status = `${status} ${ops.length}`; return { status: fake.state.status, blocked: '' } }
    const setHoliday = (dateKey) => {
      const next = clone(fake.state.payload)
      next.boardState.__stash = { ...(next.boardState.__stash ?? {}), [`holiday:${dateKey}`]: clone(cellsOn(next, dateKey)) }
      for (const boardCell of cellsOn(next, dateKey)) {
        boardCell.isOpenDay = false
        for (const item of boardCell.desks) {
          const slots = item.lesson?.studentSlots ?? [null, null]
          item.statusSlots = slots.map((entry) => (entry ? record(entry, boardCell, 'holiday') : null))
          for (const entry of slots) if (entry && !broken.holidayNoStock) bump(next, `${entry.managedStudentId}__${entry.subject}`, broken.holidayDoubleStock ? 2 : 1)
          item.lesson = { ...item.lesson, studentSlots: [null, null] }
        }
      }
      next.classroomSettings.holidayDates = [...next.classroomSettings.holidayDates, dateKey]
      return commit(next, '休日に設定しました')
    }
    const releaseHoliday = (dateKey) => {
      const next = clone(fake.state.payload)
      const stashed = next.boardState.__stash[`holiday:${dateKey}`]
      for (const week of next.boardState.weeks) week.forEach((boardCell, index) => {
        const original = stashed.find((item) => item.id === boardCell.id)
        if (original) week[index] = clone(original)
      })
      for (const item of stashed) for (const target of item.desks) for (const entry of target.lesson?.studentSlots ?? []) if (entry && !broken.releaseKeepsStock) bump(next, `${entry.managedStudentId}__${entry.subject}`, -1)
      next.classroomSettings.holidayDates = next.classroomSettings.holidayDates.filter((value) => value !== dateKey)
      return commit(next, '休日を解除しました')
    }
    const transfer = (sourceDateKey, targetDateKey) => {
      const next = clone(fake.state.payload)
      next.boardState.__stash = { ...(next.boardState.__stash ?? {}), [`pair:${sourceDateKey}`]: clone([...cellsOn(next, sourceDateKey), ...cellsOn(next, targetDateKey)]) }
      for (const sourceCell of cellsOn(next, sourceDateKey)) {
        const targetCell = cellsOn(next, targetDateKey).find((item) => item.slotNumber === sourceCell.slotNumber)
        sourceCell.desks.forEach((item, deskIndex) => {
          const slots = item.lesson?.studentSlots ?? [null, null]
          targetCell.desks[deskIndex].teacher = item.teacher
          targetCell.desks[deskIndex].lesson = { id: `pair-${deskIndex}`, studentSlots: slots.map((entry) => (entry ? { ...entry, lessonType: 'makeup', makeupSourceDate: sourceDateKey } : null)) }
          item.statusSlots = slots.map((entry) => (entry ? record(entry, sourceCell, 'moved') : null))
          item.lesson = { ...item.lesson, studentSlots: [null, null] }
        })
      }
      if (broken.transferMovesStock) bump(next, 'sT__数', 1)
      next.boardState.suppressedRegularLessonOccurrences = [...(next.boardState.suppressedRegularLessonOccurrences ?? []), `WHOLE_DAY_PAIR__${sourceDateKey}__${targetDateKey}__0`]
      return commit(next, '丸ごと振替しました')
    }
    const releaseTransfer = () => {
      const next = clone(fake.state.payload)
      const key = (next.boardState.suppressedRegularLessonOccurrences ?? []).find((item) => item.startsWith('WHOLE_DAY_PAIR__'))
      const sourceDateKey = key.split('__')[1]
      const stashed = next.boardState.__stash[`pair:${sourceDateKey}`]
      for (const week of next.boardState.weeks) week.forEach((boardCell, index) => {
        const original = stashed.find((item) => item.id === boardCell.id)
        if (!original) return
        if (broken.transferReleaseNotRestored && boardCell.dateKey === sourceDateKey) return
        week[index] = clone(original)
      })
      next.boardState.suppressedRegularLessonOccurrences = next.boardState.suppressedRegularLessonOccurrences.filter((item) => item !== key)
      return commit(next, '丸ごと振替を解除しました')
    }
    Object.assign(fake.driver, {
      chooseDayMenuItem: async (_session, dateKey, item) => {
        ops.push({ kind: 'menu', dateKey, item })
        if (item === 'holiday') return setHoliday(dateKey)
        if (item === 'transfer') { transferSource = dateKey; fake.state.status = `振替元 ${dateKey} を選択`; return { status: fake.state.status, blocked: '' } }
        if (item === 'transfer-release') return releaseTransfer()
        return { missing: true, status: fake.state.status }
      },
      clickDayHeader: async (_session, dateKey) => {
        ops.push({ kind: 'header', dateKey })
        if (transferSource) {
          const source = transferSource
          transferSource = null
          targetAttempts += 1
          if (broken.blockFirstSource && (firstSource ??= source) === source) { transferSource = source; fake.state.status = '同じ講師が 2 机'; return { status: fake.state.status, blocked: '振替先 の 4限（講師 講師A）で、同じ講師が 2 つの机に居る形になるため丸ごと振替できません。' } }
          if (broken.blockFirstTarget && targetAttempts === 1) { transferSource = source; fake.state.status = '振替先に手入力'; return { status: fake.state.status, blocked: '振替先に手入力があるため丸ごと振替できません。' } }
          return transfer(source, dateKey)
        }
        return releaseHoliday(dateKey)
      },
      cancelWholeDayTransfer: async () => { transferSource = null; fake.state.status = 'キャンセル'; return true },
    })
    return { ...fake, ops }
  }

  // 木曜 4 日(11/19・11/26・12/3・12/10)に同じ形のコマ。金曜 11/20 は休日の候補(振替先の候補でない日)。
  const gPayload = () => patrolPayload([
    ...['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10'].map((dateKey, index) => cell(dateKey, 3, [
      desk(`a${index}`, '講師A', [student(`e${index}a`, `s${index}a`, 'regular', { origin: 'template' }), null]),
      desk(`b${index}`, '講師B', [student(`e${index}b`, `s${index}b`, 'regular', { origin: 'template' }), null]),
      desk(`c${index}`, ''),
    ])),
    cell('2026-11-20', 2, [desk('f0', '講師C', [student('ef', 'sF', 'regular', { origin: 'template' }), student('eg', 'sG', 'regular', { origin: 'template' })])]),
  ])

  async function runG(payload, { broken, scenarios = ['boot', 'g'], app: appOverride } = {}) {
    const fake = makeDayDriver(payload, broken)
    const report = await runClassroomPatrol({
      session: fake.session, app: appOverride ?? appG, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] },
      options: { scenarios, moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    return { report, fake }
  }
  const stopsOf = (report) => stepsOf(report, 'g').flatMap((step) => step.findings).filter((finding) => finding.level === 'stop').map((finding) => finding.code)

  it('仕様どおりに効けば止める所見 0。休日設定 → 元に戻す・やり直し → 保存→読み込み直し → 解除、丸ごと振替 → 保存→読み込み直し → 解除、最後に保存→読み込み直し。日付と人数を報告に残す', async () => {
    const { report, fake } = await runG(gPayload())
    expect(report.aborted).toBeNull()
    expect(stopsOf(report)).toEqual([])
    const titles = stepsOf(report, 'g').map((step) => step.title)
    expect(titles[0]).toContain('日付の操作の準備')
    expect(titles.join('\n')).toContain('休日設定')
    expect(titles.join('\n')).toContain('休日を解除')
    expect(titles.join('\n')).toContain('丸ごと振替を解除')
    expect(titles.at(-1)).toBe('日付の操作のあと 保存→読み込み直し')
    expect(fake.ops.map((op) => `${op.kind}:${op.item ?? ''}`)).toEqual(['menu:holiday', 'header:', 'menu:transfer', 'header:', 'menu:transfer-release'])
    const notes = stepsOf(report, 'g').map((step) => step.notes.join('\n')).join('\n')
    expect(notes).toContain('2026-11-20')
    // 丸ごと振替は木曜から別の木曜へ(同じ曜日)
    const pair = /丸ごと振替: (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/.exec(notes)
    expect(pair).not.toBeNull()
    expect(new Date(`${pair[1]}T00:00:00Z`).getUTCDay()).toBe(4)
    expect(new Date(`${pair[2]}T00:00:00Z`).getUTCDay()).toBe(4)
    expect(pair[1]).not.toBe(pair[2])
    // 4 週を開いてから選ぶ(アプリは週を開いたときに初めてその週を作る)
    expect(fake.state.gotoWeeks.slice(0, 4)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
  })

  it('わざと壊す: 休日で在庫を戻さない・二重に戻す → stop stock-delta-mismatch／解除で在庫が戻らない → stop round-trip-not-restored', async () => {
    expect(stopsOf((await runG(gPayload(), { broken: { holidayNoStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runG(gPayload(), { broken: { holidayDoubleStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runG(gPayload(), { broken: { releaseKeepsStock: true } })).report)).toContain('round-trip-not-restored')
  })

  it('振替の借りのある鍵(前から振替を置きすぎ)は、休日の +1 の代わりに「振替元を 1 つ足したときの残」(stock.ts の collectMakeupOriginGains)を期待値にして比べる。借りの鍵で残が増えたら(二重計上)stop', async () => {
    const owingApp = { ...appG, collectMakeupOriginGains: (_payload, _today, keys) => Object.fromEntries([...keys].map((key) => [key, 0])) }
    // 借りの返済に消えて残が増えない(偽のアプリが在庫を戻さない)→ 期待 0 どおりで所見なし
    const owing = await runG(gPayload(), { broken: { holidayNoStock: true }, app: owingApp })
    expect(stopsOf(owing.report)).not.toContain('stock-delta-mismatch')
    expect(stepsOf(owing.report, 'g').map((step) => step.notes.join('\n')).join('\n')).toMatch(/振替の借り[^0-9]*\d+/)
    // 借りの鍵なのに残が +1(見かけの +1＝二重計上)→ stop
    expect(stopsOf((await runG(gPayload(), { app: owingApp })).report)).toContain('stock-delta-mismatch')
    // 借りの無い鍵(増え方 +1)は今までどおり +1 を比べる
    const none = await runG(gPayload(), { broken: { holidayNoStock: true }, app: { ...appG, collectMakeupOriginGains: (_payload, _today, keys) => Object.fromEntries([...keys].map((key) => [key, 1])) } })
    expect(stopsOf(none.report)).toContain('stock-delta-mismatch')
  })

  it('わざと壊す: 丸ごと振替で在庫が動く → stop stock-delta-mismatch／解除で振替元へ戻さない → stop round-trip-not-restored', async () => {
    expect(stopsOf((await runG(gPayload(), { broken: { transferMovesStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runG(gPayload(), { broken: { transferReleaseNotRestored: true } })).report)).toContain('round-trip-not-restored')
  })

  it('振替先でアプリに断られたら info に理由を残して取り消し、次の振替先を試す', async () => {
    const { report, fake } = await runG(gPayload(), { broken: { blockFirstTarget: true } })
    expect(stopsOf(report)).toEqual([])
    const findings = stepsOf(report, 'g').flatMap((step) => step.findings)
    expect(findings.map((finding) => `${finding.level}:${finding.code}`)).toContain('info:day-op-blocked')
    // 休日の解除(11/20)のあと、振替先を 2 つ試した(1 つ目は断られた)
    const headers = fake.ops.filter((op) => op.kind === 'header').map((op) => op.dateKey)
    expect(headers[0]).toBe('2026-11-20')
    expect(headers).toHaveLength(3)
    expect(new Set(headers.slice(1)).size).toBe(2)
    expect(fake.ops.filter((op) => op.item === 'transfer')).toHaveLength(2)
  })

  it('Issue #87: 振替元の振替先が全部アプリに断られたら、次の振替元を試す(info に理由・止める所見 0・作って解除まで流れる)', async () => {
    const { report, fake } = await runG(gPayload(), { broken: { blockFirstSource: true } })
    expect(report.aborted).toBeNull()
    expect(stopsOf(report)).toEqual([])
    const steps = stepsOf(report, 'g')
    expect(steps.flatMap((step) => step.findings).filter((finding) => finding.code === 'day-op-blocked').length).toBeGreaterThan(0)
    const menuSources = fake.ops.filter((op) => op.item === 'transfer').map((op) => op.dateKey)
    expect(new Set(menuSources).size).toBe(2)
    expect(fake.ops.filter((op) => op.item === 'transfer-release')).toHaveLength(1)
    const notes = steps.map((step) => step.notes.join('\n')).join('\n')
    expect(notes).toContain('次の振替元を試す')
    // 段の題は効いた振替元
    expect(steps.map((step) => step.title)).toContain(`丸ごと振替(振替元 ${menuSources.at(-1)})`)
  })

  it('日付の操作の候補が無ければ中断せず飛ばす(注に理由・g だけなら終了コード 2・前の台本に変があれば 1＝変を隠さない・手直し 1 I-1)。台本 g は既定の台本(d)のあとに流れる', async () => {
    const empty = () => patrolPayload([cell('2026-11-19', 3, [desk('a0', '講師A')])])
    const { report } = await runG(empty())
    expect(report.aborted).toBeNull()
    expect(report.noScenarioRan).toBe(true)
    expect(stepsOf(report, 'g').map((step) => step.title)).toContain('日付の操作は候補なしで飛ばした')
    expect(resolveExitCode({ classrooms: [report, report] })).toBe(2)
    // 前の台本(c)で変 1 件 → 1(g の候補なしで 2 に隠れない)
    const fake = makeDayDriver(empty())
    fake.driver.reloadApp = async () => { fake.state.payload = clone(fake.state.payload); fake.state.payload.boardState.weeks[0][0].desks[0].teacher = '講師Z' }
    const withStop = await runClassroomPatrol({
      session: fake.session, app: appG, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: empty() }] },
      options: { scenarios: ['boot', 'c', 'g'], moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    expect(withStop.aborted).toBeNull()
    expect(withStop.noScenarioRan).toBe(false)
    expect(resolveExitCode({ classrooms: [withStop] })).toBe(1)
    const order = (await runG(gPayload(), { scenarios: ['boot', 'g', 'c'] })).report.steps.map((step) => step.name).filter((name, index, list) => list.indexOf(name) === index)
    expect(order.indexOf('g')).toBeGreaterThan(order.indexOf('c'))
  })
})

describe('台本 h(講習の自動割振)の範囲', () => {
  it('変わってよい部分は盤面の事実が知っている名前だけ。講習の在庫の台帳(数と振替元)だけ(振替の台帳・抑止キー・回数の調整は入れない)', () => {
    for (const name of AUTO_ASSIGN_ALLOWED_SECTIONS) expect(BOARD_FACT_SECTIONS).toContain(name)
    expect(AUTO_ASSIGN_ALLOWED_SECTIONS).toEqual(['boardState.manualLectureStockCounts', 'boardState.manualLectureStockOrigins'])
  })
})

describe('runClassroomPatrol(台本 h のつなぎ)', () => {
  const P = ['2026-12-14', '2026-12-15', '2026-12-16']
  /** 偽の在庫: boardState.__stock をそのまま読む(lectureRows の残は lecture の数)。 */
  const fakeStock = (payload) => {
    const stock = payload.boardState.__stock ?? { makeup: {}, lecture: {}, rows: [] }
    const lectureRows = (stock.rows ?? []).map((row) => ({ ...row, count: stock.lecture[row.key] ?? 0 })).filter((row) => row.count > 0)
    return { makeup: { ...stock.makeup }, lecture: { ...stock.lecture }, makeupRows: [], lectureRows }
  }
  const appH = { ...app, ...dayOpsModule, ...autoAssignModule, collectStockBalances: (payload) => fakeStock(payload) }
  const row = (sid, count) => ({ key: `${sid}__winter`, studentKey: sid, studentId: sid, sessionId: 'winter', count, periodStart: P[0], periodEnd: P[2], items: [] })
  const roster = (id) => ({ id, name: `生徒${id}`, displayName: `生徒${id}`, email: '', entryDate: '', withdrawDate: '', birthDate: '2012-05-01', memo: '' })

  /** 期間 3 日の 3 限に、講師の机 2 つ(片方に手入力の生徒 sM)と講師のいない机。11/18 は期間の外(置いてはいけない)。 */
  const hPayload = () => {
    const payload = patrolPayload([
      ...P.map((dateKey, index) => cell(dateKey, 3, [
        desk(`a${index}`, '講師A', [student(`m${index}`, 'sM', 'makeup', { makeupSourceDate: '2026-11-01' }), null]),
        desk(`b${index}`, '講師B'),
        desk(`c${index}`, ''),
      ])),
      cell('2026-11-18', 3, [desk('z0', '講師A')]),
    ])
    payload.students = ['s1', 's2', 'sM'].map(roster)
    payload.specialSessions = [{ id: 'winter', label: '冬期講習', startDate: P[0], endDate: P[2], createdAt: '', updatedAt: '', studentInputs: {}, teacherInputs: {} }]
    payload.boardState.__stock = { makeup: { 's2__数': 1 }, lecture: { s1__winter: 2, s2__winter: 1 }, rows: [row('s1', 2), row('s2', 1)] }
    return payload
  }

  /** 講習の自動割振を盤面へ当てる偽のアプリ(期間の講師の机の空いた席へ 1 コマ 1 席・残の数だけ)。broken で壊し方を作る。 */
  function makeAutoAssignDriver(payload, broken = {}) {
    const fake = makeFakeDriver(payload, {})
    const presses = []
    Object.assign(fake.driver, {
      runLectureAutoAssign: async (_session, { entryKey, includeMakeup }) => {
        presses.push({ entryKey, includeMakeup })
        const stock = fakeStock(fake.state.payload)
        if (!stock.lectureRows.some((item) => item.key === entryKey)) return { found: false, status: fake.state.status }
        const sid = entryKey.split('__')[0]
        const next = clone(fake.state.payload)
        const cells = next.boardState.weeks.flat().filter((item) => P.includes(item.dateKey) && !item.desks.some((target) => (target.lesson?.studentSlots ?? []).some((entry) => entry?.managedStudentId === sid)))
        const placeInto = (lessonType, subject) => {
          for (const boardCell of cells) {
            if (boardCell.desks.some((target) => (target.lesson?.studentSlots ?? []).some((entry) => entry?.managedStudentId === sid))) continue
            for (const target of boardCell.desks) {
              if (!target.teacher) continue
              const slots = target.lesson.studentSlots
              // 壊し方: 手入力の生徒の席を上書きする(INV-02)
              const seat = broken.overwrite ? slots.findIndex((entry) => entry?.managedStudentId === 'sM') : slots.indexOf(null)
              if (seat < 0) continue
              slots[seat] = student(`x-${boardCell.id}-${seat}`, sid, lessonType, { subject, ...(lessonType === 'makeup' ? { makeupSourceDate: '2026-11-02' } : {}) })
              return true
            }
          }
          return false
        }
        const remaining = (next.boardState.__stock.lecture[entryKey] ?? 0) - (broken.firstRunShort && presses.filter((item) => item.entryKey === entryKey).length === 1 ? 1 : 0)
        let placedLecture = 0
        for (let index = 0; index < remaining; index += 1) if (placeInto('special', '数')) placedLecture += 1
        let placedMakeup = 0
        if (includeMakeup) {
          const key = `${sid}__数`
          for (let index = 0; index < (next.boardState.__stock.makeup[key] ?? 0); index += 1) if (placeInto('makeup', '数')) placedMakeup += 1
          if (placedMakeup > 0) next.boardState.__stock.makeup[key] -= placedMakeup
        }
        if (placedLecture + placedMakeup === 0) {
          fake.state.status = `生徒${sid} は条件に合う空きコマが見つからず、自動割振できませんでした。`
          return { found: true, status: fake.state.status, debugText: '割り当て不可コマ数' }
        }
        if (!broken.noStock) next.boardState.__stock.lecture[entryKey] -= placedLecture * (broken.doubleStock ? 2 : 1)
        if (broken.otherStudentStock) next.boardState.__stock.makeup['sM__数'] = 5
        fake.state.undo.push(fake.state.payload)
        fake.state.redo = []
        fake.state.payload = next
        fake.state.status = includeMakeup ? `生徒${sid} を自動割振しました（講習${placedLecture}・振替${placedMakeup}コマ）。` : `生徒${sid} を自動割振しました（${broken.wrongCount ? placedLecture + 1 : placedLecture}コマ）。`
        if (broken.unreadableStatus) fake.state.status = `生徒${sid} に ${placedLecture} コマ割り振りました。`
        return { found: true, status: fake.state.status, debugText: 'ルール対応率' }
      },
    })
    return { ...fake, presses }
  }

  async function runH(payload, { broken, scenarios = ['boot', 'h'] } = {}) {
    const fake = makeAutoAssignDriver(payload, broken)
    const report = await runClassroomPatrol({
      session: fake.session, app: appH, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(payload) }] },
      options: { scenarios, moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    return { report, fake }
  }
  const stopsOf = (report) => stepsOf(report, 'h').flatMap((step) => step.findings).filter((finding) => finding.level === 'stop').map((finding) => finding.code)

  it('仕様どおりに効けば止める所見 0。講習だけ → 未消化振替も同時に(別の生徒)を 1 回ずつ、2 回目を押しても変わらない、元に戻す・やり直し、最後に保存→読み込み直し', async () => {
    const { report, fake } = await runH(hPayload())
    expect(report.aborted).toBeNull()
    expect(stopsOf(report)).toEqual([])
    // 1 回目は講習だけ、2 回目は振替も同時に(振替の残がある s2)。それぞれ 2 回押す(2 回目は何も変えない)。
    expect(fake.presses.map((press) => `${press.entryKey}:${press.includeMakeup}`)).toEqual(['s1__winter:false', 's1__winter:false', 's2__winter:true', 's2__winter:true'])
    const titles = stepsOf(report, 'h').map((step) => step.title)
    expect(titles[0]).toContain('講習の自動割振の準備')
    expect(titles.at(-1)).toBe('講習の自動割振のあと 保存→読み込み直し')
    const notes = stepsOf(report, 'h').map((step) => step.notes.join('\n')).join('\n')
    expect(notes).toContain('全員まとめての入口は無い')
    expect(notes).toContain('講師は置かない')
    expect(notes).toContain('s1__winter')
    // 期間の週を開いてから押す(アプリは週を開いたときに初めてその週を作る)
    expect(fake.state.gotoWeeks).toContain('2026-12-14')
    // 期間の外(11/18)には置かない
    expect(findDesk(fake.state.payload, '2026-11-18_3', 0).lesson.studentSlots).toEqual([null, null])
  })

  it('わざと壊す: 在庫を減らさない・2 減らす・対象でない生徒の在庫が動く → stop stock-delta-mismatch(INV-06)／件数の文が違う → stop auto-assign-count-mismatch', async () => {
    expect(stopsOf((await runH(hPayload(), { broken: { noStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runH(hPayload(), { broken: { doubleStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runH(hPayload(), { broken: { otherStudentStock: true } })).report)).toContain('stock-delta-mismatch')
    expect(stopsOf((await runH(hPayload(), { broken: { wrongCount: true } })).report)).toContain('auto-assign-count-mismatch')
  })

  it('結果の文が読めない(アプリの文の形が変わった)ときは、件数の点検を黙って飛ばさず注に残す', async () => {
    const { report } = await runH(hPayload(), { broken: { unreadableStatus: true } })
    expect(stepsOf(report, 'h').flatMap((step) => step.notes).join('\n')).toContain('結果の文を読めなかった')
  })

  it('わざと壊す: 手入力の生徒の席を上書きする → stop auto-assign-outside-placement(INV-02)／1 回目で置き切らず 2 回目で置く → stop auto-assign-rerun-changed(INV-03)', async () => {
    expect(stopsOf((await runH(hPayload(), { broken: { overwrite: true } })).report)).toContain('auto-assign-outside-placement')
    expect(stopsOf((await runH(hPayload(), { broken: { firstRunShort: true } })).report)).toContain('auto-assign-rerun-changed')
  })

  it('割り振れる未消化講習の行が無ければ中断せず飛ばす(台本 g と同じ・理由を注に・h だけなら終了コード 2・既定＋h で前の台本に変があれば 1・候補なしだけなら 0＝手直し 1 I-1)。台本 h は g のあとに流れる', async () => {
    const past = () => {
      const payload = hPayload()
      payload.boardState.__stock.rows = payload.boardState.__stock.rows.map((item) => ({ ...item, periodStart: '2026-07-21', periodEnd: '2026-08-31' }))
      return payload
    }
    const { report } = await runH(past())
    expect(report.aborted).toBeNull()
    expect(report.noScenarioRan).toBe(true)
    expect(stepsOf(report, 'h').flatMap((step) => step.notes).join('\n')).toContain('期間が今日より前')
    expect(stepsOf(report, 'h').map((step) => step.title)).toContain('講習の自動割振は候補なしで飛ばした')
    expect(resolveExitCode({ classrooms: [report, report] })).toBe(2)
    // 既定＋h(ここでは c＋h): h の候補なしは飛ばし、ほかの台本の結果で決まる
    const clean = await runH(past(), { scenarios: ['boot', 'c', 'h'] })
    expect(clean.report.noScenarioRan).toBe(false)
    expect(resolveExitCode({ classrooms: [clean.report, clean.report] })).toBe(0)
    const fake = makeAutoAssignDriver(past())
    fake.driver.reloadApp = async () => { fake.state.payload = clone(fake.state.payload); fake.state.payload.boardState.weeks[0][0].desks[1].teacher = '講師Z' }
    const withStop = await runClassroomPatrol({
      session: fake.session, app: appH, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: past() }] },
      options: { scenarios: ['boot', 'c', 'h'], moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: fake.driver,
    })
    expect(resolveExitCode({ classrooms: [withStop] })).toBe(1)
    const order = (await runH(hPayload(), { scenarios: ['boot', 'h', 'c'] })).report.steps.map((step) => step.name).filter((name, index, list) => list.indexOf(name) === index)
    expect(order.indexOf('h')).toBeGreaterThan(order.indexOf('c'))
  })

  it('講習の期間の週が開けない(データに無い間の週)ときは注に出して続ける。1 週も開けなければ中断(画面が変わった疑い)', async () => {
    const runWith = async (failing) => {
      const local = makeAutoAssignDriver(hPayload())
      const original = local.driver.gotoWeekOf
      local.driver.gotoWeekOf = async (session, monday) => { if (failing(monday)) throw new PatrolAbortError(`${monday} の週が盤面に出ませんでした。`); return original(session, monday) }
      return runClassroomPatrol({
        session: local.session, app: appH, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
        seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(hPayload()) }] },
        options: { scenarios: ['boot', 'h'], moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: local.driver,
      })
    }
    const all = await runWith(() => true)
    expect(all.aborted).toMatch(/^h: .*週を 1 つも開けません/)
    // 期間が 2 週にまたがり、片方だけ開けない → 注に出して続ける
    const twoWeeks = hPayload()
    twoWeeks.boardState.__stock.rows = twoWeeks.boardState.__stock.rows.map((item) => ({ ...item, periodEnd: '2026-12-22' }))
    const local = makeAutoAssignDriver(twoWeeks)
    const original = local.driver.gotoWeekOf
    local.driver.gotoWeekOf = async (session, monday) => { if (monday === '2026-12-21') throw new PatrolAbortError('2026-12-21 の週が盤面に出ませんでした。'); return original(session, monday) }
    const partial = await runClassroomPatrol({
      session: local.session, app: appH, classroom: { classroomId: ROOM, label: 'A', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: clone(twoWeeks) }] },
      options: { scenarios: ['boot', 'h'], moves: 1, seed: 1 }, outDir: '/nonexistent-patrol-out', known: [], today: PATROL_TODAY, driver: local.driver,
    })
    expect(partial.aborted).toBeNull()
    expect(partial.steps.flatMap((step) => step.notes).join('\n')).toContain('開けなかった週 2026-12-21')
  })

  it('アプリが割り振らなかった(空きコマが無い)は info auto-assign-blocked。1 回も割り振れなければ中断', async () => {
    const full = hPayload()
    for (const boardCell of full.boardState.weeks.flat()) for (const item of boardCell.desks) if (item.teacher) item.lesson.studentSlots = item.lesson.studentSlots.map((entry, index) => entry ?? student(`f-${boardCell.id}-${item.id}-${index}`, 'sF', 'regular'))
    const { report } = await runH(full)
    const findings = stepsOf(report, 'h').flatMap((step) => step.findings)
    expect(findings.map((finding) => `${finding.level}:${finding.code}`)).toContain('info:auto-assign-blocked')
    expect(report.aborted).toMatch(/^h: /)
  })
})
