import { getStudentDisplayName, type StudentRow } from '../components/basic-data/basicDataModel'
import type { SlotCell, SubjectLabel } from '../components/schedule-board/types'

export type SpecialSessionRegularAssignment = {
  studentId: string
  slotKey: string
  dateKey: string
  slotNumber: number
  subject: SubjectLabel
  teacherName: string
  lessonType: 'regular' | 'makeup'
}

type BuildSpecialSessionRegularAssignmentsResult = {
  byStudent: Record<string, SpecialSessionRegularAssignment[]>
  byStudentSlot: Record<string, SpecialSessionRegularAssignment>
}

function normalizeStudentNameKey(name: string) {
  return name.replace(/[\s\u3000]+/gu, '').trim()
}

function appendAssignment(
  assignment: SpecialSessionRegularAssignment,
  byStudent: Record<string, SpecialSessionRegularAssignment[]>,
  byStudentSlot: Record<string, SpecialSessionRegularAssignment>,
  hiddenRegularSlotKeysByStudent: Map<string, Set<string>>,
) {
  const hiddenKeys = hiddenRegularSlotKeysByStudent.get(assignment.studentId)
  if (assignment.lessonType === 'regular' && hiddenKeys?.has(assignment.slotKey)) return

  const assignmentKey = `${assignment.studentId}__${assignment.slotKey}`
  const existingAssignment = byStudentSlot[assignmentKey]
  if (existingAssignment?.lessonType === 'makeup' && assignment.lessonType !== 'makeup') return

  byStudent[assignment.studentId] = [
    ...(byStudent[assignment.studentId] ?? []).filter((candidate) => candidate.slotKey !== assignment.slotKey),
    assignment,
  ]
  byStudentSlot[assignmentKey] = assignment
}

export function buildSpecialSessionRegularAssignments(params: {
  scheduleCells: SlotCell[]
  students: StudentRow[]
  boardWeeks?: SlotCell[][]
}): BuildSpecialSessionRegularAssignmentsResult {
  const { scheduleCells, students, boardWeeks = [] } = params
  const studentIdByName = new Map<string, string>()
  const byStudent: Record<string, SpecialSessionRegularAssignment[]> = {}
  const byStudentSlot: Record<string, SpecialSessionRegularAssignment> = {}
  const hiddenRegularSlotKeysByStudent = new Map<string, Set<string>>()

  students.forEach((student) => {
    studentIdByName.set(student.name, student.id)
    studentIdByName.set(getStudentDisplayName(student), student.id)
    studentIdByName.set(normalizeStudentNameKey(student.name), student.id)
    studentIdByName.set(normalizeStudentNameKey(getStudentDisplayName(student)), student.id)
  })

  const collectAssignments = (cells: SlotCell[]) => {
    cells.forEach((cell) => {
      cell.desks.forEach((desk) => {
        desk.lesson?.studentSlots.forEach((student) => {
          if (!student || (student.lessonType !== 'regular' && student.lessonType !== 'makeup')) return
          if (student.lessonType === 'makeup' && !student.makeupSourceDate) return

          const studentId = student.managedStudentId
            ?? studentIdByName.get(student.name)
            ?? studentIdByName.get(normalizeStudentNameKey(student.name))
          if (!studentId) return

          const slotKey = `${cell.dateKey}_${cell.slotNumber}`
          const assignment: SpecialSessionRegularAssignment = {
            studentId,
            slotKey,
            dateKey: cell.dateKey,
            slotNumber: cell.slotNumber,
            subject: student.subject,
            teacherName: desk.teacher,
            lessonType: student.lessonType,
          }

          if (student.lessonType === 'makeup' && student.makeupSourceDate) {
            const sourceSlotMatch = student.makeupSourceLabel?.match(/(\d+)限/)
            const sourceSlotNumber = sourceSlotMatch ? Number(sourceSlotMatch[1]) : 0
            if (sourceSlotNumber > 0) {
              const hiddenKeys = hiddenRegularSlotKeysByStudent.get(studentId) ?? new Set<string>()
              hiddenKeys.add(`${student.makeupSourceDate}_${sourceSlotNumber}`)
              hiddenRegularSlotKeysByStudent.set(studentId, hiddenKeys)
            }
          }

          appendAssignment(assignment, byStudent, byStudentSlot, hiddenRegularSlotKeysByStudent)
        })
      })
    })
  }

  collectAssignments(scheduleCells)
  collectAssignments(boardWeeks.flat())

  Object.values(byStudent).forEach((assignments) => {
    assignments.sort((left, right) => left.slotKey.localeCompare(right.slotKey, 'ja', { numeric: true }))
  })

  return { byStudent, byStudentSlot }
}