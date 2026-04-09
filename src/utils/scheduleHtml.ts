import { compareStudentsByCurrentGradeThenName, getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveCurrentStudentGradeLabel, type StudentRow, type TeacherRow } from '../components/basic-data/basicDataModel'
import { capRegularLessonDatesPerMonth, isRegularLessonParticipantActiveOnDate, resolveRegularLessonParticipantPeriod, type RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { ScheduleCountAdjustmentEntry } from '../types/appState'
import type { SlotCell } from '../components/schedule-board/types'
import type { ClassroomSettings } from '../types/appState'
import { generateQrSvg } from './qrcode'
import { buildSubmissionUrl } from './scheduleQrConfig'
import { resolveDisplayedSubjectForGrade } from './studentGradeSubject'

const scheduleQrSvgCache = new Map<string, string>()

type SerializedStudent = {
  id: string
  name: string
  fullName: string
  currentGradeLabel: string
  currentGradeOrder: number
  birthDate: string
  entryDate: string
  withdrawDate: string
  isHidden: boolean
  qrSvg?: string
  submissionSubmitted?: boolean
}

type SerializedTeacher = {
  id: string
  name: string
  fullName?: string
  entryDate: string
  withdrawDate: string
  isHidden: boolean
  memo: string
  subjects: string[]
  qrSvg?: string
  submissionSubmitted?: boolean
}

type SerializedStudentEntry = {
  id: string
  linkedStudentId?: string
  name: string
  grade: string
  subject: string
  lessonType: string
  teacherType: string
  manualAdded: boolean
  makeupSourceLabel?: string
  warning?: string
}

type SerializedStudentStatusEntry = {
  id: string
  linkedStudentId?: string
  name: string
  grade: string
  subject: string
  lessonType: string
  teacherType: string
  teacherName: string
  recordedAt: string
  status: 'absent' | 'absent-no-makeup' | 'attended'
}

type SerializedCell = {
  dateKey: string
  dateLabel: string
  dayLabel: string
  slotNumber: number
  slotLabel: string
  timeLabel: string
  isOpenDay: boolean
  desks: Array<{
    teacher: string
    statuses?: SerializedStudentStatusEntry[]
    lesson?: {
      note?: string
      students: SerializedStudentEntry[]
    }
  }>
}

type SerializedStudentSpecialSessionInput = {
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  countSubmitted: boolean
  submissionToken?: string
}

type SerializedTeacherSpecialSessionInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
  submissionToken?: string
}

type SerializedSpecialSession = {
  id: string
  label: string
  startDate: string
  endDate: string
  teacherInputs: Record<string, SerializedTeacherSpecialSessionInput>
  studentInputs: Record<string, SerializedStudentSpecialSessionInput>
}

type SerializedExpectedRegularOccurrence = {
  linkedStudentId: string
  subject: string
  dateKey: string
}

type SerializedScheduleCountAdjustment = {
  studentKey: string
  subject: string
  countKind: 'regular' | 'special'
  dateKey: string
  delta: number
}

type SchedulePayload = {
  titleLabel: string
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue: string
  availableStartDate: string
  availableEndDate: string
  availability: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands: Array<{ id?: string; label: string; startDate: string; endDate: string }>
  students: SerializedStudent[]
  teachers: SerializedTeacher[]
  cells: SerializedCell[]
  plannedCells: SerializedCell[]
  expectedRegularOccurrences: SerializedExpectedRegularOccurrence[]
  highlightedStudentSlot?: {
    studentId: string
    studentName?: string
    studentDisplayName?: string
    dateKey: string
    slotNumber: number
  }
  countAdjustments: SerializedScheduleCountAdjustment[]
  specialSessions: SerializedSpecialSession[]
}

type OpenScheduleHtmlParams = {
  cells: SlotCell[]
  plannedCells: SlotCell[]
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue?: string
  titleLabel: string
  classroomSettings: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands?: Pick<SpecialSessionRow, 'id' | 'label' | 'startDate' | 'endDate'>[]
  specialSessions?: SpecialSessionRow[]
  targetWindow?: Window | null
}

function buildSubmissionQrSvg(token: string | undefined) {
  if (!token) return undefined
  const url = buildSubmissionUrl(token)
  if (!url) return undefined
  const cached = scheduleQrSvgCache.get(token)
  if (cached) return cached
  const svg = generateQrSvg(url, 52)
  scheduleQrSvgCache.set(token, svg)
  return svg
}

function findOverlappingSession(specialSessions: SpecialSessionRow[] | undefined, startDate: string, endDate: string) {
  if (!specialSessions?.length) return { session: undefined, error: undefined }
  const overlapping = specialSessions.filter((s) => s.startDate <= endDate && s.endDate >= startDate)
  if (overlapping.length === 0) return { session: undefined, error: undefined }
  if (overlapping.length > 1) return { session: undefined, error: '複数の講習期間が重複しています。QRを表示できません。' }
  return { session: overlapping[0], error: undefined }
}

type OpenStudentScheduleHtmlParams = OpenScheduleHtmlParams & {
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[]
  highlightedStudentSlot?: {
    studentId: string
    studentName?: string
    studentDisplayName?: string
    dateKey: string
    slotNumber: number
  } | null
}

type OpenTeacherScheduleHtmlParams = OpenScheduleHtmlParams & {
  teachers: TeacherRow[]
}

function serializeCells(cells: SlotCell[], resolveLinkedStudentId?: (studentName: string) => string | undefined): SerializedCell[] {
  return cells
    .slice()
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey)
      return left.slotNumber - right.slotNumber
    })
    .map((cell) => ({
      dateKey: cell.dateKey,
      dateLabel: cell.dateLabel,
      dayLabel: cell.dayLabel,
      slotNumber: cell.slotNumber,
      slotLabel: cell.slotLabel,
      timeLabel: cell.timeLabel,
      isOpenDay: cell.isOpenDay,
      desks: cell.desks.map((desk) => ({
        teacher: desk.teacher,
        statuses: desk.statusSlots
          ?.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .map((entry) => ({
            id: entry.id,
            linkedStudentId: entry.managedStudentId,
            name: entry.name,
            grade: entry.grade,
            subject: resolveDisplayedSubjectForGrade(entry.subject, entry.grade),
            lessonType: entry.lessonType,
            teacherType: entry.teacherType,
            teacherName: entry.teacherName,
            recordedAt: entry.recordedAt,
            status: entry.status,
          })),
        lesson: desk.lesson
          ? {
              note: desk.lesson.note,
              students: desk.lesson.studentSlots
                .filter((student): student is NonNullable<typeof student> => Boolean(student))
                .map((student) => ({
                  id: student.id,
                  linkedStudentId: resolveLinkedStudentId?.(student.name),
                  name: student.name,
                  grade: student.grade,
                  subject: resolveDisplayedSubjectForGrade(student.subject, student.grade),
                  lessonType: student.lessonType,
                  teacherType: student.teacherType,
                  manualAdded: Boolean(student.manualAdded),
                  makeupSourceLabel: student.makeupSourceLabel,
                  warning: student.warning,
                })),
            }
          : undefined,
      })),
    }))
}

function createPopupWindow(targetName: string, targetWindow?: Window | null) {
  const openedWindow = window.open('', targetName)
  if (openedWindow) return openedWindow
  if (targetWindow && !targetWindow.closed) {
    targetWindow.focus()
    return targetWindow
  }
  return null
}

function startOfMonth(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, 1)
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function iterateMonthsInRange(startDateKey: string, endDateKey: string) {
  const months: Array<{ year: number; monthIndex: number }> = []
  const cursor = startOfMonth(startDateKey)
  const limit = startOfMonth(endDateKey)

  while (cursor <= limit) {
    months.push({ year: cursor.getFullYear(), monthIndex: cursor.getMonth() })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

function getScheduledDatesInMonth(year: number, monthIndex: number, dayOfWeek: number) {
  const dates: string[] = []
  const cursor = new Date(year, monthIndex, 1)

  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === dayOfWeek) dates.push(toDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

export function buildExpectedRegularOccurrences(params: {
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  startDate: string
  endDate: string
}) {
  const { students, regularLessons, startDate, endDate } = params
  const studentById = new Map(students.map((student) => [student.id, student]))
  const occurrences: SerializedExpectedRegularOccurrence[] = []

  for (const row of regularLessons) {
    const participants = [
      { studentId: row.student1Id, subject: row.subject1 },
      { studentId: row.student2Id, subject: row.subject2 },
    ].filter((entry) => entry.studentId && entry.subject)

    for (const participant of participants) {
      const student = studentById.get(participant.studentId)
      if (!student) continue

      const participantPeriod = resolveRegularLessonParticipantPeriod(row)
      const visibleStartDate = participantPeriod.startDate > startDate ? participantPeriod.startDate : startDate
      const visibleEndDate = participantPeriod.endDate < endDate ? participantPeriod.endDate : endDate
      if (visibleEndDate < visibleStartDate) continue

      for (const { year, monthIndex } of iterateMonthsInRange(visibleStartDate, visibleEndDate)) {
        const monthScheduledDates = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
          .filter((dateKey) => dateKey >= participantPeriod.startDate && dateKey <= participantPeriod.endDate)
          .filter((dateKey) => isRegularLessonParticipantActiveOnDate(row, dateKey))
          .filter((dateKey) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey))

        const cappedDates = capRegularLessonDatesPerMonth(monthScheduledDates)
        for (const dateKey of cappedDates) {
          if (dateKey < visibleStartDate || dateKey > visibleEndDate) continue
          occurrences.push({ linkedStudentId: student.id, subject: participant.subject, dateKey })
        }
      }
    }
  }

  return occurrences.sort((left, right) => (
    left.linkedStudentId.localeCompare(right.linkedStudentId)
    || left.dateKey.localeCompare(right.dateKey)
    || left.subject.localeCompare(right.subject, 'ja')
  ))
}

function createBasePayload(params: OpenScheduleHtmlParams, linkedStudents: StudentRow[] = []): Omit<SchedulePayload, 'students' | 'teachers'> {
  const linkedStudentIdByName = new Map(linkedStudents.flatMap((student) => {
    const displayName = getStudentDisplayName(student)
    return [[student.name, student.id], [displayName, student.id]] as Array<[string, string]>
  }))
  const serializedCells = serializeCells(params.cells, (studentName) => linkedStudentIdByName.get(studentName))
  const serializedPlannedCells = serializeCells(params.plannedCells, (studentName) => linkedStudentIdByName.get(studentName))
  const availableStartDate = serializedCells[0]?.dateKey ?? params.defaultStartDate
  const availableEndDate = serializedCells[serializedCells.length - 1]?.dateKey ?? params.defaultEndDate

  return {
    titleLabel: params.titleLabel,
    defaultStartDate: params.defaultStartDate,
    defaultEndDate: params.defaultEndDate,
    defaultPeriodValue: params.defaultPeriodValue || '',
    availableStartDate,
    availableEndDate,
    availability: {
      closedWeekdays: [...params.classroomSettings.closedWeekdays],
      holidayDates: [...params.classroomSettings.holidayDates],
      forceOpenDates: [...params.classroomSettings.forceOpenDates],
    },
    periodBands: (params.periodBands ?? []).map((period) => ({
      id: 'id' in period ? period.id : undefined,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
    })),
    cells: serializedCells,
    plannedCells: serializedPlannedCells,
    expectedRegularOccurrences: [],
    highlightedStudentSlot: undefined,
    countAdjustments: [],
    specialSessions: (params.specialSessions ?? []).map((session) => ({
      id: session.id,
      label: session.label,
      startDate: session.startDate,
      endDate: session.endDate,
      teacherInputs: Object.fromEntries(Object.entries(session.teacherInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        countSubmitted: Boolean(input.countSubmitted),
        submissionToken: input.submissionToken ?? undefined,
      }])),
      studentInputs: Object.fromEntries(Object.entries(session.studentInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        subjectSlots: input.subjectSlots && typeof input.subjectSlots === 'object' ? { ...input.subjectSlots } : {},
        regularOnly: Boolean(input.regularOnly),
        countSubmitted: Boolean(input.countSubmitted),
        submissionToken: input.submissionToken ?? undefined,
      }])),
    })),
  }
}

export function buildSerializedScheduleCountAdjustments(params: {
  cells: SlotCell[]
  scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[]
}) {
  const entries = new Map<string, SerializedScheduleCountAdjustment>()

  const appendEntry = (entry: SerializedScheduleCountAdjustment) => {
    const studentKey = String(entry.studentKey || '').trim()
    const subject = String(entry.subject || '').trim()
    const dateKey = String(entry.dateKey || '').trim()
    const delta = Number.isFinite(Number(entry.delta)) ? Math.trunc(Number(entry.delta)) : 0
    if (!studentKey || !subject || !dateKey || delta === 0) return

    const key = `${studentKey}__${subject}__${entry.countKind}__${dateKey}`
    const current = entries.get(key)
    const nextDelta = (current?.delta ?? 0) + delta
    if (nextDelta === 0) {
      entries.delete(key)
      return
    }

    entries.set(key, {
      studentKey,
      subject,
      countKind: entry.countKind,
      dateKey,
      delta: nextDelta,
    })
  }

  params.cells.forEach((cell) => {
    cell.desks.forEach((desk) => {
      desk.lesson?.studentSlots.forEach((student) => {
        if (!student?.manualAdded) return
        appendEntry({
          studentKey: student.managedStudentId ?? student.name,
          subject: student.subject,
          countKind: student.lessonType === 'special' ? 'special' : 'regular',
          dateKey: cell.dateKey,
          delta: 1,
        })
      })
    })
  })

  for (const adjustment of params.scheduleCountAdjustments ?? []) {
    appendEntry({
      studentKey: adjustment.studentKey,
      subject: adjustment.subject,
      countKind: adjustment.countKind,
      dateKey: adjustment.dateKey,
      delta: adjustment.delta,
    })
  }

  return Array.from(entries.values()).sort((left, right) => (
    left.studentKey.localeCompare(right.studentKey, 'ja')
    || left.dateKey.localeCompare(right.dateKey)
    || left.countKind.localeCompare(right.countKind)
    || left.subject.localeCompare(right.subject, 'ja')
  ))
}

function buildStudentPayload(params: OpenStudentScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params, params.students)
  const expectedRegularOccurrences = buildExpectedRegularOccurrences({
    students: params.students,
    regularLessons: params.regularLessons,
    startDate: basePayload.availableStartDate,
    endDate: basePayload.availableEndDate,
  })

  const currentReferenceDate = getReferenceDateKey(new Date())
  const overlappingResult = findOverlappingSession(params.specialSessions, params.defaultStartDate, params.defaultEndDate)
  const targetSession = overlappingResult.session

  return {
    ...basePayload,
    expectedRegularOccurrences,
    highlightedStudentSlot: params.highlightedStudentSlot ?? undefined,
    countAdjustments: buildSerializedScheduleCountAdjustments({
      cells: params.cells,
      scheduleCountAdjustments: params.scheduleCountAdjustments,
    }),
    students: params.students
      .slice()
      .sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, currentReferenceDate))
      .map((student) => {
      const studentInput = targetSession?.studentInputs[student.id]
      return {
      id: student.id,
      name: getStudentDisplayName(student),
      fullName: student.name,
      currentGradeLabel: resolveCurrentStudentGradeLabel(student, currentReferenceDate),
      currentGradeOrder: (() => {
        const gradeLabel = resolveCurrentStudentGradeLabel(student, currentReferenceDate)
        if (gradeLabel === '未就学') return 0
        const elementaryMatch = gradeLabel.match(/^小(\d+)$/)
        if (elementaryMatch) return Number(elementaryMatch[1])
        const middleMatch = gradeLabel.match(/^中(\d+)$/)
        if (middleMatch) return 100 + Number(middleMatch[1])
        const highMatch = gradeLabel.match(/^高(\d+)$/)
        if (highMatch) return 200 + Number(highMatch[1])
        if (gradeLabel === '入塾前') return 900
        if (gradeLabel === '退塾') return 901
        if (gradeLabel === '非表示') return 902
        return 999
      })(),
      birthDate: student.birthDate,
      entryDate: student.entryDate,
      withdrawDate: student.withdrawDate,
      isHidden: student.isHidden,
      qrSvg: buildSubmissionQrSvg(studentInput?.submissionToken),
      submissionSubmitted: Boolean(studentInput?.countSubmitted),
    }}),
    teachers: [],
  }
}

