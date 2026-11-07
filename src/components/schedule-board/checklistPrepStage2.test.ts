// 確認リストの「準備する」第 2 段（docs/plan-2026-11-06-checklist-auto-prep-stage2.md Task 3・spec-developer-report §E-2-4-2）の
// コマ表の 2 段処理（盤面の準備 → テンプレ保存）と後片づけを組む純関数のテスト。
// - 結果の文（成功）: 第119版（2026-11-07 オーナー指示「など細かい事象説明は不要。今のシンプルにした文に、いつの誰を追記して」）で
//   「準備しました（日付 時限）。」＋保存の一言の 2 行（何を置いたか・「詳細」は出さない。いつ・誰は項目の文へ facts で差し込む）。
// - テンプレ保存の段で失敗（テンプレ編集中になった・教室が切り替わった）→ 盤面は置いたままで「テンプレは保存していません」と出す（Review Focus 3）。
// - 後片づけ: 何も無ければ件数で「片づけるものはありません」（Review Focus 5）・テンプレから消すのは確認用の生徒だけ（退塾した確認用も・INV-02）。
import { describe, expect, it } from 'vitest'

import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonTemplate, RegularLessonTemplateCell, RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { buildTemplateBoardCells, filterTemplateParticipantsForReferenceDate, resolveTemplateDiffBaseline } from '../regular-template/regularLessonTemplate'
import {
  CHECKLIST_PREP_SAVE_REMINDER,
  CHECKLIST_PREP_TEMPLATE_PHASE_TIMEOUT_MS,
  CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT,
  resolveChecklistPrepAbortMessage,
  resolveChecklistPrepStep,
  type ChecklistPrepRequest,
} from './checklistPrep'
import { findTemplateDuplicateStudents } from './templateEditorGuards'
import {
  CHECKLIST_PREP_CLEANUP_BOARD_SAVE_REMINDER,
  CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE,
  CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE,
  CHECKLIST_PREP_CLEANUP_SAVE_REMINDER,
  CHECKLIST_PREP_CLEANUP_TEMPLATE_FAILED_PREFIX,
  CHECKLIST_PREP_CLEANUP_TEMPLATE_MODE_MESSAGE,
  CHECKLIST_PREP_STUDENT_BIRTH_DATE,
  CHECKLIST_PREP_STUDENT_NAME_PREFIX,
  CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE,
  CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX,
  CHECKLIST_PREP_TEMPLATE_FAILED_REMINDER,
  CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON,
  CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON,
  CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER,
  annotateChecklistPrepResultWithAddedStudents,
  buildChecklistPrepCleanupMessage,
  buildChecklistPrepDoneMessage,
  buildChecklistPrepTemplateFailedMessage,
  completeChecklistPrepFacts,
  planChecklistPrepCleanup,
  prepareChecklistPrepTemplateSave,
  resolveChecklistPrepCleanupBlock,
  resolveChecklistPrepCleanupEffectiveStartDate,
  resolveChecklistPrepTemplatePhaseBlock,
  resolveChecklistPrepTemplatePhaseTiming,
  type ChecklistPrepTemplatePhase,
  type ChecklistPrepTemplateAssignment,
  type ChecklistPrepTemplateRegistration,
} from './checklistPrepTemplate'
import { buildTemplateDiffConfirmDetail, createEmptyTemplateDiffApplySummary } from './templateDiffApply'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { DeskCell, SlotCell, StudentEntry } from './types'

const TODAY = '2026-11-10'
const EFFECTIVE = '2026-11-16'
const SAVED_AT = '2026-11-10T03:00:00.000Z'
const CELL = '2026-11-19_3'

