// tools/board-health-check.mjs(2 時点の教室データと保存記録の毎朝の健診・読み取り専用)の純関数を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・講師A)。出力に名前が 1 文字も出ないことも確かめる。
import { describe, it, expect } from 'vitest'
import {
  buildBoardHealthReport,
  DESK_CHANGE_BURST,
  formatBoardHealthText,
  HEALTH_CODES,
  MAKEUP_DROP_MIN,
  MAKEUP_DROP_RATIO,
  normalizeRecordList,
  parseArgs,
  unwrapFirestoreFields,
  validateArgs,
} from './board-health-check.mjs'

const ROOM = 'room1'
const NOW = '2026-11-09T00:00:00.000Z'

function makeStudentEntry(overrides = {}) {
  return { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function makeDesk(id, studentSlots = [null, null], overrides = {}) {
  return { id, teacher: '', lesson: { id: `L-${id}`, studentSlots }, ...overrides }
}

function makeCell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '月', dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function makePayload({ weeks = [[makeCell('2026-11-10', 1, [makeDesk('d1'), makeDesk('d2')])]], board = {}, students, teachers } = {}) {
  return {
    teachers: teachers ?? [{ id: 't1', name: '講師A' }],
    students: students ?? [{ id: 's1', name: '生徒A' }, { id: 's2', name: '生徒B' }],
    specialSessions: [],
    classroomSettings: {},
    boardState: { weeks, suppressedRegularLessonOccurrences: [], ...board },
  }
}

function codesOf(report) {
  return report.findings.map((finding) => finding.code)
}

function findingOf(report, code) {
  return report.findings.find((finding) => finding.code === code)
}

function duplicateWeeks(dateKey = '2026-11-18', slotNumber = 5) {
  return [[makeCell(dateKey, slotNumber, [
    makeDesk('d1', [makeStudentEntry(), null]),
    makeDesk('d2', [null, makeStudentEntry({ id: 'e2' })]),
  ])]]
}

describe('HEALTH_CODES と閾値', () => {
  it('code 一覧と閾値の定数', () => {
    expect(HEALTH_CODES).toEqual(['duplicate-placement', 'pending-count', 'pending-delta', 'whole-day-pair-count', 'origin-mark-count', 'roster-shrink', 'teacher-shrink', 'makeup-drop', 'desk-change-burst', 'save-failed', 'save-none', 'user-report'])
    expect(MAKEUP_DROP_MIN).toBe(10)
    expect(MAKEUP_DROP_RATIO).toBe(0.1)
    expect(DESK_CHANGE_BURST).toBe(200)
  })
})

describe('duplicate-placement(INV-12)', () => {
  it('同じコマの 2 つの机に同じ生徒(managedStudentId・無ければ name)が居れば duplicate-placement を warn で出し、メッセージは日付・時限・机 2 つ・生徒 ID だけ', () => {
    const report = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks: duplicateWeeks() }), now: NOW })
    const finding = findingOf(report, 'duplicate-placement')
    expect(finding.severity).toBe('warn')
    expect(finding.message).toContain('2026-11-18')
    expect(finding.message).toContain('5限')
    expect(finding.message).toContain('机1')
    expect(finding.message).toContain('机2')
    expect(finding.message).toContain('s1')
    expect(finding.message).not.toContain('生徒A')
    expect(report.counts.duplicatePlacements).toBe(1)

    // managedStudentId が無ければ name で同一と見る(出力には名前を出さない)
    const nameOnly = [[makeCell('2026-11-10', 2, [
      makeDesk('d1', [makeStudentEntry({ managedStudentId: undefined }), null]),
      makeDesk('d2', [makeStudentEntry({ id: 'e2', managedStudentId: undefined }), null]),
    ])]]
    const report2 = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks: nameOnly }), now: NOW })
    const finding2 = findingOf(report2, 'duplicate-placement')
    expect(finding2.severity).toBe('warn')
    expect(finding2.message).not.toContain('生徒A')
    expect(finding2.message).toContain('生徒ID なし')

    // 別のコマなら重複ではない
    const apart = [[
      makeCell('2026-11-10', 1, [makeDesk('d1', [makeStudentEntry(), null])]),
      makeCell('2026-11-10', 2, [makeDesk('d1', [makeStudentEntry({ id: 'e2' }), null])]),
    ]]
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks: apart }), now: NOW }))).not.toContain('duplicate-placement')
  })

  it('knownIssues に載っている組み合わせは duplicate-placement に数えない(緑が丘 11/18・11/25 5限の既知)', () => {
    const weeks = [[...duplicateWeeks('2026-11-18', 5)[0], ...duplicateWeeks('2026-11-25', 5)[0]]]
    const knownIssues = [
      { classroomId: ROOM, dateKey: '2026-11-18', slotNumber: 5, studentId: 's1' },
      { classroomId: ROOM, dateKey: '2026-11-25', slotNumber: 5, studentId: 's1' },
    ]
    const report = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks }), knownIssues, now: NOW })
    expect(codesOf(report)).not.toContain('duplicate-placement')
    expect(report.counts.duplicatePlacements).toBe(0)
    expect(report.counts.knownDuplicatesSkipped).toBe(2)

    // 別教室の既知は効かない
    const other = knownIssues.map((issue) => ({ ...issue, classroomId: 'room2' }))
    const report2 = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks }), knownIssues: other, now: NOW })
    expect(report2.counts.duplicatePlacements).toBe(2)
  })
})

