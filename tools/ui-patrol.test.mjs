// tools/ui-patrol.mjs の入口(--prepare-only)を固定する。通信は偽の fetch、教室データは架空の名前だけ。
// 確かめること: 出力先には伏せ字の種データだけができ、どのファイルにも・出力にも元の名前が無い。
// 漏れ・結果の食い違いがあれば終了コード 2 で、種データを書かない。
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { main } from './ui-patrol.mjs'
import { loadPatrolApp } from './ui-patrol/loadApp.mjs'

const ROOM_A = '5w5OMueETerSKrSf14HC'
const ROOM_B = 'KzFnOQoTFLsCxwUp1tvh'
const NAMES = ['甲野　一郎', '乙川　二郎', '丙山　三子', '甲野', '乙川二', '丙山']

function makeCell(dateKey, slotNumber, desks) {
  const day = new Date(`${dateKey}T00:00:00`).getDay()
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: ['日', '月', '火', '水', '木', '金', '土'][day], dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function makePayload(extra = {}) {
  return {
    screen: 'board',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2, scheduleNotes: { '2026-11': '甲野くんは遅れて来ます' }, updatedBy: '丙山' },
    managers: [],
    teachers: [{ id: 't005', name: '丙山　三子', displayName: '丙山', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }], memo: '火曜は早退' }],
    students: [
      { id: 's092', name: '甲野　一郎', displayName: '甲野', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
      { id: 's093', name: '乙川　二郎', displayName: '乙川二', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    ],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: {
      weeks: [[makeCell('2026-11-12', 1, [
        { id: 'd1', teacher: '丙山', teacherAssignmentTeacherId: 't005', memoSlots: ['宿題を忘れた', null], lesson: { id: 'L1', studentSlots: [{ id: 'e1', name: '甲野', managedStudentId: 's092', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal' }, { id: 'e2', name: '乙川二', managedStudentId: 's093', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal' }] } },
        { id: 'd2', teacher: '', lesson: { id: 'L2', studentSlots: [null, null] } },
      ])]],
    },
    ...extra,
  }
}

function storedSnapshot(payload) {
  return gzipSync(Buffer.from(JSON.stringify({ data: payload, savedAt: '2026-11-10T14:45:00.000Z', version: 3 })))
}

function makeFakeFetch(payloadByRoom) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url: String(url), method })
    if (String(url).endsWith(':runQuery')) {
      return { ok: true, status: 200, json: async () => [{ document: { name: 'projects/p/databases/(default)/documents/workspaces/main/workspaceAutoBackupSummaries/2026-11-10T23-45', fields: { layout: { stringValue: 'per-classroom-v1' } } } }] }
    }
    const roomId = Object.keys(payloadByRoom).find((id) => decodeURIComponent(String(url)).includes(`/${id}.json.gz`))
    const bytes = storedSnapshot(payloadByRoom[roomId])
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  }
  return { fetchImpl, calls }
}

function collect() {
  const out = []
  const err = []
  return { out, err, stdout: { write: (text) => out.push(String(text)) }, stderr: { write: (text) => err.push(String(text)) } }
}

function readAllText(dir) {
  return readdirSync(dir).map((name) => readFileSync(path.join(dir, name), 'utf8')).join('\n')
}

