// 確認リストの「準備する」（自動準備・docs/plan-2026-11-06-checklist-auto-prep.md・spec-developer-report §E-2-4）の純関数テスト。
// 置き場の選び方（反映開始日より後・今日以降・休校日／保留の机／出欠記録のある席を避ける）・v2-1 と tp-64 の操作の列と結果文・
// 置けない理由・2 回目は別の席・既存の中身を変えない（INV-02）・在庫が動かない（INV-06）を固定する。
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { ClassroomSettings } from '../../types/appState'
import {
  CHECKLIST_PREP_ITEM_IDS,
  CHECKLIST_PREP_SAVE_REMINDER,
  applyChecklistPrepOps,
  consumeChecklistPrepRequest,
  planChecklistPrep,
  resolveChecklistPrepStep,
  shouldProcessChecklistPrepRequest,
  type ChecklistPrepInput,
  type ChecklistPrepOp,
} from './checklistPrep'
import { buildMakeupStockEntries } from './makeupStock'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { buildTeacherAliasResolver } from './templateDiffApply'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'

const TODAY = '2026-11-10'
const EFFECTIVE = '2026-11-11'

function teacher(id: string, name: string, overrides: Partial<TeacherRow> = {}): TeacherRow {
  return { id, name, email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [], ...overrides }
}

const TEACHERS: TeacherRow[] = [teacher('t1', '講師A'), teacher('t2', '講師B'), teacher('t3', '講師C')]

function templateStudent(id: string, managedStudentId: string): StudentEntry {
  return { id, name: `生徒${managedStudentId}`, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' }
}

function templateDesk(id: string, teacherName: string, student: StudentEntry | null, second: StudentEntry | null = null): DeskCell {
  return { id, teacher: teacherName, lesson: { id: `managed_${id}`, studentSlots: [student, second] } }
}

function teacherOnlyDesk(id: string, teacherName: string): DeskCell {
  return { id, teacher: teacherName }
}

function emptyDesk(id: string): DeskCell {
  return { id, teacher: '' }
}

const DAY_LABELS: Record<string, string> = { '2026-11-09': '月', '2026-11-10': '火', '2026-11-11': '水', '2026-11-12': '木', '2026-11-13': '金', '2026-11-14': '土', '2026-11-16': '月' }

function cell(dateKey: string, slotNumber: number, desks: DeskCell[], overrides: Partial<SlotCell> = {}): SlotCell {
  const [, month, day] = dateKey.split('-')
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: DAY_LABELS[dateKey] ?? '',
    dateLabel: `${Number(month)}/${Number(day)}`,
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '',
    isOpenDay: true,
    desks,
    ...overrides,
  }
}

/** v2-1 も tp-64 も置ける標準のコマ（机 1=テンプレ講師 A＋テンプレ生徒・机 2=テンプレ講師 B＋テンプレ生徒・机 3=テンプレ講師だけ・机 4=空）。 */
function fullCell(dateKey: string, slotNumber: number): SlotCell {
  const prefix = `${dateKey}_${slotNumber}`
  return cell(dateKey, slotNumber, [
    templateDesk(`${prefix}_d1`, '講師A', templateStudent(`${prefix}_s1`, 's001')),
    templateDesk(`${prefix}_d2`, '講師B', templateStudent(`${prefix}_s2`, 's002')),
    teacherOnlyDesk(`${prefix}_d3`, '講師C'),
    emptyDesk(`${prefix}_d4`),
  ])
}

function baseInput(itemId: string, weeks: SlotCell[][], overrides: Partial<ChecklistPrepInput> = {}): ChecklistPrepInput {
  return {
    itemId,
    weeks,
    todayKey: TODAY,
    effectiveStartDate: EFFECTIVE,
    templatePendingDesks: null,
    teachers: [...TEACHERS, teacher('t4', '講師D')],
    teacherAliases: buildTeacherAliasResolver([...TEACHERS, teacher('t4', '講師D')]),
    ...overrides,
  }
}

