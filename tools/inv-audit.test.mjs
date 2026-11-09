// tools/inv-audit.mjs(保証台帳 docs/spec-invariants.md の違反を教室データから洗い出す読み取り専用ツール)を固定する。
// 判定の本体は tools/invAuditEntry.ts(アプリの権威関数を呼ぶだけ)。ここではそれを vitest で直接 import して確かめる。
// フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・講師A・講師B)。出力に名前が 1 文字も出ないことも確かめる。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auditClassroomSnapshot, INV_AUDIT_RULES } from './invAuditEntry.ts'
import { formatInvAuditText, parseArgs, validateArgs } from './inv-audit.mjs'

const ROOM = 'room1'
const TODAY = '2026-11-09'
const NAMES = ['生徒A', '生徒B', '講師A', '講師B']

function makeStudentRow(id, name) {
  return { id, name, displayName: name, email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
}

function makeTeacherRow(id, name) {
  return { id, name, email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
}

function makeStudentEntry(overrides = {}) {
  return { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function makeStatusEntry(overrides = {}) {
  return {
    id: 'st1', studentId: 'e1', sourceManagedLesson: true, name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular',
    teacherType: 'normal', teacherName: '', dateKey: '2026-11-12', slotNumber: 1, recordedAt: '2026-11-01T00:00:00.000Z', status: 'absent', sourceLessonId: 'L1',
    ...overrides,
  }
}

function makeDesk(id, studentSlots = [null, null], overrides = {}) {
  return { id, teacher: '', lesson: { id: `L-${id}`, studentSlots }, ...overrides }
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
function makeCell(dateKey, slotNumber, desks) {
  const day = new Date(`${dateKey}T00:00:00`).getDay()
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: DAY_LABELS[day], dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function makeSettings(extra = {}) {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...extra }
}

function makePayload({ weeks, board = {}, students, teachers, settings, regularLessons = [], specialSessions = [] } = {}) {
  return {
    screen: 'board',
    classroomSettings: settings ?? makeSettings(),
    managers: [],
    teachers: teachers ?? [makeTeacherRow('t1', '講師A')],
    students: students ?? [makeStudentRow('s1', '生徒A'), makeStudentRow('s2', '生徒B')],
    regularLessons,
    groupLessons: [],
    specialSessions,
    autoAssignRules: [],
    pairConstraints: [],
    boardState: {
      weeks: weeks ?? [[makeCell('2026-11-10', 1, [makeDesk('d1'), makeDesk('d2')])]],
      weekIndex: 0, selectedCellId: '', selectedDeskIndex: 0,
      suppressedRegularLessonOccurrences: [], scheduleCountAdjustments: [],
      manualMakeupAdjustments: {}, suppressedMakeupOrigins: {}, fallbackMakeupStudents: {},
      manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackLectureStockStudents: {},
      isLectureStockOpen: false, isMakeupStockOpen: false, studentScheduleRange: null, teacherScheduleRange: null,
      ...board,
    },
  }
}

function audit(payload, extra = {}) {
  return auditClassroomSnapshot({ classroomId: ROOM, payload, today: TODAY, ...extra })
}

function rulesOf(result) {
  return result.findings.map((finding) => finding.rule)
}

function findingsOf(result, rule) {
  return result.findings.filter((finding) => finding.rule === rule)
}

function duplicateWeeks(dateKey = '2026-11-18', slotNumber = 5) {
  return [[makeCell(dateKey, slotNumber, [
    makeDesk('d1', [makeStudentEntry(), null]),
    makeDesk('d2', [null, makeStudentEntry({ id: 'e2' })]),
  ])]]
}

describe('ルールの一覧と、何も無い教室', () => {
  it('ルールは INV-12・INV-06・HOLIDAY・INV-01・INV-13・INV-08・INV-14 の 7 つ', () => {
    expect(INV_AUDIT_RULES).toEqual(['INV-12', 'INV-06', 'HOLIDAY', 'INV-01', 'INV-13', 'INV-08', 'INV-14'])
  })

  it('違反の無い教室は findings が空で、件数はすべて 0', () => {
    const result = audit(makePayload())
    expect(result.findings).toEqual([])
    for (const rule of INV_AUDIT_RULES) {
      expect(result.counts[rule]).toBe(0)
      expect(result.counts[`${rule}.future`]).toBe(0)
      expect(result.counts[`${rule}.past`]).toBe(0)
    }
    expect(result.counts.total).toBe(0)
    expect(result.counts.known).toBe(0)
  })
})

describe('INV-12 同じコマに同じ生徒が 2 か所', () => {
  it('出る: 同じ日付×時限の 2 つの机に同じ生徒(s1)。bug・生徒 ID・机番号つき(名前は出さない)', () => {
    const result = audit(makePayload({ weeks: duplicateWeeks() }))
    const found = findingsOf(result, 'INV-12')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'INV-12', severity: 'bug', studentId: 's1', dateKey: '2026-11-18', slotNumber: 5, deskIndex: 0 })
    expect(found[0].message).toContain('机1')
    expect(found[0].message).toContain('机2')
    expect(found[0].message).not.toContain('生徒A')
    expect(result.counts['INV-12']).toBe(1)
    expect(result.counts['INV-12.future']).toBe(1)
    expect(result.counts['INV-12.past']).toBe(0)
  })

  it('出ない: 別の時限なら重複ではない／保留の下段に同じ生徒が居ても配置ではない(INV-12 注記)', () => {
    const apart = [[
      makeCell('2026-11-18', 4, [makeDesk('d1', [makeStudentEntry(), null])]),
      makeCell('2026-11-18', 5, [makeDesk('d1', [makeStudentEntry({ id: 'e2' }), null])]),
    ]]
    expect(rulesOf(audit(makePayload({ weeks: apart })))).not.toContain('INV-12')

    const weeks = [[makeCell('2026-11-18', 5, [makeDesk('d1', [makeStudentEntry(), null]), makeDesk('d2')])]]
    const templatePendingDesks = {
      '2026-11-18_5::d2': { lower: { lesson: { id: 'L-low', studentSlots: [makeStudentEntry({ id: 'e-low' }), null] } }, effectiveStartDate: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' },
    }
    expect(rulesOf(audit(makePayload({ weeks, board: { templatePendingDesks } })))).not.toContain('INV-12')
  })

  it('今日より前のコマは past に数え、出力は今日以降が先', () => {
    const weeks = [[...duplicateWeeks('2026-11-02', 1)[0], ...duplicateWeeks('2026-11-18', 5)[0]]]
    const result = audit(makePayload({ weeks }))
    expect(result.counts['INV-12.future']).toBe(1)
    expect(result.counts['INV-12.past']).toBe(1)
    expect(result.findings.map((finding) => finding.dateKey)).toEqual(['2026-11-18', '2026-11-02'])
    expect(result.findings.map((finding) => finding.period)).toEqual(['future', 'past'])
  })

  it('既知(rule・classroomId・dateKey・slotNumber・studentId がすべて一致)は数えない。rule や教室が違えば効かない', () => {
    const weeks = duplicateWeeks('2026-11-18', 5)
    const known = [{ rule: 'INV-12', classroomId: ROOM, dateKey: '2026-11-18', slotNumber: 5, studentId: 's1', note: '室長が直す' }]
    const skipped = audit(makePayload({ weeks }), { known })
    expect(findingsOf(skipped, 'INV-12')).toEqual([])
    expect(skipped.counts.known).toBe(1)
    expect(skipped.counts['INV-12']).toBe(0)

    for (const other of [{ ...known[0], rule: 'HOLIDAY' }, { ...known[0], classroomId: 'room2' }, { ...known[0], slotNumber: 4 }, { ...known[0], studentId: 's2' }, { ...known[0], rule: undefined }]) {
      expect(audit(makePayload({ weeks }), { known: [other] }).counts['INV-12']).toBe(1)
    }
  })
})

describe('INV-06 在庫(未消化講習の消化が希望数を超える・根拠を失った振替)', () => {
  const session = (studentInputs) => ({ id: 'sp1', label: '冬期講習', startDate: '2026-12-20', endDate: '2027-01-07', teacherInputs: {}, studentInputs, createdAt: '', updatedAt: '' })
  const input = (subjectSlots) => ({ unavailableSlots: [], regularBreakSlots: [], subjectSlots, regularOnly: false, countSubmitted: true, updatedAt: '' })

  it('出る: 講習の希望数 2 に対して台帳の消化が 3(残が −1)。check・生徒 ID', () => {
    const payload = makePayload({ specialSessions: [session({ s1: input({ 数: 2 }) })], board: { manualLectureStockCounts: { 's1__数__sp1': -3 } } })
    const found = findingsOf(audit(payload), 'INV-06')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'INV-06', severity: 'check', studentId: 's1', kind: 'lecture-overconsumed' })
    expect(found[0].message).toContain('-1')
    expect(found[0].message).not.toContain('生徒A')
  })

  it('出ない: 消化が希望数ちょうど(残 0)', () => {
    const payload = makePayload({ specialSessions: [session({ s1: input({ 数: 2 }) })], board: { manualLectureStockCounts: { 's1__数__sp1': -2 } } })
    expect(rulesOf(audit(payload))).not.toContain('INV-06')
  })

  it('講習の所見は講習の終わりの日で数える: 終わった講習(8/31)の台帳だけの跡は past。メッセージは「台帳の差分」(盤面のコマ数と取り違えない)', () => {
    const ended = { ...session({ s1: input({ 数: 2 }) }), startDate: '2026-07-20', endDate: '2026-08-31' }
    const result = audit(makePayload({ specialSessions: [ended], board: { manualLectureStockCounts: { 's1__数__sp1': -3 } } }))
    const found = findingsOf(result, 'INV-06')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ period: 'past', kind: 'lecture-overconsumed', subject: '数', sessionId: 'sp1' })
    expect(found[0].message).toContain('台帳の差分 -3')
    expect(found[0].message).not.toContain('消化 3')
    expect(result.counts['INV-06.past']).toBe(1)
    expect(result.counts['INV-06.future']).toBe(0)
    // 終わっていない講習(1/7 まで)は今日以降
    const running = audit(makePayload({ specialSessions: [session({ s1: input({ 数: 2 }) })], board: { manualLectureStockCounts: { 's1__数__sp1': -3 } } }))
    expect(findingsOf(running, 'INV-06')[0].period).toBe('future')
  })

  it('日付の無い所見の既知: kind・subject・sessionId を書けば一致を要求し、書かなければ今までどおり(rule・教室・生徒の一致だけ)', () => {
    const payload = makePayload({ specialSessions: [session({ s1: input({ 数: 2 }) })], board: { manualLectureStockCounts: { 's1__数__sp1': -3 } } })
    const base = { rule: 'INV-06', classroomId: ROOM, studentId: 's1' }
    expect(audit(payload, { known: [{ ...base, kind: 'lecture-overconsumed', subject: '数', sessionId: 'sp1' }] }).counts['INV-06']).toBe(0)
    expect(audit(payload, { known: [base] }).counts['INV-06']).toBe(0)
    expect(audit(payload, { known: [{ ...base, subject: '英' }] }).counts['INV-06']).toBe(1)
    expect(audit(payload, { known: [{ ...base, sessionId: 'sp2' }] }).counts['INV-06']).toBe(1)
    expect(audit(payload, { known: [{ ...base, kind: 'orphaned-makeup' }] }).counts['INV-06']).toBe(1)
  })

  const templateSettings = makeSettings({ regularLessonTemplate: { version: 1, effectiveStartDate: '2026-11-01', savedAt: '2026-11-01T00:00:00.000Z', cells: [] }, templateFreezeBeforeDate: '2026-11-01' })
  const makeupWeeks = [[makeCell('2026-11-11', 1, [makeDesk('d1', [makeStudentEntry({ id: 'mk1', lessonType: 'makeup', makeupSourceDate: '2026-11-04', makeupSourceLabel: '11/4(水) 1限' }), null])])]]

  it('出る: 振替元の日(11/4)にテンプレの授業も在庫の origin も無い振替(collectOrphanedMakeups)。bug・置いてある日付と机', () => {
    const found = findingsOf(audit(makePayload({ weeks: makeupWeeks, settings: templateSettings })), 'INV-06')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'INV-06', severity: 'bug', kind: 'orphaned-makeup', studentId: 's1', dateKey: '2026-11-11', slotNumber: 1, deskIndex: 0 })
    expect(found[0].message).toContain('2026-11-04')
  })

  it('出ない: 在庫の台帳に振替元の日の origin がある振替／テンプレの反映日が無い教室は調べない(notes に理由)', () => {
    const backed = makePayload({ weeks: makeupWeeks, settings: templateSettings, board: { manualMakeupAdjustments: { 's1__数': [{ dateKey: '2026-11-04' }] } } })
    expect(rulesOf(audit(backed))).not.toContain('INV-06')

    const noTemplate = audit(makePayload({ weeks: makeupWeeks }))
    expect(rulesOf(noTemplate)).not.toContain('INV-06')
    expect(noTemplate.notes.join('\n')).toContain('反映日')
  })
})

