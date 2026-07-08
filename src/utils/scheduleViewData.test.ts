// 対話用日程表 React ビューの表示算出(scheduleViewData)の回帰防止テスト。
// 埋め込みJS(生成HTML)と同じ入力(SchedulePayload)から同じ表示データが出ることを代表ケースで固定する
// (docs/handoff-popup-sync-and-dnd.md §6 Phase 0 / spec-schedule-interactive-view §C-3)。
import { describe, expect, it } from 'vitest'
import type { SchedulePayload, SerializedCell, SerializedStudent, SerializedStudentEntry, SerializedStudentStatusEntry, SerializedTeacher } from './scheduleHtml'
import {
  buildCountRows,
  buildDateHeaders,
  buildStudentSheetViewModel,
  buildTeacherSheetViewModel,
  hasCountMismatch,
  resolveDefaultPersonId,
} from './scheduleViewData'
import { scheduleRowPropsAreEqual } from '../components/schedule-view/ScheduleSheet'

const TODAY = '2026-07-08'

function makeStudent(overrides: Partial<SerializedStudent> = {}): SerializedStudent {
  return {
    id: 'stu-1',
    name: '山田太',
    fullName: '山田 太郎',
    currentGradeLabel: '中2',
    currentGradeOrder: 102,
    birthDate: '2012-05-10',
    entryDate: '2025-04-01',
    withdrawDate: '',
    ...overrides,
  }
}

function makeTeacher(overrides: Partial<SerializedTeacher> = {}): SerializedTeacher {
  return {
    id: 'tea-1',
    name: '佐藤',
    fullName: '佐藤 花子',
    entryDate: '2024-04-01',
    withdrawDate: '',
    subjects: ['英中3'],
    ...overrides,
  }
}

function makeLessonStudent(overrides: Partial<SerializedStudentEntry> = {}): SerializedStudentEntry {
  return {
    id: 'entry-1',
    linkedStudentId: 'stu-1',
    name: '山田太',
    grade: '中2',
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    manualAdded: false,
    ...overrides,
  }
}

function makeStatusEntry(overrides: Partial<SerializedStudentStatusEntry> = {}): SerializedStudentStatusEntry {
  return {
    id: 'status-1',
    linkedStudentId: 'stu-1',
    name: '山田太',
    grade: '中2',
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '佐藤',
    recordedAt: '2026-07-01T00:00:00.000Z',
    status: 'attended',
    ...overrides,
  }
}

function makeCell(dateKey: string, slotNumber: number, desks: SerializedCell['desks'], isOpenDay = true): SerializedCell {
  return {
    dateKey,
    dateLabel: `${Number(dateKey.split('-')[1])}/${Number(dateKey.split('-')[2])}`,
    dayLabel: '月',
    slotNumber,
    slotLabel: `${slotNumber}限`,
    timeLabel: '16:20-17:50',
    isOpenDay,
    desks,
  }
}

function makePayload(overrides: Partial<SchedulePayload> = {}): SchedulePayload {
  return {
    titleLabel: 'テスト',
    defaultStartDate: '2026-07-06',
    defaultEndDate: '2026-07-12',
    defaultPeriodValue: '',
    defaultPersonId: '',
    availableStartDate: '2026-07-06',
    availableEndDate: '2026-07-12',
    availability: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] },
    periodBands: [],
    students: [makeStudent()],
    teachers: [],
    cells: [],
    scheduleNotes: {},
    expectedRegularOccurrences: [],
    countAdjustments: [],
    specialSessions: [],
    groupClassEntries: {},
    classroomStorageKey: 'test',
    showSubmittedQr: true,
    optionFieldEnabled: false,
    ...overrides,
  }
}

const vmOptions = { startDate: '2026-07-06', endDate: '2026-07-12', studentId: 'stu-1', todayKey: TODAY }

