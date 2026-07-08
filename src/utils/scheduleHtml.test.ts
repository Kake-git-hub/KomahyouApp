import { describe, expect, it, vi } from 'vitest'
import { buildCombinedRegularLessonsFromHistory, buildExpectedRegularOccurrences, buildSerializedScheduleCountAdjustments, openAllScheduleHtml, openStudentScheduleHtml, openTeacherScheduleHtml } from './scheduleHtml'
import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { RegularLessonTemplate } from '../components/regular-template/regularLessonTemplate'
import type { SlotCell } from '../components/schedule-board/types'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
    ...overrides,
  }
}

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中講師',
    displayName: '田中',
    email: 'teacher@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    ...overrides,
  }
}

function createRegularLesson(overrides: Partial<RegularLessonRow> = {}): RegularLessonRow {
  return {
    id: 'regular-1',
    schoolYear: 2025,
    teacherId: 'teacher-1',
    student1Id: 'student-1',
    subject1: '数',
    startDate: '',
    endDate: '',
    student2Id: '',
    subject2: '',
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek: 2,
    slotNumber: 4,
    ...overrides,
  }
}

function createManualScheduleCell(): SlotCell {
  return {
    id: '2026-03-24_3',
    dateKey: '2026-03-24',
    dayLabel: '火',
    dateLabel: '3/24',
    slotLabel: '3限',
    slotNumber: 3,
    timeLabel: '16:20-17:50',
    isOpenDay: true,
    desks: [{
      id: '2026-03-24_3_desk_1',
      teacher: '田中講師',
      lesson: {
        id: 'manual-regular',
        studentSlots: [{
          id: 'student-entry-1',
          name: '山田',
          managedStudentId: 'student-1',
          grade: '中3',
          subject: '数',
          lessonType: 'regular',
          teacherType: 'normal',
          manualAdded: true,
        }, null],
      },
    }],
  }
}