describe('HOLIDAY 休日に授業が残っている(オーナー指示でバグ扱い)', () => {
  it('出る: holidayDates の日の机に授業(生徒の席)が残っている。bug・生徒 ID', () => {
    const weeks = [[makeCell('2026-11-12', 1, [makeDesk('d1', [makeStudentEntry(), null]), makeDesk('d2')])]]
    const found = findingsOf(audit(makePayload({ weeks, settings: makeSettings({ holidayDates: ['2026-11-12'] }) })), 'HOLIDAY')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'HOLIDAY', severity: 'bug', studentId: 's1', dateKey: '2026-11-12', slotNumber: 1, deskIndex: 0 })
  })

  it('出ない: 休日の机に出欠記録だけ(休み・振無休・移動・休))が残っている／休日でも forceOpenDates で開けた日', () => {
    const recordsOnly = [[makeCell('2026-11-12', 1, [
      { id: 'd1', teacher: '', statusSlots: [makeStatusEntry({ status: 'holiday' }), makeStatusEntry({ id: 'st2', studentId: 'e2', managedStudentId: 's2', name: '生徒B', status: 'absent' })] },
      { id: 'd2', teacher: '', lesson: { id: 'L-d2', studentSlots: [null, null] }, statusSlots: [makeStatusEntry({ id: 'st3', status: 'moved' }), makeStatusEntry({ id: 'st4', status: 'absent-no-makeup' })] },
    ])]]
    expect(rulesOf(audit(makePayload({ weeks: recordsOnly, settings: makeSettings({ holidayDates: ['2026-11-12'] }) })))).not.toContain('HOLIDAY')

    const lesson = [[makeCell('2026-11-12', 1, [makeDesk('d1', [makeStudentEntry(), null])])]]
    expect(rulesOf(audit(makePayload({ weeks: lesson, settings: makeSettings({ holidayDates: ['2026-11-12'], forceOpenDates: ['2026-11-12'] }) })))).not.toContain('HOLIDAY')
  })
})