describe('scheduleViewData: 生徒シートの表示算出', () => {
  it('通常/振替/講習カードと出欠カードを生成HTMLと同じ規則で組み立てる', () => {
    const payload = makePayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent()] } }]),
        makeCell('2026-07-07', 2, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent({ id: 'entry-2', lessonType: 'special', subject: '数', noteSuffix: '60' } as Partial<SerializedStudentEntry> & { noteSuffix: string })] } }]),
        makeCell('2026-07-08', 3, [{ teacher: '佐藤', statuses: [makeStatusEntry({ status: 'absent-no-makeup', linkedDestinationDateKey: '2026-07-20', linkedDestinationSlotNumber: 5 })] }]),
      ],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)
    expect(vm).not.toBeNull()
    const row1 = vm!.rows.find((row) => row.slotNumber === 1)!
    const mondayCell = row1.cells.find((cell) => cell.dateKey === '2026-07-06')!
    expect(mondayCell.cards).toEqual([{ main: '英', sub: '通常' }])
    expect(mondayCell.title).toBe('英 / 通常 / 佐藤')

    const row2 = vm!.rows.find((row) => row.slotNumber === 2)!
    const lectureCell = row2.cells.find((cell) => cell.dateKey === '2026-07-07')!
    // 講習は科目に授業時間(60/45)を併記する(90は付けない)
    expect(lectureCell.cards).toEqual([{ main: '数60', sub: '講習' }])

    const row3 = vm!.rows.find((row) => row.slotNumber === 3)!
    const statusCell = row3.cells.find((cell) => cell.dateKey === '2026-07-08')!
    // 振無休 + 振替先(リンク先)の月日を主表示に出す
    expect(statusCell.cards).toEqual([{ main: '振無休 7月20日', sub: '英 / 通常' }])
  })

  it('振替欄はコンパクト表記(年・曜日を省く)で、休み扱いの振替は載せない', () => {
    const payload = makePayload({
      cells: [
        makeCell('2026-07-10', 5, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent({ lessonType: 'makeup', makeupSourceLabel: '2026/4/1(水) 1限' })] } }]),
        makeCell('2026-07-11', 2, [{ teacher: '佐藤', statuses: [makeStatusEntry({ id: 'status-2', lessonType: 'makeup', makeupSourceLabel: '2026/4/2(木) 2限', status: 'absent' })] }]),
      ],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    expect(vm.makeupNotes).toEqual(['英 4/1 1限 → 7/10 5限'])
  })

  it('欠席欄は日時/講師/種別/科目で組み、振無休と振替先を追記する', () => {
    const payload = makePayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', statuses: [makeStatusEntry({ status: 'absent' })] }]),
        makeCell('2026-07-07', 2, [{ teacher: '佐藤', statuses: [makeStatusEntry({ id: 'status-2', status: 'absent-no-makeup', linkedDestinationDateKey: '2026-07-21', linkedDestinationSlotNumber: 3 })] }]),
      ],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    expect(vm.absenceNotes[0]).toBe('7/6(月)1限 / 佐藤 / 通常 / 英')
    expect(vm.absenceNotes[1]).toBe('7/7(火)2限 / 佐藤 / 通常 / 英 (振無休) → 7/21(火)3限')
  })

  it('回数表: 欠席は数えず、希望数は補正(countAdjustments)を反映し、不一致で警告フラグ', () => {
    const payload = makePayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent()] } }]),
        makeCell('2026-07-07', 1, [{ teacher: '佐藤', statuses: [makeStatusEntry({ status: 'absent' })] }]),
      ],
      expectedRegularOccurrences: [
        { linkedStudentId: 'stu-1', subject: '英', dateKey: '2026-07-06' },
        { linkedStudentId: 'stu-1', subject: '英', dateKey: '2026-07-07' },
      ],
      countAdjustments: [
        { studentKey: 'stu-1', subject: '英', countKind: 'regular', dateKey: '2026-07-07', delta: 1 },
      ],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    // 実績=1(欠席は数えない)、予定=2(テンプレ由来)+補正1=3
    expect(vm.regularCountRows).toEqual([{ label: '英', count: 1, desired: 3 }])
    expect(vm.regularCountMismatch).toBe(true)
  })

  it('講習回数表: 実配置の授業時間(60分)を科目名に併記し、希望登録(QR)の希望数と比較する', () => {
    const payload = makePayload({
      cells: [
        makeCell('2026-07-06', 2, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent({ lessonType: 'special', subject: '数', noteSuffix: '60' } as Partial<SerializedStudentEntry> & { noteSuffix: string })] } }]),
      ],
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        teacherInputs: {},
        studentInputs: {
          'stu-1': { unavailableSlots: [], subjectSlots: { 数: 2 }, subjectDurations: { 数: 60 }, regularOnly: false, countSubmitted: true },
        },
      }],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    const mathRow = vm.lectureCountRows.find((row) => row.label.startsWith('数'))!
    expect(mathRow).toEqual({ label: '数60分', count: 1, desired: 2 })
    expect(vm.lectureCountMismatch).toBe(true)
  })

  it('不可時間(QR提出)のコマは is-unavailable になる', () => {
    const payload = makePayload({
      cells: [makeCell('2026-07-06', 1, [])],
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        teacherInputs: {},
        studentInputs: {
          'stu-1': { unavailableSlots: ['2026-07-06_1'], subjectSlots: {}, regularOnly: false, countSubmitted: false },
        },
      }],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    const cell = vm.rows.find((row) => row.slotNumber === 1)!.cells.find((c) => c.dateKey === '2026-07-06')!
    expect(cell.isUnavailable).toBe(true)
  })

  it('集団授業(中3): 登録後は参加者のみ表示し欠席を（欠）で示し、講習回数に集理/集社を注入する', () => {
    const student = makeStudent({ currentGradeLabel: '中3', currentGradeOrder: 103 })
    const payload = makePayload({
      students: [student],
      cells: [makeCell('2026-07-06', 1, [])],
      groupClassEntries: {
        '2026-07-06_1': { dateKey: '2026-07-06', band: 1, subject: '集団理科', teacherName: '佐藤', addedStudentIds: [], absentStudentIds: [] },
        '2026-07-07_1': { dateKey: '2026-07-07', band: 1, subject: '集団理科', teacherName: '佐藤', addedStudentIds: [], absentStudentIds: ['stu-1'] },
      },
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        teacherInputs: {},
        studentInputs: {
          'stu-1': { unavailableSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: true, groupClassParticipation: { 集団理科: true } },
        },
      }],
    })
    const vm = buildStudentSheetViewModel(payload, vmOptions)!
    const band1 = vm.groupRows.find((row) => row.band === '1')!
    expect(band1.cells[0]).toMatchObject({ label: '集理', state: 'normal' })
    expect(band1.cells[1]).toMatchObject({ label: '集理（欠）', state: 'absent' })
    const groupCount = vm.lectureCountRows.find((row) => row.label === '集理')!
    // 希望=期間内の名簿掲載コマ数(2)、実績=出席数(1)
    expect(groupCount).toEqual({ label: '集理', count: 1, desired: 2 })
  })

  it('QR: 提出済みで showSubmittedQr=false ならバッジのみ、未提出はトークンから解決する', () => {
    const submitted = buildStudentSheetViewModel(
      makePayload({ students: [makeStudent({ submissionSubmitted: true, submissionToken: 'token-1' })], showSubmittedQr: false }),
      { ...vmOptions, resolveQrSvg: () => '<svg>QR</svg>' },
    )!
    expect(submitted.qr).toEqual({ svg: '', submitted: true })

    const unsubmitted = buildStudentSheetViewModel(
      makePayload({ students: [makeStudent({ submissionToken: 'token-1' })] }),
      { ...vmOptions, resolveQrSvg: () => '<svg>QR</svg>' },
    )!
    expect(unsubmitted.qr).toEqual({ svg: '<svg>QR</svg>', submitted: false })
  })

  it('休日判定: 定休曜日・休校日・強制開校日と cells の isOpenDay フォールバックを併用する', () => {
    const payload = makePayload({
      availability: { closedWeekdays: [0], holidayDates: ['2026-07-07'], forceOpenDates: ['2026-07-12'] },
      cells: [makeCell('2026-07-08', 1, [], false)],
    })
    const headers = buildDateHeaders(payload, '2026-07-06', '2026-07-12')
    const byDate = new Map(headers.map((header) => [header.dateKey, header]))
    expect(byDate.get('2026-07-07')!.isOpenDay).toBe(false) // 休校日
    expect(byDate.get('2026-07-08')!.isOpenDay).toBe(false) // cells の isOpenDay=false を優先
    expect(byDate.get('2026-07-12')!.isOpenDay).toBe(true)  // 日曜(定休)だが強制開校
  })
})

