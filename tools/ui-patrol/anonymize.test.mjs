// tools/ui-patrol/anonymize.ts(画面の自動巡回の伏せ字・漏れ検査・保証台帳の結果の一致)を固定する。
// 決まりの表は docs/plan-2026-11-11-ui-patrol.md の Task 2。フィクスチャはこのファイル内の架空の名前だけ
// (甲野　一郎・乙川　二郎・丙山　三子・丁谷　四郎 など)。実在の人の名前は使わない。
import { describe, it, expect } from 'vitest'
import * as anonymizeModule from './anonymize.ts'
import { anonymizeClassroomPayload, compareAuditForParity, findNameLeaks } from './anonymize.ts'
import { deriveManagedDisplayName } from '../../src/components/basic-data/basicDataModel'
import { buildManagedStudentByAnyNameMap } from '../../src/components/schedule-board/ScheduleBoardScreen'

const ROOM = 'room1'
const REAL_NAMES = ['甲野　一郎', '甲野', '乙川　二郎', '乙川二', '丙山　三子', '丙山', '丁谷　四郎', '戊田', '己原室長', '架空　謎男']

function makeStudentRow(id, name, displayName, extra = {}) {
  return { id, name, displayName, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...extra }
}

function makeStudentEntry(overrides = {}) {
  return { id: 'e1', name: '甲野', managedStudentId: 's092', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function makeStatusEntry(overrides = {}) {
  return {
    id: 'st1', studentId: 'e1', sourceManagedLesson: true, name: '甲野', managedStudentId: 's092', grade: '中1', subject: '数', lessonType: 'regular',
    teacherType: 'normal', teacherName: '丙山', dateKey: '2026-11-12', slotNumber: 1, recordedAt: '2026-11-01T00:00:00.000Z', status: 'absent', sourceLessonId: 'L1',
    ...overrides,
  }
}

function makePayload() {
  return {
    screen: 'board',
    classroomSettings: {
      closedWeekdays: [0],
      holidayDates: ['2026-11-23'],
      forceOpenDates: [],
      deskCount: 3,
      scheduleNotes: { '2026-11': '甲野くんは遅れて来ます', '2026-12': '' },
      scheduleHeader: { schoolName: '架空塾 本校', phoneNumber: '000-0000-0000', logoDataUrl: 'data:image/png;base64,AAAA' },
      boardShareToken: 'abcdef0123456789',
      updatedBy: '己原室長',
    },
    managers: [{ id: 'm1', name: '己原室長', email: 'kihara@example.com' }],
    teachers: [
      { id: 't005', name: '丙山　三子', displayName: '丙山', email: 't005@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }], memo: '火曜は早退' },
      { id: 't006', name: '丁谷　四郎', email: '', entryDate: '2025-04-01', withdrawDate: '2026-03-31', subjectCapabilities: [], memo: '' },
    ],
    students: [
      makeStudentRow('s092', '甲野　一郎', '甲野', { parentPortalToken: 'tok-parent-0001', parentPortalTokenClassroomId: ROOM }),
      makeStudentRow('s093', '乙川　二郎', '乙川二'),
      makeStudentRow('s094', '戊田', ''),
    ],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [{
      id: 'session_2026_winter',
      label: '2026 冬期講習',
      startDate: '2026-12-20',
      endDate: '2027-01-07',
      studentInputs: { s092: { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 数: 2 }, regularOnly: false, countSubmitted: true, submissionToken: 'sub-token-xyz', submissionTokenClassroomId: ROOM, updatedAt: '2026-11-01T00:00:00.000Z' } },
      teacherInputs: {},
    }],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: {
      weeks: [[
        {
          id: '2026-11-12_1', dateKey: '2026-11-12', dayLabel: '木', dateLabel: '11/12', slotLabel: '1限', slotNumber: 1, timeLabel: '', isOpenDay: true,
          desks: [
            {
              id: 'd1', teacher: '丙山', teacherAssignmentTeacherId: 't005', memoSlots: ['宿題を忘れた', null],
              lesson: { id: 'L1', note: '仕組みの文', studentSlots: [makeStudentEntry(), makeStudentEntry({ id: 'e2', name: '乙川二', managedStudentId: 's093' })] },
              statusSlots: [makeStatusEntry(), null],
            },
            {
              id: 'd2', teacher: '講師未割当', teacherAssignmentTeacherId: '丙山',
              lesson: { id: 'L2', studentSlots: [makeStudentEntry({ id: 'e3', name: '架空　謎男', managedStudentId: undefined }), makeStudentEntry({ id: 'e4', name: '架空謎男', managedStudentId: undefined })] },
              memoSlots: ['', null],
            },
            { id: 'd3', teacher: '', lesson: { id: 'L3', studentSlots: [makeStudentEntry({ id: 'e5', name: '甲野一郎' }), null] } },
          ],
        },
      ]],
      weekIndex: 0,
      selectedCellId: '2026-11-12_1',
      selectedDeskIndex: 0,
      suppressedRegularLessonOccurrences: [],
      scheduleCountAdjustments: [],
      manualMakeupAdjustments: {},
      suppressedMakeupOrigins: {},
      fallbackMakeupStudents: { x1: { studentName: '架空　謎男', displayName: '架空謎男', subject: '数' } },
      manualLectureStockCounts: {},
      manualLectureStockOrigins: { y1: [{ displayName: '甲野', sessionId: 'session_2026_winter' }] },
      fallbackLectureStockStudents: { z1: { displayName: '乙川二', subject: '英' } },
      isLectureStockOpen: false,
      isMakeupStockOpen: false,
      studentScheduleRange: null,
      teacherScheduleRange: null,
      groupClassEntries: { '2026-12-21_1': { dateKey: '2026-12-21', band: 1, subject: '集団理科', teacherName: '丙山', absentStudentIds: [], addedStudentIds: [] } },
      templatePendingDesks: {
        '2026-11-12_1::d1': {
          effectiveStartDate: '2026-11-16',
          createdAt: '2026-11-10T00:00:00.000Z',
          lower: {
            lesson: { id: 'PL1', studentSlots: [makeStudentEntry({ id: 'p1', name: '乙川二' }), null] },
            statusSlots: [makeStatusEntry({ id: 'pst1', name: '甲野', teacherName: '丁谷' }), null],
            memoSlots: ['下段のメモ', null],
            teacher: { teacher: '丙山', teacherAssignmentTeacherId: 't005' },
          },
        },
      },
    },
  }
}

function desksOf(payload) {
  return payload.boardState.weeks[0][0].desks
}

describe('伏せ字(anonymizeClassroomPayload)', () => {
  it('名簿: 生徒は ID から作った仮名になり、表示名が姓と同じならアプリの導出と一致する', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    const [s092, s093, s094] = payload.students
    expect(s092.name).toBe('生徒092　名')
    expect(s092.displayName).toBe('生徒092')
    expect(deriveManagedDisplayName(s092.name)).toBe(s092.displayName)
    expect(s093.name).toBe('生徒093　名')
    expect(s093.displayName).toBe('生093')
    // 空白の無い名前・空の表示名
    expect(s094.name).toBe('生徒094')
    expect(s094.displayName).toBe('')
    const [t005, t006] = payload.teachers
    expect(t005.name).toBe('講師005　名')
    expect(t005.displayName).toBe('講師005')
    expect(t006.name).toBe('講師006　名')
    expect(t006.displayName).toBeUndefined()
    expect(payload.managers[0].name).toBe('室長1')
  })

  it('名簿: 数字の無い ID は名簿順の X 番号', () => {
    const input = makePayload()
    input.students.push(makeStudentRow('abc', '庚山　五郎', ''))
    const { payload } = anonymizeClassroomPayload(input)
    expect(payload.students[3].name).toBe('生徒X001　名')
  })

  it('盤面: 同じ文字列は必ず同じ仮名（生徒の席・出欠記録・講師欄・出欠記録の講師名）', () => {
    const { payload, nameMap } = anonymizeClassroomPayload(makePayload())
    const [d1, d2, d3] = desksOf(payload)
    expect(d1.lesson.studentSlots[0].name).toBe('生徒092')
    expect(d1.lesson.studentSlots[1].name).toBe('生093')
    expect(d1.statusSlots[0].name).toBe('生徒092')
    expect(d1.teacher).toBe('講師005')
    expect(d1.statusSlots[0].teacherName).toBe('講師005')
    expect(payload.boardState.groupClassEntries['2026-12-21_1'].teacherName).toBe('講師005')
    expect(payload.boardState.manualLectureStockOrigins.y1[0].displayName).toBe('生徒092')
    expect(payload.boardState.fallbackLectureStockStudents.z1.displayName).toBe('生093')
    // 保留の下段も同じ規則
    const lower = payload.boardState.templatePendingDesks['2026-11-12_1::d1'].lower
    expect(lower.lesson.studentSlots[0].name).toBe('生093')
    expect(lower.statusSlots[0].name).toBe('生徒092')
    expect(lower.statusSlots[0].teacherName).toBe('講師006')
    expect(lower.teacher.teacher).toBe('講師005')
    expect(lower.teacher.teacherAssignmentTeacherId).toBe('t005')
    // 空白を除くと名簿の名前と同じ → その仮名の空白を合わせた形
    expect(d3.lesson.studentSlots[0].name).toBe('生徒092名')
    expect(nameMap.get('甲野')).toBe('生徒092')
    expect(nameMap.get('甲野　一郎')).toBe('生徒092　名')
  })

  it('盤面: アプリの名前引き（buildManagedStudentByAnyNameMap）が伏せ字の前後で同じ生徒 ID を返す', () => {
    const input = makePayload()
    const { payload } = anonymizeClassroomPayload(input)
    const before = buildManagedStudentByAnyNameMap(input.students)
    const after = buildManagedStudentByAnyNameMap(payload.students)
    const beforeNames = [...desksOf(input).flatMap((desk) => desk.lesson.studentSlots), ...desksOf(input).flatMap((desk) => desk.statusSlots ?? [])].filter(Boolean).map((entry) => entry.name)
    const afterNames = [...desksOf(payload).flatMap((desk) => desk.lesson.studentSlots), ...desksOf(payload).flatMap((desk) => desk.statusSlots ?? [])].filter(Boolean).map((entry) => entry.name)
    expect(afterNames).toHaveLength(beforeNames.length)
    beforeNames.forEach((name, index) => {
      expect(after.get(afterNames[index])?.id).toBe(before.get(name)?.id)
    })
    // 名簿の登録名と表示名でも同じ
    for (const student of input.students) {
      expect(after.get(anonymizeClassroomPayload(input).nameMap.get(student.name))?.id).toBe(student.id)
    }
  })

  it('名簿に無い名前は 別名NNN。同じ文字列は同じ別名。空白の違いだけの名前は登録済みの仮名に合わせる', () => {
    const { payload, stats } = anonymizeClassroomPayload(makePayload())
    const d2 = desksOf(payload)[1]
    expect(d2.lesson.studentSlots[0].name).toBe('別名001')
    // 空白を除くと先に出た別名と同じ
    expect(d2.lesson.studentSlots[1].name).toBe('別名001')
    const fallback = payload.boardState.fallbackMakeupStudents.x1
    expect(fallback.studentName).toBe('別名001')
    expect(fallback.displayName).toBe('別名001')
    expect(stats.aliases).toBe(1)
  })

  it('講師欄の空と埋め草（講師未割当）はそのまま。teacherAssignmentTeacherId は ID ならそのまま・名前なら仮名', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    const [d1, d2, d3] = desksOf(payload)
    expect(d2.teacher).toBe('講師未割当')
    expect(d3.teacher).toBe('')
    expect(d1.teacherAssignmentTeacherId).toBe('t005')
    expect(d2.teacherAssignmentTeacherId).toBe('講師005')
  })

  it('メモと連絡事項は「メモ」に、空は空のまま。ロゴ・電話・メールは空。校舎名は 巡回用教室。更新者は patrol', () => {
    const { payload, stats } = anonymizeClassroomPayload(makePayload())
    const [d1, d2] = desksOf(payload)
    expect(d1.memoSlots).toEqual(['メモ', null])
    expect(d2.memoSlots).toEqual(['', null])
    expect(payload.boardState.templatePendingDesks['2026-11-12_1::d1'].lower.memoSlots).toEqual(['メモ', null])
    expect(payload.classroomSettings.scheduleNotes).toEqual({ '2026-11': 'メモ', '2026-12': '' })
    expect(payload.teachers[0].memo).toBe('メモ')
    expect(payload.teachers[1].memo).toBe('')
    expect(payload.classroomSettings.scheduleHeader).toEqual({ schoolName: '巡回用教室', phoneNumber: '', logoDataUrl: '' })
    expect(payload.classroomSettings.updatedBy).toBe('patrol')
    for (const row of [...payload.students, ...payload.teachers, ...payload.managers]) expect(row.email).toBe('')
    // 仕組みの文はそのまま
    expect(d1.lesson.note).toBe('仕組みの文')
    expect(stats.memos).toBe(4)
    expect(stats.students).toBe(3)
    expect(stats.teachers).toBe(2)
    // メール 5 件(空の 1 件は数えない)・電話・ロゴ
    expect(stats.cleared).toBe(7)
  })

  it('トークンは同じ長さの別の値。発行元の教室 ID はそのまま', () => {
    const input = makePayload()
    const { payload } = anonymizeClassroomPayload(input)
    const pairs = [
      [input.classroomSettings.boardShareToken, payload.classroomSettings.boardShareToken],
      [input.students[0].parentPortalToken, payload.students[0].parentPortalToken],
      [input.specialSessions[0].studentInputs.s092.submissionToken, payload.specialSessions[0].studentInputs.s092.submissionToken],
    ]
    const fakes = new Set()
    for (const [before, after] of pairs) {
      expect(after).toHaveLength(before.length)
      expect(after).not.toBe(before)
      expect(after).toMatch(/^p0*\d+$/)
      fakes.add(after)
    }
    expect(fakes.size).toBe(3)
    expect(payload.students[0].parentPortalTokenClassroomId).toBe(ROOM)
    expect(payload.specialSessions[0].studentInputs.s092.submissionTokenClassroomId).toBe(ROOM)
  })

  it('ID・日付・科目・学年・生年月日・withdrawDate の「未定」は変えない。入力のオブジェクトは書き換えない', () => {
    const input = makePayload()
    const frozen = JSON.stringify(input)
    const { payload } = anonymizeClassroomPayload(input)
    expect(JSON.stringify(input)).toBe(frozen)
    expect(payload.students.map((row) => [row.id, row.birthDate, row.withdrawDate, row.entryDate])).toEqual(input.students.map((row) => [row.id, row.birthDate, row.withdrawDate, row.entryDate]))
    expect(payload.teachers[1].withdrawDate).toBe('2026-03-31')
    const entry = desksOf(payload)[0].lesson.studentSlots[0]
    expect([entry.id, entry.managedStudentId, entry.grade, entry.subject, entry.lessonType]).toEqual(['e1', 's092', '中1', '数', 'regular'])
    expect(payload.specialSessions[0].label).toBe('2026 冬期講習')
    expect(payload.classroomSettings.holidayDates).toEqual(['2026-11-23'])
    expect(Object.keys(payload.boardState.templatePendingDesks)).toEqual(['2026-11-12_1::d1'])
  })
})

