import { getStudentDisplayName, getTeacherDisplayName, type ManagerRow, type StudentRow, type TeacherRow } from './basicDataModel'
import { doRegularLessonParticipantPeriodsOverlap, normalizeRegularLessonSharedPeriod, type RegularLessonRow } from './regularLessonModel'
import type { GroupLessonRow } from './BasicDataScreen'
import type { ClassroomSettings } from '../../types/appState'

export type BasicDataBundleForValidation = {
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  groupLessons: GroupLessonRow[]
  classroomSettings: ClassroomSettings
}

function normalizeDuplicateKey(value: string) {
  return value.replace(/[\s\u3000]+/gu, '').trim()
}

function formatRegularLessonLabel(row: RegularLessonRow, teacherNameById: Map<string, string>, studentNameById: Map<string, string>) {
  const primaryStudent = studentNameById.get(row.student1Id) ?? row.student1Id
  const secondaryStudent = row.student2Id ? ` / ${studentNameById.get(row.student2Id) ?? row.student2Id}` : ''
  const teacherName = teacherNameById.get(row.teacherId) ?? row.teacherId
  const period = [row.startDate, row.endDate].filter(Boolean).join(' - ') || '通年'
  return `${row.schoolYear}年度 ${teacherName} ${row.dayOfWeek}曜 ${row.slotNumber}限 ${primaryStudent}${secondaryStudent} (${period})`
}

function collectDuplicateValueErrors(values: Array<{ label: string; key: string; rowNumber: number }>, entityLabel: string, valueLabel: string) {
  const duplicates = new Map<string, Array<{ label: string; rowNumber: number }>>()
  values.forEach((value) => {
    if (!value.key) return
    const current = duplicates.get(value.key) ?? []
    current.push({ label: value.label, rowNumber: value.rowNumber })
    duplicates.set(value.key, current)
  })

  return Array.from(duplicates.values())
    .filter((rows) => rows.length >= 2)
    .map((rows) => `${entityLabel}${valueLabel}が重複しています: ${rows.map((row) => `${row.label} (行 ${row.rowNumber})`).join(' / ')}`)
}

export function validateImportedBasicDataBundle(bundle: BasicDataBundleForValidation) {
  const errors: string[] = []
  const teacherNameById = new Map(bundle.teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  const studentNameById = new Map(bundle.students.map((student) => [student.id, getStudentDisplayName(student)]))

  errors.push(...collectDuplicateValueErrors(
    bundle.teachers.map((teacher, index) => ({ label: teacher.name, key: normalizeDuplicateKey(teacher.name), rowNumber: index + 2 })),
    '講師',
    '名',
  ))
  errors.push(...collectDuplicateValueErrors(
    bundle.students.map((student, index) => ({ label: student.name, key: normalizeDuplicateKey(student.name), rowNumber: index + 2 })),
    '生徒',
    '名',
  ))
  errors.push(...collectDuplicateValueErrors(
    bundle.teachers.map((teacher, index) => ({ label: getTeacherDisplayName(teacher), key: normalizeDuplicateKey(getTeacherDisplayName(teacher)), rowNumber: index + 2 })),
    '講師表示名',
    '',
  ))
  errors.push(...collectDuplicateValueErrors(
    bundle.students.map((student, index) => ({ label: getStudentDisplayName(student), key: normalizeDuplicateKey(getStudentDisplayName(student)), rowNumber: index + 2 })),
    '生徒表示名',
    '',
  ))

  const normalizedLessons = bundle.regularLessons.map((row) => normalizeRegularLessonSharedPeriod(row))
  const exactDuplicateMap = new Map<string, number[]>()

  normalizedLessons.forEach((row, index) => {
    if (row.student2Id && row.student1Id === row.student2Id) {
      errors.push(`通常授業の同一行で同じ生徒が二重に入っています: 行 ${index + 2}`)
    }

    const lessonSignature = [
      row.schoolYear,
      row.teacherId,
      row.dayOfWeek,
      row.slotNumber,
      row.student1Id,
      row.subject1,
      row.student2Id,
      row.subject2,
      row.startDate,
      row.endDate,
    ].join('__')
    const duplicateRows = exactDuplicateMap.get(lessonSignature) ?? []
    duplicateRows.push(index + 2)
    exactDuplicateMap.set(lessonSignature, duplicateRows)
  })

  Array.from(exactDuplicateMap.entries())
    .filter(([, rows]) => rows.length >= 2)
    .forEach(([signature, rows]) => {
      const sampleIndex = rows[0] ? rows[0] - 2 : 0
      const sample = normalizedLessons[sampleIndex]
      if (!sample) return
      errors.push(`通常授業の重複行があります: ${formatRegularLessonLabel(sample, teacherNameById, studentNameById)} / 行 ${rows.join(', ')}`)
      void signature
    })

  for (let leftIndex = 0; leftIndex < normalizedLessons.length; leftIndex += 1) {
    const left = normalizedLessons[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedLessons.length; rightIndex += 1) {
      const right = normalizedLessons[rightIndex]
      if (left.schoolYear !== right.schoolYear) continue
      if (left.dayOfWeek !== right.dayOfWeek || left.slotNumber !== right.slotNumber) continue
      if (!doRegularLessonParticipantPeriodsOverlap(left, right)) continue

      if (left.teacherId && left.teacherId === right.teacherId) {
        errors.push(`通常授業の講師重複があります: ${teacherNameById.get(left.teacherId) ?? left.teacherId} が同じ年度・曜日・時限で重複しています (行 ${leftIndex + 2} / ${rightIndex + 2})`)
      }

      const leftStudentIds = [left.student1Id, left.student2Id].filter(Boolean)
      const rightStudentIds = new Set([right.student1Id, right.student2Id].filter(Boolean))
      leftStudentIds.forEach((studentId) => {
        if (!rightStudentIds.has(studentId)) return
        errors.push(`通常授業の生徒重複があります: ${studentNameById.get(studentId) ?? studentId} が同じ年度・曜日・時限で重複しています (行 ${leftIndex + 2} / ${rightIndex + 2})`)
      })
    }
  }

  return Array.from(new Set(errors))
}