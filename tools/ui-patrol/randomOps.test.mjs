// tools/ui-patrol/randomOps.mjs(でたらめ操作の土台・試験的)を固定する。フィクスチャは架空の名前だけ(生徒A〜D・講師A〜D)。
// 盤面の事実と点検は本物(boardFacts.ts・checks.ts)。ブラウザの代わりに偽の driver(移動・元に戻す・やり直し・保存・読み込み直し)を使う。
import { describe, it, expect } from 'vitest'
import { RANDOM_OP_NAMES, advanceRandomModel, formatRandomTrace, pickNextRandomOp, runRandomOps } from './randomOps.mjs'
import { attemptStudentMove, createSeededRandom, runClassroomPatrol } from './scenarios.mjs'
import { PatrolAbortError } from './driver.mjs'
import * as boardFactsModule from './boardFacts.ts'
import * as checksModule from './checks.ts'
import { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff.ts'

const ROOM = 'roomR'
const TODAY = '2026-11-11' // 来週の月曜は 11/16
const app = { ...boardFactsModule, ...checksModule, resolveNextMondayDateKey, auditClassroomSnapshot: () => ({ findings: [] }) }
const clone = (value) => structuredClone(value)
const EMPTY = { undoDepth: 0, redoDepth: 0, dirty: false }

function student(id, managedStudentId) {
  return { id, name: `生徒${managedStudentId}`, managedStudentId, grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal' }
}
function desk(id, teacher, studentSlots = [null, null]) {
  return { id, teacher, lesson: { id: `L-${id}`, studentSlots } }
}
function cell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}
function payloadOf(cells) {
  return {
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4 },
    managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [cells], weekIndex: 0 },
  }
}
/** 11/17 1限と 11/18 1限。生徒 2 人と空いた講師の机がいくつか(移動の候補が何度でも作れる)。 */
const roomyWeek = () => payloadOf([
  cell('2026-11-17', 1, [desk('a0', '講師A', [student('e1', 'sA'), student('e2', 'sB')]), desk('a1', '講師B'), desk('a2', '講師C')]),
  cell('2026-11-18', 1, [desk('b0', '講師A'), desk('b1', '講師D')]),
])

function findDesk(payload, cellId, deskIndex) {
  return payload.boardState.weeks.flat().find((item) => item.id === cellId).desks[deskIndex]
}

/**
 * 偽のアプリ: 移動・元に戻す・やり直し・保存・読み込み直し。読み込み直しは保存した盤面に戻り、履歴を捨てる(アプリと同じ)。
 * behavior.autoSaved: 変更のあと自分で保存したことにする(ローカルモードの 5 秒後の自動保存)。
 * behavior.undoBreaks: n 回目の元に戻すで盤面を戻し損ねる(点検が「変」を出すこと)。
 */
function makeFakeDriver(initialPayload, behavior = {}) {
  const state = { payload: clone(initialPayload), saved: clone(initialPayload), dirty: false, status: '初期', undo: [], redo: [], gotoWeeks: [], undoCount: 0, reloads: 0, saves: 0 }
  const session = { dialogs: [], downloads: 0, externalRequests: [], pageErrors: [] }
  const changed = () => { state.dirty = !behavior.autoSaved; if (behavior.autoSaved) state.saved = clone(state.payload) }
  const driver = {
    seedAndOpen: async (_session, seed) => { state.payload = clone(seed.classrooms[0].data); state.saved = clone(state.payload) },
    readClassroom: async () => ({ classroomId: ROOM, payload: clone(state.payload) }),
    readStatusText: async () => state.status,
    readSaveState: async () => (state.dirty ? 'dirty' : 'clean'),
    clickSave: async () => {
      if (!state.dirty) return false
      state.saved = clone(state.payload)
      state.dirty = false
      state.saves += 1
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
      state.undo.push(state.payload)
      state.redo = []
      const next = clone(state.payload)
      const source = findDesk(next, from.cellId, from.deskIndex)
      findDesk(next, to.cellId, to.deskIndex).lesson.studentSlots[to.seat] = source.lesson.studentSlots[from.seat]
      source.lesson.studentSlots[from.seat] = null
      state.payload = next
      state.status = `移動しました ${state.undo.length}`
      changed()
      return state.status
    },
    clickUndo: async () => {
      if (state.undo.length === 0) return false
      state.undoCount += 1
      state.redo.push(state.payload)
      state.payload = state.undo.pop()
      if (behavior.undoBreaks === state.undoCount) {
        state.payload = clone(state.payload)
        findDesk(state.payload, '2026-11-18_1', 1).teacher = '講師Z'
      }
      state.status = '元に戻しました'
      changed()
      return true
    },
    clickRedo: async () => {
      if (state.redo.length === 0) return false
      state.undo.push(state.payload)
      state.payload = state.redo.pop()
      state.status = 'やり直しました'
      changed()
      return true
    },
    takeScreenshot: async () => null,
  }
  return { state, session, driver }
}