describe('INV-01 講師日程表で 1 コマの生徒が 2 人の講師に出る', () => {
  it('出る: 机の講師は講師A(名前だけ)だが、基本データの通常授業の担当は講師B(regularTeacherIds)→ 講師日程表の作り方で両方のページに出る', () => {
    const teachers = [makeTeacherRow('t1', '講師A'), makeTeacherRow('t2', '講師B')]
    // 2026-11-11 は水曜(3)。
    const regularLessons = [{
      id: 'r1', schoolYear: 2026, teacherId: 't2', student1Id: 's1', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '',
      student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 1,
    }]
    const weeks = [[makeCell('2026-11-11', 1, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A' }), makeDesk('d2')])]]
    const found = findingsOf(audit(makePayload({ weeks, teachers, regularLessons })), 'INV-01')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'INV-01', severity: 'bug', studentId: 's1', dateKey: '2026-11-11', slotNumber: 1 })
    expect(found[0].message).toContain('t1')
    expect(found[0].message).toContain('t2')
    for (const name of NAMES) expect(found[0].message).not.toContain(name)
  })

  it('出ない: 机の講師 ID(teacherAssignmentTeacherId)がある机は、その講師 1 人だけに出る', () => {
    const teachers = [makeTeacherRow('t1', '講師A'), makeTeacherRow('t2', '講師B')]
    const weeks = [[makeCell('2026-11-11', 1, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A', teacherAssignmentTeacherId: 't1' }), makeDesk('d2')])]]
    expect(rulesOf(audit(makePayload({ weeks, teachers })))).not.toContain('INV-01')
  })

  it('出ない: もう一人がそのコマの日に在籍していない講師(講師日程表が getVisibleTeachers で外す講師・退職した講師)なら数えない', () => {
    const teachers = [makeTeacherRow('t1', '講師A'), { ...makeTeacherRow('t2', '講師B'), withdrawDate: '2026-10-31' }]
    const regularLessons = [{
      id: 'r1', schoolYear: 2026, teacherId: 't2', student1Id: 's1', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '',
      student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 1,
    }]
    const weeks = [[makeCell('2026-11-11', 1, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A' }), makeDesk('d2')])]]
    expect(rulesOf(audit(makePayload({ weeks, teachers, regularLessons })))).not.toContain('INV-01')
  })
})

describe('INV-13 保留の下段が日程表に出る', () => {
  const pending = {
    '2026-11-18_5::d2': { lower: { lesson: { id: 'L-low', studentSlots: [makeStudentEntry({ id: 'e-low', managedStudentId: 's2', name: '生徒B' }), null] } }, effectiveStartDate: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' },
  }

  it('出ない: 下段は盤面の週に入っていないので日程表の材料にも入らない', () => {
    const weeks = [[makeCell('2026-11-18', 5, [makeDesk('d1', [makeStudentEntry(), null]), makeDesk('d2')])]]
    expect(rulesOf(audit(makePayload({ weeks, board: { templatePendingDesks: pending } })))).not.toContain('INV-13')
  })

  it('出る: 下段と同じ席の授業(同じ ID)が日程表の材料(講師日程表の payload)にも入っている', () => {
    const weeks = [[makeCell('2026-11-18', 5, [makeDesk('d1', [makeStudentEntry(), null]), makeDesk('d2', [makeStudentEntry({ id: 'e-low', managedStudentId: 's2', name: '生徒B' }), null])])]]
    const found = findingsOf(audit(makePayload({ weeks, board: { templatePendingDesks: pending } })), 'INV-13')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ rule: 'INV-13', severity: 'bug', studentId: 's2', dateKey: '2026-11-18', slotNumber: 5, deskIndex: 1 })
  })
})

describe('INV-08 写しトークンの教室 ID が開いている教室と違う', () => {
  it('出る: 生徒行の parentPortalTokenClassroomId が別教室(bug)／タグの無い写しトークン(check)。トークンの値は出さない', () => {
    const students = [
      { ...makeStudentRow('s1', '生徒A'), parentPortalToken: 'secret-token-1', parentPortalTokenClassroomId: 'room2' },
      { ...makeStudentRow('s2', '生徒B'), parentPortalToken: 'secret-token-2' },
    ]
    const result = audit(makePayload({ students }))
    const found = findingsOf(result, 'INV-08')
    expect(found.map((finding) => [finding.studentId, finding.severity])).toEqual([['s1', 'bug'], ['s2', 'check']])
    expect(found[0].message).toContain('room2')
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('出る: 講習の提出トークンの発行元教室タグが別教室(生徒・講師とも bug)。出ない: タグ無し(本番の既存トークン)・自教室', () => {
    const studentInput = (extra) => ({ unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, updatedAt: '', ...extra })
    const teacherInput = (extra) => ({ unavailableSlots: [], countSubmitted: false, updatedAt: '', ...extra })
    const specialSessions = [{
      id: 'sp1', label: '冬期講習', startDate: '2026-12-20', endDate: '2027-01-07', createdAt: '', updatedAt: '',
      studentInputs: {
        s1: studentInput({ submissionToken: 'sub-1', submissionTokenClassroomId: 'room2' }),
        s2: studentInput({ submissionToken: 'sub-2' }),
      },
      teacherInputs: {
        t1: teacherInput({ submissionToken: 'sub-3', submissionTokenClassroomId: 'room2' }),
        t2: teacherInput({ submissionToken: 'sub-4', submissionTokenClassroomId: ROOM }),
      },
    }]
    const result = audit(makePayload({ specialSessions }))
    const found = findingsOf(result, 'INV-08')
    expect(found).toHaveLength(2)
    expect(found.every((finding) => finding.severity === 'bug')).toBe(true)
    expect(found.map((finding) => finding.studentId)).toEqual(['s1', null])
    expect(found[1].message).toContain('t1')
    expect(JSON.stringify(result)).not.toContain('sub-')
  })

  it('出ない: 自教室のタグつき写しトークン', () => {
    const students = [{ ...makeStudentRow('s1', '生徒A'), parentPortalToken: 'tok', parentPortalTokenClassroomId: ROOM }]
    expect(rulesOf(audit(makePayload({ students })))).not.toContain('INV-08')
  })
})

describe('INV-14 教室データの欠け(check)', () => {
  it('出る: 名簿・講師・盤面の週・教室設定のどれかが空', () => {
    expect(findingsOf(audit(makePayload({ students: [] })), 'INV-14').map((finding) => finding.kind)).toEqual(['empty-students'])
    expect(findingsOf(audit(makePayload({ teachers: [] })), 'INV-14').map((finding) => finding.kind)).toEqual(['empty-teachers'])
    expect(findingsOf(audit(makePayload({ weeks: [] })), 'INV-14').map((finding) => finding.kind)).toEqual(['empty-weeks'])
    const noSettings = makePayload()
    delete noSettings.classroomSettings
    expect(findingsOf(audit(noSettings), 'INV-14').map((finding) => finding.kind)).toEqual(['missing-classroom-settings'])
    const noBoard = { ...makePayload(), boardState: null }
    const result = audit(noBoard)
    expect(findingsOf(result, 'INV-14').map((finding) => [finding.kind, finding.severity])).toEqual([['empty-weeks', 'check']])
  })

  it('出ない: どれもそろっている', () => {
    expect(rulesOf(audit(makePayload()))).not.toContain('INV-14')
  })
})

/** すべてのルールが 1 件以上出る教室(名前の漏れの検査用)。 */
function everythingPayload() {
  const students = [
    { ...makeStudentRow('s1', '生徒A'), parentPortalToken: 'tok', parentPortalTokenClassroomId: 'room2' },
    makeStudentRow('s2', '生徒B'),
  ]
  const teachers = [makeTeacherRow('t1', '講師A'), makeTeacherRow('t2', '講師B')]
  const regularLessons = [{
    id: 'r1', schoolYear: 2026, teacherId: 't2', student1Id: 's1', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 1,
  }]
  const weeks = [[
    ...duplicateWeeks('2026-11-18', 5)[0],
    makeCell('2026-11-12', 1, [makeDesk('d1', [makeStudentEntry({ id: 'h1', managedStudentId: 's2', name: '生徒B' }), null])]),
    makeCell('2026-11-11', 1, [makeDesk('d1', [makeStudentEntry({ id: 'r1' }), null], { teacher: '講師A' }), makeDesk('d2', [makeStudentEntry({ id: 'mk1', lessonType: 'makeup', managedStudentId: 's2', name: '生徒B', makeupSourceDate: '2026-11-05' }), null])]),
    makeCell('2026-11-20', 2, [makeDesk('d1'), makeDesk('d2', [makeStudentEntry({ id: 'e-low', managedStudentId: 's2', name: '生徒B' }), null])]),
  ]]
  return makePayload({
    students, teachers, regularLessons, weeks,
    settings: makeSettings({ holidayDates: ['2026-11-12'], regularLessonTemplate: { version: 1, effectiveStartDate: '2026-11-01', savedAt: '', cells: [] } }),
    specialSessions: [{ id: 'sp1', label: '冬期講習', startDate: '2026-12-20', endDate: '2027-01-07', teacherInputs: {}, createdAt: '', updatedAt: '', studentInputs: { s2: { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 数: 1 }, regularOnly: false, countSubmitted: true, updatedAt: '' } } }],
    board: {
      manualLectureStockCounts: { 's2__数__sp1': -2 },
      templatePendingDesks: { '2026-11-20_2::d2': { lower: { lesson: { id: 'L-low', studentSlots: [makeStudentEntry({ id: 'e-low', managedStudentId: 's2', name: '生徒B' }), null] } }, effectiveStartDate: '2026-11-01', createdAt: '' } },
    },
  })
}

describe('名前を出さない', () => {
  it('すべてのルールが出る教室でも、結果(JSON)と文字の出力に生徒名・講師名が 1 文字も含まれない', () => {
    const result = audit(everythingPayload())
    for (const rule of ['INV-12', 'INV-06', 'HOLIDAY', 'INV-01', 'INV-13', 'INV-08']) expect(result.counts[rule]).toBeGreaterThan(0)
    const json = JSON.stringify(result)
    const text = formatInvAuditText(result, { classroomLabel: ROOM, today: TODAY })
    for (const name of NAMES) {
      expect(json).not.toContain(name)
      expect(text).not.toContain(name)
    }
  })

  it('--show-names のときだけ、名簿の名前を ID に添える', () => {
    const payload = everythingPayload()
    const result = audit(payload)
    const names = new Map(payload.students.map((student) => [student.id, student.name]))
    const text = formatInvAuditText(result, { classroomLabel: ROOM, today: TODAY, studentNames: names })
    expect(text).toContain('生徒A')
  })
})

describe('formatInvAuditText', () => {
  it('違反は bug だけで数える: check だけの教室は 1 行目が「保証台帳の違反: なし(要確認 INV-06 1 件)」。counts も bug と check を分ける', () => {
    const session = { id: 'sp1', label: '冬期講習', startDate: '2026-12-20', endDate: '2027-01-07', teacherInputs: {}, createdAt: '', updatedAt: '', studentInputs: { s1: { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 数: 1 }, regularOnly: false, countSubmitted: true, updatedAt: '' } } }
    const result = audit(makePayload({ specialSessions: [session], board: { manualLectureStockCounts: { 's1__数__sp1': -2 } } }))
    expect(result.counts['INV-06.check']).toBe(1)
    expect(result.counts['INV-06.bug']).toBe(0)
    expect(result.counts.bug).toBe(0)
    const first = formatInvAuditText(result, { classroomLabel: ROOM, today: TODAY }).split('\n')[0]
    expect(first).toContain('保証台帳の違反: なし')
    expect(first).toContain('要確認 INV-06 1 件')

    // bug と check が両方あれば、違反は bug の件数だけ・要確認は別に
    const weeks = duplicateWeeks('2026-11-18', 5)
    const both = audit(makePayload({ weeks, specialSessions: [session], board: { manualLectureStockCounts: { 's1__数__sp1': -2 } } }))
    const line = formatInvAuditText(both, { classroomLabel: ROOM, today: TODAY }).split('\n')[0]
    expect(line).toContain('保証台帳の違反: INV-12 1 件(今日以降 1 件)')
    expect(line).toContain('要確認 INV-06 1 件')
    expect(line).not.toContain('違反: INV-12 1 件(今日以降 1 件)・INV-06')
  })

  it('違反が無ければ「保証台帳の違反: なし」1 行', () => {
    const text = formatInvAuditText(audit(makePayload()), { classroomLabel: ROOM, today: TODAY })
    expect(text.split('\n').filter((line) => line.includes('保証台帳の違反: なし'))).toHaveLength(1)
  })

  it('1 行目に件数の要約(INV-xx n 件(今日以降 m 件))、今日以降の行が今日より前の行より先', () => {
    const weeks = [[...duplicateWeeks('2026-11-02', 1)[0], ...duplicateWeeks('2026-11-18', 5)[0]]]
    const lines = formatInvAuditText(audit(makePayload({ weeks })), { classroomLabel: ROOM, today: TODAY }).split('\n')
    expect(lines[0]).toContain(ROOM)
    expect(lines[0]).toContain('INV-12 2 件(今日以降 1 件)')
    const future = lines.findIndex((line) => line.includes('2026-11-18'))
    const past = lines.findIndex((line) => line.includes('2026-11-02'))
    expect(future).toBeGreaterThan(0)
    expect(past).toBeGreaterThan(future)
  })
})

describe('parseArgs / validateArgs', () => {
  it('ファイル 1 つ・--classroom・--today・--known・--json・--show-names を読む', () => {
    const options = parseArgs(['room.json.gz', '--classroom', ROOM, '--today', TODAY, '--known', 'k.json', '--json', '--show-names'])
    expect(options).toMatchObject({ files: ['room.json.gz'], classroomId: ROOM, today: TODAY, knownFile: 'k.json', json: true, showNames: true })
    expect(validateArgs(options)).toEqual([])
  })

  it('--classroom 必須・ファイルは 1 つ・--today は YYYY-MM-DD・知らないオプションはエラー', () => {
    expect(validateArgs(parseArgs(['a']))).toContain('--classroom を指定してください。')
    expect(validateArgs(parseArgs(['a', 'b', '--classroom', 'x']))).toContain('教室のファイルを 1 つ指定してください(指定 2 個)。')
    expect(validateArgs(parseArgs(['a', '--classroom', 'x', '--today', '11/9']))).toContain('--today は YYYY-MM-DD で指定してください。')
    expect(validateArgs(parseArgs(['a', '--classroom', 'x', '--write']))).toContain('知らないオプションです: --write')
  })
})

describe('CLI(束ねて実行・教室別バックアップの .json.gz を読む)', () => {
  it('教室別バックアップを読んで JSON で返し、文字の出力にも名前を出さない。束ねた一時フォルダは残さない', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'inv-audit-test-'))
    try {
      const file = path.join(dir, `${ROOM}.json.gz`)
      writeFileSync(file, gzipSync(JSON.stringify({ schemaVersion: 1, savedAt: '2026-11-09T07:30:00.000Z', classrooms: [{ id: ROOM, name: '教室', data: everythingPayload() }] })))
      const knownFile = path.join(dir, 'known.json')
      writeFileSync(knownFile, JSON.stringify([{ rule: 'INV-12', classroomId: ROOM, dateKey: '2026-11-18', slotNumber: 5, studentId: 's1' }]))
      const cli = path.join(import.meta.dirname, 'inv-audit.mjs')
      const cacheDir = path.join(import.meta.dirname, '..', 'node_modules', '.cache')
      const before = readdirSync(cacheDir).filter((name) => name.startsWith('inv-audit-'))

      const json = JSON.parse(execFileSync(process.execPath, [cli, file, '--classroom', ROOM, '--today', TODAY, '--known', knownFile, '--json'], { encoding: 'utf8' }))
      expect(json.counts['INV-12']).toBe(0)
      expect(json.counts.known).toBe(1)
      expect(json.counts.HOLIDAY).toBe(1)

      const text = execFileSync(process.execPath, [cli, file, '--classroom', ROOM, '--today', TODAY], { encoding: 'utf8' })
      expect(text).toContain('INV-12')
      for (const name of NAMES) expect(text).not.toContain(name)

      const named = execFileSync(process.execPath, [cli, file, '--classroom', ROOM, '--today', TODAY, '--show-names'], { encoding: 'utf8' })
      expect(named).toContain('生徒A')

      expect(readdirSync(cacheDir).filter((name) => name.startsWith('inv-audit-'))).toEqual(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
