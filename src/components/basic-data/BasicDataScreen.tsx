import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import type { ClassroomSettings } from '../../types/appState'
import {
  deriveManagedDisplayName,
  type GradeCeiling,
  type ManagerRow,
  type StudentRow,
  type TeacherRow,
  type TeacherSubjectCapability,
  formatManagedDateValue,
  getReferenceDateKey,
  getStudentDisplayName,
  getTeacherDisplayName,
  initialStudents,
  initialTeachers,
  isActiveOnDate,
  resolveScheduledStatus,
  resolveTeacherRosterStatus,
} from './basicDataModel'
import {
  createInitialRegularLessons,
  doRegularLessonParticipantPeriodsOverlap,
  normalizeRegularLessonSharedPeriod,
  packSortRegularLessonRows,
  type RegularLessonRow,
  resolveOperationalSchoolYear,
  resolveSchoolYearDateRange,
} from './regularLessonModel'
import { AppMenu } from '../navigation/AppMenu'
import { resolveDisplayedSubjectForBirthDate } from '../../utils/studentGradeSubject'

type BasicDataScreenProps = {
  classroomSettings: ClassroomSettings
  googleHolidaySyncState: {
    status: 'idle' | 'syncing' | 'success' | 'error' | 'disabled'
    message: string
  }
  isGoogleHolidayApiConfigured: boolean
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  groupLessons: GroupLessonRow[]
  onUpdateManagers: Dispatch<SetStateAction<ManagerRow[]>>
  onUpdateTeachers: Dispatch<SetStateAction<TeacherRow[]>>
  onUpdateStudents: Dispatch<SetStateAction<StudentRow[]>>
  onUpdateRegularLessons: Dispatch<SetStateAction<RegularLessonRow[]>>
  onUpdateGroupLessons: Dispatch<SetStateAction<GroupLessonRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onSyncGoogleHolidays: () => void
  onBackToBoard: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  onOpenBackupRestore: () => void
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

type BasicDataTab = 'managers' | 'teachers' | 'students' | 'regularLessons' | 'groupLessons' | 'constraints' | 'classroomData'
export type BasicDataBundle = {
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  groupLessons: GroupLessonRow[]
  classroomSettings: ClassroomSettings
}
type XlsxModule = typeof import('xlsx')

const subjectOptions = ['算', '数', '英', '国', '理', '社']
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
const maxSelectableSchoolYear = 2031

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function resolveDayLabel(dayOfWeek: number) {
  return dayOptions.find((option) => option.value === dayOfWeek)?.label ?? '-'
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

function formatSchoolYearLabel(schoolYear: number) {
  return `${schoolYear}年度`
}

function buildSelectableSchoolYears(currentSchoolYear: number) {
  const years: number[] = []
  for (let year = currentSchoolYear - 1; year <= maxSelectableSchoolYear; year += 1) {
    years.push(year)
  }
  return years.reverse()
}

function normalizeDateString(value: unknown, xlsx?: XlsxModule) {
  if (typeof value === 'number') {
    const parsed = xlsx?.SSF.parse_date_code(value)
    if (!parsed) return ''
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  const text = normalizeText(value)
  if (!text) return ''

  const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (directMatch) return text

  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (!slashMatch) return ''

  const [, year, month, day] = slashMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
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
  if (scheduledStatus === '入塾前' || scheduledStatus === '退塾' || scheduledStatus === '非表示') return scheduledStatus
  return resolveSchoolGradeLabel(student.birthDate, today)
}

function resolveTeacherStatusLabel(teacher: TeacherRow, today = new Date()) {
  return resolveTeacherRosterStatus(teacher, getReferenceDateKey(today))
}

function isTeacherActive(teacher: TeacherRow, today = new Date()) {
  return resolveTeacherStatusLabel(teacher, today) === '在籍'
}

function isStudentActive(student: StudentRow, today = new Date()) {
  const referenceDate = getReferenceDateKey(today)
  return isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, referenceDate) && resolveSchoolGradeLabel(student.birthDate, today) !== '退塾'
}

function serializeSubjectCapabilities(capabilities: TeacherSubjectCapability[]) {
  return capabilities
    .slice()
    .sort((left, right) => subjectOptions.indexOf(left.subject) - subjectOptions.indexOf(right.subject))
    .map((entry) => `${entry.subject}:${entry.maxGrade}`)
    .join(', ')
}

function upsertSubjectCapability(capabilities: TeacherSubjectCapability[], subject: string, maxGrade: GradeCeiling) {
  const next = capabilities.filter((entry) => entry.subject !== subject)
  next.push({ subject, maxGrade })
  return next.sort((left, right) => subjectOptions.indexOf(left.subject) - subjectOptions.indexOf(right.subject))
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
    if (!subjectOptions.includes(subjectText)) continue
    const maxGrade = gradeCeilingOptions.includes(maxGradeText as GradeCeiling) ? (maxGradeText as GradeCeiling) : '高3'
    capabilities.push({ subject: subjectText, maxGrade })
  }

  return capabilities
}

function getStudentOptionLabel(student: StudentRow) {
  return getStudentDisplayName(student)
}

function getTeacherOptionLabel(teacher: TeacherRow) {
  return getTeacherDisplayName(teacher)
}

function formatSummaryValue(value: string, fallback = '未設定') {
  return normalizeText(value) || fallback
}

function formatManagedDateButtonLabel(value: string, emptyLabel: string, hint?: string) {
  const normalizedValue = normalizeText(value)
  if (normalizedValue && normalizedValue !== '未定') return normalizedValue
  return hint ? `${emptyLabel} ${hint}` : emptyLabel
}

function formatRegularLessonParticipantSummary(studentName: string, subject: string, emptyLabel: string) {
  const normalizedStudentName = normalizeText(studentName)
  if (!normalizedStudentName) return emptyLabel
  return `${normalizedStudentName} / ${formatSummaryValue(subject)}`
}

function formatRegularLessonPeriodSummary(startDate: string, endDate: string, schoolYear: number) {
  const schoolYearRange = resolveSchoolYearDateRange(schoolYear)
  return `${normalizeText(startDate) || schoolYearRange.startDate} - ${normalizeText(endDate) || schoolYearRange.endDate}`
}

function formatSyncTimestamp(value: string) {
  if (!value) return '未同期'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '未同期'
  return parsed.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildSharedRegularLessonPeriodPatch(startDate: string, endDate: string) {
  return {
    startDate,
    endDate,
    student2StartDate: startDate,
    student2EndDate: endDate,
  }
}

function collectRegularLessonConflicts(
  regularLessons: RegularLessonRow[],
  draft: ReturnType<typeof createRegularLessonDraft>,
  schoolYear: number,
  teacherNameById: Record<string, string>,
  studentNameById: Record<string, string>,
  excludeRowId?: string,
) {
  const draftWithSchoolYear = { ...draft, schoolYear }
  const draftParticipants = [
    draft.student1Id ? { studentId: draft.student1Id, participantIndex: 1 as const } : null,
    draft.student2Id ? { studentId: draft.student2Id, participantIndex: 2 as const } : null,
  ].filter((entry): entry is { studentId: string; participantIndex: 1 | 2 } => entry !== null)

  return regularLessons
    .filter((row) => row.id !== excludeRowId && row.schoolYear === schoolYear && row.dayOfWeek === draft.dayOfWeek && row.slotNumber === draft.slotNumber)
    .flatMap((row) => {
      const messages: string[] = []
      const rowParticipants = [
        row.student1Id ? { studentId: row.student1Id, participantIndex: 1 as const } : null,
        row.student2Id ? { studentId: row.student2Id, participantIndex: 2 as const } : null,
      ].filter((entry): entry is { studentId: string; participantIndex: 1 | 2 } => entry !== null)
      const hasParticipantOverlap = draftParticipants.length > 0
        && rowParticipants.length > 0
        && doRegularLessonParticipantPeriodsOverlap(draftWithSchoolYear, row)

      if (draft.teacherId && row.teacherId === draft.teacherId && hasParticipantOverlap) {
        messages.push(`講師重複: ${teacherNameById[row.teacherId] ?? '講師未設定'} が ${resolveDayLabel(row.dayOfWeek)} ${row.slotNumber}限 に既に入っています。`)
      }

      const duplicatedStudents = draftParticipants
        .filter((draftParticipant) => rowParticipants.some((rowParticipant) => (
          rowParticipant.studentId === draftParticipant.studentId
          && doRegularLessonParticipantPeriodsOverlap(draftWithSchoolYear, row)
        )))
        .map((participant) => participant.studentId)
      if (duplicatedStudents.length > 0) {
        messages.push(`生徒重複: ${Array.from(new Set(duplicatedStudents)).map((studentId) => studentNameById[studentId] ?? '生徒未設定').join(' / ')} が ${resolveDayLabel(row.dayOfWeek)} ${row.slotNumber}限 に既に入っています。`)
      }

      return messages
    })
}

function createRegularLessonDraft() {
  return {
    teacherId: '',
    student1Id: '',
    subject1: '英',
    startDate: '',
    endDate: '',
    student2Id: '',
    subject2: '英',
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek: 1,
    slotNumber: 1,
  }
}

function isDateOutsideSchoolYear(dateKey: string, schoolYear: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
  const schoolYearRange = resolveSchoolYearDateRange(schoolYear)
  return dateKey < schoolYearRange.startDate || dateKey > schoolYearRange.endDate
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

function parseDayOfWeek(value: unknown) {
  const text = normalizeText(value)
  const numeric = Number(text)
  if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 6) return numeric
  return dayOptions.find((option) => option.label === text)?.value ?? 1
}

function parseSlotNumber(value: unknown) {
  const text = normalizeText(value)
  const matched = text.match(/\d+/)
  return matched ? Number(matched[0]) : 1
}

function parseSchoolYear(value: unknown, fallback = resolveOperationalSchoolYear(new Date())) {
  const text = normalizeText(value)
  const matched = text.match(/\d{4}/)
  return matched ? Number(matched[0]) : fallback
}

export function createTemplateBundle(): BasicDataBundle {
  return {
    managers: [{ id: 'template_manager', name: '管理 太郎', email: 'manager@example.com' }],
    teachers: initialTeachers,
    students: initialStudents,
    regularLessons: createInitialRegularLessons(),
    groupLessons: [{ id: 'template_group', schoolYear: resolveOperationalSchoolYear(new Date()), teacherId: 't002', subject: '英', studentIds: ['s002', 's003'], dayOfWeek: 3, slotLabel: '2限' }],
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
    名前: row.name,
    メール: row.email,
  }))), 'マネージャー')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.teachers.map((row) => ({
    名前: row.name,
    表示名: getTeacherDisplayName(row),
    メール: row.email,
    入塾日: row.entryDate,
    退塾日: normalizeDateString(row.withdrawDate),
    表示: row.isHidden ? '非表示' : '表示',
    担当科目: serializeSubjectCapabilities(row.subjectCapabilities),
    メモ: row.memo,
  })), ['入塾日', '退塾日']), '講師')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.students.map((row) => ({
    名前: row.name,
    表示名: row.displayName,
    メール: row.email,
    入塾日: row.entryDate,
    退塾日: normalizeDateString(row.withdrawDate),
    生年月日: row.birthDate,
    表示: row.isHidden ? '非表示' : '表示',
  })), ['入塾日', '退塾日', '生年月日']), '生徒')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(
    xlsx,
    bundle.regularLessons.map((row) => {
      const sharedPeriod = normalizeRegularLessonSharedPeriod(row)
      return {
        年度: formatSchoolYearLabel(row.schoolYear),
        講師: teacherNameById[row.teacherId] ?? '',
        生徒1: studentNameById[row.student1Id] ?? '',
        科目1: row.subject1,
        共通期間開始: sharedPeriod.startDate,
        共通期間終了: sharedPeriod.endDate,
        生徒2: studentNameById[row.student2Id] ?? '',
        科目2: row.subject2,
        曜日: resolveDayLabel(row.dayOfWeek),
        時限: row.slotNumber,
      }
    }),
    ['共通期間開始', '共通期間終了'],
  ), '通常授業')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, bundle.groupLessons.map((row) => ({
    年度: formatSchoolYearLabel(row.schoolYear),
    講師: teacherNameById[row.teacherId] ?? '',
    科目: row.subject,
    生徒一覧: row.studentIds.map((studentId) => studentNameById[studentId] ?? '').filter(Boolean).join(', '),
    曜日: resolveDayLabel(row.dayOfWeek),
    時限ラベル: row.slotLabel,
  }))), '集団授業')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, [{
    休校曜日: serializeClosedWeekdays(bundle.classroomSettings.closedWeekdays),
    机数: bundle.classroomSettings.deskCount,
  }]), '教室データ')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, [
    { 項目: '講師.担当科目', 説明: '英:高3, 数:中 のように 科目:上限学年 をカンマ区切りで記入します。' },
    { 項目: '講師/生徒.入塾日', 説明: 'YYYY-MM-DD 形式に加えて Excel の日付セルも取り込めます。空欄なら即時在籍として扱います。' },
    { 項目: '講師/生徒.退塾日', 説明: 'YYYY-MM-DD または Excel の日付セルで入力できます。空欄と 未定 はどちらも日付未設定として扱います。' },
    { 項目: '生徒.生年月日', 説明: 'YYYY-MM-DD 形式または Excel の日付セルで入力できます。学年/在籍列はアプリ側で自動計算します。' },
    { 項目: '通常授業/集団授業', 説明: '年度列を付けて年度ごとに分けます。講師名と生徒名は各シートの名前列に一致させてください。' },
    { 項目: '通常授業.共通期間開始/共通期間終了', 説明: '通常授業の共有表示期間です。旧列の 期間開始/終了 と 生徒1期間開始/終了 と 生徒2期間開始/終了 も同じ期間として取り込みます。' },
    { 項目: '教室データ', 説明: '休校曜日 は 日曜, 月曜 のように曜日名をカンマ区切りで入力します。ペア制約は自動割振ルール画面の Excel 管理で扱います。' },
  ]), '説明')

  return workbook
}