function buildTeacherPayload(params: OpenTeacherScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params)
  const overlappingResult = findOverlappingSession(params.specialSessions, params.defaultStartDate, params.defaultEndDate)
  const targetSession = overlappingResult.session

  return {
    ...basePayload,
    countAdjustments: [],
    students: [],
    teachers: params.teachers.map((teacher) => {
      const teacherInput = targetSession?.teacherInputs[teacher.id]
      return {
      id: teacher.id,
      name: getTeacherDisplayName(teacher),
      fullName: teacher.name,
      entryDate: teacher.entryDate,
      withdrawDate: teacher.withdrawDate,
      isHidden: teacher.isHidden,
      memo: teacher.memo,
      subjects: teacher.subjectCapabilities.map((capability) => `${capability.subject}${capability.maxGrade}`),
      qrSvg: buildSubmissionQrSvg(teacherInput?.submissionToken),
      submissionSubmitted: Boolean(teacherInput?.countSubmitted),
    }}),
  }
}

function createScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher') {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c')
  const viewLabel = viewType === 'student' ? '生徒日程表' : '講師日程表'

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${viewLabel}</title>
    <style>
      :root {
        color-scheme: light;
        --paper: #ffffff;
        --line: #111111;
        --soft-line: #777777;
        --ink: #111111;
        --muted: #666666;
        --sun: #d00000;
        --sat: #003cff;
        --holiday-bg: #d9dde3;
        --header-bg: #f8f8f8;
        --schedule-toolbar-offset: 0px;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: #f2f2f2;
        color: var(--ink);
        font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif;
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      html {
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      .pages::-webkit-scrollbar {
        width: 12px;
        height: 12px;
      }

      html::-webkit-scrollbar-track,
      body::-webkit-scrollbar-track,
      .pages::-webkit-scrollbar-track {
        background: #e6ebf2;
      }

      html::-webkit-scrollbar-thumb,
      body::-webkit-scrollbar-thumb,
      .pages::-webkit-scrollbar-thumb {
        background: #8f9cac;
        border: 2px solid #e6ebf2;
        border-radius: 999px;
      }

      .toolbar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 20;
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        align-items: end;
        padding: 6px 12px;
        border-bottom: 1px solid #c9c9c9;
        background: rgba(255, 255, 255, 0.97);
        white-space: nowrap;
        overflow: hidden;
      }

      .toolbar-field {
        display: grid;
        gap: 2px;
        flex-shrink: 1;
        min-width: 0;
      }

      .toolbar-spacer {
        flex: 1 1 auto;
        min-width: 0;
      }

      .toolbar-actions {
        display: flex;
        align-items: end;
        gap: 6px;
        flex-shrink: 0;
      }

      .toolbar-field label,
      .toolbar-summary,
      .toolbar-title {
        font-size: 11px;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .interaction-lock-banner {
        margin: 0 16px 12px;
        padding: 10px 14px;
        border: 1px solid #c5d3e4;
        background: #eef4fb;
        color: #244564;
        font-size: 12px;
        line-height: 1.5;
      }

      body.surface-locked .toolbar,
      body.surface-locked .pages {
        opacity: 0.82;
      }

      .toolbar-title {
        flex-shrink: 0;
        font-weight: 700;
        color: var(--ink);
        font-size: 13px;
      }

      .toolbar input {
        min-width: 0;
        width: 130px;
        padding: 5px 6px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
        font-size: 13px;
      }

      .toolbar-field--search input {
        width: 150px;
      }

      .toolbar select {
        min-width: 0;
        width: 160px;
        padding: 5px 6px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
        font-size: 13px;
        background: #ffffff;
      }

      .toolbar button {
        height: 32px;
        padding: 0 12px;
        border: 1px solid #333333;
        border-radius: 0;
        background: #ffffff;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        color: #111111;
        white-space: nowrap;
      }

      .toolbar button.secondary {
        background: #f3f3f3;
        color: var(--ink);
      }

      .pages {
        display: grid;
        gap: 12px;
        padding: calc(var(--schedule-toolbar-offset) + 12px) 12px 12px;
        justify-content: center;
        align-content: start;
        overflow: auto;
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      .sheet {
        background: var(--paper);
        border: 1.5px solid var(--line);
        border-radius: 0;
        padding: 10px;
        box-shadow: none;
        break-inside: avoid;
        width: calc(100vw - 24px);
        aspect-ratio: 297 / 210;
        overflow: hidden;
      }

      .sheet-top {
        display: grid;
        grid-template-columns: 150px 172px minmax(0, 1fr) auto;
        gap: 6px;
        align-items: stretch;
        margin-bottom: 8px;
      }

      .logo-box,
      .school-box,
      .title-box,
      .meta-box {
        border: 0;
        min-height: 44px;
        background: #ffffff;
      }

      .logo-box {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        padding: 2px 4px;
        cursor: pointer;
      }

      .logo-placeholder {
        font-size: 11px;
        color: var(--muted);
      }

      .logo-image {
        max-width: 100%;
        max-height: 36px;
        object-fit: contain;
        display: block;
      }

      .school-box {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 3px 8px;
        min-width: 200px;
      }

      .school-input {
        width: 100%;
        min-height: 34px;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 13px;
        color: #444444;
        background: transparent;
        resize: none;
        line-height: 1.2;
        white-space: nowrap;
      }

      .title-box {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        min-width: 0;
      }

      .title-input {
        width: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        font: inherit;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-align: center;
      }

      .meta-box {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 3px 8px;
        gap: 10px;
        font-size: 13px;
        font-weight: 700;
        min-width: 0;
        max-width: 100%;
      }

      .meta-qr-block {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        line-height: 0;
      }

      .meta-info {
        display: grid;
        align-content: center;
        justify-items: end;
        gap: 2px;
      }

      .meta-row {
        display: flex;
        gap: 10px;
        align-items: center;
        white-space: nowrap;
      }

      .person-meta-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        max-width: 100%;
      }

      .meta-label {
        font-weight: 700;
      }

      .page-count {
        color: var(--muted);
        font-weight: 400;
      }

      .print-only-hidden {
        display: inline;
      }

      .qr-code {
        flex: 0 0 auto;
        line-height: 0;
      }

      .qr-code.is-hidden {
        display: none;
      }

      .qr-code svg {
        display: block;
      }

      .submission-badge {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        background: #e8f5e8;
        color: #2a7e2a;
        font-size: 10px;
        font-weight: 700;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid #b5d9b5;
        white-space: nowrap;
        text-align: center;
        line-height: 1.2;
        padding: 2px;
      }

      .submission-badge:hover {
        background: #d0ecd0;
      }

      table.schedule-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .schedule-table th,
      .schedule-table td {
        border: 1.5px solid var(--line);
      }

      .schedule-table thead th {
        background: #ffffff;
        text-align: center;
        padding: 4px 2px;
        font-size: 12px;
      }

      .schedule-table .time-col {
        width: 62px;
        min-width: 62px;
        background: #ffffff;
      }

      .month-row th {
        background: var(--header-bg);
        font-size: 13px;
        padding-top: 2px;
        padding-bottom: 2px;
      }

      .time-corner {
        background: var(--header-bg);
        padding: 0;
      }

      .time-corner-box {
        min-height: 58px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 1px;
        padding: 3px 2px;
      }

      .time-corner-year {
        display: block;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.05;
      }

      .period-row th {
        background: #ffffff;
        padding: 3px 2px;
      }

      .period-gap {
        background: #ffffff;
      }

      .period-band {
        background: #fff6cf;
      }

      .period-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        min-height: 22px;
        background: #ffe48a;
        color: #5a4200;
        font-size: 12px;
        font-weight: 700;
        border: 1.5px solid #b18d26;
        padding: 0 6px;
      }

      .period-pill-center {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .period-pill-button {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .period-pill-button.is-registered .period-pill {
        background: #d8f0d8;
        border-color: #5b8f5b;
        color: #214a21;
      }

      .period-pill-state {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }

      .period-pill-state-inline {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        color: #5a4200;
      }

      .count-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(17, 17, 17, 0.28);
      }

      .count-modal {
        width: min(420px, 100%);
        border: 1.5px solid var(--line);
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
      }

      .count-modal-head,
      .count-modal-body,
      .count-modal-actions {
        padding: 14px 16px;
      }

      .count-modal-head {
        border-bottom: 1px solid #d7d7d7;
        display: grid;
        gap: 4px;
      }

      .count-modal-title {
        font-size: 16px;
        font-weight: 700;
      }

      .count-modal-subtitle,
      .count-modal-note {
        font-size: 12px;
        color: var(--muted);
      }

      .count-modal-body {
        display: grid;
        gap: 12px;
      }

      .count-modal-table {
        width: 100%;
        border-collapse: collapse;
      }

      .count-modal-table td {
        border: 1px solid #d7d7d7;
        padding: 8px 10px;
        font-size: 13px;
      }

      .count-modal-table input[type="number"] {
        width: 84px;
        padding: 6px 8px;
        border: 1px solid #888888;
        font: inherit;
      }

      .count-modal-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .count-modal-actions {
        border-top: 1px solid #d7d7d7;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .period-pill-label {
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .period-pill-edge {
        flex: 0 0 auto;
        font-size: 11px;
        line-height: 1;
      }

      .date-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .date-label,
      .weekday-label {
        display: block;
      }

      .weekday-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .weekday-sun { color: var(--sun); }
      .weekday-sat { color: var(--sat); }

      .holiday-col,
      .slot-cell.is-holiday {
        background: var(--holiday-bg);
      }

      .time-box {
        display: grid;
        align-items: center;
        justify-items: center;
        gap: 3px;
        padding: 4px 2px;
        min-height: 62px;
      }

      .time-range {
        display: grid;
        justify-items: center;
        font-size: 10px;
        font-weight: 400;
        line-height: 1.15;
      }

      .time-part,
      .time-separator {
        display: block;
        white-space: nowrap;
      }

      .time-slot {
        font-size: 12px;
        color: var(--ink);
        font-weight: 700;
        line-height: 1.1;
      }

      .header-toggle {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .header-toggle:focus-visible,
      .slot-button:focus-visible {
        outline: 2px solid #2f6fed;
        outline-offset: -2px;
      }

      .header-toggle.is-unavailable {
        background: rgba(17, 17, 17, 0.08);
      }

      .header-toggle.is-pending,
      .slot-button.is-pending {
        cursor: progress;
      }

      .slot-cell {
        height: 62px;
        vertical-align: top;
        background: #fff;
      }

      .slot-cell.is-unavailable {
        background: #d1d6dc;
      }

      .slot-cell.is-moving-highlight {
        background: #fff4ad;
        box-shadow: inset 0 0 0 2px #d0a000;
      }

      .slot-cell.is-pending {
        position: relative;
      }

      .slot-cell.is-pending::after {
        content: '';
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(47, 111, 237, 0.18);
        border-top-color: #2f6fed;
        animation: schedule-spin 0.7s linear infinite;
      }

      .slot-cell.is-pending::after {
        position: absolute;
        left: 50%;
        top: 50%;
        margin-left: -7px;
        margin-top: -7px;
      }

      .slot-cell.is-editable {
        cursor: pointer;
      }

      .slot-cell-content {
        height: 100%;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-button,
      .slot-static {
        width: 100%;
        height: 100%;
        min-height: 100%;
        border: 0;
        padding: 3px;
        margin: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-button {
        cursor: pointer;
      }

      .slot-button:disabled {
        cursor: default;
      }

      .slot-button.is-unavailable {
        background: rgba(17, 17, 17, 0.06);
      }

      @keyframes schedule-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .lesson-card {
        width: 100%;
        height: 100%;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 2px;
        padding: 2px 4px;
        border: 0;
        background: transparent;
      }

      .lesson-card-teacher {
        align-items: stretch;
        justify-items: stretch;
        gap: 0;
        padding: 1px 1px;
        overflow: hidden;
      }

      .lesson-card-teacher.is-single {
        grid-template-columns: 1fr;
      }

      .lesson-card-teacher.is-pair {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .teacher-lesson-person {
        min-width: 0;
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 2px 0;
        writing-mode: vertical-rl;
        text-orientation: upright;
        overflow: hidden;
      }

      .lesson-card-teacher.is-pair .teacher-lesson-person {
        gap: 1px;
        padding: 1px 0;
      }

      .teacher-lesson-line {
        display: block;
        line-height: 1.04;
        text-align: center;
        white-space: nowrap;
      }

      .teacher-lesson-name {
        font-size: 12px;
        font-weight: 700;
      }

      .teacher-lesson-meta {
        font-size: 9px;
      }

      .teacher-lesson-person.is-condensed .teacher-lesson-name,
      .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 10px;
      }

      .teacher-lesson-person.is-condensed .teacher-lesson-meta,
      .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 7px;
      }

      .teacher-lesson-person.is-ultra-condensed .teacher-lesson-name {
        font-size: 9px;
      }

      .teacher-lesson-person.is-ultra-condensed .teacher-lesson-meta {
        font-size: 6px;
      }

      .lesson-main {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-sub {
        font-size: 11px;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-footnote {
        font-size: 9px;
        color: var(--muted);
        text-align: center;
      }

      .schedule-table.is-compact .lesson-main {
        font-size: 11px;
      }

      .schedule-table.is-compact .lesson-sub {
        font-size: 9px;
      }

      .schedule-table.is-dense .lesson-main {
        font-size: 10px;
      }

      .schedule-table.is-dense .lesson-sub {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card {
        gap: 1px;
        padding: 1px 2px;
      }

      .schedule-table.is-compact .teacher-lesson-name {
        font-size: 11px;
      }

      .schedule-table.is-compact .teacher-lesson-meta {
        font-size: 9px;
      }

      .schedule-table.is-compact .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 9px;
      }

      .schedule-table.is-compact .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 7px;
      }

      .schedule-table.is-dense .teacher-lesson-name {
        font-size: 10px;
      }

      .schedule-table.is-dense .teacher-lesson-meta {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 6px;
      }

      .schedule-table.is-dense .date-row th,
      .schedule-table.is-dense .weekday-row th {
        font-size: 10px;
      }

      .schedule-table.is-ultra-dense .lesson-main {
        font-size: 8px;
      }

      .schedule-table.is-ultra-dense .lesson-sub {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card {
        gap: 0;
        padding: 0 1px;
      }

      .schedule-table.is-ultra-dense .teacher-lesson-name {
        font-size: 8px;
      }

      .schedule-table.is-ultra-dense .teacher-lesson-meta {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 5px;
      }

      .schedule-table.is-ultra-dense .date-row th,
      .schedule-table.is-ultra-dense .weekday-row th {
        font-size: 8px;
      }

      .empty-label {
        width: 100%;
        height: 100%;
      }

      .closed-label {
        display: grid;
        place-items: center;
        height: 100%;
        font-size: 12px;
        color: var(--muted);
      }

      .bottom-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1.35fr) 168px 206px 246px;
        gap: 8px;
        margin-top: 10px;
        align-items: start;
      }

      .bottom-grid.bottom-grid-teacher {
        grid-template-columns: minmax(0, 1.5fr) 206px 246px;
      }

      .box-panel {
        border: 1.5px solid var(--line);
        background: #ffffff;
      }

      .box-stack {
        display: grid;
        align-content: start;
      }

      .box-stack .box-panel {
        border-top: 0;
      }

      .panel-title {
        font-size: 12px;
        margin-bottom: 2px;
      }

      .box-textarea {
        width: 100%;
        min-height: 124px;
        border: 0;
        padding: 6px 8px;
        resize: none;
        font: inherit;
      }

      .salary-section {
        font-size: 11px;
      }
      .salary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .salary-table th, .salary-table td {
        border: 1px solid var(--line);
        padding: 2px 4px;
        text-align: right;
        white-space: nowrap;
      }
      .salary-table th {
        background: var(--bg);
        text-align: center;
        font-weight: normal;
      }
      .salary-table .salary-label {
        text-align: left;
        font-weight: 600;
      }
      .salary-input {
        width: 64px;
        border: 1px solid var(--line);
        padding: 1px 3px;
        font: inherit;
        font-size: 11px;
        text-align: right;
      }
      .salary-total-row td {
        font-weight: 600;
        background: #fafafa;
      }

      .check-line {
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px 2px;
        font-size: 12px;
      }

      .count-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .count-table,
      .absence-table,
      .makeup-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .count-table {
        border-bottom: 1.5px solid var(--line);
      }

      .count-table th,
      .count-table td,
      .absence-table th,
      .absence-table td,
      .makeup-table th,
      .makeup-table td {
        border: 1.5px solid var(--line);
        padding: 3px 4px;
        text-align: center;
        height: 22px;
      }

      .absence-table td,
      .makeup-table td {
        font-size: 9px;
        line-height: 1.05;
        padding: 2px 3px;
        height: 17px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      .count-table tbody tr:last-child td {
        border-bottom: 1.5px solid var(--line);
      }

      .count-stack {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        align-content: start;
      }

      .count-stack-block {
        display: grid;
        align-content: start;
        gap: 6px;
      }

      .count-warning-stamp {
        border: 3px solid #c3342f;
        color: #c3342f;
        font-size: 21px;
        font-weight: 800;
        line-height: 1.15;
        text-align: center;
        padding: 10px 8px;
        background: rgba(255, 244, 244, 0.94);
        transform: rotate(-4deg);
        letter-spacing: 0.08em;
      }

      .box-table-title {
        border: 1.5px solid var(--line);
        border-bottom: 0;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 6px;
      }

      .empty-state {
        padding: 44px 18px;
        text-align: center;
        color: var(--muted);
        border: 1.5px dashed var(--soft-line);
        background: rgba(255, 255, 255, 0.86);
      }

      @media print {
        *,
        *::before,
        *::after {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        html, body {
          background: #fff;
          overflow: hidden;
          scrollbar-width: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        .pages::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
        .toolbar { display: none; }
        .pages {
          padding: 0;
          gap: 0;
          overflow: visible;
          scrollbar-width: none;
        }
        .print-only-hidden { display: none; }
        .sheet,
        .holiday-col,
        .slot-cell.is-holiday,
        .slot-cell.is-unavailable,
        .slot-button.is-unavailable,
        .header-toggle.is-unavailable {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .holiday-col,
        .slot-cell.is-holiday {
          background: var(--holiday-bg) !important;
          box-shadow: inset 0 0 0 999px var(--holiday-bg);
        }
        .slot-cell.is-unavailable,
        .slot-button.is-unavailable,
        .header-toggle.is-unavailable {
          background: #d1d6dc !important;
          box-shadow: inset 0 0 0 999px #d1d6dc;
        }
        .sheet {
          box-shadow: none;
          border: 0;
          padding: 0;
          width: 277mm;
          height: 190mm;
          aspect-ratio: 297 / 210;
          overflow: hidden;
          page-break-after: always;
        }
        .teacher-lesson-person {
          gap: 2px;
          padding: 1px 0;
        }
        .teacher-lesson-name {
          font-size: 10px;
        }
        .teacher-lesson-meta {
          font-size: 7px;
        }
        .lesson-card-teacher.is-pair .teacher-lesson-name {
          font-size: 8px;
        }
        .lesson-card-teacher.is-pair .teacher-lesson-meta {
          font-size: 6px;
        }
      }

      @page {
        size: A4 landscape;
        margin: 8mm;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="toolbar-title">${viewLabel}</div>
      <div class="toolbar-field">
        <label for="schedule-start-date">開始日</label>
        <input id="schedule-start-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-end-date">終了日</label>
        <input id="schedule-end-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-period-select">登録された講習期間を表示する</label>
        <select id="schedule-period-select">
          <option value="">選択してください</option>
        </select>
      </div>
      <div class="toolbar-summary" id="schedule-summary-label"></div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-field toolbar-field--search">
        <label for="schedule-person-search">${viewType === 'student' ? '生徒名検索' : '講師名検索'}</label>
        <input id="schedule-person-search" type="search" placeholder="${viewType === 'student' ? '生徒名を検索' : '講師名を検索'}" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-person-select">${viewType === 'student' ? '生徒選択' : '講師選択'}</label>
        <select id="schedule-person-select">
          <option value="">選択してください</option>
        </select>
      </div>
      <div class="toolbar-actions">
        <button type="button" id="schedule-apply-button">反映</button>
      </div>
    </div>
    <main class="pages" id="schedule-pages"></main>
    <input id="schedule-logo-input" type="file" accept="image/*" style="display:none" />
    <script id="schedule-data" type="application/json">${serializedPayload}</script>
    <script>
      const VIEW_TYPE = '${viewType}';
      const VIEW_LABEL = '${viewLabel}';
      let DATA = JSON.parse(document.getElementById('schedule-data').textContent || '{}');
      const startInput = document.getElementById('schedule-start-date');
      const endInput = document.getElementById('schedule-end-date');
      const periodSelect = document.getElementById('schedule-period-select');
      const summaryLabel = document.getElementById('schedule-summary-label');
      const toolbarElement = document.querySelector('.toolbar');
      const pagesElement = document.getElementById('schedule-pages');
      const personSearchInput = document.getElementById('schedule-person-search');
      const personSelect = document.getElementById('schedule-person-select');
      const applyButton = document.getElementById('schedule-apply-button');
      const sharedStoragePrefix = 'schedule-shared:' + VIEW_TYPE + ':';
      const sharedGlobalStoragePrefix = 'schedule-shared:global:';
      const rangeStoragePrefix = sharedStoragePrefix + 'range:';
      const lessonTypeLabels = { regular: '通常', makeup: '振替', special: '講習' };
      const teacherTypeLabels = { normal: '', substitute: '代行', outside: '外部' };
      const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
      const subjectDefinitions = ['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社'];
      let activeCountDialog = null;
      let activeTeacherRegisterDialog = null;
      let payloadFingerprint = JSON.stringify(DATA);
      let skipNextEquivalentPayload = false;
      let suppressNextToggleClick = false;
      let appliedStartDate = '';
      let appliedEndDate = '';
      let appliedPeriodValue = '';
      let appliedPersonId = '';
      const pendingUnavailableKeys = new Set();
      const pendingUnavailableTimers = new Map();
      const interactionLockStorageKey = 'schedule-shared:interaction-lock';
      const interactionLockStaleMs = 5000;
      const interactionLockToken = VIEW_TYPE + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      let interactionLockOwner = null;
      let interactionLockSuspendUntil = 0;
      const interactionLockBanner = (() => {
        if (!(summaryLabel instanceof HTMLElement)) return null;
        const element = document.createElement('div');
        element.id = 'schedule-interaction-lock-banner';
        element.className = 'interaction-lock-banner';
        element.hidden = true;
        summaryLabel.insertAdjacentElement('afterend', element);
        return element;
      })();

      function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
      }

      function formatMonthDay(dateKey) {
        const parts = dateKey.split('-');
        return Number(parts[1]) + '月' + Number(parts[2]) + '日';
      }

      function formatRangeLabel(startDate, endDate) {
        if (!startDate || !endDate) return '';
        return formatMonthDay(startDate) + ' ～ ' + formatMonthDay(endDate);
      }

      function updateSheetScreenSize() {
        if (!(toolbarElement instanceof HTMLElement)) return;
        const toolbarRect = toolbarElement.getBoundingClientRect();
        document.documentElement.style.setProperty('--schedule-toolbar-offset', Math.max(toolbarRect.height, 0) + 'px');
      }

      function normalizeSchoolInfo(value) {
        return String(value || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function getSharedInputStorageKey(sharedKey) {
        if (sharedKey === 'school-info') return sharedGlobalStoragePrefix + sharedKey;
        return sharedStoragePrefix + sharedKey;
      }

      function setDateInputValue(input, value) {
        input.value = value || '';
        if (value && !input.value) {
          const parsed = new Date(value + 'T00:00:00');
          if (!Number.isNaN(parsed.getTime())) {
            input.valueAsDate = parsed;
          }
        }
      }

      function getSharedStorage() {
        try {
          if (window.opener && window.opener !== window && window.opener.localStorage) {
            return window.opener.localStorage;
          }
        } catch {}
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      }

      function getInteractionSurfaceLabel(surface) {
        if (surface === 'board') return 'コマ表';
        if (surface === 'teacher') return '講師日程表';
        return '生徒日程表';
      }

      function parseInteractionLock(rawValue) {
        if (!rawValue) return null;
        try {
          const parsed = JSON.parse(rawValue);
          if (!parsed || (parsed.owner !== 'board' && parsed.owner !== 'student' && parsed.owner !== 'teacher')) return null;
          const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Number(parsed.updatedAt);
          if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > interactionLockStaleMs) return null;
          return {
            owner: parsed.owner,
            token: typeof parsed.token === 'string' ? parsed.token : '',
            updatedAt,
          };
        } catch {
          return null;
        }
      }

      function readInteractionLock() {
        const storage = getSharedStorage();
        if (!storage) return null;
        try {
          return parseInteractionLock(storage.getItem(interactionLockStorageKey));
        } catch {
          return null;
        }
      }

      function writeInteractionLock(payload) {
        const storage = getSharedStorage();
        if (!storage) return;
        try {
          if (!payload) {
            storage.removeItem(interactionLockStorageKey);
            return;
          }
          storage.setItem(interactionLockStorageKey, JSON.stringify(payload));
        } catch {}
      }

      function refreshInteractionLockState() {
        const currentLock = readInteractionLock();
        interactionLockOwner = currentLock ? currentLock.owner : null;
        const isLocked = Boolean(interactionLockOwner && interactionLockOwner !== VIEW_TYPE);
        document.body.classList.toggle('surface-locked', isLocked);
        if (interactionLockBanner) {
          interactionLockBanner.hidden = !isLocked;
          if (isLocked) {
            interactionLockBanner.textContent = getInteractionSurfaceLabel(interactionLockOwner) + ' を操作中です。この画面をクリックすると操作を切り替えます。';
          }
        }
      }

      function acquireInteractionLock() {
        if (Date.now() < interactionLockSuspendUntil) {
          refreshInteractionLockState();
          return;
        }
        writeInteractionLock({ owner: VIEW_TYPE, token: interactionLockToken, updatedAt: Date.now() });
        interactionLockOwner = VIEW_TYPE;
        refreshInteractionLockState();
      }

      function releaseInteractionLock() {
        const currentLock = readInteractionLock();
        if (currentLock && currentLock.token === interactionLockToken) {
          writeInteractionLock(null);
        }
        refreshInteractionLockState();
      }

      function resolveSharedInputValue(sharedKey) {
        const activeElement = document.querySelector('.shared-input[data-shared-input="' + sharedKey + '"]');
        if (activeElement && 'value' in activeElement && typeof activeElement.value === 'string' && activeElement.value) {
          return activeElement.value;
        }

        const storage = getSharedStorage();
        try {
          return storage ? storage.getItem(getSharedInputStorageKey(sharedKey)) || '' : '';
        } catch {
          return '';
        }
      }

      function shouldShowScheduleQr() {
        return true;
      }

      function syncScheduleQrVisibility() {
        // QR visibility is now based on submission status per person, handled at render time
      }

      function isVisibleInRange(item, startDate, endDate) {
        var today = new Date().toISOString().slice(0, 10);
        if (item.withdrawDate && item.withdrawDate !== '未定' && item.withdrawDate < today) return false;
        return !item.isHidden && item.entryDate <= endDate && (!item.withdrawDate || item.withdrawDate === '未定' || item.withdrawDate >= startDate);
      }

      function getGradeLabel(birthDate, referenceDate) {
        if (!birthDate) return '';
        const birthParts = birthDate.split('-').map(Number);
        const ref = new Date(referenceDate + 'T00:00:00');
        const schoolYear = ref >= new Date(ref.getFullYear(), 3, 1) ? ref.getFullYear() : ref.getFullYear() - 1;
        const enrollmentYear = birthParts[1] < 4 || (birthParts[1] === 4 && birthParts[2] === 1) ? birthParts[0] + 6 : birthParts[0] + 7;
        const gradeNumber = schoolYear - enrollmentYear + 1;
        if (gradeNumber <= 1) return '小1';
        if (gradeNumber === 2) return '小2';
        if (gradeNumber === 3) return '小3';
        if (gradeNumber === 4) return '小4';
        if (gradeNumber === 5) return '小5';
        if (gradeNumber === 6) return '小6';
        if (gradeNumber === 7) return '中1';
        if (gradeNumber === 8) return '中2';
        if (gradeNumber === 9) return '中3';
        if (gradeNumber === 10) return '高1';
        if (gradeNumber === 11) return '高2';
        return '高3';
      }
      function filterCells(startDate, endDate) {
        return DATA.cells.filter((cell) => cell.dateKey >= startDate && cell.dateKey <= endDate);
      }

      function sortSlotKeys(slotKeys) {
        return Array.from(new Set((slotKeys || []).filter((slotKey) => typeof slotKey === 'string' && slotKey))).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
      }

      function normalizeSubjectSlots(subjectSlots) {
        const next = {};
        subjectDefinitions.forEach((subject) => {
          const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0);
          const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
          if (normalizedValue > 0) next[subject] = normalizedValue;
        });
        return next;
      }

      function defaultStudentSessionInput() {
        return { unavailableSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false };
      }

      function defaultTeacherSessionInput() {
        return { unavailableSlots: [], countSubmitted: false };
      }

      function getSpecialSessionById(sessionId) {
        return (DATA.specialSessions || []).find((session) => session.id === sessionId) || null;
      }

      function getStudentSessionInput(studentId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.studentInputs ? session.studentInputs[studentId] : null;
        return {
          ...defaultStudentSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          subjectSlots: normalizeSubjectSlots(current && current.subjectSlots ? current.subjectSlots : {}),
          regularOnly: Boolean(current && current.regularOnly),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function getTeacherSessionInput(teacherId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.teacherInputs ? session.teacherInputs[teacherId] : null;
        return {
          ...defaultTeacherSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function isStudentSessionUnavailableFixed(studentId, sessionId) {
        return Boolean(studentId && sessionId && getStudentSessionInput(studentId, sessionId).countSubmitted);
      }

      function isTeacherSessionUnavailableFixed(teacherId, sessionId) {
        return Boolean(teacherId && sessionId && getTeacherSessionInput(teacherId, sessionId).countSubmitted);
      }

      function getEditableSpecialSessionsForStudent(studentId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isStudentSessionUnavailableFixed(studentId, session.id));
      }

      function getEditableSpecialSessionsForTeacher(teacherId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isTeacherSessionUnavailableFixed(teacherId, session.id));
      }

      function syncPayloadFingerprint() {
        payloadFingerprint = JSON.stringify(DATA);
        skipNextEquivalentPayload = true;
      }

      function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }

      function isOpenDayByRules(dateKey, fallbackOpenState) {
        if (typeof fallbackOpenState === 'boolean') return fallbackOpenState;
        if (DATA.availability.forceOpenDates.includes(dateKey)) return true;
        if (DATA.availability.holidayDates.includes(dateKey)) return false;
        return !DATA.availability.closedWeekdays.includes(new Date(dateKey + 'T00:00:00').getDay());
      }

      function buildDateHeaders(startDate, endDate) {
        const byDate = new Map(DATA.cells.map((cell) => [cell.dateKey, cell]));
        const headers = [];
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
          const dateKey = toDateKey(cursor);
          const known = byDate.get(dateKey);
          headers.push({
            dateKey,
            dateLabel: Number(dateKey.split('-')[1]) + '/' + Number(dateKey.split('-')[2]),
            isOpenDay: isOpenDayByRules(dateKey, known ? known.isOpenDay : undefined),
            weekday: cursor.getDay(),
          });
        }
        return headers;
      }

      function buildMonthGroups(dateHeaders) {
        const groups = [];
        dateHeaders.forEach((header) => {
          const month = Number(header.dateKey.split('-')[1]);
          const last = groups[groups.length - 1];
          if (last && last.month === month) {
            last.count += 1;
          } else {
            groups.push({ month, count: 1 });
          }
        });
        return groups;
      }

      function getVisibleYears(dateHeaders) {
        return Array.from(new Set(dateHeaders.map((header) => Number(header.dateKey.split('-')[0]))));
      }

      function getSlotNumbers() {
        return Array.from(new Set(DATA.cells.map((cell) => cell.slotNumber))).sort((left, right) => left - right);
      }

      function splitTimeLabel(timeLabel) {
        const normalized = String(timeLabel || '').replace(/\s+/g, '');
        const matched = normalized.match(/^(.+?)[-~〜](.+)$/);
        if (!matched) return { start: normalized, end: '' };
        return { start: matched[1], end: matched[2] };
      }

      function renderTimeHeaderCell(timeLabel, slotNumber, actionHtml) {
        const range = splitTimeLabel(timeLabel);
        const rangeHtml = range.end
          ? '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span><span class="time-separator">〜</span><span class="time-part">' + escapeHtml(range.end) + '</span></div>'
          : '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span></div>';
        const contentHtml = '<div class="time-box">' + rangeHtml + '<div class="time-slot">' + slotNumber + '限</div></div>';
        return '<th class="time-col">' + (actionHtml ? actionHtml.replace('__CONTENT__', contentHtml) : contentHtml) + '</th>';
      }

      function buildPeriodSegments(dateHeaders) {
        const segments = [];
        let cursor = 0;
        while (cursor < dateHeaders.length) {
          const header = dateHeaders[cursor];
          const matched = DATA.periodBands.find((band) => header.dateKey >= band.startDate && header.dateKey <= band.endDate);
          if (!matched) {
            const gapStart = cursor;
            while (cursor < dateHeaders.length && !DATA.periodBands.find((band) => dateHeaders[cursor].dateKey >= band.startDate && dateHeaders[cursor].dateKey <= band.endDate)) {
              cursor += 1;
            }
            segments.push({ type: 'gap', key: 'gap-' + gapStart, colSpan: cursor - gapStart });
            continue;
          }
          const segmentStart = cursor;
          while (cursor < dateHeaders.length && dateHeaders[cursor].dateKey >= matched.startDate && dateHeaders[cursor].dateKey <= matched.endDate) {
            cursor += 1;
          }
          segments.push({ type: 'band', key: matched.label + '-' + segmentStart, colSpan: cursor - segmentStart, label: matched.label, startDate: matched.startDate, endDate: matched.endDate, sessionId: matched.id || '' });
        }
        return segments;
      }

      function getTableDensityClass(dateHeaders) {
        if (dateHeaders.length >= 38) return 'is-dense is-ultra-dense';
        if (dateHeaders.length >= 28) return 'is-dense';
        if (dateHeaders.length >= 18) return 'is-compact';
        return '';
      }

      function buildCellMap(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          map.set(cell.dateKey + '_' + cell.slotNumber, cell);
        });
        return map;
      }

      function buildStudentAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            if (desk.lesson) {
              desk.lesson.students.forEach((student) => {
                const studentKey = student.linkedStudentId || student.name;
                if (!map.has(studentKey)) map.set(studentKey, []);
                map.get(studentKey).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: desk.teacher, timeLabel: cell.timeLabel, lesson: student });
              });
            }
            (Array.isArray(desk.statuses) ? desk.statuses : []).forEach((statusEntry) => {
              if (!statusEntry) return;
              const studentKey = statusEntry.linkedStudentId || statusEntry.name;
              if (!map.has(studentKey)) map.set(studentKey, []);
              map.get(studentKey).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: statusEntry.teacherName || desk.teacher, timeLabel: cell.timeLabel, lesson: statusEntry });
            });
          });
        });
        return map;
      }

      function buildTeacherAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            const statuses = (Array.isArray(desk.statuses) ? desk.statuses : []).filter(Boolean);
            if (!desk.teacher || (!desk.lesson && statuses.length === 0)) return;
            if (!map.has(desk.teacher)) map.set(desk.teacher, []);
            map.get(desk.teacher).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, timeLabel: cell.timeLabel, students: desk.lesson ? desk.lesson.students : [], statuses, note: desk.lesson ? desk.lesson.note || '' : '' });
          });
        });
        return map;
      }

      function toCountRows(countMap, desiredCountMap, forcedLabels) {
        const mergedLabels = Array.from(new Set([
          ...(forcedLabels || []),
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ])).sort((left, right) => left.localeCompare(right, 'ja'));
        if (!mergedLabels.length) return '<tr><td>予定なし</td><td>0</td></tr>';
        return mergedLabels.map((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          return '<tr><td>' + escapeHtml(label) + '</td><td>' + count + '(' + desiredCount + ')</td></tr>';
        }).join('');
      }

      function hasCountMismatch(countMap, desiredCountMap) {
        const mergedLabels = Array.from(new Set([
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ]));
        return mergedLabels.some((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          return count !== desiredCount;
        });
      }

      function getPreferredMathSubject(student, referenceDate) {
        const gradeLabel = getGradeLabel(student && student.birthDate, referenceDate);
        return gradeLabel.startsWith('小') ? '算' : '数';
      }

      function getVisibleSubjectsForStudent(student, referenceDate, additionalSubjects) {
        const preferredMathSubject = getPreferredMathSubject(student, referenceDate);
        const gradeLabel = getGradeLabel(student && student.birthDate, referenceDate);
        const prefersHighSchoolScience = gradeLabel.startsWith('高');
        const legacySubjects = Array.isArray(additionalSubjects) ? additionalSubjects : [];
        return subjectDefinitions.filter((subject) => {
          if (subject === '算' || subject === '数') return subject === preferredMathSubject;
          if (subject === '算国') return preferredMathSubject === '算';
          if (subject === '理') return !prefersHighSchoolScience || legacySubjects.includes('理');
          if (subject === '生' || subject === '物' || subject === '化') return prefersHighSchoolScience || legacySubjects.includes(subject);
          return true;
        });
      }

      function normalizeSubjectForStudent(subject, student, referenceDate) {
        if (subject !== '算' && subject !== '数') return subject;
        return getPreferredMathSubject(student, referenceDate);
      }

      function normalizeCountMapSubjects(countMap, student, referenceDate) {
        const next = {};
        Object.entries(countMap || {}).forEach(([subject, value]) => {
          const normalizedSubject = normalizeSubjectForStudent(subject, student, referenceDate);
          const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
          if (normalizedValue <= 0) return;
          next[normalizedSubject] = (next[normalizedSubject] || 0) + normalizedValue;
        });
        return next;
      }

      function filterCountMapToSubjects(countMap, visibleSubjects) {
        return Object.fromEntries(Object.entries(countMap || {}).filter(([label]) => visibleSubjects.includes(label)));
      }

      function renderStudentCellCard(entry) {
        if (entry.status === 'absent' || entry.status === 'absent-no-makeup' || entry.status === 'attended') {
          var statusLabel = entry.status === 'attended' ? '出席' : entry.status === 'absent-no-makeup' ? '振替なし休み' : '休';
          return '<div class="lesson-card"><div class="lesson-main">' + escapeHtml(statusLabel) + '</div><div class="lesson-sub">' + escapeHtml([entry.subject, lessonTypeLabels[entry.lessonType] || entry.lessonType].filter(Boolean).join(' / ')) + '</div></div>';
        }
        return '<div class="lesson-card"><div class="lesson-main">' + escapeHtml(entry.subject) + '</div><div class="lesson-sub">' + escapeHtml(lessonTypeLabels[entry.lessonType] || entry.lessonType) + '</div></div>';
      }

      function getSpecialSessionsForDate(dateKey) {
        return (DATA.specialSessions || []).filter((session) => dateKey >= session.startDate && dateKey <= session.endDate);
      }

      function getUnavailableSlotsForStudent(studentId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs[studentId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      function getUnavailableSlotsForTeacher(teacherId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.teacherInputs && typeof session.teacherInputs === 'object' ? session.teacherInputs[teacherId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      function buildDesiredLectureCountMap(student, startDate, endDate) {
        const countMap = {};
        (DATA.specialSessions || []).forEach((session) => {
          if (!session || session.endDate < startDate || session.startDate > endDate) return;
          const input = getStudentSessionInput(student.id, session.id);
          if (!input.countSubmitted) return;
          if (input.regularOnly) return;
          Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
            const normalizedSubject = normalizeSubjectForStudent(subject, student, startDate);
            const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
            if (normalizedValue <= 0) return;
            countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + normalizedValue;
          });
        });
        return countMap;
      }

      function areStudentSlotsUnavailable(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function areTeacherSlotsUnavailable(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function buildUnavailablePendingKey(viewType, personId, scope, value) {
        return viewType + ':' + personId + ':' + scope + ':' + value;
      }

      function collectUnavailablePendingKeys(viewType, personId, slotKeys) {
        const keys = [];
        const dateKeys = new Set();
        const slotNumbers = new Set();
        sortSlotKeys(slotKeys).forEach((slotKey) => {
          if (!slotKey) return;
          keys.push(buildUnavailablePendingKey(viewType, personId, 'cell', slotKey));
          const parts = slotKey.split('_');
          if (parts[0]) dateKeys.add(parts[0]);
          if (parts[1]) slotNumbers.add(parts[1]);
        });
        dateKeys.forEach((dateKey) => {
          keys.push(buildUnavailablePendingKey(viewType, personId, 'date', dateKey));
        });
        slotNumbers.forEach((slotNumber) => {
          keys.push(buildUnavailablePendingKey(viewType, personId, 'slot', slotNumber));
        });
        return Array.from(new Set(keys));
      }

      function syncPendingUnavailableUi(root) {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('[data-pending-unavailable-key]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const pendingKey = element.getAttribute('data-pending-unavailable-key') || '';
          const isPending = Boolean(pendingKey) && pendingUnavailableKeys.has(pendingKey);
          element.classList.toggle('is-pending', isPending);
          if (isPending) element.setAttribute('aria-busy', 'true');
          else element.removeAttribute('aria-busy');
          if (element instanceof HTMLButtonElement) {
            element.disabled = isPending;
          }
        });
      }

      function setUnavailablePending(keys, durationMs) {
        const normalizedKeys = Array.from(new Set((keys || []).filter((value) => typeof value === 'string' && value)));
        if (!normalizedKeys.length) return;
        normalizedKeys.forEach((pendingKey) => {
          pendingUnavailableKeys.add(pendingKey);
          const currentTimer = pendingUnavailableTimers.get(pendingKey);
          if (currentTimer) window.clearTimeout(currentTimer);
          pendingUnavailableTimers.set(pendingKey, window.setTimeout(() => {
            pendingUnavailableKeys.delete(pendingKey);
            pendingUnavailableTimers.delete(pendingKey);
            syncPendingUnavailableUi(pagesElement);
          }, durationMs));
        });
        syncPendingUnavailableUi(pagesElement);
      }

      function isUnavailableTogglePending(target) {
        if (!(target instanceof HTMLElement)) return false;
        const pendingElement = target.closest('[data-pending-unavailable-key]');
        if (!(pendingElement instanceof HTMLElement)) return false;
        const pendingKey = pendingElement.getAttribute('data-pending-unavailable-key') || '';
        return Boolean(pendingKey) && pendingUnavailableKeys.has(pendingKey);
      }

      function getEditableStudentSlotKeys(studentId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForStudent(studentId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function getEditableTeacherSlotKeys(teacherId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForTeacher(teacherId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function getAssignedStudentSlotKeys(studentId) {
        const assignedSlotKeys = new Set();
        const student = (DATA.students || []).find((entry) => entry.id === studentId);
        const candidateNames = new Set([
          student && typeof student.name === 'string' ? student.name : '',
          student && typeof student.fullName === 'string' ? student.fullName : '',
        ].filter(Boolean));

        (DATA.cells || []).forEach((cell) => {
          (cell.desks || []).forEach((desk) => {
            const students = desk.lesson && Array.isArray(desk.lesson.students) ? desk.lesson.students : [];
            if (students.some((entry) => entry && (entry.linkedStudentId === studentId || candidateNames.has(entry.name)))) {
              assignedSlotKeys.add(cell.dateKey + '_' + cell.slotNumber);
            }
          });
        });

        return assignedSlotKeys;
      }

      function countAvailableStudentSlotsForSession(studentId, sessionId) {
        if (!studentId || !sessionId) return 0;
        const session = getSpecialSessionById(sessionId);
        if (!session) return 0;
        const dateHeaders = buildDateHeaders(session.startDate, session.endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(DATA.cells || []);
        const editableSlotKeys = getEditableStudentSlotKeys(studentId, dateHeaders, slotNumbers, cellMap);
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        const assignedSlotKeys = getAssignedStudentSlotKeys(studentId);
        return editableSlotKeys.filter((slotKey) => !unavailableSlots.has(slotKey) && !assignedSlotKeys.has(slotKey)).length;
      }

      function updateUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                subjectSlots: normalizeSubjectSlots(currentInput.subjectSlots),
                regularOnly: Boolean(currentInput.regularOnly),
                countSubmitted: Boolean(currentInput.countSubmitted),
              },
            },
          };
        });
      }

      function updateStudentCountLocally(sessionId, personId, subjectSlots, regularOnly, countSubmitted) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
                regularOnly: Boolean(regularOnly),
                countSubmitted: Boolean(countSubmitted),
              },
            },
          };
        });
      }

      function updateTeacherUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                countSubmitted: Boolean(currentInput.countSubmitted),
              },
            },
          };
        });
      }

      function updateTeacherCountLocally(sessionId, personId, countSubmitted) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                countSubmitted: Boolean(countSubmitted),
              },
            },
          };
        });
      }

      function persistUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-student-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistStudentCount(sessionId, personId, subjectSlots, regularOnly, countSubmitted) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-student-count-save',
            sessionId,
            personId,
            subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
            regularOnly: Boolean(regularOnly),
            countSubmitted: Boolean(countSubmitted),
          }, '*');
        } catch {}
      }

      function persistTeacherUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistTeacherCount(sessionId, personId, countSubmitted) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-count-save',
            sessionId,
            personId,
            countSubmitted: Boolean(countSubmitted),
          }, '*');
        } catch {}
      }

      function applyStudentUnavailableSlots(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;
        setUnavailablePending(collectUnavailablePendingKeys('student', studentId, normalizedSlotKeys), 220);

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForStudent(studentId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForStudent(studentId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.studentInputs?.[studentId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateUnavailableSlotsLocally(session.id, studentId, nextSlots);
          persistUnavailableSlots(session.id, studentId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshStudentUnavailableUi(studentId);
      }

      function toggleStudentUnavailableSlot(studentId, slotKey) {
        applyStudentUnavailableSlots(studentId, [slotKey]);
      }

      function applyTeacherUnavailableSlots(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;
        setUnavailablePending(collectUnavailablePendingKeys('teacher', teacherId, normalizedSlotKeys), 220);

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForTeacher(teacherId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForTeacher(teacherId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.teacherInputs?.[teacherId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateTeacherUnavailableSlotsLocally(session.id, teacherId, nextSlots);
          persistTeacherUnavailableSlots(session.id, teacherId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshTeacherUnavailableUi(teacherId);
      }

      function toggleTeacherUnavailableSlot(teacherId, slotKey) {
        applyTeacherUnavailableSlots(teacherId, [slotKey]);
      }

      function renderStudentSlotContent(studentId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForStudent(studentId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        const isUnavailable = unavailableSlots.has(slotKey);
        const pendingKey = buildUnavailablePendingKey('student', studentId, 'cell', slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable" data-student-id="' + studentId + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + pendingKey + '" data-testid="student-schedule-cell-button-' + studentId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function renderStudentDateHeaderCell(studentId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-date" data-student-id="' + studentId + '" data-date-key="' + dateHeader.dateKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', studentId, 'date', dateHeader.dateKey) + '" data-testid="student-schedule-day-toggle-' + studentId + '-' + dateHeader.dateKey + '" title="この日の出席不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderTeacherDateHeaderCell(teacherId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-date" data-teacher-id="' + teacherId + '" data-date-key="' + dateHeader.dateKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacherId, 'date', dateHeader.dateKey) + '" data-testid="teacher-schedule-day-toggle-' + teacherId + '-' + dateHeader.dateKey + '" title="この日の参加不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderStudentTimeHeaderCell(studentId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-slot" data-student-id="' + studentId + '" data-slot-number="' + slotNumber + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', studentId, 'slot', String(slotNumber)) + '" data-testid="student-schedule-slot-toggle-' + studentId + '-' + slotNumber + '" title="この時限の出席不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderTeacherTimeHeaderCell(teacherId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-slot" data-teacher-id="' + teacherId + '" data-slot-number="' + slotNumber + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacherId, 'slot', String(slotNumber)) + '" data-testid="teacher-schedule-slot-toggle-' + teacherId + '-' + slotNumber + '" title="この時限の参加不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderStudentPeriodBandCell(studentId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getStudentSessionInput(studentId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateLabel = input.countSubmitted ? '希望科目数登録済' : '希望科目数設定はここをクリック';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-student-count-modal" data-student-id="' + studentId + '" data-session-id="' + segment.sessionId + '" data-testid="student-schedule-period-button-' + studentId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, escapeHtml(stateLabel)) + '</span></button></th>';
      }

      function renderTeacherPeriodBandCell(teacherId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getTeacherSessionInput(teacherId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateLabel = input.countSubmitted ? '講師予定登録済' : '講師予定をここをクリックして登録';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-teacher-register-modal" data-teacher-id="' + teacherId + '" data-session-id="' + segment.sessionId + '" data-testid="teacher-schedule-period-button-' + teacherId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, escapeHtml(stateLabel)) + '</span></button></th>';
      }

      function refreshStudentUnavailableUi(studentId) {
        if (!studentId) return;
        const section = pagesElement.querySelector('[data-role="student-sheet"][data-student-id="' + studentId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForStudent(studentId);

        section.querySelectorAll('[data-role="student-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-student-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        syncPendingUnavailableUi(section);
      }

      function refreshTeacherUnavailableUi(teacherId) {
        if (!teacherId) return;
        const section = pagesElement.querySelector('[data-role="teacher-sheet"][data-teacher-id="' + teacherId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);

        section.querySelectorAll('[data-role="teacher-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-teacher-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        syncPendingUnavailableUi(section);
      }

      function renderTeacherSlotContent(teacherId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForTeacher(teacherId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        const isUnavailable = unavailableSlots.has(slotKey);
        const pendingKey = buildUnavailablePendingKey('teacher', teacherId, 'cell', slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable" data-teacher-id="' + teacherId + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + pendingKey + '" data-testid="teacher-schedule-cell-button-' + teacherId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function getCompactLessonTypeLabel(lessonType) {
        if (lessonType === 'regular') return '通';
        if (lessonType === 'makeup') return '振';
        if (lessonType === 'special') return '講';
        return lessonTypeLabels[lessonType] || lessonType || '';
      }

      function getCompactStatusLabel(status) {
        if (status === 'absent-no-makeup') return '振無休';
        if (status === 'absent') return '休';
        if (status === 'attended') return '出席';
        return '';
      }

      function getVerboseStatusLabel(status) {
        if (status === 'absent-no-makeup') return '振替なし休み';
        if (status === 'absent') return '休み';
        if (status === 'attended') return '出席';
        return '';
      }

      function formatTeacherLessonLabel(student, options) {
        const lessonLabel = getCompactLessonTypeLabel(student.lessonType);
        const statusLabel = options && options.verbose ? getVerboseStatusLabel(student.status) : getCompactStatusLabel(student.status);
        if (statusLabel) return [lessonLabel, statusLabel].filter(Boolean).join(' ');
        const teacherLabel = teacherTypeLabels[student.teacherType] || '';
        return teacherLabel ? lessonLabel + '(' + teacherLabel + ')' : lessonLabel;
      }

      function getTeacherLessonPersonDensityClass(student) {
        const meta = [student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join(' ');
        const totalLength = String(student.name || '').length + meta.length;
        if (totalLength >= 13) return ' is-ultra-condensed';
        if (totalLength >= 9) return ' is-condensed';
        return '';
      }

      function formatTeacherTooltipEntry(student) {
        const lessonLabel = [lessonTypeLabels[student.lessonType] || student.lessonType, student.subject].filter(Boolean).join(' ');
        if (student.status === 'absent' || student.status === 'absent-no-makeup' || student.status === 'attended') {
          return [getVerboseStatusLabel(student.status), student.name, lessonLabel].filter(Boolean).join(' / ');
        }
        return [student.name, lessonLabel].filter(Boolean).join(' / ');
      }

      function renderTeacherCellCard(students, statuses) {
        const people = [...(students || []), ...(statuses || [])];
        const cardClass = 'lesson-card lesson-card-teacher ' + (people.length > 1 ? 'is-pair' : 'is-single');
        return '<div class="' + cardClass + '">' + people.map((student) => '<div class="teacher-lesson-person' + getTeacherLessonPersonDensityClass(student) + '"><span class="teacher-lesson-line teacher-lesson-name">' + escapeHtml(student.name) + '</span><span class="teacher-lesson-line teacher-lesson-meta">' + escapeHtml([student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join(' ')) + '</span></div>').join('') + '</div>';
      }

      function makeCornerYearHtml(dateHeaders) {
        return getVisibleYears(dateHeaders).map((year) => '<span class="time-corner-year">' + year + '</span>').join('');
      }

      function makeMonthHeaderHtml(dateHeaders) {
        return buildMonthGroups(dateHeaders).map((group) => '<th colspan="' + group.count + '">' + group.month + '月</th>').join('');
      }

      function makeDateHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => '<th class="' + (!header.isOpenDay ? 'holiday-col' : '') + '"><span class="date-label">' + Number(header.dateKey.split('-')[2]) + '</span></th>').join('');
      }

      function makeWeekdayHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => {
          const cls = [!header.isOpenDay ? 'holiday-col' : '', header.weekday === 0 ? 'weekday-sun' : '', header.weekday === 6 ? 'weekday-sat' : ''].filter(Boolean).join(' ');
          return '<th class="' + cls + '"><span class="weekday-label">' + dayLabels[header.weekday] + '</span></th>';
        }).join('');
      }

      function isHighSchoolOrAbove(grade) {
        return grade === '高1' || grade === '高2' || grade === '高3';
      }

      function buildTeacherSalaryData(entries, teacherId) {
        var countA = 0, countB = 0, countC = 0, countD = 0;
        var attendanceDates = {};
        (entries || []).forEach(function(entry) {
          var statuses = (entry.statuses || []).filter(Boolean);
          var attendedStatuses = statuses.filter(function(s) {
            return s.status === 'attended';
          });
          if (attendedStatuses.length === 0) return;
          var hasHigh = attendedStatuses.some(function(s) { return isHighSchoolOrAbove(s.grade); });
          if (attendedStatuses.length === 1) {
            if (hasHigh) countC++; else countA++;
          } else {
            if (hasHigh) countD++; else countB++;
          }
          attendanceDates[entry.dateKey] = true;
        });
        return { countA: countA, countB: countB, countC: countC, countD: countD, attendanceDays: Object.keys(attendanceDates).length, teacherId: teacherId };
      }

      function renderSalarySection(salaryData) {
        var tid = escapeHtml(salaryData.teacherId);
        return '<div class="box-stack salary-section"><div class="box-table-title">給与計算</div>' +
          '<table class="salary-table" data-salary-teacher-id="' + tid + '">' +
          '<thead><tr><th></th><th>コマ数(実績)</th><th>単価</th><th>小計</th></tr></thead>' +
          '<tbody>' +
          '<tr><td class="salary-label">A (1名/中学以下)</td><td class="salary-count" data-salary-cat="A">' + salaryData.countA + '</td><td><input class="salary-input" type="number" min="0" data-salary-unit="A" data-salary-key="salary-unit-A-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="A">0</td></tr>' +
          '<tr><td class="salary-label">B (2名/中学以下)</td><td class="salary-count" data-salary-cat="B">' + salaryData.countB + '</td><td><input class="salary-input" type="number" min="0" data-salary-unit="B" data-salary-key="salary-unit-B-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="B">0</td></tr>' +
          '<tr><td class="salary-label">C (1名/高校以上)</td><td class="salary-count" data-salary-cat="C">' + salaryData.countC + '</td><td><input class="salary-input" type="number" min="0" data-salary-unit="C" data-salary-key="salary-unit-C-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="C">0</td></tr>' +
          '<tr><td class="salary-label">D (2名/高校以上)</td><td class="salary-count" data-salary-cat="D">' + salaryData.countD + '</td><td><input class="salary-input" type="number" min="0" data-salary-unit="D" data-salary-key="salary-unit-D-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="D">0</td></tr>' +
          '<tr><td class="salary-label">交通費</td><td class="salary-count" data-salary-cat="commute">' + salaryData.attendanceDays + '日</td><td><input class="salary-input" type="number" min="0" data-salary-unit="commute" data-salary-key="salary-unit-commute-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="commute">0</td></tr>' +
          '<tr class="salary-total-row"><td class="salary-label">合計</td><td></td><td></td><td class="salary-grand-total">0</td></tr>' +
          '</tbody></table></div>';
      }

      function renderBottomSection(commonKey, individualKey, absenceRows, makeupRows, regularCounts, lectureCounts, regularWarningHtml, lectureWarningHtml, options) {
        const isTeacher = options && options.isTeacher;
        const salaryData = options && options.salaryData;
        const absenceTestId = options && options.absenceTestId ? options.absenceTestId : 'student-schedule-absence-table';
        const absenceSectionHtml = isTeacher
          ? ''
          : '<div class="box-stack"><div class="box-table-title">休み</div><table class="absence-table" data-testid="' + escapeHtml(absenceTestId) + '"><tbody>' + absenceRows + '</tbody></table></div>';
        const salarySectionHtml = isTeacher && salaryData ? renderSalarySection(salaryData) : '';
        if (isTeacher) {
          return '<div class="bottom-grid bottom-grid-teacher">' +
            salarySectionHtml +
            '<div class="box-stack"><div class="box-table-title">振替授業</div><table class="makeup-table"><tbody>' + makeupRows + '</tbody></table></div>' +
            '<div class="count-stack"><div class="count-stack-block"><div><div class="box-table-title">通常回数(希望数)</div><table class="count-table"><tbody>' + regularCounts + '</tbody></table></div></div><div class="count-stack-block"><div><div class="box-table-title">講習回数(希望数)</div><table class="count-table"><tbody>' + lectureCounts + '</tbody></table></div></div></div>' +
          '</div>';
        }
        return '<div class="bottom-grid">' +
          '<div class="box-stack"><div class="box-table-title">共通連絡事項</div><div class="box-panel"><textarea class="box-textarea memo-input" data-note-key="' + escapeHtml(commonKey) + '"></textarea></div></div>' +
          '<div class="box-stack"><div class="box-table-title">個別連絡事項</div><div class="box-panel"><textarea class="box-textarea memo-input" data-note-key="' + escapeHtml(individualKey) + '"></textarea></div></div>' +
          absenceSectionHtml +
          '<div class="box-stack"><div class="box-table-title">振替授業</div><table class="makeup-table"><tbody>' + makeupRows + '</tbody></table></div>' +
          '<div class="count-stack"><div class="count-stack-block"><div><div class="box-table-title">通常回数(希望数)</div><table class="count-table"><tbody>' + regularCounts + '</tbody></table></div>' + (regularWarningHtml || '') + '</div><div class="count-stack-block"><div><div class="box-table-title">講習回数(希望数)</div><table class="count-table"><tbody>' + lectureCounts + '</tbody></table></div>' + (lectureWarningHtml || '') + '</div></div>' +
        '</div>';
      }

      function formatCompactDateSlot(dateKey, slotNumber) {
        const date = new Date(dateKey + 'T00:00:00');
        return (date.getMonth() + 1) + '/' + date.getDate() + '(' + dayLabels[date.getDay()] + ')' + slotNumber + '限';
      }

      function compactMakeupSourceLabel(label) {
        return String(label || '').replace(/\s+/g, '');
      }

      function formatMakeupNote(subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [subject, compactMakeupSourceLabel(sourceLabel), '→', formatCompactDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function formatTeacherMakeupNote(studentName, subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [studentName, subject, compactMakeupSourceLabel(sourceLabel), '→', formatCompactDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function formatAbsenceNote(dateKey, slotNumber, teacherName, subject, lessonType, status) {
        var base = [formatCompactDateSlot(dateKey, slotNumber), lessonTypeLabels[lessonType] || lessonType, subject].filter(Boolean).join(' / ');
        if (status === 'absent-no-makeup') base += ' (振無休)';
        return base;
      }

      function toMakeupRows(makeupNotes, minimumRowCount) {
        return Array.from({ length: Math.max(minimumRowCount, makeupNotes.length) }, (_, rowIndex) => {
          const note = makeupNotes[rowIndex] ?? '';
          const len = note.length;
          const fs = len > 40 ? 'font-size:7px;' : len > 28 ? 'font-size:8px;' : '';
          return '<tr><td colspan="3"' + (fs ? ' style="' + fs + '"' : '') + '>' + escapeHtml(note) + '</td></tr>';
        }).join('');
      }

      function collectStudentMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          if (entry.lesson.status === 'absent' || entry.lesson.status === 'absent-no-makeup') return notes;
          const note = formatMakeupNote(entry.lesson.subject, entry.lesson.makeupSourceLabel, entry.dateKey, entry.slotNumber);
          if (note) notes.push(note);
          return notes;
        }, []);
      }

      function collectTeacherMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          entry.students.forEach((student) => {
            const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber);
            if (note) notes.push(note);
          });
          (entry.statuses || []).forEach((student) => {
            if (student.status === 'absent' || student.status === 'absent-no-makeup') return;
            const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber);
            if (note) notes.push(note);
          });
          return notes;
        }, []);
      }

      function collectStudentAbsenceNotes(cells, student) {
        const notes = [];
        (cells || []).forEach((cell) => {
          (cell.desks || []).forEach((desk) => {
            const statuses = Array.isArray(desk.statuses) ? desk.statuses : [];
            statuses.forEach((entry) => {
              if (!entry) return;
              if (entry.status !== 'absent' && entry.status !== 'absent-no-makeup') return;
              const linkedStudentId = entry.linkedStudentId || '';
              const isSameStudent = linkedStudentId === student.id || entry.name === student.name || entry.name === student.fullName;
              if (!isSameStudent) return;
              notes.push(formatAbsenceNote(cell.dateKey, cell.slotNumber, entry.teacherName || desk.teacher, entry.subject, entry.lessonType, entry.status));
            });
          });
        });
        return notes;
      }

      function renderPeriodPill(segment, stateHtml) {
        return '<span class="period-pill-edge">◀</span><span class="period-pill-center"><span class="period-pill-label">' + escapeHtml(segment.label) + '</span>' + (stateHtml ? '<span class="period-pill-state-inline print-only-hidden">' + stateHtml + '</span>' : '') + '</span><span class="period-pill-edge">▶</span>';
      }

      function renderStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return '';
        const student = DATA.students.find((entry) => entry.id === activeCountDialog.studentId);
        const session = getSpecialSessionById(activeCountDialog.sessionId);
        if (!student || !session) return '';
        const referenceDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        const input = getStudentSessionInput(student.id, session.id);
        const normalizedSubjectSlots = normalizeCountMapSubjects(input.subjectSlots, student, referenceDate);
        const visibleSubjects = getVisibleSubjectsForStudent(student, referenceDate, Object.keys(normalizedSubjectSlots));
        const rowsHtml = input.countSubmitted
          ? visibleSubjects.map((subject) => '<tr><td>' + escapeHtml(subject) + '</td><td>' + escapeHtml(String(Number(normalizedSubjectSlots[subject] || 0))) + '</td></tr>').join('')
          : visibleSubjects.map((subject) => '<tr><td>' + escapeHtml(subject) + '</td><td><input type="number" min="0" step="1" value="' + escapeHtml(String(Number(normalizedSubjectSlots[subject] || 0))) + '" data-role="student-count-subject-input" data-subject="' + subject + '" data-testid="student-schedule-count-subject-' + subject + '"' + (input.regularOnly ? ' disabled' : '') + '></td></tr>').join('');
        const actionHtml = input.countSubmitted
          ? '<button type="button" data-role="unsubmit-student-count-modal" data-testid="student-schedule-count-unregister">登録解除</button>'
          : '<button type="button" data-role="submit-student-count-modal" data-testid="student-schedule-count-register">登録</button>';
        const unregisterNote = input.countSubmitted
          ? '<div class="count-modal-note">登録中は編集できません。編集する場合は登録解除して、内容を直してから再度登録してください。</div><div class="count-modal-note">登録解除すると、コマ表からこの生徒だけ外します。講師は残ります。</div>'
          : '';
        const regularOnlyRow = input.countSubmitted
          ? '<tr><td>通常のみ</td><td>' + escapeHtml(input.regularOnly ? 'あり' : 'なし') + '</td></tr>'
          : '<tr><td>通常のみ</td><td><label class="count-modal-check"><input type="checkbox" data-role="student-count-regular-only" data-testid="student-schedule-count-regular-only"' + (input.regularOnly ? ' checked' : '') + '>通常のみ</label></td></tr>';
        return '<div class="count-modal-backdrop" data-role="student-count-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="student-schedule-count-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatStudentHeaderName(student, startInput.value || DATA.defaultStartDate || DATA.availableStartDate)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + '</div><div class="count-modal-note">日程表の出席不可コマと講習での希望科目数を登録します。</div>' + unregisterNote + '</div><div class="count-modal-body"><table class="count-modal-table"><tbody>' + rowsHtml + regularOnlyRow + '</tbody></table></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-student-count-modal" data-testid="student-schedule-count-cancel">キャンセル</button>' + actionHtml + '</div></div></div>';
      }

      function renderTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return '';
        const teacher = DATA.teachers.find((entry) => entry.id === activeTeacherRegisterDialog.teacherId);
        const session = getSpecialSessionById(activeTeacherRegisterDialog.sessionId);
        if (!teacher || !session) return '';
        const input = getTeacherSessionInput(teacher.id, session.id);
        const unavailableCount = input.unavailableSlots.filter((slotKey) => {
          const [dateKey] = String(slotKey || '').split('_');
          return Boolean(dateKey) && dateKey >= session.startDate && dateKey <= session.endDate;
        }).length;
        const actionHtml = input.countSubmitted
          ? '<button type="button" data-role="unsubmit-teacher-register-modal" data-testid="teacher-schedule-register-unregister">登録解除</button>'
          : '<button type="button" data-role="submit-teacher-register-modal" data-testid="teacher-schedule-register-submit">登録</button>';
        const unregisterNote = input.countSubmitted
          ? '<div class="count-modal-note">登録解除すると、コマ表からこの講師だけ外します。生徒は残ります。</div>'
          : '<div class="count-modal-note">登録された予定に従い、コマ表に講師名を追加します。</div>';
        return '<div class="count-modal-backdrop" data-role="teacher-register-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="teacher-schedule-register-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatTeacherHeaderName(teacher)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + 'の期間に、</div></div><div class="count-modal-body">' + unregisterNote + '<div class="count-modal-note">講師数が多く、机数より多くなる場合はスキップされます。</div></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-teacher-register-modal" data-testid="teacher-schedule-register-cancel">キャンセル</button>' + actionHtml + '</div></div></div>';
      }

      function openStudentCountModal(studentId, sessionId) {
        if (!studentId || !sessionId) return;
        activeCountDialog = { studentId, sessionId };
        render();
      }

      function openTeacherRegisterModal(teacherId, sessionId) {
        if (!teacherId || !sessionId) return;
        activeTeacherRegisterDialog = { teacherId, sessionId };
        render();
      }

      function closeStudentCountModal() {
        if (!activeCountDialog) return;
        activeCountDialog = null;
        render();
      }

      function closeTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog) return;
        activeTeacherRegisterDialog = null;
        render();
      }

      function submitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const regularOnlyElement = document.querySelector('[data-role="student-count-regular-only"]');
        const regularOnly = regularOnlyElement instanceof HTMLInputElement ? Boolean(regularOnlyElement.checked) : false;
        const subjectSlots = {};
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (!(element instanceof HTMLInputElement)) return;
          const subject = element.getAttribute('data-subject') || '';
          if (!subject) return;
          const normalizedValue = Number.isFinite(Number(element.value)) ? Math.max(0, Math.trunc(Number(element.value))) : 0;
          if (normalizedValue > 0) subjectSlots[subject] = normalizedValue;
        });
        const requestedCount = regularOnly
          ? 0
          : Object.values(subjectSlots).reduce((total, value) => total + (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0), 0);
        const availableSlotCount = countAvailableStudentSlotsForSession(activeCountDialog.studentId, activeCountDialog.sessionId);
        if (requestedCount > availableSlotCount) {
          alert('希望科目数が出席可能コマ数を上回っているため登録できません。出席不可コマを見直してください。');
          activeCountDialog = null;
          render();
          return;
        }

        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true);
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const currentInput = getStudentSessionInput(activeCountDialog.studentId, activeCountDialog.sessionId);
        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        var matchedStudent = (DATA.students || []).find(function(s) { return s.id === activeCountDialog.studentId; });
        if (matchedStudent) matchedStudent.submissionSubmitted = false;
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function submitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        var matchedTeacher = (DATA.teachers || []).find(function(t) { return t.id === activeTeacherRegisterDialog.teacherId; });
        if (matchedTeacher) matchedTeacher.submissionSubmitted = false;
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function getSortedPeriodBands() {
        return DATA.periodBands
          .slice()
          .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja'));
      }

      function buildPeriodValue(band) {
        return band.startDate + '|' + band.endDate + '|' + band.label;
      }

      function syncPeriodSelectOptions(preferredValue) {
        const previousValue = preferredValue ?? periodSelect.value;
        const options = ['<option value="">選択してください</option>'];
        const sortedBands = getSortedPeriodBands();
        sortedBands.forEach((band) => {
          const value = buildPeriodValue(band);
          options.push('<option value="' + escapeHtml(value) + '">' + escapeHtml(band.label + ' (' + formatMonthDay(band.startDate) + ' - ' + formatMonthDay(band.endDate) + ')') + '</option>');
        });
        periodSelect.innerHTML = options.join('');
        if (Array.from(periodSelect.options).some((option) => option.value === previousValue)) {
          periodSelect.value = previousValue;
          return;
        }

        const matchedBand = sortedBands.find((band) => band.startDate === startInput.value && band.endDate === endInput.value);
        periodSelect.value = matchedBand ? buildPeriodValue(matchedBand) : '';
      }

      function buildHeaderHtml(title, nameLabel, subLabel, pageIndex, periodLabel, qrHtml) {
        var qrBlock = '';
        if (qrHtml) {
          qrBlock = '<div class="meta-qr-block">' + qrHtml + '</div>';
        }
        return '<div class="sheet-top">'
          + '<div class="logo-box" data-shared-image="logo"><span class="logo-placeholder">ロゴ欄</span></div>'
          + '<div class="school-box"><textarea class="school-input shared-input" data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等"></textarea></div>'
          + '<div class="title-box"><input class="title-input shared-input" data-shared-input="sheet-title" value="" placeholder="授業日程表" /></div>'
          + '<div class="meta-box">' + qrBlock + '<div class="meta-info"><div class="meta-row"><span class="meta-label">期間:</span> ' + escapeHtml(periodLabel) + '</div><div class="meta-row person-meta-row"><span><span class="meta-label">' + escapeHtml(nameLabel) + ':</span> ' + escapeHtml(subLabel) + '</span></div><div class="meta-row"><span class="page-count print-only-hidden">' + (pageIndex + 1) + 'ページ目</span></div></div></div>'
          + '</div>';
      }

      function formatStudentHeaderName(student, referenceDate) {
        const gradeLabel = student.currentGradeLabel || getGradeLabel(student.birthDate, referenceDate);
        const sourceName = student.fullName || student.name;
        return gradeLabel ? sourceName + '(' + gradeLabel + ')' : sourceName;
      }

      function compareStudentOrder(left, right) {
        const orderDifference = (left.currentGradeOrder || 999) - (right.currentGradeOrder || 999);
        if (orderDifference !== 0) return orderDifference;
        const nameDifference = (left.name || '').localeCompare(right.name || '', 'ja');
        if (nameDifference !== 0) return nameDifference;
        return (left.fullName || '').localeCompare(right.fullName || '', 'ja');
      }

      function formatTeacherHeaderName(teacher) {
        return teacher.fullName || teacher.name;
      }

      function normalizeSearchText(value) {
        return String(value || '').replace(/\s+/g, '').toLowerCase();
      }

      function getVisibleStudents(startDate, endDate) {
        return DATA.students.filter((student) => isVisibleInRange(student, startDate, endDate)).sort(compareStudentOrder);
      }

      function getVisibleTeachers(startDate, endDate) {
        return DATA.teachers.filter((teacher) => isVisibleInRange(teacher, startDate, endDate)).sort((left, right) => left.name.localeCompare(right.name, 'ja'));
      }

      function getFilteredPeople(startDate, endDate) {
        const people = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        const query = normalizeSearchText(personSearchInput && 'value' in personSearchInput ? personSearchInput.value : '');
        if (!query) return people;
        return people.filter((person) => [person.name, person.fullName].some((label) => normalizeSearchText(label).includes(query)));
      }

      function getDefaultAppliedPersonId(startDate, endDate) {
        const people = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        if (!people.length) return '';
        if (appliedPersonId && people.some((person) => person.id === appliedPersonId)) return appliedPersonId;
        if (VIEW_TYPE === 'student') {
          const highlightedStudentId = DATA.highlightedStudentSlot && typeof DATA.highlightedStudentSlot.studentId === 'string'
            ? DATA.highlightedStudentSlot.studentId
            : '';
          if (highlightedStudentId && people.some((person) => person.id === highlightedStudentId)) return highlightedStudentId;
        }
        return people[0].id;
      }

      function syncPersonSelectOptions(preferredPersonId) {
        const draftStartDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        const draftEndDate = endInput.value || DATA.defaultEndDate || DATA.availableEndDate;
        const normalizedStartDate = draftStartDate <= draftEndDate ? draftStartDate : draftEndDate;
        const normalizedEndDate = draftStartDate <= draftEndDate ? draftEndDate : draftStartDate;
        const people = getFilteredPeople(normalizedStartDate, normalizedEndDate);
        const currentValue = preferredPersonId ?? personSelect.value;

        if (!people.length) {
          personSelect.innerHTML = '<option value="">該当なし</option>';
          personSelect.value = '';
          applyButton.disabled = true;
          return '';
        }

        personSelect.innerHTML = people.map((person) => {
          const label = VIEW_TYPE === 'student'
            ? formatStudentHeaderName(person, normalizedStartDate)
            : formatTeacherHeaderName(person);
          return '<option value="' + escapeHtml(person.id) + '">' + escapeHtml(label) + '</option>';
        }).join('');
        const nextValue = people.some((person) => person.id === currentValue) ? currentValue : people[0].id;
        personSelect.value = nextValue;
        applyButton.disabled = false;
        return nextValue;
      }

      function buildStudentCountAdjustmentMap(student, startDate, endDate, countKind) {
        const countMap = {};
        (DATA.countAdjustments || []).forEach((entry) => {
          if (!entry || entry.countKind !== countKind) return;
          const matchesStudent = entry.studentKey === student.id || entry.studentKey === student.name || entry.studentKey === student.fullName;
          if (!matchesStudent) return;
          if (entry.dateKey < startDate || entry.dateKey > endDate) return;
          const normalizedSubject = normalizeSubjectForStudent(entry.subject, student, startDate);
          const delta = Number.isFinite(Number(entry.delta)) ? Math.trunc(Number(entry.delta)) : 0;
          if (!normalizedSubject || delta === 0) return;
          countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + delta;
        });
        return countMap;
      }

      function applyCountAdjustments(countMap, adjustmentMap) {
        const next = { ...(countMap || {}) };
        Object.entries(adjustmentMap || {}).forEach(([subject, rawDelta]) => {
          const delta = Number.isFinite(Number(rawDelta)) ? Math.trunc(Number(rawDelta)) : 0;
          if (delta === 0) return;
          const nextValue = (next[subject] || 0) + delta;
          if (nextValue > 0) next[subject] = nextValue;
          else delete next[subject];
        });
        return next;
      }

      function renderStudentPages(startDate, endDate, studentId) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildStudentAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const students = getVisibleStudents(startDate, endDate);
        const student = students.find((entry) => entry.id === studentId) || students[0] || null;
        if (!student) {
          pagesElement.innerHTML = '<div class="empty-state">表示できる生徒が見つかりません。</div>';
          return null;
        }
        const showQr = shouldShowScheduleQr();
        const studentIndex = Math.max(0, students.findIndex((entry) => entry.id === student.id));
        const entries = assignmentMap.get(student.id) || assignmentMap.get(student.name) || [];
        const keyMap = new Map(entries.map((entry) => [entry.dateKey + '_' + entry.slotNumber, entry]));
        const unavailableSlots = getUnavailableSlotsForStudent(student.id);
        const subjectCounts = {};
        const plannedRegularCounts = {};
        const lectureCounts = {};
        const desiredLectureCounts = buildDesiredLectureCountMap(student, startDate, endDate);
        const regularCountAdjustments = buildStudentCountAdjustmentMap(student, startDate, endDate, 'regular');
        const lectureCountAdjustments = buildStudentCountAdjustmentMap(student, startDate, endDate, 'special');
        const absenceNotes = collectStudentAbsenceNotes(filteredCells, student);
        const makeupNotes = collectStudentMakeupNotes(entries);
        entries.forEach((entry) => {
          if (entry.lesson.status === 'absent' || entry.lesson.status === 'absent-no-makeup') return;
          if (entry.lesson.lessonType === 'special') lectureCounts[entry.lesson.subject] = (lectureCounts[entry.lesson.subject] || 0) + 1;
          else subjectCounts[entry.lesson.subject] = (subjectCounts[entry.lesson.subject] || 0) + 1;
        });
        (Array.isArray(DATA.expectedRegularOccurrences) ? DATA.expectedRegularOccurrences : []).forEach((entry) => {
          if (entry.linkedStudentId !== student.id) return;
          if (entry.dateKey < startDate || entry.dateKey > endDate) return;
          plannedRegularCounts[entry.subject] = (plannedRegularCounts[entry.subject] || 0) + 1;
        });
        const visibleRegularCounts = normalizeCountMapSubjects(subjectCounts, student, startDate);
        const visiblePlannedRegularCounts = applyCountAdjustments(normalizeCountMapSubjects(plannedRegularCounts, student, startDate), regularCountAdjustments);
        const visibleLectureCounts = normalizeCountMapSubjects(lectureCounts, student, startDate);
        const visibleDesiredLectureCounts = applyCountAdjustments(normalizeCountMapSubjects(desiredLectureCounts, student, startDate), lectureCountAdjustments);
        const regularCountWarningHtml = hasCountMismatch(visibleRegularCounts, visiblePlannedRegularCounts)
          ? '<div class="count-warning-stamp print-only-hidden" data-testid="student-schedule-regular-count-warning">希望数と予定数が一致していません！</div>'
          : '';
        const lectureCountWarningHtml = hasCountMismatch(visibleLectureCounts, visibleDesiredLectureCounts)
          ? '<div class="count-warning-stamp print-only-hidden" data-testid="student-schedule-lecture-count-warning">希望数と予定数が一致していません！</div>'
          : '';
        const rows = slotNumbers.map((slotNumber) => {
          const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
          const cellsHtml = dateHeaders.map((dateHeader) => {
            const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
            const assignment = keyMap.get(dateHeader.dateKey + '_' + slotNumber);
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const isEditable = getEditableSpecialSessionsForStudent(student.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
            const classes = ['slot-cell'];
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
            if (isEditable) classes.push('is-editable');
            if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
            const highlightedStudentSlot = DATA.highlightedStudentSlot;
            const isHighlightedStudent = highlightedStudentSlot && (
              highlightedStudentSlot.studentId === student.id
              || highlightedStudentSlot.studentName === student.fullName
              || highlightedStudentSlot.studentName === student.name
              || highlightedStudentSlot.studentDisplayName === student.name
            );
            if (isHighlightedStudent && highlightedStudentSlot.dateKey === dateHeader.dateKey && highlightedStudentSlot.slotNumber === slotNumber) {
              classes.push('is-moving-highlight');
            }
            let content = '<div class="empty-label"></div>';
            if (assignment) content = renderStudentCellCard(assignment.lesson);
            const title = assignment ? [assignment.lesson.subject, lessonTypeLabels[assignment.lesson.lessonType] || assignment.lesson.lessonType, assignment.teacher].filter(Boolean).join(' / ') : '';
            return '<td class="' + classes.join(' ') + '" data-role="student-slot-cell" data-student-id="' + student.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', student.id, 'cell', slotKey) + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="student-schedule-cell-' + student.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderStudentSlotContent(student.id, slotKey, content, title, !isEditable) + '</div></td>';
          }).join('');
          return '<tr>' + renderStudentTimeHeaderCell(student.id, timeLabel, slotNumber, dateHeaders, cellMap) + cellsHtml + '</tr>';
        }).join('');
        const absenceRows = toMakeupRows(absenceNotes, 7);
        const makeupRows = toMakeupRows(makeupNotes, 7);
        const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => renderStudentPeriodBandCell(student.id, segment)).join('') + '</tr>' : '';
        const qrHtml = student.submissionSubmitted
          ? '<span class="submission-badge print-only-hidden" data-role="submission-reset-badge" data-person-type="student" data-person-id="' + student.id + '">希望<br>提出済</span>'
          : student.qrSvg ? '<span class="qr-code">' + student.qrSvg + '</span>' : '';
        const dateHeaderHtml = dateHeaders.map((header) => renderStudentDateHeaderCell(student.id, header, slotNumbers, cellMap)).join('');
        pagesElement.innerHTML = '<section class="sheet" data-role="student-sheet" data-student-id="' + student.id + '">' + buildHeaderHtml('授業日程表', '生徒名', formatStudentHeaderName(student, startDate), studentIndex, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + dateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + rows + '</tbody></table>' + renderBottomSection('student-common', 'student-' + student.id, absenceRows, makeupRows, toCountRows(visibleRegularCounts, visiblePlannedRegularCounts), toCountRows(visibleLectureCounts, visibleDesiredLectureCounts), regularCountWarningHtml, lectureCountWarningHtml, { absenceTestId: 'student-schedule-absence-table-' + student.id }) + '</section>';
        return student;
      }

      function renderTeacherPages(startDate, endDate, teacherId) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildTeacherAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const teachers = getVisibleTeachers(startDate, endDate);
        const teacher = teachers.find((entry) => entry.id === teacherId) || teachers[0] || null;
        if (!teacher) {
          pagesElement.innerHTML = '<div class="empty-state">表示できる講師が見つかりません。</div>';
          return null;
        }
        const showQr = shouldShowScheduleQr();
        const teacherIndex = Math.max(0, teachers.findIndex((entry) => entry.id === teacher.id));
        const entries = assignmentMap.get(teacher.name) || (teacher.fullName ? assignmentMap.get(teacher.fullName) || [] : []);
        const keyMap = new Map(entries.map((entry) => [entry.dateKey + '_' + entry.slotNumber, entry]));
        const unavailableSlots = getUnavailableSlotsForTeacher(teacher.id);
        const regularCounts = {};
        const lectureCounts = {};
        const makeupNotes = collectTeacherMakeupNotes(entries);
        entries.forEach((entry) => {
          entry.students.forEach((student) => {
            if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1;
            else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1;
          });
          (entry.statuses || []).forEach((student) => {
            if (student.status === 'absent' || student.status === 'absent-no-makeup') return;
            if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1;
            else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1;
          });
        });
        const rows = slotNumbers.map((slotNumber) => {
          const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
          const cellsHtml = dateHeaders.map((dateHeader) => {
            const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
            const entry = keyMap.get(dateHeader.dateKey + '_' + slotNumber);
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const isEditable = getEditableSpecialSessionsForTeacher(teacher.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
            const classes = ['slot-cell'];
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
            if (isEditable) classes.push('is-editable');
            if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
            let content = '<div class="empty-label"></div>';
            if (entry && ((entry.students || []).length > 0 || (entry.statuses || []).length > 0)) content = renderTeacherCellCard(entry.students, entry.statuses);
            const title = entry ? [...entry.students, ...(entry.statuses || [])].map((student) => formatTeacherTooltipEntry(student)).join(' | ') : '';
            return '<td class="' + classes.join(' ') + '" data-role="teacher-slot-cell" data-teacher-id="' + teacher.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacher.id, 'cell', slotKey) + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="teacher-schedule-cell-' + teacher.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderTeacherSlotContent(teacher.id, slotKey, content, title, !isEditable) + '</div></td>';
          }).join('');
          return '<tr>' + renderTeacherTimeHeaderCell(teacher.id, timeLabel, slotNumber, dateHeaders, cellMap) + cellsHtml + '</tr>';
        }).join('');
        const makeupRows = toMakeupRows(makeupNotes, 7);
        const salaryData = buildTeacherSalaryData(entries, teacher.id);
        const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => renderTeacherPeriodBandCell(teacher.id, segment)).join('') + '</tr>' : '';
        const qrHtml = teacher.submissionSubmitted
          ? '<span class="submission-badge print-only-hidden" data-role="submission-reset-badge" data-person-type="teacher" data-person-id="' + teacher.id + '">希望<br>提出済</span>'
          : teacher.qrSvg ? '<span class="qr-code">' + teacher.qrSvg + '</span>' : '';
        const teacherDateHeaderHtml = dateHeaders.map((header) => renderTeacherDateHeaderCell(teacher.id, header, slotNumbers, cellMap)).join('');
        pagesElement.innerHTML = '<section class="sheet" data-role="teacher-sheet" data-teacher-id="' + teacher.id + '">' + buildHeaderHtml('授業日程表', '講師名', formatTeacherHeaderName(teacher), teacherIndex, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + teacherDateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + rows + '</tbody></table>' + renderBottomSection('teacher-common', 'teacher-' + teacher.id, '', makeupRows, toCountRows(regularCounts), toCountRows(lectureCounts), '', '', { isTeacher: true, salaryData: salaryData }) + '</section>';
        return teacher;
      }

      function applyIncomingPayload(nextPayload) {
        const nextFingerprint = JSON.stringify(nextPayload);
        const draftStartDate = startInput.value;
        const draftEndDate = endInput.value;
        const draftPeriodValue = periodSelect.value;
        const draftPersonId = personSelect.value;

        // Auto-switch to highlighted student when highlight data arrives
        var highlightPersonId = nextPayload.highlightedStudentSlot && nextPayload.highlightedStudentSlot.studentId;
        if (VIEW_TYPE === 'student' && highlightPersonId && highlightPersonId !== appliedPersonId) {
          appliedPersonId = highlightPersonId;
        }

        if (skipNextEquivalentPayload && nextFingerprint === payloadFingerprint) {
          DATA = nextPayload;
          payloadFingerprint = nextFingerprint;
          skipNextEquivalentPayload = false;
          syncPeriodSelectOptions(draftPeriodValue || appliedPeriodValue);
          if (draftStartDate) setDateInputValue(startInput, draftStartDate);
          if (draftEndDate) setDateInputValue(endInput, draftEndDate);
          syncPersonSelectOptions(appliedPersonId);
          if (appliedStartDate && appliedEndDate && isDateWithinAvailableRange(appliedStartDate) && isDateWithinAvailableRange(appliedEndDate)) {
            render();
            return;
          }
          const preferredRange = getPreferredRange();
          setRangeAndRender(
            preferredRange.startDate,
            preferredRange.endDate,
            preferredRange.periodValue,
            appliedPersonId || getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
          );
          return;
        }

        skipNextEquivalentPayload = false;
        DATA = nextPayload;
        payloadFingerprint = nextFingerprint;
        syncPeriodSelectOptions(draftPeriodValue || appliedPeriodValue);
        if (draftStartDate) setDateInputValue(startInput, draftStartDate);
        if (draftEndDate) setDateInputValue(endInput, draftEndDate);
        syncPersonSelectOptions(appliedPersonId);
        if (appliedStartDate && appliedEndDate && isDateWithinAvailableRange(appliedStartDate) && isDateWithinAvailableRange(appliedEndDate)) {
          render();
          return;
        }
        const preferredRange = getPreferredRange();
        setRangeAndRender(
          preferredRange.startDate,
          preferredRange.endDate,
          preferredRange.periodValue,
          appliedPersonId || getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
        );
      }

      function bindNotes() {
        document.querySelectorAll('.memo-input').forEach((element) => {
          const noteKey = element.getAttribute('data-note-key');
          const key = 'schedule-note:' + VIEW_TYPE + ':' + noteKey;
          const storage = getSharedStorage();
          try {
            const saved = storage ? storage.getItem(key) : null;
            if (saved !== null && !element.value) element.value = saved;
          } catch {}
          element.addEventListener('input', () => {
            try { storage && storage.setItem(key, element.value); } catch {}
            document.querySelectorAll('.memo-input[data-note-key="' + noteKey + '"]').forEach((other) => {
              if (other !== element) other.value = element.value;
            });
          });
        });
      }

      function bindSalaryInputs() {
        document.querySelectorAll('.salary-input[data-salary-key]').forEach(function(element) {
          var salaryKey = element.getAttribute('data-salary-key');
          var key = 'schedule-salary:' + VIEW_TYPE + ':' + salaryKey;
          var storage = getSharedStorage();
          try {
            var saved = storage ? storage.getItem(key) : null;
            if (saved !== null && !element.value) element.value = saved;
          } catch(e) {}
          recalcSalary(element);
          element.addEventListener('input', function() {
            try { storage && storage.setItem(key, element.value); } catch(e) {}
            recalcSalary(element);
          });
        });
      }

      function recalcSalary(changedElement) {
        var section = changedElement.closest('.salary-section');
        if (!section) return;
        var grand = 0;
        section.querySelectorAll('.salary-input[data-salary-key]').forEach(function(inp) {
          var row = inp.closest('tr');
          if (!row) return;
          var countCell = row.querySelector('.salary-count');
          var subtotalCell = row.querySelector('.salary-subtotal');
          if (!countCell || !subtotalCell) return;
          var count = parseInt(countCell.textContent, 10) || 0;
          var unitPrice = parseInt(inp.value, 10) || 0;
          var subtotal = count * unitPrice;
          subtotalCell.textContent = subtotal ? subtotal.toLocaleString() : '';
          grand += subtotal;
        });
        var totalCell = section.querySelector('.salary-grand-total');
        if (totalCell) totalCell.textContent = grand ? grand.toLocaleString() + ' 円' : '';
      }

      function bindSharedInputs() {
        document.querySelectorAll('.shared-input').forEach((element) => {
          const sharedKey = element.getAttribute('data-shared-input');
          const storageKey = getSharedInputStorageKey(sharedKey);
          const storage = getSharedStorage();
          try {
            const saved = storage ? storage.getItem(storageKey) : null;
            if (saved !== null) element.value = saved;
            if (saved === null && sharedKey === 'sheet-title') element.value = '授業日程表';
          } catch {}
          element.addEventListener('input', () => {
            try { storage && storage.setItem(storageKey, element.value); } catch {}
            document.querySelectorAll('.shared-input[data-shared-input="' + sharedKey + '"]').forEach((other) => {
              if (other !== element) other.value = element.value;
            });
            if (sharedKey === 'school-info') syncScheduleQrVisibility();
          });
        });
      }

      function readStoredRange() {
        const storage = getSharedStorage();
        try {
          return {
            startDate: storage ? storage.getItem(rangeStoragePrefix + 'start') || '' : '',
            endDate: storage ? storage.getItem(rangeStoragePrefix + 'end') || '' : '',
            periodValue: storage ? storage.getItem(rangeStoragePrefix + 'period') || '' : '',
          };
        } catch {
          return { startDate: '', endDate: '', periodValue: '' };
        }
      }

      function writeStoredRange(startDate, endDate, periodValue) {
        const storage = getSharedStorage();
        try {
          if (!storage) return;
          storage.setItem(rangeStoragePrefix + 'start', startDate || '');
          storage.setItem(rangeStoragePrefix + 'end', endDate || '');
          storage.setItem(rangeStoragePrefix + 'period', periodValue || '');
        } catch {}
      }

      function notifyRangeChange(startDate, endDate, periodValue) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-range-update',
            viewType: VIEW_TYPE,
            startDate: startDate || '',
            endDate: endDate || '',
            periodValue: periodValue || '',
          }, '*');
        } catch {}
      }

      function notifyPopupReady() {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-popup-ready',
            viewType: VIEW_TYPE,
          }, '*');
        } catch {}
      }

      function handleTeacherUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-teacher-register-modal') {
          openTeacherRegisterModal(target.getAttribute('data-teacher-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-teacher-register-modal' || role === 'teacher-register-modal-backdrop') {
          closeTeacherRegisterModal();
          return;
        }

        if (role === 'submit-teacher-register-modal') {
          submitTeacherRegisterModal();
          return;
        }

        if (role === 'unsubmit-teacher-register-modal') {
          unsubmitTeacherRegisterModal();
          return;
        }

        if (role === 'toggle-teacher-unavailable-date') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        if (role === 'toggle-teacher-unavailable-slot') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        const cellTarget = role === 'teacher-slot-cell' ? target : target.closest('[data-role="teacher-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const teacherId = cellTarget.getAttribute('data-teacher-id') || target.getAttribute('data-teacher-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!teacherId || !slotKey) return;
        toggleTeacherUnavailableSlot(teacherId, slotKey);
      }

      function handleStudentUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-student-count-modal') {
          openStudentCountModal(target.getAttribute('data-student-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-student-count-modal' || role === 'student-count-modal-backdrop') {
          closeStudentCountModal();
          return;
        }

        if (role === 'submit-student-count-modal') {
          submitStudentCountModal();
          return;
        }

        if (role === 'unsubmit-student-count-modal') {
          unsubmitStudentCountModal();
          return;
        }

        if (role === 'toggle-student-unavailable-date') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !studentId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        if (role === 'toggle-student-unavailable-slot') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !studentId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        const cellTarget = role === 'student-slot-cell' ? target : target.closest('[data-role="student-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const studentId = cellTarget.getAttribute('data-student-id') || target.getAttribute('data-student-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!studentId || !slotKey) return;
        toggleStudentUnavailableSlot(studentId, slotKey);
      }

      function handleUnavailablePointerDown(target) {
        if (isUnavailableTogglePending(target)) return true;
        const role = target.getAttribute('data-role') || '';
        if (!role.includes('unavailable') && role !== 'student-slot-cell' && role !== 'teacher-slot-cell') return false;
        if (role.includes('modal')) return false;
        if (role.includes('teacher')) {
          handleTeacherUnavailableClick(target);
          return true;
        }
        handleStudentUnavailableClick(target);
        return true;
      }

      function isDateWithinAvailableRange(dateKey) {
        return !dateKey || (dateKey >= DATA.availableStartDate && dateKey <= DATA.availableEndDate);
      }

      function getPreferredRange() {
        const stored = readStoredRange();
        const startDate = isDateWithinAvailableRange(stored.startDate) ? stored.startDate : '';
        const endDate = isDateWithinAvailableRange(stored.endDate) ? stored.endDate : '';
        return {
          startDate: startDate || DATA.defaultStartDate || DATA.availableStartDate,
          endDate: endDate || DATA.defaultEndDate || DATA.availableEndDate,
          periodValue: stored.periodValue || DATA.defaultPeriodValue || '',
        };
      }

      function syncLogo(src) {
        document.querySelectorAll('[data-shared-image="logo"]').forEach((element) => {
          element.innerHTML = src ? '<img class="logo-image" src="' + src + '" alt="logo" />' : '<span class="logo-placeholder">ロゴ欄</span>';
        });
      }

      function bindLogoControls() {
        const logoInput = document.getElementById('schedule-logo-input');
        const storageKey = sharedGlobalStoragePrefix + 'logo';
        const readStoredLogo = () => {
          const storage = getSharedStorage();
          try {
            return storage ? storage.getItem(storageKey) || '' : '';
          } catch {
            return '';
          }
        };
        try {
          syncLogo(readStoredLogo());
        } catch {
          syncLogo('');
        }
        document.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const logoBox = target.closest('[data-shared-image="logo"]');
          if (!logoBox) return;
          logoInput.click();
        });
        logoInput.addEventListener('change', () => {
          const file = logoInput.files && logoInput.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            syncLogo(result);
            try {
              const storage = getSharedStorage();
              storage && storage.setItem(storageKey, result);
            } catch {}
          };
          reader.readAsDataURL(file);
        });
        return readStoredLogo;
      }

      function getDraftRange() {
        let startDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = endInput.value || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        return {
          startDate,
          endDate,
          periodValue: periodSelect.value || '',
        };
      }

      function render() {
        let startDate = appliedStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = appliedEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
          appliedStartDate = startDate;
          appliedEndDate = endDate;
        }

        const visiblePeople = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        if (!visiblePeople.some((person) => person.id === appliedPersonId)) {
          appliedPersonId = getDefaultAppliedPersonId(startDate, endDate);
        }

        let displayedPerson = null;
        try {
          if (VIEW_TYPE === 'student') displayedPerson = renderStudentPages(startDate, endDate, appliedPersonId);
          else displayedPerson = renderTeacherPages(startDate, endDate, appliedPersonId);
          if (VIEW_TYPE === 'student') pagesElement.insertAdjacentHTML('beforeend', renderStudentCountModal());
          if (VIEW_TYPE === 'teacher') pagesElement.insertAdjacentHTML('beforeend', renderTeacherRegisterModal());
        } catch (error) {
          pagesElement.innerHTML = '<div class="empty-state">表示中にエラーが発生しました: ' + escapeHtml(String(error)) + '</div>';
        }

        const personLabel = displayedPerson
          ? (VIEW_TYPE === 'student' ? formatStudentHeaderName(displayedPerson, startDate) : formatTeacherHeaderName(displayedPerson))
          : '対象なし';
        summaryLabel.textContent = '表示中: ' + formatRangeLabel(startDate, endDate) + ' / ' + personLabel;
        document.title = VIEW_LABEL + ' | ' + formatRangeLabel(startDate, endDate) + ' | ' + personLabel;
        updateSheetScreenSize();
        syncPendingUnavailableUi(pagesElement);
        bindNotes();
        bindSalaryInputs();
        bindSharedInputs();
        if (window.__scheduleReadStoredLogo) syncLogo(window.__scheduleReadStoredLogo());
        syncScheduleQrVisibility();
      }

      function setRangeAndRender(nextStartDate, nextEndDate, nextPeriodValue, nextPersonId) {
        let startDate = nextStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = nextEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        appliedStartDate = startDate;
        appliedEndDate = endDate;
        appliedPeriodValue = nextPeriodValue || '';
        setDateInputValue(startInput, startDate);
        setDateInputValue(endInput, endDate);
        syncPeriodSelectOptions(nextPeriodValue);
        appliedPersonId = nextPersonId || getDefaultAppliedPersonId(startDate, endDate);
        syncPersonSelectOptions(appliedPersonId);
        writeStoredRange(startDate, endDate, periodSelect.value || nextPeriodValue || '');
        notifyRangeChange(startDate, endDate, periodSelect.value || nextPeriodValue || '');
        render();
      }

      function handleDateInputChange() {
        syncPeriodSelectOptions('');
        syncPersonSelectOptions(personSelect.value || appliedPersonId);
      }

      function handlePeriodDraftChange() {
        if (periodSelect.value) {
          const [startDate, endDate] = periodSelect.value.split('|');
          setDateInputValue(startInput, startDate || DATA.defaultStartDate || DATA.availableStartDate);
          setDateInputValue(endInput, endDate || DATA.defaultEndDate || DATA.availableEndDate);
        }
        syncPersonSelectOptions(personSelect.value || appliedPersonId);
      }

      function applyFilters() {
        const draftRange = getDraftRange();
        const selectedPersonId = syncPersonSelectOptions(personSelect.value || appliedPersonId)
          || getDefaultAppliedPersonId(draftRange.startDate, draftRange.endDate);
        setRangeAndRender(draftRange.startDate, draftRange.endDate, draftRange.periodValue, selectedPersonId);
      }

      const preferredRange = getPreferredRange();
      refreshInteractionLockState();
      startInput.addEventListener('input', handleDateInputChange);
      endInput.addEventListener('input', handleDateInputChange);
      startInput.addEventListener('change', handleDateInputChange);
      endInput.addEventListener('change', handleDateInputChange);
      startInput.addEventListener('blur', handleDateInputChange);
      endInput.addEventListener('blur', handleDateInputChange);
      periodSelect.addEventListener('input', handlePeriodDraftChange);
      periodSelect.addEventListener('change', handlePeriodDraftChange);
      personSearchInput.addEventListener('input', () => {
        syncPersonSelectOptions();
      });
      personSearchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyFilters();
      });
      personSelect.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyFilters();
      });
      applyButton.addEventListener('click', applyFilters);
      document.addEventListener('pointerdown', (event) => {
        if (!(event instanceof PointerEvent) || event.button !== 0) return;
        acquireInteractionLock();
      }, true);
      pagesElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleTarget = target.closest('[data-role="toggle-student-unavailable"], [data-role="student-slot-cell"], [data-role="toggle-student-unavailable-date"], [data-role="toggle-student-unavailable-slot"], [data-role="toggle-teacher-unavailable"], [data-role="teacher-slot-cell"], [data-role="toggle-teacher-unavailable-date"], [data-role="toggle-teacher-unavailable-slot"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (!handleUnavailablePointerDown(toggleTarget)) return;
        suppressNextToggleClick = true;
        window.setTimeout(() => {
          suppressNextToggleClick = false;
        }, 0);
        event.preventDefault();
      });
      pagesElement.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        // Handle submission reset badge click
        const resetBadge = target.closest('[data-role="submission-reset-badge"]');
        if (resetBadge && resetBadge instanceof HTMLElement) {
          var personType = resetBadge.getAttribute('data-person-type');
          var personId = resetBadge.getAttribute('data-person-id');
          if (personType && personId && window.opener) {
            if (!window.confirm('提出データを解除して再提出可能にします。よろしいですか？')) return;
            window.opener.postMessage({
              type: 'schedule-submission-reset',
              personType: personType,
              personId: personId,
            }, '*');
          }
          return;
        }
        const toggleTarget = target.closest('[data-role="open-student-count-modal"], [data-role="close-student-count-modal"], [data-role="submit-student-count-modal"], [data-role="unsubmit-student-count-modal"], [data-role="student-count-modal-backdrop"], [data-role="open-teacher-register-modal"], [data-role="close-teacher-register-modal"], [data-role="submit-teacher-register-modal"], [data-role="unsubmit-teacher-register-modal"], [data-role="teacher-register-modal-backdrop"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (toggleTarget.getAttribute('data-role') === 'student-count-modal-backdrop' && toggleTarget !== target) return;
        if (toggleTarget.getAttribute('data-role') === 'teacher-register-modal-backdrop' && toggleTarget !== target) return;
        if ((toggleTarget.getAttribute('data-role') || '').includes('teacher')) {
          handleTeacherUnavailableClick(toggleTarget);
          return;
        }
        handleStudentUnavailableClick(toggleTarget);
      });
      pagesElement.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.getAttribute('data-role') !== 'student-count-regular-only') return;
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (element instanceof HTMLInputElement) element.disabled = Boolean(target.checked);
        });
      });
      window.addEventListener('beforeunload', () => {
        releaseInteractionLock();
        notifyRangeChange(appliedStartDate, appliedEndDate, appliedPeriodValue);
      });
      window.addEventListener('focus', acquireInteractionLock);
      window.addEventListener('blur', releaseInteractionLock);
      window.addEventListener('storage', (event) => {
        if (event.key === interactionLockStorageKey) refreshInteractionLockState();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          releaseInteractionLock();
          return;
        }
        if (document.hasFocus()) acquireInteractionLock();
      });
      window.addEventListener('resize', updateSheetScreenSize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateSheetScreenSize);
        window.visualViewport.addEventListener('scroll', updateSheetScreenSize);
      }
      window.setInterval(() => {
        const currentLock = readInteractionLock();
        if (document.hidden || !document.hasFocus()) {
          if (currentLock && currentLock.token === interactionLockToken) releaseInteractionLock();
          return;
        }
        if (currentLock && currentLock.token === interactionLockToken) {
          acquireInteractionLock();
        } else {
          refreshInteractionLockState();
        }
      }, 1000);
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'schedule-force-release-interaction') {
          interactionLockSuspendUntil = Date.now() + 1500;
          releaseInteractionLock();
          return;
        }
        if (!message || message.type !== 'schedule-data-update' || message.viewType !== VIEW_TYPE || !message.payload) return;
        applyIncomingPayload(message.payload);
      });
      window.__scheduleReadStoredLogo = bindLogoControls();
      setRangeAndRender(
        preferredRange.startDate,
        preferredRange.endDate,
        preferredRange.periodValue,
        getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
      );
      if (!document.hidden && document.hasFocus()) acquireInteractionLock();
      window.setTimeout(() => {
        notifyPopupReady();
      }, 0);
    </script>
  </body>
