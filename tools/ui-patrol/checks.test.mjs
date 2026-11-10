// tools/ui-patrol/checks.ts(画面の自動巡回の操作のたびの点検)を固定する。決まりは docs/test-strategy.md「操作のたびの点検」と
// docs/plan-2026-11-11-ui-patrol.md の Task 3。フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・講師A・講師B)。
// 一番大事なのは 2026-11-10 の事故の形(テンプレ保存で手入力の振替の生徒が講師の机から講師のいない机へ移った)を止められること。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import {
  PATROL_FINDING_CODES,
  applyKnownIssues,
  checkAuditNotWorse,
  checkManualInputsNotLost,
  checkManualStudentsKeepTeacher,
  checkOutsideAllowedRange,
  checkPendingCountMatchesPreview,
  checkSameState,
  checkTeacherlessStudentsNotAdded,
  parsePendingCountFromConfirm,
  summarizeChanges,
} from './checks.ts'

function student(overrides = {}) {
  return { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}
const studentB = (overrides = {}) => student({ id: 'e2', name: '生徒B', managedStudentId: 's2', ...overrides })
const makeupA = (overrides = {}) => student({ lessonType: 'makeup', makeupSourceDate: '2026-11-12', ...overrides })

function status(overrides = {}) {
  return {
    id: 'st1', studentId: 'e1', sourceManagedLesson: true, name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular',
    teacherType: 'normal', teacherName: '', dateKey: '2026-11-19', slotNumber: 3, recordedAt: '2026-11-01T00:00:00.000Z', status: 'absent', sourceLessonId: 'L1',
    ...overrides,
  }
}

function desk(id, slots = [null, null], overrides = {}) {
  return { id, teacher: '', lesson: { id: `L-${id}`, studentSlots: slots }, ...overrides }
}

function cell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: '', slotLabel: '', slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function payload(cells, { board = {}, extra = {} } = {}) {
  return {
    screen: 'board',
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4 },
    managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: {
      weeks: [cells],
      weekIndex: 0, selectedCellId: '', selectedDeskIndex: 0,
      suppressedRegularLessonOccurrences: [], scheduleCountAdjustments: [],
      manualMakeupAdjustments: {}, suppressedMakeupOrigins: {}, fallbackMakeupStudents: {},
      manualLectureStockCounts: {}, manualLectureStockOrigins: {}, fallbackLectureStockStudents: {},
      isLectureStockOpen: false, isMakeupStockOpen: false, studentScheduleRange: null, teacherScheduleRange: null,
      ...board,
    },
    ...extra,
  }
}

const facts = (cells, options) => collectBoardFacts(payload(cells, options))
const D = '2026-11-19' // 木曜
const C = `${D}_3`
const codes = (findings) => findings.map((finding) => `${finding.level}:${finding.code}`)

function pending(deskId, lower) {
  return { [`${C}::${deskId}`]: { lower, effectiveStartDate: D, createdAt: '2026-11-10T00:00:00.000Z' } }
}

it('所見の種類はこの一覧(台本と既知の表が使う)', () => {
  expect(PATROL_FINDING_CODES).toContain('manual-student-teacher-changed')
  expect(PATROL_FINDING_CODES).toContain('change-summary')
  expect(PATROL_FINDING_CODES).toHaveLength(19)
})

