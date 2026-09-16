import { describe, expect, it, vi } from 'vitest'
import { buildCombinedRegularLessonsFromHistory, buildExpectedRegularOccurrences, buildSerializedScheduleCountAdjustments, computeDeskPickerFitScale, openAllScheduleHtml, openStudentScheduleHtml, openTeacherScheduleHtml , resolveDisplayedOverlappingSession } from './scheduleHtml'
import { buildTeacherAssignments, collectTeacherAssignmentEntries, scheduleLessonTypeLabels } from './scheduleViewData'
import { computeTeacherMove } from '../components/schedule-board/ScheduleBoardScreen'
import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { RegularLessonTemplate } from '../components/regular-template/regularLessonTemplate'
import type { SlotCell, StudentEntry, StudentStatusEntry } from '../components/schedule-board/types'

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

function manualStudentEntry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'student-entry-1',
    name: '山田',
    managedStudentId: 'student-1',
    grade: '中3',
    subject: '数',
    lessonType: 'extra',
    teacherType: 'normal',
    manualAdded: true,
    ...overrides,
  }
}

function manualStatusEntry(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return {
    id: 'student-status-1',
    studentId: 'student-entry-1',
    sourceManagedLesson: false,
    name: '山田',
    managedStudentId: 'student-1',
    grade: '中3',
    subject: '数',
    lessonType: 'extra',
    teacherType: 'normal',
    teacherName: '田中講師',
    dateKey: '2026-03-24',
    slotNumber: 3,
    recordedAt: '2026-03-24T00:00:00.000Z',
    status: 'attended',
    sourceLessonId: 'manual-regular',
    manualAdded: true,
    ...overrides,
  }
}

