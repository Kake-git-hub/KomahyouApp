import { describe, expect, it } from 'vitest'
import type { DeskCell, StudentEntry, StudentStatusEntry, SubjectLabel } from './types'
import type { StudentRow } from '../basic-data/basicDataModel'
import {
  reconcileHolidayDeskStockReturns,
  resolveLectureStockStudentKey,
} from './ScheduleBoardScreen'
import { buildLectureStockKey } from './lectureStock'

// ============================================================================
// INV-06 操作マトリクス（休日化 handleToggleHolidayDate の在庫会計）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習・振替在庫は盤面実配置と一致し、明示操作なしに増減しない。誤増（消化済みの再出現）も違反。
//
// 対象バグ:
//  - Issue #49（確実・s2）: 「その日を休日に設定」の statusSlots ループが出欠種別を見ず無条件に在庫へ +1/
//    origin 追加していた。欠席（既に在庫へ戻し済み）を休日化すると二重計上、出席/振替なし/移動でも誤返却。
//    → statusSlots は在庫会計確定済みなので触らない。studentSlots(未出欠の配置)だけ在庫へ戻す。
//  - 改名（rename）: 配置(-1)は提出データの studentId で消化し、配置コマの managedStudentId にその id を焼き込む。
//    戻す側が名前逆引き(managedStudentByAnyName.get(name))だけに頼ると、配置後に基本データで改名された生徒で
//    逆引きが外れ `name:表示名` に落ち、配置と戻しのキーがズレる。resolveLectureStockStudentKey は
//    managedStudentId を最優先し正準キーを回復する。
// ============================================================================

const resolveDisplayName = (name: string) => name
const resolveStockId = (student: StudentEntry, roster: Map<string, StudentRow>) =>
  student.managedStudentId ?? roster.get(student.name)?.id ?? `name:${student.name}`

function makeRoster(entries: Array<[string, string]>): Map<string, StudentRow> {
  return new Map(entries.map(([name, id]) => [name, { id, name } as StudentRow]))
}

function emptyLedgers() {
  return {
    manualLectureStockCounts: {} as Record<string, number>,
    manualLectureStockOrigins: {} as Record<string, never[]>,
    manualMakeupAdjustments: {} as Record<string, never[]>,
    fallbackLectureStockStudents: {} as Record<string, { displayName: string; subject?: string }>,
    fallbackMakeupStudents: {} as Record<string, { studentName: string; displayName: string; subject: string }>,
  }
}

function sessionLesson(student: Partial<StudentEntry> & { name: string; subject: SubjectLabel }): StudentEntry {
  return {
    id: `entry_${student.name}`,
    grade: '中2',
    teacherType: 'normal',
    lessonType: 'special',
    specialStockSource: 'session',
    ...student,
  } as StudentEntry
}

function absentSessionStatus(entry: Partial<StudentStatusEntry> & { name: string; subject: SubjectLabel }): StudentStatusEntry {
  return {
    id: `status_${entry.name}`,
    studentId: entry.managedStudentId ?? entry.name,
    sourceManagedLesson: true,
    grade: '中2',
    teacherType: 'normal',
    teacherName: '講師',
    dateKey: '2026-08-01',
    slotNumber: 5,
    recordedAt: '2026-07-20T00:00:00.000Z',
    status: 'absent',
    sourceLessonId: 'src',
    lessonType: 'special',
    specialStockSource: 'session',
    ...entry,
  } as StudentStatusEntry
}

function desk(params: { lesson?: [StudentEntry | null, StudentEntry | null]; statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null] }): DeskCell {
  return {
    id: 'desk_1',
    teacher: '講師',
    ...(params.lesson ? { lesson: { id: 'l1', studentSlots: params.lesson } } : {}),
    ...(params.statusSlots ? { statusSlots: params.statusSlots } : {}),
  }
}