describe('変わってよい範囲', () => {
  const base = () => [
    desk('d1', [student(), null], { teacher: '講師A' }),
    desk('d2', [null, null], { teacher: '講師B' }),
    desk('d3', [studentB(), null], { teacher: '講師B' }),
  ]

  it('動かした元と先の机だけなら所見なし', () => {
    const before = facts([cell(D, 3, base())])
    const moved = base()
    moved[0] = desk('d1', [null, null], { teacher: '講師A' })
    moved[1] = desk('d2', [student(), null], { teacher: '講師B' })
    const after = facts([cell(D, 3, moved)])
    expect(checkOutsideAllowedRange(before, after, { deskKeys: new Set([`${C}#0`, `${C}#1`]) })).toEqual([])
  })

  it('生徒を 1 人動かしたのに別の机の講師が変わったら stop', () => {
    const before = facts([cell(D, 3, base())])
    const moved = base()
    moved[0] = desk('d1', [null, null], { teacher: '講師A' })
    moved[1] = desk('d2', [student(), null], { teacher: '講師B' })
    moved[2] = desk('d3', [studentB(), null], { teacher: '講師A' })
    const after = facts([cell(D, 3, moved)])
    const findings = checkOutsideAllowedRange(before, after, { deskKeys: new Set([`${C}#0`, `${C}#1`]) })
    expect(codes(findings)).toEqual(['stop:outside-allowed-range'])
    expect(findings[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 2 })
    expect(findings[0].message).toContain('11/19(木) 3限 机3')
  })

  it('反映日より前の机が変わったら stop。反映日以降は所見なし', () => {
    const before = facts([cell('2026-11-18', 3, base()), cell('2026-11-20', 3, base())])
    const changed = () => [desk('d1', [student(), null], { teacher: '講師B' }), ...base().slice(1)]
    const afterLater = facts([cell('2026-11-18', 3, base()), cell('2026-11-20', 3, changed())])
    expect(checkOutsideAllowedRange(before, afterLater, { fromDateKey: '2026-11-19' })).toEqual([])
    const afterEarlier = facts([cell('2026-11-18', 3, changed()), cell('2026-11-20', 3, base())])
    const findings = checkOutsideAllowedRange(before, afterEarlier, { fromDateKey: '2026-11-19' })
    expect(codes(findings)).toEqual(['stop:outside-allowed-range'])
    expect(findings[0].dateKey).toBe('2026-11-18')
  })

  it('許していない部分（例 specialSessions）が変わったら stop', () => {
    const before = facts([cell(D, 3, base())])
    const after = facts([cell(D, 3, base())], { extra: { specialSessions: [{ id: 'sp1' }] } })
    expect(codes(checkOutsideAllowedRange(before, after, {}))).toEqual(['stop:outside-allowed-range'])
    expect(checkOutsideAllowedRange(before, after, { sections: new Set(['specialSessions']) })).toEqual([])
  })

  it('21 机以上は 20 件＋「ほか n 机」にまとめる', () => {
    const many = (teacher) => Array.from({ length: 23 }, (_, index) => desk(`d${index}`, [null, null], { teacher }))
    const before = facts([cell(D, 3, many('講師A'))])
    const after = facts([cell(D, 3, many('講師B'))])
    const findings = checkOutsideAllowedRange(before, after, {})
    expect(findings).toHaveLength(21)
    expect(findings.every((finding) => finding.level === 'stop' && finding.code === 'outside-allowed-range')).toBe(true)
    expect(findings[20].message).toContain('ほか 3 机')
  })
})

