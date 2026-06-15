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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
      plannedCells: [],
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
})
