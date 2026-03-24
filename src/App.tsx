import { useCallback, useEffect, useRef, useState } from 'react'
import { BackupRestoreScreen } from './components/backup-restore/BackupRestoreScreen'
import { BasicDataScreen, buildWorkbook as buildBasicDataWorkbook, createTemplateBundle as createBasicDataTemplateBundle, initialGroupLessons, initialManagers, parseImportedBundle, type GroupLessonRow } from './components/basic-data/BasicDataScreen'
import { validateImportedBasicDataBundle } from './components/basic-data/basicDataImportValidation'
import { AutoAssignRuleScreen, buildAutoAssignWorkbook, parseAutoAssignWorkbook } from './components/auto-assign-rules/AutoAssignRuleScreen'
import { initialAutoAssignRules } from './components/auto-assign-rules/autoAssignRuleModel'
import { initialPairConstraints } from './types/pairConstraint'
import { deriveManagedDisplayName, getStudentDisplayName, getTeacherDisplayName, initialStudents, initialTeachers, type ManagerRow } from './components/basic-data/basicDataModel'
import { createInitialRegularLessons } from './components/basic-data/regularLessonModel'
import { buildSpecialSessionWorkbook, buildTemplateSpecialSessions, parseSpecialSessionWorkbook, SpecialSessionScreen } from './components/special-data/SpecialSessionScreen'
import { initialSpecialSessions } from './components/special-data/specialSessionModel'
import { ScheduleBoardScreen, buildManagedScheduleCellsForRange, buildScheduleCellsForRange, normalizeScheduleRange, readStoredScheduleRange, type ScheduleRangePreference } from './components/schedule-board/ScheduleBoardScreen'
import { importedMasterData } from './data/importedMasterData.generated'
import type { SlotCell } from './components/schedule-board/types'
import { getWeekStart, shiftDate } from './components/schedule-board/mockData'
import { loadAppSnapshot, parseAppSnapshot, saveAppSnapshot, serializeAppSnapshot } from './data/appSnapshotRepository'
import type { AppSnapshot, ClassroomSettings as SharedClassroomSettings, PersistedBoardState } from './types/appState'
import { DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID, fetchGoogleHolidayDates, mergeSyncedHolidayDates, readGoogleHolidaySyncCache, shouldRefreshGoogleHolidayCache, writeGoogleHolidaySyncCache } from './utils/googleHolidayCalendar'
import { createLegacyLessonScheduleQrConfig } from './utils/scheduleQrConfig'
import { formatWeeklyScheduleTitle, syncStudentScheduleHtml, syncTeacherScheduleHtml } from './utils/scheduleHtml'
import { syncSpecialSessionAvailabilityHtml } from './utils/specialSessionAvailabilityHtml'
import './App.css'

export type ClassroomSettings = SharedClassroomSettings

type GoogleHolidaySyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'disabled'

type GoogleHolidaySyncState = {
  status: GoogleHolidaySyncStatus
  message: string
}

export type TeacherAutoAssignRequest = {
  requestId: number
  sessionId: string
  teacherId: string
  mode: 'assign' | 'unassign'
}

export type StudentScheduleRequest = {
  requestId: number
  sessionId: string
  studentId: string
  mode: 'unassign'
}

type SchedulePopupRuntimeWindow = Window & typeof globalThis & {
  __lessonScheduleStudentWindow?: Window | null
  __lessonScheduleTeacherWindow?: Window | null
  __lessonScheduleSpecialSessionWindow?: Window | null
  __lessonScheduleSpecialSessionId?: string
  __lessonScheduleBoardWeeks?: SlotCell[][]
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function getSchedulePopupRuntimeWindow() {
  return window as SchedulePopupRuntimeWindow
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getScheduleFallbackRange() {
  const weekStart = getWeekStart(new Date())
  return {
    startDate: toDateKey(weekStart),
    endDate: toDateKey(shiftDate(weekStart, 6)),
  }
}

function buildNormalizedScheduleRange(viewType: 'student' | 'teacher', range: ScheduleRangePreference | null) {
  const fallbackRange = getScheduleFallbackRange()
  return normalizeScheduleRange(
    range ?? readStoredScheduleRange(viewType, fallbackRange.startDate, fallbackRange.endDate),
    fallbackRange.startDate,
    fallbackRange.endDate,
  )
}

function isGoogleHolidaySyncRuntimeEnabled() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return true
}

function shouldUseImportedMasterData() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return importedMasterData.teachers.length > 0 && importedMasterData.students.length > 0
}

function isSnapshotPersistenceRuntimeEnabled() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  return true
}

const normalizedImportedTeachers = importedMasterData.teachers.map((teacher) => ({
  ...teacher,
  displayName: deriveManagedDisplayName(teacher.name),
}))

const normalizedImportedStudents = importedMasterData.students.map((student) => ({
  ...student,
  displayName: deriveManagedDisplayName(student.name),
}))

