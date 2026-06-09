export type SpecialSessionTeacherInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
  submissionToken?: string
  updatedAt: string
}

export type SpecialSessionStudentInput = {
  unavailableSlots: string[]
  regularBreakSlots: string[]
  subjectSlots: Record<string, number>
  // spec-lecture-stock §6 / TODO4: 科目ごとの授業時間(分)。未設定=90分扱い。
  // 既存提出データとの後方互換のため追加(optional)。subjectSlots は回数のまま維持する。
  subjectDurations?: Record<string, number>
  regularOnly: boolean
  countSubmitted: boolean
  submissionToken?: string
  updatedAt: string
}

// 講習の授業時間(分)。90=既定、60/45 を許容。未設定や不正値は 90 に丸める。
export const lectureDurationOptions = [90, 60, 45] as const
export type LectureDurationMinutes = (typeof lectureDurationOptions)[number]

export function resolveLectureSubjectDuration(
  input: Pick<SpecialSessionStudentInput, 'subjectDurations'> | null | undefined,
  subject: string,
): LectureDurationMinutes {
  const raw = input?.subjectDurations?.[subject]
  return raw === 60 || raw === 45 ? raw : 90
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