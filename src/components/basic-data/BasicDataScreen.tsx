import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import type { ClassroomSettings } from '../../types/appState'
import {
  buildTeacherAvailableSlotLabel,
  compareStudentsByCurrentGradeThenName,
  deriveManagedDisplayName,
  type GradeCeiling,
  type ManagerRow,
  normalizeTeacherAvailableSlots,
  parseTeacherAvailableSlots,
  resolveCurrentStudentGradeLabel,
  serializeTeacherAvailableSlots,
  type StudentRow,
  teacherAvailabilityDayOptions,
  teacherAvailabilitySlotNumbers,
  type TeacherAvailableSlot,
  type TeacherRow,
  type TeacherSubjectCapability,
  formatManagedDateValue,
  getReferenceDateKey,
  getStudentDisplayName,
  getTeacherDisplayName,
  initialStudents,
  initialTeachers,
  isTeacherVisibleInManagement,
  resolveScheduledStatus,
  resolveTeacherRosterStatus,
} from './basicDataModel'
import {
  normalizeRegularLessonNote,
  resolveOperationalSchoolYear,
} from './regularLessonModel'
import { normalizeRegularLessonTemplate, parseRegularLessonTemplateWorkbook } from '../regular-template/regularLessonTemplate'
import { AppMenu } from '../navigation/AppMenu'

type BasicDataScreenProps = {
  classroomSettings: ClassroomSettings
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  onUpdateManagers: Dispatch<SetStateAction<ManagerRow[]>>
  onUpdateTeachers: Dispatch<SetStateAction<TeacherRow[]>>
  onUpdateStudents: Dispatch<SetStateAction<StudentRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onBackToBoard: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  onOpenBackupRestore: () => void
  onLogout: () => void
}

export type GroupLessonRow = {
  id: string
  schoolYear: number
  teacherId: string
  subject: string
  studentIds: string[]
  dayOfWeek: number
  slotLabel: string
}

type TableControl = {
  filterText: string
  sortKey: string
  direction: 'asc' | 'desc'
}

type RosterView = 'active' | 'withdrawn'

type BasicDataTab = 'managers' | 'teachers' | 'students' | 'constraints' | 'classroomData'
type RowEditScope = 'manager' | 'teacher' | 'student'
export type BasicDataBundle = {
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  classroomSettings: ClassroomSettings
}

function normalizeImportIdentityValue(value: string) {
  return value.replace(/[\s\u3000]+/gu, '').trim().toLowerCase()
}

function findManagerMatch(manager: ManagerRow, currentManagers: ManagerRow[]) {
  if (manager.id) {
    const matchedById = currentManagers.find((row) => row.id === manager.id)
    if (matchedById) return matchedById
  }

  const normalizedEmail = normalizeImportIdentityValue(manager.email)
  if (normalizedEmail) {
    const matchedByEmail = currentManagers.find((row) => normalizeImportIdentityValue(row.email) === normalizedEmail)
    if (matchedByEmail) return matchedByEmail
  }

  const normalizedName = normalizeImportIdentityValue(manager.name)
  if (!normalizedName) return null
  return currentManagers.find((row) => normalizeImportIdentityValue(row.name) === normalizedName) ?? null
}

function findTeacherMatch(teacher: TeacherRow, currentTeachers: TeacherRow[]) {
  if (teacher.id) {
    const matchedById = currentTeachers.find((row) => row.id === teacher.id)
    if (matchedById) return matchedById
  }

  const normalizedEmail = normalizeImportIdentityValue(teacher.email)
  if (normalizedEmail) {
    const matchedByEmail = currentTeachers.find((row) => normalizeImportIdentityValue(row.email) === normalizedEmail)
    if (matchedByEmail) return matchedByEmail
  }

  const normalizedDisplayName = normalizeImportIdentityValue(getTeacherDisplayName(teacher))
  if (normalizedDisplayName) {
    const matchedByDisplayName = currentTeachers.find((row) => normalizeImportIdentityValue(getTeacherDisplayName(row)) === normalizedDisplayName)
    if (matchedByDisplayName) return matchedByDisplayName
  }

  const normalizedName = normalizeImportIdentityValue(teacher.name)
  if (!normalizedName) return null
  return currentTeachers.find((row) => normalizeImportIdentityValue(row.name) === normalizedName) ?? null
}

function findStudentMatch(student: StudentRow, currentStudents: StudentRow[]) {
  if (student.id) {
    const matchedById = currentStudents.find((row) => row.id === student.id)
    if (matchedById) return matchedById
  }

  const normalizedEmail = normalizeImportIdentityValue(student.email)
  if (normalizedEmail) {
    const matchedByEmail = currentStudents.find((row) => normalizeImportIdentityValue(row.email) === normalizedEmail)
    if (matchedByEmail) return matchedByEmail
  }

  const normalizedDisplayName = normalizeImportIdentityValue(getStudentDisplayName(student))
  if (normalizedDisplayName) {
    const matchedByDisplayName = currentStudents.find((row) => normalizeImportIdentityValue(getStudentDisplayName(row)) === normalizedDisplayName)
    if (matchedByDisplayName) return matchedByDisplayName
  }

  const normalizedName = normalizeImportIdentityValue(student.name)
  if (!normalizedName) return null
  return currentStudents.find((row) => normalizeImportIdentityValue(row.name) === normalizedName) ?? null
}
type XlsxModule = typeof import('xlsx')

const teacherSubjectOptions = ['算', '数', '英', '国', '理', '生', '物', '化', '社']
const gradeCeilingOptions: GradeCeiling[] = ['小', '中', '高1', '高2', '高3']
const gradeCeilingOptionsWithoutElementary: GradeCeiling[] = ['中', '高1', '高2', '高3']
const dayOptions = [
  { value: 0, label: '日曜' },
  { value: 1, label: '月曜' },
  { value: 2, label: '火曜' },
  { value: 3, label: '水曜' },
  { value: 4, label: '木曜' },
  { value: 5, label: '金曜' },
  { value: 6, label: '土曜' },
]

export const initialManagers: ManagerRow[] = []
export const initialGroupLessons: GroupLessonRow[] = [
  { id: 'g001', schoolYear: resolveOperationalSchoolYear(new Date()), teacherId: 't002', subject: '英', studentIds: ['s002', 's003'], dayOfWeek: 3, slotLabel: '2限' },
  { id: 'g002', schoolYear: resolveOperationalSchoolYear(new Date()) - 1, teacherId: 't001', subject: '算', studentIds: ['s001'], dayOfWeek: 1, slotLabel: '1限' },
  { id: 'g003', schoolYear: resolveOperationalSchoolYear(new Date()), teacherId: 't004', subject: '国', studentIds: ['s013', 's025'], dayOfWeek: 5, slotLabel: '3限' },
  { id: 'g004', schoolYear: resolveOperationalSchoolYear(new Date()), teacherId: 't006', subject: '理', studentIds: ['s014', 's026'], dayOfWeek: 4, slotLabel: '4限' },
]

type ManagedIdKind = 'manager' | 'teacher' | 'student' | 'regular' | 'group'

const managedIdConfig: Record<ManagedIdKind, { prefix: string; padding: number; patterns: RegExp[] }> = {
  manager: { prefix: 'manager_', padding: 3, patterns: [/^manager_(\d+)$/u, /^m(\d+)$/u] },
  teacher: { prefix: 't', padding: 3, patterns: [/^t(\d+)$/u] },
  student: { prefix: 's', padding: 3, patterns: [/^s(\d+)$/u] },
  regular: { prefix: 'r', padding: 3, patterns: [/^r(\d+)(?:_[0-9a-z]+)?$/u] },
  group: { prefix: 'g', padding: 3, patterns: [/^g(\d+)$/u] },
}

function parseManagedIdNumber(kind: ManagedIdKind, id: string) {
  const normalizedId = id.trim()
  const config = managedIdConfig[kind]
  for (const pattern of config.patterns) {
    const matched = normalizedId.match(pattern)
    if (matched?.[1]) return Number(matched[1])
  }
  return null
}

function formatManagedId(kind: ManagedIdKind, sequence: number) {
  const config = managedIdConfig[kind]
  if (kind === 'regular') {
    return `${config.prefix}${String(sequence).padStart(config.padding, '0')}_${Date.now().toString(36)}`
  }
  return `${config.prefix}${String(sequence).padStart(config.padding, '0')}`
}

