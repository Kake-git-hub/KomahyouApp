import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import type { ClassroomSettings } from '../../types/appState'
import {
  compareManagedStudentsByGradeThenName,
  deriveManagedDisplayName,
  type GradeCeiling,
  type ManagerRow,
  resolveManagedRosterStatus,
  resolveManagedStudentGradeLabel,
  resolveManagedStudentGradeSortValue,
  buildManagedStudentNameSortValue,
  resolveEffectiveManagedWithdrawDate,
  type StudentRow,
  type TeacherRow,
  type TeacherSubjectCapability,
  formatManagedDateValue,
  getReferenceDateKey,
  getStudentDisplayName,
  getTeacherDisplayName,
  initialStudents,
  initialTeachers,
  isExternalStudentRow,
  isTeacherVisibleInManagement,
  parseExternalStudentFlag,
} from './basicDataModel'
import {
  normalizeRegularLessonNote,
} from './regularLessonModel'
import { normalizeRegularLessonTemplate, parseRegularLessonTemplateWorkbook } from '../regular-template/regularLessonTemplate'
import { buildDeleteConfirmation, type DeleteScope, type StudentDeletionStock, type StudentDeletionStockSummary } from './deleteGuard'
import { applyStudentWithdrawToday, buildStudentWithdrawConfirmation, canDeleteStudentFromApp, canWithdrawStudentToday, filterStudentsVisibleInBasicData, isStudentInWithdrawnRosterList, isStudentRowLockedByWithdrawal, markStudentDeletedFromApp } from './withdrawGuard'
import { AppMenu } from '../navigation/AppMenu'
import { buildParentPortalUrl } from '../../utils/scheduleQrConfig'
import { generateQrSvg } from '../../utils/qrcode'
import { isParentPortalTokenOwnedByClassroom } from '../../utils/developmentClassroom'
import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrPrintHtml, openParentPortalQrPrint, resolveParentPortalQrRowState } from './parentPortalQr'
import { ParentPortalQrModal } from './ParentPortalQrModal'

