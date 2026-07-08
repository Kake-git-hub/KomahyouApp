// 対話用日程表 React ビュー(ScheduleView)の表示算出純関数集。
// createScheduleHtml(scheduleHtml.ts)の埋め込みJS(テンプレートリテラル内)にある同名関数の
// TypeScript 移植で、入力は印刷/PDF と同じ SchedulePayload(表示算出の正本を共有)。
// ⚠️ 表示仕様を変えるときは埋め込みJS(印刷/PDF側)とこのファイルの両方を直すこと
// (spec-schedule-interactive-view §C-3: 表示の二重定義でズレを作らない)。
import type {
  SchedulePayload,
  SerializedCell,
  SerializedSpecialSession,
  SerializedStudent,
  SerializedStudentEntry,
  SerializedStudentSpecialSessionInput,
  SerializedStudentStatusEntry,
  SerializedTeacher,
  SerializedTeacherSpecialSessionInput,
} from './scheduleHtml'
import type { GroupClassEntry } from '../components/schedule-board/groupClass'

export type ScheduleViewType = 'student' | 'teacher'

export const scheduleLessonTypeLabels: Record<string, string> = { extra: '増コマ', regular: '通常', makeup: '振替', special: '講習', trial: '体験' }
export const scheduleTeacherTypeLabels: Record<string, string> = { normal: '', substitute: '代行', outside: '外部' }
export const scheduleDayLabels = ['日', '月', '火', '水', '木', '金', '土']
// 通常回数・講習回数表の表示順。算国は国の直後に置き、集理/集社は末尾(埋め込みJSと同一)。
const subjectDefinitions = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社']
const SUBJECT_SORT_ORDER = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '集理', '集社']
const groupClassBandTimes: Record<string, string> = { '1': '10:00-11:00', '2': '11:10-12:10' }

export type ScheduleDateHeader = { dateKey: string; dateLabel: string; isOpenDay: boolean; weekday: number }
export type ScheduleMonthGroup = { month: number; count: number }
export type SchedulePeriodSegment =
  | { type: 'gap'; key: string; colSpan: number }
  | { type: 'band'; key: string; colSpan: number; label: string; startDate: string; endDate: string; sessionId: string }
export type ScheduleCountRow = { label: string; count: number; desired: number }
export type ScheduleTimeRange = { start: string; end: string }

export type StudentCellCardData = { main: string; sub: string }
export type StudentGridCellData = {
  slotKey: string
  dateKey: string
  slotNumber: number
  isHoliday: boolean
  isUnavailable: boolean
  isEditable: boolean
  isHighlighted: boolean
  cards: StudentCellCardData[]
  title: string
}
export type StudentGridRowData = {
  slotNumber: number
  time: ScheduleTimeRange
  cells: StudentGridCellData[]
  signature: string
}

export type GroupRowCellData = { isHoliday: boolean; label: string; state: 'normal' | 'absent' | 'empty' | 'none' }
export type GroupRowData = { band: string; time: ScheduleTimeRange; cells: GroupRowCellData[]; signature: string }

export type TeacherCellPersonData = { name: string; meta: string; densityClass: '' | 'is-condensed' | 'is-ultra-condensed' }
export type TeacherGridCellData = {
  slotKey: string
  dateKey: string
  slotNumber: number
  isHoliday: boolean
  isUnavailable: boolean
  isEditable: boolean
  people: TeacherCellPersonData[]
  cardSizeClass: 'is-single' | 'is-pair' | 'is-multi'
  title: string
}
export type TeacherGridRowData = {
  slotNumber: number
  time: ScheduleTimeRange
  cells: TeacherGridCellData[]
  signature: string
}

export type ScheduleQrViewData = { svg: string; submitted: boolean }
export type ScheduleOptionRowData = { noteKey: string; value: string; checked: boolean }
export type TeacherSalaryRowData = { cat: string; label: string; count: number }
export type TeacherSalaryViewData = {
  teacherId: string
  rows: TeacherSalaryRowData[]
  attendanceDays: number
  scrollable: boolean
}

export type StudentSheetViewModel = {
  student: SerializedStudent
  studentIndex: number
  headerName: string
  periodLabel: string
  years: number[]
  monthGroups: ScheduleMonthGroup[]
  dateHeaders: ScheduleDateHeader[]
  slotNumbers: number[]
  periodSegments: SchedulePeriodSegment[]
  densityClass: string
  groupRows: GroupRowData[]
  rows: StudentGridRowData[]
  absenceNotes: string[]
  makeupNotes: string[]
  regularCountRows: ScheduleCountRow[]
  lectureCountRows: ScheduleCountRow[]
  regularCountMismatch: boolean
  lectureCountMismatch: boolean
  optionFieldEnabled: boolean
  optionGradeLabel: string
  optionRows: ScheduleOptionRowData[]
  commonNoteKey: string
  commonNoteValue: string
  individualNoteKey: string
  individualNoteValue: string
  qr: ScheduleQrViewData
}

export type TeacherSheetViewModel = {
  teacher: SerializedTeacher
  teacherIndex: number
  headerName: string
  periodLabel: string
  years: number[]
  monthGroups: ScheduleMonthGroup[]
  dateHeaders: ScheduleDateHeader[]
  slotNumbers: number[]
  periodSegments: SchedulePeriodSegment[]
  densityClass: string
  groupRows: GroupRowData[]
  rows: TeacherGridRowData[]
  makeupNotes: string[]
  regularCountRows: ScheduleCountRow[]
  lectureCountRows: ScheduleCountRow[]
  salary: TeacherSalaryViewData
  qr: ScheduleQrViewData
}

export function formatMonthDay(dateKey: string) {
  const parts = dateKey.split('-')
  return `${Number(parts[1])}月${Number(parts[2])}日`
}

export function formatRangeLabel(startDate: string, endDate: string) {
  if (!startDate || !endDate) return ''
  return `${formatMonthDay(startDate)} ～ ${formatMonthDay(endDate)}`
}

function isOpenDayByRules(payload: SchedulePayload, dateKey: string, fallbackOpenState?: boolean) {
  if (typeof fallbackOpenState === 'boolean') return fallbackOpenState
  if (payload.availability.forceOpenDates.includes(dateKey)) return true
  if (payload.availability.holidayDates.includes(dateKey)) return false
  return !payload.availability.closedWeekdays.includes(new Date(`${dateKey}T00:00:00`).getDay())
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildDateHeaders(payload: SchedulePayload, startDate: string, endDate: string): ScheduleDateHeader[] {
  const byDate = new Map(payload.cells.map((cell) => [cell.dateKey, cell]))
  const headers: ScheduleDateHeader[] = []
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const dateKey = toDateKey(cursor)
    const known = byDate.get(dateKey)
    headers.push({
      dateKey,
      dateLabel: `${Number(dateKey.split('-')[1])}/${Number(dateKey.split('-')[2])}`,
      isOpenDay: isOpenDayByRules(payload, dateKey, known ? known.isOpenDay : undefined),
      weekday: cursor.getDay(),
    })
  }
  return headers
}

export function buildMonthGroups(dateHeaders: ScheduleDateHeader[]): ScheduleMonthGroup[] {
  const groups: ScheduleMonthGroup[] = []
  dateHeaders.forEach((header) => {
    const month = Number(header.dateKey.split('-')[1])
    const last = groups[groups.length - 1]
    if (last && last.month === month) last.count += 1
    else groups.push({ month, count: 1 })
  })
  return groups
}

export function getVisibleYears(dateHeaders: ScheduleDateHeader[]): number[] {
  return Array.from(new Set(dateHeaders.map((header) => Number(header.dateKey.split('-')[0]))))
}

export function getSlotNumbers(payload: SchedulePayload): number[] {
  return Array.from(new Set(payload.cells.map((cell) => cell.slotNumber))).sort((left, right) => left - right)
}

export function splitTimeLabel(timeLabel: string): ScheduleTimeRange {
  const normalized = String(timeLabel || '').replace(/\s+/g, '')
  const matched = normalized.match(/^(.+?)[-~〜](.+)$/)
  if (!matched) return { start: normalized, end: '' }
  return { start: matched[1], end: matched[2] }
}

export function buildPeriodSegments(payload: SchedulePayload, dateHeaders: ScheduleDateHeader[]): SchedulePeriodSegment[] {
  const segments: SchedulePeriodSegment[] = []
  let cursor = 0
  while (cursor < dateHeaders.length) {
    const header = dateHeaders[cursor]
    const matched = payload.periodBands.find((band) => header.dateKey >= band.startDate && header.dateKey <= band.endDate)
    if (!matched) {
      const gapStart = cursor
      while (cursor < dateHeaders.length && !payload.periodBands.find((band) => dateHeaders[cursor].dateKey >= band.startDate && dateHeaders[cursor].dateKey <= band.endDate)) {
        cursor += 1
      }
      segments.push({ type: 'gap', key: `gap-${gapStart}`, colSpan: cursor - gapStart })
      continue
    }
    const segmentStart = cursor
    while (cursor < dateHeaders.length && dateHeaders[cursor].dateKey >= matched.startDate && dateHeaders[cursor].dateKey <= matched.endDate) {
      cursor += 1
    }
    segments.push({ type: 'band', key: `${matched.label}-${segmentStart}`, colSpan: cursor - segmentStart, label: matched.label, startDate: matched.startDate, endDate: matched.endDate, sessionId: matched.id || '' })
  }
  return segments
}

