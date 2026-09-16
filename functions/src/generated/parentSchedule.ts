// GENERATED FROM src/utils/parentSchedule.ts — 手で編集しない。npm --prefix functions run sync-shared で再生成。
// 保護者向け固定QR — 日程計算の権威純関数(spec-parent-portal.md §D)。
//
// ⚠️ このファイルは **自己完結(import 0 行)** で書く。functions 側は
//   `functions/scripts/sync-shared.mjs` がこのファイルをそのまま `functions/src/generated/parentSchedule.ts`
//   へ複製して同梱する(spec §D「クライアントと Cloud Functions の二重実装を禁止」)。
//   `import`(type 含む)・`import` の meta プロパティ(Vite 環境変数)・React/xlsx/firebase・パスエイリアスは
//   複製先で解決できないので禁止(sync-shared.mjs が検査する)。
//   ズレは functions/src/parentSchedule.parity.test.ts が検出する。
//
// 型は既存の権威(src/components/schedule-board/types.ts / src/types/appState.ts 等)を **構造的に** 写した
// ローカル宣言。入力 payload は unknown として受け、ここで絞り込む(functions 側は students 等が unknown[])。
//
// 写しの元(アルゴリズムの正本。変えるときは両方を見る):
//   - 在籍判定: basicDataModel.ts isActiveOnDate / normalizeDateText、studentGradeSubject.ts hasGraduatedHighSchool
//   - 休み→振替先: schedule-board/lessonLinks.ts buildLinkedLessonDestinationMap
//   - テンプレ→行: regular-template/regularLessonTemplate.ts buildRegularLessonsFromTemplate
//   - 履歴結合: scheduleHtml.ts buildCombinedRegularLessonsFromHistory
//   - 行→日付の通常授業: ScheduleBoardScreen.tsx buildManagedRegularLessonsRange(生徒部分)
//   - 抑止鍵: ScheduleBoardScreen.tsx buildManagedOccurrenceKey / buildSuppressedManagedOccurrenceKeys
//   - 生徒同一性: scheduleViewData.ts buildUniqueStudentNameOwnerMap / getStudentAssignmentKeys
//   - 科目表示: studentGradeSubject.ts resolveDisplayedSubjectForGrade(算/数を学年で正規化)
//
// 日付の扱い: すべて 'YYYY-MM-DD' の文字列比較。曜日計算は Date.UTC から getUTCDay で取り、
// `Date.parse('YYYY-MM-DD')`(UTC 深夜扱いで負オフセット TZ だと日付がずれる)は使わない。
// Cloud Functions は UTC で動くため「今日」は toJstDateKey で JST に寄せる(§F)。

// ---------------------------------------------------------------------------
// 公開定数・型(k_contract §1/§2 と一致させる)
// ---------------------------------------------------------------------------

// 表示は暦の 1 か月単位(オーナー指示 2026-09-14・確認リスト k-4/k-5)。移動できるのは今月の前後 1 か月だけ。
export const PARENT_SCHEDULE_MONTHS_BEFORE = 1
export const PARENT_SCHEDULE_MONTHS_AFTER = 1

export type ParentScheduleLessonKind = 'regular' | 'makeup' | 'extra' | 'absent' | 'absent-no-makeup' | 'attended'

export type ParentScheduleLesson = {
  slotNumber: number
  timeLabel: string
  subject: string
  kind: ParentScheduleLessonKind
  /** kind==='absent' のときだけ付く。null=振替日は調整中(在庫数は出さない) */
  makeupDestination?: { dateKey: string; slotNumber: number } | null
  /**
   * 振替コマ(配置の makeup・振替を出席/振無休にしたもの)のときだけ付く振替元(確認リスト その他 2026-09-14)。
   * slotNumber は元コマのラベルから読めないとき null(日付だけ出す)。
   */
  makeupOrigin?: { dateKey: string; slotNumber: number | null }
  /** テンプレ補完由来(=「予定(変更の可能性あり)」) */
  isTentative: boolean
}

// 'closed' は臨時・祝日の休み(holidayDates)だけ。定休曜日・授業の無い日・データの無い日は行を出さない。
// 講習期間という区別は持たない(講習は講習提出QRで案内し、このページは通常授業だけを出す)。
export type ParentScheduleDayKind = 'closed' | 'board' | 'template'

export type ParentScheduleDay = {
  dateKey: string
  /** 0=日..6=土 */
  weekday: number
  kind: ParentScheduleDayKind
  /** kind が board/template のときは 1 件以上。closed は常に [] */
  lessons: ParentScheduleLesson[]
  /**
   * closed(臨時・祝日の休み)の日から出ていった振替の振替先(確認リスト k-11)。無ければ省略。
   * 休講日の授業を振替に回したとき「教室休み」の行に振替先を添えるため。
   */
  makeupDestinations?: Array<{ dateKey: string; slotNumber: number }>
}

export type ParentScheduleRange = { from: string; to: string }

export type ParentScheduleView = {
  studentName: string
  days: ParentScheduleDay[]
  /**
   * 範囲内の開講日に、この生徒の講習コマ(special。配置・出欠記録の両方)が盤面にあったか。講習コマ自体は出さない。
   * 講習だけの月が「休みしか無い」ように見えるのを注記で補うための印(確認リスト k-4・オーナー回答 2026-09-14)。件数・日付は出さない(§C)。
   */
  hasLectureLessons: boolean
}

// ---------------------------------------------------------------------------
// 構造的ローカル型(既存型の写し。表示に要る最小限のフィールドだけ)
// ---------------------------------------------------------------------------

type ParentStudentRow = {
  id: string
  name: string
  displayName: string
  entryDate: string
  withdrawDate: string
  birthDate: string
}

type ParentRegularLessonRow = {
  id: string
  schoolYear: number
  teacherId: string
  student1Id: string
  subject1: string
  student1Note: string
  startDate: string
  endDate: string
  student2Id: string
  subject2: string
  student2Note: string
  student2StartDate: string
  student2EndDate: string
  dayOfWeek: number
  slotNumber: number
}

type ParentTemplateStudent = { studentId: string; subject: string; note: string }
type ParentTemplateDesk = { deskIndex: number; teacherId: string; students: [ParentTemplateStudent | null, ParentTemplateStudent | null] }
type ParentTemplateCell = { dayOfWeek: number; slotNumber: number; desks: ParentTemplateDesk[] }
type ParentTemplate = { effectiveStartDate: string; cells: ParentTemplateCell[] }

type ParentBoardStudentEntry = {
  id: string
  name: string
  managedStudentId?: string
  grade: string
  subject: string
  lessonType: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
}

type ParentBoardStatusEntry = ParentBoardStudentEntry & {
  status: string
}

type ParentBoardDesk = {
  studentSlots: Array<ParentBoardStudentEntry | null>
  statusSlots: Array<ParentBoardStatusEntry | null>
}

type ParentBoardCell = {
  dateKey: string
  slotNumber: number
  timeLabel: string
  desks: ParentBoardDesk[]
}

type ParentClassroomSettings = {
  closedWeekdays: number[]
  holidayDates: string[]
  forceOpenDates: string[]
  deskCount: number
  regularLessonTemplateHistory: ParentTemplate[]
  preTemplateRegularLessons: ParentRegularLessonRow[]
  templateFreezeBeforeDate: string
}

