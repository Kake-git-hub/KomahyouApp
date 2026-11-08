// 講師専用の特別講習(オーナー確定 2026-11-03「生徒側から全部隠す」・spec-special-session-submission §B-3)。
// 隠す場所ごとに「講師専用なら生徒側に出ない/講師側には出る」を固定する(兄弟監査の対象一覧は引き継ぎ書 §4)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import * as xlsx from 'xlsx'
import {
  isTeacherOnlySpecialSession,
  resolveNewSpecialSessionTeacherOnlyFields,
  resolveSubmissionSchedulePublished,
  selectStudentFacingSpecialSessions,
  type SpecialSessionRow,
} from './specialSessionModel'
import { featureRolloutRegistry } from '../../utils/featureRollout'
import { buildSpecialSessionWorkbook, parseSpecialSessionWorkbook } from './SpecialSessionScreen'
import { buildLectureStockEntries } from '../schedule-board/lectureStock'
import { buildParentScheduleView, resolveParentPublishedLectureEndDateKey } from '../../utils/parentSchedule'
import { buildParentScheduleView as buildGeneratedParentScheduleView } from '../../../functions/src/generated/parentSchedule'
import { cloneParentScheduleFixturePayload, PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE } from '../../utils/parentSchedule.fixture'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'

vi.mock('../../integrations/firebase/client', () => ({ getFirebaseFirestoreInstance: () => null }))

const { buildStudentPayload, buildTeacherPayload, resolveSubmissionTokenTargetSessions, toStudentFacingScheduleParams } = await import('../../utils/scheduleHtml')

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function createSession(overrides: Partial<SpecialSessionRow> = {}): SpecialSessionRow {
  return {
    id: 'ss-teacher',
    label: '2026 下期出勤状況',
    startDate: '2026-12-01',
    endDate: '2026-12-15',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-11-03 10:00',
    updatedAt: '2026-11-03 10:00',
    ...overrides,
  }
}

const studentInput = { unavailableSlots: ['2026-12-02_1'], regularBreakSlots: [], subjectSlots: { 数: 2 }, regularOnly: false, countSubmitted: true, submissionToken: 'stu-token', updatedAt: 'x' }
const teacherInput = { unavailableSlots: ['2026-12-02_1'], countSubmitted: true, submissionToken: 'tea-token', updatedAt: 'x' }

describe('isTeacherOnlySpecialSession / selectStudentFacingSpecialSessions', () => {
  it('teacherOnly === true のときだけ講師専用。未設定(既存の講習)と false は従来どおり生徒にも出る', () => {
    expect(isTeacherOnlySpecialSession(createSession({ teacherOnly: true }))).toBe(true)
    expect(isTeacherOnlySpecialSession(createSession({ teacherOnly: false }))).toBe(false)
    expect(isTeacherOnlySpecialSession(createSession())).toBe(false)
    expect(isTeacherOnlySpecialSession(null)).toBe(false)
  })

  it('生徒向けの一覧からは講師専用だけを外す(順番は変えない)', () => {
    const a = createSession({ id: 'a', teacherOnly: true })
    const b = createSession({ id: 'b' })
    const c = createSession({ id: 'c', teacherOnly: false })
    expect(selectStudentFacingSpecialSessions([a, b, c]).map((row) => row.id)).toEqual(['b', 'c'])
    expect(selectStudentFacingSpecialSessions(undefined)).toEqual([])
  })
})

describe('resolveNewSpecialSessionTeacherOnlyFields(作成時だけ付ける)', () => {
  it('フラグ ON でチェックしたときだけ teacherOnly: true。それ以外は項目を付けない', () => {
    expect(resolveNewSpecialSessionTeacherOnlyFields(true, true)).toEqual({ teacherOnly: true })
    expect(resolveNewSpecialSessionTeacherOnlyFields(true, false)).toEqual({})
    expect(resolveNewSpecialSessionTeacherOnlyFields(false, true)).toEqual({})
    expect(resolveNewSpecialSessionTeacherOnlyFields(false, false)).toEqual({})
  })
})

