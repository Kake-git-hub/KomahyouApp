import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  buildMakeupStockEntries,
  collectMakeupOriginDatesByKey,
  ledgerOriginsIncludeDate,
  resolveStoreMakeupOriginDate,
  type ManualMakeupOrigin,
} from './makeupStock'
import { buildManagedOccurrenceKey, buildManagedScheduleCellsForRange, clearMakeupOrigins, collectClearedDayMakeupSuppressions, computePendingDeskResolution, computeStudentMove, computeStudentWithdrawSweep, computeTemplateDiffApplyForBoard, reconcileHolidayDeskStockReturns, removeMakeupOrigin, resolveSelectedMakeupOrigin, shouldReturnLectureStockOnAbsence, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesksAfterCommit } from './templatePendingResolution'

// ============================================================================
// INV-06 操作マトリクス（生徒を「休み」にしたときの未消化振替の実態一致）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-06・強制）:
//   未消化の講習・振替在庫は盤面実配置と一致し、明示操作なしに増減しない。誤増（消化済みの再出現）も違反。
//   ここでは**誤減（実施されなかった授業が未消化にも盤面にも残らず消滅する）**側を固定する。
//
// 対象バグ（2026-07-31 スクールIE緑が丘校 室長報告「生徒を休みにしても未消化振替に入らない生徒がいる」）:
//   通常授業を別日へ「移動」した振替コマは、台帳（自動休校日 / 同時間帯重複 / 手動調整）に origin を
//   登録しない。盤面に置かれていること自体が唯一の記録で、消化(plannedMakeups)と使用済み origin が
//   打ち消し合って残0になる均衡で成立している。この振替コマを休みにすると盤面から消え、absent は
//   消化に数えないのに戻すべき origin が台帳に無いため、未消化振替へ1件も戻らず授業が消滅していた。
//   在庫由来（台帳に origin がある）の振替コマは正しく戻るため、**同じ「休み」でも生徒によって結果が
//   違う**＝報告の「入らない生徒がいる」症状になっていた。
//
// 固定するルール:
//   休み(absent) の出欠記録が盤面にある限り、振替元日を origin として算出で復元する
//   （台帳へ書き戻さない = 休み解除で自動的に消え、既存の壊れたデータも読み込み直しで復旧する）。
//
// 兄弟監査（隣接操作を同じ表で固定する）:
//   休み / 休み解除(往復) / 振無休 / 出席 / 格納(未消化振替へ戻す) × 通常 / 同日移動 / 在庫由来の振替 /
//   移動しただけの振替 / 手動追加。
// ============================================================================

const STOCK_KEY = 'student-1__数'
const MAKEUP_SOURCE_DATE = '2026-07-29' // 水曜。通常授業の元コマ（休校日ではない＝台帳に origin なし）
const HOLIDAY_SOURCE_DATE = '2026-07-22' // 水曜。休日設定済み＝台帳(自動休校日)に origin あり
const BOARD_DATE = '2026-08-05' // 水曜。振替先／欠席が起きたコマ
const TODAY = new Date('2026-07-31T00:00:00')

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

// 毎週水曜 5限の通常授業
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
    dateKey: BOARD_DATE,
    slotNumber: 5,
    recordedAt: '2026-07-30T00:00:00.000Z',
    status: 'absent',
    sourceLessonId: 'lesson-1',
    ...overrides,
  }
}

function cellWithDesk(desk: DeskCell): SlotCell {
  return {
    id: 'cell-1',
    dateKey: BOARD_DATE,
    dayLabel: '水',
    dateLabel: '8/5',
    slotLabel: '5限',
    slotNumber: 5,
    timeLabel: '19:00-20:20',
    isOpenDay: true,
    desks: [desk],
  }
}

function deskWithStatus(statusEntry: StudentStatusEntry): DeskCell {
  return {
    id: 'desk-1',
    teacher: '田中講師',
    statusSlots: [statusEntry, null],
    lesson: { id: 'lesson-1', studentSlots: [null, null] },
  }
}

function deskWithStudent(entry: StudentEntry): DeskCell {
  return {
    id: 'desk-1',
    teacher: '田中講師',
    lesson: { id: 'lesson-1', studentSlots: [entry, null] },
  }
}

function stockBalance(params: {
  desk: DeskCell
  manualAdjustments?: Record<string, ManualMakeupOrigin[]>
  settings?: ClassroomSettings
}) {
  const entries = buildMakeupStockEntries({
    students: [student],
    teachers: [teacher],
    regularLessons: [regularLesson],
    classroomSettings: params.settings ?? createSettings(),
    weeks: [[cellWithDesk(params.desk)]],
    manualAdjustments: params.manualAdjustments ?? {},
    resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
    today: TODAY,
  })
  return entries.find((entry) => entry.key === STOCK_KEY)?.balance ?? 0
}

// 台帳に origin を持つ状態（在庫由来の振替）= 元コマ 7/22 を休日設定して自動休校日 origin を作る
const holidaySettings = createSettings({ holidayDates: [HOLIDAY_SOURCE_DATE] })

