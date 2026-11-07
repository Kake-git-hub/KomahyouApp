// 確認リストの「準備する」（自動準備・docs/plan-2026-11-06-checklist-auto-prep.md・spec-developer-report §E-2-4）の純関数テスト。
// 置き場の選び方（反映開始日より後・今日以降・休校日／保留の机／出欠記録のある席を避ける）・v2-1 と tp-64 の操作の列と結果文・
// 置けない理由・2 回目は別の席・既存の中身を変えない（INV-02）・在庫が動かない（INV-06）を固定する。
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import {
  CHECKLIST_PREP_ITEM_IDS,
  CHECKLIST_PREP_TEMPLATE_ONLY_ITEM_IDS,
  CHECKLIST_PREP_SAVE_REMINDER,
  CHECKLIST_PREP_TEMPLATE_ITEM_IDS,
  CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT,
  checklistPrepNeedsTemplate,
  applyChecklistPrepOps,
  consumeChecklistPrepRequest,
  pickChecklistPrepProfileStudent,
  planChecklistPrep,
  resolveChecklistPrepStep,
  shouldProcessChecklistPrepRequest,
  type ChecklistPrepInput,
  type ChecklistPrepOp,
} from './checklistPrep'
import { CHECKLIST_PREP_STUDENT_BIRTH_DATE, CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER, assignChecklistPrepTemplateStudents, completeChecklistPrepFacts, type ChecklistPrepTemplateRegistration } from './checklistPrepTemplate'
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

/**
 * v2-1 も tp-64 も置ける標準のコマ（机 1=テンプレ講師 A＋テンプレ生徒・机 2=テンプレ講師 B＋テンプレ生徒・机 3=テンプレ講師だけ・
 * 机 4〜6=講師も授業も無い空き机）。
 */
