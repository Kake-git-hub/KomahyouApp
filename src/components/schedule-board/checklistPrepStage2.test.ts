// 確認リストの「準備する」第 2 段（docs/plan-2026-11-06-checklist-auto-prep-stage2.md Task 3・spec-developer-report §E-2-4-2）の
// コマ表の 2 段処理（盤面の準備 → テンプレ保存）と後片づけを組む純関数のテスト。
// - 結果の文: 盤面の行 → テンプレへ登録した席 → 「詳細:」（確認画面と同じ buildTemplateDiffConfirmDetail）→ 保存の一言（1 つだけ）。
// - テンプレ保存の段で失敗（テンプレ編集中になった・教室が切り替わった）→ 盤面は置いたままで「テンプレは保存していません」と出す（Review Focus 3）。
// - 後片づけ: 何も無ければ件数で「片づけるものはありません」（Review Focus 5）・テンプレから消すのは確認用の生徒だけ（退塾した確認用も・INV-02）。
import { describe, expect, it } from 'vitest'

import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonTemplate, RegularLessonTemplateCell, RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { CHECKLIST_PREP_SAVE_REMINDER, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT, resolveChecklistPrepStep, type ChecklistPrepRequest } from './checklistPrep'
import {
  CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE,
  CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE,
  CHECKLIST_PREP_CLEANUP_SAVE_REMINDER,
  CHECKLIST_PREP_CLEANUP_TEMPLATE_FAILED_PREFIX,
  CHECKLIST_PREP_CLEANUP_TEMPLATE_MODE_MESSAGE,
  CHECKLIST_PREP_STUDENT_BIRTH_DATE,
  CHECKLIST_PREP_STUDENT_NAME_PREFIX,
  CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE,
  CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX,
  CHECKLIST_PREP_TEMPLATE_PHASE_CLASSROOM_REASON,
  CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON,
  CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER,
  buildChecklistPrepCleanupMessage,
  buildChecklistPrepTemplateFailedMessage,
  buildChecklistPrepTemplateSavedMessage,
  planChecklistPrepCleanup,
  prepareChecklistPrepTemplateSave,
  resolveChecklistPrepCleanupBlock,
  resolveChecklistPrepTemplatePhaseBlock,
  type ChecklistPrepTemplateAssignment,
  type ChecklistPrepTemplateRegistration,
} from './checklistPrepTemplate'
import { buildTemplateDiffConfirmDetail, createEmptyTemplateDiffApplySummary, type TemplateDiffStudentNote } from './templateDiffApply'
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

describe('buildChecklistPrepTemplateSavedMessage（準備 → テンプレ保存の結果の文）', () => {
  const summary = { ...createEmptyTemplateDiffApplySummary(), replaced: 1, pending: 1 }
  const studentNotes: TemplateDiffStudentNote[] = [{ kind: 'teacher-pending', studentName: '講師D', subject: '', dateKey: '2026-11-19', slotNumber: 3 }]

  it('盤面の行 → テンプレへ登録した席と確認用の生徒 → 「詳細:」＋確認画面と同じ詳細 → 最後に保存の一言（盤面だけの一言は外す）', () => {
    const message = buildChecklistPrepTemplateSavedMessage({ boardMessage: BOARD_MESSAGE, assigned: ASSIGNED, effectiveStartDate: EFFECTIVE, summary, studentNotes, todayKey: TODAY })
    const detail = buildTemplateDiffConfirmDetail(EFFECTIVE, summary, { todayKey: TODAY, studentNotes })
    const lines = message.split('\n')
    expect(lines.slice(0, 3)).toEqual(BOARD_LINES)
    expect(lines[3]).toBe('テンプレの (1) 木曜 3限 机 2 の生徒 2 に「確認用 生徒A」、(2) 木曜 3限 机 3 の生徒 2 に「確認用 生徒B」を登録して、テンプレを保存しました。')
    expect(lines[4]).toBe('詳細:')
    expect(message).toContain(`詳細:\n${detail}\n`)
    // 生徒ごとの理由（buildTemplateDiffStudentNoteLines）も詳細の中に載る。
    expect(message).toContain('テンプレの生徒・講師の扱いの理由:')
    expect(lines[lines.length - 1]).toBe(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER)
    // 一言は 1 つだけ（盤面だけの一言は残さない）。
    expect(message).not.toContain(CHECKLIST_PREP_SAVE_REMINDER)
    expect(message.split(CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER)).toHaveLength(2)
  })

  it('範囲の説明（scopeNote）も確認画面と同じく詳細に載る', () => {
    const scopeNote = { scope: 'changed-slots' as const, slotLabels: ['木 3限'], extraSlotLabels: [] }
    const message = buildChecklistPrepTemplateSavedMessage({ boardMessage: BOARD_MESSAGE, assigned: ASSIGNED, effectiveStartDate: EFFECTIVE, summary, scopeNote, todayKey: TODAY })
    expect(message).toContain(buildTemplateDiffConfirmDetail(EFFECTIVE, summary, { todayKey: TODAY, scopeNote }))
    expect(message).toContain('テンプレで変えたコマ（木 3限）だけを突き合わせます。')
  })

  it('盤面の文に一言が無くてもそのまま使う（二重に外さない）', () => {
    const message = buildChecklistPrepTemplateSavedMessage({ boardMessage: BOARD_LINES.join('\n'), assigned: ASSIGNED, effectiveStartDate: EFFECTIVE, summary, todayKey: TODAY })
    expect(message.split('\n').slice(0, 3)).toEqual(BOARD_LINES)
  })
})

describe('buildChecklistPrepTemplateFailedMessage（テンプレ保存の段で失敗・Review Focus 3）', () => {
  it('準備: 先頭に「盤面には置きましたが、テンプレは保存していません: 理由」・続けて盤面に置いたもの（黙って消さない）・盤面の保存の一言', () => {
    const message = buildChecklistPrepTemplateFailedMessage({ kind: 'prep', reason: CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON, boardMessage: BOARD_MESSAGE })
    expect(message.startsWith(`${CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX}${CHECKLIST_PREP_TEMPLATE_PHASE_MODE_REASON}`)).toBe(true)
    for (const line of BOARD_LINES) expect(message).toContain(line)
    expect(message.endsWith(CHECKLIST_PREP_SAVE_REMINDER)).toBe(true)
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
    expect(buildChecklistPrepCleanupMessage({ removed: { trials: 0, memos: 1, teachers: 0 }, templateRemoved: 0 })).toBe(`盤面から消しました: 確認用の体験 0 人・確認用のメモ 1 件・準備で置いた講師 0 人。\n${CHECKLIST_PREP_CLEANUP_SAVE_REMINDER}`)
    const templateOnly = buildChecklistPrepCleanupMessage({ removed: { trials: 0, memos: 0, teachers: 0 }, templateRemoved: 1, templateSaved: { effectiveStartDate: EFFECTIVE, summary: createEmptyTemplateDiffApplySummary(), todayKey: TODAY } })
    expect(templateOnly.startsWith('テンプレから確認用の生徒の登録 1 件を外して、テンプレを保存しました。\n詳細:')).toBe(true)
    expect(CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE).toBe('片づけるものはありません。')
  })
})