function createManagedIdAllocator(kind: ManagedIdKind, existingIds: string[]) {
  const usedIds = new Set(existingIds.map((id) => id.trim()).filter(Boolean))
  let maxSequence = usedIds.size

  usedIds.forEach((id) => {
    const parsedNumber = parseManagedIdNumber(kind, id)
    if (parsedNumber && parsedNumber > maxSequence) {
      maxSequence = parsedNumber
    }
  })

  return {
    reserve(id: string) {
      const normalizedId = id.trim()
      if (!normalizedId) return ''
      usedIds.add(normalizedId)
      const parsedNumber = parseManagedIdNumber(kind, normalizedId)
      if (parsedNumber && parsedNumber > maxSequence) {
        maxSequence = parsedNumber
      }
      return normalizedId
    },
    next() {
      let candidate = ''
      do {
        maxSequence += 1
        candidate = formatManagedId(kind, maxSequence)
      } while (usedIds.has(candidate))

      usedIds.add(candidate)
      return candidate
    },
  }
}

function createNextManagedId(kind: ManagedIdKind, existingIds: string[]) {
  return createManagedIdAllocator(kind, existingIds).next()
}

function resolveImportedOrGeneratedId(value: unknown, allocator: ReturnType<typeof createManagedIdAllocator>) {
  const importedId = normalizeText(value)
  return importedId ? allocator.reserve(importedId) : allocator.next()
}

function serializeClosedWeekdays(closedWeekdays: number[]) {
  return dayOptions
    .filter((option) => closedWeekdays.includes(option.value))
    .map((option) => option.label)
    .join(', ')
}

function parseClosedWeekdays(value: unknown) {
  const labels = normalizeText(value)
    .split(/[、,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  return dayOptions
    .filter((option) => labels.includes(option.label) || labels.includes(String(option.value)))
    .map((option) => option.value)
    .sort((left, right) => left - right)
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeDateString(value: unknown, xlsx?: XlsxModule) {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = value.getMonth() + 1
    const d = value.getDate()
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return ''
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  if (typeof value === 'number') {
    const parsed = xlsx?.SSF?.parse_date_code(value)
    if (!parsed) return ''
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  const text = normalizeText(value)
  if (!text) return ''

  const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (directMatch) return text

  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (slashMatch) {
    const [, year, month, day] = slashMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const mdyMatch = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/)
  if (mdyMatch) {
    const [, monthStr, dayStr, yearStr] = mdyMatch
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)
    return `${String(year).padStart(4, '0')}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`
  }

  return ''
}

function toWorkbookDateCellValue(value: unknown) {
  const normalized = normalizeDateString(value)
  if (!normalized) return ''

  const [yearText, monthText, dayText] = normalized.split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
}

function createWorkbookSheet(xlsx: XlsxModule, rows: Record<string, unknown>[], dateColumns: string[] = []) {
  const normalizedRows = rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row }
    for (const column of dateColumns) {
      if (!(column in nextRow)) continue
      nextRow[column] = toWorkbookDateCellValue(nextRow[column])
    }
    return nextRow
  })

  const sheet = xlsx.utils.json_to_sheet(normalizedRows, { cellDates: true })
  const headers = rows[0] ? Object.keys(rows[0]) : []

  for (const column of dateColumns) {
    const columnIndex = headers.indexOf(column)
    if (columnIndex < 0) continue

    for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
      const cellRef = xlsx.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })
      const cell = sheet[cellRef]
      if (!cell || !(cell.v instanceof Date)) continue
      cell.z = 'yyyy-mm-dd'
    }
  }

  return sheet
}

function resolveSchoolGradeLabel(birthDate: string, today = new Date()) {
  const normalized = normalizeDateString(birthDate)
  if (!normalized) return '-'

  const [yearText, monthText, dayText] = normalized.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return '-'

  let age = today.getFullYear() - birthYear
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age -= 1
  }

  if (age < 6) return '未就学'
  if (age <= 11) return `小${age - 5}`
  if (age <= 14) return `中${age - 11}`
  if (age <= 17) return `高${age - 14}`
  return '退塾'
}

function resolveStudentStatusLabel(student: StudentRow, today = new Date()) {
  const referenceDate = getReferenceDateKey(today)
  const scheduledStatus = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, referenceDate)
  if (scheduledStatus === '退塾' || scheduledStatus === '非表示') return scheduledStatus
  return resolveSchoolGradeLabel(student.birthDate, today)
}

function resolveTeacherStatusLabel(teacher: TeacherRow, today = new Date()) {
  return resolveTeacherRosterStatus(teacher, getReferenceDateKey(today))
}

function serializeSubjectCapabilities(capabilities: TeacherSubjectCapability[]) {
  return capabilities
    .slice()
    .sort((left, right) => teacherSubjectOptions.indexOf(left.subject) - teacherSubjectOptions.indexOf(right.subject))
    .map((entry) => `${entry.subject}:${entry.maxGrade}`)
    .join(', ')
}

function upsertSubjectCapability(capabilities: TeacherSubjectCapability[], subject: string, maxGrade: GradeCeiling) {
  const next = capabilities.filter((entry) => entry.subject !== subject)
  next.push({ subject, maxGrade })
  return next.sort((left, right) => teacherSubjectOptions.indexOf(left.subject) - teacherSubjectOptions.indexOf(right.subject))
}

function removeSubjectCapability(capabilities: TeacherSubjectCapability[], subject: string) {
  return capabilities.filter((entry) => entry.subject !== subject)
}

function parseSubjectCapabilities(value: unknown): TeacherSubjectCapability[] {
  const entries = normalizeText(value)
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const capabilities: TeacherSubjectCapability[] = []

  for (const entry of entries) {
    const [subjectText, maxGradeText] = entry.split(':').map((part) => part.trim())
    if (!teacherSubjectOptions.includes(subjectText)) continue
    const maxGrade = gradeCeilingOptions.includes(maxGradeText as GradeCeiling) ? (maxGradeText as GradeCeiling) : '高3'
    capabilities.push({ subject: subjectText, maxGrade })
  }

  return capabilities
}

function formatSummaryValue(value: string, fallback = '未設定') {
  return normalizeText(value) || fallback
}

function formatTeacherAvailabilitySummary(slots: TeacherAvailableSlot[] | undefined) {
  return serializeTeacherAvailableSlots(slots) || '未設定'
}

function formatManagedDateButtonLabel(value: string, emptyLabel: string, hint?: string) {
  const normalizedValue = normalizeText(value)
  if (normalizedValue && normalizedValue !== '未定') return normalizedValue
  return hint ? `${emptyLabel} ${hint}` : emptyLabel
}

function formatSubjectCapabilitySummary(capabilities: TeacherSubjectCapability[]) {
  if (capabilities.length === 0) return '未設定'
  return capabilities.map((entry) => `${entry.subject} ${entry.maxGrade}まで`).join(' / ')
}

function createDefaultTableControl(): TableControl {
  return { filterText: '', sortKey: '', direction: 'asc' }
}

function compareControlValue(left: string | number, right: string | number, direction: TableControl['direction']) {
  const normalizedLeft = typeof left === 'number' ? left : String(left).toLowerCase()
  const normalizedRight = typeof right === 'number' ? right : String(right).toLowerCase()
  if (normalizedLeft === normalizedRight) return 0
  const result = normalizedLeft > normalizedRight ? 1 : -1
  return direction === 'asc' ? result : -result
}

function filterAndSortRows<T>(
  rows: T[],
  control: TableControl,
  filterValues: (row: T) => Array<string | number>,
  sortValues: Record<string, (row: T) => string | number>,
) {
  const loweredFilter = control.filterText.trim().toLowerCase()
  const filteredRows = loweredFilter
    ? rows.filter((row) => filterValues(row).some((value) => String(value).toLowerCase().includes(loweredFilter)))
    : rows

  if (!control.sortKey || !sortValues[control.sortKey]) return filteredRows

  return filteredRows.slice().sort((left, right) => compareControlValue(sortValues[control.sortKey](left), sortValues[control.sortKey](right), control.direction))
}

function applyFrozenRowOrder<T extends { id: string }>(rows: T[], frozenRowIds?: string[]) {
  if (!frozenRowIds || frozenRowIds.length === 0) return rows

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const orderedRows: T[] = []

  frozenRowIds.forEach((id) => {
    const row = rowById.get(id)
    if (!row) return
    orderedRows.push(row)
    rowById.delete(id)
  })

  rows.forEach((row) => {
    if (!rowById.has(row.id)) return
    orderedRows.push(row)
    rowById.delete(row.id)
  })

  return orderedRows
}

export function createTemplateBundle(): BasicDataBundle {
  return {
    managers: [{ id: 'template_manager', name: '管理 太郎', email: 'manager@example.com' }],
    teachers: initialTeachers,
    students: initialStudents,
    classroomSettings: {
      closedWeekdays: [0],
      holidayDates: [],
      forceOpenDates: [],
      deskCount: 14,
    },
  }
}