function row(id: string, name: string, overrides: Partial<StudentRow> = {}): StudentRow {
  return { id, name, displayName: '', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2012-05-01', ...overrides }
}

function prepRow(id: string, letter: string, overrides: Partial<StudentRow> = {}): StudentRow {
  const name = `${CHECKLIST_PREP_STUDENT_NAME_PREFIX}${letter}`
  return row(id, name, { displayName: name, entryDate: TODAY, birthDate: CHECKLIST_PREP_STUDENT_BIRTH_DATE(TODAY), ...overrides })
}

function templateDesk(deskIndex: number, teacherId: string, students: RegularLessonTemplateDesk['students'] = [null, null]): RegularLessonTemplateDesk {
  return { deskIndex, teacherId, students }
}

function templateCell(dayOfWeek: number, slotNumber: number, desks: RegularLessonTemplateDesk[]): RegularLessonTemplateCell {
  return { dayOfWeek, slotNumber, desks }
}

function template(cells: RegularLessonTemplateCell[]): RegularLessonTemplate {
  return { version: 1, effectiveStartDate: '2026-11-02', savedAt: '2026-11-01T00:00:00.000Z', cells }
}

function registration(templateDeskIndex: number, label: string): ChecklistPrepTemplateRegistration {
  return { dayOfWeek: 4, slotNumber: 3, deskIndex: templateDeskIndex - 1, templateDeskIndex, studentIndex: 1, subject: '英', label }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const BOARD_LINES = [
  '(1) 11/19(木) 3限 机 2 の講師を 講師A から 講師D に替え（手で置いた講師）、生徒 2 に体験「確認用 体験1」を置きました。',
  '(2) 11/19(木) 3限 机 3 の生徒 2 に体験「確認用 体験2」を置きました。',
  'テンプレの (1)・(2) の席に確認用の生徒を登録して保存します（木曜 3限 机 2 の生徒 2 と 木曜 3限 机 3 の生徒 2）。',
]
const BOARD_MESSAGE = [...BOARD_LINES, CHECKLIST_PREP_SAVE_REMINDER].join('\n')

const ASSIGNED: ChecklistPrepTemplateAssignment[] = [
  { ...registration(2, '(1)'), studentId: 's901', studentName: '確認用 生徒A' },
  { ...registration(3, '(2)'), studentId: 's902', studentName: '確認用 生徒B' },
]

describe('buildChecklistPrepDoneMessage（準備が済んだときの結果の文・第119版）', () => {
  it('テンプレも保存したとき: 「準備しました（日付 時限）。」とテンプレ保存の後の一言の 2 行だけ（置いた物・登録した席・「詳細」は書かない）', () => {
    const message = buildChecklistPrepDoneMessage({ slot: '11/19(木) 3限', templateSaved: true })
    expect(message.split('\n')).toEqual(['準備しました（11/19(木) 3限）。', CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER])
    expect(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER).toBe('「保存」を押してから「操作」を行ってください。戻すときは「後片づけ」（「元に戻す」は使えません）。')
    expect(message).not.toContain('詳細')
    expect(message).not.toContain('やること')
  })

  it('盤面だけのとき: 盤面だけの一言（「元に戻す」も使える）。残る手作業があれば 1 行目に続けて書く', () => {
    expect(buildChecklistPrepDoneMessage({ slot: '11/19(木) 3限', templateSaved: false })).toBe(`準備しました（11/19(木) 3限）。\n${CHECKLIST_PREP_SAVE_REMINDER}`)
    expect(buildChecklistPrepDoneMessage({ slot: '11/19(木) 3限', templateSaved: false, todo: '残る手作業: X。' })).toBe(`準備しました（11/19(木) 3限）。残る手作業: X。\n${CHECKLIST_PREP_SAVE_REMINDER}`)
  })
})

describe('completeChecklistPrepFacts（テンプレへの登録で決まる名前を facts に足す・第119版）', () => {
  it('登録に factKey のある確認用の生徒の名前を足す（factKey の無い登録・入力の facts は変えない）', () => {
    const facts = { slot: '11/19(木) 3限', X: '講師D' }
    const assigned: ChecklistPrepTemplateAssignment[] = [{ ...ASSIGNED[0], factKey: 'A' }, ASSIGNED[1]]
    expect(completeChecklistPrepFacts(facts, assigned)).toEqual({ slot: '11/19(木) 3限', X: '講師D', A: '確認用 生徒A' })
    expect(facts).toEqual({ slot: '11/19(木) 3限', X: '講師D' })
    expect(completeChecklistPrepFacts(facts, [])).toEqual(facts)
  })
})

describe('buildChecklistPrepTemplateFailedMessage（テンプレ保存の段で失敗・Review Focus 3）', () => {
  it('準備: 先頭に「盤面には置きましたが、テンプレは保存していません: 理由」・続けて盤面に置いたもの（黙って消さない）・最後はテンプレを保存していないことと食い違わない一言（M-1）', () => {
    const message = buildChecklistPrepTemplateFailedMessage({ kind: 'prep', reason: CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON, boardMessage: BOARD_MESSAGE })
    expect(message.startsWith(`${CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX}${CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON}`)).toBe(true)
    for (const line of BOARD_LINES) expect(message).toContain(line)
    expect(message.split('\n').pop()).toBe(CHECKLIST_PREP_TEMPLATE_FAILED_REMINDER)
    // 「「保存」を押してから「やること」を行って」とは言わない（テンプレが無いので「やること」はできない）。
    expect(message).not.toContain(CHECKLIST_PREP_SAVE_REMINDER)
    expect(message).not.toContain(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER)
  })

  it('後片づけ: 盤面から消したなら「盤面からは消しましたが…」＋消した件数。盤面を変えていなければ「テンプレは保存していません: 理由」だけ', () => {
    const board = buildChecklistPrepCleanupMessage({ removed: { trials: 2, memos: 0, teachers: 1 }, templateRemoved: 0 })
    const withBoard = buildChecklistPrepTemplateFailedMessage({ kind: 'cleanup', reason: CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON, boardMessage: board })
    expect(withBoard).toBe(`${CHECKLIST_PREP_CLEANUP_TEMPLATE_FAILED_PREFIX}${CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON}\n${board}`)
    expect(buildChecklistPrepTemplateFailedMessage({ kind: 'cleanup', reason: 'x', boardMessage: '' })).toBe('テンプレは保存していません: x')
  })
})

describe('resolveChecklistPrepTemplatePhaseBlock（保存の段の見直し）', () => {
  it('テンプレ編集中になった・教室が切り替わったら理由を返す。同じ教室でテンプレ編集中でなければ null', () => {
    expect(resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: 'c1', classroomId: 'c1', isTemplateMode: true })).toBe(CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON)
    expect(resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: 'c1', classroomId: 'c2', isTemplateMode: false })).toBe(CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON)
    expect(resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: 'c1', classroomId: null, isTemplateMode: false })).toBe(CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON)
    expect(resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: 'c1', classroomId: 'c1', isTemplateMode: false })).toBeNull()
  })
})