describe('機能フラグ teacherOnlySpecialSession', () => {
  // 開発用・テスト教室と staging で先行(v1.5.685・確認リスト to-1/to-2 OK) → オーナー指示(2026-11-08)で全教室へ昇格。
  // 回帰で staging-environment へ戻さない(戻すと本番教室で「講師専用」チェックが消える。作成済みの講習はデータで隠れ続ける)。
  it('全教室で有効(2026-11-08 昇格)', () => {
    expect(featureRolloutRegistry.teacherOnlySpecialSession.scope).toBe('all-classrooms')
  })
})

describe('特別講習データ画面(配線)', () => {
  const source = readSource('./SpecialSessionScreen.tsx')

  it('チェックはフラグ ON の教室の作成欄だけに出し、作成時だけ付ける(編集欄には出さない)', () => {
    expect(source).toMatch(/\{teacherOnlyEnabled \? \(\s*<label className="special-session-teacher-only-field"/)
    expect(source).toContain('...resolveNewSpecialSessionTeacherOnlyFields(teacherOnlyEnabled, draft.teacherOnly === true)')
    // 編集(updateSession)で teacherOnly を書き換える経路を作らない。
    expect(source).not.toMatch(/updateSession\([^)]*teacherOnly/)
    expect(source.match(/data-testid="special-data-draft-teacher-only"/g)?.length).toBe(1)
  })

  it('講師専用の行は保護者への公開トグルの代わりに文言を出す', () => {
    expect(source).toMatch(/isTeacherOnlySpecialSession\(row\) \? \(\s*<span className="basic-data-muted-inline" data-testid=\{`special-data-schedule-publish-teacher-only-/)
    expect(source).toContain('data-testid={`special-data-teacher-only-badge-${row.id}`}')
  })

  it('App はフラグの値を画面へ渡す', () => {
    const app = readSource('../../App.tsx')
    expect(app).toContain("teacherOnlyEnabled={isFeatureEnabledForClassroom('teacherOnlySpecialSession', actingClassroom)}")
  })
})

describe('Excel の書き出し/取り込み', () => {
  it('既存の講習の講師専用の印を落とさない', () => {
    const existing = [createSession({ teacherOnly: true })]
    const workbook = buildSpecialSessionWorkbook(xlsx, existing, [], [])
    expect(parseSpecialSessionWorkbook(xlsx, workbook, existing)[0]?.teacherOnly).toBe(true)
  })

  it('Excel で新しく増えた講習には付けない(付けられるのは画面の作成欄だけ)', () => {
    const imported = [createSession({ id: 'ss-new', label: '2027 春期講習', teacherOnly: true })]
    const workbook = buildSpecialSessionWorkbook(xlsx, imported, [], [])
    expect(parseSpecialSessionWorkbook(xlsx, workbook, [])[0]).not.toHaveProperty('teacherOnly')
  })

  it('講師専用の講習へは生徒の入力を取り込まない(講師の入力は取り込む)', () => {
    const student: StudentRow = { id: 's001', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
    const teacher: TeacherRow = { id: 't001', name: '講師A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }
    const source = [createSession({ studentInputs: { s001: studentInput }, teacherInputs: { t001: teacherInput } })]
    const workbook = buildSpecialSessionWorkbook(xlsx, source, [student], [teacher])
    const existing = [createSession({ teacherOnly: true })]
    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, existing)
    expect(parsed[0]?.studentInputs).toEqual({})
    expect(Object.keys(parsed[0]?.teacherInputs ?? {})).toEqual(['t001'])
    // 比較: 生徒向けの講習なら生徒の入力も取り込む(ガードを広げすぎていない)。
    const normal = parseSpecialSessionWorkbook(xlsx, workbook, [createSession()])
    expect(Object.keys(normal[0]?.studentInputs ?? {})).toEqual(['s001'])
  })
})

describe('生徒日程表・講師日程表の payload', () => {
  const students: StudentRow[] = [{ id: 's001', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't001', name: '講師A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }]
  const teacherOnly = createSession({ teacherOnly: true, studentInputs: { s001: studentInput }, teacherInputs: { t001: teacherInput } })
  const normal = createSession({ id: 'ss-winter', label: '2026 冬期講習', startDate: '2026-12-22', endDate: '2027-01-07' })
  const base = {
    cells: [],
    defaultStartDate: '2026-12-01',
    defaultEndDate: '2026-12-07',
    titleLabel: 't',
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] },
    periodBands: [teacherOnly, normal],
    specialSessions: [teacherOnly, normal],
  }

  it('生徒日程表は講師専用の講習を一切載せない(講習の選択・帯・提出用QR)', () => {
    const payload = buildStudentPayload({ ...base, students, teachers, regularLessons: [] })
    expect(payload.specialSessions.map((row) => row.id)).toEqual(['ss-winter'])
    expect(payload.periodBands.map((row) => row.id)).toEqual(['ss-winter'])
    expect(payload.qrSessionId).toBe('')
    expect(payload.students[0]?.submissionToken).toBeUndefined()
    expect(payload.students[0]?.submissionSubmitted).toBe(false)
  })

  it('講師日程表は講師専用の講習を従来どおり載せる(講師の提出用QRも出る)', () => {
    const payload = buildTeacherPayload({ ...base, teachers, students, regularLessons: [] })
    expect(payload.specialSessions.map((row) => row.id)).toEqual(['ss-teacher', 'ss-winter'])
    expect(payload.periodBands.map((row) => row.id)).toEqual(['ss-teacher', 'ss-winter'])
    expect(payload.qrSessionId).toBe('ss-teacher')
    expect(payload.teachers[0]?.submissionToken).toBe('tea-token')
  })

  it('印刷用の全員表示は生徒向け(all-student)だけ講師専用を外す', () => {
    expect(toStudentFacingScheduleParams(base).specialSessions?.map((row) => row.id)).toEqual(['ss-winter'])
    const source = readSource('../../utils/scheduleHtml.ts')
    expect(source).toContain("buildAllPayload(viewType === 'all-student' ? toStudentFacingScheduleParams(params) : params)")
    expect(source).toMatch(/export function buildStudentPayload\(rawParams: OpenStudentScheduleHtmlParams\): SchedulePayload \{[\s\S]{0,200}const params = toStudentFacingScheduleParams\(rawParams\)/)
  })
})

describe('生徒の提出用QR(発行しない)', () => {
  it('App の発行処理は講師専用の講習で生徒を 0 人として扱う(講師は従来どおり)', () => {
    const app = readSource('../../App.tsx')
    expect(app).toContain('const activeStudents = isTeacherOnlySpecialSession(session) ? [] : students.filter(')
  })

  it('ensureSubmissionTokens も講師専用では生徒のトークンを作らない(二重の守り)', () => {
    const source = readSource('../../integrations/firebase/lectureSubmission.ts')
    expect(source).toContain('for (const student of isTeacherOnlySpecialSession(session) ? [] : students) {')
  })
})

describe('盤面(生徒を講習として足す・未消化講習)', () => {
  it('生徒を講習として足すときの講習の選択肢に講師専用を出さない', () => {
    const board = readSource('../schedule-board/ScheduleBoardScreen.tsx')
    expect(board).toMatch(/const addableSpecialSessions = useMemo\(\(\) => \{[\s\S]{0,300}return selectStudentFacingSpecialSessions\(specialSessions\)/)
  })

  it('講師専用の講習の生徒入力は未消化講習に数えない', () => {
    const student: StudentRow = { id: 's001', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
    const entries = buildLectureStockEntries({
      specialSessions: [createSession({ teacherOnly: true, studentInputs: { s001: studentInput } }), createSession({ id: 'ss-winter', label: '冬期', studentInputs: { s001: studentInput } })],
      students: [student],
      referenceDate: '2026-11-03',
    })
    expect(entries.map((entry) => entry.sessionId)).toEqual(['ss-winter'])
  })
})

describe('保護者QR(講習期間として扱わない)', () => {
  const withAutumn = (patch: Partial<SpecialSessionRow>) => {
    const payload = cloneParentScheduleFixturePayload() as { specialSessions: SpecialSessionRow[] }
    payload.specialSessions = payload.specialSessions.map((session) => ({ ...session, ...patch }))
    return payload
  }
  const lectureRowsOn = (build: typeof buildParentScheduleView, payload: unknown, dateKey: string) => {
    const view = build(payload, 's001', { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE })
    return (view?.days.find((day) => day.dateKey === dateKey)?.lessons ?? []).filter((lesson) => lesson.kind === 'lecture')
  }

  it('公開扱いでも講師専用の講習の期間は講習コマを出さない(src と functions の写しの両方)', () => {
    for (const build of [buildParentScheduleView, buildGeneratedParentScheduleView] as const) {
      expect(lectureRowsOn(build, withAutumn({ schedulePublished: true }), '2026-10-02')).toHaveLength(1)
      expect(lectureRowsOn(build, withAutumn({ schedulePublished: true, teacherOnly: true }), '2026-10-02')).toEqual([])
    }
  })

  it('「次の月」の上限も講師専用の講習では延ばさない', () => {
    const sessions = (teacherOnly?: boolean) => ({ specialSessions: [{ startDate: '2026-12-22', endDate: '2027-01-07', schedulePublished: true, ...(teacherOnly ? { teacherOnly } : {}) }] })
    expect(resolveParentPublishedLectureEndDateKey(sessions(), '2026-12-03')).toBe('2027-01-07')
    expect(resolveParentPublishedLectureEndDateKey(sessions(true), '2026-12-03')).toBe('')
  })
})

// ── regression-reviewer 指摘(2026-11-03)への対応 ─────────────────────────────
describe('提出用QRを発行する講習は日程表が QR を出す講習と同じ(指摘 M-1)', () => {
  const teacherOnly = createSession({ teacherOnly: true })
  const winter = createSession({ id: 'ss-winter', label: '2026 冬期講習', startDate: '2026-12-22', endDate: '2027-01-07' })
  const students: StudentRow[] = [{ id: 's001', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't001', name: '講師A', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }]

  it('表示範囲が講師専用と生徒向けの両方に掛かると、生徒向けと講師専用の両方を返す(生徒日程表は冬期・講師日程表は講師専用)', () => {
    for (const [start, end] of [['2026-12-01', '2026-12-31'], ['2026-11-25', '2026-12-24']]) {
      expect(resolveSubmissionTokenTargetSessions([teacherOnly, winter], start, end).map((row) => row.id), `${start}〜${end}`).toEqual(['ss-winter', 'ss-teacher'])
      const base = { cells: [], defaultStartDate: start, defaultEndDate: end, titleLabel: 't', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, specialSessions: [teacherOnly, winter] }
      expect(buildStudentPayload({ ...base, students, teachers, regularLessons: [] }).qrSessionId).toBe('ss-winter')
      expect(buildTeacherPayload({ ...base, teachers, students, regularLessons: [] }).qrSessionId).toBe('ss-teacher')
    }
  })

  it('講師専用が無ければ従来どおり 1 件(No.201 の選び方のまま)', () => {
    const autumn = createSession({ id: 'ss-autumn', label: '秋', startDate: '2026-11-20', endDate: '2026-11-30' })
    expect(resolveSubmissionTokenTargetSessions([autumn, winter], '2026-11-25', '2026-12-31').map((row) => row.id)).toEqual(['ss-autumn'])
    expect(resolveSubmissionTokenTargetSessions([teacherOnly], '2026-12-01', '2026-12-07').map((row) => row.id)).toEqual(['ss-teacher'])
    expect(resolveSubmissionTokenTargetSessions([teacherOnly, winter], '2026-02-01', '2026-02-07')).toEqual([])
  })

  it('App の発行処理はこの関数が返す講習を全部処理する', () => {
    const app = readSource('../../App.tsx')
    expect(app).toContain('for (const session of resolveSubmissionTokenTargetSessions(specialSessions, scheduleStartDate, scheduleEndDate)) {')
    expect(app).not.toContain('const session = resolveDisplayedOverlappingSession(specialSessions, scheduleStartDate, scheduleEndDate)')
  })
})

describe('講師専用の講習は提出用QRで常に公開扱い(指摘 M-2: 講師の提出後の画面を「準備中」にしない)', () => {
  it('トグルが使える教室でも講師専用なら公開。生徒向けは従来どおり schedulePublished に従う', () => {
    expect(resolveSubmissionSchedulePublished(createSession({ teacherOnly: true, schedulePublished: false }), true)).toBe(true)
    expect(resolveSubmissionSchedulePublished(createSession({ schedulePublished: false }), true)).toBe(false)
    expect(resolveSubmissionSchedulePublished(createSession({ schedulePublished: false }), false)).toBe(true)
    // 未設定の生徒向け講習は非公開(2026-11-08 オーナー指示)。講師専用は未設定でも公開。
    expect(resolveSubmissionSchedulePublished(createSession(), true)).toBe(false)
    expect(resolveSubmissionSchedulePublished(createSession({ teacherOnly: true }), true)).toBe(true)
    expect(resolveSubmissionSchedulePublished(createSession(), false)).toBe(true)
  })

  it('講師専用で作るときは非公開の項目を付けない。App はこの関数で公開を決める', () => {
    const screen = readSource('./SpecialSessionScreen.tsx')
    expect(screen).toContain('...resolveNewSpecialSessionScheduleFields(schedulePublishToggleEnabled && !(teacherOnlyEnabled && draft.teacherOnly === true)),')
    const app = readSource('../../App.tsx')
    expect(app).toContain("const schedulePublished = resolveSubmissionSchedulePublished(session, isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom))")
  })
})

describe('Excel は講習 ID で講師専用の印を照合する(指摘 L-1)', () => {
  it('名前を変えても講習 ID が同じなら印が残る', () => {
    const existing = [createSession({ teacherOnly: true })]
    const workbook = buildSpecialSessionWorkbook(xlsx, [createSession({ label: '名前を変えた講習' })], [], [])
    expect(parseSpecialSessionWorkbook(xlsx, workbook, existing)[0]?.teacherOnly).toBe(true)
  })

  it('別の講習 ID で同じ名前の行は印を受け継がない', () => {
    const existing = [createSession({ teacherOnly: true })]
    const workbook = buildSpecialSessionWorkbook(xlsx, [createSession({ id: 'ss-other' })], [], [])
    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, existing)
    expect(parsed[0]?.id).toBe('ss-other')
    expect(parsed[0]).not.toHaveProperty('teacherOnly')
  })
})

describe('保護者QR: 講師専用の講習の ID を持つ講習コマは公開中の講習の期間にあっても出さない(指摘 L-2)', () => {
  it('src と functions の写しの両方', () => {
    const payload = cloneParentScheduleFixturePayload() as {
      specialSessions: SpecialSessionRow[]
      boardState: { weeks: Array<Array<{ id: string; desks: Array<{ lesson?: { studentSlots: Array<Record<string, unknown> | null> } }> }>> }
    }
    payload.specialSessions = [
      ...payload.specialSessions.map((session) => ({ ...session, schedulePublished: true })),
      createSession({ teacherOnly: true }),
    ]
    const cell = payload.boardState.weeks[2]!.find((entry) => entry.id === '2026-10-02_1')!
    const slot = cell.desks[0]!.lesson!.studentSlots[0]!
    for (const build of [buildParentScheduleView, buildGeneratedParentScheduleView] as const) {
      cell.desks[0]!.lesson!.studentSlots[0] = { ...slot }
      const shown = build(payload, 's001', { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE })
      expect(shown?.days.find((day) => day.dateKey === '2026-10-02')?.lessons.some((lesson) => lesson.kind === 'lecture')).toBe(true)
      cell.desks[0]!.lesson!.studentSlots[0] = { ...slot, specialSessionId: 'ss-teacher' }
      const hidden = build(payload, 's001', { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE })
      expect(hidden?.days.find((day) => day.dateKey === '2026-10-02')?.lessons.some((lesson) => lesson.kind === 'lecture') ?? false).toBe(false)
    }
  })
})

describe('生徒日程表からのメッセージは講師専用の講習に入れない(指摘 L-3・多重の守り)', () => {
  it('不可コマの保存・希望数の保存の両方で講師専用なら何もしない', () => {
    const app = readSource('../../App.tsx')
    for (const type of ['schedule-student-unavailable-save', 'schedule-student-count-save']) {
      const start = app.indexOf(`if (message.type === '${type}') {`)
      expect(start, type).toBeGreaterThan(0)
      expect(app.slice(start, start + 400), type).toContain('if (isTeacherOnlySpecialSession(specialSessionsRef.current.find((session) => session.id === message.sessionId))) return')
    }
  })
})
