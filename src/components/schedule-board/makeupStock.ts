import type { ClassroomSettings } from '../../types/appState'
import { formatStudentSelectionLabel, isActiveOnDate, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { hasManagedRegularLessonPeriod, resolveOperationalSchoolYear, resolveRegularLessonParticipantPeriod, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SlotCell, StudentEntry } from './types'

type OriginMap = Record<string, string[]>
type OriginSlotMap = Record<string, Record<string, number>>

export type ManualMakeupOrigin = {
  dateKey: string
  slotNumber?: number
  reasonLabel?: string
}

export type MakeupStockEntry = {
  key: string
  studentId: string | null
  studentName: string
  displayName: string
  subject: string
  balance: number
  autoShortage: number
  manualAdjustments: number
  plannedMakeups: number
  totalLessonCount: number
  assignedRegularLessons: number
  assignedMakeupLessons: number
  overAssignedRegularLessons: number
  remainingOriginDates: string[]
  remainingOriginLabels: string[]
  remainingOriginReasonLabels: string[]
  nextOriginDate: string | null
  nextOriginLabel: string | null
  nextOriginReasonLabel: string | null
  negativeReason: string | null
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const
const INITIAL_SETUP_ORIGIN_PREFIX = '__initial_setup__'

function splitMakeupStockKey(key: string) {
  const separatorIndex = key.indexOf('__')
  if (separatorIndex < 0) return [key, ''] as const
  return [key.slice(0, separatorIndex), key.slice(separatorIndex + 2)] as const
}

function normalizeManagedMakeupStockKeyByIdSet(key: string, managedStudentIds: Set<string>) {
  const [studentKey, subject] = splitMakeupStockKey(key)
  if (!studentKey.startsWith('manual:')) return key

  const rawStudentKey = studentKey.replace(/^manual:/, '')
  if (rawStudentKey.startsWith('name:')) return key
  if (!managedStudentIds.has(rawStudentKey)) return key

  return buildMakeupStockKey(rawStudentKey, subject)
}

function normalizeNumberMapKeys(source: Record<string, number>, managedStudentIds: Set<string>) {
  return Object.entries(source).reduce<Record<string, number>>((accumulator, [key, value]) => {
    const normalizedKey = normalizeManagedMakeupStockKeyByIdSet(key, managedStudentIds)
    accumulator[normalizedKey] = (accumulator[normalizedKey] ?? 0) + value
    return accumulator
  }, {})
}

function normalizeStringArrayMapKeys(source: Record<string, string[]>, managedStudentIds: Set<string>) {
  return Object.entries(source).reduce<Record<string, string[]>>((accumulator, [key, values]) => {
    const normalizedKey = normalizeManagedMakeupStockKeyByIdSet(key, managedStudentIds)
    const mergedValues = [...(accumulator[normalizedKey] ?? []), ...values]
    accumulator[normalizedKey] = Array.from(new Set(mergedValues)).sort((left, right) => left.localeCompare(right))
    return accumulator
  }, {})
}

function normalizeMakeupOriginMapKeysByIdSet(source: Record<string, ManualMakeupOrigin[]>, managedStudentIds: Set<string>) {
  return Object.entries(source).reduce<Record<string, ManualMakeupOrigin[]>>((accumulator, [key, origins]) => {
    const normalizedKey = normalizeManagedMakeupStockKeyByIdSet(key, managedStudentIds)
    const mergedOrigins = [...(accumulator[normalizedKey] ?? []), ...origins.map((origin) => ({ ...origin }))]
    accumulator[normalizedKey] = Array.from(new Map(mergedOrigins.map((origin) => [
      `${origin.dateKey}__${origin.slotNumber ?? ''}__${origin.reasonLabel ?? ''}`,
      origin,
    ])).values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    return accumulator
  }, {})
}

export function normalizeManagedMakeupStockKey(key: string, students: StudentRow[]) {
  return normalizeManagedMakeupStockKeyByIdSet(key, new Set(students.map((student) => student.id)))
}

export function normalizeMakeupOriginMapKeys(source: Record<string, ManualMakeupOrigin[]>, students: StudentRow[]) {
  return normalizeMakeupOriginMapKeysByIdSet(source, new Set(students.map((student) => student.id)))
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function parseCreatedDateKeyFromGeneratedId(id: string) {
  const matched = id.match(/^[a-z0-9]+_([0-9a-z]+)(?:_[0-9a-z]+)?$/i)
  if (!matched) return null

  const timestamp = parseInt(matched[1], 36)
  if (!Number.isFinite(timestamp)) return null

  return toDateKey(new Date(timestamp))
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatOriginLabel(dateKey: string, slotNumber: number | null) {
  if (!isDateKey(dateKey) || dateKey.startsWith(INITIAL_SETUP_ORIGIN_PREFIX)) {
    return '元コマ未設定'
  }
  const date = parseDateKey(dateKey)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const dayLabel = DAY_LABELS[date.getDay()]
  return slotNumber ? `${year}/${month}/${day}(${dayLabel}) ${slotNumber}限` : `${year}/${month}/${day}(${dayLabel})`
}

function resolveOriginSlotNumber(key: string, dateKey: string, regularLessons: RegularLessonRow[]) {
  if (!isDateKey(dateKey)) return null
  const [studentKey, subject = ''] = key.split('__')
  const normalizedStudentKey = studentKey.replace(/^manual:/, '').replace(/^name:/, '')

  for (const row of regularLessons) {
    if (row.student1Id === normalizedStudentKey && row.subject1 === subject && isRegularParticipantScheduledOnDate(row, dateKey)) {
      return row.slotNumber
    }
    if (row.student2Id === normalizedStudentKey && row.subject2 === subject && isRegularParticipantScheduledOnDate(row, dateKey)) {
      return row.slotNumber
    }
  }

  return null
}

function buildOriginLabels(originDates: string[], key: string, regularLessons: RegularLessonRow[], storedSlotNumbers?: Record<string, number>) {
  return originDates.map((dateKey) => {
    const slotNumber = storedSlotNumbers?.[dateKey] ?? resolveOriginSlotNumber(key, dateKey, regularLessons) ?? null
    return formatOriginLabel(dateKey, slotNumber)
  })
}

function resolveOriginReasonLabel(dateKey: string, params: {
  classroomSettings: ClassroomSettings
  autoOriginDates: string[]
  conflictOriginDates: string[]
  occupiedOriginDates: string[]
  manualOriginDates: string[]
  manualOriginReasonLabels: Record<string, string>
}) {
  const { classroomSettings, autoOriginDates, conflictOriginDates, occupiedOriginDates, manualOriginDates, manualOriginReasonLabels } = params

  if (!isDateKey(dateKey)) {
    if (manualOriginDates.includes(dateKey)) return manualOriginReasonLabels[dateKey] ?? '手動調整'
    return '振替発生'
  }

  if (classroomSettings.holidayDates.includes(dateKey) && !classroomSettings.forceOpenDates.includes(dateKey)) {
    return '休日振替'
  }
  if (classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay()) && !classroomSettings.forceOpenDates.includes(dateKey)) {
    return '定休日振替'
  }
  if (conflictOriginDates.includes(dateKey)) {
    return '同時間帯の重複'
  }
  if (occupiedOriginDates.includes(dateKey)) {
    return '空きコマ不足'
  }
  if (manualOriginDates.includes(dateKey)) {
    return manualOriginReasonLabels[dateKey] ?? '手動調整'
  }
  if (autoOriginDates.includes(dateKey)) {
    return '休校日'
  }
  return '振替発生'
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

function endOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0)
}

function countMonthlyLessonQuota(row: RegularLessonRow, year: number, monthIndex: number) {
  const period = resolveRegularLessonParticipantPeriod(row)
  const monthStartKey = toDateKey(new Date(year, monthIndex, 1))
  const monthEndKey = toDateKey(endOfMonth(year, monthIndex))
  const activeStartKey = period.startDate > monthStartKey ? period.startDate : monthStartKey
  const activeEndKey = period.endDate < monthEndKey ? period.endDate : monthEndKey

  if (activeEndKey < activeStartKey) return 0
  if (activeStartKey === monthStartKey && activeEndKey === monthEndKey) return 4

  return Math.min(4, getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
    .filter((dateKey) => dateKey >= activeStartKey && dateKey <= activeEndKey)
    .length)
}

function resolveAutomaticStockPeriod(row: RegularLessonRow) {
  const period = resolveRegularLessonParticipantPeriod(row)
  if (hasManagedRegularLessonPeriod(row)) return period

  const createdDateKey = parseCreatedDateKeyFromGeneratedId(row.id)
  if (!createdDateKey || createdDateKey <= period.startDate) return period

  return {
    startDate: createdDateKey,
    endDate: period.endDate,
  }
}

function countTotalLessonQuota(row: RegularLessonRow) {
  const period = resolveRegularLessonParticipantPeriod(row)
  return iterateMonthsInRange(period.startDate, period.endDate)
    .reduce((total, { year, monthIndex }) => total + countMonthlyLessonQuota(row, year, monthIndex), 0)
}

function countAssignedLessonsByKey(
  weeks: SlotCell[][],
  resolveStudentKey: (student: StudentEntry) => string,
  lessonType: 'regular' | 'makeup',
) {
  const counts: Record<string, number> = {}

  for (const week of weeks) {
    for (const cell of week) {
      if (!cell.isOpenDay) continue
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || student.manualAdded || student.lessonType !== lessonType) continue
          const key = buildMakeupStockKey(resolveStudentKey(student), student.subject)
          counts[key] = (counts[key] ?? 0) + 1
        }
      }
    }
  }

  return counts
}

