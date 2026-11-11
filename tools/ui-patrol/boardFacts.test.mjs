// tools/ui-patrol/boardFacts.ts(画面の自動巡回の「盤面の事実」)を固定する。
// 操作の前後の教室データを、盤面の「意味」(本物の講師・生徒・科目・授業の種類・出自・出欠記録・メモ・保留の下段)に直して比べる。
// フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・生徒C・講師A・講師B)。
import { describe, it, expect } from 'vitest'
import { BOARD_FACT_SECTIONS, collectBoardFacts, diffBoardFacts, isEmptyDeskFact } from './boardFacts.ts'

function makeStudentEntry(overrides = {}) {
  return { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function makeStatusEntry(overrides = {}) {
  return {
    id: 'st1', studentId: 'e1', sourceManagedLesson: true, name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular',
    teacherType: 'normal', teacherName: '', dateKey: '2026-11-19', slotNumber: 3, recordedAt: '2026-11-01T00:00:00.000Z', status: 'absent', sourceLessonId: 'L1',
    ...overrides,
  }
}

function makeDesk(id, studentSlots = [null, null], overrides = {}) {
  return { id, teacher: '', lesson: { id: `L-${id}`, studentSlots }, ...overrides }
}

function makeCell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function makePayload({ weeks, board = {}, settings = {}, extra = {} } = {}) {
  return {
    screen: 'board',
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...settings },
    managers: [],
    teachers: [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師B' }],
    students: [{ id: 's1', name: '生徒A' }, { id: 's2', name: '生徒B' }],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: {
      weeks: weeks ?? [[makeCell('2026-11-19', 3, [makeDesk('d1'), makeDesk('d2')])]],
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

const CELL_ID = '2026-11-19_3'

describe('盤面の事実(collectBoardFacts)', () => {
  it('机ごとの事実: 本物の講師・生徒 2 席・出自・出欠記録・メモ・保留の下段', () => {
    const desk1 = makeDesk('d1', [
      makeStudentEntry({ origin: 'template' }),
      makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2', subject: '英', lessonType: 'makeup', makeupSourceDate: '2026-11-12' }),
    ], {
      teacher: '講師A', teacherAssignmentSource: 'manual',
      statusSlots: [makeStatusEntry({ status: 'absent' }), null],
      memoSlots: ['メモ', '  '],
    })
    const desk2 = makeDesk('d2', [null, null], { teacher: '講師B' })
    const payload = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [desk1, desk2])]],
      board: {
        templatePendingDesks: {
          [`${CELL_ID}::d2`]: {
            lower: {
              lesson: { id: 'LP', studentSlots: [makeStudentEntry({ id: 'e3', name: '生徒C', managedStudentId: undefined, lessonType: 'extra', manualAdded: true }), null] },
              teacher: { teacher: '講師A', manualTeacher: true },
            },
            effectiveStartDate: '2026-11-19', createdAt: '2026-11-10T00:00:00.000Z',
          },
        },
      },
    })
    const facts = collectBoardFacts(payload)
    expect(facts.pendingDeskCount).toBe(1)
    const fact1 = facts.desks.get(`${CELL_ID}#0`)
    expect(fact1).toMatchObject({
      key: `${CELL_ID}#0`, cellId: CELL_ID, dateKey: '2026-11-19', slotNumber: 3, deskIndex: 0,
      teacher: '講師A', teacherOrigin: 'manual', teacherRest: false,
      students: [
        { key: 's1', name: '生徒A', subject: '数', lessonType: 'regular', origin: 'template' },
        { key: 's2', name: '生徒B', subject: '英', lessonType: 'makeup', origin: 'manual' },
      ],
      statuses: ['s1|absent|数|regular'],
      memos: ['メモ'],
      pendingStudents: [],
      pendingTeacher: '',
    })
    const fact2 = facts.desks.get(`${CELL_ID}#1`)
    expect(fact2).toMatchObject({
      teacher: '講師B', teacherOrigin: 'template', students: [null, null],
      pendingStudents: [{ key: 'name:生徒C', name: '生徒C', subject: '数', lessonType: 'extra', origin: 'manual' }],
      pendingTeacher: '講師A',
    })
    expect(typeof fact1.signature).toBe('string')
    // 署名に位置の項目は入れない(机番号だけ違う同じ中身は同じ署名)
    expect(fact1.signature).not.toContain(CELL_ID)
    expect(isEmptyDeskFact(fact1)).toBe(false)
  })

  it('埋め草の講師（講師未割当）と空は講師なし。講師の休みは teacherRest', () => {
    const payload = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        makeDesk('d1', [null, null], { teacher: '講師未割当', manualTeacher: true }),
        makeDesk('d2', [null, null], { teacher: '講師未割当' }),
        makeDesk('d3', [null, null], { teacher: '' }),
        makeDesk('d4', [makeStudentEntry(), null], { teacher: '', teacherRest: { teacher: '講師A', teacherId: 't1' } }),
      ])]],
    })
    const facts = collectBoardFacts(payload)
    for (const index of [0, 1, 2]) {
      const fact = facts.desks.get(`${CELL_ID}#${index}`)
      expect(fact.teacher).toBe('')
      expect(fact.teacherOrigin).toBeNull()
      expect(fact.teacherRest).toBe(false)
      expect(isEmptyDeskFact(fact)).toBe(true)
    }
    const rested = facts.desks.get(`${CELL_ID}#3`)
    expect(rested.teacher).toBe('')
    expect(rested.teacherRest).toBe(true)
  })

  it('講師を消した記録のある机は teacherDeleted。生徒が居ても・講師が居れば別。署名には入れない(Issue #85)', () => {
    const payload = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        makeDesk('d1', [makeStudentEntry(), null], { teacher: '', teacherAssignmentSource: 'deleted' }),
        makeDesk('d2', [makeStudentEntry(), null], { teacher: '' }),
        makeDesk('d3', [makeStudentEntry(), null], { teacher: '講師A', teacherAssignmentSource: 'deleted' }),
        makeDesk('d4', [null, null], { teacher: '', teacherAssignmentSource: 'deleted', teacherAssignmentSessionId: 'sp1' }),
      ])]],
    })
    const facts = collectBoardFacts(payload)
    const flags = [0, 1, 2, 3].map((index) => facts.desks.get(`${CELL_ID}#${index}`).teacherDeleted)
    expect(flags).toEqual([true, false, false, true])
    // 比べる中身(署名)は変えない: 記録の有無だけが違う机は同じ署名。
    const plain = collectBoardFacts(makePayload({ weeks: [[makeCell('2026-11-19', 3, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '' })])]] }))
    expect(plain.desks.get(`${CELL_ID}#0`).teacherDeleted).toBe(false)
    expect(plain.desks.get(`${CELL_ID}#0`).signature).toBe(facts.desks.get(`${CELL_ID}#0`).signature)
    expect(diffBoardFacts(plain, facts).desks.filter((change) => change.key === `${CELL_ID}#0`)).toEqual([])
  })

  it('出自はアプリの権威関数どおり（印が無い振替は手入力・印が無い通常はテンプレ）', () => {
    const payload = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        makeDesk('d1', [makeStudentEntry({ lessonType: 'makeup' }), makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2' })]),
        makeDesk('d2', [makeStudentEntry({ origin: 'manual' }), makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2', lessonType: 'makeup', origin: 'template' })]),
      ])]],
    })
    const facts = collectBoardFacts(payload)
    expect(facts.desks.get(`${CELL_ID}#0`).students.map((student) => student.origin)).toEqual(['manual', 'template'])
    // 印 'manual' の通常は手入力・手入力の区分(振替)は印 template より優先(resolveStudentOrigin)
    expect(facts.desks.get(`${CELL_ID}#1`).students.map((student) => student.origin)).toEqual(['manual', 'manual'])
  })

  it('内部の印だけの違い（origin の付け直し・lesson.id・manualTeacher の有無）は署名が変わらない／講師の出自の違いは変わる', () => {
    const before = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A', teacherAssignmentSource: 'manual' }),
        makeDesk('d2', [makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2' }), null], { teacher: '講師B' }),
      ])]],
    })
    const reloaded = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        { ...makeDesk('dX', [makeStudentEntry({ id: 'eX', origin: 'template' }), null], { teacher: '講師A', teacherAssignmentSource: 'manual', manualTeacher: true, teacherAssignmentTeacherId: 't1' }), lesson: { id: 'other', studentSlots: [makeStudentEntry({ id: 'eX', origin: 'template' }), null] } },
        makeDesk('d2', [makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2', origin: 'template' }), null], { teacher: '講師B' }),
      ])]],
    })
    const factsBefore = collectBoardFacts(before)
    const factsReloaded = collectBoardFacts(reloaded)
    expect(factsReloaded.desks.get(`${CELL_ID}#0`).signature).toBe(factsBefore.desks.get(`${CELL_ID}#0`).signature)
    expect(factsReloaded.desks.get(`${CELL_ID}#1`).signature).toBe(factsBefore.desks.get(`${CELL_ID}#1`).signature)
    expect(diffBoardFacts(factsBefore, factsReloaded)).toEqual({ desks: [], sections: [] })

    // 講師B を手で置き直した(テンプレ → 手入力)＝講師名は同じでも意味が違う
    const manualTeacher = makePayload({
      weeks: [[makeCell('2026-11-19', 3, [
        makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A', teacherAssignmentSource: 'manual' }),
        makeDesk('d2', [makeStudentEntry({ id: 'e2', name: '生徒B', managedStudentId: 's2' }), null], { teacher: '講師B', manualTeacher: true }),
      ])]],
    })
    const factsManual = collectBoardFacts(manualTeacher)
    expect(factsManual.desks.get(`${CELL_ID}#1`).signature).not.toBe(factsBefore.desks.get(`${CELL_ID}#1`).signature)
    expect(diffBoardFacts(factsBefore, factsManual).desks.map((change) => [change.key, change.fields])).toEqual([[`${CELL_ID}#1`, ['teacher']]])
  })

  it('差分: 変わった机と項目・変わった部分（sections）を返す。片方にしか無い空の机は数えない', () => {
    const before = makePayload({
      weeks: [[
        makeCell('2026-11-19', 3, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A' }), makeDesk('d2')]),
        makeCell('2026-11-20', 1, [makeDesk('d1'), makeDesk('d2', [null, null], { memoSlots: ['メモ', null] })]),
      ]],
    })
    const after = makePayload({
      weeks: [[
        makeCell('2026-11-19', 3, [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師B' }), makeDesk('d2'), makeDesk('d3')]),
        makeCell('2026-11-20', 1, [makeDesk('d1'), makeDesk('d2'), makeDesk('d3', [null, null], { teacher: '講師A' })]),
      ]],
      extra: { specialSessions: [{ id: 'sp1', label: '冬期講習' }] },
    })
    const diff = diffBoardFacts(collectBoardFacts(before), collectBoardFacts(after))
    expect(diff.desks.map((change) => [change.key, change.fields])).toEqual([
      [`${CELL_ID}#0`, ['teacher']],
      ['2026-11-20_1#1', ['memos']],
      ['2026-11-20_1#2', ['teacher']],
    ])
    const added = diff.desks.find((change) => change.key === '2026-11-20_1#2')
    expect(added.before).toBeNull()
    expect(added.after.teacher).toBe('講師A')
    expect(diff.sections).toEqual(['specialSessions'])
    expect(BOARD_FACT_SECTIONS).toContain('specialSessions')
    expect(BOARD_FACT_SECTIONS).toContain('classroomSettings.template')
    expect(BOARD_FACT_SECTIONS).toContain('classroomSettings.other')
    expect(BOARD_FACT_SECTIONS).toContain('boardState.groupClassEntries')
  })

  it('画面の状態（weekIndex・selectedCellId・在庫パネルの開閉）は比べない', () => {
    const desks = () => [makeDesk('d1', [makeStudentEntry(), null], { teacher: '講師A' }), makeDesk('d2')]
    const before = makePayload({ weeks: [[makeCell('2026-11-19', 3, desks())]], settings: { savedAt: '2026-11-10T00:00:00.000Z' } })
    const after = makePayload({
      // 週は { cells } の形でも同じ読み方をする(tools/invAuditEntry.ts の normalizeWeeks と同じ)
      weeks: [{ cells: [makeCell('2026-11-19', 3, desks())] }],
      settings: { savedAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' },
      board: {
        weekIndex: 3, selectedCellId: CELL_ID, selectedDeskIndex: 1, isLectureStockOpen: true, isMakeupStockOpen: true,
        studentScheduleRange: { startDate: '2026-11-01', endDate: '2026-11-30', periodValue: 'x' },
        teacherScheduleRange: { startDate: '2026-11-01', endDate: '2026-11-30', periodValue: 'x' },
      },
      extra: { screen: 'basic-data' },
    })
    expect(diffBoardFacts(collectBoardFacts(before), collectBoardFacts(after))).toEqual({ desks: [], sections: [] })
  })

  it('休みの講師が誰かも署名に入る（講師A → 講師B の休みは変わる・同じなら変わらない）', () => {
    const withRest = (teacher) => makePayload({ weeks: [[makeCell('2026-11-19', 3, [makeDesk('d1', [makeStudentEntry(), null], { teacherRest: { teacher } }), makeDesk('d2')])]] })
    const factA = collectBoardFacts(withRest('講師A'))
    expect(factA.desks.get(`${CELL_ID}#0`).teacherRestName).toBe('講師A')
    expect(collectBoardFacts(withRest('講師A')).desks.get(`${CELL_ID}#0`).signature).toBe(factA.desks.get(`${CELL_ID}#0`).signature)
    const diff = diffBoardFacts(factA, collectBoardFacts(withRest('講師B')))
    expect(diff.desks.map((change) => [change.key, change.fields])).toEqual([[`${CELL_ID}#0`, ['teacher']]])
    expect(collectBoardFacts(makePayload()).desks.get(`${CELL_ID}#0`).teacherRestName).toBe('')
  })

  it('盤面の週に無い机の保留は部分 boardState.templatePendingDesks.unmatched で比べる', () => {
    const orphan = (studentName) => ({
      'gone_cell::dZ': {
        lower: { lesson: { id: 'LP', studentSlots: [makeStudentEntry({ name: studentName, managedStudentId: undefined, manualAdded: true }), null] } },
        effectiveStartDate: '2026-11-19', createdAt: '2026-11-10T00:00:00.000Z',
      },
    })
    expect(BOARD_FACT_SECTIONS).toContain('boardState.templatePendingDesks.unmatched')
    const before = collectBoardFacts(makePayload({ board: { templatePendingDesks: orphan('生徒A') } }))
    expect(before.pendingDeskCount).toBe(1)
    const same = collectBoardFacts(makePayload({ board: { templatePendingDesks: orphan('生徒A') } }))
    expect(diffBoardFacts(before, same).sections).toEqual([])
    const gone = collectBoardFacts(makePayload())
    expect(diffBoardFacts(before, gone).sections).toEqual(['boardState.templatePendingDesks.unmatched'])
    // 机に結べた保留はこの部分に入らない(机の事実で比べる)
    const matched = collectBoardFacts(makePayload({ board: { templatePendingDesks: { [`${CELL_ID}::d1`]: orphan('生徒A')['gone_cell::dZ'] } } }))
    expect(diffBoardFacts(gone, matched).sections).toEqual([])
  })

  it('教室設定のテンプレとそれ以外は別の部分として数える。boardState が無い教室でも落ちない', () => {
    const before = makePayload()
    const after = makePayload({ settings: { regularLessonTemplate: { effectiveStartDate: '2027-02-01', cells: [] }, holidayDates: ['2026-12-31'] } })
    expect(diffBoardFacts(collectBoardFacts(before), collectBoardFacts(after)).sections).toEqual(['classroomSettings.template', 'classroomSettings.other'])
    const empty = collectBoardFacts({ ...makePayload(), boardState: null })
    expect(empty.desks.size).toBe(0)
    expect(empty.pendingDeskCount).toBe(0)
  })
})
