// tools/ui-patrol/stock.ts(台本 e の在庫の数え方)を固定する。数え方はアプリの権威関数そのもの(ここでは鍵の形と読み方だけを見る)。
// フィクスチャはこのファイル内の架空データだけ(生徒A・講師A)。
import { describe, it, expect } from 'vitest'
import { collectMakeupDebtKeys, collectStockBalances, findMakeupOriginLabel } from './stock.ts'

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

  it('振替の借り: 振替元より置いた振替が多い(前から置きすぎ)鍵は、振替元を 1 つ足しても残が増えない(アプリの数え方で確かめる)。借りの無い鍵は入らない', () => {
    const ledger = { 's1__数': [{ dateKey: '2026-11-10', slotNumber: 1 }] }
    const makeup = (id) => ({ id, name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-11-10', makeupSourceLabel: '11/10(火) 1限' })
    // 振替元 1 つに振替 2 コマ(借り 1)
    const owing = payloadOf({ studentSlots: [makeup('m1'), makeup('m2')], manualMakeupAdjustments: ledger })
    expect(collectStockBalances(owing, TODAY).makeup).toEqual({})
    expect([...collectMakeupDebtKeys(owing, TODAY, ['s1__数', 's1__英'])]).toEqual(['s1__数'])
    // 振替元 1 つに振替 1 コマ(借りなし・残 0)/置いていない(残 1)
    expect([...collectMakeupDebtKeys(payloadOf({ studentSlots: [makeup('m1'), null], manualMakeupAdjustments: ledger }), TODAY, ['s1__数'])]).toEqual([])
    expect([...collectMakeupDebtKeys(payloadOf({ manualMakeupAdjustments: ledger }), TODAY, ['s1__数'])]).toEqual([])
    // 入力を書き換えない
    const before = JSON.stringify(owing)
    collectMakeupDebtKeys(owing, TODAY, ['s1__数'])
    expect(JSON.stringify(owing)).toBe(before)
    expect([...collectMakeupDebtKeys(owing, TODAY, [])]).toEqual([])
  })

  it('入力を書き換えない・壊れた教室データでも落ちない', () => {
    const payload = payloadOf({ manualMakeupAdjustments: { 's1__数': [{ dateKey: '2026-11-10', slotNumber: 1 }] } })
    const before = JSON.stringify(payload)
    collectStockBalances(payload, TODAY)
    expect(JSON.stringify(payload)).toBe(before)
    expect(collectStockBalances({}, TODAY)).toEqual({ makeup: {}, lecture: {}, makeupRows: [], lectureRows: [] })
  })

  it('台本 h: 未消化講習の行(鍵＝生徒キー__講習 ID)ごとに、生徒 ID・講習 ID・残の数・講習の期間を持つ(残 0 の行は入らない)', () => {
    const session = {
      id: 'winter', label: '冬期講習', startDate: '2026-12-14', endDate: '2027-01-10', createdAt: '', updatedAt: '',
      studentInputs: { s1: { unavailableSlots: ['2026-12-15_1'], subjectSlots: { 数: 2, 英: 1 }, regularOnly: false, countSubmitted: true, updatedAt: '' } },
      teacherInputs: {},
    }
    const payload = { ...payloadOf(), specialSessions: [session] }
    const balances = collectStockBalances(payload, TODAY)
    expect(balances.lecture).toEqual({ s1__winter: 3 })
    expect(balances.lectureRows).toHaveLength(1)
    const [row] = balances.lectureRows
    expect(row).toMatchObject({ key: 's1__winter', studentKey: 's1', studentId: 's1', sessionId: 'winter', count: 3, periodStart: '2026-12-14', periodEnd: '2027-01-10' })
    expect(row.items.map((item) => item.subject).sort()).toEqual(['数', '数', '英'])
    expect(row.items.every((item) => item.startDate === '2026-12-14' && item.endDate === '2027-01-10')).toBe(true)
    // 置いた分(台帳の -1)だけ残が減る(アプリの数え方そのもの)
    const consumed = collectStockBalances({ ...payload, boardState: { ...payload.boardState, manualLectureStockCounts: { s1__数__winter: -2, s1__英__winter: -1 } } }, TODAY)
    expect(consumed.lecture).toEqual({})
    expect(consumed.lectureRows).toEqual([])
  })

  it('台本 h: 期間の無い行(講習に結べない手動追加の在庫)は periodStart・periodEnd が空', () => {
    const payload = { ...payloadOf(), boardState: { ...payloadOf().boardState, manualLectureStockCounts: { s1__数: 1 } } }
    const [row] = collectStockBalances(payload, TODAY).lectureRows
    expect(row).toMatchObject({ key: 's1__-', studentId: 's1', count: 1, periodStart: '', periodEnd: '' })
  })
})
