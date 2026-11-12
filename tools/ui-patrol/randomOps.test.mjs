// tools/ui-patrol/randomOps.mjs(でたらめ操作・第 2 段の最後で育てた)を固定する。フィクスチャは架空の名前だけ(生徒A〜D・講師A〜D)。
// 盤面の事実と点検は本物(boardFacts.ts・checks.ts)。ブラウザの代わりに偽の driver(移動・出欠・講師・元に戻す・やり直し・保存・読み込み直し)を使う。
import { describe, it, expect } from 'vitest'
import {
  RANDOM_PARTS, RANDOM_PART_NAMES, advanceRandomModel, convertBlockedFindingsToNotes, createInitialRandomModel, formatRandomTrace, pickNextRandomPart,
  pickRandomAttendanceClear, pickRandomAttendanceMark, pickRandomMakeupPlace, pickRandomTeacherOp, pickRandomTeacherRelease, runRandomOps,
} from './randomOps.mjs'
import { attemptStudentMove, createSeededRandom, expectedStockDeltas, buildAttendanceAllowedChange, runClassroomPatrol } from './scenarios.mjs'
import { PatrolAbortError } from './driver.mjs'
import { resolveExitCode } from './report.mjs'
import * as boardFactsModule from './boardFacts.ts'
import * as checksModule from './checks.ts'
import { findMakeupOriginLabel } from './stock.ts'
import { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff.ts'
import { MAX_HISTORY_DEPTH } from '../../src/components/schedule-board/ScheduleBoardScreen.tsx'

const ROOM = 'roomR'
const TODAY = '2026-11-11' // 来週の月曜は 11/16
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const clone = (value) => structuredClone(value)

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
  for (const row of makeupRows) row.balance = makeup[row.key] ?? 0
  for (const key of Object.keys(makeup)) if (makeup[key] === 0) delete makeup[key]
  return { makeup, lecture: {}, makeupRows: makeupRows.filter((row) => row.balance > 0), lectureRows: [] }
}

const app = {
  ...boardFactsModule, ...checksModule, resolveNextMondayDateKey, auditClassroomSnapshot: () => ({ findings: [] }), MAX_HISTORY_DEPTH,
  collectStockBalances: (payload) => fakeStock(payload), findMakeupOriginLabel, resolveTeacherIdByDisplayName: () => '',
}