describe('INV-06 マトリクス: 休みにした授業が未消化振替から消えない', () => {
  describe('休み(absent)', () => {
    it('通常授業を休み → 手動 origin(当日)で残1', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ lessonType: 'regular' })),
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] },
      })
      expect(balance).toBe(1)
    })

    it('同日別コマへ移動した通常授業を休み → 元コマ日の手動 origin で残1', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ lessonType: 'regular', sameDayMoveSourceDate: BOARD_DATE })),
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] },
      })
      expect(balance).toBe(1)
    })

    it('在庫由来の振替コマ(台帳に origin あり)を休み → 台帳 origin が再浮上して残1（二重計上しない）', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        settings: holidaySettings,
      })
      expect(balance).toBe(1)
    })

    it('回帰防止: 移動しただけの振替コマ(台帳に origin なし)を休み → 振替元日で残1（消滅しない）', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      })
      expect(balance).toBe(1)
    })

    it('回帰防止: 復元される元コマは「振替元日」であって欠席日ではない', () => {
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '2026/7/29(水) 5限' })))]],
        manualAdjustments: {},
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      const entry = entries.find((item) => item.key === STOCK_KEY)
      expect(entry?.remainingOriginDates).toEqual([MAKEUP_SOURCE_DATE])
      expect(entry?.nextOriginLabel).toBe('2026/7/29(水) 5限')
      expect(entry?.nextOriginReasonLabel).toBe('振替コマの欠席')
      expect(entry?.absentMakeupOrigins).toBe(1)
    })

    // 2026-07-31 オーナー確定で挙動を反転（旧: 手動追加は在庫会計の対象外＝残0のまま）。
    // 日程表の実績カウントは manualAdded を除外しない（手動追加した通常/振替/増コマも実績 +1 になる）。
    // 休みにすれば実績から外れるため、在庫へ戻さないと1コマ消える。台帳にも積まれない振替コマでは
    // 実際に消滅していた。詳細は docs/spec-makeup-stock.md §B-3。
    it('手動追加の振替コマを休み → 未消化振替へ戻る（実績カウントと整合させる・例外を作らない）', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true })),
      })
      expect(balance).toBe(1)
    })

    it('回帰防止: 削除(抑制)済みの日でも、そのあと休みにすれば未消化振替へ入る（順序方式・後の操作が勝つ）', () => {
      // 「×／コマ削除で消す → コマを足し直す → 休み」の流れ。休み操作が抑制を解除するため残1。
      // 解除は clearMakeupOrigins（ScheduleBoardScreen）が行い、その結果を在庫計算に渡す。
      const suppressedBefore = { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }
      const suppressedAfterAbsence = clearMakeupOrigins(suppressedBefore, STOCK_KEY, MAKEUP_SOURCE_DATE)

      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true })))]],
        manualAdjustments: {},
        suppressedOrigins: suppressedAfterAbsence,
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      expect(entries.find((entry) => entry.key === STOCK_KEY)?.balance).toBe(1)
    })

    it('clearMakeupOrigins: 同じ日付を全件外す／他の日付・他キーは残す／無ければ元のまま', () => {
      const map = {
        [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }, { dateKey: MAKEUP_SOURCE_DATE, slotNumber: 4 }, { dateKey: HOLIDAY_SOURCE_DATE }],
        'student-2__英': [{ dateKey: MAKEUP_SOURCE_DATE }],
      }
      expect(clearMakeupOrigins(map, STOCK_KEY, MAKEUP_SOURCE_DATE)).toEqual({
        [STOCK_KEY]: [{ dateKey: HOLIDAY_SOURCE_DATE }],
        'student-2__英': [{ dateKey: MAKEUP_SOURCE_DATE }],
      })
      // キーの全件が外れたらキーごと消す（空配列を残さない）
      expect(clearMakeupOrigins({ [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }, STOCK_KEY, MAKEUP_SOURCE_DATE)).toEqual({})
      // 対象が無ければ同一参照を返す（無駄な再計算を起こさない）
      expect(clearMakeupOrigins(map, STOCK_KEY, '2026-01-01')).toBe(map)
    })

    it('個別に非表示化(削除)された元コマは復活させない', () => {
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))]],
        manualAdjustments: {},
        suppressedOrigins: { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] },
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      expect(entries.find((entry) => entry.key === STOCK_KEY)).toBeUndefined()
    })
  })

  // ==========================================================================
  // 同日複数コマ（2026-07-31 時限単位化）
  // origin の同一性を「日付」から「日付＋時限」へ広げた。誤減（同じ日の2コマ目が数えられない）を
  // 解消しつつ、誤増（同じ1コマの授業が2件に増える）を起こさないことを両方向で固定する。
  // ==========================================================================
  // 講習側（spec-makeup-stock §B-3 / spec-lecture-stock）: 休みにした講習は未消化“講習”へ戻る。
  // 振替と講習は別経路なので、手動追加の扱いを片方だけ直すと非対称になる（CLAUDE.md の B8）。
  describe('休みで戻す先の判定（講習は未消化講習へ・例外を作らない）', () => {
    it('ストック由来の講習は未消化講習へ戻す', () => {
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'special', specialSessionId: 'session-1', specialStockSource: 'session' })).toBe(true)
    })

    it('回帰防止: 手動追加した講習も未消化講習へ戻す（2026-07-31 オーナー確定・実績カウントと整合）', () => {
      // specialStockSource を判定に使わないことが要点。使うと「手動追加だけ戻らない」例外が復活する。
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'special', specialSessionId: 'session-1', specialStockSource: 'manual' })).toBe(true)
    })

    it('講習期間が特定できない講習コマ（旧データ）は戻さない＝戻し先の行が決まらないため', () => {
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'special', specialSessionId: undefined })).toBe(false)
    })

    it('通常・振替・増コマは講習在庫の対象外（未消化振替へ戻す側）', () => {
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'regular', specialSessionId: 'session-1' })).toBe(false)
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'makeup' })).toBe(false)
      expect(shouldReturnLectureStockOnAbsence({ lessonType: 'extra' })).toBe(false)
    })
  })

  describe('同日に同じ科目が2コマ（時限単位）', () => {
    const cellAt = (slotNumber: number, desk: DeskCell): SlotCell => ({
      ...cellWithDesk(desk),
      id: `cell-${slotNumber}`,
      slotLabel: `${slotNumber}限`,
      slotNumber,
    })

    function balanceOf(params: { weeks: SlotCell[][]; manualAdjustments?: Record<string, ManualMakeupOrigin[]>; suppressedOrigins?: Record<string, ManualMakeupOrigin[]> }) {
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: params.weeks,
        manualAdjustments: params.manualAdjustments ?? {},
        suppressedOrigins: params.suppressedOrigins ?? {},
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      return entries.find((entry) => entry.key === STOCK_KEY)?.balance ?? 0
    }

    it('回帰防止: 同じ日の 4限と5限 を両方休み → 残2（日付でまとめると1コマ消える）', () => {
      expect(balanceOf({
        weeks: [[
          cellAt(4, deskWithStatus(boardStatus({ id: 'status-4', lessonType: 'regular', slotNumber: 4 }))),
          cellAt(5, deskWithStatus(boardStatus({ id: 'status-5', lessonType: 'regular', slotNumber: 5 }))),
        ]],
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }, { dateKey: BOARD_DATE, slotNumber: 5 }] },
      })).toBe(2)
    })

    it('誤増しない: 同じ1コマを指す origin（元コマの休み＋その振替コマの休み）は時限が同じなので残1', () => {
      expect(balanceOf({
        weeks: [[
          // 7/29 5限の通常授業を休み（台帳 origin は 7/29#5）
          // その振替として置いた 8/5 のコマも休み（振替元ラベルから 7/29 5限＝同じトークン）
          cellAt(5, deskWithStatus(boardStatus({
            lessonType: 'makeup',
            makeupSourceDate: MAKEUP_SOURCE_DATE,
            makeupSourceLabel: '2026/7/29(水) 5限',
          }))),
        ]],
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE, slotNumber: 5 }] },
      })).toBe(1)
    })

    it('時限不明の origin は同じ日付の時限つき origin に吸収される（過大計上しない）', () => {
      expect(balanceOf({
        weeks: [[cellAt(5, deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))]],
        // 台帳側は時限つき、算出側（振替元ラベル無し）は時限不明。同じ1コマなので残1。
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE, slotNumber: 5 }] },
      })).toBe(1)
    })

    it('削除(抑制)は時限つきなら同じ日の別コマを巻き込まない', () => {
      expect(balanceOf({
        weeks: [[
          cellAt(4, deskWithStatus(boardStatus({ id: 'status-4', lessonType: 'regular', slotNumber: 4 }))),
          cellAt(5, deskWithStatus(boardStatus({ id: 'status-5', lessonType: 'regular', slotNumber: 5 }))),
        ]],
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }, { dateKey: BOARD_DATE, slotNumber: 5 }] },
        suppressedOrigins: { [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }] },
      })).toBe(1)
    })

    it('後方互換: 時限なしの抑制（旧データ）はその日付を丸ごと落とす', () => {
      expect(balanceOf({
        weeks: [[
          cellAt(4, deskWithStatus(boardStatus({ id: 'status-4', lessonType: 'regular', slotNumber: 4 }))),
          cellAt(5, deskWithStatus(boardStatus({ id: 'status-5', lessonType: 'regular', slotNumber: 5 }))),
        ]],
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }, { dateKey: BOARD_DATE, slotNumber: 5 }] },
        suppressedOrigins: { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] },
      })).toBe(0)
    })

    it('clearMakeupOrigins: 時限を指定した解除は同じ日の別コマの抑制を残す', () => {
      const suppressed = { [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }, { dateKey: BOARD_DATE, slotNumber: 5 }] }
      expect(clearMakeupOrigins(suppressed, STOCK_KEY, BOARD_DATE, 5)).toEqual({
        [STOCK_KEY]: [{ dateKey: BOARD_DATE, slotNumber: 4 }],
      })
      // 時限なしの抑制（旧データ）は時限を指定しても外す（順序方式で「休み」を効かせるため）
      expect(clearMakeupOrigins({ [STOCK_KEY]: [{ dateKey: BOARD_DATE }] }, STOCK_KEY, BOARD_DATE, 5)).toEqual({})
    })

    it('配置の選択: 同じ日付が2件並んでも、選んだ時限の origin が配置に引き継がれる', () => {
      const placementEntry = {
        remainingOriginDates: [BOARD_DATE, BOARD_DATE],
        remainingOriginSlots: [4, 5],
        remainingOriginLabels: ['2026/8/5(水) 4限', '2026/8/5(水) 5限'],
        remainingOriginReasonLabels: ['手動調整', '手動調整'],
        nextOriginDate: BOARD_DATE,
        nextOriginLabel: '2026/8/5(水) 4限',
        nextOriginReasonLabel: '手動調整',
      }
      expect(resolveSelectedMakeupOrigin(placementEntry, `${BOARD_DATE}#5`)).toEqual({
        originDate: BOARD_DATE,
        originLabel: '2026/8/5(水) 5限',
        originReasonLabel: '手動調整',
      })
      // 旧状態（日付だけ）でも壊れない＝同じ日付の先頭に一致させる
      expect(resolveSelectedMakeupOrigin(placementEntry, BOARD_DATE).originLabel).toBe('2026/8/5(水) 4限')
    })
  })

  describe('休み解除(往復)', () => {
    it('移動しただけの振替コマ: 休み解除で盤面へ戻ると残0（休みで+1したぶんが残らない）', () => {
      const balance = stockBalance({
        desk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      })
      expect(balance).toBe(0)
    })

    it('在庫由来の振替コマ: 休み解除で盤面へ戻ると台帳 origin を消化して残0', () => {
      const balance = stockBalance({
        desk: deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        settings: holidaySettings,
      })
      expect(balance).toBe(0)
    })
  })

  describe('隣接する出欠操作（誤増しない）', () => {
    it('振無休(absent-no-makeup)は移動しただけの振替コマでも未消化にしない', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ status: 'absent-no-makeup', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      })
      expect(balance).toBe(0)
    })

    it('出席(attended)は消化済みなので未消化にしない', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      })
      expect(balance).toBe(0)
    })

    it('移動(moved)マーカーは会計を持たない（移動先が保持）ので未消化にしない', () => {
      const balance = stockBalance({
        desk: deskWithStatus(boardStatus({ status: 'moved', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      })
      expect(balance).toBe(0)
    })
  })

  describe('格納(未消化振替へ戻す) の origin 判定', () => {
    const ledgerOriginDates = [HOLIDAY_SOURCE_DATE]

    it('通常授業は当日を origin にして積む', () => {
      expect(resolveStoreMakeupOriginDate({
        student: { lessonType: 'regular' },
        cellDateKey: BOARD_DATE,
        ledgerOriginDates,
      })).toBe(BOARD_DATE)
    })

    it('同日移動した通常授業は元コマ日を origin にして積む', () => {
      expect(resolveStoreMakeupOriginDate({
        student: { lessonType: 'regular', sameDayMoveSourceDate: HOLIDAY_SOURCE_DATE },
        cellDateKey: BOARD_DATE,
        ledgerOriginDates,
      })).toBe(HOLIDAY_SOURCE_DATE)
    })

    it('在庫由来の振替コマは積まない（台帳 origin の再浮上と二重計上になる）', () => {
      expect(resolveStoreMakeupOriginDate({
        student: { lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE },
        cellDateKey: BOARD_DATE,
        ledgerOriginDates,
      })).toBeNull()
    })

    it('回帰防止: 移動しただけの振替コマは振替元日で積む（外した瞬間の消滅を防ぐ）', () => {
      expect(resolveStoreMakeupOriginDate({
        student: { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE },
        cellDateKey: BOARD_DATE,
        ledgerOriginDates,
      })).toBe(MAKEUP_SOURCE_DATE)
    })
  })

  describe('台帳 origin 一覧(collectMakeupOriginDatesByKey)は残数算出と同じ発生源を見る', () => {
    it('自動休校日 origin を含む', () => {
      const originDates = collectMakeupOriginDatesByKey({
        students: [student],
        regularLessons: [regularLesson],
        classroomSettings: holidaySettings,
        weeks: [[cellWithDesk(deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })))]],
        manualAdjustments: {},
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      // 時限単位化以降は `日付#限` のトークン。ここは 5限の通常授業。
      expect(originDates[STOCK_KEY]).toContain(`${HOLIDAY_SOURCE_DATE}#5`)
    })

    it('移動しただけの振替コマが盤面にあるだけでは origin を持たない（＝格納時に積む対象）', () => {
      const originDates = collectMakeupOriginDatesByKey({
        students: [student],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))]],
        manualAdjustments: {},
        resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
        today: TODAY,
      })
      expect(originDates[STOCK_KEY] ?? []).not.toContain(MAKEUP_SOURCE_DATE)
    })
  })

  // ==========================================================================
  // 下流監査（2026-08-01）: 「休みの出欠記録」を**消す側**の操作
  //
  // 上の休み/休み解除/格納は「在庫をどう立てるか」の列。算出方式（台帳へ書き戻さず、absent の
  // 出欠記録が盤面にある限り振替元日を復元する）は、**その記録が残っている間だけ**成立する仮の姿で、
  // 記録を破棄する操作が確定させないと在庫ごと消える。隣接操作でなく**下流操作**の列を固定する。
  // ==========================================================================
  describe('下流: 休みにした記録を破棄する操作', () => {
    const resolveStudentKey = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

    // handleToggleHolidayDate と同じ手順を再現する:
    //   (1) 机1つ分の在庫戻し(reconcileHolidayDeskStockReturns) → (2) 机を破棄 → (3) その日を休日に追加
    function simulateHolidayToggle(desk: DeskCell, options: {
      settings?: ClassroomSettings
      manualAdjustments?: Record<string, ManualMakeupOrigin[]>
    } = {}) {
      const settings = options.settings ?? createSettings()
      const manualAdjustments = options.manualAdjustments ?? {}
      const weeks = [[cellWithDesk(desk)]]
      // ★台帳の判定に算出由来(absent)を含めない。含めると自分自身を見て確定を取りやめ、机の破棄で消える。
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
      const result = reconcileHolidayDeskStockReturns({
        desk,
        cellDateKey: BOARD_DATE,
        cellSlotNumber: 5,
        ledgers: {
          manualLectureStockCounts: {},
          manualLectureStockOrigins: {},
          manualMakeupAdjustments: manualAdjustments,
          fallbackLectureStockStudents: {},
          fallbackMakeupStudents: {},
        },
        managedStudentByAnyName: new Map([[student.name, student]]),
        resolveDisplayName: (name: string) => name,
        resolveStockId: resolveStudentKey,
        ledgerOriginDatesByKey,
      })
      const clearedDesk: DeskCell = { ...desk, statusSlots: undefined, lesson: undefined }
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: { ...settings, holidayDates: [...settings.holidayDates, BOARD_DATE].sort() },
        weeks: [[{ ...cellWithDesk(clearedDesk), isOpenDay: false }]],
        manualAdjustments: result.ledgers.manualMakeupAdjustments,
        resolveStudentKey,
        today: TODAY,
      })
      return { entry: entries.find((item) => item.key === STOCK_KEY), ledgers: result.ledgers }
    }

    it('回帰防止: 移動しただけの振替コマを休み → その日を休日設定 → 振替元日が台帳へ確定して残る（消滅しない）', () => {
      const { entry, ledgers } = simulateHolidayToggle(
        deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '2026/7/29(水) 5限' })),
      )
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: MAKEUP_SOURCE_DATE, slotNumber: 5 }])
      expect(entry?.remainingOriginDates).toContain(MAKEUP_SOURCE_DATE)
    })

    it('回帰防止: 手動追加の振替コマも同じく台帳へ確定する（例外を作らない）', () => {
      const { ledgers } = simulateHolidayToggle(
        deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true })),
      )
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: MAKEUP_SOURCE_DATE }])
    })

    it('誤増しない: 在庫由来の振替コマ(台帳に origin あり)は確定させない（台帳 origin が再浮上するので二重計上になる）', () => {
      const { entry, ledgers } = simulateHolidayToggle(
        deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        { settings: holidaySettings },
      )
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeUndefined()
      expect(entry?.remainingOriginDates.filter((dateKey) => dateKey === HOLIDAY_SOURCE_DATE)).toHaveLength(1)
    })

    it('誤増しない: 通常授業の休みは触らない（mark-absent が手動 origin を積み済み）', () => {
      const manualAdjustments = { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] }
      const { ledgers } = simulateHolidayToggle(deskWithStatus(boardStatus({ lessonType: 'regular' })), { manualAdjustments })
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: BOARD_DATE }])
    })

    it('誤増しない: 同じ元コマを指す休みが同じ机に2件あっても台帳へは1件だけ確定する（算出側のトークン畳みと揃える）', () => {
      const desk: DeskCell = {
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [
          boardStatus({ id: 'status-1', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '2026/7/29(水) 5限' }),
          boardStatus({ id: 'status-2', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '2026/7/29(水) 5限' }),
        ],
        lesson: { id: 'lesson-1', studentSlots: [null, null] },
      }
      const { ledgers } = simulateHolidayToggle(desk)
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toHaveLength(1)
    })

    it('回帰防止: 休みにしたコマの日が非営業日(isOpenDay=false)になっても未消化振替に残る', () => {
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[{ ...cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE }))), isOpenDay: false }]],
        manualAdjustments: {},
        resolveStudentKey,
        today: TODAY,
      })
      expect(entries.find((item) => item.key === STOCK_KEY)?.balance).toBe(1)
    })

    // ------------------------------------------------------------------
    // ★由来による食い違いを作らない（2026-08-02 オーナー指摘の観点）
    //
    // 振替コマには「在庫から出したもの（台帳に origin あり）」と「通常授業を別日へ移動しただけで
    // 在庫を経由していないもの（台帳に origin なし）」がある。**内部の道筋は違ってよいが、
    // ユーザーから見た結果（未消化の残数）は必ず一致していなければならない。**
    // 在庫由来＝台帳 origin が再浮上する／移動由来＝振替元日を台帳へ確定する、で同じ1件になる。
    // ------------------------------------------------------------------
    it('回帰防止: 出席済みの振替コマを休日設定 → 在庫由来と移動由来で残が一致する（当日 origin で積むと崩れる）', () => {
      const movedResult = simulateHolidayToggle(
        deskWithStatus(boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      )
      const stockResult = simulateHolidayToggle(
        deskWithStatus(boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        { settings: holidaySettings },
      )
      // 在庫由来は台帳へ積まず再浮上に任せる／移動由来は振替元日で確定する（道筋は違う）
      expect(stockResult.ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeUndefined()
      expect(movedResult.ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: MAKEUP_SOURCE_DATE }])
      // 結果（残数）は一致する
      expect(movedResult.entry?.balance).toBe(stockResult.entry?.balance)
    })

    it('回帰防止: 振無休の振替コマを休日設定 → 在庫由来と移動由来で残が一致する', () => {
      const moved = simulateHolidayToggle(
        deskWithStatus(boardStatus({ status: 'absent-no-makeup', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      )
      const stock = simulateHolidayToggle(
        deskWithStatus(boardStatus({ status: 'absent-no-makeup', lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        { settings: holidaySettings },
      )
      expect(moved.entry?.balance).toBe(stock.entry?.balance)
    })

    it('移動(moved)マーカーは休日設定でも触らない（会計は移動先のコマが持つ）', () => {
      const { ledgers } = simulateHolidayToggle(
        deskWithStatus(boardStatus({ status: 'moved', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })),
      )
      expect(ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeUndefined()
    })
  })

  // ==========================================================================
  // 「その日の全コマの生徒を削除」(handleClearStudentsOnDate) の在庫会計
  // オーナー確定（2026-08-02）: **在庫から出したコマ（振替・ストック由来の講習）は未消化へ返す。
  // 通常授業・体験・増コマ・手動追加コマは返さず、日程表の希望回数を1減らす。**
  // 「返す＝別日にやる（回数はそのまま）／返さない＝もうやらない（回数−1）」の組み合わせを崩さない。
  // ==========================================================================
  describe('その日の生徒を全コマ削除', () => {
    const resolveStudentKey = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

    function simulateClearDay(desk: DeskCell, options: { settings?: ClassroomSettings } = {}) {
      const settings = options.settings ?? createSettings()
      const ledgerOriginDatesByKey = collectMakeupOriginDatesByKey({
        students: [student],
        regularLessons: [regularLesson],
        classroomSettings: settings,
        weeks: [[cellWithDesk(desk)]],
        manualAdjustments: {},
        resolveStudentKey,
        today: TODAY,
        includeAbsentMakeupOrigins: false,
      })
      const result = reconcileHolidayDeskStockReturns({
        desk,
        cellDateKey: BOARD_DATE,
        cellSlotNumber: 5,
        ledgers: {
          manualLectureStockCounts: {},
          manualLectureStockOrigins: {},
          manualMakeupAdjustments: {},
          fallbackLectureStockStudents: {},
          fallbackMakeupStudents: {},
        },
        managedStudentByAnyName: new Map([[student.name, student]]),
        resolveDisplayName: (name: string) => name,
        resolveStockId: resolveStudentKey,
        ledgerOriginDatesByKey,
        includeRegularLessons: false, // ★休日設定との唯一の違い
      })
      const clearedDesk: DeskCell = { ...desk, statusSlots: undefined, lesson: undefined }
      const entries = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: settings,
        weeks: [[cellWithDesk(clearedDesk)]],
        manualAdjustments: result.ledgers.manualMakeupAdjustments,
        resolveStudentKey,
        today: TODAY,
      })
      return {
        balance: entries.find((item) => item.key === STOCK_KEY)?.balance ?? 0,
        ledgers: result.ledgers,
        returnedEntryIds: result.returnedEntryIds,
      }
    }

    function deskWithStudent(entry: StudentEntry): DeskCell {
      return { id: 'desk-1', teacher: '田中講師', lesson: { id: 'lesson-1', studentSlots: [entry, null] } }
    }

    it('★由来で食い違わない: 在庫由来の振替と移動由来の振替は、どちらも残1になる', () => {
      const moved = simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))
      const stock = simulateClearDay(
        deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        { settings: holidaySettings },
      )
      // 未出欠の配置は在庫由来でも元コマ日を積むが、台帳 origin と**同じ日付**なのでトークンが畳まれて1件になる
      // （在庫由来は積む/積まないどちらでも残1。出欠記録の側は畳めないので台帳判定が必須＝下記の attended 参照）。
      expect(moved.ledgers.manualMakeupAdjustments[STOCK_KEY]).toEqual([{ dateKey: MAKEUP_SOURCE_DATE }])
      // ★結果（ユーザーから見える残数）は由来によらず同じ
      expect(moved.balance).toBe(1)
      expect(stock.balance).toBe(1)
    })

    it('★由来で食い違わない: 出席済みの振替も、在庫由来と移動由来で残が一致する', () => {
      const moved = simulateClearDay(deskWithStatus(boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))
      const stock = simulateClearDay(
        deskWithStatus(boardStatus({ status: 'attended', lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })),
        { settings: holidaySettings },
      )
      expect(moved.balance).toBe(1)
      expect(stock.balance).toBe(1)
    })

    it('通常授業は返さない（呼び出し側が日程表の回数を−1する）', () => {
      const result = simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'regular' })))
      expect(result.ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeUndefined()
      expect(result.returnedEntryIds).toHaveLength(0)
      expect(result.balance).toBe(0)
    })

    it('体験・増コマ（手動追加）は在庫を消費していないので返さない', () => {
      expect(simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'trial', manualAdded: true }))).returnedEntryIds).toHaveLength(0)
      expect(simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'extra', manualAdded: true }))).returnedEntryIds).toHaveLength(0)
    })

    it('手動追加の振替も返さない（在庫を経由していない＝返す先が無い）', () => {
      const result = simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true })))
      expect(result.ledgers.manualMakeupAdjustments[STOCK_KEY]).toBeUndefined()
      expect(result.returnedEntryIds).toHaveLength(0)
    })

    it('ストック由来の講習は未消化講習へ戻す／手動追加の講習は戻さない', () => {
      const session = simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'special', specialStockSource: 'session', specialSessionId: 'sess-1' })))
      expect(Object.values(session.ledgers.manualLectureStockCounts)).toEqual([1])

      const manual = simulateClearDay(deskWithStudent(boardStudent({ lessonType: 'special', specialStockSource: 'manual', specialSessionId: 'sess-1', manualAdded: true })))
      expect(Object.keys(manual.ledgers.manualLectureStockCounts)).toHaveLength(0)
    })

    it('返した分だけ returnedEntryIds に入る（呼び出し側はこれを見て希望回数の−1を飛ばす）', () => {
      const returned = simulateClearDay(deskWithStudent(boardStudent({ id: 'entry-x', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE })))
      expect(returned.returnedEntryIds).toEqual(['entry-x'])
    })
  })

  describe('台帳突き合わせは日付で行う（時限つきトークンでも当てる）', () => {
    it('回帰防止: 台帳が時限つきトークンでも「台帳にある」と判定する（素の includes だと二重に積んで誤増する）', () => {
      expect(ledgerOriginsIncludeDate([`${HOLIDAY_SOURCE_DATE}#5`], HOLIDAY_SOURCE_DATE)).toBe(true)
      expect(ledgerOriginsIncludeDate([`${HOLIDAY_SOURCE_DATE}#5`], MAKEUP_SOURCE_DATE)).toBe(false)
    })

    it('回帰防止: 格納も実際の台帳形式(トークン)で「在庫由来は積まない」と判定できる', () => {
      expect(resolveStoreMakeupOriginDate({
        student: { lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE },
        cellDateKey: BOARD_DATE,
        ledgerOriginDates: [`${HOLIDAY_SOURCE_DATE}#5`],
      })).toBeNull()
    })
  })

  // Issue #58(2026-08-29・手動テスト No.121): 「その日の生徒を全コマ削除」は通常授業を希望回数−1で処分するのに
  // 振替抑制(suppressedMakeupOrigins)を積まない非対称があり、その日を後から休日設定すると自動計算
  // (computeAutomaticShortageOrigins・テンプレ根拠)が振替を積み直していた=「希望−1」と「振替+1」の二重。
  // 単発削除(handleDeleteStudent)と同じ抑制を対称に積む。5週目(授業のない週)対応を可能にする。
  describe('下流: 全コマ削除した日を休日設定する(Issue #58)', () => {
    const resolveStudentKey = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

    it('回帰防止: 全コマ削除で処分した通常授業は、その日を休日設定しても振替に積み直されない', () => {
      const desk = deskWithStudent(boardStudent()) // 通常授業(テンプレ=水5限と同じ枠)
      const suppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(desk),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      expect(suppressions[STOCK_KEY]).toEqual([{ dateKey: BOARD_DATE, slotNumber: 5 }]) // 時限つきで積む

      const clearedDesk: DeskCell = { ...desk, statusSlots: undefined, lesson: undefined }
      const holidayAfterClear = createSettings({ holidayDates: [BOARD_DATE] })
      const balanceOf = (suppressedOrigins: Record<string, ManualMakeupOrigin[]>) => buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: holidayAfterClear,
        weeks: [[cellWithDesk(clearedDesk)]],
        manualAdjustments: {},
        suppressedOrigins,
        resolveStudentKey,
        today: TODAY,
      }).find((item) => item.key === STOCK_KEY)?.balance ?? 0

      expect(balanceOf({})).toBe(1) // 前提: 抑制が無ければテンプレ根拠の自動計算が積み直す(=旧挙動のバグ)
      expect(balanceOf(suppressions)).toBe(0) // 抑制があれば積み直されない
    })

    it('欠席済み(absent)の通常授業には抑制を積まない(立っている在庫を消さない)/実施済み等は積む', () => {
      // absent: mark-absent が台帳へ確定済み。抑制を積むとその在庫まで消える(誤減)ためスキップする。
      const absentDesk = deskWithStatus(boardStatus({ lessonType: 'regular', status: 'absent' }))
      const absentSuppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(absentDesk),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      expect(Object.keys(absentSuppressions)).toHaveLength(0)

      // absent が台帳に立てた在庫は、全コマ削除+休日設定の後も残る(端到端)
      const clearedDesk: DeskCell = { ...absentDesk, statusSlots: undefined, lesson: undefined }
      const balance = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(clearedDesk)]],
        manualAdjustments: { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] }, // mark-absent が積んだ想定
        suppressedOrigins: absentSuppressions,
        resolveStudentKey,
        today: TODAY,
      }).find((item) => item.key === STOCK_KEY)?.balance ?? 0
      expect(balance).toBe(1)

      // 実施済み(attended)・振無休の通常授業は積む(休日設定が積み直すべきでない)
      for (const status of ['attended', 'absent-no-makeup'] as const) {
        const statusSuppressions = collectClearedDayMakeupSuppressions({
          cell: cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'regular', status }))),
          suppressedMakeupOrigins: {},
          resolveStockId: resolveStudentKey,
        })
        expect(statusSuppressions[STOCK_KEY], status).toEqual([{ dateKey: BOARD_DATE, slotNumber: 5 }])
      }
    })

    it('★休日記録(holiday)にも抑制を積まない(休日設定で在庫へ返した1コマが消える・2026-09-16)', () => {
      // holiday は「休日設定の時点で在庫へ返し終えた」表示専用の記録。抑制を積むと、
      // 返したはずの origin が全コマ削除の抑制で落とされて在庫から消える(INV-06 誤減)。moved と同じ側。
      const holidaySuppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'regular', status: 'holiday' }))),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      expect(Object.keys(holidaySuppressions)).toHaveLength(0)
    })

    it('移動済み(moved)マーカーには抑制を積まない(移動先を休みにした算出 origin を消さない・INV監査 2026-08-29)', () => {
      // moved の会計は移動先の振替コマが持つ。移動元日に抑制を積むと、
      // 「移動先の振替を休み→移動元日を全コマ削除」の順で算出復元 origin が消える(誤減)。
      const movedSuppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'regular', status: 'moved' }))),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      expect(Object.keys(movedSuppressions)).toHaveLength(0)
    })

    it('端到端: 移動先の振替を休みにした後、移動元日を全コマ削除しても未消化振替は残1のまま', () => {
      // 移動元(BOARD_DATE=水5限)に moved マーカー、別日に移動先の振替コマの absent 記録(算出復元で残1)。
      const movedMarkerDesk = deskWithStatus(boardStatus({ lessonType: 'regular', status: 'moved' }))
      const absentMakeupCell: SlotCell = {
        id: 'cell-dest',
        dateKey: '2026-08-07',
        dayLabel: '金',
        dateLabel: '8/7',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:00-20:20',
        isOpenDay: true,
        desks: [{
          id: 'desk-dest',
          teacher: '田中講師',
          statusSlots: [boardStatus({ id: 'status-dest', lessonType: 'makeup', status: 'absent', makeupSourceDate: BOARD_DATE, makeupSourceLabel: '2026/8/5(水) 5限', dateKey: '2026-08-07' }), null],
          lesson: { id: 'lesson-dest', studentSlots: [null, null] },
        }],
      }
      // 全コマ削除(移動元日)の抑制収集 → moved はスキップされるので抑制ゼロ
      const suppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(movedMarkerDesk),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      const clearedDesk: DeskCell = { ...movedMarkerDesk, statusSlots: undefined, lesson: undefined }
      const balance = buildMakeupStockEntries({
        students: [student],
        teachers: [teacher],
        regularLessons: [regularLesson],
        classroomSettings: createSettings(),
        weeks: [[cellWithDesk(clearedDesk), absentMakeupCell]],
        manualAdjustments: {},
        suppressedOrigins: suppressions,
        resolveStudentKey,
        today: TODAY,
      }).find((item) => item.key === STOCK_KEY)?.balance ?? 0
      expect(balance).toBe(1) // moved に抑制を積むと 0 に誤減する
    })

    it('同日移動した通常授業の抑制は「テンプレ上の元の時限」で積む(現在の時限だと自動 origin に当たらない)', () => {
      // テンプレ=水5限の授業を同日4限へ移動した状態。盤面の時限(4)で積むと自動計算 origin(5限)と
      // トークンが一致せず、Issue #58 のバグが同日移動の授業でだけ残る。
      const sameDayMoved = deskWithStudent(boardStudent({ sameDayMoveSourceDate: BOARD_DATE, sameDayMoveSourceLabel: '2026/8/5(水) 5限' }))
      const cell: SlotCell = { ...cellWithDesk(sameDayMoved), slotNumber: 4, slotLabel: '4限' }
      const suppressions = collectClearedDayMakeupSuppressions({
        cell,
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      expect(suppressions[STOCK_KEY]).toEqual([{ dateKey: BOARD_DATE, slotNumber: 5 }])
    })

    it('順序方式(後にやった操作が勝つ): 全コマ削除→コマを足し直して休みにすると抑制が解除され振替に入る', () => {
      const suppressions = collectClearedDayMakeupSuppressions({
        cell: cellWithDesk(deskWithStudent(boardStudent())),
        suppressedMakeupOrigins: {},
        resolveStockId: resolveStudentKey,
      })
      // 休み(handleMarkStudentAbsent)側と同じ引数(元日付+時限)で clearMakeupOrigins が解除できる
      const cleared = clearMakeupOrigins(suppressions, STOCK_KEY, BOARD_DATE, 5)
      expect(Object.keys(cleared)).toHaveLength(0)
    })
  })

  // Issue #57(2026-08-29・手動テスト No.113): 生徒移動が移動先スロットの absent 記録を一律 null 化していた。
  // 算出で復元する在庫(移動由来振替の休み)は「盤面に出欠記録がある間だけ」成立するため、記録が消えると
  // 未消化振替が1件無言で消滅していた(誤減)。移動は記録を保持する(消すのは moved マーカーだけ)。
  describe('下流: 欠席記録のある席へ生徒を移動する(Issue #57)', () => {
    it('回帰防止: 移動由来振替の休みが残る席へ別生徒を移動しても、未消化振替が消えない', () => {
      // 欠席記録(移動由来の振替・台帳に origin なし)を持つ机 + 移動元の別コマに生徒
      const targetDesk: DeskCell = {
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE }), null],
        lesson: undefined,
      }
      const sourceCell: SlotCell = {
        id: 'cell-src',
        dateKey: '2026-08-04',
        dayLabel: '火',
        dateLabel: '8/4',
        slotLabel: '5限',
        slotNumber: 5,
        timeLabel: '19:00-20:20',
        isOpenDay: true,
        desks: [{ id: 'desk-src', teacher: '田中講師', lesson: { id: 'lesson-src', studentSlots: [{ id: 'entry-2', name: '別の子', managedStudentId: 'student-2', grade: '中1', subject: '英', lessonType: 'regular', teacherType: 'normal' }, null] } }],
      }
      const weeks: SlotCell[][] = [[sourceCell, cellWithDesk(targetDesk)]]
      const before = stockBalance({ desk: targetDesk })
      expect(before).toBe(1) // 前提: 欠席記録から算出で残1

      const moved = computeStudentMove({
        weeks,
        weekIndex: 0,
        cells: weeks[0],
        movingStudentId: 'entry-2',
        cellId: 'cell-1',
        deskIndex: 0,
        studentIndex: 0,
        suppressedRegularLessonOccurrences: [],
        managedStudentByAnyName: new Map(),
        resolveBoardStudentDisplayName: (name: string) => name,
      })
      expect(moved.status).toBe('moved')
      if (moved.status !== 'moved') return
      const movedDesk = moved.nextWeeks.flat().find((cell) => cell.id === 'cell-1')?.desks[0]
      expect(movedDesk?.lesson?.studentSlots[0]?.managedStudentId).toBe('student-2') // 生徒は配置された
      const after = stockBalance({ desk: movedDesk! })
      expect(after).toBe(1) // 欠席記録が保持され、未消化振替は消えない(修正なしだと 0 に誤減)
    })
  })
})