type ParentPayload = {
  students: ParentStudentRow[]
  regularLessons: ParentRegularLessonRow[]
  classroomSettings: ParentClassroomSettings
  weeks: ParentBoardCell[][]
  suppressedRegularLessonOccurrences: string[]
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ(TZ 非依存)
// ---------------------------------------------------------------------------

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_IN_MS = 24 * 60 * 60 * 1000
const JST_OFFSET_IN_MS = 9 * 60 * 60 * 1000

/** deskCount が欠落・非数のときの机数(アプリ既定と同じ)。 */
export const PARENT_DEFAULT_DESK_COUNT = 14

// 盤面のコマ時間(schedule-board/slotTimes.ts boardSlotTimes の写し。教室別設定ではなく全教室共通)。
// ★export しているのはテストで権威と突き合わせるため(写しなので、時間割を変えたら両方直す。
//   突き合わせが無いと「盤面・日程表は新時刻・保護者ページのテンプレ補完日だけ旧時刻」に静かにズレる)。
export const PARENT_BOARD_SLOT_TIMES = ['13:00-14:30', '14:40-16:10', '16:20-17:50', '18:00-19:30', '19:40-21:10']

function pad2(value: number) {
  return `${value}`.padStart(2, '0')
}

function parseDateKeyParts(dateKey: string): { year: number; month: number; day: number } | null {
  const matched = DATE_KEY_PATTERN.exec(dateKey)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 2月30日のような存在しない日付は UTC で往復させて弾く。
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  return { year, month, day }
}

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseDateKeyParts(value) !== null
}

function toUtcMidnightMs(dateKey: string) {
  const parts = parseDateKeyParts(dateKey)
  if (!parts) return Number.NaN
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

function formatUtcDateKey(ms: number) {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

/** UTC の瞬間から JST の日付キー(YYYY-MM-DD)を作る(functions/src/monthlyStudentCount.ts toJstDateKey と同じ規則)。 */
export function toJstDateKey(date: Date): string {
  return formatUtcDateKey(date.getTime() + JST_OFFSET_IN_MS)
}

/** 日付キーに日数を足す(負も可)。不正なキーはそのまま返す。 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const ms = toUtcMidnightMs(dateKey)
  if (Number.isNaN(ms)) return dateKey
  return formatUtcDateKey(ms + days * DAY_IN_MS)
}

/** 日付キーの曜日(0=日..6=土)。閉講曜日 closedWeekdays(JS getDay 規約)との照合に使う。 */
export function getWeekdayFromDateKey(dateKey: string): number {
  const ms = toUtcMidnightMs(dateKey)
  if (Number.isNaN(ms)) return -1
  return new Date(ms).getUTCDay()
}

function diffDays(fromKey: string, toKey: string) {
  return Math.round((toUtcMidnightMs(toKey) - toUtcMidnightMs(fromKey)) / DAY_IN_MS)
}

function clampDateKey(dateKey: string, minKey: string, maxKey: string) {
  if (dateKey < minKey) return minKey
  if (dateKey > maxKey) return maxKey
  return dateKey
}

function monthStartOf(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`
}

/** 'YYYY-MM-01' に月数を足す(負も可)。 */
function addMonthsToMonthStart(monthStartKey: string, months: number) {
  const year = Number(monthStartKey.slice(0, 4))
  const monthIndex = Number(monthStartKey.slice(5, 7)) - 1 + months
  const date = new Date(Date.UTC(year, monthIndex, 1))
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01`
}

function monthEndOf(monthStartKey: string) {
  return addDaysToDateKey(addMonthsToMonthStart(monthStartKey, 1), -1)
}

/**
 * 表示期間の丸め(spec §D-1 / §0 P-1)。**暦の 1 か月単位**で、エラーにせず丸める。
 * - `from`(無ければ `to`、どちらも無ければ今日)が属する月の 1 日〜末日を返す。
 * - 限界は今月の前後 1 か月(先月 1 日〜来月末日)。範囲外の月は近い端の月へ寄せる。
 */
export function resolveParentScheduleRange(
  input: { from?: unknown; to?: unknown },
  todayKey: string,
): { from: string; to: string; bounds: { minFrom: string; maxTo: string } } {
  const currentMonthStart = monthStartOf(todayKey)
  const minFrom = addMonthsToMonthStart(currentMonthStart, -PARENT_SCHEDULE_MONTHS_BEFORE)
  const maxMonthStart = addMonthsToMonthStart(currentMonthStart, PARENT_SCHEDULE_MONTHS_AFTER)
  const maxTo = monthEndOf(maxMonthStart)

  const anchor = isValidDateKey(input.from) ? input.from : isValidDateKey(input.to) ? input.to : todayKey
  const from = clampDateKey(monthStartOf(anchor), minFrom, maxMonthStart)
  return { from, to: monthEndOf(from), bounds: { minFrom, maxTo } }
}

// ---------------------------------------------------------------------------
// 在籍判定・表示名(basicDataModel.ts / studentGradeSubject.ts の写し)
// ---------------------------------------------------------------------------

/** basicDataModel.normalizeDateText の写し: ''/'未定' → ''、'YYYY-MM-DD' はそのまま、'YYYY/M/D'・'YYYY.M.D' を受理。 */
export function normalizeParentDateText(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text || text === '未定') return ''
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(text)) return text
  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (!slashMatch) return ''
  const [, year, month, day] = slashMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

// studentGradeSubject.resolveGradeNumberFromBirthDate の写し。
// ★birthDate は正規化せず '-' で分割する(元関数と同じ。'2010/5/1' は NaN → null = 判定不能)。
// 元は referenceDate を `${key}T00:00:00`(ローカル) で Date にして 4/1 と比較するが、日付キーの
// 年月だけで同じ答えになるので Date を作らない(TZ 非依存)。
function resolveGradeNumberFromBirthDate(birthDate: string, referenceDateKey: string): number | null {
  if (!birthDate) return null
  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  if ([birthYear, birthMonth, birthDay].some((value) => Number.isNaN(value))) return null
  const reference = parseDateKeyParts(referenceDateKey)
  if (!reference) return null
  const schoolYear = reference.month >= 4 ? reference.year : reference.year - 1
  const enrollmentYear = birthMonth < 4 ? birthYear + 6 : birthYear + 7
  return schoolYear - enrollmentYear + 1
}

// 高3卒業判定(spec-basic-data.md): 学年番号 13 以上 = 卒業 = 非在籍。
function hasGraduatedHighSchool(birthDate: string, referenceDateKey: string) {
  const gradeNumber = resolveGradeNumberFromBirthDate(birthDate, referenceDateKey)
  return gradeNumber !== null && gradeNumber >= 13
}

function gradeLabelFromNumber(gradeNumber: number) {
  if (gradeNumber <= 1) return '小1'
  if (gradeNumber === 2) return '小2'
  if (gradeNumber === 3) return '小3'
  if (gradeNumber === 4) return '小4'
  if (gradeNumber === 5) return '小5'
  if (gradeNumber === 6) return '小6'
  if (gradeNumber === 7) return '中1'
  if (gradeNumber === 8) return '中2'
  if (gradeNumber === 9) return '中3'
  if (gradeNumber === 10) return '高1'
  if (gradeNumber === 11) return '高2'
  return '高3'
}

// studentGradeSubject.resolveGradeLabelFromBirthDate の写し(判定不能は '')。テンプレ行の科目正規化に使う。
function resolveGradeLabelFromBirthDate(birthDate: string, referenceDateKey: string) {
  const gradeNumber = resolveGradeNumberFromBirthDate(birthDate, referenceDateKey)
  return gradeNumber === null ? '' : gradeLabelFromNumber(gradeNumber)
}

// ScheduleBoardScreen.resolveSchoolGradeLabel の写し(NaN 検査なし → 比較がすべて偽で '高3')。
// createManagedStudentEntry の grade(=その日の学年)の算出に使う。
function resolveBoardSchoolGradeLabel(birthDate: string, referenceDateKey: string) {
  const [yearText, monthText] = birthDate.split('-')
  const reference = parseDateKeyParts(referenceDateKey)
  const schoolYear = reference ? (reference.month >= 4 ? reference.year : reference.year - 1) : Number.NaN
  const birthMonth = Number(monthText)
  const enrollmentYear = birthMonth < 4 ? Number(yearText) + 6 : Number(yearText) + 7
  return gradeLabelFromNumber(schoolYear - enrollmentYear + 1)
}

function isElementaryGradeLabel(gradeLabel: string) {
  return gradeLabel.startsWith('小')
}

// studentGradeSubject.resolveDisplayedSubjectForGrade の写し(算/数だけを学年で正規化。算国/理社は素通し)。
function resolveDisplayedSubjectForGrade(subject: string, gradeLabel: string) {
  if (subject !== '算' && subject !== '数') return subject
  return isElementaryGradeLabel(gradeLabel) ? '算' : '数'
}

/**
 * basicDataModel.isActiveOnDate の写し(spec §F): 入塾日前・退塾日の当日以降・高3卒業後は非在籍。
 * 2026-09-15 改定で退塾日当日から閲覧不可(P-6)。管理画面用の「入塾日不問」規則は使わない。
 */
export function isParentStudentActiveOnDate(
  student: { entryDate?: unknown; withdrawDate?: unknown; birthDate?: unknown },
  dateKey: string,
): boolean {
  const entryDate = normalizeParentDateText(student.entryDate)
  if (entryDate && dateKey < entryDate) return false
  const withdrawDate = normalizeParentDateText(student.withdrawDate)
  if (withdrawDate && dateKey >= withdrawDate) return false
  if (hasGraduatedHighSchool(String(student.birthDate ?? ''), dateKey)) return false
  return true
}

// basicDataModel.deriveManagedDisplayName / getStudentDisplayName の写し。
function deriveDisplayName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.split(/[\s\u3000]+/u)[0] ?? trimmed
}

