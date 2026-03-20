export type RegularLessonRow = {
  id: string
  schoolYear: number
  teacherId: string
  student1Id: string
  subject1: string
  startDate: string
  endDate: string
  student2Id: string
  subject2: string
  student2StartDate: string
  student2EndDate: string
  nextStudent1Id: string
  nextSubject1: string
  nextStudent2Id: string
  nextSubject2: string
  dayOfWeek: number
  slotNumber: number
}

function getSchoolYearStart(year: number) {
  const date = new Date(year, 3, 1)
  date.setHours(0, 0, 0, 0)
  return date
}

export function resolveOperationalSchoolYear(today = new Date()) {
  const transition = getSchoolYearStart(today.getFullYear())
  return today >= transition ? today.getFullYear() : today.getFullYear() - 1
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function capRegularLessonDatesPerMonth(dateKeys: string[], monthlyLimit = 4) {
  const monthCounts = new Map<string, number>()

  return Array.from(new Set(dateKeys))
    .sort((left, right) => left.localeCompare(right))
    .filter((dateKey) => {
      const monthKey = dateKey.slice(0, 7)
      const currentCount = monthCounts.get(monthKey) ?? 0
      if (currentCount >= monthlyLimit) return false
      monthCounts.set(monthKey, currentCount + 1)
      return true
    })
}

function normalizeManagedDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export function hasManagedRegularLessonPeriod(row: Pick<RegularLessonRow, 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>) {
  return Boolean(
    normalizeManagedDate(row.startDate)
    || normalizeManagedDate(row.endDate)
    || normalizeManagedDate(row.student2StartDate)
    || normalizeManagedDate(row.student2EndDate),
  )
}

function resolveStoredSharedPeriod(row: Pick<RegularLessonRow, 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>) {
  return {
    startDate: normalizeManagedDate(row.student2StartDate) || normalizeManagedDate(row.startDate),
    endDate: normalizeManagedDate(row.student2EndDate) || normalizeManagedDate(row.endDate),
  }
}

export function resolveSchoolYearDateRange(schoolYear: number) {
  const startDate = getSchoolYearStart(schoolYear)
  const nextStartDate = getSchoolYearStart(schoolYear + 1)
  const endDate = new Date(nextStartDate)
  endDate.setDate(endDate.getDate() - 1)
  endDate.setHours(0, 0, 0, 0)

  return {
    startDate: toDateKey(startDate),
    endDate: toDateKey(endDate),
  }
}

export function resolveRegularLessonParticipantPeriod(
  row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>,
  _participantIndex: 1 | 2,
) {
  const schoolYearRange = resolveSchoolYearDateRange(row.schoolYear)
  const sharedPeriod = resolveStoredSharedPeriod(row)
  return {
    startDate: sharedPeriod.startDate || schoolYearRange.startDate,
    endDate: sharedPeriod.endDate || schoolYearRange.endDate,
  }
}

export function normalizeRegularLessonSharedPeriod<T extends Pick<RegularLessonRow, 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>>(row: T): T {
  const sharedPeriod = resolveStoredSharedPeriod(row)
  return {
    ...row,
    startDate: sharedPeriod.startDate,
    endDate: sharedPeriod.endDate,
    student2StartDate: sharedPeriod.startDate,
    student2EndDate: sharedPeriod.endDate,
  }
}

export function doManagedDateRangesOverlap(
  left: { startDate: string; endDate: string },
  right: { startDate: string; endDate: string },
) {
  return left.startDate <= right.endDate && right.startDate <= left.endDate
}

export function doRegularLessonParticipantPeriodsOverlap(
  left: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>,
  leftParticipantIndex: 1 | 2,
  right: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>,
  rightParticipantIndex: 1 | 2,
) {
  return doManagedDateRangesOverlap(
    resolveRegularLessonParticipantPeriod(left, leftParticipantIndex),
    resolveRegularLessonParticipantPeriod(right, rightParticipantIndex),
  )
}

export function resolveRegularLessonStudent1Period(row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>) {
  return resolveRegularLessonParticipantPeriod(row, 1)
}

export function resolveRegularLessonStudent2Period(row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>) {
  return resolveRegularLessonParticipantPeriod(row, 2)
}

export function isRegularLessonParticipantActiveOnDate(
  row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>,
  participantIndex: 1 | 2,
  dateKey: string,
) {
  const period = resolveRegularLessonParticipantPeriod(row, participantIndex)
  return dateKey >= period.startDate && dateKey <= period.endDate
}

export function isRegularLessonStudent1ActiveOnDate(row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>, dateKey: string) {
  return isRegularLessonParticipantActiveOnDate(row, 1, dateKey)
}

export function isRegularLessonStudent2ActiveOnDate(row: Pick<RegularLessonRow, 'schoolYear' | 'startDate' | 'endDate' | 'student2StartDate' | 'student2EndDate'>, dateKey: string) {
  return isRegularLessonParticipantActiveOnDate(row, 2, dateKey)
}

export function createInitialRegularLessons(today = new Date()): RegularLessonRow[] {
  const currentSchoolYear = resolveOperationalSchoolYear(today)

  return [
    { id: 'r001', schoolYear: currentSchoolYear, teacherId: 't001', student1Id: 's001', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1 },
    { id: 'r002', schoolYear: currentSchoolYear, teacherId: 't002', student1Id: 's002', subject1: '英', startDate: '', endDate: '', student2Id: 's003', subject2: '英', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 2 },
    { id: 'r003', schoolYear: currentSchoolYear - 1, teacherId: 't001', student1Id: 's004', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 3 },
    { id: 'r004', schoolYear: currentSchoolYear, teacherId: 't003', student1Id: 's005', subject1: '理', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 2 },
    { id: 'r005', schoolYear: currentSchoolYear, teacherId: 't004', student1Id: 's006', subject1: '国', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 3 },
    { id: 'r006', schoolYear: currentSchoolYear, teacherId: 't005', student1Id: 's007', subject1: '社', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 5 },
    { id: 'r007', schoolYear: currentSchoolYear, teacherId: 't006', student1Id: 's008', subject1: '理', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 3 },
    { id: 'r008', schoolYear: currentSchoolYear, teacherId: 't007', student1Id: 's009', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 4 },
    { id: 'r009', schoolYear: currentSchoolYear, teacherId: 't008', student1Id: 's010', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 2 },
    { id: 'r010', schoolYear: currentSchoolYear, teacherId: 't003', student1Id: 's011', subject1: '理', startDate: '', endDate: '', student2Id: 's012', subject2: '数', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 3 },
    { id: 'r011', schoolYear: currentSchoolYear, teacherId: 't004', student1Id: 's013', subject1: '国', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 5 },
    { id: 'r012', schoolYear: currentSchoolYear, teacherId: 't005', student1Id: 's014', subject1: '社', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 2 },
    { id: 'r013', schoolYear: currentSchoolYear, teacherId: 't006', student1Id: 's015', subject1: '理', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 3 },
    { id: 'r014', schoolYear: currentSchoolYear, teacherId: 't007', student1Id: 's016', subject1: '英', startDate: '', endDate: '', student2Id: 's017', subject2: '社', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 4 },
    { id: 'r015', schoolYear: currentSchoolYear, teacherId: 't008', student1Id: 's018', subject1: '算', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 5 },
    { id: 'r016', schoolYear: currentSchoolYear, teacherId: 't001', student1Id: 's019', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 1 },
    { id: 'r017', schoolYear: currentSchoolYear, teacherId: 't002', student1Id: 's020', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 2 },
    { id: 'r018', schoolYear: currentSchoolYear, teacherId: 't003', student1Id: 's021', subject1: '理', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 3 },
    { id: 'r019', schoolYear: currentSchoolYear, teacherId: 't004', student1Id: 's022', subject1: '英', startDate: '2025-09-01', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 2 },
    { id: 'r020', schoolYear: currentSchoolYear, teacherId: 't005', student1Id: 's023', subject1: '国', startDate: '2026-02-01', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 },
    { id: 'r021', schoolYear: currentSchoolYear, teacherId: 't006', student1Id: 's024', subject1: '理', startDate: '', endDate: '2026-03-31', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 4 },
    { id: 'r022', schoolYear: currentSchoolYear, teacherId: 't007', student1Id: 's025', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 2 },
    { id: 'r023', schoolYear: currentSchoolYear, teacherId: 't008', student1Id: 's026', subject1: '社', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 2 },
    { id: 'r024', schoolYear: currentSchoolYear, teacherId: 't009', student1Id: 's027', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5 },
    { id: 'r025', schoolYear: currentSchoolYear, teacherId: 't010', student1Id: 's028', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 5 },
    { id: 'r026', schoolYear: currentSchoolYear, teacherId: 't005', student1Id: 's029', subject1: '国', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 5 },
    { id: 'r027', schoolYear: currentSchoolYear, teacherId: 't006', student1Id: 's030', subject1: '理', startDate: '', endDate: '2026-03-31', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 1 },
    { id: 'r028', schoolYear: currentSchoolYear + 1, teacherId: 't001', student1Id: 's001', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1 },
    { id: 'r029', schoolYear: currentSchoolYear + 1, teacherId: 't004', student1Id: 's011', subject1: '国', startDate: '', endDate: '', student2Id: 's021', subject2: '英', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 2, slotNumber: 3 },
    { id: 'r030', schoolYear: currentSchoolYear + 1, teacherId: 't006', student1Id: 's014', subject1: '理', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 4, slotNumber: 4 },
    { id: 'r031', schoolYear: currentSchoolYear + 1, teacherId: 't007', student1Id: 's020', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 5, slotNumber: 2 },
    { id: 'r032', schoolYear: currentSchoolYear + 1, teacherId: 't008', student1Id: 's025', subject1: '数', startDate: '2026-04-01', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 6, slotNumber: 1 },
  ]
}