describe('漏れ検査(findNameLeaks)', () => {
  it('漏れ検査: 伏せ字のあとに実名が無ければ空', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    expect(findNameLeaks(payload, REAL_NAMES)).toEqual([])
    // 伏せ字の前は拾う
    expect(findNameLeaks(makePayload(), REAL_NAMES).length).toBeGreaterThan(0)
  })

  it('漏れ検査: 一覧に無い項目に名前が残っていたら経路を返す（値は返さない）', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    payload.boardState.futureField = { who: '甲野' }
    const leaks = findNameLeaks(payload, REAL_NAMES)
    expect(leaks).toEqual(['boardState.futureField.who'])
    expect(JSON.stringify(leaks)).not.toContain('甲野')
  })

  it('漏れ検査: 名前の断片(空白で分けた 2 文字以上)を含む文字列も拾う。配列は [] で書く', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    desksOf(payload)[0].lesson.note = '一郎さんの振替'
    expect(findNameLeaks(payload, REAL_NAMES)).toEqual(['boardState.weeks[][].desks[].lesson.note'])
  })

  it('漏れ検査: オブジェクトのキーに名前が残っていても拾う', () => {
    const { payload } = anonymizeClassroomPayload(makePayload())
    payload.boardState.manualLectureStockCounts = { 'name:乙川二__英': 1 }
    const leaks = findNameLeaks(payload, REAL_NAMES)
    expect(leaks).toEqual(['boardState.manualLectureStockCounts.*(キー)'])
    expect(JSON.stringify(leaks)).not.toContain('乙川')
  })
})