describe('件数(保留・組・出自の印)', () => {
  it('templatePendingDesks のキー数を pending-count に、前日との差を pending-delta に出す(前なしなら delta なし)', () => {
    const after = makePayload({ board: { templatePendingDesks: { 'c1::d1': {}, 'c1::d2': {}, 'c2::d1': {} } } })
    const before = makePayload({ board: { templatePendingDesks: { 'c1::d1': {} } } })
    const noBefore = buildBoardHealthReport({ classroomId: ROOM, before: null, after, now: NOW })
    expect(findingOf(noBefore, 'pending-count').severity).toBe('info')
    expect(findingOf(noBefore, 'pending-count').message).toContain('3')
    expect(noBefore.counts.pending).toBe(3)
    expect(codesOf(noBefore)).not.toContain('pending-delta')

    const withBefore = buildBoardHealthReport({ classroomId: ROOM, before, after, now: NOW })
    expect(findingOf(withBefore, 'pending-delta').message).toContain('+2')
    expect(withBefore.counts.pendingDelta).toBe(2)
  })

  it('WHOLE_DAY_PAIR__ で始まるキーの数と origin(出自の印)付き生徒の数を counts に入れる(info)', () => {
    const weeks = [[makeCell('2026-11-10', 1, [
      makeDesk('d1', [makeStudentEntry({ origin: 'template' }), makeStudentEntry({ id: 'e2', managedStudentId: 's2', name: '生徒B', origin: 'manual' })]),
      makeDesk('d2', [makeStudentEntry({ id: 'e3', managedStudentId: 's3', name: '生徒B' }), null]),
    ])]]
    const board = { suppressedRegularLessonOccurrences: ['WHOLE_DAY_PAIR__2026-11-10__2026-11-17__0', 's1__2026-11-03__1', 'WHOLE_DAY_PAIR__2026-11-11__2026-11-18__0'] }
    const report = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload({ weeks, board }), now: NOW })
    expect(report.counts.wholeDayPairs).toBe(2)
    expect(report.counts.originMarks).toBe(2)
    expect(report.counts.originTemplate).toBe(1)
    expect(report.counts.originManual).toBe(1)
    expect(findingOf(report, 'whole-day-pair-count').severity).toBe('info')
    expect(findingOf(report, 'origin-mark-count').severity).toBe('info')
  })
})

