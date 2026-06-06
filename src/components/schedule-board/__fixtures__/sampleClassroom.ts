// 決定的なゴールデンスナップショット用のサンプル教室データ。
//
// 目的: コマ配置(buildScheduleCellsForRange)の回帰を機械検知するための固定入力。
// ここは「実際の教室データの縮図」であり、回帰が起きやすい観点を意図的に含める:
//   - 月初から在籍するフル稼働の生徒(月4回)
//   - 月途中開始の通常授業(row.startDate が月の途中 → 残り週数分だけ配置)
//   - 月途中退塾の生徒(withdrawDate 以降は配置されない)
//   - 休日(holidayDates)でスキップされるコマ
//   - 1デスク2生徒(student1 + student2)
//   - 講師のみデスク(生徒なし)
//
// today に依存しないよう、レンジ・schoolYear・各日付はすべて固定値で与える。
// 仕様を意図的に変えたとき以外、ここを編集してはならない(編集するとスナップショットが
// ずれて回帰検知が無効になる)。

import type { ClassroomSettings, ScheduleRangePreference } from '../../../types/appState'
import type { StudentRow, TeacherRow } from '../../basic-data/basicDataModel'
import type { RegularLessonRow } from '../../basic-data/regularLessonModel'

// 2026 年度(2026-04 〜 2027-03)を運用年度とする固定スナップショット範囲。
// 2026-06 は 5 週(6/1 月 〜 6/30 火)を含み、回数ルールの検証に適する。
export const SAMPLE_RANGE_START = '2026-06-01'
export const SAMPLE_RANGE_END = '2026-06-30'
export const SAMPLE_SCHOOL_YEAR = 2026

export const sampleTeachers: TeacherRow[] = [
  {
    id: 't001',
    name: '田中講師',
    email: 'tanaka@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    isHidden: false,
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高3' }],
    availableSlots: [],
    memo: '',
  },
  {
    id: 't002',
    name: '佐藤講師',
    email: 'sato@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    isHidden: false,
    subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '数', maxGrade: '高3' }],
    availableSlots: [],
    memo: '',
  },
]

export const sampleStudents: StudentRow[] = [
  // フル稼働(月初から在籍)
  { id: 's_full', name: '青木 太郎', displayName: '青木太郎', email: 'aoki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-05-14', isHidden: false },
  // 月途中開始(通常授業 row.startDate で 6/15 から)
  { id: 's_mid', name: '伊藤 花', displayName: '伊藤花', email: 'ito@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-10', isHidden: false },
  // 月途中退塾(6/15 で退塾 → それ以降は配置されない)
  { id: 's_out', name: '上田 陽介', displayName: '上田陽介', email: 'ueda@example.com', entryDate: '2024-04-01', withdrawDate: '2026-06-15', birthDate: '2009-07-22', isHidden: false },
  // ペア授業の相手
  { id: 's_pair', name: '岡本 美咲', displayName: '岡本美咲', email: 'okamoto@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2008-09-18', isHidden: false },
]

function blankRegularLesson(): RegularLessonRow {
  return {
    id: '',
    schoolYear: SAMPLE_SCHOOL_YEAR,
    teacherId: '',
    student1Id: '',
    subject1: '',
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
    dayOfWeek: 1,
    slotNumber: 1,
  }
}

export const sampleRegularLessons: RegularLessonRow[] = [
  // 月曜1限: フル稼働の単独授業(6月の全月曜に配置されるはず)
  { ...blankRegularLesson(), id: 'r_full_mon', teacherId: 't001', student1Id: 's_full', subject1: '数', dayOfWeek: 1, slotNumber: 1 },
  // 水曜2限: 月途中開始(6/15 開始 → 6/17・6/24 のみ)＋ペア授業
  {
    ...blankRegularLesson(),
    id: 'r_mid_wed',
    teacherId: 't002',
    student1Id: 's_mid',
    subject1: '英',
    startDate: '2026-06-15',
    endDate: '',
    student2Id: 's_pair',
    subject2: '数',
    student2StartDate: '2026-06-15',
    dayOfWeek: 3,
    slotNumber: 2,
  },
  // 金曜1限: 月途中退塾の生徒(6/15 退塾 → 6/5・6/12 のみ、6/19・6/26 は出ない)
  { ...blankRegularLesson(), id: 'r_out_fri', teacherId: 't001', student1Id: 's_out', subject1: '数', dayOfWeek: 5, slotNumber: 1 },
  // 火曜3限: 講師のみデスク(生徒なし)
  { ...blankRegularLesson(), id: 'r_teacher_only_tue', teacherId: 't002', student1Id: '', subject1: '', dayOfWeek: 2, slotNumber: 3 },
]

export const sampleClassroomSettings: ClassroomSettings = {
  closedWeekdays: [0], // 日曜休講
  holidayDates: ['2026-06-08'], // 月曜の休日 → s_full の月曜1限が 1 回減る
  forceOpenDates: [],
  deskCount: 4,
}

export const sampleScheduleRange: ScheduleRangePreference = {
  startDate: SAMPLE_RANGE_START,
  endDate: SAMPLE_RANGE_END,
  periodValue: '',
}