function createManualBoardCell(
  studentSlots: [StudentEntry | null, StudentEntry | null],
  statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null],
): SlotCell {
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
      lesson: { id: 'manual-regular', studentSlots },
      statusSlots,
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

    // 盤面の手動追加コマは通常(regular)なので予定側 +1 の対象外（テンプレ予定と二重計上になるため）。
    // 削除調整の 2 件はそのまま素通しされる。
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

  // 回帰防止(INV-05・オーナー確定 2026-08-05): 室長が盤面で足した手動追加コマは「意図的な追加」なので、
  // 予定/希望側も +1 して警告を出さない。以前は講習だけ +1 で、増コマは実績だけ増え、
  // 生徒日程表に「予定数と一致していません！」が出っぱなしになっていた。
  describe('手動追加コマの予定/希望側 +1（増コマと講習のみ）', () => {
    it('増コマ(regular枠)と講習(special枠)は +1 する', () => {
      const cases: Array<{ lessonType: StudentEntry['lessonType']; countKind: 'regular' | 'special' }> = [
        { lessonType: 'extra', countKind: 'regular' },
        { lessonType: 'special', countKind: 'special' },
      ]

      for (const { lessonType, countKind } of cases) {
        const adjustments = buildSerializedScheduleCountAdjustments({
          cells: [createManualBoardCell([manualStudentEntry({ lessonType }), null])],
        })
        expect(adjustments).toEqual([{
          studentKey: 'student-1',
          subject: '数',
          countKind,
          dateKey: '2026-03-24',
          delta: 1,
        }])
      }
    })

    // ★手動追加の通常/振替を +1 してはいけない。基本データ由来の予定(expectedRegularOccurrences)と
    // 同じ枠に重なることが多く、+1 すると予定が二重に増えて逆に警告が出る（本番実測 2026-08-05:
    // 相殺されていない重複が 日大前54件・緑が丘68件）。増コマはテンプレに無いのでこの重複が起きない。
    it('手動追加の通常・振替は +1 しない（テンプレ予定と二重計上になるため）', () => {
      for (const lessonType of ['regular', 'makeup'] as const) {
        const adjustments = buildSerializedScheduleCountAdjustments({
          cells: [createManualBoardCell([manualStudentEntry({ lessonType }), null])],
        })
        expect(adjustments).toEqual([])
      }
    })

    // ★Step2 の最優先チェック（INV-05）。盤面ベースの予定数では増コマも盤面から直接数えるので、
    // ここで +1 を残すと 1 つの増コマで予定数が 2 増える（v1.5.468 の二重減算と同じ
    // 「新経路を足して旧経路を外し忘れる」型）。講習の +1 は新旧どちらでも積む。
    it('盤面ベースの予定数が有効なときは増コマの +1 を積まない（講習の +1 は積む）', () => {
      const extra = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([manualStudentEntry({ lessonType: 'extra' }), null])],
        boardBasedPlannedCountEnabled: true,
      })
      expect(extra).toEqual([])

      const lecture = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([manualStudentEntry({ lessonType: 'special' }), null])],
        boardBasedPlannedCountEnabled: true,
      })
      expect(lecture).toEqual([{
        studentKey: 'student-1',
        subject: '数',
        countKind: 'special',
        dateKey: '2026-03-24',
        delta: 1,
      }])
    })

    it('体験は生徒日程表に載らないので +1 しない', () => {
      const adjustments = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([manualStudentEntry({ lessonType: 'trial' }), null])],
      })
      expect(adjustments).toEqual([])
    })

    it('自動配置(手動追加でない)コマは +1 しない（テンプレ予定と二重に数えない）', () => {
      const adjustments = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([manualStudentEntry({ lessonType: 'extra', manualAdded: false }), null])],
      })
      expect(adjustments).toEqual([])
    })

    // ★studentSlots だけ走査すると、出席を付けた途端に +1 が消えて警告が出る（INV-06 と同じ両走査規則）。
    it('出欠を付けた手動追加コマ(statusSlots へ移る)も +1 を維持する', () => {
      const adjustments = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([null, null], [manualStatusEntry({ status: 'attended' }), null])],
      })
      expect(adjustments).toEqual([{
        studentKey: 'student-1',
        subject: '数',
        countKind: 'regular',
        dateKey: '2026-03-24',
        delta: 1,
      }])
    })

    it('欠席・移動済みは実績に数えないので +1 しない（振無休は数えるので +1 する）', () => {
      for (const status of ['absent', 'moved'] as const) {
        const adjustments = buildSerializedScheduleCountAdjustments({
          cells: [createManualBoardCell([null, null], [manualStatusEntry({ status }), null])],
        })
        expect(adjustments).toEqual([])
      }

      const noMakeup = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([null, null], [manualStatusEntry({ status: 'absent-no-makeup' }), null])],
      })
      expect(noMakeup).toHaveLength(1)
      expect(noMakeup[0]?.delta).toBe(1)
    })

    // 【2026-09-16】休日設定で残る表示専用の記録(holiday)も実績に数えない＝moved と同じ側。
    // +1 したままだと「休日にしたのに予定数/希望数が増える」(INV-05 回数表示の実配置一致に反する)。
    it('★休日記録(holiday)は実績に数えないので +1 しない（増コマ・講習とも）', () => {
      for (const lessonType of ['extra', 'special'] as const) {
        const adjustments = buildSerializedScheduleCountAdjustments({
          cells: [createManualBoardCell([null, null], [manualStatusEntry({ status: 'holiday', lessonType }), null])],
        })
        expect(adjustments, lessonType).toEqual([])
      }
      // 対照: 同じ手動追加コマでも出席なら従来どおり +1（ガードを広げすぎていない）。
      const attended = buildSerializedScheduleCountAdjustments({
        cells: [createManualBoardCell([null, null], [manualStatusEntry({ status: 'attended', lessonType: 'special' }), null])],
      })
      expect(attended).toHaveLength(1)
      expect(attended[0]?.countKind).toBe('special')
    })
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
    // ★このテストの主眼は「表示名が古くても managedStudentId で紐付く」こと(linkedStudentId)。
    // 氏名の期待値は 2026-08-29 のオーナー確定(氏名は名簿の現在値に追従・No.146)で
    // 「旧表示名のまま」→「名簿の現在名」へ意図的に変更した(紐付けの保証は下の行で維持)。
    expect(student?.name).toBe('新表示名')
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

  // 回帰防止(オーナー確定 2026-08-05): 括弧内の呼称は通常＝テンプレ由来の「予定数」、講習＝提出由来の
  // 「希望数」で出どころが違う。両方を「希望数」と書くと通常側が提出由来だと誤読される。警告文も同じ語で呼び分ける。
  it('回数表の括弧と警告文は通常=予定数・講習=希望数で呼び分ける', () => {
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
    expect(html).toContain('通常回数<span class="print-only-hidden">(予定数)</span>')
    expect(html).toContain('講習回数<span class="print-only-hidden">(希望数)</span>')
    expect(html).toContain('data-testid="student-schedule-regular-count-warning">予定数と一致していません！')
    expect(html).toContain('data-testid="student-schedule-lecture-count-warning">希望数と一致していません！')
    // 旧文言(通常側まで「希望数」)が残っていないこと。
    expect(html).not.toContain('通常回数<span class="print-only-hidden">(希望数)</span>')
    expect(html).not.toContain('希望数と予定数が一致していません！')
    vi.unstubAllGlobals()
  })

  // タブ名(document.title)は取り違え防止のため教室名を出し、期間は出さない(オーナー要望 2026-07-09)。
  it('タブ名に教室名を出し、期間は出さない', () => {
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
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.classroomName).toBe('開発用教室') // 教室名がペイロードに乗る
    // document.title は教室名を使い、期間(formatRangeLabel)を使わない。
    expect(html).toContain("document.title = VIEW_LABEL + (DATA.classroomName ? ' | ' + DATA.classroomName : '')")
    expect(html).not.toContain("document.title = VIEW_LABEL + ' | ' + formatRangeLabel(startDate, endDate)")
    vi.unstubAllGlobals()
  })

  // 手動テスト No.250(2026-08-29): 盤面の講習コマの授業時間(60/45分)が日程表セルに出ない不具合の回帰防止。
  // 描画側(renderStudentCellCard の formatScheduleMinutesSuffix)は対応済みだったが、シリアライズが
  // noteSuffix を落としており(SerializedStudentEntry に項目が無い)、未出欠の配置コマだけ常に90分表示だった
  // (出欠記録済みの statusEntry 側は元から載る非対称)。
  it('盤面コマの noteSuffix(授業時間 60/45)がペイロードの students に載る', () => {
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
      cells: [{
        id: 'cell-1',
        dateKey: '2026-03-24',
        dayLabel: '火',
        dateLabel: '3/24',
        slotLabel: '1限',
        slotNumber: 1,
        timeLabel: '',
        isOpenDay: true,
        desks: [{
          id: 'desk-1',
          teacher: '田中',
          lesson: {
            id: 'lesson-1',
            studentSlots: [
              { id: 'entry-1', name: '生徒A', managedStudentId: 'st-1', grade: '小5', subject: '算', lessonType: 'special', teacherType: 'normal', noteSuffix: '60' },
              null,
            ],
          },
        }],
      } as unknown as Parameters<typeof openStudentScheduleHtml>[0]['cells'][number]],
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    const payload = JSON.parse(payloadMatch![1])
    const serializedStudent = payload.cells?.[0]?.desks?.[0]?.lesson?.students?.[0]
    expect(serializedStudent?.noteSuffix).toBe('60')
    vi.unstubAllGlobals()
  })

  // 手動テスト No.279(2026-08-29): D&D の無効ドロップが無言だった回帰防止。理由表示は
  // 「盤面から ok:false が返るケース」だけで、別タブ側で弾く不成立(休校日・同一生徒のいるコマ等)に
  // else が無かった。コマのセル上に落として置けないときは理由オーバーレイを出す(セル外は無言キャンセル)。
  it('D&D 無効ドロップに理由表示の分岐が生成スクリプトへ含まれる(No.279)', () => {
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
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('function resolveScheduleDndRejectReason')
    expect(html).toContain('resolveScheduleDndRejectReason(event.clientX, event.clientY)')
    expect(html).toContain('移動先は休校日のため移動できません。')
    expect(html).toContain('この生徒の授業がすでにあるコマへは移動できません。')
    vi.unstubAllGlobals()
  })

  // 手動テスト No.146(2026-08-29 オーナー確定の線引き): **氏名は名簿の現在値に追従**し、
  // **科目・種別・授業時間は配置時の値のまま**(その授業の記録なので名簿に追従させない)。
  // 盤面は v1.5.482 で ID 優先解決済みだったが日程表(講師日程表のセル・ツールチップ)が旧名のままだった。
  it('改名後の日程表セルは名簿の現在の表示名になり、科目・種別は配置時の値のまま(No.146)', () => {
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

    // 名簿では「佐藤(新)」へ改名済み。盤面セルには配置時の旧表示名「山田」が焼き付いている。
    const renamedStudent = createStudent({ id: 'st-1', name: '佐藤 花子', displayName: '佐藤(新)' })
    openTeacherScheduleHtml({
      cells: [{
        id: 'cell-1',
        dateKey: '2026-03-24',
        dayLabel: '火',
        dateLabel: '3/24',
        slotLabel: '1限',
        slotNumber: 1,
        timeLabel: '',
        isOpenDay: true,
        desks: [{
          id: 'desk-1',
          teacher: '田中',
          lesson: {
            id: 'lesson-1',
            studentSlots: [
              { id: 'entry-1', name: '山田', managedStudentId: 'st-1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal' },
              // 名簿外(体験生)は配置時の名前のまま。
              { id: 'entry-2', name: '体験 次郎', grade: '中1', subject: '英', lessonType: 'trial', teacherType: 'normal' },
            ],
          },
        }],
      } as unknown as Parameters<typeof openTeacherScheduleHtml>[0]['cells'][number]],
      teachers: [],
      students: [renamedStudent],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    const payload = JSON.parse(payloadMatch![1])
    const [managed, trial] = payload.cells?.[0]?.desks?.[0]?.lesson?.students ?? []
    expect(managed?.name).toBe('佐藤(新)') // 名簿の現在名へ追従(修正なしだと '山田' のまま)
    expect(managed?.subject).toBe('数') // 科目は配置時の値のまま(名簿に追従させない)
    expect(managed?.lessonType).toBe('regular')
    expect(trial?.name).toBe('体験 次郎') // 名簿外・体験はそのまま
    vi.unstubAllGlobals()
  })

  // 手動テスト No.201(2026-08-29): 表示範囲に講習期間が2つ重なると session:undefined になり
  // 全員のQR・「希望提出済」バッジが消えていた回帰防止。複数重なりでも1つを選ぶ。
  describe('resolveDisplayedOverlappingSession (表示範囲に複数講習が重なるときのQR/バッジ講習の選択)', () => {
    const sessionA = { id: 'a', startDate: '2026-07-20', endDate: '2026-08-10' }
    const sessionB = { id: 'b', startDate: '2026-08-20', endDate: '2026-08-31' }

    it('重なりが0件は undefined・1件はそれを返す', () => {
      expect(resolveDisplayedOverlappingSession([sessionA], '2026-09-01', '2026-09-07')).toBeUndefined()
      expect(resolveDisplayedOverlappingSession([sessionA, sessionB], '2026-07-25', '2026-08-01')?.id).toBe('a')
    })

    it('複数重なるときは表示開始日を含む講習を優先する(旧実装は undefined で全消しだった)', () => {
      // 表示 8/1〜8/31 は A(〜8/10) と B(8/20〜) の両方に重なる。開始日 8/1 を含むのは A。
      expect(resolveDisplayedOverlappingSession([sessionA, sessionB], '2026-08-01', '2026-08-31')?.id).toBe('a')
      // 表示 8/25〜9/5 の開始日を含むのは B。
      expect(resolveDisplayedOverlappingSession([sessionA, sessionB], '2026-08-25', '2026-09-05')?.id).toBe('b')
    })

    it('表示開始日を含む講習が無ければ、表示範囲内で最初に始まる講習を選ぶ(フォールバック分岐)', () => {
      // INV監査 2026-08-29: フォールバックを実際に踏む fixture にする(表示開始日 8/12 はどちらにも
      // 含まれず、かつ両方が表示範囲に重なる)。早期 return では通らない分岐を mutation 耐性つきで固定。
      const midA = { id: 'mid-a', startDate: '2026-08-15', endDate: '2026-08-20' }
      const midB = { id: 'mid-b', startDate: '2026-08-25', endDate: '2026-08-31' }
      expect(resolveDisplayedOverlappingSession([midB, midA], '2026-08-12', '2026-09-30')?.id).toBe('mid-a')
    })
  })

  it('ペイロードに qrSessionId(バッジが指す講習)が載り、登録解除は表示中講習のときだけバッジを落とす(No.201)', () => {
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
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-07-25',
      defaultEndDate: '2026-08-01',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      specialSessions: [
        { id: 'sess-display', label: '夏期', startDate: '2026-07-20', endDate: '2026-08-10', teacherInputs: {}, studentInputs: {}, createdAt: '', updatedAt: '' },
      ] as unknown as NonNullable<Parameters<typeof openStudentScheduleHtml>[0]['specialSessions']>,
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.qrSessionId).toBe('sess-display')
    // 埋め込みJSの登録解除は qrSessionId 一致のときだけ submissionSubmitted を落とす(別講習の解除で消さない)。
    expect(html).toContain('DATA.qrSessionId === activeCountDialog.sessionId')
    expect(html).toContain('DATA.qrSessionId === activeTeacherRegisterDialog.sessionId')
    vi.unstubAllGlobals()
  })

  // 手動テスト No.210(2026-08-29): opener(コマ表本体タブ)不在時、登録/解除の postMessage が黙って捨てられ
  // 「登録解除できたのに再提出できない」に見えていた。ユーザーの明示操作(提出/解除/黄色化/移動)は
  // 反映されないことをその場で知らせる。自動通知系(popup-ready/最新表示通知/連絡事項)は開くだけで
  // 連発するため対象外(無言のまま)であることも固定する。
  it('opener 不在の明示操作は isOpenerAvailable で知らせ、自動通知系は無言のまま(No.210)', () => {
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
      students: [createStudent({})],
      regularLessons: [],
      defaultStartDate: '2026-03-24',
      defaultEndDate: '2026-03-30',
      titleLabel: 'テスト',
      classroomName: '開発用教室',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('function isOpenerAvailable()')
    expect(html).toContain('この操作は反映されていません')
    // 明示操作の persist 系は isOpenerAvailable を通る(無言 return に戻すと落ちる)。
    const persistFns = ['function persistStudentCount(', 'function persistTeacherCount(', 'function persistUnavailableSlots(', 'function persistTeacherUnavailableSlots(']
    for (const fn of persistFns) {
      const start = html.indexOf(fn)
      expect(start, fn).toBeGreaterThan(-1)
      const body = html.slice(start, start + 600)
      expect(body, fn).toContain('isOpenerAvailable()')
    }
    // 自動通知系は対象外(alert 連発防止)。
    for (const fn of ['function notifyPopupReady(', 'function notifyRangeChange(', 'function postScheduleNoteUpdate(']) {
      const start = html.indexOf(fn)
      expect(start, fn).toBeGreaterThan(-1)
      const body = html.slice(start, start + 400)
      expect(body, fn).not.toContain('isOpenerAvailable()')
    }
    // 残り2経路(INV監査 2026-08-29): 黄色化(applyTeacherReopenSlot)は isOpenerAvailable、
    // 移動(sendScheduleMoveRequest)は既存の move-error オーバーレイで知らせる。無言 return へ戻すと落ちる。
    {
      const reopenStart = html.indexOf('function applyTeacherReopenSlot(')
      expect(reopenStart).toBeGreaterThan(-1)
      expect(html.slice(reopenStart, reopenStart + 2400)).toContain('isOpenerAvailable()')
      const moveStart = html.indexOf('function sendScheduleMoveRequest(')
      expect(moveStart).toBeGreaterThan(-1)
      expect(html.slice(moveStart, moveStart + 800)).toContain('コマ表アプリ本体のタブが見つからないため移動できません')
    }
  })

  // 回帰防止(オーナー要望 2026-07-08): 講習回数の科目が多い生徒が A4横シート(height:190mm; overflow:hidden)の
  // 下端で見切れる不具合を、印刷時だけ count-table の行高を詰めることで解消した。@media print 内で
  // .count-table の行高が既定(22px)より小さいことを固定する(将来の変更で 22px 等へ戻すと落ちる)。
  it('印刷時は講習回数/通常回数表の行高を詰める(科目が多い生徒のA4見切れ防止)', () => {
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
    // @media print ブロック内の count-table 行高だけを見る(画面表示の 22px と区別)。
    const printBlock = html.slice(html.indexOf('@media print'))
    const heightMatch = printBlock.match(/\.count-table th,\s*\.count-table td\s*\{[^}]*height:\s*(\d+)px/)
    expect(heightMatch).not.toBeNull()
    expect(Number(heightMatch![1])).toBeLessThanOrEqual(18)

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

  // 回帰防止(2026-07-11): 講習集計結果の「オプション」列セル。チェック済み行のラベルを ' / ' で並べる。
  // record キーは '0'..'4'。ラベル未設定のチェック行は 'オプションN'、未チェック/optionChecksなしは '—'。
  it('formats the option cell (checked option labels) for the lecture summary', () => {
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
    const match = html.match(/function formatLectureOptionCell\(input, labels\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const format = new Function('input', 'labels', match![1]) as (
      input: { countSubmitted?: boolean; optionChecks?: Record<string, boolean> } | null | undefined,
      labels: (string | undefined)[] | undefined,
    ) => string
    const labels = ['英検対策', '数検対策', '', '保護者面談', '教材']

    // 未登録(countSubmitted なし)は、チェックが残っていても '—'(希望科目/提出方法列と整合)。
    expect(format(undefined, labels)).toBe('—')
    expect(format({ optionChecks: { '0': true } }, labels)).toBe('—')
    // 登録済みだが optionChecks なし → —。
    expect(format({ countSubmitted: true }, labels)).toBe('—')
    expect(format({ countSubmitted: true, optionChecks: {} }, labels)).toBe('—')
    // 登録済み: チェック済み行(record key '0'..'4')のラベルを ' / ' 連結。
    expect(format({ countSubmitted: true, optionChecks: { '0': true, '3': true } }, labels)).toBe('英検対策 / 保護者面談')
    // チェック済みだがラベル未設定の行は 'オプションN'。
    expect(format({ countSubmitted: true, optionChecks: { '2': true } }, labels)).toBe('オプション3')
    // false は無視。ラベル配列未指定でも落ちない。
    expect(format({ countSubmitted: true, optionChecks: { '0': false } }, labels)).toBe('—')
    expect(format({ countSubmitted: true, optionChecks: { '1': true } }, undefined)).toBe('オプション2')

    vi.unstubAllGlobals()
  })

  // 回帰防止(2026-07-11): 講習集計結果(生徒版)は optionFieldEnabled のときだけ「オプション」列と有人数集計を追加する。
  it('wires an オプション column + tally into the student lecture summary (gated on optionFieldEnabled)', () => {
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
    // 実行時ゲート(開発用教室のみ)。列ヘッダ・セル・集計は optionEnabled でのみ出る。
    expect(html).toContain('var optionEnabled = !!DATA.optionFieldEnabled;')
    expect(html).toContain("var optionHeader = optionEnabled ? '<th>オプション</th>' : '';")
    expect(html).toContain('formatLectureOptionCell(inputs[student.id], getStudentOptionLabels(student))')
    // オプション有の人数を集計行に追加。空行 colspan もフラグで 7/6 に切り替える。
    expect(html).toContain("(optionEnabled ? ' / オプション有 ' + optionCount + '人' : '')")
    expect(html).toContain('var emptyColspan = optionEnabled ? 7 : 6;')
    // 既存の列(希望科目/提出日時/提出方法)は維持(回帰防止)。
    expect(html).toContain('<th>提出日時</th><th>提出方法</th>')

    vi.unstubAllGlobals()
  })

  // 回帰防止(2026-07-11): 空フォーマットは「単体で」連絡事項/オプションを入力・保持する。
  // 実データ(scheduleNotes)から切り離した専用ストレージへ保存し、開いても自動印刷せず編集→印刷ボタン。
  it('makes the empty format self-persist 連絡事項/オプション in its own storage (edit-then-print)', () => {
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
    // 空フォーマットの3フィールドは data-note-key(scheduleNotes) ではなく専用の data-empty-format-field に切り替える。
    expect(html).toContain(" data-empty-format-field=\"common\"")
    expect(html).toContain(" data-empty-format-field=\"individual\"")
    expect(html).toContain(" data-empty-format-field=\"option-' + i + '\"")
    // 専用ストレージ(sharedGlobalStoragePrefix + 'empty-format:')へ読み書きするエディタスクリプトを注入。
    expect(html).toContain('function buildEmptyFormatEditorScript(storagePrefix)')
    expect(html).toContain("buildEmptyFormatEditorScript(sharedGlobalStoragePrefix + 'empty-format:')")
    // 編集してから印刷: 印刷ボタン(ツールバー)を出し、editorScript を差し込む(自動印刷しない)。
    expect(html).toContain('class="empty-format-toolbar')
    expect(html).toContain("' + toolbarHtml + sheetHtml + editorScript + '")
    // 回帰防止(2026-07-12): body.all-view .sheet は pointer-events:none。この上書きが無いと欄をクリックしても
    // 入力モードに入れない(ポップアップに実際に出た不具合)。空フォーマット欄だけ pointer-events を再有効化する。
    expect(html).toContain('[data-empty-format-field]{pointer-events:auto;}')

    // エディタスクリプトビルダを抽出し、構文妥当性と専用キー束縛を固定する(テンプレートエスケープ崩れ検知)。
    const match = html.match(/function buildEmptyFormatEditorScript\(storagePrefix\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const build = new Function('storagePrefix', match![1]) as (prefix: string) => string
    const script = build('schedule-shared:x:global:empty-format:')
    expect(script.startsWith('<script>')).toBe(true)
    expect(script).toContain('[data-empty-format-field]')
    expect(script).toContain('addEventListener')
    expect(script).toContain('window.opener')
    expect(script).toContain('"schedule-shared:x:global:empty-format:"')
    // 出荷スクリプト本体が構文的に妥当であること(<script>ラッパを外して new Function でパース)。
    const inner = script.replace('<script>', '').replace('</script>', '')
    expect(() => new Function(inner)).not.toThrow()

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

  // Issue #61(緑が丘・オーナー確定 2026-09-07): 講習回数表の右括弧(希望数)を印刷にも載せる。
  // 講師が紙の実績「13」だけを見て講習終了と誤読しカルテに記載した(実際は希望15・9月に2コマ組み済み)。
  // 印字するのは提出由来の希望がある個別科目だけ: 希望が無く実績へフォールバックする行(「N(N)」)・
  // 集団(集理/集社)・通常回数表(printDesired 無し)・講師日程表は従来どおり画面のみ。
  // 見出しは画面「(希望数)」/印刷「(予定)」(右括弧は提出＋手動追加−削除の予定総数なので保護者向けに「希望」と書かない)。
  // spec-schedule-pdf §E。修正なしでは count-desired / print-only-visible が存在せず落ちる。
  it('prints the lecture desired count on paper only for submitted individual subjects (Issue #61)', () => {
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

    const rowsMatch = html.match(/function toCountRows\(countMap, desiredCountMap, forcedLabels, options\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(rowsMatch).toBeTruthy()
    const escapeHtml = (value: unknown) => String(value == null ? '' : value)
    const SUBJECT_SORT_ORDER = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '理社', '集理', '集社']
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

    // 講習回数表(printDesired): 提出由来の希望がある「英」だけ印刷用 span(count-desired)。
    const printed = toCountRows({ 英: 13, 国: 2, 集理: 3 }, { 英: 15, 集理: 5 }, ['英'], { hideZeroZero: true, printDesired: true }, escapeHtml, SUBJECT_SORT_ORDER)
    expect(printed).toContain('<td>英</td><td>13<span class="count-desired">(15)</span></td>')
    // 希望が無い科目は実績へのフォールバック「2(2)」で、偽の予定数を紙に出さない(画面のみ)。
    expect(printed).toContain('<td>国</td><td>2<span class="print-only-hidden">(2)</span></td>')
    // 集団は希望=期間内コマ数(家庭の希望ではない)なので画面のみ。
    expect(printed).toContain('<td>集理</td><td>3<span class="print-only-hidden">(5)</span></td>')
    // 通常回数表(printDesired 無し)は従来どおり画面のみ(予定数は印字しない)。
    const regular = toCountRows({ 英: 13 }, { 英: 15 }, ['英'], {}, escapeHtml, SUBJECT_SORT_ORDER)
    expect(regular).toContain('<td>英</td><td>13<span class="print-only-hidden">(15)</span></td>')
    expect(regular).not.toContain('count-desired')

    // 生徒シートの講習回数表だけが printDesired を渡す(通常回数表・講師日程表には渡さない)。
    expect((html.match(/printDesired: true/g) || []).length).toBe(1)
    expect(html).toContain('labelMinutesMap: lectureMinutesBySubject, printDesired: true})')

    // 見出し: 生徒シートは画面「(希望数)」+印刷「(予定)」。通常回数は印刷用 span を持たない。
    expect(html).toContain('講習回数<span class="print-only-hidden">(希望数)</span><span class="print-only-visible">(予定)</span>')
    expect(html).not.toContain('通常回数<span class="print-only-hidden">(予定数)</span><span class="print-only-visible">')
    // 講師シートの見出しは従来どおり(印刷用 span 無し)= 「(希望数)</span></div>」が講師分の1箇所だけ残る。
    expect((html.match(/講習回数<span class="print-only-hidden">\(希望数\)<\/span><\/div>/g) || []).length).toBe(1)

    // CSS: print-only-visible は画面で隠し、@media print で出す。
    expect(html).toMatch(/\.print-only-visible\s*\{\s*display:\s*none;\s*\}/)
    const printBlock = html.slice(html.indexOf('@media print'))
    expect(printBlock).toContain('.print-only-visible { display: inline; }')

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

  // 回帰防止(2026-07-09): 講習集計結果の「提出日時/提出方法」を出すため、submittedAt/submissionMethod を
  // payload に必ず載せる。欠けると popup の DATA.specialSessions に届かず全て '—' に化ける
  // (subjectDurations が serialize から落ちて分数が消えた v1.5.400 と同型の非対称)。
  it('serializes submittedAt/submissionMethod (student & teacher) into the schedule payload', () => {
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
        teacherInputs: {
          'teacher-1': {
            unavailableSlots: [],
            countSubmitted: true,
            submittedAt: '2026-03-05T01:00:00.000Z',
            submissionMethod: 'manual',
            updatedAt: '2026-03-05T01:00:00.000Z',
          },
        },
        studentInputs: {
          'student-1': {
            unavailableSlots: [],
            regularBreakSlots: [],
            subjectSlots: { 数: 2 },
            regularOnly: false,
            countSubmitted: true,
            submittedAt: '2026-03-04T02:00:00.000Z',
            submissionMethod: 'qr',
            updatedAt: '2026-03-04T02:00:00.000Z',
          },
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-05T01:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('"submittedAt":"2026-03-04T02:00:00.000Z"')
    expect(html).toContain('"submissionMethod":"qr"')
    expect(html).toContain('"submittedAt":"2026-03-05T01:00:00.000Z"')
    expect(html).toContain('"submissionMethod":"manual"')

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
    // 【移行中・INV-05】旧方式（テンプレ由来 ± 表示調整）は boardBasedPlannedCountEnabled=false の教室で使われ続ける。
    expect(html).toContain('applyCountAdjustments(normalizeCountMapSubjects(plannedRegularCounts, student, startDate), regularCountAdjustments)')
    // 新方式（実績 ＋ 未振替の休み）への分岐が入っていること。この教室は無効なので旧方式で描画される。
    expect(html).toContain('DATA.boardBasedPlannedCountEnabled')
    expect(html).toContain('addCountMaps(visibleRegularCounts, buildOutstandingAbsenceCountMap(student, startDate, endDate))')
    expect(payload.boardBasedPlannedCountEnabled).toBe(false)
    expect(payload.outstandingAbsences).toEqual([])
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

  it('embeds 理社 as an elementary-only combined subject (回帰防止)', () => {
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
      students: [createStudent({ birthDate: '2015-05-10' })],
      regularLessons: [],
      defaultStartDate: '2026-04-10',
      defaultEndDate: '2026-04-16',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    expect(typeof html).toBe('string')
    // 理社は小学限定で表示され、非小学では理へ畳む(算国と同型)。
    expect(html).toContain("if (subject === '理社') return preferredMathSubject === '算';")
    expect(html).toContain("if (subject === '理社') return getPreferredMathSubject(student, referenceDate) === '算' ? '理社' : '理';")
    // 表示順は社の直後・集理/集社の前。
    expect(html).toContain("['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '理社', '集理', '集社']")
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

  // 回帰防止 end-to-end(2026-07-11 報告・開発用教室 落合↔山本 8/25 5限): テンプレ配置由来で
  // teacherAssignmentTeacherId を持たない講師どうしを入れ替える(swap)と、着地した机が id を欠いたまま
  // 書き出され、生徒の基本データ担当講師(=旧講師)の regularTeacherIds で二重表示されていた。
  // 修正(computeTeacherMove が着地講師名から id を補完)を経て、書き出し→帰属ロジックまで通し、
  // 生徒が新講師のページにだけ出て旧講師には出ないことを検証する(埋め込みJSと同一実装の TS 版で照合)。
  it('講師の入れ替え(swap)後、生徒は新講師のページにだけ出て旧講師には二重表示されない(computeTeacherMove→書き出し端到端)', () => {
    const teachers = [
      createTeacher({ id: 't_ochiai', name: '落合 優太', displayName: '落合', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }] }),
      createTeacher({ id: 't_yamamoto', name: '山本 花子', displayName: '山本', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }),
    ]
    const students = [
      createStudent({ id: 'student-a', name: '井上 一郎', displayName: '井上' }),
      createStudent({ id: 'student-b', name: '青木 二郎', displayName: '青木' }),
    ]
    const regularLessons = [
      createRegularLesson({ id: 'r-ochiai-a', schoolYear: 2026, teacherId: 't_ochiai', student1Id: 'student-a', subject1: '英', startDate: '2026-04-01', endDate: '未定', dayOfWeek: 5, slotNumber: 5 }),
      createRegularLesson({ id: 'r-yamamoto-b', schoolYear: 2026, teacherId: 't_yamamoto', student1Id: 'student-b', subject1: '数', startDate: '2026-04-01', endDate: '未定', dayOfWeek: 5, slotNumber: 5 }),
    ]
    // 盤面: 2026-07-24(金) 5限に落合(生徒A=井上)と山本(生徒B=青木)がテンプレ配置。どちらも id 未保持。
    const boardWeeks = [[{
      id: '2026-07-24_5',
      dateKey: '2026-07-24',
      dayLabel: '金',
      dateLabel: '7/24',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [
        { id: '2026-07-24_5_desk_1', teacher: '落合', lesson: { id: 'l-a', studentSlots: [{ id: 'student-a_2026-07-24_英', name: '井上', managedStudentId: 'student-a', grade: '中2', subject: '英', lessonType: 'regular', teacherType: 'normal' }, null] } },
        { id: '2026-07-24_5_desk_2', teacher: '山本', lesson: { id: 'l-b', studentSlots: [{ id: 'student-b_2026-07-24_数', name: '青木', managedStudentId: 'student-b', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }, null] } },
      ],
    }]] as unknown as SlotCell[][]

    const move = computeTeacherMove({ weeks: boardWeeks, weekIndex: 0, cellId: '2026-07-24_5', sourceDeskIndex: 0, targetDeskIndex: 1, teachers })
    expect(move.status).toBe('moved')
    if (move.status !== 'moved') return

    const write = vi.fn()
    const popup = { closed: false, document: { open() {}, write, close() {} }, focus() {}, postMessage() {} } as unknown as Window
    vi.stubGlobal('window', { open: () => popup, setTimeout: (cb: () => void) => { cb(); return 0 } })

    openTeacherScheduleHtml({
      cells: move.nextWeeks[0],
      teachers,
      students,
      regularLessons,
      defaultStartDate: '2026-07-21',
      defaultEndDate: '2026-07-31',
      defaultPersonId: 't_ochiai',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])

    const assignmentMap = buildTeacherAssignments(payload.cells)
    const namesFor = (teacher: { id: string; name: string; fullName: string }) =>
      collectTeacherAssignmentEntries(assignmentMap, teacher as Parameters<typeof collectTeacherAssignmentEntries>[1])
        .flatMap((entry) => (entry.students || []).map((student) => student.name))
    const ochiaiNames = namesFor({ id: 't_ochiai', name: '落合', fullName: '落合 優太' })
    const yamamotoNames = namesFor({ id: 't_yamamoto', name: '山本', fullName: '山本 花子' })

    // 井上(生徒A)は新担当の山本にだけ出る。旧担当の落合には二重表示されない(修正前はここで落合にも出て落ちる)。
    expect(yamamotoNames).toContain('井上')
    expect(ochiaiNames).not.toContain('井上')
    // 対称に青木(生徒B)は落合にだけ出る。
    expect(ochiaiNames).toContain('青木')
    expect(yamamotoNames).not.toContain('青木')
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
    // 提出日時/提出方法の列とヘルパ(2026-07-09)。
    expect(studentHtml).toContain('<th>提出日時</th><th>提出方法</th>')
    expect(studentHtml).toContain('function formatSubmissionDateTime(submittedAt)')
    expect(studentHtml).toContain('function resolveSubmissionMethodLabel(input)')
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
    // 講師日程にも講習集計結果ボタンを追加(2026-07-09)。講師版は希望科目列を出さず、専用ビルダを使う。
    expect(teacherHtml).toContain('id="schedule-lecture-summary-button"')
    expect(teacherHtml).toContain('function buildTeacherLectureSummaryHtml(startDate, endDate)')
    // 講師版の集計結果表は希望科目列を出さない(オーナー指示)。列は No./講師名/登録状況/提出日時/提出方法。
    // (生徒版ビルダも同じ script に同梱されるため、講師表ヘッダの完全一致で列構成を固定する)
    expect(teacherHtml).toContain('<th>No.</th><th>講師名</th><th>登録状況</th><th>提出日時</th><th>提出方法</th>')

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

  // 回帰防止(2026-07-09): 講習集計結果の「提出日時」列。ISO文字列を JST(M/D HH:MM)で出す。
  // ランタイムのタイムゾーンに依存せず +9h→UTC成分で読むこと(CIのUTCでも決定的)。未提出/不正は '—'。
  it('formats the submission datetime in JST for the lecture summary', () => {
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
    const match = html.match(/function formatSubmissionDateTime\(submittedAt\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const format = new Function('submittedAt', match![1]) as (submittedAt: unknown) => string

    // UTC 2026-07-06T06:25:00Z = JST 15:25 → '7/6 15:25'。
    expect(format('2026-07-06T06:25:00.000Z')).toBe('7/6 15:25')
    // 日付境界: UTC 2026-07-06T15:30:00Z = JST 翌日 00:30 → '7/7 00:30'。
    expect(format('2026-07-06T15:30:00.000Z')).toBe('7/7 00:30')
    // 未提出・不正・非文字列は '—'。
    expect(format(null)).toBe('—')
    expect(format('')).toBe('—')
    expect(format('not-a-date')).toBe('—')

    vi.unstubAllGlobals()
  })

  // 回帰防止(2026-07-09): 講習集計結果の「提出方法」列。QR提出/室長登録を区別する。
  // 未登録は '—'、登録済みでも方法不明(機能導入前の既存データ)は '—'。
  it('labels the submission method (QR vs classroom-head) for the lecture summary', () => {
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
    const match = html.match(/function resolveSubmissionMethodLabel\(input\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const resolveMethod = new Function('input', match![1]) as (
      input: { countSubmitted?: boolean; submissionMethod?: string } | null | undefined,
    ) => string

    expect(resolveMethod(undefined)).toBe('—')
    expect(resolveMethod({ countSubmitted: false, submissionMethod: 'qr' })).toBe('—')
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'qr' })).toBe('QR提出')
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'manual' })).toBe('室長登録')
    // 登録済みだが方法未設定(既存データ)は '—'。
    expect(resolveMethod({ countSubmitted: true })).toBe('—')

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

  it('scheduleDndEnabled 時、通常/振替/講習/増コマカードに is-draggable と source 属性を付ける', () => {
    const run = extractDragAttrsFn(openDndHtml({ scheduleDndEnabled: true }))
    const makeup = run({ id: 'e1', lessonType: 'makeup', subject: '数', linkedStudentId: 's1', name: '山田' }, { scheduleDndEnabled: true })
    expect(makeup).toContain('is-draggable')
    expect(makeup).toContain('data-role="lesson-card-draggable"')
    expect(makeup).toContain('data-entry-id="e1"')
    expect(makeup).toContain('data-lesson-type="makeup"')
    expect(makeup).toContain('data-linked-student-id="s1"')
    expect(run({ id: 'e2', lessonType: 'regular', subject: '英' }, { scheduleDndEnabled: true })).toContain('is-draggable')
    expect(run({ id: 'e3', lessonType: 'special', subject: '国' }, { scheduleDndEnabled: true })).toContain('is-draggable')
    // 増コマも移動対象(2026-07-09 追加): prepareStudentForMove は regular/makeup 以外は単純な位置移動のみで、
    // 既存の講習(special)と同じ経路を通るため特別な副作用は無い。
    const extra = run({ id: 'e4', lessonType: 'extra', subject: '理' }, { scheduleDndEnabled: true })
    expect(extra).toContain('is-draggable')
    expect(extra).toContain('data-lesson-type="extra"')
  })

  it('DnD無効・対象外種別(体験)・entryId欠落は掴めない(空文字)', () => {
    const run = extractDragAttrsFn(openDndHtml({ scheduleDndEnabled: true }))
    expect(run({ id: 'e1', lessonType: 'makeup', subject: '数' }, { scheduleDndEnabled: false })).toBe('')
    expect(run({ id: 'e1', lessonType: 'trial', subject: '数' }, { scheduleDndEnabled: true })).toBe('')
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

  it('机選択モーダルの席セル: 空席=クリックで配置・在席=クリックで入れ替え(占有席も data-role+相手entryId)・メモ=不可', () => {
    const run = extractSeatCellFn(openDndHtml({ scheduleDndEnabled: true }))
    // 空席: 配置クリック可+机同一性(deskId/講師/在席者)。
    const deskWithSeats = { deskIndex: 2, deskId: 'desk-2', teacher: '佐藤', seats: [{ occupantEntryId: 'e-nakano' }, {}] }
    const selectable = run(deskWithSeats, { studentIndex: 1, selectable: true, occupied: false })
    expect(selectable).toContain('<td class="dp-student dp-selectable"')
    expect(selectable).toContain('data-role="desk-picker-seat"')
    expect(selectable).toContain('data-desk-index="2"')
    expect(selectable).toContain('data-student-index="1"')
    expect(selectable).toContain('data-desk-id="desk-2"')
    expect(selectable).toContain('data-desk-teacher="佐藤"')
    // 机の在席者(deskOccupants)を持たせて、盤面側で「その机」を在席同一性で特定できるようにする。
    expect(selectable).toContain('data-desk-occupants="e-nakano"')
    // 在席: 入れ替えクリック可(盤面の入れ替えと同じ)。相手の entryId を持たせる。
    const occupied = run({ deskIndex: 0, deskId: 'desk-1', teacher: '田中' }, { studentIndex: 0, occupied: true, selectable: false, occupantEntryId: 'e-yamada', label: '山田 数' })
    expect(occupied).toContain('dp-swap')
    expect(occupied).toContain('data-role="desk-picker-seat"')
    expect(occupied).toContain('data-occupant-entry-id="e-yamada"')
    expect(occupied).toContain('山田 数')
    expect(occupied).toContain('入替')
    // メモ席のみクリック不可(data-role を持たない)。
    const memo = run({ deskIndex: 1, deskId: 'desk-x', teacher: '' }, { studentIndex: 0, blockedByMemo: true, selectable: false })
    expect(memo).toContain('dp-blocked')
    expect(memo).not.toContain('data-role="desk-picker-seat"')
  })

  it('掴めるカードのタップは出席不可トグルへ・出席不可トグルは同期スピナーを抑制する配線', () => {
    const html = openDndHtml({ scheduleDndEnabled: true })
    // 長押し未満のタップでカードでも出席不可トグルを実行(D&Dとの両立)。
    expect(html).toContain("if (tapCell && tapCell.getAttribute('data-editable') === 'true')")
    expect(html).toContain('handleUnavailablePointerDown(tapCell)')
    // 出席不可トグルは自分の操作なので同期スピナーを抑制(連続入力の妨げにしない)。
    expect(html).toContain('suppressSyncSpinnerUntil = Date.now() + 3000')
    expect(html).toContain('if (Date.now() < suppressSyncSpinnerUntil) return')
  })
})

describe('computeDeskPickerFitScale (机選択モーダルをビューポートに収める縮小率)', () => {
  it('コンテンツがビューポート内に収まる場合は拡大しない(=1)', () => {
    expect(computeDeskPickerFitScale(400, 800)).toBe(1)
    expect(computeDeskPickerFitScale(776, 800, 24)).toBe(1) // 境界: avail ちょうど
  })

  it('コンテンツがビューポートをはみ出す場合は縮小率(<1)を返す', () => {
    const scale = computeDeskPickerFitScale(1000, 800, 24)
    // avail = 800 - 24 = 776, scale = 776/1000
    expect(scale).toBeCloseTo(0.776, 5)
    expect(scale).toBeLessThan(1)
  })

  it('marginを差し引いた後の高さが0以下になる異常な入力では1を返す(スケール不能)', () => {
    expect(computeDeskPickerFitScale(500, 10, 24)).toBe(1) // avail<=0
    expect(computeDeskPickerFitScale(0, 800)).toBe(1) // contentHeight<=0
    expect(computeDeskPickerFitScale(Number.NaN, 800)).toBe(1)
  })

  // 回帰防止: ブラウザ拡大時は viewport の CSS px が縮み、高さだけでなく幅でもはみ出しうる。
  // 幅の引数を渡したら高さ・幅の両方を考慮し、より厳しい(小さい)縮小率を返すこと。
  it('幅がはみ出す場合は幅側の縮小率を返す(高さは収まっていても縮める)', () => {
    // 高さは収まる(availH=776 > 400)が、幅がはみ出す: availW = 500-24 = 476, 476/1000
    const scale = computeDeskPickerFitScale(400, 800, 24, 1000, 500)
    expect(scale).toBeCloseTo(0.476, 5)
    expect(scale).toBeLessThan(1)
  })

  it('高さ・幅の両方がはみ出す場合はより厳しい方の縮小率を返す', () => {
    // 高さ: availH=776, 776/1000=0.776 / 幅: availW=776, 776/2000=0.388 → 幅が厳しい
    const scale = computeDeskPickerFitScale(1000, 800, 24, 2000, 800)
    expect(scale).toBeCloseTo(0.388, 5)
  })

  it('高さ・幅の両方が収まる場合は1(拡大しない)', () => {
    expect(computeDeskPickerFitScale(400, 800, 24, 300, 900)).toBe(1)
  })

  it('幅の引数を省略すると従来どおり高さのみで判定する(後方互換)', () => {
    expect(computeDeskPickerFitScale(1000, 800, 24)).toBeCloseTo(0.776, 5)
  })
})

// 講師日程表を A4 に収めるためのレイアウト調整(2026-07-14)。
// Part1: 休みに別生徒が重なって溢れたコマは、溢れた休み生徒をセルから間引く。
// Part2: 振替授業欄を講師日程表から削除。
// Part3: 給与計算欄を横2列に振り分けて縦幅を節約(常に2列)。
describe('teacher schedule A4 layout adjustments', () => {
  function renderTeacherHtml(): string {
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
    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()
    return html
  }

  // Part1: 埋め込み純関数の挙動を new Function で固定する(修正なしでは3〜4人表示になる回帰を防ぐ)。
  it('Part1: hides only the overflowing absent students when replacements fill the 2-seat desk', () => {
    const html = renderTeacherHtml()
    const match = html.match(/function selectVisibleTeacherCellStatuses\(students, statuses\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const select = new Function('students', 'statuses', match![1]) as (
      students: Array<Record<string, unknown>>,
      statuses: Array<Record<string, unknown>>,
    ) => Array<Record<string, unknown>>
    const absent = (name: string) => ({ name, status: 'absent' })
    const noMakeup = (name: string) => ({ name, status: 'absent-no-makeup' })
    const attended = (name: string) => ({ name, status: 'attended' })
    const active = (name: string) => ({ name })
    const names = (list: Array<Record<string, unknown>>) => list.map((s) => s.name)

    // 実生徒2 + 休み1 = 3人 → 溢れた休みを隠して実生徒2人だけ表示
    expect(names(select([active('A'), active('C')], [absent('B')]))).toEqual([])
    // 実生徒2 + 休み2 = 4人 → 休みを全部隠す
    expect(names(select([active('A'), active('C')], [absent('B'), noMakeup('D')]))).toEqual([])
    // 実生徒1 + 休み1 = 2人(溢れない・別生徒は重なっていない) → 休みはそのまま残す
    expect(names(select([active('A')], [absent('B')]))).toEqual(['B'])
    // 実生徒なし + 休み2(重なっていない) → 何も隠さない
    expect(names(select([], [absent('B'), noMakeup('D')]))).toEqual(['B', 'D'])
    // 出席実績も席を占有: 出席1 + 実生徒1 + 休み1 = occupants2 → 休みを隠す(出席は残す)
    expect(names(select([active('A')], [attended('E'), absent('B')]))).toEqual(['E'])
    // 実生徒1 + 休み2 = 3人 → 溢れた休み1つだけ隠す(席が空く1つは残す)
    expect(names(select([active('A')], [absent('B'), noMakeup('D')]))).toEqual(['B'])
  })

  // Part1: セル描画がこの間引き関数を経由していること(配線の回帰防止)。
  it('Part1: teacher cell rendering routes statuses through selectVisibleTeacherCellStatuses', () => {
    const html = renderTeacherHtml()
    expect(html).toContain('selectVisibleTeacherCellStatuses(entry.students || [], entry.statuses || [])')
    // tooltip は間引かず全員を残す(情報はホバーで確認できる)。
    expect(html).toContain('[...slotStudents, ...slotStatuses]')
  })

  // Part2: 講師日程表の下段から振替授業欄を削除した。
  it('Part2: teacher bottom section drops the makeup (振替授業) box', () => {
    const html = renderTeacherHtml()
    const teacherBranch = html.match(/bottom-grid bottom-grid-teacher[\s\S]*?count-stack/)
    expect(teacherBranch).toBeTruthy()
    expect(teacherBranch![0]).not.toContain('makeup-table')
    expect(teacherBranch![0]).not.toContain('振替授業')
  })

  // Part3: 給与計算欄は横2列(.salary-columns)＋下段の交通費/事務給/合計(全幅)で構成する。
  it('Part3: salary section renders two side-by-side columns without vertical scroll', () => {
    const html = renderTeacherHtml()
    expect(html).toContain('class="salary-columns"')
    expect(html).toContain('salaryColumnTable(visible.slice(0, half))')
    expect(html).toContain('salaryColumnTable(visible.slice(half))')
    // 合計計算は .salary-section 全体を集計するので2テーブルでも不変。
    expect(html).toContain('salary-grand-total')
    // 旧スクロール枠(縦に伸びる原因)への依存は無くなった。
    expect(html).not.toContain('salary-table-head')
    expect(html).not.toContain('salary-table-body')
    // グリッドは振替欄(206px)を除いた2列に。
    expect(html).toContain('grid-template-columns: minmax(0, 1fr) 246px;')
  })

  // Part3: renderSalarySection を実体で呼び、2列に分割しても全入力と合計が単一の
  // .salary-section 内に収まること(recalcSalary の分割集計が壊れない前提)を実行時に固定する。
  it('Part3: renderSalarySection keeps every input and the grand total inside one salary-section across the 2 columns', () => {
    const html = renderTeacherHtml()
    const match = html.match(/function renderSalarySection\(salaryData\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const escapeHtml = (v: unknown) => String(v ?? '')
    const render = new Function('salaryData', 'escapeHtml', match![1]) as (
      salaryData: unknown,
      escape: (v: unknown) => string,
    ) => string
    // 可視3カテゴリ(A90/A60/A45)＋交通費/事務給/合計を含む講師で実レンダリング。
    const rendered = render(
      { teacherId: 't-1', attendanceDays: 3, counts: { A90: 1, A60: 2, A45: 1 } },
      escapeHtml,
    )
    const count = (s: string, sub: string) => s.split(sub).length - 1
    // section は1つだけ。合計セルも1つだけ(section 内)。
    expect(count(rendered, 'class="box-stack salary-section"')).toBe(1)
    expect(count(rendered, 'salary-grand-total')).toBe(1)
    // 2列(常に2テーブル)＋下段 foot。
    expect(count(rendered, 'class="salary-table salary-col-table"')).toBe(2)
    expect(count(rendered, 'class="salary-columns"')).toBe(1)
    expect(count(rendered, 'salary-table-foot')).toBe(1)
    // 各入力キーは一意(recalcSalary が二重計上しない前提)。可視3カテゴリ＋交通費＋事務給=5入力。
    const keys = [...rendered.matchAll(/data-salary-key="([^"]+)"/g)].map((m) => m[1])
    expect(keys).toEqual([...new Set(keys)])
    expect(keys.length).toBe(5)
    expect(keys).toContain('salary-unit-commute-t-1')
    expect(keys).toContain('salary-unit-office-t-1')
    // 合計セルは section の閉じ(</div>)より前 = section 内にある。
    const secStart = rendered.indexOf('salary-section')
    const grandPos = rendered.indexOf('salary-grand-total')
    expect(secStart).toBeGreaterThanOrEqual(0)
    expect(grandPos).toBeGreaterThan(secStart)
  })

  // 給与の小計手入力(オーナー指示 2026-09-13): 手入力した小計が正、空欄なら単価×コマ数(日数)を表示。
  it('salary subtotal: resolveSalaryRowSubtotal は手入力を優先し、空なら自動計算する', () => {
    const html = renderTeacherHtml()
    const match = html.match(/function resolveSalaryRowSubtotal\(countText, unitValue, isFixed, manualValue\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const resolve = new Function('countText', 'unitValue', 'isFixed', 'manualValue', match![1]) as (
      countText: string, unitValue: string, isFixed: boolean, manualValue: string,
    ) => { value: number; manual: boolean }
    expect(resolve('3日', '1000', false, '')).toEqual({ value: 3000, manual: false })
    expect(resolve('3日', '1000', false, '2500')).toEqual({ value: 2500, manual: true })
    expect(resolve('3日', '1000', false, '12,000円')).toEqual({ value: 12000, manual: true })
    expect(resolve('3日', '1000', false, '0')).toEqual({ value: 0, manual: true })
    expect(resolve('3日', '1000', false, '  ')).toEqual({ value: 3000, manual: false })
    expect(resolve('-', '5000', true, '')).toEqual({ value: 5000, manual: false })
    expect(resolve('2', '', false, '')).toEqual({ value: 0, manual: false })
  })

  it('salary subtotal: 実DOMで 単価入力→小計に計算表示、小計手入力→合計はそちら、空にすると自動に戻る', async () => {
    // jsdom は型定義を入れていないので、モジュール名を変数にして any として読み込む(型検査を通すため)。
    const jsdomModuleName = 'jsdom'
    const { JSDOM } = await import(/* @vite-ignore */ jsdomModuleName)
    const html = renderTeacherHtml()
    const pick = (name: string, params: string) => {
      const start = html.indexOf('function ' + name + '(' + params + ') {')
      const end = start < 0 ? -1 : html.indexOf('\n      }', start)
      const m = start < 0 || end < 0 ? null : [html.slice(start, end + 8), html.slice(html.indexOf('{', start) + 1, end)]
      expect(m).toBeTruthy()
      return m![1]
    }
    const dom = new JSDOM('<!doctype html><body></body>')
    const doc = dom.window.document
    const renderBody = pick('renderSalarySection', 'salaryData')
    const render = new Function('salaryData', 'escapeHtml', renderBody) as (d: unknown, e: (v: unknown) => string) => string
    doc.body.innerHTML = render({ teacherId: 't-1', attendanceDays: 3, counts: { A90: 2 } }, (v) => String(v ?? ''))
    const factory = new Function('document', 'getSharedStorage', 'STORAGE_SCOPE', 'BASE_VIEW_TYPE',
      'function resolveSalaryRowSubtotal(countText, unitValue, isFixed, manualValue) {' + pick('resolveSalaryRowSubtotal', 'countText, unitValue, isFixed, manualValue') + '}\n' +
      'function recalcSalary(changedElement) {' + pick('recalcSalary', 'changedElement') + '}\n' +
      'function bindSalaryInputs() {' + pick('bindSalaryInputs', '') + '}\n' +
      'return bindSalaryInputs;')
    const bind = factory(doc, () => null, 'scope', 'teacher') as () => void
    bind()
    const q = (sel: string) => doc.querySelector(sel) as HTMLInputElement
    const fire = (el: HTMLInputElement, value: string) => {
      el.value = value
      el.dispatchEvent(new dom.window.Event('input'))
    }
    const total = () => doc.querySelector('.salary-grand-total')!.textContent
    const subA90 = q('[data-salary-sub-input="A90"]')
    const subCommute = q('[data-salary-sub-input="commute"]')
    // 単価未入力は小計・合計とも空
    expect(subA90.value).toBe('')
    // 空欄の小計には 単価×コマ数 を表示
    fire(q('[data-salary-unit="A90"]'), '2000')
    fire(q('[data-salary-unit="commute"]'), '500')
    expect(subA90.value).toBe((4000).toLocaleString())
    expect(subCommute.value).toBe((1500).toLocaleString())
    expect(total()).toBe((5500).toLocaleString() + ' 円')
    // 小計の手入力が正。単価を変えても手入力は上書きされない
    fire(subCommute, '1000')
    expect(subCommute.classList.contains('is-manual')).toBe(true)
    expect(total()).toBe((5000).toLocaleString() + ' 円')
    fire(q('[data-salary-unit="commute"]'), '900')
    expect(subCommute.value).toBe('1000')
    expect(total()).toBe((5000).toLocaleString() + ' 円')
    // 空にすると自動計算へ戻る(900×3日)
    fire(subCommute, '')
    expect(subCommute.classList.contains('is-manual')).toBe(false)
    expect(subCommute.value).toBe((2700).toLocaleString())
    expect(total()).toBe((6700).toLocaleString() + ' 円')
    // 小計は端末に記憶しない(data-salary-key を持たない)
    expect(doc.querySelectorAll('.salary-subtotal-input[data-salary-key]').length).toBe(0)
  })

  // 密度向上(A3飛び出し対策): 講師セルの状態ラベルは1文字'出'、科目/種別/状態は空白なしで詰める。
  it('density: compact attended label is 出 and teacher meta joins without spaces', () => {
    const html = renderTeacherHtml()
    const match = html.match(/function getCompactStatusLabel\(status\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const getCompactStatusLabel = new Function('status', match![1]) as (s: string) => string
    expect(getCompactStatusLabel('attended')).toBe('出') // セルは1文字(tooltip の verbose は '出席' のまま)
    expect(getCompactStatusLabel('absent')).toBe('休')
    expect(getCompactStatusLabel('absent-no-makeup')).toBe('振無休')
    expect(getCompactStatusLabel('')).toBe('')
    // verbose(tooltip)側は '出席' を維持している。
    const vmatch = html.match(/function getVerboseStatusLabel\(status\)\s*\{([\s\S]*?)\n {6}\}/)
    const getVerbose = new Function('status', vmatch![1]) as (s: string) => string
    expect(getVerbose('attended')).toBe('出席')
    // メタは科目/種別/状態の間に空白を入れずに詰める(縦書きの高さ節約)。
    expect(html).toContain("if (statusLabel) return [lessonLabel, statusLabel].filter(Boolean).join('');")
    expect(html).toContain("formatTeacherLessonLabel(student)].filter(Boolean).join('')")
  })

  // 密度向上: 生徒1人(is-single)の名前サイズを2人(is-pair)と統一(1人だけ大きくしない)。
  it('density: single-student cells share the pair font size (screen and print)', () => {
    const html = renderTeacherHtml()
    // 画面・印刷の各段(基準/compact/dense/ultra-dense)で is-single が is-pair と同じ規則に同居している。
    expect(html).toContain('.lesson-card-teacher.is-single .teacher-lesson-name,')
    expect(html).toContain('.lesson-card-teacher.is-single .teacher-lesson-meta,')
    expect(html).toContain('.schedule-table.is-compact .lesson-card-teacher.is-single .teacher-lesson-name,')
    expect(html).toContain('.schedule-table.is-dense .lesson-card-teacher.is-single .teacher-lesson-name,')
    expect(html).toContain('.schedule-table.is-ultra-dense .lesson-card-teacher.is-single .teacher-lesson-name,')
    // 名前まわりの上下余白と名前↔メタの空きを詰めた(person の gap/padding を 0 に)。
    expect(html).toContain('gap: 0;\n        padding: 0;')
  })
})

// 「後から出席可能に変更」(黄色コマ・2026-07-18 塚田先生要望)。
// payload に reopenedSlots が載らないと日程表側で黄色が剥がれてグレーに戻って見える(欠落=回帰)。
describe('reopenedSlots (後から出席可能に変更) の日程表配線', () => {
  function openStudentHtmlWithReopened(): string {
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
      setTimeout: (callback: () => void) => { callback(); return 0 },
    })

    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-07-25',
      defaultEndDate: '2026-07-25',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-07-21',
        endDate: '2026-08-28',
        teacherInputs: {
          'teacher-1': {
            unavailableSlots: ['2026-07-25_3', '2026-07-26_2'],
            reopenedSlots: ['2026-07-25_3'],
            countSubmitted: true,
            updatedAt: '2026-07-18T00:00:00.000Z',
          },
        },
        studentInputs: {
          'student-1': {
            unavailableSlots: ['2026-07-25_3', '2026-07-26_2'],
            reopenedSlots: ['2026-07-25_3'],
            regularBreakSlots: [],
            subjectSlots: { 数: 2 },
            regularOnly: false,
            countSubmitted: true,
            updatedAt: '2026-07-18T00:00:00.000Z',
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      }],
      targetWindow: popup,
    })

    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()
    return html
  }

  it('payload の studentInputs / teacherInputs に reopenedSlots を必ず載せる', () => {
    const html = openStudentHtmlWithReopened()
    const payloadMatch = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(payloadMatch).toBeTruthy()
    const payload = JSON.parse(payloadMatch![1])
    expect(payload.specialSessions[0]?.studentInputs?.['student-1']?.reopenedSlots).toEqual(['2026-07-25_3'])
    expect(payload.specialSessions[0]?.teacherInputs?.['teacher-1']?.reopenedSlots).toEqual(['2026-07-25_3'])
  })

  it('セル描画は黄色(is-reopened)をグレー(is-unavailable)より優先し、CSSは画面/印刷の両方で定義される', () => {
    const html = openStudentHtmlWithReopened()
    // 生徒/講師シートのセルクラス分岐(黄色優先)
    expect(html).toContain("classes.push(reopenedSlots.has(slotKey) ? 'is-reopened' : 'is-unavailable')")
    // 画面と @media print の両方に黄色(色は暫定 #f9e79f・オーナー確認済)がある
    expect((html.match(/\.slot-cell\.is-reopened/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((html.match(/#f9e79f/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('D&Dの着地確認(実効不可)と承認フラグ(reopenApproved)が配線されている', () => {
    const html = openStudentHtmlWithReopened()
    expect(html).toContain('function getEffectiveUnavailableSlotsForStudent(studentId)')
    expect(html).toContain('collectScheduleMoveReopenChecks(source, targetDateKey, targetSlotNumber, reopenOccupantEntryId)')
    expect(html).toContain('reopenApproved: reopenApproved')
  })

  it('講師日程表: 提出済み講師の不可コマにクリック→黄色化の導線(reopen-teacher-slot)がある', () => {
    const html = openStudentHtmlWithReopened()
    expect(html).toContain('data-role="reopen-teacher-slot"')
    expect(html).toContain("type: 'schedule-teacher-reopen-save'")
    expect(html).toContain('function getReopenableSessionsForTeacher(teacherId, slotKey)')
  })

  // staging実機で発覚した回帰(2026-07-18): 別タブ内のローカル明示再構築(生徒/講師の不可保存・登録/登録解除)が
  // reopenedSlots を落とすと、その瞬間に黄色が剥がれてグレーへ戻る(講師の登録解除で顕在化)。
  // 4関数すべてが currentInput.reopenedSlots を保全していることを固定する(v1.5.318型の保全漏れの兄弟)。
  it('タブ内ローカル再構築4関数(不可保存/登録×生徒/講師)が reopenedSlots を保全する', () => {
    const html = openStudentHtmlWithReopened()
    const preservationCount = (html.match(/reopenedSlots: sortSlotKeys\(currentInput\.reopenedSlots \|\| \[\]\)/g) || []).length
    expect(preservationCount).toBeGreaterThanOrEqual(4)
    // 再構築関数そのものが存在すること(関数名の改名でこのテストが空振りしないための存在確認)
    expect(html).toContain('function updateUnavailableSlotsLocally(sessionId, personId, unavailableSlots)')
    expect(html).toContain('function updateStudentCountLocally(sessionId, personId, subjectSlots, regularOnly, countSubmitted')
    expect(html).toContain('function updateTeacherUnavailableSlotsLocally(sessionId, personId, unavailableSlots)')
    expect(html).toContain('function updateTeacherCountLocally(sessionId, personId, countSubmitted)')
  })
})

// 「開発者へ報告」(2026-09-04・docs/spec-developer-report.md §B/§E): 日程表は表示だけ見て「おかしい」と思うことがあるので、
// 別タブのツールバー(講習期間表示の右)にもボタンを出し、本体(opener)へ postMessage で報告を依頼する。
describe('scheduleHtml 開発者へ報告ボタン', () => {
  // 【2026-09-16】検証用教室の判定は登録台帳の (workspaceKey, 教室ID)。教室名では判定しない
  // (他社が「開発用教室」という名前の教室を作っても AI 即答の表示が出ないようにするため)。
  // 別タブへ渡す classroomStorageKey は App.tsx の actingClassroomId ＝ 開いている教室のドキュメントID。
  it('質問への AI 即時回答フラグは登録済み開発用教室の【教室ID】だけ true(教室名では true にならない)', () => {
    vi.stubEnv('VITE_FIREBASE_WORKSPACE_KEY', 'main')
    const renderFor = (classroomName: string, classroomStorageKey?: string) => {
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
        defaultStartDate: '2026-09-01',
        defaultEndDate: '2026-09-07',
        titleLabel: 'テスト',
        classroomName,
        classroomStorageKey,
        classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
        targetWindow: popup,
      })
      return write.mock.calls[0]?.[0] as string
    }
    expect(renderFor('開発用教室', 'v8OZ7zH8vONNHjjYVcR1')).toContain('"questionAiAnswerEnabled":true')
    // ★回帰防止: 教室名が「開発用教室」でも、教室IDが台帳に無ければ false。
    expect(renderFor('開発用教室')).toContain('"questionAiAnswerEnabled":false')
    expect(renderFor('開発用教室', 'classroom-9')).toContain('"questionAiAnswerEnabled":false')
    expect(renderFor('スクールIE 日大前校', '5w5OMueETerSKrSf14HC')).toContain('"questionAiAnswerEnabled":false')
    expect(renderFor('スクールIE 緑が丘校', 'KzFnOQoTFLsCxwUp1tvh')).toContain('"questionAiAnswerEnabled":false')
    vi.unstubAllEnvs()
  })

  it('生徒日程表のツールバーにボタンがあり、送信・結果の両メッセージ種別が埋め込みスクリプトに含まれる', () => {
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
      defaultStartDate: '2026-09-01',
      defaultEndDate: '2026-09-07',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    // 位置: 「登録された講習期間を表示する」の直後(右)に配置する。
    const periodIndex = html.indexOf('id="schedule-period-select"')
    const buttonIndex = html.indexOf('id="schedule-report-developer-button"')
    const showAllIndex = html.indexOf('id="schedule-show-all-button"')
    expect(periodIndex).toBeGreaterThan(0)
    expect(buttonIndex).toBeGreaterThan(periodIndex)
    expect(buttonIndex).toBeLessThan(showAllIndex)
    expect(html).toContain('class="secondary report-developer"')
    // ボタン名は「質問・要望」(オーナー確定 2026-09-04「要望・報告」→ 2026-09-14 改名・旧「開発者へ報告」)。
    expect(html).toContain('>質問・要望</button>')
    expect(html).not.toContain('>要望・報告</button>')
    expect(html).not.toContain('>開発者へ報告</button>')
    // 種類(不具合/要望)のラジオと #テスト の案内を盤面と同じ文言で埋め込む。
    // 使い方の質問(question)も盤面と同じ 3 択で埋め込む(2026-09-13)。
    // 並びは 質問 → 要望 → 不具合、既定は質問(オーナー指示 2026-09-14)。
    expect(html).toContain('"categoryOptions":[{"value":"question","label":"使い方の質問"},{"value":"request","label":"追加してほしい・要望"},{"value":"bug","label":"不具合・おかしい"}]')
    expect(html).toContain('"defaultCategory":"question"')
    expect(html).toContain('let selectedCategory = DEVELOPER_REPORT_TEXT.defaultCategory;')
    expect(html).toContain("name = 'schedule-developer-report-category'")
    // 質問を選んだときだけ「すぐには返らない」注意文(盤面と同じ文言・spec §G-2)。既定(bug)では隠れている。
    expect(html).toContain('"questionNotice":"回答は開発者が確認してからお返しします（すぐには返りません・自動返信はしません）。"')
    expect(html).toContain("questionNotice.hidden = selectedCategory !== 'question';")
    expect(html).toContain('modal.appendChild(questionNotice);')
    expect(html).toContain('.developer-report-hint.developer-report-question-notice {')
    expect(html).toContain('category: selectedCategory,')
    // 「#テスト と書いてください」の案内文は削除(オーナー指示 2026-09-14)。
    expect(html).not.toContain('testHint')
    expect(html).not.toContain('テスト送信のときは内容に')
    // AI 即時回答(開発用教室のみ・spec §G-7): 既定(教室名なし)では無効。有効時だけ注意文・待ち時間を切り替える。
    expect(html).toContain('"questionAiAnswerEnabled":false')
    expect(html).toContain('const aiAnswerEnabled = Boolean(DATA.questionAiAnswerEnabled);')
    expect(html).toContain("const waitingForAi = aiAnswerEnabled && selectedCategory === 'question';")
    // 入力のヒント(生徒名・日付・コマ・何が起きたか)を盤面と同じ文言で出す(オーナー指示 2026-09-04)。
    expect(html).toContain('"inputHint":"生徒名・日付・コマ(何限)・どの操作をしたら何が起きたか')
    expect(html).toContain("inputHint.className = 'developer-report-hint developer-report-hint-primary'")
    // 色だけ変える(同じ枠線ボタン)。
    expect(html).toContain('.toolbar button.report-developer {')
    // 本体へ送るメッセージと、本体から返る結果メッセージの両方を扱う(App.tsx の定数と一致)。
    expect(html).toContain("type: 'schedule-developer-report'")
    expect(html).toContain("message.type === 'schedule-developer-report-result'")
    // 盤面と同一のモーダル(prompt ではない)。文言は DEVELOPER_REPORT_UI_TEXT を埋め込む。一言は必須。
    expect(html).not.toContain('window.prompt(')
    expect(html).toContain('const DEVELOPER_REPORT_TEXT = {')
    expect(html).toContain('"requiredError":"内容を入力してください。')
    expect(html).toContain('"placeholder":"例: 9/3(水) 3限、田中先生の机で')
    expect(html).not.toContain('空欄のままでも送れます')
    expect(html).toContain('.developer-report-modal {')
    expect(html).toContain("id = 'schedule-developer-report-modal'")
    expect(html).toContain('if (!note) {')
    // opener 不在なら No.210 の可視化(isOpenerAvailable)に乗せる。
    expect(html).toContain('if (!isOpenerAvailable()) return;\n          const personOption')
    // 表示条件を context として添える。
    for (const key of ['viewType: VIEW_TYPE', 'startDate:', 'endDate:', 'periodLabel:', 'personId:', 'personLabel:', 'search:']) {
      expect(html).toContain(key)
    }

    vi.unstubAllGlobals()
  })
})

// 講習履歴(H-4・docs/plan-2026-09-11-five-requests.md §6): 生徒日程表のツールバーに「講習履歴」ボタンを出し、
// opener(本体)へ期間を送って callable の結果をタブ内オーバーレイに表示する。
// フラグ(lessonHistoryEnabled)が OFF の教室ではボタンを出さない。埋め込みJSの関数群は常に載せる
// （new Function 構文検証の対象に保つため。ボタンが無ければ addEventListener が空振りするだけ）。
describe('scheduleHtml 講習履歴', () => {
  const stubPopup = () => {
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
    return { write, popup }
  }

  const baseParams = (popup: Window) => ({
    cells: [],
    students: [createStudent({ displayName: '山田' })],
    regularLessons: [],
    defaultStartDate: '2026-09-01',
    defaultEndDate: '2026-09-07',
    titleLabel: 'テスト',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
    targetWindow: popup,
  })

  it('フラグ ON の生徒日程表にだけボタンが出て、「講習集計結果」の左に置かれる', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    const historyIndex = html.indexOf('id="schedule-lesson-history-button"')
    const summaryIndex = html.indexOf('id="schedule-lecture-summary-button"')
    expect(historyIndex).toBeGreaterThan(0)
    expect(summaryIndex).toBeGreaterThan(0)
    // 「講習集計結果」の左(＝前)に出す(オーナー要望の並び)。
    expect(historyIndex).toBeLessThan(summaryIndex)
    expect(html).toContain('>通常授業履歴</button>')

    // 講師日程表は台帳が生徒×科目なので対象外(ボタンを出さない)。
    write.mockClear()
    openTeacherScheduleHtml({
      cells: [],
      teachers: [],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-09-01',
      defaultEndDate: '2026-09-07',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
      lessonHistoryEnabled: true,
    })
    const teacherHtml = write.mock.calls[0]?.[0] as string
    expect(teacherHtml).not.toContain('id="schedule-lesson-history-button"')

    vi.unstubAllGlobals()
  })

  it('フラグ OFF ならボタンを出さないが、埋め込みJSの関数群は載る(構文検証の対象を落とさない)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml(baseParams(popup))
    const html = write.mock.calls[0]?.[0] as string
    expect(html).not.toContain('id="schedule-lesson-history-button"')
    expect(html).not.toContain('>通常授業履歴</button>')
    expect(html).toContain('function openLessonHistoryOverlay()')
    expect(html).toContain('function clampLessonHistoryRange(fromValue, toValue)')

    vi.unstubAllGlobals()
  })

  it('往復のメッセージ種別・要求フィールド・オーバーレイの要素が埋め込まれる', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    // 本体(ScheduleBoardScreen.tsx)/lessonHistoryMessage.ts の定数と一致させる。
    expect(html).toContain("type: 'schedule-lesson-history-request'")
    expect(html).toContain("message.type === 'schedule-lesson-history-result'")
    // 要求に載せるフィールド(本体の parseScheduleLessonHistoryRequestMessage が読む)。
    for (const field of ['requestId: lessonHistoryRequestId,', 'personId: personSelect', 'from: range.from,', 'to: range.to']) {
      expect(html).toContain(field)
    }
    // 古い応答で新しい表示を上書きしない requestId 照合(回帰防止)。
    expect(html).toContain('if (!message || (message.requestId && message.requestId !== lessonHistoryRequestId)) return;')
    // オーバーレイ: 期間(date 入力2つ)・種別フィルタ・表・印刷・閉じる。
    expect(html).toContain("overlay.id = 'schedule-lesson-history-modal'")
    expect(html).toContain("className = 'lesson-history-start'")
    expect(html).toContain("className = 'lesson-history-end'")
    // 「振替元」列は廃止して状態欄へまとめた(確認リスト その他 2026-09-14)。状態欄はサーバーの statusText を出す。
    expect(html).toContain('<th>日付</th><th>曜日</th><th>時限</th><th>種別</th><th>科目</th><th>状態</th></tr>')
    expect(html).not.toContain('<th>振替元</th>')
    expect(html).toContain("const statusText = event.statusText || event.statusLabel")
    expect(html).toContain("printButton.textContent = '印刷'")
    expect(html).toContain("closeButton.textContent = '閉じる'")
    // 全授業種別を種別フィルタに並べる(台帳に種別が無い未消化行は「種別なし」)。
    for (const label of ['通常', '振替', '講習', '増コマ', '体験', '種別なし']) {
      expect(html).toContain("label: '" + label + "'")
    }
    // 「保存済みの記録のみ」の明示は必須(当日の未保存編集が入らないことの説明)。savedAt も併記する。
    expect(html).toContain('保存済みの記録のみを表示しています(当日の未保存編集は含まれません)。集計日: ')
    expect(html).toContain("' / 保存: ' + savedLabel")

    vi.unstubAllGlobals()
  })

  it('期間の丸め(最大366日・逆転は入れ替え)が埋め込みJSでもサーバーと同じ規則で効く', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string

    const extractBody = (signature: string) => {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = html.match(new RegExp('function ' + escaped + ' \\{([\\s\\S]*?)\\n {6}\\}'))
      expect(match).toBeTruthy()
      return match![1]
    }

    // 埋め込みJSの実体をそのまま評価する(テンプレートリテラルのエスケープ崩れも同時に検知する)。
    const script = [
      'const LESSON_HISTORY_MAX_DAYS = 366;',
      'function toDateKey(date) {' + extractBody('toDateKey(date)') + '}',
      'function shiftLessonHistoryDateKey(dateKey, days) {' + extractBody('shiftLessonHistoryDateKey(dateKey, days)') + '}',
      'function countLessonHistoryDays(fromKey, toKey) {' + extractBody('countLessonHistoryDays(fromKey, toKey)') + '}',
      'function clampLessonHistoryRange(fromValue, toValue) {' + extractBody('clampLessonHistoryRange(fromValue, toValue)') + '}',
      'return { clampLessonHistoryRange, countLessonHistoryDays };',
    ].join('\n')
    const api = new Function(script)() as {
      clampLessonHistoryRange: (from: string, to: string) => { from: string; to: string; clamped: boolean }
      countLessonHistoryDays: (from: string, to: string) => number
    }

    // 両端を含む本数。366 日ちょうどは丸めない。
    expect(api.countLessonHistoryDays('2026-09-12', '2026-09-12')).toBe(1)
    expect(api.clampLessonHistoryRange('2025-09-12', '2026-09-12')).toEqual({ from: '2025-09-12', to: '2026-09-12', clamped: false })
    // 366 日を超えたら終了日から直近 366 日へ丸める(エラーにしない)。
    const clamped = api.clampLessonHistoryRange('2024-01-01', '2026-09-12')
    expect(clamped.clamped).toBe(true)
    expect(clamped.to).toBe('2026-09-12')
    expect(api.countLessonHistoryDays(clamped.from, clamped.to)).toBe(366)
    // 逆転入力は入れ替える。
    expect(api.clampLessonHistoryRange('2026-09-12', '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-12', clamped: false })

    vi.unstubAllGlobals()
  })

  it('開始日 > 終了日 は入れ替えずに理由を表示し、入力欄を書き換えない(確認リスト h-2・2026-09-12)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string

    const match = html.match(/function resolveLessonHistoryRangeInputError\(fromValue, toValue\) \{([\s\S]*?)\n {6}\}/)
    expect(match).toBeTruthy()
    const resolveError = new Function('fromValue', 'toValue', match![1]) as (from: string, to: string) => string
    expect(resolveError('2026-10-01', '2026-09-12')).toContain('開始日(2026-10-01)が終了日(2026-09-12)より後')
    expect(resolveError('2026-09-01', '2026-09-12')).toBe('')
    expect(resolveError('', '2026-09-12')).toBe('')
    expect(resolveError('2026-09-12', '')).toBe('')

    // 「表示」で要求する前にこの判定を通し、エラーなら送らない。
    const requestBody = html.match(/function requestLessonHistory\(fromValue, toValue\) \{([\s\S]*?)\n {6}\}/)?.[1] ?? ''
    expect(requestBody).toContain('const inputError = resolveLessonHistoryRangeInputError(fromValue, toValue);')
    expect(requestBody.indexOf('inputError')).toBeLessThan(requestBody.indexOf("type: 'schedule-lesson-history-request'"))
    // ⚠️ 入力欄への書き戻し(startField.value = range.from 等)を復活させると赤くなる(回帰防止)。
    expect(requestBody).not.toContain('startField.value = range.from')
    expect(requestBody).not.toContain('endField.value = range.to')
    // 実際に表示している期間は注記に出す(入力欄は書き換えないので、ここが正本)。
    expect(html).toContain("' / 表示期間: ' + rangeLabel")

    vi.unstubAllGlobals()
  })

  it('既定の期間は今月の1日〜末日で、期間を変えたら「表示」を押さなくても読み直す(確認リスト その他 2026-09-14)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string

    const extractBody = (signature: string) => {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = html.match(new RegExp('function ' + escaped + ' \\{([\\s\\S]*?)\\n {6}\\}'))
      expect(match).toBeTruthy()
      return match![1]
    }
    const api = new Function([
      'function toDateKey(date) {' + extractBody('toDateKey(date)') + '}',
      'function buildLessonHistoryDefaultRange(now) {' + extractBody('buildLessonHistoryDefaultRange(now)') + '}',
      'return buildLessonHistoryDefaultRange;',
    ].join('\n'))() as (now: Date) => { from: string; to: string; clamped: boolean }
    expect(api(new Date(2026, 8, 14, 10, 0))).toEqual({ from: '2026-09-01', to: '2026-09-30', clamped: false })
    expect(api(new Date(2028, 1, 3))).toEqual({ from: '2028-02-01', to: '2028-02-29', clamped: false })
    expect(api(new Date(2026, 11, 31, 23, 59))).toEqual({ from: '2026-12-01', to: '2026-12-31', clamped: false })
    // 旧既定(今日から1年分)に戻していないこと。
    expect(extractBody('buildLessonHistoryDefaultRange(now)')).not.toContain('LESSON_HISTORY_MAX_DAYS')

    // 開いたときの期間はこの関数から取り、日付を変えたら読み直す。
    expect(html).toContain('const defaultRange = buildLessonHistoryDefaultRange(new Date());')
    expect(html).toContain("startField.addEventListener('change', scheduleLessonHistoryRangeReload);")
    expect(html).toContain("endField.addEventListener('change', scheduleLessonHistoryRangeReload);")
    expect(html).toContain('requestLessonHistory(startField.value, endField.value);')
    // 「表示」ボタンは期間欄の横でも押せる見た目にする(以前は操作欄のスタイルが当たらず素のボタンだった)。
    expect(html).toContain('.lesson-history-controls .lesson-history-primary {')

    vi.unstubAllGlobals()
  })

  it('ボタン名・見出し・印刷タイトルは「通常授業履歴」(確認リスト h-1・2026-09-12)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('>通常授業履歴</button>')
    expect(html).toContain("title.textContent = '通常授業履歴'")
    expect(html).toContain('<title>通常授業履歴</title>')
    expect(html).not.toContain('>講習履歴</button>')

    vi.unstubAllGlobals()
  })

  it('種別フィルタの選択肢(value)は scheduleLessonTypeLabels の全キーを含む(未知種別なしの一元化)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    const match = html.match(/const LESSON_HISTORY_TYPE_OPTIONS = (\[[\s\S]*?\]);/)
    expect(match).toBeTruthy()
    const optionValues = new Set(Array.from(match![1].matchAll(/value: '([^']*)'/g)).map((entry) => entry[1]))
    for (const type of Object.keys(scheduleLessonTypeLabels)) {
      expect(optionValues.has(type)).toBe(true)
    }

    vi.unstubAllGlobals()
  })

  it('未知の授業種別イベントはチェックボックス絞り込みに関わらず常に表示する(無言で消えない)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('if (LESSON_HISTORY_KNOWN_TYPES.indexOf(type) < 0) return true;')

    vi.unstubAllGlobals()
  })

  it('要求メッセージに開いている教室(classroomId)を載せ、応答の教室が食い違えば破棄する', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true, classroomStorageKey: 'classroom-1' })
    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain("classroomId: String(DATA.classroomStorageKey || '')")
    // 教室分離(INV-08): 応答の classroomId が現在の教室と違えば「開き直して」と表示し、履歴を捨てる。
    expect(html).toContain("if (history && String(history.classroomId || '') !== String(DATA.classroomStorageKey || '')) {")
    expect(html).toContain('教室が切り替わっています。日程表を開き直してください。')

    vi.unstubAllGlobals()
  })

  it('印刷は生成タブの close 後に focus/print を呼ぶ(自動で印刷ダイアログを開く)', () => {
    const { write, popup } = stubPopup()
    openStudentScheduleHtml({ ...baseParams(popup), lessonHistoryEnabled: true })
    const html = write.mock.calls[0]?.[0] as string
    expect(html).toContain('printWindow.document.close();\n        try {\n          printWindow.focus();\n          printWindow.print();')

    vi.unstubAllGlobals()
  })
})

// 確認リスト v1.5.527 b-2(2026-09-15): 生徒の退塾日は「その日から非在籍」。
// 回数表の予定数(buildExpectedRegularOccurrences)と、別タブ日程表の埋め込み JS の生徒一覧を退塾日当日から外す。
describe('生徒の退塾日は当日から非在籍: 日程表(回数表の予定数・埋め込みJSの生徒一覧)', () => {
  it('予定数の通常授業は退塾日の前日まで数え、当日以降は数えない', () => {
    // 2026-03 の火曜: 3/3, 3/10, 3/17, 3/24, 3/31。3/17 退塾 → 3/3, 3/10 だけ。
    const dates = (withdrawDate: string) => buildExpectedRegularOccurrences({
      students: [createStudent({ withdrawDate })],
      regularLessons: [createRegularLesson()],
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    }).filter((entry) => entry.dateKey >= '2026-03-01' && entry.dateKey <= '2026-03-31').map((entry) => entry.dateKey)
    expect(dates('2026-03-17')).toEqual(['2026-03-03', '2026-03-10'])
    expect(dates('2026-03-18')).toEqual(['2026-03-03', '2026-03-10', '2026-03-17'])
  })

  it('埋め込み JS: 生徒は isStudentVisibleInRange(当日から非表示)、講師は isVisibleInRange(当日表示)を使う', () => {
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
    try {
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
    } finally {
      vi.unstubAllGlobals()
    }
    const html = write.mock.calls[0]?.[0] as string

    expect(html).toContain('return DATA.students.filter((student) => isStudentVisibleInRange(student, startDate, endDate)).sort(compareStudentOrder);')
    expect(html).toContain('return DATA.teachers.filter((teacher) => isVisibleInRange(teacher, startDate, endDate))')

    const studentMatch = html.match(/function isStudentVisibleInRange\(item, startDate, endDate\)\s*\{([\s\S]*?)\n {6}\}/)
    const teacherMatch = html.match(/function isVisibleInRange\(item, startDate, endDate\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(studentMatch).toBeTruthy()
    expect(teacherMatch).toBeTruthy()
    const todayMatch = html.match(/function getScheduleTodayJstKey\(\)\s*\{([\s\S]*?)\n {6}\}/)
    expect(todayMatch).toBeTruthy()
    type Visible = (item: { entryDate: string; withdrawDate: string }, startDate: string, endDate: string) => boolean
    const getToday = new Function(todayMatch![1]) as () => string
    const studentVisibleRaw = new Function('getScheduleTodayJstKey', 'item', 'startDate', 'endDate', studentMatch![1])
    const teacherVisibleRaw = new Function('getScheduleTodayJstKey', 'item', 'startDate', 'endDate', teacherMatch![1])
    const studentVisible: Visible = (item, startDate, endDate) => studentVisibleRaw(getToday, item, startDate, endDate)
    const teacherVisible: Visible = (item, startDate, endDate) => teacherVisibleRaw(getToday, item, startDate, endDate)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
      const range = ['2026-09-01', '2026-09-30'] as const
      expect(studentVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-16' }, ...range)).toBe(true)
      expect(studentVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-15' }, ...range)).toBe(false)
      expect(studentVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-14' }, ...range)).toBe(false)
      expect(studentVisible({ entryDate: '2024-04-01', withdrawDate: '未定' }, ...range)).toBe(true)
      // 講師は退職日当日も表示(今回変えない)
      expect(teacherVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-15' }, ...range)).toBe(true)
      expect(teacherVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-14' }, ...range)).toBe(false)

      // 「今日」は JST。UTC 2026-09-14 15:30 = JST 9/15 0:30 → 9/15 退塾の生徒はもう出ない(旧 UTC 実装では 9/14 扱いで出ていた)。
      vi.setSystemTime(new Date('2026-09-14T15:30:00Z'))
      expect(getToday()).toBe('2026-09-15')
      expect(studentVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-15' }, ...range)).toBe(false)
      // 講師も同じ JST の今日(9/14 退職の講師は JST 9/15 0:30 には出ない)。
      expect(teacherVisible({ entryDate: '2024-04-01', withdrawDate: '2026-09-14' }, ...range)).toBe(false)
      // JST 8:59(UTC 23:59 前日)も JST の日付のまま。
      vi.setSystemTime(new Date('2026-09-15T23:59:00Z'))
      expect(getToday()).toBe('2026-09-16')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// 振替元「休)」表示 / 振替欄の元起点統一（オーナー確定 2026-09-16・機能フラグ transferSourceRestDisplay）
//
// - payload: moved(移動元マーカー)はフラグ ON の教室だけ載せる。holiday(休日記録)は常に載せる。
// - 生徒日程表のセル: moved/holiday は absent と同じ「休 M月D日」カード（掴めない）。
// - 振替欄: 元コマ起点に統一し、振替先が未配置なら「未定」。元起点と先起点は元コマで重複排除する。
// - ★回数表・講師日程表・給与・交通費には moved/holiday を**一切**流さない（INV-05 / INV-06）。
// ★修正なしでは「ON でも moved が payload に出ない」「振替欄が元起点にならない」で落ちる。
// ============================================================================
describe('transferSourceRestDisplay: payload と埋め込みスクリプト', () => {
  const DEVELOPMENT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'

  function stubRestPopup() {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', { open: () => popup, setTimeout: (callback: () => void) => { callback(); return 0 } })
    return { write, popup }
  }

  function restStatusEntry(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
    return {
      id: 'status-moved',
      studentId: 'student-1',
      sourceManagedLesson: true,
      name: '山田 太郎',
      managedStudentId: 'student-1',
      grade: '中3',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
      teacherName: '田中講師',
      dateKey: '2026-04-01',
      slotNumber: 1,
      recordedAt: '2026-04-01T00:00:00.000Z',
      status: 'moved',
      sourceLessonId: 'lesson-1',
      moveDestinationDateKey: '2026-04-08',
      moveDestinationSlotNumber: 2,
      ...overrides,
    }
  }

  function restCell(dateKey: string, slotNumber: number, statuses: Array<StudentStatusEntry | null>): SlotCell {
    return {
      id: `${dateKey}_${slotNumber}`,
      dateKey,
      dayLabel: '水',
      dateLabel: dateKey.slice(5),
      slotLabel: `${slotNumber}限`,
      slotNumber,
      timeLabel: '17:00-18:20',
      isOpenDay: true,
      desks: [{
        id: `${dateKey}_${slotNumber}_desk-1`,
        teacher: '田中講師',
        statusSlots: [statuses[0] ?? null, statuses[1] ?? null],
      }],
    }
  }

  function renderStudentHtml(cells: SlotCell[], classroomStorageKey?: string) {
    const { write, popup } = stubRestPopup()
    openStudentScheduleHtml({
      cells,
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      classroomStorageKey,
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()
    return html
  }

  function readPayload(html: string) {
    const match = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/)
    expect(match).toBeTruthy()
    return JSON.parse(match![1]) as {
      transferSourceRestDisplayEnabled?: boolean
      outstandingMakeupOrigins?: unknown[]
      cells: Array<{ desks: Array<{ statuses?: Array<Record<string, unknown>> }> }>
    }
  }

  it('OFF(本番教室): 移動元マーカーは payload に載らない(従来どおり日程表は移動元を知らない)', () => {
    const payload = readPayload(renderStudentHtml([restCell('2026-04-01', 1, [restStatusEntry()])], '5w5OMueETerSKrSf14HC'))
    expect(payload.transferSourceRestDisplayEnabled).toBe(false)
    // 記録が 1 つも残らない机は payload から落ちる（既存仕様）。
    expect(payload.cells[0]?.desks?.length ?? 0).toBe(0)
  })

  it('ON(開発用教室): 移動元マーカーが移動先の日付/時限つきで載る', () => {
    const payload = readPayload(renderStudentHtml([restCell('2026-04-01', 1, [restStatusEntry()])], DEVELOPMENT_CLASSROOM_ID))
    expect(payload.transferSourceRestDisplayEnabled).toBe(true)
    const statusEntry = payload.cells[0]?.desks?.[0]?.statuses?.[0]
    expect(statusEntry?.status).toBe('moved')
    expect(statusEntry?.moveDestinationDateKey).toBe('2026-04-08')
    expect(statusEntry?.moveDestinationSlotNumber).toBe(2)
  })

  it('★休日記録(holiday)はフラグ OFF の教室でも載る(会計を持たない表示専用の記録は常に正しく扱う)', () => {
    const payload = readPayload(renderStudentHtml(
      [restCell('2026-04-01', 1, [restStatusEntry({ id: 'status-holiday', status: 'holiday', moveDestinationDateKey: undefined, moveDestinationSlotNumber: undefined })])],
      '5w5OMueETerSKrSf14HC',
    ))
    expect(payload.transferSourceRestDisplayEnabled).toBe(false)
    expect(payload.cells[0]?.desks?.[0]?.statuses?.[0]?.status).toBe('holiday')
  })

  it('payload に未消化振替 origin(振替欄の「未定」判定の根拠)を載せられる', () => {
    const { write, popup } = stubRestPopup()
    openStudentScheduleHtml({
      cells: [],
      students: [createStudent()],
      regularLessons: [],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      outstandingMakeupOrigins: [{ studentKey: 'student-1', studentName: '山田', subject: '数', dateKey: '2026-04-01', slotNumber: 1 }],
      targetWindow: popup,
    })
    const payload = readPayload(write.mock.calls[0]?.[0] as string)
    vi.unstubAllGlobals()
    expect(payload.outstandingMakeupOrigins).toEqual([
      { studentKey: 'student-1', studentName: '山田', subject: '数', dateKey: '2026-04-01', slotNumber: 1 },
    ])
  })

  it('★出荷スクリプトは構文的に妥当なまま(テンプレートリテラル内のエスケープ崩れ検出)', () => {
    const html = renderStudentHtml([restCell('2026-04-01', 1, [restStatusEntry()])], DEVELOPMENT_CLASSROOM_ID)
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)
    expect(scriptMatch).toBeTruthy()
    expect(() => new Function(scriptMatch![1])).not.toThrow()
  })

  it('★moved/holiday は講師日程表と回数表へ流さない(除外ガードが出荷スクリプトに入っている)', () => {
    const html = renderStudentHtml([restCell('2026-04-01', 1, [restStatusEntry()])], DEVELOPMENT_CLASSROOM_ID)
    // 共通述語(1か所で定義し、講師集計・回数・初期表示の全部がこれを使う)
    expect(html).toContain("return status === 'moved' || status === 'holiday';")
    // 講師側: buildTeacherAssignments の時点で落とす(下流の給与・交通費・振替欄・セルすべてに効く)
    expect(html).toContain('return entry && !isRestRecordStatus(entry.status);')
    // 生徒側の回数表(実績/講習回数)
    expect(html).toContain('if (isRestRecordStatus(entry.lesson.status)) return;')
    // 掴める授業カードにしない(出欠記録は D&D 対象外)
    expect(html).toContain("if (entry.status) return '';")
  })

  it('★フラグ ON のときだけ振替欄を元起点の新方式に切り替える(OFF は従来関数のまま)', () => {
    const html = renderStudentHtml([], DEVELOPMENT_CLASSROOM_ID)
    expect(html).toContain('const makeupNotes = DATA.transferSourceRestDisplayEnabled')
    expect(html).toContain('? collectStudentMakeupRows(entries, student, startDate)')
    expect(html).toContain(': collectStudentMakeupNotes(entries);')
  })
})

describe('transferSourceRestDisplay: 振替欄の行づくり(出荷スクリプトの実体を評価)', () => {
  function extractMakeupRowsApi() {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', { open: () => popup, setTimeout: (callback: () => void) => { callback(); return 0 } })
    openStudentScheduleHtml({
      cells: [],
      students: [],
      regularLessons: [],
      defaultStartDate: '2026-04-01',
      defaultEndDate: '2026-04-30',
      titleLabel: 'テスト',
      classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
      targetWindow: popup,
    })
    const html = write.mock.calls[0]?.[0] as string
    vi.unstubAllGlobals()

    const extractBody = (signature: string) => {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = html.match(new RegExp('function ' + escaped + ' \\{([\\s\\S]*?)\\n {6}\\}'))
      expect(match, signature).toBeTruthy()
      return match![1]
    }
    const source = [
      "var DATA = {};",
      "var MAKEUP_DESTINATION_UNDECIDED = '未定';",
      // 学年による科目の表記ゆれ吸収は別テストの担当。ここでは素通しにして行づくりだけを見る。
      'function normalizeSubjectForStudent(subject) { return subject; }',
      'function isRestRecordStatus(status) {' + extractBody('isRestRecordStatus(status)') + '}',
      'function compactMakeupDateSlot(dateKey, slotNumber) {' + extractBody('compactMakeupDateSlot(dateKey, slotNumber)') + '}',
      'function compactMakeupSourceLabel(label) {' + extractBody('compactMakeupSourceLabel(label)') + '}',
      'function isSameMakeupOriginText(left, right) {' + extractBody('isSameMakeupOriginText(left, right)') + '}',
      'function compactMakeupDestination(dateKey, slotNumber) {' + extractBody('compactMakeupDestination(dateKey, slotNumber)') + '}',
      'function hasOutstandingMakeupOrigin(student, subject, dateKey, slotNumber, referenceDate) {'
        + extractBody('hasOutstandingMakeupOrigin(student, subject, dateKey, slotNumber, referenceDate)') + '}',
      'function collectStudentMakeupRows(entries, student, referenceDate) {'
        + extractBody('collectStudentMakeupRows(entries, student, referenceDate)') + '}',
      'return function(entries, student, outstandingMakeupOrigins) {',
      '  DATA = { outstandingMakeupOrigins: outstandingMakeupOrigins || [] };',
      "  return collectStudentMakeupRows(entries, student, '2026-04-01');",
      '};',
    ].join('\n')
    return new Function(source)() as (
      entries: unknown[],
      student: { id: string; name: string; fullName?: string },
      outstandingMakeupOrigins?: unknown[],
    ) => string[]
  }

  const student = { id: 'student-1', name: '山田', fullName: '山田 太郎' }
  const absentOrigin = {
    dateKey: '2026-04-01',
    slotNumber: 1,
    lesson: { status: 'absent', lessonType: 'regular', subject: '数' },
  }

  it('①元だけ範囲内・振替先が組まれている: 「科目 元 → 先」を出す', () => {
    const run = extractMakeupRowsApi()
    const rows = run([{
      ...absentOrigin,
      lesson: { ...absentOrigin.lesson, linkedDestinationDateKey: '2026-04-08', linkedDestinationSlotNumber: 3 },
    }], student)
    expect(rows).toEqual(['数 4/1 1限 → 4/8 3限'])
  })

  it('②元だけ範囲内・振替先が未配置(未消化に残っている): 「未定」を出す', () => {
    const run = extractMakeupRowsApi()
    const rows = run([absentOrigin], student, [{ studentKey: 'student-1', studentName: '山田', subject: '数', dateKey: '2026-04-01', slotNumber: 1 }])
    expect(rows).toEqual(['数 4/1 1限 → 未定'])
  })

  it('③先だけ範囲内(元は範囲外): 従来どおり配置済み振替コマから1行出す', () => {
    const run = extractMakeupRowsApi()
    const rows = run([{
      dateKey: '2026-04-20',
      slotNumber: 5,
      lesson: { lessonType: 'makeup', subject: '数', makeupSourceDate: '2026-03-10', makeupSourceLabel: '2026/3/10(火) 4限' },
    }], student)
    expect(rows).toEqual(['数 3/10 4限 → 4/20 5限'])
  })

  it('★④元も先も範囲内: 同じ1件なので重複排除して1行だけ', () => {
    const run = extractMakeupRowsApi()
    const rows = run([
      { ...absentOrigin, lesson: { ...absentOrigin.lesson, linkedDestinationDateKey: '2026-04-08', linkedDestinationSlotNumber: 3 } },
      {
        dateKey: '2026-04-08',
        slotNumber: 3,
        lesson: { lessonType: 'makeup', subject: '数', makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' },
      },
    ], student)
    expect(rows).toEqual(['数 4/1 1限 → 4/8 3限'])
  })

  it('★移動元マーカー(moved)はリンクが無くても自分の移動先を出す(振替先が表示範囲外のとき)', () => {
    const run = extractMakeupRowsApi()
    const rows = run([{
      dateKey: '2026-04-01',
      slotNumber: 1,
      lesson: { status: 'moved', lessonType: 'regular', subject: '数', moveDestinationDateKey: '2026-05-08', moveDestinationSlotNumber: 2 },
    }], student)
    expect(rows).toEqual(['数 4/1 1限 → 5/8 2限'])
  })

  it('休日記録(holiday)も元起点の行になる(未消化に残っていれば未定)', () => {
    const run = extractMakeupRowsApi()
    const rows = run(
      [{ dateKey: '2026-04-01', slotNumber: 1, lesson: { status: 'holiday', lessonType: 'regular', subject: '数' } }],
      student,
      [{ studentKey: 'student-1', studentName: '山田', subject: '数', dateKey: '2026-04-01' }],
    )
    expect(rows).toEqual(['数 4/1 1限 → 未定'])
  })

  it('講習(special)・体験(trial)の記録は振替欄に出さない(従来どおり)', () => {
    const run = extractMakeupRowsApi()
    const rows = run([
      { dateKey: '2026-04-01', slotNumber: 1, lesson: { status: 'absent', lessonType: 'special', subject: '数' } },
      { dateKey: '2026-04-02', slotNumber: 1, lesson: { status: 'holiday', lessonType: 'trial', subject: '英' } },
    ], student)
    expect(rows).toEqual([])
  })

  it('元が振替コマの休みは行にしない(元の通常授業日の記録が1行出すので二重にならない)', () => {
    const run = extractMakeupRowsApi()
    const rows = run([{
      dateKey: '2026-04-08',
      slotNumber: 3,
      lesson: { status: 'absent', lessonType: 'makeup', subject: '数', makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' },
    }], student)
    expect(rows).toEqual([])
  })

  it('元日付の昇順に並べる', () => {
    const run = extractMakeupRowsApi()
    const rows = run([
      { dateKey: '2026-04-15', slotNumber: 2, lesson: { status: 'absent', lessonType: 'regular', subject: '数' } },
      { dateKey: '2026-04-01', slotNumber: 1, lesson: { status: 'absent', lessonType: 'regular', subject: '英' } },
    ], student)
    expect(rows).toEqual(['英 4/1 1限 → 未定', '数 4/15 2限 → 未定'])
  })
})
