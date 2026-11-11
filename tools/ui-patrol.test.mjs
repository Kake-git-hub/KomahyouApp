// tools/ui-patrol.mjs の入口(--prepare-only)を固定する。通信は偽の fetch、教室データは架空の名前だけ。
// 確かめること: 出力先には伏せ字の種データだけができ、どのファイルにも・出力にも元の名前が無い。
// 漏れ・結果の食い違いがあれば終了コード 2 で、種データを書かない。
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { main, runBrowserPatrol } from './ui-patrol.mjs'
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

  // 束ねたアプリの関数の一部だけを差し替える loadApp(自己点検の (b) だけ・(c) だけを単独で食い違わせるため)。
  function loadAppWith(overrides) {
    return async () => {
      const loaded = await loadPatrolApp()
      return { cleanup: loaded.cleanup, app: { ...loaded.app, ...overrides } }
    }
  }

  async function runSingleRoom({ loadApp, out, argvExtra = [], payload = makePayload(), fetchImpl: customFetch }) {
    const fetchImpl = customFetch ?? makeFakeFetch({ [ROOM_A]: payload }).fetchImpl
    const io = collect()
    const code = await main({ argv: ['--out', out, '--classroom', ROOM_A, '--prepare-only', ...argvExtra], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl, ...io }, loadApp ? { loadApp } : {})
    return { code, io, shown: io.out.join('') + io.err.join('') }
  }

  it('(c) だけ食い違う(保証台帳の結果)と終了コード 2 で、種データを書かない', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const { code, shown } = await runSingleRoom({ out, loadApp: loadAppWith({ compareAuditForParity: () => ['件数 X: 伏せ字の前 0 → 後 1'] }) })
      expect(code).toBe(2)
      expect(readdirSync(out)).toEqual([])
      expect(shown).toContain('保証台帳の結果の食い違い')
      expect(shown).not.toContain('名前引きの食い違い')
      expect(shown).not.toContain('実名が残っている')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('(b) だけ食い違う(名前引きと鍵の対応)と終了コード 2 で、種データを書かない', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const { code, shown } = await runSingleRoom({ out, loadApp: loadAppWith({ compareNameResolutionForParity: () => ['名前引きの食い違い boardState.x: 1 件'] }) })
      expect(code).toBe(2)
      expect(readdirSync(out)).toEqual([])
      expect(shown).toContain('名前引きの食い違い')
      expect(shown).not.toContain('保証台帳の結果の食い違い')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('自己点検に落ちた教室の前回の種データは消す(古い種データを次の作業が読まない)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      writeFileSync(path.join(out, `${ROOM_A}.seed.json`), '{"old":true}')
      writeFileSync(path.join(out, 'other.txt'), 'keep')
      const { code } = await runSingleRoom({ out, loadApp: loadAppWith({ compareAuditForParity: () => ['x'] }) })
      expect(code).toBe(2)
      expect(existsSync(path.join(out, `${ROOM_A}.seed.json`))).toBe(false)
      expect(existsSync(path.join(out, 'other.txt'))).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('取得に失敗した教室の前回の種データも消す', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      writeFileSync(path.join(out, `${ROOM_A}.seed.json`), '{"old":true}')
      const fetchImpl = async (url) => (String(url).endsWith(':runQuery')
        ? { ok: true, status: 200, json: async () => [{ document: { name: 'x/2026-11-10T23-45', fields: { layout: { stringValue: 'per-classroom-v1' } } } }] }
        : { ok: false, status: 403, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })
      const { code, shown } = await runSingleRoom({ out, fetchImpl })
      expect(code).toBe(2)
      expect(shown).toContain('403')
      expect(existsSync(path.join(out, `${ROOM_A}.seed.json`))).toBe(false)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('トークンを作れない・アプリを読み込めないときも、前回の種データは消す(出力先の検査の直後に消す)', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      writeFileSync(path.join(out, `${ROOM_A}.seed.json`), '{"old":true}')
      let io = collect()
      expect(await main({ argv: ['--out', out, '--classroom', ROOM_A, '--prepare-only'], env: {}, fetchImpl: async () => { throw new Error('x') }, ...io })).toBe(2)
      expect(existsSync(path.join(out, `${ROOM_A}.seed.json`))).toBe(false)
      writeFileSync(path.join(out, `${ROOM_A}.seed.json`), '{"old":true}')
      io = collect()
      const failingLoad = async () => { throw new Error('束ねられません') }
      expect(await main({ argv: ['--out', out, '--classroom', ROOM_A, '--prepare-only'], env: { FIRESTORE_ACCESS_TOKEN: 'dummy' }, fetchImpl: async () => { throw new Error('x') }, ...io }, { loadApp: failingLoad })).toBe(2)
      expect(existsSync(path.join(out, `${ROOM_A}.seed.json`))).toBe(false)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('巡回(--prepare-only なし・--seed-file): 教室が違う種データは 2。合えば台本の報告を <out>/report.json に書き、終了コードは報告から決める', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seedFile = path.join(out, 'in.seed.json')
      writeFileSync(seedFile, JSON.stringify({ actingClassroomId: ROOM_A, classrooms: [{ id: ROOM_A, data: {} }] }))
      const fakeApp = async () => ({ app: {}, cleanup: async () => {} })
      const deps = (report) => ({ loadApp: fakeApp, loadPlaywright: () => ({}), runPatrol: async ({ seeds }) => { expect(seeds.map((seed) => seed.classroomId)).toEqual([ROOM_A]); return report } })
      let io = collect()
      expect(await main({ argv: ['--out', out, '--seed-file', seedFile, '--classroom', ROOM_B], env: {}, fetchImpl: async () => { throw new Error('通信しない') }, ...io }, deps({}))).toBe(2)
      expect(io.err.join('')).toContain('種データではありません')
      const stopReport = { appVersion: 'x', backupKey: 'seed-file', classrooms: [{ classroomId: ROOM_A, label: 'A', backupKey: 'seed-file', knownCount: 0, aborted: null, steps: [{ name: 'boot', title: '起動', durationMs: 1, operations: 1, findings: [{ level: 'stop', code: 'page-error', message: 'x' }], notes: [] }] }] }
      io = collect()
      expect(await main({ argv: ['--out', out, '--seed-file', seedFile, '--classroom', ROOM_A], env: {}, fetchImpl: async () => { throw new Error('通信しない') }, ...io }, deps(stopReport))).toBe(1)
      expect(JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')).classrooms[0].classroomId).toBe(ROOM_A)
      // 文の報告も標準出力と同じ文で <out>/report.txt に残す
      const text = readFileSync(path.join(out, 'report.txt'), 'utf8')
      expect(text).toContain('■ 画面の自動巡回')
      expect(io.out.join('')).toContain(text.trim())
      // 種データ(入力)は消さない
      expect(existsSync(seedFile)).toBe(true)
      io = collect()
      expect(await main({ argv: ['--out', out, '--seed-file', seedFile, '--classroom', ROOM_A], env: {}, ...io }, { ...deps(stopReport), loadPlaywright: () => null })).toBe(2)
      expect(io.err.join('')).toContain('Playwright')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('壊れた教室データ(架空の名前入りの壊れた JSON)でも、出力に名前や元の文の断片が出ない', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const broken = gzipSync(Buffer.from('{"students":[{"name":"甲野　一郎",,}]'))
      const fetchImpl = async (url) => (String(url).endsWith(':runQuery')
        ? { ok: true, status: 200, json: async () => [{ document: { name: 'x/2026-11-10T23-45', fields: { layout: { stringValue: 'per-classroom-v1' } } } }] }
        : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => broken.buffer.slice(broken.byteOffset, broken.byteOffset + broken.byteLength) })
      const { code, shown } = await runSingleRoom({ out, fetchImpl })
      expect(code).toBe(2)
      expect(shown).toContain('SyntaxError')
      for (const name of NAMES) expect(shown).not.toContain(name)
      expect(shown).not.toContain('"students"')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)

  it('トークンを作れない理由を分類して出す(環境変数なし／認証サーバーの状態コード／通信できない)。中身は出さない', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const key = { client_email: 'sa@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), private_key_id: 'k1' }
    const b64 = Buffer.from(JSON.stringify(key)).toString('base64')
    const run = async (env, fetchImpl) => {
      const io = collect()
      const code = await main({ argv: ['--out', '/tmp/patrol-never', '--prepare-only'], env, fetchImpl, ...io })
      return { code, shown: io.err.join('') }
    }
    const noEnv = await run({}, async () => { throw new Error('x') })
    expect(noEnv.code).toBe(2)
    expect(noEnv.shown).toContain('環境変数')
    const rejected = await run({ KOMAHYOU_READONLY_SA_JSON_B64: b64 }, async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) }))
    expect(rejected.shown).toContain('認証サーバーが状態コード 401')
    const offline = await run({ KOMAHYOU_READONLY_SA_JSON_B64: b64 }, async () => { throw new Error('ECONNRESET secret-detail') })
    expect(offline.shown).toContain('通信できません')
    for (const result of [noEnv, rejected, offline]) {
      expect(result.shown).toContain('読み取り専用トークンを作れません')
      expect(result.shown).not.toContain(b64)
      expect(result.shown).not.toContain('secret-detail')
      expect(result.shown).not.toContain('PRIVATE KEY')
    }
  })

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

describe('ui-patrol --baseline(変更前の報告と比べる・第 2 段の 2)', () => {
  const stopOf = (message) => ({ level: 'stop', code: 'outside-allowed-range', message, dateKey: '2026-11-19', slotNumber: 3, deskIndex: 0 })
  const reportOf = (messages, { aborted = null } = {}) => ({
    appVersion: 'x', backupKey: 'seed-file',
    classrooms: [{ classroomId: ROOM_A, label: 'A', backupKey: 'seed-file', knownCount: 0, aborted, steps: [{ name: 'a', title: 'テンプレ保存', durationMs: 1, operations: 2, findings: messages.map(stopOf), notes: [] }] }],
  })
  const fakeApp = async () => ({ app: {}, cleanup: async () => {} })

  /** 種データを書く(data の中身で指紋が決まる)。 */
  function writeSeed(dir, name, data) {
    const file = path.join(dir, name)
    writeFileSync(file, JSON.stringify({ actingClassroomId: ROOM_A, classrooms: [{ id: ROOM_A, data }] }))
    return file
  }

  async function runWith(argv, report, calls = []) {
    const io = collect()
    const code = await main({ argv, env: {}, fetchImpl: async () => { throw new Error('通信しない') }, ...io }, {
      loadApp: fakeApp, loadPlaywright: () => ({}), runPatrol: async (args) => { calls.push(args); return report },
    })
    return { code, io, calls }
  }

  it('報告に教室ごとの種データの指紋(seedFingerprint)が入る。同じ data なら同じ・違えば違う', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seed1 = writeSeed(dir, 'one.seed.json', { n: 1 })
      const seed2 = writeSeed(dir, 'two.seed.json', { n: 2 })
      await runWith(['--out', path.join(dir, 'o1'), '--seed-file', seed1, '--classroom', ROOM_A], reportOf([]))
      await runWith(['--out', path.join(dir, 'o2'), '--seed-file', seed1, '--classroom', ROOM_A], reportOf([]))
      await runWith(['--out', path.join(dir, 'o3'), '--seed-file', seed2, '--classroom', ROOM_A], reportOf([]))
      const fingerprint = (name) => JSON.parse(readFileSync(path.join(dir, name, 'report.json'), 'utf8')).classrooms[0].seedFingerprint
      expect(fingerprint('o1')).toMatch(/^[0-9a-f]{16}$/)
      expect(fingerprint('o2')).toBe(fingerprint('o1'))
      expect(fingerprint('o3')).not.toBe(fingerprint('o1'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('新しい変 0・前から 3 → 終了コード 0(1 行目に前から 3 件)。新しい変 1 → 1。消えた変は [消えた] で出る', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seed = writeSeed(dir, 'one.seed.json', { n: 1 })
      await runWith(['--out', path.join(dir, 'base'), '--seed-file', seed, '--classroom', ROOM_A], reportOf(['甲', '乙', '丙', '丁']))
      const baseline = path.join(dir, 'base', 'report.json')
      const argvFor = (name) => ['--out', path.join(dir, name), '--seed-file', seed, '--classroom', ROOM_A, '--baseline', baseline]
      const carried = await runWith(argvFor('same'), reportOf(['甲', '乙', '丙']))
      expect(carried.code).toBe(0)
      const text = carried.io.out.join('')
      expect(text).toContain('変 3 件(新しい 0・前から 3)・消えた変 1 件')
      expect(text).toContain('[変・前]')
      expect(text).toContain('[消えた] テンプレ保存: 丁')
      expect(JSON.parse(readFileSync(path.join(dir, 'same', 'report.json'), 'utf8')).baseline).toMatchObject({ newStops: 0, carriedStops: 3, resolvedStops: 1 })
      const added = await runWith(argvFor('added'), reportOf(['甲', '戊']))
      expect(added.code).toBe(1)
      expect(added.io.out.join('')).toContain('[変・新] ')
      // baseline なしは今までどおり: stop があれば 1
      expect((await runWith(['--out', path.join(dir, 'plain'), '--seed-file', seed, '--classroom', ROOM_A], reportOf(['甲']))).code).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('今回の巡回が中断したら、新しい変が 0 でも 2', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seed = writeSeed(dir, 'one.seed.json', { n: 1 })
      await runWith(['--out', path.join(dir, 'base'), '--seed-file', seed, '--classroom', ROOM_A], reportOf(['甲']))
      const result = await runWith(['--out', path.join(dir, 'cur'), '--seed-file', seed, '--classroom', ROOM_A, '--baseline', path.join(dir, 'base', 'report.json')], reportOf(['甲'], { aborted: 'a: 画面が開かない' }))
      expect(result.code).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('データが違う(指紋が違う)・baseline が読めない・中断していた baseline は、流す前に 2 で断る(巡回を始めない)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seed1 = writeSeed(dir, 'one.seed.json', { n: 1 })
      const seed2 = writeSeed(dir, 'two.seed.json', { n: 2 })
      await runWith(['--out', path.join(dir, 'base'), '--seed-file', seed1, '--classroom', ROOM_A], reportOf(['甲']))
      const baseline = path.join(dir, 'base', 'report.json')
      const calls = []
      const different = await runWith(['--out', path.join(dir, 'x1'), '--seed-file', seed2, '--classroom', ROOM_A, '--baseline', baseline], reportOf(['甲']), calls)
      expect(different.code).toBe(2)
      expect(different.io.err.join('')).toContain('データが違うので比べられません')
      const missing = await runWith(['--out', path.join(dir, 'x2'), '--seed-file', seed1, '--classroom', ROOM_A, '--baseline', path.join(dir, 'nothing.json')], reportOf(['甲']), calls)
      expect(missing.code).toBe(2)
      expect(missing.io.err.join('')).toContain('--baseline')
      writeFileSync(path.join(dir, 'broken.json'), '{')
      expect((await runWith(['--out', path.join(dir, 'x3'), '--seed-file', seed1, '--classroom', ROOM_A, '--baseline', path.join(dir, 'broken.json')], reportOf(['甲']), calls)).code).toBe(2)
      // 中断していた baseline
      await runWith(['--out', path.join(dir, 'abort'), '--seed-file', seed1, '--classroom', ROOM_A], reportOf(['甲'], { aborted: 'a: 止まった' }))
      const aborted = await runWith(['--out', path.join(dir, 'x4'), '--seed-file', seed1, '--classroom', ROOM_A, '--baseline', path.join(dir, 'abort', 'report.json')], reportOf(['甲']), calls)
      expect(aborted.code).toBe(2)
      expect(aborted.io.err.join('')).toContain('中断')
      expect(calls).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ui-patrol --baseline-ref(変更前のコードを道具が自分で流す・第 2 段の 2)', () => {
  const stopOf = (message) => ({ level: 'stop', code: 'outside-allowed-range', message, dateKey: '2026-11-19', slotNumber: 3, deskIndex: 0 })
  const reportOf = (messages, extra = {}) => ({
    appVersion: 'x', backupKey: 'seed-file',
    classrooms: [{ classroomId: ROOM_A, label: 'A', backupKey: 'seed-file', knownCount: 0, aborted: null, steps: [{ name: 'a', title: 'テンプレ保存', durationMs: 1, operations: 2, findings: messages.map(stopOf), notes: [] }], ...extra }],
  })
  const fakeApp = async () => ({ app: {}, cleanup: async () => { events.push('bundle-cleanup') } })
  let events = []

  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    const seedFile = path.join(dir, 'one.seed.json')
    writeFileSync(seedFile, JSON.stringify({ actingClassroomId: ROOM_A, classrooms: [{ id: ROOM_A, data: { n: 1 } }] }))
    events = []
    return { dir, seedFile }
  }

  /** baselineReport・currentReport を順に返す偽の runPatrol と、偽の prepareBaselineApp。 */
  async function run({ dir, seedFile }, reports, { extraArgs = [], prepare } = {}) {
    const calls = []
    const io = collect()
    const prepareBaselineApp = prepare ?? (async ({ ref, outDir }) => {
      events.push(`prepare:${ref}`)
      return { appDir: path.join(outDir, 'baseline-app'), cleanup: async () => { events.push('app-cleanup') } }
    })
    const code = await main({ argv: ['--out', path.join(dir, 'out'), '--seed-file', seedFile, '--classroom', ROOM_A, '--moves', '3', '--seed', '7', '--random', '2', '--baseline-ref', 'origin/main', ...extraArgs], env: {}, fetchImpl: async () => { throw new Error('通信しない') }, ...io }, {
      loadApp: fakeApp, loadPlaywright: () => ({}), prepareBaselineApp,
      runPatrol: async (args) => { events.push(`run:${args.repoRoot ? 'baseline' : 'current'}`); calls.push(args); return reports[calls.length - 1] },
    })
    return { code, io, calls }
  }

  it('変更前 → 今回の順に 2 回流す。2 回とも同じ種データと同じ options(moves・seed・scenario・random)。変更前だけ repoRoot が展開先・出力先は <out>/baseline', async () => {
    const env = setup()
    try {
      const { code, io, calls } = await run(env, [reportOf(['甲']), reportOf(['甲'])])
      expect(code).toBe(0)
      expect(calls).toHaveLength(2)
      expect(calls[0].repoRoot).toBe(path.join(env.dir, 'out', 'baseline-app'))
      expect(calls[1].repoRoot).toBeUndefined()
      expect(calls[1].seeds).toEqual(calls[0].seeds)
      const { out: baselineOut, ...baselineOptions } = calls[0].options
      const { out: currentOut, ...currentOptions } = calls[1].options
      expect(baselineOptions).toEqual(currentOptions)
      expect([currentOptions.moves, currentOptions.seed, currentOptions.random, currentOptions.scenarios]).toEqual([3, 7, 2, ['boot', 'c', 'b', 'a']])
      expect(baselineOut).toBe(path.join(env.dir, 'out', 'baseline'))
      expect(currentOut).toBe(path.join(env.dir, 'out'))
      expect(calls[1].backupKey).toBe(calls[0].backupKey)
      expect(calls[1].today).toBe(calls[0].today)
      // 展開したアプリは変更前を流し終えたらすぐ消す(今回を流す前)。終わりにも(2 回目の片づけ)呼ばれても落ちない。
      expect(events.indexOf('app-cleanup')).toBeGreaterThan(events.indexOf('run:baseline'))
      expect(events.indexOf('app-cleanup')).toBeLessThan(events.indexOf('run:current'))
      // 変更前の報告は <out>/baseline に残る
      expect(JSON.parse(readFileSync(path.join(env.dir, 'out', 'baseline', 'report.json'), 'utf8')).classrooms[0].seedFingerprint).toMatch(/^[0-9a-f]{16}$/)
      expect(readFileSync(path.join(env.dir, 'out', 'baseline', 'report.txt'), 'utf8')).toContain('■ 画面の自動巡回')
      expect(io.out.join('')).toContain('前から 1')
      expect(JSON.parse(readFileSync(path.join(env.dir, 'out', 'report.json'), 'utf8')).baseline).toMatchObject({ newStops: 0, carriedStops: 1, resolvedStops: 0 })
    } finally {
      rmSync(env.dir, { recursive: true, force: true })
    }
  })

  it('新しい変があれば 1・新しい変 0 で前からだけなら 0・変更前が中断していたら今回は流さず 2', async () => {
    const env = setup()
    try {
      expect((await run(env, [reportOf(['甲']), reportOf(['甲', '乙'])])).code).toBe(1)
      expect((await run(env, [reportOf(['甲', '乙']), reportOf(['甲'])])).code).toBe(0)
      const aborted = await run(env, [reportOf(['甲'], { aborted: 'a: 止まった' }), reportOf(['甲'])])
      expect(aborted.code).toBe(2)
      expect(aborted.calls).toHaveLength(1)
      expect(aborted.io.err.join('')).toContain('比べられません')
    } finally {
      rmSync(env.dir, { recursive: true, force: true })
    }
  })

  it('用意で断られたら(ref が解決できない・依存が違う・読み口が無い)2。何も流さず・取得もしない', async () => {
    const env = setup()
    try {
      const refusal = async () => { throw new Error('--baseline-ref origin/main の package-lock.json が今の作業ツリーと違う') }
      const result = await run(env, [reportOf([]), reportOf([])], { prepare: refusal })
      expect(result.code).toBe(2)
      expect(result.io.err.join('')).toContain('package-lock.json')
      expect(result.calls).toHaveLength(0)
    } finally {
      rmSync(env.dir, { recursive: true, force: true })
    }
  })

  it('途中で例外・シグナルで止めても、展開したアプリを片づける。変更前をシグナルで止めたら 130 で今回は流さず報告も書かない', async () => {
    const env = setup()
    try {
      const stopped = await run(env, [{ ...reportOf([]), stopped: true }, reportOf([])])
      expect(stopped.code).toBe(130)
      expect(stopped.calls).toHaveLength(1)
      expect(existsSync(path.join(env.dir, 'out', 'report.json'))).toBe(false)
      expect(events).toContain('app-cleanup')
    } finally {
      rmSync(env.dir, { recursive: true, force: true })
    }
  })
})

describe('runBrowserPatrol(止めるときの片づけ)', () => {
  it('流している途中で SIGINT/SIGTERM を受けたら、ブラウザと開発用サーバーを止めて終了コード 130 で終わる。流し終えたらハンドラを外す', async () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const calls = []
      const proc = new EventEmitter()
      let exited = null
      const exitPromise = new Promise((resolve) => { proc.exit = (code) => { exited = code; resolve() } })
      const deps = {
        process: proc,
        startDevServer: async () => ({ baseUrl: 'http://127.0.0.1:1', stop: async () => { calls.push('server.stop') } }),
        launchPatrolBrowser: async () => ({ browser: { close: async () => { calls.push('browser.close') } } }),
        closePatrolBrowser: async (session) => { await session?.browser?.close() },
        // 台本は終わらない(途中でシグナルを受ける)
        runClassroomPatrol: () => new Promise(() => {}),
      }
      void runBrowserPatrol({ app: {}, seeds: [{ classroomId: ROOM_A, label: 'A', key: 'k', seed: {} }], options: { port: 1, headed: false, known: '/nonexistent.json', json: true }, backupKey: 'k', today: '2026-11-11', env: {}, say: () => {} }, deps)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(proc.listenerCount(signal)).toBe(1)
      proc.emit(signal)
      await exitPromise
      expect(exited).toBe(130)
      expect(calls.sort()).toEqual(['browser.close', 'server.stop'])
    }
  })

  it('流し終えたらシグナルのハンドラを外す', async () => {
    const proc = new EventEmitter()
    proc.exit = () => { throw new Error('呼ばれない') }
    const calls = []
    const deps = {
      process: proc,
      startDevServer: async () => ({ baseUrl: 'http://127.0.0.1:1', stop: async () => { calls.push('server.stop') } }),
      launchPatrolBrowser: async () => ({ browser: { close: async () => { calls.push('browser.close') } } }),
      closePatrolBrowser: async (session) => { await session?.browser?.close() },
      runClassroomPatrol: async ({ classroom }) => ({ classroomId: classroom.classroomId, label: 'A', backupKey: 'k', steps: [], knownCount: 0, aborted: null }),
    }
    const report = await runBrowserPatrol({ app: {}, seeds: [{ classroomId: ROOM_A, label: 'A', key: 'k', seed: {} }], options: { port: 1, headed: false, known: '/nonexistent.json', json: true }, backupKey: 'k', today: '2026-11-11', env: {}, say: () => {} }, deps)
    expect(report.classrooms).toHaveLength(1)
    expect(proc.listenerCount('SIGINT')).toBe(0)
    expect(proc.listenerCount('SIGTERM')).toBe(0)
    expect(calls.sort()).toEqual(['browser.close', 'server.stop'])
  })
})

describe('runBrowserPatrol(repoRoot・--baseline-ref)', () => {
  it('repoRoot を渡すと開発用サーバーはそこを cwd に起動する(変更前のアプリ)。報告のアプリの版もそこの package.json から読む。渡さなければ今のリポジトリ', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'patrol-root-'))
    try {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }))
      const roots = []
      const deps = {
        process: new EventEmitter(),
        startDevServer: async ({ repoRoot }) => { roots.push(repoRoot); return { baseUrl: 'http://127.0.0.1:1', stop: async () => {} } },
        launchPatrolBrowser: async () => ({}),
        closePatrolBrowser: async () => {},
        runClassroomPatrol: async ({ classroom }) => ({ classroomId: classroom.classroomId, label: 'A', backupKey: 'k', steps: [], knownCount: 0, aborted: null }),
      }
      const args = { app: {}, seeds: [{ classroomId: ROOM_A, label: 'A', key: 'k', seed: {} }], options: { port: 1, headed: false, known: '/nonexistent.json', json: true }, backupKey: 'k', today: '2026-11-11', env: {}, say: () => {} }
      const baseline = await runBrowserPatrol({ ...args, repoRoot: root }, deps)
      const current = await runBrowserPatrol(args, deps)
      expect(roots[0]).toBe(root)
      expect(roots[1]).not.toBe(root)
      expect(baseline.appVersion).toBe('9.9.9')
      expect(current.appVersion).not.toBe('9.9.9')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runBrowserPatrol(シグナルの時間帯)', () => {
  const baseArgs = (extra = {}) => ({ app: {}, seeds: [{ classroomId: ROOM_A, label: 'A', key: 'k', seed: {} }, { classroomId: ROOM_B, label: 'B', key: 'k', seed: {} }], options: { port: 1, headed: false, known: '/nonexistent.json', json: true }, backupKey: 'k', today: '2026-11-11', env: {}, say: () => {}, ...extra })
  const makeProc = () => {
    const proc = new EventEmitter()
    proc.exitCalls = []
    proc.exited = new Promise((resolve) => { proc.exit = (code) => { proc.exitCalls.push(code); resolve() } })
    return proc
  }

  it('片づけの最中の 2 回目のシグナルは無視する(片づけは 1 回・終了も 1 回)。止めている最中は次の教室のブラウザを起動しない', async () => {
    const proc = makeProc()
    const calls = []
    let releaseStop
    const deps = {
      process: proc,
      startDevServer: async () => ({ baseUrl: 'http://127.0.0.1:1', stop: () => { calls.push('server.stop'); return new Promise((resolve) => { releaseStop = resolve }) } }),
      launchPatrolBrowser: async () => { calls.push('launch'); return { browser: { close: async () => { calls.push('browser.close') } } } },
      closePatrolBrowser: async (session) => { await session?.browser?.close() },
      // 1 教室目は、ブラウザが閉じられたら(シグナルの片づけ)例外で戻る
      runClassroomPatrol: () => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('閉じられた')), 30) }),
    }
    const running = runBrowserPatrol(baseArgs(), deps)
    await new Promise((resolve) => setTimeout(resolve, 10))
    proc.emit('SIGINT')
    proc.emit('SIGINT')
    proc.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 60))
    releaseStop()
    await proc.exited
    await running.catch(() => {})
    expect(proc.exitCalls).toEqual([130])
    expect(calls.filter((call) => call === 'server.stop')).toHaveLength(1)
    expect(calls.filter((call) => call === 'launch')).toHaveLength(1)
  })

  it('開発用サーバーの起動待ちの最中のシグナルでも、起こした子を止める', async () => {
    const proc = makeProc()
    const calls = []
    const deps = {
      process: proc,
      // 子を起こした直後に onSpawn で止め方を知らせ、起動(HTTP が返る)は終わらない
      startDevServer: ({ onSpawn }) => { onSpawn(async () => { calls.push('child.stop') }); return new Promise(() => {}) },
      launchPatrolBrowser: async () => { throw new Error('呼ばれない') },
      closePatrolBrowser: async () => {},
      runClassroomPatrol: async () => { throw new Error('呼ばれない') },
    }
    void runBrowserPatrol(baseArgs(), deps)
    await new Promise((resolve) => setTimeout(resolve, 10))
    proc.emit('SIGTERM')
    await proc.exited
    expect(proc.exitCalls).toEqual([130])
    expect(calls).toEqual(['child.stop'])
  })

  it('シグナルの片づけで esbuild の束ね先も消す(extraCleanup)', async () => {
    const proc = makeProc()
    const calls = []
    const deps = {
      process: proc,
      startDevServer: async () => ({ baseUrl: 'http://127.0.0.1:1', stop: async () => { calls.push('server.stop') } }),
      launchPatrolBrowser: async () => ({ browser: { close: async () => {} } }),
      closePatrolBrowser: async () => {},
      runClassroomPatrol: () => new Promise(() => {}),
    }
    void runBrowserPatrol(baseArgs({ extraCleanup: async () => { calls.push('bundle.cleanup') } }), deps)
    await new Promise((resolve) => setTimeout(resolve, 10))
    proc.emit('SIGINT')
    await proc.exited
    expect(calls.sort()).toEqual(['bundle.cleanup', 'server.stop'])
  })
})

