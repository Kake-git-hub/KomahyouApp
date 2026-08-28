import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from './makeupStock'
import {
  buildWholeDayTransferConfirmMessage,
  computeWholeDayTransfer,
  disposeDayDeskEntries,
  overlayBoardWeeksOnScheduleCells,
  resolveWholeDayTransferSourceBlockReason,
  type WholeDayTransferSummary,
} from './ScheduleBoardScreen'

// ============================================================================
// INV-06 操作マトリクス（丸ごと振替・Issue #40 / spec-lecture-stock §4-2③）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習・振替在庫は盤面実配置と一致し、明示操作なしに増減しない。
//
// 丸ごと振替（オーナー確定 2026-08-02）:
//   - 移送側は在庫台帳を一切触らない（通常→振替変換は「消化+1 と使用済み origin+1」の均衡で在庫中立）。
//   - 振替先の既存コマの処分は「その日の生徒を全コマ削除」と同一裁定
//     （reconcileHolidayDeskStockReturns includeRegularLessons:false へ委譲・判定を分散させない）:
//     在庫から出したコマ（振替・ストック由来講習）= 未消化へ返す／
//     通常・体験・増コマ・手動追加 = 返さず希望回数 −1（manualAdded は回数も不変）。
//   - 出欠記録が両日のどちらかにあれば実行不可（出欠記録を消す下流操作にしない）。
//
// spec-makeup-stock §B-2-2（2026-08-02 対称性監査のルール）:
//   盤面からコマを外す操作を新設したら、必ず在庫由来／移動由来の2由来で残数が一致することを固定する。
//   出欠状態の次元は本操作では事前ブロックにより非該当（緩めるならこのマトリクスへ列を足すこと）。
//
// あわせて INV-01（講師帰属）/ INV-02（手動編集の永続化=再マージ耐性）の丸ごと振替行もここで固定する
// （2日にまたがる専用 fixture が必要なため。inv01/inv02 の既存マトリクスとは重複させず薄く持つ）。
// ============================================================================

const SOURCE_DATE = '2026-08-05' // 水曜。振替元
const TARGET_DATE = '2026-08-19' // 水曜。振替先
const MAKEUP_SOURCE_DATE = '2026-07-29' // 水曜。移動由来の振替元（台帳に origin なし）
const HOLIDAY_SOURCE_DATE = '2026-07-22' // 水曜。休日設定済み＝台帳（自動休校日）に origin あり
const TODAY = new Date('2026-07-31T00:00:00')
const STOCK_KEY = 'student-1__数'

const student: StudentRow = {
  id: 'student-1',
  name: '大槻 太郎',
  displayName: '大槻',
  email: 'student@example.com',
  entryDate: '2025-04-01',
  withdrawDate: '未定',
  birthDate: '2012-05-01',
}

const teacher: TeacherRow = {
  id: 'teacher-1',
  name: '田中講師',
  email: 'teacher@example.com',
  entryDate: '2025-04-01',
  withdrawDate: '未定',
  subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
}

// 毎週水曜 5限の通常授業（row-scan 抑止の検証にも使う）
const regularLesson: RegularLessonRow = {
  id: 'regular-1',
  schoolYear: 2026,
  teacherId: 'teacher-1',
  student1Id: 'student-1',
  subject1: '数',
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
  dayOfWeek: 3,
  slotNumber: 5,
}

function createSettings(overrides: Partial<ClassroomSettings> = {}): ClassroomSettings {
  return { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1, ...overrides }
}

// 台帳に origin を持つ状態（在庫由来の振替）= 元コマ 7/22 を休日設定して自動休校日 origin を作る
const holidaySettings = createSettings({ holidayDates: [HOLIDAY_SOURCE_DATE] })

function boardStudent(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '大槻 太郎',
    managedStudentId: 'student-1',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function boardStatus(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return {
    id: 'status-1',
    studentId: 'student-1',
    sourceManagedLesson: true,
    name: '大槻 太郎',
    managedStudentId: 'student-1',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '田中講師',
    dateKey: SOURCE_DATE,
    slotNumber: 5,
    recordedAt: '2026-07-30T00:00:00.000Z',
    status: 'attended',
    sourceLessonId: 'lesson-1',
    ...overrides,
  }
}

function emptyDesk(overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: 'desk-1', teacher: '', ...overrides }
}

function teacherDesk(overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: 'desk-1', teacher: '田中講師', ...overrides }
}

function deskWithStudent(entry: StudentEntry, overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: 'desk-1', teacher: '田中講師', lesson: { id: 'lesson-1', studentSlots: [entry, null] }, ...overrides }
}

function slotCell(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '水',
    dateLabel: dateKey === SOURCE_DATE ? '8/5' : '8/19',
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '19:00-20:20',
    isOpenDay: true,
    desks,
  }
}

function dayCell(dateKey: string, desk: DeskCell): SlotCell {
  return slotCell(dateKey, 5, [desk])
}

const resolveStudentKey = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