describe('prepareChecklistPrepTemplateSave（保存するテンプレを作る）', () => {
  const base = deepFreeze(template([templateCell(4, 3, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]), templateDesk(2, 't2', [{ studentId: 's002', subject: '英' }, null]), templateDesk(3, 't3', [{ studentId: 's003', subject: '英' }, null])])]))
  const students = [row('s001', '生徒1'), prepRow('s901', 'A'), prepRow('s902', 'B')]

  it('反映開始日と保存時刻を差し替え、登録先の席に確認用の生徒を入れる（入力のテンプレは書き換えない）', () => {
    const result = prepareChecklistPrepTemplateSave({ registrations: [registration(2, '(1)'), registration(3, '(2)')], baseTemplate: base, effectiveStartDate: EFFECTIVE, students, savedAt: SAVED_AT })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.template.effectiveStartDate).toBe(EFFECTIVE)
    expect(result.template.savedAt).toBe(SAVED_AT)
    expect(result.template.cells[0].desks.map((desk) => desk.students[1]?.studentId ?? null)).toEqual([null, 's901', 's902'])
    expect(result.assigned.map((entry) => [entry.label, entry.studentName])).toEqual([['(1)', '確認用 生徒A'], ['(2)', '確認用 生徒B']])
    expect(base.cells[0].desks[1].students[1]).toBeNull()
  })

  it('確認用の生徒が名簿に足りない（App の足し忘れ）・テンプレが無いときは理由を返す', () => {
    const missing = prepareChecklistPrepTemplateSave({ registrations: [registration(2, '(1)'), registration(3, '(2)')], baseTemplate: base, effectiveStartDate: EFFECTIVE, students: [row('s001', '生徒1'), prepRow('s901', 'A')], savedAt: SAVED_AT })
    expect(missing).toEqual({ ok: false, reason: CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE })
    const noTemplate = prepareChecklistPrepTemplateSave({ registrations: [registration(2, '(1)')], baseTemplate: null, effectiveStartDate: EFFECTIVE, students, savedAt: SAVED_AT })
    expect(noTemplate.ok).toBe(false)
  })
})

