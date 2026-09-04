import { beforeEach, describe, expect, it } from 'vitest'

import type { SlotCell } from '../components/schedule-board/types'
import type { AppSnapshotPayload, ClassroomSettings } from '../types/appState'
import {
  LEDGER_HISTORY_DAYS,
  buildStudentLessonLedger,
  clearStudentLessonLedgerSyncState,
  markStudentLessonLedgerSent,
  resolveStudentLessonLedgerFingerprint,
  shouldSendStudentLessonLedger,
  toJstDateKey,
} from './studentLessonLedger'

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 2,
}

const student = {
  id: 's001',
  name: '青木 太郎',
  displayName: '青木 太郎',
  email: '',
  entryDate: '2026-04-01',
  withdrawDate: '',
  birthDate: '2011-05-01',
} as AppSnapshotPayload['students'][number]

function cell(dateKey: string, slotNumber: number, desks: SlotCell['desks']): SlotCell {
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '水',
    dateLabel: dateKey.slice(5).replace('-', '/'),
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '',
    isOpenDay: true,
    desks,
  }
}

const studentEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-1',
  name: '青木 太郎',
  managedStudentId: 's001',
  grade: '中3',
  subject: '数',
  lessonType: 'regular',
  teacherType: 'normal',
  ...overrides,
}) as unknown as NonNullable<SlotCell['desks'][number]['lesson']>['studentSlots'][number]

const statusEntry = (status: string, dateKey: string, slotNumber: number, overrides: Record<string, unknown> = {}) => ({
  id: `status-${status}-${dateKey}`,
  studentId: 'entry-1',
  sourceManagedLesson: true,
  name: '青木 太郎',
  managedStudentId: 's001',
  grade: '中3',
  subject: '数',
  lessonType: 'regular',
  teacherType: 'normal',
  teacherName: '講師A',
  dateKey,
  slotNumber,
  recordedAt: '2026-09-01T00:00:00Z',
  status,
  sourceLessonId: 'lesson-1',
  ...overrides,
}) as unknown as NonNullable<SlotCell['desks'][number]['statusSlots']>[number]

function buildPayload(weeks: SlotCell[][], boardOverrides: Record<string, unknown> = {}): AppSnapshotPayload {
  return {
    screen: 'schedule-board',
    classroomSettings,
    managers: [],
    teachers: [],
    students: [student],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: {
      weeks,
      weekIndex: 0,
      selectedCellId: '',
      selectedDeskIndex: 0,
      suppressedRegularLessonOccurrences: [],
      scheduleCountAdjustments: [],
      manualMakeupAdjustments: {},
      suppressedMakeupOrigins: {},
      fallbackMakeupStudents: {},
      manualLectureStockCounts: {},
      manualLectureStockOrigins: {},
      fallbackLectureStockStudents: {},
      isLectureStockOpen: false,
      isMakeupStockOpen: false,
      studentScheduleRange: null,
      teacherScheduleRange: null,
      ...boardOverrides,
    },
  } as unknown as AppSnapshotPayload
}

const NOW = new Date('2026-09-04T12:00:00+09:00')

