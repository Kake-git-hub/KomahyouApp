import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import { filterTemplateParticipantsForReferenceDate, type RegularLessonTemplate } from './regularLessonTemplate'

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中講師',
    email: 'teacher@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    isHidden: false,
    subjectCapabilities: [],
    availableSlots: [],
    memo: '',
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
    isHidden: false,
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
