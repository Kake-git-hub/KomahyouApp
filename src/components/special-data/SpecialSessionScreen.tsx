import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { AppMenu } from '../navigation/AppMenu'
import { getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from './specialSessionModel'

type SpecialSessionScreenProps = {
  sessions: SpecialSessionRow[]
  students: StudentRow[]
  teachers: TeacherRow[]
  onUpdateSessions: Dispatch<SetStateAction<SpecialSessionRow[]>>
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenAutoAssignRules: () => void
  onOpenBackupRestore: () => void
}

type SessionDraft = {
  label: string
  startDate: string
  endDate: string
}

type DateCalendarProps = {
  visibleStartMonth: string
  selectedDates: string[]
  onDateClick: (date: string) => void
  rangeStart?: string
  rangeEnd?: string
  testIdPrefix: string
  showRange?: boolean
}

type XlsxModule = typeof import('xlsx')

const weekdayLabels = ['月', '火', '水', '木', '金', '土', '日']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toDateString(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function toMondayWeekdayIndex(day: number) {
  return (day + 6) % 7
}

function formatMonthLabel(monthStart: string) {
  const [year, month] = monthStart.split('-').map(Number)
  return `${year}年${month}月`
}

function formatDateLabel(value: string) {
  const date = parseDateString(value)
  return `${date.getMonth() + 1}/${date.getDate()}(${weekdayLabels[toMondayWeekdayIndex(date.getDay())]})`
}

function compareDateString(left: string, right: string) {
  return left.localeCompare(right)
}

function toMonthKey(value: string) {
  return value.slice(0, 7)
}

function shiftMonthKey(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function normalizeSessionLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeBooleanCell(value: unknown) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized === 'true'
    || normalized === '1'
    || normalized === 'yes'
    || normalized === 'y'
    || normalized === 'on'
    || normalized === '済'
    || normalized === '登録済'
    || normalized === 'はい'
}

function serializeSlotList(slots: string[]) {
  return slots.join(', ')
}

function parseSlotList(value: unknown) {
  return Array.from(new Set(
    normalizeText(value)
      .split(/[\n,、]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))
}

function serializeSubjectSlots(subjectSlots: Record<string, number>) {
  return Object.entries(subjectSlots)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right, 'ja'))
    .map(([subject, count]) => `${subject}:${Math.trunc(count)}`)
    .join(', ')
}

function parseSubjectSlots(value: unknown) {
  return normalizeText(value)
    .split(/[\n,、]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, number>>((accumulator, entry) => {
      const [subjectText, countText = ''] = entry.split(/[:：]/)
      const subject = subjectText.trim()
      const count = Math.max(0, Math.trunc(Number(countText.trim())))
      if (!subject || !Number.isFinite(count) || count <= 0) return accumulator
      accumulator[subject] = count
      return accumulator
    }, {})
}

function normalizeExcelDate(value: unknown, xlsx?: XlsxModule) {
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

function formatSlashDate(value: string) {
  const normalized = normalizeExcelDate(value)
  if (!normalized) return ''
  const [year, month, day] = normalized.split('-').map(Number)
  return `${year}/${month}/${day}`
}

function normalizeTimestampText(value: unknown) {
  const text = normalizeText(value)
  if (!text) return ''
  const matched = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!matched) return text
  const [, year, month, day, hour = '00', minute = '00'] = matched
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute}`
}

function formatSlashTimestamp(value: string) {
  const normalized = normalizeTimestampText(value)
  if (!normalized) return ''
  const [datePart, timePart = '00:00'] = normalized.split(' ')
  return `${formatSlashDate(datePart)} ${timePart}`
}

function toWorkbookDateCellValue(value: unknown) {
  const normalized = normalizeExcelDate(value)
  if (!normalized) return ''

  const [yearText, monthText, dayText] = normalized.split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
}

function createWorkbookSheet(xlsx: XlsxModule, rows: Record<string, unknown>[], dateColumns: string[] = [], headers: string[] = []) {
  const normalizedRows = rows.map((row) => {
    const orderedKeys = headers.length > 0 ? headers : Object.keys(row)
    const nextRow: Record<string, unknown> = Object.fromEntries(orderedKeys.map((key) => [key, row[key] ?? '']))
    for (const column of dateColumns) {
      if (!(column in nextRow)) continue
      nextRow[column] = toWorkbookDateCellValue(nextRow[column])
    }
    return nextRow
  })

  const resolvedHeaders = headers.length > 0 ? headers : (rows[0] ? Object.keys(rows[0]) : [])
  const sheet = normalizedRows.length > 0
    ? xlsx.utils.json_to_sheet(normalizedRows, { cellDates: true })
    : xlsx.utils.aoa_to_sheet([resolvedHeaders])

  for (const column of dateColumns) {
    const columnIndex = resolvedHeaders.indexOf(column)
    if (columnIndex < 0) continue

    for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
      const cellRef = xlsx.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })
      const cell = sheet[cellRef]
      if (!cell || !(cell.v instanceof Date)) continue
      cell.z = 'yyyy/m/d'
    }
  }

  return sheet
}

const specialSessionHeaders = ['講習ID', '講習名', '開始日', '終了日', '作成日時', '更新日時']
const studentInputHeaders = ['講習ID', '講習名', '生徒ID', '生徒名', '参加不可コマ', '希望科目数', '通常のみ', '希望科目数提出済', '入力更新日時']
const teacherInputHeaders = ['講習ID', '講習名', '講師ID', '講師名', '参加不可コマ', '講師予定提出済', '入力更新日時']

function buildStudentInputRows(sessions: SpecialSessionRow[], students: StudentRow[]) {
  const studentMap = new Map(students.map((student) => [student.id, getStudentDisplayName(student)]))
  return sessions.flatMap((session) => Object.entries(session.studentInputs).map(([studentId, input]) => ({
    講習ID: session.id,
    講習名: session.label,
    生徒ID: studentId,
    生徒名: studentMap.get(studentId) ?? studentId,
    参加不可コマ: serializeSlotList(input.unavailableSlots),
    希望科目数: serializeSubjectSlots(input.subjectSlots),
    通常のみ: input.regularOnly,
    希望科目数提出済: input.countSubmitted,
    入力更新日時: formatSlashTimestamp(input.updatedAt),
  })))
}

export function buildTemplateSpecialSessions(sessions: SpecialSessionRow[], students: StudentRow[], teachers: TeacherRow[]) {
  if (sessions.length === 0) return sessions

  const firstSession = sessions[0]
  if (!firstSession) return sessions

  const firstStudent = students[0]
  const firstTeacher = teachers[0]
  const startDate = parseDateString(firstSession.startDate)
  const secondDate = toDateString(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1))
  const thirdDate = toDateString(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 2))

  return sessions.map((session, index) => {
    if (index !== 0) return session
    return {
      ...session,
      studentInputs: firstStudent ? {
        [firstStudent.id]: {
          unavailableSlots: [`${firstSession.startDate}_2`],
          regularBreakSlots: [],
          subjectSlots: { 数: 2, 英: 1 },
          regularOnly: false,
          countSubmitted: true,
          updatedAt: `${firstSession.startDate} 10:00`,
        },
      } : {},
      teacherInputs: firstTeacher ? {
        [firstTeacher.id]: {
          unavailableSlots: [`${secondDate}_2`, `${thirdDate}_3`],
          countSubmitted: true,
          updatedAt: `${firstSession.startDate} 10:30`,
        },
      } : {},
    }
  })
}

function buildTeacherInputRows(sessions: SpecialSessionRow[], teachers: TeacherRow[]) {
  const teacherMap = new Map(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  return sessions.flatMap((session) => Object.entries(session.teacherInputs).map(([teacherId, input]) => ({
    講習ID: session.id,
    講習名: session.label,
    講師ID: teacherId,
    講師名: teacherMap.get(teacherId) ?? teacherId,
    参加不可コマ: serializeSlotList(input.unavailableSlots),
    講師予定提出済: input.countSubmitted,
    入力更新日時: formatSlashTimestamp(input.updatedAt),
  })))
}

function createSessionId() {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function buildSpecialSessionWorkbook(xlsx: XlsxModule, sessions: SpecialSessionRow[], students: StudentRow[], teachers: TeacherRow[]) {
  const workbook = xlsx.utils.book_new()

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, sessions.map((row) => ({
    講習ID: row.id,
    講習名: row.label,
    開始日: row.startDate,
    終了日: row.endDate,
    作成日時: formatSlashTimestamp(row.createdAt),
    更新日時: formatSlashTimestamp(row.updatedAt),
  })), ['開始日', '終了日'], specialSessionHeaders), '特別講習')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, buildStudentInputRows(sessions, students), [], studentInputHeaders), '生徒日程入力')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, buildTeacherInputRows(sessions, teachers), [], teacherInputHeaders), '講師日程入力')

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, [
    { 項目: '講習ID/講習名', 説明: '講習ID を優先して取り込みます。講習名だけでも既存講習へ照合します。' },
    { 項目: '開始日/終了日', 説明: '2026/3/21 のようなスラッシュ表記または Excel の日付セルで入力できます。' },
    { 項目: '作成日時/更新日時', 説明: '必要な場合のみ 2026/3/21 09:30 のように入力します。空欄ならアプリ側で補います。' },
    { 項目: '生徒日程入力', 説明: '参加不可コマは `2026-03-23_1, 2026-03-24_2` のように、希望科目数は `数:2, 英:1` のように入力します。' },
    { 項目: '講師日程入力', 説明: '参加不可コマは `2026-03-23_1, 2026-03-24_2` のように入力します。' },
  ]), '説明')

  return workbook
}

function resolveSessionIdentity(row: Record<string, unknown>, sessionsById: Map<string, SpecialSessionRow>, sessionsByLabel: Map<string, SpecialSessionRow>) {
  const sessionId = normalizeText(row['講習ID'])
  if (sessionId && sessionsById.has(sessionId)) return sessionsById.get(sessionId) ?? null

  const label = normalizeSessionLabel(normalizeText(row['講習名']))
  if (label && sessionsByLabel.has(label)) return sessionsByLabel.get(label) ?? null

  return null
}

export function parseSpecialSessionWorkbook(xlsx: XlsxModule, workbook: import('xlsx').WorkBook, fallback: SpecialSessionRow[]) {
  const sheet = workbook.Sheets['特別講習']
  if (!sheet) return fallback

  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const existingByLabel = new Map(fallback.map((row) => [normalizeSessionLabel(row.label), row]))
  const timestamp = updateTimestamp()

  const importedSessions = rows
    .map((row) => {
      const label = normalizeSessionLabel(normalizeText(row['講習名']))
      const startDate = normalizeExcelDate(row['開始日'], xlsx)
      const endDate = normalizeExcelDate(row['終了日'], xlsx)
      if (!label || !startDate || !endDate) return null

      const existing = existingByLabel.get(label)

      return {
        id: normalizeText(row['講習ID']) || existing?.id || createSessionId(),
        label,
        startDate,
        endDate,
        teacherInputs: existing?.teacherInputs ?? {},
        studentInputs: existing?.studentInputs ?? {},
        createdAt: normalizeTimestampText(row['作成日時']) || existing?.createdAt || timestamp,
        updatedAt: normalizeTimestampText(row['更新日時']) || timestamp,
      }
    })
    .filter((row): row is SpecialSessionRow => Boolean(row))

  const importedById = new Map(importedSessions.map((session) => [session.id, session]))
  const importedByLabel = new Map(importedSessions.map((session) => [normalizeSessionLabel(session.label), session]))

  const studentInputSheet = workbook.Sheets['生徒日程入力']
  if (studentInputSheet) {
    const studentInputRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(studentInputSheet, { defval: '' })
    const nextStudentInputsBySessionId = new Map(importedSessions.map((session) => [session.id, {} as SpecialSessionRow['studentInputs']]))

    for (const row of studentInputRows) {
      const session = resolveSessionIdentity(row, importedById, importedByLabel)
      const studentId = normalizeText(row['生徒ID'])
      if (!session || !studentId) continue

      nextStudentInputsBySessionId.get(session.id)![studentId] = {
        unavailableSlots: parseSlotList(row['参加不可コマ']),
        regularBreakSlots: importedById.get(session.id)?.studentInputs[studentId]?.regularBreakSlots ?? [],
        subjectSlots: normalizeBooleanCell(row['通常のみ']) ? {} : parseSubjectSlots(row['希望科目数']),
        regularOnly: normalizeBooleanCell(row['通常のみ']),
        countSubmitted: normalizeBooleanCell(row['希望科目数提出済']),
        updatedAt: normalizeTimestampText(row['入力更新日時']) || session.updatedAt || timestamp,
      }
    }

    importedSessions.forEach((session, index) => {
      importedSessions[index] = {
        ...session,
        studentInputs: nextStudentInputsBySessionId.get(session.id) ?? {},
      }
    })
  }

  const teacherInputSheet = workbook.Sheets['講師日程入力']
  if (teacherInputSheet) {
    const teacherInputRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(teacherInputSheet, { defval: '' })
    const nextTeacherInputsBySessionId = new Map(importedSessions.map((session) => [session.id, {} as SpecialSessionRow['teacherInputs']]))

    for (const row of teacherInputRows) {
      const session = resolveSessionIdentity(row, importedById, importedByLabel)
      const teacherId = normalizeText(row['講師ID'])
      if (!session || !teacherId) continue

      nextTeacherInputsBySessionId.get(session.id)![teacherId] = {
        unavailableSlots: parseSlotList(row['参加不可コマ']),
        countSubmitted: normalizeBooleanCell(row['講師予定提出済']),
        updatedAt: normalizeTimestampText(row['入力更新日時']) || session.updatedAt || timestamp,
      }
    }

    importedSessions.forEach((session, index) => {
      importedSessions[index] = {
        ...session,
        teacherInputs: nextTeacherInputsBySessionId.get(session.id) ?? {},
      }
    })
  }

  return importedSessions
}

function isDateInRange(date: string, startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return false
  return compareDateString(date, startDate) >= 0 && compareDateString(date, endDate) <= 0
}

function resolveSeasonalDraftTemplate(today = new Date()) {
  const month = today.getMonth() + 1
  if (month <= 4) {
    return { label: `${today.getFullYear()} 春期講習`, startDate: `${today.getFullYear()}-03-20`, endDate: `${today.getFullYear()}-04-07` }
  }
  if (month <= 9) {
    return { label: `${today.getFullYear()} 夏期講習`, startDate: `${today.getFullYear()}-07-21`, endDate: `${today.getFullYear()}-08-28` }
  }
  return { label: `${today.getFullYear()} 冬期講習`, startDate: `${today.getFullYear()}-12-24`, endDate: `${today.getFullYear() + 1}-01-07` }
}

function createDraft(today = new Date()): SessionDraft {
  const template = resolveSeasonalDraftTemplate(today)
  return {
    label: template.label,
    startDate: template.startDate,
    endDate: template.endDate,
  }
}

function updateTimestamp() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function DateCalendar({ visibleStartMonth, selectedDates, onDateClick, rangeStart, rangeEnd, testIdPrefix, showRange = false }: DateCalendarProps) {
  const monthStarts = [visibleStartMonth, shiftMonthKey(visibleStartMonth, 1)]

  return (
    <div className="special-session-calendar-grid">
      {monthStarts.map((monthStart) => {
        const [year, month] = monthStart.split('-').map(Number)
        const firstDay = new Date(year, month - 1, 1)
        const firstWeekday = toMondayWeekdayIndex(firstDay.getDay())
        const daysInMonth = new Date(year, month, 0).getDate()
        const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
          if (index < firstWeekday) return null
          return toDateString(new Date(year, month - 1, index - firstWeekday + 1))
        })

        return (
          <section key={monthStart} className="special-session-calendar-month">
            <div className="special-session-calendar-head">{formatMonthLabel(monthStart)}</div>
            <div className="special-session-calendar-weekdays">
              {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className="special-session-calendar-days">
              {cells.map((date, index) => {
                if (!date) return <span key={`${monthStart}_blank_${index}`} className="special-session-calendar-empty" />

                const isSelected = selectedDates.includes(date)
                const isRangeEdge = date === rangeStart || date === rangeEnd
                const isInRange = showRange && isDateInRange(date, rangeStart, rangeEnd)

                return (
                  <button
                    key={date}
                    type="button"
                    className={[
                      'special-session-date-button',
                      'tone-blue',
                      isSelected ? 'is-selected' : '',
                      isRangeEdge ? 'is-range-edge' : '',
                      isInRange ? 'is-in-range' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onDateClick(date)}
                    data-testid={`${testIdPrefix}-${date}`}
                    aria-pressed={isSelected}
                  >
                    {date.slice(-2)}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function SpecialSessionScreen({ sessions, students: _students, teachers: _teachers, onUpdateSessions, onBackToBoard, onOpenBasicData, onOpenAutoAssignRules, onOpenBackupRestore }: SpecialSessionScreenProps) {
  const [draft, setDraft] = useState<SessionDraft>(() => createDraft())
  const [statusMessage, setStatusMessage] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [draftVisibleStartMonth, setDraftVisibleStartMonth] = useState(() => toMonthKey(createDraft().startDate))
  const [editingVisibleStartMonths, setEditingVisibleStartMonths] = useState<Record<string, string>>({})
  const sortedSessions = useMemo(() => sessions.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [sessions])

  const updateSession = (id: string, patch: Partial<SpecialSessionRow>) => {
    onUpdateSessions((current) => current.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: updateTimestamp() } : row)))
  }

  const updateSessionRange = (id: string, date: string) => {
    onUpdateSessions((current) => current.map((row) => {
      if (row.id !== id) return row
      if (!row.startDate || row.endDate) {
        return { ...row, startDate: date, endDate: '', updatedAt: updateTimestamp() }
      }

      const [startDate, endDate] = compareDateString(date, row.startDate) < 0 ? [date, row.startDate] : [row.startDate, date]
      return { ...row, startDate, endDate, updatedAt: updateTimestamp() }
    }))
  }

  const removeSession = (id: string) => {
    if (!window.confirm('この特別講習データを削除します。よろしいですか。')) {
      setStatusMessage('特別講習データの削除をキャンセルしました。')
      return
    }
    onUpdateSessions((current) => current.filter((row) => row.id !== id))
    setEditingSessionId((current) => (current === id ? null : current))
    setStatusMessage('特別講習データを削除しました。')
  }

  const handleDraftRangeSelect = (date: string) => {
    setDraft((current) => {
      if (!current.startDate || current.endDate) {
        setDraftVisibleStartMonth(toMonthKey(date))
        return { ...current, startDate: date, endDate: '' }
      }

      const [startDate, endDate] = compareDateString(date, current.startDate) < 0 ? [date, current.startDate] : [current.startDate, date]
      setDraftVisibleStartMonth(toMonthKey(startDate))
      return { ...current, startDate, endDate }
    })
  }

  const clearDraftRange = () => {
    setDraft((current) => ({ ...current, startDate: '', endDate: '' }))
  }

  const openCreateForm = () => {
    const nextDraft = createDraft()
    setDraft(nextDraft)
    setDraftVisibleStartMonth(toMonthKey(nextDraft.startDate))
    setShowCreateForm(true)
  }

  const shiftEditingVisibleMonth = (id: string, offset: number, fallbackDate: string) => {
    setEditingVisibleStartMonths((current) => {
      const base = current[id] ?? toMonthKey(fallbackDate)
      return { ...current, [id]: shiftMonthKey(base, offset) }
    })
  }

  const createSession = () => {
    const normalizedLabel = normalizeSessionLabel(draft.label)
    if (!normalizedLabel) {
      setStatusMessage('講習名を入力してください。')
      return
    }
    if (!draft.startDate || !draft.endDate) {
      setStatusMessage('講習期間はカレンダーで開始日と終了日を選択してください。')
      return
    }
    if (sessions.some((session) => normalizeSessionLabel(session.label) === normalizedLabel)) {
      setStatusMessage('同じ講習名の特別講習データが既にあります。重複を解消してください。')
      return
    }

    const timestamp = updateTimestamp()
    onUpdateSessions((current) => [{
      id: `session_${Date.now().toString(36)}`,
      label: normalizedLabel,
      startDate: draft.startDate,
      endDate: draft.endDate,
      teacherInputs: {},
      studentInputs: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }, ...current])
    const nextDraft = createDraft()
    setDraft(nextDraft)
    setDraftVisibleStartMonth(toMonthKey(nextDraft.startDate))
    setShowCreateForm(false)
    setStatusMessage('特別講習データを追加しました。')
  }

  return (
    <div className="page-shell page-shell-basic-data">
      <section className="toolbar-panel" aria-label="特別講習データの操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div className="toolbar-group toolbar-group-compact">
            <AppMenu
              currentScreen="special-data"
              onNavigate={(screen) => {
                if (screen === 'board') onBackToBoard()
                if (screen === 'basic-data') onOpenBasicData()
                if (screen === 'auto-assign-rules') onOpenAutoAssignRules()
                if (screen === 'backup-restore') onOpenBackupRestore()
              }}
              buttonTestId="special-data-menu-button"
              boardItemTestId="special-data-menu-open-board-button"
              basicDataItemTestId="special-data-menu-open-basic-data-button"
              autoAssignRulesItemTestId="special-data-menu-open-auto-assign-rules-button"
              backupRestoreItemTestId="special-data-menu-open-backup-button"
            />
          </div>
        </div>
        {statusMessage ? (
          <div className="toolbar-row toolbar-row-secondary">
            <div className="toolbar-status" data-testid="special-data-status">{statusMessage}</div>
          </div>
        ) : null}
      </section>

      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified special-session-panel" data-testid="special-data-screen">
          <div className="basic-data-header">
            <div>
              <h2>講習設定</h2>
              <p className="basic-data-subcopy">ここでは講習名と講習期間だけを管理します。欠席不可入力はコマ表の講習期間帯をクリックして別タブで行います。</p>
            </div>
          </div>

          <section className="basic-data-section-card">
            <div className="special-session-list-header">
              <div className="basic-data-card-head">
                <h3>特別講習一覧</h3>
              </div>
              <button className="primary-button" type="button" onClick={() => (showCreateForm ? setShowCreateForm(false) : openCreateForm())} data-testid="special-data-toggle-create-button">
                {showCreateForm ? '作成フォームを閉じる' : '新規作成'}
              </button>
            </div>

            {showCreateForm ? (
              <section className="basic-data-section-card" data-testid="special-data-create-form">
                <div className="basic-data-card-head">
                  <h3>新しい特別講習を作成</h3>
                </div>
                <div className="special-session-name-row">
                  <label className="basic-data-inline-field basic-data-inline-field-medium special-session-inline-label">
                    <span>講習名</span>
                    <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="2027 春期講習テスト" data-testid="special-data-draft-label" />
                  </label>
                </div>
                <section className="special-session-picker-panel">
                  <div className="special-session-picker-head">
                    <div>
                      <strong>講習期間</strong>
                      <p>{draft.startDate && draft.endDate ? `${formatDateLabel(draft.startDate)} 〜 ${formatDateLabel(draft.endDate)}` : draft.startDate ? `${formatDateLabel(draft.startDate)} を開始日にしました。終了日を選択してください。` : '開始日と終了日を順にクリックしてください。'}</p>
                    </div>
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => setDraftVisibleStartMonth((current) => shiftMonthKey(current, -1))}>前月</button>
                      <button className="secondary-button slim" type="button" onClick={() => setDraftVisibleStartMonth((current) => shiftMonthKey(current, 1))}>次月</button>
                      <button className="secondary-button slim" type="button" onClick={clearDraftRange} data-testid="special-data-clear-period-button">期間クリア</button>
                    </div>
                  </div>
                  <DateCalendar
                    visibleStartMonth={draftVisibleStartMonth}
                    selectedDates={[draft.startDate, draft.endDate].filter(Boolean)}
                    onDateClick={handleDraftRangeSelect}
                    rangeStart={draft.startDate}
                    rangeEnd={draft.endDate}
                    testIdPrefix="special-data-period-date"
                    showRange
                  />
                </section>
                <div className="basic-data-actions-row">
                  <button className="primary-button" type="button" onClick={createSession} data-testid="special-data-create-button">特別講習を作成</button>
                </div>
              </section>
            ) : null}

            <table className="basic-data-table" data-testid="special-data-sessions-table">
              <thead><tr><th>講習名</th><th>講習期間</th><th>更新</th><th>操作</th></tr></thead>
              <tbody>
                {sortedSessions.flatMap((row) => {
                  const visibleStartMonth = editingVisibleStartMonths[row.id] ?? toMonthKey(row.startDate || toDateString(new Date()))
                  const isEditing = editingSessionId === row.id

                  return [
                    <tr key={row.id}>
                      <td>
                        <div className="special-session-list-name" data-testid={`special-data-session-summary-${row.id}`}>
                          <strong>{row.label}</strong>
                        </div>
                      </td>
                      <td>{row.startDate && row.endDate ? `${row.startDate} 〜 ${row.endDate}` : '未設定'}</td>
                      <td><span className="basic-data-muted-inline">{row.updatedAt}</span></td>
                      <td>
                        <div className="basic-data-row-actions">
                          <button className="secondary-button slim" type="button" onClick={() => setEditingSessionId((current) => (current === row.id ? null : row.id))} data-testid={`special-data-edit-session-${row.id}`}>{isEditing ? '編集を閉じる' : '編集'}</button>
                          <button className="secondary-button slim" type="button" onClick={() => removeSession(row.id)}>削除</button>
                        </div>
                      </td>
                    </tr>,
                    isEditing ? (
                      <tr key={`${row.id}_editor`}>
                        <td colSpan={4}>
                          <div className="special-session-editor-panel">
                            <div className="special-session-name-row">
                              <label className="basic-data-inline-field basic-data-inline-field-medium special-session-inline-label">
                                <span>講習名</span>
                                <input value={row.label} onChange={(event) => updateSession(row.id, { label: event.target.value })} data-testid={`special-data-session-label-${row.id}`} />
                              </label>
                            </div>
                            <section className="special-session-picker-panel">
                              <div className="special-session-picker-head">
                                <div>
                                  <strong>講習期間</strong>
                                  <p>{row.startDate && row.endDate ? `${formatDateLabel(row.startDate)} 〜 ${formatDateLabel(row.endDate)}` : row.startDate ? `${formatDateLabel(row.startDate)} を開始日にしました。終了日を選択してください。` : '開始日と終了日を順にクリックしてください。'}</p>
                                </div>
                                <div className="basic-data-row-actions">
                                  <button className="secondary-button slim" type="button" onClick={() => shiftEditingVisibleMonth(row.id, -1, row.startDate)}>前月</button>
                                  <button className="secondary-button slim" type="button" onClick={() => shiftEditingVisibleMonth(row.id, 1, row.startDate)}>次月</button>
                                </div>
                              </div>
                              <DateCalendar
                                visibleStartMonth={visibleStartMonth}
                                selectedDates={[row.startDate, row.endDate].filter(Boolean)}
                                onDateClick={(date) => updateSessionRange(row.id, date)}
                                rangeStart={row.startDate}
                                rangeEnd={row.endDate}
                                testIdPrefix={`special-data-session-period-${row.id}`}
                                showRange
                              />
                            </section>
                            <p className="basic-data-subcopy">欠席不可日の入力は、コマ表に戻ってこの講習の期間帯をクリックすると別タブで開きます。</p>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
              </tbody>
            </table>
          </section>
        </section>
      </main>
    </div>
  )
}