function student(id, managedStudentId, lessonType = 'regular', overrides = {}) {
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
const factsOf = (payload) => app.collectBoardFacts(payload)

/** 11/17 1限と 11/18 1限。生徒 2 人と空いた講師の机がいくつか(移動の候補が何度でも作れる)。 */
const roomyWeek = () => payloadOf([
  cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA'), student('e2', 'sB')]), desk('a1', '講師B'), desk('a2', '講師C')]),
  cell('2026-11-18', 1, [desk('b0', '講師A'), desk('b1', '講師D')]),
])

/** 出欠・講師の部品も選べる 1 週間: コマごとに 講師の机 2 つ(生徒つき)・空き机 1 つ・空いた講師の机 1 つ。 */
const richWeek = () => payloadOf([1, 2, 3].flatMap((slot) => ['2026-11-17', '2026-11-18'].map((dateKey) => cell(dateKey, slot, [
  desk(`${dateKey}-${slot}-0`, '講師A', [student(`e${dateKey}${slot}0`, `s${dateKey.slice(8)}${slot}0`), null]),
  desk(`${dateKey}-${slot}-1`, '講師B', [student(`e${dateKey}${slot}1`, `s${dateKey.slice(8)}${slot}1`, slot === 2 ? 'makeup' : 'regular'), null]),
  desk(`${dateKey}-${slot}-2`, '', [null, null]),
  desk(`${dateKey}-${slot}-3`, '講師C'),
]))), { manualMakeupAdjustments: Object.fromEntries(['s1720', 's1820', 's1721', 's1821'].map((key) => [`${key}__数`, [{ dateKey: '2026-11-10', slotNumber: 2 }]])) })

function findDesk(payload, cellId, deskIndex) {
  return payload.boardState.weeks.flat().find((item) => item.id === cellId).desks[deskIndex]
}
const cellOf = (payload, cellId) => payload.boardState.weeks.flat().find((item) => item.id === cellId)

const STATUS_BY_KIND = { absent: 'absent', 'absent-no-makeup': 'absent-no-makeup', attended: 'attended' }

/**
 * 偽のアプリ: 移動・出欠(付ける・解除・振替先へ置く)・講師(ドラッグ・メニュー・休み)・元に戻す・やり直し・保存・読み込み直し。
 * 読み込み直しは保存した盤面に戻り、履歴を捨てる(アプリと同じ)。
 * behavior.autoSaved: 変更のあと自分で保存したことにする(ローカルモードの 5 秒後の自動保存)。
 * behavior.undoBreaks: n 回目の元に戻すで盤面を戻し損ねる。behavior.noStock: 通常の休みで台帳へ積まない。behavior.swapMovesStudents: 講師だけ入替で生徒も動く。
 */
function makeFakeDriver(initialPayload, behavior = {}) {
  const state = { payload: clone(initialPayload), saved: clone(initialPayload), dirty: false, status: '初期', undo: [], redo: [], gotoWeeks: [], undoCount: 0, reloads: 0, saves: 0, calls: [], lag: 0 }
  const session = { dialogs: [], downloads: 0, externalRequests: [], pageErrors: [] }
  const changed = () => { state.dirty = !behavior.autoSaved; if (behavior.autoSaved) state.saved = clone(state.payload) }
  // アプリと同じく元に戻すの履歴は MAX_HISTORY_DEPTH まで(古いものから捨てる・appendHistoryEntry)。
  const pushHistory = (stack, entry) => { stack.push(entry); if (stack.length > MAX_HISTORY_DEPTH) stack.shift() }
  const commit = (next, status) => {
    pushHistory(state.undo, state.payload)
    state.redo = []
    state.payload = next
    state.status = `${status} ${state.undo.length}`
    changed()
    return state.status
  }
  const blockOf = (item) => ({ teacher: item.teacher, manualTeacher: item.manualTeacher })
  const driver = {
    seedAndOpen: async (_session, seed) => { state.payload = clone(seed.classrooms[0].data); state.saved = clone(state.payload) },
    readClassroom: async () => ({ classroomId: ROOM, payload: clone(state.payload) }),
    readStatusText: async () => state.status,
    // behavior.lagReads: 保存のあと n 回は保存ボタンがまだ「保存中」に見える(自動保存・保存の時間差)。
    readSaveState: async () => {
      if (state.lag > 0) { state.lag -= 1; return 'saving' }
      return state.dirty ? 'dirty' : 'clean'
    },
    clickSave: async () => {
      if (!state.dirty) return false
      state.saved = clone(state.payload)
      state.dirty = false
      state.saves += 1
      state.lag = behavior.lagReads ?? 0
      return true
    },
    reloadApp: async () => {
      if (state.dirty) throw new Error('未保存のまま読み込み直した(beforeunload)')
      state.payload = clone(state.saved)
      state.undo = []
      state.redo = []
      state.reloads += 1
    },
    gotoWeekOf: async (_session, dateKey) => { state.gotoWeeks.push(dateKey) },
    dragStudent: async (_session, from, to) => {
      state.calls.push('dragStudent')
      const next = clone(state.payload)
      const source = findDesk(next, from.cellId, from.deskIndex)
      findDesk(next, to.cellId, to.deskIndex).lesson.studentSlots[to.seat] = source.lesson.studentSlots[from.seat]
      source.lesson.studentSlots[from.seat] = null
      return commit(next, '移動しました')
    },
    markStudentAttendance: async (_session, seat, status) => {
      state.calls.push(`mark:${status}`)
      const next = clone(state.payload)
      const target = findDesk(next, seat.cellId, seat.deskIndex)
      const entry = target.lesson.studentSlots[seat.seat]
      const boardCell = cellOf(next, seat.cellId)
      target.lesson.studentSlots[seat.seat] = null
      target.statusSlots = target.statusSlots ?? [null, null]
      target.statusSlots[seat.seat] = { id: `${entry.id}_${status}`, studentId: entry.id, name: entry.name, managedStudentId: entry.managedStudentId, subject: entry.subject, lessonType: entry.lessonType, status: STATUS_BY_KIND[status], dateKey: boardCell.dateKey, slotNumber: boardCell.slotNumber, ...(entry.makeupSourceDate ? { makeupSourceDate: entry.makeupSourceDate } : {}) }
      // アプリと同じく、通常の休みは振替元を台帳へ積む。振替の休みは積まない(消化が外れて元の振替元が戻る)。
      if (status === 'absent' && entry.lessonType === 'regular' && !behavior.noStock) {
        const key = `${entry.managedStudentId}__${entry.subject}`
        const ledger = next.boardState.manualMakeupAdjustments ?? {}
        next.boardState.manualMakeupAdjustments = { ...ledger, [key]: [...(ledger[key] ?? []), { dateKey: boardCell.dateKey, slotNumber: boardCell.slotNumber }] }
      }
      return commit(next, `${status}`)
    },
    clearStudentAttendance: async (_session, seat) => {
      state.calls.push('clear')
      const next = clone(state.payload)
      const target = findDesk(next, seat.cellId, seat.deskIndex)
      const record = target.statusSlots?.[seat.seat]
      if (!record) return state.status
      target.statusSlots[seat.seat] = null
      target.lesson.studentSlots[seat.seat] = student(record.studentId, record.managedStudentId, record.lessonType, { subject: record.subject, ...(record.makeupSourceDate ? { makeupSourceDate: record.makeupSourceDate } : {}) })
      if (record.status === 'absent' && record.lessonType === 'regular') {
        const key = `${record.managedStudentId}__${record.subject}`
        const origins = [...(next.boardState.manualMakeupAdjustments?.[key] ?? [])]
        const index = origins.findIndex((origin) => origin.dateKey === record.dateKey && origin.slotNumber === record.slotNumber)
        if (index >= 0) origins.splice(index, 1)
        next.boardState.manualMakeupAdjustments = { ...next.boardState.manualMakeupAdjustments, [key]: origins }
        if (origins.length === 0) delete next.boardState.manualMakeupAdjustments[key]
      }
      return commit(next, '解除しました')
    },
    placeMakeupFromStock: async (_session, { stockStudentKey, choose }, to) => {
      state.calls.push('place')
      const rows = fakeStock(state.payload).makeupRows.filter((row) => row.key.startsWith(`${stockStudentKey}__`))
      const items = rows.flatMap((row) => row.remainingOriginLabels.map((label) => `${row.key.split('__')[1]} ${label} (休み)`))
      const index = choose(items)
      if (index < 0) return { placed: false, status: state.status }
      const row = rows[0]
      const next = clone(state.payload)
      findDesk(next, to.cellId, to.deskIndex).lesson.studentSlots[to.seat] = student(`pm${state.undo.length}`, stockStudentKey, 'makeup', { subject: row.key.split('__')[1], makeupSourceDate: row.remainingOriginDates[0] })
      return { placed: true, status: commit(next, '振替を置きました') }
    },
    dragTeacher: async (_session, from, to, swapMode) => {
      state.calls.push(`dragTeacher:${swapMode}`)
      const next = clone(state.payload)
      const boardCell = cellOf(next, from.cellId)
      const source = boardCell.desks[from.deskIndex]
      const target = boardCell.desks[to.deskIndex]
      const [sourceBlock, targetBlock] = [blockOf(source), blockOf(target)]
      Object.assign(source, targetBlock, { manualTeacher: Boolean(targetBlock.teacher) })
      Object.assign(target, sourceBlock, { manualTeacher: true })
      if (swapMode === 'seat' || behavior.swapMovesStudents) [source.lesson, target.lesson] = [target.lesson, source.lesson]
      return { status: commit(next, '講師を動かしました'), modal: true }
    },
    setBoardTeacher: async (_session, position, choose) => {
      state.calls.push('setBoardTeacher')
      const teacher = choose(['講師A', '講師B', '講師C', '講師D'].map((name) => ({ value: name, label: name })))
      if (!teacher) return { teacher: null, status: state.status }
      const next = clone(state.payload)
      const boardCell = cellOf(next, position.cellId)
      Object.assign(boardCell.desks[position.deskIndex], { teacher, manualTeacher: true, teacherAssignmentSource: 'manual' })
      boardCell.desks.forEach((item) => { if (item.teacherRest?.teacher === teacher) delete item.teacherRest })
      return { teacher, status: commit(next, '講師を設定しました') }
    },
    toggleTeacherRest: async (_session, position) => {
      state.calls.push('toggleTeacherRest')
      const next = clone(state.payload)
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
    clickUndo: async () => {
      if (state.undo.length === 0) return false
      state.undoCount += 1
      pushHistory(state.redo, state.payload)
      state.payload = state.undo.pop()
      if (behavior.undoBreaks === state.undoCount) {
        state.payload = clone(state.payload)
        findDesk(state.payload, behavior.undoBreakCell ?? '2026-11-18_1', 1).teacher = '講師Z'
      }
      state.status = `元に戻しました ${state.undoCount}`
      changed()
      return true
    },
    clickRedo: async () => {
      if (state.redo.length === 0) return false
      pushHistory(state.undo, state.payload)
      state.payload = state.redo.pop()
      state.status = `やり直しました ${state.undo.length}`
      changed()
      return true
    },
    takeScreenshot: async () => null,
    // 待ち(保存ボタンが clean になるまで)。偽のアプリでは待たない。
    wait: async () => {},
  }
  return { state, session, driver }
}

/** 偽の巡回の文脈(台本と同じ読み方・点検)で runRandomOps を流す。手順は steps へ・finish は「変」(known を外したあと)を返す。 */
async function runRandom(payload, { count = 12, seed = 1, behavior, weights } = {}) {
  const fake = makeFakeDriver(payload, behavior)
  const toState = (value) => ({ payload: value.payload, facts: app.collectBoardFacts(value.payload), auditResult: null })
  const read = async () => toState(await fake.driver.readClassroom(fake.session))
  const audit = (state) => { if (!state.auditResult) state.auditResult = app.auditClassroomSnapshot({ classroomId: ROOM, payload: state.payload, today: TODAY, known: [] }); return state.auditResult }
  const stockOf = (state) => { if (!state.stock) state.stock = app.collectStockBalances(state.payload, TODAY); return state.stock }
  const steps = []
  const io = {
    current: await read(),
    newStep: (title) => ({ title, started: Date.now(), operations: 0, findings: [], notes: [] }),
    finish: async (step) => { steps.push(step); return step.findings },
  }
  const result = await runRandomOps({
    ctx: { session: fake.session, driver: fake.driver, app, read, audit, stockOf, today: TODAY }, io, options: { random: count, seed }, today: TODAY, weekStart: '2026-11-16', nextMonday: '2026-11-16', weights,
  })
  const findings = steps.flatMap((step) => step.findings)
  const notes = steps.flatMap((step) => step.notes)
  return { result, steps, findings, notes, fake, io }
}
const stopsOf = (findings) => findings.filter((finding) => finding.level === 'stop')
/** 重い部品(休日・丸ごと振替・テンプレ)を外した重み(偽のアプリはそれらの画面を持たない)。 */
const LIGHT = Object.fromEntries(RANDOM_PARTS.map((part) => [part.name, ['holiday', 'whole-day', 'template-edit'].includes(part.name) ? 0 : part.weight]))
const ONLY = (names) => Object.fromEntries(RANDOM_PARTS.map((part) => [part.name, names.includes(part.name) ? part.weight : 0]))

describe('部品の表と重み', () => {
  it('部品は 1 か所の表(名前・ラベル・重み)。台本の操作がそろい、重い操作(テンプレ保存・丸ごと振替・休日)は最も少なく、生徒の移動が最も多い', () => {
    expect(RANDOM_PART_NAMES).toEqual(RANDOM_PARTS.map((part) => part.name))
    expect(RANDOM_PART_NAMES).toEqual(expect.arrayContaining([
      'move', 'attend-absent', 'attend-no-makeup', 'attend-attended', 'attend-place', 'attend-clear',
      'teacher-move', 'teacher-swap', 'seat-swap', 'teacher-menu', 'teacher-rest', 'teacher-release',
      'holiday', 'whole-day', 'undo', 'redo', 'save', 'reload', 'template-edit',
    ]))
    for (const part of RANDOM_PARTS) {
      expect(part.label).toBeTruthy()
      expect(Number.isInteger(part.weight) && part.weight > 0).toBe(true)
    }
    const weightOf = (name) => RANDOM_PARTS.find((part) => part.name === name).weight
    const heavy = ['holiday', 'whole-day', 'template-edit'].map(weightOf)
    const others = RANDOM_PARTS.filter((part) => !['holiday', 'whole-day', 'template-edit'].includes(part.name)).map((part) => part.weight)
    expect(Math.max(...heavy)).toBeLessThan(Math.min(...others) + 1)
    expect(Math.max(...heavy)).toBeLessThanOrEqual(Math.min(...others))
    expect(weightOf('move')).toBe(Math.max(...RANDOM_PARTS.map((part) => part.weight)))
  })
})

describe('pickNextRandomPart・advanceRandomModel・formatRandomTrace', () => {
  it('元に戻す物が無いときは undo を、やり直す物が無いときは redo を、未保存のときは reload を、保存済みのときは save を選ばない', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = createSeededRandom(seed)
      for (let index = 0; index < 200; index += 1) {
        expect(['undo', 'redo', 'save']).not.toContain(pickNextRandomPart({ ...createInitialRandomModel(), dirty: false }, random))
        expect(pickNextRandomPart({ ...createInitialRandomModel(), undoDepth: 2 }, random)).not.toBe('redo')
        expect(pickNextRandomPart({ ...createInitialRandomModel(), redoDepth: 1 }, random)).not.toBe('undo')
        expect(pickNextRandomPart({ ...createInitialRandomModel(), dirty: true }, random)).not.toBe('reload')
      }
    }
  })

  it('候補が無いと分かった部品(unavailable)は盤面が変わるまで選ばない。重み 0 の部品は選ばない', () => {
    const random = createSeededRandom(5)
    const allButSave = RANDOM_PART_NAMES.filter((name) => !['save', 'reload'].includes(name))
    for (let index = 0; index < 100; index += 1) expect(pickNextRandomPart({ ...createInitialRandomModel(), dirty: true, unavailable: allButSave }, random)).toBe('save')
    for (let index = 0; index < 100; index += 1) expect(pickNextRandomPart({ ...createInitialRandomModel(), dirty: true }, random, ONLY(['move', 'save']))).toMatch(/^(move|save)$/)
  })

  it('重みどおりの割合で選ぶ(どの部品も黙って選ばれなくなっていない)', () => {
    const random = createSeededRandom(11)
    const model = { ...createInitialRandomModel(), undoDepth: 1, redoDepth: 1, dirty: true }
    const counts = new Map()
    const draws = 40000
    for (let index = 0; index < draws; index += 1) {
      const name = pickNextRandomPart(model, random)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const available = RANDOM_PARTS.filter((part) => part.name !== 'reload')
    const total = available.reduce((sum, part) => sum + part.weight, 0)
    for (const part of available) {
      const expected = (part.weight / total) * draws
      expect(Math.abs((counts.get(part.name) ?? 0) - expected)).toBeLessThan(expected * 0.15 + 30)
    }
    expect(counts.has('reload')).toBe(false)
  })

  it('同じ種なら同じ部品の列・違う種なら違う列', () => {
    const walk = (seed) => {
      const random = createSeededRandom(seed)
      let model = createInitialRandomModel()
      const names = []
      for (let index = 0; index < 40; index += 1) {
        const name = pickNextRandomPart(model, random)
        names.push(name)
        model = advanceRandomModel(model, name, 'applied')
      }
      return names
    }
    expect(walk(1)).toEqual(walk(1))
    expect(walk(1)).not.toEqual(walk(2))
  })

  it('見込み: 盤面の操作で undo が 1 増え redo は 0・候補なしの印は消える。断られた・候補なしは印を付けるだけ。重い操作(保存→読み込み直しで終わる)は両方 0・保存済み', () => {
    const start = { undoDepth: 1, redoDepth: 2, dirty: false, unavailable: ['attend-place'] }
    expect(advanceRandomModel(start, 'move', 'applied')).toEqual({ undoDepth: 2, redoDepth: 0, dirty: true, unavailable: [] })
    expect(advanceRandomModel(start, 'teacher-rest', 'applied')).toEqual({ undoDepth: 2, redoDepth: 0, dirty: true, unavailable: [] })
    expect(advanceRandomModel(start, 'move', 'blocked')).toEqual({ ...start, unavailable: ['attend-place', 'move'] })
    expect(advanceRandomModel(start, 'attend-clear', 'skipped')).toEqual({ ...start, unavailable: ['attend-place', 'attend-clear'] })
    expect(advanceRandomModel(start, 'holiday', 'applied')).toEqual({ undoDepth: 0, redoDepth: 0, dirty: false, unavailable: [] })
    expect(advanceRandomModel({ undoDepth: 2, redoDepth: 0, dirty: false, unavailable: ['move'] }, 'undo', 'applied')).toEqual({ undoDepth: 1, redoDepth: 1, dirty: true, unavailable: [] })
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 1, dirty: false, unavailable: [] }, 'redo', 'applied')).toEqual({ undoDepth: 2, redoDepth: 0, dirty: true, unavailable: [] })
    // 保存は押せなかった(既に clean)ときも、実際の状態を正として保存済み。
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 0, dirty: true, unavailable: [] }, 'save', 'applied')).toMatchObject({ undoDepth: 1, dirty: false })
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 0, dirty: true, unavailable: [] }, 'save', 'skipped')).toMatchObject({ dirty: false })
    expect(advanceRandomModel({ undoDepth: 3, redoDepth: 2, dirty: false, unavailable: ['move'] }, 'reload', 'applied')).toEqual({ undoDepth: 0, redoDepth: 0, dirty: false, unavailable: ['move'] })
    expect(advanceRandomModel({ undoDepth: 3, redoDepth: 2, dirty: false, unavailable: [] }, 'reload', 'skipped')).toMatchObject({ undoDepth: 3, dirty: true })
    // 元の見込みは書き換えない。
    const original = { undoDepth: 1, redoDepth: 0, dirty: false, unavailable: [] }
    advanceRandomModel(original, 'move', 'blocked')
    expect(original).toEqual({ undoDepth: 1, redoDepth: 0, dirty: false, unavailable: [] })
    expect(() => advanceRandomModel(original, 'nope', 'applied')).toThrow()
  })

  it('元に戻すの履歴はアプリと同じ上限まで(MAX_HISTORY_DEPTH=10・古いものから捨てる)。やり直しも同じ上限', () => {
    let model = { undoDepth: 9, redoDepth: 0, dirty: true, unavailable: [] }
    model = advanceRandomModel(model, 'move', 'applied', { maxUndo: 10 })
    expect(model.undoDepth).toBe(10)
    model = advanceRandomModel(model, 'attend-absent', 'applied', { maxUndo: 10 })
    expect(model.undoDepth).toBe(10)
    expect(advanceRandomModel({ undoDepth: 10, redoDepth: 0, dirty: true, unavailable: [] }, 'redo', 'applied', { maxUndo: 10 }).undoDepth).toBe(10)
    expect(MAX_HISTORY_DEPTH).toBe(10)
  })

  it('流し直しの 1 行: "seed=7: move→attend-absent(断)→undo"', () => {
    expect(formatRandomTrace(7, ['move', 'attend-absent(断)', 'undo'])).toBe('seed=7: move→attend-absent(断)→undo')
    expect(formatRandomTrace(3, [])).toBe('seed=3: (なし)')
  })

  it('アプリが断った手の info(…-blocked)は所見にせず「飛ばした」の注へ移す。ほかの所見はそのまま', () => {
    const step = { title: 't', notes: ['a'], findings: [
      { level: 'info', code: 'move-blocked', message: 'アプリが移動を断った: x' },
      { level: 'info', code: 'change-summary', message: '変わった机 1' },
      { level: 'stop', code: 'page-error', message: '画面でエラー' },
      { level: 'info', code: 'day-op-blocked', message: 'アプリが日付の操作を断った: y' },
    ] }
    const converted = convertBlockedFindingsToNotes(step)
    expect(converted.findings.map((finding) => finding.code)).toEqual(['change-summary', 'page-error'])
    expect(converted.notes).toEqual(['a', '飛ばした(アプリが断った・所見にしない): アプリが移動を断った: x', '飛ばした(アプリが断った・所見にしない): アプリが日付の操作を断った: y'])
    expect(step.findings).toHaveLength(4)
  })
})

