// 日程表「通常授業 想定回数」(buildExpectedRegularOccurrences)のゴールデン用 決定的データ。
//
// 重要: buildExpectedRegularOccurrences は表示レンジではなく row の授業期間
// (空なら schoolYear 全体)で想定日を返す。そのため盤面用 sampleClassroom とは別に、
// row.startDate / row.endDate を 1 か月内へ明示的に束ねた専用 fixture を用意する。
// こうすることで「月途中開始/終了で残り週数分だけ」のルールを読みやすく固定できる。
//
// 含む回帰観点:
//   - フル稼働(6月の全月曜)
//   - 月途中開始(row.startDate=6/15 → 以降の水曜だけ)
//   - 月途中退塾(withdrawDate=6/15 → 退塾日以降の金曜は出ない)

import type { StudentRow } from '../../basic-data/basicDataModel'
import type { RegularLessonRow } from '../../basic-data/regularLessonModel'

export const OCC_RANGE_START = '2026-06-01'
export const OCC_RANGE_END = '2026-06-30'
const OCC_SCHOOL_YEAR = 2026

function student(id: string, name: string, birthDate: string, overrides: Partial<StudentRow> = {}): StudentRow {
  return { id, name, displayName: name.replace(/\s/g, ''), email: `${id}@example.com`, entryDate: '2024-04-01', withdrawDate: '未定', birthDate, ...overrides }
}

function regular(overrides: Partial<RegularLessonRow>): RegularLessonRow {
  return {
    id: 'r', schoolYear: OCC_SCHOOL_YEAR, teacherId: 't1', student1Id: '', subject1: '',
    // 既定で 6 月内に束ねる(想定日が学年度全体へ広がらないようにする)
    startDate: OCC_RANGE_START, endDate: OCC_RANGE_END,
    student2Id: '', subject2: '', student2StartDate: OCC_RANGE_START, student2EndDate: OCC_RANGE_END,
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1, ...overrides,
  }
}

export const occStudents: StudentRow[] = [
  student('s_full', '青木 太郎', '2010-05-14'),
  student('s_mid', '伊藤 花', '2011-06-10'),
  student('s_out', '上田 陽介', '2009-07-22', { withdrawDate: '2026-06-15' }),
]

export const occRegularLessons: RegularLessonRow[] = [
  // フル稼働: 月曜1限・数(6月の月曜=1,8,15,22,29)
  regular({ id: 'occ_full', student1Id: 's_full', subject1: '数', dayOfWeek: 1, slotNumber: 1 }),
  // 月途中開始: 水曜2限・英(6/15開始 → 17,24)
  regular({ id: 'occ_mid', student1Id: 's_mid', subject1: '英', dayOfWeek: 3, slotNumber: 2, startDate: '2026-06-15', student2StartDate: '2026-06-15' }),
  // 月途中退塾: 金曜1限・数(withdrawDate6/15 → 5,12のみ)
  regular({ id: 'occ_out', student1Id: 's_out', subject1: '数', dayOfWeek: 5, slotNumber: 1 }),
]
