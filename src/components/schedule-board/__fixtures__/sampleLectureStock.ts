// 講習ストック(buildLectureStockEntries)のゴールデン用 決定的データ。
//
// 開発ルール.md「講習回数の警告スタンプが表の直下に出ること」「講習期間の反映」を機械検知する。
// buildLectureStockEntries は講習(特別講習セッション)の生徒入力から、
// 「集計提出済み・通常のみでない・回数>0」の科目別ストックを集計する純関数。
//
// 含む回帰観点(意図的な除外条件を網羅):
//   - 通常生徒: countSubmitted=true / regularOnly=false / 複数科目 → 各科目で entry
//   - countSubmitted=false の生徒 → 除外(未提出はストックにしない)
//   - regularOnly=true の生徒 → 除外(通常のみ希望は講習ストックにしない)
//   - subjectSlots に 0 回 → 除外(requestedCount>0 のみ)
//   - 複数セッション → セッションラベル順に整列

import type { StudentRow } from '../../basic-data/basicDataModel'
import type { SpecialSessionRow, SpecialSessionStudentInput } from '../../special-data/specialSessionModel'

// 学年ラベルの基準日(固定)。formatStudentSelectionLabel の既定は「今日」基準のため、
// 固定しないとゴールデンの表示名「(中3)」等が毎年4/1の年度替わりで自動的に落ちる。
// birthDate 2011-06-10 はこの基準日で中3(2018年度入学・学年番号9)。
export const lectureStockReferenceDate = '2026-07-01'

function student(id: string, name: string): StudentRow {
  return { id, name, displayName: name.replace(/\s/g, ''), email: `${id}@example.com`, entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-10' }
}

function studentInput(overrides: Partial<SpecialSessionStudentInput>): SpecialSessionStudentInput {
  return {
    unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false,
    countSubmitted: true, updatedAt: '2026-05-01T00:00:00.000Z', ...overrides,
  }
}

function session(id: string, label: string, studentInputs: Record<string, SpecialSessionStudentInput>): SpecialSessionRow {
  return {
    id, label, startDate: '2026-07-21', endDate: '2026-08-31',
    teacherInputs: {}, studentInputs, createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

export const lectureStudents: StudentRow[] = [
  student('s_a', '青木 太郎'),
  student('s_b', '伊藤 花'),
  student('s_c', '上田 陽介'),
  student('s_d', '岡本 美咲'),
]

export const lectureSpecialSessions: SpecialSessionRow[] = [
  session('sess_summer', '夏期講習', {
    // 提出済み・複数科目 → 数3 / 英2 の 2 entry
    s_a: studentInput({ subjectSlots: { 数: 3, 英: 2 } }),
    // 未提出 → 除外
    s_b: studentInput({ subjectSlots: { 数: 4 }, countSubmitted: false }),
    // 通常のみ → 除外
    s_c: studentInput({ subjectSlots: { 英: 2 }, regularOnly: true }),
    // 0 回科目は除外、国2 のみ残る
    s_d: studentInput({ subjectSlots: { 数: 0, 国: 2 } }),
  }),
  session('sess_winter', '冬期講習', {
    // 別セッションでも提出済みは集計。ラベル順で「冬期」は「夏期」の後(あ→… ja順)
    s_a: studentInput({ subjectSlots: { 数: 1 } }),
  }),
]
