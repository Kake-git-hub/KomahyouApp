// tools/ui-patrol/autoAssign.ts(台本 h「講習の自動割振」の候補選び・在庫の仕様の増減・置いた席の決まり)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜C・講師A〜B)。
import { describe, it, expect } from 'vitest'
import { AUTO_ASSIGN_OPS, checkAutoAssignPlacementRules, collectPeriodDateKeys, expectedAutoAssignStockDeltas, periodWeekStarts, pickAutoAssignPlan } from './autoAssign.ts'
import { createSeededRandom } from './scenarios.mjs'

const TODAY = '2026-11-12'
const rosterRow = (id, overrides = {}) => ({ id, name: `生徒${id}`, displayName: `生徒${id}`, email: '', entryDate: '', withdrawDate: '', birthDate: '2012-05-01', memo: '', ...overrides })
const lectureRow = (studentId, sessionId, overrides = {}) => ({
  key: `${studentId}__${sessionId}`, studentKey: studentId, studentId, sessionId, count: 2, periodStart: '2026-12-14', periodEnd: '2027-01-10',
  items: [{ subject: '数', startDate: '2026-12-14', endDate: '2027-01-10', unavailableSlots: [] }, { subject: '英', startDate: '2026-12-14', endDate: '2027-01-10', unavailableSlots: [] }],
  ...overrides,
})
const session = (id, startDate, endDate) => ({ id, label: id, startDate, endDate, createdAt: '', updatedAt: '', studentInputs: {}, teacherInputs: {} })

function planOf({ rows, makeup = {}, students = ['s1', 's2', 's3'].map((id) => rosterRow(id)), sessions = [session('winter', '2026-12-14', '2027-01-10'), session('summer', '2026-07-21', '2026-08-31')], seed = 1 }) {
  return pickAutoAssignPlan({ stock: { makeup, lecture: {}, makeupRows: [], lectureRows: rows }, payload: { students, specialSessions: sessions }, todayKey: TODAY, random: createSeededRandom(seed) })
}

describe('pickAutoAssignPlan(台本 h の候補選び)', () => {
  it('2 回: 講習だけ → 未消化振替も同時に(別の生徒)。振替も同時に、は振替の残がある生徒を先に選ぶ。同じ種なら同じ', () => {
    const rows = [lectureRow('s1', 'winter'), lectureRow('s2', 'winter'), lectureRow('s3', 'winter')]
    const plan = planOf({ rows, makeup: { 's3__数': 2, 's2__英': 0 } })
    expect(AUTO_ASSIGN_OPS.map((op) => op.name)).toEqual(['lecture-only', 'with-makeup'])
    expect(plan.ops.map((op) => op.name)).toEqual(['lecture-only', 'with-makeup'])
    expect(plan.ops[0].includeMakeup).toBe(false)
    expect(plan.ops[1]).toMatchObject({ includeMakeup: true, studentKey: 's3', makeupBalance: 2, entryKey: 's3__winter', periodStart: '2026-12-14', periodEnd: '2027-01-10' })
    expect(plan.ops[0].studentKey).not.toBe('s3')
    expect(planOf({ rows, makeup: { 's3__数': 2 } })).toEqual(plan)
  })

  it('選ばない行: 期間が今日より前(過去の講習の残り)・期間の無い行・名簿に結べない・在籍していない・講習が無い。理由を数で残す', () => {
    const rows = [
      lectureRow('s1', 'summer', { periodStart: '2026-07-21', periodEnd: '2026-08-31' }),
      lectureRow('s2', '', { key: 's2__-', periodStart: '', periodEnd: '' }),
      lectureRow(null, 'winter', { key: 'name:生徒X__winter', studentKey: 'name:生徒X' }),
      lectureRow('s3', 'winter'),
      lectureRow('s9', 'winter'),
      lectureRow('s1', 'gone'),
    ]
    const students = [rosterRow('s1'), rosterRow('s2'), rosterRow('s3', { withdrawDate: '2026-10-31' })]
    const plan = planOf({ rows, students })
    expect(plan.ops).toEqual([])
    const text = plan.skipped.join('\n')
    expect(text).toContain('期間が今日より前')
    expect(text).toContain('期間の無い行')
    expect(text).toContain('名簿に結べない')
    expect(text).toContain('在籍していない')
    expect(text).toContain('講習が見つからない')
    expect(plan.pastOnlyCount).toBe(1)
  })

  it('期間が今日をまたぐ講習は選ぶ(期間の初日が今日より前でも、終わりが今日以降)。候補が 1 行だけなら 2 回目は飛ばして理由', () => {
    const plan = planOf({ rows: [lectureRow('s1', 'winter', { periodStart: '2026-11-01' })] })
    expect(plan.ops.map((op) => op.name)).toEqual(['lecture-only'])
    expect(plan.skipped.join('\n')).toContain('未消化振替も同時に')
  })
})

