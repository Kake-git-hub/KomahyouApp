import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveTeacherRosterStatus, type GradeCeiling, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { AutoAssignRuleKey, AutoAssignRuleRow, AutoAssignTarget } from '../auto-assign-rules/autoAssignRuleModel'
import { capRegularLessonDatesPerMonth, hasManagedRegularLessonPeriod, isRegularLessonParticipantActiveOnDate, resolveOperationalSchoolYear, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { BoardGrid } from './BoardGrid'
import { BoardToolbar } from './BoardToolbar'
import { buildLectureStockEntries } from './lectureStock'
import { buildMakeupStockEntries, buildMakeupStockKey, type MakeupStockEntry, type ManualMakeupOrigin } from './makeupStock'
import { defaultWeekIndex, getWeekStart, lessonTypeLabels, shiftDate, teacherTypeLabels } from './mockData'
import type { DeskCell, DeskLesson, GradeLabel, LessonType, SlotCell, StudentEntry, SubjectLabel, TeacherType } from './types'
import type { ClassroomSettings, StudentScheduleRequest, TeacherAutoAssignRequest } from '../../App'
import type { ManualLectureStockOrigin, PersistedBoardState } from '../../types/appState'
import type { PairConstraintRow } from '../../types/pairConstraint'
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
  suppressedMakeupOrigins: MakeupOriginMap
  fallbackMakeupStudents: Record<string, { studentName: string; displayName: string; subject: string }>
  manualLectureStockCounts: LectureStockCountMap
  manualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]>
  fallbackLectureStockStudents: Record<string, { displayName: string }>
}

type StockPanelsRestoreState = {
  lecture: boolean
  makeup: boolean
}