describe('scheduleViewData: 講師シートの表示算出', () => {
  function makeTeacherPayload(overrides: Partial<SchedulePayload> = {}): SchedulePayload {
    return makePayload({
      students: [],
      teachers: [makeTeacher()],
      ...overrides,
    })
  }

  it('teacherId と講師名キーの両方で拾い、同一コマは重複させない(給与カウントも一致)', () => {
    const attended90 = makeStatusEntry({ status: 'attended' })
    const payload = makeTeacherPayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', teacherId: 'tea-1', statuses: [attended90] }]),
      ],
    })
    const vm = buildTeacherSheetViewModel(payload, { startDate: '2026-07-06', endDate: '2026-07-12', teacherId: 'tea-1', todayKey: TODAY })!
    const cell = vm.rows.find((row) => row.slotNumber === 1)!.cells.find((c) => c.dateKey === '2026-07-06')!
    expect(cell.people).toHaveLength(1)
    expect(cell.people[0]).toMatchObject({ name: '山田太', meta: '英 通 出席' })
    // 1名出席・中学以下・90分 → A90 が1コマ、出勤1日
    expect(vm.salary.rows).toEqual([{ cat: 'A90', label: 'A90 (1名/中学以下/90分)', count: 1 }])
    expect(vm.salary.attendanceDays).toBe(1)
  })

  it('給与: 2名出席は授業時間ペア、高校生を含むと C/D 側に数える', () => {
    const payload = makeTeacherPayload({
      cells: [
        makeCell('2026-07-06', 1, [{
          teacher: '佐藤', teacherId: 'tea-1',
          statuses: [
            makeStatusEntry({ id: 's1', status: 'attended', noteSuffix: '60' }),
            makeStatusEntry({ id: 's2', name: '高橋', grade: '高2', status: 'attended' }),
          ],
        }]),
      ],
    })
    const vm = buildTeacherSheetViewModel(payload, { startDate: '2026-07-06', endDate: '2026-07-12', teacherId: 'tea-1', todayKey: TODAY })!
    expect(vm.salary.rows).toEqual([{ cat: 'D90-60', label: 'D 90-60 (2名/高校以上/90+60分)', count: 1 }])
  })

  it('講師の回数表は欠席(absent)のみ除外する(振無休は数える)', () => {
    const payload = makeTeacherPayload({
      cells: [
        makeCell('2026-07-06', 1, [{
          teacher: '佐藤', teacherId: 'tea-1',
          statuses: [
            makeStatusEntry({ id: 's1', status: 'absent' }),
            makeStatusEntry({ id: 's2', status: 'absent-no-makeup', subject: '数' }),
          ],
        }]),
      ],
    })
    const vm = buildTeacherSheetViewModel(payload, { startDate: '2026-07-06', endDate: '2026-07-12', teacherId: 'tea-1', todayKey: TODAY })!
    expect(vm.regularCountRows).toEqual([{ label: '数', count: 1, desired: 1 }])
  })
})