/** runRandomOps を、偽の driver と台本と同じ読み方・点検で流す。 */
async function runRandom(payload, { count = 12, seed = 1, behavior } = {}) {
  const fake = makeFakeDriver(payload, behavior)
  const toState = (read) => ({ payload: read.payload, facts: app.collectBoardFacts(read.payload), auditResult: null })
  const read = async () => toState(await fake.driver.readClassroom(fake.session))
  const audit = (state) => { if (!state.auditResult) state.auditResult = app.auditClassroomSnapshot({ classroomId: ROOM, payload: state.payload, today: TODAY, known: [] }); return state.auditResult }
  const findings = []
  const notes = []
  const result = await runRandomOps({
    session: fake.session, app, options: { random: count, seed }, today: TODAY, driver: fake.driver, start: await read(), weekStart: '2026-11-16', read, audit,
    onFinding: (finding) => findings.push(finding), onNote: (note) => notes.push(note),
  })
  return { result, findings, notes, fake }
}

describe('pickNextRandomOp・advanceRandomModel・formatRandomTrace', () => {
  it('元に戻す物が無いときは undo を選ばない。やり直す物が無いときは redo を選ばない。未保存のときは reload を選ばない', () => {
    expect(RANDOM_OP_NAMES).toEqual(['move', 'undo', 'redo', 'save', 'reload'])
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = createSeededRandom(seed)
      for (let index = 0; index < 50; index += 1) {
        expect(['undo', 'redo']).not.toContain(pickNextRandomOp({ undoDepth: 0, redoDepth: 0, dirty: false }, random))
        expect(pickNextRandomOp({ undoDepth: 2, redoDepth: 0, dirty: false }, random)).not.toBe('redo')
        expect(pickNextRandomOp({ undoDepth: 0, redoDepth: 1, dirty: true }, random)).not.toBe('undo')
        expect(pickNextRandomOp({ undoDepth: 1, redoDepth: 1, dirty: true }, random)).not.toBe('reload')
      }
    }
    // 条件がそろえば 5 つとも選ばれる(どれかが黙って選ばれなくなっていない)。
    const random = createSeededRandom(3)
    const seen = new Set()
    for (let index = 0; index < 200; index += 1) {
      seen.add(pickNextRandomOp({ undoDepth: 1, redoDepth: 1, dirty: true }, random))
      seen.add(pickNextRandomOp({ undoDepth: 1, redoDepth: 1, dirty: false }, random))
    }
    expect([...seen].sort()).toEqual([...RANDOM_OP_NAMES].sort())
    // 移動の候補が無いと分かっているときは move を選ばない(canMove=false)。
    for (let index = 0; index < 50; index += 1) expect(pickNextRandomOp({ ...EMPTY, canMove: false }, random)).toBe('reload')
  })

  it('同じ種なら同じ操作の列', () => {
    const walk = (seed) => {
      const random = createSeededRandom(seed)
      let model = { ...EMPTY }
      const ops = []
      for (let index = 0; index < 30; index += 1) {
        const op = pickNextRandomOp(model, random)
        ops.push(op)
        model = advanceRandomModel(model, op, { applied: true })
      }
      return ops
    }
    expect(walk(1)).toEqual(walk(1))
    expect(walk(1)).not.toEqual(walk(2))
  })

  it('見込み: 移動で undo が 1 増え redo は 0。通らなかった移動は変えない。読み込み直しで両方 0', () => {
    const moved = advanceRandomModel({ undoDepth: 1, redoDepth: 2, dirty: false }, 'move', { applied: true })
    expect(moved).toMatchObject({ undoDepth: 2, redoDepth: 0, dirty: true })
    const blocked = { undoDepth: 1, redoDepth: 2, dirty: false }
    expect(advanceRandomModel(blocked, 'move', { applied: false })).toEqual(blocked)
    expect(advanceRandomModel({ undoDepth: 2, redoDepth: 0, dirty: false }, 'undo', { applied: true })).toMatchObject({ undoDepth: 1, redoDepth: 1, dirty: true })
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 1, dirty: false }, 'redo', { applied: true })).toMatchObject({ undoDepth: 2, redoDepth: 0, dirty: true })
    // 保存は押せなかった(既に clean)ときも、実際の状態を正として dirty=false。
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 0, dirty: true }, 'save', { applied: true })).toMatchObject({ undoDepth: 1, dirty: false })
    expect(advanceRandomModel({ undoDepth: 1, redoDepth: 0, dirty: true }, 'save', { applied: false })).toMatchObject({ dirty: false })
    expect(advanceRandomModel({ undoDepth: 3, redoDepth: 2, dirty: false }, 'reload', { applied: true })).toMatchObject({ undoDepth: 0, redoDepth: 0, dirty: false })
    // 元の見込みは書き換えない。
    const original = { undoDepth: 1, redoDepth: 0, dirty: false }
    advanceRandomModel(original, 'move', { applied: true })
    expect(original).toEqual({ undoDepth: 1, redoDepth: 0, dirty: false })
  })

  it('流し直しの 1 行: "seed=7: move→undo→redo→save→reload"', () => {
    expect(formatRandomTrace(7, ['move', 'undo', 'redo', 'save', 'reload'])).toBe('seed=7: move→undo→redo→save→reload')
    expect(formatRandomTrace(3, [])).toBe('seed=3: (なし)')
  })
})

