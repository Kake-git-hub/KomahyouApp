// 振替ストック計算(buildMakeupStockEntries)のゴールデンスナップショット用 決定的データ。
//
// 開発ルール.md「振替ストックの計算・消化・再ストックが崩れないこと」を機械検知する。
// 既存 makeupStock.test.ts で実証済みのシナリオを 1 つの教室データに束ね、
// 複数生徒のストックが同時に正しく出ることを固定する。
//
// 意図的に含む回帰観点:
//   1. 未消化ストック   : 休日で潰れた通常授業が「残ストック(+)」として出る
//   2. 手動ストック消化 : 手動2件のうち1件を振替配置で消化 → 残り1件(再ストックの整合)
//   3. マイナス残       : 短縮された希望回数を通常+振替が上回る → 残数マイナス＋理由
//
// today は固定。weeks / regularLessons / manualAdjustments もすべて固定値。

import type { ClassroomSettings } from '../../../types/appState'
import type { StudentRow, TeacherRow } from '../../basic-data/basicDataModel'
import type { RegularLessonRow } from '../../basic-data/regularLessonModel'
import type { ManualMakeupOrigin } from '../makeupStock'
import type { SlotCell, StudentEntry } from '../types'

export const MAKEUP_TODAY = new Date('2026-04-30T00:00:00')

function student(id: string, name: string, birthDate: string, overrides: Partial<StudentRow> = {}): StudentRow {
  return { id, name, displayName: name.replace(/\s/g, ''), email: `${id}@example.com`, entryDate: '2024-04-01', withdrawDate: '未定', birthDate, ...overrides }
}

function teacher(id: string, name: string): TeacherRow {
  return { id, name, email: `${id}@example.com`, entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高3' }], availableSlots: [], memo: '' }
}

function regular(overrides: Partial<RegularLessonRow>): RegularLessonRow {
  return {
    id: 'r', schoolYear: 2026, teacherId: 't1', student1Id: '', subject1: '', startDate: '', endDate: '',
    student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1, ...overrides,
  }
}

function entry(overrides: Partial<StudentEntry>): StudentEntry {
  return { id: 'e', name: '', managedStudentId: '', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function cell(dateKey: string, slotNumber: number, desks: SlotCell['desks'], overrides: Partial<SlotCell> = {}): SlotCell {
  const [, m, d] = dateKey.split('-')
  return {
    id: `cell_${dateKey}_${slotNumber}`, dateKey, dayLabel: '月', dateLabel: `${Number(m)}/${Number(d)}`,
    slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '17:00-18:20', isOpenDay: true, desks, ...overrides,
  }
}

export const sampleMakeupTeachers: TeacherRow[] = [teacher('t1', '田中講師')]

export const sampleMakeupStudents: StudentRow[] = [
  student('s_short', '青木 太郎', '2010-05-14'), // 1. 未消化ストック
  student('s_manual', '伊藤 花', '2011-06-10'),  // 2. 手動ストック消化
  student('s_minus', '上田 陽介', '2009-07-22'),  // 3. マイナス残
]

export const sampleMakeupRegularLessons: RegularLessonRow[] = [
  // 1. s_short: 月曜1限・数。休日 2026-04-06 が潰れて残ストック(+)になる。
  regular({ id: 'r_short', teacherId: 't1', student1Id: 's_short', subject1: '数', dayOfWeek: 1, slotNumber: 1 }),
  // 3. s_minus: 火曜1限・数。希望回数を 2026-04-01〜04-14 に短縮 → 通常2回が上限。
  regular({ id: 'r_minus', teacherId: 't1', student1Id: 's_minus', subject1: '数', dayOfWeek: 2, slotNumber: 1, startDate: '2026-04-01', endDate: '2026-04-14' }),
]

// 手動調整ストック: s_manual に 2 件、s_short は休日由来(自動)なので無し。
export const sampleMakeupManualAdjustments: Record<string, ManualMakeupOrigin[]> = {
  's_manual__英': [
    { dateKey: '2026-04-07', slotNumber: 2, reasonLabel: '通常振替' },
    { dateKey: '2026-04-14', slotNumber: 3, reasonLabel: '通常振替' },
  ],
}

export const sampleMakeupWeeks: SlotCell[][] = [[
  // 2. s_manual: 4/7 の手動ストックを 4/21 に振替配置 → 消化。残るは 4/14 の1件。
  cell('2026-04-21', 1, [{
    id: 'd_manual', teacher: '田中講師',
    lesson: { id: 'placed_makeup_manual', studentSlots: [entry({ id: 'em', name: '伊藤花', managedStudentId: 's_manual', subject: '英', lessonType: 'makeup', makeupSourceDate: '2026-04-07', makeupSourceLabel: '4/7(月) 2限' }), null] },
  }]),
  // 3. s_minus: 通常2回(4/7・4/14) + 振替2回(4/15・4/16) = 4回配置 → 上限3を超過しマイナス。
  cell('2026-04-07', 1, [{ id: 'd1', teacher: '田中講師', lesson: { id: 'managed_r_minus_2026-04-07', studentSlots: [entry({ id: 'er1', name: '上田陽介', managedStudentId: 's_minus', subject: '数', lessonType: 'regular' }), null] } }]),
  cell('2026-04-14', 1, [{ id: 'd2', teacher: '田中講師', lesson: { id: 'managed_r_minus_2026-04-14', studentSlots: [entry({ id: 'er2', name: '上田陽介', managedStudentId: 's_minus', subject: '数', lessonType: 'regular' }), null] } }]),
  cell('2026-04-15', 2, [{ id: 'd3', teacher: '田中講師', lesson: { id: 'makeup_minus_1', studentSlots: [entry({ id: 'em1', name: '上田陽介', managedStudentId: 's_minus', subject: '数', lessonType: 'makeup' }), null] } }]),
  cell('2026-04-16', 3, [{ id: 'd4', teacher: '田中講師', lesson: { id: 'makeup_minus_2', studentSlots: [entry({ id: 'em2', name: '上田陽介', managedStudentId: 's_minus', subject: '数', lessonType: 'makeup' }), null] } }]),
]]

export const sampleMakeupClassroomSettings: ClassroomSettings = {
  closedWeekdays: [],
  holidayDates: ['2026-04-06'], // s_short の月曜1限が潰れる
  forceOpenDates: [],
  deskCount: 2,
}

export const resolveSampleStudentKey = (e: StudentEntry) => e.managedStudentId ?? e.id
