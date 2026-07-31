import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import {
  buildMakeupStockEntries,
  collectMakeupOriginDatesByKey,
  resolveStoreMakeupOriginDate,
  type ManualMakeupOrigin,
} from './makeupStock'
import { clearMakeupOrigins, resolveSelectedMakeupOrigin, shouldReturnLectureStockOnAbsence } from './ScheduleBoardScreen'

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
})