describe('runRandomOps(偽のアプリで流す)', () => {
  it('種ごとに 12 回流して「変」は出ず、最後に土台へ戻る。同じ種なら同じ手順と同じ盤面', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const first = await runRandom(roomyWeek(), { seed })
      const second = await runRandom(roomyWeek(), { seed })
      expect(first.findings.filter((finding) => finding.level === 'stop')).toEqual([])
      expect(first.result.ops).toHaveLength(12)
      expect(first.result.ops).toEqual(second.result.ops)
      expect(first.result.trace).toBe(formatRandomTrace(seed, first.result.ops))
      expect(first.notes).toContain(`手順: ${first.result.trace}`)
      expect(first.result.operations).toBeGreaterThan(0)
      expect(second.fake.state.payload).toEqual(first.fake.state.payload)
      expect(first.result.aborted).toBeNull()
      // 読み込み直しをしていなければ、最後は種データと同じ盤面(土台)。
      if (first.fake.state.reloads === 0) expect(app.diffBoardFacts(app.collectBoardFacts(roomyWeek()), app.collectBoardFacts(first.fake.state.payload))).toEqual({ desks: [], sections: [] })
    }
  })

  it('読み込み直しは保存が clean のときだけ。読み込み直しのあとはその状態が新しい土台(保存された移動が残ることを notes に出す)', async () => {
    let sawReload = false
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { result, findings, notes, fake } = await runRandom(roomyWeek(), { seed, count: 16 })
      expect(findings.filter((finding) => finding.level === 'stop')).toEqual([])
      if (fake.state.reloads === 0) continue
      sawReload = true
      // 読み込み直しのあとは、その週を開き直す(盤面の操作は開いている週の席に対して行うため)。
      expect(fake.state.gotoWeeks.length).toBeGreaterThanOrEqual(fake.state.reloads)
      if (result.persistedMoves > 0) expect(notes.join('\n')).toContain(`でたらめ操作で ${result.persistedMoves} 回の移動が保存されたまま残っています`)
    }
    expect(sawReload).toBe(true)
  })

  it('ローカルモードが自分で保存して clean のとき、保存は操作に数えず notes に書く(中断にしない)', async () => {
    let sawSkip = false
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { result, findings, notes, fake } = await runRandom(roomyWeek(), { seed, behavior: { autoSaved: true } })
      expect(findings.filter((finding) => finding.level === 'stop')).toEqual([])
      expect(result.aborted).toBeNull()
      expect(fake.state.saves).toBe(0)
      if (result.ops.includes('save')) {
        sawSkip = true
        expect(notes.join('\n')).toContain('保存ボタンは既に clean で押せませんでした')
      }
    }
    expect(sawSkip).toBe(true)
  })

  it('元に戻すで盤面が戻らなければ stop undo-not-restored を出し、そこで打ち切る', async () => {
    let sawStop = false
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { result, findings } = await runRandom(roomyWeek(), { seed, behavior: { undoBreaks: 1 } })
      const stops = findings.filter((finding) => finding.level === 'stop')
      if (stops.length === 0) continue
      sawStop = true
      expect(stops.map((finding) => finding.code)).toContain('undo-not-restored')
      // 打ち切る: stop の出た操作が手順の最後。
      expect(result.stoppedAt).toBe(result.ops.length)
      expect(result.diff).not.toBeNull()
    }
    expect(sawStop).toBe(true)
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
    expect(result.findings.filter((finding) => finding.level === 'stop')).toEqual([])
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
  async function patrol(scenarios, random) {
    const fake = makeFakeDriver(roomyWeek())
    const report = await runClassroomPatrol({
      session: fake.session, app, classroom: { classroomId: ROOM, label: 'R', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: roomyWeek() }] },
      options: { scenarios, moves: 2, seed: 1, random }, outDir: '/nonexistent-patrol-out', known: [], today: TODAY, driver: fake.driver,
    })
    return { report, fake }
  }

  it('でたらめ操作の途中で driver が時間切れ(例外)になっても、手順の 1 行を残して教室を中断する', async () => {
    const fake = makeFakeDriver(roomyWeek())
    let drags = 0
    const originalDrag = fake.driver.dragStudent
    fake.driver.dragStudent = async (...args) => { drags += 1; if (drags === 2) throw new PatrolAbortError('先の席の位置が取れません。'); return originalDrag(...args) }
    const report = await runClassroomPatrol({
      session: fake.session, app, classroom: { classroomId: ROOM, label: 'R', backupKey: 'k' },
      seedSnapshot: { actingClassroomId: ROOM, classrooms: [{ id: ROOM, data: roomyWeek() }] },
      options: { scenarios: ['boot'], moves: 2, seed: 1, random: 12 }, outDir: '/nonexistent-patrol-out', known: [], today: TODAY, driver: fake.driver,
    })
    expect(report.aborted).toMatch(/^random: 先の席の位置が取れません/)
    const randomStep = report.steps.find((step) => step.name === 'random')
    expect(randomStep.notes.join('\n')).toMatch(/手順: seed=1: (\w+→)*move$/m)
  })

  it('--random 0(既定)では手順 random を流さない', async () => {
    const { report } = await patrol(['boot', 'b'], 0)
    expect(report.steps.map((step) => step.name)).not.toContain('random')
  })

  it('--random n は台本 b のあとに流す。b が無くても流す(週は b と同じ探し方)。手順の 1 行を notes に残す', async () => {
    const withB = await patrol(['boot', 'b'], 6)
    expect(withB.report.aborted).toBeNull()
    const names = withB.report.steps.map((step) => step.name)
    expect(names.indexOf('random')).toBeGreaterThan(names.lastIndexOf('b'))
    const randomStep = withB.report.steps.find((step) => step.name === 'random')
    expect(randomStep.notes.join('\n')).toMatch(/手順: seed=1: /)
    expect(randomStep.findings.filter((finding) => finding.level === 'stop')).toEqual([])
    const withoutB = await patrol(['boot'], 6)
    expect(withoutB.report.aborted).toBeNull()
    expect(withoutB.report.steps.map((step) => step.name)).toEqual(['boot', 'random', 'browser'])
    expect(withoutB.fake.state.gotoWeeks[0]).toBe('2026-11-16')
    // 台本 b と乱数の列を分ける(同じ --seed でも b の候補と同じ並びにならないことまでは決めない。流れることだけ)。
    expect(withoutB.report.steps.find((step) => step.name === 'random').operations).toBeGreaterThan(0)
  })
})