function pushOrigin(originMap: OriginMap, key: string, dateKey: string) {
  const nextDates = originMap[key] ?? []
  originMap[key] = [...nextDates, dateKey].sort()
}

function pushOriginSlot(slotMap: OriginSlotMap, key: string, dateKey: string, slotNumber: number) {
  if (!slotMap[key]) slotMap[key] = {}
  if (!slotMap[key][dateKey]) slotMap[key][dateKey] = slotNumber
}

function countTotalLessonQuotaByKey(regularLessons: RegularLessonRow[]) {
  const totals: Record<string, number> = {}

  for (const row of regularLessons) {
    const participants = [
      { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
      { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
    ].filter((entry) => entry.studentId && entry.subject)

    for (const participant of participants) {
      const key = buildMakeupStockKey(participant.studentId, participant.subject)
      totals[key] = (totals[key] ?? 0) + countTotalLessonQuota(row)
    }
  }

  return totals
}

function isClosedDate(dateKey: string, classroomSettings: ClassroomSettings) {
  if (classroomSettings.forceOpenDates.includes(dateKey)) return false
  if (classroomSettings.holidayDates.includes(dateKey)) return true
  return classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay())
}

export function buildMakeupStockKey(studentKey: string, subject: string) {
  return `${studentKey}__${subject}`
}

export function countPlannedMakeupsByKey(weeks: SlotCell[][], resolveStudentKey: (student: StudentEntry) => string) {
  const counts: Record<string, number> = {}

  for (const week of weeks) {
    for (const cell of week) {
      if (!cell.isOpenDay) continue
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || student.manualAdded || student.lessonType !== 'makeup') continue
          const key = buildMakeupStockKey(resolveStudentKey(student), student.subject)
          counts[key] = (counts[key] ?? 0) + 1
        }
        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry || statusEntry.manualAdded || statusEntry.lessonType !== 'makeup') continue
          if (statusEntry.status === 'absent') continue
          const studentLike = { ...statusEntry, id: statusEntry.studentId } as unknown as StudentEntry
          const key = buildMakeupStockKey(resolveStudentKey(studentLike), statusEntry.subject)
          counts[key] = (counts[key] ?? 0) + 1
        }
      }
    }
  }

  return counts
}

