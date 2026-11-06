// 確認リストの「準備する」第 2 段（docs/plan-2026-11-06-checklist-auto-prep-stage2.md・spec-developer-report §E-2-4-2）の純関数テスト。
// 確認用の生徒（名簿へ足す・使い回す）・テンプレへの登録（席の空き・同じ曜日×時限に同じ生徒を 2 か所置かない＝INV-12）・
// テンプレの確認用の登録だけを消す（INV-02）を固定する。
import { describe, expect, it } from 'vitest'

import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonTemplate, RegularLessonTemplateCell, RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import {
  CHECKLIST_PREP_STUDENT_BIRTH_DATE,
  CHECKLIST_PREP_STUDENT_NAME_PREFIX,
  assignChecklistPrepTemplateStudents,
  cleanupChecklistPrepBoard,
  ensureChecklistPrepStudents,
  isChecklistPrepStudent,
  removeChecklistPrepTemplateStudents,
  resolveChecklistPrepStudentCount,
  resolveChecklistPrepTemplateDeskIndex,
  type ChecklistPrepTemplateRegistration,
} from './checklistPrepTemplate'

const TODAY = '2026-11-10'

function row(id: string, name: string, overrides: Partial<StudentRow> = {}): StudentRow {
  return { id, name, displayName: '', email: '', entryDate: '2025-04-01', withdrawDate: '', birthDate: '2012-05-01', ...overrides }
}

function prepRow(id: string, letter: string, overrides: Partial<StudentRow> = {}): StudentRow {
  const name = `${CHECKLIST_PREP_STUDENT_NAME_PREFIX}${letter}`
  return row(id, name, { displayName: name, entryDate: '2026-11-01', birthDate: CHECKLIST_PREP_STUDENT_BIRTH_DATE(TODAY), ...overrides })
}

function idFactory() {
  let serial = 0
  return (taken: ReadonlySet<string>) => {
    let id = ''
    do {
      serial += 1
      id = `s9${String(serial).padStart(2, '0')}`
    } while (taken.has(id))
    return id
  }
}

function templateDesk(deskIndex: number, teacherId: string, students: RegularLessonTemplateDesk['students'] = [null, null]): RegularLessonTemplateDesk {
  return { deskIndex, teacherId, students }
}

function templateCell(dayOfWeek: number, slotNumber: number, desks: RegularLessonTemplateDesk[]): RegularLessonTemplateCell {
  return { dayOfWeek, slotNumber, desks }
}

function template(cells: RegularLessonTemplateCell[]): RegularLessonTemplate {
  return { version: 1, effectiveStartDate: '2026-11-11', savedAt: '2026-11-01T00:00:00.000Z', cells }
}

