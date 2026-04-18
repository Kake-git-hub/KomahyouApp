import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { compareStudentsByCurrentGradeThenName, formatStudentSelectionLabel, getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveScheduledStatus, resolveTeacherRosterStatus, type GradeCeiling, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import type { AutoAssignRuleKey, AutoAssignRuleRow, AutoAssignTarget } from '../auto-assign-rules/autoAssignRuleModel'
import { isRegularLessonParticipantActiveOnDate, normalizeRegularLessonNote, resolveOperationalSchoolYear, type RegularLessonRow } from '../basic-data/regularLessonModel'
import { buildRegularLessonsFromTemplate, buildRegularLessonTemplateWorkbook, buildTemplateBoardCells, convertTemplateCellsToTemplate, copyBoardCellsForTemplate, filterTemplateParticipantsForReferenceDate, listTemplateStartDatesFromWorkbook, normalizeRegularLessonTemplate, parseRegularLessonTemplateWorkbook, type RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { BoardGrid } from './BoardGrid'
import { BoardToolbar } from './BoardToolbar'
import { buildLectureStockEntries } from './lectureStock'
import { buildMakeupStockEntries, buildMakeupStockKey, normalizeMakeupOriginMapKeys, normalizeManagedMakeupStockKey, type MakeupStockEntry, type ManualMakeupOrigin } from './makeupStock'
import { defaultWeekIndex, getWeekStart, lessonTypeLabels, shiftDate, teacherTypeLabels } from './mockData'
import type { DeskCell, DeskLesson, GradeLabel, LessonType, SlotCell, StudentEntry, StudentStatusEntry, StudentStatusKind, SubjectLabel, TeacherType } from './types'
import type { ClassroomSettings, StudentScheduleRequest, TeacherAutoAssignRequest } from '../../App'
import type { ManualLectureStockOrigin, PersistedBoardState, ScheduleCountAdjustmentEntry, ScheduleCountAdjustmentKind } from '../../types/appState'
import type { PairConstraintRow } from '../../types/pairConstraint'
import { exportBoardPdf, exportTemplateOverwriteReport } from '../../utils/pdf'
import { buildCombinedRegularLessonsFromHistory, formatWeeklyScheduleTitle, openAllScheduleHtml, openStudentScheduleHtml, openTeacherScheduleHtml, syncStudentScheduleHtml, syncTeacherScheduleHtml } from '../../utils/scheduleHtml'
import { allStudentSubjectOptions, getSelectableStudentSubjectsForGrade, resolveDisplayedSubjectForGrade, resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'

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
  suppressedRegularLessonOccurrences: string[]
  scheduleCountAdjustments: ScheduleCountAdjustmentEntry[]
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
  mode: 'root' | 'edit' | 'memo' | 'empty' | 'add' | 'trial'
}

type TeacherMenuState = {
  cellId: string
  deskIndex: number
  x: number
  y: number
  selectedTeacherName: string
}

type TemplateSaveConfirmState = {
  mode: 'overwrite'
  template: RegularLessonTemplate
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

type TrialStudentDraft = {
  name: string
  grade: GradeLabel
  subject: SubjectLabel
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

type TemplateEditDraft = {
  studentId: string
  subject: SubjectLabel
  note: string
}

type TemplateAddDraft = {
  studentId: string
  subject: SubjectLabel
  note: string
}

type TemplateHistoryEntry = {
  cells: SlotCell[]
}

type AutoAssignScorePart = {
  label: string
  value: number
  detail: string
  applicable?: boolean
  satisfied?: boolean
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
  scoreParts: AutoAssignScorePart[]
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
  scoreParts: AutoAssignScorePart[]
}

type LectureAutoAssignCandidateSearchResult = {
  bestCandidate: LectureAutoAssignCandidate | null
  topCandidates: LectureAutoAssignCandidate[]
  evaluatedCandidateCount: number
}

type AutoAssignDebugReport = {
  title: string
  summary: string
  details: string
}

type LectureConstraintGroupKey = 'two-students' | 'lesson-limit' | 'lesson-pattern' | 'day-spacing' | 'time-preference'
type StockActionModalState =
  | { type: 'lecture'; entryKey: string }
  | { type: 'makeup'; entryKey: string }

type MakeupStockOriginItem = {
  rawEntryKey: string
  originIndex: number
  date: string
  label: string
  reasonLabel: string
  subject: string
}
type InteractionSurface = 'board' | 'student' | 'teacher'

const editableSubjects: SubjectLabel[] = allStudentSubjectOptions
const editableLessonTypes: LessonType[] = ['regular', 'makeup', 'special']
const editableTeacherTypes: TeacherType[] = ['normal', 'substitute', 'outside']
const interactionLockStorageKey = 'schedule-shared:interaction-lock'
const interactionLockStaleMs = 5000
const forcedAutoAssignRuleKeys = new Set<AutoAssignRuleKey>(['forbidFirstPeriod', 'regularTeachersOnly', 'subjectCapableTeachersOnly'])
const lectureConstraintGroupDefinitions: Array<{ key: LectureConstraintGroupKey; orderKey: AutoAssignRuleKey; ruleKeys: AutoAssignRuleKey[] }> = [
  { key: 'two-students', orderKey: 'preferTwoStudentsPerTeacher', ruleKeys: ['preferTwoStudentsPerTeacher'] },
  { key: 'lesson-limit', orderKey: 'maxOneLesson', ruleKeys: ['maxOneLesson', 'maxTwoLessons', 'maxThreeLessons'] },
  { key: 'lesson-pattern', orderKey: 'allowTwoConsecutiveLessons', ruleKeys: ['allowTwoConsecutiveLessons', 'requireBreakBetweenLessons', 'connectRegularLessons'] },
  { key: 'day-spacing', orderKey: 'preferDateConcentration', ruleKeys: ['preferDateConcentration', 'preferNextDayOrLater'] },
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
    (
      capability.subject === subject
      || ((capability.subject === '数' || capability.subject === '算') && (subject === '数' || subject === '算'))
      || (subject === '算国' && (capability.subject === '国' || capability.subject === '数' || capability.subject === '算'))
      || ((subject === '生' || subject === '物' || subject === '化') && capability.subject === '理')
    )
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

function buildForcedConstraintScoreParts(params: {
  firstPeriodRuleApplied: boolean
  firstPeriodPreferred: boolean
  subjectCapableRuleApplied: boolean
  subjectCapablePreferred: boolean
  regularTeacherRuleApplied: boolean
  regularTeacherPreferred: boolean
}) {
  const forcedScores = [
    params.firstPeriodPreferred ? 1 : 0,
    params.subjectCapablePreferred ? 1 : 0,
    params.regularTeacherPreferred ? 1 : 0,
  ]
  return [
    {
      label: '絶対事項合計',
      value: forcedScores.reduce((total, score) => total + score, 0),
      detail: '1限回避・科目対応・通常担当講師の合計',
    },
    {
      label: '1限回避',
      value: forcedScores[0] ?? 0,
      detail: !params.firstPeriodRuleApplied ? '対象ルールなし' : params.firstPeriodPreferred ? '満たす' : '1限のため不利',
      applicable: params.firstPeriodRuleApplied,
      satisfied: params.firstPeriodRuleApplied ? params.firstPeriodPreferred : false,
    },
    {
      label: '科目対応講師',
      value: forcedScores[1] ?? 0,
      detail: !params.subjectCapableRuleApplied ? '対象ルールなし' : params.subjectCapablePreferred ? '満たす' : '科目対応外のため不利',
      applicable: params.subjectCapableRuleApplied,
      satisfied: params.subjectCapableRuleApplied ? params.subjectCapablePreferred : false,
    },
    {
      label: '通常担当講師',
      value: forcedScores[2] ?? 0,
      detail: !params.regularTeacherRuleApplied ? '対象ルールなし' : params.regularTeacherPreferred ? '満たす' : '通常担当外',
      applicable: params.regularTeacherRuleApplied,
      satisfied: params.regularTeacherRuleApplied ? params.regularTeacherPreferred : false,
    },
  ]
}

function compareAutoAssignCandidateOrder<T extends { scoreVector: number[]; cell: SlotCell; deskIndex: number; studentIndex: number }>(left: T, right: T) {
  const scoreCompare = compareScoreVectors(left.scoreVector, right.scoreVector)
  if (scoreCompare !== 0) return scoreCompare

  const dateCompare = left.cell.dateKey.localeCompare(right.cell.dateKey)
  if (dateCompare !== 0) return dateCompare
  if (left.cell.slotNumber !== right.cell.slotNumber) return left.cell.slotNumber - right.cell.slotNumber
  if (left.deskIndex !== right.deskIndex) return left.deskIndex - right.deskIndex
  return left.studentIndex - right.studentIndex
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

export function cloneWeeks(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) =>
    week.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk) => ({
        ...desk,
        memoSlots: desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : undefined,
        statusSlots: desk.statusSlots ? desk.statusSlots.map((entry) => (entry ? { ...entry } : null)) as [StudentStatusEntry | null, StudentStatusEntry | null] : undefined,
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
  classroomName?: string
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
  onReplaceRegularLessons?: Dispatch<SetStateAction<RegularLessonRow[]>>
  onUpdateSpecialSessions: Dispatch<SetStateAction<SpecialSessionRow[]>>
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  onOpenBackupRestore: () => void
  onPreTemplateSaveBackup?: () => Promise<void>
  undoSnapshotLabel?: string | null
  onRestoreUndoSnapshot?: () => void
  onDismissUndoSnapshot?: () => void
  onLogout: () => void
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

function requestSchedulePopupInteractionYield() {
  if (typeof window === 'undefined') return
  const runtimeWindow = getSchedulePopupRuntimeWindow()
  for (const targetWindow of [runtimeWindow.__lessonScheduleStudentWindow, runtimeWindow.__lessonScheduleTeacherWindow]) {
    if (!targetWindow || targetWindow.closed) continue
    targetWindow.postMessage({ type: 'schedule-force-release-interaction' }, '*')
  }
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

function normalizeFallbackMakeupStudentKeys(
  fallbackStudents: Record<string, FallbackMakeupStudent>,
  students: StudentRow[],
) {
  return Object.entries(fallbackStudents).reduce<Record<string, FallbackMakeupStudent>>((accumulator, [key, value]) => {
    accumulator[normalizeManagedMakeupStockKey(key, students)] = value
    return accumulator
  }, {})
}

function appendManualLectureStockOrigin(originMap: Record<string, ManualLectureStockOrigin[]>, key: string, origin: ManualLectureStockOrigin) {
  const currentOrigins = originMap[key] ?? []
  return {
    ...originMap,
    [key]: [...currentOrigins, origin],
  }
}

function removeManualLectureStockOrigin(originMap: Record<string, ManualLectureStockOrigin[]>, key: string, options?: { sessionId?: string }) {
  return consumeManualLectureStockOrigin(originMap, key, options)
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

function removeMakeupOrigin(originMap: MakeupOriginMap, key: string, originDate: string) {
  const currentDates = originMap[key] ?? []
  const targetIndex = currentDates.findIndex((entry) => entry.dateKey === originDate)
  if (targetIndex < 0) return originMap

  const nextDates = currentDates.filter((_, index) => index !== targetIndex)
  if (nextDates.length === 0) {
    const { [key]: _removed, ...rest } = originMap
    return rest
  }

  return {
    ...originMap,
    [key]: nextDates,
  }
}

export function removeStudentFromDeskLesson(desk: DeskCell, studentIndex: number) {
  if (!desk.lesson) return

  desk.lesson.studentSlots[studentIndex] = null
  if (!desk.lesson.studentSlots[0] && !desk.lesson.studentSlots[1]) {
    desk.lesson = undefined
  }
}

function setDeskStudentStatus(desk: DeskCell, studentIndex: number, entry: StudentStatusEntry | null) {
  const nextStatusSlots: [StudentStatusEntry | null, StudentStatusEntry | null] = desk.statusSlots
    ? cloneStatusSlots(desk.statusSlots) ?? [null, null]
    : [null, null]
  nextStatusSlots[studentIndex] = entry ? { ...entry } : null
  desk.statusSlots = nextStatusSlots.some((current) => current) ? nextStatusSlots : undefined
}

function appendLectureStockCount(countMap: LectureStockCountMap, key: string, increment = 1) {
  return {
    ...countMap,
    [key]: (countMap[key] ?? 0) + increment,
  }
}

function removeLectureStockCount(countMap: LectureStockCountMap, key: string, decrement = 1) {
  const nextCount = (countMap[key] ?? 0) - decrement
  if (nextCount <= 0) {
    const { [key]: _removed, ...rest } = countMap
    return rest
  }

  return {
    ...countMap,
    [key]: nextCount,
  }
}

function buildLectureStockKey(studentKey: string, subject: string, sessionId?: string) {
  return sessionId ? `${studentKey}__${subject}__${sessionId}` : `${studentKey}__${subject}`
}

function buildLectureStockScopeKey(studentKey: string, sessionId?: string) {
  return `${studentKey}__${sessionId ?? '-'}`
}

function buildDatePriorityScore(dateKey: string) {
  return 99999999 - Number(dateKey.replace(/-/g, ''))
}

function buildDateSpacingRegularityScore(dateKeys: string[]) {
  const uniqueDateKeys = Array.from(new Set(dateKeys)).sort()
  if (uniqueDateKeys.length <= 1) return 1
  if (uniqueDateKeys.length === 2) return 2

  const gaps = uniqueDateKeys.slice(1).map((dateKey, index) => {
    const current = parseDateKey(dateKey)
    const previous = parseDateKey(uniqueDateKeys[index] ?? dateKey)
    return Math.round((current.getTime() - previous.getTime()) / 86400000)
  })
  const averageGap = gaps.reduce((total, gap) => total + gap, 0) / gaps.length
  const deviation = gaps.reduce((total, gap) => total + Math.abs(gap - averageGap), 0) / gaps.length

  if (deviation <= 0.5) return 3
  if (deviation <= 1.5) return 2
  if (deviation <= 3) return 1
  return 0
}

function toDateDayNumber(dateKey: string) {
  return Math.floor(parseDateKey(dateKey).getTime() / 86400000)
}

function appendSuppressedRegularLessonOccurrence(occurrences: string[], occurrenceKey: string) {
  return occurrences.includes(occurrenceKey) ? occurrences : [...occurrences, occurrenceKey]
}

function removeSuppressedRegularLessonOccurrence(occurrences: string[], occurrenceKey: string) {
  return occurrences.filter((current) => current !== occurrenceKey)
}

function cloneScheduleCountAdjustments(adjustments: ScheduleCountAdjustmentEntry[] = []) {
  return adjustments.map((entry) => ({ ...entry }))
}

function appendScheduleCountAdjustment(adjustments: ScheduleCountAdjustmentEntry[], nextEntry: ScheduleCountAdjustmentEntry) {
  const studentKey = nextEntry.studentKey.trim()
  const subject = nextEntry.subject.trim()
  const dateKey = nextEntry.dateKey.trim()
  const delta = Number.isFinite(Number(nextEntry.delta)) ? Math.trunc(Number(nextEntry.delta)) : 0

  if (!studentKey || !subject || !dateKey || delta === 0) return cloneScheduleCountAdjustments(adjustments)

  const nextAdjustments = cloneScheduleCountAdjustments(adjustments)
  const existingIndex = nextAdjustments.findIndex((entry) => (
    entry.studentKey === studentKey
    && entry.subject === subject
    && entry.countKind === nextEntry.countKind
    && entry.dateKey === dateKey
  ))

  if (existingIndex < 0) {
    nextAdjustments.push({
      studentKey,
      subject,
      countKind: nextEntry.countKind,
      dateKey,
      delta,
    })
  } else {
    const updatedDelta = nextAdjustments[existingIndex]!.delta + delta
    if (updatedDelta === 0) {
      nextAdjustments.splice(existingIndex, 1)
    } else {
      nextAdjustments[existingIndex] = {
        ...nextAdjustments[existingIndex]!,
        delta: updatedDelta,
      }
    }
  }

  return nextAdjustments.sort((left, right) => (
    left.studentKey.localeCompare(right.studentKey, 'ja')
    || left.dateKey.localeCompare(right.dateKey)
    || left.countKind.localeCompare(right.countKind)
    || left.subject.localeCompare(right.subject, 'ja')
  ))
}

function resolveScheduleCountAdjustmentStudentKey(student: StudentEntry) {
  return (student.managedStudentId ?? student.name).trim()
}

function resolveScheduleCountAdjustmentKind(student: StudentEntry): ScheduleCountAdjustmentKind {
  return student.lessonType === 'special' ? 'special' : 'regular'
}

function buildDateCoverageScore(dateKeys: string[]) {
  const uniqueDateKeys = Array.from(new Set(dateKeys)).sort()
  if (uniqueDateKeys.length <= 1) return 0
  return Math.max(0, toDateDayNumber(uniqueDateKeys[uniqueDateKeys.length - 1]!) - toDateDayNumber(uniqueDateKeys[0]!))
}

function buildMinimumGapScore(dateKey: string, existingDateKeys: string[]) {
  if (existingDateKeys.length === 0) return 0
  const candidateDayNumber = toDateDayNumber(dateKey)
  return existingDateKeys.reduce((currentMin, currentDateKey) => (
    Math.min(currentMin, Math.abs(candidateDayNumber - toDateDayNumber(currentDateKey)))
  ), Number.MAX_SAFE_INTEGER)
}

function buildStudentWarningLocationKey(cellId: string, deskIndex: number, studentIndex: number) {
  return `${cellId}__${deskIndex}__${studentIndex}`
}

function isDateWithinRange(dateKey: string, startDate?: string, endDate?: string) {
  if (startDate && dateKey < startDate) return false
  if (endDate && dateKey > endDate) return false
  return true
}

function computeSpecialSessionDateDistance(session: SpecialSessionRow, dateKey: string) {
  if (dateKey >= session.startDate && dateKey <= session.endDate) return 0

  const targetTime = parseDateKey(dateKey).getTime()
  const startTime = parseDateKey(session.startDate).getTime()
  const endTime = parseDateKey(session.endDate).getTime()
  return Math.min(Math.abs(targetTime - startTime), Math.abs(targetTime - endTime))
}

function parseLectureStockKey(key: string) {
  const [studentKey = key, subject = '', sessionId] = key.split('__')
  return { studentKey, subject, sessionId }
}

function clearLectureStockAdjustmentsForStudentSession(params: {
  countMap: LectureStockCountMap
  originMap: Record<string, ManualLectureStockOrigin[]>
  fallbackStudents: Record<string, { displayName: string; subject?: string }>
  studentKey: string
  sessionId: string
}) {
  const nextCountMap = Object.fromEntries(Object.entries(params.countMap).filter(([key]) => {
    const parsed = parseLectureStockKey(key)
    return !(parsed.studentKey === params.studentKey && parsed.sessionId === params.sessionId)
  }))

  const nextOriginMap = Object.fromEntries(Object.entries(params.originMap).filter(([key]) => {
    const parsed = parseLectureStockKey(key)
    return !(parsed.studentKey === params.studentKey && parsed.sessionId === params.sessionId)
  }))

  const nextFallbackStudents = Object.fromEntries(Object.entries(params.fallbackStudents).filter(([key]) => {
    const parsed = parseLectureStockKey(key)
    return !(parsed.studentKey === params.studentKey && parsed.sessionId === params.sessionId)
  }))

  return {
    nextCountMap,
    nextOriginMap,
    nextFallbackStudents,
  }
}

function buildInitialSetupLectureStockKey(studentKey: string, subject: string, sessionId?: string) {
  return sessionId ? `${studentKey}__${subject}__${sessionId}` : `${studentKey}__${subject}`
}

function buildInitialSetupMakeupOriginKey(stockId: string, index: number) {
  return `__initial_setup__${stockId}_${index + 1}`
}

function buildInitialSetupMakeupAdjustmentsFromSettings(classroomSettings: ClassroomSettings) {
  return (classroomSettings.initialSetupMakeupStocks ?? []).reduce<MakeupOriginMap>((accumulator, row) => {
    const count = Math.max(0, Math.trunc(Number(row.count) || 0))
    if (!row.studentId || !row.subject || count <= 0) return accumulator
    const key = buildMakeupStockKey(row.studentId, row.subject)
    const dateKey = row.originDateKey?.trim() || buildInitialSetupMakeupOriginKey(row.id, 0)
    accumulator[key] = Array.from({ length: count }, (_, index) => ({
      dateKey: row.originDateKey?.trim() ? dateKey : buildInitialSetupMakeupOriginKey(row.id, index),
      slotNumber: row.originSlotNumber ?? undefined,
      reasonLabel: '初期設定',
    }))
    return accumulator
  }, {})
}

function buildInitialSetupLectureStockCountsFromSettings(classroomSettings: ClassroomSettings) {
  return (classroomSettings.initialSetupLectureStocks ?? []).reduce<LectureStockCountMap>((accumulator, row) => {
    const count = Math.max(0, Math.trunc(Number(row.count) || 0))
    if (!row.studentId || !row.subject || !row.sessionId || count <= 0) return accumulator
    accumulator[buildInitialSetupLectureStockKey(row.studentId, row.subject, row.sessionId)] = count
    return accumulator
  }, {})
}

function buildInitialSetupLectureStockOriginsFromSettings(classroomSettings: ClassroomSettings, students: StudentRow[]) {
  const studentNameById = new Map(students.map((student) => [student.id, getStudentDisplayName(student)]))
  return (classroomSettings.initialSetupLectureStocks ?? []).reduce<Record<string, ManualLectureStockOrigin[]>>((accumulator, row) => {
    const count = Math.max(0, Math.trunc(Number(row.count) || 0))
    if (!row.studentId || !row.subject || !row.sessionId || count <= 0) return accumulator
    const key = buildInitialSetupLectureStockKey(row.studentId, row.subject, row.sessionId)
    accumulator[key] = Array.from({ length: count }, () => ({
      displayName: studentNameById.get(row.studentId) ?? row.studentId,
      sessionId: row.sessionId,
    }))
    return accumulator
  }, {})
}

function buildInitialSetupFallbackLectureStudentsFromSettings(classroomSettings: ClassroomSettings, students: StudentRow[]) {
  const studentNameById = new Map(students.map((student) => [student.id, getStudentDisplayName(student)]))
  return (classroomSettings.initialSetupLectureStocks ?? []).reduce<Record<string, { displayName: string; subject?: string }>>((accumulator, row) => {
    const count = Math.max(0, Math.trunc(Number(row.count) || 0))
    if (!row.studentId || !row.subject || !row.sessionId || count <= 0) return accumulator
    const key = buildInitialSetupLectureStockKey(row.studentId, row.subject, row.sessionId)
    accumulator[key] = {
      displayName: studentNameById.get(row.studentId) ?? row.studentId,
      subject: row.subject,
    }
    return accumulator
  }, {})
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
        const freezeDate = params.classroomSettings.templateFreezeBeforeDate ?? ''
        // Pre-freeze week: 全セルが freezeDate 未満なら managed overlay を完全スキップ
        const lastDateKey = week[week.length - 1]?.dateKey ?? ''
        if (freezeDate && lastDateKey < freezeDate) return week

        const firstDateKey = week[0]?.dateKey ?? getReferenceDateKey(new Date())
        const weekStart = getWeekStart(parseDateKey(firstDateKey))
        const managedWeek = createBoardWeek(weekStart, {
          classroomSettings: params.classroomSettings,
          teachers: params.teachers,
          students: params.students,
          regularLessons: params.regularLessons,
        })
        const suppressedKeys = params.initialBoardState?.suppressedRegularLessonOccurrences ?? []
        if (!freezeDate) {
          return overlayBoardWeeksOnScheduleCells(managedWeek, [week], suppressedKeys)
        }
        // Mixed week: セル単位で分離し、pre-freeze セルは board データをそのまま保持
        const preFreezeBoard = week.filter((c) => c.dateKey < freezeDate)
        const postFreezeBoard = week.filter((c) => c.dateKey >= freezeDate)
        const postFreezeManaged = managedWeek.filter((c) => c.dateKey >= freezeDate)
        const postFreezeOverlaid = overlayBoardWeeksOnScheduleCells(postFreezeManaged, [postFreezeBoard], suppressedKeys)
        return [...preFreezeBoard, ...postFreezeOverlaid].sort((a, b) => {
          if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
          return a.slotNumber - b.slotNumber
        })
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
    suppressedRegularLessonOccurrences: [...(params.initialBoardState?.suppressedRegularLessonOccurrences ?? [])],
    scheduleCountAdjustments: cloneScheduleCountAdjustments(params.initialBoardState?.scheduleCountAdjustments ?? []),
    manualMakeupAdjustments: cloneOriginMap(normalizeMakeupOriginMapKeys(params.initialBoardState?.manualMakeupAdjustments ?? buildInitialSetupMakeupAdjustmentsFromSettings(params.classroomSettings), params.students)),
    suppressedMakeupOrigins: cloneOriginMap(normalizeMakeupOriginMapKeys(params.initialBoardState?.suppressedMakeupOrigins ?? {}, params.students)),
    fallbackMakeupStudents: normalizeFallbackMakeupStudentKeys(params.initialBoardState?.fallbackMakeupStudents ?? {}, params.students),
    manualLectureStockCounts: { ...(params.initialBoardState?.manualLectureStockCounts ?? buildInitialSetupLectureStockCountsFromSettings(params.classroomSettings)) },
    manualLectureStockOrigins: cloneManualLectureStockOrigins(params.initialBoardState?.manualLectureStockOrigins ?? buildInitialSetupLectureStockOriginsFromSettings(params.classroomSettings, params.students)),
    fallbackLectureStockStudents: { ...(params.initialBoardState?.fallbackLectureStockStudents ?? buildInitialSetupFallbackLectureStudentsFromSettings(params.classroomSettings, params.students)) },
    isLectureStockOpen: params.initialBoardState?.isLectureStockOpen ?? false,
    isMakeupStockOpen: params.initialBoardState?.isMakeupStockOpen ?? false,
    studentScheduleRange: params.initialBoardState?.studentScheduleRange ?? null,
    teacherScheduleRange: params.initialBoardState?.teacherScheduleRange ?? null,
  }
}

export function createPackedInitialBoardState(params: {
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
}): PersistedBoardState {
  const snapshot = createInitialBoardSnapshot({
    ...params,
    initialBoardState: null,
  })

  // packSortCellDesks はユーザーが「詰めて並び替え」ボタンを押したときだけ適用する。
  // 初期盤面生成時に自動ソートするとテンプレの desk 順序を崩すため除外する。
  return snapshot
}

function resolveOriginalRegularDate(student: StudentEntry, fallbackDateKey: string) {
  return student.makeupSourceDate ?? fallbackDateKey
}

function resolveSuppressedRegularLessonOccurrenceKey(student: StudentEntry, fallbackDateKey: string, fallbackSlotNumber: number) {
  if (student.lessonType !== 'regular') return null
  return buildManagedOccurrenceKey(student, fallbackDateKey, fallbackSlotNumber)
}

function parseOriginSlotNumber(makeupSourceLabel?: string) {
  const matched = String(makeupSourceLabel ?? '').match(/(\d+)限/)
  return matched ? Number(matched[1]) : null
}

function isReturnedToOriginalDate(student: StudentEntry, targetDateKey: string) {
  return Boolean(student.makeupSourceDate && student.makeupSourceDate === targetDateKey)
}

export function normalizeLessonPlacement(student: StudentEntry, targetDateKey: string): StudentEntry {
  if (student.lessonType !== 'makeup' || !isReturnedToOriginalDate(student, targetDateKey)) return student
  return {
    ...student,
    lessonType: 'regular',
  }
}

function formatStockOriginLabel(dateKey: string, slotNumber: number) {
  const date = parseDateKey(dateKey)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}(${calendarDayLabels[date.getDay()]}) ${slotNumber}限`
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
  const managedId = student.managedStudentId ?? managedStudentByAnyName.get(student.name)?.id
  return managedId ?? `name:${resolveBoardStudentDisplayName(student.name)}`
}

export function findDuplicateStudentInCellByKey(
  targetCell: SlotCell,
  studentKey: string,
  resolveComparableStudentKey: (student: StudentEntry) => string,
  excludedStudentId?: string,
) {
  for (const desk of targetCell.desks) {
    for (const student of desk.lesson?.studentSlots ?? []) {
      if (!student || student.id === excludedStudentId) continue
      const existingKey = resolveComparableStudentKey(student)
      if (existingKey === studentKey) {
        return student
      }
    }
  }
  return null
}

function resolveDeskLabel(desk: DeskCell, deskIndex: number) {
  return desk.teacher.trim() || `${deskIndex + 1}机目`
}

function buildStudentStatusEntry(student: StudentEntry, cell: SlotCell, desk: DeskCell, status: StudentStatusKind): StudentStatusEntry {
  return {
    id: `${student.id}_${status}_${Date.now().toString(36)}`,
    studentId: student.id,
    sourceManagedLesson: isManagedLesson(desk.lesson),
    name: student.name,
    managedStudentId: student.managedStudentId,
    grade: student.grade,
    birthDate: student.birthDate,
    noteSuffix: student.noteSuffix,
    makeupSourceDate: student.makeupSourceDate,
    makeupSourceLabel: student.makeupSourceLabel,
    specialSessionId: student.specialSessionId,
    specialStockSource: student.specialStockSource,
    manualAdded: student.manualAdded,
    subject: student.subject,
    lessonType: student.lessonType,
    teacherType: student.teacherType,
    teacherName: desk.teacher,
    dateKey: cell.dateKey,
    slotNumber: cell.slotNumber,
    recordedAt: new Date().toISOString(),
    status,
    sourceLessonId: desk.lesson?.id ?? `restored_${cell.id}_${Date.now().toString(36)}`,
    sourceLessonNote: desk.lesson?.note,
    sourceLessonWarning: desk.lesson?.warning,
  }
}

function buildStudentEntryFromStatus(statusEntry: StudentStatusEntry): StudentEntry {
  return {
    id: statusEntry.studentId,
    name: statusEntry.name,
    managedStudentId: statusEntry.managedStudentId,
    grade: statusEntry.grade,
    birthDate: statusEntry.birthDate,
    noteSuffix: statusEntry.noteSuffix,
    makeupSourceDate: statusEntry.makeupSourceDate,
    makeupSourceLabel: statusEntry.makeupSourceLabel,
    specialSessionId: statusEntry.specialSessionId,
    specialStockSource: statusEntry.specialStockSource,
    manualAdded: statusEntry.manualAdded,
    subject: statusEntry.subject,
    lessonType: statusEntry.lessonType,
    teacherType: statusEntry.teacherType,
  }
}

function restoreStudentToDesk(desk: DeskCell, studentIndex: number, statusEntry: StudentStatusEntry) {
  const restoredStudent = buildStudentEntryFromStatus(statusEntry)
  const nextLesson = desk.lesson
    ? cloneDeskLesson(desk.lesson)
    : {
        id: statusEntry.sourceLessonId,
        note: statusEntry.sourceLessonNote,
        warning: statusEntry.sourceLessonWarning,
        studentSlots: [null, null] as [StudentEntry | null, StudentEntry | null],
      }

  if (!nextLesson.note && statusEntry.sourceLessonNote) nextLesson.note = statusEntry.sourceLessonNote
  if (!nextLesson.warning && statusEntry.sourceLessonWarning) nextLesson.warning = statusEntry.sourceLessonWarning
  nextLesson.studentSlots[studentIndex] = restoredStudent
  desk.lesson = nextLesson
}

function getStudentStockMenuLabel(student: StudentEntry) {
  return student.lessonType === 'special' ? '未消化講習に戻す' : '未消化振替に戻す'
}

function parseDeskOrder(deskId: string) {
  const matched = deskId.match(/_desk_(\d+)$/)
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER
}

function hasMemoInStudentSlot(desk: DeskCell, studentIndex: number) {
  return Boolean(desk.memoSlots?.[studentIndex]?.trim())
}

function isStudentSlotBlocked(desk: DeskCell, studentIndex: number) {
  return Boolean(desk.lesson?.studentSlots[studentIndex]) || hasMemoInStudentSlot(desk, studentIndex)
}

function isStudentSlotFilled(student: StudentEntry | null | undefined): student is StudentEntry {
  return Boolean(student && (student.id || student.name))
}

function resolveDeskPackPriority(desk: DeskCell) {
  const filledStudentCount = desk.lesson?.studentSlots.filter(isStudentSlotFilled).length ?? 0
  if (filledStudentCount >= 2) return 0
  if (filledStudentCount === 1) return 1
  if (desk.teacher.trim()) return 2
  return 3
}

export function packSortCellDesks(cell: SlotCell, options?: { skipStatusSlotPack?: boolean }) {
  const skipStatusSlotPack = options?.skipStatusSlotPack ?? false
  const normalizedDesks = cell.desks.map((desk) => {
    const nextDesk: DeskCell = {
      ...desk,
      memoSlots: desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : undefined,
      statusSlots: desk.statusSlots ? [...desk.statusSlots] as [StudentStatusEntry | null, StudentStatusEntry | null] : undefined,
      lesson: desk.lesson
        ? {
          ...desk.lesson,
          studentSlots: [
            isStudentSlotFilled(desk.lesson.studentSlots[0]) ? { ...desk.lesson.studentSlots[0] } : null,
            isStudentSlotFilled(desk.lesson.studentSlots[1]) ? { ...desk.lesson.studentSlots[1] } : null,
          ] as [StudentEntry | null, StudentEntry | null],
        }
        : undefined,
    }

    if (!nextDesk.lesson) return nextDesk

    const firstStudent = nextDesk.lesson.studentSlots[0]
    const secondStudent = nextDesk.lesson.studentSlots[1]
    const hasSlot0Status = skipStatusSlotPack && nextDesk.statusSlots?.[0] != null
    if (!firstStudent && secondStudent && !hasSlot0Status) {
      nextDesk.lesson.studentSlots = [secondStudent, null]
      if (nextDesk.memoSlots && !nextDesk.memoSlots[0]) {
        nextDesk.memoSlots = [nextDesk.memoSlots[1] ?? null, null]
      }
      if (nextDesk.statusSlots && !nextDesk.statusSlots[0]) {
        nextDesk.statusSlots = [nextDesk.statusSlots[1] ?? null, null]
      }
    }

    // Both slots empty → clear lesson
    if (!nextDesk.lesson.studentSlots[0] && !nextDesk.lesson.studentSlots[1]) {
      nextDesk.lesson = undefined
    }

    return nextDesk
  })

  return normalizedDesks
    .sort((leftDesk, rightDesk) => {
      const leftPriority = resolveDeskPackPriority(leftDesk)
      const rightPriority = resolveDeskPackPriority(rightDesk)
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      const leftTeacherLabel = leftDesk.teacher ?? ''
      const rightTeacherLabel = rightDesk.teacher ?? ''
      const teacherCompare = leftTeacherLabel.localeCompare(rightTeacherLabel, 'ja')
      if (teacherCompare !== 0) return teacherCompare

      return parseDeskOrder(leftDesk.id) - parseDeskOrder(rightDesk.id)
    })
    .map((desk, index) => ({
      ...desk,
      id: `${cell.id}_desk_${index + 1}`,
    }))
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

function createManagedStudentEntry(student: StudentRow, subject: SubjectLabel, dateKey: string, noteSuffix?: string): StudentEntry {
  return {
    id: `${student.id}_${dateKey}_${subject}`,
    name: getStudentDisplayName(student),
    managedStudentId: student.id,
    grade: student.birthDate ? resolveSchoolGradeLabel(student.birthDate, parseDateKey(dateKey)) : '中1',
    birthDate: student.birthDate || undefined,
    noteSuffix: normalizeRegularLessonNote(noteSuffix),
    subject,
    lessonType: 'regular',
    teacherType: 'normal',
  }
}

function resetManagedTeacherAssignment(desk: DeskCell) {
  desk.manualTeacher = false
  desk.teacherAssignmentSource = undefined
  desk.teacherAssignmentSessionId = undefined
  desk.teacherAssignmentTeacherId = undefined
}

export function buildTeacherSelectionOptions(params: {
  teachers: TeacherRow[]
  cell: SlotCell
  deskIndex: number
  isTemplateMode: boolean
  templateReferenceDate?: string
}) {
  const { teachers, cell, deskIndex, isTemplateMode, templateReferenceDate } = params
  const targetDesk = cell.desks[deskIndex]
  if (!targetDesk) return []

  const currentTeacher = teachers.find((teacher) => getTeacherDisplayName(teacher) === targetDesk.teacher || teacher.name === targetDesk.teacher)
  const visibleTeachers = isTemplateMode
    ? teachers.filter((teacher) => resolveTeacherRosterStatus(teacher, templateReferenceDate || cell.dateKey) === '在籍')
    : teachers.filter((teacher) => resolveTeacherRosterStatus(teacher, cell.dateKey) === '在籍')
  const mergedTeachers = currentTeacher && !visibleTeachers.some((teacher) => teacher.id === currentTeacher.id)
    ? [...visibleTeachers, currentTeacher]
    : visibleTeachers

  const otherDeskTeacherNames = new Set(
    cell.desks
      .filter((_, index) => index !== deskIndex)
      .map((desk) => desk.teacher)
      .filter((name) => name.trim()),
  )

  return mergedTeachers
    .filter((teacher) => {
      const displayName = getTeacherDisplayName(teacher)
      if (currentTeacher && teacher.id === currentTeacher.id) return true
      return !otherDeskTeacherNames.has(displayName) && !otherDeskTeacherNames.has(teacher.name)
    })
    .slice()
    .sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja'))
    .map((teacher) => ({ id: teacher.id, name: getTeacherDisplayName(teacher) }))
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
    const scheduledDateKeys = monthDatesInScope.flatMap(({ year, monthIndex }) => getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)).filter((dateKey) => {
      const date = parseDateKey(dateKey)
      if (row.schoolYear !== resolveOperationalSchoolYear(date)) return false
      return true
    })
    if (scheduledDateKeys.length === 0) continue

    const openDateKeys = scheduledDateKeys.filter((dateKey) => {
      const date = parseDateKey(dateKey)
      if (classroomSettings.forceOpenDates.includes(dateKey)) return true
      if (classroomSettings.holidayDates.includes(dateKey)) return false
      if (classroomSettings.closedWeekdays.includes(date.getDay())) return false
      return true
    })

    const student1 = studentById.get(row.student1Id)
    const student2 = studentById.get(row.student2Id)
    const hasAssignedStudents = Boolean(student1 || student2)
    const hasTeacherOnlyDesk = Boolean(row.teacherId) && !hasAssignedStudents
    if (!hasAssignedStudents && !hasTeacherOnlyDesk) continue

    const student1ActiveDateKeys = student1
      ? scheduledDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, dateKey)
        && isActiveOnDate(student1.entryDate, student1.withdrawDate, student1.isHidden, dateKey)
      ))
      : []
    const student2ActiveDateKeys = student2 && row.subject2
      ? scheduledDateKeys.filter((dateKey) => (
        isRegularLessonParticipantActiveOnDate(row, dateKey)
        && isActiveOnDate(student2.entryDate, student2.withdrawDate, student2.isHidden, dateKey)
      ))
      : []

    const student1DateKeys = new Set(student1ActiveDateKeys)
    const student2DateKeys = student2 && row.subject2
      ? new Set(student2ActiveDateKeys)
      : new Set<string>()

    const activeDateKeys = hasTeacherOnlyDesk
      ? openDateKeys.slice().sort((left, right) => left.localeCompare(right))
      : Array.from(new Set([...student1ActiveDateKeys, ...student2ActiveDateKeys]))
          .filter((dateKey) => openDateKeys.includes(dateKey))
          .sort((left, right) => left.localeCompare(right))

    for (const dateKey of activeDateKeys) {
      const cell = cellByDateSlot.get(`${dateKey}_${row.slotNumber}`)
      if (!cell) continue

      const firstStudent = student1 && student1DateKeys.has(dateKey)
        ? createManagedStudentEntry(student1, row.subject1 as SubjectLabel, dateKey, row.student1Note)
        : null
      const secondStudent = student2 && row.subject2 && student2DateKeys.has(dateKey)
        ? createManagedStudentEntry(student2, row.subject2 as SubjectLabel, dateKey, row.student2Note)
        : null

      const participantIds = [
        firstStudent ? row.student1Id : '',
        secondStudent ? row.student2Id : '',
      ].filter(Boolean)
      // テンプレ由来の管理データ配置では、同一講師が複数デスクを担当するケースが
      // 正当に存在するため講師衝突チェックをスキップし、生徒重複のみ確認する
      if (hasRegularPlacementConflict(cell, '', participantIds, teacherById)) continue

      const targetDesk = cell.desks.find((desk) => !desk.lesson && !desk.teacher.trim())
        ?? cell.desks.find((desk) => !desk.lesson && !desk.teacher)
      if (!targetDesk) continue

      // テンプレ由来の管理データ配置では講師の在籍ステータスに関わらず講師名を表示する。
      // テンプレに明示的に設定された講師を忠実に反映し、「講師なし・生徒だけ」の状態を防ぐ。
      targetDesk.teacher = teacher ? getTeacherDisplayName(teacher) : '講師未割当'
      resetManagedTeacherAssignment(targetDesk)

      if (!firstStudent && !secondStudent) {
        targetDesk.lesson = undefined
        continue
      }

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

function cloneStatusSlots(statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]) {
  return statusSlots
    ? statusSlots.map((entry) => (entry ? { ...entry } : null)) as [StudentStatusEntry | null, StudentStatusEntry | null]
    : undefined
}

function cloneSlotCell(cell: SlotCell): SlotCell {
  return {
    ...cell,
    desks: cell.desks.map((desk) => ({
      ...desk,
      statusSlots: cloneStatusSlots(desk.statusSlots),
      lesson: desk.lesson ? cloneDeskLesson(desk.lesson) : undefined,
    })),
  }
}

function mergeManagedDeskLesson(currentLesson: DeskLesson, managedLesson: DeskLesson, dateKey: string) {
  const nextLesson = cloneDeskLesson(managedLesson)

  currentLesson.studentSlots.forEach((student, slotIndex) => {
    if (!student) return

    // Regular (non-manual, non-returned) students are always handled by managed data.
    // Skip them so the managed lesson drives their placement.
    if (student.lessonType === 'regular' && !student.manualAdded && !isReturnedToOriginalDate(student, dateKey)) {
      return
    }

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
      return
    }

    // 管理データの通常生徒で全スロットが埋まっている場合、
    // 盤面の非通常生徒（振替・手動追加等）が元のスロット位置の管理生徒を上書きする。
    // 盤面操作が管理データより優先される。
    nextLesson.studentSlots[slotIndex] = { ...student }
  })

  return nextLesson
}

function buildManagedOccurrenceKey(student: StudentEntry, dateKey: string, slotNumber: number) {
  return `${student.managedStudentId ?? student.name}__${student.subject}__${dateKey}__${slotNumber}`
}

function buildSuppressedManagedOccurrenceKeys(scheduleCells: SlotCell[], boardWeeks: SlotCell[][], explicitlySuppressedKeys: string[] = []) {
  const suppressedKeys = new Set<string>()
  const boardCellIds = new Set(boardWeeks.flat().map((cell) => cell.id))

  explicitlySuppressedKeys.forEach((key) => {
    if (key) suppressedKeys.add(key)
  })

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

  void scheduleCells
  void boardCellIds

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
        teacher: desk.teacher,
        manualTeacher: false,
        teacherAssignmentSource: undefined,
        teacherAssignmentSessionId: undefined,
        teacherAssignmentTeacherId: undefined,
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

function hasPlannedStudentInCell(cell: SlotCell, studentKey: string) {
  return cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => (
    Boolean(student) && (student!.managedStudentId ?? student!.name) === studentKey
  )))
}

function overlayManualRegularAdditionsOnPlannedCells(scheduleCells: SlotCell[], boardWeeks: SlotCell[][]) {
  if (boardWeeks.length === 0) return scheduleCells.map((cell) => cloneSlotCell(cell))

  const boardCellsById = new Map(boardWeeks.flat().map((cell) => [cell.id, cell]))
  return scheduleCells.map((cell) => {
    const boardCell = boardCellsById.get(cell.id)
    const nextCell = cloneSlotCell(cell)
    if (!boardCell) return nextCell

    boardCell.desks.forEach((boardDesk, deskIndex) => {
      boardDesk.lesson?.studentSlots.forEach((boardStudent, studentIndex) => {
        if (!boardStudent || boardStudent.lessonType !== 'regular' || !boardStudent.manualAdded) return

        const studentKey = boardStudent.managedStudentId ?? boardStudent.name
        if (hasPlannedStudentInCell(nextCell, studentKey)) return

        const targetDesk = nextCell.desks[deskIndex]
        if (!targetDesk) return

        if (!targetDesk.lesson) {
          targetDesk.teacher = boardDesk.teacher
          targetDesk.lesson = {
            id: `planned_manual_${cell.id}_${deskIndex + 1}`,
            note: '盤面追加反映',
            studentSlots: [null, null],
          }
        }

        if (!targetDesk.lesson.studentSlots[studentIndex]) {
          targetDesk.lesson.studentSlots[studentIndex] = { ...boardStudent }
          return
        }

        const fallbackDesk = nextCell.desks.find((desk) => !desk.lesson || desk.lesson.studentSlots.some((student) => !student))
        if (!fallbackDesk) return
        if (!fallbackDesk.lesson) {
          fallbackDesk.teacher = boardDesk.teacher
          fallbackDesk.lesson = {
            id: `planned_manual_${cell.id}_fallback`,
            note: '盤面追加反映',
            studentSlots: [null, null],
          }
        }
        const emptySlotIndex = fallbackDesk.lesson.studentSlots.findIndex((student) => !student)
        if (emptySlotIndex >= 0) {
          fallbackDesk.lesson.studentSlots[emptySlotIndex] = { ...boardStudent }
        }
      })
    })

    return nextCell
  })
}

function overlayBoardWeeksOnScheduleCells(scheduleCells: SlotCell[], boardWeeks: SlotCell[][], explicitlySuppressedManagedKeys: string[] = []) {
  const suppressedManagedKeys = buildSuppressedManagedOccurrenceKeys(scheduleCells, boardWeeks, explicitlySuppressedManagedKeys)
  const boardCellsById = new Map(boardWeeks.flat().map((cell) => [cell.id, cell]))
  const managedCellIds = new Set(scheduleCells.map((cell) => cell.id))

  const mergedCells = scheduleCells.map((managedCell) => {
    const adjustedManagedCell = suppressManagedStudentsInCell(managedCell, suppressedManagedKeys)
    const boardCell = boardCellsById.get(managedCell.id)
    if (!boardCell) return adjustedManagedCell
    return mergeManagedWeek([boardCell], [adjustedManagedCell])[0] ?? adjustedManagedCell
  })

  // ボードにあるが managed cells にないセルも結果に追加する。
  // テンプレ反映前日付など managed cells が生成されないケースで
  // ボード上の実績・振替データが日程表から消えないようにする。
  for (const boardCell of boardWeeks.flat()) {
    if (managedCellIds.has(boardCell.id)) continue
    mergedCells.push(cloneSlotCell(boardCell))
  }

  return mergedCells
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

function buildBaseManagedScheduleCellsForRange(params: {
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
  const effectiveRegularLessons = buildCombinedRegularLessonsFromHistory({
    regularLessons: params.regularLessons,
    regularLessonTemplateHistory: params.classroomSettings.regularLessonTemplateHistory,
    teachers: params.teachers,
    students: params.students,
  })
  return buildManagedRegularLessonsRange({
    startDate: normalizedRange.startDate,
    endDate: normalizedRange.endDate,
    deskCount: params.classroomSettings.deskCount,
    classroomSettings: params.classroomSettings,
    teachers: params.teachers,
    students: params.students,
    regularLessons: effectiveRegularLessons,
  })
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
  suppressedRegularLessonOccurrences?: string[]
}) {
  const baseCells = buildBaseManagedScheduleCellsForRange(params)

  return overlayManualRegularAdditionsOnPlannedCells(baseCells, params.boardWeeks)
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
  suppressedRegularLessonOccurrences?: string[]
}) {
  const managedCells = buildBaseManagedScheduleCellsForRange(params)

  return overlayBoardWeeksOnScheduleCells(managedCells, params.boardWeeks, params.suppressedRegularLessonOccurrences ?? [])
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

    // Pre-compute which managed lesson IDs have direct ID matches from board desks
    // so fallback doesn't steal a managed desk that another board desk will ID-match.
    const idMatchedManagedIds = new Set<string>()
    cell.desks.forEach((desk) => {
      if (desk.lesson && isManagedLesson(desk.lesson) && managedDesksByLessonId.has(desk.lesson.id)) {
        idMatchedManagedIds.add(desk.lesson.id)
      }
    })

    const nextDesks = cell.desks.map((desk) => {
      const lesson = desk.lesson
      if (!lesson || !isManagedLesson(lesson)) {
        const hasRecordedStatus = desk.statusSlots?.some((s) => s != null) ?? false
        return {
          ...desk,
          statusSlots: cloneStatusSlots(desk.statusSlots),
          teacher: !lesson && !desk.manualTeacher && !hasRecordedStatus ? '' : desk.teacher,
          manualTeacher: !lesson && !desk.manualTeacher && !hasRecordedStatus ? false : desk.manualTeacher,
          teacherAssignmentSource: desk.manualTeacher ? desk.teacherAssignmentSource : undefined,
          teacherAssignmentSessionId: desk.manualTeacher ? desk.teacherAssignmentSessionId : undefined,
          teacherAssignmentTeacherId: desk.manualTeacher ? desk.teacherAssignmentTeacherId : undefined,
          lesson: lesson ? cloneDeskLesson(lesson) : undefined,
        }
      }

      const managedDesk = managedDesksByLessonId.get(lesson.id)
      if (managedDesk?.lesson) {
        preservedLessonIds.add(lesson.id)
        return {
          ...desk,
          statusSlots: cloneStatusSlots(desk.statusSlots),
          teacher: desk.manualTeacher ? desk.teacher : managedDesk.teacher,
          lesson: mergeManagedDeskLesson(lesson, managedDesk.lesson, cell.dateKey),
        }
      }

      // Fallback: テンプレート行ID変更後にボードのmanaged lesson IDと管理セルのIDが不一致のとき、
      // ボード側に通常生徒（ドロップ対象）が残っている場合のみ、
      // 同じ生徒を含む管理デスクがあればそれをマージ対象にする（直接IDマッチ済みの管理デスクは除外）。
      const hasRegularStudentToPreserve = lesson.studentSlots.some((s) =>
        s && s.lessonType === 'regular' && !s.manualAdded && !isReturnedToOriginalDate(s, cell.dateKey))
      if (hasRegularStudentToPreserve) {
        for (const [mId, md] of managedDesksByLessonId.entries()) {
          if (!md.lesson) continue
          if (idMatchedManagedIds.has(mId) || preservedLessonIds.has(mId)) continue
          const hasSharedStudent = md.lesson.studentSlots.some((ms) =>
            ms && lesson.studentSlots.some((bs) =>
              bs && (bs.managedStudentId && ms.managedStudentId
                ? bs.managedStudentId === ms.managedStudentId
                : bs.name === ms.name)))
          if (hasSharedStudent) {
            preservedLessonIds.add(mId)
            return {
              ...desk,
              statusSlots: cloneStatusSlots(desk.statusSlots),
              teacher: desk.manualTeacher ? desk.teacher : md.teacher,
              lesson: mergeManagedDeskLesson(lesson, md.lesson, cell.dateKey),
            }
          }
        }
      }

      // Managed lesson was fully suppressed (all managed students removed).
      // Preserve any non-managed carryover students (makeup, special, manual additions, returned-to-original).
      const carryoverSlots = lesson.studentSlots.map((s) => {
        if (!s) return null
        if (s.lessonType !== 'regular' || s.manualAdded || isReturnedToOriginalDate(s, cell.dateKey)) return { ...s }
        return null
      }) as [StudentEntry | null, StudentEntry | null]

      if (carryoverSlots[0] || carryoverSlots[1]) {
        preservedLessonIds.add(lesson.id)
        return {
          ...desk,
          statusSlots: cloneStatusSlots(desk.statusSlots),
          lesson: { ...lesson, studentSlots: carryoverSlots },
        }
      }

      return {
        ...desk,
        statusSlots: cloneStatusSlots(desk.statusSlots),
        teacher: desk.manualTeacher ? desk.teacher : '',
        teacherAssignmentSource: desk.manualTeacher ? desk.teacherAssignmentSource : undefined,
        teacherAssignmentSessionId: desk.manualTeacher ? desk.teacherAssignmentSessionId : undefined,
        teacherAssignmentTeacherId: desk.manualTeacher ? desk.teacherAssignmentTeacherId : undefined,
        lesson: undefined,
      }
    })

    // Track managed teacher-only desks consumed by board desks with explicit teacher assignments (e.g. deleted, manual-replaced)
    // or desks where a lesson now exists (e.g. student was moved there)
    const consumedManagedTeacherIndexes = new Set<number>()
    managedCell.desks.forEach((managedDesk, idx) => {
      if (managedDesk.lesson || !managedDesk.teacher.trim()) return
      const boardDesk = nextDesks[idx]
      if (!boardDesk) return
      // If the board desk now has a lesson, the teacher slot is consumed
      if (boardDesk.lesson) {
        consumedManagedTeacherIndexes.add(idx)
        return
      }
      // If the teacher was explicitly managed (deleted or replaced), mark consumed
      if (boardDesk.manualTeacher && (boardDesk.teacherAssignmentSource === 'manual-replaced' || boardDesk.teacherAssignmentSource === 'deleted')) {
        consumedManagedTeacherIndexes.add(idx)
      }
    })

    // Collect teacher names that were explicitly deleted from any desk (regardless of index)
    const deletedTeacherNameSet = new Set<string>()
    nextDesks.forEach((desk) => {
      if (desk.manualTeacher && desk.teacherAssignmentSource === 'deleted' && desk.teacherAssignmentTeacherId) {
        deletedTeacherNameSet.add(desk.teacherAssignmentTeacherId)
      }
    })

    for (let mi = 0; mi < managedCell.desks.length; mi++) {
      const managedDesk = managedCell.desks[mi]
      if (!managedDesk.lesson) {
        if (!managedDesk.teacher.trim()) continue
        if (consumedManagedTeacherIndexes.has(mi)) continue

        // Skip if this teacher is already present on any desk in the cell
        const alreadyPresent = nextDesks.some((desk) => desk.teacher === managedDesk.teacher)
        if (alreadyPresent) continue

        // Skip if this teacher was explicitly deleted from any desk in the cell
        if (deletedTeacherNameSet.has(managedDesk.teacher)) continue

        const targetDesk = nextDesks.find((desk) => !desk.lesson && !desk.manualTeacher && !desk.teacher)
          ?? nextDesks.find((desk) => !desk.lesson && !desk.manualTeacher)

        if (!targetDesk) continue

        targetDesk.teacher = managedDesk.teacher
        targetDesk.manualTeacher = false
        targetDesk.teacherAssignmentSource = undefined
        targetDesk.teacherAssignmentSessionId = undefined
        targetDesk.teacherAssignmentTeacherId = undefined
        targetDesk.lesson = undefined
        continue
      }

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

    // Left-pack student slots: if slot[0] is empty but slot[1] has a student, shift to slot[0]
    // ただしステータス（出席/休み/振無休）が記録されている場合はスキップ
    const packedDesks = nextDesks.map((desk) => {
      if (!desk.lesson || isStudentSlotFilled(desk.lesson.studentSlots[0]) || !isStudentSlotFilled(desk.lesson.studentSlots[1])) return desk
      if (desk.statusSlots?.[0] != null) return desk
      return {
        ...desk,
        lesson: {
          ...desk.lesson,
          studentSlots: [desk.lesson.studentSlots[1], null] as [StudentEntry | null, StudentEntry | null],
        },
        memoSlots: desk.memoSlots && !desk.memoSlots[0]
          ? [desk.memoSlots[1] ?? null, null] as [string | null, string | null]
          : desk.memoSlots,
        statusSlots: desk.statusSlots && !desk.statusSlots[0]
          ? [desk.statusSlots[1] ?? null, null] as [StudentStatusEntry | null, StudentStatusEntry | null]
          : desk.statusSlots,
      }
    })

    return {
      ...cell,
      isOpenDay: managedCell.isOpenDay,
      desks: packedDesks,
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

function setManualTeacherAssignment(desk: DeskCell, teacherName: string, teacherId?: string, assignmentSource: 'manual' | 'manual-replaced' = 'manual') {
  desk.teacher = teacherName
  desk.manualTeacher = true
  desk.teacherAssignmentSource = assignmentSource
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
  restoreSessionStock?: boolean
}) {
  const nextWeeks = cloneWeeks(params.weeks)
  const clearedSessionAdjustments = clearLectureStockAdjustmentsForStudentSession({
    countMap: params.manualLectureStockCounts,
    originMap: params.manualLectureStockOrigins,
    fallbackStudents: params.fallbackLectureStockStudents,
    studentKey: params.student.id,
    sessionId: params.session.id,
  })
  let nextManualLectureStockCounts = { ...clearedSessionAdjustments.nextCountMap }
  let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(clearedSessionAdjustments.nextOriginMap)
  let nextFallbackLectureStockStudents = { ...clearedSessionAdjustments.nextFallbackStudents }
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
        if (lesson) {
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

          if (params.restoreSessionStock && studentEntry.specialStockSource === 'session') {
            const lectureStockKey = buildLectureStockKey(params.student.id, studentEntry.subject, params.session.id)
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

        if (desk.statusSlots) {
          desk.statusSlots.forEach((statusEntry, statusIndex) => {
            if (!statusEntry) return
            if (statusEntry.lessonType !== 'special') return
            const statusNameKey = normalizeStudentNameKey(statusEntry.name)
            const matchesStudent = statusEntry.managedStudentId === params.student.id
              || statusNameKey === registeredStudentNameKey
              || statusNameKey === displayStudentNameKey
            if (!matchesStudent) return
            if (statusEntry.specialSessionId) {
              if (statusEntry.specialSessionId !== params.session.id) return
            } else if (
              statusEntry.specialStockSource !== 'session'
              || cell.dateKey < params.session.startDate
              || cell.dateKey > params.session.endDate
            ) {
              return
            }
            setDeskStudentStatus(desk, statusIndex, null)
            clearedCellCount += 1
            hasChanges = true
          })
        }
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

export function ScheduleBoardScreen({ classroomSettings, classroomName, teachers, students, regularLessons, specialSessions, autoAssignRules, pairConstraints, teacherAutoAssignRequest, studentScheduleRequest, initialBoardState, onBoardStateChange, onReplaceRegularLessons, onUpdateSpecialSessions, onUpdateClassroomSettings, onOpenBasicData, onOpenSpecialData, onOpenAutoAssignRules, onOpenBackupRestore, onPreTemplateSaveBackup, undoSnapshotLabel, onRestoreUndoSnapshot, onDismissUndoSnapshot, onLogout }: ScheduleBoardScreenProps) {
  void onUpdateSpecialSessions
  const boardExportRef = useRef<HTMLDivElement | null>(null)
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
  const [selectedMakeupStockRawKey, setSelectedMakeupStockRawKey] = useState<string | null>(null)
  const [selectedLectureStockKey, setSelectedLectureStockKey] = useState<string | null>(null)
  const [selectedHolidayDate, setSelectedHolidayDate] = useState<string | null>(null)
  const [dayHeaderMenu, setDayHeaderMenu] = useState<{ dateKey: string; x: number; y: number } | null>(null)
  const [studentMenu, setStudentMenu] = useState<StudentMenuState | null>(null)
  const [memoDraft, setMemoDraft] = useState('')
  const [editStudentDraft, setEditStudentDraft] = useState<EditStudentDraft | null>(null)
  const [addExistingStudentDraft, setAddExistingStudentDraft] = useState<AddExistingStudentDraft | null>(null)
  const [trialStudentDraft, setTrialStudentDraft] = useState<TrialStudentDraft | null>(null)
  const [statusMessage, setStatusMessage] = useState('左クリックで生徒を選ぶか、空欄の生徒マスを左クリックしてメモを保存できます。')
  const [suppressedRegularLessonOccurrences, setSuppressedRegularLessonOccurrences] = useState<string[]>(initialBoardSnapshot.suppressedRegularLessonOccurrences)
  const [scheduleCountAdjustments, setScheduleCountAdjustments] = useState<ScheduleCountAdjustmentEntry[]>(initialBoardSnapshot.scheduleCountAdjustments)
  const [manualMakeupAdjustments, setManualMakeupAdjustments] = useState<MakeupOriginMap>(initialBoardSnapshot.manualMakeupAdjustments)
  const [suppressedMakeupOrigins, setSuppressedMakeupOrigins] = useState<MakeupOriginMap>(initialBoardSnapshot.suppressedMakeupOrigins)
  const [fallbackMakeupStudents, setFallbackMakeupStudents] = useState<Record<string, FallbackMakeupStudent>>(initialBoardSnapshot.fallbackMakeupStudents)
  const [manualLectureStockCounts, setManualLectureStockCounts] = useState<LectureStockCountMap>(initialBoardSnapshot.manualLectureStockCounts)
  const [manualLectureStockOrigins, setManualLectureStockOrigins] = useState<Record<string, ManualLectureStockOrigin[]>>(initialBoardSnapshot.manualLectureStockOrigins)
  const [fallbackLectureStockStudents, setFallbackLectureStockStudents] = useState<Record<string, { displayName: string; subject?: string }>>(initialBoardSnapshot.fallbackLectureStockStudents)
  const [isLectureStockOpen, setIsLectureStockOpen] = useState(initialBoardSnapshot.isLectureStockOpen)
  const [isMakeupStockOpen, setIsMakeupStockOpen] = useState(initialBoardSnapshot.isMakeupStockOpen)
  const [isPrintingPdf, setIsPrintingPdf] = useState(false)
  const [isTemplateMode, setIsTemplateMode] = useState(false)
  const [templateCells, setTemplateCells] = useState<SlotCell[]>([])
  const [templateEffectiveStartDate, setTemplateEffectiveStartDate] = useState('')
  const [templateEditDraft, setTemplateEditDraft] = useState<TemplateEditDraft | null>(null)
  const [templateAddDraft, setTemplateAddDraft] = useState<TemplateAddDraft | null>(null)
  const [templateUndoStack, setTemplateUndoStack] = useState<TemplateHistoryEntry[]>([])
  const [templateRedoStack, setTemplateRedoStack] = useState<TemplateHistoryEntry[]>([])
  const templateFileInputRef = useRef<HTMLInputElement | null>(null)
  const [templateSaveConfirm, setTemplateSaveConfirm] = useState<TemplateSaveConfirmState | null>(null)
  const [templateImportDateOptions, setTemplateImportDateOptions] = useState<{ dates: string[]; xlsxModule: typeof import('xlsx'); workbook: import('xlsx').WorkBook } | null>(null)
  const [activeStockAutoAssignKey, setActiveStockAutoAssignKey] = useState<string | null>(null)
  const [isStudentScheduleOpen, setIsStudentScheduleOpen] = useState(() => hasOpenSchedulePopup('student'))
  const [isTeacherScheduleOpen, setIsTeacherScheduleOpen] = useState(() => hasOpenSchedulePopup('teacher'))
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.studentScheduleRange)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(initialBoardSnapshot.teacherScheduleRange)
  const [stockActionModal, setStockActionModal] = useState<StockActionModalState | null>(null)
  const [stockPanelsRestoreState, setStockPanelsRestoreState] = useState<StockPanelsRestoreState | null>(null)
  const [autoAssignDebugReport, setAutoAssignDebugReport] = useState<AutoAssignDebugReport | null>(null)
  const [scheduleSyncTrigger, setScheduleSyncTrigger] = useState(0)
  const boardInteractionTokenRef = useRef(createInteractionLockToken('board'))
  const [interactionLockOwner, setInteractionLockOwner] = useState<InteractionSurface | null>(() => parseInteractionLockOwner(typeof window === 'undefined' ? null : window.localStorage.getItem(interactionLockStorageKey)))
  const [teacherMenu, setTeacherMenu] = useState<TeacherMenuState | null>(null)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [pointerPreviewPosition, setPointerPreviewPosition] = useState({ x: 0, y: 0 })
  const processedTeacherAutoAssignRequestIdRef = useRef<number | null>(null)
  const processedStudentScheduleRequestIdRef = useRef<number | null>(null)
  const prevUnsubmittedSessionStudentKeysRef = useRef<Set<string>>(new Set())

  const handleEnterTemplateMode = useCallback(() => {
    const savedTemplate = classroomSettings.regularLessonTemplate
    const today = toDateKey(new Date())
    const filteredTemplate = savedTemplate
      ? filterTemplateParticipantsForReferenceDate({ template: savedTemplate, deskCount: classroomSettings.deskCount, teachers, students, referenceDate: today })
      : null
    const templateBoardCells = filteredTemplate
      ? buildTemplateBoardCells({ template: filteredTemplate, teachers, students, deskCount: classroomSettings.deskCount })
      : copyBoardCellsForTemplate(cells)
    setTemplateCells(templateBoardCells)
    setTemplateEffectiveStartDate(filteredTemplate?.effectiveStartDate || today)
    setIsTemplateMode(true)
    setStudentMenu(null)
    setTeacherMenu(null)
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setSelectedLectureStockKey(null)
    setIsLectureStockOpen(false)
    setIsMakeupStockOpen(false)
    setTemplateEditDraft(null)
    setTemplateAddDraft(null)
    setTemplateUndoStack([])
    setTemplateRedoStack([])
    setStatusMessage(savedTemplate ? '通常授業テンプレート編集モードです。前回のテンプレートを読み込みました。' : '通常授業テンプレート編集モードです。コマ表から通常授業のみコピーしました。')
  }, [cells, classroomSettings.deskCount, classroomSettings.regularLessonTemplate, students, teachers])

  const handleExitTemplateMode = useCallback(() => {
    setIsTemplateMode(false)
    setTemplateCells([])
    setStudentMenu(null)
    setTeacherMenu(null)
    setSelectedStudentId(null)
    setTemplateEditDraft(null)
    setTemplateAddDraft(null)
    setStatusMessage('コマ表に戻りました。')
  }, [])

  const pushTemplateUndo = useCallback((currentCells: SlotCell[]) => {
    setTemplateUndoStack((prev) => [...prev, { cells: currentCells.map((c) => ({ ...c, desks: c.desks.map((d) => ({ ...d, lesson: d.lesson ? { ...d.lesson, studentSlots: [...d.lesson.studentSlots] as [StudentEntry | null, StudentEntry | null] } : undefined })) })) }])
    setTemplateRedoStack([])
  }, [])

  const handleTemplateUndo = useCallback(() => {
    setTemplateUndoStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setTemplateRedoStack((redo) => [...redo, { cells: templateCells.map((c) => ({ ...c, desks: c.desks.map((d) => ({ ...d, lesson: d.lesson ? { ...d.lesson, studentSlots: [...d.lesson.studentSlots] as [StudentEntry | null, StudentEntry | null] } : undefined })) })) }])
      setTemplateCells(last.cells)
      return prev.slice(0, -1)
    })
  }, [templateCells])

  const handleTemplateRedo = useCallback(() => {
    setTemplateRedoStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setTemplateUndoStack((undo) => [...undo, { cells: templateCells.map((c) => ({ ...c, desks: c.desks.map((d) => ({ ...d, lesson: d.lesson ? { ...d.lesson, studentSlots: [...d.lesson.studentSlots] as [StudentEntry | null, StudentEntry | null] } : undefined })) })) }])
      setTemplateCells(last.cells)
      return prev.slice(0, -1)
    })
  }, [templateCells])

  const handleSaveRegularLessonTemplate = useCallback((template: RegularLessonTemplate, overwrite: boolean) => {
    // テンプレ上書き前にバックアップを保存（非同期、完了を待たない）
    if (overwrite && onPreTemplateSaveBackup) {
      void onPreTemplateSaveBackup()
    }

    const normalizedTemplateRegularLessons = buildRegularLessonsFromTemplate({
      template,
      teachers,
      students,
    })

    // テンプレート履歴を更新: effectiveStartDate >= 新テンプレの開始日を除去し、新テンプレを追加
    const prevHistory = classroomSettings.regularLessonTemplateHistory ?? []
    const nextHistory = [
      ...prevHistory.filter((h) => h.effectiveStartDate < template.effectiveStartDate),
      template,
    ]

    onUpdateClassroomSettings({
      ...classroomSettings,
      regularLessonTemplate: template,
      regularLessonTemplateHistory: nextHistory,
      ...(overwrite ? { templateFreezeBeforeDate: template.effectiveStartDate } : {}),
    })
    onReplaceRegularLessons?.(normalizedTemplateRegularLessons)

    if (overwrite) {
      const effectiveStart = template.effectiveStartDate

      // Return makeup/lecture students to stock before clearing
      let nextManualLectureStockCounts = { ...manualLectureStockCounts }
      let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(manualLectureStockOrigins)
      const nextFallbackLectureStockStudents = { ...fallbackLectureStockStudents }
      let nextManualMakeupAdjustments = Object.fromEntries(
        Object.entries(manualMakeupAdjustments)
          .map(([key, origins]) => [key, origins.filter((origin) => origin.dateKey < effectiveStart)])
          .filter(([, origins]) => (origins as ManualMakeupOrigin[]).length > 0),
      ) as MakeupOriginMap
      const nextFallbackMakeupStudents = { ...fallbackMakeupStudents }
      let restoredCount = 0

      for (const week of weeks) {
        for (const cell of week) {
          const isInEffectiveRange = cell.dateKey >= effectiveStart
          if (!isInEffectiveRange) continue
          for (const desk of cell.desks) {
            // (A) effectiveStart以降の通常授業セル: 振替・講習を未消化へ返す
            for (const student of desk.lesson?.studentSlots ?? []) {
              if (!student) continue
              if (student.lessonType === 'special' && student.specialStockSource === 'session') {
                const lectureStudentKey = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
                const lectureStockKey = buildLectureStockKey(lectureStudentKey, student.subject, student.specialSessionId)
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
                restoredCount += 1
              }
              if (student.lessonType === 'makeup' && !student.manualAdded) {
                const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(student), student.subject)
                // Pre-freeze origins are already preserved by the initial dateKey < effectiveStart filter.
                // Re-appending them would create duplicate stock entries.
                // Post-freeze origins は復元しない:
                // テンプレ上書きで全抑制がクリアされ通常授業が再配置されるため、
                // 手動調整を復元すると「ボード上に通常授業 + ストックに未消化」の二重計上が発生する。
                // 実際のショートage（占有スロット、休日）は管理セル再構築で自動再計算される。
                const managedStudent = managedStudentByAnyName.get(student.name)
                if (!managedStudent) {
                  nextFallbackMakeupStudents[stockKey] = {
                    studentName: student.name,
                    displayName: resolveBoardStudentDisplayName(student.name),
                    subject: student.subject,
                  }
                }
                restoredCount += 1
              }
            }
            // (C) effectiveStart以降のabsent statusSlots が作った未消化振替・講習を相殺
            // ※ studentSlots ループの外で1回だけ処理する（二重相殺を防止）
            for (const statusEntry of desk.statusSlots ?? []) {
              if (!statusEntry || statusEntry.status !== 'absent') continue
              if (statusEntry.lessonType === 'special' && statusEntry.specialStockSource === 'session') {
                const lectureStudentKey = managedStudentByAnyName.get(statusEntry.name)?.id ?? `name:${resolveBoardStudentDisplayName(statusEntry.name)}`
                const lectureStockKey = buildLectureStockKey(lectureStudentKey, statusEntry.subject, statusEntry.specialSessionId ?? '')
                nextManualLectureStockCounts = removeLectureStockCount(nextManualLectureStockCounts, lectureStockKey)
                nextManualLectureStockOrigins = removeManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, { sessionId: statusEntry.specialSessionId })
              } else if (statusEntry.lessonType === 'regular' || !statusEntry.makeupSourceDate) {
                const restoredStudent = buildStudentEntryFromStatus(statusEntry)
                const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(restoredStudent), statusEntry.subject)
                nextManualMakeupAdjustments = removeMakeupOrigin(nextManualMakeupAdjustments, stockKey, resolveOriginalRegularDate(restoredStudent, statusEntry.dateKey))
              }
            }
          }
        }
      }

      setManualLectureStockCounts({ ...nextManualLectureStockCounts })
      setManualLectureStockOrigins(cloneManualLectureStockOrigins(nextManualLectureStockOrigins))
      setFallbackLectureStockStudents({ ...nextFallbackLectureStockStudents })
      setManualMakeupAdjustments(cloneOriginMap(nextManualMakeupAdjustments))
      setFallbackMakeupStudents(nextFallbackMakeupStudents)

      // (D) effectiveStart以降に削除された通常授業・振替の suppressed 抑制をクリア
      // （テンプレで通常授業が再生成されるため、抑制が残ると未消化が正しく計算されない）
      const nextSuppressedMakeupOrigins = Object.fromEntries(
        Object.entries(suppressedMakeupOrigins)
          .map(([key, origins]) => [key, origins.filter((origin) => origin.dateKey < effectiveStart)])
          .filter(([, origins]) => (origins as ManualMakeupOrigin[]).length > 0),
      ) as MakeupOriginMap

      // (E) effectiveStart以降の授業削除による希望回数補正をクリア
      // （テンプレで通常授業が再生成されるため、削除補正が残ると希望回数が二重に減る）
      const nextScheduleCountAdjustments = scheduleCountAdjustments.filter((adj) => adj.dateKey < effectiveStart)

      // (F) effectiveStart以降の通常授業抑制をクリア（テンプレで通常授業が再生成されるため）
      const nextSuppressedRegularLessonOccurrences = suppressedRegularLessonOccurrences.filter((key) => {
        const parts = key.split('__')
        const dateKey = parts[2] ?? ''
        return dateKey < effectiveStart
      })

      const clearedWeeks = weeks.map((week) =>
        week.map((cell) => {
          if (cell.dateKey >= effectiveStart) {
            // effectiveStart以降は全てクリア
            return {
              ...cell,
              desks: cell.desks.map((desk) => ({
                ...desk,
                teacher: '',
                manualTeacher: false,
                teacherAssignmentSource: undefined,
                teacherAssignmentSessionId: undefined,
                teacherAssignmentTeacherId: undefined,
                memoSlots: undefined,
                statusSlots: undefined,
                lesson: undefined,
              })),
            }
          }
          // effectiveStart以前のセルは一切変更しない（禁忌: テンプレ反映日以前のコマ表は不変）
          return cell
        }),
      )

      // テンプレ上書き直後に managed overlay を即時適用する。
      // setWeeks(clearedWeeks) だけでは管理データ反映が次回マウント時まで遅延し、
      // その間ストック計算が空セルを参照して未消化が増加するバグが発生する。
      const nextClassroomSettingsForOverlay: ClassroomSettings = {
        ...classroomSettings,
        regularLessonTemplate: template,
        regularLessonTemplateHistory: nextHistory,
        templateFreezeBeforeDate: template.effectiveStartDate,
      }
      const allManagedWeeks: SlotCell[][] = []
      const overlaidWeeks = clearedWeeks.map((week) => {
        const firstDateKey = week[0]?.dateKey ?? ''
        if (!firstDateKey) return week
        const lastDateKey = week[week.length - 1]?.dateKey ?? ''
        if (lastDateKey < effectiveStart) return week
        const weekStart = getWeekStart(parseDateKey(firstDateKey))
        const managedWeek = createBoardWeek(weekStart, {
          classroomSettings: nextClassroomSettingsForOverlay,
          teachers,
          students,
          regularLessons: normalizedTemplateRegularLessons,
        })
        allManagedWeeks.push(managedWeek)
        const preFreezeBoard = week.filter((c) => c.dateKey < effectiveStart)
        const postFreezeBoard = week.filter((c) => c.dateKey >= effectiveStart)
        const postFreezeManaged = managedWeek.filter((c) => c.dateKey >= effectiveStart)
        const postFreezeOverlaid = overlayBoardWeeksOnScheduleCells(postFreezeManaged, [postFreezeBoard], nextSuppressedRegularLessonOccurrences)
        return [...preFreezeBoard, ...postFreezeOverlaid].sort((a, b) => {
          if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
          return a.slotNumber - b.slotNumber
        })
      })

      setWeeks(overlaidWeeks)
      setScheduleCountAdjustments(cloneScheduleCountAdjustments(nextScheduleCountAdjustments))
      setSuppressedMakeupOrigins(nextSuppressedMakeupOrigins)
      setSuppressedRegularLessonOccurrences(nextSuppressedRegularLessonOccurrences)
      if (restoredCount > 0) {
        setStatusMessage(`通常授業テンプレートを上書き保存しました。${template.effectiveStartDate} 以降のコマ表をテンプレ内容で再構築します。${restoredCount}件の振替・講習を未消化ストックへ戻しました。`)
      } else {
        setStatusMessage(`通常授業テンプレートを上書き保存しました。${template.effectiveStartDate} 以降のコマ表をテンプレ内容で再構築します。`)
      }
    } else {
      setStatusMessage(`通常授業テンプレートを上書き保存しました。${template.effectiveStartDate} 以降のコマ表をテンプレ内容で再構築します。`)
    }

    setIsTemplateMode(false)
    setTemplateCells([])
    setTemplateSaveConfirm(null)
  }, [classroomSettings, fallbackLectureStockStudents, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, manualMakeupAdjustments, onPreTemplateSaveBackup, onReplaceRegularLessons, onUpdateClassroomSettings, students, teachers, weeks, suppressedRegularLessonOccurrences, scheduleCountAdjustments, suppressedMakeupOrigins])

  useEffect(() => {
    if (!onBoardStateChange) return
    onBoardStateChange({
      weeks: cloneWeeks(weeks),
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      suppressedRegularLessonOccurrences: [...suppressedRegularLessonOccurrences],
      scheduleCountAdjustments: cloneScheduleCountAdjustments(scheduleCountAdjustments),
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
    scheduleCountAdjustments,
    selectedCellId,
    selectedDeskIndex,
    suppressedRegularLessonOccurrences,
    studentScheduleRange,
    suppressedMakeupOrigins,
    teacherScheduleRange,
    weekIndex,
    weeks,
  ])

  useEffect(() => {
    const freezeDate = classroomSettings.templateFreezeBeforeDate ?? ''
    setWeeks((currentWeeks) => normalizeWeeksDeskCount(currentWeeks.map((week) => {
      // Pre-freeze week: 全セルが freezeDate 未満なら managed overlay を完全スキップ（禁忌: テンプレ反映日以前のコマ表は不変）
      const lastDateKey = week[week.length - 1]?.dateKey ?? ''
      if (freezeDate && lastDateKey < freezeDate) return week

      const firstDateKey = week[0]?.dateKey ?? getReferenceDateKey(new Date())
      const weekStart = getWeekStart(parseDateKey(firstDateKey))
      const managedWeek = createBoardWeek(weekStart, { classroomSettings, teachers, students, regularLessons })
      if (!freezeDate) {
        return overlayBoardWeeksOnScheduleCells(managedWeek, [week], suppressedRegularLessonOccurrences)
      }
      // Mixed week: セル単位で分離し、pre-freeze セルは board データをそのまま保持
      const preFreezeBoard = week.filter((c) => c.dateKey < freezeDate)
      const postFreezeBoard = week.filter((c) => c.dateKey >= freezeDate)
      const postFreezeManaged = managedWeek.filter((c) => c.dateKey >= freezeDate)
      const postFreezeOverlaid = overlayBoardWeeksOnScheduleCells(postFreezeManaged, [postFreezeBoard], suppressedRegularLessonOccurrences)
      return [...preFreezeBoard, ...postFreezeOverlaid].sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
        return a.slotNumber - b.slotNumber
      })
    }), classroomSettings.deskCount))
  }, [classroomSettings, teachers, students, regularLessons, suppressedRegularLessonOccurrences])

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
    const currentUnsubmittedKeys = new Set<string>()
    const pendingUnsubmittedSessionStudents = specialSessions.flatMap((session) => Object.entries(session.studentInputs)
      .filter(([, input]) => !input.countSubmitted)
      .map(([studentId]) => {
        currentUnsubmittedKeys.add(`${session.id}__${studentId}`)
        return { session, student: students.find((entry) => entry.id === studentId) ?? null }
      }))
      .filter((entry): entry is { session: SpecialSessionRow; student: StudentRow } => Boolean(entry.student))

    // Only clean up student+session pairs that are newly unsubmitted (not previously known)
    const prevKeys = prevUnsubmittedSessionStudentKeysRef.current
    const newlyUnsubmitted = pendingUnsubmittedSessionStudents.filter(
      ({ session, student }) => !prevKeys.has(`${session.id}__${student.id}`),
    )
    prevUnsubmittedSessionStudentKeysRef.current = currentUnsubmittedKeys

    if (newlyUnsubmitted.length === 0) return

    let nextWeeks = cloneWeeks(normalizedWeeks)
    let nextManualLectureStockCounts = { ...manualLectureStockCounts }
    let nextManualLectureStockOrigins = cloneManualLectureStockOrigins(manualLectureStockOrigins)
    let nextFallbackLectureStockStudents = { ...fallbackLectureStockStudents }
    let hasChanges = false

    for (const { session, student } of newlyUnsubmitted) {
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
    requestSchedulePopupInteractionYield()
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

  useEffect(() => {
    const handlePopupReady = (event: MessageEvent) => {
      const message = event.data
      if (!message || message.type !== 'schedule-popup-ready') return
      setScheduleSyncTrigger((prev) => prev + 1)
    }
    window.addEventListener('message', handlePopupReady)
    return () => window.removeEventListener('message', handlePopupReady)
  }, [])

  const displayWeekDate = cells[0]?.dateKey ?? getReferenceDateKey(new Date())
  const currentGradeReferenceDate = getReferenceDateKey(new Date())

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

  const resolveBoardStudentDisplayName = useCallback((name: string) => managedStudentNameMap.get(name) ?? name, [managedStudentNameMap])
  const resolveBoardStudentGradeLabel = (name: string, fallbackGrade: string, dateKey: string, birthDate?: string) => {
    if (birthDate) return resolveSchoolGradeLabel(birthDate, parseDateKey(dateKey))
    const managedStudent = managedStudentByAnyName.get(name)
    if (!managedStudent?.birthDate) return fallbackGrade
    return resolveSchoolGradeLabel(managedStudent.birthDate, parseDateKey(dateKey))
  }
  const resolveDisplayedBoardSubject = useCallback((student: Pick<StudentEntry, 'subject' | 'grade' | 'birthDate'>, dateKey: string) => {
    const gradeLabel = student.birthDate
      ? resolveGradeLabelFromBirthDate(student.birthDate, dateKey)
      : student.grade
    return resolveDisplayedSubjectForGrade(student.subject, gradeLabel)
  }, [])
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
  const resolveBoardStudentStockId = (student: StudentEntry) => {
    const managedId = student.managedStudentId ?? managedStudentByAnyName.get(student.name)?.id
    if (managedId) return managedId

    const fallbackId = `name:${resolveBoardStudentDisplayName(student.name)}`
    return student.manualAdded ? `manual:${fallbackId}` : fallbackId
  }
  const getSelectableSubjectsForStudent = useCallback((student: StudentRow | null, dateKey: string) => {
    if (!student) return editableSubjects
    const gradeLabel = resolveSchoolGradeLabel(student.birthDate, parseDateKey(dateKey))
    return getSelectableStudentSubjectsForGrade(gradeLabel)
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
        const leftStudent = left.studentId ? students.find((student) => student.id === left.studentId) ?? null : null
        const rightStudent = right.studentId ? students.find((student) => student.id === right.studentId) ?? null : null
        if (leftStudent && rightStudent) return compareStudentsByCurrentGradeThenName(leftStudent, rightStudent, currentGradeReferenceDate)
        if (leftStudent) return -1
        if (rightStudent) return 1
        return left.displayName.localeCompare(right.displayName, 'ja')
      })
  }, [currentGradeReferenceDate, rawMakeupStockEntries, students])

  const makeupStockTotalCount = useMemo(
    () => makeupStockEntries.reduce((total, entry) => total + Math.max(0, entry.balance), 0),
    [makeupStockEntries],
  )

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
      const stockKey = buildLectureStockKey(stockEntry.studentId, stockEntry.subject, stockEntry.sessionId)
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
      const { studentKey, subject, sessionId } = parseLectureStockKey(stockKey)
      const fallback = fallbackLectureStockStudents[stockKey]
      const fallbackDisplayName = fallback?.displayName ?? studentKey.replace(/^name:/, '')
      const metadataQueue = metadataQueueByKey.get(stockKey) ?? []

      for (let index = 0; index < requestedCount; index += 1) {
        const metadata = metadataQueue.shift()
        const resolvedSessionId = metadata?.sessionId ?? sessionId
        const session = resolvedSessionId
          ? specialSessions.find((currentSession) => currentSession.id === resolvedSessionId) ?? null
          : null
        const scopeKey = buildLectureStockScopeKey(studentKey, resolvedSessionId)
        const currentItems = scopedItems.get(scopeKey) ?? []
        currentItems.push({
          studentKey,
          studentId: studentKey.startsWith('name:') ? null : studentKey,
          displayName: metadata?.displayName ?? fallbackDisplayName,
          item: {
            subject: (fallback?.subject ?? subject) as SubjectLabel,
            source: 'manual',
            sessionId: resolvedSessionId,
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
      const leftStudent = left.studentId ? students.find((student) => student.id === left.studentId) ?? null : null
      const rightStudent = right.studentId ? students.find((student) => student.id === right.studentId) ?? null : null
      if (leftStudent && rightStudent) {
        const studentCompare = compareStudentsByCurrentGradeThenName(leftStudent, rightStudent, currentGradeReferenceDate)
        if (studentCompare !== 0) return studentCompare
      } else if (leftStudent || rightStudent) {
        return leftStudent ? -1 : 1
      } else {
        const nameCompare = left.displayName.localeCompare(right.displayName, 'ja')
        if (nameCompare !== 0) return nameCompare
      }
      const leftStart = left.sessionId
        ? (specialSessions.find((session) => session.id === left.sessionId)?.startDate ?? '9999-12-31')
        : '9999-12-31'
      const rightStart = right.sessionId
        ? (specialSessions.find((session) => session.id === right.sessionId)?.startDate ?? '9999-12-31')
        : '9999-12-31'
      if (leftStart !== rightStart) return leftStart.localeCompare(rightStart)
      return (left.sessionLabel ?? '盤面からストック').localeCompare(right.sessionLabel ?? '盤面からストック', 'ja')
    })
  }, [currentGradeReferenceDate, lecturePendingItemsByEntryKey, specialSessions, students])

  const runStockAutoAssign = async (entryKey: string, runner: () => void) => {
    setActiveStockAutoAssignKey(entryKey)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    try {
      runner()
    } finally {
      setActiveStockAutoAssignKey(null)
    }
  }

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
  const autoAssignDebugLabelOrder = useMemo(() => {
    const labelByRuleKey: Partial<Record<AutoAssignRuleKey, string>> = {
      subjectCapableTeachersOnly: '科目対応講師',
      regularTeachersOnly: '通常担当講師',
      forbidFirstPeriod: '1限回避',
    }
    const labelByGroupKey: Record<LectureConstraintGroupKey, string> = {
      'day-spacing': '登校日集約/分散',
      'two-students': '2人同席優先',
      'lesson-limit': '同日授業数上限',
      'lesson-pattern': '授業並び方',
      'time-preference': '時限希望',
    }

    return [
      ...autoAssignRules
        .filter((rule) => forcedAutoAssignRuleKeys.has(rule.key))
        .map((rule) => labelByRuleKey[rule.key])
        .filter((label): label is string => Boolean(label)),
      ...lectureConstraintGroups.map((group) => labelByGroupKey[group.key]),
    ].filter((label, index, labels) => labels.indexOf(label) === index)
  }, [autoAssignRules, lectureConstraintGroups])
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
        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          for (let studentIndex = 0; studentIndex < (desk.lesson?.studentSlots.length ?? 0); studentIndex += 1) {
            const student = desk.lesson?.studentSlots[studentIndex]
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

  const collectStudentOccurrencesOnDate = (sourceWeeks: SlotCell[][], studentKey: string, dateKey: string) => {
    const lessons: Array<{ occurrenceKey: string; slotNumber: number; lessonType: LessonType }> = []
    for (const week of sourceWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== dateKey) continue
        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          for (let studentIndex = 0; studentIndex < (desk.lesson?.studentSlots.length ?? 0); studentIndex += 1) {
            const student = desk.lesson?.studentSlots[studentIndex]
            if (!student) continue
            const currentKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
            if (currentKey !== studentKey) continue
            lessons.push({
              occurrenceKey: buildStudentWarningLocationKey(cell.id, deskIndex, studentIndex),
              slotNumber: cell.slotNumber,
              lessonType: student.lessonType,
            })
          }
        }
      }
    }
    return lessons
  }

  const collectStudentAssignedDateKeys = (sourceWeeks: SlotCell[][], studentKey: string) => {
    const dateKeys = new Set<string>()
    for (const week of sourceWeeks) {
      for (const cell of week) {
        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          for (let studentIndex = 0; studentIndex < (desk.lesson?.studentSlots.length ?? 0); studentIndex += 1) {
            const student = desk.lesson?.studentSlots[studentIndex]
            if (!student) continue
            const currentKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
            if (currentKey !== studentKey) continue
            dateKeys.add(cell.dateKey)
          }
        }
      }
    }
    return Array.from(dateKeys).sort()
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

  const buildCommonAutoAssignScoreParts = (params: {
    studentId: string
    studentGradeOnDate: GradeLabel
    cell: SlotCell
    teacher: TeacherRow
    pairedStudent: StudentEntry | null
    existingLessons: Array<{ slotNumber: number; lessonType: LessonType }>
    assignedDateKeys: string[]
    lessonLimitSatisfied: boolean
    pairConstraintPreferred: boolean
  }) => {
    const scoreParts: AutoAssignScorePart[] = []
    const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(params.studentId, params.cell.dateKey)
    const isAdjacentToAnyLesson = params.existingLessons.some((lesson) => Math.abs(lesson.slotNumber - params.cell.slotNumber) === 1)
    const hasOneSlotBreak = params.existingLessons.some((lesson) => Math.abs(lesson.slotNumber - params.cell.slotNumber) === 2)
    const isAdjacentToRegularLesson = params.existingLessons.some((lesson) => lesson.lessonType === 'regular' && Math.abs(lesson.slotNumber - params.cell.slotNumber) === 1)
    const dateAlreadyUsed = params.assignedDateKeys.includes(params.cell.dateKey)
    const dateKeysAfterPlacement = Array.from(new Set([...params.assignedDateKeys, params.cell.dateKey])).sort()
    const dateSpacingRegularityScore = buildDateSpacingRegularityScore(dateKeysAfterPlacement)

    for (const group of lectureConstraintGroups) {
      const applicableRule = group.ruleKeys
        .map((ruleKey) => autoAssignRuleByKey.get(ruleKey))
        .find((rule) => isAutoAssignRuleApplicable(rule, params.studentId, params.studentGradeOnDate))

      if (group.key === 'lesson-limit') {
        scoreParts.push({
          label: '同日授業数上限',
          value: applicableRule ? (params.lessonLimitSatisfied ? 2 : 0) : 0,
          detail: applicableRule ? (params.lessonLimitSatisfied ? '上限内' : '上限超過') : '対象ルールなし',
          applicable: Boolean(applicableRule),
          satisfied: applicableRule ? params.lessonLimitSatisfied : false,
        })
        continue
      }

      if (group.key === 'two-students') {
        if (applicableRule) {
          scoreParts.push({
            label: '2人同席優先',
            value: params.pairedStudent ? 2 : 0,
            detail: params.pairedStudent ? '同席あり' : '単独席',
            applicable: true,
            satisfied: Boolean(params.pairedStudent),
          })
        } else {
          scoreParts.push({
            label: '2人同席優先',
            value: params.pairedStudent ? 0 : 1,
            detail: '対象ルールなし',
            applicable: false,
            satisfied: false,
          })
        }
        continue
      }

      if (group.key === 'lesson-pattern') {
        if (!applicableRule) {
          scoreParts.push({ label: '授業並び方', value: 0, detail: '対象ルールなし', applicable: false, satisfied: false })
          continue
        }
        if (applicableRule.key === 'allowTwoConsecutiveLessons') {
          scoreParts.push({
            label: '授業並び方',
            value: isAdjacentToAnyLesson ? 3 : 0,
            detail: isAdjacentToAnyLesson ? '連続コマを作れる' : '隣接授業なし',
            applicable: true,
            satisfied: isAdjacentToAnyLesson,
          })
        } else if (applicableRule.key === 'requireBreakBetweenLessons') {
          scoreParts.push({
            label: '授業並び方',
            value: hasOneSlotBreak ? 3 : 0,
            detail: hasOneSlotBreak ? '一コマ空けを満たす' : '一コマ空けにならない',
            applicable: true,
            satisfied: hasOneSlotBreak,
          })
        } else {
          scoreParts.push({
            label: '授業並び方',
            value: isAdjacentToRegularLesson ? 3 : 0,
            detail: isAdjacentToRegularLesson ? '通常授業に接続できる' : '通常授業と離れる',
            applicable: true,
            satisfied: isAdjacentToRegularLesson,
          })
        }
        continue
      }

      if (group.key === 'day-spacing') {
        if (!applicableRule) {
          scoreParts.push({
            label: '登校日集約/分散',
            value: 0,
            detail: '対象ルールなし',
            applicable: false,
            satisfied: false,
          })
          continue
        }

        if (applicableRule.key === 'preferDateConcentration') {
          const coverageScore = buildDateCoverageScore(dateKeysAfterPlacement)
          const minimumGapScore = buildMinimumGapScore(params.cell.dateKey, params.assignedDateKeys)
          scoreParts.push({
            label: '登校日集約/分散',
            value: dateAlreadyUsed ? 100 + dateSpacingRegularityScore : coverageScore * 10 + minimumGapScore * 2 + dateSpacingRegularityScore,
            detail: dateAlreadyUsed
              ? `同じ登校日の ${params.cell.dateKey} にまとめる / 間隔 ${dateSpacingRegularityScore}`
              : `新しい登校日は既存日から離しつつ期間全体へ広げる / 範囲 ${coverageScore}日 / 最短間隔 ${minimumGapScore}日 / 間隔 ${dateSpacingRegularityScore}`,
            applicable: true,
            satisfied: dateAlreadyUsed,
          })
        } else {
          const coverageScore = buildDateCoverageScore(dateKeysAfterPlacement)
          const minimumGapScore = buildMinimumGapScore(params.cell.dateKey, params.assignedDateKeys)
          scoreParts.push({
            label: '登校日集約/分散',
            value: !dateAlreadyUsed ? 100 + coverageScore * 10 + minimumGapScore * 2 + dateSpacingRegularityScore : dateSpacingRegularityScore,
            detail: !dateAlreadyUsed
              ? `別日の登校へ分散 / 範囲 ${coverageScore}日 / 最短間隔 ${minimumGapScore}日 / 間隔 ${dateSpacingRegularityScore}`
              : `同じ登校日にまとまるため不利 / 間隔 ${dateSpacingRegularityScore}`,
            applicable: true,
            satisfied: !dateAlreadyUsed,
          })
        }
        continue
      }

      if (group.key === 'time-preference') {
        if (!applicableRule) {
          scoreParts.push({
            label: '時限希望',
            value: ({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 1 } as Record<number, number>)[params.cell.slotNumber] ?? 0,
            detail: 'ルール未設定のため遅い時限を優先',
            applicable: false,
            satisfied: false,
          })
          continue
        }
        if (applicableRule.key === 'preferLateAfternoon') {
          scoreParts.push({
            label: '時限希望',
            value: ({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0,
            detail: '遅い時限を優先',
            applicable: true,
            satisfied: params.cell.slotNumber >= 3,
          })
        } else if (applicableRule.key === 'preferSecondPeriod') {
          scoreParts.push({
            label: '時限希望',
            value: ({ 2: 5, 3: 4, 4: 3, 5: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0,
            detail: '2限寄りを優先',
            applicable: true,
            satisfied: params.cell.slotNumber === 2,
          })
        } else {
          scoreParts.push({
            label: '時限希望',
            value: ({ 5: 5, 4: 4, 3: 3, 2: 2, 1: 0 } as Record<number, number>)[params.cell.slotNumber] ?? 0,
            detail: '5限寄りを優先',
            applicable: true,
            satisfied: params.cell.slotNumber === 5,
          })
        }
        continue
      }

      scoreParts.push({ label: group.key, value: 0, detail: '未評価' })
    }

    scoreParts.push({
      label: '相性制約',
      value: params.pairConstraintPreferred ? 1 : 0,
      detail: params.pairConstraintPreferred ? '組み合わせ問題なし' : '相性制約で不利',
    })
    scoreParts.push({
      label: '通常担当講師との連続性',
      value: regularTeacherIds.has(params.teacher.id) ? 1 : 0,
      detail: regularTeacherIds.has(params.teacher.id) ? '通常担当講師' : '通常担当ではない',
    })

    return scoreParts
  }

  const buildAutoAssignDebugReport = useCallback((params: {
    entryLabel: string
    mode: 'lecture' | 'makeup'
    placementCandidates: Array<LectureAutoAssignCandidate | MakeupAutoAssignCandidate>
    evaluatedCandidateCount: number
    remainingCount: number
  }): AutoAssignDebugReport => {
    const placedByDate = new Map<string, number>()
    const satisfactionByLabel = new Map<string, { satisfied: number; applicable: number }>()
    params.placementCandidates.forEach((candidate) => {
      placedByDate.set(candidate.cell.dateKey, (placedByDate.get(candidate.cell.dateKey) ?? 0) + 1)
      candidate.scoreParts.forEach((part) => {
        if (part.applicable !== true || part.satisfied === undefined) return
        const current = satisfactionByLabel.get(part.label) ?? { satisfied: 0, applicable: 0 }
        current.applicable += 1
        if (part.satisfied) current.satisfied += 1
        satisfactionByLabel.set(part.label, current)
      })
    })
    const summary = `${params.entryLabel} を ${params.placementCandidates.length} コマ配置し、候補を合計 ${params.evaluatedCandidateCount} 件比較しました。${params.remainingCount > 0 ? ` ${params.remainingCount} コマは未配置です。` : ''}`
    const placementSummary = Array.from(placedByDate.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([dateKey, count]) => `${dateKey}: ${count}コマ`)
    const debugLines = autoAssignDebugLabelOrder
      .map((label) => {
        const current = satisfactionByLabel.get(label)
        if (!current || current.applicable === 0) return null
        const percent = Math.round((current.satisfied / current.applicable) * 100)
        return `${label}: ${percent}% (${current.satisfied}/${current.applicable})`
      })
      .filter((line): line is string => Boolean(line))

    return {
      title: `${params.mode === 'lecture' ? '講習' : '振替'}自動割振デバッグ`,
      summary,
      details: [
        'ルール対応率',
        ...debugLines,
        '',
        '配置日内訳',
        ...(placementSummary.length > 0 ? placementSummary : ['なし']),
        '',
        `比較候補数: ${params.evaluatedCandidateCount}`,
      ].join('\n'),
    }
  }, [autoAssignDebugLabelOrder])

  const copyAutoAssignDebugReport = useCallback(async () => {
    if (!autoAssignDebugReport || typeof navigator === 'undefined' || !navigator.clipboard) {
      setStatusMessage('自動割振デバッグをコピーできませんでした。')
      return
    }
    try {
      await navigator.clipboard.writeText(`${autoAssignDebugReport.title}\n${autoAssignDebugReport.summary}\n\n${autoAssignDebugReport.details}`)
      setStatusMessage('自動割振デバッグをクリップボードへコピーしました。')
    } catch {
      setStatusMessage('自動割振デバッグのコピーに失敗しました。')
    }
  }, [autoAssignDebugReport])

  const findBestLectureAutoAssignCandidate = (params: {
    sourceWeeks: SlotCell[][]
    pendingItems: LectureStockPendingItem[]
    managedStudent: StudentRow
    studentKey: string
  }): LectureAutoAssignCandidateSearchResult => {
    const studentUnavailableSlots = studentUnavailableSlotsById.get(params.managedStudent.id) ?? new Set<string>()
    let bestCandidate: LectureAutoAssignCandidate | null = null
    const evaluatedCandidates: LectureAutoAssignCandidate[] = []

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
        const assignedDateKeys = collectStudentAssignedDateKeys(params.sourceWeeks, params.studentKey)
        const lessonLimit = resolveApplicableLessonLimit(autoAssignRuleByKey, params.managedStudent.id, studentGradeOnDate)
        const lessonLimitSatisfied = lessonLimit === null || existingLessons.length < lessonLimit

        const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(params.managedStudent.id, cell.dateKey)
        const slotKey = `${cell.dateKey}_${cell.slotNumber}`

        for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
          const desk = cell.desks[deskIndex]
          const teacher = resolveManagedTeacherForDesk(desk, cell.dateKey)
          if (!teacher || !desk.teacher.trim()) continue

          for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
            if (isStudentSlotBlocked(desk, studentIndex)) continue
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
            const scoreParts: AutoAssignScorePart[] = [
              {
                label: '未消化講習由来',
                value: matchedItem.source === 'session' ? 1 : 0,
                detail: matchedItem.source === 'session' ? '講習期間の登録希望を優先' : '手動追加ストック',
              },
              ...buildForcedConstraintScoreParts({
                firstPeriodRuleApplied: forbidFirstPeriod,
                firstPeriodPreferred,
                subjectCapableRuleApplied: subjectCapableTeachersOnly,
                subjectCapablePreferred,
                regularTeacherRuleApplied: regularTeachersOnly,
                regularTeacherPreferred,
              }),
              ...buildCommonAutoAssignScoreParts({
                studentId: params.managedStudent.id,
                studentGradeOnDate,
                cell,
                teacher,
                pairedStudent,
                existingLessons,
                assignedDateKeys,
                lessonLimitSatisfied,
                pairConstraintPreferred,
              }),
              {
                label: '日付優先',
                value: buildDatePriorityScore(cell.dateKey),
                detail: '早い日付ほど高得点',
              },
              {
                label: '講習終了日優先',
                value: matchedItem.endDate ? 99999999 - Number(matchedItem.endDate.replace(/-/g, '')) : 0,
                detail: matchedItem.endDate ? `${matchedItem.endDate} までの講習を優先` : '期限なし',
              },
            ]
            const scoreVector = scoreParts.map((part) => part.value)

            const nextCandidate: LectureAutoAssignCandidate = {
              weekIndex: nextWeekIndex,
              cell,
              deskIndex,
              studentIndex,
              desk,
              teacher,
              matchedItem,
              scoreVector,
              scoreParts,
            }
            evaluatedCandidates.push(nextCandidate)

            if (!bestCandidate || compareAutoAssignCandidateOrder(nextCandidate, bestCandidate) < 0) {
              bestCandidate = nextCandidate
            }
          }
        }
      }
    }

    return {
      bestCandidate,
      topCandidates: [...evaluatedCandidates].sort(compareAutoAssignCandidateOrder).slice(0, 5),
      evaluatedCandidateCount: evaluatedCandidates.length,
    }
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

  useEffect(() => {
    const handleOpenAllSchedule = (event: MessageEvent) => {
      const message = event.data
      if (!message || message.type !== 'open-all-schedule') return
      const requestedViewType = message.viewType === 'all-teacher' ? 'all-teacher' as const : 'all-student' as const
      const requestedStartDate = typeof message.startDate === 'string' ? message.startDate : scheduleFallbackStartDate
      const requestedEndDate = typeof message.endDate === 'string' ? message.endDate : scheduleFallbackEndDate
      const range = { startDate: requestedStartDate, endDate: requestedEndDate, periodValue: '' }
      openAllScheduleHtml({
        viewType: requestedViewType,
        cells: buildScheduleCellsForRange({
          range,
          fallbackStartDate: scheduleFallbackStartDate,
          fallbackEndDate: scheduleFallbackEndDate,
          classroomSettings,
          teachers,
          students,
          regularLessons,
          boardWeeks: normalizedWeeks,
          suppressedRegularLessonOccurrences,
        }),
        plannedCells: buildManagedScheduleCellsForRange({
          range,
          fallbackStartDate: scheduleFallbackStartDate,
          fallbackEndDate: scheduleFallbackEndDate,
          classroomSettings,
          teachers,
          students,
          regularLessons,
          boardWeeks: normalizedWeeks,
          suppressedRegularLessonOccurrences,
        }),
        students,
        teachers,
        regularLessons,
        regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
        scheduleCountAdjustments,
        defaultStartDate: range.startDate,
        defaultEndDate: range.endDate,
        titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
        classroomSettings,
        periodBands: specialSessions,
        specialSessions,
      })
    }
    window.addEventListener('message', handleOpenAllSchedule)
    return () => window.removeEventListener('message', handleOpenAllSchedule)
  }, [scheduleFallbackStartDate, scheduleFallbackEndDate, classroomSettings, teachers, students, regularLessons, normalizedWeeks, suppressedRegularLessonOccurrences, scheduleCountAdjustments, specialSessions])

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
    suppressedRegularLessonOccurrences,
  }), [classroomSettings, effectiveStudentScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, suppressedRegularLessonOccurrences, teachers])

  const studentPlannedScheduleCells = useMemo(() => buildManagedScheduleCellsForRange({
    range: effectiveStudentScheduleRange,
    fallbackStartDate: scheduleFallbackStartDate,
    fallbackEndDate: scheduleFallbackEndDate,
    classroomSettings,
    teachers,
    students,
    regularLessons,
    boardWeeks: normalizedWeeks,
    suppressedRegularLessonOccurrences,
  }), [classroomSettings, effectiveStudentScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, suppressedRegularLessonOccurrences, teachers])

  const teacherScheduleCells = useMemo(() => buildScheduleCellsForRange({
    range: effectiveTeacherScheduleRange,
    fallbackStartDate: scheduleFallbackStartDate,
    fallbackEndDate: scheduleFallbackEndDate,
    classroomSettings,
    teachers,
    students,
    regularLessons,
    boardWeeks: normalizedWeeks,
    suppressedRegularLessonOccurrences,
  }), [classroomSettings, effectiveTeacherScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, suppressedRegularLessonOccurrences, teachers])

  const teacherPlannedScheduleCells = useMemo(() => buildManagedScheduleCellsForRange({
    range: effectiveTeacherScheduleRange,
    fallbackStartDate: scheduleFallbackStartDate,
    fallbackEndDate: scheduleFallbackEndDate,
    classroomSettings,
    teachers,
    students,
    regularLessons,
    boardWeeks: normalizedWeeks,
    suppressedRegularLessonOccurrences,
  }), [classroomSettings, effectiveTeacherScheduleRange, normalizedWeeks, regularLessons, scheduleFallbackEndDate, scheduleFallbackStartDate, students, suppressedRegularLessonOccurrences, teachers])

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

  useEffect(() => {
    syncStudentScheduleHtml({
      cells: studentScheduleCells,
      plannedCells: studentPlannedScheduleCells,
      students,
      regularLessons,
      regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
      teachers,
      scheduleCountAdjustments,
      highlightedStudentSlot: movingStudentContext
        ? {
            studentId: movingStudentContext.student.managedStudentId ?? movingStudentContext.student.id,
            studentName: movingStudentContext.student.name,
            studentDisplayName: resolveBoardStudentDisplayName(movingStudentContext.student.name),
            dateKey: movingStudentContext.cell.dateKey,
            slotNumber: movingStudentContext.cell.slotNumber,
          }
        : null,
      defaultStartDate: effectiveStudentScheduleRange.startDate,
      defaultEndDate: effectiveStudentScheduleRange.endDate,
      defaultPeriodValue: effectiveStudentScheduleRange.periodValue,
      titleLabel: studentScheduleTitle,
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      targetWindow: studentScheduleWindowRef.current,
    })
  }, [classroomSettings, effectiveStudentScheduleRange.endDate, effectiveStudentScheduleRange.periodValue, effectiveStudentScheduleRange.startDate, movingStudentContext, regularLessons, resolveBoardStudentDisplayName, scheduleCountAdjustments, scheduleSyncTrigger, specialSessions, studentPlannedScheduleCells, studentScheduleCells, studentScheduleTitle, students])

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
      targetWindow: teacherScheduleWindowRef.current,
    })
  }, [classroomSettings, effectiveTeacherScheduleRange.endDate, effectiveTeacherScheduleRange.periodValue, effectiveTeacherScheduleRange.startDate, scheduleSyncTrigger, specialSessions, teacherPlannedScheduleCells, teacherScheduleCells, teacherScheduleTitle, teachers])

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

  const editSubjectOptions = useMemo(() => {
    if (!menuStudent) return editableSubjects
    const baseOptions = getSelectableStudentSubjectsForGrade(menuStudent.student.grade)
    if (editStudentDraft && !baseOptions.includes(editStudentDraft.subject)) {
      return [editStudentDraft.subject, ...baseOptions]
    }
    return baseOptions
  }, [editStudentDraft, menuStudent])

  const emptyMenuContext = useMemo(() => {
    if (!studentMenu || (studentMenu.mode !== 'empty' && studentMenu.mode !== 'add' && studentMenu.mode !== 'memo' && studentMenu.mode !== 'trial')) return null
    const targetCell = cells.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetCell || !targetDesk) return null
    return {
      cell: targetCell,
      desk: targetDesk,
      statusEntry: targetDesk.statusSlots?.[studentMenu.studentIndex] ?? null,
    }
  }, [cells, studentMenu])

  const addableStudents = useMemo(() => {
    if (!emptyMenuContext) return []
    return students
      .filter((student) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, emptyMenuContext.cell.dateKey))
      .map((student) => ({
        id: student.id,
        displayName: formatStudentSelectionLabel(student),
        student,
      }))
      .sort((left, right) => compareStudentsByCurrentGradeThenName(left.student, right.student))
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
      .slice()
      .sort((left, right) => {
        const distanceCompare = computeSpecialSessionDateDistance(left, emptyMenuContext.cell.dateKey) - computeSpecialSessionDateDistance(right, emptyMenuContext.cell.dateKey)
        if (distanceCompare !== 0) return distanceCompare

        const leftInRange = emptyMenuContext.cell.dateKey >= left.startDate && emptyMenuContext.cell.dateKey <= left.endDate
        const rightInRange = emptyMenuContext.cell.dateKey >= right.startDate && emptyMenuContext.cell.dateKey <= right.endDate
        if (leftInRange !== rightInRange) return leftInRange ? -1 : 1

        return left.startDate.localeCompare(right.startDate) || left.label.localeCompare(right.label, 'ja')
      })
  }, [emptyMenuContext, specialSessions])

  const boardStudentWarningsByLocation = useMemo(() => {
    const warningMap = new Map<string, { reasons: Set<string>; hasConstraintReason: boolean; shouldHighlight: boolean }>()
    const addWarning = (locationKeys: string[], reason: string, hasConstraintReason: boolean, shouldHighlight = false) => {
      if (!reason) return
      for (const locationKey of locationKeys) {
        const current = warningMap.get(locationKey) ?? { reasons: new Set<string>(), hasConstraintReason: false, shouldHighlight: false }
        current.reasons.add(reason)
        current.hasConstraintReason = current.hasConstraintReason || hasConstraintReason
        current.shouldHighlight = current.shouldHighlight || shouldHighlight
        warningMap.set(locationKey, current)
      }
    }

    for (const cell of cells) {
      for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
        const desk = cell.desks[deskIndex]
        for (let studentIndex = 0; studentIndex < (desk.lesson?.studentSlots.length ?? 0); studentIndex += 1) {
          const student = desk.lesson?.studentSlots[studentIndex]
          if (!student) continue

          const currentLocationKey = buildStudentWarningLocationKey(cell.id, deskIndex, studentIndex)
          if (student.warning) addWarning([currentLocationKey], student.warning, false)
          if (student.manualAdded) addWarning([currentLocationKey], '手動追加', false)

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
            addWarning([currentLocationKey], 'データ不整合: 講師データ不一致', true, true)
          }

          if (teacher && managedStudent && isSubjectCapabilityConstraintApplicable(autoAssignRuleByKey, managedStudent.id, studentGradeOnDate) && !canTeacherHandleStudentSubject(teacher, student.subject, studentGradeOnDate)) {
            addWarning([currentLocationKey], '制約事項: 科目対応講師のみ', true, true)
          }

          if (managedStudent) {
            if (isAutoAssignRuleApplicable(autoAssignRuleByKey.get('forbidFirstPeriod'), managedStudent.id, studentGradeOnDate) && cell.slotNumber === 1) {
              addWarning([currentLocationKey], '制約事項: 1限禁止', true, true)
            }

            const regularTeachersOnly = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('regularTeachersOnly'), managedStudent.id, studentGradeOnDate)
            const regularTeacherIds = resolveRegularTeacherIdsForStudentOnDate(managedStudent.id, cell.dateKey)
            if (regularTeachersOnly && (!teacher || !regularTeacherIds.has(teacher.id))) {
              addWarning([currentLocationKey], '制約事項: 通常講師のみ', true, true)
            }

            const twoStudentsRuleApplied = isAutoAssignRuleApplicable(autoAssignRuleByKey.get('preferTwoStudentsPerTeacher'), managedStudent.id, studentGradeOnDate)
            if (twoStudentsRuleApplied && !pairedStudent) {
              addWarning([currentLocationKey], '制約: 講師1人に生徒2人配置', true)
            }

            const comparableStudentKey = resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName)
            const sameDayOccurrences = collectStudentOccurrencesOnDate(normalizedWeeks, comparableStudentKey, cell.dateKey)
            const lessonLimit = resolveApplicableLessonLimit(autoAssignRuleByKey, managedStudent.id, studentGradeOnDate)
            if (lessonLimit !== null && sameDayOccurrences.length > lessonLimit) {
              addWarning(sameDayOccurrences.map((entry) => entry.occurrenceKey), `制約: 同日${lessonLimit}コマ上限`, true)
            }

            const lessonPatternRule = lectureConstraintGroups
              .find((group) => group.key === 'lesson-pattern')
              ?.ruleKeys
              .map((ruleKey) => autoAssignRuleByKey.get(ruleKey))
              .find((rule) => isAutoAssignRuleApplicable(rule, managedStudent.id, studentGradeOnDate))
            if (lessonPatternRule && sameDayOccurrences.length >= 2) {
              const occurrencesWithAdjacentLesson = sameDayOccurrences.filter((entry) => sameDayOccurrences.some((other) => entry.occurrenceKey !== other.occurrenceKey && Math.abs(entry.slotNumber - other.slotNumber) === 1))
              const occurrencesWithOneSlotBreak = sameDayOccurrences.filter((entry) => sameDayOccurrences.some((other) => entry.occurrenceKey !== other.occurrenceKey && Math.abs(entry.slotNumber - other.slotNumber) === 2))
              const occurrencesAdjacentToRegularLesson = sameDayOccurrences.filter((entry) => sameDayOccurrences.some((other) => entry.occurrenceKey !== other.occurrenceKey && other.lessonType === 'regular' && Math.abs(entry.slotNumber - other.slotNumber) === 1))

              if (lessonPatternRule.key === 'allowTwoConsecutiveLessons' && occurrencesWithAdjacentLesson.length === 0) {
                addWarning(sameDayOccurrences.map((entry) => entry.occurrenceKey), '制約: 2コマ連続', true)
              }
              if (lessonPatternRule.key === 'requireBreakBetweenLessons') {
                if (occurrencesWithAdjacentLesson.length > 0) {
                  addWarning(occurrencesWithAdjacentLesson.map((entry) => entry.occurrenceKey), '制約: 一コマ空け', true)
                } else if (occurrencesWithOneSlotBreak.length === 0) {
                  addWarning(sameDayOccurrences.map((entry) => entry.occurrenceKey), '制約: 一コマ空け', true)
                }
              }
              if (lessonPatternRule.key === 'connectRegularLessons' && occurrencesAdjacentToRegularLesson.length === 0) {
                addWarning(sameDayOccurrences.map((entry) => entry.occurrenceKey), '制約: 通常連結2コマ', true)
              }
            }

            const unavailableSlots = studentUnavailableSlotsById.get(managedStudent.id)
            if (unavailableSlots?.has(slotKey)) {
              addWarning([currentLocationKey], '絶対事項: 出席可能コマのみ', true, true)
            }

            if (teacher && isPairConstraintBlocked(teacher.id, managedStudent.id, pairedStudent)) {
              addWarning([currentLocationKey], '制約: 組み合わせ不可', true, true)
            }
          }

          if (student.lessonType === 'special') {
            const session = resolveSpecialSessionById(student.specialSessionId)
            if (session && (cell.dateKey < session.startDate || cell.dateKey > session.endDate)) {
              addWarning([currentLocationKey], '絶対事項: 講習期間内割振', true, true)
            }
          }
        }
      }
    }

    return new Map(Array.from(warningMap.entries()).map(([locationKey, value]) => {
      const reasons = Array.from(value.reasons)
      const text = value.hasConstraintReason ? ['制約違反', ...reasons].join('\n') : reasons.join('\n')
      return [locationKey, { text, highlight: value.shouldHighlight }] as const
    }))
  }, [autoAssignRuleByKey, cells, isPairConstraintBlocked, lectureConstraintGroups, managedStudentByAnyName, managedStudentByRegisteredName, normalizedWeeks, resolveBoardStudentDisplayName, resolveManagedTeacherForDesk, studentUnavailableSlotsById, students])

  const isTeacherWithdrawnOnDate = useCallback((teacherId: string | undefined, teacherName: string, dateKey: string) => {
    if (!teacherName) return false
    const teacher = teacherId
      ? teachers.find((t) => t.id === teacherId)
      : teachers.find((t) => getTeacherDisplayName(t) === teacherName)
    if (!teacher) return false
    return resolveTeacherRosterStatus(teacher, dateKey) !== '在籍'
  }, [teachers])

  const displayCells = useMemo(() => {
    const sourceCells = isTemplateMode ? templateCells : cells
    return sourceCells.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk, deskIndex) => {
        const teacherWithdrawn = !isTemplateMode && desk.teacher && isTeacherWithdrawnOnDate(desk.teacherAssignmentTeacherId, desk.teacher, cell.dateKey)
        return {
          ...desk,
          teacher: teacherWithdrawn ? '' : desk.teacher,
          lesson: desk.lesson
            ? {
                ...desk.lesson,
                studentSlots: desk.lesson.studentSlots.map((student, studentIndex) => {
                  if (!student) return null
                  const warningEntry = isTemplateMode ? undefined : boardStudentWarningsByLocation.get(buildStudentWarningLocationKey(cell.id, deskIndex, studentIndex))
                  return {
                      ...student,
                      warning: warningEntry?.text,
                      warningHighlight: warningEntry?.highlight,
                    }
                }) as [StudentEntry | null, StudentEntry | null],
              }
            : undefined,
        }
      }),
    }))
  }, [boardStudentWarningsByLocation, cells, isTeacherWithdrawnOnDate, isTemplateMode, templateCells])

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

  const pointerPreviewLabel = useMemo(() => {
    if (selectedMakeupStockEntry?.nextPlacementEntry) {
      const entry = selectedMakeupStockEntry.nextPlacementEntry
      const originLabel = entry.nextOriginLabel ?? '元コマ未設定'
      return `${selectedMakeupStockEntry.displayName} / ${entry.subject} / ${originLabel} の振替先を選択中`
    }

    if (selectedLectureStockEntry) {
      const subject = selectedLecturePlacementItem?.subject ?? selectedLectureStockEntry.nextPlacementEntry?.subject ?? '科目未設定'
      return `${selectedLectureStockEntry.displayName} / ${subject} / 未消化講習の配置先を選択中`
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

    const estimatedHeight = studentMenu.mode === 'add' ? 520 : studentMenu.mode === 'trial' ? 420 : studentMenu.mode === 'empty' ? 180 : studentMenu.mode === 'memo' ? 360 : 340
    return {
      left: Math.max(12, Math.min(studentMenu.x + 10, window.innerWidth - 336)),
      top: Math.max(12, Math.min(studentMenu.y + 10, window.innerHeight - estimatedHeight - 12)),
    }
  }, [studentMenu])

  const teacherMenuContext = useMemo(() => {
    if (!teacherMenu) return null
    const sourceCells = isTemplateMode ? templateCells : cells
    const targetCell = sourceCells.find((cell) => cell.id === teacherMenu.cellId)
    const targetDesk = targetCell?.desks[teacherMenu.deskIndex]
    if (!targetCell || !targetDesk) return null
    return { cell: targetCell, desk: targetDesk }
  }, [cells, isTemplateMode, teacherMenu, templateCells])

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
    if (!teacherMenuContext || !teacherMenu) return []
    return buildTeacherSelectionOptions({
      teachers,
      cell: teacherMenuContext.cell,
      deskIndex: teacherMenu.deskIndex,
      isTemplateMode,
      templateReferenceDate: isTemplateMode ? templateEffectiveStartDate : undefined,
    })
  }, [isTemplateMode, teacherMenu?.deskIndex, teacherMenuContext, teachers, templateEffectiveStartDate])

  const centeredStatusMessage = statusMessage.includes('同コマにすでに') && statusMessage.includes('不可です。') ? statusMessage : null

  // ── Template mode helpers ──
  const cloneTemplateCells = (src: SlotCell[]): SlotCell[] =>
    src.map((c) => ({
      ...c,
      desks: c.desks.map((d) => ({
        ...d,
        lesson: d.lesson ? { ...d.lesson, studentSlots: [d.lesson.studentSlots[0] ? { ...d.lesson.studentSlots[0] } : null, d.lesson.studentSlots[1] ? { ...d.lesson.studentSlots[1] } : null] as [StudentEntry | null, StudentEntry | null] } : undefined,
      })),
    }))

  const templateMenuStudent = useMemo(() => {
    if (!isTemplateMode || !studentMenu) return null
    const targetCell = templateCells.find((c) => c.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const student = targetDesk?.lesson?.studentSlots[studentMenu.studentIndex]
    if (!student || !targetCell || !targetDesk) return null
    return { student, cell: targetCell, desk: targetDesk }
  }, [isTemplateMode, studentMenu, templateCells])

  const templateAddableStudents = useMemo(() => {
    if (!isTemplateMode) return []
    return students
      .filter((s) => {
        const status = resolveScheduledStatus(s.entryDate, s.withdrawDate, s.isHidden, templateEffectiveStartDate)
        return status !== '退塾' && status !== '非表示'
      })
      .slice()
      .sort((a, b) => getStudentDisplayName(a).localeCompare(getStudentDisplayName(b), 'ja'))
      .map((s) => ({ id: s.id, displayName: getStudentDisplayName(s), student: s }))
  }, [isTemplateMode, students, templateEffectiveStartDate])

  const templateEditableSubjects = allStudentSubjectOptions

  const handleTemplateStudentClick = (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, _hasMemo: boolean, _statusKind: StudentStatusKind | null, x: number, y: number) => {
    setTeacherMenu(null)

    if (hasStudent) {
      if (selectedStudentId) {
        // Move with swap
        handleTemplateMoveStudent(cellId, deskIndex, studentIndex)
        return
      }
      setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'root' })
      setStatusMessage('生徒メニューを開きました。')
      return
    }

    if (selectedStudentId) {
      handleTemplateMoveStudent(cellId, deskIndex, studentIndex)
      return
    }

    // Empty cell → show add menu
    setTemplateAddDraft(null)
    setStudentMenu({ cellId, deskIndex, studentIndex, x, y, mode: 'empty' })
    setStatusMessage('空欄メニューを開きました。')
  }

  const handleTemplateStartMove = () => {
    if (!templateMenuStudent) return
    setSelectedStudentId(templateMenuStudent.student.id)
    setStudentMenu(null)
    setStatusMessage(`${templateMenuStudent.student.name} を選択しました。移動先セルを左クリックしてください。（移動先に生徒がいる場合は入れ替えます）`)
  }

  const handleTemplateMoveStudent = (targetCellId: string, targetDeskIndex: number, targetStudentIndex: number) => {
    if (!selectedStudentId) return

    const next = cloneTemplateCells(templateCells)

    // Find source student
    let sourceStudent: StudentEntry | null = null
    let sourceCellIdx = -1
    let sourceDeskIdx = -1
    let sourceSlotIdx = -1
    for (let ci = 0; ci < next.length; ci++) {
      for (let di = 0; di < next[ci].desks.length; di++) {
        const lesson = next[ci].desks[di].lesson
        if (!lesson) continue
        for (let si = 0; si < 2; si++) {
          if (lesson.studentSlots[si]?.id === selectedStudentId) {
            sourceStudent = lesson.studentSlots[si]
            sourceCellIdx = ci
            sourceDeskIdx = di
            sourceSlotIdx = si
          }
        }
      }
    }
    if (!sourceStudent) {
      setSelectedStudentId(null)
      setStatusMessage('移動元の生徒が見つかりませんでした。')
      return
    }

    const targetCell = next.find((c) => c.id === targetCellId)
    const targetDesk = targetCell?.desks[targetDeskIndex]
    if (!targetDesk) {
      setSelectedStudentId(null)
      setStatusMessage('移動先が見つかりませんでした。')
      return
    }

    // Same position → cancel
    if (sourceCellIdx >= 0 && next[sourceCellIdx].id === targetCellId && sourceDeskIdx === targetDeskIndex && sourceSlotIdx === targetStudentIndex) {
      setSelectedStudentId(null)
      setStatusMessage('同じ位置をクリックしたため、移動は行いませんでした。')
      return
    }

    const targetLesson = targetDesk.lesson
    const targetStudent = targetLesson?.studentSlots[targetStudentIndex] ?? null

    const comparableStudentKey = resolveStockComparableStudentKey(sourceStudent, managedStudentByAnyName, resolveBoardStudentDisplayName)
    const duplicateStudent = findDuplicateStudentInCell(targetCell, comparableStudentKey, sourceStudent.id)
    if (duplicateStudent) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているためテンプレ移動不可です。`)
      return
    }

    // Save undo
    pushTemplateUndo(templateCells)

    // Remove source from original position
    const srcDesk = next[sourceCellIdx].desks[sourceDeskIdx]
    if (srcDesk.lesson) {
      srcDesk.lesson.studentSlots[sourceSlotIdx] = null
    }

    // Place source at target
    if (targetLesson) {
      targetLesson.studentSlots[targetStudentIndex] = sourceStudent
    } else {
      targetDesk.lesson = {
        id: `tpl_lesson_${Date.now().toString(36)}`,
        studentSlots: targetStudentIndex === 0 ? [sourceStudent, null] : [null, sourceStudent],
      }
    }

    // If swap: place target student at source position
    if (targetStudent) {
      if (srcDesk.lesson) {
        srcDesk.lesson.studentSlots[sourceSlotIdx] = targetStudent
      } else {
        srcDesk.lesson = {
          id: `tpl_lesson_${Date.now().toString(36)}_swap`,
          studentSlots: sourceSlotIdx === 0 ? [targetStudent, null] : [null, targetStudent],
        }
      }
      setStatusMessage(`${sourceStudent.name} と ${targetStudent.name} を入れ替えました。`)
    } else {
      // Clean up source desk if empty
      if (srcDesk.lesson && !srcDesk.lesson.studentSlots[0] && !srcDesk.lesson.studentSlots[1]) {
        srcDesk.lesson = undefined
      }
      setStatusMessage(`${sourceStudent.name} を移動しました。`)
    }

    setTemplateCells(next)
    setSelectedStudentId(null)
    setStudentMenu(null)
  }

  const handleTemplateDeleteStudent = () => {
    if (!studentMenu || !templateMenuStudent) return
    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    const targetCell = next.find((c) => c.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetDesk?.lesson) return
    targetDesk.lesson.studentSlots[studentMenu.studentIndex] = null
    if (!targetDesk.lesson.studentSlots[0] && !targetDesk.lesson.studentSlots[1]) {
      targetDesk.lesson = undefined
    }
    setTemplateCells(next)
    setStudentMenu(null)
    setStatusMessage(`${templateMenuStudent.student.name} を削除しました。`)
  }

  const handleTemplateOpenEdit = () => {
    if (!studentMenu || !templateMenuStudent) return
    setTemplateEditDraft({
      studentId: templateMenuStudent.student.managedStudentId ?? '',
      subject: templateMenuStudent.student.subject,
      note: templateMenuStudent.student.noteSuffix ?? '',
    })
    setStudentMenu({ ...studentMenu, mode: 'edit' })
  }

  const handleTemplateConfirmEdit = () => {
    if (!studentMenu || !templateEditDraft || !templateMenuStudent) return
    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    const targetCell = next.find((c) => c.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetStudent = targetDesk?.lesson?.studentSlots[studentMenu.studentIndex]
    if (!targetStudent) return

    const newStudentRow = students.find((s) => s.id === templateEditDraft.studentId)
    const today = new Date()
    targetDesk!.lesson!.studentSlots[studentMenu.studentIndex] = {
      ...targetStudent,
      name: newStudentRow ? getStudentDisplayName(newStudentRow) : targetStudent.name,
      managedStudentId: templateEditDraft.studentId || targetStudent.managedStudentId,
      grade: newStudentRow ? (resolveGradeLabelFromBirthDate(newStudentRow.birthDate, today) || targetStudent.grade) as GradeLabel : targetStudent.grade,
      birthDate: newStudentRow?.birthDate ?? targetStudent.birthDate,
      subject: templateEditDraft.subject,
      noteSuffix: templateEditDraft.note || undefined,
    }
    setTemplateCells(next)
    setStudentMenu(null)
    setTemplateEditDraft(null)
    setStatusMessage(`${newStudentRow ? getStudentDisplayName(newStudentRow) : targetStudent.name} の情報を更新しました。`)
  }

  const handleTemplateOpenAdd = () => {
    if (!studentMenu || templateAddableStudents.length === 0) {
      setStatusMessage('追加できる在籍生徒が見つかりませんでした。')
      return
    }
    const defaultStudent = templateAddableStudents[0]
    setTemplateAddDraft({
      studentId: defaultStudent.id,
      subject: templateEditableSubjects[0],
      note: '',
    })
    setStudentMenu({ ...studentMenu, mode: 'add' })
    setStatusMessage('生徒追加メニューを開きました。')
  }

  const handleTemplateConfirmAdd = () => {
    if (!studentMenu || !templateAddDraft) return
    const managedStudent = students.find((s) => s.id === templateAddDraft.studentId)
    if (!managedStudent) {
      setStatusMessage('追加対象の生徒が見つかりませんでした。')
      return
    }

    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    const targetCell = next.find((c) => c.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetDesk) return

    const today = new Date()
    const newStudent: StudentEntry = {
      id: `tpl_add_${Date.now().toString(36)}_${studentMenu.studentIndex}`,
      name: getStudentDisplayName(managedStudent),
      managedStudentId: managedStudent.id,
      grade: (resolveGradeLabelFromBirthDate(managedStudent.birthDate, today) || '中1') as GradeLabel,
      birthDate: managedStudent.birthDate,
      noteSuffix: templateAddDraft.note || undefined,
      subject: templateAddDraft.subject,
      lessonType: 'regular',
      teacherType: 'normal',
    }

    if (targetDesk.lesson) {
      targetDesk.lesson.studentSlots[studentMenu.studentIndex] = newStudent
    } else {
      targetDesk.lesson = {
        id: `tpl_lesson_${Date.now().toString(36)}`,
        studentSlots: studentMenu.studentIndex === 0 ? [newStudent, null] : [null, newStudent],
      }
    }

    setTemplateCells(next)
    setStudentMenu(null)
    setTemplateAddDraft(null)
    setStatusMessage(`${getStudentDisplayName(managedStudent)} を追加しました。`)
  }

  const handleTemplateSelectDesk = (cellId: string, deskIndex: number, x: number, y: number) => {
    setStudentMenu(null)
    const targetCell = templateCells.find((c) => c.id === cellId)
    const targetDesk = targetCell?.desks[deskIndex]
    if (!targetCell || !targetDesk) return

    const matchedTeacher = teachers.find((t) => getTeacherDisplayName(t) === targetDesk.teacher || t.name === targetDesk.teacher)
    const initialName = matchedTeacher ? getTeacherDisplayName(matchedTeacher) : targetDesk.teacher
    const options = buildTeacherSelectionOptions({
      teachers,
      cell: targetCell,
      deskIndex,
      isTemplateMode: true,
      templateReferenceDate: templateEffectiveStartDate,
    })
    const resolvedName = options.some((o) => o.name === initialName) ? initialName : (options[0]?.name ?? '')
    setTeacherMenu({
      cellId,
      deskIndex,
      x,
      y,
      selectedTeacherName: resolvedName,
    })
    setStatusMessage(`講師選択を開きました: ${targetCell.dateLabel} ${targetCell.slotLabel} / ${deskIndex + 1}机目`)
  }

  const handleTemplateConfirmTeacher = () => {
    if (!teacherMenu) return
    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    const targetCell = next.find((c) => c.id === teacherMenu.cellId)
    const targetDesk = targetCell?.desks[teacherMenu.deskIndex]
    if (!targetDesk) return
    targetDesk.teacher = teacherMenu.selectedTeacherName
    setTemplateCells(next)
    setTeacherMenu(null)
    setStatusMessage(`講師を ${teacherMenu.selectedTeacherName || '未設定'} に変更しました。`)
  }

  const handleTemplateDeleteTeacher = () => {
    if (!teacherMenu) return
    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    const targetCell = next.find((c) => c.id === teacherMenu.cellId)
    const targetDesk = targetCell?.desks[teacherMenu.deskIndex]
    if (!targetDesk) return
    targetDesk.teacher = ''
    setTemplateCells(next)
    setTeacherMenu(null)
    setStatusMessage('講師を削除しました。')
  }

  const handleTemplateSaveRequest = () => {
    const template = convertTemplateCellsToTemplate({
      cells: templateCells,
      teachers,
      students,
      effectiveStartDate: templateEffectiveStartDate,
      deskCount: classroomSettings.deskCount,
    })
    setTemplateSaveConfirm({ mode: 'overwrite', template })
  }

  const handleTemplateSaveConfirm = async () => {
    if (!templateSaveConfirm) return
    try {
      await exportTemplateOverwriteReport({
        weeks,
        effectiveStartDate: templateSaveConfirm.template.effectiveStartDate,
        resolveDisplayName: resolveBoardStudentDisplayName,
      })
    } catch {
      // PDF export failure should not block template save
    }
    handleSaveRegularLessonTemplate(templateSaveConfirm.template, true)
  }

  const handleTemplateClear = () => {
    if (!window.confirm('テンプレートの内容をすべて空にします。よろしいですか？')) return
    pushTemplateUndo(templateCells)
    setTemplateCells(templateCells.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk) => ({
        ...desk,
        teacher: '',
        lesson: undefined,
      })),
    })))
    setStatusMessage('テンプレートを空にしました。')
  }

  const handleTemplateExport = async () => {
    const template = convertTemplateCellsToTemplate({
      cells: templateCells,
      teachers,
      students,
      effectiveStartDate: templateEffectiveStartDate,
      deskCount: classroomSettings.deskCount,
    })
    const xlsx = await import('xlsx')
    xlsx.writeFile(
      buildRegularLessonTemplateWorkbook(xlsx, { template, templateHistory: classroomSettings.regularLessonTemplateHistory, teachers, students, deskCount: classroomSettings.deskCount }),
      '通常授業テンプレート.xlsx',
    )
    setStatusMessage('通常授業テンプレートを Excel 出力しました。')
  }

  const handleTemplateImportClick = () => {
    templateFileInputRef.current?.click()
  }

  const handleTemplateImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const dates = listTemplateStartDatesFromWorkbook(xlsx, workbook)
      if (dates.length > 1) {
        setTemplateImportDateOptions({ dates, xlsxModule: xlsx, workbook })
        return
      }
      applyTemplateImport(xlsx, workbook)
    } catch {
      setStatusMessage('通常授業テンプレートの Excel 取り込みに失敗しました。')
    }
  }

  const applyTemplateImport = (xlsx: typeof import('xlsx'), workbook: import('xlsx').WorkBook, selectedStartDate?: string) => {
    const currentTemplate = convertTemplateCellsToTemplate({
      cells: templateCells,
      teachers,
      students,
      effectiveStartDate: templateEffectiveStartDate,
      deskCount: classroomSettings.deskCount,
    })
    const normalizedCurrent = normalizeRegularLessonTemplate(currentTemplate, classroomSettings.deskCount)
    const importedTemplate = parseRegularLessonTemplateWorkbook(xlsx, workbook, {
      fallbackTemplate: normalizedCurrent,
      teachers,
      students,
      deskCount: classroomSettings.deskCount,
      selectedStartDate,
    })
    const filteredImported = filterTemplateParticipantsForReferenceDate({ template: importedTemplate, deskCount: classroomSettings.deskCount, teachers, students, referenceDate: toDateKey(new Date()) })
    const importedCells = buildTemplateBoardCells({ template: filteredImported, teachers, students, deskCount: classroomSettings.deskCount })
    pushTemplateUndo(templateCells)
    setTemplateCells(importedCells)
    setTemplateEffectiveStartDate(filteredImported.effectiveStartDate)
    setStatusMessage(selectedStartDate ? `開始日 ${selectedStartDate} のテンプレートを Excel から取り込みました。` : '通常授業テンプレートを Excel から取り込みました。')
  }

  const handleTemplateImportWithDate = (selectedDate: string) => {
    if (!templateImportDateOptions) return
    const { xlsxModule, workbook } = templateImportDateOptions
    applyTemplateImport(xlsxModule, workbook, selectedDate)
    setTemplateImportDateOptions(null)
  }

  const handleTemplatePackSort = () => {
    pushTemplateUndo(templateCells)
    const next = cloneTemplateCells(templateCells)
    for (const cell of next) {
      cell.desks = packSortCellDesks(cell)
    }
    setTemplateCells(next)
    setStudentMenu(null)
    setTeacherMenu(null)
    setStatusMessage('テンプレートを詰めて並び替えました。')
  }
  // ── End template mode helpers ──

  const findDuplicateStudentInCell = (targetCell: SlotCell, studentKey: string, excludedStudentId?: string) => {
    return findDuplicateStudentInCellByKey(
      targetCell,
      studentKey,
      (student) => resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName),
      excludedStudentId,
    )
  }

  const cloneLesson = (lesson: DeskLesson, student: StudentEntry): DeskLesson => ({
    id: `moved_${student.id}_${Date.now().toString(36)}`,
    warning: lesson.warning,
    note: lesson.note === '管理データ反映' ? undefined : lesson.note,
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
    sourceSuppressedRegularLessonOccurrences: string[],
    sourceScheduleCountAdjustments: ScheduleCountAdjustmentEntry[],
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
    suppressedRegularLessonOccurrences: [...sourceSuppressedRegularLessonOccurrences],
    scheduleCountAdjustments: cloneScheduleCountAdjustments(sourceScheduleCountAdjustments),
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
    nextSuppressedRegularLessonOccurrences: string[] = suppressedRegularLessonOccurrences,
    nextScheduleCountAdjustments: ScheduleCountAdjustmentEntry[] = scheduleCountAdjustments,
  ) => {
    setUndoStack((current) => [
      ...current,
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, suppressedRegularLessonOccurrences, scheduleCountAdjustments, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedRegularLessonOccurrences([...nextSuppressedRegularLessonOccurrences])
    setScheduleCountAdjustments(cloneScheduleCountAdjustments(nextScheduleCountAdjustments))
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
    const teacherAssignmentSource = !targetDesk.lesson && targetDesk.teacher.trim() && !targetDesk.manualTeacher
      ? 'manual-replaced'
      : 'manual'
    setManualTeacherAssignment(targetDesk, currentTeacherMenu.selectedTeacherName, selectedTeacher?.id, teacherAssignmentSource)
    commitWeeks(nextWeeks, weekIndex, currentTeacherMenu.cellId, currentTeacherMenu.deskIndex)
    setTeacherMenu(null)
    setStatusMessage(`${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, currentTeacherMenu.deskIndex)} の講師を ${currentTeacherMenu.selectedTeacherName} に設定しました。`)
  }

  const handleDeleteTeacher = () => {
    const currentTeacherMenu = teacherMenu
    if (!currentTeacherMenu || !teacherMenuContext) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === currentTeacherMenu.cellId)
    const targetDesk = targetCell?.desks[currentTeacherMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    const deletedTeacherName = targetDesk.teacher
    targetDesk.teacher = ''
    targetDesk.manualTeacher = true
    targetDesk.teacherAssignmentSource = 'deleted'
    targetDesk.teacherAssignmentSessionId = undefined
    targetDesk.teacherAssignmentTeacherId = deletedTeacherName || undefined
    commitWeeks(nextWeeks, weekIndex, currentTeacherMenu.cellId, currentTeacherMenu.deskIndex)
    setTeacherMenu(null)
    setStatusMessage(`${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, currentTeacherMenu.deskIndex)} の講師を削除しました。`)
  }

  const handleToggleHolidayDate = (dateKey: string) => {
    const isHoliday = classroomSettings.holidayDates.includes(dateKey)
    const isForceOpen = classroomSettings.forceOpenDates.includes(dateKey)
    const isClosedWeekday = classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay())

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
      const nextForceOpenDates = isClosedWeekday
        ? [...classroomSettings.forceOpenDates.filter((value) => value !== dateKey), dateKey].sort()
        : classroomSettings.forceOpenDates.filter((value) => value !== dateKey)

      // Suppress managed regular lessons so they don't get re-placed by the overlay.
      // The manual makeup adjustments added when the holiday was set still apply,
      // and restoring the lessons would double-count.
      let nextSuppressedRegularLessonOccurrences = [...suppressedRegularLessonOccurrences]
      const holidayDate = parseDateKey(dateKey)
      const holidayDayOfWeek = holidayDate.getDay()
      const schoolYear = resolveOperationalSchoolYear(holidayDate)
      const studentByIdLocal = new Map(students.map((s) => [s.id, s]))
      const teacherByIdLocal = new Map(teachers.map((t) => [t.id, t]))

      for (const row of regularLessons) {
        if (row.dayOfWeek !== holidayDayOfWeek) continue
        if (row.schoolYear !== schoolYear) continue
        const teacher = teacherByIdLocal.get(row.teacherId)
        if (teacher && resolveTeacherRosterStatus(teacher, dateKey) !== '在籍') continue
        if (!isRegularLessonParticipantActiveOnDate(row, dateKey)) continue

        const participants = [
          { studentId: row.student1Id, subject: row.subject1 },
          { studentId: row.student2Id, subject: row.subject2 },
        ].filter((p) => p.studentId && p.subject)

        for (const participant of participants) {
          const student = studentByIdLocal.get(participant.studentId)
          if (!student) continue
          if (!isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey)) continue
          const occurrenceKey = `${participant.studentId}__${participant.subject}__${dateKey}__${row.slotNumber}`
          nextSuppressedRegularLessonOccurrences = appendSuppressedRegularLessonOccurrence(nextSuppressedRegularLessonOccurrences, occurrenceKey)
        }
      }

      commitWeeks(
        cloneWeeks(weeks),
        weekIndex,
        selectedCellId,
        selectedDeskIndex,
        classroomSettings.holidayDates.filter((value) => value !== dateKey),
        nextForceOpenDates,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        nextSuppressedRegularLessonOccurrences,
      )
      setSelectedHolidayDate(dateKey)
      setStudentMenu(null)
      setSelectedStudentId(null)
      setSelectedMakeupStockKey(null)
      setStatusMessage(isClosedWeekday ? `${dateKey} の休校設定を解除しました。営業日に戻しました。` : `${dateKey} の休日設定を解除しました。通常営業に戻しました。`)
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
          const processedSlotIndices = new Set<number>()
          for (let slotIdx = 0; slotIdx < (desk.lesson?.studentSlots ?? []).length; slotIdx++) {
            const student = desk.lesson!.studentSlots[slotIdx]
            if (!student) continue
            processedSlotIndices.add(slotIdx)
            movedStudentCount += 1
            if (student.lessonType === 'special') {
              if (student.specialStockSource === 'session') {
                const lectureStudentKey = managedStudentByAnyName.get(student.name)?.id ?? `name:${resolveBoardStudentDisplayName(student.name)}`
                const lectureStockKey = buildLectureStockKey(lectureStudentKey, student.subject, student.specialSessionId)
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
              nextManualMakeupAdjustments = appendMakeupOrigin(nextManualMakeupAdjustments, stockKey, resolveOriginalRegularDate(student, cell.dateKey))

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

          if (desk.statusSlots) {
            for (let slotIdx = 0; slotIdx < desk.statusSlots.length; slotIdx++) {
              if (processedSlotIndices.has(slotIdx)) continue
              const statusEntry = desk.statusSlots[slotIdx]
              if (!statusEntry) continue
              movedStudentCount += 1
              if (statusEntry.lessonType === 'special') {
                if (statusEntry.specialStockSource === 'session') {
                  const lectureStudentKey = statusEntry.managedStudentId ?? managedStudentByAnyName.get(statusEntry.name)?.id ?? `name:${resolveBoardStudentDisplayName(statusEntry.name)}`
                  const lectureStockKey = buildLectureStockKey(lectureStudentKey, statusEntry.subject, statusEntry.specialSessionId ?? '')
                  nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, lectureStockKey)
                  nextManualLectureStockOrigins = appendManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, {
                    displayName: resolveBoardStudentDisplayName(statusEntry.name),
                    sessionId: statusEntry.specialSessionId ?? '',
                  })
                  if (!managedStudentByAnyName.get(statusEntry.name)) {
                    nextFallbackLectureStockStudents[lectureStockKey] = {
                      displayName: resolveBoardStudentDisplayName(statusEntry.name),
                      subject: statusEntry.subject,
                    }
                  }
                }
                continue
              }
              if (!statusEntry.manualAdded) {
                const statusStudentAsEntry = { name: statusEntry.name, manualAdded: statusEntry.manualAdded, subject: statusEntry.subject, lessonType: statusEntry.lessonType } as StudentEntry
                const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(statusStudentAsEntry), statusEntry.subject)
                nextManualMakeupAdjustments = appendMakeupOrigin(nextManualMakeupAdjustments, stockKey, cell.dateKey)

                const managedStudent = managedStudentByAnyName.get(statusEntry.name)
                if (!managedStudent) {
                  nextFallbackMakeupStudents[stockKey] = {
                    studentName: statusEntry.name,
                    displayName: resolveBoardStudentDisplayName(statusEntry.name),
                    subject: statusEntry.subject,
                  }
                }
              }
            }
            desk.statusSlots = undefined
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

  const handleDayHeaderClick = (dateKey: string, x: number, y: number) => {
    const isHoliday = classroomSettings.holidayDates.includes(dateKey)
    const isForceOpen = classroomSettings.forceOpenDates.includes(dateKey)
    const isClosedWeekday = classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay())

    if (isHoliday || isForceOpen || isClosedWeekday) {
      handleToggleHolidayDate(dateKey)
      setDayHeaderMenu(null)
      return
    }

    setDayHeaderMenu({ dateKey, x, y })
  }

  const handleClearStudentsOnDate = (dateKey: string) => {
    const confirmed = window.confirm(`${dateKey} の全コマの生徒を削除します。\n講師はそのまま残ります。\nストックへの移行は行いません。\nよろしいですか。`)
    if (!confirmed) {
      setDayHeaderMenu(null)
      setStatusMessage('生徒削除をキャンセルしました。')
      return
    }

    const nextWeeks = cloneWeeks(weeks)
    let clearedCount = 0

    for (const week of nextWeeks) {
      for (const cell of week) {
        if (cell.dateKey !== dateKey) continue
        for (const desk of cell.desks) {
          if (desk.lesson) {
            for (let slotIdx = 0; slotIdx < desk.lesson.studentSlots.length; slotIdx++) {
              if (desk.lesson.studentSlots[slotIdx]) {
                clearedCount += 1
                desk.lesson.studentSlots[slotIdx] = null
              }
            }
            if (desk.lesson.studentSlots.every((s) => s === null)) {
              desk.lesson = undefined
            }
          }
          if (desk.statusSlots) {
            for (let slotIdx = 0; slotIdx < desk.statusSlots.length; slotIdx++) {
              if (desk.statusSlots[slotIdx]) {
                clearedCount += 1
                desk.statusSlots[slotIdx] = null
              }
            }
            if (desk.statusSlots.every((s) => s === null)) {
              desk.statusSlots = undefined
            }
          }
        }
      }
    }

    // Suppress managed regular lessons so the overlay doesn't re-place them
    let nextSuppressedRegularLessonOccurrences = [...suppressedRegularLessonOccurrences]
    const targetDate = parseDateKey(dateKey)
    const targetDayOfWeek = targetDate.getDay()
    const schoolYear = resolveOperationalSchoolYear(targetDate)
    const studentByIdLocal = new Map(students.map((s) => [s.id, s]))

    for (const row of regularLessons) {
      if (row.dayOfWeek !== targetDayOfWeek) continue
      if (row.schoolYear !== schoolYear) continue
      if (!isRegularLessonParticipantActiveOnDate(row, dateKey)) continue

      const participants = [
        { studentId: row.student1Id, subject: row.subject1 },
        { studentId: row.student2Id, subject: row.subject2 },
      ].filter((p) => p.studentId && p.subject)

      for (const participant of participants) {
        const student = studentByIdLocal.get(participant.studentId)
        if (!student) continue
        if (!isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey)) continue
        const occurrenceKey = `${participant.studentId}__${participant.subject}__${dateKey}__${row.slotNumber}`
        nextSuppressedRegularLessonOccurrences = appendSuppressedRegularLessonOccurrence(nextSuppressedRegularLessonOccurrences, occurrenceKey)
      }
    }

    commitWeeks(
      nextWeeks,
      weekIndex,
      selectedCellId,
      selectedDeskIndex,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      nextSuppressedRegularLessonOccurrences,
    )
    setDayHeaderMenu(null)
    setSelectedHolidayDate(dateKey)
    setStudentMenu(null)
    setSelectedStudentId(null)
    setSelectedMakeupStockKey(null)
    setStatusMessage(`${dateKey} の生徒を削除しました。${clearedCount > 0 ? `${clearedCount}件の生徒を削除しました。` : '対象の生徒はいませんでした。'}`)
  }

  const handlePlaceMakeupFromStock = (cellId: string, deskIndex: number, studentIndex: number) => {
    if (!selectedMakeupStockEntry) return
    const placementEntry = selectedMakeupStockRawKey
      ? rawMakeupStockEntries.find((raw) => raw.key === selectedMakeupStockRawKey) ?? selectedMakeupStockEntry.nextPlacementEntry
      : selectedMakeupStockEntry.nextPlacementEntry
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
    if (hasMemoInStudentSlot(targetDesk, studentIndex)) {
      setStatusMessage('クリックした移動先にはメモがあります。メモを削除してから配置してください。')
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
    }, targetCell.dateKey)

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
    console.log('[振替ストック配置]', {
      placedStudent: { name: nextStudent.name, managedStudentId: nextStudent.managedStudentId, subject: nextStudent.subject, lessonType: nextStudent.lessonType, makeupSourceDate: nextStudent.makeupSourceDate },
      stockEntry: { key: selectedMakeupStockEntry.key, balance: selectedMakeupStockEntry.balance, studentId: selectedMakeupStockEntry.studentId },
      placementEntry: { key: placementEntry.key, studentId: placementEntry.studentId, nextOriginDate: placementEntry.nextOriginDate },
      targetDate: targetCell.dateKey,
    })
    commitWeeks(nextWeeks, weekIndex, cellId, deskIndex)
    const remainingBalance = selectedMakeupStockEntry.balance - 1
    if (stockPanelsRestoreState && remainingBalance <= 0) {
      setIsLectureStockOpen(stockPanelsRestoreState.lecture)
      setIsMakeupStockOpen(stockPanelsRestoreState.makeup)
      setStockPanelsRestoreState(null)
    } else if (!stockPanelsRestoreState) {
      setIsMakeupStockOpen(true)
    }
    setSelectedMakeupStockKey(null)
    setSelectedMakeupStockRawKey(null)
    if (remainingBalance > 0) {
      setStockActionModal({ type: 'makeup', entryKey: selectedMakeupStockEntry.key })
    }
    setStatusMessage(`${selectedMakeupStockEntry.displayName} の振替を ${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} に追加しました。`)
  }

  const handlePlaceLectureFromStock = (cellId: string, deskIndex: number, studentIndex: number) => {
    if (!selectedLectureStockEntry) return
    if (selectedLectureStockEntry.requestedCount <= 0) {
      setStatusMessage('この未消化講習は残数がありません。')
      return
    }
    const placementEntry = buildLecturePendingItems(selectedLectureStockEntry)[0] ?? null
    if (!placementEntry) {
      setStatusMessage('この未消化講習は配置できる科目残数がありません。')
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
    if (hasMemoInStudentSlot(targetDesk, studentIndex)) {
      setStatusMessage('クリックした移動先にはメモがあります。メモを削除してから配置してください。')
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
    const lectureStockKey = buildLectureStockKey(lectureStockStudentKey, placementEntry.subject, placementEntry.sessionId)
    const nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, lectureStockKey, -1)
    const nextManualLectureStockOrigins = placementEntry.sessionId
      ? consumeManualLectureStockOrigin(manualLectureStockOrigins, lectureStockKey, { sessionId: placementEntry.sessionId })
      : consumeManualLectureStockOrigin(manualLectureStockOrigins, lectureStockKey)
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
    setSelectedLectureStockKey(null)
    if (selectedLectureStockEntry.requestedCount > 1) {
      setStockActionModal({ type: 'lecture', entryKey: selectedLectureStockEntry.key })
    }
    setStatusMessage(`${selectedLectureStockEntry.displayName} の講習 ${placementEntry.subject} を ${targetCell.dateLabel} ${targetCell.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} に追加しました。`)
  }

  const handleAutoAssignLectureStockEntry = (entry: GroupedLectureStockEntry) => {
    if (entry.requestedCount <= 0) {
      setStatusMessage(`${entry.displayName} の未消化講習は残数がありません。`)
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
      setStatusMessage(`${entry.displayName} の未消化講習に割振対象がありません。`)
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
    const placementCandidates: LectureAutoAssignCandidate[] = []
    let evaluatedCandidateCount = 0
    const studentKey = entry.studentId

    while (remainingItems.length > 0) {
      const candidateSearch = findBestLectureAutoAssignCandidate({
        sourceWeeks: nextWeeks,
        pendingItems: remainingItems,
        managedStudent,
        studentKey,
      })
      const candidate = candidateSearch.bestCandidate
      evaluatedCandidateCount += candidateSearch.evaluatedCandidateCount
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
      const lectureStockKey = buildLectureStockKey(studentKey, candidate.matchedItem.subject, candidate.matchedItem.sessionId)
      nextManualLectureStockCounts = appendLectureStockCount(nextManualLectureStockCounts, lectureStockKey, -1)
      nextManualLectureStockOrigins = candidate.matchedItem.sessionId
        ? consumeManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, { sessionId: candidate.matchedItem.sessionId })
        : consumeManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey)
      const pendingIndex = remainingItems.indexOf(candidate.matchedItem)
      if (pendingIndex >= 0) remainingItems.splice(pendingIndex, 1)
      placementCandidates.push(candidate)
      placedItems.push({
        dateLabel: targetCell.dateLabel,
        slotLabel: targetCell.slotLabel,
        deskLabel: resolveDeskLabel(targetDesk, candidate.deskIndex),
      })
    }

    if (placedItems.length === 0) {
      setAutoAssignDebugReport({
        title: '講習自動割振デバッグ',
        summary: `${entry.displayName} は条件に合う空きコマが見つからず、自動割振できませんでした。`,
        details: `候補比較件数: ${evaluatedCandidateCount}`,
      })
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
    setAutoAssignDebugReport(buildAutoAssignDebugReport({
      entryLabel: entry.displayName,
      mode: 'lecture',
      placementCandidates,
      evaluatedCandidateCount,
      remainingCount: remainingItems.length,
    }))
    setIsLectureStockOpen(true)
    setSelectedLectureStockKey(remainingItems.length > 0 ? entry.key : null)
    setStatusMessage(
      `${entry.displayName} を自動割振しました。${placedItems.length}コマ配置しました。`
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
    const targetStudentBeforeMove = targetLessonBeforeMove?.studentSlots[studentIndex] ?? null

    if (targetDeskBeforeMove && hasMemoInStudentSlot(targetDeskBeforeMove, studentIndex) && !targetStudentBeforeMove) {
      setStatusMessage('クリックした移動先にはメモがあります。メモを削除してから配置してください。')
      return
    }

    const targetStatusBeforeMove = targetDeskBeforeMove?.statusSlots?.[studentIndex] ?? null
    if (targetStudentBeforeMove && targetStatusBeforeMove?.status === 'attended') {
      setStatusMessage('出席済みの生徒とは入れ替えできません。出席を解除してから操作してください。')
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

    let sourceFound = false
    for (const week of nextWeeks) {
      if (sourceFound) break
      for (const cell of week) {
        if (sourceFound) break
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
          sourceFound = true
          break
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

    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(movedStudent, sourceDateKey, sourceSlotNumber)

    if (movedStudent.lessonType !== 'special') {
      const originalDateKey = resolveOriginalRegularDate(movedStudent, sourceDateKey)
      const nextMovedStudent: StudentEntry = {
        ...movedStudent,
        lessonType: 'makeup',
        makeupSourceDate: originalDateKey,
        makeupSourceLabel: movedStudent.makeupSourceLabel ?? formatStockOriginLabel(originalDateKey, sourceSlotNumber),
      }
      movedStudent = normalizeLessonPlacement(nextMovedStudent, cellId.split('_')[0] ?? sourceDateKey)
    }

    // Check for duplicates (exclude both source and target students from check)
    const comparableStudentKey = resolveStockComparableStudentKey(movedStudent, managedStudentByAnyName, resolveBoardStudentDisplayName)
    const duplicateStudent = targetCell ? findDuplicateStudentInCell(targetCell, comparableStudentKey, movedStudent.id) : null
    if (duplicateStudent && duplicateStudent.id !== targetStudentBeforeMove?.id) {
      setStatusMessage(`同コマにすでに${resolveBoardStudentDisplayName(duplicateStudent.name)}が組まれているため移動不可です。`)
      return
    }

    // Get the target student (for swap)
    const swapStudent = targetDesk.lesson?.studentSlots[studentIndex] ?? null

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

    // If swap: convert the swap student to makeup and place at source position
    if (swapStudent) {
      let convertedSwapStudent = swapStudent
      if (swapStudent.lessonType !== 'special') {
        const originalSwapDateKey = resolveOriginalRegularDate(swapStudent, targetCell?.dateKey ?? sourceDateKey)
        const nextSwapStudent: StudentEntry = {
          ...swapStudent,
          lessonType: 'makeup',
          makeupSourceDate: originalSwapDateKey,
          makeupSourceLabel: swapStudent.makeupSourceLabel ?? formatStockOriginLabel(originalSwapDateKey, targetCell?.slotNumber ?? 0),
        }
        convertedSwapStudent = normalizeLessonPlacement(nextSwapStudent, sourceDateKey)
      }

      // Find source desk in nextWeeks (it may have been cleared)
      const sourceCell = nextWeeks.flat().find((c) => c.id === sourceCellId)
      const sourceDesk = sourceCell?.desks.find((d) => d.id === sourceDeskId)
      if (sourceDesk) {
        if (sourceDesk.lesson) {
          sourceDesk.lesson.studentSlots[sourceSlotIndex] = convertedSwapStudent
        } else {
          sourceDesk.lesson = cloneLesson(sourceLessonSnapshot, convertedSwapStudent)
          sourceDesk.lesson.studentSlots = sourceSlotIndex === 0
            ? [convertedSwapStudent, null]
            : [null, convertedSwapStudent]
        }
      }
    }

    // Suppress managed occurrences for both moved and swapped students
    let nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : [...suppressedRegularLessonOccurrences]

    if (swapStudent) {
      const swapSuppressedKey = resolveSuppressedRegularLessonOccurrenceKey(swapStudent, targetCell?.dateKey ?? '', targetCell?.slotNumber ?? 0)
      if (swapSuppressedKey) {
        nextSuppressedRegularLessonOccurrences = appendSuppressedRegularLessonOccurrence(nextSuppressedRegularLessonOccurrences, swapSuppressedKey)
      }
    }

    commitWeeks(nextWeeks, weekIndex, cellId, deskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents, nextSuppressedRegularLessonOccurrences)
    setSelectedStudentId(null)
    if (swapStudent) {
      setStatusMessage(`${resolveBoardStudentDisplayName(movedStudent.name)} と ${resolveBoardStudentDisplayName(swapStudent.name)} を入れ替えました。`)
    } else {
      setStatusMessage(`${resolveBoardStudentDisplayName(movedStudent.name)} を ${targetCell?.dateLabel} ${targetCell?.slotLabel} / ${resolveDeskLabel(targetDesk, deskIndex)} へ移動しました。`)
    }
  }

  const handleStudentClick = (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, hasMemo: boolean, _statusKind: StudentStatusKind | null, x: number, y: number) => {
    setSelectedCellId(cellId)
    setSelectedDeskIndex(deskIndex)
    setTeacherMenu(null)
    const targetCell = cells.find((cell) => cell.id === cellId)
    const currentMemo = targetCell?.desks[deskIndex]?.memoSlots?.[studentIndex] ?? ''
    const currentStatus = targetCell?.desks[deskIndex]?.statusSlots?.[studentIndex] ?? null

    if (hasStudent) {
      if (selectedStudentId) {
        executeMoveStudent(cellId, deskIndex, studentIndex)
        return
      }
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
      setStatusMessage(currentStatus ? `${currentStatus.status === 'attended' ? '出席' : currentStatus.status === 'absent-no-makeup' ? '振無休' : '休み'}セルのメニューを開きました。` : '空欄メニューを開きました。')
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
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を選択しました。移動先セルを左クリックしてください。（移動先に生徒がいる場合は入れ替えます）`)
  }

  const handleOpenAddExistingStudent = () => {
    if (!studentMenu || !emptyMenuContext) return
    if (emptyMenuContext.statusEntry?.status === 'attended') {
      setStatusMessage('出席セルには既存生徒を追加できません。出席解除してから操作してください。')
      return
    }
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
    setStatusMessage('生徒追加メニューを開きました。')
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
    if (hasMemoInStudentSlot(targetDesk, studentMenu.studentIndex)) {
      setStatusMessage('この生徒マスにはメモがあります。メモを削除してから追加してください。')
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
    setStatusMessage(
      addExistingStudentDraft.lessonType === 'special'
        ? `${studentName} を講習として追加しました。未消化講習数は増やしません。`
        : `${studentName} を ${lessonTypeLabels[addExistingStudentDraft.lessonType]} として追加しました。`,
    )
  }

  const handleCloseEdit = () => {
    if (!studentMenu) return
    setEditStudentDraft(null)
    setAddExistingStudentDraft(null)
    setTrialStudentDraft(null)
    setStudentMenu({ ...studentMenu, mode: menuStudent ? 'root' : 'empty' })
  }

  const handleOpenTrialStudent = () => {
    if (!studentMenu || !emptyMenuContext) return
    setTrialStudentDraft({ name: '', grade: '中1', subject: '英' })
    setStudentMenu({ ...studentMenu, mode: 'trial' })
  }

  const handleSaveTrialStudent = () => {
    if (!studentMenu || studentMenu.mode !== 'trial' || !emptyMenuContext || !trialStudentDraft) return
    if (!trialStudentDraft.name.trim()) {
      setStatusMessage('名前を入力してください。')
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
    if (hasMemoInStudentSlot(targetDesk, studentMenu.studentIndex)) {
      setStatusMessage('この生徒マスにはメモがあります。メモを削除してから追加してください。')
      return
    }

    const nextStudent: StudentEntry = {
      id: createStudentId(targetCell.id, studentMenu.deskIndex, studentMenu.studentIndex),
      name: trialStudentDraft.name.trim(),
      grade: trialStudentDraft.grade,
      subject: trialStudentDraft.subject,
      lessonType: 'trial',
      teacherType: 'normal',
      manualAdded: true,
    }

    if (!targetDesk.lesson) {
      targetDesk.lesson = {
        id: `${targetCell.id}_desk_${studentMenu.deskIndex + 1}_manual`,
        studentSlots: [null, null],
      }
    }
    targetDesk.lesson.studentSlots[studentMenu.studentIndex] = nextStudent

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
    setTrialStudentDraft(null)
    setStatusMessage(`${trialStudentDraft.name.trim()} を体験授業として追加しました。`)
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
        suppressedRegularLessonOccurrences,
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
        suppressedRegularLessonOccurrences,
      }),
      students,
      regularLessons,
      regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
      teachers,
      scheduleCountAdjustments,
      defaultStartDate: storedRange.startDate,
      defaultEndDate: storedRange.endDate,
      defaultPeriodValue: storedRange.periodValue,
      titleLabel: formatWeeklyScheduleTitle(storedRange.startDate, storedRange.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
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
        suppressedRegularLessonOccurrences,
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
        suppressedRegularLessonOccurrences,
      }),
      teachers,
      defaultStartDate: storedRange.startDate,
      defaultEndDate: storedRange.endDate,
      defaultPeriodValue: storedRange.periodValue,
      titleLabel: formatWeeklyScheduleTitle(storedRange.startDate, storedRange.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
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
        setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} の手動追加講習を盤面から外しました。未消化講習には戻しません。`)
        if (selectedStudentId === menuStudent.student.id) {
          setSelectedStudentId(null)
        }
        return
      }

      const lectureStudentKey = managedStudentByAnyName.get(menuStudent.student.name)?.id ?? `name:${resolveBoardStudentDisplayName(menuStudent.student.name)}`
      const lectureStockKey = buildLectureStockKey(lectureStudentKey, menuStudent.student.subject, menuStudent.student.specialSessionId)
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
      setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を未消化講習へ戻しました。`)
      if (selectedStudentId === menuStudent.student.id) {
        setSelectedStudentId(null)
      }
      return
    }

    const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(menuStudent.student), menuStudent.student.subject)
    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(menuStudent.student, targetCell.dateKey, targetCell.slotNumber)
    const nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : suppressedRegularLessonOccurrences
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
      nextSuppressedRegularLessonOccurrences,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(menuStudent.student.name)} を未消化振替へ戻しました。`)
    if (selectedStudentId === menuStudent.student.id) {
      setSelectedStudentId(null)
    }
  }

  const handleMarkStudentAbsent = () => {
    if (!studentMenu || !menuStudent) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    const targetStudent = targetLesson?.studentSlots[studentMenu.studentIndex]
    if (!targetCell || !targetDesk || !targetStudent) return

    const absentStatusEntry = buildStudentStatusEntry(targetStudent, targetCell, targetDesk, 'absent')
    removeStudentFromDeskLesson(targetDesk, studentMenu.studentIndex)
    setDeskStudentStatus(targetDesk, studentMenu.studentIndex, absentStatusEntry)

    if (targetStudent.lessonType === 'special') {
      if (targetStudent.specialStockSource !== 'session') {
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
        setStatusMessage(`${resolveBoardStudentDisplayName(targetStudent.name)} を休みにしました。手動追加講習のため未消化講習には戻していません。`)
        return
      }

      const lectureStudentKey = managedStudentByAnyName.get(targetStudent.name)?.id ?? `name:${resolveBoardStudentDisplayName(targetStudent.name)}`
      const lectureStockKey = buildLectureStockKey(lectureStudentKey, targetStudent.subject, targetStudent.specialSessionId)
      const nextManualLectureStockCounts = appendLectureStockCount(manualLectureStockCounts, lectureStockKey)
      const nextManualLectureStockOrigins = appendManualLectureStockOrigin(manualLectureStockOrigins, lectureStockKey, {
        displayName: resolveBoardStudentDisplayName(targetStudent.name),
        sessionId: targetStudent.specialSessionId,
      })
      const nextFallbackLectureStockStudents = managedStudentByAnyName.get(targetStudent.name)
        ? fallbackLectureStockStudents
        : {
            ...fallbackLectureStockStudents,
            [lectureStockKey]: {
              displayName: resolveBoardStudentDisplayName(targetStudent.name),
              subject: targetStudent.subject,
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
      setStatusMessage(`${resolveBoardStudentDisplayName(targetStudent.name)} を休みにし、未消化講習へ戻しました。`)
      return
    }

    const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(targetStudent), targetStudent.subject)
    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(targetStudent, targetCell.dateKey, targetCell.slotNumber)
    const nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : suppressedRegularLessonOccurrences
    const nextManualMakeupAdjustments = (targetStudent.lessonType === 'regular' || !targetStudent.makeupSourceDate)
      ? appendMakeupOrigin(manualMakeupAdjustments, stockKey, resolveOriginalRegularDate(targetStudent, targetCell.dateKey))
      : manualMakeupAdjustments
    const managedStudent = managedStudentByAnyName.get(targetStudent.name)
    const nextFallbackMakeupStudents = managedStudent
      ? fallbackMakeupStudents
      : {
          ...fallbackMakeupStudents,
          [stockKey]: {
            studentName: targetStudent.name,
            displayName: resolveBoardStudentDisplayName(targetStudent.name),
            subject: targetStudent.subject,
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
      nextSuppressedRegularLessonOccurrences,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(targetStudent.name)} を休みにし、未消化振替へ戻しました。`)
  }

  const handleMarkStudentAbsentNoMakeup = () => {
    if (!studentMenu || !menuStudent) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    const targetStudent = targetLesson?.studentSlots[studentMenu.studentIndex]
    if (!targetCell || !targetDesk || !targetStudent) return

    const absentNoMakeupStatusEntry = buildStudentStatusEntry(targetStudent, targetCell, targetDesk, 'absent-no-makeup')
    removeStudentFromDeskLesson(targetDesk, studentMenu.studentIndex)
    setDeskStudentStatus(targetDesk, studentMenu.studentIndex, absentNoMakeupStatusEntry)

    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(targetStudent, targetCell.dateKey, targetCell.slotNumber)
    const nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : suppressedRegularLessonOccurrences

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
      nextSuppressedRegularLessonOccurrences,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(targetStudent.name)} を振無休にしました。`)
  }

  const handleMarkStudentAttended = () => {
    if (!studentMenu || !menuStudent) return

    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    const targetLesson = targetDesk?.lesson
    const targetStudent = targetLesson?.studentSlots[studentMenu.studentIndex]
    if (!targetCell || !targetDesk || !targetStudent) return

    const attendedStatusEntry = buildStudentStatusEntry(targetStudent, targetCell, targetDesk, 'attended')
    removeStudentFromDeskLesson(targetDesk, studentMenu.studentIndex)
    setDeskStudentStatus(targetDesk, studentMenu.studentIndex, attendedStatusEntry)
    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(targetStudent, targetCell.dateKey, targetCell.slotNumber)
    const nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : suppressedRegularLessonOccurrences

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
      nextSuppressedRegularLessonOccurrences,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(targetStudent.name)} を出席にしました。`)
  }

  const handleClearStudentStatus = () => {
    if (!studentMenu || !emptyMenuContext?.statusEntry) return

    const statusEntry = emptyMenuContext.statusEntry
    const nextWeeks = cloneWeeks(weeks)
    const targetCell = nextWeeks[weekIndex]?.find((cell) => cell.id === studentMenu.cellId)
    const targetDesk = targetCell?.desks[studentMenu.deskIndex]
    if (!targetCell || !targetDesk) return

    let nextManualMakeupAdjustments = manualMakeupAdjustments
    let nextManualLectureStockCounts = manualLectureStockCounts
    let nextManualLectureStockOrigins = manualLectureStockOrigins
    let nextSuppressedRegularLessonOccurrences = suppressedRegularLessonOccurrences

    restoreStudentToDesk(targetDesk, studentMenu.studentIndex, statusEntry)
    setDeskStudentStatus(targetDesk, studentMenu.studentIndex, null)

    const restoredStudent = buildStudentEntryFromStatus(statusEntry)
    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(restoredStudent, statusEntry.dateKey, statusEntry.slotNumber)
    if (suppressedOccurrenceKey) {
      nextSuppressedRegularLessonOccurrences = removeSuppressedRegularLessonOccurrence(nextSuppressedRegularLessonOccurrences, suppressedOccurrenceKey)
    }

    if (statusEntry.status === 'absent') {
      if (statusEntry.lessonType === 'special') {
        if (statusEntry.specialStockSource === 'session') {
          const lectureStudentKey = managedStudentByAnyName.get(statusEntry.name)?.id ?? `name:${resolveBoardStudentDisplayName(statusEntry.name)}`
          const lectureStockKey = buildLectureStockKey(lectureStudentKey, statusEntry.subject, statusEntry.specialSessionId)
          nextManualLectureStockCounts = removeLectureStockCount(nextManualLectureStockCounts, lectureStockKey)
          nextManualLectureStockOrigins = removeManualLectureStockOrigin(nextManualLectureStockOrigins, lectureStockKey, {
            sessionId: statusEntry.specialSessionId,
          })
        }
      } else if (statusEntry.lessonType === 'regular' || !statusEntry.makeupSourceDate) {
        const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(restoredStudent), statusEntry.subject)
        nextManualMakeupAdjustments = removeMakeupOrigin(nextManualMakeupAdjustments, stockKey, resolveOriginalRegularDate(restoredStudent, statusEntry.dateKey))
      }
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
      fallbackMakeupStudents,
      nextManualLectureStockCounts,
      nextManualLectureStockOrigins,
      fallbackLectureStockStudents,
      nextSuppressedRegularLessonOccurrences,
    )
    setStatusMessage(`${resolveBoardStudentDisplayName(statusEntry.name)} の${statusEntry.status === 'attended' ? '出席' : statusEntry.status === 'absent-no-makeup' ? '振無休' : '休み'}を解除しました。`)
  }

  const handleDeleteStudent = () => {
    if (!studentMenu || !menuStudent) return

    const studentDisplayName = resolveBoardStudentDisplayName(menuStudent.student.name)
    const confirmed = window.confirm(`${studentDisplayName} のこの授業を削除します。\n削除した授業は振替の対象になりません。\nよろしいですか。`)
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

    const suppressedOccurrenceKey = resolveSuppressedRegularLessonOccurrenceKey(menuStudent.student, targetCell.dateKey, targetCell.slotNumber)
    const nextSuppressedRegularLessonOccurrences = suppressedOccurrenceKey
      ? appendSuppressedRegularLessonOccurrence(suppressedRegularLessonOccurrences, suppressedOccurrenceKey)
      : suppressedRegularLessonOccurrences
    const nextScheduleCountAdjustments = !menuStudent.student.manualAdded
      ? appendScheduleCountAdjustment(scheduleCountAdjustments, {
          studentKey: resolveScheduleCountAdjustmentStudentKey(menuStudent.student),
          subject: menuStudent.student.subject,
          countKind: resolveScheduleCountAdjustmentKind(menuStudent.student),
          dateKey: targetCell.dateKey,
          delta: -1,
        })
      : scheduleCountAdjustments
    let nextSuppressedMakeupOrigins = cloneOriginMap(suppressedMakeupOrigins)
    let statusSuffix = '振替対象にはしません。'

    if (menuStudent.student.lessonType === 'regular') {
      const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(menuStudent.student), menuStudent.student.subject)
      nextSuppressedMakeupOrigins = appendMakeupOrigin(nextSuppressedMakeupOrigins, stockKey, resolveOriginalRegularDate(menuStudent.student, targetCell.dateKey))
      statusSuffix = '振替対象にはしません。'
    }

    if (menuStudent.student.lessonType === 'makeup' && menuStudent.student.makeupSourceDate) {
      const stockKey = buildMakeupStockKey(resolveBoardStudentStockId(menuStudent.student), menuStudent.student.subject)
      nextSuppressedMakeupOrigins = appendMakeupOrigin(nextSuppressedMakeupOrigins, stockKey, menuStudent.student.makeupSourceDate)
    }

    if (menuStudent.student.lessonType === 'special') {
      statusSuffix = '講習の予定を削除しました。'
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
      manualLectureStockCounts,
      manualLectureStockOrigins,
      fallbackLectureStockStudents,
      nextSuppressedRegularLessonOccurrences,
      nextScheduleCountAdjustments,
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
      setSelectedStudentId(null)
      setSelectedLectureStockKey(null)
      setStatusMessage('未消化振替一覧を開きました。生徒を選ぶと空欄セルへ配置できます。')
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
      setStatusMessage('未消化講習一覧を開きました。生徒を選ぶと空欄セルへ配置できます。')
    }
  }

  const handleSelectLectureStockEntry = (entry: GroupedLectureStockEntry, options?: { hidePanelsDuringPlacement?: boolean }) => {
    if (entry.requestedCount <= 0) {
      setStatusMessage(`${entry.displayName} の未消化講習は残数がありません。`)
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
    setStatusMessage(`${entry.displayName} の未消化講習を選択しました。空欄セルを左クリックしてください。`)
  }

  const handleSelectMakeupStockEntry = (entry: GroupedMakeupStockEntry, options?: { hidePanelsDuringPlacement?: boolean; rawKey?: string }) => {
    if (entry.balance <= 0) {
      setStatusMessage(`${entry.displayName} は先取り済みのため、残数が発生するまで選択できません。`)
      return
    }

    setSelectedStudentId(null)
    setSelectedLectureStockKey(null)
    setSelectedMakeupStockKey(entry.key)
    setSelectedMakeupStockRawKey(options?.rawKey ?? null)
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
    setStatusMessage(`${entry.displayName} の未消化振替を選択しました。空欄セルを左クリックしてください。`)
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
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, suppressedRegularLessonOccurrences, scheduleCountAdjustments, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedRegularLessonOccurrences([...previous.suppressedRegularLessonOccurrences])
    setScheduleCountAdjustments(cloneScheduleCountAdjustments(previous.scheduleCountAdjustments))
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
      createHistoryEntry(weeks, weekIndex, selectedCellId, selectedDeskIndex, classroomSettings.holidayDates, classroomSettings.forceOpenDates, suppressedRegularLessonOccurrences, scheduleCountAdjustments, manualMakeupAdjustments, suppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents),
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
    setSuppressedRegularLessonOccurrences([...next.suppressedRegularLessonOccurrences])
    setScheduleCountAdjustments(cloneScheduleCountAdjustments(next.scheduleCountAdjustments))
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
      cell.desks = packSortCellDesks(cell, { skipStatusSlotPack: true })
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
      <main className={`page-main page-main-board-only${isTemplateMode ? ' template-mode-active' : ''}`} onPointerDownCapture={acquireBoardInteraction}>
        <section className="board-panel board-panel-unified">
          {isBoardInteractionLocked && !isTemplateMode ? <div className="interaction-lock-banner" data-testid="board-interaction-lock-banner">{boardInteractionLockMessage}</div> : null}
          {isTemplateMode ? (
            <div className="template-mode-header-bar">
              <span className="template-mode-title">通常授業テンプレート編集</span>
              <label className="basic-data-inline-field basic-data-inline-field-short">
                <span>反映開始日</span>
                <input type="date" value={templateEffectiveStartDate} onChange={(e) => setTemplateEffectiveStartDate(e.target.value)} data-testid="template-effective-start-date" />
              </label>
              <span className="selection-pill">机数 {classroomSettings.deskCount}</span>
            </div>
          ) : null}
          <input ref={templateFileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { void handleTemplateImportFile(e) }} />
          <BoardToolbar
            weekLabel={weekLabel}
            statusMessage={statusMessage}
            lectureStockEntryCount={lectureStockEntries.length}
            isLectureStockOpen={isLectureStockOpen}
            makeupStockTotalCount={makeupStockTotalCount}
            isMakeupStockOpen={isMakeupStockOpen}
            isMakeupMoveActive={selectedMakeupStockKey !== null || selectedLectureStockKey !== null}
            isPrintingPdf={isPrintingPdf}
            isStudentScheduleOpen={isStudentScheduleOpen}
            isTeacherScheduleOpen={isTeacherScheduleOpen}
            hasSelectedStudent={selectedStudentId !== null || selectedMakeupStockKey !== null || selectedLectureStockKey !== null}
            canUndo={isTemplateMode ? templateUndoStack.length > 0 : undoStack.length > 0}
            canRedo={isTemplateMode ? templateRedoStack.length > 0 : redoStack.length > 0}
            canGoPrevWeek={!isTemplateMode}
            canGoNextWeek={!isTemplateMode}
            isTemplateMode={isTemplateMode}
            onUndo={isTemplateMode ? handleTemplateUndo : handleUndo}
            onRedo={isTemplateMode ? handleTemplateRedo : handleRedo}
            onPackSort={isTemplateMode ? handleTemplatePackSort : handlePackSort}
            onGoPrevWeek={() => switchWeek(weekIndex - 1)}
            onGoNextWeek={() => switchWeek(weekIndex + 1)}
            onToggleLectureStock={handleToggleLectureStock}
            onToggleMakeupStock={handleToggleMakeupStock}
            onOpenStudentSchedule={handleOpenStudentSchedule}
            onOpenTeacherSchedule={handleOpenTeacherSchedule}
            onOpenRegularTemplate={handleEnterTemplateMode}
            onPrintPdf={handlePrintPdf}
            onCancelSelection={handleCancelSelection}
            onOpenBasicData={onOpenBasicData}
            onOpenSpecialData={onOpenSpecialData}
            onOpenAutoAssignRules={onOpenAutoAssignRules}
            onOpenBackupRestore={onOpenBackupRestore}
            onLogout={onLogout}
            undoSnapshotLabel={undoSnapshotLabel ?? null}
            onRestoreUndoSnapshot={onRestoreUndoSnapshot}
            onDismissUndoSnapshot={onDismissUndoSnapshot}
            onTemplateExport={() => void handleTemplateExport()}
            onTemplateImport={handleTemplateImportClick}
            onTemplateSaveOverwrite={handleTemplateSaveRequest}
            onTemplateClear={handleTemplateClear}
            onTemplateClose={handleExitTemplateMode}
          />
          <div ref={boardExportRef} className="board-export-surface" data-testid="board-export-surface">
          {!isTemplateMode && stockActionModal ? (() => {
            if (stockActionModal.type === 'lecture') {
              const lectureEntry = lectureStockEntries.find((entry) => entry.key === stockActionModal.entryKey) ?? null
              if (!lectureEntry) return null
              const entryLabel = lectureEntry.displayName
              const canAutoAssign = Boolean(lectureEntry.studentId && (lectureEntry.requestedCount ?? 0) > 0)
              const pendingItems = lecturePendingItemsByEntryKey.get(lectureEntry.key)?.pendingItems ?? []

              return (
                <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setStockActionModal(null) }}>
                  <div className="auto-assign-modal" role="dialog" aria-modal="true" data-testid="stock-action-modal">
                    <div className="auto-assign-modal-title">{entryLabel}{lectureEntry.sessionLabel ? ` (${lectureEntry.sessionLabel})` : ''}</div>
                    <div className="student-menu-help-text">未消化の講習を選んで個別割振するか、自動割振で一括配置します。</div>
                    <div className="stock-origin-list">
                      {pendingItems.map((item, index) => (
                        <button
                          key={`${item.subject}-${item.sessionId ?? ''}-${index}`}
                          type="button"
                          className="stock-origin-item"
                          disabled={activeStockAutoAssignKey !== null}
                          onClick={() => {
                            handleSelectLectureStockEntry(lectureEntry, { hidePanelsDuringPlacement: true })
                            setStockActionModal(null)
                          }}
                          data-testid={`stock-origin-item-${index}`}
                        >
                          <span className="stock-origin-subject">{item.subject}</span>
                          {item.sessionLabel ? <span className="stock-origin-meta">{item.sessionLabel}</span> : null}
                          {item.startDate && item.endDate ? <span className="stock-origin-meta">{item.startDate} ～ {item.endDate}</span> : null}
                        </button>
                      ))}
                    </div>
                    <div className="auto-assign-modal-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={!canAutoAssign || activeStockAutoAssignKey !== null}
                        onClick={async () => {
                          const modalEntryKey = lectureEntry.key
                          if (!modalEntryKey) return
                          const restoreState = { lecture: isLectureStockOpen, makeup: isMakeupStockOpen }
                          await runStockAutoAssign(modalEntryKey, () => {
                            setStockPanelsRestoreState(restoreState)
                            setIsLectureStockOpen(false)
                            setIsMakeupStockOpen(false)
                            handleAutoAssignLectureStockEntry(lectureEntry)
                            setIsLectureStockOpen(restoreState.lecture)
                            setIsMakeupStockOpen(restoreState.makeup)
                            setStockPanelsRestoreState(null)
                          })
                          setStockActionModal(null)
                        }}
                        data-testid="stock-action-modal-auto"
                      >
                        {activeStockAutoAssignKey === lectureEntry.key
                          ? <span className="button-loading-content"><span className="button-spinner" aria-hidden="true" />自動割振中</span>
                          : '自動割振'}
                      </button>
                      <button className="secondary-button slim" type="button" disabled={activeStockAutoAssignKey !== null} onClick={() => setStockActionModal(null)} data-testid="stock-action-modal-cancel">閉じる</button>
                    </div>
                  </div>
                </div>
              )
            }

            if (stockActionModal.type === 'makeup') {
              const makeupEntry = makeupStockEntries.find((entry) => entry.key === stockActionModal.entryKey) ?? null
              if (!makeupEntry) return null
              const stockStudentKey = makeupEntry.stockStudentKey
              const rawEntries = rawMakeupStockEntries.filter((raw) => getStockStudentKeyFromEntryKey(raw.key) === stockStudentKey && raw.balance > 0)

              const originItems: MakeupStockOriginItem[] = []
              for (const raw of rawEntries) {
                const visibleCount = Math.max(0, raw.balance)
                for (let i = 0; i < visibleCount && i < raw.remainingOriginDates.length; i++) {
                  originItems.push({
                    rawEntryKey: raw.key,
                    originIndex: i,
                    date: raw.remainingOriginDates[i] ?? '',
                    label: raw.remainingOriginLabels[i] ?? '',
                    reasonLabel: raw.remainingOriginReasonLabels[i] ?? '振替発生',
                    subject: raw.subject,
                  })
                }
              }

              return (
                <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setStockActionModal(null) }}>
                  <div className="auto-assign-modal" role="dialog" aria-modal="true" data-testid="stock-action-modal">
                    <div className="auto-assign-modal-title">{makeupEntry.displayName}</div>
                    <div className="student-menu-help-text">配置したい未消化振替を選んでください。空欄セルをクリックして配置します。</div>
                    <div className="stock-origin-list">
                      {originItems.length === 0 ? (
                        <div className="makeup-stock-empty">配置可能な未消化振替がありません。</div>
                      ) : originItems.map((item, index) => (
                        <button
                          key={`${item.rawEntryKey}-${item.originIndex}`}
                          type="button"
                          className="stock-origin-item"
                          onClick={() => {
                            handleSelectMakeupStockEntry(makeupEntry, { hidePanelsDuringPlacement: true, rawKey: item.rawEntryKey })
                            setStockActionModal(null)
                          }}
                          data-testid={`stock-origin-item-${index}`}
                        >
                          <span className="stock-origin-subject">{item.subject}</span>
                          <span className="stock-origin-meta">{item.label}</span>
                          <span className="stock-origin-meta">({item.reasonLabel})</span>
                        </button>
                      ))}
                    </div>
                    <div className="auto-assign-modal-actions">
                      <button className="secondary-button slim" type="button" onClick={() => setStockActionModal(null)} data-testid="stock-action-modal-cancel">閉じる</button>
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })() : null}
          <BoardGrid
            cells={displayCells}
            selectedStudentId={selectedStudentId}
            highlightedCell={highlightedCell}
            highlightedHolidayDate={isTemplateMode ? null : selectedHolidayDate}
            yearLabel={isTemplateMode ? '' : yearLabel}
            specialPeriods={isTemplateMode ? [] : visibleSpecialSessions}
            resolveStudentDisplayName={resolveBoardStudentDisplayName}
            resolveStudentGradeLabel={isTemplateMode ? ((_name, fallbackGrade, _dateKey, birthDate) => birthDate ? resolveSchoolGradeLabel(birthDate, new Date()) : fallbackGrade) : resolveBoardStudentGradeLabel}
            resolveDisplayedLessonType={isTemplateMode ? ((_name, _subject, lessonType) => lessonType) : resolveDisplayedLessonType}
            onDayHeaderClick={isTemplateMode ? (() => {}) : handleDayHeaderClick}
            onTeacherClick={isTemplateMode ? handleTemplateSelectDesk : handleSelectDesk}
            onStudentClick={isTemplateMode ? handleTemplateStudentClick : handleStudentClick}
          />
          {dayHeaderMenu ? (
            <div className="day-header-menu-backdrop" onClick={() => setDayHeaderMenu(null)}>
              <div
                className="day-header-menu"
                style={{ left: dayHeaderMenu.x, top: dayHeaderMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="day-header-menu-title">{dayHeaderMenu.dateKey}</div>
                <button
                  className="day-header-menu-button"
                  data-testid="day-header-menu-holiday"
                  onClick={() => {
                    const dk = dayHeaderMenu.dateKey
                    setDayHeaderMenu(null)
                    handleToggleHolidayDate(dk)
                  }}
                >休日設定</button>
                <button
                  className="day-header-menu-button"
                  data-testid="day-header-menu-clear-students"
                  onClick={() => {
                    const dk = dayHeaderMenu.dateKey
                    handleClearStudentsOnDate(dk)
                  }}
                >生徒を空にする</button>
              </div>
            </div>
          ) : null}
          </div>
          {!isTemplateMode && !studentMenu && !teacherMenu && !selectedStudentId && (isLectureStockOpen || isMakeupStockOpen || autoAssignDebugReport) ? (
            <div className="stock-floating-modals">
              {isLectureStockOpen ? (
                <section className="lecture-stock-panel stock-floating-panel" data-testid="lecture-stock-panel">
                  <div className="makeup-stock-panel-head">
                    <div className="stock-floating-panel-title">
                      <strong>未消化講習</strong>
                      <span className="basic-data-muted-inline">生徒・講習期間ごとの未消化講習数です。</span>
                      <span className="basic-data-muted-inline">自動割振は各講習期間内の空きコマだけに配置します。</span>
                    </div>
                    <button className="secondary-button slim stock-floating-close" type="button" onClick={() => setIsLectureStockOpen(false)} data-testid="lecture-stock-close-button">閉じる</button>
                  </div>
                  <div className="makeup-stock-list">
                    {lectureStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の未消化講習はありません。</div>
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
                      <strong>未消化振替</strong>
                      <span className="basic-data-muted-inline">残数のある生徒を選ぶとコマ表へ配置できます。</span>
                    </div>
                    <button className="secondary-button slim stock-floating-close" type="button" onClick={() => setIsMakeupStockOpen(false)} data-testid="makeup-stock-close-button">閉じる</button>
                  </div>
                  <div className="makeup-stock-list">
                    {makeupStockEntries.length === 0 ? (
                      <div className="makeup-stock-empty">現在の未消化振替はありません。</div>
                    ) : makeupStockEntries.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className={`makeup-stock-row${selectedMakeupStockKey === entry.key ? ' active' : ''}${entry.balance < 0 ? ' is-negative' : ''}`}
                        onClick={() => {
                          setStockActionModal({ type: 'makeup', entryKey: entry.key })
                        }}
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
              {autoAssignDebugReport ? (
                <section className="stock-floating-panel auto-assign-debug-panel" data-testid="auto-assign-debug-panel">
                  <div className="makeup-stock-panel-head">
                    <div className="stock-floating-panel-title">
                      <strong>{autoAssignDebugReport.title}</strong>
                      <span className="basic-data-muted-inline">直近の自動割振について、各ルールをどの程度満たせたかを集計表示します。</span>
                    </div>
                    <div className="auto-assign-debug-actions">
                      <button className="secondary-button slim" type="button" onClick={copyAutoAssignDebugReport} data-testid="auto-assign-debug-copy">コピー</button>
                      <button className="secondary-button slim" type="button" onClick={() => setAutoAssignDebugReport(null)} data-testid="auto-assign-debug-close">閉じる</button>
                    </div>
                  </div>
                  <div className="status-banner">{autoAssignDebugReport.summary}</div>
                  <pre className="debug-preview auto-assign-debug-preview">{autoAssignDebugReport.details}</pre>
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
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.name}>{teacher.name}</option>
                  ))}
                </select>
              </div>
              <div className="student-menu-section student-menu-actions">
                <button type="button" className="primary-button" onClick={isTemplateMode ? handleTemplateConfirmTeacher : handleConfirmTeacher} data-testid="teacher-select-confirm-button">保存</button>
                {teacherMenuContext?.desk.teacher ? (
                  <button type="button" className="menu-link-button danger" onClick={isTemplateMode ? handleTemplateDeleteTeacher : handleDeleteTeacher} data-testid="teacher-delete-button">講師削除</button>
                ) : null}
              </div>
            </div>
          ) : null}
          {templateImportDateOptions ? (
            <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setTemplateImportDateOptions(null) }}>
              <div className="auto-assign-modal" role="dialog" aria-modal="true" style={{ minWidth: 260 }}>
                <div className="auto-assign-modal-title">取り込むテンプレートの開始日を選択</div>
                <div className="student-menu-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {templateImportDateOptions.dates.map((d) => (
                    <button key={d} className="primary-button" type="button" onClick={() => handleTemplateImportWithDate(d)}>{d}</button>
                  ))}
                </div>
                <div className="student-menu-section student-menu-actions">
                  <button type="button" className="secondary-button" onClick={() => setTemplateImportDateOptions(null)}>キャンセル</button>
                </div>
              </div>
            </div>
          ) : null}
          {templateSaveConfirm ? (
            <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setTemplateSaveConfirm(null) }}>
              <div className="auto-assign-modal" role="dialog" aria-modal="true" data-testid="template-save-confirm-modal">
                <div className="auto-assign-modal-title">
                  テンプレート上書き保存
                </div>
                <div className="student-menu-help-text" style={{ whiteSpace: 'pre-wrap' }}>
                  {`${templateSaveConfirm.template.effectiveStartDate} 以降のコマ表をすべてテンプレート内容で上書きします。\n\n手入力・メモ・振替・講習を含むすべてのデータが消去され、テンプレートの通常授業のみで再構築されます。\n\n実行しますか？`}
                </div>
                <div className="student-menu-section student-menu-actions">
                  <button type="button" className="primary-button" onClick={handleTemplateSaveConfirm} data-testid="template-save-confirm-execute-button">
                    上書き保存を実行
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setTemplateSaveConfirm(null)} data-testid="template-save-confirm-cancel-button">キャンセル</button>
                </div>
              </div>
            </div>
          ) : null}
          {isTemplateMode && studentMenu && (studentMenu.mode === 'root' || studentMenu.mode === 'empty' || studentMenu.mode === 'edit' || studentMenu.mode === 'add') ? (
            <div
              className="student-menu-popover"
              style={menuPosition}
              data-testid="student-action-menu"
            >
              <div className="student-menu-head">
                <strong>{studentMenu.mode === 'empty' || studentMenu.mode === 'add'
                  ? '空欄メニュー'
                  : templateMenuStudent?.student.name ?? ''}</strong>
                <button type="button" className="student-menu-close" onClick={() => { setStudentMenu(null); setTemplateEditDraft(null); setTemplateAddDraft(null) }}>x</button>
              </div>
              {studentMenu.mode === 'root' && templateMenuStudent ? (
                <div className="student-menu-section">
                  <button type="button" className="menu-link-button" onClick={handleTemplateStartMove} data-testid="menu-move-button">移動</button>
                  <button type="button" className="menu-link-button" onClick={handleTemplateOpenEdit} data-testid="menu-edit-button">編集</button>
                  <button type="button" className="menu-link-button" onClick={handleTemplateDeleteStudent} data-testid="menu-delete-button">削除</button>
                </div>
              ) : studentMenu.mode === 'empty' ? (
                <div className="student-menu-section">
                  <button type="button" className="menu-link-button" onClick={handleTemplateOpenAdd} data-testid="menu-open-add-existing-student-button">既存生徒追加</button>
                </div>
              ) : studentMenu.mode === 'edit' && templateEditDraft ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">編集</strong>
                    <button type="button" className="menu-link-button subtle" onClick={() => { setTemplateEditDraft(null); setStudentMenu({ ...studentMenu, mode: 'root' }) }} data-testid="menu-edit-back-button">戻る</button>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleTemplateConfirmEdit} data-testid="menu-edit-confirm-button">保存</button>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-edit-student-select">生徒</label>
                    <select
                      id="template-edit-student-select"
                      className="student-menu-select"
                      value={templateEditDraft.studentId}
                      onChange={(e) => setTemplateEditDraft((d) => d ? { ...d, studentId: e.target.value } : d)}
                      data-testid="template-edit-student-select"
                    >
                      <option value="">生徒なし</option>
                      {templateAddableStudents.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-edit-subject-select">科目</label>
                    <select
                      id="template-edit-subject-select"
                      className="student-menu-select"
                      value={templateEditDraft.subject}
                      onChange={(e) => setTemplateEditDraft((d) => d ? { ...d, subject: e.target.value as SubjectLabel } : d)}
                      data-testid="template-edit-subject-select"
                    >
                      {templateEditableSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-edit-note-input">注記</label>
                    <input
                      id="template-edit-note-input"
                      className="student-menu-input"
                      value={templateEditDraft.note}
                      maxLength={4}
                      onChange={(e) => setTemplateEditDraft((d) => d ? { ...d, note: e.target.value.slice(0, 4) } : d)}
                      data-testid="template-edit-note-input"
                    />
                  </div>
                </>
              ) : studentMenu.mode === 'add' && templateAddDraft ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">追加</strong>
                    <button type="button" className="menu-link-button subtle" onClick={() => { setTemplateAddDraft(null); setStudentMenu({ ...studentMenu, mode: 'empty' }) }} data-testid="menu-add-back-button">戻る</button>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleTemplateConfirmAdd} data-testid="menu-add-existing-student-confirm-button">追加</button>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-add-student-select">生徒</label>
                    <select
                      id="template-add-student-select"
                      className="student-menu-select"
                      value={templateAddDraft.studentId}
                      onChange={(e) => setTemplateAddDraft((d) => d ? { ...d, studentId: e.target.value } : d)}
                      data-testid="template-add-student-select"
                    >
                      {templateAddableStudents.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-add-subject-select">科目</label>
                    <select
                      id="template-add-subject-select"
                      className="student-menu-select"
                      value={templateAddDraft.subject}
                      onChange={(e) => setTemplateAddDraft((d) => d ? { ...d, subject: e.target.value as SubjectLabel } : d)}
                      data-testid="template-add-subject-select"
                    >
                      {templateEditableSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="template-add-note-input">注記</label>
                    <input
                      id="template-add-note-input"
                      className="student-menu-input"
                      value={templateAddDraft.note}
                      maxLength={4}
                      onChange={(e) => setTemplateAddDraft((d) => d ? { ...d, note: e.target.value.slice(0, 4) } : d)}
                      data-testid="template-add-note-input"
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {!isTemplateMode && studentMenu && (studentMenu.mode === 'memo' || studentMenu.mode === 'empty' || studentMenu.mode === 'add' || studentMenu.mode === 'trial' || menuStudent) ? (
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
                      ? '生徒追加'
                      : studentMenu?.mode === 'trial'
                        ? '体験授業'
                        : resolveBoardStudentDisplayName(menuStudent?.student.name ?? '')}</strong>
                <button type="button" className="student-menu-close" onClick={() => setStudentMenu(null)}>x</button>
              </div>
              {studentMenu?.mode === 'memo' ? null : studentMenu?.mode === 'empty' || studentMenu?.mode === 'add' || studentMenu?.mode === 'trial' ? (
                <div className="student-menu-meta">
                  {`${emptyMenuContext?.cell.dateLabel ?? ''} ${emptyMenuContext?.cell.slotLabel ?? ''} / ${studentMenu.deskIndex + 1}机目`}
                </div>
              ) : (
                <div className="student-menu-meta">
                  {`${resolveBoardStudentGradeLabel(menuStudent?.student.name ?? '', menuStudent?.student.grade ?? '', menuStudent?.cell.dateKey ?? displayWeekDate)} ${menuStudent ? resolveDisplayedBoardSubject(menuStudent.student, menuStudent.cell.dateKey) : ''}`}
                </div>
              )}
              {studentMenu?.mode === 'root' ? (
                <div className="student-menu-section">
                  {menuStudent?.student.lessonType === 'trial' ? (
                    <>
                      <button type="button" className="menu-link-button" onClick={handleMarkStudentAttended} data-testid="menu-attendance-button">出席</button>
                      <button type="button" className="menu-link-button" onClick={handleDeleteStudent} data-testid="menu-delete-button">削除</button>
                    </>
                  ) : (
                    <>
                  <div className="student-menu-button-row student-menu-button-row-three-up">
                    <button type="button" className="menu-link-button" onClick={handleMarkStudentAttended} data-testid="menu-attendance-button">出席</button>
                    <button type="button" className="menu-link-button" onClick={handleMarkStudentAbsent} data-testid="menu-absence-button">休み</button>
                    <button type="button" className="menu-link-button" onClick={handleMarkStudentAbsentNoMakeup} data-testid="menu-absence-no-makeup-button">振無休</button>
                  </div>
                  <button type="button" className="menu-link-button" onClick={handleStartMove} data-testid="menu-move-button">移動</button>
                  {menuStudent?.student.lessonType === 'special' && menuStudent.student.specialStockSource !== 'session' ? (
                    <div className="student-menu-help-text" data-testid="menu-stock-disabled-note">手動追加した講習は未消化講習へ戻せません。不要な場合は削除してください。</div>
                  ) : menuStudent?.student.manualAdded && (menuStudent.student.lessonType === 'regular' || menuStudent.student.lessonType === 'makeup') ? (
                    <div className="student-menu-help-text" data-testid="menu-stock-disabled-note">手動追加した通常/振替は未消化振替へ戻せません。不要な場合は削除してください。</div>
                  ) : (
                    <>
                      <button type="button" className="menu-link-button" onClick={handleStoreStudent} data-testid="menu-stock-button">{menuStudent ? getStudentStockMenuLabel(menuStudent.student) : 'ストックへ戻す'}</button>
                    </>
                  )}
                  <button type="button" className="menu-link-button" onClick={handleDeleteStudent} data-testid="menu-delete-button">削除</button>
                    </>
                  )}
                </div>
              ) : studentMenu?.mode === 'empty' ? (
                <div className="student-menu-section">
                  {emptyMenuContext?.statusEntry?.status === 'attended' ? (
                    <button type="button" className="menu-link-button" onClick={handleClearStudentStatus} data-testid="menu-clear-attendance-button">出席解除</button>
                  ) : emptyMenuContext?.statusEntry?.status === 'absent' ? (
                    <>
                      <div className="student-menu-button-row student-menu-button-row-three-up">
                        <button type="button" className="menu-link-button" onClick={handleOpenAddExistingStudent} data-testid="menu-open-add-existing-student-button">生徒追加</button>
                        {classroomName === '開発用教室' ? <button type="button" className="menu-link-button" onClick={handleOpenTrialStudent} data-testid="menu-open-trial-button">体験授業</button> : null}
                        <button type="button" className="menu-link-button" onClick={() => setStudentMenu((current) => (current ? { ...current, mode: 'memo' } : current))} data-testid="menu-open-memo-button">メモ</button>
                        <button type="button" className="menu-link-button" onClick={handleClearStudentStatus} data-testid="menu-clear-absence-button">休み解除</button>
                      </div>
                    </>
                  ) : emptyMenuContext?.statusEntry?.status === 'absent-no-makeup' ? (
                    <>
                      <div className="student-menu-button-row student-menu-button-row-three-up">
                        <button type="button" className="menu-link-button" onClick={handleOpenAddExistingStudent} data-testid="menu-open-add-existing-student-button">生徒追加</button>
                        {classroomName === '開発用教室' ? <button type="button" className="menu-link-button" onClick={handleOpenTrialStudent} data-testid="menu-open-trial-button">体験授業</button> : null}
                        <button type="button" className="menu-link-button" onClick={() => setStudentMenu((current) => (current ? { ...current, mode: 'memo' } : current))} data-testid="menu-open-memo-button">メモ</button>
                        <button type="button" className="menu-link-button" onClick={handleClearStudentStatus} data-testid="menu-clear-absence-no-makeup-button">振無休解除</button>
                      </div>
                    </>
                  ) : (
                    <div className="student-menu-button-row">
                      <button type="button" className="menu-link-button" onClick={handleOpenAddExistingStudent} data-testid="menu-open-add-existing-student-button">生徒追加</button>
                      {classroomName === '開発用教室' ? <button type="button" className="menu-link-button" onClick={handleOpenTrialStudent} data-testid="menu-open-trial-button">体験授業</button> : null}
                      <button type="button" className="menu-link-button" onClick={() => setStudentMenu((current) => (current ? { ...current, mode: 'memo' } : current))} data-testid="menu-open-memo-button">メモ</button>
                    </div>
                  )}
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
                    <div className="student-menu-type-grid student-menu-type-grid-lesson">
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
              ) : studentMenu?.mode === 'trial' ? (
                <>
                  <div className="student-menu-section student-menu-inline-head">
                    <strong className="student-menu-section-title">体験授業</strong>
                    <button type="button" className="menu-link-button subtle" onClick={handleCloseEdit} data-testid="menu-trial-back-button">戻る</button>
                  </div>
                  <div className="student-menu-section student-menu-actions">
                    <button type="button" className="primary-button" onClick={handleSaveTrialStudent} data-testid="menu-trial-confirm-button">追加</button>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="menu-trial-name-input">名前</label>
                    <input
                      id="menu-trial-name-input"
                      className="student-menu-input"
                      value={trialStudentDraft?.name ?? ''}
                      onChange={(event) => setTrialStudentDraft((current) => current ? { ...current, name: event.target.value } : current)}
                      data-testid="menu-trial-name-input"
                      autoFocus
                    />
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="menu-trial-grade-select">学年</label>
                    <select
                      id="menu-trial-grade-select"
                      className="student-menu-select"
                      value={trialStudentDraft?.grade ?? '中1'}
                      onChange={(event) => setTrialStudentDraft((current) => current ? { ...current, grade: event.target.value as GradeLabel } : current)}
                      data-testid="menu-trial-grade-select"
                    >
                      {(['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'] as GradeLabel[]).map((grade) => (
                        <option key={grade} value={grade}>{grade}</option>
                      ))}
                    </select>
                  </div>
                  <div className="student-menu-section">
                    <label className="student-menu-label" htmlFor="menu-trial-subject-select">科目</label>
                    <select
                      id="menu-trial-subject-select"
                      className="student-menu-select"
                      value={trialStudentDraft?.subject ?? '英'}
                      onChange={(event) => setTrialStudentDraft((current) => current ? { ...current, subject: event.target.value as SubjectLabel } : current)}
                      data-testid="menu-trial-subject-select"
                    >
                      {(['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社'] as SubjectLabel[]).map((subject) => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
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
                    <div className="student-menu-type-grid student-menu-type-grid-lesson">
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
                      value={editStudentDraft?.subject ?? editSubjectOptions[0] ?? editableSubjects[0]}
                      onChange={(event) => setEditStudentDraft((current) => (current ? { ...current, subject: event.target.value as SubjectLabel } : current))}
                      data-testid="menu-subject-select"
                    >
                      {editSubjectOptions.map((subject) => (
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