function collectMakeupUsageByKey(weeks: SlotCell[][], resolveStudentKey: (student: StudentEntry) => string) {
  const counts: Record<string, number> = {}
  const usedOriginDates: OriginMap = {}

  for (const week of weeks) {
    for (const cell of week) {
      if (!cell.isOpenDay) continue
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || student.manualAdded) continue
          const key = buildMakeupStockKey(resolveStudentKey(student), student.subject)
          if (student.lessonType === 'makeup') {
            counts[key] = (counts[key] ?? 0) + 1
          }
          if (student.makeupSourceDate) {
            pushOrigin(usedOriginDates, key, student.makeupSourceDate)
          }
        }
        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry || statusEntry.manualAdded || statusEntry.lessonType !== 'makeup') continue
          if (statusEntry.status === 'absent') continue
          const studentLike = { ...statusEntry, id: statusEntry.studentId } as unknown as StudentEntry
          const key = buildMakeupStockKey(resolveStudentKey(studentLike), statusEntry.subject)
          counts[key] = (counts[key] ?? 0) + 1
          if (statusEntry.makeupSourceDate) {
            pushOrigin(usedOriginDates, key, statusEntry.makeupSourceDate)
          }
        }
      }
    }
  }

  return { counts, usedOriginDates }
}

