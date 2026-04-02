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

export const removedDefaultSpecialSessionIds = [
  'session_2026_summer',
  'session_2026_spring',
  'session_2026_exam',
  'session_2026_winter',
]

export const initialSpecialSessions: SpecialSessionRow[] = []