import { describe, expect, it } from 'vitest'

import { lessonHistoryFixtureRows } from './lessonHistory.fixture'
import {
  LESSON_HISTORY_MAX_DAYS,
  countLessonHistoryDays,
  filterLessonHistory,
  parseLessonLedgerToken,
  parseLessonLedgerRows,
  parseLessonLedgerTokens,
  resolveLessonHistoryRange,
  summarizeLessonHistory,
} from './lessonHistory'
import { buildStudentLessonLedger } from './studentLessonLedger'
import type { SlotCell } from '../components/schedule-board/types'
import type { AppSnapshotPayload, ClassroomSettings } from '../types/appState'

describe('parseLessonLedgerToken', () => {
  it('出席トークン `日付#限|授業種別` を展開する', () => {
    expect(parseLessonLedgerToken('2026-09-01#1|regular', 'attended')).toEqual({
      date: '2026-09-01', slot: 1, lessonType: 'regular', makeupSourceDate: null, reasonLabel: null,
    })
  })

  it('配置トークンの 3 番目は振替元日', () => {
    expect(parseLessonLedgerToken('2026-09-10#4|makeup|2026-09-02', 'placed')).toEqual({
      date: '2026-09-10', slot: 4, lessonType: 'makeup', makeupSourceDate: '2026-09-02', reasonLabel: null,
    })
  })

  it('未消化トークンの 2 番目は授業種別ではなく理由ラベル(限が空のこともある)', () => {
    expect(parseLessonLedgerToken('2026-09-03#|手動調整', 'makeupRemaining')).toEqual({
      date: '2026-09-03', slot: null, lessonType: '', makeupSourceDate: null, reasonLabel: '手動調整',
    })
  })

  it('末尾の空欄が落ちたトークン(授業種別なし)も壊れない', () => {
    expect(parseLessonLedgerToken('2026-09-05#3', 'placed')).toEqual({
      date: '2026-09-05', slot: 3, lessonType: '', makeupSourceDate: null, reasonLabel: null,
    })
  })
})

describe('parseLessonLedgerTokens', () => {
  it('生徒×科目の1行を日付順のイベント配列にする(状態・種別・振替元日つき)', () => {
    const events = parseLessonLedgerTokens(lessonHistoryFixtureRows[0])
    expect(events.map((event) => `${event.date}#${event.slot ?? ''} ${event.status} ${event.lessonTypeLabel}`)).toEqual([
      '2026-09-01#1 attended 通常',
      '2026-09-02#2 absent 通常',
      '2026-09-03# makeupRemaining ',
      '2026-09-08#1 attended 通常',
      '2026-09-10#4 placed 振替',
      '2026-09-15#3 absent 振替',
      '2026-09-22#1 absentNoMakeup 通常',
      '2026-09-29#5 placed 講習',
      '2026-10-01#2 placed 通常',
    ])
    const makeupPlaced = events.find((event) => event.token === '2026-09-10#4|makeup|2026-09-02')
    expect(makeupPlaced).toMatchObject({ makeupSourceDate: '2026-09-02', subject: '数', studentId: 's001', name: '青木 太郎', statusLabel: '予定' })
    const remaining = events.find((event) => event.status === 'makeupRemaining')
    expect(remaining).toMatchObject({ reasonLabel: '手動調整', slot: null, makeupSourceDate: null, statusLabel: '未消化' })
  })

  it('複数科目をまとめても日付順(同日は限→状態の順)', () => {
    const events = parseLessonLedgerRows(lessonHistoryFixtureRows)
    expect(events.map((event) => `${event.date} ${event.subject} ${event.status}`).slice(0, 5)).toEqual([
      '2026-08-06 国 attended',
      '2026-08-20 国 makeupRemaining',
      '2026-08-27 国 makeupRemaining',
      '2026-09-01 数 attended',
      '2026-09-02 数 absent',
    ])
    // 同じ日・同じ限に出席と配置が並ぶ行(英)は attended が先。
    const sept5 = events.filter((event) => event.date === '2026-09-05')
    expect(sept5.map((event) => event.status)).toEqual(['attended', 'placed'])
  })

  it('壊れた入力(null 行・非文字列トークン・配列でない)でも落ちない', () => {
    expect(parseLessonLedgerRows(null)).toEqual([])
    expect(parseLessonLedgerRows([null as never, { subject: '数', attended: 'x' as never }])).toEqual([])
    expect(parseLessonLedgerTokens({ attended: [''] })).toEqual([])
  })
})

