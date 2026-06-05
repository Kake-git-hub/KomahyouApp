import { describe, expect, it } from 'vitest'
import { trimBoardWeeksForMemory, weekHasManualBoardData } from './boardWeekTrim'
import type { DeskCell, SlotCell, StudentEntry } from './types'

function makeStudent(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 's1',
    name: '生徒A',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function makeDesk(overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: 'd1', teacher: '', ...overrides }
}

function makeCell(dateKey: string, desks: DeskCell[]): SlotCell {
  return {
    id: `${dateKey}_1`,
    dateKey,
    dayLabel: '月',
    dateLabel: dateKey,
    slotLabel: '1限',
    slotNumber: 1,
    timeLabel: '13:00',
    isOpenDay: true,
    desks,
  }
}

function makeWeek(startDateKey: string, desks: DeskCell[] = [makeDesk()]): SlotCell[] {
  return [makeCell(startDateKey, desks)]
}

describe('weekHasManualBoardData', () => {
  it('通常授業のみ(自動生成)の週は手動データ無しと判定', () => {
    const week = makeWeek('2026-06-01', [makeDesk({ teacher: '田中', lesson: { id: 'l1', studentSlots: [makeStudent({ lessonType: 'regular' }), null] } })])
    expect(weekHasManualBoardData(week)).toBe(false)
  })

  it('振替・体験・講習・手動追加の生徒は手動と判定', () => {
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ lesson: { id: 'l', studentSlots: [makeStudent({ lessonType: 'makeup', makeupSourceDate: '2026-05-01' }), null] } })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ lesson: { id: 'l', studentSlots: [makeStudent({ lessonType: 'trial' }), null] } })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ lesson: { id: 'l', studentSlots: [makeStudent({ lessonType: 'regular', manualAdded: true }), null] } })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ lesson: { id: 'l', studentSlots: [makeStudent({ lessonType: 'regular', specialSessionId: 'sess1' }), null] } })]))).toBe(true)
  })

  it('メモ・出欠ステータス・手動講師・講師割当ソース・授業ノートは手動と判定', () => {
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ memoSlots: ['テスト', null] })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ statusSlots: [{ id: 'st', studentId: 's1', sourceManagedLesson: true, name: 'A', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '', dateKey: '2026-06-01', slotNumber: 1, recordedAt: '', status: 'absent', sourceLessonId: 'x' }, null] })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ manualTeacher: true, teacher: '佐藤' })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ teacherAssignmentSource: 'manual', teacher: '佐藤' })]))).toBe(true)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ lesson: { id: 'l', note: '注意', studentSlots: [null, null] } })]))).toBe(true)
  })

  it('空メモ・空机は手動データ無し', () => {
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk({ memoSlots: ['', null] })]))).toBe(false)
    expect(weekHasManualBoardData(makeWeek('2026-06-01', [makeDesk()]))).toBe(false)
  })
})

describe('trimBoardWeeksForMemory', () => {
  const reference = new Date('2026-06-15T00:00:00')

  it('ウィンドウ外の通常授業のみの週は破棄、手動編集週とウィンドウ内は保持', () => {
    const farPastAuto = makeWeek('2026-01-05') // 6週より前・自動のみ → 破棄
    const farFutureAuto = makeWeek('2026-12-28') // 26週より先・自動のみ → 破棄
    const farPastEdited = makeWeek('2026-01-12', [makeDesk({ lesson: { id: 'l', studentSlots: [makeStudent({ lessonType: 'makeup' }), null] } })]) // 範囲外でも手動 → 保持
    const inWindow = makeWeek('2026-06-15') // ウィンドウ内 → 保持
    const weeks = [farPastAuto, farFutureAuto, farPastEdited, inWindow]

    const trimmed = trimBoardWeeksForMemory(weeks, { referenceDate: reference })
    expect(trimmed).toContain(farPastEdited)
    expect(trimmed).toContain(inWindow)
    expect(trimmed).not.toContain(farPastAuto)
    expect(trimmed).not.toContain(farFutureAuto)
  })

  it('破棄対象が無ければ元の配列を返す', () => {
    const weeks = [makeWeek('2026-06-08'), makeWeek('2026-06-15'), makeWeek('2026-06-22')]
    expect(trimBoardWeeksForMemory(weeks, { referenceDate: reference })).toBe(weeks)
  })

  it('週が1つ以下なら何もしない', () => {
    const weeks = [makeWeek('2026-01-01')]
    expect(trimBoardWeeksForMemory(weeks, { referenceDate: reference })).toBe(weeks)
  })
})