// ============================================================================
// 行: 退塾スイープ(オーナー確定 2026-09-20・確認リスト b-2) × 未消化振替の残数
//   退塾で今日以降の痕跡を消すとき **未消化へは戻さない**(台帳へ +1 しない)。ただし「消したことで在庫が湧く」
//   のは誤増なので、消す振替コマの振替元日だけ抑止へ積む(1コマ削除 handleDeleteStudent と同じ流儀)。
//   逆に、立っている在庫(台帳 origin / 昨日以前の記録)は掃除で減らさない(誤減もさせない)。
// ============================================================================
describe('INV-06 マトリクス: 退塾スイープは在庫を増やさず減らさない', () => {
  const SWEEP_FROM = '2026-07-31'
  const resolveStockIdForSweep = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

  function balanceOf(params: { weeks: SlotCell[][]; suppressedOrigins?: Record<string, ManualMakeupOrigin[]>; manualAdjustments?: Record<string, ManualMakeupOrigin[]>; settings?: ClassroomSettings }) {
    const entries = buildMakeupStockEntries({
      students: [student],
      teachers: [teacher],
      regularLessons: [regularLesson],
      classroomSettings: params.settings ?? createSettings(),
      weeks: params.weeks,
      manualAdjustments: params.manualAdjustments ?? {},
      suppressedOrigins: params.suppressedOrigins ?? {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: TODAY,
    })
    return entries.find((entry) => entry.key === STOCK_KEY)?.balance ?? 0
  }

  it('在庫由来の振替コマを退塾で消しても未消化は湧かない(抑止を積まないと誤増 +1 になる)', () => {
    // 元コマ 7/22 を休日設定＝台帳(自動休校日)に origin あり。その振替を 8/5 に置いてあるので残 0。
    const weeks: SlotCell[][] = [[cellWithDesk(deskWithStudent(boardStudent({ lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE })))]]
    expect(balanceOf({ weeks, settings: holidaySettings })).toBe(0)

    const sweep = computeStudentWithdrawSweep({
      weeks,
      students: [student],
      studentId: 'student-1',
      fromDateKey: SWEEP_FROM,
      suppressedMakeupOrigins: {},
      resolveStockId: resolveStockIdForSweep,
    })
    expect(sweep.changed).toBe(true)
    expect(sweep.nextSuppressedMakeupOrigins).toEqual({ [STOCK_KEY]: [{ dateKey: HOLIDAY_SOURCE_DATE }] })
    // 抑止つき(実装)= 0 のまま。抑止なし = 1 に誤増する(＝この抑止を外すとテストが落ちる)。
    expect(balanceOf({ weeks: sweep.nextWeeks, settings: holidaySettings, suppressedOrigins: sweep.nextSuppressedMakeupOrigins })).toBe(0)
    expect(balanceOf({ weeks: sweep.nextWeeks, settings: holidaySettings })).toBe(1)
  })

  it('講習の席・体験・増コマを消しても未消化振替は動かない。既に立っている台帳 origin も減らさない(誤減防止)', () => {
    const weeks: SlotCell[][] = [[cellWithDesk({
      id: 'desk-1',
      teacher: '田中講師',
      lesson: { id: 'lesson-1', studentSlots: [boardStudent({ lessonType: 'special', specialSessionId: 'sess-1' }), boardStudent({ id: 'entry-extra', lessonType: 'extra' })] },
    })]]
    // 台帳に手動 origin が 1 件立っている(退塾前からの未消化振替)。
    const manualAdjustments = { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }
    expect(balanceOf({ weeks, manualAdjustments })).toBe(1)

    const sweep = computeStudentWithdrawSweep({
      weeks,
      students: [student],
      studentId: 'student-1',
      fromDateKey: SWEEP_FROM,
      suppressedMakeupOrigins: {},
      resolveStockId: resolveStockIdForSweep,
    })
    expect(sweep.removedSeatCount).toBe(2)
    // 講習・増コマは在庫の抑止対象ではない(講習残数は提出希望数±デルタ台帳で決まり盤面を走査しない)。
    expect(sweep.nextSuppressedMakeupOrigins).toEqual({})
    expect(balanceOf({ weeks: sweep.nextWeeks, manualAdjustments, suppressedOrigins: sweep.nextSuppressedMakeupOrigins })).toBe(1)
  })

  it('休み(absent)の記録を消しても、立っている台帳 origin は抑止しない(誤減させない)', () => {
    const weeks: SlotCell[][] = [[cellWithDesk(deskWithStatus(boardStatus({ lessonType: 'regular', status: 'absent' })))]]
    const manualAdjustments = { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] }
    expect(balanceOf({ weeks, manualAdjustments })).toBe(1)

    const sweep = computeStudentWithdrawSweep({
      weeks,
      students: [student],
      studentId: 'student-1',
      fromDateKey: SWEEP_FROM,
      suppressedMakeupOrigins: {},
      resolveStockId: resolveStockIdForSweep,
    })
    expect(sweep.removedStatusCount).toBe(1)
    expect(sweep.nextSuppressedMakeupOrigins).toEqual({})
    // 記録は消えるが台帳 origin は残るので残 1(退塾生の在庫は一覧から excludeWithdrawnStudentStockEntries が隠す)。
    expect(balanceOf({ weeks: sweep.nextWeeks, manualAdjustments, suppressedOrigins: sweep.nextSuppressedMakeupOrigins })).toBe(1)
  })
})