describe('保証台帳の結果の一致(compareAuditForParity)', () => {
  const finding = (overrides = {}) => ({ rule: 'INV-06', severity: 'bug', kind: 'orphaned-makeup', studentId: 's092', dateKey: '2026-11-12', slotNumber: 1, period: 'future', message: '生徒 s092 …', ...overrides })
  const result = (findings, counts = { total: findings.length, 'INV-06': findings.length }) => ({ findings, counts, notes: [] })

  it('結果の一致: 件数と所見の組が同じなら空。違えば説明を返す', () => {
    const real = result([finding(), finding({ studentId: 's093' })])
    // 並びと message が違っても同じ
    const same = result([finding({ studentId: 's093', message: '別の文' }), finding()])
    expect(compareAuditForParity(real, same)).toEqual([])

    const fewer = result([finding()])
    const diff = compareAuditForParity(real, fewer)
    expect(diff.length).toBeGreaterThan(0)
    expect(diff.join('\n')).toContain('INV-06')

    const otherKind = result([finding(), finding({ studentId: 's093', kind: 'lecture-overconsumed' })])
    expect(compareAuditForParity(real, otherKind).length).toBeGreaterThan(0)

    const extraCount = { findings: real.findings, counts: { ...real.counts, known: 1 }, notes: [] }
    expect(compareAuditForParity(real, extraCount).join('\n')).toContain('known')
  })
})