export function getTableDensityClass(dateHeaders: ScheduleDateHeader[]) {
  if (dateHeaders.length >= 38) return 'is-dense is-ultra-dense'
  if (dateHeaders.length >= 28) return 'is-dense'
  if (dateHeaders.length >= 18) return 'is-compact'
  return ''
}

function buildCellMap(cells: SerializedCell[]) {
  const map = new Map<string, SerializedCell>()
  cells.forEach((cell) => {
    map.set(`${cell.dateKey}_${cell.slotNumber}`, cell)
  })
  return map
}

export function filterCells(payload: SchedulePayload, startDate: string, endDate: string): SerializedCell[] {
  return payload.cells.filter((cell) => cell.dateKey >= startDate && cell.dateKey <= endDate)
}

function normalizeStudentAssignmentName(value: string) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function getNameAssignmentKey(value: string | undefined) {
  const normalized = normalizeStudentAssignmentName(value ?? '')
  return normalized ? `name:${normalized}` : ''
}

function buildUniqueStudentNameOwnerMap(payload: SchedulePayload) {
  const ownerByName = new Map<string, string>()
  ;(payload.students || []).forEach((student) => {
    ;[student.name, student.fullName].forEach((name) => {
      const key = getNameAssignmentKey(name)
      if (!key) return
      const current = ownerByName.get(key)
      if (current && current !== student.id) ownerByName.set(key, '')
      else if (current !== '') ownerByName.set(key, student.id)
    })
  })
  return ownerByName
}

function getStudentAssignmentKeys(payload: SchedulePayload, student: SerializedStudent) {
  const keys = [student.id]
  const ownerByName = buildUniqueStudentNameOwnerMap(payload)
  ;[student.name, student.fullName].forEach((name) => {
    const key = getNameAssignmentKey(name)
    if (key && ownerByName.get(key) === student.id && !keys.includes(key)) keys.push(key)
  })
  return keys
}

export type StudentScheduleEntry = {
  dateKey: string
  slotNumber: number
  teacher: string
  timeLabel: string
  lesson: SerializedStudentEntry | SerializedStudentStatusEntry
}

// 注: 埋め込みJS版は statuses の status==='moved' を再度除外するが、SerializedCell は
// serializeCells の時点で moved を除外済みのため、payload 入力のここでは再チェック不要。
export function buildStudentAssignments(cells: SerializedCell[]) {
  const map = new Map<string, StudentScheduleEntry[]>()
  cells.forEach((cell) => {
    cell.desks.forEach((desk) => {
      if (desk.lesson) {
        desk.lesson.students.forEach((student) => {
          // 体験授業生徒は既存生徒として扱わない (同名でも生徒日程表へ載せない)
          if (student.lessonType === 'trial') return
          const studentKey = student.linkedStudentId || getNameAssignmentKey(student.name)
          if (!studentKey) return
          if (!map.has(studentKey)) map.set(studentKey, [])
          map.get(studentKey)!.push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: desk.teacher, timeLabel: cell.timeLabel, lesson: student })
        })
      }
      ;(Array.isArray(desk.statuses) ? desk.statuses : []).forEach((statusEntry) => {
        if (!statusEntry) return
        if (statusEntry.lessonType === 'trial') return
        const studentKey = statusEntry.linkedStudentId || getNameAssignmentKey(statusEntry.name)
        if (!studentKey) return
        if (!map.has(studentKey)) map.set(studentKey, [])
        map.get(studentKey)!.push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: statusEntry.teacherName || desk.teacher, timeLabel: cell.timeLabel, lesson: statusEntry })
      })
    })
  })
  return map
}

function normalizeTeacherAssignmentName(value: string | undefined) {
  return Array.from(String(value || '')).filter((char) => char.trim()).join('')
}

export type TeacherScheduleEntry = {
  dateKey: string
  slotNumber: number
  timeLabel: string
  students: SerializedStudentEntry[]
  statuses: SerializedStudentStatusEntry[]
  note: string
}

export function buildTeacherAssignments(cells: SerializedCell[]) {
  const map = new Map<string, TeacherScheduleEntry[]>()
  cells.forEach((cell) => {
    cell.desks.forEach((desk) => {
      const statuses = (Array.isArray(desk.statuses) ? desk.statuses : []).filter((entry): entry is SerializedStudentStatusEntry => Boolean(entry))
      if (!desk.teacher || (!desk.lesson && statuses.length === 0)) return
      const entry: TeacherScheduleEntry = { dateKey: cell.dateKey, slotNumber: cell.slotNumber, timeLabel: cell.timeLabel, students: desk.lesson ? desk.lesson.students : [], statuses, note: desk.lesson ? desk.lesson.note || '' : '' }
      const teacherKeys: string[] = []
      if (desk.teacherId) teacherKeys.push(desk.teacherId)
      else if (Array.isArray(desk.regularTeacherIds)) teacherKeys.push(...desk.regularTeacherIds.filter(Boolean))
      ;[desk.teacher, normalizeTeacherAssignmentName(desk.teacher)].filter(Boolean).forEach((teacherKey) => {
        teacherKeys.push(teacherKey)
      })
      Array.from(new Set(teacherKeys)).forEach((teacherKey) => {
        if (!map.has(teacherKey)) map.set(teacherKey, [])
        map.get(teacherKey)!.push(entry)
      })
    })
  })
  return map
}

export function collectTeacherAssignmentEntries(assignmentMap: Map<string, TeacherScheduleEntry[]>, teacher: SerializedTeacher) {
  const keys = [teacher.id, teacher.name, teacher.fullName, normalizeTeacherAssignmentName(teacher.name), normalizeTeacherAssignmentName(teacher.fullName)].filter((key): key is string => Boolean(key))
  const entries: TeacherScheduleEntry[] = []
  const seen = new Set<string>()
  keys.forEach((key) => {
    ;(assignmentMap.get(key) || []).forEach((entry) => {
      const studentKey = (entry.students || []).map((student) => student.id || student.name).join(',')
      const statusKey = (entry.statuses || []).map((status) => status.id || status.name).join(',')
      const dedupeKey = [entry.dateKey, entry.slotNumber, studentKey, statusKey, entry.note || ''].join('__')
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      entries.push(entry)
    })
  })
  return entries
}

export function isVisibleInRange(item: { entryDate: string; withdrawDate: string }, startDate: string, endDate: string, todayKey?: string) {
  const today = todayKey ?? new Date().toISOString().slice(0, 10)
  if (item.withdrawDate && item.withdrawDate !== '未定' && item.withdrawDate < today) return false
  return item.entryDate <= endDate && (!item.withdrawDate || item.withdrawDate === '未定' || item.withdrawDate >= startDate)
}

export function getGradeLabel(birthDate: string | undefined, referenceDate: string) {
  if (!birthDate) return ''
  const birthParts = birthDate.split('-').map(Number)
  const ref = new Date(`${referenceDate}T00:00:00`)
  const schoolYear = ref >= new Date(ref.getFullYear(), 3, 1) ? ref.getFullYear() : ref.getFullYear() - 1
  const enrollmentYear = birthParts[1] < 4 || (birthParts[1] === 4 && birthParts[2] === 1) ? birthParts[0] + 6 : birthParts[0] + 7
  const gradeNumber = schoolYear - enrollmentYear + 1
  if (gradeNumber <= 1) return '小1'
  if (gradeNumber === 2) return '小2'
  if (gradeNumber === 3) return '小3'
  if (gradeNumber === 4) return '小4'
  if (gradeNumber === 5) return '小5'
  if (gradeNumber === 6) return '小6'
  if (gradeNumber === 7) return '中1'
  if (gradeNumber === 8) return '中2'
  if (gradeNumber === 9) return '中3'
  if (gradeNumber === 10) return '高1'
  if (gradeNumber === 11) return '高2'
  return '高3'
}

function sortSlotKeys(slotKeys: string[] | undefined) {
  return Array.from(new Set((slotKeys || []).filter((slotKey) => typeof slotKey === 'string' && slotKey))).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))
}

function normalizeSubjectSlots(subjectSlots: Record<string, number> | undefined) {
  const next: Record<string, number> = {}
  subjectDefinitions.forEach((subject) => {
    const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0)
    const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0
    if (normalizedValue > 0) next[subject] = normalizedValue
  })
  return next
}

// 科目ごとの授業時間(分)。QR提出と同じく 60/45 のみ保持し、90(既定)や不正値は落とす。
function normalizeSubjectDurations(map: Record<string, number> | undefined) {
  const next: Record<string, number> = {}
  if (!map || typeof map !== 'object') return next
  Object.keys(map).forEach((subject) => {
    const value = Number(map[subject])
    if (value === 60 || value === 45) next[subject] = value
  })
  return next
}

