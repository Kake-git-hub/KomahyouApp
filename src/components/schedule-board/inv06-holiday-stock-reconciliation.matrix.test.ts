import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry, SubjectLabel } from './types'
import type { StudentRow } from '../basic-data/basicDataModel'
import {
  reconcileHolidayDeskStockReturns,
  resolveLectureStockStudentKey,
} from './ScheduleBoardScreen'
import { buildLectureStockKey } from './lectureStock'
import { buildMakeupStockEntries, buildMakeupStockKey, computeAutomaticShortageOrigins, createBoardStudentStockIdResolver } from './makeupStock'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'

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

function sessionStatus(entry: Partial<StudentStatusEntry> & { name: string; subject: SubjectLabel; status: StudentStatusEntry['status'] }): StudentStatusEntry {
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
    // 本セットは講習/通常の status 会計を見る列。振替コマの休みを台帳へ確定させる列（下流監査）は
    // inv06-makeup-absence-stock.matrix.test.ts 側にあるため、ここでは台帳なし（＝空）で回す。
    ledgerOriginDatesByKey: {},
  })
}

describe('INV-06 休日化の在庫会計', () => {
  const roster = makeRoster([['犬飼 凜', 's028']])
  const mathKey = buildLectureStockKey('s028', '数', 'sess')

  it('★Issue #49: 欠席(absent)の講習を休日化しても在庫へ再+1しない(二重計上しない)', () => {
    // 配置(-1)→欠席(+1・mark-absentが実施)済みで台帳は 0（在庫に1件戻っている状態）。休日化で更に +1 されると二重計上=違反。
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: 0 } }
    const d = desk({ statusSlots: [sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', status: 'absent' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0) // ★+1 されない
    expect(result.movedStudentCount).toBe(0)
  })

  it('★Issue #49: 欠席(absent)の通常授業を休日化しても振替 origin を二重追加しない', () => {
    const d = desk({ statusSlots: [{ ...sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: undefined, status: 'absent' }), lessonType: 'regular', specialStockSource: undefined } as StudentStatusEntry, null] })
    const result = run(d, roster)
    expect(Object.keys(result.ledgers.manualMakeupAdjustments)).toHaveLength(0) // 振替 origin を積まない
    expect(result.movedStudentCount).toBe(0)
  })

  it('移動済み(moved)の講習を休日化しても在庫を触らない(消化は移動先が保持)', () => {
    // moved マーカーは会計を持たない。移動先の -1 を表す台帳は不変であるべき。
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } }
    const d = desk({ statusSlots: [sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', status: 'moved' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(-1) // 不変
    expect(result.movedStudentCount).toBe(0)
  })

  it('★出席(attended)の講習を休日化したら在庫へ +1 戻す(消化-1を孤児化させない=過少計上を防ぐ)', () => {
    // mark-attended は在庫を触らないため配置の -1 が残る。休日で授業が消えるので +1 戻して均衡復帰させる。
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } }
    const d = desk({ statusSlots: [sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', status: 'attended' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0) // -1 → +1 で 0（提出希望数に復帰）
    expect(result.movedStudentCount).toBe(1)
  })

  it('★振替なし欠席(absent-no-makeup)の講習を休日化したら在庫へ +1 戻す(過少計上を防ぐ)', () => {
    // mark-absent-no-makeup も在庫を触らないため -1 が残る。休日で授業が消えるので戻す。
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } }
    const d = desk({ statusSlots: [sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', status: 'absent-no-makeup' }), null] })
    const result = run(d, roster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0)
    expect(result.movedStudentCount).toBe(1)
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

describe('INV-06 休日化の振替(regular)会計と端ケース', () => {
  const roster = makeRoster([['犬飼 凜', 's028']])
  const makeupKey = buildMakeupStockKey('s028', '数')

  function regularStatus(status: StudentStatusEntry['status']): StudentStatusEntry {
    return { ...sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', status }), lessonType: 'regular', specialStockSource: undefined } as StudentStatusEntry
  }

  it('出席(attended)の通常授業を休日化したら当日 dateKey で振替 origin を1件積む', () => {
    const result = run(desk({ statusSlots: [regularStatus('attended'), null] }), roster)
    expect(result.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: '2026-08-01' }])
    expect(result.movedStudentCount).toBe(1)
  })

  it('振替なし欠席(absent-no-makeup)の通常授業も休日化で振替 origin を積む', () => {
    const result = run(desk({ statusSlots: [regularStatus('absent-no-makeup'), null] }), roster)
    expect(result.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: '2026-08-01' }])
  })

  it('欠席(absent)/移動(moved)の通常授業は休日化で振替 origin を積まない(二重防止)', () => {
    expect(Object.keys(run(desk({ statusSlots: [regularStatus('absent'), null] }), roster).ledgers.manualMakeupAdjustments)).toHaveLength(0)
    expect(Object.keys(run(desk({ statusSlots: [regularStatus('moved'), null] }), roster).ledgers.manualMakeupAdjustments)).toHaveLength(0)
  })

  it('配置(studentSlots)の通常授業は元授業日(makeupSourceDate)で origin を積む(statusSlots の当日と区別)', () => {
    const student = { ...sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数' }), lessonType: 'regular', specialStockSource: undefined, makeupSourceDate: '2026-07-25' } as StudentEntry
    const result = run(desk({ lesson: [student, null] }), roster)
    expect(result.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: '2026-07-25' }]) // 当日(2026-08-01)ではない
  })

  it('同一 index に配置(B)と出席status(A)が併存する机は両方を在庫へ戻す(dedup廃止・孤児化させない)', () => {
    const roster2 = makeRoster([['B太', 's028'], ['A子', 's099']])
    const bKey = buildLectureStockKey('s028', '数', 'sess')
    const aKey = buildLectureStockKey('s099', '英', 'sess')
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [bKey]: -1, [aKey]: -1 } }
    const d: DeskCell = {
      id: 'd', teacher: 't',
      lesson: { id: 'l', studentSlots: [sessionLesson({ name: 'B太', managedStudentId: 's028', subject: '数', specialSessionId: 'sess' }), null] },
      statusSlots: [sessionStatus({ name: 'A子', managedStudentId: 's099', subject: '英', specialSessionId: 'sess', status: 'attended' }), null],
    }
    const result = run(d, roster2, ledgers)
    expect(result.ledgers.manualLectureStockCounts[bKey]).toBe(0) // 配置 B を戻す
    expect(result.ledgers.manualLectureStockCounts[aKey]).toBe(0) // 出席 A も戻す(消化-1を孤児化させない)
    expect(result.movedStudentCount).toBe(2)
  })

  it('改名 × statusSlots(attended session): managedStudentId で配置と同じ正準キーへ +1', () => {
    const renamedRoster = makeRoster([['犬飼 凛(新)', 's028']])
    const mathKey = buildLectureStockKey('s028', '数', 'sess')
    const ledgers = { ...emptyLedgers(), manualLectureStockCounts: { [mathKey]: -1 } }
    const d = desk({ statusSlots: [sessionStatus({ name: '犬飼 凜(旧)', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', status: 'attended' }), null] })
    const result = run(d, renamedRoster, ledgers)
    expect(result.ledgers.manualLectureStockCounts[mathKey]).toBe(0)
    expect(result.ledgers.manualLectureStockCounts[buildLectureStockKey('name:犬飼 凜(旧)', '数', 'sess')]).toBeUndefined()
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

// ============================================================================
// 行: 退塾日 × 休日(自動の振替の元 computeAutomaticShortageOrigins)
//   オーナー決定 2026-09-15(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。
//   休日の通常授業から自動で生まれる振替の元は在籍判定(isActiveOnDate)に従うため、
//   退塾日の前日までの休日には元が生まれ、退塾日当日(以降)の休日には生まれない。
//   旧定義(当日在籍)では退塾日当日の休日にも 1 件生まれていた＝新しい定義として受け入れた在庫の差(INV-06)。
// ============================================================================
describe('INV-06 退塾日 × 休日の自動振替元(前日=生まれる/当日=生まれない)', () => {
  const HOLIDAY = '2025-04-07' // 月曜
  const lesson: RegularLessonRow = {
    id: 'regular-1', schoolYear: 2025, teacherId: 't1', student1Id: 's028', subject1: '数', startDate: '', endDate: '',
    student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '',
    dayOfWeek: 1, slotNumber: 1,
  }
  const settings: ClassroomSettings = { closedWeekdays: [], holidayDates: [HOLIDAY], forceOpenDates: [], deskCount: 1 }
  const originsFor = (withdrawDate: string) => computeAutomaticShortageOrigins(
    [lesson],
    [{ id: 's028', name: '犬飼 凜', displayName: '犬飼', email: '', entryDate: '2025-04-01', withdrawDate, birthDate: '2012-05-01' }],
    settings,
    new Date('2025-04-10T00:00:00'),
  ).origins

  it('退塾日が休日の翌日(=休日は在籍最終日)なら、その休日の振替元が 1 件生まれる', () => {
    expect(originsFor('2025-04-08')).toEqual({ [buildMakeupStockKey('s028', '数')]: [`${HOLIDAY}#1`] })
  })

  it('退塾日が休日当日なら、その休日の振替元は生まれない(当日から非在籍)', () => {
    expect(originsFor(HOLIDAY)).toEqual({})
  })

  it('退塾日が休日より前でも生まれない', () => {
    expect(originsFor('2025-04-06')).toEqual({})
  })
})

// ============================================================================
// 行: 休日設定 × 手動追加（2026-10-07 オーナー確定・Issue #73・spec-makeup-stock §B-2-2b の表「手動追加」行の分割）
//   日大前校の質問「10/12 を休日設定にしたが、未消化振替に入っている生徒と入っていない生徒がいる」。入っていない生徒は
//   曜日変更を「旧曜日の通常授業を削除＋新曜日に手動追加」で運用していた＝手動追加は在庫を経由していないので返さない仕様だった。
//   §B-3「休み」は手動追加でも返す（日程表の実績カウントは manualAdded を除外しないので、返さないと 1 コマ消える）。同じ根拠が
//   休日設定にも成り立つので、休日設定（includeManualAddedLessons:true）では手動追加の通常・増コマ・振替を未消化振替へ、
//   手動追加の講習を未消化講習へ返す。全コマ削除・丸ごと振替・テンプレ保留の採用（フラグ省略＝false）は従来どおり返さない
//   （通常授業すら返さない操作。希望回数 −1 の挙動も不変）。体験（trial）は休日設定でも返さない。
// ============================================================================
describe('INV-06 休日化 × 手動追加（休日設定では返す／全コマ削除では返さない・Issue #73）', () => {
  const roster = makeRoster([['犬飼 凜', 's028']])
  const makeupKey = buildMakeupStockKey('s028', '数')
  const lectureKey = buildLectureStockKey('s028', '数', 'sess')
  const DATE = '2026-08-01'

  function manualLesson(overrides: Partial<StudentEntry> = {}): StudentEntry {
    return {
      ...sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数' }),
      lessonType: 'regular', specialStockSource: undefined, specialSessionId: undefined, manualAdded: true,
      ...overrides,
    } as StudentEntry
  }
  function manualStatus(status: StudentStatusEntry['status'], overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
    return {
      ...sessionStatus({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', status }),
      lessonType: 'regular', specialStockSource: undefined, specialSessionId: undefined, manualAdded: true,
      ...overrides,
    } as StudentStatusEntry
  }
  function manualLecture(overrides: Partial<StudentEntry> = {}): StudentEntry {
    return sessionLesson({ id: 'manual_lecture', name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', specialStockSource: 'manual', manualAdded: true, ...overrides })
  }
  function runHoliday(
    deskCell: DeskCell,
    ledgers = emptyLedgers(),
    options: { includeManualAddedLessons?: boolean; includeRegularLessons?: boolean; cellSlotNumber?: number; resolveStockId?: (student: StudentEntry) => string } = { includeManualAddedLessons: true },
  ) {
    const { cellSlotNumber = 5, resolveStockId: resolveStockIdOverride, ...flags } = options
    return reconcileHolidayDeskStockReturns({
      desk: deskCell,
      cellDateKey: DATE,
      cellSlotNumber,
      ledgers,
      managedStudentByAnyName: roster,
      resolveDisplayName,
      resolveStockId: resolveStockIdOverride ?? ((student) => resolveStockId(student, roster)),
      ledgerOriginDatesByKey: {},
      ...flags,
    })
  }

  it('★T-1 配置の手動追加 通常(regular): 休日設定では当日 origin を 1 件積み、返した id と控え kind:makeup を返す', () => {
    const entry = manualLesson()
    const result = runHoliday(desk({ lesson: [entry, null] }))
    // ★手動追加は時限つき(日付#限)で積む(regression-reviewer M-1): 時限なしだと同じ日のテンプレ授業の自動 origin や同じ日の 2 件と畳まれて 1 件になる。
    expect(result.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: DATE, slotNumber: 5 }])
    expect(result.returnedEntryIds).toEqual([entry.id])
    expect(result.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: false })
    expect(result.movedStudentCount).toBe(1)
  })

  it('★T-2 出席(attended)／振無休(absent-no-makeup)の手動追加 通常も当日 origin を積む。休み(absent)は積まない(mark-absent 済み)', () => {
    for (const status of ['attended', 'absent-no-makeup'] as const) {
      const record = manualStatus(status)
      const result = runHoliday(desk({ statusSlots: [record, null] }))
      expect(result.ledgers.manualMakeupAdjustments[makeupKey], status).toEqual([{ dateKey: DATE, slotNumber: 5 }])
      expect(result.returnedEntryIds, status).toEqual([record.id])
      expect(result.stockReturnStamps.statusStamps[0], status).toEqual({ kind: 'makeup', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: false })
    }
    for (const status of ['absent', 'moved'] as const) {
      const result = runHoliday(desk({ statusSlots: [manualStatus(status), null] }))
      expect(Object.keys(result.ledgers.manualMakeupAdjustments), status).toHaveLength(0)
      expect(result.returnedEntryIds, status).toEqual([])
      expect(result.stockReturnStamps.statusStamps[0], status).toBeUndefined()
      expect(result.movedStudentCount, status).toBe(0)
    }
  })

  it('★T-3 手動追加の振替(makeupSourceDate 無し)・増コマは当日 origin。体験(trial)は休日設定でも返さない(kind:none)', () => {
    const makeupResult = runHoliday(desk({ lesson: [manualLesson({ id: 'manual_makeup', lessonType: 'makeup' }), null] }))
    expect(makeupResult.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: DATE, slotNumber: 5 }])
    expect(makeupResult.returnedEntryIds).toEqual(['manual_makeup'])
    expect(makeupResult.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: false })

    const extraResult = runHoliday(desk({ lesson: [manualLesson({ id: 'manual_extra', lessonType: 'extra' }), null] }))
    expect(extraResult.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: DATE, slotNumber: 5 }])
    expect(extraResult.returnedEntryIds).toEqual(['manual_extra'])

    // 体験は manualAdded:true で作られるが、振替の概念が無い(休みボタンも無い)。フラグを広げても巻き込まない。
    const trialResult = runHoliday(desk({ lesson: [manualLesson({ id: 'manual_trial', lessonType: 'trial', managedStudentId: undefined, name: '体験生' }), null] }))
    expect(Object.keys(trialResult.ledgers.manualMakeupAdjustments)).toHaveLength(0)
    expect(trialResult.ledgers.fallbackMakeupStudents).toEqual({})
    expect(trialResult.returnedEntryIds).toEqual([])
    expect(trialResult.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'none' })
  })

  it('T-3b 手動追加の通常を別日へ動かした振替(makeupSourceDate あり)は振替元日で積む(配置の通常授業と同じ規則・当日ではない)', () => {
    const moved = manualLesson({ id: 'manual_moved', lessonType: 'makeup', makeupSourceDate: '2026-07-25', makeupSourceLabel: '2026/7/25(土) 5限' })
    const result = runHoliday(desk({ lesson: [moved, null] }))
    expect(result.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: '2026-07-25', slotNumber: 5 }])
    expect(result.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: '2026-07-25', originSlotNumber: 5, fallbackAdded: false })
  })

  it('★T-4 同じ生徒×科目でテンプレの通常授業(1限)と手動追加(3限)が同じ日に並ぶ: origin は 2 件(テンプレ=時限なし・手動追加=時限つき)', () => {
    const template = { ...sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: undefined }), id: 'template_entry', lessonType: 'regular', specialStockSource: undefined } as StudentEntry
    const first = runHoliday(desk({ lesson: [template, null] }), emptyLedgers(), { includeManualAddedLessons: true, cellSlotNumber: 1 })
    const second = runHoliday(desk({ lesson: [manualLesson({ id: 'manual_entry' }), null] }), first.ledgers as ReturnType<typeof emptyLedgers>, { includeManualAddedLessons: true, cellSlotNumber: 3 })
    expect(second.ledgers.manualMakeupAdjustments[makeupKey]).toEqual([{ dateKey: DATE }, { dateKey: DATE, slotNumber: 3 }])
    expect([...first.returnedEntryIds, ...second.returnedEntryIds]).toEqual(['template_entry', 'manual_entry'])
    expect(first.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: DATE, fallbackAdded: false })
    expect(second.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: DATE, originSlotNumber: 3, fallbackAdded: false })
  })

  // ★T-4b(regression-reviewer M-1): 台帳の件数ではなく**実際の残数**(buildMakeupStockEntries)で 2 件になることを固定する。
  //   時限なしの origin は resolveEffectiveMakeupOriginDates で同じ日付の時限つき origin(テンプレ授業の自動 origin `D#1`)に畳まれ、
  //   同じ日の時限なし 2 件も Set で 1 件になる。手動追加を時限なしで積むと、どちらの構成でも残 1 になり #73 と同じ「入らない」が再発する。
  describe('★T-4b 実際の残数(buildMakeupStockEntries)', () => {
    const HOLIDAY = '2025-04-07' // 月曜
    const students = [{ id: 's028', name: '犬飼 凜', displayName: '犬飼', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2012-05-01' }] as unknown as StudentRow[]
    const templateRow: RegularLessonRow = {
      id: 'regular-1', schoolYear: 2025, teacherId: 't1', student1Id: 's028', subject1: '数', startDate: '', endDate: '',
      student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '',
      dayOfWeek: 1, slotNumber: 1,
    }
    const settings: ClassroomSettings = { closedWeekdays: [], holidayDates: [HOLIDAY], forceOpenDates: [], deskCount: 1 }
    const holidayRoster = makeRoster([['犬飼 凜', 's028']])
    const resolveHolidayStockId = (student: StudentEntry) => resolveStockId(student, holidayRoster)
    const stockKey = buildMakeupStockKey('s028', '数')

    function holidayCell(slotNumber: number, lesson: StudentEntry | null): SlotCell {
      return {
        id: `${HOLIDAY}_${slotNumber}`, dateKey: HOLIDAY, dayLabel: '月', dateLabel: '4/7', slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true,
        desks: [{ id: `desk_${slotNumber}`, teacher: '講師', ...(lesson ? { lesson: { id: `lesson_${slotNumber}`, studentSlots: [lesson, null] as [StudentEntry | null, StudentEntry | null] } } : {}) }],
      }
    }
    // 休日設定ハンドラと同じ順序で 1 日分を休日にする(在庫戻し → 机の中身を破棄)。
    function setHoliday(cells: SlotCell[]) {
      let ledgers = emptyLedgers() as Parameters<typeof reconcileHolidayDeskStockReturns>[0]['ledgers']
      for (const cell of cells) {
        for (const d of cell.desks) {
          const result = reconcileHolidayDeskStockReturns({
            desk: d, cellDateKey: cell.dateKey, cellSlotNumber: cell.slotNumber, ledgers,
            managedStudentByAnyName: holidayRoster, resolveDisplayName, resolveStockId: resolveHolidayStockId,
            ledgerOriginDatesByKey: {}, includeManualAddedLessons: true,
          })
          ledgers = result.ledgers
          d.lesson = undefined
        }
      }
      return ledgers
    }
    function remaining(cells: SlotCell[], regularLessons: RegularLessonRow[]) {
      const ledgers = setHoliday(cells)
      const entries = buildMakeupStockEntries({
        students, teachers: [], regularLessons, classroomSettings: settings, weeks: [cells],
        manualAdjustments: ledgers.manualMakeupAdjustments, fallbackStudents: ledgers.fallbackMakeupStudents,
        resolveStudentKey: resolveHolidayStockId, today: new Date('2025-04-10T00:00:00'),
      })
      const entry = entries.find((candidate) => candidate.key === stockKey)
      // remainingOriginDates は日付だけ・remainingOriginSlots が時限(残数の根拠を両方で読む)。
      return { count: entry?.remainingOriginDates.length ?? 0, slots: entry?.remainingOriginSlots ?? [] }
    }
    const templateRegular = { ...sessionLesson({ name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: undefined }), id: 'template_entry', lessonType: 'regular', specialStockSource: undefined } as StudentEntry

    it('休日のテンプレ授業(数 1限・自動 origin あり)＋同じ日の手動追加(数 3限) → 残 2(手動追加分が畳まれない)', () => {
      expect(remaining([holidayCell(1, templateRegular), holidayCell(3, manualLesson({ id: 'manual_3' }))], [templateRow])).toEqual({ count: 2, slots: [1, 3] })
    })

    it('同じ日に同じ科目を 2 コマ手動追加(数 3限・4限) → 残 2(時限なしだと Set で 1 件に畳まれる)', () => {
      expect(remaining([holidayCell(3, manualLesson({ id: 'manual_3' })), holidayCell(4, manualLesson({ id: 'manual_4' }))], [])).toEqual({ count: 2, slots: [3, 4] })
    })

    it('対照: テンプレ授業だけ(手動追加なし) → 残 1(時限なしの返却は自動 origin `D#1` に畳まれる＝従来どおり)', () => {
      expect(remaining([holidayCell(1, templateRegular)], [templateRow])).toEqual({ count: 1, slots: [1] })
    })
  })

  it('★T-5 非回帰: includeManualAddedLessons 省略(全コマ削除・丸ごと振替・テンプレ保留の採用)では手動追加を返さない(kind:none・returnedEntryIds に入らない)', () => {
    // 休日設定と同じ includeRegularLessons:true でフラグだけ省略(既定 false)。手動追加の通常は記録には移るが在庫は触らない。
    const placement = runHoliday(desk({ lesson: [manualLesson(), null] }), emptyLedgers(), {})
    expect(Object.keys(placement.ledgers.manualMakeupAdjustments)).toHaveLength(0)
    expect(placement.returnedEntryIds).toEqual([])
    expect(placement.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'none' })
    expect(placement.movedStudentCount).toBe(1)
    // 全コマ削除の形(includeRegularLessons:false): 手動追加の振替は走査されるが返さない(none)。手動追加の通常は走査もされない。
    const clearDay = runHoliday(
      desk({ lesson: [manualLesson({ id: 'manual_makeup', lessonType: 'makeup' }), manualLesson({ id: 'manual_regular' })] }),
      emptyLedgers(),
      { includeRegularLessons: false },
    )
    expect(Object.keys(clearDay.ledgers.manualMakeupAdjustments)).toHaveLength(0)
    expect(clearDay.returnedEntryIds).toEqual([]) // ★空のまま＝呼び出し側は従来どおり希望回数 −1 を飛ばさない
    expect(clearDay.stockReturnStamps.placementStamps).toEqual([{ kind: 'none' }, undefined])
    // 手動追加の講習も同じ(省略なら none・+1 しない)
    const lecture = runHoliday(desk({ lesson: [manualLecture(), null] }), emptyLedgers(), {})
    expect(lecture.ledgers.manualLectureStockCounts[lectureKey]).toBeUndefined()
    expect(lecture.ledgers.manualLectureStockOrigins[lectureKey]).toBeUndefined()
    expect(lecture.returnedEntryIds).toEqual([])
    expect(lecture.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'none' })
  })

  it('★T-6 手動追加の講習(specialStockSource:manual・講習期間あり): 休日設定では未消化講習へ +1・origin を積み、控え kind:lecture', () => {
    const result = runHoliday(desk({ lesson: [manualLecture(), null] }))
    expect(result.ledgers.manualLectureStockCounts[lectureKey]).toBe(1) // 手動追加は配置で −1 していない(希望数に含まれない)ので 0 → +1
    expect(result.ledgers.manualLectureStockOrigins[lectureKey]).toHaveLength(1)
    expect(result.ledgers.manualLectureStockOrigins[lectureKey][0]).toMatchObject({ displayName: '犬飼 凜', sessionId: 'sess', originDateKey: DATE, originSlotNumber: 5 })
    expect(result.returnedEntryIds).toEqual(['manual_lecture'])
    expect(result.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'lecture', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: false })
    // 出席済み(attended)の手動追加講習も同じ経路で +1(statusSlots 側の控え)
    const attended = runHoliday(desk({ statusSlots: [sessionStatus({ id: 'manual_lecture_status', name: '犬飼 凜', managedStudentId: 's028', subject: '数', specialSessionId: 'sess', specialStockSource: 'manual', manualAdded: true, status: 'attended' }), null] }))
    expect(attended.ledgers.manualLectureStockCounts[lectureKey]).toBe(1)
    expect(attended.returnedEntryIds).toEqual(['manual_lecture_status'])
    expect(attended.stockReturnStamps.statusStamps[0]).toEqual({ kind: 'lecture', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: false })
  })

  it('T-6b 講習期間(specialSessionId)の無い旧データの手動追加講習は休日設定でも返さない(戻し先の行が決まらない＝§B-4 と同じ保険)', () => {
    const result = runHoliday(desk({ lesson: [manualLecture({ id: 'legacy_lecture', specialSessionId: undefined }), null] }))
    expect(result.ledgers.manualLectureStockCounts).toEqual({})
    expect(result.ledgers.manualLectureStockOrigins).toEqual({})
    expect(result.returnedEntryIds).toEqual([])
    expect(result.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'none' })
  })

  it('T-6c 未管理の手動追加(名簿に無い生徒)は本番のキー解決(createBoardStudentStockIdResolver)どおり manual:name: キーで積み、表示名フォールバックを足す(控え fallbackAdded:true＝解除で消す)', () => {
    const productionResolver = createBoardStudentStockIdResolver([{ id: 's028', name: '犬飼 凜', displayName: '犬飼', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2012-05-01' } as unknown as StudentRow])
    const result = runHoliday(desk({ lesson: [manualLesson({ id: 'unmanaged', name: '未管理 花子', managedStudentId: undefined }), null] }), emptyLedgers(), { includeManualAddedLessons: true, resolveStockId: productionResolver })
    const key = buildMakeupStockKey('manual:name:未管理 花子', '数')
    expect(result.ledgers.manualMakeupAdjustments[key]).toEqual([{ dateKey: DATE, slotNumber: 5 }])
    expect(result.ledgers.fallbackMakeupStudents[key]).toEqual({ studentName: '未管理 花子', displayName: '未管理 花子', subject: '数' })
    expect(result.stockReturnStamps.placementStamps[0]).toEqual({ kind: 'makeup', originDateKey: DATE, originSlotNumber: 5, fallbackAdded: true })
  })

  // 既知の限界(regression-reviewer M-3・2026-10-07・§B-3 の「休み」でも同じ): 名簿外の手動追加を返した在庫は `manual:name:` キーに積まれるが、
  // 未消化から置いた振替コマは manualAdded を持たないので `name:` キーで消化され、キーが合わず残が減らない(解除でも別日のコマが見つからない)。
  // 「生徒を追加」は管理生徒しか選べないので実運用では旧データ(名前だけのコマ)に限られる。キーの統一は別 Issue で扱う。
  it.todo('M-3 名簿外の手動追加: 休日設定で返した manual:name: キーの在庫が、在庫から置いた振替(name: キー)で消化されて残 0 になる')
})