describe('名前引きの前後一致(compareNameResolutionForParity)・講師と生徒の表を分ける(修正 1)', () => {
  // 1 枚の表だと「生徒 → 講師の順・先に登録した文字列が勝つ」で、講師の姓が生徒の姓と同じとき講師欄が生徒の仮名になっていた。
  const compare = (real, anonymized) => anonymizeModule.compareNameResolutionForParity(real, anonymized)

  it('姓が同じ講師と生徒がいても、講師欄は講師の仮名になり、講師の名前引きが前後で同じ', () => {
    const input = makePayload()
    // 講師 丙山　三子(表示名 丙山)と同じ姓の生徒。生徒の名簿が先に登録される。
    input.students.push(makeStudentRow('s095', '丙山　花子', ''))
    const { payload } = anonymizeClassroomPayload(input)
    const d1 = desksOf(payload)[0]
    expect(d1.teacher).toBe('講師005')
    expect(d1.statusSlots[0].teacherName).toBe('講師005')
    expect(payload.boardState.groupClassEntries['2026-12-21_1'].teacherName).toBe('講師005')
    expect(payload.boardState.templatePendingDesks['2026-11-12_1::d1'].lower.teacher.teacher).toBe('講師005')
    expect(compare(input, payload)).toEqual([])
  })

  it('同じ表示名の生徒が 2 人いても名前引きが前後で同じ', () => {
    const input = makePayload()
    // s092 と同じ表示名。アプリの名前引きは後の行が勝つ(new Map)。
    input.students.push(makeStudentRow('s096', '甲野　六郎', '甲野'))
    const { payload } = anonymizeClassroomPayload(input)
    expect(compare(input, payload)).toEqual([])
    // 名簿の行と盤面で同じ表を引く(同じ文字列は同じ仮名)
    expect(payload.students[3].displayName).toBe(payload.students[0].displayName)
    expect(desksOf(payload)[0].lesson.studentSlots[0].name).toBe(payload.students[0].displayName)
  })

  it('わざと名簿の仮名だけ変えると食い違いを返す(経路と件数だけ・値は返さない)', () => {
    const input = makePayload()
    const { payload } = anonymizeClassroomPayload(input)
    payload.students[0].displayName = '別の仮名'
    payload.teachers[0].displayName = '別の講師'
    const diff = compare(input, payload)
    expect(diff.length).toBeGreaterThan(0)
    const text = diff.join('\n')
    expect(text).toContain('boardState.weeks[][].desks[].lesson.studentSlots[].name')
    expect(text).toContain('boardState.weeks[][].desks[].teacher')
    for (const name of [...REAL_NAMES, '別の仮名', '別の講師', '生徒092', '講師005']) expect(text).not.toContain(name)
  })

  it('講師の項目の別名は 別講NNN・生徒の項目の別名は 別名NNN。室長は講師の表の中の室長と同じ仮名', () => {
    const input = makePayload()
    desksOf(input)[2].teacher = '架空先生'
    desksOf(input)[0].statusSlots[0].teacherName = '己原室長'
    const { payload, stats } = anonymizeClassroomPayload(input)
    expect(desksOf(payload)[2].teacher).toBe('別講001')
    expect(desksOf(payload)[0].statusSlots[0].teacherName).toBe(payload.managers[0].name)
    expect(payload.managers[0].name).toBe('室長1')
    expect(desksOf(payload)[1].lesson.studentSlots[0].name).toBe('別名001')
    expect(stats.aliases).toBe(2)
  })

  it('teacherAssignmentTeacherId・teacherId は名簿の講師 ID か ID の形(英字＋数字 2 桁以上)ならそのまま', () => {
    const input = makePayload()
    desksOf(input)[2].teacherAssignmentTeacherId = 't099'
    desksOf(input)[2].teacherRest = { teacher: '丁谷', teacherId: 'tch0123' }
    const { payload } = anonymizeClassroomPayload(input)
    expect(desksOf(payload)[2].teacherAssignmentTeacherId).toBe('t099')
    expect(desksOf(payload)[2].teacherRest).toEqual({ teacher: '講師006', teacherId: 'tch0123' })
    // ID の形でない名前は講師の表で引く
    expect(desksOf(payload)[1].teacherAssignmentTeacherId).toBe('講師005')
  })
})