describe('resolveChecklistPrepStep: 第 2 段の項目で確認用の生徒が名簿に足りない', () => {
  const request: ChecklistPrepRequest = { requestId: 1, itemId: 'tp-64', classroomId: 'v8OZ7zH8vONNHjjYVcR1' }
  const weeks: SlotCell[][] = [[{ id: CELL, dateKey: '2026-11-19', dayLabel: '木', dateLabel: '11/19', slotLabel: '3限', slotNumber: 3, timeLabel: '', isOpenDay: true, desks: [] }]]
  const step = (prepStudents: StudentRow[]) => resolveChecklistPrepStep({ request, isVerificationClassroom: true, isTemplateMode: false, currentWeekIndex: 0, jumpCount: 0, input: { weeks, todayKey: TODAY, effectiveStartDate: EFFECTIVE, teachers: [], template: template([]), prepStudents } })

  it('使える確認用の生徒が項目の数より少なければ、何も置かずに理由を返す（退塾した確認用は数えない）', () => {
    expect(CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT['tp-64']).toBe(2)
    expect(step([prepRow('s901', 'A'), prepRow('s902', 'B', { withdrawDate: '2026-11-01' })])).toEqual({ kind: 'finish', ok: false, message: CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE })
    // 足りていれば先へ進む（このテストの週には置ける机が無いので「見つかりません」）。
    const enough = step([prepRow('s901', 'A'), prepRow('s902', 'B')])
    expect(enough.kind).toBe('finish')
    if (enough.kind === 'finish') expect(enough.message).not.toBe(CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE)
  })
})

describe('resolveChecklistPrepCleanupBlock（後片づけを断る）', () => {
  it('検証用教室でない・テンプレ編集中は理由を返す。そうでなければ null', () => {
    expect(resolveChecklistPrepCleanupBlock({ isVerificationClassroom: false, isTemplateMode: false })).toBe(CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE)
    expect(resolveChecklistPrepCleanupBlock({ isVerificationClassroom: true, isTemplateMode: true })).toBe(CHECKLIST_PREP_CLEANUP_TEMPLATE_MODE_MESSAGE)
    expect(resolveChecklistPrepCleanupBlock({ isVerificationClassroom: true, isTemplateMode: false })).toBeNull()
  })
})

