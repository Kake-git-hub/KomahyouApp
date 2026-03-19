import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { capRegularLessonDatesPerMonth, hasManagedRegularLessonPeriod, isRegularLessonParticipantActiveOnDate, resolveOperationalSchoolYear, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { BoardGrid } from './BoardGrid'
import { BoardToolbar } from './BoardToolbar'
import { buildLectureStockEntries } from './lectureStock'
import { buildMakeupStockEntries, buildMakeupStockKey, type MakeupStockEntry, type ManualMakeupOrigin } from './makeupStock'
import { defaultWeekIndex, getWeekStart, lessonTypeLabels, shiftDate, teacherTypeLabels } from './mockData'
import type { DeskCell, DeskLesson, GradeLabel, LessonType, SlotCell, StudentEntry, SubjectLabel, TeacherType } from './types'
import type { ClassroomSettings } from '../../App'
import type { PersistedBoardState } from '../../types/appState'
import { exportBoardPdf } from '../../utils/pdf'
import { createLegacyLessonScheduleQrConfig } from '../../utils/scheduleQrConfig'
import { formatWeeklyScheduleTitle, openStudentScheduleHtml, openTeacherScheduleHtml, syncStudentScheduleHtml, syncTeacherScheduleHtml } from '../../utils/scheduleHtml'

const boardDayLabels = ['月', '火', '水', '木', '金', '土', '日'] as const
const calendarDayLabels = ['日', '月', '火', '水', '木', '金', '土'] as const
const boardSlotTimes = [
  '13:00-14:30',
  '14:40-16:10',
  '16:20-17:50',
  '18:00-19:30',
  '19:40-21:10',
] as const

type MakeupOriginMap = Record<string, ManualMakeupOrigin[]>
type LectureStockCountMap = Record<string, number>

type HistoryEntry = {
  weeks: SlotCell[][]
  weekIndex: number
  selectedCellId: string
  selectedDeskIndex: number
  holidayDates: string[]
  forceOpenDates: string[]
  manualMakeupAdjustments: MakeupOriginMap
  fallbackMakeupStudents: Record<string, { studentName: string; displayName: string; subject: string }>
  manualLectureStockCounts: LectureStockCountMap
  fallbackLectureStockStudents: Record<string, { displayName: string }>
}

type StudentMenuState = {
  cellId: string
  deskIndex: number
  studentIndex: number
  x: number
  y: number
  mode: 'root' | 'edit' | 'memo'
}

type TeacherMenuState = {
  cellId: string
  deskIndex: number
  x: number
  y: number
  selectedTeacherName: string
}

type EditStudentDraft = {
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
}

type FallbackMakeupStudent = {
  studentName: string
  displayName: string
  subject: string
}

type GroupedMakeupStockEntry = {
  key: string
  stockStudentKey: string
  studentId: string | null
  displayName: string
  balance: number
  nextPlacementEntry: MakeupStockEntry | null
  title?: string
}

type GroupedLectureStockEntry = {
  key: string
  displayName: string
  requestedCount: number
  title?: string
}

const editableSubjects: SubjectLabel[] = ['英', '数', '算', '国', '理', '社', 'IT']
const editableLessonTypes: LessonType[] = ['regular', 'makeup', 'special']
const editableTeacherTypes: TeacherType[] = ['normal', 'substitute', 'outside']

function resolveSchoolGradeLabel(birthDate: string, today = new Date()): GradeLabel {
  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)

  const schoolYear = resolveOperationalSchoolYear(today)
  const enrollmentYear = birthMonth < 4 || (birthMonth === 4 && birthDay === 1) ? birthYear + 6 : birthYear + 7
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

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function formatWeekScheduleTitle(cells: Array<{ dateKey: string }>) {
  const first = cells[0]?.dateKey ?? ''
  const last = cells[cells.length - 1]?.dateKey ?? ''
  return formatWeeklyScheduleTitle(first, last)
}

function cloneWeeks(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) =>
    week.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk) => ({
        ...desk,
        memoSlots: desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : undefined,
        lesson: desk.lesson
          ? {
              ...desk.lesson,
              studentSlots: desk.lesson.studentSlots.map((student) => (student ? { ...student } : null)) as [StudentEntry | null, StudentEntry | null],
            }
          : undefined,
      })),
    })),
  )
}

type ScheduleBoardScreenProps = {
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  specialSessions: SpecialSessionRow[]
  initialBoardState?: PersistedBoardState | null
  onBoardStateChange?: (state: PersistedBoardState) => void
  onUpdateSpecialSessions: Dispatch<SetStateAction<SpecialSessionRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenBackupRestore: () => void
}

export type ScheduleRangePreference = {
  startDate: string
  endDate: string
  periodValue: string
}

type SchedulePopupRuntimeWindow = Window & typeof globalThis & {
  __lessonScheduleStudentWindow?: Window | null
  __lessonScheduleTeacherWindow?: Window | null
  __lessonScheduleBoardWeeks?: SlotCell[][]
}

function getSchedulePopupRuntimeWindow() {
  return window as SchedulePopupRuntimeWindow
}

function hasOpenSchedulePopup(viewType: 'student' | 'teacher') {
  if (typeof window === 'undefined') return false
  const runtimeWindow = getSchedulePopupRuntimeWindow()
  const targetWindow = viewType === 'student' ? runtimeWindow.__lessonScheduleStudentWindow : runtimeWindow.__lessonScheduleTeacherWindow
  return Boolean(targetWindow && !targetWindow.closed)
}

export function readStoredScheduleRange(viewType: 'student' | 'teacher', fallbackStartDate: string, fallbackEndDate: string): ScheduleRangePreference {
  try {
    return {
      startDate: window.localStorage.getItem(`schedule-shared:${viewType}:range:start`) || fallbackStartDate,
      endDate: window.localStorage.getItem(`schedule-shared:${viewType}:range:end`) || fallbackEndDate,
      periodValue: window.localStorage.getItem(`schedule-shared:${viewType}:range:period`) || '',
    }
  } catch {
    return { startDate: fallbackStartDate, endDate: fallbackEndDate, periodValue: '' }
  }
}

function writeStoredScheduleRange(viewType: 'student' | 'teacher', range: ScheduleRangePreference) {
  try {
    window.localStorage.setItem(`schedule-shared:${viewType}:range:start`, range.startDate)
    window.localStorage.setItem(`schedule-shared:${viewType}:range:end`, range.endDate)
    window.localStorage.setItem(`schedule-shared:${viewType}:range:period`, range.periodValue)
  } catch {
    // Ignore storage failures so the popup remains usable.
  }
}

function createPlaceholderTeacherName() {
  return ''
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

function startOfMonth(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, 1)
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
  const cursor = new Date(year, monthIndex, 1)
  const dates: string[] = []

  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === dayOfWeek) {
      dates.push(toDateKey(cursor))
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

function createEmptyBoardCells(startDateKey: string, endDateKey: string, deskCount: number): SlotCell[] {
  const startDate = parseDateKey(startDateKey)
  const endDate = parseDateKey(endDateKey)
  if (startDate > endDate) return []

  const cells: SlotCell[] = []

  for (let cursor = new Date(startDate); cursor <= endDate; cursor = shiftDate(cursor, 1)) {
    const date = new Date(cursor)
    const dateKey = toDateKey(date)
    const dateLabel = formatDateLabel(dateKey)
    const dayLabel = calendarDayLabels[date.getDay()]

    const dayCells = Array.from({ length: boardSlotTimes.length }, (_, slotIndex) => {
      const slotNumber = slotIndex + 1
      const cellId = `${dateKey}_${slotNumber}`

      const desks: DeskCell[] = Array.from({ length: deskCount }, (_, deskIndex) => ({
        id: `${cellId}_desk_${deskIndex + 1}`,
        teacher: createPlaceholderTeacherName(),
      }))

      return {
        id: cellId,
        dateKey,
        dayLabel,
        dateLabel,
        slotLabel: `${slotNumber}限`,
        slotNumber,
        timeLabel: boardSlotTimes[slotIndex],
        isOpenDay: true,
        desks,
      }
    })

    cells.push(...dayCells)
  }

  return cells
}

function normalizeWeeksDeskCount(weeks: SlotCell[][], deskCount: number): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => {
    const nextDesks = Array.from({ length: deskCount }, (_, deskIndex) => {
      const existingDesk = cell.desks[deskIndex]
      if (existingDesk) return existingDesk
      return {
        id: `${cell.id}_desk_${deskIndex + 1}`,
        teacher: createPlaceholderTeacherName(),
      }
    })

    return {
      ...cell,
      desks: nextDesks,
    }
  }))
}

