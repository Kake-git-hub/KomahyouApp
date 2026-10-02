import { describe, expect, it } from 'vitest'
import type { SpecialSessionRow, SpecialSessionStudentInput } from '../special-data/specialSessionModel'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { LectureStockCountMap, ManualLectureStockOrigin } from '../../types/appState'
import {
  buildLectureStockEntries,
  buildLectureStockKey,
  buildLecturePendingItemsByEntryKey,
} from './lectureStock'
import { appendLectureStockCount, buildManagedScheduleCellsForRange, computePendingDeskResolution, computeTemplateDiffApplyForBoard, reconsumeSessionLectureStock, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey } from './templatePendingDesks'
import type { TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'

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

// ============================================================================
// INV-06（2026-09-29 拡張・Issue #72 第 1 段 (C)）: テンプレ差分反映の保留（2 行）の下段に講習がある場合。
//   docs/spec-template-behavior.md Q25-3・Q25-4・Q26-1・受け入れ条件 9・11・12。
//   - テンプレ保存そのものでは講習の残数が増減しない（講習の残数は提出希望数 ± デルタ台帳で決まり盤面を走査しない。
//     保存は台帳を触らない＝下段の講習は消化済みのまま）。在庫由来（session）・手動追加（manual）のどちらも。
//   - 「テンプレを採用」で下段の講習を捨てると、既存の削除と同じく**在庫由来だけ**未消化へ戻る（手動追加は戻さない）。
// ============================================================================

describe('INV-06 講習在庫: テンプレ差分反映の保留の下段（保存前後で不変・テンプレを採用で在庫由来だけ戻る）', () => {
  const AUTUMN_ID = 'sess_autumn'
  const DATE = '2026-10-07'
  const SLOT = 5
  const CELL_ID = `${DATE}_${SLOT}`
  const diffStudents: StudentRow[] = [student('sA', '青木 一'), student('sC', '千葉 三'), student('sM', '三浦 四'), student('sD', '土屋 五')]
  const diffTeachers: TeacherRow[] = [
    { id: 't1', name: '田中', email: 't1@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] },
    { id: 't2', name: '鈴木', email: 't2@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] },
  ]
  const autumnSessions: SpecialSessionRow[] = [{
    id: AUTUMN_ID, label: '2026 秋期講習', startDate: '2026-10-01', endDate: '2026-10-31',
    teacherInputs: {},
    studentInputs: { sM: studentInput({ subjectSlots: { 数: 2 } }) },
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }]
  const autumnRawEntries = buildLectureStockEntries({ specialSessions: autumnSessions, students: diffStudents })
  const SESSION_KEY = buildLectureStockKey('sM', '数', AUTUMN_ID)
  const MANUAL_KEY = buildLectureStockKey('sD', '数')

  function rowOf(id: string, teacherId: string, student1Id: string, student2Id = ''): RegularLessonRow {
    return {
      id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id, subject2: student2Id ? '数' : '',
      student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
    }
  }
  const settingsOf = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...extra }) as ClassroomSettings

  function lecture(studentId: 'sM' | 'sD'): StudentEntry {
    const source = diffStudents.find((item) => item.id === studentId)!
    return studentId === 'sM'
      ? { id: 'lec_sM', name: source.name, managedStudentId: 'sM', grade: '中3', subject: '数', lessonType: 'special', teacherType: 'normal', specialStockSource: 'session', specialSessionId: AUTUMN_ID }
      : { id: 'lec_sD', name: source.name, managedStudentId: 'sD', grade: '中3', subject: '数', lessonType: 'special', teacherType: 'normal', specialStockSource: 'manual', manualAdded: true }
  }

  function lectureBalances(ledgers: Pick<TemplatePendingResolutionLedgers, 'manualLectureStockCounts' | 'manualLectureStockOrigins'>) {
    const map = buildLecturePendingItemsByEntryKey({
      rawLectureStockEntries: autumnRawEntries,
      specialSessions: autumnSessions,
      manualLectureStockCounts: ledgers.manualLectureStockCounts,
      manualLectureStockOrigins: ledgers.manualLectureStockOrigins,
      fallbackLectureStockStudents: {},
    })
    const result: Record<string, number> = {}
    for (const entry of map.values()) result[entry.studentId ?? ''] = (result[entry.studentId ?? ''] ?? 0) + entry.pendingItems.length
    return result
  }

  // 机0 に在庫由来の講習 M（台帳 -1 で消化済み）と手動追加の講習 D（台帳 -1）。新テンプレは机0 に C → 保留（下段に M・D）。
  function pendingLectureBoard(options: { templateFillsBothSeats?: boolean } = {}) {
    let week: SlotCell[] = buildManagedScheduleCellsForRange({
      range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' },
      fallbackStartDate: '2026-10-05',
      fallbackEndDate: '2026-10-11',
      classroomSettings: settingsOf(),
      teachers: diffTeachers,
      students: diffStudents,
      regularLessons: [rowOf('r0', 't1', 'sA'), rowOf('r1', 't2', '')],
      boardWeeks: [],
    })
    week = week.map((cell) => (cell.id !== CELL_ID ? cell : {
      ...cell,
      desks: cell.desks.map((desk, index): DeskCell => (index === 0 ? { ...desk, lesson: { id: 'lectures', studentSlots: [lecture('sM'), lecture('sD')] } } : desk)),
    }))
    // テンプレは机0 の生徒 1・生徒 2 の両方を埋める（席ごとの突き合わせ〔2026-09-30〕で 2 つの講習がどちらも席でぶつかって下段へ入る形）。
    const newRows = options.templateFillsBothSeats === false
      ? [rowOf('r0', 't2', 'sC'), rowOf('r1', 't1', '')]
      : [rowOf('r0', 't2', 'sC', 'sA'), rowOf('r1', 't1', '')]
    const diff = computeTemplateDiffApplyForBoard({
      weeks: [week],
      classroomSettings: settingsOf({ templateFreezeBeforeDate: DATE }),
      teachers: diffTeachers,
      students: diffStudents,
      regularLessons: newRows,
      effectiveStartDate: DATE,
      suppressedRegularLessonOccurrences: [],
      templatePendingDesks: {},
      createdAt: '2026-09-29T10:00:00.000Z',
    })
    const deskId = diff.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[0].id
    const key = buildTemplatePendingDeskKey(CELL_ID, deskId)
    return { before: [week], diff, deskId, key }
  }

  const PLACED_LEDGERS: TemplatePendingResolutionLedgers = {
    // 在庫から置いた講習 M は -1（消化）。手動追加の講習 D は手動在庫 +1 → 配置で -1＝0 のキー。
    manualLectureStockCounts: { [SESSION_KEY]: -1, [MANUAL_KEY]: 0 },
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
  }

  it('保存前後: 在庫由来・手動追加の講習が下段に入っても、講習の残数は保存前と同じ（保存は台帳を触らない）', () => {
    const { diff, key } = pendingLectureBoard()
    // 前提: 2 つの講習はどちらも下段（盤面の週データの外）へ入り、上段はテンプレの C・A。
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.map((item) => item?.id)).toEqual(['lec_sM', 'lec_sD'])
    const upper = diff.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[0]
    expect(upper.lesson?.studentSlots.filter(Boolean).map((item) => item!.managedStudentId)).toEqual(['sC', 'sA'])
    // 差分反映の結果は台帳を持たない（在庫台帳に触る入口が無い）＝保存前後で台帳が同じなので残数も同じ。
    // wholeDayTransferCountAdjustments は Q35-8（2026-10-02）の希望回数 −1 の対象（台帳の書き換えではなく、保存が単発削除と同じ関数で積む判定結果）。
    expect(Object.keys(diff).sort()).toEqual(['addedSuppressedRegularLessonOccurrences', 'nextPendingDesks', 'nextWeeks', 'summary', 'wholeDayTransferCountAdjustments'])
    expect(diff.wholeDayTransferCountAdjustments).toEqual([])
    const before = lectureBalances(PLACED_LEDGERS)
    expect(before).toEqual({ sM: 1 })
    expect(lectureBalances(PLACED_LEDGERS)).toEqual(before)
  })

  it('テンプレを採用: 下段の在庫由来の講習 M だけ未消化へ戻り（残 +1）、手動追加の講習 D は戻らない', () => {
    const { diff, deskId, key } = pendingLectureBoard()
    const result = computePendingDeskResolution({
      mode: 'adopt-template',
      weeks: diff.nextWeeks,
      cellId: CELL_ID,
      deskId,
      templatePendingDesks: diff.nextPendingDesks,
      ledgers: PLACED_LEDGERS,
      managedStudentByAnyName: new Map(diffStudents.map((item) => [item.name, item])),
      resolveDisplayName: (name: string) => name,
      resolveStockId: (item: StudentEntry) => item.managedStudentId ?? item.name,
      ledgerOriginDatesByKey: {},
    })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.nextTemplatePendingDesks[key]).toBeUndefined()
    expect(result.returnedCount).toBe(1)
    expect(result.ledgers.manualLectureStockCounts[SESSION_KEY]).toBe(0)
    expect(result.ledgers.manualLectureStockCounts[MANUAL_KEY]).toBe(0)
    expect(lectureBalances(result.ledgers)).toEqual({ sM: 2 })
    // 希望回数は動かさない（テンプレを採用は下段を捨てるだけ・Q26-1）。
    expect(result.ledgers.scheduleCountAdjustments).toEqual([])
  })

  // 席ごとの突き合わせ（2026-09-30・Q34）: テンプレが生徒 1 の席だけのとき、生徒 2 の講習 D は 1 行に残り、ぶつかった生徒 1 の講習 M だけが下段へ入る。
  it('席ごと（テンプレは生徒 1 だけ）: 講習 D は上段に残り M だけ下段。保存は台帳を触らず、テンプレを採用は下段の在庫由来の M だけ戻す（D は上段のまま）', () => {
    const { diff, deskId, key } = pendingLectureBoard({ templateFillsBothSeats: false })
    expect(diff.nextPendingDesks[key].lower.lesson?.studentSlots.map((item) => item?.id ?? null)).toEqual(['lec_sM', null])
    const upper = () => diff.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[0]
    expect(upper().lesson?.studentSlots.map((item) => item?.managedStudentId ?? null)).toEqual(['sC', 'sD'])
    // wholeDayTransferCountAdjustments は Q35-8（2026-10-02）の希望回数 −1 の対象（台帳の書き換えではなく、保存が単発削除と同じ関数で積む判定結果）。
    expect(Object.keys(diff).sort()).toEqual(['addedSuppressedRegularLessonOccurrences', 'nextPendingDesks', 'nextWeeks', 'summary', 'wholeDayTransferCountAdjustments'])
    expect(diff.wholeDayTransferCountAdjustments).toEqual([])
    expect(lectureBalances(PLACED_LEDGERS)).toEqual({ sM: 1 })
    const result = computePendingDeskResolution({
      mode: 'adopt-template',
      weeks: diff.nextWeeks,
      cellId: CELL_ID,
      deskId,
      templatePendingDesks: diff.nextPendingDesks,
      ledgers: PLACED_LEDGERS,
      managedStudentByAnyName: new Map(diffStudents.map((item) => [item.name, item])),
      resolveDisplayName: (name: string) => name,
      resolveStockId: (item: StudentEntry) => item.managedStudentId ?? item.name,
      ledgerOriginDatesByKey: {},
    })
    if (result.status !== 'applied') throw new Error(result.message)
    expect(result.returnedCount).toBe(1)
    expect(result.ledgers.manualLectureStockCounts[SESSION_KEY]).toBe(0)
    expect(result.ledgers.manualLectureStockCounts[MANUAL_KEY]).toBe(0)
    expect(lectureBalances(result.ledgers)).toEqual({ sM: 2 })
    expect(result.nextWeeks[0].find((cell) => cell.id === CELL_ID)!.desks[0].lesson?.studentSlots.map((item) => item?.id ?? null)).toEqual([expect.any(String), 'lec_sD'])
  })
})