function getStudentDisplayName(student: ParentStudentRow) {
  return student.displayName.trim() || deriveDisplayName(student.name) || student.name.trim()
}

// 名前照合の正規化(scheduleHtml.normalizeStudentNameLookupKey / scheduleViewData.normalizeStudentAssignmentName と同じ: 空白除去)。
function normalizeNameKey(value: string) {
  return value.replace(/\s+/gu, '').trim()
}

// ---------------------------------------------------------------------------
// payload の絞り込み(unknown → 構造的ローカル型)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === 'string')
}

function readNumberArray(value: unknown): number[] {
  return readArray(value).filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
}

function readStudentRow(value: unknown): ParentStudentRow | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  if (!id) return null
  return {
    id,
    name: readString(value.name),
    displayName: readString(value.displayName),
    entryDate: readString(value.entryDate),
    withdrawDate: readString(value.withdrawDate),
    birthDate: readString(value.birthDate),
  }
}

function readRegularLessonRow(value: unknown): ParentRegularLessonRow | null {
  if (!isRecord(value)) return null
  return {
    id: readString(value.id),
    schoolYear: readNumber(value.schoolYear, Number.NaN),
    teacherId: readString(value.teacherId),
    student1Id: readString(value.student1Id),
    subject1: readString(value.subject1),
    student1Note: readString(value.student1Note),
    startDate: readString(value.startDate),
    endDate: readString(value.endDate),
    student2Id: readString(value.student2Id),
    subject2: readString(value.subject2),
    student2Note: readString(value.student2Note),
    student2StartDate: readString(value.student2StartDate),
    student2EndDate: readString(value.student2EndDate),
    dayOfWeek: readNumber(value.dayOfWeek, Number.NaN),
    slotNumber: readNumber(value.slotNumber, Number.NaN),
  }
}

function readTemplateStudent(value: unknown): ParentTemplateStudent | null {
  if (!isRecord(value)) return null
  const studentId = readString(value.studentId)
  if (!studentId) return null
  return { studentId, subject: readString(value.subject), note: readString(value.note) }
}

function readTemplate(value: unknown): ParentTemplate | null {
  if (!isRecord(value)) return null
  return {
    effectiveStartDate: readString(value.effectiveStartDate),
    cells: readArray(value.cells).flatMap((cell) => {
      if (!isRecord(cell)) return []
      return [{
        dayOfWeek: readNumber(cell.dayOfWeek, Number.NaN),
        slotNumber: readNumber(cell.slotNumber, Number.NaN),
        desks: readArray(cell.desks).flatMap((desk) => {
          if (!isRecord(desk)) return []
          const students = readArray(desk.students)
          return [{
            deskIndex: readNumber(desk.deskIndex, Number.NaN),
            teacherId: readString(desk.teacherId),
            students: [readTemplateStudent(students[0]), readTemplateStudent(students[1])] as [ParentTemplateStudent | null, ParentTemplateStudent | null],
          }]
        }),
      }]
    }),
  }
}

function readBoardEntry(value: unknown): ParentBoardStudentEntry | null {
  if (!isRecord(value)) return null
  const managedStudentId = readString(value.managedStudentId)
  const makeupSourceDate = readString(value.makeupSourceDate)
  const makeupSourceLabel = readString(value.makeupSourceLabel)
  return {
    id: readString(value.id),
    name: readString(value.name),
    managedStudentId: managedStudentId || undefined,
    grade: readString(value.grade),
    subject: readString(value.subject),
    lessonType: readString(value.lessonType),
    makeupSourceDate: makeupSourceDate || undefined,
    makeupSourceLabel: makeupSourceLabel || undefined,
  }
}

function readBoardStatusEntry(value: unknown): ParentBoardStatusEntry | null {
  const entry = readBoardEntry(value)
  if (!entry || !isRecord(value)) return null
  return { ...entry, status: readString(value.status) }
}

function readBoardCell(value: unknown): ParentBoardCell | null {
  if (!isRecord(value)) return null
  const dateKey = readString(value.dateKey)
  const slotNumber = readNumber(value.slotNumber, Number.NaN)
  if (!isValidDateKey(dateKey) || !Number.isInteger(slotNumber)) return null
  return {
    dateKey,
    slotNumber,
    timeLabel: readString(value.timeLabel),
    desks: readArray(value.desks).flatMap((desk) => {
      if (!isRecord(desk)) return []
      const lesson = isRecord(desk.lesson) ? desk.lesson : null
      return [{
        studentSlots: lesson ? readArray(lesson.studentSlots).map(readBoardEntry) : [],
        statusSlots: readArray(desk.statusSlots).map(readBoardStatusEntry),
      }]
    }),
  }
}

// 保存形は週ごとに cell 配列 or `{ cells: [...] }`(Firestore のネスト配列回避)。両方受ける。
function readWeeks(value: unknown): ParentBoardCell[][] {
  return readArray(value).map((week) => {
    const cells = Array.isArray(week) ? week : isRecord(week) ? readArray(week.cells) : []
    return cells.flatMap((cell) => {
      const parsed = readBoardCell(cell)
      return parsed ? [parsed] : []
    })
  })
}

function readPayload(payload: unknown): ParentPayload | null {
  if (!isRecord(payload)) return null
  const settings = isRecord(payload.classroomSettings) ? payload.classroomSettings : {}
  const boardState = isRecord(payload.boardState) ? payload.boardState : {}
  return {
    students: readArray(payload.students).flatMap((row) => {
      const parsed = readStudentRow(row)
      return parsed ? [parsed] : []
    }),
    regularLessons: readArray(payload.regularLessons).flatMap((row) => {
      const parsed = readRegularLessonRow(row)
      return parsed ? [parsed] : []
    }),
    classroomSettings: {
      closedWeekdays: readNumberArray(settings.closedWeekdays),
      holidayDates: readStringArray(settings.holidayDates),
      forceOpenDates: readStringArray(settings.forceOpenDates),
      // 盤面の空セル生成(createEmptyBoardCells)と同じく deskCount をそのまま机数にする。
      // ★数値でないときの既定は **14**(アプリ既定・functions の空 payload 既定と同じ)。1 にしていた実装では、
      //   deskCount が欠けた古いスナップショットで各限の 2 行目以降のテンプレ授業が静かに消えていた
      //   (0 件ではなく「一部だけ出る」ので気づけない・レビュー指摘 2026-09-13)。
      deskCount: Math.max(0, Math.floor(readNumber(settings.deskCount, PARENT_DEFAULT_DESK_COUNT))),
      regularLessonTemplateHistory: readArray(settings.regularLessonTemplateHistory).flatMap((template) => {
        const parsed = readTemplate(template)
        return parsed ? [parsed] : []
      }),
      preTemplateRegularLessons: readArray(settings.preTemplateRegularLessons).flatMap((row) => {
        const parsed = readRegularLessonRow(row)
        return parsed ? [parsed] : []
      }),
      templateFreezeBeforeDate: readString(settings.templateFreezeBeforeDate),
    },
    weeks: readWeeks(boardState.weeks),
    suppressedRegularLessonOccurrences: readStringArray(boardState.suppressedRegularLessonOccurrences),
  }
}