function applyClassroomAvailability(weeks: SlotCell[][], classroomSettings: ClassroomSettings) {
  return normalizeWeeksDeskCount(weeks, classroomSettings.deskCount).map((week) => week.map((cell) => ({
    ...cell,
    isOpenDay: classroomSettings.forceOpenDates.includes(cell.dateKey)
      || (!classroomSettings.closedWeekdays.includes(parseDateKey(cell.dateKey).getDay()) && !classroomSettings.holidayDates.includes(cell.dateKey)),
  })))
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function cloneOriginMap(originMap: MakeupOriginMap): MakeupOriginMap {
  return Object.fromEntries(Object.entries(originMap).map(([key, values]) => [key, values.map((value) => ({ ...value }))]))
}

function appendMakeupOrigin(originMap: MakeupOriginMap, key: string, originDate: string) {
  const nextDates = originMap[key] ?? []
  return {
    ...originMap,
    [key]: [...nextDates, { dateKey: originDate }].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
  }
}

function appendLectureStockCount(countMap: LectureStockCountMap, key: string, increment = 1) {
  return {
    ...countMap,
    [key]: (countMap[key] ?? 0) + increment,
  }
}

function createInitialBoardWeeks(
  classroomSettings: ClassroomSettings,
  teachers: TeacherRow[],
  students: StudentRow[],
  regularLessons: RegularLessonRow[],
) {
  const currentWeekStart = getWeekStart(new Date())
  const previousWeekStart = shiftDate(currentWeekStart, -7)
  const nextWeekStart = shiftDate(currentWeekStart, 7)
  return normalizeWeeksDeskCount([
    createBoardWeek(previousWeekStart, 'prev', { classroomSettings, teachers, students, regularLessons }),
    createBoardWeek(currentWeekStart, 'current', { classroomSettings, teachers, students, regularLessons }),
    createBoardWeek(nextWeekStart, 'next', { classroomSettings, teachers, students, regularLessons }),
  ], classroomSettings.deskCount)
}

function createInitialBoardSnapshot(params: {
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  initialBoardState?: PersistedBoardState | null
}) {
  const fallbackWeeks = createInitialBoardWeeks(
    params.classroomSettings,
    params.teachers,
    params.students,
    params.regularLessons,
  )
  const weeks = params.initialBoardState?.weeks?.length
    ? normalizeWeeksDeskCount(
      params.initialBoardState.weeks.map((week) => {
        const firstDateKey = week[0]?.dateKey ?? getReferenceDateKey(new Date())
        const weekStart = getWeekStart(parseDateKey(firstDateKey))
        const managedWeek = createBoardWeek(weekStart, firstDateKey, {
          classroomSettings: params.classroomSettings,
          teachers: params.teachers,
          students: params.students,
          regularLessons: params.regularLessons,
        })
        return mergeManagedWeek(week, managedWeek)
      }),
      params.classroomSettings.deskCount,
    )
    : fallbackWeeks
  const maxWeekIndex = Math.max(0, weeks.length - 1)
  const weekIndex = Math.min(Math.max(params.initialBoardState?.weekIndex ?? defaultWeekIndex, 0), maxWeekIndex)
  const validCellIds = new Set(weeks.flat().map((cell) => cell.id))
  const defaultCellId = weeks[weekIndex]?.[0]?.id ?? weeks[0]?.[0]?.id ?? ''

  return {
    weeks,
    weekIndex,
    selectedCellId:
      params.initialBoardState?.selectedCellId && validCellIds.has(params.initialBoardState.selectedCellId)
        ? params.initialBoardState.selectedCellId
        : defaultCellId,
    selectedDeskIndex: Math.min(
      Math.max(params.initialBoardState?.selectedDeskIndex ?? 0, 0),
      Math.max(0, params.classroomSettings.deskCount - 1),
    ),
    manualMakeupAdjustments: cloneOriginMap(params.initialBoardState?.manualMakeupAdjustments ?? {}),
    fallbackMakeupStudents: { ...(params.initialBoardState?.fallbackMakeupStudents ?? {}) },
    manualLectureStockCounts: { ...(params.initialBoardState?.manualLectureStockCounts ?? {}) },
    fallbackLectureStockStudents: { ...(params.initialBoardState?.fallbackLectureStockStudents ?? {}) },
    isLectureStockOpen: params.initialBoardState?.isLectureStockOpen ?? false,
    isMakeupStockOpen: params.initialBoardState?.isMakeupStockOpen ?? false,
    studentScheduleRange: params.initialBoardState?.studentScheduleRange ?? null,
    teacherScheduleRange: params.initialBoardState?.teacherScheduleRange ?? null,
  }
}

function resolveOriginalRegularDate(student: StudentEntry, fallbackDateKey: string) {
  return student.makeupSourceDate ?? fallbackDateKey
}

function parseOriginSlotNumber(makeupSourceLabel?: string) {
  const matched = String(makeupSourceLabel ?? '').match(/(\d+)限/)
  return matched ? Number(matched[1]) : null
}

function isReturnedToOriginalSlot(student: StudentEntry, targetDateKey: string, targetSlotNumber: number) {
  const originSlotNumber = parseOriginSlotNumber(student.makeupSourceLabel)
  return Boolean(
    student.makeupSourceDate
    && originSlotNumber
    && student.makeupSourceDate === targetDateKey
    && originSlotNumber === targetSlotNumber,
  )
}

function normalizeLessonPlacement(student: StudentEntry, targetDateKey: string, targetSlotNumber: number): StudentEntry {
  if (student.lessonType !== 'makeup' || !isReturnedToOriginalSlot(student, targetDateKey, targetSlotNumber)) return student
  return {
    ...student,
    lessonType: 'regular',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
  }
}

function formatStockOriginLabel(dateKey: string, slotNumber: number) {
  const date = parseDateKey(dateKey)
  return `${date.getMonth() + 1}/${date.getDate()}(${calendarDayLabels[date.getDay()]}) ${slotNumber}限`
}

function buildMakeupStockTitle(entry: MakeupStockEntry) {
  const parts: string[] = []
  if (entry.remainingOriginLabels.length > 0) {
    parts.push(`元の通常授業: ${entry.remainingOriginLabels.map((label, index) => `${label}（${entry.remainingOriginReasonLabels[index] ?? '振替発生'}）`).join(', ')}`)
  }
  if (entry.balance < 0 && entry.negativeReason) {
    parts.push(entry.negativeReason)
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

function getStockStudentKeyFromEntryKey(entryKey: string) {
  return entryKey.split('__')[0] ?? entryKey
}

function resolveStockComparableStudentKey(student: StudentEntry, managedStudentByAnyName: Map<string, StudentRow>, resolveBoardStudentDisplayName: (name: string) => string) {
  const managedId = managedStudentByAnyName.get(student.name)?.id
  return managedId ?? `name:${resolveBoardStudentDisplayName(student.name)}`
}

function resolveDeskLabel(desk: DeskCell, deskIndex: number) {
  return desk.teacher.trim() || `${deskIndex + 1}机目`
}

function parseDeskOrder(deskId: string) {
  const matched = deskId.match(/_desk_(\d+)$/)
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER
}

function hasRegularPlacementConflict(cell: SlotCell, teacherId: string, studentIds: string[], teacherById: Map<string, TeacherRow>) {
  return cell.desks.some((desk) => {
    const teacher = teacherById.get(teacherId)
    const teacherConflict = Boolean(teacherId)
      && Boolean(teacher)
      && (getTeacherDisplayName(teacher as TeacherRow) === desk.teacher || teacher?.name === desk.teacher)
      && Boolean(desk.lesson)

    const studentConflict = desk.lesson?.studentSlots.some((student) => {
      if (!student) return false
      return studentIds.some((studentId) => student.id.startsWith(`${studentId}_`))
    }) ?? false

    return teacherConflict || studentConflict
  })
}

function createManagedStudentEntry(student: StudentRow, subject: SubjectLabel, dateKey: string): StudentEntry {
  return {
    id: `${student.id}_${dateKey}_${subject}`,
    name: getStudentDisplayName(student),
    managedStudentId: student.id,
    grade: student.birthDate ? resolveSchoolGradeLabel(student.birthDate, parseDateKey(dateKey)) : '中1',
    birthDate: student.birthDate || undefined,
    subject,
    lessonType: 'regular',
    teacherType: 'normal',
  }
}

function buildManagedRegularLessonsRange(params: {
  startDate: string
  endDate: string
  deskCount: number
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
}) {
  const { startDate, endDate, deskCount, classroomSettings, teachers, students, regularLessons } = params
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]))
  const studentById = new Map(students.map((student) => [student.id, student]))
  const nextRange = applyClassroomAvailability([createEmptyBoardCells(startDate, endDate, deskCount)], classroomSettings)[0] ?? []
  const cellByDateSlot = new Map(nextRange.map((cell) => [`${cell.dateKey}_${cell.slotNumber}`, cell]))
  const monthDatesInScope = iterateMonthsInRange(startDate, endDate)

  for (const row of regularLessons) {
    const teacher = teacherById.get(row.teacherId)
    const applyMonthlyCap = hasManagedRegularLessonPeriod(row)
    const candidateDateKeys = monthDatesInScope.flatMap(({ year, monthIndex }) => getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)).filter((dateKey) => {
      const date = parseDateKey(dateKey)
      if (row.schoolYear !== resolveOperationalSchoolYear(date)) return false
      if (classroomSettings.forceOpenDates.includes(dateKey)) return true
      if (classroomSettings.holidayDates.includes(dateKey)) return false
      if (classroomSettings.closedWeekdays.includes(date.getDay())) return false
      return !teacher || resolveTeacherRosterStatus(teacher, dateKey) === '在籍'
    })
    if (candidateDateKeys.length === 0) continue

    const student1 = studentById.get(row.student1Id)
    const student2 = studentById.get(row.student2Id)
    const limitDateKeys = (dateKeys: string[]) => (applyMonthlyCap ? capRegularLessonDatesPerMonth(dateKeys) : dateKeys)
    const student1DateKeys = student1
      ? new Set(limitDateKeys(candidateDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, 1, dateKey)
        && isActiveOnDate(student1.entryDate, student1.withdrawDate, student1.isHidden, dateKey)
      ))))
      : new Set<string>()
    const student2DateKeys = student2 && row.subject2
      ? new Set(limitDateKeys(candidateDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, 2, dateKey)
        && isActiveOnDate(student2.entryDate, student2.withdrawDate, student2.isHidden, dateKey)
      ))))
      : new Set<string>()

    const scheduledDateKeys = Array.from(new Set([...student1DateKeys, ...student2DateKeys])).sort((left, right) => left.localeCompare(right))

    for (const dateKey of scheduledDateKeys) {
      const cell = cellByDateSlot.get(`${dateKey}_${row.slotNumber}`)
      if (!cell) continue

      const firstStudent = student1 && student1DateKeys.has(dateKey)
        ? createManagedStudentEntry(student1, row.subject1 as SubjectLabel, dateKey)
        : null
      const secondStudent = student2 && row.subject2 && student2DateKeys.has(dateKey)
        ? createManagedStudentEntry(student2, row.subject2 as SubjectLabel, dateKey)
        : null

      if (!firstStudent && !secondStudent) continue

      const participantIds = [
        firstStudent ? row.student1Id : '',
        secondStudent ? row.student2Id : '',
      ].filter(Boolean)
      if (hasRegularPlacementConflict(cell, row.teacherId, participantIds, teacherById)) continue

      const targetDesk = cell.desks.find((desk) => !desk.lesson)
      if (!targetDesk) continue

      targetDesk.teacher = teacher ? getTeacherDisplayName(teacher) : '講師未割当'
      targetDesk.lesson = {
        id: `managed_${row.id}_${dateKey}`,
        note: '管理データ反映',
        studentSlots: firstStudent ? [firstStudent, secondStudent] : [secondStudent, null],
      }
    }
  }

  return nextRange
}

function createBoardWeek(weekStart: Date, _weekId: string, params: { classroomSettings: ClassroomSettings; teachers: TeacherRow[]; students: StudentRow[]; regularLessons: RegularLessonRow[] }) {
  return buildManagedRegularLessonsRange({
    startDate: toDateKey(weekStart),
    endDate: toDateKey(shiftDate(weekStart, boardDayLabels.length - 1)),
    deskCount: params.classroomSettings.deskCount,
    classroomSettings: params.classroomSettings,
    teachers: params.teachers,
    students: params.students,
    regularLessons: params.regularLessons,
  })
}

function isManagedLesson(lesson?: DeskLesson) {
  return Boolean(lesson && (lesson.note === '管理データ反映' || lesson.id.startsWith('managed_')))
}

function cloneDeskLesson(lesson: DeskLesson): DeskLesson {
  return {
    ...lesson,
    studentSlots: lesson.studentSlots.map((student) => (student ? { ...student } : null)) as [StudentEntry | null, StudentEntry | null],
  }
}

function cloneSlotCell(cell: SlotCell): SlotCell {
  return {
    ...cell,
    desks: cell.desks.map((desk) => ({
      ...desk,
      lesson: desk.lesson ? cloneDeskLesson(desk.lesson) : undefined,
    })),
  }
}

function mergeManagedDeskLesson(currentLesson: DeskLesson, managedLesson: DeskLesson) {
  const nextLesson = cloneDeskLesson(managedLesson)

  currentLesson.studentSlots.forEach((student, slotIndex) => {
    if (!student) return

    const managedStudent = managedLesson.studentSlots[slotIndex]
    if (managedStudent?.id === student.id) return

    const alreadyPresent = nextLesson.studentSlots.some((entry) => entry?.id === student.id)
    if (alreadyPresent) return

    if (!nextLesson.studentSlots[slotIndex]) {
      nextLesson.studentSlots[slotIndex] = { ...student }
      return
    }

    const emptySlotIndex = nextLesson.studentSlots.findIndex((entry) => !entry)
    if (emptySlotIndex >= 0) {
      nextLesson.studentSlots[emptySlotIndex] = { ...student }
    }
  })

  return nextLesson
}

function buildManagedOccurrenceKey(student: StudentEntry, dateKey: string, slotNumber: number) {
  return `${student.managedStudentId ?? student.name}__${student.subject}__${dateKey}__${slotNumber}`
}

function buildSuppressedManagedOccurrenceKeys(boardWeeks: SlotCell[][]) {
  const suppressedKeys = new Set<string>()

  boardWeeks.forEach((week) => {
    week.forEach((cell) => {
      cell.desks.forEach((desk) => {
        desk.lesson?.studentSlots.forEach((student) => {
          if (!student || student.lessonType !== 'makeup' || !student.makeupSourceDate) return
          const originSlotNumber = parseOriginSlotNumber(student.makeupSourceLabel)
          if (!originSlotNumber) return
          if (student.makeupSourceDate === cell.dateKey && originSlotNumber === cell.slotNumber) return
          suppressedKeys.add(buildManagedOccurrenceKey(student, student.makeupSourceDate, originSlotNumber))
        })
      })
    })
  })

  return suppressedKeys
}

function suppressManagedStudentsInCell(managedCell: SlotCell, suppressedKeys: Set<string>) {
  if (suppressedKeys.size === 0) return cloneSlotCell(managedCell)

  const nextCell = cloneSlotCell(managedCell)
  nextCell.desks = nextCell.desks.map((desk) => {
    if (!desk.lesson || !isManagedLesson(desk.lesson)) return desk

    const nextStudentSlots = desk.lesson.studentSlots.map((student) => {
      if (!student) return null
      return suppressedKeys.has(buildManagedOccurrenceKey(student, nextCell.dateKey, nextCell.slotNumber)) ? null : student
    }) as [StudentEntry | null, StudentEntry | null]

    if (!nextStudentSlots[0] && !nextStudentSlots[1]) {
      return {
        ...desk,
        teacher: '',
        lesson: undefined,
      }
    }

    return {
      ...desk,
      lesson: {
        ...desk.lesson,
        studentSlots: nextStudentSlots,
      },
    }
  })

  return nextCell
}

