// 保護者向け日程計算 buildParentScheduleView(src/utils/parentSchedule.ts と functions/src/generated/parentSchedule.ts の複製)が
// **同じ入力で同じ結果を出す**ことを両側のテストで確かめるための共有 fixture(spec-parent-portal.md §D / §I K-3)。
// 本番スナップショットと同じ形(boardState.weeks は cell 配列 or { cells } の週)を写したもの。
// アプリ本体からは import されない(テスト専用・バンドルには入らない)。
//
// 「今日」= 2026-09-14(月)。既定範囲は 2026-09-07 〜 2026-10-12。
// 含める状況:
//   - 休み(9/09 理)→ 振替先が **出席済み**(9/10 4限 statusSlots attended)        … P-10 回帰
//   - 休み(9/15 英)→ 振替先が配置済み(9/20 日曜=forceOpen の 2限)                 … forceOpen
//   - 休み(9/16 理)→ 振替先なし(調整中)
//   - 振無休(9/11 数)・出席済み通常(9/10 3限)・増コマ(9/12 3限)・移動元マーカー(9/14 2限 moved → 9/16 2限)
//   - 講習期間 10/01〜10/05(保存週 9/28 と欠落週 10/05 をまたぐ)。期間外に置かれた講習コマ(9/30)
//   - 欠落週 9/21〜9/27・10/05〜10/11(テンプレ補完。9/23 祝日、9/27 日曜)
//   - 置かれた振替(9/29 数 ← 9/21 1限)による暗黙抑止、明示抑止 s001__英__2026-10-08__3
//   - テンプレ履歴 2 本(4/01 と 9/01)。9/01 以降は新テンプレの行だけが有効
//   - 同名別人(s001 と s003 は同じ氏名「青木 太郎」)、体験生(同名・managedStudentId なし)、退塾(s004 9/10)、
//     高3卒業(s005)、未来入塾(s006 10/01)、小学生の 算/数 正規化(s002)
import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { RegularLessonTemplate } from '../components/regular-template/regularLessonTemplate'
import type { DeskCell, GradeLabel, SlotCell, StudentEntry, StudentStatusEntry, SubjectLabel, LessonType, StudentStatusKind } from '../components/schedule-board/types'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { AppSnapshotPayload, ClassroomSettings, PersistedBoardState } from '../types/appState'

export const PARENT_SCHEDULE_FIXTURE_TODAY = '2026-09-14'
export const PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE = { from: '2026-09-07', to: '2026-10-12' } as const

/** 応答に絶対に含めてはいけない文字列(講師名・他生徒名・机 id・内部 id・在庫語)。テストで JSON 文字列を検査する。 */
export const PARENT_SCHEDULE_FIXTURE_FORBIDDEN_STRINGS = ['田中', '鈴木', '佐藤', '山田', '高橋', '中村', '体験', 'desk', 's001', 's002', 's003', 's004', 's005', 's006', 't001', 't002', '在庫', '未消化', '講師']

const SLOT_TIMES = ['13:00-14:30', '14:40-16:10', '16:20-17:50', '18:00-19:30', '19:40-21:10'] as const
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