function registration(deskIndex: number, studentIndex: 0 | 1, label: string, overrides: Partial<ChecklistPrepTemplateRegistration> = {}): ChecklistPrepTemplateRegistration {
  return { dayOfWeek: 4, slotNumber: 1, deskIndex, templateDeskIndex: deskIndex + 1, studentIndex, subject: '英', label, ...overrides }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

describe('CHECKLIST_PREP_STUDENT_BIRTH_DATE（準備した年度に小 4 になる 4/2 生まれ）', () => {
  it('年度は 4/1 始まり: 11 月なら同じ年の年度・3 月なら前の年の年度', () => {
    expect(CHECKLIST_PREP_STUDENT_BIRTH_DATE('2026-11-06')).toBe('2016-04-02')
    expect(CHECKLIST_PREP_STUDENT_BIRTH_DATE('2026-04-01')).toBe('2016-04-02')
    expect(CHECKLIST_PREP_STUDENT_BIRTH_DATE('2027-03-31')).toBe('2016-04-02')
    expect(CHECKLIST_PREP_STUDENT_BIRTH_DATE('2026-03-31')).toBe('2015-04-02')
  })

  it('既存の学年の計算でその年度のあいだ小 4（年度の初日から最終日まで）', () => {
    for (const todayKey of ['2026-04-01', '2026-11-06', '2027-03-31', '2026-03-31']) {
      expect(resolveGradeLabelFromBirthDate(CHECKLIST_PREP_STUDENT_BIRTH_DATE(todayKey), todayKey)).toBe('小4')
    }
  })
})

describe('isChecklistPrepStudent', () => {
  it('名前が「確認用 生徒」で始まる生徒だけ（体験の「確認用 体験」・ほかの生徒は違う）', () => {
    expect(isChecklistPrepStudent({ name: '確認用 生徒A' })).toBe(true)
    expect(isChecklistPrepStudent({ name: '確認用 体験1' })).toBe(false)
    expect(isChecklistPrepStudent({ name: '生徒A' })).toBe(false)
  })
})

describe('ensureChecklistPrepStudents（確認用の生徒を名簿に足す・使い回す）', () => {
  it('空の名簿で 2 人 →「確認用 生徒A」「確認用 生徒B」を足す（入塾日＝今日・退塾日なし・小学生の固定の生年月日）', () => {
    const result = ensureChecklistPrepStudents([], 2, { todayKey: TODAY, createId: idFactory() })
    expect(result.added.map((student) => student.name)).toEqual(['確認用 生徒A', '確認用 生徒B'])
    expect(result.students).toEqual(result.added)
    for (const student of result.added) {
      expect(student).toMatchObject({ entryDate: TODAY, withdrawDate: '', birthDate: CHECKLIST_PREP_STUDENT_BIRTH_DATE(TODAY), email: '' })
      // 表示名は名前と同じ（空にすると「確認用」だけの表示名になる＝deriveManagedDisplayName）。
      expect(student.displayName).toBe(student.name)
    }
    expect(new Set(result.added.map((student) => student.id)).size).toBe(2)
  })

  it('A が居れば B だけ足す。ほかの生徒の行はそのまま（同じ参照）で後ろに足す', () => {
    const other = row('s001', '生徒X')
    const a = prepRow('s050', 'A')
    const students = [other, a]
    const result = ensureChecklistPrepStudents(students, 2, { todayKey: TODAY, createId: idFactory() })
    expect(result.added.map((student) => student.name)).toEqual(['確認用 生徒B'])
    expect(result.students[0]).toBe(other)
    expect(result.students[1]).toBe(a)
    expect(result.students).toHaveLength(3)
    // 入力の配列は書き換えない。
    expect(students).toHaveLength(2)
  })

  it('足りていれば added は空で、入力と同じ配列を返す', () => {
    const students = [prepRow('s050', 'A'), prepRow('s051', 'B')]
    const result = ensureChecklistPrepStudents(students, 2, { todayKey: TODAY, createId: idFactory() })
    expect(result.added).toEqual([])
    expect(result.students).toBe(students)
  })

  it('退塾済み・削除済みの確認用の生徒は数えず、名前の重複を避けて空いている文字で足す', () => {
    const withdrawnA = [prepRow('s050', 'A', { withdrawDate: '2026-11-01' }), prepRow('s051', 'B')]
    expect(ensureChecklistPrepStudents(withdrawnA, 2, { todayKey: TODAY, createId: idFactory() }).added.map((student) => student.name)).toEqual(['確認用 生徒C'])
    const students = [prepRow('s050', 'A', { withdrawDate: '2026-11-01' }), prepRow('s051', 'B'), prepRow('s052', 'C', { deletedAt: '2026-11-02T00:00:00.000Z', withdrawDate: '2026-10-01' })]
    const result = ensureChecklistPrepStudents(students, 2, { todayKey: TODAY, createId: idFactory() })
    expect(result.added.map((student) => student.name)).toEqual(['確認用 生徒D'])
  })

  it('id は名簿（足した分を含む）に無いものを createId で作る', () => {
    const students = [row('s901', '生徒X')]
    const takenSeen: string[][] = []
    const createId = (taken: ReadonlySet<string>) => {
      takenSeen.push([...taken])
      return idFactory()(taken)
    }
    const result = ensureChecklistPrepStudents(students, 2, { todayKey: TODAY, createId })
    expect(result.added.map((student) => student.id).every((id) => id !== 's901')).toBe(true)
    expect(takenSeen[0]).toContain('s901')
    expect(takenSeen[1]).toContain(result.added[0].id)
  })
})

describe('assignChecklistPrepTemplateStudents（テンプレの席に確認用の生徒を登録する）', () => {
  const prepStudents = [prepRow('s050', 'A'), prepRow('s051', 'B'), prepRow('s052', 'C')]

  it('空いている席に A・B が入る（机番号は盤面の 0 始まり → テンプレは 1 始まり）。入力の template は書き換えない', () => {
    const base = deepFreeze(template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
        templateDesk(2, 't2', [{ studentId: 's002', subject: '数' }, null]),
      ]),
    ]))
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)'), registration(1, 1, '(2)')], prepStudents)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const cell = result.template.cells.find((entry) => entry.dayOfWeek === 4 && entry.slotNumber === 1)!
    expect(cell.desks[0].students).toEqual([{ studentId: 's001', subject: '数' }, { studentId: 's050', subject: '英' }])
    expect(cell.desks[1].students).toEqual([{ studentId: 's002', subject: '数' }, { studentId: 's051', subject: '英' }])
    expect(cell.desks.map((desk) => desk.teacherId)).toEqual(['t1', 't2'])
    expect(result.assigned).toEqual([
      { ...registration(0, 1, '(1)'), studentId: 's050', studentName: '確認用 生徒A' },
      { ...registration(1, 1, '(2)'), studentId: 's051', studentName: '確認用 生徒B' },
    ])
  })

  it('同じ曜日・時限に A が既に居れば B・C を使う（同じコマに同じ生徒を 2 か所置かない・INV-12）', () => {
    const base = template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
        templateDesk(2, 't2', [{ studentId: 's002', subject: '数' }, null]),
        templateDesk(3, 't3', [{ studentId: 's050', subject: '英' }, null]),
      ]),
    ])
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)'), registration(1, 1, '(2)')], prepStudents)
    expect(result.ok && result.assigned.map((entry) => entry.studentName)).toEqual(['確認用 生徒B', '確認用 生徒C'])
  })

  it('別の曜日・時限に居る確認用の生徒は使ってよい（使い回す）', () => {
    const base = template([
      templateCell(2, 3, [templateDesk(1, 't1', [{ studentId: 's050', subject: '英' }, { studentId: 's051', subject: '英' }])]),
      templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]), templateDesk(2, 't2', [{ studentId: 's002', subject: '数' }, null])]),
    ])
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)'), registration(1, 1, '(2)')], prepStudents)
    expect(result.ok && result.assigned.map((entry) => entry.studentName)).toEqual(['確認用 生徒A', '確認用 生徒B'])
  })

  it('確認用の生徒が足りなければ失敗（理由に「確認用の生徒が足りません」）。退塾した確認用の生徒は使わない', () => {
    const base = template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
        templateDesk(2, 't2', [{ studentId: 's002', subject: '数' }, null]),
        templateDesk(3, 't3', [{ studentId: 's050', subject: '英' }, null]),
      ]),
    ])
    const students = [prepRow('s050', 'A'), prepRow('s051', 'B'), prepRow('s052', 'C', { withdrawDate: '2026-11-05' }), row('s001', '生徒X')]
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)'), registration(1, 1, '(2)')], students)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('確認用の生徒が足りません')
  })

  it('席が埋まっていれば失敗（理由に曜日・時限・机）。何も登録しない', () => {
    const base = template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
        templateDesk(2, 't2', [{ studentId: 's002', subject: '数' }, { studentId: 's003', subject: '国' }]),
      ]),
    ])
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)'), registration(1, 1, '(2)')], prepStudents)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('木曜 1限 机 2 の生徒 2')
  })

  it('登録先はテンプレの机番号（templateDeskIndex）。盤面の机番号（deskIndex）では引かない', () => {
    const base = template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
        templateDesk(2, '', [null, null]),
        templateDesk(3, 't2', [{ studentId: 's002', subject: '数' }, null]),
      ]),
    ])
    const result = assignChecklistPrepTemplateStudents(base, [registration(1, 1, '(2)', { templateDeskIndex: 3 })], prepStudents)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.template.cells[0].desks.map((desk) => desk.students)).toEqual([
      [{ studentId: 's001', subject: '数' }, null],
      [null, null],
      [{ studentId: 's002', subject: '数' }, { studentId: 's050', subject: '英' }],
    ])
    // 埋まっていたときの理由もテンプレの机番号で書く。
    const taken = assignChecklistPrepTemplateStudents(base, [registration(1, 0, '(2)', { templateDeskIndex: 3 })], prepStudents)
    expect(!taken.ok && taken.reason).toContain('木曜 1限 机 3 の生徒 1')
  })

  it('テンプレにその曜日・時限・机が無ければ作る（講師なし）', () => {
    const base = template([templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null])])])
    const result = assignChecklistPrepTemplateStudents(base, [registration(2, 0, '(1)', { dayOfWeek: 5, slotNumber: 2 })], prepStudents)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const cell = result.template.cells.find((entry) => entry.dayOfWeek === 5 && entry.slotNumber === 2)
    expect(cell?.desks).toEqual([{ deskIndex: 3, teacherId: '', students: [{ studentId: 's050', subject: '英' }, null] }])
    // 元の曜日・時限はそのまま。
    expect(result.template.cells.find((entry) => entry.dayOfWeek === 4)).toEqual(base.cells[0])
  })

  it('科目は学年で使えるものに直す（確認用の生徒は小学生＝数は算）', () => {
    const base = template([templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null])])])
    const result = assignChecklistPrepTemplateStudents(base, [registration(0, 1, '(1)', { subject: '数' })], prepStudents)
    expect(result.ok && result.template.cells[0].desks[0].students[1]).toEqual({ studentId: 's050', subject: '算' })
  })
})