function overlayBoardWeeksOnScheduleCells(scheduleCells: SlotCell[], boardWeeks: SlotCell[][]) {
  const suppressedManagedKeys = buildSuppressedManagedOccurrenceKeys(boardWeeks)
  const boardCellsById = new Map(boardWeeks.flat().map((cell) => [cell.id, cell]))
  return scheduleCells.map((managedCell) => {
    const adjustedManagedCell = suppressManagedStudentsInCell(managedCell, suppressedManagedKeys)
    const boardCell = boardCellsById.get(managedCell.id)
    if (!boardCell) return adjustedManagedCell
    return mergeManagedWeek([boardCell], [adjustedManagedCell])[0] ?? adjustedManagedCell
  })
}

export function normalizeScheduleRange(range: ScheduleRangePreference, fallbackStartDate: string, fallbackEndDate: string): ScheduleRangePreference {
  const startDate = range.startDate || fallbackStartDate
  const endDate = range.endDate || fallbackEndDate

  if (startDate <= endDate) {
    return {
      startDate,
      endDate,
      periodValue: range.periodValue || '',
    }
  }

  return {
    startDate: endDate,
    endDate: startDate,
    periodValue: range.periodValue || '',
  }
}

export function buildScheduleCellsForRange(params: {
  range: ScheduleRangePreference
  fallbackStartDate: string
  fallbackEndDate: string
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  boardWeeks: SlotCell[][]
}) {
  const normalizedRange = normalizeScheduleRange(params.range, params.fallbackStartDate, params.fallbackEndDate)
  const managedCells = buildManagedRegularLessonsRange({
    startDate: normalizedRange.startDate,
    endDate: normalizedRange.endDate,
    deskCount: params.classroomSettings.deskCount,
    classroomSettings: params.classroomSettings,
    teachers: params.teachers,
    students: params.students,
    regularLessons: params.regularLessons,
  })

  return overlayBoardWeeksOnScheduleCells(managedCells, params.boardWeeks)
}

function mergeManagedWeek(currentWeek: SlotCell[], managedWeek: SlotCell[]) {
  const managedCellById = new Map(managedWeek.map((cell) => [cell.id, cell]))

  return currentWeek.map((cell) => {
    const managedCell = managedCellById.get(cell.id)
    if (!managedCell) return cell

    const managedDesksByLessonId = new Map(
      managedCell.desks
        .filter((desk) => desk.lesson && isManagedLesson(desk.lesson))
        .map((desk) => [desk.lesson!.id, desk]),
    )
    const preservedLessonIds = new Set<string>()

    const nextDesks = cell.desks.map((desk) => {
      const lesson = desk.lesson
      if (!lesson || !isManagedLesson(lesson)) {
        return {
          ...desk,
          lesson: lesson ? cloneDeskLesson(lesson) : undefined,
        }
      }

      const managedDesk = managedDesksByLessonId.get(lesson.id)
      if (managedDesk?.lesson) {
        preservedLessonIds.add(lesson.id)
        return {
          ...desk,
          teacher: desk.manualTeacher ? desk.teacher : managedDesk.teacher,
          lesson: mergeManagedDeskLesson(lesson, managedDesk.lesson),
        }
      }

      return {
        ...desk,
        teacher: desk.manualTeacher ? desk.teacher : '',
        lesson: undefined,
      }
    })

    for (const managedDesk of managedCell.desks) {
      if (!managedDesk.lesson) continue
      if (preservedLessonIds.has(managedDesk.lesson.id)) continue

      const targetDesk = nextDesks.find((desk) => !desk.lesson && !desk.manualTeacher && !desk.teacher)
        ?? nextDesks.find((desk) => !desk.lesson && !desk.manualTeacher)

      if (!targetDesk) continue

      targetDesk.teacher = managedDesk.teacher
      targetDesk.lesson = cloneDeskLesson(managedDesk.lesson)
    }

    return {
      ...cell,
      desks: nextDesks,
    }
  })
}