describe('手入力の生徒の講師（2026-11-10 緑が丘の形）', () => {
  it('手入力の振替の生徒が、講師 講師A の机から講師のいない机へ移ったら stop manual-student-teacher-changed', () => {
    // 操作前: 講師A の机に手入力の振替の生徒A。机2 は空き。
    const before = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' }), desk('d2')])])
    // テンプレ保存のあと: 講師A の机にテンプレの生徒B が入り、生徒A は講師のいない机へ。
    const after = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' }), desk('d2', [makeupA(), null])])])
    const findings = checkManualStudentsKeepTeacher(before, after)
    expect(codes(findings)).toEqual(['stop:manual-student-teacher-changed'])
    expect(findings[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 0, studentId: 's1' })
    expect(findings[0].message).toContain('11/19(木) 3限 机1')
    expect(findings[0].message).toContain('生徒A')
    expect(findings[0].message).toContain('講師A')
    expect(findings[0].message).toContain('講師なし')
    // 同じ操作は「講師のいない机に座る生徒が増えた」でも止まる
    expect(codes(checkTeacherlessStudentsNotAdded(before, after))).toEqual(['stop:teacherless-student-added'])
  })

  it('同じ講師について机番号だけ変わったのは所見なし', () => {
    const before = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' }), desk('d2')])])
    const after = facts([cell(D, 3, [desk('d2'), desk('d1', [makeupA({ origin: 'manual' }), null], { teacher: '講師A' })])])
    expect(checkManualStudentsKeepTeacher(before, after)).toEqual([])
  })

  it('確認の画面の詳細に名前が出ていれば info に下げる', () => {
    const before = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])])
    const after = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [makeupA(), null], { teacher: '講師B' })])])
    expect(codes(checkManualStudentsKeepTeacher(before, after, { announcedText: '講師B の机へ 生徒A を移します' }))).toEqual(['info:manual-student-teacher-changed-announced'])
    expect(codes(checkManualStudentsKeepTeacher(before, after, { announcedText: '生徒B を移します' }))).toEqual(['stop:manual-student-teacher-changed'])
  })

  it('保留の下段へ移ったのは info。どこにもいなければ stop manual-student-lost', () => {
    const before = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' })])])
    const toPending = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' })])], {
      board: { templatePendingDesks: pending('d1', { lesson: { id: 'LP', studentSlots: [makeupA(), null] } }) },
    })
    expect(codes(checkManualStudentsKeepTeacher(before, toPending))).toEqual(['info:manual-student-to-pending'])
    const lost = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' })])])
    const findings = checkManualStudentsKeepTeacher(before, lost)
    expect(codes(findings)).toEqual(['stop:manual-student-lost'])
    expect(findings[0].studentId).toBe('s1')
    // 別のコマへ行ったのは同じコマにいない＝消えた扱い(同じコマで探す)
    const otherCell = facts([cell(D, 3, [desk('d1')]), cell(D, 4, [desk('d1', [makeupA(), null], { teacher: '講師A' })])])
    expect(codes(checkManualStudentsKeepTeacher(before, otherCell))).toEqual(['stop:manual-student-lost'])
    // 除外の机の生徒は見ない
    expect(checkManualStudentsKeepTeacher(before, lost, { excludeDeskKeys: new Set([`${C}#0`]) })).toEqual([])
  })

  it('同じコマに同じ生徒が 2 か所いても落ちない', () => {
    const before = facts([cell(D, 3, [
      desk('d1', [makeupA(), null], { teacher: '講師A' }),
      desk('d2', [makeupA({ id: 'e9' }), null], { teacher: '講師B' }),
    ])])
    const same = facts([cell(D, 3, [
      desk('d1', [makeupA(), null], { teacher: '講師A' }),
      desk('d2', [makeupA({ id: 'e9' }), null], { teacher: '講師B' }),
    ])])
    expect(checkManualStudentsKeepTeacher(before, same)).toEqual([])
    // 1 か所だけ残った＝1 人分は消えた(数で突き合わせる)
    const one = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])])
    expect(codes(checkManualStudentsKeepTeacher(before, one))).toEqual(['stop:manual-student-lost'])
  })

  it('テンプレの生徒は見ない(講師が変わっても所見なし)', () => {
    const before = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' })])])
    const after = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師B' })])])
    expect(checkManualStudentsKeepTeacher(before, after)).toEqual([])
  })
})

