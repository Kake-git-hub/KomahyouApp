import type { StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { SlotCell } from '../components/schedule-board/types'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'

export type AppScreen = 'board' | 'basic-data' | 'special-data' | 'backup-restore'

export type ClassroomSettings = {
  closedWeekdays: number[]
  holidayDates: string[]
  forceOpenDates: string[]
  deskCount: number
  googleHolidayCalendarSyncedDates?: string[]
  googleHolidayCalendarLastSyncedAt?: string
}

export type ScheduleRangePreference = {
  startDate: string
  endDate: string
  periodValue: string
}

export type MakeupOrigin = {
  dateKey: string
  reasonLabel?: string
}

export type MakeupOriginMap = Record<string, MakeupOrigin[]>
export type LectureStockCountMap = Record<string, number>

export type FallbackMakeupStudent = {
  studentName: string
  displayName: string
  subject: string
}

export type PersistedBoardState = {
  weeks: SlotCell[][]
  weekIndex: number
  selectedCellId: string
  selectedDeskIndex: number
  manualMakeupAdjustments: MakeupOriginMap
  fallbackMakeupStudents: Record<string, FallbackMakeupStudent>
  manualLectureStockCounts: LectureStockCountMap
  fallbackLectureStockStudents: Record<string, { displayName: string; subject?: string }>
  isLectureStockOpen: boolean
  isMakeupStockOpen: boolean
  studentScheduleRange: ScheduleRangePreference | null
  teacherScheduleRange: ScheduleRangePreference | null
}

export const APP_SNAPSHOT_SCHEMA_VERSION = 1

export type AppSnapshotPayload = {
  screen: AppScreen
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  specialSessions: SpecialSessionRow[]
  boardState: PersistedBoardState | null
}

export type AppSnapshot = AppSnapshotPayload & {
  schemaVersion: number
  savedAt: string
}