function runTransferWeeks(weeks: SlotCell[][], params: {
  settings?: ClassroomSettings
  manualAdjustments?: Record<string, ManualMakeupOrigin[]>
} = {}) {
  const settings = params.settings ?? createSettings()
  const manualAdjustments = params.manualAdjustments ?? {}
  const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({
    students: [student],
    regularLessons: [regularLesson],
    classroomSettings: settings,
    weeks,
    manualAdjustments,
    resolveStudentKey,
    today: TODAY,
    includeAbsentMakeupOrigins: false,
  })
  const result = computeWholeDayTransfer({
    weeks,
    sourceDateKey: SOURCE_DATE,
    targetDateKey: TARGET_DATE,
    manualMakeupAdjustments: manualAdjustments,
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    fallbackMakeupStudents: {},
    fallbackLectureStockStudents: {},
    suppressedRegularLessonOccurrences: [],
    suppressedMakeupOrigins: {},
    scheduleCountAdjustments: [],
    students: [student],
    teachers: [teacher],
    regularLessons: [regularLesson],
    managedStudentByAnyName: new Map([[student.name, student]]),
    resolveDisplayName: (name: string) => name,
    resolveStockId: resolveStudentKey,
    ledgerOriginDatesByKey,
  })
  if (result.status !== 'transferred') return { result, balance: null, sourceDesk: null, targetDesk: null }
  const balanceEntries = buildMakeupStockEntries({
    students: [student],
    teachers: [teacher],
    regularLessons: [regularLesson],
    classroomSettings: settings,
    weeks: result.nextWeeks,
    manualAdjustments: result.nextManualMakeupAdjustments,
    suppressedOrigins: result.nextSuppressedMakeupOrigins,
    resolveStudentKey,
    today: TODAY,
  })
  const flat = result.nextWeeks.flat()
  return {
    result,
    balance: balanceEntries.find((entry) => entry.key === STOCK_KEY)?.balance ?? 0,
    sourceDesk: flat.find((cell) => cell.dateKey === SOURCE_DATE)?.desks[0] ?? null,
    targetDesk: flat.find((cell) => cell.dateKey === TARGET_DATE)?.desks[0] ?? null,
  }
}

function runTransfer(params: {
  sourceDesk: DeskCell
  targetDesk: DeskCell
  settings?: ClassroomSettings
  manualAdjustments?: Record<string, ManualMakeupOrigin[]>
}) {
  return runTransferWeeks(
    [[dayCell(SOURCE_DATE, params.sourceDesk), dayCell(TARGET_DATE, params.targetDesk)]],
    { settings: params.settings, manualAdjustments: params.manualAdjustments },
  )
}

function transferredOrThrow(outcome: ReturnType<typeof runTransfer>) {
  if (outcome.result.status !== 'transferred') throw new Error(`expected transferred but got ${outcome.result.status}`)
  return { ...outcome, result: outcome.result, sourceDesk: outcome.sourceDesk!, targetDesk: outcome.targetDesk! }
}

