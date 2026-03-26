import { describe, expect, it } from 'vitest'
import { buildExpectedRegularOccurrences } from './scheduleHtml'
import type { StudentRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
    isHidden: false,
    ...overrides,
  }
}

function createRegularLesson(overrides: Partial<RegularLessonRow> = {}): RegularLessonRow {
  return {
    id: 'regular-1',
    schoolYear: 2025,
    teacherId: 'teacher-1',
    student1Id: 'student-1',
    subject1: '数',
    startDate: '',
    endDate: '',
    student2Id: '',
    subject2: '',
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek: 2,
    slotNumber: 4,
    ...overrides,
  }
}

describe('scheduleHtml buildExpectedRegularOccurrences', () => {
  it('counts the first four scheduled weekly occurrences even when one date is later closed as a holiday', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      startDate: '2026-03-02',
      endDate: '2026-03-31',
    })

    expect(occurrences.map((entry) => entry.dateKey)).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
      '2026-03-24',
    ])
  })

  it('applies the monthly cap before slicing to a later partial range', () => {
    const occurrences = buildExpectedRegularOccurrences({
      students: [createStudent()],
      regularLessons: [createRegularLesson()],
      startDate: '2026-03-16',
      endDate: '2026-03-31',
    })

    expect(occurrences.map((entry) => entry.dateKey)).toEqual([
      '2026-03-17',
      '2026-03-24',
    ])
  })
})