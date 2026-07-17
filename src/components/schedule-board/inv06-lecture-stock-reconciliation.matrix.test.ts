import { describe, expect, it } from 'vitest'
import type { SpecialSessionRow, SpecialSessionStudentInput } from '../special-data/specialSessionModel'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { LectureStockCountMap, ManualLectureStockOrigin } from '../../types/appState'
import {
  buildLectureStockEntries,
  buildLectureStockKey,
  buildLecturePendingItemsByEntryKey,
} from './lectureStock'
import { appendLectureStockCount, reconsumeSessionLectureStock } from './ScheduleBoardScreen'

// ============================================================================
// INV-06 操作マトリクステスト（保証: 在庫の実態一致＝未消化講習は盤面実配置と一致し、
//   明示操作なしに増減しない・消化済みが再出現しない）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習在庫は盤面実配置・提出の実態と一致し、明示操作なしに増減しない。
//   誤増（消化済みの再出現）も違反。
//
// 実発生（2026-07-17 / 緑が丘 犬飼凜 s028・夏期講習 数4回）:
//   自動割当＋日程表コマ組で数4コマを全配置済みなのに、未消化に数4回が幽霊表示（二重計上）。
//   真因: 欠席解除(handleClearStudentStatus) の session 講習相殺が removeLectureStockCount
//   （結果0以下でキー削除）を使い、負値=消化を記録するデルタ台帳 manualLectureStockCounts の
//   消化記録ごと消していた。
//   修正: 欠席解除は生徒を盤面へ再配置し直す操作なので、reconsumeSessionLectureStock
//   （appendLectureStockCount(-1)＝負値保持）で1回積み直す。handleMarkStudentAbsent の戻し(+1)と対称。
//
// ⚠️ テンプレ上書き(handleSaveRegularLessonTemplate 分岐C)は本関数へ統一しない（2026-07-17 INV監査）。
//   あちらは範囲一掃＋「盤面配置 + 未消化 = 提出希望数」の均衡復元で意味が異なり、-1 の純減を積むと
//   逆に未消化が過少計上になる。統一は新規回帰源のため禁止（ハンドラ側コメントで固定・Issue #48）。
//
// マトリクス:
//   欠席化(+1 戻し) ⇔ 欠席解除(-1 再消化) の往復対称性を、
//   台帳直値／未消化残数(buildLecturePendingItemsByEntryKey)の両面で固定する。
// ============================================================================