function statusEntry(): StudentStatusEntry {
  return {
    id: 'st1', studentId: 'x', sourceManagedLesson: true, name: '記録', grade: '中1', subject: '英', lessonType: 'regular', teacherType: 'normal',
    teacherName: '講師A', dateKey: '2026-11-12', slotNumber: 1, recordedAt: '2026-11-12T10:00:00Z', status: 'attended', sourceLessonId: 'l1',
  }
}

describe('CHECKLIST_PREP_ITEM_IDS', () => {
  it('第 1 段は v2-1 と tp-64 の 2 項目', () => {
    expect([...CHECKLIST_PREP_ITEM_IDS].sort()).toEqual(['tp-64', 'v2-1'])
  })
})

describe('planChecklistPrep: v2-1（青字）', () => {
  it('空き机に体験・その机の別の席にメモ・テンプレの生徒が居る机の講師を手で別の講師へ替える（同じコマの講師と重ならない）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.cellId).toBe('2026-11-12_1')
    expect(plan.dateKey).toBe('2026-11-12')
    expect(plan.weekIndex).toBe(0)
    expect(plan.ops).toEqual<ChecklistPrepOp[]>([
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 2, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 2, studentIndex: 1, text: '確認用メモ1' },
      // 講師A・B・C は同じコマに居るので D（呼び名の対応表で別人）。
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 0, teacherName: '講師D', teacherId: 't4' },
    ])
    expect(plan.message).toContain('11/12(木) 1限 机 3 の生徒 1 に体験「確認用 体験1」を置きました')
    expect(plan.message).toContain('11/12(木) 1限 机 3 の生徒 2 にメモ「確認用メモ1」を書きました')
    expect(plan.message).toContain('11/12(木) 1限 机 1 の講師を 講師A から 講師D に替えました')
    // 保存は自動でしない（計画 §0-3）。結果文の最後に「保存を押してください」を必ず添える。
    expect(plan.message.endsWith(CHECKLIST_PREP_SAVE_REMINDER)).toBe(true)
    expect(plan.message).toContain('「保存」を押してから')
  })

  it('講師だけの机が無ければ空の机に体験を置く', () => {
    const prefix = '2026-11-12_1'
    const weeks = [[cell('2026-11-12', 1, [
      templateDesk(`${prefix}_d1`, '講師A', templateStudent('s1', 's001')),
      emptyDesk(`${prefix}_d2`),
    ])]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops[0]).toMatchObject({ kind: 'trial', deskIndex: 1, studentIndex: 0 })
  })

  it('体験の学年・科目は渡された見本に合わせる（無ければ 中1・英）', () => {
    const plan = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-12', 1)]], { trialProfile: { grade: '高1', subject: '数' } }))
    expect(plan.ok && plan.ops[0]).toMatchObject({ kind: 'trial', grade: '高1', subject: '数' })
  })

  it('呼び名の対応表で同じ人は避ける（登録名と表示名が違う講師）', () => {
    const teachers = [teacher('t1', '講師A 本名', { displayName: '講師A' }), teacher('t2', '講師E')]
    const weeks = [[cell('2026-11-12', 1, [
      templateDesk('d1', '講師A 本名', templateStudent('s1', 's001')),
      emptyDesk('d2'),
    ])]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks, { teachers, teacherAliases: buildTeacherAliasResolver(teachers) }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops.find((op) => op.kind === 'manual-teacher')).toMatchObject({ teacherName: '講師E', teacherId: 't2' })
  })

  it('退塾した講師は選ばない', () => {
    const teachers = [...TEACHERS, teacher('t4', '講師D', { withdrawDate: '2026-10-31' })]
    const plan = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-12', 1)]], { teachers, teacherAliases: buildTeacherAliasResolver(teachers) }))
    expect(plan.ok).toBe(false)
  })
})