describe('resolveChecklistPrepTemplateDeskIndex（盤面の机 → テンプレの机番号）', () => {
  const base = template([
    templateCell(4, 5, [
      templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
      templateDesk(2, '', [null, null]),
      templateDesk(3, 't2', [{ studentId: 's002', subject: '数' }, null]),
    ]),
  ])
  const student = (managedStudentId: string): StudentEntry => ({ id: `e_${managedStudentId}`, name: `生徒${managedStudentId}`, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })
  const desk = (lessonId: string, managedStudentId: string): DeskCell => ({ id: 'd', teacher: '講師B', lesson: { id: lessonId, note: '管理データ反映', studentSlots: [student(managedStudentId), null] } })

  it('まず授業 id（managed_template_<年度>_<曜>_<限>_<机>_<日付>）で引く', () => {
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_template_2026_4_5_3_2026-11-12', 's002'), base, 4, 5)).toBe(3)
    // 授業 id がほかの曜日・時限なら使わず、生徒で引く。
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_template_2026_2_5_1_2026-11-10', 's002'), base, 4, 5)).toBe(3)
  })

  it('授業 id で引けなければ、その机のテンプレの生徒を持つテンプレの机で引く', () => {
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_r9_2026-11-12', 's002'), base, 4, 5)).toBe(3)
    expect(resolveChecklistPrepTemplateDeskIndex(desk('d_template_kept', 's001'), base, 4, 5)).toBe(1)
    // 授業 id が指すテンプレの机が無い（行を消した）ときも生徒で引く。
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_template_2026_4_5_9_2026-11-12', 's001'), base, 4, 5)).toBe(1)
  })

  it('どちらでも引けなければ null（テンプレに居ない生徒・授業の無い机・テンプレ無し）', () => {
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_r9_2026-11-12', 's777'), base, 4, 5)).toBeNull()
    expect(resolveChecklistPrepTemplateDeskIndex({ lesson: undefined }, base, 4, 5)).toBeNull()
    expect(resolveChecklistPrepTemplateDeskIndex(desk('managed_r9_2026-11-12', 's001'), null, 4, 5)).toBeNull()
  })
})

