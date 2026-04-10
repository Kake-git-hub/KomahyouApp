import { describe, expect, it, vi } from 'vitest'
import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { SlotCell } from '../components/schedule-board/types'
import { openSpecialSessionAvailabilityHtml } from './specialSessionAvailabilityHtml'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-10',
    isHidden: false,
    ...overrides,
  }
}

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '田中講師',
    email: 'teacher@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    isHidden: false,
    memo: '',
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    availableSlots: [],
    ...overrides,
  }
}

function createSession(overrides: Partial<SpecialSessionRow> = {}): SpecialSessionRow {
  return {
    id: 'session-1',
    label: '春講習',
    startDate: '2026-04-10',
    endDate: '2026-04-16',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    studentInputs: {
      'student-1': {
        unavailableSlots: [],
        regularBreakSlots: [],
        subjectSlots: { 算: 1, 算国: 1 },
        regularOnly: false,
        countSubmitted: false,
        updatedAt: '',
      },
    },
    teacherInputs: {},
    ...overrides,
  }
}

describe('specialSessionAvailabilityHtml', () => {
  it('embeds middle-school legacy math subject normalization for lecture count registration', () => {
    const write = vi.fn()
    const popup = {
      closed: false,
      document: { open() {}, write, close() {} },
      focus() {},
      postMessage() {},
    } as unknown as Window
    vi.stubGlobal('window', {
      open: () => null,
    })

    try {
      openSpecialSessionAvailabilityHtml({
        session: createSession(),
        allSessions: [createSession()],
        classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
        teachers: [createTeacher()],
        students: [createStudent()],
        scheduleCells: [] as SlotCell[],
        boardWeeks: [],
        targetWindow: popup,
      })

      const html = write.mock.calls[0]?.[0]
      expect(typeof html).toBe('string')
      expect(html).toContain("if (subject === '算国') return getPreferredMathSubject(student, referenceDate) === '算' ? '算国' : '数';")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})