describe('planChecklistPrepCleanup（後片づけの計画）', () => {
  const trial = (id: string, name: string): StudentEntry => ({ id, name, grade: '中1', subject: '英', lessonType: 'trial', teacherType: 'normal', manualAdded: true })
  const regular = (id: string, managedStudentId: string): StudentEntry => ({ id, name: `生徒${managedStudentId}`, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })
  const slotCell = (desks: DeskCell[]): SlotCell => ({ id: CELL, dateKey: '2026-11-19', dayLabel: '木', dateLabel: '11/19', slotLabel: '3限', slotNumber: 3, timeLabel: '', isOpenDay: true, desks })
  const prepTeacherDesk = (id: string, extra: Partial<DeskCell> = {}): DeskCell => ({ id, teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true, ...extra })
  const students = [row('s001', '生徒1'), prepRow('s901', 'A'), prepRow('s902', 'B', { withdrawDate: '2026-11-09' }), row('s003', '確認 生徒C')]
  const toSaveTemplate = (value: RegularLessonTemplate) => ({ ...value, effectiveStartDate: EFFECTIVE, savedAt: SAVED_AT })

  it('盤面の確認用・準備の講師と、テンプレの確認用の生徒（退塾した確認用も）を消す計画。ほかの生徒の登録は残す（INV-02）', () => {
    const weeks = deepFreeze([[slotCell([
      prepTeacherDesk('d1', { lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), trial('t1', '確認用 体験1')] } }),
      { id: 'd2', teacher: '講師B', lesson: { id: 'managed_d2', studentSlots: [regular('r2', 's003'), trial('t2', '確認用 体験2')] } },
      { id: 'd3', teacher: '', memoSlots: ['確認用メモ1', null] },
    ])]])
    const saved = deepFreeze(template([templateCell(4, 3, [
      templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, { studentId: 's901', subject: '英' }]),
      templateDesk(2, 't2', [{ studentId: 's003', subject: '数' }, { studentId: 's902', subject: '英' }]),
    ])]))
    const plan = planChecklistPrepCleanup({ weeks, pendingDesks: null, savedTemplate: saved, students, toSaveTemplate })
    expect(plan.nothing).toBe(false)
    if (plan.nothing) return
    expect(plan.removed).toEqual({ trials: 2, memos: 1, teachers: 1 })
    expect(plan.boardChanged).toBe(true)
    expect(plan.templateRemoved).toBe(2)
    expect(plan.template?.effectiveStartDate).toBe(EFFECTIVE)
    expect(plan.template?.savedAt).toBe(SAVED_AT)
    expect(plan.template?.cells[0].desks.map((desk) => desk.students.map((student) => student?.studentId ?? null))).toEqual([['s001', null], ['s003', null]])
    expect(saved.cells[0].desks[0].students[1]?.studentId).toBe('s901')
  })

  it('盤面に何も無くテンプレだけ: boardChanged は false で weeks は同じ参照。テンプレに確認用が無ければ template は null', () => {
    const weeks = deepFreeze([[slotCell([{ id: 'd1', teacher: '講師A', lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), null] } }])]])
    const saved = deepFreeze(template([templateCell(4, 3, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, { studentId: 's901', subject: '英' }])])]))
    const templateOnly = planChecklistPrepCleanup({ weeks, pendingDesks: null, savedTemplate: saved, students, toSaveTemplate })
    expect(templateOnly.nothing).toBe(false)
    if (templateOnly.nothing) return
    expect(templateOnly.boardChanged).toBe(false)
    expect(templateOnly.weeks).toBe(weeks)
    expect(templateOnly.templateRemoved).toBe(1)

    const boardOnlyWeeks = deepFreeze([[slotCell([{ id: 'd1', teacher: '', memoSlots: ['確認用メモ1', null] }])]])
    const boardOnly = planChecklistPrepCleanup({ weeks: boardOnlyWeeks, pendingDesks: null, savedTemplate: template([]), students, toSaveTemplate })
    expect(boardOnly.nothing).toBe(false)
    if (boardOnly.nothing) return
    expect(boardOnly.template).toBeNull()
    expect(boardOnly.templateRemoved).toBe(0)
  })

  it('確認用が何も無ければ nothing（古い印だけが残る机があっても件数 0 なら何も変えない・Review Focus 5）', () => {
    const weeks = deepFreeze([[slotCell([{ id: 'd1', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', checklistPrepTeacher: true }])]])
    const pendingDesks: TemplatePendingDeskMap = deepFreeze({ [buildTemplatePendingDeskKey(CELL, 'd1')]: { lower: { memoSlots: ['連絡', null] }, effectiveStartDate: EFFECTIVE, createdAt: 'x' } })
    const saved = deepFreeze(template([templateCell(4, 3, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null])])]))
    expect(planChecklistPrepCleanup({ weeks, pendingDesks, savedTemplate: saved, students, toSaveTemplate })).toEqual({ nothing: true })
    expect(planChecklistPrepCleanup({ weeks, pendingDesks: null, savedTemplate: null, students, toSaveTemplate })).toEqual({ nothing: true })
  })
})

describe('buildChecklistPrepCleanupMessage（後片づけの結果の文）', () => {
  it('盤面から消した件数・テンプレから外した件数＋詳細・最後に保存の一言', () => {
    const summary = { ...createEmptyTemplateDiffApplySummary(), replaced: 2 }
    const message = buildChecklistPrepCleanupMessage({ removed: { trials: 2, memos: 1, teachers: 1 }, templateRemoved: 2, templateSaved: { effectiveStartDate: EFFECTIVE, summary, todayKey: TODAY } })
    const lines = message.split('\n')
    expect(lines[0]).toBe('盤面から消しました: 確認用の体験 2 人・確認用のメモ 1 件・準備で置いた講師 1 人。')
    expect(lines[1]).toBe('テンプレから確認用の生徒の登録 2 件を外して、テンプレを保存しました。')
    expect(lines[2]).toBe('詳細:')
    expect(message).toContain(buildTemplateDiffConfirmDetail(EFFECTIVE, summary, { todayKey: TODAY }))
    expect(lines[lines.length - 1]).toBe(CHECKLIST_PREP_CLEANUP_SAVE_REMINDER)
  })

  it('盤面だけ・テンプレだけでも、その行と一言だけ', () => {
    // 盤面だけのときの一言は「盤面は…」（テンプレは保存していないので「盤面とテンプレ」と言わない・M-1）。
    expect(buildChecklistPrepCleanupMessage({ removed: { trials: 0, memos: 1, teachers: 0 }, templateRemoved: 0 })).toBe(`盤面から消しました: 確認用の体験 0 人・確認用のメモ 1 件・準備で置いた講師 0 人。\n${CHECKLIST_PREP_CLEANUP_BOARD_SAVE_REMINDER}`)
    const templateOnly = buildChecklistPrepCleanupMessage({ removed: { trials: 0, memos: 0, teachers: 0 }, templateRemoved: 1, templateSaved: { effectiveStartDate: EFFECTIVE, summary: createEmptyTemplateDiffApplySummary(), todayKey: TODAY } })
    expect(templateOnly.startsWith('テンプレから確認用の生徒の登録 1 件を外して、テンプレを保存しました。\n詳細:')).toBe(true)
    expect(CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE).toBe('片づけるものはありません。')
  })
})

describe('resolveChecklistPrepTemplatePhaseTiming（テンプレ保存の段を走らせてよいか・修正ラウンド 1 I-1／2 Important）', () => {
  const preWeeks: SlotCell[][] = [[]]
  const postWeeks: SlotCell[][] = [[]]
  const prePending: TemplatePendingDeskMap = {}
  const postPending: TemplatePendingDeskMap = {}
  const phase: ChecklistPrepTemplatePhase = { kind: 'prep', requestId: 7, classroomId: 'c1', template: template([]), assigned: [], boardMessage: '', queuedFromWeeks: preWeeks, queuedFromPendingDesks: prePending, facts: { slot: '11/19(木) 3限' } }

  it('段が無ければ none、別のリクエストの段は stale（捨てる）', () => {
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase: null, requestId: 7, weeks: postWeeks, pendingDesks: postPending })).toBe('none')
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase, requestId: 8, weeks: postWeeks, pendingDesks: postPending })).toBe('stale')
  })

  it('盤面を当てたのと同じ weeks と保留マップ（StrictMode の 2 回目など・準備前のクロージャ）なら wait、weeks が変わった次のレンダーなら run', () => {
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase, requestId: 7, weeks: preWeeks, pendingDesks: prePending })).toBe('wait')
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase, requestId: 7, weeks: postWeeks, pendingDesks: postPending })).toBe('run')
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase, requestId: 7, weeks: postWeeks, pendingDesks: prePending })).toBe('run')
  })

  it('後片づけで保留の机の下の行だけを消した（weeks は同じ参照・保留マップだけ変わった）次のレンダーは run（待ち続けて保険タイマーまで止まらない）', () => {
    const cleanupPhase: ChecklistPrepTemplatePhase = { kind: 'cleanup', requestId: 9, classroomId: 'c1', template: template([]), removed: { trials: 1, memos: 0, teachers: 1 }, templateRemoved: 1, boardMessage: 'x', queuedFromWeeks: preWeeks, queuedFromPendingDesks: prePending }
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase: cleanupPhase, requestId: 9, weeks: preWeeks, pendingDesks: postPending })).toBe('run')
    // StrictMode の 2 回目（同じレンダー＝両方同じ参照）は wait のまま。
    expect(resolveChecklistPrepTemplatePhaseTiming({ phase: cleanupPhase, requestId: 9, weeks: preWeeks, pendingDesks: prePending })).toBe('wait')
  })
})