describe('前日からの減少', () => {
  it('名簿の生徒 ID が前より減れば roster-shrink、講師が減れば teacher-shrink を warn', () => {
    const before = makePayload({ students: [{ id: 's1', name: '生徒A' }, { id: 's2', name: '生徒B' }], teachers: [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師A' }] })
    const after = makePayload({ students: [{ id: 's1', name: '生徒A' }], teachers: [{ id: 't1', name: '講師A' }] })
    const report = buildBoardHealthReport({ classroomId: ROOM, before, after, now: NOW })
    const roster = findingOf(report, 'roster-shrink')
    expect(roster.severity).toBe('warn')
    expect(roster.message).toContain('s2')
    expect(roster.message).not.toContain('生徒B')
    const teacher = findingOf(report, 'teacher-shrink')
    expect(teacher.severity).toBe('warn')
    expect(teacher.message).toContain('t2')
    expect(report.counts.roster).toBe(1)
    expect(report.counts.teachers).toBe(1)

    // 前なし・増えただけなら出さない
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: null, after, now: NOW }))).not.toContain('roster-shrink')
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: after, after: before, now: NOW }))).not.toContain('roster-shrink')
  })

  it('盤面の振替(lessonType が makeup)のコマ数が前より 10 件以上または 10% 以上減れば makeup-drop を warn', () => {
    const makeupWeeks = (count) => [[makeCell('2026-11-10', 1, Array.from({ length: count }, (_, index) => makeDesk(`d${index}`, [makeStudentEntry({ id: `e${index}`, managedStudentId: `s${index}`, lessonType: 'makeup' }), null])))]]
    // 100 → 91(9 件・9%)は出さない
    const small = buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: makeupWeeks(100) }), after: makePayload({ weeks: makeupWeeks(91) }), now: NOW })
    expect(codesOf(small)).not.toContain('makeup-drop')
    expect(small.counts.makeups).toBe(91)
    // 100 → 90(10 件)は出す
    const ten = buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: makeupWeeks(100) }), after: makePayload({ weeks: makeupWeeks(90) }), now: NOW })
    expect(findingOf(ten, 'makeup-drop').severity).toBe('warn')
    // 20 → 18(10%)は出す
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: makeupWeeks(20) }), after: makePayload({ weeks: makeupWeeks(18) }), now: NOW }))).toContain('makeup-drop')
    // 増えたときは出さない
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: makeupWeeks(5) }), after: makePayload({ weeks: makeupWeeks(8) }), now: NOW }))).not.toContain('makeup-drop')
  })

  it('机単位の変更が 200 を超えれば desk-change-burst を info(snapshot-diff の diffBoardWeeks を使う)', () => {
    const weeksWith = (count, filled) => [[makeCell('2026-11-10', 1, Array.from({ length: count }, (_, index) => makeDesk(`d${index}`, filled ? [makeStudentEntry({ id: `e${index}`, managedStudentId: `s${index}` }), null] : [null, null])))]]
    const burst = buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: weeksWith(201, false) }), after: makePayload({ weeks: weeksWith(201, true) }), now: NOW })
    expect(burst.counts.deskChanges).toBe(201)
    expect(findingOf(burst, 'desk-change-burst').severity).toBe('info')
    const calm = buildBoardHealthReport({ classroomId: ROOM, before: makePayload({ weeks: weeksWith(200, false) }), after: makePayload({ weeks: weeksWith(200, true) }), now: NOW })
    expect(calm.counts.deskChanges).toBe(200)
    expect(codesOf(calm)).not.toContain('desk-change-burst')
  })
})