export const parentScheduleFixtureStudents: StudentRow[] = [
  { id: 's001', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-15' }, // 中3
  { id: 's002', name: '佐藤 花', displayName: '佐藤', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2015-10-02' }, // 小5
  { id: 's003', name: '青木 太郎', displayName: '青木(弟)', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2013-04-10' }, // 中1・s001 と同名
  { id: 's004', name: '山田 一郎', displayName: '山田', email: '', entryDate: '2024/4/1', withdrawDate: '2026/9/10', birthDate: '2012-01-20' }, // 9/10 退塾(スラッシュ日付)
  { id: 's005', name: '高橋 卒', displayName: '高橋', email: '', entryDate: '2020-04-01', withdrawDate: '', birthDate: '2007-08-01' }, // 高3卒業済み
  { id: 's006', name: '中村 新', displayName: '中村', email: '', entryDate: '2026-10-01', withdrawDate: '', birthDate: '2014-05-05' }, // 10/01 入塾
]

export const parentScheduleFixtureTeachers: TeacherRow[] = [
  { id: 't001', name: '田中 一郎', displayName: '田中', email: '', entryDate: '2020-04-01', withdrawDate: '', subjectCapabilities: [] },
  { id: 't002', name: '鈴木 二郎', displayName: '鈴木', email: '', entryDate: '2020-04-01', withdrawDate: '', subjectCapabilities: [] },
]

function templateCell(dayOfWeek: number, slotNumber: number, desks: Array<[string, Array<[string, SubjectLabel] | null>]>): RegularLessonTemplate['cells'][number] {
  return {
    dayOfWeek,
    slotNumber,
    desks: desks.map(([teacherId, students], index) => ({
      deskIndex: index + 1,
      teacherId,
      students: [
        students[0] ? { studentId: students[0][0], subject: students[0][1] } : null,
        students[1] ? { studentId: students[1][0], subject: students[1][1] } : null,
      ],
    })),
  }
}

/** 4/01 反映の旧テンプレ(s001 月2限 数)。9/01 の新テンプレで置き換わる。 */
export const parentScheduleFixtureTemplateApril: RegularLessonTemplate = {
  version: 1,
  effectiveStartDate: '2026-04-01',
  savedAt: '2026-03-25T00:00:00.000Z',
  cells: [
    templateCell(1, 2, [['t001', [['s001', '数'], null]]]),
    templateCell(2, 1, [['t001', [['s004', '国'], null]]]),
  ],
}

/** 9/01 反映の現行テンプレ。 */
export const parentScheduleFixtureTemplateSeptember: RegularLessonTemplate = {
  version: 1,
  effectiveStartDate: '2026-09-01',
  savedAt: '2026-08-25T00:00:00.000Z',
  cells: [
    templateCell(1, 1, [['t001', [['s001', '数'], ['s003', '英']]]]),
    templateCell(2, 1, [['t001', [['s004', '国'], null]]]),
    templateCell(3, 1, [['t001', [['s001', '理'], null]]]),
    templateCell(4, 3, [['t001', [['s001', '英'], null]], ['t002', [['s002', '算'], null]]]),
    templateCell(5, 2, [['t001', [['s006', '数'], null]]]),
    templateCell(6, 1, [['t002', [['s002', '数'], null]]]), // 小5 に 数 → 表示は 算 に正規化される
  ],
}

function regularRow(id: string, dayOfWeek: number, slotNumber: number, teacherId: string, s1: [string, string], s2: [string, string] | null): RegularLessonRow {
  return {
    id, schoolYear: 2026, teacherId,
    student1Id: s1[0], subject1: s1[1], student1Note: '',
    startDate: '2026-09-01', endDate: '2027-03-31',
    student2Id: s2?.[0] ?? '', subject2: s2?.[1] ?? '', student2Note: '',
    student2StartDate: '2026-09-01', student2EndDate: '2027-03-31',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '',
    dayOfWeek, slotNumber,
  }
}

/** payload.regularLessons(現行テンプレ由来)。履歴が 2 本あるため結合時には使われない(履歴展開が優先)。 */
export const parentScheduleFixtureRegularLessons: RegularLessonRow[] = [
  regularRow('template_2026_1_1_1', 1, 1, 't001', ['s001', '数'], ['s003', '英']),
  regularRow('template_2026_2_1_1', 2, 1, 't001', ['s004', '国'], null),
  regularRow('template_2026_3_1_1', 3, 1, 't001', ['s001', '理'], null),
  regularRow('template_2026_4_3_1', 4, 3, 't001', ['s001', '英'], null),
  regularRow('template_2026_4_3_2', 4, 3, 't002', ['s002', '算'], null),
  regularRow('template_2026_5_2_1', 5, 2, 't001', ['s006', '数'], null),
  regularRow('template_2026_6_1_1', 6, 1, 't002', ['s002', '算'], null),
]

export const parentScheduleFixtureClassroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: ['2026-09-23'],
  forceOpenDates: ['2026-09-20'],
  deskCount: 2,
  regularLessonTemplate: parentScheduleFixtureTemplateSeptember,
  regularLessonTemplateHistory: [parentScheduleFixtureTemplateApril, parentScheduleFixtureTemplateSeptember],
  preTemplateRegularLessons: [
    { ...regularRow('pre_2025_1_3_1', 1, 3, 't001', ['s001', '数'], null), schoolYear: 2025, startDate: '', endDate: '', student2StartDate: '', student2EndDate: '' },
  ],
  templateFreezeBeforeDate: '2026-04-01',
}

export const parentScheduleFixtureSpecialSessions: SpecialSessionRow[] = [
  { id: 'ss-autumn', label: '秋期講習', startDate: '2026-10-01', endDate: '2026-10-05', teacherInputs: {}, studentInputs: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
]

const studentGradeById: Record<string, GradeLabel> = { s001: '中3', s002: '小5', s003: '中1', s004: '中3', s005: '高3', s006: '小6' }

function entry(studentId: string, subject: SubjectLabel, lessonType: LessonType, extra: Partial<StudentEntry> = {}): StudentEntry {
  const student = parentScheduleFixtureStudents.find((row) => row.id === studentId)
  return {
    id: `${studentId}_${extra.makeupSourceDate ?? 'x'}_${subject}_${lessonType}`,
    name: student?.displayName || student?.name || studentId,
    managedStudentId: studentId,
    grade: studentGradeById[studentId] ?? '中1',
    birthDate: student?.birthDate,
    subject,
    lessonType,
    teacherType: 'normal',
    ...extra,
  }
}

function status(id: string, studentId: string, subject: SubjectLabel, lessonType: LessonType, statusKind: StudentStatusKind, dateKey: string, slotNumber: number, extra: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  const base = entry(studentId, subject, lessonType)
  return {
    id,
    studentId: base.id,
    sourceManagedLesson: lessonType === 'regular',
    name: base.name,
    managedStudentId: studentId,
    grade: base.grade,
    birthDate: base.birthDate,
    subject,
    lessonType,
    teacherType: 'normal',
    teacherName: '田中',
    dateKey,
    slotNumber,
    recordedAt: '2026-09-13T09:00:00.000Z',
    status: statusKind,
    sourceLessonId: `lesson_${dateKey}_${slotNumber}`,
    ...extra,
  }
}

function desk(cellId: string, index: number, options: { teacher?: string; students?: [StudentEntry | null, StudentEntry | null]; statuses?: [StudentStatusEntry | null, StudentStatusEntry | null] } = {}): DeskCell {
  const cell: DeskCell = { id: `${cellId}_desk_${index}`, teacher: options.teacher ?? '' }
  if (options.students) cell.lesson = { id: `${cellId}_lesson_${index}`, studentSlots: options.students }
  if (options.statuses) cell.statusSlots = options.statuses
  return cell
}

type DeskSpec = (cellId: string, index: number) => DeskCell

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')}`
}

/** 月曜始まり 7 日 × 5 限 = 35 セル。overrides で (date_slot) → 机の中身を差し込む。 */
function buildWeek(mondayKey: string, overrides: Record<string, DeskSpec[]>, closedDates: string[] = []): SlotCell[] {
  const cells: SlotCell[] = []
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dateKey = shiftDateKey(mondayKey, dayOffset)
    const [, month, day] = dateKey.split('-')
    const weekday = (dayOffset + 1) % 7
    for (let slotIndex = 0; slotIndex < SLOT_TIMES.length; slotIndex += 1) {
      const slotNumber = slotIndex + 1
      const cellId = `${dateKey}_${slotNumber}`
      const specs = overrides[cellId] ?? []
      cells.push({
        id: cellId,
        dateKey,
        dayLabel: DAY_LABELS[weekday],
        dateLabel: `${Number(month)}/${Number(day)}`,
        slotLabel: `${slotNumber}限`,
        slotNumber,
        timeLabel: SLOT_TIMES[slotIndex],
        isOpenDay: weekday !== 0 && !closedDates.includes(dateKey),
        desks: [0, 1].map((deskIndex) => (specs[deskIndex] ? specs[deskIndex](cellId, deskIndex + 1) : desk(cellId, deskIndex + 1))),
      })
    }
  }
  return cells
}

const withLesson = (teacher: string, students: [StudentEntry | null, StudentEntry | null]): DeskSpec => (cellId, index) => desk(cellId, index, { teacher, students })
const withStatus = (statuses: [StudentStatusEntry | null, StudentStatusEntry | null]): DeskSpec => (cellId, index) => desk(cellId, index, { teacher: '田中', statuses })
const withBoth = (teacher: string, students: [StudentEntry | null, StudentEntry | null], statuses: [StudentStatusEntry | null, StudentStatusEntry | null]): DeskSpec => (cellId, index) => desk(cellId, index, { teacher, students, statuses })

/** 週 9/07〜9/13(保存済み・過去)。 */
export const parentScheduleFixtureWeek0907: SlotCell[] = buildWeek('2026-09-07', {
  '2026-09-07_1': [withLesson('田中', [entry('s001', '数', 'regular'), entry('s003', '英', 'regular')])],
  '2026-09-08_1': [withLesson('田中', [entry('s004', '国', 'regular'), null])],
  // 9/09 1限 理 を休み(absent)。振替先は 9/10 4限(出席済み・statusSlots にある)= P-10。
  '2026-09-09_1': [withStatus([status('status-0909-absent', 's001', '理', 'regular', 'absent', '2026-09-09', 1), null])],
  // 9/10 3限 英 は通常授業を出席済みに。机2は s002 の 算。
  '2026-09-10_3': [
    withStatus([status('status-0910-attended', 's001', '英', 'regular', 'attended', '2026-09-10', 3), null]),
    withLesson('鈴木', [entry('s002', '算', 'regular'), null]),
  ],
  // 9/10 4限: 9/09 の振替(理)を出席済みにしたもの(studentSlots には無く statusSlots だけ)。
  '2026-09-10_4': [withStatus([status('status-0910-makeup-attended', 's001', '理', 'makeup', 'attended', '2026-09-10', 4, { makeupSourceDate: '2026-09-09', makeupSourceLabel: '2026/9/9(水) 1限' }), null])],
  // 9/11 2限 数 振無休。
  '2026-09-11_2': [withStatus([status('status-0911-anm', 's001', '数', 'regular', 'absent-no-makeup', '2026-09-11', 2), null])],
  // 9/12 1限: s002 通常 ＋ 机2に体験生(同名「青木 太郎」・managedStudentId なし) → 出さない。
  '2026-09-12_1': [
    withLesson('鈴木', [entry('s002', '算', 'regular'), null]),
    withLesson('田中', [{ id: 'trial-0912', name: '青木 太郎', grade: '中3', subject: '数', lessonType: 'trial', teacherType: 'normal' }, null]),
  ],
  // 9/12 3限: 増コマ(extra)。
  '2026-09-12_3': [withLesson('田中', [entry('s001', '数', 'extra', { manualAdded: true }), null])],
})

/** 週 9/14〜9/20(保存済み・Firestore 形 { cells })。 */
export const parentScheduleFixtureWeek0914: SlotCell[] = buildWeek('2026-09-14', {
  '2026-09-14_1': [withLesson('田中', [entry('s001', '数', 'regular'), entry('s003', '英', 'regular')])],
  // 9/14 2限 → 9/16 2限 へ移動した移動元マーカー(moved)。移動先は 9/16 2限 の通常配置として出る。
  '2026-09-14_2': [withStatus([status('status-0914-moved', 's001', '数', 'regular', 'moved', '2026-09-14', 2, { moveDestinationDateKey: '2026-09-16', moveDestinationSlotNumber: 2 }), null])],
  // 9/15 4限 英 休み → 振替先 9/20(日・forceOpen) 2限 に配置済み。
  '2026-09-15_4': [withStatus([status('status-0915-absent', 's001', '英', 'regular', 'absent', '2026-09-15', 4), null])],
  // 9/16 1限 理 休み → 振替先なし(調整中)。
  '2026-09-16_1': [withStatus([status('status-0916-absent', 's001', '理', 'regular', 'absent', '2026-09-16', 1), null])],
  '2026-09-16_2': [withLesson('田中', [entry('s001', '数', 'regular'), null])],
  '2026-09-17_3': [
    withLesson('田中', [entry('s001', '英', 'regular'), null]),
    withLesson('鈴木', [entry('s002', '算', 'regular'), null]),
  ],
  // 小5 に「数」で置かれた配置 → 表示は 算。
  '2026-09-19_1': [withLesson('鈴木', [entry('s002', '数', 'regular'), null])],
  '2026-09-20_2': [withLesson('田中', [entry('s001', '英', 'makeup', { makeupSourceDate: '2026-09-15', makeupSourceLabel: '2026/9/15(火) 4限' }), null])],
})

/** 週 9/28〜10/04(保存済み)。10/01〜 は講習期間。 */
export const parentScheduleFixtureWeek0928: SlotCell[] = buildWeek('2026-09-28', {
  '2026-09-28_1': [withLesson('田中', [entry('s001', '数', 'regular'), entry('s003', '英', 'regular')])],
  // 9/21(欠落週) 1限 数 からの振替 → 9/21 の テンプレ補完で 数 が湧かない(暗黙抑止)。
  '2026-09-29_5': [withLesson('田中', [entry('s001', '数', 'makeup', { makeupSourceDate: '2026-09-21', makeupSourceLabel: '2026/9/21(月) 1限' }), null])],
  '2026-09-30_1': [withLesson('田中', [entry('s001', '理', 'regular'), null])],
  // 講習期間外に置かれた講習コマ → 出さない。
  '2026-09-30_2': [withLesson('田中', [entry('s001', '数', 'special', { specialSessionId: 'ss-autumn' }), null])],
  // 講習期間内の通常配置と講習コマ → 日ごと「講習期間」で一律非表示(P-8)。
  '2026-10-01_3': [withBoth('田中', [entry('s001', '英', 'regular'), null], [null, status('status-1001-absent', 's001', '数', 'regular', 'absent', '2026-10-01', 3)])],
  '2026-10-02_1': [withLesson('田中', [entry('s001', '数', 'special', { specialSessionId: 'ss-autumn' }), null])],
})

export const parentScheduleFixtureBoardState: PersistedBoardState = {
  weeks: [
    parentScheduleFixtureWeek0907,
    // Firestore 保存形({ cells })。readStoredSnapshotPayload は配列に戻すが、権威関数は両方受ける。
    { cells: parentScheduleFixtureWeek0914 } as unknown as SlotCell[],
    parentScheduleFixtureWeek0928,
  ],
  weekIndex: 1,
  selectedCellId: '',
  selectedDeskIndex: 0,
  suppressedRegularLessonOccurrences: ['s001__英__2026-10-08__3', 'TEMPLATE_TEACHER__DAY__2026-10-06__0'],
  scheduleCountAdjustments: [],
  manualMakeupAdjustments: {},
  suppressedMakeupOrigins: {},
  fallbackMakeupStudents: {},
  manualLectureStockCounts: {},
  manualLectureStockOrigins: {},
  fallbackLectureStockStudents: {},
  isLectureStockOpen: false,
  isMakeupStockOpen: false,
  studentScheduleRange: null,
  teacherScheduleRange: null,
}

export const parentScheduleFixturePayload: AppSnapshotPayload = {
  screen: 'board',
  classroomSettings: parentScheduleFixtureClassroomSettings,
  managers: [],
  teachers: parentScheduleFixtureTeachers,
  students: parentScheduleFixtureStudents,
  regularLessons: parentScheduleFixtureRegularLessons,
  groupLessons: [],
  specialSessions: parentScheduleFixtureSpecialSessions,
  autoAssignRules: [],
  pairConstraints: [],
  boardState: parentScheduleFixtureBoardState,
}

/** JSON 往復で「サーバーが Firestore から読んだ unknown」を再現する(関数の参照共有・undefined フィールドを剥がす)。 */
export function cloneParentScheduleFixturePayload(): unknown {
  return JSON.parse(JSON.stringify(parentScheduleFixturePayload))
}