export function buildWorkbook(xlsx: XlsxModule, bundle: BasicDataBundle) {
  const workbook = xlsx.utils.book_new()
  const teacherNameById = Object.fromEntries(bundle.teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  const studentNameById = Object.fromEntries(bundle.students.map((student) => [student.id, getStudentDisplayName(student)]))

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.managers.map((row) => ({
    管理ID: row.id,
    名前: row.name,
    メール: row.email,
  }))), 'マネージャー')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.teachers.map((row) => ({
    講師ID: row.id,
    名前: row.name,
    表示名: getTeacherDisplayName(row),
    メール: row.email,
    入塾日: row.entryDate,
    退塾日: normalizeDateString(row.withdrawDate),
    表示: row.isHidden ? '非表示' : '表示',
    担当科目: serializeSubjectCapabilities(row.subjectCapabilities),
    出勤可能コマ: serializeTeacherAvailableSlots(row.availableSlots),
    メモ: row.memo,
  })), ['入塾日', '退塾日']), '講師')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.students.map((row) => ({
    生徒ID: row.id,
    名前: row.name,
    表示名: row.displayName,
    メール: row.email,
    入塾日: row.entryDate,
    退塾日: normalizeDateString(row.withdrawDate),
    生年月日: row.birthDate,
    表示: row.isHidden ? '非表示' : '表示',
  })), ['入塾日', '退塾日', '生年月日']), '生徒')

  const template = bundle.classroomSettings.regularLessonTemplate
  const deskCount = bundle.classroomSettings.deskCount || 14
  const normalizedTemplate = template ? normalizeRegularLessonTemplate(template, deskCount) : null
  if (normalizedTemplate) {
    const dayLabelByValue: Record<number, string> = { 0: '日', 1: '月', 2: '火', 3: '水', 4: '木', 5: '金', 6: '土' }
    const templateRows = normalizedTemplate.cells.flatMap((cell) => cell.desks.map((desk) => ({
      開始日: normalizedTemplate.effectiveStartDate,
      曜日: dayLabelByValue[cell.dayOfWeek] ?? '月',
      時限: `${cell.slotNumber}限`,
      机: desk.deskIndex,
      講師: teacherNameById[desk.teacherId] ?? '',
      生徒1: studentNameById[desk.students[0]?.studentId ?? ''] ?? '',
      科目1: desk.students[0]?.subject ?? '',
      注記1: normalizeRegularLessonNote(desk.students[0]?.note),
      生徒2: studentNameById[desk.students[1]?.studentId ?? ''] ?? '',
      科目2: desk.students[1]?.subject ?? '',
      注記2: normalizeRegularLessonNote(desk.students[1]?.note),
    })))
    xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, templateRows, ['開始日']), '通常授業テンプレ')
  }

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, [{
    休校曜日: serializeClosedWeekdays(bundle.classroomSettings.closedWeekdays),
    机数: bundle.classroomSettings.deskCount,
  }]), '教室データ')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, [
    { 項目: '各ID列', 説明: '現データ出力に含まれる ID 列は差分取り込みの照合に使います。差分更新時は削除せずそのまま残してください。新規行は空欄でも取り込めます。' },
    { 項目: '講師.担当科目', 説明: '英:高3, 数:中 のように 科目:上限学年 をカンマ区切りで記入します。' },
    { 項目: '講師.出勤可能コマ', 説明: '月1限, 木3限 のように曜日と時限をカンマ区切りで記入します。通常授業がなくてもコマ表へ講師だけ表示します。' },
    { 項目: '講師/生徒.入塾日', 説明: 'YYYY-MM-DD 形式に加えて Excel の日付セルも取り込めます。空欄なら即時在籍として扱います。' },
    { 項目: '講師/生徒.退塾日', 説明: 'YYYY-MM-DD または Excel の日付セルで入力できます。空欄と 未定 はどちらも日付未設定として扱います。' },
    { 項目: '生徒.生年月日', 説明: 'YYYY-MM-DD 形式または Excel の日付セルで入力できます。学年/在籍列はアプリ側で自動計算します。' },
    { 項目: '通常授業テンプレ', 説明: 'コマ表のテンプレモードで作成した通常授業テンプレです。講師名と生徒名は各シートの名前列に一致させてください。' },
    { 項目: '教室データ', 説明: '休校曜日 は 日曜, 月曜 のように曜日名をカンマ区切りで入力します。ペア制約は自動割振ルール画面の Excel 管理で扱います。' },
  ]), '説明')

  return workbook
}

export function parseImportedBundle(xlsx: XlsxModule, workbook: import('xlsx').WorkBook, fallback: BasicDataBundle): BasicDataBundle {
  const managerIdAllocator = createManagedIdAllocator('manager', fallback.managers.map((row) => row.id))
  const teacherIdAllocator = createManagedIdAllocator('teacher', fallback.teachers.map((row) => row.id))
  const studentIdAllocator = createManagedIdAllocator('student', fallback.students.map((row) => row.id))

  const readRows = (sheetName: string) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return null

    const matrix = xlsx.utils.sheet_to_json<Array<unknown>>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    })
    const [headerRow, ...dataRows] = matrix
    if (!headerRow) return []

    const rows: Record<string, unknown>[] = []

    for (const [rowIndex, rowValues] of dataRows.entries()) {
      if (sheet['!rows']?.[rowIndex + 1]?.hidden) continue

      const rowObject: Record<string, unknown> = {}
      let hasAnyValue = false
      headerRow.forEach((headerValue, columnIndex) => {
        const header = normalizeText(headerValue)
        if (!header) return
        const cellValue = rowValues?.[columnIndex] ?? ''
        rowObject[header] = cellValue
        if (normalizeText(cellValue)) hasAnyValue = true
      })

      if (!hasAnyValue) break
      rows.push(rowObject)
    }

    return rows
  }

  const managerRows = readRows('マネージャー')
  const teacherRows = readRows('講師')
  const studentRows = readRows('生徒')

  const managers = managerRows
    ? managerRows
        .map((row) => ({
          id: resolveImportedOrGeneratedId(row['管理ID'], managerIdAllocator),
          name: normalizeText(row['名前']),
          email: normalizeText(row['メール']),
        }))
        .filter((row) => row.name || row.email)
    : fallback.managers

  const teachers = teacherRows
    ? teacherRows
        .map((row) => ({
          id: resolveImportedOrGeneratedId(row['講師ID'], teacherIdAllocator),
          name: normalizeText(row['名前']),
          displayName: normalizeText(row['表示名']) || deriveManagedDisplayName(normalizeText(row['名前'])),
          email: normalizeText(row['メール']),
          entryDate: normalizeDateString(row['入塾日'], xlsx),
          withdrawDate: normalizeDateString(row['退塾日'], xlsx) || normalizeText(row['退塾日']) || '未定',
          isHidden: normalizeText(row['表示']) === '非表示',
          subjectCapabilities: parseSubjectCapabilities(row['担当科目']),
          availableSlots: parseTeacherAvailableSlots(row['出勤可能コマ']),
          memo: normalizeText(row['メモ']),
        }))
        .filter((row) => row.name)
    : fallback.teachers

  const students = studentRows
    ? studentRows
        .map((row) => ({
          id: resolveImportedOrGeneratedId(row['生徒ID'], studentIdAllocator),
          name: normalizeText(row['名前']),
          displayName: normalizeText(row['表示名']) || deriveManagedDisplayName(normalizeText(row['名前'])),
          email: normalizeText(row['メール']),
          entryDate: normalizeDateString(row['入塾日'], xlsx),
          withdrawDate: normalizeDateString(row['退塾日'], xlsx) || normalizeText(row['退塾日']) || '未定',
          birthDate: normalizeDateString(row['生年月日'], xlsx),
          isHidden: normalizeText(row['表示']) === '非表示',
        }))
        .filter((row) => row.name)
    : fallback.students

  const teacherIdByName = new Map<string, string>()
  for (const teacher of teachers) {
    teacherIdByName.set(teacher.name, teacher.id)
    teacherIdByName.set(getTeacherDisplayName(teacher), teacher.id)
  }
  const studentIdByName = new Map<string, string>()
  for (const student of students) {
    studentIdByName.set(student.name, student.id)
    if (student.displayName) studentIdByName.set(student.displayName, student.id)
  }

  const classroomRows = readRows('教室データ')
  const baseClassroomSettings = classroomRows?.[0]
    ? {
        ...fallback.classroomSettings,
        closedWeekdays: parseClosedWeekdays(classroomRows[0]['休校曜日']),
        holidayDates: [],
        deskCount: Math.max(1, Number(classroomRows[0]['机数']) || fallback.classroomSettings.deskCount || 1),
      }
    : {
        ...fallback.classroomSettings,
        holidayDates: [],
      }

  const deskCount = baseClassroomSettings.deskCount || 14
  const hasTemplateSheet = Boolean(workbook.Sheets['通常授業テンプレ'])
  const importedTemplate = hasTemplateSheet
    ? parseRegularLessonTemplateWorkbook(xlsx, workbook, {
        fallbackTemplate: fallback.classroomSettings.regularLessonTemplate,
        teachers,
        students,
        deskCount,
      })
    : fallback.classroomSettings.regularLessonTemplate ?? null

  const classroomSettings = {
    ...baseClassroomSettings,
    regularLessonTemplate: importedTemplate,
  }

  return {
    managers,
    teachers,
    students,
    classroomSettings,
  }
}

