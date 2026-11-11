// tools/ui-patrol/checks.ts(画面の自動巡回の操作のたびの点検)を固定する。決まりは docs/test-strategy.md「操作のたびの点検」と
// docs/plan-2026-11-11-ui-patrol.md の Task 3。フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・講師A・講師B)。
// 一番大事なのは 2026-11-10 の事故の形(テンプレ保存で手入力の振替の生徒が講師の机から講師のいない机へ移った)を止められること。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import {
  PATROL_FINDING_CODES,
  applyKnownIssues,
  checkAttendanceApplied,
  checkAttendanceRecordsHold,
  checkAuditNotWorse,
  checkAutoAssignApplied,
  collectAutoAssignPlacements,
  parseAutoAssignAnnouncedCounts,
  checkHolidayApplied,
  checkHolidayRoundTrip,
  checkManualInputsNotLost,
  checkManualStudentsKeepTeacher,
  checkOutsideAllowedRange,
  checkPendingCountMatchesPreview,
  checkSameState,
  checkStockDeltas,
  checkTeacherlessStudentsNotAdded,
  checkTemplateEditApplied,
  checkTemplateEditSaved,
  checkTeacherCellIntegrity,
  checkTeacherOpApplied,
  checkWholeDayTransferApplied,
  parseAnnouncedOrphanedMakeupCount,
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
  expect(PATROL_FINDING_CODES).toContain('orphaned-makeup-removed-announced')
  expect(PATROL_FINDING_CODES).toContain('teacherless-student-by-template')
  expect(PATROL_FINDING_CODES).toContain('teacherless-student-at-deleted-teacher-desk')
  // 台本 d(テンプレを実際に変えて保存): 起きるはずの変化が起きない(stop)・保存したテンプレに変更が無い(stop)・規則で置かれない(info)
  expect(PATROL_FINDING_CODES).toContain('template-edit-not-applied')
  expect(PATROL_FINDING_CODES).toContain('template-edit-not-saved')
  expect(PATROL_FINDING_CODES).toContain('template-edit-held-by-rule')
  // 台本 e(出欠・2026-11-11 第 2 段の 2 本目)
  for (const code of ['stock-delta-mismatch', 'attendance-not-applied', 'attendance-blocked', 'attendance-record-overridden']) expect(PATROL_FINDING_CODES).toContain(code)
  // 台本 f(講師の移動・入れ替え・休み・2026-11-11 第 2 段の 3 本目)と講師のコマの点検
  for (const code of ['teacher-rested-but-present', 'teacher-duplicated-in-cell', 'teacher-cell-anomaly-existing', 'teacher-op-not-applied', 'teacher-op-blocked']) expect(PATROL_FINDING_CODES).toContain(code)
  // 台本 g(休日設定と解除・丸ごと振替・2026-11-11 第 2 段の 4 本目)の 4 つ
  // 台本 h(講習の自動割振・2026-11-11 第 2 段の 5 本目)の 5 つ
  for (const code of ['auto-assign-outside-placement', 'auto-assign-rule-violated', 'auto-assign-count-mismatch', 'auto-assign-blocked', 'auto-assign-rerun-changed']) expect(PATROL_FINDING_CODES).toContain(code)
  expect(PATROL_FINDING_CODES).toHaveLength(46)
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

  it('下段にいた手入力の生徒: 上段にも下段にも無ければ stop。下段のまま・上段の席へは stop にしない', () => {
    const lowerA = (deskId = 'd1') => pending(deskId, { lesson: { id: 'LP', studentSlots: [makeupA(), null] } })
    const before = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])], { board: { templatePendingDesks: lowerA() } })
    const gone = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])])
    const findings = checkManualStudentsKeepTeacher(before, gone)
    expect(codes(findings)).toEqual(['stop:manual-student-lost'])
    expect(findings[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 0, studentId: 's1' })
    const stays = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])], { board: { templatePendingDesks: lowerA('d2') } })
    expect(checkManualStudentsKeepTeacher(before, stays)).toEqual([])
    const adopted = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' }), desk('d2', [makeupA(), null], { teacher: '講師B' })])])
    expect(checkManualStudentsKeepTeacher(before, adopted)).toEqual([])
  })

  it('前から下段にいる生徒と同じ生徒が上段から消えたら、下段の数で info に下げずに stop', () => {
    const lower = pending('d2', { lesson: { id: 'LP', studentSlots: [makeupA({ id: 'e9' }), null] } })
    const before = facts([cell(D, 3, [desk('d1', [makeupA(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])], { board: { templatePendingDesks: lower } })
    const after = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])], { board: { templatePendingDesks: lower } })
    expect(codes(checkManualStudentsKeepTeacher(before, after))).toEqual(['stop:manual-student-lost'])
  })

  it('確認の文の名前は、名前の直後が数字でないときだけ「出ている」', () => {
    const p09 = makeupA({ name: '生徒09' })
    const p092 = makeupA({ name: '生徒092', managedStudentId: 's092' })
    const before = facts([cell(D, 3, [desk('d1', [p09, p092], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])])
    const after = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [p09, p092], { teacher: '講師B' })])])
    const findings = checkManualStudentsKeepTeacher(before, after, { announcedText: '講師B の机へ 生徒092 を移します' })
    expect(findings.map((finding) => [finding.studentId, finding.code])).toEqual([
      ['s1', 'manual-student-teacher-changed'],
      ['s092', 'manual-student-teacher-changed-announced'],
    ])
    // 文の終わりでも「出ている」
    expect(codes(checkManualStudentsKeepTeacher(before, after, { announcedText: '移す生徒: 生徒09' })).sort()).toEqual(['info:manual-student-teacher-changed-announced', 'stop:manual-student-teacher-changed'])
  })

  it('テンプレの生徒は見ない(講師が変わっても所見なし)', () => {
    const before = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師A' })])])
    const after = facts([cell(D, 3, [desk('d1', [student(), null], { teacher: '講師B' })])])
    expect(checkManualStudentsKeepTeacher(before, after)).toEqual([])
  })
})

