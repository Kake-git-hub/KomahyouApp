import { describe, expect, it, vi } from 'vitest'
import { buildCombinedRegularLessonsFromHistory, buildExpectedRegularOccurrences, buildSerializedScheduleCountAdjustments, openStudentScheduleHtml, openTeacherScheduleHtml } from './scheduleHtml'
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
    isHidden: false,
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
    isHidden: false,
    memo: '',
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    availableSlots: [],
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

  it('serializes only lecture count adjustments for student schedule counts', () => {
    const adjustments = buildSerializedScheduleCountAdjustments({
      cells: [createManualScheduleCell()],
      scheduleCountAdjustments: [{
        studentKey: 'student-1',
        subject: '英',
        countKind: 'special',
        dateKey: '2026-03-25',
        delta: -1,
      }],
    })

    expect(adjustments).toEqual([
      {
        studentKey: 'student-1',
        subject: '英',
        countKind: 'special',
        dateKey: '2026-03-25',
        delta: -1,
      },
    ])
  })

  it('keeps regular desired counts based on contractual occurrences even when regular deletions exist', () => {
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
    // Verify embedded payload: 4 expected regular occurrences for 数, and no countAdjustments applied to regular
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    const mathOccurrences = payload.expectedRegularOccurrences.filter((o: { subject: string }) => o.subject === '数')
    // Function returns full participant period; March has 5 Tuesdays (no monthly cap)
    const marchMathOccurrences = mathOccurrences.filter((o: { dateKey: string }) => o.dateKey >= '2026-03-01' && o.dateKey <= '2026-03-31')
    expect(marchMathOccurrences).toHaveLength(5)
    expect(payload.countAdjustments).toEqual([])
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