describe('ui-patrol --prepare-only', () => {
  it('偽の取得で、出力先には伏せ字の種データだけができ、どのファイルにも・出力にも元の名前が無い', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const { fetchImpl, calls } = makeFakeFetch({ [ROOM_A]: makePayload(), [ROOM_B]: makePayload() })
      const io = collect()
      const code = await main({ argv: ['--out', out, '--prepare-only'], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl, ...io })
      expect(io.err.join('')).toBe('')
      expect(code).toBe(0)
      expect(readdirSync(out).sort()).toEqual([`${ROOM_A}.seed.json`, `${ROOM_B}.seed.json`])
      const written = readAllText(out)
      const shown = io.out.join('')
      for (const name of NAMES) {
        expect(written).not.toContain(name)
        expect(shown).not.toContain(name)
      }
      expect(written).not.toContain('宿題を忘れた')
      const seed = JSON.parse(readFileSync(path.join(out, `${ROOM_A}.seed.json`), 'utf8'))
      expect(seed.actingClassroomId).toBe(ROOM_A)
      expect(seed.classrooms[0].data.students).toHaveLength(2)
      expect(shown).toContain('漏れ 0')
      // 通信は最新の時点の :runQuery 1 回と、教室ごとの GET だけ(最新の時点は 1 回しか引かない)。
      expect(calls.map((call) => call.method)).toEqual(['POST', 'GET', 'GET'])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('伏せ字のあとに名前が残るときは終了コード 2 で、種データを書かない(漏れ)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const { fetchImpl } = makeFakeFetch({ [ROOM_A]: makePayload() })
      const io = collect()
      const leaky = async () => {
        const app = await loadPatrolApp()
        return { cleanup: app.cleanup, app: { ...app.app, anonymizeClassroomPayload: (payload) => {
          const result = app.app.anonymizeClassroomPayload(payload)
          return { ...result, payload: { ...result.payload, classroomSettings: { ...result.payload.classroomSettings, customLabel: '甲野　一郎さん' } } }
        } } }
      }
      const code = await main({ argv: ['--out', out, '--classroom', ROOM_A, '--prepare-only'], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl, ...io }, { loadApp: leaky })
      expect(code).toBe(2)
      expect(readdirSync(out)).toEqual([])
      const shown = io.out.join('') + io.err.join('')
      expect(shown).toContain('漏れ')
      expect(shown).toContain('customLabel')
      for (const name of NAMES) expect(shown).not.toContain(name)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('保証台帳の結果が食い違うときは終了コード 2 で、種データを書かない', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const { fetchImpl } = makeFakeFetch({ [ROOM_A]: makePayload() })
      const io = collect()
      const broken = async () => {
        const app = await loadPatrolApp()
        // 伏せ字のあとの盤面から生徒を 1 人消して、保証台帳の結果(INV-14 でなく名前引き)を変える。
        return { cleanup: app.cleanup, app: { ...app.app, anonymizeClassroomPayload: (payload) => {
          const result = app.app.anonymizeClassroomPayload(payload)
          return { ...result, payload: { ...result.payload, students: [] } }
        } } }
      }
      const code = await main({ argv: ['--out', out, '--classroom', ROOM_A, '--prepare-only'], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl, ...io }, { loadApp: broken })
      expect(code).toBe(2)
      expect(existsSync(path.join(out, `${ROOM_A}.seed.json`))).toBe(false)
      expect(io.out.join('') + io.err.join('')).toMatch(/食い違い|一致しません/)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('出力先がリポジトリの中・引数の誤り・トークンなしは終了コード 2 で、通信しない', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '..')
    const fetchCalls = []
    const fetchImpl = async (url) => { fetchCalls.push(url); throw new Error('通信してはいけない') }
    let io = collect()
    expect(await main({ argv: ['--out', path.join(repoRoot, 'docs', 'x'), '--prepare-only'], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl, ...io })).toBe(2)
    io = collect()
    expect(await main({ argv: ['--prepare-only'], env: {}, fetchImpl, ...io })).toBe(2)
    io = collect()
    expect(await main({ argv: ['--out', '/tmp/patrol-never', '--prepare-only'], env: {}, fetchImpl, ...io })).toBe(2)
    expect(io.err.join('')).toContain('読み取り専用トークンを作れません')
    expect(fetchCalls).toEqual([])
  })

  it('--help は使い方を出して 0', async () => {
    const io = collect()
    expect(await main({ argv: ['--help'], env: {}, ...io })).toBe(0)
    expect(io.out.join('')).toContain('ui-patrol')
  })
})