describe('scheduleHtml buildExpectedRegularOccurrences', () => {
  it('returns all weekly occurrences in a month without monthly cap', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      startDate: '2026-03-02',
      endDate: '2026-03-31',
    })

    // Filter to March 2026 to verify all 5 Tuesdays are included (no cap)
    const marchDates = occurrences.filter((e) => e.dateKey >= '2026-03-01' && e.dateKey <= '2026-03-31').map((e) => e.dateKey)
    // March 2026 has 5 Tuesdays (3/3,3/10,3/17,3/24,3/31) → all included
    expect(marchDates).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
    ])
  })

  it('returns all occurrences in display range without monthly cap', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      startDate: '2026-03-16',
      endDate: '2026-03-31',
    })

    // All March Tuesdays after 3/16 (no cap): 3/17, 3/24, 3/31
    const lateMarchDates = occurrences.filter((e) => e.dateKey >= '2026-03-16' && e.dateKey <= '2026-03-31').map((e) => e.dateKey)
    expect(lateMarchDates).toEqual([
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
    ])
  })

  it('accumulates expected occurrences across school year boundary', () => {
    // Display spans March-April, crossing the 2025→2026 school year boundary.
    // Both school year lessons are needed to cover March (2025) and April (2026).
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [
        createRegularLesson({ schoolYear: 2025 }),
        createRegularLesson({ id: 'regular-sy2026', schoolYear: 2026 }),
      ],
      startDate: '2026-03-02',
      endDate: '2026-04-30',
    })

    // Filter to March-April to verify cross-boundary behavior
    const springDates = occurrences.filter((e) => e.dateKey >= '2026-03-02' && e.dateKey <= '2026-04-30').map((e) => e.dateKey)
    // March 2026 Tuesdays (from schoolYear 2025): 3/3,3/10,3/17,3/24,3/31 → all 5
    // April 2026 Tuesdays (from schoolYear 2026): 4/7,4/14,4/21,4/28 → 4 dates
    expect(springDates).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
      '2026-04-07',
      '2026-04-14',
      '2026-04-21',
      '2026-04-28',
    ])
  })

  it('deduplicates occurrences when multiple school year lessons cover overlapping dates', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [
        createRegularLesson({ schoolYear: 2025 }),
        createRegularLesson({ id: 'regular-2', schoolYear: 2026 }),
      ],
      startDate: '2026-03-02',
      endDate: '2026-04-30',
    })

    // Both lessons generate same student+day+subject; dedup ensures no double-counting
    const springDates = occurrences.filter((e) => e.dateKey >= '2026-03-02' && e.dateKey <= '2026-04-30').map((e) => e.dateKey)
    expect(springDates).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
      '2026-04-07',
      '2026-04-14',
      '2026-04-21',
      '2026-04-28',
    ])
  })

  it('returns full participant period occurrences even when display range is narrow', () => {
    // Template-generated lessons have explicit startDate/endDate set.
    // Even with a narrow display range (1 week), the function returns all
    // occurrences in the participant period so the popup can filter freely.
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson({
        schoolYear: 2026,
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        student2StartDate: '2026-04-01',
        student2EndDate: '2027-03-31',
      })],
      startDate: '2026-05-04',
      endDate: '2026-05-09',
    })

    // Function returns the full school year, not just the display range.
    // Verify April-May occurrences are present even though display range is May week 1 only.
    const aprilMayDates = occurrences.filter((e) => e.dateKey >= '2026-04-06' && e.dateKey <= '2026-05-09').map((e) => e.dateKey)
    expect(aprilMayDates).toEqual([
      '2026-04-07',
      '2026-04-14',
      '2026-04-21',
      '2026-04-28',
      '2026-05-05',
    ])
  })

  it('keeps expected regular counts on both sides of a month boundary', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson({
        schoolYear: 2026,
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        student2StartDate: '2026-04-01',
        student2EndDate: '2027-03-31',
      })],
      startDate: '2026-04-27',
      endDate: '2026-05-10',
    })

    const visibleDates = occurrences
      .filter((entry) => entry.dateKey >= '2026-04-27' && entry.dateKey <= '2026-05-10')
      .map((entry) => entry.dateKey)

    expect(visibleDates).toEqual(['2026-04-28', '2026-05-05'])
  })

  it('serializes regular and lecture count adjustments for student schedule counts', () => {
    const adjustments = buildSerializedScheduleCountAdjustments({
      cells: [createManualScheduleCell()],
      scheduleCountAdjustments: [
        {
          studentKey: 'student-1',
          subject: '数',
          countKind: 'regular',
          dateKey: '2026-03-24',
          delta: -1,
        },
        {
          studentKey: 'student-1',
          subject: '英',
          countKind: 'special',
          dateKey: '2026-03-25',
          delta: -1,
        },
      ],
    })

    expect(adjustments).toEqual([
      {
        studentKey: 'student-1',
        subject: '数',
        countKind: 'regular',
        dateKey: '2026-03-24',
        delta: -1,
      },
      {
        studentKey: 'student-1',
        subject: '英',
        countKind: 'special',
        dateKey: '2026-03-25',
        delta: -1,
      },
    ])
  })

  it('links board-visible lessons by managed student id even when the stored display name is stale', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    const cell = createManualScheduleCell()
    cell.desks[0].lesson!.studentSlots[0]!.name = '旧表示名'

    openStudentScheduleHtml({
      cells: [cell],
      students: [createStudent({ displayName: '新表示名' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const student = payload.cells[0]?.desks?.[0]?.lesson?.students?.[0]
    expect(student?.name).toBe('旧表示名')
    expect(student?.linkedStudentId).toBe('student-1')

    vi.unstubAllGlobals()
  })

  // 別タブ日程表の「同期中」スピナー(オーナー指示 2026-07-08)。盤面編集→別タブ反映までの数秒、
  // 最前面に大きく出す。本体は __showScheduleSyncing() で出し、同期ペイロード適用(flushIncomingPayload)で消す。
  it('別タブ日程表に同期中スピナー(overlay + __showScheduleSyncing + flushで自動非表示)を含む', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [createManualScheduleCell()],
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('id="schedule-sync-overlay"')
    expect(html).toContain('window.__showScheduleSyncing = showScheduleSyncingOverlay')
    // flushIncomingPayload の末尾で必ず非表示にする(等価ペイロードでも固着しない)
    expect(html).toContain('hideScheduleSyncingOverlay();')

    vi.unstubAllGlobals()
  })

  // 回帰防止(2026-07-04 監査領域9 A1 オーナー確定): plannedCells は埋め込みJSから一度も読まれないデッド payload
  // だったため撤去した。planned 通常回数の唯一の根拠は expectedRegularOccurrences(テンプレ由来)。
  // plannedCells を payload に復活させる変更(=毎同期の無駄な生成/シリアライズと「二重の planned 根拠」の再発)を検知する。
  it('監査領域9 A1: payload に plannedCells を含めない(planned の唯一の根拠は expectedRegularOccurrences)', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [createManualScheduleCell()],
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect('plannedCells' in payload).toBe(false)
    expect(Array.isArray(payload.expectedRegularOccurrences)).toBe(true)

    vi.unstubAllGlobals()
  })

  it('links board-visible lessons by normalized student name when managed student id is missing', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    const cell = createManualScheduleCell()
    const studentEntry = cell.desks[0].lesson!.studentSlots[0]!
    delete studentEntry.managedStudentId
    studentEntry.name = '山野櫂'

    openStudentScheduleHtml({
      cells: [cell],
      students: [createStudent({ name: '山野 櫂', displayName: '山野　櫂' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const student = payload.cells[0]?.desks?.[0]?.lesson?.students?.[0]
    expect(student?.name).toBe('山野櫂')
    expect(student?.linkedStudentId).toBe('student-1')

    vi.unstubAllGlobals()
  })

  it('does not link ambiguous display-name lessons to one student in all-student print view', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openAllScheduleHtml({
      viewType: 'all-student',
      cells: [{
        id: '2026-03-24_3',
        dateKey: '2026-03-24',
        dayLabel: '火',
        dateLabel: '3/24',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [{
          id: 'desk-1',
          teacher: '田中講師',
          lesson: {
            id: 'lesson-ambiguous',
            studentSlots: [{
              id: 'entry-ambiguous',
              name: '佐藤',
              grade: '中2',
              subject: '英',
              lessonType: 'regular',
              teacherType: 'normal',
            }, null],
          },
        }],
      }],
      students: [
        createStudent({ id: 'student-sato-taro', name: '佐藤 太郎', displayName: '佐藤', birthDate: '2012-05-01' }),
        createStudent({ id: 'student-sato-hanako', name: '佐藤 花子', displayName: '佐藤', birthDate: '2012-09-01' }),
      ],
      teachers: [createTeacher()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      classroomStorageKey: 'classroom_green',
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const student = payload.cells[0]?.desks?.[0]?.lesson?.students?.[0]
    expect(student?.name).toBe('佐藤')
    expect(student?.linkedStudentId).toBeUndefined()
    expect(html).toContain('getStudentAssignmentKeys(student).flatMap')

    vi.unstubAllGlobals()
  })

  it('shows submitted status without a QR resubmission reset action', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      location: { origin: 'https://komahyouapp-prod.web.app' },
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      specialSessions: [{
        id: 'session-1',
        label: '春期講習',
        startDate: '2026-03-20',
        endDate: '2026-03-31',
        teacherInputs: {},
        studentInputs: {
          'student-1': {
            unavailableSlots: [],
            regularBreakSlots: [],
            subjectSlots: { 数: 2 },
            regularOnly: false,
            countSubmitted: true,
            submissionToken: 'submittedtoken123456',
            updatedAt: '2026-03-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('希望<br>提出済')
    expect(html).not.toContain('submission-reset-badge')
    expect(html).not.toContain('schedule-submission-reset')

    vi.unstubAllGlobals()
  })

  it('keeps submitted QR metadata for development popups without embedding the svg payload', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      location: { origin: 'https://komahyouapp-prod.web.app' },
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      lazyQrLoading: true,
      showSubmittedQr: true,
      specialSessions: [{
        id: 'session-1',
        label: '春期講習',
        startDate: '2026-03-20',
        endDate: '2026-03-31',
        teacherInputs: {},
        studentInputs: {
          'student-1': {
            unavailableSlots: [],
            regularBreakSlots: [],
            subjectSlots: { 数: 2 },
            regularOnly: false,
            countSubmitted: true,
            submissionToken: 'submittedtoken123456',
            updatedAt: '2026-03-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).not.toBeNull()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.showSubmittedQr).toBe(true)
    expect(payload.students[0]?.submissionToken).toBe('submittedtoken123456')
    expect(payload.students[0]?.qrSvg).toBeUndefined()
    expect(payload.students[0]?.submissionSubmitted).toBe(true)
    expect(html).toContain('scheduleDataElement.remove()')
    expect(html).toContain('window.opener.__buildScheduleQrSvg')
    expect(html).toContain('buildScheduleQrHtml(student, showQr)')
    expect(html).toContain('function scheduleIncomingPayload(nextPayload)')
    expect(html).toContain('window.__applySchedulePayload = scheduleIncomingPayload')
    expect(html).toContain("scheduleIncomingPayload(message.payload)")

    vi.unstubAllGlobals()
  })

  it('stores schedule notices by classroom and shares student common notices by grade', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openAllScheduleHtml({
      viewType: 'all-student',
      cells: [],
      students: [
        createStudent({ id: 'student-1', birthDate: '2012-05-01' }),
        createStudent({ id: 'student-2', name: '佐藤 花子', displayName: '佐藤', birthDate: '2012-09-01' }),
        createStudent({ id: 'student-3', name: '鈴木 次郎', displayName: '鈴木', birthDate: '2011-05-01' }),
      ],
      teachers: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: {
        closedWeekdays: [0],
        holidayDates: [],
        forceOpenDates: [],
        scheduleNotes: {
          'student:student-common-grade-中2': '中2 共通連絡',
          'student:student-student-1': '山田 個別連絡',
        },
      },
      classroomStorageKey: 'classroom_green',
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain("const STORAGE_SCOPE = encodeURIComponent(String(DATA.classroomStorageKey || 'default'))")
    expect(html).toContain("schedule-note:' + STORAGE_SCOPE + ':' + BASE_VIEW_TYPE")
    expect(html).toContain('共通連絡事項(学年別)')
    expect(html).toContain("var gradeCommonKey = 'student-common-grade-' + (student.currentGradeLabel || '未設定')")
    expect(html).toContain('renderBottomSection(gradeCommonKey')
    expect(html).toContain('中2 共通連絡')
    expect(html).toContain('山田 個別連絡')
    expect(html).toContain("type: 'schedule-note-update'")
    expect(html).toContain('delete clone.scheduleNotes')
    expect(html).toContain('syncScheduleNoteInputs()')
    expect(html).not.toContain("renderBottomSection('student-common'")

    vi.unstubAllGlobals()
  })

  it('renders the option field (option-only layout) only when optionFieldEnabled is set', () => {
    const renderStudentSchedule = (optionFieldEnabled: boolean) => {
      const write = vi.fn()
      const popup = {
        closed: false,
        document: { open() {}, write, close() {} },
        focus() {},
        postMessage() {},
      } as unknown as Window
      vi.stubGlobal('window', {
        open: () => popup,
        setTimeout: (callback: () => void) => {
          callback()
          return 0
        },
      })

      openAllScheduleHtml({
        viewType: 'all-student',
        cells: [],
        students: [createStudent({ id: 'student-1', birthDate: '2012-05-01' })],
        teachers: [],
        regularLessons: [],
        defaultStartDate: '2026-03-24',
        defaultEndDate: '2026-03-24',
        titleLabel: 'テスト',
        classroomSettings: {
          closedWeekdays: [0],
          holidayDates: [],
          forceOpenDates: [],
          scheduleNotes: {},
        },
        classroomStorageKey: 'classroom_dev',
        optionFieldEnabled,
        targetWindow: popup,
      })

      const html = write.mock.calls[0]?.[0] as string
      vi.unstubAllGlobals()
      return html
    }

    // 機能の生成ソースは常に存在する(分岐は DATA.optionFieldEnabled で実行時に切り替わる)。
    const enabledHtml = renderStudentSchedule(true)
    expect(enabledHtml).toContain('"optionFieldEnabled":true')
    expect(enabledHtml).toContain('if (DATA.optionFieldEnabled)')
    expect(enabledHtml).toContain('bottom-grid-option')
    expect(enabledHtml).toContain('function renderOptionSection(')
    // 学年共通キー(student-option-grade-{学年}-{行})で左列テキストを保存する。
    expect(enabledHtml).toContain("'student-option-grade-' + grade + '-' + i")
    // オプション欄あり分岐では休み欄(absenceSectionHtml)を出さず振替を左詰めする。
    expect(enabledHtml).toContain('makeupSectionHtml +\n            renderOptionSection(')

    // 既定(他教室)はフラグ false。休み欄を維持する従来レイアウト。
    const disabledHtml = renderStudentSchedule(false)
    expect(disabledHtml).toContain('"optionFieldEnabled":false')
  })

  it('carries QR-submitted optionChecks from the overlapping session into the serialized student', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openAllScheduleHtml({
      viewType: 'all-student',
      cells: [],
      students: [createStudent({ id: 'student-1', birthDate: '2012-05-01' })],
      teachers: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], scheduleNotes: {} },
      specialSessions: [{
        id: 'session-1', label: '春期講習', startDate: '2026-03-24', endDate: '2026-04-05',
        teacherInputs: {},
        studentInputs: {
          'student-1': {
            unavailableSlots: [], regularBreakSlots: [], subjectSlots: {},
            optionChecks: { '0': true, '2': true },
            regularOnly: false, countSubmitted: true, updatedAt: '2026-03-20T00:00:00Z',
          },
        },
        createdAt: '2026-03-20T00:00:00Z',
        updatedAt: '2026-03-20T00:00:00Z',
      }],
      classroomStorageKey: 'classroom_dev',
      optionFieldEnabled: true,
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    // 提出済みセッションの optionChecks が直列化された生徒(DATA)に載り、右列の✓描画に使われる。
    expect(html).toContain('"optionChecks":{"0":true,"2":true}')
    // renderOptionSection は checks[i] が true の行にチェックを表示する。
    expect(html).toContain("var checked = !!checks && checks[i] === true")
    expect(html).toContain("(checked ? '✓' : '')")

    vi.unstubAllGlobals()
  })

  it('mirrors registered optionChecks onto DATA.students so the right column reflects locally', () => {
    // 残課題②回帰防止: 登録ダイアログでチェックして保存しても、updateStudentCountLocally が
    // DATA.specialSessions だけ更新して DATA.students[].optionChecks を更新しないと、右列✓は
    // 表示中セッションの古い値のまま再描画され反映されない。生徒へのミラー更新が消えると再発する。
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const studentHtml = write.mock.calls[0]?.[0] as string
    // 登録時に渡された optionChecks を、表示中の生徒オブジェクトへもミラーする。
    expect(studentHtml).toContain('optionCheckTargetStudent.optionChecks = optionChecks || {}')

    vi.unstubAllGlobals()
  })

  it('exposes the empty-format print button and builder only in the student view', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const studentHtml = write.mock.calls[0]?.[0] as string
    expect(studentHtml).toContain('id="schedule-empty-format-button"')
    expect(studentHtml).toContain('空フォーマット印刷')
    expect(studentHtml).toContain('function openEmptyFormatPrintWindow')
    expect(studentHtml).toContain('buildStudentSheetHtml(startDate, endDate, appliedPersonId, 0, true)')
    expect(studentHtml).toContain('function toEmptyCountRows')
    // spec-group-lesson §E: 空フォーマットは中3想定で集団行を反映し、講習回数に 集理/集社 を追加する。
    expect(studentHtml).toContain('function buildEmptyFormatGroupRowsHtml')
    expect(studentHtml).toContain("emptyFormatSubjects.concat(['集理', '集社'])")
    expect(studentHtml).toContain('emptyFormat ? buildEmptyFormatGroupRowsHtml(startDate, endDate, dateHeaders)')

    write.mockClear()
    openTeacherScheduleHtml({
      cells: [],
      teachers: [],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const teacherHtml = write.mock.calls[0]?.[0] as string
    expect(teacherHtml).not.toContain('id="schedule-empty-format-button"')

    vi.unstubAllGlobals()
  })

  it('emits a syntactically valid inline client script (guards template-literal escaping bugs)', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    // Extract every inline <script> block without a src/type attribute (the client logic),
    // and confirm each parses as valid JS. A template-literal escaping bug (e.g. a stray \\'
    // that collapses to ') would break parsing here, catching the runtime "blank page" failure.
    const scriptBlocks = Array.from(
      html.matchAll(/<script>([\s\S]*?)<\/script>/g),
      (match) => match[1],
    )
    expect(scriptBlocks.length).toBeGreaterThan(0)
    for (const block of scriptBlocks) {
      expect(() => new Function(block)).not.toThrow()
    }

    vi.unstubAllGlobals()
  })

  it('wires the per-subject lesson-time (授業時間) selector into the lecture registration dialog (student view)', () => {
    // 講習の登録ダイアログから QR と同じように科目ごとの授業時間(90/60/45分)を選べる配線が
    // 生成HTMLに含まれていること。実DOMの描画は popup 実行時なので、配線文字列の存在で回帰防止する。
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    // 60/45 のみ保持する正規化、登録ダイアログのプルダウン描画、提出時の収集・送信の配線。
    expect(html).toContain('function normalizeSubjectDurations')
    expect(html).toContain('data-role="student-count-subject-duration"')
    expect(html).toContain('subjectDurations')
    // 通常のみ ON でプルダウンも無効化する配線。
    expect(html).toContain('[data-role="student-count-subject-duration"]')

    vi.unstubAllGlobals()
  })

  // 回帰防止: 講習回数表の科目には授業時間(60/45分)を併記する。90分(既定)は付けない。
  // 科目内で分数が混在・不明のときは誤解を避けて併記しない(pickLectureMinutesSuffix)。
  // 埋め込みスクリプトの実体を new Function で評価して挙動を固定する。spec-schedule-pdf §D。
  it('appends the lesson-time suffix (60/45分) to lecture-count subjects, omitting 90/mixed/unknown', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string

    // pickLectureMinutesSuffix: 一意(60のみ/45のみ)なら返し、混在・空・90分だけは ''。
    const pickMatch = html.match(/function pickLectureMinutesSuffix\(suffixes\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(pickMatch).toBeTruthy()
    const pick = new Function('suffixes', pickMatch![1]) as (suffixes: string[]) => string
    expect(pick(['60', '60'])).toBe('60')
    expect(pick(['45'])).toBe('45')
    expect(pick(['60', '45'])).toBe('') // 混在は併記しない
    expect(pick([''])).toBe('') // 90分/不明(formatScheduleMinutesSuffix が '' を返す)
    expect(pick([])).toBe('')
    expect(pick(['60', ''])).toBe('60') // 60分コマがあれば併記(90分が混じっても)

    // toCountRows: labelMinutesMap があれば科目の横に「〜分」を併記、無ければ従来どおり素の科目名。
    const rowsMatch = html.match(/function toCountRows\(countMap, desiredCountMap, forcedLabels, options\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(rowsMatch).toBeTruthy()
    const escapeHtml = (value: unknown) => String(value == null ? '' : value)
    const SUBJECT_SORT_ORDER = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '集理', '集社']
    const toCountRows = new Function(
      'countMap', 'desiredCountMap', 'forcedLabels', 'options', 'escapeHtml', 'SUBJECT_SORT_ORDER', rowsMatch![1],
    ) as (
      countMap: Record<string, number>,
      desiredCountMap: Record<string, number>,
      forcedLabels: string[] | null,
      options: Record<string, unknown>,
      escapeHtmlFn: (value: unknown) => string,
      sortOrder: string[],
    ) => string
    // 講習表: 英に 60分 を併記。
    const withMinutes = toCountRows({ 英: 2 }, { 英: 2 }, ['英'], { hideZeroZero: true, labelMinutesMap: { 英: '60' } }, escapeHtml, SUBJECT_SORT_ORDER)
    expect(withMinutes).toContain('<td>英60分</td>')
    // 併記マップに無い科目(集団/90分など)は素の科目名のまま。
    const withoutSuffix = toCountRows({ 数: 1 }, { 数: 1 }, ['数'], { hideZeroZero: true, labelMinutesMap: { 英: '60' } }, escapeHtml, SUBJECT_SORT_ORDER)
    expect(withoutSuffix).toContain('<td>数</td>')
    // 通常回数表(labelMinutesMap 未指定)は従来どおり素の科目名。
    const regular = toCountRows({ 英: 3 }, { 英: 3 }, ['英'], {}, escapeHtml, SUBJECT_SORT_ORDER)
    expect(regular).toContain('<td>英</td>')

    // resolveLectureMinutesBySubject: 実配置の分数を優先し、未配置(希望登録のみ)は希望の分数でフォールバック。
    const resolveMatch = html.match(/function resolveLectureMinutesBySubject\(placedListBySubject, desiredMinutesBySubject\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(resolveMatch).toBeTruthy()
    const resolve = new Function('placedListBySubject', 'desiredMinutesBySubject', 'pickLectureMinutesSuffix', resolveMatch![1]) as (
      placedListBySubject: Record<string, string[]>,
      desiredMinutesBySubject: Record<string, string>,
      pickFn: (suffixes: string[]) => string,
    ) => Record<string, string>
    // 未配置(実配置リスト空)でも希望登録の分数を出す。
    expect(resolve({}, { 英: '60' }, pick)).toEqual({ 英: '60' })
    // 実配置があればそちらを優先(希望と食い違っても実配置が勝つ)。
    expect(resolve({ 数: ['45'] }, { 数: '60' }, pick)).toEqual({ 数: '45' })
    // 実配置が混在で一意でない科目は、希望登録の分数へフォールバック。
    expect(resolve({ 国: ['60', '45'] }, { 国: '60' }, pick)).toEqual({ 国: '60' })
    // 実配置も希望も無ければ併記しない。
    expect(resolve({ 理: ['90'] }, {}, pick)).toEqual({})

    vi.unstubAllGlobals()
  })

  // 回帰防止(根本原因): 講習の希望登録の授業時間(subjectDurations)を payload に載せる。
  // これが欠けると popup の DATA.specialSessions に届かず、未配置の希望科目に分数が一切出なかった
  // (subjectSlots は載っていたため希望数だけ表示され、授業時間が消える非対称)。埋め込み DATA(JSON)で固定。
  it('serializes special-session subjectDurations into the schedule payload', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      specialSessions: [{
        id: 'session-1',
        label: '春期講習',
        startDate: '2026-03-20',
        endDate: '2026-03-31',
        teacherInputs: {},
        studentInputs: {
          'student-1': {
            unavailableSlots: [],
            regularBreakSlots: [],
            subjectSlots: { 数: 2 },
            subjectDurations: { 数: 60 },
            regularOnly: false,
            countSubmitted: true,
            updatedAt: '2026-03-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    // payload は compact JSON で埋め込まれる(JSON.stringify)。subjectDurations が載っていること。
    expect(html).toContain('"subjectDurations":{"数":60}')

    vi.unstubAllGlobals()
  })

  it('includes A3-portrait paging plumbing for overflowing salary tables (teacher view)', () => {
    // 給与計算の行が多くA4横で見切れる講師ページを A3 縦へ自動切替するための CSS / @page / 計測関数が
    // 生成HTMLに含まれていること。実測ベースの切替なので文字列の存在で配線を担保する(回帰防止)。
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openTeacherScheduleHtml({
      cells: [],
      teachers: [createTeacher()],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('@page sheetA3')
    expect(html).toContain('size: A3 portrait')
    expect(html).toContain('.sheet.is-a3-portrait')
    expect(html).toContain('function applySalaryOverflowPaging')
    // スクロール枠に隠れている給与行があるときだけ A3 にする計測ロジック。
    expect(html).toContain("classList.add('is-a3-portrait')")
    // 給与だけでなく、週グリッドが縦に長くシート本体が見切れる場合も A3 にするため
    // シート全体のはみ出し量(scrollHeight-clientHeight)も計測する(回帰防止)。
    expect(html).toContain('function shouldTeacherSheetUseA3')
    expect(html).toContain('sheet.scrollHeight - sheet.clientHeight')

    vi.unstubAllGlobals()
  })

  // 回帰防止: A3 縦への切替判定は「給与スクロールに隠れた行」だけでなく
  // 「シート本体が用紙からはみ出して下が見切れる(週グリッドが長い講師)」でも発火する。
  // 出荷後の実体を new Function で評価して挙動を固定する。
  it('switches a teacher sheet to A3 when either the salary scroll or the whole sheet overflows', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openTeacherScheduleHtml({
      cells: [],
      teachers: [createTeacher()],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const match = html.match(/function shouldTeacherSheetUseA3\(salaryHidden, sheetOverflow\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const shouldUseA3 = new Function('salaryHidden', 'sheetOverflow', match![1]) as (
      salaryHidden: number,
      sheetOverflow: number,
    ) => boolean
    // どちらも収まっていれば A4 横のまま。
    expect(shouldUseA3(0, 0)).toBe(false)
    expect(shouldUseA3(2, 4)).toBe(false)
    // 給与スクロールに隠れた行があれば A3。
    expect(shouldUseA3(20, 0)).toBe(true)
    // 給与は収まるが週グリッドでシート本体が見切れる場合も A3(今回の修正で対応)。
    expect(shouldUseA3(0, 40)).toBe(true)

    vi.unstubAllGlobals()
  })

  it('serializes group-class entries and participation into the student schedule payload', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [createManualScheduleCell()],
      students: [createStudent({ id: 'student-1', displayName: '山田', birthDate: '2011-05-01' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      groupClassEntries: {
        '2026-03-24_1': { dateKey: '2026-03-24', band: 1, subject: '集団理科', teacherName: '田中講師', absentStudentIds: [], addedStudentIds: [] },
      },
      specialSessions: [{
        id: 'session-1', label: '春期講習', startDate: '2026-03-20', endDate: '2026-03-31',
        teacherInputs: {},
        studentInputs: {
          'student-1': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, groupClassParticipation: { 集団理科: true }, regularOnly: false, countSubmitted: true, updatedAt: '2026-03-01T00:00:00.000Z' },
        },
        createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    // 集団授業の盤面割当と参加情報が DATA に載っていること(クライアントJSが描画に使う)。
    expect(html).toContain('集団理科')
    expect(html).toContain('groupClassParticipation')
    expect(html).toContain('"2026-03-24_1"')
    // 集団行・回数の描画ヘルパが埋め込まれていること。
    expect(html).toContain('buildStudentGroupRowsHtml')
    expect(html).toContain('injectGroupClassCounts')
    // 集団参加は「登録」ボタンでまとめて保存する。専用「集団参加を保存」ボタンは廃止。
    expect(html).toContain('student-count-group-input')
    expect(html).not.toContain('save-student-group-participation')
    expect(html).not.toContain('schedule-student-group-save')
    expect(html).not.toContain('submitStudentGroupParticipation')

    vi.unstubAllGlobals()
  })

  it('embeds the group-class salary category and teacher group helpers in the teacher schedule', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openTeacherScheduleHtml({
      cells: [createManualScheduleCell()],
      teachers: [createTeacher({ id: 'teacher-1', name: '田中講師', displayName: '田中' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      groupClassEntries: {
        '2026-03-24_1': { dateKey: '2026-03-24', band: 1, subject: '集団社会', teacherName: '田中講師', absentStudentIds: [], addedStudentIds: ['student-1'] },
      },
      specialSessions: [],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('集団社会')
    // 専用カテゴリ「集団」と講師の集団ヘルパが埋め込まれていること。
    expect(html).toContain('集団 (1コマ)')
    expect(html).toContain('buildTeacherGroupRowsHtml')
    expect(html).toContain('getTeacherGroupEntriesInRange')
    expect(html).toContain('getGroupPresentCount')

    vi.unstubAllGlobals()
  })

  it('opens print-all schedules into the prepared named popup window', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
    } as unknown as Window
    const open = vi.fn(() => popup)
    vi.stubGlobal('window', {
      open,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openAllScheduleHtml({
      viewType: 'all-teacher',
      targetWindowName: 'schedule-print-all-all-teacher-123',
      cells: [],
      students: [],
      teachers: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      classroomStorageKey: 'classroom_green',
    })

    expect(open).toHaveBeenCalledWith('', 'schedule-print-all-all-teacher-123')
    expect(write.mock.calls[0]?.[0]).toContain('印刷用講師日程表')

    vi.unstubAllGlobals()
  })

  it('renders schedule cells from grouped date-slot assignments instead of last-entry overwrite', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('function groupScheduleEntriesBySlot(entries)')
    expect(html).toContain('const keyMap = groupScheduleEntriesBySlot(entries)')
    expect(html).toContain('const assignments = keyMap.get(dateHeader.dateKey + \'_\' + slotNumber) || []')
    expect(html).toContain('renderStudentCellCards(assignments)')
    expect(html).toContain('const slotEntries = keyMap.get(dateHeader.dateKey + \'_\' + slotNumber) || []')
    expect(html).not.toContain('new Map(entries.map((entry) => [entry.dateKey + \'_\' + entry.slotNumber, entry]))')

    vi.unstubAllGlobals()
  })
  it('applies regular deletion adjustments to regular desired counts', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      defaultStartDate: '2026-03-02',
      defaultEndDate: '2026-03-31',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      scheduleCountAdjustments: [{
        studentKey: 'student-1',
        subject: '数',
        countKind: 'regular',
        dateKey: '2026-03-10',
        delta: -2,
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(typeof html).toBe('string')
    // Verify embedded payload: March has 5 Tuesdays, and board deletion adjustments are passed through for desired counts.
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const mathOccurrences = payload.expectedRegularOccurrences.filter((o: { subject: string }) => o.subject === '数')
    const marchMathOccurrences = mathOccurrences.filter((o: { dateKey: string }) => o.dateKey >= '2026-03-01' && o.dateKey <= '2026-03-31')
    expect(marchMathOccurrences).toHaveLength(5)
    expect(payload.countAdjustments).toEqual([{
      studentKey: 'student-1',
      subject: '数',
      countKind: 'regular',
      dateKey: '2026-03-10',
      delta: -2,
    }])
    expect(html).toContain("const regularCountAdjustments = buildStudentCountAdjustmentMap(student, startDate, endDate, 'regular')")
    expect(html).toContain('const visiblePlannedRegularCounts = applyCountAdjustments(normalizeCountMapSubjects(plannedRegularCounts, student, startDate), regularCountAdjustments)')
    vi.unstubAllGlobals()
  })

  it('uses combined regular lessons from template history when spanning multiple templates', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    // Template A: student-1 takes 英 on Tuesday slot 4 starting 2025-10-01
    // Template B: student-1 takes 数 on Wednesday slot 3 starting 2026-04-01
    const templateA: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2025-10-01',
      savedAt: '2025-10-01T00:00:00Z',
      cells: [{
        dayOfWeek: 2,
        slotNumber: 4,
        desks: [{ deskIndex: 1, teacherId: 'teacher-1', students: [{ studentId: 'student-1', subject: '英' }, null] }],
      }],
    }
    const templateB: RegularLessonTemplate = {
      version: 1,
      effectiveStartDate: '2026-04-01',
      savedAt: '2026-04-01T00:00:00Z',
      cells: [{
        dayOfWeek: 3,
        slotNumber: 3,
        desks: [{ deskIndex: 1, teacherId: 'teacher-1', students: [{ studentId: 'student-1', subject: '数' }, null] }],
      }],
    }

    // Range spans both templates: March 2026 (template A) and April 2026 (template B)
    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      regularLessonTemplateHistory: [templateA, templateB],
      teachers: [createTeacher()],
      defaultStartDate: '2026-03-01',
      defaultEndDate: '2026-04-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const occurrences = payload.expectedRegularOccurrences as Array<{ subject: string; dateKey: string }>
    // March: template A active → 英 on Tuesdays (3/3, 3/10, 3/17, 3/24, 3/31)
    const marchEng = occurrences.filter((o) => o.subject === '英' && o.dateKey.startsWith('2026-03'))
    expect(marchEng.length).toBeGreaterThanOrEqual(4)
    // April: template B active → 数 on Wednesdays
    const aprilMath = occurrences.filter((o) => o.subject === '数' && o.dateKey.startsWith('2026-04'))
    expect(aprilMath.length).toBeGreaterThanOrEqual(4)
    // No 英 in April (template A's lessons clipped before April)
    const aprilEng = occurrences.filter((o) => o.subject === '英' && o.dateKey.startsWith('2026-04'))
    expect(aprilEng).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('orders student schedule sheets by current grade and display name', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [
        createStudent({ id: 'student-3', name: '高橋 花', displayName: '高橋', birthDate: '2009-05-01' }),
        createStudent({ id: 'student-1', name: '青木 太郎', displayName: '青木', birthDate: '2014-05-01' }),
        createStudent({ id: 'student-2', name: '伊藤 次郎', displayName: '伊藤', birthDate: '2014-04-01' }),
      ],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain('function compareStudentOrder(left, right)')
    expect(html).toContain("sort(compareStudentOrder)")
    vi.unstubAllGlobals()
  })

  it('keeps holiday and unavailable background colors enabled for print output', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain('-webkit-print-color-adjust: exact;')
    expect(html).toContain('print-color-adjust: exact;')
    expect(html).toContain('box-shadow: inset 0 0 0 999px var(--holiday-bg);')
    expect(html).toContain('box-shadow: inset 0 0 0 999px #d1d6dc;')
    vi.unstubAllGlobals()
  })

  it('renders person search, selector, and apply controls for single-person popup display', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain('id="schedule-person-search"')
    expect(html).toContain('id="schedule-person-select"')
    expect(html).toContain('id="schedule-apply-button"')
    expect(html).toContain('function renderStudentPages(startDate, endDate, studentId)')
    vi.unstubAllGlobals()
  })

  it('shows the assigned destination date next to absent statuses in student schedules', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [
        {
          id: '2026-04-01_1',
          dateKey: '2026-04-01',
          dayLabel: '水',
          dateLabel: '4/1',
          slotLabel: '1限',
          slotNumber: 1,
          timeLabel: '13:00-14:30',
          isOpenDay: true,
          desks: [
            {
              id: '2026-04-01_1_desk_1',
              teacher: '田中講師',
              statusSlots: [
                {
                  id: 'status-1',
                  studentId: 'student-entry-1',
                  sourceManagedLesson: true,
                  name: '山田',
                  managedStudentId: 'student-1',
                  grade: '中3',
                  subject: '数',
                  lessonType: 'regular',
                  teacherType: 'normal',
                  teacherName: '田中講師',
                  dateKey: '2026-04-01',
                  slotNumber: 1,
                  recordedAt: '2026-04-01T00:00:00Z',
                  status: 'absent',
                  sourceLessonId: 'managed-1',
                },
                null,
              ],
            },
          ],
        },
        {
          id: '2026-04-08_2',
          dateKey: '2026-04-08',
          dayLabel: '水',
          dateLabel: '4/8',
          slotLabel: '2限',
          slotNumber: 2,
          timeLabel: '14:40-16:10',
          isOpenDay: true,
          desks: [
            {
              id: '2026-04-08_2_desk_1',
              teacher: '田中講師',
              lesson: {
                id: 'makeup-1',
                studentSlots: [
                  {
                    id: 'placed-1',
                    name: '山田',
                    managedStudentId: 'student-1',
                    grade: '中3',
                    subject: '数',
                    lessonType: 'makeup',
                    teacherType: 'normal',
                    makeupSourceDate: '2026-04-01',
                    makeupSourceLabel: '2026/4/1(水) 1限',
                  },
                  null,
                ],
              },
            },
          ],
        },
      ],
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-08',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const statusEntry = payload.cells[0]?.desks?.[0]?.statuses?.[0]
    expect(statusEntry?.linkedDestinationDateKey).toBe('2026-04-08')
    expect(statusEntry?.linkedDestinationSlotNumber).toBe(2)
    expect(html).toContain("var linkedDestinationLabel = entry.linkedDestinationDateKey ? formatMonthDay(entry.linkedDestinationDateKey) : '';")
    expect(html).toContain("base += ' → ' + formatCompactDateSlot(arguments[6], arguments[7]);")
    vi.unstubAllGlobals()
  })

  it('keeps moved-origin board markers out of schedule payload statuses', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [
        {
          id: '2026-04-01_1',
          dateKey: '2026-04-01',
          dayLabel: '水',
          dateLabel: '4/1',
          slotLabel: '1限',
          slotNumber: 1,
          timeLabel: '13:00-14:30',
          isOpenDay: true,
          desks: [
            {
              id: '2026-04-01_1_desk_1',
              teacher: '田中講師',
              statusSlots: [
                {
                  id: 'status-moved-1',
                  studentId: 'student-entry-1',
                  sourceManagedLesson: true,
                  name: '山田',
                  managedStudentId: 'student-1',
                  grade: '中3',
                  subject: '数',
                  lessonType: 'regular',
                  teacherType: 'normal',
                  teacherName: '田中講師',
                  dateKey: '2026-04-01',
                  slotNumber: 1,
                  moveDestinationDateKey: '2026-04-08',
                  moveDestinationSlotNumber: 2,
                  recordedAt: '2026-04-01T00:00:00Z',
                  status: 'moved',
                  sourceLessonId: 'managed-1',
                },
                null,
              ],
            },
          ],
        },
      ],
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-08',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.cells[0]?.desks).toEqual([])
    vi.unstubAllGlobals()
  })

  it('embeds middle-school legacy math subject normalization for lecture count registration', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ birthDate: '2012-05-10' })],
      regularLessons: [],
      defaultStartDate: '2026-04-10',
      defaultEndDate: '2026-04-16',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain("if (subject === '算国') return getPreferredMathSubject(student, referenceDate) === '算' ? '算国' : '数';")
    vi.unstubAllGlobals()
  })

  it('renders a fixed top toolbar that compensates for browser zoom', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain('--schedule-toolbar-offset: 0px;')
    expect(html).toContain('position: fixed;')
    expect(html).toContain("function updateSheetScreenSize()")
    vi.unstubAllGlobals()
  })

  it('sizes the sheet from browser height while preserving the A4 landscape ratio on screen', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain('width: 277mm;')
    expect(html).toContain('aspect-ratio: 297 / 210;')
    expect(html).toContain('function updateSheetScreenSize()')
    vi.unstubAllGlobals()
  })

  it('builds teacher salary from attended statuses only and emits absent-first tooltip formatting', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [],
      teachers: [createTeacher()],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain("var attendedStatuses = statuses.filter(function(s) {")
    expect(html).toContain('if (attendedStatuses.length === 0) return;')
    expect(html).toContain('isHighSchoolOrAbove(s.grade)')
    expect(html).toContain('function formatTeacherTooltipEntry(student)')
    expect(html).toContain("return [getVerboseStatusLabel(student.status), student.name, lessonLabel].filter(Boolean).join(' / ');")
    vi.unstubAllGlobals()
  })

  it('preserves the selected teacher id through popup payload, storage, and range notifications', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [],
      teachers: [
        createTeacher({ id: 'teacher-1', name: '田中講師', displayName: '田中' }),
        createTeacher({ id: 'teacher-2', name: '佐藤講師', displayName: '佐藤' }),
      ],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      defaultPersonId: 'teacher-2',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(typeof html).toBe('string')
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.defaultPersonId).toBe('teacher-2')
    expect(html).toContain("storage.setItem(rangeStoragePrefix + 'person', personId || '')")
    expect(html).toContain('personId: personId ||')
    expect(html).toContain('preferredRange.personId || DATA.defaultPersonId')
    vi.unstubAllGlobals()
  })

  it('serializes teacher ids and omits empty desks so teacher schedules match board assignments with less payload', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-07-03_5',
        dateKey: '2026-07-03',
        dayLabel: '金',
        dateLabel: '7/3',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:40-21:10',
        isOpenDay: true,
        desks: [
          { id: '2026-07-03_5_desk_empty', teacher: '', statusSlots: [null, null] },
          {
            id: '2026-07-03_5_desk_1',
            teacher: '旧表示名',
            teacherAssignmentTeacherId: 'teacher-ochiai',
            lesson: {
              id: 'lesson-inoue',
              studentSlots: [{
                id: 'student-inoue-entry',
                name: '井上',
                managedStudentId: 'student-inoue',
                grade: '中2',
                subject: '数',
                lessonType: 'regular',
                teacherType: 'normal',
              }, null],
            },
          },
        ],
      }],
      teachers: [createTeacher({ id: 'teacher-ochiai', name: '落合', displayName: '落合' })],
      defaultStartDate: '2026-07-01',
      defaultEndDate: '2026-07-31',
      defaultPersonId: 'teacher-ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.cells[0]?.desks).toHaveLength(1)
    expect(payload.cells[0]?.desks?.[0]?.teacherId).toBe('teacher-ochiai')
    expect(html).toContain('if (desk.teacherId) teacherKeys.push(desk.teacherId);')
    expect(html).toContain('else if (Array.isArray(desk.regularTeacherIds)) teacherKeys.push.apply(teacherKeys, desk.regularTeacherIds.filter(Boolean));')
    expect(html).toContain('function normalizeTeacherAssignmentName(value)')
    expect(html).toContain('function collectTeacherAssignmentEntries(assignmentMap, teacher)')
    expect(html).toContain('const entries = collectTeacherAssignmentEntries(assignmentMap, teacher);')
    vi.unstubAllGlobals()
  })

  it('keeps student desks that match a teacher by display name when other desks match by teacher id', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-07-24_5',
        dateKey: '2026-07-24',
        dayLabel: '金',
        dateLabel: '7/24',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:40-21:10',
        isOpenDay: true,
        desks: [
          {
            id: '2026-07-24_5_desk_1',
            teacher: '旧表示名',
            teacherAssignmentTeacherId: 'teacher-ochiai',
            lesson: {
              id: 'lesson-other',
              studentSlots: [{
                id: 'student-other-entry',
                name: '別生徒',
                managedStudentId: 'student-other',
                grade: '中1',
                subject: '英',
                lessonType: 'regular',
                teacherType: 'normal',
              }, null],
            },
          },
          ...Array.from({ length: 7 }, (_, index) => ({ id: `2026-07-24_5_desk_${index + 2}`, teacher: '' })),
          {
            id: '2026-07-24_5_desk_9',
            teacher: '落合',
            lesson: {
              id: 'lesson-inoue',
              studentSlots: [{
                id: 'student-inoue-entry',
                name: '井上',
                managedStudentId: 'student-inoue',
                grade: '中2',
                subject: '数',
                lessonType: 'regular',
                teacherType: 'normal',
              }, null],
            },
          },
        ],
      }],
      teachers: [createTeacher({ id: 'teacher-ochiai', name: '落合 優太', displayName: '落合' })],
      defaultStartDate: '2026-07-01',
      defaultEndDate: '2026-07-31',
      defaultPersonId: 'teacher-ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.cells[0]?.desks).toHaveLength(2)
    expect(payload.cells[0]?.desks?.[0]).toMatchObject({ teacher: '旧表示名', teacherId: 'teacher-ochiai' })
    expect(payload.cells[0]?.desks?.[1]).toMatchObject({ teacher: '落合', lesson: { students: [{ name: '井上' }] } })
    expect(payload.cells[0]?.desks?.[1]?.teacherId).toBeUndefined()
    expect(html).toContain('const entries = collectTeacherAssignmentEntries(assignmentMap, teacher);')
    expect(html).not.toContain('講師のみ')
    vi.unstubAllGlobals()
  })

  it('maps regular student desks to teacher schedules by the regular lesson teacher id when desk teacher metadata is stale', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-07-24_5',
        dateKey: '2026-07-24',
        dayLabel: '金',
        dateLabel: '7/24',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:40-21:10',
        isOpenDay: true,
        desks: [{
          id: '2026-07-24_5_desk_9',
          teacher: '古い表示名',
          lesson: {
            id: 'managed_regular-ochiai-inoue_2026-07-24',
            studentSlots: [{
              id: 'student-inoue_2026-07-24_英',
              name: '井上',
              managedStudentId: 'student-inoue',
              grade: '中2',
              subject: '英',
              lessonType: 'regular',
              teacherType: 'normal',
            }, null],
          },
        }],
      }],
      teachers: [createTeacher({ id: 'teacher-ochiai', name: '落合 優太', displayName: '落合' })],
      students: [createStudent({ id: 'student-inoue', name: '井上 花子', displayName: '井上' })],
      regularLessons: [{
        id: 'regular-ochiai-inoue',
        schoolYear: 2026,
        teacherId: 'teacher-ochiai',
        student1Id: 'student-inoue',
        subject1: '英',
        startDate: '2026-04-01',
        endDate: '未定',
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 5,
        slotNumber: 5,
      }],
      defaultStartDate: '2026-07-21',
      defaultEndDate: '2026-08-28',
      defaultPersonId: 'teacher-ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.cells[0]?.desks?.[0]).toMatchObject({
      teacher: '古い表示名',
      regularTeacherIds: ['teacher-ochiai'],
      lesson: { students: [{ name: '井上' }] },
    })
    expect(html).toContain('if (desk.teacherId) teacherKeys.push(desk.teacherId);')
    expect(html).toContain('else if (Array.isArray(desk.regularTeacherIds)) teacherKeys.push.apply(teacherKeys, desk.regularTeacherIds.filter(Boolean));')
    vi.unstubAllGlobals()
  })

  // 回帰防止(2026-07-04 報告): 同コマ内で生徒を別講師の机へ移動すると、moved_* レッスンは
  // マージで机の teacherAssignmentTeacherId が消えるため、regularTeacherIds(基本データ行の
  // 旧講師ID)が机に付き、旧講師と新講師の両方の講師日程に同じ生徒が二重表示されていた。
  // 盤面移動で配置された生徒(sameDayMoveSourceDate / 元日付へ戻した makeupSourceDate が
  // 当該コマの日付)は regularTeacherIds の帰属から除外し、机の講師名だけで帰属させる。
  it('does not attribute same-day moved students back to the template teacher via regularTeacherIds', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-07-24_5',
        dateKey: '2026-07-24',
        dayLabel: '金',
        dateLabel: '7/24',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:40-21:10',
        isOpenDay: true,
        desks: [{
          // 同コマ内で旧講師(落合)の机から移動してきた生徒が乗る新講師(田中)の机。
          // moved_* レッスンはマージで teacherAssignmentTeacherId が消えた状態を再現する。
          id: '2026-07-24_5_desk_2',
          teacher: '田中',
          lesson: {
            id: 'moved_student-inoue_2026-07-24_英_abc123',
            studentSlots: [{
              id: 'student-inoue_2026-07-24_英',
              name: '井上',
              managedStudentId: 'student-inoue',
              grade: '中2',
              subject: '英',
              lessonType: 'regular',
              teacherType: 'normal',
              sameDayMoveSourceDate: '2026-07-24',
              sameDayMoveSourceLabel: '2026/7/24(金) 5限',
            }, null],
          },
        }],
      }],
      teachers: [
        createTeacher({ id: 'teacher-ochiai', name: '落合 優太', displayName: '落合' }),
        createTeacher({ id: 'teacher-tanaka', name: '田中 次郎', displayName: '田中' }),
      ],
      students: [createStudent({ id: 'student-inoue', name: '井上 花子', displayName: '井上' })],
      regularLessons: [{
        id: 'regular-ochiai-inoue',
        schoolYear: 2026,
        teacherId: 'teacher-ochiai',
        student1Id: 'student-inoue',
        subject1: '英',
        startDate: '2026-04-01',
        endDate: '未定',
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 5,
        slotNumber: 5,
      }],
      defaultStartDate: '2026-07-21',
      defaultEndDate: '2026-08-28',
      defaultPersonId: 'teacher-ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const desk = payload.cells[0]?.desks?.[0]
    // 新講師の机の名前では表示され続ける(田中のページには載る)
    expect(desk).toMatchObject({ teacher: '田中', lesson: { students: [{ name: '井上' }] } })
    // 旧講師のIDへは帰属させない(落合のページに二重表示しない)
    expect(desk?.regularTeacherIds).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('prefers the actual assigned teacher over regular teacher ids for teacher schedules', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-07-21_4',
        dateKey: '2026-07-21',
        dayLabel: '火',
        dateLabel: '7/21',
        slotLabel: '4限',
        slotNumber: 4,
        timeLabel: '18:00-19:30',
        isOpenDay: true,
        desks: [{
          id: '2026-07-21_4_desk_1',
          teacher: '増渕',
          teacherAssignmentTeacherId: 'teacher-masubuchi',
          lesson: {
            id: 'lesson-student',
            studentSlots: [{
              id: 'student-entry-1',
              name: '井上',
              managedStudentId: 'student-inoue',
              grade: '中2',
              subject: '英',
              lessonType: 'regular',
              teacherType: 'normal',
            }, null],
          },
        }],
      }],
      teachers: [
        createTeacher({ id: 'teacher-ochiai', name: '落合 優太', displayName: '落合' }),
        createTeacher({ id: 'teacher-masubuchi', name: '増渕 遼', displayName: '増渕' }),
      ],
      students: [createStudent({ id: 'student-inoue', name: '井上 花子', displayName: '井上' })],
      regularLessons: [{
        id: 'regular-ochiai-inoue',
        schoolYear: 2026,
        teacherId: 'teacher-ochiai',
        student1Id: 'student-inoue',
        subject1: '英',
        startDate: '2026-04-01',
        endDate: '未定',
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 2,
        slotNumber: 4,
      }],
      defaultStartDate: '2026-07-21',
      defaultEndDate: '2026-07-21',
      defaultPersonId: 'teacher-ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('if (desk.teacherId) teacherKeys.push(desk.teacherId);')
    expect(html).not.toContain('const teacherKeys = [desk.teacherId].concat(desk.regularTeacherIds || [], [desk.teacher, normalizeTeacherAssignmentName(desk.teacher)]).filter(Boolean);')
    vi.unstubAllGlobals()
  })

  it('counts a 2-student slot as D when at least one attended student is high school or above', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => {
        callback()
        return 0
      },
    })

    openTeacherScheduleHtml({
      cells: [{
        id: '2026-03-24_3',
        dateKey: '2026-03-24',
        dayLabel: '火',
        dateLabel: '3/24',
        slotLabel: '3限',
        slotNumber: 3,
        timeLabel: '16:20-17:50',
        isOpenDay: true,
        desks: [{
          id: '2026-03-24_3_desk_1',
          teacher: '田中講師',
          statusSlots: [
            {
              id: 'status-high',
              studentId: 'student-high',
              sourceManagedLesson: true,
              name: '高橋',
              managedStudentId: 'student-high',
              grade: '高1',
              subject: '英',
              lessonType: 'regular',
              teacherType: 'normal',
              teacherName: '田中講師',
              dateKey: '2026-03-24',
              slotNumber: 3,
              recordedAt: '2026-03-24T00:00:00Z',
              status: 'attended',
              sourceLessonId: 'lesson-high',
            },
            {
              id: 'status-elementary',
              studentId: 'student-elementary',
              sourceManagedLesson: true,
              name: '佐藤',
              managedStudentId: 'student-elementary',
              grade: '小6',
              subject: '算',
              lessonType: 'regular',
              teacherType: 'normal',
              teacherName: '田中講師',
              dateKey: '2026-03-24',
              slotNumber: 3,
              recordedAt: '2026-03-24T00:00:00Z',
              status: 'attended',
              sourceLessonId: 'lesson-elementary',
            },
          ],
        }],
      }],
      teachers: [createTeacher()],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0]
    expect(typeof html).toBe('string')
    expect(html).toContain("var hasHigh = attendedStatuses.some(function(s) { return isHighSchoolOrAbove(s.grade); });")
    expect(html).toContain("var rank2 = hasHigh ? 'D' : 'B';")
    vi.unstubAllGlobals()
  })

  // 回帰防止: 振替欄(生徒日程表)は枠に収まらないため、年(2026/)と曜日(水)を省いて
  // 月日+限だけに詰める(compactMakeupSourceLabel)。埋め込みスクリプトはテンプレートリテラルなので
  // 正規表現のバックスラッシュが1段消える罠がある。出荷後の実体を new Function で評価して挙動を固定する。
  it('compacts makeup-source label to month/day+slot (strips year and weekday) in the shipped script', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-08',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const match = html.match(/function compactMakeupSourceLabel\(label\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const compact = new Function('label', match![1]) as (label: string) => string
    expect(compact('2026/4/1(水) 1限')).toBe('4/1 1限')
    expect(compact('5/16(土) 1限')).toBe('5/16 1限')
    expect(compact('3/5(木)')).toBe('3/5')
    expect(compact('4/6 4限')).toBe('4/6 4限')

    // 振替先の日付スロットも曜日を出さない(compactMakeupDateSlot)。
    expect(html).toContain("return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + slotNumber + '限';")
    vi.unstubAllGlobals()
  })
})