// ---------------------------------------------------------------------------
// 休講の判定(spec §D-2 1)
// ---------------------------------------------------------------------------

// 開講判定の優先順位は forceOpenDates > holidayDates > closedWeekdays(scheduleViewData.isOpenDayByRules /
// buildManagedRegularLessonsRange の openDateKeys と同じ)。
function isOpenDay(settings: ParentClassroomSettings, dateKey: string) {
  if (settings.forceOpenDates.includes(dateKey)) return true
  if (settings.holidayDates.includes(dateKey)) return false
  return !settings.closedWeekdays.includes(getWeekdayFromDateKey(dateKey))
}


// ---------------------------------------------------------------------------
// 生徒同一性(spec §D-3・k_contract §2-5)
// ---------------------------------------------------------------------------

// scheduleViewData.buildUniqueStudentNameOwnerMap の写し: 名簿の name / 表示名を空白除去した鍵 → 所有者 id。
// 同名が複数いる鍵は '' にして名前一致を無効化する(同名別人の混同防止)。
function buildUniqueNameOwnerMap(students: ParentStudentRow[]) {
  const ownerByName = new Map<string, string>()
  for (const student of students) {
    for (const name of [student.name, getStudentDisplayName(student)]) {
      const key = normalizeNameKey(name)
      if (!key) continue
      const current = ownerByName.get(key)
      if (current && current !== student.id) ownerByName.set(key, '')
      else if (current !== '') ownerByName.set(key, student.id)
    }
  }
  return ownerByName
}

function createEntryMatcher(students: ParentStudentRow[], studentId: string) {
  const ownerByName = buildUniqueNameOwnerMap(students)
  // managedStudentId があるときはそれだけで判定する(あるのに名前で拾う実装にはしない)。
  return (entry: { managedStudentId?: string; name: string }) => {
    if (entry.managedStudentId) return entry.managedStudentId === studentId
    const key = normalizeNameKey(entry.name)
    return Boolean(key) && ownerByName.get(key) === studentId
  }
}

// ---------------------------------------------------------------------------
// 休み → 振替先(lessonLinks.buildLinkedLessonDestinationMap の写し)
// ---------------------------------------------------------------------------

function parseOriginSlotNumber(makeupSourceLabel?: string) {
  const matched = String(makeupSourceLabel ?? '').match(/(\d+)限/)
  return matched ? Number(matched[1]) : null
}

// 振替コマの振替元(日付＋元コマ)。振替元が同じ日(=移動ではなく当日内)や日付が壊れているときは付けない。
function resolveMakeupOrigin(entry: { lessonType: string; makeupSourceDate?: string; makeupSourceLabel?: string }, cellDateKey: string) {
  if (entry.lessonType !== 'makeup') return null
  const dateKey = entry.makeupSourceDate ?? ''
  if (!isValidDateKey(dateKey) || dateKey === cellDateKey) return null
  return { dateKey, slotNumber: parseOriginSlotNumber(entry.makeupSourceLabel) }
}

function formatLinkKey(stockKind: string, studentKey: string, subject: string, dateKey: string, slotNumber: number | null) {
  return [stockKind, studentKey, subject, dateKey, String(slotNumber ?? '')].join('__')
}

function resolveComparableStudentKeys(entry: { managedStudentId?: string; name: string }) {
  const keys: string[] = []
  if (entry.managedStudentId) keys.push(entry.managedStudentId)
  if (entry.name) keys.push(`name:${entry.name}`)
  return keys
}

function resolveStatusLinkKeys(statusEntry: ParentBoardStatusEntry, cell: ParentBoardCell) {
  if (statusEntry.status !== 'absent') return []
  if (statusEntry.makeupSourceDate && statusEntry.makeupSourceDate !== cell.dateKey) return []
  const stockKind = statusEntry.lessonType === 'special' ? 'special' : 'makeup'
  const dateKey = statusEntry.makeupSourceDate ?? cell.dateKey
  const slotNumber = parseOriginSlotNumber(statusEntry.makeupSourceLabel) ?? cell.slotNumber
  const keys: string[] = []
  for (const studentKey of resolveComparableStudentKeys(statusEntry)) {
    for (const slot of [slotNumber, null]) {
      keys.push(formatLinkKey(stockKind, studentKey, statusEntry.subject, dateKey, slot))
    }
  }
  return keys
}

function resolvePlacedLessonLinkKeys(student: ParentBoardStudentEntry, cell: ParentBoardCell) {
  if (!student.makeupSourceDate) return []
  const stockKind = student.lessonType === 'special'
    ? 'special'
    : student.lessonType === 'makeup' || student.lessonType === 'regular'
      ? 'makeup'
      : null
  if (!stockKind) return []
  if (student.makeupSourceDate === cell.dateKey) return []
  const slotNumber = parseOriginSlotNumber(student.makeupSourceLabel)
  const slotCandidates: Array<number | null> = slotNumber === null ? [null] : [slotNumber, null]
  const keys: string[] = []
  for (const studentKey of resolveComparableStudentKeys(student)) {
    for (const slot of slotCandidates) {
      keys.push(formatLinkKey(stockKind, studentKey, student.subject, student.makeupSourceDate, slot))
    }
  }
  return keys
}

function sortCells(cells: ParentBoardCell[]) {
  return [...cells].sort((left, right) => {
    if (left.dateKey !== right.dateKey) return left.dateKey < right.dateKey ? -1 : 1
    return left.slotNumber - right.slotNumber
  })
}

// 振替先の解決は **全週** を走査する(振替先が表示範囲外でも保護者には重要。spec §D-5)。
function buildLinkedLessonDestinationMap(cells: ParentBoardCell[]) {
  const sortedCells = sortCells(cells)
  const destinationByLinkKey = new Map<string, { dateKey: string; slotNumber: number }>()
  const registerDestination = (entry: ParentBoardStudentEntry, cell: ParentBoardCell) => {
    for (const linkKey of resolvePlacedLessonLinkKeys(entry, cell)) {
      if (destinationByLinkKey.has(linkKey)) continue
      destinationByLinkKey.set(linkKey, { dateKey: cell.dateKey, slotNumber: cell.slotNumber })
    }
  }

  for (const cell of sortedCells) {
    for (const desk of cell.desks) {
      for (const student of desk.studentSlots) {
        if (student) registerDestination(student, cell)
      }
      // 回帰防止(緑が丘 室長報告 2026-09-04 / spec P-10): 振替コマを「出席」「振無休」にすると studentSlots →
      // statusSlots へ移る。配置だけを振替先とみなすと、出席にした瞬間に元コマの「休」の振替先が消える。
      // ★absent(振替コマ自体を休みにした＝在庫へ戻った)と moved は振替先にしない(lessonLinks.ts と同じ)。
      for (const statusEntry of desk.statusSlots) {
        if (!statusEntry) continue
        if (statusEntry.status !== 'attended' && statusEntry.status !== 'absent-no-makeup') continue
        registerDestination(statusEntry, cell)
      }
    }
  }

  const destinationByStatusId = new Map<string, { dateKey: string; slotNumber: number }>()
  for (const cell of sortedCells) {
    for (const desk of cell.desks) {
      for (const statusEntry of desk.statusSlots) {
        if (!statusEntry) continue
        for (const linkKey of resolveStatusLinkKeys(statusEntry, cell)) {
          const destination = destinationByLinkKey.get(linkKey)
          if (!destination || destination.dateKey === cell.dateKey) continue
          destinationByStatusId.set(statusEntry.id, destination)
          break
        }
      }
    }
  }
  return destinationByStatusId
}