type BasicDataScreenProps = {
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  onUpdateTeachers: Dispatch<SetStateAction<TeacherRow[]>>
  onUpdateStudents: Dispatch<SetStateAction<StudentRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  // 未消化の講習/振替が残る生徒ID→残数（削除確認で誤削除を警告する）。
  studentDeletionStockSummary?: StudentDeletionStockSummary
  // 削除時にログインアカウントのパスワード再認証を要求するか（本番=firebase のみ true）。
  requiresDeletePassword?: boolean
  onVerifyDeletePassword?: (password: string) => Promise<boolean>
  // 保護者向け固定QR(docs/spec-parent-portal.md §K-6)。classroomId は写しトークンの発行元教室タグに使う。
  classroomId?: string | null
  classroomName?: string
  // フラグ parentPortalQr(featureRollout)の評価結果。OFF の教室では QR ボタン・モーダルを一切出さない(§H)。
  parentPortalQrEnabled?: boolean
  /**
   * フラグ studentWithdrawAutoSweep(featureRollout・開発用教室限定で先行・2026-09-21)の評価結果。
   * この画面では**退塾確認モーダルの本文の出し分けだけ**に使う(OFF の教室では今日以降のコマ・記録は消えないので、
   * 「消えます」と案内すると事実と食い違う)。「退塾生徒」への改名・退塾後の行ロック・削除文言・Excel 取り込みの
   * 退塾済み行ガードは**フラグに依らず全教室で有効**なので、ここでゲートしてはいけない。
   */
  studentWithdrawAutoSweepEnabled?: boolean
  // 保存済みデータに居る生徒 id(App が保存完了のたびに更新)。居ない生徒の QR は保存待ちのスピナーにする。null=判定しない。
  savedStudentIds?: ReadonlySet<string> | null
  // callable issueStudentPortalToken の薄い wrapper(App が workspaceKey を注入)。未指定=リモート無し(QR 非表示)。
  onIssueParentPortalToken?: (studentId: string, options: { reissue: boolean }) => Promise<{ token: string }>
  // 生徒削除の確定時に best-effort で失効させる(§B-2 revokedReason='studentDeleted')。
  onRevokeParentPortalToken?: (studentId: string, reason: 'studentDeleted') => Promise<void>
  // ★盤面の痕跡消し(退塾スイープ)の依頼 prop は撤去した(オーナー確定 2026-09-20 夜)。退塾ボタンでも日付入力でも
  //   「退塾日が入った名簿」を保存するだけで、盤面側が退塾済みの生徒を検出して掃除する
  //   (collectStudentWithdrawSweepTargets)。この画面から盤面へ命令を送る経路は作らない(二重経路にしない)。
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

type BasicDataTab = 'teachers' | 'students' | 'constraints' | 'classroomData'
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
// spec-auto-assign-rules §G / ⑧TODO4: グループ授業(班)は編集UIが無く画面不可視。
// サンプル種データは空にする（型・スナップショット配管は残す＝2026-06-09 オーナー判断）。
export const initialGroupLessons: GroupLessonRow[] = []

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
    担当科目: serializeSubjectCapabilities(row.subjectCapabilities),
  })), ['入塾日', '退塾日']), '講師')

  // 削除済み(deletedAt)の生徒はアプリ上から消した扱いなので Excel にも出さない(データは保存側に残る)。
  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, filterStudentsVisibleInBasicData(bundle.students).map((row) => ({
    生徒ID: row.id,
    名前: row.name,
    表示名: row.displayName,
    メール: row.email,
    入塾日: row.entryDate,
    退塾日: normalizeDateString(row.withdrawDate),
    生年月日: row.birthDate,
    外部生: isExternalStudentRow(row) ? 'はい' : '',
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
    { 項目: '講師/生徒.入塾日', 説明: 'YYYY-MM-DD 形式に加えて Excel の日付セルも取り込めます。空欄なら即時在籍として扱います。' },
    { 項目: '講師/生徒.退塾日', 説明: 'YYYY-MM-DD または Excel の日付セルで入力できます。空欄と 未定 はどちらも日付未設定として扱います。' },
    { 項目: '生徒.生年月日', 説明: 'YYYY-MM-DD 形式または Excel の日付セルで入力できます。学年/在籍列はアプリ側で自動計算します。' },
    { 項目: '生徒.外部生', 説明: 'はい / ○ / 1 / true のいずれかで外部生になります。空欄は通常の在籍生徒です。外部生はコマ表の授業区分表記が 外) になります(集計は従来どおり)。' },
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
          subjectCapabilities: parseSubjectCapabilities(row['担当科目']),
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
          isExternal: parseExternalStudentFlag(row['外部生']),
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

// 一致行の保護者用トークン写し(parentPortalToken + 発行元教室タグ)だけを取り出す。未発行なら空オブジェクト
// (undefined キーを作らない: 既存の toEqual 比較と Firestore 保存 payload を汚さない)。
function pickParentPortalTokenFields(matched: StudentRow | null | undefined): Pick<StudentRow, 'parentPortalToken' | 'parentPortalTokenClassroomId'> {
  if (!matched?.parentPortalToken) return {}
  return matched.parentPortalTokenClassroomId
    ? { parentPortalToken: matched.parentPortalToken, parentPortalTokenClassroomId: matched.parentPortalTokenClassroomId }
    : { parentPortalToken: matched.parentPortalToken }
}

// 高3卒業の退塾日 自動入力の印(graduationWithdrawAutoFilledAt)も Excel の列に無いので、差分取込で一致行を
// 丸ごと置き換えると消える。消えると「1 人 1 回だけ」が壊れ、室長が退塾日を消した生徒へ 3/31 が**もう一度**
// 入る(applyGraduationWithdrawAutoFill の唯一のブレーキがこの印)。トークン写しと同じ扱いで引き継ぐ
// (未設定なら空オブジェクト＝undefined キーを作らない)。
function pickGraduationWithdrawAutoFillFields(matched: StudentRow | null | undefined): Pick<StudentRow, 'graduationWithdrawAutoFilledAt'> {
  return matched?.graduationWithdrawAutoFilledAt ? { graduationWithdrawAutoFilledAt: matched.graduationWithdrawAutoFilledAt } : {}
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
  // 削除済み(deletedAt)の生徒は取込で一致させない・上書きしない(アプリ上から消した行を復活させない)。
  // 取込行の ID が削除済みの行と同じなら、新しい ID を振って別の生徒として追加する(ID は再利用しない)。
  const matchableStudents = filterStudentsVisibleInBasicData(fallback.students)
  const deletedStudentIds = new Set(fallback.students.filter((row) => !matchableStudents.includes(row)).map((row) => row.id))
  const studentIdAllocator = createManagedIdAllocator('student', [...fallback.students, ...imported.students].map((row) => row.id))
  for (const importedStudent of imported.students) {
    const matchedStudent = findStudentMatch(importedStudent, matchableStudents)
    // 保護者用トークンの写し(spec-parent-portal.md §J-3)は Excel の列に無い(buildWorkbook にも出さない)ため、
    // 差分取込で一致行を丸ごと置き換えると消える。一致行から発行元教室タグと対で引き継ぐ。
    const candidateId = matchedStudent?.id ?? importedStudent.id
    const nextStudent = {
      ...importedStudent,
      ...pickParentPortalTokenFields(matchedStudent),
      ...pickGraduationWithdrawAutoFillFields(matchedStudent),
      id: deletedStudentIds.has(candidateId) ? studentIdAllocator.next() : candidateId,
    }
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

type TeacherEditorModalState = {
  editor: 'capabilities'
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

export function BasicDataScreen({ classroomSettings, teachers, students, onUpdateTeachers, onUpdateStudents, onUpdateClassroomSettings, studentDeletionStockSummary, requiresDeletePassword = false, onVerifyDeletePassword, classroomId = null, classroomName = '', parentPortalQrEnabled = false, studentWithdrawAutoSweepEnabled = false, savedStudentIds = null, onIssueParentPortalToken, onRevokeParentPortalToken, onBackToBoard, onOpenSpecialData, onOpenAutoAssignRules, onOpenBackupRestore, onLogout }: BasicDataScreenProps) {
  const [activeTab, setActiveTab] = useState<BasicDataTab>('students')
  const [statusMessage, setStatusMessage] = useState('')
  // 保護者用QRモーダル(spec-parent-portal.md §K-6)。写し parentPortalToken は QR 描画用のキャッシュで、
  // 権威はサーバー(getOrIssue で冪等)。発行後は手動保存で写しが永続化される(保存アーキテクチャ)。
  const [parentQrModal, setParentQrModal] = useState<{ studentId: string; url: string; svg: string; isLoading: boolean; error: string | null; busy: boolean } | null>(null)
  // 削除確認モーダル（生徒/講師共通）。window.confirm を廃し、不可逆警告・退塾日での非表示案内・
  // 未消化ストック警告・ログインパスワード再認証を1画面にまとめる（オーナー指示 2026-07-08）。
  const [deleteModalState, setDeleteModalState] = useState<{ scope: DeleteScope; id: string; name: string; stock?: StudentDeletionStock } | null>(null)
  // 生徒は削除せず「退塾」(押した日を退塾日として記録・データは残す)。オーナー指示 2026-09-13・withdrawGuard.ts。
  const [withdrawModalState, setWithdrawModalState] = useState<{ id: string; name: string; currentWithdrawDate: string; stock?: StudentDeletionStock } | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)


  const [teacherDraft, setTeacherDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', subjectCapabilities: [] as TeacherSubjectCapability[] })
  const [teacherEditorModalState, setTeacherEditorModalState] = useState<TeacherEditorModalState | null>(null)
  const [studentDraft, setStudentDraft] = useState({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', birthDate: '', isExternal: false })
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})
  const [frozenRowOrders, setFrozenRowOrders] = useState<Partial<Record<RowEditScope, string[]>>>({})
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, Partial<TeacherRow>>>({})
  const teacherDraftsRef = useRef(teacherDrafts)
  // 最新値を ref に同期する定番パターン(アンマウント時の cleanup から最新ドラフトを読むため)。意図的。
  // eslint-disable-next-line react-hooks/refs
  teacherDraftsRef.current = teacherDrafts
  const onUpdateTeachersRef = useRef(onUpdateTeachers)
  // eslint-disable-next-line react-hooks/refs
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
    teachers: createDefaultTableControl(),
    students: createDefaultTableControl(),
    constraints: createDefaultTableControl(),
    classroomData: createDefaultTableControl(),
  })

  const todayReferenceDate = useMemo(() => getReferenceDateKey(new Date()), [])
  // 削除済み(deletedAt)の生徒は在籍/非在籍どちらの一覧にも出さない(データは残る)。
  const activeStudentRows = useMemo(
    () => filterStudentsVisibleInBasicData(students).filter((student) => !isStudentInWithdrawnRosterList(student, todayReferenceDate))
      .slice().sort((left, right) => compareManagedStudentsByGradeThenName(left, right, todayReferenceDate)),
    [students, todayReferenceDate],
  )
  const withdrawnStudentRows = useMemo(
    () => filterStudentsVisibleInBasicData(students).filter((student) => isStudentInWithdrawnRosterList(student, todayReferenceDate))
      .slice().sort((left, right) => compareManagedStudentsByGradeThenName(left, right, todayReferenceDate)),
    [students, todayReferenceDate],
  )
  const activeTeacherRows = useMemo(
    () => teachers.filter((teacher) => isTeacherVisibleInManagement(teacher, todayReferenceDate)),
    [teachers, todayReferenceDate],
  )
  const withdrawnTeacherRows = useMemo(
    () => teachers.filter((teacher) => resolveManagedRosterStatus(teacher.withdrawDate, '', todayReferenceDate) !== '在籍'),
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

  // --- 保護者用QR(spec-parent-portal.md §K-6) ---
  const buildParentQrView = (token: string) => {
    const url = buildParentPortalUrl(token)
    if (!url) return null
    return { url, svg: generateQrSvg(url, 220) }
  }

  const openParentPortalQr = async (row: StudentRow) => {
    if (!onIssueParentPortalToken || !classroomId) {
      setStatusMessage(PARENT_PORTAL_QR_TEXT.urlUnavailable)
      return
    }
    // 発行元教室が一致する写しがあれば、待たせないよう先にそれで描く(オフライン時のフォールバックにもなる)。
    // 他教室コピー由来・タグ無しの写しは信用しない(§B-3・b2e2048 同型の事故防止)。
    const cached = row.parentPortalToken && isParentPortalTokenOwnedByClassroom(row, classroomId)
      ? buildParentQrView(row.parentPortalToken)
      : null
    if (cached) {
      setParentQrModal({ studentId: row.id, url: cached.url, svg: cached.svg, isLoading: false, error: null, busy: false })
    } else {
      setParentQrModal({ studentId: row.id, url: '', svg: '', isLoading: true, error: null, busy: false })
    }
    // ★写しがあっても必ずサーバーへ getOrIssue を投げ、権威のトークンで描き直す(冪等・新規書き込みなし)。
    //   写しは**失効済みのトークンを指していることがある**(再発行のあとに「直前に戻す」やバックアップ復元で
    //   名簿が戻った場合)。写しだけで描くと、読み込むと 410 になる死んだQRを印刷して配ってしまう
    //   (レビュー指摘 2026-09-13)。
    try {
      const { token } = await onIssueParentPortalToken(row.id, { reissue: false })
      if (token !== row.parentPortalToken || row.parentPortalTokenClassroomId !== classroomId) {
        updateStudent(row.id, { parentPortalToken: token, parentPortalTokenClassroomId: classroomId })
        setStatusMessage(PARENT_PORTAL_QR_TEXT.issued)
      }
      const view = buildParentQrView(token)
      setParentQrModal((current) => (current && current.studentId === row.id
        ? { studentId: row.id, url: view?.url ?? '', svg: view?.svg ?? '', isLoading: false, error: view ? null : PARENT_PORTAL_QR_TEXT.urlUnavailable, busy: false }
        : current))
    } catch (error) {
      // 通信できないときは、写しで描けているならそれを残す(印刷は避けたいので注意文をエラー欄に出す)。
      if (cached) {
        const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
        setParentQrModal((current) => (current && current.studentId === row.id
          ? { ...current, isLoading: false, busy: false, error: `${PARENT_PORTAL_QR_TEXT.verifyFailed}${detail}` }
          : current))
        return
      }
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      setParentQrModal((current) => (current && current.studentId === row.id
        ? { studentId: row.id, url: '', svg: '', isLoading: false, error: `${PARENT_PORTAL_QR_TEXT.issueFailed}${detail}`, busy: false }
        : current))
    }
  }

  const reissueParentPortalQr = async () => {
    const modal = parentQrModal
    if (!modal || modal.busy || modal.isLoading || !onIssueParentPortalToken || !classroomId) return
    // 再発行は旧トークンの失効を伴う不可逆操作(§B-2)なので確認を挟む。
    if (!window.confirm(PARENT_PORTAL_QR_TEXT.reissueConfirm)) return
    setParentQrModal({ ...modal, busy: true, error: null })
    try {
      const { token } = await onIssueParentPortalToken(modal.studentId, { reissue: true })
      updateStudent(modal.studentId, { parentPortalToken: token, parentPortalTokenClassroomId: classroomId })
      const view = buildParentQrView(token)
      setParentQrModal((current) => (current && current.studentId === modal.studentId
        ? { ...current, url: view?.url ?? '', svg: view?.svg ?? '', busy: false, error: view ? null : PARENT_PORTAL_QR_TEXT.urlUnavailable }
        : current))
      setStatusMessage(PARENT_PORTAL_QR_TEXT.reissued)
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      setParentQrModal((current) => (current && current.studentId === modal.studentId
        ? { ...current, busy: false, error: `${PARENT_PORTAL_QR_TEXT.issueFailed}${detail}` }
        : current))
    }
  }

  const printParentPortalQr = () => {
    const modal = parentQrModal
    if (!modal || !modal.svg || !modal.url) return
    const student = students.find((row) => row.id === modal.studentId)
    const html = buildParentPortalQrPrintHtml({
      classroomName,
      studentName: student ? getStudentDisplayName(student) : '',
      url: modal.url,
      svg: modal.svg,
    })
    if (!openParentPortalQrPrint(html)) setStatusMessage(PARENT_PORTAL_QR_TEXT.printBlocked)
  }

  const teacherEditorModalConfig = (() => {
    if (!teacherEditorModalState) return null

    if (teacherEditorModalState.target === 'draft') {
      return {
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
    }

    const baseTeacher = teachers.find((row) => row.id === teacherEditorModalState.rowId)
    if (!baseTeacher) return null
    const targetTeacher = { ...baseTeacher, ...teacherDrafts[baseTeacher.id] }

    return {
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
  })()

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
        subjectCapabilities: teacherDraft.subjectCapabilities,
      },
    ])
    setTeacherDraft({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '未定', subjectCapabilities: [] })
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
      isExternal: studentDraft.isExternal,
    }])
    setStudentDraft({ name: '', displayName: '', email: '', entryDate: '', withdrawDate: '', birthDate: '', isExternal: false })
    setStatusMessage('生徒を追加しました。')
  }

  const removeTeacher = (id: string) => {
    const teacher = teachers.find((row) => row.id === id)
    setDeletePassword('')
    setDeleteError('')
    setDeleteModalState({ scope: 'teacher', id, name: teacher ? getTeacherDisplayName(teacher) : '' })
  }

  const removeStudent = (id: string) => {
    const student = students.find((row) => row.id === id)
    setDeletePassword('')
    setDeleteError('')
    setDeleteModalState({ scope: 'student', id, name: student ? getStudentDisplayName(student) : '', stock: studentDeletionStockSummary?.[id] })
  }

  const openStudentWithdraw = (id: string) => {
    const student = students.find((row) => row.id === id)
    setWithdrawModalState({ id, name: student ? getStudentDisplayName(student) : '', currentWithdrawDate: student?.withdrawDate ?? '', stock: studentDeletionStockSummary?.[id] })
  }

  const cancelStudentWithdraw = () => {
    setWithdrawModalState(null)
    setStatusMessage('退塾をキャンセルしました。')
  }

  const confirmStudentWithdraw = () => {
    if (!withdrawModalState) return
    // 記録する日は「押した日」。画面を開いたまま日付をまたいでも正しい日になるよう、確定時に取り直す。
    const today = getReferenceDateKey(new Date())
    onUpdateStudents((current) => applyStudentWithdrawToday(current, withdrawModalState.id, today))
    // ★盤面の痕跡(今日以降の手置きの講習・振替・増コマ・体験・手動追加・移動の席と出欠記録)は、盤面側が
    //   「退塾日を過ぎているのに痕跡が残る生徒」を検出して消す(オーナー確定 2026-09-20 夜)。ここから命令は送らない
    //   (日付入力で退塾日を入れた場合と同じ経路にするため)。未消化へは戻さない。昨日以前は触らない。
    setStatusMessage(`${withdrawModalState.name || '生徒'} を ${today} 付けで退塾にしました。`)
    setWithdrawModalState(null)
  }

  const cancelDelete = () => {
    const scope = deleteModalState?.scope
    setDeleteModalState(null)
    setDeletePassword('')
    setDeleteError('')
    setStatusMessage(scope === 'teacher' ? '講師の削除をキャンセルしました。' : '生徒の削除をキャンセルしました。')
  }

  const confirmDelete = async () => {
    if (!deleteModalState || deleteBusy) return
    const { scope, id } = deleteModalState
    if (requiresDeletePassword) {
      if (!deletePassword) {
        setDeleteError('ログイン中アカウントのパスワードを入力してください。')
        return
      }
      setDeleteBusy(true)
      const ok = onVerifyDeletePassword ? await onVerifyDeletePassword(deletePassword) : false
      setDeleteBusy(false)
      if (!ok) {
        setDeleteError('パスワードが一致しないため、削除できませんでした。')
        return
      }
    }
    if (scope === 'teacher') {
      onUpdateTeachers((current) => current.filter((row) => row.id !== id))
      setStatusMessage('講師を削除しました。')
    } else {
      // 生徒は物理削除しない(オーナー指示 2026-09-13): 非在籍一覧からだけ削除でき、行は残して削除日時を記録する。
      // ★onUpdateStudents で current.filter して行を消す実装に戻さない(withdrawGuard.test.ts が検査)。
      // 保護者用トークンの失効は best-effort(spec-parent-portal.md §B-2 revokedReason='studentDeleted')。
      // 退塾済みなのでサーバーの在籍判定でも閲覧不可だが、アプリ上から消した生徒の QR は明示的に失効させる。
      if (onRevokeParentPortalToken) {
        void onRevokeParentPortalToken(id, 'studentDeleted').catch(() => { /* best-effort */ })
      }
      onUpdateStudents((current) => markStudentDeletedFromApp(current, id, new Date().toISOString()))
      setStatusMessage('生徒を削除しました（データは記録として残ります）。')
    }
    setDeleteModalState(null)
    setDeletePassword('')
    setDeleteError('')
  }


  const renderTeachers = () => {
    const visibleTeachers = teacherRosterView === 'active' ? activeTeacherRows : withdrawnTeacherRows
    const filteredTeachers = filterAndSortRows(
      visibleTeachers,
      tableControls.teachers,
      (row) => [row.name, getTeacherDisplayName(row), row.email, row.entryDate, row.withdrawDate, resolveManagedRosterStatus(row.withdrawDate, '', todayReferenceDate), formatSubjectCapabilitySummary(row.subjectCapabilities)],
      {
        name: (row) => getTeacherDisplayName(row),
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(row.withdrawDate),
        status: (row) => resolveManagedRosterStatus(row.withdrawDate, '', todayReferenceDate),
        subjects: (row) => formatSubjectCapabilitySummary(row.subjectCapabilities),
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
            <button className="primary-button" type="button" onClick={addTeacher} data-testid="basic-data-add-teacher-button">追加</button>
          </div>
        </section>
        <section className="basic-data-section-card">
          <div className="basic-data-section-header">
            <TableControls
              filterValue={tableControls.teachers.filterText}
              sortKey={tableControls.teachers.sortKey}
              direction={tableControls.teachers.direction}
              filterPlaceholder={teacherRosterView === 'active' ? '講師名・表示名・メール・科目で絞り込み' : '非在籍講師を名前・表示名・メールで絞り込み'}
              sortOptions={[{ value: 'name', label: '表示名' }, { value: 'entryDate', label: '入塾日' }, { value: 'withdrawDate', label: '退塾日' }, { value: 'status', label: '状態' }, { value: 'subjects', label: '科目' }]}
              onFilterChange={(value) => updateTableControl('teachers', { filterText: value })}
              onSortKeyChange={(value) => updateTableControl('teachers', { sortKey: value })}
              onDirectionChange={(value) => updateTableControl('teachers', { direction: value })}
            />
            <div className="basic-data-table-visibility-toggle" data-testid="basic-data-teacher-roster-toggle">
              <button type="button" className={`basic-data-chip${teacherRosterView === 'active' ? ' active' : ''}`} onClick={() => setTeacherRosterView('active')} data-testid="basic-data-teacher-roster-active">在籍講師</button>
              <button type="button" className={`basic-data-chip${teacherRosterView === 'withdrawn' ? ' active' : ''}`} onClick={() => setTeacherRosterView('withdrawn')} data-testid="basic-data-teacher-roster-withdrawn">非在籍講師表示</button>
            </div>
          </div>
          <table className="basic-data-table" data-testid="basic-data-teachers-table">
            <thead><tr><th>氏名</th><th>表示名</th><th>メール</th><th>入塾日</th><th>退塾日</th><th>状態</th><th>科目</th><th>操作</th></tr></thead>
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
                  <td><span className="status-chip secondary" data-testid={`basic-data-teacher-status-${row.id}`}>{resolveManagedRosterStatus(row.withdrawDate, '', todayReferenceDate)}</span></td>
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
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('teacher', row.id, orderedTeachers.map((entry) => entry.id))} data-testid={`basic-data-edit-teacher-${row.id}`}>{isRowEditing('teacher', row.id) ? '保存' : '編集'}</button>
                      <button className="secondary-button slim" type="button" onClick={() => removeTeacher(row.id)}>削除</button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {orderedTeachers.length === 0 ? <tr><td colSpan={9} className="basic-data-empty-row">{teacherRosterView === 'active' ? '在籍講師はまだありません。' : '非在籍講師はまだありません。'}</td></tr> : null}
            </tbody>
          </table>
        </section>
      </>
    )
  }

  const renderStudents = () => {
    const visibleStudents = studentRosterView === 'active' ? activeStudentRows : withdrawnStudentRows
    // 退塾後(非在籍)の行は**一切編集できない**(オーナー確定 2026-09-20 夜)。退塾すると今日以降の盤面の痕跡が消える
    // ＝元に戻せないため、退塾日も含めて入力を出さない(「編集」ボタンも出さない)。残す操作は「削除」だけ。
    // 在籍中(退塾日が未来)の生徒は従来どおり退塾予定日を早める/遅らせる/消すのが自由(まだ何も消えていない)。
    const isStudentRowLocked = (row: StudentRow) => isStudentRowLockedByWithdrawal(row, todayReferenceDate)
    const isStudentRowInputVisible = (row: StudentRow) => isRowEditing('student', row.id) && !isStudentRowLocked(row)
    const filteredStudents = filterAndSortRows(
      visibleStudents,
      tableControls.students,
      (row) => [row.name, row.displayName, row.email, row.entryDate, formatManagedDateValue(resolveEffectiveManagedWithdrawDate(row.withdrawDate, row.birthDate, todayReferenceDate)), row.birthDate, resolveManagedStudentGradeLabel(row, todayReferenceDate), isExternalStudentRow(row) ? '外部生' : ''],
      {
        // 手動テスト No.148(2026-08-29): 学年ラベルの文字コード比較だと昇順が「中→小→高」になる。
        // 学齢順の数値キー(basicDataModel の権威関数)でソートする。
        name: (row) => buildManagedStudentNameSortValue(row, todayReferenceDate),
        entryDate: (row) => row.entryDate,
        withdrawDate: (row) => formatManagedDateValue(resolveEffectiveManagedWithdrawDate(row.withdrawDate, row.birthDate, todayReferenceDate)),
        birthDate: (row) => row.birthDate,
        status: (row) => resolveManagedStudentGradeSortValue(row, todayReferenceDate),
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
            <label className="basic-data-inline-field basic-data-inline-field-check" title="外部生はコマ表の授業区分表記が 外) になります(集計は従来どおり)">
              <span>外部生</span>
              <input
                type="checkbox"
                checked={studentDraft.isExternal}
                onChange={(event) => setStudentDraft((current) => ({ ...current, isExternal: event.target.checked }))}
                data-testid="basic-data-student-draft-is-external"
              />
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
              <button type="button" className={`basic-data-chip${studentRosterView === 'withdrawn' ? ' active' : ''}`} onClick={() => setStudentRosterView('withdrawn')} data-testid="basic-data-student-roster-withdrawn">退塾生徒</button>
            </div>
          </div>
          <table className="basic-data-table" data-testid={studentRosterView === 'active' ? 'basic-data-students-table' : 'basic-data-withdrawn-students-table'}>
            <thead><tr><th>氏名</th><th>表示名</th><th>メール</th><th>入塾日</th><th>退塾日</th><th>生年月日</th><th>外部生</th><th>学年/状態</th><th>操作</th></tr></thead>
            <tbody>
              {orderedStudents.map((row) => (
                <tr key={row.id}>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <input value={row.name} onChange={(event) => updateStudent(row.id, { name: event.target.value })} data-testid={`basic-data-student-name-input-${row.id}`} />
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-student-name-${row.id}`}>{row.name}</span>}
                  </td>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <input value={row.displayName} onChange={(event) => updateStudent(row.id, { displayName: event.target.value })} />
                      : <span className="basic-data-cell-summary">{getStudentDisplayName(row)}</span>}
                  </td>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <input value={row.email} onChange={(event) => updateStudent(row.id, { email: event.target.value })} type="email" />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.email)}</span>}
                  </td>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <DateAssistInput value={row.entryDate} emptyLabel="入塾日を選択" onChange={(value) => updateStudent(row.id, { entryDate: value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.entryDate)}</span>}
                  </td>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <DateAssistInput value={row.withdrawDate} emptyLabel="退塾日を選択" hint="未定の場合未入力(高3卒業後は卒業日を自動表示)" onChange={(value) => updateStudent(row.id, { withdrawDate: value })} />
                      : <span className="basic-data-cell-summary">{formatManagedDateValue(resolveEffectiveManagedWithdrawDate(row.withdrawDate, row.birthDate, todayReferenceDate))}</span>}
                  </td>
                  <td>
                    {isStudentRowInputVisible(row)
                      ? <DateAssistInput value={row.birthDate} emptyLabel="生年月日を選択" onChange={(value) => updateStudent(row.id, { birthDate: value })} />
                      : <span className="basic-data-cell-summary">{formatSummaryValue(row.birthDate)}</span>}
                  </td>
                  <td>
                    {/* 外部生チェック: 既存生徒も「編集」から後付けでチェックでき、コマ表の授業区分表記が即 外) になる。 */}
                    {isStudentRowInputVisible(row)
                      ? <input
                          type="checkbox"
                          checked={isExternalStudentRow(row)}
                          onChange={(event) => updateStudent(row.id, { isExternal: event.target.checked })}
                          data-testid={`basic-data-student-is-external-input-${row.id}`}
                        />
                      : <span className="basic-data-cell-summary" data-testid={`basic-data-student-is-external-${row.id}`}>{isExternalStudentRow(row) ? '外部生' : '-'}</span>}
                  </td>
                  <td><span className="status-chip secondary" data-testid={`basic-data-student-grade-${row.id}`}>{resolveManagedStudentGradeLabel(row, todayReferenceDate)}</span></td>
                  <td>
                    <div className="basic-data-row-actions">
                      {isStudentRowLocked(row) ? null : (
                        <button className="secondary-button slim" type="button" onClick={() => toggleRowEditing('student', row.id, orderedStudents.map((entry) => entry.id))} data-testid={`basic-data-edit-student-${row.id}`}>{isRowEditing('student', row.id) ? '編集終了' : '編集'}</button>
                      )}
                      {/* 保護者用QR: 在籍タブ・フラグ ON・リモート有り・在籍中(isActiveOnDate)の生徒だけ(spec-parent-portal.md §K-6)。 */}
                      {(() => {
                        if (studentRosterView !== 'active') return null
                        const qrState = resolveParentPortalQrRowState({ student: row, referenceDate: todayReferenceDate, enabled: parentPortalQrEnabled, remoteEnabled: Boolean(onIssueParentPortalToken), classroomId, savedStudentIds })
                        if (qrState === 'hidden') return null
                        if (qrState === 'pending-save') {
                          // 追加直後でまだ保存されていない生徒は発行できない(サーバーの名簿に居ない)。保存が終わるまでスピナー。
                          return (
                            <button className="secondary-button slim basic-data-qr-pending" type="button" disabled aria-busy="true" title={PARENT_PORTAL_QR_TEXT.pendingSave} data-testid={`basic-data-student-qr-pending-${row.id}`}>
                              <span className="button-spinner" aria-hidden="true" />{PARENT_PORTAL_QR_TEXT.pendingLabel}
                            </button>
                          )
                        }
                        return <button className="secondary-button slim" type="button" onClick={() => { void openParentPortalQr(row) }} title={PARENT_PORTAL_QR_TEXT.title} data-testid={`basic-data-student-qr-${row.id}`}>{PARENT_PORTAL_QR_TEXT.buttonLabel}</button>
                      })()}
                      {/* 生徒は削除せず退塾(押した日を退塾日に記録・データは残る)。在籍中かつ今日付けの退塾日が未設定のときだけ出す。 */}
                      {canWithdrawStudentToday(row, todayReferenceDate) ? (
                        <button className="secondary-button slim" type="button" onClick={() => openStudentWithdraw(row.id)} data-testid={`basic-data-withdraw-student-${row.id}`}>退塾</button>
                      ) : null}
                      {/* 削除は非在籍一覧の退塾済み生徒だけ(アプリ上から消える・データは deletedAt 付きで残る)。 */}
                      {studentRosterView === 'withdrawn' && canDeleteStudentFromApp(row, todayReferenceDate) ? (
                        <button className="secondary-button slim" type="button" onClick={() => removeStudent(row.id)} data-testid={`basic-data-delete-student-${row.id}`}>削除</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {orderedStudents.length === 0 ? <tr><td colSpan={9} className="basic-data-empty-row">{studentRosterView === 'active' ? '在籍生徒はまだありません。' : '退塾生徒はまだありません。'}</td></tr> : null}
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
    { key: 'classroomData', label: '教室データ' },
  ]

  return (
    <div className="page-shell page-shell-basic-data">

      {deleteModalState ? (() => {
        const confirmation = buildDeleteConfirmation({
          scope: deleteModalState.scope,
          name: deleteModalState.name,
          stock: deleteModalState.stock,
          requiresPassword: requiresDeletePassword,
        })
        return (
          <div className="auto-assign-modal-overlay" role="presentation">
            <div className="auto-assign-modal basic-data-delete-modal" role="dialog" aria-modal="true" aria-label={confirmation.title}>
              <div className="auto-assign-modal-title">{confirmation.title}</div>
              <p className="basic-data-delete-warning">⚠️ {confirmation.irreversibleWarning}</p>
              {confirmation.stockWarning ? (
                <p className="basic-data-delete-stock-warning" data-testid="basic-data-delete-stock-warning">{confirmation.stockWarning}</p>
              ) : null}
              {confirmation.hideHint ? <p className="basic-data-delete-hint">{confirmation.hideHint}</p> : null}
              {confirmation.requiresPassword ? (
                <label className="basic-data-delete-password">
                  <span>ログイン中アカウントのパスワード</span>
                  <input
                    type="password"
                    value={deletePassword}
                    autoComplete="current-password"
                    onChange={(event) => { setDeletePassword(event.target.value); setDeleteError('') }}
                    data-testid="basic-data-delete-password-input"
                  />
                </label>
              ) : null}
              {deleteError ? <p className="basic-data-delete-error" role="alert">{deleteError}</p> : null}
              <div className="auto-assign-modal-actions">
                <button className="secondary-button" type="button" onClick={cancelDelete} disabled={deleteBusy}>キャンセル</button>
                <button className="primary-button basic-data-delete-confirm" type="button" onClick={confirmDelete} disabled={deleteBusy} data-testid="basic-data-delete-confirm-button">{deleteBusy ? '確認中…' : '削除する'}</button>
              </div>
            </div>
          </div>
        )
      })() : null}

      {withdrawModalState ? (() => {
        const confirmation = buildStudentWithdrawConfirmation({
          name: withdrawModalState.name,
          today: getReferenceDateKey(new Date()),
          currentWithdrawDate: withdrawModalState.currentWithdrawDate,
          stock: withdrawModalState.stock,
          // フラグ OFF の教室では今日以降のコマ・記録は消えない(通常授業の剥がしだけ)ので案内も変える。
          autoSweepEnabled: studentWithdrawAutoSweepEnabled,
        })
        return (
          <div className="auto-assign-modal-overlay" role="presentation">
            <div className="auto-assign-modal basic-data-delete-modal" role="dialog" aria-modal="true" aria-label={confirmation.title}>
              <div className="auto-assign-modal-title">{confirmation.title}</div>
              <p className="basic-data-delete-hint">{confirmation.message}</p>
              {confirmation.overwriteNote ? <p className="basic-data-delete-warning">{confirmation.overwriteNote}</p> : null}
              {confirmation.stockWarning ? (
                <p className="basic-data-delete-stock-warning" data-testid="basic-data-withdraw-stock-warning">{confirmation.stockWarning}</p>
              ) : null}
              <div className="auto-assign-modal-actions">
                <button className="secondary-button" type="button" onClick={cancelStudentWithdraw}>キャンセル</button>
                <button className="primary-button" type="button" onClick={confirmStudentWithdraw} data-testid="basic-data-withdraw-confirm-button">退塾にする</button>
              </div>
            </div>
          </div>
        )
      })() : null}

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

      {parentQrModal ? (() => {
        const student = students.find((row) => row.id === parentQrModal.studentId)
        return (
          <ParentPortalQrModal
            classroomName={classroomName}
            studentName={student ? getStudentDisplayName(student) : ''}
            url={parentQrModal.url}
            svg={parentQrModal.svg}
            isLoading={parentQrModal.isLoading}
            error={parentQrModal.error}
            busy={parentQrModal.busy}
            onReissue={() => { void reissueParentPortalQr() }}
            onPrint={printParentPortalQr}
            onClose={() => setParentQrModal(null)}
          />
        )
      })() : null}
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
            {activeTab === 'classroomData' ? renderClassroomData() : null}
          </div>
        </section>
      </main>
    </div>
  )
}