describe('planChecklistPrep: 置き場の選び方', () => {
  it('反映開始日（当日を含む）より前・今日より前・休校日のコマは使わず、その次の営業日から探す', () => {
    const weeks = [[
      fullCell('2026-11-09', 1), // 今日より前
      fullCell('2026-11-11', 1), // 反映開始日の当日（「より後」ではない）
      { ...fullCell('2026-11-12', 1), isOpenDay: false }, // 休校日
      fullCell('2026-11-13', 2),
      fullCell('2026-11-13', 1), // 同じ日の早い時限を先に見る
    ]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
  })

  it('反映開始日が今日より前なら今日以降から探す（反映開始日が無ければ今日より後）', () => {
    const weeks = [[fullCell('2026-11-09', 1), fullCell('2026-11-10', 1), fullCell('2026-11-11', 1)]]
    expect(planChecklistPrep(baseInput('v2-1', weeks, { effectiveStartDate: '2026-11-01' }))).toMatchObject({ ok: true, cellId: '2026-11-10_1' })
    expect(planChecklistPrep(baseInput('v2-1', weeks, { effectiveStartDate: null }))).toMatchObject({ ok: true, cellId: '2026-11-11_1' })
  })

  it('保留（2 行）の机と出欠記録のある机は使わない', () => {
    const blocked = fullCell('2026-11-12', 1)
    // 体験を置ける机 3・4 を保留と記録で塞ぐ → 11/12 は v2-1 を置けない。
    blocked.desks[3].statusSlots = [statusEntry(), null]
    const pending: TemplatePendingDeskMap = {
      [buildTemplatePendingDeskKey(blocked.id, blocked.desks[2].id)]: { lower: { studentSlots: [null, null] } } as unknown as TemplatePendingDeskMap[string],
    }
    const weeks = [[blocked, fullCell('2026-11-13', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks, { templatePendingDesks: pending }))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
  })

  it('講師を替える机が保留・記録つきなら別の机を使う', () => {
    const target = fullCell('2026-11-12', 1)
    target.desks[0].statusSlots = [null, statusEntry()]
    const plan = planChecklistPrep(baseInput('v2-1', [[target]]))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops.find((op) => op.kind === 'manual-teacher')).toMatchObject({ deskIndex: 1 })
  })

  it('置ける場所が無ければ理由を返して何もしない', () => {
    const plan = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-09', 1)]]))
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('見つかりませんでした')
  })

  it('準備できない項目は理由を返す', () => {
    const plan = planChecklistPrep(baseInput('tp-71', [[fullCell('2026-11-12', 1)]]))
    expect(plan).toMatchObject({ ok: false })
  })

  it('もう一度押すと前の準備は残したまま別の席を使う（体験・メモは連番）', () => {
    const weeks = [[fullCell('2026-11-12', 1), fullCell('2026-11-12', 2)]]
    const first = planChecklistPrep(baseInput('v2-1', weeks))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const afterFirst = applyChecklistPrepOps(weeks, first.ops, buildTeacherAliasResolver(TEACHERS), { now: 1 })
    const second = planChecklistPrep(baseInput('v2-1', afterFirst))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const firstSeats = first.ops.map((op) => `${op.cellId}/${op.deskIndex}/${'studentIndex' in op ? op.studentIndex : 't'}`)
    const secondSeats = second.ops.map((op) => `${op.cellId}/${op.deskIndex}/${'studentIndex' in op ? op.studentIndex : 't'}`)
    expect(secondSeats.some((seat) => firstSeats.includes(seat))).toBe(false)
    expect(second.ops[0]).toMatchObject({ kind: 'trial', name: '確認用 体験2' })
    expect(second.ops[1]).toMatchObject({ kind: 'memo', text: '確認用メモ2' })
    // 前の準備は残っている。
    const afterSecond = applyChecklistPrepOps(afterFirst, second.ops, buildTeacherAliasResolver(TEACHERS), { now: 2 })
    const names = afterSecond.flat().flatMap((c) => c.desks.flatMap((d) => d.lesson?.studentSlots ?? [])).filter(Boolean).map((s) => s!.name)
    expect(names).toEqual(expect.arrayContaining(['確認用 体験1', '確認用 体験2']))
  })
})

describe('planChecklistPrep: tp-64（講師欄の緑）', () => {
  it('(1) テンプレの講師と生徒の机の講師を手で替えて席 2 に体験・(2) 別のテンプレ机の席 2 に体験。残る手作業を日付・時限・机で書く', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const plan = planChecklistPrep(baseInput('tp-64', weeks))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops).toEqual<ChecklistPrepOp[]>([
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 0, teacherName: '講師D', teacherId: 't4' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 0, studentIndex: 1, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 1, studentIndex: 1, name: '確認用 体験2', grade: '中1', subject: '英' },
    ])
    expect(plan.message).toContain('(1) 11/12(木) 1限 机 1')
    expect(plan.message).toContain('講師を 講師A から 講師D に替え')
    expect(plan.message).toContain('(2) 11/12(木) 1限 机 2 の生徒 2 に体験「確認用 体験2」')
    expect(plan.message).toContain('(1) は何も変えずにテンプレを保存すれば')
    expect(plan.message).toContain('「通常授業テンプレ作成」で 木曜 1限 机 2 の生徒 2 に誰かを登録して保存')
    // (1) の席の採用（生徒の 2 行）も確かめられるよう、同じ机の席も具体的に書く。
    expect(plan.message).toContain('木曜 1限 机 1 の生徒 2 にも誰かを登録')
    expect(plan.message.endsWith(CHECKLIST_PREP_SAVE_REMINDER)).toBe(true)
  })

  it('テンプレの机が 2 つ揃わないコマは使わない（席 2 が埋まっている・テンプレの生徒が居ない）', () => {
    const prefix = '2026-11-12_1'
    const weeks = [[
      cell('2026-11-12', 1, [
        templateDesk(`${prefix}_d1`, '講師A', templateStudent('s1', 's001')),
        templateDesk(`${prefix}_d2`, '講師B', templateStudent('s2', 's002'), templateStudent('s3', 's003')),
        teacherOnlyDesk(`${prefix}_d3`, '講師C'),
      ]),
      fullCell('2026-11-13', 1),
    ]]
    const plan = planChecklistPrep(baseInput('tp-64', weeks))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
  })

  it('手で置いた講師の机はテンプレの机に数えない（2 回目は別のコマ）', () => {
    const weeks = [[fullCell('2026-11-12', 1), fullCell('2026-11-12', 2)]]
    const first = planChecklistPrep(baseInput('tp-64', weeks))
    if (!first.ok) throw new Error('first plan failed')
    const after = applyChecklistPrepOps(weeks, first.ops, buildTeacherAliasResolver(TEACHERS), { now: 1 })
    const second = planChecklistPrep(baseInput('tp-64', after))
    expect(second).toMatchObject({ ok: true, cellId: '2026-11-12_2' })
    if (!second.ok) return
    expect(second.ops[1]).toMatchObject({ name: '確認用 体験3' })
  })
})