// ---------------------------------------------------------------------------
// 抑止鍵(ScheduleBoardScreen buildManagedOccurrenceKey / buildSuppressedManagedOccurrenceKeys の写し)
// ---------------------------------------------------------------------------

export function buildManagedOccurrenceKey(studentKey: string, subject: string, dateKey: string, slotNumber: number) {
  return `${studentKey}__${subject}__${dateKey}__${slotNumber}`
}

// 明示鍵(boardState.suppressedRegularLessonOccurrences)＋置かれた振替(studentSlots の makeup)から導く暗黙鍵。
// 暗黙鍵が無いと、保存されていない週から振替で出した授業が元の曜日に再び湧く。
// 'TEMPLATE_TEACHER__DAY__' 接頭辞の鍵は講師専用で、生徒鍵とは形式上一致しないので特別扱い不要。
function buildSuppressedOccurrenceKeys(weeks: ParentBoardCell[][], explicitKeys: string[]) {
  const suppressedKeys = new Set<string>()
  for (const key of explicitKeys) {
    if (key) suppressedKeys.add(key)
  }
  for (const week of weeks) {
    for (const cell of week) {
      for (const desk of cell.desks) {
        for (const student of desk.studentSlots) {
          if (!student || student.lessonType !== 'makeup' || !student.makeupSourceDate) continue
          const originSlotNumber = parseOriginSlotNumber(student.makeupSourceLabel)
          if (!originSlotNumber) continue
          if (student.makeupSourceDate === cell.dateKey && originSlotNumber === cell.slotNumber) continue
          suppressedKeys.add(buildManagedOccurrenceKey(student.managedStudentId ?? student.name, student.subject, student.makeupSourceDate, originSlotNumber))
        }
      }
    }
  }
  return suppressedKeys
}

// ---------------------------------------------------------------------------
// テンプレ → 通常授業行(regularLessonTemplate.ts / regularLessonModel.ts の写し)
// ---------------------------------------------------------------------------

// ★いずれも権威の写し。テストで突き合わせるため export する(regularLessonTemplate.regularTemplateDayOptions /
//   regularTemplateSlotNumbers / studentGradeSubject.allStudentSubjectOptions)。科目を 1 つ足したのに
//   ここを直さないと、テンプレ補完の科目が一覧に無い扱いで「英」に潰れる(理社の追加 v1.5.413 と同型の作業)。
export const TEMPLATE_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0]
export const TEMPLATE_SLOT_NUMBERS = [1, 2, 3, 4, 5]
export const SUBJECT_OPTIONS = ['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社', '理社']

// regularLessonModel.normalizeRegularLessonNote の写し(''/'60'/'45' に寄せる)。
function normalizeRegularLessonNote(value: string) {
  const trimmed = value.trim()
  if (trimmed === '60') return '60'
  if (trimmed === '45') return '45'
  return ''
}

// regularLessonModel.resolveOperationalSchoolYear の写し(4/1 始まり)。
function resolveOperationalSchoolYear(dateKey: string) {
  const parts = parseDateKeyParts(dateKey)
  if (!parts) return Number.NaN
  return parts.month >= 4 ? parts.year : parts.year - 1
}

function resolveSchoolYearDateRange(schoolYear: number) {
  return { startDate: `${schoolYear}-04-01`, endDate: `${schoolYear + 1}-03-31` }
}

// regularLessonModel.resolveRegularLessonParticipantPeriod / isRegularLessonParticipantActiveOnDate の写し。
function normalizeManagedDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function isRegularLessonParticipantActiveOnDate(row: ParentRegularLessonRow, dateKey: string) {
  const schoolYearRange = resolveSchoolYearDateRange(row.schoolYear)
  const startDate = (normalizeManagedDate(row.student2StartDate) || normalizeManagedDate(row.startDate)) || schoolYearRange.startDate
  const endDate = (normalizeManagedDate(row.student2EndDate) || normalizeManagedDate(row.endDate)) || schoolYearRange.endDate
  return dateKey >= startDate && dateKey <= endDate
}

// regularLessonModel.normalizeRegularLessonStudentColumns の写し(生徒1が空なら生徒2を詰める)。
function normalizeRegularLessonStudentColumns(row: ParentRegularLessonRow): ParentRegularLessonRow {
  if (row.student1Id || !row.student2Id) return row
  return {
    ...row,
    student1Id: row.student2Id,
    subject1: row.subject2,
    student1Note: normalizeRegularLessonNote(row.student2Note),
    student2Id: '',
    subject2: '',
    student2Note: '',
  }
}

function normalizeTemplateStudent(student: ParentTemplateStudent | null): ParentTemplateStudent | null {
  if (!student?.studentId) return null
  return {
    studentId: student.studentId,
    subject: SUBJECT_OPTIONS.includes(student.subject) ? student.subject : '英',
    note: normalizeRegularLessonNote(student.note),
  }
}

function hasTemplateAssignments(template: ParentTemplate) {
  return template.cells.some((cell) => cell.desks.some((desk) => Boolean(desk.teacherId) || desk.students.some((student) => Boolean(student?.studentId))))
}

// regularLessonTemplate.normalizeRegularLessonTemplate の写し(曜日 [1..6,0] × 限 [1..5] × 机 1..deskCount に整える)。
// ★元関数は effectiveStartDate が不正なとき「今日」で補うが、ここでは決定性を優先して呼び出し側で弾く。
function normalizeTemplateCells(template: ParentTemplate, deskCount: number): ParentTemplateCell[] {
  const cellByKey = new Map<string, ParentTemplateCell>()
  for (const cell of template.cells) {
    const dayOfWeek = TEMPLATE_DAY_OPTIONS.includes(cell.dayOfWeek) ? cell.dayOfWeek : 1
    const slotNumber = TEMPLATE_SLOT_NUMBERS.includes(cell.slotNumber) ? cell.slotNumber : 1
    cellByKey.set(`${dayOfWeek}_${slotNumber}`, cell)
  }
  return TEMPLATE_DAY_OPTIONS.flatMap((dayOfWeek) => TEMPLATE_SLOT_NUMBERS.map((slotNumber) => {
    const existingCell = cellByKey.get(`${dayOfWeek}_${slotNumber}`)
    const deskByIndex = new Map((existingCell?.desks ?? []).map((desk) => [desk.deskIndex, desk]))
    return {
      dayOfWeek,
      slotNumber,
      desks: Array.from({ length: Math.max(1, deskCount) }, (_, index) => {
        const deskIndex = index + 1
        const existingDesk = deskByIndex.get(deskIndex)
        return {
          deskIndex,
          teacherId: existingDesk?.teacherId ?? '',
          students: [
            normalizeTemplateStudent(existingDesk?.students[0] ?? null),
            normalizeTemplateStudent(existingDesk?.students[1] ?? null),
          ] as [ParentTemplateStudent | null, ParentTemplateStudent | null],
        }
      }),
    }
  }))
}

