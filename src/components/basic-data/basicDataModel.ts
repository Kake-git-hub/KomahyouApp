import { hasGraduatedHighSchool, resolveEnrollmentYearFromBirthDateParts, resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'

export type GradeCeiling = '小' | '中' | '高1' | '高2' | '高3'
export type ManagerRow = { id: string; name: string; email: string }
export type TeacherSubjectCapability = { subject: string; maxGrade: GradeCeiling }

export type TeacherRow = {
  id: string
  name: string
  displayName?: string
  email: string
  entryDate: string
  withdrawDate: string
  subjectCapabilities: TeacherSubjectCapability[]
}
export type StudentRow = {
  id: string
  name: string
  displayName: string
  email: string
  entryDate: string
  withdrawDate: string
  birthDate: string
}

export const initialTeachers: TeacherRow[] = [
  { id: 't001', name: '田中講師', email: 'tanaka@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '英', maxGrade: '高2' }] },
  { id: 't002', name: '佐藤講師', email: 'sato@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '数', maxGrade: '中' }] },
  { id: 't003', name: '鈴木講師', email: 'suzuki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }, { subject: '理', maxGrade: '高2' }] },
  { id: 't004', name: '高橋講師', email: 'takahashi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '国', maxGrade: '高3' }] },
  { id: 't005', name: '伊藤講師', email: 'ito-teacher@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '国', maxGrade: '高3' }, { subject: '社', maxGrade: '高3' }] },
  { id: 't006', name: '渡辺講師', email: 'watanabe@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '理', maxGrade: '高3' }] },
  { id: 't007', name: '中村講師', email: 'nakamura@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '英', maxGrade: '高3' }, { subject: '社', maxGrade: '高2' }] },
  { id: 't008', name: '小林講師', email: 'kobayashi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高2' }, { subject: '英', maxGrade: '高1' }] },
  { id: 't009', name: '加藤講師', email: 'kato@example.com', entryDate: '2026-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '英', maxGrade: '高2' }] },
  { id: 't010', name: '吉田講師', email: 'yoshida@example.com', entryDate: '2024-04-01', withdrawDate: '2025-03-31', subjectCapabilities: [{ subject: '国', maxGrade: '高3' }, { subject: '社', maxGrade: '高3' }] },
]

export const initialStudents: StudentRow[] = [
  { id: 's001', name: '青木 太郎', displayName: '青木太郎', email: 'aoki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-05-14' },
  { id: 's002', name: '伊藤 花', displayName: '伊藤花', email: 'ito-hana@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-06-10' },
  { id: 's003', name: '上田 陽介', displayName: '上田陽介', email: 'ueda@example.com', entryDate: '2023-04-01', withdrawDate: '未定', birthDate: '2009-07-22' },
  { id: 's004', name: '岡本 美咲', displayName: '岡本美咲', email: 'okamoto@example.com', entryDate: '2022-04-01', withdrawDate: '未定', birthDate: '2008-09-18' },
  { id: 's005', name: '加藤 未来', displayName: '加藤未来', email: 'kato-miku@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-01-08' },
  { id: 's006', name: '木村 陸', displayName: '木村陸', email: 'kimura@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-11-30' },
  { id: 's007', name: '工藤 玲奈', displayName: '工藤玲奈', email: 'kudo@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-02-17' },
  { id: 's008', name: '小泉 蒼', displayName: '小泉蒼', email: 'koizumi@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-08-04' },
  { id: 's009', name: '斎藤 由奈', displayName: '斎藤由奈', email: 'saito@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-12-21' },
  { id: 's010', name: '坂本 翔', displayName: '坂本翔', email: 'sakamoto@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-03-09' },
  { id: 's011', name: '清水 結衣', displayName: '清水結衣', email: 'shimizu@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-10-01' },
  { id: 's012', name: '菅原 大智', displayName: '菅原大智', email: 'sugawara@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-01-25' },
  { id: 's013', name: '高田 奈々', displayName: '高田奈々', email: 'takada@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-06-12' },
  { id: 's014', name: '竹内 悠真', displayName: '竹内悠真', email: 'takeuchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-02-27' },
  { id: 's015', name: '谷口 晴', displayName: '谷口晴', email: 'taniguchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-07-19' },
  { id: 's016', name: '辻本 葵', displayName: '辻本葵', email: 'tsujimoto@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-09-05' },
  { id: 's017', name: '戸田 颯', displayName: '戸田颯', email: 'toda@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-05-26' },
  { id: 's018', name: '中島 心春', displayName: '中島心春', email: 'nakajima@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2013-04-14' },
  { id: 's019', name: '西村 光', displayName: '西村光', email: 'nishimura@example.com', entryDate: '2023-04-01', withdrawDate: '未定', birthDate: '2009-12-03' },
  { id: 's020', name: '野口 ひなた', displayName: '野口ひなた', email: 'noguchi@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-08-29' },
  { id: 's021', name: '長谷川 玲', displayName: '長谷川玲', email: 'hasegawa@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-06-01' },
  { id: 's022', name: '林 大和', displayName: '林大和', email: 'hayashi@example.com', entryDate: '2024-09-01', withdrawDate: '未定', birthDate: '2012-07-07' },
  { id: 's023', name: '平野 美月', displayName: '平野美月', email: 'hirano@example.com', entryDate: '2026-02-01', withdrawDate: '未定', birthDate: '2011-04-23' },
  { id: 's024', name: '福田 翔太', displayName: '福田翔太', email: 'fukuda@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2010-11-11' },
  { id: 's025', name: '藤井 彩音', displayName: '藤井彩音', email: 'fujii@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-03-15' },
  { id: 's026', name: '堀 直人', displayName: '堀直人', email: 'hori@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20' },
  { id: 's027', name: '松田 凛', displayName: '松田凛', email: 'matsuda@example.com', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2013-09-09' },
  { id: 's028', name: '三浦 蓮', displayName: '三浦蓮', email: 'miura@example.com', entryDate: '2024-04-01', withdrawDate: '2026-02-28', birthDate: '2010-01-13' },
  { id: 's029', name: '宮崎 咲', displayName: '宮崎咲', email: 'miyazaki@example.com', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-12-24' },
  { id: 's030', name: '森本 陽', displayName: '森本陽', email: 'morimoto@example.com', entryDate: '2024-04-01', withdrawDate: '2026-03-31', birthDate: '2012-10-30' },
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

  const referenceDate = new Date(today)
  if (Number.isNaN(referenceDate.getTime())) return '-'

  const schoolYear = referenceDate >= new Date(referenceDate.getFullYear(), 3, 1) ? referenceDate.getFullYear() : referenceDate.getFullYear() - 1
  const enrollmentYear = resolveEnrollmentYearFromBirthDateParts(birthYear, birthMonth)
  if (schoolYear < enrollmentYear) return '未就学'

  return resolveGradeLabelFromBirthDate(normalized, referenceDate) || '-'
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
  const scheduledStatus = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.birthDate, referenceDate)
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

// 在籍判定(spec-basic-data.md): 入塾日前・退塾日後・高3卒業後は非在籍。手動の非表示(isHidden)は廃止。
// 生徒は birthDate で高3卒業を判定。講師は birthDate を持たない(空文字)ため日付のみで判定する。
export function isActiveOnDate(entryDate: string, withdrawDate: string, birthDate: string, referenceDate: string) {
  const normalizedEntryDate = normalizeDateText(entryDate)
  if (normalizedEntryDate && referenceDate < normalizedEntryDate) return false
  const normalizedWithdrawDate = normalizeDateText(withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return false
  if (hasGraduatedHighSchool(birthDate, referenceDate)) return false
  return true
}

// 講師の在籍状態: 手動の非表示(isHidden)は廃止。休職などで隠す場合は退塾日で代用する(spec決定C)。
export function resolveTeacherRosterStatus(teacher: TeacherRow, referenceDate: string) {
  const normalizedEntryDate = normalizeDateText(teacher.entryDate)
  if (normalizedEntryDate && referenceDate < normalizedEntryDate) return '入塾前'
  const normalizedWithdrawDate = normalizeDateText(teacher.withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return '退塾'
  return '在籍'
}

// 管理データ画面の在籍表示はマネージド判定(入塾日不問)を使う。盤面/請求/日程表は
// 引き続き resolveTeacherRosterStatus / resolveScheduledStatus / isActiveOnDate 側で
// 入塾日前・高3卒業を尊重する(未来入塾の生徒を入塾日前から盤面に出さない)。
export function isTeacherVisibleInManagement(teacher: TeacherRow, referenceDate: string) {
  return resolveManagedRosterStatus(teacher.withdrawDate, '', referenceDate) === '在籍'
}

export function isStudentVisibleInManagement(student: StudentRow, referenceDate: string) {
  return resolveManagedRosterStatus(student.withdrawDate, student.birthDate, referenceDate) === '在籍'
}

export function resolveManagementRosterStatusLabel(status: string) {
  if (status === '在籍') return '在籍'
  if (status === '非表示') return '非表示'
  return '非在籍'
}

// 生徒/講師の在籍状態(spec-basic-data.md): 手動の非表示(isHidden)は廃止。入塾前・退塾・高3卒業後で判定する。
// 講師は birthDate を持たない(空文字)ため、卒業判定はスキップされ日付のみで判定される。
export function resolveScheduledStatus(entryDate: string, withdrawDate: string, birthDate: string, referenceDate: string) {
  const normalizedEntryDate = normalizeDateText(entryDate)
  if (normalizedEntryDate && referenceDate < normalizedEntryDate) return '入塾前'
  const normalizedWithdrawDate = normalizeDateText(withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return '退塾'
  if (hasGraduatedHighSchool(birthDate, referenceDate)) return '退塾'
  return '在籍'
}

// ── 管理データ画面(BasicDataScreen)専用の在籍表示(オーナー指示 2026-07-10) ──
// 方針: 入塾日は在籍判定に使わない(未来入塾でも在籍として名簿に出す)。退塾日以降=退塾日の翌日から
// 非在籍(退塾日当日は在籍=strictly after)。高3卒業は「卒業日(高3学年度末=翌3/31)を退塾日として
// 自動補完」して扱う(明示の退塾日があればそれを優先)。盤面/請求/日程表は従来の isActiveOnDate /
// resolveScheduledStatus を使い続け、入塾日前・高3卒業を尊重する(この画面限定の変更)。

// 高3卒業日(=高3学年度末の翌3/31)を返す。生年月日が無効なら空文字。
export function resolveGraduationWithdrawDate(birthDate: string): string {
  const normalized = normalizeDateText(birthDate)
  if (!normalized) return ''
  const [yearText, monthText] = normalized.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  if (Number.isNaN(birthYear) || Number.isNaN(birthMonth)) return ''
  const enrollmentYear = resolveEnrollmentYearFromBirthDateParts(birthYear, birthMonth)
  // 高3(学年番号12)の学年度は schoolYear=enrollmentYear+11。その年度末=翌年3/31=(enrollmentYear+12)-03-31。
  return `${enrollmentYear + 12}-03-31`
}

// 管理データ表示上の実効退塾日: 明示退塾日を最優先。無ければ高3卒業済みのとき卒業日を自動補完。
// (講師は birthDate を持たない=空文字のため卒業補完はスキップされ、明示退塾日のみが効く。)
export function resolveEffectiveManagedWithdrawDate(withdrawDate: string, birthDate: string, referenceDate: string): string {
  const explicit = normalizeDateText(withdrawDate)
  if (explicit) return explicit
  if (hasGraduatedHighSchool(birthDate, referenceDate)) return resolveGraduationWithdrawDate(birthDate)
  return ''
}

// 管理データの在籍/非在籍(入塾日は不問・退塾日当日は在籍・翌日以降は非在籍)。
export function resolveManagedRosterStatus(withdrawDate: string, birthDate: string, referenceDate: string): '在籍' | '非在籍' {
  const effectiveWithdraw = resolveEffectiveManagedWithdrawDate(withdrawDate, birthDate, referenceDate)
  if (effectiveWithdraw && referenceDate > effectiveWithdraw) return '非在籍'
  return '在籍'
}

// 管理データの生徒ステータス列: 在籍中は学年ラベル(未来入塾でも生年月日から算出)、非在籍は '非在籍'。
export function resolveManagedStudentGradeLabel(student: StudentRow, referenceDate: string): string {
  if (resolveManagedRosterStatus(student.withdrawDate, student.birthDate, referenceDate) === '非在籍') return '非在籍'
  const [yearText, monthText, dayText] = referenceDate.split('-')
  const referenceDateValue = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  return resolveSchoolGradeLabelFromBirthDate(student.birthDate, referenceDateValue)
}

// 管理データの生徒並び順: マネージド学年ラベルで昇順(非在籍は末尾)→表示名→氏名。
export function compareManagedStudentsByGradeThenName(left: StudentRow, right: StudentRow, referenceDate: string) {
  const gradeOrderDiff = resolveStudentGradeSortOrder(resolveManagedStudentGradeLabel(left, referenceDate)) - resolveStudentGradeSortOrder(resolveManagedStudentGradeLabel(right, referenceDate))
  if (gradeOrderDiff !== 0) return gradeOrderDiff

  const displayNameCompare = getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja')
  if (displayNameCompare !== 0) return displayNameCompare

  return left.name.localeCompare(right.name, 'ja')
}