export function parseImportedBundle(xlsx: XlsxModule, workbook: import('xlsx').WorkBook, fallback: BasicDataBundle): BasicDataBundle {
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
          id: createId('manager'),
          name: normalizeText(row['名前']),
          email: normalizeText(row['メール']),
        }))
        .filter((row) => row.name || row.email)
    : fallback.managers

  const teachers = teacherRows
    ? teacherRows
        .map((row) => ({
          id: createId('teacher'),
          name: normalizeText(row['名前']),
          displayName: normalizeText(row['表示名']) || deriveManagedDisplayName(normalizeText(row['名前'])),
          email: normalizeText(row['メール']),
          entryDate: normalizeDateString(row['入塾日'], xlsx),
          withdrawDate: normalizeDateString(row['退塾日'], xlsx) || normalizeText(row['退塾日']) || '未定',
          isHidden: normalizeText(row['表示']) === '非表示',
          subjectCapabilities: parseSubjectCapabilities(row['担当科目']),
          memo: normalizeText(row['メモ']),
        }))
        .filter((row) => row.name)
    : fallback.teachers

  const students = studentRows
    ? studentRows
        .map((row) => ({
          id: createId('student'),
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
  const teacherLabelById = new Map(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  const studentIdByName = new Map<string, string>()
  for (const student of students) {
    studentIdByName.set(student.name, student.id)
    if (student.displayName) studentIdByName.set(student.displayName, student.id)
  }
  const studentById = new Map(students.map((student) => [student.id, student]))

  const regularRows = readRows('通常授業')
  const regularLessons = regularRows
    ? packSortRegularLessonRows(regularRows
        .map((row) => {
          const schoolYear = parseSchoolYear(row['年度'])
          const sharedStartDate = normalizeDateString(row['共通期間開始'], xlsx) || normalizeDateString(row['期間開始'], xlsx) || normalizeDateString(row['生徒2期間開始'], xlsx) || normalizeDateString(row['生徒1期間開始'], xlsx)
          const sharedEndDate = normalizeDateString(row['共通期間終了'], xlsx) || normalizeDateString(row['期間終了'], xlsx) || normalizeDateString(row['生徒2期間終了'], xlsx) || normalizeDateString(row['生徒1期間終了'], xlsx)
          const referenceDate = sharedStartDate || resolveSchoolYearDateRange(schoolYear).startDate
          const student1Id = studentIdByName.get(normalizeText(row['生徒1'])) ?? ''
          const student2Id = studentIdByName.get(normalizeText(row['生徒2'])) ?? ''
          const subject1 = subjectOptions.includes(normalizeText(row['科目1'])) ? normalizeText(row['科目1']) : '英'
          const subject2 = subjectOptions.includes(normalizeText(row['科目2'])) ? normalizeText(row['科目2']) : ''

          return normalizeRegularLessonSharedPeriod({
            id: createId('regular'),
            schoolYear,
            teacherId: teacherIdByName.get(normalizeText(row['講師'])) ?? '',
            student1Id,
            subject1: resolveDisplayedSubjectForBirthDate(subject1, studentById.get(student1Id)?.birthDate, referenceDate),
            startDate: sharedStartDate,
            endDate: sharedEndDate,
            student2Id,
            subject2: resolveDisplayedSubjectForBirthDate(subject2, studentById.get(student2Id)?.birthDate, referenceDate),
            student2StartDate: sharedStartDate,
            student2EndDate: sharedEndDate,
            nextStudent1Id: '',
            nextSubject1: '',
            nextStudent2Id: '',
            nextSubject2: '',
            dayOfWeek: parseDayOfWeek(row['曜日']),
            slotNumber: parseSlotNumber(row['時限']),
          })
        })
        .filter((row) => row.teacherId && (row.student1Id || row.student2Id)),
      (row) => teacherLabelById.get(row.teacherId) ?? '')
    : fallback.regularLessons

  const groupRows = readRows('集団授業')
  const groupLessons = groupRows
    ? groupRows
        .map((row) => ({
          id: createId('group'),
          schoolYear: parseSchoolYear(row['年度']),
          teacherId: teacherIdByName.get(normalizeText(row['講師'])) ?? '',
          subject: subjectOptions.includes(normalizeText(row['科目'])) ? normalizeText(row['科目']) : '英',
          studentIds: normalizeText(row['生徒一覧'])
            .split(',')
            .map((entry) => studentIdByName.get(entry.trim()) ?? '')
            .filter(Boolean),
          dayOfWeek: parseDayOfWeek(row['曜日']),
          slotLabel: normalizeText(row['時限ラベル']) || '1限',
        }))
        .filter((row) => row.teacherId && row.studentIds.length > 0)
    : fallback.groupLessons

  const classroomRows = readRows('教室データ')
  const classroomSettings = classroomRows?.[0]
    ? {
        ...fallback.classroomSettings,
        closedWeekdays: parseClosedWeekdays(classroomRows[0]['休校曜日']),
        deskCount: Math.max(1, Number(classroomRows[0]['机数']) || fallback.classroomSettings.deskCount || 1),
      }
    : fallback.classroomSettings

  return {
    managers,
    teachers,
    students,
    regularLessons,
    groupLessons,
    classroomSettings,
  }
}

type SubjectCapabilityEditorProps = {
  capabilities: TeacherSubjectCapability[]
  onChange: (next: TeacherSubjectCapability[]) => void
  testIdPrefix?: string
  disabled?: boolean
}

function SubjectCapabilityEditor({ capabilities, onChange, testIdPrefix, disabled = false }: SubjectCapabilityEditorProps) {
  const [selectedSubject, setSelectedSubject] = useState(subjectOptions[0])
  const selectedCapability = capabilities.find((entry) => entry.subject === selectedSubject)
  const allowedGrades: GradeCeiling[] = selectedSubject === '算'
    ? ['小']
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
        {subjectOptions.map((subject) => (
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

type StudentPickerProps = {
  students: StudentRow[]
  selectedIds: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

function StudentPicker({ students, selectedIds, onChange, disabled = false }: StudentPickerProps) {
  return (
    <div className="basic-data-inline-picker">
      {students.map((student) => {
        const isActive = selectedIds.includes(student.id)
        return (
          <button
            key={student.id}
            type="button"
            className={`basic-data-chip${isActive ? ' active' : ''}`}
            onClick={() => onChange(isActive ? selectedIds.filter((entry) => entry !== student.id) : [...selectedIds, student.id])}
            disabled={disabled}
          >
            {getStudentOptionLabel(student)}
          </button>
        )
      })}
    </div>
  )
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

type PeriodRangeInlineProps = {
  startValue: string
  endValue: string
  startEmptyLabel: string
  endEmptyLabel: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
  startTestIdPrefix?: string
  endTestIdPrefix?: string
}

function PeriodRangeInline({ startValue, endValue, startEmptyLabel, endEmptyLabel, onStartChange, onEndChange, startTestIdPrefix, endTestIdPrefix }: PeriodRangeInlineProps) {
  return (
    <div className="basic-data-period-inline">
      <DateAssistInput value={startValue} emptyLabel={startEmptyLabel} onChange={onStartChange} testIdPrefix={startTestIdPrefix} />
      <span className="basic-data-period-inline-separator">-</span>
      <DateAssistInput value={endValue} emptyLabel={endEmptyLabel} onChange={onEndChange} testIdPrefix={endTestIdPrefix} />
    </div>
  )
}

export function BasicDataScreen({ classroomSettings, googleHolidaySyncState, isGoogleHolidayApiConfigured, managers, teachers, students, regularLessons, groupLessons, onUpdateManagers, onUpdateTeachers, onUpdateStudents, onUpdateRegularLessons, onUpdateGroupLessons, onUpdateClassroomSettings, onSyncGoogleHolidays, onBackToBoard, onOpenSpecialData, onOpenAutoAssignRules, onOpenBackupRestore }: BasicDataScreenProps) {
  const [activeTab, setActiveTab] = useState<BasicDataTab>('students')
  const [statusMessage, setStatusMessage] = useState('')
  const [centeredMessage, setCenteredMessage] = useState<string | null>(null)
  const centeredMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showCenteredMessage = (message: string) => {
    if (centeredMessageTimerRef.current) clearTimeout(centeredMessageTimerRef.current)
    setCenteredMessage(message)
    centeredMessageTimerRef.current = setTimeout(() => setCenteredMessage(null), 4000)
  }
  const currentSchoolYear = useMemo(() => resolveOperationalSchoolYear(new Date()), [])
  const selectableSchoolYears = useMemo(() => buildSelectableSchoolYears(currentSchoolYear), [currentSchoolYear])

  const [managerDraft, setManagerDraft] = useState({ name: '', email: '' })
  const [teacherDraft, setTeacherDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', memo: '', isHidden: false, subjectCapabilities: [] as TeacherSubjectCapability[] })
  const [teacherDraftExpanded, setTeacherDraftExpanded] = useState(false)
  const [studentDraft, setStudentDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', birthDate: '' })
  const [regularLessonDraft, setRegularLessonDraft] = useState(() => createRegularLessonDraft())
  const [groupLessonDraft, setGroupLessonDraft] = useState({ teacherId: '', subject: '英', studentIds: [] as string[], dayOfWeek: 1, slotLabel: '1限' })
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})
  const [regularLessonEditSnapshots, setRegularLessonEditSnapshots] = useState<Record<string, RegularLessonRow>>({})
  const [teacherRosterView, setTeacherRosterView] = useState<RosterView>('active')
  const [studentRosterView, setStudentRosterView] = useState<RosterView>('active')
  const [selectedRegularLessonYear, setSelectedRegularLessonYear] = useState(currentSchoolYear)
  const [selectedGroupLessonYear, setSelectedGroupLessonYear] = useState(currentSchoolYear)
  const [tableControls, setTableControls] = useState<Record<BasicDataTab, TableControl>>({
    managers: createDefaultTableControl(),
    teachers: createDefaultTableControl(),
    students: createDefaultTableControl(),
    regularLessons: createDefaultTableControl(),
    groupLessons: createDefaultTableControl(),
    constraints: createDefaultTableControl(),
    classroomData: createDefaultTableControl(),
  })

  const teacherNameById = useMemo(() => Object.fromEntries(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), [teachers])
  const studentNameById = useMemo(() => Object.fromEntries(students.map((student) => [student.id, getStudentDisplayName(student)])), [students])
  const todayReferenceDate = useMemo(() => getReferenceDateKey(new Date()), [])
  const activeStudentRows = useMemo(
    () => students.filter((student) => {
      const status = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, todayReferenceDate)
      return status !== '退塾' && status !== '非表示'
    }),
    [students, todayReferenceDate],
  )
  const withdrawnStudentRows = useMemo(
    () => students.filter((student) => {
      const status = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, todayReferenceDate)
      return status === '退塾' || status === '非表示'
    }),
    [students, todayReferenceDate],
  )
  const activeTeacherRows = useMemo(
    () => teachers.filter((teacher) => resolveTeacherRosterStatus(teacher, todayReferenceDate) === '在籍'),
    [teachers, todayReferenceDate],
  )
  const withdrawnTeacherRows = useMemo(
    () => teachers.filter((teacher) => {
      const status = resolveTeacherRosterStatus(teacher, todayReferenceDate)
      return status === '退塾' || status === '非表示'
    }),
    [teachers, todayReferenceDate],
  )
  const activeTeachers = useMemo(() => teachers.filter((teacher) => isTeacherActive(teacher)), [teachers])
  const activeStudents = useMemo(() => students.filter((student) => isStudentActive(student)), [students])
  const regularLessonYears = useMemo(() => selectableSchoolYears.filter((year) => year >= Math.min(...regularLessons.map((row) => row.schoolYear), currentSchoolYear - 1)), [currentSchoolYear, regularLessons, selectableSchoolYears])
  const groupLessonYears = useMemo(() => selectableSchoolYears.filter((year) => year >= Math.min(...groupLessons.map((row) => row.schoolYear), currentSchoolYear - 1)), [currentSchoolYear, groupLessons, selectableSchoolYears])
  const visibleRegularLessons = useMemo(() => regularLessons.filter((row) => row.schoolYear === selectedRegularLessonYear), [regularLessons, selectedRegularLessonYear])
  const visibleGroupLessons = useMemo(() => groupLessons.filter((row) => row.schoolYear === selectedGroupLessonYear), [groupLessons, selectedGroupLessonYear])

  useEffect(() => {
    setRegularLessonDraft(createRegularLessonDraft())
  }, [selectedRegularLessonYear])

  const rowKey = (scope: string, id: string) => `${scope}:${id}`
  const updateTableControl = (tab: BasicDataTab, patch: Partial<TableControl>) => {
    setTableControls((current) => ({ ...current, [tab]: { ...current[tab], ...patch } }))
  }
  const isRowEditing = (scope: string, id: string) => Boolean(editingRows[rowKey(scope, id)])
  const toggleRowEditing = (scope: string, id: string) => {
    const key = rowKey(scope, id)
    setEditingRows((current) => ({ ...current, [key]: !current[key] }))
  }
  const handleToggleRegularLessonEditing = (id: string) => {
    const key = rowKey('regular', id)
    const row = regularLessons.find((entry) => entry.id === id)
    if (!row) return

    if (!editingRows[key]) {
      setRegularLessonEditSnapshots((current) => ({ ...current, [id]: { ...row } }))
      setEditingRows((current) => ({ ...current, [key]: true }))
      return
    }

    const snapshot = regularLessonEditSnapshots[id]
    const restoreSnapshot = () => {
      if (!snapshot) return
      onUpdateRegularLessons((current) => current.map((entry) => (entry.id === id ? { ...snapshot } : entry)))
    }

    const normalizedRow = normalizeRegularLessonSharedPeriod(row)

    const periodValidationTargets = [
      { label: '期間開始', value: normalizedRow.startDate },
      { label: '期間終了', value: normalizedRow.endDate },
    ].filter((entry) => entry.value)

    const outOfRangeField = periodValidationTargets.find((entry) => isDateOutsideSchoolYear(entry.value, row.schoolYear))
    if (outOfRangeField) {
      const schoolYearRange = resolveSchoolYearDateRange(row.schoolYear)
      restoreSnapshot()
      showCenteredMessage(`${outOfRangeField.label} は ${row.schoolYear}年度の範囲外です。\n${schoolYearRange.startDate} ～ ${schoolYearRange.endDate} の範囲で入力してください。`)
      setStatusMessage('年度範囲外の期間があるため通常授業を保存できませんでした。')
      return
    }

    const conflicts = collectRegularLessonConflicts(
      regularLessons,
      normalizedRow,
      normalizedRow.schoolYear,
      teacherNameById,
      studentNameById,
      normalizedRow.id,
    )
    if (conflicts.length > 0) {
      restoreSnapshot()
      window.alert(['重複があるため通常授業を保存できません。', ...conflicts].join('\n'))
      setStatusMessage('重複があるため通常授業を保存できませんでした。')
      return
    }

    const addedStudents = [
      !snapshot?.student1Id && row.student1Id ? row.student1Id : '',
      !snapshot?.student2Id && row.student2Id ? row.student2Id : '',
    ].filter(Boolean)

    if (addedStudents.length > 0) {
      const addedStudentNames = addedStudents.map((studentId) => studentNameById[studentId] ?? '生徒未設定').join(' / ')
      const confirmed = window.confirm(`${addedStudentNames} を追加します。追加分は振替ストックにカウントせず、そのままコマ表へ反映します。よろしいですか。`)
      if (!confirmed) {
        setStatusMessage('通常授業の編集終了をキャンセルしました。')
        return
      }
    }

    if (
      row.startDate !== normalizedRow.startDate
      || row.endDate !== normalizedRow.endDate
      || row.student2StartDate !== normalizedRow.student2StartDate
      || row.student2EndDate !== normalizedRow.student2EndDate
    ) {
      onUpdateRegularLessons((current) => current.map((entry) => (entry.id === id ? normalizedRow : entry)))
    }

    setRegularLessonEditSnapshots((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setEditingRows((current) => ({ ...current, [key]: false }))
    setStatusMessage('通常授業を更新しました。')
  }
  const updateManager = (id: string, patch: Partial<ManagerRow>) => {
    onUpdateManagers((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const updateTeacher = (id: string, patch: Partial<TeacherRow>) => {
    onUpdateTeachers((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const updateStudent = (id: string, patch: Partial<StudentRow>) => {
    onUpdateStudents((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const updateRegularLesson = (id: string, patch: Partial<RegularLessonRow>) => {
    onUpdateRegularLessons((current) => current.map((row) => {
      if (row.id !== id) return row

      const nextRow = { ...row, ...patch }
      if ('startDate' in patch || 'endDate' in patch || 'student2StartDate' in patch || 'student2EndDate' in patch) {
        return normalizeRegularLessonSharedPeriod(nextRow)
      }
      return nextRow
    }))
  }

  const updateGroupLesson = (id: string, patch: Partial<GroupLessonRow>) => {
    onUpdateGroupLessons((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const addManager = () => {
    if (!managerDraft.name.trim()) return
    onUpdateManagers((current) => [...current, { id: createId('manager'), name: managerDraft.name.trim(), email: managerDraft.email.trim() }])
    setManagerDraft({ name: '', email: '' })
    setStatusMessage('マネージャーを追加しました。')
  }

  const addTeacher = () => {
    if (!teacherDraft.name.trim()) return
    onUpdateTeachers((current) => [
      ...current,
      {
        id: createId('teacher'),
        name: teacherDraft.name.trim(),
        displayName: teacherDraft.displayName.trim() || deriveManagedDisplayName(teacherDraft.name),
        email: teacherDraft.email.trim(),
        entryDate: teacherDraft.entryDate,
        withdrawDate: teacherDraft.withdrawDate.trim() || '未定',
        isHidden: teacherDraft.isHidden,
        subjectCapabilities: teacherDraft.subjectCapabilities,
        memo: teacherDraft.memo.trim(),
      },
    ])
    setTeacherDraft({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '未定', memo: '', isHidden: false, subjectCapabilities: [] })
    setTeacherDraftExpanded(false)
    setStatusMessage('講師を追加しました。')
  }

  const addStudent = () => {
    if (!studentDraft.name.trim()) return
    onUpdateStudents((current) => [...current, {
      id: createId('student'),
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

  const addRegularLesson = () => {
    if (!regularLessonDraft.teacherId || !regularLessonDraft.student1Id) return

    const normalizedDraft = normalizeRegularLessonSharedPeriod(regularLessonDraft)

    const periodValidationTargets = [
      { label: '期間開始', value: normalizedDraft.startDate },
      { label: '期間終了', value: normalizedDraft.endDate },
    ].filter((entry) => entry.value)

    const outOfRangeField = periodValidationTargets.find((entry) => isDateOutsideSchoolYear(entry.value, selectedRegularLessonYear))
    if (outOfRangeField) {
      const schoolYearRange = resolveSchoolYearDateRange(selectedRegularLessonYear)
      showCenteredMessage(`${outOfRangeField.label} は ${selectedRegularLessonYear}年度の範囲外です。\n${schoolYearRange.startDate} ～ ${schoolYearRange.endDate} の範囲で入力してください。`)
      setStatusMessage('年度範囲外の期間があるため通常授業を追加できませんでした。')
      return
    }

    const conflicts = collectRegularLessonConflicts(
      regularLessons,
      normalizedDraft,
      selectedRegularLessonYear,
      teacherNameById,
      studentNameById,
    )
    if (conflicts.length > 0) {
      window.alert(['重複があるため通常授業を追加できません。', ...conflicts].join('\n'))
      setStatusMessage('重複があるため通常授業を追加できませんでした。')
      return
    }
    const confirmed = window.confirm([
      'この通常授業をコマ表に反映します。該当箇所がすでに埋まっている場合は振替ストックに蓄積します',
    ].filter(Boolean).join('\n\n'))
    if (!confirmed) {
      setStatusMessage('通常授業の追加をキャンセルしました。')
      return
    }

    onUpdateRegularLessons((current) => [
      ...current,
      {
        id: createId('regular'),
        schoolYear: selectedRegularLessonYear,
        ...normalizedDraft,
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
      },
    ])
    setRegularLessonDraft(createRegularLessonDraft())
    setStatusMessage('通常授業を追加しました。')
  }

  const addGroupLesson = () => {
    if (!groupLessonDraft.teacherId || groupLessonDraft.studentIds.length === 0) return
    onUpdateGroupLessons((current) => [...current, { id: createId('group'), schoolYear: selectedGroupLessonYear, ...groupLessonDraft }])
    setStatusMessage('集団授業を追加しました。')
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

  const removeRegularLesson = (id: string) => {
    if (!window.confirm('この通常授業を削除します。よろしいですか。')) {
      setStatusMessage('通常授業の削除をキャンセルしました。')
      return
    }
    onUpdateRegularLessons((current) => current.filter((row) => row.id !== id))
    setStatusMessage('通常授業を削除しました。')
  }

  const removeGroupLesson = (id: string) => {
    if (!window.confirm('この集団授業を削除します。よろしいですか。')) {
      setStatusMessage('集団授業の削除をキャンセルしました。')
      return
    }
    onUpdateGroupLessons((current) => current.filter((row) => row.id !== id))
    setStatusMessage('集団授業を削除しました。')
  }

  const renderManagers = () => (
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
            {filterAndSortRows(
              managers,
              tableControls.managers,
              (row) => [row.name, row.email],
              { name: (row) => row.name, email: (row) => row.email },
            ).length === 0 ? <tr><td colSpan={3} className="basic-data-empty-row">登録済みマネージャーはありません。</td></tr> : filterAndSortRows(
              managers,
              tableControls.managers,
              (row) => [row.name, row.email],
              { name: (row) => row.name, email: (row) => row.email },
            ).map((row) => (
              <tr key={row.id}>
                <td><input value={row.name} onChange={(event) => updateManager(row.id, { name: event.target.value })} disabled={!isRowEditing('manager', row.id)} /></td>
                <td><input value={row.email} onChange={(event) => updateManager(row.id, { email: event.target.value })} type="email" disabled={!isRowEditing('manager', row.id)} /></td>
                <td>
                  <div className="basic-data-row-actions">
                    <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('manager', row.id)}>{isRowEditing('manager', row.id) ? '編集終了' : '編集'}</button>
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

  const renderTeachers = () => {
    const visibleTeachers = teacherRosterView === 'active' ? activeTeacherRows : withdrawnTeacherRows
    const filteredTeachers = filterAndSortRows(
      visibleTeachers,
      tableControls.teachers,
      (row) => [row.name, getTeacherDisplayName(row), row.email, row.entryDate, row.withdrawDate, resolveTeacherStatusLabel(row), formatSubjectCapabilitySummary(row.subjectCapabilities), row.memo],
      {
        name: (row) => getTeacherDisplayName(row),
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(row.withdrawDate),
        status: (row) => resolveTeacherStatusLabel(row),
        subjects: (row) => formatSubjectCapabilitySummary(row.subjectCapabilities),
      },
    )

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
                onClick={() => setTeacherDraftExpanded((current) => !current)}
                data-testid="basic-data-teacher-draft-capabilities-summary"
              >
                <span className="basic-data-inline-summary-label">科目</span>
                <strong>{formatSubjectCapabilitySummary(teacherDraft.subjectCapabilities)}</strong>
              </button>
              {teacherDraftExpanded ? (
                <div className="basic-data-inline-editor basic-data-inline-editor-teacher">
                  <SubjectCapabilityEditor
                    capabilities={teacherDraft.subjectCapabilities}
                    onChange={(next) => setTeacherDraft((current) => ({ ...current, subjectCapabilities: next }))}
                    testIdPrefix="basic-data-teacher-draft"
                  />
                </div>
              ) : null}
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
              {filteredTeachers.map((row) => (
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
                      ? <SubjectCapabilityEditor capabilities={row.subjectCapabilities} onChange={(next) => updateTeacher(row.id, { subjectCapabilities: next })} />
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-teacher-capabilities-${row.id}`}>{formatSubjectCapabilitySummary(row.subjectCapabilities)}</span>}
                  </td>
                  <td>
                    {isRowEditing('teacher', row.id)
                      ? <input value={row.memo} onChange={(event) => updateTeacher(row.id, { memo: event.target.value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.memo)}</span>}
                  </td>
                  <td>
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('teacher', row.id)} data-testid={`basic-data-edit-teacher-${row.id}`}>{isRowEditing('teacher', row.id) ? '編集終了' : '編集'}</button>
                      <button className="secondary-button slim" type="button" onClick={() => removeTeacher(row.id)}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTeachers.length === 0 ? <tr><td colSpan={9} className="basic-data-empty-row">{teacherRosterView === 'active' ? '在籍講師はまだありません。' : '退塾講師はまだありません。'}</td></tr> : null}
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
        name: (row) => getStudentDisplayName(row),
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(row.withdrawDate),
        birthDate: (row) => row.birthDate,
        status: (row) => resolveStudentStatusLabel(row),
      },
    )

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
              {filteredStudents.map((row) => (
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
                      <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('student', row.id)} data-testid={`basic-data-edit-student-${row.id}`}>{isRowEditing('student', row.id) ? '編集終了' : '編集'}</button>
                      <button className="secondary-button slim" type="button" onClick={() => removeStudent(row.id)}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 ? <tr><td colSpan={8} className="basic-data-empty-row">{studentRosterView === 'active' ? '在籍生徒はまだありません。' : '退塾生徒はまだありません。'}</td></tr> : null}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  const renderRegularLessons = () => (
    <>
      <section className="basic-data-section-card">
        <div className="basic-data-card-head">
          <h3>通常授業管理</h3>
        </div>
        <div className="basic-data-regular-draft-grid">
          <label className="basic-data-stack-field basic-data-stack-field-year">
            <span>年度</span>
            <select value={String(selectedRegularLessonYear)} onChange={(event) => setSelectedRegularLessonYear(Number(event.target.value))} data-testid="basic-data-regular-year-select">
              {regularLessonYears.map((schoolYear) => <option key={schoolYear} value={schoolYear}>{formatSchoolYearLabel(schoolYear)}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field basic-data-stack-field-compact">
            <span>講師</span>
            <select value={regularLessonDraft.teacherId} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, teacherId: event.target.value }))} data-testid="basic-data-regular-draft-teacher">
              <option value="">講師未割当</option>
              {activeTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{getTeacherOptionLabel(teacher)}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field">
            <span>生徒1</span>
            <select value={regularLessonDraft.student1Id} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, student1Id: event.target.value }))} data-testid="basic-data-regular-draft-student1">
              <option value="">生徒1を選択</option>
              {activeStudents.map((student) => <option key={student.id} value={student.id}>{getStudentOptionLabel(student)}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field basic-data-stack-field-subject">
            <span>科目1</span>
            <select value={regularLessonDraft.subject1} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, subject1: event.target.value }))} data-testid="basic-data-regular-draft-subject1">
              {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field">
            <span>生徒2</span>
            <select value={regularLessonDraft.student2Id} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, student2Id: event.target.value }))} data-testid="basic-data-regular-draft-student2">
              <option value="">生徒2(任意)</option>
              {activeStudents.map((student) => <option key={student.id} value={student.id}>{getStudentOptionLabel(student)}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field basic-data-stack-field-subject">
            <span>科目2</span>
            <select value={regularLessonDraft.subject2} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, subject2: event.target.value }))} data-testid="basic-data-regular-draft-subject2">
              {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field basic-data-stack-field-day">
            <span>曜日</span>
            <select value={String(regularLessonDraft.dayOfWeek)} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, dayOfWeek: Number(event.target.value) }))} data-testid="basic-data-regular-draft-day">
              {dayOptions.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
            </select>
          </label>
          <label className="basic-data-stack-field basic-data-stack-field-slot">
            <span>時限</span>
            <input type="number" min="1" value={regularLessonDraft.slotNumber} onChange={(event) => setRegularLessonDraft((current) => ({ ...current, slotNumber: Number(event.target.value) }))} placeholder="時限番号" data-testid="basic-data-regular-draft-slot-number" />
          </label>
          <div className="basic-data-stack-field basic-data-stack-field-period">
            <span>期間</span>
            <PeriodRangeInline
              startValue={regularLessonDraft.startDate}
              endValue={regularLessonDraft.endDate}
              startEmptyLabel={resolveSchoolYearDateRange(selectedRegularLessonYear).startDate}
              endEmptyLabel={resolveSchoolYearDateRange(selectedRegularLessonYear).endDate}
              onStartChange={(value) => setRegularLessonDraft((current) => ({ ...current, ...buildSharedRegularLessonPeriodPatch(value, current.endDate) }))}
              onEndChange={(value) => setRegularLessonDraft((current) => ({ ...current, ...buildSharedRegularLessonPeriodPatch(current.startDate, value) }))}
              startTestIdPrefix="basic-data-regular-draft-start"
              endTestIdPrefix="basic-data-regular-draft-end"
            />
          </div>
          <div className="basic-data-stack-field basic-data-stack-field-action">
            <span>&nbsp;</span>
            <button className="primary-button" type="button" onClick={addRegularLesson} data-testid="basic-data-add-regular-lesson-button">追加</button>
          </div>
        </div>
      </section>
      <section className="basic-data-section-card">
        <div className="basic-data-section-header">
          <div className="basic-data-year-toolbar basic-data-year-toolbar-start" data-testid="basic-data-regular-year-toolbar">
            {regularLessonYears.map((schoolYear) => (
              <button
                key={schoolYear}
                type="button"
                className={`basic-data-chip${selectedRegularLessonYear === schoolYear ? ' active' : ''}`}
                onClick={() => setSelectedRegularLessonYear(schoolYear)}
                data-testid={`basic-data-regular-year-${schoolYear}`}
              >
                {formatSchoolYearLabel(schoolYear)}
              </button>
            ))}
          </div>
        </div>
        <TableControls
          filterValue={tableControls.regularLessons.filterText}
          sortKey={tableControls.regularLessons.sortKey}
          direction={tableControls.regularLessons.direction}
          filterPlaceholder="講師・生徒1・生徒2・科目で絞り込み"
          sortOptions={[
            { value: 'teacher', label: '講師' },
            { value: 'student1', label: '生徒1' },
            { value: 'subject1', label: '生徒1科目' },
            { value: 'student2', label: '生徒2' },
            { value: 'subject2', label: '生徒2科目' },
            { value: 'day', label: '曜日' },
            { value: 'slot', label: '時限' },
          ]}
          onFilterChange={(value) => updateTableControl('regularLessons', { filterText: value })}
          onSortKeyChange={(value) => updateTableControl('regularLessons', { sortKey: value })}
          onDirectionChange={(value) => updateTableControl('regularLessons', { direction: value })}
        />
        <table className="basic-data-table regular-table" data-testid="basic-data-regular-lessons-table">
          <thead><tr><th>講師</th><th>生徒1</th><th>生徒1科目</th><th>生徒2</th><th>生徒2科目</th><th>曜日</th><th>時限</th><th>期間</th><th>操作</th></tr></thead>
          <tbody>
            {filterAndSortRows(
              visibleRegularLessons,
              tableControls.regularLessons,
              (row) => [teacherNameById[row.teacherId] ?? '', studentNameById[row.student1Id] ?? '', row.subject1, studentNameById[row.student2Id] ?? '', row.subject2, resolveDayLabel(row.dayOfWeek), row.slotNumber],
              {
                teacher: (row) => teacherNameById[row.teacherId] ?? '',
                student1: (row) => studentNameById[row.student1Id] ?? '',
                subject1: (row) => row.subject1,
                student2: (row) => studentNameById[row.student2Id] ?? '',
                subject2: (row) => row.subject2,
                day: (row) => resolveDayLabel(row.dayOfWeek),
                slot: (row) => row.slotNumber,
              },
            ).map((row) => (
              <tr key={row.id} data-testid={`basic-data-regular-row-${row.id}`}>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={row.teacherId} onChange={(event) => updateRegularLesson(row.id, { teacherId: event.target.value })}>
                          <option value="">講師未割当</option>
                          {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{getTeacherOptionLabel(teacher)}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{formatSummaryValue(teacherNameById[row.teacherId] ?? '', '講師未割当')}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={row.student1Id} onChange={(event) => updateRegularLesson(row.id, { student1Id: event.target.value })}>
                          <option value="">生徒1を選択</option>
                          {students.map((student) => <option key={student.id} value={student.id}>{getStudentOptionLabel(student)}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{formatRegularLessonParticipantSummary(studentNameById[row.student1Id] ?? '', row.subject1, '生徒1未設定')}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={row.subject1} onChange={(event) => updateRegularLesson(row.id, { subject1: event.target.value })}>
                          {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{formatSummaryValue(row.subject1)}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={row.student2Id} onChange={(event) => updateRegularLesson(row.id, { student2Id: event.target.value })}>
                          <option value="">生徒2(任意)</option>
                          {students.map((student) => <option key={student.id} value={student.id}>{getStudentOptionLabel(student)}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{formatRegularLessonParticipantSummary(studentNameById[row.student2Id] ?? '', row.subject2, '生徒2なし')}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={row.subject2} onChange={(event) => updateRegularLesson(row.id, { subject2: event.target.value })}>
                          <option value="">未設定</option>
                          {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{formatSummaryValue(row.subject2)}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <select value={String(row.dayOfWeek)} onChange={(event) => updateRegularLesson(row.id, { dayOfWeek: Number(event.target.value) })}>
                          {dayOptions.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                        </select>
                      )
                    : <span className="basic-data-static-field">{resolveDayLabel(row.dayOfWeek)}</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? <input type="number" min="1" value={row.slotNumber} onChange={(event) => updateRegularLesson(row.id, { slotNumber: Number(event.target.value) || 1 })} />
                    : <span className="basic-data-static-field">{row.slotNumber}限</span>}
                </td>
                <td>
                  {isRowEditing('regular', row.id)
                    ? (
                        <PeriodRangeInline
                          startValue={row.startDate}
                          endValue={row.endDate}
                          startEmptyLabel={resolveSchoolYearDateRange(row.schoolYear).startDate}
                          endEmptyLabel={resolveSchoolYearDateRange(row.schoolYear).endDate}
                          onStartChange={(value) => updateRegularLesson(row.id, buildSharedRegularLessonPeriodPatch(value, row.endDate))}
                          onEndChange={(value) => updateRegularLesson(row.id, buildSharedRegularLessonPeriodPatch(row.startDate, value))}
                          startTestIdPrefix={`basic-data-regular-period-start-${row.id}`}
                          endTestIdPrefix={`basic-data-regular-period-end-${row.id}`}
                        />
                      )
                    : <span className="basic-data-static-field basic-data-period-summary-field">{formatRegularLessonPeriodSummary(row.startDate, row.endDate, row.schoolYear)}</span>}
                </td>
                <td>
                  <div className="basic-data-row-actions basic-data-row-actions-wrap">
                    <button className="secondary-button slim" type="button" onClick={() => handleToggleRegularLessonEditing(row.id)}>{isRowEditing('regular', row.id) ? '編集終了' : '編集'}</button>
                    <button className="secondary-button slim" type="button" onClick={() => removeRegularLesson(row.id)}>削除</button>
                  </div>
                </td>
              </tr>
            ))}
            {filterAndSortRows(
              visibleRegularLessons,
              tableControls.regularLessons,
              (row) => [teacherNameById[row.teacherId] ?? '', studentNameById[row.student1Id] ?? '', row.subject1, studentNameById[row.student2Id] ?? '', row.subject2, resolveDayLabel(row.dayOfWeek), row.slotNumber],
              {
                teacher: (row) => teacherNameById[row.teacherId] ?? '',
                student1: (row) => studentNameById[row.student1Id] ?? '',
                subject1: (row) => row.subject1,
                student2: (row) => studentNameById[row.student2Id] ?? '',
                subject2: (row) => row.subject2,
                day: (row) => resolveDayLabel(row.dayOfWeek),
                slot: (row) => row.slotNumber,
              },
            ).length === 0 ? <tr><td colSpan={9} className="basic-data-empty-row">{formatSchoolYearLabel(selectedRegularLessonYear)} の通常授業はまだありません。</td></tr> : null}
          </tbody>
        </table>
      </section>
    </>
  )

  const renderGroupLessons = () => (
    <>
      <section className="basic-data-section-card">
        <div className="basic-data-card-head">
          <h3>集団授業設定</h3>
        </div>
        <div className="basic-data-form-row wrap">
          <select value={groupLessonDraft.teacherId} onChange={(event) => setGroupLessonDraft((current) => ({ ...current, teacherId: event.target.value }))} data-testid="basic-data-group-draft-teacher">
            <option value="">講師未割当</option>
            {activeTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{getTeacherOptionLabel(teacher)}</option>)}
          </select>
          <select value={String(selectedGroupLessonYear)} onChange={(event) => setSelectedGroupLessonYear(Number(event.target.value))} data-testid="basic-data-group-year-select">
            {groupLessonYears.map((schoolYear) => <option key={schoolYear} value={schoolYear}>{formatSchoolYearLabel(schoolYear)}</option>)}
          </select>
          <select value={groupLessonDraft.subject} onChange={(event) => setGroupLessonDraft((current) => ({ ...current, subject: event.target.value }))} data-testid="basic-data-group-draft-subject">
            {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
          </select>
          <select value={String(groupLessonDraft.dayOfWeek)} onChange={(event) => setGroupLessonDraft((current) => ({ ...current, dayOfWeek: Number(event.target.value) }))} data-testid="basic-data-group-draft-day">
            {dayOptions.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </select>
          <input value={groupLessonDraft.slotLabel} onChange={(event) => setGroupLessonDraft((current) => ({ ...current, slotLabel: event.target.value }))} placeholder="1限" data-testid="basic-data-group-draft-slot-label" />
          <button className="primary-button" type="button" onClick={addGroupLesson} data-testid="basic-data-add-group-lesson-button">追加</button>
        </div>
        <div className="basic-data-checkbox-panel">
          <StudentPicker students={activeStudents} selectedIds={groupLessonDraft.studentIds} onChange={(next) => setGroupLessonDraft((current) => ({ ...current, studentIds: next }))} />
        </div>
      </section>
      <section className="basic-data-section-card">
        <div className="basic-data-section-header">
          <div className="basic-data-year-toolbar basic-data-year-toolbar-start" data-testid="basic-data-group-year-toolbar">
            {groupLessonYears.map((schoolYear) => (
              <button
                key={schoolYear}
                type="button"
                className={`basic-data-chip${selectedGroupLessonYear === schoolYear ? ' active' : ''}`}
                onClick={() => setSelectedGroupLessonYear(schoolYear)}
                data-testid={`basic-data-group-year-${schoolYear}`}
              >
                {formatSchoolYearLabel(schoolYear)}
              </button>
            ))}
          </div>
        </div>
        <TableControls
          filterValue={tableControls.groupLessons.filterText}
          sortKey={tableControls.groupLessons.sortKey}
          direction={tableControls.groupLessons.direction}
          filterPlaceholder="講師・科目・生徒で絞り込み"
          sortOptions={[{ value: 'teacher', label: '講師' }, { value: 'subject', label: '科目' }, { value: 'day', label: '曜日' }, { value: 'slot', label: '時限' }]}
          onFilterChange={(value) => updateTableControl('groupLessons', { filterText: value })}
          onSortKeyChange={(value) => updateTableControl('groupLessons', { sortKey: value })}
          onDirectionChange={(value) => updateTableControl('groupLessons', { direction: value })}
        />
        <div className="basic-data-section-header">
          <div className="basic-data-card-head">
            <h3>授業データ一覧</h3>
            <p>集団授業も年度タブで切り替えて確認します。</p>
          </div>
        </div>
        <table className="basic-data-table" data-testid="basic-data-group-lessons-table">
          <thead><tr><th>講師</th><th>科目</th><th>生徒</th><th>曜日</th><th>時限</th><th>操作</th></tr></thead>
          <tbody>
            {filterAndSortRows(
              visibleGroupLessons,
              tableControls.groupLessons,
              (row) => [teacherNameById[row.teacherId] ?? '', row.subject, row.studentIds.map((studentId) => studentNameById[studentId] ?? '').join(','), resolveDayLabel(row.dayOfWeek), row.slotLabel],
              {
                teacher: (row) => teacherNameById[row.teacherId] ?? '',
                subject: (row) => row.subject,
                day: (row) => resolveDayLabel(row.dayOfWeek),
                slot: (row) => row.slotLabel,
              },
            ).length === 0 ? <tr><td colSpan={6} className="basic-data-empty-row">{formatSchoolYearLabel(selectedGroupLessonYear)} の集団授業はまだありません。</td></tr> : filterAndSortRows(
              visibleGroupLessons,
              tableControls.groupLessons,
              (row) => [teacherNameById[row.teacherId] ?? '', row.subject, row.studentIds.map((studentId) => studentNameById[studentId] ?? '').join(','), resolveDayLabel(row.dayOfWeek), row.slotLabel],
              {
                teacher: (row) => teacherNameById[row.teacherId] ?? '',
                subject: (row) => row.subject,
                day: (row) => resolveDayLabel(row.dayOfWeek),
                slot: (row) => row.slotLabel,
              },
            ).map((row) => (
              <tr key={row.id}>
                <td>
                  <select value={row.teacherId} onChange={(event) => updateGroupLesson(row.id, { teacherId: event.target.value })} disabled={!isRowEditing('group', row.id)}>
                    <option value="">講師未割当</option>
                    {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{getTeacherOptionLabel(teacher)}</option>)}
                  </select>
                </td>
                <td>
                  <select value={row.subject} onChange={(event) => updateGroupLesson(row.id, { subject: event.target.value })} disabled={!isRowEditing('group', row.id)}>
                    {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                </td>
                <td><StudentPicker students={students} selectedIds={row.studentIds} onChange={(next) => updateGroupLesson(row.id, { studentIds: next })} disabled={!isRowEditing('group', row.id)} /></td>
                <td>
                  <select value={String(row.dayOfWeek)} onChange={(event) => updateGroupLesson(row.id, { dayOfWeek: Number(event.target.value) })} disabled={!isRowEditing('group', row.id)}>
                    {dayOptions.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                  </select>
                </td>
                <td><input value={row.slotLabel} onChange={(event) => updateGroupLesson(row.id, { slotLabel: event.target.value })} disabled={!isRowEditing('group', row.id)} /></td>
                <td><div className="basic-data-row-actions"><button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('group', row.id)}>{isRowEditing('group', row.id) ? '編集終了' : '編集'}</button><button className="secondary-button slim" type="button" onClick={() => removeGroupLesson(row.id)}>削除</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )

  const renderClassroomData = () => (
    <section className="basic-data-section-card" data-testid="basic-data-classroom-screen">
      <div className="basic-data-card-head">
        <h3>教室データ</h3>
      </div>
      <div className="basic-data-inline-stack">
        <div className="basic-data-editor-block basic-data-inline-stack">
          <div className="basic-data-classroom-sync-row">
            <div className="basic-data-inline-stack">
              <strong>Google公開祝日同期</strong>
              <p className="basic-data-subcopy" data-testid="basic-data-classroom-google-holiday-status">{googleHolidaySyncState.message}</p>
              <p className="basic-data-subcopy">最終同期: {formatSyncTimestamp(classroomSettings.googleHolidayCalendarLastSyncedAt ?? '')}</p>
            </div>
            <button
              type="button"
              className="secondary-button slim"
              onClick={onSyncGoogleHolidays}
              disabled={!isGoogleHolidayApiConfigured || googleHolidaySyncState.status === 'syncing'}
              data-testid="basic-data-classroom-google-holiday-sync-button"
            >
              今すぐ同期
            </button>
          </div>
        </div>
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
    { key: 'regularLessons', label: '通常授業' },
    { key: 'groupLessons', label: '集団授業' },
    { key: 'managers', label: 'マネージャー' },
    { key: 'classroomData', label: '教室データ' },
  ]

  return (
    <div className="page-shell page-shell-basic-data">
      {centeredMessage ? (
        <div className="status-banner status-banner-floating" data-testid="center-status-banner" role="status" aria-live="polite" style={{ whiteSpace: 'pre-line' }}>
          {centeredMessage}
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
            {activeTab === 'regularLessons' ? renderRegularLessons() : null}
            {activeTab === 'groupLessons' ? renderGroupLessons() : null}
            {activeTab === 'managers' ? renderManagers() : null}
            {activeTab === 'classroomData' ? renderClassroomData() : null}
          </div>
        </section>
      </main>
    </div>
  )
}