describe('根拠を失った振替を消す(spec-template-conflict-v2 §9-12・Q40-1)', () => {
  // 休日設定の日の授業の振替を別の日へ置いた後、テンプレでその授業が無くなったら、テンプレ保存がその振替と振替元の「移)」の記録を消す(仕様どおり)。
  // 確認の画面は件数を「テンプレから外した生徒の振替n件を消します」と出す(templateDiffApply.ts の buildTemplateDiffConfirmDetail)。
  // 名前は「ほか n 件」に畳まれることがあるので、件数の範囲で、消えた手入力の「振替」とその振替元の「移動」の記録だけを info に下げる。
  const H = '2026-11-20' // 振替元(休日)
  const HC = `${H}_4`
  const movedRecord = status({ status: 'moved', dateKey: H, slotNumber: 4 })
  const before = facts([
    cell(H, 4, [desk('h1', [null, null], { statusSlots: [movedRecord, null] })]),
    cell(D, 3, [desk('d1', [makeupA({ makeupSourceDate: H }), studentB({ lessonType: 'makeup', makeupSourceDate: H })], { teacher: '講師A' })]),
  ])
  const after = facts([cell(H, 4, [desk('h1')]), cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' })])])

  it('件数を読む(無ければ 0)', () => {
    expect(parseAnnouncedOrphanedMakeupCount('丸ごと…\nテンプレから外した生徒の振替2件を消します（振替元の授業が無くなるため）。')).toBe(2)
    expect(parseAnnouncedOrphanedMakeupCount('テンプレの中身に変更はありません。')).toBe(0)
    expect(parseAnnouncedOrphanedMakeupCount(undefined)).toBe(0)
  })

  it('確認の画面の件数の範囲だけ、消えた手入力の振替を info に下げる。件数を越えた分・件数が無いときは stop のまま', () => {
    expect(codes(checkManualStudentsKeepTeacher(before, after))).toEqual(['stop:manual-student-lost', 'stop:manual-student-lost'])
    const one = checkManualStudentsKeepTeacher(before, after, { announcedOrphanedMakeupCount: 1 })
    // 下げた所見には科目を載せる(振替元の「移動」の記録を 生徒キー|科目 で引くため)
    expect(one.find((finding) => finding.level === 'info')).toMatchObject({ studentId: 's1', subject: '数' })
    expect(codes(one).sort()).toEqual(['info:orphaned-makeup-removed-announced', 'stop:manual-student-lost'])
    expect(codes(checkManualStudentsKeepTeacher(before, after, { announcedOrphanedMakeupCount: 2 }))).toEqual(['info:orphaned-makeup-removed-announced', 'info:orphaned-makeup-removed-announced'])
  })

  it('振替でない手入力の生徒は件数があっても stop のまま', () => {
    const regularBefore = facts([cell(D, 3, [desk('d1', [student({ manualAdded: true }), null], { teacher: '講師A' })])])
    const regularAfter = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' })])])
    expect(codes(checkManualStudentsKeepTeacher(regularBefore, regularAfter, { announcedOrphanedMakeupCount: 3 }))).toEqual(['stop:manual-student-lost'])
  })

  it('振替元の「移動」の記録は、消えた振替の生徒の分だけ info に下げる(ほかの記録は stop のまま)', () => {
    expect(codes(checkManualInputsNotLost(before, after))).toEqual(['stop:manual-input-lost'])
    expect(codes(checkManualInputsNotLost(before, after, { releasedMovedStatuses: ['s1|数'] }))).toEqual(['info:orphaned-makeup-removed-announced'])
    expect(codes(checkManualInputsNotLost(before, after, { releasedMovedStatuses: ['s2|数'] }))).toEqual(['stop:manual-input-lost'])
    // 同じ生徒の別の科目の「移動」は下げない(鍵は 生徒キー|科目)
    expect(codes(checkManualInputsNotLost(before, after, { releasedMovedStatuses: ['s1|英'] }))).toEqual(['stop:manual-input-lost'])
    // 件数は消えた振替の数まで(同じ生徒×科目の「移動」が 2 件消えて、振替が 1 件なら 1 件は stop)
    const twoMoved = facts([cell(H, 4, [desk('h1', [null, null], { statusSlots: [movedRecord, null] }), desk('h2', [null, null], { statusSlots: [movedRecord, null] })])])
    expect(codes(checkManualInputsNotLost(twoMoved, facts([cell(H, 4, [desk('h1'), desk('h2')])]), { releasedMovedStatuses: ['s1|数'] })).sort()).toEqual(['info:orphaned-makeup-removed-announced', 'stop:manual-input-lost'])
    // 休みの記録は下げない(根拠を失った振替で消えてよいのは「移)」の印だけ)
    const absentBefore = facts([cell(H, 4, [desk('h1', [null, null], { statusSlots: [status({ dateKey: H, slotNumber: 4 }), null] })])])
    expect(codes(checkManualInputsNotLost(absentBefore, facts([cell(H, 4, [desk('h1')])]), { releasedMovedStatuses: ['s1|数'] }))).toEqual(['stop:manual-input-lost'])
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

  it('テンプレ自体が講師なしの授業(曜日|時限|生徒キー)は info teacherless-student-by-template。反映日より前・ほかの生徒は stop', () => {
    const before = facts([cell(D, 3, [desk('d1'), desk('d2')])])
    const after = facts([cell(D, 3, [desk('d1', [student(), studentB()]), desk('d2')])])
    const templateTeacherless = { keys: new Set(['4|3|s1']), fromDateKey: '2026-11-16' }
    expect(codes(checkTeacherlessStudentsNotAdded(before, after, { templateTeacherless }))).toEqual(['info:teacherless-student-by-template', 'stop:teacherless-student-added'])
    expect(codes(checkTeacherlessStudentsNotAdded(before, after, { templateTeacherless: { keys: new Set(['4|3|s1']), fromDateKey: '2026-11-20' } }))).toEqual(['stop:teacherless-student-added', 'stop:teacherless-student-added'])
    expect(codes(checkTeacherlessStudentsNotAdded(before, after, { templateTeacherless: { keys: new Set(['3|3|s1']), fromDateKey: '' } }))).toEqual(['stop:teacherless-student-added', 'stop:teacherless-student-added'])
  })

  it('操作の前後とも講師を消した記録の机にテンプレの生徒が置かれたら info。手入力の生徒・消した記録の無い机・操作が記録を作った机は stop(Issue #85)', () => {
    const deleted = { teacherAssignmentSource: 'deleted' }
    // 操作の前から、机2 に講師を消した記録がある(室長が消した)。
    const before = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], deleted), desk('d3')])])
    const templateAfter = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [student({ origin: 'template' }), null], deleted), desk('d3')])])
    const findings = checkTeacherlessStudentsNotAdded(before, templateAfter)
    expect(codes(findings)).toEqual(['info:teacherless-student-at-deleted-teacher-desk'])
    expect(findings[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 1, studentId: 's1' })
    expect(findings[0].message).toBe('講師を消した机にテンプレの生徒が置かれた(仕様どおり): 11/19(木) 3限 机2 生徒A(s1) 数 通常')
    // 講師を消した机 + 手入力の生徒(振替) → stop
    const manualAfter = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [makeupA(), null], deleted), desk('d3')])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, manualAfter))).toEqual(['stop:teacherless-student-added'])
    // 消した記録の無い講師なしの机 + テンプレ由来の生徒 → stop
    const plainAfter = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [student({ origin: 'template' }), null]), desk('d3')])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, plainAfter))).toEqual(['stop:teacherless-student-added'])
    // 操作の前には削除記録が無かった(操作そのものが記録を作った)なら、後で記録があっても stop
    const noRecordBefore = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2'), desk('d3')])])
    expect(codes(checkTeacherlessStudentsNotAdded(noRecordBefore, templateAfter))).toEqual(['stop:teacherless-student-added'])
    // 同じ机に 2 人: テンプレは info・手入力は stop(生徒ごとに分ける)
    const mixedAfter = facts([cell(D, 3, [desk('d1'), desk('d2', [student({ origin: 'template' }), studentB({ lessonType: 'makeup', makeupSourceDate: '2026-11-12' })], deleted), desk('d3')])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, mixedAfter))).toEqual(['info:teacherless-student-at-deleted-teacher-desk', 'stop:teacherless-student-added'])
  })

  it('削除記録の判定はコマ単位: 机の並べ直しで記録ごと別の机の番号へ動いても info。操作が記録を増やしたら stop', () => {
    const deleted = { teacherAssignmentSource: 'deleted' }
    // 前: 机3 が削除記録。後: 並べ直しで机1 が削除記録(数は 1 → 1)で、テンプレの生徒が座る
    const before = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' }), desk('d3', [null, null], deleted)])])
    const moved = facts([cell(D, 3, [desk('d1', [student({ origin: 'template' }), null], deleted), desk('d2', [null, null], { teacher: '講師A' }), desk('d3', [null, null], { teacher: '講師B' })])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, moved))).toEqual(['info:teacherless-student-at-deleted-teacher-desk'])
    // 2 → 1 に減ったのも増えていない
    const twoBefore = facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], deleted), desk('d3', [null, null], deleted)])])
    expect(codes(checkTeacherlessStudentsNotAdded(twoBefore, moved))).toEqual(['info:teacherless-student-at-deleted-teacher-desk'])
    // 1 → 2 に増えた(操作が削除記録を作った)なら stop
    const grown = facts([cell(D, 3, [desk('d1', [student({ origin: 'template' }), null], deleted), desk('d2', [null, null], deleted), desk('d3', [null, null], { teacher: '講師B' })])])
    expect(codes(checkTeacherlessStudentsNotAdded(before, grown))).toEqual(['stop:teacherless-student-added'])
    // 別のコマに前から削除記録があっても、このコマで増えたなら stop
    const otherCell = facts([cell(D, 4, [desk('x1', [null, null], deleted)]), cell(D, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2')])])
    const otherAfter = facts([cell(D, 4, [desk('x1', [null, null], deleted)]), cell(D, 3, [desk('d1', [student({ origin: 'template' }), null], deleted), desk('d2')])])
    expect(codes(checkTeacherlessStudentsNotAdded(otherCell, otherAfter))).toEqual(['stop:teacherless-student-added'])
  })

  it('テンプレ自体が講師なし(templateTeacherless)にも当たる机は teacherless-student-by-template を優先。前から居た生徒・除外の机は出さない', () => {
    const deleted = { teacherAssignmentSource: 'deleted' }
    const before = facts([cell(D, 3, [desk('d1'), desk('d2', [null, null], deleted)])])
    const after = facts([cell(D, 3, [desk('d1'), desk('d2', [student({ origin: 'template' }), null], deleted)])])
    const templateTeacherless = { keys: new Set(['4|3|s1']), fromDateKey: '2026-11-16' }
    expect(codes(checkTeacherlessStudentsNotAdded(before, after, { templateTeacherless }))).toEqual(['info:teacherless-student-by-template'])
    expect(codes(checkTeacherlessStudentsNotAdded(before, after))).toEqual(['info:teacherless-student-at-deleted-teacher-desk'])
    expect(checkTeacherlessStudentsNotAdded(after, after)).toEqual([])
    expect(checkTeacherlessStudentsNotAdded(before, after, { excludeDeskKeys: new Set([`${C}#1`]) })).toEqual([])
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

  it('同じ状態: 盤面の週に無い机の保留が消えた・休みの講師が替わったら stop', () => {
    const orphan = { 'gone_cell::dZ': { lower: { memoSlots: ['メモ', null] }, effectiveStartDate: D, createdAt: '2026-11-10T00:00:00.000Z' } }
    const before = facts([cell(D, 3, [desk('d1')])], { board: { templatePendingDesks: orphan } })
    expect(checkSameState(before, facts([cell(D, 3, [desk('d1')])], { board: { templatePendingDesks: orphan } }), 'reload-changed')).toEqual([])
    expect(codes(checkSameState(before, facts([cell(D, 3, [desk('d1')])]), 'reload-changed'))).toEqual(['stop:reload-changed'])
    const rest = (teacher) => facts([cell(D, 3, [desk('d1', [student(), null], { teacherRest: { teacher } })])])
    expect(checkSameState(rest('講師A'), rest('講師A'), 'undo-not-restored')).toEqual([])
    expect(codes(checkSameState(rest('講師A'), rest('講師B'), 'undo-not-restored'))).toEqual(['stop:undo-not-restored'])
  })

  it('保証台帳: 同じ違反が机番号だけ変わったのは所見なし。同じ鍵が 1 件 → 2 件は stop 1 件', () => {
    const finding = (overrides) => ({ rule: 'INV-12', severity: 'bug', kind: 'duplicate-placement', studentId: 's1', dateKey: D, slotNumber: 3, deskIndex: 0, period: 'future', message: 'x', ...overrides })
    const before = { findings: [finding({})], counts: {}, notes: [] }
    expect(checkAuditNotWorse(before, { findings: [finding({ deskIndex: 4 })], counts: {}, notes: [] })).toEqual([])
    const doubled = checkAuditNotWorse(before, { findings: [finding({ deskIndex: 4 }), finding({ deskIndex: 5 })], counts: {}, notes: [] })
    expect(codes(doubled)).toEqual(['stop:inv-new-violation'])
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

  it('反映日を渡したとき: 確認の画面の数は「反映日以降の開いている日のコマで、保存のあと保留の机」(templateConflictRules.ts の summary.pending)と等しい', () => {
    // 台本 d(2026-11-11・日大前の形): 前に 30 机の保留(反映日より前 2・以降 28)。保存のあとも 30(以降 28)。確認の画面「保留 28机」。
    const FROM = '2026-11-16'
    const pendingAt = (dateKey, deskId) => ({ [`${dateKey}_3::${deskId}`]: { lower: { memoSlots: ['メモ', null] }, effectiveStartDate: FROM, createdAt: '2026-11-10T00:00:00.000Z' } })
    const board = ({ early, later, holiday = 0 }) => {
      const cells = [
        cell('2026-11-09', 3, Array.from({ length: early }, (_, index) => desk(`e${index}`))),
        cell('2026-11-19', 3, Array.from({ length: later }, (_, index) => desk(`l${index}`))),
        { ...cell('2026-11-23', 3, Array.from({ length: holiday }, (_, index) => desk(`h${index}`))), isOpenDay: false },
      ]
      const map = Object.assign({},
        ...Array.from({ length: early }, (_, index) => pendingAt('2026-11-09', `e${index}`)),
        ...Array.from({ length: later }, (_, index) => pendingAt('2026-11-19', `l${index}`)),
        ...Array.from({ length: holiday }, (_, index) => pendingAt('2026-11-23', `h${index}`)))
      return facts([...cells], { board: { templatePendingDesks: map } })
    }
    const message = (count) => `11/16 以降に反映します（置き換え 17机・保留 ${count}机）。`
    const before = board({ early: 2, later: 28 })
    expect(checkPendingCountMatchesPreview(before, board({ early: 2, later: 28 }), message(28), { fromDateKey: FROM })).toEqual([])
    // n が少なく出る誤り(範囲〔増えた数 0 ≦ 26 ≦ 総数 30〕なら通ってしまう形)は stop
    expect(codes(checkPendingCountMatchesPreview(before, board({ early: 2, later: 28 }), message(26), { fromDateKey: FROM }))).toEqual(['stop:pending-count-mismatch'])
    // 反映日より前の保留を含めた総数(30)を言ったのも stop
    expect(codes(checkPendingCountMatchesPreview(before, board({ early: 2, later: 28 }), message(30), { fromDateKey: FROM }))).toEqual(['stop:pending-count-mismatch'])
    // 休日のコマの保留はアプリが数えない(applyCell が休日を飛ばす)
    expect(checkPendingCountMatchesPreview(before, board({ early: 2, later: 28, holiday: 3 }), message(28), { fromDateKey: FROM })).toEqual([])
    // 文に数が無ければ所見なし
    expect(checkPendingCountMatchesPreview(before, board({ early: 2, later: 1 }), '保存しました', { fromDateKey: FROM })).toEqual([])
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

describe('テンプレを変えて保存したとき、起きるはずの変化が起きたか(台本 d)', () => {
  // 11/19(木) 3限 と 11/26(木) 3限 が確かめる日。机 1 は講師A(テンプレ)・生徒A(テンプレ)。
  const D2 = '2026-11-26'
  const tplA = (overrides = {}) => student({ origin: 'template', ...overrides })
  const tplB = (overrides = {}) => studentB({ origin: 'template', ...overrides })
  const base = (dateKey = D) => cell(dateKey, 3, [desk('d1', [tplA(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' }), desk('d3')])
  const edit = (overrides) => ({ dayOfWeek: 4, slotNumber: 3, deskIndex: 0, teacher: '講師A', teacherId: 't1', studentKeys: [], anchorCellIds: [C, `${D2}_3`], ...overrides })

  it('生徒を足す: 確かめる日のコマ(上段か保留の下段)に居れば所見なし。居なければ stop(日ごとに 1 件)', () => {
    const before = facts([base(), base(D2)])
    const added = (dateKey) => cell(dateKey, 3, [desk('d1', [tplA(), tplB()], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' }), desk('d3')])
    const addEdit = edit({ kind: 'add-student', seat: 1, studentKeys: ['s2'] })
    expect(checkTemplateEditApplied(before, facts([added(D), added(D2)]), addEdit)).toEqual([])
    const findings = checkTemplateEditApplied(before, facts([added(D), base(D2)]), addEdit)
    expect(codes(findings)).toEqual(['stop:template-edit-not-applied'])
    expect(findings[0]).toMatchObject({ dateKey: D2, slotNumber: 3, studentId: 's2' })
    expect(findings[0].message).toContain('11/26(木) 3限')
  })

  it('生徒を足す: 規則で置かれない日は info(手入力の同じ生徒が先にある・その生徒の出欠記録がある・在籍していない日)', () => {
    const addEdit = edit({ kind: 'add-student', seat: 1, studentKeys: ['s2'] })
    // 手入力の同じ生徒が同じコマの別の机に居る(§2-2): 前にも後にも居るので「居る」で所見なし
    const manualThere = (dateKey) => cell(dateKey, 3, [desk('d1', [tplA(), null], { teacher: '講師A' }), desk('d2', [studentB({ origin: 'manual', lessonType: 'makeup', makeupSourceDate: '2026-11-05' }), null], { teacher: '講師B' }), desk('d3')])
    expect(checkTemplateEditApplied(facts([manualThere(D), base(D2)]), facts([manualThere(D), base(D2)]), { ...addEdit, anchorCellIds: [C] })).toEqual([])
    // 出欠記録(休み)が勝つ(§2-4)
    const rested = cell(D, 3, [desk('d1', [tplA(), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B', statusSlots: [status({ managedStudentId: 's2', name: '生徒B', studentId: 'e2' }), null] }), desk('d3')])
    const held = checkTemplateEditApplied(facts([rested]), facts([rested]), { ...addEdit, anchorCellIds: [C] })
    expect(codes(held)).toEqual(['info:template-edit-held-by-rule'])
    expect(held[0].message).toContain('出欠記録')
    // 在籍していない日
    const inactive = checkTemplateEditApplied(facts([base()]), facts([base()]), { ...addEdit, anchorCellIds: [C] }, { isStudentActiveOnDate: () => false })
    expect(codes(inactive)).toEqual(['info:template-edit-held-by-rule'])
    expect(inactive[0].message).toContain('在籍')
    // そのコマのその日に、その生徒の通常授業の削除記録(抑止キー・科目は問わない)がある → 置かないのが仕様(§1-1 #10)
    const suppressed = checkTemplateEditApplied(facts([base()]), facts([base()]), { ...addEdit, anchorCellIds: [C] }, { suppressedOccurrences: [`s2__英__${D}__3`, `s2__英__${D}__4`] })
    expect(codes(suppressed)).toEqual(['info:template-edit-held-by-rule'])
    expect(suppressed[0].message).toContain('削除')
    // 別の時限・別の生徒の削除記録では下げない
    expect(codes(checkTemplateEditApplied(facts([base()]), facts([base()]), { ...addEdit, anchorCellIds: [C] }, { suppressedOccurrences: [`s2__英__${D}__4`, `s9__英__${D}__3`] }))).toEqual(['stop:template-edit-not-applied'])
  })

  it('講師を替える: 確かめる日のコマに新しい講師が居れば所見なし。居ない日・前の講師がテンプレのまま残った日は stop', () => {
    const before = facts([base(), base(D2)])
    const changed = (dateKey, teacher = '講師C') => cell(dateKey, 3, [desk('d1', [tplA(), null], { teacher }), desk('d2', [null, null], { teacher: '講師B' }), desk('d3')])
    const changeEdit = edit({ kind: 'change-teacher', newTeacher: '講師C', newTeacherId: 't3', studentKeys: ['s1'] })
    expect(checkTemplateEditApplied(before, facts([changed(D), changed(D2)]), changeEdit)).toEqual([])
    const findings = checkTemplateEditApplied(before, facts([changed(D), base(D2)]), changeEdit)
    expect(codes(findings)).toEqual(['stop:template-edit-not-applied', 'stop:template-edit-not-applied'])
    expect(findings.map((finding) => finding.dateKey)).toEqual([D2, D2])
    expect(findings[0].message).toContain('講師C')
    expect(findings[1].message).toContain('講師A')
    // 新しい講師がそのコマで休み(§2-4)なら info。前の講師が手置き(青字)で残るのは手入力なので所見なし。
    const restedNew = cell(D, 3, [desk('d1', [tplA(), null], { teacher: '' }), desk('d2', [null, null], { teacher: '講師B', teacherRest: { teacher: '講師C', teacherId: 't3', origin: 'manual' } }), desk('d3', [null, null], { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' })])
    const held = checkTemplateEditApplied(facts([restedNew]), facts([restedNew]), { ...changeEdit, anchorCellIds: [C] })
    expect(codes(held)).toEqual(['info:template-edit-held-by-rule'])
    expect(held[0].message).toContain('休み')
  })

  it('机を消す: 消した机の講師・生徒がテンプレ由来で残ったら stop。手入力で残るのは所見なし', () => {
    const before = facts([base(), base(D2)])
    const emptied = (dateKey) => cell(dateKey, 3, [desk('d1'), desk('d2', [null, null], { teacher: '講師B' }), desk('d3')])
    const deleteEdit = edit({ kind: 'delete-desk', studentKeys: ['s1'] })
    expect(checkTemplateEditApplied(before, facts([emptied(D), emptied(D2)]), deleteEdit)).toEqual([])
    const findings = checkTemplateEditApplied(before, facts([emptied(D), base(D2)]), deleteEdit)
    expect(codes(findings)).toEqual(['stop:template-edit-not-applied', 'stop:template-edit-not-applied'])
    expect(findings.map((finding) => finding.studentId ?? '')).toEqual(['', 's1'])
    const manualLeft = cell(D, 3, [desk('d1', [student({ origin: 'manual' }), null], { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' }), desk('d2', [null, null], { teacher: '講師B' }), desk('d3')])
    expect(checkTemplateEditApplied(facts([base()]), facts([manualLeft]), { ...deleteEdit, anchorCellIds: [C] })).toEqual([])
  })

  it('保存したテンプレにその変更が入っているか(入っていなければ stop template-edit-not-saved)', () => {
    const template = (deskOverrides) => ({ effectiveStartDate: '2026-11-16', cells: [{ dayOfWeek: 4, slotNumber: 3, desks: [{ deskIndex: 1, teacherId: 't1', students: [{ studentId: 's1', subject: '数' }, null], ...deskOverrides }] }] })
    const addEdit = edit({ kind: 'add-student', seat: 1, studentKeys: ['s2'] })
    expect(checkTemplateEditSaved(template({ students: [{ studentId: 's1', subject: '数' }, { studentId: 's2', subject: '英' }] }), addEdit)).toEqual([])
    expect(codes(checkTemplateEditSaved(template({}), addEdit))).toEqual(['stop:template-edit-not-saved'])
    const changeEdit = edit({ kind: 'change-teacher', newTeacher: '講師C', newTeacherId: 't3', studentKeys: ['s1'] })
    expect(checkTemplateEditSaved(template({ teacherId: 't3' }), changeEdit)).toEqual([])
    expect(codes(checkTemplateEditSaved(template({}), changeEdit))).toEqual(['stop:template-edit-not-saved'])
    const deleteEdit = edit({ kind: 'delete-desk', studentKeys: ['s1'] })
    expect(checkTemplateEditSaved(template({ teacherId: '', students: [null, null] }), deleteEdit)).toEqual([])
    // 机ごと無い(空の机は省かれうる)のも「消えた」
    expect(checkTemplateEditSaved({ effectiveStartDate: '2026-11-16', cells: [] }, deleteEdit)).toEqual([])
    expect(codes(checkTemplateEditSaved(template({ students: [null, null] }), deleteEdit))).toEqual(['stop:template-edit-not-saved'])
    expect(codes(checkTemplateEditSaved(null, addEdit))).toEqual(['stop:template-edit-not-saved'])
  })
})

// ── 台本 e(出欠): 在庫の増減・出欠記録が付いたか・テンプレ保存が出欠記録のコマに生徒を置き直さないか(§2-4 記録が勝つ)
describe('台本 e の点検', () => {
  const codes = (findings) => findings.map((finding) => `${finding.level}:${finding.code}`)
  const facts = (cells, board) => collectBoardFacts(payload(cells, { board }))
  const D = '2026-11-19'

  it('在庫の増減: 仕様の増減(休み +1 など)と合えば所見なし。合わない鍵・仕様に無い鍵の増減は stop stock-delta-mismatch(生徒 ID と科目と数)', () => {
    const before = { makeup: { 's1__数': 1, 's2__英': 2 }, lecture: { 'L1': 3 } }
    expect(checkStockDeltas(before, { makeup: { 's1__数': 2, 's2__英': 2 }, lecture: { 'L1': 3 } }, { makeup: { 's1__数': 1 } })).toEqual([])
    // 休みなのに増えない
    const notIncreased = checkStockDeltas(before, before, { makeup: { 's1__数': 1 } })
    expect(codes(notIncreased)).toEqual(['stop:stock-delta-mismatch'])
    expect(notIncreased[0].message).toContain('s1 数')
    expect(notIncreased[0].message).toContain('+1')
    expect(notIncreased[0].studentId).toBe('s1')
    // 2 増える
    expect(codes(checkStockDeltas(before, { ...before, makeup: { ...before.makeup, 's1__数': 3 } }, { makeup: { 's1__数': 1 } }))).toEqual(['stop:stock-delta-mismatch'])
    // ほかの生徒の在庫が動いた(残 0 になって行が消えたのも -2)・講習の残が動いた
    expect(codes(checkStockDeltas(before, { makeup: { 's1__数': 2 }, lecture: { 'L1': 2 } }, { makeup: { 's1__数': 1 } }))).toEqual(['stop:stock-delta-mismatch', 'stop:stock-delta-mismatch'])
    // 元に戻す・読み込み直しの点検にも使う(増減 0 が仕様・コードを指定できる)
    expect(codes(checkStockDeltas(before, { ...before, makeup: { 's1__数': 2, 's2__英': 2 } }, {}, { code: 'undo-not-restored', label: '元に戻すで操作前に戻らない' }))).toEqual(['stop:undo-not-restored'])
  })

  it('出欠記録が付いたか: 席から外れ、その机にその生徒のその記録が増えていれば所見なし。付かない・席に残ったは stop attendance-not-applied', () => {
    const op = { kind: 'mark', status: 'absent', seat: { cellId: `${D}_3`, deskIndex: 0, seat: 0 }, studentKey: 's1', subject: '数', lessonType: 'regular' }
    const before = facts([cell(D, 3, [desk('d1', [student(), studentB()], { teacher: '講師A' })])])
    const marked = facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師A', statusSlots: [status({ dateKey: D }), null] })])])
    expect(checkAttendanceApplied(before, marked, op)).toEqual([])
    // 記録の種類が違う(振無休を押したのに休み)
    expect(codes(checkAttendanceApplied(before, marked, { ...op, status: 'absent-no-makeup' }))).toEqual(['stop:attendance-not-applied'])
    // 記録が付かない(生徒だけ消えた)
    expect(codes(checkAttendanceApplied(before, facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師A' })])]), op))).toEqual(['stop:attendance-not-applied'])
    // 記録は付いたが生徒が席に残った
    expect(codes(checkAttendanceApplied(before, facts([cell(D, 3, [desk('d1', [student(), studentB()], { teacher: '講師A', statusSlots: [status({ dateKey: D }), null] })])]), op))).toEqual(['stop:attendance-not-applied'])
  })

  it('操作した机でも、ほかの席の生徒・講師・メモ・保留の下段が変わったら stop outside-allowed-range(机の中の巻き込み)', () => {
    const op = { kind: 'mark', status: 'absent', seat: { cellId: `${D}_3`, deskIndex: 0, seat: 0 }, studentKey: 's1', subject: '数', lessonType: 'regular' }
    const before = facts([cell(D, 3, [desk('d1', [student(), studentB()], { teacher: '講師A' })])])
    const record = { statusSlots: [status({ dateKey: D }), null] }
    // 隣の生徒が消えた
    expect(codes(checkAttendanceApplied(before, facts([cell(D, 3, [desk('d1', [null, null], { teacher: '講師A', ...record })])]), op))).toEqual(['stop:outside-allowed-range'])
    // 講師が変わった
    expect(codes(checkAttendanceApplied(before, facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師B', ...record })])]), op))).toEqual(['stop:outside-allowed-range'])
    // 振替先へ置く: 先の机の講師・隣の席・記録は変わらない
    const place = { kind: 'place', to: { cellId: `${D}_3`, deskIndex: 0, seat: 1 }, studentKey: 's1', subject: '数' }
    const target = facts([cell(D, 3, [desk('d1', [studentB(), null], { teacher: '講師A' })])])
    expect(checkAttendanceApplied(target, facts([cell(D, 3, [desk('d1', [studentB(), makeupA()], { teacher: '講師A' })])]), place)).toEqual([])
    expect(codes(checkAttendanceApplied(target, facts([cell(D, 3, [desk('d1', [null, makeupA()], { teacher: '講師A' })])]), place))).toEqual(['stop:outside-allowed-range'])
  })

  it('振替先へ置いたか: 先の席にその生徒の振替(同じ科目)が座っていれば所見なし。いない・別の種類は stop attendance-not-applied', () => {
    const op = { kind: 'place', to: { cellId: `${D}_4`, deskIndex: 1, seat: 0 }, studentKey: 's1', subject: '数' }
    const before = facts([cell(D, 4, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })])])
    const placed = facts([cell(D, 4, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [makeupA(), null], { teacher: '講師B' })])])
    expect(checkAttendanceApplied(before, placed, op)).toEqual([])
    expect(codes(checkAttendanceApplied(before, before, op))).toEqual(['stop:attendance-not-applied'])
    expect(codes(checkAttendanceApplied(before, facts([cell(D, 4, [desk('d1'), desk('d2', [student(), null], { teacher: '講師B' })])]), op))).toEqual(['stop:attendance-not-applied'])
  })

  it('記録が勝つ(§2-4): 前に出欠記録があり席にいなかった生徒が、操作のあと同じコマの席に座ったら stop attendance-record-overridden。反映日より前・休日の表示の記録・前から座っていた生徒は見ない', () => {
    const recorded = (kind) => facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師A', statusSlots: [status({ dateKey: D, status: kind }), null] }), desk('d2', [null, null], { teacher: '講師B' })])])
    const replaced = facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師A', statusSlots: [status({ dateKey: D }), null] }), desk('d2', [student({ origin: 'template' }), null], { teacher: '講師B' })])])
    for (const kind of ['absent', 'absent-no-makeup', 'attended', 'moved']) {
      const found = checkAttendanceRecordsHold(recorded(kind), replaced, { fromDateKey: '2026-11-16' })
      expect(codes(found)).toEqual(['stop:attendance-record-overridden'])
      expect(found[0]).toMatchObject({ dateKey: D, slotNumber: 3, studentId: 's1' })
    }
    // 置き直されていなければ所見なし
    expect(checkAttendanceRecordsHold(recorded('absent'), recorded('absent'), { fromDateKey: '2026-11-16' })).toEqual([])
    // 反映日より前のコマは見ない
    expect(checkAttendanceRecordsHold(recorded('absent'), replaced, { fromDateKey: '2026-11-23' })).toEqual([])
    // 「移)」も記録が勝つ(§2-4・台本 b が付けた記録も守る)。休日の表示専用の記録(休))は見ない
    expect(checkAttendanceRecordsHold(recorded('holiday'), replaced, { fromDateKey: '2026-11-16' })).toEqual([])
    // 前から同じコマに座っていた(記録と授業が並んでいた)なら新しく置き直したのではない
    const seatedBefore = facts([cell(D, 3, [desk('d1', [null, studentB()], { teacher: '講師A', statusSlots: [status({ dateKey: D }), null] }), desk('d2', [student(), null], { teacher: '講師B' })])])
    expect(checkAttendanceRecordsHold(seatedBefore, replaced, { fromDateKey: '2026-11-16' })).toEqual([])
  })
})

describe('台本 f(講師の移動・入れ替え・休み)の点検', () => {
  const teacherFacts = (desks, teachers = [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師B' }, { id: 't3', name: '講師C' }]) => collectBoardFacts({ ...payload([cell(D, 3, desks)]), teachers })

  it('休みの講師がそのコマに居る形・同じ講師が 1 コマに 2 机が新しくできたら stop。前からある形は止めない(reportExisting なら info で知らせるだけ)', () => {
    const clean = teacherFacts([desk('d1', [student(), null], { teacher: '講師B', teacherRest: { teacher: '講師A', teacherId: 't1' } }), desk('d2')])
    const rested = teacherFacts([desk('d1', [student(), null], { teacher: '講師B', teacherRest: { teacher: '講師A', teacherId: 't1' } }), desk('d2', [null, null], { teacher: '講師A' })])
    const found = checkTeacherCellIntegrity(clean, rested)
    expect(codes(found)).toEqual(['stop:teacher-rested-but-present'])
    expect(found[0]).toMatchObject({ dateKey: D, slotNumber: 3, deskIndex: 1 })
    expect(found[0].message).toContain('講師A')
    // 前から(種データに最初からある形・丸ごと振替の付け替えなど)は止めない
    expect(checkTeacherCellIntegrity(rested, rested)).toEqual([])
    expect(codes(checkTeacherCellIntegrity(rested, rested, { reportExisting: true }))).toEqual(['info:teacher-cell-anomaly-existing'])
    const duplicated = teacherFacts([desk('d1', [null, null], { teacher: '講師B' }), desk('d2', [null, null], { teacher: '講師B' })])
    const single = teacherFacts([desk('d1', [null, null], { teacher: '講師B' }), desk('d2')])
    expect(codes(checkTeacherCellIntegrity(single, duplicated))).toEqual(['stop:teacher-duplicated-in-cell', 'stop:teacher-duplicated-in-cell'])
    expect(checkTeacherCellIntegrity(duplicated, duplicated)).toEqual([])
    // 前から 1 件ある「休みなのに居る」形と同じコマ・同じ講師に 2 机目ができたら止まる(数で突き合わせる)
    const restedTwice = teacherFacts([
      desk('d1', [student(), null], { teacher: '講師B', teacherRest: { teacher: '講師A', teacherId: 't1' } }),
      desk('d2', [null, null], { teacher: '講師A' }),
      desk('d3', [null, null], { teacher: '講師A' }),
    ])
    expect(codes(checkTeacherCellIntegrity(rested, restedTwice))).toEqual(expect.arrayContaining(['stop:teacher-rested-but-present', 'stop:teacher-duplicated-in-cell']))
    expect(codes(checkTeacherCellIntegrity(rested, restedTwice)).filter((code) => code === 'stop:teacher-rested-but-present')).toHaveLength(1)
  })

  it('まとめる行(ほか n 机)の code は種類ごと(休みの講師が居る形は teacher-rested-but-present のまま)', () => {
    const cells = Array.from({ length: 22 }, (_, index) => cell(D, index + 1, [
      desk(`r${index}`, [null, null], { teacher: '講師B', teacherRest: { teacher: '講師A' } }),
      desk(`p${index}`, [null, null], { teacher: '講師A' }),
    ]))
    const clean = collectBoardFacts(payload(cells.map((item) => ({ ...item, desks: [item.desks[0]] }))))
    const found = checkTeacherCellIntegrity(clean, collectBoardFacts(payload(cells)))
    expect(found).toHaveLength(21)
    expect(new Set(found.map((finding) => finding.code))).toEqual(new Set(['teacher-rested-but-present']))
    expect(found.at(-1).message).toContain('ほか 2 机')
  })

  it('休みの講師を手で置いた: 休みの記録が講師 ID だけでも、残っていれば止める(照合は doesTeacherRestMatch)', () => {
    const teachers = [{ id: 't1', name: '講師A本名', displayName: '講師A' }, { id: 't3', name: '講師C' }]
    const before = teacherFacts([desk('d1', [student(), null], { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '', teacherId: 't1' } }), desk('d2')], teachers)
    const kept = teacherFacts([desk('d1', [student(), null], { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '', teacherId: 't1' } }), desk('d2', [null, null], { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' })], teachers)
    const cleared = teacherFacts([desk('d1', [student(), null], { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual' }), desk('d2', [null, null], { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' })], teachers)
    const placeOp = { kind: 'place-rested', cellId: `${D}_3`, deskIndex: 1, teacher: '講師A' }
    expect(codes(checkTeacherOpApplied(before, kept, placeOp))).toEqual(['stop:teacher-op-not-applied'])
    expect(checkTeacherOpApplied(before, cleared, placeOp)).toEqual([])
  })

  const two = (first, second) => teacherFacts([desk('d1', first.slots ?? [null, null], first.desk), desk('d2', second.slots ?? [null, null], second.desk)])
  const op = (kind, extra = {}) => ({ kind, cellId: `${D}_3`, deskIndex: 0, targetDeskIndex: 1, ...extra })

  it('講師だけ入替: 講師が入れ替わり、生徒・出欠記録・メモは机に残る。生徒も動いた・片方の講師が消えたら stop teacher-op-not-applied', () => {
    const before = two({ slots: [student(), null], desk: { teacher: '講師A' } }, { slots: [studentB(), null], desk: { teacher: '講師B' } })
    const swapped = two({ slots: [student(), null], desk: { teacher: '講師B', manualTeacher: true } }, { slots: [studentB(), null], desk: { teacher: '講師A', manualTeacher: true } })
    expect(checkTeacherOpApplied(before, swapped, op('teacher-swap'))).toEqual([])
    const seatMoved = two({ slots: [studentB(), null], desk: { teacher: '講師B', manualTeacher: true } }, { slots: [student(), null], desk: { teacher: '講師A', manualTeacher: true } })
    expect(codes(checkTeacherOpApplied(before, seatMoved, op('teacher-swap')))).toEqual(['stop:teacher-op-not-applied', 'stop:teacher-op-not-applied'])
    const lost = two({ slots: [student(), null], desk: { teacher: '' } }, { slots: [studentB(), null], desk: { teacher: '講師A', manualTeacher: true } })
    expect(codes(checkTeacherOpApplied(before, lost, op('teacher-swap')))).toEqual(['stop:teacher-op-not-applied'])
    // 生徒ごと席入替は、生徒も一緒に入れ替わるのが正しい
    expect(checkTeacherOpApplied(before, seatMoved, op('seat-swap'))).toEqual([])
    expect(codes(checkTeacherOpApplied(before, swapped, op('seat-swap')))).toEqual(['stop:teacher-op-not-applied', 'stop:teacher-op-not-applied'])
    // 講師の移動(講師の居ない机へ)は講師だけ入替と同じ形(元の机は講師なし・生徒は残る)
    const moveBefore = two({ slots: [student(), null], desk: { teacher: '講師A' } }, {})
    const moved = two({ slots: [student(), null], desk: { teacher: '' } }, { desk: { teacher: '講師A', manualTeacher: true } })
    expect(checkTeacherOpApplied(moveBefore, moved, op('move'))).toEqual([])
    // 入った講師は手入力(青字)になる
    const notManual = two({ slots: [student(), null], desk: { teacher: '' } }, { desk: { teacher: '講師A' } })
    expect(codes(checkTeacherOpApplied(moveBefore, notManual, op('move')))).toEqual(['stop:teacher-op-not-applied'])
  })

  it('講師メニューで替える・休み・解除・休みの講師を別の机へ手で置く', () => {
    const before = two({ slots: [student(), null], desk: { teacher: '講師A' } }, {})
    const replaced = two({ slots: [student(), null], desk: { teacher: '講師C', teacherAssignmentSource: 'manual', manualTeacher: true } }, {})
    expect(checkTeacherOpApplied(before, replaced, op('menu-teacher', { teacher: '講師C', targetDeskIndex: undefined }))).toEqual([])
    expect(codes(checkTeacherOpApplied(before, before, op('menu-teacher', { teacher: '講師C', targetDeskIndex: undefined })))).toEqual(['stop:teacher-op-not-applied'])
    // 休み: 講師なし・休みの記録・生徒は残る
    const rested = two({ slots: [student(), null], desk: { teacher: '', teacherRest: { teacher: '講師A', teacherId: 't1' } } }, {})
    expect(checkTeacherOpApplied(before, rested, op('rest', { targetDeskIndex: undefined }))).toEqual([])
    const restedLost = two({ desk: { teacher: '', teacherRest: { teacher: '講師A' } } }, {})
    expect(codes(checkTeacherOpApplied(before, restedLost, op('rest', { targetDeskIndex: undefined })))).toEqual(['stop:teacher-op-not-applied'])
    // 解除: 記録が消える(講師欄は今のまま)
    const released = two({ slots: [student(), null], desk: { teacher: '' } }, {})
    expect(checkTeacherOpApplied(rested, released, op('release', { targetDeskIndex: undefined }))).toEqual([])
    // 解除の直後に再マージでテンプレの講師が戻るのは仕様どおり(§2-4)。手入力の講師が入る・生徒が変わるのは「変」
    const templateBack = two({ slots: [student(), null], desk: { teacher: '講師A' } }, {})
    expect(checkTeacherOpApplied(rested, templateBack, op('release', { targetDeskIndex: undefined }))).toEqual([])
    const manualBack = two({ slots: [student(), null], desk: { teacher: '講師C', manualTeacher: true } }, {})
    expect(codes(checkTeacherOpApplied(rested, manualBack, op('release', { targetDeskIndex: undefined })))).toEqual(['stop:teacher-op-not-applied'])
    expect(codes(checkTeacherOpApplied(rested, rested, op('release', { targetDeskIndex: undefined })))).toEqual(['stop:teacher-op-not-applied'])
    // 代わりの講師: 休みの記録は残る(§2-4)
    const substituted = two({ slots: [student(), null], desk: { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '講師A', teacherId: 't1' } } }, {})
    expect(checkTeacherOpApplied(rested, substituted, op('menu-teacher', { teacher: '講師C', targetDeskIndex: undefined }))).toEqual([])
    // 休みの講師を別の机へ手で置く(§9-25): 置いた机に講師・そのコマに休みの記録が 1 つも残らない
    const placedOk = two({ slots: [student(), null], desk: { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual' } }, { desk: { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' } })
    const placeOp = op('place-rested', { deskIndex: 1, targetDeskIndex: undefined, teacher: '講師A', restedName: '講師A' })
    expect(checkTeacherOpApplied(substituted, placedOk, placeOp)).toEqual([])
    const placedKeptRest = two({ slots: [student(), null], desk: { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual', teacherRest: { teacher: '講師A', teacherId: 't1' } } }, { desk: { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' } })
    const kept = checkTeacherOpApplied(substituted, placedKeptRest, placeOp)
    expect(codes(kept)).toEqual(['stop:teacher-op-not-applied'])
    expect(kept[0].message).toContain('休みの記録')
  })
})

// ── 台本 g(休日設定と解除・丸ごと振替・2026-11-11 第 2 段の 4 本目)
describe('台本 g(休日設定と解除・丸ごと振替)の点検', () => {
  const H = '2026-11-19' // 木曜
  const T = '2026-11-26' // 翌週の木曜(丸ごと振替の振替先)
  const holidayRecord = (overrides = {}) => status({ dateKey: H, status: 'holiday', ...overrides })
  const movedRecord = (overrides = {}) => status({ dateKey: H, status: 'moved', ...overrides })
  const g = (cells, board) => collectBoardFacts(payload(cells, { board }))

  it('所見の種類: 日付の操作が効かない(stop)・解除で元に戻らない(stop)・アプリが断った(info)・丸ごと振替でできた休みの講師(info)', () => {
    for (const code of ['day-op-not-applied', 'round-trip-not-restored', 'day-op-blocked', 'teacher-rested-present-by-whole-day-transfer', 'holiday-memo-dropped', 'holiday-release-suppression-changed', 'holiday-teacher-dropped']) expect(PATROL_FINDING_CODES).toContain(code)
  })

  it('休日設定: その日の席が空になり、居た生徒ごとに同じ机へ「休)」の記録(holiday)が付けば所見なし。席に残る・記録が付かないは stop day-op-not-applied', () => {
    const before = g([cell(H, 3, [desk('d1', [student({ origin: 'template' }), studentB({ origin: 'template' })], { teacher: '講師A' })])])
    const after = g([cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [holidayRecord(), holidayRecord({ id: 'st2', studentId: 'e2', name: '生徒B', managedStudentId: 's2' })] })])])
    expect(checkHolidayApplied(before, after, H)).toEqual([])
    // 生徒が席に残った
    const stayed = g([cell(H, 3, [desk('d1', [student({ origin: 'template' }), null], { teacher: '講師A', statusSlots: [null, holidayRecord({ id: 'st2', studentId: 'e2', name: '生徒B', managedStudentId: 's2' })] })])])
    const found = checkHolidayApplied(before, stayed, H)
    expect(codes(found)).toContain('stop:day-op-not-applied')
    expect(found.map((finding) => finding.message).join('\n')).toContain('s1')
    // 記録が付かない(生徒が消えただけ)
    expect(codes(checkHolidayApplied(before, g([cell(H, 3, [desk('d1', [null, null], { teacher: '講師A' })])]), H))).toEqual(['stop:day-op-not-applied', 'stop:day-op-not-applied'])
    // ほかの日の机は見ない(範囲の点検 checkOutsideAllowedRange が見る)
    expect(checkHolidayApplied(before, after, '2026-11-20')).toEqual([])
  })

  it('丸ごと振替: 振替先の同じ時限・同じ机・同じ席に振替元の生徒(生徒と科目)と講師が乗り、振替元の席は空・テンプレの生徒には「休)」(moved)。違えば stop day-op-not-applied', () => {
    const before = g([
      cell(H, 3, [desk('d1', [student({ origin: 'template' }), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [studentB({ origin: 'template' }), null], { teacher: '講師B' }), desk('t2', [null, null])]),
    ])
    const after = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [movedRecord(), null] }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), null], { teacher: '講師A' }), desk('t2', [null, null])]),
    ])
    const op = { sourceDateKey: H, targetDateKey: T }
    expect(checkWholeDayTransferApplied(before, after, op)).toEqual([])
    // 振替先に振替元の生徒がいない(振替先のテンプレの生徒が残った)
    const notMoved = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [movedRecord(), null] }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [studentB({ origin: 'template' }), null], { teacher: '講師B' }), desk('t2', [null, null])]),
    ])
    const found = checkWholeDayTransferApplied(before, notMoved, op)
    expect(codes(found)).toContain('stop:day-op-not-applied')
    // 振替元の席に生徒が残った・「休)」が無い
    const stayed = g([
      cell(H, 3, [desk('d1', [student({ origin: 'template' }), null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), null], { teacher: '講師A' }), desk('t2', [null, null])]),
    ])
    expect(checkWholeDayTransferApplied(before, stayed, op).map((finding) => finding.message).join('\n')).toContain('振替元の席に生徒が残った')
    const noRest = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), null], { teacher: '講師A' }), desk('t2', [null, null])]),
    ])
    expect(checkWholeDayTransferApplied(before, noRest, op).map((finding) => finding.message).join('\n')).toContain('「休)」が付かない')
    // 講師が振替元の講師になっていない
    const wrongTeacher = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [movedRecord(), null] }), desk('d2', [null, null], { teacher: '講師B' })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), null], { teacher: '講師B' }), desk('t2', [null, null])]),
    ])
    expect(checkWholeDayTransferApplied(before, wrongTeacher, op).map((finding) => finding.message).join('\n')).toContain('講師')
  })

  it('解除で元に戻らない: checkSameState の round-trip-not-restored(机ごと・部分ごと)。在庫も同じコードで比べられる', () => {
    const before = g([cell(H, 3, [desk('d1', [student(), null], { teacher: '講師A' })])])
    const lost = g([cell(H, 3, [desk('d1', [null, null], { teacher: '講師A' })])])
    expect(codes(checkSameState(before, before, 'round-trip-not-restored'))).toEqual([])
    const found = checkSameState(before, lost, 'round-trip-not-restored')
    expect(codes(found)).toEqual(['stop:round-trip-not-restored'])
    expect(found[0].message).toContain('解除')
    expect(codes(checkStockDeltas({ makeup: { 's1__数': 0 }, lecture: {} }, { makeup: { 's1__数': 1 }, lecture: {} }, {}, { code: 'round-trip-not-restored', label: '解除で在庫が元に戻らない' }))).toEqual(['stop:round-trip-not-restored'])
  })

  it('休日の解除で元に戻るか: 休日の日のメモだけが消えたのは仕様(休日のコマはメモを持ち込まない)なので info holiday-memo-dropped。ほかの違い・ほかの日のメモは stop round-trip-not-restored', () => {
    const base = g([cell(H, 3, [desk('d1', [student(), null], { teacher: '講師A', memoSlots: ['自習', null] }), desk('d2', [null, null], { memoSlots: ['予約', 'メモ'] })]), cell('2026-11-20', 3, [desk('e1', [null, null], { memoSlots: ['別の日', null] })])])
    const memoLost = g([cell(H, 3, [desk('d1', [student(), null], { teacher: '講師A' }), desk('d2', [null, null])]), cell('2026-11-20', 3, [desk('e1', [null, null], { memoSlots: ['別の日', null] })])])
    const found = checkHolidayRoundTrip(base, memoLost, H)
    expect(codes(found)).toEqual(['info:holiday-memo-dropped', 'info:holiday-memo-dropped'])
    expect(found[1].message).toContain('メモ 2 件')
    expect(checkHolidayRoundTrip(base, base, H)).toEqual([])
    // 生徒が戻らない・ほかの日のメモが消えた・メモの中身が変わった
    const studentLost = g([cell(H, 3, [desk('d1', [null, null], { teacher: '講師A' }), desk('d2', [null, null])]), cell('2026-11-20', 3, [desk('e1', [null, null])])])
    expect(codes(checkHolidayRoundTrip(base, studentLost, H))).toEqual(['stop:round-trip-not-restored', 'info:holiday-memo-dropped', 'stop:round-trip-not-restored'])
    const memoChanged = g([cell(H, 3, [desk('d1', [student(), null], { teacher: '講師A', memoSlots: ['ちがう', null] }), desk('d2', [null, null], { memoSlots: ['予約', 'メモ'] })]), cell('2026-11-20', 3, [desk('e1', [null, null], { memoSlots: ['別の日', null] })])])
    expect(codes(checkHolidayRoundTrip(base, memoChanged, H))).toEqual(['stop:round-trip-not-restored'])
  })

  it('休日の解除で元に戻るか: 休日の日の生徒も記録も無い机の手入力の講師が消えた・テンプレの講師に替わったのは仕様(記録の無い机は講師を持ち込まない)なので info holiday-teacher-dropped。生徒の居る机・テンプレの講師が消えたのは stop', () => {
    const base = g([cell(H, 3, [
      desk('d1', [null, null], { teacher: '講師A', manualTeacher: true, teacherAssignmentSource: 'manual' }),
      desk('d2', [null, null], { teacher: '講師B', manualTeacher: true, teacherAssignmentSource: 'manual', memoSlots: ['自習', null] }),
      desk('d3', [student(), null], { teacher: '講師C', manualTeacher: true, teacherAssignmentSource: 'manual' }),
      desk('d4', [null, null], { teacher: '講師D' }),
    ])])
    const after = g([cell(H, 3, [
      desk('d1', [null, null]),
      desk('d2', [null, null], { teacher: '講師B' }),
      desk('d3', [student(), null]),
      desk('d4', [null, null]),
    ])])
    const found = checkHolidayRoundTrip(base, after, H)
    expect(codes(found)).toEqual(['info:holiday-teacher-dropped', 'info:holiday-teacher-dropped', 'info:holiday-memo-dropped', 'stop:round-trip-not-restored', 'stop:round-trip-not-restored'])
    expect(found[0].message).toContain('講師A')
  })

  it('休日の解除で元に戻るか: その日の抑止キーの出入り(席へ戻した授業の鍵を外す・戻せなかった授業の鍵を積む)は仕様なので info。ほかの日の鍵・ほかの部分の違いは stop', () => {
    const board = (keys, extra = {}) => g([cell(H, 3, [desk('d1', [student(), null], { teacher: '講師A' })])], { suppressedRegularLessonOccurrences: keys, ...extra })
    const base = board(['s1__数__2026-11-19__3', 's9__英__2026-11-12__2'])
    const found = checkHolidayRoundTrip(base, board(['s9__英__2026-11-12__2', 's2__英__2026-11-19__5']), H)
    expect(codes(found)).toEqual(['info:holiday-release-suppression-changed'])
    expect(found[0].message).toContain('外れた 1')
    expect(found[0].message).toContain('増えた 1')
    // ほかの日の鍵が外れた
    expect(codes(checkHolidayRoundTrip(base, board(['s1__数__2026-11-19__3']), H))).toEqual(['stop:round-trip-not-restored'])
    // 台帳(振替元)が違う
    expect(codes(checkHolidayRoundTrip(base, board(['s1__数__2026-11-19__3', 's9__英__2026-11-12__2'], { manualMakeupAdjustments: { 's1__数': [{ dateKey: '2026-10-19' }] } }), H))).toEqual(['stop:round-trip-not-restored'])
  })

  it('丸ごと振替: 振替先の手入力(振替元の席と重ならない)は残る(D\' で置いた手入力は残す・§9-20)', () => {
    const before = g([
      cell(H, 3, [desk('d1', [student({ origin: 'template' }), null], { teacher: '講師A' })]),
      cell(T, 3, [desk('t1', [studentB({ origin: 'template' }), makeupA({ id: 'm1', managedStudentId: 's9', name: '生徒C' })], { teacher: '講師B' })]),
    ])
    const after = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [movedRecord(), null] })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), makeupA({ id: 'm1', managedStudentId: 's9', name: '生徒C' })], { teacher: '講師A' })]),
    ])
    expect(checkWholeDayTransferApplied(before, after, { sourceDateKey: H, targetDateKey: T })).toEqual([])
    const manualLost = g([
      cell(H, 3, [desk('d1', [null, null], { teacher: '講師A', statusSlots: [movedRecord(), null] })]),
      cell(T, 3, [desk('t1', [makeupA({ origin: 'template', makeupSourceDate: H }), null], { teacher: '講師A' })]),
    ])
    expect(codes(checkWholeDayTransferApplied(before, manualLost, { sourceDateKey: H, targetDateKey: T }))).toEqual(['stop:day-op-not-applied'])
  })

  it('在庫の増減: ignore に入れた鍵(数え方が別の決まりの生徒)は比べない。ほかの鍵は今までどおり', () => {
    const before = { makeup: { 's1__数': 0, 's2__英': 0 }, lecture: { 's3__数__winter': 2, 's4__英__winter': 1 } }
    const after = { makeup: { 's1__数': 1, 's2__英': 5 }, lecture: { 's3__数__winter': 9, 's4__英__winter': 1 } }
    const ignore = { makeup: new Set(['s2__英']), lecturePrefixes: ['s3__'] }
    expect(checkStockDeltas(before, after, { makeup: { 's1__数': 1 } }, { ignore })).toEqual([])
    expect(codes(checkStockDeltas(before, after, { makeup: { 's1__数': 1 } }))).toEqual(['stop:stock-delta-mismatch', 'stop:stock-delta-mismatch'])
    // ignore に無い鍵のずれは止める
    expect(codes(checkStockDeltas(before, { ...after, lecture: { ...after.lecture, 's4__英__winter': 3 } }, { makeup: { 's1__数': 1 } }, { ignore }))).toEqual(['stop:stock-delta-mismatch'])
  })

  it('丸ごと振替でできた「休みの記録があるコマにその講師が居る」は知らせるだけ(restedPresentAsInfoDates＝振替元・振替先の日だけ)。ほかの日にできた形・同じ講師が 1 コマに 2 机は止める', () => {
    const teachers = [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師B' }]
    const tf = (desks) => collectBoardFacts({ ...payload([cell(T, 3, desks)]), teachers })
    const clean = tf([desk('t1', [student(), null], { teacher: '講師B', teacherRest: { teacher: '講師A', teacherId: 't1' } }), desk('t2')])
    const rested = tf([desk('t1', [student(), null], { teacher: '講師B', teacherRest: { teacher: '講師A', teacherId: 't1' } }), desk('t2', [null, null], { teacher: '講師A' })])
    const found = checkTeacherCellIntegrity(clean, rested, { restedPresentAsInfoDates: new Set([H, T]) })
    expect(codes(found)).toEqual(['info:teacher-rested-present-by-whole-day-transfer'])
    expect(found[0].message).toContain('丸ごと振替')
    expect(found[0].message).toContain('講師A')
    // オーナー決定(2026-11-11): 今のまま(講師の休みが本番で使われ始めてから見直す)。「判断待ち」とは書かない。
    expect(found[0].message).toContain('今のまま')
    expect(found[0].message).not.toContain('判断待ち')
    const duplicated = tf([desk('t1', [null, null], { teacher: '講師B' }), desk('t2', [null, null], { teacher: '講師B' })])
    expect(codes(checkTeacherCellIntegrity(tf([desk('t1', [null, null], { teacher: '講師B' }), desk('t2')]), duplicated, { restedPresentAsInfoDates: new Set([H, T]) }))).toEqual(['stop:teacher-duplicated-in-cell', 'stop:teacher-duplicated-in-cell'])
    // 振替元・振替先でない日にできた「休みなのに居る」は止める(手直し 1 M-1)
    expect(codes(checkTeacherCellIntegrity(clean, rested, { restedPresentAsInfoDates: new Set([H, '2026-12-03']) }))).toEqual(['stop:teacher-rested-but-present'])
  })
})