describe('部品の候補選び(その時点の盤面の事実から・種つきの乱数)', () => {
  const payload = richWeek
  const opts = (seed) => ({ weekDateKeys: WEEK, todayKey: TODAY, random: createSeededRandom(seed) })

  it('出欠を付ける: 休み=通常か振替の休み・振無休=通常・出席=通常か講習。同じ種なら同じ', () => {
    const facts = factsOf(payload())
    for (const [part, allowed] of [['attend-absent', ['regular-absent', 'makeup-absent']], ['attend-no-makeup', ['regular-absent-no-makeup']], ['attend-attended', ['regular-attended', 'special-attended']]]) {
      const op = pickRandomAttendanceMark(facts, { ...opts(3), part, excludeSeatKeys: new Set() })
      expect(op).not.toBeNull()
      expect(allowed).toContain(op.slot)
      expect(op.kind).toBe('mark')
      expect(pickRandomAttendanceMark(facts, { ...opts(3), part, excludeSeatKeys: new Set() })).toEqual(op)
    }
    expect(pickRandomAttendanceMark(factsOf(payloadOf([])), { ...opts(1), part: 'attend-absent', excludeSeatKeys: new Set() })).toBeNull()
  })

  it('出欠の解除: 付いている休み・振無休・出席の記録(席が空いている・講習は除く)。休みの解除は未消化振替が 1 以上のときだけ(戻すと消化するので)', () => {
    const base = payloadOf([cell('2026-11-17', 1, [
      desk('a0', '講師A', [null, null], { statusSlots: [{ id: 'x', studentId: 'e1', name: '生徒sA', managedStudentId: 'sA', subject: '数', lessonType: 'regular', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }, null] }),
      desk('a1', '講師B', [null, null], { statusSlots: [null, { id: 'y', studentId: 'e2', name: '生徒sB', managedStudentId: 'sB', subject: '数', lessonType: 'regular', status: 'attended', dateKey: '2026-11-17', slotNumber: 1 }] }),
      desk('a2', '講師C', [null, null], { statusSlots: [{ id: 'z', studentId: 'e3', name: '生徒sC', managedStudentId: 'sC', subject: '数', lessonType: 'special', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }, null] }),
    ])], { manualMakeupAdjustments: { 'sA__数': [{ dateKey: '2026-11-17', slotNumber: 1 }] } })
    const seen = new Set()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const op = pickRandomAttendanceClear(factsOf(base), base, fakeStock(base), opts(seed))
      seen.add(`${op.studentKey}:${op.status}:${op.seat.deskIndex}/${op.seat.seat}`)
      expect(op.kind).toBe('clear')
    }
    expect([...seen].sort()).toEqual(['sA:absent:0/0', 'sB:attended:1/1'])
    // 未消化振替が 0 の休みは解除の候補にしない(講習の休みは最初から選ばない)。
    const noStock = { ...clone(base), boardState: { ...clone(base).boardState, manualMakeupAdjustments: {} } }
    for (const seed of [1, 2, 3, 4]) expect(pickRandomAttendanceClear(factsOf(noStock), noStock, fakeStock(noStock), opts(seed))?.studentKey).toBe('sB')
    expect(pickRandomAttendanceClear(factsOf(payloadOf([])), payloadOf([]), fakeStock(payloadOf([])), opts(1))).toBeNull()
    // 在庫の仕様の増減: 休みの解除は −1(戻した授業がまた消化する)・振無休/出席の解除は ±0。範囲は記録の机と台帳・抑止キー。
    expect(expectedStockDeltas({ kind: 'clear', status: 'absent', lessonType: 'regular', studentKey: 'sA', subject: '数' })).toEqual({ makeup: { 'sA__数': -1 }, lecture: {} })
    expect(expectedStockDeltas({ kind: 'clear', status: 'absent', lessonType: 'makeup', studentKey: 'sA', subject: '数' })).toEqual({ makeup: { 'sA__数': -1 }, lecture: {} })
    expect(expectedStockDeltas({ kind: 'clear', status: 'attended', lessonType: 'regular', studentKey: 'sB', subject: '数' })).toEqual({ makeup: {}, lecture: {} })
    const allowed = buildAttendanceAllowedChange({ kind: 'clear', status: 'absent', seat: { cellId: 'c', deskIndex: 1, seat: 0 } })
    expect([...allowed.deskKeys]).toEqual(['c#1'])
    expect([...allowed.sections].sort()).toEqual(['boardState.manualMakeupAdjustments', 'boardState.suppressedRegularLessonOccurrences'])
    expect([...buildAttendanceAllowedChange({ kind: 'clear', status: 'attended', seat: { cellId: 'c', deskIndex: 1, seat: 0 } }).sections]).toEqual(['boardState.suppressedRegularLessonOccurrences'])
  })

  it('振替先を決める: 付いている通常の休みで未消化振替が 1 以上の生徒を、その生徒の居ない別のコマの空いた席へ', () => {
    const base = payloadOf([
      cell('2026-11-17', 1, [desk('a0', '講師A', [null, null], { statusSlots: [{ id: 'x', studentId: 'e1', name: '生徒sA', managedStudentId: 'sA', subject: '数', lessonType: 'regular', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }, null] }), desk('a1', '講師B')]),
      cell('2026-11-18', 1, [desk('b0', '講師A', [student('eA2', 'sA'), null]), desk('b1', '講師B')]),
      cell('2026-11-19', 1, [desk('c0', '講師C')]),
    ], { manualMakeupAdjustments: { 'sA__数': [{ dateKey: '2026-11-17', slotNumber: 1 }] } })
    const op = pickRandomMakeupPlace(factsOf(base), base, fakeStock(base), opts(2))
    expect(op).toMatchObject({ kind: 'place', studentKey: 'sA', subject: '数', sourceDateKey: '2026-11-17', sourceSlotNumber: 1 })
    // 同じコマ・その生徒の居るコマ(11/18 1限)には置かない。
    expect(op.to.cellId).not.toBe('2026-11-17_1')
    expect(op.to.cellId).not.toBe('2026-11-18_1')
    expect(op.to).toMatchObject({ cellId: '2026-11-19_1', deskIndex: 0 })
    const none = { ...clone(base), boardState: { ...clone(base).boardState, manualMakeupAdjustments: {} } }
    expect(pickRandomMakeupPlace(factsOf(none), none, fakeStock(none), opts(2))).toBeNull()
  })

  it('講師: 移動・講師だけ入替・生徒ごと席入替・講師メニュー・休みは台本 f の候補選び(1 種類だけ)。解除は休みの記録のある机', () => {
    const facts = factsOf(payload())
    for (const [part, name] of [['teacher-move', 'move'], ['teacher-swap', 'teacher-swap'], ['seat-swap', 'seat-swap'], ['teacher-menu', 'menu-teacher'], ['teacher-rest', 'rest-toggle']]) {
      const op = pickRandomTeacherOp(facts, { ...opts(4), part })
      expect(op?.name).toBe(name)
      expect(pickRandomTeacherOp(facts, { ...opts(4), part })).toEqual(op)
    }
    expect(pickRandomTeacherRelease(facts, opts(1))).toBeNull()
    const rested = payloadOf([cell('2026-11-17', 1, [desk('a0', '', [student('e1', 'sA'), null], { teacherRest: { teacher: '講師A' } }), desk('a1', '講師B')])])
    expect(pickRandomTeacherRelease(factsOf(rested), opts(1))).toMatchObject({ cellId: '2026-11-17_1', deskIndex: 0, restName: '講師A' })
  })
})