function fullCell(dateKey: string, slotNumber: number): SlotCell {
  const prefix = `${dateKey}_${slotNumber}`
  return cell(dateKey, slotNumber, [
    templateDesk(`${prefix}_d1`, '講師A', templateStudent(`${prefix}_s1`, 's001')),
    templateDesk(`${prefix}_d2`, '講師B', templateStudent(`${prefix}_s2`, 's002')),
    teacherOnlyDesk(`${prefix}_d3`, '講師C'),
    emptyDesk(`${prefix}_d4`),
    emptyDesk(`${prefix}_d5`),
    emptyDesk(`${prefix}_d6`),
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
  it('第 1 段は v2-1 と tp-64 の 2 項目。第 3 段(2026-11-07・§E-2-4-3)で tp-59・tp-69・tp-70・mn-1・tp-66、第 4 段(§6)で tp-71・tp-72・tp-75・v2-3・v2-6 を足した', () => {
    expect([...CHECKLIST_PREP_ITEM_IDS].sort()).toEqual(['mn-1', 'tp-59', 'tp-64', 'tp-66', 'tp-69', 'tp-70', 'tp-71', 'tp-72', 'tp-75', 'v2-1', 'v2-3', 'v2-6'])
    // テンプレへ講師も登録する新しい置き方の項目・段を続ける項目(第 4 段)は、テンプレが無いと準備しない(第 1 段の手作業の文に落とさない)。
    expect([...CHECKLIST_PREP_TEMPLATE_ONLY_ITEM_IDS].sort()).toEqual(['tp-59', 'tp-69', 'tp-70', 'tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'])
  })
})

describe('planChecklistPrep: v2-1（青字・案 A の並び替え → テンプレ保存）', () => {
  it('講師も授業も無い空き机 3 つを使う: 1 つ目に体験 2 人・2 つ目の席 1 にメモ・3 つ目に手で置く講師（テンプレの講師と生徒の机は替えない）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.cellId).toBe('2026-11-12_1')
    expect(plan.dateKey).toBe('2026-11-12')
    expect(plan.weekIndex).toBe(0)
    expect(plan.deskIndex).toBe(3)
    expect(plan.ops).toEqual<ChecklistPrepOp[]>([
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 1, name: '確認用 体験2', grade: '中1', subject: '英' },
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 4, studentIndex: 0, text: '確認用メモ1' },
      // 講師A・B・C は同じコマに居るので D（呼び名の対応表で別人）。
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 5, teacherName: '講師D', teacherId: 't4' },
    ])
    // テンプレの講師と生徒の机（机 1・2）とテンプレの講師だけの机（机 3）には何も置かない（§2-3 の講師欄 2 行の元にしない）。
    expect(plan.ops.some((op) => op.deskIndex <= 2)).toBe(false)
    expect(plan.message).toContain('11/12(木) 1限 机 4 の生徒 1・生徒 2 に体験「確認用 体験1」「確認用 体験2」を置きました')
    expect(plan.message).toContain('11/12(木) 1限 机 5 の生徒 1 にメモ「確認用メモ1」を書きました')
    expect(plan.message).toContain('11/12(木) 1限 机 6 に講師 講師D を手で置きました')
    expect(plan.message).not.toContain('替えました')
    // 保存は自動でしない（計画 §0-3）。結果文の最後に「保存を押してください」を必ず添える。
    expect(plan.message.endsWith(CHECKLIST_PREP_SAVE_REMINDER)).toBe(true)
    expect(plan.message).toContain('「保存」を押してから')
  })

  // 第119版(2026-11-07・オーナー指示「など細かい事象説明は不要。今のシンプルにした文に、いつの誰を追記して」): 成功したときの結果の文は 1〜2 行
  // (何を置いたかは項目の文に facts で差し込む)。plan.message(盤面で行ったことの詳しい文)は、テンプレ保存の段で止まったときの文に使うので残す。
  it('成功したときの結果の文(doneMessage)は 2 行: 「準備しました（日付 時限）。」と保存の一言。facts に日付・時限を入れる', () => {
    const plan = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-12', 1)]]))
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.doneMessage).toBe(`準備しました（11/12(木) 1限）。\n${CHECKLIST_PREP_SAVE_REMINDER}`)
    expect(plan.doneMessage).not.toContain('体験「')
    expect(plan.facts).toMatchObject({ slot: '11/12(木) 1限', trial: '確認用 体験1' })
    expect(CHECKLIST_PREP_SAVE_REMINDER).toBe('「保存」を押してから、次の操作を行ってください。戻すときは「後片づけ」。')
  })

  it('当てた形: 体験 2 人の机は講師なし・メモの机は授業なし・手で置いた講師の机は授業なし（manual）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    if (!plan.ok) throw new Error('plan failed')
    const applied = applyChecklistPrepOps(weeks, plan.ops, buildTeacherAliasResolver(TEACHERS), { now: 1 })
    expect(applied.skipped).toBe(0)
    const desks = applied.weeks[0][0].desks
    expect(desks[3].teacher).toBe('')
    expect(desks[3].lesson?.studentSlots.map((student) => student?.name)).toEqual(['確認用 体験1', '確認用 体験2'])
    expect(desks[4]).toMatchObject({ teacher: '', memoSlots: ['確認用メモ1', null] })
    expect(desks[4].lesson).toBeUndefined()
    expect(desks[5]).toMatchObject({ teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4' })
    expect(desks[5].lesson).toBeUndefined()
    // テンプレの机は変わらない。
    expect(desks.slice(0, 3)).toEqual(weeks[0][0].desks.slice(0, 3))
  })

  it('テンプレの講師だけの机は空き机に数えない（空き机が 3 つ無いコマは飛ばして次のコマを探す）', () => {
    const prefix = '2026-11-12_1'
    const short = cell('2026-11-12', 1, [
      templateDesk(`${prefix}_d1`, '講師A', templateStudent('s1', 's001')),
      teacherOnlyDesk(`${prefix}_d2`, '講師C'),
      emptyDesk(`${prefix}_d3`),
      emptyDesk(`${prefix}_d4`),
    ])
    const plan = planChecklistPrep(baseInput('v2-1', [[short, fullCell('2026-11-12', 2)]]))
    expect(plan.ok && plan.cellId).toBe('2026-11-12_2')
    expect(planChecklistPrep(baseInput('v2-1', [[short]]))).toMatchObject({ ok: false })
  })

  it('体験の学年・科目は渡された見本に合わせる（無ければ 中1・英）', () => {
    const plan = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-12', 1)]], { trialProfile: { grade: '高1', subject: '数' } }))
    expect(plan.ok && plan.ops[0]).toMatchObject({ kind: 'trial', grade: '高1', subject: '数' })
    expect(plan.ok && plan.ops[1]).toMatchObject({ kind: 'trial', grade: '高1', subject: '数' })
  })

  it('呼び名の対応表で同じ人は避ける（登録名と表示名が違う講師）', () => {
    const teachers = [teacher('t1', '講師A 本名', { displayName: '講師A' }), teacher('t2', '講師E')]
    const weeks = [[cell('2026-11-12', 1, [
      templateDesk('d1', '講師A 本名', templateStudent('s1', 's001')),
      emptyDesk('d2'),
      emptyDesk('d3'),
      emptyDesk('d4'),
    ])]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks, { teachers, teacherAliases: buildTeacherAliasResolver(teachers) }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops.find((op) => op.kind === 'manual-teacher')).toMatchObject({ teacherName: '講師E', teacherId: 't2', deskIndex: 3 })
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

  it('保留（2 行）の机と出欠記録のある机は空き机に数えない', () => {
    const blocked = fullCell('2026-11-12', 1)
    // 空き机 4〜6 のうち 2 つを保留と記録で塞ぐ → 11/12 は空き机が 1 つで v2-1 を置けない。
    blocked.desks[3].statusSlots = [statusEntry(), null]
    const pending: TemplatePendingDeskMap = {
      [buildTemplatePendingDeskKey(blocked.id, blocked.desks[4].id)]: { lower: { studentSlots: [null, null] } } as unknown as TemplatePendingDeskMap[string],
    }
    const weeks = [[blocked, fullCell('2026-11-13', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks, { templatePendingDesks: pending }))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
  })

  it('記録つきの空き机を飛ばして、残りの空き机を順に使う', () => {
    const target = fullCell('2026-11-12', 1)
    target.desks.push(emptyDesk('2026-11-12_1_d7'))
    target.desks[4].statusSlots = [null, statusEntry()]
    const plan = planChecklistPrep(baseInput('v2-1', [[target]]))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.ops.map((op) => op.deskIndex)).toEqual([3, 3, 5, 6])
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
    const afterFirst = applyChecklistPrepOps(weeks, first.ops, buildTeacherAliasResolver(TEACHERS), { now: 1 }).weeks
    const second = planChecklistPrep(baseInput('v2-1', afterFirst))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const firstSeats = first.ops.map((op) => `${op.cellId}/${op.deskIndex}/${'studentIndex' in op ? op.studentIndex : 't'}`)
    const secondSeats = second.ops.map((op) => `${op.cellId}/${op.deskIndex}/${'studentIndex' in op ? op.studentIndex : 't'}`)
    expect(secondSeats.some((seat) => firstSeats.includes(seat))).toBe(false)
    expect(second.cellId).toBe('2026-11-12_2')
    expect(second.ops[0]).toMatchObject({ kind: 'trial', name: '確認用 体験3' })
    expect(second.ops[1]).toMatchObject({ kind: 'trial', name: '確認用 体験4' })
    expect(second.ops[2]).toMatchObject({ kind: 'memo', text: '確認用メモ2' })
    // 前の準備は残っている。
    const afterSecond = applyChecklistPrepOps(afterFirst, second.ops, buildTeacherAliasResolver(TEACHERS), { now: 2 }).weeks
    const names = afterSecond.flat().flatMap((c) => c.desks.flatMap((d) => d.lesson?.studentSlots ?? [])).filter(Boolean).map((s) => s!.name)
    expect(names).toEqual(expect.arrayContaining(['確認用 体験1', '確認用 体験2', '確認用 体験3', '確認用 体験4']))
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
    // 残る手作業は (1)・(2) の両方の席（生徒 2）の登録が必須（任意扱いにしない・確認リスト tp-64 の prep と同じ）。
    expect(plan.message).toContain('残る手作業（必須）: 「通常授業テンプレ作成」で 木曜 1限 机 1 の生徒 2 と 木曜 1限 机 2 の生徒 2 の両方に誰かを登録して、テンプレを保存してください。')
    expect(plan.message).toContain('(1) の机は講師欄が緑の 2 行（上=講師A・下=講師D）＋生徒 2 も緑の 2 行、(2) の机は生徒 2 だけが緑で講師欄は白のまま')
    expect(plan.message).not.toContain('確かめるときは')
    expect(plan.message).not.toContain('何も変えずに')
    expect(plan.message.endsWith(CHECKLIST_PREP_SAVE_REMINDER)).toBe(true)
    // 第119版: 成功の文は 2 行。テンプレの差分反映の無い教室では手作業が残るので、その一文だけは 1 行目に残す(置いた物の説明・保存後の見え方は出さない)。
    const lines = plan.doneMessage.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('準備しました（11/12(木) 1限）。残る手作業（必須）: 「通常授業テンプレ作成」で 木曜 1限 机 1 の生徒 2 と 木曜 1限 机 2 の生徒 2 の両方に誰かを登録して、テンプレを保存してください。')
    expect(lines[1]).toBe(CHECKLIST_PREP_SAVE_REMINDER)
    expect(plan.doneMessage).not.toContain('緑の 2 行')
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
    const after = applyChecklistPrepOps(weeks, first.ops, buildTeacherAliasResolver(TEACHERS), { now: 1 }).weeks
    const second = planChecklistPrep(baseInput('tp-64', after))
    expect(second).toMatchObject({ ok: true, cellId: '2026-11-12_2' })
    if (!second.ok) return
    expect(second.ops[1]).toMatchObject({ name: '確認用 体験3' })
  })
})

describe('planChecklistPrep: tp-64 第 2 段（テンプレへの登録と保存まで・§E-2-4-2）', () => {
  // 2026-11-12 は木曜（dayOfWeek 4）。fullCell の机 1・2 はテンプレの講師＋生徒 1 人（席 1）で、席 2 が空いている。
  type TemplateSeats = Array<[RegularLessonTemplate['cells'][number]['desks'][number]['students'][0], RegularLessonTemplate['cells'][number]['desks'][number]['students'][1]]>
  function templateCellFor(desks: TemplateSeats, dayOfWeek = 4, slotNumber = 1): RegularLessonTemplate['cells'][number] {
    return { dayOfWeek, slotNumber, desks: desks.map((students, index) => ({ deskIndex: index + 1, teacherId: `t${index + 1}`, students })) }
  }
  function templateFor(desks: TemplateSeats, dayOfWeek = 4, slotNumber = 1, extraCells: RegularLessonTemplate['cells'] = []): RegularLessonTemplate {
    return {
      version: 1,
      effectiveStartDate: EFFECTIVE,
      savedAt: '2026-11-01T00:00:00.000Z',
      cells: [templateCellFor(desks, dayOfWeek, slotNumber), ...extraCells],
    }
  }
  // 金曜（2026-11-13・dayOfWeek 5）1 限のテンプレ（fullCell の机 1・2 と同じ生徒）。
  const FRIDAY_CELL = () => templateCellFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null]], 5, 1)
  const prepStudent = (id: string, letter: string): StudentRow => ({
    id, name: `確認用 生徒${letter}`, displayName: `確認用 生徒${letter}`, email: '', entryDate: TODAY, withdrawDate: '', birthDate: CHECKLIST_PREP_STUDENT_BIRTH_DATE(TODAY),
  })

  it('テンプレを要る項目は v2-1 以外（第 2 段は tp-64 だけ・第 3 段・第 4 段で広げた）。確認用の生徒は tp-64 と同じ置き方の項目が 2 人・tp-69 / tp-59 は 1 人・tp-70 は 0 人・第 4 段は 2 人(v2-3 は 3 人)', () => {
    expect([...CHECKLIST_PREP_TEMPLATE_ITEM_IDS]).toEqual(['tp-64', 'tp-59', 'tp-69', 'tp-70', 'mn-1', 'tp-66', 'tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'])
    expect(checklistPrepNeedsTemplate('tp-64')).toBe(true)
    expect(checklistPrepNeedsTemplate('v2-1')).toBe(false)
    expect(checklistPrepNeedsTemplate('nope')).toBe(false)
    expect(CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT).toEqual({ 'tp-64': 2, 'mn-1': 2, 'tp-66': 2, 'tp-69': 1, 'tp-70': 0, 'tp-59': 1, 'tp-71': 2, 'tp-72': 2, 'tp-75': 2, 'v2-3': 3, 'v2-6': 2 })
    // テンプレを要る項目は「準備する」の項目に含まれる。
    for (const itemId of CHECKLIST_PREP_TEMPLATE_ITEM_IDS) expect(CHECKLIST_PREP_ITEM_IDS).toContain(itemId)
  })

  it('template を渡すと (1)・(2) の席をテンプレ登録に返し、結果の文から「残る手作業（必須）」が消える', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const template = templateFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null]])
    const plan = planChecklistPrep(baseInput('tp-64', weeks, { template }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // 盤面の操作は第 1 段と同じ。
    expect(plan.ops).toEqual<ChecklistPrepOp[]>([
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 0, teacherName: '講師D', teacherId: 't4' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 0, studentIndex: 1, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 1, studentIndex: 1, name: '確認用 体験2', grade: '中1', subject: '英' },
    ])
    expect(plan.templateRegistrations).toEqual<ChecklistPrepTemplateRegistration[]>([
      // 第119版: (1) の席に登録した確認用の生徒の名前は、項目の文の {{prep:A}} に差し込む(factKey)。
      { dayOfWeek: 4, slotNumber: 1, deskIndex: 0, templateDeskIndex: 1, studentIndex: 1, subject: '英', label: '(1)', factKey: 'A' },
      { dayOfWeek: 4, slotNumber: 1, deskIndex: 1, templateDeskIndex: 2, studentIndex: 1, subject: '英', label: '(2)' },
    ])
    expect(plan.message).not.toContain('残る手作業')
    expect(plan.message).toContain('テンプレの (1)・(2) の席に確認用の生徒を登録して保存します')
    expect(plan.message).toContain('木曜 1限 机 1 の生徒 2')
    expect(plan.message).toContain('木曜 1限 机 2 の生徒 2')
    expect(plan.message).toContain('(1) の机は講師欄が緑の 2 行（上=講師A・下=講師D）')
    // 結果の文が言うテンプレの席へそのまま登録できる。
    const assigned = assignChecklistPrepTemplateStudents(template, plan.templateRegistrations, [prepStudent('s950', 'A'), prepStudent('s951', 'B')])
    expect(assigned.ok).toBe(true)
    if (!assigned.ok) return
    // 第119版: 項目の文に入れる facts。(1) の机・手で置いた講師(X)・テンプレの講師(Y)・(1) の体験。確認用の生徒(A)はテンプレへの登録で決まるので後から足す。
    expect(plan.facts).toEqual({ slot: '11/12(木) 1限', desk1: '机 1', X: '講師D', Y: '講師A', trial: '確認用 体験1' })
    const facts = completeChecklistPrepFacts(plan.facts, assigned.assigned)
    expect(facts).toEqual({ ...plan.facts, A: '確認用 生徒A' })
    // 同じ置き方の mn-1・tp-66 の文が使っていたキーは全部ある。
    // 第122版(2026-11-07): mn-1・tp-66 は OK で確認リストから外れたので、外す前の文が使っていたキーをここに書く(準備の処理は残してある)。
    const KEYS_USED_BY_RETIRED_ITEMS: Record<string, string[]> = {
      'mn-1': ['A', 'X', 'desk1', 'slot', 'trial'],
      'tp-66': ['A', 'X', 'Y', 'desk1', 'slot', 'trial'],
    }
    for (const [itemId, keys] of Object.entries(KEYS_USED_BY_RETIRED_ITEMS)) {
      for (const key of keys) expect(facts[key], `${itemId}: ${key}`).toBeTruthy()
    }
    // テンプレも保存する項目の成功の文は、保存の一言がテンプレ保存の後のもの(「元に戻す」が使えない・M-9)。
    expect(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER).toContain('「後片づけ」')
    expect(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER).toContain('「元に戻す」は使えません')
    expect(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER).toContain('次の操作')
  })

  it('科目は体験と同じ（見本の生徒の科目）', () => {
    const template = templateFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null]])
    const plan = planChecklistPrep(baseInput('tp-64', [[fullCell('2026-11-12', 1)]], { template, trialProfile: { grade: '高1', subject: '数' } }))
    expect(plan.ok && plan.templateRegistrations.map((entry) => entry.subject)).toEqual(['数', '数'])
  })

  it('テンプレのその曜日・時限・机の席（体験を置く席と同じ番号）が埋まっている机は (1)・(2) に選ばない', () => {
    const prefix = '2026-11-12_1'
    const threeDesks = cell('2026-11-12', 1, [
      templateDesk(`${prefix}_d1`, '講師A', templateStudent(`${prefix}_s1`, 's001')),
      templateDesk(`${prefix}_d2`, '講師B', templateStudent(`${prefix}_s2`, 's002')),
      templateDesk(`${prefix}_d3`, '講師C', templateStudent(`${prefix}_s3`, 's003')),
    ])
    // 机 1 の席 2 はテンプレでは別の生徒（盤面では休み等で空いている）。
    const template = templateFor([[{ studentId: 's001', subject: '数' }, { studentId: 's009', subject: '英' }], [{ studentId: 's002', subject: '数' }, null], [{ studentId: 's003', subject: '数' }, null]])
    const plan = planChecklistPrep(baseInput('tp-64', [[threeDesks]], { template, teachers: [...TEACHERS, teacher('t4', '講師D')] }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.templateRegistrations.map((entry) => entry.deskIndex)).toEqual([1, 2])
    expect(plan.ops.map((op) => op.deskIndex)).toEqual([1, 1, 2])
    expect(plan.message).toContain('講師を 講師B から 講師D に替え')
  })

  it('テンプレの席が 2 つ揃わないコマは使わず次のコマを探す（コマの曜日のテンプレで見る）', () => {
    const weeks = [[fullCell('2026-11-12', 1), fullCell('2026-11-13', 1)]]
    const template = templateFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, { studentId: 's009', subject: '英' }]], 4, 1, [FRIDAY_CELL()])
    const plan = planChecklistPrep(baseInput('tp-64', weeks, { template }))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
    expect(plan.ok && plan.templateRegistrations.map((entry) => entry.dayOfWeek)).toEqual([5, 5])
  })

  it('template が null（テンプレ未作成）なら盤面の机をテンプレの机に引けないので選ばない（理由を返して何もしない）', () => {
    const plan = planChecklistPrep(baseInput('tp-64', [[fullCell('2026-11-12', 1)]], { template: null }))
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.reason).toContain('テンプレの机')
  })

  it('盤面の机に対応するテンプレの机が引けない机（テンプレに居ない生徒）は (1)・(2) に選ばない', () => {
    // 机 1 の生徒 s001 はテンプレに居ない（テンプレは s002・s003）。
    const template = templateFor([[{ studentId: 's009', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null], [{ studentId: 's003', subject: '数' }, null]])
    const prefix = '2026-11-12_1'
    const threeDesks = cell('2026-11-12', 1, [
      templateDesk(`${prefix}_d1`, '講師A', templateStudent(`${prefix}_s1`, 's001')),
      templateDesk(`${prefix}_d2`, '講師B', templateStudent(`${prefix}_s2`, 's002')),
      templateDesk(`${prefix}_d3`, '講師C', templateStudent(`${prefix}_s3`, 's003')),
    ])
    const plan = planChecklistPrep(baseInput('tp-64', [[threeDesks]], { template }))
    expect(plan.ok && plan.templateRegistrations.map((entry) => [entry.deskIndex, entry.templateDeskIndex])).toEqual([[1, 2], [2, 3]])
  })

  it('テンプレの生徒の席が盤面とずれている机（テンプレは生徒 2 に居るのに盤面は生徒 1）は選ばない', () => {
    // 盤面は生徒 1 だけ居ないテンプレの机を [生徒 2, 空] に詰めて置く（buildManagedRegularLessonsRange）。そのまま席 2 に登録すると別の席になる。
    const template = templateFor([[null, { studentId: 's001', subject: '数' }], [{ studentId: 's002', subject: '数' }, null], [{ studentId: 's003', subject: '数' }, null]])
    const prefix = '2026-11-12_1'
    const threeDesks = cell('2026-11-12', 1, [
      templateDesk(`${prefix}_d1`, '講師A', templateStudent(`${prefix}_s1`, 's001')),
      templateDesk(`${prefix}_d2`, '講師B', templateStudent(`${prefix}_s2`, 's002')),
      templateDesk(`${prefix}_d3`, '講師C', templateStudent(`${prefix}_s3`, 's003')),
    ])
    const plan = planChecklistPrep(baseInput('tp-64', [[threeDesks]], { template }))
    expect(plan.ok && plan.templateRegistrations.map((entry) => entry.templateDeskIndex)).toEqual([2, 3])
  })

  it('prepStudents を渡すと、その曜日・時限に登録できる確認用の生徒が 2 人居ないコマは使わない（INV-12）', () => {
    const weeks = [[fullCell('2026-11-12', 1), fullCell('2026-11-13', 1)]]
    const template = templateFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null], [{ studentId: 's950', subject: '英' }, null]], 4, 1, [FRIDAY_CELL()])
    const prepStudents = [prepStudent('s950', 'A'), prepStudent('s951', 'B')]
    const plan = planChecklistPrep(baseInput('tp-64', weeks, { template, prepStudents }))
    expect(plan.ok && plan.cellId).toBe('2026-11-13_1')
    // 人数が足りれば同じ曜日・時限でも使う。
    const enough = planChecklistPrep(baseInput('tp-64', weeks, { template, prepStudents: [...prepStudents, prepStudent('s952', 'C')] }))
    expect(enough.ok && enough.cellId).toBe('2026-11-12_1')
  })

  it('v2-1 の templateRegistrations は空（template を渡しても）・第 1 段（template なし）の tp-64 も空', () => {
    const template = templateFor([[{ studentId: 's001', subject: '数' }, null], [{ studentId: 's002', subject: '数' }, null]])
    const v21 = planChecklistPrep(baseInput('v2-1', [[fullCell('2026-11-12', 1)]], { template }))
    expect(v21.ok && v21.templateRegistrations).toEqual([])
    const stage1 = planChecklistPrep(baseInput('tp-64', [[fullCell('2026-11-12', 1)]]))
    expect(stage1.ok && stage1.templateRegistrations).toEqual([])
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
    const applied = applyChecklistPrepOps(weeks, ops, aliases, { now: 123456 })
    expect(applied.skipped).toBe(0)
    const next = applied.weeks
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
    const { weeks: next } = applyChecklistPrepOps(weeks, [
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 2, studentIndex: 1, text: '確認用メモ1' },
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 0, teacherName: '講師D', teacherId: 't4' },
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 2, teacherName: '講師E', teacherId: 't5' },
    ], aliases, { now: 1 })
    expect(next[0][0].desks[2].memoSlots).toEqual([null, '確認用メモ1'])
    expect(next[0][0].desks[0]).toMatchObject({ teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4' })
    // 授業の無いテンプレ講師の机を替えたときは講師メニューと同じく manual-replaced。
    expect(next[0][0].desks[2]).toMatchObject({ teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', teacherAssignmentTeacherId: 't5' })
  })

  it('準備で置いた講師の机に準備の印（checklistPrepTeacher）を付ける。体験・メモの机には付けない（後片づけの見分け・§E-2-4-2）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const plan = planChecklistPrep(baseInput('v2-1', weeks))
    if (!plan.ok) throw new Error('plan failed')
    const desks = applyChecklistPrepOps(weeks, plan.ops, aliases, { now: 1 }).weeks[0][0].desks
    expect(desks[5].checklistPrepTeacher).toBe(true)
    expect(desks.filter((desk) => desk.checklistPrepTeacher).map((desk) => desk.id)).toEqual([desks[5].id])
    const tp64 = planChecklistPrep(baseInput('tp-64', weeks))
    if (!tp64.ok) throw new Error('plan failed')
    const tpDesks = applyChecklistPrepOps(weeks, tp64.ops, aliases, { now: 1 }).weeks[0][0].desks
    expect(tpDesks.filter((desk) => desk.checklistPrepTeacher).map((desk) => desk.id)).toEqual([tpDesks[0].id])
    // 入力の週には印を付けない。
    expect(weeks[0][0].desks.some((desk) => desk.checklistPrepTeacher)).toBe(false)
  })

  it('埋まっている席・メモのある席には置かない（既存を消さない）。置かなかった操作は skipped に数える', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    weeks[0][0].desks[3].memoSlots = ['既存のメモ', null]
    const { weeks: next, skipped } = applyChecklistPrepOps(weeks, [
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 0, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, name: '確認用 体験2', grade: '中1', subject: '英' },
      { kind: 'memo', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, text: '確認用メモ1' },
    ], aliases, { now: 1 })
    expect(next[0][0].desks[0].lesson?.studentSlots[0]?.name).toBe('生徒s001')
    expect(next[0][0].desks[3].lesson).toBeUndefined()
    expect(next[0][0].desks[3].memoSlots).toEqual(['既存のメモ', null])
    expect(skipped).toBe(3)
  })

  it('机の数が足りない（机・コマが見つからない）操作は置かずに skipped に数える（「置きました」と言わない・要確認 3）', () => {
    const weeks = [[fullCell('2026-11-12', 1)]]
    const applied = applyChecklistPrepOps(weeks, [
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 3, studentIndex: 0, name: '確認用 体験1', grade: '中1', subject: '英' },
      { kind: 'trial', cellId: '2026-11-12_1', deskIndex: 9, studentIndex: 0, name: '確認用 体験2', grade: '中1', subject: '英' },
      { kind: 'manual-teacher', cellId: '2026-11-12_1', deskIndex: 12, teacherName: '講師D', teacherId: 't4' },
      { kind: 'memo', cellId: '2026-11-19_1', deskIndex: 0, studentIndex: 0, text: '確認用メモ1' },
    ], aliases, { now: 1 })
    expect(applied.skipped).toBe(3)
    expect(applied.weeks[0][0].desks).toHaveLength(6)
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
    // テンプレへ講師も登録する項目（tp-59・tp-69・tp-70）はテンプレが無いと準備しない。その在庫は checklistPrepStage3.test.ts が
    // 実際のテンプレ保存まで通して固定する（ここは第 1 段の形＝テンプレを渡さない盤面だけの準備）。
    for (const itemId of CHECKLIST_PREP_ITEM_IDS.filter((id) => !(CHECKLIST_PREP_TEMPLATE_ONLY_ITEM_IDS as readonly string[]).includes(id))) {
      const plan = planChecklistPrep(baseInput(itemId, weeks))
      if (!plan.ok) throw new Error(`plan failed: ${itemId}`)
      const { weeks: next, skipped } = applyChecklistPrepOps(weeks, plan.ops, aliases, { now: 1 })
      expect(skipped).toBe(0)
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
    request: { requestId: 1, itemId: 'v2-1', classroomId: 'dev' },
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
  const ready = { classroomId: 'dev', isEditingStateLoaded: true }

  it('処理済みの requestId は二度処理しない・消費は同じ requestId のときだけ null', () => {
    const request = { requestId: 3, itemId: 'v2-1', classroomId: 'dev' }
    expect(shouldProcessChecklistPrepRequest(null, null, ready)).toBe(false)
    expect(shouldProcessChecklistPrepRequest(request, null, ready)).toBe(true)
    expect(shouldProcessChecklistPrepRequest(request, 3, ready)).toBe(false)
    expect(consumeChecklistPrepRequest(request, 3)).toBeNull()
    expect(consumeChecklistPrepRequest(request, 2)).toBe(request)
    expect(consumeChecklistPrepRequest(null, 3)).toBeNull()
  })

  it('押した教室とコマ表の教室が違う・教室データの読み込みが済んでいない間は処理しない（消費もせず待つ・INV-08・要確認 1）', () => {
    const request = { requestId: 4, itemId: 'v2-1', classroomId: 'dev' }
    expect(shouldProcessChecklistPrepRequest(request, null, { classroomId: 'other', isEditingStateLoaded: true })).toBe(false)
    expect(shouldProcessChecklistPrepRequest(request, null, { classroomId: null, isEditingStateLoaded: true })).toBe(false)
    expect(shouldProcessChecklistPrepRequest(request, null, { classroomId: 'dev', isEditingStateLoaded: false })).toBe(false)
    expect(shouldProcessChecklistPrepRequest({ ...request, classroomId: null }, null, { classroomId: null, isEditingStateLoaded: true })).toBe(false)
    expect(shouldProcessChecklistPrepRequest(request, null, ready)).toBe(true)
  })
})

describe('体験の学年の見本（軽微 7）', () => {
  const row = (id: string, overrides: Partial<StudentRow> = {}): StudentRow => ({
    id, name: `生徒${id}`, displayName: `生徒${id}`, email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...overrides,
  } as StudentRow)

  it('今日在籍している生徒（生年月日あり）から取る。退塾・入塾前・生年月日なしは選ばない。誰も居なければ null（固定値の 中1・英）', () => {
    const students = [
      row('w', { withdrawDate: '2026-10-31' }),
      row('f', { entryDate: '2026-12-01' }),
      row('n', { birthDate: '' }),
      row('a', { birthDate: '2010-06-01' }),
    ]
    expect(pickChecklistPrepProfileStudent(students, TODAY)?.id).toBe('a')
    expect(pickChecklistPrepProfileStudent(students.slice(0, 3), TODAY)).toBeNull()
    expect(pickChecklistPrepProfileStudent([], TODAY)).toBeNull()
  })
})