describe('保存記録と利用者報告', () => {
  it('saveAttempts(フィールド status・savedAt は ISO 文字列)に too-large / write-failed / verification-failed / stale / empty-management-data があれば save-failed を warn、24 時間で 0 件なら save-none を info(verified の件数は counts.saves)', () => {
    const saveAttempts = [
      { status: 'verified', savedAt: '2026-11-08T10:00:00.000Z' },
      { status: 'verified', savedAt: '2026-11-08T11:00:00.000Z' },
      { status: 'started', savedAt: '2026-11-08T11:30:00.000Z' },
      { status: 'too-large', savedAt: '2026-11-08T12:00:00.000Z', errorMessage: '生徒A の…' },
      { status: 'write-failed', savedAt: '2026-11-08T12:10:00.000Z' },
      { status: 'verification-failed', savedAt: '2026-11-08T12:20:00.000Z' },
      { status: 'stale', savedAt: '2026-11-08T12:30:00.000Z' },
      { status: 'empty-management-data', savedAt: '2026-11-08T12:40:00.000Z' },
      { status: 'too-large', savedAt: '2026-11-01T12:00:00.000Z' }, // 24 時間より前は数えない
    ]
    const report = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload(), saveAttempts, now: NOW })
    const failed = report.findings.filter((finding) => finding.code === 'save-failed')
    expect(failed).toHaveLength(5)
    expect(failed.every((finding) => finding.severity === 'warn')).toBe(true)
    expect(failed.map((finding) => finding.message).join('\n')).not.toContain('生徒A')
    expect(report.counts.saves).toBe(2)
    expect(report.counts.savesStarted).toBe(1)
    expect(report.counts.saveFailures).toBe(5)
    expect(codesOf(report)).not.toContain('save-none')

    const none = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload(), saveAttempts: [{ status: 'verified', savedAt: '2026-11-01T00:00:00.000Z' }], now: NOW })
    expect(findingOf(none, 'save-none').severity).toBe('info')
    expect(none.counts.saves).toBe(0)

    // saveAttempts を渡さなければ保存の検査はしない
    expect(codesOf(buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload(), now: NOW }))).not.toContain('save-none')
  })

  it('developerReports(フィールド reportId・category・classroomId・reportedAt・isVerificationChecklist・isTest・isAutoErrorReport)のうち isVerificationChecklist と isTest を除いたものを user-report で warn(reportId・category・isAutoErrorReport だけ。本文は読まない)', () => {
    const developerReports = [
      { reportId: 'r-1', category: 'request', classroomId: ROOM, reportedAt: '2026-11-08T09:00:00.000Z', isVerificationChecklist: false, isTest: false, isAutoErrorReport: false, message: '生徒A が…' },
      { reportId: 'r-2', category: 'bug', classroomId: ROOM, reportedAt: '2026-11-08T09:10:00.000Z', isAutoErrorReport: true },
      { reportId: 'r-3', category: 'request', classroomId: ROOM, reportedAt: '2026-11-08T09:20:00.000Z', isVerificationChecklist: true },
      { reportId: 'r-4', category: 'question', classroomId: ROOM, reportedAt: '2026-11-08T09:30:00.000Z', isTest: true },
      { reportId: 'r-5', category: 'request', classroomId: 'room2', reportedAt: '2026-11-08T09:40:00.000Z' },
      { reportId: 'r-6', category: 'request', classroomId: ROOM, reportedAt: '2026-11-01T09:40:00.000Z' },
    ]
    const report = buildBoardHealthReport({ classroomId: ROOM, before: null, after: makePayload(), developerReports, now: NOW })
    const reports = report.findings.filter((finding) => finding.code === 'user-report')
    expect(reports.map((finding) => finding.severity)).toEqual(['warn', 'warn'])
    expect(reports[0].message).toContain('r-1')
    expect(reports[0].message).toContain('request')
    expect(reports[1].message).toContain('r-2')
    expect(reports[1].message).toContain('自動エラー報告')
    expect(reports.map((finding) => finding.message).join('\n')).not.toContain('生徒A')
    expect(report.counts.userReports).toBe(2)
  })
})