describe('applyChecklistPrepOps', () => {
  const aliases = buildTeacherAliasResolver(TEACHERS)

  it('体験は手動追加と同じ形（id・lesson.id の規則・trial・manualAdded）で置き、入力の weeks は書き換えない', () => {
    const weeks = [[fullCell('2026-11-12', 1), fullCell('2026-11-13', 1)]]
    const before = structuredClone(weeks)
    const ops: ChecklistPrepOp[] = [
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 0, studentIndex: 1, name: '確認用 体験2', grade: '中1', subject: '英' },
    ]
    const next = applyChecklistPrepOps(weeks, ops, aliases, { now: 123456 })
    expect(weeks).toEqual(before)
    const desk = next[0][0].desks[3]
    expect(desk.lesson?.id).toBe('2026-11-12_1_desk_4_manual')
    expect(desk.lesson?.studentSlots[0]).toEqual({
      id: `2026-11-12_1_3_0_${(123456).toString(36)}`,
      name: '確認用 体験1',
      grade: '中1',
      subject: '英',
      lessonType: 'trial',
      teacherType: 'normal',
      manualAdded: true,
    })
    // 既にある授業の机は lesson.id を変えず、空いた席にだけ入れる。
    const existing = next[0][0].desks[0]
    expect(existing.lesson?.id).toBe(before[0][0].desks[0].lesson?.id)
    expect(existing.lesson?.studentSlots[0]).toEqual(before[0][0].desks[0].lesson?.studentSlots[0])
    expect(existing.lesson?.studentSlots[1]).toMatchObject({ name: '確認用 体験2', lessonType: 'trial', manualAdded: true })
    // 触らないコマ・机はそのまま（INV-02）。
    expect(next[0][1]).toEqual(before[0][1])
    expect(next[0][0].desks[1]).toEqual(before[0][0].desks[1])
  })

  it('メモは memoSlots に書き、講師は手で置いた講師（manualTeacher・ID つき）にする', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const next = applyChecklistPrepOps(weeks, [
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 2, studentIndex: 1, text: '確認用メモ1' },
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 0, teacherName: '講師D', teacherId: 't4' },
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 2, teacherName: '講師E', teacherId: 't5' },
    ], aliases, { now: 1 })
    expect(next[0][0].desks[2].memoSlots).toEqual([null, '確認用メモ1'])
    expect(next[0][0].desks[0]).toMatchObject({ teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4' })
    // 授業の無いテンプレ講師の机を替えたときは講師メニューと同じく manual-replaced。
    expect(next[0][0].desks[2]).toMatchObject({ teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', teacherAssignmentTeacherId: 't5' })
  })

  it('埋まっている席・メモのある席には置かない（既存を消さない）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    weeks[0][0].desks[3].memoSlots = ['既存のメモ', null]
    const next = applyChecklistPrepOps(weeks, [
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 0, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, name: '確認用 体験2', grade: '中1', subject: '英' },
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, text: '確認用メモ1' },
    ], aliases, { now: 1 })
    expect(next[0][0].desks[0].lesson?.studentSlots[0]?.name).toBe('生徒s001')
    expect(next[0][0].desks[3].lesson).toBeUndefined()
    expect(next[0][0].desks[3].memoSlots).toEqual(['既存のメモ', null])
  })

  it('準備（体験・メモ・講師）では振替の未消化（在庫）が変わらない（INV-06）', () => {
    const students: StudentRow[] = [
      { id: 's001', name: '生徒 1', displayName: '生徒1', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
      { id: 's002', name: '生徒 2', displayName: '生徒2', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    ] as StudentRow[]
    const settings: ClassroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 4 } as ClassroomSettings
    const absent = fullCell('2026-11-12', 2)
    absent.desks[0].statusSlots = [{ ...statusEntry(), studentId: 's001', managedStudentId: 's001', subject: '数', status: 'absent', lessonType: 'makeup', makeupSourceDate: '2026-11-02', dateKey: '2026-11-12', slotNumber: 2 }, null]
    const weeks = [[fullCell('2026-11-12', 1), absent]]
    const stock = (target: SlotCell[][]) => buildMakeupStockEntries({
      students, teachers: TEACHERS, regularLessons: [], classroomSettings: settings, weeks: target, manualAdjustments: {},
      resolveStudentKey: (entry) => entry.managedStudentId ?? entry.id, today: new Date('2026-11-10T00:00:00'),
    }).map((entry) => ({ key: entry.key, balance: entry.balance }))
    expect(stock(weeks).length).toBeGreaterThan(0)
    for (const itemId of CHECKLIST_PREP_ITEM_IDS) {
      const plan = planChecklistPrep(baseInput(itemId, weeks))
      if (!plan.ok) throw new Error(`plan failed: ${itemId}`)
      const next = applyChecklistPrepOps(weeks, plan.ops, aliases, { now: 1 })
      expect(stock(next)).toEqual(stock(weeks))
      // 足したのは体験だけ。
      const added = next.flat().flatMap((c) => c.desks.flatMap((d) => d.lesson?.studentSlots ?? [])).filter((s) => s?.name.startsWith('確認用'))
      expect(added.length).toBeGreaterThan(0)
      expect(added.every((s) => s?.lessonType === 'trial' && s.manualAdded === true)).toBe(true)
    }
  })
})