describe('台本 h(講習の自動割振)の点検', () => {
  const P1 = '2026-12-14' // 期間の初日(月)
  const P2 = '2026-12-20'
  const op = { studentKey: 's1', entryKey: 's1__winter', includeMakeup: false, periodStart: P1, periodEnd: P2 }
  const special = (overrides = {}) => student({ id: 'x1', lessonType: 'special', specialSessionId: 'winter', ...overrides })
  const base = () => [
    cell(P1, 3, [
      desk('a0', [studentB({ origin: 'template' }), null], { teacher: '講師A' }),
      desk('a1', [null, null], { teacher: '講師B' }),
      desk('a2', [null, null], { teacher: '' }),
    ]),
    cell(P1, 4, [desk('b0', [null, null], { teacher: '講師A', memoSlots: [null, null] })]),
  ]
  const withSeat = (cells, cellIndex, deskIndex, seat, entry) => {
    const next = structuredClone(cells)
    next[cellIndex].desks[deskIndex].lesson.studentSlots[seat] = entry
    return next
  }

  it('空いた席へその生徒の講習が座っただけなら所見 0。置いた席を数える(講習・振替)', () => {
    const before = facts(base())
    const after = facts(withSeat(withSeat(base(), 0, 0, 1, special()), 1, 0, 0, special({ id: 'x2', subject: '英' })))
    const placements = collectAutoAssignPlacements(before, after, 's1')
    expect(placements.map((item) => `${item.cellId}#${item.deskIndex}/${item.seat}:${item.lessonType}:${item.subject}`)).toEqual([`${P1}_3#0/1:special:数`, `${P1}_4#0/0:special:英`])
    expect(checkAutoAssignApplied(before, after, { ...op, announced: '生徒A を自動割振しました（2コマ）。' })).toEqual([])
  })

  it('置いた席のほかが変わった(ほかの生徒が消えた・講師が変わった・別の生徒が座った)は stop auto-assign-outside-placement(INV-02)', () => {
    const before = facts(base())
    const replaced = facts(withSeat(base(), 0, 0, 0, special()))
    expect(codes(checkAutoAssignApplied(before, replaced, op))).toContain('stop:auto-assign-outside-placement')
    const teacherChanged = structuredClone(withSeat(base(), 0, 1, 0, special()))
    teacherChanged[0].desks[1].teacher = '講師C'
    expect(codes(checkAutoAssignApplied(before, facts(teacherChanged), op))).toContain('stop:auto-assign-outside-placement')
    const someoneElse = facts(withSeat(base(), 0, 1, 0, studentB({ id: 'y', lessonType: 'special' })))
    expect(codes(checkAutoAssignApplied(before, someoneElse, op))).toContain('stop:auto-assign-outside-placement')
  })

  it('振替を同時に割り当てない設定で振替が座った・講習の期間の外・講師のいない机・休校のコマ・同じコマに同じ生徒が 2 席は stop auto-assign-rule-violated', () => {
    const before = facts(base())
    expect(codes(checkAutoAssignApplied(before, facts(withSeat(base(), 0, 1, 0, makeupA({ id: 'm1' }))), op))).toContain('stop:auto-assign-outside-placement')
    expect(codes(checkAutoAssignApplied(before, facts(withSeat(base(), 0, 1, 0, makeupA({ id: 'm1' }))), { ...op, includeMakeup: true }))).toEqual([])
    expect(codes(checkAutoAssignApplied(before, facts(withSeat(base(), 0, 1, 0, special())), { ...op, periodStart: '2026-12-15' }))).toEqual(['stop:auto-assign-rule-violated'])
    expect(codes(checkAutoAssignApplied(before, facts(withSeat(base(), 0, 2, 0, special())), op))).toEqual(['stop:auto-assign-rule-violated'])
    const closed = structuredClone(withSeat(base(), 0, 1, 0, special()))
    closed[0].isOpenDay = false
    expect(codes(checkAutoAssignApplied(facts(base()), facts(closed), op))).toContain('stop:auto-assign-rule-violated')
    const twice = facts(withSeat(withSeat(base(), 0, 1, 0, special()), 0, 1, 1, special({ id: 'x2', subject: '英' })))
    expect(codes(checkAutoAssignApplied(before, twice, op))).toContain('stop:auto-assign-rule-violated')
  })

  it('画面の文の件数と置いた席の数が違えば stop auto-assign-count-mismatch(講習だけ・振替も同時)', () => {
    const before = facts(base())
    const after = facts(withSeat(base(), 0, 1, 0, special()))
    expect(codes(checkAutoAssignApplied(before, after, { ...op, announced: '生徒A を自動割振しました（2コマ）。' }))).toEqual(['stop:auto-assign-count-mismatch'])
    expect(checkAutoAssignApplied(before, after, { ...op, announced: '生徒A を自動割振しました（1コマ・候補なしで残り 2コマ）。' })).toEqual([])
    const both = facts(withSeat(withSeat(base(), 0, 1, 0, special()), 1, 0, 1, makeupA({ id: 'm1' })))
    expect(checkAutoAssignApplied(before, both, { ...op, includeMakeup: true, announced: '生徒A を自動割振しました（講習1・振替1コマ）。' })).toEqual([])
    expect(codes(checkAutoAssignApplied(before, both, { ...op, includeMakeup: true, announced: '生徒A を自動割振しました（講習1・振替0コマ）。' }))).toEqual(['stop:auto-assign-count-mismatch'])
  })

  it('画面の文から置いた数を読む(読めなければ null)', () => {
    expect(parseAutoAssignAnnouncedCounts('生徒A を自動割振しました（3コマ・候補なしで残り 1コマ）。')).toEqual({ lecture: 3, makeup: 0 })
    expect(parseAutoAssignAnnouncedCounts('生徒A を自動割振しました（講習2・振替1コマ・候補なしで残り 振替2）。')).toEqual({ lecture: 2, makeup: 1 })
    expect(parseAutoAssignAnnouncedCounts('生徒A は条件に合う空きコマが見つからず、自動割振できませんでした。')).toBeNull()
    expect(parseAutoAssignAnnouncedCounts('')).toBeNull()
  })
})