// regularLessonTemplate.buildRegularLessonsFromTemplate の写し。
// spec-template-behavior Q11: 反映日からその年度末(3/31)までの「単年度のみ」生成する。
function buildRegularLessonsFromTemplate(template: ParentTemplate, students: ParentStudentRow[]): ParentRegularLessonRow[] {
  if (!hasTemplateAssignments(template)) return []
  const effectiveStartDate = normalizeParentDateText(template.effectiveStartDate)
  if (!isValidDateKey(effectiveStartDate)) return []

  const deskCount = Math.max(...template.cells.map((cell) => cell.desks.length), 1)
  const cells = normalizeTemplateCells(template, deskCount)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const schoolYear = resolveOperationalSchoolYear(effectiveStartDate)
  const schoolYearRange = resolveSchoolYearDateRange(schoolYear)
  const sharedStartDate = effectiveStartDate > schoolYearRange.startDate ? effectiveStartDate : schoolYearRange.startDate
  const sharedEndDate = schoolYearRange.endDate

  const resolveSubject = (student: ParentTemplateStudent | null, row: ParentStudentRow | undefined) => {
    if (!student) return ''
    const gradeLabel = row?.birthDate ? resolveGradeLabelFromBirthDate(row.birthDate, sharedStartDate) : ''
    return resolveDisplayedSubjectForGrade(student.subject, gradeLabel)
  }

  const rows: ParentRegularLessonRow[] = []
  for (const cell of cells) {
    for (const desk of cell.desks) {
      const student1 = normalizeTemplateStudent(desk.students[0])
      const student2 = normalizeTemplateStudent(desk.students[1])
      if (!desk.teacherId && !student1 && !student2) continue
      rows.push({
        id: `template_${schoolYear}_${cell.dayOfWeek}_${cell.slotNumber}_${desk.deskIndex}`,
        schoolYear,
        teacherId: desk.teacherId,
        student1Id: student1?.studentId ?? '',
        subject1: resolveSubject(student1, student1 ? studentById.get(student1.studentId) : undefined),
        student1Note: normalizeRegularLessonNote(student1?.note ?? ''),
        startDate: sharedStartDate,
        endDate: sharedEndDate,
        student2Id: student2?.studentId ?? '',
        subject2: resolveSubject(student2, student2 ? studentById.get(student2.studentId) : undefined),
        student2Note: normalizeRegularLessonNote(student2?.note ?? ''),
        student2StartDate: sharedStartDate,
        student2EndDate: sharedEndDate,
        dayOfWeek: cell.dayOfWeek,
        slotNumber: cell.slotNumber,
      })
    }
  }

  // テンプレの deskIndex 順を保つ (schoolYear, dayOfWeek, slotNumber, index) の安定ソート(元関数と同じ)。
  return rows
    .map((row, index) => ({ row: normalizeRegularLessonStudentColumns(row), index }))
    .sort((a, b) => {
      if (a.row.schoolYear !== b.row.schoolYear) return a.row.schoolYear - b.row.schoolYear
      if (a.row.dayOfWeek !== b.row.dayOfWeek) return a.row.dayOfWeek - b.row.dayOfWeek
      if (a.row.slotNumber !== b.row.slotNumber) return a.row.slotNumber - b.row.slotNumber
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

// scheduleHtml.buildCombinedRegularLessonsFromHistory の写し。
// 履歴が無ければ payload.regularLessons(=現在テンプレ由来)をそのまま使う。履歴が 1 本なら
// 「テンプレ前の行(最初のテンプレ開始日の前日で切る)＋regularLessons」、2 本以上なら各テンプレを
// 次のテンプレ開始日の前日で切って結合する。
function buildCombinedRegularLessons(payload: ParentPayload): ParentRegularLessonRow[] {
  const history = payload.classroomSettings.regularLessonTemplateHistory
  if (history.length === 0) return payload.regularLessons

  const allTemplates = [...history].sort((a, b) => (a.effectiveStartDate < b.effectiveStartDate ? -1 : a.effectiveStartDate > b.effectiveStartDate ? 1 : 0))
  const firstTemplateStartDate = allTemplates[0].effectiveStartDate

  const preTemplateLessons: ParentRegularLessonRow[] = []
  if (payload.classroomSettings.preTemplateRegularLessons.length > 0 && isValidDateKey(firstTemplateStartDate)) {
    const clipEndDate = addDaysToDateKey(firstTemplateStartDate, -1)
    if (clipEndDate >= '2000-01-01') {
      for (const lesson of payload.classroomSettings.preTemplateRegularLessons) {
        if (lesson.startDate && lesson.startDate > clipEndDate) continue
        preTemplateLessons.push({
          ...lesson,
          endDate: (!lesson.endDate || lesson.endDate > clipEndDate) ? clipEndDate : lesson.endDate,
          student2EndDate: (!lesson.student2EndDate || lesson.student2EndDate > clipEndDate) ? clipEndDate : lesson.student2EndDate,
        })
      }
    }
  }

  if (allTemplates.length === 1) return [...preTemplateLessons, ...payload.regularLessons]

  const combined: ParentRegularLessonRow[] = [...preTemplateLessons]
  for (let index = 0; index < allTemplates.length; index += 1) {
    const template = allTemplates[index]
    const nextTemplate = allTemplates[index + 1]
    const lessons = buildRegularLessonsFromTemplate(template, payload.students)
    if (nextTemplate && isValidDateKey(nextTemplate.effectiveStartDate)) {
      const clipEndDate = addDaysToDateKey(nextTemplate.effectiveStartDate, -1)
      for (const lesson of lessons) {
        if (lesson.startDate > clipEndDate) continue
        combined.push({
          ...lesson,
          endDate: lesson.endDate > clipEndDate ? clipEndDate : lesson.endDate,
          student2EndDate: lesson.student2EndDate > clipEndDate ? clipEndDate : lesson.student2EndDate,
        })
      }
    } else {
      combined.push(...lessons)
    }
  }
  return combined
}

// ---------------------------------------------------------------------------
// 1 日分の抽出
// ---------------------------------------------------------------------------

function resolveSlotTimeLabel(slotNumber: number, cellTimeLabel?: string) {
  if (cellTimeLabel) return cellTimeLabel
  return PARENT_BOARD_SLOT_TIMES[slotNumber - 1] ?? `${slotNumber}限`
}

function compareLessons(left: ParentScheduleLesson, right: ParentScheduleLesson) {
  return left.slotNumber - right.slotNumber
}

// 盤面優先(spec §D-2 3・§D-3): その日のセルがあれば盤面の内容だけを使い、テンプレで足さない。
// studentSlots(regular/makeup/extra のみ)と statusSlots(absent/absent-no-makeup/attended のみ)の **両方** を読む
// (休みは statusSlots にしか無い。片方だけ読むと休み or 配置が丸ごと消える。INV-06 と同じ「両走査」)。
// ★moved(移動元マーカー)と holiday(休日設定で消えたコマの表示専用記録・2026-09-16)は**行にしない**
//   (moved は移動先の行が出る／holiday はその日が「教室休み」行で出る。出すと同じ1コマが二重に見える)。
//   下の status ホワイトリストが両方を自然に弾く。ホワイトリストを「moved 以外」のような否定形へ
//   書き換えないこと(新種別が黙って保護者ページに出る)。
function extractBoardLessons(
  cells: ParentBoardCell[],
  matches: (entry: { managedStudentId?: string; name: string }) => boolean,
  linkedDestinationByStatusId: Map<string, { dateKey: string; slotNumber: number }>,
): ParentScheduleLesson[] {
  const lessons: ParentScheduleLesson[] = []
  for (const cell of sortCells(cells)) {
    const timeLabel = resolveSlotTimeLabel(cell.slotNumber, cell.timeLabel)
    for (const desk of cell.desks) {
      for (const student of desk.studentSlots) {
        if (!student) continue
        // 体験(trial)は同名でも既存生徒として扱わない。講習(special)は期間外に置かれていても出さない。
        if (student.lessonType !== 'regular' && student.lessonType !== 'makeup' && student.lessonType !== 'extra') continue
        if (!matches(student)) continue
        const placed: ParentScheduleLesson = {
          slotNumber: cell.slotNumber,
          timeLabel,
          subject: resolveDisplayedSubjectForGrade(student.subject, student.grade),
          kind: student.lessonType === 'makeup' ? 'makeup' : student.lessonType === 'extra' ? 'extra' : 'regular',
          isTentative: false,
        }
        const placedOrigin = resolveMakeupOrigin(student, cell.dateKey)
        if (placedOrigin) placed.makeupOrigin = placedOrigin
        lessons.push(placed)
      }
      for (const statusEntry of desk.statusSlots) {
        if (!statusEntry) continue
        // moved は移動先が別に出る(二重表示の防止)。trial/special は配置と同じ理由で出さない。
        if (statusEntry.status !== 'absent' && statusEntry.status !== 'absent-no-makeup' && statusEntry.status !== 'attended') continue
        if (statusEntry.lessonType === 'trial' || statusEntry.lessonType === 'special') continue
        if (!matches(statusEntry)) continue
        const lesson: ParentScheduleLesson = {
          slotNumber: cell.slotNumber,
          timeLabel,
          subject: resolveDisplayedSubjectForGrade(statusEntry.subject, statusEntry.grade),
          kind: statusEntry.status,
          isTentative: false,
        }
        if (statusEntry.status === 'absent') {
          // id が空の status が複数あると Map のキー '' を共有し、**別人・別コマの振替先**が付きうる。
          // 保護者に他人の日付を見せないため、id が無いときはリンクを引かない(§C)。
          lesson.makeupDestination = statusEntry.id ? linkedDestinationByStatusId.get(statusEntry.id) ?? null : null
        } else {
          // 振替コマを出席・振無休にしたもの(statusSlots 側)も振替元を出す(配置のときと同じ表示を保つ)。
          const statusOrigin = resolveMakeupOrigin(statusEntry, cell.dateKey)
          if (statusOrigin) lesson.makeupOrigin = statusOrigin
        }
        lessons.push(lesson)
      }
    }
  }
  return lessons.sort(compareLessons)
}

type ParentMakeupOriginLink = {
  slotNumber: number
  subject: string
  destination: { dateKey: string; slotNumber: number }
}

// 振替元の日 → その日から出ていった振替(振替先)の一覧(確認リスト k-11 2026-09-14「休みとなった日が行表示されない」)。
// 丸ごと振替は振替元の机を空にするだけ、生徒のドラッグ移動は振替元に moved(非表示)を残すだけで、どちらも振替元に
// absent が無い。振替先の配置(makeupSourceDate)から逆に引いて、振替元の日に「お休み＋振替先」を補うための索引。
// 対象は振替コマの配置と、振替を出席/振無休/休みにしたもの。振替コマ自体を休みにした absent も含める
// (丸ごと振替・移動の振替先を休みにすると振替元に何も残らず、k-11 と同じ症状が再発するため・レビュー指摘 A-3)。
// その振替先の日には別に「お休み(振替日は調整中)」が出る。元コマ(限)が読めない振替は行を作れないので含めない。
function buildMakeupOriginLinksByDate(
  cells: ParentBoardCell[],
  matches: (entry: { managedStudentId?: string; name: string }) => boolean,
): Map<string, ParentMakeupOriginLink[]> {
  const linksByDate = new Map<string, ParentMakeupOriginLink[]>()
  const register = (entry: ParentBoardStudentEntry, cell: ParentBoardCell) => {
    if (!matches(entry)) return
    const origin = resolveMakeupOrigin(entry, cell.dateKey)
    if (!origin || origin.slotNumber === null) return
    const list = linksByDate.get(origin.dateKey) ?? []
    list.push({
      slotNumber: origin.slotNumber,
      subject: resolveDisplayedSubjectForGrade(entry.subject, entry.grade),
      destination: { dateKey: cell.dateKey, slotNumber: cell.slotNumber },
    })
    linksByDate.set(origin.dateKey, list)
  }
  for (const cell of sortCells(cells)) {
    for (const desk of cell.desks) {
      for (const student of desk.studentSlots) {
        if (student) register(student, cell)
      }
      for (const statusEntry of desk.statusSlots) {
        if (!statusEntry) continue
        if (statusEntry.status !== 'attended' && statusEntry.status !== 'absent-no-makeup' && statusEntry.status !== 'absent') continue
        register(statusEntry, cell)
      }
    }
  }
  return linksByDate
}

// その日の授業行に、振替元として出ていった分の「お休み＋振替先」を足す。
// 同じ限・同じ科目の「その日本来の授業」の行が既にあれば足さない(absent は振替先の欠けだけ埋める・通常/出席は授業があった扱い)。
// 振替元を持つ行(別の日から来た振替を出席/振無休にしたもの)や振替・増コマはその日本来の授業ではないので数えない(レビュー指摘 A-2)。
function appendMakeupOriginAbsences(
  lessons: ParentScheduleLesson[],
  links: readonly ParentMakeupOriginLink[] | undefined,
  cells?: readonly ParentBoardCell[],
): ParentScheduleLesson[] {
  if (!links || links.length === 0) return lessons
  const next = [...lessons]
  for (const link of links) {
    const existing = next.find((lesson) => (
      lesson.slotNumber === link.slotNumber && lesson.subject === link.subject
      && lesson.kind !== 'makeup' && lesson.kind !== 'extra' && !lesson.makeupOrigin
    ))
    if (existing) {
      if (existing.kind === 'absent' && !existing.makeupDestination) existing.makeupDestination = link.destination
      continue
    }
    next.push({
      slotNumber: link.slotNumber,
      timeLabel: resolveSlotTimeLabel(link.slotNumber, cells?.find((cell) => cell.slotNumber === link.slotNumber)?.timeLabel),
      subject: link.subject,
      kind: 'absent',
      makeupDestination: link.destination,
      isTentative: false,
    })
  }
  return next.sort(compareLessons)
}

// 休講日の行に添える振替先(重複を除き、日付・限の順)。
function buildClosedDayMakeupDestinations(links: readonly ParentMakeupOriginLink[] | undefined) {
  const byKey = new Map<string, { dateKey: string; slotNumber: number }>()
  for (const link of links ?? []) byKey.set(`${link.destination.dateKey}#${link.destination.slotNumber}`, link.destination)
  return [...byKey.values()].sort((left, right) => (left.dateKey !== right.dateKey ? (left.dateKey < right.dateKey ? -1 : 1) : left.slotNumber - right.slotNumber))
}

// 講習コマ(special)がこのセル群にこの生徒の分としてあるか。表示はしない(注記の判定だけに使う)。
function boardCellsHaveLectureLesson(
  cells: ParentBoardCell[],
  matches: (entry: { managedStudentId?: string; name: string }) => boolean,
): boolean {
  for (const cell of cells) {
    for (const desk of cell.desks) {
      for (const student of desk.studentSlots) {
        if (student && student.lessonType === 'special' && matches(student)) return true
      }
      for (const statusEntry of desk.statusSlots) {
        // moved は移動先側に出るので数えない(移動先が範囲外なら講習の印も付けない)。
        // holiday(休日設定で消えたコマの表示専用記録)も同じ扱い＝数えない(在庫へ返却済みで実施されない)。
        if (!statusEntry || statusEntry.lessonType !== 'special' || statusEntry.status === 'moved' || statusEntry.status === 'holiday') continue
        if (matches(statusEntry)) return true
      }
    }
  }
  return false
}

// テンプレ補完(spec §D-2 4): buildManagedRegularLessonsRange の生徒部分を 1 日分だけ再現する。
// 机数(deskCount)の枯渇と「同じセルに既に置かれた生徒」のスキップまで写す(盤面と同じ行が出るように)。
function extractTemplateLessons(params: {
  dateKey: string
  studentId: string
  payload: ParentPayload
  regularLessons: ParentRegularLessonRow[]
  suppressedKeys: Set<string>
}): ParentScheduleLesson[] {
  const { dateKey, studentId, payload, regularLessons, suppressedKeys } = params
  const weekday = getWeekdayFromDateKey(dateKey)
  const schoolYear = resolveOperationalSchoolYear(dateKey)
  const deskCount = payload.classroomSettings.deskCount
  const studentById = new Map(payload.students.map((student) => [student.id, student]))
  const usedDeskCountBySlot = new Map<number, number>()
  const placedStudentIdsBySlot = new Map<number, Set<string>>()
  const lessons: ParentScheduleLesson[] = []

  for (const row of regularLessons) {
    if (row.dayOfWeek !== weekday) continue
    if (row.schoolYear !== schoolYear) continue
    if (!Number.isInteger(row.slotNumber)) continue

    const student1 = studentById.get(row.student1Id)
    const student2 = studentById.get(row.student2Id)
    const hasAssignedStudents = Boolean(student1 || student2)
    const hasTeacherOnlyDesk = Boolean(row.teacherId) && !hasAssignedStudents
    if (!hasAssignedStudents && !hasTeacherOnlyDesk) continue

    const student1Active = student1 !== undefined
      && isRegularLessonParticipantActiveOnDate(row, dateKey)
      && isParentStudentActiveOnDate(student1, dateKey)
    const student2Active = student2 !== undefined
      && Boolean(row.subject2)
      && isRegularLessonParticipantActiveOnDate(row, dateKey)
      && isParentStudentActiveOnDate(student2, dateKey)
    // 呼び出し側で開講日は確認済み(休講日はここへ来ない)。講師だけの机も開講日には机を消費する。
    if (!hasTeacherOnlyDesk && !student1Active && !student2Active) continue

    const participantIds = [student1Active ? row.student1Id : '', student2Active ? row.student2Id : ''].filter(Boolean)
    const placedStudentIds = placedStudentIdsBySlot.get(row.slotNumber) ?? new Set<string>()
    // hasRegularPlacementConflict(teacherId='')の写し: 同じセルに既に置かれた生徒がいれば行ごとスキップ。
    if (participantIds.some((id) => placedStudentIds.has(id))) continue

    const usedDeskCount = usedDeskCountBySlot.get(row.slotNumber) ?? 0
    if (usedDeskCount >= deskCount) continue
    usedDeskCountBySlot.set(row.slotNumber, usedDeskCount + 1)
    for (const id of participantIds) placedStudentIds.add(id)
    placedStudentIdsBySlot.set(row.slotNumber, placedStudentIds)

    const pushIfTarget = (active: boolean, student: ParentStudentRow | undefined, subject: string) => {
      if (!active || !student || student.id !== studentId) return
      // createManagedStudentEntry の写し: 科目は行の値、学年はその日の生年月日から(無ければ '中1')。
      if (suppressedKeys.has(buildManagedOccurrenceKey(student.id, subject, dateKey, row.slotNumber))) return
      const grade = student.birthDate ? resolveBoardSchoolGradeLabel(student.birthDate, dateKey) : '中1'
      lessons.push({
        slotNumber: row.slotNumber,
        timeLabel: resolveSlotTimeLabel(row.slotNumber),
        subject: resolveDisplayedSubjectForGrade(subject, grade),
        kind: 'regular',
        isTentative: true,
      })
    }
    pushIfTarget(student1Active, student1, row.subject1)
    pushIfTarget(student2Active, student2, row.subject2)
  }

  return lessons.sort(compareLessons)
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * 保護者ページの日程を組み立てる(spec §D-2 の順序を変えない: 休講 → 盤面優先 → テンプレ補完)。
 * 出すのは授業(休み・振替を含む)がある日と臨時・祝日の休みの日だけ。講習期間の区別はしない(講習コマは出さない)。
 * 生徒が payload に無ければ null。出力に講師名・机・他生徒・在庫数・内部 ID は含めない(§C)。
 */
export function buildParentScheduleView(payload: unknown, studentId: string, range: ParentScheduleRange): ParentScheduleView | null {
  const parsed = readPayload(payload)
  if (!parsed) return null
  const student = parsed.students.find((row) => row.id === studentId)
  if (!student) return null
  if (!isValidDateKey(range.from) || !isValidDateKey(range.to) || range.to < range.from) {
    return { studentName: getStudentDisplayName(student), days: [], hasLectureLessons: false }
  }

  const matches = createEntryMatcher(parsed.students, studentId)
  const allCells = parsed.weeks.flat()
  const cellsByDateKey = new Map<string, ParentBoardCell[]>()
  for (const cell of allCells) {
    const list = cellsByDateKey.get(cell.dateKey) ?? []
    list.push(cell)
    cellsByDateKey.set(cell.dateKey, list)
  }
  const linkedDestinationByStatusId = buildLinkedLessonDestinationMap(allCells)
  // 振替先は表示期間の内外を問わず全週から引く(§D-5 と同じ)。
  const originLinksByDate = buildMakeupOriginLinksByDate(allCells, matches)

  // テンプレ補完は必要になった日に初めて計算する(盤面が全日そろっていれば不要)。
  let templateContext: { regularLessons: ParentRegularLessonRow[]; suppressedKeys: Set<string> } | null = null
  const resolveTemplateContext = () => {
    if (!templateContext) {
      templateContext = {
        regularLessons: buildCombinedRegularLessons(parsed),
        suppressedKeys: buildSuppressedOccurrenceKeys(parsed.weeks, parsed.suppressedRegularLessonOccurrences),
      }
    }
    return templateContext
  }
  const freezeBeforeDate = normalizeParentDateText(parsed.classroomSettings.templateFreezeBeforeDate)

  const days: ParentScheduleDay[] = []
  let hasLectureLessons = false
  const totalDays = diffDays(range.from, range.to)
  for (let offset = 0; offset <= totalDays; offset += 1) {
    const dateKey = addDaysToDateKey(range.from, offset)
    const weekday = getWeekdayFromDateKey(dateKey)

    if (!isOpenDay(parsed.classroomSettings, dateKey)) {
      // 臨時・祝日の休み(holidayDates)だけ 1 行出す。毎週の定休曜日は出さない(一覧が休みの行で埋まるため)。
      if (parsed.classroomSettings.holidayDates.includes(dateKey)) {
        const closedDay: ParentScheduleDay = { dateKey, weekday, kind: 'closed', lessons: [] }
        const destinations = buildClosedDayMakeupDestinations(originLinksByDate.get(dateKey))
        if (destinations.length > 0) closedDay.makeupDestinations = destinations
        days.push(closedDay)
      }
      continue
    }
    // 講習期間の日も通常日と同じく「盤面優先 → テンプレ補完」で通常授業だけを出す(講習コマは抽出側で除外)。
    const cells = cellsByDateKey.get(dateKey)
    if (cells && cells.length > 0) {
      if (!hasLectureLessons) hasLectureLessons = boardCellsHaveLectureLesson(cells, matches)
      const lessons = appendMakeupOriginAbsences(extractBoardLessons(cells, matches, linkedDestinationByStatusId), originLinksByDate.get(dateKey), cells)
      if (lessons.length > 0) days.push({ dateKey, weekday, kind: 'board', lessons })
      continue
    }
    // templateFreezeBeforeDate より前(テンプレ再マージ凍結済み)の日は補完しない = 出す行なし。
    if (freezeBeforeDate && dateKey < freezeBeforeDate) continue
    const context = resolveTemplateContext()
    const lessons = appendMakeupOriginAbsences(
      extractTemplateLessons({ dateKey, studentId, payload: parsed, regularLessons: context.regularLessons, suppressedKeys: context.suppressedKeys }),
      originLinksByDate.get(dateKey),
    )
    if (lessons.length > 0) days.push({ dateKey, weekday, kind: 'template', lessons })
  }

  return { studentName: getStudentDisplayName(student), days, hasLectureLessons }
}