// ============================================================================
// INV-06: 台帳 origin を 1 件外すときは「積んだときと同じ形」を外す(removeMakeupOrigin)
//
// なぜ 1 件だけのために表を足すか(レビュー指摘 2026-09-21): 同じ日付には「時限つき」の origin
// (×/コマ削除の抑制など、時限が特定できる操作)と「時限なし」の origin(休み・休日設定など、その日の
// 全 origin を指すワイルドカード)が**併存しうる**。件数だけ合わせて先頭を外すと、残数は合っているのに
// 照合先が入れ替わり(makeupStock.ts resolveEffectiveMakeupOriginDates)、以後の消化判定がずれて残数が狂う。
// 呼び出し側(欠席解除 handleClearStudentStatus / テンプレ上書き)は時限を渡さない＝「時限なしで積んだ分」を
// 外す意図なので、時限なしを優先して外すことをここで固定する。
// ============================================================================
describe('INV-06: removeMakeupOrigin は積んだときと同じ形の origin を外す', () => {
  const ORIGIN_DATE = '2026-08-05'
  const both = { [STOCK_KEY]: [{ dateKey: ORIGIN_DATE, slotNumber: 4 }, { dateKey: ORIGIN_DATE }] }

  it('★同じ日に時限つき/時限なしが併存するとき、時限を渡さない呼び出しは時限なしを外す(削除抑制を巻き込まない)', () => {
    // 欠席解除・テンプレ上書きの呼び出しは時限を渡さない(= 休み/休日設定が時限なしで積んだ分を外す)。
    expect(removeMakeupOrigin(both, STOCK_KEY, ORIGIN_DATE)[STOCK_KEY])
      .toEqual([{ dateKey: ORIGIN_DATE, slotNumber: 4 }])
    expect(removeMakeupOrigin(both, STOCK_KEY, ORIGIN_DATE, null)[STOCK_KEY])
      .toEqual([{ dateKey: ORIGIN_DATE, slotNumber: 4 }])
    // 対照: 時限つきで積んだ分を外すときは同じ時限のものだけが消える(時限なしは残る)。
    expect(removeMakeupOrigin(both, STOCK_KEY, ORIGIN_DATE, 4)[STOCK_KEY]).toEqual([{ dateKey: ORIGIN_DATE }])
    // 入力は書き換えない(純関数)。
    expect(both[STOCK_KEY]).toEqual([{ dateKey: ORIGIN_DATE, slotNumber: 4 }, { dateKey: ORIGIN_DATE }])
  })

  it('積んだ時限が台帳に無ければ 時限なし → 同日の先頭 の順で落とす。日付が無ければ何も変えない', () => {
    // 5 限で積んだつもりが台帳に無い(旧データ) → ワイルドカード(時限なし)を外す。
    expect(removeMakeupOrigin(both, STOCK_KEY, ORIGIN_DATE, 5)[STOCK_KEY]).toEqual([{ dateKey: ORIGIN_DATE, slotNumber: 4 }])
    // 時限なしも無ければ同日の先頭(件数だけは必ず合わせる=誤増を残さない)。
    const onlySlotted = { [STOCK_KEY]: [{ dateKey: ORIGIN_DATE, slotNumber: 4 }] }
    expect(removeMakeupOrigin(onlySlotted, STOCK_KEY, ORIGIN_DATE, 5)[STOCK_KEY]).toBeUndefined()
    // その日付の origin が無ければ台帳をそのまま返す(別の日を減らさない)。
    expect(removeMakeupOrigin(both, STOCK_KEY, '2026-08-06', 4)).toBe(both)
  })
})

