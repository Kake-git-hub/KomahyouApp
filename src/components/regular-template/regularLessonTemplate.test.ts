import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import { buildRegularLessonsFromTemplate, filterTemplateParticipantsForReferenceDate, type RegularLessonTemplate } from './regularLessonTemplate'

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中講師',
    email: 'teacher@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    subjectCapabilities: [],
    ...overrides,
  }
}

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2013-05-01',
    ...overrides,
  }
}

function createTemplate(): RegularLessonTemplate {
  return {
    version: 1,
    effectiveStartDate: '2026-04-20',
    savedAt: '2026-04-17T00:00:00.000Z',
    cells: [
      {
        dayOfWeek: 1,
        slotNumber: 1,
        desks: [
          {
            deskIndex: 1,
            teacherId: 'teacher-active',
            students: [
              { studentId: 'student-active', subject: '数', note: '' },
              { studentId: 'student-withdrawn', subject: '英', note: '' },
            ],
          },
          {
            deskIndex: 2,
            teacherId: 'teacher-withdrawn',
            students: [null, null],
          },
        ],
      },
    ],
  }
}

describe('filterTemplateParticipantsForReferenceDate', () => {
  it('keeps only teachers and students visible at the template effective start date', () => {
    const teachers = [
      createTeacher({ id: 'teacher-active' }),
      createTeacher({ id: 'teacher-withdrawn', withdrawDate: '2026-04-10' }),
      createTeacher({ id: 'teacher-pre-entry', entryDate: '2026-05-01' }),
    ]
    const students = [
      createStudent({ id: 'student-active' }),
      createStudent({ id: 'student-withdrawn', withdrawDate: '2026-04-10' }),
      createStudent({ id: 'student-pre-entry', entryDate: '2026-05-01' }),
    ]

    const filtered = filterTemplateParticipantsForReferenceDate({
      template: createTemplate(),
      deskCount: 2,
      teachers,
      students,
    })

    expect(filtered.cells[0]?.desks[0]?.teacherId).toBe('teacher-active')
    expect(filtered.cells[0]?.desks[0]?.students).toEqual([
      { studentId: 'student-active', subject: '数', note: '' },
      null,
    ])
    expect(filtered.cells[0]?.desks[1]?.teacherId).toBe('')
  })

  // spec-template-behavior Q14: 入会前の講師もテンプレに先行配置できる（退塾のみ除外）。
  it('keeps teachers who are pre-entry at the template effective start date', () => {
    const template = createTemplate()
    template.cells[0]!.desks[1] = {
      deskIndex: 2,
      teacherId: 'teacher-pre-entry',
      students: [null, null],
    }

    const filtered = filterTemplateParticipantsForReferenceDate({
      template,
      deskCount: 2,
      teachers: [createTeacher({ id: 'teacher-pre-entry', entryDate: '2026-05-01' })],
      students: [],
    })

    expect(filtered.cells[0]?.desks[1]?.teacherId).toBe('teacher-pre-entry')
  })

  it('keeps students who are pre-entry at the template effective start date', () => {
    const template = createTemplate()
    template.cells[0]!.desks[1] = {
      deskIndex: 2,
      teacherId: '',
      students: [{ studentId: 'student-pre-entry', subject: '英', note: '' }, null],
    }

    const filtered = filterTemplateParticipantsForReferenceDate({
      template,
      deskCount: 2,
      teachers: [createTeacher({ id: 'teacher-active' })],
      students: [createStudent({ id: 'student-pre-entry', entryDate: '2026-05-01' })],
    })

    expect(filtered.cells[0]?.desks[1]?.students[0]).toEqual({ studentId: 'student-pre-entry', subject: '英', note: '' })
  })
})

// spec-template-behavior Q11: 反映日からその年度末(3/31)までの「単年度のみ」生成する。
describe('buildRegularLessonsFromTemplate single-year generation', () => {
  it('generates lessons only for the effective school year (no multi-year expansion)', () => {
    const lessons = buildRegularLessonsFromTemplate({
      template: createTemplate(), // effectiveStartDate '2026-04-20'
      teachers: [createTeacher({ id: 'teacher-active' })],
      students: [createStudent({ id: 'student-active' })],
    })

    expect(lessons.length).toBeGreaterThan(0)
    expect(new Set(lessons.map((row) => row.schoolYear))).toEqual(new Set([2026]))
    // 当年度内: 反映日(4/20) 〜 年度末(3/31)
    expect(lessons.every((row) => row.startDate === '2026-04-20' && row.endDate === '2027-03-31')).toBe(true)
  })
})