function isRegularParticipantScheduledOnDate(row: RegularLessonRow, dateKey: string) {
  const period = resolveRegularLessonParticipantPeriod(row)
  return dateKey >= period.startDate && dateKey <= period.endDate
}

export function computeAutomaticShortageOrigins(
  regularLessons: RegularLessonRow[],
  students: StudentRow[],
  classroomSettings: ClassroomSettings,
  today = new Date(),
) {
  const todayKey = toDateKey(today)
  const currentSchoolYear = resolveOperationalSchoolYear(today)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const shortages: OriginMap = {}
  const shortageSlots: OriginSlotMap = {}
  const setupFloorKey = classroomSettings.initialSetupCompletedAt
    ? toDateKey(new Date(classroomSettings.initialSetupCompletedAt))
    : null

  for (const row of regularLessons) {
    if (row.schoolYear !== currentSchoolYear) continue
    const participants = [
      { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
      { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
    ].filter((entry) => entry.studentId && entry.subject)
    const stockPeriod = resolveAutomaticStockPeriod(row)

    for (const participant of participants) {
      const periodEndKey = stockPeriod.endDate < todayKey ? stockPeriod.endDate : todayKey
      if (periodEndKey < stockPeriod.startDate) continue
      const monthRange = iterateMonthsInRange(stockPeriod.startDate, periodEndKey)
      const student = studentById.get(participant.studentId)
      if (!student) continue

      const stockKey = buildMakeupStockKey(student.id, participant.subject)

      for (const { year, monthIndex } of monthRange) {
        const scheduledDates = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
          .filter((dateKey) => dateKey >= stockPeriod.startDate && dateKey <= periodEndKey)
          .filter((dateKey) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey))
        if (scheduledDates.length === 0) continue

        const pastScheduledDates = scheduledDates.filter((dateKey) => dateKey <= todayKey)
        if (pastScheduledDates.length === 0) continue

        const openCandidateDates = pastScheduledDates.filter((dateKey) => !isClosedDate(dateKey, classroomSettings))
        const openScheduledDates = openCandidateDates
        const expectedLessonCount = pastScheduledDates.length
        const shortageCount = Math.max(0, expectedLessonCount - openScheduledDates.length)
        const missedDates = pastScheduledDates.filter((dateKey) => isClosedDate(dateKey, classroomSettings))
        const shortageDates = missedDates.slice(0, shortageCount)
        for (const shortageDate of shortageDates) {
          if (setupFloorKey && shortageDate < setupFloorKey) continue
          pushOrigin(shortages, stockKey, shortageDate)
          pushOriginSlot(shortageSlots, stockKey, shortageDate, row.slotNumber)
        }
      }
    }
  }

  return { origins: shortages, slotNumbers: shortageSlots }
}

function computeScheduleConflictOrigins(
  regularLessons: RegularLessonRow[],
  students: StudentRow[],
  classroomSettings: ClassroomSettings,
  today = new Date(),
) {
  const todayKey = toDateKey(today)
  const currentSchoolYear = resolveOperationalSchoolYear(today)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const setupFloorKey = classroomSettings.initialSetupCompletedAt
    ? toDateKey(new Date(classroomSettings.initialSetupCompletedAt))
    : null
  const occurrences = new Map<string, Array<{ rowIndex: number; teacherId: string; participants: Array<{ studentId: string; subject: string }> }>>()

  for (const [rowIndex, row] of regularLessons.entries()) {
    if (row.schoolYear !== currentSchoolYear) continue
    const stockPeriod = resolveAutomaticStockPeriod(row)
    if (todayKey < stockPeriod.startDate) continue
    const months = iterateMonthsInRange(stockPeriod.startDate, todayKey < stockPeriod.endDate ? todayKey : stockPeriod.endDate)

    for (const { year, monthIndex } of months) {
      const monthDateKeys = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
        .filter((dateKey) => dateKey <= todayKey)
        .filter((dateKey) => dateKey >= stockPeriod.startDate && dateKey <= stockPeriod.endDate)
        .filter((dateKey) => !isClosedDate(dateKey, classroomSettings))

      const participantDateSets = [
        { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
        { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
      ].filter((entry) => entry.studentId && entry.subject)
        .map((entry) => {
          const student = studentById.get(entry.studentId)
          const candidateDateKeys = student
            ? monthDateKeys.filter((dateKey) => (
                isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey)
                && isRegularParticipantScheduledOnDate(row, dateKey)
              ))
            : []
          const dateKeys = candidateDateKeys

          return {
            studentId: entry.studentId,
            subject: entry.subject,
            dateKeys: new Set(dateKeys),
          }
        })

      const scheduledDates = Array.from(new Set(participantDateSets.flatMap((entry) => Array.from(entry.dateKeys)))).sort((left, right) => left.localeCompare(right))

      for (const dateKey of scheduledDates) {
        const participants = participantDateSets
          .filter((entry) => entry.dateKeys.has(dateKey))
          .map((entry) => ({ studentId: entry.studentId, subject: entry.subject }))

        if (participants.length === 0) continue

        const occurrenceKey = `${dateKey}_${row.slotNumber}`
        const nextOccurrences = occurrences.get(occurrenceKey) ?? []
        nextOccurrences.push({ rowIndex, teacherId: row.teacherId, participants })
        occurrences.set(occurrenceKey, nextOccurrences)
      }
    }
  }

  const conflicts: OriginMap = {}
  const conflictSlots: OriginSlotMap = {}
  for (const [occurrenceKey, rows] of occurrences.entries()) {
    const [dateKey, slotNumberStr] = occurrenceKey.split('_')
    const originSlotNumber = parseInt(slotNumberStr, 10)
    const usedTeacherIds = new Set<string>()
    const usedStudentIds = new Set<string>()

    rows.sort((left, right) => left.rowIndex - right.rowIndex)
    for (const row of rows) {
      // 同一講師が同一スロットで複数デスクを担当するのは正当な構成のため、
      // 講師重複ではなく生徒重複のみを衝突として扱う
      const hasStudentConflict = row.participants.some((participant) => usedStudentIds.has(participant.studentId))

      if (hasStudentConflict) {
        for (const participant of row.participants) {
          if (setupFloorKey && dateKey < setupFloorKey) continue
          const conflictKey = buildMakeupStockKey(participant.studentId, participant.subject)
          pushOrigin(conflicts, conflictKey, dateKey)
          pushOriginSlot(conflictSlots, conflictKey, dateKey, originSlotNumber)
        }
        continue
      }

      if (row.teacherId) usedTeacherIds.add(row.teacherId)
      for (const participant of row.participants) {
        usedStudentIds.add(participant.studentId)
      }
    }
  }

  return { origins: conflicts, slotNumbers: conflictSlots }
}

function consumeOriginDates(originDates: string[], usedOriginDates: string[], usedCount: number) {
  const remaining = [...originDates]

  for (const usedOriginDate of usedOriginDates) {
    const index = remaining.indexOf(usedOriginDate)
    if (index >= 0) {
      remaining.splice(index, 1)
    }
  }

  let unassignedUseCount = Math.max(0, usedCount - usedOriginDates.length)
  while (unassignedUseCount > 0 && remaining.length > 0) {
    remaining.shift()
    unassignedUseCount -= 1
  }

  return remaining
}

function computeOccupiedSlotOrigins(params: {
  regularLessons: RegularLessonRow[]
  students: StudentRow[]
  teachers: TeacherRow[]
  classroomSettings: ClassroomSettings
  weeks: SlotCell[][]
  resolveStudentKey: (student: StudentEntry) => string
}) {
  const { regularLessons, students, teachers, classroomSettings, weeks, resolveStudentKey } = params
  const studentById = new Map(students.map((student) => [student.id, student]))
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]))
  const weekDateKeys = Array.from(new Set(weeks.flat().map((cell) => cell.dateKey))).sort((left, right) => left.localeCompare(right))
  const cellByDateSlot = new Map(weeks.flat().map((cell) => [`${cell.dateKey}_${cell.slotNumber}`, cell]))
  const origins: OriginMap = {}
  const occupiedSlots: OriginSlotMap = {}

  if (weekDateKeys.length === 0) return { origins, slotNumbers: occupiedSlots }

  const startDateKey = weekDateKeys[0]
  const endDateKey = weekDateKeys[weekDateKeys.length - 1]
  const months = iterateMonthsInRange(startDateKey, endDateKey)

  for (const row of regularLessons) {
    const teacher = teacherById.get(row.teacherId)
    const stockPeriod = resolveAutomaticStockPeriod(row)
    const participants = [
      { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
      { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
    ].filter((entry) => entry.studentId && entry.subject)

    const participantDateSets = participants.map((participant) => ({
      ...participant,
      dateKeys: new Set<string>(),
    }))

    for (const { year, monthIndex } of months) {
      const monthlyCandidateDateKeys = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
        .filter((dateKey) => dateKey >= stockPeriod.startDate && dateKey <= stockPeriod.endDate)
        .filter((dateKey) => {
          const date = parseDateKey(dateKey)
          if (row.schoolYear !== resolveOperationalSchoolYear(date)) return false
          if (isClosedDate(dateKey, classroomSettings)) return false
          return !teacher || resolveTeacherRosterStatus(teacher, dateKey) === '在籍'
        })

      participantDateSets.forEach((participantDateSet) => {
        const student = studentById.get(participantDateSet.studentId)
        const candidateParticipantDateKeys = student
          ? monthlyCandidateDateKeys.filter((dateKey) => (
              isRegularParticipantScheduledOnDate(row, dateKey)
              && isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey)
            ))
          : []
        const contractedDateKeys = candidateParticipantDateKeys
          .filter((dateKey) => dateKey >= startDateKey && dateKey <= endDateKey)

        contractedDateKeys.forEach((dateKey) => participantDateSet.dateKeys.add(dateKey))
      })
    }

    const scheduledDateKeys = Array.from(new Set(participantDateSets.flatMap((participant) => Array.from(participant.dateKeys)))).sort((left, right) => left.localeCompare(right))

    for (const dateKey of scheduledDateKeys) {
      const cell = cellByDateSlot.get(`${dateKey}_${row.slotNumber}`)
      if (!cell) continue
      if (cell.desks.some((desk) => desk.lesson?.id === `managed_${row.id}_${dateKey}`)) continue

      const activeParticipants = participantDateSets.filter((participant) => participant.dateKeys.has(dateKey))
      if (activeParticipants.length === 0) continue

      const participantStudentIds = new Set(activeParticipants.map((participant) => participant.studentId))

      // テンプレ上書き後、regularLessons は新テンプレの row ID を持つが、
      // templateFreezeBeforeDate 以前の盤面には旧テンプレの managed lesson が残る。
      // 旧 managed lesson に同一生徒が含まれていれば「配置済み」とみなし、
      // 偽の occupied origin を生成しない。
      const hasManagedCoverage = cell.desks.some((desk) => {
        const lesson = desk.lesson
        if (!lesson || !lesson.id.startsWith('managed_')) return false
        return lesson.studentSlots.some((s) => {
          if (!s) return false
          const sid = resolveStudentKey(s).replace(/^manual:/, '').replace(/^name:/, '')
          return participantStudentIds.has(sid)
        })
      })
      if (hasManagedCoverage) continue

      const hasStudentConflict = cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => {
        if (!student) return false
        const studentKey = resolveStudentKey(student).replace(/^manual:/, '').replace(/^name:/, '')
        return participantStudentIds.has(studentKey)
      }) ?? false)
      const hasEmptyDesk = cell.desks.some((desk) => !desk.lesson)

      // 同一講師が複数デスクを担当するのは正当な構成のため、
      // 講師衝突ではなく生徒衝突と空きデスク有無のみで判定する
      if (!hasStudentConflict && hasEmptyDesk) continue

      for (const participant of activeParticipants) {
        const occupiedKey = buildMakeupStockKey(participant.studentId, participant.subject)
        pushOrigin(origins, occupiedKey, dateKey)
        pushOriginSlot(occupiedSlots, occupiedKey, dateKey, row.slotNumber)
      }
    }
  }

  return { origins, slotNumbers: occupiedSlots }
}