describe('buildCombinedRegularLessonsFromHistory', () => {
  function createTemplate(effectiveStartDate: string, studentCell: { dayOfWeek: number; slotNumber: number; studentId: string; subject: string; teacherId?: string }): RegularLessonTemplate {
    return {
      version: 1,
      effectiveStartDate,
      savedAt: new Date().toISOString(),
      cells: [
        {
          dayOfWeek: studentCell.dayOfWeek,
          slotNumber: studentCell.slotNumber,
          desks: [{
            deskIndex: 1,
            teacherId: studentCell.teacherId ?? 'teacher-1',
            students: [
              { studentId: studentCell.studentId, subject: studentCell.subject as '算' },
              null,
            ],
          }],
        },
      ],
    }
  }

  it('combines occurrences from old and new templates with different effective dates', () => {
    const oldTemplate = createTemplate('2026-04-01', { dayOfWeek: 1, slotNumber: 3, studentId: 'student-1', subject: '英' })
    const newTemplate = createTemplate('2026-04-15', { dayOfWeek: 1, slotNumber: 3, studentId: 'student-1', subject: '英' })

    const combined = buildCombinedRegularLessonsFromHistory({
      regularLessons: [],
      regularLessonTemplateHistory: [oldTemplate, newTemplate],
      teachers: [createTeacher()],
      students: [createStudent()],
    })

    // Old template SY 2026: startDate=2026-04-01, endDate clipped to 2026-04-14
    // New template SY 2026: startDate=2026-04-15, endDate=2027-03-31
    const sy2026Lessons = combined.filter((r) => r.schoolYear === 2026 && r.student1Id === 'student-1')
    expect(sy2026Lessons.length).toBeGreaterThanOrEqual(2)
    const oldLesson = sy2026Lessons.find((r) => r.startDate === '2026-04-01')
    const newLesson = sy2026Lessons.find((r) => r.startDate === '2026-04-15')
    expect(oldLesson).toBeDefined()
    expect(oldLesson!.endDate).toBe('2026-04-14')
    expect(oldLesson!.student1Id).toBe('student-1')
    expect(oldLesson!.subject1).toBe('英')
    expect(newLesson).toBeDefined()
    expect(newLesson!.endDate).toBe('2027-03-31')

    // Now check buildExpectedRegularOccurrences counts both
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: combined,
      startDate: '2026-04-01',
      endDate: '2026-05-09',
    })
    const studentOccurrences = occurrences
      .filter((e) => e.linkedStudentId === 'student-1' && e.subject === '英')
      .filter((e) => e.dateKey >= '2026-04-01' && e.dateKey <= '2026-05-09')
    // April 2026 Mondays: 4/6, 4/13, 4/20, 4/27; May 2026 Monday: 5/4
    // All 5 should be counted (2 from old template + 3 from new template)
    expect(studentOccurrences.map((e) => e.dateKey)).toEqual([
      '2026-04-06',
      '2026-04-13',
      '2026-04-20',
      '2026-04-27',
      '2026-05-04',
    ])
  })

  it('returns regularLessons unchanged when history has only 1 entry and no preTemplate', () => {
    const template = createTemplate('2026-04-15', { dayOfWeek: 1, slotNumber: 3, studentId: 'student-1', subject: '算' })
    const rawLessons = [createRegularLesson({ startDate: '2026-04-01', endDate: '2027-03-31' })]

    const result = buildCombinedRegularLessonsFromHistory({
      regularLessons: rawLessons,
      regularLessonTemplateHistory: [template],
      teachers: [createTeacher()],
      students: [createStudent()],
    })

    // With only 1 template and no preTemplateRegularLessons, returns regularLessons content
    expect(result).toStrictEqual(rawLessons)
  })

  it('with 1 template in history, regularLessons determines expected counts', () => {
    // After template save, regularLessons is replaced with template-generated lessons
    // that start from effectiveStartDate. Pre-template period occurrences are lost.
    const template = createTemplate('2026-04-15', { dayOfWeek: 1, slotNumber: 3, studentId: 'student-1', subject: '英' })

    // Simulate what onReplaceRegularLessons sets: lessons from buildRegularLessonsFromTemplate
    // These start from effectiveStartDate (2026-04-15), NOT from the school year start
    const templateRegularLessons = [createRegularLesson({
      dayOfWeek: 1,
      subject1: '英',
      startDate: '2026-04-15',
      endDate: '2027-03-31',
      student2StartDate: '2026-04-15',
      student2EndDate: '2027-03-31',
      schoolYear: 2026,
    })]

    const combined = buildCombinedRegularLessonsFromHistory({
      regularLessons: templateRegularLessons,
      regularLessonTemplateHistory: [template],
      teachers: [createTeacher()],
      students: [createStudent()],
    })

    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: combined,
      startDate: '2026-04-01',
      endDate: '2026-05-09',
    })

    const studentOccurrences = occurrences
      .filter((e) => e.linkedStudentId === 'student-1' && e.subject === '英')
      .filter((e) => e.dateKey >= '2026-04-01' && e.dateKey <= '2026-05-09')

    // Without preTemplateRegularLessons, only template period is counted: 4/20, 4/27, 5/4
    expect(studentOccurrences.map((e) => e.dateKey)).toEqual([
      '2026-04-20',
      '2026-04-27',
      '2026-05-04',
    ])
  })

  it('includes pre-template occurrences when preTemplateRegularLessons is provided', () => {
    const template = createTemplate('2026-04-15', { dayOfWeek: 1, slotNumber: 3, studentId: 'student-1', subject: '英' })

    // Template-generated regularLessons (starting from effectiveStartDate)
    const templateRegularLessons = [createRegularLesson({
      dayOfWeek: 1,
      subject1: '英',
      startDate: '2026-04-15',
      endDate: '2027-03-31',
      student2StartDate: '2026-04-15',
      student2EndDate: '2027-03-31',
      schoolYear: 2026,
    })]

    // Pre-template regular lessons (original basic data, covering full school year)
    const preTemplateRegularLessons = [createRegularLesson({
      dayOfWeek: 1,
      subject1: '英',
      startDate: '',
      endDate: '',
      student2StartDate: '',
      student2EndDate: '',
      schoolYear: 2026,
    })]

    const combined = buildCombinedRegularLessonsFromHistory({
      regularLessons: templateRegularLessons,
      regularLessonTemplateHistory: [template],
      preTemplateRegularLessons,
      teachers: [createTeacher()],
      students: [createStudent()],
    })

    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: combined,
      startDate: '2026-04-01',
      endDate: '2026-05-09',
    })

    const studentOccurrences = occurrences
      .filter((e) => e.linkedStudentId === 'student-1' && e.subject === '英')
      .filter((e) => e.dateKey >= '2026-04-01' && e.dateKey <= '2026-05-09')

    // Pre-template covers 4/6, 4/13 (clipped before 4/15)
    // Template covers 4/20, 4/27, 5/4 (from 4/15 onwards)
    // Total: 5 occurrences
    expect(studentOccurrences.map((e) => e.dateKey)).toEqual([
      '2026-04-06',
      '2026-04-13',
      '2026-04-20',
      '2026-04-27',
      '2026-05-04',
    ])
  })

  it('exposes the lecture-summary button and builder only in the student view', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const studentHtml = write.mock.calls[0]?.[0] as string
    // 生徒ビューにだけボタン・生成関数・表示制御が埋め込まれる。
    expect(studentHtml).toContain('id="schedule-lecture-summary-button"')
    expect(studentHtml).toContain('講習集計結果')
    expect(studentHtml).toContain('function buildLectureSummaryHtml(startDate, endDate)')
    expect(studentHtml).toContain('function getOverlappingSpecialSessions(startDate, endDate)')
    expect(studentHtml).toContain('function resolveLectureRegistrationStatus(input)')
    expect(studentHtml).toContain('updateLectureSummaryButtonVisibility(startDate, endDate)')
    // 講習集計結果に「希望科目（授業時間）」列を追加(希望各科目の授業時間付き数量)。
    expect(studentHtml).toContain('<th>希望科目（授業時間）</th>')
    expect(studentHtml).toContain('function formatDesiredSubjectsWithDuration(input, student, referenceDate)')
    // 最下部がWindowsタスクバーに隠れないようスクロール余白を確保する(回帰防止)。
    expect(studentHtml).toContain('padding-bottom:160px')

    write.mockClear()
    openTeacherScheduleHtml({
      cells: [],
      teachers: [],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const teacherHtml = write.mock.calls[0]?.[0] as string
    expect(teacherHtml).not.toContain('id="schedule-lecture-summary-button"')

    vi.unstubAllGlobals()
  })

  it('classifies lecture registration status by countSubmitted and regularOnly', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const match = html.match(/function resolveLectureRegistrationStatus\(input\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const resolveStatus = new Function('input', match![1]) as (
      input: { countSubmitted?: boolean; regularOnly?: boolean } | null | undefined,
    ) => { label: string; kind: string }

    // 入力なし/未提出 → 未登録。
    expect(resolveStatus(undefined).kind).toBe('unregistered')
    expect(resolveStatus({ countSubmitted: false, regularOnly: false }).kind).toBe('unregistered')
    // 通常のみチェックを外して提出 → 登録。
    expect(resolveStatus({ countSubmitted: true, regularOnly: false })).toEqual({ label: '登録', kind: 'registered' })
    // 提出済みでも通常のみ → 注記つき。
    expect(resolveStatus({ countSubmitted: true, regularOnly: true })).toEqual({ label: '登録（通常のみ）', kind: 'regular-only' })

    vi.unstubAllGlobals()
  })

  // 回帰防止: 講習集計結果の「希望科目（授業時間）」列は、希望各科目の授業時間付き数量を並べる。
  // 例 '英×1 / 数60分×2'。90分は分数なし、未登録・通常のみ・希望なしは '—'。出荷後スクリプトの実体で固定。
  it('formats desired subjects with lesson-time and quantity for the lecture summary', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent({ displayName: '山田' })],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const fmtMatch = html.match(/function formatDesiredSubjectsWithDuration\(input, student, referenceDate\)\s*\{([\s\S]*?)\n {6}\}/)
    const minMatch = html.match(/function formatScheduleMinutesSuffix\(noteSuffix\)\s*\{([\s\S]*?)\n {6}\}/)
    const pickMatch = html.match(/function pickLectureMinutesSuffix\(suffixes\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(fmtMatch).toBeTruthy()
    expect(minMatch).toBeTruthy()
    expect(pickMatch).toBeTruthy()
    const formatScheduleMinutesSuffix = new Function('noteSuffix', minMatch![1]) as (v: unknown) => string
    const pickLectureMinutesSuffix = new Function('suffixes', pickMatch![1]) as (s: string[]) => string
    // normalizeSubjectForStudent は学年依存(算/数)なので identity で固定してフォーマットのみ検証する。
    const identity = (subject: string) => subject
    const SUBJECT_SORT_ORDER = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '集理', '集社']
    const format = new Function(
      'input', 'student', 'referenceDate',
      'normalizeSubjectForStudent', 'formatScheduleMinutesSuffix', 'pickLectureMinutesSuffix', 'SUBJECT_SORT_ORDER',
      fmtMatch![1],
    ) as (
      input: unknown,
      student: unknown,
      referenceDate: unknown,
      norm: (s: string) => string,
      fmtMin: (v: unknown) => string,
      pick: (s: string[]) => string,
      order: string[],
    ) => string
    const run = (input: unknown) => format(input, {}, '2026-03-24', identity, formatScheduleMinutesSuffix, pickLectureMinutesSuffix, SUBJECT_SORT_ORDER)

    // 授業時間付き数量。SUBJECT_SORT_ORDER 順(英→数)。60分は併記、90分(未指定)は分数なし。
    expect(run({ countSubmitted: true, subjectSlots: { 数: 2, 英: 1 }, subjectDurations: { 数: 60 } })).toBe('英×1 / 数60分×2')
    // 45分。
    expect(run({ countSubmitted: true, subjectSlots: { 英: 1 }, subjectDurations: { 英: 45 } })).toBe('英45分×1')
    // 90分(=既定・不正値)は分数を付けない。
    expect(run({ countSubmitted: true, subjectSlots: { 数: 2 }, subjectDurations: { 数: 90 } })).toBe('数×2')
    // 通常のみ・未登録・希望なしは '—'。
    expect(run({ countSubmitted: true, regularOnly: true, subjectSlots: { 数: 2 } })).toBe('—')
    expect(run({ countSubmitted: false, subjectSlots: { 数: 2 } })).toBe('—')
    expect(run({ countSubmitted: true, subjectSlots: {} })).toBe('—')

    vi.unstubAllGlobals()
  })
})