function run(deskCell: DeskCell, roster: Map<string, StudentRow>, ledgers = emptyLedgers()) {
  return reconcileHolidayDeskStockReturns({
    desk: deskCell,
    cellDateKey: '2026-08-01',
    cellSlotNumber: 5,
    ledgers,
    managedStudentByAnyName: roster,
    resolveDisplayName,
    resolveStockId: (student) => resolveStockId(student, roster),
  })
}

describe('INV-06 休日化の在庫会計', () => {
  const roster = makeRoster([['犬飼 凜', 's028']])
  const mathKey = buildLectureStockKey('s028', '数', 'sess')

  it('★Issue #49: 欠席済み(statusSlots)の講習を休日化しても在庫へ再+1しない(二重計上しない)', () => {
    // 配置(-1)→欠席(+1)済みで台帳は 0（在庫に1件戻っている状態）。休日化で更に +1 されると二重計上=違反。
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: 0 } }
    const d = desk({ statusSlots: [absentSessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0) // ★+1 されない
    expect(result.movedStudentCount).toBe(0) // statusSlots は「ストックへ移した件数」に数えない
  })

  it('★Issue #49: 欠席済み(statusSlots)の通常授業を休日化しても振替 origin を二重追加しない', () => {
    const d = desk({ statusSlots: [{ ...absentSessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: undefined }), lessonType: 'regular', specialStockSource: undefined } as StudentStatusEntry, null] })
    const result = run(d, roster)
    expect(Object.keys(result.ledgers.manualMakeupAdjustments)).toHaveLength(0) // 振替 origin を積まない
    expect(result.movedStudentCount).toBe(0)
  })

  it('配置(studentSlots)の講習は休日化で在庫へ +1 戻す（正常経路の非回帰）', () => {
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } } // 配置で -1 済み
    const d = desk({ lesson: [sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0) // -1 → +1 で 0（在庫へ戻る）
    expect(result.movedStudentCount).toBe(1)
  })

  it('配置(studentSlots)の通常授業は休日化で振替 origin を追加する（正常経路の非回帰）', () => {
    const d = desk({ lesson: [sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: undefined, lessonType: 'regular', specialStockSource: undefined }), null] })
    const result = run(d, roster)
    const makeupKey = Object.keys(result.ledgers.manualMakeupAdjustments)
    expect(makeupKey.length).toBe(1)
    expect(result.movedStudentCount).toBe(1)
  })

  it('★改名: 配置後に改名(名簿逆引き不可)でも managedStudentId で配置と同じ正準キーに戻す', () => {
    // 名簿は新名しか持たない。盤面コマは旧名を保持し managedStudentId='s028'。
    const renamedRoster = makeRoster([['犬飼 凛(新)', 's028']])
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } } // 配置は s028 キーで -1 済み
    const d = desk({ lesson: [sessionLesson({ name: '犬飼 凜(旧)', managedStudentId: 's028', subject: '数', specialSessionId: 'sess' }), null] })
    const result = run(d, renamedRoster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0) // 正準キーへ +1 → 0
    // 旧実装(名前逆引き)なら name:旧名 キーへ +1 され、正準キーは -1 のまま + 幽霊が増える
    const ghostKey = buildLectureStockKey('name:犬飼 凜(旧)', '数', 'sess')
    expect(result.ledgers.manualLectureStockCounts[ghostKey]).toBeUndefined()
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0)
  })
})

describe('resolveLectureStockStudentKey（在庫キーの正準化）', () => {
  it('managedStudentId を最優先で使う（改名で名簿逆引きが外れても不変）', () => {
    const roster = makeRoster([['新名', 's028']])
    expect(resolveLectureStockStudentKey({ managedStudentId: 's028', name: '旧名' }, roster, resolveDisplayName)).toBe('s028')
  })

  it('managedStudentId が無ければ名簿逆引き→ name: フォールバック', () => {
    const roster = makeRoster([['在籍名', 's099']])
    expect(resolveLectureStockStudentKey({ name: '在籍名' }, roster, resolveDisplayName)).toBe('s099')
    expect(resolveLectureStockStudentKey({ name: '不在名' }, roster, resolveDisplayName)).toBe('name:不在名')
  })
})