describe('resolveChecklistPrepStudentCount（名簿に居てほしい確認用の生徒の数）', () => {
  it('テンプレに確認用の生徒が居なければ必要な数そのまま。1 つの曜日・時限に居る確認用の生徒の最大数だけ足す', () => {
    const students = [prepRow('s050', 'A'), prepRow('s051', 'B'), row('s001', '生徒X')]
    expect(resolveChecklistPrepStudentCount(null, students, 2)).toBe(2)
    expect(resolveChecklistPrepStudentCount(template([templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null])])]), students, 2)).toBe(2)
    const registered = template([
      templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, { studentId: 's050', subject: '英' }]), templateDesk(2, 't2', [null, { studentId: 's051', subject: '英' }])]),
      templateCell(2, 1, [templateDesk(1, 't1', [{ studentId: 's050', subject: '英' }, null])]),
    ])
    expect(resolveChecklistPrepStudentCount(registered, students, 2)).toBe(4)
  })
})

describe('removeChecklistPrepTemplateStudents（テンプレの確認用の生徒の登録だけ消す）', () => {
  it('確認用の生徒の席だけ空にする。ほかの生徒・講師はそのまま。removed は件数', () => {
    const base = deepFreeze(template([
      templateCell(4, 1, [
        templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, { studentId: 's050', subject: '英' }]),
        templateDesk(2, 't2', [{ studentId: 's051', subject: '英' }, { studentId: 's002', subject: '国' }]),
      ]),
      templateCell(2, 3, [templateDesk(1, 't3', [{ studentId: 's003', subject: '数' }, null])]),
    ]))
    const result = removeChecklistPrepTemplateStudents(base, new Set(['s050', 's051']))
    expect(result.removed).toBe(2)
    expect(result.template.cells[0].desks).toEqual([
      templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null]),
      templateDesk(2, 't2', [null, { studentId: 's002', subject: '国' }]),
    ])
    expect(result.template.cells[1]).toBe(base.cells[1])
  })

  it('確認用の登録が無ければ removed 0 で同じ template を返す', () => {
    const base = template([templateCell(4, 1, [templateDesk(1, 't1', [{ studentId: 's001', subject: '数' }, null])])])
    const result = removeChecklistPrepTemplateStudents(base, new Set(['s050']))
    expect(result).toEqual({ template: base, removed: 0 })
    expect(result.template).toBe(base)
  })
})