export function mergeImportedBundle(imported: BasicDataBundle, fallback: BasicDataBundle): BasicDataBundle {
  const managers = fallback.managers.slice()
  for (const importedManager of imported.managers) {
    const matchedManager = findManagerMatch(importedManager, fallback.managers)
    const nextManager = { ...importedManager, id: matchedManager?.id ?? importedManager.id }
    const targetIndex = managers.findIndex((row) => row.id === nextManager.id)
    if (targetIndex >= 0) {
      managers[targetIndex] = nextManager
      continue
    }
    managers.push(nextManager)
  }

  const teachers = fallback.teachers.slice()
  const mergedTeacherIdByImportedId = new Map<string, string>()
  for (const importedTeacher of imported.teachers) {
    const matchedTeacher = findTeacherMatch(importedTeacher, fallback.teachers)
    const nextTeacher = { ...importedTeacher, id: matchedTeacher?.id ?? importedTeacher.id }
    mergedTeacherIdByImportedId.set(importedTeacher.id, nextTeacher.id)
    const targetIndex = teachers.findIndex((row) => row.id === nextTeacher.id)
    if (targetIndex >= 0) {
      teachers[targetIndex] = nextTeacher
      continue
    }
    teachers.push(nextTeacher)
  }

  const students = fallback.students.slice()
  const mergedStudentIdByImportedId = new Map<string, string>()
  for (const importedStudent of imported.students) {
    const matchedStudent = findStudentMatch(importedStudent, fallback.students)
    const nextStudent = { ...importedStudent, id: matchedStudent?.id ?? importedStudent.id }
    mergedStudentIdByImportedId.set(importedStudent.id, nextStudent.id)
    const targetIndex = students.findIndex((row) => row.id === nextStudent.id)
    if (targetIndex >= 0) {
      students[targetIndex] = nextStudent
      continue
    }
    students.push(nextStudent)
  }

  return {
    managers,
    teachers,
    students,
    classroomSettings: {
      ...fallback.classroomSettings,
      ...imported.classroomSettings,
      closedWeekdays: imported.classroomSettings.closedWeekdays,
      holidayDates: [],
      forceOpenDates: imported.classroomSettings.forceOpenDates,
      deskCount: imported.classroomSettings.deskCount,
    },
  }
}

type SubjectCapabilityEditorProps = {
  capabilities: TeacherSubjectCapability[]
  onChange: (next: TeacherSubjectCapability[]) => void
  testIdPrefix?: string
  disabled?: boolean
}

