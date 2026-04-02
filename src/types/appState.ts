import type { ManagerRow, StudentRow, TeacherRow } from '../components/basic-data/basicDataModel'
import type { GroupLessonRow } from '../components/basic-data/BasicDataScreen'
import type { RegularLessonRow } from '../components/basic-data/regularLessonModel'
import type { SlotCell } from '../components/schedule-board/types'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { AutoAssignRuleRow } from '../components/auto-assign-rules/autoAssignRuleModel'
import type { RegularLessonTemplate } from '../components/regular-template/regularLessonTemplate'
import type { PairConstraintRow } from './pairConstraint'

export type ClassroomScreen = 'board' | 'basic-data' | 'special-data' | 'auto-assign-rules' | 'backup-restore'

export type AppScreen = ClassroomScreen | 'developer'

export type ClassroomSettings = {
  closedWeekdays: number[]
  holidayDates: string[]
  forceOpenDates: string[]
  deskCount: number
  regularLessonTemplate?: RegularLessonTemplate | null
  initialSetupCompletedAt?: string
  initialSetupMakeupStocks?: InitialSetupMakeupStockRow[]
  initialSetupLectureStocks?: InitialSetupLectureStockRow[]
}

export type InitialSetupMakeupStockRow = {
  id: string
  studentId: string
  subject: string
  count: number
}

export type InitialSetupLectureStockRow = {
  id: string
  studentId: string
  subject: string
  sessionId: string
  count: number
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
export type ManualLectureStockOrigin = {
  displayName: string
  sessionId?: string
}

export type ScheduleCountAdjustmentKind = 'regular' | 'special'

export type ScheduleCountAdjustmentEntry = {
  studentKey: string
  subject: string
  countKind: ScheduleCountAdjustmentKind
  dateKey: string
  delta: number
}

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
  suppressedRegularLessonOccurrences: string[]
  scheduleCountAdjustments: ScheduleCountAdjustmentEntry[]
  manualMakeupAdjustments: MakeupOriginMap
  suppressedMakeupOrigins: MakeupOriginMap
  fallbackMakeupStudents: Record<string, FallbackMakeupStudent>
  manualLectureStockCounts: LectureStockCountMap
  manualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]>
  fallbackLectureStockStudents: Record<string, { displayName: string; subject?: string }>
  isLectureStockOpen: boolean
  isMakeupStockOpen: boolean
  studentScheduleRange: ScheduleRangePreference | null
  teacherScheduleRange: ScheduleRangePreference | null
}

export const APP_SNAPSHOT_SCHEMA_VERSION = 1

export type AppSnapshotPayload = {
  screen: ClassroomScreen
  classroomSettings: ClassroomSettings
  managers: ManagerRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  groupLessons: GroupLessonRow[]
  specialSessions: SpecialSessionRow[]
  autoAssignRules: AutoAssignRuleRow[]
  pairConstraints: PairConstraintRow[]
  boardState: PersistedBoardState | null
}

export type AppSnapshot = AppSnapshotPayload & {
  schemaVersion: number
  savedAt: string
}

export type WorkspaceUserRole = 'developer' | 'manager'

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  role: WorkspaceUserRole
  assignedClassroomId: string | null
}

export type ClassroomContractStatus = 'active' | 'suspended'

export type WorkspaceClassroom = {
  id: string
  name: string
  contractStatus: ClassroomContractStatus
  contractStartDate: string
  contractEndDate: string
  managerUserId: string
  isTemporarilySuspended?: boolean
  temporarySuspensionReason?: string
  data: AppSnapshotPayload
}

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1

export type WorkspaceSnapshot = {
  schemaVersion: number
  savedAt: string
  developerPassword: string
  developerCloudBackupEnabled: boolean
  developerCloudBackupFolderName: string
  developerCloudSyncedAutoBackupKeys: string[]
  currentUserId: string
  actingClassroomId: string | null
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
}
