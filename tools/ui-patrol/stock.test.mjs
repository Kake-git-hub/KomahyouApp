// tools/ui-patrol/stock.ts(台本 e の在庫の数え方)を固定する。数え方はアプリの権威関数そのもの(ここでは鍵の形と読み方だけを見る)。
// フィクスチャはこのファイル内の架空データだけ(生徒A・講師A)。
import { describe, it, expect } from 'vitest'
import { collectStockBalances, findMakeupOriginLabel } from './stock.ts'

const TODAY = '2026-11-11'
const roster = [{ id: 's1', name: '生徒A', displayName: '生徒A', entryDate: '', withdrawDate: '', birthDate: '2012-05-01', email: '', memo: '' }]

function payloadOf({ studentSlots = [null, null], manualMakeupAdjustments = {} } = {}) {
  return {
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1 },
    managers: [], teachers: [{ id: 't1', name: '講師A', displayName: '講師A', entryDate: '', withdrawDate: '', memo: '' }], students: roster,
    regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: {
      weeks: [[{ id: '2026-11-17_1', dateKey: '2026-11-17', dayLabel: '', dateLabel: '11/17', slotLabel: '1限', slotNumber: 1, timeLabel: '', isOpenDay: true, desks: [{ id: 'd0', teacher: '講師A', lesson: { id: 'L0', studentSlots } }] }]],
      weekIndex: 0, manualMakeupAdjustments,
    },
  }
}

describe('collectStockBalances', () => {
  it('未消化振替の残は 生徒キー__科目 の鍵で読む。台帳の振替元 1 件 → 残 1、その振替元から振替を 1 コマ置くと残 0(行が消える)', () => {
    const ledger = { 's1__数': [{ dateKey: '2026-11-10', slotNumber: 1 }] }
    const open = collectStockBalances(payloadOf({ manualMakeupAdjustments: ledger }), TODAY)
    expect(open.makeup).toEqual({ 's1__数': 1 })
    expect(open.lecture).toEqual({})
    expect(findMakeupOriginLabel(open, 's1__数', '2026-11-10', 1)).not.toBe('')
    expect(findMakeupOriginLabel(open, 's1__数', '2026-11-12', 1)).toBe('')
    const placed = { id: 'm1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-11-10', makeupSourceLabel: '11/10(火) 1限' }
    const used = collectStockBalances(payloadOf({ studentSlots: [placed, null], manualMakeupAdjustments: ledger }), TODAY)
    expect(used.makeup).toEqual({})
  })

  it('入力を書き換えない・壊れた教室データでも落ちない', () => {
    const payload = payloadOf({ manualMakeupAdjustments: { 's1__数': [{ dateKey: '2026-11-10', slotNumber: 1 }] } })
    const before = JSON.stringify(payload)
    collectStockBalances(payload, TODAY)
    expect(JSON.stringify(payload)).toBe(before)
    expect(collectStockBalances({}, TODAY)).toEqual({ makeup: {}, lecture: {}, makeupRows: [] })
  })
})