type StudentMenuState = {
  cellId: string
  deskIndex: number
  studentIndex: number
  x: number
  y: number
  mode: 'root' | 'edit' | 'memo' | 'empty' | 'add'
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

type AddExistingStudentDraft = {
  studentId: string
  subject: SubjectLabel
  lessonType: LessonType
  specialSessionId: string
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
  studentKey: string
  studentId: string | null
  displayName: string
  sessionId?: string
  sessionLabel?: string
  requestedCount: number
  nextPlacementEntry: { subject: SubjectLabel; sessionId?: string } | null
  title?: string
}

type LectureStockPendingItem = {
  subject: SubjectLabel
  source: 'session' | 'manual'
  sessionId?: string
  sessionLabel?: string
  startDate?: string
  endDate?: string
  unavailableSlots?: string[]
}

type LectureAutoAssignCandidate = {
  weekIndex: number
  cell: SlotCell
  deskIndex: number
  studentIndex: number
  desk: DeskCell
  teacher: TeacherRow
  matchedItem: LectureStockPendingItem
  scoreVector: number[]
}

type MakeupAutoAssignPendingItem = {
  subject: SubjectLabel
  makeupSourceDate?: string
  makeupSourceLabel?: string
  makeupSourceReasonLabel?: string
}

type MakeupAutoAssignCandidate = {
  weekIndex: number
  cell: SlotCell
  deskIndex: number
  studentIndex: number
  desk: DeskCell
  teacher: TeacherRow
  matchedItem: MakeupAutoAssignPendingItem
  scoreVector: number[]
}

type LectureConstraintGroupKey = 'two-students' | 'lesson-limit' | 'lesson-pattern' | 'time-preference'
type StockActionModalState =
  | { type: 'lecture'; entryKey: string }
  | { type: 'makeup'; entryKey: string }
type InteractionSurface = 'board' | 'student' | 'teacher'
type MakeupAutoAssignRange = {
  startDate: string
  endDate: string
}

const editableSubjects: SubjectLabel[] = ['英', '数', '算', '国', '理', '社']
const editableLessonTypes: LessonType[] = ['regular', 'makeup', 'special']
const editableTeacherTypes: TeacherType[] = ['normal', 'substitute', 'outside']
const interactionLockStorageKey = 'schedule-shared:interaction-lock'
const interactionLockStaleMs = 5000
const lectureConstraintGroupDefinitions: Array<{ key: LectureConstraintGroupKey; orderKey: AutoAssignRuleKey; ruleKeys: AutoAssignRuleKey[] }> = [
  { key: 'two-students', orderKey: 'preferTwoStudentsPerTeacher', ruleKeys: ['preferTwoStudentsPerTeacher'] },
  { key: 'lesson-limit', orderKey: 'maxOneLesson', ruleKeys: ['maxOneLesson', 'maxTwoLessons', 'maxThreeLessons'] },
  { key: 'lesson-pattern', orderKey: 'allowTwoConsecutiveLessons', ruleKeys: ['allowTwoConsecutiveLessons', 'requireBreakBetweenLessons', 'connectRegularLessons'] },
  { key: 'time-preference', orderKey: 'preferLateAfternoon', ruleKeys: ['preferLateAfternoon', 'preferSecondPeriod', 'preferFifthPeriod'] },
]
const gradeCeilingOrder: Record<GradeCeiling, number> = { 小: 1, 中: 2, 高1: 3, 高2: 4, 高3: 5 }

function resolveGradeCeiling(grade: GradeLabel): GradeCeiling {
  if (grade.startsWith('小')) return '小'
  if (grade.startsWith('中')) return '中'
  return grade as GradeCeiling
}

function canTeacherHandleStudentSubject(teacher: TeacherRow, subject: SubjectLabel, grade: GradeLabel) {
  const studentGradeCeiling = resolveGradeCeiling(grade)
  return teacher.subjectCapabilities.some((capability) => (
    (capability.subject === subject || ((capability.subject === '数' || capability.subject === '算') && (subject === '数' || subject === '算')))
    && gradeCeilingOrder[capability.maxGrade] >= gradeCeilingOrder[studentGradeCeiling]
  ))
}

function matchesAutoAssignTarget(target: AutoAssignTarget, studentId: string, studentGrade: GradeLabel) {
  if (target.type === 'all') return true
  if (target.type === 'grade') return target.grade === studentGrade
  return target.studentIds.includes(studentId)
}

function isAutoAssignRuleApplicable(rule: AutoAssignRuleRow | undefined, studentId: string, studentGrade: GradeLabel) {
  if (!rule || rule.targets.length === 0) return false
  if (rule.excludeTargets.some((target) => matchesAutoAssignTarget(target, studentId, studentGrade))) return false
  return rule.targets.some((target) => matchesAutoAssignTarget(target, studentId, studentGrade))
}

function isSubjectCapabilityConstraintApplicable(autoAssignRuleByKey: Map<AutoAssignRuleKey, AutoAssignRuleRow>, studentId: string, studentGrade: GradeLabel) {
  return isAutoAssignRuleApplicable(autoAssignRuleByKey.get('subjectCapableTeachersOnly'), studentId, studentGrade)
}

function compareScoreVectors(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function buildForcedConstraintScoreVector(params: {
  firstPeriodPreferred: boolean
  subjectCapablePreferred: boolean
  regularTeacherPreferred: boolean
}) {
  const forcedScores = [
    params.firstPeriodPreferred ? 1 : 0,
    params.subjectCapablePreferred ? 1 : 0,
    params.regularTeacherPreferred ? 1 : 0,
  ]
  return [forcedScores.reduce((total, score) => total + score, 0), ...forcedScores]
}

function buildDefaultMakeupAutoAssignRange(referenceDate: string): MakeupAutoAssignRange {
  return {
    startDate: referenceDate,
    endDate: shiftDate(parseDateKey(referenceDate), 27).toISOString().slice(0, 10),
  }
}

function createInteractionLockToken(surface: InteractionSurface) {
  return `${surface}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function parseInteractionLockOwner(rawValue: string | null): InteractionSurface | null {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as { owner?: unknown; updatedAt?: unknown }
    if (parsed.owner !== 'board' && parsed.owner !== 'student' && parsed.owner !== 'teacher') return null
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Number(parsed.updatedAt)
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > interactionLockStaleMs) return null
    return parsed.owner
  } catch {
    return null
  }
}

function readInteractionLockPayload() {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.localStorage.getItem(interactionLockStorageKey)
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue) as { owner?: unknown; token?: unknown; updatedAt?: unknown }
    if (parsed.owner !== 'board' && parsed.owner !== 'student' && parsed.owner !== 'teacher') return null
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Number(parsed.updatedAt)
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > interactionLockStaleMs) return null
    return {
      owner: parsed.owner,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      updatedAt,
    }
  } catch {
    return null
  }
}

function writeInteractionLockPayload(payload: { owner: InteractionSurface; token: string; updatedAt: number } | null) {
  if (typeof window === 'undefined') return

  try {
    if (!payload) {
      window.localStorage.removeItem(interactionLockStorageKey)
      return
    }
    window.localStorage.setItem(interactionLockStorageKey, JSON.stringify(payload))
  } catch {
    // Ignore storage failures and keep the UI usable.
  }
}

function getInteractionSurfaceLabel(surface: InteractionSurface) {
  if (surface === 'student') return '生徒日程表'
  if (surface === 'teacher') return '講師日程表'
  return 'コマ表'
}

function resolveLectureConstraintGroupOrder(rules: AutoAssignRuleRow[]) {
  return lectureConstraintGroupDefinitions
    .map((group) => ({
      ...group,
      orderIndex: rules.findIndex((rule) => rule.key === group.orderKey),
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex)
}

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
  autoAssignRules: AutoAssignRuleRow[]
  pairConstraints: PairConstraintRow[]
  teacherAutoAssignRequest?: TeacherAutoAssignRequest | null
  studentScheduleRequest?: StudentScheduleRequest | null
  initialBoardState?: PersistedBoardState | null
  onBoardStateChange?: (state: PersistedBoardState) => void
  onUpdateSpecialSessions: Dispatch<SetStateAction<SpecialSessionRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
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

function cloneManualLectureStockOrigins(originMap: Record<string, ManualLectureStockOrigin[]>) {
  return Object.fromEntries(Object.entries(originMap).map(([key, values]) => [key, values.map((value) => ({ ...value }))]))
}

function appendManualLectureStockOrigin(originMap: Record<string, ManualLectureStockOrigin[]>, key: string, origin: ManualLectureStockOrigin) {
  const currentOrigins = originMap[key] ?? []
  return {
    ...originMap,
    [key]: [...currentOrigins, origin],
  }
}

function consumeManualLectureStockOrigin(originMap: Record<string, ManualLectureStockOrigin[]>, key: string, options?: { sessionId?: string }) {
  const currentOrigins = originMap[key] ?? []
  if (currentOrigins.length === 0) return originMap

  const targetIndex = options?.sessionId
    ? currentOrigins.findIndex((origin) => origin.sessionId === options.sessionId)
    : 0
  const resolvedIndex = targetIndex >= 0 ? targetIndex : 0
  const nextOrigins = currentOrigins.filter((_, index) => index !== resolvedIndex)

  if (nextOrigins.length === 0) {
    const { [key]: _removed, ...rest } = originMap
    return rest
  }

  return {
    ...originMap,
    [key]: nextOrigins,
  }
}

function appendMakeupOrigin(originMap: MakeupOriginMap, key: string, originDate: string) {
  const nextDates = originMap[key] ?? []
  return {
    ...originMap,
    [key]: [...nextDates, { dateKey: originDate }].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
  }
}

function removeStudentFromDeskLesson(desk: DeskCell, studentIndex: number) {
  if (!desk.lesson) return

  desk.lesson.studentSlots[studentIndex] = null
  if (!desk.lesson.studentSlots[0] && !desk.lesson.studentSlots[1]) {
    desk.lesson = undefined
  }
}

function appendLectureStockCount(countMap: LectureStockCountMap, key: string, increment = 1) {
  return {
    ...countMap,
    [key]: (countMap[key] ?? 0) + increment,
  }
}

function buildLectureStockKey(studentKey: string, subject: string) {
  return `${studentKey}__${subject}`
}

function buildLectureStockScopeKey(studentKey: string, sessionId?: string) {
  return `${studentKey}__${sessionId ?? '-'}`
}

function buildDatePriorityScore(dateKey: string) {
  return 99999999 - Number(dateKey.replace(/-/g, ''))
}

function isDateWithinRange(dateKey: string, startDate?: string, endDate?: string) {
  if (startDate && dateKey < startDate) return false
  if (endDate && dateKey > endDate) return false
  return true
}

function parseLectureStockKey(key: string) {
  const [studentKey = key, subject = ''] = key.split('__')
  return { studentKey, subject }
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
    createBoardWeek(previousWeekStart, { classroomSettings, teachers, students, regularLessons }),
    createBoardWeek(currentWeekStart, { classroomSettings, teachers, students, regularLessons }),
    createBoardWeek(nextWeekStart, { classroomSettings, teachers, students, regularLessons }),
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
        const managedWeek = createBoardWeek(weekStart, {
          classroomSettings: params.classroomSettings,
          teachers: params.teachers,
          students: params.students,
          regularLessons: params.regularLessons,
        })
        return overlayBoardWeeksOnScheduleCells(managedWeek, [week])
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
    suppressedMakeupOrigins: cloneOriginMap(params.initialBoardState?.suppressedMakeupOrigins ?? {}),
    fallbackMakeupStudents: { ...(params.initialBoardState?.fallbackMakeupStudents ?? {}) },
    manualLectureStockCounts: { ...(params.initialBoardState?.manualLectureStockCounts ?? {}) },
    manualLectureStockOrigins: cloneManualLectureStockOrigins(params.initialBoardState?.manualLectureStockOrigins ?? {}),
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
  }
}

function formatStockOriginLabel(dateKey: string, slotNumber: number) {
  const date = parseDateKey(dateKey)
  return `${date.getMonth() + 1}/${date.getDate()}(${calendarDayLabels[date.getDay()]}) ${slotNumber}限`
}

function formatSignedStockCount(count: number) {
  return count > 0 ? `+${count}` : String(count)
}

function buildGroupedMakeupStockTitle(entries: MakeupStockEntry[], balance: number) {
  const lines = [`残数: ${formatSignedStockCount(balance)}`]

  for (const entry of entries) {
    if (entry.balance > 0) {
      lines.push(`${entry.subject}: ${formatSignedStockCount(entry.balance)}`)
      const visibleOriginLabels = entry.remainingOriginLabels.slice(0, entry.balance)
      if (visibleOriginLabels.length > 0) {
        lines.push(`元の通常授業: ${visibleOriginLabels.map((label, index) => `${label}（${entry.remainingOriginReasonLabels[index] ?? '振替発生'}）`).join(', ')}`)
      }
    }

    if (entry.balance < 0 && entry.negativeReason) {
      lines.push(`${entry.subject}: ${entry.negativeReason}`)
    }
  }

  return lines.join('\n')
}

function buildGroupedLectureStockTitle(params: {
  requestedCount: number
  subjectTotals: Record<string, number>
}) {
  const lines = [`残数: ${formatSignedStockCount(params.requestedCount)}`]

  Object.entries(params.subjectTotals)
    .filter(([, requestedCount]) => requestedCount > 0)
    .sort((left, right) => {
      if (left[1] !== right[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0], 'ja')
    })
    .forEach(([subject, requestedCount]) => {
      lines.push(`${subject}: ${formatSignedStockCount(requestedCount)}`)
    })

  return lines.join('\n')
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
    if (!student1 && !student2) continue

    const limitDateKeys = (dateKeys: string[]) => (applyMonthlyCap ? capRegularLessonDatesPerMonth(dateKeys) : dateKeys)
    const student1DateKeys = student1
      ? new Set(limitDateKeys(candidateDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, dateKey)
        && isActiveOnDate(student1.entryDate, student1.withdrawDate, student1.isHidden, dateKey)
      ))))
      : new Set<string>()
    const student2DateKeys = student2 && row.subject2
      ? new Set(limitDateKeys(candidateDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, dateKey)
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

function createBoardWeek(weekStart: Date, params: { classroomSettings: ClassroomSettings; teachers: TeacherRow[]; students: StudentRow[]; regularLessons: RegularLessonRow[] }) {
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

function buildCurrentManagedOccurrenceKeys(boardWeeks: SlotCell[][]) {
  const currentKeys = new Set<string>()

  boardWeeks.forEach((week) => {
    week.forEach((cell) => {
      cell.desks.forEach((desk) => {
        desk.lesson?.studentSlots.forEach((student) => {
          if (!student) return
          if (student.lessonType === 'regular' || isReturnedToOriginalSlot(student, cell.dateKey, cell.slotNumber)) {
            currentKeys.add(buildManagedOccurrenceKey(student, cell.dateKey, cell.slotNumber))
          }
        })
      })
    })
  })

  return currentKeys
}

function buildSuppressedManagedOccurrenceKeys(scheduleCells: SlotCell[], boardWeeks: SlotCell[][]) {
  const suppressedKeys = new Set<string>()
  const boardCellIds = new Set(boardWeeks.flat().map((cell) => cell.id))
  const currentManagedKeys = buildCurrentManagedOccurrenceKeys(boardWeeks)

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

  scheduleCells.forEach((managedCell) => {
    if (!boardCellIds.has(managedCell.id)) return

    managedCell.desks.forEach((desk) => {
      if (!desk.lesson || !isManagedLesson(desk.lesson)) return

      desk.lesson.studentSlots.forEach((student) => {
        if (!student) return
        const occurrenceKey = buildManagedOccurrenceKey(student, managedCell.dateKey, managedCell.slotNumber)
        if (!currentManagedKeys.has(occurrenceKey)) {
          suppressedKeys.add(occurrenceKey)
        }
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
  const suppressedManagedKeys = buildSuppressedManagedOccurrenceKeys(scheduleCells, boardWeeks)
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

export function buildManagedScheduleCellsForRange(params: {
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
  return buildManagedRegularLessonsRange({
    startDate: normalizedRange.startDate,
    endDate: normalizedRange.endDate,
    deskCount: params.classroomSettings.deskCount,
    classroomSettings: params.classroomSettings,
    teachers: params.teachers,
    students: params.students,
    regularLessons: params.regularLessons,
  })
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
  const managedCells = buildManagedScheduleCellsForRange(params)

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
        teacherAssignmentSource: desk.manualTeacher ? desk.teacherAssignmentSource : undefined,
        teacherAssignmentSessionId: desk.manualTeacher ? desk.teacherAssignmentSessionId : undefined,
        teacherAssignmentTeacherId: desk.manualTeacher ? desk.teacherAssignmentTeacherId : undefined,
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
      targetDesk.manualTeacher = false
      targetDesk.teacherAssignmentSource = undefined
      targetDesk.teacherAssignmentSessionId = undefined
      targetDesk.teacherAssignmentTeacherId = undefined
      targetDesk.lesson = cloneDeskLesson(managedDesk.lesson)
    }

    return {
      ...cell,
      desks: nextDesks,
    }
  })
}

function clearTeacherAssignment(desk: DeskCell) {
  desk.teacher = ''
  desk.manualTeacher = false
  desk.teacherAssignmentSource = undefined
  desk.teacherAssignmentSessionId = undefined
  desk.teacherAssignmentTeacherId = undefined
}

function setManualTeacherAssignment(desk: DeskCell, teacherName: string, teacherId?: string) {
  desk.teacher = teacherName
  desk.manualTeacher = true
  desk.teacherAssignmentSource = 'manual'
  desk.teacherAssignmentSessionId = undefined
  desk.teacherAssignmentTeacherId = teacherId
}

function setScheduleRegistrationTeacherAssignment(desk: DeskCell, teacherName: string, sessionId: string, teacherId: string) {
  desk.teacher = teacherName
  desk.manualTeacher = true
  desk.teacherAssignmentSource = 'schedule-registration'
  desk.teacherAssignmentSessionId = sessionId
  desk.teacherAssignmentTeacherId = teacherId
}

function repackTeacherOnlyDesks(desks: DeskCell[]) {
  const teacherOnlyDesks = desks
    .filter((desk) => !desk.lesson && desk.teacher.trim())
    .map((desk) => ({
      teacher: desk.teacher,
      manualTeacher: Boolean(desk.manualTeacher),
      teacherAssignmentSource: desk.teacherAssignmentSource,
      teacherAssignmentSessionId: desk.teacherAssignmentSessionId,
      teacherAssignmentTeacherId: desk.teacherAssignmentTeacherId,
    }))

  const nextDesks = desks.map((desk) => {
    if (desk.lesson) return desk
    return {
      ...desk,
      teacher: '',
      manualTeacher: false,
      teacherAssignmentSource: undefined,
      teacherAssignmentSessionId: undefined,
      teacherAssignmentTeacherId: undefined,
    }
  })

  let teacherOnlyIndex = 0
  for (let deskIndex = 0; deskIndex < nextDesks.length; deskIndex += 1) {
    if (nextDesks[deskIndex]?.lesson) continue
    const teacherOnlyDesk = teacherOnlyDesks[teacherOnlyIndex]
    if (!teacherOnlyDesk) break
    nextDesks[deskIndex] = {
      ...nextDesks[deskIndex],
      teacher: teacherOnlyDesk.teacher,
      manualTeacher: teacherOnlyDesk.manualTeacher,
      teacherAssignmentSource: teacherOnlyDesk.teacherAssignmentSource,
      teacherAssignmentSessionId: teacherOnlyDesk.teacherAssignmentSessionId,
      teacherAssignmentTeacherId: teacherOnlyDesk.teacherAssignmentTeacherId,
    }
    teacherOnlyIndex += 1
  }

  return nextDesks
}

function removeAutoAssignedTeacherFromSpecialSession(params: {
  weeks: SlotCell[][]
  session: SpecialSessionRow
  teacher: TeacherRow
}) {
  const nextWeeks = cloneWeeks(params.weeks)
  let clearedCellCount = 0
  let hasChanges = false

  for (const week of nextWeeks) {
    for (const cell of week) {
      if (cell.dateKey < params.session.startDate || cell.dateKey > params.session.endDate) continue

      let cellChanged = false
      for (const desk of cell.desks) {
        if (desk.teacherAssignmentSource !== 'schedule-registration') continue
        if (desk.teacherAssignmentSessionId !== params.session.id) continue
        if (desk.teacherAssignmentTeacherId !== params.teacher.id) continue
        clearTeacherAssignment(desk)
        clearedCellCount += 1
        cellChanged = true
      }

      if (cellChanged) {
        cell.desks = repackTeacherOnlyDesks(cell.desks)
        hasChanges = true
      }
    }
  }

  return {
    nextWeeks,
    teacherName: getTeacherDisplayName(params.teacher),
    clearedCellCount,
    hasChanges,
  }
}

function removeStudentAssignmentsFromSpecialSession(params: {
  weeks: SlotCell[][]
  session: SpecialSessionRow
  student: StudentRow
  manualLectureStockCounts: LectureStockCountMap
  manualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]>
  fallbackLectureStockStudents: Record<string, { displayName: string; subject?: string }>
}) {
  const nextWeeks = cloneWeeks(params.weeks)
  let nextManualLectureStockCounts = { ...params.manualLectureStockCounts }
  let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(params.manualLectureStockOrigins)
  let nextFallbackLectureStockStudents = { ...params.fallbackLectureStockStudents }
  const normalizeStudentNameKey = (value: string) => value.replace(/\s+/g, '')
  const registeredStudentName = params.student.name
  const displayStudentName = getStudentDisplayName(params.student)
  const registeredStudentNameKey = normalizeStudentNameKey(registeredStudentName)
  const displayStudentNameKey = normalizeStudentNameKey(displayStudentName)
  let clearedCellCount = 0
  let hasChanges = false

  for (const week of nextWeeks) {
    for (const cell of week) {
      for (const desk of cell.desks) {
        const lesson = desk.lesson
        if (!lesson) continue

        lesson.studentSlots.forEach((studentEntry, studentIndex) => {
          if (!studentEntry) return
          if (studentEntry.lessonType !== 'special') return
          const entryStudentNameKey = normalizeStudentNameKey(studentEntry.name)
          const matchesStudent = studentEntry.managedStudentId === params.student.id
            || entryStudentNameKey === registeredStudentNameKey
            || entryStudentNameKey === displayStudentNameKey
          if (!matchesStudent) return
          if (studentEntry.specialSessionId) {
            if (studentEntry.specialSessionId !== params.session.id) return
          } else if (
            studentEntry.specialStockSource !== 'session'
            || cell.dateKey < params.session.startDate
            || cell.dateKey > params.session.endDate
          ) {
            return
          }

          if (studentEntry.specialStockSource === 'session') {
            const lectureStockKey = buildLectureStockKey(params.student.id, studentEntry.subject)
            nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, lectureStockKey, 1)
            nextManualLectureStockOrigins = appendManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, {
              displayName: getStudentDisplayName(params.student),
              sessionId: params.session.id,
            })
            nextFallbackLectureStockStudents = {
              ...nextFallbackLectureStockStudents,
              [lectureStockKey]: {
                displayName: getStudentDisplayName(params.student),
                subject: studentEntry.subject,
              },
            }
          }

          removeStudentFromDeskLesson(desk, studentIndex)
          clearedCellCount += 1
          hasChanges = true
        })
      }
    }
  }

  return {
    nextWeeks,
    nextManualLectureStockCounts,
    nextManualLectureStockOrigins,
    nextFallbackLectureStockStudents,
    studentName: getStudentDisplayName(params.student),
    clearedCellCount,
    hasChanges,
  }
}

function ensureWeeksCoverDateRange(params: {
  weeks: SlotCell[][]
  startDate: string
  endDate: string
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
}) {
  let nextWeeks = cloneWeeks(params.weeks)
  let weekIndexOffset = 0

  while ((nextWeeks[0]?.[0]?.dateKey ?? params.startDate) > params.startDate) {
    const firstWeekStart = getWeekStart(parseDateKey(nextWeeks[0]?.[0]?.dateKey ?? params.startDate))
    const previousWeekStart = shiftDate(firstWeekStart, -7)
    nextWeeks = [
      createBoardWeek(previousWeekStart, {
        classroomSettings: params.classroomSettings,
        teachers: params.teachers,
        students: params.students,
        regularLessons: params.regularLessons,
      }),
      ...nextWeeks,
    ]
    weekIndexOffset += 1
  }

  while ((nextWeeks[nextWeeks.length - 1]?.[6]?.dateKey ?? params.endDate) < params.endDate) {
    const lastWeekStart = getWeekStart(parseDateKey(nextWeeks[nextWeeks.length - 1]?.[0]?.dateKey ?? params.endDate))
    const nextWeekStart = shiftDate(lastWeekStart, 7)
    nextWeeks = [
      ...nextWeeks,
      createBoardWeek(nextWeekStart, {
        classroomSettings: params.classroomSettings,
        teachers: params.teachers,
        students: params.students,
        regularLessons: params.regularLessons,
      }),
    ]
  }

  return {
    weeks: nextWeeks,
    weekIndexOffset,
  }
}

function autoAssignTeacherToSpecialSession(params: {
  weeks: SlotCell[][]
  session: SpecialSessionRow
  teacher: TeacherRow
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
}) {
  const teacherName = getTeacherDisplayName(params.teacher)
  const unavailableSlots = new Set(params.session.teacherInputs[params.teacher.id]?.unavailableSlots ?? [])
  const coveredWeeks = ensureWeeksCoverDateRange({
    weeks: params.weeks,
    startDate: params.session.startDate,
    endDate: params.session.endDate,
    classroomSettings: params.classroomSettings,
    teachers: params.teachers,
    students: params.students,
    regularLessons: params.regularLessons,
  })
  const nextWeeks = coveredWeeks.weeks
  let assignedCellCount = 0
  let skippedFullCellCount = 0
  let hasChanges = coveredWeeks.weekIndexOffset > 0 || coveredWeeks.weeks.length !== params.weeks.length

  for (const week of nextWeeks) {
    for (const cell of week) {
      if (cell.dateKey < params.session.startDate || cell.dateKey > params.session.endDate) continue
      if (!cell.isOpenDay) continue
      if (resolveTeacherRosterStatus(params.teacher, cell.dateKey) !== '在籍') continue

      const slotKey = `${cell.dateKey}_${cell.slotNumber}`
      if (unavailableSlots.has(slotKey)) continue

      const alreadyAssigned = cell.desks.some((desk) => desk.teacher === teacherName)
      if (alreadyAssigned) {
        const repackedDesks = repackTeacherOnlyDesks(cell.desks)
        const repackedChanged = repackedDesks.some((desk, deskIndex) => (
          desk.teacher !== cell.desks[deskIndex]?.teacher || desk.manualTeacher !== Boolean(cell.desks[deskIndex]?.manualTeacher)
        ))
        if (repackedChanged) {
          cell.desks = repackedDesks
          hasChanges = true
        }
        continue
      }

      const teacherOnlyDesks = cell.desks.filter((desk) => !desk.lesson && desk.teacher.trim())
      const emptyDeskCount = cell.desks.filter((desk) => !desk.lesson).length
      if (teacherOnlyDesks.length >= emptyDeskCount) {
        skippedFullCellCount += 1
        continue
      }

      const nextDesks = cell.desks.map((desk) => ({ ...desk }))
      const candidateDesk = nextDesks.find((desk) => !desk.lesson && !desk.teacher.trim())
        ?? nextDesks.find((desk) => !desk.lesson)
      if (!candidateDesk) {
        skippedFullCellCount += 1
        continue
      }

      setScheduleRegistrationTeacherAssignment(candidateDesk, teacherName, params.session.id, params.teacher.id)
      cell.desks = repackTeacherOnlyDesks(nextDesks)
      assignedCellCount += 1
      hasChanges = true
    }
  }

  return {
    nextWeeks,
    weekIndexOffset: coveredWeeks.weekIndexOffset,
    teacherName,
    assignedCellCount,
    skippedFullCellCount,
    hasChanges,
  }
}

export function ScheduleBoardScreen({ classroomSettings, teachers, students, regularLessons, specialSessions, autoAssignRules, pairConstraints, teacherAutoAssignRequest, studentScheduleRequest, initialBoardState, onBoardStateChange, onUpdateSpecialSessions, onUpdateClassroomSettings, onOpenBasicData, onOpenSpecialData, onOpenAutoAssignRules, onOpenBackupRestore }: ScheduleBoardScreenProps) {
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
  const [selectedLectureStockKey, setSelectedLectureStockKey] = useState<string | null>(null)
  const [selectedHolidayDate, setSelectedHolidayDate] = useState<string | null>(null)
  const [studentMenu, setStudentMenu] = useState<StudentMenuState | null>(null)
  const [memoDraft, setMemoDraft] = useState('')
  const [editStudentDraft, setEditStudentDraft] = useState<EditStudentDraft | null>(null)
  const [addExistingStudentDraft, setAddExistingStudentDraft] = useState<AddExistingStudentDraft | null>(null)
  const [statusMessage, setStatusMessage] = useState('左クリックで生徒を選ぶか、空欄の生徒マスを左クリックしてメモを保存できます。')
  const [manualMakeupAdjustments, setManualMakeupAdjustments] = useState<MakeupOriginMap>(initialBoardSnapshot.manualMakeupAdjustments)
  const [suppressedMakeupOrigins, setSuppressedMakeupOrigins] = useState<MakeupOriginMap>(initialBoardSnapshot.suppressedMakeupOrigins)
  const [fallbackMakeupStudents, setFallbackMakeupStudents] = useState<Record<string, FallbackMakeupStudent>>(initialBoardSnapshot.fallbackMakeupStudents)
  const [manualLectureStockCounts, setManualLectureStockCounts] = useState<LectureStockCountMap>(initialBoardSnapshot.manualLectureStockCounts)
  const [manualLectureStockOrigins, setManualLectureStockOrigins] = useState<Record<string, ManualLectureStockOrigin[]>>(initialBoardSnapshot.manualLectureStockOrigins)
  const [fallbackLectureStockStudents, setFallbackLectureStockStudents] = useState<Record<string, { displayName: string; subject?: string }>>(initialBoardSnapshot.fallbackLectureStockStudents)
  const [isLectureStockOpen, setIsLectureStockOpen] = useState(initialBoardSnapshot.isLectureStockOpen)
  const [isMakeupStockOpen, setIsMakeupStockOpen] = useState(initialBoardSnapshot.isMakeupStockOpen)
  const [isPrintingPdf, setIsPrintingPdf] = useState(false)
  const [isStudentScheduleOpen, setIsStudentScheduleOpen] = useState(() => hasOpenSchedulePopup('student'))
  const [isTeacherScheduleOpen, setIsTeacherScheduleOpen] = useState(() => hasOpenSchedulePopup('teacher'))
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.studentScheduleRange)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.teacherScheduleRange)
  const [stockActionModal, setStockActionModal] = useState<StockActionModalState | null>(null)
  const [makeupAutoAssignRange, setMakeupAutoAssignRange] = useState<MakeupAutoAssignRange>(() => buildDefaultMakeupAutoAssignRange(initialBoardSnapshot.weeks[initialBoardSnapshot.weekIndex]?.[0]?.dateKey ?? getReferenceDateKey(new Date())))
  const [stockPanelsRestoreState, setStockPanelsRestoreState] = useState<StockPanelsRestoreState | null>(null)
  const boardInteractionTokenRef = useRef(createInteractionLockToken('board'))
  const [interactionLockOwner, setInteractionLockOwner] = useState<InteractionSurface | null>(() => parseInteractionLockOwner(typeof window === 'undefined' ? null : window.localStorage.getItem(interactionLockStorageKey)))
  const [teacherMenu, setTeacherMenu] = useState<TeacherMenuState | null>(null)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [pointerPreviewPosition, setPointerPreviewPosition] = useState({ x: 0, y: 0 })
  const processedTeacherAutoAssignRequestIdRef = useRef<number | null>(null)
  const processedStudentScheduleRequestIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!onBoardStateChange) return
    onBoardStateChange({
      weeks: cloneWeeks(weeks),
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      manualMakeupAdjustments: cloneOriginMap(manualMakeupAdjustments),
      suppressedMakeupOrigins: cloneOriginMap(suppressedMakeupOrigins),
      fallbackMakeupStudents: { ...fallbackMakeupStudents },
      manualLectureStockCounts: { ...manualLectureStockCounts },
      manualLectureStockOrigins: cloneManualLectureStockOrigins(manualLectureStockOrigins),
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
    manualLectureStockOrigins,
    manualLectureStockCounts,
    manualMakeupAdjustments,
    onBoardStateChange,
    selectedCellId,
    selectedDeskIndex,
    studentScheduleRange,
    suppressedMakeupOrigins,
    teacherScheduleRange,
    weekIndex,
    weeks,
  ])

  useEffect(() => {
    setWeeks((currentWeeks) => normalizeWeeksDeskCount(currentWeeks.map((week) => {
      const firstDateKey = week[0]?.dateKey ?? getReferenceDateKey(new Date())
      const weekStart = getWeekStart(parseDateKey(firstDateKey))
      const managedWeek = createBoardWeek(weekStart, { classroomSettings, teachers, students, regularLessons })
      return overlayBoardWeeksOnScheduleCells(managedWeek, [week])
    }), classroomSettings.deskCount))
  }, [classroomSettings, teachers, students, regularLessons])

  useEffect(() => {
    if (typeof window === 'undefined') return
    getSchedulePopupRuntimeWindow().__lessonScheduleBoardWeeks = normalizedWeeks
  }, [normalizedWeeks])

  useEffect(() => {
    if (!teacherAutoAssignRequest) return
    if (processedTeacherAutoAssignRequestIdRef.current === teacherAutoAssignRequest.requestId) return
    processedTeacherAutoAssignRequestIdRef.current = teacherAutoAssignRequest.requestId

    const session = specialSessions.find((entry) => entry.id === teacherAutoAssignRequest.sessionId)
    const teacher = teachers.find((entry) => entry.id === teacherAutoAssignRequest.teacherId)
    if (!session || !teacher) return

    if (teacherAutoAssignRequest.mode === 'unassign') {
      const result = removeAutoAssignedTeacherFromSpecialSession({
        weeks,
        session,
        teacher,
      })

      if (!result.hasChanges) {
        setStatusMessage(`${session.label} で ${result.teacherName} の日程表登録由来は見つかりませんでした。`)
        return
      }

      commitWeeks(
        result.nextWeeks,
        weekIndex,
        selectedCellId,
        selectedDeskIndex,
      )
      setStatusMessage(`${session.label} で ${result.teacherName} の日程表登録由来を ${result.clearedCellCount} コマ解除しました。`)
      return
    }

    const result = autoAssignTeacherToSpecialSession({
      weeks,
      session,
      teacher,
      classroomSettings,
      teachers,
      students,
      regularLessons,
    })

    if (!result.hasChanges) {
      setStatusMessage(`${session.label} で ${result.teacherName} の自動登録対象はありませんでした。`)
      return
    }

    commitWeeks(
      result.nextWeeks,
      weekIndex + result.weekIndexOffset,
      selectedCellId,
      selectedDeskIndex,
    )
    setStatusMessage(
      `${session.label} で ${result.teacherName} を ${result.assignedCellCount} コマ自動登録しました。`
      + (result.skippedFullCellCount > 0 ? ` ${result.skippedFullCellCount} コマは空き机がないためスキップしました。` : ''),
    )
  }, [classroomSettings, regularLessons, selectedCellId, selectedDeskIndex, specialSessions, students, teacherAutoAssignRequest, teachers, weekIndex, weeks])

  useEffect(() => {
    if (!studentScheduleRequest) return
    if (processedStudentScheduleRequestIdRef.current === studentScheduleRequest.requestId) return
    processedStudentScheduleRequestIdRef.current = studentScheduleRequest.requestId

    const session = specialSessions.find((entry) => entry.id === studentScheduleRequest.sessionId)
    const student = students.find((entry) => entry.id === studentScheduleRequest.studentId)
    if (!session || !student) return

    const result = removeStudentAssignmentsFromSpecialSession({
      weeks: normalizedWeeks,
      session,
      student,
      manualLectureStockCounts,
      manualLectureStockOrigins,
      fallbackLectureStockStudents,
    })

    if (!result.hasChanges) {
      setStatusMessage(`${session.label} で ${result.studentName} の講習授業は見つかりませんでした。`)
      return
    }

    commitWeeks(
      result.nextWeeks,
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      suppressedMakeupOrigins,
      fallbackMakeupStudents,
      result.nextManualLectureStockCounts,
      result.nextManualLectureStockOrigins,
      result.nextFallbackLectureStockStudents,
    )
    setStatusMessage(`${session.label} で ${result.studentName} の講習授業を ${result.clearedCellCount} コマ解除しました。`)
  }, [classroomSettings.forceOpenDates, classroomSettings.holidayDates, fallbackLectureStockStudents, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, manualMakeupAdjustments, normalizedWeeks, selectedCellId, selectedDeskIndex, specialSessions, studentScheduleRequest, students, suppressedMakeupOrigins, weekIndex])

  useEffect(() => {
    const pendingUnsubmittedSessionStudents = specialSessions.flatMap((session) => Object.entries(session.studentInputs)
      .filter(([, input]) => !input.countSubmitted)
      .map(([studentId]) => ({ session, student: students.find((entry) => entry.id === studentId) ?? null })))
      .filter((entry): entry is { session: SpecialSessionRow; student: StudentRow } => Boolean(entry.student))
    if (pendingUnsubmittedSessionStudents.length === 0) return

    let nextWeeks = cloneWeeks(normalizedWeeks)
    let nextManualLectureStockCounts = { ...manualLectureStockCounts }
    let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(manualLectureStockOrigins)
    let nextFallbackLectureStockStudents = { ...fallbackLectureStockStudents }
    let hasChanges = false

    for (const { session, student } of pendingUnsubmittedSessionStudents) {
      const result = removeStudentAssignmentsFromSpecialSession({
        weeks: nextWeeks,
        session,
        student,
        manualLectureStockCounts: nextManualLectureStockCounts,
        manualLectureStockOrigins: nextManualLectureStockOrigins,
        fallbackLectureStockStudents: nextFallbackLectureStockStudents,
      })
      if (!result.hasChanges) continue

      nextWeeks = result.nextWeeks
      nextManualLectureStockCounts = result.nextManualLectureStockCounts
      nextManualLectureStockOrigins = result.nextManualLectureStockOrigins
      nextFallbackLectureStockStudents = result.nextFallbackLectureStockStudents
      hasChanges = true
    }

    if (!hasChanges) return

    commitWeeks(
      nextWeeks,
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      suppressedMakeupOrigins,
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      nextFallbackLectureStockStudents,
    )
    setStatusMessage('未登録になった講習授業をコマ表から外しました。')
  }, [classroomSettings.forceOpenDates, classroomSettings.holidayDates, fallbackLectureStockStudents, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, manualMakeupAdjustments, normalizedWeeks, selectedCellId, selectedDeskIndex, specialSessions, students, suppressedMakeupOrigins, weekIndex])

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

  const refreshInteractionLockOwner = useCallback(() => {
    const nextPayload = readInteractionLockPayload()
    setInteractionLockOwner((nextPayload?.owner as InteractionSurface | undefined) ?? null)
  }, [])

  const acquireBoardInteraction = useCallback(() => {
    writeInteractionLockPayload({
      owner: 'board',
      token: boardInteractionTokenRef.current,
      updatedAt: Date.now(),
    })
    setInteractionLockOwner('board')
  }, [])

  const releaseBoardInteraction = useCallback(() => {
    const currentPayload = readInteractionLockPayload()
    if (currentPayload?.token === boardInteractionTokenRef.current) {
      writeInteractionLockPayload(null)
    }
    refreshInteractionLockOwner()
  }, [refreshInteractionLockOwner])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {

        useEffect(() => {
          refreshInteractionLockOwner()
          if (!document.hidden && document.hasFocus()) acquireBoardInteraction()

          const handleFocus = () => acquireBoardInteraction()
          const handleBlur = () => releaseBoardInteraction()
          const handleVisibilityChange = () => {
            if (document.hidden) {
              releaseBoardInteraction()
              return
            }
            if (document.hasFocus()) acquireBoardInteraction()
          }
          const handleStorage = (event: StorageEvent) => {
            if (event.key === interactionLockStorageKey) refreshInteractionLockOwner()
          }
          const heartbeat = window.setInterval(() => {
            const currentPayload = readInteractionLockPayload()
            if (document.hidden || !document.hasFocus()) {
              if (currentPayload?.token === boardInteractionTokenRef.current) releaseBoardInteraction()
              return
            }
            if (currentPayload?.token === boardInteractionTokenRef.current) {
              acquireBoardInteraction()
            } else {
              refreshInteractionLockOwner()
            }
          }, 1000)

          window.addEventListener('focus', handleFocus)
          window.addEventListener('blur', handleBlur)
          window.addEventListener('storage', handleStorage)
          document.addEventListener('visibilitychange', handleVisibilityChange)

          return () => {
            window.clearInterval(heartbeat)
            window.removeEventListener('focus', handleFocus)
            window.removeEventListener('blur', handleBlur)
            window.removeEventListener('storage', handleStorage)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            releaseBoardInteraction()
          }
        }, [acquireBoardInteraction, refreshInteractionLockOwner, releaseBoardInteraction])
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

  const managedStudentByRegisteredName = useMemo(
    () => new Map(students.map((student) => [student.name, student] as const)),
    [students],
  )

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
      && isRegularLessonParticipantActiveOnDate(row, dateKey)
    ))

    if (matchesStudent1) return 'regular'

    const matchesStudent2 = regularLessons.some((row) => (
      row.schoolYear === schoolYear
      && row.student2Id === managedStudent.id
      && row.subject2 === subject
      && row.dayOfWeek === dayOfWeek
      && row.slotNumber === slotNumber
      && isRegularLessonParticipantActiveOnDate(row, dateKey)
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
      && (((row.student1Id === managedStudent.id && row.subject1 === student.subject) && isRegularLessonParticipantActiveOnDate(row, dateKey))
        || ((row.student2Id === managedStudent.id && row.subject2 === student.subject) && isRegularLessonParticipantActiveOnDate(row, dateKey)))
    ))

    return !matchesManagedRegularLesson
  }
  const resolveBoardStudentStockId = (student: StudentEntry) => {
    const managedId = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
    return student.manualAdded ? `manual:${managedId}` : managedId
  }
  const getSelectableSubjectsForStudent = useCallback((student: StudentRow | null, dateKey: string) => {
    if (!student) return editableSubjects
    const gradeLabel = resolveSchoolGradeLabel(student.birthDate, parseDateKey(dateKey))
    if (gradeLabel.startsWith('小')) {
      return editableSubjects.filter((subject) => subject !== '数')
    }
    return editableSubjects.filter((subject) => subject !== '算')
  }, [])

  const rawMakeupStockEntries = useMemo(() => buildMakeupStockEntries({
    students,
    teachers,
    regularLessons,
    classroomSettings,
    weeks: normalizedWeeks,
    manualAdjustments: manualMakeupAdjustments,
    suppressedOrigins: suppressedMakeupOrigins,
    fallbackStudents: fallbackMakeupStudents,
    resolveStudentKey: resolveBoardStudentStockId,
  }), [classroomSettings, fallbackMakeupStudents, manualMakeupAdjustments, normalizedWeeks, regularLessons, students, suppressedMakeupOrigins, teachers])

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
        const title = buildGroupedMakeupStockTitle(sortedEntries, balance)

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

  const lecturePendingItemsByEntryKey = useMemo(() => {
    const expandedRawItemsByStockKey = new Map<string, Array<{
      studentKey: string
      studentId: string
      displayName: string
      item: LectureStockPendingItem
    }>>()

    for (const stockEntry of rawLectureStockEntries) {
      if (stockEntry.requestedCount <= 0) continue
      const session = specialSessions.find((currentSession) => currentSession.id === stockEntry.sessionId)
      const unavailableSlots = session?.studentInputs[stockEntry.studentId]?.unavailableSlots ?? []
      const stockKey = buildLectureStockKey(stockEntry.studentId, stockEntry.subject)
      const currentItems = expandedRawItemsByStockKey.get(stockKey) ?? []
      for (let index = 0; index < stockEntry.requestedCount; index += 1) {
        currentItems.push({
          studentKey: stockEntry.studentId,
          studentId: stockEntry.studentId,
          displayName: stockEntry.displayName,
          item: {
            subject: stockEntry.subject,
            source: 'session',
            sessionId: stockEntry.sessionId,
            sessionLabel: stockEntry.sessionLabel,
            startDate: session?.startDate,
            endDate: session?.endDate,
            unavailableSlots,
          },
        })
      }
      expandedRawItemsByStockKey.set(stockKey, currentItems)
    }

    const scopedItems = new Map<string, Array<{
      studentKey: string
      studentId: string | null
      displayName: string
      item: LectureStockPendingItem
    }>>()

    for (const [stockKey, rawItems] of expandedRawItemsByStockKey.entries()) {
      const adjustment = manualLectureStockCounts[stockKey] ?? 0
      const consumeCount = adjustment < 0 ? Math.min(rawItems.length, Math.abs(adjustment)) : 0
      for (const rawItem of rawItems.slice(consumeCount)) {
        const scopeKey = buildLectureStockScopeKey(rawItem.studentKey, rawItem.item.sessionId)
        const currentItems = scopedItems.get(scopeKey) ?? []
        currentItems.push({
          studentKey: rawItem.studentKey,
          studentId: rawItem.studentId,
          displayName: rawItem.displayName,
          item: rawItem.item,
        })
        scopedItems.set(scopeKey, currentItems)
      }
    }

    const metadataQueueByKey = new Map<string, ManualLectureStockOrigin[]>(
      Object.entries(manualLectureStockOrigins).map(([key, origins]) => [key, origins.map((origin) => ({ ...origin }))]),
    )

    for (const [stockKey, requestedCount] of Object.entries(manualLectureStockCounts)) {
      if (requestedCount <= 0) continue
      const { studentKey, subject } = parseLectureStockKey(stockKey)
      const fallback = fallbackLectureStockStudents[stockKey]
      const fallbackDisplayName = fallback?.displayName ?? studentKey.replace(/^name:/, '')
      const metadataQueue = metadataQueueByKey.get(stockKey) ?? []

      for (let index = 0; index < requestedCount; index += 1) {
        const metadata = metadataQueue.shift()
        const session = metadata?.sessionId
          ? specialSessions.find((currentSession) => currentSession.id === metadata.sessionId) ?? null
          : null
        const scopeKey = buildLectureStockScopeKey(studentKey, metadata?.sessionId)
        const currentItems = scopedItems.get(scopeKey) ?? []
        currentItems.push({
          studentKey,
          studentId: studentKey.startsWith('name:') ? null : studentKey,
          displayName: metadata?.displayName ?? fallbackDisplayName,
          item: {
            subject: (fallback?.subject ?? subject) as SubjectLabel,
            source: 'manual',
            sessionId: metadata?.sessionId,
            sessionLabel: session?.label,
            startDate: session?.startDate,
            endDate: session?.endDate,
            unavailableSlots: session && !studentKey.startsWith('name:')
              ? session.studentInputs[studentKey]?.unavailableSlots ?? []
              : [],
          },
        })
        scopedItems.set(scopeKey, currentItems)
      }
    }

    return new Map(Array.from(scopedItems.entries()).map(([entryKey, items]) => {
      const [firstItem] = items
      return [
        entryKey,
        {
          studentKey: firstItem?.studentKey ?? entryKey.split('__')[0] ?? entryKey,
          studentId: firstItem?.studentId ?? null,
          displayName: firstItem?.displayName ?? entryKey.split('__')[0]?.replace(/^name:/, '') ?? entryKey,
          sessionId: firstItem?.item.sessionId,
          sessionLabel: firstItem?.item.sessionLabel,
          pendingItems: items.map(({ item }) => ({ ...item })),
        },
      ]
    }))
  }, [fallbackLectureStockStudents, manualLectureStockCounts, manualLectureStockOrigins, rawLectureStockEntries, specialSessions])

  const lectureStockEntries = useMemo<GroupedLectureStockEntry[]>(() => {
    const entries = Array.from(lecturePendingItemsByEntryKey.entries())
      .map(([entryKey, scopedEntry]) => {
      if (scopedEntry.pendingItems.length === 0) return null

      const subjectTotals = scopedEntry.pendingItems.reduce<Record<string, number>>((totals, item) => {
        totals[item.subject] = (totals[item.subject] ?? 0) + 1
        return totals
      }, {})
      const nextPlacementEntry = Object.entries(subjectTotals)
        .filter(([, requestedCount]) => requestedCount > 0)
        .map(([subject, requestedCount]) => ({ subject: subject as SubjectLabel, requestedCount }))
        .sort((left, right) => {
          if (left.requestedCount !== right.requestedCount) return right.requestedCount - left.requestedCount
          return left.subject.localeCompare(right.subject, 'ja')
        })[0] ?? null

      return {
        key: entryKey,
        studentKey: scopedEntry.studentKey,
        studentId: scopedEntry.studentId,
        displayName: scopedEntry.displayName,
        sessionId: scopedEntry.sessionId,
        sessionLabel: scopedEntry.sessionLabel,
        requestedCount: scopedEntry.pendingItems.length,
        nextPlacementEntry: nextPlacementEntry ? { subject: nextPlacementEntry.subject, sessionId: scopedEntry.sessionId } : null,
        title: buildGroupedLectureStockTitle({
          requestedCount: scopedEntry.pendingItems.length,
          subjectTotals,
        }),
      }
    })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

    return entries.sort((left, right) => {
      const nameCompare = left.displayName.localeCompare(right.displayName, 'ja')
      if (nameCompare !== 0) return nameCompare
      const leftStart = left.sessionId
        ? (specialSessions.find((session) => session.id === left.sessionId)?.startDate ?? '9999-12-31')
        : '9999-12-31'
      const rightStart = right.sessionId
        ? (specialSessions.find((session) => session.id === right.sessionId)?.startDate ?? '9999-12-31')
        : '9999-12-31'
      if (leftStart !== rightStart) return leftStart.localeCompare(rightStart)
      return (left.sessionLabel ?? '盤面からストック').localeCompare(right.sessionLabel ?? '盤面からストック', 'ja')
    })
  }, [lecturePendingItemsByEntryKey, specialSessions])

  const selectedMakeupStockEntry = useMemo(
    () => makeupStockEntries.find((entry) => entry.key === selectedMakeupStockKey) ?? null,
    [makeupStockEntries, selectedMakeupStockKey],
  )

  const selectedLectureStockEntry = useMemo(
    () => lectureStockEntries.find((entry) => entry.key === selectedLectureStockKey) ?? null,
    [lectureStockEntries, selectedLectureStockKey],
  )
  const autoAssignRuleByKey = useMemo(() => new Map(autoAssignRules.map((rule) => [rule.key, rule])), [autoAssignRules])
  const lectureConstraintGroups = useMemo(() => resolveLectureConstraintGroupOrder(autoAssignRules), [autoAssignRules])
  const studentUnavailableSlotsById = useMemo(() => {
    const byId = new Map<string, Set<string>>()
    for (const session of specialSessions) {
      for (const [studentId, input] of Object.entries(session.studentInputs)) {
        const current = byId.get(studentId) ?? new Set<string>()
        for (const slotKey of input.unavailableSlots ?? []) current.add(slotKey)
        byId.set(studentId, current)
      }
    }
    return byId
  }, [specialSessions])

  const resolveManagedTeacherForDesk = (desk: DeskCell, dateKey: string) => {
    if (desk.teacherAssignmentTeacherId) {
      const matchedTeacher = teachers.find((teacher) => teacher.id === desk.teacherAssignmentTeacherId)
      if (matchedTeacher && resolveTeacherRosterStatus(matchedTeacher, dateKey) === '在籍') return matchedTeacher
    }

    return teachers.find((teacher) => (
      resolveTeacherRosterStatus(teacher, dateKey) === '在籍'
      && (teacher.name === desk.teacher || getTeacherDisplayName(teacher) === desk.teacher)
    )) ?? null
  }

  const collectStudentLessonsOnDate = (sourceWeeks: SlotCell[][], studentKey: string, dateKey: string) => {
    const lessons: Array<{ slotNumber: number; lessonType: LessonType }> = []
    for (const week of sourceWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== dateKey) continue
        for (const desk of cell.desks) {
          for (const student of desk.lesson?.studentSlots ?? []) {
            if (!student) continue
            const currentKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
            if (currentKey !== studentKey) continue
            lessons.push({ slotNumber: cell.slotNumber, lessonType: student.lessonType })
          }
        }
      }
    }
    return lessons
  }

  const resolveRegularTeacherIdsForStudentOnDate = (studentId: string, dateKey: string) => {
    const lessonDate = parseDateKey(dateKey)
    const schoolYear = resolveOperationalSchoolYear(lessonDate)
    const dayOfWeek = lessonDate.getDay()
    const teacherIds = new Set<string>()

    for (const lesson of regularLessons) {
      if (lesson.schoolYear !== schoolYear || lesson.dayOfWeek !== dayOfWeek) continue
      if (lesson.student1Id === studentId && isRegularLessonParticipantActiveOnDate(lesson, dateKey)) teacherIds.add(lesson.teacherId)
      if (lesson.student2Id === studentId && isRegularLessonParticipantActiveOnDate(lesson, dateKey)) teacherIds.add(lesson.teacherId)
    }

    return teacherIds
  }

  const isPairConstraintBlocked = (teacherId: string, primaryStudentId: string, otherStudent: StudentEntry | null) => {
    const otherStudentId = otherStudent?.managedStudentId ?? (otherStudent ? managedStudentByRegisteredName.get(otherStudent.name)?.id : undefined)
    return pairConstraints.some((constraint) => {
      if (constraint.type !== 'incompatible') return false
      const left = `${constraint.personAType}:${constraint.personAId}`
      const right = `${constraint.personBType}:${constraint.personBId}`

      if ((left === `teacher:${teacherId}` && right === `student:${primaryStudentId}`) || (right === `teacher:${teacherId}` && left === `student:${primaryStudentId}`)) {
        return true
      }

      if (!otherStudentId) return false
      return (left === `student:${primaryStudentId}` && right === `student:${otherStudentId}`)
        || (right === `student:${primaryStudentId}` && left === `student:${otherStudentId}`)
    })
  }

  const resolveSpecialSessionById = (sessionId?: string) => {
    if (!sessionId) return null
    return specialSessions.find((session) => session.id === sessionId) ?? null
  }

  const buildLecturePendingItems = (entry: GroupedLectureStockEntry) => {
    return lecturePendingItemsByEntryKey.get(entry.key)?.pendingItems.map((item) => ({ ...item })) ?? []
  }

  const selectedLecturePlacementItem = selectedLectureStockEntry ? buildLecturePendingItems(selectedLectureStockEntry)[0] ?? null : null

  const buildMakeupPendingItems = (entry: GroupedMakeupStockEntry) => {
    const pendingItems: MakeupAutoAssignPendingItem[] = []

    for (const stockEntry of rawMakeupStockEntries) {
      const stockStudentKey = getStockStudentKeyFromEntryKey(stockEntry.key)
      if (stockStudentKey !== entry.stockStudentKey || stockEntry.balance <= 0) continue

      for (let index = 0; index < stockEntry.remainingOriginDates.length; index += 1) {
        pendingItems.push({
          subject: stockEntry.subject as SubjectLabel,
          makeupSourceDate: stockEntry.remainingOriginDates[index],
          makeupSourceLabel: stockEntry.remainingOriginLabels[index],
          makeupSourceReasonLabel: stockEntry.remainingOriginReasonLabels[index],
        })
      }

      const fallbackCount = Math.max(0, stockEntry.balance - stockEntry.remainingOriginDates.length)
      for (let index = 0; index < fallbackCount; index += 1) {
        pendingItems.push({
          subject: stockEntry.subject as SubjectLabel,
        })
      }
    }

    return pendingItems
  }

  const buildCommonAutoAssignScoreVector = (params: {
    studentId: string
    studentGradeOnDate: GradeLabel
    cell: SlotCell
    teacher: TeacherRow
    pairedStudent: StudentEntry | null
    existingLessons: Array<{ slotNumber: number; lessonType: LessonType }>
    lessonLimitSatisfied: boolean
    pairConstraintPreferred: boolean
  }) => {
    const scoreVector: number[] = []
    const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(params.studentId, params.cell.dateKey)
    const isAdjacentToAnyLesson = params.existingLessons.some((lesson) => Math.abs(lesson.slotNumber - params.cell.slotNumber) === 1)
    const hasOneSlotBreak = params.existingLessons.some((lesson) => Math.abs(lesson.slotNumber - params.cell.slotNumber) === 2)
    const isAdjacentToRegularLesson = params.existingLessons.some((lesson) => lesson.lessonType === 'regular' && Math.abs(lesson.slotNumber - params.cell.slotNumber) === 1)

    for (const group of lectureConstraintGroups) {
      const applicableRule = group.ruleKeys
        .map((ruleKey) => autoAssignRuleByKey.get(ruleKey))
        .find((rule) => isAutoAssignRuleApplicable(rule, params.studentId, params.studentGradeOnDate))

      if (group.key === 'lesson-limit') {
        scoreVector.push(applicableRule ? (params.lessonLimitSatisfied ? 2 : 0) : 0)
        continue
      }

      if (group.key === 'two-students') {
        if (applicableRule) scoreVector.push(params.pairedStudent ? 2 : 0)
        else scoreVector.push(params.pairedStudent ? 0 : 1)
        continue
      }

      if (group.key === 'lesson-pattern') {
        if (!applicableRule) {
          scoreVector.push(0)
          continue
        }
        if (applicableRule.key === 'allowTwoConsecutiveLessons') scoreVector.push(isAdjacentToAnyLesson ? 3 : 0)
        else if (applicableRule.key === 'requireBreakBetweenLessons') scoreVector.push(hasOneSlotBreak ? 3 : 0)
        else scoreVector.push(isAdjacentToRegularLesson ? 3 : 0)
        continue
      }

      if (group.key === 'time-preference') {
        if (!applicableRule) {
          scoreVector.push(({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 1 } as Record<number, number>)[params.cell.slotNumber] ?? 0)
          continue
        }
        if (applicableRule.key === 'preferLateAfternoon') {
          scoreVector.push(({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0)
        } else if (applicableRule.key === 'preferSecondPeriod') {
          scoreVector.push(({ 2: 5, 3: 4, 4: 3, 5: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0)
        } else {
          scoreVector.push(({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0)
        }
        continue
      }

      scoreVector.push(0)
    }

    scoreVector.push(params.pairConstraintPreferred ? 1 : 0)
    scoreVector.push(regularTeacherIds.has(params.teacher.id) ? 1 : 0)
    scoreVector.push(Math.max(0, 4 - params.existingLessons.length))

    return scoreVector
  }

  const findBestLectureAutoAssignCandidate = (params: {
    sourceWeeks: SlotCell[][]
    pendingItems: LectureStockPendingItem[]
    managedStudent: StudentRow
    studentKey: string
  }) => {
    const studentUnavailableSlots = studentUnavailableSlotsById.get(params.managedStudent.id) ?? new Set<string>()
    let bestCandidate: LectureAutoAssignCandidate | null = null

    for (let nextWeekIndex = 0; nextWeekIndex < params.sourceWeeks.length; nextWeekIndex += 1) {
      const week = params.sourceWeeks[nextWeekIndex]
      for (const cell of week) {
        const studentGradeOnDate = resolveSchoolGradeLabel(params.managedStudent.birthDate, parseDateKey(cell.dateKey))
        const forbidFirstPeriod = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('forbidFirstPeriod'), params.managedStudent.id, studentGradeOnDate)
        const subjectCapableTeachersOnly = isSubjectCapabilityConstraintApplicable(autoAssignRuleByKey, params.managedStudent.id, studentGradeOnDate)
        const regularTeachersOnly = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('regularTeachersOnly'), params.managedStudent.id, studentGradeOnDate)
        if (!cell.isOpenDay) continue
        if (!isActiveOnDate(params.managedStudent.entryDate, params.managedStudent.withdrawDate, params.managedStudent.isHidden, cell.dateKey)) continue
        if (findDuplicateStudentInCell(cell, params.studentKey)) continue

        const existingLessons = collectStudentLessonsOnDate(params.sourceWeeks, params.studentKey, cell.dateKey)
        const lessonLimit = resolveApplicableLessonLimit(autoAssignRuleByKey, params.managedStudent.id, studentGradeOnDate)
        const lessonLimitSatisfied = lessonLimit === null || existingLessons.length < lessonLimit

        const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(params.managedStudent.id, cell.dateKey)
        const slotKey = `${cell.dateKey}_${cell.slotNumber}`

        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          const teacher = resolveManagedTeacherForDesk(desk, cell.dateKey)
          if (!teacher || !desk.teacher.trim()) continue

          for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
            if (desk.lesson?.studentSlots[studentIndex]) continue
            const pairedStudent = desk.lesson?.studentSlots[studentIndex === 0 ? 1 : 0] ?? null
            const pairConstraintPreferred = !isPairConstraintBlocked(teacher.id, params.managedStudent.id, pairedStudent)

            const matchedItem = [...params.pendingItems]
              .filter((item) => {
                if (!isDateWithinRange(cell.dateKey, item.startDate, item.endDate)) return false
                if (studentUnavailableSlots.has(slotKey)) return false
                if ((item.unavailableSlots ?? []).includes(slotKey)) return false
                return true
              })
              .sort((left, right) => {
                const leftCapable = canTeacherHandleStudentSubject(teacher, left.subject, studentGradeOnDate)
                const rightCapable = canTeacherHandleStudentSubject(teacher, right.subject, studentGradeOnDate)
                if (leftCapable !== rightCapable) return leftCapable ? -1 : 1
                const leftPriority = left.source === 'session' ? 0 : 1
                const rightPriority = right.source === 'session' ? 0 : 1
                if (leftPriority !== rightPriority) return leftPriority - rightPriority
                const leftEnd = left.endDate ?? '9999-12-31'
                const rightEnd = right.endDate ?? '9999-12-31'
                const endCompare = leftEnd.localeCompare(rightEnd)
                if (endCompare !== 0) return endCompare
                return left.subject.localeCompare(right.subject, 'ja')
              })[0] ?? null

            if (!matchedItem) continue

            const firstPeriodPreferred = !forbidFirstPeriod || cell.slotNumber !== 1
            const subjectCapablePreferred = !subjectCapableTeachersOnly || canTeacherHandleStudentSubject(teacher, matchedItem.subject, studentGradeOnDate)
            const regularTeacherPreferred = !regularTeachersOnly || regularTeacherIds.has(teacher.id)

            const scoreVector: number[] = [
              matchedItem.source === 'session' ? 1 : 0,
              ...buildForcedConstraintScoreVector({
                firstPeriodPreferred,
                subjectCapablePreferred,
                regularTeacherPreferred,
              }),
              ...buildCommonAutoAssignScoreVector({
                studentId: params.managedStudent.id,
                studentGradeOnDate,
                cell,
                teacher,
                pairedStudent,
                existingLessons,
                lessonLimitSatisfied,
                pairConstraintPreferred,
              }),
              buildDatePriorityScore(cell.dateKey),
              matchedItem.endDate ? 99999999 - Number(matchedItem.endDate.replace(/-/g, '')) : 0,
            ]

            const nextCandidate: LectureAutoAssignCandidate = {
              weekIndex: nextWeekIndex,
              cell,
              deskIndex,
              studentIndex,
              desk,
              teacher,
              matchedItem,
              scoreVector,
            }

            if (!bestCandidate) {
              bestCandidate = nextCandidate
              continue
            }

            const scoreCompare = compareScoreVectors(bestCandidate.scoreVector, nextCandidate.scoreVector)
            if (scoreCompare > 0) {
              bestCandidate = nextCandidate
              continue
            }
            if (scoreCompare < 0) continue

            const dateCompare = nextCandidate.cell.dateKey.localeCompare(bestCandidate.cell.dateKey)
            if (dateCompare < 0) {
              bestCandidate = nextCandidate
              continue
            }
            if (dateCompare > 0) continue
            if (nextCandidate.cell.slotNumber < bestCandidate.cell.slotNumber) {
              bestCandidate = nextCandidate
              continue
            }
            if (nextCandidate.cell.slotNumber > bestCandidate.cell.slotNumber) continue
            if (nextCandidate.deskIndex < bestCandidate.deskIndex) {
              bestCandidate = nextCandidate
              continue
            }
            if (nextCandidate.deskIndex > bestCandidate.deskIndex) continue
            if (nextCandidate.studentIndex < bestCandidate.studentIndex) {
              bestCandidate = nextCandidate
            }
          }
        }
      }
    }

    return bestCandidate
  }

  const findBestMakeupAutoAssignCandidate = (params: {
    sourceWeeks: SlotCell[][]
    pendingItems: MakeupAutoAssignPendingItem[]
    managedStudent: StudentRow
    studentKey: string
  }) => {
    const studentUnavailableSlots = studentUnavailableSlotsById.get(params.managedStudent.id) ?? new Set<string>()
    let bestCandidate: MakeupAutoAssignCandidate | null = null

    for (let nextWeekIndex = 0; nextWeekIndex < params.sourceWeeks.length; nextWeekIndex += 1) {
      const week = params.sourceWeeks[nextWeekIndex]
      for (const cell of week) {
        const studentGradeOnDate = resolveSchoolGradeLabel(params.managedStudent.birthDate, parseDateKey(cell.dateKey))
        const forbidFirstPeriod = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('forbidFirstPeriod'), params.managedStudent.id, studentGradeOnDate)
        const subjectCapableTeachersOnly = isSubjectCapabilityConstraintApplicable(autoAssignRuleByKey, params.managedStudent.id, studentGradeOnDate)
        const regularTeachersOnly = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('regularTeachersOnly'), params.managedStudent.id, studentGradeOnDate)
        if (!cell.isOpenDay) continue
        if (!isActiveOnDate(params.managedStudent.entryDate, params.managedStudent.withdrawDate, params.managedStudent.isHidden, cell.dateKey)) continue
        if (findDuplicateStudentInCell(cell, params.studentKey)) continue

        const existingLessons = collectStudentLessonsOnDate(params.sourceWeeks, params.studentKey, cell.dateKey)
        const lessonLimit = resolveApplicableLessonLimit(autoAssignRuleByKey, params.managedStudent.id, studentGradeOnDate)
        const lessonLimitSatisfied = lessonLimit === null || existingLessons.length < lessonLimit

        const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(params.managedStudent.id, cell.dateKey)
        const slotKey = `${cell.dateKey}_${cell.slotNumber}`
        if (studentUnavailableSlots.has(slotKey)) continue

        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          const teacher = resolveManagedTeacherForDesk(desk, cell.dateKey)
          if (!teacher || !desk.teacher.trim()) continue

          for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
            if (desk.lesson?.studentSlots[studentIndex]) continue
            const pairedStudent = desk.lesson?.studentSlots[studentIndex === 0 ? 1 : 0] ?? null
            const pairConstraintPreferred = !isPairConstraintBlocked(teacher.id, params.managedStudent.id, pairedStudent)

            const matchedItem = [...params.pendingItems]
              .sort((left, right) => {
                const leftCapable = canTeacherHandleStudentSubject(teacher, left.subject, studentGradeOnDate)
                const rightCapable = canTeacherHandleStudentSubject(teacher, right.subject, studentGradeOnDate)
                if (leftCapable !== rightCapable) return leftCapable ? -1 : 1
                const leftOrigin = left.makeupSourceDate ?? '9999-12-31'
                const rightOrigin = right.makeupSourceDate ?? '9999-12-31'
                const originCompare = leftOrigin.localeCompare(rightOrigin)
                if (originCompare !== 0) return originCompare
                return left.subject.localeCompare(right.subject, 'ja')
              })[0] ?? null
            if (!matchedItem) continue

            const firstPeriodPreferred = !forbidFirstPeriod || cell.slotNumber !== 1
            const subjectCapablePreferred = !subjectCapableTeachersOnly || canTeacherHandleStudentSubject(teacher, matchedItem.subject, studentGradeOnDate)
            const regularTeacherPreferred = !regularTeachersOnly || regularTeacherIds.has(teacher.id)

            const scoreVector: number[] = [
              matchedItem.makeupSourceDate ? 1 : 0,
              ...buildForcedConstraintScoreVector({
                firstPeriodPreferred,
                subjectCapablePreferred,
                regularTeacherPreferred,
              }),
              ...buildCommonAutoAssignScoreVector({
                studentId: params.managedStudent.id,
                studentGradeOnDate,
                cell,
                teacher,
                pairedStudent,
                existingLessons,
                lessonLimitSatisfied,
                pairConstraintPreferred,
              }),
              buildDatePriorityScore(cell.dateKey),
              matchedItem.makeupSourceDate ? 99999999 - Number(matchedItem.makeupSourceDate.replace(/-/g, '')) : 0,
            ]

            const nextCandidate: MakeupAutoAssignCandidate = {
              weekIndex: nextWeekIndex,
              cell,
              deskIndex,
              studentIndex,
              desk,
              teacher,
              matchedItem,
              scoreVector,
            }

            if (!bestCandidate) {
              bestCandidate = nextCandidate
              continue
            }

            const scoreCompare = compareScoreVectors(bestCandidate.scoreVector, nextCandidate.scoreVector)
            if (scoreCompare > 0) {
              bestCandidate = nextCandidate
              continue
            }
            if (scoreCompare < 0) continue

            const dateCompare = nextCandidate.cell.dateKey.localeCompare(bestCandidate.cell.dateKey)
            if (dateCompare < 0) {
              bestCandidate = nextCandidate
              continue
            }
            if (dateCompare > 0) continue
            if (nextCandidate.cell.slotNumber < bestCandidate.cell.slotNumber) {
              bestCandidate = nextCandidate
              continue
            }
            if (nextCandidate.cell.slotNumber > bestCandidate.cell.slotNumber) continue
            if (nextCandidate.deskIndex < bestCandidate.deskIndex) {
              bestCandidate = nextCandidate
              continue
            }
            if (nextCandidate.deskIndex > bestCandidate.deskIndex) continue
            if (nextCandidate.studentIndex < bestCandidate.studentIndex) {
              bestCandidate = nextCandidate
            }
          }
        }
      }
    }

    return bestCandidate
  }

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

  const studentPlannedScheduleCells = useMemo(() => buildManagedScheduleCellsForRange({
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

  const teacherPlannedScheduleCells = useMemo(() => buildManagedScheduleCellsForRange({
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
      plannedCells: studentPlannedScheduleCells,
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
  }, [classroomSettings, effectiveStudentScheduleRange.endDate, effectiveStudentScheduleRange.periodValue, effectiveStudentScheduleRange.startDate, scheduleQrConfig, specialSessions, studentPlannedScheduleCells, studentScheduleCells, studentScheduleTitle, students])

  useEffect(() => {
    syncTeacherScheduleHtml({
      cells: teacherScheduleCells,
      plannedCells: teacherPlannedScheduleCells,
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
  }, [classroomSettings, effectiveTeacherScheduleRange.endDate, effectiveTeacherScheduleRange.periodValue, effectiveTeacherScheduleRange.startDate, scheduleQrConfig, specialSessions, teacherPlannedScheduleCells, teacherScheduleCells, teacherScheduleTitle, teachers])

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

  const emptyMenuContext = useMemo(() => {
    if (!studentMenu || (studentMenu.mode !== 'empty' && studentMenu.mode !== 'add' && studentMenu.mode !== 'memo')) return null
    const targetCell = cells.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetCell || !targetDesk) return null
    return { cell: targetCell, desk: targetDesk }
  }, [cells, studentMenu])

  const addableStudents = useMemo(() => {
    if (!emptyMenuContext) return []
    return students
      .filter((student) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, emptyMenuContext.cell.dateKey))
      .map((student) => ({
        id: student.id,
        displayName: getStudentDisplayName(student),
        student,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ja'))
  }, [emptyMenuContext, students])

  const selectedAddStudent = useMemo(() => {
    if (!addExistingStudentDraft) return null
    return addableStudents.find((entry) => entry.id === addExistingStudentDraft.studentId)?.student ?? null
  }, [addExistingStudentDraft, addableStudents])

  const addableSubjects = useMemo(() => {
    if (!emptyMenuContext) return editableSubjects
    return getSelectableSubjectsForStudent(selectedAddStudent, emptyMenuContext.cell.dateKey)
  }, [emptyMenuContext, selectedAddStudent])

  const addableSpecialSessions = useMemo(() => {
    if (!emptyMenuContext) return []
    return specialSessions
      .filter((session) => emptyMenuContext.cell.dateKey >= session.startDate && emptyMenuContext.cell.dateKey <= session.endDate)
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.label.localeCompare(right.label, 'ja'))
  }, [emptyMenuContext, specialSessions])

  const resolveBoardStudentConstraintWarning = useCallback((student: StudentEntry, cell: SlotCell, desk: DeskCell, studentIndex: number) => {
    const reasons: string[] = []
    let hasConstraintReason = false
    if (student.warning) reasons.push(student.warning)
    if (student.manualAdded) reasons.push('手動追加')

    const managedStudent = student.managedStudentId
      ? students.find((entry) => entry.id === student.managedStudentId) ?? managedStudentByRegisteredName.get(student.name) ?? null
      : managedStudentByRegisteredName.get(student.name) ?? null
    const studentGradeOnDate: GradeLabel = student.birthDate
      ? resolveSchoolGradeLabel(student.birthDate, parseDateKey(cell.dateKey))
      : student.grade
    const teacher = resolveManagedTeacherForDesk(desk, cell.dateKey)
    const pairedStudent = desk.lesson?.studentSlots[studentIndex === 0 ? 1 : 0] ?? null
    const slotKey = `${cell.dateKey}_${cell.slotNumber}`

    if (desk.teacher.trim() && !teacher) {
      reasons.push('データ不整合: 講師データ不一致')
      hasConstraintReason = true
    }

    if (teacher && managedStudent && isSubjectCapabilityConstraintApplicable(autoAssignRuleByKey, managedStudent.id, studentGradeOnDate) && !canTeacherHandleStudentSubject(teacher, student.subject, studentGradeOnDate)) {
      reasons.push('強制制約: 科目対応講師のみ')
      hasConstraintReason = true
    }

    if (managedStudent) {
      if (isAutoAssignRuleApplicable(autoAssignRuleByKey.get('forbidFirstPeriod'), managedStudent.id, studentGradeOnDate) && cell.slotNumber === 1) {
        reasons.push('強制制約: 1限禁止')
        hasConstraintReason = true
      }

      const regularTeachersOnly = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('regularTeachersOnly'), managedStudent.id, studentGradeOnDate)
      const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(managedStudent.id, cell.dateKey)
      if (regularTeachersOnly && (!teacher || !regularTeacherIds.has(teacher.id))) {
        reasons.push('強制制約: 通常講師のみ')
        hasConstraintReason = true
      }

      const twoStudentsRuleApplied = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('preferTwoStudentsPerTeacher'), managedStudent.id, studentGradeOnDate)
      if (twoStudentsRuleApplied && !pairedStudent) {
        reasons.push('制約: 講師1人に生徒2人配置')
        hasConstraintReason = true
      }

      const lessonLimit = resolveApplicableLessonLimit(autoAssignRuleByKey, managedStudent.id, studentGradeOnDate)
      const comparableStudentKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
      const sameDayLessons = collectStudentLessonsOnDate(normalizedWeeks, comparableStudentKey, cell.dateKey)
      if (lessonLimit !== null && sameDayLessons.length > lessonLimit) {
        reasons.push(`制約: 同日${lessonLimit}コマ上限`)
        hasConstraintReason = true
      }

      const lessonPatternRule = lectureConstraintGroups
        .find((group) => group.key === 'lesson-pattern')
        ?.ruleKeys
        .map((ruleKey) => autoAssignRuleByKey.get(ruleKey))
        .find((rule) => isAutoAssignRuleApplicable(rule, managedStudent.id, studentGradeOnDate))
      if (lessonPatternRule) {
        const isAdjacentToAnyLesson = sameDayLessons.some((lesson) => Math.abs(lesson.slotNumber - cell.slotNumber) === 1)
        const hasOneSlotBreak = sameDayLessons.some((lesson) => Math.abs(lesson.slotNumber - cell.slotNumber) === 2)
        const isAdjacentToRegularLesson = sameDayLessons.some((lesson) => lesson.lessonType === 'regular' && Math.abs(lesson.slotNumber - cell.slotNumber) === 1)
        if (lessonPatternRule.key === 'allowTwoConsecutiveLessons' && !isAdjacentToAnyLesson) {
          reasons.push('制約: 2コマ連続')
          hasConstraintReason = true
        }
        if (lessonPatternRule.key === 'requireBreakBetweenLessons' && !hasOneSlotBreak) {
          reasons.push('制約: 一コマ空け')
          hasConstraintReason = true
        }
        if (lessonPatternRule.key === 'connectRegularLessons' && !isAdjacentToRegularLesson) {
          reasons.push('制約: 通常連結2コマ')
          hasConstraintReason = true
        }
      }

      const unavailableSlots = studentUnavailableSlotsById.get(managedStudent.id)
      if (unavailableSlots?.has(slotKey)) {
        reasons.push('絶対制約: 出席可能コマのみ')
        hasConstraintReason = true
      }

      if (teacher && isPairConstraintBlocked(teacher.id, managedStudent.id, pairedStudent)) {
        reasons.push('制約: 組み合わせ不可')
        hasConstraintReason = true
      }
    }

    if (student.lessonType === 'special') {
      const session = resolveSpecialSessionById(student.specialSessionId)
      if (session && (cell.dateKey < session.startDate || cell.dateKey > session.endDate)) {
        reasons.push('絶対制約: 講習期間内割振')
        hasConstraintReason = true
      }
    }

    const uniqueReasons = Array.from(new Set(reasons.filter(Boolean)))
    if (uniqueReasons.length === 0) return undefined
    return hasConstraintReason ? ['制約違反', ...uniqueReasons].join('\n') : uniqueReasons.join('\n')
  }, [autoAssignRuleByKey, collectStudentLessonsOnDate, isPairConstraintBlocked, lectureConstraintGroups, managedStudentByRegisteredName, normalizedWeeks, resolveBoardStudentDisplayName, resolveBoardStudentGradeLabel, resolveManagedTeacherForDesk, specialSessions, studentUnavailableSlotsById, students])

  const displayCells = useMemo(() => cells.map((cell) => ({
    ...cell,
    desks: cell.desks.map((desk) => ({
      ...desk,
      lesson: desk.lesson
        ? {
            ...desk.lesson,
            studentSlots: desk.lesson.studentSlots.map((student, studentIndex) => (student
              ? {
                  ...student,
                  warning: resolveBoardStudentConstraintWarning(student, cell, desk, studentIndex),
                }
              : null)) as [StudentEntry | null, StudentEntry | null],
          }
        : undefined,
    })),
  })), [cells, resolveBoardStudentConstraintWarning])

  useEffect(() => {
    if (studentMenu?.mode !== 'add') return
    if (addableStudents.length === 0) {
      setAddExistingStudentDraft(null)
      return
    }

    setAddExistingStudentDraft((current) => {
      const fallbackStudent = addableStudents[0]
      const studentId = current && addableStudents.some((entry) => entry.id === current.studentId)
        ? current.studentId
        : fallbackStudent.id
      const resolvedStudent = addableStudents.find((entry) => entry.id === studentId)?.student ?? fallbackStudent.student
      const subjectOptions = getSelectableSubjectsForStudent(resolvedStudent, emptyMenuContext?.cell.dateKey ?? displayWeekDate)
      const subject = current && subjectOptions.includes(current.subject)
        ? current.subject
        : subjectOptions[0]
      const specialSessionId = current && addableSpecialSessions.some((session) => session.id === current.specialSessionId)
        ? current.specialSessionId
        : (addableSpecialSessions[0]?.id ?? '')

      return {
        studentId,
        subject,
        lessonType: current?.lessonType ?? 'regular',
        specialSessionId,
      }
    })
  }, [addableSpecialSessions, addableStudents, displayWeekDate, emptyMenuContext, getSelectableSubjectsForStudent, studentMenu])

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

    if (selectedLectureStockEntry) {
      const subject = selectedLecturePlacementItem?.subject ?? selectedLectureStockEntry.nextPlacementEntry?.subject ?? '科目未設定'
      return `${selectedLectureStockEntry.displayName} / ${subject} / 講習ストックの配置先を選択中`
    }

    if (movingStudentContext) {
      const previewSlotLabel = movingStudentContext.student.lessonType === 'makeup'
        ? (movingStudentContext.student.makeupSourceLabel
          ?? (movingStudentContext.student.makeupSourceDate
            ? formatStockOriginLabel(movingStudentContext.student.makeupSourceDate, parseOriginSlotNumber(movingStudentContext.student.makeupSourceLabel) ?? movingStudentContext.cell.slotNumber)
            : `${movingStudentContext.cell.dateLabel} ${movingStudentContext.cell.slotLabel}`))
        : `${movingStudentContext.cell.dateLabel} ${movingStudentContext.cell.slotLabel}`
      return `${resolveBoardStudentDisplayName(movingStudentContext.student.name)} / ${movingStudentContext.student.subject} / ${previewSlotLabel} を移動中`
    }

    return null
  }, [movingStudentContext, resolveBoardStudentDisplayName, selectedLecturePlacementItem, selectedLectureStockEntry, selectedMakeupStockEntry])

  const isBoardInteractionLocked = interactionLockOwner !== null && interactionLockOwner !== 'board'
  const boardInteractionLockMessage = isBoardInteractionLocked
    ? `${getInteractionSurfaceLabel(interactionLockOwner)} を操作中です。この画面をクリックするとコマ表の操作へ切り替わります。`
    : ''

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

    const estimatedHeight = studentMenu.mode === 'add' ? 520 : studentMenu.mode === 'empty' ? 180 : studentMenu.mode === 'memo' ? 360 : 340
    return {
      left: Math.max(12, Math.min(studentMenu.x + 10, window.innerWidth - 336)),
      top: Math.max(12, Math.min(studentMenu.y + 10, window.innerHeight - estimatedHeight - 12)),
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
    sourceSuppressedMakeupOrigins: MakeupOriginMap,
    sourceFallbackMakeupStudents: Record<string, FallbackMakeupStudent>,
    sourceManualLectureStockCounts: LectureStockCountMap,
    sourceManualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]>,
    sourceFallbackLectureStockStudents: Record<string, { displayName: string }>,
  ): HistoryEntry => ({
    weeks: cloneWeeks(sourceWeeks),
    weekIndex: sourceWeekIndex,
    selectedCellId: sourceCellId,
    selectedDeskIndex: sourceDeskIndex,
    holidayDates: [...sourceHolidayDates],
    forceOpenDates: [...sourceForceOpenDates],
    manualMakeupAdjustments: cloneOriginMap(sourceManualMakeupAdjustments),
    suppressedMakeupOrigins: cloneOriginMap(sourceSuppressedMakeupOrigins),
    fallbackMakeupStudents: { ...sourceFallbackMakeupStudents },
    manualLectureStockCounts: { ...sourceManualLectureStockCounts },
    manualLectureStockOrigins: cloneManualLectureStockOrigins(sourceManualLectureStockOrigins),
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
    nextSuppressedMakeupOrigins: MakeupOriginMap = suppressedMakeupOrigins,
    nextFallbackMakeupStudents: Record<string, FallbackMakeupStudent> = fallbackMakeupStudents,
    nextManualLectureStockCounts: LectureStockCountMap = manualLectureStockCounts,
    nextManualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]> = manualLectureStockOrigins,
    nextFallbackLectureStockStudents: Record<string, { displayName: string }> = fallbackLectureStockStudents,
  ) => {
    setUndoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedMakeupOrigins(cloneOriginMap(nextSuppressedMakeupOrigins))
    setFallbackMakeupStudents(nextFallbackMakeupStudents)
    setManualLectureStockCounts({ ...nextManualLectureStockCounts })
    setManualLectureStockOrigins(cloneManualLectureStockOrigins(nextManualLectureStockOrigins))
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

    const matchedTeacher = targetDesk.teacherAssignmentTeacherId
      ? teachers.find((teacher) => teacher.id === targetDesk.teacherAssignmentTeacherId)
      : teachers.find((teacher) => teacher.name === targetDesk.teacher)

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
    const currentTeacherMenu = teacherMenu
    if (!currentTeacherMenu || !teacherMenuContext) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === currentTeacherMenu.cellId)
    const targetDesk = targetCell?.desks[currentTeacherMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    if (targetDesk.teacher === currentTeacherMenu.selectedTeacherName) {
      setTeacherMenu(null)
      setStatusMessage('講師設定は変更されませんでした。')
      return
    }

    const selectedTeacher = teacherOptions.find((option) => option.name === currentTeacherMenu.selectedTeacherName)
    setManualTeacherAssignment(targetDesk, currentTeacherMenu.selectedTeacherName, selectedTeacher?.id)
    commitWeeks(nextWeeks, weekIndex, currentTeacherMenu.cellId, currentTeacherMenu.deskIndex)
    setTeacherMenu(null)
    setStatusMessage(currentTeacherMenu.selectedTeacherName
      ? `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, currentTeacherMenu.deskIndex)} の講師を ${currentTeacherMenu.selectedTeacherName} に設定しました。`
      : `${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, currentTeacherMenu.deskIndex)} の講師を未設定にしました。`)
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
    let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(manualLectureStockOrigins)
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
              if (student.specialStockSource === 'session') {
                const lectureStudentKey = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
                const lectureStockKey = buildLectureStockKey(lectureStudentKey, student.subject)
                nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, lectureStockKey)
                nextManualLectureStockOrigins = appendManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, {
                  displayName: resolveBoardStudentDisplayName(student.name),
                  sessionId: student.specialSessionId,
                })
                if (!managedStudentByAnyName.get(student.name)) {
                  nextFallbackLectureStockStudents[lectureStockKey] = {
                    displayName: resolveBoardStudentDisplayName(student.name),
                    subject: student.subject,
                  }
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
      suppressedMakeupOrigins,
      nextFallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
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
    if (stockPanelsRestoreState && selectedMakeupStockEntry.balance <= 1) {
      setIsLectureStockOpen(stockPanelsRestoreState.lecture)
      setIsMakeupStockOpen(stockPanelsRestoreState.makeup)
      setStockPanelsRestoreState(null)
    } else if (!stockPanelsRestoreState) {
      setIsMakeupStockOpen(true)
    }
    setSelectedMakeupStockKey(selectedMakeupStockEntry.balance > 1 ? selectedMakeupStockEntry.key : null)
    setStatusMessage(`${selectedMakeupStockEntry.displayName} の振替を ${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} に追加しました。`)
  }

  const handlePlaceLectureFromStock = (cellId: string, deskIndex: number, studentIndex: number) => {
    if (!selectedLectureStockEntry) return
    if (selectedLectureStockEntry.requestedCount <= 0) {
      setStatusMessage('この講習ストックは残数がありません。')
      return
    }
    const placementEntry = buildLecturePendingItems(selectedLectureStockEntry)[0] ?? null
    if (!placementEntry) {
      setStatusMessage('この講習ストックは配置できる科目残数がありません。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === cellId)
    const targetDesk = targetCell?.desks[deskIndex]
    if (!targetCell || !targetDesk) return

    if (!isDateWithinRange(targetCell.dateKey, placementEntry.startDate, placementEntry.endDate)) {
      setStatusMessage(`${placementEntry.sessionLabel ?? 'この講習'} の期間外には配置できません。`)
      return
    }

    if (targetDesk.lesson?.studentSlots[studentIndex]) {
      setStatusMessage('クリックした移動先は埋まっています。空欄の生徒マスを選んでください。')
      return
    }

    const comparableStudentKey = selectedLectureStockEntry.studentId ?? `name:${selectedLectureStockEntry.displayName}`
    const duplicateStudent = findDuplicateStudentInCell(targetCell, comparableStudentKey)
    if (duplicateStudent) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているため講習配置不可です。`)
      return
    }

    const managedStudent = selectedLectureStockEntry.studentId ? students.find((student) => student.id === selectedLectureStockEntry.studentId) : null
    const studentName = managedStudent ? getStudentDisplayName(managedStudent) : selectedLectureStockEntry.displayName
    const studentGrade = managedStudent?.birthDate ? resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(targetCell.dateKey)) : '中1'
    const nextStudent: StudentEntry = {
      id: createStudentId(cellId, deskIndex, studentIndex),
      name: studentName,
      managedStudentId: managedStudent?.id,
      grade: studentGrade,
      birthDate: managedStudent?.birthDate,
      subject: placementEntry.subject,
      lessonType: 'special',
      teacherType: 'normal',
      specialSessionId: placementEntry.sessionId,
        specialStockSource: placementEntry.source,
    }

    if (!targetDesk.lesson) {
      targetDesk.lesson = {
        id: `${cellId}_desk_${deskIndex + 1}_special`,
        studentSlots: [null, null],
      }
    }

    targetDesk.lesson.studentSlots[studentIndex] = nextStudent
    const lectureStockStudentKey = selectedLectureStockEntry.studentId ?? `name:${selectedLectureStockEntry.displayName}`
    const nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, buildLectureStockKey(lectureStockStudentKey, placementEntry.subject), -1)
    const nextManualLectureStockOrigins = placementEntry.sessionId
      ? consumeManualLectureStockOrigin(manualLectureStockOrigins, buildLectureStockKey(lectureStockStudentKey, placementEntry.subject), { sessionId: placementEntry.sessionId })
      : consumeManualLectureStockOrigin(manualLectureStockOrigins, buildLectureStockKey(lectureStockStudentKey, placementEntry.subject))
    commitWeeks(
      nextWeeks,
      weekIndex,
      cellId,
      deskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      suppressedMakeupOrigins,
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      fallbackLectureStockStudents,
    )
    if (stockPanelsRestoreState && selectedLectureStockEntry.requestedCount <= 1) {
      setIsLectureStockOpen(stockPanelsRestoreState.lecture)
      setIsMakeupStockOpen(stockPanelsRestoreState.makeup)
      setStockPanelsRestoreState(null)
    } else if (!stockPanelsRestoreState) {
      setIsLectureStockOpen(true)
    }
    setSelectedLectureStockKey(selectedLectureStockEntry.requestedCount > 1 ? selectedLectureStockEntry.key : null)
    setStatusMessage(`${selectedLectureStockEntry.displayName} の講習 ${placementEntry.subject} を ${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} に追加しました。`)
  }

  const handleAutoAssignLectureStockEntry = (entry: GroupedLectureStockEntry) => {
    if (entry.requestedCount <= 0) {
      setStatusMessage(`${entry.displayName} の講習ストックは残数がありません。`)
      return
    }
    if (!entry.studentId) {
      setStatusMessage(`${entry.displayName} は基本データの生徒と未連携のため、自動割振できません。`)
      return
    }

    const managedStudent = students.find((student) => student.id === entry.studentId)
    if (!managedStudent) {
      setStatusMessage(`${entry.displayName} の生徒情報が見つからないため、自動割振できません。`)
      return
    }

    const pendingItems = buildLecturePendingItems(entry)
    if (pendingItems.length === 0) {
      setStatusMessage(`${entry.displayName} の講習ストックに割振対象がありません。`)
      return
    }

    let nextWeeks = cloneWeeks(normalizedWeeks)
    let weekIndexOffset = 0
    const sessionItems = pendingItems.filter((item) => item.startDate && item.endDate)
    if (sessionItems.length > 0) {
      const coveredWeeks = ensureWeeksCoverDateRange({
        weeks: nextWeeks,
        startDate: sessionItems.reduce((currentMin, item) => (item.startDate && item.startDate < currentMin ? item.startDate : currentMin), sessionItems[0]!.startDate!),
        endDate: sessionItems.reduce((currentMax, item) => (item.endDate && item.endDate > currentMax ? item.endDate : currentMax), sessionItems[0]!.endDate!),
        classroomSettings,
        teachers,
        students,
        regularLessons,
      })
      nextWeeks = applyClassroomAvailability(coveredWeeks.weeks, classroomSettings)
      weekIndexOffset = coveredWeeks.weekIndexOffset
    }

    let nextManualLectureStockCounts = manualLectureStockCounts
    let nextManualLectureStockOrigins = manualLectureStockOrigins
    const remainingItems = [...pendingItems]
    const placedItems: Array<{ dateLabel: string; slotLabel: string; deskLabel: string }> = []
    const studentKey = entry.studentId

    while (remainingItems.length > 0) {
      const candidate = findBestLectureAutoAssignCandidate({
        sourceWeeks: nextWeeks,
        pendingItems: remainingItems,
        managedStudent,
        studentKey,
      })
      if (!candidate) break

      const targetCell = nextWeeks[candidate.weekIndex]?.find((cell) => cell.id === candidate.cell.id)
      const targetDesk = targetCell?.desks[candidate.deskIndex]
      if (!targetCell || !targetDesk) break

      const studentGrade = resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(targetCell.dateKey))
      const nextStudent: StudentEntry = {
        id: createStudentId(targetCell.id, candidate.deskIndex, candidate.studentIndex),
        name: getStudentDisplayName(managedStudent),
        managedStudentId: managedStudent.id,
        grade: studentGrade,
        birthDate: managedStudent.birthDate,
        subject: candidate.matchedItem.subject,
        lessonType: 'special',
        teacherType: 'normal',
        specialSessionId: candidate.matchedItem.sessionId,
        specialStockSource: candidate.matchedItem.source,
      }

      if (!targetDesk.lesson) {
        targetDesk.lesson = {
          id: `${targetCell.id}_desk_${candidate.deskIndex + 1}_special`,
          studentSlots: [null, null],
        }
      }

      targetDesk.lesson.studentSlots[candidate.studentIndex] = nextStudent
      nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, buildLectureStockKey(studentKey, candidate.matchedItem.subject), -1)
      nextManualLectureStockOrigins = candidate.matchedItem.sessionId
        ? consumeManualLectureStockOrigin(nextManualLectureStockOrigins, buildLectureStockKey(studentKey, candidate.matchedItem.subject), { sessionId: candidate.matchedItem.sessionId })
        : consumeManualLectureStockOrigin(nextManualLectureStockOrigins, buildLectureStockKey(studentKey, candidate.matchedItem.subject))
      const pendingIndex = remainingItems.indexOf(candidate.matchedItem)
      if (pendingIndex >= 0) remainingItems.splice(pendingIndex, 1)

      placedItems.push({
        dateLabel: targetCell.dateLabel,
        slotLabel: targetCell.slotLabel,
        deskLabel: resolveDeskLabel(targetDesk, candidate.deskIndex),
      })
    }

    if (placedItems.length === 0) {
      setStatusMessage(`${entry.displayName} は条件に合う空きコマが見つからず、自動割振できませんでした。`)
      return
    }

    commitWeeks(
      nextWeeks,
      weekIndex + weekIndexOffset,
      selectedCellId,
      selectedDeskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      suppressedMakeupOrigins,
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      fallbackLectureStockStudents,
    )
    setIsLectureStockOpen(true)
    setSelectedLectureStockKey(remainingItems.length > 0 ? entry.key : null)
    setStatusMessage(
      `${entry.displayName} を自動割振しました。${placedItems.length}コマ配置しました。`
      + (remainingItems.length > 0 ? ` ${remainingItems.length}コマは候補不足でストックに残しています。` : ''),
    )
  }

  const handleAutoAssignMakeupStockEntry = (entry: GroupedMakeupStockEntry) => {
    if (entry.balance <= 0) {
      setStatusMessage(`${entry.displayName} は先取り済みのため、自動割振できません。`)
      return
    }
    if (!entry.studentId) {
      setStatusMessage(`${entry.displayName} は基本データの生徒と未連携のため、自動割振できません。`)
      return
    }

    const managedStudent = students.find((student) => student.id === entry.studentId)
    if (!managedStudent) {
      setStatusMessage(`${entry.displayName} の生徒情報が見つからないため、自動割振できません。`)
      return
    }

    const pendingItems = buildMakeupPendingItems(entry)
    if (pendingItems.length === 0) {
      setStatusMessage(`${entry.displayName} の振替ストックに割振対象がありません。`)
      return
    }

    let nextWeeks = cloneWeeks(normalizedWeeks)
    let weekIndexOffset = 0
    if (makeupAutoAssignRange.startDate && makeupAutoAssignRange.endDate && makeupAutoAssignRange.startDate <= makeupAutoAssignRange.endDate) {
      const coveredWeeks = ensureWeeksCoverDateRange({
        weeks: nextWeeks,
        startDate: makeupAutoAssignRange.startDate,
        endDate: makeupAutoAssignRange.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
      })
      nextWeeks = applyClassroomAvailability(coveredWeeks.weeks, classroomSettings)
      weekIndexOffset = coveredWeeks.weekIndexOffset
    }
    const remainingItems = [...pendingItems]
    const placedItems: Array<{ dateLabel: string; slotLabel: string; deskLabel: string }> = []

    while (remainingItems.length > 0) {
      const candidate = findBestMakeupAutoAssignCandidate({
        sourceWeeks: nextWeeks.map((week) => week.filter((cell) => (
          (!makeupAutoAssignRange.startDate || cell.dateKey >= makeupAutoAssignRange.startDate)
          && (!makeupAutoAssignRange.endDate || cell.dateKey <= makeupAutoAssignRange.endDate)
        ))),
        pendingItems: remainingItems,
        managedStudent,
        studentKey: entry.studentId,
      })
      if (!candidate) break

      const targetCell = nextWeeks[candidate.weekIndex]?.find((cell) => cell.id === candidate.cell.id)
      const targetDesk = targetCell?.desks[candidate.deskIndex]
      if (!targetCell || !targetDesk) break

      const studentGrade = resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(targetCell.dateKey))
      const nextStudent = normalizeLessonPlacement({
        id: createStudentId(targetCell.id, candidate.deskIndex, candidate.studentIndex),
        name: getStudentDisplayName(managedStudent),
        managedStudentId: managedStudent.id,
        grade: studentGrade,
        birthDate: managedStudent.birthDate,
        makeupSourceDate: candidate.matchedItem.makeupSourceDate,
        makeupSourceLabel: candidate.matchedItem.makeupSourceLabel,
        subject: candidate.matchedItem.subject,
        lessonType: 'makeup',
        teacherType: 'normal',
      }, targetCell.dateKey, targetCell.slotNumber)

      if (!targetDesk.lesson) {
        targetDesk.lesson = {
          id: `${targetCell.id}_desk_${candidate.deskIndex + 1}_${nextStudent.lessonType}`,
          note: nextStudent.lessonType === 'makeup' && candidate.matchedItem.makeupSourceLabel
            ? `元の通常授業: ${candidate.matchedItem.makeupSourceLabel}${candidate.matchedItem.makeupSourceReasonLabel ? `（${candidate.matchedItem.makeupSourceReasonLabel}）` : ''}`
            : undefined,
          studentSlots: [null, null],
        }
      }

      targetDesk.lesson.studentSlots[candidate.studentIndex] = nextStudent
      const pendingIndex = remainingItems.indexOf(candidate.matchedItem)
      if (pendingIndex >= 0) remainingItems.splice(pendingIndex, 1)

      placedItems.push({
        dateLabel: targetCell.dateLabel,
        slotLabel: targetCell.slotLabel,
        deskLabel: resolveDeskLabel(targetDesk, candidate.deskIndex),
      })
    }

    if (placedItems.length === 0) {
      setStatusMessage(`${entry.displayName} は条件に合う空きコマが見つからず、自動割振できませんでした。`)
      return
    }

    commitWeeks(nextWeeks, weekIndex + weekIndexOffset, selectedCellId, selectedDeskIndex)
    setIsMakeupStockOpen(true)
    setSelectedMakeupStockKey(remainingItems.length > 0 ? entry.key : null)
    setStatusMessage(
      `${entry.displayName} の振替を自動割振しました。${placedItems.length}コマ配置しました。`
      + (remainingItems.length > 0 ? ` ${remainingItems.length}コマは候補不足でストックに残しています。` : ''),
    )
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
      setSelectedLectureStockKey(null)
      setAddExistingStudentDraft(null)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'root' })
      setStatusMessage('生徒メニューを開きました。')
      return
    }

    if (hasMemo) {
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setSelectedLectureStockKey(null)
      setAddExistingStudentDraft(null)
      setMemoDraft(currentMemo)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'memo' })
      setStatusMessage('メモ編集メニューを開きました。')
      return
    }

    if (selectedMakeupStockEntry) {
      handlePlaceMakeupFromStock(cellId, deskIndex, studentIndex)
      return
    }

    if (selectedLectureStockEntry) {
      handlePlaceLectureFromStock(cellId, deskIndex, studentIndex)
      return
    }

    if (!selectedStudentId) {
      if (targetCell && !targetCell.isOpenDay) {
        setStudentMenu(null)
        setStatusMessage('休校セルにはメモを保存できません。営業日の空欄セルを選んでください。')
        return
      }
      setSelectedStudentId(null)
      setAddExistingStudentDraft(null)
      setMemoDraft(currentMemo)
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'empty' })
      setStatusMessage('空欄メニューを開きました。')
      return
    }

    executeMoveStudent(cellId, deskIndex, studentIndex)
  }

  const handleStartMove = () => {
    if (!menuStudent) return
    setSelectedStudentId(menuStudent.student.id)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(null)
    setIsMakeupStockOpen(false)
    setIsLectureStockOpen(false)
    setStockPanelsRestoreState(null)
    setStudentMenu(null)
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を選択しました。移動先の空欄セルを左クリックしてください。`)
  }

  const handleOpenAddExistingStudent = () => {
    if (!studentMenu || !emptyMenuContext) return
    if (addableStudents.length === 0) {
      setStatusMessage('追加できる在籍生徒が見つかりませんでした。')
      return
    }

    const defaultStudent = addableStudents[0]?.student ?? null
    const defaultSubjects = getSelectableSubjectsForStudent(defaultStudent, emptyMenuContext.cell.dateKey)
    setAddExistingStudentDraft({
      studentId: defaultStudent?.id ?? '',
      subject: defaultSubjects[0] ?? editableSubjects[0],
      lessonType: 'regular',
      specialSessionId: addableSpecialSessions[0]?.id ?? '',
    })
    setStudentMenu({ ...studentMenu, mode: 'add' })
    setStatusMessage('既存生徒追加メニューを開きました。')
  }

  const handleSaveAddedStudent = () => {
    if (!studentMenu || studentMenu.mode !== 'add' || !emptyMenuContext || !addExistingStudentDraft) return

    const managedStudent = students.find((student) => student.id === addExistingStudentDraft.studentId)
    if (!managedStudent) {
      setStatusMessage('追加対象の生徒が見つかりませんでした。')
      return
    }

    if (addExistingStudentDraft.lessonType === 'special' && !addExistingStudentDraft.specialSessionId) {
      setStatusMessage('講習を追加するには特別講習を選択してください。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    if (targetDesk.lesson?.studentSlots[studentMenu.studentIndex]) {
      setStatusMessage('この生徒マスにはすでに生徒が入っています。')
      return
    }

    const duplicateStudent = findDuplicateStudentInCell(targetCell, managedStudent.id)
    if (duplicateStudent) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているため追加不可です。`)
      return
    }

    const studentName = getStudentDisplayName(managedStudent)
    const grade = resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(targetCell.dateKey))
    const nextStudent: StudentEntry = {
      id: createStudentId(targetCell.id, studentMenu.deskIndex, studentMenu.studentIndex),
      name: studentName,
      managedStudentId: managedStudent.id,
      grade,
      birthDate: managedStudent.birthDate,
      subject: addExistingStudentDraft.subject,
      lessonType: addExistingStudentDraft.lessonType,
      teacherType: 'normal',
      manualAdded: true,
      specialSessionId: addExistingStudentDraft.lessonType === 'special' ? addExistingStudentDraft.specialSessionId : undefined,
      specialStockSource: addExistingStudentDraft.lessonType === 'special' ? 'manual' : undefined,
    }

    if (!targetDesk.lesson) {
      targetDesk.lesson = {
        id: `${targetCell.id}_desk_${studentMenu.deskIndex + 1}_manual`,
        studentSlots: [null, null],
      }
    }
    targetDesk.lesson.studentSlots[studentMenu.studentIndex] = nextStudent

    let nextManualLectureStockCounts = manualLectureStockCounts
    let nextManualLectureStockOrigins = manualLectureStockOrigins

    if (addExistingStudentDraft.lessonType === 'special') {
      const session = specialSessions.find((entry) => entry.id === addExistingStudentDraft.specialSessionId)
      if (!session) {
        setStatusMessage('選択した特別講習が見つかりませんでした。')
        return
      }
    }

    commitWeeks(
      nextWeeks,
      weekIndex,
      studentMenu.cellId,
      studentMenu.deskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      suppressedMakeupOrigins,
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      fallbackLectureStockStudents,
    )
    setAddExistingStudentDraft(null)
    setStatusMessage(`${studentName} を ${lessonTypeLabels[addExistingStudentDraft.lessonType]} として追加しました。`)
  }

  const handleCloseEdit = () => {
    if (!studentMenu) return
    setEditStudentDraft(null)
    setAddExistingStudentDraft(null)
    setStudentMenu({ ...studentMenu, mode: menuStudent ? 'root' : 'empty' })
  }

  const handleConfirmEdit = () => {
    if (!studentMenu || !menuStudent || !editStudentDraft) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetStudent = targetDesk?.lesson?.studentSlots[studentMenu.studentIndex]
    if (!targetStudent) return

    if (targetStudent.lessonType === 'special' || editStudentDraft.lessonType === 'special') {
      setStatusMessage('講習授業はコマ表から編集できません。生徒日程表で登録解除して内容を直し、再登録してください。')
      return
    }

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
      plannedCells: buildManagedScheduleCellsForRange({
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
      plannedCells: buildManagedScheduleCellsForRange({
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

    removeStudentFromDeskLesson(targetDesk, studentMenu.studentIndex)

    if (menuStudent.student.lessonType === 'special') {
      if (menuStudent.student.specialStockSource !== 'session') {
        commitWeeks(
          nextWeeks,
          weekIndex,
          studentMenu.cellId,
          studentMenu.deskIndex,
          classroomSettings.holidayDates,
          classroomSettings.forceOpenDates,
          manualMakeupAdjustments,
          suppressedMakeupOrigins,
          fallbackMakeupStudents,
          manualLectureStockCounts,
          manualLectureStockOrigins,
          fallbackLectureStockStudents,
        )
        setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} の手動追加講習を盤面から外しました。講習ストックには戻しません。`)
        if (selectedStudentId === menuStudent.student.id) {
          setSelectedStudentId(null)
        }
        return
      }

      const lectureStudentKey = managedStudentByAnyName.get(menuStudent.student.name)?.id ?? `name:${resolveBoardStudentDisplayName(menuStudent.student.name)}`
      const lectureStockKey = buildLectureStockKey(lectureStudentKey, menuStudent.student.subject)
      const nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, lectureStockKey)
      const nextManualLectureStockOrigins = appendManualLectureStockOrigin(manualLectureStockOrigins, lectureStockKey, {
        displayName: resolveBoardStudentDisplayName(menuStudent.student.name),
        sessionId: menuStudent.student.specialSessionId,
      })
      const nextFallbackLectureStockStudents = managedStudentByAnyName.get(menuStudent.student.name)
        ? fallbackLectureStockStudents
        : {
            ...fallbackLectureStockStudents,
            [lectureStockKey]: {
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
        manualMakeupAdjustments,
        suppressedMakeupOrigins,
        fallbackMakeupStudents,
        nextManualLectureStockCounts,
        nextManualLectureStockOrigins,
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
      suppressedMakeupOrigins,
      nextFallbackMakeupStudents,
      manualLectureStockCounts,
      manualLectureStockOrigins,
      fallbackLectureStockStudents,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を振替ストックへ回しました。`)
    if (selectedStudentId === menuStudent.student.id) {
      setSelectedStudentId(null)
    }
  }

  const handleDeleteStudent = () => {
    if (!studentMenu || !menuStudent) return

    const studentDisplayName = resolveBoardStudentDisplayName(menuStudent.student.name)
    const confirmed = window.confirm(`${studentDisplayName} のこの授業を削除します。\n削除した授業は振替の対象にならず、授業回数から減らします。\nよろしいですか。`)
    if (!confirmed) {
      setStatusMessage('授業の削除をキャンセルしました。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    if (!targetCell || !targetDesk || !targetLesson) return

    removeStudentFromDeskLesson(targetDesk, studentMenu.studentIndex)

    let nextSuppressedMakeupOrigins = cloneOriginMap(suppressedMakeupOrigins)
    let nextManualLectureStockCounts = manualLectureStockCounts
    let nextManualLectureStockOrigins = manualLectureStockOrigins
    let statusSuffix = '振替対象にはしません。'

    if (menuStudent.student.lessonType === 'makeup' && menuStudent.student.makeupSourceDate) {
      const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(menuStudent.student), menuStudent.student.subject)
      nextSuppressedMakeupOrigins = appendMakeupOrigin(nextSuppressedMakeupOrigins, stockKey, menuStudent.student.makeupSourceDate)
    }

    if (menuStudent.student.lessonType === 'special') {
      const lectureStudentKey = menuStudent.student.managedStudentId ?? managedStudentByAnyName.get(menuStudent.student.name)?.id ?? `name:${studentDisplayName}`
      const lectureStockKey = buildLectureStockKey(lectureStudentKey, menuStudent.student.subject)

      if (menuStudent.student.specialStockSource === 'session') {
        nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, lectureStockKey, 1)
        nextManualLectureStockOrigins = appendManualLectureStockOrigin(manualLectureStockOrigins, lectureStockKey, {
          displayName: studentDisplayName,
          sessionId: menuStudent.student.specialSessionId,
        })
      }
      statusSuffix = '講習の希望数は変えず、盤面上の予定だけを削除しました。'
    }

    commitWeeks(
      nextWeeks,
      weekIndex,
      studentMenu.cellId,
      studentMenu.deskIndex,
      classroomSettings.holidayDates,
      classroomSettings.forceOpenDates,
      manualMakeupAdjustments,
      nextSuppressedMakeupOrigins,
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      fallbackLectureStockStudents,
    )
    setStatusMessage(`${studentDisplayName} の授業を削除しました。${statusSuffix}`)
    if (selectedStudentId === menuStudent.student.id) {
      setSelectedStudentId(null)
    }
  }

  const handleCancelSelection = () => {
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(null)
    if (stockPanelsRestoreState) {
      setIsLectureStockOpen(stockPanelsRestoreState.lecture)
      setIsMakeupStockOpen(stockPanelsRestoreState.makeup)
      setStockPanelsRestoreState(null)
    } else {
      setIsMakeupStockOpen(false)
      setIsLectureStockOpen(false)
    }
    setStudentMenu(null)
    setTeacherMenu(null)
    setStatusMessage('選択をキャンセルしました。')
  }

  const handleToggleMakeupStock = () => {
    setStockPanelsRestoreState(null)
    setStudentMenu(null)
    setTeacherMenu(null)
    if (selectedMakeupStockKey) {
      setIsMakeupStockOpen(true)
      setStatusMessage('振替作業中です。終了する場合はキャンセルを押してください。')
      return
    }

    setIsMakeupStockOpen((current) => !current)
    if (!isMakeupStockOpen) {
      setMakeupAutoAssignRange(buildDefaultMakeupAutoAssignRange(cells[0]?.dateKey ?? getReferenceDateKey(new Date())))
      setSelectedStudentId(null)
      setSelectedLectureStockKey(null)
      setStatusMessage('振替ストック一覧を開きました。生徒を選ぶと空欄セルへ配置できます。')
    }
  }

  const handleToggleLectureStock = () => {
    setStockPanelsRestoreState(null)
    setStudentMenu(null)
    setTeacherMenu(null)
    if (selectedLectureStockKey) {
      setIsLectureStockOpen(true)
      setStatusMessage('講習配置中です。終了する場合はキャンセルを押してください。')
      return
    }

    setIsLectureStockOpen((current) => !current)
    if (!isLectureStockOpen) {
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStatusMessage('講習ストック一覧を開きました。生徒を選ぶと空欄セルへ配置できます。')
    }
  }

  const handleSelectLectureStockEntry = (entry: GroupedLectureStockEntry, options?: { hidePanelsDuringPlacement?: boolean }) => {
    if (entry.requestedCount <= 0) {
      setStatusMessage(`${entry.displayName} の講習ストックは残数がありません。`)
      return
    }

    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(entry.key)
    if (options?.hidePanelsDuringPlacement) {
      setStockPanelsRestoreState({ lecture: isLectureStockOpen, makeup: isMakeupStockOpen })
      setIsLectureStockOpen(false)
      setIsMakeupStockOpen(false)
    } else {
      setStockPanelsRestoreState(null)
      setIsLectureStockOpen(true)
    }
    setStudentMenu(null)
    setTeacherMenu(null)
    setStatusMessage(`${entry.displayName} の講習ストックを選択しました。空欄セルを左クリックしてください。`)
  }

  const handleSelectMakeupStockEntry = (entry: GroupedMakeupStockEntry, options?: { hidePanelsDuringPlacement?: boolean }) => {
    if (entry.balance <= 0) {
      setStatusMessage(`${entry.displayName} は先取り済みのため、残数が発生するまで選択できません。`)
      return
    }

    setSelectedStudentId(null)
    setSelectedLectureStockKey(null)
    setSelectedMakeupStockKey(entry.key)
    if (options?.hidePanelsDuringPlacement) {
      setStockPanelsRestoreState({ lecture: isLectureStockOpen, makeup: isMakeupStockOpen })
      setIsLectureStockOpen(false)
      setIsMakeupStockOpen(false)
    } else {
      setStockPanelsRestoreState(null)
      setIsMakeupStockOpen(true)
    }
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
      nextWeeks = [createBoardWeek(previousWeekStart, { classroomSettings, teachers, students, regularLessons }), ...weeks]
      setWeeks(nextWeeks)
      resolvedIndex = 0
    } else if (nextWeekIndex >= weeks.length) {
      const lastWeekStart = getWeekStart(parseDateKey(weeks[weeks.length - 1]?.[0]?.dateKey ?? getReferenceDateKey(new Date())))
      const nextWeekStart = shiftDate(lastWeekStart, 7)
      nextWeeks = [...weeks, createBoardWeek(nextWeekStart, { classroomSettings, teachers, students, regularLessons })]
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
      selectedStudentId || selectedMakeupStockKey || selectedLectureStockKey
        ? `${nextWeek[0].dateLabel} 週へ移動しました。選択中の内容をこの週へ配置できます。`
        : `${nextWeek[0].dateLabel} 週を表示しています。`,
    )
  }

  const handleUndo = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return

    setRedoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedMakeupOrigins(cloneOriginMap(previous.suppressedMakeupOrigins))
    setFallbackMakeupStudents(previous.fallbackMakeupStudents)
    setManualLectureStockCounts({ ...previous.manualLectureStockCounts })
    setManualLectureStockOrigins(cloneManualLectureStockOrigins(previous.manualLectureStockOrigins))
    setFallbackLectureStockStudents({ ...previous.fallbackLectureStockStudents })
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(null)
    setStudentMenu(null)
    setEditStudentDraft(null)
    setStatusMessage('1つ前の状態に戻しました。')
  }

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return

    setUndoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedMakeupOrigins(cloneOriginMap(next.suppressedMakeupOrigins))
    setFallbackMakeupStudents(next.fallbackMakeupStudents)
    setManualLectureStockCounts({ ...next.manualLectureStockCounts })
    setManualLectureStockOrigins(cloneManualLectureStockOrigins(next.manualLectureStockOrigins))
    setFallbackLectureStockStudents({ ...next.fallbackLectureStockStudents })
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(null)
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
      <main className="page-main page-main-board-only" onPointerDownCapture={acquireBoardInteraction}>
        <section className="board-panel board-panel-unified">
          {isBoardInteractionLocked ? <div className="interaction-lock-banner" data-testid="board-interaction-lock-banner">{boardInteractionLockMessage}</div> : null}
          <BoardToolbar
            weekLabel={weekLabel}
            statusMessage={statusMessage}
            lectureStockEntryCount={lectureStockEntries.length}
            isLectureStockOpen={isLectureStockOpen}
            makeupStockEntryCount={makeupStockEntries.length}
            isMakeupStockOpen={isMakeupStockOpen}
            isMakeupMoveActive={selectedMakeupStockKey !== null || selectedLectureStockKey !== null}
            isPrintingPdf={isPrintingPdf}
            isStudentScheduleOpen={isStudentScheduleOpen}
            isTeacherScheduleOpen={isTeacherScheduleOpen}
            hasSelectedStudent={selectedStudentId !== null || selectedMakeupStockKey !== null || selectedLectureStockKey !== null}
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
            onOpenAutoAssignRules={onOpenAutoAssignRules}
            onOpenBackupRestore={onOpenBackupRestore}
          />
          <div ref={boardExportRef} className="board-export-surface" data-testid="board-export-surface">
          {stockActionModal ? (() => {
            const lectureEntry = stockActionModal.type === 'lecture'
              ? lectureStockEntries.find((entry) => entry.key === stockActionModal.entryKey) ?? null
              : null
            const makeupEntry = stockActionModal.type === 'makeup'
              ? makeupStockEntries.find((entry) => entry.key === stockActionModal.entryKey) ?? null
              : null
            const entryLabel = lectureEntry?.displayName ?? makeupEntry?.displayName ?? ''
            const canAutoAssign = stockActionModal.type === 'lecture'
              ? Boolean(lectureEntry?.studentId && (lectureEntry?.requestedCount ?? 0) > 0)
              : Boolean(makeupEntry?.studentId && (makeupEntry?.balance ?? 0) > 0)

            return (
              <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setStockActionModal(null) }}>
                <div className="auto-assign-modal" role="dialog" aria-modal="true" data-testid="stock-action-modal">
                  <div className="auto-assign-modal-title">{entryLabel}</div>
                  <div className="student-menu-help-text">個別割振で配置先を選ぶか、自動割振で候補へ一括配置します。</div>
                                    <div className="student-menu-help-text">
                                      {stockActionModal.type === 'lecture'
                                        ? '講習の自動割振は各講習期間内の空きコマだけを対象にします。'
                                        : '振替の自動割振は下で指定した期間内の空きコマだけを対象にします。'}
                                    </div>
                  <div className="auto-assign-modal-actions">
                    <button
                      className="secondary-button slim"
                      type="button"
                      onClick={() => {
                        if (lectureEntry) handleSelectLectureStockEntry(lectureEntry, { hidePanelsDuringPlacement: true })
                        if (makeupEntry) handleSelectMakeupStockEntry(makeupEntry, { hidePanelsDuringPlacement: true })
                        setStockActionModal(null)
                      }}
                      data-testid="stock-action-modal-manual"
                    >
                      個別割振
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!canAutoAssign}
                      onClick={() => {
                        const restoreState = { lecture: isLectureStockOpen, makeup: isMakeupStockOpen }
                        setStockPanelsRestoreState(restoreState)
                        setIsLectureStockOpen(false)
                        setIsMakeupStockOpen(false)
                        if (lectureEntry) handleAutoAssignLectureStockEntry(lectureEntry)
                        if (makeupEntry) handleAutoAssignMakeupStockEntry(makeupEntry)
                        setIsLectureStockOpen(restoreState.lecture)
                        setIsMakeupStockOpen(restoreState.makeup)
                        setStockPanelsRestoreState(null)
                        setStockActionModal(null)
                      }}
                      data-testid="stock-action-modal-auto"
                    >
                      自動割振
                    </button>
                    <button className="secondary-button slim" type="button" onClick={() => setStockActionModal(null)} data-testid="stock-action-modal-cancel">キャンセル</button>
                  </div>
                </div>
              </div>
            )
          })() : null}
          <BoardGrid
            cells={displayCells}
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
          {!studentMenu && !teacherMenu && !selectedStudentId && (isLectureStockOpen || isMakeupStockOpen) ? (
            <div className="stock-floating-modals">
              {isLectureStockOpen ? (
                <section className="lecture-stock-panel stock-floating-panel" data-testid="lecture-stock-panel">
                  <div className="makeup-stock-panel-head">
                    <div className="stock-floating-panel-title">
                      <strong>講習ストック</strong>
                      <span className="basic-data-muted-inline">生徒・講習期間ごとの講習ストック数です。</span>
                      <span className="basic-data-muted-inline">自動割振は各講習期間内の空きコマだけに配置します。</span>
                    </div>
                    <button className="secondary-button slim stock-floating-close" type="button" onClick={() => setIsLectureStockOpen(false)} data-testid="lecture-stock-close-button">閉じる</button>
                  </div>
                  <div className="makeup-stock-list">
                    {lectureStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の講習ストックはありません。</div>
                    ) : lectureStockEntries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className={`lecture-stock-row${selectedLectureStockKey === entry.key ? ' active' : ''}`}
                        onClick={() => setStockActionModal({ type: 'lecture', entryKey: entry.key })}
                        title={entry.title}
                        data-testid={`lecture-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                      >
                        <span className="makeup-stock-name">{entry.displayName}</span>
                        {entry.sessionLabel ? <span className="lecture-stock-session">{entry.sessionLabel}</span> : null}
                        <span className="status-chip">+{entry.requestedCount}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {isMakeupStockOpen ? (
                <section className="makeup-stock-panel stock-floating-panel" data-testid="makeup-stock-panel">
                  <div className="makeup-stock-panel-head">
                    <div className="stock-floating-panel-title">
                      <strong>振替ストック</strong>
                      <span className="basic-data-muted-inline">残数のある生徒を選ぶとコマ表へ配置できます。</span>
                    </div>
                    <button className="secondary-button slim stock-floating-close" type="button" onClick={() => setIsMakeupStockOpen(false)} data-testid="makeup-stock-close-button">閉じる</button>
                  </div>
                  <div className="makeup-stock-list">
                    {makeupStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の振替ストックはありません。</div>
                    ) : makeupStockEntries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className={`makeup-stock-row${selectedMakeupStockKey === entry.key ? ' active' : ''}${entry.balance < 0 ? ' is-negative' : ''}`}
                        onClick={() => setStockActionModal({ type: 'makeup', entryKey: entry.key })}
                        disabled={entry.balance <= 0}
                        title={entry.title}
                        data-testid={`makeup-stock-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                      >
                        <span className="makeup-stock-name">{entry.displayName}</span>
                        <span className={`status-chip ${entry.balance < 0 ? 'secondary' : ''}`}>{entry.balance > 0 ? `+${entry.balance}` : entry.balance}</span>
                      </button>
                    ))}
                  </div>
                  <div className="makeup-stock-range-row">
                    <label className="student-menu-label" htmlFor="makeup-auto-assign-start">自動割振期間</label>
                    <input id="makeup-auto-assign-start" className="student-menu-select" type="date" value={makeupAutoAssignRange.startDate} onChange={(event) => setMakeupAutoAssignRange((current) => ({ ...current, startDate: event.target.value }))} data-testid="makeup-auto-assign-start" />
                    <span className="student-menu-label">〜</span>
                    <input id="makeup-auto-assign-end" className="student-menu-select" type="date" value={makeupAutoAssignRange.endDate} onChange={(event) => setMakeupAutoAssignRange((current) => ({ ...current, endDate: event.target.value }))} data-testid="makeup-auto-assign-end" />
                    <span className="basic-data-muted-inline">表示中の週の開始日を初期値にし、指定した期間外へは割り振りません。期間内では制約を優先したうえで日付順に割り振ります。</span>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
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
          {studentMenu && (studentMenu.mode === 'memo' || studentMenu.mode === 'empty' || studentMenu.mode === 'add' || menuStudent) ? (
            <div
              className={`student-menu-popover${studentMenu.mode === 'memo' ? ' student-menu-popover-memo' : ''}`}
              style={menuPosition}
              data-testid="student-action-menu"
            >
              <div className="student-menu-head">
                <strong>{studentMenu?.mode === 'memo'
                  ? 'メモ'
                  : studentMenu?.mode === 'empty'
                    ? '空欄メニュー'
                    : studentMenu?.mode === 'add'
                      ? '既存生徒追加'
                      : resolveBoardStudentDisplayName(menuStudent?.student.name ?? '')}</strong>
                <button type="button" className="student-menu-close" onClick={() => setStudentMenu(null)}>x</button>
              </div>
              {studentMenu?.mode === 'memo' ? null : studentMenu?.mode === 'empty' || studentMenu?.mode === 'add' ? (
                <div className="student-menu-meta">
                  {`${emptyMenuContext?.cell.dateLabel ?? ''} ${emptyMenuContext?.cell.slotLabel ?? ''} / ${studentMenu.deskIndex + 1}机目`}
                </div>
              ) : (
                <div className="student-menu-meta">
                  {`${resolveBoardStudentGradeLabel(menuStudent?.student.name ?? '', menuStudent?.student.grade ?? '', menuStudent?.cell.dateKey ?? displayWeekDate)} ${menuStudent?.student.subject}`}
                </div>
              )}
              {studentMenu?.mode === 'root' ? (
                <div className="student-menu-section">
                  <button type="button" className="menu-link-button" onClick={handleStartMove} data-testid="menu-move-button">移動</button>
                  {menuStudent?.student.lessonType === 'special' && menuStudent.student.specialStockSource !== 'session' ? (
                    <div className="student-menu-help-text" data-testid="menu-stock-disabled-note">手動追加した講習は講習ストックへ戻せません。不要な場合は削除してください。</div>
                  ) : (
                    <>
                      <button type="button" className="menu-link-button" onClick={handleStoreStudent} data-testid="menu-stock-button">ストックする</button>
                      <div className="student-menu-help-text">ストックは希望数を変えず、未配置分として残します。</div>
                    </>
                  )}
                  {menuStudent?.student.lessonType === 'special' ? <div className="student-menu-help-text">講習の内容変更はコマ表では行わず、生徒日程表で登録解除してから再登録してください。</div> : null}
                  <button type="button" className="menu-link-button" onClick={handleDeleteStudent} data-testid="menu-delete-button">削除</button>
                  <div className="student-menu-help-text">削除は日程表の希望数を変えず、盤面上の予定だけを消します。</div>
                </div>
              ) : studentMenu?.mode === 'empty' ? (
                <div className="student-menu-section">
                  <button type="button" className="menu-link-button" onClick={handleOpenAddExistingStudent} data-testid="menu-open-add-existing-student-button">既存生徒追加</button>
                  <div className="student-menu-help-text">既存生徒追加は日程表の希望数を変えず、盤面上にだけ追加します。</div>
                  <button type="button" className="menu-link-button" onClick={() => setStudentMenu((current) => (current ? { ...current, mode: 'memo' } : current))} data-testid="menu-open-memo-button">メモ</button>
                </div>
              ) : studentMenu?.mode === 'add' ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">追加</strong>
                    <button type="button" className="menu-link-button subtle" onClick={handleCloseEdit} data-testid="menu-add-back-button">戻る</button>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleSaveAddedStudent} data-testid="menu-add-existing-student-confirm-button">追加</button>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="menu-add-student-select">生徒</label>
                    <select
                      id="menu-add-student-select"
                      className="student-menu-select"
                      value={addExistingStudentDraft?.studentId ?? ''}
                      onChange={(event) => setAddExistingStudentDraft((current) => {
                        const nextStudent = addableStudents.find((entry) => entry.id === event.target.value)?.student ?? null
                        const nextSubjects = getSelectableSubjectsForStudent(nextStudent, emptyMenuContext?.cell.dateKey ?? displayWeekDate)
                        return current
                          ? {
                              ...current,
                              studentId: event.target.value,
                              subject: nextSubjects.includes(current.subject) ? current.subject : nextSubjects[0],
                            }
                          : current
                      })}
                      data-testid="menu-add-student-select"
                    >
                      {addableStudents.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <span className="student-menu-label">授業区分</span>
                    <div className="student-menu-type-grid">
                      {editableLessonTypes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={`student-type-button${addExistingStudentDraft?.lessonType === type ? ' active' : ''}`}
                          onClick={() => setAddExistingStudentDraft((current) => (current
                            ? {
                                ...current,
                                lessonType: type,
                                specialSessionId: type === 'special'
                                  ? (current.specialSessionId || addableSpecialSessions[0]?.id || '')
                                  : current.specialSessionId,
                              }
                            : current))}
                          data-testid={`menu-add-lesson-type-${type}`}
                        >
                          {lessonTypeLabels[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="menu-add-subject-select">科目</label>
                    <select
                      id="menu-add-subject-select"
                      className="student-menu-select"
                      value={addExistingStudentDraft?.subject ?? addableSubjects[0]}
                      onChange={(event) => setAddExistingStudentDraft((current) => (current ? { ...current, subject: event.target.value as SubjectLabel } : current))}
                      data-testid="menu-add-subject-select"
                    >
                      {addableSubjects.map((subject) => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
                  {addExistingStudentDraft?.lessonType === 'special' ? (
                    <div className="student-menu-section">
                      <label className="student-menu-label" htmlFor="menu-add-special-session-select">特別講習</label>
                      <select
                        id="menu-add-special-session-select"
                        className="student-menu-select"
                        value={addExistingStudentDraft.specialSessionId}
                        onChange={(event) => setAddExistingStudentDraft((current) => (current ? { ...current, specialSessionId: event.target.value } : current))}
                        data-testid="menu-add-special-session-select"
                      >
                        {addableSpecialSessions.length === 0 ? <option value="">選択可能な講習なし</option> : null}
                        {addableSpecialSessions.map((session) => (
                          <option key={session.id} value={session.id}>{session.label}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </>
              ) : studentMenu?.mode === 'memo' ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">メモ</strong>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleSaveMemo} data-testid="menu-memo-save-button">保存</button>
                  </div>
                  <div className="student-menu-section">
                    <textarea
                      id="student-memo-input"
                      className="student-menu-input student-menu-textarea"
                      value={memoDraft}
                      onChange={(event) => setMemoDraft(event.target.value)}
                      data-testid="menu-memo-textarea"
                    />
                    <div className="student-menu-hint">2行まで表示します。空で保存するとメモを削除</div>
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

function resolveApplicableLessonLimit(ruleMap: Map<AutoAssignRuleKey, AutoAssignRuleRow>, studentId: string, studentGrade: GradeLabel) {
  const lessonLimitRule = lectureConstraintGroupDefinitions[1].ruleKeys
    .map((ruleKey) => ruleMap.get(ruleKey))
    .find((rule) => isAutoAssignRuleApplicable(rule, studentId, studentGrade))

  if (lessonLimitRule?.key === 'maxOneLesson') return 1
  if (lessonLimitRule?.key === 'maxTwoLessons') return 2
  if (lessonLimitRule?.key === 'maxThreeLessons') return 3
  return null
}