// ============================================================================
// INV-06 拡張（2026-09-29 オーナー確定・Issue #72）: テンプレ差分反映の保存前後で未消化振替の残数が一致する
//
// 保証（docs/spec-invariants.md INV-06「テンプレ差分反映と保留（2 行）中の在庫」）:
//   テンプレ保存そのものでは、どの生徒×科目の未消化振替も増減しない。保留の下段に置かれた振替は消化済みのまま、
//   机に残した欠席記録・席不足で下段へ入った欠席記録も在庫の根拠のまま。
// 属人化の注意（台帳の記述どおり）: 振替の残数は盤面の走査で決まるので、下段を別マップに置くと走査から漏れて
//   保存だけで在庫が増える／欠席由来の在庫が消える。消化・欠席由来の走査に下段を 3 本目として含める
//   （buildMakeupStockEntries の templatePendingDesks）。各行の最後で「下段を走査しないと食い違う」ことも確かめる。
// 行: 振替の下段 / 机に残した欠席記録 / 席不足で下段に入った欠席記録 / 同日移動。
// ============================================================================
describe('INV-06 拡張: テンプレ差分反映の保存前後で未消化振替の残数が一致する（spec-template-behavior 条件 9・9-2）', () => {
  const WEEK_START_KEY = '2026-08-03'
  const WEEK_END_KEY = '2026-08-09'
  const CELL = `${BOARD_DATE}_5`
  const extraStudents: StudentRow[] = [
    { ...student, id: 'student-2', name: '二宮 花子', displayName: '二宮' },
    { ...student, id: 'student-3', name: '三好 次郎', displayName: '三好' },
  ]
  const allStudents = [student, ...extraStudents]
  const diffSettings = (overrides: Partial<ClassroomSettings> = {}) => createSettings({ deskCount: 2, templateFreezeBeforeDate: BOARD_DATE, ...overrides })
  const templateRow = (id: string, student1Id: string, student2Id = ''): RegularLessonRow => ({ ...regularLesson, id, student1Id, subject1: '数', student2Id, subject2: student2Id ? '数' : '' })

  function buildBoard(settings: ClassroomSettings, update: (desks: DeskCell[]) => DeskCell[]): SlotCell[] {
    const week = buildManagedScheduleCellsForRange({
      range: { startDate: WEEK_START_KEY, endDate: WEEK_END_KEY, periodValue: '', personId: '' },
      fallbackStartDate: WEEK_START_KEY,
      fallbackEndDate: WEEK_END_KEY,
      classroomSettings: settings,
      teachers: [teacher],
      students: allStudents,
      regularLessons: [regularLesson],
      boardWeeks: [],
    })
    return week.map((cell) => (cell.id === CELL ? { ...cell, desks: update(cell.desks) } : cell))
  }

  function save(week: SlotCell[], settings: ClassroomSettings, rows: RegularLessonRow[], suppressed: string[] = []) {
    return computeTemplateDiffApplyForBoard({
      weeks: [week],
      classroomSettings: settings,
      teachers: [teacher],
      students: allStudents,
      regularLessons: rows,
      effectiveStartDate: BOARD_DATE,
      suppressedRegularLessonOccurrences: suppressed,
      templatePendingDesks: {},
      createdAt: '2026-07-31T00:00:00.000Z',
    })
  }

  function stock(weeks: SlotCell[][], settings: ClassroomSettings, rows: RegularLessonRow[], manualAdjustments: Record<string, ManualMakeupOrigin[]> = {}, templatePendingDesks?: TemplatePendingDeskMap) {
    return buildMakeupStockEntries({
      students: allStudents,
      teachers: [teacher],
      regularLessons: rows,
      classroomSettings: settings,
      weeks,
      manualAdjustments,
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id,
      today: TODAY,
      templatePendingDesks,
    }).find((entry) => entry.key === STOCK_KEY)?.balance ?? 0
  }

  it('振替の下段: 在庫由来の振替コマが保留の下段へ入っても消化済みのまま（残0のまま・下段を走査しないと残1に増える）', () => {
    const settings = diffSettings({ holidayDates: [HOLIDAY_SOURCE_DATE] })
    const week = buildBoard(settings, (desks) => desks.map((desk, index) => (index === 1
      ? { ...desk, teacher: '田中講師', lesson: { id: 'makeup-lesson', studentSlots: [boardStudent({ id: 'makeup-entry', lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE }), null] } }
      : desk)))
    // 新テンプレは机 1 に別の生徒を置く → 中身が違うので保留（下段に振替コマ）
    const rows = [templateRow('regular-1', 'student-1'), templateRow('regular-2', 'student-2')]
    const before = stock([week], settings, rows)
    const result = save(week, settings, rows)
    const key = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_2`)
    expect(result.nextPendingDesks[key]?.lower.lesson?.studentSlots[0]?.lessonType).toBe('makeup')
    expect(before).toBe(0)
    expect(stock(result.nextWeeks, settings, rows, {}, result.nextPendingDesks)).toBe(before)
    expect(stock(result.nextWeeks, settings, rows)).toBe(1)
  })

  it('机に残した欠席記録: 通常授業の欠席（手動 origin）は保存前後で残1のまま、記録は机に残る', () => {
    const settings = diffSettings()
    const suppressed = [buildManagedOccurrenceKey(boardStudent(), BOARD_DATE, 5)]
    const week = buildBoard(settings, (desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined, statusSlots: [boardStatus({ lessonType: 'regular' }), null] } : desk)))
    const rows = [templateRow('regular-1', 'student-1'), templateRow('regular-2', 'student-2')]
    const manual = { [STOCK_KEY]: [{ dateKey: BOARD_DATE }] }
    const before = stock([week], settings, rows, manual)
    const result = save(week, settings, rows, suppressed)
    const desk0 = result.nextWeeks[0].find((cell) => cell.id === CELL)!.desks[0]
    expect(desk0.statusSlots?.[0]?.status).toBe('absent')
    expect(before).toBe(1)
    expect(stock(result.nextWeeks, settings, rows, manual, result.nextPendingDesks)).toBe(before)
  })

  it('席不足でも欠席記録は机に残る（Q37・2026-10-03）: 移動しただけの振替コマの欠席（記録から算出する origin）は上段 2 人の下に残り、残1のまま', () => {
    // 旧（〜v1.5.577・Q21-10）: 上段 2 人＋会計記録 1 件 > 2 席 → 記録だけ下段へ退避。Q37 で休み・振無休の記録は席を確保せず元の席に残る
    // （盤面の通常操作で「休みにした席へ生徒を置く」と同じ形）。在庫は机の記録から数えるので下段の走査に依らない。
    const settings = diffSettings()
    const week = buildBoard(settings, (desks) => desks.map((desk, index) => (index === 0
      ? { ...desk, lesson: undefined, statusSlots: [boardStatus({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '7/29(水) 5限' }), null] }
      : desk)))
    const rows = [templateRow('regular-1', 'student-2', 'student-3')]
    const before = stock([week], settings, rows)
    const result = save(week, settings, rows)
    const key = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)
    expect(result.nextPendingDesks[key]).toBeUndefined()
    const desk0 = result.nextWeeks[0].find((cell) => cell.id === CELL)!.desks[0]
    expect(desk0.lesson?.studentSlots.map((item) => item?.managedStudentId ?? null)).toEqual(['student-2', 'student-3'])
    expect(desk0.statusSlots?.map((item) => item?.status ?? null)).toEqual(['absent', null])
    expect(before).toBe(1)
    expect(stock(result.nextWeeks, settings, rows, {}, result.nextPendingDesks)).toBe(before)
    expect(stock(result.nextWeeks, settings, rows)).toBe(before)
  })

  it('同日移動: 同じコマの別の机へ移した通常授業は、保存後も 1 か所に生きて残数が変わらない', () => {
    const settings = diffSettings()
    const suppressed = [buildManagedOccurrenceKey(boardStudent(), BOARD_DATE, 5)]
    const week = buildBoard(settings, (desks) => desks.map((desk, index) => {
      if (index === 0) return { ...desk, lesson: undefined }
      return { ...desk, lesson: { id: 'daymove', studentSlots: [boardStudent({ id: 'moved-entry', sameDayMoveSourceDate: BOARD_DATE, sameDayMoveSourceLabel: '8/5(水) 5限' }), null] } }
    }))
    const rows = [templateRow('regular-1', 'student-1')]
    const manual = { [STOCK_KEY]: [{ dateKey: '2026-07-15' }] }
    const before = stock([week], settings, rows, manual)
    const result = save(week, settings, rows, suppressed)
    const cell = result.nextWeeks[0].find((entry) => entry.id === CELL)!
    const living = cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []).filter((entry) => entry?.managedStudentId === 'student-1')
    expect(living).toHaveLength(1)
    expect(stock(result.nextWeeks, settings, rows, manual, result.nextPendingDesks)).toBe(before)
  })
})

// ============================================================================
// INV-06 拡張（2026-09-29 オーナー確定・Issue #72）: 保留（2 行）の**解決操作**の在庫の動き（regression-reviewer R-1）
//
// 保証（docs/spec-invariants.md INV-06「テンプレ差分反映と保留（2 行）中の在庫」）:
//   在庫が動くのは、上段の休み（既存の欠席処理）・下段の削除（既存の削除処理どおり戻す）・「テンプレを採用」で下段を捨てたとき
//   （削除と同じ在庫処理）だけ。「既存を採用」は在庫を動かさない。
// 行（spec-template-behavior 条件 10〜13・15。在庫の権威関数は全コマ削除と同じ reconcileHolidayDeskStockReturns）:
//   下段の削除 × 在庫由来（自動休校日 origin・手動 origin・振替コマの欠席から算出する origin）→ +1 ちょうど（+2 にならない）／手動追加 → ±0
//   テンプレを採用 → 在庫由来だけ +1・手動追加 ±0
//   既存を採用 → 在庫 ±0。取り下げた上段の通常授業は、同じ日に授業が残らなければ希望回数 −1／残れば据え置き（Q26-1）
//   上段の休み → 1 行の机で休みにしたときと同じ残数（既存の欠席処理どおり）・下段の振替は消化済みのまま
//   下段の同日移動の通常授業を捨てる（テンプレを採用／下段の削除）→ 在庫 ±0・同じ日に残らなければ希望回数 −1／残れば据え置き（N-2・Q26-1 の拡張）
// 兄弟監査: 削除⇄テンプレを採用⇄既存を採用⇄上段の休み × 在庫由来の振替・手動追加の振替・同日移動の通常授業。
// ============================================================================
describe('INV-06 拡張: 保留（2 行）の解決操作で在庫が動く量（spec-template-behavior 条件 10〜13・15）', () => {
  const WEEK_START_KEY = '2026-08-03'
  const WEEK_END_KEY = '2026-08-09'
  const PREV_WEEK_START_KEY = '2026-07-27'
  const PREV_WEEK_END_KEY = '2026-08-02'
  const CELL = `${BOARD_DATE}_5`
  const DESK1 = `${CELL}_desk_2`
  const ABSENT_ORIGIN_DATE = '2026-07-15' // 振替コマの欠席から算出する origin の振替元（台帳に無い）
  const STOCK_KEY_2 = 'student-2__数'
  const STOCK_KEY_3 = 'student-3__数'
  const allStudents: StudentRow[] = [
    student,
    { ...student, id: 'student-2', name: '二宮 花子', displayName: '二宮' },
    { ...student, id: 'student-3', name: '三好 次郎', displayName: '三好' },
  ]
  const settings = createSettings({ deskCount: 2, templateFreezeBeforeDate: BOARD_DATE, holidayDates: [HOLIDAY_SOURCE_DATE] })
  const templateRow = (id: string, student1Id: string, extra: Partial<RegularLessonRow> = {}): RegularLessonRow => ({ ...regularLesson, id, student1Id, subject1: '数', ...extra })
  const entryOf = (studentId: string, overrides: Partial<StudentEntry> = {}): StudentEntry => {
    const row = allStudents.find((item) => item.id === studentId)!
    return boardStudent({ id: `${studentId}-${overrides.lessonType ?? 'regular'}-entry`, name: row.name, managedStudentId: studentId, ...overrides })
  }
  const context = {
    managedStudentByAnyName: new Map<string, StudentRow>(allStudents.map((row) => [row.name, row])),
    resolveDisplayName: (name: string) => name,
    resolveStockId: (entry: StudentEntry) => entry.managedStudentId ?? entry.id,
  }

  function week(start: string, end: string) {
    return buildManagedScheduleCellsForRange({
      range: { startDate: start, endDate: end, periodValue: '', personId: '' },
      fallbackStartDate: start,
      fallbackEndDate: end,
      classroomSettings: createSettings({ deskCount: 2 }),
      teachers: [teacher],
      students: allStudents,
      regularLessons: [regularLesson],
      boardWeeks: [],
    })
  }

  // 机 1（index 1）に lowerStudents を置いた盤面を差分反映で保存し、机 1 を保留（2 行）にする。
  function pendingBoard(params: { lowerStudents: [StudentEntry, StudentEntry | null]; rows: RegularLessonRow[]; previousWeek?: SlotCell[]; suppressed?: string[] }) {
    const board = week(WEEK_START_KEY, WEEK_END_KEY).map((cell) => (cell.id !== CELL ? cell : {
      ...cell,
      desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, teacher: '田中講師', lesson: { id: 'hand-placed', studentSlots: params.lowerStudents } } : desk)),
    }))
    const weeks = params.previousWeek ? [params.previousWeek, board] : [board]
    const diff = computeTemplateDiffApplyForBoard({
      weeks,
      classroomSettings: settings,
      teachers: [teacher],
      students: allStudents,
      regularLessons: params.rows,
      effectiveStartDate: BOARD_DATE,
      suppressedRegularLessonOccurrences: params.suppressed ?? [],
      templatePendingDesks: {},
      createdAt: '2026-07-31T00:00:00.000Z',
    })
    const key = buildTemplatePendingDeskKey(CELL, DESK1)
    expect(diff.nextPendingDesks[key], '机 1 が保留（2 行）になる前提').toBeDefined()
    const removed = new Set(diff.removedSuppressedRegularLessonOccurrences)
    return { weeks: diff.nextWeeks, pending: diff.nextPendingDesks, key, rows: params.rows, suppressed: [...(params.suppressed ?? []).filter((item) => !removed.has(item)), ...diff.addedSuppressedRegularLessonOccurrences] }
  }

  function ledgersOf(manual: Record<string, ManualMakeupOrigin[]>, extra: Partial<TemplatePendingResolutionLedgers> = {}): TemplatePendingResolutionLedgers {
    return {
      manualLectureStockCounts: {},
      manualLectureStockOrigins: {},
      manualMakeupAdjustments: manual,
      fallbackLectureStockStudents: {},
      fallbackMakeupStudents: {},
      suppressedMakeupOrigins: {},
      suppressedRegularLessonOccurrences: [],
      scheduleCountAdjustments: [],
      ...extra,
    }
  }

  // 盤面の useMemo(ledgerMakeupOriginDatesByKey) と同じ: 算出由来(absent)を除いた台帳 origin。
  function ledgerOrigins(weeks: SlotCell[][], rows: RegularLessonRow[], ledgers: TemplatePendingResolutionLedgers) {
    return collectMakeupOriginDatesByKey({
      students: allStudents,
      regularLessons: rows,
      classroomSettings: settings,
      weeks,
      manualAdjustments: ledgers.manualMakeupAdjustments,
      suppressedOrigins: ledgers.suppressedMakeupOrigins,
      resolveStudentKey: context.resolveStockId,
      today: TODAY,
      includeAbsentMakeupOrigins: false,
    })
  }

  function balances(weeks: SlotCell[][], rows: RegularLessonRow[], pending: TemplatePendingDeskMap, ledgers: TemplatePendingResolutionLedgers) {
    const entries = buildMakeupStockEntries({
      students: allStudents,
      teachers: [teacher],
      regularLessons: rows,
      classroomSettings: settings,
      weeks,
      manualAdjustments: ledgers.manualMakeupAdjustments,
      suppressedOrigins: ledgers.suppressedMakeupOrigins,
      resolveStudentKey: context.resolveStockId,
      today: TODAY,
      templatePendingDesks: pending,
    })
    const of = (key: string) => entries.find((entry) => entry.key === key)?.balance ?? 0
    return { s1: of(STOCK_KEY), s2: of(STOCK_KEY_2), s3: of(STOCK_KEY_3) }
  }

  function resolve(mode: 'adopt-template' | 'adopt-existing' | 'delete-lower-student', setup: ReturnType<typeof pendingBoard>, ledgers: TemplatePendingResolutionLedgers, lowerIndex?: number) {
    const result = computePendingDeskResolution({
      mode,
      weeks: setup.weeks,
      cellId: CELL,
      deskId: DESK1,
      lowerIndex,
      templatePendingDesks: setup.pending,
      ledgers,
      ledgerOriginDatesByKey: ledgerOrigins(setup.weeks, setup.rows, ledgers),
      ...context,
    })
    if (result.status !== 'applied') throw new Error(result.message)
    return result
  }

  const liveOnDate = (weeks: SlotCell[][], studentId: string) => weeks.flat().filter((cell) => cell.dateKey === BOARD_DATE)
    .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
    .filter((entry) => entry?.managedStudentId === studentId).length

  // 生徒 1 は新テンプレでも水曜 5 限（机 0）＝自動休校日 origin（7/22）がテンプレを根拠に立つ。机 1 はテンプレの生徒 2。
  const rowsWithStudent1 = [templateRow('regular-1', 'student-1'), templateRow('regular-2', 'student-2')]
  // 生徒 1 をテンプレから外した版（既存を採用で同じコマに二重に生きないように）。
  const rowsWithoutStudent1 = [templateRow('regular-1', 'student-3'), templateRow('regular-2', 'student-2')]

  describe('下段の削除（条件 11）: 在庫由来 +1 ちょうど・手動追加 ±0', () => {
    it.each([
      ['自動休校日 origin（テンプレ根拠・台帳）', HOLIDAY_SOURCE_DATE, {}],
      ['手動 origin（台帳）', MAKEUP_SOURCE_DATE, { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }],
    ] as Array<[string, string, Record<string, ManualMakeupOrigin[]>]>)('在庫由来の振替（%s）を下段から削除 → 未消化 +1 ちょうど（+2 にならない）', (_label, sourceDate, manual) => {
      const setup = pendingBoard({ lowerStudents: [entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: sourceDate, makeupSourceLabel: '水 5限' }), null], rows: rowsWithStudent1 })
      const ledgers = ledgersOf({ ...manual })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve('delete-lower-student', setup, ledgers, 0)
      expect(result.returnedCount).toBe(1)
      const after = balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)
      expect(after.s1).toBe(before.s1 + 1)
      expect(after.s2).toBe(before.s2)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([])
    })

    it('欠席由来 origin（振替コマの欠席から算出・台帳に無い）の振替を下段から削除 → 未消化 +1 ちょうど（+2 にならない）', () => {
      // 前週 7/29 の振替コマ（振替元 7/15・移動しただけ）を休みにした記録 → 7/15 の origin を算出で復元。それを 8/5 へ振替として配置済み。
      const previousWeek = week(PREV_WEEK_START_KEY, PREV_WEEK_END_KEY).map((cell) => (cell.id !== `${MAKEUP_SOURCE_DATE}_5` ? cell : {
        ...cell,
        desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined, statusSlots: [boardStatus({ lessonType: 'makeup', dateKey: MAKEUP_SOURCE_DATE, makeupSourceDate: ABSENT_ORIGIN_DATE, makeupSourceLabel: '7/15(水) 5限' }), null] as DeskCell['statusSlots'] } : desk)),
      }))
      const setup = pendingBoard({
        previousWeek,
        lowerStudents: [entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: ABSENT_ORIGIN_DATE, makeupSourceLabel: '7/15(水) 5限' }), null],
        rows: rowsWithStudent1,
      })
      const ledgers = ledgersOf({})
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      // 前提: 算出 origin（7/15）は下段の振替で消化済み（下段を走査しないと残が 1 多く見える＝保存で増えない側の固定と同じ）
      expect(balances(setup.weeks, setup.rows, {}, ledgers).s1).toBe(before.s1 + 1)
      const result = resolve('delete-lower-student', setup, ledgers, 0)
      const after = balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)
      expect(after.s1).toBe(before.s1 + 1)
    })

    it('手動追加の振替を下段から削除 → 未消化 ±0（消化していないので戻さない・振替元も抑制しない）', () => {
      const setup = pendingBoard({ lowerStudents: [entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true }), null], rows: rowsWithStudent1 })
      const ledgers = ledgersOf({ [STOCK_KEY]: [{ dateKey: HOLIDAY_SOURCE_DATE, slotNumber: 4 }] })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve('delete-lower-student', setup, ledgers, 0)
      expect(result.returnedCount).toBe(0)
      expect(balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)).toEqual(before)
      expect(result.ledgers.suppressedMakeupOrigins).toEqual({})
    })
  })

  describe('テンプレを採用（条件 12）: 在庫由来だけ +1・手動追加 ±0・希望回数は動かさない', () => {
    it('下段に在庫由来（生徒 1）と手動追加（生徒 3）の振替 → 生徒 1 だけ +1、生徒 3 は ±0', () => {
      const setup = pendingBoard({
        lowerStudents: [
          entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: HOLIDAY_SOURCE_DATE, makeupSourceLabel: '7/22(水) 5限' }),
          entryOf('student-3', { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, manualAdded: true }),
        ],
        rows: rowsWithStudent1,
      })
      const ledgers = ledgersOf({ [STOCK_KEY_3]: [{ dateKey: '2026-07-08' }] })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve('adopt-template', setup, ledgers)
      const after = balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)
      expect(after.s1).toBe(before.s1 + 1)
      expect(after.s3).toBe(before.s3)
      expect(after.s2).toBe(before.s2)
      expect(result.returnedCount).toBe(1)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([])
      expect(result.nextTemplatePendingDesks).toEqual({})
    })
  })

  describe('既存を採用（条件 13）: 在庫 ±0・希望回数は同じ日に授業が残るかで決まる（Q26-1）', () => {
    const lower: [StudentEntry, null] = [entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '7/29(水) 5限' }), null]
    const manual = { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }

    it('取り下げた上段（生徒 2）が同じ日に残らない → 在庫 ±0・希望回数 −1（単発削除と同じ）', () => {
      const setup = pendingBoard({ lowerStudents: lower, rows: rowsWithoutStudent1 })
      const ledgers = ledgersOf({ ...manual })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve('adopt-existing', setup, ledgers)
      expect(balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)).toEqual(before)
      expect(liveOnDate(result.nextWeeks, 'student-2')).toBe(0)
      expect(result.countAdjustedCount).toBe(1)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([{ studentKey: 'student-2', subject: '数', countKind: 'regular', dateKey: BOARD_DATE, delta: -1 }])
    })

    it('取り下げた上段（生徒 2）が同じ日の別の時限に残る → 在庫 ±0・希望回数は据え置き', () => {
      const rows = [...rowsWithoutStudent1, templateRow('regular-9', 'student-2', { slotNumber: 4 })]
      const setup = pendingBoard({ lowerStudents: lower, rows })
      const ledgers = ledgersOf({ ...manual })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve('adopt-existing', setup, ledgers)
      expect(balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)).toEqual(before)
      expect(liveOnDate(result.nextWeeks, 'student-2')).toBe(1)
      expect(result.countAdjustedCount).toBe(0)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([])
    })
  })

  describe('上段の休み（条件 15）: 1 行の机で休みにしたときと同じ残数・下段の振替は消化済みのまま', () => {
    it('上段の生徒 2 を休み（既存の欠席処理＝当日の手動 origin）→ 1 行に戻り、生徒 2 は +1・生徒 1 の振替は消化済みのまま（1 行の机と同じ）', () => {
      const setup = pendingBoard({ lowerStudents: [entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '7/29(水) 5限' }), null], rows: rowsWithoutStudent1 })
      const baseManual = { [STOCK_KEY]: [{ dateKey: MAKEUP_SOURCE_DATE }] }
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgersOf(baseManual))
      // 既存の欠席処理（markStudentAbsentAt）の結果: 上段の席を出欠記録へ移し、通常授業なので当日の手動 origin を積む。
      const absent = (weeks: SlotCell[][]) => weeks.map((cells) => cells.map((cell) => (cell.id !== CELL ? cell : {
        ...cell,
        desks: cell.desks.map((desk) => (desk.id !== DESK1 ? desk : {
          ...desk,
          lesson: undefined,
          statusSlots: [boardStatus({ id: 'absent-2', studentId: 'student-2', name: '二宮 花子', managedStudentId: 'student-2' }), null] as DeskCell['statusSlots'],
        })),
      })))
      const absentLedgers = ledgersOf({ ...baseManual, [STOCK_KEY_2]: [{ dateKey: BOARD_DATE }] })
      const settled = settleTemplatePendingDesksAfterCommit({ previousWeeks: setup.weeks, previousTemplatePendingDesks: setup.pending, weeks: absent(setup.weeks), templatePendingDesks: setup.pending })
      expect(settled.collapsedKeys).toEqual([setup.key])
      const after = balances(settled.nextWeeks, setup.rows, settled.nextTemplatePendingDesks, absentLedgers)
      // 兄弟: 保留でない 1 行の机で同じ欠席をした場合と同じ残数（保留は欠席の会計を変えない）
      //   1 行の机＝席 0 に生徒 2（休み）の記録・席 1 に生徒 1 の振替が同居する形。
      const oneRow = [week(WEEK_START_KEY, WEEK_END_KEY).map((cell) => (cell.id !== CELL ? cell : {
        ...cell,
        desks: cell.desks.map((desk, index) => (index !== 1 ? desk : {
          ...desk,
          lesson: { id: 'hand-placed', studentSlots: [null, entryOf('student-1', { lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE_DATE, makeupSourceLabel: '7/29(水) 5限' })] as [StudentEntry | null, StudentEntry | null] },
          statusSlots: [boardStatus({ id: 'absent-2', studentId: 'student-2', name: '二宮 花子', managedStudentId: 'student-2' }), null] as DeskCell['statusSlots'],
        })),
      }))]
      const oneRowAfter = balances(oneRow, setup.rows, {}, absentLedgers)
      expect(after.s2).toBe(before.s2 + 1)
      expect(after.s2).toBe(oneRowAfter.s2)
      expect(after.s1).toBe(before.s1)
      expect(after.s1).toBe(oneRowAfter.s1)
    })
  })

  describe('下段の同日移動の通常授業を捨てる（N-2・Q26-1 の拡張）: 在庫 ±0・希望回数は同じ日に残るかで決まる', () => {
    // 生徒 1 を同じ日の 4 限から 5 限の机 1 へ移した形の写しが下段に居る。
    // Q36（2026-10-03）以降、同日移動の写しは保存で下段に入らない（テンプレに合わせる）ので、旧版（〜v1.5.577）が作った下段を手で組んで
    // 解決操作の会計（N-2）を固定する。テンプレは生徒 1 を 4 限から外した形（写しは残骸）＝同じ日に生徒 1 の授業が残らない。
    const sameDayMove = entryOf('student-1', { sameDayMoveSourceDate: BOARD_DATE, sameDayMoveSourceLabel: '8/5(水) 4限' })
    const rowsWithout1 = [templateRow('regular-1', 'student-3'), templateRow('regular-2', 'student-2')]
    function legacyPendingBoard(rows: RegularLessonRow[]) {
      const board = buildManagedScheduleCellsForRange({
        range: { startDate: WEEK_START_KEY, endDate: WEEK_END_KEY, periodValue: '', personId: '' },
        fallbackStartDate: WEEK_START_KEY,
        fallbackEndDate: WEEK_END_KEY,
        classroomSettings: settings,
        teachers: [teacher],
        students: allStudents,
        regularLessons: rows,
        boardWeeks: [],
      })
      const key = buildTemplatePendingDeskKey(CELL, DESK1)
      const pending: TemplatePendingDeskMap = { [key]: { lower: { lesson: { id: 'hand-placed', studentSlots: [sameDayMove, null] } }, effectiveStartDate: BOARD_DATE, createdAt: 'legacy' } }
      return { weeks: [board], pending, key, rows, suppressed: [] as string[] }
    }

    it.each(['adopt-template', 'delete-lower-student'] as const)('%s: 同じ日に生徒 1 の授業が残らない → 在庫 ±0・希望回数 −1', (mode) => {
      const setup = legacyPendingBoard(rowsWithout1)
      expect(liveOnDate(setup.weeks, 'student-1')).toBe(0)
      const ledgers = ledgersOf({}, { suppressedRegularLessonOccurrences: setup.suppressed })
      const before = balances(setup.weeks, setup.rows, setup.pending, ledgers)
      const result = resolve(mode, setup, ledgers, 0)
      expect(balances(result.nextWeeks, setup.rows, result.nextTemplatePendingDesks, result.ledgers)).toEqual(before)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([{ studentKey: 'student-1', subject: '数', countKind: 'regular', dateKey: BOARD_DATE, delta: -1 }])
    })

    it.each(['adopt-template', 'delete-lower-student'] as const)('%s: 同じ日の別の時限に生徒 1 が生きている → 希望回数は据え置き', (mode) => {
      const setup = legacyPendingBoard([...rowsWithout1, templateRow('regular-3', 'student-1', { slotNumber: 3 })])
      expect(liveOnDate(setup.weeks, 'student-1')).toBe(1)
      const ledgers = ledgersOf({}, { suppressedRegularLessonOccurrences: setup.suppressed })
      const result = resolve(mode, setup, ledgers, 0)
      expect(result.ledgers.scheduleCountAdjustments).toEqual([])
    })
  })
})

// 既知の穴（2026-10-01・regression-reviewer の L-7 兄弟監査で再現・開発用教室のみ＝フラグ templateDiffApply）:
// 振替元の通常授業の抑止のうち「盤面の振替コマ由来」（buildSuppressedManagedOccurrenceKeys）は盤面だけを見て保留の下段を見ない。
// 明示の抑止キーを持たない振替（古い形のデータ）がテンプレ差分反映の保存で保留の下段へ移ると、振替元（反映日以降）の通常授業が湧き、
// 下段の振替は在庫の消化に数えられる（resolveMakeupScanWeeks）ので二重に数えられる。明示の抑止キーがあれば起きない。
describe('INV-06 × テンプレ差分反映の保留: 振替元の抑止（既知の穴）', () => {
  it.todo('明示の抑止キーを持たない振替が保留の下段へ移っても、振替元の通常授業が湧かない（再マージが下段の振替も抑止の材料に数える）')
})