function SubjectCapabilityEditor({ capabilities, onChange, testIdPrefix, disabled = false }: SubjectCapabilityEditorProps) {
  const [selectedSubject, setSelectedSubject] = useState(teacherSubjectOptions[0])
  const selectedCapability = capabilities.find((entry) => entry.subject === selectedSubject)
  const allowedGrades: GradeCeiling[] = selectedSubject === '算'
    ? ['小']
    : (selectedSubject === '生' || selectedSubject === '物' || selectedSubject === '化')
      ? ['高1', '高2', '高3']
    : selectedSubject === '数'
      ? gradeCeilingOptionsWithoutElementary
      : gradeCeilingOptions

  return (
    <div className="basic-data-inline-stack">
      <div className="basic-data-capability-list" data-testid={testIdPrefix ? `${testIdPrefix}-capabilities` : undefined}>
        {capabilities.length === 0 ? <span className="basic-data-muted-inline">未設定</span> : capabilities.map((entry) => (
          <span key={entry.subject} className="status-chip secondary basic-data-capability-item">
            {entry.subject} {entry.maxGrade}まで
            <button
              className="basic-data-capability-remove"
              type="button"
              onClick={() => onChange(removeSubjectCapability(capabilities, entry.subject))}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="basic-data-chip-row">
        {teacherSubjectOptions.map((subject) => (
          <button
            key={subject}
            type="button"
            className={`basic-data-chip${selectedSubject === subject ? ' active' : ''}`}
            onClick={() => {
              setSelectedSubject(subject)
              if (subject === '算') {
                onChange(upsertSubjectCapability(capabilities, subject, '小'))
              }
            }}
            disabled={disabled}
            data-testid={testIdPrefix ? `${testIdPrefix}-subject-chip-${subject}` : undefined}
          >
            {subject}
          </button>
        ))}
      </div>
      <div className="basic-data-chip-row">
        {allowedGrades.map((grade) => (
          <button
            key={grade}
            type="button"
            className={`basic-data-chip${selectedCapability?.maxGrade === grade ? ' active' : ''}`}
            onClick={() => onChange(upsertSubjectCapability(capabilities, selectedSubject, grade))}
            disabled={disabled}
            data-testid={testIdPrefix ? `${testIdPrefix}-grade-chip-${grade}` : undefined}
          >
            {grade}まで
          </button>
        ))}
      </div>
      <p className="basic-data-subcopy">選んだ学年以下を担当可能として扱います。</p>
    </div>
  )
}

type TeacherAvailabilityEditorProps = {
  slots: TeacherAvailableSlot[]
  onChange: (next: TeacherAvailableSlot[]) => void
  testIdPrefix?: string
  disabled?: boolean
}

function TeacherAvailabilityEditor({ slots, onChange, testIdPrefix, disabled = false }: TeacherAvailabilityEditorProps) {
  const normalizedSlots = normalizeTeacherAvailableSlots(slots)

  const toggleSlot = (dayOfWeek: number, slotNumber: number) => {
    const exists = normalizedSlots.some((slot) => slot.dayOfWeek === dayOfWeek && slot.slotNumber === slotNumber)
    if (exists) {
      onChange(normalizedSlots.filter((slot) => !(slot.dayOfWeek === dayOfWeek && slot.slotNumber === slotNumber)))
      return
    }

    onChange(normalizeTeacherAvailableSlots([...normalizedSlots, { dayOfWeek, slotNumber }]))
  }

  return (
    <div className="basic-data-inline-stack">
      <div className="basic-data-capability-list" data-testid={testIdPrefix ? `${testIdPrefix}-available-slots` : undefined}>
        {normalizedSlots.length === 0 ? <span className="basic-data-muted-inline">未設定</span> : normalizedSlots.map((slot) => (
          <span key={`${slot.dayOfWeek}_${slot.slotNumber}`} className="status-chip secondary basic-data-capability-item">
            {buildTeacherAvailableSlotLabel(slot)}
            <button
              className="basic-data-capability-remove"
              type="button"
              onClick={() => toggleSlot(slot.dayOfWeek, slot.slotNumber)}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="basic-data-availability-grid">
        {teacherAvailabilityDayOptions.map((day) => (
          <div key={day.value} className="basic-data-availability-row">
            <span className="basic-data-availability-day">{day.label}</span>
            <div className="basic-data-chip-row">
              {teacherAvailabilitySlotNumbers.map((slotNumber) => {
                const isActive = normalizedSlots.some((slot) => slot.dayOfWeek === day.value && slot.slotNumber === slotNumber)
                return (
                  <button
                    key={`${day.value}_${slotNumber}`}
                    type="button"
                    className={`basic-data-chip${isActive ? ' active' : ''}`}
                    onClick={() => toggleSlot(day.value, slotNumber)}
                    disabled={disabled}
                    data-testid={testIdPrefix ? `${testIdPrefix}-available-slot-${day.value}-${slotNumber}` : undefined}
                  >
                    {slotNumber}限
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="basic-data-subcopy">選んだ曜日と時限は、通常授業がなくても講師だけコマ表へ表示します。</p>
    </div>
  )
}

type TeacherEditorModalState = {
  editor: 'capabilities' | 'availability'
  target: 'draft' | 'row'
  rowId?: string
}

type TableControlsProps = {
  filterValue: string
  sortKey: string
  direction: TableControl['direction']
  filterPlaceholder: string
  sortOptions: Array<{ value: string; label: string }>
  onFilterChange: (value: string) => void
  onSortKeyChange: (value: string) => void
  onDirectionChange: (value: TableControl['direction']) => void
}

function TableControls({
  filterValue,
  sortKey,
  direction,
  filterPlaceholder,
  sortOptions,
  onFilterChange,
  onSortKeyChange,
  onDirectionChange,
}: TableControlsProps) {
  return (
    <div className="basic-data-table-controls">
      <input value={filterValue} onChange={(event) => onFilterChange(event.target.value)} placeholder={filterPlaceholder} />
      <select value={sortKey} onChange={(event) => onSortKeyChange(event.target.value)}>
        <option value="">並び替えなし</option>
        {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select value={direction} onChange={(event) => onDirectionChange(event.target.value as TableControl['direction'])}>
        <option value="asc">昇順</option>
        <option value="desc">降順</option>
      </select>
    </div>
  )
}

type DateAssistInputProps = {
  value: string
  emptyLabel: string
  hint?: string
  onChange: (value: string) => void
  testIdPrefix?: string
}

function DateAssistInput({ value, emptyLabel, hint, onChange, testIdPrefix }: DateAssistInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => {
    const input = inputRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }
    input.click()
  }

  return (
    <div className="date-assist-field date-assist-field-inline">
      <div className="date-assist-button-wrap">
        <button
          type="button"
          className="date-assist-button"
          onClick={openPicker}
          data-testid={testIdPrefix ? `${testIdPrefix}-button` : undefined}
        >
          {formatManagedDateButtonLabel(value, emptyLabel, hint)}
        </button>
        <input
          ref={inputRef}
          type="date"
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="date-assist-native"
          tabIndex={-1}
          aria-hidden="true"
          data-testid={testIdPrefix ? `${testIdPrefix}-input` : undefined}
        />
      </div>
    </div>
  )
}

export function BasicDataScreen({ classroomSettings, managers, teachers, students, onUpdateManagers, onUpdateTeachers, onUpdateStudents, onUpdateClassroomSettings, onBackToBoard, onOpenSpecialData, onOpenAutoAssignRules, onOpenBackupRestore, onLogout }: BasicDataScreenProps) {
  const [activeTab, setActiveTab] = useState<BasicDataTab>('students')
  const [statusMessage, setStatusMessage] = useState('')


  const [managerDraft, setManagerDraft] = useState({ name: '', email: '' })
  const [teacherDraft, setTeacherDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', memo: '', isHidden: false, subjectCapabilities: [] as TeacherSubjectCapability[], availableSlots: [] as TeacherAvailableSlot[] })
  const [teacherEditorModalState, setTeacherEditorModalState] = useState<TeacherEditorModalState | null>(null)
  const [studentDraft, setStudentDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', birthDate: '' })
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})
  const [frozenRowOrders, setFrozenRowOrders] = useState<Partial<Record<RowEditScope, string[]>>>({})
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, Partial<TeacherRow>>>({})
  const teacherDraftsRef = useRef(teacherDrafts)
  teacherDraftsRef.current = teacherDrafts
  const onUpdateTeachersRef = useRef(onUpdateTeachers)
  onUpdateTeachersRef.current = onUpdateTeachers

  useEffect(() => {
    return () => {
      const pending = teacherDraftsRef.current
      const ids = Object.keys(pending)
      if (ids.length === 0) return
      onUpdateTeachersRef.current((current) => current.map((row) => {
        const draft = pending[row.id]
        return draft ? { ...row, ...draft } : row
      }))
    }
  }, [])
  const [teacherRosterView, setTeacherRosterView] = useState<RosterView>('active')
  const [studentRosterView, setStudentRosterView] = useState<RosterView>('active')
  const [tableControls, setTableControls] = useState<Record<BasicDataTab, TableControl>>({
    managers: createDefaultTableControl(),
    teachers: createDefaultTableControl(),
    students: createDefaultTableControl(),
    constraints: createDefaultTableControl(),
    classroomData: createDefaultTableControl(),
  })

  const todayReferenceDate = useMemo(() => getReferenceDateKey(new Date()), [])
  const activeStudentRows = useMemo(
    () => students.filter((student) => {
      const status = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, todayReferenceDate)
      return status !== '退塾' && status !== '非表示'
    }).slice().sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, todayReferenceDate)),
    [students, todayReferenceDate],
  )
  const withdrawnStudentRows = useMemo(
    () => students.filter((student) => {
      const status = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, todayReferenceDate)
      return status === '退塾' || status === '非表示'
    }).slice().sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, todayReferenceDate)),
    [students, todayReferenceDate],
  )
  const activeTeacherRows = useMemo(
    () => teachers.filter((teacher) => isTeacherVisibleInManagement(teacher, todayReferenceDate)),
    [teachers, todayReferenceDate],
  )
  const withdrawnTeacherRows = useMemo(
    () => teachers.filter((teacher) => {
      const status = resolveTeacherRosterStatus(teacher, todayReferenceDate)
      return status === '退塾' || status === '非表示'
    }),
    [teachers, todayReferenceDate],
  )

  const rowKey = (scope: RowEditScope, id: string) => `${scope}:${id}`
  const updateTableControl = (tab: BasicDataTab, patch: Partial<TableControl>) => {
    setTableControls((current) => ({ ...current, [tab]: { ...current[tab], ...patch } }))
  }
  const isRowEditing = (scope: RowEditScope, id: string) => Boolean(editingRows[rowKey(scope, id)])
  const captureFrozenRowOrder = (scope: RowEditScope, visibleRowIds: string[]) => {
    if (visibleRowIds.length === 0) return

    setFrozenRowOrders((current) => (current[scope] ? current : { ...current, [scope]: visibleRowIds }))
  }
  const releaseFrozenRowOrder = (scope: RowEditScope, currentKey: string) => {
    const hasOtherEditingRows = Object.entries(editingRows).some(([key, isEditing]) => isEditing && key !== currentKey && key.startsWith(`${scope}:`))
    if (hasOtherEditingRows) return

    setFrozenRowOrders((current) => {
      if (!current[scope]) return current
      const next = { ...current }
      delete next[scope]
      return next
    })
  }
  const toggleRowEditing = (scope: RowEditScope, id: string, visibleRowIds: string[] = []) => {
    const key = rowKey(scope, id)
    const nextIsEditing = !editingRows[key]

    if (nextIsEditing) {
      captureFrozenRowOrder(scope, visibleRowIds)
    } else {
      // Commit teacher draft on close
      if (scope === 'teacher') {
        const draft = teacherDrafts[id]
        if (draft) {
          onUpdateTeachers((current) => current.map((row) => (row.id === id ? { ...row, ...draft } : row)))
          setTeacherDrafts((current) => {
            const next = { ...current }
            delete next[id]
            return next
          })
        }
      }
      releaseFrozenRowOrder(scope, key)
      if (scope === 'teacher') {
        setTeacherEditorModalState((previous) => previous?.target === 'row' && previous.rowId === id ? null : previous)
      }
    }

    setEditingRows((current) => ({ ...current, [key]: nextIsEditing }))
  }
  const updateManager = (id: string, patch: Partial<ManagerRow>) => {
    onUpdateManagers((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const updateTeacher = (id: string, patch: Partial<TeacherRow>) => {
    if (isRowEditing('teacher', id)) {
      setTeacherDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
    } else {
      onUpdateTeachers((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    }
  }

  const updateStudent = (id: string, patch: Partial<StudentRow>) => {
    onUpdateStudents((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const teacherEditorModalConfig = (() => {
    if (!teacherEditorModalState) return null

    if (teacherEditorModalState.target === 'draft') {
      return teacherEditorModalState.editor === 'capabilities'
        ? {
            title: '講師の担当科目',
            summaryLabel: '科目',
            editor: (
              <SubjectCapabilityEditor
                capabilities={teacherDraft.subjectCapabilities}
                onChange={(next) => setTeacherDraft((current) => ({ ...current, subjectCapabilities: next }))}
                testIdPrefix="basic-data-teacher-draft"
              />
            ),
          }
        : {
            title: '講師の出勤可能コマ',
            summaryLabel: '出勤可',
            editor: (
              <TeacherAvailabilityEditor
                slots={teacherDraft.availableSlots}
                onChange={(next) => setTeacherDraft((current) => ({ ...current, availableSlots: normalizeTeacherAvailableSlots(next) }))}
                testIdPrefix="basic-data-teacher-draft"
              />
            ),
          }
    }

    const baseTeacher = teachers.find((row) => row.id === teacherEditorModalState.rowId)
    if (!baseTeacher) return null
    const targetTeacher = { ...baseTeacher, ...teacherDrafts[baseTeacher.id] }

    return teacherEditorModalState.editor === 'capabilities'
      ? {
          title: `${getTeacherDisplayName(targetTeacher)} の担当科目`,
          summaryLabel: '科目',
          editor: (
            <SubjectCapabilityEditor
              capabilities={targetTeacher.subjectCapabilities}
              onChange={(next) => updateTeacher(targetTeacher.id, { subjectCapabilities: next })}
              testIdPrefix={`basic-data-teacher-${targetTeacher.id}`}
            />
          ),
        }
      : {
          title: `${getTeacherDisplayName(targetTeacher)} の出勤可能コマ`,
          summaryLabel: '出勤可',
          editor: (
            <TeacherAvailabilityEditor
              slots={targetTeacher.availableSlots ?? []}
              onChange={(next) => updateTeacher(targetTeacher.id, { availableSlots: normalizeTeacherAvailableSlots(next) })}
              testIdPrefix={`basic-data-teacher-${targetTeacher.id}`}
            />
          ),
        }
  })()

  const addManager = () => {
    if (!managerDraft.name.trim()) return
    onUpdateManagers((current) => [...current, { id: createNextManagedId('manager', current.map((row) => row.id)), name: managerDraft.name.trim(), email: managerDraft.email.trim() }])
    setManagerDraft({ name: '', email: '' })
    setStatusMessage('マネージャーを追加しました。')
  }

  const addTeacher = () => {
    if (!teacherDraft.name.trim()) return
    onUpdateTeachers((current) => [
      ...current,
      {
        id: createNextManagedId('teacher', current.map((row) => row.id)),
        name: teacherDraft.name.trim(),
        displayName: teacherDraft.displayName.trim() || deriveManagedDisplayName(teacherDraft.name),
        email: teacherDraft.email.trim(),
        entryDate: teacherDraft.entryDate,
        withdrawDate: teacherDraft.withdrawDate.trim() || '未定',
        isHidden: teacherDraft.isHidden,
        subjectCapabilities: teacherDraft.subjectCapabilities,
        availableSlots: normalizeTeacherAvailableSlots(teacherDraft.availableSlots),
        memo: teacherDraft.memo.trim(),
      },
    ])
    setTeacherDraft({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '未定', memo: '', isHidden: false, subjectCapabilities: [], availableSlots: [] })
    setTeacherEditorModalState((current) => current?.target === 'draft' ? null : current)
    setStatusMessage('講師を追加しました。')
  }

  const addStudent = () => {
    if (!studentDraft.name.trim()) return
    onUpdateStudents((current) => [...current, {
      id: createNextManagedId('student', current.map((row) => row.id)),
      name: studentDraft.name.trim(),
      displayName: studentDraft.displayName.trim(),
      email: studentDraft.email.trim(),
      entryDate: studentDraft.entryDate,
      withdrawDate: studentDraft.withdrawDate.trim(),
      birthDate: studentDraft.birthDate,
      isHidden: false,
    }])
    setStudentDraft({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', birthDate: '' })
    setStatusMessage('生徒を追加しました。')
  }

  const removeManager = (id: string) => {
    if (!window.confirm('このマネージャーを削除します。よろしいですか。')) {
      setStatusMessage('マネージャーの削除をキャンセルしました。')
      return
    }
    onUpdateManagers((current) => current.filter((row) => row.id !== id))
    setStatusMessage('マネージャーを削除しました。')
  }

  const removeTeacher = (id: string) => {
    if (!window.confirm('この講師を削除します。よろしいですか。')) {
      setStatusMessage('講師の削除をキャンセルしました。')
      return
    }
    onUpdateTeachers((current) => current.filter((row) => row.id !== id))
    setStatusMessage('講師を削除しました。')
  }

  const removeStudent = (id: string) => {
    if (!window.confirm('この生徒を削除します。よろしいですか。')) {
      setStatusMessage('生徒の削除をキャンセルしました。')
      return
    }
    onUpdateStudents((current) => current.filter((row) => row.id !== id))
    setStatusMessage('生徒を削除しました。')
  }

  const renderManagers = () => {
    const filteredManagers = applyFrozenRowOrder(filterAndSortRows(
      managers,
      tableControls.managers,
      (row) => [row.name, row.email],
      { name: (row) => row.name, email: (row) => row.email },
    ), frozenRowOrders.manager)

    return (
    <>
      <section className="basic-data-section-card">
        <div className="basic-data-card-head">
          <h3>マネージャー登録</h3>
        </div>
        <div className="basic-data-form-row">
          <input value={managerDraft.name} onChange={(event) => setManagerDraft((current) => ({ ...current, name: event.target.value }))} placeholder="マネージャー名" />
          <input value={managerDraft.email} onChange={(event) => setManagerDraft((current) => ({ ...current, email: event.target.value }))} placeholder="メールアドレス" type="email" />
          <button className="primary-button" type="button" onClick={addManager}>追加</button>
        </div>
      </section>
      <section className="basic-data-section-card">
        <TableControls
          filterValue={tableControls.managers.filterText}
          sortKey={tableControls.managers.sortKey}
          direction={tableControls.managers.direction}
          filterPlaceholder="マネージャー名・メールで絞り込み"
          sortOptions={[{ value: 'name', label: '名前' }, { value: 'email', label: 'メール' }]}
          onFilterChange={(value) => updateTableControl('managers', { filterText: value })}
          onSortKeyChange={(value) => updateTableControl('managers', { sortKey: value })}
          onDirectionChange={(value) => updateTableControl('managers', { direction: value })}
        />
        <table className="basic-data-table" data-testid="basic-data-managers-table">
          <thead><tr><th>名前</th><th>メール</th><th>操作</th></tr></thead>
          <tbody>
            {filteredManagers.length === 0 ? <tr><td colSpan={3} className="basic-data-empty-row">登録済みマネージャーはありません。</td></tr> : filteredManagers.map((row) => (
              <tr key={row.id}>
                <td><input value={row.name} onChange={(event) => updateManager(row.id, { name: event.target.value })} disabled={!isRowEditing('manager', row.id)} /></td>
                <td><input value={row.email} onChange={(event) => updateManager(row.id, { email: event.target.value })} type="email" disabled={!isRowEditing('manager', row.id)} /></td>
                <td>
                  <div className="basic-data-row-actions">
                    <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('manager', row.id, filteredManagers.map((entry) => entry.id))}>{isRowEditing('manager', row.id) ? '編集終了' : '編集'}</button>
                    <button className="secondary-button slim" type="button" onClick={() => removeManager(row.id)}>削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
  }

  const renderTeachers = () => {
    const visibleTeachers = teacherRosterView === 'active' ? activeTeacherRows : withdrawnTeacherRows
    const filteredTeachers = filterAndSortRows(
      visibleTeachers,
      tableControls.teachers,
      (row) => [row.name, getTeacherDisplayName(row), row.email, row.entryDate, row.withdrawDate, resolveTeacherStatusLabel(row), formatSubjectCapabilitySummary(row.subjectCapabilities), formatTeacherAvailabilitySummary(row.availableSlots), row.memo],
      {
        name: (row) => getTeacherDisplayName(row),
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(row.withdrawDate),
        status: (row) => resolveTeacherStatusLabel(row),
        subjects: (row) => formatSubjectCapabilitySummary(row.subjectCapabilities),
        availability: (row) => formatTeacherAvailabilitySummary(row.availableSlots),
      },
    )
    const orderedTeachers = applyFrozenRowOrder(filteredTeachers, frozenRowOrders.teacher)

    return (
      <>
        <section className="basic-data-section-card">
          <div className="basic-data-card-head">
            <h3>講師登録</h3>
          </div>
          <div className="basic-data-compact-form basic-data-compact-form-teacher" data-testid="basic-data-teacher-draft-row">
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>名前</span>
              <input value={teacherDraft.name} onChange={(event) => setTeacherDraft((current) => ({ ...current, name: event.target.value }))} placeholder="講師名" data-testid="basic-data-teacher-draft-name" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>表示</span>
              <input value={teacherDraft.displayName} onChange={(event) => setTeacherDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="表示名" data-testid="basic-data-teacher-draft-display-name" />
            </label>
            <div className="basic-data-inline-editor-slot basic-data-inline-editor-slot-teacher">
              <button
                className="basic-data-inline-summary basic-data-inline-summary-button"
                type="button"
                onClick={() => setTeacherEditorModalState({ target: 'draft', editor: 'capabilities' })}
                data-testid="basic-data-teacher-draft-capabilities-summary"
              >
                <span className="basic-data-inline-summary-label">科目</span>
                <strong>{formatSubjectCapabilitySummary(teacherDraft.subjectCapabilities)}</strong>
              </button>
            </div>
            <div className="basic-data-inline-editor-slot basic-data-inline-editor-slot-teacher">
              <button
                className="basic-data-inline-summary basic-data-inline-summary-button"
                type="button"
                onClick={() => setTeacherEditorModalState({ target: 'draft', editor: 'availability' })}
                data-testid="basic-data-teacher-draft-availability-summary"
              >
                <span className="basic-data-inline-summary-label">出勤可</span>
                <strong>{formatTeacherAvailabilitySummary(teacherDraft.availableSlots)}</strong>
              </button>
            </div>
            <label className="basic-data-inline-field basic-data-inline-field-medium">
              <span>メール</span>
              <input value={teacherDraft.email} onChange={(event) => setTeacherDraft((current) => ({ ...current, email: event.target.value }))} placeholder="メールアドレス" type="email" data-testid="basic-data-teacher-draft-email" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>入塾日</span>
              <DateAssistInput value={teacherDraft.entryDate} emptyLabel="入塾日を選択" onChange={(value) => setTeacherDraft((current) => ({ ...current, entryDate: value }))} testIdPrefix="basic-data-teacher-draft-entry-date" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>退塾日</span>
              <DateAssistInput value={teacherDraft.withdrawDate} emptyLabel="退塾日を選択" hint="未定の場合未入力" onChange={(value) => setTeacherDraft((current) => ({ ...current, withdrawDate: value }))} testIdPrefix="basic-data-teacher-draft-withdraw-date" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>メモ</span>
              <input value={teacherDraft.memo} onChange={(event) => setTeacherDraft((current) => ({ ...current, memo: event.target.value }))} placeholder="メモ" data-testid="basic-data-teacher-draft-memo" />
            </label>
            <button className="primary-button" type="button" onClick={addTeacher} data-testid="basic-data-add-teacher-button">追加</button>
          </div>
        </section>
        <section className="basic-data-section-card">
          <div className="basic-data-section-header">
            <TableControls
              filterValue={tableControls.teachers.filterText}
              sortKey={tableControls.teachers.sortKey}
              direction={tableControls.teachers.direction}
              filterPlaceholder={teacherRosterView === 'active' ? '講師名・表示名・メール・科目で絞り込み' : '退塾講師を名前・表示名・メールで絞り込み'}
              sortOptions={[{ value: 'name', label: '表示名' }, { value: 'entryDate', label: '入塾日' }, { value: 'withdrawDate', label: '退塾日' }, { value: 'status', label: '状態' }, { value: 'subjects', label: '科目' }]}
              onFilterChange={(value) => updateTableControl('teachers', { filterText: value })}
              onSortKeyChange={(value) => updateTableControl('teachers', { sortKey: value })}
              onDirectionChange={(value) => updateTableControl('teachers', { direction: value })}
            />
            <div className="basic-data-table-visibility-toggle" data-testid="basic-data-teacher-roster-toggle">
              <button type="button" className={`basic-data-chip${teacherRosterView === 'active' ? ' active' : ''}`} onClick={() => setTeacherRosterView('active')} data-testid="basic-data-teacher-roster-active">在籍講師</button>
              <button type="button" className={`basic-data-chip${teacherRosterView === 'withdrawn' ? ' active' : ''}`} onClick={() => setTeacherRosterView('withdrawn')} data-testid="basic-data-teacher-roster-withdrawn">退塾講師表示</button>
            </div>
          </div>
          <table className="basic-data-table" data-testid="basic-data-teachers-table">
            <thead><tr><th>氏名</th><th>表示名</th><th>メール</th><th>入塾日</th><th>退塾日</th><th>状態</th><th>科目</th><th>メモ</th><th>操作</th></tr></thead>
            <tbody>
              {orderedTeachers.map((originalRow) => {
                const draft = teacherDrafts[originalRow.id]
                const row = draft ? { ...originalRow, ...draft } : originalRow
                return (
                <tr key={row.id}>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <input value={row.name} onChange={(event) => updateTeacher(row.id, { name: event.target.value })} data-testid={`basic-data-teacher-name-input-${row.id}`} />
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-teacher-name-${row.id}`}>{row.name}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <input value={row.displayName ?? ''} onChange={(event) => updateTeacher(row.id, { displayName: event.target.value })} data-testid={`basic-data-teacher-display-name-input-${row.id}`} />
                      : <span className="basic-data-cell-summary">{getTeacherDisplayName(row)}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <input value={row.email} onChange={(event) => updateTeacher(row.id, { email: event.target.value })} type="email" />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.email)}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <DateAssistInput value={row.entryDate} emptyLabel="入塾日を選択" onChange={(value) => updateTeacher(row.id, { entryDate: value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.entryDate)}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <DateAssistInput value={row.withdrawDate} emptyLabel="退塾日を選択" hint="未定の場合未入力" onChange={(value) => updateTeacher(row.id, { withdrawDate: value })} />
                      : <span className="basic-data-cell-summary">{formatManagedDateValue(row.withdrawDate)}</span>}
                  </td>
                  <td><span className="status-chip secondary" data-testid={`basic-data-teacher-status-${row.id}`}>{resolveTeacherStatusLabel(row)}</span></td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? (
                          <button
                            className="basic-data-inline-summary basic-data-inline-summary-button"
                            type="button"
                            onClick={() => setTeacherEditorModalState({ target: 'row', rowId: row.id, editor: 'capabilities' })}
                          >
                            <span className="basic-data-inline-summary-label">科目</span>
                            <strong>{formatSubjectCapabilitySummary(row.subjectCapabilities)}</strong>
                          </button>
                        )
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-teacher-capabilities-${row.id}`}>{formatSubjectCapabilitySummary(row.subjectCapabilities)}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <input value={row.memo} onChange={(event) => updateTeacher(row.id, { memo: event.target.value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.memo)}</span>}
                  </td>
                  <td>
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('teacher', row.id, orderedTeachers.map((entry) => entry.id))} data-testid={`basic-data-edit-teacher-${row.id}`}>{isRowEditing('teacher', row.id) ? '保存' : '編集'}</button>
                      <button className="secondary-button slim" type="button" onClick={() => removeTeacher(row.id)}>削除</button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {orderedTeachers.length === 0 ? <tr><td colSpan={9} className="basic-data-empty-row">{teacherRosterView === 'active' ? '在籍講師はまだありません。' : '退塾講師はまだありません。'}</td></tr> : null}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  const renderStudents = () => {
    const visibleStudents = studentRosterView === 'active' ? activeStudentRows : withdrawnStudentRows
    const filteredStudents = filterAndSortRows(
      visibleStudents,
      tableControls.students,
      (row) => [row.name, row.displayName, row.email, row.entryDate, row.withdrawDate, row.birthDate, resolveStudentStatusLabel(row)],
      {
        name: (row) => `${resolveCurrentStudentGradeLabel(row, todayReferenceDate)}_${getStudentDisplayName(row)}`,
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(row.withdrawDate),
        birthDate: (row) => row.birthDate,
        status: (row) => resolveStudentStatusLabel(row),
      },
    )
    const orderedStudents = applyFrozenRowOrder(filteredStudents, frozenRowOrders.student)

    return (
      <>
        <section className="basic-data-section-card">
          <div className="basic-data-card-head">
            <h3>生徒登録</h3>
          </div>
          <div className="basic-data-compact-form basic-data-compact-form-student" data-testid="basic-data-student-draft-row">
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>名前</span>
              <input value={studentDraft.name} onChange={(event) => setStudentDraft((current) => ({ ...current, name: event.target.value }))} placeholder="生徒名" data-testid="basic-data-student-draft-name" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>表示</span>
              <input value={studentDraft.displayName} onChange={(event) => setStudentDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="表示名" data-testid="basic-data-student-draft-display-name" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-medium">
              <span>メール</span>
              <input value={studentDraft.email} onChange={(event) => setStudentDraft((current) => ({ ...current, email: event.target.value }))} placeholder="メールアドレス" type="email" data-testid="basic-data-student-draft-email" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>入塾日</span>
              <DateAssistInput value={studentDraft.entryDate} emptyLabel="入塾日を選択" onChange={(value) => setStudentDraft((current) => ({ ...current, entryDate: value }))} testIdPrefix="basic-data-student-draft-entry-date" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>退塾日</span>
              <DateAssistInput value={studentDraft.withdrawDate} emptyLabel="退塾日を選択" hint="未定の場合未入力" onChange={(value) => setStudentDraft((current) => ({ ...current, withdrawDate: value }))} testIdPrefix="basic-data-student-draft-withdraw-date" />
            </label>
            <label className="basic-data-inline-field basic-data-inline-field-short">
              <span>生年月日</span>
              <DateAssistInput value={studentDraft.birthDate} emptyLabel="生年月日を選択" onChange={(value) => setStudentDraft((current) => ({ ...current, birthDate: value }))} testIdPrefix="basic-data-student-draft-birthdate" />
            </label>
            <button className="primary-button" type="button" onClick={addStudent} data-testid="basic-data-add-student-button">追加</button>
          </div>
        </section>
        <section className="basic-data-section-card">
          <div className="basic-data-section-header">
            <TableControls
              filterValue={tableControls.students.filterText}
              sortKey={tableControls.students.sortKey}
              direction={tableControls.students.direction}
              filterPlaceholder={studentRosterView === 'active' ? '生徒名・表示名・学年で絞り込み' : '退塾生徒を氏名・表示名で絞り込み'}
              sortOptions={[{ value: 'name', label: '表示名' }, { value: 'entryDate', label: '入塾日' }, { value: 'withdrawDate', label: '退塾日' }, { value: 'birthDate', label: '生年月日' }, { value: 'status', label: '学年/状態' }]}
              onFilterChange={(value) => updateTableControl('students', { filterText: value })}
              onSortKeyChange={(value) => updateTableControl('students', { sortKey: value })}
              onDirectionChange={(value) => updateTableControl('students', { direction: value })}
            />
            <div className="basic-data-table-visibility-toggle" data-testid="basic-data-student-roster-toggle">
              <button type="button" className={`basic-data-chip${studentRosterView === 'active' ? ' active' : ''}`} onClick={() => setStudentRosterView('active')} data-testid="basic-data-student-roster-active">在籍生徒</button>
              <button type="button" className={`basic-data-chip${studentRosterView === 'withdrawn' ? ' active' : ''}`} onClick={() => setStudentRosterView('withdrawn')} data-testid="basic-data-student-roster-withdrawn">退塾生徒表示</button>
            </div>
          </div>
          <table className="basic-data-table" data-testid={studentRosterView === 'active' ? 'basic-data-students-table' : 'basic-data-withdrawn-students-table'}>
            <thead><tr><th>氏名</th><th>表示名</th><th>メール</th><th>入塾日</th><th>退塾日</th><th>生年月日</th><th>学年/状態</th><th>操作</th></tr></thead>
            <tbody>
              {orderedStudents.map((row) => (
                <tr key={row.id}>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <input value={row.name} onChange={(event) => updateStudent(row.id, { name: event.target.value })} data-testid={`basic-data-student-name-input-${row.id}`} />
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-student-name-${row.id}`}>{row.name}</span>}
                  </td>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <input value={row.displayName} onChange={(event) => updateStudent(row.id, { displayName: event.target.value })} />
                      : <span className="basic-data-cell-summary">{getStudentDisplayName(row)}</span>}
                  </td>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <input value={row.email} onChange={(event) => updateStudent(row.id, { email: event.target.value })} type="email" />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.email)}</span>}
                  </td>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <DateAssistInput value={row.entryDate} emptyLabel="入塾日を選択" onChange={(value) => updateStudent(row.id, { entryDate: value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.entryDate)}</span>}
                  </td>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <DateAssistInput value={row.withdrawDate} emptyLabel="退塾日を選択" hint="未定の場合未入力" onChange={(value) => updateStudent(row.id, { withdrawDate: value })} />
                      : <span className="basic-data-cell-summary">{formatManagedDateValue(row.withdrawDate)}</span>}
                  </td>
                  <td>
                    {isRowEditing('student', row.id)
                      ? <DateAssistInput value={row.birthDate} emptyLabel="生年月日を選択" onChange={(value) => updateStudent(row.id, { birthDate: value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.birthDate)}</span>}
                  </td>
                  <td><span className="status-chip secondary" data-testid={`basic-data-student-grade-${row.id}`}>{studentRosterView === 'active' ? resolveStudentStatusLabel(row) : resolveScheduledStatus(row.entryDate, row.withdrawDate, row.isHidden, todayReferenceDate)}</span></td>
                  <td>
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('student', row.id, orderedStudents.map((entry) => entry.id))} data-testid={`basic-data-edit-student-${row.id}`}>{isRowEditing('student', row.id) ? '編集終了' : '編集'}</button>
                      <button className="secondary-button slim" type="button" onClick={() => removeStudent(row.id)}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {orderedStudents.length === 0 ? <tr><td colSpan={8} className="basic-data-empty-row">{studentRosterView === 'active' ? '在籍生徒はまだありません。' : '退塾生徒はまだありません。'}</td></tr> : null}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  const renderClassroomData = () => (
    <section className="basic-data-section-card" data-testid="basic-data-classroom-screen">
      <div className="basic-data-card-head">
        <h3>教室データ</h3>
      </div>
      <div className="basic-data-inline-stack">
        <div className="basic-data-editor-block basic-data-inline-stack">
        </div>
        <span style={{ color: '#58708d', fontSize: '12px' }}>定休日設定</span>
        <div className="basic-data-chip-row">
          {dayOptions.map((day) => {
            const isActive = classroomSettings.closedWeekdays.includes(day.value)
            return (
              <button
                key={day.value}
                type="button"
                className={`basic-data-chip${isActive ? ' active' : ''}`}
                onClick={() => onUpdateClassroomSettings({
                  ...classroomSettings,
                  closedWeekdays: isActive
                    ? classroomSettings.closedWeekdays.filter((value) => value !== day.value)
                    : [...classroomSettings.closedWeekdays, day.value].sort((left, right) => left - right),
                })}
                data-testid={`basic-data-classroom-closed-day-${day.value}`}
              >
                {day.label}
              </button>
            )
          })}
        </div>
        <label className="basic-data-inline-field basic-data-inline-field-short">
          <span>机数</span>
          <input type="number" min="1" max="30" value={classroomSettings.deskCount} onChange={(event) => onUpdateClassroomSettings({ ...classroomSettings, deskCount: Math.max(1, Number(event.target.value) || 1) })} data-testid="basic-data-classroom-desk-count" />
        </label>
      </div>
    </section>
  )

  const tabItems: Array<{ key: BasicDataTab; label: string }> = [
    { key: 'students', label: '生徒' },
    { key: 'teachers', label: '講師' },
    { key: 'managers', label: 'マネージャー' },
    { key: 'classroomData', label: '教室データ' },
  ]

  return (
    <div className="page-shell page-shell-basic-data">

      {teacherEditorModalConfig ? (
        <div className="auto-assign-modal-overlay basic-data-teacher-modal-overlay" role="presentation">
          <div
            className="auto-assign-modal basic-data-teacher-modal"
            role="dialog"
            aria-modal="true"
            aria-label={teacherEditorModalConfig.title}
          >
            <div className="basic-data-teacher-modal-header">
              <div className="auto-assign-modal-title">{teacherEditorModalConfig.title}</div>
              <button className="secondary-button slim" type="button" onClick={() => setTeacherEditorModalState(null)}>閉じる</button>
            </div>
            {teacherEditorModalConfig.editor}
            <div className="auto-assign-modal-actions">
              <button className="primary-button" type="button" onClick={() => setTeacherEditorModalState(null)}>完了</button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="toolbar-panel" aria-label="基本データの操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div className="toolbar-group toolbar-group-compact">
            <AppMenu
              currentScreen="basic-data"
              onNavigate={(screen) => {
                if (screen === 'board') onBackToBoard()
                if (screen === 'special-data') onOpenSpecialData()
                if (screen === 'auto-assign-rules') onOpenAutoAssignRules()
                if (screen === 'backup-restore') onOpenBackupRestore()
              }}
              buttonTestId="basic-data-menu-button"
              boardItemTestId="basic-data-menu-open-board-button"
              specialDataItemTestId="basic-data-menu-open-special-data-button"
              autoAssignRulesItemTestId="basic-data-menu-open-auto-assign-rules-button"
              backupRestoreItemTestId="basic-data-menu-open-backup-button"
              footerActionLabel="ログアウト"
              onFooterActionClick={onLogout}
              footerActionTestId="basic-data-menu-logout-button"
            />
          </div>
        </div>
        {statusMessage ? (
          <div className="toolbar-row toolbar-row-secondary">
            <div className="toolbar-status" data-testid="basic-data-status">{statusMessage}</div>
          </div>
        ) : null}
      </section>

      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified basic-data-panel" data-testid="basic-data-screen">
          <div className="basic-data-header">
            <div>
              <h2>管理データ</h2>
            </div>
          </div>

          <div className="basic-data-tabs" role="tablist" aria-label="基本データタブ">
            {tabItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`basic-data-tab${activeTab === item.key ? ' active' : ''}`}
                onClick={() => setActiveTab(item.key)}
                data-testid={`basic-data-tab-${item.key}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="basic-data-content">
            {activeTab === 'students' ? renderStudents() : null}
            {activeTab === 'teachers' ? renderTeachers() : null}
            {activeTab === 'managers' ? renderManagers() : null}
            {activeTab === 'classroomData' ? renderClassroomData() : null}
          </div>
        </section>
      </main>
    </div>
  )
}