</html>`
}

function openScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher', targetWindow?: Window | null) {
  const popupWindow = createPopupWindow(payload.titleLabel + '-' + viewType, targetWindow)
  if (!popupWindow) {
    alert(`${viewType === 'student' ? '生徒' : '講師'}日程を開けませんでした。ポップアップを許可してください。`)
    return null
  }

  const html = createScheduleHtml(payload, viewType)
  const writeScheduleDocument = () => {
    popupWindow.document.open()
    popupWindow.document.write(html)
    popupWindow.document.close()
  }

  writeScheduleDocument()
  window.setTimeout(() => {
    try {
      if (!popupWindow.document.getElementById('schedule-pages') || !popupWindow.document.querySelector('.sheet')) {
        writeScheduleDocument()
      }
    } catch {
      writeScheduleDocument()
    }
  }, 0)
  popupWindow.focus()
  return popupWindow
}

function postSchedulePayload(targetWindow: Window | null | undefined, viewType: 'student' | 'teacher', payload: SchedulePayload) {
  if (!targetWindow || targetWindow.closed) return
  targetWindow.postMessage({ type: 'schedule-data-update', viewType, payload }, '*')
}

export function openStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  return openScheduleHtml(buildStudentPayload(params), 'student', params.targetWindow)
}

export function openTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  return openScheduleHtml(buildTeacherPayload(params), 'teacher', params.targetWindow)
}

export function syncStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  if (!params.targetWindow || params.targetWindow.closed) return
  postSchedulePayload(params.targetWindow, 'student', buildStudentPayload(params))
}

export function syncTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  if (!params.targetWindow || params.targetWindow.closed) return
  postSchedulePayload(params.targetWindow, 'teacher', buildTeacherPayload(params))
}

export function formatWeeklyScheduleTitle(startDate: string, endDate: string) {
  if (!startDate || !endDate) return '週間予定表'
  const startParts = startDate.split('-')
  const endParts = endDate.split('-')
  return `週間予定表${Number(startParts[1])}月${Number(startParts[2])}日-${Number(endParts[1])}月${Number(endParts[2])}日`
}