describe('resolveChecklistPrepStep（コマ表の effect が通す 1 回分の判断）', () => {
  const weeks = [[fullCell('2026-11-05', 1)], [fullCell('2026-11-12', 1)]]
  const base = {
    request: { requestId: 1, itemId: 'v2-1' },
    isVerificationClassroom: true,
    isTemplateMode: false,
    currentWeekIndex: 1,
    jumpCount: 0,
    input: baseInput('v2-1', weeks),
  }

  it('検証用教室（開発用・テスト教室）でなければ断る', () => {
    expect(resolveChecklistPrepStep({ ...base, isVerificationClassroom: false })).toMatchObject({ kind: 'finish', ok: false })
  })

  it('テンプレ編集中は断る', () => {
    const step = resolveChecklistPrepStep({ ...base, isTemplateMode: true })
    expect(step).toMatchObject({ kind: 'finish', ok: false })
    expect(step.kind === 'finish' && step.message).toContain('テンプレート編集中')
  })

  it('置き場の週が表示中でなければ先にその日へ移る。移ったのにまだ違えば失敗で返す', () => {
    expect(resolveChecklistPrepStep({ ...base, currentWeekIndex: 0 })).toEqual({ kind: 'jump', dateKey: '2026-11-12' })
    expect(resolveChecklistPrepStep({ ...base, currentWeekIndex: 0, jumpCount: 2 })).toMatchObject({ kind: 'finish', ok: false })
  })

  it('表示中の週に置き場があれば当てる計画を返す', () => {
    const step = resolveChecklistPrepStep(base)
    expect(step.kind).toBe('apply')
    expect(step.kind === 'apply' && step.plan.cellId).toBe('2026-11-12_1')
  })

  it('盤面の週が反映開始日より後まで届いていなければ、まずその日へ移る（週が作られる）', () => {
    const short = [[fullCell('2026-11-05', 1)]]
    expect(resolveChecklistPrepStep({ ...base, currentWeekIndex: 0, input: baseInput('v2-1', short) })).toEqual({ kind: 'jump', dateKey: '2026-11-12' })
  })

  it('置けなければ理由で返す', () => {
    const none = [[fullCell('2026-11-12', 1, )].map((c) => ({ ...c, isOpenDay: false }))]
    expect(resolveChecklistPrepStep({ ...base, currentWeekIndex: 0, input: baseInput('v2-1', none) })).toMatchObject({ kind: 'finish', ok: false })
  })
})

describe('一過性リクエストの消費（Issue #46 同型）', () => {
  it('処理済みの requestId は二度処理しない・消費は同じ requestId のときだけ null', () => {
    const request = { requestId: 3, itemId: 'v2-1' }
    expect(shouldProcessChecklistPrepRequest(null, null)).toBe(false)
    expect(shouldProcessChecklistPrepRequest(request, null)).toBe(true)
    expect(shouldProcessChecklistPrepRequest(request, 3)).toBe(false)
    expect(consumeChecklistPrepRequest(request, 3)).toBeNull()
    expect(consumeChecklistPrepRequest(request, 2)).toBe(request)
    expect(consumeChecklistPrepRequest(null, 3)).toBeNull()
  })
})