function getSpecialSessionById(payload: SchedulePayload, sessionId: string): SerializedSpecialSession | null {
  return (payload.specialSessions || []).find((session) => session.id === sessionId) || null
}

function getStudentSessionInput(payload: SchedulePayload, studentId: string, sessionId: string): Required<Pick<SerializedStudentSpecialSessionInput, 'unavailableSlots' | 'subjectSlots' | 'regularOnly' | 'countSubmitted'>> & SerializedStudentSpecialSessionInput {
  const session = getSpecialSessionById(payload, sessionId)
  const current = session && session.studentInputs ? session.studentInputs[studentId] : null
  return {
    ...(current || {}),
    unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
    subjectSlots: normalizeSubjectSlots(current && current.subjectSlots ? current.subjectSlots : {}),
    subjectDurations: normalizeSubjectDurations(current && current.subjectDurations ? current.subjectDurations : {}),
    regularOnly: Boolean(current && current.regularOnly),
    countSubmitted: Boolean(current && current.countSubmitted),
  }
}

function getTeacherSessionInput(payload: SchedulePayload, teacherId: string, sessionId: string): Required<Pick<SerializedTeacherSpecialSessionInput, 'unavailableSlots' | 'countSubmitted'>> {
  const session = getSpecialSessionById(payload, sessionId)
  const current = session && session.teacherInputs ? session.teacherInputs[teacherId] : null
  return {
    unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
    countSubmitted: Boolean(current && current.countSubmitted),
  }
}

function getSpecialSessionsForDate(payload: SchedulePayload, dateKey: string) {
  return (payload.specialSessions || []).filter((session) => dateKey >= session.startDate && dateKey <= session.endDate)
}

export function getUnavailableSlotsForStudent(payload: SchedulePayload, studentId: string) {
  const unavailableSlots = new Set<string>()
  ;(payload.specialSessions || []).forEach((session) => {
    const input = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs[studentId] : null
    if (!input || !Array.isArray(input.unavailableSlots)) return
    input.unavailableSlots.forEach((slotKey) => {
      if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey)
    })
  })
  return unavailableSlots
}

export function getUnavailableSlotsForTeacher(payload: SchedulePayload, teacherId: string) {
  const unavailableSlots = new Set<string>()
  ;(payload.specialSessions || []).forEach((session) => {
    const input = session.teacherInputs && typeof session.teacherInputs === 'object' ? session.teacherInputs[teacherId] : null
    if (!input || !Array.isArray(input.unavailableSlots)) return
    input.unavailableSlots.forEach((slotKey) => {
      if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey)
    })
  })
  return unavailableSlots
}

function isStudentSessionUnavailableFixed(payload: SchedulePayload, studentId: string, sessionId: string) {
  return Boolean(studentId && sessionId && getStudentSessionInput(payload, studentId, sessionId).countSubmitted)
}

function isTeacherSessionUnavailableFixed(payload: SchedulePayload, teacherId: string, sessionId: string) {
  return Boolean(teacherId && sessionId && getTeacherSessionInput(payload, teacherId, sessionId).countSubmitted)
}

function getEditableSpecialSessionsForStudent(payload: SchedulePayload, studentId: string, dateKey: string) {
  return getSpecialSessionsForDate(payload, dateKey).filter((session) => !isStudentSessionUnavailableFixed(payload, studentId, session.id))
}

function getEditableSpecialSessionsForTeacher(payload: SchedulePayload, teacherId: string, dateKey: string) {
  return getSpecialSessionsForDate(payload, dateKey).filter((session) => !isTeacherSessionUnavailableFixed(payload, teacherId, session.id))
}

function getPreferredMathSubject(student: SerializedStudent | null, referenceDate: string) {
  const gradeLabel = getGradeLabel(student?.birthDate, referenceDate)
  return gradeLabel.startsWith('小') ? '算' : '数'
}

export function getVisibleSubjectsForStudent(student: SerializedStudent, referenceDate: string, additionalSubjects?: string[]) {
  const preferredMathSubject = getPreferredMathSubject(student, referenceDate)
  const gradeLabel = getGradeLabel(student?.birthDate, referenceDate)
  const prefersHighSchoolScience = gradeLabel.startsWith('高')
  const legacySubjects = Array.isArray(additionalSubjects) ? additionalSubjects : []
  return subjectDefinitions.filter((subject) => {
    if (subject === '算' || subject === '数') return subject === preferredMathSubject
    if (subject === '算国') return preferredMathSubject === '算'
    // 理は学年を問わず常に表示。高校生は理に加えて生・物・化も表示する。
    if (subject === '理') return true
    if (subject === '生' || subject === '物' || subject === '化') return prefersHighSchoolScience || legacySubjects.includes(subject)
    return true
  })
}

function normalizeSubjectForStudent(subject: string, student: SerializedStudent, referenceDate: string) {
  if (subject === '算国') return getPreferredMathSubject(student, referenceDate) === '算' ? '算国' : '数'
  if (subject !== '算' && subject !== '数') return subject
  return getPreferredMathSubject(student, referenceDate)
}

export function normalizeCountMapSubjects(countMap: Record<string, number>, student: SerializedStudent, referenceDate: string) {
  const next: Record<string, number> = {}
  Object.entries(countMap || {}).forEach(([subject, value]) => {
    const normalizedSubject = normalizeSubjectForStudent(subject, student, referenceDate)
    const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0
    if (normalizedValue <= 0) return
    next[normalizedSubject] = (next[normalizedSubject] || 0) + normalizedValue
  })
  return next
}

// 講習回数表の科目に併記する授業時間サフィックス。渡された分数(60/45のみ)が一意なら返し、
// 混在・空・90分だけのときは '' を返す(誤解を招く併記をしない)。spec-schedule-pdf §D。
function pickLectureMinutesSuffix(suffixes: string[] | undefined) {
  const unique = Array.from(new Set((suffixes || []).filter((s) => s === '60' || s === '45')))
  return unique.length === 1 ? unique[0] : ''
}

function resolveLectureMinutesBySubject(placedListBySubject: Record<string, string[]>, desiredMinutesBySubject: Record<string, string>) {
  const placed = placedListBySubject || {}
  const desired = desiredMinutesBySubject || {}
  const map: Record<string, string> = {}
  Array.from(new Set(Object.keys(placed).concat(Object.keys(desired)))).forEach((subject) => {
    const placedSuffix = pickLectureMinutesSuffix(placed[subject] || [])
    if (placedSuffix) map[subject] = placedSuffix
    else if (desired[subject]) map[subject] = desired[subject]
  })
  return map
}

// 授業時間(分)サフィックス。60/45 のみ付与し、90(既定)は付けない。spec-schedule-pdf §D。
function formatScheduleMinutesSuffix(noteSuffix: string | undefined) {
  const value = String(noteSuffix == null ? '' : noteSuffix).trim()
  return value === '60' || value === '45' ? value : ''
}

function isStatusEntry(entry: SerializedStudentEntry | SerializedStudentStatusEntry): entry is SerializedStudentStatusEntry {
  return typeof (entry as SerializedStudentStatusEntry).status === 'string'
}

export function buildStudentCellCard(entry: SerializedStudentEntry | SerializedStudentStatusEntry): StudentCellCardData {
  const noteSuffix = 'noteSuffix' in entry ? entry.noteSuffix : undefined
  const subjectWithMinutes = entry.subject + formatScheduleMinutesSuffix(noteSuffix)
  if (isStatusEntry(entry) && (entry.status === 'absent' || entry.status === 'absent-no-makeup' || entry.status === 'attended')) {
    const statusLabel = entry.status === 'attended' ? '出席' : entry.status === 'absent-no-makeup' ? '振無休' : '休'
    const linkedDestinationLabel = entry.linkedDestinationDateKey ? formatMonthDay(entry.linkedDestinationDateKey) : ''
    return {
      main: [statusLabel, linkedDestinationLabel].filter(Boolean).join(' '),
      sub: [subjectWithMinutes, scheduleLessonTypeLabels[entry.lessonType] || entry.lessonType].filter(Boolean).join(' / '),
    }
  }
  return { main: subjectWithMinutes, sub: scheduleLessonTypeLabels[entry.lessonType] || entry.lessonType }
}