describe('resolveChecklistPrepCleanupEffectiveStartDate（後片づけのテンプレ保存の反映開始日・主セッションの判断）', () => {
  it('今日と保存済みの反映開始日の遅い方（今日より前の週に確認用の生徒を残さない・保存済みの先日付の版を前倒ししない）', () => {
    expect(resolveChecklistPrepCleanupEffectiveStartDate(TODAY, '2026-11-02')).toBe(TODAY)
    expect(resolveChecklistPrepCleanupEffectiveStartDate(TODAY, '2026-11-23')).toBe('2026-11-23')
    expect(resolveChecklistPrepCleanupEffectiveStartDate(TODAY, null)).toBe(TODAY)
    expect(resolveChecklistPrepCleanupEffectiveStartDate(TODAY, '')).toBe(TODAY)
  })
})

describe('resolveChecklistPrepAbortMessage（盤面を置いた後の App のタイムアウト・取りやめ・修正ラウンド 1 I-2）', () => {
  it('盤面をまだ置いていなければ元の文。置いた後は「盤面には置きましたが、テンプレは保存していません」の文（後片づけは「盤面からは消しましたが」）', () => {
    expect(resolveChecklistPrepAbortMessage('timeout', '元の文', null)).toBe('元の文')
    const timeout = resolveChecklistPrepAbortMessage('timeout', '元の文', { kind: 'prep' })
    expect(timeout.startsWith('盤面には置きましたが、テンプレは保存していません')).toBe(true)
    expect(timeout).toContain('保存前なら盤面を確かめてください')
    expect(resolveChecklistPrepAbortMessage('cancelled', '元の文', { kind: 'prep' })).toContain('教室が切り替わった')
    expect(resolveChecklistPrepAbortMessage('superseded', '元の文', { kind: 'prep' })).toContain('新しい準備')
    expect(resolveChecklistPrepAbortMessage('timeout', '元の文', { kind: 'cleanup' }).startsWith('盤面からは消しましたが、テンプレは保存していません')).toBe(true)
  })

  it('盤面を置いた後に延ばす保険タイマーは 30 秒', () => {
    expect(CHECKLIST_PREP_TEMPLATE_PHASE_TIMEOUT_MS).toBe(30000)
  })
})

