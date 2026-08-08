import { describe, expect, it } from 'vitest'
import { compactBoardSharePayload } from '../../integrations/firebase/boardShare'
import type { BoardSharePayloadInput } from '../../integrations/firebase/boardShare'
import type { SlotCell } from '../schedule-board/types'
import { boardSlotTimes, getBoardSlotTimeLabel } from '../schedule-board/slotTimes'
import { resolveBoardShareTimeLabel } from './BoardShareScreen'

function createSlotCell(overrides: Partial<SlotCell> = {}): SlotCell {
  return {
    id: '2026-08-03_3',
    dateKey: '2026-08-03',
    dayLabel: '月',
    dateLabel: '8/3',
    slotLabel: '3限',
    slotNumber: 3,
    timeLabel: '16:20-17:50',
    isOpenDay: true,
    desks: [],
    ...overrides,
  }
}

function createPayloadInput(cells: SlotCell[]): BoardSharePayloadInput {
  return {
    schemaVersion: 1,
    token: 'token-1',
    classroomId: 'classroom-1',
    classroomName: '開発用教室',
    sharedAt: '2026-08-08T00:00:00.000Z',
    cells,
  }
}

// 講師共有画面のフッターは「3限」ではなくコマの時間帯を出す(2026-08-08)。
describe('配布用盤面フッターの時間表示', () => {
  it('公開データの timeLabel をそのまま出す', () => {
    const cell = { timeLabel: '16:20-17:50', slotLabel: '3限' }
    expect(resolveBoardShareTimeLabel(cell, 3)).toBe('16:20-17:50')
  })

  // timeLabel を持たない公開済みドキュメントでも「N限」に戻らず時間帯を出せること(後方互換)。
  it('旧ドキュメント(timeLabel 無し)は slotNumber から盤面と同じ時間帯を補完する', () => {
    expect(resolveBoardShareTimeLabel({ slotLabel: '3限' }, 3)).toBe('16:20-17:50')
    expect(resolveBoardShareTimeLabel({ slotLabel: '1限' }, 1)).toBe(boardSlotTimes[0])
    expect(resolveBoardShareTimeLabel({ slotLabel: '5限', timeLabel: '  ' }, 5)).toBe(boardSlotTimes[4])
    expect(resolveBoardShareTimeLabel(null, 2)).toBe(boardSlotTimes[1])
  })

  // コマ数が増えて定義外になっても表示が空にならないこと。
  it('時間帯を決められないコマは従来のコマ表記に倒す', () => {
    expect(resolveBoardShareTimeLabel({ slotLabel: '6限' }, 6)).toBe('6限')
    expect(resolveBoardShareTimeLabel(null, 6)).toBe('6限')
  })
})

describe('getBoardSlotTimeLabel', () => {
  it('1限〜5限を盤面と同じ時間帯で返す', () => {
    expect(boardSlotTimes.map((_, index) => getBoardSlotTimeLabel(index + 1))).toEqual([...boardSlotTimes])
  })

  it('範囲外・非整数は空文字を返す', () => {
    expect(getBoardSlotTimeLabel(0)).toBe('')
    expect(getBoardSlotTimeLabel(6)).toBe('')
    expect(getBoardSlotTimeLabel(1.5)).toBe('')
  })
})

// 共有ドキュメントに timeLabel が載らないと、公開し直しても時間表示が補完頼みのままになる。
describe('compactBoardSharePayload', () => {
  it('コマの時間帯(timeLabel)を共有ペイロードへ引き継ぐ', () => {
    const compacted = compactBoardSharePayload(createPayloadInput([createSlotCell()]))
    expect(compacted.cells[0].timeLabel).toBe('16:20-17:50')
    expect(compacted.cells[0].slotLabel).toBe('3限')
  })
})