describe('INV-06 マトリクス: 丸ごと振替', () => {
  describe('振替先の既存コマの処分（全コマ削除と同一裁定）', () => {
    it('通常は未消化へ入れず、希望回数−1＋再マージ抑止（台帳は不変）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'regular' })),
      }))
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.nextManualLectureStockCounts).toEqual({})
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([
        { studentKey: 'student-1', subject: '数', countKind: 'regular', dateKey: TARGET_DATE, delta: -1 },
      ])
      expect(outcome.result.nextSuppressedRegularLessonOccurrences).toContain(`student-1__数__${TARGET_DATE}__5`)
      expect(outcome.result.summary.clearedRegularCount).toBe(1)
      // 未消化振替に暗黙再出現しない（旧「空にする」の非対称を持ち込まない）
      expect(outcome.balance).toBe(0)
    })

    it('体験・メモは消去のみ（台帳・希望回数とも不変）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'trial', manualAdded: true }), { memoSlots: ['自習予約', null] }),
      }))
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.nextManualLectureStockCounts).toEqual({})
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
      expect(outcome.result.summary.clearedTrialCount).toBe(1)
      expect(outcome.result.summary.clearedMemoCount).toBe(1)
      expect(outcome.targetDesk.memoSlots).toBeUndefined()
    })

    it('★増コマは消去のみ・未消化へ入れない（オーナー指示 2026-08-02。回数も不変=manualAdded）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'extra', manualAdded: true })),
      }))
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
      expect(outcome.result.summary.clearedExtraCount).toBe(1)
      expect(outcome.result.summary.returnedMakeupCount).toBe(0)
      expect(outcome.balance).toBe(0)
    })

    it('ストック由来（session）の講習は未消化講習へ+1（希望回数は減らさない）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1' })),
      }))
      expect(Object.values(outcome.result.nextManualLectureStockCounts)).toEqual([1])
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
      expect(outcome.result.summary.returnedLectureCount).toBe(1)
    })

    it('手動追加の講習は返さない（在庫を消費していない・全コマ削除と同裁定）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true })),
      }))
      expect(Object.keys(outcome.result.nextManualLectureStockCounts)).toHaveLength(0)
      expect(outcome.result.summary.returnedLectureCount).toBe(0)
      expect(outcome.result.summary.clearedManualCount).toBe(1)
    })

    it('★由来で食い違わない（§B-2-2）: 在庫由来の振替と移動由来の振替は、どちらも残1で未消化へ戻る', () => {
      const moved = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      }))
      const stock = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        settings: holidaySettings,
      }))
      // 移動由来は台帳へ振替元日で確定（積まないと消滅）。在庫由来は同じ日付に畳まれ二重計上しない。
      expect(moved.result.nextManualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: MAKEUP_SOURCE_DATE }])
      expect(moved.balance).toBe(1)
      expect(stock.balance).toBe(1)
      expect(moved.result.summary.returnedMakeupCount).toBe(1)
      expect(stock.result.summary.returnedMakeupCount).toBe(1)
    })

    it('手動追加の振替は返さない（返す先が無い・全コマ削除と同裁定）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true })),
      }))
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.summary.returnedMakeupCount).toBe(0)
      expect(outcome.result.summary.clearedManualCount).toBe(1)
    })

    it('返した分は希望回数を減らさない（returnedEntryIds で−1を飛ばす）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk(),
        targetDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      }))
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
    })
  })

  describe('移送側は在庫中立（台帳を一切触らない）', () => {
    it('通常→振替に変換され、全台帳が deep-equal で不変・残数も 0 のまま', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent({ lessonType: 'regular' })),
        targetDesk: emptyDesk(),
      }))
      const movedStudent = outcome.targetDesk.lesson?.studentSlots[0]
      expect(movedStudent?.lessonType).toBe('makeup')
      expect(movedStudent?.makeupSourceDate).toBe(SOURCE_DATE)
      expect(movedStudent?.makeupSourceLabel).toBe('2026/8/5(水) 5限')
      // 在庫中立: 台帳は入力とまったく同じ（1件でも積むと二重計上=INV-06 違反）
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.nextManualLectureStockCounts).toEqual({})
      expect(outcome.result.nextManualLectureStockOrigins).toEqual({})
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
      expect(outcome.balance).toBe(0)
      // 元コマの再マージ抑止（per-student キー + row-scan の両方が積まれている）
      expect(outcome.result.nextSuppressedRegularLessonOccurrences).toContain(`student-1__数__${SOURCE_DATE}__5`)
    })

    it('自分の元の通常授業日へ戻る振替は通常へ復帰する（normalizeLessonPlacement）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: TARGET_DATE, makeupSourceLabel: '2026/8/19(水) 5限' })),
        targetDesk: emptyDesk(),
      }))
      expect(outcome.targetDesk.lesson?.studentSlots[0]?.lessonType).toBe('regular')
    })

    it('講習・増コマ・体験は種別・origin 系フィールド不変のまま位置だけ移る', () => {
      const special = boardStudent({ id: 'entry-sp', lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1', noteSuffix: '60' })
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(special),
        targetDesk: emptyDesk(),
      }))
      const movedStudent = outcome.targetDesk.lesson?.studentSlots[0]
      expect(movedStudent).toMatchObject({ lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1', noteSuffix: '60' })
      expect(outcome.result.nextManualLectureStockCounts).toEqual({})
    })

    it('増コマ・体験も実体で素通し（スロット位置=2人目も保持・台帳不変）', () => {
      const extraStudent = boardStudent({ id: 'entry-extra', lessonType: 'extra', manualAdded: true })
      const trialStudent = boardStudent({ id: 'entry-trial', name: '体験生', managedStudentId: undefined, lessonType: 'trial', manualAdded: true })
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk({ lesson: { id: 'lesson-1', studentSlots: [extraStudent, trialStudent] } }),
        targetDesk: emptyDesk(),
      }))
      const slots = outcome.targetDesk.lesson?.studentSlots
      expect(slots?.[0]).toMatchObject({ id: 'entry-extra', lessonType: 'extra', manualAdded: true })
      expect(slots?.[0]?.makeupSourceDate).toBeUndefined()
      expect(slots?.[1]).toMatchObject({ id: 'entry-trial', lessonType: 'trial', manualAdded: true })
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      expect(outcome.result.nextScheduleCountAdjustments).toEqual([])
    })

    it('★移送側の2由来対称（§B-2-2）: 在庫由来の振替コマを移しても makeupSourceDate・台帳・残数が不変', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE, makeupSourceLabel: '2026/7/22(水) 5限' })),
        targetDesk: emptyDesk(),
        settings: holidaySettings,
      }))
      const movedStudent = outcome.targetDesk.lesson?.studentSlots[0]
      expect(movedStudent).toMatchObject({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })
      expect(outcome.result.nextManualMakeupAdjustments).toEqual({})
      // 台帳 origin は移送後も盤面の振替が消化し続けるので残0のまま(移送で+1も−1もしない)
      expect(outcome.balance).toBe(0)
    })

    it('生徒のいない空 lesson シェルは振替先へ伝播しない', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk({ lesson: { id: 'lesson-1', studentSlots: [null, null] } }),
        targetDesk: emptyDesk(),
      }))
      expect(outcome.targetDesk.lesson).toBeUndefined()
      expect(outcome.targetDesk.teacher).toBe('田中講師')
    })

    it('★複数コマ×複数机は slotNumber×机位置の1対1で移送される（取り違えなし）', () => {
      const studentA = boardStudent({ id: 'entry-a' })
      const studentB = boardStudent({ id: 'entry-b', name: '別生徒', managedStudentId: undefined, lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true })
      const weeks = [[
        slotCell(SOURCE_DATE, 5, [
          { id: 'desk-1', teacher: '田中講師', lesson: { id: 'lesson-a', studentSlots: [studentA, null] } },
          { id: 'desk-2', teacher: '別講師' },
        ]),
        slotCell(SOURCE_DATE, 6, [
          { id: 'desk-1', teacher: '', lesson: { id: 'lesson-b', studentSlots: [studentB, null] } },
          { id: 'desk-2', teacher: '' },
        ]),
        slotCell(TARGET_DATE, 5, [emptyDesk(), { id: 'desk-2', teacher: '' }]),
        slotCell(TARGET_DATE, 6, [emptyDesk(), { id: 'desk-2', teacher: '' }]),
      ]]
      const outcome = runTransferWeeks(weeks)
      if (outcome.result.status !== 'transferred') throw new Error('expected transferred')
      const flat = outcome.result.nextWeeks.flat()
      const target5 = flat.find((cell) => cell.dateKey === TARGET_DATE && cell.slotNumber === 5)!
      const target6 = flat.find((cell) => cell.dateKey === TARGET_DATE && cell.slotNumber === 6)!
      // 5限の机1 → 5限の机1(生徒Aは振替に変換・講師も同じ机位置へ)
      expect(target5.desks[0]?.lesson?.studentSlots[0]).toMatchObject({ id: 'entry-a', lessonType: 'makeup', makeupSourceDate: SOURCE_DATE })
      expect(target5.desks[0]?.teacher).toBe('田中講師')
      expect(target5.desks[1]?.teacher).toBe('別講師')
      // 6限の机1 → 6限の机1(講習は素通し・5限へ混線しない)
      expect(target6.desks[0]?.lesson?.studentSlots[0]).toMatchObject({ id: 'entry-b', lessonType: 'special' })
      expect(target6.desks[1]?.lesson).toBeUndefined()
      // 講師の実人数(ユニーク名)
      expect(outcome.result.summary.movedTeacherCount).toBe(2)
      expect(outcome.result.summary.movedStudentCount).toBe(2)
      // 振替元はすべて空
      const source5 = flat.find((cell) => cell.dateKey === SOURCE_DATE && cell.slotNumber === 5)!
      const source6 = flat.find((cell) => cell.dateKey === SOURCE_DATE && cell.slotNumber === 6)!
      expect(source5.desks.every((desk) => !desk.lesson)).toBe(true)
      expect(source6.desks.every((desk) => !desk.lesson)).toBe(true)
    })

    it('★主用途の連鎖: 丸ごと振替 → 振替元日を休日設定しても残数は増減しない(過去日=自動休校日originが実際に発火する構成)', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent({ lessonType: 'regular' })),
        targetDesk: emptyDesk(),
      }))
      // 振替元は空になっているので、休日設定は holidayDates への追加のみ(在庫返却対象なし)。
      // TODAY を両日より後にして computeAutomaticShortageOrigins(自動休校日origin)を実際に発火させる。
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings({ holidayDates: [SOURCE_DATE] }),
        weeks: outcome.result.nextWeeks,
        manualAdjustments: outcome.result.nextManualMakeupAdjustments,
        resolveStudentKey,
        today: new Date('2026-08-21T00:00:00'),
      })
      // 休日化で生じる自動origin(8/5)は、移送先の振替(元日=8/5)が消化するため残0のまま=在庫中立
      expect(entries.find((entry) => entry.key === STOCK_KEY)?.balance ?? 0).toBe(0)
    })

    it('managed 由来 lesson は移送時に非 managed の id へ振り直し、管理ノートを外す', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: teacherDesk({ lesson: { id: 'managed_1', note: '管理データ反映', studentSlots: [boardStudent(), null] } }),
        targetDesk: emptyDesk(),
      }))
      expect(outcome.targetDesk.lesson?.id.startsWith('managed_')).toBe(false)
      expect(outcome.targetDesk.lesson?.note).toBeUndefined()
    })
  })

  describe('講師帰属（INV-01）と再マージ耐性（INV-02）', () => {
    it('講師ブロックは manual 固定+講師ID補完つきで移送され、振替元は削除 tombstone になる', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent()),
        targetDesk: emptyDesk(),
      }))
      expect(outcome.targetDesk.teacher).toBe('田中講師')
      expect(outcome.targetDesk.manualTeacher).toBe(true)
      expect(outcome.targetDesk.teacherAssignmentTeacherId).toBe('teacher-1')
      // 振替元: 空の営業日として残す。素の空にせず tombstone（再マージ・講師日程反映での復活防止）
      expect(outcome.sourceDesk.teacher).toBe('')
      expect(outcome.sourceDesk.manualTeacher).toBe(true)
      expect(outcome.sourceDesk.teacherAssignmentSource).toBe('deleted')
      expect(outcome.sourceDesk.lesson).toBeUndefined()
      expect(outcome.sourceDesk.memoSlots).toBeUndefined()
    })

    it('振替先に元からいた講師（振替元机は講師なし）は tombstone で消える', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: emptyDesk({ memoSlots: ['メモだけの日', null] }),
        targetDesk: teacherDesk(),
      }))
      expect(outcome.targetDesk.teacher).toBe('')
      expect(outcome.targetDesk.manualTeacher).toBe(true)
      expect(outcome.targetDesk.teacherAssignmentSource).toBe('deleted')
      expect(outcome.targetDesk.teacherAssignmentTeacherId).toBe('田中講師')
      // 消える講師の実人数は確認ダイアログで開示する
      expect(outcome.result.summary.clearedTeacherCount).toBe(1)
      // メモは移送される
      expect(outcome.targetDesk.memoSlots).toEqual(['メモだけの日', null])
    })

    // オーナー指示 2026-08-03: 丸ごと振替した日は**講師の顔ぶれもユーザーの操作結果で固定**する。
    // テンプレ足場講師（非manual）は本来テンプレに追従する（INV-02 確定仕様）が、丸ごと振替の両日だけは
    // 日単位の抑止キー（buildTemplateTeacherSuppressionKey）で再付与を止める。
    // ★この抑止を外すと「振替先にその日のテンプレ講師が湧いて振替元と表示が揃わない」に戻る。
    it('★再マージしてもテンプレ足場講師が湧かない（振替元・振替先とも／机位置がずれていても）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent()),
        targetDesk: emptyDesk(),
      }))
      // 抑止キーが両日ぶん積まれている
      expect(outcome.result.nextSuppressedRegularLessonOccurrences).toContain(`TEMPLATE_TEACHER__DAY__${SOURCE_DATE}__0`)
      expect(outcome.result.nextSuppressedRegularLessonOccurrences).toContain(`TEMPLATE_TEACHER__DAY__${TARGET_DATE}__0`)

      // テンプレ（管理データ）は両日とも「別の講師が机を持つ」状態。机位置は移送先とずらす。
      const managedCells = [
        slotCell(SOURCE_DATE, 5, [{ id: 'm0', teacher: '' }, { id: 'm1', teacher: 'テンプレ講師V' }]),
        slotCell(TARGET_DATE, 5, [{ id: 'm0', teacher: '' }, { id: 'm1', teacher: 'テンプレ講師U' }]),
      ]
      // 盤面側も2机に揃える（移送は机位置1対1なので机数を合わせる）
      const boardWeeks = outcome.result.nextWeeks.map((week) => week.map((cell) => ({
        ...cell,
        desks: [...cell.desks, { id: 'extra', teacher: '' } as DeskCell],
      })))
      const merged = overlayBoardWeeksOnScheduleCells(managedCells, boardWeeks, outcome.result.nextSuppressedRegularLessonOccurrences)

      const teachersOn = (dateKey: string) => merged
        .filter((cell) => cell.dateKey === dateKey)
        .flatMap((cell) => cell.desks.map((desk) => desk.teacher))
        .filter((name) => name.trim())
      // 振替元: 空のまま（テンプレ講師Vが湧かない）
      expect(teachersOn(SOURCE_DATE)).toEqual([])
      // 振替先: 移送した講師だけ（テンプレ講師Uが湧かない）
      expect(teachersOn(TARGET_DATE)).toEqual(['田中講師'])
    })

    // ★本番の主経路: テンプレ側の管理セルは「講師＋管理授業(managed lesson)」の机を持つ。
    // 丸ごと振替の per-student 抑止で studentSlots が全 null になると suppressManagedStudentsInCell が
    // lesson だけ落として **teacher は残す**（:2707 付近）。この「講師だけになった管理机」が
    // 再付与ループの燃料になるので、strip は必ず suppressManagedStudentsInCell の**後**に当てる必要がある。
    // ★順序を入れ替えると（strip を先に当てると）この経路だけ静かに壊れる。それを検出するテスト。
    it('★テンプレに授業がある日でも足場講師が湧かない（抑止で lesson が消えた管理机の講師も落ちる）', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent()),
        targetDesk: emptyDesk(),
      }))
      // 管理セル(テンプレ)の形を本番に合わせる: 机1 に「テンプレ講師U ＋ 管理授業(student-1/数)」
      const managedLessonDesk = (teacherName: string): DeskCell => ({
        id: 'm1',
        teacher: teacherName,
        lesson: {
          id: `managed_${teacherName}`,
          note: '管理データ反映',
          studentSlots: [boardStudent({ id: `managed-${teacherName}` }), null],
        },
      })
      const managedCells = [
        slotCell(SOURCE_DATE, 5, [{ id: 'm0', teacher: '' }, managedLessonDesk('テンプレ講師V')]),
        slotCell(TARGET_DATE, 5, [{ id: 'm0', teacher: '' }, managedLessonDesk('テンプレ講師U')]),
      ]
      const boardWeeks = outcome.result.nextWeeks.map((week) => week.map((cell) => ({
        ...cell,
        desks: [...cell.desks, { id: 'extra', teacher: '' } as DeskCell],
      })))
      const merged = overlayBoardWeeksOnScheduleCells(managedCells, boardWeeks, outcome.result.nextSuppressedRegularLessonOccurrences)

      const teachersOn = (dateKey: string) => merged
        .filter((cell) => cell.dateKey === dateKey)
        .flatMap((cell) => cell.desks.map((desk) => desk.teacher))
        .filter((name) => name.trim())
      expect(teachersOn(SOURCE_DATE)).toEqual([])
      expect(teachersOn(TARGET_DATE)).toEqual(['田中講師'])
      // 生徒側も復活しない（抑止キーが効いている＝この経路を実際に通った証拠）
      const targetStudents = merged
        .filter((cell) => cell.dateKey === TARGET_DATE)
        .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
        .filter((entry) => entry != null)
      expect(targetStudents).toHaveLength(1)
      expect(targetStudents[0]?.lessonType).toBe('makeup')
    })

    it('抑止していない日では従来どおりテンプレ足場講師が付く（INV-02 のテンプレ追従を壊していない）', () => {
      const untouchedDate = '2026-08-26'
      const boardWeeks = [[slotCell(untouchedDate, 5, [{ id: 'd0', teacher: '' }, { id: 'd1', teacher: '' }])]]
      const managedCells = [slotCell(untouchedDate, 5, [{ id: 'm0', teacher: '' }, { id: 'm1', teacher: 'テンプレ講師W' }])]
      const merged = overlayBoardWeeksOnScheduleCells(managedCells, boardWeeks, [`TEMPLATE_TEACHER__DAY__${TARGET_DATE}__0`])
      expect(merged[0]?.desks.some((desk) => desk.teacher === 'テンプレ講師W')).toBe(true)
    })

    it('再マージ（overlay）を通しても、振替元に通常授業・講師が復活せず、振替先の移送結果も巻き戻らない', () => {
      const outcome = transferredOrThrow(runTransfer({
        sourceDesk: deskWithStudent(boardStudent()),
        targetDesk: deskWithStudent(boardStudent({ id: 'entry-t', lessonType: 'regular' })),
      }))
      // テンプレ（管理データ）は両日とも「田中講師×大槻(通常)」を主張する状態を再現
      const managedCells = [SOURCE_DATE, TARGET_DATE].map((dateKey) => ({
        ...dayCell(dateKey, {
          id: 'desk-1',
          teacher: '田中講師',
          lesson: { id: `managed_${dateKey}`, note: '管理データ反映', studentSlots: [boardStudent({ id: `managed-entry-${dateKey}` }), null] },
        }),
      }))
      const merged = overlayBoardWeeksOnScheduleCells(managedCells, outcome.result.nextWeeks, outcome.result.nextSuppressedRegularLessonOccurrences)
      const mergedSource = merged.find((cell) => cell.dateKey === SOURCE_DATE)
      const mergedTarget = merged.find((cell) => cell.dateKey === TARGET_DATE)
      // 振替元: 生徒は復活しない・tombstone に講師が再付与されない
      expect(mergedSource?.desks[0]?.lesson?.studentSlots.some((s) => s != null)).toBeFalsy()
      expect(mergedSource?.desks[0]?.teacher).toBe('')
      // 振替先: 移送した生徒（振替）と講師が残る。消去した振替先の通常も復活しない
      const targetStudents = (mergedTarget?.desks ?? []).flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((s) => s != null)
      expect(targetStudents).toHaveLength(1)
      expect(targetStudents[0]?.lessonType).toBe('makeup')
      expect(mergedTarget?.desks[0]?.teacher).toBe('田中講師')
    })
  })

  describe('実行不可（ブロック）', () => {
    it('振替元に出欠記録があれば blocked', () => {
      const outcome = runTransfer({
        sourceDesk: teacherDesk({ statusSlots: [boardStatus(), null] }),
        targetDesk: emptyDesk(),
      })
      expect(outcome.result.status).toBe('blocked')
    })

    it('振替先に出欠記録があれば blocked（記録を破棄する下流操作にしない）', () => {
      const outcome = runTransfer({
        sourceDesk: deskWithStudent(boardStudent()),
        targetDesk: emptyDesk({ statusSlots: [boardStatus({ dateKey: TARGET_DATE }), null] }),
      })
      expect(outcome.result.status).toBe('blocked')
    })

    it('振替元が空（生徒・メモ・講師なし）なら blocked', () => {
      const outcome = runTransfer({ sourceDesk: emptyDesk(), targetDesk: emptyDesk() })
      expect(outcome.result.status).toBe('blocked')
    })

    it('移動マーカー(moved)だけが残る日も出欠記録としてブロック（別日へ移動済みの痕跡がある日は丸ごと振替不可）', () => {
      const outcome = runTransfer({
        sourceDesk: teacherDesk({ statusSlots: [boardStatus({ status: 'moved' }), null] }),
        targetDesk: emptyDesk(),
      })
      expect(outcome.result.status).toBe('blocked')
    })

    it('コマ構成（時限・机数）が一致しない日への移送は blocked（無言の部分移送をしない）', () => {
      const weeks = [[
        slotCell(SOURCE_DATE, 5, [deskWithStudent(boardStudent())]),
        slotCell(SOURCE_DATE, 6, [deskWithStudent(boardStudent({ id: 'entry-2' }))]),
        slotCell(TARGET_DATE, 5, [emptyDesk()]),
        // TARGET_DATE に 6限が無い
      ]]
      const outcome = runTransferWeeks(weeks)
      expect(outcome.result.status).toBe('blocked')
      if (outcome.result.status === 'blocked') {
        expect(outcome.result.message).toContain('コマ構成')
      }
    })

    it('同日・表示範囲外は blocked', () => {
      const weeks = [[dayCell(SOURCE_DATE, deskWithStudent(boardStudent()))]]
      const baseParams = {
        weeks,
        manualMakeupAdjustments: {},
        manualLectureStockCounts: {},
        manualLectureStockOrigins: {},
        fallbackMakeupStudents: {},
        fallbackLectureStockStudents: {},
        suppressedRegularLessonOccurrences: [],
        suppressedMakeupOrigins: {},
        scheduleCountAdjustments: [],
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        managedStudentByAnyName: new Map([[student.name, student]]),
        resolveDisplayName: (name: string) => name,
        resolveStockId: resolveStudentKey,
        ledgerOriginDatesByKey: {},
      }
      expect(computeWholeDayTransfer({ ...baseParams, sourceDateKey: SOURCE_DATE, targetDateKey: SOURCE_DATE }).status).toBe('blocked')
      expect(computeWholeDayTransfer({ ...baseParams, sourceDateKey: SOURCE_DATE, targetDateKey: TARGET_DATE }).status).toBe('blocked')
    })

    it('resolveWholeDayTransferSourceBlockReason: 出欠記録あり/空日はメッセージ・移せる日なら null', () => {
      expect(resolveWholeDayTransferSourceBlockReason([dayCell(SOURCE_DATE, teacherDesk({ statusSlots: [boardStatus(), null] }))])).toContain('出欠記録')
      expect(resolveWholeDayTransferSourceBlockReason([dayCell(SOURCE_DATE, emptyDesk())])).toContain('移動できるコマがありません')
      expect(resolveWholeDayTransferSourceBlockReason([])).toContain('表示範囲外')
      expect(resolveWholeDayTransferSourceBlockReason([dayCell(SOURCE_DATE, deskWithStudent(boardStudent()))])).toBeNull()
    })
  })

  // 「その日の既存コマを処分する」裁定は共通関数 disposeDayDeskEntries に一本化されており、
  // 丸ごと振替(Phase A)と「その日の生徒を全コマ削除」の両方がこれを呼ぶ。違いはオプション2つだけ。
  // ★ここを2か所に分散させると、片方だけ直して会計がズレる（v1.5.464 の裁定が壊れる）。
  describe('共通処分関数 disposeDayDeskEntries（丸ごと振替と全コマ削除で共有）', () => {
    const baseParams = {
      cellDateKey: TARGET_DATE,
      cellSlotNumber: 5,
      ledgers: {
        manualLectureStockCounts: {},
        manualLectureStockOrigins: {},
        manualMakeupAdjustments: {},
        fallbackLectureStockStudents: {},
        fallbackMakeupStudents: {},
      },
      scheduleCountAdjustments: [],
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: new Map([[student.name, student]]),
      resolveDisplayName: (name: string) => name,
      resolveStockId: resolveStudentKey,
      ledgerOriginDatesByKey: {},
    }

    it('丸ごと振替モード: メモを消し、消した通常の抑止キーを積む', () => {
      const desk = deskWithStudent(boardStudent({ lessonType: 'regular' }), { memoSlots: ['メモ', null] })
      const result = disposeDayDeskEntries({ ...baseParams, desk, suppressClearedRegularOccurrences: true, clearMemoSlots: true })
      expect(desk.lesson).toBeUndefined()
      expect(desk.memoSlots).toBeUndefined()
      expect(result.counts.clearedMemoCount).toBe(1)
      expect(result.counts.clearedRegularCount).toBe(1)
      expect(result.nextSuppressedRegularLessonOccurrences).toContain(`student-1__数__${TARGET_DATE}__5`)
      expect(result.nextScheduleCountAdjustments).toHaveLength(1)
    })

    it('全コマ削除モード: メモは残し、抑止キーは積まない（row-scan は呼び出し側の担当）', () => {
      const desk = deskWithStudent(boardStudent({ lessonType: 'regular' }), { memoSlots: ['メモ', null] })
      const result = disposeDayDeskEntries({ ...baseParams, desk, suppressClearedRegularOccurrences: false, clearMemoSlots: false })
      expect(desk.lesson).toBeUndefined()
      expect(desk.memoSlots).toEqual(['メモ', null])
      expect(result.counts.clearedMemoCount).toBe(0)
      expect(result.nextSuppressedRegularLessonOccurrences).toEqual([])
      expect(result.nextScheduleCountAdjustments).toHaveLength(1)
    })

    it('★statusSlots(出欠済み)も同じ規則で処分する（片方だけ走査すると会計が漏れる）', () => {
      // 出席済みの振替コマ: 在庫へ返り、希望回数は減らさない
      const desk: DeskCell = {
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, dateKey: TARGET_DATE }), null],
      }
      const result = disposeDayDeskEntries({ ...baseParams, desk })
      expect(desk.statusSlots).toBeUndefined()
      expect(result.counts.clearedEntryCount).toBe(1)
      expect(result.counts.returnedEntryCount).toBe(1)
      expect(result.counts.returnedMakeupCount).toBe(1)
      // 返した分は希望回数を減らさない
      expect(result.nextScheduleCountAdjustments).toEqual([])
      expect(result.ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeDefined()
    })

    it('返却と希望回数−1を同時にやらない（返した分は−1をスキップ・返さない分だけ−1）', () => {
      const desk: DeskCell = {
        id: 'desk-1',
        teacher: '田中講師',
        lesson: {
          id: 'lesson-1',
          studentSlots: [
            boardStudent({ id: 'e-makeup', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE }),
            boardStudent({ id: 'e-regular', lessonType: 'regular' }),
          ],
        },
      }
      const result = disposeDayDeskEntries({ ...baseParams, desk })
      expect(result.counts.returnedEntryCount).toBe(1)
      expect(result.counts.clearedRegularCount).toBe(1)
      expect(result.nextScheduleCountAdjustments).toHaveLength(1)
      expect(result.nextScheduleCountAdjustments[0]?.delta).toBe(-1)
    })
  })

  describe('確認ダイアログ文面', () => {
    const emptySummary: WholeDayTransferSummary = {
      movedStudentCount: 0,
      movedTeacherCount: 0,
      movedMemoCount: 0,
      clearedRegularCount: 0,
      clearedTrialCount: 0,
      clearedExtraCount: 0,
      clearedManualCount: 0,
      clearedMemoCount: 0,
      clearedTeacherCount: 0,
      returnedMakeupCount: 0,
      returnedLectureCount: 0,
    }

    it('件数内訳を明記し、0件の項目・行は省略する（消える講師の人数も開示）', () => {
      const message = buildWholeDayTransferConfirmMessage(SOURCE_DATE, TARGET_DATE, {
        ...emptySummary,
        movedStudentCount: 12,
        movedTeacherCount: 4,
        clearedRegularCount: 3,
        clearedExtraCount: 1,
        clearedTeacherCount: 2,
        returnedLectureCount: 2,
        returnedMakeupCount: 1,
      })
      expect(message).toBe([
        '8/5(水) の全コマを 8/19(水) へ丸ごと振替します。',
        '移動: 生徒12件・講師4名',
        '振替先の既存コマ:',
        '・消去（未消化へ入れません）: 通常3件・増コマ1件・講師2名',
        '・未消化へ返却: 講習2件・振替1件',
        'よろしいですか。',
      ].join('\n'))
    })

    it('振替先が空なら「既存のコマはありません」と出す', () => {
      const message = buildWholeDayTransferConfirmMessage(SOURCE_DATE, TARGET_DATE, { ...emptySummary, movedStudentCount: 1, movedTeacherCount: 1 })
      expect(message).toContain('振替先に既存のコマはありません。')
      expect(message).not.toContain('未消化へ返却')
    })
  })

  // Issue #59(2026-08-29 オーナー確定): 振替先で処分した通常授業に、全コマ削除(Issue #58)と同じ
  // 振替抑制(suppressedMakeupOrigins・時限つき)を積む。積まないと、振替先の日を後から休日設定したとき
  // 自動計算(テンプレ根拠)が処分済み通常授業の振替を積み直し「希望−1」と「振替+1」が二重にかかる。
  // §4-2「振替先の処分は全コマ削除と同一裁定」を抑制まで対称化した。
  describe('振替先処分の振替抑制(Issue #59・全コマ削除との対称化)', () => {
    it('振替先で処分した通常授業に抑制が積まれる(時限つき)/振替元には積まない', () => {
      const weeks = [[
        dayCell(SOURCE_DATE, deskWithStudent(boardStudent())),
        dayCell(TARGET_DATE, deskWithStudent(boardStudent({ id: 'entry-t' }), { id: 'desk-t' })),
      ]]
      const outcome = runTransferWeeks(weeks)
      expect(outcome.result.status).toBe('transferred')
      if (outcome.result.status !== 'transferred') return
      // 振替先(TARGET_DATE)の処分済み通常授業ぶんだけが時限つきで積まれる
      expect(outcome.result.nextSuppressedMakeupOrigins[STOCK_KEY]).toEqual([{ dateKey: TARGET_DATE, slotNumber: 5 }])
    })

    it('端到端: 丸ごと振替のあと振替先の日を休日設定しても、処分済み通常授業の振替が積み直されない', () => {
      const weeks = [[
        dayCell(SOURCE_DATE, deskWithStudent(boardStudent())),
        dayCell(TARGET_DATE, deskWithStudent(boardStudent({ id: 'entry-t' }), { id: 'desk-t' })),
      ]]
      const outcome = runTransferWeeks(weeks)
      expect(outcome.result.status).toBe('transferred')
      if (outcome.result.status !== 'transferred') return
      const balanceAfterHoliday = (suppressedOrigins: Record<string, ManualMakeupOrigin[]>) => buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings({ holidayDates: [TARGET_DATE] }),
        weeks: outcome.result.status === 'transferred' ? outcome.result.nextWeeks : [],
        manualAdjustments: outcome.result.status === 'transferred' ? outcome.result.nextManualMakeupAdjustments : {},
        suppressedOrigins,
        resolveStudentKey,
        today: TODAY,
      }).find((entry) => entry.key === STOCK_KEY)?.balance ?? 0
      // 前提: 抑制なしだと自動計算が TARGET_DATE#5 の振替を積み直す(=旧挙動のバグ)
      expect(balanceAfterHoliday({})).toBe(1)
      // 抑制ありだと積み直されない(移送コマの在庫中立も維持)
      expect(balanceAfterHoliday(outcome.result.nextSuppressedMakeupOrigins)).toBe(0)
    })

    it('振替先が空(処分する通常授業なし)なら抑制は積まれない', () => {
      const weeks = [[
        dayCell(SOURCE_DATE, deskWithStudent(boardStudent())),
        dayCell(TARGET_DATE, emptyDesk({ id: 'desk-t' })),
      ]]
      const outcome = runTransferWeeks(weeks)
      expect(outcome.result.status).toBe('transferred')
      if (outcome.result.status !== 'transferred') return
      expect(Object.keys(outcome.result.nextSuppressedMakeupOrigins)).toHaveLength(0)
    })
  })
})