describe('annotateChecklistPrepResultWithAddedStudents（名簿へ足したことを結果の文に書く・M-2）', () => {
  const added = [prepRow('s901', 'A'), prepRow('s902', 'B')]
  it('足したら先頭に 1 行。断った文の「何も変えていません」は「盤面とテンプレは変えていません」にする（名簿は変えた）', () => {
    const refused = annotateChecklistPrepResultWithAddedStudents({ ok: false, message: `席が見つかりませんでした。何も変えていません。` }, added)
    expect(refused.ok).toBe(false)
    expect(refused.message.split('\n')[0]).toBe('名簿に確認用の生徒（確認用 生徒A・確認用 生徒B）を足しました（次の準備でも使うので残します）。')
    expect(refused.message).not.toContain('何も変えていません')
    expect(refused.message).toContain('盤面とテンプレは変えていません。')
    // 第119版（2026-11-07）: 成功の文は短く（2 行のまま）。足したことは 1 行目の後ろに人数だけ書く。facts はそのまま運ぶ。
    const done = annotateChecklistPrepResultWithAddedStudents({ ok: true, message: `準備しました（11/19(木) 3限）。\n${CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER}`, facts: { slot: '11/19(木) 3限' } }, added)
    expect(done).toEqual({ ok: true, message: `準備しました（11/19(木) 3限）。名簿に確認用の生徒を 2 人足しました。\n${CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER}`, facts: { slot: '11/19(木) 3限' } })
    const refusedWithFacts = annotateChecklistPrepResultWithAddedStudents({ ok: false, message: '何も変えていません。', facts: { slot: 'x' } }, added)
    expect(refusedWithFacts.facts).toEqual({ slot: 'x' })
  })
  it('足していなければそのまま', () => {
    const result = { ok: false, message: '何も変えていません。' }
    expect(annotateChecklistPrepResultWithAddedStudents(result, [])).toBe(result)
  })
})

describe('resolveTemplateDiffBaseline（テンプレ差分反映の基準を 1 か所に・M-4・挙動不変）', () => {
  it('保存済みテンプレを編集画面と同じ在籍の絞り込みに通したもの。テンプレが無ければ null', () => {
    const saved = template([templateCell(4, 3, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, { studentId: 's009', subject: '英' }])])])
    const students = [row('s001', '生徒1'), row('s009', '生徒9', { withdrawDate: '2026-10-31' })]
    const params = { deskCount: 3, teachers: [], students, todayKey: TODAY }
    expect(resolveTemplateDiffBaseline({ template: saved, ...params })).toEqual(filterTemplateParticipantsForReferenceDate({ template: saved, deskCount: 3, teachers: [], students, referenceDate: TODAY }))
    expect(resolveTemplateDiffBaseline({ template: null, ...params })).toBeNull()
  })
})

describe('テンプレ単位の INV-12 の重複ガード（M-3: 手で保存するときと同じ findTemplateDuplicateStudents をテンプレの盤面の形に当てる）', () => {
  it('同じ曜日・時限に同じ生徒が 2 か所あるテンプレを見つける', () => {
    const students = [row('s001', '生徒1'), prepRow('s901', 'A')]
    const duplicated = template([templateCell(4, 3, [templateDesk(1, '', [{ studentId: 's001', subject: '数' }, null]), templateDesk(2, '', [{ studentId: 's901', subject: '英' }, { studentId: 's001', subject: '数' }])])])
    const cells = buildTemplateBoardCells({ template: duplicated, teachers: [], students, deskCount: 3 })
    const duplicates = findTemplateDuplicateStudents(cells, (student) => student.managedStudentId ?? student.name)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].deskNumbers).toEqual([1, 2])
  })
})
