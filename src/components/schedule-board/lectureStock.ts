import { formatStudentSelectionLabel, type StudentRow } from '../basic-data/basicDataModel'
import type { SubjectLabel } from './types'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'

export type LectureStockEntry = {
  key: string
  sessionId: string
  sessionLabel: string
  studentId: string
  displayName: string
  subject: SubjectLabel
  requestedCount: number
}

export function buildLectureStockEntries(params: {
  specialSessions: SpecialSessionRow[]
  students: StudentRow[]
}) {
  const { specialSessions, students } = params
  const studentMap = new Map(students.map((student) => [student.id, student]))

  return specialSessions
    .flatMap((session) => Object.entries(session.studentInputs).flatMap(([studentId, input]) => {
      if (!input.countSubmitted) return []
      if (input.regularOnly) return []

      const student = studentMap.get(studentId)
      const displayName = student ? formatStudentSelectionLabel(student) : studentId

      return Object.entries(input.subjectSlots)
        .map(([subject, requestedCount]) => ({
          key: `${session.id}__${studentId}__${subject}`,
          sessionId: session.id,
          sessionLabel: session.label,
          studentId,
          displayName,
          subject: subject as SubjectLabel,
          requestedCount: Number.isFinite(requestedCount) ? Math.max(0, Math.trunc(requestedCount)) : 0,
        }))
        .filter((entry) => entry.requestedCount > 0)
    }))
    .sort((left, right) => {
      const sessionCompare = left.sessionLabel.localeCompare(right.sessionLabel, 'ja')
      if (sessionCompare !== 0) return sessionCompare

      const studentCompare = left.displayName.localeCompare(right.displayName, 'ja')
      if (studentCompare !== 0) return studentCompare

      return left.subject.localeCompare(right.subject, 'ja')
    })
}