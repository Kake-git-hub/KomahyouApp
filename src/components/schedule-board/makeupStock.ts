import type { ClassroomSettings } from '../../types/appState'
import { getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { capRegularLessonDatesPerMonth, hasManagedRegularLessonPeriod, resolveOperationalSchoolYear, resolveRegularLessonParticipantPeriod, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SlotCell, StudentEntry } from './types'

type OriginMap = Record<string, string[]>

export type ManualMakeupOrigin = {
  dateKey: string
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

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatOriginLabel(dateKey: string, slotNumber: number | null) {
  if (!isDateKey(dateKey) || dateKey.startsWith(INITIAL_SETUP_ORIGIN_PREFIX)) {
    return '元コマ未設定'
  }
  const date = parseDateKey(dateKey)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const dayLabel = DAY_LABELS[date.getDay()]
  return slotNumber ? `${month}/${day}(${dayLabel}) ${slotNumber}限` : `${month}/${day}(${dayLabel})`
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

function buildOriginLabels(originDates: string[], key: string, regularLessons: RegularLessonRow[]) {
  return originDates.map((dateKey) => formatOriginLabel(dateKey, resolveOriginSlotNumber(key, dateKey, regularLessons)))
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
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || student.manualAdded || student.lessonType !== 'makeup') continue
          const key = buildMakeupStockKey(resolveStudentKey(student), student.subject)
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
  const latestHolidayKey = classroomSettings.holidayDates.reduce<string | null>((latest, dateKey) => {
    if (!latest || dateKey > latest) return dateKey
    return latest
  }, null)

  for (const row of regularLessons) {
    if (row.schoolYear !== currentSchoolYear) continue
    const applyMonthlyCap = hasManagedRegularLessonPeriod(row)
    const participants = [
      { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
      { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
    ].filter((entry) => entry.studentId && entry.subject)

    for (const participant of participants) {
      const period = resolveRegularLessonParticipantPeriod(row)
      const rangeEndCandidate = latestHolidayKey && latestHolidayKey > todayKey ? latestHolidayKey : todayKey
      const periodEndKey = period.endDate < rangeEndCandidate ? period.endDate : rangeEndCandidate
      if (periodEndKey < period.startDate) continue
      const monthRange = iterateMonthsInRange(period.startDate, periodEndKey)
      const student = studentById.get(participant.studentId)
      if (!student) continue

      const stockKey = buildMakeupStockKey(student.id, participant.subject)

      for (const { year, monthIndex } of monthRange) {
        const scheduledDates = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
          .filter((dateKey) => dateKey >= period.startDate && dateKey <= periodEndKey)
          .filter((dateKey) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey))
        if (scheduledDates.length === 0) continue

        const pastScheduledDates = scheduledDates.filter((dateKey) => dateKey <= todayKey || classroomSettings.holidayDates.includes(dateKey))
        if (pastScheduledDates.length === 0) continue

        const openCandidateDates = pastScheduledDates.filter((dateKey) => !isClosedDate(dateKey, classroomSettings))
        const openScheduledDates = applyMonthlyCap ? capRegularLessonDatesPerMonth(openCandidateDates) : openCandidateDates
        const expectedLessonCount = applyMonthlyCap ? Math.min(4, pastScheduledDates.length) : pastScheduledDates.length
        const shortageCount = Math.max(0, expectedLessonCount - openScheduledDates.length)
        const missedDates = pastScheduledDates.filter((dateKey) => isClosedDate(dateKey, classroomSettings))
        const shortageDates = missedDates.slice(0, shortageCount)
        for (const shortageDate of shortageDates) {
          pushOrigin(shortages, stockKey, shortageDate)
        }
      }
    }
  }

  return shortages
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
  const occurrences = new Map<string, Array<{ rowIndex: number; teacherId: string; participants: Array<{ studentId: string; subject: string }> }>>()

  for (const [rowIndex, row] of regularLessons.entries()) {
    if (row.schoolYear !== currentSchoolYear) continue
    const applyMonthlyCap = hasManagedRegularLessonPeriod(row)
    const months = iterateMonthsInRange(`${row.schoolYear}-04-01`, todayKey)

    for (const { year, monthIndex } of months) {
      const monthDateKeys = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
        .filter((dateKey) => dateKey <= todayKey)
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
          const dateKeys = applyMonthlyCap ? capRegularLessonDatesPerMonth(candidateDateKeys) : candidateDateKeys

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
  for (const [occurrenceKey, rows] of occurrences.entries()) {
    const [dateKey] = occurrenceKey.split('_')
    const usedTeacherIds = new Set<string>()
    const usedStudentIds = new Set<string>()

    rows.sort((left, right) => left.rowIndex - right.rowIndex)
    for (const row of rows) {
      const hasTeacherConflict = Boolean(row.teacherId) && usedTeacherIds.has(row.teacherId)
      const hasStudentConflict = row.participants.some((participant) => usedStudentIds.has(participant.studentId))

      if (hasTeacherConflict || hasStudentConflict) {
        for (const participant of row.participants) {
          pushOrigin(conflicts, buildMakeupStockKey(participant.studentId, participant.subject), dateKey)
        }
        continue
      }

      if (row.teacherId) usedTeacherIds.add(row.teacherId)
      for (const participant of row.participants) {
        usedStudentIds.add(participant.studentId)
      }
    }
  }

  return conflicts
}

function consumeOriginDates(originDates: string[], usedOriginDates: string[], usedCount: number) {
  const remaining = [...originDates]

  for (const usedOriginDate of usedOriginDates) {
    const index = remaining.indexOf(usedOriginDate)
    if (index >= 0) {
      remaining.splice(index, 1)
    } else if (remaining.length > 0) {
      remaining.shift()
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

  if (weekDateKeys.length === 0) return origins

  const startDateKey = weekDateKeys[0]
  const endDateKey = weekDateKeys[weekDateKeys.length - 1]
  const months = iterateMonthsInRange(startDateKey, endDateKey)

  for (const row of regularLessons) {
    const teacher = teacherById.get(row.teacherId)
    const applyMonthlyCap = hasManagedRegularLessonPeriod(row)
    const candidateDateKeys = months
      .flatMap(({ year, monthIndex }) => getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek))
      .filter((dateKey) => dateKey >= startDateKey && dateKey <= endDateKey)
      .filter((dateKey) => {
        const date = parseDateKey(dateKey)
        if (row.schoolYear !== resolveOperationalSchoolYear(date)) return false
        if (isClosedDate(dateKey, classroomSettings)) return false
        return !teacher || resolveTeacherRosterStatus(teacher, dateKey) === '在籍'
      })

    const participants = [
      { studentId: row.student1Id, subject: row.subject1, participantIndex: 1 as const },
      { studentId: row.student2Id, subject: row.subject2, participantIndex: 2 as const },
    ].filter((entry) => entry.studentId && entry.subject)

    const participantDateSets = participants.map((participant) => {
      const student = studentById.get(participant.studentId)
      const candidateParticipantDateKeys = student
        ? candidateDateKeys.filter((dateKey) => (
            isRegularParticipantScheduledOnDate(row, dateKey)
            && isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, dateKey)
          ))
        : []
      const dateKeys = applyMonthlyCap ? capRegularLessonDatesPerMonth(candidateParticipantDateKeys) : candidateParticipantDateKeys

      return {
        ...participant,
        dateKeys: new Set(dateKeys),
      }
    })

    const scheduledDateKeys = Array.from(new Set(participantDateSets.flatMap((participant) => Array.from(participant.dateKeys)))).sort((left, right) => left.localeCompare(right))

    for (const dateKey of scheduledDateKeys) {
      const cell = cellByDateSlot.get(`${dateKey}_${row.slotNumber}`)
      if (!cell) continue
      if (cell.desks.some((desk) => desk.lesson?.id === `managed_${row.id}_${dateKey}`)) continue

      const activeParticipants = participantDateSets.filter((participant) => participant.dateKeys.has(dateKey))
      if (activeParticipants.length === 0) continue

      const participantStudentIds = new Set(activeParticipants.map((participant) => participant.studentId))
      const teacherName = teacher ? getTeacherDisplayName(teacher) : ''
      const hasTeacherConflict = teacherName
        ? cell.desks.some((desk) => (desk.teacher === teacherName || desk.teacher === teacher?.name) && Boolean(desk.lesson))
        : false
      const hasStudentConflict = cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => {
        if (!student) return false
        const studentKey = resolveStudentKey(student).replace(/^manual:/, '').replace(/^name:/, '')
        return participantStudentIds.has(studentKey)
      }) ?? false)
      const hasEmptyDesk = cell.desks.some((desk) => !desk.lesson)

      if (!hasTeacherConflict && !hasStudentConflict && hasEmptyDesk) continue

      for (const participant of activeParticipants) {
        pushOrigin(origins, buildMakeupStockKey(participant.studentId, participant.subject), dateKey)
      }
    }
  }

  return origins
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
  const automaticShortages = computeAutomaticShortageOrigins(regularLessons, students, classroomSettings, today)
  const conflictOrigins = computeScheduleConflictOrigins(regularLessons, students, classroomSettings, today)
  const occupiedSlotOrigins = computeOccupiedSlotOrigins({ regularLessons, students, teachers, classroomSettings, weeks, resolveStudentKey })
  const makeupUsage = collectMakeupUsageByKey(weeks, resolveStudentKey)
  const plannedMakeups = makeupUsage.counts
  const assignedRegularLessons = countAssignedLessonsByKey(weeks, resolveStudentKey, 'regular')
  const totalLessonCounts = countTotalLessonQuotaByKey(regularLessons)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const eligiblePlannedMakeupKeys = Object.keys(plannedMakeups)
  const trackedAssignedRegularKeys = Object.keys(assignedRegularLessons)
  const allKeys = new Set([...Object.keys(automaticShortages), ...Object.keys(conflictOrigins), ...Object.keys(occupiedSlotOrigins), ...Object.keys(manualAdjustments), ...eligiblePlannedMakeupKeys, ...Object.keys(fallbackStudents), ...Object.keys(totalLessonCounts), ...trackedAssignedRegularKeys])

  const entries = Array.from(allKeys).map((key) => {
    const [studentKey, subject = ''] = key.split('__')
    const isManualEntry = studentKey.startsWith('manual:')
    const normalizedStudentKey = studentKey.replace(/^manual:/, '')
    const student = studentById.get(normalizedStudentKey) ?? null
    const fallback = fallbackStudents[key]
    const autoOriginDates = automaticShortages[key] ?? []
    const conflictOriginDates = conflictOrigins[key] ?? []
    const occupiedOriginDates = occupiedSlotOrigins[key] ?? []
    const manualOrigins = manualAdjustments[key] ?? []
    const manualOriginDates = manualOrigins.map((origin) => origin.dateKey)
    const suppressedOriginDates = (suppressedOrigins[key] ?? []).map((origin) => origin.dateKey)
    const manualOriginReasonLabels = manualOrigins.reduce<Record<string, string>>((accumulator, origin) => {
      if (!origin.reasonLabel || accumulator[origin.dateKey]) return accumulator
      accumulator[origin.dateKey] = origin.reasonLabel
      return accumulator
    }, {})
    const allOriginDates = Array.from(new Set([...autoOriginDates, ...conflictOriginDates, ...occupiedOriginDates, ...manualOriginDates]))
      .filter((dateKey) => !suppressedOriginDates.includes(dateKey))
      .sort()
    const usedOriginDates = makeupUsage.usedOriginDates[key] ?? []
    const plannedCount = plannedMakeups[key] ?? 0
    const assignedRegularCount = assignedRegularLessons[key] ?? 0
    const totalLessonCount = totalLessonCounts[key] ?? 0
    const overAssignedRegularLessons = Math.max(0, assignedRegularCount - totalLessonCount)
    const remainingOriginDates = consumeOriginDates(allOriginDates, usedOriginDates, plannedCount)
    const remainingOriginLabels = buildOriginLabels(remainingOriginDates, key, regularLessons)
    const remainingOriginReasonLabels = remainingOriginDates.map((dateKey) => resolveOriginReasonLabel(dateKey, {
      classroomSettings,
      autoOriginDates,
      conflictOriginDates,
      occupiedOriginDates,
      manualOriginDates,
      manualOriginReasonLabels,
    }))
    const manualIndependentPlannedMakeups = isManualEntry ? plannedCount : 0
    const balance = remainingOriginDates.length - overAssignedRegularLessons - manualIndependentPlannedMakeups
    const negativeReasonParts: string[] = []

    if (overAssignedRegularLessons > 0) {
      negativeReasonParts.push(`通常授業を ${overAssignedRegularLessons} 件先取りしています。`) 
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
      displayName: student ? getStudentDisplayName(student) : (fallback?.displayName ?? normalizedStudentKey.replace(/^name:/, '')),
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