describe('講師なしの机・手入力・同じ状態・保証台帳・保留の数・既知', () => {
  it('講師のいない机に座る生徒が増えたら stop。講師の休みの机は数えない。除外の机は見ない', () => {
    const before = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2'), desk('d3')])])
    const after = facts([cell(D, 3, [desk('d1'), desk('d2', [student(), null]), desk('d3')])])
    const findings = checkTeacherlessStudentsNotAdded(before, after)
    expect(codes(findings)).toEqual(['stop:teacherless-student-added'])
    expect(findings[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 1, studentId: 's1' })
    expect(checkTeacherlessStudentsNotAdded(before, after, { excludeDeskKeys: new Set([`${C}#1`]) })).toEqual([])
    const rested = facts([cell(D, 3, [desk('d1', [student(), null], { teacherRest: { teacher: '講師A' } }), desk('d2'), desk('d3')])])
    expect(checkTeacherlessStudentsNotAdded(before, rested)).toEqual([])
    // 前から講師なしの机に居た生徒は増えていない
    expect(checkTeacherlessStudentsNotAdded(after, after)).toEqual([])
    // 埋め草の講師は講師なし
    const placeholder = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師未割当' }), desk('d2'), desk('d3')])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, placeholder))).toEqual(['stop:teacherless-student-added'])
  })

  it('メモ・出欠記録が同じコマから消えたら stop。同じコマの別の机へ移ったのは所見なし', () => {
    const before = facts([cell(D, 3, [desk('d1', [null, null], { memoSlots: ['メモ', null], statusSlots: [status(), null] }), desk('d2')])])
    const movedWithin = facts([cell(D, 3, [desk('d1'), desk('d2', [null, null], { memoSlots: [null, 'メモ'], statusSlots: [null, status()] })])])
    expect(checkManualInputsNotLost(before, movedWithin)).toEqual([])
    // 保留の下段へ移ったのも盤面に残っている
    const toPending = facts([cell(D, 3, [desk('d1'), desk('d2')])], {
      board: { templatePendingDesks: pending('d1', { memoSlots: ['メモ', null], statusSlots: [status(), null] }) },
    })
    expect(checkManualInputsNotLost(before, toPending)).toEqual([])
    const lost = facts([cell(D, 3, [desk('d1'), desk('d2')])])
    const findings = checkManualInputsNotLost(before, lost)
    expect(codes(findings)).toEqual(['stop:manual-input-lost', 'stop:manual-input-lost'])
    expect(findings.every((finding) => finding.dateKey === D && finding.slotNumber === 3 && finding.deskIndex === 0)).toBe(true)
    expect(checkManualInputsNotLost(before, lost, { excludeDeskKeys: new Set([`${C}#0`]) })).toEqual([])
    // 別のコマへ行ったのは消えた扱い
    const otherCell = facts([cell(D, 3, [desk('d1'), desk('d2')]), cell(D, 4, [desk('d1', [null, null], { memoSlots: ['メモ', null], statusSlots: [status(), null] })])])
    expect(checkManualInputsNotLost(before, otherCell)).toHaveLength(2)
  })

  it('同じ状態: 1 机でも違えば指定の code で stop', () => {
    const before = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2')])])
    const same = facts([cell(D, 3, [desk('d1', [student({ origin: 'template', id: 'other' }), null], { teacher: '講師A' }), desk('d2')])])
    expect(checkSameState(before, same, 'reload-changed')).toEqual([])
    const changed = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2', [null, null], { memoSlots: ['メモ', null] })])])
    expect(codes(checkSameState(before, changed, 'undo-not-restored'))).toEqual(['stop:undo-not-restored'])
    expect(codes(checkSameState(before, changed, 'save-changed'))).toEqual(['stop:save-changed'])
    const sectionChanged = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2')])], { extra: { regularLessons: [{ id: 'r1' }] } })
    expect(codes(checkSameState(before, sectionChanged, 'redo-not-restored'))).toEqual(['stop:redo-not-restored'])
  })

  it('保証台帳: 新しい bug は stop・新しい check は info・前からある違反は所見なし', () => {
    const finding = (overrides) => ({ rule: 'INV-12', severity: 'bug', kind: 'duplicate-placement', studentId: 's1', dateKey: D, slotNumber: 3, deskIndex: 0, period: 'future', message: 'x', ...overrides })
    const before = { findings: [finding({})], counts: {}, notes: [] }
    const after = {
      findings: [
        finding({}),
        finding({ studentId: 's2' }),
        finding({ rule: 'INV-06', severity: 'check', kind: 'lecture-overconsumed', dateKey: undefined, slotNumber: undefined, deskIndex: undefined, subject: '数', sessionId: 'sp1' }),
      ],
      counts: {}, notes: [],
    }
    const findings = checkAuditNotWorse(before, after)
    expect(codes(findings)).toEqual(['stop:inv-new-violation', 'info:inv-new-check'])
    expect(findings[0]).toMatchObject({ studentId: 's2', dateKey: D, slotNumber: 3, deskIndex: 0 })
    expect(checkAuditNotWorse(before, before)).toEqual([])
  })

  it('保留の数: 「置き換え 24机・保留 2机」で実際が +2 なら所見なし・+3 なら stop・数が無い文は所見なし', () => {
    expect(parsePendingCountFromConfirm('11/19 以降に反映します（置き換え 24机・保留 2机）。')).toBe(2)
    expect(parsePendingCountFromConfirm('テンプレを保存しますか')).toBeNull()
    const withPending = (count) => facts([cell(D, 3, Array.from({ length: 4 }, (_, index) => desk(`d${index}`)))], {
      board: { templatePendingDesks: Object.assign({}, ...Array.from({ length: count }, (_, index) => pending(`d${index}`, { memoSlots: ['メモ', null] }))) },
    })
    const message = '11/19 以降に反映します（置き換え 24机・保留 2机）。'
    expect(checkPendingCountMatchesPreview(withPending(1), withPending(3), message)).toEqual([])
    expect(codes(checkPendingCountMatchesPreview(withPending(0), withPending(3), message))).toEqual(['stop:pending-count-mismatch'])
    expect(checkPendingCountMatchesPreview(withPending(0), withPending(3), '保存しました')).toEqual([])
  })

  it('既知: 書いた項目がすべて一致する所見だけ外す', () => {
    const findings = [
      { level: 'stop', code: 'manual-student-lost', message: 'a', dateKey: D, slotNumber: 3, studentId: 's1' },
      { level: 'stop', code: 'manual-student-lost', message: 'b', dateKey: D, slotNumber: 4, studentId: 's1' },
      { level: 'stop', code: 'teacherless-student-added', message: 'c', dateKey: D, slotNumber: 3, studentId: 's1' },
    ]
    const context = { classroomId: 'room1', step: 'template-save' }
    const result = applyKnownIssues(findings, [
      { code: 'manual-student-lost', classroomId: 'room1', step: 'template-save', dateKey: D, slotNumber: 3, studentId: 's1', note: '理由' },
      // 教室が違う
      { code: 'teacherless-student-added', classroomId: 'room2', dateKey: D, slotNumber: 3, studentId: 's1', note: '理由' },
      // 何も書いていない項目は全部に当たってしまうので使わない
      { note: '中身なし' },
    ], context)
    expect(result.knownCount).toBe(1)
    expect(result.findings.map((finding) => finding.message)).toEqual(['b', 'c'])
    // 手順が違えば外さない
    expect(applyKnownIssues(findings, [{ code: 'manual-student-lost', step: 'move' }], context).knownCount).toBe(0)
  })

  it('変わったことのまとめは info 1 件(机の数・項目ごとの数)', () => {
    const before = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2')])])
    const after = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師B' }), desk('d2', [student(), null], { memoSlots: ['メモ', null] })])])
    const findings = summarizeChanges(before, after)
    expect(codes(findings)).toEqual(['info:change-summary'])
    expect(findings[0].message).toContain('2 机')
    expect(findings[0].message).toContain('講師 1')
    expect(findings[0].message).toContain('生徒 2')
    expect(findings[0].message).toContain('メモ 1')
  })
})