describe('runRandomOps(偽のアプリで流す)', () => {
  it('種ごとに 30 手流して「変」は出ず、手ごとに 何手目・どの部品・どこに何を を残す。出欠・講師の部品も効く。同じ種なら同じ列と同じ盤面', async () => {
    const parts = new Set()
    for (const seed of [1, 2, 3, 4, 5]) {
      const first = await runRandom(richWeek(), { seed, count: 30, weights: LIGHT })
      const second = await runRandom(richWeek(), { seed, count: 30, weights: LIGHT })
      expect([seed, stopsOf(first.findings)]).toEqual([seed, []])
      expect(first.result.aborted).toBeNull()
      expect(first.result.ops).toHaveLength(30)
      expect(first.result.ops).toEqual(second.result.ops)
      expect(second.fake.state.payload).toEqual(first.fake.state.payload)
      const handSteps = first.steps.filter((step) => /^でたらめ \d+ 手目/.test(step.title))
      expect(handSteps.length).toBeGreaterThanOrEqual(30)
      expect(handSteps[0].title).toMatch(/^でたらめ 1 手目\(/)
      expect(first.steps[0].title).toContain('でたらめ操作の準備')
      expect(first.steps.at(-1).title).toContain('でたらめ操作のまとめ')
      expect(first.steps.at(-1).notes).toContain(`手順: ${first.result.trace}`)
      for (const op of first.result.ops) parts.add(op.replace('(断)', ''))
    }
    for (const name of ['move', 'attend-absent', 'attend-clear', 'teacher-rest', 'teacher-swap', 'undo']) expect(parts).toContain(name)
  })

  it('元に戻すの履歴の上限を束ねた app から読めなければ流さずに例外(予備の値で黙って流さない)', async () => {
    const saved = app.MAX_HISTORY_DEPTH
    try {
      delete app.MAX_HISTORY_DEPTH
      await expect(runRandom(roomyWeek(), { count: 2 })).rejects.toThrow(/MAX_HISTORY_DEPTH/)
    } finally {
      app.MAX_HISTORY_DEPTH = saved
    }
  })

  it('k 手で止めて流し直すと、n 手の流しの最初の k 手と同じ列(所見を短く再現できる・--random <k>)', async () => {
    const long = await runRandom(richWeek(), { seed: 9, count: 25, weights: LIGHT })
    const short = await runRandom(richWeek(), { seed: 9, count: 12, weights: LIGHT })
    expect(short.result.ops).toEqual(long.result.ops.slice(0, 12))
  })

  it('候補の無い部品は選び直す(手に数えない理由を注に)。手の数はそのまま', async () => {
    // 出欠の解除だけ候補が無い盤面(記録が無い)で、解除と保存・読み込み直しだけを選ぶ重み。
    const { result, notes } = await runRandom(roomyWeek(), { seed: 2, count: 6, weights: ONLY(['attend-clear', 'save', 'reload', 'move']) })
    expect(result.ops).toHaveLength(6)
    expect(result.ops.filter((op) => op === 'attend-clear')).toEqual([])
    expect(notes.join('\n')).toContain('候補なしで選び直した')
  })

  it('わざと壊す: 通常の休みで在庫を増やさない → stop stock-delta-mismatch でその手で打ち切る(種・何手目が分かる)', async () => {
    let sawStop = false
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { result, steps } = await runRandom(richWeek(), { seed, count: 30, weights: ONLY(['attend-absent', 'save', 'undo']), behavior: { noStock: true } })
      const stopped = steps.find((step) => stopsOf(step.findings).length > 0)
      if (!stopped) continue
      sawStop = true
      expect(stopsOf(stopped.findings).map((finding) => finding.code)).toContain('stock-delta-mismatch')
      expect(stopped.title).toContain(`でたらめ ${result.stoppedAt} 手目`)
      expect(result.ops).toHaveLength(result.stoppedAt)
    }
    expect(sawStop).toBe(true)
  })

  it('わざと壊す: 講師だけ入替で生徒も動く → stop teacher-op-not-applied', async () => {
    let sawStop = false
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { findings } = await runRandom(richWeek(), { seed, count: 20, weights: ONLY(['teacher-swap', 'save']), behavior: { swapMovesStudents: true } })
      if (stopsOf(findings).length === 0) continue
      sawStop = true
      expect(stopsOf(findings).map((finding) => finding.code)).toContain('teacher-op-not-applied')
    }
    expect(sawStop).toBe(true)
  })

  it('元に戻す・やり直しの前に保存する(前に保存した形へ戻る操作のあとローカルモードの控えに途中の形が残る罠)。元に戻すで戻らなければ stop undo-not-restored', async () => {
    let sawUndo = false
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { result, findings, fake } = await runRandom(roomyWeek(), { seed, count: 12, weights: ONLY(['move', 'undo', 'redo', 'save', 'reload']), behavior: { undoBreaks: 1 } })
      if (!result.ops.includes('undo') && fake.state.undoCount === 0) continue
      sawUndo = true
      const stops = stopsOf(findings)
      expect(stops.map((finding) => finding.code)).toContain('undo-not-restored')
      expect(result.stoppedAt).not.toBeNull()
    }
    expect(sawUndo).toBe(true)
    // 元に戻すを押す前には保存ボタンを押している(未保存なら)。
    const { fake } = await runRandom(roomyWeek(), { seed: 3, count: 12, weights: ONLY(['move', 'undo']) })
    expect(fake.state.saves).toBeGreaterThan(0)
  })

  it('読み込み直すかは保存ボタンの時間差で変わらない: 保存中に見えるあいだは clean になるまで待ってから読み込み直す(同じ種なら同じ列)', async () => {
    const weights = ONLY(['move', 'save', 'reload'])
    const plain = await runRandom(roomyWeek(), { seed: 6, count: 16, weights })
    const lagged = await runRandom(roomyWeek(), { seed: 6, count: 16, weights, behavior: { lagReads: 3 } })
    expect(lagged.result.ops).toEqual(plain.result.ops)
    expect(lagged.fake.state.reloads).toBe(plain.fake.state.reloads)
    expect(plain.fake.state.reloads).toBeGreaterThan(0)
    expect(stopsOf(lagged.findings)).toEqual([])
    expect(lagged.notes.join('\n')).not.toContain('読み込み直さない')
  })

  it('保存ボタンが clean にならないまま読み込み直せないのは「変」(保存ボタンの状態の食い違い)', async () => {
    let sawStop = false
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { findings, result } = await runRandom(roomyWeek(), { seed, count: 24, weights: ONLY(['move', 'save', 'reload']), behavior: { lagReads: 1000 } })
      const stops = stopsOf(findings)
      if (stops.length === 0) continue
      sawStop = true
      expect(stops.map((finding) => finding.code)).toEqual(['save-changed'])
      expect(result.stoppedAt).not.toBeNull()
    }
    expect(sawStop).toBe(true)
  })

  it('ローカルモードが自分で保存して clean のとき、保存は操作に数えず注に書く(中断にしない)', async () => {
    let sawSkip = false
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { result, findings, notes, fake } = await runRandom(roomyWeek(), { seed, weights: ONLY(['move', 'save', 'reload']), behavior: { autoSaved: true } })
      expect(stopsOf(findings)).toEqual([])
      expect(result.aborted).toBeNull()
      expect(fake.state.saves).toBe(0)
      if (result.ops.includes('save')) {
        sawSkip = true
        expect(notes.join('\n')).toContain('保存ボタンは既に clean で押せませんでした')
      }
    }
    expect(sawSkip).toBe(true)
  })

  it('元に戻すの履歴の上限(10)を超えて盤面の手を重ねても、最後の元に戻すは届く所まで(古い手は戻さず注に書く)', async () => {
    const { result, findings, notes } = await runRandom(richWeek(), { seed: 4, count: 24, weights: ONLY(['move', 'attend-absent', 'attend-no-makeup', 'teacher-rest', 'teacher-swap']) })
    expect(stopsOf(findings)).toEqual([])
    expect(result.aborted).toBeNull()
    expect(notes.join('\n')).toMatch(/元に戻すの履歴\(アプリは 10 まで\)から外れた手 \d+/)
  })

  it('最後は元に戻すを積んだ分だけ押して土台へ戻す(読み込み直しが無ければ種データと同じ盤面)', async () => {
    for (const seed of [1, 2, 3]) {
      const { result, fake, notes } = await runRandom(richWeek(), { seed, count: 15, weights: ONLY(['move', 'attend-absent', 'teacher-rest', 'save']) })
      expect(result.aborted).toBeNull()
      if (fake.state.reloads === 0 && !notes.join('\n').includes('から外れた手')) expect(app.diffBoardFacts(factsOf(richWeek()), factsOf(fake.state.payload))).toEqual({ desks: [], sections: [] })
    }
  })
})