describe('filterLessonHistory / summarizeLessonHistory', () => {
  const events = parseLessonLedgerRows(lessonHistoryFixtureRows)

  it('期間(両端を含む)で絞り込む', () => {
    const filtered = filterLessonHistory(events, { from: '2026-09-01', to: '2026-09-10' })
    expect(filtered.map((event) => event.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-05', '2026-09-08', '2026-09-10'])
  })

  it('状態・授業種別・科目で絞り込む', () => {
    expect(filterLessonHistory(events, { statuses: ['absentNoMakeup'] }).map((event) => event.token)).toEqual(['2026-09-22#1|regular'])
    expect(filterLessonHistory(events, { lessonTypes: ['special'] }).map((event) => event.token)).toEqual(['2026-09-29#5|special|'])
    expect(filterLessonHistory(events, { subjects: ['英'] })).toHaveLength(2)
  })

  it('件数を状態別に集計する', () => {
    expect(summarizeLessonHistory(events)).toEqual({ attended: 4, absent: 2, absentNoMakeup: 1, placed: 4, makeupRemaining: 3, total: 14 })
  })
})

describe('resolveLessonHistoryRange', () => {
  it('未指定なら終了日=今日・開始日=1年前(366日)', () => {
    expect(resolveLessonHistoryRange({ today: '2026-09-12' })).toEqual({ from: '2025-09-12', to: '2026-09-12', clamped: false })
    expect(countLessonHistoryDays('2025-09-12', '2026-09-12')).toBe(LESSON_HISTORY_MAX_DAYS)
  })

  it('366 日を超える期間は開始日を終了日基準で丸める', () => {
    expect(resolveLessonHistoryRange({ from: '2020-01-01', to: '2026-09-12', today: '2026-09-12' })).toEqual({
      from: '2025-09-12', to: '2026-09-12', clamped: true,
    })
  })

  it('逆転・不正な日付は安全側へ倒す', () => {
    expect(resolveLessonHistoryRange({ from: '2026-09-20', to: '2026-09-10', today: '2026-09-12' })).toEqual({ from: '2026-09-10', to: '2026-09-10', clamped: false })
    expect(resolveLessonHistoryRange({ from: 'いつか', to: '2026/09/10', today: '2026-09-12' })).toEqual({ from: '2025-09-12', to: '2026-09-12', clamped: false })
  })
})

// 台帳の生成（studentLessonLedger）→ 履歴の展開（lessonHistory）が繋がることを、
// トークン書式の二重定義ズレを検知する形で確かめる（片方だけ書式を変えたら落ちる）。
describe('buildStudentLessonLedger との往復', () => {
  const classroomSettings: ClassroomSettings = { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2 }
  const student = {
    id: 's001', name: '青木 太郎', displayName: '青木 太郎', email: '',
    entryDate: '2026-04-01', withdrawDate: '', birthDate: '2011-05-01',
  } as AppSnapshotPayload['students'][number]

  function cell(dateKey: string, slotNumber: number, desks: SlotCell['desks']): SlotCell {
    return {
      id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '水', dateLabel: dateKey.slice(5).replace('-', '/'),
      slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks,
    }
  }
  const statusEntry = (status: string, dateKey: string, slotNumber: number, overrides: Record<string, unknown> = {}) => ({
    id: `status-${status}-${dateKey}`, studentId: 'entry-1', sourceManagedLesson: true, name: '青木 太郎',
    managedStudentId: 's001', grade: '中3', subject: '数', lessonType: 'regular', teacherType: 'normal',
    teacherName: '講師A', dateKey, slotNumber, recordedAt: '2026-09-01T00:00:00Z', status, sourceLessonId: 'lesson-1',
    ...overrides,
  }) as unknown as NonNullable<SlotCell['desks'][number]['statusSlots']>[number]

  it('台帳が作ったトークンをそのまま履歴イベントへ復元できる', () => {
    const weeks: SlotCell[][] = [[
      cell('2026-09-01', 1, [{ id: 'd1', teacher: '講師A', statusSlots: [statusEntry('attended', '2026-09-01', 1), null] } as unknown as SlotCell['desks'][number]]),
      cell('2026-09-02', 2, [{ id: 'd2', teacher: '講師A', statusSlots: [statusEntry('absent', '2026-09-02', 2), null] } as unknown as SlotCell['desks'][number]]),
    ]]
    const payload = {
      screen: 'schedule-board', classroomSettings, managers: [], students: [student], teachers: [], regularLessons: [],
      specialSessions: [], boardState: { weeks },
    } as unknown as AppSnapshotPayload
    const ledger = buildStudentLessonLedger({ payload, now: new Date('2026-09-12T00:00:00+09:00') })
    const events = parseLessonLedgerRows(ledger!.rows)
    expect(events.map((event) => ({ date: event.date, slot: event.slot, status: event.status, lessonType: event.lessonType }))).toEqual([
      { date: '2026-09-01', slot: 1, status: 'attended', lessonType: 'regular' },
      { date: '2026-09-02', slot: 2, status: 'absent', lessonType: 'regular' },
    ])
  })
})
