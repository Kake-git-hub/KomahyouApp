import { getStudentDisplayName, getTeacherDisplayName, type ManagerRow, type StudentRow, type TeacherRow } from './basicDataModel'
import type { ClassroomSettings } from '../../types/appState'

export type BasicDataBundleForValidation = {
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  classroomSettings: ClassroomSettings
}

function normalizeDuplicateKey(value: string) {
  return value.replace(/[\s\u3000]+/gu, '').trim()
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

  errors.push(...collectDuplicateValueErrors(
    bundle.managers.map((manager, index) => ({ label: manager.id, key: manager.id.trim(), rowNumber: index + 2 })),
    '管理',
    'ID',
  ))
  errors.push(...collectDuplicateValueErrors(
    bundle.teachers.map((teacher, index) => ({ label: teacher.id, key: teacher.id.trim(), rowNumber: index + 2 })),
    '講師',
    'ID',
  ))
  errors.push(...collectDuplicateValueErrors(
    bundle.students.map((student, index) => ({ label: student.id, key: student.id.trim(), rowNumber: index + 2 })),
    '生徒',
    'ID',
  ))

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

  return Array.from(new Set(errors))
}