// 日程表コマ組み(別タブD&D・spec-student-schedule-dnd): 机選択モーダルは移動先コマの「全机(空席含む)」が要るが、
// serializeCells の desks は空席の机を落とす。scheduleDndEnabled=true のとき開校日コマに pickerDesks を別途載せる。
describe('日程表コマ組み payload: pickerDesks / scheduleDndEnabled', () => {
  function createDndTestCell(): SlotCell {
    return {
      id: '2026-03-24_3',
      dateKey: '2026-03-24',
      dayLabel: '火',
      dateLabel: '3/24',
      slotLabel: '3限',
      slotNumber: 3,
      timeLabel: '16:20-17:50',
      isOpenDay: true,
      desks: [
        {
          id: '2026-03-24_3_desk_1',
          teacher: '田中講師',
          lesson: {
            id: 'l1',
            studentSlots: [
              { id: 'entry-1', name: '山田', managedStudentId: 'student-1', grade: '中3', subject: '数', lessonType: 'regular', teacherType: 'normal' },
              null,
            ],
          },
        },
        // 空席の机(lesson/statuses なし)。serializeCells の desks では落ちるが pickerDesks には残す。
        { id: '2026-03-24_3_desk_2', teacher: '鈴木講師' },
      ],
    }
  }

  function openDndPayload(extra: Record<string, unknown>) {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })
    openStudentScheduleHtml({
      cells: [createDndTestCell()],
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
      ...extra,
    })
    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()
    const match = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    return JSON.parse(match![1])
  }

  it('scheduleDndEnabled: true で開校日コマに pickerDesks(空席の机も含む)が載る', () => {
    const payload = openDndPayload({ scheduleDndEnabled: true })
    expect(payload.scheduleDndEnabled).toBe(true)
    const cell = payload.cells.find((c: { dateKey: string; slotNumber: number }) => c.dateKey === '2026-03-24' && c.slotNumber === 3)
    expect(cell.pickerDesks).toBeDefined()
    // 空席の机(鈴木講師)は desks では落ちるが pickerDesks には残る(机選択モーダルで空席を選べる)。
    expect(cell.pickerDesks.map((d: { teacher: string }) => d.teacher)).toEqual(['田中講師', '鈴木講師'])
    // 占有席は選択不可・空席は選択可(§C-2: 物理的な空きのみ判定)。
    expect(cell.pickerDesks[0].seats[0].occupied).toBe(true)
    expect(cell.pickerDesks[0].seats[0].selectable).toBe(false)
    expect(cell.pickerDesks[0].seats[1].selectable).toBe(true)
    expect(cell.pickerDesks[1].seats[0].selectable).toBe(true)
    expect(cell.pickerDesks[1].seats[1].selectable).toBe(true)
    // desks(印刷/表示用)は従来どおり空席の机を落とす(印刷経路は不変)。
    expect(cell.desks.length).toBe(1)
  })

  it('scheduleDndEnabled 未指定なら pickerDesks を載せない(本番/印刷のバイト増を避ける)', () => {
    const payload = openDndPayload({})
    expect(payload.scheduleDndEnabled).toBe(false)
    const cell = payload.cells.find((c: { dateKey: string; slotNumber: number }) => c.dateKey === '2026-03-24' && c.slotNumber === 3)
    expect(cell.pickerDesks).toBeUndefined()
  })
})

