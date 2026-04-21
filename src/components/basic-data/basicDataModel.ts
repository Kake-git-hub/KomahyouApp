export type GradeCeiling = '小' | '中' | '高1' | '高2' | '高3'
export type ManagerRow = { id: string; name: string; email: string }
export type TeacherSubjectCapability = { subject: string; maxGrade: GradeCeiling }
export type TeacherAvailableSlot = { dayOfWeek: number; slotNumber: number }

export const teacherAvailabilityDayOptions = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
] as const

export const teacherAvailabilitySlotNumbers = [1, 2, 3, 4, 5] as const

const teacherAvailabilityDayValueByLabel = new Map<string, number>(teacherAvailabilityDayOptions.map((entry) => [entry.label, entry.value]))

export type TeacherRow = {
  id: string
  name: string
  displayName?: string
  email: string
  entryDate: string
  withdrawDate: string
  isHidden: boolean
  subjectCapabilities: TeacherSubjectCapability[]
  availableSlots?: TeacherAvailableSlot[]
  memo: string
}
export type StudentRow = {
  id: string
  name: string
  displayName: string
  email: string
  entryDate: string
  withdrawDate: string
  birthDate: string
  isHidden: boolean
}

export const initialTeachers: TeacherRow[] = [
  { id: 't001', name: '田中講師', email: 'tanaka@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高2' }], availableSlots: [], memo: '数学メイン' },
  { id: 't002', name: '佐藤講師', email: 'sato@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '数', maxGrade: '中' }], availableSlots: [], memo: '英語メイン' },
  { id: 't003', name: '鈴木講師', email: 'suzuki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '理', maxGrade: '高2' }], availableSlots: [], memo: '理数対応' },
  { id: 't004', name: '高橋講師', email: 'takahashi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '国', maxGrade: '高3' }], availableSlots: [], memo: '文系対応' },
  { id: 't005', name: '伊藤講師', email: 'ito-teacher@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '国', maxGrade: '高3' }, { subject: '社', maxGrade: '高3' }], availableSlots: [], memo: '国社中心' },
  { id: 't006', name: '渡辺講師', email: 'watanabe@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '理', maxGrade: '高3' }], availableSlots: [], memo: '理科中心' },
  { id: 't007', name: '中村講師', email: 'nakamura@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '社', maxGrade: '高2' }], availableSlots: [], memo: '英社対応' },
  { id: 't008', name: '小林講師', email: 'kobayashi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '数', maxGrade: '高2' }, { subject: '英', maxGrade: '高1' }], availableSlots: [], memo: '中学生中心' },
  { id: 't009', name: '加藤講師', email: 'kato@example.com', entryDate: '2026-04-01', withdrawDate: '未定', isHidden: false, subjectCapabilities: [{ subject: '英', maxGrade: '高2' }], availableSlots: [], memo: '4月着任予定' },
  { id: 't010', name: '吉田講師', email: 'yoshida@example.com', entryDate: '2024-04-01', withdrawDate: '未定', isHidden: true, subjectCapabilities: [{ subject: '国', maxGrade: '高3' }, { subject: '社', maxGrade: '高3' }], availableSlots: [], memo: '休職中のため非表示' },
]

function resolveTeacherAvailabilityDaySortValue(dayOfWeek: number) {
  return dayOfWeek === 0 ? 7 : dayOfWeek
}

export function normalizeTeacherAvailableSlots(slots: TeacherAvailableSlot[] | undefined) {
  const uniqueSlots = new Map<string, TeacherAvailableSlot>()

  for (const slot of slots ?? []) {
    const dayOfWeek = Number(slot.dayOfWeek)
    const slotNumber = Number(slot.slotNumber)
    if (!Number.isInteger(dayOfWeek) || !Number.isInteger(slotNumber)) continue
    if (!teacherAvailabilityDayOptions.some((entry) => entry.value === dayOfWeek)) continue
    if (!teacherAvailabilitySlotNumbers.includes(slotNumber as (typeof teacherAvailabilitySlotNumbers)[number])) continue
    uniqueSlots.set(`${dayOfWeek}_${slotNumber}`, { dayOfWeek, slotNumber })
  }

  return Array.from(uniqueSlots.values())
    .sort((left, right) => {
      const dayDiff = resolveTeacherAvailabilityDaySortValue(left.dayOfWeek) - resolveTeacherAvailabilityDaySortValue(right.dayOfWeek)
      if (dayDiff !== 0) return dayDiff
      return left.slotNumber - right.slotNumber
    })
}

export function buildTeacherAvailableSlotLabel(slot: TeacherAvailableSlot) {
  const dayLabel = teacherAvailabilityDayOptions.find((entry) => entry.value === slot.dayOfWeek)?.label ?? '?'
  return `${dayLabel}${slot.slotNumber}限`
}

export function serializeTeacherAvailableSlots(slots: TeacherAvailableSlot[] | undefined) {
  return normalizeTeacherAvailableSlots(slots)
    .map((slot) => buildTeacherAvailableSlotLabel(slot))
    .join(', ')
}

export function parseTeacherAvailableSlots(value: unknown) {
  const entries = String(value ?? '')
    .split(/[、,\n\/]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)

  const slots: TeacherAvailableSlot[] = []
  for (const entry of entries) {
    const matched = entry.match(/([日月火水木金土])(?:曜)?\s*([1-5])(?:限)?/u)
    if (!matched) continue
    const dayOfWeek = teacherAvailabilityDayValueByLabel.get(matched[1] ?? '')
    if (dayOfWeek === undefined) continue
    slots.push({ dayOfWeek, slotNumber: Number(matched[2]) })
  }

  return normalizeTeacherAvailableSlots(slots)
}

export const initialStudents: StudentRow[] = [
  { id: 's001', name: '青木 太郎', displayName: '青木太郎', email: 'aoki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-05-14', isHidden: false },
  { id: 's002', name: '伊藤 花', displayName: '伊藤花', email: 'ito-hana@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-10', isHidden: false },
  { id: 's003', name: '上田 陽介', displayName: '上田陽介', email: 'ueda@example.com', entryDate: '2023-04-01', withdrawDate: '未定', birthDate: '2009-07-22', isHidden: false },
  { id: 's004', name: '岡本 美咲', displayName: '岡本美咲', email: 'okamoto@example.com', entryDate: '2022-04-01', withdrawDate: '未定', birthDate: '2008-09-18', isHidden: false },
  { id: 's005', name: '加藤 未来', displayName: '加藤未来', email: 'kato-miku@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-01-08', isHidden: false },
  { id: 's006', name: '木村 陸', displayName: '木村陸', email: 'kimura@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-11-30', isHidden: false },
  { id: 's007', name: '工藤 玲奈', displayName: '工藤玲奈', email: 'kudo@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-02-17', isHidden: false },
  { id: 's008', name: '小泉 蒼', displayName: '小泉蒼', email: 'koizumi@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-08-04', isHidden: false },
  { id: 's009', name: '斎藤 由奈', displayName: '斎藤由奈', email: 'saito@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-12-21', isHidden: false },
  { id: 's010', name: '坂本 翔', displayName: '坂本翔', email: 'sakamoto@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-03-09', isHidden: false },
  { id: 's011', name: '清水 結衣', displayName: '清水結衣', email: 'shimizu@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-10-01', isHidden: false },
  { id: 's012', name: '菅原 大智', displayName: '菅原大智', email: 'sugawara@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-01-25', isHidden: false },
  { id: 's013', name: '高田 奈々', displayName: '高田奈々', email: 'takada@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-06-12', isHidden: false },
  { id: 's014', name: '竹内 悠真', displayName: '竹内悠真', email: 'takeuchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-02-27', isHidden: false },
  { id: 's015', name: '谷口 晴', displayName: '谷口晴', email: 'taniguchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-07-19', isHidden: false },
  { id: 's016', name: '辻本 葵', displayName: '辻本葵', email: 'tsujimoto@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-09-05', isHidden: false },
  { id: 's017', name: '戸田 颯', displayName: '戸田颯', email: 'toda@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-05-26', isHidden: false },
  { id: 's018', name: '中島 心春', displayName: '中島心春', email: 'nakajima@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-04-14', isHidden: false },
  { id: 's019', name: '西村 光', displayName: '西村光', email: 'nishimura@example.com', entryDate: '2023-04-01', withdrawDate: '未定', birthDate: '2009-12-03', isHidden: false },
  { id: 's020', name: '野口 ひなた', displayName: '野口ひなた', email: 'noguchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-08-29', isHidden: false },
  { id: 's021', name: '長谷川 玲', displayName: '長谷川玲', email: 'hasegawa@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-06-01', isHidden: false },
  { id: 's022', name: '林 大和', displayName: '林大和', email: 'hayashi@example.com', entryDate: '2024-09-01', withdrawDate: '未定', birthDate: '2012-07-07', isHidden: false },
  { id: 's023', name: '平野 美月', displayName: '平野美月', email: 'hirano@example.com', entryDate: '2026-02-01', withdrawDate: '未定', birthDate: '2011-04-23', isHidden: false },
  { id: 's024', name: '福田 翔太', displayName: '福田翔太', email: 'fukuda@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-11-11', isHidden: false },
  { id: 's025', name: '藤井 彩音', displayName: '藤井彩音', email: 'fujii@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-03-15', isHidden: false },
  { id: 's026', name: '堀 直人', displayName: '堀直人', email: 'hori@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20', isHidden: false },
  { id: 's027', name: '松田 凛', displayName: '松田凛', email: 'matsuda@example.com', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2013-09-09', isHidden: false },
  { id: 's028', name: '三浦 蓮', displayName: '三浦蓮', email: 'miura@example.com', entryDate: '2024-04-01', withdrawDate: '2026-02-28', birthDate: '2010-01-13', isHidden: false },
  { id: 's029', name: '宮崎 咲', displayName: '宮崎咲', email: 'miyazaki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-12-24', isHidden: true },
  { id: 's030', name: '森本 陽', displayName: '森本陽', email: 'morimoto@example.com', entryDate: '2024-04-01', withdrawDate: '2026-03-31', birthDate: '2012-10-30', isHidden: false },
]

function normalizeDateText(value: string) {
  const text = value.trim()
  if (!text || text === '未定') return ''
  const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (directMatch) return text
  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (!slashMatch) return ''
  const [, year, month, day] = slashMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function formatManagedDateValue(value: string) {
  return value.trim() || '未定'
}

export function deriveManagedDisplayName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.split(/[\s\u3000]+/u)[0] ?? trimmed
}

export function getStudentDisplayName(student: StudentRow) {
  return student.displayName.trim() || deriveManagedDisplayName(student.name) || student.name.trim()
}

function resolveSchoolGradeLabelFromBirthDate(birthDate: string, today = new Date()) {
  const normalized = normalizeDateText(birthDate)
  if (!normalized) return '-'

  const [yearText, monthText, dayText] = normalized.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return '-'

  let age = today.getFullYear() - birthYear
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age -= 1
  }

  if (age < 6) return '未就学'
  if (age <= 11) return `小${age - 5}`
  if (age <= 14) return `中${age - 11}`
  return `高${Math.min(age - 14, 3)}`
}

function resolveStudentGradeSortOrder(gradeLabel: string) {
  if (gradeLabel === '未就学') return 0

  const elementaryMatch = gradeLabel.match(/^小(\d+)$/)
  if (elementaryMatch) return Number(elementaryMatch[1])

  const middleMatch = gradeLabel.match(/^中(\d+)$/)
  if (middleMatch) return 100 + Number(middleMatch[1])

  const highMatch = gradeLabel.match(/^高(\d+)$/)
  if (highMatch) return 200 + Number(highMatch[1])

  if (gradeLabel === '退塾') return 901
  if (gradeLabel === '非表示') return 902
  return 999
}

export function resolveCurrentStudentGradeLabel(student: StudentRow, referenceDate = getReferenceDateKey(new Date())) {
  const scheduledStatus = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, referenceDate)
  if (scheduledStatus !== '在籍') return scheduledStatus

  const [yearText, monthText, dayText] = referenceDate.split('-')
  const referenceDateValue = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  return resolveSchoolGradeLabelFromBirthDate(student.birthDate, referenceDateValue)
}

export function formatStudentSelectionLabel(student: StudentRow, referenceDate = getReferenceDateKey(new Date())) {
  const gradeLabel = resolveCurrentStudentGradeLabel(student, referenceDate)
  const displayName = getStudentDisplayName(student)
  return gradeLabel && gradeLabel !== '-' ? `${displayName} (${gradeLabel})` : displayName
}

export function compareStudentsByCurrentGradeThenName(left: StudentRow, right: StudentRow, referenceDate = getReferenceDateKey(new Date())) {
  const gradeOrderDiff = resolveStudentGradeSortOrder(resolveCurrentStudentGradeLabel(left, referenceDate)) - resolveStudentGradeSortOrder(resolveCurrentStudentGradeLabel(right, referenceDate))
  if (gradeOrderDiff !== 0) return gradeOrderDiff

  const displayNameCompare = getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja')
  if (displayNameCompare !== 0) return displayNameCompare

  return left.name.localeCompare(right.name, 'ja')
}

export function getTeacherDisplayName(teacher: TeacherRow) {
  return teacher.displayName?.trim() || deriveManagedDisplayName(teacher.name) || teacher.name.trim()
}

export function getReferenceDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isActiveOnDate(_entryDate: string, withdrawDate: string, isHidden: boolean, referenceDate: string) {
  if (isHidden) return false
  const normalizedWithdrawDate = normalizeDateText(withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return false
  return true
}

export function resolveTeacherRosterStatus(teacher: TeacherRow, referenceDate: string) {
  if (teacher.isHidden) return '非表示'
  const normalizedWithdrawDate = normalizeDateText(teacher.withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return '退塾'
  return '在籍'
}

export function isTeacherVisibleInManagement(teacher: TeacherRow, referenceDate: string) {
  return resolveTeacherRosterStatus(teacher, referenceDate) === '在籍'
}

export function resolveScheduledStatus(_entryDate: string, withdrawDate: string, isHidden: boolean, referenceDate: string) {
  if (isHidden) return '非表示'
  const normalizedWithdrawDate = normalizeDateText(withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return '退塾'
  return '在籍'
}