export function buildMakeupStockEntries(params: {
  students: StudentRow[]
  teachers: TeacherRow[]
  regularLessons: RegularLessonRow[]
  classroomSettings: ClassroomSettings
  weeks: SlotCell[][]
  manualAdjustments: Record<string, ManualMakeupOrigin[]>
  suppressedOrigins?: Record<string, ManualMakeupOrigin[]>
  fallbackStudents?: Record<string, { studentName: string; displayName: string; subject: string }>
  resolveStudentKey: (student: StudentEntry) => string
  today?: Date
}) {
  const { students, teachers, regularLessons, classroomSettings, weeks, manualAdjustments, suppressedOrigins = {}, fallbackStudents = {}, resolveStudentKey, today = new Date() } = params
  const automaticShortageResult = computeAutomaticShortageOrigins(regularLessons, students, classroomSettings, today)
  const conflictResult = computeScheduleConflictOrigins(regularLessons, students, classroomSettings, today)
  const occupiedResult = computeOccupiedSlotOrigins({ regularLessons, students, teachers, classroomSettings, weeks, resolveStudentKey })
  const automaticShortages = automaticShortageResult.origins
  const conflictOrigins = conflictResult.origins
  const occupiedSlotOrigins = occupiedResult.origins
  const makeupUsage = collectMakeupUsageByKey(weeks, resolveStudentKey)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const managedStudentIds = new Set(students.map((student) => student.id))
  const normalizedManualAdjustments = normalizeMakeupOriginMapKeysByIdSet(manualAdjustments, managedStudentIds)
  const normalizedSuppressedOrigins = normalizeMakeupOriginMapKeysByIdSet(suppressedOrigins, managedStudentIds)
  const normalizedFallbackStudents = Object.entries(fallbackStudents).reduce<Record<string, { studentName: string; displayName: string; subject: string }>>((accumulator, [key, value]) => {
    accumulator[normalizeManagedMakeupStockKeyByIdSet(key, managedStudentIds)] = value
    return accumulator
  }, {})
  const plannedMakeups = normalizeNumberMapKeys(makeupUsage.counts, managedStudentIds)
  const usedOriginDatesByKey = normalizeStringArrayMapKeys(makeupUsage.usedOriginDates, managedStudentIds)
  const assignedRegularLessons = normalizeNumberMapKeys(countAssignedLessonsByKey(weeks, resolveStudentKey, 'regular'), managedStudentIds)
  const totalLessonCounts = countTotalLessonQuotaByKey(regularLessons)
  const eligiblePlannedMakeupKeys = Object.keys(plannedMakeups)
  const trackedAssignedRegularKeys = Object.keys(assignedRegularLessons)
  const allKeys = new Set([...Object.keys(automaticShortages), ...Object.keys(conflictOrigins), ...Object.keys(occupiedSlotOrigins), ...Object.keys(normalizedManualAdjustments), ...eligiblePlannedMakeupKeys, ...Object.keys(normalizedFallbackStudents), ...Object.keys(totalLessonCounts), ...trackedAssignedRegularKeys])

  const entries = Array.from(allKeys).map((key) => {
    const [studentKey, subject = ''] = key.split('__')
    const isManualEntry = studentKey.startsWith('manual:')
    const normalizedStudentKey = studentKey.replace(/^manual:/, '')
    const student = studentById.get(normalizedStudentKey) ?? null
    const fallback = normalizedFallbackStudents[key]
    const autoOriginDates = automaticShortages[key] ?? []
    const conflictOriginDates = conflictOrigins[key] ?? []
    const occupiedOriginDates = occupiedSlotOrigins[key] ?? []
    const manualOrigins = normalizedManualAdjustments[key] ?? []
    const manualOriginDates = manualOrigins.map((origin) => origin.dateKey)
    const suppressedOriginDates = (normalizedSuppressedOrigins[key] ?? []).map((origin) => origin.dateKey)
    const manualOriginReasonLabels = manualOrigins.reduce<Record<string, string>>((accumulator, origin) => {
      if (!origin.reasonLabel || accumulator[origin.dateKey]) return accumulator
      accumulator[origin.dateKey] = origin.reasonLabel
      return accumulator
    }, {})
    const manualSlotNumbers = manualOrigins.reduce<Record<string, number>>((accumulator, origin) => {
      if (!origin.slotNumber || accumulator[origin.dateKey]) return accumulator
      accumulator[origin.dateKey] = origin.slotNumber
      return accumulator
    }, {})
    const allSlotNumbers: Record<string, number> = {
      ...(automaticShortageResult.slotNumbers[key] ?? {}),
      ...(conflictResult.slotNumbers[key] ?? {}),
      ...(occupiedResult.slotNumbers[key] ?? {}),
      ...manualSlotNumbers,
    }
    const allOriginDates = Array.from(new Set([...autoOriginDates, ...conflictOriginDates, ...occupiedOriginDates, ...manualOriginDates]))
      .filter((dateKey) => !suppressedOriginDates.includes(dateKey))
      .sort()
    const usedOriginDates = usedOriginDatesByKey[key] ?? []
    const plannedCount = plannedMakeups[key] ?? 0
    const assignedRegularCount = assignedRegularLessons[key] ?? 0
    const totalLessonCount = totalLessonCounts[key] ?? 0
    const overAssignedRegularLessons = totalLessonCount > 0
      ? Math.max(0, assignedRegularCount + plannedCount - totalLessonCount)
      : 0
    const remainingOriginDates = consumeOriginDates(allOriginDates, usedOriginDates, plannedCount)
    const remainingOriginLabels = buildOriginLabels(remainingOriginDates, key, regularLessons, allSlotNumbers)
    const remainingOriginReasonLabels = remainingOriginDates.map((dateKey) => resolveOriginReasonLabel(dateKey, {
      classroomSettings,
      autoOriginDates,
      conflictOriginDates,
      occupiedOriginDates,
      manualOriginDates,
      manualOriginReasonLabels,
    }))
    const manualIndependentPlannedMakeups = isManualEntry ? Math.max(0, plannedCount - allOriginDates.length) : 0
    const balance = remainingOriginDates.length - overAssignedRegularLessons - manualIndependentPlannedMakeups
    const negativeReasonParts: string[] = []

    if (overAssignedRegularLessons > 0) {
      negativeReasonParts.push(`希望回数を ${overAssignedRegularLessons} 件上回って配置しています。`)
    }
    if (manualIndependentPlannedMakeups > 0) {
      negativeReasonParts.push(`手動追加した振替を ${manualIndependentPlannedMakeups} 件先に使っています。`)
    }
    const negativeReason = negativeReasonParts.length > 0
      ? `残数がマイナスです。${negativeReasonParts.join(' ')}`
      : null

    return {
      key,
      studentId: student?.id ?? null,
      studentName: student?.name ?? fallback?.studentName ?? normalizedStudentKey.replace(/^name:/, ''),
      displayName: student ? formatStudentSelectionLabel(student) : (fallback?.displayName ?? normalizedStudentKey.replace(/^name:/, '')),
      subject: student ? subject : (fallback?.subject ?? subject),
      balance,
      autoShortage: autoOriginDates.length + conflictOriginDates.length + occupiedOriginDates.length,
      manualAdjustments: manualOriginDates.length,
      plannedMakeups: plannedCount,
      totalLessonCount,
      assignedRegularLessons: assignedRegularCount,
      assignedMakeupLessons: plannedCount,
      overAssignedRegularLessons,
      remainingOriginDates,
      remainingOriginLabels,
      remainingOriginReasonLabels,
      nextOriginDate: remainingOriginDates[0] ?? null,
      nextOriginLabel: remainingOriginLabels[0] ?? null,
      nextOriginReasonLabel: remainingOriginReasonLabels[0] ?? null,
      negativeReason,
    } satisfies MakeupStockEntry
  })

  return entries
    .filter((entry) => entry.balance !== 0)
    .sort((left, right) => {
      if (left.balance !== right.balance) return right.balance - left.balance
      const nameCompare = left.displayName.localeCompare(right.displayName, 'ja')
      if (nameCompare !== 0) return nameCompare
      return left.subject.localeCompare(right.subject, 'ja')
    })
}