// 埋め込みJS(別タブ)の掴めるカード判定と配線。生成HTMLからクライアント関数を抽出して実挙動を固定する。
describe('日程表コマ組み 埋め込みJS: 掴めるカードのゲートと配線', () => {
  function openDndHtml(extra: Record<string, unknown>): string {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => popup,
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })
    openStudentScheduleHtml({
      cells: [createManualScheduleCell()],
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-24',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
      ...extra,
    })
    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()
    return html
  }

  // 生成HTMLから buildLessonCardDragAttrs(entry) の本体を取り出し、DATA/escapeHtml を差し替えて実行する。
  function extractDragAttrsFn(html: string) {
    const match = html.match(/function buildLessonCardDragAttrs\(entry\) \{([\s\S]*?)\n {6}\}/)
    expect(match).not.toBeNull()
    const fn = new Function('entry', 'DATA', 'escapeHtml', match![1]) as (entry: unknown, data: unknown, esc: (value: unknown) => string) => string
    const esc = (value: unknown) => String(value == null ? '' : value)
    return (entry: unknown, data: unknown) => fn(entry, data, esc)
  }

  it('scheduleDndEnabled 時、通常/振替/講習カードに is-draggable と source 属性を付ける', () => {
    const run = extractDragAttrsFn(openDndHtml({ scheduleDndEnabled: true }))
    const makeup = run({ id: 'e1', lessonType: 'makeup', subject: '数', linkedStudentId: 's1', name: '山田' }, { scheduleDndEnabled: true })
    expect(makeup).toContain('is-draggable')
    expect(makeup).toContain('data-role="lesson-card-draggable"')
    expect(makeup).toContain('data-entry-id="e1"')
    expect(makeup).toContain('data-lesson-type="makeup"')
    expect(makeup).toContain('data-linked-student-id="s1"')
    expect(run({ id: 'e2', lessonType: 'regular', subject: '英' }, { scheduleDndEnabled: true })).toContain('is-draggable')
    expect(run({ id: 'e3', lessonType: 'special', subject: '国' }, { scheduleDndEnabled: true })).toContain('is-draggable')
  })

  it('DnD無効・対象外種別(体験/増コマ)・entryId欠落は掴めない(空文字)', () => {
    const run = extractDragAttrsFn(openDndHtml({ scheduleDndEnabled: true }))
    expect(run({ id: 'e1', lessonType: 'makeup', subject: '数' }, { scheduleDndEnabled: false })).toBe('')
    expect(run({ id: 'e1', lessonType: 'trial', subject: '数' }, { scheduleDndEnabled: true })).toBe('')
    expect(run({ id: 'e1', lessonType: 'extra', subject: '数' }, { scheduleDndEnabled: true })).toBe('')
    expect(run({ id: '', lessonType: 'makeup', subject: '数' }, { scheduleDndEnabled: true })).toBe('')
  })

  it('D&D・机選択・移動要求送信・再描画時破棄の配線が埋め込みJSに含まれる(削除の回帰検知)', () => {
    const html = openDndHtml({ scheduleDndEnabled: true })
    expect(html).toContain('function setupScheduleDndMove()')
    expect(html).toContain('function onScheduleDndPointerDown(')
    expect(html).toContain('function openScheduleDeskPicker(')
    expect(html).toContain("type: 'schedule-student-move-request'")
    // 自動同期の再描画でドラッグ/モーダルを破棄する(宙に浮く DOM 参照を防ぐ)。
    expect(html).toContain('cancelScheduleDndInteraction();')
    // 机選択モーダルは盤面の一コマを切り取った表形式(日付行+時限列+1机=1行)。
    expect(html).toContain('class="desk-picker-board"')
    expect(html).toContain('class="dp-seatno"')
    expect(html).toContain('class="dp-teacher"')
    expect(html).toContain('class="dp-datehead"')
    expect(html).toContain('class="dp-time"')
    // 説明テキスト(タイトル/注記)は置かない(オーナー要望)。
    expect(html).not.toContain('の移動先の机を選ぶ')
    expect(html).not.toContain('この回のみ振替として移動します')
    // 移動結果ack(成功ハイライト/失敗の理由表示・日程表に戻る導線)の配線。
    expect(html).toContain('function handleScheduleMoveResult(')
    expect(html).toContain("message.type === 'schedule-student-move-result'")
    expect(html).toContain('function showScheduleMoveError(')
    expect(html).toContain('日程表に戻る')
    expect(html).toContain('function highlightMovedSlot(')
    expect(html).toContain('is-move-done-highlight')
  })

  // 生成HTMLから renderDeskPickerSeatCellHtml(desk, seat) を取り出し、席セルの形式を固定する。
  function extractSeatCellFn(html: string) {
    const match = html.match(/function renderDeskPickerSeatCellHtml\(desk, seat\) \{([\s\S]*?)\n {6}\}/)
    expect(match).not.toBeNull()
    const fn = new Function('desk', 'seat', 'escapeHtml', match![1]) as (desk: unknown, seat: unknown, esc: (value: unknown) => string) => string
    const esc = (value: unknown) => String(value == null ? '' : value)
    return (desk: unknown, seat: unknown) => fn(desk, seat, esc)
  }

  it('机選択モーダルの席セルは盤面と同じ td 形式(空席=クリック可td+机同一性・占有=非クリックtd)', () => {
    const run = extractSeatCellFn(openDndHtml({ scheduleDndEnabled: true }))
    const selectable = run({ deskIndex: 2, deskId: 'desk-2', teacher: '佐藤' }, { studentIndex: 1, selectable: true, occupied: false })
    expect(selectable).toContain('<td class="dp-student dp-selectable"')
    expect(selectable).toContain('data-role="desk-picker-seat"')
    expect(selectable).toContain('data-desk-index="2"')
    expect(selectable).toContain('data-student-index="1"')
    // 机同一性(deskId/講師)を持たせて positional index の食い違いに強くする。
    expect(selectable).toContain('data-desk-id="desk-2"')
    expect(selectable).toContain('data-desk-teacher="佐藤"')
    const occupied = run({ deskIndex: 0, deskId: 'desk-1', teacher: '田中' }, { studentIndex: 0, occupied: true, selectable: false, label: '山田 数' })
    expect(occupied).toContain('dp-occupied')
    expect(occupied).toContain('山田 数')
    // 占有席・メモ席はクリック不可(data-role を持たない)。
    expect(occupied).not.toContain('data-role="desk-picker-seat"')
    expect(run({ deskIndex: 1, deskId: 'desk-x', teacher: '' }, { studentIndex: 0, blockedByMemo: true, selectable: false })).toContain('dp-blocked')
  })
})