describe('scheduleViewData: 共通ヘルパ', () => {
  it('buildCountRows は科目順(SUBJECT_SORT_ORDER)で並べ、hideZeroZero で0/0行を隠す', () => {
    const rows = buildCountRows({ 国: 1, 英: 2 }, { 数: 1 }, ['理'], { hideZeroZero: true })
    expect(rows.map((row) => row.label)).toEqual(['英', '数', '国'])
    expect(hasCountMismatch({ 英: 2 }, { 英: 2 })).toBe(false)
    expect(hasCountMismatch({ 英: 2 }, { 英: 3 })).toBe(true)
  })

  it('resolveDefaultPersonId は 指定id → defaultPersonId → 配置あり → 先頭 の順で決める', () => {
    const stu2 = makeStudent({ id: 'stu-2', name: '鈴木', fullName: '鈴木 一', currentGradeOrder: 101 })
    const payload = makePayload({
      students: [makeStudent(), stu2],
      cells: [makeCell('2026-07-06', 1, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent()] } }])],
    })
    expect(resolveDefaultPersonId(payload, 'student', '2026-07-06', '2026-07-12', 'stu-2', TODAY)).toBe('stu-2')
    // 指定なし → 配置のある stu-1 を優先(50音順先頭の stu-2 ではなく)
    expect(resolveDefaultPersonId(payload, 'student', '2026-07-06', '2026-07-12', '', TODAY)).toBe('stu-1')
  })

  it('行メモ化: 変化のない行は signature が同一で再レンダーをスキップし、編集した行だけ変わる', () => {
    const basePayload = makePayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent()] } }]),
        makeCell('2026-07-06', 2, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent({ id: 'entry-2', subject: '数' })] } }]),
      ],
    })
    const editedPayload = makePayload({
      cells: [
        makeCell('2026-07-06', 1, [{ teacher: '佐藤', lesson: { students: [makeLessonStudent()] } }]),
        makeCell('2026-07-06', 2, [{ teacher: '佐藤', statuses: [makeStatusEntry({ subject: '数' })], lesson: { students: [] } }]),
      ],
    })
    const before = buildStudentSheetViewModel(basePayload, vmOptions)!
    const after = buildStudentSheetViewModel(editedPayload, vmOptions)!
    const beforeRow1 = before.rows.find((row) => row.slotNumber === 1)!
    const afterRow1 = after.rows.find((row) => row.slotNumber === 1)!
    const beforeRow2 = before.rows.find((row) => row.slotNumber === 2)!
    const afterRow2 = after.rows.find((row) => row.slotNumber === 2)!
    // 1限行は不変 → signature 同一 → React.memo が再レンダーをスキップ
    expect(scheduleRowPropsAreEqual({ row: beforeRow1 }, { row: afterRow1 })).toBe(true)
    // 2限行は出席化で変化 → signature が変わり再レンダーされる
    expect(scheduleRowPropsAreEqual({ row: beforeRow2 }, { row: afterRow2 })).toBe(false)
  })
})
