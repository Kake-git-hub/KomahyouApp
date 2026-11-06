// 確認リストの「準備する」第 2 段（docs/plan-2026-11-06-checklist-auto-prep-stage2.md・spec-developer-report §E-2-4-2）の純関数テスト。
// 確認用の生徒（名簿へ足す・使い回す）・テンプレへの登録（席の空き・同じ曜日×時限に同じ生徒を 2 か所置かない＝INV-12）・
// テンプレの確認用の登録だけを消す（INV-02）を固定する。
import { describe, expect, it } from 'vitest'

import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonTemplate, RegularLessonTemplateCell, RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import { resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'
import {
  CHECKLIST_PREP_STUDENT_BIRTH_DATE,
  CHECKLIST_PREP_STUDENT_NAME_PREFIX,
  assignChecklistPrepTemplateStudents,
  ensureChecklistPrepStudents,
  isChecklistPrepStudent,
  removeChecklistPrepTemplateStudents,
  resolveChecklistPrepStudentCount,
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
  return { dayOfWeek: 4, slotNumber: 1, deskIndex, studentIndex, subject: '英', label, ...overrides }
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