function student(id: string, name: string): StudentRow {
  return { id, name, displayName: name.replace(/\s/g, ''), email: `${id}@example.com`, entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-10' }
}

function studentInput(overrides: Partial<SpecialSessionStudentInput>): SpecialSessionStudentInput {
  return {
    unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false,
    countSubmitted: true, updatedAt: '2026-05-01T00:00:00.000Z', ...overrides,
  }
}

// 犬飼のケースを再現: 数4回・英7回の提出。数を全4コマ配置した状態を追う。
const SESSION_ID = 'sess_summer'
const students: StudentRow[] = [student('s028', '犬飼 凜')]
const specialSessions: SpecialSessionRow[] = [
  {
    id: SESSION_ID, label: '2026 夏期講習', startDate: '2026-07-21', endDate: '2026-08-31',
    teacherInputs: {},
    studentInputs: { s028: studentInput({ subjectSlots: { 数: 4, 英: 7 } }) },
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
]
const rawLectureStockEntries = buildLectureStockEntries({ specialSessions, students })
const MATH_KEY = buildLectureStockKey('s028', '数', SESSION_ID)

function pendingMathCount(manualLectureStockCounts: LectureStockCountMap, manualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]> = {}): number {
  const map = buildLecturePendingItemsByEntryKey({
    rawLectureStockEntries,
    specialSessions,
    manualLectureStockCounts,
    manualLectureStockOrigins,
    fallbackLectureStockStudents: {},
  })
  let count = 0
  for (const entry of map.values()) {
    if (entry.studentId !== 's028') continue
    for (const item of entry.pendingItems) {
      if (item.subject === '数') count += 1
    }
  }
  return count
}

// 欠席化と同じ戻し（handleMarkStudentAbsent 相当）。
function markAbsent(counts: LectureStockCountMap, origins: Record<string, ManualLectureStockOrigin[]>, dateKey: string, slot: number) {
  return {
    counts: appendLectureStockCount(counts, MATH_KEY),
    origins: { ...origins, [MATH_KEY]: [...(origins[MATH_KEY] ?? []), { displayName: '犬飼凜', sessionId: SESSION_ID, originDateKey: dateKey, originSlotNumber: slot }] },
  }
}

// 欠席解除と同じ再消化（handleClearStudentStatus / handleSaveRegularLessonTemplate 相当）。
function clearAbsence(counts: LectureStockCountMap, origins: Record<string, ManualLectureStockOrigin[]>, dateKey: string, slot: number) {
  const r = reconsumeSessionLectureStock({
    manualLectureStockCounts: counts,
    manualLectureStockOrigins: origins,
    stockKey: MATH_KEY,
    origin: { sessionId: SESSION_ID, originDateKey: dateKey, originSlotNumber: slot },
  })
  return { counts: r.nextManualLectureStockCounts, origins: r.nextManualLectureStockOrigins }
}

describe('INV-06 講習在庫の実態一致（欠席化⇔欠席解除の往復）', () => {
  it('自動割当で数4コマ配置後の台帳は -4・未消化は 0', () => {
    // 自動割当は appendLectureStockCount(-1) を4回積む
    let counts: LectureStockCountMap = {}
    for (let i = 0; i < 4; i += 1) counts = appendLectureStockCount(counts, MATH_KEY, -1)
    expect(counts[MATH_KEY]).toBe(-4)
    expect(pendingMathCount(counts)).toBe(0)
  })

  it('★回帰: 犬飼シナリオ — 4配置→2欠席→2解除で台帳 -4 のまま・未消化 0（二重計上しない）', () => {
    // removeLectureStockCount 誤用時は 2解除目で -1≤0 判定でキーが消え、未消化が 4 に戻る（本バグ）。
    let counts: LectureStockCountMap = {}
    let origins: Record<string, ManualLectureStockOrigin[]> = {}
    for (let i = 0; i < 4; i += 1) counts = appendLectureStockCount(counts, MATH_KEY, -1) // 自動割当4コマ
    expect(counts[MATH_KEY]).toBe(-4)

    ;({ counts, origins } = markAbsent(counts, origins, '2026-07-27', 5))
    ;({ counts, origins } = markAbsent(counts, origins, '2026-08-03', 5))
    expect(counts[MATH_KEY]).toBe(-2)
    expect(pendingMathCount(counts, origins)).toBe(2) // 欠席2コマ分は未消化に戻る＝正

    ;({ counts, origins } = clearAbsence(counts, origins, '2026-07-27', 5))
    ;({ counts, origins } = clearAbsence(counts, origins, '2026-08-03', 5))
    expect(counts[MATH_KEY]).toBe(-4) // 消化記録が消えていない
    expect(origins[MATH_KEY] ?? []).toHaveLength(0) // 戻したoriginも綺麗に相殺
    expect(pendingMathCount(counts, origins)).toBe(0) // 配置済み4コマが未消化に再出現しない
  })

  it('往復対称性: 欠席化→即解除は台帳・originを元へ完全に戻す', () => {
    const baseCounts: LectureStockCountMap = { [MATH_KEY]: -4 }
    let counts = baseCounts
    let origins: Record<string, ManualLectureStockOrigin[]> = {}
    ;({ counts, origins } = markAbsent(counts, origins, '2026-07-27', 5))
    ;({ counts, origins } = clearAbsence(counts, origins, '2026-07-27', 5))
    expect(counts[MATH_KEY]).toBe(-4)
    expect(origins[MATH_KEY] ?? []).toHaveLength(0)
  })

  it('reconsumeSessionLectureStock は 0以下でもキーを削除せず負値を保持する（removeLectureStockCount との差）', () => {
    // -1 と 0 の境界: どちらも削除してはいけない。
    const fromNegative = reconsumeSessionLectureStock({ manualLectureStockCounts: { [MATH_KEY]: 0 }, manualLectureStockOrigins: {}, stockKey: MATH_KEY })
    expect(fromNegative.nextManualLectureStockCounts[MATH_KEY]).toBe(-1)
    const keyless = reconsumeSessionLectureStock({ manualLectureStockCounts: {}, manualLectureStockOrigins: {}, stockKey: MATH_KEY })
    expect(keyless.nextManualLectureStockCounts[MATH_KEY]).toBe(-1)
  })
})