describe('cleanupChecklistPrepBoard（後片づけ: 盤面の確認用だけを消す・INV-02）', () => {
  const CELL = '2026-11-12_1'
  const trial = (id: string, name: string, overrides: Partial<StudentEntry> = {}): StudentEntry => ({ id, name, grade: '中1', subject: '英', lessonType: 'trial', teacherType: 'normal', manualAdded: true, ...overrides })
  const regular = (id: string, managedStudentId: string): StudentEntry => ({ id, name: `生徒${managedStudentId}`, managedStudentId, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })
  const slotCell = (desks: DeskCell[], id = CELL): SlotCell => ({ id, dateKey: id.slice(0, 10), dayLabel: '木', dateLabel: '11/12', slotLabel: '1限', slotNumber: 1, timeLabel: '', isOpenDay: true, desks })
  const prepTeacher = (id: string, extra: Partial<DeskCell> = {}): DeskCell => ({ id, teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true, ...extra })

  it('上の行の「確認用 体験」（手で足した体験だけ）と「確認用メモ」を消し、ほかの生徒・メモは残す', () => {
    const weeks = deepFreeze([[slotCell([
      { id: 'd1', teacher: '講師A', lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), trial('t1', '確認用 体験1')] } },
      { id: 'd2', teacher: '', lesson: { id: `${CELL}_desk_2_manual`, studentSlots: [trial('t2', '確認用 体験2'), trial('t3', '確認用 体験3')] } },
      { id: 'd3', teacher: '', memoSlots: ['確認用メモ1', '連絡'] },
      // 名前が「確認用」で始まらない体験・手で足していない「確認用 体験」は残す。
      { id: 'd4', teacher: '', lesson: { id: 'x4', studentSlots: [trial('t4', '体験X'), trial('t5', '確認用 体験9', { manualAdded: false })] } },
      { id: 'd5', teacher: '', memoSlots: ['確認用メモ2', null] },
    ])]])
    const result = cleanupChecklistPrepBoard(weeks, null)
    expect(result.removed).toEqual({ trials: 3, memos: 2, teachers: 0 })
    const desks = result.weeks[0][0].desks
    expect(desks[0].lesson?.studentSlots).toEqual([regular('r1', 's001'), null])
    // 体験だけの机は授業ごと無くなる。
    expect(desks[1].lesson).toBeUndefined()
    expect(desks[2].memoSlots).toEqual([null, '連絡'])
    expect(desks[3]).toBe(weeks[0][0].desks[3])
    expect(desks[4].memoSlots).toBeUndefined()
    expect(result.pendingDesks).toBeNull()
  })

  it('準備の印の付いた机の講師を外す（teacher 空・手置きの項目と印も外す）。印の無い手置き講師は残す', () => {
    const weeks = deepFreeze([[slotCell([
      prepTeacher('d1', { lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), null] } }),
      { id: 'd2', teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't5' },
    ])]])
    const result = cleanupChecklistPrepBoard(weeks, null)
    expect(result.removed).toEqual({ trials: 0, memos: 0, teachers: 1 })
    const [first, second] = result.weeks[0][0].desks
    expect(first).toEqual({ id: 'd1', teacher: '', manualTeacher: false, lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), null] } })
    expect(second).toBe(weeks[0][0].desks[1])
  })

  it('印が残っていても手置きの講師でなくなった机（削除の記録・QR の講師・講師なし）は講師を外さず、古い印だけ外す', () => {
    const weeks = deepFreeze([[slotCell([
      { id: 'd1', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: '講師D', checklistPrepTeacher: true },
      { id: 'd2', teacher: '講師F', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't6', checklistPrepTeacher: true },
    ])]])
    const result = cleanupChecklistPrepBoard(weeks, null)
    expect(result.removed).toEqual({ trials: 0, memos: 0, teachers: 0 })
    const [first, second] = result.weeks[0][0].desks
    expect(first).toEqual({ id: 'd1', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: '講師D' })
    expect(second).toEqual({ id: 'd2', teacher: '講師F', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't6' })
  })

  it('保留の下の行: 「確認用 体験」・「確認用メモ」・印の付いた講師を消し、空になった保留は消す（講師のぶつかりが解けてテンプレの講師の 1 行）', () => {
    const upper: DeskCell = { id: 'd1', teacher: '講師A', lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), regular('r2', 's950')] } }
    const keepUpper: DeskCell = { id: 'd2', teacher: '講師B', lesson: { id: 'managed_d2', studentSlots: [regular('r3', 's002'), null] } }
    const pendingDesks: TemplatePendingDeskMap = deepFreeze({
      [buildTemplatePendingDeskKey(CELL, 'd1')]: {
        lower: {
          lesson: { id: 'pending_lower_1', studentSlots: [null, trial('t1', '確認用 体験1')] },
          teacher: { teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true },
        },
        effectiveStartDate: '2026-11-11',
        createdAt: '2026-11-10T00:00:00.000Z',
      },
      // 下の行にほかの手入力が残る保留は残す（確認用のものだけ消す）。
      [buildTemplatePendingDeskKey(CELL, 'd2')]: {
        lower: {
          lesson: { id: 'pending_lower_2', studentSlots: [trial('t2', '体験X'), trial('t3', '確認用 体験2')] },
          memoSlots: ['確認用メモ1', null],
          teacher: { teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual' },
        },
        effectiveStartDate: '2026-11-11',
        createdAt: '2026-11-10T00:00:00.000Z',
      },
    })
    const weeks = deepFreeze([[slotCell([upper, keepUpper])]])
    const result = cleanupChecklistPrepBoard(weeks, pendingDesks)
    expect(result.removed).toEqual({ trials: 2, memos: 1, teachers: 1 })
    expect(result.pendingDesks?.[buildTemplatePendingDeskKey(CELL, 'd1')]).toBeUndefined()
    expect(result.pendingDesks?.[buildTemplatePendingDeskKey(CELL, 'd2')]).toEqual({
      lower: { lesson: { id: 'pending_lower_2', studentSlots: [trial('t2', '体験X'), null] }, teacher: { teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual' } },
      effectiveStartDate: '2026-11-11',
      createdAt: '2026-11-10T00:00:00.000Z',
    })
    // 上の行（テンプレの講師と生徒）は変えない。テンプレの確認用の生徒の登録はテンプレの保存で消す（removeChecklistPrepTemplateStudents）。
    expect(result.weeks).toBe(weeks)
  })

  it('出欠記録のある机では準備の講師を外さず印だけ外す（記録の講師の帰属を空にしない・INV-01）', () => {
    const record = {
      id: 'st1', studentId: 'e1', sourceManagedLesson: true, name: '生徒s001', managedStudentId: 's001', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal',
      teacherName: '講師D', dateKey: '2026-11-12', slotNumber: 1, recordedAt: '2026-11-12T10:00:00Z', status: 'attended', sourceLessonId: 'managed_d1',
    } as const
    const weeks = deepFreeze([[slotCell([prepTeacher('d1', { statusSlots: [{ ...record }, null], lesson: { id: 'managed_d1', studentSlots: [null, trial('t1', '確認用 体験1')] } })])]])
    const result = cleanupChecklistPrepBoard(weeks, null)
    expect(result.removed).toEqual({ trials: 1, memos: 0, teachers: 0 })
    const desk = result.weeks[0][0].desks[0]
    expect(desk).toMatchObject({ teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4' })
    expect(desk.statusSlots?.[0]).toEqual(record)
    expect('checklistPrepTeacher' in desk).toBe(false)
  })

  it('確認用が何も無ければ removed はすべて 0 で、weeks・pendingDesks は入力と同じ参照', () => {
    const weeks = deepFreeze([[slotCell([{ id: 'd1', teacher: '講師A', lesson: { id: 'managed_d1', studentSlots: [regular('r1', 's001'), trial('t1', '体験X')] } }])]])
    const pendingDesks: TemplatePendingDeskMap = deepFreeze({
      [buildTemplatePendingDeskKey(CELL, 'd1')]: { lower: { memoSlots: ['連絡', null] }, effectiveStartDate: '2026-11-11', createdAt: 'x' },
    })
    const result = cleanupChecklistPrepBoard(weeks, pendingDesks)
    expect(result.removed).toEqual({ trials: 0, memos: 0, teachers: 0 })
    expect(result.weeks).toBe(weeks)
    expect(result.pendingDesks).toBe(pendingDesks)
    expect(cleanupChecklistPrepBoard(weeks, null).pendingDesks).toBeNull()
  })

  it('触ったコマ・週だけ作り直す（ほかの週・コマは同じ参照）', () => {
    const other = slotCell([{ id: 'o1', teacher: '講師A' }], '2026-11-12_2')
    const weeks = deepFreeze([[slotCell([{ id: 'd1', teacher: '', memoSlots: ['確認用メモ1', null] }]), other], [slotCell([{ id: 'w1', teacher: '' }], '2026-11-19_1')]])
    const result = cleanupChecklistPrepBoard(weeks, null)
    expect(result.weeks[0][1]).toBe(other)
    expect(result.weeks[1]).toBe(weeks[1])
  })
})
