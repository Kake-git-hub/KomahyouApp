// 毎月の在籍生徒数を「恒久記録(台帳)」として残すための純粋ロジック(サーバー側)。
//
// 背景(オーナー指示 2026-08-08): 請求画面の生徒数は選択中の集計日で毎回ライブ再計算していたため、
// 名簿から生徒を削除したり入塾日/退塾日を後から直すと「当時の人数」を再現できなかった。
// 毎月15日 0:00(JST)時点の在籍数をサーバーが自動で記録し、請求画面はその記録を読む。
//
// ⚠️ 在籍判定はクライアントの権威関数を**意図的に写した鏡像**:
//   - src/components/basic-data/basicDataModel.ts の isActiveOnDate / normalizeDateText
//   - src/utils/studentGradeSubject.ts の hasGraduatedHighSchool / resolveGradeNumberFromBirthDate
// 片方だけ変えないこと(functions/src/developmentClassroomIdentity.ts と同じ運用)。
// ズレは functions/src/monthlyStudentCount.test.ts のパリティテストが検出する。
// Date の組み立て方(ローカルTZの `T00:00:00` / `new Date(y, 3, 1)`)まで写してあるのは、
// 実行環境の TZ が違っても両者が必ず同じ答えを出すようにするため。書き換えない。

export const MONTHLY_STUDENT_COUNT_SNAPSHOT_DAY = 15

const HOUR_IN_MS_LOCAL = 60 * 60 * 1000
const JST_OFFSET_IN_MS_LOCAL = 9 * HOUR_IN_MS_LOCAL

// UTC の瞬間から JST の日付キー(YYYY-MM-DD)を作る。スケジュール実行は timeZone: 'Asia/Tokyo' でも
// 関数内の new Date() は UTC 基準なので、記録する日付はここで JST へ寄せる。
export function toJstDateKey(date: Date) {
  const jst = new Date(date.getTime() + JST_OFFSET_IN_MS_LOCAL)
  const year = jst.getUTCFullYear()
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${jst.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toMonthKeyFromDateKey(dateKey: string) {
  return dateKey.slice(0, 7)
}

export function isMonthlyStudentCountSnapshotDate(dateKey: string) {
  return Number(dateKey.slice(8, 10)) === MONTHLY_STUDENT_COUNT_SNAPSHOT_DAY
}

// 鏡像: basicDataModel.ts の normalizeDateText。'未定'/空/不正は空文字に潰す。
export function normalizeRosterDateText(value: string) {
  const text = value.trim()
  if (!text || text === '未定') return ''
  const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (directMatch) return text
  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (!slashMatch) return ''
  const [, year, month, day] = slashMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

// 鏡像: studentGradeSubject.ts の toDate。
function toReferenceDate(value: string | Date) {
  if (value instanceof Date) return new Date(value)
  return new Date(`${value}T00:00:00`)
}

// 鏡像: studentGradeSubject.ts の resolveEnrollmentYearFromBirthDateParts。
export function resolveEnrollmentYearFromBirthDateParts(birthYear: number, birthMonth: number) {
  return birthMonth < 4 ? birthYear + 6 : birthYear + 7
}

// 鏡像: studentGradeSubject.ts の resolveGradeNumberFromBirthDate(小1=1 … 高3=12、13以上=卒業後)。
export function resolveGradeNumberFromBirthDate(birthDate?: string, referenceDate: string | Date = new Date()): number | null {
  if (!birthDate) return null

  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return null

  const date = toReferenceDate(referenceDate)
  if (Number.isNaN(date.getTime())) return null

  const schoolYear = date >= new Date(date.getFullYear(), 3, 1) ? date.getFullYear() : date.getFullYear() - 1
  const enrollmentYear = resolveEnrollmentYearFromBirthDateParts(birthYear, birthMonth)
  return schoolYear - enrollmentYear + 1
}

// 鏡像: studentGradeSubject.ts の hasGraduatedHighSchool。
export function hasGraduatedHighSchoolOnDate(birthDate: string | undefined, referenceDate: string | Date) {
  const gradeNumber = resolveGradeNumberFromBirthDate(birthDate, referenceDate)
  return gradeNumber !== null && gradeNumber >= 13
}

// 鏡像: basicDataModel.ts の isActiveOnDate。請求の在籍判定はこの3条件だけ
// (入塾日前は非在籍 / 退塾日当日は在籍・翌日から非在籍 / 高3卒業後は非在籍)。
export function isStudentActiveOnDate(entryDate: string, withdrawDate: string, birthDate: string, referenceDate: string) {
  const normalizedEntryDate = normalizeRosterDateText(entryDate)
  if (normalizedEntryDate && referenceDate < normalizedEntryDate) return false
  const normalizedWithdrawDate = normalizeRosterDateText(withdrawDate)
  if (normalizedWithdrawDate && referenceDate > normalizedWithdrawDate) return false
  if (hasGraduatedHighSchoolOnDate(birthDate, referenceDate)) return false
  return true
}

export type LedgerStudentRow = {
  id: string
  entryDate: string
  withdrawDate: string
  birthDate: string
}

function readText(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

// スナップショット payload の students(unknown[]) を判定に必要な形だけ取り出す。
// id が無い行は台帳の内訳に載せられないが、人数には数える(在籍実態を欠かさないため)。
export function toLedgerStudentRows(students: unknown): LedgerStudentRow[] {
  if (!Array.isArray(students)) return []
  return students
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      id: readText(entry, 'id'),
      entryDate: readText(entry, 'entryDate'),
      withdrawDate: readText(entry, 'withdrawDate'),
      birthDate: readText(entry, 'birthDate'),
    }))
}

export type MonthlyStudentCountResult = {
  studentCount: number
  studentIds: string[]
}

// 指定日の在籍生徒数と、その内訳(生徒ID)を返す。ID を併記するのは、後から人数だけを
// 突きつけられても検証できないため(「確実に読み取れる」の根拠)。
export function countActiveStudentsOnDate(students: unknown, referenceDate: string): MonthlyStudentCountResult {
  const rows = toLedgerStudentRows(students)
  const activeRows = rows.filter((row) => isStudentActiveOnDate(row.entryDate, row.withdrawDate, row.birthDate, referenceDate))
  return {
    studentCount: activeRows.length,
    studentIds: activeRows.map((row) => row.id).filter(Boolean),
  }
}