export function ScheduleBoardScreen({ classroomSettings, teachers, students, regularLessons, specialSessions, initialBoardState, onBoardStateChange, onUpdateSpecialSessions, onUpdateClassroomSettings, onOpenBasicData, onOpenSpecialData, onOpenBackupRestore }: ScheduleBoardScreenProps) {
  void onUpdateSpecialSessions
  const boardExportRef = useRef<HTMLDivElement | null>(null)
  const scheduleQrConfig = createLegacyLessonScheduleQrConfig()
  const studentScheduleWindowRef = useRef<Window | null>(null)
  const teacherScheduleWindowRef = useRef<Window | null>(null)
  const initialBoardSnapshotRef = useRef<ReturnType<typeof createInitialBoardSnapshot> | null>(null)
  if (!initialBoardSnapshotRef.current) {
    initialBoardSnapshotRef.current = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons, initialBoardState })
  }
  const initialBoardSnapshot = initialBoardSnapshotRef.current
  const [weeks, setWeeks] = useState<SlotCell[][]>(() => initialBoardSnapshot.weeks)
  const normalizedWeeks = useMemo(() => applyClassroomAvailability(weeks, classroomSettings), [classroomSettings, weeks])
  const [weekIndex, setWeekIndex] = useState(initialBoardSnapshot.weekIndex)
  const cells = normalizedWeeks[weekIndex] ?? []
  const [selectedCellId, setSelectedCellId] = useState(initialBoardSnapshot.selectedCellId)
  const [selectedDeskIndex, setSelectedDeskIndex] = useState(initialBoardSnapshot.selectedDeskIndex)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [selectedMakeupStockKey, setSelectedMakeupStockKey] = useState<string | null>(null)
  const [selectedHolidayDate, setSelectedHolidayDate] = useState<string | null>(null)
  const [studentMenu, setStudentMenu] = useState<StudentMenuState | null>(null)
  const [memoDraft, setMemoDraft] = useState('')
  const [editStudentDraft, setEditStudentDraft] = useState<EditStudentDraft | null>(null)
  const [statusMessage, setStatusMessage] = useState('左クリックで生徒を選ぶか、空欄の生徒マスを左クリックしてメモを保存できます。')
  const [manualMakeupAdjustments, setManualMakeupAdjustments] = useState<MakeupOriginMap>(initialBoardSnapshot.manualMakeupAdjustments)
  const [fallbackMakeupStudents, setFallbackMakeupStudents] = useState<Record<string, FallbackMakeupStudent>>(initialBoardSnapshot.fallbackMakeupStudents)
  const [manualLectureStockCounts, setManualLectureStockCounts] = useState<LectureStockCountMap>(initialBoardSnapshot.manualLectureStockCounts)
  const [fallbackLectureStockStudents, setFallbackLectureStockStudents] = useState<Record<string, { displayName: string }>>(initialBoardSnapshot.fallbackLectureStockStudents)
  const [isLectureStockOpen, setIsLectureStockOpen] = useState(initialBoardSnapshot.isLectureStockOpen)
  const [isMakeupStockOpen, setIsMakeupStockOpen] = useState(initialBoardSnapshot.isMakeupStockOpen)
  const [isPrintingPdf, setIsPrintingPdf] = useState(false)
  const [isStudentScheduleOpen, setIsStudentScheduleOpen] = useState(() => hasOpenSchedulePopup('student'))
  const [isTeacherScheduleOpen, setIsTeacherScheduleOpen] = useState(() => hasOpenSchedulePopup('teacher'))
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.studentScheduleRange)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.teacherScheduleRange)
  const [teacherMenu, setTeacherMenu] = useState<TeacherMenuState | null>(null)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [pointerPreviewPosition, setPointerPreviewPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!onBoardStateChange) return
    onBoardStateChange({
      weeks: cloneWeeks(weeks),
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      manualMakeupAdjustments: cloneOriginMap(manualMakeupAdjustments),
      fallbackMakeupStudents: { ...fallbackMakeupStudents },
      manualLectureStockCounts: { ...manualLectureStockCounts },
      fallbackLectureStockStudents: { ...fallbackLectureStockStudents },
      isLectureStockOpen,
      isMakeupStockOpen,
      studentScheduleRange,
      teacherScheduleRange,
    })
  }, [
    fallbackLectureStockStudents,
    fallbackMakeupStudents,
    isLectureStockOpen,
    isMakeupStockOpen,
    manualLectureStockCounts,
    manualMakeupAdjustments,
    onBoardStateChange,
    selectedCellId,
    selectedDeskIndex,
    studentScheduleRange,
    teacherScheduleRange,
    weekIndex,
    weeks,
  ])

  useEffect(() => {
    setWeeks((currentWeeks) => normalizeWeeksDeskCount(currentWeeks.map((week) => {
      const firstDateKey = week[0]?.dateKey ?? getReferenceDateKey(new Date())
      const weekStart = getWeekStart(parseDateKey(firstDateKey))
      const managedWeek = createBoardWeek(weekStart, firstDateKey, { classroomSettings, teachers, students, regularLessons })
      return mergeManagedWeek(week, managedWeek)
    }), classroomSettings.deskCount))
  }, [classroomSettings, teachers, students, regularLessons])

  useEffect(() => {
    if (typeof window === 'undefined') return
    getSchedulePopupRuntimeWindow().__lessonScheduleBoardWeeks = normalizedWeeks
  }, [normalizedWeeks])

  useEffect(() => {
    if (!isStudentScheduleOpen) return

    const timerId = window.setInterval(() => {
      if (!studentScheduleWindowRef.current || studentScheduleWindowRef.current.closed) {
        studentScheduleWindowRef.current = null
        getSchedulePopupRuntimeWindow().__lessonScheduleStudentWindow = null
        setIsStudentScheduleOpen(false)
      }
    }, 800)

    return () => window.clearInterval(timerId)
  }, [isStudentScheduleOpen])

  useEffect(() => {
    if (!isTeacherScheduleOpen) return

    const timerId = window.setInterval(() => {
      if (!teacherScheduleWindowRef.current || teacherScheduleWindowRef.current.closed) {
        teacherScheduleWindowRef.current = null
        getSchedulePopupRuntimeWindow().__lessonScheduleTeacherWindow = null
        setIsTeacherScheduleOpen(false)
      }
    }, 800)

    return () => window.clearInterval(timerId)
  }, [isTeacherScheduleOpen])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {
      const message = event.data
      if (!message || message.type !== 'schedule-range-update') return
      if (message.viewType !== 'student' && message.viewType !== 'teacher') return
      if (typeof message.startDate !== 'string' || typeof message.endDate !== 'string') return
      writeStoredScheduleRange(message.viewType, {
        startDate: message.startDate,
        endDate: message.endDate,
        periodValue: typeof message.periodValue === 'string' ? message.periodValue : '',
      })

      const nextRange = {
        startDate: message.startDate,
        endDate: message.endDate,
        periodValue: typeof message.periodValue === 'string' ? message.periodValue : '',
      }

      if (message.viewType === 'student') setStudentScheduleRange(nextRange)
      else setTeacherScheduleRange(nextRange)
    }

    window.addEventListener('message', handleScheduleRangeMessage)
    return () => window.removeEventListener('message', handleScheduleRangeMessage)
  }, [])

  const displayWeekDate = cells[0]?.dateKey ?? getReferenceDateKey(new Date())

  const managedStudentNameMap = useMemo(() => {
    const entries = students.flatMap((student) => {
      const displayName = getStudentDisplayName(student)
      return [[student.name, displayName], [displayName, displayName]] as Array<[string, string]>
    })
    return new Map(entries)
  }, [students])

  const managedStudentByAnyName = useMemo(() => {
    const entries = students.flatMap((student) => {
      const displayName = getStudentDisplayName(student)
      return [[student.name, student], [displayName, student]] as Array<[string, StudentRow]>
    })
    return new Map(entries)
  }, [students])

  const resolveBoardStudentDisplayName = (name: string) => managedStudentNameMap.get(name) ?? name
  const resolveBoardStudentGradeLabel = (name: string, fallbackGrade: string, dateKey: string, birthDate?: string) => {
    if (birthDate) return resolveSchoolGradeLabel(birthDate, parseDateKey(dateKey))
    const managedStudent = managedStudentByAnyName.get(name)
    if (!managedStudent?.birthDate) return fallbackGrade
    return resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(dateKey))
  }
  const resolveDisplayedLessonType = (name: string, subject: string, lessonType: LessonType | null, dateKey: string, slotNumber: number) => {
    if (lessonType !== 'regular') return lessonType

    const managedStudent = managedStudentByAnyName.get(name)
    if (!managedStudent) return 'regular'

    const lessonDate = parseDateKey(dateKey)
    const schoolYear = resolveOperationalSchoolYear(lessonDate)
    const dayOfWeek = lessonDate.getDay()

    const matchesStudent1 = regularLessons.some((row) => (
      row.schoolYear === schoolYear
      && row.student1Id === managedStudent.id
      && row.subject1 === subject
      && row.dayOfWeek === dayOfWeek
      && row.slotNumber === slotNumber
      && isRegularLessonParticipantActiveOnDate(row, 1, dateKey)
    ))

    if (matchesStudent1) return 'regular'

    const matchesStudent2 = regularLessons.some((row) => (
      row.schoolYear === schoolYear
      && row.student2Id === managedStudent.id
      && row.subject2 === subject
      && row.dayOfWeek === dayOfWeek
      && row.slotNumber === slotNumber
      && isRegularLessonParticipantActiveOnDate(row, 2, dateKey)
    ))

    return matchesStudent2 ? 'regular' : 'regular'
  }
  const shouldCountHolidayAsManualAdjustment = (student: StudentEntry, dateKey: string, slotNumber: number) => {
    if (student.manualAdded) return false
    if (student.lessonType !== 'regular') return true

    const managedStudent = managedStudentByAnyName.get(student.name)
    if (!managedStudent) return true

    const lessonDate = parseDateKey(dateKey)
    const schoolYear = resolveOperationalSchoolYear(lessonDate)
    const dayOfWeek = lessonDate.getDay()

    const matchesManagedRegularLesson = regularLessons.some((row) => (
      row.schoolYear === schoolYear
      && row.dayOfWeek === dayOfWeek
      && row.slotNumber === slotNumber
      && (((row.student1Id === managedStudent.id && row.subject1 === student.subject) && isRegularLessonParticipantActiveOnDate(row, 1, dateKey))
        || ((row.student2Id === managedStudent.id && row.subject2 === student.subject) && isRegularLessonParticipantActiveOnDate(row, 2, dateKey)))
    ))

    return !matchesManagedRegularLesson
  }
  const resolveBoardStudentStockId = (student: StudentEntry) => {
    const managedId = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
    return student.manualAdded ? `manual:${managedId}` : managedId
  }

  const rawMakeupStockEntries = useMemo(() => buildMakeupStockEntries({
    students,
    teachers,
    regularLessons,
    classroomSettings,
    weeks: normalizedWeeks,
    manualAdjustments: manualMakeupAdjustments,
    fallbackStudents: fallbackMakeupStudents,
    resolveStudentKey: resolveBoardStudentStockId,
  }), [classroomSettings, fallbackMakeupStudents, manualMakeupAdjustments, normalizedWeeks, regularLessons, students, teachers])

  const rawLectureStockEntries = useMemo(() => buildLectureStockEntries({
    specialSessions,
    students,
  }), [specialSessions, students])

  const makeupStockEntries = useMemo<GroupedMakeupStockEntry[]>(() => {
    const grouped = new Map<string, MakeupStockEntry[]>()

    for (const entry of rawMakeupStockEntries) {
      const stockStudentKey = getStockStudentKeyFromEntryKey(entry.key)
      const current = grouped.get(stockStudentKey) ?? []
      current.push(entry)
      grouped.set(stockStudentKey, current)
    }

    return Array.from(grouped.entries())
      .map(([stockStudentKey, entries]) => {
        const sortedEntries = [...entries].sort((left, right) => {
          const leftSelectable = left.balance > 0 ? 0 : 1
          const rightSelectable = right.balance > 0 ? 0 : 1
          if (leftSelectable !== rightSelectable) return leftSelectable - rightSelectable

          const leftDate = left.nextOriginDate ?? '9999-12-31'
          const rightDate = right.nextOriginDate ?? '9999-12-31'
          const dateCompare = leftDate.localeCompare(rightDate)
          if (dateCompare !== 0) return dateCompare

          return left.subject.localeCompare(right.subject, 'ja')
        })
        const nextPlacementEntry = sortedEntries.find((entry) => entry.balance > 0) ?? null
        const balance = entries.reduce((total, entry) => total + entry.balance, 0)
        const title = entries.map((entry) => buildMakeupStockTitle(entry)).filter((value): value is string => Boolean(value)).join('\n---\n') || undefined

        return {
          key: `${stockStudentKey}__-`,
          stockStudentKey,
          studentId: nextPlacementEntry?.studentId ?? entries.find((entry) => entry.studentId)?.studentId ?? null,
          displayName: nextPlacementEntry?.displayName ?? entries[0]?.displayName ?? stockStudentKey,
          balance,
          nextPlacementEntry,
          title,
        }
      })
      .filter((entry) => entry.balance !== 0)
      .sort((left, right) => {
        if (left.balance !== right.balance) return right.balance - left.balance
        return left.displayName.localeCompare(right.displayName, 'ja')
      })
  }, [rawMakeupStockEntries])

  const lectureStockEntries = useMemo<GroupedLectureStockEntry[]>(() => {
    const grouped = new Map<string, { displayName: string; requestedCount: number; titleLines: string[] }>()

    for (const entry of rawLectureStockEntries) {
      const current = grouped.get(entry.studentId) ?? { displayName: entry.displayName, requestedCount: 0, titleLines: [] }
      current.displayName = entry.displayName
      current.requestedCount += entry.requestedCount
      current.titleLines.push(`${entry.sessionLabel} / ${entry.subject}: ${entry.requestedCount}コマ`)
      grouped.set(entry.studentId, current)
    }

    for (const [studentKey, requestedCount] of Object.entries(manualLectureStockCounts)) {
      if (requestedCount <= 0) continue
      const fallbackDisplayName = fallbackLectureStockStudents[studentKey]?.displayName ?? studentKey.replace(/^name:/, '')
      const current = grouped.get(studentKey) ?? { displayName: fallbackDisplayName, requestedCount: 0, titleLines: [] }
      current.displayName = current.displayName || fallbackDisplayName
      current.requestedCount += requestedCount
      current.titleLines.push(`盤面からストック: ${requestedCount}コマ`)
      grouped.set(studentKey, current)
    }

    return Array.from(grouped.entries())
      .map(([studentKey, entry]) => ({
        key: `${studentKey}__-`,
        displayName: entry.displayName,
        requestedCount: entry.requestedCount,
        title: entry.titleLines.join('\n'),
      }))
      .filter((entry) => entry.requestedCount > 0)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ja'))
  }, [fallbackLectureStockStudents, manualLectureStockCounts, rawLectureStockEntries])

  const selectedMakeupStockEntry = useMemo(
    () => makeupStockEntries.find((entry) => entry.key === selectedMakeupStockKey) ?? null,
    [makeupStockEntries, selectedMakeupStockKey],
  )

  const highlightedCell = useMemo(() => {
    if (!studentMenu || studentMenu.mode !== 'memo') return null
    return {
      cellId: studentMenu.cellId,
      deskIndex: studentMenu.deskIndex,
      studentIndex: studentMenu.studentIndex,
    }
  }, [studentMenu])

  const weekDates = useMemo(
    () => Array.from(new Map(cells.map((cell) => [cell.dateKey, cell])).values()),
    [cells],
  )

  const weekLabel = useMemo(() => {
    const first = weekDates[0]
    const last = weekDates[weekDates.length - 1]
    if (!first || !last) return '週表示なし'

    return `${first.dateLabel} - ${last.dateLabel}`
  }, [weekDates])

  const weekScheduleTitle = useMemo(() => formatWeekScheduleTitle(weekDates), [weekDates])
  const scheduleFallbackStartDate = weekDates[0]?.dateKey ?? displayWeekDate
  const scheduleFallbackEndDate = weekDates[weekDates.length - 1]?.dateKey ?? displayWeekDate

  const effectiveStudentScheduleRange = useMemo(
    () => normalizeScheduleRange(studentScheduleRange ?? { startDate: scheduleFallbackStartDate, endDate: scheduleFallbackEndDate, periodValue: '' }, scheduleFallbackStartDate, scheduleFallbackEndDate),
    [scheduleFallbackEndDate, scheduleFallbackStartDate, studentScheduleRange],
  )

  const effectiveTeacherScheduleRange = useMemo(
    () => normalizeScheduleRange(teacherScheduleRange ?? { startDate: scheduleFallbackStartDate, endDate: scheduleFallbackEndDate, periodValue: '' }, scheduleFallbackStartDate, scheduleFallbackEndDate),
    [scheduleFallbackEndDate, scheduleFallbackStartDate, teacherScheduleRange],
  )

  const studentScheduleCells = useMemo(() => buildScheduleCellsForRange({
    range: effectiveStudentScheduleRange,
    fallbackStartDate: scheduleFallbackStartDate,
    fallbackEndDate: scheduleFallbackEndDate,
    classroomSettings,
    teachers,
    students,
    regularLessons,
    boardWeeks: normalizedWeeks,
  }), [classroomSettings, effectiveStudentScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, teachers])

  const teacherScheduleCells = useMemo(() => buildScheduleCellsForRange({
    range: effectiveTeacherScheduleRange,
    fallbackStartDate: scheduleFallbackStartDate,
    fallbackEndDate: scheduleFallbackEndDate,
    classroomSettings,
    teachers,
    students,
    regularLessons,
    boardWeeks: normalizedWeeks,
  }), [classroomSettings, effectiveTeacherScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, teachers])

  const studentScheduleTitle = useMemo(
    () => formatWeeklyScheduleTitle(effectiveStudentScheduleRange.startDate, effectiveStudentScheduleRange.endDate),
    [effectiveStudentScheduleRange.endDate, effectiveStudentScheduleRange.startDate],
  )

  const teacherScheduleTitle = useMemo(
    () => formatWeeklyScheduleTitle(effectiveTeacherScheduleRange.startDate, effectiveTeacherScheduleRange.endDate),
    [effectiveTeacherScheduleRange.endDate, effectiveTeacherScheduleRange.startDate],
  )

  const yearLabel = useMemo(() => {
    const years = Array.from(new Set(weekDates.map((cell) => cell.dateKey.slice(0, 4))))
    return years.join('/')
  }, [weekDates])

  const visibleSpecialSessions = useMemo(
    () => specialSessions
      .filter((session) => weekDates.some((day) => day.dateKey >= session.startDate && day.dateKey <= session.endDate))
      .sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [specialSessions, weekDates],
  )

  useEffect(() => {
    syncStudentScheduleHtml({
      cells: studentScheduleCells,
      students,
      defaultStartDate: effectiveStudentScheduleRange.startDate,
      defaultEndDate: effectiveStudentScheduleRange.endDate,
      defaultPeriodValue: effectiveStudentScheduleRange.periodValue,
      titleLabel: studentScheduleTitle,
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: studentScheduleWindowRef.current,
    })
  }, [classroomSettings, effectiveStudentScheduleRange.endDate, effectiveStudentScheduleRange.periodValue, effectiveStudentScheduleRange.startDate, scheduleQrConfig, specialSessions, studentScheduleCells, studentScheduleTitle, students])

  useEffect(() => {
    syncTeacherScheduleHtml({
      cells: teacherScheduleCells,
      teachers,
      defaultStartDate: effectiveTeacherScheduleRange.startDate,
      defaultEndDate: effectiveTeacherScheduleRange.endDate,
      defaultPeriodValue: effectiveTeacherScheduleRange.periodValue,
      titleLabel: teacherScheduleTitle,
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: teacherScheduleWindowRef.current,
    })
  }, [classroomSettings, effectiveTeacherScheduleRange.endDate, effectiveTeacherScheduleRange.periodValue, effectiveTeacherScheduleRange.startDate, scheduleQrConfig, specialSessions, teacherScheduleCells, teacherScheduleTitle, teachers])

  const menuStudent = useMemo(() => {
    if (!studentMenu) return null
    const targetCell = cells.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    const targetStudent = targetLesson?.studentSlots[studentMenu.studentIndex] ?? null

    if (!targetCell || !targetDesk || !targetStudent) return null

    return {
      cell: targetCell,
      desk: targetDesk,
      student: targetStudent,
    }
  }, [cells, studentMenu])

  const movingStudentContext = useMemo(() => {
    if (!selectedStudentId) return null

    for (const week of normalizedWeeks) {
      for (const cell of week) {
        for (const desk of cell.desks) {
          const studentIndex = desk.lesson?.studentSlots.findIndex((student) => student?.id === selectedStudentId) ?? -1
          if (studentIndex < 0) continue

          const student = desk.lesson?.studentSlots[studentIndex] ?? null
          if (!student) continue

          return {
            cell,
            desk,
            student,
          }
        }
      }
    }

    return null
  }, [normalizedWeeks, selectedStudentId])

  const pointerPreviewLabel = useMemo(() => {
    if (selectedMakeupStockEntry?.nextPlacementEntry) {
      const entry = selectedMakeupStockEntry.nextPlacementEntry
      const originLabel = entry.nextOriginLabel ?? '元コマ未設定'
      return `${selectedMakeupStockEntry.displayName} / ${entry.subject} / ${originLabel} の振替先を選択中`
    }

    if (movingStudentContext) {
      return `${resolveBoardStudentDisplayName(movingStudentContext.student.name)} / ${movingStudentContext.student.subject} / ${movingStudentContext.cell.dateLabel} ${movingStudentContext.cell.slotLabel} を移動中`
    }

    return null
  }, [movingStudentContext, resolveBoardStudentDisplayName, selectedMakeupStockEntry])

  useEffect(() => {
    if (!pointerPreviewLabel || typeof window === 'undefined') return

    let frameId: number | null = null
    const handlePointerMove = (event: MouseEvent) => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setPointerPreviewPosition({ x: event.clientX, y: event.clientY })
        frameId = null
      })
    }

    window.addEventListener('mousemove', handlePointerMove)
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', handlePointerMove)
    }
  }, [pointerPreviewLabel])

  const pointerPreviewStyle = useMemo(() => {
    if (typeof window === 'undefined') return { left: 16, top: 16 }

    return {
      left: Math.max(12, Math.min(pointerPreviewPosition.x + 18, window.innerWidth - 320)),
      top: Math.max(12, Math.min(pointerPreviewPosition.y + 18, window.innerHeight - 80)),
    }
  }, [pointerPreviewPosition])

  const menuPosition = useMemo(() => {
    if (!studentMenu || typeof window === 'undefined') {
      return { left: 24, top: 108 }
    }

    if (studentMenu.mode === 'edit') {
      return {
        left: Math.max(12, Math.min(studentMenu.x + 10, window.innerWidth - 336)),
        top: 16,
      }
    }

    return {
      left: Math.max(12, Math.min(studentMenu.x + 10, window.innerWidth - 336)),
      top: Math.max(24, Math.min(studentMenu.y + 10, window.innerHeight - 340)),
    }
  }, [studentMenu])

  const teacherMenuContext = useMemo(() => {
    if (!teacherMenu) return null
    const targetCell = cells.find((cell) => cell.id === teacherMenu.cellId)
    const targetDesk = targetCell?.desks[teacherMenu.deskIndex]
    if (!targetCell || !targetDesk) return null
    return { cell: targetCell, desk: targetDesk }
  }, [cells, teacherMenu])

  const teacherMenuPosition = useMemo(() => {
    if (!teacherMenu || typeof window === 'undefined') {
      return { left: 24, top: 108 }
    }

    return {
      left: Math.max(12, Math.min(teacherMenu.x + 10, window.innerWidth - 336)),
      top: Math.max(24, Math.min(teacherMenu.y + 10, window.innerHeight - 260)),
    }
  }, [teacherMenu])

  const teacherOptions = useMemo(() => {
    if (!teacherMenuContext) return []
    const currentTeacher = teachers.find((teacher) => getTeacherDisplayName(teacher) === teacherMenuContext.desk.teacher || teacher.name === teacherMenuContext.desk.teacher)
    const visibleTeachers = teachers.filter((teacher) => resolveTeacherRosterStatus(teacher, teacherMenuContext.cell.dateKey) === '在籍')
    const mergedTeachers = currentTeacher && !visibleTeachers.some((teacher) => teacher.id === currentTeacher.id)
      ? [...visibleTeachers, currentTeacher]
      : visibleTeachers

    return mergedTeachers
      .slice()
      .sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja'))
      .map((teacher) => ({ id: teacher.id, name: getTeacherDisplayName(teacher) }))
  }, [teacherMenuContext, teachers])

  const centeredStatusMessage = statusMessage.includes('同コマにすでに') && statusMessage.includes('不可です。') ? statusMessage : null

  const findDuplicateStudentInCell = (targetCell: SlotCell, studentKey: string, excludedStudentId?: string) => {
    for (const desk of targetCell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (!student || student.id === excludedStudentId) continue
        const existingKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
        if (existingKey === studentKey) {
          return student
        }
      }
    }
    return null
  }

  const cloneLesson = (lesson: DeskLesson, student: StudentEntry): DeskLesson => ({
    id: `${lesson.id}_split_${student.id}`,
    warning: lesson.warning,
    note: lesson.note,
    studentSlots: [student, null],
  })

  const createStudentId = (cellId: string, deskIndex: number, studentIndex: number) => {
    const stamp = Date.now().toString(36)
    return `${cellId}_${deskIndex}_${studentIndex}_${stamp}`
  }

  const createHistoryEntry = (
    sourceWeeks: SlotCell[][],
    sourceWeekIndex: number,
    sourceCellId: string,
    sourceDeskIndex: number,
    sourceHolidayDates: string[],
    sourceForceOpenDates: string[],
    sourceManualMakeupAdjustments: MakeupOriginMap,
    sourceFallbackMakeupStudents: Record<string, FallbackMakeupStudent>,
    sourceManualLectureStockCounts: LectureStockCountMap,
    sourceFallbackLectureStockStudents: Record<string, { displayName: string }>,
  ): HistoryEntry => ({
    weeks: cloneWeeks(sourceWeeks),
    weekIndex: sourceWeekIndex,
    selectedCellId: sourceCellId,
    selectedDeskIndex: sourceDeskIndex,
    holidayDates: [...sourceHolidayDates],
    forceOpenDates: [...sourceForceOpenDates],
    manualMakeupAdjustments: cloneOriginMap(sourceManualMakeupAdjustments),
    fallbackMakeupStudents: { ...sourceFallbackMakeupStudents },
    manualLectureStockCounts: { ...sourceManualLectureStockCounts },
    fallbackLectureStockStudents: { ...sourceFallbackLectureStockStudents },
  })

  const commitWeeks = (
    nextWeeks: SlotCell[][],
    nextWeekIndex: number,
    nextCellId: string,
    nextDeskIndex: number,
    nextHolidayDates: string[] = classroomSettings.holidayDates,
    nextForceOpenDates: string[] = classroomSettings.forceOpenDates,
    nextManualMakeupAdjustments: MakeupOriginMap = manualMakeupAdjustments,
    nextFallbackMakeupStudents: Record<string, FallbackMakeupStudent> = fallbackMakeupStudents,
    nextManualLectureStockCounts: LectureStockCountMap = manualLectureStockCounts,
    nextFallbackLectureStockStudents: Record<string, { displayName: string }> = fallbackLectureStockStudents,
  ) => {
    setUndoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, fallbackMakeupStudents, manualLectureStockCounts, fallbackLectureStockStudents),
    ])
    setRedoStack([])
    if (!areStringArraysEqual(nextHolidayDates, classroomSettings.holidayDates) || !areStringArraysEqual(nextForceOpenDates, classroomSettings.forceOpenDates)) {
      onUpdateClassroomSettings({
        ...classroomSettings,
        holidayDates: [...nextHolidayDates],
        forceOpenDates: [...nextForceOpenDates],
      })
    }
    setWeeks(nextWeeks)
    setWeekIndex(nextWeekIndex)
    setSelectedCellId(nextCellId)
    setSelectedDeskIndex(nextDeskIndex)
    setManualMakeupAdjustments(cloneOriginMap(nextManualMakeupAdjustments))
    setFallbackMakeupStudents(nextFallbackMakeupStudents)
    setManualLectureStockCounts({ ...nextManualLectureStockCounts })
    setFallbackLectureStockStudents({ ...nextFallbackLectureStockStudents })
    setSelectedMakeupStockKey(null)
    setStudentMenu(null)
    setTeacherMenu(null)
    setEditStudentDraft(null)
  }

  const handleSelectDesk = (cellId: string, deskIndex: number, x: number, y: number) => {
    setSelectedCellId(cellId)
    setSelectedDeskIndex(deskIndex)
    setStudentMenu(null)
    const targetCell = cells.find((cell) => cell.id === cellId)
    const targetDesk = targetCell?.desks[deskIndex]
    if (!targetCell || !targetDesk) {
      setTeacherMenu(null)
      setStatusMessage(`選択を更新しました: ${cellId} / ${deskIndex + 1}机目`)
      return
    }
    if (!targetCell.isOpenDay) {
      setTeacherMenu(null)
      setStatusMessage('休校セルでは講師を設定できません。営業日の講師セルを選んでください。')
      return
    }

    const matchedTeacher = teachers.find((teacher) => getTeacherDisplayName(teacher) === targetDesk.teacher || teacher.name === targetDesk.teacher)

    setTeacherMenu({
      cellId,
      deskIndex,
      x,
      y,
      selectedTeacherName: matchedTeacher ? getTeacherDisplayName(matchedTeacher) : targetDesk.teacher,
    })
    setStatusMessage(`講師選択を開きました: ${targetCell.dateLabel} ${targetCell.slotLabel} / ${deskIndex + 1}机目`)
  }

  const handleConfirmTeacher = () => {
    if (!teacherMenu || !teacherMenuContext) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === teacherMenu.cellId)
    const targetDesk = targetCell?.desks[teacherMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    if (targetDesk.teacher === teacherMenu.selectedTeacherName) {
      setTeacherMenu(null)
      setStatusMessage('講師設定は変更されませんでした。')
      return
    }

    targetDesk.teacher = teacherMenu.selectedTeacherName
    targetDesk.manualTeacher = true
    commitWeeks(nextWeeks, weekIndex, teacherMenu.cellId, teacherMenu.deskIndex)
    setTeacherMenu(null)
    setStatusMessage(teacherMenu.selectedTeacherName
      ? `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, teacherMenu.deskIndex)} の講師を ${teacherMenu.selectedTeacherName} に設定しました。`
      : `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, teacherMenu.deskIndex)} の講師を未設定にしました。`)
  }

  const handleToggleHolidayDate = (dateKey: string) => {
    const isHoliday = classroomSettings.holidayDates.includes(dateKey)
    const isForceOpen = classroomSettings.forceOpenDates.includes(dateKey)
    const isClosedWeekday = classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay())
    const isSyncedHoliday = (classroomSettings.googleHolidayCalendarSyncedDates ?? []).includes(dateKey)

    if (isForceOpen) {
      commitWeeks(
        cloneWeeks(weeks),
        weekIndex,
        selectedCellId,
        selectedDeskIndex,
        classroomSettings.holidayDates,
        classroomSettings.forceOpenDates.filter((value) => value !== dateKey),
      )
      setSelectedHolidayDate(dateKey)
      setStudentMenu(null)
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStatusMessage(`${dateKey} を定休日に戻しました。休校表示に戻しました。`)
      return
    }

    if (isHoliday) {
      const nextForceOpenDates = isClosedWeekday || isSyncedHoliday
        ? [...classroomSettings.forceOpenDates.filter((value) => value !== dateKey), dateKey].sort()
        : classroomSettings.forceOpenDates.filter((value) => value !== dateKey)

      commitWeeks(
        cloneWeeks(weeks),
        weekIndex,
        selectedCellId,
        selectedDeskIndex,
        classroomSettings.holidayDates.filter((value) => value !== dateKey),
        nextForceOpenDates,
      )
      setSelectedHolidayDate(dateKey)
      setStudentMenu(null)
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStatusMessage(isClosedWeekday || isSyncedHoliday ? `${dateKey} の休校設定を解除しました。営業日に戻しました。` : `${dateKey} の休日設定を解除しました。通常営業に戻しました。`)
      return
    }

    if (isClosedWeekday) {
      commitWeeks(
        cloneWeeks(weeks),
        weekIndex,
        selectedCellId,
        selectedDeskIndex,
        classroomSettings.holidayDates,
        [...classroomSettings.forceOpenDates, dateKey].sort(),
      )
      setSelectedHolidayDate(dateKey)
      setStudentMenu(null)
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStatusMessage(`${dateKey} の定休日を解除しました。営業日にしました。`)
      return
    }

    const confirmed = window.confirm(`${dateKey} を休日に設定します。\nこの日に入っている授業はすべてストックへ移行します。\nよろしいですか。`)
    if (!confirmed) {
      setStatusMessage('休日設定をキャンセルしました。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    let nextManualMakeupAdjustments = cloneOriginMap(manualMakeupAdjustments)
    const nextFallbackMakeupStudents = { ...fallbackMakeupStudents }
    let nextManualLectureStockCounts = { ...manualLectureStockCounts }
    const nextFallbackLectureStockStudents = { ...fallbackLectureStockStudents }
    let movedStudentCount = 0

    for (const week of nextWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== dateKey) continue

        for (const desk of cell.desks) {
          for (const student of desk.lesson?.studentSlots ?? []) {
            if (!student) continue
            movedStudentCount += 1
            if (student.lessonType === 'special') {
              const lectureStockKey = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
              nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, lectureStockKey)
              if (!managedStudentByAnyName.get(student.name)) {
                nextFallbackLectureStockStudents[lectureStockKey] = {
                  displayName: resolveBoardStudentDisplayName(student.name),
                }
              }
              continue
            }
            if (!student.manualAdded) {
              const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(student), student.subject)
              if (shouldCountHolidayAsManualAdjustment(student, cell.dateKey, cell.slotNumber)) {
                nextManualMakeupAdjustments = appendMakeupOrigin(nextManualMakeupAdjustments, stockKey, resolveOriginalRegularDate(student, cell.dateKey))
              }

              const managedStudent = managedStudentByAnyName.get(student.name)
              if (!managedStudent) {
                nextFallbackMakeupStudents[stockKey] = {
                  studentName: student.name,
                  displayName: resolveBoardStudentDisplayName(student.name),
                  subject: student.subject,
                }
              }
            }
          }
          desk.lesson = undefined
        }
      }
    }

    commitWeeks(
      nextWeeks,
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      [...classroomSettings.holidayDates, dateKey].sort(),
      classroomSettings.forceOpenDates.filter((value) => value !== dateKey),
      nextManualMakeupAdjustments,
      nextFallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextFallbackLectureStockStudents,
    )
    setSelectedHolidayDate(dateKey)
    setSelectedStudentId(null)
    setStatusMessage(`${dateKey} を休日に設定しました。${movedStudentCount > 0 ? `${movedStudentCount}件の授業をストックへ移しました。` : '移行対象の授業はありませんでした。'}`)
  }

  const handlePlaceMakeupFromStock = (cellId: string, deskIndex: number, studentIndex: number) => {
    if (!selectedMakeupStockEntry) return
    const placementEntry = selectedMakeupStockEntry.nextPlacementEntry
    if (!placementEntry) {
      setStatusMessage('この生徒は配置できる振替残数がありません。')
      return
    }
    if (selectedMakeupStockEntry.balance <= 0) {
      setStatusMessage('この生徒は振替残数がありません。新しい通常残が発生するまで待ってください。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === cellId)
    const targetDesk = targetCell?.desks[deskIndex]
    if (!targetCell || !targetDesk) return

    if (targetDesk.lesson?.studentSlots[studentIndex]) {
      setStatusMessage('クリックした移動先は埋まっています。空欄の生徒マスを選んでください。')
      return
    }

    const comparableStudentKey = selectedMakeupStockEntry.studentId ?? `name:${selectedMakeupStockEntry.displayName}`
    const duplicateStudent = findDuplicateStudentInCell(targetCell, comparableStudentKey)
    if (duplicateStudent) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているため振替不可です。`)
      return
    }

    const managedStudent = placementEntry.studentId ? students.find((student) => student.id === placementEntry.studentId) : null
    const studentName = managedStudent ? getStudentDisplayName(managedStudent) : selectedMakeupStockEntry.displayName
    const studentGrade = managedStudent?.birthDate ? resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(targetCell.dateKey)) : '中1'
    const nextStudent: StudentEntry = normalizeLessonPlacement({
      id: createStudentId(cellId, deskIndex, studentIndex),
      name: studentName,
      managedStudentId: managedStudent?.id,
      grade: studentGrade,
      birthDate: managedStudent?.birthDate,
      makeupSourceDate: placementEntry.nextOriginDate ?? undefined,
      makeupSourceLabel: placementEntry.nextOriginLabel ?? undefined,
      subject: placementEntry.subject as SubjectLabel,
      lessonType: 'makeup',
      teacherType: 'normal',
    }, targetCell.dateKey, targetCell.slotNumber)

    if (!targetDesk.lesson) {
      targetDesk.lesson = {
        id: `${cellId}_desk_${deskIndex + 1}_${nextStudent.lessonType}`,
        note: nextStudent.lessonType === 'makeup' && placementEntry.nextOriginLabel
          ? `元の通常授業: ${placementEntry.nextOriginLabel}${placementEntry.nextOriginReasonLabel ? `（${placementEntry.nextOriginReasonLabel}）` : ''}`
          : undefined,
        studentSlots: [null, null],
      }
    }

    targetDesk.lesson.studentSlots[studentIndex] = nextStudent
    commitWeeks(nextWeeks, weekIndex, cellId, deskIndex)
    setIsMakeupStockOpen(true)
    setSelectedMakeupStockKey(selectedMakeupStockEntry.balance > 1 ? selectedMakeupStockEntry.key : null)
    setStatusMessage(`${selectedMakeupStockEntry.displayName} の振替を ${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} に追加しました。`)
  }

  const executeMoveStudent = (cellId: string, deskIndex: number, studentIndex: number) => {
    setSelectedCellId(cellId)
    setSelectedDeskIndex(deskIndex)
    setStudentMenu(null)

    if (!selectedStudentId) {
      setStatusMessage('移動する生徒はメニューの「移動」から選択してください。')
      return
    }

    const targetCellBeforeMove = cells.find((cell) => cell.id === cellId)
    const targetDeskBeforeMove = targetCellBeforeMove?.desks[deskIndex]
    const targetLessonBeforeMove = targetDeskBeforeMove?.lesson
    if (targetLessonBeforeMove?.studentSlots[studentIndex]) {
      setStatusMessage('クリックした移動先は埋まっています。空欄の生徒マスを選んでください。')
      return
    }

    let movedStudent: StudentEntry | null = null
    let sourceLessonSnapshot: DeskLesson | null = null
    let sourceCellId = ''
    let sourceDeskId = ''
    let sourceSlotIndex = -1
    let sourceDateKey = ''
    let sourceSlotNumber = 0

    const nextWeeks = cloneWeeks(weeks)
    const nextCells = nextWeeks[weekIndex]

    for (const week of nextWeeks) {
      for (const cell of week) {
        for (const desk of cell.desks) {
          if (!desk.lesson) continue
          const currentIndex = desk.lesson.studentSlots.findIndex((student) => student?.id === selectedStudentId)
          if (currentIndex < 0) continue

          movedStudent = desk.lesson.studentSlots[currentIndex]
          sourceLessonSnapshot = {
            ...desk.lesson,
            studentSlots: desk.lesson.studentSlots.map((student) => (student ? { ...student } : null)) as [StudentEntry | null, StudentEntry | null],
          }
          sourceCellId = cell.id
          sourceDeskId = desk.id
          sourceSlotIndex = currentIndex
          sourceDateKey = cell.dateKey
          sourceSlotNumber = cell.slotNumber
          desk.lesson.studentSlots[currentIndex] = null
          if (!desk.lesson.studentSlots[0] && !desk.lesson.studentSlots[1]) {
            desk.lesson = undefined
          }
        }
      }
    }

    if (!movedStudent || !sourceLessonSnapshot) {
      setSelectedStudentId(null)
      setStatusMessage('選択中の生徒が見つかりませんでした。')
      return
    }

    if (sourceCellId === cellId && sourceDeskId === targetDeskBeforeMove?.id && sourceSlotIndex === studentIndex) {
      setSelectedStudentId(null)
      setStatusMessage('同じ位置をクリックしたため、移動は行いませんでした。')
      return
    }

    const targetCell = nextCells.find((cell) => cell.id === cellId)
    const targetDesk = targetCell?.desks[deskIndex]
    if (!targetDesk) {
      setSelectedStudentId(null)
      setStatusMessage('移動先の机が見つかりませんでした。')
      return
    }

    if (movedStudent.lessonType !== 'special') {
      const originalDateKey = resolveOriginalRegularDate(movedStudent, sourceDateKey)
      const nextMovedStudent: StudentEntry = {
        ...movedStudent,
        lessonType: 'makeup',
        makeupSourceDate: originalDateKey,
        makeupSourceLabel: movedStudent.makeupSourceLabel ?? formatStockOriginLabel(originalDateKey, sourceSlotNumber),
      }
      movedStudent = movedStudent.lessonType === 'makeup'
        ? normalizeLessonPlacement(nextMovedStudent, cellId.split('_')[0] ?? sourceDateKey, Number(cellId.split('_')[1] ?? sourceSlotNumber))
        : nextMovedStudent
    }

    const comparableStudentKey = resolveStockComparableStudentKey(movedStudent, managedStudentByAnyName, resolveBoardStudentDisplayName)
    const duplicateStudent = targetCell ? findDuplicateStudentInCell(targetCell, comparableStudentKey, movedStudent.id) : null
    if (duplicateStudent) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているため移動不可です。`)
      return
    }

    const targetLesson = targetDesk.lesson
    if (targetLesson) {
      targetLesson.studentSlots[studentIndex] = movedStudent
    } else {
      targetDesk.lesson = cloneLesson(sourceLessonSnapshot, movedStudent)
      if (movedStudent.lessonType === 'regular') {
        targetDesk.lesson.note = undefined
      }
      if (studentIndex === 1) {
        targetDesk.lesson.studentSlots = [null, movedStudent]
      }
    }

    commitWeeks(nextWeeks, weekIndex, cellId, deskIndex)
    setSelectedStudentId(null)
    setStatusMessage(`${resolveBoardStudentDisplayName(movedStudent.name)} を ${targetCell?.dateLabel} ${targetCell?.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} へ移動しました。`)
  }

  const handleStudentClick = (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, hasMemo: boolean, x: number, y: number) => {
    setSelectedCellId(cellId)
    setSelectedDeskIndex(deskIndex)
    setTeacherMenu(null)
    const targetCell = cells.find((cell) => cell.id === cellId)
    const currentMemo = targetCell?.desks[deskIndex]?.memoSlots?.[studentIndex] ?? ''

    if (hasStudent) {
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'root' })
      setStatusMessage('生徒メニューを開きました。')
      return
    }

    if (hasMemo) {
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setMemoDraft(currentMemo)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'memo' })
      setStatusMessage('メモ編集メニューを開きました。')
      return
    }

    if (selectedMakeupStockEntry) {
      handlePlaceMakeupFromStock(cellId, deskIndex, studentIndex)
      return
    }

    if (!selectedStudentId) {
      if (targetCell && !targetCell.isOpenDay) {
        setStudentMenu(null)
        setStatusMessage('休校セルにはメモを保存できません。営業日の空欄セルを選んでください。')
        return
      }
      setSelectedStudentId(null)
      setMemoDraft(currentMemo)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'memo' })
      setStatusMessage('メモ入力メニューを開きました。')
      return
    }

    executeMoveStudent(cellId, deskIndex, studentIndex)
  }

  const handleStartMove = () => {
    if (!menuStudent) return
    setSelectedStudentId(menuStudent.student.id)
    setSelectedMakeupStockKey(null)
    setStudentMenu(null)
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を選択しました。移動先の空欄セルを左クリックしてください。`)
  }

  const handleCloseEdit = () => {
    if (!studentMenu) return
    setEditStudentDraft(null)
    setStudentMenu({ ...studentMenu, mode: 'root' })
  }

  const handleConfirmEdit = () => {
    if (!studentMenu || !menuStudent || !editStudentDraft) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetStudent = targetDesk?.lesson?.studentSlots[studentMenu.studentIndex]
    if (!targetStudent) return

    targetDesk.lesson!.studentSlots[studentMenu.studentIndex] = {
      ...targetStudent,
      subject: editStudentDraft.subject,
      lessonType: editStudentDraft.lessonType,
      teacherType: editStudentDraft.teacherType,
    }

    commitWeeks(nextWeeks, weekIndex, studentMenu.cellId, studentMenu.deskIndex)
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} の情報を更新しました。`)
  }

  const handleSaveMemo = () => {
    if (!studentMenu || studentMenu.mode !== 'memo') return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    if (targetDesk.lesson?.studentSlots[studentMenu.studentIndex]) {
      setStatusMessage('この生徒マスにはすでに生徒が入っています。')
      return
    }

    const normalizedMemo = memoDraft.replace(/\r\n/g, '\n').trim()
    const nextMemoSlots: [string | null, string | null] = targetDesk.memoSlots ? [...targetDesk.memoSlots] as [string | null, string | null] : [null, null]
    nextMemoSlots[studentMenu.studentIndex] = normalizedMemo || null
    targetDesk.memoSlots = nextMemoSlots.some((value) => value) ? nextMemoSlots : undefined

    commitWeeks(nextWeeks, weekIndex, studentMenu.cellId, studentMenu.deskIndex)
    setMemoDraft(normalizedMemo)
    setStatusMessage(normalizedMemo
      ? `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, studentMenu.deskIndex)} のメモを保存しました。`
      : `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, studentMenu.deskIndex)} のメモを削除しました。`)
  }

  const handlePrintPdf = async () => {
    if (!boardExportRef.current) {
      setStatusMessage('PDF出力対象が見つかりませんでした。')
      return
    }

    try {
      setIsPrintingPdf(true)
      await exportBoardPdf({
        element: boardExportRef.current,
        fileName: `${weekScheduleTitle}.pdf`,
        title: weekScheduleTitle,
      })
      setStatusMessage('コマ表を PDF 出力しました。')
    } catch (error) {
      setStatusMessage(`PDF出力に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsPrintingPdf(false)
    }
  }

  const handleOpenStudentSchedule = () => {
    if (studentScheduleWindowRef.current && !studentScheduleWindowRef.current.closed) {
      setStatusMessage('生徒日程は別タブで表示中です。')
      studentScheduleWindowRef.current.focus()
      return
    }

    const storedRange = normalizeScheduleRange(
      readStoredScheduleRange('student', scheduleFallbackStartDate, scheduleFallbackEndDate),
      scheduleFallbackStartDate,
      scheduleFallbackEndDate,
    )
    setStudentScheduleRange(storedRange)

    const nextWindow = openStudentScheduleHtml({
      cells: buildScheduleCellsForRange({
        range: storedRange,
        fallbackStartDate: scheduleFallbackStartDate,
        fallbackEndDate: scheduleFallbackEndDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: normalizedWeeks,
      }),
      students,
      defaultStartDate: storedRange.startDate,
      defaultEndDate: storedRange.endDate,
      defaultPeriodValue: storedRange.periodValue,
      titleLabel: formatWeeklyScheduleTitle(storedRange.startDate, storedRange.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: studentScheduleWindowRef.current,
    })
    if (!nextWindow) return
    studentScheduleWindowRef.current = nextWindow
    getSchedulePopupRuntimeWindow().__lessonScheduleStudentWindow = nextWindow
    setIsStudentScheduleOpen(true)
    setStatusMessage('生徒日程は別タブで表示中です。')
  }

  const handleOpenTeacherSchedule = () => {
    if (teacherScheduleWindowRef.current && !teacherScheduleWindowRef.current.closed) {
      setStatusMessage('講師日程は別タブで表示中です。')
      teacherScheduleWindowRef.current.focus()
      return
    }

    const storedRange = normalizeScheduleRange(
      readStoredScheduleRange('teacher', scheduleFallbackStartDate, scheduleFallbackEndDate),
      scheduleFallbackStartDate,
      scheduleFallbackEndDate,
    )
    setTeacherScheduleRange(storedRange)

    const nextWindow = openTeacherScheduleHtml({
      cells: buildScheduleCellsForRange({
        range: storedRange,
        fallbackStartDate: scheduleFallbackStartDate,
        fallbackEndDate: scheduleFallbackEndDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: normalizedWeeks,
      }),
      teachers,
      defaultStartDate: storedRange.startDate,
      defaultEndDate: storedRange.endDate,
      defaultPeriodValue: storedRange.periodValue,
      titleLabel: formatWeeklyScheduleTitle(storedRange.startDate, storedRange.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: teacherScheduleWindowRef.current,
    })
    if (!nextWindow) return
    teacherScheduleWindowRef.current = nextWindow
    getSchedulePopupRuntimeWindow().__lessonScheduleTeacherWindow = nextWindow
    setIsTeacherScheduleOpen(true)
    setStatusMessage('講師日程は別タブで表示中です。')
  }

  const handleStoreStudent = () => {
    if (!studentMenu || !menuStudent) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    if (!targetDesk || !targetLesson) return

    targetLesson.studentSlots[studentMenu.studentIndex] = null
    if (!targetLesson.studentSlots[0] && !targetLesson.studentSlots[1]) {
      targetDesk.lesson = undefined
    }

    if (menuStudent.student.lessonType === 'special') {
      const lectureStockKey = managedStudentByAnyName.get(menuStudent.student.name)?.id ?? `name:${resolveBoardStudentDisplayName(menuStudent.student.name)}`
      const nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, lectureStockKey)
      const nextFallbackLectureStockStudents = managedStudentByAnyName.get(menuStudent.student.name)
        ? fallbackLectureStockStudents
        : {
            ...fallbackLectureStockStudents,
            [lectureStockKey]: {
              displayName: resolveBoardStudentDisplayName(menuStudent.student.name),
            },
          }

      commitWeeks(
        nextWeeks,
        weekIndex,
        studentMenu.cellId,
        studentMenu.deskIndex,
        classroomSettings.holidayDates,
        classroomSettings.forceOpenDates,
        manualMakeupAdjustments,
        fallbackMakeupStudents,
        nextManualLectureStockCounts,
        nextFallbackLectureStockStudents,
      )
      setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を講習ストックへ回しました。`)
      if (selectedStudentId === menuStudent.student.id) {
        setSelectedStudentId(null)
      }
      return
    }

    const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(menuStudent.student), menuStudent.student.subject)
    const nextManualMakeupAdjustments = (menuStudent.student.lessonType === 'regular' || !menuStudent.student.makeupSourceDate)
      ? appendMakeupOrigin(manualMakeupAdjustments, stockKey, resolveOriginalRegularDate(menuStudent.student, targetCell.dateKey))
      : manualMakeupAdjustments
    const managedStudent = managedStudentByAnyName.get(menuStudent.student.name)
    const nextFallbackMakeupStudents = managedStudent
      ? fallbackMakeupStudents
      : {
          ...fallbackMakeupStudents,
          [stockKey]: {
            studentName: menuStudent.student.name,
            displayName: resolveBoardStudentDisplayName(menuStudent.student.name),
            subject: menuStudent.student.subject,
          },
        }

    commitWeeks(
      nextWeeks,
      weekIndex,
      studentMenu.cellId,
      studentMenu.deskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      nextManualMakeupAdjustments,
      nextFallbackMakeupStudents,
      manualLectureStockCounts,
      fallbackLectureStockStudents,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を振替ストックへ回しました。`)
    if (selectedStudentId === menuStudent.student.id) {
      setSelectedStudentId(null)
    }
  }

  const handleCancelSelection = () => {
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setIsMakeupStockOpen(false)
    setStudentMenu(null)
    setTeacherMenu(null)
    setStatusMessage('選択をキャンセルしました。')
  }

  const handleToggleMakeupStock = () => {
    setStudentMenu(null)
    setTeacherMenu(null)
    if (selectedMakeupStockKey) {
      setIsMakeupStockOpen(true)
      setStatusMessage('振替作業中です。終了する場合はキャンセルを押してください。')
      return
    }

    setIsMakeupStockOpen((current) => !current)
    if (!isMakeupStockOpen) {
      setSelectedStudentId(null)
      setStatusMessage('振替ストック一覧を開きました。生徒を選ぶと空欄セルへ配置できます。')
    }
  }

  const handleToggleLectureStock = () => {
    setStudentMenu(null)
    setTeacherMenu(null)
    setIsLectureStockOpen((current) => !current)
    if (!isLectureStockOpen) {
      setStatusMessage('講習ストック一覧を開きました。特別講習の生徒入力で保存した希望数を確認できます。')
    }
  }

  const handleSelectMakeupStockEntry = (entry: GroupedMakeupStockEntry) => {
    if (entry.balance <= 0) {
      setStatusMessage(`${entry.displayName} は先取り済みのため、残数が発生するまで選択できません。`)
      return
    }

    setSelectedStudentId(null)
    setSelectedMakeupStockKey(entry.key)
    setIsMakeupStockOpen(true)
    setStudentMenu(null)
    setTeacherMenu(null)
    setStatusMessage(`${entry.displayName} の振替ストックを選択しました。空欄セルを左クリックしてください。`)
  }

  const switchWeek = (nextWeekIndex: number) => {
    let nextWeeks = weeks
    let resolvedIndex = nextWeekIndex

    if (nextWeekIndex < 0) {
      const firstWeekStart = getWeekStart(parseDateKey(weeks[0]?.[0]?.dateKey ?? getReferenceDateKey(new Date())))
      const previousWeekStart = shiftDate(firstWeekStart, -7)
      nextWeeks = [createBoardWeek(previousWeekStart, previousWeekStart.toISOString().slice(0, 10), { classroomSettings, teachers, students, regularLessons }), ...weeks]
      setWeeks(nextWeeks)
      resolvedIndex = 0
    } else if (nextWeekIndex >= weeks.length) {
      const lastWeekStart = getWeekStart(parseDateKey(weeks[weeks.length - 1]?.[0]?.dateKey ?? getReferenceDateKey(new Date())))
      const nextWeekStart = shiftDate(lastWeekStart, 7)
      nextWeeks = [...weeks, createBoardWeek(nextWeekStart, nextWeekStart.toISOString().slice(0, 10), { classroomSettings, teachers, students, regularLessons })]
      setWeeks(nextWeeks)
      resolvedIndex = nextWeeks.length - 1
    }

    const nextWeek = nextWeeks[resolvedIndex]
    if (!nextWeek?.length) return

    setWeekIndex(resolvedIndex)
    setSelectedCellId(nextWeek[0].id)
    setSelectedDeskIndex(0)
    setStudentMenu(null)
    setStatusMessage(
      selectedStudentId || selectedMakeupStockKey
        ? `${nextWeek[0].dateLabel} 週へ移動しました。選択中の内容をこの週へ配置できます。`
        : `${nextWeek[0].dateLabel} 週を表示しています。`,
    )
  }

  const handleUndo = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return

    setRedoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, fallbackMakeupStudents, manualLectureStockCounts, fallbackLectureStockStudents),
    ])
    setUndoStack((current) => current.slice(0, -1))
    if (!areStringArraysEqual(previous.holidayDates, classroomSettings.holidayDates) || !areStringArraysEqual(previous.forceOpenDates, classroomSettings.forceOpenDates)) {
      onUpdateClassroomSettings({
        ...classroomSettings,
        holidayDates: [...previous.holidayDates],
        forceOpenDates: [...previous.forceOpenDates],
      })
    }
    setWeeks(previous.weeks)
    setWeekIndex(previous.weekIndex)
    setSelectedCellId(previous.selectedCellId)
    setSelectedDeskIndex(previous.selectedDeskIndex)
    setManualMakeupAdjustments(cloneOriginMap(previous.manualMakeupAdjustments))
    setFallbackMakeupStudents(previous.fallbackMakeupStudents)
    setManualLectureStockCounts({ ...previous.manualLectureStockCounts })
    setFallbackLectureStockStudents({ ...previous.fallbackLectureStockStudents })
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setStudentMenu(null)
    setEditStudentDraft(null)
    setStatusMessage('1つ前の状態に戻しました。')
  }

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return

    setUndoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, fallbackMakeupStudents, manualLectureStockCounts, fallbackLectureStockStudents),
    ])
    setRedoStack((current) => current.slice(0, -1))
    if (!areStringArraysEqual(next.holidayDates, classroomSettings.holidayDates) || !areStringArraysEqual(next.forceOpenDates, classroomSettings.forceOpenDates)) {
      onUpdateClassroomSettings({
        ...classroomSettings,
        holidayDates: [...next.holidayDates],
        forceOpenDates: [...next.forceOpenDates],
      })
    }
    setWeeks(next.weeks)
    setWeekIndex(next.weekIndex)
    setSelectedCellId(next.selectedCellId)
    setSelectedDeskIndex(next.selectedDeskIndex)
    setManualMakeupAdjustments(cloneOriginMap(next.manualMakeupAdjustments))
    setFallbackMakeupStudents(next.fallbackMakeupStudents)
    setManualLectureStockCounts({ ...next.manualLectureStockCounts })
    setFallbackLectureStockStudents({ ...next.fallbackLectureStockStudents })
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setStudentMenu(null)
    setEditStudentDraft(null)
    setStatusMessage('取り消した操作をやり直しました。')
  }

  const handlePackSort = () => {
    const nextWeeks = cloneWeeks(weeks)
    const nextCells = nextWeeks[weekIndex]

    for (const cell of nextCells) {
      for (const desk of cell.desks) {
        if (desk.lesson?.studentSlots[0] === null && desk.lesson?.studentSlots[1]) {
          desk.lesson.studentSlots = [desk.lesson.studentSlots[1], null]
        }
      }

      const orderedDesks = [...cell.desks].sort((leftDesk, rightDesk) => {
        const leftCount = leftDesk.lesson?.studentSlots.filter((student) => student !== null).length ?? 0
        const rightCount = rightDesk.lesson?.studentSlots.filter((student) => student !== null).length ?? 0
        if (leftCount !== rightCount) return rightCount - leftCount

        const leftTeacherLabel = leftDesk.lesson ? (leftDesk.teacher ?? '') : ''
        const rightTeacherLabel = rightDesk.lesson ? (rightDesk.teacher ?? '') : ''
        const teacherCompare = leftTeacherLabel.localeCompare(rightTeacherLabel, 'ja')
        if (teacherCompare !== 0) return teacherCompare

        return parseDeskOrder(leftDesk.id) - parseDeskOrder(rightDesk.id)
      })

      cell.desks = orderedDesks.map((desk, index) => ({
        ...desk,
        id: `${cell.id}_desk_${index + 1}`,
      }))
    }

    commitWeeks(nextWeeks, weekIndex, selectedCellId, 0)
    setStatusMessage('表示中の週だけ、埋まっている机を上に詰めて並び替えました。')
  }

  return (
    <div className="page-shell page-shell-board-only">
      {centeredStatusMessage ? (
        <div className="status-banner status-banner-floating" data-testid="center-status-banner" role="status" aria-live="polite">
          {centeredStatusMessage}
        </div>
      ) : null}
      {pointerPreviewLabel ? (
        <div className="cursor-follow-preview" style={pointerPreviewStyle} data-testid="move-preview" role="status" aria-live="polite">
          {pointerPreviewLabel}
        </div>
      ) : null}
      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified">
          <BoardToolbar
            weekLabel={weekLabel}
            statusMessage={statusMessage}
            lectureStockEntryCount={lectureStockEntries.length}
            isLectureStockOpen={isLectureStockOpen}
            makeupStockEntryCount={makeupStockEntries.length}
            isMakeupStockOpen={isMakeupStockOpen}
            isMakeupMoveActive={selectedMakeupStockKey !== null}
            isPrintingPdf={isPrintingPdf}
            isStudentScheduleOpen={isStudentScheduleOpen}
            isTeacherScheduleOpen={isTeacherScheduleOpen}
            hasSelectedStudent={selectedStudentId !== null || selectedMakeupStockKey !== null}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            canGoPrevWeek
            canGoNextWeek
            onUndo={handleUndo}
            onRedo={handleRedo}
            onPackSort={handlePackSort}
            onGoPrevWeek={() => switchWeek(weekIndex - 1)}
            onGoNextWeek={() => switchWeek(weekIndex + 1)}
            onToggleLectureStock={handleToggleLectureStock}
            onToggleMakeupStock={handleToggleMakeupStock}
            onOpenStudentSchedule={handleOpenStudentSchedule}
            onOpenTeacherSchedule={handleOpenTeacherSchedule}
            onPrintPdf={handlePrintPdf}
            onCancelSelection={handleCancelSelection}
            onOpenBasicData={onOpenBasicData}
            onOpenSpecialData={onOpenSpecialData}
            onOpenBackupRestore={onOpenBackupRestore}
          />
          <div ref={boardExportRef} className="board-export-surface" data-testid="board-export-surface">
          {isLectureStockOpen || isMakeupStockOpen ? (
            <div className="stock-panels">
              {isLectureStockOpen ? (
                <section className="lecture-stock-panel" data-testid="lecture-stock-panel">
                  <div className="makeup-stock-panel-head">
                    <strong>講習ストック</strong>
                    <span className="basic-data-muted-inline">生徒ごとの講習ストック数です。</span>
                  </div>
                  <div className="makeup-stock-list">
                    {lectureStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の講習ストックはありません。</div>
                    ) : lectureStockEntries.map((entry) => (
                      <div
                        key={entry.key}
                        className="lecture-stock-row"
                        title={entry.title}
                        data-testid={`lecture-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                      >
                        <span className="makeup-stock-name">{entry.displayName}</span>
                        <span className="status-chip">+{entry.requestedCount}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {isMakeupStockOpen ? (
                <section className="makeup-stock-panel" data-testid="makeup-stock-panel">
                  <div className="makeup-stock-panel-head">
                    <strong>振替ストック</strong>
                    <span className="basic-data-muted-inline">残数のある生徒を選ぶとコマ表へ配置できます。</span>
                  </div>
                  <div className="makeup-stock-list">
                    {makeupStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の振替ストックはありません。</div>
                    ) : makeupStockEntries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className={`makeup-stock-row${selectedMakeupStockKey === entry.key ? ' active' : ''}${entry.balance < 0 ? ' is-negative' : ''}`}
                        onClick={() => handleSelectMakeupStockEntry(entry)}
                        disabled={entry.balance <= 0}
                        title={entry.title}
                        data-testid={`makeup-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                      >
                        <span className="makeup-stock-name">{entry.displayName}</span>
                        <span className={`status-chip ${entry.balance < 0 ? 'secondary' : ''}`}>{entry.balance > 0 ? `+${entry.balance}` : entry.balance}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
          <BoardGrid
            cells={cells}
            selectedStudentId={selectedStudentId}
            highlightedCell={highlightedCell}
            highlightedHolidayDate={selectedHolidayDate}
            yearLabel={yearLabel}
            specialPeriods={visibleSpecialSessions}
            resolveStudentDisplayName={resolveBoardStudentDisplayName}
            resolveStudentGradeLabel={resolveBoardStudentGradeLabel}
            resolveDisplayedLessonType={resolveDisplayedLessonType}
            onDayHeaderClick={handleToggleHolidayDate}
            onTeacherClick={handleSelectDesk}
            onStudentClick={handleStudentClick}
          />
          </div>
          {teacherMenu && teacherMenuContext ? (
            <div
              className="student-menu-popover teacher-menu-popover"
              style={teacherMenuPosition}
              data-testid="teacher-action-menu"
            >
              <div className="student-menu-head">
                <strong>講師設定</strong>
                <button type="button" className="student-menu-close" onClick={() => setTeacherMenu(null)}>x</button>
              </div>
              <div className="student-menu-meta">
                {`${teacherMenuContext.cell.dateLabel} ${teacherMenuContext.cell.slotLabel} / ${teacherMenu.deskIndex + 1}机目`}
              </div>
              <div className="student-menu-section">
                <label className="student-menu-label" htmlFor="teacher-select-input">講師</label>
                <select
                  id="teacher-select-input"
                  className="student-menu-select"
                  value={teacherMenu.selectedTeacherName}
                  onChange={(event) => setTeacherMenu((current) => (current ? { ...current, selectedTeacherName: event.target.value } : current))}
                  data-testid="teacher-select-input"
                >
                  <option value="">未選択</option>
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.name}>{teacher.name}</option>
                  ))}
                </select>
              </div>
              <div className="student-menu-section student-menu-actions">
                <button type="button" className="primary-button" onClick={handleConfirmTeacher} data-testid="teacher-select-confirm-button">保存</button>
              </div>
            </div>
          ) : null}
          {studentMenu && (studentMenu.mode === 'memo' || menuStudent) ? (
            <div
              className={`student-menu-popover${studentMenu.mode === 'memo' ? ' student-menu-popover-memo' : ''}`}
              style={menuPosition}
              data-testid="student-action-menu"
            >
              <div className="student-menu-head">
                <strong>{studentMenu?.mode === 'memo' ? 'メモ' : resolveBoardStudentDisplayName(menuStudent?.student.name ?? '')}</strong>
                <button type="button" className="student-menu-close" onClick={() => setStudentMenu(null)}>x</button>
              </div>
              <div className="student-menu-meta">
                {studentMenu?.mode === 'memo'
                  ? 'コマ表上だけで使うメモを保存します'
                  : `${resolveBoardStudentGradeLabel(menuStudent?.student.name ?? '', menuStudent?.student.grade ?? '', menuStudent?.cell.dateKey ?? displayWeekDate)} ${menuStudent?.student.subject}`}
              </div>
              {studentMenu?.mode === 'root' ? (
                <div className="student-menu-section">
                  <button type="button" className="menu-link-button" onClick={handleStartMove} data-testid="menu-move-button">移動</button>
                  <button type="button" className="menu-link-button" onClick={handleStoreStudent} data-testid="menu-stock-button">ストックする</button>
                </div>
              ) : studentMenu?.mode === 'memo' ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">メモ</strong>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleSaveMemo} data-testid="menu-memo-save-button">保存</button>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="student-memo-input">内容</label>
                    <textarea
                      id="student-memo-input"
                      className="student-menu-input student-menu-textarea"
                      value={memoDraft}
                      onChange={(event) => setMemoDraft(event.target.value)}
                      data-testid="menu-memo-textarea"
                    />
                    <div className="student-menu-hint">盤面では2行まで表示します。空で保存するとメモを削除します。</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">編集</strong>
                    <button type="button" className="menu-link-button subtle" onClick={handleCloseEdit} data-testid="menu-edit-back-button">戻る</button>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleConfirmEdit} data-testid="menu-edit-confirm-button">決定</button>
                  </div>
                  <div className="student-menu-section">
                    <span className="student-menu-label">授業区分</span>
                    <div className="student-menu-type-grid">
                      {editableLessonTypes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={`student-type-button${editStudentDraft?.lessonType === type ? ' active' : ''}`}
                          onClick={() => setEditStudentDraft((current) => (current ? { ...current, lessonType: type } : current))}
                          data-testid={`menu-lesson-type-${type}`}
                        >
                          {lessonTypeLabels[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="student-menu-section">
                    <span className="student-menu-label">講師区分</span>
                    <div className="student-menu-type-grid student-menu-type-grid-teacher">
                      {editableTeacherTypes.map((teacherType) => (
                        <button
                          key={teacherType}
                          type="button"
                          className={`student-type-button compact${editStudentDraft?.teacherType === teacherType ? ' active' : ''}`}
                          onClick={() => setEditStudentDraft((current) => (current ? { ...current, teacherType } : current))}
                          data-testid={`menu-teacher-type-${teacherType}`}
                        >
                          {teacherTypeLabels[teacherType]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="student-subject-select">科目</label>
                    <select
                      id="student-subject-select"
                      className="student-menu-select"
                      value={editStudentDraft?.subject ?? editableSubjects[0]}
                      onChange={(event) => setEditStudentDraft((current) => (current ? { ...current, subject: event.target.value as SubjectLabel } : current))}
                      data-testid="menu-subject-select"
                    >
                      {editableSubjects.map((subject) => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}