describe('attemptStudentMove(台本 b とでたらめ操作の共有)', () => {
  const read = (fake) => async () => { const value = await fake.driver.readClassroom(fake.session); return { payload: value.payload, facts: app.collectBoardFacts(value.payload), auditResult: null } }
  const audit = () => ({ findings: [] })
  const candidate = { kind: 'regular-same-slot', from: { cellId: '2026-11-17_1', deskIndex: 0, seat: 0 }, to: { cellId: '2026-11-17_1', deskIndex: 1, seat: 0 }, studentId: 'sA' }

  it('効いた移動: outcome moved・点検に「変」なし・前後の事実を返す', async () => {
    const fake = makeFakeDriver(roomyWeek())
    const before = await read(fake)()
    const result = await attemptStudentMove({ session: fake.session, driver: fake.driver, app, before, candidate, read: read(fake), audit })
    expect(result.outcome).toBe('moved')
    expect(stopsOf(result.findings)).toEqual([])
    expect(result.notes[0]).toContain('通常・同じコマの別の机')
    expect(result.notes[1]).toBe('ステータス: 移動しました 1')
    expect(result.diff.before).toBe(before.facts)
  })

  it('状態が変わらない移動: 文が変われば blocked(info move-blocked)・文も変わらなければ nothing', async () => {
    const fake = makeFakeDriver(roomyWeek())
    fake.driver.dragStudent = async () => { fake.state.status = '断りました'; return fake.state.status }
    const before = await read(fake)()
    const blocked = await attemptStudentMove({ session: fake.session, driver: fake.driver, app, before, candidate, read: read(fake), audit })
    expect(blocked.outcome).toBe('blocked')
    expect(blocked.findings.map((finding) => `${finding.level}:${finding.code}`)).toEqual(['info:move-blocked'])
    const nothing = await attemptStudentMove({ session: fake.session, driver: fake.driver, app, before, candidate, read: read(fake), audit })
    expect(nothing.outcome).toBe('nothing')
    expect(nothing.message).toContain('何も起きません')
  })

  it('動かした生徒が先の席にいなければ stop move-not-applied', async () => {
    const fake = makeFakeDriver(roomyWeek())
    const originalDrag = fake.driver.dragStudent
    fake.driver.dragStudent = async (session, from) => originalDrag(session, from, { cellId: '2026-11-17_1', deskIndex: 2, seat: 0 })
    const before = await read(fake)()
    const result = await attemptStudentMove({ session: fake.session, driver: fake.driver, app, before, candidate, read: read(fake), audit })
    expect(result.findings.map((finding) => finding.code)).toContain('move-not-applied')
  })
})

