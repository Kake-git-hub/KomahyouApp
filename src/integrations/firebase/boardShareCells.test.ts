import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../../components/schedule-board/types'
import { resolveBoardSharePastLimitDateKey, selectBoardShareCells } from './boardShare'

// 講師日程共有で送る週の範囲(Issue #91・オーナー確定 2026-11-28・spec-schedule-pdf N-1)。
// 「今日を含む週以降」から「先月の同じ日を含む週以降」へ広げた。講師が過去の週の予定を確かめられるようにするため。

const cell = (dateKey: string) => ({ id: `cell-${dateKey}`, dateKey }) as unknown as SlotCell
// 月〜日の 7 日ぶんの週(先頭の日付から)。
const week = (startDateKey: string) => {
  const [y, m, d] = startDateKey.split('-').map(Number)
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(y, m - 1, d + offset)
    return cell(`${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`)
  })
}
const weekStarts = (cells: SlotCell[]) => [...new Set(cells.map((c) => c.dateKey))].filter((_, i) => i % 7 === 0)

describe('resolveBoardSharePastLimitDateKey(先月の同じ日)', () => {
  it('11/28 → 10/28', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2026, 10, 28, 9, 0))).toBe('2026-10-28')
  })
  it('先月に同じ日が無いときは先月の末日に丸める(3/31 → 2/28)', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2026, 2, 31))).toBe('2026-02-28')
  })
  it('うるう年は 2/29 に丸める(2028/3/30 → 2/29)', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2028, 2, 30))).toBe('2028-02-29')
  })
  it('5/31 → 4/30', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2026, 4, 31))).toBe('2026-04-30')
  })
  it('1 月は前年 12 月(2027/1/15 → 2026/12/15)', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2027, 0, 15))).toBe('2026-12-15')
  })
  it('夜遅くでもローカル日付で数える(UTC にずれない)', () => {
    expect(resolveBoardSharePastLimitDateKey(new Date(2026, 10, 1, 23, 59))).toBe('2026-10-01')
    expect(resolveBoardSharePastLimitDateKey(new Date(2026, 10, 1, 0, 1))).toBe('2026-10-01')
  })
})

describe('selectBoardShareCells(先月の同じ日を含む週以降を送る)', () => {
  const today = new Date(2026, 10, 28, 10, 0) // 2026-11-28(土)
  // 月曜はじまり: 10/19, 10/26(10/28 を含む), 11/2, 11/9, 11/16, 11/23(今週), 11/30, 12/7
  const weeks = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'].map(week)

  it('先月の同じ日(10/28)を含む週から先を送り、その前の週は送らない', () => {
    const starts = weekStarts(selectBoardShareCells(weeks, today))
    expect(starts).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
  })

  it('週の最終日がしきい値ちょうどの週も入る(10/22〜10/28 の週)', () => {
    const starts = weekStarts(selectBoardShareCells([week('2026-10-15'), week('2026-10-22'), week('2026-11-23')], today))
    expect(starts).toEqual(['2026-10-22', '2026-11-23'])
  })

  it('今週以降は従来どおり全部入る', () => {
    const cells = selectBoardShareCells(weeks, today)
    for (const start of ['2026-11-23', '2026-11-30', '2026-12-07']) {
      expect(cells.filter((c) => week(start).some((w) => w.dateKey === c.dateKey))).toHaveLength(7)
    }
  })

  it('壊れた週(配列でない・空)は飛ばす', () => {
    const broken = [null, [], week('2026-11-23')] as unknown as SlotCell[][]
    expect(weekStarts(selectBoardShareCells(broken, today))).toEqual(['2026-11-23'])
  })

  it('該当が 1 件も無い(全部古い)ときは全週を送る(空配信を避ける従来の挙動)', () => {
    const old = [week('2026-09-07'), week('2026-09-14')]
    expect(selectBoardShareCells(old, today)).toHaveLength(14)
  })

  it('月末の丸め: 3/31 は 2/28 を含む週から', () => {
    const march31 = new Date(2026, 2, 31)
    // 2026-02-16(月)〜22, 2/23〜3/1(2/28 を含む)
    expect(weekStarts(selectBoardShareCells([week('2026-02-16'), week('2026-02-23'), week('2026-03-30')], march31))).toEqual(['2026-02-23', '2026-03-30'])
  })
})

describe('App は共有の selectBoardShareCells を使う(配線)', () => {
  it('App.tsx に自前の selectBoardShareCells を持たず、boardShare から import して公開 2 経路で呼ぶ', () => {
    const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(appSource).not.toMatch(/function selectBoardShareCells\(/)
    expect(appSource).toMatch(/import \{[^}]*\bselectBoardShareCells\b[^}]*\} from '\.\/integrations\/firebase\/boardShare'/)
    expect(appSource.match(/selectBoardShareCells\((?:boardState|nextBoardState)\.weeks\)/g) ?? []).toHaveLength(2)
  })
})