describe('期間と週', () => {
  it('期間の日付(両端を含む)と、期間を含む週の月曜', () => {
    expect(collectPeriodDateKeys('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(periodWeekStarts('2026-12-16', '2026-12-28')).toEqual(['2026-12-14', '2026-12-21', '2026-12-28'])
    expect(collectPeriodDateKeys('', '')).toEqual([])
  })
})

describe('expectedAutoAssignStockDeltas(在庫の仕様の増減・INV-06)', () => {
  it('置いた講習の数だけ その行の未消化講習 −n、置いた振替は 生徒キー__科目 ごとに −n。ほかの鍵は ±0', () => {
    const op = { entryKey: 's1__winter', studentKey: 's1' }
    const placements = [
      { lessonType: 'special', subject: '数' }, { lessonType: 'special', subject: '英' },
      { lessonType: 'makeup', subject: '数' }, { lessonType: 'makeup', subject: '数' }, { lessonType: 'makeup', subject: '英' },
    ]
    expect(expectedAutoAssignStockDeltas(op, placements)).toEqual({ lecture: { s1__winter: -2 }, makeup: { 's1__数': -2, 's1__英': -1 } })
    expect(expectedAutoAssignStockDeltas(op, [])).toEqual({ lecture: {}, makeup: {} })
  })
})

describe('checkAutoAssignPlacementRules(置いた席の決まり・アプリの権威関数で確かめられる範囲)', () => {
  const D = '2026-12-14'
  const teachers = [
    { id: 't1', name: '講師A', email: '', entryDate: '', withdrawDate: '', subjectCapabilities: [{ subject: '数', maxGrade: '中' }] },
    { id: 't2', name: '講師B', email: '', entryDate: '', withdrawDate: '', subjectCapabilities: [{ subject: '英', maxGrade: '中' }] },
  ]
  const placedEntry = (overrides = {}) => ({ id: 'x1', name: '生徒s1', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'special', teacherType: 'normal', specialSessionId: 'winter', ...overrides })
  function payloadWith({ slotNumber = 3, teacherId = 't1', entry = placedEntry(), rules = [], unavailable = [], reopened = [] } = {}) {
    return {
      teachers,
      students: [rosterRow('s1')],
      autoAssignRules: rules,
      specialSessions: [{ ...session('winter', D, '2027-01-10'), studentInputs: { s1: { unavailableSlots: unavailable, reopenedSlots: reopened, subjectSlots: { 数: 1 }, regularOnly: false, countSubmitted: true, updatedAt: '' } } }],
      boardState: { weeks: [[{ id: `${D}_${slotNumber}`, dateKey: D, slotNumber, isOpenDay: true, desks: [{ id: 'd0', teacher: '講師A', teacherAssignmentTeacherId: teacherId, lesson: { id: 'L', studentSlots: [entry, null] } }] }]] },
    }
  }
  const placement = (slotNumber = 3, subject = '数') => ({ cellId: `${D}_${slotNumber}`, dateKey: D, slotNumber, deskIndex: 0, seat: 0, lessonType: 'special', subject, deskKey: `${D}_${slotNumber}#0` })
  const rule = (key, overrides = {}) => ({ key, label: key, description: '', targets: [{ type: 'all' }], excludeTargets: [], priorityScore: 0, category: 'constraint', updatedAt: '', ...overrides })
  const codes = (result) => result.findings.map((finding) => `${finding.level}:${finding.code}`)

  it('出席不可のコマ(提出の不可・「出席可能に変更」は除く＝resolveEffectiveUnavailableSlots)に置いたら stop auto-assign-rule-violated', () => {
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ unavailable: [`${D}_3`] }), [placement()], 's1'))).toEqual(['stop:auto-assign-rule-violated'])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ unavailable: [`${D}_3`], reopened: [`${D}_3`] }), [placement()], 's1'))).toEqual([])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ unavailable: [`${D}_4`] }), [placement()], 's1'))).toEqual([])
  })

  it('制約事項「指定時限禁止」(区分=制約・対象)の時限に置いたら stop。優先事項・対象外・別の時限なら所見 0', () => {
    const forbid = rule('forbidFirstPeriod', { forbiddenPeriods: [1] })
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ slotNumber: 1, rules: [forbid] }), [placement(1)], 's1'))).toEqual(['stop:auto-assign-rule-violated'])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ slotNumber: 1, rules: [{ ...forbid, category: 'priority' }] }), [placement(1)], 's1'))).toEqual([])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ slotNumber: 1, rules: [{ ...forbid, targets: [{ type: 'grade', grade: '中3' }] }] }), [placement(1)], 's1'))).toEqual([])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ slotNumber: 3, rules: [forbid] }), [placement(3)], 's1'))).toEqual([])
  })

  it('制約事項「科目対応講師のみ」: 机の講師(講師 ID で名簿から引く)がその科目を持たなければ stop。講師 ID で引けない机は確かめずに注へ数える', () => {
    const capable = rule('subjectCapableTeachersOnly')
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ rules: [capable], entry: placedEntry({ subject: '英' }) }), [placement(3, '英')], 's1'))).toEqual(['stop:auto-assign-rule-violated'])
    expect(codes(checkAutoAssignPlacementRules(payloadWith({ rules: [capable] }), [placement()], 's1'))).toEqual([])
    const unresolved = checkAutoAssignPlacementRules(payloadWith({ rules: [capable], teacherId: '講師A', entry: placedEntry({ subject: '英' }) }), [placement(3, '英')], 's1')
    expect(codes(unresolved)).toEqual([])
    expect(unresolved.notes.join('\n')).toContain('講師 ID で名簿から引けない')
  })

  it('同じコマに同じ生徒が 2 席(INV-01)は stop。数えるのはアプリの findDuplicateStudentInCellByKey(置いた席を外して同じ生徒を探す)', () => {
    const twice = payloadWith()
    twice.boardState.weeks[0][0].desks.push({ id: 'd1', teacher: '講師B', teacherAssignmentTeacherId: 't2', lesson: { id: 'L1', studentSlots: [placedEntry({ id: 'x2', subject: '英' }), null] } })
    expect(codes(checkAutoAssignPlacementRules(twice, [placement()], 's1'))).toEqual(['stop:auto-assign-rule-violated'])
    expect(codes(checkAutoAssignPlacementRules(payloadWith(), [placement()], 's1'))).toEqual([])
  })

  it('確かめられない制約事項(通常講師のみ・1 日のコマ数の上限)が制約になっていれば注に出す(止めない)', () => {
    const result = checkAutoAssignPlacementRules(payloadWith({ rules: [rule('regularTeachersOnly'), rule('maxTwoLessons')] }), [placement()], 's1')
    expect(codes(result)).toEqual([])
    expect(result.notes.join('\n')).toContain('確かめていない制約事項')
    expect(result.notes.join('\n')).toContain('regularTeachersOnly')
    expect(result.notes.join('\n')).toContain('maxTwoLessons')
  })
})