describe('runClassroomPatrol(手順 random のつなぎ)', () => {
  async function patrol(scenarios, random, payload = roomyWeek(), fake = makeFakeDriver(payload)) {
    const report = await runClassroomPatrol({
      session: fake.session, app, classroom: { classroomId: ROOM, label: 'R', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: payload }] },
      // 偽のアプリは休日・丸ごと振替・テンプレの画面を持たないので、重い部品を外す(randomWeights はテスト用の差し替え・引数には無い)。
      options: { scenarios, moves: 2, seed: 1, random, randomWeights: LIGHT }, outDir: '/nonexistent-patrol-out', known: [], today: TODAY, driver: fake.driver,
    })
    return { report, fake }
  }
  const summaryOf = (report) => report.steps.find((step) => step.name === 'random' && step.title.includes('でたらめ操作のまとめ'))

  it('でたらめ操作の途中で driver が時間切れ(例外)になっても、手順の 1 行を残して教室を中断する', async () => {
    const fake = makeFakeDriver(roomyWeek())
    let drags = 0
    const originalDrag = fake.driver.dragStudent
    fake.driver.dragStudent = async (...args) => { drags += 1; if (drags === 2) throw new PatrolAbortError('先の席の位置が取れません。'); return originalDrag(...args) }
    const { report } = await patrol(['boot'], 12, roomyWeek(), fake)
    expect(report.aborted).toMatch(/^random: 先の席の位置が取れません/)
    expect(summaryOf(report).notes.join('\n')).toMatch(/手順: seed=1: .*move$/m)
  })

  it('--random 0(既定)では手順 random を流さない', async () => {
    const { report } = await patrol(['boot', 'b'], 0)
    expect(report.steps.map((step) => step.name)).not.toContain('random')
    expect(report.randomTrace).toBeUndefined()
  })

  it('--random n は台本 b のあとに流す。b が無くても流す(週は b と同じ探し方)。手順の 1 行と部品の列を報告に残す', async () => {
    const withB = await patrol(['boot', 'b'], 6)
    expect(withB.report.aborted).toBeNull()
    const names = withB.report.steps.map((step) => step.name)
    expect(names.indexOf('random')).toBeGreaterThan(names.lastIndexOf('b'))
    expect(summaryOf(withB.report).notes.join('\n')).toMatch(/手順: seed=1: /)
    expect(withB.report.steps.filter((step) => step.name === 'random').flatMap((step) => step.findings).filter((finding) => finding.level === 'stop')).toEqual([])
    expect(withB.report.randomTrace).toHaveLength(6)
    const withoutB = await patrol(['boot'], 6)
    expect(withoutB.report.aborted).toBeNull()
    expect([...new Set(withoutB.report.steps.map((step) => step.name))]).toEqual(['boot', 'random', 'browser'])
    expect(withoutB.fake.state.gotoWeeks[0]).toBe('2026-11-16')
    expect(withoutB.report.steps.filter((step) => step.name === 'random').reduce((sum, step) => sum + step.operations, 0)).toBeGreaterThan(0)
  })

  it('全部の手が盤面を変えられなかった(候補なし・断られた)なら、でたらめ操作だけの流しは「何も操作できなかった」(終了コード 2)', async () => {
    const empty = payloadOf([cell('2026-11-17', 1, [desk('a0', '')])])
    const { report } = await patrol(['boot'], 5, empty)
    expect(report.aborted).toBeNull()
    expect(report.noScenarioRan).toBe(true)
    expect(resolveExitCode({ classrooms: [report] })).toBe(2)
  })
})
