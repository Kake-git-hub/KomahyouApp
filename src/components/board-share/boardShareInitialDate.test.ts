import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BoardShareCell } from '../../integrations/firebase/boardShare'
import { resolveBoardShareInitialDateKey } from './BoardShareScreen'

// 講師日程共有を開いたときの最初の日付(Issue #91・spec-schedule-pdf §N-1)。
// 先月の週まで配るようになったので、前に過去の日まで戻って閉じても、次に開くと今日から始まること
// (オーナーへ「開いたら今までどおり今日」と伝えてある)。今週の中の日(きのう等)と未来の日は従来どおり復元する。

const cell = (dateKey: string, slotNumber = 1) => ({ id: `${dateKey}_${slotNumber}`, dateKey, slotNumber, desks: [] }) as unknown as BoardShareCell
const dateKeysFrom = (start: string, days: number) => {
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: days }, (_, i) => new Date(y, m - 1, d + i).toLocaleDateString('sv-SE'))
}
// 2026-10-26(月)〜2026-12-13(日)
const cells = dateKeysFrom('2026-10-26', 49).flatMap((dateKey) => [cell(dateKey, 1), cell(dateKey, 2)])
const today = new Date(2026, 10, 28, 10, 0) // 2026-11-28(土)・今週は 11/23(月)〜11/29(日)

describe('resolveBoardShareInitialDateKey', () => {
  it('保存なし → 今日', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: null, cells, today })).toBe('2026-11-28')
  })
  it('今週の中のきのう → 復元する(従来どおり)', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-27', cells, today })).toBe('2026-11-27')
  })
  it('今週の月曜 → 復元する(週の始まりは月曜・盤面と同じ)', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-23', cells, today })).toBe('2026-11-23')
  })
  it('先週の日曜(今週より前) → 今日', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-22', cells, today })).toBe('2026-11-28')
  })
  it('先月の日 → 今日', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-10-28', cells, today })).toBe('2026-11-28')
  })
  it('保存が未来 → 復元する(従来どおり)', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-12-05', cells, today })).toBe('2026-12-05')
  })
  it('保存の日が共有セルに無い → 今日', () => {
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2027-01-10', cells, today })).toBe('2026-11-28')
  })
  it('日曜に開いたときも、その週の月曜からを今週とみなす', () => {
    const sunday = new Date(2026, 10, 29, 9, 0)
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-23', cells, today: sunday })).toBe('2026-11-23')
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-22', cells, today: sunday })).toBe('2026-11-29')
  })
  it('今日のセルが無い(休みの日)ときは今日より後のいちばん近い日(pickInitialDate の従来どおり)', () => {
    const sparse = [cell('2026-11-20'), cell('2026-11-30'), cell('2026-12-01')]
    expect(resolveBoardShareInitialDateKey({ storedDateKey: '2026-11-20', cells: sparse, today })).toBe('2026-11-30')
  })
})

describe('BoardShareScreen の配線', () => {
  it('最初の日付は resolveBoardShareInitialDateKey で決め、保存済みの日付を useState の初期値に直接使わない', () => {
    const source = readFileSync(resolve(__dirname, './BoardShareScreen.tsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(source).not.toMatch(/useState\(initialSelection\?\.dateKey/)
    expect(source).toMatch(/resolveBoardShareInitialDateKey\(\{ storedDateKey: readStoredSelection\(token\)\?\.dateKey/)
  })
})
