export type SpecialSessionTeacherInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
  updatedAt: string
}

export type SpecialSessionStudentInput = {
  unavailableSlots: string[]
  regularBreakSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  countSubmitted: boolean
  updatedAt: string
}

export type SpecialSessionRow = {
  id: string
  label: string
  startDate: string
  endDate: string
  teacherInputs: Record<string, SpecialSessionTeacherInput>
  studentInputs: Record<string, SpecialSessionStudentInput>
  createdAt: string
  updatedAt: string
}

export const initialSpecialSessions: SpecialSessionRow[] = [
  {
    id: 'session_2026_summer',
    label: '2026 夏期講習',
    startDate: '2026-07-21',
    endDate: '2026-08-28',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-10 09:30',
    updatedAt: '2026-03-12 18:20',
  },
  {
    id: 'session_2026_spring',
    label: '2026 新年度準備講座',
    startDate: '2026-03-23',
    endDate: '2026-04-05',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-01 10:15',
    updatedAt: '2026-03-08 13:40',
  },
  {
    id: 'session_2026_exam',
    label: '2026 定期試験対策',
    startDate: '2026-05-18',
    endDate: '2026-06-05',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-02-20 12:00',
    updatedAt: '2026-03-11 16:10',
  },
  {
    id: 'session_2026_winter',
    label: '2026 冬期講習',
    startDate: '2026-12-24',
    endDate: '2027-01-07',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-05 08:20',
    updatedAt: '2026-03-09 19:00',
  },
]