describe('シグナルで止めたときの報告', () => {
  it('シグナルで止めた巡回は stopped の印つきで返り、main は report.json・report.txt を書かない(途中までの報告を普通の報告と見分けられないため)', async () => {
    const proc = new EventEmitter()
    proc.exited = new Promise((resolve) => { proc.exit = () => resolve() })
    const deps = {
      process: proc,
      startDevServer: async () => ({ baseUrl: 'http://127.0.0.1:1', stop: async () => {} }),
      launchPatrolBrowser: async () => ({ browser: { close: async () => {} } }),
      closePatrolBrowser: async () => {},
      // 1 教室目はシグナルの片づけでブラウザが閉じられ、途中までの報告で戻る
      runClassroomPatrol: () => new Promise((resolve) => { setTimeout(() => resolve({ classroomId: ROOM_A, label: 'A', backupKey: 'k', steps: [{ name: 'boot', title: '起動', durationMs: 1, operations: 1, findings: [], notes: [] }], knownCount: 0, aborted: null }), 30) }),
    }
    const running = runBrowserPatrol({ app: {}, seeds: [{ classroomId: ROOM_A, label: 'A', key: 'k', seed: {} }], options: { port: 1, headed: false, known: '/nonexistent.json', json: true }, backupKey: 'k', today: '2026-11-11', env: {}, say: () => {} }, deps)
    await new Promise((resolve) => setTimeout(resolve, 10))
    proc.emit('SIGINT')
    const stoppedReport = await running
    await proc.exited
    expect(stoppedReport.stopped).toBe(true)

    const out = mkdtempSync(path.join(tmpdir(), 'patrol-test-'))
    try {
      const seedFile = path.join(out, 'in.seed.json')
      writeFileSync(seedFile, JSON.stringify({ actingClassroomId: ROOM_A, classrooms: [{ id: ROOM_A, data: {} }] }))
      const io = collect()
      const code = await main({ argv: ['--out', out, '--seed-file', seedFile, '--classroom', ROOM_A], env: {}, fetchImpl: async () => { throw new Error('通信しない') }, ...io }, {
        loadApp: async () => ({ app: {}, cleanup: async () => {} }), loadPlaywright: () => ({}), runPatrol: async () => stoppedReport,
      })
      expect(code).toBe(130)
      expect(existsSync(path.join(out, 'report.json'))).toBe(false)
      expect(existsSync(path.join(out, 'report.txt'))).toBe(false)
      expect(io.err.join('')).toContain('止めました')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('loadApp の束ね先の後始末', () => {
  it('1 時間より古い ui-patrol-* の残りは消し、新しいもの・別の名前は残す', async () => {
    const { removeStaleBundles } = await import('./ui-patrol/loadApp.mjs')
    const root = mkdtempSync(path.join(tmpdir(), 'patrol-cache-'))
    try {
      const { mkdirSync: mk, utimesSync } = await import('node:fs')
      for (const name of ['ui-patrol-old', 'ui-patrol-new', 'other-old']) mk(path.join(root, name))
      const now = Date.now()
      const twoHoursAgo = (now - 2 * 60 * 60 * 1000) / 1000
      utimesSync(path.join(root, 'ui-patrol-old'), twoHoursAgo, twoHoursAgo)
      utimesSync(path.join(root, 'other-old'), twoHoursAgo, twoHoursAgo)
      await removeStaleBundles(root, now)
      expect(readdirSync(root).sort()).toEqual(['other-old', 'ui-patrol-new'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