function groupScheduleEntriesBySlot<T extends { dateKey: string; slotNumber: number }>(entries: T[]) {
  const map = new Map<string, T[]>()
  ;(entries || []).forEach((entry) => {
    const key = `${entry.dateKey}_${entry.slotNumber}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(entry)
  })
  return map
}

// spec-group-lesson §A/§D/§E: 集団授業(中3)の表示・回数ヘルパ。
function groupClassShortLabel(subject: string) {
  if (subject === '集団理科') return '集理'
  if (subject === '集団社会') return '集社'
  return subject
}

function getGroupClassEntry(payload: SchedulePayload, dateKey: string, band: string): GroupClassEntry | null {
  const entries = payload.groupClassEntries && typeof payload.groupClassEntries === 'object' ? payload.groupClassEntries : {}
  const entry = entries[`${dateKey}_${band}`]
  return entry && entry.subject ? entry : null
}

function getGroupClassEntriesInRange(payload: SchedulePayload, startDate: string, endDate: string): GroupClassEntry[] {
  const entries = payload.groupClassEntries && typeof payload.groupClassEntries === 'object' ? payload.groupClassEntries : {}
  const list: GroupClassEntry[] = []
  Object.keys(entries).forEach((key) => {
    const entry = entries[key]
    if (!entry || !entry.subject) return
    if (entry.dateKey < startDate || entry.dateKey > endDate) return
    list.push(entry)
  })
  return list
}

function getGroupSessionInputForStudent(payload: SchedulePayload, studentId: string, dateKey: string) {
  const sessions = getSpecialSessionsForDate(payload, dateKey)
  for (const session of sessions) {
    const inputs = session.studentInputs
    const input = inputs && typeof inputs === 'object' ? inputs[studentId] : null
    if (input) return input
  }
  return null
}

function isGroupRegistered(input: SerializedStudentSpecialSessionInput | null) {
  return Boolean(input && input.countSubmitted)
}

function isGroupParticipant(input: SerializedStudentSpecialSessionInput | null, subject: string | undefined) {
  return Boolean(input && input.groupClassParticipation && subject && input.groupClassParticipation[subject] === true)
}

function isInGroupRoster(payload: SchedulePayload, entry: GroupClassEntry, studentId: string) {
  const input = getGroupSessionInputForStudent(payload, studentId, entry.dateKey)
  if (isGroupParticipant(input, entry.subject)) return true
  return Array.isArray(entry.addedStudentIds) && entry.addedStudentIds.indexOf(studentId) >= 0
}

function isGroupAbsent(entry: GroupClassEntry, studentId: string) {
  return Array.isArray(entry.absentStudentIds) && entry.absentStudentIds.indexOf(studentId) >= 0
}

function buildGroupRowTime(band: string): ScheduleTimeRange {
  const parts = String(groupClassBandTimes[band] || '').split('-')
  return { start: parts[0] || '', end: parts[1] || '' }
}

// 中3生徒の集団行(2バンド)。未登録=中3全員に科目表示、登録後=参加者のみ表示+出欠反映。
export function buildStudentGroupRows(payload: SchedulePayload, student: SerializedStudent | null, startDate: string, endDate: string, dateHeaders: ScheduleDateHeader[]): GroupRowData[] {
  if (!student || student.currentGradeLabel !== '中3') return []
  if (getGroupClassEntriesInRange(payload, startDate, endDate).length === 0) return []
  return ['1', '2'].map((band) => {
    const cells: GroupRowCellData[] = dateHeaders.map((dateHeader) => {
      const entry = getGroupClassEntry(payload, dateHeader.dateKey, band)
      if (!entry) return { isHoliday: !dateHeader.isOpenDay, label: '', state: 'none' }
      const input = getGroupSessionInputForStudent(payload, student.id, dateHeader.dateKey)
      const show = isGroupRegistered(input) ? isInGroupRoster(payload, entry, student.id) : true
      if (!show) return { isHoliday: !dateHeader.isOpenDay, label: '', state: 'none' }
      const label = groupClassShortLabel(entry.subject || '')
      if (isGroupRegistered(input) && isGroupAbsent(entry, student.id)) {
        return { isHoliday: !dateHeader.isOpenDay, label: `${label}（欠）`, state: 'absent' }
      }
      return { isHoliday: !dateHeader.isOpenDay, label, state: 'normal' }
    })
    return { band, time: buildGroupRowTime(band), cells, signature: JSON.stringify([band, cells]) }
  })
}

// 中3参加者のみ 集理/集社 を講習回数表に注入(表示期間内・希望=コマ数/実績=出席数)。spec-group-lesson §D。
export function injectGroupClassCounts(payload: SchedulePayload, student: SerializedStudent | null, startDate: string, endDate: string, actualCounts: Record<string, number>, desiredCounts: Record<string, number>) {
  if (!student || student.currentGradeLabel !== '中3') return
  getGroupClassEntriesInRange(payload, startDate, endDate).forEach((entry) => {
    if (!isInGroupRoster(payload, entry, student.id)) return
    const label = groupClassShortLabel(entry.subject || '')
    desiredCounts[label] = (desiredCounts[label] || 0) + 1
    if (!isGroupAbsent(entry, student.id)) actualCounts[label] = (actualCounts[label] || 0) + 1
  })
}

// spec-group-lesson §F: 講師の集団授業(担当一致・出席1名以上で実施)。
function teacherMatchesGroupEntry(entry: GroupClassEntry, teacher: SerializedTeacher) {
  const name = entry && entry.teacherName ? entry.teacherName : ''
  if (!name || !teacher) return false
  const key = normalizeTeacherAssignmentName(name)
  return teacher.name === name || teacher.fullName === name
    || normalizeTeacherAssignmentName(teacher.name) === key
    || normalizeTeacherAssignmentName(teacher.fullName) === key
}

function getTeacherGroupEntriesInRange(payload: SchedulePayload, teacher: SerializedTeacher, startDate: string, endDate: string) {
  return getGroupClassEntriesInRange(payload, startDate, endDate).filter((entry) => teacherMatchesGroupEntry(entry, teacher))
}

// 出席者数(名簿=参加 or 手動追加、欠席を除く)。1名以上で実施扱い。
function getGroupPresentCount(payload: SchedulePayload, entry: GroupClassEntry) {
  const roster: Record<string, boolean> = {}
  getSpecialSessionsForDate(payload, entry.dateKey).forEach((session) => {
    const inputs = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs : {}
    Object.keys(inputs).forEach((studentId) => {
      if (isGroupParticipant(inputs[studentId], entry.subject)) roster[studentId] = true
    })
  })
  ;(Array.isArray(entry.addedStudentIds) ? entry.addedStudentIds : []).forEach((studentId) => { roster[studentId] = true })
  const absent: Record<string, boolean> = {}
  ;(Array.isArray(entry.absentStudentIds) ? entry.absentStudentIds : []).forEach((studentId) => { absent[studentId] = true })
  let present = 0
  Object.keys(roster).forEach((studentId) => { if (!absent[studentId]) present += 1 })
  return present
}

// 講師の集団行(2バンド)。担当する集団コマに 集理/集社 を表示(未実施はグレー)。
export function buildTeacherGroupRows(payload: SchedulePayload, teacher: SerializedTeacher | null, startDate: string, endDate: string, dateHeaders: ScheduleDateHeader[]): GroupRowData[] {
  if (!teacher) return []
  if (getTeacherGroupEntriesInRange(payload, teacher, startDate, endDate).length === 0) return []
  return ['1', '2'].map((band) => {
    const cells: GroupRowCellData[] = dateHeaders.map((dateHeader) => {
      const entry = getGroupClassEntry(payload, dateHeader.dateKey, band)
      if (!entry || !teacherMatchesGroupEntry(entry, teacher)) return { isHoliday: !dateHeader.isOpenDay, label: '', state: 'none' }
      const label = groupClassShortLabel(entry.subject || '')
      if (getGroupPresentCount(payload, entry) >= 1) {
        return { isHoliday: !dateHeader.isOpenDay, label, state: 'normal' }
      }
      return { isHoliday: !dateHeader.isOpenDay, label: `${label}（未実施）`, state: 'empty' }
    })
    return { band, time: buildGroupRowTime(band), cells, signature: JSON.stringify([band, cells]) }
  })
}

export function buildDesiredLectureCountMap(payload: SchedulePayload, student: SerializedStudent, startDate: string, endDate: string) {
  const countMap: Record<string, number> = {}
  ;(payload.specialSessions || []).forEach((session) => {
    if (!session || session.endDate < startDate || session.startDate > endDate) return
    const input = getStudentSessionInput(payload, student.id, session.id)
    if (!input.countSubmitted) return
    if (input.regularOnly) return
    Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
      const normalizedSubject = normalizeSubjectForStudent(subject, student, startDate)
      const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0
      if (normalizedValue <= 0) return
      countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + normalizedValue
    })
  })
  return countMap
}

// 希望登録(QR提出)の授業時間(60/45分)を正規化科目ごとに集める。未配置でも回数表に分数を出すため。
function buildDesiredLectureMinutesMap(payload: SchedulePayload, student: SerializedStudent, startDate: string, endDate: string) {
  const listBySubject: Record<string, string[]> = {}
  ;(payload.specialSessions || []).forEach((session) => {
    if (!session || session.endDate < startDate || session.startDate > endDate) return
    const input = getStudentSessionInput(payload, student.id, session.id)
    if (!input.countSubmitted) return
    if (input.regularOnly) return
    const durations = input.subjectDurations || {}
    Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
      const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0
      if (normalizedValue <= 0) return
      const minutes = Number(durations[subject])
      if (minutes !== 60 && minutes !== 45) return
      const normalizedSubject = normalizeSubjectForStudent(subject, student, startDate)
      if (!listBySubject[normalizedSubject]) listBySubject[normalizedSubject] = []
      listBySubject[normalizedSubject].push(String(minutes))
    })
  })
  const map: Record<string, string> = {}
  Object.keys(listBySubject).forEach((subject) => {
    const suffix = pickLectureMinutesSuffix(listBySubject[subject])
    if (suffix) map[subject] = suffix
  })
  return map
}

// toCountRows(埋め込みJS)のデータ版。空のときは空配列を返し、UI側で「予定なし」を表示する。
export function buildCountRows(
  countMap: Record<string, number>,
  desiredCountMap?: Record<string, number>,
  forcedLabels?: string[],
  options?: { hideZeroZero?: boolean; labelMinutesMap?: Record<string, string> | null },
): ScheduleCountRow[] {
  const hideZeroZero = options?.hideZeroZero
  const mergedLabels = Array.from(new Set([
    ...(forcedLabels || []),
    ...Object.keys(countMap || {}),
    ...Object.keys(desiredCountMap || {}),
  ])).sort((left, right) => {
    const leftIndex = SUBJECT_SORT_ORDER.indexOf(left)
    const rightIndex = SUBJECT_SORT_ORDER.indexOf(right)
    if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex
    if (leftIndex !== -1) return -1
    if (rightIndex !== -1) return 1
    return left.localeCompare(right, 'ja')
  })
  const labelMinutesMap = options?.labelMinutesMap || null
  return mergedLabels.flatMap((label) => {
    const count = Number(countMap && countMap[label] ? countMap[label] : 0)
    const desired = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count)
    if (hideZeroZero && count === 0 && desired === 0) return []
    // 科目の横に授業時間(60/45分)を併記する。90分(既定)や不明・混在は付けない。spec-schedule-pdf §D。
    const minutesSuffix = labelMinutesMap && labelMinutesMap[label] ? labelMinutesMap[label] : ''
    const displayLabel = label + (minutesSuffix ? `${minutesSuffix}分` : '')
    return [{ label: displayLabel, count, desired }]
  })
}

export function hasCountMismatch(countMap: Record<string, number>, desiredCountMap: Record<string, number>) {
  const mergedLabels = Array.from(new Set([
    ...Object.keys(countMap || {}),
    ...Object.keys(desiredCountMap || {}),
  ]))
  return mergedLabels.some((label) => {
    const count = Number(countMap && countMap[label] ? countMap[label] : 0)
    const desired = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count)
    return count !== desired
  })
}

function formatCompactDateSlot(dateKey: string, slotNumber: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}(${scheduleDayLabels[date.getDay()]})${slotNumber}限`
}

// 振替欄(生徒/講師日程表)用: 枠に収まるよう年(2026/)と曜日(水)を省き、月日と限だけにする。
function compactMakeupDateSlot(dateKey: string, slotNumber: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()} ${slotNumber}限`
}

// 振替元ラベルは '2026/4/1(水) 1限' 等。年と曜日を落とし '4/1 1限' に詰める。
function compactMakeupSourceLabel(label: string | undefined) {
  return String(label || '')
    .replace(/^\s*\d{4}\//, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatMakeupNote(subject: string, sourceLabel: string | undefined, targetDateKey: string, targetSlotNumber: number) {
  if (!sourceLabel) return ''
  return [subject, compactMakeupSourceLabel(sourceLabel), '→', compactMakeupDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ')
}

function formatTeacherMakeupNote(studentName: string, subject: string, sourceLabel: string | undefined, targetDateKey: string, targetSlotNumber: number) {
  if (!sourceLabel) return ''
  return [studentName, subject, compactMakeupSourceLabel(sourceLabel), '→', compactMakeupDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ')
}

function formatAbsenceNote(dateKey: string, slotNumber: number, teacherName: string, subject: string, lessonType: string, status: string, linkedDateKey?: string, linkedSlotNumber?: number) {
  let base = [formatCompactDateSlot(dateKey, slotNumber), teacherName, scheduleLessonTypeLabels[lessonType] || lessonType, subject].filter(Boolean).join(' / ')
  if (status === 'absent-no-makeup') base += ' (振無休)'
  if (linkedDateKey) base += ` → ${formatCompactDateSlot(linkedDateKey, linkedSlotNumber ?? 0)}`
  return base
}

export function collectStudentMakeupNotes(entries: StudentScheduleEntry[]) {
  return entries.reduce<string[]>((notes, entry) => {
    if (isStatusEntry(entry.lesson) && (entry.lesson.status === 'absent' || entry.lesson.status === 'absent-no-makeup')) return notes
    if (entry.lesson.lessonType !== 'makeup') return notes
    const note = formatMakeupNote(entry.lesson.subject, entry.lesson.makeupSourceLabel, entry.dateKey, entry.slotNumber)
    if (note) notes.push(note)
    return notes
  }, [])
}

export function collectTeacherMakeupNotes(entries: TeacherScheduleEntry[]) {
  return entries.reduce<string[]>((notes, entry) => {
    entry.students.forEach((student) => {
      if (student.lessonType !== 'makeup') return
      const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber)
      if (note) notes.push(note)
    })
    ;(entry.statuses || []).forEach((student) => {
      if (student.status === 'absent' || student.status === 'absent-no-makeup') return
      if (student.lessonType !== 'makeup') return
      const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber)
      if (note) notes.push(note)
    })
    return notes
  }, [])
}

function normalizeSearchText(value: string | undefined) {
  return String(value || '').replace(/\s+/g, '').toLowerCase()
}

export function collectStudentAbsenceNotes(cells: SerializedCell[], student: SerializedStudent) {
  const notes: string[] = []
  const studentNameKey = normalizeSearchText(student?.name)
  const studentFullNameKey = normalizeSearchText(student?.fullName)
  ;(cells || []).forEach((cell) => {
    ;(cell.desks || []).forEach((desk) => {
      const statuses = Array.isArray(desk.statuses) ? desk.statuses : []
      statuses.forEach((entry) => {
        if (!entry) return
        if (entry.status !== 'absent' && entry.status !== 'absent-no-makeup') return
        if (entry.lessonType === 'trial') return
        const linkedStudentId = entry.linkedStudentId || ''
        const entryNameKey = normalizeSearchText(entry.name || '')
        const isSameStudent = linkedStudentId === student.id
          || (Boolean(entryNameKey) && (entryNameKey === studentNameKey || entryNameKey === studentFullNameKey))
        if (!isSameStudent) return
        notes.push(formatAbsenceNote(cell.dateKey, cell.slotNumber, entry.teacherName || desk.teacher, entry.subject, entry.lessonType, entry.status, entry.linkedDestinationDateKey, entry.linkedDestinationSlotNumber))
      })
    })
  })
  return notes
}

function getCompactLessonTypeLabel(lessonType: string) {
  if (lessonType === 'regular') return '通'
  if (lessonType === 'makeup') return '振'
  if (lessonType === 'special') return '講'
  if (lessonType === 'trial') return '体'
  if (lessonType === 'extra') return '増'
  return scheduleLessonTypeLabels[lessonType] || lessonType || ''
}

function getCompactStatusLabel(status: string | undefined) {
  if (status === 'absent-no-makeup') return '振無休'
  if (status === 'absent') return '休'
  if (status === 'attended') return '出席'
  return ''
}

function getVerboseStatusLabel(status: string | undefined) {
  if (status === 'absent-no-makeup') return '振無休'
  if (status === 'absent') return '休み'
  if (status === 'attended') return '出席'
  return ''
}

type TeacherCellEntryLike = SerializedStudentEntry | SerializedStudentStatusEntry

function formatTeacherLessonLabel(student: TeacherCellEntryLike) {
  const lessonLabel = getCompactLessonTypeLabel(student.lessonType)
  const statusLabel = getCompactStatusLabel(isStatusEntry(student) ? student.status : undefined)
  if (statusLabel) return [lessonLabel, statusLabel].filter(Boolean).join(' ')
  const teacherLabel = scheduleTeacherTypeLabels[student.teacherType] || ''
  return teacherLabel ? `${lessonLabel}(${teacherLabel})` : lessonLabel
}

function getTeacherLessonPersonDensityClass(student: TeacherCellEntryLike): TeacherCellPersonData['densityClass'] {
  const meta = [student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join(' ')
  const totalLength = String(student.name || '').length + meta.length
  if (totalLength >= 13) return 'is-ultra-condensed'
  if (totalLength >= 9) return 'is-condensed'
  return ''
}

function formatTeacherTooltipEntry(student: TeacherCellEntryLike) {
  const lessonLabel = [scheduleLessonTypeLabels[student.lessonType] || student.lessonType, student.subject].filter(Boolean).join(' ')
  const status = isStatusEntry(student) ? student.status : undefined
  if (status === 'absent' || status === 'absent-no-makeup' || status === 'attended') {
    return [getVerboseStatusLabel(status), student.name, lessonLabel].filter(Boolean).join(' / ')
  }
  return [student.name, lessonLabel].filter(Boolean).join(' / ')
}

export function buildTeacherCellPeople(students: SerializedStudentEntry[], statuses: SerializedStudentStatusEntry[]): TeacherCellPersonData[] {
  const people: TeacherCellEntryLike[] = [...(students || []), ...(statuses || [])]
  return people.map((student) => {
    const noteSuffix = 'noteSuffix' in student ? student.noteSuffix : undefined
    return {
      name: student.name,
      meta: [student.subject + formatScheduleMinutesSuffix(noteSuffix), formatTeacherLessonLabel(student)].filter(Boolean).join(' '),
      densityClass: getTeacherLessonPersonDensityClass(student),
    }
  })
}

function isHighSchoolOrAbove(grade: string | undefined) {
  return grade === '高1' || grade === '高2' || grade === '高3'
}

// 1名: A90/A60/A45(中以下), C90/C60/C45(高以上)。2名: B(中以下)/D(高以上)は授業時間ペアごと。
// 集団は専用カテゴリ G(担当コマで出席1名以上=実施1コマ)。spec-group-lesson §F。
export function buildTeacherSalaryData(payload: SchedulePayload, entries: TeacherScheduleEntry[], teacher: SerializedTeacher, startDate: string, endDate: string) {
  const teacherId = teacher && teacher.id ? teacher.id : ''
  const normalizeMinutes = (value: string | undefined) => {
    const v = String(value || '').trim()
    if (v === '60') return '60'
    if (v === '45') return '45'
    return '90'
  }
  const pairKey = (minutesA: string, minutesB: string) => {
    const order: Record<string, number> = { '90': 0, '60': 1, '45': 2 }
    const pair = order[minutesA] <= order[minutesB] ? [minutesA, minutesB] : [minutesB, minutesA]
    return `${pair[0]}-${pair[1]}`
  }
  const counts: Record<string, number> = {
    A90: 0, A60: 0, A45: 0,
    C90: 0, C60: 0, C45: 0,
    'B90-90': 0, 'B90-60': 0, 'B90-45': 0, 'B60-60': 0, 'B60-45': 0, 'B45-45': 0,
    'D90-90': 0, 'D90-60': 0, 'D90-45': 0, 'D60-60': 0, 'D60-45': 0, 'D45-45': 0,
    G: 0,
  }
  const attendanceDates: Record<string, boolean> = {}
  ;(entries || []).forEach((entry) => {
    const statuses = (entry.statuses || []).filter(Boolean)
    const attendedStatuses = statuses.filter((status) => status.status === 'attended')
    if (attendedStatuses.length === 0) return
    // C / D は「1人でも高校以上を含む」コマを対象にする。
    const hasHigh = attendedStatuses.some((status) => isHighSchoolOrAbove(status.grade))
    if (attendedStatuses.length === 1) {
      const minutes = normalizeMinutes(attendedStatuses[0].noteSuffix)
      const rank = hasHigh ? 'C' : 'A'
      counts[rank + minutes] = (counts[rank + minutes] || 0) + 1
    } else {
      const minutesA = normalizeMinutes(attendedStatuses[0].noteSuffix)
      const minutesB = normalizeMinutes(attendedStatuses[1].noteSuffix)
      const rank = hasHigh ? 'D' : 'B'
      const key = rank + pairKey(minutesA, minutesB)
      counts[key] = (counts[key] || 0) + 1
    }
    attendanceDates[entry.dateKey] = true
  })
  getTeacherGroupEntriesInRange(payload, teacher, startDate, endDate).forEach((entry) => {
    if (getGroupPresentCount(payload, entry) >= 1) {
      counts.G = (counts.G || 0) + 1
      attendanceDates[entry.dateKey] = true
    }
  })
  return {
    counts,
    attendanceDays: Object.keys(attendanceDates).length,
    teacherId,
  }
}

export function buildTeacherSalaryViewData(payload: SchedulePayload, entries: TeacherScheduleEntry[], teacher: SerializedTeacher, startDate: string, endDate: string): TeacherSalaryViewData {
  const salaryData = buildTeacherSalaryData(payload, entries, teacher, startDate, endDate)
  const counts = salaryData.counts
  const pairs = ['90-90', '90-60', '90-45', '60-60', '60-45', '45-45']
  const lessonDefs: Array<{ cat: string; label: string }> = []
  ;['90', '60', '45'].forEach((minutes) => { lessonDefs.push({ cat: `A${minutes}`, label: `A${minutes} (1名/中学以下/${minutes}分)` }) })
  pairs.forEach((pair) => { lessonDefs.push({ cat: `B${pair}`, label: `B ${pair} (2名/中学以下/${pair.replace('-', '+')}分)` }) })
  ;['90', '60', '45'].forEach((minutes) => { lessonDefs.push({ cat: `C${minutes}`, label: `C${minutes} (1名/高校以上/${minutes}分)` }) })
  pairs.forEach((pair) => { lessonDefs.push({ cat: `D${pair}`, label: `D ${pair} (2名/高校以上/${pair.replace('-', '+')}分)` }) })
  lessonDefs.push({ cat: 'G', label: '集団 (1コマ)' })
  const rows = lessonDefs
    .filter((definition) => (counts[definition.cat] || 0) >= 1)
    .map((definition) => ({ cat: definition.cat, label: definition.label, count: counts[definition.cat] || 0 }))
  return {
    teacherId: salaryData.teacherId,
    rows,
    attendanceDays: salaryData.attendanceDays,
    scrollable: rows.length >= 5,
  }
}

export function formatStudentHeaderName(student: SerializedStudent, referenceDate: string) {
  const gradeLabel = student.currentGradeLabel || getGradeLabel(student.birthDate, referenceDate)
  const sourceName = student.fullName || student.name
  return gradeLabel ? `${sourceName}(${gradeLabel})` : sourceName
}

export function compareStudentOrder(left: SerializedStudent, right: SerializedStudent) {
  const orderDifference = (left.currentGradeOrder || 999) - (right.currentGradeOrder || 999)
  if (orderDifference !== 0) return orderDifference
  const nameDifference = (left.name || '').localeCompare(right.name || '', 'ja')
  if (nameDifference !== 0) return nameDifference
  return (left.fullName || '').localeCompare(right.fullName || '', 'ja')
}

export function formatTeacherHeaderName(teacher: SerializedTeacher) {
  return teacher.fullName || teacher.name
}

export function getVisibleStudents(payload: SchedulePayload, startDate: string, endDate: string, todayKey?: string) {
  return payload.students.filter((student) => isVisibleInRange(student, startDate, endDate, todayKey)).sort(compareStudentOrder)
}

export function getVisibleTeachers(payload: SchedulePayload, startDate: string, endDate: string, todayKey?: string) {
  return payload.teachers.filter((teacher) => isVisibleInRange(teacher, startDate, endDate, todayKey)).sort((left, right) => left.name.localeCompare(right.name, 'ja'))
}

export function filterPeopleByQuery<T extends { name: string; fullName?: string }>(people: T[], query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return people
  return people.filter((person) => [person.name, person.fullName].some((label) => normalizeSearchText(label).includes(normalizedQuery)))
}

function findFirstVisibleStudentWithSchedule(payload: SchedulePayload, startDate: string, endDate: string, students: SerializedStudent[]) {
  const visibleStudents = Array.isArray(students) ? students : []
  if (!visibleStudents.length) return ''
  const visibleStudentById = new Map(visibleStudents.map((student) => [student.id, student]))
  const ownerByName = buildUniqueStudentNameOwnerMap(payload)
  const filteredCells = filterCells(payload, startDate, endDate)

  for (const cell of filteredCells) {
    for (const desk of cell.desks || []) {
      const lessonStudents = desk.lesson && Array.isArray(desk.lesson.students) ? desk.lesson.students : []
      for (const lessonStudent of lessonStudents) {
        if (!lessonStudent || lessonStudent.lessonType === 'trial') continue
        if (lessonStudent.linkedStudentId && visibleStudentById.has(lessonStudent.linkedStudentId)) return lessonStudent.linkedStudentId
        const ownerId = ownerByName.get(getNameAssignmentKey(lessonStudent.name))
        if (ownerId && visibleStudentById.has(ownerId)) return ownerId
      }
      const statuses = Array.isArray(desk.statuses) ? desk.statuses : []
      for (const statusEntry of statuses) {
        if (!statusEntry || statusEntry.lessonType === 'trial') continue
        if (statusEntry.linkedStudentId && visibleStudentById.has(statusEntry.linkedStudentId)) return statusEntry.linkedStudentId
        const ownerId = ownerByName.get(getNameAssignmentKey(statusEntry.name))
        if (ownerId && visibleStudentById.has(ownerId)) return ownerId
      }
    }
  }
  return ''
}

function findFirstVisibleTeacherWithSchedule(payload: SchedulePayload, startDate: string, endDate: string, teachers: SerializedTeacher[]) {
  const visibleTeachers = Array.isArray(teachers) ? teachers : []
  if (!visibleTeachers.length) return ''
  const filteredCells = filterCells(payload, startDate, endDate)

  for (const cell of filteredCells) {
    for (const desk of cell.desks || []) {
      const teacherName = typeof desk.teacher === 'string' ? desk.teacher.trim() : ''
      if (!teacherName) continue
      const teacherId = typeof desk.teacherId === 'string' ? desk.teacherId.trim() : ''
      const teacherNameKey = normalizeTeacherAssignmentName(teacherName)
      const matchedTeacher = teacherId
        ? visibleTeachers.find((teacher) => teacher.id === teacherId)
        : visibleTeachers.find((teacher) => teacher.name === teacherName || teacher.fullName === teacherName || normalizeTeacherAssignmentName(teacher.name) === teacherNameKey || normalizeTeacherAssignmentName(teacher.fullName) === teacherNameKey)
      if (!matchedTeacher) continue
      const hasLesson = Boolean(desk.lesson && Array.isArray(desk.lesson.students) && desk.lesson.students.some((student) => student && student.lessonType !== 'trial'))
      const hasStatus = Array.isArray(desk.statuses) && desk.statuses.some((statusEntry) => statusEntry && statusEntry.lessonType !== 'trial')
      if (hasLesson || hasStatus) return matchedTeacher.id
    }
  }
  return ''
}

// getDefaultAppliedPersonId(埋め込みJS)の移植。preferredPersonId=現在適用中の人。
export function resolveDefaultPersonId(payload: SchedulePayload, viewType: ScheduleViewType, startDate: string, endDate: string, preferredPersonId?: string, todayKey?: string) {
  const people: Array<SerializedStudent | SerializedTeacher> = viewType === 'student'
    ? getVisibleStudents(payload, startDate, endDate, todayKey)
    : getVisibleTeachers(payload, startDate, endDate, todayKey)
  if (!people.length) return ''
  if (preferredPersonId && people.some((person) => person.id === preferredPersonId)) return preferredPersonId
  if (payload.defaultPersonId && people.some((person) => person.id === payload.defaultPersonId)) return payload.defaultPersonId
  if (viewType === 'student') {
    const highlightedStudentId = payload.highlightedStudentSlot && typeof payload.highlightedStudentSlot.studentId === 'string'
      ? payload.highlightedStudentSlot.studentId
      : ''
    if (highlightedStudentId && people.some((person) => person.id === highlightedStudentId)) return highlightedStudentId
    const firstScheduledStudentId = findFirstVisibleStudentWithSchedule(payload, startDate, endDate, people as SerializedStudent[])
    if (firstScheduledStudentId) return firstScheduledStudentId
  } else {
    const firstScheduledTeacherId = findFirstVisibleTeacherWithSchedule(payload, startDate, endDate, people as SerializedTeacher[])
    if (firstScheduledTeacherId) return firstScheduledTeacherId
  }
  return people[0].id
}

export type SchedulePeriodOption = { value: string; label: string; startDate: string; endDate: string }

export function buildPeriodOptions(payload: SchedulePayload): SchedulePeriodOption[] {
  return payload.periodBands
    .slice()
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja'))
    .map((band) => ({
      value: `${band.startDate}|${band.endDate}|${band.label}`,
      label: `${band.label} (${formatMonthDay(band.startDate)} - ${formatMonthDay(band.endDate)})`,
      startDate: band.startDate,
      endDate: band.endDate,
    }))
}

function buildStudentCountAdjustmentMap(payload: SchedulePayload, student: SerializedStudent, startDate: string, endDate: string, countKind: 'regular' | 'special') {
  const countMap: Record<string, number> = {}
  ;(payload.countAdjustments || []).forEach((entry) => {
    if (!entry || entry.countKind !== countKind) return
    const matchesStudent = entry.studentKey === student.id || entry.studentKey === student.name || entry.studentKey === student.fullName
    if (!matchesStudent) return
    if (entry.dateKey < startDate || entry.dateKey > endDate) return
    const normalizedSubject = normalizeSubjectForStudent(entry.subject, student, startDate)
    const delta = Number.isFinite(Number(entry.delta)) ? Math.trunc(Number(entry.delta)) : 0
    if (!normalizedSubject || delta === 0) return
    countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + delta
  })
  return countMap
}

function applyCountAdjustments(countMap: Record<string, number>, adjustmentMap: Record<string, number>) {
  const next = { ...(countMap || {}) }
  Object.entries(adjustmentMap || {}).forEach(([subject, rawDelta]) => {
    const delta = Number.isFinite(Number(rawDelta)) ? Math.trunc(Number(rawDelta)) : 0
    if (delta === 0) return
    const nextValue = (next[subject] || 0) + delta
    if (nextValue > 0) next[subject] = nextValue
    else delete next[subject]
  })
  return next
}

function getScheduleNoteValue(payload: SchedulePayload, viewType: ScheduleViewType, noteKey: string) {
  const notes = payload.scheduleNotes || {}
  const value = notes[`${viewType}:${noteKey}`]
  return typeof value === 'string' ? value : ''
}

function resolveQr(person: SerializedStudent | SerializedTeacher, payload: SchedulePayload, resolveQrSvg?: (token: string | undefined) => string | undefined): ScheduleQrViewData {
  const submitted = Boolean(person.submissionSubmitted)
  // 提出済みで showSubmittedQr が無効なら QR を出さずバッジのみ(buildScheduleQrHtml と同じ)。
  if (submitted && !payload.showSubmittedQr) return { svg: '', submitted }
  const svg = person.qrSvg || (resolveQrSvg ? resolveQrSvg(person.submissionToken) || '' : '')
  return { svg, submitted }
}

export type BuildStudentSheetOptions = {
  startDate: string
  endDate: string
  studentId: string
  todayKey?: string
  resolveQrSvg?: (token: string | undefined) => string | undefined
}

// buildStudentSheetHtml(埋め込みJS)のデータ版。HTML を作らず表示データ(view model)を返す。
export function buildStudentSheetViewModel(payload: SchedulePayload, options: BuildStudentSheetOptions): StudentSheetViewModel | null {
  const { startDate, endDate, studentId, todayKey } = options
  const filteredCells = filterCells(payload, startDate, endDate)
  const dateHeaders = buildDateHeaders(payload, startDate, endDate)
  const slotNumbers = getSlotNumbers(payload)
  const cellMap = buildCellMap(filteredCells)
  const assignmentMap = buildStudentAssignments(filteredCells)
  const periodSegments = buildPeriodSegments(payload, dateHeaders)
  const students = getVisibleStudents(payload, startDate, endDate, todayKey)
  const student = students.find((entry) => entry.id === studentId) || students[0] || null
  if (!student) return null
  const studentIndex = Math.max(0, students.findIndex((entry) => entry.id === student.id))
  const entries = getStudentAssignmentKeys(payload, student).flatMap((key) => assignmentMap.get(key) || [])
  const keyMap = groupScheduleEntriesBySlot(entries)
  const unavailableSlots = getUnavailableSlotsForStudent(payload, student.id)
  const subjectCounts: Record<string, number> = {}
  const plannedRegularCounts: Record<string, number> = {}
  const lectureCounts: Record<string, number> = {}
  const lectureMinutesBySubjectList: Record<string, string[]> = {}
  const desiredLectureCounts = buildDesiredLectureCountMap(payload, student, startDate, endDate)
  const regularCountAdjustments = buildStudentCountAdjustmentMap(payload, student, startDate, endDate, 'regular')
  const lectureCountAdjustments = buildStudentCountAdjustmentMap(payload, student, startDate, endDate, 'special')
  const absenceNotes = collectStudentAbsenceNotes(filteredCells, student)
  const makeupNotes = collectStudentMakeupNotes(entries)
  entries.forEach((entry) => {
    if (isStatusEntry(entry.lesson) && entry.lesson.status === 'absent') return
    if (entry.lesson.lessonType === 'special') {
      lectureCounts[entry.lesson.subject] = (lectureCounts[entry.lesson.subject] || 0) + 1
      const normalizedSubject = normalizeSubjectForStudent(entry.lesson.subject, student, startDate)
      if (!lectureMinutesBySubjectList[normalizedSubject]) lectureMinutesBySubjectList[normalizedSubject] = []
      const noteSuffix = 'noteSuffix' in entry.lesson ? entry.lesson.noteSuffix : undefined
      lectureMinutesBySubjectList[normalizedSubject].push(formatScheduleMinutesSuffix(noteSuffix))
    } else {
      subjectCounts[entry.lesson.subject] = (subjectCounts[entry.lesson.subject] || 0) + 1
    }
  })
  const desiredLectureMinutes = buildDesiredLectureMinutesMap(payload, student, startDate, endDate)
  const lectureMinutesBySubject = resolveLectureMinutesBySubject(lectureMinutesBySubjectList, desiredLectureMinutes)
  ;(Array.isArray(payload.expectedRegularOccurrences) ? payload.expectedRegularOccurrences : []).forEach((entry) => {
    if (entry.linkedStudentId !== student.id) return
    if (entry.dateKey < startDate || entry.dateKey > endDate) return
    plannedRegularCounts[entry.subject] = (plannedRegularCounts[entry.subject] || 0) + 1
  })
  const visibleRegularCounts = normalizeCountMapSubjects(subjectCounts, student, startDate)
  const visiblePlannedRegularCounts = applyCountAdjustments(normalizeCountMapSubjects(plannedRegularCounts, student, startDate), regularCountAdjustments)
  const visibleLectureCounts = normalizeCountMapSubjects(lectureCounts, student, startDate)
  const visibleDesiredLectureCounts = applyCountAdjustments(normalizeCountMapSubjects(desiredLectureCounts, student, startDate), lectureCountAdjustments)
  injectGroupClassCounts(payload, student, startDate, endDate, visibleLectureCounts, visibleDesiredLectureCounts)

  const highlightedStudentSlot = payload.highlightedStudentSlot
  const isHighlightedStudent = Boolean(highlightedStudentSlot && (
    highlightedStudentSlot.studentId === student.id
    || highlightedStudentSlot.studentName === student.fullName
    || highlightedStudentSlot.studentName === student.name
    || highlightedStudentSlot.studentDisplayName === student.name
  ))

  const rows: StudentGridRowData[] = slotNumbers.map((slotNumber) => {
    const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || `${slotNumber}限`
    const cells: StudentGridCellData[] = dateHeaders.map((dateHeader) => {
      const cell = cellMap.get(`${dateHeader.dateKey}_${slotNumber}`)
      const slotKey = `${dateHeader.dateKey}_${slotNumber}`
      const assignments = keyMap.get(slotKey) || []
      const isEditable = getEditableSpecialSessionsForStudent(payload, student.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay)
      const cards = assignments.map((assignment) => buildStudentCellCard(assignment.lesson))
      const title = assignments.length
        ? assignments.map((assignment) => [assignment.lesson.subject, scheduleLessonTypeLabels[assignment.lesson.lessonType] || assignment.lesson.lessonType, assignment.teacher].filter(Boolean).join(' / ')).join(' | ')
        : ''
      return {
        slotKey,
        dateKey: dateHeader.dateKey,
        slotNumber,
        isHoliday: !dateHeader.isOpenDay || Boolean(cell && !cell.isOpenDay),
        isUnavailable: unavailableSlots.has(slotKey),
        isEditable,
        isHighlighted: Boolean(isHighlightedStudent && highlightedStudentSlot && highlightedStudentSlot.dateKey === dateHeader.dateKey && highlightedStudentSlot.slotNumber === slotNumber),
        cards,
        title,
      }
    })
    const time = splitTimeLabel(timeLabel)
    return { slotNumber, time, cells, signature: JSON.stringify([slotNumber, time, cells]) }
  })

  const optionGradeLabel = student.currentGradeLabel || '未設定'
  const optionRows: ScheduleOptionRowData[] = Array.from({ length: 5 }, (_, index) => {
    const noteKey = `student-option-grade-${optionGradeLabel}-${index}`
    return {
      noteKey,
      value: getScheduleNoteValue(payload, 'student', noteKey),
      // optionChecks は行番号('0'..'4')キーのレコード(QR提出のチェック状態)。
      checked: Boolean(student.optionChecks && student.optionChecks[String(index)] === true),
    }
  })

  const commonNoteKey = `student-common-grade-${optionGradeLabel}`
  const individualNoteKey = `student-${student.id}`
  const allSubjectsForCounts = getVisibleSubjectsForStudent(student, startDate)

  return {
    student,
    studentIndex,
    headerName: formatStudentHeaderName(student, startDate),
    periodLabel: formatRangeLabel(startDate, endDate),
    years: getVisibleYears(dateHeaders),
    monthGroups: buildMonthGroups(dateHeaders),
    dateHeaders,
    slotNumbers,
    periodSegments,
    densityClass: getTableDensityClass(dateHeaders),
    groupRows: buildStudentGroupRows(payload, student, startDate, endDate, dateHeaders),
    rows,
    absenceNotes,
    makeupNotes,
    regularCountRows: buildCountRows(visibleRegularCounts, visiblePlannedRegularCounts),
    lectureCountRows: buildCountRows(visibleLectureCounts, visibleDesiredLectureCounts, allSubjectsForCounts, { hideZeroZero: true, labelMinutesMap: lectureMinutesBySubject }),
    regularCountMismatch: hasCountMismatch(visibleRegularCounts, visiblePlannedRegularCounts),
    lectureCountMismatch: hasCountMismatch(visibleLectureCounts, visibleDesiredLectureCounts),
    optionFieldEnabled: Boolean(payload.optionFieldEnabled),
    optionGradeLabel,
    optionRows,
    commonNoteKey,
    commonNoteValue: getScheduleNoteValue(payload, 'student', commonNoteKey),
    individualNoteKey,
    individualNoteValue: getScheduleNoteValue(payload, 'student', individualNoteKey),
    qr: resolveQr(student, payload, options.resolveQrSvg),
  }
}

export type BuildTeacherSheetOptions = {
  startDate: string
  endDate: string
  teacherId: string
  todayKey?: string
  resolveQrSvg?: (token: string | undefined) => string | undefined
}

// buildTeacherSheetHtml(埋め込みJS)のデータ版。
export function buildTeacherSheetViewModel(payload: SchedulePayload, options: BuildTeacherSheetOptions): TeacherSheetViewModel | null {
  const { startDate, endDate, teacherId, todayKey } = options
  const filteredCells = filterCells(payload, startDate, endDate)
  const dateHeaders = buildDateHeaders(payload, startDate, endDate)
  const slotNumbers = getSlotNumbers(payload)
  const cellMap = buildCellMap(filteredCells)
  const assignmentMap = buildTeacherAssignments(filteredCells)
  const periodSegments = buildPeriodSegments(payload, dateHeaders)
  const teachers = getVisibleTeachers(payload, startDate, endDate, todayKey)
  const teacher = teachers.find((entry) => entry.id === teacherId) || teachers[0] || null
  if (!teacher) return null
  const teacherIndex = Math.max(0, teachers.findIndex((entry) => entry.id === teacher.id))
  const entries = collectTeacherAssignmentEntries(assignmentMap, teacher)
  const keyMap = groupScheduleEntriesBySlot(entries)
  const unavailableSlots = getUnavailableSlotsForTeacher(payload, teacher.id)
  const regularCounts: Record<string, number> = {}
  const lectureCounts: Record<string, number> = {}
  const makeupNotes = collectTeacherMakeupNotes(entries)
  entries.forEach((entry) => {
    entry.students.forEach((student) => {
      if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1
      else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1
    })
    ;(entry.statuses || []).forEach((student) => {
      if (student.status === 'absent') return
      if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1
      else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1
    })
  })

  const rows: TeacherGridRowData[] = slotNumbers.map((slotNumber) => {
    const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || `${slotNumber}限`
    const cells: TeacherGridCellData[] = dateHeaders.map((dateHeader) => {
      const cell = cellMap.get(`${dateHeader.dateKey}_${slotNumber}`)
      const slotKey = `${dateHeader.dateKey}_${slotNumber}`
      const slotEntries = keyMap.get(slotKey) || []
      const isEditable = getEditableSpecialSessionsForTeacher(payload, teacher.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay)
      const slotStudents = slotEntries.flatMap((entry) => entry.students || [])
      const slotStatuses = slotEntries.flatMap((entry) => entry.statuses || [])
      const people = buildTeacherCellPeople(slotStudents, slotStatuses)
      const title = slotEntries.length ? [...slotStudents, ...slotStatuses].map((student) => formatTeacherTooltipEntry(student)).join(' | ') : ''
      return {
        slotKey,
        dateKey: dateHeader.dateKey,
        slotNumber,
        isHoliday: !dateHeader.isOpenDay || Boolean(cell && !cell.isOpenDay),
        isUnavailable: unavailableSlots.has(slotKey),
        isEditable,
        people,
        cardSizeClass: people.length > 2 ? 'is-multi' : people.length > 1 ? 'is-pair' : 'is-single',
        title,
      }
    })
    const time = splitTimeLabel(timeLabel)
    return { slotNumber, time, cells, signature: JSON.stringify([slotNumber, time, cells]) }
  })

  return {
    teacher,
    teacherIndex,
    headerName: formatTeacherHeaderName(teacher),
    periodLabel: formatRangeLabel(startDate, endDate),
    years: getVisibleYears(dateHeaders),
    monthGroups: buildMonthGroups(dateHeaders),
    dateHeaders,
    slotNumbers,
    periodSegments,
    densityClass: getTableDensityClass(dateHeaders),
    groupRows: buildTeacherGroupRows(payload, teacher, startDate, endDate, dateHeaders),
    rows,
    makeupNotes,
    regularCountRows: buildCountRows(regularCounts),
    lectureCountRows: buildCountRows(lectureCounts),
    salary: buildTeacherSalaryViewData(payload, entries, teacher, startDate, endDate),
    qr: resolveQr(teacher, payload, options.resolveQrSvg),
  }
}