const normalizedImportedRegularLessons = importedMasterData.regularLessons.map((row) => ({
  ...row,
  schoolYear: 2026,
}))

function createInitialClassroomSettings(): ClassroomSettings {
  if (!isGoogleHolidaySyncRuntimeEnabled()) {
    return {
      closedWeekdays: [0],
      holidayDates: [],
      forceOpenDates: [],
      deskCount: 14,
      operationStartDate: '',
      initialSetupCompletedAt: '',
      initialSetupMakeupStocks: [],
      initialSetupLectureStocks: [],
      googleHolidayCalendarSyncedDates: [],
      googleHolidayCalendarLastSyncedAt: '',
    }
  }

  const cache = readGoogleHolidaySyncCache()
  return {
    closedWeekdays: [0],
    holidayDates: cache?.syncedHolidayDates ?? [],
    forceOpenDates: [],
    deskCount: 14,
    operationStartDate: '',
    initialSetupCompletedAt: '',
    initialSetupMakeupStocks: [],
    initialSetupLectureStocks: [],
    googleHolidayCalendarSyncedDates: cache?.syncedHolidayDates ?? [],
    googleHolidayCalendarLastSyncedAt: cache?.lastSyncedAt ?? '',
  }
}

function App() {
  const isGoogleHolidaySyncEnabled = isGoogleHolidaySyncRuntimeEnabled()
  const useImportedMasterData = shouldUseImportedMasterData()
  const googleHolidayApiKey = (import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY ?? '').trim()
  const googleHolidayCalendarId = (import.meta.env.VITE_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID ?? DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID).trim()
  const holidaySyncInFlightRef = useRef(false)
  const holidaySyncBootstrapRef = useRef(false)
  const initialSetupAutoOpenRef = useRef(false)
  const teacherAutoAssignRequestIdRef = useRef(0)
  const studentScheduleRequestIdRef = useRef(0)
  const scheduleQrConfig = createLegacyLessonScheduleQrConfig()
  const [screen, setScreen] = useState<'board' | 'basic-data' | 'special-data' | 'auto-assign-rules' | 'backup-restore'>('board')
  const [managers, setManagers] = useState<ManagerRow[]>(initialManagers)
  const [teachers, setTeachers] = useState(() => useImportedMasterData ? normalizedImportedTeachers : initialTeachers)
  const [students, setStudents] = useState(() => useImportedMasterData ? normalizedImportedStudents : initialStudents)
  const [regularLessons, setRegularLessons] = useState(() => useImportedMasterData ? normalizedImportedRegularLessons : createInitialRegularLessons())
  const [groupLessons, setGroupLessons] = useState<GroupLessonRow[]>(initialGroupLessons)
  const [specialSessions, setSpecialSessions] = useState(initialSpecialSessions)
  const [autoAssignRules, setAutoAssignRules] = useState(initialAutoAssignRules)
  const [pairConstraints, setPairConstraints] = useState(initialPairConstraints)
  const [classroomSettings, setClassroomSettings] = useState<ClassroomSettings>(() => createInitialClassroomSettings())
  const [boardState, setBoardState] = useState<PersistedBoardState | null>(null)
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherAutoAssignRequest, setTeacherAutoAssignRequest] = useState<TeacherAutoAssignRequest | null>(null)
  const [studentScheduleRequest, setStudentScheduleRequest] = useState<StudentScheduleRequest | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState('保存データを確認しています。')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [hasHydratedSnapshot, setHasHydratedSnapshot] = useState(false)
  const [googleHolidaySyncState, setGoogleHolidaySyncState] = useState<GoogleHolidaySyncState>(() => {
    if (!isGoogleHolidaySyncEnabled) {
      return { status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' }
    }

    const cache = readGoogleHolidaySyncCache()
    return cache?.lastSyncedAt
      ? { status: 'idle', message: googleHolidayApiKey ? 'Google公開祝日の差分を起動時に反映します。' : '公開祝日データの差分を起動時に反映します。' }
      : { status: 'idle', message: googleHolidayApiKey ? 'Google公開祝日の初回同期を待機しています。' : '公開祝日データの初回同期を待機しています。' }
  })

  const runGoogleHolidaySync = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!isGoogleHolidaySyncEnabled) {
      setGoogleHolidaySyncState({ status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' })
      return
    }
    if (holidaySyncInFlightRef.current) return

    const cache = readGoogleHolidaySyncCache()
    if (!options?.force && cache?.lastSyncedAt && !shouldRefreshGoogleHolidayCache(cache.lastSyncedAt)) {
      if (!classroomSettings.googleHolidayCalendarLastSyncedAt) {
        setClassroomSettings((current) => ({
          ...current,
          holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], cache.syncedHolidayDates),
          googleHolidayCalendarSyncedDates: cache.syncedHolidayDates,
          googleHolidayCalendarLastSyncedAt: cache.lastSyncedAt,
        }))
      }
      return
    }

    holidaySyncInFlightRef.current = true
    setGoogleHolidaySyncState({
      status: 'syncing',
      message: options?.background
        ? (googleHolidayApiKey ? 'Google公開祝日をバックグラウンド同期中です。' : '公開祝日データをバックグラウンド同期中です。')
        : (googleHolidayApiKey ? 'Google公開祝日を同期中です。' : '公開祝日データを同期中です。'),
    })

    try {
      const syncedHolidayDates = await fetchGoogleHolidayDates({
        apiKey: googleHolidayApiKey,
        calendarId: googleHolidayCalendarId,
      })
      const syncedAt = new Date().toISOString()

      setClassroomSettings((current) => ({
        ...current,
        holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], syncedHolidayDates),
        googleHolidayCalendarSyncedDates: syncedHolidayDates,
        googleHolidayCalendarLastSyncedAt: syncedAt,
      }))
      writeGoogleHolidaySyncCache({ syncedHolidayDates, lastSyncedAt: syncedAt })
      setGoogleHolidaySyncState({ status: 'success', message: `${googleHolidayApiKey ? 'Google公開祝日' : '公開祝日データ'}を ${syncedHolidayDates.length} 件同期しました。` })
    } catch (error) {
      const message = error instanceof Error ? error.message : '祝日同期に失敗しました。'
      setGoogleHolidaySyncState({ status: 'error', message })
    } finally {
      holidaySyncInFlightRef.current = false
    }
  }, [classroomSettings.googleHolidayCalendarLastSyncedAt, googleHolidayApiKey, googleHolidayCalendarId, isGoogleHolidaySyncEnabled])

  const hasAnyExistingSetupData = useCallback(() => (
    managers.length > 0
    || teachers.length > 0
    || students.length > 0
    || regularLessons.length > 0
    || groupLessons.length > 0
    || specialSessions.some((session) => Object.keys(session.studentInputs).length > 0 || Object.keys(session.teacherInputs).length > 0)
    || autoAssignRules.some((rule) => rule.targets.length > 0 || rule.excludeTargets.length > 0)
    || pairConstraints.length > 0
    || boardState !== null
    || Boolean(classroomSettings.operationStartDate)
    || (classroomSettings.initialSetupMakeupStocks?.length ?? 0) > 0
    || (classroomSettings.initialSetupLectureStocks?.length ?? 0) > 0
  ), [autoAssignRules, boardState, classroomSettings.initialSetupLectureStocks, classroomSettings.initialSetupMakeupStocks, classroomSettings.operationStartDate, groupLessons.length, managers.length, pairConstraints.length, regularLessons.length, specialSessions, students.length, teachers.length])

  const syncStudentSchedulePopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const studentPopup = runtimeWindow.__lessonScheduleStudentWindow
    if (!studentPopup || studentPopup.closed) return

    const range = buildNormalizedScheduleRange('student', studentScheduleRange)

    syncStudentScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      plannedCells: buildManagedScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      students,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: studentPopup,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, regularLessons, scheduleQrConfig, specialSessions, studentScheduleRange, students, teachers])

  const syncTeacherSchedulePopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const teacherPopup = runtimeWindow.__lessonScheduleTeacherWindow
    if (!teacherPopup || teacherPopup.closed) return

    const range = buildNormalizedScheduleRange('teacher', teacherScheduleRange)

    syncTeacherScheduleHtml({
      cells: buildScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      plannedCells: buildManagedScheduleCellsForRange({
        range,
        fallbackStartDate: range.startDate,
        fallbackEndDate: range.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      teachers,
      defaultStartDate: range.startDate,
      defaultEndDate: range.endDate,
      defaultPeriodValue: range.periodValue,
      titleLabel: formatWeeklyScheduleTitle(range.startDate, range.endDate),
      classroomSettings,
      periodBands: specialSessions,
      specialSessions,
      qrConfig: scheduleQrConfig,
      targetWindow: teacherPopup,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, classroomSettings, regularLessons, scheduleQrConfig, specialSessions, students, teacherScheduleRange, teachers])

  const syncSpecialSessionPopup = useCallback(() => {
    const runtimeWindow = getSchedulePopupRuntimeWindow()
    const popupWindow = runtimeWindow.__lessonScheduleSpecialSessionWindow
    const sessionId = runtimeWindow.__lessonScheduleSpecialSessionId
    if (!popupWindow || popupWindow.closed || !sessionId) return

    const session = specialSessions.find((row) => row.id === sessionId)
    if (!session) return

    syncSpecialSessionAvailabilityHtml({
      session,
      allSessions: specialSessions,
      classroomSettings,
      teachers,
      students,
      scheduleCells: buildScheduleCellsForRange({
        range: {
          startDate: session.startDate,
          endDate: session.endDate,
          periodValue: '',
        },
        fallbackStartDate: session.startDate,
        fallbackEndDate: session.endDate,
        classroomSettings,
        teachers,
        students,
        regularLessons,
        boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
        suppressedRegularLessonOccurrences: boardState?.suppressedRegularLessonOccurrences ?? [],
      }),
      boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      targetWindow: popupWindow,
    })
  }, [boardState?.suppressedRegularLessonOccurrences, specialSessions, students, teachers])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {
      const message = event.data
      if (!message) return

      if (message.type === 'schedule-refresh-request') {
        if (message.viewType === 'student') syncStudentSchedulePopup()
        if (message.viewType === 'teacher') syncTeacherSchedulePopup()
        return
      }

      if (message.type === 'schedule-popup-ready') {
        if (message.viewType === 'student') syncStudentSchedulePopup()
        if (message.viewType === 'teacher') syncTeacherSchedulePopup()
        return
      }

      if (message.type === 'special-session-availability-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (message.personType !== 'teacher' && message.personType !== 'student') return
        const unavailableSlotCandidates = message.unavailableSlots
        if (!Array.isArray(unavailableSlotCandidates) || unavailableSlotCandidates.some((value: unknown) => typeof value !== 'string')) return
        const regularOnly = message.personType === 'student' ? Boolean(message.regularOnly) : false
        const subjectSlotCandidates = message.personType === 'student' && message.subjectSlots && typeof message.subjectSlots === 'object'
          ? message.subjectSlots as Record<string, unknown>
          : {}
        const subjectSlots = Object.entries(subjectSlotCandidates).reduce<Record<string, number>>((accumulator, [subject, value]) => {
          const normalizedValue = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(normalizedValue)) return accumulator

          const count = Math.max(0, Math.trunc(normalizedValue))
          if (count > 0) accumulator[subject] = count
          return accumulator
        }, {})

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(unavailableSlotCandidates as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          if (message.personType === 'teacher') {
            return {
              ...session,
              teacherInputs: {
                ...session.teacherInputs,
                [message.personId]: {
                  unavailableSlots,
                  countSubmitted: Boolean(session.teacherInputs[message.personId]?.countSubmitted),
                  updatedAt,
                },
              },
              updatedAt,
            }
          }

          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots,
                regularBreakSlots: session.studentInputs[message.personId]?.regularBreakSlots ?? [],
                subjectSlots: regularOnly ? {} : subjectSlots,
                regularOnly,
                countSubmitted: Boolean(session.studentInputs[message.personId]?.countSubmitted),
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-student-unavailable-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (!Array.isArray(message.unavailableSlots) || message.unavailableSlots.some((value: unknown) => typeof value !== 'string')) return

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(message.unavailableSlots as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.studentInputs[message.personId]
          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots,
                regularBreakSlots: previousInput?.regularBreakSlots ?? [],
                subjectSlots: previousInput?.subjectSlots ?? {},
                regularOnly: Boolean(previousInput?.regularOnly),
                countSubmitted: Boolean(previousInput?.countSubmitted),
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-student-count-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return

        const rawSubjectSlots = message.subjectSlots && typeof message.subjectSlots === 'object'
          ? message.subjectSlots as Record<string, unknown>
          : {}
        const subjectSlots = Object.entries(rawSubjectSlots).reduce<Record<string, number>>((accumulator, [subject, value]) => {
          const normalizedValue = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(normalizedValue)) return accumulator

          const count = Math.max(0, Math.trunc(normalizedValue))
          if (count > 0) accumulator[subject] = count
          return accumulator
        }, {})

        const updatedAt = new Date().toISOString()
        const regularOnly = Boolean(message.regularOnly)
        const countSubmitted = Boolean(message.countSubmitted)

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.studentInputs[message.personId]
          return {
            ...session,
            studentInputs: {
              ...session.studentInputs,
              [message.personId]: {
                unavailableSlots: previousInput?.unavailableSlots ?? [],
                regularBreakSlots: previousInput?.regularBreakSlots ?? [],
                subjectSlots: regularOnly ? {} : subjectSlots,
                regularOnly,
                countSubmitted,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))

        if (!countSubmitted) {
          studentScheduleRequestIdRef.current += 1
          setStudentScheduleRequest({
            requestId: studentScheduleRequestIdRef.current,
            sessionId: message.sessionId,
            studentId: message.personId,
            mode: 'unassign',
          })
        }
        return
      }

      if (message.type === 'schedule-teacher-unavailable-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return
        if (!Array.isArray(message.unavailableSlots) || message.unavailableSlots.some((value: unknown) => typeof value !== 'string')) return

        const updatedAt = new Date().toISOString()
        const unavailableSlots = Array.from(new Set(message.unavailableSlots as string[])).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }))

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.teacherInputs[message.personId]
          return {
            ...session,
            teacherInputs: {
              ...session.teacherInputs,
              [message.personId]: {
                unavailableSlots,
                countSubmitted: Boolean(previousInput?.countSubmitted),
                updatedAt,
              },
            },
            updatedAt,
          }
        }))
        return
      }

      if (message.type === 'schedule-teacher-count-save') {
        if (typeof message.sessionId !== 'string' || typeof message.personId !== 'string') return

        const updatedAt = new Date().toISOString()
        const countSubmitted = Boolean(message.countSubmitted)

        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const previousInput = session.teacherInputs[message.personId]
          return {
            ...session,
            teacherInputs: {
              ...session.teacherInputs,
              [message.personId]: {
                unavailableSlots: previousInput?.unavailableSlots ?? [],
                countSubmitted,
                updatedAt,
              },
            },
            updatedAt,
          }
        }))

        teacherAutoAssignRequestIdRef.current += 1
        setTeacherAutoAssignRequest({
          requestId: teacherAutoAssignRequestIdRef.current,
          sessionId: message.sessionId,
          teacherId: message.personId,
          mode: countSubmitted ? 'assign' : 'unassign',
        })
        return
      }

      if (message.type === 'special-session-availability-save-students') {
        if (typeof message.sessionId !== 'string') return
        if (!Array.isArray(message.entries)) return

        const normalizedEntries = message.entries.flatMap((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return []

          const rawEntry = entry as {
            personId?: unknown
            unavailableSlots?: unknown
            regularBreakSlots?: unknown
            subjectSlots?: unknown
            regularOnly?: unknown
            countSubmitted?: unknown
          }

          const personId = typeof rawEntry.personId === 'string' ? rawEntry.personId : ''
          if (!personId) return []

          const unavailableSlots = Array.isArray(rawEntry.unavailableSlots)
            ? rawEntry.unavailableSlots.filter((value: unknown): value is string => typeof value === 'string')
            : []
          const regularBreakSlots = Array.isArray(rawEntry.regularBreakSlots)
            ? rawEntry.regularBreakSlots.filter((value: unknown): value is string => typeof value === 'string')
            : []
          const rawSubjectSlots = rawEntry.subjectSlots && typeof rawEntry.subjectSlots === 'object'
            ? rawEntry.subjectSlots as Record<string, unknown>
            : {}
          const subjectSlots = Object.entries(rawSubjectSlots).reduce<Record<string, number>>((accumulator, [subject, value]) => {
            const normalizedValue = typeof value === 'number' ? value : Number(value)
            if (!Number.isFinite(normalizedValue)) return accumulator

            const count = Math.max(0, Math.trunc(normalizedValue))
            if (count > 0) accumulator[subject] = count
            return accumulator
          }, {})

          return [{
            personId,
            unavailableSlots: Array.from(new Set<string>(unavailableSlots)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            regularBreakSlots: Array.from(new Set<string>(regularBreakSlots)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            regularOnly: Boolean(rawEntry.regularOnly),
            countSubmitted: Boolean(rawEntry.countSubmitted),
            subjectSlots,
          }]
        })

        const updatedAt = new Date().toISOString()
        setSpecialSessions((current) => current.map((session) => {
          if (session.id !== message.sessionId) return session

          const nextStudentInputs = { ...session.studentInputs }
          for (const entry of normalizedEntries) {
            nextStudentInputs[entry.personId] = {
              unavailableSlots: entry.unavailableSlots,
              regularBreakSlots: entry.regularBreakSlots,
              subjectSlots: entry.regularOnly ? {} : entry.subjectSlots,
              regularOnly: entry.regularOnly,
              countSubmitted: entry.countSubmitted,
              updatedAt,
            }
          }

          return {
            ...session,
            studentInputs: nextStudentInputs,
            updatedAt,
          }
        }))
        return
      }

      if (message.type !== 'schedule-range-update') return
      if (message.viewType !== 'student' && message.viewType !== 'teacher') return
      if (typeof message.startDate !== 'string' || typeof message.endDate !== 'string') return

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
  }, [syncStudentSchedulePopup, syncTeacherSchedulePopup])

  useEffect(() => {
    syncSpecialSessionPopup()
  }, [syncSpecialSessionPopup])

  useEffect(() => {
    syncStudentSchedulePopup()
  }, [syncStudentSchedulePopup])

  useEffect(() => {
    syncTeacherSchedulePopup()
  }, [syncTeacherSchedulePopup])

  useEffect(() => {
    if (typeof window === 'undefined' || !boardState) return
    getSchedulePopupRuntimeWindow().__lessonScheduleBoardWeeks = boardState.weeks
    syncSpecialSessionPopup()
    syncStudentSchedulePopup()
    syncTeacherSchedulePopup()
  }, [boardState, syncSpecialSessionPopup, syncStudentSchedulePopup, syncTeacherSchedulePopup])

  useEffect(() => {
    if (!isGoogleHolidaySyncEnabled) return
    if (holidaySyncBootstrapRef.current) return
    holidaySyncBootstrapRef.current = true

    const cache = readGoogleHolidaySyncCache()
    if (cache && classroomSettings.googleHolidayCalendarLastSyncedAt !== cache.lastSyncedAt) {
      setClassroomSettings((current) => ({
        ...current,
        holidayDates: mergeSyncedHolidayDates(current.holidayDates, current.googleHolidayCalendarSyncedDates ?? [], cache.syncedHolidayDates),
        googleHolidayCalendarSyncedDates: cache.syncedHolidayDates,
        googleHolidayCalendarLastSyncedAt: cache.lastSyncedAt,
      }))
    }

    void runGoogleHolidaySync({ background: true })

    if (!googleHolidayApiKey) return

    const intervalId = window.setInterval(() => {
      const latestCache = readGoogleHolidaySyncCache()
      if (latestCache?.lastSyncedAt && !shouldRefreshGoogleHolidayCache(latestCache.lastSyncedAt)) return
      void runGoogleHolidaySync({ background: true })
    }, 60 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [classroomSettings.googleHolidayCalendarLastSyncedAt, googleHolidayApiKey, isGoogleHolidaySyncEnabled, runGoogleHolidaySync])

  useEffect(() => {
    if (!isSnapshotPersistenceRuntimeEnabled()) {
      setPersistenceMessage('')
      setHasHydratedSnapshot(true)
      return
    }

    let disposed = false

    void loadAppSnapshot()
      .then((snapshot) => {
        if (disposed) return
        if (snapshot) {
          setScreen(snapshot.screen)
          setManagers(snapshot.managers)
          setTeachers(snapshot.teachers)
          setStudents(snapshot.students)
          setRegularLessons(snapshot.regularLessons)
          setGroupLessons(snapshot.groupLessons)
          setSpecialSessions(snapshot.specialSessions)
          setAutoAssignRules(snapshot.autoAssignRules)
          setPairConstraints(snapshot.pairConstraints)
          setClassroomSettings(snapshot.classroomSettings)
          setBoardState(snapshot.boardState)
          setLastSavedAt(snapshot.savedAt)
          setPersistenceMessage('保存済みデータを読み込みました。')
        } else {
          setPersistenceMessage('保存データはまだありません。必要なら初期設定から開始してください。')
        }
        setHasHydratedSnapshot(true)
      })
      .catch(() => {
        if (disposed) return
        setPersistenceMessage('保存データの読み込みに失敗しました。現在の初期データで続行します。')
        setHasHydratedSnapshot(true)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (!isSnapshotPersistenceRuntimeEnabled()) return

    const snapshot: AppSnapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      screen,
      classroomSettings,
      managers,
      teachers,
      students,
      regularLessons,
      groupLessons,
      specialSessions,
      autoAssignRules,
      pairConstraints,
      boardState,
    }

    const timeoutId = window.setTimeout(() => {
      void saveAppSnapshot(snapshot)
        .then(() => {
          setLastSavedAt(snapshot.savedAt)
          setPersistenceMessage('自動保存しました。')
        })
        .catch(() => {
          setPersistenceMessage('自動保存に失敗しました。バックアップを書き出してください。')
        })
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [autoAssignRules, boardState, classroomSettings, groupLessons, hasHydratedSnapshot, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers])

  useEffect(() => {
    if (!hasHydratedSnapshot) return
    if (typeof navigator !== 'undefined' && navigator.webdriver) return
    if (classroomSettings.initialSetupCompletedAt) return
    if (initialSetupAutoOpenRef.current) return
    initialSetupAutoOpenRef.current = true
    setScreen('backup-restore')
  }, [classroomSettings.initialSetupCompletedAt, hasHydratedSnapshot])

  const exportBackup = useCallback(() => {
    const snapshot: AppSnapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      screen,
      classroomSettings,
      managers,
      teachers,
      students,
      regularLessons,
      groupLessons,
      specialSessions,
      autoAssignRules,
      pairConstraints,
      boardState,
    }
    downloadTextFile(`komahyouapp-backup-${snapshot.savedAt.slice(0, 10)}.json`, serializeAppSnapshot(snapshot), 'application/json')
    setLastSavedAt(snapshot.savedAt)
    setPersistenceMessage('バックアップを書き出しました。')
  }, [autoAssignRules, boardState, classroomSettings, groupLessons, managers, pairConstraints, regularLessons, screen, specialSessions, students, teachers])

  const importBackup = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const snapshot = parseAppSnapshot(text)
      setScreen(snapshot.screen)
      setManagers(snapshot.managers)
      setTeachers(snapshot.teachers)
      setStudents(snapshot.students)
      setRegularLessons(snapshot.regularLessons)
      setGroupLessons(snapshot.groupLessons)
      setSpecialSessions(snapshot.specialSessions)
      setAutoAssignRules(snapshot.autoAssignRules)
      setPairConstraints(snapshot.pairConstraints)
      setClassroomSettings(snapshot.classroomSettings)
      setBoardState(snapshot.boardState)
      setLastSavedAt(snapshot.savedAt)
      setPersistenceMessage('バックアップを読み込みました。')
    } catch {
      setPersistenceMessage('バックアップの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }, [])

  const exportBasicDataTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, createBasicDataTemplateBundle()), '基本データテンプレート.xlsx')
    setPersistenceMessage('基本データの Excel テンプレートを出力しました。')
  }, [])

  const exportBasicDataCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildBasicDataWorkbook(xlsx, { managers, teachers, students, regularLessons, groupLessons, classroomSettings }), '基本データ_現在.xlsx')
    setPersistenceMessage('基本データを Excel 出力しました。')
  }, [classroomSettings, groupLessons, managers, regularLessons, students, teachers])

  const importBasicDataWorkbook = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const imported = parseImportedBundle(xlsx, workbook, { managers, teachers, students, regularLessons, groupLessons, classroomSettings })
      const validationErrors = validateImportedBasicDataBundle(imported)
      if (validationErrors.length > 0) {
        window.alert([
          '基本データの取り込みを中断しました。',
          '以下の矛盾をすべて修正してから再取り込みしてください。',
          '',
          ...validationErrors.map((message, index) => `${index + 1}. ${message}`),
        ].join('\n'))
        setPersistenceMessage('基本データに矛盾が見つかったため、取り込みを中断しました。')
        return
      }

      if (hasAnyExistingSetupData()) {
        const confirmed = window.confirm([
          '現在の既存データはすべて削除されます。',
          '基本データ、特別講習データ、自動割振ルール、盤面調整、ストック、初期設定入力は消えます。',
          '元に戻せません。取り込みを続ける場合だけ OK を押してください。',
        ].join('\n'))
        if (!confirmed) {
          setPersistenceMessage('既存データ全削除の確認でキャンセルされたため、基本データ取り込みを中止しました。')
          return
        }
      }

      setManagers(imported.managers)
      setTeachers(imported.teachers)
      setStudents(imported.students)
      setRegularLessons(imported.regularLessons)
      setGroupLessons(imported.groupLessons)
      setSpecialSessions(initialSpecialSessions)
      setAutoAssignRules(initialAutoAssignRules)
      setPairConstraints(initialPairConstraints)
      setBoardState(null)
      setStudentScheduleRange(null)
      setTeacherScheduleRange(null)
      setTeacherAutoAssignRequest(null)
      setStudentScheduleRequest(null)
      setClassroomSettings({
        ...imported.classroomSettings,
        operationStartDate: '',
        initialSetupCompletedAt: '',
        initialSetupMakeupStocks: [],
        initialSetupLectureStocks: [],
        googleHolidayCalendarSyncedDates: [],
        googleHolidayCalendarLastSyncedAt: '',
      })
      setPersistenceMessage('基本データを Excel から取り込みました。既存データはすべて削除し、盤面も初期配置へ戻しました。')
      void runGoogleHolidaySync({ force: true, background: true })
    } catch {
      setPersistenceMessage('基本データの Excel 取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [classroomSettings, groupLessons, hasAnyExistingSetupData, managers, regularLessons, runGoogleHolidaySync, students, teachers])

  const exportSpecialDataTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildSpecialSessionWorkbook(xlsx, buildTemplateSpecialSessions(initialSpecialSessions, students, teachers), students, teachers), '特別講習データテンプレート.xlsx')
    setPersistenceMessage('特別講習データの Excel テンプレートを出力しました。')
  }, [students, teachers])

  const exportSpecialDataCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildSpecialSessionWorkbook(xlsx, specialSessions, students, teachers), '特別講習データ_現在.xlsx')
    setPersistenceMessage('特別講習データを Excel 出力しました。')
  }, [specialSessions, students, teachers])

  const importSpecialDataWorkbook = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      setSpecialSessions(parseSpecialSessionWorkbook(xlsx, workbook, specialSessions))
      setPersistenceMessage('特別講習データを Excel から取り込みました。')
    } catch {
      setPersistenceMessage('特別講習データの Excel 取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [specialSessions])

  const exportAutoAssignTemplate = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildAutoAssignWorkbook(xlsx, initialAutoAssignRules, [], Object.fromEntries(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), Object.fromEntries(students.map((student) => [student.id, getStudentDisplayName(student)]))), '自動割振ルールテンプレート.xlsx')
    setPersistenceMessage('自動割振ルールの Excel テンプレートを出力しました。')
  }, [students, teachers])

  const exportAutoAssignCurrent = useCallback(async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(buildAutoAssignWorkbook(xlsx, autoAssignRules, pairConstraints, Object.fromEntries(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), Object.fromEntries(students.map((student) => [student.id, getStudentDisplayName(student)]))), '自動割振ルール_現在.xlsx')
    setPersistenceMessage('自動割振ルールを Excel 出力しました。')
  }, [autoAssignRules, pairConstraints, students, teachers])

  const importAutoAssignWorkbookFile = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const teacherIdByName = new Map<string, string>()
      teachers.forEach((teacher) => {
        teacherIdByName.set(teacher.name, teacher.id)
        teacherIdByName.set(getTeacherDisplayName(teacher), teacher.id)
      })
      const studentIdByName = new Map<string, string>()
      students.forEach((student) => {
        studentIdByName.set(student.name, student.id)
        studentIdByName.set(getStudentDisplayName(student), student.id)
      })
      const imported = parseAutoAssignWorkbook(xlsx, workbook, autoAssignRules, pairConstraints, teacherIdByName, studentIdByName)
      setAutoAssignRules(imported.rules)
      setPairConstraints(imported.pairConstraints)
      setPersistenceMessage('自動割振ルールを Excel から取り込みました。')
    } catch {
      setPersistenceMessage('自動割振ルールの Excel 取り込みに失敗しました。シート名と列名を確認してください。')
    }
  }, [autoAssignRules, pairConstraints, students, teachers])

  const completeInitialSetup = useCallback(() => {
    setClassroomSettings((current) => ({
      ...current,
      initialSetupCompletedAt: new Date().toISOString(),
    }))
    setPersistenceMessage('初期設定を完了しました。')
    setScreen('board')
  }, [])

  if (screen === 'basic-data') {
    return (
      <BasicDataScreen
        classroomSettings={classroomSettings}
        googleHolidaySyncState={googleHolidaySyncState}
        isGoogleHolidayApiConfigured={Boolean(googleHolidayApiKey) && isGoogleHolidaySyncEnabled}
        managers={managers}
        teachers={teachers}
        students={students}
        regularLessons={regularLessons}
        groupLessons={groupLessons}
        onUpdateManagers={setManagers}
        onUpdateTeachers={setTeachers}
        onUpdateStudents={setStudents}
        onUpdateRegularLessons={setRegularLessons}
        onUpdateGroupLessons={setGroupLessons}
        onUpdateClassroomSettings={setClassroomSettings}
        onSyncGoogleHolidays={() => void runGoogleHolidaySync({ force: true })}
        onBackToBoard={() => setScreen('board')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
      />
    )
  }

  if (screen === 'special-data') {
    return (
      <SpecialSessionScreen
        sessions={specialSessions}
        students={students}
        teachers={teachers}
        onUpdateSessions={setSpecialSessions}
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
      />
    )
  }

  if (screen === 'auto-assign-rules') {
    return (
      <AutoAssignRuleScreen
        rules={autoAssignRules}
        teachers={teachers}
        students={students}
        pairConstraints={pairConstraints}
        onUpdateRules={setAutoAssignRules}
        onUpdatePairConstraints={setPairConstraints}
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
      />
    )
  }

  if (screen === 'backup-restore') {
    return (
      <BackupRestoreScreen
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
        persistenceMessage={persistenceMessage}
        lastSavedAt={lastSavedAt}
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        classroomSettings={classroomSettings}
        students={students}
        specialSessions={specialSessions}
        googleHolidaySyncState={googleHolidaySyncState}
        isGoogleHolidayApiConfigured={isGoogleHolidaySyncEnabled}
        onUpdateClassroomSettings={setClassroomSettings}
        onSyncGoogleHolidays={() => void runGoogleHolidaySync({ force: true })}
        onCompleteInitialSetup={completeInitialSetup}
        onExportBasicDataTemplate={exportBasicDataTemplate}
        onExportBasicDataCurrent={exportBasicDataCurrent}
        onImportBasicDataWorkbook={importBasicDataWorkbook}
        onExportSpecialDataTemplate={exportSpecialDataTemplate}
        onExportSpecialDataCurrent={exportSpecialDataCurrent}
        onImportSpecialDataWorkbook={importSpecialDataWorkbook}
        onExportAutoAssignTemplate={exportAutoAssignTemplate}
        onExportAutoAssignCurrent={exportAutoAssignCurrent}
        onImportAutoAssignWorkbook={importAutoAssignWorkbookFile}
      />
    )
  }

  return (
    <ScheduleBoardScreen
      classroomSettings={classroomSettings}
      teachers={teachers}
      students={students}
      regularLessons={regularLessons}
      specialSessions={specialSessions}
      autoAssignRules={autoAssignRules}
      pairConstraints={pairConstraints}
      teacherAutoAssignRequest={teacherAutoAssignRequest}
      studentScheduleRequest={studentScheduleRequest}
      initialBoardState={boardState}
      onBoardStateChange={setBoardState}
      onUpdateSpecialSessions={setSpecialSessions}
      onUpdateClassroomSettings={setClassroomSettings}
      onOpenBasicData={() => setScreen('basic-data')}
      onOpenSpecialData={() => setScreen('special-data')}
      onOpenAutoAssignRules={() => setScreen('auto-assign-rules')}
      onOpenBackupRestore={() => setScreen('backup-restore')}
    />
  )
}

export default App