describe('buildStudentLessonLedger', () => {
  it('出席・休み・配置済み振替・未消化の元コマを生徒×科目の1行にまとめる(画面の未消化と同じ計算)', () => {
    const weeks: SlotCell[][] = [[
      // 9/1 出席
      cell('2026-09-01', 1, [{ id: 'd1', teacher: '講師A', statusSlots: [statusEntry('attended', '2026-09-01', 1), null] }]),
      // 9/2 休み → 台帳に origin(手動調整)を積む(= handleMarkStudentAbsent と同じ状態)
      cell('2026-09-02', 2, [{ id: 'd2', teacher: '講師A', statusSlots: [statusEntry('absent', '2026-09-02', 2), null] }]),
      // 9/3 休み(未振替)
      cell('2026-09-03', 3, [{ id: 'd3', teacher: '講師A', statusSlots: [statusEntry('absent', '2026-09-03', 3), null] }]),
      // 9/10 に 9/2 の振替を配置(未出欠)
      cell('2026-09-10', 4, [{ id: 'd4', teacher: '講師A', lesson: { id: 'l4', studentSlots: [studentEntry({ id: 'entry-2', lessonType: 'makeup', makeupSourceDate: '2026-09-02', makeupSourceLabel: '2026/9/2(水) 2限' }), null] } }]),
    ]]
    const payload = buildPayload(weeks, {
      manualMakeupAdjustments: { s001__数: [{ dateKey: '2026-09-02' }, { dateKey: '2026-09-03' }] },
    })

    const ledger = buildStudentLessonLedger({ payload, now: NOW })
    expect(ledger).not.toBeNull()
    expect(ledger!.rows).toHaveLength(1)
    const row = ledger!.rows[0]
    expect(row.studentId).toBe('s001')
    expect(row.subject).toBe('数')
    expect(row.attended).toEqual(['2026-09-01#1|regular'])
    expect(row.absent).toEqual(['2026-09-02#2|regular', '2026-09-03#3|regular'])
    expect(row.placed).toEqual(['2026-09-10#4|makeup|2026-09-02'])
    // 9/2 は配置で消化済み、9/3 だけ未消化として残る
    expect(row.makeupBalance).toBe(1)
    expect(row.makeupRemaining).toEqual(['2026-09-03#|手動調整'])
    expect(ledger!.totals).toEqual({ makeupBalance: 1, lecturePending: 0, attended: 1, placed: 1 })
    expect(ledger!.computedAt).toBe(NOW.toISOString())
  })

  it('直近 400 日より前の実績は載せない(未消化の元コマ一覧は制限しない)', () => {
    const old = new Date(NOW.getTime() - (LEDGER_HISTORY_DAYS + 10) * 24 * 60 * 60 * 1000)
    const oldKey = `${old.getFullYear()}-${`${old.getMonth() + 1}`.padStart(2, '0')}-${`${old.getDate()}`.padStart(2, '0')}`
    const weeks: SlotCell[][] = [[
      cell(oldKey, 1, [{ id: 'd1', teacher: '講師A', statusSlots: [statusEntry('attended', oldKey, 1), null] }]),
    ]]
    const payload = buildPayload(weeks, { manualMakeupAdjustments: { s001__数: [{ dateKey: oldKey }] } })
    const ledger = buildStudentLessonLedger({ payload, now: NOW })!
    expect(ledger.rows[0].attended).toEqual([])
    expect(ledger.rows[0].makeupRemaining).toEqual([`${oldKey}#|手動調整`])
  })

  it('盤面が無い教室は null(保存本体だけ通す)', () => {
    expect(buildStudentLessonLedger({ payload: { ...buildPayload([]), boardState: null }, now: NOW })).toBeNull()
  })
})

describe('台帳の送信間引き', () => {
  beforeEach(() => {
    clearStudentLessonLedgerSyncState()
  })

  it('指紋は computedAt を無視し、内容が同じなら一致する', () => {
    const payload = buildPayload([[cell('2026-09-01', 1, [{ id: 'd1', teacher: '講師A', statusSlots: [statusEntry('attended', '2026-09-01', 1), null] }])]])
    const a = buildStudentLessonLedger({ payload, now: NOW })!
    const b = buildStudentLessonLedger({ payload, now: new Date(NOW.getTime() + 60_000) })!
    expect(a.computedAt).not.toBe(b.computedAt)
    expect(resolveStudentLessonLedgerFingerprint(a)).toBe(resolveStudentLessonLedgerFingerprint(b))
  })

  it('同じ日に同じ内容は送らず、内容が変わるか日付が変われば送る', () => {
    expect(shouldSendStudentLessonLedger('c1', 'fp1', '2026-09-04')).toBe(true)
    markStudentLessonLedgerSent('c1', 'fp1', '2026-09-04')
    expect(shouldSendStudentLessonLedger('c1', 'fp1', '2026-09-04')).toBe(false)
    expect(shouldSendStudentLessonLedger('c1', 'fp2', '2026-09-04')).toBe(true)
    expect(shouldSendStudentLessonLedger('c1', 'fp1', '2026-09-05')).toBe(true)
    // 教室が違えば独立
    expect(shouldSendStudentLessonLedger('c2', 'fp1', '2026-09-04')).toBe(true)
    expect(shouldSendStudentLessonLedger('', 'fp1', '2026-09-04')).toBe(false)
  })

  it('JST の日付キーに変換する(UTC の日付境界をまたぐ)', () => {
    expect(toJstDateKey('2026-09-03T15:30:00.000Z')).toBe('2026-09-04')
    expect(toJstDateKey('2026-09-03T14:59:00.000Z')).toBe('2026-09-03')
  })
})