describe('formatBoardHealthText', () => {
  it('formatBoardHealthText の出力に fixture の生徒名・講師名が 1 文字も含まれない', () => {
    const before = makePayload({ students: [{ id: 's1', name: '生徒A' }, { id: 's2', name: '生徒B' }], teachers: [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師A' }] })
    const after = makePayload({ weeks: duplicateWeeks(), students: [{ id: 's1', name: '生徒A' }], teachers: [], board: { templatePendingDesks: { 'c::d': {} } } })
    const report = buildBoardHealthReport({
      classroomId: ROOM,
      before,
      after,
      saveAttempts: [{ status: 'too-large', savedAt: '2026-11-08T12:00:00.000Z', errorMessage: '生徒A 講師A' }],
      developerReports: [{ reportId: 'r-1', category: 'request', classroomId: ROOM, reportedAt: '2026-11-08T12:00:00.000Z', message: '生徒A 講師A' }],
      now: NOW,
    })
    const text = formatBoardHealthText(report, { classroomLabel: ROOM })
    for (const name of ['生徒A', '生徒B', '講師A']) expect(text).not.toContain(name)
    const lines = text.split('\n')
    const firstWarn = lines.findIndex((line) => line.startsWith('[warn]'))
    const lastWarn = lines.map((line) => line.startsWith('[warn]')).lastIndexOf(true)
    const firstInfo = lines.findIndex((line) => line.startsWith('[info]'))
    expect(firstWarn).toBeGreaterThan(-1)
    expect(firstInfo).toBeGreaterThan(lastWarn)
    expect(lines[0]).toContain(ROOM)
    expect(lines[0]).toContain('保存')
  })

  it('findings が無ければ 1 行「異常なし」', () => {
    const report = buildBoardHealthReport({ classroomId: ROOM, before: makePayload(), after: makePayload(), now: NOW })
    expect(report.findings).toEqual([])
    const lines = formatBoardHealthText(report, { classroomLabel: ROOM }).split('\n')
    expect(lines.filter((line) => line === '異常なし')).toHaveLength(1)
    expect(lines.some((line) => line.startsWith('[warn]') || line.startsWith('[info]'))).toBe(false)
  })
})

describe('Firestore の返り値の読み下し', () => {
  it('unwrapFirestoreFields は stringValue / booleanValue / integerValue などを素の値へ戻す', () => {
    expect(unwrapFirestoreFields({
      status: { stringValue: 'verified' },
      isTest: { booleanValue: true },
      byteLength: { integerValue: '1234' },
      ratio: { doubleValue: 0.5 },
      savedAt: { timestampValue: '2026-11-08T00:00:00Z' },
      none: { nullValue: null },
      nested: { mapValue: { fields: { a: { stringValue: 'x' } } } },
      list: { arrayValue: { values: [{ stringValue: 'y' }] } },
    })).toEqual({ status: 'verified', isTest: true, byteLength: 1234, ratio: 0.5, savedAt: '2026-11-08T00:00:00Z', none: null, nested: { a: 'x' }, list: ['y'] })
  })

  it('normalizeRecordList は素の配列・runQuery の返り値・{ documents } を受ける(文書 ID を id に入れる)', () => {
    expect(normalizeRecordList([{ status: 'verified' }])).toEqual([{ status: 'verified' }])
    const runQuery = [
      { document: { name: 'projects/p/databases/(default)/documents/x/abc', fields: { status: { stringValue: 'stale' } } }, readTime: 't' },
      { readTime: 't' },
    ]
    expect(normalizeRecordList(runQuery)).toEqual([{ id: 'abc', status: 'stale' }])
    expect(normalizeRecordList({ documents: [{ name: 'a/b/r-9', fields: { category: { stringValue: 'request' } } }] })).toEqual([{ id: 'r-9', category: 'request' }])
  })
})

describe('parseArgs / validateArgs', () => {
  it('前のファイル(- で省略)・後のファイル・--classroom と各 JSON・--json を読む', () => {
    const options = parseArgs(['-', 'after.json.gz', '--classroom', 'room1', '--save-attempts', 'sa.json', '--reports', 'r.json', '--known', 'k.json', '--json', '--now', NOW])
    expect(options.files).toEqual(['-', 'after.json.gz'])
    expect(options.classroomId).toBe('room1')
    expect(options.saveAttemptsFile).toBe('sa.json')
    expect(options.reportsFile).toBe('r.json')
    expect(options.knownFile).toBe('k.json')
    expect(options.json).toBe(true)
    expect(options.now).toBe(NOW)
    expect(validateArgs(options)).toEqual([])
  })

  it('--classroom 必須・ファイル 2 つ必須・知らないオプションはエラー', () => {
    expect(validateArgs(parseArgs(['a', 'b']))).toContain('--classroom を指定してください。')
    expect(validateArgs(parseArgs(['a', '--classroom', 'x']))).toContain('前のファイル(無ければ -)と後のファイルを指定してください(指定 1 個)。')
    expect(validateArgs(parseArgs(['a', 'b', '--classroom', 'x', '--write']))).toContain('知らないオプションです: --write')
  })
})
