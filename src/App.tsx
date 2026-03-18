import { useCallback, useEffect, useRef, useState } from 'react'
import { BackupRestoreScreen } from './components/backup-restore/BackupRestoreScreen'
import { BasicDataScreen } from './components/basic-data/BasicDataScreen'
import { deriveManagedDisplayName, initialStudents, initialTeachers } from './components/basic-data/basicDataModel'
import { createInitialRegularLessons } from './components/basic-data/regularLessonModel'
import { SpecialSessionScreen } from './components/special-data/SpecialSessionScreen'
import { initialSpecialSessions } from './components/special-data/specialSessionModel'
import { ScheduleBoardScreen, buildScheduleCellsForRange, normalizeScheduleRange, readStoredScheduleRange, type ScheduleRangePreference } from './components/schedule-board/ScheduleBoardScreen'
import { importedMasterData } from './data/importedMasterData.generated'
import type { SlotCell } from './components/schedule-board/types'
import { getWeekStart, shiftDate } from './components/schedule-board/mockData'
import { DEFAULT_GOOGLE_PUBLIC_HOLIDAY_CALENDAR_ID, fetchGoogleHolidayDates, mergeSyncedHolidayDates, readGoogleHolidaySyncCache, shouldRefreshGoogleHolidayCache, writeGoogleHolidaySyncCache } from './utils/googleHolidayCalendar'
import { createLegacyLessonScheduleQrConfig } from './utils/scheduleQrConfig'
import { formatWeeklyScheduleTitle, syncStudentScheduleHtml, syncTeacherScheduleHtml } from './utils/scheduleHtml'
import { syncSpecialSessionAvailabilityHtml } from './utils/specialSessionAvailabilityHtml'
import './App.css'

export type ClassroomSettings = {
  closedWeekdays: number[]
  holidayDates: string[]
  forceOpenDates: string[]
  deskCount: number
  googleHolidayCalendarSyncedDates?: string[]
  googleHolidayCalendarLastSyncedAt?: string
}

type GoogleHolidaySyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'disabled'

type GoogleHolidaySyncState = {
  status: GoogleHolidaySyncStatus
  message: string
}

type SchedulePopupRuntimeWindow = Window & typeof globalThis & {
  __lessonScheduleStudentWindow?: Window | null
  __lessonScheduleTeacherWindow?: Window | null
  __lessonScheduleSpecialSessionWindow?: Window | null
  __lessonScheduleSpecialSessionId?: string
  __lessonScheduleBoardWeeks?: SlotCell[][]
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
  const scheduleQrConfig = createLegacyLessonScheduleQrConfig()
  const [screen, setScreen] = useState<'board' | 'basic-data' | 'special-data' | 'backup-restore'>('board')
  const [teachers, setTeachers] = useState(() => useImportedMasterData ? normalizedImportedTeachers : initialTeachers)
  const [students, setStudents] = useState(() => useImportedMasterData ? normalizedImportedStudents : initialStudents)
  const [regularLessons, setRegularLessons] = useState(() => useImportedMasterData ? normalizedImportedRegularLessons : createInitialRegularLessons())
  const [specialSessions, setSpecialSessions] = useState(initialSpecialSessions)
  const [classroomSettings, setClassroomSettings] = useState<ClassroomSettings>(() => createInitialClassroomSettings())
  const [studentScheduleRange, setStudentScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [teacherScheduleRange, setTeacherScheduleRange] = useState<ScheduleRangePreference | null>(null)
  const [googleHolidaySyncState, setGoogleHolidaySyncState] = useState<GoogleHolidaySyncState>(() => {
    if (!isGoogleHolidaySyncEnabled) {
      return { status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' }
    }
    if (!googleHolidayApiKey) {
      return { status: 'disabled', message: 'Google祝日同期は API キー未設定のため停止中です。' }
    }

    const cache = readGoogleHolidaySyncCache()
    return cache?.lastSyncedAt
      ? { status: 'idle', message: 'Google公開祝日の差分を起動時に反映します。' }
      : { status: 'idle', message: 'Google公開祝日の初回同期を待機しています。' }
  })

  const runGoogleHolidaySync = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!isGoogleHolidaySyncEnabled) {
      setGoogleHolidaySyncState({ status: 'disabled', message: 'Google祝日同期は自動テスト実行中のため停止しています。' })
      return
    }
    if (!googleHolidayApiKey) {
      setGoogleHolidaySyncState({ status: 'disabled', message: 'Google祝日同期は API キー未設定のため停止中です。' })
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
      message: options?.background ? 'Google公開祝日をバックグラウンド同期中です。' : 'Google公開祝日を同期中です。',
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
      setGoogleHolidaySyncState({ status: 'success', message: `Google公開祝日を ${syncedHolidayDates.length} 件同期しました。` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google祝日同期に失敗しました。'
      setGoogleHolidaySyncState({ status: 'error', message })
    } finally {
      holidaySyncInFlightRef.current = false
    }
  }, [classroomSettings.googleHolidayCalendarLastSyncedAt, googleHolidayApiKey, googleHolidayCalendarId, isGoogleHolidaySyncEnabled])

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
  }, [classroomSettings, regularLessons, scheduleQrConfig, specialSessions, studentScheduleRange, students, teachers])

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
  }, [classroomSettings, regularLessons, scheduleQrConfig, specialSessions, students, teacherScheduleRange, teachers])

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
      }),
      boardWeeks: runtimeWindow.__lessonScheduleBoardWeeks ?? [],
      targetWindow: popupWindow,
    })
  }, [specialSessions, students, teachers])

  useEffect(() => {
    const handleScheduleRangeMessage = (event: MessageEvent) => {
      const message = event.data
      if (!message) return

      if (message.type === 'schedule-refresh-request') {
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

  if (screen === 'basic-data') {
    return (
      <BasicDataScreen
        classroomSettings={classroomSettings}
        googleHolidaySyncState={googleHolidaySyncState}
        isGoogleHolidayApiConfigured={Boolean(googleHolidayApiKey) && isGoogleHolidaySyncEnabled}
        teachers={teachers}
        students={students}
        regularLessons={regularLessons}
        onUpdateTeachers={setTeachers}
        onUpdateStudents={setStudents}
        onUpdateRegularLessons={setRegularLessons}
        onUpdateClassroomSettings={setClassroomSettings}
        onSyncGoogleHolidays={() => void runGoogleHolidaySync({ force: true })}
        onBackToBoard={() => setScreen('board')}
        onOpenSpecialData={() => setScreen('special-data')}
        onOpenBackupRestore={() => setScreen('backup-restore')}
      />
    )
  }

  if (screen === 'special-data') {
    return (
      <SpecialSessionScreen
        sessions={specialSessions}
        onUpdateSessions={setSpecialSessions}
        onBackToBoard={() => setScreen('board')}
        onOpenBasicData={() => setScreen('basic-data')}
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
        persistenceMessage="バックアップ/復元は未接続です。"
        lastSavedAt=""
        onExportBackup={() => {}}
        onImportBackup={() => {}}
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
      onUpdateSpecialSessions={setSpecialSessions}
      onUpdateClassroomSettings={setClassroomSettings}
      onOpenBasicData={() => setScreen('basic-data')}
      onOpenSpecialData={() => setScreen('special-data')}
      onOpenBackupRestore={() => setScreen('backup-restore')}
    />
  )
}

export default App
